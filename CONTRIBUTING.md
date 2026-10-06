# Contributing to Pack Rat

How to work on Pack Rat: setup, the conventions every change keeps, and where everything else is written down. Start with `docs/module-map.md` (where each module and concept lives) and `docs/change-checklists.md` (everything else to change for each kind of change, which the pull request template asks you to walk).

## Running from source

Requirements: Node 24 or later (`engines.node` is `>=24`) and npm.

```
git clone https://github.com/gunn4r/uo-pack-rat.git
cd uo-pack-rat
npm ci
npm run desktop            # the Electron app
npm start -- --open        # the bare server, opened in your browser
npm start -- --demo        # the bare server on the bundled fixture scans
npm test                   # full suite (same as ./scripts/test_runner.sh)
npm run test:smoke         # or ./scripts/test_runner.sh --smoke
npm run test:fast          # or ./scripts/test_runner.sh --fast
./scripts/test_runner.sh --changed   # only the test files this branch's changes reach (--changed=<ref> for a base other than origin/main)
npm run typecheck
npm run dist               # installers for this OS into dist/
npm run dist:dir           # an unpacked app into dist/, no installer
```

`scripts/test_runner.sh` only forwards its arguments to `node scripts/test-runner.mts`, which understands `--smoke`, `--fast` and `--changed[=<ref>]` (no flag = full). Results land in `test_logs/latest_summary.json`: read that, not the console output. `TESTING.md` has the tags, how the runner picks and counts tests, and what each test file covers.

## Run / dev loop

- `npm start -- --open` serves the app on the configured port and opens the browser; `--demo` serves the bundled fixtures in `app/fixtures/` instead of your own scans. `--data <dir>` points at a different data directory (default `~/.pack-rat`, or `PACKRAT_DATA`); `--port <n>` picks a different port (default 8765, or `PACKRAT_PORT`, `0` for an OS-assigned port); `--token <t>` (or `PACKRAT_TOKEN`) requires `Authorization: Bearer <t>` on every `/api/*` request, which the bare page never sends, so it is for testing the header, not for daily local use.
- **Restart the server** (or run it under `node --watch app/vault-server.mts`) after changing `vault-server.mts` or anything it imports, `vault-lib.mts` included. An optimizer core or `optimize-worker.mts` edit applies from the next build, since every build starts a fresh worker.
- **Rebuild the page** with `npm run build:ui` after changing `app/ui/*.mts` or a module the page imports, before a reload picks it up (restarting `npm start` or `npm run desktop` also rebuilds). `app/index.html` and the `app/ui/*.css` stylesheets are served as they are: a reload is enough.
- If your installed game scripts point at a dev folder (their `packrat-paths.json` names, say, a `local/` folder in your clone), start with `npm start -- --data <that folder>`; on the default folder the app reads nothing the scripts write, and says so at startup and in a banner.
- Most feature work only needs the bare server. Reach for `npm run desktop` when the change is in `electron/` or needs what only the shell does (the native folder picker, the per-launch token, the process lifecycle).
- Read real data from the running server with `curl http://localhost:8765/api/inventory` (adjust the port if you changed it).

`docs/architecture.md` ("The dev loop in detail") has the rest: the bare server against the desktop shell, the inbox watcher, the installer's running-script guard, the window's browser gates, both builds, how the optimizer core is loaded, and embedding `startServer()`.

## Conventions

- **Prose.** American spelling; plain words; no hard-wrapped paragraphs (one paragraph is one line, in Markdown, comments, commit bodies and pull request bodies); "container", not "chest", in generic text.
- **Tests.** Every test name starts with a tag (`[smoke]`, `[fast]` or `[slow]`), and every test file opens with a header saying what it covers; `TESTING.md` says how. After adding a test file or changing a header's first sentence, run `npm run gen:test-index`.
- **Docs.** A backticked repo path in any Markdown file must exist (`scripts/docs-links.test.mts`), and a new module gets a row in `docs/module-map.md` in the same change (`scripts/module-map.test.mts`).
- **Commits.** Imperative mood, naming the issue (`(#123)`); no trailers.
- **Dependencies.** No new runtime dependencies without a spec change. `highs` (MIT, compiled to WebAssembly) is the one: `app/mip-solve.mts` loads it to run the exact suit solve (`docs/solver.md`), and `optimize-worker.mts` falls back to the core's own heuristic when it fails to load. Everything else — the server, the page, the adapters — is Node's standard library and plain browser APIs, no npm imports. The built-in MCP server (`app/mcp.mts`) speaks its protocol by hand for the same reason; `@modelcontextprotocol/sdk` is a pinned dev dependency only, for the interop test in `app/mcp.test.mts` that connects the SDK's own client to it.

