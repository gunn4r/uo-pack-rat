// strict-order.test.mts — Strict order and fewest changes in both solvers, checked by hand and against brute force.
//
// Issue #292 part 2: the stages (the core's optStrictStages and the MIP's objective parts), hand-built cases (a lower goal never costs a higher one, linked ranks, a Swing speed rank scored by step, the spare-points stage, requirements first, a stage that runs out of time, fewest changes and its order with a rarity preference, and planBuild's options and run keys), and seeded brute-force fuzzes on small pools: (a) strict order's suit is the best stage by stage (no suit equal on the earlier stages is higher on a later one), (b) the core's exact search and HiGHS agree and both prove it, (c) fewest changes never lowers the score (Best value) or a stage (Strict order) and changes the fewest slots among the suits as good. The goals are compiled to weights as the app compiles them, and each fuzz checks that its generator makes the case matter often enough. The strict fuzz is `[fast]` (about a second), the fewest-changes fuzz `[slow]`; `STRICT_SEEDS` overrides the seeds.
import { test } from "node:test";
import assert from "node:assert/strict";
import { solveExact, type OptPools, type OptAssignment, type OptProfile } from "./exact-solver.mts";
import { core, fuzzSlots } from "./solver-fixture.mts";
import { buildSuitMip, stageObjective, tieCosts, changeCostFor, CHANGE_COST } from "./mip.mts";
import { solveModel as realSolveModel, type Handle, type SolveModelOptions } from "./mip-solve.mts";
import { compileGoals, type Goals, type OptItem } from "./vault-lib.mts";
import { buildSpec, planBuild } from "./build-spec.mts";
import { runKey } from "./runs-lib.mts";

type OptOptions = Parameters<typeof solveExact>[0]["opts"];
type Item = NonNullable<OptPools[string]>[number];
let serial = 1000;
const it = (slot: string, props: Record<string, number>, extra: Partial<Item> = {}): Item => ({ serial: ++serial, name: `${slot}${serial}`, slot, props, ...extra });
const weightsOf = (ranks: string[][], leftover: Goals["leftover"] = "none"): Record<string, number> => compileGoals({ ranks, leftover }).weights;
const strictOpts = (ranks: string[][], slots: string[], extra: Partial<OptOptions> = {}): OptOptions => ({ seed: 1, restarts: 4, slots, optionalSlots: slots, strict: { ranks }, ...extra });
async function both(pools: OptPools, current: OptAssignment, profile: OptProfile, opts: OptOptions): Promise<{ core: ReturnType<typeof core.optimizeSuit>; highs: Awaited<ReturnType<typeof solveExact>>; warnings: string[] }> {
  const c = core.optimizeSuit(pools, current, profile, { ...opts, exact: true, timeBudgetMs: 10000 });
  const warnings: string[] = [];
  const h = await solveExact({ core, pools, current, profile, opts: { ...opts, exact: true, timeBudgetMs: 10000 }, onProgress: () => {}, onWarn: (m) => warnings.push(m) });
  return { core: c, highs: h, warnings };
}
// the core's item shape as the MIP builder's (the same runtime objects; app/exact-solver.mts's header note)
const mipPools = (p: OptPools): Partial<Record<string, OptItem[]>> => p as unknown as Partial<Record<string, OptItem[]>>;
const mipSuit = (a: OptAssignment): Partial<Record<string, OptItem>> => a as unknown as Partial<Record<string, OptItem>>;
const serials = (a: OptAssignment): string => Object.entries(a).filter(([, x]) => x).map(([s, x]) => `${s}:${x!.serial}`).sort().join(" ");

// ---------------------------------------------------------------- the stages
test("[fast] strict order: the stages are the requirements, each rank scaled so its smallest weight is 1, soft partial credit, fewest changes, the tag penalty, then spare points", () => {
  const profile: OptProfile = { caps: {}, weights: { ssi: 7.5, hci: 10, dci: 10, di: 2.925, luck: 0.045, strBonus: 0.5, tagPenalty: -25 }, floors: { luck: 200, physResist: 60 }, hardFloors: ["physResist"] };
  const stages = core.optStrictStages(profile, [["ssi"], ["hci", "dci"], ["sk:magery"], ["di"]], true);
  assert.deepEqual(stages.map((s) => `${s.kind}:${s.keys?.join("=") ?? ""}`), ["requirements:", "goal:ssi", "goal:hci=dci", "goal:di", "softPartial:", "changes:", "tags:tagPenalty", "spare:luck=strBonus"]);
  assert.deepEqual(stages.map((s) => s.scale), [1, 1 / 7.5, 1 / 10, 1 / 2.925, 1, 1, 1 / 25, 1 / 0.045]);
  // no soft floor, no fewest changes, no tag penalty: none of their stages
  assert.deepEqual(core.optStrictStages({ caps: {}, weights: { hci: 10, luck: 0.045 }, floors: { physResist: 60 }, hardFloors: ["physResist"] }, [["hci"]]).map((s) => s.kind), ["requirements", "goal", "spare"]);
});

