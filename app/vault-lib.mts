// vault-lib.mts — Pack Rat shared logic: tooltip parsing, slot classification, snapshot folding,
// optimizer pool building and requirement reports. Used by index.html (browser, via the
// server) and gear-vault.test.mjs (Node). No dependencies, no DOM.
//
// Shard rules (property caps, the Resisting Spells resist-bonus formula, race cap overrides, tag-
// penalty units, the rarity ladder, the gargoyle race-lock policy) live in app/rules/<shard>.json,
// loaded (Node-only, by app/rules.mts) and handed in here with setRules() — this module never reads
// a rules file itself, so it stays usable in the browser. getRules() throws until setRules() has run:
// a forgotten call must be loud, not a silent wrong answer.
import { parseStamp } from "./scan-schema.mts";
import type { RulesV1, ScanV2, ScanV2Adapter } from "./schema/types.d.mts";

// ---------------------------------------------------------------------------
// Shared shapes. Declared once here — the inventory/item types every later task (the server, the
// page's modules) imports.
// ---------------------------------------------------------------------------

// A tooltip line's parsed numeric property may carry a single value, or (durability-style) a
// [current, max] pair — the only two shapes parseTooltip's `num` line ever produces.
export type ExtraValue = number | [number, number];
export type PropMap = Record<string, number>;
export type ExtrasMap = Record<string, ExtraValue>;

export interface ParsedTooltip {
  name: string;
  props: PropMap;
  tags: string[];
  strReq: number;
  rarity: string | null;
  extras: ExtrasMap;
  flags: string[];
  twoHanded: boolean | null;
  weight: number | null;
  skillReq: string | null;
  lines: string[];
}

export interface ClassifyResult {
  slot: string | null;
  twoHanded: boolean;
  gear: boolean;
}

// The location a folded item currently reports, computed by locationOf() once the whole fold is
// done (every item needs every container to be folded first, since a path can cross several).
export interface ItemLocation {
  kind: string | null | undefined;
  character: string;
  text: string;
  root: number | null;
  rootName?: string | undefined;
}

// The enriched item shape every fold entry becomes (enrich()'s return, plus `location`, set in a
// second pass by foldSnapshots once the whole container tree is known — see the comment there).
export interface Item {
  serial: number;
  name: string;
  graphic?: number | null | undefined;
  hue?: number | null | undefined;
  amount: number;
  props: PropMap;
  extras: ExtrasMap;
  flags: string[];
  tags: string[];
  strReq: number;
  rarity: string | null;
  weight: number | null;
  skillReq: string | null;
  lines: string[];
  gargoyle: boolean;
  slayers: string[];
  medable: boolean;
  slot: string | null;
  twoHanded: boolean;
  gear: boolean;
  kind: string;
  root: number | null;
  container: number | null;
  equippedBy: string | null;
  layer: string | null;
  seenAt: string;
  scannedBy: string;
  location?: ItemLocation | undefined;
}

// A folded container entry: a raw scan container plus the two stamps every fold adds.
export interface Container {
  serial: number;
  kind?: string | null | undefined;
  name?: string | undefined;
  parent?: number | null | undefined;
  root: number;
  tooltip?: string[] | undefined;
  scannedBy: string;
  scannedAt: string;
}

export interface Character {
  name: string;
  stats: Record<string, unknown>;
  scannedAt: string;
  equipped: number[];
  position: Record<string, unknown> | null;
  maxes: Record<string, unknown> | null;
  resists: Record<string, unknown> | null;
  skills: Record<string, unknown>;
  adapter: ScanV2Adapter | null;
}

export interface ScanSummary {
  character: string;
  scannedAt: string;
  items: number;
  roots: number[];
}

export interface Inventory {
  characters: Record<string, Character>;
  containers: Record<string, Container>;
  items: Record<string, Item>;
  scans: ScanSummary[];
}

// What propertyKeys()/gearSkills() actually read — just `.items`, either the fold's Record form or
// the plain array item-query.mts's facetsOf() passes ({items} over an already-filtered Item[]).
export interface ItemsLike {
  items: Record<string, Item> | Item[];
}

let RULES: RulesV1 | null = null;
export function setRules(r: RulesV1) { RULES = r; }
export function getRules(): RulesV1 {
  if (!RULES) throw new Error("rules not loaded — call setRules() first (see app/rules.mts)");
  return RULES;
}

// ---------------------------------------------------------------------------
// Tooltip parsing. ORDER MATTERS: FCR before FC, Spell Damage before Damage Increase — the same
// property table the TazUO adapter scripts use in-game, so both sides agree on property keys.
// ---------------------------------------------------------------------------
export const PROP_PATTERNS: Array<[string, RegExp]> = [
  ["physResist", /physical resist\D*(\d+)/], ["fireResist", /fire resist\D*(\d+)/],
  ["coldResist", /cold resist\D*(\d+)/], ["poisonResist", /poison resist\D*(\d+)/],
  ["energyResist", /energy resist\D*(\d+)/],
  ["fcr", /faster cast recovery\D*(\d+)/], ["fc", /faster casting\D*(\d+)/],
  ["sdi", /spell damage increase\D*(\d+)/], ["di", /damage increase\D*(\d+)/],
  ["hci", /hit chance increase\D*(\d+)/], ["dci", /defense chance increase\D*(\d+)/],
  ["ssi", /swing speed increase\D*(\d+)/],
  ["lmc", /lower mana cost\D*(\d+)/], ["lrc", /lower reagent cost\D*(\d+)/],
  ["hpi", /hit point increase\D*(\d+)/], ["hpRegen", /hit point regeneration\D*(\d+)/],
  ["stamInc", /stamina increase\D*(\d+)/], ["stamRegen", /stamina regeneration\D*(\d+)/],
  ["manaInc", /mana increase\D*(\d+)/], ["manaRegen", /mana regeneration\D*(\d+)/],
  ["strBonus", /strength bonus\D*(\d+)/], ["dexBonus", /dexterity bonus\D*(\d+)/],
  ["intBonus", /intelligence bonus\D*(\d+)/],
  ["reflectPhys", /reflect physical damage\D*(\d+)/],
  ["castingFocus", /casting focus\D*(\d+)/], ["luck", /^luck\D*(\d+)/],
  ["hitLifeLeech", /hit life leech\D*(\d+)/], ["hitStamLeech", /hit stamina leech\D*(\d+)/],
  ["hitManaLeech", /hit mana leech\D*(\d+)/], ["hitLowerDef", /hit lower defense\D*(\d+)/],
  ["hitLowerAttack", /hit lower attack\D*(\d+)/],
  ["enhancePotions", /enhance potions\D*(\d+)/], ["selfRepair", /self repair\D*(\d+)/],
  ["hitFireball", /hit fireball\D*(\d+)/], ["hitLightning", /hit lightning\D*(\d+)/],
  ["hitHarm", /hit harm\D*(\d+)/], ["hitMagicArrow", /hit magic arrow\D*(\d+)/],
  ["hitDispel", /hit dispel\D*(\d+)/], ["hitPoisonArea", /hit poison area\D*(\d+)/],
  ["hitFireArea", /hit fire area\D*(\d+)/], ["hitColdArea", /hit cold area\D*(\d+)/],
  ["hitEnergyArea", /hit energy area\D*(\d+)/], ["hitPhysArea", /hit physical area\D*(\d+)/],
];

