// organize.test.mts — app/organize.mts, Organize's planner (issue #11), on hand-built house scans
// (app/organize-fixture.mts) folded by the real foldSnapshots, plus a fold of the TazUO adapter fixture.
// Pure: no server. Tags: [fast], one [smoke]. Run: node --test app/organize.test.mts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { foldSnapshots, setRules, PROP_PATTERNS, SKILL_NAMES, type Inventory } from "./vault-lib.mts";
import { houseScan, AT, type BoxSpec, type ThingSpec } from "./organize-fixture.mts";
import { emptyRuleQuery, emptyOrganizeConfig, BUILDS, CATCH_ALL_ID, EMPTY_BAGS_ID, type OrganizeConfig, type OrganizeRule, type ContainerLabel, type RuleMatch } from "./organize-config.mts";
import type { RuleQuery } from "./item-query.mts";
import type { RulesV1 } from "./schema/types.d.mts";
import { resolveConfig } from "./config.mts";
import { queueTrip } from "./bridge-trip.mts";
import type { ScanV2 } from "./schema/types.d.mts";
import {
  ancestry, scopeOf, ruleMatches, buildOf, matchCount, CASTER_PROPS, CASTER_SKILLS, MELEE_PROPS, MELEE_SKILLS, claimOf, baseName, nameKey, applyOverlay, overlaidInventory, homeOf, newSim, simTake, simPut, mark, rollback, MAX_STACK,
  sitesOf, packKept, planOrganize, tripCommand, lineBytes, emptyBagsOf, directSerials, tripSeconds, STEP_S, type OverlayMove, type Sim, type Plan,
} from "./organize.mts";

const HERE = dirname(fileURLToPath(import.meta.url));
const RULES = JSON.parse(readFileSync(join(HERE, "rules", "uoalive.json"), "utf8")) as RulesV1;
setRules(RULES);
const NOW = Date.parse(AT) + 3600e3;
const A = 0x40000001, B = 0x40000002, BAG = 0x40000003, FAR = 0x40000004, STRANGER = 0x40000005, POUCH = 0x40000006, C = 0x40000007, PACK = 0x40000008;
const PEARL = 0x40001001, RUBY = 0x40001002, KATANA = 0x40001003, ASH = 0x40001004, GARLIC = 0x40001005, PEARL2 = 0x40001006, PEARL3 = 0x40001007;
const fold = (boxes: BoxSpec[], things: ThingSpec[] = []): Inventory => foldSnapshots([houseScan({ boxes, things })]);
const labels = (...serials: number[]): Record<string, ContainerLabel> =>
  Object.fromEntries(serials.map((s) => [String(s), { serial: s, name: `Box ${s}`, origin: "manual" as const }]));
const rule = (id: string, query: Partial<RuleQuery>, targets: number[], names?: string[]): OrganizeRule =>
  ({ id, name: id, match: { query: { ...emptyRuleQuery(), ...query }, ...(names ? { names } : {}) }, targets, origin: "manual" });
const config = (over: Partial<OrganizeConfig>): OrganizeConfig => ({ ...emptyOrganizeConfig(), ...over });
const at = (x: number, facet = 1) => ({ x, y: 100, z: 0, facet });

test("[fast] ancestry walks a container up to its root, and gives up on a missing link or past eight", () => {
  const inv = fold([{ serial: A }, { serial: BAG, parent: A }, { serial: POUCH, parent: BAG }]);
  assert.deepEqual(ancestry(inv, POUCH), [POUCH, BAG, A]);
  assert.equal(ancestry(inv, 0x4000ffff), null);
  assert.equal(ancestry(inv, null), null);
  const deep: BoxSpec[] = [{ serial: 0x40000100 }];
  for (let i = 1; i < 10; i++) deep.push({ serial: 0x40000100 + i, parent: 0x40000100 + i - 1 });
  assert.equal(ancestry(fold(deep), 0x40000109), null);
});

test("[fast] only items in labelled ground roots can move; unlabelled chests, bags, pinned items and pinned containers never do", () => {
  const inv = fold([{ serial: A }, { serial: BAG, parent: A }, { serial: STRANGER, pos: at(102) }, { serial: B, pos: at(104) }],
    [{ serial: PEARL, name: "Black Pearl", in: A }, { serial: RUBY, name: "Ruby", in: BAG }, { serial: ASH, name: "Sulfurous Ash", in: STRANGER },
      { serial: KATANA, name: "Katana", in: B }, { serial: GARLIC, name: "Garlic", in: B }]);
  const cfg = config({ labels: { ...labels(A), [String(B)]: { serial: B, name: "Display", pinned: true, origin: "manual" } }, pinnedItems: [PEARL] });
  const s = scopeOf(inv, cfg, { now: NOW });
  assert.deepEqual(s.movable, [RUBY]);
  assert.deepEqual(s.roots, [A, B]);
  assert.deepEqual([...s.usable], [A], "a pinned container is never filled");
  assert.deepEqual(s.warnings, []);
});

test("[fast] an unopened bag's remembered contents and a blacklisted bag's never move", () => {
  const inv = fold([{ serial: A }, { serial: BAG, parent: A, opened: false }, { serial: POUCH, parent: A }],
    [{ serial: PEARL, name: "Black Pearl", in: BAG }, { serial: RUBY, name: "Ruby", in: POUCH }, { serial: GARLIC, name: "Garlic", in: A }]);
  assert.equal(inv.containers[BAG]!.opened, false, "the fold keeps the scan's opened:false");
  const s = scopeOf(inv, config({ labels: labels(A) }), { now: NOW, blacklist: [POUCH] });
  assert.deepEqual(s.movable, [GARLIC]);
});

test("[fast] a root blacklisted after it was labelled moves nothing and says so", () => {
  const inv = fold([{ serial: A }, { serial: B, pos: at(104) }], [{ serial: PEARL, name: "Black Pearl", in: A }, { serial: RUBY, name: "Ruby", in: B }]);
  const s = scopeOf(inv, config({ labels: labels(A, B), rules: [rule("gems", { kind: ["gem"] }, [A])] }), { now: NOW, blacklist: [A] });
  assert.deepEqual(s.movable, [RUBY]);
  assert.deepEqual(s.roots, [B]);
  assert.equal(s.usable.has(A), false);
  assert.deepEqual(s.warnings.map((w) => [w.kind, w.serial]), [["blacklisted", A]]);
});

test("[fast] labels on a backpack, on a chest with no position and on a vanished container are reported, not used", () => {
  const inv = fold([{ serial: PACK, kind: "backpack" }, { serial: A, pos: null }], [{ serial: PEARL, name: "Black Pearl", in: A }]);
  const s = scopeOf(inv, config({ labels: labels(PACK, A, 0x4000ffff) }), { now: NOW, seen: { [String(0x4000ffff)]: "2026-09-01T00:00:00Z" } });
  assert.deepEqual(s.movable, []);
  assert.deepEqual(s.warnings.map((w) => [w.kind, w.serial]), [["no-position", A], ["not-ground", PACK], ["missing-label", 0x4000ffff]].sort((x, y) => (x[1] as number) - (y[1] as number)));
  assert.match(s.warnings.find((w) => w.kind === "missing-label")!.detail, /not seen since 2026-09-01T00:00:00Z/);
});

test("[fast] a target whose fill is unknown is reported: a chest from an old scan as old scripts, one without a Contents line as unknown", () => {
  const inv = fold([{ serial: A, tooltip: null }, { serial: B, pos: at(104), tooltip: ["Box"] }]);
  const s = scopeOf(inv, config({ labels: labels(A, B), rules: [rule("any", {}, [A, B])] }), { now: NOW });
  assert.deepEqual([...s.usable], []);
  assert.deepEqual(s.warnings.map((w) => [w.kind, w.serial]), [["old-scripts", A], ["unknown-capacity", B]]);
});

test("[fast] a container last scanned over a week ago is warned about and still used", () => {
  const inv = fold([{ serial: A }]);
  const s = scopeOf(inv, config({ labels: labels(A) }), { now: Date.parse(AT) + 8 * 864e5 });
  assert.deepEqual(s.warnings.map((w) => [w.kind, w.serial]), [["stale-container", A]]);
  assert.equal(s.usable.has(A), true);
});

test("[fast] the first rule that matches claims an item; later matches are only recorded; unclaimed goes to the catch-all or stays", () => {
  const inv = fold([{ serial: A }], [{ serial: PEARL, name: "Black Pearl", in: A }, { serial: GARLIC, name: "Garlic", in: A }, { serial: KATANA, name: "Katana", in: A }]);
  const rules = [rule("pearls", {}, [A], ["black pearl"]), rule("reagents", { kind: ["reagent"] }, [A])];
  const cfg = config({ labels: labels(A), rules });
  assert.deepEqual(claimOf(inv.items[PEARL]!, cfg), { ruleId: "pearls", alsoMatched: ["reagents"] });
  assert.deepEqual(claimOf(inv.items[GARLIC]!, cfg), { ruleId: "reagents", alsoMatched: [] });
  assert.equal(claimOf(inv.items[KATANA]!, cfg), null);
  assert.deepEqual(claimOf(inv.items[KATANA]!, { ...cfg, catchAll: A }), { ruleId: CATCH_ALL_ID, alsoMatched: [] });
});