test("[fast] mip: the objective parts add up to the model's objective, and asking for them changes nothing else", () => {
  const ring = [it("ring", { hci: 8, luck: 40, fireResist: 5 }), it("ring", { hci: 3, dci: 6, tagPenalty: 1 }), it("ring", { fireResist: -4, di: 12 })];
  const neck = [it("neck", { dci: 7, fireResist: 9 }), it("neck", { hci: 2, luck: 120 })];
  const profile: OptProfile = { weights: { hci: 10, dci: 10, luck: 0.045, di: 2.9, fireResist: 1.5, tagPenalty: -25 }, caps: { hci: 10, fireResist: 8 }, mins: { fireResist: 2 },
    floors: { dci: 5, luck: 100, fireResist: 7 }, hardFloors: ["dci"], floorBonus: 1000 };
  const plain = buildSuitMip({ pools: mipPools({ ring, neck }), profile, slots: ["ring", "neck"], optionalSlots: ["ring", "neck"] });
  const split = buildSuitMip({ pools: mipPools({ ring, neck }), profile, slots: ["ring", "neck"], optionalSlots: ["ring", "neck"], parts: true });
  assert.deepEqual(split.model, plain.model);
  assert.equal(split.scoreOffset, plain.scoreOffset);
  const sum = new Array<number>(split.model.numCols).fill(0);
  let offset = 0;
  for (const p of [...Object.values(split.parts!.weights), split.parts!.floors, split.parts!.softPartial]) { p.cols.forEach((j, i) => { sum[j]! += p.costs[i]!; }); offset += p.offset; }
  sum.forEach((v, j) => assert.ok(Math.abs(v - split.model.colCost[j]!) < 1e-9, `column ${j}: parts ${v}, model ${split.model.colCost[j]}`));
  assert.ok(Math.abs(offset - split.scoreOffset) < 1e-9);
  // a stage's objective: the floors alone, or its properties' weights scaled
  const floors = stageObjective(split, { kind: "requirements", keys: null, scale: 1 }), hd = stageObjective(split, { kind: "goal", keys: ["hci", "dci"], scale: 0.1 });
  const soft = stageObjective(split, { kind: "softPartial", keys: null, scale: 1 });
  assert.ok(split.cols.every((c, j) => (soft.cost[j] === 0) === !(c.kind === "s" && c.dim !== "dci")), "the soft floors' partial credit, and only theirs");
  assert.equal(floors.offset, 1e7);   // the hard DCI floor
  assert.ok(split.cols.every((c, j) => (c.kind === "y" || c.kind === "s" ? true : floors.cost[j] === 0)), "the floors' stage scores only floor columns");
  assert.ok(hd.cost.some((v) => v !== 0) && split.cols.every((c, j) => hd.cost[j] === 0 || c.kind === "c" || c.kind === "x"));
});

// ---------------------------------------------------------------- hand-built cases
test("[fast] strict order: a lower goal never costs a higher one, where Best value trades a point of hit chance for damage", async () => {
  const ranks = [["hci"], ["di"]], weights = weightsOf(ranks);
  const a = it("ring", { hci: 5 }), b = it("ring", { hci: 4, di: 40 }), x = it("bracelet", { di: 10 }), y = it("bracelet", { di: 20 });
  const pools: OptPools = { ring: [a, b], bracelet: [x, y] }, profile: OptProfile = { weights, caps: { hci: 45, di: 100 } };
  const value = core.optimizeSuit(pools, {}, profile, { seed: 1, restarts: 4, slots: ["ring", "bracelet"], optionalSlots: ["ring", "bracelet"], exact: true });
  assert.equal(value.best.ring!.serial, b.serial, "Best value takes the big damage gain for one point of hit chance");
  const r = await both(pools, {}, profile, strictOpts(ranks, ["ring", "bracelet"]));
  assert.deepEqual(r.warnings, []);
  for (const res of [r.core, r.highs]) {
    assert.equal(res.proven, true);
    assert.equal(serials(res.best), serials({ ring: a, bracelet: y }), "the higher goal holds, and the lower one is the best it can be beside it");
    assert.deepEqual(res.lex, [0, 5, 20]);
  }
  assert.equal(r.highs.strictProven, 3);
  assert.equal(r.highs.bound, null);
});

test("[fast] strict order: linked goals share a stage and count by their importances; unlinked, the first wins", async () => {
  const a = it("ring", { hci: 10 }), b = it("ring", { hci: 6, dci: 6 });
  const pools: OptPools = { ring: [a, b] };
  const linked = [["hci", "dci"]], split = [["hci"], ["dci"]];
  const r1 = await both(pools, {}, { weights: weightsOf(linked), caps: {} }, strictOpts(linked, ["ring"]));
  assert.equal(r1.highs.best.ring!.serial, b.serial);
  assert.equal(r1.core.best.ring!.serial, b.serial);
  const r2 = await both(pools, {}, { weights: weightsOf(split), caps: {} }, strictOpts(split, ["ring"]));
  assert.equal(r2.highs.best.ring!.serial, a.serial);
  assert.equal(r2.core.best.ring!.serial, a.serial);
});

test("[fast] strict order: a Swing speed rank scored by step counts the step, not the SSI, so damage decides within a step", async () => {
  const ranks = [["ssi"], ["di"]], weights = weightsOf(ranks);
  const ssiSteps = [{ ssi: 10, stam: 0, credit: 10 }, { ssi: 20, stam: 0, credit: 20 }];
  const a = it("ring", { ssi: 15 }), b = it("ring", { ssi: 12, di: 30 }), c = it("ring", { ssi: 20 });
  const profile: OptProfile = { weights, caps: { ssi: 60 }, ssiSteps };
  const r = await both({ ring: [a, b] }, {}, profile, strictOpts(ranks, ["ring"]));
  assert.equal(r.highs.best.ring!.serial, b.serial, "15 and 12 SSI reach the same step");
  assert.equal(r.core.best.ring!.serial, b.serial);
  const r2 = await both({ ring: [a, b, c] }, {}, profile, strictOpts(ranks, ["ring"]));
  assert.equal(r2.highs.best.ring!.serial, c.serial, "a faster step wins over any damage");
  assert.equal(r2.core.best.ring!.serial, c.serial);
});

