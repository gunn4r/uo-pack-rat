// server-routes-fixture.mts — test fixture for the route test files (app/server.test.mts and app/server-<family>.test.mts): the response shapes they read, asJson(), the shard's rules, and the helpers more than one of them uses (raw requests, an SSE reader, the demo fold, the log).
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";
import { foldSnapshots, type Item, type Inventory, type Template } from "./vault-lib.mts";
import { templateSettings, type ProfilesV3, type TemplateMap } from "./build-spec.mts";
import { upgradeScan, validateScan } from "./scan-schema.mts";
import type { RulesV1, ScanV2 } from "./schema/types.d.mts";
import type { AdapterInfo, DataDirCheck } from "./installer.mts";

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
export function asJson<T = Record<string, unknown>>(body: unknown): T {
  return body as T;
}

export interface InventoryFacets {
  kinds: unknown[];
  gearSkills: string[];
  flagKeys: string[];
  weaponSkills: Array<{ name: string; count: number }>;
  propKeys?: string[];
  [key: string]: unknown;
}

export interface InventorySummary {
  itemCount: number;
  items?: undefined;
  facets: InventoryFacets;
  worn: Record<string, unknown>;
  containers: Record<string, unknown>;
  rootCounts: Record<string, unknown>;
  missingCounts: Record<string, number>;
  characters: Record<string, Record<string, unknown>>;
  propKeys: string[];
}

export interface InventoryResponse {
  ok: boolean;
  snapshotCount: number;
  scansDir?: string;
  inventory: InventorySummary;
}

export interface ProfilesResponse {
  ok?: boolean;
  profiles: ProfilesV3;
  builtinTemplates: TemplateMap;
}
// The first built-in template's settings (a fresh data folder has no templates of its own), as a build's profile.
export const firstTemplate = (r: ProfilesResponse): Template => templateSettings(Object.values(r.builtinTemplates)[0]!);

export interface RulesResponse {
  ok: boolean;
  shard: string;
  rules: RulesV1;
  available: Array<{ id: string; name: string; source: string }>;
  fallback: boolean;
}

export interface ClientSetting { adapter: string; scriptsDir: string; }

export interface SettingsResponse {
  ok?: boolean;
  settings: { shard: string; setupDone?: boolean; client?: ClientSetting; autoUpdateCheck?: boolean };
}

export interface SetupAdapter extends Omit<AdapterInfo, "capabilities"> {
  capabilities: { bridge: string[]; [key: string]: unknown };
}

export interface SetupResponse {
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

export interface ItemsPageResponse {
  ok: boolean;
  rows?: Item[];
  groups?: unknown[];
  total: number;
  stacks?: number;
  pieces?: number;
  limit?: number;
}

export interface ItemsBySerialResponse {
  ok: boolean;
  items: Record<string, Item>;
}

// Covers both a POST /api/optimize start response and a GET /api/optimize/<id>/status poll —
// several tests reassign one `status` variable across both shapes as a job runs to completion
// (see vault-server.mts's own POST /api/optimize and jobSnapshot() response literals).
export interface OptimizeJobResponse {
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

// assert.match/doesNotMatch need a real string, not `unknown` — every 4xx/5xx body this file checks
// with a regex against .error gets this cast instead of Record<string, unknown>'s default.
export interface ErrorBody {
  error: string;
  ref?: string;
}

export const HERE = dirname(fileURLToPath(import.meta.url));

// A direct call here to a rules-aware function (buildPools) needs setRules() before any server
// has started. A server sets the same, process-wide vault-lib's rules to its shard's, so a test whose
// server switched shards would leave them behind for every later test and the shared `srv`: put
// them back after each test.
export const UOALIVE = JSON.parse(readFileSync(join(HERE, "rules", "uoalive.json"), "utf8")) as RulesV1;

// Since Task 5, GET /api/inventory never carries the full item map (the page pages GET /api/items
// instead), so a test that wants to run buildPools() itself — to check the server's by-character
// /api/optimize form against a client-equivalent call — has to fold the same scan files the server
// folds, the same way the server's own readScans()+getInventory() do (upgrade, validate, skip a bad
// file rather than throw), instead of reading the (now slimmer) HTTP response.
export function foldFixtures(dir: string, shard = "uoalive"): Inventory {
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
export interface RawResponse {
  status: number | undefined;
  headers: http.IncomingHttpHeaders;
  text: string;
  json: () => unknown;
}

export interface RawReqOptions {
  method?: string;
  headers?: http.OutgoingHttpHeaders;
  body?: string;
}

export function rawReq(url: string, { method = "GET", headers = {}, body }: RawReqOptions = {}): Promise<RawResponse> {
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
export interface SseReaderHandle {
  readUntil: (matcher: (buf: string) => boolean, opts?: { timeoutMs?: number }) => Promise<string>;
  cancel: () => Promise<void>;
}

export function sseReader(response: Response): SseReaderHandle {
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

// ---- issue #18: server durability ------------------------------------------------------------------

export const JSON_HEADERS = { "content-type": "application/json" };

export const logText = (dir: string): string => existsSync(join(dir, "logs", "server.log")) ? readFileSync(join(dir, "logs", "server.log"), "utf8") : "";
