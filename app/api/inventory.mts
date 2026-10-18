// inventory.mts — what the inventory routes answer (app/http/routes/inventory.mts): GET /api/inventory's fold summary, GET /api/missing, GET /api/items in its rows, groups and hits forms, GET /api/items/by-serial, the scan blacklist and Forget. Types only and node-free, so the routes `satisfies` these, the page re-exports them (app/ui/api-types.mts) and the route map names them (app/api/routes.mts).
//
// map: api
// owns: `InventoryData`, `InventoryApiResponse`, `MissingApiResponse`, `ItemsApiResponse`, `ItemHitsApiResponse`, `ItemsBySerialApiResponse`, `BlacklistApiResponse`, `BlacklistPostBody`, `ForgetApiResponse`
import type { Item, Container, Character, ScanSummary, BlacklistEntry } from "../vault-lib.mts";
import type { Facets, ItemQueryRows, ItemQueryGroups, HitRow } from "../item-query.mts";
import type { MissingItem } from "../missing.mts";

// GET /api/inventory's `.inventory`: the fold of every scan without its item map (the page pages GET /api/items
// instead), with what is computed once over the whole set: who wears what, each root's item and missing counts, the
// facets and the property keys.
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
// GET /api/missing?root= (issue #99): what left that root since its last scan.
export interface MissingApiResponse { ok: boolean; items: MissingItem[] }

// GET /api/items — the ItemQueryRows | ItemQueryGroups union applyItemQuery() returns (item-query.mts), plus the
// request's own offset/limit echoed back.
export type ItemsApiResponse = { ok: boolean; offset: number; limit: number } & (ItemQueryRows | ItemQueryGroups);
// GET /api/items?fields=hits (the House map's search): each match's serial, name, amount, container, root and place.
export interface ItemHitsApiResponse { ok: boolean; total: number; offset: number; limit: number; rows: HitRow[] }
// GET /api/items/by-serial?serials=: the full item records, by serial; a serial with no item is absent.
export interface ItemsBySerialApiResponse {
  ok: boolean;
  items: Record<string, Item>;
}

// GET /api/blacklist: the containers scans never open (`<data>/scan-blacklist.json`). POST adds one, DELETE
// /api/blacklist/<serial> takes one off; both answer {ok}.
export interface BlacklistApiResponse {
  ok: boolean;
  containers: BlacklistEntry[];
}
export interface BlacklistPostBody { serial: number; name: string; where?: string }
// POST /api/forget {root} and /api/forget-character {character}: the tombstone scan was written.
export interface ForgetApiResponse {
  ok: boolean;
}