test("[fast] strict order: spare points only break ties among the goals, and requirements come first", async () => {
  const ranks = [["hci"]], weights = weightsOf(ranks, "luck");
  const a = it("ring", { hci: 5 }), b = it("ring", { hci: 5, luck: 100 }), c = it("ring", { hci: 4, luck: 500 });
  const pools: OptPools = { ring: [a, b, c] };
  const value = core.optimizeSuit(pools, {}, { weights, caps: {} }, { seed: 1, restarts: 4, slots: ["ring"], optionalSlots: ["ring"], exact: true });
  assert.equal(value.best.ring!.serial, c.serial, "Best value trades a point of hit chance for 400 Luck");
  const r = await both(pools, {}, { weights, caps: {} }, strictOpts(ranks, ["ring"]));
  assert.equal(r.highs.best.ring!.serial, b.serial);
  assert.equal(r.core.best.ring!.serial, b.serial);
  // a soft Luck requirement of 400 comes before every goal
  const r2 = await both(pools, {}, { weights, caps: {}, floors: { luck: 400 }, floorBonus: 1000 }, strictOpts(ranks, ["ring"]));
  assert.equal(r2.highs.best.ring!.serial, c.serial);
  assert.equal(r2.core.best.ring!.serial, c.serial);
});

test("[fast] strict order: getting closer to a soft requirement still missed never costs a goal; a hard one out of reach comes first", async () => {
  const ranks = [["hci"]], weights = weightsOf(ranks);
  const a = it("ring", { hci: 10 }), b = it("ring", { hci: 8, luck: 300 });
  const soft: OptProfile = { weights, caps: {}, floors: { luck: 1000 }, floorBonus: 1000 };
  const value = core.optimizeSuit({ ring: [a, b] }, {}, soft, { seed: 1, restarts: 4, slots: ["ring"], optionalSlots: ["ring"], exact: true });
  assert.equal(value.best.ring!.serial, b.serial, "Best value trades two points of hit chance for partial credit");
  const r = await both({ ring: [a, b] }, {}, soft, strictOpts(ranks, ["ring"]));
  assert.deepEqual(r.warnings, []);
  assert.equal(r.highs.best.ring!.serial, a.serial);
  assert.equal(r.core.best.ring!.serial, a.serial);
  const hard = await both({ ring: [a, b] }, {}, { ...soft, hardFloors: ["luck"] }, strictOpts(ranks, ["ring"]));
  assert.equal(hard.highs.best.ring!.serial, b.serial, "a hard requirement out of reach is brought as close as it goes");
  assert.equal(hard.core.best.ring!.serial, b.serial);
});

// The budget (review A-M2): a stage given less than it needs is solved again from its incumbent with what is left; one
// that runs out of time even then stops the sequence. `slow(n, limit)` says whether the n-th solve runs out of time at `limit`.
async function budgeted(slow: (n: number, limit: number) => boolean): Promise<{ r: Awaited<ReturnType<typeof solveExact>>; limits: number[] }> {
  const ranks = [["hci"], ["dci"], ["di"]], weights = weightsOf(ranks), limits: number[] = [];
  const pools: OptPools = { ring: [it("ring", { hci: 5, dci: 1 }), it("ring", { hci: 5, dci: 3 })], bracelet: [it("bracelet", { di: 4 }), it("bracelet", { dci: 2 })] };
  const solveModel = (h: Handle, o: SolveModelOptions) => { const res = realSolveModel(h, o); limits.push(o.timeLimitS!); return slow(limits.length, o.timeLimitS!) ? { ...res, status: "timeLimit" as const } : res; };
  const r = await solveExact({ core, pools, current: {}, profile: { weights, caps: {} }, opts: { ...strictOpts(ranks, ["ring", "bracelet"]), exact: true, timeBudgetMs: 10000 }, onProgress: () => {}, solveModel });
  return { r, limits };
}
test("[fast] strict order: a stage that needs more than its share gets it from the stages after it, and all are still proven", async () => {
  // the requirements stage has nothing to choose (no floors); defense chance, the second solve, needs 6 s of the 10 (its share is half)
  const { r, limits } = await budgeted((n, limit) => n === 2 && limit < 6);
  assert.equal(limits.length, 4, `defense chance ran twice: ${limits.join(", ")}`);
  assert.ok(limits[1]! < 6 && limits[2]! >= 6, `its share, then what is left: ${limits.join(", ")}`);
  assert.equal(r.proven, true);
  assert.equal(r.strictProven, 4);
});
test("[fast] strict order: a stage that runs out of time even with what is left stops the sequence, and the result says how many stages were proven", async () => {
  const { r, limits } = await budgeted((n) => n >= 2);
  assert.equal(limits.length, 3, "defense chance ran twice, and no stage after it");
  assert.ok(limits[2]! > 1.5 * limits[1]!, `the second try had all that was left: ${limits.join(", ")}`);
  assert.equal(r.proven, false);
  assert.equal(r.strictProven, 2);
  assert.equal(r.lex![1], 5, "the proven stage holds");
});

