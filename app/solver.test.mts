// solver.test.mts — solver-equivalence tests: HiGHS (app/exact-solver.mts, app/mip.mts,
// app/mip-solve.mts) must never disagree with the core's own exact branch-and-bound
// (scripts/optimizer-core.mts) about what the best suit is worth, only ever get there faster (or, on
// a real-sized inventory where neither proves in budget, no worse). Every "equal" assertion in this
// file compares HiGHS's re-scored result against the CORE's OWN numbers — never against the MIP's
// internal objective, which is on a different (offset) scale.
import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { buildPools, effectiveProfile, setRules, foldSnapshots, type ProfilesFile, type Template } from "./vault-lib.mts";
import * as VaultLib from "./vault-lib.mts";
import { upgradeScan } from "./scan-schema.mts";
import type { ScanV2 } from "./schema/types.d.mts";
import { corePath } from "./config.mts";
import { solveExact, type OptPools, type OptAssignment, type OptProfile } from "./exact-solver.mts";
import { DEFAULT_SLOTS } from "./mip.mts";
import { learnModel, generateScan } from "./bench/gen-inventory.mjs";
import type * as Core from "../scripts/optimizer-core.mts";

// solveExact's own `opts` field type (the core's real OptOptions, derived rather than restated —
// see app/exact-solver.mts's header note and scripts/optimizer-core.test.mts for the pattern).
type OptOptions = Parameters<typeof solveExact>[0]["opts"];

const HERE = dirname(fileURLToPath(import.meta.url));
// This file's own vault-lib.mts import is a separate module instance from the one the server
// dynamically re-imports per request — a direct call to a rules-aware function (buildPools,
// effectiveProfile) needs its own setRules(), same as gear-vault.test.mjs / server.test.mjs.
setRules(JSON.parse(readFileSync(join(HERE, "rules", "uoalive.json"), "utf8")));

const core = (await import(pathToFileURL(corePath()).href)) as typeof Core;

// The TazUO fixture (Task 1's adapter fixture): 319 real items, character "Fixture". Already
// schemaVersion 2 — upgradeScan just stamps the shard.
const fixtureRaw = JSON.parse(readFileSync(join(HERE, "..", "adapters", "tazuo", "fixture.scan.json"), "utf8"));
const fixture = upgradeScan(fixtureRaw, { shard: "uoalive" }) as ScanV2;   // known-good fixture: the cast stands in for the validateScan() a real caller runs
const inv = foldSnapshots([fixture]);
const { pools: fixturePools, current: fixtureCurrent } = buildPools(inv, "Fixture", { excludeGargoyle: true });
const defaultProfiles = JSON.parse(readFileSync(join(HERE, "data", "profiles.default.json"), "utf8")) as ProfilesFile;
const templateNames = Object.keys(defaultProfiles.templates!);

// cell(profileName, {soft, overrides}) — the fixture's pools/current, plus a profile built from one
// of the shipped default templates: `overrides` land on the template (before effectiveProfile), so
// e.g. `{ overrides: { floors: { ...template.floors, luck: 5000 } } }` adds an extra hard floor.
//
// fixturePools/fixtureCurrent are vault-lib.mts's OptItem-based shapes (buildPools's own return
// type); the core's own OptItem (unexported, derived via Parameters<>/ReturnType<> on
// Core.optimizeSuit — see app/exact-solver.mts's header note) is structurally a shade stricter in
// places (e.g. a required, non-null `slot`) even though every value here is the same runtime
// object either way, so the cast is the one place this file crosses that boundary.
function cell(profileName: string, { soft = [], overrides = {} }: { soft?: string[] | undefined; overrides?: Partial<Template> | undefined } = {}): { pools: OptPools; current: OptAssignment; profile: OptProfile } {
  const template = defaultProfiles.templates![profileName]!;
  const p = { ...template, softFloors: [...soft], ...overrides };
  const profile = effectiveProfile(p, inv.characters.Fixture!);
  return { pools: fixturePools as unknown as OptPools, current: fixtureCurrent as unknown as OptAssignment, profile };
}

