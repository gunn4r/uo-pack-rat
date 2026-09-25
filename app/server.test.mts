// server.test.mts — HTTP route tests against a real listening server (ephemeral port, tmp data dir).
import { test, before, after, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, renameSync, rmSync, cpSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import http from "node:http";
import { createConnection } from "node:net";
import { resolveConfig, ensureLayout } from "./config.mts";
import { startServer as startRealServer, defaultClientSearch, type ServerHandle, type StartServerOptions } from "./vault-server.mts";
import { buildPools, foldSnapshots, setRules } from "./vault-lib.mts";
import { upgradeScan, validateScan } from "./scan-schema.mts";
import { DEFAULT_OPTIONAL_SLOTS } from "./mip.mts";
import { buildUi } from "../scripts/build-ui.mts";
import { buildSchemaTypes } from "../scripts/build-schema-types.mts";
import { validate, type ValidatorSchema } from "./schema/validate.mts";
import type { Item, Inventory, ProfilesFile } from "./vault-lib.mts";
import type { RulesV1, ScanV2 } from "./schema/types.d.mts";
import { MAX_INBOX_BYTES } from "./watcher.mts";
import { candidateClientRoots, type AdapterInfo, type InstallScriptsResult, type DataDirCheck } from "./installer.mts";

// The server looks for the game client's scripts (GET /api/setup's candidates, and the data-folder
// check at startup and on every GET /api/setup, which reads the packrat-paths.json it finds). No test
// may reach a real client folder, so every server here gets an empty temp home to search, with the
// platform pinned to one that has no fixed-path roots (candidateClientRoots adds C:\TazUO on win32).
const FAKE_HOME = mkdtempSync(join(tmpdir(), "qm-home-"));
const startServer = (config: Parameters<typeof startRealServer>[0], opts: StartServerOptions = {}): Promise<ServerHandle> => startRealServer(config, {
  clientSearch: { home: FAKE_HOME, candidates: (a) => candidateClientRoots({ adapter: a.id, home: FAKE_HOME, platform: "linux", env: {}, adapterPlatform: a.platform }) },
  ...opts,
});

// ---------------------------------------------------------------------------------------------
// HTTP responses are unknown provenance — every route is reachable by any local caller, trusted
// or not, and TypeScript's own DOM lib types Response.json() as Promise<any>, which would
// silently defeat this file's whole point (an `any` swallows a route that stops sending a field
// the same way it swallows a typo). asJson<T>() narrows the parsed body down at the read site:
// `asJson(x)` for a one-level ok/error/whatever check (defaults to a loose Record<string,
// unknown> — every field still reads back `unknown`, forcing a real assertion, never a silent
// property read), `asJson<SomeResponse>(x)` where a test navigates two or more levels deep. The
// per-endpoint interfaces below are declared once, reusing the server's own exported types
// (Item/Inventory/ProfilesFile/RulesV1/AdapterInfo/InstallScriptsResult/SavedRun/...) wherever
// they exist, rather than restating a shape the source already names.
function asJson<T = Record<string, unknown>>(body: unknown): T {
  return body as T;
}

interface InventoryFacets {
  kinds: unknown[];
  gearSkills: string[];
  propKeys?: string[];
  [key: string]: unknown;
}
interface InventorySummary {
  itemCount: number;
  items?: undefined;
  facets: InventoryFacets;
  worn: Record<string, unknown>;
  containers: Record<string, unknown>;
  rootCounts: Record<string, unknown>;
  characters: Record<string, Record<string, unknown>>;
  propKeys: string[];
}
interface InventoryResponse {
  ok: boolean;
  snapshotCount: number;
  scansDir?: string;
  inventory: InventorySummary;
}
interface ProfilesResponse {
  ok?: boolean;
  profiles: ProfilesFile;
}
interface RulesResponse {
  ok: boolean;
  shard: string;
  rules: RulesV1;
  available: Array<{ id: string; name: string; source: string }>;
  fallback: boolean;
}
interface ClientSetting { adapter: string; scriptsDir: string; }
interface SettingsResponse {
  ok?: boolean;
  settings: { shard: string; setupDone?: boolean; client?: ClientSetting };
}
interface SetupAdapter extends Omit<AdapterInfo, "capabilities"> {
  capabilities: { bridge: string[]; [key: string]: unknown };
}
interface SetupResponse {
  ok: boolean;
  firstRun: boolean;
  adapters: SetupAdapter[];
  available: Record<string, string | null>;
  installed: { version: string | null; files: Record<string, boolean> } | null;
  dataDir: string;
  candidates: Record<string, string[]>;
  platform: string;
  settings: { client?: ClientSetting };
  bridgeAdapter: string | null;
  dataDirCheck: DataDirCheck;
  version: string;
}
interface LocateResponse {
  scriptsDir?: string;
  installed?: { version: string | null; files: Record<string, boolean> };
  error?: string;
}
interface ItemsPageResponse {
  ok: boolean;
  rows?: Item[];
  groups?: unknown[];
  total: number;
  stacks?: number;
  pieces?: number;
  limit?: number;
}
interface ItemsBySerialResponse {
  ok: boolean;
  items: Record<string, Item>;
}
// Covers both a POST /api/optimize start response and a GET /api/optimize/<id>/status poll —
// several tests reassign one `status` variable across both shapes as a job runs to completion
// (see vault-server.mts's own POST /api/optimize and jobSnapshot() response literals).
interface OptimizeJobResponse {
  id?: string;
  warmFrom?: string | null;
  superseded?: string | null;
  warning?: string;
  poolSize?: number;
  skipped?: Record<string, unknown>;
  current?: Record<string, unknown>;
  blocked?: string[];
  cached?: boolean;
  state?: string;
  progress?: unknown;
  result?: { solver?: string; proven?: boolean; score?: number; method?: string; [key: string]: unknown };
  ms?: number;
  error?: string;
  runId?: string;
}
interface RunResponse {
  ok?: boolean;
  run: { result: { score: number; [key: string]: unknown }; [key: string]: unknown };
}
interface RescanResponse {
  ok: boolean;
  adapters: string[];
}
// assert.match/doesNotMatch need a real string, not `unknown` — every 4xx/5xx body this file checks
// with a regex against .error gets this cast instead of Record<string, unknown>'s default.
interface ErrorBody {
  error: string;
  ref?: string;
}
interface PasteResponse {
  ok: boolean;
  character?: string;
  written?: string;
  warning?: string;
  error?: string;
}

const BRIDGE_SCHEMA = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "schema", "bridge.v1.schema.json"), "utf8")) as { command: ValidatorSchema; result: ValidatorSchema; status: ValidatorSchema };

// Order matters: build the schema types before buildUi() runs, not because tsconfig.browser.json's
// `include` enforces it (a missing literal entry there is silently dropped, not an error — verified)
// but because this call is the only actual guarantee app/schema/types.d.mts exists before anything
// imports from it. Also so a bare `node --test app/server.test.mts` works on a fresh clone (no
// pretest hook run). The optimizer core needs no build step of its own — startServer() below resolves
// it straight from source via config.mts's paths.core (PACKRAT_CORE overrides it).
buildSchemaTypes();
buildUi();   // this file's own route tests fetch /ui/app.mjs and /vault-lib.mjs from app/dist/
const HERE = dirname(fileURLToPath(import.meta.url));
// The version the repo's own tazuo adapter ships, read the same way installer.mts's installedVersion
// reads it — every assertion about a "repo-shipped" or "just installed" version compares against this
// rather than a literal, so bumping ADAPTER_VERSION in the .py is not also a test edit.
const TAZUO_VERSION = /ADAPTER_VERSION\s*=\s*"([^"]+)"/.exec(readFileSync(join(HERE, "..", "adapters", "tazuo", "packrat-scanner.py"), "utf8"))![1]!;
// This file's own vault-lib.mts import is a separate module instance from the one the server
// dynamically re-imports per request (busted by mtime) — a direct call here to a rules-aware
// function (buildPools) needs its own setRules().
setRules(JSON.parse(readFileSync(join(HERE, "rules", "uoalive.json"), "utf8")) as RulesV1);

let srv: ServerHandle;
before(async () => { srv = await startServer(ensureLayout(resolveConfig(["--demo", "--port", "0", "--data", mkdtempSync(join(tmpdir(), "qm-"))], {}))); });
after(() => srv.close());
const get = (p: string): Promise<Response> => fetch(srv.url + p);

// Since Task 5, GET /api/inventory never carries the full item map (the page pages GET /api/items
// instead), so a test that wants to run buildPools() itself — to check the server's by-character
// /api/optimize form against a client-equivalent call — has to fold the same scan files the server
// folds, the same way the server's own readScans()+getInventory() do (upgrade, validate, skip a bad
// file rather than throw), instead of reading the (now slimmer) HTTP response.
function foldFixtures(dir: string, shard = "uoalive"): Inventory {
  const docs: ScanV2[] = [];
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
    try {
      const raw: unknown = JSON.parse(readFileSync(join(dir, f), "utf8"));
      const doc = upgradeScan(raw, { shard });
      const { ok } = validateScan(doc);
      if (ok) docs.push(doc as ScanV2);   // known-good fixture: the cast stands in for the validateScan() a real caller runs, gated on the ok check just above
    } catch { /* skip an unparsable fixture, same as the server does */ }
  }
  return foldSnapshots(docs);
}

// fetch() (both browser and Node's undici) refuses to let a caller set Host or Origin — both are on
// the Fetch spec's forbidden-header list — so the Host/Origin tests below go around it with node:http
// directly, which has no such restriction. rawReq(url, {method, headers, body}) → {status, headers, text, json()}.
// `.json()` here is a SYNCHRONOUS, already-resolved read (unlike fetch's own Promise-returning
// Response.json()) — its own return type is `unknown`, same reasoning as asJson() above.
interface RawResponse {
  status: number | undefined;
  headers: http.IncomingHttpHeaders;
  text: string;
  json: () => unknown;
}
interface RawReqOptions {
  method?: string;
  headers?: http.OutgoingHttpHeaders;
  body?: string;
}
function rawReq(url: string, { method = "GET", headers = {}, body }: RawReqOptions = {}): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, method, headers }, (res) => {
      let buf = "";
      res.setEncoding("utf8");
      res.on("data", (c: string) => { buf += c; });
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, text: buf, json: () => JSON.parse(buf) }));
    });
    req.on("error", reject);
    if (body != null) req.write(body);
    req.end();
  });
}

// /api/events (and the per-job optimize events route) never end on their own — a plain rawReq/fetch
// that waits for the response body to finish would hang forever. sseReader(response) hands back one
// reader + decoder + growing buffer a test can call readUntil(matcher) on repeatedly (a stream can
// only ever be locked by one reader — getReader() a second time throws — so the reader is created
// once and reused for every event the test waits on).
interface SseReaderHandle {
  readUntil: (matcher: (buf: string) => boolean, opts?: { timeoutMs?: number }) => Promise<string>;
  cancel: () => Promise<void>;
}
function sseReader(response: Response): SseReaderHandle {
  const reader = response.body!.getReader();   // every caller passes the body of a 200 SSE response, which always carries a body
  const decoder = new TextDecoder();
  let buf = "";
  // A reader.read() that loses the Promise.race below (the timeout wins) is NOT cancelled — it stays
  // pending and will still resolve with whatever chunk arrives next. `pending` remembers that in-flight
  // call across readUntil invocations, so a caller that retries readUntil after a timeout (see
  // readUntilOrRescan below) reuses it instead of issuing a second, concurrent reader.read(): two
  // concurrent reads on one reader resolve strictly in call order, so a second call would only ever see
  // the chunk AFTER the one the first (abandoned) call is still waiting on — silently stealing the very
  // event a retry is waiting for. Found by exactly that symptom: a synthetic "fs.watch delivers nothing"
  // repro that proved the server-side broadcast happened (via the watcher's own log) while a naive retry
  // still timed out.
  let pending: Promise<ReadableStreamReadResult<Uint8Array>> | null = null;
  async function readUntil(matcher: (buf: string) => boolean, { timeoutMs = 3000 }: { timeoutMs?: number } = {}): Promise<string> {
    const deadline = Date.now() + timeoutMs;
    while (!matcher(buf)) {
      const remaining = Math.max(1, deadline - Date.now());
      if (remaining <= 1 && Date.now() >= deadline) throw new Error(`sseReader: timed out waiting for a match; got:\n${buf}`);
      if (!pending) pending = reader.read();
      const { value, done } = await Promise.race([
        pending,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("sseReader: timed out")), remaining)),
      ]);
      pending = null;   // consumed — safe to start a fresh read() next iteration (ours or a later retry's)
      if (done) throw new Error(`sseReader: stream ended before a match; got:\n${buf}`);
      buf += decoder.decode(value, { stream: true });
    }
    return buf;
  }
  return { readUntil, cancel: () => reader.cancel().catch(() => {}) };
}

// A dropped inbox file's fs.watch notification can be silently missed by the OS — reproduced live
// (not a timing-margin issue: an instrumented trace showed the watcher's fs.watch callback firing
// ZERO times for the whole life of the affected watcher, not late) in
// .superpowers/sdd/2026-09-17-phase-6-adapters/sse-flake-report.md. app/vault-server.mts's own
// POST /api/import and /api/import/paste routes already treat this as expected platform behavior and
// nudge scanOnce() themselves instead of trusting fs.watch alone (see their "Nudge the watcher"
// comments); POST /api/import/rescan exposes that same nudge for a drop the app didn't make itself —
// exactly the case here, and exactly what a real player would click if their drop never lit up. So a
// test waiting on a live SSE event from a dropped file does what a real player would do when fs.watch
// stays silent: rescan once, then keep waiting — a longer timeout would not help an event that never
// fires at all. Any OTHER readUntil failure (the stream ending, a wiring/crash bug) is not swallowed —
// only "timed out" retries through the rescan; scanOnce()/ingestFile are idempotent, so a rescan that
// races a live event that was merely slow (not dropped) is harmless either way.
async function readUntilOrRescan(sse: SseReaderHandle, matcher: (buf: string) => boolean, serverUrl: string, { timeoutMs = 3000, rescanTimeoutMs = 5000 }: { timeoutMs?: number; rescanTimeoutMs?: number } = {}): Promise<string> {
  try {
    return await sse.readUntil(matcher, { timeoutMs });
  } catch (e) {
    if (!/timed out/.test((e as Error).message)) throw e;
    await fetch(serverUrl + "/api/import/rescan", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    return sse.readUntil(matcher, { timeoutMs: rescanTimeoutMs });
  }
}

test("[smoke] / serves the page with a CSP and no inline script", async () => {
  const r = await get("/"); assert.equal(r.status, 200);
  assert.match(r.headers.get("content-security-policy") || "", /script-src 'self'/);
  assert.equal(r.headers.get("x-content-type-options"), "nosniff");
});
test("[smoke] / has no inline <script>", async () => {
  const r = await get("/");
  assert.doesNotMatch(await r.text(), /<script(?![^>]*\bsrc=)/, "no inline <script>");
});
test("[smoke] /api/inventory has no scansDir and folds the demo fixtures", async () => {
  const j = asJson<InventoryResponse>(await (await get("/api/inventory")).json());
  assert.equal(j.ok, true); assert.equal("scansDir" in j, false); assert.ok(j.snapshotCount >= 2);
});
// --demo points paths.scans at the committed app/fixtures/ directory; Forget must refuse there
// instead of writing a tombstone into repo data. Uses the module-level `srv` (--demo).
test("[fast] POST /api/forget is refused under --demo, and app/fixtures/ stays clean", async () => {
  const before = readdirSync(join(HERE, "fixtures")).sort();
  const r = await fetch(srv.url + "/api/forget", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ root: 12345 }),
  });
  assert.equal(r.status, 409);
  assert.deepEqual(asJson(await r.json()), { ok: false, error: "demo data is read-only" });
  assert.deepEqual(readdirSync(join(HERE, "fixtures")).sort(), before, "no file was written under app/fixtures/");
});
// Post-review fix: only truthiness was checked, so {root:"abc"} used to return 200 and write a
// tombstone whose roots[0].serial serialized to null — every later read then logged a schema
// violation forever while the user believed the container was forgotten.
test("[fast] POST /api/forget rejects a non-integer or non-positive root before writing anything", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--port", "0", "--data", dir], {})));
  try {
    for (const bad of ["abc", 0, -5, 12.5, null]) {
      const r = await fetch(s2.url + "/api/forget", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ root: bad }) });
      assert.equal(r.status, 400, `root ${JSON.stringify(bad)} should be rejected`);
    }
    assert.equal(existsSync(join(dir, "scans")) ? readdirSync(join(dir, "scans")).length : 0, 0, "no tombstone was written for any rejected root");
    const ok = await fetch(s2.url + "/api/forget", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ root: 12345 }) });
    assert.equal(ok.status, 200);
  } finally {
    await s2.close();
  }
});
// Forget and run deletion used to push nothing on /api/events, so every other open tab kept showing the
// forgotten container or the deleted run until a manual reload.
test("[fast] POST /api/forget and DELETE /api/runs/<id> stream a changed event to open tabs", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-changed-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--port", "0", "--data", dir], {})));
  const sse = sseReader(await fetch(s2.url + "/api/events"));
  try {
    await sse.readUntil((b) => b.includes("event: hello"));
    assert.equal((await fetch(s2.url + "/api/forget", { method: "POST", headers: { ...JSON_HEADERS, "x-client-id": "tab-a" }, body: JSON.stringify({ root: 12345 }) })).status, 200);
    await sse.readUntil((b) => b.includes('event: changed\ndata: {"what":"inventory","by":"tab-a"'));
    const id = "0b5c1a4e-0000-4000-8000-000000000002";
    writeFileSync(join(dir, "runs", `${id}.json`), "{}");
    assert.equal((await fetch(s2.url + `/api/runs/${id}`, { method: "DELETE" })).status, 200);
    await sse.readUntil((b) => b.includes('event: changed\ndata: {"what":"runs"'));
  } finally {
    await sse.cancel();
    await s2.close();
  }
});
// Post-review fix: POST /api/bridge only checked action/serial were truthy, so a page bug or any
// other local caller could queue a line violating BRIDGE_SCHEMA.command on several counts (unknown
// action, non-integer serial, missing name) at once. Validates the LINE THE ROUTE ACTUALLY WROTE
// (read back off disk), not a hand-written literal.
test("[fast] POST /api/bridge validates the assembled line against BRIDGE_SCHEMA.command", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--demo", "--port", "0", "--data", dir], {})));
  try {
    const badAction = await fetch(s2.url + "/api/bridge", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "delete-everything", serial: 1, name: "n", chain: [], pos: null }) });
    assert.equal(badAction.status, 400);
    const badSerial = await fetch(s2.url + "/api/bridge", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "grab", serial: "0x40000010", name: "n", chain: [], pos: null }) });
    assert.equal(badSerial.status, 400);
    const badChain = await fetch(s2.url + "/api/bridge", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "grab", serial: 1, name: "n", chain: ["x"], pos: null }) });
    assert.equal(badChain.status, 400);
    const good = await fetch(s2.url + "/api/bridge", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "grab", serial: 0x40000010, name: "Ring", chain: [1, 2], pos: null }) });
    assert.equal(good.status, 200);
    const { id } = asJson(await good.json());
    const lines = readFileSync(join(dir, "bridge", "tazuo", "queue.jsonl"), "utf8").trim().split("\n");
    assert.equal(lines.length, 1, "only the valid call should have queued a line");
    const written = JSON.parse(lines[0]!);
    assert.equal(written.id, id);
    const v = validate(BRIDGE_SCHEMA.command, written);
    assert.equal(v.ok, true, JSON.stringify(v.errors));
  } finally {
    await s2.close();
  }
});

// ---- Per-adapter bridge routing (Phase 6 final review follow-up) ----------------------------------
// The bridge queue/status routes and the installer's running-bridge guard used to be hard-coded to
// <data>/bridge/tazuo/ regardless of which client was actually configured — a Razor Enhanced player
// whose capabilities.json declares all three bridge actions got real Highlight/Grab/Go-to buttons
// that queued commands into a folder adapters/razor-enhanced/packrat-bridge.py never reads (it reads
// its own <data>/bridge/razor-enhanced/, per its own header). These three tests cover exactly the
// three things asked for: a command lands in the CONFIGURED adapter's own queue and not another's,
// the status indicator reads the configured adapter's own status, and the install guard checks the
// adapter actually being installed.

test("[fast] POST /api/bridge queues into the configured adapter's own directory, not a fixed tazuo one, and never cross-contaminates", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-bridge-routing-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--demo", "--port", "0", "--data", dir], {})));
  try {
    const setClient = await fetch(s2.url + "/api/settings", { method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ client: { adapter: "razor-enhanced", scriptsDir: dir } }) });
    assert.equal(setClient.status, 200, JSON.stringify(asJson(await setClient.json())));

    const r = await fetch(s2.url + "/api/bridge", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "grab", serial: 0x40000010, name: "Ring", chain: [], pos: null }) });
    assert.equal(r.status, 200, JSON.stringify(await r.json().catch(() => null)));

    assert.ok(existsSync(join(dir, "bridge", "razor-enhanced", "queue.jsonl")), "the command landed in razor-enhanced's own queue");
    assert.equal(existsSync(join(dir, "bridge", "tazuo", "queue.jsonl")), false, "nothing was written to tazuo's queue for a razor-enhanced-configured client");
    const lines = readFileSync(join(dir, "bridge", "razor-enhanced", "queue.jsonl"), "utf8").trim().split("\n");
    assert.equal(lines.length, 1);
    assert.equal(JSON.parse(lines[0]!).action, "grab");
  } finally {
    await s2.close();
  }
});