export const PROP_LABELS: Record<string, string> = {
  physResist: "Phys", fireResist: "Fire", coldResist: "Cold", poisonResist: "Poison", energyResist: "Energy",
  hci: "HCI", dci: "DCI", ssi: "SSI", di: "DI", lmc: "LMC", lrc: "LRC", fc: "FC", fcr: "FCR", sdi: "SDI",
  hpi: "HP+", hpRegen: "HPR", stamInc: "Stam+", stamRegen: "SR", manaInc: "Mana+", manaRegen: "MR",
  strBonus: "STR", dexBonus: "DEX", intBonus: "INT", reflectPhys: "RPD", castingFocus: "CF", luck: "Luck",
  hitLifeLeech: "HLL", hitStamLeech: "HSL", hitManaLeech: "HML", hitLowerDef: "HLD", hitLowerAttack: "HLA",
  enhancePotions: "EP", selfRepair: "Self Rep", hitFireball: "Hit Fireball", hitLightning: "Hit Lightning",
  hitHarm: "Hit Harm", hitMagicArrow: "Hit MA", hitDispel: "Hit Dispel", hitPoisonArea: "Poison Area",
  hitFireArea: "Fire Area", hitColdArea: "Cold Area", hitEnergyArea: "Energy Area", hitPhysArea: "Phys Area",
  tagPenalty: "Tag penalty",
  stamPool: "Stam pool", manaPool: "Mana pool", hitsPool: "Hits pool",
};

// Full names for the abbreviations, shown as hover tooltips in the app.
export const PROP_FULL: Record<string, string> = {
  physResist: "Physical Resist", fireResist: "Fire Resist", coldResist: "Cold Resist", poisonResist: "Poison Resist", energyResist: "Energy Resist",
  hci: "Hit Chance Increase", dci: "Defense Chance Increase", ssi: "Swing Speed Increase", di: "Damage Increase",
  lmc: "Lower Mana Cost", lrc: "Lower Reagent Cost", fc: "Faster Casting", fcr: "Faster Cast Recovery", sdi: "Spell Damage Increase",
  hpi: "Hit Point Increase", hpRegen: "Hit Point Regeneration", stamInc: "Stamina Increase", stamRegen: "Stamina Regeneration",
  manaInc: "Mana Increase", manaRegen: "Mana Regeneration", strBonus: "Strength Bonus", dexBonus: "Dexterity Bonus", intBonus: "Intelligence Bonus",
  reflectPhys: "Reflect Physical Damage", castingFocus: "Casting Focus", luck: "Luck",
  hitLifeLeech: "Hit Life Leech", hitStamLeech: "Hit Stamina Leech", hitManaLeech: "Hit Mana Leech", hitLowerDef: "Hit Lower Defense", hitLowerAttack: "Hit Lower Attack",
  enhancePotions: "Enhance Potions", selfRepair: "Self Repair", hitFireball: "Hit Fireball", hitLightning: "Hit Lightning", hitHarm: "Hit Harm",
  hitMagicArrow: "Hit Magic Arrow", hitDispel: "Hit Dispel", hitPoisonArea: "Hit Poison Area", hitFireArea: "Hit Fire Area", hitColdArea: "Hit Cold Area",
  hitEnergyArea: "Hit Energy Area", hitPhysArea: "Hit Physical Area", tagPenalty: "Penalty for Cursed / Brittle / Antique / Prized tags",
  stamPool: "Stamina from gear: DEX bonus + Stamina Increase", manaPool: "Mana from gear: INT bonus + Mana Increase",
  hitsPool: "Hit points from gear: STR bonus ÷ 2 + Hit Point Increase",
};

// Skill names as they appear in tooltips (lower-cased). A "+10 Magery" line on an item becomes the builder property
// "sk:magery", so skill bonuses can be weighted, floored or forbidden like any other property.
export const SKILL_NAMES: string[] = ["alchemy", "anatomy", "animal lore", "animal taming", "archery", "arms lore", "begging", "blacksmithy", "bushido",
  "camping", "carpentry", "cartography", "chivalry", "cooking", "detecting hidden", "discordance", "evaluating intelligence", "evaluate intelligence",
  "fencing", "fishing", "fletching", "bowcraft/fletching", "focus", "forensic evaluation", "healing", "herding", "hiding", "imbuing", "inscription",
  "item identification", "lockpicking", "lumberjacking", "mace fighting", "magery", "meditation", "mining", "musicianship", "mysticism", "necromancy",
  "ninjitsu", "parrying", "peacemaking", "poisoning", "provocation", "remove trap", "resisting spells", "snooping", "spellweaving", "spirit speak",
  "stealing", "stealth", "swordsmanship", "tactics", "tailoring", "taste identification", "throwing", "tinkering", "tracking", "veterinary", "wrestling"];
const SKILL_SET = new Set(SKILL_NAMES);
const titleCase = (x: string): string => x.replace(/\b\w/g, (c) => c.toUpperCase());
export const labelOf = (k: string): string => (k.startsWith("sk:") ? "+" + titleCase(k.slice(3)) : PROP_LABELS[k] || k);
export const fullOf = (k: string): string => (k.startsWith("sk:") ? `${titleCase(k.slice(3))} skill bonus from items` : PROP_FULL[k] || k);

export const RESIST_KEYS: string[] = ["physResist", "fireResist", "coldResist", "poisonResist", "energyResist"];
// A shard's Resisting Spells bonus, from its rules file's resistSkillBonus.breakpoints (uoalive: +0.4/pt
// to 100, +0.2/pt 100-120; a shard with no such bonus ships an empty breakpoints array).  Each
// breakpoint is [to, rate]: rate applies to the slice of skill between the previous breakpoint and
// `to`. Breakpoints must be given in ascending `to` order.
export function resistSkillBonus(skills: Record<string, unknown> | null | undefined): number {
  // skills is Record<string, unknown> (the scan schema leaves per-skill shape loose); every skill
  // entry this repo ever reads or writes is {base, value, cap} (see the CLAUDE.md note on
  // player.getSkill), so this narrows once at the read instead of scattering `as` down the line.
  const v = (skills?.["Resisting Spells"] as { value?: number } | undefined)?.value || 0;
  let prev = 0, bonus = 0;
  for (const [to, rate] of getRules().resistSkillBonus.breakpoints as Array<[number, number]>) { bonus += rate * Math.max(0, Math.min(v, to) - prev); prev = to; }
  return Math.floor(bonus);
}

// The optimizer's profile for one character, as given (weights/floors are what the caller chose; caps are not
// resolved yet — effectiveProfile() below is what turns this into caps a search can use).
export interface Profile {
  caps?: Record<string, number> | undefined;
  floors?: Record<string, number> | undefined;
  softFloors?: string[] | undefined;
  weights?: Record<string, number> | undefined;
  floorBonus?: number | undefined;
  race?: string | null | undefined;
}
export interface EffectiveProfile {
  weights: Record<string, number>;
  caps: Record<string, number>;
  floors: Record<string, number>;
  floorBonus: number;
  hardFloors: string[];
  resistBonus: number;
}
// The optimizer's profile for one character. Resist floors and caps are written in paperdoll terms (what the
// character sheet shows): the character's Resisting Spells bonus is subtracted so the search works on item totals,
// and a race can raise a resist's cap (rules.raceCaps, e.g. an Elf's Energy cap). Every floor not marked soft is hard.
export function effectiveProfile(p: Profile = {}, character: Character | null = null): EffectiveProfile {
  const rules = getRules();
  const rsb = resistSkillBonus(character?.skills);
  const caps: Record<string, number> = { ...rules.caps as Record<string, number>, ...(p.caps || {}) };
  const floors: Record<string, number> = { ...(p.floors || {}) };
  for (const k of RESIST_KEYS) {
    const raceCap = (rules.raceCaps as Record<string, Record<string, number>>)?.[p.race as string]?.[k] ?? (rules.caps as Record<string, number>)[k] ?? 70;
    caps[k] = Math.max(0, raceCap - rsb);
    if (floors[k] != null) floors[k] = Math.max(0, Math.min(floors[k], raceCap) - rsb);
  }
  const hardFloors = Object.keys(floors).filter((k) => !(p.softFloors || []).includes(k));
  return { weights: { ...(p.weights || {}) }, caps, floors, floorBonus: p.floorBonus ?? 1000, hardFloors, resistBonus: rsb };
}

