// ui/api-types.mts — response shapes the page reads off its own fetches. api.mts's `api()` call
// returns `unknown` at the boundary (Response.json() is genuinely unvalidated network input); every
// caller narrows through one of the types below rather than sprinkling `as Whatever` at each read
// site, per the migration plan's "type each endpoint's response in ONE place."
//
// A server-side module may be imported here, type or value, when it and everything it imports is
// browser-safe (no node: import anywhere in that chain), as the imports below are. One that reaches a
// node: module (app/installer.mts, app/runs-lib.mts, app/exact-solver.mts, app/vault-server.mts) cannot
// be imported even for a type: the browser build (tsconfig.browser.json) type-checks with `"types": []`,
// a type-only import is erased only at EMIT time, and the imported file still has to type-check — e.g.
// app/runs-lib.mts's `import { createHash } from "node:crypto"` fails with "Cannot find name
// 'node:crypto'". The shapes those modules define are declared again below by hand. Each interface
// names the server-side type/route it mirrors, so a change on one side has somewhere obvious to update
// on the other; nothing here is validated against the wire (HTTP responses are unvalidated network
// input, same trust level server.test.mts's own per-route interfaces document), it just gives the
// page's own reads a name instead of `unknown`.
import type { Item, Container, Character, ScanSummary, OptItem, RunSettings, ProfilesFile, BlacklistEntry, KindOverrides } from "../vault-lib.mts";
import type { Facets, ItemQueryRows, ItemQueryGroups, HitRow } from "../item-query.mts";
import type { RulesV1 } from "../schema/types.d.mts";
import type { AutostartOutcome, Hotkey as PanelHotkey, PanelPrefs } from "../tazuo-panel-prefs.mts";
import type { OrganizeConfig, Origin, RuleMatch } from "../organize-config.mts";
import type { MissingItem } from "../missing.mts";
import type { DataDirCheckInfo } from "../data-dir-notice.mts";

// ---------------------------------------------------------------- shared fragments

// A scanned character's skills map (Character.skills, vault-lib.mts) is declared as a loose
// Record<string, unknown> there on purpose (the scan schema leaves per-skill shape open) — this is
// what a real entry actually holds, read at the boundary by sheet.mts/characters.mts the same way
// vault-lib.mts's own resistSkillBonus() already casts one skill entry (`as { value?: number }`).
export interface SkillEntry {
  value: number;
  cap: number;
}

// settings.client / setup.settings.client (POST /api/settings, GET /api/setup) — mirrors
// app/vault-server.mts's ClientSettings.
export interface ClientSetting {
  adapter: string;
  scriptsDir: string;
}
// settings.retention (app/retention.mts): the server answers with all three fields.
export interface RetentionSetting {
  keepAll: boolean;
  scanDays: number;
  runsPerCharacter: number;
}
export interface SettingsData {
  shard: string;
  setupDone?: boolean | undefined;
  client?: ClientSetting | null | undefined;
  retention?: RetentionSetting | undefined;
  autoUpdateCheck?: boolean | undefined;   // Settings › Updates' automatic check (the server answers true unless it was turned off)
  uoFolder?: string | null | undefined;    // Settings › UO folder (house map): the folder holding tiledata.mul; absent or null = found through TazUO's launcher
}
// POST /api/retention/cleanup: what a dry run would remove, or what a real run removed; refused when
// old scans were kept because the inventory would have changed without them.
export interface CleanupApiResponse {
  ok: boolean;
  scans: number;
  runs: number;
  refused: boolean;
}
export interface SettingsApiResponse {
  ok: boolean;
  settings: SettingsData;
}

