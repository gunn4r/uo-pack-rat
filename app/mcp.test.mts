// mcp.test.mts — the built-in MCP server (issue #211; app/mcp.mts, app/mcp-tools.mts) against a real listening app
// server on a temp data folder: the JSON-RPC subset (initialize and its version negotiation, notifications, errors,
// no batches, the protocol-version header), the listener's guards (Host, Origin, token, content type, body size),
// GET/PUT /api/mcp and the token rotation, the switch opening and closing the listener at run time, a busy port, every
// read tool over the demo fixtures with its paging, a build, the in-game tools behind their switch writing the same
// queue line the app's own routes write, and the MCP SDK's own client talking to the endpoint. Tags: [fast].
// Run: node --test app/mcp.test.mts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, statSync, mkdirSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import http from "node:http";
import { createServer as createNetServer, type Server as NetServer } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { resolveConfig, ensureLayout } from "./config.mts";
import type { ServerHandle } from "./vault-server.mts";
import { startTestServer } from "./server-fixture.mts";
import { houseScan } from "./organize-fixture.mts";
import { emptyRuleQuery, emptyOrganizeConfig, type OrganizeConfig } from "./organize-config.mts";
import { ACTIONS_OFF, MCP_DEFAULT_PORT, PROTOCOL_VERSIONS } from "./mcp.mts";
import { BRIDGE_OFFLINE, RESIST_KEYS, characterProfile, type ProfilesFile } from "./vault-lib.mts";
import { applyBuffs, buffSkillValues } from "./buffs.mts";

const TOKEN = "test-mcp-token-0123456789";
const VERSION = (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }).version;
const KESTREL_CHEST = 1879769088;

interface Served { s: ServerHandle; dir: string; appToken: string | null }
// A server on a temp data folder. `mcp` is written as mcp.json first (port 0: any free port, so tests never race each
// other or a Pack Rat running on this machine for 47615); null writes none.
async function serve({ mcp = { enabled: true, allowActions: false }, demo = true, appToken = null, before, env = {} }: { mcp?: Record<string, unknown> | null; demo?: boolean; appToken?: string | null; before?: (dir: string) => void; env?: NodeJS.ProcessEnv } = {}): Promise<Served> {
  const dir = mkdtempSync(join(tmpdir(), "qm-mcp-"));
  if (mcp) writeFileSync(join(dir, "mcp.json"), JSON.stringify({ version: 1, port: 0, token: TOKEN, ...mcp }));
  const config = ensureLayout(resolveConfig(["--port", "0", "--data", dir, ...(demo ? ["--demo"] : []), ...(appToken ? ["--token", appToken] : [])], env));
  before?.(dir);
  const s = await startTestServer(config);
  return { s, dir, appToken };
}
interface McpState { ok: boolean; config: { enabled: boolean; allowActions: boolean; port: number; token: string | null }; live: { listening: boolean; port: number | null; portBusy: number | null } }
async function app<T = Record<string, unknown>>(sv: Served, path: string, method = "GET", body?: unknown): Promise<{ status: number; body: T }> {
  const headers: Record<string, string> = { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(sv.appToken ? { authorization: `Bearer ${sv.appToken}` } : {}) };
  const r = await fetch(sv.s.url + path, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  return { status: r.status, body: (await r.json()) as T };
}
const mcpState = async (sv: Served): Promise<McpState> => (await app<McpState>(sv, "/api/mcp")).body;
const mcpPort = async (sv: Served): Promise<number> => (await mcpState(sv)).live.port!;

// One raw request to the MCP listener, every header under the test's control (fetch would set Host and refuse others).
interface Raw { status: number; headers: http.IncomingHttpHeaders; text: string; json: Record<string, any> | null }
function raw(port: number, { method = "POST", path = "/mcp", headers = {}, body }: { method?: string; path?: string; headers?: Record<string, string>; body?: string | Buffer } = {}): Promise<Raw> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, method, path, agent: false, headers: { host: `127.0.0.1:${port}`, ...headers } }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let json: Record<string, any> | null = null;
        try { json = text ? JSON.parse(text) : null; } catch { json = null; }
        resolve({ status: res.statusCode!, headers: res.headers, text, json });
      });
    });
    req.on("error", reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}
const AUTH = { "content-type": "application/json", authorization: `Bearer ${TOKEN}` };
let nextId = 1;
const rpc = (port: number, method: string, params?: unknown, headers: Record<string, string> = {}): Promise<Raw> =>
  raw(port, { headers: { ...AUTH, ...headers }, body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, ...(params !== undefined ? { params } : {}) }) });
// tools/call: the result's structuredContent, or the error text when the tool answered isError.
async function call(port: number, name: string, args: Record<string, unknown> = {}): Promise<{ ok: boolean; data: Record<string, any>; text: string }> {
  const r = await rpc(port, "tools/call", { name, arguments: args });
  assert.equal(r.status, 200, r.text);
  const res = r.json!.result;
  assert.ok(res, r.text);
  return { ok: !res.isError, data: res.structuredContent ?? {}, text: res.content[0].text };
}

