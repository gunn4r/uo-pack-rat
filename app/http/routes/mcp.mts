// mcp.mts — the built-in MCP server's settings: GET|PUT /api/mcp and POST /api/mcp/token.
//
// The routes, what each takes and answers:
// - `GET /api/mcp` -> {config: {enabled, allowActions, port, token}, live: {listening, port, portBusy}}
// - `PUT /api/mcp` {enabled?, allowActions?}
// - `POST /api/mcp/token` {} (rotate) — the built-in MCP server's settings (`<data>/mcp.json`, app/mcp.mts; it listens on its own port)
//
// map: server
// owns: `routes`
import { short } from "../../guards.mts";
import { readBody } from "../../read-body.mts";
import { send, asObject } from "../respond.mts";
import type { Route } from "../router.mts";
import type { McpApiResponse } from "../../api/mcp.mts";
import type { ServerContext } from "../context.mts";

export function routes(ctx: ServerContext): Route[] {
  const { mcp } = ctx;
  const mcpState = (): McpApiResponse => { const { config: { version: _version, ...config }, live } = mcp.state(); return { ok: true, config, live } satisfies McpApiResponse; };
  return [
    { method: "GET", path: "/api/mcp", handle: (_req, res) => send(res, 200, mcpState()) },
    { method: "PUT", path: "/api/mcp", handle: async (req, res) => {
      // Settings' two switches; the port and token are not set here (the token only by POST /api/mcp/token).
      const body = asObject(await readBody(req, { limit: 8e3 }));
      const unknown = Object.keys(body).find((k) => k !== "enabled" && k !== "allowActions");
      if (unknown) return send(res, 400, { ok: false, error: `${short(unknown)} is not an MCP setting` });
      const bad = (["enabled", "allowActions"] as const).find((k) => k in body && typeof body[k] !== "boolean");
      if (bad) return send(res, 400, { ok: false, error: `${bad} must be a boolean` });
      await mcp.update(body as { enabled?: boolean; allowActions?: boolean });
      return send(res, 200, mcpState());
    } },
    { method: "POST", path: "/api/mcp/token", handle: async (req, res) => {
      const unknown = Object.keys(asObject(await readBody(req, { limit: 8e3 })))[0];
      if (unknown) return send(res, 400, { ok: false, error: `${short(unknown)} is not a field this route takes` });
      mcp.rotateToken();
      return send(res, 200, mcpState());
    } },
  ];
}
