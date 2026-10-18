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
// - the exact solver's `solveExact` (HiGHS) on the first `--exact` generated instances, plain and with each search's options
//   (alternatives, tie-break, Strict order), its timing fields left out and its warnings compared too.
// A kind is compared only where both sides export its function. The inputs are the fixture with every built-in template
// (heuristic searches only: the core's branch-and-bound doesn't prove the fixture in reasonable time), then generated
// inventories: negative values, two-handers, worn pieces, rarity tie costs, hard and soft floors (some exactly at their
// min, some hard floors naming keys with no floor), floor bonuses and partial credit down to 0, mins, Resisting Spells and
// SSI steps, hard-floor bonuses from 5 to 1e10; eight searches each (plain, exact with alternatives, tie-break (half of
// them from a given top suit), Strict order, tie-break with alternatives, Strict order with a tie-break, few local-search
// passes, and the exact solver's final call: no restarts, a warm start and a top suit), the exact ones with a ten-minute
// budget. A core exact search that comes back unproven fails the check, since two runs cut by the clock can differ on the
// clock alone; so does an exact-solver build that differs and ran out of time (unproven, no guard warning).
//
//   node app/bench/compare-cores.mts [--base origin/main] [--generated 2000] [--exact 500]
//
// Prints a JSON summary and exits 1 when any output differs, any of the core's exact searches is unproven, or an
// exact-solver build differs because it ran out of time. An exact-solver build whose guards revoked the proof is counted
// and listed with its warnings (`exactUnprovenCases`), not failed.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import * as fx from "../solver-fixture.mts";

const { values: args } = parseArgs({ options: { base: { type: "string", default: "origin/main" }, generated: { type: "string", default: "2000" }, exact: { type: "string", default: "500" } } });
const whole = (flag: string, v: string): number => { const n = Number(v); if (!/^\d+$/.test(v) || !Number.isSafeInteger(n)) throw new Error(`--${flag} must be a whole number, not ${JSON.stringify(v)}`); return n; };
const base = args.base!, generated = whole("generated", args.generated!), exactRuns = whole("exact", args.exact!);

const ROOT = resolve(import.meta.dirname, "../..");
const dir = mkdtempSync(join(tmpdir(), "compare-cores-"));
execFileSync("sh", ["-c", `git archive "$0" app scripts | tar -x -C "$1"`, base, dir], { cwd: ROOT, stdio: ["ignore", "ignore", "inherit"] });
symlinkSync(join(ROOT, "node_modules"), join(dir, "node_modules"));
type Fn = (...a: unknown[]) => unknown;
type Side = Record<"core" | "mip" | "diag" | "lib" | "exact", Record<string, unknown>>;
const load = async (root: string): Promise<Side> => {
  const at = (p: string): Promise<Record<string, unknown>> => import(pathToFileURL(join(root, p)).href);
  return { core: await at("scripts/optimizer-core.mts"), mip: await at("app/mip.mts"), diag: await at("app/diagnostics.mts"), lib: await at("app/vault-lib.mts"), exact: await at("app/exact-solver.mts") };
};
const before = await load(dir), after = await load(ROOT);
// the copy stays until the end: the exact solver imports HiGHS on its first solve
process.on("exit", () => rmSync(dir, { recursive: true, force: true }));

