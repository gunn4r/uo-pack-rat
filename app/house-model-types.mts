// house-model-types.mts — the house model's types (app/house-model.mts) and the GET /api/houses responses built from them. Types only, with no imports, so the page's browser build can use them: the server annotates its responses with these and ui/api-types.mts re-exports them.

// opened: false = a chest a house capture saw that no scan has opened (issue #10); absent = opened.
export interface HouseContainerInput { serial: number; name: string; facet: number | null; x: number; y: number; z: number; opened?: boolean | undefined }
export interface Level { index: number; name: string; floorZ: number; status: "built" | "floor-only" }
export type CellKind = "floor" | "wall" | "window" | "stair" | "roof";
export interface Cell { level: number; x: number; y: number; kind: CellKind; material: string; family: MaterialFamily; z: number; lip: boolean; indoor: boolean; doorway: boolean }
// The color family a tile is drawn in (house-model.mts materialFamily).
export type MaterialFamily = "stone" | "brick" | "plaster" | "wood" | "marble" | "sandstone" | "dirt" | "grass" | "water" | "tile" | "neutral";
export interface Furniture { serial: number; kind: "block" | "door" | "teleporter"; name: string; level: number; x: number; y: number; z: number; height: number }
// serials and zs bottom first; codes[serial] is the engraving code ("C3", or "C" alone for a single chest).
export interface Stack { level: number; x: number; y: number; serials: number[]; zs: number[]; spot: number | null; direction: string; letter: string }
export interface Spot { id: number; level: number; x: number; y: number; teleporter: boolean }
export interface HouseModel { id: string; facet: number | null; capturedAt: string; captures: number; x0: number; y0: number; x1: number; y1: number; levels: Level[]; cells: Cell[]; furniture: Furniture[]; stacks: Stack[]; spots: Spot[]; codes: Record<string, string>; tiledata: boolean; unopened: number[]; unopenedNames: Record<string, string> }

// Where tiledata.mul came from (the uoFolder setting, or TazUO's launcher profile), or why there is none.
export interface TiledataFrom { folder: string | null; source: "settings" | "tazuo-profile" | null; reason: null | "override-missing" | "no-client" | "no-tazuo-profile" | "unreadable" }
// GET /api/houses
// width, height and plot are the plot, without a row of front steps outside it (house-model.mts plotBounds).
export interface HouseSummary { id: string; name?: string | undefined; facet: number | null; capturedAt: string; captures: number; width: number; height: number; plot: { x0: number; y0: number; x1: number; y1: number }; levels: number; containers: number; serials: number[] }
export interface HousesApiResponse { ok: boolean; tiledata: boolean; tiledataFrom: TiledataFrom; houses: HouseSummary[] }
// GET /api/houses/<id>: the model plus the player's name for the house (house-map.json, issue #164), when it has one.
export interface HouseApiResponse { ok: boolean; house: HouseModel & { name?: string | undefined } }