test("[fast] GET /api/bridge/status reads the configured adapter's own status.json, not a fixed tazuo one", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-bridge-status-routing-"));
  // razor-enhanced's status, written directly (as its own packrat-bridge.py would) — deliberately
  // different from anything that would ever land in bridge/tazuo/.
  const razorBridgeDir = join(dir, "bridge", "razor-enhanced");
  mkdirSync(razorBridgeDir, { recursive: true });
  writeFileSync(join(razorBridgeDir, "status.json"), JSON.stringify({
    alive: new Date().toISOString(), character: "RazorPlayer", current: null, results: {}, counts: { done: 0, failed: 0 },
  }));
  // A DIFFERENT (older/dead) tazuo status, so a test that accidentally read the wrong file would be
  // caught by either the character name or the online flag being wrong, not just a missing-file 404.
  const tazuoBridgeDir = join(dir, "bridge", "tazuo");
  mkdirSync(tazuoBridgeDir, { recursive: true });
  writeFileSync(join(tazuoBridgeDir, "status.json"), JSON.stringify({
    alive: new Date(Date.now() - 3600_000).toISOString(), character: "WrongCharacter", current: null, results: {}, counts: { done: 0, failed: 0 },
  }));

  const s2 = await startServer(ensureLayout(resolveConfig(["--demo", "--port", "0", "--data", dir], {})));
  try {
    const setClient = await fetch(s2.url + "/api/settings", { method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ client: { adapter: "razor-enhanced", scriptsDir: dir } }) });
    assert.equal(setClient.status, 200, JSON.stringify(asJson(await setClient.json())));

    const st = asJson(await (await fetch(s2.url + "/api/bridge/status")).json());
    assert.equal(st.online, true, JSON.stringify(st));
    assert.equal(st.character, "RazorPlayer", "must read razor-enhanced's own status, not tazuo's stale one");
  } finally {
    await s2.close();
  }
});

test("[fast] POST /api/setup/install's running-bridge guard checks the adapter being INSTALLED, not the currently-configured client", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-bridge-install-guard-"));
  // tazuo's bridge looks alive — but we're about to install razor-enhanced, a different adapter, so
  // this must NOT block the install.
  const tazuoBridgeDir = join(dir, "bridge", "tazuo");
  mkdirSync(tazuoBridgeDir, { recursive: true });
  writeFileSync(join(tazuoBridgeDir, "status.json"), JSON.stringify({ alive: new Date().toISOString(), character: "Someone", current: null, results: {}, counts: { done: 0, failed: 0 } }));

  const s2 = await startServer(ensureLayout(resolveConfig(["--port", "0", "--data", dir], {})));
  try {
    const scriptsDir1 = mkdtempSync(join(tmpdir(), "qm-bridge-install-guard-dest1-"));
    const installOther = await fetch(s2.url + "/api/setup/install", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ adapter: "razor-enhanced", scriptsDir: scriptsDir1 }) });
    assert.equal(installOther.status, 200, `installing razor-enhanced must not be blocked by tazuo's own bridge running: ${JSON.stringify(await installOther.json().catch(() => null))}`);

    // Now make razor-enhanced's OWN bridge look alive, and installing razor-enhanced again must be refused.
    const razorBridgeDir = join(dir, "bridge", "razor-enhanced");
    mkdirSync(razorBridgeDir, { recursive: true });
    writeFileSync(join(razorBridgeDir, "status.json"), JSON.stringify({ alive: new Date().toISOString(), character: "Someone", current: null, results: {}, counts: { done: 0, failed: 0 } }));
    const scriptsDir2 = mkdtempSync(join(tmpdir(), "qm-bridge-install-guard-dest2-"));
    const installSelf = await fetch(s2.url + "/api/setup/install", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ adapter: "razor-enhanced", scriptsDir: scriptsDir2 }) });
    assert.equal(installSelf.status, 409, "installing razor-enhanced again must be refused once ITS OWN bridge looks alive");
  } finally {
    await s2.close();
  }
});

test("[fast] /ui/ rejects traversal and unlisted files", async () => {
  assert.equal((await get("/ui/../vault-server.mts")).status, 404);
  assert.equal((await get("/ui/nope.mjs")).status, 404);
});
test("[fast] /ui/app.mjs is served with the right content-type", async () => {
  assert.equal((await get("/ui/app.mjs")).status, 200);
  assert.equal((await get("/ui/app.mjs")).headers.get("content-type"), "text/javascript; charset=utf-8");
});
// ui/shard.mts (Important 3's fix: changeShard(), shared by the header picker and the wizard's shard
// step) is just another file under app/ui/ — the /ui/<name> allowlist route needs no per-file
// registration, but a new module is still worth a one-line proof it's actually reachable.
test("[fast] /ui/shard.mjs is served with the right content-type", async () => {
  assert.equal((await get("/ui/shard.mjs")).status, 200);
  assert.equal((await get("/ui/shard.mjs")).headers.get("content-type"), "text/javascript; charset=utf-8");
});
// The bundled IBM Plex faces (app/ui/tokens.css's @font-face) come from app/ui/fonts/, byte for byte,
// as font/woff2 with no charset: a font sent as text would be refused by the browser, and the CSP's
// font-src 'self' allows exactly this origin. Anything but a flat .woff2 name in that folder is a 404.
test("[fast] /ui/fonts/ serves the bundled woff2 files as binary font/woff2", async () => {
  const name = "ibm-plex-sans-latin-400-normal.woff2";
  const res = await get(`/ui/fonts/${name}`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "font/woff2");
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.deepEqual(Buffer.from(await res.arrayBuffer()), readFileSync(join(HERE, "ui", "fonts", name)));
  for (const bad of ["/ui/fonts/OFL-IBM-Plex-Sans.txt", "/ui/fonts/nope.woff2", "/ui/fonts/..%2fstyles.css", "/ui/fonts/sub/x.woff2"]) {
    assert.equal((await get(bad)).status, 404, bad);
  }
});
test("[fast] the page's stylesheets and fonts are allowed by its own CSP", async () => {
  const csp = (await get("/")).headers.get("content-security-policy") || "";
  assert.match(csp, /font-src 'self'/);
  assert.match(csp, /style-src 'self'/);
  assert.match(csp, /img-src 'self' data:/, "the Britannia theme's frame and texture are inline data: images");
  for (const css of ["tokens.css", "britannia.css", "components.css", "styles.css"]) assert.equal((await get(`/ui/${css}`)).status, 200, css);
  assert.equal((await get("/ui/fonts/cinzel-latin-600-normal.woff2")).status, 200, "Britannia's display face");
});
// scan-schema.mjs (served at /scan-schema.mjs) imports validate() from "./schema/validate.mjs" — the
// browser resolves that relative import against scan-schema.mjs's own served URL, so it 404s without
// this route. Caught live by the Task 2 browser check (a bootstrap import chain failure with no other
// visible symptom besides a stuck "loading…" status and one console error).
test("[fast] /schema/validate.mjs is servable (scan-schema.mjs's own relative import)", async () => {
  const r = await get("/schema/validate.mjs");
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("content-type"), "text/javascript; charset=utf-8");
  assert.match(await r.text(), /export function validate/);
});
test("[fast] /paste-scan.mjs is servable (the Import drawer's preview parses with the server's rule)", async () => {
  const r = await get("/paste-scan.mjs");
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("content-type"), "text/javascript; charset=utf-8");
  assert.match(await r.text(), /export function parsePastedScan/);
});
test("[fast] /favicon.png is the logo, served same-origin as image/png, and the page links it", async () => {
  const r = await get("/favicon.png");
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("content-type"), "image/png");
  assert.equal(r.headers.get("x-content-type-options"), "nosniff");
  const body = Buffer.from(await r.arrayBuffer());
  assert.deepEqual(body, readFileSync(join(dirname(fileURLToPath(import.meta.url)), "assets", "favicon.png")), "the bytes arrive unaltered, not re-encoded as text");
  assert.match(await (await get("/")).text(), /<link rel="icon" type="image\/png" href="\/favicon\.png">/);
});
// The sidebar's mark is the rat's head cropped from the logo (build/README.md), 80 px so its 40 px circle is
// sharp on a 2x screen; the full logo stays the favicon and the window icon.
test("[fast] /logo-mark.png is the sidebar's mark, served as image/png, and the sidebar's brand uses it", async () => {
  const r = await get("/logo-mark.png");
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("content-type"), "image/png");
  const body = Buffer.from(await r.arrayBuffer());
  assert.deepEqual(body, readFileSync(join(dirname(fileURLToPath(import.meta.url)), "assets", "logo-mark.png")));
  assert.deepEqual([body.readUInt32BE(16), body.readUInt32BE(20)], [80, 80], "80 × 80: a 40 px circle at 2x");
  assert.match(await (await get("/")).text(), /<div class="brand"><img src="\/logo-mark\.png"/);
});
test("[fast] writes require application/json", async () => {
  const r = await fetch(srv.url + "/api/profiles", { method: "PUT", body: "{}" });
  assert.equal(r.status, 415);
});

// readScans() (app/vault-server.mts) upgrades and schema-validates every scan file on read; a file
// that fails either step must be logged (console.warn) and skipped, never crash the server or the
// rest of the fold. Uses a non-demo server (--demo redirects paths.scans to app/fixtures, which this
// test needs to control directly) with its own scans/ directory seeded with one valid v1 fixture
// copy alongside a syntactically-broken file and a schema-invalid one.
test("[fast] readScans() skips invalid scan files (bad JSON, schema-invalid) instead of crashing the server", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-"));
  const scansDir = join(dir, "scans");
  mkdirSync(scansDir, { recursive: true });
  writeFileSync(join(scansDir, "demo-Kestrel.json"), readFileSync(join(HERE, "fixtures", "demo-Kestrel.json"), "utf8"));
  writeFileSync(join(scansDir, "broken.json"), "{not json");
  writeFileSync(join(scansDir, "bad-schema.json"), JSON.stringify({ schemaVersion: 2, character: 5 }));
  const s2 = await startServer(ensureLayout(resolveConfig(["--port", "0", "--data", dir], {})));
  try {
    const j1 = asJson<InventoryResponse>(await (await fetch(s2.url + "/api/inventory")).json());
    assert.equal(j1.ok, true);
    assert.equal(j1.snapshotCount, 1, "only the one valid scan should have folded");
    assert.ok(j1.inventory.characters.Kestrel, "the valid scan folded despite the two bad files alongside it");
    // a second request proves the bad files didn't leave the server in a broken state
    const j2 = asJson<InventoryResponse>(await (await fetch(s2.url + "/api/inventory")).json());
    assert.equal(j2.ok, true);
    assert.equal(j2.snapshotCount, 1);
  } finally {
    await s2.close();
  }
});

// A build in progress keeps its SSE client's response "waiting for a response", which is exactly
// what server.close() waits out by default — without ending those streams first, close() would hang
// on the connection's keep-alive idle timeout (seconds) instead of resolving once the workers stop.
test("[fast] close() ends open SSE streams instead of waiting out their keep-alive", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--demo", "--port", "0", "--data", dir], {})));
  try {
    const inv = asJson<InventoryResponse>(await (await fetch(s2.url + "/api/inventory")).json());
    const profiles = asJson<ProfilesResponse>(await (await fetch(s2.url + "/api/profiles")).json());
    const rules = asJson<RulesResponse>(await (await fetch(s2.url + "/api/rules")).json());
    const character = Object.keys(inv.inventory.characters)[0]!;
    const { pools, current } = buildPools(foldFixtures(join(HERE, "fixtures")), character, {});
    const templateName = Object.keys(profiles.profiles.templates!)[0]!;
    const profile = { ...profiles.profiles.templates![templateName], caps: rules.rules.caps };
    const r = await fetch(s2.url + "/api/optimize", {
      method: "POST", headers: { "content-type": "application/json", "x-client-id": "close-test-client" },
      body: JSON.stringify({ pools, current, profile, opts: { exact: true, timeBudgetMs: 5000 } }),
    });
    const { id } = asJson<OptimizeJobResponse>(await r.json());
    // The events route requires ?client= to match the job's own clientId (the X-Client-Id header sent
    // above) since the null-clientId collision fix — omitting it now correctly 403s (see the two tests
    // in the "localhost security" section below that check that directly).
    const events = await fetch(s2.url + `/api/optimize/${id}/events?client=close-test-client`);
    assert.equal(events.status, 200);
    const first = await events.body!.getReader().read();   // "hello" — proves the client attached while the job was running
    assert.match(new TextDecoder().decode(first.value), /event: hello/);
    const t0 = Date.now();
    await s2.close();
    assert.ok(Date.now() - t0 < 1000, `close() took ${Date.now() - t0}ms`);
  } finally {
    await s2.close();
  }
});

// GET /api/events (Task 1, Phase 4): a non-demo server watches inbox/tazuo/ (app/watcher.mts) and
// streams accept/reject over one shared SSE connection; --demo starts no watcher at all.
test("[fast] GET /api/events: hello lists the tazuo adapter, and an accepted inbox file streams an inventory event", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-events-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--port", "0", "--data", dir], {})));
  try {
    const res = await fetch(s2.url + "/api/events");
    assert.equal(res.status, 200);
    const sse = sseReader(res);
    const hello = await sse.readUntil((buf) => buf.includes("event: hello"));
    const helloData = JSON.parse(hello.match(/event: hello\ndata: (.+)\n/)![1]!);
    assert.equal(helloData.ok, true);
    // Present, not pinned: the real point here is "tazuo is watched, and an accepted file in its
    // inbox streams an event" (below) — not the exact set of every adapter shipped in this repo.
    assert.ok(helloData.watching.includes("tazuo"), JSON.stringify(helloData.watching));

    const fixture = JSON.parse(readFileSync(join(HERE, "..", "adapters", "tazuo", "fixture.scan.json"), "utf8"));
    const inboxDir = join(dir, "inbox", "tazuo");
    const tmpPath = join(inboxDir, "drop.json.tmp");
    writeFileSync(tmpPath, JSON.stringify(fixture));
    renameSync(tmpPath, join(inboxDir, "drop.json"));

    const invBuf = await readUntilOrRescan(sse, (buf) => buf.includes("event: inventory"), s2.url);
    const invData = JSON.parse(invBuf.match(/event: inventory\ndata: (.+)\n/)![1]!);
    assert.equal(invData.character, fixture.character);
    assert.equal(existsSync(join(inboxDir, "drop.json")), false, "the inbox file is gone once accepted");
    sse.cancel();

    const inv = asJson<InventoryResponse>(await (await fetch(s2.url + "/api/inventory")).json());
    assert.ok(inv.inventory.characters[fixture.character], JSON.stringify(Object.keys(inv.inventory.characters)));
  } finally {
    await s2.close();
  }
});

test("[fast] GET /api/events: an invalid inbox file streams a rejected event and lands under rejected/", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-events-rej-"));
  // Fast watcher timing (matches app/watcher.test.mts's own debounceMs:20/retryDelayMs:20 convention):
  // this waits out a full debounce + retries-1 backoff delays before the reject fires, so leaving the
  // production defaults (300ms/700ms) in only barely clears the SSE read's timeout on a loaded machine.
  const s2 = await startServer(ensureLayout(resolveConfig(["--port", "0", "--data", dir], {})),
    { watcherOptions: { debounceMs: 20, retries: 3, retryDelayMs: 20 } });
  try {
    const res = await fetch(s2.url + "/api/events");
    const sse = sseReader(res);
    await sse.readUntil((buf) => buf.includes("event: hello"));

    const inboxDir = join(dir, "inbox", "tazuo");
    const tmpPath = join(inboxDir, "bad.json.tmp");
    writeFileSync(tmpPath, "not json");
    renameSync(tmpPath, join(inboxDir, "bad.json"));

    const rejBuf = await readUntilOrRescan(sse, (buf) => buf.includes("event: rejected"), s2.url, { timeoutMs: 5000 });
    const rejData = JSON.parse(rejBuf.match(/event: rejected\ndata: (.+)\n/)![1]!);
    assert.equal(rejData.file, "bad.json");
    assert.ok(existsSync(join(inboxDir, "rejected", "bad.json")));
    sse.cancel();
  } finally {
    await s2.close();
  }
});

// Post-review fix (Important 1): a log destination that throws on every write (a full disk, or a
// user deleting logs/ via the Settings tab's own "Open" button — spec §11's own examples) used to
// crash the whole process, since app/watcher.mts's ingestFile/enqueue treated `log()` as "never
// throws". Replacing logs/ with a plain FILE of the same name is the cross-platform way to make
// every appendFileSync into it fail (ENOTDIR/EEXIST depending on the OS, rather than relying on a
// chmod that root or Windows can ignore).
test("[fast] a log destination that throws on every write does not crash the server: the bad file still lands in rejected/ and GET /api/inventory still serves", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-log-crash-"));
  // Fast watcher timing (see the sibling "invalid inbox file" test above for why): without this, the
  // rejected event only fires after debounceMs + (retries-1)×retryDelayMs of real wall-clock waiting
  // (300 + 2×700 = 1700ms with the production defaults) inside a fixed 5000ms SSE read — comfortable
  // in isolation, but tight enough that a loaded machine (a full-suite run, real CI) can trip it.
  const s2 = await startServer(ensureLayout(resolveConfig(["--port", "0", "--data", dir], {})),
    { watcherOptions: { debounceMs: 20, retries: 3, retryDelayMs: 20 } });
  try {
    const logsDir = join(dir, "logs");   // ensureLayout() already created this as a real directory
    rmSync(logsDir, { recursive: true, force: true });
    writeFileSync(logsDir, "not a directory\n");

    const res = await fetch(s2.url + "/api/events");
    const sse = sseReader(res);
    await sse.readUntil((buf) => buf.includes("event: hello"));

    const inboxDir = join(dir, "inbox", "tazuo");
    const tmpPath = join(inboxDir, "bad.json.tmp");
    writeFileSync(tmpPath, "not json");
    renameSync(tmpPath, join(inboxDir, "bad.json"));

    // Before the fix, the watcher's very first log() call (app/vault-server.mts's callback into
    // app/watcher.mts) threw, leaving the watcher's promise chain rejected with no handler — an
    // unhandled rejection that took the whole process down well before this event could ever fire,
    // and well before the retries/rejectFile below would ever run.
    const rejBuf = await readUntilOrRescan(sse, (buf) => buf.includes("event: rejected"), s2.url, { timeoutMs: 5000 });
    const rejData = JSON.parse(rejBuf.match(/event: rejected\ndata: (.+)\n/)![1]!);
    assert.equal(rejData.file, "bad.json");
    assert.ok(existsSync(join(inboxDir, "rejected", "bad.json")), "the bad file was still quarantined despite every log write failing");
    sse.cancel();

    // A successful fetch here is itself proof the process survived — it could not respond at all
    // (let alone with 200) if the unhandled rejection from before the fix had taken it down.
    const invRes = await fetch(s2.url + "/api/inventory");
    assert.equal(invRes.status, 200, "the server kept serving /api/inventory after a run of failed log writes");
    assert.equal(asJson(await invRes.json()).ok, true);
  } finally {
    await s2.close();
  }
});

test("[fast] GET /api/events: --demo starts no watcher (hello.watching is empty)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-events-demo-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--demo", "--port", "0", "--data", dir], {})));
  try {
    const res = await fetch(s2.url + "/api/events");
    const sse = sseReader(res);
    const hello = await sse.readUntil((buf) => buf.includes("event: hello"));
    const helloData = JSON.parse(hello.match(/event: hello\ndata: (.+)\n/)![1]!);
    assert.deepEqual(helloData.watching, []);
    sse.cancel();
  } finally {
    await s2.close();
  }
});

// Shard rules + settings (Task 2): GET /api/rules reports the current shard and every rules file
// listRules() finds; PUT /api/settings switches the shard (validated against that same list) and the
// next GET /api/rules reflects it; an unknown shard is rejected before anything is written.
test("[fast] GET /api/rules reports the current shard and at least the two builtin rules files", async () => {
  const j = asJson<RulesResponse>(await (await get("/api/rules")).json());
  assert.equal(j.ok, true);
  assert.equal(j.shard, "uoalive");
  assert.equal(j.rules.id, "uoalive");
  assert.ok(j.available.length >= 2, JSON.stringify(j.available));
  assert.ok(j.available.some((r) => r.id === "uoalive"));
  assert.ok(j.available.some((r) => r.id === "generic-osi"));
});
test("[fast] PUT /api/settings switches the shard; a following GET /api/rules reports it; an unknown shard is rejected", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--demo", "--port", "0", "--data", dir], {})));
  try {
    const put = await fetch(s2.url + "/api/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ shard: "generic-osi" }) });
    assert.equal(put.status, 200);
    assert.equal(asJson<SettingsResponse>(await put.json()).settings.shard, "generic-osi");
    const rules = asJson<RulesResponse>(await (await fetch(s2.url + "/api/rules")).json());
    assert.equal(rules.shard, "generic-osi");
    assert.equal(rules.rules.id, "generic-osi");
    const bad = await fetch(s2.url + "/api/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ shard: "nope" }) });
    assert.equal(bad.status, 400);
    // rejecting "nope" must not have overwritten the shard switch that already succeeded
    assert.equal((asJson<RulesResponse>(await (await fetch(s2.url + "/api/rules")).json())).shard, "generic-osi");
  } finally {
    await s2.close();
  }
});
test("[fast] GET /api/settings reads back the persisted shard", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--demo", "--port", "0", "--data", dir], {})));
  try {
    const before = asJson<SettingsResponse>(await (await fetch(s2.url + "/api/settings")).json());
    assert.equal(before.settings.shard, "uoalive");
    await fetch(s2.url + "/api/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ shard: "generic-osi" }) });
    const after = asJson<SettingsResponse>(await (await fetch(s2.url + "/api/settings")).json());
    assert.equal(after.settings.shard, "generic-osi");
    assert.equal(JSON.parse(readFileSync(join(dir, "settings.json"), "utf8")).shard, "generic-osi", "the switch is persisted to settings.json");
  } finally {
    await s2.close();
  }
});

const validRulesFile = (id: string, name: string): string => JSON.stringify({
  schemaVersion: 1, id, name, caps: { physResist: 70 }, raceCaps: {}, resistSkillBonus: { breakpoints: [] },
  tagUnits: {}, rarity: [], raceLock: { gargoyleOnly: false }, freeSkills: [],
});

// Post-review fix (finding 1): listRules() used to key a user file by its OWN id field while
// loadRules() resolved by FILENAME <id>.json — a user file named anything other than <id>.json was
// listed (and PUT /api/settings would accept it) but then could never be loaded again, including on
// the next startServer(), bricking the app. loadRules() now resolves through listRules()'s own
// {id → path} map, so listing and loading always agree regardless of filename.
test("[fast] a user rules file named differently than its id lists, loads via PUT /api/settings, and survives a fresh startServer", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--demo", "--port", "0", "--data", dir], {})));
  try {
    mkdirSync(join(dir, "rules"), { recursive: true });
    writeFileSync(join(dir, "rules", "my-shard-file.json"), validRulesFile("myshard", "My Shard"));
    const listed = (asJson<RulesResponse>(await (await fetch(s2.url + "/api/rules")).json())).available;
    assert.ok(listed.some((r) => r.id === "myshard" && r.source === "user"), JSON.stringify(listed));
    const put = await fetch(s2.url + "/api/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ shard: "myshard" }) });
    assert.equal(put.status, 200, JSON.stringify(asJson<SettingsResponse>(await put.json())));
    const rules = asJson<RulesResponse>(await (await fetch(s2.url + "/api/rules")).json());
    assert.equal(rules.shard, "myshard");
    assert.equal(rules.rules.id, "myshard");
    assert.equal(rules.fallback, false);
  } finally {
    await s2.close();
  }
  // The whole point of the fix: a NEW startServer() on the same data dir must start (not throw) and
  // must still serve the shard settings.json names, even though its rules file's name doesn't match.
  const s3 = await startServer(ensureLayout(resolveConfig(["--demo", "--port", "0", "--data", dir], {})));
  try {
    const rules = asJson<RulesResponse>(await (await fetch(s3.url + "/api/rules")).json());
    assert.equal(rules.shard, "myshard");
    assert.equal(rules.rules.id, "myshard");
    assert.equal(rules.fallback, false);
  } finally {
    await s3.close();
  }
});

test("[fast] PUT /api/settings with a shard whose rules file fails validation is 400 and settings.json is unchanged", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--demo", "--port", "0", "--data", dir], {})));
  try {
    mkdirSync(join(dir, "rules"), { recursive: true });
    writeFileSync(join(dir, "rules", "broken.json"), JSON.stringify({ schemaVersion: 1, id: "badshard" }));   // missing every other required key
    const before = JSON.parse(readFileSync(join(dir, "settings.json"), "utf8"));
    const put = await fetch(s2.url + "/api/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ shard: "badshard" }) });
    assert.equal(put.status, 400);
    assert.match(asJson<ErrorBody>(await put.json()).error, /badshard/);
    assert.deepEqual(JSON.parse(readFileSync(join(dir, "settings.json"), "utf8")), before, "a failed PUT must never touch settings.json");
  } finally {
    await s2.close();
  }
});

// Post-review fix: settings.json naming a shard whose rules file has since vanished (deleted user
// override, typo, etc.) used to throw out of startServer() and refuse to start the app at all, with
// no in-app recovery. It must instead fall back to the default shard for this run — WITHOUT touching
// settings.json, so fixing the named shard's file and restarting picks the original choice back up —
// and report the fallback so the page can tell the user.
test("[fast] a data dir whose settings.json names a shard with no rules file starts anyway, serving the default shard with fallback: true", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-"));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "settings.json"), JSON.stringify({ schemaVersion: 1, shard: "gone" }, null, 2) + "\n");
  const s2 = await startServer(ensureLayout(resolveConfig(["--demo", "--port", "0", "--data", dir], {})));
  try {
    const rules = asJson<RulesResponse>(await (await fetch(s2.url + "/api/rules")).json());
    assert.equal(rules.shard, "uoalive");
    assert.equal(rules.rules.id, "uoalive");
    assert.equal(rules.fallback, true);
    assert.equal(JSON.parse(readFileSync(join(dir, "settings.json"), "utf8")).shard, "gone", "settings.json on disk must stay untouched by the fallback");
  } finally {
    await s2.close();
  }
});

