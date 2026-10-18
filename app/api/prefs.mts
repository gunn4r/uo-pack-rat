// prefs.mts — what the profile and preference routes answer (app/http/routes/prefs.mts): the profiles with the shard's built-in templates and a PATCH's stamps, the page's own view choices, and the TazUO panel's options. Types only and node-free, so the routes `satisfies` these, the page re-exports them (app/ui/api-types.mts) and the route map names them (app/api/routes.mts).
//
// map: api
// owns: `UiPrefs`, `UiPrefsApiResponse`, `ProfilesApiResponse`, `ProfilesPatchApiResponse`, `TazuoPanelApiResponse`
import type { ProfilesV3, TemplateMap } from "../build-spec.mts";
import type { PanelPrefs } from "../tazuo-panel-prefs.mts";

// GET /api/ui-prefs — the page's own view choices, kept in <data>/ui-prefs.json (app/store/ui-prefs.mts). Every field is
// optional: absent means "never chosen", and the page keeps its default. PUT takes any of them and answers {ok}.
export interface UiPrefs {
  cols?: string[] | undefined;
  colsVersion?: "2" | undefined;                       // the column set `cols` was saved against (view-state.mts)
  colWidths?: Record<string, number> | undefined;      // the Inventory columns' dragged widths in px, by column key
  sheetProps?: string[] | undefined;                   // the character sheet's shown properties (absent = sheet.mts's default set)
  theme?: string | undefined;                          // a theme family ("default" or "britannia")
  appearance?: "light" | "system" | "dark" | undefined;
  sidebar?: "auto" | "collapsed" | undefined;          // "collapsed" = pinned to icons at any width
  density?: "dense" | "regular" | undefined;           // the Inventory table's rows: 32 or 40 px
  areaLabels?: "show" | "hide" | undefined;            // the House map's area name pills (absent = shown)
  mapDrawerWidth?: number | undefined;                 // the House map contents drawer's width in px (absent = 400)
  builderMode?: "automatic" | "manual" | undefined;    // the Suit Builder's mode (absent = Automatic)
  builderTab?: "requirements" | "weights" | "buffs" | "pool" | "advanced" | undefined;   // the Settings drawer's last tab (absent = Requirements)
  builderChanges?: "gauges" | "table" | undefined;   // the result's What changes view (absent = Gauges)
  builderFineTune?: "on" | "off" | undefined;   // whether the Goals tab shows the weights its goals set (absent = off)
  unravelRows?: "full" | "condensed" | undefined;      // the Unravel view's rows (absent = full)
  unravelCollapsed?: string[] | undefined;             // the Unravel view's collapsed groups: relic, held, essence, residue (absent = none)
  manualFor?: "character" | "none" | undefined;        // Manual totals with the picked character's bonuses, or raw items (absent = character)
  manualSuit?: Record<string, number> | undefined;     // the Manual suit: a serial per slot (builder-manual.mts)
  manualBuffs?: string[] | undefined;                  // the Manual suit's buffs that are on (app/buffs.mts ids)
  manualBuffSkills?: Record<string, number> | undefined;   // the buff numbers edited for Manual's No character (a character's are its profile's)
  buffsCount?: "on" | "off" | undefined;               // whether Manual's totals count the buffs (absent = on)
  dismissedUpdate?: string | undefined;                // the release whose update notice was dismissed (settings.mts)
  copiedScanner?: string | undefined;                  // the ClassicUO web scanner version last copied (paste-scanner.mts)
}
export interface UiPrefsApiResponse {
  ok: boolean;
  prefs: UiPrefs;
}

export interface ProfilesApiResponse {
  ok: boolean;
  profiles: ProfilesV3;
  stamp: string;   // the file's content stamp, which a PATCH's `was` is compared with
  builtinTemplates: TemplateMap;   // the shard's built-in templates, read-only (app/data/templates/<shard>.json)
  readOnly?: string;   // why profiles.json cannot be saved, when a newer Pack Rat made it (app/migrate.mts)
}
// PATCH /api/profiles {edits} (app/profile-edits.mts): the file's stamp after the write, and the one the edits were made on.
export interface ProfilesPatchApiResponse { ok: boolean; stamp: string; was: string }
// GET/PUT /api/tazuo-panel (app/tazuo-panel-prefs.mts): the panel's options as saved.
export interface TazuoPanelApiResponse { ok: boolean; prefs: PanelPrefs }
