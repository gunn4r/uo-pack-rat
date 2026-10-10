# Testing

Standard interface (`npm test` and its variants are the same runner as `./scripts/test_runner.sh`, just invoked through `package.json`):

```
./scripts/test_runner.sh --smoke   # or: npm run test:smoke   — Pack Rat parser/fold/pool smoke tests (<5 s)
./scripts/test_runner.sh --fast    # or: npm run test:fast    — + the rest of the vault/config/optimizer-core [fast] tests
./scripts/test_runner.sh           # or: npm test             — + the [slow] exhaustive-search proofs and the Electron shell smoke test
./scripts/test_runner.sh --changed # only the test files for this branch's changes (--changed=<ref> for another base than origin/main)
```

Results land in `test_logs/latest_summary.json`. Read that, not the console output.

## Trying a PR before merging

```
npm run try -- 110            # one PR
npm run try -- 100 110        # a stack: the first PR, with the others merged on top (locally only)
npm run try -- 110 --demo     # sample data instead of your own
```

`scripts/try-pr.sh` fetches each PR, checks the first out into a reusable scratch worktree beside the repo (`../pack-rat-wt/try`, or `$PACKRAT_TRY_DIR`), merges the rest into it, and starts the desktop app from there; the next run resets and reuses the same folder, so there is nothing to clean up, and your own checkout is never touched. Without `--demo` it uses your real Pack Rat data, so quit the installed app first (one app per data folder). When the PRs change the game scripts it says so: stop them in game and reinstall from Settings in the trial window, then reinstall from your normal app afterwards. PRs that edit the same lines refuse to stack and the script names the files, except `CHANGELOG.md`, where every PR adds its own line: that file merges with git's union driver, keeping both. `--devtools` is passed through too. Needs `git`, `gh` and bash.

## How the runner works

`--changed` takes every path changed since the merge base (committed, staged, unstaged and untracked), maps it with `scripts/select-tests.mts` and runs every test in the selected files, `[slow]` and Electron included; the summary's `mode` is `"changed"` and its `note` says what was chosen. A changed test file runs itself; `adapters/**` runs `app/adapters.test.mts`, `app/adapter-outputs.test.mts` and `scripts/gen-contracts.test.mts`; any other path runs the test files that reach it through relative string literals (imports, `new URL("./x.css")`) or, for a data file, name it in quotes; an `app/ui` file also adds the Electron test for its screen (all of them for shared UI code, plus `ui-contrast` for CSS). Docs select nothing, and if nothing is left the run writes an empty summary. The runner itself, its helpers (`electron-window.mts`, the builds), `package.json`, `tsconfig*`, `app/schema/**`, `electron/**` and any path no test reaches run the full suite instead. It prints each selected file with the paths that picked it.

When to run what: while iterating, `--changed` plus `npm run typecheck`; before a PR's first push, `--fast` plus the Electron test files for the screens touched (or `--changed`, which picks them); follow-up commits after review, `--changed`. Run the full suite locally only when touching test infrastructure, the Electron shell or shared helpers, or to reproduce a CI failure — CI's full run on three OSes is the merge gate.

Everything runs on Node's built-in test runner (`node:test`); `scripts/test-runner.mts` drives it with the programmatic `run()` API over every `*.test.mts` file found by a **recursive** walk of `app/` and `scripts/` (excluding `node_modules/`, `dist/`, and `fixtures/`), then writes the summary and prints the ten slowest files. The files run in parallel, each in its own process, as many at once as the machine has cores (`TEST_CONCURRENCY=1` runs them one at a time), except that the files that open an Electron window (`scripts/ui-*.test.mts`, `scripts/shell-smoke.test.mts`) run one at a time alongside the rest on macOS and Windows: windows on one desktop share its pointer and keyboard focus, and a window one file shows closes another file's hover and focus tooltips (Windows CI failed on exactly that). On Linux each of those files has an X display of its own (below), so they run in parallel there; every file keeps its own temp folders and ports, and each Electron launch its own data folder, which is also Electron's `userData` and single-instance lock. The page is built into `app/dist/` once, before any file starts, and the runner then sets `PACKRAT_UI_BUILT=1` for the files it runs, so nothing that would otherwise rebuild it (the Electron shell's self-heal, `npm start`, `app/server.test.mts`) clears it while another file is loading it. Discovery is recursive specifically so a test file in a new subdirectory — `app/schema/validate.test.mts` was the one this missed for a while — is picked up automatically, with no runner edit needed.

The counting lives in `scripts/run-suite.mts` so it can be tested. It is built so the summary cannot read green by accident:

