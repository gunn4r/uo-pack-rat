// gear-vault.test.mts — `app/vault-lib.mts` (parser, classifier, fold, pools) and the optimizer core through the same loader the server uses.
//
// `app/vault-lib.mts`: tooltip parsing (property keys, tags, STR requirement, rarity, extras/flags, a set piece's full-set block kept out of its own props, a power scroll's level as `psLevel`, a Scroll of Transcendence's skill and points as `sotSkill` and `sotPoints` and its `displayName`), the shipped corpus (every `adapters/*/fixture.scan.json` plus both demo scans, parsed and classified the way the fold does it: no prop-carrying gear without a slot, every "... Arms" piece in the arms slot, every set piece's props equal to its lines above the set header, a worn piece taken off landing in its layer's slot, and named TazUO fixture pieces checked by slot and resist), graphic- and name-to-slot classification (with the golden table of issue #202: every layer case the research found, each checked by graphic and by name alone, and a spell scroll's graphic never gear whatever its name), snapshot folding (newest scan of a root wins, skipped roots keep their last contents, tombstones, character tombstones and the scans that outrank them, distinct location text for same-named containers, each container's `capacity` from its Contents line (`capacityOf`: a weight cap, no weight, separators, markup, singular words; null without a maximum or a line), null for a ground root scanned before root tooltips, and an engraved root named by its engraving), optimizer pool building (other characters' worn gear, with no character every worn piece unless asked for, STR gate, tag filter), requirement reports, the weapon exclusion filter and its migration, the weapon properties filter (`weaponMustHave`), `settingsDiff`, profile templates (`migrateProfiles` old → new shape and idempotence, `templateFrom` leaving race/STR out, drift via `settingsDiff`), saved-run keys and reuse (`runs-lib.mts`), plus the optimizer core through the same loader the server uses: exact search against brute force (a hand-built case and 150 random suits), the other-suits list against every brute-force score (80 random suits), progress reporting, and warm starts, every layer name an adapter's `capabilities.json` declares resolving to a slot, and Razor Enhanced's layer names (`LAYER_ALIASES`) classifying exactly as their TazUO equivalents (issue #219). Fixtures: `app/fixtures/demo-*.json` (synthetic fixtures, see `app/fixtures/README.md`).
//
// Tests that use the fixtures must sit below the `const kestrel = …` / `const dorran = …` lines that load them from app/fixtures/. The [slow] cases here are the 150/80-random-suit brute-force comparisons and the demo-inventory exact and warm-start checks.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import {
  parseTooltip, displayName, gameName, compareNames, classify, foldSnapshots, spellSchoolOf, buildPools, requirementReport, totalsOf, propertyKeys, bagLabel, capacityOf, NOT_BUILDER_KEYS, kindOf, groupByName, slayersOf, medableOf, weaponAllowed, settingsDiff, PROP_LABELS, LAYER_TO_SLOT, LAYER_ALIASES, effectiveProfile, resistMinimum, minResistAt, paperdollResist, skillInSuit, resistStepsFor, liftedMin, RESIST_SKILL_KEY, RESIST_KEYS, toOptItem, labelOf, builderKeys, migrateProfiles, templateFrom, TEMPLATE_KEYS, setRules, getRules, tagUnits, tagInfo,
  WEAPON_SKILLS, WEAPON_EXCLUDES, migrateWeaponSetting, excludeWeaponsError, weaponSkillsOf, weaponHasFlags, weaponMustHaveError, BOOLEAN_FLAGS,
  shardResistCap, resistCapsFor, resistCapsError, profileResistCaps, RESIST_CAP_LIMITS,
} from "./vault-lib.mts";
import type { Item, Inventory, ItemLocation, ProfilesFile, CharacterEntryRaw } from "./vault-lib.mts";
import { specFromProfile, templateSettings, type TemplateMap } from "./build-spec.mts";
import { upgradeScan, TAZUO_V1_CAPS } from "./scan-schema.mts";
import { runKey, reusableRun, runSummary, suitPieces, SOLVER_VERSION } from "./runs-lib.mts";
import type { SavedRun } from "./runs-lib.mts";
import { migrate } from "./migrate.mts";
import { minimumWith } from "./buffs.mts";
// A run as the runs store reads it (app/migrate.mts, the runs steps).
const normalizeRun = (run: SavedRun): SavedRun => migrate("runs", run).doc as SavedRun;
import { corePath } from "./config.mts";
import { validate, type ValidatorSchema } from "./schema/validate.mts";
import type { RulesV1, ScanV2 } from "./schema/types.d.mts";
import type { OptPools, OptAssignment, OptProfile } from "./exact-solver.mts";
import type * as Core from "../scripts/optimizer-core.mts";

const HERE = dirname(fileURLToPath(import.meta.url));
const SKIP_SLOW = process.env.TEST_SKIP_SLOW ? "TEST_SKIP_SLOW" : false;

// Every test in this file runs against the UO Alive shard rules — the same rules file the app ships
// as the default shard (Phase 2, Task 2: shard rules moved out of vault-lib.mts into app/rules/).
setRules(JSON.parse(readFileSync(join(HERE, "rules", "uoalive.json"), "utf8")) as RulesV1);

// foldSnapshots always assigns item.location as its own last step (see vault-lib.mts's own comment
// on the loop at the end of foldSnapshots) — Item's own `location?` is optional only because the
// type also describes a not-yet-located enrich() result mid-fold. Every item this file reads back
// off a foldSnapshots() result is folded, so location is never absent here; this local alias/helper
// is the one place that fact is asserted, instead of a `!` at every one of the handful of call sites
// below that read `.location`.
type LocatedItem = Item & { location: ItemLocation };
const foldedItems = (inv: Inventory): LocatedItem[] => Object.values(inv.items) as LocatedItem[];

// ---- parser -------------------------------------------------------------------------------
test("[smoke] parseTooltip reads modeled props, tags, STR req, rarity, extras and flags", () => {
  const p = parseTooltip(["Arcane Crescent Blade", "Weight: 1 Stone", "Hit Harm 38%", "Hit Poison Area 38%",
    "Hit Mana Leech 40%", "Mana Regeneration 6", "Damage Increase 40%", "Physical Damage 100%", "Weapon Damage 12 - 15",
    "Weapon Speed 2.5s", "Strength Requirement 55", "Two-handed Weapon", "Skill Required: Swordsmanship",
    "Durability 57 / 57", "<BASEFONT COLOR=#A335EE>Lesser Magic Item", "Antique"]);
  assert.equal(p.name, "Arcane Crescent Blade");
  assert.equal(p.props.hitHarm, 38);
  assert.equal(p.props.hitManaLeech, 40);
  assert.equal(p.props.manaRegen, 6);
  assert.equal(p.props.di, 40);
  assert.equal(p.strReq, 55);
  assert.equal(p.twoHanded, true);
  assert.equal(p.skillReq, "swordsmanship");
  assert.deepEqual(p.extras.durability, [57, 57]);
  assert.deepEqual(p.extras["weapon damage"], [12, 15]);
  assert.equal(p.extras["weapon speed"], 2.5);
  assert.equal(p.rarity, "Lesser Magic Item");
  assert.deepEqual(p.tags, ["antique"]);
  assert.equal(p.props.tagPenalty, 1.5);
});

test("[smoke] FCR is not double-counted as FC, SDI is not DI", () => {
  const p = parseTooltip(["Ring", "Faster Cast Recovery 3", "Faster Casting 1", "Spell Damage Increase 12%", "Damage Increase 5%"]);
  assert.deepEqual(p.props, { fcr: 3, fc: 1, sdi: 12, di: 5 });
});

// A minus sign counts only when it sits immediately before the digits ("-1", not "- 1") — a stray
// "\D*" used to swallow the sign and read "Faster Casting -1" as +1 (the only negative standard
// property found across the owner's 24 real scans, 212 lines).
test("[smoke] a negative property value (Faster Casting -1) is read as negative, not positive", () => {
  const neg = parseTooltip(["Ring", "Faster Casting -1"]);
  assert.equal(neg.props.fc, -1);
  const pos = parseTooltip(["Ring", "Faster Casting 1"]);
  assert.equal(pos.props.fc, 1);
  // FCR still wins its own key and is not folded into fc alongside a negative fc
  const both = parseTooltip(["Ring", "Faster Cast Recovery 3", "Faster Casting -1"]);
  assert.deepEqual(both.props, { fcr: 3, fc: -1 });
});

test("[fast] a percent property is unaffected by the negative-value fix", () => {
  const p = parseTooltip(["Ring", "Lower Mana Cost 8%"]);
  assert.equal(p.props.lmc, 8);
});

test("[fast] a Crafted By or Engraved line with a number in it is a flag, not a numeric extra", () => {
  const p = parseTooltip(["Bag", "Crafted By Dorran 2", "Engraved: Bag 2"]);
  assert.deepEqual(p.extras, {});
  assert.deepEqual(p.flags, ["crafted by dorran 2", "engraved: bag 2"]);
});

test("[fast] Mage Weapon -N Skill is a numeric property, not a flag", () => {
  const p = parseTooltip(["Katana", "Mage Weapon -20 Skill"]);
  assert.equal(p.props.mageWeapon, -20);
  assert.deepEqual(p.flags, []);
});

test("[fast] a weapon damage range is unaffected by the negative-value fix — the low end is not misread as negative", () => {
  const p = parseTooltip(["Sword", "Weapon Damage 13 - 16"]);
  assert.deepEqual(p.extras["weapon damage"], [13, 16]);
});

test("[fast] a dash separated from its number by a space is not read as negative", () => {
  const p = parseTooltip(["Trinket", "Spectral Resonance - 1"]);
  assert.equal(Object.values(p.props).some((v) => v < 0), false, "no modeled property reads negative");
  assert.equal(Object.values(p.extras).flat().some((v) => v < 0), false, "no extra reads negative");
  // the general extras line still captures the number itself, positively — only the sign-adjacency rule is under test
  const key = Object.keys(p.extras).find((k) => k.trim() === "spectral resonance");
  assert.equal(p.extras[key as string], 1);
});

test("[fast] end to end: an item whose tooltip reads Faster Casting -1 contributes -1 to totalsOf for a suit containing it", () => {
  const parsed = parseTooltip(["Cursed Ring", "Faster Casting -1"]);
  // Partial fixture: toOptItem only reads .props/.extras/.twoHanded off an Item (see its own body) —
  // not a full enriched Item (no amount/tags/kind/location/...). Cast once here, at the test's own
  // fixture boundary, per the migration plan's "a test deliberately passing malformed input gets a
  // cast at that call site" rule — same idiom as item-query.test.mts's mk().
  const it = toOptItem({ serial: 1, name: parsed.name, slot: "ring", props: parsed.props, extras: parsed.extras } as unknown as Item);
  const totals = totalsOf({ ring: it });
  assert.equal(totals.fc, -1);
});

test("[fast] skill bonuses and slayers land in extras/flags for searching", () => {
  const p = parseTooltip(["Bracelet of Sorcery", "Chivalry +10", "Healing +20", "Orc Slayer", "Night Sight"]);
  assert.equal(p.extras.chivalry, 10);
  assert.equal(p.extras.healing, 20);
  assert.ok(p.flags.includes("orc slayer"));
  assert.ok(p.flags.includes("night sight"));
});

// Organize's power scroll presets (issue #11) file scrolls by level: UO Alive names it, "(110 Skill)".
test("[smoke] parseTooltip reads a power scroll's level from its name as psLevel", () => {
  assert.equal(parseTooltip(["An Exalted Scroll Of Mysticism (110 Skill)"]).props.psLevel, 110);
  assert.equal(parseTooltip(["2 A Wondrous Scroll Of Magery (105 Skill)"], 2).props.psLevel, 105, "a stack's amount is not the level");
  assert.equal(parseTooltip(["a legendary scroll of imbuing (120 skill)"]).props.psLevel, 120);
  assert.equal(parseTooltip(["Scroll Of Transcendence", "Spirit Speak 0.5 Skill"]).props.psLevel, undefined);
  assert.equal(parseTooltip(["Ring Of The Magi (110 Skill)"]).props.psLevel, undefined, "only a scroll, so nothing else gains a property and with it a claim to be gear");
  assert.equal(parseTooltip(["A Scroll Of Something (95 Skill)"]).props.psLevel, undefined, "a level has three digits");
});

// ServUO prints a set piece's full-set bonus after a header line; those lines only apply while all
// the pieces are worn, so they are kept apart from the piece's own props. Tooltip copied verbatim
// from the TazUO fixture.
test("[smoke] parseTooltip keeps an armour set's full-set bonus out of the piece's own props", () => {
  const p = parseTooltip(["Armor Of Initiation", "Blessed", "Weight: 1 Stone", "Part Of An Armor Set (6 Pieces)", "Brittle",
    "Physical Resist 7%", "Fire Resist 4%", "Cold Resist 4%", "Poison Resist 6%", "Energy Resist 4%", "Strength Requirement 20",
    "Durability 123 / 150", "<br>Only When Full Set Is Present:", "Physical Resist +2%", "Fire Resist +5%", "Cold Resist +5%",
    "Poison Resist +3%", "Energy Resist +5%"]);
  assert.deepEqual(p.props, { physResist: 7, fireResist: 4, coldResist: 4, poisonResist: 6, energyResist: 4, tagPenalty: 4 });
  assert.deepEqual(p.setBonus, { physResist: 2, fireResist: 5, coldResist: 5, poisonResist: 3, energyResist: 5 });
  assert.equal(p.strReq, 20);
  assert.deepEqual(p.extras.durability, [123, 150]);
});

// A WORN full set prints its header near the top (ServUO BaseArmor.AddNameProperties: right after
// "Part Of An Armor Set"), then the set's "(total)" lines (SetHelper.GetSetProperties and
// BaseArmor.GetSetProperties while SetEquipped), and only then the piece's own lines. The totals sum
// every piece of the set, so they are neither the piece's own props nor a per-piece bonus.
test("[smoke] parseTooltip: a worn full set's header sits at the top and only its (total) lines are set lines", () => {
  for (const header of ["Full Armor Set Present", "Full Weapon/Armor Set Present"]) {
    const p = parseTooltip(["Armor Of Initiation", "Blessed", "Weight: 1 Stone", "Part Of An Armor Set (6 Pieces)", header,
      "Physical Resist 44% (total)", "Fire Resist 29% (total)", "Hit Point Regeneration 3 (total)", "Brittle",
      "Physical Resist 7%", "Fire Resist 4%", "Cold Resist 4%", "Poison Resist 6%", "Energy Resist 4%", "Strength Requirement 20", "Durability 123 / 150"]);
    assert.deepEqual(p.props, { physResist: 7, fireResist: 4, coldResist: 4, poisonResist: 6, energyResist: 4, tagPenalty: 4 }, header);
    assert.deepEqual(p.setBonus, {}, "set totals are not a per-piece bonus");
    assert.equal(p.strReq, 20);
    assert.deepEqual(p.extras.durability, [123, 150]);
    assert.ok(p.flags.includes("set: physical resist 44% (total)"));
  }
});

test("[fast] parseTooltip: after the incomplete-set header, non-property set lines are flagged as set lines", () => {
  const p = parseTooltip(["Leggings Of Bane", "Poison Resist 8%", "<br>Only When Full Set Is Present:", "Hit Point Increase 10", "Night Sight"]);
  assert.deepEqual(p.props, { poisonResist: 8 });
  assert.deepEqual(p.setBonus, { hpi: 10 });
  assert.ok(p.flags.includes("set: night sight"));
  assert.ok(!p.flags.includes("night sight"), "a set-only effect is not the piece's own");
  assert.deepEqual(parseTooltip(["Ring", "Luck 40"]).setBonus, {}, "a piece with no set block has an empty setBonus");
});

// ---- classifier ---------------------------------------------------------------------------
test("[smoke] classify: names map to optimizer slots, containers/consumables are not gear", () => {
  assert.equal(classify("Leather Gorget").slot, "neck");
  assert.equal(classify("Woodland Chest").slot, "chest");
  assert.equal(classify("Arcane Leaf Tonlet Of Restoration").slot, "legs");
  assert.equal(classify("Plate Hiro Sode").slot, "arms");
  assert.equal(classify("Ninja Tabi").slot, "feet");
  assert.equal(classify("Metal Kite Shield").slot, "twoHanded");
  assert.equal(classify("Metal Kite Shield").twoHanded, false);
  assert.equal(classify("Composite Bow").twoHanded, true);
  assert.equal(classify("Arcane Crescent Blade", parseTooltip(["Arcane Crescent Blade", "Two-handed Weapon"])).slot, "twoHanded");
  assert.equal(classify("Katana", parseTooltip(["Katana", "One-handed Weapon"])).slot, "oneHanded");
  assert.equal(classify("Bandage").gear, false);
  assert.equal(classify("Bag of Sending").gear, false);
  assert.equal(classify("Greater Heal Potion").gear, false);
  assert.equal(classify("Blade Spirits").gear, false);
  assert.deepEqual(classify("2 Blade Spirits", null, null, 0x1F4D), { slot: null, twoHanded: false, gear: false }, "a stack of spell scrolls, named with its count, is no weapon");
  assert.equal(classify("Mystic Ring").slot, "ring");
  assert.equal(classify("Mystic Heater Shield").slot, "twoHanded");
  assert.equal(classify("Book Of Chivalry").slot, "oneHanded");
});

// Issue #123: a mastery primer is a consumable book, whatever its graphic's layer or its name's words say, so the
// Suit Builder never sees one.
test("[fast] classify: a Primer On … Mastery is a book, never gear", () => {
  for (const [name, lines] of [["Primer On Mace Fighting Mastery", []], ["Primer On Archery Mastery", ["Blessed", "Luck 10"]]] as const) {
    assert.deepEqual(classify(name, parseTooltip([name, ...lines]), null, 3834), { slot: null, twoHanded: false, gear: false }, name);   // 3834: a one-handed graphic
    assert.equal(kindOf(name, parseTooltip([name, ...lines])), "book", name);
  }
});

test("[fast] classify: equipped layer wins over the name", () => {
  assert.equal(classify("Weird Thing", null, "Torso").slot, "chest");
  assert.equal(classify("Chainmail Leggings", null, "Pants").slot, "legs");
});

test("[smoke] classify: every \"... Arms\" name is an arms piece, never chest and never unslotted", () => {
  for (const n of ["Platemail Arms", "Ringmail Arms", "Leaf Arms", "Leaf Arms Of Haste", "Bone Arms Of Haste", "Gargish Platemail Arms", "Gargish Stone Arms Of Alchemy"]) {
    assert.deepEqual(classify(n), { slot: "arms", twoHanded: false, gear: true }, n);
  }
});

test("[fast] classify: names the base-name rules used to miss", () => {
  const want: Array<[string, string]> = [["Leather Skirt", "legs"], ["Fortified Leather Skirt", "legs"], ["Long Pants", "legs"], ["Elven Pants", "legs"],
    ["Hakama", "outerLegs"], ["Tattsuke Hakama", "legs"], ["Kasa", "helmet"], ["Cloth Ninja Hood", "helmet"], ["Fur Cape", "cloak"], ["Mantle", "cloak"],
    ["Quiver Of Infinity", "cloak"], ["Gold Ring", "ring"], ["Gold Bracelet", "bracelet"]];
  for (const [n, slot] of want) assert.equal(classify(n).slot, slot, n);
  assert.equal(classify("Gold Coin").gear, false, "gold coins are still not gear");
  assert.equal(classify("Bolt Of Cloth").gear, false, "cloth is still a resource");
});