// GET /api/ui-prefs — the page's own view choices, kept in <data>/ui-prefs.json. Every field is
// optional: absent means "never chosen", and the page keeps its default.
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
  manualFor?: "character" | "none" | undefined;        // Manual totals with the picked character's bonuses, or raw items (absent = character)
  manualSuit?: Record<string, number> | undefined;     // the Manual suit: a serial per slot (builder-manual.mts)
  manualBuffs?: string[] | undefined;                  // the Manual suit's buffs that are on (app/buffs.mts ids)
  autoBuffs?: Record<string, string[]> | undefined;    // Automatic's buffs that are on, by character (app/buffs.mts ids)
  buffSkills?: Record<string, Record<string, number>> | undefined;   // the buff numbers edited, by character ("" = No character), then app/buffs.mts input
  buffsCount?: "on" | "off" | undefined;               // whether Manual's totals count the buffs (absent = on)
  dismissedUpdate?: string | undefined;                // the release whose update notice was dismissed (settings.mts)
  copiedScanner?: string | undefined;                  // the ClassicUO web scanner version last copied (paste-scanner.mts)
}
export interface UiPrefsApiResponse {
  ok: boolean;
  prefs: UiPrefs;
}

// GET /api/rules' `available` list — mirrors app/rules.mts's RulesEntry, trimmed to what the page
// ever reads (id, name) off state.availableShards.
export interface ShardOption {
  id: string;
  name: string;
}
export interface RulesApiResponse {
  ok: boolean;
  shard: string;
  rules: RulesV1;
  available: ShardOption[];
  fallback: boolean;
}

// ---------------------------------------------------------------- inventory / items

// GET /api/inventory's `.inventory` — mirrors the object vault-server.mts's route builds by hand
// (never the full fold's Inventory type from vault-lib.mts: `items` is deliberately absent since
// Task 5, replaced by `worn`/`rootCounts`/`itemCount`/`facets`/`propKeys`, computed once server-side
// over the whole set).
export interface InventoryData {
  scans: ScanSummary[];
  characters: Record<string, Character>;
  containers: Record<string, Container>;
  worn: Record<string, Item[]>;
  rootCounts: Record<string, number>;
  // How many items each root has missing since its last scan (app/missing.mts); a root with none is absent.
  missingCounts: Record<string, number>;
  itemCount: number;
  facets: Facets;
  propKeys: string[];
}
export interface InventoryApiResponse {
  ok: boolean;
  snapshotCount: number;
  demo: boolean;
  inventory: InventoryData;
}

// GET /api/items — the same ItemQueryRows | ItemQueryGroups union applyItemQuery() returns
// (item-query.mts), plus the request's own offset/limit echoed back.
export type ItemsApiResponse = { ok: boolean; offset: number; limit: number } & (ItemQueryRows | ItemQueryGroups);
// GET /api/items?fields=hits (the House map's search): each match's serial, name, amount, container, root and place.
export interface ItemHitsApiResponse { ok: boolean; total: number; offset: number; limit: number; rows: HitRow[] }

// GET /api/items/by-serial
export interface ItemsBySerialApiResponse {
  ok: boolean;
  items: Record<string, Item>;
}

export interface ProfilesApiResponse {
  ok: boolean;
  profiles: ProfilesFile;
}

// ---------------------------------------------------------------- setup / wizard / adapters

