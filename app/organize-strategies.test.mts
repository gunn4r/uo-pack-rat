// organize-strategies.test.mts — app/organize-strategies.mts, Organize's Auto mode (issue #11, spec §5): the
// Simple and Detailed group tables, assignGroups, and proposeOrganize on hand-built house scans
// (app/organize-fixture.mts) folded by the real foldSnapshots. Pure: no server. Tags: [fast].
// Run: node --test app/organize-strategies.test.mts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { foldSnapshots, setRules, type Inventory } from "./vault-lib.mts";
import { houseScan, AT, type BoxSpec, type ThingSpec } from "./organize-fixture.mts";
import { checkOrganizeConfig, emptyOrganizeConfig, emptyRuleQuery, type OrganizeConfig, type OrganizeRule } from "./organize-config.mts";
import { planOrganize, type OverlayMove } from "./organize.mts";
import type { RulesV1 } from "./schema/types.d.mts";
import { STRATEGIES, STRATEGY_IDS, groupItems, assignGroups, proposeOrganize, type Offer, type Proposal, type ProposeOptions } from "./organize-strategies.mts";

const HERE = dirname(fileURLToPath(import.meta.url));
setRules(JSON.parse(readFileSync(join(HERE, "rules", "uoalive.json"), "utf8")) as RulesV1);
const NOW = Date.parse(AT) + 3600e3;
const A = 0x40000001, B = 0x40000002, C = 0x40000003, D = 0x40000004, E = 0x40000005, FAR = 0x40000006, BAG = 0x40000007, S = 0x40000008;
const at = (x: number, facet = 1) => ({ x, y: 100, z: 0, facet });
const OPTS = (over: Partial<ProposeOptions> = {}): ProposeOptions => ({ strategy: "simple", now: NOW, ...over });
const ok = (r: ReturnType<typeof proposeOrganize>): Proposal => { assert.ok(r.ok, r.ok ? "" : r.error); return (r as { ok: true; proposal: Proposal }).proposal; };
const manual = (serial: number, name: string, pinned = false) => ({ serial, name, origin: "manual" as const, ...(pinned ? { pinned: true } : {}) });
const fold = (boxes: BoxSpec[], things: ThingSpec[] = []): Inventory => foldSnapshots([houseScan({ boxes, things })]);
// One of each thing the strategies sort (Task 0 checked how each classifies), in serial order.
const NAMES = ["Black Pearl", "Ruby", "Katana", "Platemail Gorget", "Gold Necklace", "Gold Ring", "Bone Armor", "Heater Shield", "Spellbook", "Greater Heal Potion", "Bandage", "Iron Ingot", "Recall Rune", "Scissors", "Greater Heal", "An Exalted Scroll Of Mysticism (110 Skill)", "Apple", "Grave Dust", "Board"];
const ITEM = 0x40001000;
// A spell's name is a scroll only on a scroll graphic (issue #134), and the fixture's default graphic is a reagent's.
const gfx = (name: string): { graphic?: number } => (name === "Greater Heal" ? { graphic: 0x1F49 } : {});
const things = (inBox: number, names: readonly string[] = NAMES, from = 1): ThingSpec[] => names.map((name, i) => ({ serial: ITEM + from + i, name, in: inBox, ...gfx(name) }));
const grouped = (strategy: keyof typeof STRATEGIES): [string, string, string[]][] =>
  groupItems(STRATEGIES[strategy], Object.values(fold([{ serial: A }], things(A)).items)).map((g) => [g.key, g.name, g.items.map((it) => it.name)]);

test("[fast] every Simple, Detailed and By build group is made of valid rule filters, under unique keys", () => {
  for (const [id, defs] of Object.entries(STRATEGIES)) {
    const keys = defs.map((d) => d.key);
    assert.equal(new Set(keys).size, keys.length, `${id}: group keys are unique`);
    const rules: OrganizeRule[] = defs.flatMap((d) => d.matches.map((match, i) => ({ id: `${d.key}-${i}`, name: d.name, match, targets: [], origin: `strategy:${id}` as const })));
    const checked = checkOrganizeConfig({ ...emptyOrganizeConfig(), rules });
    assert.equal(checked.ok, true, checked.ok ? "" : checked.error);
  }
});

test("[fast] Simple: one group per family, gear sorted by slot before any name pattern, Other last", () => {
  assert.deepEqual(grouped("simple"), [
    ["armour", "Armour", ["Platemail Gorget", "Bone Armor"]],
    ["jewelry", "Jewelry", ["Gold Necklace", "Gold Ring"]],
    ["weapons", "Weapons", ["Katana", "Heater Shield", "Spellbook"]],
    ["reagents", "Reagents", ["Black Pearl", "Grave Dust"]],
    ["skill-scrolls", "Skill scrolls", ["An Exalted Scroll Of Mysticism (110 Skill)"]],
    ["scrolls", "Spell scrolls", ["Greater Heal"]],
    ["resources", "Resources", ["Iron Ingot", "Board"]],
    ["potions", "Potions & bandages", ["Greater Heal Potion", "Bandage"]],
    ["runes-books", "Runes & books", ["Recall Rune"]],
    ["gems", "Gems", ["Ruby"]],
    ["tools", "Tools", ["Scissors"]],
    ["other", "Other", ["Apple"]],
  ]);
});

test("[fast] Detailed: transcendence, spell and other scrolls, treasure maps, refinements, instruments and ammo each have a group (issue #123)", () => {
  const names = ["Scroll Of Transcendence", "Greater Heal", "Scroll Of Alacrity", "A Tattered Treasure Map Leading To A Mage's Cache", "Varnish Of Defense", "Cure Of Protection",
    "Drum", "Tambourine", "Lap Harp", "Bamboo Flute", "Lute", "Fire Horn", "Arrow", "Crossbow Bolt", "Apple", "Katana"];
  const groups = groupItems(STRATEGIES.detailed, Object.values(fold([{ serial: A }], things(A, names)).items));
  assert.deepEqual(groups.map((g) => [g.key, g.name, g.family, g.items.map((it) => it.name)]), [
    ["weapons", "Weapons", "weapons", ["Katana"]],
    ["ammo", "Ammo", "weapons", ["Arrow", "Crossbow Bolt"]],
    ["transcendence-scrolls", "Transcendence scrolls", "scrolls", ["Scroll Of Transcendence"]],
    ["other-scrolls", "Other scrolls", "scrolls", ["Scroll Of Alacrity"]],
    ["magery-scrolls", "Magery scrolls", "scrolls", ["Greater Heal"]],
    ["refinements", "Refinements", "resources", ["Varnish Of Defense", "Cure Of Protection"]],
    ["treasure-maps", "Treasure maps & SOS", "maps", ["A Tattered Treasure Map Leading To A Mage's Cache"]],
    ["instruments", "Instruments", "tools", ["Drum", "Tambourine", "Lap Harp", "Bamboo Flute", "Lute", "Fire Horn"]],
    ["other", "Other", "other", ["Apple"]],
  ]);
});

