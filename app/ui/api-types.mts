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
import type { RunSettings } from "../vault-lib.mts";
import type { AutostartOutcome, Hotkey as PanelHotkey, PanelPrefs } from "../tazuo-panel-prefs.mts";
import type { RunBody, RunsListBody, RunSummary, SavedRun } from "../runs-types.mts";
import type { HouseApiResponse } from "../house-model-types.mts";
import type { OptimizeResult as SharedOptimizeResult, OptimizeStartApiResponse as SharedOptimizeStartApiResponse, SolveProgress, Suit } from "../api/optimize.mts";

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

// GET/PUT /api/ui-prefs, GET/PATCH /api/profiles and GET/PUT /api/tazuo-panel: app/api/prefs.mts.
export type { UiPrefs, UiPrefsApiResponse, ProfilesApiResponse, ProfilesPatchApiResponse, TazuoPanelApiResponse } from "../api/prefs.mts";

// ---------------------------------------------------------------- inventory / items

// The inventory routes' shapes come from app/api/inventory.mts.
export type { InventoryData, InventoryApiResponse, MissingApiResponse, ItemsApiResponse, ItemHitsApiResponse, ItemsBySerialApiResponse } from "../api/inventory.mts";


// ---------------------------------------------------------------- setup / wizard / adapters

// The TazUO panel (app/tazuo-panel-prefs.mts): GET/PUT /api/tazuo-panel, and POST /api/setup/install's `panel`.
export type { AutostartOutcome, PanelHotkey, PanelPrefs };
export type { McpApiResponse } from "../api/mcp.mts";
export type { HostPickFolderApiResponse } from "../api/host.mts";

// ---------------------------------------------------------------- import

export type { ImportPasteApiResponse, RescanApiResponse } from "../api/import.mts";
// POST /api/forget and /api/forget-character, and GET /api/blacklist: app/api/inventory.mts.
export type { ForgetApiResponse, BlacklistApiResponse } from "../api/inventory.mts";
export type { ItemKindsApiResponse } from "../api/kinds.mts";
export type { PaperdollOptionsApiResponse, CreationRace, Swatch, HairStyle } from "../api/paperdoll.mts";

// ---------------------------------------------------------------- suit builder: optimize / runs

// What a build answers (app/api/optimize.mts), under the names the page has always used. A suit (OptSuit) is a slot to a
// candidate item, or null: result.best, result.alternatives[].best and POST /api/optimize's `current`.
export type { SlotChange, TieBreakResult, StrictResult, OptimizeCancelApiResponse } from "../api/optimize.mts";
export type OptSuit = Suit;
export type OptimizeResult = SharedOptimizeResult;
export type OptimizeProgress = SolveProgress;
// POST /api/optimize's start response, its cached branch carrying the saved run as the page reads it.
export type OptimizeStartApiResponse = SharedOptimizeStartApiResponse<SavedRunLike>;
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

// SSE payloads (POST /api/optimize's job stream, JSON.parse()'d from MessageEvent.data by builder-job.mts).
export type { JobSnapshot as JobSnapshotEvent, JobDoneEvent, JobFailedEvent, JobCancelledEvent } from "../api/optimize.mts";

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
// The rest of the Organize and Move to routes' answers: app/organize-types.mts too.
export type { OrganizePreset, OrganizeApiResponse, OrganizePutApiResponse, OrganizePresetsApiResponse, OrganizeTripApiResponse, MovePlanSummary, MovePlanApiResponse, MoveBackApiResponse, MoveTripApiResponse, OrganizeMatchApiResponse } from "../organize-types.mts";

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
