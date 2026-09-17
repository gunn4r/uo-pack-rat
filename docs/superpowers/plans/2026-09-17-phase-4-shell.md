# Pack Rat Phase 4 — Electron Shell, Inbox Watcher, First-Run Wizard, Script Installer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the localhost server and page into a desktop app: an Electron shell that runs the unchanged server as a utility process, an inbox watcher so scans land without a reload, a first-run wizard that finds the game client and installs the adapter scripts safely, a Settings tab, a manual update check, and logs.

**Architecture:** The server keeps working bare (`npm start`); everything the shell adds is env-driven and injected. `app/watcher.mjs` watches `<data>/inbox/<adapter>/`, validates and normalises each file and moves it into `scans/` (the inventory cache already re-reads on directory change); accepted/rejected events reach the page over a new `GET /api/events` SSE stream. `app/installer.mjs` holds the client-locating, script-installing (with the running-script guard), scan-importing and update-checking logic as pure functions the server exposes under `/api/setup/*`, `/api/import`, `/api/update-check`, `/api/host/*`. Anything only a desktop can do (a folder dialog, opening a folder) goes through an injectable `host` object: `startServer(config, { host })`; under Electron `electron/server-entry.mjs` implements it by messaging the main process over `process.parentPort`, so the page needs no preload and no IPC. `electron/main.mjs` owns the window, the single-instance lock, the per-launch token (attached with `webRequest.onBeforeSendHeaders`, never visible to the page), child restart-once, external links and logs. The page gains `ui/events.mjs`, `ui/wizard.mjs` and `ui/settings.mjs`.

**Tech Stack:** Node ≥ 22.18, ESM; `electron` 44.4.1 as a devDependency (the packaged build is Phase 5); no new runtime dependencies (`highs` stays the only one); `node:test`; `fs.watch` (no chokidar); Python 3 for the adapter scripts.

**Spec:** `docs/superpowers/specs/2026-09-12-desktop-app-public-release-design.md` — §4.1 (shell), §4.2 (data on disk, legacy import), §4.3 (wizard), §4.4 (watcher), §4.5 (token via `onBeforeSendHeaders`), §10 (manual update check only), §11 (files/processes, client integration: the running-script guard, `while True`/`import API` rules), §12 Phase 4. Playwright Electron smoke and packaging are Phase 5.

## Global Constraints