// Cursed/Brittle/Antique/Prized (/Massive/Unwieldy on shards that use them) tag-penalty units, from
// the shard's rules file. A function, not a constant, because it must reflect whichever shard is
// currently loaded (setRules() may be called again after a shard switch).
export const tagUnits = (): Record<string, number> => getRules().tagUnits as Record<string, number>;
const RARITY_RE = /^(minor|lesser|greater|major|legendary) (magic item|artifact)$|^reforged|artifact$/i;

const stripHtml = (s: unknown): string => String(s || "").replace(/<[^>]+>/g, "").trim();

// Returns { name, props, tags, strReq, rarity, extras, flags, lines }.
//   props  : modeled numeric properties (optimizer keys)
//   extras : every other numeric line as { "swordsmanship": 10, "durability": [57, 57] ... }
//   flags  : non-numeric lines (lowercased), e.g. "spell channeling", "mage armor", "orc slayer"
export function parseTooltip(rawLines?: Array<string | undefined> | undefined): ParsedTooltip {
  const TU = tagUnits();
  const lines = (rawLines || []).map(stripHtml).filter(Boolean);
  const name = (lines[0] || "").replace(/^\d+\s+(?=\S)/, "");
  const props: PropMap = {}, extras: ExtrasMap = {}, flags: string[] = [], tags: string[] = [];
  let strReq = 0, rarity: string | null = null, twoHanded: boolean | null = null, weight: number | null = null, skillReq: string | null = null;
  for (const raw of lines.slice(1)) {
    const line = raw.toLowerCase();
    if (Object.prototype.hasOwnProperty.call(TU, line)) { tags.push(line); continue; }
    if (RARITY_RE.test(raw)) { rarity = raw; continue; }
    let m;
    if ((m = line.match(/strength requirement\D*(\d+)/))) { strReq = +m[1]!; continue; }
    if ((m = line.match(/^weight\D*(\d+)/))) { weight = +m[1]!; continue; }
    if (/^two-handed weapon/.test(line)) { twoHanded = true; continue; }
    if (/^one-handed weapon/.test(line)) { twoHanded = false; continue; }
    if ((m = line.match(/^skill required\W*(.+)$/))) { skillReq = m[1]!.trim(); continue; }
    if ((m = line.match(/^durability\D*(\d+)\D+(\d+)/))) { extras.durability = [+m[1]!, +m[2]!]; continue; }
    let matched = false;
    for (const [key, pat] of PROP_PATTERNS) {
      const mm = line.match(pat);
      if (mm) { props[key] = (props[key] || 0) + +mm[1]!; matched = true; break; }
    }
    if (matched) continue;
    const num = line.match(/^(.*?)[\s:+]*(-?\d+(?:\.\d+)?)\s*(%|s)?\s*(?:-\s*(\d+))?$/);
    if (num && num[1]!.trim()) {
      const key = num[1]!.trim().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ");
      extras[key] = num[4] ? [+num[2]!, +num[4]] : +num[2]!;
    } else {
      flags.push(line);
    }
  }
  if (tags.length) props.tagPenalty = tags.reduce((a, t) => a + TU[t]!, 0);
  return { name, props, tags, strReq, rarity, extras, flags, twoHanded, weight, skillReq, lines };
}

// ---------------------------------------------------------------------------
// Slot classification by NAME (UO base names are standardized). Layer wins when the item is
// equipped; the tooltip's "Two-handed Weapon" line wins over the name regex when present.
// ---------------------------------------------------------------------------
const WEAPON_RE = /\b(scimitar|katana|longsword|broadsword|viking sword|cutlass|cleaver|bone harvester|machete|no-dachi|double axe|war axe|battle axe|large battle axe|two handed axe|executioner|ornate axe|hatchet|axe|bardiche|halberd|paladin sword|radiant|dagger|kryss|war fork|short spear|spear|pike|pitchfork|leafblade|boning knife|sai|tekagi|mace|maul|club|war hammer|hammer pick|scepter|diamond mace|tessen|nunchaku|black staff|quarter staff|staff|bow|crossbow|yumi|longbow|composite|lance|scythe|knife|sledge hammer|soul glaive|cyclone|boomerang|glass sword|glass staff|stone war sword|crook|crescent blade|wakizashi|daisho|bokuto|lajatang|kama|tetsubo|war cleaver|spellblade|rune blade|war mace|bloodblade|dread sword|dual short axes|dual pointed spear|shortblade|longblade|talwar|disc mace|serpentstone staff|wild staff|gnarled staff|sword|blade)\b/i;
const TWO_H_RE = /\b(two handed|double axe|large battle axe|bardiche|halberd|no-dachi|executioner|maul|war hammer|black staff|quarter staff|bow|crossbow|yumi|longbow|composite|scythe|pike|war fork|spear|lance|lajatang|tetsubo|daisho|bokuto|gnarled staff|wild staff|serpentstone staff|soul glaive|dual pointed spear|dual short axes|sledge hammer|scepter|glass staff)\b/i;
const SHIELD_RE = /\b(shield|buckler)\b/i;
const SPELLBOOK_RE = /\b(spellbook|book of (chivalry|bushido|ninjitsu|magery|necromancy|mysticism|spellweaving)|necromancer spellbook|mysticism book|tome)\b/i;   // NOT bare "mystic": "Mystic Ring" is a ring
const JEWEL_SLOTS: Array<[string, RegExp]> = [["ring", /\bring\b/i], ["bracelet", /\bbracelet\b/i], ["talisman", /\btalisman\b/i], ["neck", /\bnecklace\b/i], ["earrings", /\bearrings\b/i]];
const ARMOR_SLOTS: Array<[string, RegExp]> = [
  ["helmet", /\b(helm|helmet|bascinet|circlet|coif|cap|hat|mask|skullcap|bandana|bonnet|hood|glasses|goggles|hatsuburi|jingasa|kabuto)\b/i],
  ["neck", /\b(gorget|mempo)\b/i],
  ["hands", /\b(gloves|gauntlets)\b/i],
  ["arms", /\b(sleeves|vambraces|rerebrace|pauldrons|hiro sode)\b/i],
  ["legs", /\b(leggings|chausses|greaves|kilt|shorts|haidate|suneate|leg guards|tonlet)\b/i],
  ["cloak", /\bcloak\b/i],
  ["feet", /\b(sandals|boots|shoes|thigh boots|tabi)\b/i],
  ["robe", /\b(robe|surcoat|tunic top|shroud)\b/i],
  ["chest", /\b(armor|tunic|breastplate|hauberk|ringmail|chainmail|platemail|plate|hide|doublet|do|chest|jacket|shirt|vest|bustier|female plate)\b/i],
  ["waist", /\b(sash|apron|obi|half apron|belt)\b/i],
];
const SKIP_RE = /\b(bandage|potion|reagent|ore|ingot|log|board|scroll|deed|gold|arrow|bolt|garlic|ginseng|mandrake|nightshade|bloodmoss|sulfurous|black pearl|key|map|gem|cloth|feather|shaft|kindling|torch|lantern|fish|powder|essence|seed|runebook|bag of|pouch|backpack|chest of|crate|box|bottle|jar|token|ticket|coin|doubloon|bone pile|bark|sap|ingots|jewelry box)\b/i;
export const LAYER_TO_SLOT: Record<string, string> = {
  OneHanded: "oneHanded", TwoHanded: "twoHanded", Helmet: "helmet", Gloves: "hands", Arms: "arms",
  Legs: "legs", Pants: "legs", Necklace: "neck", Ring: "ring", Bracelet: "bracelet", Talisman: "talisman",
  Torso: "chest", Cloak: "cloak", Shoes: "feet", Robe: "robe", Earrings: "earrings", Waist: "waist",
  Tunic: "chest", Shirt: "shirt", Skirt: "legs",
};
export const OPTIMIZER_SLOTS: string[] = ["helmet", "chest", "arms", "hands", "legs", "neck", "ring", "bracelet", "talisman", "cloak", "oneHanded", "twoHanded"];
export const SLOT_LABELS: Record<string, string> = {
  helmet: "Head", chest: "Chest", arms: "Arms", hands: "Hands", legs: "Legs", neck: "Neck", ring: "Ring",
  bracelet: "Bracelet", talisman: "Talisman", cloak: "Cloak", oneHanded: "Weapon (1H)", twoHanded: "Weapon 2H / Shield",
  feet: "Feet", robe: "Robe", earrings: "Earrings", waist: "Waist", shirt: "Shirt", spellbook: "Spellbook",
};

