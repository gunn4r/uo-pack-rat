// ui/store.mts — the shared mutable state object, the bridge connection state, and invStamp.
// Moved verbatim out of index.html's inline <script type="module"> (Task 4, the page split).
import type { Item, EffectiveProfile } from "../vault-lib.mts";
import type { FlatProfile, ProfilesV3, TemplateMap } from "../build-spec.mts";
import type { Facets } from "../item-query.mts";
import type { RulesV1 } from "../schema/types.d.mts";
import type { BridgeAdapterReport, InventoryData, SettingsData, ShardOption, SetupApiResponse, OptSuit, OptimizeResult, OptimizeProgress, SavedRunLike, OrganizeConfig, OrganizePlan, OrganizePreset } from "./api-types.mts";

// The suit builder's own working copy of a character's settings: the flat profile app/build-spec.mts's
// characterProfile hands out (a saved character's spec, or the first template applied), with its race and template.
// Every collection field starts absent on a freshly-applied template and is filled in by `||=`/`??=`
// at first read (numGrid, renderProfile, readControls) — declared optional here to match, not
// required-and-then-immediately-defaulted.
export type BuilderProfile = FlatProfile;

// The suit builder's live-progress UI object (builder.mts's runPanel() return value) — kept here,
// next to BuilderJob, since it's part of what the builder session's job (builder-session.mts) actually holds.
export interface BuilderJobUi {
  root: HTMLElement;
  update: (j: BuilderJob) => void;
  tick: (j: BuilderJob) => void;
  cancelling: () => void;
}
// One in-flight (or just-finished) optimize job, as builder.mts's runBuild() builds and mutates it.
// Not server state — this is the page's own bookkeeping around the SSE stream at
// /api/optimize/<id>/events, rebuilt fresh for every "Build best suit" click.
export interface BuilderJob {
  id: string | null;
  es: EventSource | null;
  name: string;
  profile: EffectiveProfile;   // the effective profile the build was started with, for judging its result
  exact: boolean;
  budgetMs: number;
  poolSize: number | null;
  skipped: Record<string, unknown>;
  current: OptSuit;
  warning: string | null;
  startedAt: number;
  lastProgressAt: number;
  lastServerAt: number;
  last: OptimizeProgress | null;
  connected: boolean;
  ui: BuilderJobUi | null;
  // `number`, not `ReturnType<typeof setInterval>` — dom.mts's toastTimer explains why: this page
  // only ever runs in the browser (setInterval returns a number there), but tsconfig.json's root
  // config also type-checks this file alongside Node's ambient globals, which makes
  // `typeof setInterval` ambiguous between the two configs.
  timer: number | null;
  // Set once, the first time the exact phase's progress is seen (`j.exactStartMs ??= p.elapsedMs`,
  // builder.mts's runPanel) — absent for the whole heuristic phase and for a job that never goes exact.
  exactStartMs?: number | undefined;
}
// A finished build and everything needed to draw it for the character it was built for.
export interface FinishedBuild {
  name: string;
  result: OptimizeResult;
  current: OptSuit;
  profile: EffectiveProfile;
  runId: string | null;
  meta?: BuildMeta | undefined;   // what the result's Solver details disclosure reports
}
// How a result was found, for its Solver details: time, pool size, what the pool left out, and the saved
// run it reused when the server answered from one.
export interface BuildMeta {
  ms: number;
  poolSize: number | null;
  skipped: Record<string, unknown> | undefined;
  reused: SavedRunLike | null;
}
export interface BridgeState {
  online: boolean;
  character: string | null;
  // The running bridge's report of itself (status.json's adapter), null from an older bridge.
  adapter: BridgeAdapterReport | null;
  seen: Set<string>;
  pending: Map<string, string>;
}
// The page's copy of the Organize setup (issue #11; ui/organize-data.mts keeps it): GET /api/organize's config
// and the problems its salvage reported, the blacklisted serials (never labelled), every location text inside a
// labelled container mapped to the same path by label (dom.mts's whereText), the last plan, and the presets
// (fetched once, when the rule editor first opens).
export interface OrganizePage {
  config: OrganizeConfig | null;
  problems: string[];
  blacklist: number[];
  places: Map<string, string>;
  plan: OrganizePlan | null;
  presets: OrganizePreset[] | null;
}