- Branch `phase-4-shell` from `main` (`d308b26`). Never touch `the original private workspace` or `~/Desktop/TazUO`; never commit `local/`, `app/dist/`, `test_logs/`, `.superpowers/`, `node_modules/`. Adapter scripts are repo files only; the installer writes only into a directory the user chose through the wizard.
- `package.json`: `"main": "electron/main.mjs"`, script `"desktop": "electron ."`, `devDependencies.electron = "44.4.1"` (exact), `dependencies` unchanged (`highs` only). `npm test` must not require Electron: the shell smoke test is `[slow]` and self-skips when `node_modules/electron` is absent or `TEST_SKIP_ELECTRON=1`.
- The page stays free of token code, inline scripts and external loads. `ui/api.mjs` is unchanged; all new page fetches go through it. `GET /api/events` is a normal token-protected `/api/*` route (under Electron the shell attaches the header to every request to the server origin, EventSource included; the bare server has no token).
- Data layout (`app/config.mjs`): add `paths.inbox = <data>/inbox`, `paths.inboxFor(adapter) = <data>/inbox/<adapter>`, `paths.rejectedFor(adapter) = <data>/inbox/<adapter>/rejected`; `ensureLayout` creates `inbox/tazuo/` (and `rejected/` lazily). Adapters write into `inbox/<adapter>/` (temp-then-rename, which `write_json_atomic` already does); files dropped directly into `scans/` keep working.
- Accepted scan files in `scans/` are named `<slug>-<YYYYMMDDTHHMMSS><offset>.json` where `slug` is the character name with anything outside `[A-Za-z0-9_-]` replaced by `_` and the stamp is the file's `scannedAt` with `:` and `-` removed from the time and offset parts (e.g. `Fixture-20260915T120000+0200.json`); an existing name gets `-2`, `-3` … appended.
- `settings.json` stays `schemaVersion: 1` and gains optional `setupDone: boolean` and `client: { adapter: string, scriptsDir: string } | null`; `PUT /api/settings` accepts any subset of `{shard, setupDone, client}` (types validated, 400 naming the field) and merges.
- The running-script guard (spec §11): the installer refuses (HTTP 409, `error: "a Pack Rat script is running in the client — type -stopall in game, wait for \"No scripts are currently running\", then retry"`) when `bridge/<adapter>/status.json` has `alive` within the last 30 s and no `stopped: true`; the wizard additionally requires the user to tick "No scripts are running in the client" before Install is enabled. Files are written as `<name>.new` and renamed into place one by one; `packrat-paths.json` is written last.
- Every `.py` the installer ships is the repo file byte for byte; the contract tests already forbid `while True`/`while (true)`/`while(true)` and enforce `import API` alone on its line — do not weaken them.
- Security: every new route is under `/api/*` (token, Host/Origin, JSON writes, body cap as today). `POST /api/host/open-path` accepts only `{which: "data" | "logs"}`; `POST /api/setup/install` validates `scriptsDir` is an existing directory and only ever writes the adapter's own file names into it; `POST /api/import {dir}` copies `*.json` only, never moves or deletes. Paths returned to the page are the user's own choices. No new 500 may carry a stack (existing ref-logging).
- Update check reads `package.json`'s `repository.url` (GitHub `owner/name`); when absent the route answers `{ok: true, configured: false}` and the button explains no release channel is configured yet.
- Tests on `node:test` with `[smoke]`/`[fast]`/`[slow]` prefixes; `npm test` green before every commit (`TEST_SKIP_SLOW=1` while iterating). Every browser-served change gets a browser gate (the coordinator drives it after the report). Prose not hard-wrapped. Commits end with `Claude-Session: https://claude.ai/code/session_012Jc4pEtTUy9dfd8sp6EbPb`, never `Co-Authored-By`. Sonnet implementers/reviewers, Opus final review.

## File structure after Phase 4

| Path | Responsibility |
|---|---|
| `app/config.mjs` | `paths.inbox`, `inboxFor`, `rejectedFor`; `ensureLayout` creates `inbox/tazuo` |
| `app/watcher.mjs` (new) | `startWatcher({inboxDir, adapter, scansDir, shard, log, onAccepted, onRejected, debounceMs, retries}) → {close}`; pure helpers `acceptedName(doc)`, `ingestFile(path, …)` |
| `app/watcher.test.mjs` (new) | `[fast]` on tmp dirs |
| `app/installer.mjs` (new) | `listAdapters(adaptersDir)`, `candidateClientRoots({adapter, home, platform, env, exists})`, `validateScriptsDir(dir, adapter)`, `installedVersion(scriptsDir, adapter)`, `installScripts({adapter, adaptersDir, scriptsDir, dataDir, bridgeStatusPath, now})`, `importScans({dir, inboxDir})`, `checkForUpdates({current, repo, fetchImpl})`, `repoFromPackage(pkg)` |
| `app/installer.test.mjs` (new) | `[fast]` |
| `app/vault-server.mjs` | `startServer(config, {host} = {})`; watcher wired in (non-demo); `GET /api/events`; `/api/setup`, `/api/setup/locate`, `/api/setup/install`, `/api/import`, `/api/update-check`, `/api/host/pick-folder`, `/api/host/open-path`; `PUT /api/settings` extended |
| `app/server.test.mjs` | new route tests |
| `adapters/tazuo/packrat-scanner.py`, `packrat-refresh.py`, `README.md` | write into `inbox/tazuo/` |
| `app/ui/events.mjs` (new), `ui/wizard.mjs` (new), `ui/settings.mjs` (new), `ui/app.mjs`, `ui/dom.mjs` (toast exists), `index.html`, `styles.css` | live updates, wizard overlay, Settings tab |
| `electron/main.mjs` (new), `electron/server-entry.mjs` (new), `electron/README.md` (new) | the shell |
| `scripts/shell-smoke.test.mjs` (new) | `[slow]` launches `electron . --smoke` |
| `TESTING.md`, `README.md`, `CONTRIBUTING.md`, `CHANGELOG.md`, `docs/architecture.md` (new) | docs |

