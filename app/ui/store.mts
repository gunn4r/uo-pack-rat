// ui/store.mts — the shared mutable state object, the bridge connection state, and invStamp.
// Moved verbatim out of index.html's inline <script type="module"> (Task 4, the page split).
import type { CharacterEntryRaw, ProfilesFile, Item, EffectiveProfile } from "../vault-lib.mts";
import type { ItemQuery, Facets, ItemQueryGroups } from "../item-query.mts";
import type { RulesV1 } from "../schema/types.d.mts";
import { DEFAULT_COLS } from "./inv-model.mts";
import type { InventoryData, SettingsData, ShardOption, SetupApiResponse, OptSuit, OptimizeResult, OptimizeProgress, RunSummaryLike, SavedRunLike } from "./api-types.mts";

// The suit builder's own working copy of a character's settings: CharacterEntryRaw (vault-lib.mts)
// minus `caps` (a legacy v1 field the page never reads or writes — see migrateProfiles; keeping it
// here would make this type unusable where effectiveProfile()'s `Profile` is expected, since
// CharacterEntryRaw's `caps` is `unknown` and Profile's is `Record<string, number> | undefined`),
// plus `excludeRoots` (not part of profiles.json's per-character schema — selectCharacter() seeds it
// with `??= []` the first time a character is opened, same as builder.mts's other collection fields).
// Every collection field starts absent on a freshly-applied template and is filled in by `||=`/`??=`
// at first read (numGrid, renderProfile, readControls) — declared optional here to match, not
// required-and-then-immediately-defaulted.
export type BuilderProfile = Omit<CharacterEntryRaw, "caps"> & { excludeRoots?: Array<number | string> | undefined };

// The suit builder's live-progress UI object (builder.mts's runPanel() return value) — kept here,
// next to BuilderJob, since it's part of what state.builder.job actually holds.
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
export interface BuilderState {
  character: string | null;
  profile: BuilderProfile | null;
  result: OptimizeResult | null;
  job: BuilderJob | null;
  runs: RunSummaryLike[];
  compare: Set<string>;
  openRun: string | null;
  altView: number | null;
  // A build that finished while another character was selected, shown when its character is next.
  parked: FinishedBuild | null;
}
// What the Inventory table has loaded of the current query from GET /api/items (inventory.mts) — rows XOR
// groups, matching item-query.mts's ItemQueryRows | ItemQueryGroups union, folded into one always-both-keys
// shape. The table is virtual and loads in chunks as it scrolls, so `rows`/`groups` are SPARSE: index i
// holds the i-th match once its chunk has landed. `total` counts rows (or names, grouped); `stacks` and
// `pieces` count the matching stacks and pieces in either view.
export interface PageState {
  rows: Item[];
  groups: ItemQueryGroups["groups"] | null;
  total: number;
  stacks: number;
  pieces: number;
}
export interface BridgeState {
  online: boolean;
  character: string | null;
  seen: Set<string>;
  pending: Map<string, string>;
}

export interface AppState {
  inv: InventoryData | null;
  profiles: ProfilesFile | null;
  rules: RulesV1 | null;
  settings: SettingsData | null;
  availableShards: ShardOption[];
  propKeys: string[];
  // GET /api/setup's last known answer (adapters, candidates, installed/available versions, firstRun) —
  // load() fetches it once and the Settings tab / wizard refresh it themselves after an action changes it.
  setup: SetupApiResponse | null;
  wizardShown: boolean;   // load() opens the first-run wizard at most once per page life; reload() never touches this
  facets: Facets | null;   // GET /api/inventory's facets: slots/locations/rarities/slayers/kinds + counts, snapshotted once at load()
  // The page-side source of truth for the Inventory tab's filters and sort — the exact shape
  // parseItemQuery (item-query.mts) reads off a URLSearchParams (inv-model.mts's queryParams builds the
  // query string from it; offset/limit are set per chunk). hideTags/props are arrays here (not a Set), matching the wire
  // form; nothing hidden by default: power scrolls are Cursed.
  query: ItemQuery;
  page: PageState;   // the current page from GET /api/items
  // The full-item-by-serial cache (Task 5's item-lookup fix): GET /api/inventory no longer carries
  // the whole item map, so anything that needs to enrich a bare serial into a full record (the suit
  // builder's result panel, the hover tooltip) goes through ui/items.mts's resolveItems(), which
  // fills this in from GET /api/items/by-serial — seeded opportunistically as the Inventory tab
  // renders its own rows, which already carry full records. Cleared whenever load() refreshes the
  // inventory (a rescan can move or drop a piece).
  itemCache: Map<number, Item>;
  cols: string[];
  density: "dense" | "regular";   // the Inventory table's rows, 32 or 40 px (ui-prefs `density`)
  builder: BuilderState;
  // Set only once app.mts's load()/reload() has fetched the inventory at least once — absent (not
  // null) before that, exactly as it is at runtime today (nothing in the initial object literal below
  // ever assigned it; app.mts's `state.newestScan = …` is the only place that creates the property).
  newestScan?: string | null | undefined;
}

