// migrate.mts — the one registry of data-file migrations: for each kind of document Pack Rat keeps (a scan, profiles.json, a saved run, organize.json, …), the version this build writes and the ordered steps that bring an older document up to it. Every store's reader calls migrate(); docs/architecture.md (Data folder) lists the files and CLAUDE.md (Contract rules) says how to add a step.
//
// A document's version is its `schemaVersion`, or `version` (a synonym: organize.json, organize-state.json, item-kinds.json, house-map.json and mcp.json write that one, and a v1 scan did). A step runs when the document is at its `from` version and leaves it at `to`; a step with from === to is an in-version fix (a field renamed without a bump). Each step is pure and idempotent, and returns its input itself when it has nothing to change. A document newer than this build knows comes back untouched with `newer` set: its reader loads what it can and refuses to save over it (json-file.mts's refuseNewer).
import { upgradeScan } from "./scan-schema.mts";
import { migrateProfiles, migrateWeaponSetting } from "./vault-lib.mts";
import { migrateProfilesV3, PROFILES_VERSION } from "./build-spec.mts";
import { PROOF_SOUND_SINCE } from "./runs-lib.mts";
import type { LegacyBuffPrefs } from "./store/ui-prefs.mts";

type Doc = Record<string, unknown>;
// What a step may need beyond the document. scan: the shard a scan without its own is read under. profiles: ui-prefs.json
// (Automatic's buffs move from it into profiles.json at v3), which scanned characters still exist, and `out`, where the
// profiles steps leave ui-prefs.json as it should be after them, whether that changed, and what a bad value became.
export interface MigrateContext {
  shard?: string | null | undefined;
  prefs?: LegacyBuffPrefs | undefined;
  scanned?: ((name: string) => boolean) | undefined;
  out?: { prefs: LegacyBuffPrefs; prefsChanged: boolean; healed: string[] } | undefined;
}
interface Step { from: number; to: number; what: string; run(doc: Doc, ctx: MigrateContext): Doc }
// `field`: the version field the file is written with (none for ui-prefs.json). `missing`: the version of a document
// without one, or null when such a document is not one of this kind (its reader's salvage refuses it).
interface Kind { field: "schemaVersion" | "version" | null; current: number; missing: number | null; steps: Step[] }

// The profiles steps hand ui-prefs.json's side of the v3 migration out through ctx.out.
function profilesV3(doc: Doc, ctx: MigrateContext): Doc {
  const r = migrateProfilesV3(doc, ctx.prefs ?? {}, { scanned: ctx.scanned });
  if (ctx.out) Object.assign(ctx.out, { prefs: r.prefs, prefsChanged: r.prefsChanged, healed: [...ctx.out.healed, ...r.healed] });
  return r.changed ? r.profiles : doc;
}
const profilesV2 = (doc: Doc): Doc => { const r = migrateProfiles(doc); return r.changed ? r.profiles : doc; };
// A saved run's settings, with `fix` applied when it changes them.
const runSettings = (fix: (s: Doc) => Doc) => (doc: Doc): Doc => {
  const s = (doc.settings ?? {}) as Doc, next = fix(s);
  return next === s ? doc : { ...doc, settings: next };
};

