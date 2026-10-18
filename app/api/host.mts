// host.mts — what the desktop shell's routes answer and take (app/http/routes/host.mts): POST /api/host/pick-folder's chosen folder and POST /api/host/open-path. Types only and node-free, so the routes `satisfies` these, the page re-exports them (app/ui/api-types.mts) and the route map names them (app/api/routes.mts).
//
// map: api
// owns: `HostPickFolderApiResponse`, `PickFolderBody`, `OpenPathBody`

// POST /api/host/pick-folder {title?}: the folder the player picked in the shell's dialog, null when they cancelled.
export interface HostPickFolderApiResponse {
  ok: boolean;
  path: string | null;
}
export interface PickFolderBody { title?: string }
// POST /api/host/open-path {which}: the shell opens its data or logs folder; answers {ok}.
export interface OpenPathBody { which: "data" | "logs" }