// Middle-torso clothing (Tunic layer: doublet, cloth tunic, surcoat, body sash) is worn OVER chest
// armour, so it gets its own slot instead of competing with the Torso layer's chest piece.
test("[fast] classify: a middle-torso piece has its own slot, not chest", () => {
  assert.equal(classify("Doublet", null, "Tunic").slot, "tunic");
  assert.equal(classify("Doublet").slot, "tunic");
  assert.equal(classify("Surcoat").slot, "tunic");
  assert.equal(classify("Heart Of The Lion", null, "Torso").slot, "chest");
  assert.equal(classify("Studded Tunic").slot, "chest", "armour named Tunic is still chest by name");
});

// Issue #202, the golden table: every case the layer research (ServUO's item classes against the client's tiledata)
// found, by graphic and by name alone. The graphic decides wherever the table knows it; the name rules are the fallback
// for a graphic it does not, and must agree with it on these names, never invent a slot (bare beads are not worn).
const GOLDEN_SLOTS: Array<[string, number, string | null]> = [
  // shirts under chest armor; the middle torso over it
  ["Shirt", 0x1517, "shirt"], ["Fancy Shirt", 0x1efd, "shirt"], ["Elven Shirt", 0x2fbd, "shirt"],
  ["Formal Shirt", 0x230f, "tunic"], ["Tunic", 0x1fa1, "tunic"], ["Full Apron", 0x153d, "tunic"], ["Body Sash", 0x1541, "tunic"],
  ["Gargish Sash", 0x46b4, "tunic"], ["Jin-Baori", 0x27a1, "tunic"], ["Jester Suit", 0x1f9f, "tunic"],
  ["Leather Tunic", 0x13ca, "chest"], ["Studded Tunic", 0x13d9, "chest"], ["Ringmail Tunic", 0x13ec, "chest"], ["Chainmail Tunic", 0x13bd, "chest"],
  // legs (the Pants layer) and what goes over them
  ["Platemail Legs", 0x1411, "legs"], ["Leather Skirt", 0x1c08, "legs"], ["Leather Shorts", 0x1c00, "legs"], ["Tiger Pelt Long Skirt", 0x7826, "legs"],
  ["Tattsuke-Hakama", 0x279b, "legs"], ["Leaf Tonlet", 0x2fca, "legs"],
  ["Kilt", 0x1537, "outerLegs"], ["Skirt", 0x1516, "outerLegs"], ["Hakama", 0x279a, "outerLegs"],
  ["Hakama-Shita", 0x279c, "robe"], ["Kimono", 0x2681, "robe"], ["Plain Dress", 0x1f01, "robe"], ["Fancy Dress", 0x1eff, "robe"], ["Gilded Dress", 0x230d, "robe"],
  // gargish pieces on another piece's layer
  ["Gargish Platemail Kilt", 0x30b, "hands"], ["Gargish Stone Kilt Of Vitality", 0x287, "hands"],
  ["Gargish Leather Wing Armor", 0x457e, "cloak"], ["Gargish Cloth Wing Armor", 0x45a4, "cloak"],
  ["Gargish Glasses", 0x4644, "earrings"], ["Elven Glasses", 0x2fb8, "helmet"],
  ["Plate Talons", 0x42de, "feet"], ["Leather Talons", 0x41d8, "feet"], ["Waraji", 0x2653, "feet"],
  ["Dragon Turtle Hide Bracers", 0x782e, "arms"], ["Elven Quiver", 0x2fb7, "cloak"],
  // names that had no slot
  ["Tiger Pelt Collar", 0x7829, "neck"], ["Leather Ninja Mitts", 0x2792, "hands"], ["Flower Garland", 0x2305, "helmet"],
  ["Half Apron", 0x153b, "waist"], ["Gold Beads", 0x1089, "neck"], ["Silver Beads", 0x1f05, "neck"],
  // the rest of the layer table's surprises: cloth chest pieces, gargish legs and earrings, a spellbook, a shield
  ["Cloth Ninja Jacket", 0x2794, "chest"], ["Gargish Cloth Chest", 0x405, "chest"], ["Gargish Platemail Legs", 0x30e, "legs"],
  ["Gargish Earrings", 0x4213, "earrings"], ["Spellbook", 0xefa, "oneHanded"], ["Heater Shield", 0x1b76, "twoHanded"],
];
test("[fast] classify: the golden table, by graphic and by name alone", () => {
  for (const [name, graphic, slot] of GOLDEN_SLOTS) {
    assert.equal(classify(name, null, null, graphic).slot, slot, `${name} by graphic 0x${graphic.toString(16)}`);
    assert.equal(classify(name).slot, slot, `${name} by name`);
  }
  // names with no graphic in the client's table here: the name alone
  const byName: Array<[string, string | null]> = [["Gargish Leather Legs", "legs"], ["Gargish Cloth Legs", "legs"], ["Gargish Cloth Kilt", "hands"],
    ["Fur Sarong", "outerLegs"], ["Fancy Kilt", "outerLegs"], ["Evening Gown", "robe"], ["Kamishimo", "robe"], ["Epaulette", "robe"],
    ["Assassin's Cowl", "helmet"], ["Chef's Toque", "helmet"], ["Elegant Collar", "neck"], ["Gargish Stone Amulet", "neck"],
    ["Leather Tunic Of Defense", "chest"], ["Elven Plate Belt", "waist"], ["Sorcerer's Skirt", "legs"], ["Malabelle's Dress", "outerLegs"],
    ["Kobakama", "legs"], ["Tabard", "robe"], ["Beads", null]];
  for (const [name, slot] of byName) assert.equal(classify(name).slot, slot, name);
  // Issue #259: the named spellbooks a spellbook exclusion must also catch
  for (const name of ["Scrapper's Compendium", "Juo'nar's Grimoire"]) assert.deepEqual([classify(name).slot, classify(name).gear], ["oneHanded", true], name);
  assert.equal(classify("Beads").gear, false, "beads are not worn");
  // a light is a tool in the pack (never a suit candidate) and fills the two-handed slot only while held
  assert.equal(classify("Lantern", null, null, 0xa25).gear, false);
  assert.equal(classify("Lantern", null, "TwoHanded").slot, "twoHanded");
});

// The client's own tiledata says which layer every wearable graphic goes on; the graphic decides
// wherever it is known, so a named artifact or a set piece whose name says nothing (or the wrong
// thing: every Armor Of Initiation piece is called "Armor") lands in its real slot.
test("[smoke] classify: a known graphic decides the slot where the name is not enough", () => {
  assert.equal(classify("Heart Of The Lion", null, null, 5141).slot, "chest");   // platemail
  assert.equal(classify("Armor Of Initiation", null, null, 5063).slot, "neck");   // leather gorget
  assert.equal(classify("Armor Of Initiation", null, null, 5067).slot, "legs");   // leather leggings
  assert.equal(classify("Armor Of Initiation", null, null, 5062).slot, "hands");   // leather gloves
  assert.equal(classify("Armor Of Initiation", null, null, 7609).slot, "helmet");   // leather cap
  assert.equal(classify("Armor Of Initiation", null, null, 5069).slot, "arms");   // leather sleeves
  assert.equal(classify("Cloth Ninja Hood", null, null, 10127).slot, "helmet");
  assert.equal(classify("Doublet", null, null, 8059).slot, "tunic");
  assert.equal(classify("Some Artifact Quiver", null, null, 12215).slot, "cloak");
  assert.equal(classify("Ring Of The Artificer", null, null, 7945).slot, "ring");
  // held graphics: the tooltip's weapon lines and the name still decide one hand or two (tiledata
  // files bows under the one-handed layer, which the server does not follow)
  assert.equal(classify("Bow", parseTooltip(["Bow", "Two-handed Weapon"]), null, 5042).slot, "twoHanded");
  assert.equal(classify("Bow", null, null, 5042).slot, "twoHanded");
  assert.deepEqual(classify("Towering Order Shield", null, null, 7108), { slot: "twoHanded", twoHanded: false, gear: true });
  assert.deepEqual(classify("Aegis Of Grace", parseTooltip(["Aegis Of Grace", "Physical Resist 15%"]), null, 7108), { slot: "twoHanded", twoHanded: false, gear: true }, "an artifact shield with no shield word in its name");
  // a held graphic that is a tool, not a weapon: no weapon lines, so never a weapon-slot candidate
  assert.equal(classify("Fishing Pole", parseTooltip(["Fishing Pole", "Weight: 8 Stones"]), null, 3520).gear, false);
  assert.equal(classify("Lucky Fishing Pole", parseTooltip(["Lucky Fishing Pole", "Luck 100"]), null, 3520).slot, null);
  assert.equal(classify("Candle", parseTooltip(["Candle"]), null, 2575).gear, false);
  // an unknown or non-wearable graphic falls back to the name rules
  assert.equal(classify("Leather Gorget", null, null, 1).slot, "neck");
  assert.equal(classify("Bandage", null, null, 3617).gear, false);
});

test("[fast] slayersOf reads slayer lines and the classic names", () => {
  assert.deepEqual(slayersOf(["orc slayer", "night sight"]), ["Orc"]);
  assert.deepEqual(slayersOf(["silver"]), ["Undead (Silver)"]);
  assert.deepEqual(slayersOf(["earth elemental slayer", "repond"]), ["Earth Elemental", "Repond (humanoids)"]);
  assert.deepEqual(slayersOf(["mage armor"]), []);
});

test("[smoke] medableOf: materials, Mage Armor and Spell Channeling decide meditation safety", () => {
  assert.equal(medableOf("Fortified Bone Armor Of Wizardry", "chest", true, []), false);
  assert.equal(medableOf("Fortified Bone Armor Of Wizardry", "chest", true, ["mage armor"]), true);
  assert.equal(medableOf("Leather Gorget", "neck", true, []), true);
  assert.equal(medableOf("Platemail Gorget", "neck", true, []), false);
  assert.equal(medableOf("Bone Mempo", "neck", true, []), false);
  // jewelry in the neck slot never blocks meditation, whatever metal it is made of
  assert.equal(medableOf("Gold Necklace", "neck", true, []), true);
  assert.equal(medableOf("Gold Beads", "neck", true, []), true);
  // a neck piece named Armor is armor (isNeckArmor), so its material counts
  assert.equal(medableOf("Platemail Armor Of Initiation", "neck", true, []), false);
  assert.equal(medableOf("Leaf Tonlet", "legs", true, []), true);
  assert.equal(medableOf("Woodland Chest", "chest", true, []), false);
  assert.equal(medableOf("Studded Tunic", "chest", true, []), false);
  assert.equal(medableOf("Norse Helm", "helmet", true, []), false);
  assert.equal(medableOf("Close Helmet Of Restoration", "helmet", true, []), false);
  assert.equal(medableOf("Bascinet", "helmet", true, []), false);
  assert.equal(medableOf("Leather Jingasa", "helmet", true, []), true);
  assert.equal(medableOf("Skullcap", "helmet", true, []), true);
  assert.equal(medableOf("Orcish Kin Mask", "helmet", true, []), true);
  assert.equal(medableOf("Chainmail Coif", "helmet", true, []), false);
  assert.equal(medableOf("Metal Kite Shield", "twoHanded", true, []), false);
  assert.equal(medableOf("Metal Kite Shield", "twoHanded", true, ["spell channeling"]), true);
  assert.equal(medableOf("Book Of Chivalry", "oneHanded", true, []), true);
  assert.equal(medableOf("Arcane Ring", "ring", true, []), true);
  assert.equal(medableOf("Black Pearl", null, false, []), true);
});

test("[smoke] kindOf: non-gear names get a kind, unknown names with props are gear", () => {
  assert.equal(kindOf("Black Pearl"), "reagent");
  assert.equal(kindOf("Spiders' Silk"), "reagent");
  assert.equal(kindOf("Batwing"), "reagent");
  assert.equal(kindOf("Greater Heal Potion"), "potion");
  assert.equal(kindOf("Bandage"), "bandage");
  assert.equal(kindOf("Gold Coin"), "currency");
  assert.equal(kindOf("Iron Ingot"), "resource");
  assert.equal(kindOf("Scroll Of Transcendence"), "scroll");
  assert.equal(kindOf("Treasure Map"), "map");
  assert.equal(kindOf("Recall Rune"), "rune");
  assert.equal(kindOf("Bag Of Sending"), "container");
  assert.equal(kindOf("Diamond"), "gem");
  assert.equal(kindOf("Weird Trinket", parseTooltip(["Weird Trinket", "Luck 100"])), "gear");
  assert.equal(kindOf("Weird Trinket"), "other");
  assert.equal(kindOf("Greater Heal"), "scroll");
  assert.equal(kindOf("Vengeful Spirit"), "scroll");
  assert.equal(kindOf("Varnish Of Fortification"), "refinement");
  assert.deepEqual(["Lap Harp", "Bamboo Flute", "Drum", "Fire Horn", "Harpy Wing", "Hard Rum"].map((n) => kindOf(n)), ["tool", "tool", "tool", "tool", "other", "other"]);   // issue #129
  assert.equal(parseTooltip(["2 Greater Heal"], 2).name, "Greater Heal");
  assert.equal(parseTooltip(["10 Potions"], 1).name, "10 Potions");   // a name that starts with a number keeps it
  // Issue #129: a cliloc number the client left unresolved in a name line is dropped, not taken for a stack's amount.
  assert.equal(parseTooltip(["21025908 Of Wizardry", "Mana Increase 9"], 1).name, "Of Wizardry");
  assert.equal(parseTooltip(["Feathered Hat 1025908 Of Wizardry"], 1).name, "Feathered Hat Of Wizardry");
  assert.equal(parseTooltip(["60000 Gold"], 60000).name, "Gold");
  assert.equal(classify("Elven Glasses Of Restoration").slot, "helmet");
});

test("[fast] kindOf: decor, quest and event items and crafting tools have kinds of their own, and a live house's misses are fixed (issue #150)", () => {
  const kinds = (names: string[]): string[] => names.map((n) => kindOf(n));
  assert.deepEqual(kinds(["Ethereal Horse Statuette", "Painting Of A Ship", "Hunting Trophy", "Red Rug", "Potted Plant", "Crystal Vase", "Glass Vase", "Banner", "Tapestry", "Lamp Post", "Jack O' Lantern", "Candelabra", "Candle", "Figurine", "Decorative Armor Stand", "Snow Globe"]),
    Array(16).fill("decor"));
  assert.deepEqual(kinds(["Mysterious Fragment", "Quest Item", "Halloween Candy", "Easter Egg", "Christmas Stocking", "Valentine's Card", "Anniversary Keepsake"]), Array(7).fill("quest"));
  assert.deepEqual(kinds(["Smith's Hammer", "Tongs", "Sewing Kit", "Tinker's Tools", "Tool Kit", "Mortar And Pestle", "Fletcher's Tools", "Saw", "Dovetail Saw", "Jointing Plane", "Moulding Planes", "Draw Knife", "Froe", "Inshave", "Scorp", "Hammer", "Mapmaker's Pen", "Scribe's Pen", "Rolling Pin", "Flour Sifter", "Skillet", "Loom", "Spinning Wheel", "Runic Hammer", "Runic Sewing Kit"]),
    Array(25).fill("crafting"));
  // The gathering and utility tools, and the instruments, stay tools.
  assert.deepEqual(kinds(["Pickaxe", "Shovel", "Lockpick", "Fishing Pole", "Skinning Knife", "Scissors", "Lap Harp"]), Array(7).fill("tool"));
  // The live house's misses; an Ancient Weapon names nothing a kind is told by.
  assert.deepEqual(kinds(["Springs", "Clock Frame", "A Charter Guide", "Ancient Weapon"]), ["resource", "resource", "book", "other"]);
  // What shares a word with the new kinds keeps its kind: deeds, event tokens, event bags, lamp oil, a Relic Fragment, food.
  assert.deepEqual(kinds(["Trick Or Treat Bag", "Holiday Gift Box", "Holiday Ornament Box", "Christmas Candle Box", "Decorative Chest", "Trophy Chest", "Lamp Oil"]),
    [...Array(6).fill("container"), "other"]);
  assert.deepEqual(kinds(["Holiday Tree Deed", "Rug Deed", "Halloween Token", "Relic Fragment", "Apple", "Cooked Bird", "Iron Ingot", "Board", "Recall Rune", "Bag Of Sending", "Bandage"]),
    ["deed", "deed", "currency", "resource", "food", "food", "resource", "resource", "rune", "container", "bandage"]);
});

test("[fast] a spell's name is a scroll only on a scroll graphic or none, and its school is the exact name on that school's graphic (issue #134)", () => {
  assert.equal(kindOf("Healing Stone", null, 0x4078), "tool");   // Mysticism's conjured stone (issue #150)
  assert.equal(kindOf("Healing Stone", null, 0x2D9F), "scroll");
  assert.deepEqual([["Curse", 0x1F46], ["Curse Weapon", 0x2263], ["Healing Stone", 0x2D9F], ["Word Of Death", 0x2D5B], ["curse weapon", null]].map(([n, g]) => spellSchoolOf(n as string, g as number | null)),
    ["magery", "necromancy", "mysticism", "spellweaving", "necromancy"]);
  assert.equal(spellSchoolOf("Curse", 0x2263), null);   // Magery's name on a Necromancy graphic
  assert.equal(spellSchoolOf("Remove Curse", null), null);   // Chivalry has no scrolls, so no school
  assert.equal(spellSchoolOf("Healing Stone", 0x4078), null);
});

test("[fast] kindOf: a message in a bottle and an SOS are maps, and a blank scroll is a resource (issue #134)", () => {
  assert.deepEqual(["A Message In A Bottle", "A SOS", "A Waterstained SOS", "Empty Bottle"].map((n) => kindOf(n)), ["map", "map", "map", "resource"]);
  assert.deepEqual(["Blank Scroll", "5 Blank Scrolls"].map((n) => kindOf(n)), ["resource", "resource"]);
});

// ---- fold ---------------------------------------------------------------------------------
// The fixtures on disk are v1 (the shape the TazUO adapters actually write); foldSnapshots requires
// v2, so every fixture and every inline snapshot literal in this file is upgraded before folding.
// kestrelV1/dorranV1 are kept around for the tests below that need to build their OWN v1-shaped
// literal (e.g. to exercise a specific upgrade behaviour) rather than the already-upgraded fixture.
const kestrelV1: unknown = JSON.parse(readFileSync(join(HERE, "fixtures", "demo-Kestrel.json"), "utf8"));
const dorranV1: unknown = JSON.parse(readFileSync(join(HERE, "fixtures", "demo-Dorran.json"), "utf8"));
const kestrel = upgradeScan(kestrelV1, { shard: "test" }) as ScanV2;   // known-good fixture: the cast stands in for the validateScan() a real caller runs
const dorran = upgradeScan(dorranV1, { shard: "test" }) as ScanV2;   // known-good fixture: the cast stands in for the validateScan() a real caller runs

test("[fast] fold: every item gets a kind; groupByName totals stacks", () => {
  const inv = foldSnapshots([kestrel, dorran]);
  assert.ok(Object.values(inv.items).every((i) => i.kind));
  // groupByName only reads name/kind/amount/location off each item (see its own body) — a partial
  // fixture cast at the call site, same idiom as toOptItem's above.
  const g = groupByName([{ name: "Iron Ingot", kind: "resource", amount: 100, location: { text: "A" } }, { name: "Iron Ingot", kind: "resource", amount: 50, location: { text: "B" } }] as unknown as Item[]);
  assert.equal(g.length, 1); assert.equal(g[0]!.amount, 150); assert.equal(g[0]!.stacks, 2); assert.equal(g[0]!.locations.get("B"), 50);
});

test("[fast] fold: a root container is a place, not an item; items inside it get a location", () => {
  const inv = foldSnapshots([kestrel]);
  assert.ok(!inv.items[kestrel.roots[0]!.serial], "the chest itself is a place, not an item");
  const inChest = foldedItems(inv).filter((i) => i.location.kind === "ground");
  assert.ok(inChest.length > 0);
  assert.ok(inChest.every((i) => i.location.text === "Metal Chest"));
});