test("[fast] a user rules file named differently than its id overrides a builtin of that id", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-"));
  mkdirSync(join(dir, "rules"), { recursive: true });
  writeFileSync(join(dir, "rules", "mine.json"), validRulesFile("uoalive", "UO Alive (mine)"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--demo", "--port", "0", "--data", dir], {})));
  try {
    const rules = asJson<RulesResponse>(await (await fetch(s2.url + "/api/rules")).json());
    assert.equal(rules.rules.name, "UO Alive (mine)");
    assert.equal(rules.available.find((r) => r.id === "uoalive")!.source, "user");
  } finally {
    await s2.close();
  }
});

// ---------------------------------------------------------------------------------------------
// Task 4: localhost security — token, Host/Origin, profiles size cap + schema, one job per
// X-Client-Id, stack-free 500s. A second, dedicated server with --token "t0ken", so the bare `srv`
// above (used by every test above this line) stays token-free and untouched. Flat test()s, not a
// describe() block: the test runner (scripts/test-runner.mts) only tallies nesting-0 tests, so a
// describe() would fold all of these into a single pass/fail and drop them from the per-test count.
let tsrv: ServerHandle, tdir: string;
before(async () => {
  tdir = mkdtempSync(join(tmpdir(), "qm-sec-"));
  tsrv = await startServer(ensureLayout(resolveConfig(["--demo", "--port", "0", "--data", tdir, "--token", "t0ken"], {})));
});
after(() => tsrv.close());
const authHost = () => ({ host: `localhost:${tsrv.port}`, authorization: "Bearer t0ken" });

test("[fast] /api/inventory: no token is 401, the right bearer token is 200", async () => {
  const noAuth = await rawReq(`${tsrv.url}/api/inventory`, { headers: { host: `localhost:${tsrv.port}` } });
  assert.equal(noAuth.status, 401);
  assert.equal(asJson(noAuth.json()).ok, false);
  const withAuth = await rawReq(`${tsrv.url}/api/inventory`, { headers: authHost() });
  assert.equal(withAuth.status, 200);
});

test("[fast] static / and /ui/app.mjs need no token", async () => {
  const root = await rawReq(`${tsrv.url}/`, { headers: { host: `localhost:${tsrv.port}` } });
  assert.equal(root.status, 200);
  const uiApp = await rawReq(`${tsrv.url}/ui/app.mjs`, { headers: { host: `localhost:${tsrv.port}` } });
  assert.equal(uiApp.status, 200);
});

test("[fast] a forged Host is 403", async () => {
  const r = await rawReq(`${tsrv.url}/api/inventory`, { headers: { host: "evil.example", authorization: "Bearer t0ken" } });
  assert.equal(r.status, 403);
});

test("[fast] a forged Origin is 403; the server's own origin is accepted", async () => {
  const bad = await rawReq(`${tsrv.url}/api/inventory`, { headers: { ...authHost(), origin: "http://evil.example" } });
  assert.equal(bad.status, 403);
  const good = await rawReq(`${tsrv.url}/api/inventory`, { headers: { ...authHost(), origin: `http://127.0.0.1:${tsrv.port}` } });
  assert.equal(good.status, 200);
});

// Test gap noted in review: only forged Origin values were covered, not the literal "null" string a
// browser sends for a sandboxed iframe or a file:// page — that's a real string, not an absent
// header, and must not slip past `origin != null`.
test("[fast] Origin: null (a sandboxed iframe / file:// origin) is 403", async () => {
  const r = await rawReq(`${tsrv.url}/api/inventory`, { headers: { ...authHost(), origin: "null" } });
  assert.equal(r.status, 403);
});

// Test gap noted in review: the Host tests above all go through node:http, which always sends SOME
// Host header. A raw HTTP/1.0 request (Host is optional in that version) proves the check refuses a
// genuinely absent Host, not just a forged one.
test("[fast] a raw HTTP/1.0 request with no Host header at all is 403", async () => {
  const raw = await new Promise<string>((resolve, reject) => {
    const sock = createConnection({ port: tsrv.port, host: "127.0.0.1" }, () => {
      sock.write("GET /api/inventory HTTP/1.0\r\nAuthorization: Bearer t0ken\r\n\r\n");
    });
    let buf = "";
    sock.on("data", (c: Buffer) => { buf += c.toString("utf8"); });
    sock.on("end", () => resolve(buf));
    sock.on("error", reject);
  });
  assert.match(raw, /^HTTP\/1\.[01] 403\b/);
});

test("[fast] PUT /api/profiles: an oversized multi-byte body is 413 (bytes, not JS string length); an invalid shape is 400 naming /characters", async () => {
  // 600,000 "é" characters: 600,000 UTF-16 code units (well under the 1e6 string-length a byte-blind
  // cap would have measured) but 1,200,000 UTF-8 bytes (over the 1e6 byte cap) — this is exactly the
  // post-review fix: readBody() must count Buffer bytes, not the JS string's .length, or a body like
  // this one sails past a 1 MB limit while measuring under it.
  const oversized = JSON.stringify({ schemaVersion: 2, characters: {}, templates: {}, pad: "é".repeat(600000) });
  const big = await rawReq(`${tsrv.url}/api/profiles`, {
    method: "PUT", headers: { ...authHost(), "content-type": "application/json" }, body: oversized,
  });
  assert.equal(big.status, 413);
  assert.equal(asJson(big.json()).error, "profiles too large");
  const bad = await rawReq(`${tsrv.url}/api/profiles`, {
    method: "PUT", headers: { ...authHost(), "content-type": "application/json" }, body: JSON.stringify({ schemaVersion: 2, templates: {}, characters: 5 }),
  });
  assert.equal(bad.status, 400);
  assert.match(asJson<ErrorBody>(bad.json()).error, /\/characters/);
});

test("[fast] two POST /api/optimize from the same X-Client-Id: the second supersedes the first, whose status becomes cancelled", async () => {
  const inv = asJson<InventoryResponse>((await rawReq(`${tsrv.url}/api/inventory`, { headers: authHost() })).json());
  const profiles = asJson<ProfilesResponse>((await rawReq(`${tsrv.url}/api/profiles`, { headers: authHost() })).json());
  const rules = asJson<RulesResponse>((await rawReq(`${tsrv.url}/api/rules`, { headers: authHost() })).json());
  const character = Object.keys(inv.inventory.characters)[0]!;
  const { pools, current } = buildPools(foldFixtures(join(HERE, "fixtures")), character, {});
  const templateName = Object.keys(profiles.profiles.templates!)[0]!;
  const profile = { ...profiles.profiles.templates![templateName], caps: rules.rules.caps };
  const body = JSON.stringify({ pools, current, profile, opts: { exact: true, timeBudgetMs: 5000 } });
  const postHeaders = { ...authHost(), "content-type": "application/json", "x-client-id": "client-A" };
  const first = asJson<OptimizeJobResponse>((await rawReq(`${tsrv.url}/api/optimize`, { method: "POST", headers: postHeaders, body })).json());
  const second = asJson<OptimizeJobResponse>((await rawReq(`${tsrv.url}/api/optimize`, { method: "POST", headers: postHeaders, body })).json());
  assert.equal(second.superseded, first.id);
  const firstStatus = asJson<OptimizeJobResponse>((await rawReq(`${tsrv.url}/api/optimize/${first.id}/status`, { headers: authHost() })).json());
  assert.equal(firstStatus.state, "cancelled");
  await rawReq(`${tsrv.url}/api/optimize/${second.id}/cancel`, { method: "POST", headers: authHost() });
});

// Post-review fix: a header-less caller's job gets an unguessable clientId (a fresh randomUUID()),
// so omitting X-Client-Id must never let that same caller (or anyone else) read its events without
// the id, and two header-less callers must never supersede each other (null !== null is no longer
// how either check is satisfied). These two use their own fresh, token-free server — the finding
// was about client-id semantics, independent of the bearer token.
test("[fast] a job started without X-Client-Id can't be read via its events route without ?client=", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--demo", "--port", "0", "--data", dir], {})));
  try {
    const inv = asJson<InventoryResponse>(await (await fetch(s2.url + "/api/inventory")).json());
    const profiles = asJson<ProfilesResponse>(await (await fetch(s2.url + "/api/profiles")).json());
    const rules = asJson<RulesResponse>(await (await fetch(s2.url + "/api/rules")).json());
    const character = Object.keys(inv.inventory.characters)[0]!;
    const { pools, current } = buildPools(foldFixtures(join(HERE, "fixtures")), character, {});
    const templateName = Object.keys(profiles.profiles.templates!)[0]!;
    const profile = { ...profiles.profiles.templates![templateName], caps: rules.rules.caps };
    const r = await fetch(s2.url + "/api/optimize", {
      method: "POST", headers: { "content-type": "application/json" },   // deliberately no X-Client-Id
      body: JSON.stringify({ pools, current, profile, opts: { exact: true, timeBudgetMs: 5000 } }),
    });
    const { id } = asJson(await r.json());
    const events = await fetch(s2.url + `/api/optimize/${id}/events`);   // deliberately no ?client= either
    assert.equal(events.status, 403);
    await fetch(s2.url + `/api/optimize/${id}/cancel`, { method: "POST" });
  } finally {
    await s2.close();
  }
});

test("[fast] two POST /api/optimize with no X-Client-Id never supersede each other", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--demo", "--port", "0", "--data", dir], {})));
  try {
    const inv = asJson<InventoryResponse>(await (await fetch(s2.url + "/api/inventory")).json());
    const profiles = asJson<ProfilesResponse>(await (await fetch(s2.url + "/api/profiles")).json());
    const rules = asJson<RulesResponse>(await (await fetch(s2.url + "/api/rules")).json());
    const character = Object.keys(inv.inventory.characters)[0]!;
    const { pools, current } = buildPools(foldFixtures(join(HERE, "fixtures")), character, {});
    const templateName = Object.keys(profiles.profiles.templates!)[0]!;
    const profile = { ...profiles.profiles.templates![templateName], caps: rules.rules.caps };
    const body = JSON.stringify({ pools, current, profile, opts: { exact: true, timeBudgetMs: 5000 } });
    const post = () => fetch(s2.url + "/api/optimize", { method: "POST", headers: { "content-type": "application/json" }, body }).then((x) => asJson(x.json()));
    const first = await post();
    const second = await post();
    assert.equal(second.superseded, null);
    if (first.id) await fetch(s2.url + `/api/optimize/${first.id}/cancel`, { method: "POST" });
    if (second.id) await fetch(s2.url + `/api/optimize/${second.id}/cancel`, { method: "POST" });
  } finally {
    await s2.close();
  }
});

// Post-review fix: job failures (not just route-level 500s) now write a ref-keyed entry to the same
// log file, and the ref reaches the client in the sanitized job.error text. Deterministic trigger:
// a PACKRAT_CORE pointing at a module that throws on import, so the `await import(coreUrl)` at the top
// of optimize-worker.mts (outside its own try/catch) reaches the server as a worker 'error' event.
// This used to provoke the throw with `{pools: {helmet: [null]}}` — optimizer-core.mts's optCollectKeys
// reads `list[j].props` with no null check on `list[j]` itself — but POST /api/optimize now refuses a
// malformed pools entry with a 400 before any worker starts (phase-7 security review, Important 5),
// which is where that body should die. A broken core is the honest remaining way in, and unlike the old
// trigger it does not depend on optimizer-core.mts internals staying unguarded.
test("[fast] a job that throws inside the optimizer logs its stack with a ref; the client only sees the sanitized ref", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-"));
  const brokenCore = join(mkdtempSync(join(tmpdir(), "qm-core-")), "optimizer-core.mts");
  writeFileSync(brokenCore, 'throw new TypeError("optimizer core is broken");\n');
  const s2 = await startServer(ensureLayout(resolveConfig(["--demo", "--port", "0", "--data", dir], { PACKRAT_CORE: brokenCore })));
  try {
    const r = await fetch(s2.url + "/api/optimize", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ pools: {}, current: {}, profile: { caps: { physResist: 70 } }, opts: {} }),
    });
    const { id } = asJson<OptimizeJobResponse>(await r.json());
    let status: OptimizeJobResponse | undefined;
    for (let i = 0; i < 50; i++) {
      status = asJson<OptimizeJobResponse>(await (await fetch(s2.url + `/api/optimize/${id}/status`)).json());
      if (status.state !== "running") break;
      await new Promise((res) => setTimeout(res, 20));
    }
    assert.equal(status!.state, "error");
    assert.match(status!.error!, /^internal error \(ref [0-9a-f]{8}\)$/);
    assert.doesNotMatch(status!.error!, /at file:|\.mjs:\d+:\d+/, "no stack trace text reaches the client");
    const ref = status!.error!.match(/ref ([0-9a-f]{8})/)![1]!;
    const log = readFileSync(join(dir, "logs", "server.log"), "utf8");
    assert.ok(log.includes(ref), "the ref appears in the log file");
    assert.match(log, /TypeError.*optimizer core is broken/s, "the real stack trace reached the log file");
  } finally {
    await s2.close();
  }
});

// A profiles.json that is a directory is an I/O failure the route does not recover from (a truncated
// one is moved aside and reseeded instead), so it still reaches the catch-all 500.
test("[fast] a route that throws returns a stack-free 500 with a ref that appears in the log", async () => {
  rmSync(join(tdir, "profiles.json"), { force: true });
  mkdirSync(join(tdir, "profiles.json"));
  const r = await rawReq(`${tsrv.url}/api/profiles`, { headers: authHost() });
  assert.equal(r.status, 500);
  const body = asJson<ErrorBody>(r.json());
  assert.equal(body.error, "internal error");
  assert.ok(body.ref, "a ref is present");
  assert.doesNotMatch(r.text, /at file:|\.mjs:\d+:\d+/, "no stack trace text reaches the response body");
  const log = readFileSync(join(tdir, "logs", "server.log"), "utf8");
  assert.ok(log.includes(body.ref!), "the ref appears in the log file");
});

// Task 2 (Phase 3): the worker now runs an exact build through app/exact-solver.mts (HiGHS), not the
// retired multi-thread branch-and-bound. On the small demo fixture this proves well inside a normal
// test timeout — poll /status until done, then confirm the saved run carries the identical score.
test("[fast] POST /api/optimize exact: the job finishes with solver \"highs\", proven, and the saved run carries the same score", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--demo", "--port", "0", "--data", dir], {})));
  try {
    const inv = asJson<InventoryResponse>(await (await fetch(s2.url + "/api/inventory")).json());
    const profiles = asJson<ProfilesResponse>(await (await fetch(s2.url + "/api/profiles")).json());
    const rules = asJson<RulesResponse>(await (await fetch(s2.url + "/api/rules")).json());
    const character = Object.keys(inv.inventory.characters)[0]!;
    const { pools, current } = buildPools(foldFixtures(join(HERE, "fixtures")), character, {});
    const templateName = Object.keys(profiles.profiles.templates!)[0]!;
    const profile = { ...profiles.profiles.templates![templateName], caps: rules.rules.caps };
    const r = await fetch(s2.url + "/api/optimize", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ pools, current, profile, opts: { exact: true, timeBudgetMs: 20000, restarts: 50, seed: 2026 } }),
    });
    const { id } = asJson<OptimizeJobResponse>(await r.json());
    let status: OptimizeJobResponse | undefined;
    for (let i = 0; i < 300; i++) {
      status = asJson<OptimizeJobResponse>(await (await fetch(s2.url + `/api/optimize/${id}/status`)).json());
      if (status.state !== "running") break;
      await new Promise((res) => setTimeout(res, 100));
    }
    assert.equal(status!.state, "done", JSON.stringify(status));
    assert.equal(status!.result!.solver, "highs");
    assert.equal(status!.result!.proven, true);
    assert.ok(status!.runId);
    const run = asJson<RunResponse>(await (await fetch(s2.url + `/api/runs/${status!.runId}`)).json());
    assert.equal(run.run.result.score, status!.result!.score);
  } finally {
    await s2.close();
  }
});

// ---------------------------------------------------------------------------------------------
// Task 4: the inventory cache, item-query.mjs's static route, GET /api/items, and POST
// /api/optimize's by-character form. Uses the module-level `srv` (--demo) where a fresh server
// isn't needed for isolation.

test("[smoke] /item-query.mjs is served as text/javascript with nosniff", async () => {
  const r = await get("/item-query.mjs");
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("content-type"), "text/javascript; charset=utf-8");
  assert.equal(r.headers.get("x-content-type-options"), "nosniff");
  assert.match(await r.text(), /export function applyItemQuery/);
});

test("[smoke] /api/inventory carries facets, worn gear and counts, and no item list", async () => {
  const j = asJson<InventoryResponse>(await (await get("/api/inventory")).json());
  assert.equal(j.ok, true);
  assert.equal(j.inventory.items, undefined);
  assert.ok(j.inventory.itemCount > 0);
  assert.ok(j.inventory.facets.kinds.length > 0, JSON.stringify(j.inventory.facets));
  assert.ok(Object.keys(j.inventory.worn).length > 0);
});

// Regression test for a live bug found in the browser gate after Task 5: page load() threw
// "Cannot convert undefined or null to object" — NOT in containers.mts (its `state.inv.containers`/
// `rootCounts` reads were fine all along), but in builder.mts's renderProfile(), which called the
// client-side vault-lib.mts helpers gearSkills()/builderKeys() against state.inv — and those do
// `Object.values(inv.items)`, which is exactly the field Task 5 stopped shipping. The throw happened
// before renderContainers() ran (buildBuilder() runs first in load()'s sequence), which is why the
// Containers tab looked broken — it was collateral, not its own bug. Fixed by adding `gearSkills` to
// GET /api/inventory's `facets` (item-query.mts's facetsOf, mirroring `propKeys`) so the page never
// needs the full item map for this. This test pins every field a client module reads directly off
// `state.inv`/`state.facets` without going through GET /api/items, so a future field removal fails
// here instead of surfacing only as a live "failed to load" banner.
test("[smoke] /api/inventory carries every field the page's non-paged tabs read directly", async () => {
  const j = asJson<InventoryResponse>(await (await get("/api/inventory")).json());
  const inv = j.inventory;
  assert.ok(inv.containers && Object.keys(inv.containers).length > 0, "containers.mts reads state.inv.containers");
  assert.ok(inv.rootCounts && Object.keys(inv.rootCounts).length > 0, "containers.mts reads state.inv.rootCounts");
  assert.ok(inv.characters && Object.keys(inv.characters).length > 0, "characters.mts/builder.mts read state.inv.characters");
  assert.ok(inv.worn && Object.keys(inv.worn).length > 0, "characters.mts/sheet.mts read state.inv.worn");
  assert.ok(Array.isArray(inv.facets.gearSkills) && inv.facets.gearSkills.length > 0, "builder.mts's renderProfile reads state.facets.gearSkills");
  assert.ok(Array.isArray(inv.propKeys) && inv.propKeys.length > 0, "builder.mts/inventory.mts read state.propKeys");
});

