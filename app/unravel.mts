// unravel.mts — what unraveling a piece at a soul forge gives (issue #271): which pieces can be unraveled (unravelType), the
// imbuing weight the ingredient comes from (unravelWeight, ServUO Imbuing.GetTotalWeight with the imbuing maxes), and what a
// character with a given Imbuing gets for that weight (unravelYield). The thresholds, gates and base-resist guesses are the
// rules' `unravel` block, so a correction is a data change. Also why a piece is left out of the suggestions by default
// (leftOutReasons) and how many ingredients a list of stacks holds (onHand). No DOM, no node: imports: served to the browser
// as it stands, like item-query.mts.
import { SKILL_NAMES, SLOT_GROUP } from "./vault-lib.mts";
import type { Item } from "./vault-lib.mts";
import type { RulesV1 } from "./schema/types.d.mts";

export type UnravelType = "weapon" | "ranged" | "armor" | "shield" | "hat" | "jewel";
export const INGREDIENTS = ["Relic Fragment", "Enchanted Essence", "Magical Residue"] as const;
export type Ingredient = typeof INGREDIENTS[number];

// ---------------------------------------------------------------- which pieces
const NOT_GEAR_RE = /\b(spellbook|book|tome|grimoire|compendium|talisman|totem|quiver)\b/i;
const NECKLACE_RE = /\b(necklace|amulet|pendant|beads)\b/i;
const SHIELD_RE = /\b(shield|buckler)\b/i;
// Hats are clothing in ServUO (BaseHat), with a higher base resist than a helmet; a leather cap is armor.
const HAT_RE = /\b(hat|bandana|skullcap|bonnet|garland|mask|kasa|cap)\b/i;
// A weapon, armor piece, shield, hat or piece of jewelry can be unraveled. Everything else is null: robes, cloaks, shirts,
// shoes and other clothing, talismans, spellbooks and quivers.
export function unravelType(it: Pick<Item, "gear" | "name" | "slot" | "extras" | "flags" | "skillReq">): UnravelType | null {
  if (!it.gear || NOT_GEAR_RE.test(it.name) || it.flags?.some((f) => /^\d[\d,]* spells$/.test(f))) return null;
  if (it.extras?.["weapon speed"] != null || it.skillReq) return /^(archery|throwing)$/.test(it.skillReq || "") ? "ranged" : "weapon";
  if (SHIELD_RE.test(it.name)) return "shield";
  // The slot's group (vault-lib.mts): a talisman's slot is in Jewelry, and the neck in Armor, holding a necklace too.
  const slot = it.slot || "", group = SLOT_GROUP[slot];
  if ((group === "Jewelry" && slot !== "talisman") || (slot === "neck" && NECKLACE_RE.test(it.name))) return "jewel";
  if (slot === "helmet" && HAT_RE.test(it.name) && !/\bleather cap\b/i.test(it.name)) return "hat";
  return group === "Armor" ? "armor" : null;
}

