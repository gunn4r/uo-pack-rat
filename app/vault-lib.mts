// vault-lib.mts — Pack Rat's shared kernel, page and server alike, as one import: it re-exports the app/domain/ modules (the property registry, tooltip parsing, slot classification, kinds, the inventory fold, the optimizer pools, the goals and the bridge
// features) and still holds profiles. Used by index.html (browser, via the
// server) and gear-vault.test.mts (Node). No dependencies, no DOM.
//
// Shard rules (property caps, the Resisting Spells resist minimum, race cap overrides, tag-
// penalty units, the rarity ladder, the gargoyle race-lock policy) live in app/rules/<shard>.json,
// loaded (Node-only, by app/rules.mts) and handed in here with setRules() — this module never reads
// a rules file itself, so it stays usable in the browser. getRules() throws until setRules() has run:
// a forgotten call must be loud, not a silent wrong answer.
//
// The kernel is being split by concept into app/domain/ (issue #338): what has moved there is re-exported here under the
// same names, so every importer keeps importing from this file.
//
// map: scan
// owns: the re-exports of app/domain/; still here: `effectiveProfile`, `migrateProfiles`, `settingsChanges`
import { RESIST_SKILL_KEY, RESIST_STEP_SLACK, liftedMin, type ResistStep } from "./solver/scoring.mts";
import { isPseudoCharacter, NOBODY } from "./scan-schema.mts";
export { isPseudoCharacter, NOBODY };
import type { RulesV1 } from "./schema/types.d.mts";
import { getRules } from "./domain/rules.mts";
export { setRules, getRules } from "./domain/rules.mts";
import { importanceText, labelOf, RESIST_KEYS } from "./domain/properties.mts";
export { type ExtraValue, type PropMap, type ExtrasMap, PROPERTIES, type PropKey, PROP_PATTERNS, PROP_LABELS, NOT_BUILDER_KEYS, PROP_FULL, typicalRange, IMPORTANCE_K, importanceOf, weightOfImportance, roundImportance, withCurrentActions, SKILL_NAMES, labelOf, fullOf, propName, goalWord, type ResistMeta, RESIST_META, RESIST_KEYS } from "./domain/properties.mts";
export { type ParsedTooltip, tagUnits, tagInfo, stackName, parseTooltip, compareNames, shownName, gameName, displayName } from "./domain/tooltip.mts";
import { SLOT_LABELS } from "./domain/slots.mts";
export { type ClassifyResult, LAYER_TO_SLOT, LAYER_ALIASES, GEAR_SLOTS, type SlotGroup, GEAR_SLOT_GROUPS, SLOT_GROUP, SLOTS_IN_GROUP, NECK_ARMOR_WORDS, isNeckArmor, REQUIRED_SLOTS, SLOT_LABELS, type SpellSchool, spellSchoolOf, layerOfGraphic, classify } from "./domain/slots.mts";
export { KINDS, INSTRUMENTS, kindOf, type KindOverrides, OVERRIDE_KINDS, NO_KIND_OVERRIDES, kindNameKey, kindGraphicKey, ownKind, overriddenKind, slayersOf, medableOf } from "./domain/kinds.mts";
import { type Character } from "./domain/fold.mts";
export { type ItemLocation, type Item, type Container, type ContainerCapacity, type Character, type ScanSummary, type Inventory, containerChain, type BlacklistEntry, foldSnapshots, TRASH_RE, containerPath, bagLabel, capacityOf, locationOf, type ItemGroup, groupByName } from "./domain/fold.mts";
import { SPELLBOOKS, migrateWeaponSetting } from "./domain/pools.mts";
export { type ItemsLike, type OptItem, type PooledOptItem, type BuildPoolsOptions, type SkippedLists, type BuildPoolsResult, buildPools, hasSkillBonus, gearSkills, builderKeys, WEAPON_SKILLS, MELEE_SKILLS, SPELLBOOKS, WEAPON_EXCLUDES, ubwsLetsIn, weaponAllowed, weaponSkillsOf, WEAPON_MUST_HAVE, isWeapon, missingFlags, weaponHasFlags, weaponMustHaveError, migrateWeaponSetting, excludeWeaponsError, toOptItem, totalsOf, type RequirementProfileInput, type RequirementRow, requirementReport, propertyKeys, extraKeys, BOOLEAN_FLAGS, flagKey, flagKeys, flagLabel, itemOwnBlob, itemSearchBlob } from "./domain/pools.mts";
import { type Goals, goalsActive, goalsText, copyGoals } from "./domain/goals.mts";
export { GOAL_LEFTOVERS, type GoalLeftover, SWING_GOALS, type GoalSwing, GOAL_STRATEGIES, STRICT_PROMISE, STRATEGY_HELP, TAGGED_NOTE, FEWEST_HELP, type Goals, RANK_IMPORTANCE, rankImportance, LEFTOVER_IMPORTANCE, LEFTOVER_GROUPS, LEFTOVER_LABELS, goalsActive, compileGoals, goalsText, GOAL_RANKS_MAX, GOAL_RANK_SIZE_MAX, isGoalProperty, goalsError, goalLabel, copyGoals } from "./domain/goals.mts";
export { type BridgeAction, BRIDGE_ACTION_LABELS, BRIDGE_OFFLINE, type FeatureDeclaration, type FeatureSource, newestScanAdapter, bridgeFeatures, type BridgeGate, bridgeRefusal } from "./domain/bridge-features.mts";

