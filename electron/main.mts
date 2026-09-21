// main.mts — the Electron shell's main process. Forks the Pack Rat server
// (server-entry.mts) as a utility process, opens one BrowserWindow on it, stamps every request to
// that server with a per-launch bearer token (session.webRequest, never a URL/log/page value), and
// answers the two native-only calls the server's page cannot make itself: choosing a folder and
// opening one in Finder (POST /api/host/pick-folder|open-path, see app/vault-server.mts's `host`
// param — server-entry.mts relays those over process.parentPort, this file does the actual OS call).
//
// Flags: --data <dir> (else PACKRAT_DATA, else app.getPath("userData")) · --demo (forwarded to the
// server child unchanged) · --smoke (see runSmokeCheck below — exits instead of staying open, for
// scripts/shell-smoke.test.mts).
import { app, BrowserWindow, dialog, session, shell, utilityProcess } from "electron";
import type { UtilityProcess } from "electron";
import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
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

  function createWindow(): BrowserWindow {
    const w = new BrowserWindow({
      width: 1280,
      height: 860,
      show: false,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    w.once("ready-to-show", () => w.show());
    // Anything the page tries to open in a new window/tab (target=_blank, window.open) goes to the
    // OS browser instead of a second Electron window, and only for http(s) — everything else is denied.
    w.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//i.test(url)) shell.openExternal(url);
      return { action: "deny" };
    });
    // Never let the page itself navigate away from the local server's origin.
    w.webContents.on("will-navigate", (e, navUrl) => {
      let origin;
      try {
        origin = new URL(navUrl).origin;
      } catch {
        origin = null;
      }
      if (origin !== currentOrigin) e.preventDefault();
    });
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
        // This one directive currently hides TWO independent errors on the call below, not one: the
        // overload mismatch on `win || undefined`, and `title: unknown` where Electron wants a string.
        // If the first is ever fixed, the directive will NOT report itself unused — the second keeps
        // it alive — so whoever touches this call has to deal with `title` deliberately.
        const res = await dialog.showOpenDialog(win || undefined, {
          // `title` crosses two process hops (an HTTP request body -> server-entry.mts's host bridge
          // -> here) with no runtime check anywhere along the way, so it stays `unknown` per this
          // file's own "unknown at the boundary" rule; the @ts-expect-error two lines up already
          // covers this whole call (TypeScript reports a failed overload resolution once for the
          // entire argument list, not once per property), so this line needs no directive of its own.
          title: opts.title,
          properties: ["openDirectory"],
        });
        result = res.canceled || !res.filePaths.length ? null : res.filePaths[0]!;
      } else if (msg.op === "openPath") {
        const err = await shell.openPath(msg.args);
        if (err) logLine(`host openPath error: ${err}`);
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

  // #status ships as "loading…" (app/index.html) until ui/app.mjs's load() finishes, and reads
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
      clearTimeout(smokeTimer as NodeJS.Timeout | undefined);
      smokeDone = true;
      if (apiStatus === 200) {
        console.log(`SMOKE OK ${currentPort}`);
        child?.kill();
        app.exit(0);
      } else {
        console.log(`SMOKE FAIL authenticated GET /api/setup returned ${apiStatus}`);
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
    if (!app.isPackaged) {
      // `npm run desktop` builds the page first via its `predesktop` npm hook (build:types then
      // build:ui — see scripts/start.mjs's comment for why the schema types have to come first).
      // A bare `electron .` (or a globally installed `electron .`) skips npm hooks entirely, so on a
      // fresh clone nothing has built app/dist/ yet and the server would 404 its own page — this
      // mirrors scripts/start.mjs's self-heal for the browser path, here rather than in
      // electron/server-entry.mts because scripts/ never ships in the packaged app (only
      // scripts/optimizer-core.mts does, via package.json's build.files) and server-entry.mts's own
      // module graph has to stay safe to load in a packaged app that lacks scripts/ entirely. The
      // imports are dynamic and live inside this !app.isPackaged branch for the same reason: a
      // packaged app must never even attempt to resolve scripts/build-ui.mjs.
      try {
        const { buildSchemaTypes } = await import("../scripts/build-schema-types.mts");
        const { buildUi } = await import("../scripts/build-ui.mjs");
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