test("[fast] rule names match the item's own name, stack count stripped, case-insensitive, and the query must pass too", () => {
  const inv = fold([{ serial: A }], [{ serial: ASH, name: "Grave Dust", amount: 75, in: A }, { serial: PEARL, name: "Black Pearl", in: A }]);
  const dust = inv.items[ASH]!;
  assert.equal(baseName(dust.name), "grave dust");
  assert.equal(baseName(fold([{ serial: A }], [{ serial: PEARL, name: "21025908 Of Wizardry", graphic: 0x1714, in: A }]).items[PEARL]!.name), "of wizardry", "an unresolved cliloc number is no stack count (issue #129)");
  assert.equal(ruleMatches(dust, { query: emptyRuleQuery(), names: ["grave dust"] }), true);
  assert.equal(ruleMatches(dust, { query: emptyRuleQuery(), names: ["GRAVE"] }), true);
  assert.equal(ruleMatches(inv.items[PEARL]!, { query: emptyRuleQuery(), names: ["grave dust"] }), false);
  assert.equal(ruleMatches(dust, { query: { ...emptyRuleQuery(), kind: ["gem"] }, names: ["grave dust"] }), false);
});

test("[fast] rule names and item names compare with spaces and punctuation removed on both sides (issue #123)", () => {
  const inv = fold([{ serial: A }], [
    { serial: 0x40002001, name: "Blood Moss", amount: 20, in: A }, { serial: 0x40002002, name: "Batwing", in: A }, { serial: 0x40002003, name: "Spiders' Silk", in: A },
    { serial: 0x40002004, name: "A Wondrous Scroll Of Magery (105 Skill)", in: A }, { serial: 0x40002005, name: "A Legendary Scroll Of Magery (120 Skill)", in: A },
  ]);
  const takes = (name: string): string[] => Object.values(inv.items).filter((it) => ruleMatches(it, { query: emptyRuleQuery(), names: [name] })).map((it) => it.name);
  assert.equal(nameKey("20 Spiders' Silk"), "spiderssilk");
  assert.deepEqual(takes("bloodmoss"), ["Blood Moss"]);
  assert.deepEqual(takes("bat wing"), ["Batwing"]);
  assert.deepEqual(takes("spiders silk"), ["Spiders' Silk"]);
  assert.deepEqual(takes("'"), [], "a name that is only punctuation matches nothing");
  assert.deepEqual(takes("120 Skill"), ["A Legendary Scroll Of Magery (120 Skill)"], "a rule name's leading number is not a stack count");
});

test("[fast] a rule's build takes gear by its caster and melee markers, then its resists, and never takes anything else", () => {
  const gear = (serial: number, name: string, lines: string[]): ThingSpec => ({ serial, name, in: A, lines });
  const inv = fold([{ serial: A }], [
    gear(0x40002001, "Gold Ring", ["Faster Casting 1", "Lower Mana Cost 8"]),
    gear(0x40002002, "Quarter Staff", ["Spell Channeling", "Mage Weapon -25 Skill", "Damage Increase 20"]),
    gear(0x40002003, "Katana", ["Hit Chance Increase 15", "Hit Fireball 30"]),
    gear(0x40002004, "Gold Earrings", ["Magery +10", "Swordsmanship +5", "Tactics +5"]),
    gear(0x40002005, "Gold Bracelet", ["Faster Casting 1", "Damage Increase 10"]),
    gear(0x40002006, "Platemail Gorget", ["Physical Resist 10", "Fire Resist 10"]),
    gear(0x40002007, "Leather Gloves", ["Physical Resist 5", "Faster Casting 0"]),
    gear(0x40002008, "Katana", ["Weapon Damage 11 - 13", "Physical Resist 25"]),
    gear(0x40002009, "Gargish Talwar", ["Spell Channeling", "Faster Casting -1", "Throwing +10", "Tactics +5"]),
    { serial: PEARL, name: "Black Pearl", in: A },
  ]);
  const items = Object.values(inv.items).sort((a, b) => a.serial - b.serial);
  assert.deepEqual(items.map((it) => [it.name, it.gear ? buildOf(it) : null]), [
    ["Black Pearl", null],
    ["Gold Ring", "caster"],
    ["Quarter Staff", "caster"],
    ["Katana", "melee"],
    ["Gold Earrings", "melee"],
    ["Gold Bracelet", "hybrid"],
    ["Platemail Gorget", "tank"],
    ["Leather Gloves", "other"],
    ["Katana", "melee"],
    ["Gargish Talwar", "melee"],
  ]);
  const takes = (build: RuleMatch["build"]): string[] => items.filter((it) => ruleMatches(it, { query: emptyRuleQuery(), build })).map((it) => it.name);
  assert.deepEqual(takes("caster"), ["Gold Ring", "Quarter Staff"]);
  assert.deepEqual(takes("other"), ["Leather Gloves"], "a build never takes what is not gear");
  assert.equal(takes(undefined).length, items.length);
  // The rule editor's live count and the plan agree on what a build rule takes.
  for (const build of BUILDS) {
    const cfg = config({ labels: labels(A), rules: [{ id: "r", name: "r", match: { query: emptyRuleQuery(), build }, targets: [A], origin: "manual" }] });
    const counted = matchCount(inv, cfg, cfg.rules[0]!.match, { now: NOW }).count;
    assert.deepEqual([counted, planOrganize(inv, cfg, [], { now: NOW }).rules.find((r) => r.ruleId === "r")?.matched], [takes(build).length, takes(build).length], build);
  }
});

test("[fast] a spellbook with no caster or melee marker is Caster gear, a Book Of Chivalry included, and one with markers goes by them (issue #129)", () => {
  const inv = fold([{ serial: A }], [
    { serial: 0x40002001, name: "Spellbook", in: A },
    { serial: 0x40002002, name: "Necromancer Spellbook", in: A },
    { serial: 0x40002003, name: "Spellweaving Spellbook", in: A },
    { serial: 0x40002004, name: "Book Of Chivalry", in: A },
    { serial: 0x40002005, name: "Book Of Bushido", in: A, lines: ["Swordsmanship +5", "Tactics +5"] },
  ]);
  assert.deepEqual(Object.values(inv.items).sort((a, b) => a.serial - b.serial).map((it) => [it.name, it.slot, buildOf(it)]), [
    ["Spellbook", "oneHanded", "caster"], ["Necromancer Spellbook", "oneHanded", "caster"], ["Spellweaving Spellbook", "oneHanded", "caster"],
    ["Book Of Chivalry", "oneHanded", "caster"], ["Book Of Bushido", "oneHanded", "melee"],
  ]);
});

test("[fast] a shield with no caster or melee marker is Tank gear, whatever its resists (issue #123)", () => {
  const inv = fold([{ serial: A }], [
    { serial: 0x40002001, name: "Wooden Shield", in: A },
    { serial: 0x40002002, name: "Heater Shield", in: A, lines: ["Physical Resist 1%"] },
    { serial: 0x40002003, name: "Metal Kite Shield", in: A, lines: ["Spell Channeling", "Faster Casting -1"] },
    { serial: 0x40002004, name: "Order Shield", in: A, lines: ["Hit Chance Increase 10"] },
  ]);
  assert.deepEqual(Object.values(inv.items).sort((a, b) => a.serial - b.serial).map((it) => [it.name, buildOf(it)]), [
    ["Wooden Shield", "tank"], ["Heater Shield", "tank"], ["Metal Kite Shield", "caster"], ["Order Shield", "melee"],
  ]);
});

test("[fast] every By build marker is a property key or skill the tooltip parser really produces", () => {
  const keys = new Set(PROP_PATTERNS.map(([k]) => k)), skills = new Set(SKILL_NAMES);
  assert.deepEqual([...CASTER_PROPS, ...MELEE_PROPS].filter((k) => !keys.has(k)), []);
  assert.deepEqual([...CASTER_SKILLS, ...MELEE_SKILLS].filter((k) => !skills.has(k)), []);
});

test("[fast] a rule's free text never matches where the item sits", () => {
  const inv = fold([{ serial: A, name: "Reagents" }], [{ serial: KATANA, name: "Katana", in: A }, { serial: GARLIC, name: "Garlic", in: A }]);
  const m = { query: { ...emptyRuleQuery(), q: "reagent" } };
  assert.equal(ruleMatches(inv.items[KATANA]!, m), false, "a sword in a chest called Reagents is not a reagent");
  assert.equal(ruleMatches(inv.items[GARLIC]!, m), true);
});

const T1 = "2026-09-28T11:00:00Z";
const step = (serial: number, name: string, from: number | null, to: number | null, when = T1): OverlayMove => ({ serial, name, from, to, at: when, trip: "t-1" });

