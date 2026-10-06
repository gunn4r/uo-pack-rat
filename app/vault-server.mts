// vault-server.mts — Pack Rat local server. No npm imports of its own (the one runtime dependency, HiGHS, is loaded in the optimize worker, through app/mip-solve.mts).
//   node app/vault-server.mts [--data <dir>] [--port N] [--demo] [--open]
// Exports startServer(config) → { server, port, url, close() } — nothing runs at import time, so a
// test (or another launcher) can start and stop as many independent instances as it likes. The file
// also self-starts when run directly (node app/vault-server.mts / node scripts/start.mts).
// Routes: app/http/routes/, one module per area, tried in order through app/http/router.mts; docs/architecture.md
// (HTTP routes) lists every route and what it takes and answers. This file is the composition root: it reads the
// config, builds the stores, services and route table, runs the Host/Origin/token middleware, dispatches, maps
// errors, listens and closes.
// Every text/html response carries the Content-Security-Policy (app/http/respond.mts, including frame-ancestors
// 'none'); every response carries x-content-type-options: nosniff and x-frame-options: DENY. Any
// PUT/POST whose body is read must declare content-type: application/json, else 415 (readBody()) —
// the SSE cancel beacon sends no body, so it's exempt — and its body must be a JSON OBJECT, else 400
// (asObject()). Files and directories this server creates are 0600/0700 (a no-op on Windows).
// The optimizer is scripts/optimizer-core.mts, run straight from source (no build step) — every
// caller imports it from the one path config.mts's paths.core/corePath() resolves (PACKRAT_CORE
// overrides it).
// Localhost security (docs/architecture.md's "The server's request checks" has the full writeup): every request's
// Host must name this server and its Origin (if any) must match, or 403; with CONFIG.token set,
// every /api/* route but the SSE events stream needs `Authorization: Bearer <token>`, or 401 — the
// bare `node app/vault-server.mts` path runs with no token at all. PUT /api/profiles is capped at 1 MB
// and schema-checked (app/schema/profiles.v3.schema.json). One running optimize job per X-Client-Id
// (a second POST cancels the first and reports {superseded}); job ids are crypto.randomUUID() and the
// events route checks the job's own id against a ?client= query param instead of the token. A route
// that throws returns {error:"internal error", ref} with the stack only in CONFIG.paths.log, keyed by ref.

import http from "node:http";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { randomUUID, timingSafeEqual } from "node:crypto";
import type { AddressInfo } from "node:net";
import { startWatcher, type StartWatcherOptions, type WatcherHandle } from "./watcher.mts";
import { createMcp } from "./mcp.mts";
import type { HttpError } from "./read-body.mts";
import { createScansStore } from "./store/scans.mts";
import { createRunsStore } from "./store/runs.mts";
import { createOrganizeStore } from "./store/organize.mts";
import { createOrganizeStateStore } from "./store/organize-state.mts";
import { createItemKindsStore } from "./store/item-kinds.mts";
import { createBlacklistStore } from "./store/blacklist.mts";
import { createProfilesStore } from "./store/profiles.mts";
import { createUiPrefsStore } from "./store/ui-prefs.mts";
import { createSettingsStore } from "./store/settings.mts";
import { createSettingsService } from "./services/settings.mts";
import { createEventBus } from "./services/events.mts";
import { createSetupService } from "./services/setup.mts";
import { createHousesService } from "./services/houses.mts";
import { createRetentionService } from "./services/retention.mts";
import { createInventoryService } from "./services/inventory.mts";
import { createOrganizeService } from "./services/organize.mts";
import { createJobsService, type JobTimings } from "./services/jobs.mts";
export type { JobTimings } from "./services/jobs.mts";
import { send } from "./http/respond.mts";
import { dispatch, type Route } from "./http/router.mts";
import type { ClientSearch, HostBridge, ServerContext } from "./http/context.mts";
export type { HostBridge, ClientSearch } from "./http/context.mts";
export { OPTS_LIMITS } from "./http/routes/optimize.mts";
import { routes as staticRoutes } from "./http/routes/static.mts";
import { routes as inventoryRoutes } from "./http/routes/inventory.mts";
import { routes as prefsRoutes } from "./http/routes/prefs.mts";
import { routes as settingsRoutes } from "./http/routes/settings.mts";
import { routes as setupRoutes } from "./http/routes/setup.mts";
import { routes as importRoutes } from "./http/routes/import.mts";
import { routes as hostRoutes } from "./http/routes/host.mts";
import { routes as optimizeRoutes } from "./http/routes/optimize.mts";
import { routes as mcpRoutes } from "./http/routes/mcp.mts";
import { routes as bridgeRoutes } from "./http/routes/bridge.mts";
import { routes as forgetRoutes } from "./http/routes/forget.mts";
import { routes as blacklistRoutes } from "./http/routes/blacklist.mts";
import { routes as housesRoutes } from "./http/routes/houses.mts";
import { routes as kindsRoutes } from "./http/routes/kinds.mts";
import { routes as organizeRoutes } from "./http/routes/organize.mts";
import { readPanelPrefs, tazuoRunning, writePanelPrefs } from "./tazuo-panel.mts";
import { PUT_AWAY_REQUEST } from "./put-away.mts";
import type {  } from "./house-capture.mts";
import { candidateClientRoots, type FetchLike } from "./installer.mts";
import { dataDirNotice } from "./data-dir-notice.mts";
import { safeAppendLog } from "./log.mts";
import { homedir } from "node:os";

