// unravel.test.mts — `app/unravel.mts`, what unraveling a piece at a soul forge gives (issue #271).
//
// The type classifier (weapons, ranged weapons, armor, shields, hats, jewelry; robes, cloaks, shoes, talismans, spellbooks and quivers null; a gorget is armor and a necklace jewelry by vault-lib's neck rule; hoods and toques are hats, and a hat or kilt named for an armor material is armor), every row of the property-weight table at its imbuing max and truncated per property, the per-type maxes (HCI and DCI on ranged weapons, DI on jewelry and shields), Hit Life and Mana Leech from the weapon's speed and SSI (halved for ranged), Mage Weapon, extras, yes/no properties (Balanced by weapon kind), slayers (ServUO's seven super slayers 130, the rest 100), skill bonuses at 9 a point, resists in full on jewelry and weapons and above the base total on armor, hats and shields, the research's two hand-checked bracelets, the rarity tier the same weight implies on a synthetic set of jewelry, every yield band with its gates and chances and amounts, the expected yield, the maybe margin, the left-out reasons and the ingredients on hand. All `[fast]`, against the shipped UO Alive rules.
import { test } from "node:test";
import assert from "node:assert/strict";
import { unravelType, unravelWeight, unravelIngredient, unravelMaybe, unravelYield, expectedYield, leftOutReasons, onHand, unravelInfo, PROPERTY_WEIGHTS, EXTRA_WEIGHTS, FLAG_WEIGHTS, RESIST_KEYS, LEFT_OUT } from "./unravel.mts";
import { loadRules } from "./rules.mts";
import type { Item } from "./vault-lib.mts";

const RULES = loadRules("uoalive");
const U = RULES.unravel!;

// Only the fields unravel.mts reads; a gear ring with nothing on it unless overridden.
function mk(o: Partial<Item> & Record<string, unknown> = {}): Item {
  return { serial: 1, name: "Ring", gear: true, slot: "ring", props: {}, extras: {}, flags: [], slayers: [], tags: [], skillReq: null, equippedBy: null, amount: 1, ...o } as unknown as Item;
}
const sword = (o: Record<string, unknown> = {}): Item => mk({ name: "Katana", slot: "oneHanded", skillReq: "swordsmanship", extras: { "weapon speed": 2.5 }, ...o });
const bow = (o: Record<string, unknown> = {}): Item => mk({ name: "Bow", slot: "twoHanded", skillReq: "archery", extras: { "weapon speed": 4.25 }, ...o });
const w = (it: Item): number => unravelWeight(it, RULES);