const SPELL_NAMES = new Set(("clumsy,create food,feeblemind,heal,magic arrow,night sight,reactive armor,weaken,agility,cunning,cure,harm,magic trap,magic untrap,protection,strength,bless,fireball,magic lock,poison,telekinesis,teleport,unlock,wall of stone,arch cure,arch protection,curse,fire field,greater heal,lightning,mana drain,recall,blade spirits,dispel field,incognito,magic reflection,mind blast,paralyze,poison field,summon creature,dispel,energy bolt,explosion,invisibility,mark,mass curse,paralyze field,reveal,chain lightning,energy field,flamestrike,gate travel,mana vampire,mass dispel,meteor swarm,polymorph,earthquake,energy vortex,resurrection,air elemental,summon daemon,earth elemental,fire elemental,water elemental,summon air elemental,summon earth elemental,summon fire elemental,summon water elemental,"
  + "animate dead,blood oath,corpse skin,curse weapon,evil omen,horrific beast,lich form,mind rot,pain spike,poison strike,strangle,summon familiar,vampiric embrace,vengeful spirit,wither,wraith form,exorcism,"
  + "nether bolt,healing stone,purge magic,enchant,sleep,eagle strike,animated weapon,stone form,spell trigger,mass sleep,cleansing winds,bombard,spell plague,hail storm,nether cyclone,rising colossus,"
  + "cleanse by fire,close wounds,consecrate weapon,divine fury,dispel evil,enemy of one,holy light,noble sacrifice,remove curse,sacred journey,"
  + "honorable execution,confidence,evasion,counter attack,lightning strike,momentum strike,focus attack,death strike,animal form,ki attack,surprise attack,backstab,shadowjump,mirror image,"
  + "arcane circle,gift of renewal,immolating weapon,attune weapon,thunderstorm,nature's fury,summon fey,summon fiend,reaper form,wildfire,essence of wind,dryad allure,ethereal voyage,word of death,gift of life,arcane empowerment").split(","));
// Returns { slot, twoHanded, gear } — gear=false for consumables/resources/unknown names.
export function classify(name: string | null | undefined, parsed?: ParsedTooltip | null | undefined, layer?: string | null | undefined): ClassifyResult {
  const n = name || "";
  let slot = null, two = false;
  if (layer && LAYER_TO_SLOT[layer]) {
    slot = LAYER_TO_SLOT[layer]!;
    two = slot === "twoHanded" && !SHIELD_RE.test(n) && (parsed?.twoHanded ?? TWO_H_RE.test(n));
    return { slot, twoHanded: two, gear: true };
  }
  if (SPELL_NAMES.has(n.toLowerCase().trim())) return { slot: null, twoHanded: false, gear: false };   // spell scrolls are named after the spell
  if (SPELLBOOK_RE.test(n)) return { slot: "oneHanded", twoHanded: false, gear: true };
  if (SKIP_RE.test(n)) return { slot: null, twoHanded: false, gear: false };
  if (SHIELD_RE.test(n)) return { slot: "twoHanded", twoHanded: false, gear: true };
  if (WEAPON_RE.test(n) || parsed?.twoHanded !== null && parsed?.twoHanded !== undefined || parsed?.skillReq) {
    two = parsed?.twoHanded ?? TWO_H_RE.test(n);
    return { slot: two ? "twoHanded" : "oneHanded", twoHanded: two, gear: true };
  }
  for (const [s, rx] of JEWEL_SLOTS) if (rx.test(n)) return { slot: s, twoHanded: false, gear: true };
  for (const [s, rx] of ARMOR_SLOTS) if (rx.test(n)) return { slot: s, twoHanded: false, gear: true };
  // Unknown name but carries item properties: still gear, slot unknown.
  const hasProps = parsed && Object.keys(parsed.props).some((k) => k !== "tagPenalty");
  return { slot: null, twoHanded: false, gear: !!hasProps };
}

// ---------------------------------------------------------------------------
// Snapshot folding. Snapshots are immutable facts written by packrat-scanner.py; the
// inventory is the fold of all of them in time order: a later scan of a root container replaces
// everything previously known under that root, and a character's equipped set is replaced whole.
// ---------------------------------------------------------------------------

// scan.containers is Record<string, unknown> in the generated schema (deliberately loose — see
// scan.v2.schema.json's own $comment on why `containers`/`stats`/etc. aren't walked field by
// field). Every scan actually writes container entries shaped like this; narrowed once here, at
// the fold's read boundary, rather than scattered as `as` down every line that reads `c.foo`.
interface ScanContainerRaw {
  serial: number;
  kind?: string | null | undefined;
  name?: string | undefined;
  parent?: number | null | undefined;
  root: number;
  tooltip?: string[] | undefined;
}

// The minimal shape enrich()'s `raw` argument needs — satisfied by a ScanV2ItemsItem, a
// ScanV2EquippedItem, or the bag literal foldSnapshots builds for a container-turned-item.
interface EnrichRaw {
  serial: number;
  name?: string | undefined;
  tooltip?: string[] | undefined;
  graphic?: number | null | undefined;
  hue?: number | null | undefined;
  amount?: number | undefined;
}
interface EnrichLoc {
  root: number | null;
  container: number | null;
  equippedBy: string | null;
  layer: string | null;
  seenAt: string;
  scannedBy: string;
}

export function foldSnapshots(snapshots: ScanV2[]): Inventory {
  const inv: Inventory = { characters: {}, containers: {}, items: {}, scans: [] };
  const sorted = [...snapshots].sort((a, b) => parseStamp(a.scannedAt) - parseStamp(b.scannedAt));
  for (const snap of sorted) {
    if (snap.schemaVersion !== 2) throw new Error("foldSnapshots needs v2 scans — call upgradeScan first");
    const char = snap.character;
    // A root with opened:false (open failed — too far, locked) is still listed in snap.roots, but
    // carries no items; it must be treated exactly like a root the snapshot didn't mention at all —
    // i.e. excluded from the replace-per-root set below — so the fold keeps whatever it last knew
    // about that root instead of wiping it. Only opened:true roots (the historical v1→v2 upgrade
    // stamps every root opened:true, so old scans are unaffected) participate in replace-per-root.
    const roots = new Set((snap.roots || []).filter((r) => r.opened !== false).map((r) => +r.serial));
    for (const [serial, it] of Object.entries(inv.items)) {
      if ((it.equippedBy === char) || (it.root != null && roots.has(+it.root))) delete inv.items[serial];
    }
    for (const [serial, c] of Object.entries(inv.containers)) if (roots.has(+c.root)) delete inv.containers[serial];
    const snapContainers = (snap.containers || {}) as Record<string, ScanContainerRaw>;
    for (const c of Object.values(snapContainers)) {
      if (!roots.has(+c.root)) continue;
      inv.containers[c.serial] = { ...c, scannedBy: char, scannedAt: snap.scannedAt };
    }
    for (const c of Object.values(snapContainers)) {
      if (c.parent == null || !roots.has(+c.root)) continue;   // roots (chests, backpack, bank) are places, not things
      if (c.kind != null && c.kind !== "container" && c.kind !== "bag") continue;   // old scans said "bag"; a later scanner says "container"
      const bag = enrich({ serial: c.serial, name: bagLabel(c), tooltip: [bagLabel(c), ...(c.tooltip || [c.name]).slice(1)] as string[], amount: 1 },
        { root: +c.root, container: +c.parent, equippedBy: null, layer: null, seenAt: snap.scannedAt, scannedBy: char });
      if (!SPELLBOOK_RE.test(c.name || "") && !/runebook|runic atlas/i.test(c.name || "")) {   // a bag engraved "DEXXER armor" is still a bag
        bag.gear = false; bag.slot = null; bag.kind = "container";
      }
      inv.items[c.serial] = bag;
    }
    for (const raw of snap.items || []) {
      const c = snapContainers[raw.container] || Object.values(snapContainers).find((x) => +x.serial === +raw.container);
      const root = c ? +c.root : null;
      if (root == null || !roots.has(root)) continue;
      inv.items[raw.serial] = enrich(raw, { root, container: +raw.container, equippedBy: null, layer: null, seenAt: snap.scannedAt, scannedBy: char });
    }
    for (const raw of snap.equipped || []) {
      inv.items[raw.serial] = enrich(raw, { root: null, container: null, equippedBy: char, layer: raw.layer || null, seenAt: snap.scannedAt, scannedBy: char });
    }
    if (!String(char).startsWith("_")) {   // "_vault" tombstones are not characters
      inv.characters[char] = { name: char, stats: snap.stats || {}, scannedAt: snap.scannedAt,
        equipped: (snap.equipped || []).map((e) => +e.serial), position: snap.position || null,
        maxes: snap.maxes || null, resists: snap.resists || null, skills: snap.skills || {}, adapter: snap.adapter || null };
    }
    inv.scans.push({ character: char, scannedAt: snap.scannedAt, items: (snap.items || []).length, roots: [...roots] });
  }
  for (const it of Object.values(inv.items)) it.location = locationOf(it, inv);
  return inv;
}

