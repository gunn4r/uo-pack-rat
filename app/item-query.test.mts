// item-query.test.mts — app/item-query.mts: parseItemQuery's defaults/clamps, applyItemQuery's predicate
// (parity with ui/inventory.mts's filtered()) and sort (parity with renderInventory()), facetsOf, and
// rarityRank. Hand-built fixture items (no scan files, no server) so this stays fast and pure.
import { test } from "node:test";
import assert from "node:assert/strict";
import { EXTRA_COLS, colVal, rarityRank, parseItemQuery, applyItemQuery, facetsOf, matchesItem } from "./item-query.mts";
import type { ItemQueryRows, ItemQueryGroups, RuleQuery } from "./item-query.mts";
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
  assert.deepEqual(q, { q: "", chars: [], slot: [], loc: [], roots: [], rarity: "", rarityMin: "", rarityMax: "", kind: [], seenDays: 0, slayer: "", nogarg: false, med: false, hideTags: [], tags: [], props: [], group: false, sort: "name", dir: 1, offset: 0, limit: 200 });
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
  const items = [mk({ serial: 11, name: "Bandage", kind: "bandage", amount: 30, location: { text: "A" } }), mk({ serial: 12, name: "Bandage", kind: "bandage", amount: 20, location: { text: "B" } }), mk({ serial: 13, name: "Arrow", kind: "ammo", amount: 5, location: { text: "A" } })];
  const byAmount = applyItemQuery(items, parseItemQuery(new URLSearchParams("group=1&sort=amount")), ctx) as ItemQueryGroups;
  assert.equal(byAmount.total, 2);
  assert.deepEqual(byAmount.groups[0], { name: "Bandage", kind: "bandage", slot: items[0]!.slot, amount: 50, stacks: 2, locations: [["A", 30], ["B", 20]], serial: 11 }, "serial: the first stack in the list's order");
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

test("[fast] parseItemQuery: list filters take repeated params, slot and kind also a comma list", () => {
  const q = parseItemQuery(new URLSearchParams("char=Dorran&char=Kestrel&slot=ring,legs&kind=gear&kind=reagent&loc=" + encodeURIComponent("Metal Chest, left") + "&root=12&root=junk"));
  assert.deepEqual(q.chars, ["Dorran", "Kestrel"]);
  assert.deepEqual(q.slot, ["ring", "legs"]);
  assert.deepEqual(q.kind, ["gear", "reagent"]);
  assert.deepEqual(q.loc, ["Metal Chest, left"], "a location name keeps its comma");
  assert.deepEqual(q.roots, [12], "a serial that is not a number is dropped");
});

test("[fast] parseItemQuery: prop rules carry an operator, and an unknown one drops the rule", () => {
  assert.deepEqual(parseItemQuery(new URLSearchParams("prop=hci:ge:10&prop=lmc:le:4&prop=fc:eq:2&prop=dci:gt:1")).props,
    [{ key: "hci", min: 10 }, { key: "lmc", min: 4, op: "le" }, { key: "fc", min: 2, op: "eq" }]);
});

test("[fast] applyItemQuery: any-of lists for slot, kind, character and location", () => {
  const withOwners = ITEMS.map((it) => ({ ...it, location: { ...it.location!, character: it.location!.text.startsWith("Dorran") ? "Dorran" : "Kestrel" } }));
  const rows = (s: string): string[] => names((applyItemQuery(withOwners, parseItemQuery(new URLSearchParams(s)), ctx) as ItemQueryRows).rows).sort();
  assert.deepEqual(rows("slot=ring,hands"), ["Leather Gloves", "Vile Ring"]);
  assert.deepEqual(rows("kind=bandage&kind=resource"), ["Bandage", "Iron Ingot"]);
  assert.deepEqual(rows("char=Dorran"), ["Bandage", "Chainmail Tunic", "Cloth Robe", "Leather Gloves"]);
  assert.deepEqual(rows("loc=" + encodeURIComponent("Dorran's bank") + "&loc=" + encodeURIComponent("Dorran's backpack")), ["Bandage", "Chainmail Tunic", "Cloth Robe", "Leather Gloves"]);
});

test("[fast] applyItemQuery: a root filter matches everything inside that container", () => {
  const items = [mk({ name: "In chest", root: 7, location: { text: "Chest" } }), mk({ name: "In pouch", root: 7, location: { text: "Chest › Pouch" } }), mk({ name: "Elsewhere", root: 8, location: { text: "Box" } })];
  assert.deepEqual(names((applyItemQuery(items, parseItemQuery(new URLSearchParams("root=7")), ctx) as ItemQueryRows).rows).sort(), ["In chest", "In pouch"]);
  assert.deepEqual(names((applyItemQuery(items, parseItemQuery(new URLSearchParams("root=7&loc=Box")), ctx) as ItemQueryRows).rows).sort(), ["Elsewhere", "In chest", "In pouch"], "a root and a location add up");
});

