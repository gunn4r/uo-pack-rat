// main.mts — the Electron shell's main process. Forks the Pack Rat server
// (server-entry.mts) as a utility process, opens one BrowserWindow on it, stamps every request to
// that server with a per-launch bearer token (session.webRequest, never a URL/log/page value), and
// answers the two native-only calls the server's page cannot make itself: choosing a folder and
// opening one in Finder (POST /api/host/pick-folder|open-path, see app/vault-server.mts's `host`
// param — server-entry.mts relays those over process.parentPort, this file does the actual OS call).
//
// Flags: --data <dir> (else PACKRAT_DATA, else app.getPath("userData")) · --demo (forwarded to the
// server child unchanged) · --smoke (see runSmokeCheck below — exits instead of staying open, for
// scripts/shell-smoke.test.mts) · --devtools (re-enables DevTools in a packaged build, see
// createWindow).
import { app, BrowserWindow, dialog, session, shell, utilityProcess } from "electron";
import type { UtilityProcess, WebContents } from "electron";
import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dialogTitle, openPathTarget } from "./host-args.mts";
import type { HostRequestMessage, HostResultMessage, ListeningMessage, ServerErrorMessage, ShutdownMessage } from "./protocol.mts";

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER_ENTRY = join(HERE, "server-entry.mts");

function flag(argv: string[], name: string): string | null {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1]! : null;
}

// `electron .` in dev puts [electronBinary, ".", ...ours] in process.argv; a packaged app drops the
// "." (no project path to run). Either way, skip past whatever isn't a flag of ours.
const argv = app.isPackaged ? process.argv.slice(1) : process.argv.slice(2);
const demo = argv.includes("--demo");
const smoke = argv.includes("--smoke");
// DevTools stay available in a dev checkout (and in a --smoke/--ui-smoke run, which is a dev
// checkout by definition), but a packaged build needs this flag to get them back — see createWindow.
const devtools = argv.includes("--devtools");
// resolve() (single arg, same style as app/config.mts's own resolveConfig) turns a relative --data
// into an absolute path against process.cwd() — app.setPath("userData", …) below refuses a relative
// path outright, and the lock file / shell.log paths need to agree with what the server child
// resolves for the same value (config.mts:18) regardless of the shell's cwd (post-review fix, Minor 6).
const dataDir = resolve(flag(argv, "--data") || process.env.PACKRAT_DATA || app.getPath("userData"));
// Redirect Electron's own userData (its single-instance lock file included) into the same directory
// we're pointing the server at, so a --data <tmp> smoke/test run never collides with, or is blocked
// by, a real running instance using the default location.
app.setPath("userData", dataDir);

const logsDir = join(dataDir, "logs");
mkdirSync(logsDir, { recursive: true });
const logPath = join(logsDir, "shell.log");
function logLine(line: string): void {
  try {
    appendFileSync(logPath, `${new Date().toISOString()} ${line}\n`);
  } catch {
    /* logging is best-effort — never let it crash the shell */
  }
}

