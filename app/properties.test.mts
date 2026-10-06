// properties.test.mts — vault-lib.mts's property registry (PROPERTIES): the lists derived from it, frozen as the literals
// they replaced, and the shard rules files' cap keys checked against it. Tags are name prefixes: [smoke] [fast] [slow].
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PROPERTIES, PROP_PATTERNS, PROP_LABELS, PROP_FULL, NOT_BUILDER_KEYS } from "./vault-lib.mts";
import { EXTRA_COLS } from "./item-query.mts";

const HERE = dirname(fileURLToPath(import.meta.url));

// The hand-written lists the registry replaced, verbatim. Each derived export must stay equal to its copy here.
const FROZEN_PROP_PATTERNS: Array<[string, RegExp]> = [
  ["physResist", /physical resist[^-\d]*(-?\d+)/], ["fireResist", /fire resist[^-\d]*(-?\d+)/],
  ["coldResist", /cold resist[^-\d]*(-?\d+)/], ["poisonResist", /poison resist[^-\d]*(-?\d+)/],
  ["energyResist", /energy resist[^-\d]*(-?\d+)/],
  ["fcr", /faster cast recovery[^-\d]*(-?\d+)/], ["fc", /faster casting[^-\d]*(-?\d+)/],
  ["sdi", /spell damage increase[^-\d]*(-?\d+)/], ["di", /damage increase[^-\d]*(-?\d+)/],
  ["hci", /hit chance increase[^-\d]*(-?\d+)/], ["dci", /defense chance increase[^-\d]*(-?\d+)/],
  ["ssi", /swing speed increase[^-\d]*(-?\d+)/],
  ["lmc", /lower mana cost[^-\d]*(-?\d+)/], ["lrc", /lower reagent cost[^-\d]*(-?\d+)/],
  ["hpi", /hit point increase[^-\d]*(-?\d+)/], ["hpRegen", /hit point regeneration[^-\d]*(-?\d+)/],
  ["stamInc", /stamina increase[^-\d]*(-?\d+)/], ["stamRegen", /stamina regeneration[^-\d]*(-?\d+)/],
  ["manaInc", /mana increase[^-\d]*(-?\d+)/], ["manaRegen", /mana regeneration[^-\d]*(-?\d+)/],
  ["strBonus", /strength bonus[^-\d]*(-?\d+)/], ["dexBonus", /dexterity bonus[^-\d]*(-?\d+)/],
  ["intBonus", /intelligence bonus[^-\d]*(-?\d+)/],
  ["reflectPhys", /reflect physical damage[^-\d]*(-?\d+)/],
  ["castingFocus", /casting focus[^-\d]*(-?\d+)/], ["luck", /^luck[^-\d]*(-?\d+)/],
  ["hitLifeLeech", /hit life leech[^-\d]*(-?\d+)/], ["hitStamLeech", /hit stamina leech[^-\d]*(-?\d+)/],
  ["hitManaLeech", /hit mana leech[^-\d]*(-?\d+)/], ["hitLowerDef", /hit lower defense[^-\d]*(-?\d+)/],
  ["hitLowerAttack", /hit lower attack[^-\d]*(-?\d+)/],
  ["enhancePotions", /enhance potions[^-\d]*(-?\d+)/], ["selfRepair", /self repair[^-\d]*(-?\d+)/],
  ["hitFireball", /hit fireball[^-\d]*(-?\d+)/], ["hitLightning", /hit lightning[^-\d]*(-?\d+)/],
  ["hitHarm", /hit harm[^-\d]*(-?\d+)/], ["hitMagicArrow", /hit magic arrow[^-\d]*(-?\d+)/],
  ["hitDispel", /hit dispel[^-\d]*(-?\d+)/], ["hitPoisonArea", /hit poison area[^-\d]*(-?\d+)/],
  ["hitFireArea", /hit fire area[^-\d]*(-?\d+)/], ["hitColdArea", /hit cold area[^-\d]*(-?\d+)/],
  ["hitEnergyArea", /hit energy area[^-\d]*(-?\d+)/], ["hitPhysArea", /hit physical area[^-\d]*(-?\d+)/],
  ["mageWeapon", /mage weapon[^-\d]*(-?\d+)/],
];
const FROZEN_PROP_LABELS: Record<string, string> = {
  physResist: "Phys", fireResist: "Fire", coldResist: "Cold", poisonResist: "Poison", energyResist: "Energy",
  hci: "HCI", dci: "DCI", ssi: "SSI", di: "DI", lmc: "LMC", lrc: "LRC", fc: "FC", fcr: "FCR", sdi: "SDI",
  hpi: "HP+", hpRegen: "HPR", stamInc: "Stam+", stamRegen: "SR", manaInc: "Mana+", manaRegen: "MR",
  strBonus: "STR", dexBonus: "DEX", intBonus: "INT", reflectPhys: "RPD", castingFocus: "CF", luck: "Luck",
  hitLifeLeech: "HLL", hitStamLeech: "HSL", hitManaLeech: "HML", hitLowerDef: "HLD", hitLowerAttack: "HLA",
  enhancePotions: "EP", selfRepair: "Self Rep", hitFireball: "Hit Fireball", hitLightning: "Hit Lightning",
  hitHarm: "Hit Harm", hitMagicArrow: "Hit MA", hitDispel: "Hit Dispel", hitPoisonArea: "Poison Area",
  hitFireArea: "Fire Area", hitColdArea: "Cold Area", hitEnergyArea: "Energy Area", hitPhysArea: "Phys Area",
  mageWeapon: "Mage Wpn", psLevel: "PS level", sotPoints: "SoT pts", tagPenalty: "Tag penalty",
  stamPool: "Stam pool", manaPool: "Mana pool", hitsPool: "Hits pool",
};
const FROZEN_NOT_BUILDER_KEYS = new Set(["tagPenalty", "mageWeapon", "psLevel", "sotPoints"]);
const FROZEN_PROP_FULL: Record<string, string> = {
  physResist: "Physical Resist", fireResist: "Fire Resist", coldResist: "Cold Resist", poisonResist: "Poison Resist", energyResist: "Energy Resist",
  hci: "Hit Chance Increase", dci: "Defense Chance Increase", ssi: "Swing Speed Increase", di: "Damage Increase",
  lmc: "Lower Mana Cost", lrc: "Lower Reagent Cost", fc: "Faster Casting", fcr: "Faster Cast Recovery", sdi: "Spell Damage Increase",
  hpi: "Hit Point Increase", hpRegen: "Hit Point Regeneration", stamInc: "Stamina Increase", stamRegen: "Stamina Regeneration",
  manaInc: "Mana Increase", manaRegen: "Mana Regeneration", strBonus: "Strength Bonus", dexBonus: "Dexterity Bonus", intBonus: "Intelligence Bonus",
  reflectPhys: "Reflect Physical Damage", castingFocus: "Casting Focus", luck: "Luck",
  hitLifeLeech: "Hit Life Leech", hitStamLeech: "Hit Stamina Leech", hitManaLeech: "Hit Mana Leech", hitLowerDef: "Hit Lower Defense", hitLowerAttack: "Hit Lower Attack",
  enhancePotions: "Enhance Potions", selfRepair: "Self Repair", hitFireball: "Hit Fireball", hitLightning: "Hit Lightning", hitHarm: "Hit Harm",
  hitMagicArrow: "Hit Magic Arrow", hitDispel: "Hit Dispel", hitPoisonArea: "Hit Poison Area", hitFireArea: "Hit Fire Area", hitColdArea: "Hit Cold Area",
  hitEnergyArea: "Hit Energy Area", hitPhysArea: "Hit Physical Area", mageWeapon: "Mage Weapon", psLevel: "Power scroll level (the skill cap it raises to)", sotPoints: "Scroll of Transcendence skill points", tagPenalty: "Penalty for Cursed / Brittle / Antique / Prized tags",
  stamPool: "Stamina from gear: DEX bonus + Stamina Increase", manaPool: "Mana from gear: INT bonus + Mana Increase",
  hitsPool: "Hit points from gear: STR bonus ÷ 2 + Hit Point Increase",
};
const FROZEN_EXTRA_COLS: Record<string, [string, string]> = { strReq: ["STR req", "Strength Requirement"], weight: ["Wt", "Weight (stones)"] };

