// ui/inventory-data.mts — the inventory and profiles the page draws from: reload() fetches them into the store and
// then dispatches "inventorychange" on document, which every screen drawn from them listens for. No screen is
// called by name from here; the sidebar's counts are redrawn first, as before the event, because the Runs count
// reads the builder's character before the builder's listener picks a new one.
import { state, newestStamp } from "./store.mts";
import { forgetTipMisses } from "./dom.mts";
import { api } from "./api.mts";
import { loadOrganize, refreshPlaces } from "./organize-data.mts";
import { loadHouseLinks } from "./house-links.mts";
import { renderNavCounts } from "./shell.mts";
import type { InventoryApiResponse, ProfilesApiResponse } from "./api-types.mts";

// api() throws with the server's own message ("internal error"); the panels a failed load writes into also need
// to know which request it was.
export function get<T>(path: string): Promise<T> { return api<T>(path).catch((e: Error) => { throw new Error(`${path} failed: ${e.message}`); }); }

// The data half of app.mts's load(): inventory and profiles, and everything drawn from them. A live scan landing
// (events.mts, the "inventory" SSE event) and Forget run just this; rules/settings/setup don't change
// from a scan. It keeps the visible tab, the filters, the page and the builder's character and sidebar.
export async function reload(): Promise<void> {
  // The Organize setup comes with the inventory (labels change how locations read); a failed one leaves the
  // locations unlabelled, and the Organize screen says why when it is opened.
  const [inv, prof] = await Promise.all([get<InventoryApiResponse>("/api/inventory"), get<ProfilesApiResponse>("/api/profiles"), loadOrganize().catch(() => undefined)]);
  state.inv = inv.inventory; state.profiles = prof.profiles; state.builtinTemplates = prof.builtinTemplates || {};
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