// One entry of GET /api/setup's `adapters` — mirrors app/installer.mts's AdapterInfo, restated here
// (not imported — see the module header) with `capabilities` narrowed to the one field the page
// actually reads off it (`.bridge`); the rest of an adapter's capabilities.json content is real but
// unused by the page.
export interface AdapterSummary {
  id: string;
  name: string;
  transport: string;
  platform: string | null;
  summary: string;
  capabilities: { bridge: string[]; [key: string]: unknown };
}
export interface InstalledVersionInfo {
  version: string | null;
  files: Record<string, boolean>;
}
// GET /api/setup's dataDirCheck (app/data-dir-notice.mts).
export type { DataDirCheckInfo };
export interface SetupApiResponse {
  ok: boolean;
  firstRun: boolean;
  settings: SettingsData;
  adapters: AdapterSummary[];
  candidates: Record<string, string[]>;
  installed: InstalledVersionInfo | null;
  available: Record<string, string | null>;
  dataDir: string;
  platform: string;
  bridgeAdapter: string | null;
  dataDirCheck: DataDirCheckInfo;
  version?: string | undefined;   // package.json's version (Settings › Updates)
  canOpenFolders?: boolean | undefined;   // the desktop shell can open a folder (POST /api/host/open-path)
}
// GET /api/setup/scanner?adapter=<id> — a paste-transport adapter's bundled scanner (installer.mts's pasteScanner).
export interface PasteScannerApiResponse {
  ok: boolean;
  version: string | null;
  script: string;
}
export interface LocateApiResponse {
  ok: boolean;
  scriptsDir: string;
  installed: InstalledVersionInfo;
}
// POST /api/setup/install — mirrors app/installer.mts's InstallScriptsResult's `ok: true` branch (the
// `ok: false` branch never reaches the page as a parsed success value; api.mts throws on a non-2xx
// response instead, so callers read that through the thrown Error, not this type), plus the two
// fields the route itself adds: `scriptsDir`, the folder the server RESOLVED out of what the page
// sent (a client root becomes its nested scripts folder), and `pathsFile`, what became of
// packrat-paths.json — "written" | "unchanged" | "kept" | "backed-up" (installer.mts's
// PathsFileOutcome, restated as a string union here; ui/messages.mts turns it into a sentence).
export interface InstallApiResponse {
  ok: boolean;
  installed: string[];
  version: string | null;
  scriptsDir?: string | undefined;
  pathsFile?: string | undefined;
  autostart?: AutostartOutcome | null | undefined;
}
// The TazUO panel (app/tazuo-panel-prefs.mts): GET/PUT /api/tazuo-panel, and POST /api/setup/install's `panel`.
export type { AutostartOutcome, PanelHotkey, PanelPrefs };
export interface TazuoPanelApiResponse { ok: boolean; prefs: PanelPrefs }
// GET/PUT /api/mcp and POST /api/mcp/token: the built-in MCP server's settings and its listener (app/mcp.mts). `token` is
// null until MCP is first turned on; `live.portBusy` names the saved port when another program held it at launch.
export interface McpApiResponse {
  ok: boolean;
  config: { enabled: boolean; allowActions: boolean; port: number; token: string | null };
  live: { listening: boolean; port: number | null; portBusy: number | null };
}
export interface HostPickFolderApiResponse {
  ok: boolean;
  path: string | null;
}

// GET /api/update-check — mirrors app/installer.mts's CheckForUpdatesResult. `url` is typed `string`
// here although the server-side type still says `unknown`: checkForUpdates() no longer forwards
// GitHub's `html_url` as it found it, it runs it through installer.mts's releaseUrl(), which returns
// either that value once it has been proved an https://github.com/<this repo>/releases… address or
// the repository's own releases page. The wire is still unvalidated network input like every other
// response here — what changed is that the one field with a security claim on it now has a server
// that vouches for it, so the page no longer needs a cast with a warning attached.
export interface UpdateCheckApiResponse {
  configured: boolean;
  error?: string | undefined;
  current?: string | undefined;
  latest?: string | undefined;
  url?: string | undefined;
  upToDate?: boolean | undefined;
}

// ---------------------------------------------------------------- import

export interface ImportPasteApiResponse {
  ok: boolean;
  written: string;
  character: string;
  warning?: string | undefined;
}
export interface RescanApiResponse {
  ok: boolean;
  adapters: string[];
}
// GET /api/missing?root= (issue #99).
export interface MissingApiResponse { ok: boolean; items: MissingItem[] }
export interface ForgetApiResponse {
  ok: boolean;
}
export interface BlacklistApiResponse {
  ok: boolean;
  containers: BlacklistEntry[];
}
// GET and POST /api/item-kinds, POST /api/item-kinds/import (issue #150): the whole item-kinds.json document after
// the change; an import also says how many entries it left out and why (the first few).
export interface ItemKindsApiResponse extends KindOverrides { ok: boolean; version: 1; skipped?: number; problems?: string[] }

// ---------------------------------------------------------------- suit builder: optimize / runs