---

### Task 1: Inbox layout, the watcher, the events stream, adapters write to the inbox

**Files:**
- Modify: `app/config.mjs`, `app/config.test.mjs`, `app/vault-server.mjs` (startServer wiring, `/api/events`), `app/server.test.mjs`, `adapters/tazuo/packrat-scanner.py` (`OUT_DIR`), `adapters/tazuo/packrat-refresh.py` (its output dir), `adapters/tazuo/README.md`, `adapters/tazuo/test_paths.py` (if it asserts the output dir)
- Create: `app/watcher.mjs`, `app/watcher.test.mjs`

**Interfaces:**
- Consumes: `upgradeScan(raw, {shard})`, `validateScan(doc)` from `app/scan-schema.mjs`; `parseStamp`.
- Produces:
  - `acceptedName(doc, existingNames = new Set()) → string` per the Global Constraints naming rule.
  - `ingestFile({path, scansDir, shard, log}) → {ok: true, file, character, scannedAt} | {ok: false, reason}` — reads and parses the JSON (a parse error is `reason: "invalid JSON: …"`), `upgradeScan`, `validateScan` (first error message as the reason), writes the normalised v2 document to `scansDir/<acceptedName>` via temp-then-rename, then `unlinkSync`s the inbox file.
  - `startWatcher({inboxDir, adapter, scansDir, shard, log = () => {}, onAccepted = () => {}, onRejected = () => {}, debounceMs = 300, retries = 3, retryDelayMs = 700, watch = fs.watch}) → {close(), scanOnce()}`: creates `inboxDir` and watches it (non-recursive); a change to a `*.json` name (not inside `rejected/`) schedules that file after `debounceMs` (a second event resets the timer); `scanOnce()` processes every `*.json` already present (called once at start, so files that landed while the app was closed are ingested); a file that fails parsing/validation is retried `retries` times `retryDelayMs` apart (a half-written file becomes valid), then moved to `inboxDir/rejected/<name>` with `<name>.reason.txt` beside it, `log("rejected …")` and `onRejected({file, reason})`; success → `onAccepted({file, character, scannedAt})`. `close()` stops the watcher and clears timers. A missing file at processing time (the adapter renamed it away) is ignored.
  - Server: `GET /api/events` — SSE: `hello {ok, watching: [adapters]}` on connect, `inventory {file, character, scannedAt, at}` after each accepted file, `rejected {file, reason, at}`, `ping` every 15 s; clients tracked in a Set and ended in `close()` like the job streams. Only in non-demo mode does the server start a watcher (one per `adapters/*/` id present under `adapters/`, currently `tazuo`), passing `shard = currentSettings.shard`; the watcher's `log` appends to `CONFIG.paths.log`. `close()` closes watchers.