test("[fast] unravelType: weapons, ranged, shields, jewelry, hats and armor; clothing, talismans, spellbooks and quivers null", () => {
  assert.equal(unravelType(sword()), "weapon");
  assert.equal(unravelType(bow()), "ranged");
  assert.equal(unravelType(mk({ name: "Cyclone", slot: "twoHanded", skillReq: "throwing", extras: { "weapon speed": 3 } })), "ranged");
  assert.equal(unravelType(mk({ name: "Pickaxe", slot: "oneHanded", extras: { "weapon speed": 3 } })), "weapon", "a weapon speed line alone is a weapon");
  assert.equal(unravelType(mk({ name: "Order Shield", slot: "twoHanded" })), "shield");
  assert.equal(unravelType(mk({ name: "Gargish Kite Shield", slot: "twoHanded" })), "shield");
  assert.equal(unravelType(mk({ name: "Buckler", slot: "twoHanded" })), "shield");
  for (const slot of ["ring", "bracelet", "earrings"]) assert.equal(unravelType(mk({ slot })), "jewel", slot);
  assert.equal(unravelType(mk({ name: "Gargish Necklace", slot: "neck" })), "jewel");
  assert.equal(unravelType(mk({ name: "Studded Gorget", slot: "neck" })), "armor");
  assert.equal(unravelType(mk({ name: "Armor Of Initiation", slot: "neck" })), "armor", "vault-lib's neck rule");
  assert.equal(unravelType(mk({ name: "Star Of The Seas", slot: "neck" })), "jewel", "a necklace with no necklace word");
  for (const name of ["Bandana", "Skullcap", "Wizard's Hat", "Tricorne Hat Of Sorcery", "Bear Mask", "Flower Garland", "Bonnet", "Kasa", "Cap", "Cloth Ninja Hood", "Chef's Toque", "Tricorne"]) assert.equal(unravelType(mk({ name, slot: "helmet" })), "hat", name);
  for (const name of ["Leather Cap", "Leather Ninja Hood", "Close Helmet", "Chainmail Coif", "Orc Helm", "Circlet"]) assert.equal(unravelType(mk({ name, slot: "helmet" })), "armor", name);
  for (const slot of ["chest", "arms", "hands", "legs"]) assert.equal(unravelType(mk({ name: "Platemail", slot })), "armor", slot);
  for (const [name, slot] of [["Robe", "robe"], ["Cloak", "cloak"], ["Elven Shirt", "shirt"], ["Doublet", "tunic"], ["Thigh Boots", "feet"], ["Kilt", "outerLegs"], ["Elven Quiver", "cloak"]] as const) assert.equal(unravelType(mk({ name, slot })), null, name);
  for (const name of ["Gargish Platemail Kilt", "Gargish Leather Kilt", "Gargish Stone Kilt", "Leather Skirt", "Studded Hakama", "Leather Hakama"]) assert.equal(unravelType(mk({ name, slot: "outerLegs" })), "armor", `${name}: armor in a clothing slot`);
  assert.equal(unravelType(mk({ name: "Talisman", slot: "talisman" })), null);
  assert.equal(unravelType(mk({ name: "Charm Of Luck", slot: "talisman" })), null, "the talisman slot, whatever its name");
  assert.equal(unravelType(mk({ name: "Spellbook", slot: "oneHanded", flags: ["64 spells"] })), null);
  assert.equal(unravelType(mk({ name: "Book Of Chivalry", slot: "oneHanded" })), null);
  assert.equal(unravelType(mk({ name: "Necromancer Spellbook", slot: "oneHanded" })), null);
  assert.equal(unravelType(mk({ name: "Tome Of Enlightenment", slot: "oneHanded" })), null);
  assert.equal(unravelType(mk({ gear: false, kind: "resource" })), null, "not gear");
  assert.equal(w(mk({ name: "Robe", slot: "robe", props: { manaRegen: 2 } })), 0, "a piece that can't be unraveled weighs 0");
});

test("[fast] every property at its imbuing max weighs its full weight, and a fraction is truncated", () => {
  for (const [key, { weight, max }] of Object.entries(PROPERTY_WEIGHTS)) {
    if (max === "leech") continue;
    const m = typeof max === "number" ? max : max.other!;
    // On a melee weapon, where every max is the table's own.
    assert.equal(w(sword({ props: { [key]: m } })), weight, `${key} at ${m}`);
    // A third of the max: trunc(weight / max × value), never rounded up.
    assert.equal(w(sword({ props: { [key]: m / 3 } })), Math.trunc(weight / 3 + 1e-9), `${key} at a third`);
  }
  for (const [key, { weight, max }] of Object.entries(EXTRA_WEIGHTS)) assert.equal(w(mk({ extras: { [key]: max } })), weight, key);
  for (const [flag, fw] of Object.entries(FLAG_WEIGHTS)) assert.equal(w(sword({ flags: [flag] })), typeof fw === "number" ? fw : fw.melee, flag);
  assert.equal(w(bow({ flags: ["balanced"] })), 150, "Balanced weighs 150 on a ranged weapon");
  assert.equal(w(mk({ props: { fc: -1 } })), 0, "a negative property (spell channeling's FC -1) adds nothing");
  assert.equal(w(mk({ props: { tagPenalty: 10 } })), 0, "the tag penalty is no property");
  assert.equal(w(mk({ extras: { durability: [50, 50], "physical damage": 100 } as unknown as Item["extras"] })), 0, "durability and damage types add nothing");
});

