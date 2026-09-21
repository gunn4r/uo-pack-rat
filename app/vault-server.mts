// vault-server.mts — Pack Rat local server. Zero dependencies.
//   node app/vault-server.mts [--data <dir>] [--port N] [--demo] [--open]
// Exports startServer(config) → { server, port, url, close() } — nothing runs at import time, so a
// test (or another launcher) can start and stop as many independent instances as it likes. The file
// also self-starts when run directly (node app/vault-server.mts / node scripts/start.mjs).
// Routes: GET /  (index.html) · GET /vault-lib.mjs · GET /item-query.mjs (pure filter/sort/facet logic
//         shared by the browser and GET /api/items below — no DOM, no node: imports, servable byte for
//         byte like vault-lib.mjs) · GET /scan-schema.mjs (vault-lib.mjs imports it for parseStamp, so
//         it must be servable to the browser the same way) ·
//         GET /schema/validate.mjs (scan-schema.mjs's own import, same reason) ·
//         GET /ui/<name> (name matching /^[a-z0-9-]+\.(mjs|css)$/, served from app/ui/, else 404) ·
//         GET /api/inventory (the cached fold of every scan — getInventory(), keyed by a signature of
//         the scans directory + shard + vault-lib.mjs mtime, so an edited/added/removed scan file is
//         picked up on the next request with no restart; each scan file is upgraded v1→v2 and schema-
//         validated on read — readScans() — an invalid or unparsable file is logged and skipped) — the
//         response carries facets/worn/rootCounts/itemCount/propKeys — never the full item map
//         (that stopped shipping in Task 5, once the page moved to paging GET /api/items instead)
//         GET /api/items?q=&slot=&loc=&rarity=&kind=&seenDays=&slayer=&nogarg=&med=&hide=&prop=&group=
//         &sort=&dir=&offset=&limit= — a paged, server-side search/sort over the same folded inventory
//         (parseItemQuery/applyItemQuery, app/item-query.mjs) ·
//         GET /api/items/by-serial?serials=1,2,3 — full item records (location/tags/equippedBy…) by
//         serial, 1-200 at a time (400 otherwise); a serial with no item is simply absent from the
//         response · GET|PUT /api/profiles (<data>/profiles.json)
//         GET|PUT /api/settings (<data>/settings.json: {shard, setupDone?, client?}) · GET /api/rules (the current shard's
//         rules object plus every {id,name,source} listRules() finds — builtin and <data>/rules/*.json)
//         POST /api/optimize {pools,current,profile,opts} -> {id}, or {character,settings,profile,opts}
//         to have the server build the pools itself (buildPools, per-slot lockedSlots/blocked handling —
//         see the route below); either form's response carries poolSize/skipped/current/blocked/warning?
//         GET /api/optimize/<id>/events (SSE: hello, progress, done|failed|cancelled) ·
//         POST /api/optimize/<id>/cancel · GET /api/optimize/<id>/status
//         A request whose inputs match a saved run that cannot be bettered returns {cached: true, run} at once.
//         GET /api/runs?character= (saved runs, newest first) · GET|PUT {label}|DELETE /api/runs/<id>
//         POST /api/forget {root} (drop a container from the inventory: writes a tombstone scan;
//         409 under --demo, which must never write into the committed app/fixtures/)
//         POST /api/bridge {action, serial, name, chain: [root…parent], pos|null} (queue for packrat-bridge.py) · GET /api/bridge/status
//         GET /api/events — SSE, one stream shared by every connected client (not per-job like the
//         optimize events above): hello {ok, watching: [adapter ids]} on connect, inventory
//         {file, character, scannedAt, at} once an inbox file is accepted into paths.scans, rejected
//         {file, reason, at} once one is moved to its adapter's rejected/ folder, ping every 15s. A
//         normal token-protected /api/* route (no SSE exemption — unlike /api/optimize/<id>/events,
//         this stream carries no per-job secret an EventSource couldn't send anyway). Non-demo mode
//         starts one app/watcher.mts per adapters/<id>/ directory that ships a capabilities.json
//         (today: tazuo), watching paths.inboxFor(id) and normalising accepted files into
//         paths.scans; --demo starts none (paths.scans there is the committed app/fixtures/, which
//         must never be written to).
//         Setup wizard (app/installer.mts backs all of these): GET /api/setup {firstRun, settings,
//         adapters, candidates, installed, available, dataDir} · POST /api/setup/locate {adapter, dir}
//         · POST /api/setup/install {adapter, scriptsDir} (409 while a Legion script is running in the
//         client, per installer.mts's bridge-status guard) · POST /api/import {dir, adapter?} (copies
//         top-level *.json into an adapter's inbox, tazuo when adapter is omitted — the watcher above
//         does the rest) · POST /api/import/paste {text, adapter} (app/import.mts's parsePastedScan:
//         what the ClassicUO web-client scanner prints, marker block or bare JSON, upgraded/validated
//         and written straight into that adapter's inbox — for a client whose sandbox can't write
//         files at all) · POST /api/import/rescan {} (scanOnce() on every running watcher, for a scan
//         file the folder watcher missed; {adapters: [ids swept]}, empty under --demo) ·
//         GET /api/update-check (a GitHub releases/latest check; {configured: false} when package.json
//         names no GitHub repo) ·
//         POST /api/host/pick-folder {title} and POST /api/host/open-path {which: "data"|"logs"} — both
//         need the optional `host` startServer({..}, {host}) was given (a folder-picker/opener the
//         Electron shell supplies); 501 on the bare server. GET/PUT /api/settings additionally carries
//         setupDone and client ({adapter, scriptsDir} | null).
// Every text/html response carries the Content-Security-Policy below; every response carries
// x-content-type-options: nosniff. Any PUT/POST whose body is read must declare content-type:
// application/json, else 415 (readBody()) — the SSE cancel beacon sends no body, so it's exempt.
// The optimizer is scripts/optimizer-core.mts, run straight from source (no build step) — every
// caller imports it from the one path config.mts's paths.core/corePath() resolves (PACKRAT_CORE
// overrides it).
// Localhost security (CONTRIBUTING.md's Security section has the full writeup): every request's
// Host must name this server and its Origin (if any) must match, or 403; with CONFIG.token set,
// every /api/* route but the SSE events stream needs `Authorization: Bearer <token>`, or 401 — the
// bare `node app/vault-server.mts` path runs with no token at all. PUT /api/profiles is capped at 1 MB
// and schema-checked (app/schema/profiles.v2.schema.json). One running optimize job per X-Client-Id
// (a second POST cancels the first and reports {superseded}); job ids are crypto.randomUUID() and the
// events route checks the job's own id against a ?client= query param instead of the token. A route
// that throws returns {error:"internal error", ref} with the stack only in CONFIG.paths.log, keyed by ref.