test("[fast] initialize negotiates the protocol version and says who it is, with the usage instructions", async () => {
  const sv = await serve();
  try {
    const port = await mcpPort(sv);
    for (const v of PROTOCOL_VERSIONS) assert.equal((await rpc(port, "initialize", { protocolVersion: v, capabilities: {}, clientInfo: { name: "t", version: "1" } })).json!.result.protocolVersion, v);
    const r = (await rpc(port, "initialize", { protocolVersion: "1999-01-01", capabilities: {}, clientInfo: { name: "t", version: "1" } })).json!.result;
    assert.equal(r.protocolVersion, PROTOCOL_VERSIONS[0]);
    assert.deepEqual(r.serverInfo, { name: "pack-rat", version: VERSION });
    assert.deepEqual(r.capabilities, { tools: {} });
    assert.match(r.instructions, /Allow in-game actions/);
    assert.match(r.instructions, /search_items/);
    assert.deepEqual((await rpc(port, "ping")).json!.result, {});
  } finally { await sv.s.close(); }
});

test("[fast] JSON-RPC edges: notifications, unknown methods and tools, parse errors, batches, the protocol-version header", async () => {
  const sv = await serve();
  try {
    const port = await mcpPort(sv);
    const note = await raw(port, { headers: AUTH, body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) });
    assert.equal(note.status, 202);
    assert.equal(note.text, "");
    assert.equal((await rpc(port, "resources/list")).json!.error.code, -32601);
    assert.equal((await rpc(port, "tools/call", { name: "no_such_tool", arguments: {} })).json!.error.code, -32602);
    for (const body of ["{oops", ""]) {
      const parse = await raw(port, { headers: AUTH, body });
      assert.deepEqual([parse.status, parse.json!.error.code], [400, -32700], JSON.stringify(body));
    }
    const batch = await raw(port, { headers: AUTH, body: JSON.stringify([{ jsonrpc: "2.0", id: 1, method: "ping" }]) });
    assert.equal(batch.status, 400);
    assert.equal(batch.json!.error.code, -32600);
    assert.equal((await rpc(port, "ping", undefined, { "mcp-protocol-version": "2024-01-01" })).status, 400);
    assert.equal((await rpc(port, "ping", undefined, { "mcp-protocol-version": "2025-06-18" })).status, 200);
    // Arguments the tool's schema refuses come back as a tool error, never a protocol error.
    const bad = await call(port, "search_items", { limit: 101 });
    assert.equal(bad.ok, false);
    assert.match(bad.text, /limit/);
    assert.match((await call(port, "search_items", { nope: 1 })).text, /nope/);
    // An id with no method is an invalid request, not a notification; a response to nothing is accepted quietly.
    const noMethod = await raw(port, { headers: AUTH, body: JSON.stringify({ jsonrpc: "2.0", id: 7 }) });
    assert.deepEqual([noMethod.status, noMethod.json!.error.code], [400, -32600]);
    assert.equal((await raw(port, { headers: AUTH, body: JSON.stringify({ jsonrpc: "2.0", id: 7, result: {} }) })).status, 202);
    // The content type's case and its parameters don't matter; another type is refused.
    const ping = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" });
    assert.equal((await raw(port, { headers: { ...AUTH, "content-type": "Application/JSON; charset=utf-8" }, body: ping })).status, 200);
    assert.equal((await raw(port, { headers: { ...AUTH, "content-type": "application/jsonx" }, body: ping })).status, 415);
  } finally { await sv.s.close(); }
});

test("[fast] the listener's guards: Host, any Origin, the token, POST only, the content type and a 1 MB body", async () => {
  const sv = await serve();
  try {
    const port = await mcpPort(sv);
    const ping = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" });
    assert.equal((await raw(port, { headers: { ...AUTH, host: `evil.example:${port}` }, body: ping })).status, 403);
    assert.equal((await raw(port, { headers: { ...AUTH, host: `localhost:${port}` }, body: ping })).status, 200);
    assert.equal((await raw(port, { headers: { ...AUTH, origin: `http://127.0.0.1:${port}` }, body: ping })).status, 403, "even its own origin");
    assert.equal((await raw(port, { headers: { ...AUTH, origin: "https://evil.example" }, body: ping })).status, 403);
    assert.equal((await raw(port, { headers: { "content-type": "application/json" }, body: ping })).status, 401);
    assert.equal((await raw(port, { headers: { ...AUTH, authorization: "Bearer wrong" }, body: ping })).status, 401);
    assert.equal((await raw(port, { method: "GET", headers: AUTH })).status, 405);
    assert.equal((await raw(port, { method: "DELETE", headers: AUTH })).status, 405);
    assert.equal((await raw(port, { path: "/api/inventory", method: "GET", headers: AUTH })).status, 404);
    assert.equal((await raw(port, { headers: { ...AUTH, "content-type": "text/plain" }, body: ping })).status, 415);
    const big = await raw(port, { headers: AUTH, body: Buffer.alloc(1024 * 1024 + 10, 0x20) });
    assert.equal(big.status, 413);
  } finally { await sv.s.close(); }
});

