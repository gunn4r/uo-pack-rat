# Gear Vault → a public desktop app: design and release plan

Status: decisions settled Sep 13 2026 (§13); antagonistic self-review applied the same day (stale Phase 6, mac-signing contradiction, token-in-URL, move-vs-copy on import, shard/account provenance, missing tests and risks, workspace isolation); awaiting the maintainer's word before the implementation plan is written. Written from three research passes done the same night — the client ecosystem survey (`docs/research/2026-09-12-uo-client-ecosystem.md`), the Electron packaging study (`docs/research/2026-09-12-electron-packaging.md`), the public-release code audit (`docs/research/2026-09-12-public-release-audit.md`, with the first auditor's reconstruction staged separately) — and the scale benchmark (`app/bench/REPORT.md`). Nothing in this document has been built. It is the spec the implementation plan will be written from once approved.

## 0. Workspace strategy: nothing here changes

The current workspace (the original private workspace) is the maintainer's working setup — the live Gear Vault, their scans, profiles, runs, planning documents and the TazUO scripts they press Play on every day. It is **frozen as-is and never modified by this project**. The new app is built in a **new folder, `~/r/pack-rat/`, initialised as a fresh git repository**, into which only what is needed is *copied*: `app/` (minus `data/`, `bench/results/`, the two legacy pages), `scripts/optimizer-core.ts` and its test, `scripts-legion/vault-scanner.py`, `vault-refresh-claude.py` and `vault-bridge.py` (as the seeds of `adapters/tazuo/`), `scripts/test_runner.sh` and `TESTING.md` (as seeds), the four research documents and this plan (under `docs/`, scrubbed of personal paths before the repo goes public), and a copy of the real scans into a git-ignored `local/` folder for development only. The very first commit is that untouched copy, so every later change is a reviewable diff.

Two consequences follow. **Adapter scripts get new filenames** (`packrat-scanner.py`, `packrat-refresh.py`, `packrat-bridge.py`) so they can sit in the same `LegionScripts/` folder as the live `vault-*.py` without ever overwriting a script that may be running — the orphan-thread trap stays impossible by construction. **The old app keeps running from the old folder** until a cut-over criterion is met: the new app imports the maintainer's real scans (copy, never move), reproduces one saved build for each character to the decimal, and has been used for a full session; only then does their daily use switch, and the old folder stays on disk regardless. Bug fixes discovered during the port are made in the new repo; the old workspace is not patched unless he asks.

## 1. What we are shipping, in one paragraph

A free, open-source desktop app for Ultima Online players that knows every item they own across every character and container, shows them where each piece is, and builds the best suit their inventory allows for any set of goals — then helps them go get it. It reads the game through small "adapter" scripts that run inside the player's own client (TazUO first, Razor Enhanced next, a paste-in path for the ClassicUO web client), never touches the network protocol, never automates play, and keeps all data on the player's machine. Windows and macOS installers, Linux as a courtesy build.

## 2. Name

"Ultima" is EA's mark and stays out of the name. The community's "UO" prefix (UOSteam, UOAssist, UOFiddler) is safe by convention. All four candidates below have no existing UO project on GitHub (checked Sep 12 2026); each collides only with unrelated repos, which any real word does.

| Candidate | Case for it | Case against |
|---|---|---|
| **The supply-officer name** (chosen at the time as "UO" + that name, repo `uo-` + that name) | The person who kits out the whole company — exactly the job: every character, every chest, "build me a suit." Reads as a serious tool. | Collided, unnoticed at the time, with existing UO Alive community tools carrying the same name — this is why the project carries a different name today (Phase 4.5). |
| Kitbag | Short, warm, unclaimed in gaming. | Undersells the suit builder; sounds like a small utility. |
| Paperdoll | UO's own word for the equipment window; instant recognition. | Also the name of a common technique in sprite and ML projects, so search results will be muddy. |
| Outfitter | Accurate. | Crowded by fashion-AI repos with thousands of stars. |