test("[fast] properties: every list derived from the registry equals the literal it replaced", () => {
  // Order counts for the patterns (the first match wins: Spell Damage before Damage Increase) and the extra columns.
  assert.deepEqual(PROP_PATTERNS, FROZEN_PROP_PATTERNS);
  assert.deepEqual(PROP_LABELS, FROZEN_PROP_LABELS);
  assert.deepEqual(PROP_FULL, FROZEN_PROP_FULL);
  assert.deepEqual(NOT_BUILDER_KEYS, FROZEN_NOT_BUILDER_KEYS);
  assert.deepEqual(EXTRA_COLS, FROZEN_EXTRA_COLS);
  assert.deepEqual(Object.keys(EXTRA_COLS), Object.keys(FROZEN_EXTRA_COLS));
});

test("[fast] properties: every key in the registry is unique", () => {
  const keys = PROPERTIES.map((p) => p.key);
  assert.equal(new Set(keys).size, keys.length);
});

test("[fast] properties: every builtin shard rules file caps only known properties", () => {
  const known = new Set<string>(PROPERTIES.map((p) => p.key));
  const files = readdirSync(join(HERE, "rules")).filter((f) => f.endsWith(".json"));
  assert.ok(files.length >= 2, files.join(", "));
  for (const f of files) {
    const rules = JSON.parse(readFileSync(join(HERE, "rules", f), "utf8")) as { caps: Record<string, number> };
    for (const k of Object.keys(rules.caps)) assert.ok(known.has(k), `${f}: caps.${k} is not a property key`);
  }
});
