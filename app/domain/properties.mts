// domain/properties.mts — the property registry (every property key the app knows, in display order) and what is derived from it: the tooltip patterns, labels and full names, a property in words, the typical ranges and importance conversion, skill-bonus names, and the five resists' names.
//
// map: scan
// owns: `PROPERTIES`, `PropKey`, `PROPERTY_CATALOGUE`, `FLAG_CATALOGUE`, `catalogueGroups`, `PROP_PATTERNS`, `PROP_LABELS`, `PROP_FULL`, `NOT_BUILDER_KEYS`, `typicalRange`, `importanceOf`, `weightOfImportance`, `SKILL_NAMES`, `labelOf`, `fullOf`, `propName`, `RESIST_META`, `RESIST_KEYS`
import type { Diagnostic } from "../runs-types.mts";

// A tooltip line's parsed numeric property may carry a single value, or (durability-style) a
// [current, max] pair — the only two shapes parseTooltip's `num` line ever produces.
export type ExtraValue = number | [number, number];
export type PropMap = Record<string, number>;
export type ExtrasMap = Record<string, ExtraValue>;

// ---------------------------------------------------------------------------
// Tooltip parsing. ORDER MATTERS: FCR before FC, Spell Damage before Damage Increase — the same
// property table the TazUO adapter scripts use in-game, so both sides agree on property keys.
// ---------------------------------------------------------------------------
// The property registry: every property key the app knows, in display order (the Suit Builder's rows and the character
// sheet's "Other" group list them in it). A parsed property has the
// tooltip pattern that reads it; the rest are set by parseTooltip itself (psLevel, sotPoints, tagPenalty), by the
// fold (the pools) or read off the item (the "extra" columns). `builder` is whether the Suit Builder's weight and
// requirement rows offer it. `typical` is the span a good suit covers in each property the builder offers: the usual
// shard cap where there is one (a resist's 70), else what a good suit gathers (typicalRange, and so a weight's
// importance, read it). `name` is a derived pool's words wherever the page names it in full (propName), since a pool is no
// shard property and has no shard name. The exports below are derived from it.
type PropKind = "number" | "extra";
interface PropDef<K extends string = string> { key: K; pattern?: RegExp; label: string; full: string; builder: boolean; kind: PropKind; typical?: number; name?: string }
const tip = (text: string): RegExp => new RegExp(`${text}[^-\\d]*(-?\\d+)`);
const parsed = <K extends string>(key: K, text: string, label: string, full: string, builder = true): PropDef<K> => ({ key, pattern: tip(text), label, full, builder, kind: "number" });
const derived = <K extends string>(key: K, label: string, full: string, builder = true): PropDef<K> => ({ key, label, full, builder, kind: "number" });
const extra = <K extends string>(key: K, label: string, full: string): PropDef<K> => ({ key, label, full, builder: false, kind: "extra" });
const typ = <K extends string>(def: PropDef<K>, typical: number): PropDef<K> => ({ ...def, typical });
const named = <K extends string>(def: PropDef<K>, name: string): PropDef<K> => ({ ...def, name });
export const PROPERTIES = [
  typ(parsed("physResist", "physical resist", "Phys", "Physical Resist"), 70), typ(parsed("fireResist", "fire resist", "Fire", "Fire Resist"), 70),
  typ(parsed("coldResist", "cold resist", "Cold", "Cold Resist"), 70), typ(parsed("poisonResist", "poison resist", "Poison", "Poison Resist"), 70),
  typ(parsed("energyResist", "energy resist", "Energy", "Energy Resist"), 70),
  typ(parsed("hci", "hit chance increase", "HCI", "Hit Chance Increase"), 45), typ(parsed("dci", "defense chance increase", "DCI", "Defense Chance Increase"), 45),
  typ(parsed("ssi", "swing speed increase", "SSI", "Swing Speed Increase"), 60), typ(parsed("di", "damage increase", "DI", "Damage Increase"), 100),
  typ(parsed("lmc", "lower mana cost", "LMC", "Lower Mana Cost"), 40), typ(parsed("lrc", "lower reagent cost", "LRC", "Lower Reagent Cost"), 100),
  typ(parsed("fc", "faster casting", "FC", "Faster Casting"), 2), typ(parsed("fcr", "faster cast recovery", "FCR", "Faster Cast Recovery"), 6),
  typ(parsed("sdi", "spell damage increase", "SDI", "Spell Damage Increase"), 100),
  typ(parsed("hpi", "hit point increase", "HP+", "Hit Point Increase"), 25), typ(parsed("hpRegen", "hit point regeneration", "HPR", "Hit Point Regeneration"), 18),
  typ(parsed("stamInc", "stamina increase", "Stam+", "Stamina Increase"), 20), typ(parsed("stamRegen", "stamina regeneration", "SR", "Stamina Regeneration"), 24),
  typ(parsed("manaInc", "mana increase", "Mana+", "Mana Increase"), 20), typ(parsed("manaRegen", "mana regeneration", "MR", "Mana Regeneration"), 30),
  typ(parsed("strBonus", "strength bonus", "STR", "Strength Bonus"), 25), typ(parsed("dexBonus", "dexterity bonus", "DEX", "Dexterity Bonus"), 25),
  typ(parsed("intBonus", "intelligence bonus", "INT", "Intelligence Bonus"), 25),
  typ(parsed("reflectPhys", "reflect physical damage", "RPD", "Reflect Physical Damage"), 50),
  typ(parsed("castingFocus", "casting focus", "CF", "Casting Focus"), 12), typ(parsed("luck", "^luck", "Luck", "Luck"), 500),
  typ(parsed("hitLifeLeech", "hit life leech", "HLL", "Hit Life Leech"), 100), typ(parsed("hitStamLeech", "hit stamina leech", "HSL", "Hit Stamina Leech"), 100),
  typ(parsed("hitManaLeech", "hit mana leech", "HML", "Hit Mana Leech"), 100), typ(parsed("hitLowerDef", "hit lower defense", "HLD", "Hit Lower Defense"), 50),
  typ(parsed("hitLowerAttack", "hit lower attack", "HLA", "Hit Lower Attack"), 50),
  typ(parsed("enhancePotions", "enhance potions", "EP", "Enhance Potions"), 25), typ(parsed("selfRepair", "self repair", "Self Rep", "Self Repair"), 5),
  typ(parsed("hitFireball", "hit fireball", "Hit Fireball", "Hit Fireball"), 50), typ(parsed("hitLightning", "hit lightning", "Hit Lightning", "Hit Lightning"), 50),
  typ(parsed("hitHarm", "hit harm", "Hit Harm", "Hit Harm"), 50), typ(parsed("hitMagicArrow", "hit magic arrow", "Hit MA", "Hit Magic Arrow"), 50),
  typ(parsed("hitDispel", "hit dispel", "Hit Dispel", "Hit Dispel"), 50), typ(parsed("hitPoisonArea", "hit poison area", "Poison Area", "Hit Poison Area"), 50),
  typ(parsed("hitFireArea", "hit fire area", "Fire Area", "Hit Fire Area"), 50), typ(parsed("hitColdArea", "hit cold area", "Cold Area", "Hit Cold Area"), 50),
  typ(parsed("hitEnergyArea", "hit energy area", "Energy Area", "Hit Energy Area"), 50), typ(parsed("hitPhysArea", "hit physical area", "Phys Area", "Hit Physical Area"), 50),
  // Not offered by the builder: an item without a Mage Weapon line reads mageWeapon 0, which beats every mage weapon's
  // negative, so weighting it would reward not being one; psLevel and sotPoints are scrolls', never gear's; tagPenalty
  // carries a fixed weight from the profile. All stay filterable in the Inventory.
  parsed("mageWeapon", "mage weapon", "Mage Wpn", "Mage Weapon", false),
  derived("psLevel", "PS level", "Power scroll level (the skill cap it raises to)", false),
  derived("sotPoints", "SoT pts", "Scroll of Transcendence skill points", false),
  derived("tagPenalty", "Tag penalty", "Penalty for Cursed / Brittle / Antique / Prized tags", false),
  named(typ(derived("stamPool", "Stam pool", "Stamina from gear: DEX bonus + Stamina Increase"), 45), "Stamina from gear and buffs"),
  named(typ(derived("manaPool", "Mana pool", "Mana from gear: INT bonus + Mana Increase"), 45), "Mana from gear and buffs"),
  named(typ(derived("hitsPool", "Hits pool", "Hit points from gear: STR bonus ÷ 2 + Hit Point Increase"), 35), "Hit points from gear and buffs"),
  // Columns computed from an item but not stored under item.props (item-query.mts's EXTRA_COLS).
  extra("strReq", "STR req", "Strength Requirement"), extra("weight", "Wt", "Weight (stones)"),
] as const;
export type PropKey = (typeof PROPERTIES)[number]["key"];
const NUMBER_PROPS = PROPERTIES.filter((p) => p.kind === "number");

