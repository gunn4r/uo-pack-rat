// import.mts — what the import routes answer and take (app/http/routes/import.mts): POST /api/import/paste's filed scan and POST /api/import/rescan's swept inboxes. Types only and node-free, so the routes `satisfies` these, the page re-exports them (app/ui/api-types.mts) and the route map names them (app/api/routes.mts).
//
// map: api
// owns: `ImportPasteApiResponse`, `ImportPasteBody`, `RescanApiResponse`

// POST /api/import/paste {text, adapter}: the inbox file the pasted scan was written to and its character; `warning`
// when the scan says it came from another adapter than the one it was filed under.
export interface ImportPasteApiResponse {
  ok: boolean;
  written: string;
  character: string;
  warning?: string | undefined;
}
export interface ImportPasteBody { text: string; adapter: string }
// POST /api/import/rescan {}: the adapters whose inboxes were swept again.
export interface RescanApiResponse {
  ok: boolean;
  adapters: string[];
}