test("[fast] off by default; GET/PUT /api/mcp turn it on and off at once; a bad body is refused", async () => {
  const fresh = await serve({ mcp: null });
  try {
    const st = await mcpState(fresh);
    assert.deepEqual(st.config, { enabled: false, allowActions: false, port: MCP_DEFAULT_PORT, token: null });
    assert.deepEqual(st.live, { listening: false, port: null, portBusy: null });
    assert.equal(existsSync(join(fresh.dir, "mcp.json")), false, "nothing written until it is turned on");
  } finally { await fresh.s.close(); }
  const sv = await serve({ mcp: { enabled: false, allowActions: false } });
  try {
    for (const bad of [{ enabled: "yes" }, { port: 1 }, { token: "x" }, [true], null]) assert.equal((await app(sv, "/api/mcp", "PUT", bad)).status, 400, JSON.stringify(bad));
    assert.equal((await app(sv, "/api/mcp/token", "POST", { x: 1 })).status, 400);
    const on = (await app<McpState>(sv, "/api/mcp", "PUT", { enabled: true })).body;
    assert.equal(on.live.listening, true);
    const port = on.live.port!;
    assert.equal((await rpc(port, "ping")).status, 200);
    const saved = JSON.parse(readFileSync(join(sv.dir, "mcp.json"), "utf8"));
    assert.deepEqual(saved, { version: 1, enabled: true, allowActions: false, port: 0, token: TOKEN });
    if (process.platform !== "win32") assert.equal(statSync(join(sv.dir, "mcp.json")).mode & 0o777, 0o600);
    const off = (await app<McpState>(sv, "/api/mcp", "PUT", { enabled: false })).body;
    assert.deepEqual(off.live, { listening: false, port: null, portBusy: null });
    await assert.rejects(rpc(port, "ping"), /ECONNREFUSED/);
    assert.equal((await app<McpState>(sv, "/api/mcp", "PUT", { allowActions: true })).body.config.allowActions, true);
  } finally { await sv.s.close(); }
});

test("[fast] a new token takes over at once, and a file without one gets one", async () => {
  const sv = await serve({ mcp: { enabled: true, allowActions: false, token: undefined } });
  try {
    const st = await mcpState(sv);
    assert.match(String(st.config.token), /^[0-9a-f-]{36}$/);
    assert.equal(JSON.parse(readFileSync(join(sv.dir, "mcp.json"), "utf8")).token, st.config.token);
    const port = st.live.port!;
    const old = st.config.token!;
    assert.equal((await rpc(port, "ping", undefined, { authorization: `Bearer ${old}` })).status, 200);
    const next = (await app<McpState>(sv, "/api/mcp/token", "POST", {})).body.config.token!;
    assert.notEqual(next, old);
    assert.equal((await rpc(port, "ping", undefined, { authorization: `Bearer ${old}` })).status, 401);
    assert.equal((await rpc(port, "ping", undefined, { authorization: `Bearer ${next}` })).status, 200);
    assert.equal(JSON.parse(readFileSync(join(sv.dir, "mcp.json"), "utf8")).token, next);
  } finally { await sv.s.close(); }
});

test("[fast] a busy port falls back to a free one for this run, and a broken mcp.json reads as off", async () => {
  const blocker: NetServer = createNetServer();
  await new Promise<void>((ok) => blocker.listen(0, "127.0.0.1", ok));
  const taken = (blocker.address() as { port: number }).port;
  const sv = await serve({ mcp: { enabled: true, allowActions: false, port: taken } });
  try {
    const st = await mcpState(sv);
    assert.equal(st.live.listening, true);
    assert.equal(st.live.portBusy, taken);
    assert.notEqual(st.live.port, taken);
    assert.equal((await rpc(st.live.port!, "ping")).status, 200);
    assert.equal(JSON.parse(readFileSync(join(sv.dir, "mcp.json"), "utf8")).port, taken, "the fallback is not saved");
  } finally { await sv.s.close(); blocker.close(); }
});

test("[fast] a hand-edited mcp.json: a bad field falls back alone and keeps the token, a BOM is ignored, an unwritable folder leaves MCP off", async () => {
  const oneBad = await serve({ mcp: null, before: (dir) => writeFileSync(join(dir, "mcp.json"), JSON.stringify({ version: 1, enabled: "yes", allowActions: true, port: 0, token: TOKEN })) });
  try {
    const st = await mcpState(oneBad);
    assert.deepEqual(st.config, { enabled: false, allowActions: true, port: 0, token: TOKEN });
    assert.match(readFileSync(join(oneBad.dir, "logs", "server.log"), "utf8"), /mcp\.json: enabled not valid, read as the default/);
  } finally { await oneBad.s.close(); }
  const bom = await serve({ mcp: null, before: (dir) => writeFileSync(join(dir, "mcp.json"), "\uFEFF" + JSON.stringify({ version: 1, enabled: true, allowActions: false, port: 0, token: TOKEN })) });
  try {
    const st = await mcpState(bom);
    assert.equal(st.live.listening, true);
    assert.equal((await rpc(st.live.port!, "ping")).status, 200);
  } finally { await bom.s.close(); }
  for (const text of ["{oops", ""]) {
    const broken = await serve({ mcp: null, before: (dir) => writeFileSync(join(dir, "mcp.json"), text) });
    try { assert.deepEqual((await mcpState(broken)).config, { enabled: false, allowActions: false, port: MCP_DEFAULT_PORT, token: null }); }
    finally { await broken.s.close(); }
  }
  if (process.platform === "win32") return;   // folder modes do not stop a write there
  let dir = "";
  const locked = await serve({ mcp: null, before: (d) => { dir = d; writeFileSync(join(d, "mcp.json"), JSON.stringify({ version: 1, enabled: true, allowActions: false, port: 0 })); chmodSync(d, 0o500); } });
  try {
    const st = await mcpState(locked);
    assert.equal(st.live.listening, false);
    assert.match(readFileSync(join(dir, "logs", "server.log"), "utf8"), /could not be saved with a new token.*MCP stays off/);
  } finally { chmodSync(dir, 0o700); await locked.s.close(); }
});