test("[fast] the type's own max: HCI and DCI on ranged, DI on jewelry and shields", () => {
  assert.equal(w(sword({ props: { hci: 15, dci: 15, di: 50 } })), 130 + 110 + 100);
  assert.equal(w(bow({ props: { hci: 25, dci: 25 } })), 130 + 110);
  assert.equal(w(bow({ props: { hci: 15 } })), 78, "130 / 25 × 15");
  assert.equal(w(mk({ props: { di: 25 } })), 100, "jewelry DI max 25");
  assert.equal(w(mk({ name: "Order Shield", slot: "twoHanded", props: { di: 35 } })), 100, "shield DI max 35");
  assert.equal(w(mk({ name: "Order Shield", slot: "twoHanded", props: { di: 10 } })), 28, "100 / 35 × 10 = 28.57");
});

test("[fast] truncation is per property, not on the sum", () => {
  // SSI 5 = 110 / 30 × 5 = 18.33 and SDI 5 = 100 / 12 × 5 = 41.67: 18 + 41 = 59, not 60.
  assert.equal(w(mk({ props: { ssi: 5, sdi: 5 } })), 59);
  // Three resists on jewelry: 6.67 × 11 = 73.3, 6.67 × 7 = 46.7, 6.67 × 4 = 26.7 -> 73 + 46 + 26.
  assert.equal(w(mk({ props: { fireResist: 11, coldResist: 7, poisonResist: 4 } })), 145);
});

test("[fast] skill bonuses count 9 a point", () => {
  assert.equal(w(mk({ extras: { magery: 15 } })), 135);
  assert.equal(w(mk({ extras: { magery: 10, "evaluating intelligence": 5, "arms lore": 1 } })), 144);
  assert.equal(w(mk({ extras: { "not a skill": 15 } })), 0, "a number that is no skill and no known property adds nothing");
});

test("[fast] resists: in full on jewelry and weapons, only above the base total on armor, hats and shields", () => {
  const all = (n: number): Record<string, number> => Object.fromEntries(RESIST_KEYS.map((k) => [k, n]));
  assert.equal(w(mk({ props: all(3) })), 5 * 20, "jewelry: 100 / 15 × 3 = 20 each");
  assert.equal(w(sword({ props: { physResist: 15 } })), 100, "a weapon's resist bonus counts in full");
  assert.equal(U.baseResist.armor, 15);
  assert.equal(w(mk({ name: "Platemail Tunic", slot: "chest", props: all(3) })), 0, "armor at its base total of 15 adds nothing");
  assert.equal(w(mk({ name: "Platemail Tunic", slot: "chest", props: all(5) })), 66, "armor 25: 10 above 15 -> trunc(66.7)");
  assert.equal(w(mk({ name: "Platemail Tunic", slot: "chest", props: { physResist: 2 } })), 0, "below the base adds nothing, never less");
  assert.equal(U.baseResist.hat, 24);
  assert.equal(w(mk({ name: "Bandana", slot: "helmet", props: all(6) })), 40, "hat 30: 6 above 24");
  assert.equal(w(mk({ name: "Close Helmet", slot: "helmet", props: all(6) })), 100, "a helmet is armor: 15 above 15");
  assert.equal(U.baseResist.shield, 1);
  assert.equal(w(mk({ name: "Buckler", slot: "twoHanded", props: { physResist: 4 } })), 20, "shield 4: 3 above 1");
});

test("[fast] Hit Life and Mana Leech take their max from the weapon's speed and SSI", () => {
  // 2.5 s: trunc(2.5 × 2500 / 100) = 62. HLL 31 = 110 / 62 × 31 = 55.
  assert.equal(w(sword({ props: { hitLifeLeech: 31 } })), 55);
  assert.equal(w(sword({ props: { hitManaLeech: 62 } })), 110);
  // SSI 25 lowers the max: trunc(2.5 × 2500 / 125) = 50, so HLL 50 = 110, plus SSI 25 = trunc(91.7).
  assert.equal(w(sword({ props: { hitLifeLeech: 50, ssi: 25 } })), 110 + 91);
  // Ranged halves it: 4.25 s -> trunc(106.25) = 106, halved 53; HLL 53 = 110.
  assert.equal(w(bow({ props: { hitLifeLeech: 53 } })), 110);
  // No speed line: the table's usual 50.
  assert.equal(w(mk({ name: "Spear", slot: "twoHanded", skillReq: "fencing", props: { hitLifeLeech: 50 } })), 110);
  assert.equal(w(sword({ props: { hitStamLeech: 50 } })), 100, "Hit Stamina Leech keeps its own max");
});

