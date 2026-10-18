// agreement.test.mts — the solvers agree on one suit's score (issue #338): for random suits over generated pools and profiles, the core's `scoreSet` equals the MIP's objective at `startVector` plus `scoreOffset` (the hard floors built as soft terms for every suit, and as rows for a suit that meets them), each weighted property's part of that objective is its `scoreShares` share of the terms' total size, and the core's score with the floors taken out is the sum of those parts. The MIP's rows are held to the same score: every start vector meets them (a row too tight fails), and the model solved by HiGHS with the suit's pieces fixed scores what the core does (a row too loose fails).
//
// `[fast]`: a seeded loop of generated instances (two to six gear slots, one to three pieces each, two-handed weapons, worn pieces, optional slots left empty or filled; weights negative to positive, caps, soft and hard floors, a floor under its min, Resisting Spells minimums and steps, SSI by step with a Stamina pool), several suits each. A mismatch names the instance, the suit and the property, so it points at the term that drifted rather than at a whole search.
import { test } from "node:test";
import assert from "node:assert/strict";
import { core, fuzzSlots } from "../solver-fixture.mts";
import { buildSuitMip, startVector, type BuiltMip, type ObjectivePart } from "../mip.mts";
import { closeModel, loadHighs, openModel, solveModel } from "../mip-solve.mts";
import { scoreShares } from "../diagnostics.mts";
import { RESIST_SKILL_KEY, slackAt, TIE_SLACK } from "./scoring.mts";
import type { OptAssignment, OptPools } from "../exact-solver.mts";
import type { OptItem as MipItem } from "../vault-lib.mts";

type Profile = Parameters<typeof core.scoreSet>[1];
type OptItem = NonNullable<OptPools[string]>[number];
const DIMS = ["hci", "dci", "luck", "physResist", "fireResist", "ssi", "stamPool", RESIST_SKILL_KEY];

function generate(rnd: () => number, serialBase: number) {
  const int = (lo: number, hi: number): number => lo + Math.floor(rnd() * (hi - lo + 1));
  let serial = serialBase;
  const slots = fuzzSlots(rnd, 6), optionalSlots = slots.filter(() => rnd() < 0.5);
  const pools: OptPools = {};
  for (const slot of slots) {
    pools[slot] = Array.from({ length: int(1, 3) }, (): OptItem => {
      const props: Record<string, number> = {};
      for (const d of DIMS) if (rnd() < 0.45) props[d] = d === RESIST_SKILL_KEY ? int(0, 15) : int(-8, 20);
      return { serial: ++serial, name: `item${serial}`, slot, props };
    });
    // a two-handed weapon, never the slot's first piece
    for (const it of pools[slot]!.slice(1)) if (slot === "twoHanded" && rnd() < 0.5) (it as MipItem).twoHanded = true;
  }
  // the first piece worn in some slots: a worn slot that is not optional must stay filled
  const current: Record<string, MipItem> = {};
  if (rnd() < 0.5) for (const slot of slots) if (rnd() < 0.5) current[slot] = pools[slot]![0]! as MipItem;
  const weights: Record<string, number> = {}, caps: Record<string, number> = {}, floors: Record<string, number> = {}, mins: Record<string, number> = {};
  for (const d of DIMS) {
    if (d === RESIST_SKILL_KEY || d === "stamPool") continue;
    weights[d] = int(-2, 4) * (rnd() < 0.3 ? 0.5 : 1);
    if (rnd() < 0.35) caps[d] = int(5, 40);
    if (rnd() < 0.35) floors[d] = int(-3, 45);
  }
  for (const d of ["physResist", "fireResist"]) if (rnd() < 0.5) mins[d] = int(0, 30);
  const profile: Profile = { weights, caps, floors, mins, hardFloors: Object.keys(floors).filter(() => rnd() < 0.4), floorBonus: int(10, 2000), floorPartial: rnd() < 0.5 ? 0.5 : 0.25 };
  if (rnd() < 0.4) profile.resistSteps = [{ at: 10, mins: { physResist: 35, fireResist: 32 } }, { at: 20, mins: { physResist: 40, fireResist: 38 } }];
  if (rnd() < 0.4 && (weights.ssi || 0) > 0) profile.ssiSteps = [{ ssi: 5, stam: 0, credit: 8 }, { ssi: 15, stam: 10, credit: 20 }, { ssi: 30, stam: 25, credit: 45 }];
  return { slots, optionalSlots, pools, current, profile };
}

const partAt = (p: ObjectivePart, vec: Float64Array): number => p.cols.reduce((n, j, i) => n + p.costs[i]! * vec[j]!, p.offset);
// whether the vector meets every row (a hard floor's included)
const feasible = (built: BuiltMip, vec: Float64Array): boolean => {
  const { rowLower, rowUpper, matrix: { starts, indices, values } } = built.model;
  return rowLower.every((lo, r) => { let t = 0; for (let i = starts[r]!; i < starts[r + 1]!; i++) t += values[i]! * vec[indices[i]!]!; return t >= lo - 1e-6 && t <= rowUpper[r]! + 1e-6; });
};
const objectiveAt = (built: BuiltMip, vec: Float64Array): number => built.model.colCost.reduce((n, c, j) => n + c * vec[j]!, built.scoreOffset);

