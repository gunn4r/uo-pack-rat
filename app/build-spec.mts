// build-spec.mts — a build's intent as one document (issue #218, BuildSpec): what "good" means (intent), the buffs it
// plans with (buffs), which pieces it may use (pool), and optionally the goal and the search knobs. profiles.json holds
// one per character and per template (schemaVersion 3), and the page, POST /api/optimize and the MCP tools all turn one
// into a build through planBuild. Also the one check a spec is held to, its defaults, the v2 → v3 migration of
// profiles.json (Automatic's buffs and their numbers move in from ui-prefs.json), and the flat working profile the
// Suit Builder's panel edits. Pure and browser-safe, like run-settings.mts and evaluate.mts.
import { buffPlanOf, buffSkillValues, isBuffList, isBuffSkills, isBuffSkillsByCharacter, manualBase, manualPlan, normalizeBuffListsByCharacter, NO_CHARACTER, planBuffs, runBuffs, type BuffPlan } from "./buffs.mts";
import { RACES, RUN_DEFAULTS, RUN_SETTING_LIMITS, defaultStrLimit, isGoalSwing, runSettingsError } from "./run-settings.mts";
import { compileGoals, copyGoals, goalsActive, migrateProfiles, templateFrom, TEMPLATE_KEYS, toOptItem, totalsOf, type Character, type EffectiveProfile, type Goals, type GoalSwingWeapon, type Item, type Profile, type ProfilesFile, type RarityPreference, type RunBuffs, type RunSettings, type Template, type TemplateSource } from "./vault-lib.mts";
import { heldWeapon, ssiForTicks } from "./swing.mts";

// ---------------------------------------------------------------- the document
// swingSteps: score SSI by swing step (app/swing.mts) rather than per point; absent means off, and a spec carries it only when on.
// castingSchool: the school the Faster Casting cap follows (vault-lib.mts fcCapFor); absent means from the character's skills.
// rarity: among equally good suits, prefer higher- or lower-rarity pieces (issue #262); absent means any. It breaks exact ties only (the solvers' tolerance 0).
// goals: the ranked goals `weights` were compiled from (issue #292, vault-lib.mts compileGoals); absent for weights set by hand. `weights` is always what the solvers score with.
export interface BuildIntent { floors: Record<string, number>; softFloors: string[]; weights: Record<string, number>; floorBonus: number; resistCaps: Record<string, number>; swingSteps?: boolean | undefined; castingSchool?: string | undefined; rarity?: RarityPreference | undefined; goals?: Goals | undefined }
// The buffs counted as always on, and the numbers edited for them (app/buffs.mts's inputs; the rest are the character's own).
export interface BuildBuffs { on: string[]; skills: Record<string, number> }
// "character": the character's STR, else 125 (run-settings.mts defaultStrLimit).
export type StrLimit = number | "character";
export interface BuildPool {
  lockedSlots: string[]; excludeTags: string[]; excludeSkills: string[]; excludeRoots: Array<number | string>; excludeWeapons: string[];
  ubwsAnyWeapon: boolean; allowOthersWorn: boolean; allowGargoyle: boolean; medOnly: boolean; strLimit: StrLimit;
  weaponMustHave?: string[] | undefined;   // yes/no properties every weapon must carry (vault-lib.mts weaponHasFlags); a spec carries it only when non-empty
  onlyRoots?: number[] | undefined;        // the root containers the pool is narrowed to (vault-lib.mts buildPools, issue #12); a spec carries it only when non-empty
}
// What to search for. Nothing reads it yet: #12's goal and suit count build on it.
export interface BuildGoal { kind: "best" | "cheapest"; suits?: number | undefined }
// The search knobs; absent ones take run-settings.mts's RUN_DEFAULTS.
export interface BuildSearch { budgetMs?: number | undefined; exact?: boolean | undefined; restarts?: number | undefined; altCount?: number | undefined; altTol?: number | undefined }
export interface BuildSpec { intent: BuildIntent; buffs: BuildBuffs; pool: BuildPool; goal?: BuildGoal | undefined; search?: BuildSearch | undefined }
// A template's spec: its buffs are optional, and applying a template without them leaves the character's buffs alone.
export type TemplateSpec = Omit<BuildSpec, "buffs"> & { buffs?: BuildBuffs | undefined };

