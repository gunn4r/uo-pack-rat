// domain/pools.mts — what the optimizer picks from: buildPools turns the inventory into each slot's candidates for a character (STR-gated, tag-filtered, weapons by skill and must-have flags), toOptItem an item into the solver's shape, totalsOf a suit's totals and requirementReport its rows; plus the property, extra, flag and skill keys an inventory offers the builder and the filters.
//
// map: builder
// owns: `OptItem`, `buildPools`, `toOptItem`, `totalsOf`, `requirementReport`, `gearSkills`, `builderKeys`, `propertyKeys`, `extraKeys`, `flagKeys`, `flagKey`, `flagLabel`, `weaponAllowed`, `weaponSkillsOf`, `WEAPON_SKILLS`, `itemTypeOf`, `ITEM_TYPES`, `itemSearchBlob`
import { floorMet, heldTotal, liftedMin, RESIST_SKILL_KEY, type ResistStep } from "../solver/scoring.mts";
import { getRules } from "./rules.mts";
import { labelOf, PROP_LABELS, SKILL_SET, type PropMap } from "./properties.mts";
import { GEAR_SLOTS, HAND_SLOTS, REQUIRED_SLOTS, SLOT_GROUP, SPELLBOOK_RE } from "./slots.mts";
import { slayersOf } from "./kinds.mts";
import type { Inventory, Item } from "./fold.mts";