import { resolveConfig, ensureLayout, APP_DIR, DATA_FILE_MODE, type Config } from "./config.mts";
const HERE = APP_DIR;
// package.json content, handed to us already-parsed — the only fields this file reads off it
// (version, repository) are trusted the same way installer.mts's repoFromPackage trusts its own
// `pkg: unknown` parameter; this cast is the boundary.
const PACKAGE_JSON = JSON.parse(readFileSync(join(HERE, "..", "package.json"), "utf8")) as { version: string; repository?: unknown };

// Localhost security (spec §4.5): a request's Host must name this server, an Origin (when present)
// must be this same origin, and — with a token configured — every /api/* route except the SSE
// events stream (EventSource cannot carry an Authorization header; see below) must present it. None
// of this applies to the bare `node app/vault-server.mts` path, which runs with CONFIG.token null.
const EVENTS_ROUTE_RE = /^\/api\/optimize\/[\w-]+\/events$/;

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
  // The fetch GET /api/update-check asks GitHub with; a test supplies its own so the suite never calls GitHub.
  updateFetch?: FetchLike | undefined;
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
export async function startServer(config: Config = ensureLayout(resolveConfig()), { host, clientSearch = defaultClientSearch(), watcherOptions = {}, jobTimings = {}, clientRunning = () => tazuoRunning(), updateFetch = fetch }: StartServerOptions = {}): Promise<ServerHandle> {
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

  function startupWarning(msg: string): void {
    console.warn(msg);
    safeAppendLog(CONFIG.paths.log, `${new Date().toISOString()} startup-fallback ${msg}\n`);
  }
  const setupService = createSetupService({ adaptersDir: ADAPTERS_DIR, dataDir: CONFIG.dataDir, demo: CONFIG.demo, clientSearch });
  const appSettings = createSettingsService({ store: createSettingsStore({ file: SETTINGS, warn: startupWarning }), rulesDir: USER_RULES_DIR,
    isKnownAdapter: setupService.isKnown, warn: startupWarning });

  const dataDirWarning = dataDirNotice(setupService.dataDirCheck(appSettings.current().client));
  if (dataDirWarning) console.warn(dataDirWarning);

  // ---- /api/events: one shared SSE stream, fed by one app/watcher.mts per adapter ------------------
  // Non-demo only — --demo's paths.scans is the committed app/fixtures/, which a watcher must never
  // write into. Each adapter is a directory under adapters/ that ships a capabilities.json; today
  // that's just adapters/tazuo/. watchers: id -> {close(), scanOnce()}; eventBus: every response
  // currently attached to GET /api/events, so a later accept/reject can broadcast to all of them.
  const watchers = new Map<string, WatcherHandle>();
  const eventBus = createEventBus();
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
        // getShard reads appSettings.current().shard live, per ingest — not captured once here — so a
        // PUT /api/settings shard switch takes effect on the very next dropped file (app/watcher.mts).
        inboxDir: CONFIG.paths.inboxFor(id), adapter: id, scansDir: SCANS, getShard: () => appSettings.current().shard,
        log: (msg) => safeAppendLog(CONFIG.paths.log, `${new Date().toISOString()} watcher[${id}] ${msg}\n`),
        onAccepted: ({ file, character, scannedAt }) => eventBus.broadcast("inventory", { file, character, scannedAt, at: Date.now() }),
        onRejected: ({ file, reason }) => eventBus.broadcast("rejected", { file, reason, at: Date.now() }),
        request: { name: PUT_AWAY_REQUEST, handle: (path) => organizeService.putAway(id, path) },
        ...watcherOptions,
      });
      watchers.set(id, handle);
    }
  }

  const scanStore = createScansStore({ dir: SCANS, shard: () => appSettings.current().shard });
  const houseService = createHousesService({ settings: appSettings.current });

  const uiPrefsStore = createUiPrefsStore(join(CONFIG.dataDir, "ui-prefs.json"));
  // The TazUO panel's hotkey and show-at-login choice (app/tazuo-panel.mts); the in-game panel writes it too.
  const PANEL_PREFS = join(CONFIG.dataDir, "tazuo-panel.json");
  const savePanel = (change: object): void => writePanelPrefs(PANEL_PREFS, { ...readPanelPrefs(PANEL_PREFS), ...change }, DATA_FILE_MODE);
  const blacklistStore = createBlacklistStore(join(CONFIG.dataDir, "scan-blacklist.json"));
  const itemKindsStore = createItemKindsStore(join(CONFIG.dataDir, "item-kinds.json"));
  const organizeStore = createOrganizeStore(join(CONFIG.dataDir, "organize.json"));
  const organizeStateStore = createOrganizeStateStore(join(CONFIG.dataDir, "organize-state.json"));
  // ---- saved runs: one JSON file per finished build in app/data/runs/ -------------------------------
  const runStore = createRunsStore(RUNS);
  const jobService = createJobsService({ coreUrl: CORE_URL, timings: jobTimings, runStore, log: (line) => safeAppendLog(CONFIG.paths.log, line) });
  const organizeService = createOrganizeService({ paths: CONFIG.paths, getInventory: () => getInventory(), organizeStore, organizeStateStore, blacklistStore, runStore,
    rules: appSettings.rules, runsTrips: setupService.runsTrips, events: eventBus, log: (line) => safeAppendLog(CONFIG.paths.log, line) });
  // Organize is built first, so the harvest hook below never reaches it before it exists; it reads the inventory through a getter.
  const inventoryService = createInventoryService({ scanStore, itemKindsStore, organizeStateStore, shard: () => appSettings.current().shard, harvest: (now) => organizeService.harvestNow(now) });
  const getInventory = inventoryService.getInventory;
  const profilesStore = createProfilesStore({ file: PROFILES, defaults: DEFAULT_PROFILES, templatesDir: CONFIG.paths.builtinTemplates, shard: () => appSettings.current().shard,
    log: (line) => safeAppendLog(CONFIG.paths.log, line), uiPrefs: uiPrefsStore });
  const timers = new Set<NodeJS.Timeout>();   // the host-call timeouts and stream pings the routes own, so close() can stop them all; the jobs service clears its own

  // ---- retention (issue #28): old scans and saved runs, per settings.json's `retention` ----------------
  const retentionService = createRetentionService({ demo: CONFIG.demo, retention: () => appSettings.saved().retention, scanStore, runStore, events: eventBus,
    log: (line) => safeAppendLog(CONFIG.paths.log, line) });

  // The built-in MCP server (app/mcp.mts, issue #211): its own listener and token, opened once this server listens
  // (when mcp.json says on) and on PUT /api/mcp; its tools call this server's routes over loopback.
  const mcp = createMcp({ file: CONFIG.paths.mcp, version: PACKAGE_JSON.version, appPort: () => (server.address() as AddressInfo).port, appToken: CONFIG.token,
    log: (line) => safeAppendLog(CONFIG.paths.log, line.endsWith("\n") ? line : `${new Date().toISOString()} ${line}\n`) });

  // Every route, in the order the server tries them (app/http/routes/; docs/architecture.md lists them).
  const ctx: ServerContext = { config: CONFIG, host, clientSearch, clientRunning, updateFetch, packageJson: PACKAGE_JSON, appSettings, setupService, eventBus, houseService,
    retentionService, jobService, organizeService, getInventory, profilesStore, uiPrefsStore, blacklistStore, itemKindsStore, organizeStore, organizeStateStore, runStore,
    panelPrefsFile: PANEL_PREFS, savePanel, watchers, timers, mcp };
  const routes: Route[] = [staticRoutes, inventoryRoutes, prefsRoutes, settingsRoutes, setupRoutes, importRoutes, hostRoutes, optimizeRoutes, mcpRoutes, bridgeRoutes,
    forgetRoutes, blacklistRoutes, housesRoutes, kindsRoutes, organizeRoutes].flatMap((make) => make(ctx));

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
      if (await dispatch(routes, req, res, url, ctx)) return;
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
  await mcp.start();
  retentionService.prune("startup").catch((e: Error) => safeAppendLog(CONFIG.paths.log, `${new Date().toISOString()} retention (startup) failed: ${e.stack || e.message}\n`));
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
    close: () => mcp.close().then(() => new Promise<void>((ok) => {
      for (const t of timers) clearTimeout(t);   // clearTimeout also clears intervals (same id space)
      timers.clear();
      // closing first: a build still running when the server quits ends because of the quit, and its
      // worker's exit must not be logged as an internal error with a ref (a phantom crash in every
      // server.log attached to a bug report after a quit mid-build).
      jobService.stop();
      for (const w of watchers.values()) w.close();
      // server.close() waits for every connection "waiting for a response" — an attached SSE stream
      // is one, and would otherwise hold teardown open until its keep-alive idle timeout. End every
      // open stream (both the per-job optimize streams and the shared /api/events stream) and
      // force-close the sockets so close() resolves promptly.
      jobService.endStreams();
      eventBus.close();
      server.closeAllConnections();
      // ok's declared parameter type (void | PromiseLike<void>) is narrower than server.close()'s own
      // callback type (err?: Error) — this server always calls it with no error at this point in a
      // controlled shutdown, so passing the SAME function through an erased cast changes nothing at
      // runtime.
      server.close(ok as (err?: Error) => void);
    })),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await startServer(); } catch (e) { console.error((e as Error).message); process.exit(2); }
}