test("[fast] applyItemQuery: rarityMin keeps that tier and every tier above it on the ladder", () => {
  const { rows } = applyItemQuery(ITEMS, parseItemQuery(new URLSearchParams("rarityMin=" + encodeURIComponent("Greater Artifact"))), ctx) as ItemQueryRows;
  assert.deepEqual(names(rows).sort(), ["Composite Bow", "Orc Slayer Cutlass", "Talisman of Mercy"]);
});

test("[fast] applyItemQuery: rarityMax keeps that tier, the tiers below it and items with no tier", () => {
  const rows = (s: string, items = ITEMS): string[] => names((applyItemQuery(items, parseItemQuery(new URLSearchParams(s)), ctx) as ItemQueryRows).rows).sort();
  const max = (t: string): string => "kind=gear&rarityMax=" + encodeURIComponent(t);
  assert.deepEqual(rows(max("Lesser Artifact")), ["Chainmail Tunic", "Cloth Robe", "Gargish Kilt", "Leather Gloves", "Silver Katana", "Vile Ring"]);
  assert.deepEqual(rows(`${max("Greater Artifact")}&rarityMin=${encodeURIComponent("Lesser Artifact")}`), ["Composite Bow", "Silver Katana", "Vile Ring"], "a band");
  assert.deepEqual(rows(`${max("Lesser Artifact")}&rarityMin=${encodeURIComponent("Greater Artifact")}`), [], "a floor above the ceiling matches nothing");
  assert.equal(rows(max("Not A Tier")).length, ITEMS.filter((i) => i.kind === "gear").length, "an unknown ceiling filters nothing");
  assert.deepEqual(rows(max("Minor Magic Item"), [mk({ name: "Reforged Blade", rarity: "Reforged Lesser Artifact" })]), ["Reforged Blade"], "a tier off the ladder ranks with no tier");
});

test("[fast] parseItemQuery reads rarityMax", () => {
  assert.equal(parseItemQuery(new URLSearchParams("rarityMax=Lesser%20Artifact")).rarityMax, "Lesser Artifact");
});

// A rule query from the Inventory's own wire form, minus what a rule never keeps (Organize, issue #11).
function rule(s: string): RuleQuery {
  const { loc, roots, chars, seenDays, group, sort, dir, offset, limit, ...rq } = parseItemQuery(new URLSearchParams(s));
  return rq;
}
const ruleNames = (s: string, items = ITEMS): string[] => names(items.filter((it) => matchesItem(it, rule(s), { rarity: RARITY_LADDER }))).sort();

test("[fast] matchesItem agrees with applyItemQuery on every filter a rule keeps", () => {
  for (const s of ["", "kind=gear", "slot=ring,?", "rarity=Lesser%20Artifact", "rarityMin=Greater%20Artifact", "rarityMax=Lesser%20Artifact", "slayer=*", "slayer=Orc", "nogarg=1", "med=1", "hide=cursed", "tag=cursed,brittle", "prop=hci:ge:12", "prop=dci:le:5&kind=gear", "q=orc"]) {
    assert.deepEqual(ruleNames(s), names((applyItemQuery(ITEMS, parseItemQuery(new URLSearchParams(s)), ctx) as ItemQueryRows).rows).sort(), s);
  }
});

test("[fast] matchesItem: free text matches the item, never where it sits", () => {
  const sword = mk({ name: "Katana", location: { text: "Reagents", character: "Dorran" } });
  assert.equal(matchesItem(sword, rule("q=reagents")), false, "a rule for reagents must not claim a sword in a chest labelled Reagents");
  assert.equal((applyItemQuery([sword], parseItemQuery(new URLSearchParams("q=reagents")), ctx) as ItemQueryRows).total, 1, "the Inventory search still finds it by place");
  assert.equal(matchesItem(mk({ name: "Mandrake Root", kind: "reagent", slot: null }), rule("q=reagent")), true, "kind is the item's own");
  assert.equal(matchesItem(ITEMS.find((i) => i.name === "Orc Slayer Cutlass")!, rule("q=legendary")), true, "rarity is the item's own");
  assert.equal(matchesItem(mk({ name: "Garlic", lines: ["Garlic", "Crafted By Nobody"] }), rule("q=crafted")), true, "tooltip lines count");
  assert.equal(matchesItem(ITEMS[0]!, { ...rule(""), q: "  VILE " }), true, "rule text read from a file is trimmed and lower-cased here");
});

test("[fast] matchesItem: location, character and age never filter a rule", () => {
  const far = mk({ name: "Old Ring", seenAt: daysAgo(400), location: { text: "Somewhere else", character: "Nobody" } });
  assert.equal(matchesItem(far, rule("")), true);
});

