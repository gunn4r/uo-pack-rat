// vault-server.mts — Pack Rat local server. Zero dependencies.
//   node app/vault-server.mts [--data <dir>] [--port N] [--demo] [--open]
// Exports startServer(config) → { server, port, url, close() } — nothing runs at import time, so a
// test (or another launcher) can start and stop as many independent instances as it likes. The file
// also self-starts when run directly (node app/vault-server.mts / node scripts/start.mts).
// Routes: GET /  (index.html) · GET /favicon.png (app/assets/, the logo at 64 px) · GET /logo-mark.png (the rat's head cropped from the logo, 80 px, the sidebar's mark) · GET /vault-lib.mjs · GET /item-query.mjs (pure filter/sort/facet logic
//         shared by the browser and GET /api/items below — no DOM, no node: imports, servable byte for
//         byte like vault-lib.mts) · GET /scan-schema.mjs (vault-lib.mts imports it for parseStamp, so
//         it must be servable to the browser the same way) ·
//         GET /schema/validate.mjs (scan-schema.mts's own import, same reason) ·
//         GET /ui/<name> (name matching /^[a-z0-9-]+\.(mjs|css)$/, served from app/ui/, else 404) ·
//         GET /ui/fonts/<name>.woff2 (the bundled IBM Plex faces, app/ui/fonts/, as binary font/woff2) ·
//         GET /api/inventory (the cached fold of every scan — getInventory(), keyed by a signature of
//         the scans directory + shard + vault-lib.mts mtime, so an edited/added/removed scan file is
//         picked up on the next request with no restart; each scan file is upgraded v1→v2 and schema-
//         validated on read — readScans() — an invalid or unparsable file is logged and skipped) — the
//         response carries facets/worn/rootCounts/itemCount/propKeys — never the full item map
//         (that stopped shipping in Task 5, once the page moved to paging GET /api/items instead)
//         GET /api/items?q=&slot=&loc=&rarity=&kind=&seenDays=&slayer=&nogarg=&med=&hide=&prop=&group=
//         &sort=&dir=&offset=&limit= — a paged, server-side search/sort over the same folded inventory
//         (parseItemQuery/applyItemQuery, app/item-query.mts) ·
//         GET /api/items/by-serial?serials=1,2,3 — full item records (location/tags/equippedBy…) by
//         serial, 1-200 at a time (400 otherwise); a serial with no item is simply absent from the
//         response · GET|PUT /api/profiles (<data>/profiles.json)
//         GET|PUT /api/settings (<data>/settings.json: {shard, setupDone?, client?, retention?}) ·
//         GET|PUT /api/tazuo-panel ({hotkey?, openAtLogin?} -> {prefs, autostart}: the TazUO panel's hotkey and
//         open-at-login, app/tazuo-panel.mts; the latter edits <TazUO>/Data/lscript.json only for a choice the player
//         made, and only while no client runs, else it waits as pendingOpenAtLogin) ·
//         POST /api/retention/cleanup {dryRun} -> {scans, runs, refused} (prune old scans and saved runs
//         now, or count what that would remove; app/retention.mts; 409 under --demo) · GET /api/rules (the current shard's
//         rules object plus every {id,name,source} listRules() finds — builtin and <data>/rules/*.json)
//         POST /api/optimize {pools,current,profile,opts} -> {id}, or {character,settings,profile,opts}
//         to have the server build the pools itself (buildPools, per-slot lockedSlots/blocked handling —
//         see the route below); either form's response carries poolSize/skipped/current/blocked/warning?
//         GET /api/optimize/<id>/events (SSE: hello, progress, done|failed|cancelled) ·
//         POST /api/optimize/<id>/cancel · GET /api/optimize/<id>/status
//         A request whose inputs match a saved run that cannot be bettered returns {cached: true, run} at once.
//         GET /api/runs?character= (saved runs, newest first) · GET|PUT {label}|DELETE /api/runs/<id>
//         POST /api/forget {root} (drop a container from the inventory: writes a tombstone scan;
//         409 under --demo, which must never write into the committed app/fixtures/) ·
//         POST /api/forget-character {character} (drop a character's card, worn set, backpack and bank:
//         a `_vault` tombstone carrying forgetCharacter; 409 under --demo) ·
//         GET|POST {serial, name, where?} /api/blacklist · DELETE /api/blacklist/<serial>
//         (<data>/scan-blacklist.json, the containers scans never open) ·
//         GET|PUT /api/ui-prefs (<data>/ui-prefs.json: {cols?, colsVersion?, colWidths?, sheetProps?, theme?, appearance?, sidebar?, density?}, the page's view choices)
//         POST /api/bridge {action, serial, name, chain: [root…parent], pos|null} (queue for packrat-bridge.py) · GET /api/bridge/status
//         GET /api/events — SSE, one stream shared by every connected client (not per-job like the
//         optimize events above): hello {ok, watching: [adapter ids]} on connect, inventory
//         {file, character, scannedAt, at} once an inbox file is accepted into paths.scans, rejected
//         {file, reason, at} once one is moved to its adapter's rejected/ folder, changed {what:
//         "inventory"|"runs", by?, at} (by: the forgetting tab's x-client-id) after a forget, forget-character, run deletion or retention prune (so other open tabs
//         reload), ping every 15s. A
//         normal token-protected /api/* route (no SSE exemption — unlike /api/optimize/<id>/events,
//         this stream carries no per-job secret an EventSource couldn't send anyway). Non-demo mode
//         starts one app/watcher.mts per adapters/<id>/ directory that ships a capabilities.json
//         (today: tazuo), watching paths.inboxFor(id) and normalising accepted files into
//         paths.scans; --demo starts none (paths.scans there is the committed app/fixtures/, which
//         must never be written to).
//         Setup wizard (app/installer.mts backs all of these): GET /api/setup {firstRun, settings,
//         adapters, candidates, installed, available, dataDir, dataDirCheck} · POST /api/setup/locate {adapter, dir}
//         · POST /api/setup/install {adapter, scriptsDir} (409 while a Legion script is running in the
//         client, per installer.mts's bridge-status guard) · POST /api/import/paste {text, adapter} (413 past watcher.mts's MAX_INBOX_BYTES; app/import.mts's parsePastedScan:
//         what the ClassicUO web-client scanner prints, marker block or bare JSON, upgraded/validated
//         and written straight into that adapter's inbox — for a client whose sandbox can't write
//         files at all) · POST /api/import/rescan {} (scanOnce() on every running watcher, for a scan
//         file the folder watcher missed; {adapters: [ids swept]}, empty under --demo; 503 with
//         {failed: [ids]} when an inbox could not be swept) ·
//         GET /api/update-check (a GitHub releases/latest check, 10 s timeout, a success cached for an
//         hour; {configured: false} when package.json names no GitHub repo) ·
//         POST /api/host/pick-folder {title} and POST /api/host/open-path {which: "data"|"logs"} — both
//         need the optional `host` startServer({..}, {host}) was given (a folder-picker/opener the
//         Electron shell supplies); 501 on the bare server. GET/PUT /api/settings additionally carries
//         setupDone and client ({adapter, scriptsDir} | null).
// Every text/html response carries the Content-Security-Policy below (including frame-ancestors
// 'none'); every response carries x-content-type-options: nosniff and x-frame-options: DENY. Any
// PUT/POST whose body is read must declare content-type: application/json, else 415 (readBody()) —
// the SSE cancel beacon sends no body, so it's exempt — and its body must be a JSON OBJECT, else 400
// (asObject()). Files and directories this server creates are 0600/0700 (a no-op on Windows).
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
import { readFileSync, appendFileSync, readdirSync, existsSync, mkdirSync, copyFileSync, renameSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { basename, dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { statSync, lstatSync } from "node:fs";
import { Worker } from "node:worker_threads";
import { unlinkSync } from "node:fs";
import { randomUUID, timingSafeEqual } from "node:crypto";
import type { AddressInfo } from "node:net";
import { runKey, reusableRun, runSummary, stripOpts, normalizeRun, SOLVER_VERSION, type RunOpts, type SavedRun } from "./runs-lib.mts";
import { upgradeScan, validateScan } from "./scan-schema.mts";
import { loadRules, listRules, DEFAULT_SHARD } from "./rules.mts";
import { validate, type ValidatorSchema } from "./schema/validate.mts";
import { parseItemQuery, applyItemQuery, facetsOf, type ItemQueryRows, type ItemQueryGroups } from "./item-query.mts";
import { DEFAULT_OPTIONAL_SLOTS } from "./mip.mts";
import { startWatcher, jsonErrorReason, MAX_INBOX_BYTES, type StartWatcherOptions, type WatcherHandle } from "./watcher.mts";
import { parsePastedScan, writeScanToInbox } from "./import.mts";
import { writeFileAtomic } from "./atomic-write.mts";
import { autostartOn, panelPrefsError, panelPrefsOf, readPanelFile, syncOpenAtLogin, tazuoRunning, writePanelFile, type AutostartOutcome } from "./tazuo-panel.mts";
import { retentionError, retentionOf, runsToPrune, scansToPrune, type ScanFile } from "./retention.mts";
import {
  listAdapters, candidateClientRoots, validateScriptsDir, installedVersion, installScripts,
  repoFromPackage, checkForUpdates, type CheckForUpdatesResult, checkScriptsDataDir, type DataDirCheck, type AdapterInfo,
} from "./installer.mts";
import { dataDirNotice } from "./ui/messages.mts";
import { homedir } from "node:os";

import { resolveConfig, ensureLayout, APP_DIR, DATA_DIR_MODE, DATA_FILE_MODE, type Config } from "./config.mts";
import type { Item, Inventory, ProfilesFile, BlacklistEntry } from "./vault-lib.mts";
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
// off-page. Applied to every text/html response; every response also gets nosniff and
// x-frame-options: DENY. frame-ancestors has to be spelled out — it is one of the few directives
// with no default-src fallback, so the comment used to claim a "no framing" the header never sent
// (post-review fix, Important 6): any page could iframe GET / (a framed navigation carries this
// server's own Host and no Origin, so the middleware passes it) and clickjack the app.
const CSP = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const UI_NAME_RE = /^[a-z0-9-]+\.(mjs|css)$/;
const FONT_NAME_RE = /^[a-z0-9-]+\.woff2$/;
// The closed-choice fields of <data>/ui-prefs.json (GET/PUT /api/ui-prefs) and what each may hold. The
// page applies only the theme families it ships (app/ui/theme.mts's BUILT_THEMES) and draws Default for
// anything else.
const UI_PREF_CHOICES = {
  theme: ["default", "britannia"],
  appearance: ["light", "system", "dark"],
  sidebar: ["auto", "collapsed"],
  density: ["dense", "regular"],   // the Inventory table's row height
  colsVersion: ["2"],              // the column set `cols` was saved against (app/ui/view-state.mts's COLS_VERSION)
} as const satisfies Record<string, readonly string[]>;
// The list fields: the Inventory tab's columns and the character sheet's shown properties (absent = the default set).
const UI_PREF_LISTS = ["cols", "sheetProps"] as const;
type UiPrefsFile = { -readonly [K in typeof UI_PREF_LISTS[number]]?: string[] } & { -readonly [K in keyof typeof UI_PREF_CHOICES]?: string } & { colWidths?: Record<string, number> };
// The Inventory columns' dragged widths ({colKey: px}): at most 200 column keys (the same keys `cols` holds), each a whole 40 to 1200 px.
function isColWidths(v: unknown): v is Record<string, number> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const entries = Object.entries(v);
  return entries.length <= 200 && entries.every(([k, w]) => isBoundedString(k, 64) && isBoundedInt(w, 40, 1200));
}
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
  // Every non-JSON caller passes an already-read file: a string (readFileSync's utf8 result) for
  // text, a Buffer for the favicon and the fonts — the cast is compiler-only, matching config.mts's
  // rawPort pattern. Binary types (image/*, font/*) carry no charset.
  const data = type === "application/json" ? JSON.stringify(body) : (body as string | Buffer);
  // x-frame-options rides on EVERY response, not just text/html: it is the belt to the CSP's braces
  // for anything that ignores frame-ancestors, and a JSON response rendered directly as a document
  // is framable too.
  const headers: Record<string, string> = { "content-type": type.startsWith("image/") || type.startsWith("font/") ? type : type + "; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", "x-frame-options": "DENY" };
  if (type === "text/html") headers["content-security-policy"] = CSP;
  res.writeHead(status, headers);
  res.end(data);
}