// The optimizer's per-slot change list — mirrors scripts/optimizer-core.mts's (unexported)
// OptSlotChange, which app/exact-solver.mts's ExactSolveResult carries through unchanged.
export interface SlotChange {
  slot: string;
  from: string | null;
  fromSerial: number;
  to: string | null;
  toSerial: number;
  gainedProps: Record<string, number>;
}
// One candidate suit — the shape both `result.best`/`result.alternatives[].best` (an OptAssignment,
// scripts/optimizer-core.mts) and the by-character POST /api/optimize response's `current` use: a
// slot name to a candidate item, or null for "nothing there." vault-lib.mts's OptItem is the same
// item shape the rest of the page already uses (resolveItems, totalsOf, sheetHtml).
export type OptSuit = Record<string, OptItem | null>;
// The optimizer's own result — mirrors scripts/optimizer-core.mts's OptResult, plus the exact-search
// fields app/exact-solver.mts's ExactSolveResult adds on top of it. Declared as one flat, mostly
// optional shape (rather than the two-interface split those files use) since every reader here
// (builder.mts, runs.mts) only ever reads fields off the union, the same way server.test.mts's own
// OptimizeJobResponse.result does.
export interface OptimizeResult {
  best: OptSuit;
  score: number;
  currentScore: number;
  greedyScore?: number | undefined;
  delta?: number | undefined;
  perSlotChanges: SlotChange[];
  totals: { before: Record<string, number>; after: Record<string, number> };
  method?: string | undefined;
  proven?: boolean | undefined;
  nodes?: number | undefined;
  alternatives?: Array<{ best: OptSuit; score: number }> | undefined;
  altTolerance?: number | undefined;
  altShortfall?: "budget" | "tolerance" | "exhausted" | undefined;   // why fewer alternatives than asked (exact-solver.mts's AltShortfall)
  solver?: string | undefined;
  bound?: number | null | undefined;
  gapPoints?: number | null | undefined;
  mipMs?: number | undefined;
  heuristicMs?: number | undefined;
  unreachableFloors?: string[] | undefined;
  fallbackReason?: string | undefined;
  floorsConflict?: boolean | undefined;
}
// SolveProgress (app/exact-solver.mts) as reported over the job's SSE stream and read by
// builder.mts's runPanel(). Every field but `phase` is optional — not every phase reports every one.
export interface OptimizeProgress {
  phase: string;
  elapsedMs?: number | undefined;
  restartsDone?: number | undefined;
  restarts?: number | undefined;
  nodes?: number | undefined;
  candidates?: number | undefined;
  budgetMs?: number | undefined;
  improvements?: number | undefined;
  lastImprovementMs?: number | undefined;
  bestScore?: number | null | undefined;
  currentScore?: number | undefined;
  floorsMet?: number | undefined;
  floorsTotal?: number | undefined;
  gapPoints?: number | null | undefined;
  found?: number | undefined;
  wanted?: number | undefined;
}
// POST /api/optimize's start response — the non-cached branch (a fresh job) and the cached branch
// (`cached: true`, carrying the reused SavedRunLike straight away) share every field but the ones
// only one side sends.
export interface OptimizeStartApiResponse {
  ok: boolean;
  id?: string | undefined;
  warmFrom?: string | null | undefined;
  superseded?: string | null | undefined;
  warning?: string | undefined;
  poolSize: number;
  skipped: Record<string, number>;
  current: OptSuit;
  blocked: string[];
  cached?: boolean | undefined;
  run?: SavedRunLike | undefined;
}
export interface OptimizeCancelApiResponse {
  ok: boolean;
  state: string;
}
// A saved run as the server persists and returns it — mirrors app/runs-lib.mts's SavedRun, with the
// loosely-shaped fields (settings, result) narrowed to what this page actually reads off them.
export interface SavedRunLike {
  id: string;
  key?: string | undefined;
  character?: string | undefined;
  createdAt: string;
  label: string;
  settings: RunSettings;
  inventoryStamp?: unknown;
  poolSize: number | null;
  skipped?: unknown;
  ms: number | null;
  explored?: unknown;
  result: OptimizeResult;
}
// GET /api/runs — mirrors app/runs-lib.mts's RunSummary: a SavedRunLike's fields, flattened with the
// few extras (proven/score/currentScore/delta/method/nodes) runs.mts's rows read directly off the
// summary rather than through `.result`.
export interface RunSummaryLike {
  id: string;
  character?: string | undefined;
  createdAt: string;
  label: string;
  settings: RunSettings;
  inventoryStamp?: unknown;
  poolSize: number | null;
  ms: number | null;
  method: string | null;
  proven: boolean | null;
  score: number | null;
  currentScore: number | null;
  delta: number | null;
  nodes: number | null;
  changes?: number | null | undefined;                      // absent from a server older than the drawer's badges
  totalsAfter?: Record<string, number> | null | undefined;
}
export interface RunsListApiResponse {
  ok: boolean;
  runs: RunSummaryLike[];
}
export interface RunApiResponse {
  ok: boolean;
  run: SavedRunLike;
  error?: string | undefined;
}
export interface RunPutApiResponse {
  ok: boolean;
  run: RunSummaryLike;
}

