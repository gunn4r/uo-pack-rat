# Electron packaging research for the Gear Vault (2026-09-12)

Scope: turn `app/` (zero-dependency Node http server + one HTML page + worker-thread optimizer) into a downloadable desktop app for Windows and macOS (Linux nice-to-have). Every version number below was checked on 2026-09-12 with `npm view`, the GitHub API or the linked page; anything I could not confirm is listed in §11.

## 0. What the app is today (read from the source)

- `app/vault-server.mjs`: plain `node:http`, `server.listen(PORT, "127.0.0.1")`, `PORT = +(process.env.VAULT_PORT || 8765)`, ESM. Request/header timeouts are zeroed because exact searches run for minutes. On macOS it spawns `open <url>` unless `--no-open`.
- The optimizer core is `scripts/optimizer-core.ts` (plain TypeScript, no build step). `compileCore()` copies it to `$TMPDIR/vault-*/core.ts`, appends `export { optimizeSuit, scoreSet }`, and `await import()`s it, so it relies on Node's built-in type stripping (the temp file keeps the `.ts` extension). Worker threads (`app/optimize-worker.mjs`, up to `min(8, availableParallelism()-1)`) import the same URL and share one `SharedArrayBuffer` (`app/shared-search.mjs`: int32 task counter + float64 best score updated with `Atomics.compareExchange` on a BigInt64 view).
- `vault-lib.mjs` is hot-reloaded by mtime (`import(url + "?v=" + mtime)`), a dev convenience that must keep working for `node app/vault-server.mjs` and is harmless in a packaged app.
- Data files: `exports/scans/*.json` (read fresh on every `GET /api/inventory`; the server has NO `fs.watch`, the page fetches once on load), `app/data/profiles.json` (+ dated backups), `app/data/runs/<id>.json`, `exports/bridge/queue.jsonl` + `status.json`. `POST /api/forget` writes a tombstone scan into the scans dir. All of these are `join(HERE, ...)` / `join(ROOT, ...)` paths relative to the source tree, which is read-only inside a packaged app: they need one `VAULT_DATA_DIR` override.
- `app/gear-vault.html`: single page, every call is a RELATIVE URL (`fetch("/api/...")`, `new EventSource("/api/optimize/<id>/events")`), so the page is port-agnostic. It has inline `<script>` and `<style>` blocks, loads IBM Plex from `fonts.googleapis.com` (the only external resource, relevant to CSP and offline use) and uses `localStorage` in two places.
- Python side: `scripts-legion/vault-scanner.py` writes into `exports/scans/<Char>-<stamp>.json` under the original private workspace with a plain `open(path, "w")` + `json.dump(indent=1)` (no write-then-rename); `vault-bridge.py` polls `exports/bridge/queue.jsonl` under the same workspace every 0.5 s and writes `status.json`. Both paths are hard-coded via `os.path.expanduser`; they must become configurable (§3).
- Dev machine Node: v24.15.0. Tests: `./scripts/test_runner.sh`.

## 1. Electron / Node table, type stripping, ESM main process

Latest stable per major, from `https://releases.electronjs.org/releases.json` (3,402 releases parsed; date = latest patch of that line):

| Electron | Node | Chromium | released |
|---|---|---|---|
| 44.3.0 (npm `latest`) | 24.20.0 | 152 | 2026-09-08 |
| 43.7.0 | 24.21.0 | 150 | 2026-09-10 |
| 42.11.3 | 24.19.0 | 148 | 2026-09-08 |
| 41.10.7 | 24.18.0 | 146 | 2026-08-24 |
| 40.10.6 | 24.15.0 | 144 | 2026-07-01 |
| 39.8.10 | 22.22.1 | 142 | 2026-05-05 |
| 38.8.6 | 22.22.0 | 140 | 2026-03-10 |
| 37.10.3 | 22.21.1 | 138 | 2025-11-25 |
| 36.9.5 | 22.19.0 | 136 | 2025-10-14 |
| 35.7.5 | 22.16.0 | 134 | 2025-08-19 |
| 34.5.8 | 20.19.1 | 132 | 2025-06-04 |
| 28.3.3 (first ESM-capable main process) | 18.18.2 | 120 | 2024-05-23 |

