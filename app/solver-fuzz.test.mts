// solver-fuzz.test.mts — a seeded brute-force equivalence check of all three searches over small generated inventories.
//
// a seeded brute-force equivalence check: five fixed seeds × 400 generated inventories of two to six of the nineteen gear slots (`solver-fixture.mts`'s `fuzzSlots`, the hand pair together in about half; 1–4 candidates each, negative property values, negative weights on capped and floored properties, soft and hard floors, worn and locked slots, a random warm start (which must never empty a locked slot), shields and two-handers), each enumerated outright so the maximum of the core's `scoreSet` is the oracle. The heuristic must return a valid suit scoring its own re-score and never above the oracle; the core's exact search and `solveExact` (HiGHS) must both prove and equal the oracle, with HiGHS's bound never below its score. A second loop does the same with SSI scored by swing step (a step table from `app/swing.mts` over random weapon speeds, stamina, reference stamina and buff shares, on pools carrying SSI and the Stamina pool), with an oracle that prices each suit's own swing from the formula rather than the table, and checks the core's `scoreSet` against it suit by suit. A third loop (issue #262) gives every piece a tie cost 0-8, leans the generator toward ties (capped properties, copies of a piece at another cost), draws the floor bonus from 5-60 two times in three so a soft floor can be traded within the tolerance, and takes tolerances 0, 3, 50, 200, 700 and 1500: its oracle is the best score, then the lowest summed cost among suits within the tolerance that meet every floor a best suit meets; the core's exact search and `solveExact` must prove and equal it (HiGHS with its rarity choice proven too, and no warning), and the heuristic must return a valid suit within the tolerance of its own best, never cheaper than the oracle when its best is the true one. A fourth loop (issue #311) takes soft-floor bonuses up to 1e6, fractional weights up to about 1e6 per point, SSI step tables, the rarity and fewest-changes tie-breaks and all-hard (often conflicting) floors, runs the profile through `withHardFloorBonus`, and checks over every suit that one meeting more hard floors scores strictly higher, with both exact searches proving the brute-force best on a suit meeting the most hard floors, that the fixed 1e7 alone breaks that order in some instances, and that a bound past the cap builds at it with requirement_outweighed. A fifth loop (issue #316) scores past 1e10, from eleven hard floors at a bonus near the cap or from weights near 1e6 a point alone, in Best value and Strict order, and both exact searches must prove and agree to the relative slack (`slackAt`). The first two loops, the fourth and the fifth are `[fast]` (about 10 s and 2 s), the third `[slow]`; the first loop is what caught the soft-floor met row forbidding negative totals and the core's pruning on negatively weighted floors.
//
// The three searches are the core's heuristic (a valid suit, never above the oracle), the core's exact branch-and-bound (proven, equal to the oracle), and `solveExact` through HiGHS (proven, equal to the oracle, bound never below its own score). The generator leans on the cases that broke before.
import { test } from "node:test";
import assert from "node:assert/strict";
import { solveExact, type OptPools, type OptAssignment, type OptProfile } from "./exact-solver.mts";
import { core, fuzzSlots } from "./solver-fixture.mts";
import { HARD_FLOOR_BONUS_MAX, hardFloorBonusFor, propertyReach, slackAt, withHardFloorBonus } from "./mip.mts";
import { requirementScaleDiagnostics } from "./diagnostics.mts";
import { stepTable, swingTicks } from "./swing.mts";
import type { OptItem } from "./vault-lib.mts";
const SCORE_SLACK = 1e-6;   // == app/exact-solver.mts SCORE_EPS

type OptOptions = Parameters<typeof solveExact>[0]["opts"];
type Item = NonNullable<OptPools[string]>[number];

const DIMS = ["hci", "dci", "luck", "mr", "fc"];

interface Instance { slots: string[]; optionalSlots: string[]; pools: OptPools; current: OptAssignment; profile: OptProfile }