test("[fast] strict order: with every stage constant, the hard rows are still checked, and a conflict is found as in Best value", async () => {
  // review A-M1: Luck is the only goal and no piece has it, so no stage has anything to choose, but the hard floors conflict
  const ranks = [["luck"]], slots = ["ring"];
  const pools: OptPools = { ring: [it("ring", { hci: 10 }), it("ring", { dci: 10 })] };
  const profile: OptProfile = { weights: weightsOf(ranks), caps: {}, floors: { hci: 10, dci: 10 }, hardFloors: ["hci", "dci"] };
  for (const opts of [{ ...strictOpts(ranks, slots), strict: undefined }, strictOpts(ranks, slots)]) {
    const warnings: string[] = [];
    const r = await solveExact({ core, pools, current: {}, profile, opts: { ...opts, exact: true, timeBudgetMs: 10000 }, onProgress: () => {}, onWarn: (m) => warnings.push(m) });
    assert.equal(r.floorsConflict, true, opts.strict ? "strict" : "value");
    assert.deepEqual(warnings, []);
  }
});

test("[fast] strict order: two values of a linked rank a ninth of a point apart are told apart (the tolerance stays under the step)", async () => {
  // review A-L1: Hit chance (45) linked with Damage (100); 4 hit chance scales to 8.89 and 9 damage to 9, so the rank goes to
  // the damage ring although the next rank, Defense chance, prefers the other. A tolerance over 0.11 would get it wrong.
  const ranks = [["hci", "di"], ["dci"]], a = it("ring", { hci: 4, dci: 5 }), b = it("ring", { di: 9 });
  const r = await both({ ring: [a, b] }, {}, { weights: weightsOf(ranks), caps: {} }, strictOpts(ranks, ["ring"]));
  assert.deepEqual(r.warnings, [], "HiGHS holds the rank as the core does");
  assert.equal(r.core.best.ring!.serial, b.serial);
  assert.equal(r.highs.best.ring!.serial, b.serial);
});

test("[fast] strict order: other suits are the suits equal to the returned one on every stage, never the returned one itself", async () => {
  // review A-L2: two copies tie, a third piece is one hit chance short
  const ranks = [["hci"]], slots = ["ring"], a = it("ring", { hci: 5 }), b = it("ring", { hci: 5 }), c = it("ring", { hci: 4 });
  const r = await both({ ring: [a, b, c] }, {}, { weights: weightsOf(ranks), caps: {} }, strictOpts(ranks, slots, { alternatives: { count: 3, tolerance: 50 } }));
  for (const res of [r.core, r.highs]) {
    const alts = (res.alternatives || []).map((x) => x.best.ring!.serial);
    assert.equal(alts.length, 1, `${res === r.core ? "core" : "HiGHS"} ${JSON.stringify(alts)} ${(res as { altShortfall?: string }).altShortfall}`);
    assert.notEqual(alts[0], res.best.ring!.serial);
    assert.ok([a.serial, b.serial].includes(alts[0]!), "the copy, not the piece a point short, whatever the tolerance");
  }
});

test("[fast] fewest changes outranks any rarity sum, however long the rules' rarity ladder", async () => {
  // review A-L3: a worn piece costing 1,200 under a long ladder; a fixed change cost of 1,000 would swap it for one costing 0
  const r0 = it("ring", { hci: 5 }, { tieCost: 1200 }), r1 = it("ring", { hci: 5 }, { tieCost: 0 }), slots = ["ring"];
  const ranks = [["hci"]], profile: OptProfile = { weights: weightsOf(ranks), caps: {} };
  const r = await both({ ring: [r1] }, { ring: r0 }, profile, { seed: 1, restarts: 4, slots, optionalSlots: slots, tieBreak: { rarity: "lower", tolerance: 0, fewestChanges: true } });
  assert.deepEqual(r.warnings, []);
  for (const res of [r.core, r.highs]) assert.equal(res.best.ring!.serial, r0.serial);
  const built = buildSuitMip({ pools: mipPools({ ring: [r1] }), current: mipSuit({ ring: r0 }), profile, slots });
  assert.equal(changeCostFor(built), 19 * 1200 + 1);
  assert.equal(core.optChangeCost(1200), changeCostFor(built));
  assert.equal(core.optChangeCost(8), CHANGE_COST, "the shipped ladders keep 1,000");
});

test("[fast] fewest changes: among equally good suits, the one closest to what is worn, in both strategies and both solvers", async () => {
  const r0 = it("ring", { hci: 5 }), r1 = it("ring", { hci: 5 }), bw = it("bracelet", { luck: 1 }), b1 = it("bracelet", { hci: 5 }), b2 = it("bracelet", { hci: 5 });
  const pools: OptPools = { ring: [r1], bracelet: [b1, b2] }, current: OptAssignment = { ring: r0, bracelet: bw };
  const ranks = [["hci"]], profile: OptProfile = { weights: weightsOf(ranks), caps: { hci: 10 } };
  for (const strict of [false, true]) {
    // Best value: the tie-break's first part; strict order: a stage of its own
    const opts = strict ? strictOpts(ranks, ["ring", "bracelet"], { strict: { ranks, fewestChanges: true } }) : { ...strictOpts(ranks, ["ring", "bracelet"]), strict: undefined, tieBreak: { tolerance: 0, fewestChanges: true } };
    const r = await both(pools, current, profile, opts);
    assert.deepEqual(r.warnings, []);
    for (const res of [r.core, r.highs]) {
      assert.equal(res.best.ring!.serial, r0.serial, `${strict ? "strict" : "value"}: the worn ring stays`);
      assert.equal(core.optChanges(res.best, current, ["ring", "bracelet"]), 1);
      if (!strict) assert.equal(res.tieBreak!.changes, 1);
      assert.ok(Math.abs(res.score - 100) < 1e-6);
    }
    assert.ok(strict ? r.highs.strictProven === core.optStrictStages(profile, ranks, true).length : r.highs.tieBreak!.costProven);
  }
});