const sig = (assignment: OptAssignment | null | undefined): string => DEFAULT_SLOTS.map((s) => (assignment && assignment[s] ? assignment[s]!.serial : null)).join(",");

// Runs both solvers on the same inputs and checks the shared invariants: HiGHS reports itself as
// the solver, and its returned score is the core's own re-score of its own suit (never a value
// computed only inside the MIP). When both sides prove, their scores must agree to the decimal; on
// the real 319-item fixture a template is not guaranteed to prove in budget, so an unproven side
// only has to be no worse than the core (never a regression) — noted via t.diagnostic rather than
// failed, since that outcome is a timing fact about the machine, not a bug.
async function runBoth(t: TestContext, { pools, current, profile }: { pools: OptPools; current: OptAssignment; profile: OptProfile }, opts: OptOptions) {
  const r = await solveExact({ core, pools, current, profile, opts, onProgress: () => {} });
  const ref = core.optimizeSuit(pools, current, profile, opts);
  assert.equal(r.solver, "highs");
  assert.ok(Math.abs(core.scoreSet(r.best, profile) - r.score) < 1e-6, "returned score must be the core's own re-score of its own suit");
  if (r.proven && ref.proven) {
    assert.ok(Math.abs(r.score - ref.score) < 1e-3, `HiGHS ${r.score} != core ${ref.score}`);
  } else {
    t.diagnostic(`not both proven (highs proven=${r.proven}, core proven=${ref.proven}) — checking no-regression instead of equality`);
    assert.ok(r.score >= ref.score - 1e-6, `HiGHS ${r.score} worse than the core's ${ref.score}`);
  }
  return { r, ref };
}

const BASE_OPTS: OptOptions = { exact: true, timeBudgetMs: 20000, restarts: 50, seed: 2026 };

test("[fast] each default template: HiGHS equals the core's proven optimum on the fixture", async (t) => {
  for (const name of templateNames) {
    await t.test(name, async (t2) => { await runBoth(t2, cell(name), BASE_OPTS); });
  }
});

test("[fast] soft floors match", async (t) => {
  const name = templateNames[0]!;
  const floorKeys = Object.keys(defaultProfiles.templates![name]!.floors);
  const soft = floorKeys.slice(0, 2);
  assert.ok(soft.length === 2, `template ${name} needs at least two floors for this test`);
  await runBoth(t, cell(name, { soft }), BASE_OPTS);
});

test("[fast] k-best matches the core's alternatives score for score; no alternative equals the best's serial set", async () => {
  const name = templateNames[0]!;
  const { pools, current, profile } = cell(name);
  const opts: OptOptions = { ...BASE_OPTS, alternatives: { count: 3, tolerance: 1e9 } };
  const r = await solveExact({ core, pools, current, profile, opts, onProgress: () => {} });
  const ref = core.optimizeSuit(pools, current, profile, opts);
  assert.equal(r.solver, "highs");
  const rScores = (r.alternatives || []).map((a) => a.score).sort((a, b) => b - a);
  const refScores = (ref.alternatives || []).map((a) => a.score).sort((a, b) => b - a);
  assert.equal(rScores.length, refScores.length, `${rScores.length} highs alternatives vs ${refScores.length} core alternatives`);
  for (let i = 0; i < rScores.length; i++) assert.ok(Math.abs(rScores[i]! - refScores[i]!) < 1e-3, `alternative ${i}: ${rScores[i]} != ${refScores[i]}`);
  const bestSig = sig(r.best);
  for (const a of r.alternatives!) assert.notEqual(sig(a.best), bestSig, "an alternative must never equal the best's own serial set");
});

