// ui/api-types.mts — every response shape the page reads off its own fetches: the house, Organize and saved-run shapes re-exported from the types-only modules (runs narrowed), the settings and setup shapes from app/api/setup.mts the inventory shapes from app/api/inventory.mts and the bridge's from app/api/bridge.mts, the rest declared here. api.mts's `api()` call
// returns `unknown` at the boundary (Response.json() is genuinely unvalidated network input); every
// caller narrows through one of the types below rather than sprinkling `as Whatever` at each read
// site, per the migration plan's "type each endpoint's response in ONE place."
//
// A server-side module may be imported here, type or value, when it and everything it imports is browser-safe (no node: import anywhere in that chain), as the imports below are. One that reaches a node: module cannot be imported even for a type: the browser build (tsconfig.browser.json) type-checks with `"types": []`, a type-only import is erased only at emit time, and the imported file still has to type-check. So a server shape the page reads lives in a types-only module next to its owner (app/house-model-types.mts, app/organize-types.mts, app/runs-types.mts): the owner re-exports it, the server annotates its response with `satisfies`, and this file re-exports it (or narrows it with a mapped type), so a renamed field fails the typecheck on both sides. Never the other way around: nothing outside app/ui/ imports from app/ui/.
//
// What is still declared here by hand: the rest of the shapes below whose owners reach node: (app/exact-solver.mts, scripts/optimizer-core.mts, app/vault-server.mts). Each names the server-side type or route it mirrors, so a change on one side has somewhere obvious to update on the other. Nothing here is validated against the wire (HTTP responses are unvalidated network input, same trust level server.test.mts's own per-route interfaces document); it gives the page's own reads a name instead of `unknown`.
//
// map: ui-infra
// owns: the hand-declared `*ApiResponse` types
import type { OptItem, RunSettings, KindOverrides } from "../vault-lib.mts";
import type { ProfilesV3, TemplateMap } from "../build-spec.mts";
import type { AutostartOutcome, Hotkey as PanelHotkey, PanelPrefs } from "../tazuo-panel-prefs.mts";
import type { OrganizeConfig, RuleMatch } from "../organize-config.mts";
import type { Diagnostic, RunBody, RunsListBody, RunSummary, SavedRun, ScoreShare, SwingResult } from "../runs-types.mts";
import type { HouseApiResponse } from "../house-model-types.mts";

// ---------------------------------------------------------------- shared fragments

// A scanned character's skills map (Character.skills, vault-lib.mts) is declared as a loose
// Record<string, unknown> there on purpose (the scan schema leaves per-skill shape open) — this is
// what a real entry actually holds, read at the boundary by sheet.mts/characters.mts the same way
// vault-lib.mts's own resistMinimum() already casts one skill entry (`as { value?: number }`).
export interface SkillEntry {
  value: number;
  cap: number;
}

// The settings and setup routes' shapes (settings.json, the rules, the wizard, the update check) come from app/api/setup.mts.
export type { ClientSettings as ClientSetting, Retention as RetentionSetting, SettingsData, SettingsApiResponse, CleanupApiResponse, ShardOption, RulesApiResponse,
  AdapterSummary, InstalledVersionInfo, DataDirCheckInfo, SetupApiResponse, PasteScannerApiResponse, LocateApiResponse, InstallApiResponse, UpdateCheckApiResponse } from "../api/setup.mts";

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

// ---------------------------------------------------------------- inventory / items

// The inventory routes' shapes come from app/api/inventory.mts.
export type { InventoryData, InventoryApiResponse, MissingApiResponse, ItemsApiResponse, ItemHitsApiResponse, ItemsBySerialApiResponse } from "../api/inventory.mts";

export interface ProfilesApiResponse {
  ok: boolean;
  profiles: ProfilesV3;
  stamp: string;   // the file's content stamp, which a PATCH's `was` is compared with
  builtinTemplates: TemplateMap;   // the shard's built-in templates, read-only (app/data/templates/<shard>.json)
  readOnly?: string;   // why profiles.json cannot be saved, when a newer Pack Rat made it (app/migrate.mts)
}

// ---------------------------------------------------------------- setup / wizard / adapters

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
export type { HostPickFolderApiResponse } from "../api/host.mts";

// ---------------------------------------------------------------- import