// The two event-stream routes write their own headers (a stream is never finished by send()), so the
// "every response carries x-frame-options" rule is restated here rather than inherited: the same
// nosniff/DENY pair send() adds, plus the CSP's frame-ancestors half, since a text/event-stream
// response opened directly as a document is as framable as a JSON one.
const SSE_HEADERS: Record<string, string> = {
  "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive",
  "x-content-type-options": "nosniff", "x-frame-options": "DENY", "content-security-policy": "frame-ancestors 'none'",
};

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
// How much of an over-cap body readBody keeps reading (and discarding) after it has refused it, so the
// client gets to finish writing and actually read its 413 — see the overflow branch below.
const OVERFLOW_DRAIN_BYTES = 4 * 1024 * 1024;

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
    let bytes = 0, discarded = 0;
    let tooLarge: HttpError | null = null;
    req.on("data", (c: Buffer) => {
      if (tooLarge) {
        // Past the cap, a chunk is counted and dropped, never kept, and the 413 waits for the request
        // to end. Answering at once — the connection closes behind a `connection: close` answer —
        // raced a client still writing its body: it saw the socket end under it before it could read
        // the refusal, which Node's fetch reports as "fetch failed" / EPIPE. Waiting for `end` makes
        // the answer readable for a body that is merely too big; past OVERFLOW_DRAIN_BYTES the 413
        // goes out and the socket is destroyed, so an upload of any size still costs this process at
        // most that much reading and nothing of memory.
        discarded += c.length;
        if (discarded > OVERFLOW_DRAIN_BYTES) { reject(tooLarge); req.destroy(); }
        return;
      }
      bytes += c.length;   // c is a Buffer — .length is bytes, not decoded characters
      if (bytes > limit) {
        chunks.length = 0;   // the accepted part is doomed too — release it now
        tooLarge = new Error(tooLargeMsg) as HttpError;
        tooLarge.statusCode = 413;
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      if (tooLarge) return reject(tooLarge);
      // A body that does not parse is the caller's mistake, not this server's: a 400 carrying
      // jsonErrorReason's shape of the failure (never the body's own bytes), and no stack in the log.
      try { const buf = Buffer.concat(chunks); resolve(buf.length ? JSON.parse(buf.toString("utf8")) : {}); }
      catch (e) {
        const bad = new Error(jsonErrorReason(e)) as HttpError;
        bad.statusCode = 400;
        reject(bad);
      }
    });
    req.on("error", reject);
  });
}

// Every route below reads its body as an object of named fields, but JSON.parse happily returns
// null, an array, a string or a number for a perfectly well-formed body — and destructuring null is
// a TypeError, so a literal `null` body used to 500 ten routes at once, each appending a stack to
// the log (post-review fix, Minor 8). One guard in front of them all turns that into the 400 it
// always was. Throws rather than returning a result the caller has to check: the statusCode the
// top-level handler already reads off readBody's own errors carries it straight to the client.
function asObject(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    const e = new Error("body must be a JSON object") as HttpError;
    e.statusCode = 400;
    throw e;
  }
  return body as Record<string, unknown>;
}

// A request field that must be a real string of bounded length. `unknown` in, a narrowed string out,
// so a route reads the value directly after the check instead of casting it.
function isBoundedString(v: unknown, max: number): v is string {
  return typeof v === "string" && v.length > 0 && v.length <= max;
}
// Same for an integer within an inclusive range (opts.restarts, opts.timeBudgetMs, …).
function isBoundedInt(v: unknown, min: number, max: number): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
}
// Bounds a caller-supplied value before it is interpolated into an error message or a log line.
function short(v: unknown): string { return String(v).slice(0, 64); }

const MAX_PATH_LEN = 4096;
// The largest serial the scan contract accepts (app/schema/scan.v2.schema.json: a 32-bit unsigned).
const MAX_SERIAL = 0xFFFFFFFF;
// What a failed locate/install tells the caller. Deliberately says nothing about the path it probed:
// echoing the resolved path back made these routes a clean existence oracle for any absolute path on
// the machine — "existing directory" vs "file or absent", for free, from an unauthenticated route in
// the bare `npm start` configuration (post-review fix, Important 3).
const NO_CLIENT_FOLDER = "no scripts folder found there for that client";

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
    mkdirSync(dirname(file), { recursive: true, mode: DATA_DIR_MODE });
    appendFileSync(file, line, { mode: DATA_FILE_MODE });
  } catch (e) {
    console.error(`log write failed (${file}): ${e && (e as Error).message}`);
  }
}

// ---- POST /api/optimize's request shape ---------------------------------------------------------
// Everything below this comment runs on a body any local caller can send. Until this pass the route
// checked `profile` for truthiness and nothing else, so a malformed pools entry reached the worker
// thread and ended the job in an internal-error ref with a full stack in the log — an attacker-driven
// path into the unrotated log file, and a confusing failure for a page bug (post-review fix,
// Important 5). Every helper here returns the reason it refused (for a 400) or null.

// One optimizer candidate: vault-lib's OptItem, {serial, name, slot, props}. The core reads `.props`
// off every entry with no null guard of its own, so both a literal null and an item with no props
// have to be refused here.
function optItemError(it: unknown): string | null {
  if (!it || typeof it !== "object" || Array.isArray(it)) return "every candidate must be an object";
  const props = (it as Record<string, unknown>).props;
  if (!props || typeof props !== "object" || Array.isArray(props)) return "every candidate needs a props object";
  return null;
}
function poolsError(pools: unknown): string | null {
  if (!pools || typeof pools !== "object" || Array.isArray(pools)) return "pools must be an object";
  for (const [slot, list] of Object.entries(pools as Record<string, unknown>)) {
    if (!Array.isArray(list)) return `pools.${short(slot)} must be an array`;
    for (const it of list) { const e = optItemError(it); if (e) return `pools.${short(slot)}: ${e}`; }
  }
  return null;
}
// current is the worn suit: slot -> candidate, or null/absent for an empty slot.
function currentError(current: unknown): string | null {
  if (!current || typeof current !== "object" || Array.isArray(current)) return "current must be an object";
  for (const [slot, it] of Object.entries(current as Record<string, unknown>)) {
    if (it == null) continue;
    const e = optItemError(it); if (e) return `current.${short(slot)}: ${e}`;
  }
  return null;
}
// The search options a caller may set, and the range each one may sit in. An allowlist rather than a
// shape check, so an unknown key is refused rather than handed to the solver — which also means an
// own `__proto__` key out of JSON.parse never reaches the Object.assign that builds fullOpts.
// optionalSlots/warmStart are set by the route itself after this runs; seed/restarts/timeBudgetMs/
// exact/alternatives are what app/ui/builder.mts actually sends.
const OPTS_MAX_TIME_BUDGET_MS = 60 * 60 * 1000;
// The same ranges as numbers the page can show: the Suit Builder's Advanced fields validate against a copy
// (app/ui/builder-model.mts's SOLVER_LIMITS; app/server.test.mts checks the two agree).
export const OPTS_LIMITS = { restarts: { min: 1, max: 10000 }, timeBudgetMs: { min: 0, max: OPTS_MAX_TIME_BUDGET_MS }, alternativesCount: { min: 0, max: 100 } } as const;
function optsError(opts: Record<string, unknown>): string | null {
  for (const [k, v] of Object.entries(opts)) {
    switch (k) {
      case "exact": if (typeof v !== "boolean") return "opts.exact must be a boolean"; break;
      case "seed": if (!isBoundedInt(v, 0, 2 ** 31)) return "opts.seed must be an integer"; break;
      case "restarts": if (!isBoundedInt(v, OPTS_LIMITS.restarts.min, OPTS_LIMITS.restarts.max)) return `opts.restarts must be an integer between ${OPTS_LIMITS.restarts.min} and ${OPTS_LIMITS.restarts.max}`; break;
      case "timeBudgetMs": if (!isBoundedInt(v, 0, OPTS_MAX_TIME_BUDGET_MS)) return `opts.timeBudgetMs must be an integer between 0 and ${OPTS_MAX_TIME_BUDGET_MS}`; break;
      case "optionalSlots":
        if (!Array.isArray(v) || v.length > 32 || v.some((s) => !isBoundedString(s, 32))) return "opts.optionalSlots must be an array of at most 32 slot names";
        break;
      case "alternatives": {
        if (!v || typeof v !== "object" || Array.isArray(v)) return "opts.alternatives must be an object";
        const { count, tolerance } = v as Record<string, unknown>;
        if (!isBoundedInt(count, OPTS_LIMITS.alternativesCount.min, OPTS_LIMITS.alternativesCount.max)) return `opts.alternatives.count must be an integer between ${OPTS_LIMITS.alternativesCount.min} and ${OPTS_LIMITS.alternativesCount.max}`;
        if (typeof tolerance !== "number" || !Number.isFinite(tolerance) || tolerance < 0) return "opts.alternatives.tolerance must be a non-negative number";
        break;
      }
      default: return `opts.${short(k)} is not a supported search option`;
    }
  }
  return null;
}
// meta is the caller's own bookkeeping, and saveRun() used to persist it verbatim into
// <data>/runs/<uuid>.json — a megabyte of padding in meta.settings became a megabyte on disk that
// every later readRuns() re-parsed, on the two hottest routes. Copy only the fields saveRun actually
// reads; the route caps the result's serialized size on top of that.
const META_MAX_BYTES = 32e3;
function pickMeta(meta: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (isBoundedString(meta.character, 64)) out.character = meta.character;
  if (isBoundedString(meta.inventoryStamp, 256)) out.inventoryStamp = meta.inventoryStamp;
  if (typeof meta.poolSize === "number" && Number.isFinite(meta.poolSize)) out.poolSize = meta.poolSize;
  if (meta.settings && typeof meta.settings === "object" && !Array.isArray(meta.settings)) out.settings = meta.settings;
  if (meta.skipped && typeof meta.skipped === "object" && !Array.isArray(meta.skipped)) out.skipped = meta.skipped;
  return out;
}

// What only a real desktop shell (Electron) can supply to startServer — see the `host` parameter
// note below. `title` stays `unknown` rather than `string` because it begins life as a request-body
// field: the route drops anything that is not a short string before calling, and electron/host-args
// .mts coerces it again at the far end, but the TYPE records where the value came from.
// openPath takes the DISCRIMINATOR "data" | "logs", never a resolved path: the shell owns those two
// directories and looks them up itself, so this process — the lower-trust half of the split — cannot
// name a third thing for the OS to launch (phase-7 security review, area-4 Important 1).
export interface HostBridge {
  pickFolder?: ((opts: { title?: unknown }) => Promise<string | null>) | undefined;
  openPath?: ((which: "data" | "logs") => Promise<void>) | undefined;
}

// How long a finished build's result stays readable (retentionMs, timed from when it finished), and
// how far past its own time budget a build may still be running before it is cancelled as stuck
// (runGraceMs). Only tests set these, for the same reason as watcherOptions below.
export interface JobTimings {
  retentionMs?: number | undefined;
  runGraceMs?: number | undefined;
}

// Where the server looks for the player's game client: `home` (the scripts' ~ and ~/.pack-rat default)
// and the auto-detected scripts folders per adapter (GET /api/setup's `candidates`, and the data-folder
// check's fallback when no client is configured). The default is this machine's real home and
// installer.mts's candidateClientRoots — which, on win32, also probes a fixed C:\TazUO — so a test
// passes its own to never reach a real client folder on any OS.
//
// PACKRAT_CLIENT_HOME swaps the real home for another folder, for a server started in another process
// (the Electron UI tests launch the whole app, so they cannot hand startServer an option): the search
// then looks only under that folder, with no environment folders (LOCALAPPDATA) and no fixed roots
// (C:\TazUO), so a test launch can never find, or read the packrat-paths.json of, a real client.
export interface ClientSearch {
  home: string;
  candidates: (adapter: AdapterInfo) => string[];
}
export function defaultClientSearch(env: NodeJS.ProcessEnv = process.env): ClientSearch {
  if (env.PACKRAT_CLIENT_HOME) {
    const home = resolve(env.PACKRAT_CLIENT_HOME);
    // "linux" is the platform with no fixed roots; an adapter for another OS still offers nothing.
    return { home, candidates: (a) => (a.platform && a.platform !== process.platform ? [] : candidateClientRoots({ adapter: a.id, home, platform: "linux", env: {} })) };
  }
  const home = homedir();
  return { home, candidates: (a) => candidateClientRoots({ adapter: a.id, home, platform: process.platform, env, adapterPlatform: a.platform }) };
}