// The Resisting Spells minimum at one skill value: no resist falls below it, and it does not add to gear (ServUO
// PlayerMobile.GetMinResistance, the shard's rules `resistMinimum`). With fixed = the skill × 10: 40 + (fixed − 1000) / 50
// from 1000, (fixed − 400) / 15 from 400, integer division, so 55 → 10, 100 → 40, 120 → 44. Null below 40 skill, or on a
// shard whose rules give no minimum: nothing holds a resist up then, not even at 0.
export function minResistAt(value: number): number | null {
  if (!getRules().resistMinimum) return null;
  const fixed = Math.floor(value * 10 + 1e-6);
  if (fixed >= 1000) return 40 + Math.floor((fixed - 1000) / 50);
  return fixed >= 400 ? Math.floor((fixed - 400) / 15) : null;
}
// The property an item's Resisting Spells skill bonus is read into ("Resisting Spells +10" on a bracelet): RESIST_SKILL_KEY,
// from app/solver/scoring.mts, re-exported here with RESIST_STEP_SLACK for the modules that read them from the kernel.
export { RESIST_SKILL_KEY, RESIST_STEP_SLACK };
// A character's own Resisting Spells, without what its worn suit adds: the scan's base (its value when the scan has no
// base), null when the scan has no such skill. A suit's own bonus (RESIST_SKILL_KEY) goes on top of it, so a minimum
// is never taken from pieces the suit may not keep.
export function resistSkillOf(skills: Record<string, unknown> | null | undefined): number | null {
  // skills is Record<string, unknown> (the scan schema leaves per-skill shape loose); every skill
  // entry this repo ever reads or writes is {base, value, cap} (see the CLAUDE.md note on
  // player.getSkill), so this narrows once at the read instead of scattering `as` down the line.
  const e = skills?.["Resisting Spells"] as { base?: number; value?: number } | undefined;
  if (!e) return null;
  return typeof e.base === "number" && Number.isFinite(e.base) ? e.base : Number(e.value) || 0;
}
// A character's Resisting Spells cap as scanned, null when the scan has none (skillInSuit then takes SKILL_CAP_TOP).
export function resistSkillCapOf(skills: Record<string, unknown> | null | undefined): number | null {
  const cap = (skills?.["Resisting Spells"] as { cap?: number } | undefined)?.cap;
  return typeof cap === "number" && Number.isFinite(cap) ? cap : null;
}
// The highest cap a skill takes (a 120 power scroll): the cap of a skill whose scan has none.
export const SKILL_CAP_TOP = 120;
// A character's own skill with a suit's item bonus to it and the skill's cap (null: SKILL_CAP_TOP), as skillInSuit takes them.
export interface SuitSkill { skill: number; bonus: number; cap: number | null }
// A skill in a suit, as ServUO's Skill.Value works it out: a loss that ignores the cap (Protection's) comes off the
// skill first, then the suit's item bonus, which stops at the skill's cap and adds nothing to a skill already there.
export function skillInSuit(skill: number, bonus: number, cap: number | null, loss = 0): number {
  const v = skill + loss, top = cap ?? SKILL_CAP_TOP;
  return v >= top ? v : Math.min(v + bonus, top);
}
// A character's Resisting Spells minimum in a suit carrying `bonus` Resisting Spells (0: the character's own).
export function resistMinimum(skills: Record<string, unknown> | null | undefined, bonus = 0): number | null {
  const skill = resistSkillOf(skills);
  return skill == null ? null : minResistAt(skillInSuit(skill, bonus, resistSkillCapOf(skills)));
}
// One step of the Resisting Spells minimum a suit's own bonus lifts (EffectiveProfile.resistSteps), and the minimum a
// resist is held at given the steps: app/solver/scoring.mts, re-exported here.
export { liftedMin, type ResistStep };
// RESIST_STEP_SLACK, half a tenth of a point: a suit reaches a step when its bonus total is at least `at` less this. Bonuses
// come in tenths at the finest, so the margin changes nothing for a real total and lets the MIP tell "under" from "at" with
// room to spare.
// Every step the minimum takes as a suit's Resisting Spells bonus rises from 0, a tenth at a time, until the skill
// reaches its cap: `skill` the character's own, `cap` its cap (null: SKILL_CAP_TOP), `loss` what the planned buffs take
// off it (Protection's), `share` a resist's in-cap share from the buffs. Empty when no bonus can change the minimum.
export function resistStepsFor(skill: number, cap: number | null, loss: number, share: (k: string) => number): ResistStep[] {
  const out: ResistStep[] = [], top = cap ?? SKILL_CAP_TOP;
  let last = minResistAt(skillInSuit(skill, 0, cap, loss));
  for (let tenths = 1; skillInSuit(skill, (tenths - 1) / 10, cap, loss) < top; tenths++) {
    const at = tenths / 10, m = minResistAt(skillInSuit(skill, at, cap, loss));
    if (m == null || m === last) continue;
    out.push({ at, mins: Object.fromEntries(RESIST_KEYS.map((k) => [k, m - share(k)])) });
    last = m;
  }
  return out;
}
// What a rules file written before issue #261 must change, or null: it still carries the old additive
// `resistSkillBonus`, which nothing reads, and no `resistMinimum`, so its characters get no minimum at all.
export function rulesUpgradeNote(rules: RulesV1): string | null {
  const r = rules as RulesV1 & { resistSkillBonus?: unknown };
  return r.resistSkillBonus != null && r.resistMinimum == null
    ? `The "${rules.name}" rules file still has "resistSkillBonus", which Pack Rat no longer reads: Resisting Spells is a minimum under each resist now. Add "resistMinimum": { "kind": "servuo" } to it, or each resist goes without a minimum.`
    : null;
}
// A paperdoll resist: the total held to its cap, and never below the Resisting Spells minimum (null: none).
export const paperdollResist = (total: number, cap: number, min: number | null | undefined): number => Math.max(Math.min(total, cap), min ?? -Infinity);

