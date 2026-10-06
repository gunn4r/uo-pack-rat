// build-spec.mts — a build's intent as one document (issue #218, BuildSpec): what "good" means (intent), the buffs it
// plans with (buffs), which pieces it may use (pool), and optionally the goal and the search knobs. profiles.json holds
// one per character and per template (schemaVersion 3), and the page, POST /api/optimize and the MCP tools all turn one
// into a build through planBuild. Also the one check a spec is held to, its defaults, the v2 → v3 migration of
// profiles.json (Automatic's buffs and their numbers move in from ui-prefs.json), and the flat working profile the
// Suit Builder's panel edits. Pure and browser-safe, like run-settings.mts and evaluate.mts.
import { buffPlanOf, buffSkillValues, isBuffList, isBuffSkills, isBuffSkillsByCharacter, manualBase, manualPlan, normalizeBuffListsByCharacter, NO_CHARACTER, plannedProfile, runBuffs, type BuffPlan } from "./buffs.mts";
import { RACES, RUN_DEFAULTS, RUN_SETTING_LIMITS, defaultStrLimit, runSettingsError } from "./run-settings.mts";
import { migrateProfiles, templateFrom, TEMPLATE_KEYS, type Character, type EffectiveProfile, type Item, type Profile, type ProfilesFile, type RunBuffs, type RunSettings, type Template, type TemplateSource } from "./vault-lib.mts";