function generate(rnd: () => number, serialBase: number): Instance {
  const int = (lo: number, hi: number): number => lo + Math.floor(rnd() * (hi - lo + 1));
  const pickSome = <T,>(list: T[], p: number): T[] => list.filter(() => rnd() < p);
  let serial = serialBase;
  const mkItem = (slot: string): Item => {
    const props: Record<string, number> = {};
    for (const d of pickSome(DIMS, 0.5)) props[d] = int(-12, 25);
    const it: Item = { serial: ++serial, name: `item${serial}`, slot, props };
    if (slot === "twoHanded" && rnd() < 0.5) it.twoHanded = true;
    return it;
  };
  const slots = fuzzSlots(rnd, 6);
  const optionalSlots = pickSome(slots, 0.5);
  const pools: OptPools = {}, current: OptAssignment = {};
  for (const s of slots) {
    pools[s] = Array.from({ length: int(1, 4) }, () => mkItem(s));
    const r = rnd();
    if (r < 0.3) current[s] = pools[s]![int(0, pools[s]!.length - 1)]!;   // worn and in the pool
    else if (r < 0.5) current[s] = mkItem(s);                              // worn, not in the pool (keep what you wear)
  }
  if (current.twoHanded?.twoHanded === true) delete current.oneHanded;      // nobody wears a one-hander beside a two-hander
  const weights: Record<string, number> = {}, caps: Record<string, number> = {}, floors: Record<string, number> = {};
  for (const d of DIMS) {
    weights[d] = int(-2, 3);
    if (rnd() < 0.35) caps[d] = int(0, 30);
  }
  for (const d of pickSome(DIMS, 0.35)) floors[d] = int(3, 40);
  const hardFloors = pickSome(Object.keys(floors), 0.3);
  return { slots, optionalSlots, pools, current, profile: { weights, caps, floors, hardFloors, floorBonus: 1000, floorPartial: rnd() < 0.5 ? 0.5 : 0.25 } };
}

// The core's candidate rules, restated independently: the pool plus the worn piece (deduplicated by
// serial), plus "empty" when the slot is optional, has nothing, or has nothing worn; a two-handed
// weapon empties the one-handed layer, so it is no candidate at all while that layer is locked.
function candidates({ slots, optionalSlots, pools, current }: Instance): Record<string, (Item | null)[]> {
  const out: Record<string, (Item | null)[]> = {};
  for (const s of slots) {
    const list: (Item | null)[] = [], seen = new Set<number>();
    for (const it of pools[s] || []) if (it.slot === s && !seen.has(it.serial)) { seen.add(it.serial); list.push(it); }
    const cur = current[s];
    if (cur && cur.slot === s && !seen.has(cur.serial)) list.push(cur);
    if (optionalSlots.includes(s) || list.length === 0 || !cur) list.push(null);
    out[s] = list;
  }
  if (out.oneHanded && out.twoHanded && !out.oneHanded.includes(null)) out.twoHanded = out.twoHanded.filter((it) => !it || it.twoHanded !== true);
  return out;
}

function bruteForce(inst: Instance, cands: Record<string, (Item | null)[]>): number {
  let best = -Infinity;
  const pick: OptAssignment = {};
  const rec = (i: number): void => {
    if (i === inst.slots.length) {
      if (pick.twoHanded?.twoHanded === true && pick.oneHanded) return;
      best = Math.max(best, core.scoreSet(pick, inst.profile));
      return;
    }
    const s = inst.slots[i]!;
    for (const it of cands[s]!) { pick[s] = it; rec(i + 1); }
  };
  rec(0);
  return best;
}

function assertValidSuit(inst: Instance, cands: Record<string, (Item | null)[]>, best: OptAssignment, label: string): void {
  for (const s of inst.slots) {
    const it = best[s] || null;
    assert.ok(cands[s]!.some((c) => (c ? c.serial : null) === (it ? it.serial : null)), `${label}: ${s} holds a non-candidate`);
  }
  assert.ok(!(best.twoHanded?.twoHanded === true && best.oneHanded), `${label}: two-hander worn with a one-handed piece`);
}

const EPS = 1e-6;
const SEEDS = [3, 7, 23, 101, 2026];
const PER_SEED = 400;