test("[fast] /api/items pages, sorts and searches", async () => {
  const inv = asJson<InventoryResponse>(await (await get("/api/inventory")).json());
  const total = inv.inventory.itemCount;
  const page = asJson<ItemsPageResponse>(await (await get("/api/items?limit=5")).json());
  assert.equal(page.ok, true);
  assert.equal(page.rows!.length, 5);
  assert.equal(page.total, total);
  const all = asJson<ItemsPageResponse>(await (await get("/api/items?limit=500")).json());
  assert.equal(all.rows!.length, total);
  const names = all.rows!.map((r) => r.name);
  assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b)), "sort=name (default) is A-to-Z");
  const rev = asJson<ItemsPageResponse>(await (await get("/api/items?limit=500&sort=name&dir=-1")).json());
  assert.deepEqual(rev.rows!.map((r) => r.name), [...names].reverse(), "dir=-1 reverses the default sort");
  const search = asJson<ItemsPageResponse>(await (await get("/api/items?q=" + encodeURIComponent("Vicious Crescent Blade"))).json());
  assert.ok(search.rows!.length >= 1, JSON.stringify(search));
  assert.ok(search.rows!.some((r) => r.name === "Vicious Crescent Blade"));
  const clamp = asJson<ItemsPageResponse>(await (await get("/api/items?limit=9999")).json());
  assert.equal(clamp.limit, 500);
  const grouped = asJson<ItemsPageResponse>(await (await get("/api/items?group=1")).json());
  assert.equal(grouped.ok, true);
  assert.ok(Array.isArray(grouped.groups) && grouped.groups.length > 0);
  assert.ok(!("rows" in grouped));
  assert.equal(grouped.stacks, all.total, "grouped, the answer still counts the stacks behind the names");
  assert.equal(grouped.pieces, all.pieces);
  // The Inventory's list filters and the rarity minimum reach the query from the wire.
  const rings = asJson<ItemsPageResponse>(await (await get("/api/items?slot=ring&slot=bracelet&rarityMin=" + encodeURIComponent("Major Magic Item"))).json());
  assert.ok(rings.rows!.length > 0 && rings.rows!.every((r) => ["ring", "bracelet"].includes(r.slot as string)), JSON.stringify(rings.rows!.map((r) => r.slot)));
});

test("[fast] GET /api/items/by-serial resolves full item records by serial", async () => {
  const page = asJson<ItemsPageResponse>(await (await get("/api/items?limit=3")).json());
  const serials = page.rows!.map((r) => r.serial);
  const unknown = 999999999;
  const res = asJson<ItemsBySerialResponse>(await (await get(`/api/items/by-serial?serials=${[...serials, unknown].join(",")}`)).json());
  assert.equal(res.ok, true);
  for (const s of serials) {
    assert.ok(res.items[s], `serial ${s} should resolve`);
    assert.ok(res.items[s]!.location, `serial ${s} should carry a location`);
  }
  assert.equal(res.items[unknown], undefined, "an unknown serial is simply absent, not an error");
  const tooMany = await get(`/api/items/by-serial?serials=${Array.from({ length: 201 }, (_, i) => i + 1).join(",")}`);
  assert.equal(tooMany.status, 400);
  const empty = await get("/api/items/by-serial");
  assert.equal(empty.status, 400);
});

test("[fast] /api/optimize by character builds the same pools as the client did", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--demo", "--port", "0", "--data", dir], {})));
  try {
    const invFull = asJson<InventoryResponse>(await (await fetch(s2.url + "/api/inventory")).json());
    const profiles = asJson<ProfilesResponse>(await (await fetch(s2.url + "/api/profiles")).json());
    const rules = asJson<RulesResponse>(await (await fetch(s2.url + "/api/rules")).json());
    const character = Object.keys(invFull.inventory.characters)[0]!;
    const templateName = Object.keys(profiles.profiles.templates!)[0]!;
    const profile = { ...profiles.profiles.templates![templateName], caps: rules.rules.caps };
    // The full item map used to come straight off /api/inventory; since Task 5 removed it from the
    // wire, fold the same demo fixtures the server folds (foldFixtures above) to get an equivalent
    // local inventory for this "does the server build what the client used to build" comparison.
    const localInv = foldFixtures(join(HERE, "fixtures"));
    const { pools, current } = buildPools(localInv, character, {});
    const localPoolSize = Object.values(pools).reduce((a, v) => a + (v || []).length, 0);

    // 1) the OLD body form — start it and wait for it to finish so it lands as a saved, reusable run.
    // opts.optionalSlots must match what the by-character form derives server-side (every
    // DEFAULT_OPTIONAL_SLOT, since settings:{} means lockedSlots:[]) or the two requests' runKeys
    // (and so their cache behavior) would legitimately differ.
    const oldOpts = { exact: false, optionalSlots: DEFAULT_OPTIONAL_SLOTS };
    const r1 = await fetch(s2.url + "/api/optimize", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ pools, current, profile, opts: oldOpts }),
    });
    const j1 = asJson<OptimizeJobResponse>(await r1.json());
    assert.equal(r1.status, 200, JSON.stringify(j1));
    assert.equal(j1.poolSize, localPoolSize);
    assert.deepEqual(j1.skipped, {}, "the old body form reports no skipped counts (it never called buildPools)");
    assert.deepEqual(j1.blocked, []);
    let status: OptimizeJobResponse = j1;
    for (let i = 0; i < 100 && status.state !== "done"; i++) {
      await new Promise((res) => setTimeout(res, 20));
      status = asJson<OptimizeJobResponse>(await (await fetch(s2.url + `/api/optimize/${j1.id}/status`)).json());
    }
    assert.equal(status.state, "done", JSON.stringify(status));

    // 2) the by-character form must build the identical pools/current server-side and hit the run
    // the old form just saved.
    const r2 = await fetch(s2.url + "/api/optimize", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ character, settings: {}, profile, opts: { exact: false } }),
    });
    const j2 = asJson(await r2.json());
    assert.equal(r2.status, 200, JSON.stringify(j2));
    assert.equal(j2.poolSize, localPoolSize);
    assert.deepEqual(j2.current, current);
    assert.equal(j2.cached, true, JSON.stringify(j2));
  } finally {
    await s2.close();
  }
});

test("[fast] /api/optimize by character with a bad settings type is 400", async () => {
  const inv = asJson<InventoryResponse>(await (await get("/api/inventory")).json());
  const profiles = asJson<ProfilesResponse>(await (await get("/api/profiles")).json());
  const rules = asJson<RulesResponse>(await (await get("/api/rules")).json());
  const character = Object.keys(inv.inventory.characters)[0]!;
  const templateName = Object.keys(profiles.profiles.templates!)[0]!;
  const profile = { ...profiles.profiles.templates![templateName], caps: rules.rules.caps };
  const r = await fetch(srv.url + "/api/optimize", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ character, settings: { excludeTags: "cursed" }, profile, opts: {} }),
  });
  assert.equal(r.status, 400);
  assert.match(asJson<ErrorBody>(await r.json()).error, /excludeTags/);
});

// The by-character form builds its pools from `settings`, but a saved run must still remember the page's
// whole settings snapshot (meta.settings: floors, weights, race, the search knobs): the Saved runs drawer
// labels, badges, compares and re-applies runs from it. The route used to replace meta.settings with the
// pool settings alone, so every run came back with no floors or weights.
test("[fast] /api/optimize by character: the saved run keeps the page's settings snapshot, with the pool settings it ran on", async () => {
  const inv = asJson<InventoryResponse>(await (await get("/api/inventory")).json());
  const profiles = asJson<ProfilesResponse>(await (await get("/api/profiles")).json());
  const rules = asJson<RulesResponse>(await (await get("/api/rules")).json());
  const character = Object.keys(inv.inventory.characters)[0]!;
  const templateName = Object.keys(profiles.profiles.templates!)[0]!;
  const profile = { ...profiles.profiles.templates![templateName], caps: rules.rules.caps, floors: { hci: 3 } };
  const snapshot = { floors: { hci: 3 }, weights: { dci: 2 }, race: "elf", restarts: 7, strLimit: 999 };
  const r = await fetch(srv.url + "/api/optimize", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ character, settings: { strLimit: 120 }, profile, opts: { exact: false, restarts: 7 }, meta: { character, settings: snapshot } }),
  });
  const j = asJson<OptimizeJobResponse>(await r.json());
  assert.equal(r.status, 200, JSON.stringify(j));
  let status: OptimizeJobResponse = j;
  for (let i = 0; i < 200 && status.state !== "done" && !j.cached; i++) {
    await new Promise((res) => setTimeout(res, 20));
    status = asJson<OptimizeJobResponse>(await (await fetch(srv.url + `/api/optimize/${j.id}/status`)).json());
  }
  const list = asJson<{ runs: Array<{ id: string; settings: Record<string, unknown> }> }>(await (await get(`/api/runs?character=${encodeURIComponent(character)}`)).json());
  const run = list.runs.find((x) => x.id === (j.cached ? (j as { run?: { id: string } }).run!.id : j.id));
  assert.ok(run, "the run was saved");
  assert.deepEqual(run.settings.floors, { hci: 3 });
  assert.deepEqual(run.settings.weights, { dci: 2 });
  assert.equal(run.settings.race, "elf");
  assert.equal(run.settings.strLimit, 120, "the pool settings the run actually used win over the snapshot's");
});

// Issue #28: the heuristic-only path ran every requested restart whatever the time budget said.
test("[fast] /api/optimize heuristic-only: the time budget caps the random restarts", async () => {
  const inv = asJson<InventoryResponse>(await (await get("/api/inventory")).json());
  const profiles = asJson<ProfilesResponse>(await (await get("/api/profiles")).json());
  const rules = asJson<RulesResponse>(await (await get("/api/rules")).json());
  const character = Object.keys(inv.inventory.characters)[0]!;
  const templateName = Object.keys(profiles.profiles.templates!)[0]!;
  const profile = { ...profiles.profiles.templates![templateName], caps: rules.rules.caps };
  const j = asJson<OptimizeJobResponse>(await (await fetch(srv.url + "/api/optimize", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ character, settings: {}, profile, opts: { exact: false, restarts: 10000, timeBudgetMs: 0 } }),
  })).json());
  let status: OptimizeJobResponse = j;
  for (let i = 0; i < 500 && status.state !== "done"; i++) {
    await new Promise((res) => setTimeout(res, 20));
    status = asJson<OptimizeJobResponse>(await (await fetch(srv.url + `/api/optimize/${j.id}/status`)).json());
  }
  assert.equal(status.state, "done", JSON.stringify(status));
  // Every restart is a local search of at least one evaluation, so running them all would pass 10000.
  assert.ok((status.result as { evaluations: number }).evaluations < 10000, "a zero budget runs no random restarts, however many were asked for");
});

// Resist cap overrides (issue #44) persist with a profile or template and with each saved run, and the server
// holds them to one rule everywhere: the five resist keys only, whole numbers from 0 to 150.
test("[fast] resist cap overrides: profiles and saved runs keep them, and a bad one is refused with 400", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--demo", "--port", "0", "--data", dir], {})));
  const put = (body: unknown): Promise<Response> => fetch(s2.url + "/api/profiles", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  try {
    const profiles = asJson<ProfilesResponse>(await (await fetch(s2.url + "/api/profiles")).json()).profiles;
    const templateName = Object.keys(profiles.templates!)[0]!;
    const character = Object.keys(asJson<InventoryResponse>(await (await fetch(s2.url + "/api/inventory")).json()).inventory.characters)[0]!;
    const good = { ...profiles, characters: { ...profiles.characters, [character]: { template: templateName, race: "human", resistCaps: { fireResist: 95 } } },
      templates: { ...profiles.templates, reaper: { ...profiles.templates![templateName]!, resistCaps: { fireResist: 95, coldResist: 60 } } } };
    assert.equal((await put(good)).status, 200);
    const back = asJson<ProfilesResponse>(await (await fetch(s2.url + "/api/profiles")).json()).profiles;
    assert.deepEqual(back.characters![character]!.resistCaps, { fireResist: 95 });
    assert.deepEqual(back.templates!.reaper!.resistCaps, { fireResist: 95, coldResist: 60 });
    for (const [where, caps, path] of [["characters", { fireResist: 95.5 }, /\/characters\/.+\/resistCaps\/fireResist/], ["characters", { fireResist: 151 }, /resistCaps\/fireResist/],
      ["templates", { luck: 5 }, /\/templates\/reaper\/resistCaps/], ["templates", "95", /\/templates\/reaper\/resistCaps/]] as const) {
      const bad = where === "characters" ? { ...good, characters: { [character]: { resistCaps: caps } } } : { ...good, templates: { reaper: { resistCaps: caps } } };
      const r = await put(bad);
      assert.equal(r.status, 400, `${where} ${JSON.stringify(caps)}`);
      assert.match(asJson<ErrorBody>(await r.json()).error, path);
    }

    // A build's settings snapshot carries the caps into its saved run; a bad one is refused before anything runs.
    const rules = asJson<RulesResponse>(await (await fetch(s2.url + "/api/rules")).json());
    const profile = { ...profiles.templates![templateName], caps: { ...rules.rules.caps, fireResist: 95 } };
    const post = (settings: Record<string, unknown>, snapshot: Record<string, unknown>): Promise<Response> => fetch(s2.url + "/api/optimize", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ character, settings, profile, opts: { exact: false, restarts: 3 }, meta: { character, settings: snapshot } }) });
    for (const [settings, snapshot, msg] of [[{}, { resistCaps: { fireResist: -1 } }, /meta\.settings\.resistCaps\.fireResist must be a whole number from 0 to 150/],
      [{}, { resistCaps: [95] }, /meta\.settings\.resistCaps must be an object/], [{ resistCaps: { hci: 5 } }, {}, /settings\.resistCaps\.hci is not a resist/]] as const) {
      const r = await post(settings, snapshot);
      assert.equal(r.status, 400, JSON.stringify(snapshot));
      assert.match(asJson<ErrorBody>(await r.json()).error, msg);
    }
    const r = await post({}, { race: "human", resistCaps: { fireResist: 95 } });
    const j = asJson<OptimizeJobResponse>(await r.json());
    assert.equal(r.status, 200, JSON.stringify(j));
    let status: OptimizeJobResponse = j;
    for (let i = 0; i < 200 && status.state !== "done" && !j.cached; i++) {
      await new Promise((res) => setTimeout(res, 20));
      status = asJson<OptimizeJobResponse>(await (await fetch(s2.url + `/api/optimize/${j.id}/status`)).json());
    }
    const run = asJson<{ run: { settings: Record<string, unknown> } }>(await (await fetch(s2.url + `/api/runs/${j.id}`)).json()).run;
    assert.deepEqual(run.settings.resistCaps, { fireResist: 95 }, "reopening the run shows the caps it was built with");
  } finally {
    await s2.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

// Weapon exclusions (issue #45): a bad list is refused, a build leaves the excluded skills' weapons out, and a run
// saved with the old single weapon choice reopens with the exclusions it means.
test("[fast] weapon exclusions: a bad list is 400, excluded weapons stay out of the build, an old run reopens converted", async () => {
  const character = Object.keys(asJson<InventoryResponse>(await (await get("/api/inventory")).json()).inventory.characters)[0]!;
  const profiles = asJson<ProfilesResponse>(await (await get("/api/profiles")).json()).profiles;
  const rules = asJson<RulesResponse>(await (await get("/api/rules")).json());
  const profile = { ...Object.values(profiles.templates!)[0], caps: rules.rules.caps };
  const post = (settings: Record<string, unknown>): Promise<Response> => fetch(srv.url + "/api/optimize", {
    method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ character, settings, profile, opts: { exact: false, restarts: 3 }, meta: { character, settings } }) });
  const bad = await post({ excludeWeapons: ["bows"] });
  assert.equal(bad.status, 400);
  assert.match(asJson<ErrorBody>(await bad.json()).error, /settings\.excludeWeapons\[0\] is not a weapon skill/);

  const inv = foldFixtures(join(HERE, "fixtures"));
  const skillOf = (serial: number): string => String(inv.items[serial]?.skillReq || "").toLowerCase();
  const excluded = [...new Set(Object.values(inv.items).map((it) => skillOf(it.serial)).filter(Boolean))].slice(0, 2);
  const j = asJson<OptimizeJobResponse>(await (await post({ excludeWeapons: excluded })).json());
  assert.ok((j.skipped as Record<string, number>).weapon! > 0, JSON.stringify(j.skipped));
  let status: OptimizeJobResponse = j;
  for (let i = 0; i < 200 && status.state !== "done" && !j.cached; i++) {
    await new Promise((res) => setTimeout(res, 20));
    status = asJson<OptimizeJobResponse>(await (await fetch(srv.url + `/api/optimize/${j.id}/status`)).json());
  }
  const best = (status.result as { best: Record<string, { serial: number } | null> }).best;
  for (const slot of ["oneHanded", "twoHanded"]) if (best[slot]) assert.ok(!excluded.includes(skillOf(best[slot]!.serial)), `${slot} holds an excluded skill`);

  const dir = mkdtempSync(join(tmpdir(), "qm-weapons-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--demo", "--port", "0", "--data", dir], {})));
  try {
    const id = "0b5c1a4e-0000-4000-8000-000000000045";
    writeFileSync(join(dir, "runs", `${id}.json`), JSON.stringify({ id, character, settings: { weaponSkill: "archery" }, result: { method: "heuristic", best: {} } }));
    const run = asJson<{ run: { settings: Record<string, unknown> } }>(await (await fetch(s2.url + `/api/runs/${id}`)).json()).run;
    assert.deepEqual(run.settings, { excludeWeapons: ["swordsmanship", "fencing", "mace fighting", "throwing"] });
  } finally {
    await s2.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

// Post-review fix: `null` in an optional settings field (strLimit/excludeTags/excludeRoots/
// excludeSkills/lockedSlots) passed the `!= null` validation gate untouched, but the destructuring
// defaults below it only fire on `undefined` — so `strLimit: null` reached buildPools as a literal
// null (silently wrong: strength null <= nothing, so every STR-gated item got excluded) and an array
// field's null threw once buildPools tried to .map/.includes it. A saved run's settings (re-posted
// from the runs drawer) can carry exactly this shape, so it had to be treated the same as "absent".
test("[fast] /api/optimize by character: null settings fields behave like absent fields (same poolSize as {}), not a type error", async () => {
  const inv = asJson<InventoryResponse>(await (await get("/api/inventory")).json());
  const profiles = asJson<ProfilesResponse>(await (await get("/api/profiles")).json());
  const rules = asJson<RulesResponse>(await (await get("/api/rules")).json());
  const character = Object.keys(inv.inventory.characters)[0]!;
  const templateName = Object.keys(profiles.profiles.templates!)[0]!;
  const profile = { ...profiles.profiles.templates![templateName], caps: rules.rules.caps };
  const post = async (settings: Record<string, unknown>): Promise<{ status: number; body: OptimizeJobResponse }> => {
    const r = await fetch(srv.url + "/api/optimize", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ character, settings, profile, opts: { exact: false } }),
    });
    return { status: r.status, body: asJson<OptimizeJobResponse>(await r.json()) };
  };
  const baseline = await post({});
  assert.equal(baseline.status, 200, JSON.stringify(baseline.body));
  const withNulls = await post({ strLimit: null, excludeTags: null, excludeRoots: null, excludeSkills: null, lockedSlots: null });
  assert.equal(withNulls.status, 200, JSON.stringify(withNulls.body));
  assert.equal(withNulls.body.poolSize, baseline.body.poolSize);
  assert.deepEqual(withNulls.body.current, baseline.body.current);
  for (const j of [baseline.body, withNulls.body]) if (j.id) await fetch(srv.url + `/api/optimize/${j.id}/cancel`, { method: "POST" });
});

test("[fast] a new scan file changes /api/inventory without a restart", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--port", "0", "--data", dir], {})));
  try {
    const before = asJson<InventoryResponse>(await (await fetch(s2.url + "/api/inventory")).json());
    assert.equal(before.inventory.itemCount, 0);
    const scansDir = join(dir, "scans");
    mkdirSync(scansDir, { recursive: true });
    const snap = {
      schemaVersion: 2, character: "CacheProbe", scannedAt: new Date().toISOString(),
      adapter: { id: "app", version: "1", client: "test", clientVersion: null,
        capabilities: { layers: [], arms: false, bank: false, ground: false, nested: false, tooltips: "label", bridge: [] } },
      shard: "uoalive", stats: {}, equipped: [{ serial: 999000001, name: "Test Ring", nameSource: "label", layer: "Ring" }],
      roots: [], containers: {}, items: [],
    };
    writeFileSync(join(scansDir, "cache-probe.json"), JSON.stringify(snap));
    const after = asJson<InventoryResponse>(await (await fetch(s2.url + "/api/inventory")).json());
    assert.ok(after.inventory.itemCount > before.inventory.itemCount, `${before.inventory.itemCount} -> ${after.inventory.itemCount}`);
  } finally {
    await s2.close();
  }
});

// ---- Setup wizard (Task 2, Phase 4): GET/POST /api/setup*, GET /api/update-check,
// POST /api/host/*, and PUT /api/settings' setupDone/client extension. app/installer.test.mts covers
// the pure installer.mts functions directly; these cover the routes wiring them up.

test("[fast] GET /api/setup lists the tazuo adapter, its available (repo-shipped) version, and firstRun:true on a fresh data dir", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-setup-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--port", "0", "--data", dir], {})));
  try {
    const j = asJson<SetupResponse>(await (await fetch(s2.url + "/api/setup")).json());
    assert.equal(j.ok, true);
    assert.equal(j.firstRun, true);
    // Present, not pinned: the test's own point (title, available/installed/dataDir below) is
    // "tazuo is listed, with the right version/candidates" — not the exact set of shipped adapters.
    assert.ok(j.adapters.map((a) => a.id).includes("tazuo"), JSON.stringify(j.adapters.map((a) => a.id)));
    assert.equal(j.available.tazuo, TAZUO_VERSION);
    assert.equal(j.installed, null);
    assert.equal(j.dataDir, dir);
    assert.ok(Array.isArray(j.candidates.tazuo), JSON.stringify(j.candidates));
    // Phase 6 final review, deferred minor: the wizard/Import tab need this to hide the Windows-only
    // razor-enhanced adapter on any other platform (app/ui/adapters.mts's availableAdapters) — it
    // must be this process's real process.platform, not a placeholder.
    assert.equal(j.platform, process.platform);
    // Settings › Updates shows the running version before any update check.
    assert.equal(j.version, (JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "package.json"), "utf8")) as { version: string }).version);
  } finally {
    await s2.close();
  }
});

// ---- the scripts' data folder versus the app's (issue #39) ----------------------------------------
// A scripts folder holding one Pack Rat script and a packrat-paths.json naming `dataDir`.
function installedScripts(scriptsDir: string, dataDir: string): string {
  mkdirSync(scriptsDir, { recursive: true });
  writeFileSync(join(scriptsDir, "packrat-scanner.py"), `ADAPTER_VERSION = "${TAZUO_VERSION}"\n`);
  writeFileSync(join(scriptsDir, "packrat-paths.json"), `${JSON.stringify({ dataDir }, null, 1)}\n`);
  return scriptsDir;
}
function warnings(t: TestContext): () => string[] {
  const warn = t.mock.method(console, "warn", () => {});
  return () => warn.mock.calls.map((c) => String(c.arguments[0]));
}