### Working in TypeScript

Every source and test file the project ships is TypeScript (`.mts`), and a module imports another by its real extension (`import { x } from "./y.mts"`, not `./y.mjs` or extensionless) — `verbatimModuleSyntax` plus `rewriteRelativeImportExtensions` handle rewriting that to the compiled extension wherever a compile step is actually involved. Node (the `engines.node` floor, 24) and Electron run `.mts` files directly through native TypeScript type stripping, so there is **no build step** for the server, the tests, the worker threads, or the Electron main/utility processes — edit a file and rerun it. Type stripping only erases type syntax, it doesn't transform anything, so `tsconfig.json` sets `erasableSyntaxOnly`: no `enum`, no `namespace`, no parameter properties. The compiler refuses any of those at typecheck time, since they'd otherwise fail at run time the moment Node actually strips and runs the file.

The **one** compile step anywhere in the project is the page, because a browser can't strip types itself: `npm run build:ui` (`scripts/build-ui.mts`, `tsc -p tsconfig.browser.json`) turns `app/ui/**` and the shared modules it imports into `app/dist/`. The `predesktop`, `predist` and `predist:dir` npm hooks, `scripts/start.mts`, `scripts/test-runner.mts`, `app/server.test.mts`, and (in development) `electron/main.mts` all call it for you.

`npm run typecheck` (`tsc -p tsconfig.json`, no emit) is what CI enforces on macOS, Windows and Linux, and it checks the whole project, build step or not.