for (const seed of SEEDS) {
  test(`[fast] brute force agrees with the heuristic, the core's exact search and HiGHS (seed ${seed})`, async () => {
    const rnd = core.optMulberry32(seed);
    for (let i = 0; i < PER_SEED; i++) {
      const inst = generate(rnd, seed * 100000 + i * 100);
      const label = `seed ${seed} instance ${i}`;
      const cands = candidates(inst);
      const oracle = bruteForce(inst, cands);
      // a warm start from an "earlier run": per slot a piece of the pool, one no longer anywhere, or nothing (a locked
      // slot whose piece the warm start lacks must still keep its own)
      const warmStart = Object.fromEntries(inst.slots.map((s) => { const r = rnd(), pool = inst.pools[s] || []; return [s, r < 0.4 && pool.length ? pool[Math.floor(rnd() * pool.length)]!.serial : r < 0.7 ? 999999 : null]; }));
      const base: OptOptions = { seed: 1, restarts: 2, slots: inst.slots, optionalSlots: inst.optionalSlots, warmStart };

      const heur = core.optimizeSuit(inst.pools, inst.current, inst.profile, { ...base, exact: false });
      assertValidSuit(inst, cands, heur.best, `${label} heuristic`);
      assert.ok(Math.abs(heur.score - core.scoreSet(heur.best, inst.profile)) < EPS, `${label}: heuristic score is not its own re-score`);
      assert.ok(heur.score <= oracle + EPS, `${label}: heuristic ${heur.score} above the brute-force maximum ${oracle}`);

      const exact = core.optimizeSuit(inst.pools, inst.current, inst.profile, { ...base, exact: true, timeBudgetMs: 5000 });
      assertValidSuit(inst, cands, exact.best, `${label} core exact`);
      assert.equal(exact.proven, true, `${label}: the core's exact search did not prove a tiny instance`);
      assert.ok(Math.abs(exact.score - oracle) < EPS, `${label}: core exact ${exact.score} != brute force ${oracle}`);

      const r = await solveExact({ core, ...inst, opts: { ...base, exact: true, timeBudgetMs: 10000 }, onProgress: () => {} });
      assertValidSuit(inst, cands, r.best, `${label} HiGHS`);
      assert.equal(r.solver === "highs" || r.solver === "none", true, `${label}: solver ${r.solver} (${r.fallbackReason})`);
      assert.ok(Math.abs(r.score - core.scoreSet(r.best, inst.profile)) < EPS, `${label}: HiGHS score is not the core's re-score`);
      assert.equal(r.proven, true, `${label}: HiGHS did not prove a tiny instance (score ${r.score}, brute force ${oracle}, bound ${r.bound})`);
      assert.ok(Math.abs(r.score - oracle) < 1e-3, `${label}: HiGHS ${r.score} != brute force ${oracle}`);
      if (r.bound != null) assert.ok(r.bound >= r.score - 1e-3, `${label}: bound ${r.bound} below the returned score ${r.score}`);
    }
  });
}

// SSI by swing step. The oracle does not read the step table: it scores the suit with SSI's weight taken off (its floor stays) and adds the weight times what the suit's own swing costs in gear SSI at the reference stamina.
interface SwingCase { speed: number; stamBase: number; refStamina: number; share: number }
function stepInstance(rnd: () => number, serialBase: number): Instance & { swing: SwingCase } {
  const inst = generate(rnd, serialBase);
  const int = (lo: number, hi: number): number => lo + Math.floor(rnd() * (hi - lo + 1));
  for (const s of inst.slots) for (const it of [...(inst.pools[s] || []), inst.current[s]].filter((x): x is Item => !!x)) {
    if (rnd() < 0.6) it.props.ssi = int(-5, 25);
    if (rnd() < 0.5) it.props.stamPool = int(-3, 20);
  }
  const swing = { speed: [2.5, 3.25, 3.5, 4][int(0, 3)]!, stamBase: int(40, 130), refStamina: 0, share: [-10, 0, 0, 10, 15][int(0, 4)]! };
  swing.refStamina = swing.stamBase + int(0, 30);
  const reach = propertyReach(inst.pools as Partial<Record<string, OptItem[]>>, inst.current as Partial<Record<string, OptItem | null>>, inst.optionalSlots, inst.slots, ["stamPool", "ssi"]);
  const profile = { ...inst.profile, weights: { ...inst.profile.weights, ssi: int(1, 8) }, ssiSteps: stepTable({ speedS: swing.speed, stamBase: swing.stamBase, refStamina: swing.refStamina, share: swing.share, stamRange: reach.stamPool!, ssiMax: reach.ssi!.max }) };
  if (rnd() < 0.3) profile.caps = { ...profile.caps, ssi: int(10, 60) };   // a cap plays no part once SSI is scored by step
  if (rnd() < 0.3) { profile.floors = { ...profile.floors, ssi: int(5, 30) }; if (rnd() < 0.5) profile.hardFloors = [...(profile.hardFloors || []), "ssi"]; }
  return { ...inst, profile, swing };
}
function stepOracleScore(inst: Instance & { swing: SwingCase }, pick: OptAssignment): number {
  const { weights = {}, ssiSteps: _table, ...rest } = inst.profile;
  const plain = core.scoreSet(pick, { ...rest, weights: { ...weights, ssi: 0 } });
  const t = { ssi: 0, stamPool: 0 };
  for (const it of Object.values(pick)) if (it) { t.ssi += it.props.ssi || 0; t.stamPool += it.props.stamPool || 0; }
  const { speed, stamBase, refStamina, share } = inst.swing;
  const ticks = swingTicks(speed, stamBase + t.stamPool, Math.min(60, t.ssi + share));
  const nRef = Math.round(4 * speed) - Math.floor(refStamina / 30);
  return plain + (weights.ssi || 0) * Math.max(0, Math.floor((100 * nRef) / (ticks + 1)) - 99 - share);
}

