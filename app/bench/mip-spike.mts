// mip-spike.mts — SPIKE (Sep 13 2026): solve the suit problem as a mixed-integer program with HiGHS (WASM) and compare
// against the core's proven scores. Superseded by app/mip.mts + app/exact-solver.mts (the real orchestrator the
// server uses); kept as evidence behind REPORT.md's MIP addendum, not wired into the app.
// Needs the `highs` npm package (WASM HiGHS, MIT) installed next to it or resolvable
// from a scratch dir: `npm i highs`. node mip-spike.mts <N|real> <Profile> [timeLimitS]; CORE_CHECK=<s> also runs the
// core on the same cell; DEBUG_DIMS=1 prints per-dimension contributions.
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import type { Highs, LegacyHighsOptions } from "highs";
import { resolveConfig, corePath } from "../config.mts";
import { upgradeScan } from "../scan-schema.mts";
import { loadRules } from "../rules.mts";
import type * as VaultLib from "../vault-lib.mts";
import type * as Core from "../../scripts/optimizer-core.mts";
import type { OptPools, OptAssignment, OptProfile } from "../exact-solver.mts";
import type { MipProfile } from "../mip.mts";
import type { ScanV2 } from "../schema/types.d.mts";

const APP_DIR = dirname(fileURLToPath(import.meta.url).replace("/bench/", "/"));
const SCRATCH = join(tmpdir(), "mip-spike");
const [nArg = "real", whoArg, limitS = "600", frac = "0.3"] = process.argv.slice(2);
const lib = (await import(pathToFileURL(join(APP_DIR, "vault-lib.mts")).href)) as typeof VaultLib;
lib.setRules(loadRules("uoalive"));   // same shard the bench's real scans and profiles.json were recorded against
const core = (await import(pathToFileURL(corePath()).href)) as typeof Core;

// ---- the same cell construction as the bench ----
const config = resolveConfig();
const scansDir = config.paths.scans;
const snaps: unknown[] = readdirSync(scansDir).filter((f) => f.endsWith(".json")).map((f): unknown => JSON.parse(readFileSync(join(scansDir, f), "utf8")));
if (nArg !== "real") snaps.push(JSON.parse(readFileSync(join(SCRATCH, `bench-${nArg}-${frac}.json`), "utf8")) as unknown);
const inv = lib.foldSnapshots(snaps.map((s) => upgradeScan(s, { shard: "uoalive" }) as ScanV2));   // bench-only: real snapshots come from <dataDir>/scans/, already validateScan()-checked by watcher.mts on the way in; the scratch bench file (when N != "real") is this repo's own generateScan() output — never re-validated here
if (!existsSync(config.paths.profiles)) {
  console.error(`no profiles.json at ${config.paths.profiles} — point PACKRAT_DATA (or --data) at a directory that has one, or create one first`);
  process.exit(1);
}