- [ ] **Step 1: Config** — `paths.inbox`, `inboxFor(adapter)`, `rejectedFor(adapter)`; `ensureLayout` creates `join(inbox, "tazuo")`. `[smoke]` test in `config.test.mjs`: the three resolve under `dataDir` and `ensureLayout` creates the inbox dir.
- [ ] **Step 2: Watcher tests (`app/watcher.test.mjs`, `[fast]`, tmp dirs, `shard: "uoalive"`, rules not needed):** `acceptedName` for `Fixture` at `2026-09-15T12:00:00+02:00` → `Fixture-20260915T120000+0200.json`, a name with spaces/apostrophes slugged, a collision → `-2`; `ingestFile` on the adapter fixture copy → a v2 file in `scansDir` with the accepted name and the inbox file gone; on `{"schemaVersion":2}` alone → `ok: false` with a validation reason, file untouched; on `not json` → `invalid JSON` reason. `startWatcher` with an injected fake `watch` (returns `{close}` and lets the test fire `(eventType, filename)`): dropping a valid file (write `.tmp` then rename) + firing → `onAccepted` within 1 s and the file in `scansDir`; a file that is `not json` → after `retries` firings/delays it lands in `rejected/` with a `.reason.txt` and `onRejected` fired once; `scanOnce()` ingests a pre-existing file without any event; `close()` then a fire → nothing happens. Use short `debounceMs: 20, retryDelayMs: 20` in tests.
- [ ] **Step 3: Write `app/watcher.mjs`** (~110 lines). Debounce per filename (`Map<name, timer>`); processing is serialised through a promise chain so two files never interleave; every `await` is guarded by a `closed` flag.
- [ ] **Step 4: Server wiring + `/api/events`** per the Interfaces block; `[fast]` server tests: on a token-free tmp server (non-demo, `--data` tmp), `GET /api/events` with `rawReq` streaming — assert the `hello` event lists `tazuo`; write a valid fixture-derived scan into `<data>/inbox/tazuo/` via temp+rename → an `inventory` event arrives within 3 s AND `GET /api/inventory` then reports the character; write `not json` → a `rejected` event and the file under `inbox/tazuo/rejected/`. Under `--demo` no watcher runs (`hello.watching` is `[]`).
- [ ] **Step 5: Adapters** — scanner and refresh write to `os.path.join(data_dir(), "inbox", "tazuo")` (create it); README "Output" lines updated; `test_paths.py` updated if it names `scans`. `python3 -W error adapters/tazuo/test_paths.py` passes; `grep -rn -i -E 'while\s*\(?\s*(true|1)\b' adapters` empty.
- [ ] **Step 6: `npm test` PASS; commit** — `git add app adapters && git commit -m "Watch an inbox per adapter, normalise scans into scans/, stream accept/reject events"`.

---

### Task 2: Installer library and the setup, import, update-check and host routes

**Files:**
- Create: `app/installer.mjs`, `app/installer.test.mjs`
- Modify: `app/vault-server.mjs` (routes; `startServer(config, {host})`; settings extension), `app/server.test.mjs`, `app/schema/` (no schema change needed — settings are validated inline)

**Interfaces:**
- Produces (`app/installer.mjs`, pure, `node:fs`/`node:path` only):
  - `listAdapters(adaptersDir) → [{id, name, scripts: [file names], capabilities, summary}]` — one per subdirectory holding `capabilities.json`; `name` = the README's first heading text or the id; `summary` = one line built from capabilities (`"reads every layer, bank, ground, nested bags; bridge: highlight, grab, goto"`); `scripts` = the `packrat-*.py` files.
  - `candidateClientRoots({adapter, home, platform, env, exists}) → string[]` — for `tazuo`: `[Desktop, Downloads, Documents]` under `home` each with `/TazUO`, plus `env.LOCALAPPDATA + "/TazUO"` and `C:\TazUO` on win32, `~/Desktop/TazUO`; a root qualifies when `exists(join(root, "TazUO", "LegionScripts"))` or `exists(join(root, "LegionScripts"))`; returns the matching `LegionScripts` directories (deduped, in that order).
  - `validateScriptsDir(dir, adapter) → {ok, scriptsDir} | {ok: false, error}` — accepts the dir itself, `<dir>/LegionScripts`, or `<dir>/TazUO/LegionScripts`; must exist and be a directory.
  - `installedVersion(scriptsDir, adapter) → {version|null, files: {[name]: bool}}` — reads `ADAPTER_VERSION = "x.y.z"` from the installed scanner when present.
  - `installScripts({adapter, adaptersDir, scriptsDir, dataDir, bridgeStatusPath, now = Date.now}) → {ok: true, installed: string[], version} | {ok: false, code: "running"|"badDir", error}` — the guard from the Global Constraints; writes each script as `<name>.new` then `renameSync` into place; then `packrat-paths.json` = `{ "dataDir": dataDir }`.
  - `importScans({dir, inboxDir}) → {copied: number, skipped: number}` — copies `*.json` (top level only) into `inboxDir` with `copyFileSync` to a `.tmp` then `renameSync`; a name already present in `inboxDir` is skipped.
  - `repoFromPackage(pkg) → "owner/name" | null` (from `repository` string or `{url}`, GitHub only); `checkForUpdates({current, repo, fetchImpl = fetch}) → {configured, current, latest, url, upToDate}` using `https://api.github.com/repos/<repo>/releases/latest` (`tag_name` with an optional leading `v`; semver compare on three numeric parts; a non-200 → `{configured: true, error: "…"}`).
