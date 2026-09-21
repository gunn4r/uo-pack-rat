// ui/store.mjs — the shared mutable state object, the bridge connection state, and invStamp.
// Moved verbatim out of index.html's inline <script type="module"> (Task 4, the page split).

export const state = {
  inv: null, profiles: null, rules: null, settings: null, availableShards: [], propKeys: [],
  // GET /api/setup's last known answer (adapters, candidates, installed/available versions, firstRun) —
  // load() fetches it once and the Settings tab / wizard refresh it themselves after an action changes it.
  setup: null,
  wizardShown: false,   // load() opens the first-run wizard at most once per page life; reload() never touches this
  facets: null,   // GET /api/inventory's facets: slots/locations/rarities/slayers/kinds + counts, snapshotted once at load()
  // The page-side source of truth for the Inventory tab's filters/sort/paging — the exact shape
  // parseItemQuery (item-query.mts) reads off a URLSearchParams, so fetchItems() builds the query
  // string straight from this object. hideTags/props are arrays here (not a Set), matching the wire
  // form; nothing hidden by default: power scrolls are Cursed.
  query: { q: "", slot: "", loc: "", rarity: "", kind: "", seenDays: 0, slayer: "", nogarg: false, med: false, hideTags: [], props: [], group: false, sort: "name", dir: 1, offset: 0, limit: 200 },
  page: { rows: [], groups: null, total: 0, pieces: 0 },   // the current page from GET /api/items
  // The full-item-by-serial cache (Task 5's item-lookup fix): GET /api/inventory no longer carries
  // the whole item map, so anything that needs to enrich a bare serial into a full record (the suit
  // builder's result panel, the hover tooltip) goes through ui/items.mjs's resolveItems(), which
  // fills this in from GET /api/items/by-serial — seeded opportunistically as the Inventory tab
  // renders its own rows, which already carry full records. Cleared whenever load() refreshes the
  // inventory (a rescan can move or drop a piece).
  itemCache: new Map(),
  cols: JSON.parse(localStorage.getItem("vault.cols") || "null") || ["physResist", "fireResist", "coldResist", "poisonResist", "energyResist", "hci", "dci", "ssi", "di", "lmc", "lrc", "fc", "fcr", "manaRegen"],
  builder: { character: null, profile: null, result: null, job: null, runs: [], compare: new Set(), openRun: null, altView: null },
};

// ---------------------------------------------------------------- bridge (Highlight / Grab / Go to)
export const bridge = { online: false, character: null, seen: new Set(), pending: new Map() };

// ---------------------------------------------------------------- saved runs (history, open, compare)
export const invStamp = () => (state.inv?.scans || []).reduce((m, x) => (String(x.scannedAt) > m ? String(x.scannedAt) : m), "");