for (const seed of [5, 41, 777]) {
  test(`[fast] SSI by swing step: brute force agrees with the core's scoreSet, its exact search and HiGHS (seed ${seed})`, async () => {
    const rnd = core.optMulberry32(seed);
    for (let i = 0; i < 200; i++) {
      const inst = stepInstance(rnd, seed * 100000 + i * 100);
      const label = `seed ${seed} instance ${i}`;
      const cands = candidates(inst);
      let oracle = -Infinity;
      const pick: OptAssignment = {};
      const rec = (k: number): void => {
        if (k === inst.slots.length) {
          if (pick.twoHanded?.twoHanded === true && pick.oneHanded) return;
          const want = stepOracleScore(inst, pick), got = core.scoreSet(pick, inst.profile);
          assert.ok(Math.abs(want - got) < EPS, `${label}: scoreSet ${got} != the swing's own ${want} for ${JSON.stringify(Object.values(pick).map((x) => x && x.props))}`);
          oracle = Math.max(oracle, want);
          return;
        }
        const s = inst.slots[k]!;
        for (const it of cands[s]!) { pick[s] = it; rec(k + 1); }
      };
      rec(0);
      const base: OptOptions = { seed: 1, restarts: 2, slots: inst.slots, optionalSlots: inst.optionalSlots };
      const exact = core.optimizeSuit(inst.pools, inst.current, inst.profile, { ...base, exact: true, timeBudgetMs: 5000 });
      assert.equal(exact.proven, true, `${label}: the core's exact search did not prove`);
      assert.ok(Math.abs(exact.score - oracle) < EPS, `${label}: core exact ${exact.score} != brute force ${oracle}`);
      const r = await solveExact({ core, ...inst, opts: { ...base, exact: true, timeBudgetMs: 10000 }, onProgress: () => {} });
      assertValidSuit(inst, cands, r.best, `${label} HiGHS`);
      assert.equal(r.proven, true, `${label}: HiGHS did not prove (score ${r.score}, brute force ${oracle})`);
      assert.ok(Math.abs(r.score - oracle) < 1e-3, `${label}: HiGHS ${r.score} != brute force ${oracle}`);
      if (r.bound != null) assert.ok(r.bound >= r.score - 1e-3, `${label}: bound ${r.bound} below the returned score ${r.score}`);
    }
  });
}

