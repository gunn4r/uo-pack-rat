// gear-vault.test.mts — tests for vault-lib.mts (parser, classifier, fold, pools) and the optimizer
// core through the same loader the server uses. Tags are name prefixes: [smoke] [fast] [slow].
// Run: node --test app/gear-vault.test.mts   or   node app/gear-vault.test.mts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import {
  parseTooltip, classify, foldSnapshots, buildPools, requirementReport, totalsOf, propertyKeys, bagLabel, kindOf, groupByName, slayersOf, medableOf, weaponAllowed, settingsDiff, PROP_LABELS, LAYER_TO_SLOT, effectiveProfile, resistSkillBonus, toOptItem, labelOf, builderKeys, migrateProfiles, templateFrom, TEMPLATE_KEYS, setRules, getRules, tagUnits, tagInfo,
  WEAPON_SKILLS, migrateWeaponSetting, excludeWeaponsError,
  shardResistCap, resistCapsFor, resistCapsError, profileResistCaps, RESIST_CAP_LIMITS,
} from "./vault-lib.mts";
import type { Item, Inventory, ItemLocation, ProfilesFile, CharacterEntryRaw } from "./vault-lib.mts";
import { upgradeScan, TAZUO_V1_CAPS } from "./scan-schema.mts";
import { runKey, reusableRun, runSummary, normalizeRun } from "./runs-lib.mts";
import type { SavedRun } from "./runs-lib.mts";
import { corePath } from "./config.mts";
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
  assert.equal(classify("Mystic Ring").slot, "ring");
  assert.equal(classify("Mystic Heater Shield").slot, "twoHanded");
  assert.equal(classify("Book Of Chivalry").slot, "oneHanded");
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
    ["Hakama", "legs"], ["Tattsuke Hakama", "legs"], ["Kasa", "helmet"], ["Cloth Ninja Hood", "helmet"], ["Fur Cape", "cloak"], ["Mantle", "cloak"],
    ["Quiver Of Infinity", "cloak"], ["Beads", "neck"], ["Gold Ring", "ring"], ["Gold Bracelet", "bracelet"]];
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
  assert.equal(parseTooltip(["2 Greater Heal"], 2).name, "Greater Heal");
  assert.equal(parseTooltip(["10 Potions"], 1).name, "10 Potions");   // a name that starts with a number keeps it
  assert.equal(classify("Elven Glasses Of Restoration").slot, "helmet");
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

