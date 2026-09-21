// main.mjs — the Electron shell's main process. Forks the Pack Rat server
// (server-entry.mjs) as a utility process, opens one BrowserWindow on it, stamps every request to
// that server with a per-launch bearer token (session.webRequest, never a URL/log/page value), and
// answers the two native-only calls the server's page cannot make itself: choosing a folder and
// opening one in Finder (POST /api/host/pick-folder|open-path, see app/vault-server.mts's `host`
// param — server-entry.mjs relays those over process.parentPort, this file does the actual OS call).
//
// Flags: --data <dir> (else PACKRAT_DATA, else app.getPath("userData")) · --demo (forwarded to the
// server child unchanged) · --smoke (see runSmokeCheck below — exits instead of staying open, for
// scripts/shell-smoke.test.mjs).
import { app, BrowserWindow, dialog, session, shell, utilityProcess } from "electron";
import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER_ENTRY = join(HERE, "server-entry.mjs");

function flag(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
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
function logLine(line) {
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
  let win = null;
  let child = null;
  let currentOrigin = null;
  let currentPort = null;
  let restartCount = 0;
  let quitting = false;
  let smokeTimer = null;
  let smokeDone = false;

  function createWindow() {
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

  function spawnChild() {
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

  function onListening(port) {
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

  async function handleHostOp(msg) {
    let result = null;
    try {
      if (msg.op === "pickFolder") {
        const opts = msg.args || {};
        const res = await dialog.showOpenDialog(win || undefined, {
          title: opts.title,
          properties: ["openDirectory"],
        });
        result = res.canceled || !res.filePaths.length ? null : res.filePaths[0];
      } else if (msg.op === "openPath") {
        const err = await shell.openPath(msg.args);
        if (err) logLine(`host openPath error: ${err}`);
      }
    } catch (e) {
      logLine(`host ${msg.op} error: ${e?.message || e}`);
    }
    child?.postMessage({ type: "host-result", id: msg.id, result });
  }

  function onChildMessage(msg) {
    if (!msg || typeof msg !== "object") return;
    if (msg.type === "listening") {
      onListening(msg.port);
    } else if (msg.type === "host") {
      handleHostOp(msg);
    } else if (msg.type === "error") {
      logLine(`server: fatal ${msg.message}`);
    }
  }

  function onChildExit(code) {
    if (quitting) return;
    if (smoke) {
      // runSmokeCheck (and the 30s timeout below) always set smokeDone before killing the child
      // itself to report its own outcome — this exit event is the child reacting to that kill(), not
      // a real crash, so it must not overwrite the exit code/line already sent.
      if (smokeDone) return;
      clearTimeout(smokeTimer);
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
  async function pollStatus(w, deadline) {
    let status = "";
    while (Date.now() < deadline) {
      status = await w.webContents.executeJavaScript('document.querySelector("#status")?.textContent ?? ""');
      if (typeof status === "string" && status.length > 0 && !status.startsWith("loading")) return status;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    return status;
  }
  async function runSmokeCheck(w) {
    try {
      const status = await pollStatus(w, Date.now() + 15000);
      if (typeof status !== "string" || status.length === 0 || status.startsWith("loading") || status.includes("failed")) {
        clearTimeout(smokeTimer);
        smokeDone = true;
        console.log(`SMOKE FAIL #status did not finish loading: ${JSON.stringify(status)}`);
        child?.kill();
        app.exit(1);
        return;
      }
      const apiStatus = await w.webContents.executeJavaScript('fetch("/api/setup").then((r) => r.status).catch(() => -1)');
      clearTimeout(smokeTimer);
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
      clearTimeout(smokeTimer);
      smokeDone = true;
      console.log(`SMOKE FAIL ${e?.message || e}`);
      child?.kill();
      app.exit(1);
    }
  }

  function shutdownChild() {
    return new Promise((resolve) => {
      if (!child || child.pid == null) return resolve();
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolve();
      };
      child.once("exit", finish);
      child.postMessage({ type: "shutdown" });
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

  app.whenReady().then(() => {
    logLine(`shell: starting (demo=${demo} smoke=${smoke} dataDir=${dataDir})`);
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