// The tooltip reader tries the patterns in registry order, except that these nine go in this order where the first of
// them stands: a longer name before the shorter one it contains (Spell Damage Increase before Damage Increase).
const PARSE_ORDER: PropKey[] = ["fcr", "fc", "sdi", "di", "hci", "dci", "ssi", "lmc", "lrc"];
const parsedProps = PROPERTIES.filter((p) => p.pattern);
const firstOrdered = parsedProps.findIndex((p) => PARSE_ORDER.includes(p.key));
const parseOrdered = parsedProps.filter((p) => !PARSE_ORDER.includes(p.key));
parseOrdered.splice(firstOrdered, 0, ...PARSE_ORDER.map((k) => parsedProps.find((p) => p.key === k)!));
export const PROP_PATTERNS: Array<[string, RegExp]> = parseOrdered.map((p): [string, RegExp] => [p.key, p.pattern!]);
export const PROP_LABELS: Record<string, string> = Object.fromEntries(NUMBER_PROPS.map((p) => [p.key, p.label]));
// Properties the builder's weight and requirement rows never offer (see the registry's note).
export const NOT_BUILDER_KEYS = new Set(NUMBER_PROPS.filter((p) => !p.builder).map((p): string => p.key));
// Full names for the abbreviations, shown as hover tooltips in the app.
export const PROP_FULL: Record<string, string> = Object.fromEntries(NUMBER_PROPS.map((p) => [p.key, p.full]));
// The span a good suit covers in a property (issue #217): the registry's typical, else 15 for a skill bonus; null for a
// property with neither (none the builder offers). A fixed number per property, not a character's or a build's cap, so
// a weight's importance below never changes with the character, buffs or Resisting Spells.
const TYPICAL: Record<string, number> = Object.fromEntries(NUMBER_PROPS.flatMap((p): Array<[string, number]> => (p.typical != null ? [[p.key, p.typical]] : [])));
export function typicalRange(key: string): number | null {
  return TYPICAL[key] ?? (key.startsWith("sk:") ? 15 : null);
}
// A weight's importance (issue #274), the number the Suit Builder shows and edits: how much a good amount of the property
// matters, per-point weight × typical range × IMPORTANCE_K, one stable factor per property. K puts the shipped
// templates' top properties at or near 100 (450 per typical range, as DCI 10 or HCI 10). Profiles, templates, runs and
// the solvers stay per point; these are the only place the two convert. A key with no typical range (the tag penalty)
// shows its per-point weight as it is.
export const IMPORTANCE_K = 2 / 9;
const importanceScale = (key: string): number => (typicalRange(key) ?? 1 / IMPORTANCE_K) * IMPORTANCE_K;
export const importanceOf = (key: string, weight: number): number => weight * importanceScale(key);
export const weightOfImportance = (key: string, importance: number): number => importance / importanceScale(key);
// An importance as shown: whole from 10 up, one decimal below.
export const roundImportance = (n: number): number => (Math.abs(n) >= 10 ? Math.round(n) : Math.round(n * 10) / 10);
export const importanceText = (key: string, weight: number): string => String(roundImportance(importanceOf(key, weight)));
// A weight_dominates saved before issue #274 has no `values.importance`: its sentence and setWeight value are per point,
// which the page and MCP now read as an importance, so it keeps its sentence and loses its action.
export const withCurrentActions = (d: Diagnostic): Diagnostic => (d.code === "weight_dominates" && d.values?.importance == null && d.actions.length ? { ...d, actions: [] } : d);