// ---------------------------------------------------------------- the property weights
// A property's ServUO imbuing weight and its imbuing max, by Pack Rat key: it adds trunc(weight / max × value). `max` is a
// number, or one per item type where the max depends on it (HCI, DCI and DI), or "leech" for Hit Life and Mana Leech, whose max
// comes from the weapon's speed. Resists, slayers, skill bonuses and Mage Weapon are worked out on their own below.
type Max = number | Partial<Record<UnravelType | "other", number>> | "leech";
export const PROPERTY_WEIGHTS: Record<string, { weight: number; max: Max }> = {
  hci: { weight: 130, max: { other: 15, ranged: 25 } },
  dci: { weight: 110, max: { other: 15, ranged: 25 } },
  di: { weight: 100, max: { other: 50, jewel: 25, shield: 35 } },
  hpRegen: { weight: 100, max: 2 }, stamRegen: { weight: 100, max: 3 }, manaRegen: { weight: 100, max: 2 },
  strBonus: { weight: 110, max: 8 }, dexBonus: { weight: 110, max: 8 }, intBonus: { weight: 110, max: 8 },
  hpi: { weight: 110, max: 5 }, stamInc: { weight: 110, max: 8 }, manaInc: { weight: 110, max: 8 },
  ssi: { weight: 110, max: 30 }, sdi: { weight: 100, max: 12 }, fcr: { weight: 120, max: 3 }, fc: { weight: 140, max: 1 },
  lmc: { weight: 110, max: 8 }, lrc: { weight: 100, max: 20 }, reflectPhys: { weight: 100, max: 15 }, enhancePotions: { weight: 100, max: 25 },
  luck: { weight: 100, max: 100 }, selfRepair: { weight: 100, max: 5 }, castingFocus: { weight: 140, max: 3 },
  hitLifeLeech: { weight: 110, max: "leech" }, hitManaLeech: { weight: 110, max: "leech" }, hitStamLeech: { weight: 100, max: 50 },
  hitLowerAttack: { weight: 110, max: 50 }, hitLowerDef: { weight: 130, max: 50 },
  hitPhysArea: { weight: 100, max: 50 }, hitFireArea: { weight: 100, max: 50 }, hitColdArea: { weight: 100, max: 50 }, hitPoisonArea: { weight: 100, max: 50 }, hitEnergyArea: { weight: 100, max: 50 },
  hitMagicArrow: { weight: 120, max: 50 }, hitHarm: { weight: 110, max: 50 }, hitFireball: { weight: 140, max: 50 }, hitLightning: { weight: 140, max: 50 }, hitDispel: { weight: 100, max: 50 },
};
// Numeric tooltip lines no property models (item.extras), by their lower-cased wording.
export const EXTRA_WEIGHTS: Record<string, { weight: number; max: number }> = {
  "lower requirements": { weight: 100, max: 100 }, velocity: { weight: 140, max: 50 }, "splintering weapon": { weight: 140, max: 30 },
  "hit fatigue": { weight: 140, max: 50 }, "hit mana drain": { weight: 140, max: 50 }, "soul charge": { weight: 140, max: 30 },
  "fire eater": { weight: 140, max: 15 }, "cold eater": { weight: 140, max: 15 }, "poison eater": { weight: 140, max: 15 },
  "energy eater": { weight: 140, max: 15 }, "kinetic eater": { weight: 140, max: 15 }, "damage eater": { weight: 140, max: 15 },
};
// Yes/no properties (item.flags): their weight, or one for melee and one for ranged weapons (Balanced).
export const FLAG_WEIGHTS: Record<string, number | { melee: number; ranged: number }> = {
  "spell channeling": 100, "night sight": 50, balanced: { melee: 100, ranged: 150 }, "use best weapon skill": 150,
  "blood drinker": 140, "battle lust": 140, "reactive paralyze": 140, "searing weapon": 150, "mage armor": 0,
};
export const RESIST_KEYS = ["physResist", "fireResist", "coldResist", "poisonResist", "energyResist"] as const;
// A resist point weighs 100 / 15; a skill-bonus point 140 / 15, divided as integers first (ServUO CheckSkillBonuses), so 9.
const RESIST = { weight: 100, max: 15 }, SKILL_POINT = 9;
const SLAYER = 100, SUPER_SLAYER = 130;
const SKILLS = new Set(SKILL_NAMES);
// Weight per unit times value, truncated per property; the epsilon keeps 100 / 15 × 15 at 100.
const part = (weight: number, max: number, value: number): number => (value > 0 && max > 0 ? Math.trunc((weight / max) * value + 1e-9) : 0);

// Hit Life and Mana Leech: trunc(speed × 2500 / (100 + SSI)), halved for a ranged weapon (ServUO Imbuing.GetMaxIntensity).
function leechMax(it: Pick<Item, "extras" | "props">, type: UnravelType): number {
  const speed = it.extras?.["weapon speed"];
  if (typeof speed !== "number" || speed <= 0) return 50;
  const max = Math.trunc((speed * 2500) / (100 + Math.max(0, it.props.ssi || 0)));
  return type === "ranged" ? Math.trunc(max / 2) : max;
}
const maxFor = (max: Max, it: Pick<Item, "extras" | "props">, type: UnravelType): number =>
  max === "leech" ? leechMax(it, type) : typeof max === "number" ? max : max[type] ?? max.other ?? 0;