// A resist's paperdoll cap on this shard for a race (an Elf's Energy is 75 on uoalive), else the shard's cap.
export function shardResistCap(k: string, race: string | null | undefined): number {
  const rules = getRules();
  return (rules.raceCaps as Record<string, Record<string, number>> | undefined)?.[race as string]?.[k] ?? (rules.caps as Record<string, number>)[k] ?? 70;
}
// The range a player's resist cap override may take (the Builder's Resist caps fields, a profile's or template's
// resistCaps, a saved run's settings.resistCaps): whole paperdoll numbers.
export const RESIST_CAP_LIMITS = { min: 0, max: 150 } as const;
// A resist's cap for one build, in paperdoll terms: `cap` is what the build values the resist up to, `shard` what
// the shard's rules give this race. They differ only where the player overrode the cap. For a form or spell that
// lowers a resist (Reaper Form takes 25 Fire), turn the buff on in the Buffs section rather than raising the cap: the
// plan then counts the loss itself, and ignores an override above the shard's cap while it does (app/buffs.mts).
export interface ResistCap { cap: number; shard: number }
export function resistCapsFor(race: string | null | undefined, overrides: Record<string, number> | null | undefined): Record<string, ResistCap> {
  return Object.fromEntries(RESIST_KEYS.map((k) => {
    const shard = shardResistCap(k, race), o = overrides?.[k];
    return [k, { cap: typeof o === "number" && Number.isFinite(o) ? o : shard, shard }];
  }));
}
// What a resistCaps value is wrong about, or null when it is fine: an object naming only the five resists, each a
// whole number within RESIST_CAP_LIMITS. The server checks a build's settings with this; PATCH /api/profiles checks
// profiles.json's with the same rule, written as JSON Schema in profiles.v3.schema.json.
export function resistCapsError(v: unknown, path = "resistCaps"): string | null {
  if (v == null) return null;
  if (typeof v !== "object" || Array.isArray(v)) return `${path} must be an object`;
  for (const [k, n] of Object.entries(v)) {
    if (!RESIST_KEYS.includes(k)) return `${path}.${k} is not a resist`;
    if (typeof n !== "number" || !Number.isInteger(n) || n < RESIST_CAP_LIMITS.min || n > RESIST_CAP_LIMITS.max) return `${path}.${k} must be a whole number from ${RESIST_CAP_LIMITS.min} to ${RESIST_CAP_LIMITS.max}`;
  }
  return null;
}

