// ui-inventory.test.mts — `app/ui/inv-model.mts`, the Inventory screen's pure rules.
//
// `app/ui/inv-model.mts`, the Inventory screen's pure rules: `plural` ("1 stack", "1,204 pieces"), `queryParams` round-tripping a full filter state through the server's `parseItemQuery`, the active-filter tokens (their words, each removing only itself, the search counted as a filter and cleared by Clear all, the Rarity at most token and its empty-result sentence), the strip's "45 of 160 stacks match" and the footer's count fact, the empty-result sentence (the one filter that excludes everything alone, a single filter being its own cause, else the combination), tier and rule labels, the nine default columns and the column picker's groups and order, the virtual table's row window (clamped at the end) and chunk fetches, and the table's keyboard model (arrows, Home/End, Page keys, Enter/Space, Esc). All `[fast]`.
//
// The rendered screen is driven by scripts/ui-state.test.mts.
import test from "node:test";
import assert from "node:assert/strict";
import { plural, queryParams, withFixed, activeFilters, clearAll, matchLine, countFact, emptyCause, rowWindow, chunksToFetch, gridKey, colGroup, groupColumns, DEFAULT_COLS, shortTier, propRuleLabel, slayerTree, slayerLabel } from "./ui/inv-model.mts";
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
  const q: ItemQuery = { ...BASE, q: "ring", chars: ["Dorran", "Kestrel"], slot: ["ring", "?"], loc: ["Metal Chest, left"], roots: [12], rarityMin: "Greater Magic Item", kind: ["gear"], seenDays: 7, slayer: "*", nogarg: true, med: true, hideTags: ["cursed"], tags: ["brittle", "antique"], props: [{ key: "lmc", min: 8 }, { key: "hci", min: 5, op: "le" }], flags: ["spell channeling", "mage armor"], wskill: ["fencing", "mace fighting"], group: true, sort: "hci", dir: -1, offset: 500, limit: 500 };
  assert.deepEqual(parseItemQuery(queryParams(q)), q);
  assert.deepEqual(parseItemQuery(queryParams(BASE)), BASE);
});

test("[fast] withFixed lays the fixed fields over the player's filters and leaves the rest", () => {
  const q: ItemQuery = { ...BASE, q: "ring", slot: ["legs"], kind: ["gear"] };
  const sent = withFixed(q, { slot: ["ring"] });
  assert.deepEqual(sent, { ...q, slot: ["ring"] });
  assert.deepEqual(q.slot, ["legs"]);   // the player's own query is untouched
  assert.deepEqual(withFixed(q, {}), q);
});

test("[fast] activeFilters words each filter as its token and removes only itself", () => {
  const q: ItemQuery = { ...BASE, rarityMin: "Greater Magic Item", kind: ["gear"], hideTags: ["cursed"], tags: ["brittle"], props: [{ key: "lmc", min: 8 }], roots: [0x700b0000], chars: ["Dorran"] };
  const tokens = activeFilters(q, CTX);
  assert.deepEqual(tokens.map((t) => t.label), ["Character: Dorran", "Location: Metal Chest (0x700b0000)", "Rarity ≥ Greater Magic Item", "Kind: gear", "LMC ≥ 8", "Hiding: cursed", "Tagged: brittle"]);
  assert.deepEqual(tokens.map((t) => t.removeLabel).slice(2), ["Remove filter: Rarity", "Remove filter: Kind gear", "Remove filter: LMC ≥ 8", "Remove filter: Hiding cursed", "Remove filter: Tagged brittle"]);
  assert.deepEqual(tokens.find((t) => t.id === "tags")!.remove(q).tags, []);
  assert.equal(tokens.find((t) => t.id === "tags")!.cause(3), "None of the 3 stacks is tagged brittle.");
  const noKind = tokens.find((t) => t.id === "kind:gear")!.remove(q);
  assert.deepEqual(noKind.kind, []);
  assert.equal(noKind.rarityMin, "Greater Magic Item", "removing one filter leaves the others");
  assert.deepEqual(activeFilters(BASE, CTX), [], "a fresh query has no active filters");
});

