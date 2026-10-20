// routes.mts — the HTTP API's route map: every /api route the server registers (app/http/routes/), keyed "METHOD /path" with a path parameter written <name>, and the type of what it answers with 200 (`res`) and of the JSON body it reads (`body`). Types only, importing only other node-free type modules (this folder's families and the house, Organize and run types), so the page, the MCP server and the routes can all use it.
//
// `scripts/api-routes.test.mts` fails on a route registered with no entry here and on an entry no route serves. A route
// whose answer has no shared type yet is `Untyped`; W2c (issue #338) gives each family its type and has its routes
// `satisfies` it.
//
// map: api
// owns: `ApiRoutes`, `ApiEntry`, `OkApiResponse`, `Untyped`, `EventStream`, `Png`, `ApiResponse`, `ApiBody`
import type { BridgeQueueApiResponse, BridgeStatusApiResponse } from "./bridge.mts";
import type { HouseApiResponse, HouseClaimsApiResponse, HouseEntry, HouseMapApiResponse, HouseMapPutApiResponse, HousesApiResponse } from "../house-model-types.mts";
import type { HostPickFolderApiResponse, OpenPathBody, PickFolderBody } from "./host.mts";
import type { ImportPasteApiResponse, ImportPasteBody, RescanApiResponse } from "./import.mts";
import type { ItemKindsApiResponse, ItemKindsPostBody } from "./kinds.mts";
import type { McpApiResponse, McpPutBody } from "./mcp.mts";
import type { HueColorsApiResponse, PaperdollOptionsApiResponse } from "./paperdoll.mts";
import type { KindOverrides } from "../vault-lib.mts";
import type { BlacklistApiResponse, BlacklistPostBody, ForgetApiResponse, InventoryApiResponse, ItemHitsApiResponse, ItemPropCountsApiResponse, ItemsApiResponse, ItemsBySerialApiResponse, MissingApiResponse } from "./inventory.mts";
import type { MoveBackApiResponse, MovePlanApiResponse, MoveTripApiResponse, OrganizeApiResponse, OrganizeMatchApiResponse, OrganizePlanApiResponse, OrganizePresetsApiResponse, OrganizeProposeApiResponse, OrganizeProposeBody, OrganizePutApiResponse, OrganizeTripApiResponse } from "../organize-types.mts";
import type { OrganizeConfig, RuleMatch } from "../organize-config.mts";
import type { ProfileEdit } from "../profile-edits.mts";
import type { PanelPrefs } from "../tazuo-panel-prefs.mts";
import type { ProfilesApiResponse, ProfilesPatchApiResponse, TazuoPanelApiResponse, UiPrefs, UiPrefsApiResponse } from "./prefs.mts";
import type { EvaluateApiResponse, OptimizeCancelApiResponse, OptimizeStartApiResponse, OptimizeStatusApiResponse } from "./optimize.mts";
import type { RunBody, RunsListBody, RunSummary } from "../runs-types.mts";
import type { CleanupApiResponse, CleanupBody, InstallApiResponse, InstallBody, LocateApiResponse, LocateBody, PasteScannerApiResponse, RulesApiResponse, SettingsApiResponse, SettingsPutBody, SetupApiResponse, UpdateCheckApiResponse } from "./setup.mts";

// One route: what it answers with 200, and the JSON body it reads (undefined: none).
export interface ApiEntry<Res, Body = undefined> { res: Res; body: Body }
// The plain acknowledgement many routes answer with.
export interface OkApiResponse { ok: boolean }
// A route whose answer and body have no shared type yet: the handler's shape is all there is.
export type Untyped = ApiEntry<unknown, unknown>;
// Answers that are not JSON.
export interface EventStream { readonly kind: "text/event-stream" }
export interface Png { readonly kind: "image/png" }