// A tie-break (issue #262): every piece carries a tie cost 0-8, and the oracle enumerates every suit: the best score,
// then, per set of floors a best-scoring suit meets, the lowest summed cost among the suits within the tolerance of it
// that meet those floors. The generator leans toward ties: capped properties and copies of a piece at another cost.
function tieInstance(rnd: () => number, serialBase: number): Instance {
  const inst = generate(rnd, serialBase);
  const int = (lo: number, hi: number): number => lo + Math.floor(rnd() * (hi - lo + 1));
  let serial = serialBase + 50;
  for (const s of inst.slots) {
    const pool = inst.pools[s]!;
    if (rnd() < 0.6) pool.push({ ...pool[int(0, pool.length - 1)]!, serial: ++serial, name: `copy${serial}` });
    for (const it of pool) it.tieCost = int(0, 8);
    const cur = inst.current[s];
    if (cur && !pool.includes(cur)) cur.tieCost = int(0, 8);
  }
  for (const d of DIMS) if (rnd() < 0.3) inst.profile.caps = { ...inst.profile.caps, [d]: int(0, 15) };
  // a small floor bonus (5-60) two times in three, so a suit can trade a soft floor for other points within the tolerance
  if (rnd() < 2 / 3) inst.profile.floorBonus = int(5, 60);
  return inst;
}
// Seeds 4, 5, 8 and 59 each failed on the first version (HiGHS and the core disagreeing on a suit that meets one more soft
// floor, or on which best suit's floors to hold); 2027 is where the review's own fuzz found the second. TIE_SEEDS overrides.
const TIE_SEEDS = (process.env.TIE_SEEDS || "4,5,8,59,2027").split(",").map(Number);
interface TieOracle { top: number; byMet: { met: string[]; cost: number }[] }
function tieOracle(inst: Instance, cands: Record<string, (Item | null)[]>, tolerance: number): TieOracle {
  const suits: { score: number; cost: number; totals: Record<string, number> }[] = [];
  const pick: OptAssignment = {};
  const rec = (i: number): void => {
    if (i === inst.slots.length) {
      if (pick.twoHanded?.twoHanded === true && pick.oneHanded) return;
      const totals: Record<string, number> = {};
      let cost = 0;
      for (const it of Object.values(pick)) if (it) { cost += it.tieCost || 0; for (const [k, v] of Object.entries(it.props)) totals[k] = (totals[k] || 0) + v; }
      suits.push({ score: core.scoreSet(pick, inst.profile), cost, totals });
      return;
    }
    const s = inst.slots[i]!;
    for (const it of cands[s]!) { pick[s] = it; rec(i + 1); }
  };
  rec(0);
  const top = Math.max(...suits.map((x) => x.score)), floors = Object.entries(inst.profile.floors || {}).filter(([, f]) => f > 0);
  const metOf = (t: Record<string, number>): string[] => floors.filter(([k, f]) => (t[k] || 0) >= f).map(([k]) => k);
  const byMet: { met: string[]; cost: number }[] = [];
  for (const s of suits.filter((x) => x.score >= top - EPS)) {
    const met = metOf(s.totals);
    if (byMet.some((b) => b.met.join() === met.join())) continue;
    const ok = suits.filter((x) => x.score >= top - tolerance - 1e-3 && met.every((k) => (x.totals[k] || 0) >= inst.profile.floors![k]!));
    byMet.push({ met, cost: Math.min(...ok.map((x) => x.cost)) });
  }
  return { top, byMet };
}
function assertTieResult(inst: Instance, cands: Record<string, (Item | null)[]>, r: { best: OptAssignment; score: number; tieBreak?: { topScore: number; cost: number } | undefined }, o: TieOracle, tolerance: number, label: string): void {
  assertValidSuit(inst, cands, r.best, label);
  assert.ok(r.tieBreak, `${label}: no tieBreak in the result`);
  const cost = Object.values(r.best).reduce((n, it) => n + (it?.tieCost || 0), 0);
  assert.equal(r.tieBreak!.cost, cost, `${label}: reported cost ${r.tieBreak!.cost} is not the suit's ${cost}`);
  assert.ok(Math.abs(r.tieBreak!.topScore - o.top) < 1e-3, `${label}: top ${r.tieBreak!.topScore} != brute force ${o.top}`);
  assert.ok(r.score >= o.top - tolerance - 1e-3, `${label}: score ${r.score} more than ${tolerance} under the top ${o.top}`);
  const totals: Record<string, number> = {};
  for (const it of Object.values(r.best)) if (it) for (const [k, v] of Object.entries(it.props)) totals[k] = (totals[k] || 0) + v;
  const match = o.byMet.find((b) => b.met.every((k) => (totals[k] || 0) >= inst.profile.floors![k]!));
  assert.ok(match, `${label}: the suit gave up a floor every best suit meets`);
  assert.ok(o.byMet.some((b) => b.cost === cost && b.met.every((k) => (totals[k] || 0) >= inst.profile.floors![k]!)), `${label}: cost ${cost}, brute force ${JSON.stringify(o.byMet)}`);
}

for (const seed of TIE_SEEDS) {
  test(`[slow] tie-break: brute force agrees with the core's exact search and HiGHS, the heuristic stays valid (seed ${seed})`, async () => {
    const rnd = core.optMulberry32(seed);
    for (let i = 0; i < 300; i++) {
      const inst = tieInstance(rnd, seed * 100000 + i * 100);
      const tolerance = [0, 0, 3, 50, 200, 700, 1500][i % 7]!;
      const label = `seed ${seed} instance ${i} tolerance ${tolerance}`;
      const cands = candidates(inst);
      const o = tieOracle(inst, cands, tolerance);
      const base: OptOptions = { seed: 1, restarts: 2, slots: inst.slots, optionalSlots: inst.optionalSlots, tieBreak: { rarity: "lower", tolerance } };

      const heur = core.optimizeSuit(inst.pools, inst.current, inst.profile, { ...base, exact: false });
      assertValidSuit(inst, cands, heur.best, `${label} heuristic`);
      assert.ok(heur.tieBreak && heur.score >= heur.tieBreak.topScore - tolerance - 1e-3, `${label}: heuristic suit outside the tolerance of its own top`);
      assert.ok(heur.tieBreak!.topScore <= o.top + EPS, `${label}: heuristic top above the brute-force maximum`);
      if (Math.abs(heur.tieBreak!.topScore - o.top) < EPS && o.byMet.length === 1) assert.ok(heur.tieBreak!.cost >= o.byMet[0]!.cost, `${label}: heuristic cost under the brute-force minimum`);

      const exact = core.optimizeSuit(inst.pools, inst.current, inst.profile, { ...base, exact: true, timeBudgetMs: 5000 });
      assert.equal(exact.proven, true, `${label}: the core's exact search did not prove`);
      assertTieResult(inst, cands, exact, o, tolerance, `${label} core exact`);

      const warnings: string[] = [];
      const r = await solveExact({ core, ...inst, opts: { ...base, exact: true, timeBudgetMs: 10000 }, onProgress: () => {}, onWarn: (m) => warnings.push(m) });
      assert.deepEqual(warnings, [], `${label}: HiGHS and the core disagree`);
      assert.ok(r.proven && r.tieBreak?.costProven, `${label}: HiGHS did not prove (score ${r.score}, ${JSON.stringify(r.tieBreak)}, ${r.mipMs} ms)`);
      assertTieResult(inst, cands, r, o, tolerance, `${label} HiGHS`);
    }
  });
}