test("[smoke] fold: worn gear is located on its wearer, pack items in the pack", () => {
  const inv = foldSnapshots([dorran, kestrel]);
  assert.equal(Object.keys(inv.characters).length, 2);
  const worn = foldedItems(inv).filter((i) => i.equippedBy === "Dorran");
  assert.ok(worn.length >= 6, `Dorran wears ${worn.length}`);
  for (const i of worn) assert.equal(i.location.text, "Worn by Dorran");
  const dorranScan = inv.scans.find((s) => s.character === "Dorran");
  assert.ok(dorranScan);
  const dorranRoots = new Set(dorranScan.roots);
  const packed = foldedItems(inv).filter((i) => !i.equippedBy && dorranRoots.has(i.root as number));
  assert.ok(packed.length > 0, "Dorran has packed items");
  for (const i of packed) assert.equal(i.location.character, "Dorran");
});

test("[smoke] pools: another character's worn gear is skipped unless allowOthersWorn", () => {
  const inv = foldSnapshots([dorran, kestrel]);
  const dorranWorn = Object.values(inv.items).filter((i) => i.equippedBy === "Dorran" && i.gear);
  const { skipped } = buildPools(inv, "Kestrel", { strength: 30 });
  for (const it of dorranWorn) assert.ok(skipped.worn.some((s) => s.serial === it.serial), `${it.name} skipped`);
  const all = buildPools(inv, "Kestrel", { allowOthersWorn: true });
  const inAll = new Set(Object.values(all.pools).flat().map((i) => i!.serial));
  assert.ok(dorranWorn.some((it) => inAll.has(it.serial)), "at least one of Dorran's pieces enters Kestrel's pools");
});

test("[fast] pools with no character (the builder's No character, issue #12): every worn piece is skipped, and kept with allowOthersWorn", () => {
  const inv = foldSnapshots([dorran, kestrel]);
  const worn = Object.values(inv.items).filter((i) => i.equippedBy && i.gear && i.slot);
  assert.ok(worn.length > 0);
  const none = buildPools(inv, null);
  const inNone = new Set(Object.values(none.pools).flat().map((i) => i!.serial));
  assert.deepEqual(none.current, {});
  for (const it of worn) assert.ok(!inNone.has(it.serial) && none.skipped.worn.some((s) => s.serial === it.serial), `${it.name} skipped`);
  const all = buildPools(inv, null, { allowOthersWorn: true });
  const inAll = new Set(Object.values(all.pools).flat().map((i) => i!.serial));
  assert.ok(worn.some((it) => inAll.has(it.serial)), "worn pieces enter the pools");
});

test("[smoke] fold: a later scan of the same root replaces its contents, order-independent", () => {
  const later = JSON.parse(JSON.stringify(kestrel)) as ScanV2;
  later.scannedAt = "2026-09-11T10:00:00+00:00";
  later.items = later.items.slice(0, Math.floor(later.items.length / 2));   // half the chest emptied
  const a = foldSnapshots([kestrel, later]), b = foldSnapshots([later, kestrel]);
  assert.equal(Object.keys(a.items).length, Object.keys(b.items).length);
  assert.equal(Object.keys(a.items).length, later.items.length + kestrel.equipped.length);
});

test("[fast] fold: scans order by epoch, not string comparison of scannedAt — a 09:30+01:00 scan is later than a 10:00+02:00 one", () => {
  const root = kestrel.roots[0]!.serial;
  const mkScan = (scannedAt: string, itemSerial: number, itemName: string): ScanV2 => ({
    schemaVersion: 2, character: "Kestrel", scannedAt,
    adapter: { id: "tazuo", version: "1", client: "TazUO", clientVersion: null, capabilities: TAZUO_V1_CAPS },
    stats: kestrel.stats, equipped: [],
    roots: [{ serial: root, kind: "ground", name: "Metal Chest", opened: true }],
    containers: { [root]: kestrel.containers[root]! },
    items: [{ serial: itemSerial, name: itemName, tooltip: [itemName], amount: 1, container: root, nameSource: "opl" }],
  });
  const earlierByEpoch = mkScan("2026-09-11T10:00:00+02:00", 101, "Early Item");   // 08:00 UTC
  const laterByEpoch = mkScan("2026-09-11T09:30:00+01:00", 102, "Late Item");      // 08:30 UTC — later, despite the smaller clock time
  const inv = foldSnapshots([earlierByEpoch, laterByEpoch]);
  assert.ok(!inv.items[101], "the earlier-by-epoch scan's item should have been replaced");
  assert.ok(inv.items[102], "the later-by-epoch scan's item should have won the root");
});

// validateScan refuses an impossible scannedAt, but a scan already folded from before that check
// must still not break the sort: a NaN comparator result reads as "equal" and lets an older scan of
// the root fold last.
test("[fast] fold: a scan whose scannedAt is not a real date sorts first instead of scrambling the order", () => {
  const root = kestrel.roots[0]!.serial;
  const mkScan = (character: string, scannedAt: string, itemSerial: number, itemName: string): ScanV2 => ({
    schemaVersion: 2, character, scannedAt,
    adapter: { id: "tazuo", version: "1", client: "TazUO", clientVersion: null, capabilities: TAZUO_V1_CAPS },
    stats: kestrel.stats, equipped: [],
    roots: [{ serial: root, kind: "ground", name: "Metal Chest", opened: true }],
    containers: { [root]: kestrel.containers[root]! },
    items: [{ serial: itemSerial, name: itemName, tooltip: [itemName], amount: 1, container: root, nameSource: "opl" }],
  });
  const inv = foldSnapshots([mkScan("Kestrel", "2026-09-11T12:00:00Z", 201, "New"), mkScan("Dorran", "2026-13-01T10:00:00Z", 202, "Bad"),
    mkScan("Kestrel", "2026-09-11T10:00:00Z", 203, "Old")]);
  assert.ok(inv.items[201], "the newest scan of the root wins");
  assert.ok(!inv.items[203], "the older scan does not fold last");
});

test("[fast] fold: a scan that skipped a container keeps what was known about it", () => {
  const bag = { 10: { serial: 10, root: 10, parent: null, kind: "backpack", name: "Backpack" } };
  const fullRaw = { version: 1, character: "Dorran", scannedAt: "2026-09-11T00:00:00", stats: {}, equipped: [],
    roots: [{ serial: 10, kind: "backpack", name: "Backpack" }, { serial: 20, kind: "bank", name: "Bank box" }],
    containers: { ...bag, 20: { serial: 20, root: 20, parent: null, kind: "bank", name: "Bank box" } },
    items: [{ serial: 1, name: "Ring", tooltip: ["Ring", "Hit Chance Increase 5%"], amount: 1, container: 20 }] };
  const full = upgradeScan(fullRaw, { shard: "test" }) as ScanV2;   // known-good fixture: the cast stands in for the validateScan() a real caller runs
  const later: ScanV2 = { ...full, scannedAt: "2026-09-11T10:00:00+00:00", roots: full.roots.filter((r) => r.kind === "backpack"), items: [] };
  const inv = foldSnapshots([full, later]);
  assert.ok(Object.values(inv.items).some((i) => i.root === 20), "bank contents survived a scan that only listed the backpack");
});

test("[fast] fold: tombstone scans (pseudo character) do not create a character", () => {
  const root = kestrel.roots[0]!.serial;
  const tombRaw = { version: 1, character: "_vault", scannedAt: "2026-09-12T00:00:00", equipped: [], roots: [{ serial: root, kind: "ground", name: "x" }], containers: {}, items: [] };
  const tomb = upgradeScan(tombRaw, { shard: "test" }) as ScanV2;   // known-good fixture: the cast stands in for the validateScan() a real caller runs
  const inv = foldSnapshots([kestrel, tomb]);
  assert.ok(!inv.characters._vault);
  assert.ok(!Object.values(inv.items).some((i) => i.root === root));
  assert.equal(inv.containers[root], undefined);   // the forgotten root itself is gone, not rebuilt from roots
});

test("[fast] fold: a Forget tombstone (v2, stamped toISOString()) one wall-clock second after a v1 scan (upgraded, naive-local stamp) still wins", () => {
  // Regression for the old UTC-vs-local scannedAt mismatch, now solved by ordering on epoch
  // (parseStamp) instead of string comparison: a v1 adapter scan carries a naive local stamp
  // (upgraded to RFC 3339 with this machine's offset), and the server's /api/forget tombstone is
  // now written as v2 with a plain toISOString() UTC stamp — the two must still compare correctly
  // by real elapsed time regardless of the local timezone offset.
  const localStamp = (d: Date): string => {
    const p2 = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
  };
  const root = kestrel.roots[0]!.serial;
  const scanTime = new Date();
  const scanRaw = { ...(kestrelV1 as Record<string, unknown>), scannedAt: localStamp(scanTime) };
  const scan = upgradeScan(scanRaw, { shard: "test" }) as ScanV2;   // known-good fixture: the cast stands in for the validateScan() a real caller runs
  const tombTime = new Date(scanTime.getTime() + 1000);
  const tomb: ScanV2 = {
    schemaVersion: 2, character: "_vault", scannedAt: tombTime.toISOString(),
    adapter: { id: "app", version: "1", client: "TazUO", clientVersion: null, capabilities: TAZUO_V1_CAPS },
    stats: {}, equipped: [], roots: [{ serial: root, kind: "ground", name: "x", opened: true }], containers: {}, items: [],
  };
  const inv = foldSnapshots([scan, tomb]);
  assert.ok(!Object.values(inv.items).some((i) => i.root === root), "the later tombstone dropped the root's contents");
});

// A character tombstone (POST /api/forget-character): nothing else ever removes a deleted or renamed
// character's card, worn set, backpack or bank from the fold.
const V2_APP = { id: "app", version: "1", client: "Pack Rat", clientVersion: null, capabilities: { layers: [], arms: false, bank: false, ground: false, nested: false, tooltips: "label" as const, bridge: [] } };
function twoCharacterScans(): ScanV2[] {
  const mk = (character: string, base: number, scannedAt: string): ScanV2 => upgradeScan({
    version: 1, character, scannedAt, stats: { str: 100 },
    equipped: [{ serial: base + 1, name: "Ring", tooltip: ["Ring", "Hit Chance Increase 5%"], layer: "Ring" }],
    roots: [{ serial: base + 10, kind: "backpack", name: "Backpack" }, { serial: base + 20, kind: "bank", name: "Bank box" }, { serial: base + 30, kind: "ground", name: "Metal Chest" }],
    containers: {
      [base + 10]: { serial: base + 10, root: base + 10, parent: null, kind: "backpack", name: "Backpack" },
      [base + 20]: { serial: base + 20, root: base + 20, parent: null, kind: "bank", name: "Bank box" },
      [base + 30]: { serial: base + 30, root: base + 30, parent: null, kind: "ground", name: "Metal Chest" },
    },
    items: [base + 10, base + 20, base + 30].map((c, i) => ({ serial: base + 100 + i, name: "Bracelet", tooltip: ["Bracelet"], amount: 1, container: c })),
  }, { shard: "test" }) as ScanV2;   // known-good fixture: the cast stands in for the validateScan() a real caller runs
  return [mk("Dorran", 1000, "2026-09-12T10:00:00"), mk("Kestrel", 2000, "2026-09-12T10:00:00")];
}
const forgetCharacterTomb = (character: string, scannedAt: string): ScanV2 => ({
  schemaVersion: 2, character: "_vault", scannedAt, adapter: V2_APP, stats: {}, equipped: [], roots: [], containers: {}, items: [], forgetCharacter: character,
} as ScanV2);

test("[fast] fold: a character tombstone drops the card, worn set, backpack and bank, and keeps the ground containers it scanned", () => {
  const [dorran, kestrelScan] = twoCharacterScans() as [ScanV2, ScanV2];
  const inv = foldSnapshots([dorran, kestrelScan, forgetCharacterTomb("Dorran", "2026-09-13T00:00:00Z")]);
  assert.equal(inv.characters.Dorran, undefined);
  assert.ok(!Object.values(inv.items).some((i) => i.equippedBy === "Dorran"), "the worn set is gone");
  assert.ok(!inv.containers[1010] && !inv.containers[1020], "the backpack and bank are gone");
  assert.ok(!inv.items[1100] && !inv.items[1101], "and what was in them");
  assert.ok(inv.items[1102], "a ground chest belongs to the house, not the character, and stays");
  assert.ok(inv.characters.Kestrel && inv.items[2001] && inv.items[2100], "another character is untouched");
});

test("[fast] fold: a scan newer than the character tombstone brings the character back; an older one does not", () => {
  const [dorran, kestrelScan] = twoCharacterScans() as [ScanV2, ScanV2];
  const tomb = forgetCharacterTomb("Dorran", "2026-09-13T00:00:00Z");
  assert.ok(foldSnapshots([dorran, kestrelScan, tomb, { ...dorran, scannedAt: "2026-09-14T00:00:00Z" }]).characters.Dorran);
  assert.equal(foldSnapshots([tomb, kestrelScan, dorran]).characters.Dorran, undefined, "fold order is by stamp, not by list order");
});

test("[fast] fold: forgetCharacter is only honoured on the app's own _vault tombstone", () => {
  const [dorran, kestrelScan] = twoCharacterScans() as [ScanV2, ScanV2];
  const inv = foldSnapshots([dorran, { ...kestrelScan, scannedAt: "2026-09-13T00:00:00Z", forgetCharacter: "Dorran" } as ScanV2]);
  assert.ok(inv.characters.Dorran, "an adapter scan carrying the field does not forget anyone");
});

// Location text is what the Location filter, group counts and the builder's Fetch list key on: two
// ground chests both called "Metal Chest" (or three "A Bag"s in one backpack) must not read the same.
test("[fast] fold: same-named containers side by side get distinct location text", () => {
  const fixture = JSON.parse(readFileSync(join(HERE, "..", "adapters", "tazuo", "fixture.scan.json"), "utf8")) as ScanV2;
  const inv = foldSnapshots([fixture]);
  const byContainer = new Map<number, string>();
  for (const it of foldedItems(inv)) if (it.container != null && !it.equippedBy) byContainer.set(it.container, it.location.text);
  const texts = [...byContainer.values()];
  assert.equal(new Set(texts).size, texts.length, `every container reads differently: ${JSON.stringify(texts)}`);
  const chests = Object.values(inv.containers).filter((c) => c.parent == null && c.name === "Metal Chest");
  assert.ok(chests.length > 1);
  assert.equal(new Set(chests.map((c) => c.label)).size, chests.length, "each Metal Chest root has its own label");
  for (const c of chests) assert.match(c.label!, /^Metal Chest /);
});

test("[fast] fold: a uniquely named container keeps its plain label; same-named ones get their serial, which does not change as others come and go", () => {
  const scan = upgradeScan({
    version: 1, character: "Dorran", scannedAt: "2026-09-12T10:00:00", stats: {}, equipped: [],
    roots: [{ serial: 1, kind: "ground", name: "Metal Chest" }, { serial: 2, kind: "ground", name: "Metal Chest" }, { serial: 3, kind: "ground", name: "Wooden Box" }],
    containers: {
      1: { serial: 1, root: 1, parent: null, kind: "ground", name: "Metal Chest", pos: { x: 1500, y: 1600, z: 0 } },
      2: { serial: 2, root: 2, parent: null, kind: "ground", name: "Metal Chest", pos: { x: 1502, y: 1600, z: 0 } },
      3: { serial: 3, root: 3, parent: null, kind: "ground", name: "Wooden Box", pos: { x: 1504, y: 1600, z: 0 } },
    },
    items: [1, 2, 3].map((c) => ({ serial: 100 + c, name: "Ring", tooltip: ["Ring"], amount: 1, container: c })),
  }, { shard: "test" }) as ScanV2;   // known-good fixture: the cast stands in for the validateScan() a real caller runs
  const inv = foldSnapshots([scan]);
  assert.equal(inv.items[101]!.location!.text, "Metal Chest (0x1)");
  assert.equal(inv.items[102]!.location!.text, "Metal Chest (0x2)");
  assert.equal(inv.items[103]!.location!.text, "Wooden Box");
  // A third Metal Chest standing on the first one's tile leaves the other two labels as they were.
  const third: ScanV2 = { ...scan, roots: [...scan.roots, { serial: 4, kind: "ground", name: "Metal Chest", opened: true }],
    containers: { ...scan.containers, 4: { serial: 4, root: 4, parent: null, kind: "ground", name: "Metal Chest", pos: { x: 1500, y: 1600, z: 0 } } } };
  const again = foldSnapshots([third]);
  assert.equal(again.items[101]!.location!.text, "Metal Chest (0x1)");
  assert.equal(again.items[102]!.location!.text, "Metal Chest (0x2)");
});

test("[smoke] fold: a quick refresh (backpack as the only root) replaces the worn set, keeps the bank and relocates a taken-off piece", () => {
  const bag = { 10: { serial: 10, root: 10, parent: null, kind: "backpack", name: "Backpack" } };
  const fullRaw = { version: 1, character: "Dorran", scannedAt: "2026-09-12T10:00:00", stats: { str: 100 },
    equipped: [{ serial: 1, name: "Old Gorget", tooltip: ["Old Gorget", "Physical Resist 5%"], amount: 1, layer: "neck" }],
    roots: [{ serial: 10, kind: "backpack", name: "Backpack" }, { serial: 20, kind: "bank", name: "Bank box" }],
    containers: { ...bag, 20: { serial: 20, root: 20, parent: null, kind: "bank", name: "Bank box" } },
    items: [{ serial: 2, name: "Ring", tooltip: ["Ring", "Hit Chance Increase 5%"], amount: 1, container: 10 },
      { serial: 3, name: "Longsword", tooltip: ["Longsword", "Damage Increase 10%"], amount: 1, container: 20 }] };
  const quickRaw = { version: 1, character: "Dorran", scannedAt: "2026-09-12T11:00:00", stats: { str: 105 }, meta: { mode: "quick" },
    equipped: [{ serial: 4, name: "New Gorget", tooltip: ["New Gorget", "Physical Resist 9%"], amount: 1, layer: "neck" }],
    roots: [{ serial: 10, kind: "backpack", name: "Backpack" }], containers: bag,
    items: [{ serial: 1, name: "Old Gorget", tooltip: ["Old Gorget", "Physical Resist 5%"], amount: 1, container: 10 },
      { serial: 2, name: "Ring", tooltip: ["Ring", "Hit Chance Increase 5%"], amount: 1, container: 10 }] };
  const full = upgradeScan(fullRaw, { shard: "test" }) as ScanV2;   // known-good fixture: the cast stands in for the validateScan() a real caller runs
  const quick = upgradeScan(quickRaw, { shard: "test" }) as ScanV2;   // known-good fixture: the cast stands in for the validateScan() a real caller runs
  const inv = foldSnapshots([full, quick]);
  assert.equal(inv.items[1]!.location!.text, "Dorran's backpack");   // the piece just taken off is relocated, not lost
  assert.equal(inv.items[3]!.location!.text, "Dorran's bank");       // an unlisted root keeps its last scan
  assert.ok(inv.containers[20]);
  assert.deepEqual(Object.values(inv.items).filter((it) => it.equippedBy === "Dorran").map((it) => it.serial), [4]);
  assert.equal(inv.characters.Dorran!.stats.str, 105);
  assert.deepEqual(inv.scans[1]!.roots, [10]);
  const bare = foldSnapshots([full, { ...quick, roots: [], containers: {}, items: [] }]);
  assert.equal(bare.items[1], undefined);                        // why the backpack root is mandatory
  // A root listed in roots but missing from containers still keeps the items filed directly in it.
  const noRootEntry = foldSnapshots([{ ...quick, containers: {} }]);
  assert.equal(noRootEntry.items[1]!.location!.text, "Dorran's backpack");
  // ...and one holding only a bag is rebuilt too, so the bag has a location.
  const onlyBag = foldSnapshots([{ ...quick, containers: { 30: { serial: 30, root: 10, parent: 10, kind: "container", name: "Pouch" } }, items: [] }]);
  assert.equal(onlyBag.items[30]!.location!.text, "Dorran's backpack");
});