test("[fast] strict order: fewest changes and tagged pieces come before spare points, a soft requirement's closeness before both", async () => {
  const ranks = [["hci"]], weights = { ...weightsOf(ranks, "luck"), tagPenalty: -1 };
  const r0 = it("ring", { hci: 5 }), r1 = it("ring", { hci: 5, luck: 50 }), tagged = it("ring", { hci: 5, luck: 100, tagPenalty: 1 });
  const slots = ["ring"], profile: OptProfile = { weights, caps: {} };
  const pick = async (pools: OptPools, current: OptAssignment, p: OptProfile, opts: OptOptions): Promise<number> => {
    const r = await both(pools, current, p, opts);
    assert.deepEqual(r.warnings, []);
    assert.equal(r.core.best.ring?.serial, r.highs.best.ring?.serial, "the core and HiGHS agree");
    return r.highs.best.ring!.serial;
  };
  // fewest changes: Best value takes 50 Luck over keeping the worn ring (it breaks exact ties only), Strict order keeps it
  assert.equal(await pick({ ring: [r1] }, { ring: r0 }, profile, { ...strictOpts(ranks, slots), strict: undefined, tieBreak: { tolerance: 0, fewestChanges: true } }), r1.serial);
  assert.equal(await pick({ ring: [r1] }, { ring: r0 }, profile, strictOpts(ranks, slots, { strict: { ranks, fewestChanges: true } })), r0.serial);
  assert.equal(await pick({ ring: [r1] }, { ring: r0 }, profile, strictOpts(ranks, slots)), r1.serial, "without it, spare points decide");
  // a tagged piece is never worn for spare points alone, where Best value trades a tag for 100 Luck
  assert.equal(core.optimizeSuit({ ring: [r1, tagged] }, {}, profile, { seed: 1, restarts: 4, slots, optionalSlots: slots, exact: true }).best.ring!.serial, tagged.serial);
  assert.equal(await pick({ ring: [r1, tagged] }, {}, profile, strictOpts(ranks, slots)), r1.serial);
  // among suits equal on every goal, the one closer to a soft requirement still missed
  const near = it("ring", { hci: 5, luck: 700 }), far = it("ring", { hci: 5, luck: 300 }), soft: OptProfile = { weights: weightsOf(ranks), caps: {}, floors: { luck: 1000 }, floorBonus: 1000 };
  assert.equal(await pick({ ring: [far, near] }, {}, soft, strictOpts(ranks, slots)), near.serial);
  assert.equal(await pick({ ring: [far, near] }, { ring: far }, soft, strictOpts(ranks, slots, { strict: { ranks, fewestChanges: true } })), near.serial, "before fewest changes");
});

test("[fast] fewest changes comes before a rarity preference, which then picks among the suits that change as few", async () => {
  const r0 = it("ring", { hci: 5 }, { tieCost: 5 }), r1 = it("ring", { hci: 5 }, { tieCost: 0 }), bw = it("bracelet", { luck: 1 }, { tieCost: 0 }), b1 = it("bracelet", { hci: 5 }, { tieCost: 4 }), b2 = it("bracelet", { hci: 5 }, { tieCost: 2 });
  const pools: OptPools = { ring: [r1], bracelet: [b1, b2] }, current: OptAssignment = { ring: r0, bracelet: bw };
  const ranks = [["hci"]], profile: OptProfile = { weights: weightsOf(ranks), caps: { hci: 10 } };
  const base = { seed: 1, restarts: 4, slots: ["ring", "bracelet"], optionalSlots: ["ring", "bracelet"] };
  const rarity = await both(pools, current, profile, { ...base, tieBreak: { rarity: "lower", tolerance: 0 } });
  for (const res of [rarity.core, rarity.highs]) assert.equal(serials(res.best), serials({ ring: r1, bracelet: b2 }), "rarity alone swaps both pieces");
  const fewest = await both(pools, current, profile, { ...base, tieBreak: { rarity: "lower", tolerance: 0, fewestChanges: true } });
  assert.deepEqual(fewest.warnings, []);
  for (const res of [fewest.core, fewest.highs]) {
    assert.equal(serials(res.best), serials({ ring: r0, bracelet: b2 }), "the worn ring stays, then the lower-rarity bracelet");
    assert.equal(res.tieBreak!.changes, 1);
    assert.equal(res.tieBreak!.cost, 7);
  }
  // the MIP's tie costs: CHANGE_COST in a slot nobody wears, minus it for the worn piece
  const built = buildSuitMip({ pools: mipPools({ ...pools, neck: [it("neck", { hci: 1 })] }), current: mipSuit(current), profile, slots: ["ring", "bracelet", "neck"] });
  const costs = tieCosts(built, mipSuit(current)), byItem = new Map(built.cols.map((c, j) => [c.item?.serial, costs[j]]));
  assert.equal(byItem.get(r0.serial), 5 - CHANGE_COST);
  assert.equal(byItem.get(r1.serial), 0);
  assert.equal(byItem.get(built.xIndex.neck!.map((j) => built.cols[j]!.item!.serial)[0]), CHANGE_COST);
});

