# The Electron shell

Two files. `main.mjs` is the Electron main process: it opens one `BrowserWindow`, forks the actual Pack Rat server as a utility-process child, and is the only thing in this app that can talk to the OS (a native folder picker, opening a path in Finder, a single-instance lock). `server-entry.mjs` is that child — it just calls `app/vault-server.mts`'s `startServer()`, the same function `scripts/start.mjs` uses for the bare `npm start` path, with one addition: a `host` object that relays `pickFolder`/`openPath` back to `main.mjs` over `process.parentPort`, since a plain Node process has no dialog API of its own.

## Why a utility process, not the main process

The server is a real zero-dependency `node:http` server with its own routes, SSE streams, worker threads (the optimizer) and file watchers (see `app/vault-server.mts`'s own header comment). Running it inside Electron's main process would mean any of that code — including a third-party adapter watcher — could reach into `electron`, `BrowserWindow`, or the filesystem with full main-process privileges. `utilityProcess.fork()` gives it its own OS process instead: same Node APIs, no Electron globals, and it can be killed independently of the window. The page itself never gets Node access either (`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, no preload) — it's just a browser tab pointed at `http://127.0.0.1:<port>/`.

## The token

`main.mjs` generates a random UUID once per launch and passes it to the child as `PACKRAT_TOKEN`, which makes `vault-server.mts` require `Authorization: Bearer <token>` on every `/api/*` route (see its "Localhost security" note). The token never reaches the page, a URL, or a log line — `main.mjs` attaches it itself, on every outgoing request to the server's origin, via `session.defaultSession.webRequest.onBeforeSendHeaders`. The page's own `fetch()`/`EventSource` calls need no knowledge of it at all.

## The host bridge

`vault-server.mts` accepts an optional `{ host }` with two methods — `pickFolder({title}) -> Promise<string|null>` and `openPath(path) -> Promise<void>` — that back `POST /api/host/pick-folder` and `POST /api/host/open-path` (501 without a `host`, which is what the bare `node app/vault-server.mts` / `npm start` path gets). Since the server actually runs in `server-entry.mjs`'s child process, that file implements `host` by sending `{type: "host", id, op, args}` to `main.mjs` and waiting for the matching `{type: "host-result", id, result}` reply; `main.mjs` does the real `dialog.showOpenDialog` / `shell.openPath` call and sends the result back. Every call is `await`ed by id, so pending calls never cross.

## Flags

- `--data <dir>` (else `PACKRAT_DATA`, else `app.getPath("userData")`) — passed through to the server child as `PACKRAT_DATA`, and also used as Electron's own `userData` path (so a `--data <tmp>` run's single-instance lock, cache, etc. never collide with a real running instance).
- `--demo` — forwarded to the server child unchanged (it's an argv flag there too, matching `app/config.mts`'s `resolveConfig`).
- `--smoke` — after the window's first `did-finish-load`, reads `#status`'s text out of the page; if it's non-empty, prints `SMOKE OK <port>` and exits 0, otherwise `SMOKE FAIL <reason>` and exits 1 (a 30 s overall timeout counts as a failure too). This is what `scripts/shell-smoke.test.mjs` drives — see `TESTING.md`.

## Lifecycle

Single-instance lock (`app.requestSingleInstanceLock()`); a second launch just focuses the existing window. If the server child dies unexpectedly, `main.mjs` restarts it once; a second death shows an error dialog naming the log file and quits. On quit (`Cmd+Q`, closing the window, or the restart giving up) `main.mjs` sends the child a `{type: "shutdown"}` message, which calls the server's own `close()` and exits — if the child hasn't exited within 2 s, it's killed outright, so quitting never leaves an orphaned server process behind.

Logs land in `<data>/logs/shell.log` (the shell's own lifecycle lines plus everything the child prints to stdout/stderr); the server's own request log is the existing `<data>/logs/server.log` from `app/config.mts`.

## What's not exercised by the automated smoke test

`scripts/shell-smoke.test.mjs` only proves the app boots and serves its page; `scripts/ui-smoke.test.mjs` proves the page actually renders (title, `#status`, the first-run wizard's Skip path, the demo inventory filling the table, a tab switch, no `pageerror`). A human still needs to check, per the phase-4 task brief: the "Choose a folder…" button in the first-run wizard opens a real native dialog and the chosen path comes back to the page; "Open" on the data directory opens it in Finder; and `Cmd+Q` quits with no orphaned `server-entry` process left running (`pgrep -fl server-entry` empty afterward).
