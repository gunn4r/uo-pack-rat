// item-query.test.mts — app/item-query.mts: parseItemQuery's defaults/clamps, applyItemQuery's predicate
// (parity with ui/inventory.mts's filtered()) and sort (parity with renderInventory()), facetsOf, and
// rarityRank. Hand-built fixture items (no scan files, no server) so this stays fast and pure.
import { test } from "node:test";
import assert from "node:assert/strict";
import { EXTRA_COLS, colVal, rarityRank, parseItemQuery, applyItemQuery, facetsOf } from "./item-query.mts";
import type { ItemQueryRows, ItemQueryGroups } from "./item-query.mts";
import { KINDS } from "./vault-lib.mts";
import type { Item } from "./vault-lib.mts";

const NOW = Date.parse("2026-09-16T00:00:00Z");
const daysAgo = (n: number) => new Date(NOW - n * 864e5).toISOString();

// Ascending tiers, lowest first — deliberately not alphabetical, so a rarity-ladder sort/rank test that
// accidentally fell back to string comparison would be caught.
const RARITY_LADDER = [
  { name: "Minor Magic Item", colour: "#aaa" },
  { name: "Lesser Artifact", colour: "#bbb" },
  { name: "Greater Artifact", colour: "#ccc" },
  { name: "Major Magic Item", colour: "#ddd" },
  { name: "Legendary Artifact", colour: "#eee" },
];

function mk(overrides: Record<string, unknown>): Item {
  const it: Record<string, unknown> = {
    name: "Item", kind: "gear", slot: "ring", location: { text: "Kestrel's backpack" }, rarity: null,
    slayers: [], tags: [], props: {}, extras: {}, amount: 1, seenAt: daysAgo(1), gargoyle: false, medable: true,
    ...overrides,
  };
  it.lines = it.lines || [it.name];
  // mk() deliberately builds a PARTIAL fixture: only the fields item-query.mts's functions actually
  // read (see the module header's field list) — not a full enriched Item (no serial/root/container/
  // equippedBy/...). Cast once here, at the test's own fixture boundary, per the migration plan's
  // "a test deliberately passing malformed input gets a cast at that call site" rule. Every real
  // caller (vault-lib's fold) only ever hands applyItemQuery/facetsOf genuine, fully-enriched Items.
  return it as unknown as Item;
}

const ITEMS: Item[] = [
  mk({ name: "Vile Ring", slot: "ring", rarity: "Lesser Artifact", slayers: ["Orc"], tags: ["cursed"], props: { hci: 10, dci: 5 }, seenAt: daysAgo(1), location: { text: "Kestrel's backpack" } }),
  mk({ name: "Gargish Kilt", slot: "legs", rarity: null, gargoyle: true, medable: false, props: { physResist: 5 }, seenAt: daysAgo(40), location: { text: "Kestrel's bank" } }),
  mk({ name: "Bandage", kind: "bandage", slot: null, amount: 50, props: {}, seenAt: daysAgo(2), location: { text: "Dorran's backpack" } }),
  mk({ name: "Composite Bow", slot: "twoHanded", rarity: "Greater Artifact", slayers: ["Repond (humanoids)"], props: { hci: 15, di: 20 }, seenAt: daysAgo(5), location: { text: "Kestrel's backpack" } }),
  mk({ name: "Iron Ingot", kind: "resource", slot: null, amount: 100, props: {}, seenAt: daysAgo(10), location: { text: "Kestrel's bank" } }),
  mk({ name: "Chainmail Tunic", slot: "chest", rarity: "Minor Magic Item", tags: ["antique"], medable: false, props: { physResist: 12, dci: 8 }, seenAt: daysAgo(3), location: { text: "Dorran's backpack" } }),
  mk({ name: "Orc Slayer Cutlass", slot: "oneHanded", rarity: "Legendary Artifact", slayers: ["Orc"], props: { hci: 20, di: 30 }, seenAt: daysAgo(15), location: { text: "Kestrel's backpack" } }),
  mk({ name: "Power Scroll", kind: "scroll", slot: null, props: {}, seenAt: daysAgo(60), location: { text: "Kestrel's bank" } }),
  mk({ name: "Leather Gloves", slot: "hands", props: { dci: 3 }, seenAt: daysAgo(1), location: { text: "Dorran's bank" } }),
  mk({ name: "Silver Katana", slot: "oneHanded", rarity: "Lesser Artifact", slayers: ["Undead (Silver)"], props: { hci: 12 }, seenAt: daysAgo(8), location: { text: "Kestrel's backpack" } }),
  mk({ name: "Cloth Robe", slot: "robe", tags: ["brittle"], props: { manaRegen: 2 }, seenAt: daysAgo(20), location: { text: "Dorran's bank" } }),
  mk({ name: "Talisman of Mercy", slot: "talisman", rarity: "Major Magic Item", props: { hpRegen: 4 }, seenAt: daysAgo(25), location: { text: "Kestrel's bank" } }),
];