Decision (Sep 13 2026): the supply-officer name above — repo `uo-` + that name, tagline "Every item you own, every suit you could wear." "Gear Vault" may survive as the name of the inventory component inside the app. (Superseded Sep 17 2026: the project is now **Pack Rat** — see Phase 4.5 in §12 for why.)

## 3. Product boundaries (what it is not)

- **Attended-only, inventory-only.** The scanner reads what your character can already see; the bridge moves one item at a time when you press a button while sitting at the keyboard. No farming, no combat, no unattended loops. The README says this, the first-run screen says this, and the bridge executes only commands that a click in the app queued, one at a time, stopping at the first failure — it has no loop of its own to leave running.
- **No bot clients.** Stealth is deliberately never an adapter, and the adapter guide says why: shipping one would put every user of the app on the wrong side of most shards' rules.
- **Shard rules respected, not enforced by us.** Outlands forbids programmatic data extraction; the app ships no Outlands adapter and the shard picker says "manual import only" for it. UO Alive distributes Razor Enhanced and enables ClassicUO web scripting, so those are first-class there.
- **No telemetry, no accounts, no cloud.** Crash dumps stay on disk. The only outbound request is an optional "check for updates" against the GitHub releases API, off until the user turns it on.

## 4. Architecture

### 4.1 The shell

Electron **44.3** (Node 24.20) with **electron-builder 26.16**. The existing `vault-server.mjs` runs unchanged as a **`utilityProcess`** child of the main process, listening on `127.0.0.1` port **0** (OS-assigned) and posting the real port back over `process.parentPort`; the `BrowserWindow` loads `http://127.0.0.1:<port>` with `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, no preload. The page needs no changes *for the shell* — every URL it uses is relative (the page split in §8 is for the CSP and for maintainability, not for Electron). Why a utility process and not the main process: a server crash or a runaway 8-worker build cannot take the window down, and `worker_threads` + `SharedArrayBuffer` are plain Node inside it. Why not `file://` + IPC: it would mean rewriting every `fetch` and `EventSource` in the page for no gain.