test("[fast] an Undesirables rule with skipSuits leaves a saved suit's piece to the rules below (issue #133)", () => {
  const AXE = 0x40001010, AXE2 = 0x40001011, lines = ["Splintering Weapon 20%", "Brittle"];
  const inv = fold([{ serial: A, pos: at(100) }, { serial: B, pos: at(102) }, { serial: C, pos: at(104) }],
    [{ serial: AXE, name: "Axe", in: C, lines }, { serial: AXE2, name: "Axe", in: C, lines }, { serial: KATANA, name: "Katana", in: C, lines: ["Splintering Weapon 5%"] }]);
  const fodder: OrganizeRule = { id: "fodder", name: "Fodder", match: { query: { ...emptyRuleQuery(), tags: ["brittle"], props: [{ key: "splintering weapon", min: 10 }] }, skipSuits: true }, targets: [A], origin: "manual" };
  const cfg = config({ labels: labels(A, B, C), rules: [fodder, rule("gear", { kind: ["gear"] }, [B])] });
  const suits = new Set([AXE2]);
  assert.deepEqual(claimOf(inv.items[AXE]!, cfg, [], suits), { ruleId: "fodder", alsoMatched: ["gear"] });
  assert.deepEqual(claimOf(inv.items[AXE2]!, cfg, [], suits), { ruleId: "gear", alsoMatched: [] });
  assert.deepEqual(claimOf(inv.items[KATANA]!, cfg, [], suits), { ruleId: "gear", alsoMatched: [] }, "below the threshold");
  assert.equal(claimOf(inv.items[AXE2]!, { ...cfg, rules: [{ ...fodder, match: { ...fodder.match, skipSuits: false } }, ...cfg.rules.slice(1)] }, [], suits)?.ruleId, "fodder", "only a skipSuits rule looks at the suits");
  assert.equal(matchCount(inv, cfg, fodder.match, { now: NOW, suitPieces: suits }).count, 1);
  assert.deepEqual(moved(planOrganize(inv, cfg, [], { now: NOW, suitPieces: suits })).map(([s, , to]) => [s, to]), [[AXE, A], [KATANA, B], [AXE2, B]].sort((x, y) => x[0]! - y[0]!));
});

test("[fast] homeOf: the nearest container above an item that is some rule's target", () => {
  const inv = fold([{ serial: A }, { serial: BAG, parent: A }, { serial: POUCH, parent: BAG }], [{ serial: PEARL, name: "Black Pearl", in: POUCH }]);
  const pearl = inv.items[PEARL]!;
  assert.equal(homeOf(inv, pearl, new Set([A])), A, "a sub-bag of a target counts as the target");
  assert.equal(homeOf(inv, pearl, new Set([A, BAG])), BAG, "a sub-bag that is itself a target is the item's home");
  assert.equal(homeOf(inv, pearl, new Set()), null);
});

test("[fast] the overlay puts a moved item where the bridge put it and adjusts both containers' counts", () => {
  const inv = fold([{ serial: A }, { serial: B, pos: at(104) }], [{ serial: PEARL, name: "Black Pearl", in: A, weight: 3 }]);
  const before = JSON.stringify(inv);
  const placed = applyOverlay(inv, [step(PEARL, "Black Pearl", A, B)]);
  assert.equal(placed.inv.items[PEARL]!.container, B);
  assert.equal(placed.inv.items[PEARL]!.root, B);
  assert.deepEqual(placed.counts.get(A), { items: 0, maxItems: 125, stones: 0, maxStones: null });
  assert.deepEqual(placed.counts.get(B), { items: 1, maxItems: 125, stones: 3, maxStones: null });
  assert.deepEqual(placed.carried, []);
  assert.equal(JSON.stringify(inv), before, "the inventory handed in is not changed");
});

test("[fast] an overlay step the scans have seen since is ignored", () => {
  const inv = fold([{ serial: A }, { serial: B, pos: at(104) }], [{ serial: PEARL, name: "Black Pearl", in: A }]);
  const placed = applyOverlay(inv, [step(PEARL, "Black Pearl", A, B, "2026-09-28T09:00:00Z")]);
  assert.equal(placed.inv.items[PEARL]!.container, A);
  assert.equal(placed.counts.get(B)!.items, 0);
});

test("[fast] an overlay step for an item gone from the scans still counts in its destination until that is rescanned", () => {
  const first = houseScan({ boxes: [{ serial: A }, { serial: B, pos: at(104) }], things: [{ serial: PEARL, name: "Black Pearl", in: A }] });
  const rescanOfA = houseScan({ scannedAt: "2026-09-28T12:00:00Z", boxes: [{ serial: A }] });
  const inv = foldSnapshots([first, rescanOfA]);
  assert.equal(inv.items[PEARL], undefined, "A was rescanned without it");
  const placed = applyOverlay(inv, [step(PEARL, "Black Pearl", A, B)]);
  assert.equal(placed.counts.get(A)!.items, 0, "A's Contents line was read after the step: it already leaves the pearl out");
  assert.equal(placed.counts.get(B)!.items, 1, "B's line predates the step");
});

test("[fast] an item taken and not yet put is carried, in no container", () => {
  const inv = fold([{ serial: A }], [{ serial: PEARL, name: "Black Pearl", in: A }]);
  const placed = applyOverlay(inv, [step(PEARL, "Black Pearl", A, null)]);
  assert.equal(placed.inv.items[PEARL]!.container, null);
  assert.equal(placed.inv.items[PEARL]!.root, null);
  assert.deepEqual(placed.carried, [{ serial: PEARL, name: "Black Pearl" }]);
  assert.equal(placed.counts.get(A)!.items, 0);
});

test("[fast] overlaidInventory: a moved item's location, root and container all read its destination, and fills are the overlay's", () => {
  const inv = fold([{ serial: A }, { serial: B, pos: at(104) }, { serial: BAG, parent: B }], [{ serial: PEARL, name: "Black Pearl", in: A }, { serial: RUBY, name: "Ruby", in: A }]);
  const before = JSON.stringify(inv);
  const view = overlaidInventory(inv, [step(PEARL, "Black Pearl", A, BAG)]);
  const pearl = view.items[PEARL]!;
  assert.deepEqual([pearl.container, pearl.root, pearl.location?.text, pearl.location?.root], [BAG, B, `Box ${B} › Box ${BAG}`, B]);
  assert.equal(view.items[RUBY], inv.items[RUBY], "an item the overlay does not move is the fold's own");
  assert.deepEqual([view.containers[A]!.capacity!.items, view.containers[B]!.capacity!.items, view.containers[BAG]!.capacity!.items], [1, 2, 1]);
  assert.equal(view.containers[A]!.serial, A);
  assert.equal(JSON.stringify(inv), before, "the fold handed in is not changed");
  assert.equal(overlaidInventory(inv, [step(PEARL, "Black Pearl", A, BAG, "2026-09-28T09:00:00Z")]).items[PEARL]!.location?.text, `Box ${A}`, "a step its scan has seen since is over");
});

test("[fast] overlaidInventory: a carried item is in its character's backpack, or says it is carried when that backpack is not in the scans", () => {
  const inv = fold([{ serial: A }, { serial: PACK, kind: "backpack", name: "Backpack" }], [{ serial: PEARL, name: "Black Pearl", in: A }]);
  const mine = overlaidInventory(inv, [{ ...step(PEARL, "Black Pearl", A, null), character: "Tester" }]).items[PEARL]!;
  assert.deepEqual([mine.container, mine.root, mine.location?.kind, mine.location?.character, mine.location?.text], [PACK, PACK, "backpack", "Tester", "Tester's backpack"]);
  const counted = fold([{ serial: A }, { serial: PACK, kind: "backpack", name: "Backpack", tooltip: ["Backpack", "Contents: 3/125 Items, 10/550 Stones"] }], [{ serial: PEARL, name: "Black Pearl", in: A, weight: 2 }]);
  assert.deepEqual(overlaidInventory(counted, [{ ...step(PEARL, "Black Pearl", A, null), character: "Tester" }]).containers[PACK]!.capacity, { items: 4, maxItems: 125, stones: 12, maxStones: 550 }, "a backpack that states its fill counts what it carries");
  const other = overlaidInventory(inv, [{ ...step(PEARL, "Black Pearl", A, null), character: "Someone" }]).items[PEARL]!;
  assert.deepEqual([other.container, other.root, other.location?.character, other.location?.text], [null, null, "Someone", "Carried by Organize (Someone)"]);
  assert.equal(overlaidInventory(inv, [step(PEARL, "Black Pearl", A, null)]).items[PEARL]!.location?.text, "Carried by Organize");
});

// Issue #153: a bag, a pouch in it, and a gem in each, in chest A. The Contents lines count every item nested under
// a container, bags included, and a bag's own weight (one stone here, as the scans give none) with its contents'.
const bagBoxes = (inA = 4): BoxSpec[] => [{ serial: A, tooltip: [`Box ${A}`, `Contents: ${inA}/125 Items, ${inA + 1} Stones`] }, { serial: B, pos: at(104) },
  { serial: BAG, parent: A, tooltip: [`Box ${BAG}`, "Contents: 3/125 Items, 4 Stones"] }, { serial: POUCH, parent: BAG }];