test("[fast] a configured client whose scripts write to another data folder is warned about at startup and reported by GET /api/setup", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "qm-dd-server-")), other = mkdtempSync(join(tmpdir(), "qm-dd-other-"));
  const scriptsDir = installedScripts(mkdtempSync(join(tmpdir(), "qm-dd-scripts-")), other);
  const config = ensureLayout(resolveConfig(["--port", "0", "--data", dir], {}));
  writeFileSync(config.paths.settings, JSON.stringify({ schemaVersion: 1, shard: "uoalive", setupDone: true, client: { adapter: "tazuo", scriptsDir } }));
  const warned = warnings(t);
  const s2 = await startServer(config);
  try {
    const startup = warned().filter((w) => w.includes("--data"));
    assert.equal(startup.length, 1, JSON.stringify(warned()));
    assert.ok(startup[0]!.includes(other) && startup[0]!.includes(dir) && startup[0]!.includes(`npm start -- --data ${other}`), startup[0]);
    const j = asJson<SetupResponse>(await (await fetch(s2.url + "/api/setup")).json());
    assert.deepEqual(j.dataDirCheck, { status: "mismatch", scriptsDir, scriptsDataDir: other, dataDir: dir });
    // Recomputed per request: fixing the file (a reinstall does) clears it without a restart.
    installedScripts(scriptsDir, dir);
    const fixed = asJson<SetupResponse>(await (await fetch(s2.url + "/api/setup")).json());
    assert.deepEqual(fixed.dataDirCheck, { status: "match", scriptsDir });
    writeFileSync(join(scriptsDir, "packrat-paths.json"), "{not json");
    const broken = asJson<SetupResponse>(await (await fetch(s2.url + "/api/setup")).json());
    assert.equal(broken.dataDirCheck.status, "unreadable", "a malformed file is reported, not a 500");
  } finally {
    await s2.close();
  }
});

test("[fast] a matching client, no client at all, and --demo start without a data-folder warning", async (t) => {
  const warned = warnings(t);
  const dir = mkdtempSync(join(tmpdir(), "qm-dd-quiet-"));
  const scriptsDir = installedScripts(mkdtempSync(join(tmpdir(), "qm-dd-scripts-")), dir);
  const config = ensureLayout(resolveConfig(["--port", "0", "--data", dir], {}));
  writeFileSync(config.paths.settings, JSON.stringify({ schemaVersion: 1, shard: "uoalive", setupDone: true, client: { adapter: "tazuo", scriptsDir } }));
  for (const cfg of [config, ensureLayout(resolveConfig(["--port", "0", "--data", mkdtempSync(join(tmpdir(), "qm-dd-none-"))], {})), ensureLayout(resolveConfig(["--demo", "--port", "0", "--data", mkdtempSync(join(tmpdir(), "qm-dd-demo-"))], {}))]) {
    const s2 = await startServer(cfg);
    try {
      const j = asJson<SetupResponse>(await (await fetch(s2.url + "/api/setup")).json());
      assert.notEqual(j.dataDirCheck.status, "mismatch", cfg.dataDir);
    } finally {
      await s2.close();
    }
  }
  assert.deepEqual(warned().filter((w) => w.includes("--data")), []);
});

test("[fast] with no client configured, GET /api/setup checks the auto-detected client folder", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "qm-dd-detect-")), other = mkdtempSync(join(tmpdir(), "qm-dd-other-"));
  const root = join(FAKE_HOME, "Desktop", "TazUO");
  const legion = installedScripts(join(root, "TazUO", "LegionScripts"), other);
  const warned = warnings(t);
  const s2 = await startServer(ensureLayout(resolveConfig(["--port", "0", "--data", dir], {})));
  try {
    const j = asJson<SetupResponse>(await (await fetch(s2.url + "/api/setup")).json());
    assert.deepEqual(j.dataDirCheck, { status: "mismatch", scriptsDir: legion, scriptsDataDir: other, dataDir: dir });
    assert.equal(warned().filter((w) => w.includes(legion)).length, 1, "the startup warning names the detected folder");
  } finally {
    await s2.close();
    rmSync(root, { recursive: true, force: true });
  }
});

// Task 5, Phase 6: the wizard/Settings tell a folder-transport adapter (installable) apart from a
// paste-transport one (nothing to install, sent to the Import tab instead) by this field — never by a
// hard-coded adapter id. Uses the repo's own three shipped adapters, not a throwaway fixture dir.
test("[fast] GET /api/setup reports each real adapter's transport; POST /api/setup/install refuses the paste-transport classicuo-web adapter with 400", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-setup-transport-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--port", "0", "--data", dir], {})));
  try {
    const setup = asJson<SetupResponse>(await (await fetch(s2.url + "/api/setup")).json());
    const tazuo = setup.adapters.find((a) => a.id === "tazuo");
    const web = setup.adapters.find((a) => a.id === "classicuo-web");
    assert.ok(tazuo, JSON.stringify(setup.adapters.map((a) => a.id)));
    assert.ok(web, JSON.stringify(setup.adapters.map((a) => a.id)));
    assert.equal(tazuo.transport, "folder", JSON.stringify(tazuo));
    assert.equal(web.transport, "paste", JSON.stringify(web));

    // Phase 6 final review follow-up: capabilities.json's optional platform field, surfaced end to
    // end through the real server — razor-enhanced is win32-only, the other two carry no restriction,
    // and its candidates list is empty on this (non-Windows CI/dev) machine's real platform.
    const razor = setup.adapters.find((a) => a.id === "razor-enhanced");
    assert.ok(razor, JSON.stringify(setup.adapters.map((a) => a.id)));
    assert.equal(razor.platform, "win32", JSON.stringify(razor));
    assert.equal(tazuo.platform, null);
    assert.equal(web.platform, null);
    if (setup.platform !== "win32") {
      assert.deepEqual(setup.candidates["razor-enhanced"], [], "no candidate for a platform-restricted adapter on the wrong platform");
    }

    const scriptsDir = mkdtempSync(join(tmpdir(), "qm-setup-transport-dest-"));
    const r = await fetch(s2.url + "/api/setup/install", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ adapter: "classicuo-web", scriptsDir }),
    });
    assert.equal(r.status, 400);
    const body = asJson<InstallScriptsResult>(await r.json());
    assert.match(body.error!, /nothing to install/);
    assert.deepEqual(readdirSync(scriptsDir), [], "nothing was written for a paste-transport adapter");
    assert.equal((asJson<SettingsResponse>(await (await fetch(s2.url + "/api/settings")).json())).settings.client, undefined, "a refused install must not save settings.client");
  } finally {
    await s2.close();
  }
});

test("[fast] POST /api/setup/locate resolves a nested .../ClassicUO/Data/Plugins/Razor/Scripts folder for the razor-enhanced adapter", async () => {
  const s2 = await startServer(ensureLayout(resolveConfig(["--port", "0", "--data", mkdtempSync(join(tmpdir(), "qm-setup-locate-razor-"))], {})));
  try {
    const clientRoot = mkdtempSync(join(tmpdir(), "qm-client-razor-"));
    const scriptsDir = join(clientRoot, "ClassicUO", "Data", "Plugins", "Razor", "Scripts");
    mkdirSync(scriptsDir, { recursive: true });
    const r = await fetch(s2.url + "/api/setup/locate", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ adapter: "razor-enhanced", dir: clientRoot }),
    });
    assert.equal(r.status, 200);
    const body = asJson(await r.json());
    assert.equal(body.scriptsDir, scriptsDir);
  } finally {
    await s2.close();
  }
});

// Task 2, Phase 6: the page decides whether to offer the Highlight/Grab/Go-to bridge buttons from
// GET /api/setup's {settings.client, adapters} — settings.client names which installed adapter is
// active, and adapters carries that adapter's own capabilities.bridge list. This is the one route
// test both facts land in together, so it exercises the real contract the page reads rather than the
// pure listAdapters()/installer.mts unit already covered by app/installer.test.mts. --adapters points
// the whole server at a throwaway folder holding a copy of the real tazuo adapter (full bridge) next
// to a minimal fixture adapter that declares no bridge at all, standing in for a client like the
// ClassicUO web adapter that can't run one.
test("[fast] GET /api/setup: an adapter with no bridge reports capabilities.bridge:[]; tazuo still reports the three actions", async () => {
  const adaptersDir = mkdtempSync(join(tmpdir(), "qm-adapters-"));
  cpSync(join(HERE, "..", "adapters", "tazuo"), join(adaptersDir, "tazuo"), { recursive: true });
  const noBridgeDir = join(adaptersDir, "nobridge");
  mkdirSync(noBridgeDir, { recursive: true });
  writeFileSync(join(noBridgeDir, "capabilities.json"), JSON.stringify({
    adapter: "nobridge", version: "1.0.0", transport: "folder",
    capabilities: { layers: [], arms: false, bank: false, ground: false, nested: false, tooltips: "label", bridge: [] },
  }));
  const dataDir = mkdtempSync(join(tmpdir(), "qm-setup-nobridge-"));
  const scriptsDir = mkdtempSync(join(tmpdir(), "qm-setup-nobridge-scripts-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--port", "0", "--data", dataDir, "--adapters", adaptersDir], {})));
  try {
    const setup = asJson<SetupResponse>(await (await fetch(s2.url + "/api/setup")).json());
    assert.deepEqual(setup.adapters.map((a) => a.id).sort(), ["nobridge", "tazuo"]);
    assert.deepEqual(setup.adapters.find((a) => a.id === "nobridge")!.capabilities.bridge, []);
    assert.deepEqual(setup.adapters.find((a) => a.id === "tazuo")!.capabilities.bridge, ["highlight", "grab", "goto"]);

    // settings.client names which of those is active — PUT it at the no-bridge adapter first.
    const putNoBridge = await fetch(s2.url + "/api/settings", {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ client: { adapter: "nobridge", scriptsDir } }),
    });
    assert.equal(putNoBridge.status, 200);
    let after = asJson<SetupResponse>(await (await fetch(s2.url + "/api/setup")).json());
    assert.equal(after.settings.client!.adapter, "nobridge");
    assert.deepEqual(after.adapters.find((a) => a.id === after.settings.client!.adapter)!.capabilities.bridge, []);

    // Switching to tazuo flips the same lookup back to the three actions — same shape, no restart.
    const putTazuo = await fetch(s2.url + "/api/settings", {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ client: { adapter: "tazuo", scriptsDir } }),
    });
    assert.equal(putTazuo.status, 200);
    after = asJson<SetupResponse>(await (await fetch(s2.url + "/api/setup")).json());
    assert.equal(after.settings.client!.adapter, "tazuo");
    assert.deepEqual(after.adapters.find((a) => a.id === after.settings.client!.adapter)!.capabilities.bridge, ["highlight", "grab", "goto"]);
  } finally {
    await s2.close();
  }
});

// Bug fix: a player who pressed Skip in the setup wizard (settings.client left unset on purpose — see
// app/ui/bridge.mts's currentAdapter() comment) or installed an adapter's scripts by hand had every
// Highlight/Grab/Go-to button vanish, even though POST /api/bridge / GET /api/bridge/status were
// already routing to bridgeAdapter()'s own default the whole time. GET /api/setup now reports that same
// routing target as `bridgeAdapter`, so the page can fall back to it instead of hiding the buttons.
test("[fast] GET /api/setup reports bridgeAdapter: \"tazuo\" (the real bridge routing default) when no client is configured", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-setup-bridgeadapter-default-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--port", "0", "--data", dir], {})));
  try {
    const setup = asJson<SetupResponse>(await (await fetch(s2.url + "/api/setup")).json());
    assert.equal(setup.settings.client, undefined);
    assert.equal(setup.bridgeAdapter, "tazuo");
  } finally {
    await s2.close();
  }
});

test("[fast] GET /api/setup reports bridgeAdapter matching a configured client's own adapter, not the default", async () => {
  const adaptersDir = mkdtempSync(join(tmpdir(), "qm-adapters-bridgeadapter-"));
  cpSync(join(HERE, "..", "adapters", "tazuo"), join(adaptersDir, "tazuo"), { recursive: true });
  const noBridgeDir = join(adaptersDir, "nobridge");
  mkdirSync(noBridgeDir, { recursive: true });
  writeFileSync(join(noBridgeDir, "capabilities.json"), JSON.stringify({
    adapter: "nobridge", version: "1.0.0", transport: "folder",
    capabilities: { layers: [], arms: false, bank: false, ground: false, nested: false, tooltips: "label", bridge: [] },
  }));
  const dataDir = mkdtempSync(join(tmpdir(), "qm-setup-bridgeadapter-configured-"));
  const scriptsDir = mkdtempSync(join(tmpdir(), "qm-setup-bridgeadapter-configured-scripts-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--port", "0", "--data", dataDir, "--adapters", adaptersDir], {})));
  try {
    const put = await fetch(s2.url + "/api/settings", {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ client: { adapter: "nobridge", scriptsDir } }),
    });
    assert.equal(put.status, 200);
    const setup = asJson<SetupResponse>(await (await fetch(s2.url + "/api/setup")).json());
    assert.equal(setup.settings.client!.adapter, "nobridge");
    assert.equal(setup.bridgeAdapter, "nobridge", "a configured client wins over the tazuo default");
  } finally {
    await s2.close();
  }
});

test("[fast] GET /api/setup reports bridgeAdapter: null when no client is configured and the default (\"tazuo\") isn't among the discovered adapters", async () => {
  const adaptersDir = mkdtempSync(join(tmpdir(), "qm-adapters-bridgeadapter-null-"));
  const noBridgeDir = join(adaptersDir, "nobridge");
  mkdirSync(noBridgeDir, { recursive: true });
  writeFileSync(join(noBridgeDir, "capabilities.json"), JSON.stringify({
    adapter: "nobridge", version: "1.0.0", transport: "folder",
    capabilities: { layers: [], arms: false, bank: false, ground: false, nested: false, tooltips: "label", bridge: [] },
  }));
  const dataDir = mkdtempSync(join(tmpdir(), "qm-setup-bridgeadapter-null-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--port", "0", "--data", dataDir, "--adapters", adaptersDir], {})));
  try {
    const setup = asJson<SetupResponse>(await (await fetch(s2.url + "/api/setup")).json());
    assert.deepEqual(setup.adapters.map((a) => a.id), ["nobridge"]);
    assert.equal(setup.settings.client, undefined);
    assert.equal(setup.bridgeAdapter, null, "nothing named \"tazuo\" exists in this throwaway adapters dir, so there is no id left to fall back to");
  } finally {
    await s2.close();
  }
});

test("[fast] POST /api/setup/locate resolves a nested X/TazUO/LegionScripts folder to that path", async () => {
  const s2 = await startServer(ensureLayout(resolveConfig(["--port", "0", "--data", mkdtempSync(join(tmpdir(), "qm-setup-locate-"))], {})));
  try {
    const clientRoot = mkdtempSync(join(tmpdir(), "qm-client-"));
    const legionDir = join(clientRoot, "TazUO", "LegionScripts");
    mkdirSync(legionDir, { recursive: true });
    const r = await fetch(s2.url + "/api/setup/locate", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ adapter: "tazuo", dir: clientRoot }),
    });
    assert.equal(r.status, 200);
    const body = asJson<LocateResponse>(await r.json());
    assert.equal(body.scriptsDir, legionDir);
    assert.equal(body.installed!.version, null);

    const bad = await fetch(s2.url + "/api/setup/locate", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ adapter: "tazuo", dir: join(clientRoot, "does-not-exist") }),
    });
    assert.equal(bad.status, 400);
  } finally {
    await s2.close();
  }
});

test("[fast] POST /api/setup/install installs the scripts, saves settings.client, and PUT /api/settings {setupDone:true} is what clears firstRun", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-setup-install-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--port", "0", "--data", dir], {})));
  try {
    const scriptsDir = mkdtempSync(join(tmpdir(), "qm-client-install-"));
    const install = await fetch(s2.url + "/api/setup/install", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ adapter: "tazuo", scriptsDir }),
    });
    const installBody = asJson<InstallScriptsResult>(await install.json());
    assert.equal(install.status, 200, JSON.stringify(installBody));
    assert.deepEqual(installBody.installed!.sort(), ["packrat-blacklist.py", "packrat-bridge.py", "packrat-refresh.py", "packrat-scanner.py"]);
    assert.equal(installBody.version, TAZUO_VERSION);
    assert.ok(existsSync(join(scriptsDir, "packrat-scanner.py")));
    assert.ok(existsSync(join(scriptsDir, "packrat-paths.json")));
    assert.equal(existsSync(join(scriptsDir, "packrat-scanner.py.new")), false);

    const settingsAfterInstall = asJson<SettingsResponse>(await (await fetch(s2.url + "/api/settings")).json());
    assert.deepEqual(settingsAfterInstall.settings.client, { adapter: "tazuo", scriptsDir });

    const setupAfterInstall = asJson<SetupResponse>(await (await fetch(s2.url + "/api/setup")).json());
    assert.equal(setupAfterInstall.firstRun, true, "an install alone must not clear firstRun");
    assert.equal(setupAfterInstall.installed!.version, TAZUO_VERSION);

    const done = await fetch(s2.url + "/api/settings", {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ setupDone: true }),
    });
    assert.equal(done.status, 200);
    assert.equal((asJson<SetupResponse>(await (await fetch(s2.url + "/api/setup")).json())).firstRun, false);
    // the earlier install's settings.client survives a later, unrelated settings PUT
    assert.deepEqual((asJson<SettingsResponse>(await (await fetch(s2.url + "/api/settings")).json())).settings.client, { adapter: "tazuo", scriptsDir });
  } finally {
    await s2.close();
  }
});

test("[fast] POST /api/setup/install refuses 409 with the -stopall message while bridge/tazuo/status.json is alive", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-setup-running-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--port", "0", "--data", dir], {})));
  try {
    mkdirSync(join(dir, "bridge", "tazuo"), { recursive: true });
    writeFileSync(join(dir, "bridge", "tazuo", "status.json"), JSON.stringify({ alive: new Date().toISOString() }));
    const scriptsDir = mkdtempSync(join(tmpdir(), "qm-client-running-"));
    const r = await fetch(s2.url + "/api/setup/install", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ adapter: "tazuo", scriptsDir }),
    });
    assert.equal(r.status, 409);
    const body = asJson<ErrorBody>(await r.json());
    assert.match(body.error, /-stopall/);
    assert.deepEqual(readdirSync(scriptsDir), [], "nothing was written while refused");
  } finally {
    await s2.close();
  }
});



// ---- Task 1, Phase 6: POST /api/import/paste, POST /api/import/rescan -----------------------------
test("[fast] POST /api/import/paste: a good paste (marker block, with noise around it) lands a file the watcher then ingests", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-paste-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--port", "0", "--data", dir], {})));
  try {
    const fixture = JSON.parse(readFileSync(join(HERE, "..", "adapters", "tazuo", "fixture.scan.json"), "utf8"));
    const text = [
      "console output from the web client scanner",
      "-----BEGIN PACK RAT SCAN-----",
      JSON.stringify(fixture),
      "-----END PACK RAT SCAN-----",
      "done",
    ].join("\n");

    const r = await fetch(s2.url + "/api/import/paste", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text, adapter: "tazuo" }) });
    assert.equal(r.status, 200);
    const body = asJson<PasteResponse>(await r.json());
    assert.equal(body.ok, true);
    assert.equal(body.character, fixture.character);
    assert.ok(body.written, JSON.stringify(body));

    const deadline = Date.now() + 3000;
    let found = false;
    while (Date.now() < deadline && !found) {
      const inv = asJson<InventoryResponse>(await (await fetch(s2.url + "/api/inventory")).json());
      found = Boolean(inv.inventory.characters[fixture.character]);
      if (!found) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(found, "the pasted scan folded into /api/inventory within 3s");
  } finally {
    await s2.close();
  }
});

// Post-review minor: the route now compares the picked `adapter` (which inbox the file lands in)
// against the pasted document's own `adapter.id` and returns a `warning` on a mismatch — harmless to
// the fold (the file still lands and still folds correctly), but the player should be told, since the
// picker that would have caught this is hidden whenever only one client is configured.
test("[fast] POST /api/import/paste: filing a scan under a different adapter than it declares returns a warning, but still lands and folds", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-paste-mismatch-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--port", "0", "--data", dir], {})));
  try {
    const fixture = JSON.parse(readFileSync(join(HERE, "..", "adapters", "tazuo", "fixture.scan.json"), "utf8"));   // adapter.id: "tazuo"
    const r = await fetch(s2.url + "/api/import/paste", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: JSON.stringify(fixture), adapter: "razor-enhanced" }),   // deliberately the wrong adapter
    });
    assert.equal(r.status, 200);
    const body = asJson<PasteResponse>(await r.json());
    assert.equal(body.ok, true);
    assert.match(body.warning!, /razor-enhanced/);
    assert.match(body.warning!, /tazuo/);
    assert.ok(body.written, JSON.stringify(body));

    // "Still lands and folds": the watcher's own scanOnce() nudge (fired right after the write) can
    // move the file out of the inbox before this test ever gets to look — same race the "good paste"
    // test above sidesteps by polling /api/inventory instead of the inbox directory directly, so this
    // does the same rather than asserting on inbox-file timing.
    const deadline = Date.now() + 3000;
    let found = false;
    while (Date.now() < deadline && !found) {
      const inv = asJson<InventoryResponse>(await (await fetch(s2.url + "/api/inventory")).json());
      found = Boolean(inv.inventory.characters[fixture.character]);
      if (!found) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(found, "the mismatched-adapter paste still folded into /api/inventory within 3s");
  } finally {
    await s2.close();
  }
});

test("[fast] POST /api/import/paste: a matching adapter carries no warning field", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-paste-match-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--port", "0", "--data", dir], {})));
  try {
    const fixture = JSON.parse(readFileSync(join(HERE, "..", "adapters", "tazuo", "fixture.scan.json"), "utf8"));
    const r = await fetch(s2.url + "/api/import/paste", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: JSON.stringify(fixture), adapter: "tazuo" }),
    });
    const body = asJson<PasteResponse>(await r.json());
    assert.equal(body.ok, true);
    assert.equal(body.warning, undefined);
  } finally {
    await s2.close();
  }
});

