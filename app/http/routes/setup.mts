// setup.mts — the setup wizard: GET /api/setup, GET /api/setup/scanner, POST /api/setup/locate and /api/setup/install, and GET /api/update-check.
import { join } from "node:path";
import { short } from "../../guards.mts";
import { validateScriptsDir, installedVersion, installScripts, pasteScanner, repoFromPackage, checkForUpdates, type CheckForUpdatesResult } from "../../installer.mts";
import { safeAppendLog } from "../../log.mts";
import { readBody } from "../../read-body.mts";
import { addPanelAutostart, panelPrefsError } from "../../tazuo-panel.mts";
import { send, asObject } from "../respond.mts";
import type { Route } from "../router.mts";
import type { ServerContext } from "../context.mts";

export const MAX_PATH_LEN = 4096;
// What a failed locate/install tells the caller. Deliberately says nothing about the path it probed:
// echoing the resolved path back made these routes a clean existence oracle for any absolute path on
// the machine — "existing directory" vs "file or absent", for free, from an unauthenticated route in
// the bare `npm start` configuration (post-review fix, Important 3).
export const NO_CLIENT_FOLDER = "no scripts folder found there for that client";

export function routes(ctx: ServerContext): Route[] {
  const { config: CONFIG, appSettings, clientRunning, clientSearch, host, packageJson: PACKAGE_JSON, savePanel, setupService, updateFetch } = ctx;
  const ADAPTERS_DIR = setupService.adaptersDir;
  // GET /api/update-check's last successful answer (see that route).
  const UPDATE_CHECK_TTL_MS = 60 * 60 * 1000;
  let updateCheckCache: { at: number; result: CheckForUpdatesResult } | null = null;
  return [
    // ---- Setup wizard (Task 2): adapter discovery, client-folder install, scan import, update check.
    { method: "GET", path: "/api/setup", handle: (_req, res) => {
      const adapters = setupService.adapters();
      const candidates: Record<string, string[]> = {}, available: Record<string, string | null> = {};
      for (const a of adapters) {
        candidates[a.id] = clientSearch.candidates(a);
        available[a.id] = installedVersion(join(ADAPTERS_DIR, a.id), a.id).version;
      }
      // installedVersion() runs against whatever path settings.json names, on every wizard/Settings
      // render. PUT /api/settings and POST /api/setup/install both validate that path now, and
      // installer.mts opens only regular files there (never following a symlink, never blocking on a
      // FIFO, bounded read) — so a hand-edited settings.json can no longer hang or over-read here.
      const client = appSettings.current().client;
      const installed = client ? installedVersion(client.scriptsDir, client.adapter) : null;
      // The id appSettings.bridgeAdapter() is ACTUALLY routing POST /api/bridge / GET /api/bridge/status to right
      // now — reused, not restated, so this can never drift from the real routing decision. Guarded
      // to null when that id doesn't name a real discovered adapter (a test's throwaway --adapters
      // dir with no "tazuo" in it, say): reporting an id nothing can resolve would just move the
      // "buttons for an adapter that doesn't exist" bug onto the page instead of fixing it.
      const resolvedBridgeAdapter = appSettings.bridgeAdapter();
      const bridgeAdapterField = adapters.some((a) => a.id === resolvedBridgeAdapter) ? resolvedBridgeAdapter : null;
      return send(res, 200, {
        ok: true, firstRun: !appSettings.current().setupDone, settings: appSettings.current(), adapters,
        // platform: this machine's process.platform — on this desktop app, always the same machine
        // the player's game client runs on. Lets the wizard/Import tab (app/ui/adapters.mts's
        // availableAdapters) hide a platform-restricted adapter (Razor Enhanced, Windows-only)
        // instead of offering a choice that can never work (Phase 6 final review, deferred minor).
        candidates, installed, available, dataDir: CONFIG.dataDir, platform: process.platform,
        // app/ui/bridge.mts's currentAdapter() falls back to this when settings.client is unset (a
        // hand-installed or Skip-through-the-wizard player) — see the appSettings.bridgeAdapter() comment above.
        bridgeAdapter: bridgeAdapterField,
        dataDirCheck: setupService.dataDirCheck(appSettings.current().client),
        // Settings › Updates names the running version ("Pack Rat 0.1.0") before any update check.
        version: PACKAGE_JSON.version,
        // Whether POST /api/host/open-path can do anything: only the desktop shell opens a folder. The
        // page offers Open there and Copy path in a plain browser (npm start), instead of an Open that
        // answers 501 and vanishes.
        canOpenFolders: typeof host?.openPath === "function",
      });
    } },
    { method: "GET", path: "/api/setup/scanner", handle: (_req, res, url) => {
      // Read-only and path-free: the id must name a known paste-transport adapter, and the script is that
      // adapter's own bundled packrat-scanner.ts (installer.mts's pasteScanner).
      const adapter = url.searchParams.get("adapter");
      if (!setupService.adapters().some((a) => a.id === adapter && a.transport === "paste")) return send(res, 400, { ok: false, error: `unknown paste adapter: ${short(adapter)}` });
      const scanner = pasteScanner(ADAPTERS_DIR, adapter as string);
      if (!scanner) return send(res, 404, { ok: false, error: "this build ships no scanner for that client" });
      return send(res, 200, { ok: true, ...scanner });
    } },
    { method: "POST", path: "/api/setup/locate", handle: async (req, res) => {
      const { adapter, dir } = asObject(await readBody(req, { limit: 8e3 }));
      // Security (post-review fix): adapter is only ever used in an error string by validateScriptsDir
      // itself, but every route taking an adapter id is checked against the real, known ids the same
      // way, so a caller can't probe with an arbitrary string here either.
      if (!setupService.adapters().some((a) => a.id === adapter)) return send(res, 400, { ok: false, error: `unknown adapter: ${short(adapter)}` });
      // Every refusal from here down is the same opaque line: this route's whole purpose is to say
      // yes or no about a folder the user picked, and validateScriptsDir's own messages name the
      // path they probed — which made that yes/no a filesystem oracle for any absolute path on the
      // machine (the body cap above is what bounds the path's length).
      const result = validateScriptsDir(dir, adapter, ADAPTERS_DIR);
      if (!result.ok) return send(res, 400, { ok: false, error: NO_CLIENT_FOLDER });
      return send(res, 200, { ok: true, scriptsDir: result.scriptsDir, installed: installedVersion(result.scriptsDir, adapter) });
    } },
    { method: "POST", path: "/api/setup/install", handle: async (req, res) => {
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
      if (!setupService.adapters().some((a) => a.id === adapter)) return send(res, 400, { ok: false, error: `unknown adapter: ${short(adapter)}` });
      // The destination goes through the SAME acceptance POST /api/setup/locate applies (post-review
      // fix, area-3 finding 4): the two halves of the wizard used to disagree about what a scripts
      // folder is — locate validated, install took the raw body value and only installScripts'
      // statSync().isDirectory() stood between it and the copy loop. What gets written to (and
      // persisted as the configured client) is validateScriptsDir's RESOLVED path, so a caller that
      // names a client root gets the nested scripts folder locate would have returned, not the root.
      const located = validateScriptsDir(scriptsDir, adapter, ADAPTERS_DIR);
      if (!located.ok) return send(res, 400, { ok: false, error: NO_CLIENT_FOLDER, code: "badDir" });
      const destDir = located.scriptsDir;
      // bridgeStatusPath is THIS adapter's own bridge status (the one whose scripts are about to be
      // overwritten on disk), not necessarily the currently-configured client's (appSettings.bridgeAdapter()) —
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
      appSettings.save({ client: { adapter: adapter as string, scriptsDir: destDir } });
      // The wizard sends its panel options; either install puts the panel in TazUO's autostart list, which
      // it can only do while TazUO is closed (app/tazuo-panel.mts's addPanelAutostart).
      if (panel !== undefined && !CONFIG.demo) savePanel(panel as object);
      const autostart = adapter === "tazuo" && !CONFIG.demo ? addPanelAutostart(destDir, clientRunning) : null;
      // pathsFile: what happened to packrat-paths.json on the way in (written/unchanged/kept/
      // backed-up) — installScripts no longer silently clobbers a hand-authored one, and the page
      // can say so.
      return send(res, 200, { ok: true, installed: result.installed, version: result.version, scriptsDir: destDir, pathsFile: result.pathsFile, autostart });
    } },
    { method: "GET", path: "/api/update-check", handle: async (_req, res) => {
      // Cached for an hour so every page load doesn't cost a GitHub round trip (and its unauthenticated
      // rate limit); a failed check is not cached, so the next request simply tries again.
      if (!updateCheckCache || Date.now() - updateCheckCache.at > UPDATE_CHECK_TTL_MS) {
        const result = await checkForUpdates({ current: PACKAGE_JSON.version, repo: repoFromPackage(PACKAGE_JSON), fetchImpl: updateFetch });
        if (result.error) return send(res, 200, { ok: true, ...result });
        updateCheckCache = { at: Date.now(), result };
      }
      return send(res, 200, { ok: true, ...updateCheckCache.result });
    } },
  ];
}