const bagThings: ThingSpec[] = [{ serial: RUBY, name: "Ruby", in: BAG, weight: 2 }, { serial: PEARL, name: "Black Pearl", in: POUCH }];

test("[fast] a bag the overlay moves takes its new place in the container tree, with everything in it and its whole fill (issue #153)", () => {
  const inv = fold(bagBoxes(), bagThings);
  const before = JSON.stringify(inv);
  const placed = applyOverlay(inv, [step(BAG, "Bag", A, B)]);
  const c = placed.inv.containers;
  assert.deepEqual([c[BAG]!.parent, c[BAG]!.root, c[POUCH]!.parent, c[POUCH]!.root], [B, B, BAG, B]);
  assert.deepEqual(ancestry(placed.inv, POUCH), [POUCH, BAG, B]);
  assert.deepEqual([placed.inv.items[RUBY]!.root, placed.inv.items[PEARL]!.root, placed.inv.items[PEARL]!.container], [B, B, POUCH]);
  assert.deepEqual([placed.counts.get(A)!.items, placed.counts.get(A)!.stones], [0, 0], "the old chest loses the bag and all it holds");
  assert.deepEqual([placed.counts.get(B)!.items, placed.counts.get(B)!.stones], [4, 5], "the new chest gains them");
  assert.equal(JSON.stringify(inv), before, "the inventory handed in is not changed");
  const view = overlaidInventory(inv, [step(BAG, "Bag", A, B)]);
  assert.deepEqual([view.containers[BAG]!.parent, view.items[PEARL]!.root, view.items[PEARL]!.location?.text], [B, B, `Box ${B} › Box ${BAG} › Box ${POUCH}`]);
  assert.deepEqual([view.containers[A]!.capacity!.items, view.containers[B]!.capacity!.items], [0, 4]);
});

test("[fast] after the overlay moves a bag, a put into it is planned and sent through the chest it is in now (issue #153)", () => {
  const inv = fold([{ serial: A }, { serial: B, pos: at(104) }, { serial: BAG, parent: A }], [{ serial: RUBY, name: "Ruby", in: A }]);
  const overlay = [step(BAG, "Bag", A, B)];
  const plan = planOrganize(inv, config({ labels: { ...labels(A, B), ...labels(BAG) }, rules: [gems([BAG])] }), overlay, { now: NOW });
  assert.deepEqual(moved(plan), [[RUBY, A, BAG, 1]]);
  assert.deepEqual(tripCommand(applyOverlay(inv, overlay).inv, plan, 1)!.puts, [{ serial: RUBY, name: "Ruby", dest: [B, BAG] }]);
});

test("[fast] overlay steps run oldest first, so a step into a bag counts wherever the bag stood at the time (issue #153)", () => {
  // B's line was read between the garlic going into the bag and the bag going into B: it counts neither.
  const inv = foldSnapshots([houseScan({ boxes: bagBoxes(5), things: [...bagThings, { serial: GARLIC, name: "Garlic", in: A }] }), houseScan({ scannedAt: "2026-09-28T10:45:00Z", boxes: [{ serial: B, pos: at(104) }] })]);
  const placed = applyOverlay(inv, [step(BAG, "Bag", A, B), step(GARLIC, "Garlic", A, BAG, "2026-09-28T10:30:00Z")]);
  assert.deepEqual([placed.counts.get(A)!.items, placed.counts.get(B)!.items, placed.counts.get(BAG)!.items], [0, 5, 4], "the garlic went into the bag in A, then left with it");
  assert.equal(placed.inv.items[GARLIC]!.root, B);
  const later = applyOverlay(fold(bagBoxes(), bagThings), [step(BAG, "Bag", A, B), step(GARLIC, "Garlic", null, BAG, "2026-09-28T12:00:00Z")]);
  assert.equal(later.counts.get(B)!.items, 5, "a step into the bag after its move counts in its new chest");
});

test("[fast] a bag seen in its new chest does not carry off the old chest what steps into it had moved already (issue #153)", () => {
  // A's line counts the garlic, the bag and the ruby in it. The garlic went into the bag, then the bag to B, and a
  // scan of B has seen both since: A counted the garlic once, so it loses it once.
  const first = houseScan({ boxes: [{ serial: A, tooltip: [`Box ${A}`, "Contents: 3/125 Items, 3 Stones"] }, { serial: B, pos: at(104) }, { serial: BAG, parent: A }],
    things: [{ serial: GARLIC, name: "Garlic", in: A }, { serial: RUBY, name: "Ruby", in: BAG }] });
  const ofB = houseScan({ scannedAt: "2026-09-28T12:00:00Z", boxes: [{ serial: B, pos: at(104) }, { serial: BAG, parent: B }],
    things: [{ serial: GARLIC, name: "Garlic", in: BAG }, { serial: RUBY, name: "Ruby", in: BAG }] });
  const placed = applyOverlay(foldSnapshots([first, ofB]), [step(GARLIC, "Garlic", A, BAG, "2026-09-28T10:30:00Z"), step(BAG, "Bag", A, B)]);
  assert.deepEqual([placed.counts.get(A)!.items, placed.counts.get(A)!.stones], [0, 0]);
  assert.equal(placed.counts.get(B)!.items, 3, "B's line is newer than both steps");
});

test("[fast] a pouch stepped into or out of a seen bag before its move counts with its whole fill (issue #153)", () => {
  const LATER = "2026-09-28T12:00:00Z";
  const inPouch: ThingSpec[] = [{ serial: KATANA, name: "Katana", in: POUCH }, { serial: ASH, name: "Sulfurous Ash", in: POUCH }, { serial: GARLIC, name: "Garlic", in: POUCH }];
  const three: ThingSpec[] = [PEARL, PEARL2, PEARL3].map((serial) => ({ serial, name: "Black Pearl", in: A }));
  // The pouch went from C into the bag, then the bag from A to B; B and C were scanned since. A keeps its three pearls.
  const into = foldSnapshots([
    houseScan({ boxes: [{ serial: A, tooltip: [`Box ${A}`, "Contents: 5/125 Items, 5 Stones"] }, { serial: B, pos: at(104) }, { serial: C, pos: at(108) }, { serial: BAG, parent: A }, { serial: POUCH, parent: C }],
      things: [...three, { serial: RUBY, name: "Ruby", in: BAG }, ...inPouch] }),
    houseScan({ scannedAt: LATER, boxes: [{ serial: B, pos: at(104) }, { serial: C, pos: at(108) }, { serial: BAG, parent: B, tooltip: [`Box ${BAG}`, "Contents: 5/125 Items, 5 Stones"] }, { serial: POUCH, parent: BAG }],
      things: [{ serial: RUBY, name: "Ruby", in: BAG }, ...inPouch] })]);
  const a = applyOverlay(into, [step(POUCH, "Pouch", C, BAG, "2026-09-28T10:30:00Z"), step(BAG, "Bag", A, B)]).counts.get(A)!;
  assert.deepEqual([a.items, a.stones], [3, 3], "into the bag");
  // The pouch went from the bag back to C, then the bag from A to B.
  const out = foldSnapshots([
    houseScan({ boxes: [{ serial: A, tooltip: [`Box ${A}`, "Contents: 9/125 Items, 9 Stones"] }, { serial: B, pos: at(104) }, { serial: C, pos: at(108) }, { serial: BAG, parent: A }, { serial: POUCH, parent: BAG }],
      things: [...three, { serial: RUBY, name: "Ruby", in: BAG }, ...inPouch] }),
    houseScan({ scannedAt: LATER, boxes: [{ serial: B, pos: at(104) }, { serial: C, pos: at(108) }, { serial: BAG, parent: B }, { serial: POUCH, parent: C }],
      things: [{ serial: RUBY, name: "Ruby", in: BAG }, ...inPouch] })]);
  const b = applyOverlay(out, [step(POUCH, "Pouch", BAG, C, "2026-09-28T10:30:00Z"), step(BAG, "Bag", A, B)]).counts.get(A)!;
  assert.deepEqual([b.items, b.stones], [3, 3], "out of the bag");
});

test("[fast] a bag taken and not yet put leaves its contents where they were; the container it left loses only the bag (issue #153)", () => {
  const inv = fold([...bagBoxes(), { serial: PACK, kind: "backpack", name: "Backpack", tooltip: ["Backpack", "Contents: 0/125 Items, 0/550 Stones"] }], bagThings);
  const taken = { ...step(BAG, "Bag", A, null), character: "Tester" };
  const placed = applyOverlay(inv, [taken]);
  assert.deepEqual([placed.counts.get(A)!.items, placed.counts.get(A)!.stones], [3, 4]);
  assert.deepEqual([placed.inv.containers[BAG]!.parent, placed.inv.items[PEARL]!.root], [A, A]);
  assert.deepEqual(placed.carried, [{ serial: BAG, name: "Bag" }]);
  assert.equal(overlaidInventory(inv, [taken]).containers[PACK]!.capacity!.items, 1, "the backpack gains the one the chest lost");
});