test("[fast] fold: a root listed with opened:false keeps its previous contents; opened:true empties it", () => {
  // All-explicit-offset v2 literals (no naive-local upgrade) so the epoch ordering is deterministic
  // regardless of the machine's own timezone.
  const root = 900001;
  const mkScan = (scannedAt: string, opened: boolean, items: ScanV2["items"]): ScanV2 => ({
    schemaVersion: 2, character: "Dorran", scannedAt,
    adapter: { id: "tazuo", version: "1", client: "TazUO", clientVersion: null, capabilities: TAZUO_V1_CAPS },
    stats: {}, equipped: [],
    roots: [{ serial: root, kind: "backpack", name: "Backpack", opened }],
    containers: { [root]: { serial: root, root, parent: null, kind: "backpack", name: "Backpack" } },
    items,
  });
  const full = mkScan("2026-09-13T00:00:00+00:00", true, [{ serial: 1, name: "Ring", tooltip: ["Ring", "Hit Chance Increase 5%"], amount: 1, container: root, nameSource: "opl" }]);

  const failedOpen = mkScan("2026-09-13T01:00:00+00:00", false, []);
  const keptInv = foldSnapshots([full, failedOpen]);
  assert.ok(Object.values(keptInv.items).some((i) => i.serial === 1 && i.root === root), "opened:false keeps what was known about the root");

  const reallyEmptied = mkScan("2026-09-13T02:00:00+00:00", true, []);
  const emptiedInv = foldSnapshots([full, reallyEmptied]);
  assert.ok(!Object.values(emptiedInv.items).some((i) => i.serial === 1), "opened:true with no items empties the root");
});

test("[fast] fold: a character's adapter identity is exposed on inv.characters for the bridge buttons to read", () => {
  const inv = foldSnapshots([kestrel]);
  assert.equal(inv.characters.Kestrel!.adapter!.id, "tazuo");
  assert.deepEqual(inv.characters.Kestrel!.adapter!.capabilities.bridge, ["highlight", "grab", "goto"]);
});

test("[fast] bagLabel prefers the engraving", () => {
  assert.equal(bagLabel({ serial: 1, name: "Bag", tooltip: ["Bag", "Engraved: DEXXER armor"] }), "DEXXER armor");
  assert.equal(bagLabel({ serial: 1, name: "Metal Chest", tooltip: ["Metal Chest"] }), "Metal Chest");
});

// Organize (issue #11) reads a container's room from its tooltip's Contents line.
test("[fast] capacityOf reads a Contents line in every form the server writes", () => {
  assert.deepEqual(capacityOf(["Metal Chest", "Contents: 13/125 Items, 95 Stones"]), { items: 13, maxItems: 125, stones: 95, maxStones: null });
  assert.deepEqual(capacityOf(["Keg", "Contents: 1/1 Items, 49/50 Stones"]), { items: 1, maxItems: 1, stones: 49, maxStones: 50 });
  assert.deepEqual(capacityOf(["Bag", "Weight: 3 Stones", "Contents: 0/125 Items, 0 Stones"]), { items: 0, maxItems: 125, stones: 0, maxStones: null }, "the bag's own Weight line is not its contents");
  assert.deepEqual(capacityOf(["Box", "<BASEFONT COLOR=#FFFFFF>Contents: 4/125 Items, 44 Stones</BASEFONT>"]), { items: 4, maxItems: 125, stones: 44, maxStones: null });
  assert.deepEqual(capacityOf(["Crate", "contents: 1/125 item, 1 stone"]), { items: 1, maxItems: 125, stones: 1, maxStones: null });
  assert.deepEqual(capacityOf(["Vault", "Contents: 1,204/1,500 Items, 2,310 Stones"]), { items: 1204, maxItems: 1500, stones: 2310, maxStones: null });
  assert.deepEqual(capacityOf(["Pouch", "Contents: 3/125 Items"]), { items: 3, maxItems: 125, stones: null, maxStones: null });
});

test("[fast] capacityOf is null without a Contents line", () => {
  assert.equal(capacityOf(undefined), null);
  assert.equal(capacityOf([]), null);
  assert.equal(capacityOf(["Metal Chest"]), null);
  assert.equal(capacityOf(["Chest", "Contents may shift in transit"]), null);
  assert.equal(capacityOf(["Chest", "Contents: 13 Items, 95 Stones"]), null, "no maximum, no capacity");
  assert.equal(capacityOf(["Chest", "Contents: ,/125 Items"]), null);
});

test("[fast] fold: every container carries its capacity and a ground root keeps its facet", () => {
  const fixture = JSON.parse(readFileSync(join(HERE, "..", "adapters", "tazuo", "fixture.scan.json"), "utf8")) as ScanV2;
  const inv = foldSnapshots([fixture]);
  const roots = Object.values(inv.containers).filter((c) => c.parent == null);
  const grounds = roots.filter((c) => c.kind === "ground");
  assert.ok(grounds.length > 0);
  for (const c of grounds) {
    assert.equal(c.capacity?.maxItems, 125, c.label);
    assert.equal(c.pos?.facet, 1, c.label);
  }
  assert.equal(roots.find((c) => c.kind === "backpack")!.capacity, null, "a backpack root has no tooltip");
  assert.deepEqual(Object.values(inv.containers).find((c) => c.name === "Reagents")!.capacity, { items: 13, maxItems: 125, stones: 95, maxStones: null });
  const demo = Object.values(foldSnapshots([kestrel]).containers).find((c) => c.parent == null)!;
  assert.deepEqual(demo.capacity, { items: 120, maxItems: 125, stones: 100, maxStones: null });
});

// A ground root as a scanner before TazUO 2.9.0 / Razor Enhanced 1.9.0 wrote it (no tooltip), or with one.
const chestScan = (tooltip?: string[]): ScanV2 => ({
  schemaVersion: 2, character: "Tester", scannedAt: "2026-09-01T10:00:00Z", stats: {},
  adapter: { id: "tazuo", version: "2.8.0", client: "TazUO", clientVersion: null, capabilities: TAZUO_V1_CAPS },
  roots: [{ serial: 100, kind: "ground", name: "Metal Chest", opened: true }],
  containers: { "100": { serial: 100, kind: "ground", name: "Metal Chest", parent: null, root: 100, pos: { x: 1, y: 1, z: 0 }, ...(tooltip ? { tooltip } : {}) } },
  items: [{ serial: 200, container: 100, name: "Ruby", nameSource: "opl", tooltip: ["Ruby"] }], equipped: [],
}) as unknown as ScanV2;

test("[fast] fold: a ground root from a scan before root tooltips has capacity null; an engraved one is named by its engraving", () => {
  const old = foldSnapshots([chestScan()]);
  assert.equal(old.containers["100"]!.capacity, null);
  assert.equal(old.containers["100"]!.label, "Metal Chest");
  const engraved = foldSnapshots([chestScan(["Metal Chest", "Engraved: Reagents", "Contents: 1/125 Items, 1 Stones"])]);
  assert.equal(engraved.containers["100"]!.label, "Reagents");
  assert.equal(foldedItems(engraved)[0]!.location.text, "Reagents");
});

// ---- the shipped corpus: every adapter fixture and the demo data ---------------------------
// Hand-picked classify/parse cases missed set bonuses, "... Arms" and named artifacts for a long
// time; these tests run the real scans through the same parse + classify path the fold uses.
const ADAPTERS_DIR = join(HERE, "..", "adapters");
const corpus: Array<{ label: string; scan: ScanV2 }> = [
  ...readdirSync(ADAPTERS_DIR).filter((a) => existsSync(join(ADAPTERS_DIR, a, "fixture.scan.json")))
    .map((a) => ({ label: `adapters/${a}`, scan: JSON.parse(readFileSync(join(ADAPTERS_DIR, a, "fixture.scan.json"), "utf8")) as ScanV2 })),   // known-good fixture: the cast stands in for the validateScan() a real caller runs
  { label: "demo-Kestrel", scan: kestrel }, { label: "demo-Dorran", scan: dorran },
];
// The fixtures carry only the incomplete-set header, which ServUO prints last, so everything below it is the set block.
const SET_HEADER_RE = /^(<br>)?only when full set is present/i;

for (const { label, scan } of corpus) {
  test(`[fast] corpus ${label}: every prop-carrying piece of gear has a slot, and every "... Arms" piece is in the arms slot`, () => {
    const items = Object.values(foldSnapshots([scan]).items).filter((i) => i.gear);
    const unslotted = items.filter((i) => !i.slot && Object.keys(i.props).some((k) => k !== "tagPenalty")).map((i) => `${i.name} (graphic ${i.graphic})`);
    assert.deepEqual(unslotted, [], "gear the optimizer would never see");
    for (const it of items.filter((i) => /\barms\b/i.test(i.name))) assert.equal(it.slot, "arms", it.name);
  });

  test(`[fast] corpus ${label}: a set piece's own props are exactly its lines above the full-set header`, () => {
    let sets = 0;
    for (const raw of [...scan.items, ...scan.equipped]) {
      const lines = raw.tooltip || [];
      const at = lines.findIndex((l) => SET_HEADER_RE.test(l));
      if (at < 0) continue;
      sets++;
      const whole = parseTooltip(lines), own = parseTooltip(lines.slice(0, at));
      assert.deepEqual(whole.props, own.props, `${raw.name}: own props`);
      assert.deepEqual(whole.setBonus, parseTooltip([lines[0], ...lines.slice(at + 1)]).props, `${raw.name}: set bonus`);
    }
    assert.ok(sets > 0, `${label} carries set pieces, so this test is not vacuous`);
  });

  test(`[fast] corpus ${label}: a worn piece taken off lands in the slot its layer put it in`, () => {
    let checked = 0;
    for (const raw of scan.equipped) {
      if (!raw.layer || !LAYER_TO_SLOT[raw.layer]) continue;
      const parsed = parseTooltip(raw.tooltip?.length ? raw.tooltip : [raw.name]);
      const off = classify(parsed.name || raw.name, parsed, null, raw.graphic);
      assert.equal(off.slot, LAYER_TO_SLOT[raw.layer], `${raw.name} (worn on ${raw.layer}, graphic ${raw.graphic})`);
      checked++;
    }
    // the synthetic demo scans record no worn layer; a real adapter fixture must
    if (label.startsWith("adapters/")) assert.ok(checked > 0, "the fixture records worn layers");
  });
}

test("[smoke] corpus: known TazUO fixture pieces land in their real slots with their own resists", () => {
  const scan = corpus.find((c) => c.label === "adapters/tazuo")!.scan;
  const items = Object.values(foldSnapshots([scan]).items);
  const find = (name: string, graphic?: number) => items.filter((i) => i.name === name && (graphic == null || i.graphic === graphic));
  assert.ok(find("Heart Of The Lion").length && find("Heart Of The Lion").every((i) => i.slot === "chest"));
  assert.ok(find("Platemail Arms").every((i) => i.slot === "arms"));
  assert.ok(find("Leaf Arms").every((i) => i.slot === "arms"));
  assert.ok(find("Doublet").length && find("Doublet").every((i) => i.slot === "tunic"));
  const initiation: Array<[number, string]> = [[5063, "neck"], [5067, "legs"], [5062, "hands"], [7609, "helmet"], [5068, "chest"], [5069, "arms"]];
  for (const [g, slot] of initiation) {
    const [piece] = find("Armor Of Initiation", g);
    assert.equal(piece?.slot, slot, `Armor Of Initiation graphic ${g}`);
    assert.equal(piece?.props.physResist, 7, "own physical resist, not own + set bonus");
    assert.equal(piece?.setBonus?.physResist, 2);
  }
});

// ---- pools --------------------------------------------------------------------------------
test("[smoke] buildPools: other characters' worn gear is excluded by default, STR-gated, tag-filtered", () => {
  const inv = foldSnapshots([kestrel, dorran]);
  const { pools, current, skipped } = buildPools(inv, "Kestrel", { strength: 30, excludeTags: ["cursed"] });
  assert.ok(current.chest, "current chest read from equipped");
  const dorranWeapon = Object.values(inv.items).find((i) => i.equippedBy === "Dorran" && (i.slot === "oneHanded" || i.slot === "twoHanded"));
  assert.ok(dorranWeapon);
  assert.ok(skipped.worn.some((i) => i.serial === dorranWeapon.serial), "Dorran's weapon skipped");
  assert.ok(!pools[dorranWeapon.slot as string]?.some((i) => i.serial === dorranWeapon.serial));
  assert.ok(skipped.str.length > 0, "some weapons too heavy for STR 30");
  assert.ok(skipped.tags.every((i) => i.tags.includes("cursed")));
  const all = buildPools(inv, "Kestrel", { allowOthersWorn: true });
  assert.ok(all.pools[dorranWeapon.slot as string]!.some((i) => i.serial === dorranWeapon.serial));
});

test("[fast] gargoyle gear is flagged and excluded from pools by default", () => {
  const snap: ScanV2 = { ...kestrel, scannedAt: "2026-09-12T00:00:00+00:00", items: [...kestrel.items, { serial: 0x7fff0099, name: "Gargish Platemail Leggings Of Vitality", tooltip: ["Gargish Platemail Leggings Of Vitality", "Physical Resist 10%"], amount: 1, container: kestrel.roots[0]!.serial, nameSource: "opl" }] };
  const inv = foldSnapshots([snap]);
  const g = inv.items[0x7fff0099];
  assert.ok(g);
  assert.equal(g.gargoyle, true); assert.equal(g.slot, "legs");
  assert.ok(!buildPools(inv, "Kestrel").pools.legs?.some((i) => i.serial === g.serial));
  assert.ok(buildPools(inv, "Kestrel", { excludeGargoyle: false }).pools.legs!.some((i) => i.serial === g.serial));
});

test("[fast] requirementReport marks floors met/unmet and caps", () => {
  const rows = requirementReport({ lrc: 100, lmc: 25, fc: 2 }, { weights: { lrc: 1, lmc: 1, fc: 1, fcr: 1 }, floors: { lrc: 100, lmc: 40 }, caps: { lrc: 100, lmc: 40, fc: 2 } });
  const by = Object.fromEntries(rows.map((r) => [r.key, r]));
  assert.equal(by.lrc!.met, true); assert.equal(by.lrc!.capped, true);
  assert.equal(by.lmc!.met, false);
  assert.equal(by.fc!.met, null); assert.equal(by.fc!.capped, true);
  assert.equal(by.fcr!.value, 0);
});

test("[smoke] parseTooltip reads a Scroll of Transcendence's skill and points", () => {
  const sot = (lines: string[], amount?: number) => { const p = parseTooltip(lines, amount); return [p.sotSkill, p.props.sotPoints]; };
  assert.deepEqual(sot(["Scroll Of Transcendence", "Cursed", "Weight: 1 Stone", "Skill: Animal Lore 0.1 Skill Points"]), ["Animal Lore", 0.1]);
  assert.deepEqual(sot(["Scroll Of Transcendence", "Spirit Speak 0.5 Skill"]), ["Spirit Speak", 0.5], "the older line form");
  assert.deepEqual(sot(["Scroll Of Transcendence", "Skill: Fencing 1 Skill Point"]), ["Fencing", 1], "a singular point");
  assert.deepEqual(sot(["Scroll Of Transcendence", "Skill: Fencing 0.3 Skill Points."]), ["Fencing", 0.3], "a trailing period");
  assert.deepEqual(sot(["Scroll Of Transcendence", "Spirit Speak 0.5 Skill."]), ["Spirit Speak", 0.5], "a trailing period on the older form");
  assert.deepEqual(sot(["2 Scroll Of Transcendence", "Skill: Chivalry 1.2 Skill Points"], 2), ["Chivalry", 1.2], "a stack prefix");
  assert.deepEqual(sot(["scroll of TRANSCENDENCE", "skill: Animal Taming 3 skill points"]), ["Animal Taming", 3], "mixed case");
  assert.deepEqual(sot(["Scroll Of Alacrity", "Skill: Animal Lore 0.1 Skill Points"]), [null, undefined], "only a Scroll of Transcendence");
  assert.deepEqual(sot(["Scroll Of Transcendence"]), [null, undefined], "no skill line, no skill");
});

test("[smoke] displayName names a Scroll of Transcendence by its skill and points, and leaves every other name alone", () => {
  assert.equal(displayName(parseTooltip(["Scroll Of Transcendence", "Skill: Animal Lore 0.1 Skill Points"])), "Scroll of Transcendence (Animal Lore - 0.1 Pts)");
  assert.equal(displayName(parseTooltip(["Scroll Of Transcendence", "Skill: Chivalry 2 Skill Points"])), "Scroll of Transcendence (Chivalry - 2.0 Pts)");
  assert.equal(displayName(parseTooltip(["Scroll Of Transcendence"])), "Scroll Of Transcendence");
  assert.equal(displayName(parseTooltip(["An Exalted Scroll Of Mysticism (110 Skill)"])), "An Exalted Scroll Of Mysticism (110 Skill)");
});

test("[fast] compareNames orders names A to Z with their numbers by value (issue #181)", () => {
  const names = ["Scroll of Transcendence (Animal Lore - 10.0 Pts)", "Black Pearl", "Scroll of Transcendence (Animal Lore - 2.0 Pts)", "scroll of transcendence (Chivalry - 0.5 Pts)"];
  assert.deepEqual(names.sort(compareNames), ["Black Pearl", "Scroll of Transcendence (Animal Lore - 2.0 Pts)", "Scroll of Transcendence (Animal Lore - 10.0 Pts)", "scroll of transcendence (Chivalry - 0.5 Pts)"]);
});

test("[fast] gameName is the tooltip's first line, a stack's count stripped, else the shown name", () => {
  assert.equal(gameName({ name: "Scroll of Transcendence (Chivalry - 0.6 Pts)", lines: ["Scroll Of Transcendence", "Skill: Chivalry 0.6 Skill Points"] }), "Scroll Of Transcendence");
  assert.equal(gameName({ name: "Black Pearl", lines: ["20 Black Pearl"], amount: 20 }), "Black Pearl");
  assert.equal(gameName({ name: "Katana" }), "Katana");
});

test("[fast] fold: Scrolls of Transcendence show their skill and points, stay scrolls, and group and sort by skill", () => {
  const inv = foldSnapshots([dorran]);
  const sots = Object.values(inv.items).filter((it) => it.lines[0] === "Scroll Of Transcendence").map((it) => it.name).sort();
  assert.deepEqual(sots, ["Scroll of Transcendence (Chivalry - 0.6 Pts)", "Scroll of Transcendence (Spellweaving - 0.2 Pts)"]);
  assert.ok(Object.values(inv.items).filter((it) => it.lines[0] === "Scroll Of Transcendence").every((it) => it.kind === "scroll" && !it.gear));
  assert.equal(groupByName(Object.values(inv.items).filter((it) => it.lines[0] === "Scroll Of Transcendence")).length, 2, "two skills, two groups");
  assert.ok(NOT_BUILDER_KEYS.has("sotPoints"));
});

test("[fast] propertyKeys lists the modeled properties present", () => {
  const inv = foldSnapshots([kestrel, dorran]);
  const keys = propertyKeys(inv);
  assert.ok(keys.includes("hci") && keys.includes("lrc") && !keys.includes("tagPenalty"));
});