// ---------------------------------------------------------------- the document
export interface BuildIntent { floors: Record<string, number>; softFloors: string[]; weights: Record<string, number>; floorBonus: number; resistCaps: Record<string, number> }
// The buffs counted as always on, and the numbers edited for them (app/buffs.mts's inputs; the rest are the character's own).
export interface BuildBuffs { on: string[]; skills: Record<string, number> }
// "character": the character's STR, else 125 (run-settings.mts defaultStrLimit).
export type StrLimit = number | "character";
export interface BuildPool {
  lockedSlots: string[]; excludeTags: string[]; excludeSkills: string[]; excludeRoots: Array<number | string>; excludeWeapons: string[];
  ubwsAnyWeapon: boolean; allowOthersWorn: boolean; allowGargoyle: boolean; medOnly: boolean; strLimit: StrLimit;
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
export interface TemplateEntry { name?: string | undefined; spec: TemplateSpec; [key: string]: unknown }
export interface ProfilesV3 { schemaVersion: 3; characters: Record<string, CharacterEntry>; templates: Record<string, TemplateEntry>; [key: string]: unknown }
export const PROFILES_VERSION = 3;

const INTENT_KEYS = ["floors", "softFloors", "weights", "floorBonus", "resistCaps"] as const;
const POOL_KEYS = ["lockedSlots", "excludeTags", "excludeSkills", "excludeRoots", "excludeWeapons", "ubwsAnyWeapon", "allowOthersWorn", "allowGargoyle", "medOnly", "strLimit"] as const;
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
  const i = s.intent || {}, p = s.pool || {}, b = s.buffs || {};
  return {
    intent: { floors: map(i.floors), softFloors: list(i.softFloors), weights: map(i.weights), floorBonus: i.floorBonus ?? SPEC_DEFAULTS.floorBonus, resistCaps: map(i.resistCaps) },
    buffs: { on: list(b.on), skills: map(b.skills) },
    pool: { lockedSlots: list(p.lockedSlots), excludeTags: list(p.excludeTags), excludeSkills: list(p.excludeSkills), excludeRoots: list(p.excludeRoots),
      excludeWeapons: list(p.excludeWeapons), ubwsAnyWeapon: p.ubwsAnyWeapon ?? SPEC_DEFAULTS.ubwsAnyWeapon, allowOthersWorn: !!p.allowOthersWorn, allowGargoyle: !!p.allowGargoyle, medOnly: !!p.medOnly,
      strLimit: p.strLimit ?? SPEC_DEFAULTS.strLimit },
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
  if (floorBonus != null && (typeof floorBonus !== "number" || !Number.isFinite(floorBonus) || Math.abs(floorBonus) > 1e6)) return `${label}.intent.floorBonus must be a number between -1000000 and 1000000`;
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
// profiles.json v3's characters and templates, each spec held to buildSpecError (the schema checks the file's shape).
export function profilesSpecError(doc: ProfilesV3): string | null {
  for (const [name, c] of Object.entries(doc.characters)) { const e = buildSpecError(c.spec, `characters.${name}.spec`); if (e) return e; }
  for (const [id, t] of Object.entries(doc.templates)) { const e = buildSpecError(t.spec, `templates.${id}.spec`, { template: true }); if (e) return e; }
  return null;
}

// ---------------------------------------------------------------- the panel's flat profile
// The Suit Builder's panel edits one flat profile (builder settings, the skipped containers, the STR limit, race and
// template), the shape a v2 profiles.json entry had and a saved run's settings still have.
export type FlatProfile = TemplateSource & { excludeRoots?: Array<number | string> | undefined; strLimit?: number | undefined; race?: string | null | undefined; template?: string | undefined };
export function specFromProfile(p: FlatProfile, buffs: BuildBuffs = { on: [], skills: {} }): BuildSpec {
  return buildSpec({ intent: p, pool: { ...p, strLimit: p.strLimit ?? SPEC_DEFAULTS.strLimit }, buffs });
}
// A spec as the panel's settings: "character" leaves the STR limit out (the panel shows the character's).
export function profileFromSpec(spec: BuildSpecSource): FlatProfile {
  const { intent, pool } = buildSpec(spec), { strLimit, ...rest } = pool;
  return { ...intent, ...rest, ...(strLimit === "character" ? {} : { strLimit }) };
}
// A template's spec from the panel's settings: the template fields only (no skipped containers or STR limit).
export const templateSpecFrom = (p: FlatProfile): TemplateSpec => { const { buffs: _none, ...spec } = specFromProfile(templateFrom(p)); return spec; };
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
// A template's name as the page shows it.
export function templateLabel(builtins: TemplateMap, ref: string): string {
  if (!ref.startsWith(BUILTIN_PREFIX)) return ref;
  const id = ref.slice(BUILTIN_PREFIX.length);
  return `${builtins[id]?.name || id} (built-in)`;
}
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
}
// A spec's pool with its STR limit worked out for the character: POST /api/optimize's by-character form takes it.
export type PoolSettings = Omit<BuildPool, "strLimit"> & { strLimit: number };
export function poolFromSpec({ pool: sp }: BuildSpec, character: Character | null): PoolSettings {
  const strLimit = sp.strLimit === "character" ? defaultStrLimit(character) : sp.strLimit;
  return { allowOthersWorn: sp.allowOthersWorn, strLimit, excludeTags: sp.excludeTags, excludeRoots: sp.excludeRoots, allowGargoyle: sp.allowGargoyle, medOnly: sp.medOnly,
    excludeWeapons: sp.excludeWeapons, ubwsAnyWeapon: sp.ubwsAnyWeapon, excludeSkills: sp.excludeSkills, lockedSlots: sp.lockedSlots };
}
export interface PlannedBuild {
  base: Profile;               // the profile before any buff (Manual's for a hand-picked suit): evaluate.mts's `profile`
  plan: BuffPlan;              // what the buffs plan with: evaluate.mts's `buffs`
  profile: EffectiveProfile;   // what the solvers score with (buffs.mts plannedProfile)
  buffs: RunBuffs | undefined; // the buffs a run keeps, absent with none on
  pool: PoolSettings;          // the candidate pool settings, as POST /api/optimize's by-character form takes them
  opts: { restarts: number; exact: boolean; timeBudgetMs?: number; alternatives?: { count: number; tolerance: number } };
  snapshot: RunSettings;       // the settings a saved run keeps (the runs drawer labels, compares and reopens runs from it)
}
// A spec turned into a build for a character: the profile the solvers score with and its buff plan, the pool settings,
// the search options and the saved run's settings snapshot. The shard's rules are the ones vault-lib holds (setRules).
export function planBuild(spec: BuildSpec, { character, worn, race, suit }: PlanContext): PlannedBuild {
  const flat = profileFromSpec(spec), edits = spec.buffs.skills, on = spec.buffs.on;
  const p: Profile = { ...flat, race: race || "human" };
  const buffs = runBuffs(on, buffSkillValues(character ? character.skills || {} : null, edits).values);
  const base = suit ? manualBase(p, character) : p;
  const plan = suit ? manualPlan(character, worn, suit, character ? p.race! : null, on, edits) : buffPlanOf(character, worn, p.race, buffs, edits);
  const { intent } = spec, s = spec.search || {}, pool = poolFromSpec(spec, character);
  const exact = s.exact ?? RUN_DEFAULTS.exact, budgetMs = s.budgetMs ?? RUN_DEFAULTS.budgetMs, altCount = s.altCount ?? 0, altTol = s.altTol ?? 0;
  const opts = { restarts: s.restarts ?? RUN_DEFAULTS.restarts, exact, ...(exact ? { timeBudgetMs: budgetMs } : {}), ...(exact && altCount > 0 ? { alternatives: { count: altCount, tolerance: altTol } } : {}) };
  const snapshot: RunSettings = { ...pool, floors: intent.floors, softFloors: intent.softFloors, weights: intent.weights, race: p.race!, resistCaps: intent.resistCaps,
    restarts: s.restarts || RUN_DEFAULTS.restarts, exact, budgetMs: budgetMs || RUN_DEFAULTS.budgetMs, altCount, altTol, ...(buffs ? { buffs } : {}) };
  return { base, plan, profile: plannedProfile(base, character, plan), buffs, pool, opts, snapshot };
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
  if (e.template != null && !(typeof e.template === "string" && e.template.length <= 128)) { say("template", e.template, "left out"); delete out.template; }
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