test("[fast] a yes/no property is a token of its own, in Title Case, and Clear all clears it (issue #182)", () => {
  const q: ItemQuery = { ...BASE, flags: ["spell channeling", "mage armor"] };
  const tokens = activeFilters(q, CTX);
  assert.deepEqual(tokens.map((t) => t.label), ["Spell Channeling", "Mage Armor"]);
  assert.deepEqual(tokens.map((t) => t.removeLabel), ["Remove filter: Spell Channeling", "Remove filter: Mage Armor"]);
  assert.deepEqual(tokens[0]!.remove(q).flags, ["mage armor"], "removing one leaves the other");
  assert.equal(tokens[0]!.cause(3), "None of the 3 stacks has Spell Channeling.");
  assert.deepEqual(clearAll(q).flags, []);
});

test("[fast] a weapon skill is a token of its own, and Clear all clears it (issue #188)", () => {
  const q: ItemQuery = { ...BASE, wskill: ["swordsmanship", "mace fighting"] };
  const tokens = activeFilters(q, CTX);
  assert.deepEqual(tokens.map((t) => t.label), ["Weapon skill: Swordsmanship", "Weapon skill: Mace Fighting"]);
  assert.deepEqual(tokens.map((t) => t.removeLabel), ["Remove filter: Weapon skill Swordsmanship", "Remove filter: Weapon skill Mace Fighting"]);
  assert.deepEqual(tokens[0]!.remove(q).wskill, ["mace fighting"], "removing one leaves the other");
  assert.equal(tokens[0]!.cause(3), "None of the 3 stacks is a Swordsmanship weapon.");
  assert.deepEqual(clearAll(q).wskill, []);
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

test("[fast] rarityMax has a token of its own, round-trips, and says why a result is empty", () => {
  const q: ItemQuery = { ...BASE, rarityMin: "Lesser Magic Item", rarityMax: "Lesser Artifact" };
  assert.deepEqual(parseItemQuery(queryParams(q)), q);
  const tokens = activeFilters(q, CTX);
  assert.deepEqual(tokens.map((t) => t.label), ["Rarity ≥ Lesser Magic Item", "Rarity ≤ Lesser Artifact"]);
  assert.deepEqual(tokens.map((t) => t.removeLabel), ["Remove filter: Rarity", "Remove filter: Rarity at most"]);
  const left = tokens[1]!.remove(q);
  assert.equal(left.rarityMax, "");
  assert.equal(left.rarityMin, "Lesser Magic Item", "removing the ceiling keeps the floor");
  assert.equal(emptyCause(activeFilters({ ...BASE, rarityMax: "Lesser Artifact" }, CTX), [], 160), "None of the 160 stacks is a Lesser Artifact or lower.");
  assert.equal(emptyCause(activeFilters({ ...BASE, rarityMax: "Minor Magic Item" }, CTX), [], 160), "None of the 160 stacks is a Minor Magic Item.");
});

test("[fast] tier and rule labels", () => {
  assert.equal(shortTier("Greater Magic Item"), "Greater Magic");
  assert.equal(shortTier("Major Artifact"), "Major Artifact");
  assert.equal(propRuleLabel({ key: "lmc", min: 8 }, CTX.propLabel), "LMC ≥ 8");
  assert.equal(propRuleLabel({ key: "hci", min: 3, op: "eq" }, CTX.propLabel), "HCI = 3");
});

test("[fast] the default columns are Tags and the nine of the spec, and every column lands in a picker group", () => {
  assert.deepEqual(DEFAULT_COLS, ["tags", "physResist", "fireResist", "coldResist", "poisonResist", "energyResist", "hci", "dci", "lmc", "lrc"]);
  assert.equal(colGroup("tags"), "Item");
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

// The Slayer filter's list (issue #189), laid out like the shard's slayer charts: each super slayer, then its lesser slayers.
const GROUPS = [
  { super: ["Demon"], slayers: ["Gargoyle"] },
  { super: ["Reptile"], slayers: ["Dragon", "Snake"] },
  { super: ["Undead", "Undead (Silver)"], slayers: [] },
  { super: ["Fey"], slayers: [] },
  { heading: "Talisman slayers", slayers: ["Bat", "Mage"] },
];
const f = (...pairs: Array<[string, number]>) => pairs.map(([name, count]) => ({ name, count }));
test("[fast] slayerLabel names a slayer the way its item does", () => {
  assert.equal(slayerLabel("Air Elemental"), "Air Elemental Slayer");
  assert.equal(slayerLabel("reptile"), "Reptile Slayer");
  assert.equal(slayerLabel("Undead (Silver)"), "Undead Slayer (Silver)", "a capitalized bracket is the item's own wording and stays");
  assert.equal(slayerLabel("Exorcism (demons)"), "Exorcism Slayer", "a lower-case bracket only describes the group and goes");
  assert.equal(slayerLabel("Repond (humanoids)"), "Repond Slayer");
});
test("[fast] slayerTree puts each super slayer before its lesser slayers, in the table's order", () => {
  assert.deepEqual(slayerTree(f(["Bat", 1], ["Dragon", 2], ["Reptile", 3], ["Snake", 4], ["Undead (Silver)", 5]), GROUPS), [
    { kind: "super", value: "Reptile", label: "Reptile Slayer", count: 3, first: true },
    { kind: "slayer", value: "Dragon", label: "Dragon Slayer", count: 2, level: 1 },
    { kind: "slayer", value: "Snake", label: "Snake Slayer", count: 4, level: 1 },
    { kind: "super", value: "Undead (Silver)", label: "Undead Slayer (Silver)", count: 5, first: true },
    { kind: "title", label: "Talisman slayers", first: true },
    { kind: "slayer", value: "Bat", label: "Bat Slayer", count: 1, level: 0 },
  ]);
});
test("[fast] slayerTree keeps a missing super slayer as a heading over its lesser slayers, and hides empty groups", () => {
  assert.deepEqual(slayerTree(f(["Gargoyle", 7]), GROUPS), [
    { kind: "super", value: null, label: "Demon Slayer", count: 0, first: true },
    { kind: "slayer", value: "Gargoyle", label: "Gargoyle Slayer", count: 7, level: 1 },
  ]);
  assert.deepEqual(slayerTree([], GROUPS), []);
});
test("[fast] slayerTree files a slayer the table lacks under Other, A–Z, and matches names in any case", () => {
  assert.deepEqual(slayerTree(f(["Zebra", 1], ["fey", 2], ["Balron", 3]), GROUPS), [
    { kind: "super", value: "fey", label: "Fey Slayer", count: 2, first: true },
    { kind: "title", label: "Other", first: true },
    { kind: "slayer", value: "Balron", label: "Balron Slayer", count: 3, level: 0 },
    { kind: "slayer", value: "Zebra", label: "Zebra Slayer", count: 1, level: 0 },
  ]);
});
test("[fast] slayerTree marks the first row of every group, so two super slayers in a row from different groups are kept apart", () => {
  assert.deepEqual(slayerTree(f(["Fey", 1], ["Undead", 2], ["Undead (Silver)", 3]), GROUPS).map((r) => r.kind !== "title" && "first" in r ? `${r.label} first` : r.label),
    ["Undead Slayer first", "Undead Slayer (Silver)", "Fey Slayer first"]);
});
test("[fast] slayerTree without a table is the plain A–Z list", () => {
  const plain = [{ kind: "slayer", value: "Dragon", label: "Dragon Slayer", count: 2, level: 0 }, { kind: "slayer", value: "Orc", label: "Orc Slayer", count: 1, level: 0 }];
  assert.deepEqual(slayerTree(f(["Orc", 1], ["Dragon", 2]), undefined), plain);
  assert.deepEqual(slayerTree(f(["Orc", 1], ["Dragon", 2]), []), plain);
});
