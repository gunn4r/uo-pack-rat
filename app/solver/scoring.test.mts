// scoring.test.mts — `app/solver/scoring.mts`, the scoring constants both solvers read (issue #338).
//
// `[fast]`: `app/solver/scoring.mts`: the slot count the change cost is built on is the gear slot list's length, the change cost stays at its floor for the shipped rarity ladders and rises above what the slots can sum to, the relative slack reads magnitudes, a raised hard-floor bonus is read and a lower one never is, and the defaults the BuildSpec and the core read are these.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CHANGE_COST, DEFAULT_FLOOR_BONUS, GEAR_SLOT_COUNT, HARD_FLOOR_BONUS, TIE_SLACK, changeCost, hardBonusOf, slackAt } from "./scoring.mts";
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