export interface StartServerOptions {
  host?: HostBridge | undefined;
  clientSearch?: ClientSearch | undefined;
  watcherOptions?: Partial<StartWatcherOptions> | undefined;
  jobTimings?: JobTimings | undefined;
  // Whether a TazUO client is running (app/tazuo-panel.mts's tazuoRunning); a test supplies its own.
  clientRunning?: (() => boolean) | undefined;
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
// Promise<string|null>, openPath(which: "data" | "logs") -> Promise<void> }. Without it, POST /api/host/* answers 501
// ("not available outside the desktop app") rather than throwing — the bare `node app/vault-server.mts`
// / test-harness path never has a folder picker or an OS file-opener to call.
// `watcherOptions` is passed straight through to every app/watcher.mts startWatcher() call below —
// nothing outside tests should ever set it, since the defaults (debounceMs/retries/retryDelayMs) are
// real product behavior. It exists so a test that wants to observe a reject-after-retries cycle over
// SSE doesn't have to wait out the real debounce + backoff (300ms + 2×700ms = 1700ms of production
// timing) inside a fixed-timeout SSE read — app/watcher.test.mts already shortens these same knobs
// (debounceMs:20, retryDelayMs:20) when calling startWatcher() directly; this gives app/server.test.mts
// the same lever for the route-level equivalent instead of relying on a wide timeout margin to absorb
// real wall-clock retry delay plus whatever scheduling/fs-watch jitter a loaded machine adds on top.
// `jobTimings` (JobTimings above) shortens the job clocks for a test in the same way.
export async function startServer(config: Config = ensureLayout(resolveConfig()), { host, clientSearch = defaultClientSearch(), watcherOptions = {}, jobTimings = {}, clientRunning = () => tazuoRunning() }: StartServerOptions = {}): Promise<ServerHandle> {
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
    retention?: unknown;
    [key: string]: unknown;
  }
  // The shard picker: <data>/settings.json ({schemaVersion, shard}) names which app/rules/<shard>.json
  // (or <data>/rules/<shard>.json override) is currently active. ensureLayout() already wrote a default
  // settings.json if none existed, so this file exists by the time startServer runs.
  // A settings.json that does not parse, or is not an object, used to throw out of startServer and
  // stop the app from starting at all (exit 2) — for a file the app itself writes and a player may
  // hand-edit. It now starts on defaults instead, with a logged warning, and the unreadable file is
  // moved aside as settings.json.corrupt (never overwritten: an older .corrupt keeps its name and the
  // new one gets a timestamp) so whatever was in it can still be recovered by hand. Defaults are then
  // written back, the same file ensureLayout() writes on a fresh data directory.
  // A persisted client whose adapter id is not one this install ships is dropped IN MEMORY ONLY (the
  // same rule as the shard fallback below — settings.json is left as it stands): bridgeAdapter()
  // joins that id into the bridge queue/status paths, and PUT /api/settings already refuses an
  // unknown one, so a hand-edited file must not be a way round that check.
  function startupWarning(msg: string): void {
    console.warn(msg);
    safeAppendLog(CONFIG.paths.log, `${new Date().toISOString()} startup-fallback ${msg}\n`);
  }
  // An unreadable data file is renamed to <file>.corrupt (never overwritten: an older .corrupt keeps
  // its name and the new one gets a timestamp) so whatever was in it can still be recovered by hand.
  // Returns the name it was kept as, or throws when the rename itself fails.
  function moveAside(file: string): string {
    let aside = `${file}.corrupt`;
    if (existsSync(aside)) aside = `${file}.corrupt-${Date.now()}`;
    renameSync(file, aside);
    return aside;
  }
  function loadSettings(): SettingsDoc {
    const defaults: SettingsDoc = { schemaVersion: 1, shard: DEFAULT_SHARD };
    if (!existsSync(SETTINGS)) return defaults;
    let doc: unknown, why = "not a JSON object";
    try { doc = JSON.parse(readFileSync(SETTINGS, "utf8")); }
    catch (e) { doc = undefined; why = jsonErrorReason(e); }
    if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
      let aside: string;
      try {
        aside = moveAside(SETTINGS);
        writeFileAtomic(SETTINGS, JSON.stringify(defaults, null, 2) + "\n", DATA_FILE_MODE);
      } catch (e) {
        startupWarning(`settings.json could not be moved aside (${(e as Error).message}); running on defaults without touching it`);
        return defaults;
      }
      startupWarning(`settings.json is unreadable (${why}); starting on defaults — the old file was kept as ${aside}`);
      return defaults;
    }
    return doc as SettingsDoc;
  }
  function clientIsKnown(doc: SettingsDoc): boolean {
    const client = doc.client as unknown;
    if (client == null) return true;
    const rec = typeof client === "object" && !Array.isArray(client) ? client as Record<string, unknown> : null;
    const known = !!rec && typeof rec.adapter === "string" && typeof rec.scriptsDir === "string" && listAdapters(ADAPTERS_DIR).some((a) => a.id === rec.adapter);
    if (!known) startupWarning(`settings.json names a client adapter this install does not ship (${JSON.stringify(short(rec?.adapter))}); ignoring that client for this run — settings.json is unchanged`);
    return known;
  }
  // Two views of the same settings. savedSettings is exactly what settings.json holds, and the only
  // thing ever written back to it; currentSettings is what this run actually uses — savedSettings
  // with the two startup fallbacks (an unknown client dropped, an unloadable shard replaced) laid on
  // top. Every write merges only the fields its request changed into savedSettings, so a fallback
  // can never be persisted over the player's real value by an unrelated save (a wizard's setupDone,
  // say): fixing the rules file or reinstalling the newer version and restarting picks the original
  // choice back up, as the fallback promises.
  let savedSettings = loadSettings();
  let clientIgnored = !clientIsKnown(savedSettings);
  // The shard fallback below sets this; declared here so effectiveSettings() can read it.
  let rulesFallback = false;
  function effectiveSettings(): SettingsDoc {
    return { ...savedSettings, retention: retentionOf(savedSettings.retention), ...(clientIgnored ? { client: null } : {}), ...(rulesFallback ? { shard: DEFAULT_SHARD } : {}) };
  }
  let currentSettings = effectiveSettings();
  function saveSettings(changes: Partial<SettingsDoc>): void {
    const next: SettingsDoc = { ...savedSettings, schemaVersion: 1, ...changes };
    mkdirSync(dirname(SETTINGS), { recursive: true, mode: DATA_DIR_MODE });
    writeFileAtomic(SETTINGS, JSON.stringify(next, null, 2) + "\n", DATA_FILE_MODE);
    savedSettings = next;
    if ("client" in changes) clientIgnored = false;
    currentSettings = effectiveSettings();
  }
  // Which adapter's bridge the page-facing bridge routes (POST /api/bridge, GET /api/bridge/status)
  // talk to — the currently CONFIGURED client, re-read live off currentSettings on every call rather
  // than captured once at startup, so a client switch (a fresh install, or "Run setup again") takes
  // effect on the very next request with no restart. Falls back to DEFAULT_BRIDGE_ADAPTER when no
  // client is configured at all, matching this route's own pre-existing behavior before it became
  // per-adapter (Phase 6 final review follow-up). GET /api/setup below reports this exact same id back
  // to the page as `bridgeAdapter` (guarded there against a discovered-adapters list that doesn't
  // actually contain it — a throwaway test fixture dir, say) so app/ui/bridge.mts's currentAdapter()
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
  let currentRules: RulesV1;
  try {
    currentRules = loadRules(currentSettings.shard, { userRulesDir: USER_RULES_DIR });
  } catch (e) {
    const msg = `settings.json names shard "${currentSettings.shard}", which failed to load (${(e as Error).message}); falling back to "${DEFAULT_SHARD}" for this run — settings.json is unchanged`;
    startupWarning(msg);
    currentRules = loadRules(DEFAULT_SHARD, { userRulesDir: USER_RULES_DIR });
    rulesFallback = true;
    currentSettings = effectiveSettings();
  }

  // Whether the client's installed scripts write to this data folder (installer.mts's
  // checkScriptsDataDir). Run on every GET /api/setup, so a reinstall clears the page's banner with no
  // restart, and once here, so a plain `npm start` on the default folder against scripts pointed at a
  // dev folder says so in the terminal instead of just showing nothing. Never under --demo: its
  // fixtures don't come from any client. The sentence is the page's own (ui/messages.mts).
  function dataDirCheck(): DataDirCheck {
    if (CONFIG.demo) return { status: "none" };
    const candidates = currentSettings.client ? [] : listAdapters(ADAPTERS_DIR).flatMap((a) => clientSearch.candidates(a));
    return checkScriptsDataDir({ dataDir: CONFIG.dataDir, client: currentSettings.client, candidates, home: clientSearch.home, platform: process.platform });
  }
  const dataDirWarning = dataDirNotice(dataDirCheck());
  if (dataDirWarning) console.warn(dataDirWarning);

  // ---- /api/events: one shared SSE stream, fed by one app/watcher.mts per adapter ------------------
  // Non-demo only — --demo's paths.scans is the committed app/fixtures/, which a watcher must never
  // write into. Each adapter is a directory under adapters/ that ships a capabilities.json; today
  // that's just adapters/tazuo/. watchers: id -> {close(), scanOnce()}; eventClients: every response
  // currently attached to GET /api/events, so a later accept/reject can broadcast to all of them.
  const watchers = new Map<string, WatcherHandle>();
  const eventClients = new Set<http.ServerResponse>();
  function broadcastEvent(event: string, data: unknown): void { for (const c of eventClients) sse(c, event, data); }
  // The watchers themselves start only once the port is bound (startWatchers(), called after
  // listen() below): their startup sweep moves inbox files into scans/, and a server that then fails
  // to bind (EADDRINUSE) must not have done that, nor leave live watchers behind it.
  function startWatchers(): void {
    if (CONFIG.demo) return;
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

  // vault-lib.mts is re-imported whenever its mtime changes, so edits to the parser/fold take effect on
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
  function readScans(): ScanV2[] { return readScanFiles().map((s) => s.doc); }
  function readScanFiles(): ScanFile[] {
    if (!existsSync(SCANS)) return [];
    const out: ScanFile[] = [];
    for (const f of readdirSync(SCANS).filter((f) => f.endsWith(".json")).sort()) {
      try {
        const raw: unknown = JSON.parse(readFileSync(join(SCANS, f), "utf8"));
        const doc = upgradeScan(raw, { shard: currentSettings.shard });
        const { ok, errors } = validateScan(doc);
        if (!ok) { console.warn(`skipping ${f}: ${errors.map((e) => `${e.path} ${e.msg}`).join("; ")}`); continue; }
        // doc passed validateScan — this is the one place a v2-shaped document earns the ScanV2 cast
        // (the ScanV2 rule: upgradeScan alone only proves UnvalidatedScan).
        out.push({ file: f, doc: doc as ScanV2 });
      } catch (e) { console.warn(`skipping ${f}: ${(e as Error).message}`); }
    }
    return out;
  }

  // getInventory() caches the fold (readScans + foldSnapshots) — the expensive part of every route that
  // needs the inventory — keyed by a signature of the scans directory (every *.json file's name, mtimeMs
  // and size, so an add/edit/delete/rename is caught with no restart), the current shard id (a shard
  // switch changes parseTooltip/classify via rules) and vault-lib.mts's own mtime (the same value lib()
  // already tracks for its dev-reload). /api/forget's tombstone is just another file landing in the scans
  // directory, so it invalidates the cache the same way — no separate invalidation path needed.
  // GET /api/update-check's last successful answer (see that route).
  const UPDATE_CHECK_TTL_MS = 60 * 60 * 1000;
  let updateCheckCache: { at: number; result: CheckForUpdatesResult } | null = null;

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
  // <data>/ui-prefs.json: the page's view choices (GET/PUT /api/ui-prefs). A missing, unreadable or
  // malformed file reads as "nothing chosen", and the page keeps its defaults.
  // Each field is read on its own: one bad value (a hand edit) drops that field, not the whole file.
  const UI_PREFS = join(CONFIG.dataDir, "ui-prefs.json");
  // The TazUO panel's hotkey and open-at-login choice (app/tazuo-panel.mts). TazUO's lscript.json is only
  // changed for a choice the player just made (`explicit`: a request that carried openAtLogin), or one
  // still pending: made while a client was running, here or with the in-game panel's toggle (which writes
  // tazuo-panel.json itself). Pending choices are retried at startup, when Settings asks (GET), on the next
  // save or install, and by a 30 s check of the file while the app runs. A plain reinstall never re-adds
  // a panel the player unticked in game. What was applied is written back as openAtLogin, and GET mirrors
  // TazUO's own list there when nothing is pending, so the panel's toggle shows the truth.
  const PANEL_PREFS = join(CONFIG.dataDir, "tazuo-panel.json");
  const tazuoScriptsDir = (): string | null => currentSettings.client?.adapter === "tazuo" && currentSettings.client.scriptsDir ? currentSettings.client.scriptsDir : null;
  function applyOpenAtLogin(explicit: boolean, mirror = false): AutostartOutcome | null {
    const dir = tazuoScriptsDir();
    if (CONFIG.demo || !dir) return null;
    const f = readPanelFile(PANEL_PREFS);
    if (!explicit && !f.pendingOpenAtLogin) {
      const on = mirror ? autostartOn(dir) : null;
      if (on != null && on !== f.openAtLogin && existsSync(PANEL_PREFS)) writePanelFile(PANEL_PREFS, { ...f, openAtLogin: on }, DATA_FILE_MODE);
      return null;
    }
    const r = syncOpenAtLogin(dir, f.openAtLogin, clientRunning);
    const pending = r.status === "pending";
    const openAtLogin = r.status === "error" ? autostartOn(dir) ?? f.openAtLogin : f.openAtLogin;
    if (pending !== f.pendingOpenAtLogin || openAtLogin !== f.openAtLogin) writePanelFile(PANEL_PREFS, { ...f, openAtLogin, pendingOpenAtLogin: pending }, DATA_FILE_MODE);
    return r;
  }
  // Save a subset of {hotkey, openAtLogin}, keeping the rest and any pending flag.
  function savePanel(change: object): void {
    const f = readPanelFile(PANEL_PREFS);
    writePanelFile(PANEL_PREFS, { ...f, ...panelPrefsOf({ ...f, ...change }) }, DATA_FILE_MODE);
  }
  function readUiPrefs(): UiPrefsFile {
    let raw: Record<string, unknown>;
    try { raw = JSON.parse(readFileSync(UI_PREFS, "utf8")) as Record<string, unknown>; } catch { return {}; }
    if (!raw || typeof raw !== "object") return {};
    const out: UiPrefsFile = {};
    for (const key of UI_PREF_LISTS) {
      const v = raw[key];
      if (Array.isArray(v) && v.every((c) => typeof c === "string")) out[key] = v as string[];
    }
    for (const [key, allowed] of Object.entries(UI_PREF_CHOICES)) {
      const v = raw[key];
      if (typeof v === "string" && (allowed as readonly string[]).includes(v)) out[key as keyof typeof UI_PREF_CHOICES] = v;
    }
    if (isColWidths(raw.colWidths)) out.colWidths = raw.colWidths;
    return out;
  }
  // <data>/scan-blacklist.json: the containers scans never open, a JSON list of {serial, name, addedAt,
  // where?} that TazUO's packrat-blacklist.py writes too. Only valid entries are read; anything else in
  // the file (or a file too big or unparseable) is dropped, and the next write leaves it out.
  const BLACKLIST = join(CONFIG.dataDir, "scan-blacklist.json");
  function readBlacklist(): BlacklistEntry[] {
    let raw: unknown;
    try { raw = lstatSync(BLACKLIST).size <= 256 * 1024 ? JSON.parse(readFileSync(BLACKLIST, "utf8")) : null; } catch { return []; }
    return (Array.isArray(raw) ? raw : []).filter((e): e is BlacklistEntry => !!e && typeof e === "object" && isBoundedInt(e.serial, 1, MAX_SERIAL)
      && isBoundedString(e.name, 64) && isBoundedString(e.addedAt, 40) && (e.where === undefined || isBoundedString(e.where, 64)))
      .slice(0, 1000).map(({ serial, name, addedAt, where }) => ({ serial, name, addedAt, ...(where ? { where } : {}) }));
  }
  // A profiles.json that does not parse (a write cut short before writes were atomic, or a bad hand
  // edit) used to answer every GET /api/profiles with a 500 until someone fixed the file by hand. It
  // is now moved aside the same way loadSettings() moves an unreadable settings.json, and the
  // defaults are seeded in its place, with a log line naming where the old file went.
  async function readProfiles(): Promise<ProfilesFile> {
    const seed = (): void => {
      mkdirSync(dirname(PROFILES), { recursive: true, mode: DATA_DIR_MODE });
      writeFileAtomic(PROFILES, readFileSync(DEFAULT_PROFILES, "utf8"), DATA_FILE_MODE);
    };
    if (!existsSync(PROFILES)) seed();
    let doc: unknown, why = "not a JSON object";
    try { doc = JSON.parse(readFileSync(PROFILES, "utf8")); }
    catch (e) {
      if (!(e instanceof SyntaxError)) throw e;   // an I/O failure is not a damaged file — leave it alone
      why = jsonErrorReason(e);
    }
    if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
      const aside = moveAside(PROFILES);
      seed();
      safeAppendLog(CONFIG.paths.log, `${new Date().toISOString()} profiles.json is unreadable (${why}); reseeded from the defaults — the old file was kept as ${aside}\n`);
      doc = JSON.parse(readFileSync(PROFILES, "utf8"));
    }
    // profiles.json is trusted, unvalidated file content at this point (the same trust readRules'
    // loadFile and readScans' upgradeScan extend to their own on-disk inputs) — migrateProfiles' own
    // loose ProfilesFile shape (every field optional) is what actually tolerates a malformed file.
    const { profiles, changed } = (await lib()).migrateProfiles(doc as ProfilesFile);
    if (changed) {
      const backup = join(dirname(PROFILES), `profiles.backup-${new Date().toISOString().slice(0, 10)}.json`);
      if (!existsSync(backup)) copyFileSync(PROFILES, backup);
      writeFileAtomic(PROFILES, JSON.stringify(profiles, null, 2) + "\n", DATA_FILE_MODE);
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
    // The stuck-build timer (budget + JOB_RUN_GRACE_MS); finish() clears it, so a finished job's
    // result is held by the retention timer alone rather than pinned by this one's closure too.
    stuckTimer: NodeJS.Timeout | null;
  }
  const jobs = new Map<string, Job>();
  // A finished job (done, failed or cancelled) stays readable for this long AFTER it finishes, so a
  // page that reconnects or reloads can still collect its result. This clock used to start with the
  // build and also cancel a build still running when it rang: a player's 15-minute budget (the route
  // accepts up to 60) was killed at 10:00, and a result finishing at 9:59 was dropped a second later.
  const JOB_RETENTION_MS = jobTimings.retentionMs ?? 10 * 60 * 1000;
  // A running build is only cancelled as stuck once it is this far past its own time budget (the
  // core's 15 s default when it names none) — never before the budget the route accepted for it. The
  // grace covers the heuristic restarts that run ahead of the exact phase's budget.
  const JOB_RUN_GRACE_MS = jobTimings.runGraceMs ?? 10 * 60 * 1000;
  const DEFAULT_TIME_BUDGET_MS = 15000;
  // Set by close(): a worker terminated by shutdown is not a failed build.
  let closing = false;
  // A server-wide ceiling on live worker threads, on top of the per-X-Client-Id supersede below: that
  // rule is skipped entirely when the header is absent, so a caller that omits (or rotates) it could
  // start arbitrarily many `new Worker()` threads, each holding its full result for JOB_RETENTION_MS
  // (post-review fix, Important 5). Four is well past what one page ever has in flight — it only ever
  // runs one build at a time — and leaves room for a couple of stale jobs a client has walked away from.
  const MAX_RUNNING_JOBS = 4;
  const timers = new Set<NodeJS.Timeout>();   // every setTimeout/setInterval this instance owns, so close() can stop them all

  // A folder dialog whose answer never comes back would otherwise hang this request for ever:
  // server.requestTimeout governs request RECEIPT only and never touches a response that has not
  // started. Bound it here and answer 504 instead of holding the socket open. The embedder bounds its
  // own half of the same call with the same 60 s (electron/pending-calls.mts, whose expiry rejects
  // with this very statusCode), so whichever side notices first the caller sees one answer — this is
  // not a second chance for a call the shell already gave up on (area-4 minor 5).
  const HOST_CALL_TIMEOUT_MS = 60 * 1000;
  function withHostTimeout<T>(p: Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const t = setTimeout(() => {
        const e = new Error("the desktop app did not answer") as HttpError;
        e.statusCode = 504;
        reject(e);
      }, HOST_CALL_TIMEOUT_MS);
      t.unref(); timers.add(t);
      const done = (): void => { clearTimeout(t); timers.delete(t); };
      p.then((v) => { done(); resolve(v); }, (e: unknown) => { done(); reject(e as Error); });
    });
  }

  // Job ids are crypto.randomUUID() (spec §4.5) rather than the old Date.now()-based id: the SSE
  // events route is exempt from the bearer token (EventSource can't carry one), so the id itself
  // must be unguessable — the events route's ownership check (below) is the other half of that.
  function startJob(input: JobInput, key: string, meta: Record<string, unknown>, clientId: string | string[] | null = null): Job {
    const id = randomUUID();
    const job: Job = { id, clientId, key, meta, input, state: "running", startedAt: Date.now(), progress: null, result: null, ms: null, error: null, runId: null, clients: new Set(), workers: new Set(), stuckTimer: null };
    jobs.set(id, job);
    runJob(job).catch((e) => {
      // Cancelled (or the server is shutting down): the terminated workers reject, nothing to report.
      if (job.state !== "running" || closing) return;
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
    const t = setTimeout(() => { timers.delete(t); job.stuckTimer = null; cancelJob(job); }, (input.opts.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS) + JOB_RUN_GRACE_MS);
    t.unref(); timers.add(t); job.stuckTimer = t;
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
  // The retention clock starts here, when the job ends — however it ends.
  function finish(job: Job, event: string, data: unknown): void {
    broadcast(job, event, data); for (const c of job.clients) c.end(); job.clients.clear();
    if (job.stuckTimer) { clearTimeout(job.stuckTimer); timers.delete(job.stuckTimer); job.stuckTimer = null; }
    const t = setTimeout(() => { jobs.delete(job.id); timers.delete(t); }, JOB_RETENTION_MS);
    t.unref(); timers.add(t);
  }
  function streamJob(job: Job, res: http.ServerResponse): void {
    res.writeHead(200, SSE_HEADERS);
    sse(res, "hello", jobSnapshot(job));   // catch-up: last progress, or the final outcome if it already ended
    if (job.state !== "running") { res.end(); return; }
    job.clients.add(res);
    const ping = setInterval(() => sse(res, "ping", { at: Date.now() }), 5000);
    ping.unref(); timers.add(ping);
    res.on("close", () => { clearInterval(ping); timers.delete(ping); job.clients.delete(res); });
  }

  // ---- saved runs: one JSON file per finished build in app/data/runs/ -------------------------------
  function readRuns(): SavedRun[] { return readRunFiles().map((r) => r.run); }
  function readRunFiles(): { file: string; run: SavedRun }[] {
    if (!existsSync(RUNS)) return [];
    const out: { file: string; run: SavedRun }[] = [];
    for (const f of readdirSync(RUNS).filter((f) => f.endsWith(".json"))) {
      // A run file is this app's own prior output, not third-party input, but it still gets the same
      // "trusted, cast at the read boundary" treatment as every other on-disk JSON file in this app.
      try { out.push({ file: f, run: normalizeRun(JSON.parse(readFileSync(join(RUNS, f), "utf8")) as SavedRun) }); } catch (e) { console.error(`skipping run ${f}: ${(e as Error).message}`); }
    }
    return out.sort((a, b) => String(b.run.createdAt).localeCompare(String(a.run.createdAt)));
  }

  // ---- retention (issue #28): old scans and saved runs, per settings.json's `retention` ----------------
  // Only files readScanFiles()/readRunFiles() read are ever candidates (a scan that fails validation or
  // a run that does not parse stays), only by their bare name inside scans/ or runs/, and only a
  // regular file: lstat, so a symlink is left alone rather than followed. Nothing is pruned under
  // --demo: its scans are the committed fixtures and its runs folder is still the player's own.
  // `refused`: old scans were due to go, but the fold without them differed, so every scan was kept.
  interface PrunePlan { scans: string[]; runs: string[]; refused: boolean }
  async function planPrune(): Promise<PrunePlan> {
    if (CONFIG.demo) return { scans: [], runs: [], refused: false };
    const r = retentionOf(savedSettings.retention);
    const scans = scansToPrune(readScanFiles(), (await lib()).foldSnapshots, r, Date.now());
    const runs = runsToPrune(readRunFiles().map(({ file, run }) => ({ file, character: String(run.character), createdAt: String(run.createdAt), label: String(run.label || "") })), r);
    return { scans: scans.files, runs, refused: scans.refused };
  }
  function removeFiles(dir: string, files: string[]): string[] {
    const removed: string[] = [];
    for (const f of files) {
      const p = join(dir, f);
      try {
        if (basename(f) !== f || !f.endsWith(".json") || !lstatSync(p).isFile()) continue;
        unlinkSync(p);
        removed.push(f);
      } catch (e) { safeAppendLog(CONFIG.paths.log, `${new Date().toISOString()} retention could not remove ${JSON.stringify(f)}: ${(e as Error).message}\n`); }
    }
    return removed;
  }
  // One prune at a time: each call waits for the one before it to finish.
  let pruning: Promise<unknown> = Promise.resolve();
  function pruneData(why: string): Promise<{ scans: number; runs: number; refused: boolean }> {
    const next = pruning.catch(() => {}).then(async () => {
      const plan = await planPrune();
      const scans = removeFiles(SCANS, plan.scans), runs = removeFiles(RUNS, plan.runs);
      const at = new Date().toISOString();
      if (plan.refused) safeAppendLog(CONFIG.paths.log, `${at} retention (${why}) kept every scan: the inventory folded without the old ones differed\n`);
      if (scans.length || runs.length) safeAppendLog(CONFIG.paths.log, `${at} retention (${why}) removed ${scans.length} scans ${JSON.stringify(scans)} and ${runs.length} runs ${JSON.stringify(runs)}\n`);
      if (scans.length) broadcastEvent("changed", { what: "inventory", at: Date.now() });
      if (runs.length) broadcastEvent("changed", { what: "runs", at: Date.now() });
      return { scans: scans.length, runs: runs.length, refused: plan.refused };
    });
    pruning = next;
    return next;
  }
  function saveRun(job: Job) {
    mkdirSync(RUNS, { recursive: true, mode: DATA_DIR_MODE });
    const meta = job.meta || {};
    const run = { id: job.id, key: job.key, character: meta.character || "?", createdAt: new Date().toISOString(), label: "",
      schemaVersion: 1, solverVersion: SOLVER_VERSION,
      settings: meta.settings || {}, inventoryStamp: meta.inventoryStamp || null, poolSize: meta.poolSize ?? null, skipped: meta.skipped || {},
      opts: stripOpts(job.input.opts), budgetMs: job.input.opts.timeBudgetMs ?? null, explored: job.progress?.explored ?? null,
      result: job.result, ms: job.ms };
    writeFileAtomic(join(RUNS, `${run.id}.json`), JSON.stringify(run), DATA_FILE_MODE);
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
      if (req.method === "GET" && url.pathname === "/favicon.png") return send(res, 200, readFileSync(join(HERE, "assets", "favicon.png")), "image/png");
      if (req.method === "GET" && url.pathname === "/logo-mark.png") return send(res, 200, readFileSync(join(HERE, "assets", "logo-mark.png")), "image/png");
      if (req.method === "GET" && url.pathname === "/vault-lib.mjs") return send(res, 200, readFileSync(join(WEB, "vault-lib.mjs"), "utf8"), "text/javascript");
      if (req.method === "GET" && url.pathname === "/item-query.mjs") return send(res, 200, readFileSync(join(WEB, "item-query.mjs"), "utf8"), "text/javascript");
      if (req.method === "GET" && url.pathname === "/scan-schema.mjs") return send(res, 200, readFileSync(join(WEB, "scan-schema.mjs"), "utf8"), "text/javascript");
      // The Import drawer's instant preview parses a paste with the server's own rule (app/paste-scan.mts).
      if (req.method === "GET" && url.pathname === "/paste-scan.mjs") return send(res, 200, readFileSync(join(WEB, "paste-scan.mjs"), "utf8"), "text/javascript");
      // scan-schema.mjs imports validate() from here — the browser resolves that relative import
      // against scan-schema.mjs's own served URL, so this needs its own static route too.
      if (req.method === "GET" && url.pathname === "/schema/validate.mjs") return send(res, 200, readFileSync(join(WEB, "schema", "validate.mjs"), "utf8"), "text/javascript");
      if (req.method === "GET" && url.pathname.startsWith("/ui/fonts/")) {
        // One flat folder of woff2 files and nothing else: the licence texts next to them, a subfolder or
        // a dot-dot never match the name pattern.
        const name = url.pathname.slice("/ui/fonts/".length);
        const f = join(HERE, "ui", "fonts", name);
        if (!FONT_NAME_RE.test(name) || !existsSync(f)) return send(res, 404, { ok: false, error: "not found" });
        return send(res, 200, readFileSync(f), "font/woff2");
      }
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
        if (query.group) { const g = result as ItemQueryGroups; return send(res, 200, { ok: true, total: g.total, stacks: g.stacks, pieces: g.pieces, offset: query.offset, limit: query.limit, groups: g.groups }); }
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
        mkdirSync(dirname(PROFILES), { recursive: true, mode: DATA_DIR_MODE });
        writeFileAtomic(PROFILES, JSON.stringify(body, null, 2) + "\n", DATA_FILE_MODE);
        return send(res, 200, { ok: true });
      }
      if (req.method === "GET" && url.pathname === "/api/ui-prefs") return send(res, 200, { ok: true, prefs: readUiPrefs() });
      if (req.method === "PUT" && url.pathname === "/api/ui-prefs") {
        // The page's own view choices (the Inventory tab's columns, the look, the sidebar). Kept here rather than in
        // the page's localStorage because the desktop app serves the page from a new port, and so a new
        // origin, on every launch. Only known fields, each checked, are written.
        const body = asObject(await readBody(req, { limit: 16e3 }));
        const next = readUiPrefs();
        for (const key of UI_PREF_LISTS) {
          if (!Object.prototype.hasOwnProperty.call(body, key)) continue;
          const v = body[key];
          if (!Array.isArray(v) || v.length > 200 || !v.every((c) => isBoundedString(c, 64))) return send(res, 400, { ok: false, error: `${key} must be a list of at most 200 keys` });
          next[key] = v as string[];
        }
        for (const [key, allowed] of Object.entries(UI_PREF_CHOICES)) {
          if (!Object.prototype.hasOwnProperty.call(body, key)) continue;
          const v = body[key];
          if (typeof v !== "string" || !(allowed as readonly string[]).includes(v)) return send(res, 400, { ok: false, error: `${key} must be one of ${allowed.join(", ")}` });
          next[key as keyof typeof UI_PREF_CHOICES] = v;
        }
        if (Object.prototype.hasOwnProperty.call(body, "colWidths")) {
          if (!isColWidths(body.colWidths)) return send(res, 400, { ok: false, error: "colWidths must map at most 200 column keys to whole widths from 40 to 1200 px" });
          next.colWidths = body.colWidths;
        }
        writeFileAtomic(UI_PREFS, JSON.stringify(next, null, 2) + "\n", DATA_FILE_MODE);
        return send(res, 200, { ok: true });
      }
      if (req.method === "GET" && url.pathname === "/api/settings") return send(res, 200, { ok: true, settings: currentSettings });
      if (req.method === "PUT" && url.pathname === "/api/settings") {
        // Any subset of {shard, setupDone, client} — Task 2 extended this route to carry the setup
        // wizard's own state without disturbing the shard-switch contract above it. Each field present
        // in the body is validated before ANYTHING is written (load-then-persist, same reasoning as
        // before: a rejected field must never partially land on disk or in memory), and every field is
        // now checked POSITIVELY — a string is a bounded string, a folder is a folder this server is
        // willing to read (post-review fix, area-3 finding 3: client.scriptsDir used to be persisted on
        // a bare typeof check, after which GET /api/setup readdir/readFileSync'd whatever it named on
        // every page load, hanging the whole single-threaded process on a FIFO and dialling out over
        // SMB for a UNC path). These three are the only fields this route persists.
        const body = asObject(await readBody(req));
        let nextRules = currentRules, nextFallback = rulesFallback;
        const hasShard = Object.prototype.hasOwnProperty.call(body, "shard");
        if (hasShard) {
          if (!isBoundedString(body.shard, 64)) return send(res, 400, { ok: false, error: "settings.shard must be a string" });
          try { nextRules = loadRules(body.shard, { userRulesDir: USER_RULES_DIR }); }
          catch { return send(res, 400, { ok: false, error: `unknown or invalid shard: ${body.shard}` }); }
          nextFallback = false;
        }
        if (Object.prototype.hasOwnProperty.call(body, "setupDone") && typeof body.setupDone !== "boolean") {
          return send(res, 400, { ok: false, error: "settings.setupDone must be a boolean" });
        }
        const hasRetention = Object.prototype.hasOwnProperty.call(body, "retention");
        const retentionBad = hasRetention ? retentionError(body.retention) : null;
        if (retentionBad) return send(res, 400, { ok: false, error: retentionBad });
        // undefined = the body said nothing about the client and the persisted one is left alone;
        // null = clear it (an explicit null, or a folder-transport client with an empty scriptsDir); an
        // object = a validated, RESOLVED {adapter, scriptsDir}. A paste-transport client has no scripts
        // folder, so it is kept with scriptsDir "" — what the wizard's finish() sends for one.
        let nextClient: ClientSettings | null | undefined;
        if (Object.prototype.hasOwnProperty.call(body, "client")) {
          const c = body.client;
          if (c === null) nextClient = null;
          else {
            const rec = (c && typeof c === "object" && !Array.isArray(c)) ? c as Record<string, unknown> : null;
            if (!rec || !isBoundedString(rec.adapter, 64) || typeof rec.scriptsDir !== "string" || rec.scriptsDir.length > MAX_PATH_LEN) {
              return send(res, 400, { ok: false, error: "settings.client must be null or {adapter, scriptsDir}" });
            }
            const adapter = rec.adapter;
            // Security (post-review fix): client.adapter must be a real, known adapter id before it can
            // ever reach installer.mts's path.join calls — see the /api/setup/install note below.
            const info = listAdapters(ADAPTERS_DIR).find((a) => a.id === adapter);
            if (!info) {
              return send(res, 400, { ok: false, error: `settings.client.adapter: unknown adapter "${adapter}"` });
            }
            if (info.transport === "paste") nextClient = { adapter, scriptsDir: "" };
            else if (!rec.scriptsDir.trim()) nextClient = null;
            else {
              // The same acceptance POST /api/setup/locate applies, so the wizard and a hand-written
              // settings PUT can never disagree about what a scripts folder is — and the RESOLVED
              // path is what gets persisted, not the raw body value.
              const located = validateScriptsDir(rec.scriptsDir, adapter);
              if (!located.ok) return send(res, 400, { ok: false, error: `settings.client.scriptsDir: ${NO_CLIENT_FOLDER}` });
              nextClient = { adapter, scriptsDir: located.scriptsDir };
            }
          }
        }
        // Only the fields this request carried reach settings.json (saveSettings): a startup fallback
        // for a field it did not name stays in memory, where it belongs.
        const changes: Partial<SettingsDoc> = {};
        if (hasShard) changes.shard = body.shard as string;
        if (Object.prototype.hasOwnProperty.call(body, "setupDone")) changes.setupDone = body.setupDone as boolean;
        if (nextClient !== undefined) changes.client = nextClient;
        if (hasRetention) changes.retention = { ...retentionOf(savedSettings.retention), ...(body.retention as object) };
        saveSettings(changes);
        currentRules = nextRules;
        rulesFallback = nextFallback;
        currentSettings = effectiveSettings();
        return send(res, 200, { ok: true, settings: currentSettings });
      }
      if (req.method === "GET" && url.pathname === "/api/tazuo-panel") {
        const autostart = applyOpenAtLogin(false, true);    // Settings opened: a waiting choice may land now
        const dir = tazuoScriptsDir(), f = readPanelFile(PANEL_PREFS);
        return send(res, 200, { ok: true, prefs: panelPrefsOf(f), pending: f.pendingOpenAtLogin, autostartOn: dir ? autostartOn(dir) : null, autostart });
      }
      if (req.method === "PUT" && url.pathname === "/api/tazuo-panel") {
        const body = asObject(await readBody(req, { limit: 8e3 }));
        const bad = panelPrefsError(body);
        if (bad) return send(res, 400, { ok: false, error: bad });
        if (CONFIG.demo) return send(res, 409, { ok: false, error: "demo data is read-only" });
        savePanel(body);
        const autostart = applyOpenAtLogin("openAtLogin" in body);
        return send(res, 200, { ok: true, prefs: panelPrefsOf(readPanelFile(PANEL_PREFS)), autostart });
      }
      if (req.method === "POST" && url.pathname === "/api/retention/cleanup") {
        // Settings › Data's Clean up now: {dryRun: true} counts what the pruning would remove (the
        // confirm dialog's sentence), {dryRun: false} removes it and says what went.
        // `refused`: old scans were kept because the inventory would have changed without them.
        const { dryRun } = asObject(await readBody(req, { limit: 8e3 }));
        if (typeof dryRun !== "boolean") return send(res, 400, { ok: false, error: "dryRun must be a boolean" });
        if (CONFIG.demo) return send(res, 409, { ok: false, error: "demo data is read-only" });
        if (dryRun) { const plan = await planPrune(); return send(res, 200, { ok: true, scans: plan.scans.length, runs: plan.runs.length, refused: plan.refused }); }
        return send(res, 200, { ok: true, ...await pruneData("clean up now") });
      }
      if (req.method === "GET" && url.pathname === "/api/rules") {
        return send(res, 200, { ok: true, shard: currentSettings.shard, rules: currentRules, available: listRules({ userRulesDir: USER_RULES_DIR }), fallback: rulesFallback });
      }
      // ---- Setup wizard (Task 2): adapter discovery, client-folder install, scan import, update check.
      if (req.method === "GET" && url.pathname === "/api/setup") {
        const adapters = listAdapters(ADAPTERS_DIR);
        const candidates: Record<string, string[]> = {}, available: Record<string, string | null> = {};
        for (const a of adapters) {
          candidates[a.id] = clientSearch.candidates(a);
          available[a.id] = installedVersion(join(ADAPTERS_DIR, a.id), a.id).version;
        }
        // installedVersion() runs against whatever path settings.json names, on every wizard/Settings
        // render. PUT /api/settings and POST /api/setup/install both validate that path now, and
        // installer.mts opens only regular files there (never following a symlink, never blocking on a
        // FIFO, bounded read) — so a hand-edited settings.json can no longer hang or over-read here.
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
          // the player's game client runs on. Lets the wizard/Import tab (app/ui/adapters.mts's
          // availableAdapters) hide a platform-restricted adapter (Razor Enhanced, Windows-only)
          // instead of offering a choice that can never work (Phase 6 final review, deferred minor).
          candidates, installed, available, dataDir: CONFIG.dataDir, platform: process.platform,
          // app/ui/bridge.mts's currentAdapter() falls back to this when settings.client is unset (a
          // hand-installed or Skip-through-the-wizard player) — see the bridgeAdapter() comment above.
          bridgeAdapter: bridgeAdapterField,
          dataDirCheck: dataDirCheck(),
          // Settings › Updates names the running version ("Pack Rat 0.1.0") before any update check.
          version: PACKAGE_JSON.version,
          // Whether POST /api/host/open-path can do anything: only the desktop shell opens a folder. The
          // page offers Open there and Copy path in a plain browser (npm start), instead of an Open that
          // answers 501 and vanishes.
          canOpenFolders: typeof host?.openPath === "function",
        });
      }
      if (req.method === "POST" && url.pathname === "/api/setup/locate") {
        const { adapter, dir } = asObject(await readBody(req, { limit: 8e3 }));
        // Security (post-review fix): adapter is only ever used in an error string by validateScriptsDir
        // itself, but every route taking an adapter id is checked against the real, known ids the same
        // way, so a caller can't probe with an arbitrary string here either.
        if (!listAdapters(ADAPTERS_DIR).some((a) => a.id === adapter)) return send(res, 400, { ok: false, error: `unknown adapter: ${short(adapter)}` });
        // Every refusal from here down is the same opaque line: this route's whole purpose is to say
        // yes or no about a folder the user picked, and validateScriptsDir's own messages name the
        // path they probed — which made that yes/no a filesystem oracle for any absolute path on the
        // machine (the body cap above is what bounds the path's length).
        const result = validateScriptsDir(dir, adapter);
        if (!result.ok) return send(res, 400, { ok: false, error: NO_CLIENT_FOLDER });
        return send(res, 200, { ok: true, scriptsDir: result.scriptsDir, installed: installedVersion(result.scriptsDir, adapter) });
      }
      if (req.method === "POST" && url.pathname === "/api/setup/install") {
        const { adapter, scriptsDir, panel } = asObject(await readBody(req, { limit: 8e3 }));
        // The wizard's panel choices ride along (app/tazuo-panel.mts), checked before anything is written.
        const panelBad = panel === undefined ? null : panelPrefsError(panel);
        if (panelBad) return send(res, 400, { ok: false, error: panelBad });
        // Security (post-review fix): adapter must be one of listAdapters()'s real ids before it can
        // reach installScripts, which joins it onto adaptersDir to find the scripts to copy — an
        // unchecked adapter (e.g. "../../../../tmp/evil") would otherwise let this route copy an
        // arbitrary packrat-*.py from anywhere on disk into the user's LegionScripts folder.
        // installScripts also re-validates the id itself (defence in depth), but the route rejects it
        // first so the error is the clear "unknown adapter" rather than installScripts' own message.
        if (!listAdapters(ADAPTERS_DIR).some((a) => a.id === adapter)) return send(res, 400, { ok: false, error: `unknown adapter: ${short(adapter)}` });
        // The destination goes through the SAME acceptance POST /api/setup/locate applies (post-review
        // fix, area-3 finding 4): the two halves of the wizard used to disagree about what a scripts
        // folder is — locate validated, install took the raw body value and only installScripts'
        // statSync().isDirectory() stood between it and the copy loop. What gets written to (and
        // persisted as the configured client) is validateScriptsDir's RESOLVED path, so a caller that
        // names a client root gets the nested scripts folder locate would have returned, not the root.
        const located = validateScriptsDir(scriptsDir, adapter);
        if (!located.ok) return send(res, 400, { ok: false, error: NO_CLIENT_FOLDER, code: "badDir" });
        const destDir = located.scriptsDir;
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
        const result = installScripts({ adapter, adaptersDir: ADAPTERS_DIR, scriptsDir: destDir, dataDir: CONFIG.dataDir, bridgeStatusPath: CONFIG.paths.bridgeStatusFor(adapter as string),
          log: (msg) => safeAppendLog(CONFIG.paths.log, `${new Date().toISOString()} setup-install ${msg}\n`) });
        if (!result.ok) {
          return send(res, result.code === "running" ? 409 : 400, { ok: false, error: result.error, code: result.code, installed: result.installed });
        }
        saveSettings({ client: { adapter: adapter as string, scriptsDir: destDir } });
        // Only the wizard sends `panel`; a Settings reinstall does not, and then only a pending choice is retried.
        if (panel !== undefined && !CONFIG.demo) savePanel(panel as object);
        const autostart = applyOpenAtLogin(panel !== undefined && "openAtLogin" in (panel as object));
        // pathsFile: what happened to packrat-paths.json on the way in (written/unchanged/kept/
        // backed-up) — installScripts no longer silently clobbers a hand-authored one, and the page
        // can say so.
        return send(res, 200, { ok: true, installed: result.installed, version: result.version, scriptsDir: destDir, pathsFile: result.pathsFile, autostart });
      }
      if (req.method === "POST" && url.pathname === "/api/import/paste") {
        // Capped at the watcher's own inbox limit: a bigger paste would be written, answered 200, and
        // then rejected by the watcher, so it is refused here instead.
        const { text, adapter } = asObject(await readBody(req, { limit: MAX_INBOX_BYTES, tooLargeMsg: "paste too large" }));
        // Same allowlist as every other adapter-taking route — adapter reaches
        // CONFIG.paths.inboxFor -> path.join, so it must be a real, known id before that.
        if (!listAdapters(ADAPTERS_DIR).some((a) => a.id === adapter)) return send(res, 400, { ok: false, error: `unknown adapter: ${short(adapter)}` });
        const parsed = parsePastedScan(text);
        if (!parsed.ok) return send(res, 400, { ok: false, error: parsed.error });
        // Post-review minor: `adapter` (which inbox the file gets filed under, from the Import tab's
        // picker) and `parsed.doc.adapter.id` (what the pasted document itself says it came from) can
        // disagree — a player who picks the wrong adapter in the dropdown before pasting, most likely
        // when only one client is configured and the picker is hidden (see ui/import.mts's
        // adapterPicker) so the mismatch has no visible cause. Harmless to the fold itself (nothing
        // downstream trusts which inbox a scan sat in over the document's own adapter block), but
        // worth surfacing rather than filing it silently — logged here, and returned as `warning` so
        // the Import tab can show it too.
        // The declared id is the pasted DOCUMENT's own field, so it is caller-controlled text: bounded
        // and JSON.stringify'd before it reaches a log line (post-review fix, Minor 10). A JSON string
        // escape (\n) survives parsePastedScan's literal-newline strip and parses into a real newline,
        // so raw interpolation let a caller forge as many correctly-timestamped log lines as it liked —
        // in the one file the 500-handler's `ref` scheme is built around.
        const declaredAdapter = parsed.doc?.adapter?.id ? short(parsed.doc.adapter.id) : undefined;
        const mismatch = declaredAdapter && declaredAdapter !== adapter;
        if (mismatch) {
          safeAppendLog(CONFIG.paths.log, `${new Date().toISOString()} import-paste warn: pasted into ${JSON.stringify(adapter)}'s inbox but the document declares adapter ${JSON.stringify(declaredAdapter)}\n`);
        }
        const { file, character } = writeScanToInbox({ doc: parsed.doc, adapter: adapter as string, paths: CONFIG.paths });
        // Nudge the watcher: there is no reason to make the player wait on fs.watch's debounce when the
        // file is already on disk.
        watchers.get(adapter as string)?.scanOnce();
        return send(res, 200, { ok: true, written: file, character,
          ...(mismatch ? { warning: `filed under "${adapter}", but this scan says it's from "${declaredAdapter}" — check the Adapter picker above` } : {}) });
      }
      if (req.method === "POST" && url.pathname === "/api/import/rescan") {
        asObject(await readBody(req, { limit: 8e3 }));   // {} — no fields read, but every POST still needs a declared JSON object body (readBody's content-type check, asObject's shape check)
        // scanOnce() recreates a deleted inbox and re-arms its watch; false means it could not sweep
        // at all (the reason is in the log), and that is reported rather than answered with ok: true.
        const adapters: string[] = [], failed: string[] = [];
        for (const [id, handle] of watchers) (handle.scanOnce() ? adapters : failed).push(id);
        if (failed.length) return send(res, 503, { ok: false, error: `could not sweep the inbox for ${failed.join(", ")} — see the log`, adapters, failed });
        return send(res, 200, { ok: true, adapters });
      }
      if (req.method === "GET" && url.pathname === "/api/update-check") {
        // Cached for an hour so every page load doesn't cost a GitHub round trip (and its unauthenticated
        // rate limit); a failed check is not cached, so the next request simply tries again.
        if (!updateCheckCache || Date.now() - updateCheckCache.at > UPDATE_CHECK_TTL_MS) {
          const result = await checkForUpdates({ current: PACKAGE_JSON.version, repo: repoFromPackage(PACKAGE_JSON) });
          if (result.error) return send(res, 200, { ok: true, ...result });
          updateCheckCache = { at: Date.now(), result };
        }
        return send(res, 200, { ok: true, ...updateCheckCache.result });
      }
      if (req.method === "POST" && url.pathname === "/api/host/pick-folder") {
        if (!host || typeof host.pickFolder !== "function") return send(res, 501, { ok: false, error: "not available outside the desktop app" });
        const { title } = asObject(await readBody(req, { limit: 8e3 }));
        // A dialog title is a short display string or nothing at all. Anything else — a non-string, or
        // a megabyte of text the 50 MB default body cap used to wave through — falls back to the
        // shell's own default rather than crossing two process hops into a native, app-modal dialog
        // the user is being asked to trust (post-review fix, area-4 minor 1).
        const path = await withHostTimeout(host.pickFolder(isBoundedString(title, 120) ? { title } : {}));
        return send(res, 200, { ok: true, path });
      }
      if (req.method === "POST" && url.pathname === "/api/host/open-path") {
        if (!host || typeof host.openPath !== "function") return send(res, 501, { ok: false, error: "not available outside the desktop app" });
        const { which } = asObject(await readBody(req, { limit: 8e3 }));
        if (which !== "data" && which !== "logs") return send(res, 400, { ok: false, error: 'which must be "data" or "logs"' });
        // The DISCRIMINATOR crosses the wire, not a resolved path (phase-7 security review, area-4
        // Important 1): the shell owns the two directories it maps "data"/"logs" to, so this process —
        // the lower-trust half of the split — cannot name a third thing for the OS to launch.
        await withHostTimeout(host.openPath(which));
        return send(res, 200, { ok: true });
      }
      if (req.method === "GET" && url.pathname === "/api/events") {
        res.writeHead(200, SSE_HEADERS);
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
        let { pools = {}, current = {}, profile, opts = {}, meta = {}, character = null, settings = {} } = asObject(await readBody(req)) as {
          pools?: Record<string, unknown>; current?: Record<string, unknown>; profile?: unknown; opts?: Record<string, unknown>;
          meta?: Record<string, unknown>; character?: unknown; settings?: Record<string, unknown>;
        };
        // Everything the caller sent is checked before anything is started (post-review fix, Important
        // 5): opts against a small allowlist of search options with real ranges, meta down to the five
        // fields saveRun() reads and a serialized-size cap, and — for the hand-built form below — the
        // pools/current element shapes the optimizer core assumes but never checks.
        if (!opts || typeof opts !== "object" || Array.isArray(opts)) return send(res, 400, { ok: false, error: "opts must be an object" });
        const badOpts = optsError(opts);
        if (badOpts) return send(res, 400, { ok: false, error: badOpts });
        if (!meta || typeof meta !== "object" || Array.isArray(meta)) return send(res, 400, { ok: false, error: "meta must be an object" });
        meta = pickMeta(meta);
        if (JSON.stringify(meta).length > META_MAX_BYTES) return send(res, 400, { ok: false, error: "meta is too large" });
        // The resist cap overrides a saved run is reopened and compared with (the page reads them back as the caps
        // the run was built with), held to the rule profiles.json's are.
        const badCaps = (await lib()).resistCapsError((meta.settings as Record<string, unknown> | undefined)?.resistCaps, "meta.settings.resistCaps");
        if (badCaps) return send(res, 400, { ok: false, error: badCaps });
        let skipped: Record<string, number> = {}, blocked: string[] = [];
        // The by-character form: the caller sends {character, settings} instead of building pools/current
        // itself, and the server runs buildPools() against the cached inventory — the same function and
        // the same defaults the page's own optimizerProfile() uses (ui/builder.mts), so a request built
        // this way and an equivalent hand-built {pools,current} request key identically (runKey below) and
        // reuse each other's saved runs.
        // character names a folded inventory key and lands in a saved run's own `character` field —
        // truthy-checked only, until this pass (see report).
        if (character != null && !isBoundedString(character, 64)) return send(res, 400, { ok: false, error: "character must be a string" });
        if (character) {
          // A `null` in any optional field (as a saved run's settings can carry — e.g. re-posted from
          // the runs drawer) means "use the default", exactly like an absent field, not "the value is
          // null": normalise both to absent BEFORE validation, so the type checks below and the
          // destructuring defaults treat null and undefined alike (post-review fix — null used to slip
          // past `!= null` and then either reach buildPools as a literal `strLimit: null` or throw when
          // an array field's null hit code expecting an array).
          const s = Object.fromEntries(Object.entries(settings || {}).filter(([, v]) => v != null));
          const badWeapons = (await lib()).excludeWeaponsError(s.excludeWeapons, "settings.excludeWeapons");
          if (badWeapons) return send(res, 400, { ok: false, error: badWeapons });
          for (const f of ["excludeTags", "excludeRoots", "excludeSkills", "lockedSlots"] as const) {
            if (s[f] != null && !Array.isArray(s[f])) return send(res, 400, { ok: false, error: `settings.${f} must be an array` });
          }
          for (const f of ["allowOthersWorn", "allowGargoyle", "medOnly"] as const) {
            if (s[f] != null && typeof s[f] !== "boolean") return send(res, 400, { ok: false, error: `settings.${f} must be a boolean` });
          }
          if (s.strLimit != null && typeof s.strLimit !== "number") return send(res, 400, { ok: false, error: "settings.strLimit must be a number" });
          const badSettingsCaps = (await lib()).resistCapsError(s.resistCaps, "settings.resistCaps");
          if (badSettingsCaps) return send(res, 400, { ok: false, error: badSettingsCaps });
          // Every field of `s` was checked above (when present); this cast is the trust boundary the
          // migration recipe describes — placed AFTER those checks, not instead of them. The four list
          // fields are `unknown[]` because Array.isArray() is all that ran on them: nothing looked at
          // their elements.
          const { allowOthersWorn = false, strLimit = Infinity, excludeTags = [], excludeRoots = [], allowGargoyle = false, medOnly = false, excludeWeapons = [], excludeSkills = [], lockedSlots = [] } = s as {
            allowOthersWorn?: boolean; strLimit?: number; excludeTags?: unknown[]; excludeRoots?: unknown[];
            allowGargoyle?: boolean; medOnly?: boolean; excludeWeapons?: string[]; excludeSkills?: unknown[]; lockedSlots?: unknown[];
          };
          // The hand-off to buildPools() and the slot loops below need element types, and nothing above
          // established any. These casts are that gap, written down in one place: today it is harmless
          // (every use is an includes()/Set lookup or an object key, which tolerate any element), and a
          // real element check would be a behaviour change that belongs to the security review.
          const tagList = excludeTags as string[], rootList = excludeRoots as Array<string | number>, skillList = excludeSkills as string[], lockedList = lockedSlots as string[];
          const { inv } = await getInventory();
          // buildPools would happily build pools from every other character's gear and save the run
          // under a name the inventory has never seen.
          if (!Object.hasOwn(inv.characters, character)) return send(res, 404, { ok: false, error: `no scans for character ${JSON.stringify(character)}` });
          const built = (await lib()).buildPools(inv, character, { allowOthersWorn, strength: strLimit, excludeTags: tagList, excludeRoots: rootList, excludeGargoyle: !allowGargoyle, medOnly, excludeWeapons, excludeSkills: skillList });
          pools = built.pools; current = built.current; blocked = built.blocked;
          skipped = Object.fromEntries(Object.entries(built.skipped).map(([k, v]) => [k, v.length]));
          for (const slot of blocked) delete current[slot];       // a worn piece the filters now rule out must not stay "current"
          for (const slot of lockedList) pools[slot] = [];        // a locked slot offers no alternatives — it always keeps current
          opts = { ...(opts as RunOpts), optionalSlots: DEFAULT_OPTIONAL_SLOTS.filter((slot) => !lockedList.includes(slot)) };
          // The saved run keeps the page's whole settings snapshot (floors, weights, race, search knobs:
          // the runs drawer labels, compares and re-applies runs from it), with the pool settings it
          // actually ran on written over it.
          meta = { ...meta, character, settings: { ...((meta.settings as Record<string, unknown> | undefined) || {}), ...s } };
        } else {
          // The hand-built form: pools/current came straight off the body, so this is where a literal
          // null candidate ({pools: {helmet: [null]}}) or an item with no props gets refused rather
          // than reaching the worker and ending the job in an internal-error ref. The by-character
          // form above builds both itself, so it needs no element check.
          const badPools = poolsError(pools) || currentError(current);
          if (badPools) return send(res, 400, { ok: false, error: badPools });
        }
        // profile is scored against in the worker; a string or a number would fail there, not here.
        if (!profile || typeof profile !== "object" || Array.isArray(profile)) return send(res, 400, { ok: false, error: "profile required" });
        const fullOpts = Object.assign({ seed: 2026, restarts: 200 }, opts as RunOpts);
        const key = runKey({ pools, current, profile, opts: fullOpts });
        const runs = readRuns();
        const hit = reusableRun(runs, key, fullOpts as { timeBudgetMs?: number });
        // §11c: warn (not block) once the candidate pool is large enough that the exact solver can
        // take a while — the page shows this line above the progress panel (Task 3).
        const poolSize = typeof meta.poolSize === "number" ? meta.poolSize : Object.values(pools).reduce((a: number, v) => a + (Array.isArray(v) ? v.length : 0), 0);
        // The by-character form doesn't hand the caller's meta a poolSize/skipped up front (unlike the
        // old form, whose client computes them itself — ui/builder.mts) — fill them in now so a saved
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
        // page's own ui/api.mts; a curl/test caller with no X-Client-Id is never deduped against itself.
        let previous: Job | null = null;
        if (headerClientId) {
          for (const j of jobs.values()) {
            if (j.clientId && j.clientId === headerClientId && j.state === "running") { previous = j; break; }
          }
        }
        // …and a server-wide ceiling behind it, for the callers the per-client rule can't see (see
        // MAX_RUNNING_JOBS). Checked BEFORE the supersede, counting the job it would replace as already
        // freed, so a refused request never cancels anything: a page that rebuilds while its own job
        // is still running never trips it, and one that does trip it keeps the build it had.
        let running = 0;
        for (const j of jobs.values()) if (j.state === "running" && j !== previous) running++;
        if (running >= MAX_RUNNING_JOBS) return send(res, 429, { ok: false, error: "too many builds are already running; try again in a moment" });
        if (previous) cancelJob(previous);
        const superseded = previous ? previous.id : null;
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
        // A run file that does not parse is reported for what it is — readRuns() already leaves it out
        // of the list — rather than a 500 on every open; DELETE still removes it.
        const readRun = (): SavedRun | null => {
          try { return normalizeRun(JSON.parse(readFileSync(f, "utf8")) as SavedRun); }
          catch (e) { if (e instanceof SyntaxError) return null; throw e; }
        };
        const DAMAGED_RUN = "that saved run's file is damaged and cannot be read; delete it";
        if (req.method === "GET") {
          const run = readRun();
          return run ? send(res, 200, { ok: true, run }) : send(res, 404, { ok: false, error: DAMAGED_RUN });
        }
        if (req.method === "DELETE") { unlinkSync(f); broadcastEvent("changed", { what: "runs", at: Date.now() }); return send(res, 200, { ok: true }); }
        if (req.method === "PUT") {
          const { label = "" } = asObject(await readBody(req, { limit: 8e3 }));
          // String() throws on an object with a null prototype or a throwing toString — a 500 plus a
          // stack for what is a one-line type check (post-review fix, Minor 13).
          if (typeof label !== "string") return send(res, 400, { ok: false, error: "label must be a string" });
          const run = readRun();
          if (!run) return send(res, 404, { ok: false, error: DAMAGED_RUN });
          run.label = label.slice(0, 120);
          writeFileAtomic(f, JSON.stringify(run), DATA_FILE_MODE);
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
        const cmd = asObject(await readBody(req, { limit: 64e3, tooLargeMsg: "bridge command too large" }));
        // Cheap bounded checks in front of the schema (post-review fix, Minor 9): a 500,000-character
        // name once took queue.jsonl to half a megabyte in one request. These are loose outer bounds on
        // what is even worth assembling; the contract's own, tighter limits (name maxLength 120, chain
        // maxItems 8 — the adapters' MAX_NAME/MAX_CHAIN) are enforced by the validate() call below,
        // now that app/schema/validate.mts implements both keywords.
        if (!isBoundedString(cmd.name, 200)) return send(res, 400, { ok: false, error: "name must be a string of at most 200 characters" });
        if (cmd.chain != null && (!Array.isArray(cmd.chain) || cmd.chain.length > 16)) return send(res, 400, { ok: false, error: "chain must be an array of at most 16 serials" });
        const id = randomUUID();
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
        // pos is `object|null` in the contract with no shape of its own, so the assembled line is
        // size-checked once at the end — the only bound the field-level checks above can't give.
        const text = JSON.stringify(line) + "\n";
        if (text.length > 4096) return send(res, 400, { ok: false, error: "bridge command too large" });
        const adapter = bridgeAdapter();
        mkdirSync(CONFIG.paths.bridgeFor(adapter), { recursive: true, mode: DATA_DIR_MODE });
        appendFileSync(CONFIG.paths.bridgeQueueFor(adapter), text, { mode: DATA_FILE_MODE });
        return send(res, 200, { ok: true, id });
      }
      if (req.method === "GET" && url.pathname === "/api/bridge/status") {
        const f = CONFIG.paths.bridgeStatusFor(bridgeAdapter());
        if (!existsSync(f)) return send(res, 200, { ok: true, online: false });
        try {
          const parsed: unknown = JSON.parse(readFileSync(f, "utf8"));
          // status.json is written by the adapter's own bridge script and is hand-editable; a file that
          // parses to an array, a string or a number would otherwise be spread into the response as
          // index keys. Anything but a plain object reads as "not running".
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return send(res, 200, { ok: true, online: false });
          const st = parsed as Record<string, unknown>;
          // The bridge's "alive" timestamp is either a legacy epoch-seconds number or an RFC 3339 string
          // (new format, Task 7) — accept both, and nothing else.
          const aliveMs = typeof st.alive === "number" ? st.alive * 1000 : typeof st.alive === "string" ? Date.parse(st.alive) : NaN;
          const age = st.alive != null && !Number.isNaN(aliveMs) ? (Date.now() - aliveMs) / 1000 : Infinity;
          // The file's own fields go first, so a stray ok/online/age in a hand-edited or foreign file
          // (the bridge schema allows none of them) can never override what this server computed.
          return send(res, 200, { ...st, ok: true, online: age < 8, age: Math.round(age) });
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
        // Four small scalar fields — no reason for this route to accept the 50 MB default, which is
        // what let a 200,000-character `name` become a 200 KB scan file (post-review fix, Important 4).
        const { root, name = "forgotten" } = asObject(await readBody(req, { limit: 8e3 }));
        // A non-numeric root used to pass this check (only truthiness was tested), writing a
        // tombstone whose roots[0].serial serializes to null — every later read then logs a schema
        // violation and the file accumulates forever while the user believes it worked (post-review
        // fix). root is a number or a string of decimal digits, nothing else: a bare +root coercion
        // let `true` through as serial 1, and 2**60 or "1e300" past the integer check into the
        // tombstone's own schema check, which is the 500 path. The ceiling is the scan contract's own.
        const serial = typeof root === "number" ? root : typeof root === "string" && /^\d{1,10}$/.test(root) ? Number(root) : NaN;
        if (!Number.isInteger(serial) || serial <= 0 || serial > MAX_SERIAL) return send(res, 400, { ok: false, error: "root required (positive integer serial)" });
        // `name` is the container's display label and goes straight into the document's roots[0].name,
        // which the scan contract requires to be a string — so a non-string used to write a file that
        // every later fold re-read and re-rejected ("/roots/0/name expected string"), for the life of
        // the install, while the user's Forget silently did nothing (post-review fix, Important 4).
        if (typeof name !== "string") return send(res, 400, { ok: false, error: "name must be a string" });
        const label = name.slice(0, 64).trim() || "forgotten";   // a display label, and the schema wants a non-empty one
        mkdirSync(SCANS, { recursive: true, mode: DATA_DIR_MODE });
        const stamp = new Date().toISOString();
        const snap = {
          schemaVersion: 2, character: "_vault", scannedAt: stamp,
          adapter: { id: "app", version: "1", client: "Pack Rat", clientVersion: null,
            capabilities: { layers: [], arms: false, bank: false, ground: false, nested: false, tooltips: "label", bridge: [] } },
          shard: currentSettings.shard, stats: {}, equipped: [],
          roots: [{ serial, kind: "ground", name: label, opened: true }], containers: {}, items: [],
        };
        // Nothing this route writes may be a file the fold then skips — check the assembled document
        // against the same contract readScans() checks every file against. A failure here is this
        // app's own bug, so it takes the 500-with-a-ref path and no file is written.
        const { ok: snapOk, errors: snapErrors } = validateScan(snap);
        if (!snapOk) throw new Error(`refusing to write an invalid tombstone: ${snapErrors.map((e) => `${e.path} ${e.msg}`).join("; ")}`);
        // One file per forgotten root, not one per click: the name used to carry the millisecond
        // timestamp, so a loop of Forget calls (or a user who forgets the same container twice) grew
        // <data>/scans/ without bound and slowed every later fold, since readScans() parses the whole
        // directory. Re-forgetting a root now replaces its tombstone with a newer scannedAt, which is
        // exactly what the fold wants anyway (newest scan of a root wins, by parseStamp — the file
        // name has never been what orders them).
        writeFileAtomic(join(SCANS, `_forget-${serial.toString(16)}.json`), JSON.stringify(snap), DATA_FILE_MODE);
        broadcastEvent("changed", { what: "inventory", by: req.headers["x-client-id"], at: Date.now() });
        return send(res, 200, { ok: true });
      }
      if (req.method === "GET" && url.pathname === "/api/blacklist") return send(res, 200, { ok: true, containers: readBlacklist() });
      if (req.method === "POST" && url.pathname === "/api/blacklist") {
        const { serial, name, where } = asObject(await readBody(req, { limit: 8e3 }));
        if (!isBoundedInt(serial, 1, MAX_SERIAL)) return send(res, 400, { ok: false, error: "serial required (positive integer)" });
        if (typeof name !== "string" || (where !== undefined && typeof where !== "string")) return send(res, 400, { ok: false, error: "name and where must be strings" });
        const entries = readBlacklist();
        if (entries.some((e) => e.serial === serial)) return send(res, 200, { ok: true });
        if (entries.length >= 1000) return send(res, 409, { ok: false, error: "the blacklist is full (1000 containers)" });
        const place = where?.slice(0, 64).trim();
        entries.push({ serial, name: name.slice(0, 64).trim() || "container", addedAt: new Date().toISOString(), ...(place ? { where: place } : {}) });
        writeFileAtomic(BLACKLIST, JSON.stringify(entries, null, 1) + "\n", DATA_FILE_MODE);
        return send(res, 200, { ok: true });
      }
      const unlist = req.method === "DELETE" ? /^\/api\/blacklist\/(\d{1,10})$/.exec(url.pathname) : null;
      if (unlist) {
        writeFileAtomic(BLACKLIST, JSON.stringify(readBlacklist().filter((e) => e.serial !== Number(unlist[1])), null, 1) + "\n", DATA_FILE_MODE);
        return send(res, 200, { ok: true });
      }
      if (req.method === "POST" && url.pathname === "/api/forget-character") {
        // A character tombstone: a `_vault` scan naming the character in `forgetCharacter`, which the
        // fold (vault-lib.mts's forgetCharacter) handles by dropping the character's card, worn set,
        // backpack and bank. Same demo refusal and validate-before-write rule as /api/forget above.
        if (CONFIG.demo) return send(res, 409, { ok: false, error: "demo data is read-only" });
        const { character } = asObject(await readBody(req, { limit: 8e3 }));
        if (!isBoundedString(character, 64) || character.startsWith("_")) return send(res, 400, { ok: false, error: "character required (a scanned character's name)" });
        // Only a character the inventory has: a tombstone per arbitrary name would pile up in scans/.
        if (!Object.hasOwn((await getInventory()).inv.characters, character)) return send(res, 404, { ok: false, error: `no scanned character named ${short(character)}` });
        mkdirSync(SCANS, { recursive: true, mode: DATA_DIR_MODE });
        const snap = {
          schemaVersion: 2, character: "_vault", scannedAt: new Date().toISOString(), forgetCharacter: character,
          adapter: { id: "app", version: "1", client: "Pack Rat", clientVersion: null,
            capabilities: { layers: [], arms: false, bank: false, ground: false, nested: false, tooltips: "label", bridge: [] } },
          shard: currentSettings.shard, stats: {}, equipped: [], roots: [], containers: {}, items: [],
        };
        const { ok: snapOk, errors: snapErrors } = validateScan(snap);
        if (!snapOk) throw new Error(`refusing to write an invalid tombstone: ${snapErrors.map((e) => `${e.path} ${e.msg}`).join("; ")}`);
        // One file per forgotten character (hex of the name: any name is a safe file name that way),
        // replaced with a newer stamp if the character is forgotten again.
        writeFileAtomic(join(SCANS, `_forget-char-${Buffer.from(character).toString("hex")}.json`), JSON.stringify(snap), DATA_FILE_MODE);
        broadcastEvent("changed", { what: "inventory", by: req.headers["x-client-id"], at: Date.now() });
        return send(res, 200, { ok: true });
      }
      send(res, 404, { ok: false, error: "not found" });
    } catch (e) {
      if (e && (e as HttpError).statusCode) {
        const status = (e as HttpError).statusCode!;
        // A 413 means the upload was refused: readBody kept nothing past the cap and only rejects once
        // the request has ended (or, past OVERFLOW_DRAIN_BYTES of overflow, destroys the socket), and
        // `connection: close` retires the connection once the refusal is on the wire (post-review fix,
        // Minor 7). Waiting for the end is what lets a client that was still writing its body read this
        // 413 at all. Node merges this header with the ones send() passes to writeHead().
        if (status === 413) res.setHeader("connection", "close");
        return send(res, status, { ok: false, error: (e as HttpError).message });
      }
      // Stack-free 500 (spec §4.5): the client gets a short ref, never the stack; the stack goes to
      // the log file keyed by that same ref, so a bug report only needs the ref to be actionable.
      const ref = randomUUID().slice(0, 8);
      safeAppendLog(CONFIG.paths.log, `${new Date().toISOString()} ${ref} ${req.method} ${url.pathname}\n${(e && (e as Error).stack) || e}\n`);
      send(res, 500, { ok: false, error: "internal error", ref });
    }
  });

  // Both of these used to be 0 (disabled), justified by "exact searches can legitimately run for
  // minutes" — but that is about the RESPONSE side, which neither of them governs: requestTimeout is
  // the ceiling on RECEIVING a request, and headersTimeout the ceiling on receiving its headers, so a
  // socket that sent half a request line and then stopped was never closed at all (post-review fix,
  // Minor 7 — slowloris). Node's own defaults are the right values here. Probe-verified that an SSE
  // response outlives requestTimeout: the request itself completed on connect, so no per-route
  // exemption is needed for GET /api/events or the per-job optimize stream. server.timeout (the idle
  // socket timeout, which WOULD cut a long-lived stream) stays disabled.
  server.requestTimeout = 300_000; server.headersTimeout = 60_000; server.timeout = 0;
  await new Promise<void>((resolve, reject) => {
    const onError = (e: Error) => { server.off("listening", onListening); reject(e); };
    const onListening = () => { server.off("error", onError); resolve(); };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(CONFIG.port, "127.0.0.1");
  });
  startWatchers();
  // A choice that was waiting on a running client when the app last saved it.
  const pendingPanel = applyOpenAtLogin(false);
  if (pendingPanel?.status === "error") safeAppendLog(CONFIG.paths.log, `${new Date().toISOString()} tazuo-panel (startup): ${pendingPanel.error}\n`);
  // The player usually quits TazUO with the app open, and the panel's toggle writes a pending choice
  // behind the app's back: a cheap read of tazuo-panel.json every 30 s, which acts only on a pending one.
  const panelRetry = setInterval(() => { try { applyOpenAtLogin(false); } catch { /* next time */ } }, 30_000);
  panelRetry.unref();
  timers.add(panelRetry);
  pruneData("startup").catch((e: Error) => safeAppendLog(CONFIG.paths.log, `${new Date().toISOString()} retention (startup) failed: ${e.stack || e.message}\n`));
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
      // closing first: a build still running when the server quits ends because of the quit, and its
      // worker's exit must not be logged as an internal error with a ref (a phantom crash in every
      // server.log attached to a bug report after a quit mid-build).
      closing = true;
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