- Server:
  - `startServer(config, { host } = {})`: `host` may provide `pickFolder({title}) → Promise<string|null>`, `openPath(path) → Promise<void>`. Absent → the routes answer `{ok: false, error: "not available outside the desktop app"}` with 501.
  - `GET /api/setup → {ok, firstRun: !settings.setupDone, settings, adapters: listAdapters(), candidates: {[adapterId]: string[]}, installed: settings.client ? installedVersion(...) : null, available: {[adapterId]: version from the repo scripts}, dataDir}`.
  - `POST /api/setup/locate {adapter, dir}` → `validateScriptsDir` → `{ok, scriptsDir, installed}` or 400.
  - `POST /api/setup/install {adapter, scriptsDir}` → `installScripts` → 200 `{ok, installed, version}` and settings `client` saved; 409 on `running`; 400 on `badDir`.
  - `POST /api/import {dir}` → 400 unless an existing directory → `importScans` into `inboxFor("tazuo")` → `{ok, copied, skipped}` (the watcher does the rest).
  - `GET /api/update-check` → `checkForUpdates` with `current = package.json version`.
  - `POST /api/host/pick-folder {title}` → `host.pickFolder` → `{ok, path|null}`; `POST /api/host/open-path {which}` → `host.openPath(dataDir | logs dir)`.
  - `PUT /api/settings` merges `{shard?, setupDone?, client?}` (client `null` or `{adapter: string, scriptsDir: string}`).

- [ ] **Step 1: Installer tests (`[fast]`, tmp dirs, a fake `adaptersDir` built by copying `adapters/tazuo`):** `listAdapters` finds `tazuo` with three scripts and a summary mentioning `grab`; `candidateClientRoots` with an injected `exists` returns only qualifying dirs, in order, deduped, win32 adds `LOCALAPPDATA`; `validateScriptsDir` accepts the three forms and rejects a file/missing dir; `installedVersion` reads `2.0.0` after an install and `null` before; `installScripts` refuses with `code: "running"` when `status.json` has `alive` 10 s ago and no `stopped`, proceeds when `stopped: true` or `alive` 5 min ago or the file is missing; installs byte-identical copies (compare buffers), leaves no `.new` files, writes `packrat-paths.json` with the given `dataDir`; `importScans` copies only `*.json`, skips duplicates, never removes the source; `repoFromPackage` for `"github:o/n"`, `"https://github.com/o/n.git"`, `{url}` and `null` for non-GitHub; `checkForUpdates` with a fake `fetchImpl` → `upToDate` true/false and the release `html_url`, and `configured: false` when `repo` is null.
- [ ] **Step 2: Write `app/installer.mjs`** (~160 lines).
- [ ] **Step 3: Routes + settings extension + `host` injection** per the Interfaces block. Server tests `[fast]`: `GET /api/setup` on a fresh tmp data dir → `firstRun: true`, adapters `[tazuo]`, `available.tazuo === "2.0.0"`; `POST /api/setup/locate` with a tmp `X/TazUO/LegionScripts` → that path; `POST /api/setup/install` into it → files present, settings `client` saved, `GET /api/setup` → `firstRun` still true until `PUT /api/settings {setupDone: true}`; with a fresh `status.json` (`alive` now) → 409 with the `-stopall` message; `POST /api/import` from a dir with two fixture copies + a `.txt` → `copied: 2`, and an `inventory` event follows (or `/api/inventory` shows the characters within 3 s); `GET /api/update-check` → `configured` reflects `package.json`; `POST /api/host/pick-folder` → 501 on the bare server, and with `startServer(cfg, {host: {pickFolder: async () => "/x"}})` → `{path: "/x"}`; `open-path {which: "etc"}` → 400; `PUT /api/settings {client: {adapter: 5}}` → 400 naming `client`.
- [ ] **Step 4: `npm test` PASS; commit** — `git add app && git commit -m "Add the installer library and the setup, import, update-check and host routes"`.