// profiles.json v3: a character is its race, the template it came from and its spec; a template is its spec and a
// display name (the id when absent). Any other field round-trips untouched.
export interface CharacterEntry { race?: string | null | undefined; template?: string | undefined; spec: BuildSpec; [key: string]: unknown }
// A built-in's description and source pages show under the template picker; Save as copies neither.
export interface TemplateEntry { name?: string | undefined; description?: string | undefined; sources?: string[] | undefined; savedAt?: string | undefined; spec: TemplateSpec; [key: string]: unknown }
export interface ProfilesV3 { schemaVersion: 3; characters: Record<string, CharacterEntry>; templates: Record<string, TemplateEntry>; [key: string]: unknown }
export const PROFILES_VERSION = 3;

const INTENT_KEYS = ["floors", "softFloors", "weights", "floorBonus", "resistCaps", "swingSteps", "castingSchool", "rarity", "goals"] as const;
const POOL_KEYS = ["lockedSlots", "excludeTags", "excludeSkills", "excludeRoots", "excludeWeapons", "ubwsAnyWeapon", "allowOthersWorn", "allowGargoyle", "medOnly", "strLimit", "weaponMustHave", "onlyRoots"] as const;
const SEARCH_KEYS = ["budgetMs", "exact", "restarts", "altCount", "altTol"] as const;
const GOAL_KINDS = ["best", "cheapest"];
// What an absent field means. The search knobs' defaults are run-settings.mts's RUN_DEFAULTS.
export const SPEC_DEFAULTS = { floorBonus: 1000, ubwsAnyWeapon: true, strLimit: "character" as StrLimit } as const;
const GOAL_SUITS = { min: 1, max: 100 } as const;

// A spec with every field filled in, from a stored one (any field may be missing).
type Partialish<T> = { [K in keyof T]?: T[K] | null | undefined };
export interface BuildSpecSource { intent?: Partialish<BuildIntent> | null | undefined; buffs?: Partialish<BuildBuffs> | null | undefined; pool?: Partialish<BuildPool> | null | undefined; goal?: BuildGoal | null | undefined; search?: BuildSearch | null | undefined }
// Total, so a hand-edited file still loads: a list field that is no array reads as empty, a map that is no object as {}.
const list = <T,>(x: readonly T[] | null | undefined): T[] => (Array.isArray(x) ? [...x] : []);
const map = <T,>(x: Record<string, T> | null | undefined): Record<string, T> => (x && typeof x === "object" && !Array.isArray(x) ? { ...x } : {});
export function buildSpec(s: BuildSpecSource = {}): BuildSpec {
  const i = s.intent || {}, p = s.pool || {}, b = s.buffs || {}, mustHave = list(p.weaponMustHave), only = list(p.onlyRoots);
  return {
    intent: { floors: map(i.floors), softFloors: list(i.softFloors), weights: map(i.weights), floorBonus: i.floorBonus ?? SPEC_DEFAULTS.floorBonus, resistCaps: map(i.resistCaps), ...(i.swingSteps ? { swingSteps: true } : {}), ...(i.castingSchool ? { castingSchool: i.castingSchool } : {}), ...(i.rarity ? { rarity: i.rarity } : {}), ...(i.goals ? { goals: copyGoals(i.goals) } : {}) },
    buffs: { on: list(b.on), skills: map(b.skills) },
    pool: { lockedSlots: list(p.lockedSlots), excludeTags: list(p.excludeTags), excludeSkills: list(p.excludeSkills), excludeRoots: list(p.excludeRoots),
      excludeWeapons: list(p.excludeWeapons), ubwsAnyWeapon: p.ubwsAnyWeapon ?? SPEC_DEFAULTS.ubwsAnyWeapon, allowOthersWorn: !!p.allowOthersWorn, allowGargoyle: !!p.allowGargoyle, medOnly: !!p.medOnly,
      strLimit: p.strLimit ?? SPEC_DEFAULTS.strLimit, ...(mustHave.length ? { weaponMustHave: mustHave } : {}), ...(only.length ? { onlyRoots: only } : {}) },
    ...(s.goal ? { goal: { ...s.goal } } : {}),
    ...(s.search ? { search: { ...s.search } } : {}),
  };
}