test("[fast] Detailed: gear by slot, reagents by school, power scrolls by level, spell scrolls by school, resources by type", () => {
  assert.deepEqual(grouped("detailed").map(([key, , names]) => [key, names]), [
    ["armour-neck", ["Platemail Gorget"]],
    ["armour-chest", ["Bone Armor"]],
    ["rings", ["Gold Ring"]],
    ["necklaces", ["Gold Necklace"]],
    ["shields", ["Heater Shield"]],
    ["spellbooks", ["Spellbook"]],
    ["weapons", ["Katana"]],
    ["magery-reagents", ["Black Pearl"]],
    ["necromancy-reagents", ["Grave Dust"]],
    ["power-scrolls-110", ["An Exalted Scroll Of Mysticism (110 Skill)"]],
    ["magery-scrolls", ["Greater Heal"]],
    ["ingots", ["Iron Ingot"]],
    ["boards", ["Board"]],
    ["potions", ["Greater Heal Potion"]],
    ["bandages", ["Bandage"]],
    ["runes", ["Recall Rune"]],
    ["gems", ["Ruby"]],
    ["tools", ["Scissors"]],
    ["other", ["Apple"]],
  ]);
});

// Issue #134: the scrolls a house holds, as the shard names them. A graphic of 0 is a scan that has none.
const SCROLLS: ThingSpec[] = ([
  ["A Legendary Scroll Of Fencing (120 Skill)", 0x14F0], ["Scroll Of Transcendence", 0x14EF], ["Scroll Of Alacrity", 0x14EF], ["Scroll Binder", 0x14F0],
  ["A Wondrous Scroll Of Power (+5 Maximum Stats)", 0x14F0], ["Blank Scroll", 0x0EF3], ["Curse", 0x1F46], ["Curse Weapon", 0x2263], ["Healing Stone", 0x2D9F],
  ["Word Of Death", 0x2D5B], ["Remove Curse", 0], ["Confidence", 0], ["Healing Stone", 0x4078],
] as const).map(([name, graphic], i) => ({ serial: ITEM + 100 + i, name, graphic, in: A }));

test("[fast] Simple: skill scrolls apart from spell scrolls (a Chivalry or Bushido name with no graphic among them), blank scrolls with the resources, and a conjured Healing Stone is no scroll (issue #134)", () => {
  assert.deepEqual(groupItems(STRATEGIES.simple, Object.values(fold([{ serial: A }], SCROLLS).items)).map((g) => [g.key, g.name, g.items.map((it) => it.name)]), [
    ["skill-scrolls", "Skill scrolls", ["A Legendary Scroll Of Fencing (120 Skill)", "Scroll Of Transcendence", "Scroll Of Alacrity", "Scroll Binder", "A Wondrous Scroll Of Power (+5 Maximum Stats)"]],
    ["scrolls", "Spell scrolls", ["Curse", "Curse Weapon", "Healing Stone", "Word Of Death", "Remove Curse", "Confidence"]],
    ["resources", "Resources", ["Blank Scroll"]],
    ["other", "Other", ["Healing Stone"]],
  ]);
});

test("[fast] Detailed: spell scrolls by school, by exact name on the school's graphic; one of no school stays in Spell scrolls (issue #134)", () => {
  assert.deepEqual(groupItems(STRATEGIES.detailed, Object.values(fold([{ serial: A }], SCROLLS).items)).map((g) => [g.key, g.name, g.items.map((it) => it.name)]), [
    ["power-scrolls-120", "Power scrolls 120", ["A Legendary Scroll Of Fencing (120 Skill)"]],
    ["transcendence-scrolls", "Transcendence scrolls", ["Scroll Of Transcendence"]],
    ["other-scrolls", "Other scrolls", ["Scroll Of Alacrity", "Scroll Binder", "A Wondrous Scroll Of Power (+5 Maximum Stats)"]],
    ["magery-scrolls", "Magery scrolls", ["Curse"]],
    ["necromancy-scrolls", "Necromancy scrolls", ["Curse Weapon"]],
    ["mysticism-scrolls", "Mysticism scrolls", ["Healing Stone"]],
    ["spellweaving-scrolls", "Spellweaving scrolls", ["Word Of Death"]],
    ["scrolls", "Spell scrolls", ["Remove Curse", "Confidence"]],
    ["resources", "Other resources", ["Blank Scroll"]],
    ["other", "Other", ["Healing Stone"]],
  ]);
});

test("[fast] every strategy gives treasure maps, messages in a bottle and SOS a group of their own kind, so their chest is never shared (issue #134)", () => {
  const names = ["A Tattered Treasure Map Leading To A Mage's Hoard", "A Message In A Bottle", "A Waterstained SOS", "Local Map", "Apple"];
  for (const id of STRATEGY_IDS) {
    assert.deepEqual(STRATEGIES[id].filter((d) => d.family === "maps").map((d) => d.key), ["treasure-maps"], id);
    const groups = groupItems(STRATEGIES[id], Object.values(fold([{ serial: A }], things(A, names)).items));
    assert.deepEqual(groups.map((g) => [g.key, g.name, g.items.map((it) => it.name)]), [
      ["treasure-maps", "Treasure maps & SOS", ["A Tattered Treasure Map Leading To A Mage's Hoard", "A Message In A Bottle", "A Waterstained SOS"]],
      ["other", "Other", ["Local Map", "Apple"]],
    ], id);
  }
});

test("[fast] Detailed: Spellbooks share a chest with the books, not the weapons (issue #123)", () => {
  const family = (key: string): string => STRATEGIES.detailed.find((d) => d.key === key)!.family;
  assert.deepEqual(["spellbooks", "books", "runes"].map(family), ["runes-books", "runes-books", "runes-books"]);
});