function enrich(raw: EnrichRaw, loc: EnrichLoc): Item {
  const parsed = parseTooltip(raw.tooltip && raw.tooltip.length ? raw.tooltip : [raw.name]);
  const cls = classify(parsed.name || raw.name, parsed, loc.layer);
  return {
    serial: +raw.serial, name: parsed.name || raw.name || "", graphic: raw.graphic, hue: raw.hue, amount: raw.amount || 1,
    props: parsed.props, extras: parsed.extras, flags: parsed.flags, tags: parsed.tags, strReq: parsed.strReq,
    rarity: parsed.rarity, weight: parsed.weight, skillReq: parsed.skillReq, lines: parsed.lines,
    gargoyle: /\bgargish\b/i.test(parsed.name || raw.name || "") || parsed.flags.includes("gargoyles only"),
    slayers: slayersOf(parsed.flags),
    medable: medableOf(parsed.name || raw.name || "", cls.slot, cls.gear, parsed.flags),
    slot: cls.slot, twoHanded: cls.twoHanded, gear: cls.gear, kind: cls.gear ? "gear" : kindOf(parsed.name || raw.name, parsed), ...loc,
  };
}

export function containerPath(serial: number | null, inv: Inventory): string[] {
  const names = [];
  // A null serial (an item whose location was never resolved to a real container) looks up
  // inv.containers["null"] the same way the pre-TypeScript code did by indexing with `null`
  // directly — never matches, `cur` comes back undefined, and the loop below simply doesn't run.
  let cur: Container | null | undefined = inv.containers[serial as number], guard = 0;
  while (cur && guard++ < 8) {
    names.unshift(bagLabel(cur));
    cur = cur.parent != null ? inv.containers[cur.parent] : null;
  }
  return names;
}

interface BagLabelSource {
  tooltip?: string[] | undefined;
  name?: string | undefined;
  serial: number;
}
export function bagLabel(c: BagLabelSource): string {
  const eng = (c.tooltip || []).map(stripHtml).find((l) => /engraved|^\[.*\]$/i.test(l));
  if (eng) return eng.replace(/^engraved:?\s*/i, "").trim();
  return c.name || `0x${(+c.serial).toString(16)}`;
}

export function locationOf(it: Item, inv: Inventory): ItemLocation {
  if (it.equippedBy) return { kind: "equipped", character: it.equippedBy, text: `Worn by ${it.equippedBy}`, root: null };
  // Same null-as-string-key quirk as containerPath above: it.root can be null, and the lookup just
  // misses (root comes back undefined), which the ternaries below already treat as "unknown/?".
  const root = inv.containers[it.root as number];
  const path = containerPath(it.container, inv);
  const kind = root ? root.kind : "unknown";
  const owner = root ? root.scannedBy : "?";
  let text;
  if (kind === "backpack") text = `${owner}'s backpack` + (path.length > 1 ? " › " + path.slice(1).join(" › ") : "");
  else if (kind === "bank") text = `${owner}'s bank` + (path.length > 1 ? " › " + path.slice(1).join(" › ") : "");
  else text = path.join(" › ") || "unknown";
  return { kind, character: owner, text, root: it.root, rootName: root ? bagLabel(root) : "?" };
}

// ---------------------------------------------------------------------------
// Optimizer pools. `current` = the character's worn set by optimizer slot; pools = every wearable
// candidate (this character's own worn items included), excluding other characters' worn gear
// unless allowed, STR-gated, tag-filtered.
// ---------------------------------------------------------------------------
export interface OptItem {
  serial: number;
  name: string;
  slot: string | null;
  props: PropMap;
  twoHanded?: true | undefined;
}
export interface BuildPoolsOptions {
  allowOthersWorn?: boolean | undefined;
  strength?: number | undefined;
  excludeTags?: string[] | undefined;
  excludeRoots?: Array<number | string> | undefined;
  excludeGargoyle?: boolean | undefined;
  medOnly?: boolean | undefined;
  weaponSkill?: string | null | undefined;
  excludeSkills?: string[] | undefined;
}
export interface SkippedLists {
  str: Item[]; tags: Item[]; worn: Item[]; roots: Item[]; gargoyle: Item[]; nonMed: Item[]; weapon: Item[]; skill: Item[];
}
export interface BuildPoolsResult {
  pools: Partial<Record<string, OptItem[]>>;
  current: Partial<Record<string, OptItem>>;
  skipped: SkippedLists;
  blocked: string[];
}
export function buildPools(inv: Inventory, character: string, opts: BuildPoolsOptions = {}): BuildPoolsResult {
  const { allowOthersWorn = false, strength = Infinity, excludeTags = [], excludeRoots = [], excludeGargoyle = getRules().raceLock.gargoyleOnly, medOnly = false, weaponSkill = null, excludeSkills = [] } = opts;
  const pools: Partial<Record<string, OptItem[]>> = {}, current: Partial<Record<string, OptItem>> = {}, skipped: SkippedLists = { str: [], tags: [], worn: [], roots: [], gargoyle: [], nonMed: [], weapon: [], skill: [] };
  const exRoots = new Set(excludeRoots.map(Number));
  for (const it of Object.values(inv.items)) {
    if (!it.gear || !it.slot || !OPTIMIZER_SLOTS.includes(it.slot)) continue;
    const opt = toOptItem(it);
    if (it.equippedBy === character) { if (!current[it.slot]) current[it.slot] = opt; }
    if (it.equippedBy && it.equippedBy !== character && !allowOthersWorn) { skipped.worn.push(it); continue; }
    if (excludeGargoyle && it.gargoyle) { skipped.gargoyle.push(it); continue; }
    if (medOnly && !it.medable) { skipped.nonMed.push(it); continue; }
    if (!weaponAllowed(it, weaponSkill)) { skipped.weapon.push(it); continue; }
    if (hasSkillBonus(it, excludeSkills)) { skipped.skill.push(it); continue; }
    if (it.strReq > strength) { skipped.str.push(it); continue; }
    if (it.tags.some((t) => excludeTags.includes(t))) { skipped.tags.push(it); continue; }
    if (it.root != null && exRoots.has(+it.root)) { skipped.roots.push(it); continue; }
    (pools[it.slot] ||= []).push(opt);
  }
  // A worn piece the filters rule out (wrong weapon type, a forbidden skill bonus) must not stay a candidate through
  // the "keep what you wear" rule.
  const blocked = OPTIMIZER_SLOTS.filter((sl) => {
    const it = current[sl] ? inv.items[current[sl]!.serial] || ({} as Item) : null;
    return it && (!weaponAllowed(it, weaponSkill) || hasSkillBonus(it, excludeSkills));
  });
  return { pools, current, skipped, blocked };
}
// True when the item carries a bonus to any of the listed skills (e.g. the Summoner's forbidden Necromancy).
export function hasSkillBonus(it: Item, skills: string[] = []): boolean {
  return skills.length > 0 && Object.entries(it.extras || {}).some(([k, v]) => skills.includes(k) && typeof v === "number" && v > 0);
}
// Keys the suit builder can weight or floor besides the plain item properties: the stamina/mana/hits pools and every
// skill bonus found on gear. gearSkills lists the skills that appear as bonuses (for the forbid chips).
export function gearSkills(inv: ItemsLike): string[] {
  const set = new Set<string>();
  for (const it of Object.values(inv.items)) if (it.gear) for (const [k, v] of Object.entries(it.extras || {})) if (SKILL_SET.has(k) && typeof v === "number" && v) set.add(k);
  return [...set].sort();
}
export function builderKeys(inv: ItemsLike): string[] {
  return ["stamPool", "manaPool", "hitsPool", ...gearSkills(inv).map((k) => `sk:${k}`)];
}

