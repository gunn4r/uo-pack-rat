// house-model-types.mts — the house model's types and the GET /api/houses responses built from them, and the player's house names, areas and claims (GET/PUT /api/house-map, GET /api/house-claims); types only, importing only the schema's types, so the page's browser build can use them: app/house-model.mts re-exports them, the routes `satisfies` them, and ui/api-types.mts re-exports them.
//
// map: house
// owns: `HouseModel`, `Level`, `Cell`, `Furniture`, `Stack`, `Spot`, `HouseSummary`, `HousesApiResponse`, `HouseApiResponse`, `HouseBounds`, `AreaRect`, `HouseArea`, `HouseEntry`, `HouseMapApiResponse`, `HouseMapPutApiResponse`, `HouseClaimsApiResponse`

import type { HouseClaimsV1Item } from "./schema/types.d.mts";

// opened: false = a chest a house capture saw that no scan has opened (issue #10); absent = opened.
export interface HouseContainerInput { serial: number; name: string; facet: number | null; x: number; y: number; z: number; opened?: boolean | undefined; graphic?: number | null | undefined; hue?: number | null | undefined }
export interface Level { index: number; name: string; floorZ: number; status: "built" | "floor-only" }
export type CellKind = "floor" | "wall" | "window" | "stair" | "roof";
export interface Cell { level: number; x: number; y: number; kind: CellKind; material: string; family: MaterialFamily; z: number; lip: boolean; indoor: boolean; doorway: boolean }
// The color family a tile is drawn in (house-model.mts materialFamily).
export type MaterialFamily = "stone" | "brick" | "plaster" | "wood" | "marble" | "sandstone" | "dirt" | "grass" | "water" | "tile" | "neutral";
export interface Furniture { serial: number; kind: "block" | "door" | "teleporter"; name: string; level: number; x: number; y: number; z: number; height: number }
// serials and zs bottom first; codes[serial] is the engraving code ("C3", or "C" alone for a single chest); graphics[serial] the chest's item graphic and hues[serial] its hue (only when not 0), from its scan record, else from a house capture (issue #174).
export interface Stack { level: number; x: number; y: number; serials: number[]; zs: number[]; spot: number | null; direction: string; letter: string }
export interface Spot { id: number; level: number; x: number; y: number; teleporter: boolean }
export interface HouseModel { id: string; facet: number | null; capturedAt: string; captures: number; x0: number; y0: number; x1: number; y1: number; levels: Level[]; cells: Cell[]; furniture: Furniture[]; stacks: Stack[]; spots: Spot[]; codes: Record<string, string>; tiledata: boolean; unopened: number[]; unopenedNames: Record<string, string>; graphics: Record<string, number>; hues: Record<string, number> }

// Where tiledata.mul came from (the uoFolder setting, or TazUO's launcher profile), or why there is none.
export interface TiledataFrom { folder: string | null; source: "settings" | "tazuo-profile" | null; reason: null | "override-missing" | "no-client" | "no-finder" | "no-tazuo-profile" | "unreadable" }
// GET /api/houses
// width, height and plot are the plot, without a row of front steps outside it (house-model.mts plotBounds).
export interface HouseSummary { id: string; name?: string | undefined; facet: number | null; capturedAt: string; captures: number; width: number; height: number; plot: { x0: number; y0: number; x1: number; y1: number }; levels: number; containers: number; serials: number[] }
export interface HousesApiResponse { ok: boolean; tiledata: boolean; tiledataFrom: TiledataFrom; houses: HouseSummary[] }
// GET /api/houses/<id>: the model plus the player's name for the house (house-map.json, issue #164), when it has one.
export interface HouseApiResponse { ok: boolean; house: HouseModel & { name?: string | undefined } }

// ---------------------------------------------------------------- <data>/house-map.json (app/house-names.mts) and house-claims.json
// The player's names and drawn areas by house id, each with the footprint the house had when it was named or its areas
// drawn. Other fields an entry or an area may carry later are kept, unread.
export interface HouseBounds { x0: number; y0: number; x1: number; y1: number; facet: number | null }
// World tiles, inclusive.
export interface AreaRect { x0: number; y0: number; x1: number; y1: number }
// `color` is a token name, "area-1" … "area-8" (--color-area-N).
export interface HouseArea { id: string; name: string; level: number; color: string; rects: AreaRect[]; [field: string]: unknown }
// `name` is "" for a house with areas but no name of its own.
export interface HouseEntry { name: string; bounds?: HouseBounds | undefined; areas?: HouseArea[] | undefined; [field: string]: unknown }
// GET /api/house-map; `readOnly`: why the map cannot be changed (a newer Pack Rat made it), when it cannot.
export interface HouseMapApiResponse { ok: boolean; houses: Record<string, HouseEntry>; readOnly?: string }
// PUT /api/house-map/<id> {name, bounds?, areas?}: the entry as saved, null when it removed the entry.
export interface HouseMapPutApiResponse { ok: boolean; entry: HouseEntry | null }
// GET /api/house-claims (issue #299): the houses the player claimed. DELETE /api/house-claims/<id> answers {ok}.
export interface HouseClaimsApiResponse { ok: boolean; claims: HouseClaimsV1Item[] }