test("[fast] Mage Weapon, slayers and the extras", () => {
  // Kept as the shown -N: the property is 30 - N, at 10 a point.
  assert.equal(w(sword({ props: { mageWeapon: -20 } })), 100);
  assert.equal(w(sword({ props: { mageWeapon: -25 } })), 50);
  assert.equal(w(sword({ slayers: ["Orc"] })), 100);
  assert.equal(w(sword({ slayers: ["Reptile"] })), 130, "a super slayer");
  assert.equal(w(sword({ slayers: ["Undead (Silver)"] })), 130, "Silver is a super slayer");
  assert.equal(w(sword({ slayers: ["Repond (humanoids)", "Dragon"] })), 230);
  assert.equal(w(sword({ slayers: ["Exorcism (demons)"] })), 130);
  assert.equal(w(sword({ slayers: ["Elemental Ban"] })), 130);
  for (const lesser of ["Demon", "Elemental", "Undead", "Eodon", "Gargoyle"]) assert.equal(w(sword({ slayers: [lesser] })), 100, `${lesser} is no ServUO super slayer`);
  assert.equal(w(bow({ extras: { "weapon speed": 4.25, velocity: 25 } })), 70);
  assert.equal(w(mk({ extras: { "fire eater": 7, "lower requirements": 50 } })), 65 + 50);
});

// The research's two hand-checked pieces (docs: §1.3), as generic bracelets.
const BRACELET_LEGENDARY = mk({ name: "Bracelet", slot: "bracelet", flags: ["night sight"], props: { intBonus: 10, hci: 13, di: 20, dci: 15, sdi: 12, coldResist: 15 }, extras: { magery: 15, "evaluating intelligence": 15, meditation: 10, focus: 10 } });
const BRACELET_MAJOR = mk({ name: "Bracelet", slot: "bracelet", flags: ["night sight"], props: { strBonus: 8, ssi: 5, di: 5, fcr: 3, fc: 1, lrc: 17 }, extras: { swordsmanship: 15, tactics: 10, anatomy: 10 } });
test("[fast] the research's hand-checked bracelets", () => {
  // 137 + 112 + 80 + 110 + 100 + 100 + 50 + 9 × 50: the loot weight 1,139 the research reproduced, since every max here is the same for loot.
  assert.equal(w(BRACELET_LEGENDARY), 1139);
  // 110 + 18 + 20 + 120 + 140 + 85 + 50 + 9 × 35. Its loot weight is 950: jewelry's SSI loot max is lower than the imbuing max of 30.
  assert.equal(w(BRACELET_MAJOR), 858);
  for (const b of [BRACELET_LEGENDARY, BRACELET_MAJOR]) assert.equal(unravelIngredient(w(b), RULES), "Relic Fragment");
});

// RunicReforging.GetItemPower's tier for jewelry (pre = 500 + 100, arty = 1200 - pre), as the research gives it.
const LADDER = ["Minor Magic Item", "Lesser Magic Item", "Greater Magic Item", "Major Magic Item", "Lesser Artifact", "Greater Artifact", "Major Artifact", "Legendary Artifact"];
function jewelTier(weight: number, props: number): string {
  const pre = 600, arty = 600;
  const at = [0.4 * pre, 0.6 * pre, 0.8 * pre].findIndex((cut) => weight < cut);
  if (at >= 0) return LADDER[at]!;
  if (weight <= pre) return LADDER[3]!;
  const art = [pre + 0.2 * arty, pre + 0.4 * arty, pre + 0.7 * arty].findIndex((cut) => weight < cut);
  return LADDER[art >= 0 ? 4 + art : props <= 5 ? 6 : 7]!;
}
test("[fast] the weight lands in the rarity tier the shard prints, on a synthetic jewelry set", () => {
  // Jewelry whose properties have the same loot and imbuing max, with the tier GetItemPower stamps for that weight.
  const set: Array<[Item, string]> = [
    [mk({ props: { luck: 100 } }), "Minor Magic Item"],
    [mk({ props: { hci: 15, dci: 15 } }), "Lesser Magic Item"],
    [mk({ props: { hci: 15, dci: 15, intBonus: 8, lmc: 8 } }), "Greater Magic Item"],
    [mk({ props: { hci: 15, dci: 15, intBonus: 8, lmc: 8, fcr: 3 } }), "Major Magic Item"],
    [mk({ props: { hci: 15, dci: 15, intBonus: 8, lmc: 8, fcr: 3, sdi: 12 } }), "Lesser Artifact"],
    [mk({ props: { hci: 15, dci: 15, intBonus: 8, lmc: 8, fcr: 3, sdi: 12, fc: 1 } }), "Greater Artifact"],
    [BRACELET_LEGENDARY, "Legendary Artifact"],
    [mk({ props: { hci: 15, dci: 15, intBonus: 8, fcr: 3, fc: 1 }, extras: { magery: 30 } }), "Major Artifact"],
  ];
  for (const [it, tier] of set) {
    const props = Object.keys(it.props).length + Object.keys(it.extras).length + it.flags.length;
    assert.equal(jewelTier(w(it), props), tier, `${JSON.stringify(it.props)} weighs ${w(it)}`);
  }
});