test("[fast] planBuild: strict order and fewest changes come from goals in force, and key the run apart", () => {
  const goals: Goals = { ranks: [["hci"], ["di"]], leftover: "luck" };
  const plan = (g: Goals) => planBuild(buildSpec({ intent: { goals: g, weights: compileGoals(g).weights } }), { character: null, worn: [] });
  assert.equal(plan(goals).opts.strict, undefined);
  assert.equal(plan(goals).opts.tieBreak, undefined);
  assert.deepEqual(plan({ ...goals, strategy: "strict" }).opts.strict, { ranks: [["hci"], ["di"]] });
  assert.deepEqual(plan({ ...goals, fewestChanges: true }).opts.tieBreak, { tolerance: 0, fewestChanges: true });
  // in strict order fewest changes is a stage, not the tie-break
  assert.deepEqual(plan({ ...goals, strategy: "strict", fewestChanges: true }).opts.strict, { ranks: [["hci"], ["di"]], fewestChanges: true });
  assert.equal(plan({ ...goals, strategy: "strict", fewestChanges: true }).opts.tieBreak, undefined);
  assert.equal(plan({ ...goals, strategy: "strict", ownWeights: true }).opts.strict, undefined, "own weights: the goals set nothing");
  const key = (g: Goals) => runKey({ profile: plan(g).profile, opts: plan(g).opts });
  assert.equal(new Set([key(goals), key({ ...goals, strategy: "value" }), key({ ...goals, strategy: "strict" }), key({ ...goals, fewestChanges: true }), key({ ...goals, strategy: "strict", fewestChanges: true })]).size, 4, "Best value keys as before, Strict order and fewest changes each key apart");
});

