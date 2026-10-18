// mcp.mts — what the MCP settings routes answer and take (app/http/routes/mcp.mts): the built-in MCP server's settings and its listener (app/mcp.mts). Types only and node-free, so the routes `satisfies` these, app/mcp.mts uses them for its own file, the page re-exports them (app/ui/api-types.mts) and the route map names them (app/api/routes.mts).
//
// map: api
// owns: `McpConfig`, `McpLive`, `McpApiResponse`, `McpPutBody`

// <data>/mcp.json. `port` 0 asks the OS for a free port (a hand edit; Settings never writes it). `token` is null
// until MCP is first turned on.
export interface McpConfig { version: 1; enabled: boolean; allowActions: boolean; port: number; token: string | null }
// The listener: `portBusy` names the saved port when another program held it at launch.
export interface McpLive { listening: boolean; port: number | null; portBusy: number | null }
// GET/PUT /api/mcp and POST /api/mcp/token {} (which rotates the token): the settings, less the file's version, and
// the listener.
export interface McpApiResponse {
  ok: boolean;
  config: Omit<McpConfig, "version">;
  live: McpLive;
}
// PUT /api/mcp: Settings' two switches.
export interface McpPutBody { enabled?: boolean; allowActions?: boolean }