const token = randomUUID();

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let win: BrowserWindow | null = null;
  let child: UtilityProcess | null = null;
  let currentOrigin: string | null = null;
  let currentPort: number | null = null;
  let restartCount = 0;
  let quitting = false;
  let smokeTimer: NodeJS.Timeout | null = null;
  let smokeDone = false;

  // The three navigation events below all hand their listener a details object carrying the target
  // url and preventDefault — this is the part of each one's payload the guard actually reads, named
  // structurally so one handler can serve all three (Electron's own param types are supersets of it).
  interface NavigationEvent {
    url: string;
    preventDefault: () => void;
  }

  // Bound, scheme and rate limit on anything the page asks the OS browser to open. No host allowlist:
  // the one external link the UI has today is the "View release" GitHub URL in app/ui/settings.mts,
  // and that value is host-checked where it is born (app/installer.mts, which owns the GitHub API
  // response) — a second list here would silently break the next legitimate link (a wiki page, an
  // issue URL) without adding a control the born-side check doesn't already give.
  const MAX_EXTERNAL_URL = 2048;
  const EXTERNAL_OPEN_GAP_MS = 1000;
  let lastExternalOpen = 0;

  function openExternal(url: string): void {
    if (url.length > MAX_EXTERNAL_URL) return logLine(`window-open: refused a ${url.length}-character url`);
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return logLine("window-open: refused an unparsable url");
    }
    // https only — every real link this app produces is https, and http: buys a MITM a second bite
    // at a URL the user already trusts enough to click.
    if (parsed.protocol !== "https:") return logLine(`window-open: refused scheme ${parsed.protocol}`);
    // One tab per second at most, so page code cannot drive window.open in a loop and launch
    // unbounded browser tabs (or unbounded external-app launches) behind a single user click.
    const now = Date.now();
    if (now - lastExternalOpen < EXTERNAL_OPEN_GAP_MS) return logLine("window-open: throttled");
    lastExternalOpen = now;
    // openExternal rejects (an OS with no handler for the scheme, a user-cancelled prompt); an
    // unhandled rejection in the main process is a crash waiting to happen, so it lands in the log.
    shell.openExternal(parsed.href).catch((e) => logLine(`window-open error: ${(e as Error)?.message || e}`));
  }

  // Every guard any webContents needs, applied from app.on("web-contents-created") below rather than
  // per-window here, so a webContents this file didn't create (a future window, a devtools-opened
  // one) inherits them by construction instead of by somebody remembering (phase-7 review, Minor 4).
  function hardenWebContents(wc: WebContents): void {
    // Anything the page tries to open in a new window/tab (target=_blank, window.open) goes to the
    // OS browser instead of a second Electron window — and only through openExternal's checks above.
    wc.setWindowOpenHandler(({ url }) => {
      openExternal(url);
      return { action: "deny" };
    });
    // Never let the page navigate away from the local server's origin. will-navigate is the main
    // frame only; will-frame-navigate also covers a subframe (including one trying to navigate _top),
    // and will-redirect catches a server-side redirect chain that leaves the origin mid-flight.
    const blockOffOrigin = (e: NavigationEvent): void => {
      let origin;
      try {
        origin = new URL(e.url).origin;
      } catch {
        origin = null;
      }
      // devtools:// is Chromium's own frontend navigating itself — a webContents this guard now also
      // sees, since it attaches to every one of them rather than only the window createWindow makes.
      if (origin === currentOrigin || e.url.startsWith("devtools://")) return;
      e.preventDefault();
      logLine(`navigation refused: ${origin ?? "unparsable"}`);
    };
    wc.on("will-navigate", blockOffOrigin);
    wc.on("will-frame-navigate", blockOffOrigin);
    wc.on("will-redirect", blockOffOrigin);
    // webviewTag is never enabled, so nothing can attach one today; this makes that a refusal rather
    // than a default, the same way the navigation guards do.
    wc.on("will-attach-webview", (e) => {
      e.preventDefault();
      logLine("webview attach refused");
    });
  }

  function createWindow(): BrowserWindow {
    const w = new BrowserWindow({
      width: 1280,
      height: 860,
      show: false,
      // spellcheck: Electron's builtin spellchecker is on by default and, on Windows and Linux,
      // downloads a Hunspell dictionary from Chromium's CDN the first time any text field is focused
      // — an outbound request PRIVACY.md says this app never makes (phase-7 review, B-1). The page has
      // spellcheckable fields on ordinary paths (the Import tab's paste box, the wizard's folder
      // field, a saved run's name). setSpellCheckerEnabled(false) on the session in whenReady() below
      // is the other half; this one covers the window regardless of which session it ends up on.
      // devTools: a packaged build keeps them off unless --devtools was passed (phase-7 review, Note 4).
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false, devTools: !app.isPackaged || devtools },
    });
    w.once("ready-to-show", () => w.show());
    w.webContents.once("did-finish-load", () => {
      if (smoke) runSmokeCheck(w);
    });
    w.on("closed", () => {
      win = null;
    });
    return w;
  }

  function spawnChild(): UtilityProcess {
    const demoArgs = demo ? ["--demo"] : [];
    const c = utilityProcess.fork(SERVER_ENTRY, demoArgs, {
      env: { ...process.env, PACKRAT_DATA: dataDir, PACKRAT_TOKEN: token, PACKRAT_PORT: "0" },
      stdio: "pipe",
      serviceName: "pack-rat-server",
    });
    c.stdout?.on("data", (b) => logLine(`server: ${b.toString().trimEnd()}`));
    c.stderr?.on("data", (b) => logLine(`server: ${b.toString().trimEnd()}`));
    c.on("message", onChildMessage);
    c.on("exit", (code) => onChildExit(code));
    return c;
  }

  function onListening(port: number): void {
    currentPort = port;
    currentOrigin = `http://127.0.0.1:${port}`;
    logLine(`server: listening on ${currentOrigin}`);
    // Single handler slot per session — re-registering on a restart simply replaces it with the new
    // port's origin. The token never appears in the URL, a log line, or on the page itself.
    session.defaultSession.webRequest.onBeforeSendHeaders({ urls: [`${currentOrigin}/*`] }, (details, cb) => {
      details.requestHeaders.Authorization = `Bearer ${token}`;
      cb({ requestHeaders: details.requestHeaders });
    });
    if (!win) win = createWindow();
    win.loadURL(`${currentOrigin}/`);
  }

  async function handleHostOp(msg: HostRequestMessage): Promise<void> {
    let result: string | null = null;
    try {
      if (msg.op === "pickFolder") {
        const opts = msg.args || {};
        // @ts-expect-error TS2345 — Electron's showOpenDialog only declares a `(window: BaseWindow, …)`
        // overload, never one that also accepts `undefined`, even though the native implementation
        // dispatches purely on argument count and already tolerates it here (this exact call already
        // worked at runtime before this migration). Branching into two separate calls to satisfy the
        // type would be a structural change the migration's no-new-branching rule forbade.
        // It used to hide a second error too — `title: unknown` where Electron wants a string, left
        // alive deliberately so whoever touched this call had to deal with `title`. That is what the
        // phase-7 review's Minor 1 did: the value is coerced below, so the overload mismatch is now
        // the only error this directive covers.
        const res = await dialog.showOpenDialog(win || undefined, {
          // `title` crosses two process hops (an HTTP request body -> server-entry.mts's host bridge
          // -> here) with no runtime check anywhere along the way, so it arrives `unknown` per this
          // file's own "unknown at the boundary" rule and dialogTitle() is what turns it into
          // something a native, app-modal dialog can safely wear (phase-7 review, Minor 1).
          title: dialogTitle(opts.title),
          properties: ["openDirectory"],
        });
        result = res.canceled || !res.filePaths.length ? null : res.filePaths[0]!;
      } else if (msg.op === "openPath") {
        // shell.openPath is "open this the way a double-click would" — a .app/.command on macOS, an
        // .exe/.bat on Windows — so the path it gets is resolved HERE from the wire's discriminator
        // and never taken from the message (phase-7 review, Important 1: the server child is the
        // lower-trust process this split exists to contain, and it can write files into dataDir).
        const target = openPathTarget(msg.args, dataDir, logsDir);
        if (target === null) {
          logLine(`host openPath refused: ${String(msg.args).slice(0, 200)}`);
        } else {
          const err = await shell.openPath(target);
          if (err) logLine(`host openPath error: ${err}`);
        }
      }
    } catch (e) {
      logLine(`host ${msg.op} error: ${(e as Error)?.message || e}`);
    }
    child?.postMessage({ type: "host-result", id: msg.id, result } satisfies HostResultMessage);
  }

  function onChildMessage(msg: unknown): void {
    if (!msg || typeof msg !== "object") return;
    if ((msg as { type: unknown }).type === "listening") {
      onListening((msg as ListeningMessage).port);
    } else if ((msg as { type: unknown }).type === "host") {
      handleHostOp(msg as HostRequestMessage);
    } else if ((msg as { type: unknown }).type === "error") {
      logLine(`server: fatal ${(msg as ServerErrorMessage).message}`);
    }
  }

  function onChildExit(code: number): void {
    if (quitting) return;
    if (smoke) {
      // runSmokeCheck (and the 30s timeout below) always set smokeDone before killing the child
      // itself to report its own outcome — this exit event is the child reacting to that kill(), not
      // a real crash, so it must not overwrite the exit code/line already sent.
      if (smokeDone) return;
      clearTimeout(smokeTimer as NodeJS.Timeout | undefined);
      logLine(`server: exited unexpectedly (code ${code})`);
      console.log(`SMOKE FAIL server exited unexpectedly (code ${code})`);
      app.exit(1);
      return;
    }
    logLine(`server: exited unexpectedly (code ${code})`);
    if (restartCount < 1) {
      restartCount++;
      logLine("server: restarting (attempt 1 of 1)");
      child = spawnChild();
    } else {
      dialog.showErrorBox("Pack Rat", `The local server stopped unexpectedly twice in a row. See the log at ${logPath}`);
      app.quit();
    }
  }

  // #status ships as "loading…" (app/index.html) until ui/app.mts's load() finishes, and reads
  // "failed to load: <message>" if it throws — both are non-empty, so the old "any non-empty #status"
  // check passed on either one, most likely on "loading…" every time (did-finish-load fires before
  // load()'s own fetches resolve). Poll instead, up to a 15s budget of the outer 30s smokeTimer.
  // Passing that still isn't proof the token header reached the server — a missing/broken
  // Authorization header (session.webRequest.onBeforeSendHeaders above) would 401 every /api/* fetch
  // without #status ever showing it, since load()'s own catch only reports the FIRST rejected
  // promise's message. So the second half makes an authenticated call straight from the renderer and
  // requires 200 (post-review fix, Important 2).
  async function pollStatus(w: BrowserWindow, deadline: number): Promise<unknown> {
    let status: unknown = "";
    while (Date.now() < deadline) {
      status = await w.webContents.executeJavaScript('document.querySelector("#status")?.textContent ?? ""');
      if (typeof status === "string" && status.length > 0 && !status.startsWith("loading")) return status;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    return status;
  }
  // The third leg of the check, and the one the packaging config now leans on: starting an optimize
  // job proves the worker thread (app/optimize-worker.mts) loads out of app.asar and that HiGHS's
  // .wasm loads from app.asar.unpacked beside it. `asarUnpack` was narrowed to only the files that
  // genuinely must be loose on disk on the strength of exactly this working in a real packaged tree
  // (phase-7 review, Important 3 — see scripts/packaging.test.mts's asar test), so this runs on every
  // --smoke rather than waiting for a release to discover it. It runs entirely inside the renderer,
  // in one round trip, because that is the only context whose requests carry the bearer token. A data
  // directory with no character in it (a --smoke run without --demo) skips rather than fails — the
  // job needs an inventory to build against, and not having one is not a packaging problem.
  const OPTIMIZE_CHECK_JS = `(async () => {
    try {
      const inv = await (await fetch("/api/inventory")).json();
      const characters = Object.keys((inv.inventory || {}).characters || {});
      const profiles = (await (await fetch("/api/profiles")).json()).profiles || {};
      const template = (profiles.templates || {}).melee;
      if (!characters.length || !template) return "skipped (no character or template to build for)";
      const body = JSON.stringify({ character: characters[0], settings: {}, profile: template });
      const started = await (await fetch("/api/optimize", { method: "POST", headers: { "content-type": "application/json" }, body })).json();
      if (!started.id) return "POST /api/optimize did not start a job: " + JSON.stringify(started).slice(0, 200);
      const deadline = Date.now() + 8000;
      while (Date.now() < deadline) {
        const state = await (await fetch("/api/optimize/" + started.id + "/status")).json();
        if (state.state === "done") return "ok";
        if (state.state !== "running") return "job " + state.state + ": " + (state.error || "");
        await new Promise((r) => setTimeout(r, 200));
      }
      return "job did not finish within 8s";
    } catch (e) {
      return "threw: " + ((e && e.message) || e);
    }
  })()`;

  async function runSmokeCheck(w: BrowserWindow): Promise<void> {
    try {
      const status = await pollStatus(w, Date.now() + 15000);
      if (typeof status !== "string" || status.length === 0 || status.startsWith("loading") || status.includes("failed")) {
        clearTimeout(smokeTimer as NodeJS.Timeout | undefined);
        smokeDone = true;
        console.log(`SMOKE FAIL #status did not finish loading: ${JSON.stringify(status)}`);
        child?.kill();
        app.exit(1);
        return;
      }
      const apiStatus = await w.webContents.executeJavaScript('fetch("/api/setup").then((r) => r.status).catch(() => -1)');
      if (apiStatus !== 200) {
        clearTimeout(smokeTimer as NodeJS.Timeout | undefined);
        smokeDone = true;
        console.log(`SMOKE FAIL authenticated GET /api/setup returned ${apiStatus}`);
        child?.kill();
        app.exit(1);
        return;
      }
      const optimize = await w.webContents.executeJavaScript(OPTIMIZE_CHECK_JS);
      clearTimeout(smokeTimer as NodeJS.Timeout | undefined);
      smokeDone = true;
      if (optimize === "ok" || (typeof optimize === "string" && optimize.startsWith("skipped"))) {
        console.log(`SMOKE OK ${currentPort}${optimize === "ok" ? "" : ` (optimize ${optimize})`}`);
        child?.kill();
        app.exit(0);
      } else {
        console.log(`SMOKE FAIL optimize job: ${typeof optimize === "string" ? optimize : JSON.stringify(optimize)}`);
        child?.kill();
        app.exit(1);
      }
    } catch (e) {
      clearTimeout(smokeTimer as NodeJS.Timeout | undefined);
      smokeDone = true;
      console.log(`SMOKE FAIL ${(e as Error)?.message || e}`);
      child?.kill();
      app.exit(1);
    }
  }

  function shutdownChild(): Promise<void> {
    return new Promise((resolve) => {
      if (!child || child.pid == null) return resolve();
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolve();
      };
      child.once("exit", finish);
      child.postMessage({ type: "shutdown" } satisfies ShutdownMessage);
      setTimeout(() => {
        if (done) return;
        child?.kill();
        finish();
      }, 2000);
    });
  }

  // Every webContents, not just the one createWindow makes — see hardenWebContents above.
  app.on("web-contents-created", (_e, wc) => hardenWebContents(wc));

  app.on("second-instance", () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.on("window-all-closed", () => {
    app.quit();
  });

  app.on("before-quit", (e) => {
    if (quitting) return;
    quitting = true;
    e.preventDefault();
    logLine("shell: quitting — signalling server to shut down");
    shutdownChild().finally(() => app.quit());
  });

  app.whenReady().then(async () => {
    logLine(`shell: starting (demo=${demo} smoke=${smoke} dataDir=${dataDir})`);
    // http://127.0.0.1:<port> is a Secure Context, so the page could ask for the camera, the
    // microphone, geolocation, notifications, clipboard read or a USB/HID/serial device — and with no
    // handler installed Electron's default is to APPROVE. An inventory table and a solver need none
    // of them, so all three surfaces deny unconditionally; if a feature ever needs one permission,
    // the allowlist goes here and gets reviewed then (phase-7 review, Important 4).
    session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    session.defaultSession.setDevicePermissionHandler(() => false);
    // The session half of the spellchecker fix — see createWindow's webPreferences (phase-7, B-1).
    session.defaultSession.setSpellCheckerEnabled(false);
    if (!app.isPackaged) {
      // `npm run desktop` builds the page first via its `predesktop` npm hook (build:types then
      // build:ui — see scripts/start.mts's comment for why the schema types have to come first).
      // A bare `electron .` (or a globally installed `electron .`) skips npm hooks entirely, so on a
      // fresh clone nothing has built app/dist/ yet and the server would 404 its own page — this
      // mirrors scripts/start.mts's self-heal for the browser path, here rather than in
      // electron/server-entry.mts because scripts/ never ships in the packaged app (only
      // scripts/optimizer-core.mts does, via package.json's build.files) and server-entry.mts's own
      // module graph has to stay safe to load in a packaged app that lacks scripts/ entirely. The
      // imports are dynamic and live inside this !app.isPackaged branch for the same reason: a
      // packaged app must never even attempt to resolve scripts/build-ui.mts.
      try {
        const { buildSchemaTypes } = await import("../scripts/build-schema-types.mts");
        const { buildUi } = await import("../scripts/build-ui.mts");
        buildSchemaTypes();
        buildUi();
      } catch (e) {
        const message = (e as Error)?.message || String(e);
        logLine(`shell: build failed: ${message}`);
        // Match the two existing failure idioms this file already uses rather than inventing a
        // third: --smoke reports failures as a stdout line + a bare exit code (see runSmokeCheck and
        // onChildExit's smoke branch, both read by scripts/shell-smoke.test.mts), everything else
        // reports fatal startup problems with a native dialog naming the log file (onChildExit's
        // give-up-after-one-restart branch).
        if (smoke) {
          console.log(`SMOKE FAIL build failed: ${message}`);
          app.exit(1);
        } else {
          dialog.showErrorBox("Pack Rat", `Failed to build the app before launch. See the log at ${logPath}.\n\n${message}`);
          app.quit();
        }
        return;
      }
    }
    if (smoke) {
      smokeTimer = setTimeout(() => {
        smokeDone = true;
        console.log("SMOKE FAIL timeout after 30s");
        child?.kill();
        app.exit(1);
      }, 30000);
    }
    child = spawnChild();
  });
}