// ---------------------------------------------------------------- the fuzzes
const DIMS = ["hci", "dci", "di", "luck", "lmc"];
interface Instance { slots: string[]; optionalSlots: string[]; pools: OptPools; current: OptAssignment; profile: OptProfile; ranks: string[][] }
function generate(rnd: () => number): Instance {
  const int = (lo: number, hi: number): number => lo + Math.floor(rnd() * (hi - lo + 1));
  const mk = (slot: string): Item => {
    const props: Record<string, number> = {};
    for (const d of DIMS) if (rnd() < 0.5) props[d] = int(-4, 12);
    if (rnd() < 0.15) props.tagPenalty = 1;
    return it(slot, props, slot === "twoHanded" && rnd() < 0.5 ? { twoHanded: true } : {});
  };
  const slots = fuzzSlots(rnd, 4), optionalSlots = slots.filter(() => rnd() < 0.6);
  const pools: OptPools = {}, current: OptAssignment = {};
  for (const s of slots) {
    pools[s] = Array.from({ length: int(1, 3) }, () => mk(s));
    if (rnd() < 0.4) pools[s]!.push({ ...pools[s]![0]!, serial: ++serial });   // a copy: ties
    const r = rnd();
    if (r < 0.35) current[s] = pools[s]![int(0, pools[s]!.length - 1)]!;
    else if (r < 0.5) current[s] = mk(s);
  }
  if (current.twoHanded?.twoHanded === true) delete current.oneHanded;
  // goals: a random order of some properties, neighbours linked now and then; the rest of them may be spare points
  const order = DIMS.filter(() => rnd() < 0.75).sort(() => rnd() - 0.5), ranks: string[][] = [];
  for (const k of order) { if (ranks.length && rnd() < 0.3 && ranks.at(-1)!.length < 3) ranks.at(-1)!.push(k); else ranks.push([k]); }
  const leftover: Goals["leftover"] = rnd() < 0.5 ? "luck" : "none";
  const weights = compileGoals({ ranks, leftover }, rnd() < 0.5 ? { tagPenalty: -25 } : {}).weights;
  const caps: Record<string, number> = {}, floors: Record<string, number> = {};
  for (const d of DIMS) if (rnd() < 0.35) caps[d] = int(0, 20);
  for (const d of DIMS) if (rnd() < 0.25) floors[d] = int(2, 20);
  const hardFloors = Object.keys(floors).filter(() => rnd() < 0.3);
  return { slots, optionalSlots, pools, current, ranks, profile: { weights, caps, floors, hardFloors, floorBonus: rnd() < 0.5 ? 1000 : int(5, 60), floorPartial: 0.5 } };
}
function candidates({ slots, optionalSlots, pools, current }: Instance): Record<string, (Item | null)[]> {
  const out: Record<string, (Item | null)[]> = {};
  for (const s of slots) {
    const list: (Item | null)[] = [], seen = new Set<number>();
    for (const x of pools[s] || []) if (!seen.has(x.serial)) { seen.add(x.serial); list.push(x); }
    const cur = current[s];
    if (cur && !seen.has(cur.serial)) list.push(cur);
    if (optionalSlots.includes(s) || list.length === 0 || !cur) list.push(null);
    out[s] = list;
  }
  if (out.oneHanded && out.twoHanded && !out.oneHanded.includes(null)) out.twoHanded = out.twoHanded.filter((x) => !x || x.twoHanded !== true);
  return out;
}
// Every suit with its stage values, worked out independently of the solvers' stage code: the requirements (the profile with no weights, less a soft floor's partial credit), each rank's weighted properties, a soft floor's partial credit, with `fewest` the changes (fewer is higher), the tag penalty, then every other weight, each weights stage through the core's plain scoreSet.
interface Suit { a: OptAssignment; score: number; lex: number[]; changes: number; cost: number; met: string[] }
// `before`: how many stages come before the fewest-changes stage.
function allSuits(inst: Instance, fewest = false): Suit[] & { before: number } {
  const cands = candidates(inst), w = inst.profile.weights!, used = new Set(inst.ranks.flat()), tag = !used.has("tagPenalty") && w.tagPenalty;
  const weighted = (g: string[]): string[] => g.filter((k) => w[k]);
  const ranks = inst.ranks.map(weighted).filter((r) => r.length), spare = weighted(Object.keys(w).filter((k) => !used.has(k) && k !== "tagPenalty"));
  const floors = Object.entries(inst.profile.floors || {}), out: Suit[] = [], pick: OptAssignment = {};
  const hard = inst.profile.hardFloors || [], fb = inst.profile.floorBonus ?? 1000, fp = inst.profile.floorPartial ?? 0.5;
  const softPartial = (t: Record<string, number>): number => floors.filter(([k, f]) => !hard.includes(k) && (t[k] || 0) < f).reduce((n, [k, f]) => n + (fb * fp * Math.max(0, t[k] || 0)) / f, 0);
  const anySoft = floors.some(([k, f]) => f > 0 && !hard.includes(k));
  const weights = (g: string[]) => ({ ...inst.profile, weights: Object.fromEntries(g.map((k) => [k, w[k]!])), floors: {}, hardFloors: [] });
  const rec = (i: number): void => {
    if (i === inst.slots.length) {
      if (pick.twoHanded?.twoHanded === true && pick.oneHanded) return;
      const a = { ...pick }, totals: Record<string, number> = {};
      for (const x of Object.values(a)) if (x) for (const [k, v] of Object.entries(x.props)) totals[k] = (totals[k] || 0) + v;
      const changes = inst.slots.filter((s) => (a[s]?.serial ?? 0) !== (inst.current[s]?.serial ?? 0)).length;
      const lex = [core.scoreSet(a, { ...inst.profile, weights: {} }) - softPartial(totals), ...ranks.map((g) => core.scoreSet(a, weights(g))),
        ...(anySoft ? [softPartial(totals)] : []), ...(fewest ? [-changes] : []), ...(tag ? [core.scoreSet(a, weights(["tagPenalty"]))] : []), ...(spare.length ? [core.scoreSet(a, weights(spare))] : [])];
      out.push({ a, score: core.scoreSet(a, inst.profile), lex, cost: Object.values(a).reduce((n, x) => n + (x?.tieCost || 0), 0), changes, met: floors.filter(([k, f]) => (totals[k] || 0) >= f).map(([k]) => k) });
      return;
    }
    for (const x of cands[inst.slots[i]!]!) { pick[inst.slots[i]!] = x; rec(i + 1); }
  };
  rec(0);
  return Object.assign(out, { before: 1 + ranks.length + (anySoft ? 1 : 0) });
}
const EPS = 1e-6;
const lexCmp = (a: number[], b: number[]): number => { for (let i = 0; i < a.length; i++) { if (a[i]! > b[i]! + EPS) return 1; if (a[i]! < b[i]! - EPS) return -1; } return 0; };
const lexOfSuit = (suits: Suit[], a: OptAssignment): number[] => suits.find((s) => serials(s.a) === serials(a))!.lex;
// (a): for each stage k, no suit is equal to `best` on the stages before k and higher on stage k
function assertStrictBest(suits: Suit[], best: OptAssignment, label: string): void {
  const v = lexOfSuit(suits, best);
  for (let k = 0; k < v.length; k++) {
    const beat = suits.find((s) => s.lex.slice(0, k).every((x, i) => Math.abs(x - v[i]!) < EPS) && s.lex[k]! > v[k]! + EPS);
    assert.ok(!beat, `${label}: stage ${k}: ${serials(beat?.a ?? {})} reaches ${beat?.lex[k]} over ${v[k]} with the stages before it equal`);
  }
}
const SEEDS = (process.env.STRICT_SEEDS || "11,29,404").split(",").map(Number);
for (const seed of SEEDS) {
  test(`[fast] strict order fuzz: brute force agrees with the core's exact search and HiGHS, stage by stage, and the heuristic never passes it (seed ${seed})`, async () => {
    const rnd = core.optMulberry32(seed);
    let differs = 0;
    for (let i = 0; i < 200; i++) {
      const inst = generate(rnd), fewest = i % 3 === 0, label = `seed ${seed} instance ${i}${fewest ? " fewest changes" : ""}`, suits = allSuits(inst, fewest);
      const top = suits.reduce((b, s) => (lexCmp(s.lex, b.lex) > 0 ? s : b));
      // how often strict order changes the answer: no suit with Best value's best score is strict order's best
      const most = Math.max(...suits.map((s) => s.score));
      if (!suits.some((s) => s.score > most - EPS && lexCmp(s.lex, top.lex) === 0)) differs++;
      const opts: OptOptions = { seed: 1, restarts: 2, slots: inst.slots, optionalSlots: inst.optionalSlots, strict: { ranks: inst.ranks, ...(fewest ? { fewestChanges: true } : {}) } };
      const heur = core.optimizeSuit(inst.pools, inst.current, inst.profile, { ...opts, exact: false });
      assert.ok(lexCmp(lexOfSuit(suits, heur.best), top.lex) <= 0, `${label}: heuristic above the brute force`);
      const r = await both(inst.pools, inst.current, inst.profile, opts);
      assert.deepEqual(r.warnings, [], `${label}: HiGHS and the core disagree`);
      for (const [name, res] of [["core", r.core], ["HiGHS", r.highs]] as const) {
        assert.equal(res.proven, true, `${label}: ${name} did not prove`);
        assertStrictBest(suits, res.best, `${label} ${name}`);
        assert.equal(lexCmp(lexOfSuit(suits, res.best), top.lex), 0, `${label}: ${name} ${JSON.stringify(lexOfSuit(suits, res.best))}, brute force ${JSON.stringify(top.lex)}`);
        assert.ok(Math.abs(res.score - core.scoreSet(res.best, inst.profile)) < EPS, `${label}: ${name} score is not its suit's`);
      }
    }
    assert.ok(differs >= 20, `only ${differs} of 200 instances where strict order changes the answer: the generator is too tame`);
  });
}
for (const seed of SEEDS) {
  test(`[slow] fewest changes fuzz: never a lower score or stage, and the fewest changes among the suits as good, in both strategies (seed ${seed})`, async () => {
    const rnd = core.optMulberry32(seed + 1);
    let matters = 0;
    for (let i = 0; i < 150; i++) {
      const inst = generate(rnd), strict = i % 2 === 1, label = `seed ${seed} instance ${i} ${strict ? "strict" : "value"}`;
      // Best value: the tie-break's first part, before a rarity preference; strict order: a stage after the goals and soft partial credit
      const rarity = !strict && rnd() < 0.5;
      if (rarity) for (const s of inst.slots) for (const x of [...inst.pools[s]!, inst.current[s]]) if (x) x.tieCost = Math.floor(rnd() * 4);
      const plain = allSuits(inst), suits = strict ? allSuits(inst, true) : plain;
      const plainTop = plain.reduce((b, s) => ((strict ? lexCmp(s.lex, b.lex) > 0 : s.score > b.score + EPS) ? s : b));
      if (new Set(plain.filter((s) => (strict ? lexCmp(s.lex, plainTop.lex) === 0 : Math.abs(s.score - plainTop.score) < 1e-3)).map((s) => s.changes)).size > 1) matters++;   // the best suits change different numbers of slots
      const opts: OptOptions = { seed: 1, restarts: 2, slots: inst.slots, optionalSlots: inst.optionalSlots, ...(strict ? { strict: { ranks: inst.ranks, fewestChanges: true } } : { tieBreak: { ...(rarity ? { rarity: "lower" } : {}), tolerance: 0, fewestChanges: true } }) };
      const r = await both(inst.pools, inst.current, inst.profile, opts);
      assert.deepEqual(r.warnings, [], `${label}: HiGHS and the core disagree`);
      if (strict) {
        // every stage before the changes stage stays where strict order without fewest changes puts it, and the changes are the fewest
        const top = suits.reduce((b, s) => (lexCmp(s.lex, b.lex) > 0 ? s : b)), before = suits.before;
        for (const [name, res] of [["core", r.core], ["HiGHS", r.highs]] as const) {
          assert.equal(lexCmp(lexOfSuit(suits, res.best), top.lex), 0, `${label}: ${name} ${JSON.stringify(lexOfSuit(suits, res.best))}, brute force ${JSON.stringify(top.lex)}`);
          const got = lexOfSuit(plain, res.best);
          assert.equal(lexCmp(got.slice(0, before), plainTop.lex.slice(0, before)), 0, `${label}: ${name} gave up a stage for fewer changes`);
        }
        assert.ok(r.highs.proven, `${label}: HiGHS did not prove`);
        continue;
      }
      // Best value: the best suits, and for each set of floors they meet, the fewest changes (then the lowest tie cost) among suits as good meeting those floors
      const same = (s: Suit): boolean => Math.abs(s.score - plainTop.score) < 1e-3;
      const order = (s: Suit): number => s.changes * CHANGE_COST + (rarity ? s.cost : 0);
      const best = plain.filter(same).map((t) => Math.min(...plain.filter((s) => same(s) && t.met.every((m) => s.met.includes(m))).map(order)));
      for (const [name, res] of [["core", r.core], ["HiGHS", r.highs]] as const) {
        const got = plain.find((s) => serials(s.a) === serials(res.best))!;
        assert.ok(same(got), `${label}: ${name} gave up score for fewer changes (${got.score} vs ${plainTop.score})`);
        assert.equal(res.tieBreak!.changes, got.changes, `${label}: ${name} reports ${res.tieBreak!.changes} changes, the suit has ${got.changes}`);
        assert.ok(best.includes(order(got)), `${label}: ${name} ${got.changes} changes (order ${order(got)}), brute force ${JSON.stringify(best)}`);
      }
      assert.ok(r.highs.proven && r.highs.tieBreak!.costProven, `${label}: HiGHS did not prove`);
    }
    assert.ok(matters >= 20, `only ${matters} of 150 instances where the best suits change different numbers of slots: the generator is too tame`);
  });
}
