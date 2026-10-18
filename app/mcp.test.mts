// mcp.test.mts — the built-in MCP server (issue #211; `app/mcp.mts`, `app/mcp-tools.mts`) on a real server and temp data folder.
//
// the built-in MCP server (issue #211; `app/mcp.mts`, `app/mcp-tools.mts`) on a real server and temp data folder, its `mcp.json` asking for port 0 so no test races another or a Pack Rat running on 47615: `initialize` negotiating each supported protocol version and answering the newest to any other, with `serverInfo` and the instructions; a notification's 202, an unknown method (-32601) and tool (-32602), a parse error (-32700), a batch refused, an unsupported `MCP-Protocol-Version` header (400), arguments a tool's schema refuses as an `isError` result; the listener's guards (another Host, any Origin, its own included, no or a wrong token, GET and DELETE, another path, a non-JSON content type, a body over 1 MB); off by default with nothing written, `PUT /api/mcp` refusing anything but the two booleans and opening and closing the listener at once (connection refused once off), `mcp.json` saved `0600`; `POST /api/mcp/token` replacing the token with the old one refused at once, and a file without one getting one; a busy port falling back to a free one without saving it, and a broken `mcp.json` reading as off with a log line; every read tool over the demo fixtures with paging, and `character_sheet`'s Resisting Spells minimum with a run saved before it opening (issue #261); `build_suit` for two characters (the second build of the same inputs reusing the saved run, buffs named, No character saved and reused, listed by `noCharacter` and read back as `character: null` with its effective totals, and a No character fill with pins not saved; `onlyContainers` narrowing the pool into its own run, `[]` as no list, non-serials refused, and a bag or an item named with where it sits), the run tools and `score_suit` over them; the in-game tools refused with the switch off (and still listed) while `stop_actions` writes the stop flag, and with it on writing the same `queue.jsonl` line the Grab button's `POST /api/bridge` writes (refused while the bridge is offline, a ground chest highlighted by its serial), an Organize trip through the Organize route with its one-at-a-time and stale-stamp refusals, and `get_action_status` reading the bridge's report; the tools reaching a `--token` app server; and the MCP SDK's own `Client` and `StreamableHTTPClientTransport` connecting, listing the tools and calling one. Fix round 1: an id with no method refused, the content type in any case, `POST /api/mcp/token` refusing fields; a hand-edited `mcp.json` (one bad field keeps the token, a BOM, an empty or broken file, a data folder that cannot take a new token leaving MCP off); property rules the route would drop refused with the accepted forms, slots, kinds, slayers and tags in any case, rows carrying their container and root serials; `container_contents` on a bag inside a chest; `score_suit` keeping the hands legal around a named weapon and planning with Manual's buffs (`manualBuffs` while `buffsCount` is on); suit results' `effectiveTotals` (paperdoll resists, Divine Fury's shares) on `score_suit`, `build_suit`, `get_suit_build`, `get_run` and a reused run, and `unreachableFloors` and `diagnostics` for a hard floor no piece reaches (issues #216, #217), with the suit's `swing`; an empty `pinned` as no pins and a fill without `currentScore`; a build replaced by a newer call saying so (a parked core); `get_action_status` on an id nobody queued; and `organize_trip` counting a move only when its put step is reported (a refused trip, a take without its put); `build_suit`'s `rarity` (issue #262) set, cleared with `any` or a template without one, and kept when left out; `list_containers` (issue #276) over a captured house by its id or its name in any case (label, fill, area, level, position and top kinds; an unknown house naming the houses) and `outside` for the ground containers in no house; `label_containers` adding, renaming, pinning, unpinning and removing labels through `PUT /api/organize` with its `changed` event, refusing a bad batch whole (empty, unknown serial, trash, a bag, a label a rule or the catch-all uses, no label to remove, a serial twice, no name, a name over 64 characters, pinning a rule's target, a salvaged setup), a batch that changes nothing saving nothing and keeping a strategy label's origin, a page's save between its read and write applied over once and a second one refusing the batch (issue #280), and an Organize plan read before a label change refused as stale; `scan` (issue #281) refused with actions off, the bridge offline or a bridge without the scan feature, queuing each `what` as its script's line (a bad script refused by the route), and answering done with the newer scan's counts (or, for the house, the newer house capture), scanning within waitSeconds when none arrives in time (another character's scan and an older one do not count), or the bridge's refusal; `search_items` with `unravel` lists unravel candidates heaviest first, worn pieces only with `unravelShow` (issue #271). All `[fast]`. Build labels (issue #336): both character tools return `label`, and `PUT /api/profiles/label` changes one label on the server (trimmed, blank removes, control characters, over 40 characters, unknown or pseudo characters refused) while a whole-file save keeps the stored labels, so it and a label save survive in either order.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, statSync, mkdirSync, chmodSync, renameSync } from "node:fs";
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
import { claimHouses, vaultHouse } from "./house-fixture.mts";
import { sseReader } from "./server-routes-fixture.mts";
import { emptyRuleQuery, emptyOrganizeConfig, type OrganizeConfig } from "./organize-config.mts";
import { ACTIONS_OFF, MCP_DEFAULT_PORT, PROTOCOL_VERSIONS } from "./mcp.mts";
import { ToolError, TOOLS, type ToolContext } from "./mcp-tools.mts";
import { BRIDGE_OFFLINE, RESIST_KEYS } from "./vault-lib.mts";
import { characterEntry, characterProfile, type CharacterEntry, type ProfilesV3, type TemplateMap } from "./build-spec.mts";
import { applyBuffs, buffSkillValues } from "./buffs.mts";
import { SOLVER_VERSION } from "./runs-lib.mts";

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
// A whole profiles file saved on purpose, with the stamp a GET just answered.
const putProfiles = async (sv: Served, doc: object): Promise<{ status: number; body: Record<string, unknown> }> => app(sv, "/api/profiles", "PUT", { ...doc, base: (await app<{ stamp: string }>(sv, "/api/profiles")).body.stamp });
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
    // Issue #271: unravel candidates, heaviest first, each with what it gives; worn pieces only when asked for.
    const unr = (await call(port, "search_items", { unravel: true, limit: 100 })).data;
    assert.ok(unr.total > 0 && unr.items.every((it: { unravel?: { ingredient: string; weight: number; maybe: boolean }; wornBy?: string }) => it.unravel && it.unravel.weight > 0 && typeof it.unravel.maybe === "boolean" && !it.wornBy), "no worn piece by default");
    assert.ok(unr.items.every((it: { unravel: { weight: number } }, i: number) => !i || unr.items[i - 1].unravel.weight >= it.unravel.weight), "heaviest first");
    const worn = (await call(port, "search_items", { unravel: true, unravelShow: ["worn"], limit: 100 })).data;
    assert.ok(worn.total > unr.total && worn.items.some((it: { unravel: { leftOut?: string[] } }) => it.unravel.leftOut?.includes("worn")));
    assert.match((await call(port, "search_items", { unravel: true, unravelShow: ["nope"] })).text, /nope|unravelShow/);
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