test("[fast] the read tools over the demo fixtures, with their paging", async () => {
  const sv = await serve();
  try {
    const port = await mcpPort(sv);
    const facets = (await call(port, "inventory_facets")).data;
    assert.deepEqual(facets.characters, ["Dorran", "Kestrel"]);
    assert.ok(facets.properties.some((p: { key: string; name: string }) => p.key === "lrc" && /Reagent/.test(p.name)));
    const all = (await call(port, "search_items", { props: ["lrc:1"] })).data;
    assert.ok(all.total > 3);
    const page = (await call(port, "search_items", { props: ["lrc:1"], limit: 2, offset: 1, sort: "lrc" })).data;
    assert.equal(page.total, all.total);
    assert.equal(page.items.length, 2);
    for (const it of page.items) assert.ok(it.props.lrc >= 1 && typeof it.where === "string" && it.lines === undefined && (it.wornBy || (it.root > 0 && it.container > 0)), JSON.stringify(it));
    assert.ok(page.items[0].props.lrc >= page.items[1].props.lrc, "highest first");
    assert.equal((await call(port, "search_items", { limit: 100 })).data.items.length, 100);
    const grouped = (await call(port, "search_items", { kind: ["reagent"], group: true })).data;
    assert.ok(grouped.groups.length > 0 && grouped.groups[0].amount > 0);
    const serial = page.items[0].serial;
    const item = (await call(port, "get_item", { serials: [serial, 4242] })).data;
    assert.equal(item.items[0].serial, serial);
    assert.ok(Array.isArray(item.items[0].lines) && item.items[0].lines.length > 0);
    assert.deepEqual(item.missing, [4242]);
    const box = (await call(port, "container_contents", { serial: KESTREL_CHEST, limit: 5 })).data;
    assert.equal(box.container.serial, KESTREL_CHEST);
    assert.equal(box.items.length, 5);
    assert.ok(box.total > 5);
    assert.equal((await call(port, "container_contents", { serial: 1 })).ok, false);
    const chars = (await call(port, "list_characters")).data.characters;
    assert.deepEqual(chars.map((c: { name: string }) => c.name), ["Dorran", "Kestrel"]);
    const sheet = (await call(port, "character_sheet", { character: "Kestrel" })).data;
    assert.ok(sheet.worn.length > 0 && Object.keys(sheet.wornTotals).length > 0 && sheet.stats.str === 70);
    assert.match((await call(port, "character_sheet", { character: "Nobody" })).text, /no scans for character "Nobody"/);
    const kinds = (await call(port, "list_item_kinds")).data;
    assert.ok(kinds.kinds.some((k: { name: string }) => k.name === "gear"));
    assert.deepEqual(kinds.playerSet, { names: {}, graphics: {} });
    const scrolls = (await call(port, "list_scrolls")).data;
    assert.ok(scrolls.total > 0 && scrolls.groups.every((g: { name: string }) => /Scroll Of/i.test(g.name)));
    const status = (await call(port, "scan_status")).data;
    assert.equal(status.scans, 2);
    assert.equal(status.bridge.online, false);
    const plan = (await call(port, "organize_plan")).data;
    assert.equal(typeof plan.stamp, "string");
    const proposal = (await call(port, "organize_proposal", { strategy: "simple" })).data;
    assert.ok(Array.isArray(proposal.groups) && proposal.config === undefined && proposal.plan);
  } finally { await sv.s.close(); }
});

test("[fast] search_items: property rules the route cannot parse are refused, and filters match whatever their case", async () => {
  const sv = await serve();
  try {
    const port = await mcpPort(sv);
    for (const rule of ["lrc:lt:20", "lrc", "lrc:", ":20", "lrc:eq:abc", "lrc:ge"]) {
      const r = await call(port, "search_items", { props: [rule] });
      assert.equal(r.ok, false, rule);
      assert.match(r.text, /is not one of key:min, key:le:max, key:eq:value/, rule);
    }
    assert.match((await call(port, "search_items", { props: ["nosuchkey:5"] })).text, /no item has the property "nosuchkey"/);
    const total = async (args: Record<string, unknown>): Promise<number> => { const r = await call(port, "search_items", args); assert.equal(r.ok, true, r.text); return r.data.total; };
    assert.equal(await total({ props: ["LRC:20"] }), await total({ props: ["lrc:20"] }));
    // The extras the Inventory's property filter also offers.
    for (const rule of ["strReq:le:60", "weight:le:5"]) assert.ok(await total({ props: [rule] }) > 0, rule);
    assert.ok(((await call(port, "inventory_facets")).data.extraKeys as string[]).includes("strReq"));
    for (const [upper, lower] of [[{ slot: ["Ring"] }, { slot: ["ring"] }], [{ kind: ["Gear"] }, { kind: ["gear"] }], [{ tags: ["Cursed"] }, { tags: ["cursed"] }], [{ slot: ["ONEHANDED"] }, { slot: ["oneHanded"] }]] as const) {
      const n = await total(lower);
      assert.ok(n > 0, JSON.stringify(lower));
      assert.equal(await total(upper), n, JSON.stringify(upper));
    }
    const slayer = ((await call(port, "inventory_facets")).data.slayers as Array<{ name: string }>)[0]!.name;
    assert.equal(await total({ slayer: slayer.toUpperCase() }), await total({ slayer }));
  } finally { await sv.s.close(); }
});

