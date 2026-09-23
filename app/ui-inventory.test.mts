// ui-inventory.test.mts — app/ui/inv-model.mts, the Inventory screen's pure rules: the query string a
// filter state sends, the active-filter tokens (wording, removal, the empty-result sentence), the counts
// and plurals in the strip and footer, the column groups, the virtual table's row window and chunk
// fetches, and the table's keyboard model. The rendered screen is driven by scripts/ui-state.test.mts.
import test from "node:test";
import assert from "node:assert/strict";
import { plural, queryParams, activeFilters, clearAll, matchLine, countFact, emptyCause, rowWindow, chunksToFetch, gridKey, colGroup, groupColumns, DEFAULT_COLS, shortTier, propRuleLabel } from "./ui/inv-model.mts";
import { parseItemQuery } from "./item-query.mts";
import type { ItemQuery } from "./item-query.mts";

const BASE: ItemQuery = parseItemQuery(new URLSearchParams());
const LADDER = ["Minor Magic Item", "Lesser Magic Item", "Greater Magic Item", "Major Magic Item", "Lesser Artifact", "Greater Artifact", "Major Artifact", "Legendary Artifact"];
const CTX = {
  slotLabel: (s: string) => ({ ring: "Ring", legs: "Legs" } as Record<string, string>)[s] || s,
  propLabel: (k: string) => ({ lmc: "LMC", hci: "HCI" } as Record<string, string>)[k] || k,
  places: [{ text: "Metal Chest (0x700b0000)", character: "Dorran", kind: "ground", root: 0x700b0000, rootName: "Metal Chest (0x700b0000)", count: 40 }],
  ladder: LADDER,
};

test("[fast] plural agrees with its count and groups thousands", () => {
  assert.equal(plural(1, "stack"), "1 stack");
  assert.equal(plural(0, "stack"), "0 stacks");
  assert.equal(plural(2, "piece"), "2 pieces");
  assert.equal(plural(1204, "piece"), "1,204 pieces");
});

test("[fast] queryParams round-trips through the server's parser", () => {
  const q: ItemQuery = { ...BASE, q: "ring", chars: ["Dorran", "Kestrel"], slot: ["ring", "?"], loc: ["Metal Chest, left"], roots: [12], rarityMin: "Greater Magic Item", kind: ["gear"], seenDays: 7, slayer: "*", nogarg: true, med: true, hideTags: ["cursed"], props: [{ key: "lmc", min: 8 }, { key: "hci", min: 5, op: "le" }], group: true, sort: "hci", dir: -1, offset: 500, limit: 500 };
  assert.deepEqual(parseItemQuery(queryParams(q)), q);
  assert.deepEqual(parseItemQuery(queryParams(BASE)), BASE);
});

test("[fast] activeFilters words each filter as its token and removes only itself", () => {
  const q: ItemQuery = { ...BASE, rarityMin: "Greater Magic Item", kind: ["gear"], hideTags: ["cursed"], props: [{ key: "lmc", min: 8 }], roots: [0x700b0000], chars: ["Dorran"] };
  const tokens = activeFilters(q, CTX);
  assert.deepEqual(tokens.map((t) => t.label), ["Character: Dorran", "Location: Metal Chest (0x700b0000)", "Rarity ≥ Greater Magic Item", "Kind: gear", "LMC ≥ 8", "Hiding: cursed"]);
  assert.deepEqual(tokens.map((t) => t.removeLabel).slice(2), ["Remove filter: Rarity", "Remove filter: Kind gear", "Remove filter: LMC ≥ 8", "Remove filter: Hiding cursed"]);
  const noKind = tokens.find((t) => t.id === "kind:gear")!.remove(q);
  assert.deepEqual(noKind.kind, []);
  assert.equal(noKind.rarityMin, "Greater Magic Item", "removing one filter leaves the others");
  assert.deepEqual(activeFilters(BASE, CTX), [], "a fresh query has no active filters");
});

test("[fast] activeFilters counts the search as a filter, and Clear all clears it too", () => {
  const q: ItemQuery = { ...BASE, q: "orc", kind: ["gear"], group: true, sort: "hci" };
  assert.deepEqual(activeFilters(q, CTX).map((t) => t.label), ["Search: orc", "Kind: gear"]);
  const cleared = clearAll(q);
  assert.deepEqual(activeFilters(cleared, CTX), []);
  assert.equal(cleared.q, "");
  assert.equal(cleared.group, true, "the view is not a filter");
  assert.equal(cleared.sort, "hci");
});

test("[fast] the strip and footer counts pluralise", () => {
  assert.equal(matchLine({ shown: 45, total: 160 }), "45 of 160 stacks match");
  assert.equal(matchLine({ shown: 1, total: 1 }), "1 of 1 stack match");
  assert.equal(matchLine({ shown: 45, total: 160, grouped: true, names: 1 }), "1 name · 45 of 160 stacks match");
  assert.equal(countFact({ shown: 45, total: 160, pieces: 45, filtered: true }), "45 of 160 stacks · 45 pieces");
  assert.equal(countFact({ shown: 1, total: 1, pieces: 1, filtered: false }), "1 stack · 1 piece");
  assert.equal(countFact({ shown: 160, total: 160, pieces: 1204, filtered: false }), "160 stacks · 1,204 pieces");
});