// The one check a spec is held to (PUT /api/profiles, the built-in templates): only the known groups and fields, each
// held to the rule a run's settings are (run-settings.mts). `template`: a template's spec, whose buffs are optional.
// `label` names the spec in the reason; null when fine.
export function buildSpecError(v: unknown, label: string, { template = false }: { template?: boolean } = {}): string | null {
  const obj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
  if (!obj(v)) return `${label} must be an object`;
  for (const k of Object.keys(v)) if (!["intent", "buffs", "pool", "goal", "search"].includes(k)) return `${label}.${k} is not part of a build`;
  const only = (group: string, keys: readonly string[]): string | null => {
    const g = v[group];
    if (!obj(g)) return `${label}.${group} must be an object`;
    const extra = Object.keys(g).find((k) => !keys.includes(k));
    return extra ? `${label}.${group}.${extra} is not a ${group} setting` : null;
  };
  const intent = only("intent", INTENT_KEYS);
  if (intent) return intent;
  const { floorBonus, ...rest } = v.intent as Record<string, unknown>;
  // a soft floor's bonus rewards reaching it, so it is never negative (issue #315: the exact solver had no model for one)
  if (floorBonus != null && (typeof floorBonus !== "number" || !Number.isFinite(floorBonus) || floorBonus < 0 || floorBonus > 1e6)) return `${label}.intent.floorBonus must be a number from 0 to 1000000`;
  const intentRules = runSettingsError(rest, `${label}.intent`);
  if (intentRules) return intentRules;
  const pool = only("pool", POOL_KEYS);
  if (pool) return pool;
  const { strLimit, ...poolRest } = v.pool as Record<string, unknown>;
  if (strLimit !== "character" && runSettingsError({ strLimit }, "")) {
    const { min, max } = RUN_SETTING_LIMITS.strLimit;
    return `${label}.pool.strLimit must be "character" or a whole number from ${min} to ${max}`;
  }
  const poolRules = runSettingsError(poolRest, `${label}.pool`);
  if (poolRules) return poolRules;
  if (v.buffs != null || !template) {
    const b = v.buffs as Record<string, unknown> | undefined;
    if (!obj(b) || !isBuffList(b.on) || !isBuffSkills(b.skills)) return `${label}.buffs must list known buffs, each once and one form at most, with their numbers in range`;
  }
  if (v.goal != null) {
    const g = v.goal as Record<string, unknown>;
    if (!obj(g) || !GOAL_KINDS.includes(g.kind as string)) return `${label}.goal.kind must be ${GOAL_KINDS.join(" or ")}`;
    const { min, max } = GOAL_SUITS;
    if (g.suits != null && (typeof g.suits !== "number" || !Number.isInteger(g.suits) || g.suits < min || g.suits > max)) return `${label}.goal.suits must be a whole number from ${min} to ${max}`;
  }
  if (v.search != null) {
    const s = only("search", SEARCH_KEYS);
    if (s) return s;
    const e = runSettingsError(v.search, `${label}.search`);
    if (e) return e;
  }
  return null;
}
// A template's name: at most this long (a character's `template` naming it is held to the same, healEntry), and never
// "builtin:…", which names the shard's own.
export const TEMPLATE_NAME_MAX = 128;
// profiles.json v3's characters and templates, each spec held to buildSpecError (the schema checks the file's shape), and
// each template's name to TEMPLATE_NAME_MAX and the built-in prefix.
export function profilesSpecError(doc: ProfilesV3): string | null {
  for (const id of Object.keys(doc.templates)) if (id.length > TEMPLATE_NAME_MAX || id.startsWith(BUILTIN_PREFIX)) return `templates: a template's name is at most ${TEMPLATE_NAME_MAX} characters and can't start with "${BUILTIN_PREFIX}"`;
  for (const [name, c] of Object.entries(doc.characters)) { const e = buildSpecError(c.spec, `characters.${name}.spec`); if (e) return e; }
  for (const [id, t] of Object.entries(doc.templates)) { const e = buildSpecError(t.spec, `templates.${id}.spec`, { template: true }); if (e) return e; }
  return null;
}