test("[fast] POST /api/import/paste: a bad paste is 400 with the parse error and writes nothing to the inbox", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-paste-bad-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--port", "0", "--data", dir], {})));
  try {
    const inboxDir = join(dir, "inbox", "tazuo");
    const before = existsSync(inboxDir) ? readdirSync(inboxDir) : [];

    const r = await fetch(s2.url + "/api/import/paste", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "not json at all", adapter: "tazuo" }) });
    assert.equal(r.status, 400);
    const body = asJson<PasteResponse>(await r.json());
    assert.equal(body.ok, false);
    assert.match(body.error!, /JSON/);

    const after = existsSync(inboxDir) ? readdirSync(inboxDir) : [];
    assert.deepEqual(after, before, "a rejected paste must not write into the inbox");
  } finally {
    await s2.close();
  }
});

// The paste cap used to be readBody's 50 MB default while the watcher refuses an inbox file over
// MAX_INBOX_BYTES (32 MB), so a paste in between was answered 200 and then rejected. It is refused up
// front now, and nothing is written.
test("[fast] POST /api/import/paste: a paste over the watcher's inbox limit is 413 and writes nothing", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-paste-big-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--port", "0", "--data", dir], {})));
  try {
    const r = await fetch(s2.url + "/api/import/paste", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "x".repeat(MAX_INBOX_BYTES), adapter: "tazuo" }) });
    assert.equal(r.status, 413);
    assert.match(asJson<ErrorBody>(await r.json()).error, /paste too large/);
    const inboxDir = join(dir, "inbox", "tazuo");
    assert.deepEqual(existsSync(inboxDir) ? readdirSync(inboxDir) : [], []);
  } finally {
    await s2.close();
  }
});

test("[fast] POST /api/import/paste: an unknown adapter id is rejected with 400", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-paste-adapter-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--port", "0", "--data", dir], {})));
  try {
    const fixture = JSON.parse(readFileSync(join(HERE, "..", "adapters", "tazuo", "fixture.scan.json"), "utf8"));
    const r = await fetch(s2.url + "/api/import/paste", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: JSON.stringify(fixture), adapter: "not-a-real-adapter" }) });
    assert.equal(r.status, 400);
    assert.match(asJson<ErrorBody>(await r.json()).error, /unknown adapter/);
    assert.equal(existsSync(join(dir, "inbox", "not-a-real-adapter")), false);
  } finally {
    await s2.close();
  }
});

test("[fast] POST /api/import/rescan reports the adapters it swept (tazuo when live, empty under --demo)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-rescan-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--port", "0", "--data", dir], {})));
  try {
    const r = await fetch(s2.url + "/api/import/rescan", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    assert.equal(r.status, 200);
    const j = asJson<RescanResponse>(await r.json());
    assert.equal(j.ok, true);
    // Present, not pinned: the point is "tazuo gets swept live" vs. "nothing gets swept under
    // --demo" (below) — not the exact set of every adapter shipped in this repo.
    assert.ok(j.adapters.includes("tazuo"), JSON.stringify(j.adapters));
  } finally {
    await s2.close();
  }

  const demoDir = mkdtempSync(join(tmpdir(), "qm-rescan-demo-"));
  const s3 = await startServer(ensureLayout(resolveConfig(["--demo", "--port", "0", "--data", demoDir], {})));
  try {
    const r = await fetch(s3.url + "/api/import/rescan", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    assert.equal(r.status, 200);
    assert.deepEqual(asJson(await r.json()), { ok: true, adapters: [] });
  } finally {
    await s3.close();
  }
});

test("[fast] POST /api/import/rescan actually re-sweeps a file the folder watcher missed", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-rescan-sweep-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--port", "0", "--data", dir], {})));
  try {
    const fixture = JSON.parse(readFileSync(join(HERE, "..", "adapters", "tazuo", "fixture.scan.json"), "utf8"));
    // Drop the file with a single write (no rename event) while the server is briefly paused from
    // handling requests — the startup sweep already ran before this file existed, so nothing has
    // ingested it yet; POST /api/import/rescan is what a player reaches for when a drop like this
    // never showed up.
    const inboxDir = join(dir, "inbox", "tazuo");
    mkdirSync(inboxDir, { recursive: true });
    writeFileSync(join(inboxDir, "missed.json"), JSON.stringify(fixture));

    const r = await fetch(s2.url + "/api/import/rescan", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    assert.equal(r.status, 200);
    const swept = asJson<RescanResponse>(await r.json());
    assert.equal(swept.ok, true);
    // Present, not pinned — see the previous test's comment; this one's real point is the
    // ingested-file assertion below, not the exact set of every adapter shipped in this repo.
    assert.ok(swept.adapters.includes("tazuo"), JSON.stringify(swept.adapters));

    const deadline = Date.now() + 3000;
    let found = false;
    while (Date.now() < deadline && !found) {
      const inv = asJson<InventoryResponse>(await (await fetch(s2.url + "/api/inventory")).json());
      found = Boolean(inv.inventory.characters[fixture.character]);
      if (!found) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(found, "rescan folded the missed file into /api/inventory within 3s");
  } finally {
    await s2.close();
  }
});

test("[fast] GET /api/update-check reflects package.json (no repository field today => configured:false, no network call)", async () => {
  const pkg = JSON.parse(readFileSync(join(HERE, "..", "package.json"), "utf8"));
  const j = asJson(await (await get("/api/update-check")).json());
  assert.equal(j.ok, true);
  assert.equal(j.configured, pkg.repository ? true : false, JSON.stringify(pkg.repository));
});

test("[fast] POST /api/host/pick-folder and open-path are 501 without a host; an injected host answers pick-folder and validates open-path's which", async () => {
  const noHost = await fetch(srv.url + "/api/host/pick-folder", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "Pick" }) });
  assert.equal(noHost.status, 501);
  const noHostOpen = await fetch(srv.url + "/api/host/open-path", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ which: "data" }) });
  assert.equal(noHostOpen.status, 501);
  // The page learns this up front (Settings shows Copy path instead of an Open that can only fail).
  assert.equal(asJson(await (await fetch(srv.url + "/api/setup")).json()).canOpenFolders, false);

  const dir = mkdtempSync(join(tmpdir(), "qm-host-"));
  const opened: string[] = [];
  const s2 = await startServer(
    ensureLayout(resolveConfig(["--demo", "--port", "0", "--data", dir], {})),
    { host: { pickFolder: async () => "/x", openPath: async (w: "data" | "logs") => { opened.push(w); } } },
  );
  try {
    assert.equal(asJson(await (await fetch(s2.url + "/api/setup")).json()).canOpenFolders, true);
    const picked = await fetch(s2.url + "/api/host/pick-folder", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "Pick" }) });
    assert.equal(picked.status, 200);
    assert.equal(asJson(await picked.json()).path, "/x");

    const openOk = await fetch(s2.url + "/api/host/open-path", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ which: "data" }) });
    assert.equal(openOk.status, 200);
    // The DISCRIMINATOR crosses the host bridge, not a path this process resolved — electron/main.mts
    // owns the two directories it maps to (phase-7 security review, area-4 Important 1).
    assert.deepEqual(opened, ["data"]);

    const openBad = await fetch(s2.url + "/api/host/open-path", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ which: "etc" }) });
    assert.equal(openBad.status, 400);
  } finally {
    await s2.close();
  }
});

test("[fast] PUT /api/settings {client: {adapter: 5}} is 400 naming client", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-settings-client-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--demo", "--port", "0", "--data", dir], {})));
  try {
    const r = await fetch(s2.url + "/api/settings", {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ client: { adapter: 5, scriptsDir: "/x" } }),
    });
    assert.equal(r.status, 400);
    assert.match(asJson<ErrorBody>(await r.json()).error, /client/);
  } finally {
    await s2.close();
  }
});

// Post-review fix (security, Important finding 1): adapter must be checked against the real,
// known adapter ids before it can reach a filesystem path — a traversal id like "../../../../tmp/evil"
// must never let /api/setup/locate or /api/setup/install (or PUT /api/settings' client.adapter) act on
// an arbitrary directory. installer.test.mts covers installScripts' own defence-in-depth rejection
// directly; these cover the route-level allowlist check in front of it.
test("[fast] POST /api/setup/locate and POST /api/setup/install reject a traversal/unknown adapter id with 400, writing nothing", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-setup-badadapter-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--port", "0", "--data", dir], {})));
  try {
    const evilAdapter = "../../../../tmp/evil";
    const probeDir = mkdtempSync(join(tmpdir(), "qm-badadapter-probe-"));

    const locate = await fetch(s2.url + "/api/setup/locate", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ adapter: evilAdapter, dir: probeDir }),
    });
    assert.equal(locate.status, 400);
    assert.match(asJson<ErrorBody>(await locate.json()).error, /adapter/);

    const scriptsDir = mkdtempSync(join(tmpdir(), "qm-badadapter-dest-"));
    const install = await fetch(s2.url + "/api/setup/install", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ adapter: evilAdapter, scriptsDir }),
    });
    assert.equal(install.status, 400);
    assert.match(asJson<ErrorBody>(await install.json()).error, /adapter/);
    assert.deepEqual(readdirSync(scriptsDir), [], "nothing was written for a rejected adapter id");
    assert.equal((asJson<SettingsResponse>(await (await fetch(s2.url + "/api/settings")).json())).settings.client, undefined, "a rejected install must not save settings.client");

    // an unknown-but-shape-valid adapter id (no traversal characters, just not a real adapter) is
    // rejected the same way
    const unknown = await fetch(s2.url + "/api/setup/install", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ adapter: "nope", scriptsDir }),
    });
    assert.equal(unknown.status, 400);
  } finally {
    await s2.close();
  }
});

test("[fast] PUT /api/settings {client: {adapter: \"../evil\", scriptsDir}} is 400 (client.adapter must be a real adapter id)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-settings-badadapter-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--demo", "--port", "0", "--data", dir], {})));
  try {
    const r = await fetch(s2.url + "/api/settings", {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ client: { adapter: "../evil", scriptsDir: "/x" } }),
    });
    assert.equal(r.status, 400);
    assert.match(asJson<ErrorBody>(await r.json()).error, /adapter/);
    assert.equal((asJson<SettingsResponse>(await (await fetch(s2.url + "/api/settings")).json())).settings.client, undefined, "a rejected PUT must not save settings.client");
  } finally {
    await s2.close();
  }
});

// ---- Phase 7 security review: the server's own hardening ------------------------------------------
// One block, one finding per test, each named after the property it pins rather than the bug it came
// from. Every test here was verified RED against the pre-fix server before the fix landed.

// Important 8: JSON.parse("null") is a perfectly well-formed body, and destructuring it is a
// TypeError — ten routes answered 500 and appended a full V8 stack to <data>/logs/server.log, which
// is neither rotated nor size-capped. One asObject() guard in front of them all.
const OBJECT_BODY_ROUTES: Array<[string, string]> = [
  ["PUT", "/api/settings"], ["POST", "/api/setup/locate"], ["POST", "/api/setup/install"],
  ["POST", "/api/import/paste"], ["POST", "/api/import/rescan"],
  ["POST", "/api/host/pick-folder"], ["POST", "/api/host/open-path"], ["POST", "/api/optimize"],
  ["POST", "/api/bridge"], ["POST", "/api/forget"], ["POST", "/api/forget-character"], ["PUT", "/api/ui-prefs"],
  ["POST", "/api/blacklist"],
];
test("[fast] a null/array/scalar JSON body is a clean 400 on every body-reading route, and the log does not grow", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-nullbody-"));
  // A host stub, so the two /api/host/* routes get past their own 501 and reach the body read.
  const s2 = await startServer(
    ensureLayout(resolveConfig(["--port", "0", "--data", dir], {})),
    { host: { pickFolder: async () => null, openPath: async () => {} } },
  );
  const log = join(dir, "logs", "server.log");
  const before = existsSync(log) ? readFileSync(log, "utf8").length : 0;
  try {
    for (const [method, path] of OBJECT_BODY_ROUTES) {
      for (const body of ["null", "[]", '"x"', "42"]) {
        const r = await fetch(s2.url + path, { method, headers: { "content-type": "application/json" }, body });
        assert.equal(r.status, 400, `${method} ${path} with body ${body}`);
        assert.equal(asJson<ErrorBody>(await r.json()).error, "body must be a JSON object");
      }
    }
    const after = existsSync(log) ? readFileSync(log, "utf8").length : 0;
    assert.equal(after, before, "a rejected body writes nothing to server.log");
  } finally {
    await s2.close();
  }
});

// Important 6 / area-4 minor 3: frame-ancestors has no default-src fallback, so `default-src 'none'`
// never delivered the "no framing" the comment claimed, and no X-Frame-Options was sent at all.
test("[smoke] / carries frame-ancestors 'none', and every response carries x-frame-options: DENY", async () => {
  const page = await get("/");
  assert.match(page.headers.get("content-security-policy") || "", /frame-ancestors 'none'/);
  assert.equal(page.headers.get("x-frame-options"), "DENY");
  const json = await get("/api/inventory");
  assert.equal(json.headers.get("x-frame-options"), "DENY", "not just text/html");
});

// Minor 7: both timeouts were 0, so a socket that sent half a request line and then stopped was never
// closed. The old comment justified that with the exact solver's minutes-long searches — but those are
// on the RESPONSE side, which neither of these governs, and a finite requestTimeout leaves a long-lived
// SSE response alone (the request itself completed on connect). server.timeout, which WOULD cut a
// stream, stays disabled.
test("[fast] the server keeps finite header/request timeouts, and an SSE stream still streams under them", async () => {
  assert.ok(srv.server.headersTimeout > 0, "headersTimeout must not be disabled");
  assert.ok(srv.server.requestTimeout > 0, "requestTimeout must not be disabled");
  assert.equal(srv.server.timeout, 0, "the idle-socket timeout stays off — it would cut an SSE stream");
  const sse = sseReader(await get("/api/events"));
  try {
    await sse.readUntil((b) => b.includes("event: hello"));
  } finally {
    await sse.cancel();
  }
});

// Important 3 / area-3 finding 4: install took the raw body value and only installScripts'
// statSync().isDirectory() stood between it and the copy loop, while locate validated — so the two
// halves of the wizard disagreed about what a scripts folder is. Now install resolves the SAME nested
// form locate returns, and persists that.
test("[fast] POST /api/setup/install resolves the nested scripts folder like locate does, and persists the resolved path", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-install-nested-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--port", "0", "--data", dir], {})));
  try {
    const clientRoot = mkdtempSync(join(tmpdir(), "qm-install-nested-client-"));
    const legionDir = join(clientRoot, "TazUO", "LegionScripts");
    mkdirSync(legionDir, { recursive: true });
    const r = await fetch(s2.url + "/api/setup/install", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ adapter: "tazuo", scriptsDir: clientRoot }),
    });
    assert.equal(r.status, 200, await r.clone().text());
    assert.ok(existsSync(join(legionDir, "packrat-scanner.py")), "installed into the nested scripts folder");
    assert.equal(existsSync(join(clientRoot, "packrat-scanner.py")), false, "and not into the picked root");
    assert.deepEqual((asJson<SettingsResponse>(await (await fetch(s2.url + "/api/settings")).json())).settings.client,
      { adapter: "tazuo", scriptsDir: legionDir }, "the RESOLVED folder is what gets persisted");
  } finally {
    await s2.close();
  }
});

test("[fast] POST /api/setup/install refuses a scriptsDir that is not a folder, writing nothing and saving no client", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-install-baddir-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--port", "0", "--data", dir], {})));
  try {
    const clientRoot = mkdtempSync(join(tmpdir(), "qm-install-baddir-client-"));
    const missing = join(clientRoot, "no-such-folder");
    for (const bad of [missing, "relative/path", "\\\\host\\share", "//host/share", 5, null]) {
      const r = await fetch(s2.url + "/api/setup/install", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ adapter: "tazuo", scriptsDir: bad }),
      });
      assert.equal(r.status, 400, `scriptsDir ${JSON.stringify(bad)} should be refused`);
      assert.equal(asJson<ErrorBody & { code?: string }>(await r.json()).code, "badDir");
    }
    assert.equal(existsSync(missing), false, "a refused install creates nothing");
    assert.equal((asJson<SettingsResponse>(await (await fetch(s2.url + "/api/settings")).json())).settings.client, undefined);
  } finally {
    await s2.close();
  }
});

// Important 3: PUT /api/settings type-checked client.scriptsDir as a string and persisted it, after
// which GET /api/setup read whatever it named on every render — a UNC path dialled out over SMB on
// win32, a directory holding a FIFO hung the whole single-threaded process, and neither recovered on
// restart because the value was on disk.
test("[fast] PUT /api/settings validates client.scriptsDir (absolute, non-UNC, a real client folder) and leaves settings.json alone when it doesn't", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-settings-scriptsdir-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--port", "0", "--data", dir], {})));
  try {
    const clientRoot = mkdtempSync(join(tmpdir(), "qm-settings-scriptsdir-client-"));
    for (const bad of [join(clientRoot, "no-such-folder"), "relative/path", "\\\\host\\share", "//host/share", 5]) {
      const r = await fetch(s2.url + "/api/settings", {
        method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ client: { adapter: "tazuo", scriptsDir: bad } }),
      });
      assert.equal(r.status, 400, `scriptsDir ${JSON.stringify(bad)} should be refused`);
      assert.match(asJson<ErrorBody>(await r.json()).error, /client/);
    }
    assert.equal(JSON.parse(readFileSync(join(dir, "settings.json"), "utf8")).client, undefined, "no rejected value reached settings.json");

    // a real folder is accepted, resolved to the nested form, and can be cleared again
    const legionDir = join(clientRoot, "TazUO", "LegionScripts");
    mkdirSync(legionDir, { recursive: true });
    const good = await fetch(s2.url + "/api/settings", {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ client: { adapter: "tazuo", scriptsDir: clientRoot } }),
    });
    assert.equal(good.status, 200);
    assert.deepEqual(asJson<SettingsResponse>(await good.json()).settings.client, { adapter: "tazuo", scriptsDir: legionDir });
    const cleared = await fetch(s2.url + "/api/settings", {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ client: null }),
    });
    assert.equal(cleared.status, 200);
    assert.equal(asJson<SettingsResponse>(await cleared.json()).settings.client, null);
  } finally {
    await s2.close();
  }
});

test("[fast] PUT /api/settings keeps a paste client (no scripts folder), and client: null still forgets it", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-settings-paste-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--port", "0", "--data", dir], {})));
  const put = (client: unknown): Promise<Response> => fetch(s2.url + "/api/settings", {
    method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ client }),
  });
  try {
    const kept = await put({ adapter: "classicuo-web", scriptsDir: "" });
    assert.equal(kept.status, 200);
    assert.deepEqual(asJson<SettingsResponse>(await kept.json()).settings.client, { adapter: "classicuo-web", scriptsDir: "" });
    assert.deepEqual(JSON.parse(readFileSync(join(dir, "settings.json"), "utf8")).client, { adapter: "classicuo-web", scriptsDir: "" });
    const cleared = await put(null);
    assert.equal(cleared.status, 200);
    assert.equal(asJson<SettingsResponse>(await cleared.json()).settings.client, null);
  } finally {
    await s2.close();
  }
});

test("[fast] PUT /api/settings type-checks shard before it reaches loadRules", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-settings-shardtype-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--port", "0", "--data", dir], {})));
  try {
    for (const bad of [5, {}, [], null, "x".repeat(200)]) {
      const r = await fetch(s2.url + "/api/settings", {
        method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ shard: bad }),
      });
      assert.equal(r.status, 400, `shard ${JSON.stringify(bad)} should be refused`);
    }
  } finally {
    await s2.close();
  }
});

// Important 3: a message naming the path it probed turned this route into a clean yes/no oracle for
// any absolute path on the machine — "existing directory" vs "file or absent", for free.
test("[fast] POST /api/setup/locate never echoes the path it probed", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-locate-oracle-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--port", "0", "--data", dir], {})));
  try {
    const probe = join(mkdtempSync(join(tmpdir(), "qm-locate-oracle-probe-")), "definitely-not-here");
    const r = await fetch(s2.url + "/api/setup/locate", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ adapter: "tazuo", dir: probe }),
    });
    assert.equal(r.status, 400);
    const { error } = asJson<ErrorBody>(await r.json());
    assert.doesNotMatch(error, /definitely-not-here/, "the probed path must not come back in the error");
    assert.doesNotMatch(error, /\//, "nor any path at all");
  } finally {
    await s2.close();
  }
});

// Important 4: name was never type- or length-checked and the assembled document was never validated,
// so {name: {}} returned 200 and wrote a file every later fold re-read and re-rejected forever, while
// the user's Forget silently did nothing.
test("[fast] POST /api/forget validates name, bounds it, and only ever writes a document that passes validateScan", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-forget-name-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--port", "0", "--data", dir], {})));
  const scans = join(dir, "scans");
  try {
    for (const bad of [{}, [], 5, true]) {
      const r = await fetch(s2.url + "/api/forget", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ root: 1, name: bad }),
      });
      assert.equal(r.status, 400, `name ${JSON.stringify(bad)} should be refused`);
    }
    assert.equal(existsSync(scans) ? readdirSync(scans).length : 0, 0, "no tombstone was written for any rejected name");

    // a body far past what four small scalar fields need is refused outright (this route used to
    // inherit readBody's 50 MB default, which is what let a 200 KB name become a 200 KB scan file)
    const huge = await fetch(s2.url + "/api/forget", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ root: 1, name: "x".repeat(20_000) }),
    });
    assert.equal(huge.status, 413);
    assert.equal(readdirSync(scans).length, 0, "and nothing was written for it either");

    const long = await fetch(s2.url + "/api/forget", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ root: 1, name: "x".repeat(1000) }),
    });
    assert.equal(long.status, 200);
    const files = readdirSync(scans);
    assert.equal(files.length, 1);
    const doc = JSON.parse(readFileSync(join(scans, files[0]!), "utf8"));
    assert.equal(doc.roots[0].name.length, 64, "the label is capped");
    assert.equal(validateScan(doc).ok, true, "every file this route writes passes the scan contract");

    // one file per forgotten root, not one per click: the name used to carry a millisecond timestamp,
    // so a loop of calls grew <data>/scans/ without bound and slowed every later fold
    for (let i = 0; i < 5; i++) {
      await fetch(s2.url + "/api/forget", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ root: 1, name: "chest" }) });
    }
    assert.deepEqual(readdirSync(scans), files, "re-forgetting a root replaces its tombstone instead of adding one");
  } finally {
    await s2.close();
  }
});