// SSE payloads (POST /api/optimize's job stream, JSON.parse()'d from MessageEvent.data by
// builder.mts) — mirror vault-server.mts's jobSnapshot()/finish() literals.
export interface JobSnapshotEvent {
  id: string;
  state: string;
  progress: OptimizeProgress | null;
  result: OptimizeResult | null;
  ms: number | null;
  error: string | null;
  runId: string | null;
}
export interface JobDoneEvent {
  result: OptimizeResult;
  ms: number;
  runId: string | null;
}
export interface JobFailedEvent {
  error: string;
}
export interface JobCancelledEvent {
  ms: number;
}

// ---------------------------------------------------------------- bridge

// GET /api/bridge/status — mirrors app/schema/types.d.mts's BridgeV1Status (the file on disk) plus
// the `online`/`age` fields vault-server.mts computes on top of it, spread together
// (`{ok:true, online, age, ...st}`). Declared fresh rather than reusing BridgeV1Status directly: that
// type's `current`/`results` stay Record<string, unknown> (the schema itself leaves them open), but
// bridge.mts reads named fields off both (`current.action`/`current.name`, `results[id].ok/.msg`) —
// narrowing them here, at the one place the response is parsed, is what lets bridge.mts read those
// fields without its own casts.
export interface BridgeCurrentCommand {
  id?: string | undefined;           // the running command's id (a trip's, while Organize waits on it)
  action?: string | undefined;
  name?: string | undefined;
}
// One step of a trip's result (the bridge's trip action: every take and put it tried, in order).
export interface TripStepResult { op: "take" | "put"; serial: number; ok: boolean; msg: string; ms?: number | undefined }
export interface BridgeResultEntry {
  ok: boolean;
  msg: string;
  t?: string | undefined;
  partial?: boolean | undefined;     // a trip whose take phase ended early (too heavy or too full)
  stopped?: boolean | undefined;     // a trip halted by the stop flag (POST /api/bridge/stop)
  steps?: TripStepResult[] | undefined;
  ms?: number | undefined;           // how long a trip took, in milliseconds (TazUO 2.9.0 onward)
}
export interface BridgeStatusApiResponse {
  ok: boolean;
  online: boolean;
  character?: string | undefined;
  current?: BridgeCurrentCommand | null | undefined;
  results?: Record<string, BridgeResultEntry> | undefined;
}
export interface BridgeQueueApiResponse {
  ok: boolean;
  id: string;
}

