// unravel-model.test.mts — `app/ui/unravel-model.mts`, the words of the Unravel view's Gather into a bag dialog (issue #271).
//
// `app/ui/unravel-model.mts`: the pieces' total weight (a piece with no weight line said apart, one and many), the button for the remembered bag (every piece, or only the ones that fit), and the loose and ground sentences. All `[fast]`. The dialog itself is driven by scripts/ui-gather.test.mts.
import test from "node:test";
import assert from "node:assert/strict";
import { gatherWeight, gatherButton, GATHER_LOOSE, GATHER_GROUND } from "./ui/unravel-model.mts";

test("[fast] gatherWeight totals the stones and names pieces with no weight line", () => {
  assert.equal(gatherWeight([{ weight: 1 }, { weight: 6 }, { weight: 2 }]), "Total weight 9 stones.");
  assert.equal(gatherWeight([{ weight: 1 }]), "Total weight 1 stone.");
  assert.equal(gatherWeight([{ weight: 5 }, { weight: null }]), "Total weight 5 stones. 1 piece has no weight line.");
  assert.equal(gatherWeight([{ weight: null }, { weight: null }]), "Total weight 0 stones. 2 pieces have no weight line.");
  assert.equal(gatherWeight([]), "Total weight 0 stones.");
});

test("[fast] gatherButton: every piece, or only the ones that fit", () => {
  assert.equal(gatherButton({ moving: 3, noRoom: 0 }), "Gather 3 pieces");
  assert.equal(gatherButton({ moving: 1, noRoom: 0 }), "Gather 1 piece");
  assert.equal(gatherButton({ moving: 1200, noRoom: 4 }), "Gather the 1,200 that fit");
});

test("[fast] the loose and ground sentences", () => {
  assert.match(GATHER_LOOSE, /loose[\s\S]*Unravel Container only reaches the bag's top level\.$/);
  assert.match(GATHER_GROUND, /only a container on the ground[\s\S]*not a bag in a backpack or bank/);
});