test("[fast] the bands, gates and chances", () => {
  assert.deepEqual([U.residueMax, U.relicMin, U.essenceSkill, U.relicSkill, U.relicRoll[0], U.maybeMargin], [200, 480, 45, 95, 90.1, 40], "the rules' unravel block");
  assert.equal(unravelIngredient(0, RULES), null, "no magic: refused");
  assert.equal(unravelYield(0, 100, RULES), null);
  assert.equal(unravelIngredient(1, RULES), "Magical Residue");
  assert.equal(unravelIngredient(200, RULES), "Magical Residue");
  assert.equal(unravelIngredient(201, RULES), "Enchanted Essence");
  assert.equal(unravelIngredient(479, RULES), "Enchanted Essence");
  assert.equal(unravelIngredient(480, RULES), "Relic Fragment");
  // Residue: no gate, chance skill / 45, a miss keeps the piece; 1-3 by the hundreds.
  assert.deepEqual(unravelYield(150, 0, RULES), { hit: { ingredient: "Magical Residue", min: 1, max: 2 }, chance: 0, miss: null, needsSkill: 0 });
  assert.equal(unravelYield(150, 22.5, RULES)!.chance, 0.5);
  assert.equal(unravelYield(150, 45, RULES)!.chance, 1);
  assert.deepEqual(unravelYield(50, 50, RULES)!.hit, { ingredient: "Magical Residue", min: 1, max: 1 });
  assert.deepEqual(unravelYield(200, 50, RULES)!.hit, { ingredient: "Magical Residue", min: 2, max: 3 });
  // Essence: refused below 45, chance (skill - 45) / 50, else Residue; 2-4 by the hundreds.
  const ess = unravelYield(350, 44.9, RULES)!;
  assert.equal(ess.needsSkill, 45);
  assert.equal(ess.chance, 0, "refused below the gate");
  assert.equal(unravelYield(350, 70, RULES)!.chance, 0.5);
  assert.equal(unravelYield(350, 95, RULES)!.chance, 1);
  assert.deepEqual(unravelYield(350, 70, RULES)!.hit, { ingredient: "Enchanted Essence", min: 3, max: 3 });
  assert.deepEqual(unravelYield(350, 70, RULES)!.miss, { ingredient: "Magical Residue", min: 3, max: 4 });
  assert.deepEqual(unravelYield(201, 70, RULES)!.hit, { ingredient: "Enchanted Essence", min: 2, max: 2 });
  // Relic: refused below 95 (not the roll's 90.1), chance (skill - 90.1) / 29.9, else Essence w / 100 - 0..2; always one.
  const rel = unravelYield(650, 94.9, RULES)!;
  assert.equal(rel.needsSkill, 95);
  assert.equal(rel.chance, 0);
  assert.ok(Math.abs(unravelYield(650, 95, RULES)!.chance - 4.9 / 29.9) < 1e-9, "about 16% at 95");
  assert.ok(Math.abs(unravelYield(650, 100, RULES)!.chance - 9.9 / 29.9) < 1e-9, "about 33% at 100");
  assert.equal(unravelYield(650, 120, RULES)!.chance, 1);
  assert.deepEqual(unravelYield(650, 100, RULES)!.hit, { ingredient: "Relic Fragment", min: 1, max: 1 });
  assert.deepEqual(unravelYield(650, 100, RULES)!.miss, { ingredient: "Enchanted Essence", min: 4, max: 6 });
  assert.deepEqual(unravelYield(480, 100, RULES)!.miss, { ingredient: "Enchanted Essence", min: 2, max: 4 });
  assert.equal(unravelYield(100, 50, {}), null, "a shard without an unravel block suggests nothing");
});