// The super slayers (a slayerGroups entry's `super`) and the talisman slayers (a titled group) weigh 130, the rest 100.
function superSlayers(rules: Pick<RulesV1, "slayerGroups">): Set<string> {
  const out = new Set<string>();
  for (const g of rules.slayerGroups || []) for (const s of g.super ?? (g.heading ? g.slayers : [])) out.add(s.toLowerCase());
  return out;
}

// The imbuing weight unraveling reads: every positive property's trunc(weight / max × value), slayers, 9 per skill-bonus
// point, and resists (on armor, a hat or a shield only the total above its type's base resist). 0 for a piece that can't
// be unraveled. A Durability +N% bonus has a weight too, but the scans keep no number for it, so it is not counted.
export function unravelWeight(it: Item, rules: Pick<RulesV1, "unravel" | "slayerGroups">): number {
  const type = unravelType(it), u = rules.unravel;
  if (!type || !u) return 0;
  let w = 0;
  for (const [key, value] of Object.entries(it.props)) {
    const p = PROPERTY_WEIGHTS[key];
    if (p) w += part(p.weight, maxFor(p.max, it, type), value);
  }
  // Mage Weapon is kept as the tooltip's −N; the property's value is 30 − N.
  if (it.props.mageWeapon) w += part(100, 10, 30 + it.props.mageWeapon);
  for (const [key, value] of Object.entries(it.extras || {})) {
    if (typeof value !== "number") continue;
    const e = EXTRA_WEIGHTS[key];
    if (e) w += part(e.weight, e.max, value);
    else if (SKILLS.has(key) && value > 0) w += Math.trunc(SKILL_POINT * value);
  }
  for (const f of it.flags || []) {
    const fw = FLAG_WEIGHTS[f];
    if (fw != null) w += typeof fw === "number" ? fw : type === "ranged" ? fw.ranged : fw.melee;
  }
  const supers = superSlayers(rules);
  for (const s of it.slayers || []) w += supers.has(s.toLowerCase()) ? SUPER_SLAYER : SLAYER;
  // Each resist counts on its own, except on armor, a hat or a shield: only the total shows, so it counts above the type's base.
  const base = type === "armor" ? u.baseResist.armor : type === "hat" ? u.baseResist.hat : type === "shield" ? u.baseResist.shield : null;
  if (base == null) for (const k of RESIST_KEYS) w += part(RESIST.weight, RESIST.max, it.props[k] || 0);
  else w += part(RESIST.weight, RESIST.max, RESIST_KEYS.reduce((a, k) => a + Math.max(0, it.props[k] || 0), 0) - base);
  return Math.trunc(w);
}

// ---------------------------------------------------------------- what it gives
// The ingredient a weight gives when its roll succeeds, or null for a weight with no magic in it (the forge refuses it).
export function unravelIngredient(weight: number, rules: Pick<RulesV1, "unravel">): Ingredient | null {
  const u = rules.unravel;
  if (!u || weight <= 0) return null;
  return weight >= u.relicMin ? "Relic Fragment" : weight > u.residueMax ? "Enchanted Essence" : "Magical Residue";
}
// Within the margin of a line between two ingredients: the estimate could land on either side of it.
export function unravelMaybe(weight: number, rules: Pick<RulesV1, "unravel">): boolean {
  const u = rules.unravel;
  return !!u && weight > 0 && (Math.abs(weight - u.residueMax) <= u.maybeMargin || Math.abs(weight - u.relicMin) <= u.maybeMargin);
}

const chanceIn = ([from, to]: number[], skill: number): number => Math.max(0, Math.min(1, (skill - from!) / (to! - from!)));
export interface Amount { ingredient: Ingredient; min: number; max: number }
// What one unravel gives at `skill`: `ingredient` and its amount with `chance`, else `miss` (null when a miss gives nothing
// and keeps the piece). `needsSkill` is the Imbuing the forge asks for before it will try (0 for none); below it, `chance` is 0.
export interface UnravelYield { hit: Amount; chance: number; miss: Amount | null; needsSkill: number }
export function unravelYield(weight: number, skill: number, rules: Pick<RulesV1, "unravel">): UnravelYield | null {
  const u = rules.unravel, ingredient = unravelIngredient(weight, rules);
  if (!u || !ingredient) return null;
  const hundreds = Math.floor(weight / 100);
  const residue: Amount = { ingredient: "Magical Residue", min: Math.max(1, hundreds), max: Math.max(1, hundreds + 1) };
  if (ingredient === "Magical Residue") return { hit: residue, chance: chanceIn(u.residueRoll, skill), miss: null, needsSkill: 0 };
  if (ingredient === "Enchanted Essence") {
    const needs = u.essenceSkill;
    return { hit: { ingredient, min: Math.max(1, hundreds), max: Math.max(1, hundreds) }, chance: skill < needs ? 0 : chanceIn(u.essenceRoll, skill), miss: residue, needsSkill: needs };
  }
  const needs = u.relicSkill;
  return { hit: { ingredient, min: 1, max: 1 }, chance: skill < needs ? 0 : chanceIn(u.relicRoll, skill), miss: { ingredient: "Enchanted Essence", min: Math.max(1, hundreds - 2), max: Math.max(1, hundreds) }, needsSkill: needs };
}