export const state: AppState = {
  inv: null, profiles: null, rules: null, settings: null, availableShards: [], propKeys: [],
  // GET /api/setup's last known answer (adapters, candidates, installed/available versions, firstRun) —
  // load() fetches it once and the Settings tab / wizard refresh it themselves after an action changes it.
  setup: null,
  wizardShown: false,   // load() opens the first-run wizard at most once per page life; reload() never touches this
  facets: null,   // GET /api/inventory's facets: slots/locations/rarities/slayers/kinds + counts, snapshotted once at load()
  // The page-side source of truth for the Inventory tab's filters and sort — the exact shape
  // parseItemQuery (item-query.mts) reads off a URLSearchParams (inv-model.mts's queryParams builds the
  // query string from it; offset/limit are set per chunk). hideTags/props are arrays here (not a Set), matching the wire
  // form; nothing hidden by default: power scrolls are Cursed.
  query: { q: "", chars: [], slot: [], loc: [], roots: [], rarity: "", rarityMin: "", kind: [], seenDays: 0, slayer: "", nogarg: false, med: false, hideTags: [], props: [], group: false, sort: "name", dir: 1, offset: 0, limit: 500 },
  page: { rows: [], groups: null, total: 0, stacks: 0, pieces: 0 },   // what the Inventory table has loaded
  density: "dense",
  // The full-item-by-serial cache (Task 5's item-lookup fix): GET /api/inventory no longer carries
  // the whole item map, so anything that needs to enrich a bare serial into a full record (the suit
  // builder's result panel, the hover tooltip) goes through ui/items.mts's resolveItems(), which
  // fills this in from GET /api/items/by-serial — seeded opportunistically as the Inventory tab
  // renders its own rows, which already carry full records. Cleared whenever load() refreshes the
  // inventory (a rescan can move or drop a piece).
  itemCache: new Map(),
  // The Inventory tab's columns. The saved choice lives server-side (GET/PUT /api/ui-prefs,
  // inventory.mts's applyUiPrefs) because the desktop app's page origin changes with its port on every
  // launch, and localStorage is scoped to the origin; these are the defaults until that answer lands.
  cols: [...DEFAULT_COLS],
  builder: { character: null, profile: null, result: null, job: null, runs: [], compare: new Set(), openRun: null, altView: null, parked: null },
};

// ---------------------------------------------------------------- bridge (Highlight / Grab / Go to)
export const bridge: BridgeState = { online: false, character: null, seen: new Set(), pending: new Map() };

// ---------------------------------------------------------------- saved runs (history, open, compare)
// The newest scan's own stamp, compared as instants: adapters write naive local or offset stamps and
// the Forget tombstones write UTC `…Z`, so the string maximum can pick the older of two scans.
export function newestStamp(scans: ReadonlyArray<{ scannedAt: string }>): string | null {
  let best: string | null = null, bestMs = -Infinity;
  for (const s of scans) { const ms = Date.parse(s.scannedAt); if (ms > bestMs) { bestMs = ms; best = s.scannedAt; } }
  return best;
}
export const invStamp = (): string => newestStamp(state.inv?.scans || []) || "";