test("[fast] expectedYield averages each outcome by its chance, nothing while refused", () => {
  assert.deepEqual(expectedYield(150, 45, RULES), { "Relic Fragment": 0, "Enchanted Essence": 0, "Magical Residue": 1.5 });
  assert.deepEqual(expectedYield(150, 22.5, RULES), { "Relic Fragment": 0, "Enchanted Essence": 0, "Magical Residue": 0.75 });
  assert.deepEqual(expectedYield(350, 70, RULES), { "Relic Fragment": 0, "Enchanted Essence": 1.5, "Magical Residue": 1.75 });
  assert.deepEqual(expectedYield(350, 40, RULES), { "Relic Fragment": 0, "Enchanted Essence": 0, "Magical Residue": 0 });
  assert.deepEqual(expectedYield(650, 90, RULES), { "Relic Fragment": 0, "Enchanted Essence": 0, "Magical Residue": 0 });
  const at120 = expectedYield(650, 120, RULES);
  assert.deepEqual(at120, { "Relic Fragment": 1, "Enchanted Essence": 0, "Magical Residue": 0 });
});

test("[fast] maybe: within the margin of either line", () => {
  for (const [weight, maybe] of [[159, false], [160, true], [240, true], [241, false], [439, false], [440, true], [520, true], [521, false], [0, false]] as const) {
    assert.equal(unravelMaybe(weight, RULES), maybe, String(weight));
  }
});

test("[fast] leftOutReasons and unravelInfo", () => {
  const ctx = { suits: new Set([2]), pins: new Set([3]), kept: new Set([4]) };
  assert.deepEqual(leftOutReasons(mk({ serial: 1 }), ctx), []);
  assert.deepEqual(leftOutReasons(mk({ serial: 1, equippedBy: "Someone" }), ctx), ["worn"]);
  assert.deepEqual(leftOutReasons(mk({ serial: 2, flags: ["insured", "blessed", "(imbued)"] }), ctx), ["build", "insured", "imbued", "blessed"]);
  assert.deepEqual(leftOutReasons(mk({ serial: 3 }), ctx), ["pinned"]);
  assert.deepEqual(leftOutReasons(mk({ serial: 4 }), ctx), ["kept"]);
  assert.deepEqual([...LEFT_OUT], ["worn", "build", "insured", "pinned", "imbued", "blessed", "kept"]);
  assert.deepEqual(unravelInfo(mk({ props: { hci: 15, dci: 15 } }), RULES), { ingredient: "Enchanted Essence", weight: 240, maybe: true });
  assert.deepEqual(unravelInfo(mk({ props: { luck: 100 } }), RULES, ["worn"]), { ingredient: "Magical Residue", weight: 100, maybe: false, leftOut: ["worn"] });
  assert.equal(unravelInfo(mk(), RULES), null, "no magic: no candidate");
});

test("[fast] onHand sums ingredient stacks, by amount or by a count in the name", () => {
  const stacks = [{ name: "Enchanted Essence", amount: 239 }, { name: "205 Enchanted Essence", amount: 1 }, { name: "Magical Residue", amount: 69 }, { name: "3 Relic Fragments", amount: 1 }, { name: "Relic Fragment", amount: 2 }, { name: "Essence of Persistence", amount: 9 }, { name: "Bag", amount: 1 }];
  assert.deepEqual(onHand(stacks), { "Relic Fragment": 5, "Enchanted Essence": 444, "Magical Residue": 69 });
  assert.deepEqual(onHand([{ name: "1,200 Magical Residue", amount: 1 }]), { "Relic Fragment": 0, "Enchanted Essence": 0, "Magical Residue": 1200 });
});