// What propertyKeys()/gearSkills() actually read — just `.items`, either the fold's Record form or
// the plain array item-query.mts's facetsOf() passes ({items} over an already-filtered Item[]).
export interface ItemsLike {
  items: Record<string, Item> | Item[];
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
  speed?: number | undefined;   // a weapon's base speed in seconds (its tooltip's Weapon Speed), for swing steps (app/swing.mts)
  tieCost?: number | undefined; // a rarity preference's per-piece cost (POST /api/optimize stamps it): among equally good suits the solvers take the lowest sum
}
// buildPools() only ever stores an item after `!it.slot` has already sent it to `continue` — every
// item it hands the solver has passed that filter, so its slot is honestly a string, not the plain
// OptItem's `string | null`. scripts/optimizer-core.mts declares its own (unexported) OptItem with a
// required, non-null `slot` — the two are independently declared (at run time the core imports only
// app/solver/scoring.mts; see its own header comment) describing the same runtime objects, and they already
// drifted once with nothing to catch it (app/solver.test.mts's compile-time assignability guard, next
// to its own note on the cast this boundary needs, is what catches it now).
export type PooledOptItem = OptItem & { slot: string };
export interface BuildPoolsOptions {
  allowOthersWorn?: boolean | undefined;
  strength?: number | undefined;
  excludeTags?: string[] | undefined;
  excludeRoots?: Array<number | string> | undefined;
  onlyRoots?: number[] | undefined;        // issue #12: when it lists any, an unworn piece is a candidate only under one of these roots (worn pieces follow their own rule)
  excludeGargoyle?: boolean | undefined;
  medOnly?: boolean | undefined;
  excludeWeapons?: string[] | undefined;   // weapon skills left out (weaponAllowed)
  ubwsAnyWeapon?: boolean | undefined;     // a Use Best Weapon Skill weapon passes while a melee skill is allowed (default on)
  excludeSkills?: string[] | undefined;
  weaponMustHave?: string[] | undefined;   // yes/no properties every weapon must carry (weaponHasFlags, issue #214)
  lockedSlots?: string[] | undefined;      // a locked slot keeps its worn weapon whatever weaponMustHave says (`weaponFlags.kept`)
  // Manual's placed pieces by slot (issue #12, "Fill the rest automatically"): each is its slot's only candidate and
  // the suit's current piece there, and nothing else is current.
  pinned?: Partial<Record<string, number>> | undefined;
}
export interface SkippedLists {
  str: Item[]; tags: Item[]; worn: Item[]; roots: Item[]; gargoyle: Item[]; nonMed: Item[]; weapon: Item[]; skill: Item[];
}
export interface BuildPoolsResult {
  pools: Partial<Record<string, PooledOptItem[]>>;
  current: Partial<Record<string, PooledOptItem>>;
  skipped: SkippedLists;
  blocked: string[];
  // With weaponMustHave: the locked slots whose worn weapon lacks a required property (kept, the lock wins), and whether
  // the requirement itself emptied both hands' pools of weapons (the suit is then built without one). A pool the other
  // settings left weaponless is not `none`: the requirement is not why.
  weaponFlags?: { kept: string[]; none: boolean } | undefined;
}
// `character` null: nobody's suit (Manual's No character), so every worn piece is another character's.
export function buildPools(inv: Inventory, character: string | null, opts: BuildPoolsOptions = {}): BuildPoolsResult {
  const { allowOthersWorn = false, strength = Infinity, excludeTags = [], excludeRoots = [], onlyRoots = [], excludeGargoyle = getRules().raceLock.gargoyleOnly, medOnly = false, excludeWeapons = [], ubwsAnyWeapon = true, excludeSkills = [], weaponMustHave = [], lockedSlots = [], pinned } = opts;
  const pools: Partial<Record<string, PooledOptItem[]>> = {}, current: Partial<Record<string, PooledOptItem>> = {}, skipped: SkippedLists = { str: [], tags: [], worn: [], roots: [], gargoyle: [], nonMed: [], weapon: [], skill: [] };
  const exRoots = new Set(excludeRoots.map(Number)), only = new Set(onlyRoots.map(Number));
  let flagless = 0;   // weapons the required properties left out (weaponMustHave)
  for (const it of Object.values(inv.items)) {
    if (!it.gear || !it.slot || !GEAR_SLOTS.includes(it.slot)) continue;
    // toOptItem's own return type is the plain OptItem (slot: string | null) — this cast is the one
    // place that fact narrows to PooledOptItem, backed by the `!it.slot` check just above (no runtime
    // change: opt.slot is it.slot, already known non-null here).
    const opt = toOptItem(it) as PooledOptItem;
    if (character != null && it.equippedBy === character) { if (!current[it.slot] && !pinned) current[it.slot] = opt; }
    if (it.equippedBy && it.equippedBy !== character && !allowOthersWorn) { skipped.worn.push(it); continue; }
    if (excludeGargoyle && it.gargoyle) { skipped.gargoyle.push(it); continue; }
    if (medOnly && !it.medable) { skipped.nonMed.push(it); continue; }
    if (!weaponAllowed(it, excludeWeapons, ubwsAnyWeapon)) { skipped.weapon.push(it); continue; }
    if (hasSkillBonus(it, excludeSkills)) { skipped.skill.push(it); continue; }
    if (it.strReq > strength) { skipped.str.push(it); continue; }
    if (it.tags.some((t) => excludeTags.includes(t))) { skipped.tags.push(it); continue; }
    // with an Only containers list, an unworn piece in no container (carried by a trip with no backpack to put it in) is outside it
    const outside = it.root == null ? only.size > 0 && !it.equippedBy : (only.size > 0 && !only.has(+it.root)) || exRoots.has(+it.root);
    if (outside) { skipped.roots.push(it); continue; }
    // last, so `flagless` counts only weapons every other filter let through
    if (!weaponHasFlags(it, weaponMustHave)) { skipped.weapon.push(it); flagless++; continue; }
    // a piece with no properties (a tag penalty aside, as classify reads it) never beats an empty slot, so where a slot
    // may stay empty it is no candidate: the search would otherwise send the player for a plain robe or shirt that
    // changes nothing. A plain weapon or shield stays one: what a weapon is for is not in its properties.
    if (!REQUIRED_SLOTS.includes(it.slot) && !HAND_SLOTS.includes(it.slot) && !Object.entries(opt.props).some(([k, v]) => v && k !== "tagPenalty")) continue;
    (pools[it.slot] ||= []).push(opt);
  }
  // A pinned piece is kept whoever wears it and whatever the filters say. The hand rule holds in the pools: a pinned
  // two-handed weapon empties the one-hand slot, and a pinned one-hander keeps two-handed weapons out of the other hand.
  for (const [slot, serial] of Object.entries(pinned || {})) {
    const it = serial != null ? inv.items[serial] : undefined;
    if (it?.gear && it.slot === slot && GEAR_SLOTS.includes(slot)) pools[slot] = [current[slot] = toOptItem(it) as PooledOptItem];
  }
  if (current.twoHanded?.twoHanded && pinned?.twoHanded != null) pools.oneHanded = [];
  if (current.oneHanded && pinned?.oneHanded != null) pools.twoHanded = (pools.twoHanded || []).filter((it) => !it.twoHanded);
  // A worn piece the filters rule out (wrong weapon type, a forbidden skill bonus, a missing weapon property) must not
  // stay a candidate through the "keep what you wear" rule. A pinned piece is never blocked, and a locked slot keeps a
  // weapon that lacks a required property: the player chose it.
  // The game never wears a two-handed weapon beside a one-hander (a demo fixture does): the one hand reads as empty, as
  // the core's optSanitize would leave it, so the exact search never starts from a suit nobody can wear.
  if (current.twoHanded?.twoHanded && current.oneHanded) delete current.oneHanded;
  const wornAt = (sl: string): Item | null => (current[sl] && pinned?.[sl] == null ? inv.items[current[sl]!.serial] || ({} as Item) : null);
  const kept = weaponMustHave.length ? HAND_SLOTS.filter((sl) => lockedSlots.includes(sl) && wornAt(sl) && !weaponHasFlags(wornAt(sl)!, weaponMustHave)) : [];
  const blocked = GEAR_SLOTS.filter((sl) => {
    const it = wornAt(sl);
    return it && (!weaponAllowed(it, excludeWeapons, ubwsAnyWeapon) || hasSkillBonus(it, excludeSkills) || (!weaponHasFlags(it, weaponMustHave) && !kept.includes(sl)));
  });
  if (!weaponMustHave.length) return { pools, current, skipped, blocked };
  const none = flagless > 0 && !kept.length && !HAND_SLOTS.some((sl) => (pools[sl] || []).some((o) => isWeapon(inv.items[o.serial] || ({} as Item))));
  return { pools, current, skipped, blocked, weaponFlags: { kept, none } };
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
// A weapon with Use Best Weapon Skill swings with the wielder's best of the three melee skills, never Archery or
// Throwing (ServUO BaseWeapon.GetUsedSkill), so with `ubws` on it passes while any of those three is allowed.
export const WEAPON_SKILLS: string[] = ["archery", "swordsmanship", "fencing", "mace fighting", "throwing"];
export const MELEE_SKILLS: string[] = ["swordsmanship", "fencing", "mace fighting"];
// Issue #259: the list may also hold SPELLBOOKS ("spellbook"), which keeps every spellbook (a one-handed piece whose name
// SPELLBOOK_RE matches) out of the pool. WEAPON_EXCLUDES is everything the list accepts, in the order the page shows it.
export const SPELLBOOKS = "spellbook";
export const WEAPON_EXCLUDES: string[] = [...WEAPON_SKILLS, SPELLBOOKS];
export const ubwsLetsIn = (excluded: string[], ubws = true): boolean => ubws && MELEE_SKILLS.some((w) => !excluded.includes(w));
export function weaponAllowed(it: Item, excluded: string[] = [], ubws = true): boolean {
  if (it.slot === "oneHanded" && excluded.includes(SPELLBOOKS) && SPELLBOOK_RE.test(it.name || "")) return false;
  if (!excluded.some((w) => w !== SPELLBOOKS) || (it.slot !== "oneHanded" && it.slot !== "twoHanded")) return true;
  const own = String(it.skillReq || "").toLowerCase();
  if ((it.flags || []).includes("use best weapon skill")) {
    if (ubwsLetsIn(excluded, ubws)) return true;
    // No Skill Required line (#193): it swings with a melee skill, and nothing vouches for one.
    if (!own) return false;
  }
  return !excluded.includes(own);
}
// Issue #188: the weapon skills a weapon counts under in the Inventory's Weapon skill filter, in WEAPON_SKILLS order: its
// Skill Required line, and with Use Best Weapon Skill also the three melee skills it may swing with (ServUO
// BaseWeapon.GetUsedSkill), the same MELEE_SKILLS the Suit Builder's weaponAllowed uses (#187).
export function weaponSkillsOf(it: Pick<Item, "slot" | "skillReq" | "flags">): string[] {
  if (it.slot !== "oneHanded" && it.slot !== "twoHanded") return [];
  const own = String(it.skillReq || "").toLowerCase(), best = (it.flags || []).includes("use best weapon skill");
  return WEAPON_SKILLS.filter((w) => w === own || (best && MELEE_SKILLS.includes(w)));
}
// Issue #214: the yes/no properties a build may require on its weapon (profile `weaponMustHave`): any of BOOLEAN_FLAGS
// is accepted, and the page offers WEAPON_MUST_HAVE. A weapon is a held piece with a Skill Required or Weapon Speed
// line, so shields and spellbooks are never held to it.
export const WEAPON_MUST_HAVE: string[] = ["spell channeling", "balanced"];
export const isWeapon = (it: Pick<Item, "slot" | "skillReq" | "extras">): boolean =>
  (it.slot === "oneHanded" || it.slot === "twoHanded") && (!!it.skillReq || typeof it.extras?.["weapon speed"] === "number");
// The Type filter: what a piece is, in the shard's words. A weapon is one- or two-handed by its tooltip's "One-handed
// Weapon" / "Two-handed Weapon" line (classify's twoHanded, which falls back to the name only without one); a held piece
// that is no weapon is a shield in the two-handed slot (whatever its name: an artifact shield says nothing) and a
// spellbook in the one-handed one; the rest by its slot's group. Anything else, and every item that is not gear, is Other.
export const ITEM_TYPES = ["shield", "two-handed", "one-handed", "spellbook", "armor", "jewelry", "clothing", "other"] as const;
export type ItemType = (typeof ITEM_TYPES)[number];
export const ITEM_TYPE_LABELS: Readonly<Record<ItemType, string>> = { shield: "Shield", "two-handed": "Two-handed weapon", "one-handed": "One-handed weapon", spellbook: "Spellbook", armor: "Armor", jewelry: "Jewelry", clothing: "Clothing", other: "Other" };
const GROUP_TYPE: Readonly<Record<string, ItemType>> = { Armor: "armor", Jewelry: "jewelry", Clothing: "clothing" };
// The types a slot holds: a hand two (a weapon, or a shield or spellbook), any other slot its group's.
export const typesOfSlot = (slot: string): ItemType[] => (slot === "twoHanded" ? ["two-handed", "shield"] : slot === "oneHanded" ? ["one-handed", "spellbook"] : [GROUP_TYPE[SLOT_GROUP[slot] ?? ""] ?? "other"]);
export function itemTypeOf(it: Pick<Item, "gear" | "slot" | "twoHanded" | "skillReq" | "extras">): ItemType {
  if (!it.gear || !it.slot) return "other";
  if (isWeapon(it)) return it.twoHanded ? "two-handed" : "one-handed";
  if (it.slot === "twoHanded") return "shield";
  if (it.slot === "oneHanded") return "spellbook";
  return GROUP_TYPE[SLOT_GROUP[it.slot] ?? ""] ?? "other";
}
// The required properties a piece lacks, its flags read through flagKey; none for a piece that is no weapon.
export function missingFlags(it: Item, required: string[] = []): string[] {
  if (!required.length || !isWeapon(it)) return [];
  const own = (it.flags || []).map(flagKey);
  return required.filter((f) => !own.includes(f));
}
export const weaponHasFlags = (it: Item, required: string[] = []): boolean => !missingFlags(it, required).length;
// The rule weaponMustHave is held to (profiles.v3.schema.json says the same): known yes/no properties, each once.
export function weaponMustHaveError(v: unknown, path = "weaponMustHave"): string | null {
  if (v == null) return null;
  if (!Array.isArray(v)) return `${path} must be an array`;
  const i = v.findIndex((f, j) => typeof f !== "string" || !BOOLEAN_FLAGS.has(f) || v.indexOf(f) !== j);
  return i < 0 ? null : `${path}[${i}] is not a yes/no property, or is listed twice (${[...BOOLEAN_FLAGS].join(", ")})`;
}
// Profiles, templates and runs saved before the exclusion list held one choice, `weaponSkill` ("archery", or null/""
// for any weapon), which means "exclude every other weapon skill". Returns `s` itself when there is nothing to convert.
export function migrateWeaponSetting<T extends object>(s: T): T {
  if (!("weaponSkill" in s)) return s;
  const { weaponSkill, ...rest } = s as T & { weaponSkill?: unknown; excludeWeapons?: string[] };
  const skill = typeof weaponSkill === "string" ? weaponSkill.toLowerCase() : "";
  return { ...rest, excludeWeapons: rest.excludeWeapons || (skill ? WEAPON_SKILLS.filter((w) => w !== skill) : []) } as T;
}
// The rule excludeWeapons is held to at POST /api/optimize (profiles.v3.schema.json says the same): known weapon skills,
// or "spellbook".
export function excludeWeaponsError(v: unknown, path = "excludeWeapons"): string | null {
  if (v == null) return null;
  if (!Array.isArray(v)) return `${path} must be an array`;
  const i = v.findIndex((w) => typeof w !== "string" || !WEAPON_EXCLUDES.includes(w));
  return i < 0 ? null : `${path}[${i}] must be a weapon skill or spellbook (${WEAPON_EXCLUDES.join(", ")})`;
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
  const speed = it.extras?.["weapon speed"];
  if (typeof speed === "number" && speed > 0) o.speed = speed;
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
  mins?: Record<string, number> | undefined;   // EffectiveProfile.mins: a resist under its minimum counts as the minimum
  resistSteps?: ResistStep[] | undefined;      // EffectiveProfile.resistSteps: the minimum the suit's own Resisting Spells bonus lifts it to
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
// Requirement report: for every floor and every cap, what the suit reaches (a resist held at its minimum, `mins`).
export function requirementReport(totals: PropMap, profile: RequirementProfileInput): RequirementRow[] {
  const rows: RequirementRow[] = [];
  const floors = profile.floors || {}, caps = profile.caps || {};
  const keys = new Set([...Object.keys(floors), ...Object.keys(profile.weights || {})]);
  keys.delete("tagPenalty");
  for (const k of [...keys].sort((a, b) => (floors[b] ? 1 : 0) - (floors[a] ? 1 : 0) || a.localeCompare(b))) {
    // a resist under its minimum reaches the minimum, so its value says that, and `met` agrees with it
    const v = totals[k] || 0, floor = floors[k], cap = caps[k], min = liftedMin(profile, k, totals[RESIST_SKILL_KEY] || 0), held = heldTotal(v, min);
    rows.push({ key: k, label: labelOf(k), value: held, floor: floor ?? null, cap: cap ?? null,
      met: floor == null ? null : floorMet(v, floor, min), capped: cap != null && v >= cap, over: cap != null ? Math.max(0, v - cap) : 0 });
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
// Issue #133: the numeric tooltip lines no property models (parseTooltip's extras: "splintering weapon", "hit fatigue",
// "weapon speed"), skill bonuses and ranges left out, so a property filter can put a threshold on them
// (item-query.mts's colVal reads them). Apart from propertyKeys, which the Suit Builder's weights and floors list too.
export function extraKeys(inv: ItemsLike): string[] {
  const set = new Set<string>();
  for (const it of Object.values(inv.items)) for (const [k, v] of Object.entries(it.extras || {})) if (typeof v === "number" && !SKILL_SET.has(k)) set.add(k);
  return [...set].sort();
}
// Issue #182: the yes/no properties a filter can require (parseTooltip's flags), the ones present in the inventory.
// A flag is offered when it is a known yes/no property (ServUO's boolean item attributes, "(imbued)", "part of an armor
// set", plus the shard's item states) on any item, or when, on a piece of gear, it reads like one: one to four plain
// words, with no digits or punctuation (which rules out "set: …", "engraved: …" and "1st year veteran reward"), no
// linking word ("crafted by …", "blessed for …", "a recall rune for …") and no race lock ("gargoyles only", which the
// gargoyle switch covers). Gear only, because a resource's lines are its material ("valorite", "barbed leather"), never
// a property. Slayers have the Slayer filter, and tags (cursed, antique …) never reach the flags: parseTooltip files
// them under tags.
export const BOOLEAN_FLAGS: ReadonlySet<string> = new Set(["spell channeling", "mage armor", "night sight", "balanced", "use best weapon skill", "blessed", "insured", "exceptional", "reactive paralyze", "battle lust", "(imbued)", "part of an armor set"]);
const FLAG_LIKE_RE = /^[a-z]+(?: [a-z]+){0,3}$/;
const FREE_TEXT_RE = /\b(by|for|of|from|to|in|on|only)\b/;
const ARMOR_SET_RE = /^part of an armor set\b/;
// The key a flag is offered and matched under, lower-cased: every set piece's "part of an armor set (6 pieces)" is one
// "part of an armor set", whatever its piece count. A filter's own flags go through it too, so a hand-edited rule's
// "Spell Channeling" still matches.
export const flagKey = (f: string): string => {
  const k = f.toLowerCase();
  return ARMOR_SET_RE.test(k) ? "part of an armor set" : k;
};
const isPropertyFlag = (f: string, gear: boolean): boolean => !slayersOf([f]).length && (BOOLEAN_FLAGS.has(f) || (gear && FLAG_LIKE_RE.test(f) && !FREE_TEXT_RE.test(f)));
export function flagKeys(inv: ItemsLike): string[] {
  const set = new Set<string>();
  for (const it of Object.values(inv.items)) for (const raw of it.flags || []) { const f = flagKey(raw); if (isPropertyFlag(f, !!it.gear)) set.add(f); }
  return [...set].sort((a, b) => flagLabel(a).localeCompare(flagLabel(b)));
}
// A flag's display name, in title case with its brackets dropped: "spell channeling" reads "Spell Channeling",
// "(imbued)" "Imbued", "part of an armor set" "Part of an Armor Set".
const SMALL_WORDS = new Set(["a", "an", "the", "of", "by", "for", "in", "on", "to"]);
export const flagLabel = (f: string): string => f.replace(/[()]/g, "").trim().split(" ").map((w, i) => (i && SMALL_WORDS.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1))).join(" ");

// The item's own words (name, tooltip lines, rarity, kind), never where it sits: what an Organize rule's free
// text is matched against (item-query.mts's matchesItem, issue #11).
// The name once more with its punctuation as spaces, so "transcendence animal lore" finds "Scroll of Transcendence
// (Animal Lore - 0.1 Pts)" (issue #181).
const plainName = (it: Item): string => it.name.replace(/[^\p{L}\p{N}.]+/gu, " ");
export function itemOwnBlob(it: Item): string {
  return [it.name, plainName(it), ...(it.lines || []), it.rarity || "", it.kind || ""].join(" \n ").toLowerCase();
}

export function itemSearchBlob(it: Item): string {
  return [it.name, plainName(it), ...(it.lines || []), it.location?.text || "", it.rarity || "", it.kind || ""].join(" \n ").toLowerCase();
}