// Faster Casting's cap follows the casting school (issue #213): the shard's `fc` cap (2) for Magery, Necromancy and
// Mysticism, 4 for Chivalry, Spellweaving and Bushido, and a Chivalry caster drops to the shard's cap once Magery or
// Mysticism reaches 70. A profile may name its school (`castingSchool`); else it follows the character's skills: 4 when
// it has Chivalry, Spellweaving or Bushido at 30 base or more (starting points and stray gains stay under it, any build
// that casts from the school trains past it), unless that school is Chivalry and Magery or Mysticism is at 70 (ServUO
// Spell.GetCastDelay drops only Chivalry's cap), else the shard's cap. No character and no school: the shard's cap. `reason` is what the panel shows beside the cap ("Chivalry", "Chivalry (chosen)" for a named school, "Magery 70+").
export const CASTING_SCHOOLS: readonly string[] = ["Magery", "Necromancy", "Mysticism", "Chivalry", "Spellweaving", "Bushido"];
// A build's rarity preference (issue #262): among equally good suits, use the highest- or lowest-rarity pieces. Absent means any.
export type RarityPreference = "higher" | "lower";
export const RARITY_PREFERENCES: readonly RarityPreference[] = ["higher", "lower"];
const FC_FAST_SCHOOLS = ["Chivalry", "Spellweaving", "Bushido"], FC_FAST_CAP = 4, FC_SCHOOL_MIN = 30;
const FC_SLOW_SKILLS = ["Magery", "Mysticism"], FC_SLOW_AT = 70;
export interface FcCap { cap: number; reason: string }
export function fcCapFor(skills: Record<string, unknown> | null | undefined, school?: string | null | undefined): FcCap {
  const low = (getRules().caps as Record<string, number>).fc ?? 2;
  const sk = (n: string, f: "base" | "value"): number => Number((skills?.[n] as { base?: unknown; value?: unknown } | undefined)?.[f]) || 0;
  const slow = FC_SLOW_SKILLS.filter((n) => sk(n, "value") >= FC_SLOW_AT).sort((a, b) => sk(b, "value") - sk(a, "value"))[0];
  const named = school && CASTING_SCHOOLS.includes(school) ? school : null;
  if (named) {
    const chosen = `${named} (chosen)`;
    if (!FC_FAST_SCHOOLS.includes(named)) return { cap: low, reason: chosen };
    return named === "Chivalry" && slow ? { cap: low, reason: `${slow} ${FC_SLOW_AT}+` } : { cap: FC_FAST_CAP, reason: chosen };
  }
  if (!skills) return { cap: low, reason: "no character" };
  const fast = FC_FAST_SCHOOLS.filter((n) => sk(n, "base") >= FC_SCHOOL_MIN).sort((a, b) => sk(b, "base") - sk(a, "base"))[0];
  if (!fast) return { cap: low, reason: "no Chivalry, Spellweaving or Bushido" };
  return fast === "Chivalry" && slow ? { cap: low, reason: `${slow} ${FC_SLOW_AT}+` } : { cap: FC_FAST_CAP, reason: fast };
}
// The `fc` entry effectiveProfile puts over the shard's caps: none when the shard caps no Faster Casting.
const fcCaps = (character: Character | null, school: string | undefined): Record<string, number> =>
  (getRules().caps as Record<string, number>).fc == null ? {} : { fc: fcCapFor(character?.skills ?? null, school).cap };

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
  swingSteps?: boolean | undefined;   // score SSI by swing step (app/swing.mts)
  castingSchool?: string | undefined; // the school the Faster Casting cap follows (fcCapFor); absent means from the character's skills
}
export interface EffectiveProfile {
  weights: Record<string, number>;
  caps: Record<string, number>;
  floors: Record<string, number>;
  floorBonus: number;
  hardFloors: string[];
  // The character's own Resisting Spells (resistSkillOf: no item bonus; null with no character or no such skill), and
  // its minimum before any buff, in paperdoll terms (null: none).
  resistSkill: number | null;
  resistMinimum: number | null;
  // What the solvers hold each resist up to, in item terms: the minimum the planned buffs leave (Protection lowers the
  // skill), less each resist's in-cap share. A resist scores max(min, min(total, cap)), and a floor at or under its
  // min is met by any suit. Absent with no minimum.
  mins?: Record<string, number> | undefined;
  // Only the resists whose cap the player overrode, in paperdoll terms; absent when none is, so a profile with no
  // override keeps the exact shape (and so the run key, runs-lib.mts) it had before overrides existed.
  resistCapOverrides?: Record<string, ResistCap> | undefined;
  // The buffs the search planned with (app/buffs.mts plannedProfile), absent with none: which, the numbers they took
  // (so a result can show them, and runs with other buffs key apart), and the caps and floors before them.
  buffs?: PlannedBuffs | undefined;
  // What the build knows of the character's swing (app/build-spec.mts planBuild), absent with no character: stamina before gear (raw DEX and the buffs' shares), the worn suit's stamina, and whether SSI is scored by step.
  // `goalSsi`: a Swing speed goal's SSI cap in item terms (issue #302), absent without one; the step table credits no point more.
  swing?: { stamBase: number; refStamina: number; steps: boolean; goalSsi?: number | undefined } | undefined;
  // The step table both solvers score SSI with (app/swing.mts stepTable), put on by the optimize worker.
  ssiSteps?: Array<{ ssi: number; stam: number; credit: number }> | undefined;
  // The higher minimums a suit's own Resisting Spells bonus brings (resistStepsFor), lowest first, in item terms like
  // `mins`; absent when no bonus can raise it (no minimum on this shard, no such skill, the skill at its cap). The
  // server keeps only the steps the pool's bonus reaches (app/mip.mts withReachableResistSteps), so a pool without
  // such pieces builds and keys as before them.
  resistSteps?: ResistStep[] | undefined;
}
export interface PlannedBuffs {
  on: string[];
  skills: Record<string, number>;
  stats: { str: number; dex: number; int: number } | null;
  who: { race?: string | null | undefined; weaponFlags?: readonly string[] | undefined };
  caps: Record<string, number>;
  floors: Record<string, number>;
  overridesIgnored?: Record<string, number> | undefined;   // resist overrides set aside: the buffs count that resist's loss
  minimum: number | null;   // the Resisting Spells minimum with these buffs (Protection lowers it), what the solvers held each resist at
}
// What the buffs that are on change, in paperdoll terms: the caps once they changed them, and each key's in-cap share.
// `minimum` is the Resisting Spells minimum with the buffs on (Protection lowers the skill), when the plan worked it out,
// and `resistLoss` what they take off the skill (Protection's, 0 with none).
export interface BuffShift { caps: Record<string, number>; shares: Record<string, number>; minimum?: number | null | undefined; resistLoss?: number | undefined }
// The optimizer's profile for one character. Resist floors and caps are written in paperdoll terms (what the
// character sheet shows), which are item totals: Resisting Spells adds nothing to gear, it holds each resist at its
// minimum (`mins`, resistMinimum). A race can raise a resist's cap (rules.raceCaps, e.g. an Elf's Energy cap). The
// player's own resistCaps replace the shard's per resist, and a resist floor counts up to its resist's cap. Every floor
// not marked soft is hard. `shift` is what planned buffs change (app/buffs.mts plannedProfile): their caps replace
// these, and a buff's in-cap share is a base the gear needn't supply, so it comes off the cap, the floor and the
// minimum (a negative share, Divine Fury's DCI −20, adds to them). A cap the shift sets may go below 0, which keeps it
// exact: min(gear, cap − share) + share = min(gear + share, cap) for any gear, a negative total included. A floor
// stops at 0, which the solvers read as no requirement: the buff alone meets it. The shift also carries the stat caps
// (STR, DEX, INT past raw) and the minimum the buffs leave.
export function effectiveProfile(p: Profile = {}, character: Character | null = null, shift: BuffShift | null = null): EffectiveProfile {
  const rules = getRules();
  const skill = resistSkillOf(character?.skills), own = skill == null ? null : minResistAt(skill), min = shift && shift.minimum !== undefined ? shift.minimum : own;
  const caps: Record<string, number> = { ...rules.caps as Record<string, number>, ...fcCaps(character, p.castingSchool), ...(p.caps || {}) };
  const floors: Record<string, number> = { ...(p.floors || {}) };
  const view = resistCapsFor(p.race, p.resistCaps);
  const overrides: Record<string, ResistCap> = {}, mins: Record<string, number> = {};
  const share = (k: string): number => shift?.shares[k] || 0;
  for (const k of RESIST_KEYS) {
    const { cap: own, shard } = view[k]!, cap = shift?.caps[k] ?? own;
    if (own !== shard) overrides[k] = { cap: own, shard };
    caps[k] = cap - share(k);
    if (floors[k] != null) floors[k] = Math.max(0, Math.min(floors[k], cap) - share(k));
    if (min != null) mins[k] = min - share(k);
  }
  for (const k of new Set([...Object.keys(shift?.caps || {}), ...Object.keys(shift?.shares || {})])) {
    if (RESIST_KEYS.includes(k)) continue;
    const cap = shift!.caps[k] ?? caps[k];
    if (cap != null) caps[k] = cap - share(k);
    if (floors[k] != null) floors[k] = Math.max(0, floors[k] - share(k));
  }
  const hardFloors = Object.keys(floors).filter((k) => !(p.softFloors || []).includes(k));
  const steps = skill == null ? [] : resistStepsFor(skill, resistSkillCapOf(character?.skills), shift?.resistLoss ?? 0, share);
  return { weights: { ...(p.weights || {}) }, caps, floors, floorBonus: p.floorBonus ?? 1000, hardFloors, resistSkill: skill, resistMinimum: own,
    ...(min != null ? { mins } : {}), ...(Object.keys(overrides).length ? { resistCapOverrides: overrides } : {}), ...(steps.length ? { resistSteps: steps } : {}) };
}
// The fields of a built profile its resist caps are read from (profileResistCaps).
export interface CapsView {
  caps: Record<string, number>;
  resistCapOverrides?: Record<string, ResistCap> | undefined;
  buffs?: { caps?: Record<string, number> | undefined } | undefined;
}
// A built profile's resist caps in paperdoll terms, before any planned buff, what a result is shown against: the
// override where there is one, else the profile's cap.
export function profileResistCaps(prof: CapsView): Record<string, ResistCap> {
  return Object.fromEntries(RESIST_KEYS.map((k) => {
    const o = prof.resistCapOverrides?.[k];
    if (o) return [k, o];
    const cap = (prof.buffs?.caps ?? prof.caps)[k] ?? 70;
    return [k, { cap, shard: cap }];
  }));
}