test("[fast] score_suit keeps the hands legal around a named weapon, and plans with Manual's buffs", async () => {
  const sv = await serve();
  try {
    const port = await mcpPort(sv);
    const HALBERD = 1879769175, WAR_AXE = 1879769094, KATANA = 1879834650, SHIELD = 1879769093;
    const k = (await call(port, "score_suit", { character: "Kestrel", pieces: [HALBERD] })).data;
    assert.equal(k.suit.twoHanded.serial, HALBERD);
    assert.equal(k.suit.oneHanded, undefined, "the worn War Axe stays out beside a two-hander");
    assert.match((await call(port, "score_suit", { character: "Kestrel", pieces: [HALBERD, WAR_AXE] })).text, /two-handed weapon leaves the one-hand slot empty/);
    const d = (await call(port, "score_suit", { character: "Dorran", pieces: [KATANA] })).data;
    assert.equal(d.suit.oneHanded.serial, KATANA);
    assert.equal(d.suit.twoHanded, undefined, "the worn two-handed staff stays out beside a one-hander");
    const shield = (await call(port, "score_suit", { character: "Kestrel", pieces: [KATANA] })).data;
    assert.equal(shield.suit.twoHanded.serial, SHIELD, "a worn shield stays beside a one-hander");
    // With no buffs named, the ones Manual counts: its own list while its totals count buffs, none while they don't.
    assert.deepEqual((await call(port, "score_suit", { character: "Kestrel" })).data.buffs, []);
    assert.equal((await app(sv, "/api/ui-prefs", "PUT", { manualBuffs: ["divineFury"] })).status, 200);
    assert.deepEqual((await call(port, "score_suit", { character: "Kestrel" })).data.buffs, ["divineFury"]);
    assert.deepEqual((await call(port, "build_suit", { character: "Kestrel", timeBudgetSeconds: 2 })).data.buffs, [], "Automatic's buffs for an unpinned build");
    assert.equal((await app(sv, "/api/ui-prefs", "PUT", { buffsCount: "off" })).status, 200);
    assert.deepEqual((await call(port, "score_suit", { character: "Kestrel" })).data.buffs, []);
  } finally { await sv.s.close(); }
});

test("[fast] a build replaced by a newer build_suit call says so", async () => {
  const core = join(mkdtempSync(join(tmpdir(), "qm-core-park-")), "optimizer-core.mts");
  writeFileSync(core, "export function optimizeSuit() {\n  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);\n  return {};\n}\n");
  const sv = await serve({ env: { PACKRAT_CORE: core, PACKRAT_NO_HIGHS: "1" } });
  try {
    const port = await mcpPort(sv);
    const first = (await call(port, "build_suit", { character: "Kestrel", waitSeconds: 0 })).data;
    assert.equal(first.state, "running", JSON.stringify(first));
    const second = (await call(port, "build_suit", { character: "Dorran", waitSeconds: 0 })).data;
    assert.equal(second.superseded, first.id);
    const old = (await call(port, "get_suit_build", { id: first.id })).data;
    assert.deepEqual([old.state, old.error], ["cancelled", "replaced by a newer build_suit call (one build_suit runs at a time)"]);
  } finally { await sv.s.close(); }
});

test("[fast] build_suit runs the Suit Builder for a character and saves the run; the run tools read it back", async () => {
  const sv = await serve();
  try {
    const port = await mcpPort(sv);
    const k = (await call(port, "build_suit", { character: "Kestrel", timeBudgetSeconds: 2, waitSeconds: 45 })).data;
    assert.equal(k.state, "done", JSON.stringify(k));
    assert.ok(k.runId && k.suit && k.totals && k.method);
    const again = (await call(port, "build_suit", { character: "Kestrel", timeBudgetSeconds: 2 })).data;
    assert.equal(again.reused, true, "the same inputs reuse the saved run, as the page's build does");
    const d = (await call(port, "build_suit", { character: "Dorran", buffs: ["divineFury"], timeBudgetSeconds: 2 })).data;
    assert.equal(d.state, "done", JSON.stringify(d));
    assert.deepEqual(d.buffs, ["divineFury"]);
    const status = (await call(port, "get_suit_build", { id: d.id })).data;
    assert.equal(status.state, "done");
    const runs = (await call(port, "list_runs")).data;
    assert.equal(runs.total, 2);
    assert.equal((await call(port, "list_runs", { character: "Kestrel" })).data.total, 1);
    const run = (await call(port, "get_run", { id: k.runId })).data;
    assert.deepEqual(run.suit, k.suit);
    const cmp = (await call(port, "compare_runs", { ids: [k.runId, d.runId] })).data;
    assert.equal(cmp.runs.length, 2);
    assert.ok(Object.values(cmp.slots).every((names) => (names as unknown[]).length === 2));
    assert.equal((await call(port, "build_suit", { character: "Kestrel", noCharacter: true })).ok, false);
    assert.match((await call(port, "build_suit", { character: "Kestrel", template: "Nope" })).text, /no template named "Nope"/);
    assert.equal((await call(port, "build_suit", { character: "Kestrel", pinned: {}, timeBudgetSeconds: 2 })).data.reused, true, "an empty pinned map is no pins");
    // Any piece of the built suit, pinned in its slot.
    const [pinSlot, ring] = Object.entries(k.suit as Record<string, { serial: number } | null>).find(([, it]) => it)!;
    {
      const pinned = (await call(port, "build_suit", { character: "Kestrel", pinned: { [pinSlot]: ring!.serial }, timeBudgetSeconds: 2 })).data;
      assert.equal(pinned.state, "done", JSON.stringify(pinned));
      assert.equal(pinned.currentScore, undefined, "a fill's currentScore is the pins' own, left out");
      assert.equal(pinned.suit[pinSlot].serial, ring!.serial);
      // Followed with get_suit_build instead, the same fill still leaves it out.
      const started = (await call(port, "build_suit", { character: "Kestrel", pinned: { [pinSlot]: ring!.serial }, timeBudgetSeconds: 3, waitSeconds: 0 })).data;
      let polled: Record<string, any> = started;
      for (let i = 0; i < 200 && polled.state === "running"; i++) { await new Promise((ok) => setTimeout(ok, 25)); polled = (await call(port, "get_suit_build", { id: started.id })).data; }
      assert.equal(polled.state, "done", JSON.stringify(polled));
      assert.equal(polled.currentScore, undefined);
    }
    const fill = (await call(port, "build_suit", { noCharacter: true, timeBudgetSeconds: 2 })).data;
    assert.equal(fill.state, "done", JSON.stringify(fill));
    assert.equal((await call(port, "list_runs")).data.total, 2, "a No character fill is not saved");
    // No pieces named: what Kestrel wears now.
    const worn = (await call(port, "character_sheet", { character: "Kestrel" })).data.worn as Array<{ serial: number }>;
    const score = (await call(port, "score_suit", { character: "Kestrel" })).data;
    assert.deepEqual(Object.values(score.suit).map((p) => (p as { serial: number }).serial).sort(), worn.map((w) => w.serial).sort());
    assert.ok(Array.isArray(score.requirements) && Object.keys(score.totals).length > 0);
    const piece = Object.values(k.suit).find(Boolean) as { serial: number };
    const picked = (await call(port, "score_suit", { character: "Kestrel", pieces: [piece.serial], keepWorn: false })).data;
    assert.deepEqual(Object.values(picked.suit).map((p) => (p as { serial: number }).serial), [piece.serial]);
  } finally { await sv.s.close(); }
});