// A profiles.json character entry, as far as this spike reads it — a subset of vault-lib.mts's own
// CharacterEntryRaw (kept local rather than imported: CharacterEntryRaw's `caps` field is typed
// `unknown`, which doesn't line up with the `caps?: Record<string, number>` this file's own `p`
// eventually needs for lib.effectiveProfile's Profile parameter, and this spike never reads `caps`
// off a character entry at all) plus excludeRoots, which CharacterEntryRaw doesn't declare.
interface SpikeCharacterEntry {
  excludeWeapons?: string[] | undefined;
  weaponSkill?: string | null | undefined;   // a profiles.json from before excludeWeapons (lib.excludedWeapons reads either)
  softFloors?: string[] | undefined;
  floors?: Record<string, number> | undefined;
  weights?: Record<string, number> | undefined;
  floorBonus?: number | undefined;
  lockedSlots?: string[] | undefined;
  excludeTags?: string[] | undefined;
  excludeSkills?: string[] | undefined;
  excludeRoots?: Array<number | string> | undefined;
  allowGargoyle?: boolean | undefined;
  medOnly?: boolean | undefined;
  strLimit?: number | undefined;
  race?: string | null | undefined;
}
interface SpikeProfilesFile {
  characters?: Record<string, SpikeCharacterEntry> | undefined;
}
const profiles = JSON.parse(readFileSync(config.paths.profiles, "utf8")) as SpikeProfilesFile;
const characters = profiles.characters || {};
const characterNames = Object.keys(characters);
if (!whoArg && !characterNames.length) {
  console.error(`profiles.json has no characters — pass a character name as the 2nd argument (node mip-spike.mts <N|real> <Character>)`);
  process.exit(1);
}
const who = whoArg || characterNames[0]!;   // the guard above guarantees characterNames is non-empty whenever whoArg is falsy
const base = who.replace("-anyweapon", "");
const p0 = characters[base];
if (!p0) {
  console.error(`no character "${base}" in profiles.json — have: ${characterNames.join(", ") || "(none)"}`);
  process.exit(1);
}
const p = who.endsWith("-anyweapon") ? { ...p0, excludeWeapons: [] } : { ...p0 };
if (process.env.SOFT) p.softFloors = process.env.SOFT.split(",");
const c = inv.characters[base];
const { pools, current, blocked = [] } = lib.buildPools(inv, base, { allowOthersWorn: false, strength: p.strLimit ?? (c ? (c.stats.str as number) : 125), excludeTags: p.excludeTags || [],   // Character.stats is Record<string, unknown> — str is always numeric at runtime
  excludeRoots: p.excludeRoots || [], excludeGargoyle: !p.allowGargoyle, medOnly: !!p.medOnly, excludeWeapons: lib.excludedWeapons(p), excludeSkills: p.excludeSkills || [] });
for (const s of p.lockedSlots || []) pools[s] = [];
const cur = { ...current }; for (const s of blocked) delete cur[s];
const optional = new Set(["cloak", "talisman", "ring", "bracelet", "neck", "oneHanded", "twoHanded"].filter((s) => !(p.lockedSlots || []).includes(s)));
const profile = lib.effectiveProfile(p, c);
const SLOTS = ["helmet", "chest", "arms", "hands", "legs", "neck", "ring", "bracelet", "talisman", "cloak", "oneHanded", "twoHanded"];
const poolTotal = Object.values(pools).reduce((a, l) => a + l!.length, 0);   // Object.values only returns keys buildPools actually set, never an explicit undefined

// ---- dimensions: weights ∪ caps ∪ floors (anything else scores zero, as in scoreSet) ----
const W = profile.weights || {}, CAPS = profile.caps || {}, FL = profile.floors || {};
const hard = new Set(profile.hardFloors || []);
const soft = Object.keys(FL).filter((k) => !hard.has(k));
// profile.floorPartial isn't on vault-lib.mts's EffectiveProfile (app/mip.mts's MipProfile is the
// looser, floorPartial-carrying shape a caller earns by widening — see its own header note); reading
// it here needs that same widening, once, into a local.
const floorPartialRaw = (profile as MipProfile).floorPartial;
const FB = typeof profile.floorBonus === "number" ? profile.floorBonus : 1000, PARTIAL = typeof floorPartialRaw === "number" ? floorPartialRaw : 0.5;
const softSet = new Set(soft);
const dims = [...new Set([...Object.keys(W), ...Object.keys(CAPS), ...Object.keys(FL)])];
for (const d of dims) if ((W[d] || 0) < 0 && Number.isFinite(CAPS[d])) throw new Error("negative weight with a cap is non-concave: " + d);