// Issue #123: the neck slot holds armour and necklaces alike; both strategies split them with the one Armour: neck
// filter, which knows the Armor Of Initiation piece (a gorget graphic under the set's name) too.
test("[fast] Simple and By build: refinements are Resources by the group's second rule, instruments are Tools by their kind, and no word merely holding an instrument's name is one (issue #129)", () => {
  const names = ["Varnish Of Defense", "Gloss Of Protection", "Drum", "Tambourine", "Standing Harp", "Fire Horn", "Iron Ingot", "Scissors", "Apple", "Harpy Wing", "Hard Rum", "Absolute Zero"];
  const items = Object.values(fold([{ serial: A }], things(A, names)).items);
  for (const strategy of ["simple", "build"] as const) {
    assert.deepEqual(groupItems(STRATEGIES[strategy], items).map((g) => [g.key, g.items.map((it) => it.name)]), [
      ["resources", ["Varnish Of Defense", "Gloss Of Protection", "Iron Ingot"]],
      ["tools", ["Drum", "Tambourine", "Standing Harp", "Fire Horn", "Scissors"]],
      ["other", ["Apple", "Harpy Wing", "Hard Rum", "Absolute Zero"]],
    ], strategy);
  }
  assert.deepEqual(groupItems(STRATEGIES.detailed, items).find((g) => g.key === "instruments")?.items.map((it) => it.name), ["Drum", "Tambourine", "Standing Harp", "Fire Horn"]);
  // The Resources group's first rule keeps its id, so a setup an earlier proposal saved still matches it.
  const inv = fold([{ serial: A }, { serial: B, pos: at(102) }, { serial: C, pos: at(104) }], things(A, names));
  const rules = ok(proposeOrganize(inv, emptyOrganizeConfig(), [], OPTS())).config.rules;
  assert.deepEqual(rules.filter((r) => /resources|tools/.test(r.id)).map((r) => [r.id, r.match]), [
    ["auto-resources", { query: { ...emptyRuleQuery(), kind: ["resource"] } }], ["auto-resources-2", { query: { ...emptyRuleQuery(), kind: ["refinement"] } }],
    ["auto-tools", { query: { ...emptyRuleQuery(), kind: ["tool"] } }],
  ]);
});

test("[fast] Simple and Detailed: neck armour goes with the armour, necklaces with the jewelry", () => {
  const neck: ThingSpec[] = [
    { serial: ITEM + 1, name: "Leather Gorget", in: A }, { serial: ITEM + 2, name: "Studded Gorget", in: A },
    { serial: ITEM + 3, name: "Armor Of Initiation", in: A, graphic: 5063, lines: ["Physical Resist 7%"] },
    { serial: ITEM + 4, name: "Gold Necklace", in: A }, { serial: ITEM + 5, name: "Gold Beads", in: A },
  ];
  const items = Object.values(fold([{ serial: A }], neck).items);
  const of = (id: keyof typeof STRATEGIES) => groupItems(STRATEGIES[id], items).map((g) => [g.key, g.items.map((it) => it.name)]);
  assert.deepEqual(of("simple"), [["armour", ["Leather Gorget", "Studded Gorget", "Armor Of Initiation"]], ["jewelry", ["Gold Necklace", "Gold Beads"]]]);
  assert.deepEqual(of("detailed"), [["armour-neck", ["Leather Gorget", "Studded Gorget", "Armor Of Initiation"]], ["necklaces", ["Gold Necklace", "Gold Beads"]]]);
});

// Gear for By build, one piece of each build, each written as its tooltip reads.
const BUILD_GEAR: ThingSpec[] = [
  { name: "Gold Ring", lines: ["Faster Casting 1", "Lower Mana Cost 8"] },
  { name: "Katana", lines: ["Hit Chance Increase 15", "Swing Speed Increase 10"] },
  { name: "Gold Bracelet", lines: ["Faster Casting 1", "Damage Increase 10"] },
  { name: "Platemail Gorget", lines: ["Physical Resist 10", "Fire Resist 10"] },
  { name: "Leather Gloves", lines: ["Physical Resist 5"] },
].map((t, i) => ({ serial: ITEM + 100 + i, in: A, ...t }));

test("[fast] By build: gear by caster and melee markers into Caster, Melee, Hybrid, Tank and Other gear; everything else as Simple groups it", () => {
  const items = Object.values(fold([{ serial: A }], [...things(A, ["Black Pearl", "Spellbook", "Ruby", "Apple"]), ...BUILD_GEAR]).items);
  assert.deepEqual(groupItems(STRATEGIES.build, items).map((g) => [g.key, g.name, g.items.map((it) => it.name)]), [
    ["caster-gear", "Caster gear", ["Spellbook", "Gold Ring"]],
    ["melee-gear", "Melee gear", ["Katana"]],
    ["hybrid-gear", "Hybrid gear", ["Gold Bracelet"]],
    ["tank-gear", "Tank gear", ["Platemail Gorget"]],
    ["plain-gear", "Other gear", ["Leather Gloves"]],
    ["reagents", "Reagents", ["Black Pearl"]],
    ["gems", "Gems", ["Ruby"]],
    ["other", "Other", ["Apple"]],
  ]);
  assert.deepEqual(STRATEGIES.build.slice(5), STRATEGIES.simple.filter((d) => !["armour", "jewelry", "weapons", "other-gear"].includes(d.key)), "the groups after the gear are Simple's own");
});

test("[fast] switching strategy replaces the earlier strategy's rules and labels and keeps the player's own", () => {
  const inv = fold([{ serial: A }, { serial: B, pos: at(102) }, { serial: C, pos: at(104) }], [...things(A, ["Black Pearl"]), ...things(B, ["Ruby"], 2), ...BUILD_GEAR.map((t) => ({ ...t, in: C }))]);
  const simple = ok(proposeOrganize(inv, emptyOrganizeConfig(), [], OPTS())).config;
  const cfg: OrganizeConfig = { ...simple, rules: [{ id: "rule-1", name: "Apples", match: { query: emptyRuleQuery(), names: ["apple"] }, targets: [B], origin: "manual" }, ...simple.rules] };
  const build = ok(proposeOrganize(inv, cfg, [], OPTS({ strategy: "build" }))).config;
  assert.deepEqual(build.rules.map((r) => [r.id, r.origin]), [
    ["rule-1", "manual"], ["auto-caster-gear", "strategy:build"], ["auto-melee-gear", "strategy:build"], ["auto-hybrid-gear", "strategy:build"], ["auto-tank-gear", "strategy:build"],
    ["auto-plain-gear", "strategy:build"], ["auto-reagents", "strategy:build"], ["auto-gems", "strategy:build"],
  ]);
  assert.deepEqual(build.rules[1]!.match, { query: { ...emptyRuleQuery(), kind: ["gear"] }, build: "caster" });
  assert.ok(Object.values(build.labels).every((l) => l.origin === "strategy:build"), "no Simple label is left");
  assert.equal(checkOrganizeConfig(build).ok, true);
  const back = ok(proposeOrganize(inv, build, [], OPTS())).config;
  assert.deepEqual(back, cfg, "and back to Simple leaves no By build label or rule");
});