// Issue #311: the hard-floor bonus at the boundary. Floor bonuses (up to 1e6) and weights (up to 9e5 per point) as large as the
// settings allow, so at the fixed 1e7 the rest of the score can outweigh a hard floor; withHardFloorBonus raises the bonus
// for the pool. Some instances score SSI by step with credits above the pool's SSI, some run the rarity or fewest-changes
// tie-break, and some make every floor hard, so they often conflict (the hardAsSoft retry). Over every suit, one meeting
// more hard floors scores strictly higher, and both exact searches prove the brute-force best and return a suit meeting
// the most hard floors any suit meets. Weights are fractional, so sums round, and in some instances Luck runs to the
// hundreds so the bound passes HARD_FLOOR_BONUS_MAX: those build at the cap, say so (requirement_outweighed) and
// keep the brute-force score, without a proof when a suit missing a requirement scores best. The fixed scale must break the order in some instances, so the loop reaches the boundary.
const BIG_SEEDS = [5, 17, 2026];
for (const seed of BIG_SEEDS) {
  test(`[fast] a suit meeting more hard floors always scores higher, with bonuses and weights as large as the settings allow (seed ${seed})`, async (t) => {
    const rnd = core.optMulberry32(seed);
    let brokenAtFixed = 0, stepped = 0, tied = 0, conflicts = 0, capped = 0;
    for (let i = 0; i < 200; i++) {
      const inst = generate(rnd, seed * 100000 + i * 100), label = `seed ${seed} instance ${i}`, p = inst.profile;
      const floored = Object.keys(p.floors || {});
      if (!floored.length) continue;
      if (!p.hardFloors!.length || rnd() < 0.25) p.hardFloors = rnd() < 0.5 ? floored : [floored[0]!];   // every floor hard: they often conflict
      p.floorBonus = [1e3, 1e5, 3e5, 1e6][Math.floor(rnd() * 4)]!;
      const factor = [1, 987.654321, 123456.7, 333333.3][Math.floor(rnd() * 4)]!;   // fractional, so sums round
      for (const d of Object.keys(p.weights!)) p.weights![d]! *= factor;
      const items = [...Object.values(inst.pools).flat(), ...Object.values(inst.current)].filter((x): x is Item => !!x);
      // Luck in the hundreds: with a large weight the bound passes the cap, the build runs at it and says so (scores stay
      // near 1e9; past about 5e9 the weights alone outrun the exact solver's absolute score comparisons, at any bonus)
      const huge = rnd() < 0.2;
      if (huge) for (const it of items) if (it.props.luck) it.props.luck *= 10;
      // SSI by step with credits above the SSI a suit carries (the worker's table, passed to the bound as the route does)
      const ssiSteps = rnd() < 0.3 ? [{ ssi: 3, stam: 0, credit: 20 + Math.floor(rnd() * 60) }, { ssi: 8, stam: 0, credit: 80 + Math.floor(rnd() * 60) }] : null;
      if (ssiSteps) { stepped++; p.weights!.ssi = factor * 3; for (const it of items) if (rnd() < 0.4) it.props.ssi = Math.floor(rnd() * 8); }
      // the tie-break: rarity (a tie cost on each piece) or fewest changes, at tolerances up to 1e6
      const tb: { tolerance: number; rarity?: string; fewestChanges?: boolean } | null = rnd() < 0.3 ? { tolerance: [0, 1e3, 1e6][Math.floor(rnd() * 3)]!, ...(rnd() < 0.5 ? { rarity: "lower" } : { fewestChanges: true }) } : null;
      if (tb?.rarity) for (const it of items) it.tieCost = Math.floor(rnd() * 8);
      const fixed = (ssiSteps ? { ...p, ssiSteps } : p) as OptProfile;
      const profile = { ...withHardFloorBonus(p, inst.pools as never, inst.current as never, inst.optionalSlots, inst.slots, ssiSteps), ...(ssiSteps ? { ssiSteps } : {}) } as OptProfile;
      const cands = candidates(inst), suits: OptAssignment[] = [], pick: OptAssignment = {};
      const rec = (k: number): void => {
        if (k === inst.slots.length) { if (!(pick.twoHanded?.twoHanded === true && pick.oneHanded)) suits.push({ ...pick }); return; }
        for (const it of cands[inst.slots[k]!]!) { pick[inst.slots[k]!] = it; rec(k + 1); }
      };
      rec(0);
      const met = (a: OptAssignment): number => profile.hardFloors!.filter((d) => Object.values(a).reduce((n, it) => n + (it?.props[d] || 0), 0) >= profile.floors![d]!).length;
      // per met count, the lowest and highest score: each count's lowest must beat every fewer count's highest
      const ordered = (pr: OptProfile): boolean => {
        const lo = new Map<number, number>(), hi = new Map<number, number>();
        for (const a of suits) { const c = met(a), s = core.scoreSet(a, pr); lo.set(c, Math.min(lo.get(c) ?? Infinity, s)); hi.set(c, Math.max(hi.get(c) ?? -Infinity, s)); }
        return [...lo].every(([c, l]) => [...hi].every(([c2, h]) => c2 >= c || l > h));
      };
      if (!ordered(fixed)) brokenAtFixed++;
      const needed = hardFloorBonusFor(fixed, inst.pools as never, inst.current as never, inst.optionalSlots, inst.slots), saysCapped = requirementScaleDiagnostics({ pools: inst.pools as never, current: inst.current as never, optionalSlots: inst.optionalSlots, slots: inst.slots, profile: fixed }).length > 0;
      assert.equal(saysCapped, needed > HARD_FLOOR_BONUS_MAX, `${label}: requirement_outweighed exactly when the bound passes the cap (${needed})`);
      if (needed > HARD_FLOOR_BONUS_MAX) { capped++; assert.equal(profile.hardFloorBonus, HARD_FLOOR_BONUS_MAX); }
      else assert.ok(ordered(profile), `${label}: a suit meeting fewer hard floors scores as high (bonus ${profile.hardFloorBonus ?? 1e7})`);
      const oracle = Math.max(...suits.map((a) => core.scoreSet(a, profile))), tol = 1e-9 * Math.max(1, Math.abs(oracle)), most = Math.max(...suits.map(met));
      const opts: OptOptions = { seed: 1, restarts: 2, slots: inst.slots, optionalSlots: inst.optionalSlots, exact: true, timeBudgetMs: 5000, ...(tb ? { tieBreak: tb } : {}) };
      if (tb) tied++;
      const top = (r: { score: number; tieBreak?: { topScore: number } | undefined }): number => (tb ? r.tieBreak!.topScore : r.score);
      const exact = core.optimizeSuit(inst.pools, inst.current, profile, opts);
      assert.ok(exact.proven && Math.abs(top(exact) - oracle) <= tol && (needed > HARD_FLOOR_BONUS_MAX || met(exact.best) === most), `${label}: core exact ${top(exact)} vs brute force ${oracle}, ${met(exact.best)} of ${most} hard floors`);
      const warned: string[] = [];
      const r = await solveExact({ core, ...inst, profile, opts: { ...opts, timeBudgetMs: 10000 }, onProgress: () => {}, onWarn: (m) => warned.push(m) });
      if (r.floorsConflict) conflicts++;
      // past the cap a suit missing a reachable hard floor can score best, which HiGHS's hard rows forbid: no proof then
      assert.ok((r.proven || needed > HARD_FLOOR_BONUS_MAX) && Math.abs(top(r) - oracle) <= tol && (needed > HARD_FLOOR_BONUS_MAX || met(r.best) === most), `${label}: HiGHS ${top(r)} (proven ${r.proven}, ${r.solver}) vs brute force ${oracle}, ${met(r.best)} of ${most} hard floors: ${warned.join("; ")}`);
    }
    assert.ok(stepped > 10 && tied > 10 && conflicts > 0, `${stepped} with SSI steps, ${tied} with a tie-break, ${conflicts} with conflicting hard floors`);
    t.diagnostic(`${capped} instances past the cap`);
    assert.ok(brokenAtFixed > 0, `the fixed 1e7 broke the order in ${brokenAtFixed} instances`);
  });
}