// Weapon-type filter for the suit builder. With a skill chosen, the hands hold only weapons of that skill, plus a
// shield unless the skill is archery (every bow and crossbow is two-handed). Spellbooks and other weapons drop out.
export const WEAPON_SKILLS: string[] = ["archery", "swordsmanship", "fencing", "mace fighting", "throwing"];
export function weaponAllowed(it: Item, skill: string | null | undefined): boolean {
  if (!skill || (it.slot !== "oneHanded" && it.slot !== "twoHanded")) return true;
  const req = String(it.skillReq || "").toLowerCase();
  if (req) return req === skill;
  return skill !== "archery" && it.slot === "twoHanded" && !it.twoHanded;
}

// Templates: a full set of builder settings with no character in them (no race, STR limit or skipped containers).
// A character's profile keeps its own working copy plus `template`, the name it was applied from; drift between the
// two is settingsDiff(templateFrom(template), templateFrom(profile)).
export const TEMPLATE_KEYS: string[] = ["floors", "softFloors", "weights", "floorBonus", "lockedSlots", "excludeTags", "excludeSkills", "allowOthersWorn", "allowGargoyle", "medOnly", "weaponSkill"];
export interface TemplateSource {
  floors?: Record<string, number> | undefined;
  softFloors?: string[] | undefined;
  weights?: Record<string, number> | undefined;
  floorBonus?: number | undefined;
  lockedSlots?: string[] | undefined;
  excludeTags?: string[] | undefined;
  excludeSkills?: string[] | undefined;
  allowOthersWorn?: boolean | undefined;
  allowGargoyle?: boolean | undefined;
  medOnly?: boolean | undefined;
  weaponSkill?: string | null | undefined;
}
export interface Template {
  floors: Record<string, number>;
  softFloors: string[];
  weights: Record<string, number>;
  floorBonus: number;
  lockedSlots: string[];
  excludeTags: string[];
  excludeSkills: string[];
  allowOthersWorn: boolean;
  allowGargoyle: boolean;
  medOnly: boolean;
  weaponSkill: string | null;
}
export function templateFrom(s: TemplateSource = {}): Template {
  return { floors: { ...(s.floors || {}) }, softFloors: [...(s.softFloors || [])], weights: { ...(s.weights || {}) }, floorBonus: s.floorBonus ?? 1000,
    lockedSlots: [...(s.lockedSlots || [])], excludeTags: [...(s.excludeTags || [])], excludeSkills: [...(s.excludeSkills || [])],
    allowOthersWorn: !!s.allowOthersWorn, allowGargoyle: !!s.allowGargoyle, medOnly: !!s.medOnly, weaponSkill: s.weaponSkill || null };
}

// A profiles.json character entry, loosely — every field optional, TemplateSource's builder settings
// plus the bits a character carries that a template doesn't (which template it came from, race, a STR
// limit, and a v1 file's inline caps, dropped by the migration below).
export interface CharacterEntryRaw extends TemplateSource {
  archetype?: string | undefined;
  template?: string | undefined;
  race?: string | null | undefined;
  strLimit?: number | undefined;
  caps?: unknown;
}
// The profiles.json shape this module reads/writes across its schemaVersion 1 → 2 migration —
// deliberately loose (mirrors profiles.v2.schema.json's own $comment: additionalProperties is true
// throughout, so an unrecognized field must round-trip unharmed). `[key: string]: unknown` lets a
// caller's extra top-level field (the file's own `_comment`, say) pass through `{...file}` untouched.
export interface ProfilesFile {
  schemaVersion?: number | undefined;
  templates?: Record<string, Template> | undefined;
  archetypes?: Record<string, TemplateSource> | undefined;
  characters?: Record<string, CharacterEntryRaw> | undefined;
  caps?: unknown;
  [key: string]: unknown;
}
// Profiles-file migration: `archetypes` (weights + floors, bound to a character by its `archetype`) became `templates`,
// and the binding is the character's `template` (schemaVersion 1). `caps` (the global property-cap object) moved out
// of profiles.json into the shard's rules file (schemaVersion 2) — a v1 file's `caps` is simply dropped; nothing reads
// it once the file is at v2 (effectiveProfile takes caps from getRules() now). Pure: a file already at schemaVersion 2
// in the new shape comes back equal, changed false.
export function migrateProfiles(file: ProfilesFile = {}): { profiles: ProfilesFile; changed: boolean } {
  let changed = false;
  const out: ProfilesFile = { ...file };
  if (!out.templates) { out.templates = Object.fromEntries(Object.entries(out.archetypes || {}).map(([n, a]) => [n, templateFrom(a)])); changed = true; }
  if ("archetypes" in out) { delete out.archetypes; changed = true; }
  out.characters = { ...(out.characters || {}) };
  for (const [name, c] of Object.entries(out.characters)) {
    if (!("archetype" in c)) continue;
    const { archetype, ...rest } = c;
    out.characters[name] = { ...rest, template: c.template || archetype };
    changed = true;
  }
  if (out.schemaVersion == null) { out.schemaVersion = 1; changed = true; }
  if (out.schemaVersion! < 2) {
    if ("caps" in out) { delete out.caps; changed = true; }
    out.schemaVersion = 2; changed = true;
  }
  return { profiles: out, changed };
}