Prereleases: 45.0.0-alpha.6 and the 46 nightlies ship Node 24.21.0. Support policy: "the latest three stable major versions are supported by the Electron team" (42, 43, 44 today), only the latest minor of each gets fixes (https://www.electronjs.org/docs/latest/tutorial/electron-timelines).

Node type stripping (`nodejs/node` `doc/api/typescript.md`): `--experimental-strip-types` added v22.6.0; on by default since v23.6.0 and backported to v22.18.0; `--experimental-transform-types` (enums, namespaces with runtime code, parameter properties) added v22.7.0. `.tsx` is unsupported, TypeScript under `node_modules` is refused, and `module.stripTypeScriptTypes(code)` (a programmatic API, `node:module`, added v22.13.0 / v23.2.0, stability 1.2) exists for build steps. Electron-side: electron/electron PR #49711 (merged Feb 2026 into 39/40/41) states "Electron already supports type stripping by default" and adds `--experimental-transform-types`; issue #49004 (open) is only about TypeScript in *preload* scripts. So Electron 36+ (Node ≥ 22.18) strips types in the main process and in utility/worker code without flags; Electron 35 (Node 22.16) would need the flag, which you cannot pass to Electron's embedded Node.

**Recommendation: pin Electron `44.3.0` (Node 24.20.0, same Node line as the dev machine) and still precompile `optimizer-core.ts` at build time.** Type stripping would work, but (a) `compileCore()` writes a `.ts` into `os.tmpdir()` at every start, which is exactly the kind of "write outside the asar, import from a temp path" step that breaks under a hardened build (`onlyLoadAppFromAsar` fuse, read-only install dirs, antivirus on Windows scanning `%TEMP%`), (b) worker threads inherit whatever flags Electron's Node was built with, which the app does not control, and (c) a 15-line build script using `module.stripTypeScriptTypes` from `node:module` keeps the runtime zero-dependency. Concretely: `scripts/build-core.mjs` reads `scripts/optimizer-core.ts`, appends the `export { optimizeSuit, scoreSet }` line, runs `stripTypeScriptTypes(src, { mode: "strip" })` and writes `app/dist/optimizer-core.mjs`; `vault-server.mjs` gains `const CORE_URL = process.env.VAULT_CORE ? pathToFileURL(process.env.VAULT_CORE).href : compileCore();` so `node app/vault-server.mjs` keeps the current live-from-source behaviour and the Electron shell sets `VAULT_CORE`. (The test harnesses in `app/gear-vault.test.mjs` and `scripts/optimizer-core.test.mjs` already do the same append-and-import trick, so the build script is not new territory.) Caveat from the Node docs: `stripTypeScriptTypes` output "should not be considered stable across Node.js versions", which is fine for a build artefact but means the build should run on a pinned Node in CI.

ESM main process (Electron ≥ 28, https://www.electronjs.org/docs/latest/tutorial/esm and the Electron 28 blog post, which also lists "Added ESM entrypoints to the UtilityProcess API, #40047"): use `main.mjs` or `"type": "module"`; ES modules load asynchronously, so `await` everything that must happen before `ready` (dynamic `import()` at top level can resolve after the app is already ready; static imports are fine) and call `app.setPath('userData', ...)` before `await app.whenReady()`; `__dirname`/`require` do not exist (use `import.meta.dirname`, Node ≥ 20.11, or `createRequire`); sandboxed preload scripts cannot use ESM imports (they run as plain scripts; `require('electron')` still works) and unsandboxed ESM preloads must end in `.mjs`. We need no preload at all (§2), so the preload caveats do not apply.

## 2. Architecture: where the server runs, how the page is loaded

Options considered:

(a) Run `vault-server.mjs` inside the Electron main process and `loadURL('http://127.0.0.1:<port>')`. Works (worker_threads and `SharedArrayBuffer` are plain Node features available in the main process), but a bug or a long synchronous fold in the server blocks the UI thread that also drives menus, dialogs and the window, and a crash takes the whole app down.

(b) Fork the server as a `utilityProcess` (https://www.electronjs.org/docs/latest/api/utility-process): a Chromium-services-hosted Node child with the `child_process.fork` API shape, ESM entrypoints since Electron 28, `env`, `execArgv`, `stdio: 'pipe'`, `serviceName` (shows up in Activity Monitor / Task Manager), `postMessage` + `process.parentPort` on the child side, `exit` event with the code. Worker threads and `SharedArrayBuffer` inside it behave exactly as under plain Node because it is plain Node. The same file keeps running as `node app/vault-server.mjs` for developers.

(c) `loadFile('gear-vault.html')` from `file://` and replace `fetch`/`EventSource` with IPC through a preload/contextBridge. Requires rewriting every API call in the page and re-implementing SSE over IPC; loses the "open it in Chrome" fallback and the dev loop of editing the page and reloading against a running server. Not worth it.

**Recommendation: (b), utilityProcess, with the page loaded over `http://127.0.0.1:<port>`.** Shape:

```js
// electron/main.mjs
import { app, BrowserWindow, utilityProcess, shell, dialog } from 'electron';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const HERE = import.meta.dirname;
if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => { const w = BrowserWindow.getAllWindows()[0]; if (w) { if (w.isMinimized()) w.restore(); w.focus(); } });
await app.whenReady();
const child = utilityProcess.fork(join(HERE, '..', 'app', 'vault-server.mjs'), ['--no-open'], {
  serviceName: 'Gear Vault server', stdio: 'pipe',
  env: { ...process.env, VAULT_PORT: '0', VAULT_DATA_DIR: app.getPath('userData'), VAULT_CORE: join(HERE, '..', 'app', 'dist', 'optimizer-core.mjs') },
});
child.stdout.on('data', (d) => log.info(String(d)));  child.stderr.on('data', (d) => log.error(String(d)));
const port = await new Promise((res, rej) => { child.once('message', (m) => m.type === 'listening' && res(m.port)); child.once('exit', (code) => rej(new Error(`server exited ${code}`))); });
const win = new BrowserWindow({ width: 1400, height: 900, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
await win.loadURL(`http://127.0.0.1:${port}/`);
app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => child.kill());
```

```js
// vault-server.mjs additions
const PORT = +(process.env.VAULT_PORT ?? 8765);          // 0 = pick a free port
server.listen(PORT, "127.0.0.1", () => {
  const port = server.address().port;
  if (process.parentPort) process.parentPort.postMessage({ type: "listening", port });   // only defined inside utilityProcess
  ...
});
```

Why this shape: `listen(0)` makes the OS hand out a free port, which removes the "8765 already in use" class of bugs entirely (a second copy of the app is blocked by the single-instance lock anyway; a developer's `node app/vault-server.mjs` on 8765 coexists). The page is unchanged because all its URLs are relative. No preload, no contextBridge, no `nodeIntegration`, sandbox on, which is the whole Electron security checklist for free (https://www.electronjs.org/docs/latest/tutorial/security: sandbox + contextIsolation + no Node in the renderer + CSP + limited navigation).

Security details that matter for a localhost server:
- **CSP**: Electron honours the `Content-Security-Policy` header, and the server already sets headers, so add it in `send()` for the HTML response (the docs' alternative is `session.defaultSession.webRequest.onHeadersReceived`; the meta-tag route is only needed for `file://`). The page has inline scripts and styles today, so a strict policy needs either hashes/nonces or moving the script into `gear-vault.js`; start with `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'` after externalising the script block. Bundle IBM Plex (woff2, OFL licence) under `app/fonts/` instead of `fonts.googleapis.com` so the app works offline and the CSP stays `'self'`-only.
- **Navigation**: `will-navigate` should only allow the server's own origin; `setWindowOpenHandler` sends every other link to the system browser (`shell.openExternal`).
- **Cross-site requests to the loopback server**: any web page in the user's browser could try `fetch('http://127.0.0.1:<port>/api/bridge', {method:'POST'})`. JSON bodies trigger a CORS preflight the server does not answer, and Chromium's private-network-access rules block public-to-loopback requests, but cheap belt-and-braces: reject any request whose `Host` header is not `127.0.0.1:<port>`/`localhost:<port>` (defeats DNS rebinding) and any request carrying an `Origin` header that is not the server's own origin. `/api/bridge` executes actions in the game client, so this is worth the ten lines.
- The Chromium renderer needs cross-origin isolation for a *renderer-side* `SharedArrayBuffer`; ours lives in Node worker threads, so no COOP/COEP headers are needed.
- Give the window a small `ready-to-show` splash or just show it after `loadURL` resolves; the server needs ~100 ms to compile-import the core and read scans.

## 3. First run: finding TazUO, installing the two scripts, watching the scans folder, app data

**Where TazUO lives.** There is no fixed install path: the official instructions are "Download TazUO Launcher, Run the Launcher" for Windows, macOS and Linux (https://tazuo.org/introduction/how-to-install/), i.e. a zip the player extracts anywhere. The launcher's layout (verified on this Mac) is `<root>/TazUOLauncher` (+ `launcherdata.json`, `Profiles/`, `update/`) and the client in `<root>/TazUO/` with `TazUO/LegionScripts/` and `TazUO/Data/Profiles/<account>/...`. Detection = candidates + validation + dialog:

```js
const candidates = process.platform === 'win32'
  ? ['Desktop', 'Downloads', 'Documents', 'Games'].map((d) => join(home, d, 'TazUO')).concat([join(process.env.LOCALAPPDATA || '', 'TazUO'), 'C:\\TazUO', 'C:\\Games\\TazUO', join(process.env.ProgramFiles || '', 'TazUO')])
  : ['Desktop', 'Downloads', 'Applications', 'Games', ''].map((d) => join(home, d, 'TazUO'));
// a valid root has TazUO/LegionScripts (or is the TazUO/ dir itself, or LegionScripts/ itself); also accept launcherdata.json as a marker
```

If nothing validates, `dialog.showOpenDialog({ properties: ['openDirectory'], title: 'Pick your TazUO folder' })` (https://www.electronjs.org/docs/latest/api/dialog), accept the root, the inner `TazUO/` or `LegionScripts/` and normalise. Persist the resolved `legionScriptsDir` in settings. Windows paths with spaces and non-ASCII user names are fine as long as nothing goes through a shell string.

**Installing the scripts.** Copy `vault-scanner.py` and `vault-bridge.py` (bundled via electron-builder `extraResources`, so they sit unpacked in `<app>/resources/legion/` and are readable with plain `fs`) into `LegionScripts/`, and write `LegionScripts/vault-paths.json` = `{ "scans": "<userData>/scans", "bridge": "<userData>/bridge" }`. Change both scripts to read that file (next to themselves) and fall back to the current defaults under the original private workspace when it is absent, so the developer copy keeps working. Never overwrite a script while it may be running (the orphaned-thread gotcha in the project CLAUDE.md): show "type `-stopall` in game first" before an upgrade copy, and compare file hashes so re-runs are no-ops. TazUO's Script Manager picks the files up on its own; the player still presses Play (or sets per-character autostart), so the first-run screen must say so.

**Watching the scans folder.** Facts: `fs.watch` uses FSEvents for directories on macOS, `ReadDirectoryChangesW` on Windows and inotify on Linux; the Node docs list its caveats: not 100% consistent across platforms, `filename` in the callback is not guaranteed, on Windows no events if the watched directory is moved/renamed and `EPERM` if it is deleted, and it is unavailable on some (network) file systems (https://nodejs.org/api/fs.html#caveats). chokidar 5.0.0 (Nov 2025) is ESM-only, requires Node ≥ 20, has exactly one dependency (`readdirp`), no native `fsevents` any more (dropped in v4), and offers `awaitWriteFinish: { stabilityThreshold, pollInterval }` for files still being written plus `usePolling` for network drives (https://github.com/paulmillr/chokidar). **Recommendation: `fs.watch` on the single flat scans directory, zero dependencies, wrapped as: debounce 300 ms → `readdir` → for each `.json` newer than the last fold, `JSON.parse` with retry (3 × 250 ms) on `SyntaxError`/`EBUSY` → fold → push an SSE event.** Add a 10 s `readdir` poll as fallback whenever `fs.watch` throws (network share, deleted dir) and re-arm the watcher on `error`. Reach for chokidar only if the fallback logic grows past ~60 lines. The partial-file problem is solved at the writer: make `vault-scanner.py` write `<name>.json.tmp` and `os.replace(tmp, final)` (atomic rename on both platforms; the watcher ignores non-`.json` names), which turns "file still being written" into a non-event; the parse-retry stays as insurance for the bridge's `status.json`, which is rewritten every few seconds. The page currently fetches the inventory once on load, so add `GET /api/events` (SSE: `inventory-changed`, `bridge-status`) and have the page refetch `/api/inventory` on it; the existing per-job SSE code is the template.

**Where things go.** `app.getPath('userData')` = `~/Library/Application Support/<name>` on macOS, `%APPDATA%\<name>` on Windows, `$XDG_CONFIG_HOME/<name>` or `~/.config/<name>` on Linux; the docs recommend a subdirectory of `userData` rather than its root to avoid colliding with Chromium's own `Cache`/`Local Storage` folders, and warn it may be cloud-backed-up, so keep big files elsewhere (https://www.electronjs.org/docs/latest/api/app#appgetpathname). Layout: `<userData>/gear-vault/{scans,runs,bridge,profiles.json,settings.json}`; logs in `app.getPath('logs')` (macOS `~/Library/Logs/<name>`, Windows `%APPDATA%\<name>\logs`, the same places electron-log defaults to). Settings: plain JSON written atomically (`writeFileSync(tmp)` + `renameSync`), the same idiom the server already uses for profiles; `electron-store` 11.0.2 (ESM-only, requires Electron ≥ 30, https://github.com/sindresorhus/electron-store) is fine but is a dependency for a 20-line job. Migration for the maintainer's own machine: on first run, if `<repo>/exports/scans` exists, offer to import it (copy) and to point the scripts at the new dir; alternatively `VAULT_DATA_DIR` env/setting can stay pointed at the repo so the dev workflow does not change.

## 4. Packaging: electron-builder, targets, asar, sizes, staying dependency-free

electron-builder vs Forge: Electron's docs list both as supported tooling (https://www.electronjs.org/docs/latest/tutorial/application-distribution); Forge 7.11.2 (May 2026) is the "official" one, electron-builder has the turnkey GitHub-Releases publisher + `electron-updater`, NSIS `portable`, AppImage and the documented signing/notarization env-var workflow, and no native modules means Forge's rebuild integration buys nothing here. **Recommendation: electron-builder 26.16.x.** Versions on npm today: `latest` = 26.15.3 (stale tag), `v26` = 26.16.1 (published 2026-09-07, the current stable line, GitHub release `electron-builder@26.16.1`), `next` = 27.0.0-alpha.8 (ESM-only rewrite, minimum Node 22.12, many config keys renamed: `mac.sign`, `win.sign`, `electronGet`, `mac.universal`, migrated by `electron-builder migrate-schema`; https://www.electron.build/docs/migration/whats-new-v27). Pin `"electron-builder": "26.16.1"` and `"electron-updater": "6.8.9"` (7.0.0-alpha pairs with builder 27); note the docs site already describes v27 syntax, so read config examples with the v26 names (e.g. `mac.notarize`, `win.azureSignOptions`).

Targets (https://www.electron.build/docs/mac, /docs/nsis, /docs/linux, /docs/appimage):
- macOS: defaults are `dmg` + `zip`, and "both are required for Squirrel.Mac auto-update" (`zip` is what `latest-mac.yml` points at). Build `arch: [x64, arm64]` as two separate downloads rather than `universal`: a universal build is the two apps merged by `@electron/universal` (`mergeASARs`), roughly the size of both, and electron-updater serves per-arch files anyway. Electron 44.3.0's own zips are 123.8 MB (darwin-arm64) and 127.9 MB (darwin-x64), so expect ~120-135 MB per dmg.
- Windows: `nsis` (default; `oneClick: true` per-user install, no UAC; set `oneClick: false` + `allowToChangeInstallationDirectory: true` if players want a folder picker) plus `portable` (`--win portable`, a single exe; env vars `PORTABLE_EXECUTABLE_DIR` etc. are available at runtime, and note `build/installer.nsh` is not auto-included for portable). Electron 44.3.0 win32-x64 zip is 150.8 MB; the LZMA NSIS installer of an Electron app of this size lands around 90-110 MB, portable a bit less. `arm64` Windows is optional (149.0 MB zip); the docs mention `ia32` only for Electron ≤ 43, so skip it.
- Linux: `AppImage` x64 (must be built on Linux or in the `electronuserland/builder` Docker image; the CI matrix covers it). linux-x64 zip is 117.1 MB, AppImage ~110-130 MB. Skip snap/deb for v1.

asar: keep it on (default; faster `require`, avoids Windows long-path trouble) with the default `smartUnpack`. Add `asarUnpack: ["app/**", "resources/legion/**"]` for two reasons: the utilityProcess entrypoint and the worker-thread modules are loaded by path and `import()`ed by URL, and while Electron patches `fs`/`require` to read from asar in the main process, whether that patch reaches `worker_threads` inside a utility process is not documented (issue electron/electron#22446 "Unable to use files from app.asar in worker_threads" was closed as stale in 2021 with the workaround "asarUnpack the worker scripts"); unpacking `app/` (< 1 MB) removes the question. Second, the Legion scripts must be readable as real files to copy them. Use `extraResources` for the Python scripts and fonts if they should be visible next to the app rather than inside it.

Zero-dependency at runtime: keep `"dependencies": {}`; electron, electron-builder, and the build script live in `devDependencies`. electron-builder always ships production `node_modules`, so every runtime dependency costs download size and supply-chain surface; `electron-updater` (§6) would be the only one, `electron-log` is optional (§8). Files list: `["electron/**", "app/vault-server.mjs", "app/vault-lib.mjs", "app/optimize-worker.mjs", "app/shared-search.mjs", "app/gear-vault.html", "app/fonts/**", "app/dist/**", "app/data/profiles.default.json", "package.json"]` and nothing else (no tests, fixtures, bench, scans). Sketch:

```yaml
# electron-builder.yml (v26 key names)
appId: com.gearvault.app
productName: Gear Vault
files: [electron/**, app/vault-server.mjs, app/vault-lib.mjs, app/optimize-worker.mjs, app/shared-search.mjs, app/gear-vault.html, app/fonts/**, app/dist/**, app/data/profiles.default.json]
asarUnpack: ["app/**"]
extraResources: [{ from: scripts-legion/vault-scanner.py, to: legion/ }, { from: scripts-legion/vault-bridge.py, to: legion/ }]
mac: { category: public.app-category.games, target: [{ target: dmg, arch: [x64, arm64] }, { target: zip, arch: [x64, arm64] }], hardenedRuntime: true, notarize: true }
win: { target: [{ target: nsis, arch: [x64] }, { target: portable, arch: [x64] }] }
nsis: { oneClick: true, perMachine: false }
linux: { target: [AppImage], category: Game }
publish: { provider: github, owner: <owner>, repo: <repo>, releaseType: draft }
electronFuses: { runAsNode: false, enableNodeOptionsEnvironmentVariable: false, enableNodeCliInspectArguments: false, enableEmbeddedAsarIntegrityValidation: true, onlyLoadAppFromAsar: true }
```

The fuses block is electron-builder's built-in `@electron/fuses` support (https://www.electron.build/docs/tutorials/adding-electron-fuses); `onlyLoadAppFromAsar` + integrity validation are the standard hardening for a signed app, and `runAsNode: false` closes the "use the app binary as a Node interpreter" hole. Check `onlyLoadAppFromAsar` against `asarUnpack` in a real build: the main entry stays inside the asar, unpacked files are referenced through `app.asar.unpacked`, which is the supported combination, but it is exactly the kind of thing to verify once (§11).

## 5. Signing and notarization

macOS: Apple's own tutorial and electron-builder's notarization page agree on the requirements: Apple Developer Program membership ($99/year per electron-builder's page; Apple's comparison page confirms "Mac software notarization" is a paid-membership feature), a Developer ID Application certificate, hardened runtime, entitlements, and notarization credentials (Apple ID + app-specific password + team ID, or an App Store Connect API key) (https://www.electron.build/docs/features/code-signing/notarization, https://www.electronjs.org/docs/latest/tutorial/code-signing). electron-builder signs automatically when an identity is in the keychain or `CSC_LINK`/`CSC_KEY_PASSWORD` are set, and notarizes with `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` in the environment. Unsigned: since macOS 10.15 apps distributed outside the store "must be notarized or Gatekeeper will block them"; on current macOS the dialog says the app "is damaged"/"can't be opened" and the only user paths are System Settings → Privacy & Security → "Open Anyway" after the first failed attempt (https://support.apple.com/en-us/102445) or `xattr -dr com.apple.quarantine <app>` in Terminal, the same dance TazUO's own launcher requires on this Mac. Two more signing-dependent things: `autoUpdater`/Squirrel.Mac "requires the app to be signed for automatic updates to work at all", and `safeStorage`/keychain prompts misbehave when unsigned (Electron code-signing tutorial). Set `CSC_IDENTITY_AUTO_DISCOVERY=false` in CI to produce deliberately unsigned mac builds without electron-builder failing on a missing identity.

Windows: Electron's tutorial is blunt: since June 2023 Microsoft requires code-signing certificates to live on hardware (FIPS 140-2 HSM/token), file-based OV certificates "no longer provide benefits: Windows will treat your app as completely unsigned", and the cheapest route that "gets rid of SmartScreen warnings" is Azure Artifact Signing (formerly Trusted Signing), which electron-builder supports natively (`win.azureSignOptions` in v26, `win.sign: { type: "azure" }` in v27, env `AZURE_TENANT_ID`/`AZURE_CLIENT_ID`/`AZURE_CLIENT_SECRET`). electron-builder's own Windows page still describes OV (cheap, SmartScreen "unknown publisher" until reputation builds, exportable `.pfx`) vs EV (immediate reputation, hardware-bound, `hsm`/`pkcs11` methods) and says both work with auto-update, so the two docs disagree on whether OV still helps; treat OV as "signed but still warned". Azure Artifact Signing eligibility (https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart): Public Trust is available to organizations in the US, Canada, EU, UK, Australia, NZ, Japan, South Korea, Singapore, Switzerland, Norway and Israel; **individual developers must be located in the US or Canada** (identity is pulled from the Azure billing account, which must be of type Individual). It is sold as Basic and Premium SKUs; the pricing page is JavaScript-rendered and I could not read the numbers (§11). Unsigned Windows behaviour: SmartScreen "Windows protected your PC" → "More info" → "Run anyway" on the installer and the portable exe; browsers may also flag the download as uncommon. Note electron-updater still works for unsigned Windows apps (its signature check only runs when the installed app is signed).

**Recommendation for v1: ship unsigned on Windows and Linux; on macOS sign + notarize if the $99 membership is acceptable, otherwise ship unsigned with the "Open Anyway" instructions on the release page.** The audience already runs an unsigned launcher and a third-party client, and the README can carry the three-step Gatekeeper/SmartScreen instructions; the mac membership is the first thing worth paying for because it also unlocks auto-update on macOS. Revisit Windows signing when an organization identity exists (Azure route) or download counts justify a token.

## 6. Auto-update with electron-updater + GitHub Releases

Mechanics (https://www.electron.build/docs/features/auto-update, /docs/publish): `electron-updater` differs from Electron's built-in `autoUpdater` in supporting Linux, checking code signatures on Windows as well as macOS, generating all metadata itself, and offering download progress and staged rollouts; auto-updatable targets are DMG (macOS; the `zip` target is what is actually downloaded, and `latest-mac.yml` cannot be created without it), NSIS (Windows; Squirrel.Windows is not supported) and AppImage/DEB/RPM/pacman (Linux). electron-builder writes `latest.yml`/`latest-mac.yml`/`latest-linux.yml` plus `.blockmap` files into the GitHub release when `publish` is configured and the build runs with `--publish always|onTag` and a `GH_TOKEN`. Public repositories need no token on the player's machine; the private-repo mode (`GH_TOKEN` on the user machine) is explicitly "only for very special cases" and rate-limited (3 API calls per check against the 5,000/hour limit). `releaseType: draft` publishes drafts that you promote by hand after checking the artefacts.

**Verified constraint: on macOS auto-update only works for a signed (and, on current macOS, notarized) app**, because electron-updater's macOS path hands the downloaded zip to Squirrel.Mac and Electron's docs state Squirrel.Mac "requires the app to be signed for automatic updates to work at all". Windows NSIS and Linux AppImage updates work unsigned.

Code shape (main process, ~15 lines):

```js
import electronUpdater from 'electron-updater';            // CJS package, default-import it from ESM
const { autoUpdater } = electronUpdater;
autoUpdater.autoDownload = false;                          // ask first; players are mid-session
autoUpdater.on('update-available', async (info) => { const { response } = await dialog.showMessageBox(win, { message: `Gear Vault ${info.version} is available`, buttons: ['Download', 'Later'] }); if (response === 0) autoUpdater.downloadUpdate(); });
autoUpdater.on('update-downloaded', async () => { const { response } = await dialog.showMessageBox(win, { message: 'Restart to install?', buttons: ['Restart', 'Later'] }); if (response === 0) autoUpdater.quitAndInstall(); });
autoUpdater.on('error', (e) => log.warn('updater', e));
if (app.isPackaged) autoUpdater.checkForUpdates();
```

Because `electron-updater` is the only runtime dependency this app would have, a zero-dependency alternative for v1 is a manual check: `fetch('https://api.github.com/repos/<owner>/<repo>/releases/latest')`, compare `tag_name` with `app.getVersion()`, and show "Download" → `shell.openExternal(html_url)`. It works identically on every platform, unsigned or not, and needs no `latest*.yml`. **Recommendation: v1 = manual check; switch to electron-updater once the mac build is signed** (the builder config can already publish the yml files, so the switch is code-only).

## 7. CI: GitHub Actions matrix on tag

electron-builder's own guide (https://www.electron.build/docs/features/github-actions) is the template: a matrix over `macos-latest`, `windows-latest`, `ubuntu-latest`, `npm ci`, `npx electron-builder --publish always` with `GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}`, signing secrets as env vars, and an `actions/cache` step for `~/.cache/electron` + `~/.cache/electron-builder`. Current runner labels (https://github.com/actions/runner-images): `macos-latest` = macOS 26 arm64 (Intel via `macos-latest-large`/`macos-26-intel`; an arm64 runner cross-builds the x64 mac target fine since there is nothing native), `windows-latest` = Windows Server 2025, `ubuntu-latest` = Ubuntu 24.04. Cross-building is not needed: each OS builds its own targets (AppImage "must be built on Linux (or via Docker)"; Windows can be built on Linux with the `builder:wine` image but the matrix makes that unnecessary).

```yaml
name: release
on: { push: { tags: ['v*'] } }
permissions: { contents: write }
jobs:
  build:
    strategy: { matrix: { os: [macos-latest, windows-latest, ubuntu-latest] } }
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 24, cache: npm }
      - uses: actions/cache@v4
        with: { path: "~/.cache/electron\n~/.cache/electron-builder", key: ${{ runner.os }}-electron-${{ hashFiles('package-lock.json') }} }
      - run: npm ci
      - run: ./scripts/test_runner.sh
      - run: node scripts/build-core.mjs
      - run: npx electron-builder --publish always
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          CSC_IDENTITY_AUTO_DISCOVERY: ${{ secrets.MAC_CSC_LINK != '' }}   # unsigned mac build until a cert exists
          CSC_LINK: ${{ secrets.MAC_CSC_LINK }}
          CSC_KEY_PASSWORD: ${{ secrets.MAC_CSC_KEY_PASSWORD }}
          APPLE_ID: ${{ secrets.APPLE_ID }}
          APPLE_APP_SPECIFIC_PASSWORD: ${{ secrets.APPLE_APP_SPECIFIC_PASSWORD }}
          APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
```

With `releaseType: draft` all three jobs upload into the same draft release for the tag (electron-builder finds or creates it); publish it by hand once the mac dmg, the two Windows exes and the AppImage are all attached. Add a `pull_request` job that runs `electron-builder --publish never --dir` on ubuntu only, to catch packaging regressions cheaply. The tag must match `package.json` `version` (electron-builder checks it when publishing).

## 8. App-shell behaviour and keeping the dev path

- **Single instance**: `app.requestSingleInstanceLock()` returns false in the second copy (quit immediately); the first gets `second-instance` (guaranteed after `ready`) and should restore + focus its window (https://www.electronjs.org/docs/latest/api/app#apprequestsingleinstancelockadditionaldata). This also removes the port-collision case where two copies would each start a server.
- **Tray vs window**: a normal window that quits on `window-all-closed` (killing the server child in `will-quit`) is the right default; a tray icon needs a `window-all-closed` listener that does NOT quit and per-platform icon sizes/templates (https://www.electronjs.org/docs/latest/tutorial/tray). The bridge status the page shows is polled from the game side, so nothing needs the app alive in the background. Offer "keep running in the menu bar" later if players ask.
- **Open in the system browser**: a menu item "Open in browser" → `shell.openExternal(serverUrl)`; the same server is reachable from Chrome/Safari for DevTools, printing and tabs, and the fallback also covers a broken BrowserWindow (GPU issues on odd Windows drivers: `app.disableHardwareAcceleration()` behind a setting).
- **Crash and log basics**: write the utility process's `stdout`/`stderr` to `<logs>/server.log` with rotation at ~5 MB; `process.on('uncaughtException')` in main → log + `dialog.showErrorBox` + quit; on the child's `exit` with a non-zero code restart it once, then show an error with a "Show log" button that `shell.showItemInFolder`s the log. `crashReporter.start({ uploadToServer: false })` keeps native minidumps locally under `app.getPath('crashDumps')` without any server (https://www.electronjs.org/docs/latest/api/crash-reporter). electron-log 5.4.4 (Node ≥ 14, defaults to `~/Library/Logs/<app>/main.log`, `%APPDATA%\<app>\logs\main.log`, `~/.config/<app>/logs/main.log`) is the standard choice, but a 30-line logger writing to `app.getPath('logs')` keeps the dependency count at zero; either is fine, pick the dependency only if renderer-side logging or remote transport ever matters.
- **Developer path stays `node app/vault-server.mjs`**: the only server changes are env-driven (`VAULT_PORT=0` semantics, `VAULT_DATA_DIR`, `VAULT_CORE`, the `process.parentPort` message, the CSP header and the Host/Origin check) and all default to today's behaviour. `npm run dev` = `electron electron/main.mjs` against the working tree (the utility process still hot-reloads `vault-lib.mjs` by mtime). `--demo` keeps working because it is an argv flag the shell can pass through (an "Open demo data" menu item).

## 9. Licensing

Electron: MIT (`Copyright (c) Electron contributors / 2013-2020 GitHub Inc.`, https://github.com/electron/electron/blob/main/LICENSE). Node.js core: MIT (`Copyright Node.js contributors`), with the bundled dependencies' licences (OpenSSL, ICU, zlib, npm, etc.) enumerated in the same file (https://github.com/nodejs/node/blob/main/LICENSE). Chromium: BSD-3 plus third-party notices, shipped as `LICENSES.chromium.html`. electron-builder and electron-updater: MIT (`Copyright (c) 2015 Loopline Systems`). chokidar and electron-log: MIT; IBM Plex: SIL OFL 1.1 (bundle `OFL.txt` next to the woff2 files). Obligation: ship the licence texts. The Electron release zip carries `LICENSE` and `LICENSES.chromium.html` at the app root and electron-builder keeps them (26.16.1's changelog even contains "Retain Electron and Chromium license files on macOS"), so add our own `LICENSE` and an About → "Open-source licences" item that opens `LICENSES.chromium.html` from `process.resourcesPath`'s parent. No copyleft anywhere in the stack; publishing the Gear Vault itself under MIT is consistent with everything it bundles.

## 10. Risks

1. **Renaming the data root breaks the maintainer's own workflow** unless `VAULT_DATA_DIR` can point at the original private workspace's `exports` (do that: setting + env var, default `userData`).
2. **Scripts hard-code paths into the original private workspace**; until `vault-paths.json` support lands in both `.py` files, players' scans go to a folder the app does not read. Ship the path-aware scripts in the same release as the app.
3. **worker_threads + asar**: undocumented; mitigated by `asarUnpack: ["app/**"]`, but verify the first packaged build actually completes an exact search on 8 workers on both OSes.
4. **`onlyLoadAppFromAsar` fuse vs unpacked app files**: standard combination, verify once.
5. **Inline scripts vs CSP**: externalising the page's script block is a real edit of `gear-vault.html`; do it before adding the header or the page goes blank.
6. **Unsigned mac builds**: half the players will hit "damaged"; the release notes must carry the Open-Anyway/`xattr` steps, and auto-update cannot work there until signed.
7. **electron-builder version churn**: v27 alpha renames keys and the public docs already show v27 syntax; pin 26.16.1 and read the v26 config names from the typed schema (`node_modules/app-builder-lib/scheme.json`) when a doc example does not match.
8. **Electron support window is three majors (~1 year)**; plan a dependency bump every ~4 months, which the CI matrix makes cheap.
9. **Localhost server exposure**: a second local user on the same machine can reach the port; acceptable for a game tool, but the Host/Origin check must be in before `/api/bridge` ships publicly.
10. **Download size** (~100-135 MB per platform) is normal for Electron but worth stating on the release page next to the "why not a web page" answer (it needs the file system and worker threads).

## 11. What I could not verify

- Whether Electron's asar `fs` patch applies inside `worker_threads` spawned from a utility process (no documentation either way; issue #22446 is stale). Mitigated by `asarUnpack`.
- Whether electron-builder 26 ad-hoc-signs mac builds when no identity is present, or leaves the Electron ad-hoc signature intact; either way an unsigned build launches on arm64 only after the quarantine attribute is cleared.
- Azure Artifact Signing prices (the pricing page is client-rendered; commonly quoted figures are Basic ≈ $9.99/month and Premium ≈ $99.99/month, unconfirmed here). Eligibility (individuals US/Canada only) IS confirmed from the quickstart page.
- TazUO's Windows default folder: the install page only says "download the launcher, run it", so detection must stay heuristic + dialog; the `<root>/TazUO/LegionScripts` layout is verified on macOS only. Also unverified whether Legion's Python exposes `__file__` (needed to find `vault-paths.json` next to the script); fallback is `API.RootPath()` or a fixed `LegionScripts` path passed by the app.
- Exact built artefact sizes: figures above are Electron's own release zip sizes for 44.3.0 (darwin-arm64 123.8 MB, darwin-x64 127.9 MB, win32-x64 150.8 MB, win32-arm64 149.0 MB, linux-x64 117.1 MB); installers compress further, measured only once a build exists.
- That electron-updater skips its Windows signature check when the *installed* app is unsigned (my reading of its NSIS updater; not re-read from source this session). If wrong, unsigned Windows builds cannot auto-update, which only matters after v1.
- npm `latest` for electron-builder (26.15.3) lags the `v26` tag (26.16.1); I did not check whether that is deliberate (a regression in 26.16.x) or just a stale tag. Read the 26.16.x changelog before pinning.

## 12. Decision summary

Electron 44.3.0 (Node 24.20), ESM main process, `optimizer-core.ts` precompiled with `node:module`'s `stripTypeScriptTypes` into `app/dist/optimizer-core.mjs`; the unchanged `vault-server.mjs` runs as a `utilityProcess` on a free port with `VAULT_DATA_DIR` = `userData`, the page loads over loopback in a sandboxed, isolation-on BrowserWindow with a CSP header and Host/Origin checks; `fs.watch` + debounce + parse-retry on the scans dir with the scanner switched to write-then-rename and an SSE `inventory-changed` event; first run detects or asks for the TazUO folder and copies the two scripts plus `vault-paths.json`; electron-builder 26.16.1 → dmg+zip (x64 + arm64), nsis + portable (x64), AppImage (x64), asar with `app/**` unpacked, fuses on; unsigned Windows/Linux for v1, mac signed + notarized if the $99 membership is bought; manual update check for v1, `electron-updater` 6.8.9 once mac is signed; GitHub Actions matrix on `v*` tags publishing draft releases; single-instance lock, normal window, "Open in browser" fallback, local crash dumps and rotating logs; MIT throughout with licence files shipped.