// ---------------------------------------------------------------- the panel's flat profile
// The Suit Builder's panel edits one flat profile (builder settings, the skipped containers, the STR limit, race and
// template), the shape a v2 profiles.json entry had and a saved run's settings still have.
export type FlatProfile = TemplateSource & { excludeRoots?: Array<number | string> | undefined; onlyRoots?: number[] | undefined; strLimit?: number | undefined; race?: string | null | undefined; template?: string | undefined };
export function specFromProfile(p: FlatProfile, buffs: BuildBuffs = { on: [], skills: {} }): BuildSpec {
  return buildSpec({ intent: p, pool: { ...p, strLimit: p.strLimit ?? SPEC_DEFAULTS.strLimit }, buffs });
}
// A spec as the panel's settings: "character" leaves the STR limit out (the panel shows the character's). With goals in
// force the weights and swing-step switch are compiled from them again (issue #292), so a hand-edited file or a newer
// rank table never leaves weights the goals did not set.
export function profileFromSpec(spec: BuildSpecSource): FlatProfile {
  const { intent, pool } = buildSpec(spec), { strLimit, ...rest } = pool;
  const { swingSteps: _steps, ...own } = intent, c = goalsActive(intent.goals) ? compileGoals(intent.goals, intent.weights) : null;
  const goals = c ? { ...own, weights: c.weights, ...(c.swingSteps ? { swingSteps: true } : {}) } : intent;
  return { ...goals, ...rest, ...(strLimit === "character" ? {} : { strLimit }) };
}
// A template's spec from the panel's settings: the template fields only (no skipped containers or STR limit), and the
// buffs on when given (their numbers are the character's, not the build's, so none are kept).
export function templateSpecFrom(p: FlatProfile, buffs?: readonly string[]): TemplateSpec {
  const { buffs: _none, ...spec } = specFromProfile(templateFrom(p));
  return buffs ? { ...spec, buffs: { on: [...buffs], skills: {} } } : spec;
}
// A saved character entry from the panel's settings and the character's buffs.
export function characterEntry(p: FlatProfile, buffs: BuildBuffs): CharacterEntry {
  const { race, template } = p;
  return { ...(race != null ? { race } : {}), ...(template != null ? { template } : {}), spec: specFromProfile(p, buffs) };
}
// A saved run's settings (the snapshot a run keeps) as a spec: its buffs' numbers are the ones the run took.
export function specFromRunSettings(st: RunSettings): BuildSpec {
  const { restarts, exact, budgetMs, altCount, altTol } = st;
  return { ...specFromProfile(st as FlatProfile, st.buffs ? { on: st.buffs.on, skills: st.buffs.skills } : undefined), search: { restarts, exact, budgetMs, altCount, altTol } };
}

// ---------------------------------------------------------------- templates
// A built-in template (app/data/templates/<shard>.json) is named by this prefix and its id wherever a template is
// named (a character's `template`, the page's template list), so it never clashes with the player's own.
export const BUILTIN_PREFIX = "builtin:";
export type TemplateMap = Record<string, TemplateEntry>;
// The template a reference names: one of the player's, or a built-in; undefined when there is none.
export function findTemplate(profiles: Pick<ProfilesV3, "templates">, builtins: TemplateMap, ref: string | null | undefined): TemplateEntry | undefined {
  if (!ref) return undefined;
  const [map, id] = ref.startsWith(BUILTIN_PREFIX) ? [builtins, ref.slice(BUILTIN_PREFIX.length)] : [profiles.templates || {}, ref];
  return Object.hasOwn(map, id) ? map[id] : undefined;
}
// Every template a reference can name: the player's first, then the built-ins.
export const templateRefs = (profiles: Pick<ProfilesV3, "templates">, builtins: TemplateMap): string[] =>
  [...Object.keys(profiles.templates || {}), ...Object.keys(builtins).map((id) => BUILTIN_PREFIX + id)];
// A template's own name: a built-in's name, the player's template's key.
export function templateName(builtins: TemplateMap, ref: string): string {
  if (!ref.startsWith(BUILTIN_PREFIX)) return ref;
  const id = ref.slice(BUILTIN_PREFIX.length);
  return builtins[id]?.name || id;
}
// A template's name as the page shows it.
export const templateLabel = (builtins: TemplateMap, ref: string): string => (ref.startsWith(BUILTIN_PREFIX) ? `${templateName(builtins, ref)} (built-in)` : ref);
// The template fields a template sets, as the panel's settings.
export const templateSettings = (t: TemplateEntry): Template => templateFrom(profileFromSpec(t.spec));