// ---- LP text ----
const terms: Record<string, string[]> = {};              // dim -> array of "coef xvar"
const vars: string[] = [], x: { name: string; slot: string; item: VaultLib.PooledOptItem }[] = [];        // x[k] = {name, slot, item}
const constTotals: Record<string, number> = Object.fromEntries(dims.map((d): [string, number] => [d, 0]));
const fixed: Record<string, VaultLib.PooledOptItem> = {};
for (const s of SLOTS) {
  const list = [...(pools[s] || [])];
  const curS = cur[s];
  if (curS && !list.some((it) => it.serial === curS.serial)) list.push(curS);   // keep-what-you-wear: the worn piece is always a candidate
  if (!list.length) { if (curS) { fixed[s] = curS; for (const d of dims) constTotals[d]! += curS.props[d] || 0; } continue; }
  list.forEach((it, i) => { const name = `x_${s}_${i}`; vars.push(name); x.push({ name, slot: s, item: it }); });
}
const fmt = (v: number): string => (Number.isInteger(v) ? String(v) : v.toFixed(6));
let obj: string[] = [], cons: string[] = [], bounds: string[] = [], objCoef: Record<string, number> = {}, objConst = 0, softVars: string[] = [];
for (const d of dims) {
  const w = W[d] || 0, cap = CAPS[d], f = FL[d] || 0;
  const withProp = x.filter((v) => (v.item.props[d] || 0) !== 0);
  const lin = (sign: number): string => (withProp.length ? withProp.map((v) => `${fmt(sign * v.item.props[d]!)} ${v.name}`).join(" + ").replace(/\+ -/g, "- ") : "0 x_zero");   // withProp's own filter above already proved v.item.props[d] is defined and nonzero
  const sum = lin(1);
  if (w !== 0) {
    if (Number.isFinite(cap) && w > 0) {            // c_d <= total_d + const, c_d <= cap  → objective w·c_d
      obj.push(`${fmt(w)} c_${d}`);
      cons.push(`cap_${d}: c_${d} + ${lin(-1)} <= ${fmt(constTotals[d]!)}`.replace("+ -", "- "));
      bounds.push(`0 <= c_${d} <= ${fmt(cap!)}`);   // Number.isFinite(cap) above guarantees cap is a defined finite number here
    } else {                                          // uncapped: linear, aggregated per variable (the LP reader keeps one coefficient per name)
      for (const v of x) { const val = v.item.props[d] || 0; if (val) objCoef[v.name] = (objCoef[v.name] || 0) + w * val; }
      objConst += w * constTotals[d]!;
    }
  }
  if (f > 0 && !softSet.has(d)) cons.push(`floor_${d}: ${sum} >= ${fmt(f - constTotals[d]!)}`);
  if (f > 0 && softSet.has(d)) {                    // soft floor: FB when met, else FB*PARTIAL*t/f — a jump, so one binary
    const k = FB * PARTIAL / f;
    obj.push(`${fmt(FB)} y_${d}`); obj.push(`1 s_${d}`);
    cons.push(`smet_${d}: ${lin(1)} - ${fmt(f)} y_${d} >= ${fmt(-constTotals[d]!)}`);             // t >= f*y
    cons.push(`spart_${d}: s_${d} + ${lin(-k)} <= ${fmt(k * constTotals[d]!)}`.replace("+ -", "- ")); // s <= k*t
    cons.push(`soff_${d}: s_${d} + ${fmt(FB * PARTIAL)} y_${d} <= ${fmt(FB * PARTIAL)}`);        // s <= FB*PARTIAL*(1-y)
    bounds.push(`0 <= s_${d} <= ${fmt(FB * PARTIAL)}`); softVars.push(`y_${d}`);
  }
}
// one per slot (= 1 if required and it has a current piece, else ≤ 1)
for (const s of SLOTS) {
  const vs = x.filter((v) => v.slot === s);
  if (!vs.length) continue;
  const req = !optional.has(s) && cur[s];
  cons.push(`slot_${s}: ${vs.map((v) => v.name).join(" + ")} ${req ? "= 1" : "<= 1"}`);
}
// a two-handed weapon forbids anything in the one-hand slot
const twoH = x.filter((v) => v.slot === "twoHanded" && v.item.twoHanded === true), oneH = x.filter((v) => v.slot === "oneHanded");
if (twoH.length && oneH.length) cons.push(`hands: ${[...twoH, ...oneH].map((v) => v.name).join(" + ")} <= 1`);
for (const [name, coef] of Object.entries(objCoef)) if (coef !== 0) obj.push(`${fmt(coef)} ${name}`);
const objText = obj.length ? obj.join(" + ").replace(/\+ -/g, "- ") : "0 x_zero";
const lp = `Maximize\n obj: ${objText}\nSubject To\n ${cons.join("\n ")}\nBounds\n ${bounds.join("\n ")}\n 0 <= x_zero <= 0\nBinary\n ${[...vars, ...softVars].join(" ")}\nEnd\n`;
const constScore = dims.reduce((a, d) => a + (W[d] || 0) * 0, 0);   // constants folded into cons; objective already has none

