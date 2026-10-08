// run-settings.mts — a build's run settings: their shape, the one check every route holds them to (`settings` and
// `meta.settings` on POST /api/optimize, a manual run's `settings` on POST /api/runs), the search knobs' ranges the
// page's Advanced fields share, and the defaults. Pure and browser-safe: the page imports the ranges and defaults.
import { isRunBuffs } from "./buffs.mts";
import { isBoundedInt, isBoundedString, MAX_SERIAL, short } from "./guards.mts";
import { CASTING_SCHOOLS, excludeWeaponsError, resistCapsError } from "./vault-lib.mts";
export type { RunSettings } from "./vault-lib.mts";

// The search options POST /api/optimize takes in `opts`, and the range each may sit in.
export const OPTS_LIMITS = { restarts: { min: 1, max: 10000 }, timeBudgetMs: { min: 0, max: 60 * 60 * 1000 }, alternativesCount: { min: 0, max: 100 } } as const;

// A run setting's number range: min, max (none: no upper bound), and whether it must be a whole number. The page's
// Advanced fields check against the same table (app/ui/builder-model.mts's KNOB_RANGES).
export interface Range { min: number; max?: number | undefined; whole: boolean }
export const RUN_SETTING_LIMITS = {
  strLimit: { min: 1, max: 1000, whole: true },
  restarts: { ...OPTS_LIMITS.restarts, whole: true },
  budgetMs: { ...OPTS_LIMITS.timeBudgetMs, whole: true },
  altCount: { ...OPTS_LIMITS.alternativesCount, whole: true },
  altTol: { min: 0, whole: false },
} as const satisfies Record<string, Range>;

// What an absent setting means. The page's Advanced fields open on the search ones; POST /api/optimize fills in the
// seed and restarts for any caller; build_suit (app/mcp-tools.mts) asks for a shorter budget, since an assistant waits on it.
export const RUN_DEFAULTS = { seed: 2026, restarts: 200, exact: true, budgetMs: 300_000, mcpBudgetMs: 60_000, altCount: 5, altTol: 0 } as const;

// The STR limit a build uses when the profile names none: the character's STR, else 125 (the page's STR limit field
// and build_suit). POST /api/optimize's own default is no limit (Infinity): a known difference the BuildSpec work settles.
export const DEFAULT_STR_LIMIT = 125;
export const defaultStrLimit = (character: { stats?: unknown } | null | undefined): number =>
  Number((character?.stats as { str?: unknown } | undefined)?.str) || DEFAULT_STR_LIMIT;

// The races a build may name (profiles.v3.schema.json's race enum lists the same three; a test checks).
export const RACES: readonly string[] = ["human", "elf", "gargoyle"];
const FLAGS = ["allowGargoyle", "medOnly", "allowOthersWorn", "ubwsAnyWeapon", "exact", "swingSteps"];
const LISTS = ["softFloors", "lockedSlots", "excludeTags", "excludeRoots", "excludeSkills"];
// Read only by an exact search: without one the page leaves these fields unchecked (builder-model.mts firstKnobError),
// so a run with `exact: false` may carry any number in them.
const EXACT_ONLY = ["budgetMs", "altCount", "altTol"];
const plainKey = (k: string): boolean => isBoundedString(k, 64) && !["__proto__", "constructor", "prototype"].includes(k);

// A run's settings, as the Saved runs drawer keeps them (ui/runs.mts settingsSnapshot) and the optimize route's
// by-character form reads its pool from: only the known fields, each of its type and in range, property maps with plain
// keys (no __proto__), and the resist caps, weapon exclusions and buffs held to their own rules. A null field means
// "the default", like an absent one. `label` names the field in the reason ("settings", "meta.settings"); null when fine.
export function runSettingsError(settings: unknown, label: string): string | null {
  if (settings == null) return null;
  if (typeof settings !== "object" || Array.isArray(settings)) return `${label} must be an object`;
  const st = settings as Record<string, unknown>;
  for (const [k, v] of Object.entries(st)) {
    if (v == null) continue;
    if (k === "floors" || k === "weights") {
      if (typeof v !== "object" || Array.isArray(v)) return `${label}.${k} must be an object`;
      const bad = Object.entries(v).find(([p, n]) => !plainKey(p) || typeof n !== "number" || !Number.isFinite(n) || Math.abs(n) > 1e6);
      if (bad) return `${label}.${k}.${short(bad[0])} must be a number between -1000000 and 1000000`;
    } else if (FLAGS.includes(k)) { if (typeof v !== "boolean") return `${label}.${k} must be a boolean`; }
    else if (Object.hasOwn(RUN_SETTING_LIMITS, k)) {
      const { min, max, whole } = RUN_SETTING_LIMITS[k as keyof typeof RUN_SETTING_LIMITS] as Range;
      const finite = typeof v === "number" && Number.isFinite(v);
      if (finite && st.exact === false && EXACT_ONLY.includes(k)) continue;
      if (!finite || v < min || (max != null && v > max) || (whole && !Number.isInteger(v))) return `${label}.${k} must be a ${whole ? "whole " : ""}number ${max != null ? `from ${min} to ${max}` : `of ${min} or more`}`;
    }
    else if (LISTS.includes(k)) {
      if (!Array.isArray(v) || v.length > 200 || v.some((x) => !(isBoundedString(x, 64) || (k === "excludeRoots" && isBoundedInt(x, 0, MAX_SERIAL))))) return `${label}.${k} must be a list of names`;
    } else if (k === "race") { if (!RACES.includes(v as string)) return `${label}.race must be human, elf or gargoyle`; }
    else if (k === "excludeWeapons") { const e = excludeWeaponsError(v, `${label}.excludeWeapons`); if (e) return e; }
    else if (k === "resistCaps") { const e = resistCapsError(v, `${label}.resistCaps`); if (e) return e; }
    else if (k === "castingSchool") { if (!CASTING_SCHOOLS.includes(v as string)) return `${label}.castingSchool must be one of ${CASTING_SCHOOLS.join(", ")}`; }
    else if (k === "buffs") { if (!isRunBuffs(v)) return `${label}.buffs must list known buffs, each once and one form at most, with their numbers in range`; }
    else return `${label}.${short(k)} is not a run setting`;
  }
  return null;
}