// Templates: a full set of builder settings with no character in them (no race, STR limit or skipped containers).
// A character's profile keeps its own working copy plus `template`, the name it was applied from; drift between the
// two is settingsDiff(templateFrom(template), templateFrom(profile)).
export const TEMPLATE_KEYS: string[] = ["floors", "softFloors", "weights", "floorBonus", "lockedSlots", "excludeTags", "excludeSkills", "allowOthersWorn", "allowGargoyle", "medOnly", "excludeWeapons", "ubwsAnyWeapon", "weaponMustHave", "resistCaps", "swingSteps", "castingSchool", "rarity", "goals"];
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
  ubwsAnyWeapon?: boolean | undefined;     // absent means true (weaponAllowed)
  weaponMustHave?: string[] | undefined;   // yes/no properties every weapon must carry (weaponHasFlags)
  resistCaps?: Record<string, number> | undefined;   // the player's per-resist cap overrides, paperdoll terms
  swingSteps?: boolean | undefined;        // score SSI by swing step (app/swing.mts); absent means off
  castingSchool?: string | undefined;      // the school the Faster Casting cap follows (fcCapFor); absent means from the character's skills
  rarity?: RarityPreference | undefined;   // among equally good suits, prefer higher- or lower-rarity pieces; absent means any
  goals?: Goals | undefined;               // the goals the weights come from (issue #292); absent for weights set by hand
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
  ubwsAnyWeapon: boolean;
  weaponMustHave: string[];
  resistCaps: Record<string, number>;
  swingSteps: boolean;
  castingSchool: string;   // "" means from the character's skills
  rarity: RarityPreference | undefined;   // undefined means any (a key either way, so applying a template clears a preference it lacks)
  goals: Goals | undefined;               // undefined means none (a key either way, so applying a template without goals clears them)
}
export function templateFrom(s: TemplateSource = {}): Template {
  return { floors: { ...(s.floors || {}) }, softFloors: [...(s.softFloors || [])], weights: { ...(s.weights || {}) }, floorBonus: s.floorBonus ?? 1000,
    lockedSlots: [...(s.lockedSlots || [])], excludeTags: [...(s.excludeTags || [])], excludeSkills: [...(s.excludeSkills || [])],
    allowOthersWorn: !!s.allowOthersWorn, allowGargoyle: !!s.allowGargoyle, medOnly: !!s.medOnly, excludeWeapons: [...(s.excludeWeapons || [])], ubwsAnyWeapon: s.ubwsAnyWeapon !== false, weaponMustHave: [...(s.weaponMustHave || [])], resistCaps: { ...(s.resistCaps || {}) }, swingSteps: !!s.swingSteps,
    castingSchool: s.castingSchool || "", rarity: s.rarity || undefined, goals: s.goals ? copyGoals(s.goals) : undefined };
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
// The profiles.json shape this module reads/writes across its schemaVersion 1 → 2 migration (app/build-spec.mts's
// migrateProfilesV3 takes it on to 3) — deliberately loose (as the v2 schema was: additionalProperties is true
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
  onlyRoots?: number[] | undefined;
  race?: string | undefined;
  excludeSkills?: string[] | undefined;
  allowGargoyle?: boolean | undefined;
  medOnly?: boolean | undefined;
  allowOthersWorn?: boolean | undefined;
  exact?: boolean | undefined;
  excludeWeapons?: string[] | undefined;
  ubwsAnyWeapon?: boolean | undefined;
  weaponMustHave?: string[] | undefined;
  strLimit?: number | undefined;
  restarts?: number | undefined;
  budgetMs?: number | undefined;
  altCount?: number | undefined;
  altTol?: number | undefined;
  resistCaps?: Record<string, number> | undefined;
  buffs?: RunBuffs | undefined;   // the buffs planned with (app/buffs.mts); absent with none, and in a run saved before them
  swingSteps?: boolean | undefined;
  castingSchool?: string | undefined;
  rarity?: RarityPreference | undefined;
  goals?: Goals | undefined;   // the goals its weights came from (issue #292); absent for a run built from weights set by hand
  goalSwing?: GoalSwingWeapon | undefined;   // the weapon and stamina a Swing speed goal was set for (issue #302); absent in a run saved before it
}
// What a Swing speed goal was set for: the weapon worn when it was built (its name and base speed in seconds), the stamina
// it was worked out at (with the worn suit), and the stamina before gear (raw DEX and the buffs' shares), which the suit's own swing reads.
export interface GoalSwingWeapon { weapon: string; speed: number; stamina: number; stamBase: number }
// A run's buffs: which were on, and the numbers they scale with (app/buffs.mts's inputs, Resisting Spells aside).
export interface RunBuffs { on: string[]; skills: Record<string, number> }
// What changed between two sets of builder settings (b relative to a), one entry per change: its short readable line
// (`text`, what settingsDiff returns), the group it belongs to, and for a requirement, weight or resist cap its property
// (`key`), name and both values ("none" when absent), so a table can show them side by side (issue #336).
export type SettingsGroup = "requirements" | "weights" | "pool" | "buffs" | "character" | "search";
export interface SettingsChange { group: SettingsGroup; text: string; key?: string; label?: string; from?: string; to?: string; added?: boolean; soft?: boolean }
export function settingsChanges(a: RunSettings = {}, b: RunSettings = {}): SettingsChange[] {
  const out: SettingsChange[] = [];
  const add = (group: SettingsGroup, text: string, more: Omit<SettingsChange, "group" | "text"> = {}): void => { out.push({ group, text, ...more }); };
  const L = labelOf;
  // with goals setting the weights on both sides (issue #292), changed goals are one line, and the weights and swing-step
  // switch they set are not compared
  const fromGoals = goalsActive(a.goals) && goalsActive(b.goals);
  if (fromGoals && goalsText(a.goals!) !== goalsText(b.goals!)) add("weights", `goals: ${goalsText(b.goals!)}`, { label: "Goals", from: goalsText(a.goals!), to: goalsText(b.goals!) });
  for (const [group, noun] of [["floors", "floor"], ["weights", "weight"]] as const) {
    if (group === "weights" && fromGoals) continue;
    const A: Record<string, number> = a[group] || {}, B: Record<string, number> = b[group] || {};
    // a weight reads as its importance (importanceText), a floor as it is
    const v = (k: string, x: number): string | number => (group === "weights" ? importanceText(k, x) : x);
    for (const k of [...new Set([...Object.keys(A), ...Object.keys(B)])].sort()) {
      if (group === "weights" && k in A && k in B && v(k, A[k]!) === v(k, B[k]!)) continue;   // a change too small to show is not named as "X → X"
      const g = group === "floors" ? "requirements" : "weights", soft = group === "floors" && k in B && (b.softFloors || []).includes(k);
      const row = { key: k, label: L(k), from: k in A ? String(v(k, A[k]!)) : "none", to: k in B ? String(v(k, B[k]!)) : "none", ...(soft ? { soft } : {}) };
      if (!(k in A)) add(g, `${L(k)} ${noun} ${v(k, B[k]!)} added`, { ...row, added: true });
      else if (!(k in B)) add(g, `${L(k)} ${noun} ${v(k, A[k]!)} removed`, row);
      else if (A[k] !== B[k]) add(g, `${L(k)} ${noun} ${v(k, A[k]!)} → ${v(k, B[k]!)}`, row);
    }
  }
  // A resist cap override: set, changed, or taken off (back to the shard's cap for the character's race).
  const RA: Record<string, number> = a.resistCaps || {}, RB: Record<string, number> = b.resistCaps || {};
  for (const k of RESIST_KEYS.filter((x) => x in RA || x in RB)) {
    const row = { key: k, label: `${L(k)} cap`, from: k in RA ? String(RA[k]) : "shard's", to: k in RB ? String(RB[k]) : "shard's" };
    if (!(k in RA)) add("character", `${L(k)} cap set to ${RB[k]}`, row);
    else if (!(k in RB)) add("character", `${L(k)} cap back to the shard's`, row);
    else if (RA[k] !== RB[k]) add("character", `${L(k)} cap ${RA[k]} → ${RB[k]}`, row);
  }
  const setDiff = <T,>(x: T[] = [], y: T[] = []): [T[], T[]] => [y.filter((v) => !x.includes(v)), x.filter((v) => !y.includes(v))];
  const [softOn, softOff] = setDiff(a.softFloors, b.softFloors);
  for (const k of softOn) if ((b.floors || {})[k] != null) add("requirements", `${L(k)} floor made soft`, { key: k, label: L(k), from: "hard", to: "soft", soft: true });
  for (const k of softOff) if ((b.floors || {})[k] != null) add("requirements", `${L(k)} floor made hard`, { key: k, label: L(k), from: "soft", to: "hard" });
  const [lockOn, lockOff] = setDiff(a.lockedSlots, b.lockedSlots);
  if (lockOn.length) add("pool", `locked ${lockOn.map((x) => SLOT_LABELS[x] || x).join(", ")}`);
  if (lockOff.length) add("pool", `unlocked ${lockOff.map((x) => SLOT_LABELS[x] || x).join(", ")}`);
  const [tagOn, tagOff] = setDiff(a.excludeTags, b.excludeTags);
  if (tagOn.length) add("pool", `excluding ${tagOn.join(", ")}`);
  if (tagOff.length) add("pool", `allowing ${tagOff.join(", ")}`);
  const [rootOn, rootOff] = setDiff(a.excludeRoots, b.excludeRoots);
  if (rootOn.length || rootOff.length) add("pool", "skipped containers changed");
  const [onlyOn, onlyOff] = setDiff(a.onlyRoots, b.onlyRoots);
  if (onlyOn.length || onlyOff.length) add("pool", b.onlyRoots?.length ? (a.onlyRoots?.length ? "only containers changed" : `only ${b.onlyRoots.length} container${b.onlyRoots.length === 1 ? "" : "s"}`) : "any container");
  if ((a.race || "human") !== (b.race || "human")) add("character", `race ${a.race || "human"} → ${b.race || "human"}`);
  const [skOn, skOff] = setDiff(a.excludeSkills, b.excludeSkills);
  if (skOn.length) add("pool", `forbidding ${skOn.join(", ")} bonuses`);
  if (skOff.length) add("pool", `allowing ${skOff.join(", ")} bonuses`);
  const flag = (k: "allowGargoyle" | "medOnly" | "exact" | "swingSteps", on: string, off: string, g: SettingsGroup = "pool") => { if (!!a[k] !== !!b[k]) add(g, b[k] ? on : off); };
  flag("allowGargoyle", "gargoyle gear allowed", "gargoyle gear excluded");
  flag("medOnly", "meditation-safe only", "meditation-safe off");
  const others = (s: RunSettings) => !!s.allowOthersWorn;   // a saved run is normalized to allowOthersWorn before it ever reaches here
  if (others(a) !== others(b)) add("pool", others(b) ? "others' worn gear allowed" : "others' worn gear excluded");
  flag("exact", "exact search on", "exact search off", "search");
  if (!fromGoals) flag("swingSteps", "+SSI by step", "SSI by point", "weights");
  if ((a.castingSchool || "") !== (b.castingSchool || "")) add("character", b.castingSchool ? `casting school ${b.castingSchool}` : "casting school from skills");
  if ((a.rarity || "") !== (b.rarity || "")) add("pool", b.rarity ? `prefer ${b.rarity} rarity` : "any rarity");
  const [wOn, wOff] = setDiff(a.excludeWeapons, b.excludeWeapons);
  const weaponWords = (ws: string[]): string => [ws.some((w) => w !== SPELLBOOKS) ? `${ws.filter((w) => w !== SPELLBOOKS).join(", ")} weapons` : "", ws.includes(SPELLBOOKS) ? "spellbooks" : ""].filter(Boolean).join(" and ");
  if (wOn.length) add("pool", `excluding ${weaponWords(wOn)}`);
  if (wOff.length) add("pool", `allowing ${weaponWords(wOff)}`);
  const ubws = (s: RunSettings) => s.ubwsAnyWeapon !== false;   // absent means on
  if (ubws(a) !== ubws(b)) add("pool", ubws(b) ? "Use Best Weapon Skill weapons allowed" : "Use Best Weapon Skill weapons held to their own skill");
  const [fOn, fOff] = setDiff(a.weaponMustHave, b.weaponMustHave);
  if (fOn.length) add("pool", `weapon must have ${fOn.join(", ")}`);
  if (fOff.length) add("pool", `weapon need not have ${fOff.join(", ")}`);
  if (a.strLimit !== b.strLimit && b.strLimit != null) add("character", `STR limit ${a.strLimit ?? "?"} → ${b.strLimit}`);
  if (a.restarts !== b.restarts && b.restarts != null) add("search", `restarts ${a.restarts ?? "?"} → ${b.restarts}`);
  if (a.budgetMs !== b.budgetMs && b.budgetMs != null && b.exact) add("search", `budget ${(a.budgetMs ?? 0) / 1000} s → ${b.budgetMs / 1000} s`);
  if (a.altCount !== b.altCount && b.altCount != null) add("search", `other suits ${a.altCount ?? 0} → ${b.altCount}`);
  if (a.altTol !== b.altTol && b.altTol != null) add("search", `other suits within ${a.altTol ?? 0} → ${b.altTol} points`);
  return out;
}
// The same, as short readable lines.
export const settingsDiff = (a: RunSettings = {}, b: RunSettings = {}): string[] => settingsChanges(a, b).map((c) => c.text);
// The What changed popover's rows (issue #336): each unsaved edit (saved → now) once, with the template's value beside it
// when there is a template (from its own change of that setting, else the value now, which the edit brought back to the
// template's); then the template's changes no unsaved edit covers. `count` is the rows listed, so the header and the
// sections agree. A setting is one requirement, weight or cap (a floor's soft/hard switch apart from its value), or a line.
export interface UnsavedChange extends SettingsChange { template?: string }
export function changesList(changed: SettingsChange[] | null, unsaved: SettingsChange[]): { unsaved: UnsavedChange[]; others: SettingsChange[]; count: number } {
  const id = (c: SettingsChange): string => (c.key ? `${c.group}|${c.key}|${c.from === "hard" || c.from === "soft" ? "soft" : "value"}` : `${c.group}|${c.text}`);
  const tpl = new Map((changed ?? []).map((c) => [id(c), c]));
  const rows: UnsavedChange[] = unsaved.map((c) => {
    const value = tpl.get(id(c))?.from ?? c.to;
    return changed && c.from != null && value != null ? { ...c, template: value } : c;
  });
  const mine = new Set(unsaved.map(id)), others = (changed ?? []).filter((c) => !mine.has(id(c)));
  return { unsaved: rows, others, count: rows.length + others.length };
}
