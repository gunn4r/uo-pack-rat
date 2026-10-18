// compare-cores.mts — runs the solvers' code at a git ref and the working tree's on identical inputs and checks every output is byte-identical, so a solver refactor can show it changes nothing.
//
// map: builder
//
// The base's `app/` and `scripts/` are copied out of git into a temp folder (with this checkout's node_modules linked in),
// so both sides load in one process. Each side gets its own deep copy of every input, so a function that mutates one
// can't leak into the other. Compared, as `JSON.stringify` of the whole output:
// - the core's `optimizeSuit` and `scoreSet`;
// - the MIP's `buildSuitMip` (with and without `hardAsSoft`, with `parts`), `startVector`, `hardFloorSpread` and `tieCosts`;
// - `preBuildDiagnostics`, `resultDiagnostics`, `scoreShares` and `requirementReport`.
// A kind is compared only where both sides export its function. The inputs are the fixture with every built-in template
// (heuristic searches only: the core's branch-and-bound doesn't prove the fixture in reasonable time), then generated
// inventories: negative values, two-handers, worn pieces, rarity tie costs, hard and soft floors (some exactly at their
// min, some hard floors naming keys with no floor), floor bonuses and partial credit down to 0, mins, Resisting Spells and
// SSI steps, hard-floor bonuses from 5 to 1e10; four searches each (plain, exact with alternatives, tie-break, Strict
// order), the exact ones with a ten-minute budget. An exact search that comes back unproven fails the check, since two
// runs cut by the clock can differ on the clock alone.
//
//   node app/bench/compare-cores.mts [--base origin/main] [--generated 2000]
//
// Prints a JSON summary and exits 1 when any output differs or any exact search is unproven.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import * as fx from "../solver-fixture.mts";

const { values: args } = parseArgs({ options: { base: { type: "string", default: "origin/main" }, generated: { type: "string", default: "2000" } } });
const base = args.base!, generated = Number(args.generated);
if (!/^\d+$/.test(args.generated!) || !Number.isSafeInteger(generated)) throw new Error(`--generated must be a whole number, not ${JSON.stringify(args.generated)}`);

const ROOT = resolve(import.meta.dirname, "../..");
const dir = mkdtempSync(join(tmpdir(), "compare-cores-"));
execFileSync("sh", ["-c", `git archive "$0" app scripts | tar -x -C "$1"`, base, dir], { cwd: ROOT, stdio: ["ignore", "ignore", "inherit"] });
symlinkSync(join(ROOT, "node_modules"), join(dir, "node_modules"));
type Fn = (...a: unknown[]) => unknown;
type Side = Record<"core" | "mip" | "diag" | "lib", Record<string, unknown>>;
const load = async (root: string): Promise<Side> => {
  const at = (p: string): Promise<Record<string, unknown>> => import(pathToFileURL(join(root, p)).href);
  return { core: await at("scripts/optimizer-core.mts"), mip: await at("app/mip.mts"), diag: await at("app/diagnostics.mts"), lib: await at("app/vault-lib.mts") };
};
const before = await load(dir), after = await load(ROOT);
rmSync(dir, { recursive: true, force: true });

const count: Record<string, [number, number]> = {};
const diffs: string[] = [], unproven: string[] = [];
const json = (v: unknown): string => JSON.stringify(v, (_k, x: unknown) => (x instanceof Float64Array ? Array.from(x) : x instanceof Set ? [...x] : x));
const call = (x: Side, m: keyof Side, fn: string, ...a: unknown[]): unknown => (x[m][fn] as Fn)(...a);
// One comparison: `uses` names the [module, function] pairs it needs on both sides; each side gets its own copy of `inputs`.
function cmp<I>(kind: string, label: string, uses: Array<[keyof Side, string]>, inputs: I, f: (x: Side, i: I) => unknown): void {
  if (!uses.every(([m, fn]) => typeof before[m][fn] === "function" && typeof after[m][fn] === "function")) return;
  const a = f(before, structuredClone(inputs)), b = f(after, structuredClone(inputs));
  const c = (count[kind] ||= [0, 0]);
  c[0]++;
  if (json(a) === json(b)) c[1]++;
  else diffs.push(`${kind} ${label}`);
  for (const r of [a, b]) if (r && typeof r === "object" && (r as { proven?: boolean }).proven === false) unproven.push(`${kind} ${label}`);
}
const SEARCH: Array<[keyof Side, string]> = [["core", "optimizeSuit"]];