test("[fast] suit results carry effectiveTotals beside the gear totals, and unreachableFloors where a hard floor is out of reach (issue #216)", async () => {
  const sv = await serve();
  try {
    const port = await mcpPort(sv);
    // score_suit: resists as on the paperdoll, Divine Fury's shares counted
    const { values } = buffSkillValues(null, {});
    const share = (k: string): number => (applyBuffs({}, {}, ["divineFury"], values, null).shares[k] || []).reduce((n, x) => n + x.value, 0);
    const s = (await call(port, "score_suit", { character: "Kestrel", buffs: ["divineFury"] })).data;
    const eff = s.effectiveTotals as Record<string, number>, gear = s.totals as Record<string, number>;
    for (const k of RESIST_KEYS) assert.equal(eff[k] ?? 0, (gear[k] ?? 0) + s.resistBonus, k);
    for (const k of ["dci", "hci", "ssi"]) assert.equal(eff[k] ?? 0, (gear[k] ?? 0) + share(k), k);
    assert.equal(share("dci") < 0, true, "Divine Fury lowers DCI");
    // a hard floor no piece reaches, on Kestrel's saved profile
    const { profiles } = (await app<{ profiles: ProfilesFile }>(sv, "/api/profiles")).body;
    const kestrel = { ...characterProfile(profiles, "Kestrel"), floors: { luck: 100000 }, softFloors: [] };
    assert.equal((await app(sv, "/api/profiles", "PUT", { ...profiles, characters: { ...profiles.characters, Kestrel: kestrel } })).status, 200);
    const b = (await call(port, "build_suit", { character: "Kestrel", buffs: ["divineFury"], timeBudgetSeconds: 2, waitSeconds: 45 })).data;
    assert.equal(b.state, "done", JSON.stringify(b));
    assert.deepEqual(b.unreachableFloors, ["luck"]);
    assert.ok(b.effectiveTotals && Object.keys(b.effectiveTotals).length, JSON.stringify(b));
    assert.equal(b.effectiveTotals.dci ?? 0, (b.totals.dci ?? 0) + share("dci"));
    const polled = (await call(port, "get_suit_build", { id: b.id })).data;
    assert.deepEqual([polled.effectiveTotals, polled.unreachableFloors], [b.effectiveTotals, ["luck"]]);
    const run = (await call(port, "get_run", { id: b.runId })).data;
    assert.deepEqual([run.effectiveTotals, run.unreachableFloors], [b.effectiveTotals, ["luck"]], "a saved run, evaluated from its settings, agrees with the build");
    const again = (await call(port, "build_suit", { character: "Kestrel", buffs: ["divineFury"], timeBudgetSeconds: 2 })).data;
    assert.deepEqual([again.reused, again.effectiveTotals, again.unreachableFloors], [true, b.effectiveTotals, ["luck"]]);
  } finally { await sv.s.close(); }
});

// A house: chest A on the ground holding bag BAG (with a gem in it) and a loose reagent; chest B beside it. The bridge
// is "running" (a fresh status.json) on Tester.
const A = 0x40000001, B = 0x40000002, BAG = 0x40000003, GEM = 0x40001001, REAG = 0x40001002;
const HOUSE_CONFIG: OrganizeConfig = { ...emptyOrganizeConfig(),
  labels: { [String(A)]: { serial: A, name: "Storage", origin: "manual" }, [String(B)]: { serial: B, name: "Reagents", origin: "manual" } },
  rules: [{ id: "reagents", name: "Reagents", match: { query: { ...emptyRuleQuery(), kind: ["reagent"] } }, targets: [B], origin: "manual" }] };