---

### Task 3: The page — live updates, the first-run wizard, the Settings tab

**Files:**
- Create: `app/ui/events.mjs`, `app/ui/wizard.mjs`, `app/ui/settings.mjs`
- Modify: `app/ui/app.mjs` (`load()` calls `connectEvents()` once; `firstRun` → `openWizard()`; Settings tab wiring), `app/index.html` (a `Settings` tab button + panel; a wizard `<dialog id="wizard">`), `app/ui/styles.css` (wizard/settings layout, reuse existing tokens), `app/ui/dom.mjs` only if `toast()` needs a variant

**Interfaces:**
- Consumes Task 2's routes and Task 1's `/api/events`.
- Produces: `connectEvents()` — one `EventSource("/api/events")` for the page's life; `inventory` → `toast("Scan from <character> landed")` then `reload()` (a new exported function in `app.mjs` that re-runs the data part of `load()` without re-fetching rules and keeps the current tab and builder character); `rejected` → `toast("<file> was rejected: <reason>", "bad")`; reconnects by itself (EventSource default). `openWizard({firstRun})` — a `<dialog>` with four steps: (1) shard (the same list as the header picker; saving PUTs `shard`); (2) client (radio list from `setup.adapters` with each summary; only `tazuo` for now); (3) locate (the candidate list from `setup.candidates[adapter]` as radios, "Choose a folder…" (calls `/api/host/pick-folder`, and when it answers 501 shows a text input for the path) → `POST /api/setup/locate` → shows the resolved scripts dir and the installed version if any); (4) install — the "No scripts are running in the client" checkbox gating the Install button, `POST /api/setup/install`, the 409 text shown verbatim in red, success shows the three file names and the in-game instructions (verbatim from `adapters/tazuo/README.md`'s "What to press" list), an optional "Already have scan files? Import a folder" row (pick-folder or text input → `POST /api/import` → "copied N"); Finish → `PUT /api/settings {setupDone: true}` and closes; Skip on every step (sets `setupDone: true` too). `renderSettings()` — the Settings tab: data directory (path + "Open" → `/api/host/open-path {which: "data"}` when the host exists, else read-only), logs (same with `logs`), client (adapter, scripts dir, installed vs available version, "Reinstall scripts" (same guard + checkbox), "Run setup again" → `openWizard({firstRun: false})`), "Import scans from a folder", "Check for updates" (shows current/latest and a link to the release page opened in a new tab — under Electron the shell routes it to the OS browser), shard picker duplicate not needed (the header keeps it).

- [ ] **Step 1: `index.html`** — nav button `Settings` (`data-tab="settings"`), a `<section data-panel="settings">` with placeholders the module fills, `<dialog id="wizard" class="wizard">`. `styles.css`: `.wizard` (max-width 40rem container, step header, button row), `.settings .row` grid; no text-element max-width.
- [ ] **Step 2: `events.mjs`, `wizard.mjs`, `settings.mjs`** per the Interfaces block; `app.mjs` `load()` → after data: `if (setup.firstRun && !state.wizardShown) openWizard({firstRun: true})` (fetch `/api/setup` in the same `Promise.all` as settings/rules).
- [ ] **Step 3: Verification (no browser here)** — `node --check` every touched module; start `node scripts/start.mjs --port 0 --data <tmp>` (NOT demo, so the watcher runs), curl `/`, `/ui/events.mjs`, `/ui/wizard.mjs`, `/ui/settings.mjs` (200, `text/javascript`), `GET /api/setup` → `firstRun: true`; stop. The coordinator's browser gate then: first load shows the wizard; Skip closes it and the Inventory shows the empty state; Settings tab renders; drop a fixture copy into `<tmp>/inbox/tazuo/` → toast + inventory appears without a reload; drop `not json` → red toast; wizard re-opens from Settings; step 3's text-input fallback resolves a tmp `TazUO/LegionScripts`; step 4 installs into it (bare server: the checkbox gate, then success with three file names).
- [ ] **Step 4: `npm test` PASS; commit** — `git add app && git commit -m "Add live scan updates, the first-run wizard and the Settings tab"`.

