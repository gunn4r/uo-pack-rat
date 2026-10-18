// budget.test.mts — `app/solver/budget.mts`, the exact solver's time budget (issue #338).
//
// `[fast]`: on a hand-driven clock, the elapsed time, what is left in seconds (never below 0), the budget spent at its end exactly, the heuristic's half, and a tie-break's first-stage share.
import { test } from "node:test";
import assert from "node:assert/strict";
import { startBudget } from "./budget.mts";
import { TIE_STAGE_SHARE } from "./scoring.mts";

test("[fast] budget: elapsed, left, spent, and the shares on a hand-driven clock", () => {
  let t = 1000;
  const b = startBudget(4000, () => t);
  assert.deepEqual([b.ms, b.startedAt, b.heuristicMs], [4000, 1000, 2000]);
  t = 2000;
  assert.deepEqual([b.elapsedMs(), b.leftS(), b.over()], [1000, 3, false]);
  assert.equal(b.firstStageS(false), 3);
  assert.equal(b.firstStageS(true), TIE_STAGE_SHARE * 3);
  t = 5000;
  assert.deepEqual([b.leftS(), b.over()], [0, true], "spent at its end exactly");
  t = 9000;
  assert.deepEqual([b.leftS(), b.firstStageS(true)], [0, 0], "never below 0");
});