// ---------------------------------------------------------------- organize (issue #11)
// The setup's types come straight from app/organize-config.mts: unlike the modules listed at the top of this
// file it is pure and imports only item-query.mts's and vault-lib.mts's types, so the browser build type-checks
// it. The plan's types are mirrored from app/organize.mts, which imports server-only code (bridge-trip.mts).
export type { OrganizeConfig, ContainerLabel, OrganizeRule, RuleMatch, Origin, Build } from "../organize-config.mts";
export type { SpellSchool } from "../vault-lib.mts";
export type PlanWarningKind = "stale-container" | "missing-target" | "missing-label" | "unknown-capacity" | "old-scripts" | "blacklisted" | "no-position" | "not-ground" | "nearly-full";
export interface PlanWarning { kind: PlanWarningKind; serial: number; detail: string }
export interface PlanMove { serial: number; name: string; amount: number; from: number | null; to: number; ruleId: string; alsoMatched: string[]; trip: number }
export interface PlanTrip { index: number; site: number; takes: number[]; puts: number[] }
export interface PlanRuleReport { ruleId: string; matched: number; inPlace: number; toMove: number; noRoom: number }
export interface PlanRoomReport { ruleId: string; needSlots: number; freeSlots: number; shortfall: number }
export interface OrganizePlan {
  inventoryStamp: string;
  stamp: string;                     // the plan's identity; POST /api/organize/trip refuses any other
  sites: { index: number; roots: number[] }[];
  moves: PlanMove[];                 // in trip order; from null = carried in the backpack
  trips: PlanTrip[];                 // index 1-based; the first trip of each site is the only one the server runs
  rules: PlanRuleReport[];           // one per rule in rule order, then "catch-all" and "empty-bags" when set
  room: PlanRoomReport[];
  crossSite: { ruleId: string; count: number }[];
  warnings: PlanWarning[];
  carried: { serial: number; name: string }[];
  unclaimed: number;
  seconds: number;                   // about how long the trips take (app/organize.mts's tripSeconds), whole seconds
  emptyBags: { serial: number; name: string; container: number }[];   // not yet in the gather container
}
export interface OrganizePreset { id: string; name: string; match: RuleMatch }
export interface OrganizeApiResponse { ok: boolean; config: OrganizeConfig; problems: string[] }
// `running`: the trip the server has queued and not heard back about (`picked` = its bridge is running it now).
export interface OrganizeRunningTrip { id: string; index: number; queuedAt: string; picked: boolean }
export interface OrganizePlanApiResponse { ok: boolean; plan: OrganizePlan; running: OrganizeRunningTrip | null }
export interface OrganizePresetsApiResponse { ok: boolean; presets: OrganizePreset[] }
export interface OrganizeTripApiResponse { ok: boolean; id: string; index: number }
// POST /api/organize/match: what one rule filter takes of the movable items in labelled roots (app/organize.mts's matchCount).
export interface OrganizeMatchApiResponse { ok: boolean; count: number; pieces: number; sample: string[] }
// POST /api/organize/propose (Auto organize): mirrored from app/organize-strategies.mts, which is server-only.
export type AutoStrategy = "simple" | "detailed" | "build";
export interface ProposalCandidate { serial: number; name: string; site: number; fill: { items: number; max: number }; label: { name: string; origin: Origin } | null; mine: boolean; ticked: boolean }
export interface ProposalGroup { key: string; name: string; family: string; ruleIds: string[]; items: number; needSlots: number; targets: number[]; bagIn: number | null; needsBag: boolean; roomSlots: number; shortfall: number; addContainers: number; crossSite: number }
// Issue #132: what the full layout needs beyond what the player has (chest null: one of the chests to add); roomy:
// the proposal leaves chests 20% free where filling them to the top would have used other chests.
export interface ProposalLayout { chests: number; bags: { chest: number | null; family: string; bags: number }[]; spareBags: number; roomy: boolean }
export interface OrganizeProposal {
  strategy: AutoStrategy;
  candidates: ProposalCandidate[];
  unusable: { serial: number; name: string; reason: string }[];
  containers: number[];
  refused: { serial: number; reason: string }[];
  groups: ProposalGroup[];
  unassigned: number;
  layout: ProposalLayout;
  manualRules: number;
  config: OrganizeConfig;            // the whole setup Accept saves with PUT /api/organize
  changed: boolean;
  plan: { moves: number; trips: number; noRoom: number; crossSite: number; unclaimed: number; seconds: number };
}
export interface OrganizeProposeApiResponse { ok: boolean; proposal: OrganizeProposal }

// SSE payloads on the shared /api/events stream (ui/events.mts) — mirror vault-server.mts's
// broadcastEvent("inventory", …) / broadcastEvent("rejected", …) literals (app/watcher.mts's
// onAccepted/onRejected info plus an `at` timestamp).
export interface InventoryEvent {
  file: string;
  character: string;
  scannedAt: string;
  at: number;
}
export interface RejectedEvent {
  file: string;
  reason: string;
  at: number;
}
// broadcastEvent("changed", …): a forget / forget-character or an Organize trip reporting back ("inventory"), or a
// run deletion ("runs") — every tab reloads that data.
export interface ChangedEvent {
  what: "inventory" | "runs";
  by?: string;   // an inventory change's x-client-id: the tab that made it has already reloaded
  at: number;
}

// ---------------------------------------------------------------- errors