// Issue #316: scores past 1e10, where float rounding passes every absolute slack. Two shapes, each on six slots of three
// pieces: eleven hard floors (one out of reach) at a bonus near HARD_FLOOR_BONUS_MAX, and weights alone near 1e6 a point
// on Luck in the thousands, with only an unreachable hard floor, so no requirement can be traded. Fractional weights so sums
// round; a third of the instances in Strict order. Both exact searches must prove, and agree with brute force, to the
// relative slack (mip.mts slackAt). With absolute slacks HiGHS lost about one proof in five of the second shape.
const HUGE_SEEDS = [5, 17, 2026];
for (const seed of HUGE_SEEDS) {
  test(`[fast] scores past 1e10: both exact searches prove and agree (seed ${seed})`, async () => {
    const rnd = core.optMulberry32(seed), slots = ["ring", "bracelet", "helmet", "gloves", "neck", "legs"];
    const hardKeys = Array.from({ length: 11 }, (_, k) => `h${k + 1}`);
    let past = 0;
    for (let i = 0; i < 30; i++) {
      const many = i % 2 === 0, label = `seed ${seed} instance ${i} (${many ? "many hard floors" : "weights"})`;
      const pools: OptPools = {}, current: OptAssignment = {};
      let serial = seed * 100000 + i * 100;
      for (const s of slots) {
        pools[s] = Array.from({ length: 3 }, (): Item => {
          const props: Record<string, number> = { luck: Math.floor(rnd() * 140 * (many ? 3 : 100)), lrc: Math.floor(rnd() * 9), dci: Math.floor(rnd() * 20) };
          for (const h of hardKeys) props[h] = Math.floor(rnd() * 4);
          return { serial: ++serial, name: `item${serial}`, slot: s, props };
        });
        current[s] = pools[s]![0]!;
      }
      const hard = many ? hardKeys : ["h1"], floors: Record<string, number> = { lrc: 19 };
      for (const h of hard) floors[h] = 7 + Math.floor(rnd() * 3);
      floors.h1 = 99;   // out of reach: fractional shared partial credit
      const raw: OptProfile = { weights: { luck: 598765.4, lrc: -12345.6, dci: 333333.3 }, caps: { lrc: 40 }, floors, hardFloors: hard, floorBonus: 777.7 };
      const profile = many ? withHardFloorBonus(raw, pools as never, current as never, [], slots) as OptProfile : raw;
      const strict = rnd() < 0.33 ? { ranks: [["luck"], ["dci"]] } : undefined;
      const opts: OptOptions = { seed: 1, restarts: 2, slots, optionalSlots: [], exact: true, timeBudgetMs: 8000, strict };
      const c = core.optimizeSuit(pools, current, profile, opts);
      const warned: string[] = [];
      const r = await solveExact({ core, pools, current, profile, opts: { ...opts, timeBudgetMs: 15000 }, onProgress: () => {}, onWarn: (m) => warned.push(m) });
      if (Math.abs(c.score) > 1e10) past++;
      assert.ok(c.proven, `${label}: the core did not prove`);
      assert.ok(r.proven && !warned.length, `${label}: HiGHS unproven (${r.score} vs the core's ${c.score}): ${warned.join("; ")}`);
      assert.ok(Math.abs(r.score - c.score) <= slackAt(SCORE_SLACK, r.score, c.score), `${label}: HiGHS ${r.score} vs the core's ${c.score}`);
    }
    assert.ok(past >= 10, `${past} instances scored past 1e10`);
  });
}

// Issue #316: the core's Strict order compare (optLexCmp) reads the same slack as the MIP (app/solver/scoring.mts slackAt).
test("[fast] the relative score slack: 1e-3 for small scores, 1e-12 of a large one, the same in the core", () => {
  assert.equal(slackAt(1e-3, 5, -7), 1e-3);
  assert.equal(slackAt(1e-3, 3e10), 3e10 * 1e-12);
  for (const [x, d, equal] of [[1e3, 5e-4, true], [1e3, 2e-3, false], [3e10, 2e-2, true], [3e10, 5e-2, false]] as const) {
    assert.equal(core.optLexCmp([x + d], [x]) === 0, equal, `${x} + ${d}`);
    assert.equal(Math.abs(d) <= slackAt(1e-3, x + d, x), equal, `${x} + ${d} by slackAt`);
  }
});