test("[fast] groupItems leaves out a skipped group and every empty one", () => {
  const items = Object.values(fold([{ serial: A }], things(A, ["Black Pearl", "Apple"])).items);
  assert.deepEqual(groupItems(STRATEGIES.simple, items).map((g) => g.key), ["reagents", "other"]);
  assert.deepEqual(groupItems(STRATEGIES.simple, items, [], new Set(["other"])).map((g) => g.key), ["reagents"]);
});

test("[fast] assignGroups: largest group first, each to the chest already holding most of it, ties to more room then the lower serial", () => {
  const offers: Offer[] = [
    { serial: 3, site: 0, room: 50, held: { reagents: 2 } },
    { serial: 1, site: 0, room: 80, held: { gems: 5, reagents: 1 } },
    { serial: 2, site: 0, room: 80, held: {} },
    { serial: 4, site: 1, room: 125, held: {} },
  ];
  const out = assignGroups([{ key: "gems", site: 0, need: 5 }, { key: "reagents", site: 0, need: 30 }, { key: "tools", site: 0, need: 3 }], offers);
  assert.deepEqual(Object.fromEntries(out.chains), { reagents: [3], gems: [1], tools: [2] }, "never a chest at another site");
  const tie = assignGroups([{ key: "gems", site: 0, need: 1 }], [{ serial: 9, site: 0, room: 10, held: {} }, { serial: 8, site: 0, room: 10, held: {} }, { serial: 7, site: 0, room: 5, held: {} }]);
  assert.deepEqual(tie.chains.get("gems"), [8]);
  const full = assignGroups([{ key: "gems", site: 0, need: 1 }], [{ serial: 1, site: 0, room: 0, held: { gems: 1 } }]);
  assert.deepEqual(full.chains.get("gems"), [], "a chest with no room is never picked");
});

test("[fast] assignGroups chains chests until the group fits, and a group that finds none left gets an empty chain", () => {
  const rooms = (n: number, room: number): Offer[] => Array.from({ length: n }, (_, i) => ({ serial: i + 1, site: 0, room, held: {} }));
  assert.deepEqual(assignGroups([{ key: "reagents", site: 0, need: 25 }], rooms(4, 10)).chains.get("reagents"), [1, 2, 3]);
  assert.deepEqual(assignGroups([{ key: "reagents", site: 0, need: 40 }], rooms(2, 10)).chains.get("reagents"), [1, 2], "short: every chest, and the rest is the shortfall");
  const more = assignGroups([{ key: "gems", site: 0, need: 1 }, { key: "reagents", site: 0, need: 2 }, { key: "tools", site: 0, need: 1 }], rooms(1, 10));
  assert.deepEqual(Object.fromEntries(more.chains), { reagents: [1], gems: [], tools: [] }, "more groups than containers: the largest gets it");
  assert.equal(assignGroups([{ key: "reagents", site: 0, need: 500 }], rooms(25, 10)).chains.get("reagents")!.length, 20, "a chain stops at the rule's 20 targets");
});

test("[fast] assignGroups keeps every chest that holds only this group's items in its chain, so a sorted house stays put", () => {
  const out = assignGroups([{ key: "reagents", site: 0, need: 100 }], [
    { serial: 5, site: 0, room: 200, held: { reagents: 90 } },
    { serial: 3, site: 0, room: 10, held: { reagents: 10 } },
    { serial: 7, site: 0, room: 50, held: { reagents: 1, gems: 4 } },
    { serial: 9, site: 0, room: 50, held: {} },
  ]);
  assert.deepEqual(out.chains.get("reagents"), [5, 3], "3 holds only reagents and stays; 7 also holds gems and 9 holds nothing");
});

test("[fast] assignGroups: when chests run short, a family's small groups share one chest, spilling to the next (issue #123)", () => {
  const rooms = (n: number, room: number): Offer[] => Array.from({ length: n }, (_, i) => ({ serial: i + 1, site: 0, room, held: {} }));
  const groups = [
    { key: "rings", family: "jewelry", site: 0, need: 8 }, { key: "necklaces", family: "jewelry", site: 0, need: 2 }, { key: "earrings", family: "jewelry", site: 0, need: 1 },
    { key: "ingots", family: "resources", site: 0, need: 2 }, { key: "boards", family: "resources", site: 0, need: 1 },
  ];
  const out = assignGroups(groups, rooms(3, 10));
  assert.deepEqual(Object.fromEntries(out.chains), { rings: [1], ingots: [2], necklaces: [3], boards: [2], earrings: [3] },
    "Rings takes a chest of its own while that still leaves one for each family left; the rest share by family, largest first");
  assert.deepEqual(Object.fromEntries(out.room), { rings: 10, ingots: 2, necklaces: 2, boards: 1, earrings: 1 }, "a sharer is given its own items' room");
  assert.deepEqual(Object.fromEntries(assignGroups(groups, rooms(9, 10)).chains), { rings: [1], ingots: [2], necklaces: [3], boards: [4], earrings: [5] }, "enough chests: nobody shares");
  const spill = assignGroups([{ key: "a", family: "f", site: 0, need: 6 }, { key: "b", family: "f", site: 0, need: 5 }, { key: "c", family: "f", site: 0, need: 3 }, { key: "x", family: "g", site: 0, need: 9 }], rooms(2, 10));
  assert.deepEqual([Object.fromEntries(spill.chains), Object.fromEntries(spill.room)], [{ x: [1], a: [2], b: [2], c: [2] }, { x: 10, a: 6, c: 3, b: 1 }],
    "first fit: B does not fit and finds no free chest; C still fits, and B then takes the room left");
  const none = assignGroups([{ key: "a", family: "f", site: 0, need: 12 }, { key: "b", family: "f", site: 0, need: 5 }, { key: "x", family: "g", site: 0, need: 20 }], rooms(2, 10));
  assert.deepEqual([Object.fromEntries(none.chains), Object.fromEntries(none.room)], [{ x: [1], a: [2], b: [] }, { x: 10, a: 10, b: 0 }]);
});