// Important 5, first half: pools/current/profile/opts were unvalidated. {pools:{helmet:[null]}} started
// a real worker thread that died with a TypeError, and an unbounded opts.restarts/timeBudgetMs went
// straight into the search.
test("[fast] POST /api/optimize rejects a malformed pools/current/profile and an out-of-range opts instead of starting a job", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-optimize-validate-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--demo", "--port", "0", "--data", dir], {})));
  const profile = { caps: { physResist: 70 }, weights: {} };
  const post = (body: unknown): Promise<Response> => fetch(s2.url + "/api/optimize", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  try {
    const bad: unknown[] = [
      { pools: { helmet: [null] }, current: {}, profile, opts: {} },
      { pools: { helmet: [{ serial: 1, name: "x", slot: "helmet" }] }, current: {}, profile, opts: {} },   // no props
      { pools: { helmet: "not-an-array" }, current: {}, profile, opts: {} },
      { pools: [], current: {}, profile, opts: {} },
      { pools: {}, current: { helmet: 5 }, profile, opts: {} },
      { pools: {}, current: {}, profile: "not-an-object", opts: {} },
      { pools: {}, current: {}, profile, opts: { restarts: 1e12 } },
      { pools: {}, current: {}, profile, opts: { timeBudgetMs: Number.MAX_SAFE_INTEGER } },
      { pools: {}, current: {}, profile, opts: { timeBudgetMs: "10s" } },
      { pools: {}, current: {}, profile, opts: { exact: "yes" } },
      { pools: {}, current: {}, profile, opts: { spawnShell: true } },   // unknown option
      { pools: {}, current: {}, profile, opts: [] },
      { pools: {}, current: {}, profile, opts: {}, meta: [] },
      { pools: {}, current: {}, profile, opts: {}, character: 5 },
    ];
    for (const body of bad) {
      const r = await post(body);
      assert.equal(r.status, 400, JSON.stringify(body).slice(0, 120));
    }
    assert.equal(existsSync(join(dir, "runs")) ? readdirSync(join(dir, "runs")).length : 0, 0, "no job ever started, so no run was saved");
  } finally {
    await s2.close();
  }
});

// Important 5, second half: saveRun wrote `settings: meta.settings` verbatim, so a padded meta became a
// padded file in <data>/runs/ — which readRuns() re-parses on every POST /api/optimize and GET /api/runs.
test("[fast] POST /api/optimize persists only the known meta fields, so caller padding never reaches <data>/runs/", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-optimize-meta-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--demo", "--port", "0", "--data", dir], {})));
  try {
    const inv = foldFixtures(join(HERE, "fixtures"));
    const character = Object.keys(inv.characters)[0]!;
    const { pools, current } = buildPools(inv, character, {});
    const profile = { caps: { physResist: 70 }, weights: { physResist: 1 } };
    const huge = await fetch(s2.url + "/api/optimize", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ pools, current, profile, opts: {}, meta: { character, settings: { pad: "p".repeat(200_000) } } }),
    });
    assert.equal(huge.status, 400, "an oversized meta is refused outright");

    const ok = await fetch(s2.url + "/api/optimize", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ pools, current, profile, opts: {}, meta: { character, secret: "s".repeat(500), settings: { allowOthersWorn: true } } }),
    });
    assert.equal(ok.status, 200, await ok.clone().text());
    const { id } = asJson<OptimizeJobResponse>(await ok.json());
    const runFile = join(dir, "runs", `${id}.json`);
    for (let i = 0; i < 200 && !existsSync(runFile); i++) await new Promise((r) => setTimeout(r, 20));
    const saved = readFileSync(runFile, "utf8");
    assert.doesNotMatch(saved, /secret|sssss/, "an unknown meta field is not persisted");
    assert.match(saved, new RegExp(`"character":"${character}"`), "the known ones still are");
  } finally {
    await s2.close();
  }
});

// Important 5, third half: the supersede rule is per-X-Client-Id and is skipped entirely when the
// header is absent, so a header-less (or header-rotating) caller could start unbounded worker threads.
test("[fast] POST /api/optimize caps concurrent jobs server-wide, even for callers with no X-Client-Id", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-optimize-cap-"));
  // A PACKRAT_CORE whose optimizeSuit parks its worker thread for ever (Atomics.wait on a shared
  // buffer nothing ever notifies — no CPU, no timing assumption): every job started here stays
  // "running" until close() terminates it, which is exactly the state the cap counts. A real search
  // would make this test a race against how fast HiGHS happens to finish.
  const hangingCore = join(mkdtempSync(join(tmpdir(), "qm-core-hang-")), "optimizer-core.mts");
  writeFileSync(hangingCore, "export function optimizeSuit() {\n  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);\n  return {};\n}\n");
  const s2 = await startServer(ensureLayout(resolveConfig(["--demo", "--port", "0", "--data", dir], { PACKRAT_CORE: hangingCore })));
  try {
    const profile = { caps: { physResist: 70 }, weights: { physResist: 1 } };
    const body = JSON.stringify({ pools: {}, current: {}, profile, opts: {} });
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const r = await fetch(s2.url + "/api/optimize", { method: "POST", headers: { "content-type": "application/json" }, body });
      statuses.push(r.status);
      await r.arrayBuffer();
    }
    assert.equal(statuses[0], 200, "the first one still runs");
    assert.ok(statuses.includes(429), `a request past the cap must be refused, got ${statuses.join(",")}`);
    assert.equal(statuses[statuses.length - 1], 429, "and it stays refused while those jobs are alive");
  } finally {
    await s2.close();
  }
});

// Minor 9: BRIDGE_SCHEMA.command constrains the TYPES of action/serial/chain but sets no maxLength on
// name and no item cap on chain — and this is the one route whose input reaches the game client.
test("[fast] POST /api/bridge bounds name, chain and the assembled line, queueing nothing when they blow the cap", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-bridge-bounds-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--demo", "--port", "0", "--data", dir], {})));
  const queue = join(dir, "bridge", "tazuo", "queue.jsonl");
  try {
    const bad: unknown[] = [
      { action: "grab", serial: 1, name: "n".repeat(1000), chain: [], pos: null },
      { action: "grab", serial: 1, name: 5, chain: [], pos: null },
      { action: "grab", serial: 1, name: "n", chain: Array.from({ length: 64 }, (_, i) => i), pos: null },
      { action: "grab", serial: 1, name: "n", chain: [], pos: { blob: "b".repeat(8000) } },
    ];
    for (const body of bad) {
      const r = await fetch(s2.url + "/api/bridge", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      assert.equal(r.status, 400, JSON.stringify(body).slice(0, 80));
    }
    // and the body itself is capped well below readBody's 50 MB default (a 500 KB name used to take
    // queue.jsonl to half a megabyte in one request)
    const enormous = await fetch(s2.url + "/api/bridge", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "grab", serial: 1, name: "n".repeat(1_000_000), chain: [], pos: null }),
    });
    assert.equal(enormous.status, 413);
    assert.equal(existsSync(queue), false, "nothing was appended to the queue");
  } finally {
    await s2.close();
  }
});

// Minor 13: String(label) throws on an object with a null prototype or a throwing toString — a 500
// plus a stack for what is a one-line type check.
test("[fast] PUT /api/runs/<id> type-checks label instead of String()-ing whatever arrives", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-run-label-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--demo", "--port", "0", "--data", dir], {})));
  try {
    mkdirSync(join(dir, "runs"), { recursive: true });
    writeFileSync(join(dir, "runs", "r1.json"), JSON.stringify({ id: "r1", character: "Kestrel", createdAt: new Date().toISOString(), result: { score: 1 } }));
    for (const bad of [{}, [], 5, true, null]) {
      const r = await fetch(s2.url + "/api/runs/r1", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ label: bad }) });
      assert.equal(r.status, 400, `label ${JSON.stringify(bad)} should be refused`);
    }
    const ok = await fetch(s2.url + "/api/runs/r1", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ label: "L".repeat(500) }) });
    assert.equal(ok.status, 200);
    assert.equal(JSON.parse(readFileSync(join(dir, "runs", "r1.json"), "utf8")).label.length, 120);
  } finally {
    await s2.close();
  }
});

// area-4 minor 1: the title crossed two process hops into a native, app-modal folder dialog with no
// check of any kind and the 50 MB default body cap behind it.
test("[fast] POST /api/host/pick-folder passes on only a short string title, and the shell's default otherwise", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-pickfolder-title-"));
  const seen: Array<{ title?: unknown }> = [];
  const s2 = await startServer(
    ensureLayout(resolveConfig(["--demo", "--port", "0", "--data", dir], {})),
    { host: { pickFolder: async (opts) => { seen.push(opts); return "/x"; } } },
  );
  try {
    for (const title of [{ evil: 1 }, 5, "T".repeat(500), null]) {
      const r = await fetch(s2.url + "/api/host/pick-folder", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title }) });
      assert.equal(r.status, 200);
    }
    assert.deepEqual(seen, [{}, {}, {}, {}], "anything but a short string falls back to the shell's own title");
    const good = await fetch(s2.url + "/api/host/pick-folder", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "Pick your client folder" }) });
    assert.equal(good.status, 200);
    assert.deepEqual(seen[4], { title: "Pick your client folder" });
  } finally {
    await s2.close();
  }
});

// area-4 minor 5: nothing below this process bounds a host call — callHost never expires a pending
// entry, and a result posted after the server child was respawned is dropped — so a dialog whose
// answer never comes back held the socket open for ever, since requestTimeout governs request RECEIPT
// and never touches a response that has not started. The real ceiling is a minute, too long to sit
// through here, so this pins the wiring rather than the clock: both host calls go through the bounded
// wrapper, which the unbounded original did not have at all.
test("[fast] both POST /api/host/* routes await a BOUNDED host call, and a timed-out one answers 504", () => {
  const src = readFileSync(join(HERE, "vault-server.mts"), "utf8");
  assert.match(src, /withHostTimeout\(host\.pickFolder\(/, "pick-folder goes through the timeout wrapper");
  assert.match(src, /withHostTimeout\(host\.openPath\(/, "so does open-path");
  assert.match(src, /e\.statusCode = 504;/, "and a timed-out host call answers 504");
});

// Minor 10: extractJsonText strips literal newlines before JSON.parse, but a \n ESCAPE survives that
// and parses into a real newline — which then went raw into a log line, letting a caller forge as many
// correctly-timestamped entries as it liked in the file the 500-handler's `ref` scheme relies on.
test("[fast] POST /api/import/paste cannot forge log lines through the document's own adapter.id", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-paste-logforge-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--port", "0", "--data", dir], {})));
  const log = join(dir, "logs", "server.log");
  try {
    const fixture = JSON.parse(readFileSync(join(HERE, "..", "adapters", "tazuo", "fixture.scan.json"), "utf8"));
    fixture.adapter.id = "tazuo\n2026-01-02T03:04:05.000Z watcher[tazuo] accepted a scan that never existed";
    const r = await fetch(s2.url + "/api/import/paste", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: JSON.stringify(fixture), adapter: "razor-enhanced" }),
    });
    // The scan schema now bounds adapter.id to an adapter-id shape (^[a-z0-9-]+$, at most 64), so a
    // newline-carrying id is refused before the route's own JSON.stringify'd log line is even reached
    // — that escaping stays as defence in depth, and the log must still carry no forged entry.
    assert.equal(r.status, 400, await r.clone().text());
    assert.match(asJson<ErrorBody>(await r.json()).error, /\/adapter\/id/);
    // The watcher logs its own lines here too, so this asserts the shape rather than a line count:
    // the forged text must never START a line, which is the only thing that makes it a log entry.
    const text = existsSync(log) ? readFileSync(log, "utf8") : "";
    assert.doesNotMatch(text, /^2026-01-02T03:04:05\.000Z/m, "the forged line never became a line");
  } finally {
    await s2.close();
  }
});

// The two event-stream routes write their own headers rather than going through send(), so the
// "every response carries x-frame-options" rule used to stop at them. Both share SSE_HEADERS now.
test("[fast] the event streams carry the same anti-framing headers every other response does", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-sse-headers-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--demo", "--port", "0", "--data", dir], {})));
  try {
    const res = await fetch(s2.url + "/api/events");
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("x-frame-options"), "DENY");
    assert.match(res.headers.get("content-security-policy") || "", /frame-ancestors 'none'/);
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    await res.body?.cancel();
  } finally {
    await s2.close();
  }
  // The per-job stream needs a running job to open; it is pinned to the same constant at the source.
  const source = readFileSync(join(HERE, "vault-server.mts"), "utf8");
  assert.equal((source.match(/res\.writeHead\(200, SSE_HEADERS\)/g) || []).length, 2, "both stream routes use SSE_HEADERS");
  assert.doesNotMatch(source, /"content-type": "text\/event-stream", "cache-control": "no-store", connection: "keep-alive", "x-content-type-options": "nosniff" \}/, "no stream writes its own header set any more");
});

// The contract's own bounds (name maxLength 120, chain maxItems 8 — the adapters' MAX_NAME/MAX_CHAIN)
// used to be documentation only: the validator implemented neither keyword, so the route's looser
// 200/16 pre-checks were the only refusal. validate.mts implements both now, and the route runs it.
test("[fast] POST /api/bridge refuses a name or chain past the bridge schema's own bounds", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-bridge-schema-bounds-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--demo", "--port", "0", "--data", dir], {})));
  try {
    const post = (body: unknown) => fetch(s2.url + "/api/bridge", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const longName = await post({ action: "grab", serial: 1, name: "n".repeat(121), chain: [], pos: null });
    assert.equal(longName.status, 400);
    assert.match(asJson<ErrorBody>(await longName.json()).error, /\/name .*maxLength 120/);
    const longChain = await post({ action: "grab", serial: 1, name: "n", chain: Array.from({ length: 9 }, (_, i) => i + 1), pos: null });
    assert.equal(longChain.status, 400);
    assert.match(asJson<ErrorBody>(await longChain.json()).error, /\/chain .*maxItems 8/);
    assert.equal(existsSync(join(dir, "bridge", "tazuo", "queue.jsonl")), false, "nothing was queued");
  } finally {
    await s2.close();
  }
});

// A settings.json that doesn't parse used to throw out of startServer — the app would not start at
// all (exit 2) over a file the player may have hand-edited. It now starts on defaults, keeps the
// unreadable file aside as settings.json.corrupt, and never overwrites an older one.
test("[fast] a corrupt settings.json is kept aside and the server starts on defaults", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-settings-corrupt-"));
  const config = ensureLayout(resolveConfig(["--demo", "--port", "0", "--data", dir], {}));
  writeFileSync(join(dir, "settings.json"), "{ this is not json");
  writeFileSync(join(dir, "settings.json.corrupt"), "an older corrupt file");
  const s2 = await startServer(config);
  try {
    const settings = asJson<SettingsResponse>(await (await fetch(s2.url + "/api/settings")).json());
    assert.equal(settings.settings.shard, "uoalive");
    assert.equal(readFileSync(join(dir, "settings.json.corrupt"), "utf8"), "an older corrupt file", "an older .corrupt is never overwritten");
    const aside = readdirSync(dir).filter((f) => /^settings\.json\.corrupt-\d+$/.test(f));
    assert.equal(aside.length, 1, JSON.stringify(readdirSync(dir)));
    assert.equal(readFileSync(join(dir, aside[0]!), "utf8"), "{ this is not json", "the unreadable file survives byte for byte");
    assert.equal(JSON.parse(readFileSync(join(dir, "settings.json"), "utf8")).shard, "uoalive", "defaults were written back");
  } finally {
    await s2.close();
  }
});

// bridgeAdapter() joins the persisted client's adapter id into the bridge queue/status paths, and
// PUT /api/settings refuses an unknown id — a hand-edited settings.json must not be a way round that.
test("[fast] a persisted client naming an adapter this install does not ship is ignored for the run, file untouched", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-settings-badadapter-"));
  const config = ensureLayout(resolveConfig(["--demo", "--port", "0", "--data", dir], {}));
  const onDisk = JSON.stringify({ schemaVersion: 1, shard: "uoalive", client: { adapter: "../../evil", scriptsDir: "/tmp" } }, null, 2) + "\n";
  writeFileSync(join(dir, "settings.json"), onDisk);
  const s2 = await startServer(config);
  try {
    const settings = asJson<SettingsResponse>(await (await fetch(s2.url + "/api/settings")).json());
    assert.equal(settings.settings.client ?? null, null);
    const setup = asJson<SetupResponse & { bridgeAdapter: string | null }>(await (await fetch(s2.url + "/api/setup")).json());
    assert.equal(setup.bridgeAdapter, "tazuo", "the bridge routes fall back to the default adapter, never the unvalidated id");
    assert.equal(readFileSync(join(dir, "settings.json"), "utf8"), onDisk, "settings.json on disk is left as it stands");
    assert.equal(existsSync(join(dir, "evil")), false);
  } finally {
    await s2.close();
  }
});

// ---- issue #18: server durability ------------------------------------------------------------------

const JSON_HEADERS = { "content-type": "application/json" };
const readJson = (p: string): Record<string, unknown> => JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>;
const logText = (dir: string): string => existsSync(join(dir, "logs", "server.log")) ? readFileSync(join(dir, "logs", "server.log"), "utf8") : "";
// An optimizer core whose search parks its worker thread for `ms` (for ever when omitted), with no
// CPU spent and no dependence on how fast a real search happens to be.
function parkedCore(ms?: number): string {
  const core = join(mkdtempSync(join(tmpdir(), "qm-core-park-")), "optimizer-core.mts");
  writeFileSync(core, `export function optimizeSuit() {\n  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0${ms == null ? "" : `, ${ms}`});\n  return {};\n}\n`);
  return core;
}
const TINY_OPTIMIZE = { pools: {}, current: {}, profile: { caps: { physResist: 70 }, weights: { physResist: 1 } } };
async function pollJob(url: string, id: string, until: (s: OptimizeJobResponse & { status: number }) => boolean, timeoutMs = 5000): Promise<OptimizeJobResponse & { status: number }> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const r = await fetch(`${url}/api/optimize/${id}/status`);
    const s = { ...asJson<OptimizeJobResponse>(await r.json()), status: r.status };
    if (until(s) || Date.now() > deadline) return s;
    await new Promise((res) => setTimeout(res, 20));
  }
}

test("[fast] a settings write after a startup shard fallback keeps the shard settings.json names", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-fallback-put-"));
  writeFileSync(join(dir, "settings.json"), JSON.stringify({ schemaVersion: 1, shard: "myshard" }, null, 2) + "\n");
  const s2 = await startServer(ensureLayout(resolveConfig(["--demo", "--port", "0", "--data", dir], {})));
  try {
    const r = await fetch(s2.url + "/api/settings", { method: "PUT", headers: JSON_HEADERS, body: JSON.stringify({ setupDone: true }) });
    assert.equal(r.status, 200);
    const onDisk = readJson(join(dir, "settings.json"));
    assert.equal(onDisk.shard, "myshard", "the in-memory fallback must never be written over the player's shard");
    assert.equal(onDisk.setupDone, true);
    const rules = asJson<RulesResponse>(await (await fetch(s2.url + "/api/rules")).json());
    assert.equal(rules.shard, "uoalive");
    assert.equal(rules.fallback, true, "still running on the fallback for this session");
  } finally {
    await s2.close();
  }
});

test("[fast] a settings write keeps a client whose adapter this install does not ship", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-client-put-"));
  const client = { adapter: "from-a-newer-version", scriptsDir: "/Users/example/Client/Scripts" };
  writeFileSync(join(dir, "settings.json"), JSON.stringify({ schemaVersion: 1, shard: "uoalive", client }, null, 2) + "\n");
  const s2 = await startServer(ensureLayout(resolveConfig(["--demo", "--port", "0", "--data", dir], {})));
  try {
    const got = asJson<SettingsResponse>(await (await fetch(s2.url + "/api/settings")).json());
    assert.equal(got.settings.client, null, "ignored for this run");
    const r = await fetch(s2.url + "/api/settings", { method: "PUT", headers: JSON_HEADERS, body: JSON.stringify({ setupDone: true }) });
    assert.equal(r.status, 200);
    assert.deepEqual(readJson(join(dir, "settings.json")).client, client, "settings.json keeps the client it named");
  } finally {
    await s2.close();
  }
});

test("[fast] a malformed JSON body is a 400 naming the problem, with nothing logged", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-badjson-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--demo", "--port", "0", "--data", dir], {})));
  try {
    for (const [method, path] of [["PUT", "/api/settings"], ["PUT", "/api/profiles"], ["POST", "/api/optimize"]] as const) {
      const r = await fetch(s2.url + path, { method, headers: JSON_HEADERS, body: "{not json" });
      assert.equal(r.status, 400, `${method} ${path}`);
      const body = asJson<ErrorBody>(await r.json());
      assert.match(body.error, /invalid JSON/);
      assert.equal(body.ref, undefined);
    }
    assert.equal(logText(dir), "", "no stack reaches the log for a caller's bad body");
  } finally {
    await s2.close();
  }
});

test("[fast] a truncated profiles.json is moved aside and reseeded from the defaults, not a 500 on every read", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-badprofiles-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--demo", "--port", "0", "--data", dir], {})));
  try {
    writeFileSync(join(dir, "profiles.json"), '{"schemaVersion": 2, "templ');
    const r = await fetch(s2.url + "/api/profiles");
    assert.equal(r.status, 200);
    const defaults = JSON.parse(readFileSync(join(HERE, "data", "profiles.default.json"), "utf8")) as ProfilesFile;
    assert.deepEqual(Object.keys(asJson<ProfilesResponse>(await r.json()).profiles.templates!), Object.keys(defaults.templates!));
    assert.equal(readFileSync(join(dir, "profiles.json.corrupt"), "utf8"), '{"schemaVersion": 2, "templ', "the damaged file is kept for the player");
    assert.match(logText(dir), /profiles\.json is unreadable/);
    assert.equal((await fetch(s2.url + "/api/profiles")).status, 200, "and the next read is ordinary");
  } finally {
    await s2.close();
  }
});

test("[fast] a truncated saved run answers a clear 404, not a 500, and can still be deleted", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-badrun-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--demo", "--port", "0", "--data", dir], {})));
  try {
    const id = "0b5c1a4e-0000-4000-8000-000000000001";
    writeFileSync(join(dir, "runs", `${id}.json`), '{"id":"0b5c');
    const got = await fetch(s2.url + `/api/runs/${id}`);
    assert.equal(got.status, 404);
    assert.match(asJson<ErrorBody>(await got.json()).error, /damaged/);
    const put = await fetch(s2.url + `/api/runs/${id}`, { method: "PUT", headers: JSON_HEADERS, body: JSON.stringify({ label: "x" }) });
    assert.equal(put.status, 404);
    assert.equal((await fetch(s2.url + `/api/runs/${id}`, { method: "DELETE" })).status, 200);
    assert.equal(existsSync(join(dir, "runs", `${id}.json`)), false);
  } finally {
    await s2.close();
  }
});