// Score checks on arithmetic compare within a millionth (relative above 1), so a shared partial credit that drifted by less
// than the solvers' tie slack still fails; a HiGHS solve, whose own tolerances are near a millionth, compares within the tie
// slack the solvers use.
const close = (a: number, b: number): boolean => Math.abs(a - b) <= slackAt(1e-6, a, b);

test("[fast] scoring: the core, the MIP and the score shares agree on one suit's score, and the MIP's rows hold it to that score", async () => {
  const highs = await loadHighs();
  let seed = 338, checked = 0, metHard = 0, fixedSolves = 0;
  const rnd = (): number => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed / 4294967296; };
  for (let n = 0; n < 300; n++) {
    const inst = generate(rnd, n * 100), { slots, optionalSlots, pools, current, profile } = inst;
    const mipPools = pools as Partial<Record<string, MipItem[]>>;
    // a hard floor is a row the suit must meet; built as soft (its bonus and shared partial credit as terms), the model scores every suit
    const built = buildSuitMip({ pools: mipPools, current, profile, optionalSlots, slots, parts: true, hardAsSoft: true });
    const strict = buildSuitMip({ pools: mipPools, current, profile, optionalSlots, slots });
    const required = (slot: string): boolean => !optionalSlots.includes(slot) && !!current[slot];
    for (let s = 0; s < 6; s++) {
      const suit: OptAssignment = {};
      for (const slot of slots) suit[slot] = optionalSlots.includes(slot) && !required(slot) && rnd() < 0.3 ? null : pools[slot]![Math.floor(rnd() * pools[slot]!.length)]!;
      // a two-handed weapon leaves the one-hand slot empty, or gives way to the slot's first piece when that slot must stay filled
      if ((suit.twoHanded as MipItem | null | undefined)?.twoHanded && suit.oneHanded) {
        if (required("oneHanded")) suit.twoHanded = pools.twoHanded![0]!;
        else suit.oneHanded = null;
      }
      const picked = Object.fromEntries(Object.entries(suit).filter(([, it]) => it)) as Record<string, MipItem>;
      const vec = startVector(built, picked), at = `instance ${n}, suit ${s} (${Object.values(picked).map((it) => it.serial).join(",")})`;
      const score = core.scoreSet(suit, profile), mip = objectiveAt(built, vec);
      assert.ok(close(score, mip), `${at}: core ${score} vs MIP ${mip}`);
      // the start vector meets every row: a row too tight would cut this suit
      assert.ok(feasible(built, vec), `${at}: the start vector breaks a row`);
      // with the hard rows, on a suit that meets them
      const sv = startVector(strict, picked);
      if (feasible(strict, sv)) { const v = objectiveAt(strict, sv); assert.ok(close(score, v), `${at}: core ${score} vs MIP with hard rows ${v}`); metHard++; }
      // with the suit's pieces fixed, the most the model makes of it is the core's score: a row too loose would overpay it
      if (s < 2) {
        const m = built.model, isX = (j: number): boolean => built.cols[j]!.kind === "x";
        const fixed: BuiltMip = { ...built, model: { ...m, colLower: m.colLower.map((lo, j) => (isX(j) ? vec[j]! : lo)), colUpper: m.colUpper.map((hi, j) => (isX(j) ? vec[j]! : hi)) } };
        const h = openModel(highs, fixed);
        try {
          const r = solveModel(h, { timeLimitS: 5 });
          assert.equal(r.status, "optimal", `${at}: the fixed suit solved ${r.status}`);
          const v = r.objective! + built.scoreOffset;
          assert.ok(Math.abs(score - v) <= slackAt(TIE_SLACK, score, v), `${at}: core ${score} vs the MIP solved with the suit fixed ${v}`);
        } finally { closeModel(h); }
        fixedSolves++;
      }
      // each weighted property's part of the objective is the term the shares score it by
      const totals = core.optAssignmentTotals(suit), parts = built.parts!.weights;
      const terms = Object.fromEntries(Object.keys(profile.weights || {}).filter((k) => profile.weights![k]).map((k) => [k, parts[k] ? partAt(parts[k]!, vec) : 0]));
      const size = Object.values(terms).reduce((t, v) => t + Math.abs(v), 0);
      const shares = Object.fromEntries(scoreShares(profile, totals).map((x) => [x.property, x.share]));
      for (const [k, v] of Object.entries(terms)) assert.ok(Math.abs((shares[k] ?? 0) * size - v) <= 1e-6 * Math.max(1, size), `${at}, ${k}: share ${shares[k]} × ${size} vs MIP part ${v}`);
      // the core's score with no floors is the weight parts' sum
      const weightsOnly = core.scoreSet(suit, { ...profile, floors: {}, hardFloors: [] }), sum = Object.values(terms).reduce((t, v) => t + v, 0);
      assert.ok(close(weightsOnly, sum), `${at}: core weights ${weightsOnly} vs parts ${sum}`);
      checked++;
    }
  }
  assert.equal(checked, 1800);
  assert.equal(fixedSolves, 600);
  assert.ok(metHard > 300, `only ${metHard} suits met every hard floor`);
});