const ctx = { rarity: RARITY_LADDER, now: NOW };
const names = (r: Item[]): string[] => r.map((it) => it.name);

test("[fast] parseItemQuery: defaults with no params", () => {
  const q = parseItemQuery(new URLSearchParams());
  assert.deepEqual(q, { q: "", slot: "", loc: "", rarity: "", kind: "", seenDays: 0, slayer: "", nogarg: false, med: false, hideTags: [], props: [], group: false, sort: "name", dir: 1, offset: 0, limit: 200 });
});

test("[fast] parseItemQuery: clamps limit to [1, 500], offset to >= 0", () => {
  assert.equal(parseItemQuery(new URLSearchParams("limit=9999")).limit, 500);
  assert.equal(parseItemQuery(new URLSearchParams("limit=0")).limit, 1);
  assert.equal(parseItemQuery(new URLSearchParams("limit=-50")).limit, 1);
  assert.equal(parseItemQuery(new URLSearchParams("limit=notanumber")).limit, 200, "a garbage limit falls back to the default, not NaN");
  assert.equal(parseItemQuery(new URLSearchParams("offset=-5")).offset, 0);
  assert.equal(parseItemQuery(new URLSearchParams("offset=12")).offset, 12);
});

test("[fast] parseItemQuery: dir, group, nogarg, med, hide, prop", () => {
  assert.equal(parseItemQuery(new URLSearchParams("dir=-1")).dir, -1);
  assert.equal(parseItemQuery(new URLSearchParams("dir=1")).dir, 1);
  assert.equal(parseItemQuery(new URLSearchParams("dir=garbage")).dir, 1);
  assert.equal(parseItemQuery(new URLSearchParams("group=1")).group, true);
  assert.equal(parseItemQuery(new URLSearchParams("nogarg=1")).nogarg, true);
  assert.equal(parseItemQuery(new URLSearchParams("med=1")).med, true);
  assert.deepEqual(parseItemQuery(new URLSearchParams("hide=cursed,antique")).hideTags, ["cursed", "antique"]);
  assert.deepEqual(parseItemQuery(new URLSearchParams("prop=hci:10,dci:5")).props, [{ key: "hci", min: 10 }, { key: "dci", min: 5 }]);
});

test("[fast] applyItemQuery: text search hits itemSearchBlob (name)", () => {
  const q = parseItemQuery(new URLSearchParams("q=vile"));
  const { rows } = applyItemQuery(ITEMS, q, ctx) as ItemQueryRows;
  assert.deepEqual(names(rows), ["Vile Ring"]);
});

test("[fast] applyItemQuery: kind filter", () => {
  const { rows } = applyItemQuery(ITEMS, parseItemQuery(new URLSearchParams("kind=bandage")), ctx) as ItemQueryRows;
  assert.deepEqual(names(rows), ["Bandage"]);
});

test("[fast] applyItemQuery: slot filter, including \"?\" for unknown slot", () => {
  assert.deepEqual(names((applyItemQuery(ITEMS, parseItemQuery(new URLSearchParams("slot=ring")), ctx) as ItemQueryRows).rows), ["Vile Ring"]);
  const unknownSlot = (applyItemQuery(ITEMS, parseItemQuery(new URLSearchParams("slot=%3F")), ctx) as ItemQueryRows).rows;
  assert.ok(unknownSlot.every((it) => !it.slot));
  assert.ok(names(unknownSlot).includes("Bandage") && names(unknownSlot).includes("Iron Ingot") && names(unknownSlot).includes("Power Scroll"));
});

test("[fast] applyItemQuery: location filter", () => {
  const { rows } = applyItemQuery(ITEMS, parseItemQuery(new URLSearchParams("loc=" + encodeURIComponent("Dorran's bank"))), ctx) as ItemQueryRows;
  assert.deepEqual(names(rows).sort(), ["Cloth Robe", "Leather Gloves"]);
});

test("[fast] applyItemQuery: rarity filter", () => {
  const { rows } = applyItemQuery(ITEMS, parseItemQuery(new URLSearchParams("rarity=" + encodeURIComponent("Lesser Artifact"))), ctx) as ItemQueryRows;
  assert.deepEqual(names(rows).sort(), ["Silver Katana", "Vile Ring"]);
});