test("[fast] propertyKeys lists the modeled properties present", () => {
  const inv = foldSnapshots([kestrel, dorran]);
  const keys = propertyKeys(inv);
  assert.ok(keys.includes("hci") && keys.includes("lrc") && !keys.includes("tagPenalty"));
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
  assert.match(excludeWeaponsError(["archery", "wrestling"], "settings.excludeWeapons")!, /^settings\.excludeWeapons\[1\] is not a weapon skill/);
  const schema = JSON.parse(readFileSync(join(HERE, "schema", "profiles.v2.schema.json"), "utf8")) as { properties: Record<string, { additionalProperties: { properties: { excludeWeapons: { items: { enum: string[] } } } } }> };
  for (const g of ["characters", "templates"]) assert.deepEqual(schema.properties[g]!.additionalProperties.properties.excludeWeapons.items.enum, WEAPON_SKILLS, `the ${g} schema knows the same skills`);
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

test("[fast] effectiveProfile: resist floors and caps are paperdoll values, less the Resisting Spells bonus; an Elf's energy cap is 75 (uoalive rules)", () => {
  const e = effectiveProfile({ floors: { physResist: 70, energyResist: 75, hci: 40 }, softFloors: ["hci"], weights: { hci: 1 }, race: "elf" }, { skills: { "Resisting Spells": { value: 41.5 } } } as never);
  assert.equal(e.resistBonus, 16);
  assert.equal(e.caps.physResist, 54); assert.equal(e.caps.energyResist, 59);
  assert.equal(e.floors.physResist, 54); assert.equal(e.floors.energyResist, 59); assert.equal(e.floors.hci, 40);
  assert.deepEqual(e.hardFloors.sort(), ["energyResist", "physResist"]);
  const h = effectiveProfile({ floors: { energyResist: 75 } }, null);
  assert.equal(h.caps.energyResist, 70); assert.equal(h.floors.energyResist, 70, "a human's energy floor is clamped to the 70 cap");
  assert.equal(resistSkillBonus({ "Resisting Spells": { value: 120 } }), 44);
  assert.equal(resistSkillBonus({ "Resisting Spells": { value: 100 } }), 40);
  assert.equal(resistSkillBonus({ "Resisting Spells": { value: 50 } }), 20);
  assert.ok(settingsDiff({ race: "human" }, { race: "elf", excludeSkills: ["necromancy"] }).includes("race human → elf"));
});

test("[fast] resist cap overrides: effectiveProfile values a resist up to the player's cap, paperdoll terms, and a floor counts up to it", () => {
  const skills = { skills: { "Resisting Spells": { value: 41.5 } } } as never;   // +16
  const e = effectiveProfile({ floors: { fireResist: 90, coldResist: 90 }, resistCaps: { fireResist: 95 } }, skills);
  assert.equal(e.caps.fireResist, 79, "95 on the paperdoll less the Resisting Spells bonus");
  assert.equal(e.caps.coldResist, 54, "an untouched resist keeps the shard's 70");
  assert.equal(e.floors.fireResist, 74, "a Fire floor of 90 is no longer clamped to 70");
  assert.equal(e.floors.coldResist, 54, "Cold's floor still is");
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

test("[fast] getRules()/setRules() and resistSkillBonus() are shard-swappable: generic-osi has no flat Resisting Spells bonus", () => {
  const uoalive = getRules();
  try {
    assert.throws(() => { setRules(null as unknown as RulesV1); getRules(); }, /rules not loaded/);
    const genericOsi = JSON.parse(readFileSync(join(HERE, "rules", "generic-osi.json"), "utf8")) as RulesV1;
    setRules(genericOsi);
    assert.equal(resistSkillBonus({ "Resisting Spells": { value: 120 } }), 0);
    assert.ok(!("massive" in tagUnits()));
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
test("[fast] runs: normalizeRun upgrades allowOthers/budgetS and stamps schemaVersion", () => {
  const r = normalizeRun({ id: "x", settings: { allowOthers: true, budgetS: 30 }, result: {} });
  assert.equal(r.schemaVersion, 1);
  assert.equal(r.settings!.allowOthersWorn, true);
  assert.equal("allowOthers" in r.settings!, false);
  assert.equal(r.settings!.budgetMs, 30000);
  assert.equal("budgetS" in r.settings!, false);
  assert.deepEqual(normalizeRun(r), r);   // idempotent
});
test("[fast] runs: normalizeRun turns a run's single weapon choice into the exclusions it was built with", () => {
  const r = normalizeRun({ id: "w", settings: { weaponSkill: "archery", allowOthers: true }, result: {} });
  assert.deepEqual(r.settings!.excludeWeapons, OTHERS("archery"));
  assert.equal("weaponSkill" in r.settings!, false);
  assert.deepEqual(normalizeRun(r), r, "idempotent");
});
test("[fast] settingsDiff: budgets compare in ms and print seconds", () => {
  const d = settingsDiff({ budgetMs: 30000, exact: true }, { budgetMs: 60000, exact: true });
  assert.ok(d.some((l) => l === "budget 30 s → 60 s"), d.join("|"));
});
test("[fast] runs: normalizeRun is applied wherever runs are read, so schemaVersion and allowOthersWorn reach the list endpoint", () => {
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
const demoProfiles = JSON.parse(readFileSync(join(HERE, "data", "profiles.default.json"), "utf8")) as ProfilesFile;
// Any real profile shape will do here (weights/floors/caps to score item sets) — use the archer
// template so it roughly matches Kestrel's build. caps come from the shard's rules file now that
// profiles.json (schemaVersion 2) no longer carries its own caps object.
const archerProfile: OptProfile = { ...demoProfiles.templates!.archer!, caps: getRules().caps as Record<string, number> };
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