// A character's working profile for the Suit Builder: a copy of its saved settings, or, for a character with none, the
// first template applied (the player's own, else the first built-in) with race human. The page's character picker,
// POST /api/evaluate and the MCP tools all start from it. Its buffs are characterBuffs'.
export function characterProfile(profiles: ProfilesV3, name: string, builtins: TemplateMap = {}): FlatProfile {
  const saved = Object.hasOwn(profiles.characters || {}, name) ? profiles.characters[name] : undefined;
  if (saved) {
    const { race, template } = saved;
    return { ...profileFromSpec(saved.spec), ...(race != null ? { race } : {}), ...(template != null ? { template } : {}) };
  }
  const [first] = templateRefs(profiles, builtins), t = findTemplate(profiles, builtins, first);
  return { ...(t ? templateSettings(t) : templateFrom()), template: first, race: "human" };
}
// A character's saved buffs (none for a character with no saved entry).
export function characterBuffs(profiles: ProfilesV3, name: string): BuildBuffs {
  const saved = Object.hasOwn(profiles.characters || {}, name) ? profiles.characters[name] : undefined;
  return buildSpec({ buffs: saved?.spec?.buffs }).buffs;
}

// ---------------------------------------------------------------- planBuild
export interface PlanContext {
  character: Character | null;   // null: No character, raw item totals
  worn: Item[];                  // what the character wears now (Enhance Potions, Spell Channeling, raw stats)
  race?: string | null | undefined;
  suit?: Record<string, Item> | undefined;   // a hand-picked suit: planned as Manual plans it (buffs.mts manualPlan)
  goalSwing?: GoalSwingWeapon | undefined;   // a reopened run's swing goal weapon and stamina (issue #302), in place of the weapon worn now
}
// A spec's pool with its STR limit worked out for the character: POST /api/optimize's by-character form takes it.
export type PoolSettings = Omit<BuildPool, "strLimit"> & { strLimit: number };
export function poolFromSpec({ pool: sp }: BuildSpec, character: Character | null): PoolSettings {
  const strLimit = sp.strLimit === "character" ? defaultStrLimit(character) : sp.strLimit;
  return { allowOthersWorn: sp.allowOthersWorn, strLimit, excludeTags: sp.excludeTags, excludeRoots: sp.excludeRoots, allowGargoyle: sp.allowGargoyle, medOnly: sp.medOnly,
    excludeWeapons: sp.excludeWeapons, ubwsAnyWeapon: sp.ubwsAnyWeapon, excludeSkills: sp.excludeSkills, lockedSlots: sp.lockedSlots, ...(sp.weaponMustHave ? { weaponMustHave: sp.weaponMustHave } : {}), ...(sp.onlyRoots ? { onlyRoots: sp.onlyRoots } : {}) };
}
export interface PlannedBuild {
  base: Profile;               // the profile before any buff (Manual's for a hand-picked suit): evaluate.mts's `profile`
  plan: BuffPlan;              // what the buffs plan with: evaluate.mts's `buffs`
  profile: EffectiveProfile;   // what the solvers score with (buffs.mts plannedProfile), with the character's `swing`
  buffs: RunBuffs | undefined; // the buffs a run keeps, absent with none on
  pool: PoolSettings;          // the candidate pool settings, as POST /api/optimize's by-character form takes them
  opts: { restarts: number; exact: boolean; timeBudgetMs?: number; alternatives?: { count: number; tolerance: number }; tieBreak?: { rarity?: RarityPreference; tolerance: number; fewestChanges?: boolean }; strict?: { ranks: string[][]; fewestChanges?: boolean } };
  snapshot: RunSettings;       // the settings a saved run keeps (the runs drawer labels, compares and reopens runs from it)
}
// A spec turned into a build for a character: the profile the solvers score with and its buff plan, the pool settings,
// the search options and the saved run's settings snapshot. The shard's rules are the ones vault-lib holds (setRules).
// With a character the profile carries `swing`: stamina before gear (raw DEX and the buffs' in-cap shares on DEX and the Stamina pool), the worn suit's stamina, and whether SSI is scored by step (app/swing.mts); a goal of a swing every N s caps SSI (goalSsiCap).
export function planBuild(spec: BuildSpec, { character, worn, race, suit, goalSwing }: PlanContext): PlannedBuild {
  const flat = profileFromSpec(spec), edits = spec.buffs.skills, on = spec.buffs.on;
  const p: Profile = { ...flat, race: race || "human" };
  const buffs = runBuffs(on, buffSkillValues(character ? character.skills || {} : null, edits).values);
  const base = suit ? manualBase(p, character) : p;
  const plan = suit ? manualPlan(character, worn, suit, character ? p.race! : null, on, edits) : buffPlanOf(character, worn, p.race, buffs, edits);
  const { intent } = spec, s = spec.search || {}, pool = poolFromSpec(spec, character);
  const exact = s.exact ?? RUN_DEFAULTS.exact, budgetMs = s.budgetMs ?? RUN_DEFAULTS.budgetMs, altCount = s.altCount ?? 0, altTol = s.altTol ?? 0;
  // goals in force can ask for strict order (one solve per stage, opts.strict) and the fewest changes: in Best value the
  // tie-break's first part, before a rarity preference; in strict order a stage of its own, after the goals and before
  // tagged pieces and spare points. Both are search options, so the run key follows them
  const g = goalsActive(intent.goals) ? intent.goals : null, fewest = !!g?.fewestChanges, strict = g?.strategy === "strict";
  const opts = { restarts: s.restarts ?? RUN_DEFAULTS.restarts, exact, ...(exact ? { timeBudgetMs: budgetMs } : {}), ...(exact && altCount > 0 ? { alternatives: { count: altCount, tolerance: altTol } } : {}),
    ...(intent.rarity || (fewest && !strict) ? { tieBreak: { ...(intent.rarity ? { rarity: intent.rarity } : {}), tolerance: 0, ...(fewest && !strict ? { fewestChanges: true } : {}) } } : {}),
    ...(strict ? { strict: { ranks: g!.ranks.map((r) => [...r]), ...(fewest ? { fewestChanges: true } : {}) } } : {}) };
  const snapshot: RunSettings = { ...pool, floors: intent.floors, softFloors: intent.softFloors, weights: intent.weights, race: p.race!, resistCaps: intent.resistCaps,
    restarts: s.restarts || RUN_DEFAULTS.restarts, exact, budgetMs: budgetMs || RUN_DEFAULTS.budgetMs, altCount, altTol, ...(buffs ? { buffs } : {}), ...(intent.swingSteps ? { swingSteps: true } : {}), ...(intent.castingSchool ? { castingSchool: intent.castingSchool } : {}), ...(intent.rarity ? { rarity: intent.rarity } : {}), ...(intent.goals ? { goals: intent.goals } : {}) };
  const { prof, r } = planBuffs(base, character, plan);
  if (!plan.stats || !r) return { base, plan, profile: prof, buffs, pool, opts, snapshot };
  const share = (k: string): number => (r.shares[k] || []).filter((x) => !x.outside).reduce((n, x) => n + x.value, 0);
  const stamBase = plan.stats.dex + share("dexBonus") + share("stamPool");
  const wornStam = totalsOf(Object.fromEntries(worn.map((it) => [String(it.serial), toOptItem(it)]))).stamPool || 0;
  // a Swing speed goal is set for the weapon worn now at the worn suit's stamina, which the run keeps with the stamina before
  // gear (one out of the run-settings check's range is not kept and caps nothing); a reopened run plans from the ones it
  // was built with, its suit's swing too. A swing every N s caps SSI at what that delay takes there: SSI past it counts
  // nothing, and the step table reads that cap from `swing.goalSsi` (app/swing.mts stepsFor)
  const refStamina = stamBase + wornStam, held = heldWeapon(Object.fromEntries(worn.filter((it) => it.slot).map((it) => [it.slot!, toOptItem(it)])));
  const ssiGoal = goalsActive(intent.goals) && intent.goals.ranks.some((r) => r.includes("ssi"));
  const now = held ? { weapon: held.name, speed: held.speed!, stamina: refStamina, stamBase } : null;
  const gs = !ssiGoal ? null : goalSwing ?? (isGoalSwing(now) ? now : null);
  const cap = gs ? goalSsiCap(intent.goals, gs.speed, gs.stamina) : null;
  const scored = cap == null ? prof : planBuffs({ ...base, caps: { ...base.caps, ssi: cap } }, character, plan).prof;
  const goalSsi = cap == null ? undefined : scored.caps?.ssi;
  const swing = gs && goalSwing ? { stamBase: gs.stamBase, refStamina: gs.stamina } : { stamBase, refStamina };
  return { base, plan, profile: { ...scored, swing: { ...swing, steps: !!intent.swingSteps, ...(goalSsi != null ? { goalSsi } : {}) } }, buffs, pool, opts, snapshot: gs ? { ...snapshot, goalSwing: { ...gs } } : snapshot };
}
// The SSI a Swing speed goal of a swing every N s stops counting at (issue #292): the least effective SSI that gives that
// delay for a weapon of `speedS` at `stamina`; null for the fastest swing, goals not in force, no Swing speed goal, or a
// delay past the SSI cap.
export function goalSsiCap(goals: Goals | null | undefined, speedS: number, stamina: number): number | null {
  if (!goalsActive(goals) || goals.swing?.mode !== "every" || goals.swing.seconds == null || !goals.ranks.some((r) => r.includes("ssi"))) return null;
  return ssiForTicks(speedS, stamina, Math.round(goals.swing.seconds * 4));
}

