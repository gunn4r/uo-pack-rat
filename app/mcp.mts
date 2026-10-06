// mcp.mts — Pack Rat's built-in MCP server (issue #211): a second loopback listener inside the server process that
// speaks the stateless subset of MCP's Streamable HTTP transport, so Claude Code and other MCP clients can search the
// inventory, read character sheets and saved runs, run the Suit Builder and, with a second switch, act in game. No MCP
// SDK at run time (docs/threat-model.md: the app ships one runtime dependency): `POST /mcp` takes one JSON-RPC 2.0
// request and answers one `application/json` response — no SSE, no sessions. Methods: initialize (the protocol version
// negotiated from PROTOCOL_VERSIONS), ping, tools/list and tools/call; a notification gets 202 and no body.
//
// Its own port and token, both kept in <data>/mcp.json, so a client's saved config survives restarts: the app
// server's own port and token change every desktop launch. Off by default; turning it on or off opens or closes the
// listener at once. A busy port falls back to an OS-assigned one for this run (live.portBusy), never persisted.
//
// Every request passes, in order, before any MCP handling: Host naming the bound port (403), no Origin header at
// all (403: no web page has a reason to call it, which also closes DNS rebinding and cross-site posts), the path
// (/mcp only, else 404), `Authorization: Bearer <mcp token>` compared timing-safe (401), POST only (405),
// `content-type: application/json` (415) and a 1 MB body (413).
//
// The tools (app/mcp-tools.mts) are thin adapters over the app's own HTTP routes, called over loopback with the app's
// own token, so every validation and safety check stays the route's.
import http from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { randomUUID, timingSafeEqual } from "node:crypto";
import type { AddressInfo } from "node:net";
import { writeFileAtomic } from "./atomic-write.mts";
import { DATA_FILE_MODE } from "./config.mts";
import { validate } from "./schema/validate.mts";
import { INSTRUCTIONS, TOOLS, ToolError, type ToolContext } from "./mcp-tools.mts";
import { isJsonContentType, readBody, type HttpError } from "./read-body.mts";
import { migrate } from "./migrate.mts";

export const MCP_DEFAULT_PORT = 47615;
// Newest first: an initialize naming one of these gets it back, any other gets the newest.
export const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26"];
const MAX_BODY_BYTES = 1024 * 1024;
export const ACTIONS_OFF = "In-game actions are off in Pack Rat's Settings (Allow in-game actions)";

// <data>/mcp.json. `port` 0 asks the OS for a free port (a hand edit; Settings never writes it). `token` is null
// until MCP is first turned on.
export interface McpConfig { version: 1; enabled: boolean; allowActions: boolean; port: number; token: string | null }
export interface McpLive { listening: boolean; port: number | null; portBusy: number | null }
export const defaultMcpConfig = (): McpConfig => ({ version: 1, enabled: false, allowActions: false, port: MCP_DEFAULT_PORT, token: null });
const TOKEN_RE = /^[A-Za-z0-9-]{16,128}$/;

