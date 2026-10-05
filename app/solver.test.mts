// solver.test.mts — solver-equivalence tests: HiGHS (app/exact-solver.mts, app/mip.mts,
// app/mip-solve.mts) must never disagree with the core's own exact branch-and-bound
// (scripts/optimizer-core.mts) about what the best suit is worth, only ever get there faster (or, on
// a real-sized inventory where neither proves in budget, no worse). Every "equal" assertion in this
// file compares HiGHS's re-scored result against the CORE's OWN numbers — never against the MIP's
// internal objective, which is on a different (offset) scale. The shared fixture and helpers are
// app/solver-fixture.mts; the default-template checks (app/solver-templates.test.mts) and the 3,000-item
// generated cell (app/solver-large.test.mts) have files of their own, so the runner runs them in parallel.
import { test } from "node:test";
import assert from "node:assert/strict";
import { effectiveProfile } from "./vault-lib.mts";
import { buffSkillValues, plannedProfile } from "./buffs.mts";
import { solveExact, type OptPools, type OptAssignment, type OptProfile } from "./exact-solver.mts";
import { solveModel as realSolveModel, type Handle, type SolveModelOptions } from "./mip-solve.mts";
import { BASE_OPTS, cell, core, defaultProfiles, runBoth, sig, templateNames, type OptOptions } from "./solver-fixture.mts";