import http from "node:http";
import { readFileSync, writeFileSync, appendFileSync, readdirSync, existsSync, mkdirSync, copyFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import { statSync, type Stats } from "node:fs";
import { Worker } from "node:worker_threads";
import { unlinkSync } from "node:fs";
import { randomUUID, timingSafeEqual } from "node:crypto";
import type { AddressInfo } from "node:net";
import { runKey, reusableRun, runSummary, stripOpts, normalizeRun, type RunOpts, type SavedRun } from "./runs-lib.mts";
import { upgradeScan, validateScan } from "./scan-schema.mts";
import { loadRules, listRules, DEFAULT_SHARD } from "./rules.mts";
import { validate, type ValidatorSchema } from "./schema/validate.mts";
import { parseItemQuery, applyItemQuery, facetsOf, type ItemQueryRows, type ItemQueryGroups } from "./item-query.mts";
import { DEFAULT_OPTIONAL_SLOTS } from "./mip.mts";
import { startWatcher, type StartWatcherOptions, type WatcherHandle } from "./watcher.mts";
import { parsePastedScan, writeScanToInbox } from "./import.mts";
import {
  listAdapters, candidateClientRoots, validateScriptsDir, installedVersion, installScripts,
  importScans, repoFromPackage, checkForUpdates,
} from "./installer.mts";
import { homedir } from "node:os";

import { resolveConfig, ensureLayout, APP_DIR, type Config } from "./config.mts";
import type { Item, Inventory, ProfilesFile } from "./vault-lib.mts";
import type * as VaultLib from "./vault-lib.mts";
import type { ScanV2, RulesV1 } from "./schema/types.d.mts";
import type { WorkerMessage, WorkerDoneMessage } from "./optimize-worker.mts";
import type { OptResult, ExactSolveResult, SolveProgress } from "./exact-solver.mts";
const HERE = APP_DIR;
// package.json content, handed to us already-parsed — the only fields this file reads off it
// (version, repository) are trusted the same way installer.mts's repoFromPackage trusts its own
// `pkg: unknown` parameter; this cast is the boundary.
const PACKAGE_JSON = JSON.parse(readFileSync(join(HERE, "..", "package.json"), "utf8")) as { version: string; repository?: unknown };
// The page is served from app/dist/, never from the source tree: app/ui/*.mts and the shared
// modules are TypeScript, which no browser can parse. `npm run build:ui` (tsc -p
// tsconfig.browser.json) emits a .mjs for each of them here, rewriting every ./x.mts specifier to
// ./x.mjs on the way out, so the URLs the page fetches are exactly the ones it fetched before.
const WEB = join(HERE, "dist");

// Global Constraints CSP: no inline/external script beyond same-origin, no framing, no form posts
// off-page. Applied to every text/html response; every response also gets nosniff.
const CSP = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; font-src 'self'; base-uri 'none'; form-action 'none'";
const UI_NAME_RE = /^[a-z0-9-]+\.(mjs|css)$/;
// Localhost security (spec §4.5): a request's Host must name this server, an Origin (when present)
// must be this same origin, and — with a token configured — every /api/* route except the SSE
// events stream (EventSource cannot carry an Authorization header; see below) must present it. None
// of this applies to the bare `node app/vault-server.mts` path, which runs with CONFIG.token null.
const PROFILES_SCHEMA = JSON.parse(readFileSync(join(HERE, "schema", "profiles.v2.schema.json"), "utf8")) as ValidatorSchema;
const BRIDGE_SCHEMA = JSON.parse(readFileSync(join(HERE, "schema", "bridge.v1.schema.json"), "utf8")) as { command: ValidatorSchema; result: ValidatorSchema; status: ValidatorSchema };
const EVENTS_ROUTE_RE = /^\/api\/optimize\/[\w-]+\/events$/;

// Errors readBody() throws carry a statusCode the top-level route handler reads off them — the
// same shape installer.mts's own thrown errors describe with an inline cast at each read site;
// here the shape recurs often enough (readBody, the top-level catch) to name once.
interface HttpError extends Error {
  statusCode?: number;
}

function send(res: http.ServerResponse, status: number, body: unknown, type = "application/json"): void {
  // Every non-JSON caller passes an already-read string (readFileSync's result) — the cast is
  // compiler-only, matching config.mts's rawPort pattern.
  const data = type === "application/json" ? JSON.stringify(body) : (body as string);
  const headers: Record<string, string> = { "content-type": type + "; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" };
  if (type === "text/html") headers["content-security-policy"] = CSP;
  res.writeHead(status, headers);
  res.end(data);
}

interface ReadBodyOptions {
  limit?: number;
  tooLargeMsg?: string;
}

// limit defaults to 50 MB (the prior, unnamed global cap); a route can pass a tighter one (profiles:
// 1 MB) plus its own message for the 413. The cap is checked on every chunk (not content-length, so
// a lying client can't just skip the check) — once tripped, the rest of the body is drained and no
// further chunks are appended, so a huge rejected upload doesn't keep growing an already-doomed buffer.
// The cap counts BYTES, not JS string length (post-review fix): req emits raw Buffer chunks (no
// req.setEncoding() call anywhere in this file), and a Buffer's .length is already byte length, so
// summing chunk.length is exact regardless of encoding — the earlier version concatenated chunks into
// a JS string first (`buf += c`), which measured UTF-16 code-unit length; multi-byte UTF-8 (even a
// plain "é", 2 bytes/1 code unit) could then smuggle up to ~2x the intended byte limit past the check.
// The resolved body is `unknown` provenance (an HTTP request from any caller, trusted or not) — every
// route below narrows the fields it actually reads, per the route's own pre-existing checks.
function readBody(req: http.IncomingMessage, { limit = 50e6, tooLargeMsg = "body too large" }: ReadBodyOptions = {}): Promise<unknown> {
  return new Promise((resolve, reject) => {
    // Global Constraint (spec §4.5): a PUT/POST must declare a JSON body. The SSE cancel beacon
    // (navigator.sendBeacon, no body) never calls readBody, so it's naturally exempt.
    if ((req.method === "PUT" || req.method === "POST") && !String(req.headers["content-type"] || "").startsWith("application/json")) {
      req.resume();   // drain the body instead of leaving it unread — else a large rejected body can
                       // surface to the client as a connection error rather than the clean 415 below.
      const e = new Error("content-type must be application/json") as HttpError;
      e.statusCode = 415;
      return reject(e);
    }
    const chunks: Buffer[] = [];
    let bytes = 0, tooLarge = false;
    req.on("data", (c: Buffer) => {
      if (tooLarge) return;
      bytes += c.length;   // c is a Buffer — .length is bytes, not decoded characters
      if (bytes > limit) {
        tooLarge = true;
        const e = new Error(tooLargeMsg) as HttpError;
        e.statusCode = 413;
        reject(e);
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      if (tooLarge) return;
      try { const buf = Buffer.concat(chunks); resolve(buf.length ? JSON.parse(buf.toString("utf8")) : {}); }
      catch (e) { reject(e); }
    });
    req.on("error", reject);
  });
}

// Every log append in this file goes through here rather than a bare appendFileSync (post-review
// fix, Important 1): a deleted logs/ dir (the Settings tab's own "Open" button shows the user right
// where to find it) or a full disk must never throw out of a log call — ingestFile's and enqueue's
// "never throws" contracts (app/watcher.mts) depend on it, and an uncaught throw from inside a
// route's own catch block (the 500-handler's log line) would otherwise escape as an unhandled
// rejection and take the whole process down. Best-effort: on failure, fall back to console.error
// once for that line and move on; mkdirSync(recursive) re-creates the logs dir lazily if it vanished
// under a running server, since recreating an already-existing dir is a no-op.
function safeAppendLog(file: string, line: string): void {
  try {
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, line);
  } catch (e) {
    console.error(`log write failed (${file}): ${e && (e as Error).message}`);
  }
}

// What only a real desktop shell (Electron) can supply to startServer — see the `host` parameter
// note below. Neither method's argument/return shape is validated by this file (title is read
// straight off a request body with no check; the caller — electron/server-entry.mjs's own `host`
// object — is the only implementation), so `title` is `unknown`, not `string`, matching the "stays
// unknown until checked" rule for anything that crosses the HTTP boundary.
export interface HostBridge {
  pickFolder?: ((opts: { title?: unknown }) => Promise<string | null>) | undefined;
  openPath?: ((path: string) => Promise<void>) | undefined;
}

export interface StartServerOptions {
  host?: HostBridge | undefined;
  watcherOptions?: Partial<StartWatcherOptions> | undefined;
}

export interface ServerHandle {
  server: http.Server;
  port: number;
  url: string;
  close: () => Promise<void>;
}

// startServer binds one HTTP server to config.port (0 = OS-assigned) and returns a handle for
// tests and launchers alike: { server, port, url, close() }. Nothing runs at import time — every
// config-derived path, the optimizer core, and the route handler live inside this function so a
// test can spin up (and tear down) as many independent instances as it likes.
// `host` is what only a real desktop shell (Electron) can supply: { pickFolder({title}) ->
// Promise<string|null>, openPath(path) -> Promise<void> }. Without it, POST /api/host/* answers 501
// ("not available outside the desktop app") rather than throwing — the bare `node app/vault-server.mts`
// / test-harness path never has a folder picker or an OS file-opener to call.
// `watcherOptions` is passed straight through to every app/watcher.mts startWatcher() call below —
// nothing outside tests should ever set it, since the defaults (debounceMs/retries/retryDelayMs) are
// real product behavior. It exists so a test that wants to observe a reject-after-retries cycle over
// SSE doesn't have to wait out the real debounce + backoff (300ms + 2×700ms = 1700ms of production
// timing) inside a fixed-timeout SSE read — app/watcher.test.mts already shortens these same knobs
// (debounceMs:20, retryDelayMs:20) when calling startWatcher() directly; this gives app/server.test.mjs
// the same lever for the route-level equivalent instead of relying on a wide timeout margin to absorb
// real wall-clock retry delay plus whatever scheduling/fs-watch jitter a loaded machine adds on top.
export async function startServer(config: Config = ensureLayout(resolveConfig()), { host, watcherOptions = {} }: StartServerOptions = {}): Promise<ServerHandle> {
  const CONFIG = config;
  const SCANS = CONFIG.paths.scans, PROFILES = CONFIG.paths.profiles, DEFAULT_PROFILES = CONFIG.paths.defaultProfiles;
  const RUNS = CONFIG.paths.runs, SETTINGS = CONFIG.paths.settings, USER_RULES_DIR = CONFIG.paths.rules;
  // Sibling of app/ at the repo root by default — each adapters/<id>/ directory that ships a
  // capabilities.json is one adapter the non-demo server watches an inbox for (today: three —
  // adapters/tazuo/, adapters/razor-enhanced/, and adapters/classicuo-web/, the last of which never
  // has anything to watch since its "paste" transport writes into the inbox only via POST
  // /api/import/paste, never a folder drop). Overridable (config.mts's --adapters/PACKRAT_ADAPTERS_DIR)
  // so a test can point a real running server at a throwaway folder of fixture adapters instead of the
  // repo's real ones.
  const ADAPTERS_DIR = CONFIG.paths.adaptersDir || join(HERE, "..", "adapters");

  // No build step — CONFIG.paths.core resolves straight to scripts/optimizer-core.mts (or wherever
  // PACKRAT_CORE points); each optimize-worker.mts thread imports it by URL for its own copy. The main
  // thread never imports it itself — every optimizeSuit/scoreSet call (heuristic or, since HiGHS,
  // exact) happens inside that one worker (app/exact-solver.mts).
  if (!existsSync(CONFIG.paths.core)) throw new Error(`optimizer core not found at ${CONFIG.paths.core} — check PACKRAT_CORE, or that the repo checkout has scripts/optimizer-core.mts`);
  const CORE_URL = pathToFileURL(CONFIG.paths.core).href;

  // settings.json is user-editable, on-disk data with no schema check at read time (PUT /api/settings
  // below validates each field it writes; a hand-edited file is trusted here the same way profiles.json
  // is in readProfiles) — the cast documents that trust boundary, same pattern as rules.mts's loadFile.
  interface ClientSettings { adapter: string; scriptsDir: string; }
  interface SettingsDoc {
    schemaVersion?: number;
    shard: string;
    setupDone?: boolean;
    client?: ClientSettings | null;
    [key: string]: unknown;
  }
  // The shard picker: <data>/settings.json ({schemaVersion, shard}) names which app/rules/<shard>.json
  // (or <data>/rules/<shard>.json override) is currently active. ensureLayout() already wrote a default
  // settings.json if none existed, so this file exists by the time startServer runs.
  let currentSettings = (existsSync(SETTINGS) ? JSON.parse(readFileSync(SETTINGS, "utf8")) : { schemaVersion: 1, shard: DEFAULT_SHARD }) as SettingsDoc;
  // Which adapter's bridge the page-facing bridge routes (POST /api/bridge, GET /api/bridge/status)
  // talk to — the currently CONFIGURED client, re-read live off currentSettings on every call rather
  // than captured once at startup, so a client switch (a fresh install, or "Run setup again") takes
  // effect on the very next request with no restart. Falls back to DEFAULT_BRIDGE_ADAPTER when no
  // client is configured at all, matching this route's own pre-existing behavior before it became
  // per-adapter (Phase 6 final review follow-up). GET /api/setup below reports this exact same id back
  // to the page as `bridgeAdapter` (guarded there against a discovered-adapters list that doesn't
  // actually contain it — a throwaway test fixture dir, say) so app/ui/bridge.mjs's currentAdapter()
  // can show the Highlight/Grab/Go-to buttons for an unconfigured/hand-installed player against the
  // SAME adapter this function is already routing their commands to, rather than the page guessing
  // "tazuo" independently and risking the two disagreeing.
  const DEFAULT_BRIDGE_ADAPTER = "tazuo";
  const bridgeAdapter = (): string => currentSettings.client?.adapter || DEFAULT_BRIDGE_ADAPTER;
  // The app must never fail to start because settings.json names a shard that no longer loads (its
  // rules file was deleted, edited into invalid shape, or never existed — e.g. a stale user override).
  // Fall back to DEFAULT_SHARD IN MEMORY ONLY: settings.json itself is left untouched, so fixing the
  // named shard's rules file and restarting picks the original choice back up. GET /api/rules reports
  // this as `fallback: true` so the page can tell the user rather than silently serving a different
  // shard than settings.json names.
  let currentRules: RulesV1, rulesFallback = false;
  try {
    currentRules = loadRules(currentSettings.shard, { userRulesDir: USER_RULES_DIR });
  } catch (e) {
    const msg = `settings.json names shard "${currentSettings.shard}", which failed to load (${(e as Error).message}); falling back to "${DEFAULT_SHARD}" for this run — settings.json is unchanged`;
    console.warn(msg);
    safeAppendLog(CONFIG.paths.log, `${new Date().toISOString()} startup-fallback ${msg}\n`);
    currentRules = loadRules(DEFAULT_SHARD, { userRulesDir: USER_RULES_DIR });
    currentSettings = { ...currentSettings, shard: DEFAULT_SHARD };
    rulesFallback = true;
  }

  // ---- /api/events: one shared SSE stream, fed by one app/watcher.mts per adapter ------------------
  // Non-demo only — --demo's paths.scans is the committed app/fixtures/, which a watcher must never
  // write into. Each adapter is a directory under adapters/ that ships a capabilities.json; today
  // that's just adapters/tazuo/. watchers: id -> {close(), scanOnce()}; eventClients: every response
  // currently attached to GET /api/events, so a later accept/reject can broadcast to all of them.
  const watchers = new Map<string, WatcherHandle>();
  const eventClients = new Set<http.ServerResponse>();
  function broadcastEvent(event: string, data: unknown): void { for (const c of eventClients) sse(c, event, data); }
  if (!CONFIG.demo) {
    let adapterIds: string[] = [];
    try {
      adapterIds = readdirSync(ADAPTERS_DIR, { withFileTypes: true })
        .filter((d) => d.isDirectory() && existsSync(join(ADAPTERS_DIR, d.name, "capabilities.json")))
        .map((d) => d.name)
        .sort();
    } catch { /* no adapters/ directory at all — nothing to watch */ }
    for (const id of adapterIds) {
      const handle = startWatcher({
        // getShard reads currentSettings.shard live, per ingest — not captured once here — so a
        // PUT /api/settings shard switch takes effect on the very next dropped file (app/watcher.mts).
        inboxDir: CONFIG.paths.inboxFor(id), adapter: id, scansDir: SCANS, getShard: () => currentSettings.shard,
        log: (msg) => safeAppendLog(CONFIG.paths.log, `${new Date().toISOString()} watcher[${id}] ${msg}\n`),
        onAccepted: ({ file, character, scannedAt }) => broadcastEvent("inventory", { file, character, scannedAt, at: Date.now() }),
        onRejected: ({ file, reason }) => broadcastEvent("rejected", { file, reason, at: Date.now() }),
        ...watcherOptions,
      });
      watchers.set(id, handle);
    }
  }

  // vault-lib.mjs is re-imported whenever its mtime changes, so edits to the parser/fold take effect on
  // the next request without restarting the server (ES module cache is keyed by URL: bust with the mtime).
  // Every access also (re-)applies the current shard's rules, since a fresh import starts with none loaded.
  let libCache: { mtime: number; mod: typeof VaultLib | null } = { mtime: 0, mod: null };
  async function lib(): Promise<typeof VaultLib> {
    const mtime = statSync(join(HERE, "vault-lib.mts")).mtimeMs;
    if (!libCache.mod || libCache.mtime !== mtime) libCache = { mtime, mod: (await import(pathToFileURL(join(HERE, "vault-lib.mts")).href + "?v=" + mtime)) as typeof VaultLib };
    // Either branch above leaves libCache.mod non-null (the condition's own falsy check, or the cast
    // just assigned above) — the assertions name that invariant.
    libCache.mod!.setRules(currentRules);
    return libCache.mod!;
  }

  // Every scan file on disk is v1 or v2; upgradeScan() normalizes either to v2 and validateScan()
  // checks the result against the contract before it ever reaches foldSnapshots (which now requires
  // v2 and throws otherwise). A file that doesn't parse, doesn't upgrade (neither v1 nor v2 shaped)
  // or fails validation is logged and skipped — never thrown, so one bad scan can't take the whole
  // inventory down.
  function readScans(): ScanV2[] {
    if (!existsSync(SCANS)) return [];
    const out: ScanV2[] = [];
    for (const f of readdirSync(SCANS).filter((f) => f.endsWith(".json")).sort()) {
      try {
        const raw: unknown = JSON.parse(readFileSync(join(SCANS, f), "utf8"));
        const doc = upgradeScan(raw, { shard: currentSettings.shard });
        const { ok, errors } = validateScan(doc);
        if (!ok) { console.warn(`skipping ${f}: ${errors.map((e) => `${e.path} ${e.msg}`).join("; ")}`); continue; }
        // doc passed validateScan — this is the one place a v2-shaped document earns the ScanV2 cast
        // (the ScanV2 rule: upgradeScan alone only proves UnvalidatedScan).
        out.push(doc as ScanV2);
      } catch (e) { console.warn(`skipping ${f}: ${(e as Error).message}`); }
    }
    return out;
  }

  // getInventory() caches the fold (readScans + foldSnapshots) — the expensive part of every route that
  // needs the inventory — keyed by a signature of the scans directory (every *.json file's name, mtimeMs
  // and size, so an add/edit/delete/rename is caught with no restart), the current shard id (a shard
  // switch changes parseTooltip/classify via rules) and vault-lib.mjs's own mtime (the same value lib()
  // already tracks for its dev-reload). /api/forget's tombstone is just another file landing in the scans
  // directory, so it invalidates the cache the same way — no separate invalidation path needed.
  let invCache: { sig: string | null; value: { inv: Inventory; snapshotCount: number; stamp: string } | null } = { sig: null, value: null };
  function scansSignature(): string {
    if (!existsSync(SCANS)) return "no-scans-dir";
    return readdirSync(SCANS).filter((f) => f.endsWith(".json")).sort()
      .map((f) => { const st = statSync(join(SCANS, f)); return `${f}:${st.mtimeMs}:${st.size}`; }).join("|");
  }
  async function getInventory(): Promise<{ inv: Inventory; snapshotCount: number; stamp: string }> {
    const libMod = await lib();   // also refreshes libCache.mtime, which the signature below reads
    const sig = `${scansSignature()}::${currentSettings.shard}::${libCache.mtime}`;
    if (invCache.sig === sig) return invCache.value!;   // sig and value are only ever set together, below
    const snaps = readScans();
    const value = { inv: libMod.foldSnapshots(snaps), snapshotCount: snaps.length, stamp: sig };
    invCache = { sig, value };
    return value;
  }

  // Seeds profiles.json from the default on first run and migrates an old-shape file (archetypes → templates) in
  // place, keeping the pre-migration file once as profiles.backup-<date>.json next to it.
  async function readProfiles(): Promise<ProfilesFile> {
    if (!existsSync(PROFILES)) {
      mkdirSync(dirname(PROFILES), { recursive: true });
      writeFileSync(PROFILES, readFileSync(DEFAULT_PROFILES, "utf8"));
    }
    // profiles.json is trusted, unvalidated file content at this point (the same trust readRules'
    // loadFile and readScans' upgradeScan extend to their own on-disk inputs) — migrateProfiles' own
    // loose ProfilesFile shape (every field optional) is what actually tolerates a malformed file.
    const { profiles, changed } = (await lib()).migrateProfiles(JSON.parse(readFileSync(PROFILES, "utf8")) as ProfilesFile);
    if (changed) {
      const backup = join(dirname(PROFILES), `profiles.backup-${new Date().toISOString().slice(0, 10)}.json`);
      if (!existsSync(backup)) copyFileSync(PROFILES, backup);
      writeFileSync(PROFILES, JSON.stringify(profiles, null, 2) + "\n");
    }
    return profiles;
  }

  // ---- optimizer jobs: one worker thread per build, progress over Server-Sent Events -----------
  // A job keeps its last progress snapshot and its final result, so a page that reconnects (or
  // reloads) can catch up. Cancel = terminate the worker. Finished jobs are dropped after a while.
  // An exact build (opts.exact) runs entirely inside that one worker: app/exact-solver.mts hands the
  // problem to HiGHS, which explores the tree itself — there is nothing left to split across a
  // thread pool, so (unlike the pre-HiGHS branch-and-bound) this is always exactly one worker per job.
  //
  // input.pools/current/profile stay `unknown` all the way through a job's life, same as the request
  // body they came from — runKey (runs-lib.mts) and the Worker constructor's own workerData option
  // (typed `any` by @types/node) are the only two places that ever touch them, and neither requires a
  // narrower type. meta is the caller's own free-form bookkeeping object (poolSize/skipped/character/
  // settings/warning are added to it by this file; nothing beyond that is read off it besides what a
  // caller chooses to stash there, e.g. a saved run's inventoryStamp).
  interface JobInput {
    pools: unknown;
    current: unknown;
    profile: unknown;
    opts: RunOpts;
  }
  type JobState = "running" | "done" | "cancelled" | "error";
  interface Job {
    id: string;
    // Mirrors the `x-client-id` header's own declared type (string | string[] | undefined, per
    // @types/node's IncomingHttpHeaders index signature for a header with no dedicated field) — this
    // value is only ever compared for equality or handed back verbatim, never treated as a string
    // specifically, so no narrowing cast is needed anywhere it's read.
    clientId: string | string[] | null;
    key: string;
    meta: Record<string, unknown>;
    input: JobInput;
    state: JobState;
    startedAt: number;
    progress: SolveProgress | null;
    result: OptResult | ExactSolveResult | null;
    ms: number | null;
    error: string | null;
    runId: string | null;
    clients: Set<http.ServerResponse>;
    workers: Set<Worker>;
  }
  const jobs = new Map<string, Job>();
  const JOB_TTL_MS = 10 * 60 * 1000;
  const timers = new Set<NodeJS.Timeout>();   // every setTimeout/setInterval this instance owns, so close() can stop them all

  // Job ids are crypto.randomUUID() (spec §4.5) rather than the old Date.now()-based id: the SSE
  // events route is exempt from the bearer token (EventSource can't carry one), so the id itself
  // must be unguessable — the events route's ownership check (below) is the other half of that.
  function startJob(input: JobInput, key: string, meta: Record<string, unknown>, clientId: string | string[] | null = null): Job {
    const id = randomUUID();
    const job: Job = { id, clientId, key, meta, input, state: "running", startedAt: Date.now(), progress: null, result: null, ms: null, error: null, runId: null, clients: new Set(), workers: new Set() };
    jobs.set(id, job);
    runJob(job).catch((e) => {
      if (job.state !== "running") return;   // cancelled: the terminated workers reject, nothing to report
      // Same stack-free rule as the route-level 500s, and now the same ref-keyed, file-backed log too
      // (post-review: job failures used to go to console.error only, with no ref and no file trail —
      // unrecoverable in a headless/backgrounded deployment). Note the worker's own try/catch
      // (optimize-worker.mts) already stringifies a caught error as `${e.stack}` before it ever leaves
      // the worker thread, so e.message here can ALREADY be a full stack trace in that path (an
      // uncaught worker crash instead reaches here as a normal Error with a normal e.message) — logging
      // e.stack ?? e.message covers both, and the client only ever sees the sanitized ref line either way.
      const ref = randomUUID().slice(0, 8);
      safeAppendLog(CONFIG.paths.log, `${new Date().toISOString()} ${ref} job ${job.id}\n${(e && ((e as Error).stack || (e as Error).message)) || e}\n`);
      job.state = "error"; job.error = `internal error (ref ${ref})`;
      finish(job, "failed", { error: job.error });
    });
    const t = setTimeout(() => { if (job.state === "running") cancelJob(job); jobs.delete(id); timers.delete(t); }, JOB_TTL_MS);
    t.unref(); timers.add(t);
    return job;
  }
  function spawnWorker(job: Job, data: { pools: unknown; current: unknown; profile: unknown; opts: RunOpts }, onProgress: (p: SolveProgress) => void, onWarn?: (message: string) => void): Promise<WorkerDoneMessage> {
    return new Promise((resolve, reject) => {
      const w = new Worker(new URL("./optimize-worker.mts", import.meta.url), { workerData: { coreUrl: CORE_URL, ...data } });
      job.workers.add(w);
      let settled = false;
      w.on("message", (m: WorkerMessage) => {
        if (m.type === "progress") onProgress(m.progress);
        else if (m.type === "warn") { if (onWarn) onWarn(m.message); }
        else if (m.type === "done") { settled = true; resolve(m); }
        else if (m.type === "error") { settled = true; reject(new Error(m.error)); }
      });
      w.on("error", (e) => { settled = true; reject(e); });
      w.on("exit", (code) => { job.workers.delete(w); if (!settled) reject(new Error(`worker exited with code ${code}`)); });
    });
  }
  function emitProgress(job: Job, p: SolveProgress): void { job.progress = p; broadcast(job, "progress", p); }

  async function runJob(job: Job): Promise<void> {
    const { pools, current, profile, opts } = job.input;
    const t0 = Date.now();
    const onWarn = (message: string) => safeAppendLog(CONFIG.paths.log, `${new Date().toISOString()} job ${job.id} warn: ${message}\n`);
    const { result } = await spawnWorker(job, { pools, current, profile, opts }, (p) => emitProgress(job, p), onWarn);
    if (job.state !== "running") return;
    job.state = "done"; job.result = result; job.ms = Date.now() - t0;
    try { job.runId = saveRun(job).id; } catch (e) { console.error(`could not save run ${job.id}: ${(e as Error).message}`); }
    finish(job, "done", { result, ms: job.ms, runId: job.runId });
  }
  function cancelJob(job: Job): void {
    if (job.state !== "running") return;
    job.state = "cancelled";
    job.ms = Date.now() - job.startedAt;
    for (const w of job.workers) w.terminate();
    finish(job, "cancelled", { ms: job.ms });
  }
  function jobSnapshot(job: Job) { return { id: job.id, state: job.state, progress: job.progress, result: job.result, ms: job.ms, error: job.error, runId: job.runId }; }
  function sse(res: http.ServerResponse, event: string, data: unknown): void { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); }
  function broadcast(job: Job, event: string, data: unknown): void { for (const c of job.clients) sse(c, event, data); }
  function finish(job: Job, event: string, data: unknown): void { broadcast(job, event, data); for (const c of job.clients) c.end(); job.clients.clear(); }
  function streamJob(job: Job, res: http.ServerResponse): void {
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive", "x-content-type-options": "nosniff" });
    sse(res, "hello", jobSnapshot(job));   // catch-up: last progress, or the final outcome if it already ended
    if (job.state !== "running") { res.end(); return; }
    job.clients.add(res);
    const ping = setInterval(() => sse(res, "ping", { at: Date.now() }), 5000);
    ping.unref(); timers.add(ping);
    res.on("close", () => { clearInterval(ping); timers.delete(ping); job.clients.delete(res); });
  }

  // ---- saved runs: one JSON file per finished build in app/data/runs/ -------------------------------
  function readRuns(): SavedRun[] {
    if (!existsSync(RUNS)) return [];
    const out: SavedRun[] = [];
    for (const f of readdirSync(RUNS).filter((f) => f.endsWith(".json"))) {
      // A run file is this app's own prior output, not third-party input, but it still gets the same
      // "trusted, cast at the read boundary" treatment as every other on-disk JSON file in this app.
      try { out.push(normalizeRun(JSON.parse(readFileSync(join(RUNS, f), "utf8")) as SavedRun)); } catch (e) { console.error(`skipping run ${f}: ${(e as Error).message}`); }
    }
    return out.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }
  function saveRun(job: Job) {
    mkdirSync(RUNS, { recursive: true });
    const meta = job.meta || {};
    const run = { id: job.id, key: job.key, character: meta.character || "?", createdAt: new Date().toISOString(), label: "",
      schemaVersion: 1,
      settings: meta.settings || {}, inventoryStamp: meta.inventoryStamp || null, poolSize: meta.poolSize ?? null, skipped: meta.skipped || {},
      opts: stripOpts(job.input.opts), budgetMs: job.input.opts.timeBudgetMs ?? null, explored: job.progress?.explored ?? null,
      result: job.result, ms: job.ms };
    writeFileSync(join(RUNS, `${run.id}.json`), JSON.stringify(run));
    return run;
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url!, `http://localhost:${CONFIG.port}`);   // req.url is always set for a real request this server routes (Node only leaves it undefined for CONNECT, which no route here handles)
    try {
      // ---- middleware order (spec §4.5): (1) Host (2) Origin (3) token, all before any route ----
      // server.listen(...) below always binds a TCP port on 127.0.0.1 (never a Unix socket), and no
      // request reaches this handler before the 'listening' event fires — address() is always an
      // AddressInfo at this point; the cast documents that invariant.
      const boundPort = (server.address() as AddressInfo).port;
      const hostOk = req.headers.host === `127.0.0.1:${boundPort}` || req.headers.host === `localhost:${boundPort}`;
      if (!hostOk) return send(res, 403, { ok: false, error: "forbidden host" });
      const origin = req.headers.origin;
      if (origin != null && origin !== `http://127.0.0.1:${boundPort}` && origin !== `http://localhost:${boundPort}`) {
        return send(res, 403, { ok: false, error: "forbidden origin" });
      }
      const isEventsRoute = EVENTS_ROUTE_RE.test(url.pathname);
      if (CONFIG.token && url.pathname.startsWith("/api/") && !isEventsRoute) {
        const want = Buffer.from(`Bearer ${CONFIG.token}`);
        const got = Buffer.from(String(req.headers.authorization || ""));
        const authOk = got.length === want.length && timingSafeEqual(got, want);
        if (!authOk) return send(res, 401, { ok: false, error: "unauthorized" });
      }
      if (req.method === "GET" && url.pathname === "/") return send(res, 200, readFileSync(join(HERE, "index.html"), "utf8"), "text/html");
      if (req.method === "GET" && url.pathname === "/vault-lib.mjs") return send(res, 200, readFileSync(join(WEB, "vault-lib.mjs"), "utf8"), "text/javascript");
      if (req.method === "GET" && url.pathname === "/item-query.mjs") return send(res, 200, readFileSync(join(WEB, "item-query.mjs"), "utf8"), "text/javascript");
      if (req.method === "GET" && url.pathname === "/scan-schema.mjs") return send(res, 200, readFileSync(join(WEB, "scan-schema.mjs"), "utf8"), "text/javascript");
      // scan-schema.mjs imports validate() from here — the browser resolves that relative import
      // against scan-schema.mjs's own served URL, so this needs its own static route too.
      if (req.method === "GET" && url.pathname === "/schema/validate.mjs") return send(res, 200, readFileSync(join(WEB, "schema", "validate.mjs"), "utf8"), "text/javascript");
      if (req.method === "GET" && url.pathname.startsWith("/ui/")) {
        const name = url.pathname.slice("/ui/".length);
        if (!UI_NAME_RE.test(name)) return send(res, 404, { ok: false, error: "not found" });
        // Modules come from the build (app/dist/ui/), stylesheets from the source tree: tsc emits only
        // what it compiles, so styles.css never appears in app/dist/. Splitting here keeps one URL space
        // (/ui/<name>) over two directories rather than adding a copy step to the build.
        const f = name.endsWith(".css") ? join(HERE, "ui", name) : join(WEB, "ui", name);
        if (!existsSync(f)) return send(res, 404, { ok: false, error: "not found" });
        return send(res, 200, readFileSync(f, "utf8"), name.endsWith(".css") ? "text/css" : "text/javascript");
      }
      if (req.method === "GET" && url.pathname === "/api/inventory") {
        const { inv, snapshotCount } = await getInventory();
        const itemsArr = Object.values(inv.items);
        const worn: Record<string, Item[]> = {}, rootCounts: Record<string, number> = {};
        for (const it of itemsArr) {
          if (it.equippedBy) (worn[it.equippedBy] ||= []).push(it);
          if (it.root != null) rootCounts[it.root] = (rootCounts[it.root] || 0) + 1;
        }
        const facets = facetsOf(itemsArr, { rarity: currentRules.rarity });
        const inventory = { scans: inv.scans, characters: inv.characters, containers: inv.containers, worn, rootCounts, itemCount: itemsArr.length, facets, propKeys: facets.propKeys };
        return send(res, 200, { ok: true, snapshotCount, demo: CONFIG.demo, inventory });
      }
      if (req.method === "GET" && url.pathname === "/api/items") {
        const { inv } = await getInventory();
        const query = parseItemQuery(url.searchParams);
        const result = applyItemQuery(Object.values(inv.items), query, { rarity: currentRules.rarity });
        // applyItemQuery returns the ItemQueryRows | ItemQueryGroups union; narrow at each call site
        // by query.group, same as app/item-query.test.mts does — `total` is common to both branches.
        if (query.group) return send(res, 200, { ok: true, total: result.total, offset: query.offset, limit: query.limit, groups: (result as ItemQueryGroups).groups });
        return send(res, 200, { ok: true, total: result.total, pieces: (result as ItemQueryRows).pieces, offset: query.offset, limit: query.limit, rows: (result as ItemQueryRows).rows });
      }
      // GET /api/items/by-serial?serials=1,2,3 — the one place the page can still ask for a FULL item
      // record (location, tags, equippedBy…) by serial, now that GET /api/inventory never carries the
      // whole item map: the suit builder's result panel and the hover tooltip both need to enrich a bare
      // serial (from a paged /api/items row that scrolled off, or an optimizer pool item, which only ever
      // carries {serial,name,slot,props}) on demand. Capped at 200 serials per call; a serial with no
      // matching item is simply absent from the response rather than an error.
      if (req.method === "GET" && url.pathname === "/api/items/by-serial") {
        const raw = (url.searchParams.get("serials") || "").split(",").map((s) => s.trim()).filter(Boolean);
        if (!raw.length || raw.length > 200 || raw.some((s) => !/^\d+$/.test(s))) {
          return send(res, 400, { ok: false, error: "serials must be 1-200 comma-separated non-negative integers" });
        }
        const { inv } = await getInventory();
        const items: Record<string, Item> = {};
        for (const s of raw) { const it = inv.items[s]; if (it) items[s] = it; }
        return send(res, 200, { ok: true, items });
      }
      if (req.method === "GET" && url.pathname === "/api/profiles") return send(res, 200, { ok: true, profiles: await readProfiles() });
      if (req.method === "PUT" && url.pathname === "/api/profiles") {
        const body = await readBody(req, { limit: 1e6, tooLargeMsg: "profiles too large" });
        const { ok, errors } = validate(PROFILES_SCHEMA, body);
        if (!ok) return send(res, 400, { ok: false, error: `${errors[0]!.path} ${errors[0]!.msg}`, errors });
        mkdirSync(dirname(PROFILES), { recursive: true });
        writeFileSync(PROFILES, JSON.stringify(body, null, 2) + "\n");
        return send(res, 200, { ok: true });
      }
      if (req.method === "GET" && url.pathname === "/api/settings") return send(res, 200, { ok: true, settings: currentSettings });
      if (req.method === "PUT" && url.pathname === "/api/settings") {
        // Any subset of {shard, setupDone, client} — Task 2 extended this route to carry the setup
        // wizard's own state without disturbing the shard-switch contract above it. Each field present
        // in the body is validated before ANYTHING is written (load-then-persist, same reasoning as
        // before: a rejected field must never partially land on disk or in memory). `body` stays a weak
        // Record so every field below reads as `unknown` until its own check narrows it, same as the
        // rest of this route always did (none of these fields were typeof-checked before body.shard was
        // handed to loadRules, for instance — see the report).
        const body = (await readBody(req)) as Record<string, unknown>;
        let nextRules = currentRules, nextFallback = rulesFallback;
        const hasShard = Object.prototype.hasOwnProperty.call(body, "shard");
        if (hasShard) {
          try { nextRules = loadRules(body.shard as string, { userRulesDir: USER_RULES_DIR }); }
          catch { return send(res, 400, { ok: false, error: `unknown or invalid shard: ${body.shard}` }); }
          nextFallback = false;
        }
        if (Object.prototype.hasOwnProperty.call(body, "setupDone") && typeof body.setupDone !== "boolean") {
          return send(res, 400, { ok: false, error: "settings.setupDone must be a boolean" });
        }
        if (Object.prototype.hasOwnProperty.call(body, "client")) {
          const c = body.client as Record<string, unknown> | null | undefined;
          const shapeOk = c === null || (c && typeof c === "object" && typeof c.adapter === "string" && typeof c.scriptsDir === "string");
          if (!shapeOk) return send(res, 400, { ok: false, error: "settings.client must be null or {adapter, scriptsDir}" });
          // Security (post-review fix): client.adapter must be a real, known adapter id before it can
          // ever reach installer.mts's path.join calls — see the /api/setup/install note below.
          if (c !== null && !listAdapters(ADAPTERS_DIR).some((a) => a.id === c!.adapter)) {
            return send(res, 400, { ok: false, error: `settings.client.adapter: unknown adapter "${c!.adapter}"` });
          }
        }
        currentSettings = { ...currentSettings, schemaVersion: 1 };
        if (hasShard) currentSettings.shard = body.shard as string;
        if (Object.prototype.hasOwnProperty.call(body, "setupDone")) currentSettings.setupDone = body.setupDone as boolean;
        if (Object.prototype.hasOwnProperty.call(body, "client")) currentSettings.client = body.client as ClientSettings | null;
        mkdirSync(dirname(SETTINGS), { recursive: true });
        writeFileSync(SETTINGS, JSON.stringify(currentSettings, null, 2) + "\n");
        currentRules = nextRules;
        rulesFallback = nextFallback;
        return send(res, 200, { ok: true, settings: currentSettings });
      }
      if (req.method === "GET" && url.pathname === "/api/rules") {
        return send(res, 200, { ok: true, shard: currentSettings.shard, rules: currentRules, available: listRules({ userRulesDir: USER_RULES_DIR }), fallback: rulesFallback });
      }
      // ---- Setup wizard (Task 2): adapter discovery, client-folder install, scan import, update check.
      if (req.method === "GET" && url.pathname === "/api/setup") {
        const adapters = listAdapters(ADAPTERS_DIR);
        const candidates: Record<string, string[]> = {}, available: Record<string, string | null> = {};
        for (const a of adapters) {
          candidates[a.id] = candidateClientRoots({ adapter: a.id, home: homedir(), platform: process.platform, env: process.env, adapterPlatform: a.platform });
          available[a.id] = installedVersion(join(ADAPTERS_DIR, a.id), a.id).version;
        }
        const installed = currentSettings.client ? installedVersion(currentSettings.client.scriptsDir, currentSettings.client.adapter) : null;
        // The id bridgeAdapter() is ACTUALLY routing POST /api/bridge / GET /api/bridge/status to right
        // now — reused, not restated, so this can never drift from the real routing decision. Guarded
        // to null when that id doesn't name a real discovered adapter (a test's throwaway --adapters
        // dir with no "tazuo" in it, say): reporting an id nothing can resolve would just move the
        // "buttons for an adapter that doesn't exist" bug onto the page instead of fixing it.
        const resolvedBridgeAdapter = bridgeAdapter();
        const bridgeAdapterField = adapters.some((a) => a.id === resolvedBridgeAdapter) ? resolvedBridgeAdapter : null;
        return send(res, 200, {
          ok: true, firstRun: !currentSettings.setupDone, settings: currentSettings, adapters,
          // platform: this machine's process.platform — on this desktop app, always the same machine
          // the player's game client runs on. Lets the wizard/Import tab (app/ui/adapters.mjs's
          // availableAdapters) hide a platform-restricted adapter (Razor Enhanced, Windows-only)
          // instead of offering a choice that can never work (Phase 6 final review, deferred minor).
          candidates, installed, available, dataDir: CONFIG.dataDir, platform: process.platform,
          // app/ui/bridge.mjs's currentAdapter() falls back to this when settings.client is unset (a
          // hand-installed or Skip-through-the-wizard player) — see the bridgeAdapter() comment above.
          bridgeAdapter: bridgeAdapterField,
        });
      }
      if (req.method === "POST" && url.pathname === "/api/setup/locate") {
        const { adapter, dir } = (await readBody(req)) as Record<string, unknown>;
        // Security (post-review fix): adapter is only ever used in an error string by validateScriptsDir
        // itself, but every route taking an adapter id is checked against the real, known ids the same
        // way, so a caller can't probe with an arbitrary string here either.
        if (!listAdapters(ADAPTERS_DIR).some((a) => a.id === adapter)) return send(res, 400, { ok: false, error: `unknown adapter: ${adapter}` });
        const result = validateScriptsDir(dir, adapter);
        if (!result.ok) return send(res, 400, { ok: false, error: result.error });
        return send(res, 200, { ok: true, scriptsDir: result.scriptsDir, installed: installedVersion(result.scriptsDir, adapter) });
      }
      if (req.method === "POST" && url.pathname === "/api/setup/install") {
        const { adapter, scriptsDir } = (await readBody(req)) as Record<string, unknown>;
        // Security (post-review fix): adapter must be one of listAdapters()'s real ids before it can
        // reach installScripts, which joins it onto adaptersDir to find the scripts to copy — an
        // unchecked adapter (e.g. "../../../../tmp/evil") would otherwise let this route copy an
        // arbitrary packrat-*.py from anywhere on disk into the user's LegionScripts folder.
        // installScripts also re-validates the id itself (defence in depth), but the route rejects it
        // first so the error is the clear "unknown adapter" rather than installScripts' own message.
        if (!listAdapters(ADAPTERS_DIR).some((a) => a.id === adapter)) return send(res, 400, { ok: false, error: `unknown adapter: ${adapter}` });
        // bridgeStatusPath is THIS adapter's own bridge status (the one whose scripts are about to be
        // overwritten on disk), not necessarily the currently-configured client's (bridgeAdapter()) —
        // those can differ, e.g. installing razor-enhanced for the first time while tazuo is still the
        // configured client from an earlier setup. Guarding against the wrong adapter's running-script
        // state would both miss a real conflict (razor-enhanced's own bridge actually running) and
        // could refuse an install that's perfectly safe (tazuo's bridge running has no bearing on
        // overwriting razor-enhanced's files) — so this always checks the adapter param itself.
        // `adapter as string` here (and in the client assignment below) is the erased cast placed AFTER
        // the allowlist check just above proved it — same pattern installer.mts's own compiler-only
        // casts use.
        const result = installScripts({ adapter, adaptersDir: ADAPTERS_DIR, scriptsDir, dataDir: CONFIG.dataDir, bridgeStatusPath: CONFIG.paths.bridgeStatusFor(adapter as string),
          log: (msg) => safeAppendLog(CONFIG.paths.log, `${new Date().toISOString()} setup-install ${msg}\n`) });
        if (!result.ok) {
          return send(res, result.code === "running" ? 409 : 400, { ok: false, error: result.error, code: result.code, installed: result.installed });
        }
        currentSettings = { ...currentSettings, schemaVersion: 1, client: { adapter: adapter as string, scriptsDir: scriptsDir as string } };
        mkdirSync(dirname(SETTINGS), { recursive: true });
        writeFileSync(SETTINGS, JSON.stringify(currentSettings, null, 2) + "\n");
        return send(res, 200, { ok: true, installed: result.installed, version: result.version });
      }
      if (req.method === "POST" && url.pathname === "/api/import") {
        // adapter defaults to "tazuo" — today's hard-coded behavior — so neither existing caller (the
        // wizard's import step, Settings' own "Import a folder" row) has to change to keep working.
        const { dir, adapter = "tazuo" } = (await readBody(req)) as Record<string, unknown>;
        // Security: same allowlist check every other route taking an adapter id makes (see
        // /api/setup/locate above) — adapter reaches CONFIG.paths.inboxFor, a path.join, so an
        // unchecked id could otherwise be used to probe/write outside the inbox tree.
        if (!listAdapters(ADAPTERS_DIR).some((a) => a.id === adapter)) return send(res, 400, { ok: false, error: `unknown adapter: ${adapter}` });
        let dirStat: Stats | null = null;
        // dir is never typeof-checked before this — only statSync's own throw (caught below) stands
        // between an arbitrary body value and the "dir must be an existing directory" 400, exactly the
        // pre-existing behavior; the cast is compiler-only (see report).
        try { dirStat = statSync(dir as string); } catch { /* badDir below */ }
        if (!dir || !dirStat || !dirStat.isDirectory()) return send(res, 400, { ok: false, error: "dir must be an existing directory" });
        const { copied, skipped } = importScans({ dir: dir as string, inboxDir: CONFIG.paths.inboxFor(adapter as string) });
        // Nudge the watcher rather than waiting on fs.watch to notice the burst (post-review fix,
        // Minor 3): a large import can overflow the OS's change-event buffer (Windows
        // ReadDirectoryChangesW, macOS FSEvents coalescing), which would otherwise leave some of the
        // just-copied files sitting unread in the inbox until the next launch's startup sweep.
        // scanOnce() is idempotent (ingestFile's own accepted-name check) and a no-op under --demo,
        // where watchers is empty.
        watchers.get(adapter as string)?.scanOnce();
        return send(res, 200, { ok: true, copied, skipped });
      }
      if (req.method === "POST" && url.pathname === "/api/import/paste") {
        const { text, adapter } = (await readBody(req)) as Record<string, unknown>;
        // Same allowlist as every other adapter-taking route — adapter reaches
        // CONFIG.paths.inboxFor -> path.join, so it must be a real, known id before that.
        if (!listAdapters(ADAPTERS_DIR).some((a) => a.id === adapter)) return send(res, 400, { ok: false, error: `unknown adapter: ${adapter}` });
        const parsed = parsePastedScan(text);
        if (!parsed.ok) return send(res, 400, { ok: false, error: parsed.error });
        // Post-review minor: `adapter` (which inbox the file gets filed under, from the Import tab's
        // picker) and `parsed.doc.adapter.id` (what the pasted document itself says it came from) can
        // disagree — a player who picks the wrong adapter in the dropdown before pasting, most likely
        // when only one client is configured and the picker is hidden (see ui/import.mjs's
        // adapterPicker) so the mismatch has no visible cause. Harmless to the fold itself (nothing
        // downstream trusts which inbox a scan sat in over the document's own adapter block), but
        // worth surfacing rather than filing it silently — logged here, and returned as `warning` so
        // the Import tab can show it too.
        const declaredAdapter = parsed.doc?.adapter?.id;
        const mismatch = declaredAdapter && declaredAdapter !== adapter;
        if (mismatch) {
          safeAppendLog(CONFIG.paths.log, `${new Date().toISOString()} import-paste warn: pasted into "${adapter}"'s inbox but the document declares adapter "${declaredAdapter}"\n`);
        }
        const { file, character } = writeScanToInbox({ doc: parsed.doc, adapter: adapter as string, paths: CONFIG.paths });
        // Same nudge as POST /api/import above — a single paste is not a burst, but there is no
        // reason to make the player wait on fs.watch's debounce when the file is already on disk.
        watchers.get(adapter as string)?.scanOnce();
        return send(res, 200, { ok: true, written: file, character,
          ...(mismatch ? { warning: `filed under "${adapter}", but this scan says it's from "${declaredAdapter}" — check the Adapter picker above` } : {}) });
      }
      if (req.method === "POST" && url.pathname === "/api/import/rescan") {
        await readBody(req);   // {} — no fields read, but every POST still needs a declared JSON body (readBody's own content-type check)
        const adapterIds = Array.from(watchers.keys());
        // id came from watchers.keys() itself, read synchronously with no intervening mutation of the
        // map — the entry is guaranteed present.
        for (const id of adapterIds) watchers.get(id)!.scanOnce();
        return send(res, 200, { ok: true, adapters: adapterIds });
      }
      if (req.method === "GET" && url.pathname === "/api/update-check") {
        const result = await checkForUpdates({ current: PACKAGE_JSON.version, repo: repoFromPackage(PACKAGE_JSON) });
        return send(res, 200, { ok: true, ...result });
      }
      if (req.method === "POST" && url.pathname === "/api/host/pick-folder") {
        if (!host || typeof host.pickFolder !== "function") return send(res, 501, { ok: false, error: "not available outside the desktop app" });
        const { title } = (await readBody(req)) as Record<string, unknown>;
        const path = await host.pickFolder({ title });
        return send(res, 200, { ok: true, path });
      }
      if (req.method === "POST" && url.pathname === "/api/host/open-path") {
        if (!host || typeof host.openPath !== "function") return send(res, 501, { ok: false, error: "not available outside the desktop app" });
        const { which } = (await readBody(req)) as Record<string, unknown>;
        if (which !== "data" && which !== "logs") return send(res, 400, { ok: false, error: 'which must be "data" or "logs"' });
        await host.openPath(which === "data" ? CONFIG.dataDir : CONFIG.paths.logs);
        return send(res, 200, { ok: true });
      }
      if (req.method === "GET" && url.pathname === "/api/events") {
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive", "x-content-type-options": "nosniff" });
        sse(res, "hello", { ok: true, watching: Array.from(watchers.keys()) });
        eventClients.add(res);
        const ping = setInterval(() => sse(res, "ping", { at: Date.now() }), 15000);
        ping.unref(); timers.add(ping);
        res.on("close", () => { clearInterval(ping); timers.delete(ping); eventClients.delete(res); });
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/optimize") {
        // Start a job: the optimizer runs in a worker thread; progress streams from /api/optimize/<id>/events.
        // A header-less caller must never collide with another header-less caller: `x-client-id` stays
        // null for the supersede check below (which only ever compares two non-empty strings), but the
        // JOB's own clientId is always a real string — a fresh, unguessable randomUUID() when no header
        // was sent — so the events route's ?client= check (which requires a non-empty match) can never
        // be satisfied by omission, and a header-less request can never read or supersede another
        // header-less request's job (fixed post-review: null-clientId collision, findings e/h).
        const headerClientId = req.headers["x-client-id"] || null;
        // pools/current/opts/meta/settings stay Record<string,unknown> (property-accessible, every
        // field still `unknown`) all the way through this route; profile/character stay bare `unknown`
        // — nothing here validates their shape beyond what's checked explicitly below (see report).
        let { pools = {}, current = {}, profile, opts = {}, meta = {}, character = null, settings = {} } = (await readBody(req)) as {
          pools?: Record<string, unknown>; current?: Record<string, unknown>; profile?: unknown; opts?: Record<string, unknown>;
          meta?: Record<string, unknown>; character?: unknown; settings?: Record<string, unknown>;
        };
        let skipped: Record<string, number> = {}, blocked: string[] = [];
        // The by-character form: the caller sends {character, settings} instead of building pools/current
        // itself, and the server runs buildPools() against the cached inventory — the same function and
        // the same defaults the page's own optimizerProfile() uses (ui/builder.mjs), so a request built
        // this way and an equivalent hand-built {pools,current} request key identically (runKey below) and
        // reuse each other's saved runs.
        if (character) {
          // A `null` in any optional field (as a saved run's settings can carry — e.g. re-posted from
          // the runs drawer) means "use the default", exactly like an absent field, not "the value is
          // null": normalise both to absent BEFORE validation, so the type checks below and the
          // destructuring defaults treat null and undefined alike (post-review fix — null used to slip
          // past `!= null` and then either reach buildPools as a literal `strLimit: null` or throw when
          // an array field's null hit code expecting an array).
          const s = Object.fromEntries(Object.entries(settings || {}).filter(([, v]) => v != null));
          if (s.weaponSkill != null && typeof s.weaponSkill !== "string") return send(res, 400, { ok: false, error: "settings.weaponSkill must be a string" });
          for (const f of ["excludeTags", "excludeRoots", "excludeSkills", "lockedSlots"] as const) {
            if (s[f] != null && !Array.isArray(s[f])) return send(res, 400, { ok: false, error: `settings.${f} must be an array` });
          }
          for (const f of ["allowOthersWorn", "allowGargoyle", "medOnly"] as const) {
            if (s[f] != null && typeof s[f] !== "boolean") return send(res, 400, { ok: false, error: `settings.${f} must be a boolean` });
          }
          if (s.strLimit != null && typeof s.strLimit !== "number") return send(res, 400, { ok: false, error: "settings.strLimit must be a number" });
          // Every field of `s` was checked above (when present); this cast is the trust boundary the
          // migration recipe describes — placed AFTER those checks, not instead of them.
          const { allowOthersWorn = false, strLimit = Infinity, excludeTags = [], excludeRoots = [], allowGargoyle = false, medOnly = false, weaponSkill = null, excludeSkills = [], lockedSlots = [] } = s as {
            allowOthersWorn?: boolean; strLimit?: number; excludeTags?: string[]; excludeRoots?: Array<string | number>;
            allowGargoyle?: boolean; medOnly?: boolean; weaponSkill?: string | null; excludeSkills?: string[]; lockedSlots?: string[];
          };
          const { inv } = await getInventory();
          // character is only ever truthy-checked (`if (character)` above), never typeof-checked — see report.
          const built = (await lib()).buildPools(inv, character as string, { allowOthersWorn, strength: strLimit, excludeTags, excludeRoots, excludeGargoyle: !allowGargoyle, medOnly, weaponSkill, excludeSkills });
          pools = built.pools; current = built.current; blocked = built.blocked;
          skipped = Object.fromEntries(Object.entries(built.skipped).map(([k, v]) => [k, v.length]));
          for (const slot of blocked) delete current[slot];       // a worn piece the filters now rule out must not stay "current"
          for (const slot of lockedSlots) pools[slot] = [];        // a locked slot offers no alternatives — it always keeps current
          opts = { ...(opts as RunOpts), optionalSlots: DEFAULT_OPTIONAL_SLOTS.filter((slot) => !lockedSlots.includes(slot)) };
          meta = { ...meta, character, settings: s };
        }
        if (!profile) return send(res, 400, { ok: false, error: "profile required" });
        const fullOpts = Object.assign({ seed: 2026, restarts: 200 }, opts as RunOpts);
        const key = runKey({ pools, current, profile, opts: fullOpts });
        const runs = readRuns();
        const hit = reusableRun(runs, key, fullOpts as { timeBudgetMs?: number });
        // §11c: warn (not block) once the candidate pool is large enough that the exact solver can
        // take a while — the page shows this line above the progress panel (Task 3).
        const poolSize = typeof meta.poolSize === "number" ? meta.poolSize : Object.values(pools).reduce((a: number, v) => a + (Array.isArray(v) ? v.length : 0), 0);
        // The by-character form doesn't hand the caller's meta a poolSize/skipped up front (unlike the
        // old form, whose client computes them itself — ui/builder.mjs) — fill them in now so a saved
        // run started this way (saveRun() below reads job.meta) carries the same figures the response does.
        if (character) { meta.poolSize = poolSize; meta.skipped = skipped; }
        if (hit) return send(res, 200, { ok: true, cached: true, run: hit, poolSize, skipped, current, blocked });
        // warm start: this character's newest saved suit, re-scored under the new settings
        const last = runs.find((r) => r.character === meta.character && r.result && r.result.best);
        // last.result/.best were both truthy-checked by the .find() predicate just above; `.best`'s
        // real shape is an OptAssignment-like {slot -> {serial} | null} map, looser than RunResult's
        // own declared fields (an index-signature read, same trust as everywhere else in this route).
        if (last) fullOpts.warmStart = Object.fromEntries(Object.entries(last.result!.best as Record<string, { serial: number } | null>).map(([slot, it]) => [slot, it ? it.serial : null]));
        // Cap: one running optimize job per client. A real client id is only ever supplied by the
        // page's own ui/api.mjs; a curl/test caller with no X-Client-Id is never deduped against itself.
        let superseded: string | null = null;
        if (headerClientId) {
          for (const j of jobs.values()) {
            if (j.clientId && j.clientId === headerClientId && j.state === "running") { cancelJob(j); superseded = j.id; break; }
          }
        }
        const jobClientId = headerClientId || randomUUID();
        const job = startJob({ pools, current, profile, opts: fullOpts }, key, meta, jobClientId);
        if (poolSize > 50000) job.meta.warning = "over 50,000 candidates; the exact solver may take a while";
        return send(res, 200, { ok: true, id: job.id, warmFrom: last ? last.id : null, superseded, warning: job.meta.warning, poolSize, skipped, current, blocked });
      }
      if (req.method === "GET" && url.pathname === "/api/runs") {
        const who = url.searchParams.get("character");
        return send(res, 200, { ok: true, runs: readRuns().filter((r) => !who || r.character === who).map(runSummary) });
      }
      const runMatch = url.pathname.match(/^\/api\/runs\/([\w-]+)$/);
      if (runMatch) {
        const f = join(RUNS, `${runMatch[1]!}.json`);
        if (!existsSync(f)) return send(res, 404, { ok: false, error: "no such run" });
        if (req.method === "GET") return send(res, 200, { ok: true, run: normalizeRun(JSON.parse(readFileSync(f, "utf8")) as SavedRun) });
        if (req.method === "DELETE") { unlinkSync(f); return send(res, 200, { ok: true }); }
        if (req.method === "PUT") {
          const { label = "" } = (await readBody(req)) as Record<string, unknown>;
          const run = normalizeRun(JSON.parse(readFileSync(f, "utf8")) as SavedRun);
          run.label = String(label).slice(0, 120);
          writeFileSync(f, JSON.stringify(run));
          return send(res, 200, { ok: true, run: runSummary(run) });
        }
      }
      const jobMatch = url.pathname.match(/^\/api\/optimize\/([\w-]+)\/(events|cancel|status)$/);
      if (jobMatch) {
        const job = jobs.get(jobMatch[1]!);
        if (!job) return send(res, 404, { ok: false, error: "no such job (the server may have restarted)" });
        if (jobMatch[2] === "cancel" && req.method === "POST") { cancelJob(job); return send(res, 200, { ok: true, state: job.state }); }
        if (jobMatch[2] === "status") return send(res, 200, { ok: true, ...jobSnapshot(job) });
        if (jobMatch[2] === "events" && req.method === "GET") {
          // The events route is exempt from the bearer token (EventSource can't send one), so this
          // ownership check is what stops a different client from reading this job's progress: the
          // ?client= query param (the page's CLIENT_ID) must match the id the job was started with.
          // Both sides are required to be non-empty strings — job.clientId is never null (the POST
          // handler always assigns a real id, generating one when no X-Client-Id header was sent), but
          // this stays defense-in-depth: an absent ?client= (searchParams.get() returns null) must
          // never match a null/empty job.clientId (fixed post-review: null-clientId collision).
          const clientParam = url.searchParams.get("client");
          if (!clientParam || !job.clientId || clientParam !== job.clientId) return send(res, 403, { ok: false, error: "forbidden" });
          return streamJob(job, res);
        }
      }
      if (req.method === "POST" && url.pathname === "/api/bridge") {
        // queue a command for packrat-bridge.py: {action, serial, name, chain: [root…parent], pos|null}
        const cmd = (await readBody(req)) as Record<string, unknown>;
        const id = `${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
        // Copy exactly the documented fields into the queue line — the page may send extras (e.g. a
        // human-readable location string) that the bridge does not need and should not carry forward.
        const line = { id, action: cmd.action, serial: cmd.serial, name: cmd.name, chain: cmd.chain || [], pos: cmd.pos ?? null, queuedAt: new Date().toISOString() };
        // Enforce the bridge contract at the only place the app writes it (post-review fix): a page
        // bug, or any other local caller, could otherwise queue a line that violates
        // BRIDGE_SCHEMA.command (unknown action, non-integer serial/chain entries, missing name) —
        // packrat-bridge.py refuses an unknown action itself, but the contract is the
        // deliverable, and it was unenforced at the only place the app writes it.
        const { ok, errors } = validate(BRIDGE_SCHEMA.command, line);
        if (!ok) return send(res, 400, { ok: false, error: `${errors[0]!.path} ${errors[0]!.msg}`, errors });
        // Queue into the CONFIGURED client's own bridge directory (bridgeAdapter(), above) — not a
        // fixed "tazuo" — so a Razor Enhanced player's Highlight/Grab/Go-to buttons reach the bridge
        // script that's actually reading commands (Phase 6 final review follow-up).
        const adapter = bridgeAdapter();
        mkdirSync(CONFIG.paths.bridgeFor(adapter), { recursive: true });
        appendFileSync(CONFIG.paths.bridgeQueueFor(adapter), JSON.stringify(line) + "\n");
        return send(res, 200, { ok: true, id });
      }
      if (req.method === "GET" && url.pathname === "/api/bridge/status") {
        const f = CONFIG.paths.bridgeStatusFor(bridgeAdapter());
        if (!existsSync(f)) return send(res, 200, { ok: true, online: false });
        try {
          const st = JSON.parse(readFileSync(f, "utf8")) as Record<string, unknown>;
          // The bridge's "alive" timestamp is either a legacy epoch-seconds number or an RFC 3339 string
          // (new format, Task 7) — accept both.
          const aliveMs = typeof st.alive === "number" ? st.alive * 1000 : Date.parse(st.alive as string);
          const age = st.alive != null && !Number.isNaN(aliveMs) ? (Date.now() - aliveMs) / 1000 : Infinity;
          return send(res, 200, { ok: true, online: age < 8, age: Math.round(age), ...st });
        } catch { return send(res, 200, { ok: true, online: false }); }
      }
      if (req.method === "POST" && url.pathname === "/api/forget") {
        // A tombstone scan: a root with no items, dated now, so the fold drops everything under it.
        // Written as v2 directly (schemaVersion:2, adapter.id "app") — a plain UTC toISOString() is
        // valid RFC 3339, and now that the fold orders by epoch (parseStamp) rather than string
        // comparison of scannedAt, a UTC stamp here sorts correctly against a naive-local adapter
        // scan regardless of this machine's timezone.
        // --demo points SCANS at app/fixtures/ (repo data, committed) — Forget must never write a
        // tombstone there, or a demo session leaves a stray file in the working tree.
        if (CONFIG.demo) return send(res, 409, { ok: false, error: "demo data is read-only" });
        const { root, name = "forgotten" } = (await readBody(req)) as Record<string, unknown>;
        // A non-numeric root used to pass this check (only truthiness was tested), writing a
        // tombstone whose roots[0].serial serializes to null — every later read then logs a schema
        // violation and the file accumulates forever while the user believes it worked (post-review
        // fix). root is never typeof-checked — the +root coercion below is the only check it gets
        // (same as the pre-TypeScript behavior); the casts here are compiler-only.
        if (!Number.isInteger(+(root as string)) || +(root as string) <= 0) return send(res, 400, { ok: false, error: "root required (positive integer serial)" });
        mkdirSync(SCANS, { recursive: true });
        const stamp = new Date().toISOString();
        const snap = {
          schemaVersion: 2, character: "_vault", scannedAt: stamp,
          adapter: { id: "app", version: "1", client: "Pack Rat", clientVersion: null,
            capabilities: { layers: [], arms: false, bank: false, ground: false, nested: false, tooltips: "label", bridge: [] } },
          shard: currentSettings.shard, stats: {}, equipped: [],
          roots: [{ serial: +(root as string), kind: "ground", name, opened: true }], containers: {}, items: [],
        };
        writeFileSync(join(SCANS, `_forget-${stamp.replace(/[:.]/g, "-")}-${(+(root as string)).toString(16)}.json`), JSON.stringify(snap));
        return send(res, 200, { ok: true });
      }
      send(res, 404, { ok: false, error: "not found" });
    } catch (e) {
      if (e && (e as HttpError).statusCode) return send(res, (e as HttpError).statusCode!, { ok: false, error: (e as HttpError).message });
      // Stack-free 500 (spec §4.5): the client gets a short ref, never the stack; the stack goes to
      // the log file keyed by that same ref, so a bug report only needs the ref to be actionable.
      const ref = randomUUID().slice(0, 8);
      safeAppendLog(CONFIG.paths.log, `${new Date().toISOString()} ${ref} ${req.method} ${url.pathname}\n${(e && (e as Error).stack) || e}\n`);
      send(res, 500, { ok: false, error: "internal error", ref });
    }
  });

  server.requestTimeout = 0; server.headersTimeout = 0; server.timeout = 0;   // exact searches can legitimately run for minutes
  await new Promise<void>((resolve, reject) => {
    const onError = (e: Error) => { server.off("listening", onListening); reject(e); };
    const onListening = () => { server.off("error", onError); resolve(); };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(CONFIG.port, "127.0.0.1");
  });
  const port = (server.address() as AddressInfo).port;
  const url = `http://localhost:${port}`;
  console.log(`Pack Rat: ${url}  (data: ${CONFIG.dataDir})  token: ${CONFIG.token ? "set" : "none (dev)"}`);
  if (CONFIG.open) {
    const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
    const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
    spawn(cmd, args, { stdio: "ignore", detached: true }).unref();
  }
  return {
    server, port, url,
    close: () => new Promise<void>((ok) => {
      for (const t of timers) clearTimeout(t);   // clearTimeout also clears intervals (same id space)
      timers.clear();
      for (const job of jobs.values()) for (const w of job.workers) w.terminate();
      for (const w of watchers.values()) w.close();
      // server.close() waits for every connection "waiting for a response" — an attached SSE stream
      // is one, and would otherwise hold teardown open until its keep-alive idle timeout. End every
      // open stream (both the per-job optimize streams and the shared /api/events stream) and
      // force-close the sockets so close() resolves promptly.
      for (const job of jobs.values()) { for (const c of job.clients) c.end(); job.clients.clear(); }
      for (const c of eventClients) c.end();
      eventClients.clear();
      server.closeAllConnections();
      // ok's declared parameter type (void | PromiseLike<void>) is narrower than server.close()'s own
      // callback type (err?: Error) — this server always calls it with no error at this point in a
      // controlled shutdown, so passing the SAME function through an erased cast changes nothing at
      // runtime.
      server.close(ok as (err?: Error) => void);
    }),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await startServer(); } catch (e) { console.error((e as Error).message); process.exit(2); }
}