function house(dir: string): void {
  writeFileSync(join(dir, "scans", "house.json"), JSON.stringify(houseScan({ scannedAt: new Date(Date.now() - 3600e3).toISOString(),
    boxes: [{ serial: A, pos: { x: 100, y: 100, z: 0, facet: 1 } }, { serial: BAG, parent: A, name: "Gem Bag" }, { serial: B, pos: { x: 102, y: 100, z: 0, facet: 1 } }],
    things: [{ serial: GEM, name: "Sapphire", in: BAG }, { serial: REAG, name: "Black Pearl", in: A }] })));
  writeFileSync(join(dir, "organize.json"), JSON.stringify(HOUSE_CONFIG));
}
function bridgeAlive(dir: string, results: Record<string, unknown> = {}, current: unknown = null): void {
  mkdirSync(join(dir, "bridge", "tazuo"), { recursive: true });
  writeFileSync(join(dir, "bridge", "tazuo", "status.json"), JSON.stringify({ alive: new Date().toISOString(), character: "Tester", current, results, counts: { done: 0, failed: 0 } }));
}
const queued = (dir: string): Record<string, unknown>[] => {
  const f = join(dir, "bridge", "tazuo", "queue.jsonl");
  return existsSync(f) ? readFileSync(f, "utf8").trim().split("\n").map((l) => JSON.parse(l) as Record<string, unknown>) : [];
};
const command = ({ id: _id, queuedAt: _at, ...rest }: Record<string, unknown>): Record<string, unknown> => rest;

test("[fast] in-game tools are refused while the switch is off; stop_actions works regardless", async () => {
  const sv = await serve({ demo: false, before: house });
  try {
    const port = await mcpPort(sv);
    for (const [name, args] of [["highlight_item", { serial: GEM }], ["go_to_item", { serial: GEM }], ["grab_item", { serial: GEM }], ["organize_trip", { index: 1, stamp: "x" }]] as const) {
      const r = await call(port, name, args);
      assert.equal(r.ok, false, name);
      assert.equal(r.text, ACTIONS_OFF);
    }
    assert.deepEqual(queued(sv.dir), []);
    assert.equal((await call(port, "stop_actions")).ok, true);
    assert.equal(existsSync(join(sv.dir, "bridge", "stop")), true);
    const tools = (await rpc(port, "tools/list")).json!.result.tools as Array<{ name: string }>;
    assert.ok(["highlight_item", "grab_item", "go_to_item", "organize_trip", "stop_actions"].every((n) => tools.some((t) => t.name === n)), "listed whether or not they may run");
  } finally { await sv.s.close(); }
});

test("[fast] with actions allowed, Grab / Highlight / Go to queue the line the app's own route writes, and refuse like its buttons", async () => {
  const sv = await serve({ demo: false, mcp: { enabled: true, allowActions: true }, before: house });
  try {
    const port = await mcpPort(sv);
    assert.equal((await call(port, "grab_item", { serial: GEM, waitSeconds: 0 })).text, BRIDGE_OFFLINE);
    bridgeAlive(sv.dir);
    const grab = await call(port, "grab_item", { serial: GEM, waitSeconds: 0 });
    assert.equal(grab.ok, true, grab.text);
    assert.deepEqual([grab.data.state, grab.data.queuedFor, grab.data.item], ["queued", "Tester", "Sapphire"]);
    const [line] = queued(sv.dir);
    assert.equal(line!.id, grab.data.id);
    // The page's Grab button sends this body for the same item (ui/bridge.mts's sendBridge: chain root → bag, the root's position).
    const ui = await app(sv, "/api/bridge", "POST", { action: "grab", serial: GEM, name: "Sapphire", chain: [A, BAG], pos: { x: 100, y: 100, z: 0, facet: 1 }, location: "ignored" });
    assert.equal(ui.status, 200);
    const lines = queued(sv.dir);
    assert.equal(lines.length, 2);
    assert.deepEqual(command(lines[0]!), command(lines[1]!));
    assert.equal((await call(port, "highlight_item", { serial: B, waitSeconds: 0 })).ok, true, "a ground chest, by its serial");
    assert.deepEqual(command(queued(sv.dir)[2]!), { action: "highlight", serial: B, name: "Box " + B, chain: [], pos: { x: 102, y: 100, z: 0, facet: 1 } });
    assert.equal((await call(port, "go_to_item", { serial: REAG, waitSeconds: 0 })).ok, true);
    assert.deepEqual((queued(sv.dir)[3]!).chain, [A]);
    assert.match((await call(port, "grab_item", { serial: A })).text, /Grab takes items/);
    // A bag inside a chest: only what is in the bag.
    const bag = (await call(port, "container_contents", { serial: BAG })).data;
    assert.deepEqual([bag.container.root, bag.total, bag.items.map((i: { serial: number }) => i.serial)], [A, 1, [GEM]]);
    assert.deepEqual((await call(port, "container_contents", { serial: A })).data.items.map((i: { serial: number }) => i.serial).sort(), [BAG, GEM, REAG].sort());
    assert.match((await call(port, "grab_item", { serial: 7 })).text, /nothing with serial 7/);
    // The bridge reports back: get_action_status says so.
    bridgeAlive(sv.dir, { [String(grab.data.id)]: { ok: true, msg: "Sapphire moved to your backpack", t: new Date().toISOString() } });
    const done = (await call(port, "get_action_status", { id: grab.data.id })).data;
    assert.deepEqual([done.state, done.result.msg], ["done", "Sapphire moved to your backpack"]);
    // A command this server queued and the bridge has not reported is queued; an id nobody knows is an error.
    const highlight = (await call(port, "highlight_item", { serial: GEM, waitSeconds: 0 })).data;
    assert.equal((await call(port, "get_action_status", { id: highlight.id })).data.state, "queued");
    const unknown = await call(port, "get_action_status", { id: "nope" });
    assert.deepEqual([unknown.ok, unknown.text], [false, "No such action (unknown or expired)"]);
  } finally { await sv.s.close(); }
});