test("[fast] fold: power scrolls carry psLevel, stay scrolls, and the level is filterable but never a builder key", () => {
  const inv = foldSnapshots([dorran]);
  const scrolls = Object.values(inv.items).filter((it) => /\(\d{3} Skill\)/.test(it.name));
  assert.ok(scrolls.length > 0);
  for (const it of scrolls) {
    assert.equal(it.props.psLevel, 110, it.name);
    assert.equal(it.kind, "scroll", it.name);
    assert.equal(it.gear, false, it.name);
  }
  assert.ok(propertyKeys(inv).includes("psLevel"));
  assert.ok(NOT_BUILDER_KEYS.has("psLevel"));
});

// ---- suit builder: weapon filter, saved runs ---------------------------------------------------
const OTHERS = (skill: string): string[] => WEAPON_SKILLS.filter((w) => w !== skill);
test("[fast] weapon filter: an excluded skill's weapons leave the pool, and nothing else in the hands does", () => {
  // buildPools reads a handful of Item fields (see its own body) — mk() deliberately builds a
  // PARTIAL fixture, cast once at the call site, same idiom as toOptItem's above and item-query.test.mts's mk().
  const mk = (serial: number, slot: string, extra: Record<string, unknown> = {}): Item => ({ serial, name: `i${serial}`, slot, gear: true, props: { hci: 1 }, tags: [], strReq: 0, root: 1, equippedBy: null, gargoyle: false, medable: true, ...extra } as unknown as Item);
  const inv = { items: {
    1: mk(1, "twoHanded", { twoHanded: true, skillReq: "archery" }),
    2: mk(2, "oneHanded", { skillReq: "Swordsmanship" }),
    3: mk(3, "twoHanded", {}),                                                                   // a shield
    4: mk(4, "oneHanded", {}),                                                                   // a spellbook
    5: mk(5, "twoHanded", { twoHanded: true, skillReq: "swordsmanship", equippedBy: "Kestrel", root: null }),
    6: mk(6, "helmet", {}),
    7: mk(7, "oneHanded", { skillReq: "fencing" }),
    8: mk(8, "oneHanded", { skillReq: "mace fighting" }),
  } } as unknown as Inventory;
  const hands = (r: ReturnType<typeof buildPools>): number[] => [...(r.pools.oneHanded || []), ...(r.pools.twoHanded || [])].map((i) => i.serial).sort((a, b) => a - b);
  const fm = buildPools(inv, "Kestrel", { excludeWeapons: ["archery", "swordsmanship", "throwing"] });
  assert.deepEqual(hands(fm), [3, 4, 7, 8], "fencing and mace fighting, plus the shield and spellbook");
  assert.deepEqual(fm.blocked, ["twoHanded"], "the worn greatsword may not stay a candidate");
  assert.equal(fm.skipped.weapon.length, 3);
  assert.deepEqual(fm.pools.helmet!.map((i) => i.serial), [6]);
  assert.deepEqual(hands(buildPools(inv, "Kestrel", {})), [1, 2, 3, 4, 5, 7, 8], "no exclusions: everything");
  assert.ok(weaponAllowed({ slot: "ring" } as unknown as Item, [...WEAPON_SKILLS]));
});

test("[fast] weapon filter: a Use Best Weapon Skill weapon passes while any melee skill is allowed", () => {
  const ubws = (slot: string, skillReq: string): Item => ({ slot, skillReq, flags: ["use best weapon skill"] } as unknown as Item);
  const swordsOnly = OTHERS("swordsmanship");
  assert.ok(weaponAllowed(ubws("twoHanded", "swordsmanship"), swordsOnly), "a katana");
  assert.ok(weaponAllowed(ubws("oneHanded", "fencing"), swordsOnly), "a kryss swings with swordsmanship");
  assert.ok(weaponAllowed(ubws("twoHanded", "archery"), swordsOnly), "a bow swings with the best melee skill too");
  assert.ok(!weaponAllowed(ubws("oneHanded", "fencing"), ["swordsmanship", "fencing", "mace fighting"]), "every melee skill excluded");
  assert.ok(weaponAllowed(ubws("twoHanded", "archery"), ["swordsmanship", "fencing", "mace fighting"]), "then its own skill decides");
  assert.ok(!weaponAllowed(ubws("oneHanded", "fencing"), swordsOnly, false), "the switch off: its own skill decides");
  assert.ok(!weaponAllowed({ slot: "oneHanded", skillReq: "fencing", flags: [] } as unknown as Item, swordsOnly), "no flag, no pass");
  assert.ok(weaponAllowed({ slot: "ring", flags: ["use best weapon skill"] } as unknown as Item, [...WEAPON_SKILLS]), "a non-weapon is untouched");
  // Issue #193: on this shard a Use Best Weapon Skill weapon can carry no Skill Required line (a Sledge Hammer). It swings
  // with a melee skill all the same, so with every melee skill excluded (or the switch off and any one excluded) it stays out.
  const noLine = { slot: "oneHanded", skillReq: null, flags: ["use best weapon skill"] } as unknown as Item;
  assert.ok(!weaponAllowed(noLine, OTHERS("archery")), "archery only: the hammer stays out");
  assert.ok(!weaponAllowed(noLine, swordsOnly, false), "the switch off: no skill of its own to vouch for it");
  assert.ok(weaponAllowed(noLine, swordsOnly), "a melee skill allowed: it swings with that");
  assert.ok(weaponAllowed({ slot: "twoHanded", skillReq: null, flags: [] } as unknown as Item, OTHERS("archery")), "a shield (no line, no flag) is untouched");
  const inv = { items: { 1: { serial: 1, slot: "oneHanded", gear: true, props: {}, tags: [], strReq: 0, root: 1, equippedBy: null, skillReq: "fencing", flags: ["use best weapon skill"] } } } as unknown as Inventory;
  assert.equal(buildPools(inv, "Kestrel", { excludeWeapons: swordsOnly }).pools.oneHanded?.length, 1, "buildPools defaults the switch on");
  assert.equal(buildPools(inv, "Kestrel", { excludeWeapons: swordsOnly, ubwsAnyWeapon: false }).skipped.weapon.length, 1);
});

// Issue #259: "spellbook" in the list keeps every spellbook out; weapons are judged by their skills as before.
test("[fast] weapon filter: an excluded Spellbooks row keeps spellbooks out and nothing else", () => {
  const book = { slot: "oneHanded", name: "Scrapper's Compendium", skillReq: null, flags: [] } as unknown as Item;
  assert.ok(!weaponAllowed(book, ["spellbook"]), "a spellbook out");
  assert.ok(!weaponAllowed({ ...book, name: "Book of Chivalry" }, ["archery", "spellbook"]));
  assert.ok(weaponAllowed(book, ["archery"]), "not excluded: it stays");
  assert.ok(weaponAllowed({ slot: "oneHanded", name: "Katana", skillReq: "swordsmanship", flags: [] } as unknown as Item, ["spellbook"]), "a weapon of an allowed skill in");
  assert.ok(weaponAllowed({ slot: "oneHanded", name: "Kryss", skillReq: "fencing", flags: ["use best weapon skill"] } as unknown as Item, ["fencing", "spellbook"]), "a UBWS weapon unaffected");
  assert.ok(weaponAllowed({ slot: "oneHanded", name: "Sledge Hammer", skillReq: null, flags: ["use best weapon skill"] } as unknown as Item, ["spellbook"], false), "no weapon skill excluded: a UBWS weapon with no Skill Required line stays");
  assert.ok(weaponAllowed({ slot: "twoHanded", name: "Order Shield", skillReq: null, flags: [] } as unknown as Item, ["spellbook"]), "a shield stays");
  const mk = (serial: number, name: string, extra: Record<string, unknown> = {}): Item => ({ serial, name, slot: "oneHanded", gear: true, props: { hci: 1 }, tags: [], strReq: 0, root: 1, equippedBy: null, gargoyle: false, medable: true, ...extra } as unknown as Item);
  const inv = { items: { 1: mk(1, "Spellbook"), 2: mk(2, "Katana", { skillReq: "swordsmanship" }), 3: mk(3, "Necromancer Spellbook", { equippedBy: "Kestrel", root: null }) } } as unknown as Inventory;
  const r = buildPools(inv, "Kestrel", { excludeWeapons: ["spellbook"] });
  assert.deepEqual(r.pools.oneHanded!.map((i) => i.serial), [2], "only the katana");
  assert.equal(r.skipped.weapon.length, 2);
  assert.deepEqual(r.blocked, ["oneHanded"], "the worn spellbook may not stay a candidate, as a worn weapon of an excluded skill");
  assert.deepEqual(buildPools(inv, "Kestrel", { excludeWeapons: ["spellbook"], lockedSlots: ["oneHanded"] }).blocked, ["oneHanded"], "a lock does not keep it, as it does not keep an excluded weapon");
  assert.deepEqual(buildPools(inv, "Kestrel", { excludeWeapons: ["spellbook"], pinned: { oneHanded: 3 } }).pools.oneHanded!.map((i) => i.serial), [3], "a pinned one is kept");
  assert.deepEqual(buildPools(inv, "Kestrel", {}).pools.oneHanded!.map((i) => i.serial).sort(), [1, 2, 3], "unchecked: today's pool");
});

test("[fast] profiles: ubwsAnyWeapon is on unless set false, and the schema takes it", () => {
  assert.equal(templateFrom({}).ubwsAnyWeapon, true, "an old profile or template without the field");
  assert.equal(templateFrom({ ubwsAnyWeapon: false }).ubwsAnyWeapon, false);
  const schema = JSON.parse(readFileSync(join(HERE, "schema", "profiles.v3.schema.json"), "utf8")) as ValidatorSchema;
  const spec = (ubwsAnyWeapon: unknown) => ({ ...specFromProfile({}), pool: { ...specFromProfile({}).pool, ubwsAnyWeapon } });
  assert.ok(validate(schema, { schemaVersion: 3, characters: { A: { spec: spec(false) } }, templates: { t: { spec: spec(true) } } }).ok);
  for (const g of ["characters", "templates"]) {
    const r = validate(schema, { schemaVersion: 3, characters: {}, templates: {}, [g]: { A: { spec: spec("yes") } } });
    assert.match(r.errors[0]?.path || "", new RegExp(`^/${g}/A/spec/pool/ubwsAnyWeapon`), `PUT /api/profiles refuses a non-boolean in ${g}: ${JSON.stringify(r.errors)}`);
  }
  assert.deepEqual(settingsDiff({}, { ubwsAnyWeapon: false }), ["Use Best Weapon Skill weapons held to their own skill"]);
  assert.deepEqual(settingsDiff({ ubwsAnyWeapon: false }, { ubwsAnyWeapon: true }), ["Use Best Weapon Skill weapons allowed"]);
  assert.deepEqual(settingsDiff({}, { ubwsAnyWeapon: true }), [], "absent means on");
});

// Issue #214: a build may require yes/no properties on its weapon (pool weaponMustHave). Both hands are filtered; shields
// and spellbooks are not weapons; a locked worn weapon without them stays (the lock wins) and is named in weaponFlags.kept.
test("[fast] weapon properties filter: both hands, shields and spellbooks untouched, the lock wins, an empty pool said", () => {
  const mk = (serial: number, slot: string, extra: Record<string, unknown> = {}): Item => ({ serial, name: `i${serial}`, slot, gear: true, props: { hci: 1 }, flags: [], extras: {}, tags: [], strReq: 0, root: 1, equippedBy: null, gargoyle: false, medable: true, ...extra } as unknown as Item);
  const inv = { items: {
    1: mk(1, "twoHanded", { twoHanded: true, skillReq: "archery", flags: ["balanced"] }),
    2: mk(2, "oneHanded", { skillReq: "swordsmanship", flags: ["spell channeling"] }),
    3: mk(3, "twoHanded", {}),                                                                   // a shield
    4: mk(4, "oneHanded", { name: "Spellbook" }),                                                // a spellbook
    5: mk(5, "oneHanded", { skillReq: "fencing", equippedBy: "Kestrel", root: null }),
    6: mk(6, "twoHanded", { twoHanded: true, skillReq: "swordsmanship", flags: ["spell channeling", "balanced"] }),
    7: mk(7, "oneHanded", { extras: { "weapon speed": 2.5 } }),                                 // a weapon with no Skill Required line
  } } as unknown as Inventory;
  const hands = (r: ReturnType<typeof buildPools>): number[] => [...(r.pools.oneHanded || []), ...(r.pools.twoHanded || [])].map((i) => i.serial).sort((a, b) => a - b);
  const sc = buildPools(inv, "Kestrel", { weaponMustHave: ["spell channeling"] });
  assert.deepEqual(hands(sc), [2, 3, 4, 6], "a one-hander and a two-hander with it, the shield and the spellbook");
  assert.deepEqual(sc.blocked, ["oneHanded"], "the worn kryss without it may not stay");
  assert.deepEqual(sc.skipped.weapon.map((i) => i.serial).sort(), [1, 5, 7]);
  assert.deepEqual(sc.weaponFlags, { kept: [], none: false });
  assert.deepEqual(hands(buildPools(inv, "Kestrel", { weaponMustHave: ["balanced"] })), [1, 3, 4, 6], "the two-handers with it, not the one-hander without");
  assert.deepEqual(hands(buildPools(inv, "Kestrel", { weaponMustHave: ["spell channeling", "balanced"] })), [3, 4, 6], "every listed property");
  assert.equal(buildPools(inv, "Kestrel", {}).weaponFlags, undefined, "nothing required: no report");
  const locked = buildPools(inv, "Kestrel", { weaponMustHave: ["spell channeling"], lockedSlots: ["oneHanded"] });
  assert.deepEqual(locked.blocked, [], "the lock wins: the worn kryss stays current");
  assert.equal(locked.current.oneHanded?.serial, 5);
  assert.deepEqual(locked.weaponFlags, { kept: ["oneHanded"], none: false });
  const none = buildPools(inv, "Kestrel", { weaponMustHave: ["night sight"] });
  assert.deepEqual(hands(none), [3, 4], "no weapon left, the shield and spellbook stay");
  assert.deepEqual(none.weaponFlags, { kept: [], none: true });
  assert.deepEqual(buildPools(inv, "Kestrel", { weaponMustHave: ["night sight"], excludeRoots: [1], excludeWeapons: ["fencing"] }).weaponFlags, { kept: [], none: false }, "other settings emptied the pool: the requirement is not why");
  assert.deepEqual(buildPools(inv, "Kestrel", { weaponMustHave: ["night sight"], lockedSlots: ["oneHanded"] }).weaponFlags, { kept: ["oneHanded"], none: false }, "the locked weapon is the suit's, so the pool is not called empty");
  assert.ok(weaponHasFlags(mk(9, "ring"), ["balanced"]), "a ring is no weapon");
  assert.equal(weaponMustHaveError(undefined), null);
  assert.equal(weaponMustHaveError(["spell channeling", "balanced"]), null);
  assert.equal(weaponMustHaveError("balanced"), "weaponMustHave must be an array");
  assert.match(weaponMustHaveError(["balanced", "balanced"], "settings.weaponMustHave")!, /^settings\.weaponMustHave\[1\] is not a yes\/no property, or is listed twice/);
  assert.match(weaponMustHaveError(["sharp"])!, /^weaponMustHave\[0\]/);
  const schema = JSON.parse(readFileSync(join(HERE, "schema", "profiles.v3.schema.json"), "utf8")) as { $defs: { pool: { properties: { weaponMustHave: { items: { enum: string[] } } } } } };
  assert.deepEqual(schema.$defs.pool.properties.weaponMustHave.items.enum, [...BOOLEAN_FLAGS], "the schema knows the same properties");
  assert.deepEqual(settingsDiff({}, { weaponMustHave: ["spell channeling"] }), ["weapon must have spell channeling"]);
  assert.deepEqual(settingsDiff({ weaponMustHave: ["balanced"] }, {}), ["weapon need not have balanced"]);
  assert.deepEqual(templateFrom({ weaponMustHave: ["balanced"] }).weaponMustHave, ["balanced"], "templates carry it");
  assert.deepEqual(templateFrom({}).weaponMustHave, []);
});

// Issue #188: the weapon skills a weapon counts under in the Inventory's Weapon skill filter. Use Best Weapon Skill swings
// with the best of the three melee skills (ServUO BaseWeapon.GetUsedSkill), so it counts under all three.
test("[fast] weaponSkillsOf: a weapon's own skill, plus the three melee skills with Use Best Weapon Skill", () => {
  const w = (o: Record<string, unknown>): Item => ({ slot: "oneHanded", skillReq: null, flags: [], ...o }) as unknown as Item;
  assert.deepEqual(weaponSkillsOf(w({ skillReq: "fencing" })), ["fencing"]);
  assert.deepEqual(weaponSkillsOf(w({ slot: "twoHanded", skillReq: "Archery" })), ["archery"], "read whatever its case");
  assert.deepEqual(weaponSkillsOf(w({ skillReq: "archery", flags: ["use best weapon skill"] })), ["archery", "swordsmanship", "fencing", "mace fighting"]);
  assert.deepEqual(weaponSkillsOf(w({ skillReq: "fencing", flags: ["use best weapon skill"] })), ["swordsmanship", "fencing", "mace fighting"]);
  assert.deepEqual(weaponSkillsOf(w({ flags: ["use best weapon skill"] })), ["swordsmanship", "fencing", "mace fighting"], "no Skill Required line");
  assert.deepEqual(weaponSkillsOf(w({})), [], "a weapon with no Skill Required line counts under none");
  assert.deepEqual(weaponSkillsOf(w({ skillReq: "wrestling" })), [], "only the weapon skills");
  assert.deepEqual(weaponSkillsOf(w({ slot: "ring", flags: ["use best weapon skill"] })), [], "not a weapon");
  assert.deepEqual(weaponSkillsOf({ slot: "hands" } as unknown as Item), []);
});

test("[fast] weapon exclusions: the old single choice converts to every other skill; the list holds known skills", () => {
  const old = { floors: { hci: 45 }, weaponSkill: "Fencing" };
  const m = migrateWeaponSetting(old);
  assert.deepEqual(m, { floors: { hci: 45 }, excludeWeapons: ["archery", "swordsmanship", "mace fighting", "throwing"] });
  assert.equal(old.weaponSkill, "Fencing", "pure");
  assert.equal(migrateWeaponSetting(m), m, "nothing to convert: the same object back");
  assert.deepEqual(migrateWeaponSetting({ weaponSkill: null }), { excludeWeapons: [] }, "null was any weapon");
  assert.equal(excludeWeaponsError(undefined), null);
  assert.equal(excludeWeaponsError(["archery", "mace fighting"]), null);
  assert.equal(excludeWeaponsError("archery"), "excludeWeapons must be an array");
  assert.match(excludeWeaponsError(["archery", "wrestling"], "settings.excludeWeapons")!, /^settings\.excludeWeapons\[1\] must be a weapon skill or spellbook/);
  assert.equal(excludeWeaponsError(["archery", "spellbook"]), null, "spellbooks too");
  assert.match(excludeWeaponsError(["spellbooks"])!, /^excludeWeapons\[0\] must be a weapon skill or spellbook/);
  const schema = JSON.parse(readFileSync(join(HERE, "schema", "profiles.v3.schema.json"), "utf8")) as { $defs: { pool: { properties: { excludeWeapons: { items: { enum: string[] } } } } } };
  assert.deepEqual(schema.$defs.pool.properties.excludeWeapons.items.enum, WEAPON_EXCLUDES, "the schema knows the same skills and spellbooks");
});