- The schema-types and page builds run inside the same guarded block as the tests, so a `tsc` error in `app/ui` is written to the summary as a failure (with the compiler's message) rather than leaving the previous run's summary on disk. `npm test` has no `pretest` build hook for the same reason: a failing hook would stop the runner before it wrote anything.
- A test file only counts as finished when `node:test` sends its end-of-file summary. A file that stops part-way (a `process.exit(0)` in a test, or in a module it imports) otherwise reports nothing for the tests it had not reached, and often nothing at all, so it is recorded as "file stopped before its tests finished".
- A file that fails to load is recorded with the tail of its own stderr (the thrown message, `ERR_MODULE_NOT_FOUND`), not just "test failed".
- A run in which no test ran at all is a failure, not `0/0 passed`.
- A 12-minute timeout (per test on Node 24, per file on Node 22, where `run()` applies it to the file as a whole) sits below CI's 20-minute job timeout, so a hang in CI still ends in a written summary naming the hung test or file.
- No `forceExit`: it ends a file the moment its last test returns and so drops an error that fires after that (a timer that throws, a promise rejected without an await), which must fail the file ("file failed after its tests finished", with node:test's own note on what happened). Instead `scripts/test-file-watchdog.mts` is preloaded into every file and, 10 s after its tests have finished, stops a file that is still running on an open handle and says so on stderr ("file kept running after its tests finished").
- Other file-level diagnoses: "file stopped before its tests finished" (a `process.exit()` part-way, any code), "file failed to load" (an error before any test ran, with its stderr), "file timed out" (Node 22), and, in a full run only, "file registered no tests".
- `failures[].file` is a `/`-separated path relative to the repo root on every platform.

## What is under test

Each test file says what it covers in its own header comment (a `.test.mts` file's leading `//` lines, an adapter `test_*.py` file's docstring), whose first line is `<name> — <one-sentence summary>.`. Update the header in the same change as the tests. The index below is generated from those first sentences by `npm run gen:test-index` (`node scripts/test-index.mts --write`; `--check` only checks it, and no flag prints it); `scripts/test-index.test.mts` fails when a test file has no header or the index is stale.

<!-- test-index:start (generated by node scripts/test-index.mts --write) -->
- `adapters/tazuo/test_paths.py` — the TazUO adapters' shared data-directory resolver and script header rules.
- `adapters/test_adapters.py` — the adapter conventions and the bridge's untrusted-input guards, checked against EVERY adapter directory rather than tazuo alone.
- `adapters/test_bridges.py` — both bridges' main() loops run end to end against a fake client.
- `adapters/test_panel.py` — the TazUO in-game panel (adapters/tazuo/packrat-panel.py) run end to end against the fake client.
- `adapters/test_scanners.py` — the TazUO and Razor Enhanced scanners and refreshes run end to end against a fake client.
- `app/adapter-copy.test.mts` — what the page says about each game client (`app/ui/adapter-copy.mts`, design spec 4.10, section 5).
- `app/adapter-outputs.test.mts` — what the Python adapters really write, checked against the schemas they claim to meet.
- `app/adapters.test.mts` — runs every adapter's Python test file and holds the manifest-versus-source contract for `capabilities.json`'s `actions` list.
- `app/atomic-write.test.mts` — `app/atomic-write.mts`'s `renameRetrying` and its Windows retry.
- `app/bridge-adapter-fallback.test.mts` — `app/ui/bridge.mts`'s `currentAdapter()`/`bridgeNote()` falling back to the server's bridge adapter when no client is set.
- `app/bridge-status.test.mts` — the bridge reporting itself: `readBridgeStatus` (`app/bridge-status.mts`), the one reader of status.json, and `bridgeFeatures` (`app/vault-lib.mts`), what a bridge can do.
- `app/bridge-toast.test.mts` — `app/ui/bridge.mts`'s `pollBridge()` toasting what the bridge reports for the commands this page queued.
- `app/bridge-trip.test.mts` — `queueTrip` (`app/bridge-trip.mts`), the only writer of an Organize trip line, and the stop flag behind POST /api/bridge/stop.
- `app/buffs-plan.test.mts` — Automatic's buffs in the optimizer's profile (issue #12, `app/buffs.mts` `plannedProfile`), across the combinations.
- `app/buffs.test.mts` — `app/buffs.mts`, the Suit Builder's buffs, abilities and forms (issue #12).
- `app/build-spec.test.mts` — `app/build-spec.mts`, a build's intent as one document (issue #218, BuildSpec).
- `app/builder-model.test.mts` — `app/ui/builder-model.mts`, the Suit Builder's pure logic.
- `app/builtin-templates.test.mts` — the shipped built-in templates (`app/data/templates/<shard>.json`, issue #212) as data.
- `app/classicuo-web-adapter.test.mts` — stands in for app/contracts.test.mts for the ClassicUO web client adapter, which ships no fixture.scan.json yet.
- `app/config.test.mts` — `app/config.mts`'s `resolveConfig` and the per-adapter bridge paths.
- `app/contracts.test.mts` — folds every adapter's fixture.scan.json against its own capabilities.json, checking the two agree with each other and with the shared scan and bridge schemas.
- `app/diagnostics.test.mts` — `app/diagnostics.mts` and the per-slot bound it shares with the MIP (`app/mip.mts` propertyReach, issue #217): propertyReach gives the numbers the bound inside buildSuitMip used to compute (a copy of that code is the reference, over fuzzed pools with two-handers, required slots and negative values) and BuiltMip.reach is the same, plus one bound written out by hand (a duplicated serial, a worn piece missing from the pool, a required slot with only negative pieces); `floor_unreachable` for a floor one above the bound (hard: Lower and Make soft; soft: info, Lower only), none for a floor exactly at it (which keeps its hard row); best possible in the player's terms (the Resisting Spells minimum, a floor at it met by any suit, a buff's share, the cap), a buff that lifts reach over a floor; `floors_conflict` on the floors the suit misses, on the heuristic path ("not found within the time limit") and on HiGHS's (a proven conflict); an empty inventory; a malformed profile (non-list `hardFloors`) read as far as it goes; a resist floor clipped to its cap saying so; and the page's side (`ui/builder-model.mts`): an action's words and edit, an action that no longer fits the panel (lowered by hand, removed, already soft) doing nothing, an alternative suit's card without `floors_conflict`, `withDiagnostics` leaving the field off when computing them fails, a saved run without `diagnostics` drawn from `unreachableFloors`, and Set weight (its words, and doing nothing once the weight changed or was removed since the build); and the weight scale: `typicalRange` (registry, cap, override, pools, skill bonuses), `weight_dominates` on a melee main's suit (luck at weight 3, suggested 0.8) measured against the OTHER weights (two properties can flag, one can't), quiet on a balanced profile, zero and negative weights, each threshold and the thin-suit guard alone, the suggested weight's rounding, the archer template on a weapon-only and a low-resist suit of the demo inventory (quiet, by the guard), and every shipped template on the demo characters' full suits (quiet); and swing (PR 3): `swing_linear` with Lock for the weapon's hand when the suit's weapon is the worn one (else the sentence says to equip it; none without a weapon), `swing_next_step` within 10 SSI with its stamina half only when a band up reaches the step, quiet with steps on, too far, at the cap or with no swing, the page's side of both (the switch, Lock, a step's requirement that raises or adds, soft, where Lower never raises, Next step and the swing line), and a weight's share with SSI scored by step counting the step credit; and `onlyRootsDiagnostics` (issue #12) naming the slots Only containers leaves empty.
- `app/dialog-prompt.test.mts` — `app/ui/dialog.mts`'s `normalizePromptValue()`, the DOM-free part of the in-page prompt.
- `app/evaluate.test.mts` — `evaluateSuit` (`app/evaluate.mts`, issue #216) against the three assemblies it replaced.
- `app/facet-map.test.mts` — `app/facet-map.mts` (issue #164): decoding a facetNN.mul overview bitmap and cutting a region out of it.
- `app/fc-cap.test.mts` — the Faster Casting cap by casting school (issue #213): `fcCapFor` in `app/vault-lib.mts` and where the cap goes.
- `app/fold-unopened.test.mts` — `foldSnapshots` and a container a scan saw but could not open.
- `app/gear-vault.test.mts` — `app/vault-lib.mts` (parser, classifier, fold, pools) and the optimizer core through the same loader the server uses.
- `app/house-capture.test.mts` — `app/house-capture.mts` (issue #10): house ids, the newest capture per house, furniture merged across captures and superseded footprints.
- `app/house-model.test.mts` — `app/house-model.mts` (issue #10) on synthetic houses (`app/house-fixture.mts`).
- `app/house-names.test.mts` — `app/house-names.mts`, the house names and drawn areas in `<data>/house-map.json` (issue #164).
- `app/house-server.test.mts` — the house routes (issue #10) and the facet overview (issue #164) on a real server and temp data folder.
- `app/houses-data.test.mts` — `app/ui/houses-data.mts`, the House map's cache of house models by id and capture stamp (issue #10).
- `app/http/router.test.mts` — `app/http/router.mts` on its own: which route answers a request.
- `app/import-children.test.mts` — `app/ui/dom.mts`'s `compactChildren()`, the fix for the Import tab rendering the word "null".
- `app/import-preview.test.mts` — `app/ui/import-preview.mts`, the Import drawer's preview card as data (design spec 4.9).
- `app/import.test.mts` — `app/import.mts`: `parsePastedScan`'s extraction and refusals, the v1→v2 upgrade it shares with the watcher, and `writeScanToInbox`'s own write.
- `app/installer.test.mts` — `app/installer.mts`: adapter discovery, client-folder detection, script install, the data-folder check and the update check.
- `app/item-kinds.test.mts` — the player's own item kinds (issue #150): the layering in the fold and `app/item-kinds.mts`'s file handling.
- `app/item-query.test.mts` — `app/item-query.mts`, the item-list filtering, sorting, paging and faceting shared by the page and `GET /api/items`.
- `app/manual-handoffs.test.mts` — the Suit Builder's Manual ↔ Automatic hand-offs (issue #12), with a seeded fuzz over pinned pieces.
- `app/manual-model.test.mts` — `app/ui/manual-model.mts`, the Suit Builder Manual mode's pure logic (issue #12).
- `app/mcp.test.mts` — the built-in MCP server (issue #211; `app/mcp.mts`, `app/mcp-tools.mts`) on a real server and temp data folder.
- `app/migrate.test.mts` — `app/migrate.mts`, the one registry of data-file migrations: every golden file in `app/fixtures/golden/<kind>/<version>.json` loads through `migrate` to its kind's current version and passes that kind's own check, and migrating it again changes nothing; every kind has a golden file at its current version; a document newer than the build comes back untouched and marked `newer`; a v3 profiles.json with `intent.swingSteps` (issue #217) reads as it is, with no step, with the "made by a newer Pack Rat" notice; `version` and `schemaVersion` read as one field, written as the file writes it; a document with no version its kind accepts comes back untouched for its reader to refuse; and each kind's steps are in order and end at its current version.
- `app/mip.test.mts` — `app/mip.mts`, the pure MIP builder, and `app/mip-solve.mts`, the HiGHS solve.
- `app/missing.test.mts` — `app/missing.mts`, Missing since last scan (issue #99): what left a root container between its last two scans and is nowhere else in the inventory now.
- `app/newer-files.test.mts` — data files made by a newer Pack Rat (app/migrate.mts), on a real server and temp data folder: `GET /api/organize`, `/api/item-kinds`, `/api/house-map` and `/api/profiles` read what they can and say `readOnly` ("made by a newer Pack Rat"), and every save to them (`PUT /api/organize`, `POST /api/item-kinds` and its import, `PUT /api/house-map/<id>`, `PUT /api/profiles`) is a 409 with that message, the file left byte for byte.
- `app/organize-config.test.mts` — `app/organize-config.mts` (issue #11): the strict check PUT /api/organize runs on an Organize setup, and the salvage every read of a hand-edited organize.json goes through.
- `app/organize-presets.test.mts` — `app/organize-presets.mts` (issue #11): every preset is a valid rule and finds what its name promises.
- `app/organize-server.test.mts` — the Organize routes (issue #11) and the item kinds routes (issue #150) on a real server and temp data folder.
- `app/organize-state.test.mts` — `app/organize-state.mts` (issue #11): trip results read into the overlay, settled entries dropped and a damaged state file salvaged.
- `app/organize-strategies.test.mts` — `app/organize-strategies.mts`, Organize's Auto mode (issue #11, spec §5).
- `app/organize.test.mts` — `app/organize.mts`, Organize's planner (issue #11), on hand-built house scans folded by the real fold.
- `app/png.test.mts` — `app/png.mts` (issue #164), the PNG writer.
- `app/properties.test.mts` — `app/vault-lib.mts`'s property registry (`PROPERTIES`): the lists derived from it, frozen as the literals they replaced.
- `app/put-away.test.mts` — `app/put-away.mts` (issue #131): the strict check on the TazUO panel's Put away request.
- `app/retention.test.mts` — `app/retention.mts` (issue #28): which old scans and saved runs pruning removes, with the inventory folded from what is left equal to the inventory folded from everything.
- `app/rules.test.mts` — `app/rules.mts` (`loadRules`, `listRules`): schema validation, the builtin shards, user-folder overrides and error naming.
- `app/run-settings.test.mts` — `app/run-settings.mts`, the one check a run's settings are held to (issue #218).
- `app/scan-schema.test.mts` — `app/scan-schema.mts`: the scan v2 schema and the v1→v2 upgrade on read.
- `app/schema/validate.test.mts` — `app/schema/validate.mts`, the zero-dependency JSON Schema subset validator.
- `app/scrolls-model.test.mts` — `app/ui/scrolls-model.mts`, the Inventory's Scrolls view as data (issue #181).
- `app/server-builder.test.mts` — HTTP tests of the Suit Builder: `POST /api/optimize`, the saved runs and `GET|PUT /api/profiles`.
- `app/server-host.test.mts` — HTTP tests of the event stream, the bridge, the host calls and the UI preferences.
- `app/server-import.test.mts` — HTTP tests of `POST /api/import/paste` and `POST /api/import/rescan`.
- `app/server-inventory.test.mts` — HTTP tests of the inventory routes, Forget and the blacklist.
- `app/server-settings.test.mts` — HTTP tests of the settings, the shard's rules and retention.
- `app/server-setup.test.mts` — HTTP tests of the setup wizard's routes, the TazUO panel, the update check and the client search.
- `app/server.test.mts` — HTTP tests of what every route shares, on a real listening server (ephemeral port, temp data folder).
- `app/services/events.test.mts` — `app/services/events.mts` on its own: event frames, the broadcast and `close()`.
- `app/services/houses.test.mts` — `app/services/houses.mts` on its own: why there is no tiledata.mul or facet, and the facet PNG cache.
- `app/services/inventory.test.mts` — `app/services/inventory.mts` on its own: when the fold and the overlay are cached and when they are made again.
- `app/services/jobs.test.mts` — `app/services/jobs.mts` on its own, with stand-in workers: supersede, the ceiling, cancel, saved runs and failure logging.
- `app/services/organize.test.mts` — `app/services/organize.mts` on its own, with stand-in stores.
- `app/services/retention.test.mts` — `app/services/retention.mts` on its own: what a prune removes, logs and tells the pages.
- `app/services/settings.test.mts` — `app/services/settings.mts` on its own: fallbacks kept in memory, saves that write only their own fields, and a shard switch.
- `app/services/setup.test.mts` — `app/services/setup.mts` on its own, over copies of the repo's adapters.
- `app/slot-groups.test.mts` — `app/vault-lib.mts`'s gear slot groups (issue #218) and the one neck-armor rule.
- `app/solver-buffs-fuzz.test.mts` — Automatic's buffs (issue #12) under a seeded fuzz, the pattern of solver-fuzz.test.mts.
- `app/solver-builtins.test.mts` — every UO Alive build template (issue #212) builds on the fixture with both solvers.
- `app/solver-fuzz.test.mts` — a seeded brute-force equivalence check of all three searches over small generated inventories.
- `app/solver-large.test.mts` — app/solver.test.mts's one real-sized case, a 3,000-item generated cell, in a file of its own.
- `app/solver-templates.test.mts` — HiGHS and the core agree on the fixture for every shipped default template, and with soft floors.
- `app/solver.test.mts` — solver equivalence: HiGHS must never disagree with the core's own exact branch-and-bound about what the best suit is worth.
- `app/store/json-file.test.mts` — `app/store/json-file.mts`: each bad-file policy and the writer.
- `app/store/stores.test.mts` — each store in `app/store/` on its own: size caps, bad files and the exact bytes written.
- `app/swing.test.mts` — swing speed (`app/swing.mts`, issue #217): the formula on the worked examples (a 3.5 s weapon at stamina 88 needs SSI 51 for 1.75 s and swings at 2.0 s with 45; at 95, 38 for 1.75 s and 58 for 1.5 s), the 1.25 s floor, the 60 cap, the least-SSI closed form against a scan of the formula (exact-integer edges included), stamina with a Bless share, the weapon speed a pool shares (one speed, two, a shield only, a two-hander and a one-hander alike), the step list a person reads (with the one-handed pool set aside while a worn two-hander is locked), and the solvers' step table (points above the pool's SSI reach left out): its best reached credit equals the credit worked out from the swing itself for every SSI and stamina (negative buff shares, reference bands below and above, a share large enough that a step needs no gear SSI), with no point another one beats.
- `app/tazuo-panel.test.mts` — `app/tazuo-panel.mts`: the panel hotkey, the TazUO-is-running decision and the merge-only edit of TazUO's lscript.json.
- `app/theme.test.mts` — `app/ui/theme.mts`'s pure look resolution and `app/ui/items.mts`'s `rarityToken`.
- `app/tiledata.test.mts` — `app/tiledata.mts` (issue #10): reading a 7.x tiledata.mul, classifying a tile the way the house map draws it, and finding the file.
- `app/ui-characters.test.mts` — the Characters screen's pure logic (`app/ui/sheet.mts`'s formatters, `app/ui/roster.mts`).
- `app/ui-components.test.mts` — `app/ui/components.mts`'s builders on a fake DOM just big enough for them.
- `app/ui-inventory.test.mts` — `app/ui/inv-model.mts`, the Inventory screen's pure rules.
- `app/ui-item-tip.test.mts` — `app/ui/item-tip.mts`, where the item tooltip gets its item (issue #10).
- `app/ui-map.test.mts` — `app/ui/house-map-model.mts`, the House map's pure rules (issues #10 and #164).
- `app/ui-messages.test.mts` — `app/ui/messages.mts`, the plain sentences the page shows for an outcome the server reports as a count, a status code or a one-word field.
- `app/ui-organize.test.mts` — `app/ui/organize-model.mts`, the Organize screen's pure rules (issue #11).
- `app/ui-render.test.mts` — the page's DOM builders for scan-supplied values (the character sheet, the tooltip, the peek's properties), which once built markup as a raw string.
- `app/ui-state.test.mts` — `app/ui/view-state.mts`, the page's DOM-free state rules.
- `app/ui-world-map.test.mts` — `app/ui/world-map-model.mts` (issue #164), the world map lightbox's view.
- `app/watcher.test.mts` — `app/watcher.mts`: the accepted-name rule, ingesting a file, and the watcher's debounce, retry, reject, sweep and self-healing.
- `app/wizard-default-adapter.test.mts` — `app/ui/adapters.mts`'s adapter-selection helpers: the wizard and the Import tab never default to a paste client or to a client this OS can't run.
- `scripts/american-spelling.test.mts` — a [smoke] guard for American spelling in what a player reads (issue #10).
- `scripts/build-schema-types.test.mts` — the JSON Schema to TypeScript generator (`scripts/build-schema-types.mts`).
- `scripts/build-ui.test.mts` — `scripts/build-ui.mts`'s `buildUi()`, the page build.
- `scripts/css-guard.test.mts` — a [smoke] guard that keeps screen stylesheets from restyling the shared components, and the window breakpoints in one list.
- `scripts/docs-links.test.mts` — a [smoke] guard that every repo path the Markdown names in backticks exists.
- `scripts/electron-guards.test.mts` — the Electron shell's guards, from the phase-7 review: unit tests of the pure decisions and source-level checks on `electron/main.mts`.
- `scripts/gen-contracts.test.mts` — `scripts/gen-contracts.mts`, the generator that copies `adapters/_shared/` fragments into the adapter scripts.
- `scripts/gen-graphic-layers.test.mts` — `scripts/gen-graphic-layers.mts`, the tiledata reader behind `app/vault-lib.mts`'s wearable-graphic table.
- `scripts/layering.test.mts` — a [smoke] guard for the import layering of app/, scripts/ and electron/.
- `scripts/make-adapter-fixture.test.mts` — `scripts/make-adapter-fixture.mts` run as a real child process, the way a maintainer invokes it, against temp in/out paths.
- `scripts/module-map.test.mts` — a [smoke] guard that keeps `docs/module-map.md` from falling behind the tree.
- `scripts/no-unbounded-loop.test.mts` — a [smoke] guard that no adapter `.py` file contains an unbounded-loop literal anywhere.
- `scripts/optimizer-core.test.mts` — the offline test harness for the suit optimizer core (`scripts/optimizer-core.mts`).
- `scripts/packaging.test.mts` — the electron-builder config, which is product interface: which files reach a player's machine, under which target, with which identifiers.
- `scripts/run-suite.test.mts` — `scripts/run-suite.mts`, the counting half of the test runner, driven against throwaway test files in a temp directory.
- `scripts/scrub.test.mts` — a [smoke] guard: this repository is public, and nothing tracked in it may carry private details.
- `scripts/select-tests.test.mts` — `scripts/select-tests.mts`, the changed-paths → test-files mapping behind `./scripts/test_runner.sh --changed`.
- `scripts/shell-smoke.test.mts` — proves the packaged Electron shell (`electron/main.mts` + `electron/server-entry.mts`) boots, serves the page and exits clean.
- `scripts/slot-lists.test.mts` — a [smoke] guard for one slot vocabulary (issue #218).
- `scripts/start.test.mts` — `scripts/start.mts` (`npm start`) as a real child process: a signal reaches the server and a signal death never reads as a clean exit.
- `scripts/test-index.test.mts` — a [smoke] guard that every test file describes itself in a header and that TESTING.md's test index is current.
- `scripts/test-tags.test.mts` — a [smoke] guard that every top-level test name starts with a tag.
- `scripts/ui-builder.test.mts` — [slow]: the Suit Builder's keyboard, hover and panel behavior in the real Electron window.
- `scripts/ui-components.test.mts` — [slow]: `app/ui/components.mts`'s overlays and keyboard behavior in the real Electron window.
- `scripts/ui-contrast.test.mts` — [slow]: the contrast check from design spec 2.3, run on the real page in both theme families, light and dark.
- `scripts/ui-forms.test.mts` — [slow]: the form-like screens (the Import drawer, the setup wizard and Settings) in the real Electron window.
- `scripts/ui-map.test.mts` — [slow]: the House map (issues #10 and #164) in the real Electron window over a seeded data folder.
- `scripts/ui-organize.test.mts` — [slow]: Organize (issue #11) in the real Electron window over the demo scans.
- `scripts/ui-scrolls.test.mts` — [slow]: the Inventory's Scrolls view (issue #181) in the real Electron window.
- `scripts/ui-shell.test.mts` — [slow]: the app shell (design spec 3.1) in the real Electron window.
- `scripts/ui-smoke.test.mts` — [slow]: the Playwright-driven render check that the page renders and its tabs work.
- `scripts/ui-state.test.mts` — [slow]: the page's state transitions in the real Electron window.
- `scripts/ui-tooltips.test.mts` — [slow]: the item tooltip on every screen that draws an item (issue #10).
<!-- test-index:end -->

The adapters' Python test files are not a separate runner step: `app/adapters.test.mts` spawns each `test_*.py` as a `[fast]` case. `app/contracts.test.mts`, `app/scan-schema.test.mts`, `app/rules.test.mts` and `app/bridge-trip.test.mts` together keep the contracts (`docs/scan-schema.md`, `docs/bridge-protocol.md`, `docs/shard-rules.md`) honest against the code that ships.

An adapter whose client only runs on one OS declares that in `capabilities.json`'s optional `platform` field (`docs/adapter-guide.md`'s "Platform restriction" section); Razor Enhanced sets `"platform": "win32"`. The field is covered across three files rather than its own: `app/installer.test.mts` (`listAdapters` surfaces `a.platform`; `candidateClientRoots`'s `adapterPlatform` parameter gates on that data, not a hard-coded adapter id, proved using `tazuo` as the vehicle, since `razor-enhanced` itself has no candidate path to gate in the first place), `app/wizard-default-adapter.test.mts`, and `app/server.test.mts` (`GET /api/setup` reports `platform` per adapter and the server's own `platform`, and `razor-enhanced`'s `candidates` entry is empty on a non-Windows test machine).

## Electron UI tests

**Electron UI tests never search a real game-client folder.** Every `_electron.launch` passes `env: testEnv()` from `scripts/electron-window.mts`, which sets `PACKRAT_CLIENT_HOME` to a throwaway folder; the server (`app/vault-server.mts`'s `defaultClientSearch`) then looks for clients only under it, with no `LOCALAPPDATA` and no fixed roots such as `C:\TazUO`. Without it a test launch on a machine with a real client found that client's `packrat-paths.json` and showed the player's own paths in the data-folder banner. A test that needs a client planted passes its own home (`testEnv({}, home)`); `scripts/ui-smoke.test.mts` proves a launch finds only what is in its temp home. Server tests do the same through `startServer`'s `clientSearch` option.

**Electron UI tests never reach GitHub.** Every `_electron.launch` passes its data folder through `noUpdateCheck(dataDir)` from `scripts/electron-window.mts`, which sets `autoUpdateCheck: false` in that folder's `settings.json` (keeping whatever the test wrote there), so the automatic update check (#67) never runs; the one test of the check (`scripts/ui-forms.test.mts`) turns it on in Settings with `GET /api/update-check` mocked.

**Electron UI tests on Linux each get their own X display.** Importing `scripts/electron-window.mts` on Linux starts an `Xvfb` for that test file and points its `DISPLAY` at it. The files run in parallel, and under one shared display (CI's `xvfb-run`, which has no window manager) the X input focus moves to whichever window was shown last, so the other windows' focus and hover tooltips close or never open. Without `Xvfb` installed a file keeps the display it was given, with a warning. macOS and Windows have no such per-process display, which is why the runner runs these files one at a time there.

**Electron UI tests use the real window size.** No test may emulate a viewport larger than its real window (`page.setViewportSize` draws a wide layout inside a narrow window, which no player ever sees). A test asks `fitWindow(app, page, {width, height})` in `scripts/electron-window.mts` for the size it wants; the window is set to that size clamped to the screen's work area, and the test drives whichever layout the width it really got shows (`openFacet` and `setRows` reach the Inventory controls that fold away below 1180 px). An assertion that needs more width than the screen allows is a subtest skipped with that reason, and still runs where the screen is big enough (locally, Ubuntu's virtual display). CI's macOS and Windows runners have screens smaller than 1180 px; `PACKRAT_TEST_SCREEN=1000x700 node --test scripts/ui-*.test.mts` stands in for them on a big screen, and a change to a UI test is run both ways. Outside the runner, build the page first and pass `PACKRAT_UI_BUILT=1` (`npm run build:ui && PACKRAT_UI_BUILT=1 PACKRAT_TEST_SCREEN=1000x700 node --test scripts/ui-*.test.mts`): without it every Electron launch rebuilds `app/dist/`, and while one file's launch clears it another file's window gets a 404 for `/ui/app.mjs` and sits on "Loading…" until its 30 s wait for the first row fails.

`TEST_SKIP_ELECTRON=1` skips the files that launch Electron (`scripts/shell-smoke.test.mts`, `scripts/ui-*.test.mts`), the same way `TEST_SKIP_SLOW=1` skips the `[slow]` cases; they also skip with a note when `electron` (or, for the UI files, `playwright`) is not installed. `scripts/ui-smoke.test.mts` is what stands in for a full end-to-end UI test today.

## Tags

Tags are prefixes on the test's own name, not a separate parameter: `test("[smoke] parseTooltip reads modeled props", () => { ... })`. The runner filters by `node:test`'s `testNamePatterns`:

- `--smoke` → only `[smoke]` (the handful that prove the pipeline is alive).
- `--fast` → `[smoke]` and `[fast]` (cheap; no brute-force or generated-cell proof, though `[fast]` now includes a handful of short real HiGHS solves — a few seconds each, not the exhaustive kind `[slow]` marks).
- full (no flag) → everything, `[slow]` included.

`[slow]` marks the exhaustive/exact-search proofs that run `optimizeSuit` with `exact: true` and a real `timeBudgetMs`, or the equivalent HiGHS proof on a large generated cell — the 150/80-random-suit brute-force comparisons and the demo-inventory exact/warm-start checks in `app/gear-vault.test.mts`, `app/solver-large.test.mts`'s 3,000-item generated cell (HiGHS proves it; the core is checked against it wherever the core also proves it in budget), `app/solver.test.mts`'s k-best alternatives case (the core's exact search on the fixture's melee cell, 10-20 s), and `app/solver-builtins.test.mts`'s thirteen UO Alive build templates through both solvers on the fixture (about 45 s). Set `TEST_SKIP_SLOW=1` to skip them (they register as `node:test` `skip` results, which the runner counts under `skipped`, not `passed`):

```
TEST_SKIP_SLOW=1 npm test
```

Add a tag to every new test; an untagged test only runs in full mode (no pattern is applied there).

## Speed checks

A test that asserts code runs inside a millisecond budget times it with `fastestMs` from `app/timing-fixture.mts` (issue #195), never with a single sample: one untimed warm-up run, then the fastest of up to 10 runs spaced 50 ms apart, stopping at the first run inside the budget. CI runs on shared machines whose neighbours steal the CPU in bursts, and noise only ever adds time, so the minimum is the honest reading of the code's own cost; a real regression is slow on every run and still fails. Pass `fastestMs` a sample function that returns its own elapsed ms: `msOf(() => work())` for in-process code, or the time a `page.evaluate` measured inside an Electron page (the House map's level redraw in `scripts/ui-map.test.mts`). Keep the budget at what the feature needs, not at what a slow runner happened to take. Checks that guard a complexity cliff with a wide ceiling (`parseTooltip`'s 1 s against a 9 s quadratic, the fold's ratio of two runs) or that time a timeout or deadline itself (`timeBudgetMs`, `renameRetrying`, `close()`) are not speed checks in this sense and keep their single measurement.

## Server tests

A test that starts the real server starts it with `startTestServer(config, opts)` from `app/server-fixture.mts`, never with `startServer` itself: the server then searches an empty temp home for the game client's scripts, never asks the OS whether the client is running, and asks a fake for the latest release, which records every URL in `updateRequests`. `opts` overrides those fakes field by field.

The HTTP route tests run against a real listening server (ephemeral port, temp data directory), one file per route family (`app/server.test.mts` for what every route shares, `app/server-<family>.test.mts` for the rest), sharing `app/server-routes-fixture.mts` (the response shapes, `asJson`, the shard's rules, raw requests, an SSE reader, the demo fold and the log). Each file builds the schema types and the page first, sets the shard's rules before every test, and (where its tests use it) starts one shared `--demo` server.

## Ad-hoc runs

`node --test` works directly on this suite, but pass explicit file globs — bare directory names (`node --test app scripts`) do **not** recurse into subdirectories on this Node version/project layout, and running bare `node --test` with no path at all will additionally pick up `scripts/test-runner.mts` itself as a test file (it matches Node's default `test-*.mts` discovery pattern) and re-enter its own `run()` call. Use:

```
node --test 'app/**/*.test.mts' 'scripts/*.test.mts'   # every JS test, human-readable TAP output
node --test app/gear-vault.test.mts                 # one file
node --test --test-name-pattern '^\[smoke\]' 'app/**/*.test.mts' 'scripts/*.test.mts'
```

## CI

`.github/workflows/ci.yml` runs the full suite (`npm test`, i.e. full mode, `[slow]` included) on every pull request and every push to `main`, across a `macos-latest` / `windows-latest` / `ubuntu-latest` matrix, on Node 24 (the `engines` floor is `>=24`). It never sets `TEST_SKIP_ELECTRON` — the shell and UI smoke tests run for real on all three platforms rather than skipping, which on Linux means running the whole `npm test` invocation under `xvfb-run -a` so Electron has a virtual display to open a window on. Linux also gets a `sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0` step ahead of the test run: `ubuntu-latest`'s AppArmor policy blocks unprivileged user-namespace creation, which is exactly what Chromium's sandbox falls back to when Electron is installed via npm (no root-owned SUID `chrome-sandbox` helper, since npm can't set that bit) — without it the Linux job's Electron launch fails or crashes immediately, display or no display. That step relaxes only the ephemeral CI VM's own kernel policy for the life of the job and deliberately keeps Chromium's sandbox itself enabled (`ELECTRON_DISABLE_SANDBOX` and `--no-sandbox` are never set, anywhere — `scripts/packaging.test.mts` checks this directly, both in the workflow and in every shipped/test file), so CI proves the same sandboxed configuration a player runs, not a weakened one. The write is `|| true` so a future runner image that drops or renames the sysctl key can't fail the job outright, but a plain no-op would then leave the sandbox silently blocked with nothing in the log to explain a red Linux leg — so the step reads the value back afterward and emits a GitHub Actions `::warning::` annotation if the relaxation didn't actually take effect. A push to a pull request's branch runs once, through its `pull_request` run (a `push` trigger on every branch used to run the whole matrix a second time), and a newer push to the same pull request cancels the run it supersedes (`concurrency`, `cancel-in-progress` for pull requests only, so runs on `main` always finish). `npm ci --ignore-scripts` leaves Electron to download its binary the first time it is required, so a step fetches it once (`node -e "require('electron')"`) before the test files start several Electron launches in parallel. Ahead of the suite the same job runs `npm run typecheck` (`tsc` over `app/`, `electron/` and `scripts/`) and compiles every adapter's Python scripts (`python -m py_compile adapters/*/packrat-*.py`, on Python 3.12), a second offline check beyond the adapters' own `test_*.py` files. Each OS's `test_logs/latest_summary.json` is uploaded as a build artifact (`test-summary-<os>`) whether the job passes or fails, so a failure's detail is one click away instead of buried in console log.

`.github/workflows/release.yml` triggers on a `v*` tag push: one job creates a draft GitHub release, a build job runs `npm run dist` (`--publish never`) on the same three-OS matrix and keeps the unsigned installers as workflow artifacts, and a separate `publish` job uploads them with `SHA256SUMS` to the draft (`RELEASING.md` describes the split). `CSC_IDENTITY_AUTO_DISCOVERY: "false"` keeps electron-builder from groping for a local signing identity that isn't there; no Apple ID, certificate or notarization secret is configured, matching the spec's v1 decision to ship unsigned and document the "damaged app" / SmartScreen workarounds instead (`README.md`).

## Not under automated test

The game scripts run inside a live client, which no test has. Beyond the fake clients (`adapters/fake_clients.py`, driven by the adapters' `test_*.py` files) and `python -m py_compile`, this is what a live run has checked of the TazUO adapter (`packrat-scanner.py`, `packrat-character-refresh.py`, once `packrat-refresh.py`, and `packrat-bridge.py`):

| Version | What | Verified live |
|---|---|---|
| before 2.1.0 | The scanner, the refresh and the bridge, attended | yes |
| 2.1.0 | The input limits | no |
| 2.2.0 | Scan and refresh never recording an unread container; the bridge's chain-ownership check, heartbeat and non-blocking walk | no |
| 2.3.0 | Closing the container windows after a scan | no |
| 2.4.0 | The book and armour exclusions | no |
| 2.5.0 | The scan blacklist | no |
| 2.6.0 | The missing-queue handling, and Razor Enhanced's walk beside a container | no |
| 2.7.0 | The in-game panel (`packrat-panel.py`, `adapters/test_panel.py`) | partly: the maintainer ran it on build 26.0923.64 (buttons, hotkey, start at login), not yet starting hidden with `showAtLogin` off; `app/tazuo-panel.test.mts` covers the app's `lscript.json` edit in temp folders only |
| 2.8.0 | The trash-container skip (issue #74) | no |
| 2.9.0 | Root tooltips, the facet and the Organize trip action (issue #11) | no |
| 2.10.0 | The house capture (issue #10) | no |
| 2.11.0 | The house container list (issue #10) | no |
| 2.12.0 | The house map refresh and the character refresh rename (issue #10) | no |
| 2.15.0 | The bridge closing the container windows it opened (issue #196) | no |

Open for the house capture's live check: whether a scan taken aboard a boat writes a `house` section from the boat's own tiles (the app keeps a capture past the retention window only while a ground chest of the inventory stands on its footprint, so such a capture ages out with its scan, but the scanner itself has no boat signal yet). The scripts require TazUO v26.0923.64 or later. Which Legion build defines `__file__` is unverified too, which is why `data_dir()` falls back to `API.ScriptPath`. `python3 -m py_compile <file>` is the only offline check of a script outside the fake clients.

The Razor Enhanced adapter (`adapters/razor-enhanced/packrat-scanner.py`, `packrat-character-refresh.py`, `packrat-blacklist.py`, `packrat-bridge.py`) is unverified against a live client entirely — see that adapter's README "Status" section — and gets the same checks and nothing more; its `fixture.scan.json` comes from the fake client, not a live run. The ClassicUO web client adapter (`adapters/classicuo-web/packrat-scanner.ts`) has likewise never run against a live client; `app/classicuo-web-adapter.test.mts` checks its declared shape and its `capabilities`/paste-marker constants against the real source and runs it against faked sandbox globals, but not real client behavior — there is no TypeScript compiler check in CI for it today, only Node's native type-stripping when a script imports it directly.

## Requirements

Node ≥ 24 on PATH. `app/adapters.test.mts` probes for `python3` first, then `python`, and uses whichever reports `Python 3` — needed for the adapters' own `test_*.py` files, which run as `[fast]` cases (so: fast and full mode). To run that one file directly with warnings promoted to errors (the stricter check the gate before a phase closes uses): `python3 -W error adapters/tazuo/test_paths.py`. Full mode also needs `electron` installed (`npm i`, it's a `devDependencies` entry) for `scripts/shell-smoke.test.mts`, and `electron` plus `playwright` for `scripts/ui-smoke.test.mts`; without either dependency, or with `TEST_SKIP_ELECTRON=1`, that test is skipped rather than failed.