test("[fast] a scan of a moved bag newer than its move wins over the overlay (issue #153)", () => {
  const inv = foldSnapshots([houseScan({ boxes: bagBoxes(), things: bagThings }), houseScan({ scannedAt: "2026-09-28T12:00:00Z", boxes: bagBoxes(), things: bagThings })]);
  const placed = applyOverlay(inv, [step(BAG, "Bag", A, B)]);
  assert.deepEqual([placed.inv.containers[BAG]!.parent, placed.inv.items[PEARL]!.root], [A, A]);
  assert.deepEqual([placed.counts.get(A)!.items, placed.counts.get(B)!.items], [4, 0]);
});

const simOf = (inv: Inventory): Sim => newSim(inv, applyOverlay(inv, []).counts);
const fill = (s: Sim, serial: number) => [s.counts.get(serial)!.items, s.counts.get(serial)!.stones];

test("[fast] a take frees a slot in its container and every container around it, and rollback puts it back", () => {
  const inv = fold([{ serial: A }, { serial: BAG, parent: A }], [{ serial: PEARL, name: "Black Pearl", in: BAG, weight: 2 }]);
  const s = simOf(inv);
  const m = mark(s);
  simTake(s, inv.items[PEARL]!);
  assert.deepEqual([fill(s, A), fill(s, BAG)], [[1, 0], [0, 0]]);
  rollback(s, m);
  assert.deepEqual([fill(s, A), fill(s, BAG)], [[2, 2], [1, 2]]);
});

test("[fast] a put needs room in the target and in every container around it", () => {
  const inv = fold([{ serial: A, max: 2 }, { serial: BAG, parent: A, max: 10 }, { serial: C, pos: at(106) }],
    [{ serial: RUBY, name: "Ruby", in: A }, { serial: GARLIC, name: "Garlic", in: C }]);
  const s = simOf(inv);
  assert.equal(simPut(s, inv.items[GARLIC]!, [BAG], new Set()), null, "the bag has room, the chest around it does not");
  simTake(s, inv.items[RUBY]!);
  assert.deepEqual(simPut(s, inv.items[GARLIC]!, [BAG], new Set()), { to: BAG, merged: false });
  assert.deepEqual([fill(s, A)[0], fill(s, BAG)[0]], [2, 1]);
});

test("[fast] the chain overflows into its next target when the first is full", () => {
  const inv = fold([{ serial: A, max: 1 }, { serial: C, pos: at(106) }, { serial: B, pos: at(104) }],
    [{ serial: RUBY, name: "Ruby", in: A }, { serial: GARLIC, name: "Garlic", in: B }]);
  assert.deepEqual(simPut(simOf(inv), inv.items[GARLIC]!, [A, C], new Set()), { to: C, merged: false });
});

test("[fast] a put merges into a same-name, same-hue, same-graphic stack already in that exact container, using no slot", () => {
  const inv = fold([{ serial: A, max: 1 }, { serial: B, pos: at(104) }],
    [{ serial: PEARL, name: "Black Pearl", amount: 10, weight: 10, in: A }, { serial: PEARL2, name: "Black Pearl", amount: 5, weight: 5, in: B }]);
  const s = simOf(inv);
  assert.deepEqual(simPut(s, inv.items[PEARL2]!, [A], new Set()), { to: A, merged: true });
  assert.deepEqual(fill(s, A), [1, 15]);
});

test("[fast] single items never merge, nor stacks past 60,000, nor other hues, nor into a stack that is itself moving", () => {
  const cases: [string, ThingSpec, ThingSpec, Set<number>][] = [
    ["two single items", { serial: KATANA, name: "Katana", in: A }, { serial: PEARL2, name: "Katana", in: B }, new Set()],
    ["past the stack cap", { serial: PEARL, name: "Black Pearl", amount: MAX_STACK - 2, in: A }, { serial: PEARL2, name: "Black Pearl", amount: 5, in: B }, new Set()],
    ["another hue", { serial: PEARL, name: "Black Pearl", amount: 10, in: A }, { serial: PEARL2, name: "Black Pearl", amount: 5, hue: 1150, in: B }, new Set()],
    ["a stack that is moving", { serial: PEARL, name: "Black Pearl", amount: 10, in: A }, { serial: PEARL2, name: "Black Pearl", amount: 5, in: B }, new Set([PEARL])],
  ];
  for (const [what, there, incoming, movers] of cases) {
    const inv = fold([{ serial: A, max: 1 }, { serial: B, pos: at(104) }], [there, incoming]);
    assert.equal(simPut(simOf(inv), inv.items[incoming.serial]!, [A], movers), null, what);
  }
});

test("[fast] weight is checked only where the container has a stone cap", () => {
  const inv = fold([{ serial: A, maxStones: 10 }, { serial: B, pos: at(104) }, { serial: C, pos: at(106) }],
    [{ serial: PEARL, name: "Black Pearl", in: A, weight: 9 }, { serial: GARLIC, name: "Garlic", in: C, weight: 2 }, { serial: RUBY, name: "Ruby", in: C, weight: 1 }]);
  const s = simOf(inv);
  assert.equal(simPut(s, inv.items[GARLIC]!, [A], new Set()), null);
  assert.deepEqual(simPut(s, inv.items[RUBY]!, [A], new Set()), { to: A, merged: false });
  assert.deepEqual(simPut(s, inv.items[GARLIC]!, [B], new Set()), { to: B, merged: false }, "no cap on B");
});

const reagents = (targets: number[]) => rule("reagents", { kind: ["reagent"] }, targets);
const gems = (targets: number[]) => rule("gems", { kind: ["gem"] }, targets);
const moved = (p: Plan): (number | null)[][] => p.moves.map((m) => [m.serial, m.from, m.to, m.trip]).sort((x, y) => x[0]! - y[0]!);
const pearls = (n: number, inside: number, weight = 1): ThingSpec[] => Array.from({ length: n }, (_, i) => ({ serial: 0x40002000 + i, name: "Black Pearl", in: inside, weight }));

test("[fast] items move into their rule's target; unclaimed items stay; unlabelled chests are never touched", () => {
  const inv = fold([{ serial: A, pos: at(100) }, { serial: B, pos: at(104) }, { serial: STRANGER, pos: at(102) }],
    [{ serial: PEARL, name: "Black Pearl", in: B }, { serial: RUBY, name: "Ruby", in: A }, { serial: KATANA, name: "Katana", in: A },
      { serial: ASH, name: "Sulfurous Ash", in: STRANGER }, { serial: GARLIC, name: "Garlic", in: A }]);
  const plan = planOrganize(inv, config({ labels: labels(A, B), rules: [reagents([A]), gems([B])] }), [], { now: NOW });
  assert.deepEqual(moved(plan), [[PEARL, B, A, 1], [RUBY, A, B, 1]]);
  assert.deepEqual(plan.trips, [{ index: 1, site: 0, takes: [RUBY, PEARL], puts: [RUBY, PEARL] }]);
  assert.deepEqual(plan.rules, [{ ruleId: "reagents", matched: 2, inPlace: 1, toMove: 1, noRoom: 0 }, { ruleId: "gems", matched: 1, inPlace: 0, toMove: 1, noRoom: 0 }]);
  assert.equal(plan.unclaimed, 1);
  assert.deepEqual(plan.sites, [{ index: 0, roots: [A, B] }]);
});

test("[fast] a chest that is both source and target in one trip: its takes free the room its puts use", () => {
  const inv = fold([{ serial: A, max: 1 }, { serial: B, max: 1, pos: at(104) }], [{ serial: RUBY, name: "Ruby", in: A }, { serial: PEARL, name: "Black Pearl", in: B }]);
  const plan = planOrganize(inv, config({ labels: labels(A, B), rules: [reagents([A]), gems([B])] }), [], { now: NOW });
  assert.deepEqual(moved(plan), [[PEARL, B, A, 1], [RUBY, A, B, 1]]);
  assert.deepEqual(plan.room.map((r) => r.shortfall), [0, 0]);
});

test("[fast] a slot freed by one trip is used by the next, never the other way round", () => {
  const inv = fold([{ serial: A, max: 1 }, { serial: B, max: 5, pos: at(104) }], [{ serial: RUBY, name: "Ruby", in: A }, { serial: PEARL, name: "Black Pearl", in: B }]);
  const plan = planOrganize(inv, config({ labels: labels(A, B), rules: [reagents([A]), gems([B])] }), [], { now: NOW, tripItems: 1 });
  assert.deepEqual(moved(plan), [[PEARL, B, A, 2], [RUBY, A, B, 1]]);
});

