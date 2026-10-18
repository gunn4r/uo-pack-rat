// scoring.test.mts — `app/solver/scoring.mts`, the scoring constants both solvers read (issue #338).
//
// `[fast]`: `app/solver/scoring.mts`: the slot count the change cost is built on is the gear slot list's length, the change cost stays at its floor for the shipped rarity ladders and rises above what the slots can sum to, the relative slack reads magnitudes, a raised hard-floor bonus is read and a lower one never is, the defaults the BuildSpec and the core read are these, and `scoringProfile` fills the defaults in, drops a floor at or under its min, and shares the hard floors' partial credit among the hard floors that ask for something.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CHANGE_COST, DEFAULT_FLOOR_BONUS, DEFAULT_FLOOR_PARTIAL, GEAR_SLOT_COUNT, HARD_FLOOR_BONUS, TIE_SLACK, changeCost, hardBonusOf, scoringProfile, slackAt } from "./scoring.mts";
import { GEAR_SLOTS } from "../vault-lib.mts";
import { SPEC_DEFAULTS } from "../build-spec.mts";

test("[fast] scoring: the change cost's slot count is the gear slot list's length, and the cost tops what the slots can sum to", () => {
  assert.equal(GEAR_SLOT_COUNT, GEAR_SLOTS.length);
  assert.equal(changeCost(8), CHANGE_COST, "the shipped ladders keep 1,000");
  assert.equal(changeCost(1200), GEAR_SLOT_COUNT * 1200 + 1);
});

test("[fast] scoring: the relative slack reads magnitudes, and a profile's hard-floor bonus is never below the base", () => {
  assert.equal(slackAt(TIE_SLACK, 5, -7), TIE_SLACK);
  assert.equal(slackAt(TIE_SLACK, -3e10), 3e10 * 1e-12, "a large negative score gets the relative slack too");
  assert.equal(hardBonusOf({}), HARD_FLOOR_BONUS);
  assert.equal(hardBonusOf({ hardFloorBonus: 5 }), HARD_FLOOR_BONUS);
  assert.equal(hardBonusOf({ hardFloorBonus: 3e8 }), 3e8);
  assert.equal(SPEC_DEFAULTS.floorBonus, DEFAULT_FLOOR_BONUS);
});

test("[fast] scoring: scoringProfile fills the defaults in, drops a floor at or under its min, and shares the hard floors' partial credit", () => {
  const empty = scoringProfile({});
  assert.deepEqual([empty.floorBonus, empty.floorPartial, empty.hardBonus, empty.hardCount], [DEFAULT_FLOOR_BONUS, DEFAULT_FLOOR_PARTIAL, HARD_FLOOR_BONUS, 0]);
  assert.deepEqual([empty.weights, empty.caps, empty.mins, empty.floors], [{}, {}, {}, {}]);
  const sp = scoringProfile({ floors: { a: 40, b: 30, c: 20, d: 10 }, mins: { b: 30, c: 5 }, hardFloors: ["a", "b", "c"], floorBonus: 200, floorPartial: 0.25, hardFloorBonus: 3e8 });
  assert.deepEqual(["a", "b", "c", "d", "e"].map(sp.floorOf), [40, 0, 20, 10, 0], "b sits at its min, so every suit meets it; e has none");
  assert.equal(sp.hardCount, 2, "a and c ask for something; b does not");
  assert.deepEqual([sp.bonusOf("a"), sp.bonusOf("d")], [3e8, 200]);
  assert.deepEqual([sp.partialOf("a"), sp.partialOf("d")], [3e8 * 0.25 / 2, 200 * 0.25]);
  assert.equal(scoringProfile({ floors: { a: 5 }, hardFloors: ["a"], mins: { a: 9 } }).partialOf("a"), HARD_FLOOR_BONUS * DEFAULT_FLOOR_PARTIAL, "with no hard floor asking for something the share is whole");
});