// 1. the fixture with every built-in template
for (const name of Object.keys(fx.defaultProfiles.templates)) {
  const { pools, current, profile } = fx.cell(name), ranks = (fx.defaultProfiles.templates[name] as { goals?: { ranks: string[][] } }).goals?.ranks;
  const searches = [{ seed: 2026, restarts: 200 }, { seed: 2026, restarts: 200, tieBreak: { tolerance: 0, fewestChanges: true } }, { seed: 2026, restarts: 200, tieBreak: { tolerance: 2 } }, ...(ranks?.length ? [{ seed: 2026, restarts: 100, strict: { ranks, fewestChanges: true } }] : [])];
  for (const [i, o] of searches.entries()) cmp("optimizeSuit", `${name}/${i}`, SEARCH, { pools, current, profile, o }, (x, a) => call(x, "core", "optimizeSuit", a.pools, a.current, a.profile, a.o));
  cmp("buildSuitMip", name, [["mip", "buildSuitMip"]], { pools, current, profile }, (x, a) => call(x, "mip", "buildSuitMip", { ...a, parts: true }));
  const best = call(after, "core", "optimizeSuit", structuredClone(pools), structuredClone(current), structuredClone(profile), { seed: 1, restarts: 20 }) as { best: Record<string, unknown>; totals: { after: Record<string, number> } };
  const ins = { pools, current, profile, best };
  cmp("startVector", name, [["mip", "buildSuitMip"], ["mip", "startVector"]], ins, (x, a) => call(x, "mip", "startVector", call(x, "mip", "buildSuitMip", { pools: a.pools, current: a.current, profile: a.profile }), a.best.best));
  cmp("diagnostics", name, [["diag", "resultDiagnostics"]], ins, (x, a) => call(x, "diag", "resultDiagnostics", { pools: a.pools, current: a.current, profile: a.profile, result: a.best }));
  cmp("requirementReport", name, [["lib", "requirementReport"]], ins, (x, a) => call(x, "lib", "requirementReport", a.best.totals.after, a.profile));
}
const fixtureRuns = Object.values(count).reduce((t, [c]) => t + c, 0);