// A write through a temp file and a rename replaces the file's inode; writing in place (the old
// writeFileSync onto the live name, which a crash can leave truncated) keeps it.
test("[fast] settings, profiles and tombstones are replaced through a renamed temp file, created 0600, leaving no temp behind", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-atomic-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--port", "0", "--data", dir], {})));
  try {
    const profiles = asJson<ProfilesResponse>(await (await fetch(s2.url + "/api/profiles")).json()).profiles;
    const forget = () => fetch(s2.url + "/api/forget", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ root: 4660 }) });
    assert.equal((await forget()).status, 200);
    const files = [join(dir, "settings.json"), join(dir, "profiles.json"), join(dir, "scans", "_forget-1234.json")];
    const before = files.map((f) => statSync(f).ino);
    assert.equal((await fetch(s2.url + "/api/settings", { method: "PUT", headers: JSON_HEADERS, body: JSON.stringify({ setupDone: true }) })).status, 200);
    assert.equal((await fetch(s2.url + "/api/profiles", { method: "PUT", headers: JSON_HEADERS, body: JSON.stringify(profiles) })).status, 200);
    assert.equal((await forget()).status, 200);
    files.forEach((f, i) => {
      assert.notEqual(statSync(f).ino, before[i], `${f} was rewritten in place`);
      if (process.platform !== "win32") assert.equal(statSync(f).mode & 0o777, 0o600, f);
    });
    for (const d of [dir, join(dir, "scans")]) assert.deepEqual(readdirSync(d).filter((f) => f.endsWith(".new") || f.endsWith(".tmp")), [], d);
  } finally {
    await s2.close();
  }
});

test("[fast] a build that outlives the finished-job retention is not cancelled, and its result is kept for that long after it finishes", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-job-retention-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--demo", "--port", "0", "--data", dir], { PACKRAT_CORE: parkedCore(600) })),
    { jobTimings: { retentionMs: 300 } });
  try {
    const r = await fetch(s2.url + "/api/optimize", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ ...TINY_OPTIMIZE, opts: {} }) });
    const { id } = asJson<OptimizeJobResponse>(await r.json());
    const done = await pollJob(s2.url, id!, (s) => s.state !== "running");
    assert.equal(done.status, 200);
    assert.equal(done.state, "done", "a 600 ms build must not be cancelled by a 300 ms retention");
    await new Promise((res) => setTimeout(res, 100));
    assert.equal((await fetch(s2.url + `/api/optimize/${id}/status`)).status, 200, "still there shortly after it finished");
    const gone = await pollJob(s2.url, id!, (s) => s.status === 404, 3000);
    assert.equal(gone.status, 404, "dropped once the retention after finishing has passed");
  } finally {
    await s2.close();
  }
});

test("[fast] a build still running well past its own time budget is cancelled", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-job-ceiling-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--demo", "--port", "0", "--data", dir], { PACKRAT_CORE: parkedCore() })),
    { jobTimings: { runGraceMs: 100 } });
  try {
    const r = await fetch(s2.url + "/api/optimize", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ ...TINY_OPTIMIZE, opts: { timeBudgetMs: 100 } }) });
    const { id } = asJson<OptimizeJobResponse>(await r.json());
    const s = await pollJob(s2.url, id!, (x) => x.state !== "running", 3000);
    assert.equal(s.state, "cancelled");
  } finally {
    await s2.close();
  }
});

test("[fast] closing the server during a build logs no phantom job failure", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-close-job-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--demo", "--port", "0", "--data", dir], { PACKRAT_CORE: parkedCore() })));
  const r = await fetch(s2.url + "/api/optimize", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ ...TINY_OPTIMIZE, opts: {} }) });
  assert.equal(r.status, 200);
  await r.arrayBuffer();
  await new Promise((res) => setTimeout(res, 300));   // let the worker start and park
  await s2.close();
  await new Promise((res) => setTimeout(res, 300));   // the terminated worker's exit arrives after close()
  assert.doesNotMatch(logText(dir), /job /, "a quit mid-build is not an internal error");
});

test("[fast] POST /api/forget refuses a boolean, an unsafe integer and a serial past the scan contract's range", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-forget-root-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--port", "0", "--data", dir], {})));
  try {
    for (const bad of [true, 2 ** 60, "1e300", "0x10", 2 ** 32, " 7"]) {
      const r = await fetch(s2.url + "/api/forget", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ root: bad }) });
      assert.equal(r.status, 400, `root ${JSON.stringify(bad)} should be rejected`);
    }
    assert.equal(readdirSync(join(dir, "scans")).length, 0, "no tombstone was written");
    assert.doesNotMatch(logText(dir), /POST \/api\/forget|refusing/, "and nothing reached the 500 path");
    assert.equal((await fetch(s2.url + "/api/forget", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ root: "4660" }) })).status, 200, "a decimal string still works");
  } finally {
    await s2.close();
  }
});

test("[fast] GET /api/bridge/status: a status file cannot override the server's own ok/online/age", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-bridge-override-"));
  mkdirSync(join(dir, "bridge", "tazuo"), { recursive: true });
  writeFileSync(join(dir, "bridge", "tazuo", "status.json"), JSON.stringify({ alive: "2020-01-01T00:00:00Z", ok: false, online: true, age: 0, character: "Old" }));
  const s2 = await startServer(ensureLayout(resolveConfig(["--demo", "--port", "0", "--data", dir], {})));
  try {
    const st = asJson(await (await fetch(s2.url + "/api/bridge/status")).json());
    assert.equal(st.ok, true);
    assert.equal(st.online, false);
    assert.ok((st.age as number) > 1000, String(st.age));
    assert.equal(st.character, "Old", "the documented fields still come through");
  } finally {
    await s2.close();
  }
});

test("[fast] POST /api/optimize for a character with no scans is a 404 and saves nothing", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-optimize-nobody-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--demo", "--port", "0", "--data", dir], {})));
  try {
    const r = await fetch(s2.url + "/api/optimize", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ character: "Nobody", profile: TINY_OPTIMIZE.profile }) });
    assert.equal(r.status, 404);
    assert.match(asJson<ErrorBody>(await r.json()).error, /Nobody/);
    assert.deepEqual(readdirSync(join(dir, "runs")), []);
  } finally {
    await s2.close();
  }
});

test("[fast] a server that cannot bind its port starts no watcher and leaves the inbox alone", async () => {
  const blocker = http.createServer();
  await new Promise<void>((res) => blocker.listen(0, "127.0.0.1", res));
  const port = (blocker.address() as { port: number }).port;
  const dir = mkdtempSync(join(tmpdir(), "qm-port-taken-"));
  const cfg = ensureLayout(resolveConfig(["--port", String(port), "--data", dir], {}));
  const fixture = readdirSync(join(HERE, "fixtures")).find((f) => /^demo-.*\.json$/.test(f))!;
  cpSync(join(HERE, "fixtures", fixture), join(dir, "inbox", "tazuo", fixture));
  try {
    await assert.rejects(startServer(cfg), /EADDRINUSE/);
    await new Promise((res) => setTimeout(res, 100));
    assert.ok(existsSync(join(dir, "inbox", "tazuo", fixture)), "the drop is still waiting for the server that does start");
    assert.deepEqual(readdirSync(join(dir, "scans")), []);
  } finally {
    await new Promise((res) => blocker.close(res));
  }
});

test("[fast] POST /api/import/rescan recreates a deleted inbox, and reports a sweep that could not run", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-rescan-gone-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--port", "0", "--data", dir], {})));
  try {
    rmSync(join(dir, "inbox"), { recursive: true });
    const r = await fetch(s2.url + "/api/import/rescan", { method: "POST", headers: JSON_HEADERS, body: "{}" });
    assert.equal(r.status, 200);
    assert.ok(asJson<RescanResponse>(await r.json()).adapters.includes("tazuo"));
    assert.ok(existsSync(join(dir, "inbox", "tazuo")), "the inbox is back");

    rmSync(join(dir, "inbox"), { recursive: true });
    writeFileSync(join(dir, "inbox"), "a file where the inbox folder should be");
    const bad = await fetch(s2.url + "/api/import/rescan", { method: "POST", headers: JSON_HEADERS, body: "{}" });
    assert.equal(bad.status, 503);
    const body = asJson<ErrorBody & { failed: string[] }>(await bad.json());
    assert.ok(body.failed.includes("tazuo"), JSON.stringify(body));
    assert.match(body.error, /tazuo/);
  } finally {
    await s2.close();
  }
});

// The Inventory tab's column choice used to live in localStorage, which belongs to one origin; the
// desktop app serves the page from a new port on every launch, so the choice was gone at each start.
// It is kept in <data>/ui-prefs.json instead, and survives a server on another port.
test("[fast] GET/PUT /api/ui-prefs keeps the column choice across a restart on another port", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-uiprefs-"));
  const put = (url: string, body: unknown): Promise<Response> => fetch(url + "/api/ui-prefs", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const s1 = await startServer(ensureLayout(resolveConfig(["--port", "0", "--data", dir], {})));
  try {
    assert.deepEqual(asJson(await (await fetch(s1.url + "/api/ui-prefs")).json()), { ok: true, prefs: {} }, "nothing chosen yet");
    assert.equal((await put(s1.url, { cols: ["hci"] })).status, 200);
    const firstInode = statSync(join(dir, "ui-prefs.json")).ino;
    assert.equal((await put(s1.url, { cols: ["hci", "sk:magery", "strReq"] })).status, 200);
    assert.notEqual(statSync(join(dir, "ui-prefs.json")).ino, firstInode, "replaced through a renamed temp file, not rewritten in place");
    if (process.platform !== "win32") assert.equal(statSync(join(dir, "ui-prefs.json")).mode & 0o777, 0o600);
    for (const bad of [{ cols: "hci" }, { cols: [5] }, { cols: [""] }, { cols: ["x".repeat(65)] }, { cols: Array.from({ length: 201 }, (_, i) => `k${i}`) }]) {
      assert.equal((await put(s1.url, bad)).status, 400, `${JSON.stringify(bad).slice(0, 60)} should be refused`);
    }
  } finally {
    await s1.close();
  }
  const s2 = await startServer(ensureLayout(resolveConfig(["--port", "0", "--data", dir], {})));
  try {
    assert.notEqual(s2.url, s1.url);
    assert.deepEqual(asJson(await (await fetch(s2.url + "/api/ui-prefs")).json()), { ok: true, prefs: { cols: ["hci", "sk:magery", "strReq"] } });
  } finally {
    await s2.close();
  }
});

// The look (theme family, light/system/dark) and the pinned-collapsed sidebar are view choices like the
// columns, and live in the same file for the same reason: the desktop app's origin changes every launch.
// Each field is written only when valid, and a PUT of one field keeps the others.
test("[fast] PUT /api/ui-prefs keeps theme, appearance, sidebar, density, the column set version, the column widths and the sheet's properties, each checked, next to the columns", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-uiprefs-look-"));
  const put = (url: string, body: unknown): Promise<Response> => fetch(url + "/api/ui-prefs", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const s = await startServer(ensureLayout(resolveConfig(["--port", "0", "--data", dir], {})));
  try {
    assert.equal((await put(s.url, { cols: ["hci"] })).status, 200);
    assert.equal((await put(s.url, { appearance: "dark" })).status, 200);
    assert.equal((await put(s.url, { theme: "default", sidebar: "collapsed" })).status, 200);
    assert.equal((await put(s.url, { density: "regular" })).status, 200);
    assert.equal((await put(s.url, { cols: ["hci"], colsVersion: "2" })).status, 200);
    assert.equal((await put(s.url, { sheetProps: ["fc", "hitLifeLeech"] })).status, 200);
    assert.equal((await put(s.url, { colWidths: { location: 420, "sk:animal lore": 40 } })).status, 200);
    assert.deepEqual(asJson(await (await fetch(s.url + "/api/ui-prefs")).json()), { ok: true, prefs: { cols: ["hci"], sheetProps: ["fc", "hitLifeLeech"], colsVersion: "2", appearance: "dark", theme: "default", sidebar: "collapsed", density: "regular", colWidths: { location: 420, "sk:animal lore": 40 } } });
    for (const bad of [{ appearance: "sepia" }, { appearance: 1 }, { theme: "neon" }, { theme: "" }, { sidebar: "wide" }, { sidebar: true }, { density: "comfy" }, { colsVersion: 2 }, { colsVersion: "9" },
      { sheetProps: "fc" }, { sheetProps: [5] }, { colWidths: [300] }, { colWidths: { location: 39 } }, { colWidths: { location: 300.5 } }, { colWidths: { location: "300" } },
      { colWidths: Object.fromEntries(Array.from({ length: 201 }, (_, i) => [`c${i}`, 100])) }]) {
      assert.equal((await put(s.url, bad)).status, 400, `${JSON.stringify(bad).slice(0, 80)} should be refused`);
    }
    // A hand-edited file with a bad value reads as "never chosen" for that field only.
    writeFileSync(join(dir, "ui-prefs.json"), JSON.stringify({ cols: ["dci"], sheetProps: [1], appearance: "sepia", theme: "default", sidebar: 3, colWidths: { location: 9000 } }));
    assert.deepEqual(asJson(await (await fetch(s.url + "/api/ui-prefs")).json()), { ok: true, prefs: { cols: ["dci"], theme: "default" } });
  } finally {
    await s.close();
  }
});

// A deleted, renamed or transferred character used to keep its card and worn set in the inventory
// forever: the fold only drops what a newer scan of the same root or character replaces.
test("[fast] POST /api/forget-character drops the character, its worn set, backpack and bank, and a rescan brings it back", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-forgetchar-"));
  mkdirSync(join(dir, "scans"), { recursive: true });
  cpSync(join(HERE, "fixtures", "demo-Dorran.json"), join(dir, "scans", "demo-Dorran.json"));
  cpSync(join(HERE, "fixtures", "demo-Kestrel.json"), join(dir, "scans", "demo-Kestrel.json"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--port", "0", "--data", dir], {})));
  const forget = (body: unknown): Promise<Response> => fetch(s2.url + "/api/forget-character", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const inventory = async (): Promise<InventorySummary> => asJson<InventoryResponse>(await (await fetch(s2.url + "/api/inventory")).json()).inventory;
  try {
    const before = await inventory();
    assert.ok(before.characters.Dorran && (before.worn.Dorran as unknown[]).length > 0);
    for (const bad of [{}, { character: "" }, { character: 5 }, { character: "x".repeat(65) }, { character: "_vault" }]) {
      assert.equal((await forget(bad)).status, 400, `${JSON.stringify(bad)} should be refused`);
    }
    // No tombstone for a name the inventory has never had: one file per arbitrary name would pile up.
    assert.equal((await forget({ character: "Nobody" })).status, 404);
    assert.deepEqual(readdirSync(join(dir, "scans")).filter((f) => f.startsWith("_forget-char-")), [], "nothing was written for a refused name");
    assert.equal((await forget({ character: "Dorran" })).status, 200);
    const after = await inventory();
    assert.equal(after.characters.Dorran, undefined, "the character card is gone");
    assert.equal(after.worn.Dorran, undefined, "and its worn set");
    const dorranRoots = Object.values(after.containers).filter((c) => (c as { scannedBy?: string; kind?: string }).scannedBy === "Dorran" && ["backpack", "bank"].includes((c as { kind: string }).kind));
    assert.deepEqual(dorranRoots, [], "and its backpack and bank");
    assert.ok(after.characters.Kestrel, "another character is untouched");
    const tombs = readdirSync(join(dir, "scans")).filter((f) => f.startsWith("_forget-char-"));
    assert.equal(tombs.length, 1);
    assert.equal(validateScan(JSON.parse(readFileSync(join(dir, "scans", tombs[0]!), "utf8"))).ok, true, "the tombstone passes the scan contract");

    // A newer scan of the character brings it back.
    const rescan = JSON.parse(readFileSync(join(HERE, "fixtures", "demo-Dorran.json"), "utf8"));
    // A v1 scan's stamp is naive local time: an hour from now, in this machine's clock.
    const later = new Date(Date.now() + 3600_000), p2 = (n: number): string => String(n).padStart(2, "0");
    rescan.scannedAt = `${later.getFullYear()}-${p2(later.getMonth() + 1)}-${p2(later.getDate())}T${p2(later.getHours())}:${p2(later.getMinutes())}:${p2(later.getSeconds())}`;
    writeFileSync(join(dir, "scans", "demo-Dorran-later.json"), JSON.stringify(rescan));
    assert.ok((await inventory()).characters.Dorran, "rescanned, the character is back");
  } finally {
    await s2.close();
  }
});

test("[fast] POST /api/forget-character is refused under --demo", async () => {
  const r = await fetch(srv.url + "/api/forget-character", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ character: "Dorran" }) });
  assert.equal(r.status, 409);
});

// Issue #38: <data>/scan-blacklist.json, written by these routes and by the TazUO packrat-blacklist.py.
// Keep and Remove come from the fold's existing rules: a listed root is missing from newer scans (kept),
// a listed bag is recorded unopened (its contents kept), and Remove is Forget.
test("[fast] /api/blacklist adds, lists and removes a container, and Keep and Remove fall out of the fold", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-blacklist-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--port", "0", "--data", dir], {})));
  const file = join(dir, "scan-blacklist.json");
  const add = (body: unknown): Promise<Response> => fetch(s2.url + "/api/blacklist", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(body) });
  const list = async (): Promise<Array<Record<string, unknown>>> => asJson<{ containers: Array<Record<string, unknown>> }>(await (await fetch(s2.url + "/api/blacklist")).json()).containers;
  const items = async (): Promise<string[]> => Object.keys(asJson<{ items: Record<string, unknown> }>(await (await fetch(s2.url + "/api/items/by-serial?serials=4661,4672")).json()).items).sort();
  const scan = (name: string, at: number, roots: number[], containers: Record<string, unknown>, its: Array<[number, number]>): void => writeFileSync(join(dir, "scans", name), JSON.stringify({
    schemaVersion: 2, character: "Dorran", scannedAt: new Date(at).toISOString(), stats: {}, equipped: [],
    adapter: { id: "tazuo", version: "2.5.0", client: "TazUO", clientVersion: null, capabilities: { layers: [], arms: true, bank: true, ground: true, nested: true, tooltips: "opl", bridge: [] } },
    roots: roots.map((serial) => ({ serial, kind: "ground", name: "Chest", opened: true })), containers,
    items: its.map(([serial, container]) => ({ serial, container, name: "Ring", nameSource: "opl", tooltip: ["Ring"] })) }));
  const chest = (serial: number) => ({ serial, kind: "ground", name: "Chest", parent: null, root: serial });
  const bag = { serial: 4671, kind: "container", name: "Bag", parent: 4670, root: 4670 };
  mkdirSync(join(dir, "scans"), { recursive: true });
  // Before the blacklisting: a trash barrel (4660) with a ring, and a chest (4670) holding a bag with a ring.
  scan("before.json", Date.now() - 3600_000, [4660, 4670], { 4660: chest(4660), 4670: chest(4670), 4671: bag }, [[4661, 4660], [4672, 4671]]);
  try {
    for (const bad of [{ serial: 0, name: "x" }, { serial: "4660", name: "x" }, { serial: 1, name: 5 }]) {
      assert.equal((await add(bad)).status, 400, `${JSON.stringify(bad)} should be refused`);
    }
    assert.equal(existsSync(file), false, "nothing was written for a refused body");
    assert.equal((await add({ serial: 4660, name: "Trash Barrel".repeat(10), where: "1, 2" })).status, 200);
    assert.equal((await add({ serial: 4671, name: "Bag" })).status, 200);
    assert.equal((await add({ serial: 4660, name: "again" })).status, 200, "adding a listed container again changes nothing");
    const [entry] = await list();
    assert.equal((await list()).length, 2);
    assert.deepEqual([entry!.serial, (entry!.name as string).length, entry!.where], [4660, 64, "1, 2"]);
    // What a scanner honouring the list writes next: no 4660 root, the bag unopened. Keep keeps both rings.
    scan("after.json", Date.now() + 3600_000, [4670], { 4670: chest(4670), 4671: { ...bag, opened: false } }, []);
    assert.deepEqual(await items(), ["4661", "4672"]);
    assert.equal((await fetch(s2.url + "/api/forget", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ root: 4660 }) })).status, 200);
    assert.deepEqual(await items(), ["4672"], "Remove forgets the root");
    assert.equal((await fetch(s2.url + "/api/blacklist/4660", { method: "DELETE" })).status, 200);
    assert.deepEqual((await list()).map((e) => e.serial), [4671]);
    // A file that does not parse reads as empty; a bad entry is dropped and the good ones kept.
    for (const [doc, want] of [["{not json", []], [JSON.stringify([{ serial: -1, name: "x", addedAt: "y" }, { serial: 7, name: "ok", addedAt: "2026-09-24T10:00:00Z" }]), [7]]] as const) {
      writeFileSync(file, doc);
      assert.deepEqual((await list()).map((e) => e.serial), want);
    }
  } finally {
    await s2.close();
  }
});

// PACKRAT_CLIENT_HOME (what the Electron UI tests set) confines the client search to one folder: a client
// planted there is found, the machine's own home is never the search's home, and nothing is proposed from
// an environment folder or a fixed root.
test("[fast] PACKRAT_CLIENT_HOME confines the client search to that folder", () => {
  const home = mkdtempSync(join(tmpdir(), "qm-clienthome-"));
  const tazuo = { id: "tazuo", name: "TazUO", scripts: [], capabilities: {}, transport: "folder" as const, platform: null, summary: "" };
  try {
    const empty = defaultClientSearch({ PACKRAT_CLIENT_HOME: home, LOCALAPPDATA: join(home, "..") });
    assert.equal(empty.home, home);
    assert.deepEqual(empty.candidates(tazuo), [], "an empty home proposes nothing");
    const planted = join(home, "Desktop", "TazUO", "TazUO", "LegionScripts");
    mkdirSync(planted, { recursive: true });
    assert.deepEqual(defaultClientSearch({ PACKRAT_CLIENT_HOME: home }).candidates(tazuo), [planted]);
    assert.deepEqual(defaultClientSearch({ PACKRAT_CLIENT_HOME: home }).candidates({ ...tazuo, platform: process.platform === "win32" ? "linux" : "win32" }), [], "an adapter for another OS offers nothing");
    assert.notEqual(defaultClientSearch({}).home, home, "without it the search is the real home");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
