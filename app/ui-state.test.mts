// ui-state.test.mts — app/ui/view-state.mts, the page's pure state rules: the pager offset after the
// inventory shrinks, a filter dropdown keeping the value the query still applies across a refresh,
// and "Clear all" resetting every filter. The same transitions are driven in a real window by
// scripts/ui-state.test.mts.
import test from "node:test";
import assert from "node:assert/strict";
import { clampOffset, optionsKeeping, clearedQuery } from "./ui/view-state.mts";
import type { ItemQuery } from "./item-query.mts";

test("[fast] clampOffset keeps an offset that still has rows", () => {
  assert.equal(clampOffset(0, 20, 160), 0);
  assert.equal(clampOffset(140, 20, 160), 140);
  assert.equal(clampOffset(40, 20, 41), 40);
});

test("[fast] clampOffset moves an offset past the end to the last page with rows", () => {
  assert.equal(clampOffset(140, 20, 48), 40);
  assert.equal(clampOffset(140, 20, 40), 20);
  assert.equal(clampOffset(200, 200, 1), 0);
});

test("[fast] clampOffset goes back to the start when nothing is left", () => {
  assert.equal(clampOffset(140, 20, 0), 0);
});

const OPTS = [{ value: "", label: "any" }, { value: "ring", label: "Ring" }];

test("[fast] optionsKeeping leaves the options alone when the current value is among them or empty", () => {
  assert.deepEqual(optionsKeeping(OPTS, "ring", (v) => `${v} (gone)`), OPTS);
  assert.deepEqual(optionsKeeping(OPTS, "", (v) => `${v} (gone)`), OPTS);
});

test("[fast] optionsKeeping adds back a value the query still filters on after its facet disappeared", () => {
  assert.deepEqual(optionsKeeping(OPTS, "bracelet", (v) => `${v} (none left)`), [...OPTS, { value: "bracelet", label: "bracelet (none left)" }]);
});

test("[fast] clearedQuery resets every filter and keeps the view", () => {
  const q: ItemQuery = {
    q: "ring", slot: "ring", loc: "Bank", rarity: "Greater Artifact", kind: "gear", seenDays: 7, slayer: "*",
    nogarg: true, med: true, hideTags: ["cursed"], props: [{ key: "hci", min: 5 }], group: true, sort: "hci", dir: -1, offset: 400, limit: 100,
  };
  assert.deepEqual(clearedQuery(q), {
    q: "", slot: "", loc: "", rarity: "", kind: "", seenDays: 0, slayer: "",
    nogarg: false, med: false, hideTags: [], props: [], group: true, sort: "hci", dir: -1, offset: 0, limit: 100,
  });
  assert.deepEqual(q.hideTags, ["cursed"], "the query passed in is not mutated");
});