// A saved run's builder settings — the "everything a run can differ by" shape settingsDiff compares.
// Looser than Template: a run also carries excludeRoots/race/strLimit/search knobs a template never does.
export interface RunSettings {
  floors?: Record<string, number> | undefined;
  weights?: Record<string, number> | undefined;
  softFloors?: string[] | undefined;
  lockedSlots?: string[] | undefined;
  excludeTags?: string[] | undefined;
  excludeRoots?: Array<number | string> | undefined;
  race?: string | undefined;
  excludeSkills?: string[] | undefined;
  allowGargoyle?: boolean | undefined;
  medOnly?: boolean | undefined;
  allowOthersWorn?: boolean | undefined;
  exact?: boolean | undefined;
  weaponSkill?: string | undefined;
  strLimit?: number | undefined;
  restarts?: number | undefined;
  budgetMs?: number | undefined;
  altCount?: number | undefined;
  altTol?: number | undefined;
}
// What changed between two saved runs' builder settings, as short readable lines (b relative to a).
export function settingsDiff(a: RunSettings = {}, b: RunSettings = {}): string[] {
  const out: string[] = [];
  const L = labelOf;
  for (const [group, noun] of [["floors", "floor"], ["weights", "weight"]] as const) {
    const A: Record<string, number> = a[group] || {}, B: Record<string, number> = b[group] || {};
    for (const k of [...new Set([...Object.keys(A), ...Object.keys(B)])].sort()) {
      if (!(k in A)) out.push(`${L(k)} ${noun} ${B[k]} added`);
      else if (!(k in B)) out.push(`${L(k)} ${noun} ${A[k]} removed`);
      else if (A[k] !== B[k]) out.push(`${L(k)} ${noun} ${A[k]} → ${B[k]}`);
    }
  }
  const setDiff = <T,>(x: T[] = [], y: T[] = []): [T[], T[]] => [y.filter((v) => !x.includes(v)), x.filter((v) => !y.includes(v))];
  const [softOn, softOff] = setDiff(a.softFloors, b.softFloors);
  for (const k of softOn) if ((b.floors || {})[k] != null) out.push(`${L(k)} floor made soft`);
  for (const k of softOff) if ((b.floors || {})[k] != null) out.push(`${L(k)} floor made hard`);
  const [lockOn, lockOff] = setDiff(a.lockedSlots, b.lockedSlots);
  if (lockOn.length) out.push(`locked ${lockOn.map((x) => SLOT_LABELS[x] || x).join(", ")}`);
  if (lockOff.length) out.push(`unlocked ${lockOff.map((x) => SLOT_LABELS[x] || x).join(", ")}`);
  const [tagOn, tagOff] = setDiff(a.excludeTags, b.excludeTags);
  if (tagOn.length) out.push(`excluding ${tagOn.join(", ")}`);
  if (tagOff.length) out.push(`allowing ${tagOff.join(", ")}`);
  const [rootOn, rootOff] = setDiff(a.excludeRoots, b.excludeRoots);
  if (rootOn.length || rootOff.length) out.push("skipped containers changed");
  if ((a.race || "human") !== (b.race || "human")) out.push(`race ${a.race || "human"} → ${b.race || "human"}`);
  const [skOn, skOff] = setDiff(a.excludeSkills, b.excludeSkills);
  if (skOn.length) out.push(`forbidding ${skOn.join(", ")} bonuses`);
  if (skOff.length) out.push(`allowing ${skOff.join(", ")} bonuses`);
  const flag = (k: "allowGargoyle" | "medOnly" | "exact", on: string, off: string) => { if (!!a[k] !== !!b[k]) out.push(b[k] ? on : off); };
  flag("allowGargoyle", "gargoyle gear allowed", "gargoyle gear excluded");
  flag("medOnly", "meditation-safe only", "meditation-safe off");
  const others = (s: RunSettings) => !!s.allowOthersWorn;   // a saved run is normalized to allowOthersWorn before it ever reaches here
  if (others(a) !== others(b)) out.push(others(b) ? "others' worn gear allowed" : "others' worn gear excluded");
  flag("exact", "exact search on", "exact search off");
  if ((a.weaponSkill || "") !== (b.weaponSkill || "")) out.push(`weapons ${a.weaponSkill || "any"} → ${b.weaponSkill || "any"}`);
  if (a.strLimit !== b.strLimit && b.strLimit != null) out.push(`STR limit ${a.strLimit ?? "?"} → ${b.strLimit}`);
  if (a.restarts !== b.restarts && b.restarts != null) out.push(`restarts ${a.restarts ?? "?"} → ${b.restarts}`);
  if (a.budgetMs !== b.budgetMs && b.budgetMs != null && b.exact) out.push(`budget ${(a.budgetMs ?? 0) / 1000} s → ${b.budgetMs / 1000} s`);
  if (a.altCount !== b.altCount && b.altCount != null) out.push(`other suits ${a.altCount ?? 0} → ${b.altCount}`);
  if (a.altTol !== b.altTol && b.altTol != null) out.push(`other suits within ${a.altTol ?? 0} → ${b.altTol} points`);
  return out;
}

export function toOptItem(it: Item): OptItem {
  const props: PropMap = { ...it.props };
  const sum = (a: string, b: string) => (props[a] || 0) + (props[b] || 0);
  if (sum("dexBonus", "stamInc")) props.stamPool = sum("dexBonus", "stamInc");
  if (sum("intBonus", "manaInc")) props.manaPool = sum("intBonus", "manaInc");
  const hits = (props.strBonus || 0) / 2 + (props.hpi || 0);
  if (hits) props.hitsPool = hits;
  for (const [k, v] of Object.entries(it.extras || {})) if (SKILL_SET.has(k) && typeof v === "number" && v) props[`sk:${k}`] = v;
  const o: OptItem = { serial: it.serial, name: it.name, slot: it.slot, props };
  if (it.twoHanded) o.twoHanded = true;
  return o;
}

export function totalsOf(assignment: Partial<Record<string, OptItem | null | undefined>> | null | undefined): PropMap {
  const t: PropMap = {};
  for (const it of Object.values(assignment || {})) if (it) for (const [k, v] of Object.entries(it.props || {})) t[k] = (t[k] || 0) + v;
  return t;
}

export interface RequirementProfileInput {
  floors?: Record<string, number> | undefined;
  caps?: Record<string, number> | undefined;
  weights?: Record<string, number> | undefined;
}
export interface RequirementRow {
  key: string;
  label: string;
  value: number;
  floor: number | null;
  cap: number | null;
  met: boolean | null;
  capped: boolean;
  over: number;
}
// Requirement report: for every floor and every cap, what the suit reaches.
export function requirementReport(totals: PropMap, profile: RequirementProfileInput): RequirementRow[] {
  const rows: RequirementRow[] = [];
  const floors = profile.floors || {}, caps = profile.caps || {};
  const keys = new Set([...Object.keys(floors), ...Object.keys(profile.weights || {})]);
  keys.delete("tagPenalty");
  for (const k of [...keys].sort((a, b) => (floors[b] ? 1 : 0) - (floors[a] ? 1 : 0) || a.localeCompare(b))) {
    const v = totals[k] || 0, floor = floors[k], cap = caps[k];
    rows.push({ key: k, label: labelOf(k), value: v, floor: floor ?? null, cap: cap ?? null,
      met: floor == null ? null : v >= floor, capped: cap != null && v >= cap, over: cap != null ? Math.max(0, v - cap) : 0 });
  }
  return rows;
}

// Property universe across the inventory (for the filter UI).
export function propertyKeys(inv: ItemsLike): string[] {
  const set = new Set<string>();
  for (const it of Object.values(inv.items)) {
    for (const k of Object.keys(it.props || {})) set.add(k);
  }
  set.delete("tagPenalty");
  return [...set].sort((a, b) => (PROP_LABELS[a] || a).localeCompare(PROP_LABELS[b] || b));
}

export function itemSearchBlob(it: Item): string {
  return [it.name, ...(it.lines || []), it.location?.text || "", it.rarity || "", it.kind || ""].join(" \n ").toLowerCase();
}