// Skill names as they appear in tooltips (lower-cased). A "+10 Magery" line on an item becomes the builder property
// "sk:magery", so skill bonuses can be weighted, floored or forbidden like any other property.
export const SKILL_NAMES: string[] = ["alchemy", "anatomy", "animal lore", "animal taming", "archery", "arms lore", "begging", "blacksmithy", "bushido",
  "camping", "carpentry", "cartography", "chivalry", "cooking", "detecting hidden", "discordance", "evaluating intelligence", "evaluate intelligence",
  "fencing", "fishing", "fletching", "bowcraft/fletching", "focus", "forensic evaluation", "healing", "herding", "hiding", "imbuing", "inscription",
  "item identification", "lockpicking", "lumberjacking", "mace fighting", "magery", "meditation", "mining", "musicianship", "mysticism", "necromancy",
  "ninjitsu", "parrying", "peacemaking", "poisoning", "provocation", "remove trap", "resisting spells", "snooping", "spellweaving", "spirit speak",
  "stealing", "stealth", "swordsmanship", "tactics", "tailoring", "taste identification", "throwing", "tinkering", "tracking", "veterinary", "wrestling"];
export const SKILL_SET = new Set(SKILL_NAMES);
const titleCase = (x: string): string => x.replace(/\b\w/g, (c) => c.toUpperCase());