`tsconfig.json` turns on `noUnusedLocals` and `noUnusedParameters`, so an unused import, local or parameter fails the typecheck, and `scripts/layering.test.mts` enforces the import layering: nothing outside `app/ui/` imports from it, the browser-shared modules (`tsconfig.browser.json`'s `include`) reach no `node:` module, modules outside `app/ui/` have no import cycles, and every module the page imports from outside `app/ui/` has its own static route in `app/http/routes/static.mts` and reaches no `node:` module; `app/store/` and `app/services/` import nothing from `app/http/`, and only `electron/`, `scripts/` and the test fixtures import `app/vault-server.mts`. `docs/ui.md` has the page's own import rules.

`app/schema/types.d.mts` is **generated** from the five JSON Schema files by `npm run build:types` (`scripts/build-schema-types.mts`). The schemas remain the authority — a shape change is made there, never by hand-editing the generated file, which is git-ignored and simply overwritten on the next build.

A type describes a shape; it proves nothing about data that crossed a boundary the compiler never watched. Anything read from a scan file, a pasted document, an adapter, or an HTTP request body starts as `unknown` and stays that way until a runtime check has actually run against it — a document only earns the `ScanV2` type once `validateScan()` has passed, the way `app/import.mts` and `app/watcher.mts` do it (and the way `scripts/make-adapter-fixture.mts` learned to do it too, after shipping without the check — see `CHANGELOG.md`). Runtime validation is never deleted just because a type now describes the same shape it checks; the type and the check are two different guarantees, and only one of them runs against real data.

### Rules to keep when changing the security mechanics

`docs/threat-model.md` is the reasoning (the processes, each trust boundary, which defence is load-bearing against which attack, and the findings deliberately left standing), and `docs/architecture.md`'s "The server's request checks" is the mechanics; read both before changing any of them. These are the invariants the phase-7 review turned into commitments. Breaking one is a review comment, not a style note.

- **Every route validates a JSON-object body field by field.** New route, new validation: call `asObject()`, then check each field you read for type, and for length or range where one applies. Return the reason you refused. A `as Record<string, unknown>` destructure with no checks behind it is how a whole family of 500s and a disk-fill primitive got in last time.
- **No HTML sinks in the UI. DOM nodes only.** `el()` has no `html` path, and `innerHTML`, `outerHTML`, `insertAdjacentHTML` and `document.write` appear nowhere in `app/ui/`. Keep it that way: everything reaching the page from a scan file — item names, engravings, tooltip lines, character names — is a stranger's text. A dynamic attribute value must be regex-constrained (the tooltip colour is the only one, and it must match a strict hex pattern).
- **Every write into a player-chosen folder goes through the atomic helper.** `atomicReplace` (`app/atomic-write.mts`, with its `writeFileAtomic` wrapper and `app/installer.mts`'s `copyFileAtomic`) is the one way to write there: a random `O_EXCL` temp name, an `lstat` refusal of any destination that is not absent or a plain regular file, a rename, and cleanup on failure. A bare `writeFileSync`/`copyFileSync` at a fixed, published name follows whatever symlink is sitting at it.
- **Adapters treat the queue as hostile.** `<data>/bridge/<adapter>/queue.jsonl` drives a real character in a live game and can be written without the server's involvement, so an adapter re-checks every line itself — freshness, duplicate ids, rate, chain length, container-ness, walk distance, grab source — rather than trusting that the server validated it. Server-side validation is real but it is not the boundary. Keep the grab destination hard-coded to the player's own backpack and out of the protocol.
- **Actions are pinned by SHA.** Every `uses:` in `.github/workflows/*.yml` names a full 40-character commit SHA with the tag in a trailing comment. A `@v4` is a mutable pointer; see `RELEASING.md` for how to resolve a SHA and why the trailing comment matters to Dependabot.
- **A new schema keyword must be enforced by the validator AND known to the types generator.** `app/schema/validate.mts` implements a deliberate subset and silently ignores anything outside it, so a bound written into a schema file that the validator does not implement is documentation, not a check. `scripts/build-schema-types.mts` throws on a construct it does not understand rather than emitting `any`. Adding a keyword means both files, plus a test that a document violating it is actually rejected.

## The scrub guard

This repository is public. `scripts/scrub.test.mts` (`[smoke]`, so it runs even in `npm run test:smoke`) fails the whole suite if any tracked file carries the maintainer's name or machine, the private workspace this project grew out of, a real in-game character name, the project's retired product name, or a `/Users/<real name>` home path outside the `/Users/example` placeholder. Each pattern's exact allow-list — the handful of files deliberately permitted to carry the maintainer's public GitHub handle, such as `package.json`'s `author` field or the repository URL in `README.md` — lives in `scripts/scrub.test.mts` itself, next to the reason it's there.

If it fires on something you wrote: reword the offending line so the information isn't there — a real name becomes "the maintainer," a real path becomes `/Users/example` or `~/…`, a real character name becomes one of the fixture names the test suite already uses (`Dorran`, `Kestrel`, `Rowan`, `Sable`). **Never edit the guard's patterns or allow-lists to make a failure go away** — if you genuinely believe a new file needs a new allowance (a new place the maintainer's handle legitimately has to appear, for instance), say so in your PR description and let a maintainer decide; don't add yourself to the allow-list to get a red test green.

## Where the rest is written down

- `docs/module-map.md` lists every module, area by area: its role and the concepts it owns, and which concepts are still copied by hand in more than one place. `scripts/module-map.test.mts` fails when a module is missing from it or a path it names is gone.
- `docs/architecture.md`: the Electron shell (`electron/`), the inbox watcher (`app/watcher.mts`), the installer (`app/installer.mts`), the data folder, every HTTP route, the dev loop in detail, the server's request checks, the data model the fold produces, and the parsing and classification gotchas.
- `docs/solver.md`: the suit solver, the core's own search, saved runs, profile semantics, templates and build jobs.
- `docs/ui.md`: the page's hard rules, tokens, components and import rules, with one page per screen under `docs/ui/`.
- The contracts, which anything reading or writing them (an adapter, a shard's rules file, a future client) must match: `docs/scan-schema.md` (every scan field, the v1→v2 upgrade and the fold rules), `docs/bridge-protocol.md` (the queue and status files, command, result and status shapes, actions, and the safety rules: the offset rule, the wrong-character confirm, local-only messaging), `docs/shard-rules.md` (every key in a shard's rules file, how to add or override one without touching the app, and how the app loads them) and `docs/adapter-guide.md` (what a new adapter must ship, the transports, which shards an adapter must never target, and the attended-only statement).
- `docs/mcp.md`: the built-in MCP server.
- Adapters: each game client's scripts live in `adapters/<id>/`, with a `capabilities.json` the app reads to discover them. Each adapter README opens with a section for players and ends with a "For developers" section: `adapters/tazuo/README.md`, `adapters/razor-enhanced/README.md`, `adapters/classicuo-web/README.md`. The setup wizard treats them by transport: for TazUO it proposes the client folders it finds on its own (`candidateClientRoots` in `app/installer.mts`); Razor Enhanced has no well-known install location, so it proposes none and the player always picks the folder by hand; the ClassicUO web client (paste transport) has nothing to locate or install, and the wizard sends the player to Import instead. Install and Reinstall refuse while a Pack Rat script is still alive in the client (the installer's running-script guard, `docs/architecture.md`).
- `docs/threat-model.md` is who the app defends against and why; `SECURITY.md` is how to report a vulnerability.
- Cutting a release follows the checklist in `RELEASING.md`. Everyone participating is expected to follow `CODE_OF_CONDUCT.md`.
