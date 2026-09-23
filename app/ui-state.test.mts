// ui-state.test.mts — app/ui/view-state.mts, the page's pure state rules: a filter checklist keeping the
// value the query still applies across a refresh, and "Clear all" resetting every filter. The same transitions are driven in a real window by
// scripts/ui-state.test.mts.
import test from "node:test";
import assert from "node:assert/strict";
import { optionsKeeping, clearedQuery, colsFromPrefs, COLS_VERSION } from "./ui/view-state.mts";
import type { ItemQuery } from "./item-query.mts";

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
    q: "ring", chars: ["Dorran"], slot: ["ring"], loc: ["Bank"], roots: [7], rarity: "Greater Artifact", rarityMin: "Lesser Artifact", kind: ["gear"], seenDays: 7, slayer: "*",
    nogarg: true, med: true, hideTags: ["cursed"], props: [{ key: "hci", min: 5 }], group: true, sort: "hci", dir: -1, offset: 400, limit: 100,
  };
  assert.deepEqual(clearedQuery(q), {
    q: "", chars: [], slot: [], loc: [], roots: [], rarity: "", rarityMin: "", kind: [], seenDays: 0, slayer: "",
    nogarg: false, med: false, hideTags: [], props: [], group: true, sort: "hci", dir: -1, offset: 0, limit: 100,
  });
  assert.deepEqual(q.hideTags, ["cursed"], "the query passed in is not mutated");
});

test("[fast] colsFromPrefs uses the server's saved columns and never migrates over them", () => {
  assert.deepEqual(colsFromPrefs({ cols: ["hci"], colsVersion: COLS_VERSION }, ["dci"]), { cols: ["hci"], save: false });
  assert.deepEqual(colsFromPrefs({ cols: ["tags", "hci"], colsVersion: COLS_VERSION }, null), { cols: ["tags", "hci"], save: false });
});

test("[fast] colsFromPrefs shows the Tags column once to a choice saved before it existed, and keeps it off after that", () => {
  assert.deepEqual(colsFromPrefs({ cols: ["hci", "dci"] }, null), { cols: ["tags", "hci", "dci"], save: true }, "a choice from before the Tags column gets it, and is saved with the new version");
  assert.deepEqual(colsFromPrefs({ cols: ["hci", "tags"] }, null), { cols: ["hci", "tags"], save: true }, "a list already naming Tags is left as it is");
  assert.deepEqual(colsFromPrefs({ cols: ["hci"], colsVersion: COLS_VERSION }, null), { cols: ["hci"], save: false }, "Tags turned off on this version stays off");
});

test("[fast] colsFromPrefs adopts an old browser-saved choice only when the server answered with none", () => {
  assert.deepEqual(colsFromPrefs({}, ["dci", "sk:magery"]), { cols: ["tags", "dci", "sk:magery"], save: true });
  assert.deepEqual(colsFromPrefs(null, ["dci"]), { cols: null, save: false }, "a failed GET must not push the old choice over the server's");
  assert.deepEqual(colsFromPrefs({}, null), { cols: null, save: false });
});

test("[fast] colsFromPrefs drops an old choice the server would refuse instead of failing every load", () => {
  assert.deepEqual(colsFromPrefs({}, Array.from({ length: 201 }, (_, i) => `k${i}`)), { cols: null, save: false });
  assert.deepEqual(colsFromPrefs({}, ["hci", ""]), { cols: null, save: false });
  assert.deepEqual(colsFromPrefs({}, ["x".repeat(65)]), { cols: null, save: false });
  assert.deepEqual(colsFromPrefs({}, "hci"), { cols: null, save: false });
});
