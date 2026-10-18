// kinds.mts — what the item-kinds routes answer and take (app/http/routes/kinds.mts): the player's own item kinds (<data>/item-kinds.json, app/item-kinds.mts) after GET, a change or an import. Types only and node-free, so the routes `satisfies` these, the page re-exports them (app/ui/api-types.mts) and the route map names them (app/api/routes.mts).
//
// map: api
// owns: `ItemKindsApiResponse`, `ItemKindsPostBody`
import type { KindOverrides } from "../vault-lib.mts";

// GET and POST /api/item-kinds, POST /api/item-kinds/import (issue #150): the whole item-kinds.json document after
// the change; an import also says how many entries it left out and why (the first few).
// `readOnly` (GET): why the file cannot be changed, when a newer Pack Rat made it (app/migrate.mts).
export interface ItemKindsApiResponse extends KindOverrides { ok: boolean; version: 1; skipped?: number; problems?: string[]; readOnly?: string }
// POST /api/item-kinds: the kind for an exact item name and/or a graphic; null takes those entries away. POST
// /api/item-kinds/import takes an item-kinds.json document ({names?, graphics?}).
export interface ItemKindsPostBody { name?: string; graphic?: number; kind: string | null }