// The ingredients one unravel gives on average at `skill`: nothing while the forge refuses it.
export function expectedYield(weight: number, skill: number, rules: Pick<RulesV1, "unravel">): Record<Ingredient, number> {
  const out: Record<Ingredient, number> = { "Relic Fragment": 0, "Enchanted Essence": 0, "Magical Residue": 0 };
  const y = unravelYield(weight, skill, rules);
  if (!y || skill < y.needsSkill) return out;
  const avg = (a: Amount): number => (a.min + a.max) / 2;
  out[y.hit.ingredient] += y.chance * avg(y.hit);
  if (y.miss) out[y.miss.ingredient] += (1 - y.chance) * avg(y.miss);
  return out;
}

// ---------------------------------------------------------------- left out by default
// Why a piece is left out of the suggestions unless the player asks for it: worn, in a saved Suit Builder run, insured,
// pinned in Organize, imbued, blessed, or kept by the player. In the order the page lists them.
export const LEFT_OUT = ["worn", "build", "insured", "pinned", "imbued", "blessed", "kept"] as const;
export type LeftOut = typeof LEFT_OUT[number];
export interface LeftOutContext { suits: Set<number>; pins: Set<number>; kept: Set<number> }
export function leftOutReasons(it: Item, ctx: LeftOutContext): LeftOut[] {
  const has = (f: string): boolean => it.flags?.includes(f) ?? false;
  const on: Record<LeftOut, boolean> = {
    worn: !!it.equippedBy, build: ctx.suits.has(it.serial), insured: has("insured"), pinned: ctx.pins.has(it.serial),
    imbued: has("(imbued)"), blessed: has("blessed"), kept: ctx.kept.has(it.serial),
  };
  return LEFT_OUT.filter((r) => on[r]);
}

// ---------------------------------------------------------------- on hand
// How many of each ingredient the stacks hold: a stack named for the ingredient, its amount, or a name that starts with the
// count ("205 Enchanted Essence").
export function onHand(items: Array<Pick<Item, "name" | "amount">>): Record<Ingredient, number> {
  const out: Record<Ingredient, number> = { "Relic Fragment": 0, "Enchanted Essence": 0, "Magical Residue": 0 };
  for (const it of items) {
    const m = /^\s*(?:([\d,]+)\s+)?(.+?)\s*$/.exec(it.name);
    const name = (m?.[2] ?? "").toLowerCase().replace(/s$/, "");
    const ing = INGREDIENTS.find((i) => i.toLowerCase() === name);
    if (!ing) continue;
    out[ing] += m?.[1] ? +m[1].replace(/,/g, "") : it.amount || 1;
  }
  return out;
}

// What a candidate row carries (GET /api/items with `unravel`): the ingredient its weight gives, the weight, whether it sits
// near a line, and why it is left out by default (only when it is).
export interface UnravelInfo { ingredient: Ingredient; weight: number; maybe: boolean; leftOut?: LeftOut[] }
export function unravelInfo(it: Item, rules: Pick<RulesV1, "unravel" | "slayerGroups">, leftOut: LeftOut[] = []): UnravelInfo | null {
  const weight = unravelWeight(it, rules), ingredient = unravelIngredient(weight, rules);
  if (!ingredient) return null;
  return { ingredient, weight, maybe: unravelMaybe(weight, rules), ...(leftOut.length ? { leftOut } : {}) };
}