test("[fast] organize_trip queues the current plan's trip through the Organize route, one at a time, and reports the bridge's steps", async () => {
  const sv = await serve({ demo: false, mcp: { enabled: true, allowActions: true }, before: (dir) => { house(dir); bridgeAlive(dir); } });
  try {
    const port = await mcpPort(sv);
    const plan = (await call(port, "organize_plan")).data;
    assert.deepEqual(plan.trips.map((t: { index: number }) => t.index), [1]);
    assert.deepEqual(plan.trips[0].moves.map((m: { serial: number; to: string }) => [m.serial, m.to]), [[REAG, "Box " + B]]);
    assert.match((await call(port, "organize_trip", { index: 1, stamp: "00000000", waitSeconds: 0 })).text, /plan has changed/);
    const trip = await call(port, "organize_trip", { index: 1, stamp: plan.stamp, waitSeconds: 0 });
    assert.equal(trip.ok, true, trip.text);
    assert.equal(trip.data.state, "queued");
    const [line] = queued(sv.dir);
    assert.deepEqual([line!.id, line!.action, line!.index], [trip.data.id, "trip", 1]);
    assert.match((await call(port, "organize_trip", { index: 1, stamp: plan.stamp, waitSeconds: 0 })).text, /has not reported back/);
    bridgeAlive(sv.dir, { [String(trip.data.id)]: { ok: true, msg: "Trip 1: 1 moved", t: new Date().toISOString(), steps: [{ op: "take", serial: REAG, ok: true, msg: "taken" }, { op: "put", serial: REAG, ok: true, msg: "put" }] } });
    const st = (await call(port, "get_action_status", { id: trip.data.id })).data;
    assert.equal(st.state, "done");
    assert.equal(st.result.steps.length, 2);
  } finally { await sv.s.close(); }
});

test("[fast] organize_trip counts a move as made only when the bridge reports its put", async () => {
  const sv = await serve({ demo: false, mcp: { enabled: true, allowActions: true }, before: (dir) => { house(dir); bridgeAlive(dir); } });
  try {
    const port = await mcpPort(sv);
    // Runs trip 1 and, once its line is in the queue, has the bridge report `result` for it.
    const run = async (result: Record<string, unknown>): Promise<Record<string, any>> => {
      const { stamp } = (await call(port, "organize_plan")).data;
      const before = queued(sv.dir).length;
      const pending = call(port, "organize_trip", { index: 1, stamp, waitSeconds: 20 });
      for (let i = 0; i < 200 && queued(sv.dir).length === before; i++) await new Promise((ok) => setTimeout(ok, 25));
      const id = String(queued(sv.dir).at(-1)!.id);
      bridgeAlive(sv.dir, { [id]: { t: new Date().toISOString(), ...result } });
      const r = await pending;
      assert.equal(r.ok, true, r.text);
      return r.data;
    };
    const refused = await run({ ok: false, msg: "trip refused: too far", steps: [] });
    assert.equal(refused.state, "failed");
    assert.deepEqual(refused.moves.map((m: { serial: number; moved: boolean }) => [m.serial, m.moved]), [[REAG, false]]);
    const tookOnly = await run({ ok: false, msg: "stopped partway", steps: [{ op: "take", serial: REAG, ok: true, msg: "taken" }] });
    assert.deepEqual(tookOnly.moves.map((m: { moved: boolean }) => m.moved), [false], "a take without its put is not a move");
    const done = await run({ ok: true, msg: "Trip 1: 1 moved", steps: [{ op: "take", serial: REAG, ok: true, msg: "taken" }, { op: "put", serial: REAG, ok: true, msg: "put" }] });
    assert.equal(done.state, "done");
    assert.deepEqual(done.moves.map((m: { moved: boolean; to: string }) => [m.moved, m.to]), [[true, "Box " + B]]);
  } finally { await sv.s.close(); }
});

test("[fast] the tools reach a token-protected app server with its own token", async () => {
  const sv = await serve({ appToken: "app-token-abcdef0123456789" });
  try {
    assert.equal((await fetch(sv.s.url + "/api/mcp")).status, 401, "the settings route is the app's, under its token");
    const port = await mcpPort(sv);
    const r = await call(port, "search_items", { limit: 1 });
    assert.equal(r.ok, true, r.text);
    assert.equal(r.data.items.length, 1);
  } finally { await sv.s.close(); }
});

test("[fast] the MCP SDK's own client connects, lists the tools and calls one", async () => {
  const sv = await serve();
  try {
    const port = await mcpPort(sv);
    const client = new Client({ name: "pack-rat-test", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } } });
    // The SDK's types are written without exactOptionalPropertyTypes (its transport's sessionId), which this project turns on.
    await client.connect(transport as unknown as Parameters<Client["connect"]>[0]);
    try {
      assert.equal(client.getServerVersion()?.name, "pack-rat");
      const { tools } = await client.listTools();
      assert.ok(tools.some((t) => t.name === "search_items" && t.annotations?.readOnlyHint === true));
      const r = await client.callTool({ name: "list_characters", arguments: {} });
      assert.equal(r.isError, undefined);
      assert.deepEqual((r.structuredContent as { characters: Array<{ name: string }> }).characters.map((c) => c.name), ["Dorran", "Kestrel"]);
    } finally { await client.close(); }
  } finally { await sv.s.close(); }
});