export type { ImportPasteApiResponse, RescanApiResponse } from "../api/import.mts";
// POST /api/forget and /api/forget-character, and GET /api/blacklist: app/api/inventory.mts.
export type { ForgetApiResponse, BlacklistApiResponse } from "../api/inventory.mts";
// GET and POST /api/item-kinds, POST /api/item-kinds/import (issue #150): the whole item-kinds.json document after
// the change; an import also says how many entries it left out and why (the first few).
// `readOnly` (GET): why the file cannot be changed, when a newer Pack Rat made it (app/migrate.mts).
export interface ItemKindsApiResponse extends KindOverrides { ok: boolean; version: 1; skipped?: number; problems?: string[]; readOnly?: string }

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
  alternatives?: Array<{ best: OptSuit; score: number; shares?: ScoreShare[] | undefined }> | undefined;
  altTolerance?: number | undefined;
  altShortfall?: "budget" | "tolerance" | "exhausted" | "unequal" | undefined;   // why fewer alternatives than asked (exact-solver.mts's AltShortfall)
  solver?: string | undefined;
  bound?: number | null | undefined;
  gapPoints?: number | null | undefined;
  mipMs?: number | undefined;
  heuristicMs?: number | undefined;
  unreachableFloors?: string[] | undefined;
  fallbackReason?: string | undefined;
  floorsConflict?: boolean | undefined;
  diagnostics?: Diagnostic[] | undefined;   // absent on a run saved before SOLVER_VERSION 6: unreachableFloors is drawn instead
  swing?: SwingResult | undefined;          // the suit's swing (app/swing.mts), when it holds a weapon with a known speed and the build has a character
  tieBreak?: TieBreakResult | undefined;    // a rarity preference's or fewest changes' outcome (app/exact-solver.mts TieBreakResult)
  strict?: StrictResult | undefined;        // a strict-order build's stages (app/exact-solver.mts StrictResult)
  shares?: ScoreShare[] | undefined;        // what made up the suit's score (app/diagnostics.mts scoreShares); absent on a run saved before issue #273
}
// A tie-break's outcome: the best score found, the returned suit's rarity points, the preference and tolerance, with fewest changes how many slots it changes, and whether that is proven the lowest (exact search only).
export interface TieBreakResult { topScore: number; cost: number; changes?: number | undefined; rarity?: string | undefined; fewestChanges?: boolean | undefined; tolerance?: number | undefined; costProven?: boolean | undefined }
// A strict-order build's stages, each with the suit's value there, and how many are proven in order.
export interface StrictResult { stages: Array<{ kind: string; keys: string[] | null; value: number }>; proven: number; changes?: number | undefined }
// SolveProgress (app/exact-solver.mts) as reported over the job's SSE stream and read by
// builder-job.mts's runPanel(). Every field but `phase` is optional — not every phase reports every one.
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
  stage?: { at: number; of: number; kind: string; keys: string[] | null } | undefined;   // strict order: the stage being solved, from 1, and what it scores
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
  diagnostics?: Diagnostic[] | undefined;   // the requirements no suit in the pool can reach, before the search starts
}
export interface OptimizeCancelApiResponse {
  ok: boolean;
  state: string;
}
// The page's view of a saved run (app/runs-types.mts). The server's types are loose because it parses whatever run files are on disk; every run the server writes (vault-server.mts saveRun, runs-lib.mts manualRun) has an id, a createdAt, a label ("" until renamed), a poolSize and an ms, so the page reads those as present (Settled). Loose: optional here.
type Settled<T, K extends keyof T> = { [P in K]-?: Exclude<T[P], undefined> };
type Loose<T, K extends keyof T> = { [P in K]?: T[P] | undefined };
// A saved run as GET /api/runs/<id> returns it, with the loosely-shaped fields (settings, result) narrowed to what this page actually reads off them.
export type SavedRunLike = Settled<SavedRun, "id" | "createdAt" | "label" | "poolSize" | "ms"> & Loose<SavedRun, "key" | "character" | "inventoryStamp" | "skipped" | "explored"> & {
  settings: RunSettings;
  result: OptimizeResult;
};
// GET /api/runs — a run's summary: a SavedRunLike's fields, flattened with the few extras (proven/score/currentScore/delta/method/nodes) runs.mts's rows read directly off the summary rather than through `.result`. changes and totalsAfter are absent from a server older than the drawer's badges.
export type RunSummaryLike = Settled<RunSummary, "id" | "createdAt" | "label" | "poolSize" | "ms" | "method" | "proven" | "score" | "currentScore" | "delta" | "nodes">
  & Loose<RunSummary, "character" | "inventoryStamp" | "changes" | "totalsAfter"> & { settings: RunSettings };
export type RunsListApiResponse = RunsListBody<RunSummaryLike>;
export type RunApiResponse = RunBody<SavedRunLike> & { error?: string | undefined };
export type RunPutApiResponse = RunBody<RunSummaryLike>;

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
// The bridge routes' shapes come from app/api/bridge.mts.
export type { BridgeCurrentCommand, TripStepResult, BridgeResultEntry, BridgeAdapterReport, BridgeStatusApiResponse, BridgeQueueApiResponse } from "../api/bridge.mts";