// The property catalogue: every gear property the Inventory's property rule offers, whether or not an item carries it, in
// the list's groups and order, by the shard's names, with the unit its tooltip line shows. A modelled property is named
// by its registry key; one no property models by the key parseTooltip files its line under in `extras` ("weapon speed"),
// which a rule saved before it was listed already names. Every entry's line is one seen on the shard (a scan, or its
// vendor listings: Hit Curse, the Resonances, Lower Ammo Cost); a property no tooltip has shown yet is left out, since an
// option nothing can match would only mislead. Scroll filters (psLevel, sotPoints) are not gear properties.
export const CATALOGUE_GROUPS = ["Resists", "Casting", "Combat", "Weapon", "Defense & eaters", "Stats & pools", "Other"] as const;
export type CatalogueGroup = (typeof CATALOGUE_GROUPS)[number];
export interface CatalogueEntry { key: string; name: string; unit: "" | "%" | "s" | "tiles" | "stones" | "skill"; group: CatalogueGroup }
const fromRegistry = (key: PropKey, unit: CatalogueEntry["unit"], group: CatalogueGroup): CatalogueEntry => ({ key, name: key === "weight" ? "Weight" : PROPERTIES.find((p) => p.key === key)!.full, unit, group });
const fromLine = (key: string, unit: CatalogueEntry["unit"], group: CatalogueGroup): CatalogueEntry => ({ key, name: titleCase(key), unit, group });
export const PROPERTY_CATALOGUE: readonly CatalogueEntry[] = [
  ...(["physResist", "fireResist", "coldResist", "poisonResist", "energyResist"] as const).map((k) => fromRegistry(k, "%", "Resists")),
  fromRegistry("fc", "", "Casting"), fromRegistry("fcr", "", "Casting"), fromRegistry("lmc", "%", "Casting"), fromRegistry("lrc", "%", "Casting"),
  fromRegistry("sdi", "%", "Casting"), fromRegistry("manaRegen", "", "Casting"), fromRegistry("castingFocus", "%", "Casting"), fromRegistry("mageWeapon", "skill", "Casting"),
  ...["fire", "cold", "poison", "energy", "kinetic"].map((e) => fromLine(`${e} resonance`, "%", "Casting")),
  ...(["hci", "dci", "ssi", "di", "reflectPhys", "hitLifeLeech", "hitStamLeech", "hitManaLeech"] as const).map((k) => fromRegistry(k, "%", "Combat")),
  fromLine("hit mana drain", "%", "Combat"), fromLine("hit fatigue", "%", "Combat"),
  ...(["hitLowerDef", "hitLowerAttack", "hitFireball", "hitLightning", "hitHarm", "hitMagicArrow", "hitDispel"] as const).map((k) => fromRegistry(k, "%", "Combat")),
  fromLine("hit curse", "%", "Combat"),
  ...(["hitPhysArea", "hitFireArea", "hitColdArea", "hitPoisonArea", "hitEnergyArea"] as const).map((k) => fromRegistry(k, "%", "Combat")),
  fromLine("splintering weapon", "%", "Combat"), fromLine("velocity", "%", "Combat"), fromLine("swarm", "%", "Combat"),
  fromLine("weapon speed", "s", "Weapon"),
  ...["physical", "fire", "cold", "poison", "energy", "chaos"].map((d) => fromLine(`${d} damage`, "%", "Weapon")),
  fromLine("range", "tiles", "Weapon"), fromLine("archery damage modifier", "%", "Weapon"), fromLine("lower ammo cost", "%", "Weapon"),
  ...["damage", "kinetic", "fire", "cold", "poison", "energy"].map((e) => fromLine(`${e} eater`, "%", "Defense & eaters")),
  fromLine("soul charge", "%", "Defense & eaters"), fromLine("last parry chance", "%", "Defense & eaters"),
  ...(["strBonus", "dexBonus", "intBonus", "hpi", "stamInc", "manaInc", "hpRegen", "stamRegen"] as const).map((k) => fromRegistry(k, "", "Stats & pools")),
  fromRegistry("strReq", "", "Other"), fromLine("lower requirements", "%", "Other"), fromRegistry("weight", "stones", "Other"), fromRegistry("luck", "", "Other"),
  fromRegistry("enhancePotions", "%", "Other"), fromRegistry("selfRepair", "", "Other"), fromLine("mining bonus", "", "Other"), fromLine("blacksmithing bonus", "%", "Other"),
  fromLine("artifact rarity", "", "Other"),
];
// The yes/no properties (flag keys, pools.mts's flagKey), A to Z by name: the ones seen on gear in real scans, Searing Weapon
// and Cannot Be Repaired from the shard's vendor listings, and Bane and Assassin Honed, which the shard shows the same way
// (its plain name on a line of its own) though no listing has confirmed them.
export const FLAG_CATALOGUE: readonly string[] = ["assassin honed", "balanced", "bane", "battle lust", "blessed", "blood drinker", "cannot be repaired", "crafting failure protection",
  "exceptional", "(imbued)", "insured", "mage armor", "night sight", "part of an armor set", "reactive paralyze", "searing weapon", "spell channeling", "use best weapon skill"];
