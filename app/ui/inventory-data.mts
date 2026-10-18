// ui/inventory-data.mts — the inventory and profiles the page draws from: reload() fetches them into the store and
// then dispatches "inventorychange" on document, which every screen drawn from them listens for. No screen is
// called by name from here; the sidebar's counts are redrawn first, as before the event, because the Runs count
// reads the builder's character before the builder's listener picks a new one.
//
// map: ui-bootstrap
// owns: `reload`, `retryLoad`, `fetchAllItems`, `inventoryLoader`
import { state, newestStamp } from "./store.mts";
import { forgetTipMisses } from "./dom.mts";
import { api } from "./api.mts";
import { loadOrganize, refreshPlaces } from "./organize-data.mts";
import { loadHouseLinks } from "./house-links.mts";
import { renderNavCounts } from "./shell.mts";
import { loadProfiles } from "./profiles.mts";
import { errorText } from "./messages.mts";
import type { InventoryApiResponse, ItemsApiResponse } from "./api-types.mts";
import type { Item } from "../vault-lib.mts";
import type { ItemQueryRows } from "../item-query.mts";

// api() throws with the server's own message ("internal error"); the panels a failed load writes into also need
// to know which request it was.
export function get<T>(path: string): Promise<T> { return api<T>(path).catch((e: Error) => { throw new Error(`${path} failed: ${e.message}`); }); }

// Every item a GET /api/items query matches, in its 500-row pages (Unravel and Scrolls load their lists with it).
// `params` is the query string without limit and offset.
export async function fetchAllItems(params: string): Promise<Item[]> {
  const rows: Item[] = [];
  for (let offset = 0; ; offset += 500) {
    const r = await api<ItemsApiResponse>(`/api/items?${params}&limit=500&offset=${offset}`);
    rows.push(...(r as ItemQueryRows).rows);
    if (offset + 500 >= r.total) return rows;
  }
}

// A screen's data drawn from the inventory, fetched once per state.inv (a reload makes a new one). One fetch at a
// time; a reload that lands while one runs is fetched once it is done, if the screen still shows. A failed fetch
// keeps the last data and sets `error`; `settled` (the screen's redraw) runs after every fetch either way.
export interface InventoryLoader {
  readonly error: string | null;
  readonly loading: boolean;
  load(): void;         // fetch now
  ensure(): void;       // fetch unless the data is for this inventory or a fetch is running
  invalidate(): void;   // the data is stale even for this inventory: ensure() fetches next time
}
export function inventoryLoader<T>(o: { fetch: () => Promise<T>; loaded: (data: T) => void; settled: () => void; shown: () => boolean }): InventoryLoader {
  let loadedFor: unknown = null, error: string | null = null, loading: Promise<void> | null = null;
  const load = (): void => {
    const inv = state.inv;
    loading = o.fetch()
      .then((data) => { o.loaded(data); error = null; loadedFor = inv; })
      .catch((e: unknown) => { error = errorText(e); })
      .finally(() => {
        loading = null;
        o.settled();
        if (!error && state.inv !== loadedFor && o.shown()) load();
      });
  };
  return {
    get error() { return error; },
    get loading() { return loading !== null; },
    load,
    ensure: () => { if (state.inv && loadedFor !== state.inv && !loading) load(); },
    invalidate: () => { loadedFor = null; },
  };
}

// The data half of app.mts's load(): inventory and profiles, and everything drawn from them. A live scan landing
// (events.mts, the "inventory" SSE event) and Forget run just this; rules/settings/setup don't change
// from a scan. It keeps the visible tab, the filters, the page and the builder's character and sidebar.
export async function reload(): Promise<void> {
  // The Organize setup comes with the inventory (labels change how locations read); a failed one leaves the
  // locations unlabelled, and the Organize screen says why when it is opened.
  // The profiles are read in turn with the page's saves (ui/profiles.mts), which set them.
  const [inv] = await Promise.all([get<InventoryApiResponse>("/api/inventory"), loadProfiles().catch((e: Error) => { throw new Error(`/api/profiles failed: ${e.message}`); }), loadOrganize().catch(() => undefined)]);
  state.inv = inv.inventory;
  void loadHouseLinks();   // Show on map, on item rows and in the Containers view
  state.itemCache.clear();   // a rescan can move or drop a piece — stale by-serial lookups must not survive it
  forgetTipMisses();
  state.facets = state.inv.facets;
  state.propKeys = state.inv.propKeys;
  refreshPlaces();
  state.newestScan = newestStamp(state.inv.scans);
  renderNavCounts();
  document.dispatchEvent(new Event("inventorychange"));
}

// The whole page load (app.mts's load(), which hands itself over at startup): the item table's "Try again" after a
// failed load runs it again.
let pageLoad: () => Promise<void> = reload;
export function setPageLoad(load: () => Promise<void>): void { pageLoad = load; }
export function retryLoad(): Promise<void> { return pageLoad(); }