test("[fast] settingsDiff names what changed between two runs", () => {
  const a = { floors: { di: 40, hci: 35 }, softFloors: [] as string[], weights: { ssi: 10 }, lockedSlots: [] as string[], excludeWeapons: [] as string[], exact: true, budgetMs: 300000, strLimit: 73 };
  const b = { floors: { di: 80 }, softFloors: ["di"], weights: { ssi: 5, dci: 8 }, lockedSlots: ["twoHanded"], excludeWeapons: ["archery", "throwing"], exact: true, budgetMs: 60000, strLimit: 73 };
  const d = settingsDiff(a, b);
  const L = (k: string) => PROP_LABELS[k] || k;
  for (const want of [`${L("di")} floor 40 → 80`, `${L("hci")} floor 35 removed`, `${L("ssi")} weight 10 → 5`, `${L("dci")} weight 8 added`, `${L("di")} floor made soft`, "excluding archery, throwing weapons", "budget 300 s → 60 s"])
    assert.ok(d.includes(want), `missing "${want}" in ${JSON.stringify(d)}`);
  assert.ok(d.some((x) => x.startsWith("locked ")));
  assert.deepEqual(settingsDiff(a, a), []);
  assert.deepEqual(settingsDiff({ excludeWeapons: ["archery", "throwing"] }, { excludeWeapons: ["throwing", "fencing"] }), ["excluding fencing weapons", "allowing archery weapons"]);
  assert.deepEqual(settingsDiff({ excludeWeapons: [] }, { excludeWeapons: ["spellbook"] }), ["excluding spellbooks"], "issue #259: spellbooks are not weapons");
  assert.deepEqual(settingsDiff({ excludeWeapons: ["spellbook"] }, { excludeWeapons: ["archery"] }), ["excluding archery weapons", "allowing spellbooks"]);
  assert.deepEqual(settingsDiff({ excludeWeapons: [] }, { excludeWeapons: ["throwing", "spellbook"] }), ["excluding throwing weapons and spellbooks"]);
});

// ---- templates ----------------------------------------------------------------------------
const OLD_PROFILES: ProfilesFile = {
  _comment: "x", caps: { hci: 45 },
  characters: { Dorran: { archetype: "melee", weights: { hci: 10 }, floors: { hci: 35 }, race: "human", weaponSkill: "swordsmanship" } as CharacterEntryRaw, Kestrel: { archetype: "caster", weights: {}, floors: {}, medOnly: true } },
  archetypes: { melee: { weights: { hci: 10, dci: 10 }, floors: { physResist: 65 } }, caster: { weights: { fc: 60 }, floors: { lrc: 100 } } },
};
test("[smoke] migrateProfiles: archetypes become templates with defaulted fields, characters gain template from their archetype", () => {
  const { profiles, changed } = migrateProfiles(OLD_PROFILES);
  assert.equal(changed, true);
  assert.ok(!("archetypes" in profiles));
  assert.deepEqual(Object.keys(profiles.templates!), ["melee", "caster"]);
  assert.deepEqual(profiles.templates!.melee!.weights, { hci: 10, dci: 10 });
  assert.deepEqual(profiles.templates!.melee!.floors, { physResist: 65 });
  assert.deepEqual(Object.keys(profiles.templates!.melee!).sort(), [...TEMPLATE_KEYS].sort());
  assert.deepEqual(profiles.templates!.caster!.lockedSlots, []);
  assert.equal(profiles.templates!.caster!.medOnly, false);
  assert.equal(profiles.characters!.Dorran!.template, "melee");
  assert.equal(profiles.characters!.Kestrel!.template, "caster");
  assert.ok(!("archetype" in profiles.characters!.Dorran!));
  assert.deepEqual(profiles.characters!.Dorran!.excludeWeapons, OTHERS("swordsmanship"), "the character's own weapon choice survives as the exclusions it means");
  assert.ok(!("weaponSkill" in profiles.characters!.Dorran!));
  assert.ok(!("excludeWeapons" in profiles.characters!.Kestrel!), "a character that never chose keeps its shape");
  assert.ok(!("caps" in profiles), "caps moved out of profiles.json into the shard's rules file (schemaVersion 2)");
  assert.equal(profiles.schemaVersion, 2);
  assert.equal(OLD_PROFILES.characters!.Dorran!.archetype, "melee", "pure: the input is untouched");
});

test("[fast] migrateProfiles: a v2 file's single weapon choices become exclusion lists, once", () => {
  const v2 = { schemaVersion: 2, characters: { Kestrel: { template: "caster", weaponSkill: null } },
    templates: { melee: { weights: { hci: 10 }, weaponSkill: "swordsmanship" } } } as unknown as ProfilesFile;
  const { profiles, changed } = migrateProfiles(v2);
  assert.equal(changed, true);
  assert.deepEqual(profiles.characters!.Kestrel, { template: "caster", excludeWeapons: [] }, "null was any weapon");
  assert.deepEqual(profiles.templates!.melee, { weights: { hci: 10 }, excludeWeapons: OTHERS("swordsmanship") });
  assert.equal(migrateProfiles(profiles).changed, false, "idempotent");
  const shipped = JSON.parse(readFileSync(join(HERE, "data", "profiles.default.json"), "utf8")) as ProfilesFile;
  assert.equal(migrateProfiles(shipped).changed, false, "the shipped defaults are already in the new shape");
});

test("[fast] migrateProfiles is idempotent on the new shape", () => {
  const once = migrateProfiles(OLD_PROFILES).profiles;
  const again = migrateProfiles(once);
  assert.equal(again.changed, false);
  assert.deepEqual(again.profiles, once);
  const keep = migrateProfiles({ templates: { t: templateFrom({}) }, characters: { A: { template: "t", archetype: "melee", floors: {} } } });
  assert.equal(keep.profiles.characters!.A!.template, "t", "an existing template name wins over a leftover archetype");
  assert.ok(!("archetype" in keep.profiles.characters!.A!));
});
test("[fast] profiles: migrateProfiles stamps schemaVersion 2 and drops a v1 caps object", () => {
  assert.equal(migrateProfiles({ characters: {}, templates: {} }).profiles.schemaVersion, 2);
  const { profiles, changed } = migrateProfiles({ schemaVersion: 1, caps: { hci: 45 }, characters: {}, templates: {} });
  assert.equal(changed, true);
  assert.ok(!("caps" in profiles));
  assert.equal(profiles.schemaVersion, 2);
  const again = migrateProfiles(profiles);
  assert.equal(again.changed, false, "a v2 file with no caps is left alone");
});

test("[fast] templateFrom snapshots the builder settings without race, STR limit or skipped containers", () => {
  const t = templateFrom({ floors: { hci: 45 }, weights: { di: 6 }, softFloors: ["hci"], lockedSlots: ["twoHanded"], excludeTags: ["cursed"], excludeSkills: ["necromancy"],
    allowOthersWorn: true, allowGargoyle: false, medOnly: true, excludeWeapons: ["throwing"], race: "elf", strLimit: 95, excludeRoots: [123], template: "archer", floorBonus: 500 } as never);
  assert.deepEqual(Object.keys(t).sort(), [...TEMPLATE_KEYS].sort());
  assert.ok(!("race" in t) && !("strLimit" in t) && !("excludeRoots" in t) && !("template" in t));
  assert.deepEqual(t.excludeWeapons, ["throwing"]);
  assert.equal(t.floorBonus, 500);
  assert.equal(t.allowOthersWorn, true);
  assert.deepEqual(templateFrom({}).excludeTags, []);
  assert.deepEqual(templateFrom({}).excludeWeapons, []);
});

test("[fast] template drift: settingsDiff between a template and a profile ignores race and STR, names real changes", () => {
  const tpl = templateFrom({ floors: { hci: 45 }, weights: { di: 6 }, lockedSlots: ["twoHanded"], excludeWeapons: OTHERS("archery") });
  const same = { ...tpl, race: "elf", strLimit: 95, excludeRoots: [1], template: "archer" };
  assert.deepEqual(settingsDiff(tpl, templateFrom(same)), []);
  const drift = settingsDiff(tpl, templateFrom({ ...same, floors: { hci: 40 }, allowOthersWorn: true, medOnly: true, lockedSlots: [] }));
  assert.ok(drift.includes(`${PROP_LABELS.hci} floor 45 → 40`), JSON.stringify(drift));
  assert.ok(drift.includes("others' worn gear allowed"));
  assert.ok(drift.includes("meditation-safe only"));
  assert.ok(drift.some((x) => x.startsWith("unlocked ")));
});

test("[fast] effectiveProfile: resist floors and caps are paperdoll values, unshifted by Resisting Spells, which sets each resist's minimum; an Elf's energy cap is 75 (uoalive rules)", () => {
  const e = effectiveProfile({ floors: { physResist: 70, energyResist: 75, hci: 40 }, softFloors: ["hci"], weights: { hci: 1 }, race: "elf" }, { skills: { "Resisting Spells": { value: 100 } } } as never);
  assert.equal(e.resistMinimum, 40);
  assert.deepEqual(e.mins, { physResist: 40, fireResist: 40, coldResist: 40, poisonResist: 40, energyResist: 40 });
  assert.equal(e.caps.physResist, 70); assert.equal(e.caps.energyResist, 75);
  assert.equal(e.floors.physResist, 70); assert.equal(e.floors.energyResist, 75); assert.equal(e.floors.hci, 40);
  assert.deepEqual(e.hardFloors.sort(), ["energyResist", "physResist"]);
  const h = effectiveProfile({ floors: { energyResist: 75 } }, null);
  assert.equal(h.caps.energyResist, 70); assert.equal(h.floors.energyResist, 70, "a human's energy floor is clamped to the 70 cap");
  assert.equal(h.resistMinimum, null, "no character, no minimum");
  assert.ok(!("mins" in h));
  assert.ok(settingsDiff({ race: "human" }, { race: "elf", excludeSkills: ["necromancy"] }).includes("race human → elf"));
});

// Issue #261: Resisting Spells is a minimum under each resist (ServUO PlayerMobile.GetMinResistance), not a bonus on
// top of gear. The wiki's table agrees with the formula everywhere but 44.5, where it says 5 and the formula gives 3.
test("[fast] the Resisting Spells minimum: the ServUO formula against the shard wiki's table", () => {
  const at = (v: number): number | null => resistMinimum({ "Resisting Spells": { value: v } });
  for (const [v, m] of [[40, 0], [55, 10], [70, 20], [85, 30], [100, 40], [110, 42], [120, 44]] as const) assert.equal(at(v), m, `skill ${v}`);
  assert.equal(at(44.5), 3, "(445 − 400) / 15, integer division; the wiki's table says 5");
  assert.equal(at(39.9), null, "below 40 nothing holds a resist up, not even at 0");
  assert.equal(at(0), null);
  assert.equal(resistMinimum(undefined), null);
  assert.equal(at(50), 6);
  assert.equal(at(52.3), 8, "a value in tenths: 523, not 522.99…");
  assert.equal(minResistAt(104.9), 40); assert.equal(minResistAt(105), 41);
  // paperdoll = max(min(total, cap), minimum)
  assert.equal(paperdollResist(30, 70, 40), 40, "the minimum wins over gear 30");
  assert.equal(paperdollResist(45, 70, 40), 45, "gear 45 wins over the minimum");
  assert.equal(paperdollResist(80, 70, 40), 70, "capped");
  assert.equal(paperdollResist(-15, 70, 0), 0, "a negative total held at 0 from skill 40");
  assert.equal(paperdollResist(-15, 70, null), -15);
  assert.equal(paperdollResist(50, 30, 40), 40, "a cap under the minimum: the minimum");
  // the scan from the issue: Resisting Spells 50 (a minimum of 6), worn items 56 / 57 / 51 / 68 / 63, and the paperdoll the same
  const items = [56, 57, 51, 68, 63];
  assert.deepEqual(items.map((t) => paperdollResist(t, 70, at(50))), items);
  // a requirement at or under the minimum is met with no gear on that resist
  const [row] = requirementReport({ fireResist: 0 }, { floors: { fireResist: 40 }, mins: { fireResist: 40 } });
  assert.equal(row!.met, true);
  assert.equal(requirementReport({ fireResist: 39 }, { floors: { fireResist: 41 }, mins: { fireResist: 40 } })[0]!.met, false);
});

// Issue #265: a suit's own Resisting Spells bonus lifts the minimum, up to the skill's cap (ServUO Skill.Value: an item
// bonus obeys the cap, Protection's loss comes off first and ignores it), and the solvers read it as steps.
test("[fast] the Resisting Spells minimum in a suit: the bonus up to the cap, Protection first, and the steps the solvers read", () => {
  const rs = (value: number, cap?: number): Record<string, unknown> => ({ "Resisting Spells": { base: value, value, ...(cap != null ? { cap } : {}) } });
  assert.equal(skillInSuit(90, 15, 100), 100, "the bonus stops at the cap");
  assert.equal(skillInSuit(100, 15, 100), 100, "and adds nothing to a skill at its cap");
  assert.equal(skillInSuit(100, 15, 100, -25), 90, "Protection's −25 first (75), then the bonus up to the cap");
  assert.equal(skillInSuit(100, 30, null), 120, "no cap known: SKILL_CAP_TOP");
  assert.equal(skillInSuit(30, 5, 100, -35), 5, "a loss past 0 stops at 0");
  assert.equal(resistMinimum(rs(99.9, 120), 0.1), 40, "99.9 + 0.1: fixed 1000");
  assert.equal(resistMinimum(rs(99.9, 120)), 39, "99.9: (999 − 400) / 15");
  assert.equal(resistMinimum(rs(100, 100), 15), 40, "at its cap the bonus does nothing");
  assert.equal(resistMinimum(rs(95, 100), 15), 40, "95 + 15 stops at 100");
  assert.equal(resistMinimum(rs(39, 100), 1), 0, "a bonus can bring a minimum where there was none");
  assert.equal(minimumWith({ skill: 100, bonus: 15, cap: 100 }, ["protection"], { Inscription: 0 }), 26, "Protection −35 (65), +15 (80): (800 − 400) / 15");
  // the steps: the least bonus, in tenths, for each higher minimum, until the skill reaches its cap
  const steps = resistStepsFor(99.9, 120, 0, () => 0);
  assert.deepEqual(steps.slice(0, 2), [{ at: 0.1, mins: Object.fromEntries(RESIST_KEYS.map((k) => [k, 40])) }, { at: 5.1, mins: Object.fromEntries(RESIST_KEYS.map((k) => [k, 41])) }]);
  assert.deepEqual(steps.map((s) => s.mins.fireResist), [40, 41, 42, 43, 44], "up to 120: 44");
  assert.equal(steps.at(-1)!.at, 20.1);
  assert.deepEqual(resistStepsFor(100, 100, 0, () => 0), [], "a skill at its cap: no step");
  assert.deepEqual(resistStepsFor(38, 100, 0, () => 0)[0]!.at, 2, "from no minimum: 40 needs +2");
  assert.deepEqual(resistStepsFor(100, 100, -25, (k) => (k === "physResist" ? 15 : 0)).map((s) => [s.at, s.mins.physResist, s.mins.fireResist]).slice(0, 2), [[1, 9, 24], [2.5, 10, 25]], "with Protection's −25: from 75 (a minimum of 23), a resist's share off each");
  // a suit's min: the highest step its bonus reaches (less the 0.05 slack), else the profile's own
  const prof = { mins: { fireResist: 39 }, resistSteps: steps };
  assert.deepEqual([0, 0.04, 0.1, 5, 5.1, 40].map((b) => liftedMin(prof, "fireResist", b)), [39, 39, 40, 40, 41, 44]);
  assert.equal(liftedMin({ resistSteps: resistStepsFor(38, 100, 0, () => 0) }, "fireResist", 1), null, "under the first step with no minimum of its own: none");
  // requirementReport reads a resist at the suit's own min
  assert.equal(requirementReport({ fireResist: 20, [RESIST_SKILL_KEY]: 0.1 }, { floors: { fireResist: 40 }, ...prof })[0]!.met, true);
  assert.equal(requirementReport({ fireResist: 20 }, { floors: { fireResist: 40 }, ...prof })[0]!.met, false);
  // effectiveProfile carries the steps for the character's skill and cap
  assert.deepEqual(effectiveProfile({}, { skills: rs(99.9, 120) } as never).resistSteps, steps);
  assert.equal(effectiveProfile({}, { skills: rs(100, 100) } as never).resistSteps, undefined, "none at the cap");
  assert.equal(effectiveProfile({}, null).resistSteps, undefined);
});

test("[fast] resist cap overrides: effectiveProfile values a resist up to the player's cap, paperdoll terms, and a floor counts up to it", () => {
  const skills = { skills: { "Resisting Spells": { value: 41.5 } } } as never;   // a minimum of 1
  const e = effectiveProfile({ floors: { fireResist: 90, coldResist: 90 }, resistCaps: { fireResist: 95 } }, skills);
  assert.equal(e.caps.fireResist, 95, "95 on the paperdoll");
  assert.equal(e.caps.coldResist, 70, "an untouched resist keeps the shard's 70");
  assert.equal(e.floors.fireResist, 90, "a Fire floor of 90 is no longer clamped to 70");
  assert.equal(e.floors.coldResist, 70, "Cold's floor still is");
  assert.deepEqual(e.resistCapOverrides, { fireResist: { cap: 95, shard: 70 } });
  assert.deepEqual(profileResistCaps(e).fireResist, { cap: 95, shard: 70 });
  assert.deepEqual(profileResistCaps(e).coldResist, { cap: 70, shard: 70 });
  const lowered = effectiveProfile({ resistCaps: { physResist: 50 } }, null);
  assert.equal(lowered.caps.physResist, 50);
  assert.deepEqual(lowered.resistCapOverrides, { physResist: { cap: 50, shard: 70 } });
  // No override, or one equal to the shard's cap for the race: the effective profile is exactly what it was
  // before overrides existed (no resistCapOverrides key), so its run key, and every saved run, still match.
  const plain = effectiveProfile({ floors: { fireResist: 60 }, race: "elf" }, skills);
  assert.ok(!("resistCapOverrides" in plain));
  assert.deepEqual(effectiveProfile({ floors: { fireResist: 60 }, race: "elf", resistCaps: { energyResist: 75 } }, skills), plain, "an Elf's Energy 75 is the shard's own cap");
  assert.equal(effectiveProfile({ race: "human", resistCaps: { energyResist: 75 } }, null).resistCapOverrides!.energyResist!.shard, 70, "but raises a human's");
  assert.equal(effectiveProfile({ resistCaps: { fireResist: Number.NaN } }, null).caps.fireResist, 70, "a value that is not a number is ignored");
  assert.equal(shardResistCap("energyResist", "elf"), 75);
  assert.equal(shardResistCap("energyResist", null), 70);
  assert.deepEqual(resistCapsFor("elf", { fireResist: 95 }).energyResist, { cap: 75, shard: 75 });
});

test("[fast] resist cap overrides: resistCapsError holds the five resist keys to whole numbers 0-150; templates and settingsDiff carry them", () => {
  assert.equal(resistCapsError(undefined), null);
  assert.equal(resistCapsError({ fireResist: 95, coldResist: 0, physResist: 150 }), null);
  assert.equal(resistCapsError([95]), "resistCaps must be an object");
  assert.equal(resistCapsError({ hci: 5 }), "resistCaps.hci is not a resist");
  assert.equal(resistCapsError({ fireResist: 95.5 }, "x"), "x.fireResist must be a whole number from 0 to 150");
  assert.match(resistCapsError({ fireResist: 151 })!, /from 0 to 150/);
  assert.match(resistCapsError({ fireResist: -1 })!, /from 0 to 150/);
  assert.match(resistCapsError({ fireResist: "95" })!, /whole number/);
  assert.deepEqual(RESIST_CAP_LIMITS, { min: 0, max: 150 });
  const t = templateFrom({ resistCaps: { fireResist: 95 } });
  assert.deepEqual(t.resistCaps, { fireResist: 95 });
  assert.deepEqual(templateFrom({}).resistCaps, {}, "an old template without overrides loads with none");
  assert.deepEqual(settingsDiff({}, { resistCaps: { fireResist: 95 } }), [`${PROP_LABELS.fireResist} cap set to 95`]);
  assert.deepEqual(settingsDiff({ resistCaps: { fireResist: 95 } }, { resistCaps: { fireResist: 90 } }), [`${PROP_LABELS.fireResist} cap 95 → 90`]);
  assert.deepEqual(settingsDiff({ resistCaps: { fireResist: 95 } }, {}), [`${PROP_LABELS.fireResist} cap back to the shard's`]);
  assert.deepEqual(settingsDiff({ resistCaps: {} }, {}), [], "no overrides on either side is no change");
});