// Every api.mts throw carries a real Error with these two extra fields attached — see api.mts's own
// comment. Callers that branch on `.status`/`.code` (rather than just `.message`) narrow through this.
export interface ApiError extends Error {
  status?: number | undefined;
  code?: unknown;
}

// ---------------------------------------------------------------- house map (issue #10)
// Mirrored from app/house-model.mts (HouseModel and its parts) and the GET /api/houses routes in app/vault-server.mts:
// house-model.mts imports app/tiledata.mts (node:fs), so the browser build cannot even import its types.
export type MaterialFamily = "stone" | "brick" | "plaster" | "wood" | "marble" | "sandstone" | "dirt" | "grass" | "water" | "tile" | "neutral";
export interface Level { index: number; name: string; floorZ: number; status: "built" | "floor-only" }
export type CellKind = "floor" | "wall" | "window" | "stair" | "roof";
export interface Cell { level: number; x: number; y: number; kind: CellKind; material: string; family: MaterialFamily; z: number; lip: boolean; indoor: boolean; doorway: boolean }
export interface Furniture { serial: number; kind: "block" | "door" | "teleporter"; name: string; level: number; x: number; y: number; z: number; height: number }
// serials and zs bottom first; codes[serial] is the engraving code ("C3", or "C" alone for a single chest).
export interface Stack { level: number; x: number; y: number; serials: number[]; zs: number[]; spot: number | null; direction: string; letter: string }
export interface Spot { id: number; level: number; x: number; y: number; teleporter: boolean }
export interface HouseModel {
  id: string; facet: number | null; capturedAt: string; captures: number; x0: number; y0: number; x1: number; y1: number;
  levels: Level[]; cells: Cell[]; furniture: Furniture[]; stacks: Stack[]; spots: Spot[]; codes: Record<string, string>; tiledata: boolean;
  unopened: number[]; unopenedNames: Record<string, string>;   // the stacked chests no scan has opened, and their tiledata names
  name?: string | undefined;   // the player's name for the house (house-map.json, issue #164), when it has one
}
// Where tiledata.mul came from (the uoFolder setting, or TazUO's launcher profile), or why there is none.
export interface TiledataFrom { folder: string | null; source: "settings" | "tazuo-profile" | null; reason: null | "override-missing" | "no-client" | "no-tazuo-profile" | "unreadable" }
// GET /api/houses
// width, height and plot are the plot, without a row of front steps outside it (house-model.mts plotBounds).
export interface HouseSummary { id: string; name?: string | undefined; facet: number | null; capturedAt: string; captures: number; width: number; height: number; plot: { x0: number; y0: number; x1: number; y1: number }; levels: number; containers: number; serials: number[] }
// GET /api/facet-map/<facet>.png answers a PNG, or a 404 with why there is none: no UO folder (as TiledataFrom), or the facet file missing or not a facet bitmap.
export type FacetMapReason = "override-missing" | "no-client" | "no-tazuo-profile" | "missing" | "unreadable";
export interface HousesApiResponse { ok: boolean; tiledata: boolean; tiledataFrom: TiledataFrom; houses: HouseSummary[] }
// GET /api/houses/<id>
export interface HouseApiResponse { ok: boolean; house: HouseModel }
// GET /api/house-map and PUT /api/house-map/<id> (app/house-names.mts, issues #164 and #10): the player's names and drawn
// areas by house id, each with the footprint the house had when it was named or its areas drawn. `name` is "" for a house
// with areas but no name. Other fields an entry or an area may carry later are kept, unread.
export interface HouseBounds { x0: number; y0: number; x1: number; y1: number; facet: number | null }
// World tiles, inclusive.
export interface AreaRect { x0: number; y0: number; x1: number; y1: number }
// `color` is a token name, "area-1" … "area-8" (--color-area-N).
export interface HouseArea { id: string; name: string; level: number; color: string; rects: AreaRect[] }
export interface HouseMapEntry { name: string; bounds?: HouseBounds | undefined; areas?: HouseArea[] | undefined }
export interface HouseMapApiResponse { ok: boolean; houses: Record<string, HouseMapEntry> }
export interface HouseMapPutApiResponse { ok: boolean; entry: HouseMapEntry | null }