const CATALOGUE_NAMES: Record<string, string> = Object.fromEntries(PROPERTY_CATALOGUE.map((c) => [c.key, c.name]));
// Any list of property keys in the catalogue's groups and order (#487: the Suit Builder's requirement, goal and weight
// pickers and the character sheet's Properties shown), so every property list reads alike: the pools after the stats, a
// skill bonus ("sk:magery") under Skill bonuses, anything else under Other, those by `nameOf`.
const CATALOGUE_AT = new Map(PROPERTY_CATALOGUE.map((c, i) => [c.key, i]));
export function catalogueGroups(keys: readonly string[], nameOf: (k: string) => string): Array<{ group: string; keys: string[] }> {
  const groupOf = (k: string): string => (k.startsWith("sk:") ? "Skill bonuses" : k.endsWith("Pool") ? "Stats & pools" : PROPERTY_CATALOGUE[CATALOGUE_AT.get(k) ?? -1]?.group ?? "Other");
  const at = (k: string): number => CATALOGUE_AT.get(k) ?? Infinity;
  const order = [...CATALOGUE_GROUPS.filter((g) => g !== "Other"), "Skill bonuses", "Other"];
  return order.map((group) => ({ group, keys: keys.filter((k) => groupOf(k) === group).sort((a, b) => at(a) - at(b) || nameOf(a).localeCompare(nameOf(b))) })).filter((g) => g.keys.length);
}
// A tooltip line no property models reads by its catalogue name ("Weapon Speed"), anything else by its key.
export const labelOf = (k: string): string => (k.startsWith("sk:") ? "+" + titleCase(k.slice(3)) : PROP_LABELS[k] || CATALOGUE_NAMES[k] || k);
export const fullOf = (k: string): string => (k.startsWith("sk:") ? `${titleCase(k.slice(3))} skill bonus from items` : PROP_FULL[k] || CATALOGUE_NAMES[k] || k);
// A property in words, wherever the page names it (the Suit Builder's goals, weight and requirement rows, the score
// breakdown, the result's table, the runs and compare views, the character sheet, a filter token, a diagnostic): the
// shard's full name, as the property catalogue has it ("Physical Resist", "Hit Chance Increase"; one name per property,
// the owner's call replacing #302's sentence case). A derived pool reads by its `name`, a skill bonus "Magery skill
// bonus". Only a tight layout (a column head, a gauge, a badge) uses the short label ("Phys", "HCI").
const PROP_NAMES: Record<string, string> = Object.fromEntries(NUMBER_PROPS.flatMap((p): Array<[string, string]> => ("name" in p && p.name ? [[p.key, p.name]] : [])));
export function propName(k: string): string {
  if (k.startsWith("sk:")) return `${labelOf(k).slice(1)} skill bonus`;
  return PROP_NAMES[k] ?? fullOf(k);
}
// A property in a sentence: its name as it is ("Swing Speed Increase", "Magery skill bonus"), a pool lower-cased at the
// start ("stamina from gear and buffs" reads as plain words).
export const goalWord = (k: string): string => { const w = propName(k); return PROP_NAMES[k] ? w[0]!.toLowerCase() + w.slice(1) : w; };

// The five resists in paperdoll order, with the names the page shows: the long one ("Physical"), the short one
// ("Phys") and the colour token (--res-phys).
export interface ResistMeta { key: string; long: string; short: string; token: string }
export const RESIST_META: ResistMeta[] = [
  { key: "physResist", long: "Physical", short: "Phys", token: "--res-phys" },
  { key: "fireResist", long: "Fire", short: "Fire", token: "--res-fire" },
  { key: "coldResist", long: "Cold", short: "Cold", token: "--res-cold" },
  { key: "poisonResist", long: "Poison", short: "Poison", token: "--res-poison" },
  { key: "energyResist", long: "Energy", short: "Energy", token: "--res-energy" },
];
export const RESIST_KEYS: string[] = RESIST_META.map((r) => r.key);