test("[fast] emptyCause names the one filter that excludes everything by itself", () => {
  const q: ItemQuery = { ...BASE, rarityMin: "Legendary Artifact", kind: ["gear"] };
  const tokens = activeFilters(q, CTX);
  assert.equal(emptyCause(tokens, ["rarityMin"], 160), "None of the 160 stacks is a Legendary Artifact.");
  assert.equal(emptyCause(activeFilters({ ...BASE, rarityMin: "Greater Artifact" }, CTX), [], 160), "None of the 160 stacks is a Greater Artifact or better.", "a single filter is its own cause");
  assert.equal(emptyCause(tokens, [], 160), "No stack matches all 2 filters together. Remove one to see more.");
  assert.equal(emptyCause(activeFilters({ ...BASE, slot: ["ring"] }, CTX), [], 1), "None of the 1 stack goes in the Ring slot.");
  assert.equal(emptyCause(activeFilters({ ...BASE, loc: ["Worn by Dorran"] }, CTX), [], 3), "None of the 3 stacks is worn by Dorran.");
  assert.equal(emptyCause(activeFilters({ ...BASE, q: "zzz" }, CTX), [], 3), 'Nothing matches the search "zzz".');
});

test("[fast] tier and rule labels", () => {
  assert.equal(shortTier("Greater Magic Item"), "Greater Magic");
  assert.equal(shortTier("Major Artifact"), "Major Artifact");
  assert.equal(propRuleLabel({ key: "lmc", min: 8 }, CTX.propLabel), "LMC ≥ 8");
  assert.equal(propRuleLabel({ key: "hci", min: 3, op: "eq" }, CTX.propLabel), "HCI = 3");
});

test("[fast] the default columns are the nine of the spec, and every column lands in a picker group", () => {
  assert.equal(DEFAULT_COLS.length, 9);
  assert.equal(colGroup("physResist"), "Resists");
  assert.equal(colGroup("ssi"), "Combat");
  assert.equal(colGroup("hitLifeLeech"), "Combat");
  assert.equal(colGroup("manaRegen"), "Casting");
  assert.equal(colGroup("sk:magery"), "Skills");
  assert.equal(colGroup("med"), "Item");
  assert.equal(colGroup("somethingNew"), "Item");
  assert.deepEqual(groupColumns(["lmc", "physResist", "sk:magery"]).map((g) => g.group), ["Resists", "Casting", "Skills"], "groups in picker order, empty ones left out");
  assert.deepEqual(groupColumns(["energyResist", "coldResist", "physResist", "hitHarm", "dci", "hci"]).map((g) => g.keys), [["physResist", "coldResist", "energyResist"], ["hci", "dci", "hitHarm"]], "the familiar order first, then the rest");
});

test("[fast] rowWindow draws the rows in view plus overscan, clamped to the list", () => {
  assert.deepEqual(rowWindow({ scrollTop: 0, viewport: 320, rowHeight: 32, count: 160, overscan: 4 }), { start: 0, end: 14 });
  assert.deepEqual(rowWindow({ scrollTop: 3200, viewport: 320, rowHeight: 32, count: 160, overscan: 4 }), { start: 96, end: 114 });
  assert.deepEqual(rowWindow({ scrollTop: 99999, viewport: 320, rowHeight: 32, count: 160, overscan: 4 }), { start: 146, end: 160 }, "past the end reads as the last screenful");
  assert.deepEqual(rowWindow({ scrollTop: 0, viewport: 320, rowHeight: 32, count: 0 }), { start: 0, end: 0 });
});

test("[fast] chunksToFetch asks only for the missing pages that hold the drawn rows", () => {
  assert.deepEqual(chunksToFetch(0, 30, 500, 1600, new Set()), [0]);
  assert.deepEqual(chunksToFetch(480, 520, 500, 1600, new Set([0])), [500]);
  assert.deepEqual(chunksToFetch(480, 1020, 500, 1600, new Set()), [0, 500, 1000]);
  assert.deepEqual(chunksToFetch(0, 30, 500, 0, new Set()), [], "nothing to fetch in an empty list");
  assert.deepEqual(chunksToFetch(1590, 1700, 500, 1600, new Set([1500])), [], "rows past the end ask for nothing");
});

test("[fast] gridKey: arrows, Home/End and Page keys move within the list; Enter/Space open, Esc closes", () => {
  assert.deepEqual(gridKey("ArrowDown", 0, 10, 5), { kind: "move", index: 1 });
  assert.deepEqual(gridKey("ArrowDown", 9, 10, 5), { kind: "move", index: 9 }, "stops at the last row");
  assert.deepEqual(gridKey("ArrowUp", 0, 10, 5), { kind: "move", index: 0 });
  assert.deepEqual(gridKey("End", 2, 10, 5), { kind: "move", index: 9 });
  assert.deepEqual(gridKey("Home", 7, 10, 5), { kind: "move", index: 0 });
  assert.deepEqual(gridKey("PageDown", 2, 10, 5), { kind: "move", index: 7 });
  assert.deepEqual(gridKey("PageUp", 2, 10, 5), { kind: "move", index: 0 });
  assert.deepEqual(gridKey("Enter", 2, 10, 5), { kind: "open" });
  assert.deepEqual(gridKey(" ", 2, 10, 5), { kind: "open" });
  assert.deepEqual(gridKey("Escape", 2, 10, 5), { kind: "close" });
  assert.equal(gridKey("a", 2, 10, 5), null);
  assert.equal(gridKey("ArrowDown", 0, 0, 5), null, "an empty table takes no keys");
});
