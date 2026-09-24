// vault-lib.mts — Pack Rat shared logic: tooltip parsing, slot classification, snapshot folding,
// optimizer pool building and requirement reports. Used by index.html (browser, via the
// server) and gear-vault.test.mts (Node). No dependencies, no DOM.
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
  setBonus: PropMap;
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
  setBonus: PropMap;
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
  pos?: Record<string, number> | null | undefined;
  // The container's segment in location text: its bagLabel, plus a distinguishing suffix when another
  // container with the same label sits beside it (labelContainers). Set by every fold.
  label?: string | undefined;
  scannedBy: string;
  scannedAt: string;
}

export interface Character {
  name: string;
  stats: Record<string, unknown>;
  scannedAt: string;
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

export const PROP_LABELS: Record<string, string> = {
  physResist: "Phys", fireResist: "Fire", coldResist: "Cold", poisonResist: "Poison", energyResist: "Energy",
  hci: "HCI", dci: "DCI", ssi: "SSI", di: "DI", lmc: "LMC", lrc: "LRC", fc: "FC", fcr: "FCR", sdi: "SDI",
  hpi: "HP+", hpRegen: "HPR", stamInc: "Stam+", stamRegen: "SR", manaInc: "Mana+", manaRegen: "MR",
  strBonus: "STR", dexBonus: "DEX", intBonus: "INT", reflectPhys: "RPD", castingFocus: "CF", luck: "Luck",
  hitLifeLeech: "HLL", hitStamLeech: "HSL", hitManaLeech: "HML", hitLowerDef: "HLD", hitLowerAttack: "HLA",
  enhancePotions: "EP", selfRepair: "Self Rep", hitFireball: "Hit Fireball", hitLightning: "Hit Lightning",
  hitHarm: "Hit Harm", hitMagicArrow: "Hit MA", hitDispel: "Hit Dispel", hitPoisonArea: "Poison Area",
  hitFireArea: "Fire Area", hitColdArea: "Cold Area", hitEnergyArea: "Energy Area", hitPhysArea: "Phys Area",
  mageWeapon: "Mage Wpn", tagPenalty: "Tag penalty",
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
  hitEnergyArea: "Hit Energy Area", hitPhysArea: "Hit Physical Area", mageWeapon: "Mage Weapon", tagPenalty: "Penalty for Cursed / Brittle / Antique / Prized tags",
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

// A resist's paperdoll cap on this shard for a race (an Elf's Energy is 75 on uoalive), else the shard's cap.
export function shardResistCap(k: string, race: string | null | undefined): number {
  const rules = getRules();
  return (rules.raceCaps as Record<string, Record<string, number>> | undefined)?.[race as string]?.[k] ?? (rules.caps as Record<string, number>)[k] ?? 70;
}
// The range a player's resist cap override may take (the Builder's Resist caps fields, a profile's or template's
// resistCaps, a saved run's settings.resistCaps): whole paperdoll numbers.
export const RESIST_CAP_LIMITS = { min: 0, max: 150 } as const;
// A resist's cap for one build, in paperdoll terms: `cap` is what the build values the resist up to, `shard` what
// the shard's rules give this race. They differ only where the player overrode the cap (a suit worn in Reaper
// Form, which takes 25 Fire, is built with a Fire cap of 95).
export interface ResistCap { cap: number; shard: number }
export function resistCapsFor(race: string | null | undefined, overrides: Record<string, number> | null | undefined): Record<string, ResistCap> {
  return Object.fromEntries(RESIST_KEYS.map((k) => {
    const shard = shardResistCap(k, race), o = overrides?.[k];
    return [k, { cap: typeof o === "number" && Number.isFinite(o) ? o : shard, shard }];
  }));
}
// What a resistCaps value is wrong about, or null when it is fine: an object naming only the five resists, each a
// whole number within RESIST_CAP_LIMITS. The server checks a build's settings with this; PUT /api/profiles checks
// profiles.json's with the same rule, written as JSON Schema in profiles.v2.schema.json.
export function resistCapsError(v: unknown, path = "resistCaps"): string | null {
  if (v == null) return null;
  if (typeof v !== "object" || Array.isArray(v)) return `${path} must be an object`;
  for (const [k, n] of Object.entries(v)) {
    if (!RESIST_KEYS.includes(k)) return `${path}.${k} is not a resist`;
    if (typeof n !== "number" || !Number.isInteger(n) || n < RESIST_CAP_LIMITS.min || n > RESIST_CAP_LIMITS.max) return `${path}.${k} must be a whole number from ${RESIST_CAP_LIMITS.min} to ${RESIST_CAP_LIMITS.max}`;
  }
  return null;
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
  resistCaps?: Record<string, number> | undefined;
}
export interface EffectiveProfile {
  weights: Record<string, number>;
  caps: Record<string, number>;
  floors: Record<string, number>;
  floorBonus: number;
  hardFloors: string[];
  resistBonus: number;
  // Only the resists whose cap the player overrode, in paperdoll terms; absent when none is, so a profile with no
  // override keeps the exact shape (and so the run key, runs-lib.mts) it had before overrides existed.
  resistCapOverrides?: Record<string, ResistCap> | undefined;
}
// The optimizer's profile for one character. Resist floors and caps are written in paperdoll terms (what the
// character sheet shows): the character's Resisting Spells bonus is subtracted so the search works on item totals,
// and a race can raise a resist's cap (rules.raceCaps, e.g. an Elf's Energy cap). The player's own resistCaps
// replace the shard's per resist, and a resist floor counts up to its resist's cap. Every floor not marked soft is hard.
export function effectiveProfile(p: Profile = {}, character: Character | null = null): EffectiveProfile {
  const rules = getRules();
  const rsb = resistSkillBonus(character?.skills);
  const caps: Record<string, number> = { ...rules.caps as Record<string, number>, ...(p.caps || {}) };
  const floors: Record<string, number> = { ...(p.floors || {}) };
  const view = resistCapsFor(p.race, p.resistCaps);
  const overrides: Record<string, ResistCap> = {};
  for (const k of RESIST_KEYS) {
    const { cap, shard } = view[k]!;
    if (cap !== shard) overrides[k] = { cap, shard };
    caps[k] = Math.max(0, cap - rsb);
    if (floors[k] != null) floors[k] = Math.max(0, Math.min(floors[k], cap) - rsb);
  }
  const hardFloors = Object.keys(floors).filter((k) => !(p.softFloors || []).includes(k));
  return { weights: { ...(p.weights || {}) }, caps, floors, floorBonus: p.floorBonus ?? 1000, hardFloors, resistBonus: rsb,
    ...(Object.keys(overrides).length ? { resistCapOverrides: overrides } : {}) };
}
// A built profile's resist caps in paperdoll terms, what a result is shown against: the override where there is
// one, else the item-total cap plus the Resisting Spells bonus.
export function profileResistCaps(prof: EffectiveProfile): Record<string, ResistCap> {
  return Object.fromEntries(RESIST_KEYS.map((k) => {
    const o = prof.resistCapOverrides?.[k];
    if (o) return [k, o];
    const cap = (prof.caps[k] ?? 70) + (prof.resistBonus || 0);
    return [k, { cap, shard: cap }];
  }));
}

// Cursed/Brittle/Antique/Prized (/Massive/Unwieldy on shards that use them) tag-penalty units, from
// the shard's rules file. A function, not a constant, because it must reflect whichever shard is
// currently loaded (setRules() may be called again after a shard switch). Keys are lower-cased, since
// parseTooltip matches them against lower-cased tooltip lines and a rules file may write "Cursed".
const TAG_UNITS_CACHE = new WeakMap<object, Record<string, number>>();
export function tagUnits(): Record<string, number> {
  const raw = getRules().tagUnits;
  let lower = TAG_UNITS_CACHE.get(raw);
  if (!lower) TAG_UNITS_CACHE.set(raw, lower = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k.toLowerCase(), v])));
  return lower;
}
// A tag's meaning in plain words (the shard's rules `tagInfo`, optional), or null when the shard gives none.
const TAG_INFO_CACHE = new WeakMap<object, Record<string, string>>();
export function tagInfo(tag: string): string | null {
  const raw = getRules().tagInfo;
  if (!raw) return null;
  let lower = TAG_INFO_CACHE.get(raw);
  if (!lower) TAG_INFO_CACHE.set(raw, lower = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k.toLowerCase(), v])));
  return lower[tag.toLowerCase()] ?? null;
}
// A rarity line: one of the shard's rarity ladder names (rules `rarity`), optionally "Reforged ...".
const RARITY_RE_CACHE = new WeakMap<object, RegExp>();
function rarityRe(): RegExp {
  const ladder = getRules().rarity;
  let re = RARITY_RE_CACHE.get(ladder);
  if (!re) {
    const names = ladder.map((r) => r.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
    RARITY_RE_CACHE.set(ladder, re = new RegExp(`^(?:reforged\\s+)?(?:${names})$`, "i"));
  }
  return re;
}

// The longest line any real tooltip carries is ~54 characters; the scan schema caps one at 512
// (scan.v2.schema.json's tooltip items), so a validated scan is never truncated here. The cap is
// repeated at the parser because a scan already on disk from before that bound existed still gets
// parsed on every fold — and regex cost on a line is what a hostile scan used to buy (Phase 7
// security review, Area 2, Important 3).
const MAX_TOOLTIP_LINE = 512;
const stripHtml = (s: unknown): string => String(s || "").slice(0, MAX_TOOLTIP_LINE).replace(/<[^>]+>/g, "").trim();
// "any other numeric line" — the fallback that turns an unmodeled line into an `extras` entry. It
// matches the TAIL (a number, an optional %/s, an optional "- N" range) anchored to the end, and the
// property name is whatever precedes it; the old single expression put a lazy `(.*?)` head in front
// of a greedy `[\s:+]*` separator, and the two overlapped on the same characters, so a line ending in
// something the tail could not match forced the engine through every split of the overlap — clean
// O(n^2) (9 s on one 128k-character line). Leftmost-match picks the same number the lazy head did,
// and stripping the separator run off the end of the head reproduces what `[\s:+]*` used to eat.
const NUMERIC_TAIL_RE = /(-?\d+(?:\.\d+)?)\s*(%|s)?\s*(?:-\s*(\d+))?$/;

// A set piece describes its set in one of two places (ServUO BaseArmor.AddNameProperties and
// GetSetProperties, SetHelper.GetSetProperties). While the set is incomplete, the header "<br>Only
// when full set is present:" (cliloc 1072378) comes LAST, and every line after it is the set's bonus.
// While the whole set is worn, "Full Armor Set Present" (1072377) or "Full Weapon/Armor Set Present"
// (1073492) comes near the TOP, followed by the set's "(total)" lines, which sum every piece, and
// then the piece's own lines. So after that header only "(total)" lines (and the bard set's cooldown
// line) belong to the set, and the first other line ends the block.
const SET_INCOMPLETE_RE = /^only when full set is present\b/;
const SET_WORN_RE = /^full (weapon\/)?armor set present\b/;
const SET_TOTAL_LINE_RE = /\(total\)$|^mastery bonus cooldown\b/;

// Returns { name, props, setBonus, tags, strReq, rarity, extras, flags, lines }.
//   props    : modeled numeric properties (optimizer keys) of the piece itself
//   setBonus : modeled properties in an incomplete set's bonus block, which apply only while every
//              piece of the set is worn; kept apart so a piece is never credited with them on its own
//   extras   : every other numeric line as { "swordsmanship": 10, "durability": [57, 57] ... }
//   flags    : non-numeric lines (lowercased), e.g. "spell channeling", "mage armor", "orc slayer";
//              a set-block line no pattern models, and every "(total)" line of a worn full set,
//              is kept as "set: <line>"
// A stack's name line starts with its amount ("2 Greater Heal"); that number is stripped only when it
// equals `amount`, so a name that really starts with a number ("10 Potions" on one item) keeps it.
export function parseTooltip(rawLines?: Array<string | undefined> | undefined, amount?: number | undefined): ParsedTooltip {
  const TU = tagUnits(), rarityLine = rarityRe();
  const lines = (rawLines || []).map(stripHtml).filter(Boolean);
  const name = (lines[0] || "").replace(/^(\d+)\s+(?=\S)/, (all, n: string) => (+n === amount ? "" : all));
  const props: PropMap = {}, setBonus: PropMap = {}, extras: ExtrasMap = {}, flags: string[] = [], tags: string[] = [];
  let strReq = 0, rarity: string | null = null, twoHanded: boolean | null = null, weight: number | null = null, skillReq: string | null = null;
  let inSet = false, inSetTotals = false;
  for (const raw of lines.slice(1)) {
    const line = raw.toLowerCase();
    if (SET_INCOMPLETE_RE.test(line)) { inSet = true; continue; }
    if (SET_WORN_RE.test(line)) { inSetTotals = true; continue; }
    if (inSetTotals) {
      if (SET_TOTAL_LINE_RE.test(line)) { flags.push("set: " + line); continue; }
      inSetTotals = false;
    }
    if (inSet) {
      const hit = PROP_PATTERNS.find(([, pat]) => pat.test(line));
      if (hit) setBonus[hit[0]] = (setBonus[hit[0]] || 0) + +line.match(hit[1])![1]!;
      else flags.push("set: " + line);
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(TU, line)) { tags.push(line); continue; }
    if (rarityLine.test(raw)) { rarity = raw; continue; }
    let m;
    if ((m = line.match(/strength requirement\D*(\d+)/))) { strReq = +m[1]!; continue; }
    if ((m = line.match(/^weight\D*(\d+)/))) { weight = +m[1]!; continue; }
    if (/^two-handed weapon/.test(line)) { twoHanded = true; continue; }
    if (/^one-handed weapon/.test(line)) { twoHanded = false; continue; }
    if ((m = line.match(/^skill required\W*(.+)$/))) { skillReq = m[1]!.trim(); continue; }
    if ((m = line.match(/^durability\D*(\d+)\D+(\d+)/))) { extras.durability = [+m[1]!, +m[2]!]; continue; }
    if (/^(crafted by|engraved)\b/.test(line)) { flags.push(line); continue; }   // free text: "Engraved: Bag 2" is not a number
    let matched = false;
    for (const [key, pat] of PROP_PATTERNS) {
      const mm = line.match(pat);
      if (mm) { props[key] = (props[key] || 0) + +mm[1]!; matched = true; break; }
    }
    if (matched) continue;
    const num = line.match(NUMERIC_TAIL_RE);
    const head = num ? line.slice(0, num.index).replace(/[\s:+]*$/, "") : "";
    if (num && head.trim()) {
      const key = head.trim().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ");
      extras[key] = num[3] ? [+num[1]!, +num[3]] : +num[1]!;
    } else {
      flags.push(line);
    }
  }
  if (tags.length) props.tagPenalty = tags.reduce((a, t) => a + TU[t]!, 0);
  return { name, props, setBonus, tags, strReq, rarity, extras, flags, twoHanded, weight, skillReq, lines };
}

// ---------------------------------------------------------------------------
// Slot classification. The worn layer wins when the item is equipped. Unequipped, the item's graphic
// decides wherever the client's tiledata lists it as wearable (GRAPHIC_LAYER_RUNS below): a named
// artifact ("Heart Of The Lion") or a set whose every piece is called "Armor Of Initiation" says
// nothing about its slot by name, or says the wrong thing. Held graphics (weapons, shields,
// spellbooks) still go through the name and tooltip rules first, because tiledata files bows under
// the one-handed layer and cannot tell a shield from a two-handed weapon. Names (UO base names are
// standardized) are the fallback for a graphic the table does not know; the tooltip's
// "Two-handed Weapon" line wins over the name regex when present.
// ---------------------------------------------------------------------------
const WEAPON_RE = /\b(scimitar|katana|longsword|broadsword|viking sword|cutlass|cleaver|bone harvester|machete|no-dachi|double axe|war axe|battle axe|large battle axe|two handed axe|executioner|ornate axe|hatchet|axe|bardiche|halberd|paladin sword|radiant|dagger|kryss|war fork|short spear|spear|pike|pitchfork|leafblade|boning knife|sai|tekagi|mace|maul|club|war hammer|hammer pick|scepter|diamond mace|tessen|nunchaku|black staff|quarter staff|staff|bow|crossbow|yumi|longbow|composite|lance|scythe|knife|sledge hammer|soul glaive|cyclone|boomerang|glass sword|glass staff|stone war sword|crook|crescent blade|wakizashi|daisho|bokuto|lajatang|kama|tetsubo|war cleaver|spellblade|rune blade|war mace|bloodblade|dread sword|dual short axes|dual pointed spear|shortblade|longblade|talwar|disc mace|serpentstone staff|wild staff|gnarled staff|sword|blade)\b/i;
const TWO_H_RE = /\b(two handed|double axe|large battle axe|bardiche|halberd|no-dachi|executioner|maul|war hammer|black staff|quarter staff|bow|crossbow|yumi|longbow|composite|scythe|pike|war fork|spear|lance|lajatang|tetsubo|daisho|bokuto|gnarled staff|wild staff|serpentstone staff|soul glaive|dual pointed spear|dual short axes|sledge hammer|scepter|glass staff)\b/i;
const SHIELD_RE = /\b(shield|buckler)\b/i;
const HELD_TOOL_RE = /\b(fishing pole|candle|candelabra|torch|lantern|light source)\b/i;
const SPELLBOOK_RE = /\b(spellbook|book of (chivalry|bushido|ninjitsu|magery|necromancy|mysticism|spellweaving)|necromancer spellbook|mysticism book|tome)\b/i;   // NOT bare "mystic": "Mystic Ring" is a ring
const JEWEL_SLOTS: Array<[string, RegExp]> = [["ring", /\bring\b/i], ["bracelet", /\bbracelet\b/i], ["talisman", /\btalisman\b/i], ["neck", /\bnecklace\b/i], ["earrings", /\bearrings\b/i]];
const ARMOR_SLOTS: Array<[string, RegExp]> = [
  ["helmet", /\b(helm|helmet|bascinet|circlet|coif|cap|hat|mask|skullcap|bandana|bonnet|hood|glasses|goggles|hatsuburi|jingasa|kabuto|kasa)\b/i],
  ["neck", /\b(gorget|mempo|beads)\b/i],
  ["hands", /\b(gloves|gauntlets)\b/i],
  ["arms", /\b(arms|sleeves|vambraces|rerebrace|pauldrons|hiro sode)\b/i],
  ["legs", /\b(leggings|chausses|greaves|kilt|shorts|haidate|suneate|leg guards|tonlet|skirt|pants|hakama)\b/i],
  ["cloak", /\b(cloak|cape|mantle|quiver)\b/i],
  ["feet", /\b(sandals|boots|shoes|thigh boots|tabi)\b/i],
  ["robe", /\b(robe|tunic top|shroud)\b/i],
  ["tunic", /\b(doublet|surcoat|body sash)\b/i],
  ["chest", /\b(armor|tunic|breastplate|hauberk|ringmail|chainmail|platemail|plate|hide|do|chest|jacket|shirt|vest|bustier|female plate)\b/i],
  ["waist", /\b(sash|apron|obi|half apron|belt)\b/i],
];
// No bare "gold": gold coins are caught by "coin", and "Gold Ring" / "Gold Bracelet" are jewellery.
// "cloth" is a resource unless it names a garment ("Cloth Ninja Hood").
const SKIP_RE = /\b(bandage|potion|reagent|ore|ingot|log|board|scroll|deed|arrow|bolt|garlic|ginseng|mandrake|nightshade|bloodmoss|sulfurous|black pearl|key|map|gem|cloth(?! ninja)|feather|shaft|kindling|torch|lantern|fish|powder|essence|seed|runebook|bag of|pouch|backpack|chest of|crate|box|bottle|jar|token|ticket|coin|doubloon|bone pile|bark|sap|ingots|jewelry box)\b/i;
// Middle-torso clothing (the Tunic layer: doublet, cloth tunic, surcoat, body sash) is worn over chest
// armour (the Torso layer), so it has its own "tunic" slot rather than competing for "chest". Like
// robe, shirt, feet, waist and earrings, it is tracked but not one of the slots the optimizer fills.
export const LAYER_TO_SLOT: Record<string, string> = {
  OneHanded: "oneHanded", TwoHanded: "twoHanded", Helmet: "helmet", Gloves: "hands", Arms: "arms",
  Legs: "legs", Pants: "legs", Necklace: "neck", Ring: "ring", Bracelet: "bracelet", Talisman: "talisman",
  Torso: "chest", Cloak: "cloak", Shoes: "feet", Robe: "robe", Earrings: "earrings", Waist: "waist",
  Tunic: "tunic", Shirt: "shirt", Skirt: "legs",
};
export const OPTIMIZER_SLOTS: string[] = ["helmet", "chest", "arms", "hands", "legs", "neck", "ring", "bracelet", "talisman", "cloak", "oneHanded", "twoHanded"];
export const SLOT_LABELS: Record<string, string> = {
  helmet: "Head", chest: "Chest", arms: "Arms", hands: "Hands", legs: "Legs", neck: "Neck", ring: "Ring",
  bracelet: "Bracelet", talisman: "Talisman", cloak: "Cloak", oneHanded: "Weapon (1H)", twoHanded: "Weapon 2H / Shield",
  feet: "Feet", robe: "Robe", tunic: "Middle Torso", earrings: "Earrings", waist: "Waist", shirt: "Shirt", spellbook: "Spellbook",
};

const SPELL_NAMES = new Set(("clumsy,create food,feeblemind,heal,magic arrow,night sight,reactive armor,weaken,agility,cunning,cure,harm,magic trap,magic untrap,protection,strength,bless,fireball,magic lock,poison,telekinesis,teleport,unlock,wall of stone,arch cure,arch protection,curse,fire field,greater heal,lightning,mana drain,recall,blade spirits,dispel field,incognito,magic reflection,mind blast,paralyze,poison field,summon creature,dispel,energy bolt,explosion,invisibility,mark,mass curse,paralyze field,reveal,chain lightning,energy field,flamestrike,gate travel,mana vampire,mass dispel,meteor swarm,polymorph,earthquake,energy vortex,resurrection,air elemental,summon daemon,earth elemental,fire elemental,water elemental,summon air elemental,summon earth elemental,summon fire elemental,summon water elemental,"
  + "animate dead,blood oath,corpse skin,curse weapon,evil omen,horrific beast,lich form,mind rot,pain spike,poison strike,strangle,summon familiar,vampiric embrace,vengeful spirit,wither,wraith form,exorcism,"
  + "nether bolt,healing stone,purge magic,enchant,sleep,eagle strike,animated weapon,stone form,spell trigger,mass sleep,cleansing winds,bombard,spell plague,hail storm,nether cyclone,rising colossus,"
  + "cleanse by fire,close wounds,consecrate weapon,divine fury,dispel evil,enemy of one,holy light,noble sacrifice,remove curse,sacred journey,"
  + "honorable execution,confidence,evasion,counter attack,lightning strike,momentum strike,focus attack,death strike,animal form,ki attack,surprise attack,backstab,shadowjump,mirror image,"
  + "arcane circle,gift of renewal,immolating weapon,attune weapon,thunderstorm,nature's fury,summon fey,summon fiend,reaper form,wildfire,essence of wind,dryad allure,ethereal voyage,word of death,gift of life,arcane empowerment").split(","));
// The paperdoll layer each tiledata layer number stands for (TazUO's Layer enum names, the same names
// an adapter reports for a worn item's layer).
const TILEDATA_LAYERS: Record<number, string> = { 1: "OneHanded", 2: "TwoHanded", 3: "Shoes", 4: "Pants", 5: "Shirt", 6: "Helmet", 7: "Gloves",
  8: "Ring", 9: "Talisman", 10: "Necklace", 12: "Waist", 13: "Torso", 14: "Bracelet", 17: "Tunic", 18: "Earrings", 19: "Arms", 20: "Cloak",
  22: "Robe", 23: "Skirt", 24: "Legs" };
// Every wearable gear graphic in the client's tiledata, as [first graphic, count, tiledata layer] runs
// in graphic order. Generated from a 7.0.117 client's tiledata.mul; regenerate with
// `node scripts/gen-graphic-layers.mts <tiledata.mul>`, which rewrites only this block.
// Provenance: these numbers are facts, not client content. Each run is a range of item graphic ids
// and the paperdoll layer a wearable graphic in that range goes on, read out of a UO client's
// tiledata.mul by scripts/gen-graphic-layers.mts. No client file, art or name is in this repository,
// and the same graphic/layer facts appear in open-source emulators such as ServUO's item definitions.
// BEGIN generated by scripts/gen-graphic-layers.mts
const GRAPHIC_LAYER_RUNS: ReadonlyArray<readonly [number, number, number]> = [
  [526,1,1],[643,2,19],[645,2,13],[647,2,7],[649,2,4],[769,2,19],[771,2,13],[773,2,4],[775,2,19],[777,2,13],[779,2,7],[781,2,4],[784,2,7],[1027,2,19],[1029,2,13],[1031,2,7],
  [1033,2,4],[2301,1,2],[2302,6,1],[2308,3,2],[2311,1,1],[2312,1,2],[2314,3,1],[2575,10,2],[2594,4,2],[2600,1,2],[3519,2,2],[3568,2,2],[3570,4,1],[3643,1,1],[3713,2,2],[3717,2,1],
  [3719,4,2],[3778,4,1],[3834,1,1],[3907,4,2],[3911,2,1],[3913,6,2],[3919,4,1],[3932,6,1],[3938,3,2],[3947,1,2],[4020,2,1],[4229,1,10],[4230,1,14],[4231,1,18],[4232,2,10],[4234,1,8],
  [4246,1,9],[5039,12,1],[5051,1,6],[5054,1,4],[5055,1,13],[5056,1,6],[5059,1,4],[5060,1,13],[5061,1,19],[5062,1,7],[5063,1,10],[5067,1,4],[5068,1,13],[5069,1,19],[5070,1,7],[5074,1,4],
  [5075,1,13],[5076,1,19],[5077,1,7],[5078,1,10],[5082,1,4],[5083,1,13],[5084,1,19],[5085,1,7],[5089,1,4],[5090,1,13],[5091,2,1],[5099,1,7],[5100,2,13],[5102,2,19],[5104,2,4],[5106,1,7],
  [5108,2,2],[5110,2,1],[5112,4,2],[5116,6,1],[5122,2,2],[5124,4,1],[5128,8,6],[5136,1,19],[5137,1,4],[5138,1,6],[5139,1,10],[5140,1,7],[5141,2,13],[5143,1,19],[5144,1,7],[5145,1,6],
  [5146,1,4],[5147,2,6],[5176,6,1],[5182,2,2],[5184,2,1],[5186,2,2],[5198,1,19],[5199,1,13],[5200,1,7],[5201,1,6],[5202,1,4],[5203,1,19],[5204,1,13],[5205,1,7],[5206,1,6],[5207,1,4],
  [5397,1,20],[5398,1,23],[5399,2,5],[5422,2,4],[5424,1,20],[5425,1,23],[5431,2,23],[5433,2,4],[5435,2,12],[5437,2,17],[5439,2,6],[5441,2,17],[5443,10,6],[5703,1,2],[5899,8,3],[5907,10,6],
  [5934,1,6],[6588,2,1],[7026,10,2],[7107,5,2],[7168,2,4],[7170,6,13],[7176,2,4],[7178,4,13],[7609,2,6],[7933,2,5],[7935,6,22],[7941,1,10],[7942,1,14],[7943,1,18],[7944,1,10],[7945,1,8],
  [7946,1,10],[7947,2,6],[8059,2,17],[8095,4,17],[8189,2,17],[8258,2,22],[8270,3,22],[8786,3,1],[8794,2,1],[8965,2,6],[8967,2,3],[8969,2,20],[8971,2,23],[8973,2,22],[8975,2,17],[9068,2,6],
  [9100,1,1],[9120,1,1],[9556,3,2],[9559,1,1],[9560,5,2],[9565,4,1],[9569,2,2],[9571,1,1],[9572,11,2],[9583,1,1],[9584,3,2],[9587,4,1],[9591,2,2],[9593,1,1],[9594,2,2],[9596,4,1],
  [9700,2,4],[9702,6,5],[9708,6,22],[9714,2,23],[9793,2,13],[9795,2,7],[9797,2,6],[9799,4,4],[9803,2,10],[9805,6,4],[9811,4,3],[9815,2,19],[9817,16,5],[9835,4,19],[9841,3,13],[9844,1,19],
  [9847,4,7],[9851,13,22],[9865,10,6],[9885,2,6],[9889,4,6],[9901,1,20],[9902,1,22],[9903,1,3],[9904,1,7],[9914,1,2],[9915,2,1],[9917,3,2],[9920,1,1],[9921,4,2],[9925,2,1],[9927,3,2],
  [9930,1,1],[9931,3,2],[9934,2,1],[10100,5,6],[10105,2,10],[10107,3,13],[10110,3,19],[10113,1,6],[10114,2,22],[10116,2,6],[10118,3,4],[10121,1,6],[10122,4,4],[10126,2,6],[10128,1,12],[10129,1,4],
  [10130,1,7],[10131,2,13],[10133,3,3],[10136,1,6],[10137,1,22],[10138,1,23],[10139,1,4],[10140,1,22],[10141,1,10],[10142,2,22],[10144,1,12],[10145,1,17],[10146,2,2],[10148,1,1],[10149,3,2],[10152,1,1],
  [10153,1,2],[10154,1,1],[10155,1,2],[10157,3,2],[10175,5,6],[10180,2,10],[10182,3,13],[10185,3,19],[10188,1,6],[10189,2,22],[10191,2,6],[10193,3,4],[10196,1,6],[10197,4,4],[10201,2,6],[10203,1,12],
  [10204,1,4],[10205,1,7],[10206,2,13],[10208,3,3],[10211,1,6],[10212,1,22],[10213,1,23],[10214,1,4],[10215,1,22],[10216,1,10],[10217,2,22],[10219,1,12],[10220,1,17],[10221,2,2],[10223,1,1],[10224,3,2],
  [10227,1,1],[10228,1,2],[10229,1,1],[10230,1,2],[10232,3,2],[11009,1,2],[11010,4,20],[11014,2,4],[11016,2,13],[11018,2,19],[11020,2,7],[11022,2,10],[11024,2,6],[11026,2,3],[11111,1,13],[11112,1,12],
  [11113,1,10],[11114,1,7],[11115,1,4],[11116,1,19],[11117,1,13],[11118,6,6],[11124,1,13],[11125,1,7],[11126,1,10],[11127,1,19],[11128,1,4],[11129,1,13],[11550,3,2],[11553,5,1],[11558,1,2],[11559,1,1],
  [11560,1,2],[11561,1,1],[11562,3,2],[11565,5,1],[11570,1,2],[11571,1,1],[11572,1,2],[11573,1,1],[11600,1,1],[11677,1,1],[12120,4,9],[12215,1,20],[12216,1,6],[12217,2,22],[12219,4,5],[12227,1,4],
  [12228,1,3],[12229,1,13],[12230,1,7],[12231,1,10],[12232,1,19],[12233,2,4],[12235,1,13],[12638,1,13],[12639,1,12],[12640,1,10],[12641,1,7],[12642,1,4],[12643,1,19],[12644,1,13],[12645,6,6],[12651,1,13],
  [12652,1,7],[12653,1,10],[12654,1,19],[12655,1,4],[12656,1,13],[12657,1,20],[12658,1,6],[12659,2,22],[12661,4,5],[12665,1,4],[12666,1,3],[12667,1,13],[12668,1,7],[12669,1,10],[12670,1,19],[12671,2,4],
  [12673,1,13],[15285,1,10],[16384,4,22],[16455,2,19],[16457,2,13],[16459,2,7],[16461,2,4],[16463,2,19],[16465,2,13],[16467,2,7],[16469,2,4],[16471,2,19],[16473,2,13],[16475,2,7],[16477,2,4],[16479,2,19],
  [16481,2,13],[16483,2,7],[16485,2,4],[16487,1,1],[16488,1,2],[16490,3,1],[16493,1,2],[16494,1,1],[16495,2,2],[16497,4,1],[16501,1,2],[16502,1,1],[16638,4,2],[16856,2,3],[16896,12,2],[16912,1,10],
  [16913,1,14],[16914,1,8],[16915,1,18],[16936,3,2],[16940,1,2],[17118,2,3],[17677,2,12],[17790,2,20],[17828,2,20],[17841,1,18],[17843,1,18],[17988,2,18],[18090,2,17],[18100,2,17],[18606,2,1],[18608,6,2],
  [18614,2,1],[18616,2,2],[18618,10,1],[18628,2,2],[18630,2,1],[18632,2,2],[18634,2,1],[18636,6,2],[19357,1,22],[19358,3,6],[19722,2,10],[20696,2,12],[30742,1,22],[30743,2,2],[30745,1,3],[30746,1,6],
  [30747,3,23],[30750,1,22],[30753,1,22],[30754,2,13],[30756,4,4],[30760,1,6],[30761,1,10],[30762,2,13],[30764,1,4],[30765,1,6],[30766,1,19],[39301,2,22],[40485,8,9],[40687,2,22],[40695,2,4],[40697,2,6],
  [40699,2,5],[40767,2,6],[40775,2,6],[41131,5,22],[41415,2,6],[41417,2,10],[41462,1,12],[41609,3,1],[41613,2,3],[41615,2,6],[41617,3,1],[41620,1,3],[41621,1,18],[41622,1,3],[41674,2,22],[41793,2,1],
  [41795,2,2],[41797,2,1],[41799,2,2],[41801,2,10],[41962,1,6],[41995,1,2],[41996,3,12],[41999,1,10],[42000,2,6],[42002,1,22],[42003,1,20],[42025,2,10],[42027,2,6],[42569,2,2],[42752,4,17],[42855,4,2],
  [42866,1,2],[42947,2,2],[42969,1,7],[42970,1,19],[42971,1,4],[42972,2,13],[42974,2,6],[42976,1,7],[42977,1,19],[42978,1,12],[43057,2,2],[43285,2,2],[44701,1,6],[44702,1,10],[44703,1,19],[44704,1,7],
  [44705,1,13],[44706,1,4],[44707,1,20],[44708,2,1],[44710,1,2],[44711,1,10],[44712,1,13],[44713,1,4],[44714,1,7],[44715,1,19],[44716,1,6],[44717,1,10],[44718,1,19],[44719,1,7],[44720,1,13],[44721,1,4],
  [44722,1,20],[44723,2,1],[44725,1,2],[44726,1,10],[44727,1,13],[44728,1,4],[44729,1,7],[44730,1,19],[44731,1,6],[44732,1,10],[44733,1,19],[44734,1,7],[44735,1,13],[44736,1,4],[44737,1,20],[44738,2,1],
  [44740,1,2],[44741,1,10],[44742,1,13],[44743,1,4],[44744,1,7],[44745,1,19],[44746,1,6],[44747,1,10],[44748,1,19],[44749,1,7],[44750,1,13],[44751,1,4],[44752,1,20],[44753,2,1],[44755,1,2],[44756,1,10],
  [44757,1,13],[44758,1,4],[44759,1,7],[44760,1,19],[44805,1,12],[44845,1,2],[44958,1,20],[45504,1,14],[45534,1,22],[45535,2,2],[45719,1,10],[45720,6,17],[45751,4,22],[45767,1,6],[45768,1,13],[45769,1,19],
  [45770,1,4],[45771,1,7],[45772,1,10],[46090,1,6],[46152,1,18],[46266,5,10],[46271,4,1],[46275,4,2],[46279,8,1],[46290,2,10],[46292,2,1],[46294,2,2],[46296,2,10],[46298,4,1],[46302,2,2],[46304,2,1],
  [46306,2,22],[46375,4,12],
];
// END generated
const GRAPHIC_LAYER = new Map<number, string>();
for (const [first, count, layer] of GRAPHIC_LAYER_RUNS) for (let g = first; g < first + count; g++) GRAPHIC_LAYER.set(g, TILEDATA_LAYERS[layer]!);
export const layerOfGraphic = (graphic: number | null | undefined): string | null => (graphic == null ? null : GRAPHIC_LAYER.get(graphic) ?? null);

// Returns { slot, twoHanded, gear } — gear=false for consumables/resources/unknown names.
export function classify(name: string | null | undefined, parsed?: ParsedTooltip | null | undefined, layer?: string | null | undefined, graphic?: number | null | undefined): ClassifyResult {
  const n = name || "";
  let slot = null, two = false;
  if (layer && LAYER_TO_SLOT[layer]) {
    slot = LAYER_TO_SLOT[layer]!;
    two = slot === "twoHanded" && !SHIELD_RE.test(n) && (parsed?.twoHanded ?? TWO_H_RE.test(n));
    return { slot, twoHanded: two, gear: true };
  }
  const graphicLayer = layerOfGraphic(graphic);
  const held = graphicLayer === "OneHanded" || graphicLayer === "TwoHanded";
  if (graphicLayer && !held) return { slot: LAYER_TO_SLOT[graphicLayer]!, twoHanded: false, gear: true };
  if (SPELL_NAMES.has(n.toLowerCase().trim())) return { slot: null, twoHanded: false, gear: false };   // spell scrolls are named after the spell
  if (SPELLBOOK_RE.test(n)) return { slot: "oneHanded", twoHanded: false, gear: true };
  if (SKIP_RE.test(n)) return { slot: null, twoHanded: false, gear: false };
  if (SHIELD_RE.test(n)) return { slot: "twoHanded", twoHanded: false, gear: true };
  if (WEAPON_RE.test(n) || parsed?.twoHanded !== null && parsed?.twoHanded !== undefined || parsed?.skillReq) {
    two = parsed?.twoHanded ?? TWO_H_RE.test(n);
    return { slot: two ? "twoHanded" : "oneHanded", twoHanded: two, gear: true };
  }
  // A held graphic with no weapon name or weapon lines is an artifact shield (TwoHanded) or a
  // spellbook-like off-hand item (OneHanded) only when it carries item properties: tiledata also
  // files fishing poles, candles and light sources under the hand layers, and those are tools.
  const hasProps = parsed && Object.keys(parsed.props).some((k) => k !== "tagPenalty");
  if (held && hasProps && !HELD_TOOL_RE.test(n)) return { slot: LAYER_TO_SLOT[graphicLayer]!, twoHanded: false, gear: true };
  for (const [s, rx] of JEWEL_SLOTS) if (rx.test(n)) return { slot: s, twoHanded: false, gear: true };
  for (const [s, rx] of ARMOR_SLOTS) if (rx.test(n)) return { slot: s, twoHanded: false, gear: true };
  // Unknown name but carries item properties: still gear, slot unknown.
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

// A container the player blacklisted: one entry of <data>/scan-blacklist.json, which the app (POST
// /api/blacklist) and the TazUO script packrat-blacklist.py both write. Scanners never open one.
export interface BlacklistEntry { serial: number; name: string; addedAt: string; where?: string | undefined }

export function foldSnapshots(snapshots: ScanV2[]): Inventory {
  // Null-prototype dictionaries, not `{}`: every key below comes from the scan (a container's own
  // serial, the character's name), and `obj["__proto__"] = value` on an ordinary object invokes the
  // inherited setter and REPLACES that object's prototype — the entry silently disappears and an
  // attacker-controlled inherited key becomes readable off the map. JSON.stringify and every
  // Object.keys/values/entries read below behave identically on a null-prototype object (Phase 7
  // security review, Area 2, Minor 1).
  const inv: Inventory = { characters: Object.create(null), containers: Object.create(null), items: Object.create(null), scans: [] };
  // validateScan refuses a scannedAt that is not a real instant, but a scan folded from before that
  // check could still carry one: it sorts first, because a NaN comparator result reads as "equal" and
  // would let an older scan of a root fold after a newer one.
  const stampOf = (s: string): number => { const t = parseStamp(s); return Number.isFinite(t) ? t : -Infinity; };
  const sorted = [...snapshots].sort((a, b) => stampOf(a.scannedAt) - stampOf(b.scannedAt));
  for (const snap of sorted) {
    if (snap.schemaVersion !== 2) throw new Error("foldSnapshots needs v2 scans — call upgradeScan first");
    const char = snap.character;
    if (char === "_vault") forgetCharacter(inv, (snap as ScanV2 & { forgetCharacter?: unknown }).forgetCharacter);
    // A root with opened:false (open failed — too far, locked) is still listed in snap.roots, but
    // carries no items; it must be treated exactly like a root the snapshot didn't mention at all —
    // i.e. excluded from the replace-per-root set below — so the fold keeps whatever it last knew
    // about that root instead of wiping it. Only opened:true roots (the historical v1→v2 upgrade
    // stamps every root opened:true, so old scans are unaffected) participate in replace-per-root.
    const roots = new Set((snap.roots || []).filter((r) => r.opened !== false).map((r) => +r.serial));
    // A container INSIDE a root that the scan saw but could not open (`opened: false` on its
    // containers entry: a bag that did not open, or one nested deeper than the adapter reads) is not
    // evidence it is empty. Everything the fold knew inside it — items and bags, however deep — is
    // kept, with its old seenAt; the rest of the root is replaced as usual. The bag may have moved
    // (another chest, another character's), so what is kept moves with it: its root becomes the
    // bag's new root and scannedBy this scanner, or the next scan of the old root would delete it.
    const unopened = new Map(Object.values((snap.containers || {}) as Record<string, { serial: number; root: number; opened?: unknown }>)
      .filter((c) => c.opened === false && roots.has(+c.root)).map((c) => [+c.serial, +c.root]));
    const unopenedRootAbove = (serial: number | null | undefined): number | null => {
      for (let cur = serial, guard = 0; cur != null && guard < 64; guard++) {
        if (unopened.has(+cur)) return unopened.get(+cur)!;
        cur = inv.containers[cur]?.parent;
      }
      return null;
    };
    const keptItems = new Set<string>(), keptContainers = new Set<string>();
    if (unopened.size) {
      const moves: [{ root: number | null; scannedBy: string }, number][] = [];
      for (const [serial, it] of Object.entries(inv.items)) {
        const root = unopenedRootAbove(it.container);
        if (root != null) { keptItems.add(serial); moves.push([it, root]); }
      }
      for (const [serial, c] of Object.entries(inv.containers)) {
        const root = unopenedRootAbove(c.parent);
        if (root != null) { keptContainers.add(serial); moves.push([c, root]); }
      }
      for (const [kept, root] of moves) { kept.root = root; kept.scannedBy = char; }
    }
    for (const [serial, it] of Object.entries(inv.items)) {
      if ((it.equippedBy === char) || (it.root != null && roots.has(+it.root) && !keptItems.has(serial))) delete inv.items[serial];
    }
    for (const [serial, c] of Object.entries(inv.containers)) if (roots.has(+c.root) && !keptContainers.has(serial)) delete inv.containers[serial];
    const snapContainers = (snap.containers || {}) as Record<string, ScanContainerRaw>;
    // Indexed once per snapshot, by the entry's own serial — nothing requires snap.containers' KEYS
    // to be serials at all, and the old per-item `Object.values(...).find(...)` fallback for a key
    // that didn't match cost items x containers (2.3 s for 20,000 items across 2,000 containers,
    // every fold and every restart). Strictly faster for an honest scan too.
    const bySerial = new Map<number, ScanContainerRaw>(Object.values(snapContainers).map((c) => [+c.serial, c]));
    // A root the scan lists but left out of `containers` is built from its roots entry, or the items
    // filed directly in it would have no container to resolve their root through and be dropped.
    for (const r of snap.roots || []) {
      if (roots.has(+r.serial) && !bySerial.has(+r.serial)) bySerial.set(+r.serial, { serial: +r.serial, root: +r.serial, parent: null, kind: r.kind, name: r.name });
    }
    for (const c of bySerial.values()) {
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
      const c = bySerial.get(+raw.container);
      const root = c ? +c.root : null;
      if (root == null || !roots.has(root)) continue;
      inv.items[raw.serial] = enrich(raw, { root, container: +raw.container, equippedBy: null, layer: null, seenAt: snap.scannedAt, scannedBy: char });
    }
    for (const raw of snap.equipped || []) {
      inv.items[raw.serial] = enrich(raw, { root: null, container: null, equippedBy: char, layer: raw.layer || null, seenAt: snap.scannedAt, scannedBy: char });
    }
    if (!String(char).startsWith("_")) {   // "_vault" tombstones are not characters
      inv.characters[char] = { name: char, stats: snap.stats || {}, scannedAt: snap.scannedAt, position: snap.position || null,
        maxes: snap.maxes || null, resists: snap.resists || null, skills: snap.skills || {}, adapter: snap.adapter || null };
    }
    inv.scans.push({ character: char, scannedAt: snap.scannedAt, items: (snap.items || []).length, roots: [...roots] });
  }
  labelContainers(inv);
  for (const it of Object.values(inv.items)) it.location = locationOf(it, inv);
  return inv;
}

// A character tombstone (POST /api/forget-character: a `_vault` scan carrying `forgetCharacter`)
// removes what only that character's scans ever put there: its card, its worn set, and its backpack
// and bank roots with everything under them. Ground containers it scanned stay: they belong to a
// house, and another character's scan may be the one keeping them current. A later scan of the
// character brings it back, by the fold's usual newest-wins order.
function forgetCharacter(inv: Inventory, name: unknown): void {
  if (typeof name !== "string" || !name) return;
  const roots = new Set(Object.values(inv.containers).filter((c) => c.parent == null && c.scannedBy === name && (c.kind === "backpack" || c.kind === "bank")).map((c) => +c.root));
  for (const [serial, it] of Object.entries(inv.items)) {
    if (it.equippedBy === name || (it.root != null && roots.has(+it.root))) delete inv.items[serial];
  }
  for (const [serial, c] of Object.entries(inv.containers)) if (roots.has(+c.root)) delete inv.containers[serial];
  delete inv.characters[name];
}

// Each container's segment in location text. Location text is what the Location filter, the group
// view's per-place counts and the builder's Fetch list key on, and a house full of chests called
// "Metal Chest" (or three "A Bag"s in one backpack) would otherwise merge into one place. Containers
// that share a label and sit side by side (the same parent; for ground roots, every ground root) get
// their serial as a suffix: unlike a position, it never changes when another same-named container is
// added or moved, so a saved filter or a remembered location keeps meaning the same chest. A backpack or bank root
// is never shown by its own name (locationOf names it after its owner), so those roots are left out.
function labelContainers(inv: Inventory): void {
  const groups = new Map<string, Container[]>();
  for (const c of Object.values(inv.containers)) {
    const scope = c.parent != null ? `in ${c.parent}` : c.kind === "backpack" || c.kind === "bank" ? `own ${c.serial}` : "ground";
    const key = `${scope}\u0000${bagLabel(c)}`;
    const list = groups.get(key);
    if (list) list.push(c); else groups.set(key, [c]);
  }
  for (const list of groups.values()) {
    for (const c of list) c.label = list.length === 1 ? bagLabel(c) : `${bagLabel(c)} (0x${(+c.serial).toString(16)})`;
  }
}

function enrich(raw: EnrichRaw, loc: EnrichLoc): Item {
  const parsed = parseTooltip(raw.tooltip && raw.tooltip.length ? raw.tooltip : [raw.name], raw.amount);
  const cls = classify(parsed.name || raw.name, parsed, loc.layer, raw.graphic);
  return {
    serial: +raw.serial, name: parsed.name || raw.name || "", graphic: raw.graphic, hue: raw.hue, amount: raw.amount || 1,
    props: parsed.props, setBonus: parsed.setBonus, extras: parsed.extras, flags: parsed.flags, tags: parsed.tags, strReq: parsed.strReq,
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
    names.unshift(cur.label || bagLabel(cur));
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
  return { kind, character: owner, text, root: it.root, rootName: root ? root.label || bagLabel(root) : "?" };
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
// buildPools() only ever stores an item after `!it.slot` has already sent it to `continue` — every
// item it hands the solver has passed that filter, so its slot is honestly a string, not the plain
// OptItem's `string | null`. scripts/optimizer-core.mts declares its own (unexported) OptItem with a
// required, non-null `slot` — the two are independently declared (the core is a paste-able file with
// no imports; see its own header comment) describing the same runtime objects, and they already
// drifted once with nothing to catch it (app/solver.test.mts's compile-time assignability guard, next
// to its own note on the cast this boundary needs, is what catches it now).
export type PooledOptItem = OptItem & { slot: string };
export interface BuildPoolsOptions {
  allowOthersWorn?: boolean | undefined;
  strength?: number | undefined;
  excludeTags?: string[] | undefined;
  excludeRoots?: Array<number | string> | undefined;
  excludeGargoyle?: boolean | undefined;
  medOnly?: boolean | undefined;
  excludeWeapons?: string[] | undefined;   // weapon skills left out (weaponAllowed)
  excludeSkills?: string[] | undefined;
}
export interface SkippedLists {
  str: Item[]; tags: Item[]; worn: Item[]; roots: Item[]; gargoyle: Item[]; nonMed: Item[]; weapon: Item[]; skill: Item[];
}
export interface BuildPoolsResult {
  pools: Partial<Record<string, PooledOptItem[]>>;
  current: Partial<Record<string, PooledOptItem>>;
  skipped: SkippedLists;
  blocked: string[];
}
export function buildPools(inv: Inventory, character: string, opts: BuildPoolsOptions = {}): BuildPoolsResult {
  const { allowOthersWorn = false, strength = Infinity, excludeTags = [], excludeRoots = [], excludeGargoyle = getRules().raceLock.gargoyleOnly, medOnly = false, excludeWeapons = [], excludeSkills = [] } = opts;
  const pools: Partial<Record<string, PooledOptItem[]>> = {}, current: Partial<Record<string, PooledOptItem>> = {}, skipped: SkippedLists = { str: [], tags: [], worn: [], roots: [], gargoyle: [], nonMed: [], weapon: [], skill: [] };
  const exRoots = new Set(excludeRoots.map(Number));
  for (const it of Object.values(inv.items)) {
    if (!it.gear || !it.slot || !OPTIMIZER_SLOTS.includes(it.slot)) continue;
    // toOptItem's own return type is the plain OptItem (slot: string | null) — this cast is the one
    // place that fact narrows to PooledOptItem, backed by the `!it.slot` check just above (no runtime
    // change: opt.slot is it.slot, already known non-null here).
    const opt = toOptItem(it) as PooledOptItem;
    if (it.equippedBy === character) { if (!current[it.slot]) current[it.slot] = opt; }
    if (it.equippedBy && it.equippedBy !== character && !allowOthersWorn) { skipped.worn.push(it); continue; }
    if (excludeGargoyle && it.gargoyle) { skipped.gargoyle.push(it); continue; }
    if (medOnly && !it.medable) { skipped.nonMed.push(it); continue; }
    if (!weaponAllowed(it, excludeWeapons)) { skipped.weapon.push(it); continue; }
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
    return it && (!weaponAllowed(it, excludeWeapons) || hasSkillBonus(it, excludeSkills));
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

// Weapon-type filter for the suit builder: the weapon skills the player excluded (profile `excludeWeapons`). A weapon
// whose Skill Required line names an excluded skill never enters the pool; nothing else in the hands is touched.
export const WEAPON_SKILLS: string[] = ["archery", "swordsmanship", "fencing", "mace fighting", "throwing"];
export function weaponAllowed(it: Item, excluded: string[] = []): boolean {
  if (!excluded.length || (it.slot !== "oneHanded" && it.slot !== "twoHanded")) return true;
  return !excluded.includes(String(it.skillReq || "").toLowerCase());
}
// Profiles, templates and runs saved before the exclusion list held one choice, `weaponSkill` ("archery", or null/""
// for any weapon), which means "exclude every other weapon skill". Returns `s` itself when there is nothing to convert.
export function migrateWeaponSetting<T extends object>(s: T): T {
  if (!("weaponSkill" in s)) return s;
  const { weaponSkill, ...rest } = s as T & { weaponSkill?: unknown; excludeWeapons?: string[] };
  const skill = typeof weaponSkill === "string" ? weaponSkill.toLowerCase() : "";
  return { ...rest, excludeWeapons: rest.excludeWeapons || (skill ? WEAPON_SKILLS.filter((w) => w !== skill) : []) } as T;
}
// The rule excludeWeapons is held to at POST /api/optimize (profiles.v2.schema.json says the same): known weapon skills.
export function excludeWeaponsError(v: unknown, path = "excludeWeapons"): string | null {
  if (v == null) return null;
  if (!Array.isArray(v)) return `${path} must be an array`;
  const i = v.findIndex((w) => typeof w !== "string" || !WEAPON_SKILLS.includes(w));
  return i < 0 ? null : `${path}[${i}] is not a weapon skill (${WEAPON_SKILLS.join(", ")})`;
}

// Templates: a full set of builder settings with no character in them (no race, STR limit or skipped containers).
// A character's profile keeps its own working copy plus `template`, the name it was applied from; drift between the
// two is settingsDiff(templateFrom(template), templateFrom(profile)).
export const TEMPLATE_KEYS: string[] = ["floors", "softFloors", "weights", "floorBonus", "lockedSlots", "excludeTags", "excludeSkills", "allowOthersWorn", "allowGargoyle", "medOnly", "excludeWeapons", "resistCaps"];
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
  excludeWeapons?: string[] | undefined;   // weapon skills left out of the pool
  resistCaps?: Record<string, number> | undefined;   // the player's per-resist cap overrides, paperdoll terms
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
  excludeWeapons: string[];
  resistCaps: Record<string, number>;
}
export function templateFrom(s: TemplateSource = {}): Template {
  return { floors: { ...(s.floors || {}) }, softFloors: [...(s.softFloors || [])], weights: { ...(s.weights || {}) }, floorBonus: s.floorBonus ?? 1000,
    lockedSlots: [...(s.lockedSlots || [])], excludeTags: [...(s.excludeTags || [])], excludeSkills: [...(s.excludeSkills || [])],
    allowOthersWorn: !!s.allowOthersWorn, allowGargoyle: !!s.allowGargoyle, medOnly: !!s.medOnly, excludeWeapons: [...(s.excludeWeapons || [])], resistCaps: { ...(s.resistCaps || {}) } };
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
// it once the file is at v2 (effectiveProfile takes caps from getRules() now). A character's or template's single
// `weaponSkill` becomes `excludeWeapons` (migrateWeaponSetting), still at schemaVersion 2. Pure: a file already at
// schemaVersion 2 in the new shape comes back equal, changed false.
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
  // The single weapon choice became an exclusion list: "archery only" is "exclude every other weapon skill".
  const weapons = <T extends object>(m: Record<string, T>): Record<string, T> => {
    if (!Object.values(m).some((e) => e && typeof e === "object" && "weaponSkill" in e)) return m;
    changed = true;
    return Object.fromEntries(Object.entries(m).map(([n, e]) => [n, e && typeof e === "object" ? migrateWeaponSetting(e) : e]));
  };
  out.characters = weapons(out.characters);
  out.templates = weapons(out.templates);
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
  excludeWeapons?: string[] | undefined;
  strLimit?: number | undefined;
  restarts?: number | undefined;
  budgetMs?: number | undefined;
  altCount?: number | undefined;
  altTol?: number | undefined;
  resistCaps?: Record<string, number> | undefined;
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
  // A resist cap override: set, changed, or taken off (back to the shard's cap for the character's race).
  const RA: Record<string, number> = a.resistCaps || {}, RB: Record<string, number> = b.resistCaps || {};
  for (const k of RESIST_KEYS.filter((x) => x in RA || x in RB)) {
    if (!(k in RA)) out.push(`${L(k)} cap set to ${RB[k]}`);
    else if (!(k in RB)) out.push(`${L(k)} cap back to the shard's`);
    else if (RA[k] !== RB[k]) out.push(`${L(k)} cap ${RA[k]} → ${RB[k]}`);
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
  const [wOn, wOff] = setDiff(a.excludeWeapons, b.excludeWeapons);
  if (wOn.length) out.push(`excluding ${wOn.join(", ")} weapons`);
  if (wOff.length) out.push(`allowing ${wOff.join(", ")} weapons`);
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
const ARMOR_SLOT_SET = new Set(["helmet", "chest", "arms", "hands", "legs", "neck", "feet", "robe", "tunic", "waist", "shirt"]);
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