---

### Task 4: The Electron shell and its smoke test

**Files:**
- Create: `electron/main.mjs`, `electron/server-entry.mjs`, `electron/README.md`, `scripts/shell-smoke.test.mjs`
- Modify: `package.json` (`main`, `desktop` script, `devDependencies.electron`), `.gitignore` (nothing new needed), `TESTING.md` (Task 5 does docs; here only the test file)

**Interfaces:**
- `electron/server-entry.mjs` (runs inside `utilityProcess.fork`): reads `VAULT_DATA`, `VAULT_TOKEN`, `VAULT_PORT=0` (already env-driven), `buildCore()` is NOT run here (the packaged app ships `app/dist/`; in dev `npm run desktop` runs `predesktop: node scripts/build-core.mjs`), `ensureLayout(resolveConfig([], process.env))`, `startServer(config, {host})` where `host.pickFolder`/`openPath` send `{type: "host", id, op, args}` over `process.parentPort` and resolve on the matching `{type: "host-result", id, result}`; after listening posts `{type: "listening", port, url}`; on `{type: "shutdown"}` calls `close()` then exits.
- `electron/main.mjs`: `app.requestSingleInstanceLock()` (second instance → focus the window); `--data`/`VAULT_DATA` honoured, else `app.getPath("userData")` (which already ends in the app name); token = `randomUUID()`; `session.defaultSession.webRequest.onBeforeSendHeaders({urls: [`${origin}/*`]}, …)` adds `Authorization: Bearer <token>`; `BrowserWindow` 1280×860 `webPreferences: {sandbox: true, contextIsolation: true, nodeIntegration: false}`, `show: false` until `ready-to-show`; `setWindowOpenHandler` → `shell.openExternal` for `http(s)` and deny; `will-navigate` away from the origin denied; child died before quit → restart once, second death → `dialog.showErrorBox` with the log path and quit; `before-quit` → `shutdown` message then `kill()` after 2 s; logs: `<data>/logs/shell.log` (child stdout/stderr piped, lifecycle lines); `nativeTheme` untouched (follows the OS). `--smoke` mode: after `did-finish-load`, `webContents.executeJavaScript('document.querySelector("#status").textContent')` must be a non-empty string, then print `SMOKE OK <port>` to stdout and `app.exit(0)`; any failure prints `SMOKE FAIL <reason>` and `app.exit(1)`; a 30 s overall timeout.
- `scripts/shell-smoke.test.mjs`: `[slow]` `{skip: !existsSync(node_modules/electron) || process.env.TEST_SKIP_ELECTRON === "1"}`; spawns `node_modules/.bin/electron . --smoke --demo --data <tmp>` with `ELECTRON_ENABLE_LOGGING` unset and asserts exit 0 and `SMOKE OK` in stdout within 60 s; the test runner (`scripts/test-runner.mjs`) picks the file up by its existing glob (check it includes `scripts/*.test.mjs`).

- [ ] **Step 1: `npm i -D electron@44.4.1 --save-exact`**; `package.json` `main`, `"desktop": "electron ."`, `"predesktop": "node scripts/build-core.mjs"`.
- [ ] **Step 2: `server-entry.mjs`** (~60 lines) and **`main.mjs`** (~170 lines) per the Interfaces block. ESM main is supported by Electron ≥ 28 (`"type": "module"` is already set).
- [ ] **Step 3: Manual verification** — `npm run desktop -- --demo --data <tmp>`: a window with the page; DevTools console shows no errors; the page's requests carry the token (check `<tmp>/logs/server.log` has no 401 lines); the wizard's "Choose a folder…" opens a native dialog (host bridge works); "Open" on the data directory opens Finder; Cmd+Q quits and the child exits (no orphan `node`/`Electron Helper` running the server — `pgrep -f server-entry` empty). Then `--smoke`: `node_modules/.bin/electron . --smoke --demo --data <tmp>` prints `SMOKE OK`.
- [ ] **Step 4: The smoke test file; `npm test` PASS (the `[slow]` shell smoke included on this machine); commit** — `git add package.json package-lock.json electron scripts/shell-smoke.test.mjs && git commit -m "Add the Electron shell: utility-process server, token header, single instance, host dialogs, smoke mode"`.

---

### Task 5: Docs and the phase gate

**Files:**
- Create: `docs/architecture.md`
- Modify: `README.md` (status: Phase 4 done, Phase 5 next; "Run the desktop app: `npm run desktop`"; the data directory layout), `CONTRIBUTING.md` (dev loops: bare server vs desktop; the host bridge; the guard rule; browser gates), `TESTING.md` (`watcher.test`, `installer.test`, `shell-smoke.test` `[slow]` + `TEST_SKIP_ELECTRON`), `CHANGELOG.md`, `adapters/tazuo/README.md` (the wizard installs; the inbox), `electron/README.md` (from Task 4, extend if needed), `docs/adapter-guide.md` (adapters write to `inbox/<id>/`; the installer picks up `packrat-*.py`)

- [ ] **Step 1: `docs/architecture.md`** (~70 lines): processes (main, utility-process server, worker threads), the token flow, the host bridge, data directory layout with `inbox/`, the watcher's lifecycle (debounce, retry, quarantine), the installer guard, what the bare server can and cannot do, logs.
- [ ] **Step 2: The other docs** per the file list; `grep -rn -i "phase 3 done\|Phase 4 (Electron shell) next" README.md` updated.
- [ ] **Step 3: Gate** — `npm test` full green (incl. the shell smoke here); `npm run test:smoke` green; `python3 -W error adapters/tazuo/test_paths.py`; `git status` clean; commit — `git add -A && git commit -m "Document the desktop shell, the inbox watcher and the installer"`.

---

## Self-review

- **Spec coverage.** §4.1 utility process, port 0, window flags, no preload: T4. §4.2 data dir under Electron, `inbox/<adapter>/`, legacy import by copy: T1 (layout), T2/T3 (import). §4.3 wizard four steps, candidate paths, folder dialog, install + paths file + in-game instructions, ends on the empty Inventory: T2/T3. §4.4 `fs.watch`, 300 ms debounce, retry ×3, quarantine to `rejected/`, temp-then-rename in adapters, validated + normalised into `scans/`, cache invalidation (already signature-based): T1. §4.5 token via `onBeforeSendHeaders`, page token-free: T4. §10 manual update check: T2/T3. §11 single instance, child restart once + log path, kill on quit, running-script guard with `.new` + rename, installed version header line, `while True`/`import API` tests untouched: T1/T2/T4. §12 Phase 4 row: complete. Deferred to Phase 5 (spec puts them there or in "finish-line"): Playwright Electron smoke, packaging, "Export my data" zip, the AFK-rules banner text on first run (add to the wizard's step 1 — **included**: T3 step 1 shows the UO Alive rule quote when the shard is `uoalive`; ruling made here), privacy statement.
- **Placeholder scan.** None; every step has files, assertions and commands.
- **Type consistency.** `startWatcher`'s callbacks feed `/api/events` (T1 both); `listAdapters`/`installedVersion` shapes are what `/api/setup` returns and the wizard reads (T2 → T3); `host` ops `pickFolder`/`openPath` are the two the server routes call and `server-entry.mjs` implements (T2 → T4); settings fields `setupDone`/`client` written by T2's route, read by T3's wizard/settings.
- **Rulings for the user (report at the merge):** `/api/events` is token-protected (the shell adds the header; SSE needs no exemption there); the data dir under Electron is `app.getPath("userData")` itself; the dev-only shell smoke replaces Playwright until Phase 5; the AFK banner lives in the wizard's shard step.