test("[fast] assignGroups opens a family's shared chest where that family's items already are, and keeps the one its rule fills", () => {
  const groups = [
    { key: "rings", family: "jewelry", site: 0, need: 8 }, { key: "necklaces", family: "jewelry", site: 0, need: 2 }, { key: "earrings", family: "jewelry", site: 0, need: 1 },
    { key: "ingots", family: "resources", site: 0, need: 2 }, { key: "boards", family: "resources", site: 0, need: 1 },
  ];
  const offers = (held3: Record<string, number>, held2: Record<string, number> = {}): Offer[] =>
    [{ serial: 1, site: 0, room: 10, held: {} }, { serial: 2, site: 0, room: 10, held: held2 }, { serial: 3, site: 0, room: 10, held: held3 }];
  const want = { rings: [1], ingots: [3], necklaces: [2], boards: [3], earrings: [2] };
  assert.deepEqual(Object.fromEntries(assignGroups(groups, offers({ boards: 1 })).chains), want, "chest 3 holds a board, so Resources opens there");
  const kept = groups.map((g) => (g.key === "ingots" ? { ...g, prev: [3] } : g));
  assert.deepEqual(Object.fromEntries(assignGroups(kept, offers({}, { boards: 1 })).chains), want, "the chest the rule already fills wins over where the items are");
});

test("[fast] offered containers: every usable ground chest the player's characters scanned, ticked unless the player's own setup uses it", () => {
  const inv = fold([{ serial: A }, { serial: B, pos: at(102) }, { serial: C, pos: at(104) }, { serial: D, pos: at(106) }, { serial: E, pos: at(108), tooltip: null },
    { serial: FAR, pos: null }, { serial: S, pos: at(112) }, { serial: BAG, parent: A }]);
  const cfg: OrganizeConfig = { ...emptyOrganizeConfig(),
    labels: { [B]: manual(B, "Mine"), [C]: manual(C, "Display", true), [S]: { serial: S, name: "Reagents", origin: "strategy:simple" } },
    rules: [{ id: "keep", name: "Keep", match: { query: emptyRuleQuery() }, targets: [S], origin: "manual" }] };
  const p = ok(proposeOrganize(inv, cfg, [], OPTS({ blacklist: [D] })));
  assert.deepEqual(p.candidates.map((c) => [c.serial, c.mine, c.ticked]), [[A, false, true], [B, true, false], [S, true, false]], "never a bag, only roots");
  assert.deepEqual(p.unusable.map((u) => [u.serial, u.reason]), [[C, "pinned"], [D, "blacklisted"], [E, "its fill is unknown: reinstall the scripts and rescan"], [FAR, "its scan has no position"]]);
  assert.deepEqual(p.containers, [A]);
  const asked = ok(proposeOrganize(inv, cfg, [], OPTS({ blacklist: [D], containers: [B, D, 0x4000ffff] })));
  assert.deepEqual(asked.containers, [B]);
  assert.deepEqual(asked.refused, [{ serial: D, reason: "blacklisted" }, { serial: 0x4000ffff, reason: "it is not a container on the ground in your scans" }]);
  assert.deepEqual(asked.config.labels[String(B)], manual(B, "Mine"), "a ticked chest keeps the player's own label");
});

test("[fast] more groups than containers: the largest groups get them, the rest get a rule with no container and stay put, with how many containers to add", () => {
  const inv = fold([{ serial: A }, { serial: B, pos: at(102) }], things(B, ["Black Pearl", "Ruby", "Katana", "Iron Ingot", "Garlic"]));
  const cfg: OrganizeConfig = { ...emptyOrganizeConfig(), labels: { [B]: manual(B, "Loot") } };
  const p = ok(proposeOrganize(inv, cfg, [], OPTS()));
  assert.deepEqual(p.containers, [A]);
  assert.deepEqual(p.groups.map((g) => [g.key, g.targets, g.addContainers]), [["weapons", [], 1], ["reagents", [A], 0], ["resources", [], 1], ["gems", [], 1]]);
  assert.deepEqual([p.unassigned, p.layout], [3, { chests: 3, bags: [], spareBags: 0, roomy: false }]);
  const plan = planOrganize(inv, p.config, [], { now: NOW });
  assert.deepEqual(plan.moves.map((m) => m.name).sort(), ["Black Pearl", "Garlic"], "only the group with a container moves");
  assert.equal(plan.unclaimed, 0, "the others are claimed by their rules and stay where they are");
  // Zero containers ticked: every group is left without one, and nothing moves.
  const none = ok(proposeOrganize(inv, cfg, [], OPTS({ containers: [] })));
  assert.deepEqual(none.containers, []);
  assert.ok(none.groups.length > 0 && none.groups.every((g) => !g.targets.length));
  assert.equal(planOrganize(inv, none.config, [], { now: NOW }).moves.length, 0);
});

test("[fast] a group too big for one chest gets a chain of chests in fill order, and the plan fits it with no shortfall", () => {
  const pearls: ThingSpec[] = Array.from({ length: 30 }, (_, i) => ({ serial: ITEM + 1 + i, name: "Black Pearl", in: A, hue: i + 1 }));
  const inv = fold([{ serial: A, max: 40 }, { serial: B, pos: at(102), max: 12 }, { serial: C, pos: at(104), max: 12 }, { serial: D, pos: at(106), max: 12 }], pearls);
  const p = ok(proposeOrganize(inv, { ...emptyOrganizeConfig(), labels: { [A]: manual(A, "Old") } }, [], OPTS()));
  assert.deepEqual(p.groups.map((g) => [g.key, g.targets, g.needSlots, g.roomSlots, g.shortfall]), [["reagents", [B, C, D], 30, 36, 0]]);
  assert.deepEqual(p.config.rules.map((r) => [r.id, r.targets]), [["auto-reagents", [B, C, D]]]);
  const plan = planOrganize(inv, p.config, [], { now: NOW });
  assert.equal(plan.moves.length, 30);
  assert.equal(plan.rules[0]!.noRoom, 0);
  assert.equal(p.plan.moves, 30, "the proposal carries the plan's own count");
});

test("[fast] a group spread over two houses goes to a chest where most of it is; the rest is reported as at another house", () => {
  const inv = fold([{ serial: A }, { serial: FAR, pos: at(500) }], [...things(A, ["Black Pearl", "Garlic", "Ginseng"]), ...things(FAR, ["Nightshade", "Ruby"], 4)]);
  const p = ok(proposeOrganize(inv, emptyOrganizeConfig(), [], OPTS()));
  assert.deepEqual(p.groups.map((g) => [g.key, g.targets, g.needSlots, g.crossSite]), [["reagents", [A], 3, 1], ["gems", [FAR], 1, 0]]);
  assert.deepEqual([p.plan.crossSite, p.plan.moves], [1, 0]);
});