export const DOC_KINDS = {
  scan: { field: "schemaVersion", current: 2, missing: null, steps: [
    { from: 1, to: 2, what: "TazUO's first scanner: serials become numbers, scannedAt RFC 3339, the adapter and the shard stamped (scan-schema.mts upgradeScan)", run: (d, c) => upgradeScan(d, { shard: c.shard }) },
    { from: 2, to: 2, what: "a scan without its own shard is read under the current one", run: (d, c) => (d.shard != null ? d : upgradeScan(d, { shard: c.shard })) },
  ] },
  profiles: { field: "schemaVersion", current: PROFILES_VERSION, missing: 0, steps: [
    { from: 0, to: 2, what: "unversioned: archetypes become templates, a character's archetype its template (vault-lib.mts migrateProfiles)", run: profilesV2 },
    { from: 1, to: 2, what: "the global caps leave for the shard's rules file", run: profilesV2 },
    { from: 2, to: 2, what: "a single weaponSkill becomes excludeWeapons (migrateWeaponSetting)", run: profilesV2 },
    { from: 2, to: 3, what: "each character's and template's settings become its spec, with Automatic's buffs moved in from ui-prefs.json (build-spec.mts migrateProfilesV3)", run: profilesV3 },
    { from: 3, to: 3, what: "autoBuffs and buffSkills still left in ui-prefs.json leave it", run: profilesV3 },
  ] },
  runs: { field: "schemaVersion", current: 1, missing: 1, steps: [
    { from: 1, to: 1, what: "a run saved without schemaVersion is version 1, and one without settings has none set", run: (d) => (d.schemaVersion === 1 && isDoc(d.settings) ? d : { ...d, schemaVersion: 1, settings: { ...(d.settings as Doc | undefined) } }) },
    { from: 1, to: 1, what: "settings.weaponSkill becomes settings.excludeWeapons (migrateWeaponSetting)", run: runSettings(migrateWeaponSetting) },
    { from: 1, to: 1, what: "settings.allowOthers becomes settings.allowOthersWorn", run: runSettings((s) => {
      if (!("allowOthers" in s)) return s;
      const { allowOthers, ...rest } = s;
      return { ...rest, allowOthersWorn: !!allowOthers };
    }) },
    { from: 1, to: 1, what: "settings.budgetS becomes settings.budgetMs", run: runSettings((s) => {
      if (!("budgetS" in s)) return s;
      const { budgetS, ...rest } = s;
      return { ...rest, budgetMs: 1000 * (budgetS as number) };
    }) },
    { from: 1, to: 1, what: "a proof claimed by a solver older than PROOF_SOUND_SINCE is withdrawn (no verdict)", run: (d) => {
      const result = d.result as { proven?: unknown } | undefined;
      return result?.proven && ((d.solverVersion as number | undefined) ?? 1) < PROOF_SOUND_SINCE ? { ...d, result: { ...result, proven: undefined } } : d;
    } },
  ] },
  organize: { field: "version", current: 1, missing: null, steps: [] },
  "organize-state": { field: "version", current: 1, missing: null, steps: [] },
  "item-kinds": { field: "version", current: 1, missing: 1, steps: [] },
  "house-map": { field: "version", current: 1, missing: null, steps: [] },
  mcp: { field: "version", current: 1, missing: null, steps: [] },
  settings: { field: "schemaVersion", current: 1, missing: 1, steps: [] },
  "ui-prefs": { field: null, current: 1, missing: 1, steps: [] },
} satisfies Record<string, Kind>;
export type DocKind = keyof typeof DOC_KINDS;

const isDoc = (v: unknown): v is Doc => !!v && typeof v === "object" && !Array.isArray(v);
const isVersion = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;
// The document's version, or null when it has none this kind accepts (a missing field reads as the kind's `missing`).
export function versionOf(kind: DocKind, doc: unknown): number | null {
  const k: Kind = DOC_KINDS[kind];
  if (!isDoc(doc)) return null;
  if (!k.field) return k.current;
  return isVersion(doc.schemaVersion) ? doc.schemaVersion : isVersion(doc.version) ? doc.version : k.missing;
}

export interface Migrated { doc: unknown; changed: boolean; fromVersion: number | null; newer: boolean }
// `raw` brought up to the version this build writes. A document with no version this kind accepts (or not an object)
// comes back untouched, for its reader's own check to refuse; one newer than DOC_KINDS[kind].current comes back
// untouched with `newer`. A document that carries the other version field (`version` where the file writes
// `schemaVersion`, or the reverse) gets the one its file writes.
export function migrate(kind: DocKind, raw: unknown, ctx: MigrateContext = {}): Migrated {
  const k: Kind = DOC_KINDS[kind], fromVersion = versionOf(kind, raw);
  if (fromVersion === null || !isDoc(raw)) return { doc: raw, changed: false, fromVersion, newer: false };
  if (fromVersion > k.current) return { doc: raw, changed: false, fromVersion, newer: true };
  let doc = raw;
  for (const step of k.steps) if (versionOf(kind, doc) === step.from) doc = step.run(doc, ctx);
  const other = k.field === "version" ? "schemaVersion" : "version";
  if (k.field && !(k.field in doc) && other in doc) {
    const { [other]: v, ...rest } = doc;
    doc = { ...rest, [k.field]: v };
  }
  return { doc, changed: doc !== raw, fromVersion, newer: false };
}

// What a store says about a file this build may not write, or null when it may.
export function newerNotice(file: string, kind: DocKind, doc: unknown): string | null {
  const v = versionOf(kind, doc);
  return v !== null && v > DOC_KINDS[kind].current ? `${file} was made by a newer Pack Rat (version ${v}); it is read-only here until Pack Rat is updated` : null;
}
