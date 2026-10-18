// ui-prefs.mts — <data>/ui-prefs.json: the page's view choices (GET/PUT /api/ui-prefs), the fields it may hold, and the checks a request's or a hand-edited file's value is held to.
//
// map: server
// owns: `createUiPrefsStore`, `UI_PREF_FIELDS`, `UI_PREF_CHOICES`, `UI_PREF_LISTS`, `UI_PREF_VERSIONS`, `isColWidths`, `isDrawerWidth`, `isManualSuit`
import { GEAR_SLOTS } from "../vault-lib.mts";
import { isBuffList, isBuffSkills, isBuffSkillsByCharacter, normalizeBuffs, normalizeBuffListsByCharacter } from "../buffs.mts";
import { isBoundedInt, isBoundedString, MAX_SERIAL } from "../guards.mts";
import { migrate } from "../migrate.mts";
import { readJsonFile, writeJsonFile } from "./json-file.mts";

// The closed-choice fields of <data>/ui-prefs.json (GET/PUT /api/ui-prefs) and what each may hold. The
// page applies only the theme families it ships (app/ui/theme.mts's BUILT_THEMES) and draws Default for
// anything else.
export const UI_PREF_CHOICES = {
  theme: ["default", "britannia"],
  appearance: ["light", "system", "dark"],
  sidebar: ["auto", "collapsed"],
  density: ["dense", "regular"],   // the Inventory table's row height
  colsVersion: ["2"],              // the column set `cols` was saved against (app/ui/view-state.mts's COLS_VERSION)
  areaLabels: ["show", "hide"],    // the House map's area name pills (app/ui/house-map.mts, issue #10)
  builderMode: ["automatic", "manual"],   // the Suit Builder's mode (app/ui/builder-manual.mts, issue #12)
  manualFor: ["character", "none"],       // whether Manual totals take the picked character's bonuses
  buffsCount: ["on", "off"],              // whether Manual's totals count the buffs that are on (app/buffs.mts)
  builderTab: ["requirements", "weights", "buffs", "pool", "advanced"],   // the Suit Builder's last Settings drawer tab (app/ui/builder.mts, issue #272)
  builderChanges: ["gauges", "table"],   // how the Suit Builder's result shows What changes (app/ui/builder-result.mts, issue #272)
  builderFineTune: ["on", "off"],        // whether the Suit Builder's Goals tab shows the weights its goals set (app/ui/builder.mts, issue #292)
  unravelRows: ["full", "condensed"],    // the Unravel view's rows: two lines, or one (app/ui/unravel.mts, issue #332)
} as const satisfies Record<string, readonly string[]>;
// The list fields: the Inventory tab's columns and the character sheet's shown properties (absent = the default set), and the
// Unravel view's collapsed groups (issue #332).
export const UI_PREF_LISTS = ["cols", "sheetProps", "unravelCollapsed"] as const;
// The version fields: the release whose in-app update notice was dismissed (ui/settings.mts's automatic
// update check), and the ClassicUO web scanner last copied into the client (ui/paste-scanner.mts).
export const UI_PREF_VERSIONS = ["dismissedUpdate", "copiedScanner"] as const;
export type UiPrefsFile = { -readonly [K in typeof UI_PREF_LISTS[number]]?: string[] } & { -readonly [K in keyof typeof UI_PREF_CHOICES]?: (typeof UI_PREF_CHOICES)[K][number] } & { -readonly [K in typeof UI_PREF_VERSIONS[number]]?: string } & { colWidths?: Record<string, number>; mapDrawerWidth?: number; manualSuit?: Record<string, number>; manualBuffs?: string[]; manualBuffSkills?: Record<string, number> } & LegacyBuffPrefs;
// Automatic's buffs and the buff numbers, by character: profiles.json holds them since schemaVersion 3. Read back only
// so that a file the profiles migration has not reached yet keeps them through a write, until that migration moves them
// (app/build-spec.mts migrateProfilesV3). Neither GET nor PUT /api/ui-prefs carries them.
export interface LegacyBuffPrefs { autoBuffs?: Record<string, string[]>; buffSkills?: Record<string, Record<string, number>> }
// The House map's contents drawer width in px (app/ui/house-map.mts, issue #10): the page clamps it to the window.
export const isDrawerWidth = (v: unknown): v is number => isBoundedInt(v, 320, 4000);
// The Inventory columns' dragged widths ({colKey: px}): at most 200 column keys (the same keys `cols` holds), each a whole 40 to 1200 px.
export function isColWidths(v: unknown): v is Record<string, number> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const entries = Object.entries(v);
  return entries.length <= 200 && entries.every(([k, w]) => isBoundedString(k, 64) && isBoundedInt(w, 40, 1200));
}
// The Suit Builder's Manual suit ({slot: serial}, app/ui/builder-manual.mts): each key one of the classifier's slots
// (vault-lib.mts's GEAR_SLOTS), each value a serial.
export function isManualSuit(v: unknown): v is Record<string, number> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  return Object.entries(v).every(([k, s]) => GEAR_SLOTS.includes(k) && isBoundedInt(s, 1, MAX_SERIAL));
}
// Every field of <data>/ui-prefs.json, in the file's order: `check` is what PUT /api/ui-prefs holds a value to, with
// `error` its 400; `read` is how the field is read back from the file (the value, healed, or undefined to drop it),
// `check` itself when absent. A list read back may be longer or hold longer keys than a PUT allows; the buffs read back
// healed (app/buffs.mts normalizeBuffs, a hand-edited second form replaces the first); Automatic's buffs and the buff
// numbers by character are only read back (LegacyBuffPrefs below; they are the profile now, a setBuffs edit through PATCH /api/profiles), and a PUT naming them is refused.
export interface UiPrefField { key: string; check: (v: unknown) => boolean; error: string; read?: (v: unknown) => unknown }
const isKeyList = (v: unknown): boolean => Array.isArray(v) && v.length <= 200 && v.every((c) => isBoundedString(c, 64));
const legacy = (key: string): string => `${key} is kept with the profiles now; reload the page`;
export const UI_PREF_FIELDS: UiPrefField[] = [
  ...UI_PREF_LISTS.map((key) => ({ key, check: isKeyList, error: `${key} must be a list of at most 200 keys`, read: (v: unknown) => (Array.isArray(v) && v.every((c) => typeof c === "string") ? v : undefined) })),
  ...Object.entries(UI_PREF_CHOICES).map(([key, allowed]) => ({ key, check: (v: unknown) => typeof v === "string" && (allowed as readonly string[]).includes(v), error: `${key} must be one of ${allowed.join(", ")}` })),
  { key: "colWidths", check: isColWidths, error: "colWidths must map at most 200 column keys to whole widths from 40 to 1200 px" },
  { key: "mapDrawerWidth", check: isDrawerWidth, error: "mapDrawerWidth must be a whole width from 320 to 4000 px" },
  { key: "manualSuit", check: isManualSuit, error: "manualSuit must map the suit's slots to item serials" },
  { key: "manualBuffs", check: isBuffList, error: "manualBuffs must list known buffs, each once, one form at most", read: (v) => normalizeBuffs(v) || undefined },
  { key: "autoBuffs", check: () => false, error: legacy("autoBuffs"), read: (v) => normalizeBuffListsByCharacter(v) || undefined },
  { key: "manualBuffSkills", check: isBuffSkills, error: "manualBuffSkills must map known buff skills to numbers within their ranges" },
  { key: "buffSkills", check: () => false, error: legacy("buffSkills"), read: (v) => (isBuffSkillsByCharacter(v) ? v : undefined) },   // an older flat shape is dropped
  ...UI_PREF_VERSIONS.map((key) => ({ key, check: (v: unknown) => isBoundedString(v, 64), error: `${key} must be a version of at most 64 characters` })),
];
// <data>/ui-prefs.json: the page's view choices (GET/PUT /api/ui-prefs). A missing, unreadable or
// malformed file reads as "nothing chosen", and the page keeps its defaults.
// Each field is read on its own: one bad value (a hand edit) drops that field, not the whole file.
export function createUiPrefsStore(file: string) {
  function read(): UiPrefsFile {
    return readJsonFile(file, { onBad: "empty", salvage: (doc) => salvageUiPrefs(migrate("ui-prefs", doc).doc) });
  }
  function write(prefs: UiPrefsFile): void { writeJsonFile(file, prefs, { indent: 2 }); }
  return { file, read, write };
}
function salvageUiPrefs(doc: unknown): UiPrefsFile {
  const raw = doc as Record<string, unknown>;
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, unknown> = {};
  for (const f of UI_PREF_FIELDS) {
    const v = f.read ? f.read(raw[f.key]) : f.check(raw[f.key]) ? raw[f.key] : undefined;
    if (v !== undefined) out[f.key] = v;
  }
  return out as UiPrefsFile;
}