test("[fast] re-running after manual edits: the player's rules stay first and keep their items, their labels stay, and an earlier strategy's rules and labels are replaced", () => {
  const inv = fold([{ serial: A }, { serial: B, pos: at(102) }, { serial: C, pos: at(104) }], [...things(A, ["Black Pearl", "Garlic"]), ...things(B, ["Ruby"], 3), ...things(C, ["Katana"], 4)]);
  const first = ok(proposeOrganize(inv, emptyOrganizeConfig(), [], OPTS())).config;
  assert.deepEqual(first.rules.map((r) => [r.id, r.targets]), [["auto-weapons", [C]], ["auto-reagents", [A]], ["auto-gems", [B]]]);
  // The player narrows the reagent rule (the rule editor makes it theirs and keeps its id), renames the gem chest,
  // and adds a rule of their own into the weapons chest.
  const edited: OrganizeConfig = { ...first,
    labels: { ...first.labels, [B]: manual(B, "My gems") },
    rules: [
      { ...first.rules[1]!, name: "Pearls", match: { query: { ...emptyRuleQuery(), kind: ["reagent"] }, names: ["black pearl"] }, origin: "manual" },
      { id: "rule-1", name: "Swords", match: { query: { ...emptyRuleQuery(), kind: ["gear"] } }, targets: [C], origin: "manual" },
      first.rules[0]!, first.rules[2]!,
    ] };
  const byDefault = ok(proposeOrganize(inv, edited, [], OPTS()));
  assert.deepEqual(byDefault.candidates.filter((c) => c.ticked).map((c) => c.serial), [B, C], "every chest here is used by the player's own setup: only the ones an earlier Auto rule still fills are ticked");
  const again = ok(proposeOrganize(inv, edited, [], OPTS({ containers: [A, B] })));
  assert.deepEqual(again.config.rules.map((r) => [r.id, r.name, r.targets, r.origin]), [
    ["auto-reagents", "Pearls", [A], "manual"],
    ["rule-1", "Swords", [C], "manual"],
    ["auto-reagents_2", "Reagents", [A], "strategy:simple"],
    ["auto-gems", "Gems", [B], "strategy:simple"],
  ]);
  assert.deepEqual(again.config.labels[String(B)], manual(B, "My gems"), "a manual label is never renamed");
  assert.deepEqual(again.config.labels[String(C)], first.labels[String(C)], "an earlier strategy's label a manual rule fills is kept");
  assert.equal(again.config.labels[String(A)]!.name, "Reagents");
  assert.equal(checkOrganizeConfig(again.config).ok, true);
});

test("[fast] running Auto again on its own accepted setup proposes the same setup, and after its trips nothing moves", () => {
  // A messy house: reagents and gems mixed in two chests, a third chest empty, twelve slots each.
  const inv = fold([{ serial: A, max: 12 }, { serial: B, pos: at(102), max: 12 }, { serial: C, pos: at(104), max: 12 }],
    [...things(A, ["Black Pearl", "Ruby", "Garlic", "Iron Ingot"]), ...things(B, ["Emerald", "Ginseng", "Katana", "Sapphire"], 5), ...BUILD_GEAR.map((t, i) => ({ ...t, in: i < 2 ? A : B }))]);
  for (const strategy of STRATEGY_IDS) {
    const p = ok(proposeOrganize(inv, emptyOrganizeConfig(), [], OPTS({ strategy })));
    const again = ok(proposeOrganize(inv, p.config, [], OPTS({ strategy })));
    assert.equal(again.changed, false, `${strategy}: accepting, then running again, changes nothing`);
    assert.deepEqual(again.config, p.config);
    const plan = planOrganize(inv, p.config, [], { now: NOW });
    assert.ok(plan.moves.length > 0);
    const done: OverlayMove[] = plan.moves.map((m) => ({ serial: m.serial, name: m.name, from: m.from, to: m.to, at: new Date(NOW).toISOString(), trip: "t1" }));
    const after = ok(proposeOrganize(inv, p.config, done, OPTS({ strategy })));
    assert.equal(after.plan.moves, 0, `${strategy}: re-running on its own result moves nothing`);
  }
});

test("[fast] a chest with the player's own label, ticked last time, is ticked again by default, so re-running moves nothing", () => {
  const inv = fold([{ serial: A }, { serial: B, pos: at(102) }, { serial: C, pos: at(104) }], [...things(A, ["Black Pearl"]), ...things(B, ["Ruby", "Emerald"], 2)]);
  const cfg: OrganizeConfig = { ...emptyOrganizeConfig(), labels: { [B]: manual(B, "My gems") } };
  const p = ok(proposeOrganize(inv, cfg, [], OPTS({ containers: [A, B, C] })));
  assert.deepEqual(p.groups.map((g) => [g.key, g.targets]), [["reagents", [A]], ["gems", [B]]]);
  const again = ok(proposeOrganize(inv, p.config, [], OPTS()));
  assert.deepEqual(again.containers, [A, B, C]);
  assert.equal(again.changed, false);
});

test("[fast] re-running after the trips keeps each group in the chests its rule already fills, even when the trips leave two chests holding it equally", () => {
  // Found by a property check: grave dust in all three chests; C is full of things whose groups get no chest, so
  // the trip fills A, and after it A and C hold two each. Counts alone would then hand the group A first and C to
  // Magery reagents, moving C's grave dust out on the next run.
  const inv = fold([{ serial: A, pos: at(100), max: 7 }, { serial: B, pos: at(102), max: 14 }, { serial: C, pos: at(104), max: 8 }, { serial: BAG, parent: C }], [
    { serial: ITEM + 1, name: "Grave Dust", in: A },
    ...["Grave Dust", "Platemail Gorget", "Gold Necklace", "Greater Heal", "Greater Heal", "Iron Ingot", "Iron Ingot"].map((name, i) => ({ serial: ITEM + 10 + i, name, in: B, hue: i + 1, ...gfx(name) })),
    ...["Greater Heal Potion", "Grave Dust", "Grave Dust", "Recall Rune", "Nightshade"].map((name, i) => ({ serial: ITEM + 20 + i, name, in: C, hue: i + 1 })),
    { serial: ITEM + 30, name: "Spellbook", in: BAG }, { serial: ITEM + 31, name: "Black Pearl", in: BAG },
  ]);
  const p = ok(proposeOrganize(inv, emptyOrganizeConfig(), [], OPTS({ strategy: "detailed" })));
  assert.deepEqual(["magery-reagents", "necromancy-reagents"].map((k) => p.groups.find((g) => g.key === k)!.targets), [[C], [C]], "three chests for eight families: the reagents share C");
  const plan = planOrganize(inv, p.config, [], { now: NOW });
  const done: OverlayMove[] = plan.moves.map((m) => ({ serial: m.serial, name: m.name, from: m.from, to: m.to, at: new Date(NOW).toISOString(), trip: "t1" }));
  const after = ok(proposeOrganize(inv, p.config, done, OPTS({ strategy: "detailed" })));
  assert.deepEqual([after.changed, after.plan.moves], [false, 0]);
});