test("[fast] applyItemQuery: seenDays cuts off anything older", () => {
  const { rows } = applyItemQuery(ITEMS, parseItemQuery(new URLSearchParams("seenDays=5")), ctx) as ItemQueryRows;
  assert.deepEqual(names(rows).sort(), ["Bandage", "Chainmail Tunic", "Composite Bow", "Leather Gloves", "Vile Ring"]);
});

test("[fast] applyItemQuery: slayer filter, including \"*\" for any slayer", () => {
  assert.deepEqual(names((applyItemQuery(ITEMS, parseItemQuery(new URLSearchParams("slayer=Orc")), ctx) as ItemQueryRows).rows).sort(), ["Orc Slayer Cutlass", "Vile Ring"]);
  assert.deepEqual(names((applyItemQuery(ITEMS, parseItemQuery(new URLSearchParams("slayer=%2A")), ctx) as ItemQueryRows).rows).sort(), ["Composite Bow", "Orc Slayer Cutlass", "Silver Katana", "Vile Ring"]);
});

test("[fast] applyItemQuery: nogarg excludes gargoyle-only gear", () => {
  const { rows } = applyItemQuery(ITEMS, parseItemQuery(new URLSearchParams("nogarg=1")), ctx) as ItemQueryRows;
  assert.ok(!names(rows).includes("Gargish Kilt"));
  assert.equal(rows.length, ITEMS.length - 1);
});

test("[fast] applyItemQuery: med excludes non-meditation-safe gear", () => {
  const { rows } = applyItemQuery(ITEMS, parseItemQuery(new URLSearchParams("med=1")), ctx) as ItemQueryRows;
  assert.ok(!names(rows).includes("Gargish Kilt") && !names(rows).includes("Chainmail Tunic"));
});

test("[fast] applyItemQuery: hideTags drops a tagged item even if it would otherwise match", () => {
  const { rows } = applyItemQuery(ITEMS, parseItemQuery(new URLSearchParams("hide=cursed")), ctx) as ItemQueryRows;
  assert.ok(!names(rows).includes("Vile Ring"));
});

test("[fast] applyItemQuery: prop min filters on colVal, including EXTRA_COLS keys", () => {
  const { rows } = applyItemQuery(ITEMS, parseItemQuery(new URLSearchParams("prop=hci:15")), ctx) as ItemQueryRows;
  assert.deepEqual(names(rows).sort(), ["Composite Bow", "Orc Slayer Cutlass"]);
  // EXTRA_COLS sanity: colVal reads strReq/weight off the item directly, not props.
  assert.equal(colVal({ strReq: 40, props: {} } as unknown as Item, "strReq"), 40);
  assert.equal(colVal({ weight: 3, props: {} } as unknown as Item, "weight"), 3);
  assert.ok(EXTRA_COLS.strReq && EXTRA_COLS.weight);
});

test("[fast] applyItemQuery: sort by a prop column — dir=1 is highest-first, dir=-1 is lowest-first", () => {
  const withHci = ITEMS.filter((it) => it.props.hci);
  const desc = (applyItemQuery(withHci, parseItemQuery(new URLSearchParams("sort=hci")), ctx) as ItemQueryRows).rows;
  assert.deepEqual(names(desc), ["Orc Slayer Cutlass", "Composite Bow", "Silver Katana", "Vile Ring"]);
  const asc = (applyItemQuery(withHci, parseItemQuery(new URLSearchParams("sort=hci&dir=-1")), ctx) as ItemQueryRows).rows;
  assert.deepEqual(names(asc), ["Vile Ring", "Silver Katana", "Composite Bow", "Orc Slayer Cutlass"]);
});

test("[fast] applyItemQuery: sort by rarity uses the ladder order, not alphabetical", () => {
  const withRarity = ITEMS.filter((it) => it.rarity);
  const { rows } = applyItemQuery(withRarity, parseItemQuery(new URLSearchParams("sort=rarity&dir=-1")), ctx) as ItemQueryRows;
  assert.deepEqual(names(rows), ["Chainmail Tunic", "Vile Ring", "Silver Katana", "Composite Bow", "Talisman of Mercy", "Orc Slayer Cutlass"]);
});

test("[fast] applyItemQuery: paging — offset/limit slice rows, total and pieces cover every match", () => {
  const q = parseItemQuery(new URLSearchParams("kind=gear&offset=2&limit=3"));
  const all = applyItemQuery(ITEMS, parseItemQuery(new URLSearchParams("kind=gear")), ctx) as ItemQueryRows;
  const page = applyItemQuery(ITEMS, q, ctx) as ItemQueryRows;
  assert.equal(page.rows.length, 3);
  assert.equal(page.total, all.total);
  assert.equal(page.pieces, all.pieces);
  assert.deepEqual(page.rows, all.rows.slice(2, 5));
});