test("[fast] a full chain leaves the rest where they are, counted as no room", () => {
  const inv = fold([{ serial: A, max: 1 }, { serial: C, max: 1, pos: at(106) }, { serial: B, pos: at(104) }],
    [{ serial: PEARL, name: "Black Pearl", in: B }, { serial: PEARL2, name: "Black Pearl", in: B }, { serial: PEARL3, name: "Black Pearl", in: B }]);
  const plan = planOrganize(inv, config({ labels: labels(A, B, C), rules: [reagents([A, C])] }), [], { now: NOW });
  assert.deepEqual(moved(plan), [[PEARL, B, A, 1], [PEARL2, B, C, 1]]);
  assert.deepEqual(plan.rules, [{ ruleId: "reagents", matched: 3, inPlace: 0, toMove: 2, noRoom: 1 }]);
  assert.deepEqual(plan.room, [{ ruleId: "reagents", needSlots: 3, freeSlots: 2, shortfall: 1 }]);
});

test("[fast] a rule targeting a chest at another house plans no move and reports it", () => {
  const OTHER_FACET = 0x40000009;
  const inv = fold([{ serial: A, pos: at(100) }, { serial: FAR, pos: at(400) }, { serial: OTHER_FACET, pos: at(100, 2) }], [{ serial: RUBY, name: "Ruby", in: A }]);
  for (const target of [FAR, OTHER_FACET]) {
    const plan = planOrganize(inv, config({ labels: labels(A, target), rules: [gems([target])] }), [], { now: NOW });
    assert.deepEqual(plan.moves, []);
    assert.deepEqual(plan.crossSite, [{ ruleId: "gems", count: 1 }]);
    assert.equal(plan.sites.length, 2);
  }
});

test("[fast] sites join chests single-link within 24 tiles on the same facet", () => {
  const D = 0x40000010;
  const inv = fold([{ serial: A, pos: at(100) }, { serial: B, pos: at(120) }, { serial: C, pos: at(140) }, { serial: D, pos: at(110, 2) }]);
  assert.deepEqual(sitesOf(inv, [D, C, B, A]), [[A, B, C], [D]]);
});

test("[fast] with a catch-all, unclaimed items go there; without one they stay", () => {
  const inv = fold([{ serial: A }, { serial: C, pos: at(106) }], [{ serial: KATANA, name: "Katana", in: A }]);
  const plan = planOrganize(inv, config({ labels: labels(A, C), catchAll: C }), [], { now: NOW });
  assert.deepEqual(plan.moves.map((m) => [m.serial, m.to, m.ruleId]), [[KATANA, C, CATCH_ALL_ID]]);
  assert.equal(planOrganize(inv, config({ labels: labels(A, C) }), [], { now: NOW }).unclaimed, 1);
});

test("[fast] a rule naming a container no scan has seen moves nothing, even into its other targets", () => {
  const inv = fold([{ serial: A }, { serial: B, pos: at(104) }], [{ serial: PEARL, name: "Black Pearl", in: B }]);
  const plan = planOrganize(inv, config({ labels: { ...labels(A, B), ...labels(0x4000ffff) }, rules: [reagents([0x4000ffff, A])] }), [], { now: NOW });
  assert.deepEqual(plan.moves, []);
  assert.ok(plan.warnings.some((w) => w.kind === "missing-target" && w.serial === 0x4000ffff));
});

test("[fast] trips hold at most tripItems items and tripStones stones", () => {
  const light = fold([{ serial: A }, { serial: B, pos: at(104) }], pearls(25, B));
  const cfg = config({ labels: labels(A, B), rules: [reagents([A])] });
  assert.deepEqual(planOrganize(light, cfg, [], { now: NOW }).trips.map((t) => t.takes.length), [20, 5]);
  const heavy = fold([{ serial: A }, { serial: B, pos: at(104) }], pearls(25, B, 10));
  assert.deepEqual(planOrganize(heavy, cfg, [], { now: NOW }).trips.map((t) => t.takes.length), [15, 10]);
});

test("[fast] every trip's queue line fits tripBytes", () => {
  const inv = fold([{ serial: A }, { serial: B, pos: at(104) }], pearls(20, B));
  const plan = planOrganize(inv, config({ labels: labels(A, B), rules: [reagents([A])] }), [], { now: NOW, tripBytes: 1024 });
  assert.ok(plan.trips.length > 1);
  for (const t of plan.trips) assert.ok(lineBytes(tripCommand(inv, plan, t.index)!) <= 1024, `trip ${t.index}`);
  assert.equal(plan.moves.length, 20);
});

test("[fast] a trash container is never moved, even by the catch-all", () => {
  const inv = fold([{ serial: A }, { serial: B, pos: at(104) }], [{ serial: RUBY, name: "Trash Barrel", in: A }, { serial: KATANA, name: "Katana", in: A }]);
  const plan = planOrganize(inv, config({ labels: labels(A, B), catchAll: B }), [], { now: NOW });
  assert.deepEqual(plan.moves.map((m) => m.serial), [KATANA]);
});

test("[fast] the room report counts a bag and the chest it sits in once: free room is how many more items fit", () => {
  const things: ThingSpec[] = Array.from({ length: 3 }, (_, i) => ({ serial: 0x40002000 + i, name: "Katana", in: A }));
  const inv = fold([{ serial: A, max: 10 }, { serial: BAG, parent: A, max: 10 }], things);
  const plan = planOrganize(inv, config({ labels: { ...labels(A), ...labels(BAG) }, rules: [reagents([A, BAG])] }), [], { now: NOW });
  assert.deepEqual(plan.room.map((r) => [r.ruleId, r.freeSlots]), [["reagents", 6]], "A holds the bag and 3 katanas: 6 more items fit, in A or in the bag");
});

test("[fast] two full chests trade contents: each trip takes for both rules, so the takes make the room", () => {
  const garlic: ThingSpec[] = Array.from({ length: 20 }, (_, i) => ({ serial: 0x40002000 + i, name: "Garlic", in: A, hue: i }));
  const rubies: ThingSpec[] = Array.from({ length: 20 }, (_, i) => ({ serial: 0x40003000 + i, name: "Ruby", in: B, hue: i }));
  const inv = fold([{ serial: A, max: 20 }, { serial: B, max: 20, pos: at(104) }], [...garlic, ...rubies]);
  const plan = planOrganize(inv, config({ labels: labels(A, B), rules: [reagents([B]), gems([A])] }), [], { now: NOW });
  assert.deepEqual(plan.rules.map((r) => [r.ruleId, r.toMove, r.noRoom]), [["reagents", 20, 0], ["gems", 20, 0]]);
  assert.deepEqual(plan.trips.map((t) => [t.takes.length, t.puts.length]), [[20, 20], [20, 20]]);
});

test("[fast] items a trip carried and did not put are planned as puts with nothing to take", () => {
  const inv = fold([{ serial: A }, { serial: B, pos: at(104) }], [{ serial: PEARL, name: "Black Pearl", in: B }]);
  const plan = planOrganize(inv, config({ labels: labels(A, B), rules: [reagents([A])] }), [step(PEARL, "Black Pearl", B, null)], { now: NOW });
  assert.deepEqual(plan.carried, [{ serial: PEARL, name: "Black Pearl" }]);
  assert.deepEqual(moved(plan), [[PEARL, null, A, 1]]);
  assert.deepEqual(plan.trips, [{ index: 1, site: 0, takes: [], puts: [PEARL] }]);
});

test("[fast] a carried item pinned since (a put the server refused) is not planned again", () => {
  const inv = fold([{ serial: A }, { serial: B, pos: at(104) }], [{ serial: PEARL, name: "Black Pearl", in: B }]);
  const plan = planOrganize(inv, config({ labels: labels(A, B), rules: [reagents([A])], pinnedItems: [PEARL] }), [step(PEARL, "Black Pearl", B, null)], { now: NOW });
  assert.deepEqual(plan.carried, [{ serial: PEARL, name: "Black Pearl" }]);
  assert.deepEqual(plan.moves, []);
});

test("[fast] a finished trip in the overlay is not planned again", () => {
  const inv = fold([{ serial: A }, { serial: B, pos: at(104) }], [{ serial: PEARL, name: "Black Pearl", in: B }]);
  const plan = planOrganize(inv, config({ labels: labels(A, B), rules: [reagents([A])] }), [step(PEARL, "Black Pearl", B, A)], { now: NOW });
  assert.deepEqual(plan.moves, []);
  assert.deepEqual(plan.rules, [{ ruleId: "reagents", matched: 1, inPlace: 1, toMove: 0, noRoom: 0 }]);
});

test("[fast] the same inputs in any order give the same plan", () => {
  const boxes: BoxSpec[] = [{ serial: A, max: 3 }, { serial: BAG, parent: A }, { serial: B, pos: at(104) }, { serial: C, pos: at(110) }];
  const things: ThingSpec[] = [...pearls(6, B), { serial: RUBY, name: "Ruby", in: BAG }, { serial: KATANA, name: "Katana", in: B }, { serial: GARLIC, name: "Garlic", in: C }];
  const cfg = config({ labels: labels(A, B, C), rules: [reagents([A, C]), gems([B])], catchAll: C });
  const shuffled = { ...cfg, labels: Object.fromEntries(Object.entries(cfg.labels).reverse()) };
  const one = planOrganize(fold(boxes, things), cfg, [], { now: NOW });
  const two = planOrganize(fold([...boxes].reverse(), [...things].reverse()), shuffled, [], { now: NOW });
  assert.equal(JSON.stringify(two), JSON.stringify(one));
});