// ---------------------------------------------------------------- organize (issue #11)
// The setup's types come straight from app/organize-config.mts: unlike the modules listed at the top of this
// file it is pure and imports only item-query.mts's and vault-lib.mts's types, so the browser build type-checks
// it. The plan's and the proposal's types come from app/organize-types.mts (organize.mts and organize-strategies.mts import server-only code).
export type { OrganizeConfig, ContainerLabel, OrganizeRule, RuleMatch, Origin, Build } from "../organize-config.mts";
export type { SpellSchool } from "../vault-lib.mts";
export type {
  WarningKind as PlanWarningKind, PlanWarning, PlanMove, PlanTrip, RuleReport as PlanRuleReport, RoomReport as PlanRoomReport, Plan as OrganizePlan,
  OrganizeRunningTrip, OrganizePlanApiResponse,
  StrategyId as AutoStrategy, Candidate as ProposalCandidate, GroupReport as ProposalGroup, Layout as ProposalLayout, Proposal as OrganizeProposal, OrganizeProposeApiResponse,
} from "../organize-types.mts";
export interface OrganizePreset { id: string; name: string; match: RuleMatch }
// stamp: the saved setup's, which PUT takes back as `base`; a setup saved elsewhere since is refused (409, code "stale").
export interface OrganizeApiResponse { ok: boolean; config: OrganizeConfig; problems: string[]; readOnly?: string; stamp: string }
export interface OrganizePutApiResponse { ok: boolean; stamp: string }
export interface OrganizePresetsApiResponse { ok: boolean; presets: OrganizePreset[] }
export interface OrganizeTripApiResponse { ok: boolean; id: string; index: number }
// Move to (issue #270, app/move.mts). POST /api/move/plan: the selection's count, its worn items, how many of it sit directly in
// each container, and with `to` the plan into that container (or why it cannot be filled); with `back`, Move back's count.
export interface MovePlanSummary { moving: number; serials: number[]; trips: number; already: number; noRoom: number; left: Partial<Record<"gone" | "worn" | "pack" | "bag" | "unreachable" | "site", number>>; against: Array<{ serial: number; name: string; target: number }> }
export interface MovePlanApiResponse { ok: boolean; selected: number; worn: number; wornNames: string[]; movable: number; here: Record<string, number>; left: MovePlanSummary["left"]; problem?: string | null; plan?: MovePlanSummary | null }
export interface MoveBackApiResponse { ok: boolean; back: { movable: number; skipped: string[] } }
// POST /api/move/trip: the trip queued (`id` null when nothing is left to move), its items' names, the moves left counting it.
export interface MoveTripApiResponse { ok: boolean; id: string | null; index?: number; names?: Record<string, string>; remaining: number; skipped: Array<{ serial: number; name: string }>; noRoom: Array<{ serial: number; name: string }> }
// POST /api/organize/match: what one rule filter takes of the movable items in labelled roots (app/organize.mts's matchCount).
export interface OrganizeMatchApiResponse { ok: boolean; count: number; pieces: number; sample: string[] }

// SSE payloads on the shared /api/events stream (ui/events.mts) — mirror the server's
// eventBus.broadcast("inventory", …) / eventBus.broadcast("rejected", …) literals (app/services/events.mts) (app/watcher.mts's
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
// eventBus.broadcast("changed", …): a forget / forget-character, or an Organize trip reporting back ("inventory"), an Organize
// setup save (PUT /api/organize, "organize": the tabs reload the setup only), or a run deletion ("runs") — every tab reloads that data.
export interface ChangedEvent {
  what: "inventory" | "organize" | "runs";
  by?: string;   // an inventory or Organize change's x-client-id: the tab that made it has already reloaded
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
// The house model and the GET /api/houses responses come from app/house-model-types.mts (house-model.mts imports app/tiledata.mts, which uses node:fs). HouseModel is the model as GET /api/houses/<id> answers it, with the player's name for the house (house-map.json, issue #164) when it has one.
export type { MaterialFamily, Level, CellKind, Cell, Furniture, Stack, Spot, TiledataFrom, HouseSummary, HousesApiResponse, HouseApiResponse } from "../house-model-types.mts";
export type HouseModel = HouseApiResponse["house"];
// GET /api/facet-map/<facet>.png answers a PNG, or a 404 with why there is none: no UO folder (as TiledataFrom), or the facet file missing or not a facet bitmap.
export type FacetMapReason = "override-missing" | "no-client" | "no-tazuo-profile" | "missing" | "unreadable";
// GET /api/house-map, PUT /api/house-map/<id> and GET /api/house-claims: app/house-model-types.mts.
export type { HouseBounds, AreaRect, HouseArea, HouseEntry as HouseMapEntry, HouseMapApiResponse, HouseMapPutApiResponse, HouseClaimsApiResponse } from "../house-model-types.mts";
