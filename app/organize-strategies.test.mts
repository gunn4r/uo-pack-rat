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
import { houseScan, type BoxSpec, type ThingSpec } from "./organize-fixture.mts";
import { checkOrganizeConfig, emptyOrganizeConfig, type OrganizeRule } from "./organize-config.mts";
import type { RulesV1 } from "./schema/types.d.mts";
import { STRATEGIES, groupItems, assignGroups, type Offer } from "./organize-strategies.mts";

const HERE = dirname(fileURLToPath(import.meta.url));
setRules(JSON.parse(readFileSync(join(HERE, "rules", "uoalive.json"), "utf8")) as RulesV1);
const A = 0x40000001;
const fold = (boxes: BoxSpec[], things: ThingSpec[] = []): Inventory => foldSnapshots([houseScan({ boxes, things })]);
// One of each thing the strategies sort (Task 0 checked how each classifies), in serial order.
const NAMES = ["Black Pearl", "Ruby", "Katana", "Platemail Gorget", "Gold Necklace", "Gold Ring", "Bone Armor", "Heater Shield", "Spellbook", "Greater Heal Potion", "Bandage", "Iron Ingot", "Recall Rune", "Scissors", "Greater Heal", "An Exalted Scroll Of Mysticism (110 Skill)", "Apple", "Grave Dust", "Board"];
const ITEM = 0x40001000;
const things = (inBox: number, names: readonly string[] = NAMES, from = 1): ThingSpec[] => names.map((name, i) => ({ serial: ITEM + from + i, name, in: inBox }));
const grouped = (strategy: keyof typeof STRATEGIES): [string, string, string[]][] =>
  groupItems(STRATEGIES[strategy], Object.values(fold([{ serial: A }], things(A)).items)).map((g) => [g.key, g.name, g.items.map((it) => it.name)]);

test("[fast] every Simple and Detailed group is made of valid rule filters, under unique keys", () => {
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
    ["scrolls", "Scrolls", ["Greater Heal", "An Exalted Scroll Of Mysticism (110 Skill)"]],
    ["resources", "Resources", ["Iron Ingot", "Board"]],
    ["potions", "Potions & bandages", ["Greater Heal Potion", "Bandage"]],
    ["runes-books", "Runes & books", ["Recall Rune"]],
    ["gems", "Gems", ["Ruby"]],
    ["tools", "Tools", ["Scissors"]],
    ["other", "Other", ["Apple"]],
  ]);
});

test("[fast] Detailed: gear by slot, reagents by school, power scrolls by level, resources by type; spell scrolls stay one group", () => {
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
    ["scrolls", ["Greater Heal"]],
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
  assert.deepEqual(Object.fromEntries(out), { reagents: [3], gems: [1], tools: [2] }, "never a chest at another site");
  const tie = assignGroups([{ key: "gems", site: 0, need: 1 }], [{ serial: 9, site: 0, room: 10, held: {} }, { serial: 8, site: 0, room: 10, held: {} }, { serial: 7, site: 0, room: 5, held: {} }]);
  assert.deepEqual(tie.get("gems"), [8]);
  const full = assignGroups([{ key: "gems", site: 0, need: 1 }], [{ serial: 1, site: 0, room: 0, held: { gems: 1 } }]);
  assert.deepEqual(full.get("gems"), [], "a chest with no room is never picked");
});

test("[fast] assignGroups chains chests until the group fits, and a group that finds none left gets an empty chain", () => {
  const rooms = (n: number, room: number): Offer[] => Array.from({ length: n }, (_, i) => ({ serial: i + 1, site: 0, room, held: {} }));
  assert.deepEqual(assignGroups([{ key: "reagents", site: 0, need: 25 }], rooms(4, 10)).get("reagents"), [1, 2, 3]);
  assert.deepEqual(assignGroups([{ key: "reagents", site: 0, need: 40 }], rooms(2, 10)).get("reagents"), [1, 2], "short: every chest, and the rest is the shortfall");
  const more = assignGroups([{ key: "gems", site: 0, need: 1 }, { key: "reagents", site: 0, need: 2 }, { key: "tools", site: 0, need: 1 }], rooms(1, 10));
  assert.deepEqual(Object.fromEntries(more), { reagents: [1], gems: [], tools: [] }, "more groups than containers: the largest gets it");
  assert.equal(assignGroups([{ key: "reagents", site: 0, need: 500 }], rooms(25, 10)).get("reagents")!.length, 20, "a chain stops at the rule's 20 targets");
});

test("[fast] assignGroups keeps every chest that holds only this group's items in its chain, so a sorted house stays put", () => {
  const out = assignGroups([{ key: "reagents", site: 0, need: 100 }], [
    { serial: 5, site: 0, room: 200, held: { reagents: 90 } },
    { serial: 3, site: 0, room: 10, held: { reagents: 10 } },
    { serial: 7, site: 0, room: 50, held: { reagents: 1, gems: 4 } },
    { serial: 9, site: 0, room: 50, held: {} },
  ]);
  assert.deepEqual(out.get("reagents"), [5, 3], "3 holds only reagents and stays; 7 also holds gems and 9 holds nothing");
});