// A file that does not parse, or is not an object, reads as the defaults (off). Otherwise each field that is wrong
// falls back to its default on its own (a switch to off), so one bad field never costs the token; each is logged, and
// the next save replaces the file. A leading BOM (a Windows editor's) is ignored. A file with no usable token gets a
// new one, saved; when it cannot be saved, the error is logged and MCP stays off for this run.
export function readMcpConfig(file: string, warn: (msg: string) => void): McpConfig {
  const cfg = defaultMcpConfig();
  if (!existsSync(file)) return cfg;
  let d: Record<string, unknown> | null = null;
  try {
    const doc: unknown = JSON.parse(readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
    if (doc && typeof doc === "object" && !Array.isArray(doc)) d = migrate("mcp", doc).doc as Record<string, unknown>;
  } catch { d = null; }
  if (!d) { warn("mcp.json does not parse; MCP stays off until a Settings switch replaces the file"); return cfg; }
  const bad: string[] = [];
  if (d.version !== 1) bad.push("version");
  if (typeof d.enabled === "boolean") cfg.enabled = d.enabled; else bad.push("enabled");
  if (typeof d.allowActions === "boolean") cfg.allowActions = d.allowActions; else bad.push("allowActions");
  if (typeof d.port === "number" && Number.isInteger(d.port) && d.port >= 0 && d.port <= 65535) cfg.port = d.port; else bad.push("port");
  if (typeof d.token === "string" && TOKEN_RE.test(d.token)) cfg.token = d.token;
  if (bad.length) warn(`mcp.json: ${bad.join(", ")} not valid, read as the default`);
  if (!cfg.token) {
    cfg.token = randomUUID();
    try { writeMcpConfig(file, cfg); }
    catch (e) { warn(`mcp.json could not be saved with a new token (${(e as Error).message}); MCP stays off`); cfg.enabled = false; }
  }
  return cfg;
}
export function writeMcpConfig(file: string, cfg: McpConfig): void {
  writeFileAtomic(file, JSON.stringify(cfg, null, 2) + "\n", DATA_FILE_MODE);
}

export interface McpOptions {
  file: string;
  version: string;
  // The app server's bound port and its token (null under the bare server), for the tools' loopback calls.
  appPort: () => number;
  appToken: string | null;
  log: (line: string) => void;
}
export interface McpController {
  state(): { config: McpConfig; live: McpLive };
  // {enabled?, allowActions?}: saved, then the listener opened or closed to match before this resolves.
  update(changes: { enabled?: boolean; allowActions?: boolean }): Promise<void>;
  rotateToken(): void;
  // Opens the listener when mcp.json says on; called once the app server listens.
  start(): Promise<void>;
  close(): Promise<void>;
}

const BASE_HEADERS = { "cache-control": "no-store", "x-content-type-options": "nosniff", "x-frame-options": "DENY" };
function reply(res: http.ServerResponse, status: number, body: unknown, extra: Record<string, string> = {}): void {
  if (body === null) { res.writeHead(status, { ...BASE_HEADERS, ...extra }); res.end(); return; }
  res.writeHead(status, { ...BASE_HEADERS, "content-type": "application/json; charset=utf-8", ...extra });
  res.end(JSON.stringify(body));
}
type RpcId = string | number | null;
const rpcError = (id: RpcId, code: number, message: string) => ({ jsonrpc: "2.0", id, error: { code, message } });
const rpcResult = (id: RpcId, result: unknown) => ({ jsonrpc: "2.0", id, result });
export function createMcp(opts: McpOptions): McpController {
  const warn = (msg: string): void => opts.log(`mcp: ${msg}`);
  let config: McpConfig;
  try { config = readMcpConfig(opts.file, warn); }
  catch (e) { warn(`mcp.json could not be read (${(e as Error).message}); MCP stays off`); config = defaultMcpConfig(); }
  let listener: http.Server | null = null, boundPort: number | null = null, portBusy: number | null = null;
  // Opening and closing run one at a time, in the order asked (a quick on/off/on ends on).
  let applying: Promise<void> = Promise.resolve();
  const save = (): void => writeMcpConfig(opts.file, config);

  // The tools' loopback calls to the app's own routes, as the page makes them (with the app token when one is set).
  const ctx: ToolContext = {
    async api(path, { method = "GET", body, clientId } = {}) {
      const headers: Record<string, string> = {};
      if (body !== undefined) headers["content-type"] = "application/json";
      if (opts.appToken) headers.authorization = `Bearer ${opts.appToken}`;
      if (clientId) headers["x-client-id"] = clientId;
      const r = await fetch(`http://127.0.0.1:${opts.appPort()}${path}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
      const data = await r.json().catch(() => ({})) as Record<string, unknown>;
      if (!r.ok) throw new ToolError(typeof data.error === "string" ? data.error : `${method} ${path} failed (${r.status})`);
      return data as never;
    },
    memory: { actions: new Map(), replaced: new Set(), filled: new Set(), plans: new Map() },
    sleep: (ms) => new Promise((ok) => setTimeout(ok, ms).unref()),
  };

  async function callTool(params: Record<string, unknown>): Promise<unknown> {
    const tool = TOOLS.find((t) => t.name === params.name);
    const fail = (text: string) => ({ content: [{ type: "text", text }], isError: true });
    if (!tool) return null;
    const args = params.arguments ?? {};
    if (!args || typeof args !== "object" || Array.isArray(args)) return fail("arguments must be an object");
    const checked = validate(tool.inputSchema, args);
    if (!checked.ok) return fail(`invalid arguments: ${checked.errors.map((e) => `${e.path || "arguments"} ${e.msg}`).join("; ")}`);
    if (tool.action && !config.allowActions) return fail(ACTIONS_OFF);
    try {
      const out = await tool.handler(args as Record<string, unknown>, ctx);
      return { content: [{ type: "text", text: JSON.stringify(out) }], structuredContent: out };
    } catch (e) {
      if (e instanceof ToolError) return fail(e.message);
      const ref = randomUUID().slice(0, 8);
      opts.log(`${new Date().toISOString()} ${ref} mcp tool ${tool.name}\n${(e as Error)?.stack || e}\n`);
      return fail(`internal error (ref ${ref})`);
    }
  }

  async function dispatch(id: RpcId, method: string, params: Record<string, unknown>): Promise<unknown> {
    switch (method) {
      case "initialize": {
        const asked = params.protocolVersion;
        const protocolVersion = typeof asked === "string" && PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0];
        return rpcResult(id, { protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "pack-rat", version: opts.version }, instructions: INSTRUCTIONS });
      }
      case "ping": return rpcResult(id, {});
      case "tools/list": return rpcResult(id, { tools: TOOLS.map(({ name, description, inputSchema, annotations }) => ({ name, description, inputSchema, annotations })) });
      case "tools/call": {
        if (typeof params.name !== "string") return rpcError(id, -32602, "params.name must be a tool name");
        const r = await callTool(params);
        return r ? rpcResult(id, r) : rpcError(id, -32602, `Unknown tool: ${params.name.slice(0, 64)}`);
      }
      default: return rpcError(id, -32601, `Method not found: ${method.slice(0, 64)}`);
    }
  }

  async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      const port = boundPort;
      if (req.headers.host !== `127.0.0.1:${port}` && req.headers.host !== `localhost:${port}`) return reply(res, 403, { error: "forbidden host" });
      if (req.headers.origin != null) return reply(res, 403, { error: "forbidden origin" });
      if ((req.url || "").split("?")[0] !== "/mcp") return reply(res, 404, { error: "not found" });
      const want = Buffer.from(`Bearer ${config.token ?? ""}`), got = Buffer.from(String(req.headers.authorization || ""));
      if (!config.token || got.length !== want.length || !timingSafeEqual(got, want)) return reply(res, 401, { error: "unauthorized" }, { "www-authenticate": "Bearer" });
      if (req.method !== "POST") return reply(res, 405, { error: "method not allowed" }, { allow: "POST" });
      if (!isJsonContentType(req.headers["content-type"])) { req.resume(); return reply(res, 415, { error: "content-type must be application/json" }); }
      const asked = req.headers["mcp-protocol-version"];
      if (asked != null && !PROTOCOL_VERSIONS.includes(String(asked))) { req.resume(); return reply(res, 400, rpcError(null, -32600, `Unsupported MCP-Protocol-Version: ${String(asked).slice(0, 32)}`)); }
      let msg: unknown;
      try { msg = await readBody(req, { limit: MAX_BODY_BYTES, requireBody: true }); }
      catch (e) {
        const status = (e as HttpError).statusCode;
        if (status === 413) { res.setHeader("connection", "close"); return reply(res, 413, { error: "body too large" }); }
        if (status === 400) return reply(res, 400, rpcError(null, -32700, "Parse error"));
        throw e;
      }
      if (Array.isArray(msg)) return reply(res, 400, rpcError(null, -32600, "Batch requests are not supported"));
      const m = msg && typeof msg === "object" ? msg as Record<string, unknown> : null;
      if (!m || m.jsonrpc !== "2.0") return reply(res, 400, rpcError(null, -32600, "Invalid Request"));
      // A notification (no id) or a response to something this server never sends: accepted, nothing to answer. An id
      // with no method name and no result or error is neither.
      if (!("id" in m) || (typeof m.method !== "string" && ("result" in m || "error" in m))) return reply(res, 202, null);
      if (typeof m.method !== "string") return reply(res, 400, rpcError(null, -32600, "Invalid Request: method must be a string"));
      const id = m.id;
      if (typeof id !== "string" && typeof id !== "number") return reply(res, 400, rpcError(null, -32600, "Invalid Request: id must be a string or a number"));
      const params = m.params ?? {};
      if (!params || typeof params !== "object" || Array.isArray(params)) return reply(res, 200, rpcError(id, -32602, "params must be an object"));
      return reply(res, 200, await dispatch(id, m.method, params as Record<string, unknown>));
    } catch (e) {
      const ref = randomUUID().slice(0, 8);
      opts.log(`${new Date().toISOString()} ${ref} mcp ${req.method} ${req.url}\n${(e as Error)?.stack || e}\n`);
      if (!res.headersSent) reply(res, 500, { error: "internal error", ref });
    }
  }

  function listen(port: number): Promise<http.Server> {
    const srv = http.createServer((req, res) => { void handle(req, res); });
    srv.requestTimeout = 300_000; srv.headersTimeout = 60_000;
    return new Promise((resolve, reject) => {
      srv.once("error", reject);
      srv.listen(port, "127.0.0.1", () => { srv.off("error", reject); resolve(srv); });
    });
  }
  async function open(): Promise<void> {
    try { listener = await listen(config.port); portBusy = null; }
    catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EADDRINUSE" || config.port === 0) { opts.log(`mcp: could not listen on port ${config.port}: ${(e as Error).message}`); return; }
      listener = await listen(0);
      portBusy = config.port;
    }
    boundPort = (listener.address() as AddressInfo).port;
  }
  function shut(): Promise<void> {
    const srv = listener;
    listener = null; boundPort = null; portBusy = null;
    if (!srv) return Promise.resolve();
    srv.closeAllConnections();
    return new Promise((ok) => srv.close(() => ok()));
  }
  function apply(): Promise<void> {
    applying = applying.then(async () => {
      if (config.enabled && !listener) await open();
      else if (!config.enabled && listener) await shut();
    }).catch((e: Error) => opts.log(`mcp: ${e.stack || e.message}`));
    return applying;
  }

  return {
    state: () => ({ config: { ...config }, live: { listening: !!listener, port: boundPort, portBusy } }),
    update(changes) {
      config = { ...config, ...changes };
      if (config.enabled && !config.token) config.token = randomUUID();
      save();
      return apply();
    },
    // The new token takes effect on the next request: every client holding the old one is refused from then on.
    rotateToken() { config = { ...config, token: randomUUID() }; save(); },
    start: () => apply(),
    close: () => { config = { ...config, enabled: false }; return apply(); },
  };
}