The optimizer core is **precompiled once** at build time (`node:module`'s `stripTypeScriptTypes`) into `app/dist/optimizer-core.mjs` and imported as a real module. The four copies of the "append an export line, write a temp file, import by URL" trick (server, two test files, bench) are deleted. Developers still run `node app/vault-server.mjs` directly; everything the shell does is env-driven (`VAULT_PORT`, `VAULT_DATA`, `VAULT_CORE`), so the bare server keeps working without Electron.

### 4.2 Data on disk

One data directory, resolved once: `--data <dir>` → `VAULT_DATA` env → `app.getPath('userData')/pack-rat` under Electron → `~/.pack-rat` for the bare server. Layout: `inbox/<adapter>/` (watched drop folders, one per adapter), `scans/` (accepted, normalised scan files, RFC 3339 named), `runs/`, `bridge/<adapter>/` (queue + status), `profiles.json`, `settings.json`, `rules/` (user-added shard rule files), `logs/`. An existing `exports/scans` layout (the maintainer's, or any pre-1.0 user's) is offered as a one-time import on first run ("I found 17 scans in an older layout — import them?") that **copies** the files; the originals are never moved or touched.

### 4.3 First run

A four-step wizard, skippable, re-openable from Settings: (1) pick your shard (UO Alive default; "Other / generic OSI rules"; Outlands shows the manual-import note); (2) pick your client — the adapter list with a one-line capability summary each; (3) locate the client: TazUO has no fixed install path, so the app tries the usual places (Desktop, Downloads, Documents, `%LOCALAPPDATA%`, `C:\TazUO`, `~/Desktop/TazUO`) and validates `<root>/TazUO/LegionScripts/` exists, else a folder dialog; (4) install the adapter scripts into that folder together with a `packrat-paths.json` they read, and tell the user exactly what to press in-game. The wizard ends on an empty-state Inventory tab that says "Run the scan in-game; this page updates itself when the file lands."

### 4.4 Folder watcher

`fs.watch` on each `inbox/<adapter>/` with a 300 ms debounce and parse-retry (a file that fails to parse is retried three times over two seconds, then quarantined to `inbox/<adapter>/rejected/` with the reason in the log and a toast). Adapters write **temp-then-rename** so the watcher never reads a half-written file; the scanner script changes to `os.replace` for this. Accepted files are validated against the scan schema, normalised (timestamps to RFC 3339 with offset, serials to numbers) and moved to `scans/`. The fold result is cached in the server and invalidated by the watcher, which also ends the "fold on every request" behaviour for free. Zero dependencies; chokidar only if `fs.watch` proves unreliable on a real Windows machine (it is known to miss events on network drives, which we do not support).

### 4.5 Security posture for a localhost server

Loopback bind already; add: a per-launch random token the server requires on every `/api/*` route, which the shell attaches as an `Authorization` header to every request to that origin through `session.webRequest.onBeforeSendHeaders` — so the token never appears in a URL, history or log, and the page contains no token code at all (the bare developer server runs without a token, loopback-only, with the Origin/Host checks still on); `Host` and `Origin` checks so a web page open in the same browser cannot drive `/api/bridge` (which moves items in the game) or `/api/forget`; `Content-Type: application/json` required on writes; a size cap and schema validation on `PUT /api/profiles`; a cap of one running optimize job per client (a second request cancels the first); no stack traces in 500 responses; a CSP header once the page's inline script is externalised. The token is the one that matters — with it, the rest are belt and braces.

## 5. Adapters: one contract, many clients

### 5.1 The scan contract (schema version 2)

The scan file is the API. A JSON Schema at `app/schema/scan.v2.schema.json`, validated on ingest; version 1 files (today's) are upgraded on read. Changes from v1: a top-level `schemaVersion`; an `adapter` block `{id, version, client, clientVersion, capabilities: {layers: [...], arms: bool, bank: bool, ground: bool, nested: bool, tooltips: "opl" | "label", bridge: [actions]}}` so the app knows an arms-blind scan is arms-blind rather than empty and can grey out what the adapter cannot do; `shard` (string id) so two shards' serials never collide in one inventory — stamped by the app at ingest from the wizard's shard pick when the adapter cannot read the connected server (TazUO's API is not known to expose it), and overridable per inbox folder; `scannedAt` as RFC 3339 with offset (the local-time-vs-UTC fold-order bug is real and fixed here); serials always numbers; `roots[].opened` so an unopened root is distinguishable from an empty one; per-item `nameSource`; an optional hashed account id for multi-account users, present only when the host exposes the account name (none is known to; the field exists so the schema need not change when one does). Everything else stays: raw tooltip lines, the replace-per-root fold rule, the worn set replaced whole.

### 5.2 The bridge protocol (version 1)

Command in: `{id, action, serial, name, chain: [root … parent], pos | null}`; result out: `{id, ok, msg}` plus a status heartbeat. Hosts declare the actions they support in their capabilities block; the page only offers those buttons. Actions for v1: `highlight`, `grab`, `goto`. The wrong-character guard the Grab-all work added stays: the bridge status carries the character name and the page confirms before sending to a different one.

### 5.3 Transports

Three, chosen per adapter: (a) **watched folder** — the adapter writes into `inbox/<adapter>/` (TazUO, Razor Enhanced, ClassicAssist); (b) **HTTP to localhost** — `POST /api/scan`, long-poll `/api/bridge/next`, `POST /api/bridge/result`, with the token, for hosts that can make requests but not write files (Orion, possibly RE); (c) **clipboard / Import tab** — the adapter prints a marked block into the client's script log, the player copies it and pastes it into the app (ClassicUO web, and a "manual" adapter for anyone). The Import tab also accepts a dropped file, which makes every adapter usable without the watcher.

### 5.4 Repo layout and roadmap

`adapters/<id>/` with the script(s), a README (install steps, what to press, limits), `capabilities.json`, and a **fixture scan** — so the fold tests cover each host's quirks (arms missing, bank missing, label-only names). Shipping order, from the survey's ranking: **TazUO** (v1.0, exists), **Razor Enhanced** (v1.1 — inside UO Alive's package, one-to-one API, file writes verified from its source; only wrinkle is that as a CUO plugin its cwd is the CUO folder, so paths resolve from the user's home), **ClassicUO web import** (v1.1, scan-only, paste transport; the existing `scripts/gear-scout.ts` and its OPL gotchas are the starting point; limits stated in the UI), **ClassicAssist** (v1.2, thin shim on a shared Python core once RE is proven), **Orion** (probe first — tooltip reading and file writes unverified), **never Stealth**, everyone else manual import. The shared Python core question (TazUO and RE both run IronPython-family runtimes, but TazUO's exec semantics for `__name__` are still unverified) is settled by the first live run of the quick-refresh script, which records `__name__`.

## 6. Shard rules as data

`app/rules/<shard>.json`, UO Alive shipped as the default and selected in the wizard: shard name, property caps, race caps (Elf energy 75), the Resisting Spells resist-bonus formula (UO Alive-specific), tag units (Antique/Brittle/Prized/Cursed and the custom Massive/Unwieldy), rarity tier names and colours, race-lock policy (UO Alive: only gargoyle gear is race-locked), and the free-skill list for display. What stays in code because it is OSI-standard: the tooltip property patterns, skill and spell names, slot classification regexes, layer map, slayer aliases, medable materials, weapon-skill list. A "generic OSI" rules file with conservative caps covers unknown shards; users can drop their own file into `rules/` and it appears in the picker.

## 7. Scale strategy (from the benchmark and the MIP spike, not from hope)

The measured facts: fold is never the problem (215 ms at 50k items); the browser payload is the first wall (14.6 MB at 20k, 36.5 MB at 50k); the hand-written branch-and-bound proves only up to ~500 items for weight-heavy profiles and ~5k for tight-floor ones, 8 threads buy one step, and an uncapped 20k run extrapolated to years; the heuristic is fast at any size but missed a hard floor on a 500-item inventory; dominance pruning is already as good as it gets; SQLite would change nothing measured.

The spike that changed the answer (`app/bench/REPORT.md`, addendum; `app/bench/mip-spike.mjs`): the suit problem is a multiple-choice knapsack — one item per slot, capped weighted totals (the cap linearizes exactly because min is concave), hard floors as rows, the two-hander rule as one row — and **HiGHS, a MIT-licensed MIP solver compiled to WebAssembly, proves the optimum for 20,000–30,000-item inventories in 1.1–2.5 s on one thread**, matching the core's proven scores to the decimal on every cell the core can prove. The blow-up was our bound, not the problem.

So, in order: (1) **HiGHS becomes the exact solver** — the one runtime dependency the app takes (~2 MB WASM, runs inside the existing worker; the zero-dependency rule bends for a 10⁶× speed-up). Soft floors with partial credit (a binary met indicator plus a partial-credit variable), near-ties (k-best via proper no-good cuts, one re-solve each) and worker-thread execution are already modelled in the spike and match the core to the decimal; 50,000 all-gear items (38,000 candidates) prove in 8.6 s, with time growing linearly in pool size. Left for the implementation: progress reporting through HiGHS's incumbent + gap callback (the anytime story for free) and the MIP start from the heuristic. The core's heuristic stays as the MIP start and as the fallback if the WASM fails to load; its result is never shown as meeting the floors without an explicit check. (2) **Build pools on the server** and ship pools (0.05 KB/item) plus a paged, server-searched inventory table — the payload wall is untouched by the solver change. (3) Dominance pruning and the per-item bound cuts are no longer needed for the search; they may still shrink the LP for very large pools and are measured, not assumed. The MIP spike is kept in `app/bench/` as evidence and as the starting point for the implementation.

## 8. Code changes before the repo goes public

- **Page split.** `gear-vault.html` (1,250 lines, 900 of JS, 76 functions on one `state`) becomes `index.html` + `ui/store.mjs`, `ui/inventory.mjs`, `ui/builder.mjs`, `ui/bridge.mjs`, `ui/import.mjs`, `ui/settings.mjs`, with the inline script externalised (also what the CSP needs). Mechanical, test-covered, half a day; do it first because everything after grows the page.
- **Fixtures regenerated.** `demo-Rowan.json` is real data with real serials, a real character name and a real chest position — the docs calling it synthetic were wrong. Regenerate both fixtures with the bench generator under fictional names, re-derive the tests that assert on specific items.
- **User data out of the tree.** `app/data/profiles.json` and backups, `app/data/runs/`, `app/bench/results/`, `exports/` are all personal; `profiles.default.json` ships with `characters: {}` and the four generic templates, its `_comment` no longer citing a private document.
- **Contracts settled.** `allowOthers` vs `allowOthersWorn`, `budgetS` vs `budgetMs`, the `bag`/`container` vocabulary, four timestamp encodings across bridge files, the undocumented `location` field on `/api/bridge`, no version field on profiles or runs, `/api/inventory` leaking an absolute path.
- **Platform.** A Node launcher replaces the bash script (`pgrep`/`lsof`/`kill -9`/`open` are mac-only and the `pgrep` matched any user's server); `spawn("open")` becomes `shell.openExternal` in the shell and a printed URL in the bare server; the test runner's inline module moves to `scripts/test-runner.mjs` so `npm test` works on Windows; the personal nvm fallback path leaves the launcher and the runner; the two `.sh` files' exec bits survive the first commit via `.gitattributes`.
- **Node floor stated correctly**: unflagged `.ts` import needed 22.18+/24, but with the precompiled core the floor is whatever Electron bundles; `package.json` `engines` says 22.18 for the bare server.
- **Tests on `node:test`** with tags as test names, TAP output, and the budgeted optimizer cases marked slow so CI can skip them on slow runners; `vaulttest-*` temp dirs cleaned up.
- **Hygiene.** The `-claude` suffix goes (no macro references any vault script, so it is a one-line doc change); the two dead legacy pages containing Dorran's data are excluded; duplicate `node:fs` imports; comments citing private context.
- **Legion scripts renamed and made path-configurable** (`packrat-*.py`, reading `packrat-paths.json` next to them, written by the wizard), temp-then-rename writes, and the quick-refresh script's 157 duplicated lines folded into a shared module once `__name__` is known (the first live run of the new refresh script records it).

## 9. Repository

New public repo, MIT license, containing only: `README.md`, `LICENSE`, `CONTRIBUTING.md` (the dev loop, data model and gotchas from `app/CLAUDE.md`, scrubbed), `docs/` (architecture, scan schema, bridge protocol, adapter guide, shard-rules guide, privacy statement), `package.json`, `.gitignore`, `.gitattributes`, `.github/workflows/` (test on push, build on tag), `app/` (server, lib, ui/, dist/, schema/, rules/, fixtures/, tests, bench/ harness without results), `adapters/tazuo/`, `adapters/razor-enhanced/` (v1.1), `adapters/classicuo-web/` (v1.1), `electron/` (main, wizard, watcher, updater), `scripts/`. **Not shipped:** the planning documents, `reference/`, `scripts/*.ts` web-client suite, `exports/`, any `CLAUDE.md`, saved runs, real scans, bench results. This workspace stays private; the public repo is a fresh history, not a filtered clone.

Community scaffolding for launch: issue templates (bug with "attach a scan file — here is what it contains"; adapter request; shard rules request), a code of conduct, a `SECURITY.md` (the localhost token model, what to report), a Discussions board rather than a Discord to start.

## 10. Packaging, signing, updates, CI

- **Targets:** mac `dmg` + `zip` as separate x64 and arm64 downloads (universal doubles the size), Windows `nsis` installer + `portable`, Linux `AppImage`. `asar` on with `app/**` unpacked (worker threads under asar are undocumented). Expect ~125 MB mac, ~150 MB Windows, ~115 MB Linux downloads.
- **Signing.** macOS: Developer ID + notarization needs the $99/yr Apple Developer Program; unsigned means the "damaged" dialog and an `xattr` workaround in the README. Windows: post-2023 file-based certificates are treated as unsigned by SmartScreen anyway; Azure Artifact Signing is the affordable route but individuals must be in the US or Canada. **v1 plan:** sign and notarize mac if the membership is bought (auto-update on mac requires it), ship Windows and Linux unsigned with a SmartScreen note.
- **Updates.** v1: a manual "Check for updates" that reads the GitHub releases API and opens the download page. v1.x: `electron-updater` with the GitHub provider once mac is signed (it works unsigned on Windows NSIS and Linux AppImage).
- **CI.** A matrix of `macos-latest`, `windows-latest`, `ubuntu-latest` running `npm test` on every push, and `electron-builder --publish always` into a draft GitHub Release on a version tag, `CSC_IDENTITY_AUTO_DISCOVERY=false` until a mac certificate exists. Python scripts get `py_compile` in the same run.
- **Versioning:** semver, `CHANGELOG.md`, the scan and bridge schema versions independent of the app version.

## 11. Edge cases and little things — the finish-line list

Data and identity: two shards or two accounts with overlapping serials (the `shard` field and hashed account make the inventory key `shard:serial`); a character renamed by the server at first login (the fold keys by name — add a rename action that merges); the same character on two clients (adapter id in the scan, last write wins per root as today); non-ASCII character names in file names (files are named by timestamp + a slug, the name lives inside); a scan from a character the app has never seen (creates the character; no wizard step needed); "Forget" ordering across time zones (fixed by RFC 3339; a Forget always stamps now); a scan of an opened-but-empty chest clearing it on purpose vs an unopened chest keeping its contents (the `roots[].opened` flag makes the difference visible in the Containers tab); items that appear in two scans from two characters (worn by one, in the other's bank — the newer scan wins, and the UI says "last seen by X at T").

Files and processes: a scan file still being written when the watcher fires (temp-then-rename in adapters, parse-retry in the app); a rejected file (quarantined, never silently dropped); the inbox on a OneDrive-redirected Desktop on Windows (works, but slow sync can delay the event — document it); the app already running (single-instance lock focuses the window); port 0 avoids collisions entirely; the server child dying (the shell restarts it once and shows the log path on a second failure); a 20k-item hoard on a slow laptop (pools server-side, table paged, search anytime); the user closing the window mid-build (the pagehide beacon already cancels the job; the shell also kills the child on quit); data directory on a full disk (writes are temp-then-rename and errors surface as toasts, never as silent loss).

Client integration: TazUO installed somewhere odd or on another drive (the dialog); TazUO updated and its `LegionScripts` folder changed (the wizard's "reinstall scripts" button; the installed script carries its version in a header line the app can read); **the adapter script being overwritten while the game runs it** (the orphan-thread trap this project hit twice — the installer writes `vault-scanner.py.new` and only renames it into place when the app's bridge status says no script is running, otherwise it asks the user to stop scripts first); TazUO's static rejection of the literal `while True` anywhere in a script, comments included (the adapter test greps for it); TazUO's `import API` must-be-alone-on-its-line rule; Razor Enhanced running as a CUO plugin with the CUO folder as cwd (paths resolved from the home directory in `packrat-paths.json`); IronPython 3.4 (RE) vs TazUO's embedded Python stdlib differences (the shared core uses only `json`, `os`, `time`); the bridge on the wrong character (the confirm already exists); a grab into an overweight backpack (the bridge reports the failure and the queue stops); the `all release`-style public speech in any adapter (adapters never speak; anything public is a bug).

Platform: Apple Silicon vs Intel (two builds); the mac "damaged" dialog for unsigned builds (README with screenshots); Windows SmartScreen (same); antivirus heuristics that dislike Electron plus Python files in a game folder (document; sign when possible); high-DPI and dark mode (the page already has theme tokens; the shell follows the OS); no internet on the game machine (fonts bundled — IBM Plex is OFL — and no CDN loads); Linux without a desktop notification daemon (toasts stay in-app).

Upgrade and migration: profiles and runs gain `schemaVersion` and migrate on read (the archetype→template migration is the pattern); the current private layout imports on first run; a downgrade after a schema bump refuses the newer file with a clear message rather than corrupting it; uninstall leaves the data directory and says so; an "Export my data" button zips the data directory for bug reports, with a checkbox to strip other players' names from "Crafted By" lines.

Privacy: the README states plainly what a scan file contains — character name, stats, all skills, world position, house chest coordinates, every serial, full tooltips including "Crafted By <other player>", engravings, full bank contents when open — and that nothing leaves the machine unless the player attaches a file to a bug report. Crash dumps are local. There is no analytics of any kind.

Community and rules: the AFK-rules banner on first run quotes UO Alive's rule verbatim; the adapter guide states which shards ban which tools (Outlands' list is explicit) and that we ship no Stealth adapter on principle; contributions of an adapter for a client a shard bans are declined with a link to that policy.

## 11b. Testing strategy

Four layers, all runnable with `npm test` on the three CI platforms. (1) **Unit**: the existing parser/classifier/fold/pool tests on `node:test`, against regenerated synthetic fixtures. (2) **Contract**: every adapter ships a fixture scan and the fold tests run over all of them, so an arms-blind or bank-less host's quirks are covered by construction; the scan and bridge JSON Schemas are tested with valid and invalid documents, and a v1 scan file is tested to upgrade to v2. (3) **Solver equivalence**: the spike's method becomes permanent — on every fixture and profile the HiGHS result is re-scored by the core's `scoreSet` and must equal the core's proven optimum where the core proves within a budget, including soft-floor and k-best cases; the heuristic's result is checked for floor status. (4) **Shell smoke**: Playwright's Electron support launches the packaged app on each platform in CI, walks the wizard with a fake TazUO folder, drops a fixture scan into the inbox and asserts the inventory renders. Slow cases (budgeted proofs) are tagged and skipped on slow runners.

## 11c. Risks

| Risk | Likelihood | What we do |
|---|---|---|
| HiGHS WASM is slow or memory-hungry on a low-end laptop with a huge hoard | medium | the 50k all-gear cell is 8.6 s on a laptop; keep the heuristic as fallback and show the gap; cap pool size with a warning above ~50k candidates |
| `fs.watch` misses events on Windows (OneDrive, antivirus) | medium | parse-retry + a manual "Rescan inbox" button + the Import tab; chokidar if a real machine proves it |
| Unsigned builds scare users off at first launch | high | screenshots of the exact dialogs in the README and on the download page; buy the Apple membership when downloads justify it |
| TazUO's Legion API changes under us (the stub was already ahead of the binary once) | medium | adapter scripts pin the API calls they use in a header, log the client version into `meta`, and the app shows "adapter untested with this client version" rather than failing silently |
| IronPython 3.4 (RE) vs TazUO's embedded Python differ in stdlib | low | the shared core uses only `json`, `os`, `time`; a `py_compile` per host in CI |
| Cut-over breaks the maintainer's daily workflow | low | §0: the old app keeps running; the criterion is reproduced builds, not a date |
| Scope creep from adapter requests | high | the adapter guide sets the bar (fixture + README + capabilities); requests are Discussions, not issues, until someone brings a fixture |

## 12. Phases and rough effort

| Phase | Work | Effort |
|---|---|---|
| −1 | New folder `~/r/pack-rat/`, `git init`, copy the needed files untouched, first commit; git-ignored `local/` with a copy of the real scans for development | ½ day |
| 0 | Repo hygiene: paths/config resolver, data directory, user data out, fixtures regenerated, contracts settled, Node launcher, test runner in Node, `package.json`, license, `.gitignore`; adapter scripts renamed `packrat-*.py` | 1–2 days |
| 1 | Page split into modules, core precompiled and made a real module, loaders deleted, tests on `node:test` | 1 day |
| 2 | Scan schema v2 + validator + v1 upgrade, bridge protocol v1, `adapters/tazuo/` with fixture, shard rules file + picker, security (header token, Origin/Host, content-type, caps) | 2 days |
| 3 | Solver: HiGHS as the exact solver in the worker (LP builder from the spike, soft floors, k-best, progress via incumbent + gap, MIP start from the heuristic, fallback), solver-equivalence tests; server-side pools and the paged, server-searched inventory table | 2 days |
| 4 | Electron shell: utility-process server, window, single instance, data dir, watcher, first-run wizard, script installer with the running-script guard, manual update check, logs | 2–3 days |
| 4.5 | Rename to Pack Rat: the original chosen name collided with existing UO Alive community tools of the same name, discovered after Phase 4 shipped. Renamed the package, product name, window title, data directory, Electron service name, GitHub user-agent string, and the TazUO adapter scripts and their config file, across code, tests, schema `$comment`s and docs | ½ day |
| 5 | Packaging and CI: electron-builder targets, GitHub Actions matrix, Playwright Electron smoke, release checklist, README with the unsigned-build screenshots, privacy statement, community files | 1–2 days |
| 6 | Adapters: Razor Enhanced (scanner + bridge), ClassicUO web import (scan-only, paste), Import tab | 2–3 days |
| 7 | Security review: a full, adversarial pass over the localhost server and its token, the scan and bridge parsers against hostile input, the script installer's path handling, the Electron shell's hardening, the adapter scripts' posture inside a game client, the release and CI supply chain, and the privacy claims against what the code does. Findings triaged, fixed, and the threat model written down. | 2–3 days |
| 8 | TypeScript migration: the app, the shell and the scripts move from plain JavaScript to TypeScript, incrementally, with the test suite green at every step and no behaviour change. The optimizer core is already TypeScript and compiled; this extends that to the rest. | 3–5 days |

Phases 7 and 8 were added on Sep 18 2026, after Phase 6 merged and the repository went public: the first because a locally-hosted app that reads files a game client writes deserves an adversarial look before anyone is asked to trust it, the second because the codebase is large enough now that a type checker earns its keep. Both are stubs — see their plans in `docs/superpowers/plans/` — and neither has started.

Roughly three to four working weeks of focused effort to an unsigned 1.0 with TazUO and the HiGHS solver, then RE and the web import as 1.1. Phases −1 to 2 are prerequisites for everything; 3 and 4 can run in parallel once 2 is done; 6 ships after 1.0. The solver moved into 1.0 because the spike removed its risk and the people asking for the app are the ones with the big hoards.

## 13. Decisions (settled Sep 13 2026)

1. **Name (Sep 13 2026, superseded Sep 17 2026 — see Phase 4.5 in §12): the original supply-officer name** — repo `uo-` + that name, product and window title "UO" + that name. The `UO-` prefix namespaces it beside UOSteam / UOAssist / UOFiddler. The project is now **Pack Rat**, repo `pack-rat`, product and window title "Pack Rat".
2. **License: MIT**, under the maintainer's personal GitHub account.
3. **Apple Developer membership: not for 1.0.** Mac builds ship unsigned: the README carries the Gatekeeper "damaged" walkthrough (right-click → Open, or `xattr -dr com.apple.quarantine`), and mac auto-update is off (Squirrel.Mac requires a signed app). Signing is a build-time flag, so buying the membership later adds it to the next release with no code change.
4. **Windows: unsigned for 1.0**, SmartScreen note in the README. Both platforms therefore share the same first-launch friction.
5. **Linux: courtesy AppImage**, no support promise.
6. **Support: GitHub Discussions.**
7. **The bare `node app/vault-server.mjs` developer path stays supported** — it is what CI tests.

## 14. Definition of done for 1.0

A player on a clean Windows 11 or macOS machine with TazUO installed downloads one file, runs it, follows a four-step wizard, presses Play on the scan script in-game, and sees their inventory in the app within seconds without editing any file or path; builds a suit for a character with the default UO Alive rules; highlights and grabs a piece through the bridge; and can read, before any of that, exactly what data the app collects and where it lives. The test suite passes on all three CI platforms; no personal data of the author's is in the repository; the scan and bridge formats are documented well enough that a third party could write an adapter without reading our code; and the §0 cut-over criterion holds — the maintainer's real scans import by copy and one saved build per character reproduces to the decimal — while the original private workspace is byte-for-byte what it was.