export interface AppState {
  inv: InventoryData | null;
  profiles: ProfilesV3 | null;
  builtinTemplates: TemplateMap;   // the shard's built-in templates (GET /api/profiles), read-only
  rules: RulesV1 | null;
  settings: SettingsData | null;
  availableShards: ShardOption[];
  propKeys: string[];
  // GET /api/setup's last known answer (adapters, candidates, installed/available versions, firstRun) —
  // load() fetches it once and the Settings tab / wizard refresh it themselves after an action changes it.
  setup: SetupApiResponse | null;
  wizardShown: boolean;   // load() opens the first-run wizard at most once per page life; reload() never touches this
  facets: Facets | null;   // GET /api/inventory's facets: slots/locations/rarities/slayers/kinds + counts, snapshotted once at load()
  // The full-item-by-serial cache (Task 5's item-lookup fix): GET /api/inventory no longer carries
  // the whole item map, so anything that needs to enrich a bare serial into a full record (the suit
  // builder's result panel, the hover tooltip) goes through ui/items.mts's resolveItems(), which
  // fills this in from GET /api/items/by-serial — seeded opportunistically as the Inventory tab
  // renders its own rows, which already carry full records. Cleared whenever load() refreshes the
  // inventory (a rescan can move or drop a piece).
  itemCache: Map<number, Item>;
  sheetProps: string[] | null;    // the character sheet's shown properties (ui-prefs `sheetProps`); null = the default set
  organize: OrganizePage;
  // Set only once inventory-data.mts's reload() has fetched the inventory at least once — absent (not
  // null) before that, exactly as it is at runtime today (nothing in the initial object literal below
  // ever assigned it; inventory-data.mts's `state.newestScan = …` is the only place that creates the property).
  newestScan?: string | null | undefined;
}

export const state: AppState = {
  inv: null, profiles: null, builtinTemplates: {}, rules: null, settings: null, availableShards: [], propKeys: [],
  // GET /api/setup's last known answer (adapters, candidates, installed/available versions, firstRun) —
  // load() fetches it once and the Settings tab / wizard refresh it themselves after an action changes it.
  setup: null,
  wizardShown: false,   // load() opens the first-run wizard at most once per page life; reload() never touches this
  facets: null,   // GET /api/inventory's facets: slots/locations/rarities/slayers/kinds + counts, snapshotted once at load()
  sheetProps: null,
  // The full-item-by-serial cache (Task 5's item-lookup fix): GET /api/inventory no longer carries
  // the whole item map, so anything that needs to enrich a bare serial into a full record (the suit
  // builder's result panel, the hover tooltip) goes through ui/items.mts's resolveItems(), which
  // fills this in from GET /api/items/by-serial — seeded opportunistically as the Inventory tab
  // renders its own rows, which already carry full records. Cleared whenever load() refreshes the
  // inventory (a rescan can move or drop a piece).
  itemCache: new Map(),
  organize: { config: null, problems: [], blacklist: [], places: new Map(), plan: null, presets: null },
};

// ---------------------------------------------------------------- bridge (Highlight / Grab / Go to)
export const bridge: BridgeState = { online: false, character: null, adapter: null, seen: new Set(), pending: new Map() };

// ---------------------------------------------------------------- saved runs (history, open, compare)
// The newest scan's own stamp, compared as instants: adapters write naive local or offset stamps and
// the Forget tombstones write UTC `…Z`, so the string maximum can pick the older of two scans.
export function newestStamp(scans: ReadonlyArray<{ scannedAt: string }>): string | null {
  let best: string | null = null, bestMs = -Infinity;
  for (const s of scans) { const ms = Date.parse(s.scannedAt); if (ms > bestMs) { bestMs = ms; best = s.scannedAt; } }
  return best;
}
export const invStamp = (): string => newestStamp(state.inv?.scans || []) || "";