test("[fast] matchesItem: a power scroll rule by level", () => {
  const scroll = mk({ name: "An Exalted Scroll Of Magery (110 Skill)", kind: "scroll", slot: null, props: { psLevel: 110 } });
  assert.equal(matchesItem(scroll, rule("kind=scroll&prop=psLevel:eq:110")), true);
  assert.equal(matchesItem(scroll, rule("kind=scroll&prop=psLevel:eq:115")), false);
});

// Issue #133: an Undesirables rule's filters, a threshold on a line no property models and a tag the item must have.
const SPLINTERS = [
  mk({ name: "Splintering Axe", slot: "twoHanded", tags: ["brittle"], extras: { "splintering weapon": 20, "weapon speed": 3.25, durability: [5, 40] } }),
  mk({ name: "Splintering Kryss", slot: "oneHanded", tags: ["antique"], extras: { "splintering weapon": 10, swordsmanship: 5 } }),
  mk({ name: "Plain Axe", slot: "twoHanded", tags: ["brittle"], extras: { "weapon speed": 3.5 } }),
];
test("[fast] matchesItem: a numeric extra takes a threshold, and tags keeps only items with any of its tags (issue #133)", () => {
  assert.equal(colVal(SPLINTERS[0]!, "splintering weapon"), 20);
  assert.equal(colVal(SPLINTERS[0]!, "durability"), 0, "a range is no number to compare");
  assert.deepEqual(ruleNames("prop=splintering%20weapon:ge:15", SPLINTERS), ["Splintering Axe"]);
  assert.deepEqual(ruleNames("prop=splintering%20weapon:1&tag=brittle", SPLINTERS), ["Splintering Axe"]);
  assert.deepEqual(ruleNames("tag=brittle,antique", SPLINTERS), ["Plain Axe", "Splintering Axe", "Splintering Kryss"]);
  assert.deepEqual(ruleNames("tag=cursed", SPLINTERS), []);
  assert.deepEqual(parseItemQuery(new URLSearchParams("tag=brittle&tag=cursed")).tags, ["brittle", "cursed"]);
  const { tags, ...old } = rule("prop=splintering%20weapon:1");
  assert.equal(matchesItem(SPLINTERS[1]!, old), true, "a rule saved before tags existed has none, and requires none");
  assert.deepEqual(names((applyItemQuery(SPLINTERS, parseItemQuery(new URLSearchParams("tag=brittle&prop=splintering%20weapon:1")), ctx) as ItemQueryRows).rows), ["Splintering Axe"]);
});
test("[fast] facetsOf: extraKeys lists the numeric extras, never a skill bonus or a range, and propKeys stays the modelled properties", () => {
  const f = facetsOf(SPLINTERS);
  assert.deepEqual(f.extraKeys, ["splintering weapon", "weapon speed"]);
  assert.deepEqual(f.propKeys, []);
});

test("[fast] applyItemQuery: prop rules at most and exactly", () => {
  const rows = (s: string): string[] => names((applyItemQuery(ITEMS, parseItemQuery(new URLSearchParams(s)), ctx) as ItemQueryRows).rows).sort();
  assert.deepEqual(rows("kind=gear&prop=hci:le:10&prop=hci:ge:1"), ["Vile Ring"]);
  assert.deepEqual(rows("prop=dci:eq:8"), ["Chainmail Tunic"]);
});

test("[fast] applyItemQuery: group mode also reports the stacks and pieces behind the names", () => {
  const g = applyItemQuery(ITEMS, parseItemQuery(new URLSearchParams("group=1&kind=bandage,resource")), ctx) as ItemQueryGroups;
  assert.equal(g.total, 2);
  assert.equal(g.stacks, 2);
  assert.equal(g.pieces, 150);
});

test("[fast] facetsOf: places name each location's owner, root and stack count", () => {
  const items = [mk({ name: "A", root: 7, location: { text: "Chest", character: "Dorran", kind: "ground", root: 7, rootName: "Chest" } }), mk({ name: "B", root: 7, location: { text: "Chest", character: "Dorran", kind: "ground", root: 7, rootName: "Chest" } }), mk({ name: "C", location: { text: "Worn by Kestrel", character: "Kestrel", kind: "equipped", root: null } })];
  assert.deepEqual(facetsOf(items).places, [
    { text: "Chest", character: "Dorran", kind: "ground", root: 7, rootName: "Chest", count: 2 },
    { text: "Worn by Kestrel", character: "Kestrel", kind: "equipped", root: null, rootName: "Worn by Kestrel", count: 1 },
  ]);
});

test("[fast] rarityRank: known names rank in ladder order, unknown → 0", () => {
  assert.equal(rarityRank(RARITY_LADDER, "Minor Magic Item"), 1);
  assert.equal(rarityRank(RARITY_LADDER, "legendary artifact"), 5, "case-insensitive");
  assert.equal(rarityRank(RARITY_LADDER, "Not A Real Tier"), 0);
  assert.equal(rarityRank(RARITY_LADDER, null), 0);
  assert.equal(rarityRank([], "Minor Magic Item"), 0);
});
