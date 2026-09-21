# The Electron shell

Three files. `main.mts` is the Electron main process: it opens one `BrowserWindow`, forks the actual Pack Rat server as a utility-process child, and is the only thing in this app that can talk to the OS (a native folder picker, opening a path in Finder, a single-instance lock). `server-entry.mts` is that child — it just calls `app/vault-server.mts`'s `startServer()`, the same function `scripts/start.mjs` uses for the bare `npm start` path, with one addition: a `host` object that relays `pickFolder`/`openPath` back to `main.mts` over `process.parentPort`, since a plain Node process has no dialog API of its own. `protocol.mts` declares the message shapes that cross that `process.parentPort` channel (`ListeningMessage`, `HostRequestMessage`, `HostResultMessage`, `ServerErrorMessage`, `ShutdownMessage`); both files pull it in with `import type`, so it compiles to nothing at runtime.

## Why a utility process, not the main process

The server is a real zero-dependency `node:http` server with its own routes, SSE streams, worker threads (the optimizer) and file watchers (see `app/vault-server.mts`'s own header comment). Running it inside Electron's main process would mean any of that code — including a third-party adapter watcher — could reach into `electron`, `BrowserWindow`, or the filesystem with full main-process privileges. `utilityProcess.fork()` gives it its own OS process instead: same Node APIs, no Electron globals, and it can be killed independently of the window. The page itself never gets Node access either (`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, no preload) — it's just a browser tab pointed at `http://127.0.0.1:<port>/`.

## The token

`main.mts` generates a random UUID once per launch and passes it to the child as `PACKRAT_TOKEN`, which makes `vault-server.mts` require `Authorization: Bearer <token>` on every `/api/*` route (see its "Localhost security" note). The token never reaches the page, a URL, or a log line — `main.mts` attaches it itself, on every outgoing request to the server's origin, via `session.defaultSession.webRequest.onBeforeSendHeaders`. The page's own `fetch()`/`EventSource` calls need no knowledge of it at all.

## The host bridge

`vault-server.mts` accepts an optional `{ host }` with two methods — `pickFolder({title}) -> Promise<string|null>` and `openPath(path) -> Promise<void>` — that back `POST /api/host/pick-folder` and `POST /api/host/open-path` (501 without a `host`, which is what the bare `node app/vault-server.mts` / `npm start` path gets). Since the server actually runs in `server-entry.mts`'s child process, that file implements `host` by sending `{type: "host", id, op, args}` to `main.mts` and waiting for the matching `{type: "host-result", id, result}` reply; `main.mts` does the real `dialog.showOpenDialog` / `shell.openPath` call and sends the result back. Every call is `await`ed by id, so pending calls never cross.

## Flags

- `--data <dir>` (else `PACKRAT_DATA`, else `app.getPath("userData")`) — passed through to the server child as `PACKRAT_DATA`, and also used as Electron's own `userData` path (so a `--data <tmp>` run's single-instance lock, cache, etc. never collide with a real running instance).
- `--demo` — forwarded to the server child unchanged (it's an argv flag there too, matching `app/config.mts`'s `resolveConfig`).
- `--smoke` — after the window's first `did-finish-load`, reads `#status`'s text out of the page; if it's non-empty, prints `SMOKE OK <port>` and exits 0, otherwise `SMOKE FAIL <reason>` and exits 1 (a 30 s overall timeout counts as a failure too). This is what `scripts/shell-smoke.test.mts` drives — see `TESTING.md`.

## Building before launch (dev only)

`npm run desktop` builds the page first via its `predesktop` npm hook (`build:types` then `build:ui`). A bare `electron .` — or a globally installed `electron` binary — skips npm hooks entirely, so on a fresh clone nothing has built `app/dist/` yet and the server would 404 its own page, leaving the window blank with no explanation. `main.mts` self-heals this the same way `scripts/start.mjs` already does for the bare `npm start` path: as soon as `app.whenReady()` fires, and only when `!app.isPackaged`, it dynamically imports `scripts/build-schema-types.mts` and `scripts/build-ui.mjs` and runs them before forking the server child. The imports are dynamic, and live inside that `!app.isPackaged` branch, because `scripts/` never ships in the packaged app — only `scripts/optimizer-core.mts` does, per `package.json`'s `build.files` — so a packaged app must never even attempt to resolve them. This is `main.mts`'s job, not `server-entry.mts`'s: the packaged app's `server-entry.mts` has to stay loadable with no `scripts/` directory around it at all, ruling out any build step there, conditional or not.

A build failure surfaces the same way the two existing failure paths in this file already do, rather than a third: under `--smoke` it's a `SMOKE FAIL build failed: <message>` stdout line and exit 1 (what `scripts/shell-smoke.test.mts` reads); otherwise it's `dialog.showErrorBox` naming the log file, followed by `app.quit()` — the same shape `onChildExit`'s give-up-after-one-restart branch already uses. Either way the window never opens on the broken page.

## Lifecycle

Single-instance lock (`app.requestSingleInstanceLock()`); a second launch just focuses the existing window. If the server child dies unexpectedly, `main.mts` restarts it once; a second death shows an error dialog naming the log file and quits. On quit (`Cmd+Q`, closing the window, or the restart giving up) `main.mts` sends the child a `{type: "shutdown"}` message, which calls the server's own `close()` and exits — if the child hasn't exited within 2 s, it's killed outright, so quitting never leaves an orphaned server process behind.

Logs land in `<data>/logs/shell.log` (the shell's own lifecycle lines plus everything the child prints to stdout/stderr); the server's own request log is the existing `<data>/logs/server.log` from `app/config.mts`.

## What's not exercised by the automated smoke test

`scripts/shell-smoke.test.mts` only proves the app boots and serves its page; `scripts/ui-smoke.test.mjs` proves the page actually renders (title, `#status`, the first-run wizard's Skip path, the demo inventory filling the table, a tab switch, no `pageerror`). A human still needs to check, per the phase-4 task brief: the "Choose a folder…" button in the first-run wizard opens a real native dialog and the chosen path comes back to the page; "Open" on the data directory opens it in Finder; and `Cmd+Q` quits with no orphaned `server-entry` process left running (`pgrep -fl server-entry` empty afterward).