test("[fast] with too few chests a family's small groups share one, labelled with the family's name, each keeping its own rule; re-running moves nothing (issue #123)", () => {
  const inv = fold([{ serial: A, max: 20 }, { serial: B, pos: at(102), max: 20 }, { serial: C, pos: at(104), max: 20 }], [
    ...things(A, ["Katana", "Katana", "Gold Ring", "Iron Ingot"]),
    ...things(B, ["Katana", "Katana", "Katana", "Gold Necklace", "Gold Bracelet", "Board"], 10),
  ]);
  const p = ok(proposeOrganize(inv, emptyOrganizeConfig(), [], OPTS({ strategy: "detailed" })));
  assert.deepEqual(p.groups.map((g) => [g.key, g.targets, g.roomSlots, g.shortfall]), [
    ["rings", [C], 1, 0], ["bracelets", [C], 1, 0], ["necklaces", [C], 1, 0], ["weapons", [B], 15, 0], ["ingots", [A], 1, 0], ["boards", [A], 1, 0],
  ]);
  assert.deepEqual(Object.fromEntries(Object.values(p.config.labels).map((l) => [l.serial, l.name])), { [A]: "Resources", [B]: "Weapons", [C]: "Jewelry" });
  assert.deepEqual(p.config.rules.map((r) => [r.id, r.name, r.targets]), [
    ["auto-rings", "Rings", [C]], ["auto-bracelets", "Bracelets", [C]], ["auto-necklaces", "Necklaces", [C]], ["auto-weapons", "Weapons", [B]], ["auto-ingots", "Ingots", [A]], ["auto-boards", "Boards", [A]],
  ]);
  assert.deepEqual(p.groups.map((g) => [g.key, g.needsBag]).filter(([, n]) => n).map(([k]) => k), ["rings", "bracelets", "necklaces", "ingots", "boards"], "no bags in the shared chests: those groups share them loose");
  assert.deepEqual([p.unassigned, p.layout], [0, { chests: 0, bags: [{ chest: C, family: "Jewelry", bags: 3 }, { chest: A, family: "Resources", bags: 2 }], spareBags: 0, roomy: false }]);
  const again = ok(proposeOrganize(inv, p.config, [], OPTS({ strategy: "detailed" })));
  assert.equal(again.changed, false);
  const plan = planOrganize(inv, p.config, [], { now: NOW });
  const done: OverlayMove[] = plan.moves.map((m) => ({ serial: m.serial, name: m.name, from: m.from, to: m.to, at: new Date(NOW).toISOString(), trip: "t1" }));
  const after = ok(proposeOrganize(inv, p.config, done, OPTS({ strategy: "detailed" })));
  assert.deepEqual([after.changed, after.plan.moves], [false, 0], "after the trips, the shared chests stay as they are");
});

test("[fast] groups sharing a chest each get one of its empty bags, labelled for the group; one left without a bag shares the chest loose, and the layout asks for its bag; re-running after the trips moves nothing (issue #132)", () => {
  const BAG2 = 0x40000009, BAG3 = 0x4000000a, BAG4 = 0x4000000b;
  const inv = fold([{ serial: A }, { serial: BAG, parent: A }, { serial: BAG2, parent: A }, { serial: B, pos: at(102) }, { serial: BAG3, parent: B }, { serial: C, pos: at(104) }, { serial: BAG4, parent: C }],
    [...things(A, ["Plate Helm", "Platemail Gorget", "Bone Armor"]), ...things(B, ["Gold Ring"], 4)]);
  const p = ok(proposeOrganize(inv, emptyOrganizeConfig(), [], OPTS({ strategy: "detailed", containers: [A, B] })));
  assert.deepEqual(p.groups.map((g) => [g.key, g.targets, g.bagIn, g.needsBag]), [
    ["armour-head", [BAG], A, false], ["armour-neck", [BAG2], A, false], ["armour-chest", [A], null, true], ["rings", [B], null, false],
  ]);
  assert.deepEqual(Object.values(p.config.labels).map((l) => [l.serial, l.name]), [[A, "Armour"], [B, "Rings"], [BAG, "Armour: head"], [BAG2, "Armour: neck"]]);
  assert.deepEqual(p.layout, { chests: 0, bags: [{ chest: A, family: "Armour", bags: 1 }], spareBags: 1, roomy: false }, "B's empty bag is spare: move it into the Armour chest; the one in the unticked chest C is not counted");
  const plan = planOrganize(inv, p.config, [], { now: NOW });
  assert.deepEqual(plan.moves.map((m) => [m.name, m.to]), [["Plate Helm", BAG], ["Platemail Gorget", BAG2]], "the ring stays in its chest, the chest piece loose in the shared one");
  const done: OverlayMove[] = plan.moves.map((m) => ({ serial: m.serial, name: m.name, from: m.from, to: m.to, at: new Date(NOW).toISOString(), trip: "t1" }));
  const after = ok(proposeOrganize(inv, p.config, done, OPTS({ strategy: "detailed", containers: [A, B] })));
  assert.deepEqual([after.changed, after.plan.moves], [false, 0], "each group keeps its bag once its items are in it");
});