test("[fast] getRules()/setRules() and resistMinimum() are shard-swappable: a rules file without resistMinimum gives none", () => {
  const uoalive = getRules();
  try {
    assert.throws(() => { setRules(null as unknown as RulesV1); getRules(); }, /rules not loaded/);
    const genericOsi = JSON.parse(readFileSync(join(HERE, "rules", "generic-osi.json"), "utf8")) as RulesV1;
    setRules(genericOsi);
    assert.equal(resistMinimum({ "Resisting Spells": { value: 120 } }), 44, "generic-osi has the stock minimum");
    assert.ok(!("massive" in tagUnits()));
    const { resistMinimum: _none, ...noMinimum } = genericOsi;
    setRules(noMinimum);
    assert.equal(resistMinimum({ "Resisting Spells": { value: 120 } }), null);
    assert.ok(!("mins" in effectiveProfile({}, { skills: { "Resisting Spells": { value: 120 } } } as never)));
    setRules(genericOsi);
    const eGeneric = effectiveProfile({ race: "elf", floors: { energyResist: 75 } }, null);
    assert.equal(eGeneric.caps.energyResist, 75, "raceCaps.elf.energyResist is the same 75 on generic-osi");
  } finally {
    setRules(uoalive);   // restore for every test after this one in the file, even if an assertion above throws
  }
});

// Tooltip lines are matched lower-cased, so a rules file that writes a tag unit's key as "Cursed"
// must still match the "Cursed" tooltip line.
test("[fast] tag-unit keys match whatever case the rules file wrote them in", () => {
  const uoalive = getRules();
  try {
    setRules({ ...uoalive, tagUnits: { Cursed: 10, BRITTLE: 4 } });
    const p = parseTooltip(["Ring", "Cursed", "Brittle"]);
    assert.deepEqual(p.tags, ["cursed", "brittle"]);
    assert.equal(p.props.tagPenalty, 14);
    assert.deepEqual(tagUnits(), { cursed: 10, brittle: 4 });
  } finally {
    setRules(uoalive);
  }
});

test("[fast] a rarity line is one of the shard's rarity ladder names, optionally Reforged", () => {
  const uoalive = getRules();
  try {
    assert.equal(parseTooltip(["Ring", "Reforged Lesser Artifact"]).rarity, "Reforged Lesser Artifact");
    setRules({ ...uoalive, rarity: [{ name: "Mythic Relic", colour: "#123456" }] });
    assert.equal(parseTooltip(["Ring", "<BASEFONT COLOR=#123456>Mythic Relic"]).rarity, "Mythic Relic");
    assert.equal(parseTooltip(["Ring", "Lesser Artifact"]).rarity, null);   // not on this shard's ladder
  } finally {
    setRules(uoalive);
  }
});

// A tag's plain-words meaning comes from the shard's rules file too (the peek shows it on hover); a shard
// that writes none, or none for that tag, gives no description rather than a made-up one.
test("[fast] tagInfo reads a tag's meaning from the shard's rules, in any case, and is empty without one", () => {
  const uoalive = getRules();
  try {
    assert.match(tagInfo("Antique") || "", /Powder of Fortifying/);
    for (const t of Object.keys(tagUnits())) assert.ok(tagInfo(t), `UO Alive describes ${t}`);
    setRules({ ...uoalive, tagInfo: { CURSED: "Drops on death." } });
    assert.equal(tagInfo("cursed"), "Drops on death.");
    assert.equal(tagInfo("brittle"), null);
    const { tagInfo: _, ...none } = uoalive;
    setRules(none as RulesV1);
    assert.equal(tagInfo("cursed"), null);
  } finally {
    setRules(uoalive);
  }
});

test("[fast] pool items carry stamina/mana/hits pools and skill bonuses; forbidden skill bonuses are left out, even when worn", () => {
  const it = { serial: 9, name: "x", slot: "ring", gear: true, props: { dexBonus: 5, stamInc: 3, intBonus: 2, strBonus: 4, hpi: 2 }, extras: { magery: 10, necromancy: 5, durability: [1, 1] as [number, number] },
    tags: [] as string[], strReq: 0, root: 1, equippedBy: null as string | null, gargoyle: false, medable: true } as unknown as Item;
  const o = toOptItem(it);
  assert.equal(o.props.stamPool, 8); assert.equal(o.props.manaPool, 2); assert.equal(o.props.hitsPool, 4);
  assert.equal(o.props["sk:magery"], 10); assert.equal(o.props["sk:necromancy"], 5); assert.equal(o.props["sk:durability"], undefined);
  // buildPools/builderKeys only read inv.items (see their own bodies) — a partial Inventory fixture
  // cast at the call site, same idiom as toOptItem's above.
  const inv = { items: { 9: it, 10: { ...it, serial: 10, extras: { magery: 5 } } } } as unknown as Inventory;
  const pb = buildPools(inv, "Kestrel", { excludeSkills: ["necromancy", "spirit speak"] });
  assert.deepEqual(pb.pools.ring!.map((i) => i.serial), [10]);
  assert.equal(pb.skipped.skill.length, 1);
  assert.deepEqual(buildPools({ items: { 9: { ...it, equippedBy: "Kestrel", root: null } } } as unknown as Inventory, "Kestrel", { excludeSkills: ["necromancy"] }).blocked, ["ring"]);
  assert.equal(labelOf("sk:evaluate intelligence"), "+Evaluate Intelligence");
  assert.ok(builderKeys(inv).includes("sk:magery") && builderKeys(inv).includes("stamPool"));
});

test("[fast] saved runs: the key ignores budget and warm start; a run is reused only when rerunning could not do better", () => {
  const base = { pools: { ring: [{ serial: 1, name: "r", slot: "ring", props: { hci: 5 } }] }, current: {}, profile: { weights: { hci: 1 }, caps: {} }, opts: { restarts: 200, exact: true, timeBudgetMs: 300000 } };
  const k = runKey(base);
  assert.equal(runKey({ ...base, opts: { ...base.opts, timeBudgetMs: 5000, warmStart: { ring: 1 } } }), k);
  assert.notEqual(runKey({ ...base, profile: { ...base.profile, floors: { hci: 5 } } }), k);
  assert.notEqual(runKey({ ...base, opts: { ...base.opts, exact: false } }), k);
  const proven: SavedRun = { key: k, budgetMs: 1000, result: { method: "exact", proven: true } };
  const unproven: SavedRun = { key: k, budgetMs: 60000, result: { method: "exact", proven: false } };
  assert.equal(reusableRun([proven], k, { timeBudgetMs: 300000 }), proven);
  assert.equal(reusableRun([unproven], k, { timeBudgetMs: 300000 }), null, "a bigger budget could finish the proof");
  assert.equal(reusableRun([unproven], k, { timeBudgetMs: 30000 }), unproven);
  assert.equal(reusableRun([{ key: k, result: { method: "heuristic" } }], k, {})!.result!.method, "heuristic");
  assert.equal(reusableRun([proven], "other", {}), null);
  assert.equal(runSummary({ id: "x", result: { method: "exact", proven: true, score: 3 } }).score, 3);
});
test("[fast] saved runs: the list summary carries the change count and the suit's totals for the drawer's badges", () => {
  const s = runSummary({ id: "x", result: { method: "exact", perSlotChanges: [{ slot: "ring" }, { slot: "cloak" }], totals: { before: { physResist: 3 }, after: { physResist: 29, luck: 10 } } } });
  assert.equal(s.changes, 2);
  assert.deepEqual(s.totalsAfter, { physResist: 29, luck: 10 });
  const bare = runSummary({ id: "y", result: {} });
  assert.equal(bare.changes, null, "an old run without perSlotChanges says nothing rather than 0 changes");
  assert.equal(bare.totalsAfter, null);
});
// Regression (review I2): the solver's fallbacks (HiGHS failed to load, the floors-conflict retry ran
// out of time) come back as method "heuristic", which the reuse rule used to treat as a deterministic
// heuristic run and serve forever, whatever budget was asked for or whether HiGHS works again.
test("[fast] saved runs: a solver fallback is never reused, at any budget", () => {
  const k = "key";
  const unavailable: SavedRun = { key: k, budgetMs: 300000, result: { method: "heuristic", solver: "fallback", fallbackReason: "HiGHS unavailable" } };
  const conflict: SavedRun = { key: k, budgetMs: 300000, result: { method: "heuristic", solver: "fallback", floorsConflict: true } };
  assert.equal(reusableRun([unavailable], k, { timeBudgetMs: 1000 }), null);
  assert.equal(reusableRun([conflict], k, { timeBudgetMs: 1000 }), null);
  assert.equal(reusableRun([conflict, { key: k, result: { method: "exact", proven: true, solver: "highs" } }], k, {})!.result!.proven, true, "an older proven run with the same key still answers");
});

// Regression (review I3): the key had no solver version, so a suit a since-fixed model wrongly
// proved optimal kept being served as "proven" from disk. The version is part of the hash now.
test("[fast] saved runs: the key carries the solver version, so runs saved before a model fix no longer match", () => {
  const input = { pools: {}, current: {}, profile: { weights: { hci: 1 } }, opts: { exact: true } };
  const unversioned = createHash("sha1").update(JSON.stringify(input)).digest("hex");
  assert.notEqual(runKey(input), unversioned);
});
// Issue #28: a run saved before the soft-floor fix (PROOF_SOUND_SINCE) may have proved a worse suit optimal, so
// its claim is withdrawn — no verdict at all, not relabelled "best within budget".
test("[fast] runs: the runs migration withdraws the proof of a run saved before the soft-floor fix", () => {
  const old = normalizeRun({ id: "o", result: { method: "exact", proven: true } });
  assert.equal(old.result!.proven, undefined);
  assert.equal(runSummary(old).proven, null);
  assert.deepEqual(normalizeRun(old), old, "idempotent");
  assert.equal(normalizeRun({ id: "n", solverVersion: SOLVER_VERSION, result: { method: "exact", proven: true } }).result!.proven, true);
  assert.equal(normalizeRun({ id: "u", result: { method: "exact", proven: false } }).result!.proven, false, "an unproven run keeps its verdict");
});
test("[fast] runs: suitPieces is every piece of every saved suit, empty slots and runs with no result skipped (issue #133)", () => {
  const runs: SavedRun[] = [{ id: "a", result: { best: { ring: { serial: 1 }, arms: null, chest: { serial: 2 } } } }, { id: "b", result: { best: { ring: { serial: 1 }, legs: { serial: 3 } } } }, { id: "c" }, { id: "d", result: {} }];
  assert.deepEqual([...suitPieces(runs)].sort(), [1, 2, 3]);
});
test("[fast] runs: the runs migration upgrades allowOthers/budgetS and stamps schemaVersion", () => {
  const r = normalizeRun({ id: "x", settings: { allowOthers: true, budgetS: 30 }, result: {} });
  assert.equal(r.schemaVersion, 1);
  assert.equal(r.settings!.allowOthersWorn, true);
  assert.equal("allowOthers" in r.settings!, false);
  assert.equal(r.settings!.budgetMs, 30000);
  assert.equal("budgetS" in r.settings!, false);
  assert.deepEqual(normalizeRun(r), r);   // idempotent
});
test("[fast] runs: the runs migration turns a run's single weapon choice into the exclusions it was built with", () => {
  const r = normalizeRun({ id: "w", settings: { weaponSkill: "archery", allowOthers: true }, result: {} });
  assert.deepEqual(r.settings!.excludeWeapons, OTHERS("archery"));
  assert.equal("weaponSkill" in r.settings!, false);
  assert.deepEqual(normalizeRun(r), r, "idempotent");
});
test("[fast] settingsDiff: budgets compare in ms and print seconds", () => {
  const d = settingsDiff({ budgetMs: 30000, exact: true }, { budgetMs: 60000, exact: true });
  assert.ok(d.some((l) => l === "budget 30 s → 60 s"), d.join("|"));
});
test("[fast] runs: the runs migration is applied wherever runs are read, so schemaVersion and allowOthersWorn reach the list endpoint", () => {
  const old: SavedRun = { id: "y", character: "Dorran", result: { method: "exact", proven: true }, settings: { allowOthers: false, budgetS: 45 } };
  const s = runSummary(normalizeRun(old));
  assert.equal(s.schemaVersion, 1);
  assert.equal(s.settings.allowOthersWorn, false);
  assert.equal(s.settings.budgetMs, 45000);
});
test("[fast] fold: a nested container folds whether the scanner said kind \"bag\" (old) or \"container\" (new)", () => {
  const mk = (kind: string): ScanV2 => upgradeScan({ version: 1, character: "Dorran", scannedAt: "2026-09-13T00:00:00",
    equipped: [], roots: [{ serial: 10, kind: "backpack", name: "Backpack" }],
    containers: { 10: { serial: 10, root: 10, parent: null, kind: "backpack", name: "Backpack" },
      11: { serial: 11, root: 10, parent: 10, kind, name: "Pouch" } },
    items: [] }, { shard: "test" }) as ScanV2;   // known-good fixture: the cast stands in for the validateScan() a real caller runs
  for (const kind of ["bag", "container"]) {
    const inv = foldSnapshots([mk(kind)]);
    assert.equal(inv.items[11]!.kind, "container", `kind "${kind}" should still fold to a container item`);
  }
});

// ---- optimizer through the same loader the server uses -------------------------------------
// No build step — corePath() resolves straight to scripts/optimizer-core.mts, so this file also runs
// standalone (`node --test app/gear-vault.test.mts`) with no npm `pretest` hook needed first.
const core = (await import(pathToFileURL(corePath()).href)) as typeof Core;
// optimizer-core.mts's OptProgress isn't itself exported (see its own header: no top-level exports
// but the final `export { ... }` of functions — this file is meant to be pasted inline into a game
// script), so it's derived the same way app/exact-solver.mts derives OptOptions: off the one exported
// function's own signature.
type OptProgress = Parameters<NonNullable<NonNullable<Parameters<typeof Core.optimizeSuit>[3]>["onProgress"]>>[0];
const demoInv = foldSnapshots([kestrel, dorran]);
const builtinTemplates = (JSON.parse(readFileSync(join(HERE, "data", "templates", "uoalive.json"), "utf8")) as { templates: TemplateMap }).templates;
// Any real profile shape will do here (weights/floors/caps to score item sets) — use the archer
// template so it roughly matches Kestrel's build. caps come from the shard's rules file.
const archerProfile: OptProfile = { ...templateSettings(builtinTemplates.archer!), caps: getRules().caps as Record<string, number> };
const { pools: demoPools, current: demoCurrent } = buildPools(demoInv, "Kestrel", { strength: 66 });
const res = core.optimizeSuit(demoPools as unknown as OptPools, demoCurrent as unknown as OptAssignment, archerProfile, { seed: 1, restarts: 20 });

// A self-contained deterministic PRNG factory so each [slow] test below generates its own
// independent random-suit sequence, whatever order or concurrency node:test runs them in.
interface RandomSuitItem { serial: number; name: string; slot: string; props: Record<string, number>; twoHanded?: boolean; }
interface RandomSuitCase {
  rp: Record<string, RandomSuitItem[]>;
  pr: OptProfile;
  optional: string[];
  brute: number;
  scores: number[];
  SL: string[];
}
function createRandomSuit(): () => RandomSuitCase {
  let sd = 12345;
  const rnd = (): number => { sd = (sd * 1103515245 + 12345) & 0x7fffffff; return sd / 0x7fffffff; };
  const pickInt = (a: number, b: number): number => a + Math.floor(rnd() * (b - a + 1));
  const PROPS = ["physResist", "fireResist", "hci", "dci", "ssi", "di", "lmc"];
  const SL = ["helmet", "chest", "ring", "neck", "oneHanded", "twoHanded"];
  return function randomSuit(): RandomSuitCase {
    let serial = 1;
    const rp: Record<string, RandomSuitItem[]> = {};
    for (const slot of SL) {
      rp[slot] = [];
      for (let j = 0, m = pickInt(1, 4); j < m; j++) {
        const props: Record<string, number> = {};
        for (const k of PROPS) if (rnd() < 0.45) props[k] = pickInt(1, 30);
        if (rnd() < 0.2) props.tagPenalty = pickInt(1, 2);
        const it: RandomSuitItem = { serial: serial++, name: `${slot}-${j}`, slot, props };
        if (slot === "twoHanded" && rnd() < 0.4) it.twoHanded = true;
        rp[slot]!.push(it);
      }
    }
    const weights: Record<string, number> = {}, caps: Record<string, number> = {}, floors: Record<string, number> = {};
    for (const k of PROPS) { weights[k] = rnd() < 0.15 ? 0 : pickInt(1, 12); if (rnd() < 0.6) caps[k] = pickInt(10, 60); }
    weights.tagPenalty = -pickInt(5, 40);
    for (const k of PROPS) if (rnd() < 0.3) floors[k] = pickInt(5, 50);
    const pr: OptProfile = { weights, caps, floors, floorBonus: pickInt(50, 2000), hardFloors: Object.keys(floors).filter(() => rnd() < 0.5) };
    const optional = SL.filter(() => rnd() < 0.6);
    const lists = SL.map((sl) => [null, ...rp[sl]!]);
    let brute = -Infinity;
    const scores: number[] = [];
    const walk = (k: number, a: Record<string, RandomSuitItem | null>): void => {
      if (k === SL.length) { if (a.twoHanded && a.twoHanded.twoHanded && a.oneHanded) return; const sc = core.scoreSet(a as unknown as OptAssignment, pr); scores.push(sc); if (sc > brute) brute = sc; return; }
      for (const it of lists[k]!) walk(k + 1, { ...a, [SL[k]!]: it });
    };
    walk(0, {});
    return { rp, pr, optional, brute, scores, SL };
  };
}

test("[fast] optimizer core loads and improves a demo suit", () => {
  assert.ok(res.score >= res.currentScore, "best is at least current");
  assert.ok(Object.keys(res.best).length >= 10);
  const t = totalsOf(res.best as unknown as Parameters<typeof totalsOf>[0]);
  assert.ok(t.physResist as number > 0);
});