// 2. generated inventories
let seed = 9001;
const rnd = (): number => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed / 4294967296; };
const int = (lo: number, hi: number): number => lo + Math.floor(rnd() * (hi - lo + 1));
const keys = ["physResist", "fireResist", "hci", "dci", "di", "ssi", "stamPool", "sk:resisting spells", "luck"];
for (let n = 0; n < generated; n++) {
  const slots = fx.fuzzSlots(rnd, 5), pools: Record<string, unknown[]> = {}, current: Record<string, unknown> = {};
  let serial = n * 100;
  for (const s of slots) {
    pools[s] = Array.from({ length: int(1, 3) }, (_v, i) => {
      const props: Record<string, number> = {};
      for (const k of keys) if (rnd() < 0.45) props[k] = k === "sk:resisting spells" ? int(0, 15) : int(-8, 22);
      const it = { serial: ++serial, name: `i${serial}`, slot: s, props, ...(s === "twoHanded" && rnd() < 0.4 ? { twoHanded: true } : {}), ...(rnd() < 0.4 ? { tieCost: int(0, 4) } : {}) };
      if (i === 0 && rnd() < 0.5) current[s] = it;
      return it;
    });
  }
  const weights: Record<string, number> = {}, caps: Record<string, number> = {}, floors: Record<string, number> = {}, mins: Record<string, number> = {};
  for (const k of keys) {
    if (k === "sk:resisting spells") continue;
    if (rnd() < 0.7) weights[k] = int(-3, 5) * (rnd() < 0.3 ? 0.5 : 1);
    if (rnd() < 0.35) caps[k] = int(0, 40);
    if (rnd() < 0.4) floors[k] = int(-5, 45);
  }
  for (const k of ["physResist", "fireResist", "hci"]) if (rnd() < 0.5) mins[k] = int(-5, 30);
  if (rnd() < 0.3) floors.physResist = mins.physResist ?? 10;
  const hard = [...Object.keys(floors).filter(() => rnd() < 0.45), ...(rnd() < 0.2 ? ["luck", "nothing"] : [])];
  const profile: Record<string, unknown> = {
    weights, caps, floors, mins, hardFloors: hard,
    ...(rnd() < 0.6 ? { floorBonus: [0, 1, 500, 2000][int(0, 3)] } : {}), ...(rnd() < 0.5 ? { floorPartial: [0, 0.25, 0.5][int(0, 2)] } : {}),
    ...(rnd() < 0.2 ? { hardFloorBonus: [5, 3e8, 1e10][int(0, 2)] } : {}),
  };
  if (rnd() < 0.35) profile.resistSteps = [{ at: 10, mins: { physResist: 35, fireResist: 32 } }, { at: 20, mins: { physResist: 40, fireResist: 38 } }];
  if (rnd() < 0.35 && (weights.ssi || 0) > 0) profile.ssiSteps = [{ ssi: 5, stam: 0, credit: 8 }, { ssi: 15, stam: 10, credit: 20 }, { ssi: 30, stam: 25, credit: 45 }];
  const optionalSlots = slots.filter(() => rnd() < 0.6), opts = { seed: n, restarts: 15, slots, optionalSlots };
  const ranks = [[keys[int(0, 5)]!], [keys[int(0, 8)]!]].map((r) => [...new Set(r)]);
  const searches = [opts, { ...opts, exact: true, timeBudgetMs: 600000, alternatives: { count: 3, tolerance: int(0, 1) * 5 } }, { ...opts, exact: rnd() < 0.5, timeBudgetMs: 600000, tieBreak: { tolerance: int(0, 1) * 3, fewestChanges: rnd() < 0.5 } }, { ...opts, exact: rnd() < 0.5, timeBudgetMs: 600000, strict: { ranks, fewestChanges: rnd() < 0.5 } }];
  for (const [i, o] of searches.entries()) cmp("optimizeSuit", `gen${n}/${i}`, SEARCH, { pools, current, profile, o }, (x, a) => call(x, "core", "optimizeSuit", a.pools, a.current, a.profile, a.o));
  const model = { pools, current, profile, optionalSlots, slots };
  for (const hardAsSoft of [false, true]) cmp("buildSuitMip", `gen${n}/${hardAsSoft}`, [["mip", "buildSuitMip"]], model, (x, a) => call(x, "mip", "buildSuitMip", { ...a, hardAsSoft, parts: true }));
  cmp("hardFloorSpread", `gen${n}`, [["mip", "hardFloorSpread"]], model, (x, a) => call(x, "mip", "hardFloorSpread", a.profile, a.pools, a.current, a.optionalSlots, a.slots));
  cmp("tieCosts", `gen${n}`, [["mip", "buildSuitMip"], ["mip", "tieCosts"]], model, (x, a) => call(x, "mip", "tieCosts", call(x, "mip", "buildSuitMip", a), a.current));
  const suit: Record<string, unknown> = {};
  for (const s of slots) suit[s] = rnd() < 0.2 ? null : pools[s]![int(0, pools[s]!.length - 1)];
  const totals = call(after, "core", "optAssignmentTotals", structuredClone(suit)), conflict = rnd() < 0.5;
  const one = { ...model, suit, totals };
  cmp("startVector", `gen${n}`, [["mip", "buildSuitMip"], ["mip", "startVector"]], one, (x, a) => call(x, "mip", "startVector", call(x, "mip", "buildSuitMip", { pools: a.pools, current: a.current, profile: a.profile, optionalSlots: a.optionalSlots, slots: a.slots, hardAsSoft: true }), Object.fromEntries(Object.entries(a.suit).filter(([, v]) => v))));
  cmp("scoreSet", `gen${n}`, [["core", "scoreSet"]], one, (x, a) => call(x, "core", "scoreSet", a.suit, a.profile));
  cmp("diagnostics", `gen${n}`, [["diag", "preBuildDiagnostics"], ["diag", "resultDiagnostics"], ["diag", "scoreShares"]], one, (x, a) => [
    call(x, "diag", "preBuildDiagnostics", { pools: a.pools, current: a.current, optionalSlots: a.optionalSlots, slots: a.slots, profile: a.profile }),
    call(x, "diag", "resultDiagnostics", { pools: a.pools, current: a.current, optionalSlots: a.optionalSlots, slots: a.slots, profile: a.profile, result: { totals: { after: a.totals }, floorsConflict: conflict, best: a.suit } }),
    call(x, "diag", "scoreShares", a.profile, a.totals),
  ]);
  cmp("requirementReport", `gen${n}`, [["lib", "requirementReport"]], one, (x, a) => call(x, "lib", "requirementReport", a.totals, a.profile));
}

const runs = Object.values(count).reduce((t, [c]) => t + c, 0);
console.log(JSON.stringify({ base, fixtureRuns, generatedRuns: runs - fixtureRuns, runs, identical: runs - diffs.length, byKind: count, diffs: diffs.slice(0, 20), unproven: unproven.slice(0, 20) }));
process.exitCode = diffs.length || unproven.length ? 1 : 0;