test("[fast] applyItemQuery: group mode shapes rows as JSON-safe groups and sorts by amount/kind/name", () => {
  const items = [mk({ name: "Bandage", kind: "bandage", amount: 30, location: { text: "A" } }), mk({ name: "Bandage", kind: "bandage", amount: 20, location: { text: "B" } }), mk({ name: "Arrow", kind: "ammo", amount: 5, location: { text: "A" } })];
  const byAmount = applyItemQuery(items, parseItemQuery(new URLSearchParams("group=1&sort=amount")), ctx) as ItemQueryGroups;
  assert.equal(byAmount.total, 2);
  assert.deepEqual(byAmount.groups[0], { name: "Bandage", kind: "bandage", slot: items[0]!.slot, amount: 50, stacks: 2, locations: [["A", 30], ["B", 20]] });
  assert.ok(!("items" in byAmount.groups[0]!) && Array.isArray(byAmount.groups[0]!.locations));
  const byName = applyItemQuery(items, parseItemQuery(new URLSearchParams("group=1&sort=name")), ctx) as ItemQueryGroups;
  assert.deepEqual(byName.groups.map((g) => g.name), ["Arrow", "Bandage"]);
});

test("[fast] applyItemQuery: group mode sorts by Stacks when the page asks for it", () => {
  const items = [mk({ name: "Arrow", kind: "ammo", amount: 500 }), mk({ name: "Bandage", kind: "bandage", amount: 1 }), mk({ name: "Bandage", kind: "bandage", amount: 1 }), mk({ name: "Bandage", kind: "bandage", amount: 1 })];
  const most = applyItemQuery(items, parseItemQuery(new URLSearchParams("group=1&sort=stacks")), ctx) as ItemQueryGroups;
  assert.deepEqual(most.groups.map((g) => [g.name, g.stacks]), [["Bandage", 3], ["Arrow", 1]]);
  const fewest = applyItemQuery(items, parseItemQuery(new URLSearchParams("group=1&sort=stacks&dir=-1")), ctx) as ItemQueryGroups;
  assert.deepEqual(fewest.groups.map((g) => g.name), ["Arrow", "Bandage"]);
});

test("[fast] facetsOf: slots/locations/rarities/slayers/kinds/propKeys/gearSkills/itemCount", () => {
  const f = facetsOf(ITEMS, { rarity: RARITY_LADDER });
  assert.deepEqual(f.slots, [...new Set(ITEMS.map((i) => i.slot).filter(Boolean))].sort());
  assert.deepEqual(f.locations, [...new Set(ITEMS.map((i) => i.location!.text))].sort());
  assert.deepEqual(f.rarities, ["Minor Magic Item", "Lesser Artifact", "Greater Artifact", "Major Magic Item", "Legendary Artifact"], "ladder order, not alphabetical");
  assert.deepEqual(f.slayers.sort((a, b) => a.name.localeCompare(b.name)), [{ name: "Orc", count: 2 }, { name: "Repond (humanoids)", count: 1 }, { name: "Undead (Silver)", count: 1 }]);
  assert.equal(f.slayerAny, 4);
  assert.deepEqual(f.kinds.map((k) => k.name), KINDS.filter((k) => ITEMS.some((i) => i.kind === k)));
  assert.deepEqual(f.kinds.find((k) => k.name === "gear")!.count, ITEMS.filter((i) => i.kind === "gear").length);
  assert.ok(f.propKeys.includes("hci") && f.propKeys.includes("physResist"));
  // The fixture items below carry no skill-bonus extras, so this is an array, not a populated list —
  // GET /api/inventory's demo-data equivalent (app/server.test.mts) checks the populated case, this
  // one checks facetsOf actually calls gearSkills() and returns its shape (regression: builder.mts's
  // renderProfile used to call gearSkills(state.inv) directly, which broke when GET /api/inventory
  // stopped shipping the full item map — facetsOf.gearSkills is what it reads instead, now).
  assert.deepEqual(f.gearSkills, []);
  assert.equal(f.itemCount, ITEMS.length);
});

test("[fast] rarityRank: known names rank in ladder order, unknown → 0", () => {
  assert.equal(rarityRank(RARITY_LADDER, "Minor Magic Item"), 1);
  assert.equal(rarityRank(RARITY_LADDER, "legendary artifact"), 5, "case-insensitive");
  assert.equal(rarityRank(RARITY_LADDER, "Not A Real Tier"), 0);
  assert.equal(rarityRank(RARITY_LADDER, null), 0);
  assert.equal(rarityRank([], "Minor Magic Item"), 0);
});