test("[slow] exact search matches brute force and proves optimality", { skip: SKIP_SLOW }, (t) => {
  const mk = (slot: string, i: number, props: Record<string, number>, two?: boolean): RandomSuitItem => ({ serial: slot.length * 100 + i, name: `${slot}-${i}`, slot, props, ...(two ? { twoHanded: true } : {}) });
  const small: Record<string, RandomSuitItem[]> = {
    helmet: [mk("helmet", 1, { physResist: 10, hci: 5 }), mk("helmet", 2, { physResist: 4, dci: 12 }), mk("helmet", 3, { hci: 15, tagPenalty: 4 })],
    chest: [mk("chest", 1, { physResist: 20 }), mk("chest", 2, { physResist: 12, dci: 10, hci: 3 }), mk("chest", 3, { dci: 20 })],
    ring: [mk("ring", 1, { hci: 12, dci: 12 }), mk("ring", 2, { physResist: 8, hci: 20 }), mk("ring", 3, { dci: 25 })],
    oneHanded: [mk("oneHanded", 1, { hci: 10 }), mk("oneHanded", 2, { dci: 8, physResist: 5 })],
    twoHanded: [mk("twoHanded", 1, { physResist: 10, dci: 5 }), mk("twoHanded", 2, { hci: 25, dci: 15 }, true)],
  };
  const slots = ["helmet", "chest", "ring", "oneHanded", "twoHanded"];
  const prof: OptProfile = { weights: { physResist: 3, hci: 4, dci: 4, tagPenalty: -25 }, caps: { physResist: 30, hci: 45, dci: 45 }, floors: { physResist: 25 }, floorBonus: 100 };
  // brute force over every combination (nulls allowed everywhere)
  let bruteBest = -Infinity;
  const lists = slots.map((s) => [null, ...small[s]!]);
  const walk = (k: number, a: Record<string, RandomSuitItem | null>): void => {
    if (k === slots.length) {
      if (a.twoHanded && a.twoHanded.twoHanded && a.oneHanded) return;
      const sc = core.scoreSet(a as unknown as OptAssignment, prof); if (sc > bruteBest) bruteBest = sc; return;
    }
    for (const it of lists[k]!) walk(k + 1, { ...a, [slots[k]!]: it });
  };
  walk(0, {});
  const ex = core.optimizeSuit(small as unknown as OptPools, {} as OptAssignment, prof, { seed: 1, restarts: 3, slots, optionalSlots: slots, exact: true, timeBudgetMs: 5000 });
  assert.equal(ex.method, "exact"); assert.equal(ex.proven, true);
  // hard floors: with physResist hard, the optimum must meet 25 phys whenever any suit can
  const hard = core.optimizeSuit(small as unknown as OptPools, {} as OptAssignment, { ...prof, hardFloors: ["physResist"] }, { seed: 1, restarts: 3, slots, optionalSlots: slots, exact: true, timeBudgetMs: 5000 });
  assert.ok((totalsOf(hard.best as unknown as Parameters<typeof totalsOf>[0]).physResist as number) >= 25, "hard floor met");
  // and a soft floor can be traded: make the weights dwarf the floor bonus and check the floor loses
  const softP: OptProfile = { weights: { hci: 400, dci: 400, physResist: 0.1 }, caps: { hci: 100, dci: 100 }, floors: { physResist: 25 }, floorBonus: 100 };
  const soft = core.optimizeSuit(small as unknown as OptPools, {} as OptAssignment, softP, { seed: 1, restarts: 3, slots, optionalSlots: slots, exact: true, timeBudgetMs: 5000 });
  const hard2 = core.optimizeSuit(small as unknown as OptPools, {} as OptAssignment, { ...softP, hardFloors: ["physResist"] }, { seed: 1, restarts: 3, slots, optionalSlots: slots, exact: true, timeBudgetMs: 5000 });
  assert.ok((totalsOf(hard2.best as unknown as Parameters<typeof totalsOf>[0]).physResist as number) >= 25, "hard floor met even against huge weights");
  assert.ok(soft.score + 1e-6 >= core.scoreSet(hard2.best, softP), "under the soft profile the soft optimum is at least as good as the hard one");
  assert.ok(Math.abs(ex.score - bruteBest) < 1e-6, `exact ${ex.score} vs brute ${bruteBest}`);
  const exPruned = ex.pruned;
  assert.ok(exPruned);
  assert.ok(exPruned.after <= exPruned.before);
  // progress reporting: phases in order, explored fraction monotone and 1 once proven, result unchanged
  const seen: OptProgress[] = [];
  const exP = core.optimizeSuit(small as unknown as OptPools, {} as OptAssignment, prof, { seed: 1, restarts: 3, slots, optionalSlots: slots, exact: true, timeBudgetMs: 5000, progressEveryMs: 0.001, onProgress: (p) => seen.push({ ...p }) });
  assert.equal(exP.score, ex.score, "progress callback does not change the result");
  assert.deepEqual([...new Set(seen.map((p) => p.phase))], ["heuristic", "prune", "exact", "done"]);
  const lastRestarts = seen.filter((p) => p.phase === "heuristic").at(-1);
  assert.ok(lastRestarts);
  assert.equal(lastRestarts.restartsDone, 3); assert.equal(lastRestarts.restarts, 3);
  for (let i = 1; i < seen.length; i++) assert.ok(seen[i]!.explored >= seen[i - 1]!.explored - 1e-12, "explored never goes backwards");
  assert.equal(seen.at(-1)!.explored, 1, "the whole tree is behind a proven search");
  assert.equal(seen.at(-1)!.floorsTotal, 1); assert.equal(seen.at(-1)!.floorsMet, 1);
  assert.ok(seen.at(-1)!.candidates === exPruned.after);
  // and on the demo inventory the exact phase never scores below the heuristic
  const t1 = Date.now();
  const ex2 = core.optimizeSuit(demoPools as unknown as OptPools, demoCurrent as unknown as OptAssignment, archerProfile, { seed: 1, restarts: 20, exact: true, timeBudgetMs: 8000 });
  assert.ok(ex2.score >= res.score - 1e-6, "exact >= heuristic");
  t.diagnostic(`demo: ${ex2.proven ? "proven" : "budget"}, ${ex2.nodes} nodes, ${Date.now() - t1} ms`);
});

test("[slow] exact search proves the brute-force optimum on 150 random suits", { skip: SKIP_SLOW }, () => {
  const randomSuit = createRandomSuit();
  for (let c = 0; c < 150; c++) {
    const { rp, pr, optional, brute, SL } = randomSuit();
    const r = core.optimizeSuit(rp as unknown as OptPools, {} as OptAssignment, pr, { seed: 1, restarts: 0, slots: SL, optionalSlots: optional, exact: true, timeBudgetMs: 10000 });
    assert.ok(r.proven && Math.abs(r.score - brute) < 1e-6, `case ${c}: exact ${r.score} (proven ${r.proven}) vs brute ${brute}`);
  }
});

test("[slow] other suits: exact search lists the next-best scores within the tolerance (brute force)", { skip: SKIP_SLOW }, () => {
  const randomSuit = createRandomSuit();
  for (let c = 0; c < 80; c++) {
    const { rp, pr, optional, brute, scores, SL } = randomSuit();
    const tol = [0, 0, 5, 40][c % 4]!, count = 3;
    const want = scores.slice().sort((x, y) => y - x);
    const expect = want.slice(1).filter((x) => x >= want[0]! - tol - 1e-9).slice(0, count);
    const base = { seed: 1, restarts: 0, slots: SL, optionalSlots: optional };
    const alternatives = { count, tolerance: tol };
    const r = core.optimizeSuit(rp as unknown as OptPools, {} as OptAssignment, pr, { ...base, exact: true, timeBudgetMs: 10000, alternatives });
    assert.ok(Math.abs(r.score - brute) < 1e-6, `case ${c}: best ${r.score} vs brute ${brute}`);
    const got = r.alternatives!.map((a) => a.score);
    assert.equal(got.length, expect.length, `case ${c}: ${JSON.stringify(got)} vs ${JSON.stringify(expect)}`);
    got.forEach((g, i) => assert.ok(Math.abs(g - expect[i]!) < 1e-6, `case ${c} alt ${i}: ${g} vs ${expect[i]}`));
    for (const a of r.alternatives!) assert.ok(Math.abs(core.scoreSet(a.best, pr) - a.score) < 1e-6, "reported score matches the suit");
  }
});

test("[fast] a locked one-handed weapon keeps two-handed weapons out of the suit (heuristic and exact)", () => {
  const sword: RandomSuitItem = { serial: 1, name: "Longsword", slot: "oneHanded", props: { di: 5 } };
  const staff: RandomSuitItem = { serial: 2, name: "Bladed Staff", slot: "twoHanded", twoHanded: true, props: { di: 90, ssi: 40 } };
  const shield: RandomSuitItem = { serial: 3, name: "Buckler", slot: "twoHanded", props: { dci: 2 } };
  const pr: OptProfile = { weights: { di: 1, ssi: 1, dci: 1 }, caps: {} };
  const hands = ["oneHanded", "twoHanded"];
  for (const exact of [false, true]) {
    const r = core.optimizeSuit({ oneHanded: [], twoHanded: [staff, shield] } as unknown as OptPools, { oneHanded: sword } as unknown as OptAssignment, pr, { seed: 1, restarts: 10, slots: hands, optionalSlots: ["twoHanded"], exact });
    assert.equal(r.best.oneHanded && r.best.oneHanded.serial, 1, `exact=${exact}: the locked sword stays`);
    assert.equal(r.best.twoHanded && r.best.twoHanded.serial, 3, `exact=${exact}: the shield, not the two-handed staff`);
  }
  const free = core.optimizeSuit({ oneHanded: [sword], twoHanded: [staff, shield] } as unknown as OptPools, {} as OptAssignment, pr, { seed: 1, restarts: 10, slots: hands, optionalSlots: hands, exact: true });
  assert.equal(free.best.twoHanded!.serial, 2, "with the hand free the staff wins");
});

// Under the old "\D*" reading, "Faster Casting -1" parsed as +1 and the cursed ring would have won
// this search (fc weighted positively). With the sign read correctly it must lose to the plain ring.
test("[fast] the solver scores a Faster Casting -1 item as a loss, not a gain", () => {
  const plain: RandomSuitItem = { serial: 1, name: "Plain Ring", slot: "ring", props: {} };
  // props come from the real parser, not a hand-written literal, so this test is sensitive to the
  // PROP_PATTERNS fix itself, not just to the (already-correct) solver scoring of a negative.
  const cursed: RandomSuitItem = { serial: 2, name: "Cursed Ring", slot: "ring", props: parseTooltip(["Cursed Ring", "Faster Casting -1"]).props };
  const prof: OptProfile = { weights: { fc: 10 }, caps: {} };
  // Start already wearing the plain ring (a required slot, currently filled, so "equip nothing" is not on
  // the table) with only the cursed ring as a swap candidate. Under the old "\D*" reading FC -1 parsed as
  // +1, which times weight 10 is +10, so the hill climber would have swapped to the cursed ring; read
  // correctly as -1 it scores -10 and must lose to keeping the plain ring.
  const r = core.optimizeSuit({ ring: [cursed] } as unknown as OptPools, { ring: plain } as unknown as OptAssignment, prof, { seed: 1, restarts: 3, slots: ["ring"], optionalSlots: [], exact: true, timeBudgetMs: 2000 });
  assert.equal(r.best.ring && r.best.ring.serial, plain.serial, "the un-cursed ring must win once FC -1 is read as a loss");
});

test("[slow] warm start never lowers the result and keeps a proven optimum", { skip: SKIP_SLOW }, () => {
  const cold = core.optimizeSuit(demoPools as unknown as OptPools, demoCurrent as unknown as OptAssignment, archerProfile, { seed: 1, restarts: 20, exact: true, timeBudgetMs: 8000 });
  const warmMap = Object.fromEntries(Object.entries(cold.best).map(([sl, it]) => [sl, it ? it.serial : null]));
  const warm = core.optimizeSuit(demoPools as unknown as OptPools, demoCurrent as unknown as OptAssignment, archerProfile, { seed: 1, restarts: 0, warmStart: warmMap });
  assert.ok(warm.score >= cold.score - 1e-6, "a warm start at the optimum stays there with no restarts at all");
  const bogus = core.optimizeSuit(demoPools as unknown as OptPools, demoCurrent as unknown as OptAssignment, archerProfile, { seed: 1, restarts: 20, warmStart: { helmet: 999999999 } });
  assert.ok(bogus.score >= res.score - 1e-6, "an unknown serial is simply ignored");
});

// ---- hostile scan content (Phase 7 security review, Area 2) ---------------------------------
// Everything expensive in the pipeline happens AFTER a scan is accepted and written to <data>/scans/,
// so a scan that makes parseTooltip or foldSnapshots superlinear costs the server that time on every
// fold, and again on the first fold after every restart. Both tests below assert on structure AND on
// a generous ms ceiling: the ceiling is what actually catches a reintroduced quadratic (the pre-fix
// numbers were 9 s at 128k characters and 2.3 s at 20k items), the structure is what catches a "fix"
// that just stops parsing.
test("[fast] parseTooltip: a pathological tooltip line parses in linear time", () => {
  const line = "a" + " ".repeat(200_000) + "5x";   // the lazy head and the [\s:+]* separator used to overlap on every space
  const t0 = Date.now();
  const p = parseTooltip(["Katana", line, "Weight: 1 Stone"]);
  const ms = Date.now() - t0;
  assert.equal(p.name, "Katana");
  assert.equal(p.weight, 1, "the lines after the pathological one are still parsed");
  assert.ok(ms < 1000, `parseTooltip took ${ms} ms on one 200k-character line — the fallback regex is quadratic again`);
});

test("[fast] fold: container lookup is indexed, so containers keyed by anything still fold in linear time", () => {
  // Nothing requires snap.containers' KEYS to equal the entries' own serials. The fold's old fallback
  // was a linear Object.values(...).find() per item, so a scan naming its keys "k1", "k2"... paid
  // items x containers. Same scan twice, only the key naming differs: same result, no time cliff.
  const ITEMS = 10_000, CONTAINERS = 1000, ROOT = 9_000_000;
  const build = (keyed: boolean): ScanV2 => {
    const containers: Record<string, unknown> = { [keyed ? ROOT : "root"]: { serial: ROOT, root: ROOT, parent: null, kind: "ground", name: "Metal Chest" } };
    for (let i = 0; i < CONTAINERS; i++) containers[keyed ? String(ROOT + 1 + i) : `k${i}`] = { serial: ROOT + 1 + i, root: ROOT, parent: ROOT, kind: "container", name: `Bag ${i}` };
    const items = Array.from({ length: ITEMS }, (_, i) => ({ serial: ROOT + 1 + CONTAINERS + i, name: `Iron Ingot`, tooltip: ["Iron Ingot"], amount: 1, container: ROOT + 1 + (i % CONTAINERS), nameSource: "opl" }));
    return {
      schemaVersion: 2, character: "Kestrel", scannedAt: "2026-01-01T12:00:00+00:00",
      adapter: { id: "tazuo", version: "1", client: "TazUO", clientVersion: null, capabilities: TAZUO_V1_CAPS },
      stats: {}, skills: {}, equipped: [],
      roots: [{ serial: ROOT, kind: "ground", name: "Metal Chest", opened: true }],
      containers, items,
    } as unknown as ScanV2;
  };
  const t0 = Date.now();
  const straight = foldSnapshots([build(true)]);
  const t1 = Date.now();
  const hostile = foldSnapshots([build(false)]);
  const t2 = Date.now();
  assert.deepEqual(Object.keys(hostile.items).sort(), Object.keys(straight.items).sort());
  assert.equal(Object.keys(hostile.items).length, ITEMS + CONTAINERS);
  // Ratio, not a wall-clock ceiling: both folds do identical work, so a slow machine moves both ends
  // together. Measured before the fix, this pair ran 12x-144x apart depending on the counts.
  const straightMs = t1 - t0, hostileMs = t2 - t1;
  assert.ok(hostileMs < straightMs * 5 + 250, `mis-keyed containers folded in ${hostileMs} ms against ${straightMs} ms for the same scan keyed by serial — the per-item container scan is back`);
});

test("[fast] fold: the maps it builds have a null prototype, so a scan cannot name a key that changes one", () => {
  // `obj["__proto__"] = value` invokes the inherited setter and REPLACES that object's prototype —
  // silently dropping the entry and hanging an attacker-controlled inherited key off the map.
  const mk = (character: string, serial: unknown): ScanV2 => ({
    schemaVersion: 2, character, scannedAt: "2026-01-01T12:00:00+00:00",
    adapter: { id: "tazuo", version: "1", client: "TazUO", clientVersion: null, capabilities: TAZUO_V1_CAPS },
    stats: {}, skills: {}, equipped: [],
    roots: [{ serial: 1, kind: "ground", name: "Chest", opened: true }],
    containers: { a: { serial: 1, root: 1, parent: null, kind: "ground", name: "Chest" }, b: { serial, root: 1, parent: 1, kind: "container", name: "evil" } },
    items: [],
  } as unknown as ScanV2);
  const inv = foldSnapshots([mk("Kestrel", "__proto__")]);
  for (const map of [inv.items, inv.containers, inv.characters]) {
    assert.equal(Object.getPrototypeOf(map), null, "a fold map still inherits from Object.prototype");
    assert.equal((map as Record<string, unknown>)["name"], undefined, "an attacker-controlled inherited key is readable off a fold map");
  }
  // the container is an ordinary key of its own rather than something that vanished into a prototype
  assert.ok(Object.keys(inv.containers).includes("__proto__"));
  assert.equal(Object.getPrototypeOf({}), Object.prototype);   // and nothing global was touched
  // the same shape in the CHARACTER name (the other attacker-chosen key) leaves the map's prototype alone
  const named = foldSnapshots([mk("__proto__", 2)]);
  assert.equal(Object.getPrototypeOf(named.characters), null);
  assert.equal((named.characters as Record<string, unknown>)["name"], undefined);
});

// Razor Enhanced reports its own layer names in a scan's `equipped[].layer` (issue #219); each must classify exactly as
// the TazUO name for the same layer number does, so no adapter's worn items fall back to graphics and names.
test("[fast] every layer name an adapter declares resolves to a known slot", () => {
  const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "adapters");
  const NOT_GEAR: string[] = [];   // a declared layer that holds no gear would be named here
  const seen = new Set<string>();
  for (const name of readdirSync(dir)) {
    const file = join(dir, name, "capabilities.json");
    if (!existsSync(file)) continue;
    const layers = (JSON.parse(readFileSync(file, "utf8")) as { capabilities: { layers?: string[] } }).capabilities.layers ?? [];
    for (const layer of layers) {
      seen.add(layer);
      if (NOT_GEAR.includes(layer)) continue;
      assert.ok(LAYER_TO_SLOT[LAYER_ALIASES[layer] ?? layer], `${name} declares the layer "${layer}", which maps to no slot`);
    }
  }
  assert.ok(seen.has("LeftHand") && seen.has("OneHanded"), "the adapter manifests were not read");
  for (const [alias, canonical] of Object.entries(LAYER_ALIASES)) assert.ok(LAYER_TO_SLOT[canonical], `${alias} aliases "${canonical}", not a canonical layer`);
});
test("[fast] classify gives a Razor layer name the slot of its TazUO equivalent", () => {
  const worn: [string, string, string, string][] = [
    ["Heater Shield", "LeftHand", "TwoHanded", "twoHanded"],
    ["Radiant Scimitar", "RightHand", "OneHanded", "oneHanded"],
    ["Platemail Chest", "InnerTorso", "Torso", "chest"],
    ["Cloth Kilt", "OuterLegs", "Skirt", "outerLegs"],
    ["Platemail Gorget", "Neck", "Necklace", "neck"],
    ["Platemail Helm", "Head", "Helmet", "helmet"],
    ["Platemail Legs", "InnerLegs", "Legs", "legs"],
    ["Doublet", "MiddleTorso", "Tunic", "tunic"],
    ["Robe", "OuterTorso", "Robe", "robe"],
  ];
  for (const [name, razor, tazuo, slot] of worn) {
    const got = classify(name, null, razor);
    assert.equal(got.slot, slot, `${razor}: ${name}`);
    assert.deepEqual(got, classify(name, null, tazuo), `${razor} differs from ${tazuo}`);
  }
  // a two-handed weapon in the left hand stays two-handed, and a shield there does not
  assert.equal(classify("Bardiche", null, "LeftHand").twoHanded, true);
  assert.equal(classify("Heater Shield", null, "LeftHand").twoHanded, false);
});