test("[fast] an unreachable hard floor scores the core's partial credit", async (t) => {
  const name = templateNames[0]!;
  const template = defaultProfiles.templates![name]!;
  const cellInput = cell(name, { overrides: { floors: { ...template.floors, luck: 5000 } } });
  const { r, ref } = await runBoth(t, cellInput, BASE_OPTS);
  assert.ok(r.unreachableFloors.includes("luck"), JSON.stringify(r.unreachableFloors));
  assert.equal(r.proven, true);
  void ref;
});

// Synthetic pools, deliberately not the fixture: a ring item that meets the physResist floor but
// craters fireResist, and a bracelet item that meets the fireResist floor but craters physResist —
// each floor's per-slot maxima (buildSuitMip's own "reach" check, which optimistically assumes every
// slot could contribute independently) says it is individually reachable, but no single suit can
// wear either piece without failing the other floor, and wearing neither fails both. A third,
// property-free slot is folded in purely so the MIP isn't a bare 2-column toy ("structure").
function jointlyUnreachableCell() {
  const ringItem = { serial: 90001, name: "Phys Ring", slot: "ring", props: { physResist: 10, fireResist: -1000 } };
  const braceletItem = { serial: 90002, name: "Fire Bracelet", slot: "bracelet", props: { fireResist: 10, physResist: -1000 } };
  const neckItem = { serial: 90003, name: "Plain Neck", slot: "neck", props: {} };
  const pools = { ring: [ringItem], bracelet: [braceletItem], neck: [neckItem] };
  const current = {};
  const slots = ["ring", "bracelet", "neck"];
  const optionalSlots = ["ring", "bracelet", "neck"];
  const profile = { weights: { physResist: 1, fireResist: 1 }, caps: {}, floors: { physResist: 10, fireResist: 10 }, hardFloors: ["physResist", "fireResist"], floorBonus: 1000 };
  return { pools, current, profile, ringItem, braceletItem, neckItem, slots, optionalSlots };
}

test("[fast] jointly unreachable hard floors fall back honestly", async () => {
  const { pools, current, profile, ringItem, braceletItem, neckItem, slots, optionalSlots } = jointlyUnreachableCell();
  const opts: OptOptions = { exact: true, timeBudgetMs: 5000, restarts: 20, seed: 1, slots, optionalSlots };
  const r = await solveExact({ core, pools, current, profile, opts, onProgress: () => {} });
  assert.equal(r.floorsConflict, true);
  assert.equal(r.solver, "highs", "the hardAsSoft retry must still solve through HiGHS, not fall back to the heuristic");
  assert.ok(!r.unreachableFloors.includes("physResist") && !r.unreachableFloors.includes("fireResist"), "each floor is individually reachable per-slot — only the JOINT combination is impossible");
  let coreBruteForce = -Infinity;
  for (const ring of [null, ringItem]) for (const bracelet of [null, braceletItem]) for (const neck of [null, neckItem]) {
    coreBruteForce = Math.max(coreBruteForce, core.scoreSet({ ring, bracelet, neck }, profile));
  }
  assert.ok(Math.abs(r.score - coreBruteForce) < 1e-3, `${r.score} vs brute force ${coreBruteForce}`);
});

test("[fast] a negative total on a soft-floored dimension gets zero credit, like the core", async (t) => {
  const item = { serial: 90101, name: "Draining Ring", slot: "ring", props: { manaRegen: -3, hci: 50 } };
  const pools = { ring: [item] };
  const current = {};
  const slots = ["ring"];
  const optionalSlots = ["ring"];
  const profile = { weights: { manaRegen: 1, hci: 1 }, caps: {}, floors: { manaRegen: 2 }, hardFloors: [] as string[], floorBonus: 1000 };
  const opts: OptOptions = { exact: true, timeBudgetMs: 5000, restarts: 20, seed: 1, slots, optionalSlots };
  const { r } = await runBoth(t, { pools, current, profile }, opts);
  assert.equal(r.best.ring?.serial, item.serial, "the item is worth taking despite the unmet soft floor");
});

