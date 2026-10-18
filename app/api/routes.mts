// routes.mts — the HTTP API's route map: every /api route the server registers (app/http/routes/), keyed "METHOD /path" with a path parameter written <name>, and the type of what it answers with 200 (`res`) and of the JSON body it reads (`body`). Types only, importing only other node-free type modules, so the page, the MCP server and the routes can all use it.
//
// `scripts/api-routes.test.mts` fails on a route registered with no entry here and on an entry no route serves. A route
// whose answer has no shared type yet is `Untyped`; W2c (issue #338) gives each family its type and has its routes
// `satisfies` it.
//
// map: api
// owns: `ApiRoutes`, `ApiEntry`, `Untyped`, `EventStream`, `Png`, `ApiResponse`, `ApiBody`
import type { HouseApiResponse, HousesApiResponse } from "../house-model-types.mts";
import type { OrganizePlanApiResponse, OrganizeProposeApiResponse, OrganizeProposeBody } from "../organize-types.mts";
import type { RunBody, RunsListBody, RunSummary } from "../runs-types.mts";

// One route: what it answers with 200, and the JSON body it reads (undefined: none).
export interface ApiEntry<Res, Body = undefined> { res: Res; body: Body }
// A route whose answer and body have no shared type yet: the handler's shape is all there is.
export type Untyped = ApiEntry<unknown, unknown>;
// Answers that are not JSON.
export interface EventStream { readonly kind: "text/event-stream" }
export interface Png { readonly kind: "image/png" }

export interface ApiRoutes {
  // blacklist.mts
  "GET /api/blacklist": Untyped;
  "POST /api/blacklist": Untyped;
  "DELETE /api/blacklist/<serial>": Untyped;
  // bridge.mts
  "POST /api/bridge": Untyped;
  "POST /api/bridge/stop": Untyped;
  "GET /api/bridge/status": Untyped;
  // forget.mts
  "POST /api/forget": Untyped;
  "POST /api/forget-character": Untyped;
  // host.mts
  "POST /api/host/pick-folder": Untyped;
  "POST /api/host/open-path": Untyped;
  "GET /api/events": ApiEntry<EventStream>;
  // houses.mts
  "GET /api/houses": ApiEntry<HousesApiResponse>;
  "GET /api/houses/<id>": ApiEntry<HouseApiResponse>;
  "GET /api/facet-map/<facet>.png": ApiEntry<Png>;
  "GET /api/item-art/<graphic>.png": ApiEntry<Png>;
  "GET /api/house-map": Untyped;
  "PUT /api/house-map/<id>": Untyped;
  "GET /api/house-claims": Untyped;
  "DELETE /api/house-claims/<id>": Untyped;
  // import.mts
  "POST /api/import/paste": Untyped;
  "POST /api/import/rescan": Untyped;
  // inventory.mts
  "GET /api/inventory": Untyped;
  "GET /api/missing": Untyped;
  "GET /api/items": Untyped;
  "GET /api/items/by-serial": Untyped;
  // kinds.mts
  "GET /api/item-kinds": Untyped;
  "POST /api/item-kinds": Untyped;
  "POST /api/item-kinds/import": Untyped;
  // mcp.mts
  "GET /api/mcp": Untyped;
  "PUT /api/mcp": Untyped;
  "POST /api/mcp/token": Untyped;
  // optimize.mts: builds
  "POST /api/optimize": Untyped;
  "GET /api/optimize/<id>/events": ApiEntry<EventStream>;
  "POST /api/optimize/<id>/cancel": Untyped;
  "GET /api/optimize/<id>/status": Untyped;
  "POST /api/evaluate": Untyped;
  // optimize.mts: saved runs
  "GET /api/runs": ApiEntry<RunsListBody>;
  "POST /api/runs": ApiEntry<RunBody<RunSummary>, unknown>;   // the request bodies of POST and PUT are not typed yet
  "GET /api/runs/<id>": ApiEntry<RunBody>;
  "PUT /api/runs/<id>": ApiEntry<RunBody<RunSummary>, unknown>;
  "DELETE /api/runs/<id>": Untyped;
  // organize.mts
  "GET /api/organize": Untyped;
  "PUT /api/organize": Untyped;
  "GET /api/organize/presets": Untyped;
  "POST /api/organize/match": Untyped;
  "POST /api/organize/propose": ApiEntry<OrganizeProposeApiResponse, OrganizeProposeBody>;
  "GET /api/organize/plan": ApiEntry<OrganizePlanApiResponse>;
  "POST /api/organize/trip": Untyped;
  "POST /api/move/plan": Untyped;
  "POST /api/move/trip": Untyped;
  // prefs.mts
  "GET /api/profiles": Untyped;
  "PATCH /api/profiles": Untyped;
  "GET /api/ui-prefs": Untyped;
  "PUT /api/ui-prefs": Untyped;
  "GET /api/tazuo-panel": Untyped;
  "PUT /api/tazuo-panel": Untyped;
  // settings.mts
  "GET /api/settings": Untyped;
  "PUT /api/settings": Untyped;
  "POST /api/retention/cleanup": Untyped;
  "GET /api/rules": Untyped;
  // setup.mts
  "GET /api/setup": Untyped;
  "GET /api/setup/scanner": Untyped;
  "POST /api/setup/locate": Untyped;
  "POST /api/setup/install": Untyped;
  "GET /api/update-check": Untyped;
}
export type ApiResponse<K extends keyof ApiRoutes> = ApiRoutes[K]["res"];
export type ApiBody<K extends keyof ApiRoutes> = ApiRoutes[K]["body"];