test("[fast] the stamp changes when the plan changes, and only then", () => {
  const inv = fold([{ serial: A }, { serial: B, pos: at(104) }], [{ serial: PEARL, name: "Black Pearl", in: B }]);
  const cfg = config({ labels: labels(A, B), rules: [reagents([A])] });
  const stamp = planOrganize(inv, cfg, [], { now: NOW }).stamp;
  assert.match(stamp, /^[0-9a-f]{8}$/);
  assert.equal(planOrganize(inv, cfg, [], { now: NOW + 1000 }).stamp, stamp);
  assert.notEqual(planOrganize(inv, { ...cfg, rules: [reagents([B])] }, [], { now: NOW }).stamp, stamp);
  assert.notEqual(planOrganize(inv, cfg, [step(PEARL, "Black Pearl", B, A)], { now: NOW }).stamp, stamp);
});

test("[fast] tripCommand builds the line queueTrip writes: every root placed once, chains root first, the plan's stamp", () => {
  const inv = fold([{ serial: A }, { serial: BAG, parent: A }, { serial: B, pos: { x: 104, y: 100, z: 5, facet: 1 } }],
    [{ serial: PEARL, name: "Black Pearl", in: B }, { serial: RUBY, name: "Ruby", in: BAG }]);
  const plan = planOrganize(inv, config({ labels: { ...labels(A, B), ...labels(BAG) }, rules: [reagents([BAG]), gems([B])] }), [], { now: NOW });
  const trip = tripCommand(inv, plan, 1)!;
  assert.deepEqual(trip, {
    index: 1, stamp: plan.stamp,
    roots: { [String(A)]: { x: 100, y: 100, z: 0, facet: 1 }, [String(B)]: { x: 104, y: 100, z: 5, facet: 1 } },
    takes: [{ serial: RUBY, name: "Ruby", chain: [A, BAG] }, { serial: PEARL, name: "Black Pearl", chain: [B] }],
    puts: [{ serial: RUBY, name: "Ruby", dest: [B] }, { serial: PEARL, name: "Black Pearl", dest: [A, BAG] }],
  });
  assert.equal(tripCommand(inv, plan, 2), null);
  const paths = resolveConfig(["--port", "0", "--data", mkdtempSync(join(tmpdir(), "qm-organize-trip-"))], {}).paths;
  const queued = queueTrip(paths, "tazuo", trip);
  assert.equal(queued.ok, true, JSON.stringify(queued));
  // Issue #130: the chests are 4 tiles apart, so a tile reaches both. The ruby's put waits for the backpack (the
  // pearl's take, after it, frees room in B); the pearl goes straight into the bag. Three containers are opened.
  assert.deepEqual([...directSerials(trip)], [PEARL]);
  assert.equal(tripSeconds(trip), STEP_S.trip + 3 * STEP_S.open + STEP_S.direct + STEP_S.take + STEP_S.put);
  assert.equal(plan.seconds, Math.round(tripSeconds(trip)));
});

test("[fast] a trip's takes at one stop run grouped by where they go, and only chests close enough move directly", () => {
  const inv = fold([{ serial: A }, { serial: B, pos: at(104) }, { serial: C, pos: at(105) }],
    [{ serial: PEARL, name: "Black Pearl", in: A }, { serial: RUBY, name: "Ruby", in: A }, { serial: PEARL2, name: "Black Pearl", in: A }]);
  const plan = planOrganize(inv, config({ labels: labels(A, B, C), rules: [reagents([B]), gems([C])] }), [], { now: NOW });
  const trip = tripCommand(inv, plan, 1)!;
  assert.deepEqual(trip.takes.map((t) => t.serial), [PEARL, PEARL2, RUBY], "both pearls, then the ruby");
  assert.deepEqual([...directSerials(trip)], [PEARL, PEARL2], "B is 4 tiles from A, C is 5");
  assert.equal(plan.seconds, Math.round(STEP_S.trip + 3 * STEP_S.open + 2 * STEP_S.direct + STEP_S.take + STEP_S.put));
});

test("[smoke] the TazUO fixture: every put fits when the trips are replayed in order", () => {
  const raw = JSON.parse(readFileSync(join(HERE, "..", "adapters", "tazuo", "fixture.scan.json"), "utf8")) as ScanV2;
  const inv = foldSnapshots([raw]);
  const grounds = Object.values(inv.containers).filter((c) => c.parent == null && c.kind === "ground").map((c) => +c.serial).sort((a, b) => a - b);
  const cfg = config({ labels: labels(...grounds), rules: [rule("gear", { kind: ["gear"] }, [grounds[2]!, grounds[3]!])] });
  const now = Date.parse(raw.scannedAt) + 3600e3;
  const plan = planOrganize(inv, cfg, [], { now });
  assert.ok(plan.moves.length > 0);
  for (const m of plan.moves) assert.ok(cfg.labels[String(ancestry(inv, m.to)!.at(-1))], `move ${m.serial} lands in a labelled root`);
  const counts = new Map(Object.values(inv.containers).filter((c) => c.capacity).map((c) => [+c.serial, c.capacity!.items]));
  const bump = (serial: number | null, d: number): void => { for (const s of ancestry(inv, serial) ?? []) if (counts.has(s)) counts.set(s, counts.get(s)! + d); };
  for (const trip of plan.trips) {
    for (const s of trip.takes) bump(plan.moves.find((m) => m.serial === s)!.from, -1);
    for (const s of trip.puts) {
      const m = plan.moves.find((x) => x.serial === s)!;
      bump(m.to, 1);
      for (const c of ancestry(inv, m.to)!) assert.ok(counts.get(c)! <= inv.containers[c]!.capacity!.maxItems, `trip ${trip.index} overfills ${c}`);
    }
  }
  const reordered = foldSnapshots([{ ...raw, items: [...raw.items].reverse() }]);
  assert.equal(JSON.stringify(planOrganize(reordered, cfg, [], { now })), JSON.stringify(plan));
});

// Put away (issue #131): the container the player picked as the run's only source, and only what lies directly in it.
const HOME = { x: 101, y: 100, facet: 1 };
test("[fast] Put away from the backpack puts only what lies directly in it, into the house the character stands in", () => {
  const IN_POUCH = 0x40001008, BLESSED = 0x40001009, UNCLAIMED = 0x4000100a;
  const inv = fold([{ serial: A }, { serial: B, pos: at(104) }, { serial: FAR, pos: at(300) }, { serial: PACK, kind: "backpack" }, { serial: POUCH, parent: PACK }],
    [{ serial: PEARL, name: "Black Pearl", in: PACK }, { serial: RUBY, name: "Ruby", in: PACK }, { serial: PEARL2, name: "Black Pearl", in: PACK },
      { serial: IN_POUCH, name: "Black Pearl", in: POUCH }, { serial: BLESSED, name: "Black Pearl", in: PACK, lines: ["<b>Blessed</b>"] },
      { serial: UNCLAIMED, name: "Katana", in: PACK }, { serial: PEARL3, name: "Black Pearl", in: B }]);
  const cfg = config({ labels: labels(A, B, FAR), rules: [rule("pearls", {}, [A], ["pearl"]), rule("rubies", {}, [FAR], ["ruby"])], pinnedItems: [PEARL2] });
  const plan = planOrganize(inv, cfg, [], { now: NOW, putAway: { from: "pack", container: PACK, at: HOME } });
  assert.deepEqual(plan.moves.map((m) => [m.serial, m.from, m.to]), [[PEARL, null, A], [BLESSED, null, A]], "the blessed pearl too, never the pinned pearl, the pouch's, nor the chest's");
  assert.deepEqual(plan.trips.map((t) => [t.takes, t.puts]), [[[], [PEARL, BLESSED]]]);
  assert.deepEqual(tripCommand(inv, plan, 1)!.takes, []);
  assert.deepEqual(plan.crossSite, [{ ruleId: "rubies", count: 1 }], "the ruby's chest is at another house");
  assert.equal(plan.unclaimed, 1);
  assert.deepEqual(packKept(inv, PACK, new Set([PEARL2])), { bags: 1, pinned: 1 }, "what stays, for the answer: the pouch and the pinned pearl");
  const withCatchAll = planOrganize(inv, { ...cfg, catchAll: A }, [], { now: NOW, putAway: { from: "pack", container: PACK, at: HOME } });
  assert.deepEqual([withCatchAll.moves.map((m) => m.serial).sort(), withCatchAll.unclaimed], [[PEARL, BLESSED, UNCLAIMED].sort(), 0], "the catch-all takes the unclaimed katana");
  const there = planOrganize(inv, cfg, [], { now: NOW, putAway: { from: "pack", container: PACK, at: { x: 301, y: 100, facet: 1 } } });
  assert.deepEqual(there.moves.map((m) => [m.serial, m.to]), [[RUBY, FAR]], "standing at the other house");
  const elsewhere = planOrganize(inv, cfg, [], { now: NOW, putAway: { from: "pack", container: PACK, at: { x: 101, y: 100, facet: 2 } } });
  assert.deepEqual(elsewhere.moves, [], "no house on this facet");
  assert.deepEqual(planOrganize(inv, cfg, [], { now: NOW }).moves.map((m) => [m.serial, m.from, m.to]), [[PEARL3, B, A]], "the house plan never takes from the backpack");
  const pouch = planOrganize(inv, cfg, [], { now: NOW, putAway: { from: "pack", container: POUCH, at: HOME } });
  assert.deepEqual(pouch.moves.map((m) => [m.serial, m.from, m.to]), [[IN_POUCH, null, A]], "a bag picked in the pack: only its own items");
});