test("[fast] HiGHS unavailable → the heuristic result, flagged", async () => {
  const name = templateNames[0]!;
  const { pools, current, profile } = cell(name);
  const opts: OptOptions = { ...BASE_OPTS, timeBudgetMs: 5000 };
  const r = await solveExact({ core, pools, current, profile, opts, onProgress: () => {}, loadHighs: async () => { throw new Error("nope"); } });
  assert.equal(r.solver, "fallback");
  assert.equal(r.method, "heuristic");
  assert.match(r.fallbackReason!, /nope/);
  const ref = core.optimizeSuit(pools, current, profile, { ...opts, exact: false });
  assert.equal(sig(r.best), sig(ref.best), "same seed/restarts through the same heuristic search must land on the same suit");
});

// Regression for a review finding (fix round 1): a plain HiGHS timeout with no incumbent at all
// (status "timeLimit", colValue null) must never be reported as a floors conflict — that mislabels
// an ordinary resource limit as "no suit satisfies the required floors," which is false whenever the
// profile has no floors trouble at all (as here: the first default template's own floors are all
// individually and jointly reachable on the fixture). Only a genuine `status === "infeasible"` may
// ever set floorsConflict. Stubs solveModel (the injectable alongside loadHighs) so this is
// deterministic rather than depending on timing a real HiGHS solve down to a knife's edge.
test("[fast] a plain solver timeout with no incumbent is reported honestly, not as a floors conflict", async () => {
  const name = templateNames[0]!;
  const { pools, current, profile } = cell(name);
  const opts: OptOptions = { ...BASE_OPTS, timeBudgetMs: 5000 };
  const stubSolveModel = () => ({ status: "timeLimit" as const, statusText: "timeLimit", objective: null, primal: null, dual: null, gapAbs: null, nodes: 3, colValue: null, ms: 1 });
  const r = await solveExact({ core, pools, current, profile, opts, onProgress: () => {}, solveModel: stubSolveModel });
  assert.equal(r.solver, "highs");
  assert.equal(r.method, "exact");
  assert.equal(r.proven, false);
  assert.equal(r.floorsConflict, false);
  assert.equal(r.fallbackReason, undefined);
  assert.equal(r.bound, null);
  assert.equal(r.gapPoints, null);
  assert.equal(r.nodes, 3);
  const heur = core.optimizeSuit(pools, current, profile, { ...opts, exact: false, restarts: opts.restarts! });   // opts is always BASE_OPTS-derived here, restarts always set
  assert.equal(sig(r.best), sig(heur.best), "the heuristic's own suit is the best known when HiGHS never found an incumbent");
});

// Same stubbed-timeout scenario, but with a dual bound the (stubbed) solver DID manage to report
// before running out of time — bound/gapPoints must come from it, on the score scale.
test("[fast] a plain solver timeout still reports a bound when the solver found one", async () => {
  const name = templateNames[0]!;
  const { pools, current, profile } = cell(name);
  const opts: OptOptions = { ...BASE_OPTS, timeBudgetMs: 5000 };
  const stubSolveModel = () => ({ status: "timeLimit" as const, statusText: "timeLimit", objective: null, primal: null, dual: 123.5, gapAbs: null, nodes: 7, colValue: null, ms: 1 });
  const r = await solveExact({ core, pools, current, profile, opts, onProgress: () => {}, solveModel: stubSolveModel });
  assert.equal(r.solver, "highs");
  assert.equal(r.floorsConflict, false);
  assert.equal(typeof r.bound, "number");
  assert.ok(Math.abs(r.gapPoints! - (r.bound! - r.score)) < 1e-9);
});