// Like runBoth: the core's alternatives are only exact when its search proved within the time budget
// (about 10 s for this cell on a laptop, more on a CI runner), so an unproven core is checked for
// no-regression, rank by rank, instead of equality.
test("[slow] k-best matches the core's alternatives score for score; no alternative equals the best's serial set",
  { skip: process.env.TEST_SKIP_SLOW === "1" }, async (t) => {
  const name = templateNames[0]!;
  const { pools, current, profile } = cell(name);
  const opts: OptOptions = { ...BASE_OPTS, alternatives: { count: 3, tolerance: 1e9 } };
  const r = await solveExact({ core, pools, current, profile, opts, onProgress: () => {} });
  const ref = core.optimizeSuit(pools, current, profile, opts);
  assert.equal(r.solver, "highs");
  const rScores = (r.alternatives || []).map((a) => a.score).sort((a, b) => b - a);
  const refScores = (ref.alternatives || []).map((a) => a.score).sort((a, b) => b - a);
  assert.equal(rScores.length, refScores.length, `${rScores.length} highs alternatives vs ${refScores.length} core alternatives`);
  if (r.proven && ref.proven) {
    for (let i = 0; i < rScores.length; i++) assert.ok(Math.abs(rScores[i]! - refScores[i]!) < 1e-3, `alternative ${i}: ${rScores[i]} != ${refScores[i]}`);
  } else {
    t.diagnostic(`not both proven (highs proven=${r.proven}, core proven=${ref.proven}) — checking no-regression instead of equality`);
    for (let i = 0; i < rScores.length; i++) assert.ok(rScores[i]! >= refScores[i]! - 1e-6, `alternative ${i}: HiGHS ${rScores[i]} worse than the core's ${refScores[i]}`);
  }
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

// bugfix-pass-review.md Important #1, at the solveExact level: a REQUIRED ring slot (forced by
// `current`, not in optionalSlots) whose only two candidates are both negative in `fc`, paired with
// an optional neck slot whose only candidate is exactly the hard floor (fc: 2). Pre-fix,
// buildSuitMip's `reach` estimate let the required ring slot "contribute 0" as if leaving it empty
// were legal, read the floor as reachable (0 + 2 = 2 ≥ 2), and emitted a genuine hard row — the true
// infeasibility (the ring can only ever contribute -5 or -3, never 0) then only surfaced as HiGHS
// reporting the whole model `infeasible` on the first solve, costing a wasted solve plus a
// hardAsSoft retry (`floorsConflict: true`) for a floor that was never reachable, ring included or
// not. Fixed, buildSuitMip classifies `fc` unreachable up front (no hard row emitted at all), so the
// very first solve is feasible and no retry is needed — `floorsConflict` is the field that makes this
// observable without any new production hook (set true only when the FIRST solve comes back
// `infeasible`; see app/exact-solver.mts's own comment on the retry branch).
function requiredSlotNegativeFloorCell() {
  const ringA = { serial: 90201, name: "Draining Ring A", slot: "ring", props: { fc: -5 } };
  const ringB = { serial: 90202, name: "Draining Ring B", slot: "ring", props: { fc: -3 } };
  const neckItem = { serial: 90203, name: "Casting Neck", slot: "neck", props: { fc: 2 } };
  const pools = { ring: [ringA, ringB], neck: [neckItem] };
  const current = { ring: ringA };                     // forces the ring slot required: worn, and NOT in optionalSlots
  const slots = ["ring", "neck"];
  const optionalSlots = ["neck"];
  const profile = { weights: { fc: 1 }, caps: {}, floors: { fc: 2 }, hardFloors: ["fc"], floorBonus: 1000 };
  return { pools, current, profile, ringA, ringB, neckItem, slots, optionalSlots };
}

test("[fast] a hard floor unreachable only because a REQUIRED slot's candidates are all negative is flagged unreachable and needs no infeasible-then-hardAsSoft retry", async () => {
  const { pools, current, profile, ringA, ringB, neckItem, slots, optionalSlots } = requiredSlotNegativeFloorCell();
  const opts: OptOptions = { exact: true, timeBudgetMs: 5000, restarts: 20, seed: 1, slots, optionalSlots };
  const r = await solveExact({ core, pools, current, profile, opts, onProgress: () => {} });
  assert.ok(r.unreachableFloors.includes("fc"), JSON.stringify(r.unreachableFloors));
  assert.equal(r.floorsConflict, false, "buildSuitMip must classify this floor unreachable BEFORE the solve — no wasted infeasible/hardAsSoft round trip");
  assert.equal(r.solver, "highs");
  let coreBruteForce = -Infinity;
  for (const ring of [ringA, ringB]) for (const neck of [null, neckItem]) {   // ring has no "leave it empty" option: it is required
    coreBruteForce = Math.max(coreBruteForce, core.scoreSet({ ring, neck }, profile));
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

// Exhaustive maximum of the core's own scoreSet over every choice per slot (null = leave it empty).
function bruteMax(choices: Record<string, (NonNullable<OptPools[string]>[number] | null)[]>, profile: OptProfile): number {
  let best = -Infinity;
  const slots = Object.keys(choices);
  const rec = (i: number, pick: OptAssignment): void => {
    if (i === slots.length) { best = Math.max(best, core.scoreSet(pick, profile)); return; }
    for (const it of choices[slots[i]!]!) rec(i + 1, { ...pick, [slots[i]!]: it });
  };
  rec(0, {});
  return best;
}

// Regression (review C1): with a REACHABLE soft floor the met row forced the floored total ≥ 0 even
// when the floor was not met, so HiGHS proved the best suit with luck ≥ 0 optimal and never saw the
// better one at luck −11. (The existing negative-total test above uses an unreachable floor, which
// builds no met row at all, so it never exercised this.)
test("[fast] a reachable soft floor with a negative-total optimum: HiGHS proves the brute-force best", async () => {
  const hciRing = { serial: 90201, name: "Gambler's Ring", slot: "ring", props: { luck: -11, hci: 30 } };
  const luckRing = { serial: 90202, name: "Lucky Ring", slot: "ring", props: { luck: 18 } };
  const neck = { serial: 90203, name: "Plain Gorget", slot: "neck", props: { hci: 2, luck: 1 } };
  const pools = { ring: [hciRing, luckRing], neck: [neck] };
  const slots = ["ring", "neck"], optionalSlots = ["ring", "neck"];
  const profile = { weights: { hci: 1 }, caps: {}, floors: { luck: 18 }, hardFloors: [] as string[], floorBonus: 10 };
  const r = await solveExact({ core, pools, current: {}, profile, opts: { exact: true, timeBudgetMs: 5000, restarts: 0, seed: 1, slots, optionalSlots }, onProgress: () => {} });
  const oracle = bruteMax({ ring: [null, hciRing, luckRing], neck: [null, neck] }, profile);
  assert.equal(r.solver, "highs");
  assert.equal(r.proven, true, "a two-slot instance proves");
  assert.ok(Math.abs(r.score - oracle) < 1e-6, `HiGHS ${r.score} vs brute force ${oracle}`);
  assert.equal(r.best.ring?.serial, hciRing.serial);
});

// Regression (review I1): a negative weight on any capped property (every resist, hci, dci, fcr …
// carries a shard cap) made buildSuitMip throw, so the job died with an internal error.
test("[fast] a negative weight on a capped property: HiGHS proves the brute-force best", async () => {
  const rings = [
    { serial: 90301, name: "Dodgy Ring", slot: "ring", props: { dci: 20, hci: 4 } },
    { serial: 90302, name: "Steady Ring", slot: "ring", props: { dci: 5, hci: 3 } },
  ];
  const necks = [
    { serial: 90303, name: "Dodgy Gorget", slot: "neck", props: { dci: 12, hci: 9 } },
    { serial: 90304, name: "Clumsy Gorget", slot: "neck", props: { dci: -6, hci: 1 } },
  ];
  const slots = ["ring", "neck"], optionalSlots = ["ring", "neck"];
  const profile = { weights: { dci: -1, hci: 1 }, caps: { dci: 15, hci: 45 }, floors: {}, hardFloors: [] as string[] };
  const r = await solveExact({ core, pools: { ring: rings, neck: necks }, current: {}, profile, opts: { exact: true, timeBudgetMs: 5000, restarts: 0, seed: 1, slots, optionalSlots }, onProgress: () => {} });
  const oracle = bruteMax({ ring: [null, ...rings], neck: [null, ...necks] }, profile);
  assert.equal(r.solver, "highs");
  assert.equal(r.proven, true);
  assert.ok(Math.abs(r.score - oracle) < 1e-6, `HiGHS ${r.score} vs brute force ${oracle}`);
});

// Resist cap overrides (issue #44): a player building a suit for Reaper Form (−25 Fire) raises the Fire cap to
// 95, and both solvers must then value Fire past the shard's 70. Two Fire pieces make 95 Fire; one Fire piece and
// an HCI piece make 50 Fire + 30 HCI. At the shard's 70 the second Fire piece is worth only 20, so the HCI suit
// wins with Fire 50; at 95 it is worth 45 and the two Fire pieces win with Fire 95.
test("[fast] a raised Fire cap: both solvers take Fire past 70 when the cap is 95, and not at the shard's cap", async (t) => {
  const pools = {
    helmet: [{ serial: 90501, name: "Fire Helm", slot: "helmet", props: { fireResist: 50 } }],
    chest: [{ serial: 90502, name: "Fire Tunic", slot: "chest", props: { fireResist: 45 } }, { serial: 90503, name: "Keen Tunic", slot: "chest", props: { hci: 30 } }],
  };
  const slots = ["helmet", "chest"], optionalSlots = ["helmet", "chest"];
  const opts = { exact: true, timeBudgetMs: 5000, restarts: 5, seed: 1, slots, optionalSlots };
  for (const [resistCaps, fire, chest] of [[undefined, 50, 90503], [{ fireResist: 95 }, 95, 90502]] as const) {
    const profile = effectiveProfile({ weights: { fireResist: 1, hci: 1 }, resistCaps }, null) as OptProfile;
    const { r, ref } = await runBoth(t, { pools: pools as unknown as OptPools, current: {}, profile }, opts);
    assert.equal(r.proven && ref.proven, true);
    const fireOf = (a: OptAssignment): number => Object.values(a).reduce((n, it) => n + (it?.props.fireResist || 0), 0);
    assert.equal(fireOf(r.best), fire, `HiGHS: Fire ${fire} with caps ${JSON.stringify(resistCaps)}`);
    assert.equal(fireOf(ref.best), fire, `core: Fire ${fire} with caps ${JSON.stringify(resistCaps)}`);
    assert.equal(r.best.chest?.serial, chest);
    assert.equal(r.score, bruteMax({ helmet: [null, ...pools.helmet], chest: [null, ...pools.chest] }, profile), "and it is the brute-force best");
  }
});

// The equivalence on the real fixture, with overrides: every default template with Fire raised to 95 and Cold
// lowered to 60 proves through HiGHS to the core's own optimum.
test("[fast] resist cap overrides: HiGHS equals the core's proven optimum on each default template", async (t) => {
  for (const name of templateNames) {
    await t.test(name, async (t2) => { await runBoth(t2, cell(name, { overrides: { resistCaps: { fireResist: 95, coldResist: 60 } } }), BASE_OPTS); });
  }
});

// Issue #12: a buff planned on is a base the gear needn't supply. With Divine Fury's SSI +10, a 60 SSI requirement
// needs only 50 from gear, so the suit that gives up 10 SSI for 100 Luck wins; without it, it can't.
test("[fast] buffs: with Divine Fury on, both solvers pick the cheaper SSI suit that leaves room for Luck", async (t) => {
  const pools = {
    helmet: [{ serial: 91201, name: "Swift Helm", slot: "helmet", props: { ssi: 50 } }, { serial: 91202, name: "Lucky Helm", slot: "helmet", props: { ssi: 40, luck: 100 } }],
    chest: [{ serial: 91203, name: "Swift Tunic", slot: "chest", props: { ssi: 10 } }, { serial: 91204, name: "Lucky Tunic", slot: "chest", props: { luck: 50 } }],
  };
  const slots = ["helmet", "chest"], optionalSlots = ["helmet", "chest"];
  const opts = { exact: true, timeBudgetMs: 5000, restarts: 5, seed: 1, slots, optionalSlots };
  const p = { floors: { ssi: 60 }, weights: { luck: 1 } }, skills = { ...buffSkillValues(null, {}).values, Chivalry: 105 };
  for (const [on, helmet, luck] of [[[], 91201, 0], [["divineFury"], 91202, 100]] as const) {
    const profile = plannedProfile(p, null, { on: [...on], skills, stats: null, who: {}, worn: {} }) as OptProfile;
    const { r, ref } = await runBoth(t, { pools: pools as unknown as OptPools, current: {}, profile }, opts);
    assert.equal(r.proven && ref.proven, true);
    assert.equal(r.best.helmet?.serial, helmet, `HiGHS with ${on.join(", ") || "no buffs"}`);
    assert.equal(ref.best.helmet?.serial, helmet, `core with ${on.join(", ") || "no buffs"}`);
    assert.equal(Object.values(r.best).reduce((n, it) => n + (it?.props.luck || 0), 0), luck);
  }
});

// The equivalence on the real fixture with buffs whose shares are negative (Divine Fury's DCI), change a cap (Magic
// Reflection's Phys) and set one (Corpse Skin's Fire and Poison): the melee and tank templates both prove, to one score
// (the archer one takes the core past its budget, as without buffs).
test("[fast] buffs: HiGHS equals the core's proven optimum with buffs planned on", async (t) => {
  for (const name of ["melee", "tank"]) {
    await t.test(name, async (t2) => {
      const { r, ref } = await runBoth(t2, cell(name, { buffs: ["divineFury", "magicReflection", "corpseSkin"] }), BASE_OPTS);
      assert.equal(r.proven && ref.proven, true, "both proven, so runBoth held them to one score");
    });
  }
});

// Review M1: opts.slots narrowed the heuristic but not the MIP, which modelled every default slot —
// here the neck, which the core then refused to score, so the job failed on "re-score mismatch".
test("[fast] opts.slots narrows the MIP like the heuristic", async () => {
  const ring = { serial: 90401, name: "Ring", slot: "ring", props: { hci: 5 } };
  const neck = { serial: 90402, name: "Gorget", slot: "neck", props: { hci: 9 } };
  const r = await solveExact({ core, pools: { ring: [ring], neck: [neck] }, current: {}, profile: { weights: { hci: 1 }, caps: {} }, opts: { exact: true, timeBudgetMs: 5000, restarts: 0, seed: 1, slots: ["ring"], optionalSlots: ["ring"] }, onProgress: () => {} });
  assert.equal(r.proven, true);
  assert.equal(r.score, 5);
  assert.deepEqual(Object.keys(r.best), ["ring"]);
});

// Review M2: a HiGHS objective above the core's own re-score used to throw "re-score mismatch" and
// fail the job. It is a modelling disagreement like the neighbouring guards: warn, report unproven.
test("[fast] a HiGHS objective the core cannot reproduce is reported unproven with a warning, not thrown", async () => {
  const name = templateNames[0]!;
  const { pools, current, profile } = cell(name);
  const warnings: string[] = [];
  const inflated = (handle: Handle, o: SolveModelOptions) => { const r = realSolveModel(handle, o); return { ...r, objective: r.objective! + 50 }; };
  const r = await solveExact({ core, pools, current, profile, opts: { ...BASE_OPTS, timeBudgetMs: 5000 }, onProgress: () => {}, onWarn: (m) => warnings.push(m), solveModel: inflated });
  assert.equal(r.proven, false);
  assert.equal(r.bound, null, "an objective the core cannot reproduce bounds nothing");
  assert.ok(warnings.some((w) => /re-score mismatch/.test(w)), warnings.join(" | "));
  assert.ok(Math.abs(core.scoreSet(r.best, profile) - r.score) < 1e-6);
});

// Review I5: the budget is wall-clock for the whole job. The heuristic's restarts stop at half of it,
// every HiGHS call gets only what is left (no 1 s floor each), and the alternatives stop once it is spent.
test("[fast] timeBudgetMs bounds the heuristic's restarts", async () => {
  const name = templateNames[0]!;
  const { pools, current, profile } = cell(name);
  const t0 = Date.now();
  const r = await solveExact({ core, pools, current, profile, opts: { exact: true, timeBudgetMs: 1000, restarts: 1e7, seed: 1 }, onProgress: () => {} });
  const ms = Date.now() - t0;
  assert.ok(r.heuristicMs < 1000, `the heuristic took ${r.heuristicMs} ms of a 1000 ms budget`);
  assert.ok(ms < 5000, `the whole job took ${ms} ms on a 1000 ms budget`);
});

test("[fast] HiGHS calls and alternatives share the remaining budget", async () => {
  const rings = [1, 2, 3, 4].map((i) => ({ serial: 90500 + i, name: `Ring ${i}`, slot: "ring", props: { hci: i } }));
  const necks = [1, 2, 3].map((i) => ({ serial: 90510 + i, name: `Gorget ${i}`, slot: "neck", props: { hci: i } }));
  let clock = 0;
  const limits: { at: number; limitS: number }[] = [];
  const timed = (handle: Handle, o: SolveModelOptions) => { limits.push({ at: clock, limitS: o.timeLimitS! }); const r = realSolveModel(handle, o); clock += 400; return r; };
  const r = await solveExact({ core, pools: { ring: rings, neck: necks }, current: {}, profile: { weights: { hci: 1 }, caps: {} },
    opts: { exact: true, timeBudgetMs: 1000, restarts: 0, seed: 1, slots: ["ring", "neck"], optionalSlots: ["ring", "neck"], alternatives: { count: 10, tolerance: 1e9 } },
    onProgress: () => {}, solveModel: timed, now: () => clock });
  for (const { at, limitS } of limits) assert.ok(limitS <= (1000 - at) / 1000 + 1e-9, `a call at ${at} ms got ${limitS} s`);
  assert.equal(limits.length, 3, "the first solve at 0 ms plus alternatives at 400 and 800 ms; none once 1000 ms are spent");
  assert.equal(r.alternatives!.length, 2);
  assert.equal(r.altShortfall, "budget", "the result says why there are fewer than the 10 asked for");
});

test("[fast] alternatives: a met count carries no shortfall; running out of suits or tolerance says so", async () => {
  const rings = [1, 2].map((i) => ({ serial: 90600 + i, name: `Ring ${i}`, slot: "ring", props: { hci: 10 * i } }));
  const run = (count: number, tolerance: number) => solveExact({ core, pools: { ring: rings }, current: {}, profile: { weights: { hci: 1 }, caps: {} },
    opts: { exact: true, timeBudgetMs: 60000, restarts: 0, seed: 1, slots: ["ring"], optionalSlots: ["ring"], alternatives: { count, tolerance } }, onProgress: () => {} });
  assert.equal((await run(1, 1e9)).altShortfall, undefined);
  assert.equal((await run(10, 1e9)).altShortfall, "exhausted", "only three suits exist: either ring, or none");
  assert.equal((await run(10, 5)).altShortfall, "tolerance");
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

test("[fast] progress reports the exact phase with a finite bound or none", async () => {
  const name = templateNames[0]!;
  const { pools, current, profile } = cell(name);
  const events: Parameters<Parameters<typeof solveExact>[0]["onProgress"]>[0][] = [];
  await solveExact({ core, pools, current, profile, opts: BASE_OPTS, onProgress: (p) => events.push(p) });
  const exactEvents = events.filter((e) => e.phase === "exact");
  assert.ok(exactEvents.length > 0, "expected at least one exact-phase progress event");
  for (const e of exactEvents) {
    assert.equal(typeof e.bestScore, "number");
    // HiGHS's first events can carry an Infinity dual bound (none established yet): that is reported as no bound.
    assert.ok(e.bound === null || Number.isFinite(e.bound), `bound ${e.bound}`);
    assert.ok(e.bound === null ? e.gapPoints === null : e.gapPoints! >= 0);
    assert.equal(e.solver, "highs");
  }
});