test("[fast] an earlier strategy's bag still holding items goes only to the group they all belong to, never to another that would move them out (issue #132)", () => {
  const BAG2 = 0x40000009;
  const inv = fold([{ serial: A }, { serial: BAG, parent: A }, { serial: BAG2, parent: A }, { serial: B, pos: at(102) }],
    [{ serial: ITEM + 1, name: "Plate Helm", in: BAG }, { serial: ITEM + 2, name: "Platemail Gorget", in: A }, { serial: ITEM + 3, name: "Bone Armor", in: A }, { serial: ITEM + 4, name: "Gold Ring", in: B }]);
  const old: OrganizeConfig = { ...emptyOrganizeConfig(), labels: { [BAG]: { serial: BAG, name: "Armour", origin: "strategy:simple" } } };
  const p = ok(proposeOrganize(inv, old, [], OPTS({ strategy: "detailed" })));
  assert.deepEqual(p.groups.filter((g) => g.family === "armour").map((g) => [g.key, g.targets]), [["armour-head", [BAG]], ["armour-neck", [BAG2]], ["armour-chest", [A]]], "the helm's bag goes to the helms");
  const mixed = fold([{ serial: A }, { serial: BAG, parent: A }, { serial: BAG2, parent: A }, { serial: B, pos: at(102) }],
    [{ serial: ITEM + 1, name: "Plate Helm", in: BAG }, { serial: ITEM + 2, name: "Platemail Gorget", in: BAG }, { serial: ITEM + 3, name: "Bone Armor", in: A }, { serial: ITEM + 4, name: "Gold Ring", in: B }]);
  const m = ok(proposeOrganize(mixed, old, [], OPTS({ strategy: "detailed" })));
  assert.deepEqual(m.groups.filter((g) => g.family === "armour").map((g) => [g.key, g.targets]), [["armour-head", [BAG2]], ["armour-neck", [A]], ["armour-chest", [A]]], "a bag of mixed groups is given to none");
  assert.equal(m.config.labels[String(BAG)], undefined);
});

test("[fast] the full layout fills each chest to FILL: a group it fits there takes a second chest before the first is full; where it does not fit, the chests fill to the top and the layout counts the chests to add (issue #132)", () => {
  const pearls = (n: number): ThingSpec[] => Array.from({ length: n }, (_, i) => ({ serial: ITEM + 1 + i, name: "Black Pearl", in: A, hue: i + 1 }));
  const roomy = fold([{ serial: A }, { serial: B, pos: at(102) }], pearls(110));
  const p = ok(proposeOrganize(roomy, emptyOrganizeConfig(), [], OPTS()));
  assert.deepEqual(p.groups.map((g) => [g.targets, g.roomSlots, g.shortfall]), [[[A, B], 199, 0]], "110 items: 100 in A, room for their loot in B");
  assert.deepEqual([p.layout, p.plan.moves], [{ chests: 0, bags: [], spareBags: 0, roomy: true }, 0], "roomy: the drawer says why B is used");
  // A house an earlier run sorted to the top of A, which still fits, stays as it is: no rebalancing into B.
  const sorted = ok(proposeOrganize(roomy, { ...p.config, rules: p.config.rules.map((r) => ({ ...r, targets: [A] })) }, [], OPTS()));
  assert.deepEqual([sorted.groups[0]!.targets, sorted.layout.roomy, sorted.plan.moves], [[A], false, 0]);
  const tight = fold([{ serial: A }], pearls(110));
  const t = ok(proposeOrganize(tight, emptyOrganizeConfig(), [], OPTS()));
  assert.deepEqual(t.groups.map((g) => [g.targets, g.roomSlots, g.shortfall]), [[[A], 125, 0]], "one chest: it fits to the top");
  assert.equal(t.layout.chests, 1);
});

test("[fast] scroll groups sharing a chest label it Scrolls, whichever group comes last (issue #134)", () => {
  const inv = fold([{ serial: A, max: 20 }, { serial: B, pos: at(102), max: 20 }], [...things(A, ["Katana", "Katana", "Katana"]), ...things(B, ["An Exalted Scroll Of Mysticism (110 Skill)", "Greater Heal", "Scroll Of Transcendence"], 10)]);
  const p = ok(proposeOrganize(inv, emptyOrganizeConfig(), [], OPTS({ strategy: "detailed" })));
  assert.deepEqual(Object.fromEntries(Object.values(p.config.labels).map((l) => [l.serial, l.name])), { [A]: "Weapons", [B]: "Scrolls" });
});

test("[fast] Detailed with too few containers says how many are missing; the same scans in any order give the same proposal", () => {
  const list = things(A);
  const inv = fold([{ serial: A }, { serial: B, pos: at(102) }], list);
  const shuffled = fold([{ serial: B, pos: at(102) }, { serial: A }], [...list].reverse());
  const p = ok(proposeOrganize(inv, emptyOrganizeConfig(), [], OPTS({ strategy: "detailed" })));
  // Two chests: the two armour groups share one, Potions and Bandages the other; the other nine families are short a
  // chest each, which their groups could share.
  assert.deepEqual(Object.values(p.config.labels).map((l) => l.name), ["Armour", "Potions & bandages"]);
  assert.equal(p.unassigned, p.groups.length - 4);
  assert.equal(p.layout.chests, 9);
  assert.deepEqual(p.layout.bags.map((b) => [b.chest, b.family, b.bags]).slice(0, 2), [[null, "Armour", 2], [null, "Jewelry", 2]], "the full layout's family chests, each group in a bag");
  assert.deepEqual(ok(proposeOrganize(shuffled, emptyOrganizeConfig(), [], OPTS({ strategy: "detailed" }))), p);
});

test("[fast] the player's catch-all takes what no group does, so there is no Other group; a setup past the rule limit is refused, not proposed", () => {
  const inv = fold([{ serial: A }, { serial: B, pos: at(102) }], things(A, ["Black Pearl", "Apple"]));
  const cfg: OrganizeConfig = { ...emptyOrganizeConfig(), labels: { [B]: manual(B, "Junk") }, catchAll: B };
  const p = ok(proposeOrganize(inv, cfg, [], OPTS()));
  assert.deepEqual(p.groups.map((g) => g.key), ["reagents"]);
  assert.equal(p.config.catchAll, B);
  const many: OrganizeConfig = { ...cfg, rules: Array.from({ length: 200 }, (_, i) => ({ id: `rule-${i + 1}`, name: `Rule ${i + 1}`, match: { query: { ...emptyRuleQuery(), q: "nothing matches this" } }, targets: [], origin: "manual" as const })) };
  const r = proposeOrganize(inv, many, [], OPTS());
  assert.equal(r.ok, false);
  assert.match((r as { error: string }).error, /at most 200 rules/);
});

test("[fast] the gather container for empty bags is kept, labelled and unticked by default, like the catch-all (issue #128)", () => {
  const inv = fold([{ serial: A }, { serial: B, pos: at(102) }], things(A, ["Black Pearl"]));
  const cfg: OrganizeConfig = { ...emptyOrganizeConfig(), labels: { [B]: manual(B, "Spare bags") }, emptyBagsTo: B };
  const p = ok(proposeOrganize(inv, cfg, [], OPTS()));
  assert.equal(p.config.emptyBagsTo, B);
  assert.equal(p.config.labels[String(B)]!.name, "Spare bags");
  assert.equal(p.candidates.find((c) => c.serial === B)!.ticked, false);
});