// Regression for a review finding (Important 2): the MIP start only guarantees HiGHS never regresses
// from the heuristic FROM that starting point on — a `timeLimit` result can still hand back a feasible
// incumbent worse than the heuristic (the warm start declined, rejected on tolerance, or lost to the
// hardAsSoft retry). Stub solveModel to return exactly that: status "timeLimit", a real (non-null)
// colValue that picks nothing in any slot — the worst feasible incumbent available — and an objective
// far below the heuristic's own score. solveExact must not report this regression: it falls back to
// the heuristic's own suit and can never claim to be proven.
test("[fast] the exact result never scores below the heuristic, even on a poor timeLimit incumbent", async () => {
  const name = templateNames[0]!;
  const { pools, current, profile } = cell(name);
  const opts: OptOptions = { ...BASE_OPTS, timeBudgetMs: 5000 };
  const heur = core.optimizeSuit(pools, current, profile, { ...opts, exact: false, restarts: opts.restarts! });   // opts is always BASE_OPTS-derived here, restarts always set
  const stubSolveModel = (handle: { built: { model: { numCols: number } } }) => {
    const colValue = new Float64Array(handle.built.model.numCols);   // every column 0: nothing picked anywhere
    return { status: "timeLimit" as const, statusText: "timeLimit", objective: -1e9, primal: -1e9, dual: null, gapAbs: null, nodes: 5, colValue, ms: 1 };
  };
  const r = await solveExact({ core, pools, current, profile, opts, onProgress: () => {}, solveModel: stubSolveModel });
  assert.equal(r.solver, "highs");
  assert.equal(r.proven, false, "a result the invariant had to override can never be reported as proven");
  assert.ok(r.score >= heur.score - 1e-6, `exact ${r.score} must be no worse than the heuristic ${heur.score}`);
});

test("[fast] progress reports the exact phase with a bound", async () => {
  const name = templateNames[0]!;
  const { pools, current, profile } = cell(name);
  const events: Parameters<Parameters<typeof solveExact>[0]["onProgress"]>[0][] = [];
  await solveExact({ core, pools, current, profile, opts: BASE_OPTS, onProgress: (p) => events.push(p) });
  const exactEvents = events.filter((e) => e.phase === "exact");
  assert.ok(exactEvents.length > 0, "expected at least one exact-phase progress event");
  for (const e of exactEvents) {
    assert.equal(typeof e.bestScore, "number");
    assert.equal(typeof e.bound, "number");
    assert.ok(e.gapPoints! >= 0);
    assert.equal(e.solver, "highs");
  }
});

test("[slow] a 3,000-item generated cell: HiGHS proves and the core agrees where it proves",
  { skip: process.env.TEST_SKIP_SLOW === "1" }, async () => {
    const model = learnModel([fixture], VaultLib);
    const genRaw = generateScan(model, { n: 3000, gearFraction: 1, seed: 7, lib: VaultLib });
    const genScan = upgradeScan(genRaw, { shard: "uoalive" }) as ScanV2;   // known-good generated scan: same cast as `fixture` above
    const bigInv = foldSnapshots([fixture, genScan]);
    const { pools, current } = buildPools(bigInv, "Fixture", { excludeGargoyle: true });
    const name = templateNames[0]!;
    const profile = effectiveProfile(defaultProfiles.templates![name], bigInv.characters.Fixture!);
    const opts: OptOptions = { exact: true, timeBudgetMs: 60000, restarts: 50, seed: 2026 };
    const r = await solveExact({ core, pools: pools as unknown as OptPools, current: current as unknown as OptAssignment, profile, opts, onProgress: () => {} });
    assert.equal(r.solver, "highs");
    assert.ok(r.proven, "HiGHS should prove within the 60s budget on a 3,000-item pool");
    assert.ok(r.mipMs < 20000, `mipMs was ${r.mipMs}, expected under 20000`);
    const ref = core.optimizeSuit(pools as unknown as OptPools, current as unknown as OptAssignment, profile, opts);
    if (ref.proven) assert.ok(Math.abs(r.score - ref.score) < 1e-3, `${r.score} vs ${ref.score}`);
    else assert.ok(r.score >= ref.score - 1e-6, `HiGHS ${r.score} worse than the core's ${ref.score}`);
  });
