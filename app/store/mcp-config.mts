// mcp-config.mts — <data>/mcp.json (issue #211, app/mcp.mts): the built-in MCP server's switches, port and token, read field by field with each bad one falling back to its default, and written whole.
//
// map: server
// owns: `createMcpConfigStore`, `readMcpConfig`, `writeMcpConfig`, `defaultMcpConfig`, `MCP_DEFAULT_PORT`
import { existsSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { writeFileAtomic } from "../atomic-write.mts";
import { DATA_FILE_MODE } from "../config.mts";
import { migrate } from "../migrate.mts";
import type { McpConfig } from "../api/mcp.mts";

export const MCP_DEFAULT_PORT = 47615;
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

// `warn` gets each read's problems. The MCP server keeps the config in memory and writes it whole on every change.
export function createMcpConfigStore(file: string, warn: (msg: string) => void) {
  return { file, read: (): McpConfig => readMcpConfig(file, warn), write: (cfg: McpConfig): void => writeMcpConfig(file, cfg) };
}