test("[fast] score_suit keeps the hands legal around a named weapon, and plans with Manual's buffs; build_suit with the character's saved Automatic ones; a built-in template by its id; a template's own buffs", async () => {
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
    const { profiles, builtinTemplates } = (await app<{ profiles: ProfilesV3; builtinTemplates: TemplateMap }>(sv, "/api/profiles")).body;
    const kestrel = characterEntry(characterProfile(profiles, "Kestrel", builtinTemplates), { on: ["bless"], skills: {} });
    assert.equal((await putProfiles(sv, { ...profiles, characters: { ...profiles.characters, Kestrel: kestrel } })).status, 200);
    assert.deepEqual((await call(port, "build_suit", { character: "Kestrel", timeBudgetSeconds: 2 })).data.buffs, ["bless"], "the character's saved Automatic buffs (its profile's spec)");
    assert.doesNotMatch((await call(port, "score_suit", { character: "Kestrel", template: "tank" })).text, /no template/, "a built-in template by its id");
    assert.match((await call(port, "score_suit", { character: "Kestrel", template: "nope" })).text, /no template named "nope"; the templates are builtin:melee, builtin:caster, builtin:archer, builtin:tank/);
    // Issue #212: a template that carries buffs plans with them when none are named, as the builder's Apply turns them on.
    const vamp = { spec: { ...profiles.templates.melee?.spec ?? builtinTemplates.melee!.spec, buffs: { on: ["consecrateWeapon"], skills: {} } } };
    assert.equal((await putProfiles(sv, { ...profiles, characters: { ...profiles.characters, Kestrel: kestrel }, templates: { ...profiles.templates, vamp } })).status, 200);
    assert.deepEqual((await call(port, "score_suit", { character: "Kestrel", template: "vamp" })).data.buffs, ["consecrateWeapon"], "the template's buffs over Manual's");
    assert.deepEqual((await call(port, "build_suit", { character: "Kestrel", template: "vamp", timeBudgetSeconds: 2 })).data.buffs, ["consecrateWeapon"], "the template's buffs over the character's");
    assert.deepEqual((await call(port, "score_suit", { character: "Kestrel", template: "vamp", buffs: [] })).data.buffs, [], "buffs named win");
    // the template's buff numbers over the character's, as the page's Apply merges them: Divine Fury's top tier or not
    const fury = (skills: Record<string, number>): { spec: unknown } => ({ spec: { ...vamp.spec, buffs: { on: ["divineFury"], skills } } });
    assert.equal((await putProfiles(sv, { ...profiles, characters: { ...profiles.characters, Kestrel: kestrel }, templates: { ...profiles.templates, top: fury({ Chivalry: 120, Karma: 10000 }), low: fury({ Chivalry: 0, Karma: 0 }) } })).status, 200);
    const furyTotals = async (template: string): Promise<Record<string, number>> => (await call(port, "score_suit", { character: "Kestrel", template })).data.effectiveTotals;
    const [top, low] = [await furyTotals("top"), await furyTotals("low")];
    assert.ok(["hci", "di", "ssi", "dci"].some((k) => top[k] !== low[k]), `the template's numbers are planned with: ${JSON.stringify({ top, low })}`);
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
    // No character with no pins is an ordinary build, saved and reused under No character's own name (issue #12)
    const none = (await call(port, "build_suit", { noCharacter: true, timeBudgetSeconds: 2 })).data;
    assert.equal(none.state, "done", JSON.stringify(none));
    assert.ok(none.runId, "a No character build is saved");
    assert.equal(none.character, null);
    assert.equal((await call(port, "build_suit", { noCharacter: true, timeBudgetSeconds: 2 })).data.reused, true);
    const noneRuns = (await call(port, "list_runs", { noCharacter: true })).data;
    assert.deepEqual(noneRuns.runs.map((r: { id: string; character: unknown }) => [r.id, r.character]), [[none.runId, null]]);
    assert.equal((await call(port, "list_runs", { character: "Kestrel", noCharacter: true })).ok, false);
    const noneRun = (await call(port, "get_run", { id: none.runId })).data;
    assert.equal(noneRun.character, null);
    assert.ok(noneRun.effectiveTotals, "a No character run is evaluated, with no character");
    assert.deepEqual((await call(port, "compare_runs", { ids: [k.runId, none.runId] })).data.runs.map((r: { character: unknown }) => r.character), ["Kestrel", null]);
    // with pins it is still a fill, not saved
    const fill = (await call(port, "build_suit", { noCharacter: true, pinned: { [pinSlot]: ring!.serial }, timeBudgetSeconds: 2 })).data;
    assert.equal(fill.state, "done", JSON.stringify(fill));
    assert.equal(fill.runId, null);
    assert.equal((await call(port, "list_runs")).data.total, 3, "a No character fill is not saved");
    // onlyContainers (issue #12): a list narrows the pool to those root containers; [] is no list, so the saved build answers it
    const inSuit = (Object.values(none.suit).find(Boolean) as { serial: number }).serial;
    const root = (await call(port, "get_item", { serials: [inSuit] })).data.items[0].root as number;
    const one = (await call(port, "build_suit", { noCharacter: true, onlyContainers: [root], timeBudgetSeconds: 2 })).data;
    assert.equal(one.state, "done", JSON.stringify(one));
    assert.ok(one.poolSize > 0 && one.poolSize < none.poolSize, `${one.poolSize} < ${none.poolSize}`);
    assert.ok(!one.reused && one.runId !== none.runId, "a build with the list is its own run");
    assert.equal((await call(port, "build_suit", { noCharacter: true, onlyContainers: [], timeBudgetSeconds: 2 })).data.runId, none.runId, "an empty list is no list");
    assert.equal((await call(port, "build_suit", { noCharacter: true, onlyContainers: ["bank"] })).ok, false, "only serials");
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

test("[fast] suit results carry effectiveTotals beside the gear totals, and unreachableFloors and diagnostics where a hard floor is out of reach (issues #216, #217)", async () => {
  const sv = await serve();
  try {
    const port = await mcpPort(sv);
    // score_suit: resists as on the paperdoll, Divine Fury's shares counted
    const { values } = buffSkillValues(null, {});
    const share = (k: string): number => (applyBuffs({}, {}, ["divineFury"], values, null).shares[k] || []).reduce((n, x) => n + x.value, 0);
    const s = (await call(port, "score_suit", { character: "Kestrel", buffs: ["divineFury"] })).data;
    const eff = s.effectiveTotals as Record<string, number>, gear = s.totals as Record<string, number>;
    assert.ok(!("resistBonus" in s));
    for (const k of RESIST_KEYS) assert.equal(eff[k] ?? 0, Math.max(gear[k] ?? 0, s.resistMinimum ?? -Infinity), k);
    for (const k of ["dci", "hci", "ssi"]) assert.equal(eff[k] ?? 0, (gear[k] ?? 0) + share(k), k);
    assert.equal(share("dci") < 0, true, "Divine Fury lowers DCI");
    // a hard floor no piece reaches, on Kestrel's saved profile
    const { profiles } = (await app<{ profiles: ProfilesV3 }>(sv, "/api/profiles")).body;
    const kestrel = characterEntry({ ...characterProfile(profiles, "Kestrel"), floors: { luck: 100000 }, softFloors: [] }, { on: [], skills: {} });
    assert.equal((await putProfiles(sv, { ...profiles, characters: { ...profiles.characters, Kestrel: kestrel } })).status, 200);
    const b = (await call(port, "build_suit", { character: "Kestrel", buffs: ["divineFury"], timeBudgetSeconds: 2, waitSeconds: 45 })).data;
    assert.equal(b.state, "done", JSON.stringify(b));
    assert.deepEqual(b.unreachableFloors, ["luck"]);
    assert.deepEqual(b.diagnostics.filter((d: { code: string }) => d.code !== "swing_next_step").map((d: { code: string; property: string }) => [d.code, d.property]), [["floor_unreachable", "luck"]], "diagnostics pass through as the result has them");
    // the suit's swing passes through too (issue #217), with Divine Fury's SSI as its share
    if (b.swing) assert.equal(b.swing.share, share("ssi"), JSON.stringify(b.swing));
    assert.ok(b.effectiveTotals && Object.keys(b.effectiveTotals).length, JSON.stringify(b));
    assert.equal(b.effectiveTotals.dci ?? 0, (b.totals.dci ?? 0) + share("dci"));
    const polled = (await call(port, "get_suit_build", { id: b.id })).data;
    assert.deepEqual([polled.effectiveTotals, polled.unreachableFloors], [b.effectiveTotals, ["luck"]]);
    const run = (await call(port, "get_run", { id: b.runId })).data;
    assert.deepEqual([run.effectiveTotals, run.unreachableFloors, run.swing], [b.effectiveTotals, ["luck"], b.swing], "a saved run, evaluated from its settings, agrees with the build");
    const again = (await call(port, "build_suit", { character: "Kestrel", buffs: ["divineFury"], timeBudgetSeconds: 2 })).data;
    assert.deepEqual([again.reused, again.effectiveTotals, again.unreachableFloors], [true, b.effectiveTotals, ["luck"]]);
  } finally { await sv.s.close(); }
});

// Issue #261: character_sheet reports the Resisting Spells minimum, never the old additive bonus, and a run saved before
// the change (SOLVER_VERSION 7, its numbers worked out with the bonus) opens, its effective totals worked out anew.
test("[fast] character_sheet reports the Resisting Spells minimum in place of a resist bonus, and a run saved before it opens", async () => {
  const sv = await serve({ demo: false, before: (dir) => {
    const scan = houseScan({ scannedAt: new Date(Date.now() - 3600e3).toISOString(), boxes: [{ serial: 0x40000101, pos: { x: 100, y: 100, z: 0, facet: 1 } }] });
    writeFileSync(join(dir, "scans", "tester.json"), JSON.stringify({ ...scan, skills: { "Resisting Spells": { value: 100, cap: 120 } } }));
    const chest = { serial: 0x40002001, name: "Plate Tunic", slot: "chest", props: { fireResist: 30, coldResist: 55 } };
    writeFileSync(join(dir, "runs", "before-261.json"), JSON.stringify({ id: "before-261", key: "0".repeat(40), character: "Tester", createdAt: "2026-10-01T12:00:00.000Z", label: "", solverVersion: 7,
      settings: { floors: { fireResist: 70 } }, result: { method: "exact", proven: true, score: 1, best: { chest }, perSlotChanges: [], totals: { before: {}, after: chest.props },
        diagnostics: [{ code: "floor_unreachable", level: "warn", property: "fireResist", message: "Fire resist 70 can't be reached with your inventory (best possible: 70).", values: { floor: 70, best: 70 }, actions: [] }] } }));
  } });
  try {
    const port = await mcpPort(sv);
    const sheet = (await call(port, "character_sheet", { character: "Tester" })).data;
    assert.equal(sheet.resistMinimum, 40);
    assert.ok(!("resistBonus" in sheet));
    const run = (await call(port, "get_run", { id: "before-261" })).data;
    assert.deepEqual([run.totals.fireResist, run.effectiveTotals.fireResist, run.effectiveTotals.coldResist, run.effectiveTotals.physResist], [30, 40, 55, 40], "Fire 30 under the minimum reads 40; Cold 55 is gear's own");
    assert.equal(run.diagnostics, undefined, "its saved diagnostics counted the old bonus: dropped, as for a run saved before diagnostics");
    assert.equal((await app<{ run: { id: string } }>(sv, "/api/runs/before-261")).body.run.id, "before-261");
  } finally { await sv.s.close(); }
});

// Issue #274: a weight_dominates saved before weights became importances names a per-point Set weight value; get_run keeps its sentence and drops the action, which would now read as an importance.
test("[fast] get_run drops the Set weight action of a weight_dominates saved before importance", async () => {
  const old = { code: "weight_dominates", level: "warn", property: "luck", message: "Luck makes up 33% of this suit's score: at weight 3, 500 Luck is worth as much as 3.6 times the median of your other weights. Try 0.8.",
    values: { weight: 3, typical: 500, share: 33, ratio: 3.6, median: 420, suggested: 0.8 }, actions: [{ kind: "setWeight", property: "luck", value: 0.8 }] };
  const sv = await serve({ demo: false, before: (dir) => {
    const chest = { serial: 0x40002001, name: "Plate Tunic", slot: "chest", props: { luck: 100 } };
    writeFileSync(join(dir, "runs", "before-274.json"), JSON.stringify({ id: "before-274", key: "0".repeat(40), createdAt: "2026-10-08T12:00:00.000Z", label: "", solverVersion: SOLVER_VERSION,
      settings: { weights: { luck: 3 } }, result: { method: "exact", proven: true, score: 1, best: { chest }, perSlotChanges: [], totals: { before: {}, after: chest.props }, diagnostics: [old] } }));
  } });
  try {
    const run = (await call(await mcpPort(sv), "get_run", { id: "before-274" })).data;
    assert.deepEqual(run.diagnostics, [{ ...old, actions: [] }]);
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
    for (const [name, args] of [["highlight_item", { serial: GEM }], ["go_to_item", { serial: GEM }], ["grab_item", { serial: GEM }], ["organize_trip", { index: 1, stamp: "x" }], ["scan", {}]] as const) {
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
    assert.deepEqual(command(queued(sv.dir)[2]!), { action: "highlight", serial: B, name: "Box " + B, chain: [], pos: { x: 102, y: 100, z: 0, facet: 1 }, protocol: 1 });
    assert.equal((await call(port, "go_to_item", { serial: REAG, waitSeconds: 0 })).ok, true);
    assert.deepEqual((queued(sv.dir)[3]!).chain, [A]);
    assert.match((await call(port, "grab_item", { serial: A })).text, /Grab takes items/);
    // A bag inside a chest: only what is in the bag.
    const bag = (await call(port, "container_contents", { serial: BAG })).data;
    assert.deepEqual([bag.container.root, bag.total, bag.items.map((i: { serial: number }) => i.serial)], [A, 1, [GEM]]);
    assert.deepEqual((await call(port, "container_contents", { serial: A })).data.items.map((i: { serial: number }) => i.serial).sort(), [BAG, GEM, REAG].sort());
    assert.match((await call(port, "grab_item", { serial: 7 })).text, /nothing with serial 7/);
    // build_suit's onlyContainers takes root containers only, and says where a bag sits (issue #12)
    const hexOf = (n: number): string => `0x${n.toString(16).toUpperCase()}`;
    assert.equal((await call(port, "build_suit", { noCharacter: true, onlyContainers: [BAG] })).text, `${hexOf(BAG)} is a bag inside ${hexOf(A)} (Box ${A}); onlyContainers takes root containers`);
    assert.equal((await call(port, "build_suit", { noCharacter: true, onlyContainers: [GEM] })).text, `${hexOf(GEM)} is not a container in the scans; onlyContainers takes root containers`);
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

// The scan tool (issue #281): a bridge on Tester that reports itself with the scan feature, and a newer scan of Tester
// dropped into the inbox as the scanner would.
function scanBridge(dir: string, results: Record<string, unknown> = {}): void {
  mkdirSync(join(dir, "bridge", "tazuo"), { recursive: true });
  writeFileSync(join(dir, "bridge", "tazuo", "status.json"), JSON.stringify({ alive: new Date().toISOString(), character: "Tester", current: null, results, counts: { done: 0, failed: 0 },
    adapter: { id: "tazuo", version: "2.17.0", protocol: 1, features: ["highlight", "grab", "goto", "trip", "trip-bags", "scan"] } }));
}
// A file dropped into the TazUO inbox as a scan script writes it.
function dropScan(sv: Served, name: string, doc: unknown): void {
  const inbox = join(sv.dir, "inbox", "tazuo");
  mkdirSync(inbox, { recursive: true });
  writeFileSync(join(inbox, `${name}.tmp`), JSON.stringify(doc));
  renameSync(join(inbox, `${name}.tmp`), join(inbox, name));
}
// Waits for the tool's line after `before` lines, then has the bridge report the script started.
async function startedScan(sv: Served, before: number): Promise<void> {
  for (let i = 0; i < 200 && queued(sv.dir).length === before; i++) await new Promise((ok) => setTimeout(ok, 25));
  const id = String(queued(sv.dir).at(-1)!.id);
  scanBridge(sv.dir, { [id]: { ok: true, msg: "started packrat-scanner.py", t: new Date().toISOString() } });
}

test("[fast] scan is refused with the bridge offline or unable to scan, and queues the script the bridge starts", async () => {
  const empty = await serve({ demo: false, mcp: { enabled: true, allowActions: true } });
  try {
    // No scans yet: what the shipped scripts can do decides, and they scan.
    assert.equal((await call(await mcpPort(empty), "scan", { waitSeconds: 0 })).text, BRIDGE_OFFLINE);
  } finally { await empty.s.close(); }
  const sv = await serve({ demo: false, mcp: { enabled: true, allowActions: true }, before: house });
  try {
    const port = await mcpPort(sv);
    bridgeAlive(sv.dir);   // a bridge that does not report itself, judged by the newest scan, whose scripts had no scan
    assert.equal((await call(port, "scan", { waitSeconds: 0 })).text, "TazUO adapter scripts can't Scan from Pack Rat.");
    assert.deepEqual(queued(sv.dir), []);
    scanBridge(sv.dir);
    for (const [what, script] of [[undefined, "scanner"], ["character", "refresh"], ["house", "house"]] as const) {
      const r = await call(port, "scan", { ...(what ? { what } : {}), waitSeconds: 0 });
      assert.deepEqual([r.ok, r.data.state, r.data.queuedFor, r.data.what], [true, "queued", "Tester", what ?? "here"], r.text);
      assert.deepEqual(command(queued(sv.dir).at(-1)!), { action: "scan", script, protocol: 1 });
    }
    assert.equal((await call(port, "scan", { what: "everything" })).ok, false);
    const bad = await app<{ error: string }>(sv, "/api/bridge", "POST", { action: "scan", script: "packrat-bridge.py" });
    assert.equal(bad.status, 400);
    assert.equal(queued(sv.dir).length, 3);
  } finally { await sv.s.close(); }
});

test("[fast] scan follows the bridge, then answers with the newer scan Pack Rat accepts, or scanning when none comes in time", async () => {
  const sv = await serve({ demo: false, mcp: { enabled: true, allowActions: true }, before: (dir) => { house(dir); scanBridge(dir); } });
  try {
    const port = await mcpPort(sv);
    const at = new Date().toISOString();
    const pending = call(port, "scan", { waitSeconds: 25 });
    await startedScan(sv, 0);
    dropScan(sv, "Tester-20261010-120000.json", houseScan({ scannedAt: at, boxes: [{ serial: A }, { serial: B, pos: { x: 102, y: 100, z: 0, facet: 1 } }], things: [{ serial: GEM, name: "Sapphire", in: A }] }));
    const done = await pending;
    assert.equal(done.ok, true, done.text);
    assert.deepEqual([done.data.state, done.data.scan], ["done", { character: "Tester", at, containers: 2, items: 1 }]);
    // The script started, but no newer scan of Tester arrives within waitSeconds: another character's newer scan and an
    // older scan of Tester do not count. Scanning, with what to poll, and no later than waitSeconds.
    const scansBefore = (await call(port, "scan_status")).data.scans as number;
    const started = Date.now();
    const slow = call(port, "scan", { what: "character", waitSeconds: 6 });
    await startedScan(sv, 1);
    dropScan(sv, "Other-20261010-120001.json", houseScan({ character: "Other", scannedAt: new Date().toISOString(), boxes: [{ serial: 0x40002001 }] }));
    dropScan(sv, "Tester-20261010-110000.json", houseScan({ scannedAt: new Date(Date.parse(at) - 60e3).toISOString(), boxes: [{ serial: 0x40002002 }] }));
    const scanning = await slow;
    assert.deepEqual([scanning.ok, scanning.data.state], [true, "scanning"], scanning.text);
    assert.match(scanning.data.hint, /scan_status/);
    assert.ok(Date.now() - started < 6000 + 1500, `answered ${Date.now() - started} ms after the call, past waitSeconds`);
    assert.equal((await call(port, "scan_status")).data.scans, scansBefore + 2, "both scans were accepted while the tool waited");
    // A refusal from the bridge is its answer.
    const busy = call(port, "scan", { waitSeconds: 10 });
    for (let i = 0; i < 200 && queued(sv.dir).length === 2; i++) await new Promise((ok) => setTimeout(ok, 25));
    scanBridge(sv.dir, { [String(queued(sv.dir).at(-1)!.id)]: { ok: false, msg: "packrat-scanner.py is already running", t: new Date().toISOString() } });
    const refused = await busy;
    assert.deepEqual([refused.data.state, refused.data.result.msg], ["failed", "packrat-scanner.py is already running"]);
  } finally { await sv.s.close(); }
});

test("[fast] scan of the house waits for a newer house capture, and its scanning hint points at list_containers", async () => {
  const sv = await serve({ demo: false, mcp: { enabled: true, allowActions: true }, before: (dir) => { house(dir); scanBridge(dir); claimHouses(dir, "everything"); } });
  try {
    const port = await mcpPort(sv);
    const slow = call(port, "scan", { what: "house", waitSeconds: 1 });
    await startedScan(sv, 0);
    const scanning = await slow;
    assert.deepEqual([scanning.data.state, scanning.data.hint], ["scanning", "the house map refresh is running in game; list_containers shows the house once its capture is in"]);
    const { house: cap, chests } = vaultHouse();
    const capturedAt = new Date().toISOString();
    const pending = call(port, "scan", { what: "house", waitSeconds: 25 });
    await startedScan(sv, 1);
    const scan = houseScan({ scannedAt: capturedAt, boxes: chests.slice(0, 2).map((c) => ({ serial: c.serial, pos: { x: c.x, y: c.y, z: c.z, facet: 1 } })) });
    dropScan(sv, "Tester-20261010-130000.json", { ...scan, house: { facet: 1, capturedAt, at: { x: 3003, y: 1003 }, tiles: cap.tiles, items: cap.items } });
    const done = await pending;
    assert.equal(done.ok, true, done.text);
    assert.deepEqual([done.data.state, done.data.scan.character, done.data.scan.at, done.data.scan.house], ["done", "Tester", capturedAt, "1-3000-1000"], JSON.stringify(done.data));
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

test("[fast] list_containers lists a house's ground containers by id or name, with label, fill, area, position and top kinds; outside lists the rest", async () => {
  const { house: cap, chests } = vaultHouse();
  const first = chests[0]!, FAR = 0x40030001;
  const sv = await serve({ demo: false, before: (dir) => { claimHouses(dir, "everything");
    const scan = houseScan({ scannedAt: cap.capturedAt, boxes: [...chests.map((c) => ({ serial: c.serial, pos: { x: c.x, y: c.y, z: c.z, facet: 1 } })), { serial: FAR, pos: { x: 100, y: 100, z: 0, facet: 1 } }],
      things: [{ serial: 0x40031001, name: "Black Pearl", in: first.serial, amount: 50 }, { serial: 0x40031002, name: "Sapphire", in: first.serial }, { serial: 0x40031003, name: "Ruby", in: first.serial }] });
    writeFileSync(join(dir, "scans", "house.json"), JSON.stringify({ ...scan, house: { facet: 1, capturedAt: cap.capturedAt, at: { x: 3003, y: 1003 }, tiles: cap.tiles, items: cap.items } }));
    writeFileSync(join(dir, "organize.json"), JSON.stringify({ ...emptyOrganizeConfig(), labels: { [String(first.serial)]: { serial: first.serial, name: "Gems", pinned: true, origin: "manual" } } }));
  } });
  try {
    const bounds = { x0: 3000, y0: 1000, x1: 3006, y1: 1006, facet: 1 };
    assert.equal((await app(sv, "/api/house-map/1-3000-1000", "PUT", { name: "Home", bounds, areas: [{ id: "west", name: "West wall", level: 0, color: "area-1", rects: [{ x0: 3001, y0: 1001, x1: 3001, y1: 1005 }] }] })).status, 200);
    const port = await mcpPort(sv);
    const all = async (args: Record<string, unknown>): Promise<{ data: Record<string, any>; rows: Array<Record<string, any>> }> => {
      const rows: Array<Record<string, any>> = [];
      let data: Record<string, any> = {};
      for (let offset = 0; offset === 0 || offset < data.total; offset += 100) {
        const r = await call(port, "list_containers", { ...args, limit: 100, offset });
        assert.equal(r.ok, true, r.text);
        data = r.data;
        rows.push(...data.containers);
      }
      return { data, rows };
    };
    const byId = await all({ house: "1-3000-1000" });
    assert.deepEqual(byId.data.houses, [{ id: "1-3000-1000", name: "Home" }]);
    assert.equal(byId.data.total, 120);
    assert.equal(byId.rows.length, 120);
    assert.ok(!byId.rows.some((r) => r.serial === FAR), "a container outside the house is not listed with it");
    const gems = byId.rows.find((r) => r.serial === first.serial)!;
    assert.deepEqual([gems.label, gems.fill.items, gems.fill.maxItems, gems.area, gems.level, gems.position, gems.house], [{ name: "Gems", pinned: true }, 3, 125, "West wall", 0, { x: first.x, y: first.y, z: first.z }, { id: "1-3000-1000", name: "Home" }]);
    assert.equal(gems.contents.reduce((n: number, k: { count: number }) => n + k.count, 0), 3);
    assert.ok(gems.contents.some((k: { kind: string }) => k.kind === "reagent"), JSON.stringify(gems.contents));
    assert.deepEqual(byId.rows.find((r) => r.serial === chests[1]!.serial)!.label, null);
    assert.equal(byId.rows.filter((r) => r.area === "West wall").length, 25, "the area's five tiles, five containers each");
    assert.equal(byId.rows.filter((r) => r.area === null).length, 95);
    assert.equal((await all({ house: "HOME" })).data.total, 120, "a house's name matches whatever its case");
    assert.equal((await all({})).data.total, 120);
    const none = await call(port, "list_containers", { house: "Cabin" });
    assert.equal(none.ok, false);
    assert.match(none.text, /no house "Cabin"; the houses are Home \(1-3000-1000\)/);
    const outside = (await call(port, "list_containers", { outside: true })).data;
    assert.deepEqual(outside.containers.map((r: { serial: number; house: unknown; position: unknown }) => [r.serial, r.house, r.position]), [[FAR, null, { x: 100, y: 100, z: 0 }]]);
    assert.match((await call(port, "list_containers", { outside: true, house: "Home" })).text, /not both/);
  } finally { await sv.s.close(); }
});

const C = 0x40000004, TRASH = 0x40001003;
// The Organize house with a third, unlabeled ground container and a trash barrel the scanner recorded as an item.
function labelHouse(dir: string, config: OrganizeConfig = HOUSE_CONFIG): void {
  house(dir);
  writeFileSync(join(dir, "scans", "house.json"), JSON.stringify(houseScan({ scannedAt: new Date(Date.now() - 3600e3).toISOString(),
    boxes: [{ serial: A, pos: { x: 100, y: 100, z: 0, facet: 1 } }, { serial: BAG, parent: A, name: "Gem Bag" }, { serial: B, pos: { x: 102, y: 100, z: 0, facet: 1 } }, { serial: C, pos: { x: 104, y: 100, z: 0, facet: 1 } }],
    things: [{ serial: GEM, name: "Sapphire", in: BAG }, { serial: REAG, name: "Black Pearl", in: A }, { serial: TRASH, name: "Trash Barrel", in: A }] })));
  writeFileSync(join(dir, "organize.json"), JSON.stringify(config));
}
const savedLabels = (dir: string): OrganizeConfig["labels"] => (JSON.parse(readFileSync(join(dir, "organize.json"), "utf8")) as OrganizeConfig).labels;

test("[fast] label_containers adds, renames, pins and removes labels through the Organize route, and tells open pages", async () => {
  const sv = await serve({ demo: false, before: (dir) => labelHouse(dir) });
  const sse = sseReader(await fetch(sv.s.url + "/api/events"));
  try {
    await sse.readUntil((b) => b.includes("event: hello"));
    const port = await mcpPort(sv);
    const r = await call(port, "label_containers", { changes: [{ serial: C, name: "  Gems  " }, { serial: A, name: "Overflow", pinned: true }, { serial: B, name: "Reagents" }] });
    assert.equal(r.ok, true, r.text);
    assert.deepEqual(r.data.applied, [
      { serial: C, change: "added", name: "Gems", pinned: false },
      { serial: A, change: "changed", name: "Overflow", pinned: true, was: { name: "Storage", pinned: false } },
      { serial: B, change: "unchanged", name: "Reagents", pinned: false, was: { name: "Reagents", pinned: false } },
    ]);
    assert.equal(r.data.labels, 3);
    assert.equal(r.data.saved, true);
    await sse.readUntil((b) => b.includes('event: changed\ndata: {"what":"organize","by":"mcp"'));
    const labels = savedLabels(sv.dir);
    assert.deepEqual([labels[String(C)], labels[String(A)]], [{ serial: C, name: "Gems", origin: "manual" }, { serial: A, name: "Overflow", pinned: true, origin: "manual" }]);
    const cfg = (await app<{ config: OrganizeConfig }>(sv, "/api/organize")).body.config;
    assert.deepEqual(cfg.rules, HOUSE_CONFIG.rules, "a rename keeps the rules");
    const listed = (await call(port, "list_containers", { outside: true })).data.containers;
    assert.deepEqual(listed.map((c: { serial: number; label: unknown }) => [c.serial, c.label]), [[A, { name: "Overflow", pinned: true }], [B, { name: "Reagents", pinned: false }], [C, { name: "Gems", pinned: false }]]);
    const off = await call(port, "label_containers", { changes: [{ serial: A, pinned: false }, { serial: C, remove: true }] });
    assert.equal(off.ok, true, off.text);
    assert.deepEqual(off.data.applied.map((x: { change: string }) => x.change), ["changed", "removed"]);
    assert.equal(off.data.labels, 2);
    assert.deepEqual(Object.keys(savedLabels(sv.dir)).map(Number).sort(), [A, B].sort());
    assert.equal(savedLabels(sv.dir)[String(A)]!.pinned, undefined);
  } finally { await sse.cancel(); await sv.s.close(); }
});

test("[fast] label_containers refuses a bad batch whole, naming the entry and why", async () => {
  const sv = await serve({ demo: false, before: (dir) => labelHouse(dir, { ...HOUSE_CONFIG, catchAll: A }) });
  try {
    const port = await mcpPort(sv);
    const before = readFileSync(join(sv.dir, "organize.json"), "utf8");
    const refused = async (changes: unknown[], why: RegExp): Promise<void> => {
      const r = await call(port, "label_containers", { changes });
      assert.equal(r.ok, false, JSON.stringify(changes));
      assert.match(r.text, why);
      assert.equal(readFileSync(join(sv.dir, "organize.json"), "utf8"), before, "nothing is written");
    };
    const good = { serial: C, name: "Gems" };
    await refused([], /fewer than minItems 1/);
    await refused([good, { serial: 0x4fffffff, name: "X" }], /changes\[1\] \(0x4FFFFFFF\): no container with this serial in the scans/);
    await refused([good, { serial: TRASH, name: "Bin" }], /changes\[1\].*a trash container can't be labeled/);
    await refused([good, { serial: BAG, name: "Gems" }], /only containers on the ground can be labeled, not a bag inside one/);
    await refused([good, { serial: B, remove: true }], /Reagents keeps its label: the rule "Reagents" puts items into it/);
    await refused([good, { serial: A, remove: true }], /Storage keeps its label: it is the catch-all/);
    await refused([{ serial: C, remove: true }], /it has no label to remove/);
    await refused([{ serial: A, remove: true, name: "X" }], /remove takes no name or pinned/);
    await refused([good, { serial: C, pinned: true }], /changes\[1\].*listed twice/);
    await refused([{ serial: C, pinned: true }], /a new label needs a name/);
    await refused([{ serial: C, name: "   " }], /a new label needs a name/);
    await refused([{ serial: C, name: "x".repeat(65) }], /must be 1 to 64 characters/);
    await refused([{ serial: C }], /nothing to change/);
    await refused([good, { serial: B, pinned: true }], /The rule "Reagents" puts items into Reagents, which is pinned/);
    assert.equal((await call(port, "label_containers", { changes: [{ serial: C, name: "x".repeat(64) }] })).ok, true, "64 characters is the limit");
  } finally { await sv.s.close(); }
  const salvaged = await serve({ demo: false, before: (dir) => labelHouse(dir, { ...HOUSE_CONFIG, rules: [{ ...HOUSE_CONFIG.rules[0]!, targets: [C] }] }) });
  try {
    const r = await call(await mcpPort(salvaged), "label_containers", { changes: [{ serial: C, name: "Gems" }] });
    assert.equal(r.ok, false);
    assert.match(r.text, /hand-edited and parts of it were dropped.*open Organize and save the setup first/);
  } finally { await salvaged.s.close(); }
});

test("[fast] label_containers saves nothing for a batch that changes nothing, and keeps a strategy label's origin", async () => {
  const auto = { ...HOUSE_CONFIG, labels: { ...HOUSE_CONFIG.labels, [String(B)]: { serial: B, name: "Reagents", origin: "strategy:simple" as const } } };
  const sv = await serve({ demo: false, before: (dir) => labelHouse(dir, auto) });
  const sse = sseReader(await fetch(sv.s.url + "/api/events"));
  try {
    await sse.readUntil((b) => b.includes("event: hello"));
    const port = await mcpPort(sv), file = join(sv.dir, "organize.json");
    const before = readFileSync(file, "utf8"), mtime = statSync(file).mtimeMs;
    const r = await call(port, "label_containers", { changes: [{ serial: B, name: "Reagents" }, { serial: A, pinned: false }] });
    assert.equal(r.ok, true, r.text);
    assert.deepEqual(r.data.applied.map((x: { change: string }) => x.change), ["unchanged", "unchanged"]);
    assert.equal(r.data.saved, false);
    assert.match(r.data.note, /nothing changed/);
    assert.equal(readFileSync(file, "utf8"), before);
    assert.equal(statSync(file).mtimeMs, mtime);
    // An unchanged entry in a batch that does change something keeps its label as it was.
    assert.equal((await call(port, "label_containers", { changes: [{ serial: B, name: "Reagents" }, { serial: C, name: "Gems" }] })).ok, true);
    const events = await sse.readUntil((b) => b.includes("event: changed"));
    assert.equal(events.split("event: changed").length - 1, 1, "only the batch that changed something told the pages");
    assert.equal(savedLabels(sv.dir)[String(B)]!.origin, "strategy:simple");
  } finally { await sse.cancel(); await sv.s.close(); }
});

// label_containers' handler over a context that calls the app as app/mcp.mts does, with `between` run after each read
// of the Organize setup: a page saving in the gap between the tool's read and its write.
async function labelRacing(sv: Served, changes: unknown[], between: () => Promise<void>): Promise<unknown> {
  const ctx: ToolContext = {
    async api(path, init = {}) {
      const r = await app<Record<string, unknown>>(sv, path, init.method, init.body);
      if (r.status >= 400) throw new ToolError(String(r.body.error), r.body.code);
      if (path === "/api/organize" && !init.method) await between();
      return r.body as never;
    },
    sleep: async () => {},
    memory: { actions: new Map(), replaced: new Set(), filled: new Set(), plans: new Map() },
  };
  return TOOLS.find((t) => t.name === "label_containers")!.handler({ changes }, ctx);
}
// A page's save of one label rename, made from the setup as it reads now.
async function pageRename(sv: Served, serial: number, name: string): Promise<void> {
  const { config, stamp } = (await app<{ config: OrganizeConfig; stamp: string }>(sv, "/api/organize")).body;
  const put = await app(sv, "/api/organize", "PUT", { ...config, labels: { ...config.labels, [String(serial)]: { ...config.labels[String(serial)]!, name } }, base: stamp });
  assert.equal(put.status, 200, JSON.stringify(put.body));
}

test("[fast] label_containers applies its batch again over a page's save that lands between its read and write, once", async () => {
  const sv = await serve({ demo: false, before: (dir) => labelHouse(dir) });
  try {
    let saves = 0;
    await labelRacing(sv, [{ serial: C, name: "Gems" }], async () => { if (!saves++) await pageRename(sv, B, "Herbs"); });
    assert.equal(saves, 2, "read again once");
    const labels = savedLabels(sv.dir);
    assert.deepEqual([labels[String(B)]!.name, labels[String(C)]!.name], ["Herbs", "Gems"], "both changes are saved");
    // A page saving again after the second read too: the batch is refused, and the page's saves stand.
    await assert.rejects(labelRacing(sv, [{ serial: C, name: "Jewels" }], () => pageRename(sv, B, `Herbs ${++saves}`)), (e: Error) => e instanceof ToolError && /kept changing.*nothing was saved/.test(e.message));
    assert.deepEqual([savedLabels(sv.dir)[String(B)]!.name, savedLabels(sv.dir)[String(C)]!.name], [`Herbs ${saves}`, "Gems"]);
  } finally { await sv.s.close(); }
});

test("[fast] an Organize plan read before a label change is stale for organize_trip", async () => {
  const sv = await serve({ demo: false, mcp: { enabled: true, allowActions: true }, before: (dir) => { labelHouse(dir); bridgeAlive(dir); } });
  try {
    const port = await mcpPort(sv);
    const plan = (await call(port, "organize_plan")).data;
    assert.equal(plan.trips.length, 1);
    assert.equal((await call(port, "label_containers", { changes: [{ serial: A, pinned: true }] })).ok, true);
    const after = (await call(port, "organize_plan")).data;
    assert.notEqual(after.stamp, plan.stamp);
    assert.equal(after.trips.length, 0, "nothing is taken out of a pinned container");
    assert.match((await call(port, "organize_trip", { index: 1, stamp: plan.stamp, waitSeconds: 0 })).text, /plan has changed/);
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

// Issue #262: build_suit's rarity sets a preference, "any" clears the profile's, and none named keeps it.
test("[fast] build_suit's rarity: set, cleared with any or a template without one, kept when left out", async () => {
  const sv = await serve();
  try {
    const port = await mcpPort(sv);
    const tb = async (args: Record<string, unknown>): Promise<{ rarity?: string; tolerance?: number; cost?: number } | undefined> => {
      const d = (await call(port, "build_suit", { character: "Kestrel", timeBudgetSeconds: 2, ...args })).data;
      assert.equal(d.state, "done", JSON.stringify(d));
      return d.tieBreak;
    };
    assert.equal(await tb({}), undefined, "no preference by default");
    const lower = await tb({ rarity: "lower" });
    assert.deepEqual([lower?.rarity, lower?.tolerance, typeof lower?.cost], ["lower", 0, "number"]);
    const { profiles, builtinTemplates } = (await app<{ profiles: ProfilesV3; builtinTemplates: TemplateMap }>(sv, "/api/profiles")).body;
    const kestrel = characterEntry({ ...characterProfile(profiles, "Kestrel", builtinTemplates), rarity: "higher" }, { on: [], skills: {} });
    assert.equal((await putProfiles(sv, { ...profiles, characters: { ...profiles.characters, Kestrel: kestrel } })).status, 200);
    assert.equal((await tb({}))?.rarity, "higher", "the profile's, kept");
    assert.equal(await tb({ rarity: "any" }), undefined, "any clears it");
    assert.equal(await tb({ template: "tank" }), undefined, "a template without one clears it, as the builder's Apply does");
    assert.equal((await call(port, "build_suit", { character: "Kestrel", rarity: "rarest" })).ok, false);
  } finally { await sv.s.close(); }
});

// Issue #336: a character's build label, saved in its profile, rides along on both character tools.
test("[fast] list_characters and character_sheet carry the build label, null for none", async () => {
  const sv = await serve();
  try {
    const port = await mcpPort(sv);
    const labels = async (): Promise<Record<string, unknown>> => Object.fromEntries((await call(port, "list_characters")).data.characters.map((c: { name: string; label: unknown }) => [c.name, c.label]));
    assert.deepEqual(await labels(), { Dorran: null, Kestrel: null });
    assert.equal((await app(sv, "/api/profiles/label", "PUT", { character: "Kestrel", label: " Archer-Bard " })).status, 200);
    assert.deepEqual(await labels(), { Dorran: null, Kestrel: "Archer-Bard" }, "trimmed");
    assert.equal((await call(port, "character_sheet", { character: "Kestrel" })).data.label, "Archer-Bard");
    assert.equal((await call(port, "character_sheet", { character: "Dorran" })).data.label, null);
  } finally { await sv.s.close(); }
});

// Issue #336: PUT /api/profiles/label changes one label in the file on the server, and a whole-file save keeps the stored
// labels, so a label save and a Suit Builder save made from an older copy of the file both survive, in either order.
test("[fast] PUT /api/profiles/label: one label changed on the server, checked, and kept by a whole-file save in either order", async () => {
  const sv = await serve();
  try {
    type Got = { profiles: ProfilesV3; builtinTemplates: TemplateMap };
    const get = async (): Promise<Got> => (await app<Got>(sv, "/api/profiles")).body;
    const label = (character: string, text: unknown): Promise<{ status: number; body: Record<string, unknown> }> => app(sv, "/api/profiles/label", "PUT", { character, label: text });
    const kestrel = async (): Promise<CharacterEntry | undefined> => (await get()).profiles.characters.Kestrel;
    // A scanned character with no saved settings gets the ones the Suit Builder shows it, with the label.
    assert.equal(await kestrel(), undefined);
    const made = await label("Kestrel", "Archer-Bard");
    assert.equal(made.status, 200);
    assert.equal((made.body.entry as CharacterEntry).label, "Archer-Bard");
    assert.ok((await kestrel())?.spec, "an entry with a spec");
    // Refused: control characters and line breaks, over 40 characters, no text, an unknown or pseudo character.
    for (const bad of ["two\nlines", "tab\there", "nul\u0000", "x".repeat(41), 7]) assert.equal((await label("Kestrel", bad)).status, 400, JSON.stringify(bad));
    assert.equal((await label("Nobody Here", "x")).status, 404);
    assert.equal((await label("_nobody", "x")).status, 404);
    assert.equal((await label("", "x")).status, 400);
    assert.equal((await label("Dorran", "  ")).body.entry, null, "a blank label on a character with no settings writes nothing");
    assert.equal((await get()).profiles.characters.Dorran, undefined);
    // The schema refuses the same on a whole-file save.
    const now = await get();
    const withLabel = (text: string): ProfilesV3 => ({ ...now.profiles, characters: { ...now.profiles.characters, Kestrel: { ...now.profiles.characters.Kestrel!, label: text } } });
    assert.equal((await putProfiles(sv, withLabel("two\nlines"))).status, 400);
    assert.equal((await putProfiles(sv, withLabel("x".repeat(41)))).status, 400);

    // A builder save from a copy read before the label changed: the builder's change lands, the newer label stays.
    const stale = await get();
    assert.equal((await label("Kestrel", "Sampire")).status, 200);
    const higher = characterEntry({ ...characterProfile(stale.profiles, "Kestrel", stale.builtinTemplates), rarity: "higher" }, { on: [], skills: {} });
    assert.equal((await putProfiles(sv, { ...stale.profiles, characters: { ...stale.profiles.characters, Kestrel: { ...higher, label: "Archer-Bard" } } })).status, 200);
    assert.equal((await kestrel())?.spec.intent.rarity, "higher", "the builder's change saved");
    assert.equal((await kestrel())?.label, "Sampire", "the newer label kept, not the copy's");
    // A label save after a builder save: the builder's change stays.
    assert.equal((await label("Kestrel", "Main Crafter")).status, 200);
    assert.equal((await kestrel())?.spec.intent.rarity, "higher");
    assert.equal((await kestrel())?.label, "Main Crafter");
    // A blank label removes the key and keeps the rest.
    assert.equal((await label("Kestrel", "")).status, 200);
    assert.equal((await kestrel())?.label, undefined);
    assert.equal((await kestrel())?.spec.intent.rarity, "higher");
  } finally { await sv.s.close(); }
});
