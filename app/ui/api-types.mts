// ui/api-types.mts — response shapes the page reads off its own fetches. api.mts's `api()` call
// returns `unknown` at the boundary (Response.json() is genuinely unvalidated network input); every
// caller narrows through one of the types below rather than sprinkling `as Whatever` at each read
// site, per the migration plan's "type each endpoint's response in ONE place."
//
// These are declared fresh here, NOT imported from the server-side modules that define the "real"
// shape (app/installer.mts, app/runs-lib.mts, app/exact-solver.mts, scripts/optimizer-core.mts,
// app/vault-server.mts) — every one of those imports a node: module or another file that does, and
// this project's browser build (tsconfig.browser.json) type-checks with `"types": []`. A type-only
// import is erased at EMIT time, but the imported file still has to type-check to be resolved at all,
// and resolving e.g. app/runs-lib.mts (`import { createHash } from "node:crypto"`) under `types: []`
// fails with "Cannot find name 'node:crypto'" — verified directly against tsconfig.browser.json before
// writing this file (`npx tsc -p tsconfig.browser.json` against a throwaway `import type { RunSummary }
// from "../runs-lib.mts"` file). Each interface below names the server-side type/route it mirrors, so a
// change on one side has somewhere obvious to update on the other; nothing here is validated against
// the wire (HTTP responses are unvalidated network input, same trust level server.test.mts's own
// per-route interfaces document), it just gives the page's own reads a name instead of `unknown`.
import type { Item, Container, Character, ScanSummary, OptItem, RunSettings, ProfilesFile } from "../vault-lib.mts";
import type { Facets, ItemQueryRows, ItemQueryGroups } from "../item-query.mts";
import type { RulesV1 } from "../schema/types.d.mts";

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
export interface SettingsData {
  shard: string;
  setupDone?: boolean | undefined;
  client?: ClientSetting | null | undefined;
}
export interface SettingsApiResponse {
  ok: boolean;
  settings: SettingsData;
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
}
export interface LocateApiResponse {
  ok: boolean;
  scriptsDir: string;
  installed: InstalledVersionInfo;
}
// POST /api/setup/install — mirrors app/installer.mts's InstallScriptsResult's `ok: true` branch (the
// `ok: false` branch never reaches the page as a parsed success value; api.mts throws on a non-2xx
// response instead, so callers read that through the thrown Error, not this type).
export interface InstallApiResponse {
  ok: boolean;
  installed: string[];
  version: string | null;
}
export interface HostPickFolderApiResponse {
  ok: boolean;
  path: string | null;
}

// GET /api/update-check — mirrors app/installer.mts's CheckForUpdatesResult. `url` stays `unknown` ON
// PURPOSE: it is GitHub's `html_url`, forwarded unchecked by checkForUpdates() (see that file's own
// comment) — nothing here establishes it is even a string, let alone an http(s) URL. Whoever renders
// it (ui/settings.mts) casts at that one site with its own comment pointing at the security review;
// this type must not narrow it for them.
export interface UpdateCheckApiResponse {
  configured: boolean;
  error?: string | undefined;
  current?: string | undefined;
  latest?: string | undefined;
  url?: unknown;
  upToDate?: boolean | undefined;
}

// ---------------------------------------------------------------- import

export interface ImportApiResponse {
  ok: boolean;
  copied: number;
  skipped: number;
}
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
export interface ForgetApiResponse {
  ok: boolean;
}

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
  action?: string | undefined;
  name?: string | undefined;
}
export interface BridgeResultEntry {
  ok: boolean;
  msg: string;
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

// ---------------------------------------------------------------- errors

// Every api.mts throw carries a real Error with these two extra fields attached — see api.mts's own
// comment. Callers that branch on `.status`/`.code` (rather than just `.message`) narrow through this.
export interface ApiError extends Error {
  status?: number | undefined;
  code?: unknown;
}