// ---- floor feasibility diagnostic: sum of per-slot maxima vs the floor ----
for (const d of Object.keys(FL)) {
  let best = constTotals[d]!;
  for (const s of SLOTS) { const list = pools[s] || []; if (list.length) best += Math.max(0, ...list.map((it) => it.props[d] || 0)); }
  if (best < FL[d]!) console.log(`FLOOR UNREACHABLE by construction: ${d} floor ${FL[d]} but per-slot maxima sum to ${best}`);
}
// ---- solve ----
writeFileSync("last.lp", lp);
// The `highs` package's types.d.ts is typed as CommonJS, so TS treats a static default import as
// Node's CJS/ESM interop default (the whole module namespace) rather than the real ESM default
// export — the same mistyping app/mip-solve.mts's loadHighs() already works around; this mirrors
// its cast rather than fighting the package's types a second, independent way.
const highsLoader = (await import("highs")).default as unknown as () => Promise<Highs>;
const highs = await highsLoader();
const t0 = Date.now();
const SOLVE_OPTIONS: LegacyHighsOptions = { time_limit: +limitS, mip_rel_gap: 0, mip_abs_gap: 1e-3 };
// The legacy solve() result is a Status-discriminated union whose "Infeasible" branch has no
// Columns[x].Primal — every read below is already an optional-chained `?.Primal || 0` (or, for
// r/rk themselves, only reached once Status has been checked to be "Optimal"), so this local shape
// is what the rest of this file actually reads rather than the full discriminated union.
interface SpikeSolution { Status: string; ObjectiveValue: number; Columns: Record<string, { Primal: number } | undefined> }
let r: SpikeSolution;
try { r = highs.solve(lp, SOLVE_OPTIONS) as unknown as SpikeSolution; }
catch (e) { const err = e as { message?: unknown }; console.log("SOLVE ERROR:", String((err && err.message) || err).slice(0, 400)); writeFileSync("last.lp", lp); console.log("lp written to last.lp, lines:", lp.split("\n").length); process.exit(1); }
const ms = Date.now() - t0;
const kbest: { score: number; ms: number }[] = [];
if (process.env.KBEST) {
  let text = lp, prev: SpikeSolution = r;
  for (let k = 0; k < +process.env.KBEST; k++) {
    const picked = x.filter((v) => (prev.Columns[v.name]?.Primal || 0) > 0.5).map((v) => v.name);
    if (!picked.length) break;
    const pickedSet = new Set(picked);
    const others = x.filter((v) => !pickedSet.has(v.name)).map((v) => v.name);            // a proper no-good: supersets (a zero-value piece added in an empty slot) stay allowed
    text = text.replace("\nBounds\n", `\n nogood_${k}: ${picked.join(" + ")}${others.length ? " - " + others.join(" - ") : ""} <= ${picked.length - 1}\nBounds\n`);
    const t2 = Date.now(); const rk = highs.solve(text, SOLVE_OPTIONS) as unknown as SpikeSolution;
    if (rk.Status !== "Optimal") break;
    const suitK: Record<string, VaultLib.PooledOptItem | null> = Object.fromEntries(SLOTS.map((s2): [string, VaultLib.PooledOptItem | null] => [s2, null])); for (const v of x) if ((rk.Columns[v.name]?.Primal || 0) > 0.5) suitK[v.slot] = v.item; for (const [s2, it] of Object.entries(fixed)) suitK[s2] = it;
    kbest.push({ score: +core.scoreSet(suitK as unknown as OptAssignment, profile).toFixed(3), ms: Date.now() - t2 }); prev = rk;
  }
}
const chosen: Record<string, VaultLib.PooledOptItem | null> = {};
for (const v of x) if ((r.Columns[v.name]?.Primal || 0) > 0.5) chosen[v.slot] = v.item;
for (const [s, it] of Object.entries(fixed)) chosen[s] = it;
const assignment: Record<string, VaultLib.PooledOptItem | null> = Object.fromEntries(SLOTS.map((s): [string, VaultLib.PooledOptItem | null] => [s, chosen[s] || null]));
const coreScore = core.scoreSet(assignment as unknown as OptAssignment, profile);
if (process.env.DEBUG_DIMS) {
  let acc = 0;
  for (const d of dims) {
    const total = Object.values(assignment).reduce((a, it) => a + (it ? (it.props[d] || 0) : 0), 0);
    const w = W[d] || 0, cap = Number.isFinite(CAPS[d]) ? CAPS[d]! : Infinity;
    const contrib = w * Math.min(total, cap);
    const col = r.Columns[`c_${d}`];
    const cvar = col ? col.Primal : null;
    acc += contrib;
    if (contrib !== 0 || cvar != null) console.log(`${d.padEnd(16)} total=${total} w=${w} cap=${cap} contrib=${contrib.toFixed(3)} c_var=${cvar}`);
  }
  console.log("sum of contribs:", acc.toFixed(3), "| mip objective:", r.ObjectiveValue.toFixed(3));
}           // the app's own scorer on the MIP's suit
const nHard = Object.keys(FL).filter((k) => hard.has(k)).length;
let coreRun: { ms: number; proven: boolean | undefined; score: number } | null = null, coreAlts: number[] | null = null;
if (process.env.CORE_CHECK) {
  const t1 = Date.now();
  const rr = core.optimizeSuit(pools as unknown as OptPools, cur as unknown as OptAssignment, profile as OptProfile, { seed: 2026, restarts: 200, optionalSlots: [...optional], exact: true, timeBudgetMs: +process.env.CORE_CHECK * 1000 });
  coreRun = { ms: Date.now() - t1, proven: rr.proven, score: +rr.score.toFixed(3) };
  if (process.env.KBEST) { const ra = core.optimizeSuit(pools as unknown as OptPools, cur as unknown as OptAssignment, profile as OptProfile, { seed: 2026, restarts: 200, optionalSlots: [...optional], exact: true, timeBudgetMs: +process.env.CORE_CHECK * 1000, alternatives: { count: +process.env.KBEST, tolerance: +(process.env.TOL || 1e9) } }); coreAlts = (ra.alternatives || []).map((a) => +(a.score).toFixed(3)); }
}
console.log(JSON.stringify({ N: nArg, frac, who, poolTotal, vars: vars.length, cons: cons.length, status: r.Status, ms,
  mipObjective: +r.ObjectiveValue.toFixed(3), impliedScore: +(r.ObjectiveValue + objConst + nHard * 1e7).toFixed(3), coreScore: +coreScore.toFixed(3),
  match: Math.abs(r.ObjectiveValue + objConst + nHard * 1e7 - coreScore) < 1e-3, coreRun, kbest: kbest.map((k) => k.score), kbestMs: kbest.map((k) => k.ms), coreAlts, suit: Object.fromEntries(Object.entries(assignment).map(([s, it]) => [s, it ? it.name : null])) }));
