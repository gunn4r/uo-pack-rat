// ui-prefs.mts — <data>/ui-prefs.json: the page's view choices (GET/PUT /api/ui-prefs), the fields it may hold, and the checks a request's or a hand-edited file's value is held to.
import { GEAR_SLOTS } from "../vault-lib.mts";
import { isBuffSkills, isBuffSkillsByCharacter, normalizeBuffs, normalizeBuffListsByCharacter } from "../buffs.mts";
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
} as const satisfies Record<string, readonly string[]>;
// The list fields: the Inventory tab's columns and the character sheet's shown properties (absent = the default set).
export const UI_PREF_LISTS = ["cols", "sheetProps"] as const;
// The version fields: the release whose in-app update notice was dismissed (ui/settings.mts's automatic
// update check), and the ClassicUO web scanner last copied into the client (ui/paste-scanner.mts).
export const UI_PREF_VERSIONS = ["dismissedUpdate", "copiedScanner"] as const;
export type UiPrefsFile = { -readonly [K in typeof UI_PREF_LISTS[number]]?: string[] } & { -readonly [K in keyof typeof UI_PREF_CHOICES]?: string } & { -readonly [K in typeof UI_PREF_VERSIONS[number]]?: string } & { colWidths?: Record<string, number>; mapDrawerWidth?: number; manualSuit?: Record<string, number>; manualBuffs?: string[]; manualBuffSkills?: Record<string, number> } & LegacyBuffPrefs;
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
  const out: UiPrefsFile = {};
  for (const key of UI_PREF_LISTS) {
    const v = raw[key];
    if (Array.isArray(v) && v.every((c) => typeof c === "string")) out[key] = v as string[];
  }
  for (const [key, allowed] of Object.entries(UI_PREF_CHOICES)) {
    const v = raw[key];
    if (typeof v === "string" && (allowed as readonly string[]).includes(v)) out[key as keyof typeof UI_PREF_CHOICES] = v;
  }
  if (isColWidths(raw.colWidths)) out.colWidths = raw.colWidths;
  if (isDrawerWidth(raw.mapDrawerWidth)) out.mapDrawerWidth = raw.mapDrawerWidth;
  if (isManualSuit(raw.manualSuit)) out.manualSuit = raw.manualSuit;
  // the buffs read back healed (app/buffs.mts normalizeBuffs): a hand-edited second form replaces the first
  const manualBuffs = normalizeBuffs(raw.manualBuffs), autoBuffs = normalizeBuffListsByCharacter(raw.autoBuffs);
  if (manualBuffs) out.manualBuffs = manualBuffs;
  if (autoBuffs) out.autoBuffs = autoBuffs;
  if (isBuffSkills(raw.manualBuffSkills)) out.manualBuffSkills = raw.manualBuffSkills;
  if (isBuffSkillsByCharacter(raw.buffSkills)) out.buffSkills = raw.buffSkills;   // an older flat shape is dropped
  for (const key of UI_PREF_VERSIONS) if (isBoundedString(raw[key], 64)) out[key] = raw[key];
  return out;
}