// ---------------------------------------------------------------------------
// Item kinds for everything that is not wearable gear. First match wins; names are UO base names.
// ---------------------------------------------------------------------------
export const KINDS: string[] = ["gear", "reagent", "potion", "scroll", "refinement", "resource", "gem", "ammo", "food", "tool", "bandage", "currency", "map", "book", "rune", "deed", "container", "key", "clothing", "other"];
const KIND_RULES: Array<[string, RegExp]> = [
  ["reagent", /\b(black pearl|bloodmoss|blood moss|garlic|ginseng|mandrake|nightshade|spiders?'? ?silk|sulfurous ash|bat ?wing|grave dust|daemon blood|nox crystal|pig iron|dragon'?s blood|fertile dirt|reagent)\b/i],
  ["potion", /\b(potion|keg|elixir|balm|salve|lotion)\b/i],
  ["bandage", /\bbandage/i],
  ["currency", /\b(gold coin|gold|doubloon|silver|token|coin|check|bank check)\b/i],
  ["scroll", /\b(scroll|powerscroll|scroll of)\b/i],
  ["map", /\bmap\b/i],
  ["rune", /\b(rune|runebook|runic atlas|moonstone)\b/i],
  ["book", /\b(book|tome|journal|primer|compendium)\b/i],
  ["deed", /\b(deed|commodity|certificate|voucher|ticket)\b/i],
  ["key", /\b(key|keyring|key ring)\b/i],
  ["gem", /\b(diamond|ruby|sapphire|star sapphire|emerald|amethyst|citrine|tourmaline|amber|gem|gems|jewel)\b/i],
  ["ammo", /\b(arrow|arrows|bolt|bolts|crossbow bolt|shuriken|fukiya dart|throwing)\b/i],
  ["resource", /\b(ingot|ingots|ore|log|logs|board|boards|leather|hides|hide|cloth|bolt of cloth|yarn|thread|feather|feathers|shaft|shafts|cotton|wool|flax|kindling|granite|sand|bone|bones|scale|scales|blank scroll|blank map|fabric|silk|pelt|fur|resin|sap|bark|wood|essence|powder|dust|crystal|shard|fragment|ectoplasm|glass|bottle|bottles|empty bottle|jar|nails|hinge|gear|axle|spring|clock parts|sextant parts|barrel|pile of|stack of|bundle)\b/i],
  ["food", /\b(fish|steak|steaks|bread|cheese|apple|apples|meat|ham|egg|eggs|cake|pie|ribs|sausage|bacon|wine|ale|beer|liquor|milk|water|pitcher|cookie|cookies|grapes|pear|peach|banana|carrot|onion|cabbage|lettuce|pumpkin|squash|watermelon|honey|cooked|raw|muffin|chicken|lamb|bird|turkey|fruit|vegetable|dough|flour|jerky|stew|soup|candy|pretzel)\b/i],
  ["tool", /\b(pickaxe|shovel|tongs|smith'?s hammer|sewing kit|tinker'?s tools|mortar|pestle|fletcher'?s tools|scissors|skinning knife|lockpick|lockpicks|mapmaker'?s pen|saw|dovetail|jointing plane|moulding plane|draw knife|froe|inshave|scorp|rolling pin|flour sifter|skillet|pen|ink|fishing pole|hammer|loom|spinning wheel|anvil|forge|tool|tools|axe|pick)\b/i],
  ["container", /\b(bag|pouch|box|chest|crate|backpack|basket|trunk|armoire|cabinet|quiver)\b/i],
  ["clothing", /\b(shirt|doublet|surcoat|tunic|dress|gown|kilt|skirt|sash|apron|robe|cloak|hat|cap|bandana|bonnet|boots|sandals|shoes|thigh boots|gloves|half apron|body sash|obi|kimono|hakama|jin-?baori)\b/i],
];
const REFINEMENT_RE = /\b(wash|varnish|polish|cure|gloss|scour|lacquer|resin) of (defense|protection|hardening|fortification|invulnerability)\b/i;
export function kindOf(name: string | null | undefined, parsed?: ParsedTooltip | null | undefined): string {
  const n = name || "";
  if (SPELL_NAMES.has(n.toLowerCase().trim())) return "scroll";
  if (REFINEMENT_RE.test(n)) return "refinement";
  for (const [kind, rx] of KIND_RULES) if (rx.test(n)) return kind;
  const hasProps = parsed && Object.keys(parsed.props || {}).some((k) => k !== "tagPenalty");
  return hasProps ? "gear" : "other";
}

// Slayer lines are plain flags: "Orc Slayer", "Silver" (= undead), the super slayers "Repond" (humanoid),
// "Exorcism" (demon/gargoyle), "Elemental Ban", plus the odd classic names. Returns display names.
const SLAYER_ALIASES: Record<string, string> = { silver: "Undead (Silver)", repond: "Repond (humanoids)", exorcism: "Exorcism (demons)", "elemental ban": "Elemental Ban", "elemental health": "Elemental Health",
  "dragon slaying": "Dragon", "orc slaying": "Orc", "troll slaughter": "Troll", "lizardman slaughter": "Lizardman", "flame dousing": "Fire Elemental", "water dissipation": "Water Elemental",
  "vacuum": "Air Elemental", "earth shatter": "Earth Elemental", "blood drinking": "Blood Elemental", "summer wind": "Snow Elemental", "snake's bane": "Snake", "scorpion's bane": "Scorpion",
  "spider's death": "Spider", "terathan": "Terathan", "ophidian": "Ophidian", "balron damnation": "Balron", "gargoyle's foe": "Gargoyle", "fey slayer": "Fey" };
export function slayersOf(flags: string[] | null | undefined): string[] {
  const out = [];
  for (const f of flags || []) {
    const m = f.match(/^(.+?) slayer$/);
    if (m) { out.push(m[1]!.replace(/\b\w/g, (c) => c.toUpperCase())); continue; }
    if (SLAYER_ALIASES[f]) out.push(SLAYER_ALIASES[f]!);
  }
  return out;
}

// Meditation rule (ServUO): armour materials with MeditationAllowance None/Half block or halve mana regen unless the
// piece has Mage Armor; a held weapon or shield blocks it unless Spell Channeling (spellbooks are fine). Jewellery,
// cloaks, talismans and cloth never interfere.
const ARMOR_SLOT_SET = new Set(["helmet", "chest", "arms", "hands", "legs", "neck", "feet", "robe", "waist", "shirt"]);
// material words that always block meditation (platemail, chain, bone, studded …)
const NONMED_RE = /\b(platemail|plate|chainmail|chain|ringmail|bone|dragon|woodland|studded|metal|stone|verite|valorite|agapite|bronze|copper|shadow iron|dull copper|gold|scale)\b/i;
// material words that mean leather/cloth (meditation allowed) — checked before the helm list
const MED_MATERIAL_RE = /\b(leather|hide|leaf|cloth|straw|silk|fur|skullcap|bandana|bonnet|hood|mask|hat|cap|robe|sash|apron|doublet|shirt|tunic|skirt|kilt|sandals|boots|shoes|circlet|glasses|goggles|shroud|tabi|bustier)\b/i;
// metal helms whose names carry no material word
const METAL_HELM_RE = /\b(norse helm|close helm|close helmet|helmet|helm|bascinet|kabuto|hatsuburi|jingasa|coif)\b/i;
export function medableOf(name: string, slot: string | null | undefined, gear: boolean, flags: string[] | null | undefined): boolean {
  if (!gear) return true;
  const f = flags || [];
  if (slot === "oneHanded" || slot === "twoHanded") {
    if (/\b(spellbook|book of|tome)\b/i.test(name)) return true;
    return f.includes("spell channeling");
  }
  if (!ARMOR_SLOT_SET.has(slot as string)) return true;
  if (f.includes("mage armor")) return true;
  if (NONMED_RE.test(name)) return false;
  if (MED_MATERIAL_RE.test(name)) return true;
  if (METAL_HELM_RE.test(name)) return false;
  return true;
}

// Group rows by name (+kind): total pieces, stack count, and where they are.
export interface ItemGroup {
  name: string;
  kind: string;
  slot: string | null;
  amount: number;
  stacks: number;
  locations: Map<string, number>;
  items: Item[];
}
export function groupByName(items: Item[]): ItemGroup[] {
  const g = new Map<string, ItemGroup>();
  for (const it of items) {
    const key = `${it.name}|${it.kind}`;
    const row: ItemGroup = g.get(key) || { name: it.name, kind: it.kind, slot: it.slot, amount: 0, stacks: 0, locations: new Map(), items: [] };
    row.amount += it.amount || 1; row.stacks++; row.items.push(it);
    const loc = it.location?.text || "?";
    row.locations.set(loc, (row.locations.get(loc) || 0) + (it.amount || 1));
    g.set(key, row);
  }
  return [...g.values()];
}