export interface ApiRoutes {
  // blacklist.mts
  "GET /api/blacklist": ApiEntry<BlacklistApiResponse>;
  "POST /api/blacklist": ApiEntry<OkApiResponse, BlacklistPostBody>;
  "DELETE /api/blacklist/<serial>": ApiEntry<OkApiResponse>;
  // bridge.mts
  "POST /api/bridge": ApiEntry<BridgeQueueApiResponse, unknown>;
  "POST /api/bridge/stop": ApiEntry<OkApiResponse, Record<string, never>>;
  "GET /api/bridge/status": ApiEntry<BridgeStatusApiResponse>;
  // forget.mts
  "POST /api/forget": ApiEntry<ForgetApiResponse, unknown>;
  "POST /api/forget-character": ApiEntry<ForgetApiResponse, { character: string }>;
  // host.mts
  "POST /api/host/pick-folder": ApiEntry<HostPickFolderApiResponse, PickFolderBody>;
  "POST /api/host/open-path": ApiEntry<OkApiResponse, OpenPathBody>;
  "GET /api/events": ApiEntry<EventStream>;
  // houses.mts
  "GET /api/houses": ApiEntry<HousesApiResponse>;
  "GET /api/houses/<id>": ApiEntry<HouseApiResponse>;
  "GET /api/facet-map/<facet>.png": ApiEntry<Png>;
  "GET /api/item-art/<graphic>.png": ApiEntry<Png>;
  "GET /api/paperdoll.png": ApiEntry<Png>;
  "GET /api/paperdoll/options": ApiEntry<PaperdollOptionsApiResponse>;
  "GET /api/hue-colors": ApiEntry<HueColorsApiResponse>;
  "GET /api/house-map": ApiEntry<HouseMapApiResponse>;
  "PUT /api/house-map/<id>": ApiEntry<HouseMapPutApiResponse, HouseEntry>;
  "GET /api/house-claims": ApiEntry<HouseClaimsApiResponse>;
  "DELETE /api/house-claims/<id>": ApiEntry<OkApiResponse>;
  // import.mts
  "POST /api/import/paste": ApiEntry<ImportPasteApiResponse, ImportPasteBody>;
  "POST /api/import/rescan": ApiEntry<RescanApiResponse, Record<string, never>>;
  // inventory.mts
  "GET /api/inventory": ApiEntry<InventoryApiResponse>;
  "GET /api/missing": ApiEntry<MissingApiResponse>;
  "GET /api/items": ApiEntry<ItemsApiResponse | ItemHitsApiResponse | ItemPropCountsApiResponse>;   // ItemHitsApiResponse with fields=hits, ItemPropCountsApiResponse with fields=props
  "GET /api/items/by-serial": ApiEntry<ItemsBySerialApiResponse>;
  // kinds.mts
  "GET /api/item-kinds": ApiEntry<ItemKindsApiResponse>;
  "POST /api/item-kinds": ApiEntry<ItemKindsApiResponse, ItemKindsPostBody>;
  "POST /api/item-kinds/import": ApiEntry<ItemKindsApiResponse, Partial<KindOverrides>>;
  // mcp.mts
  "GET /api/mcp": ApiEntry<McpApiResponse>;
  "PUT /api/mcp": ApiEntry<McpApiResponse, McpPutBody>;
  "POST /api/mcp/token": ApiEntry<McpApiResponse, Record<string, never>>;
  // optimize.mts: builds
  "POST /api/optimize": ApiEntry<OptimizeStartApiResponse, unknown>;   // the request bodies of the builds are not typed yet
  "GET /api/optimize/<id>/events": ApiEntry<EventStream>;
  "POST /api/optimize/<id>/cancel": ApiEntry<OptimizeCancelApiResponse>;
  "GET /api/optimize/<id>/status": ApiEntry<OptimizeStatusApiResponse>;
  "POST /api/evaluate": ApiEntry<EvaluateApiResponse, unknown>;
  // optimize.mts: saved runs
  "GET /api/runs": ApiEntry<RunsListBody>;
  "POST /api/runs": ApiEntry<RunBody<RunSummary>, unknown>;   // the request bodies of POST and PUT are not typed yet
  "GET /api/runs/<id>": ApiEntry<RunBody>;
  "PUT /api/runs/<id>": ApiEntry<RunBody<RunSummary>, unknown>;
  "DELETE /api/runs/<id>": ApiEntry<OkApiResponse>;
  // organize.mts
  "GET /api/organize": ApiEntry<OrganizeApiResponse>;
  "PUT /api/organize": ApiEntry<OrganizePutApiResponse, OrganizeConfig & { base?: string }>;
  "GET /api/organize/presets": ApiEntry<OrganizePresetsApiResponse>;
  "POST /api/organize/match": ApiEntry<OrganizeMatchApiResponse, { match: RuleMatch }>;
  "POST /api/organize/propose": ApiEntry<OrganizeProposeApiResponse, OrganizeProposeBody>;
  "GET /api/organize/plan": ApiEntry<OrganizePlanApiResponse>;
  "POST /api/organize/trip": ApiEntry<OrganizeTripApiResponse, { index: number; stamp: string }>;
  "POST /api/move/plan": ApiEntry<MovePlanApiResponse | MoveBackApiResponse, unknown>;   // MoveBackApiResponse for {back}
  "POST /api/move/trip": ApiEntry<MoveTripApiResponse, unknown>;
  // prefs.mts
  "GET /api/profiles": ApiEntry<ProfilesApiResponse>;
  "PATCH /api/profiles": ApiEntry<ProfilesPatchApiResponse, { edits: ProfileEdit[] }>;
  "GET /api/ui-prefs": ApiEntry<UiPrefsApiResponse>;
  "PUT /api/ui-prefs": ApiEntry<OkApiResponse, UiPrefs>;
  "GET /api/tazuo-panel": ApiEntry<TazuoPanelApiResponse>;
  "PUT /api/tazuo-panel": ApiEntry<TazuoPanelApiResponse, PanelPrefs>;
  // settings.mts
  "GET /api/settings": ApiEntry<SettingsApiResponse>;
  "PUT /api/settings": ApiEntry<SettingsApiResponse, SettingsPutBody>;
  "POST /api/retention/cleanup": ApiEntry<CleanupApiResponse, CleanupBody>;
  "GET /api/rules": ApiEntry<RulesApiResponse>;
  // setup.mts
  "GET /api/setup": ApiEntry<SetupApiResponse>;
  "GET /api/setup/scanner": ApiEntry<PasteScannerApiResponse>;
  "POST /api/setup/locate": ApiEntry<LocateApiResponse, LocateBody>;
  "POST /api/setup/install": ApiEntry<InstallApiResponse, InstallBody>;
  "GET /api/update-check": ApiEntry<UpdateCheckApiResponse>;
}
export type ApiResponse<K extends keyof ApiRoutes> = ApiRoutes[K]["res"];
export type ApiBody<K extends keyof ApiRoutes> = ApiRoutes[K]["body"];