// ---------------------------------------------------------------- v2 → v3
// What moves out of ui-prefs.json: Automatic's buffs by character, and the buff numbers edited by character ("" for
// Manual's No character, which stays a view choice as `manualBuffSkills`).
interface LegacyBuffPrefs { autoBuffs?: unknown; buffSkills?: unknown; manualBuffSkills?: unknown }
const MAPS = ["floors", "weights", "resistCaps"];
const FLAGS = ["ubwsAnyWeapon", "allowOthersWorn", "allowGargoyle", "medOnly"];
// A v2 entry's settings with only what the v3 check takes: a v2 file was checked loosely, so a value buildSpecError
// refuses (a hand edit, say) is left out and takes its default, and the file stays one PUT /api/profiles accepts. A map
// (floors, weights, resist caps) and a list lose only their bad keys or items; a flag is read as v2 read it (true unless
// false for ubwsAnyWeapon, else any truthy value); race and template must be one of the races and a short name. Each
// change is a line in `healed`, `where` naming the entry.
function healEntry(e: Record<string, unknown>, where: string, healed: string[]): FlatProfile {
  const blank = buildSpec(), out: Record<string, unknown> = { ...e };
  const bad = (k: string, v: unknown): boolean => {
    const group = (INTENT_KEYS as readonly string[]).includes(k) ? "intent" : "pool";
    return !!buildSpecError({ ...blank, [group]: { ...blank[group], [k]: v } }, "spec");
  };
  const say = (what: string, v: unknown, now: string): void => { healed.push(`${where}: ${what} ${JSON.stringify(v)} ${now}`); };
  for (const k of [...INTENT_KEYS, ...POOL_KEYS]) {
    const v = e[k];
    if (v == null) continue;
    if (FLAGS.includes(k)) {
      const flag = k === "ubwsAnyWeapon" ? v !== false : !!v;
      if (typeof v !== "boolean") { say(k, v, `read as ${flag}`); out[k] = flag; }
    } else if (MAPS.includes(k) && typeof v === "object" && !Array.isArray(v)) {
      out[k] = Object.fromEntries(Object.entries(v).filter(([p, n]) => (bad(k, { [p]: n }) ? (say(`${k}.${p}`, n, "left out"), false) : true)));
    } else if (Array.isArray(v)) {
      const kept = v.filter((x) => (bad(k, [x]) ? (say(`${k} item`, x, "left out"), false) : true));
      if (bad(k, kept)) { say(k, v, "set to its default"); delete out[k]; } else out[k] = kept;
    } else if (bad(k, v)) { say(k, v, "set to its default"); delete out[k]; }
  }
  if (e.race != null && !RACES.includes(e.race as string)) { say("race", e.race, "left out"); delete out.race; }
  if (e.template != null && !(typeof e.template === "string" && e.template.length <= TEMPLATE_NAME_MAX)) { say("template", e.template, "left out"); delete out.template; }
  return out as FlatProfile;
}
export interface MigratedProfiles<P> { profiles: ProfilesV3; prefs: P; changed: boolean; prefsChanged: boolean; healed: string[] }
// profiles.json to v3, once, with ui-prefs.json beside it. A v1 or v2 file goes through vault-lib's migrateProfiles
// first; then each character's settings become its spec, with its Automatic buffs (ui-prefs `autoBuffs`) and its
// edited numbers (`buffSkills`) as the spec's buffs, and each template's settings its spec (healEntry: `healed` says what
// a bad value became). A character with buffs but no saved settings gets the settings the Suit Builder showed it (the
// first template, race human), but only when it holds a buff or an edit and, given `scanned`, is a character the scans
// still have: a forgotten character's leftovers stay in the ui-prefs backup instead of bringing it back. The two keys
// leave ui-prefs; No character's numbers stay there as `manualBuffSkills`. Unknown fields round-trip. A v3 file comes
// back as it is (only leftover legacy keys leave ui-prefs, No character's numbers kept when it has none), and so does a
// newer one: this build does not know its shape. Pure and idempotent: migrating the result again changes nothing.
export function migrateProfilesV3<P extends LegacyBuffPrefs>(file: ProfilesFile | ProfilesV3 = {}, prefs: P = {} as P, { scanned }: { scanned?: ((name: string) => boolean) | undefined } = {}): MigratedProfiles<P> {
  const { autoBuffs: rawOn, buffSkills: rawSkills, ...keep } = prefs;
  const legacy = "autoBuffs" in prefs || "buffSkills" in prefs;
  const skills = isBuffSkillsByCharacter(rawSkills) ? rawSkills : {};
  const noCharacter = Object.hasOwn(skills, NO_CHARACTER) && Object.keys(skills[NO_CHARACTER]!).length && keep.manualBuffSkills == null ? { manualBuffSkills: { ...skills[NO_CHARACTER] } } : {};
  if ((file.schemaVersion ?? 0) >= PROFILES_VERSION) return { profiles: file as ProfilesV3, prefs: (legacy ? { ...keep, ...noCharacter } : prefs) as P, changed: false, prefsChanged: legacy, healed: [] };
  const v2 = migrateProfiles(file as ProfilesFile).profiles, healed: string[] = [];
  const on = normalizeBuffListsByCharacter(rawOn) ?? {};
  const buffsOf = (name: string): BuildBuffs => ({ on: Object.hasOwn(on, name) ? on[name]! : [], skills: Object.hasOwn(skills, name) ? { ...skills[name] } : {} });
  const SETTINGS = new Set([...TEMPLATE_KEYS, "excludeRoots", "strLimit", "race", "template", "caps"]);
  const others = (e: object): Record<string, unknown> => Object.fromEntries(Object.entries(e).filter(([k]) => !SETTINGS.has(k)));
  const isEntry = (e: unknown): e is Record<string, unknown> => !!e && typeof e === "object" && !Array.isArray(e);
  const templates: Record<string, TemplateEntry> = {};
  for (const [id, t] of Object.entries(v2.templates || {})) if (isEntry(t)) templates[id] = { ...others(t), spec: templateSpecFrom(healEntry(t, `templates.${id}`, healed)) };
  const characters: Record<string, CharacterEntry> = {};
  for (const [name, c] of Object.entries(v2.characters || {})) if (isEntry(c)) characters[name] = { ...others(c), ...characterEntry(healEntry(c, `characters.${name}`, healed), buffsOf(name)) };
  const [first] = Object.keys(templates);
  for (const name of new Set([...Object.keys(on), ...Object.keys(skills)])) {
    const b = buffsOf(name);
    if (name === NO_CHARACTER || Object.hasOwn(characters, name) || (!b.on.length && !Object.keys(b.skills).length)) continue;
    if (scanned && !scanned(name)) { healed.push(`characters.${name}: not scanned, so its buffs were not moved (they stay in the ui-prefs backup)`); continue; }
    characters[name] = characterEntry({ ...(first ? templateSettings(templates[first]!) : templateFrom()), template: first, race: "human" }, b);
  }
  const { templates: _t, characters: _c, schemaVersion: _v, ...top } = v2;
  return { profiles: { ...top, schemaVersion: PROFILES_VERSION, characters, templates }, prefs: { ...keep, ...noCharacter } as P, changed: true, prefsChanged: legacy, healed };
}