const count: Record<string, [number, number]> = {};
const diffs: string[] = [], unproven: string[] = [];
// the first differing output's top-level keys whose values differ, to say where to look
let firstDiff: { label: string; keys: string[] } | undefined;
const exactUnproven: Array<Record<string, unknown>> = [];
let exactUnprovenCount = 0;
const keysThatDiffer = (a: unknown, b: unknown): string[] => {
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return ["(the whole value)"];
  const x = a as Record<string, unknown>, y = b as Record<string, unknown>;
  return [...new Set([...Object.keys(x), ...Object.keys(y)])].filter((k) => json(x[k]) !== json(y[k]));
};
const json = (v: unknown): string => JSON.stringify(v, (_k, x: unknown) => (x instanceof Float64Array ? Array.from(x) : x instanceof Set ? [...x] : x));
const call = (x: Side, m: keyof Side, fn: string, ...a: unknown[]): unknown => (x[m][fn] as Fn)(...a);
// One comparison: `uses` names the [module, function] pairs it needs on both sides; each side gets its own copy of `inputs`.
function cmp<I>(kind: string, label: string, uses: Array<[keyof Side, string]>, inputs: I, f: (x: Side, i: I) => unknown): void {
  if (!uses.every(([m, fn]) => typeof before[m][fn] === "function" && typeof after[m][fn] === "function")) return;
  const a = f(before, structuredClone(inputs)), b = f(after, structuredClone(inputs));
  const c = (count[kind] ||= [0, 0]);
  c[0]++;
  if (json(a) === json(b)) c[1]++;
  else { diffs.push(`${kind} ${label}`); firstDiff ??= { label: `${kind} ${label}`, keys: keysThatDiffer(a, b) }; }
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
const exactJobs: Array<{ label: string; inputs: { pools: unknown; current: unknown; profile: unknown; o: unknown } }> = [];
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
  // a worn two-hander leaves the one-hand slot empty: no player wears both, so no such suit is compared
  if ((current.twoHanded as { twoHanded?: boolean } | undefined)?.twoHanded) delete current.oneHanded;
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
  // a given top suit (the exact solver's hand-back passes one): a random piece per slot, or empty
  const randomSuit = (): Record<string, number | null> => Object.fromEntries(slots.map((s) => [s, rnd() < 0.2 ? null : (pools[s]![int(0, pools[s]!.length - 1)] as { serial: number }).serial]));
  const tieBreak = (): Record<string, unknown> => ({ tolerance: int(0, 1) * 3, fewestChanges: rnd() < 0.5, ...(rnd() < 0.5 ? { topStart: randomSuit() } : {}) });
  const strict = (): Record<string, unknown> => ({ ranks, fewestChanges: rnd() < 0.5 });
  const searches = [
    opts,
    { ...opts, exact: true, timeBudgetMs: 600000, alternatives: { count: 3, tolerance: int(0, 1) * 5 } },
    { ...opts, exact: rnd() < 0.5, timeBudgetMs: 600000, tieBreak: tieBreak() },
    { ...opts, exact: rnd() < 0.5, timeBudgetMs: 600000, strict: strict() },
    // the combinations: a tie-break with other suits, Strict order with a tie-break, and few local-search passes
    { ...opts, exact: true, timeBudgetMs: 600000, tieBreak: tieBreak(), alternatives: { count: 3, tolerance: int(0, 1) * 4 } },
    { ...opts, exact: rnd() < 0.5, timeBudgetMs: 600000, strict: strict(), tieBreak: tieBreak() },
    { ...opts, exact: rnd() < 0.5, timeBudgetMs: 600000, maxPasses: int(0, 1), tieBreak: tieBreak() },
    // the exact solver's own final call: no restarts, a warm start and a top suit to start the tie-break from
    { ...opts, restarts: 0, warmStart: randomSuit(), tieBreak: { ...tieBreak(), topStart: randomSuit() }, ...(rnd() < 0.4 ? { strict: strict() } : {}) },
  ];
  for (const [i, o] of searches.entries()) cmp("optimizeSuit", `gen${n}/${i}`, SEARCH, { pools, current, profile, o }, (x, a) => call(x, "core", "optimizeSuit", a.pools, a.current, a.profile, a.o));
  // the exact solver on the first --exact instances: plain, and each search above with exact on (HiGHS proves these small pools well inside the budget)
  if (n < exactRuns) for (const [i, o] of [{ ...opts, exact: true, timeBudgetMs: 600000 }, ...searches.slice(1).map((o) => ({ ...o, exact: true }))].entries()) exactJobs.push({ label: `gen${n}/${i}`, inputs: { pools, current, profile, o } });
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

// 3. the exact solver (app/exact-solver.mts solveExact) on the queued instances, the timing fields left out, its warnings compared too
const exactOf = async (x: Side, a: { pools: unknown; current: unknown; profile: unknown; o: unknown }): Promise<unknown> => {
  const warnings: string[] = [];
  const r = (await (x.exact.solveExact as Fn)({ core: x.core, pools: a.pools, current: a.current, profile: a.profile, opts: a.o, onProgress: () => {}, onWarn: (m: string) => warnings.push(m) })) as Record<string, unknown>;
  const { mipMs: _m, heuristicMs: _h, ...rest } = r;
  return { ...rest, warnings };
};
if (typeof before.exact.solveExact === "function" && typeof after.exact.solveExact === "function") {
  for (const { label, inputs } of exactJobs) {
    const a = await exactOf(before, structuredClone(inputs)), b = await exactOf(after, structuredClone(inputs));
    const c = (count.solveExact ||= [0, 0]);
    c[0]++;
    // a build its guards left unproven carries a warning; one unproven without any ran out of time
    const clockCut = (x: unknown): boolean => (x as { proven?: boolean; warnings: string[] }).proven === false && !(x as { warnings: string[] }).warnings.length;
    if (json(a) === json(b)) c[1]++;
    else if (clockCut(a) || clockCut(b)) unproven.push(`solveExact ${label} (out of time)`);   // the clock, not the code
    else { diffs.push(`solveExact ${label}`); firstDiff ??= { label: `solveExact ${label}`, keys: keysThatDiffer(a, b) }; }
    const r = b as { proven?: boolean; solver?: string; fallbackReason?: string; floorsConflict?: boolean; strictProven?: number; warnings: string[] };
    // An exact build its guards left unproven is listed, not failed: its warnings are compared byte for byte with the rest.
    if (r.proven === false && exactUnproven.length < 20) exactUnproven.push({ label: `solveExact ${label}`, solver: r.solver, fallbackReason: r.fallbackReason, strictProven: r.strictProven, warnings: r.warnings.slice(0, 2) });
    if (r.proven === false) exactUnprovenCount++;
  }
}

const runs = Object.values(count).reduce((t, [c]) => t + c, 0);
console.log(JSON.stringify({ base, fixtureRuns, generatedRuns: runs - fixtureRuns, runs, identical: runs - diffs.length, byKind: count, diffs: diffs.slice(0, 20), ...(firstDiff ? { firstDiff } : {}), unproven: unproven.slice(0, 20), exactUnproven: exactUnprovenCount, ...(exactUnproven.length ? { exactUnprovenCases: exactUnproven } : {}) }));
process.exitCode = diffs.length || unproven.length ? 1 : 0;