test("[fast] Put away from a container in a labelled chest takes only what lies directly in it", () => {
  const IN = 0x40000009;
  const inv = fold([{ serial: A }, { serial: B, pos: at(104) }, { serial: IN, pos: at(102) }, { serial: BAG, parent: IN }],
    [{ serial: PEARL, name: "Black Pearl", in: IN }, { serial: RUBY, name: "Ruby", in: IN }, { serial: PEARL2, name: "Black Pearl", in: BAG }, { serial: PEARL3, name: "Black Pearl", in: B }]);
  const cfg = config({ labels: labels(A, B, IN), rules: [rule("pearls", {}, [A], ["pearl"])] });
  const plan = planOrganize(inv, cfg, [], { now: NOW, putAway: { from: "ground", container: IN } });
  assert.deepEqual(plan.moves.map((m) => [m.serial, m.from, m.to]), [[PEARL, IN, A]], "never the bag's pearl nor another chest's");
  assert.equal(plan.unclaimed, 1);
  assert.deepEqual(planOrganize(inv, cfg, [], { now: NOW, putAway: { from: "ground", container: BAG } }).moves.map((m) => [m.serial, m.from]), [[PEARL2, BAG]]);
});

test("[fast] Put away gathers no empty bags, which the house plan does", () => {
  const IN = 0x40000009;
  const inv = fold([{ serial: A }, { serial: BAG, parent: A }, { serial: B, pos: at(104) }, { serial: IN, pos: at(102) }, { serial: PACK, kind: "backpack" }],
    [{ serial: PEARL, name: "Black Pearl", in: IN }, { serial: PEARL2, name: "Black Pearl", in: PACK }]);
  const cfg = config({ labels: labels(A, B, IN), rules: [rule("pearls", {}, [A], ["pearl"])], emptyBagsTo: B });
  assert.deepEqual(planOrganize(inv, cfg, [], { now: NOW }).moves.map((m) => m.serial).sort(), [BAG, PEARL].sort());
  assert.deepEqual(planOrganize(inv, cfg, [], { now: NOW, putAway: { from: "ground", container: IN } }).moves.map((m) => m.serial), [PEARL]);
  assert.deepEqual(planOrganize(inv, cfg, [], { now: NOW, putAway: { from: "pack", container: PACK, at: HOME } }).moves.map((m) => m.serial), [PEARL2],
    "a pack Put away trip takes nothing, so a bag in it would get the trip refused");
});

// Issue #128: the bags trips leave behind, gathered on request, and targets about to fill up.
const BAG2 = 0x40000011, BAG3 = 0x40000012, BAG4 = 0x40000013, BAG5 = 0x40000014, BAG6 = 0x40000015;
test("[fast] emptyBagsOf lists unlabelled bags holding nothing in labelled roots, never an unopened, pinned or blacklisted one", () => {
  const inv = fold([{ serial: A }, { serial: BAG, parent: A, name: "Weapons" }, { serial: BAG2, parent: A }, { serial: BAG3, parent: A, opened: false },
    { serial: BAG4, parent: A }, { serial: BAG5, parent: A }, { serial: POUCH, parent: A }, { serial: B, pos: at(104) }, { serial: BAG6, parent: B },
    { serial: C, pos: at(106) }, { serial: 0x40000016, parent: C }],
  [{ serial: RUBY, name: "Ruby", in: BAG2 }, { serial: PEARL, name: "Black Pearl", in: POUCH }]);
  const cfg = config({ labels: { ...labels(A, BAG4), [String(C)]: { serial: C, name: "Display", pinned: true, origin: "manual" } }, pinnedItems: [BAG5] });
  const roots = scopeOf(inv, cfg, { now: NOW }).roots;
  assert.deepEqual(emptyBagsOf(inv, applyOverlay(inv, []).counts, cfg, roots), [{ serial: BAG, name: "Weapons", container: A }],
    "not one with a ruby, an unopened one, a labelled one, a pinned item, one in an unlabelled chest or one in a pinned chest");
  assert.deepEqual(emptyBagsOf(inv, applyOverlay(inv, []).counts, cfg, roots, [BAG]), [], "nor a blacklisted one");
  const placed = applyOverlay(inv, [step(PEARL, "Black Pearl", POUCH, A)]);
  assert.deepEqual(emptyBagsOf(placed.inv, placed.counts, cfg, roots).map((b) => b.serial), [BAG, POUCH], "a bag a trip emptied is empty");
});

test("[fast] the plan lists empty bags, and with a gather container moves them there in ordinary trips", () => {
  const inv = fold([{ serial: A }, { serial: BAG, parent: A, name: "Weapons" }, { serial: C, pos: at(106) }]);
  const bare = planOrganize(inv, config({ labels: labels(A, C), rules: [gems([A])] }), [], { now: NOW });
  assert.deepEqual(bare.emptyBags, [{ serial: BAG, name: "Weapons", container: A }]);
  assert.deepEqual(bare.moves, [], "without a gather container nothing moves");
  const cfg = config({ labels: labels(A, C), rules: [gems([A])], emptyBagsTo: C });
  const plan = planOrganize(inv, cfg, [], { now: NOW });
  assert.deepEqual(plan.moves.map((m) => [m.serial, m.from, m.to, m.ruleId]), [[BAG, A, C, EMPTY_BAGS_ID]]);
  assert.deepEqual(plan.rules.at(-1), { ruleId: EMPTY_BAGS_ID, matched: 1, inPlace: 0, toMove: 1, noRoom: 0 });
  assert.deepEqual(tripCommand(inv, plan, 1)!.takes, [{ serial: BAG, name: "Weapons", chain: [A] }]);
  const after = planOrganize(inv, cfg, [step(BAG, "Weapons", A, C)], { now: NOW });
  assert.deepEqual([after.moves, after.emptyBags], [[], []], "a gathered bag is in place and no longer listed");
  assert.equal(after.rules.at(-1)!.inPlace, 1);
  const old = foldSnapshots([houseScan({ boxes: [{ serial: A }, { serial: BAG, parent: A, name: "Weapons" }, { serial: C, pos: at(106) }], bridge: ["highlight", "grab", "goto", "trip"] })]);
  const stale = planOrganize(old, cfg, [], { now: NOW });
  assert.deepEqual([stale.moves, stale.emptyBags.length], [[], 1], "scripts whose bridge does not declare trip-bags are never sent a bag");
  assert.deepEqual(stale.warnings.map((w) => [w.kind, w.serial]), [["old-scripts", C]]);
});

test("[fast] a target past 90% after the plan, with no later target to overflow into, is warned about, empty bags counted", () => {
  const inv = fold([{ serial: A, max: 10 }, { serial: BAG, parent: A }, { serial: B, pos: at(104) }, { serial: C, pos: at(106) }],
    [...pearls(7, A), { serial: ASH, name: "Sulfurous Ash", in: B }, { serial: GARLIC, name: "Garlic", in: B }]);
  const plan = planOrganize(inv, config({ labels: labels(A, B, C), rules: [reagents([A])] }), [], { now: NOW });
  assert.deepEqual(plan.warnings.filter((w) => w.kind === "nearly-full"), [{ kind: "nearly-full", serial: A,
    detail: 'Rule "reagents" fills it to 10/10 items after this plan (1 of them is an empty bag). Add another container to its targets, or make room.' }]);
  const overflow = planOrganize(inv, config({ labels: labels(A, B, C), rules: [reagents([A, C])] }), [], { now: NOW });
  assert.deepEqual(overflow.warnings.filter((w) => w.kind === "nearly-full"), [], "C still takes the overflow");
  const gathered = planOrganize(inv, config({ labels: labels(A, B, C), rules: [reagents([A])], emptyBagsTo: C }), [], { now: NOW });
  assert.deepEqual(gathered.warnings.filter((w) => w.kind === "nearly-full"), [], "gathering the bag out leaves it at 9/10, not past 90%");
  const nested = fold([{ serial: A, max: 10 }, { serial: POUCH, parent: A }, { serial: B, pos: at(104) }], [...pearls(8, A), { serial: ASH, name: "Sulfurous Ash", in: B }]);
  assert.deepEqual(planOrganize(nested, config({ labels: labels(A, POUCH, B), rules: [reagents([POUCH])] }), [], { now: NOW }).warnings.filter((w) => w.kind === "nearly-full").map((w) => w.serial), [A],
    "a bag target in a chest past 90% names the chest");
});
