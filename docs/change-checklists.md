# Change checklists

What else must change when you change one thing. Each heading is a kind of change; under it are the places that kind of change has had to touch, taken from real commits (listed as worked examples, so `git show <hash> --stat` shows one done in full). `docs/module-map.md` says what each module owns.

Walk the list for each kind your change is, and say in the pull request which kinds you walked. Not every item applies every time; skip one only after checking it.

## Always

- `CHANGELOG.md`: one line under Unreleased when the change matters to a player or a contributor, in the file's style.
- Tests next to every module you touched, each test name tagged `[smoke]`, `[fast]` or `[slow]`. Every test file opens with a header saying what it covers (`TESTING.md`); after adding one or changing a header's first sentence, run `npm run gen:test-index`.
- `npm run typecheck`, then `./scripts/test_runner.sh --changed` and `--fast` (`TESTING.md`).
- `docs/module-map.md` when you add, move, delete or rename a module, or move a concept from one module to another.
- The docs for the area you changed (the one `docs/` file, an adapter README, `README.md` for what players see). Below, `docs/ui.md` means the core page or the screen's own page under `docs/ui/`, whichever holds what changed.

## Add or change a gear slot

Examples: `d3bbb2e` (#202 part A), `532b7cc` (#202 part B), `4982888`.

1. The slot table first: put the slot in its group in `GEAR_SLOT_GROUPS` in `app/vault-lib.mts` (the sheet's tiles, the item browser's slot filter and the meditation slot set follow from it). Then the classifier there: `LAYER_TO_SLOT` (which gives `GEAR_SLOTS`), `REQUIRED_SLOTS`, `SLOT_LABELS`, `JEWEL_SLOTS`, and `ARMOR_SLOT_SET` if the slot's material should not count for meditation; the wearable-graphic table, regenerated with `scripts/gen-graphic-layers.mts`.
2. Solvers: the slot lists in `scripts/optimizer-core.mts` (`optDefaultSlots`, `optDefaultOptionalSlots`); `app/mip.mts` (derived from `GEAR_SLOTS`, check it still is); `app/buffs.mts`; `app/runs-lib.mts` (saved runs that name the old slot); `app/bench/make-fixtures.mts`, `app/bench/run-bench.mts`.
3. UI: `MANUAL_GROUPS` in `app/ui/manual-model.mts` (a layout, so place the slot by hand); check `SLOT_GROUPS` in `app/ui/sheet.mts` still reads well with the new slot; `app/ui/builder-manual.mts`, `app/ui/builder-model.mts`, `app/ui/builder-result.mts`, `app/ui/builder.mts`, `app/ui/runs.mts`, `app/ui/builder.css`.
4. Organize: the Armor and Jewelry groups in `app/organize-strategies.mts` (kept by hand: they move real items); the slot presets in `app/organize-presets.mts`.
5. MCP: `build_suit`'s `pinned` description in `app/mcp-tools.mts` (it lists `GEAR_SLOTS`; check the wording still fits).
6. Tests: `app/slot-groups.test.mts`, `scripts/slot-lists.test.mts` (its allow-list, if a hand-kept list changed size), `app/gear-vault.test.mts`, `app/manual-model.test.mts`, `app/manual-handoffs.test.mts`, `app/solver.test.mts`, `app/solver-fuzz.test.mts`, `app/solver-buffs-fuzz.test.mts`, `app/buffs-plan.test.mts`, `scripts/optimizer-core.test.mts`, `app/organize-strategies.test.mts`, `app/server-builder.test.mts`, `app/server-host.test.mts`, `app/ui-render.test.mts`, `scripts/ui-builder.test.mts`; the fixture `app/solver-fixture.mts`.
7. Docs: `docs/solver.md`, `docs/ui.md`, `docs/scan-schema.md`, `docs/architecture.md` (the data model and the classification gotchas).
8. If adapters start recording the layer, this is also a scan-format change (below).

## Add an item kind or change classification

Examples: `ee9da51`, `97c6363`.

1. `app/vault-lib.mts` (`KINDS`, `kindOf`, `OVERRIDE_KINDS`), `app/item-kinds.mts` (the player's overrides, `<data>/item-kinds.json`).
2. Organize: `app/organize-config.mts`, `app/organize-strategies.mts`, `app/organize.mts`, `app/ui/rule-editor.mts`.
3. UI: `app/ui/kinds.mts`, `app/ui/inventory.mts`, `app/ui/organize.mts`, `app/ui/settings.mts`, `app/ui/api-types.mts`.
4. Server: the routes in `app/http/routes/`. If a server module becomes page-visible, the browser-shared list (see Add an HTTP route).
5. MCP: `list_item_kinds` and the `kind` filter's description in `app/mcp-tools.mts`.
6. Tests: `app/slot-groups.test.mts`, `scripts/slot-lists.test.mts` (its allow-list, if a hand-kept list changed size), `app/gear-vault.test.mts`, `app/item-kinds.test.mts`, `app/organize-config.test.mts`, `app/organize-strategies.test.mts`, `app/organize-server.test.mts`, `app/server-inventory.test.mts`, `scripts/ui-organize.test.mts`.
7. Docs: `README.md` (kinds are player-visible), `docs/architecture.md` (data folder, classification gotchas), `docs/ui.md`.

## Add an item property or property filter

Examples: `1486452`, `826f586`.

1. Parsing: `PROP_PATTERNS`, `PROP_LABELS` and `PROP_FULL` in `app/vault-lib.mts`; the shard caps in `app/rules/uoalive.json` and `app/rules/generic-osi.json` if it is capped.
2. Query: `app/item-query.mts` (and `EXTRA_COLS` if it is a column); the property rules in `app/organize-config.mts`; `app/organize-fixture.mts`.
3. UI: `app/ui/inv-model.mts`, `app/ui/inventory.mts`, `app/ui/organize-model.mts`, `app/ui/store.mts`, `app/ui/view-state.mts`; `SHEET_GROUPS` in `app/ui/sheet.mts` if the sheet shows it.
4. Solver: `toOptItem` and the optimizer keys if the builder can weight it; the profile schema if it gets a floor (see Add or change a profile field).
5. MCP: the keys `search_items` accepts in `app/mcp-tools.mts` (it reads the facets and `EXTRA_COLS`).
6. Tests: `app/item-query.test.mts`, `app/organize-config.test.mts`, `app/ui-inventory.test.mts`, `app/ui-organize.test.mts`, `app/ui-state.test.mts`, `scripts/ui-state.test.mts`, `app/server-inventory.test.mts`, `app/gear-vault.test.mts` (the real-tooltip corpus).
7. Docs: `docs/ui.md`.

## Add a buff, form or ability

Examples: `02b052e`, `e0b1eb0`.

1. Catalog and math: `app/buffs.mts`; `app/vault-lib.mts` (profile planning); `app/evaluate.mts` (`evaluateSuit`, what every screen and tool shows a suit with: change it there, not in a caller); `app/runs-lib.mts` (runs record the buffs used).
2. Server: the routes in `app/http/routes/`; `app/ui/api-types.mts`.
3. UI: `app/ui/builder-buffs.mts`, `app/ui/builder-manual.mts`, `app/ui/builder.mts`, `app/ui/builder-model.mts`, `app/ui/builder-result.mts`, `app/ui/manual-model.mts`, `app/ui/sheet.mts`, `app/ui/components.mts`, `app/ui/runs.mts`, `app/ui/app.mts`, `app/ui/builder.css`, `app/ui/tokens.css`.
4. MCP: `BUFF_LIST` in `app/mcp-tools.mts` (built from `BUFFS`; two tools send it).
5. Tests: `app/buffs.test.mts`, `app/buffs-plan.test.mts`, `app/evaluate.test.mts`, `app/solver-buffs-fuzz.test.mts`, `app/solver.test.mts`, `app/builder-model.test.mts`, `app/ui-components.test.mts`, `scripts/ui-builder.test.mts`, `scripts/ui-contrast.test.mts`.
6. Docs: `docs/solver.md`, `docs/shard-rules.md`, `docs/ui.md`, `README.md`, `PRIVACY.md` if what is stored changes.

## Add or change a BuildSpec field

Examples: `166eb05`, `d311bdb`, `f1eced4`.

1. Contract: the `BuildSpec` group it belongs to in `app/build-spec.mts` (the type, `buildSpec`'s defaults, `buildSpecError`, `specFromProfile`/`profileFromSpec`, and `planBuild` if a build reads it) and `app/schema/profiles.v3.schema.json` (types regenerate with `npm run build:types`); the built-in templates in `app/data/templates/<shard>.json` if they set it; `TEMPLATE_KEYS` in `app/vault-lib.mts` if templates carry it. A change to what an older file means needs a migration step in `migrateProfilesV3` and a golden file in `app/fixtures/profiles-v2/`.
2. Logic: `app/vault-lib.mts` (templates, `settingsDiff`); `app/evaluate.mts` if a suit's totals or requirements read it; `app/runs-lib.mts` (run identity and instant repeats: bump `SOLVER_VERSION` if results change); `app/run-settings.mts` (`runSettingsError`, the one check `POST /api/optimize`, `POST /api/runs` and `POST /api/evaluate` hold a run's settings to, `RUN_SETTING_LIMITS`, `OPTS_LIMITS` and `RUN_DEFAULTS`); `app/bench/mip-spike.mts`, `app/bench/run-bench.mts`.
3. UI: `app/ui/builder-model.mts`, `app/ui/builder.mts`, `app/ui/builder-result.mts`, `app/ui/runs.mts` (`settingsSnapshot`), `app/ui/sheet.mts`, `app/ui/components.mts`, `app/ui/builder.css`.
4. MCP: the `build_suit` and `score_suit` arguments in `app/mcp-tools.mts` if a model should set it.
5. Tests: `app/builder-model.test.mts`, `app/gear-vault.test.mts`, `app/server-builder.test.mts`, `app/solver.test.mts`, `app/ui-render.test.mts`, `scripts/ui-builder.test.mts`, `scripts/ui-contrast.test.mts`, `scripts/ui-state.test.mts`.
6. Docs: `docs/ui.md`, `docs/solver.md`, `docs/shard-rules.md` (cap overrides), `README.md`.

## Add an HTTP route

Examples: `e6288f2`, `5416327`, `97c6363`.

1. The route module in `app/http/routes/` for its area (a new area gets a new module, added to the route table in `app/vault-server.mts`): an entry `{ method, path, handle }` (`app/http/router.mts`; `path` a string or a RegExp, and `handle` answers `NEXT` to pass a request on), the body read through `readBody` with a size cap, `asObject` (`app/http/respond.mts`) and a check of every field (`app/guards.mts`), anything new the handler needs added to `ServerContext` (`app/http/context.mts`), and the route in `docs/architecture.md`'s HTTP routes. A route that reads or writes a data file goes through that file's store in `app/store/`; a new data file gets its own store there, built on `app/store/json-file.mts`.
2. The matching server test: the route family's `app/server-<family>.test.mts` (settings, setup, inventory, builder, import, host; `app/server.test.mts` for what every route shares), `app/organize-server.test.mts`, `app/house-server.test.mts` or `app/mcp.test.mts`.
3. `app/ui/api-types.mts` (the response shape, by hand: no test compares it with the server) and the caller (`app/ui/app.mts`, `app/ui/store.mts` or the view).
4. If the page needs a server module at run time: `tsconfig.browser.json`'s `include`, a static route in `app/http/routes/static.mts`, the list in the header comment of `scripts/build-ui.mts`, and `docs/architecture.md`'s HTTP routes.
5. `docs/architecture.md` (the data folder, if it writes a file), `docs/threat-model.md` (a new boundary), `PRIVACY.md` (if it stores or forgets player data).
6. `app/mcp-tools.mts` if a model should reach it.

## Change the scan format

Examples: `2b30944`, `9b03dcc`, `219861a`.

1. Contract: `app/schema/scan.v2.schema.json` and the inline copy in `app/scan-schema.mts` together (a test keeps them equal), the upgrade and checks in `app/scan-schema.mts`, the generated types (`scripts/build-schema-types.mts`).
2. Every adapter: `adapters/tazuo/packrat-scanner.py`, `adapters/tazuo/packrat-character-refresh.py`, `adapters/tazuo/packrat-house-map-refresh.py`, `adapters/tazuo/packrat-bridge.py`, `adapters/tazuo/packrat-panel.py`; `adapters/razor-enhanced/packrat-scanner.py`, `adapters/razor-enhanced/packrat-character-refresh.py`, `adapters/razor-enhanced/packrat-bridge.py`; `adapters/classicuo-web/packrat-scanner.ts`; each `capabilities.json`; a version bump per adapter (`docs/adapter-guide.md`, Versions). A helper inside a `# BEGIN generated:` block is edited once, in its `adapters/_shared/` fragment, then `npm run gen:contracts`.
3. Fixtures and fakes: `adapters/tazuo/fixture.scan.json`, `scripts/make-adapter-fixture.mts`, `adapters/fake_clients.py`, `adapters/test_scanners.py`, `adapters/tazuo/test_paths.py`.
4. Fold and consumers: `app/vault-lib.mts`, `app/retention.mts`, `app/house-capture.mts`, `app/item-query.mts`; `app/ui/inv-model.mts`, `app/ui/inventory.mts`, `app/ui/sheet.mts`, `app/ui/store.mts`, `app/ui/view-state.mts`.
5. Tests: `app/scan-schema.test.mts`, `app/contracts.test.mts`, `app/classicuo-web-adapter.test.mts`, `app/gear-vault.test.mts`, `app/house-capture.test.mts`, `app/house-model.test.mts`, `app/house-server.test.mts`, `app/ui-state.test.mts`, `scripts/ui-state.test.mts`.
6. Docs: `docs/scan-schema.md`, `docs/adapter-guide.md`, `docs/bridge-protocol.md`, each adapter `README.md`, the version table under `TESTING.md`'s "Not under automated test".

## Add or change a bridge command

Examples: `23fb19e`, `a86c64d`, `28a38de`.

1. Contract: `app/schema/bridge.v1.schema.json` and `app/schema/bridge-trip.v1.schema.json`; `scripts/build-schema-types.mts` if the generator needs a new shape.
2. Server: `app/bridge-trip.mts`, `app/bridge-contract.mts` (`TRIP_MAX_BYTES` and `TRIP_NAME_MAX`, which mirror the bridges' `MAX_LINE_BYTES` and `MAX_TRIP_NAME`), `app/config.mts` (paths), `app/http/routes/bridge.mts` (the queue route), `app/organize-state.mts` if the result changes where the app believes items are.
3. Both bridge scripts: `adapters/tazuo/packrat-bridge.py` and `adapters/razor-enhanced/packrat-bridge.py` (a check in the untrusted-input block is edited once, in `adapters/_shared/untrusted_input.py`, then `npm run gen:contracts`); each `capabilities.json` (`actions`); `adapters/tazuo/README.md`; a version bump per adapter.
4. Fakes and tests: `adapters/fake_clients.py`, `adapters/test_bridges.py`, `adapters/test_adapters.py`, `app/adapters.test.mts`, `app/contracts.test.mts`, `app/bridge-trip.test.mts`.
5. UI: `app/ui/bridge.mts` (labels, toasts), `app/ui/api-types.mts`; `BRIDGE_ACTION_LABELS` and `bridgeRefusal` in `app/vault-lib.mts`.
6. MCP: the `bridgeTool(...)` entries and `get_action_status` in `app/mcp-tools.mts`.
7. Docs: `docs/bridge-protocol.md`, `docs/threat-model.md`, `docs/adapter-guide.md`.

## Add a UI screen or view

Examples: `c1bb797` (Organize), `e378aff` (Scrolls), `43225d1` (a view inside House map).

1. `app/index.html`, `app/ui/nav.mts` (the route; the screen registers its `show` there), `app/ui/app.mts` (screen switching), the screen module and its pure model (`app/ui/<view>.mts`, `app/ui/<view>-model.mts`) and stylesheet, `app/ui/store.mts`, `app/ui/components.mts` for any new shared piece.
2. Server routes and `app/ui/api-types.mts` (see Add an HTTP route).
3. Tests: a DOM-free `app/ui-<view>.test.mts` for the model, an Electron `scripts/ui-<view>.test.mts`, a fixture if it needs data (`scripts/scrolls-fixture.mts` is the pattern), `scripts/ui-contrast.test.mts` for new CSS; add the stems to `SCREENS` in `scripts/select-tests.mts` so `--changed` finds the Electron test.
4. Docs: a new `docs/ui/<screen>.md` linked from `docs/ui.md`'s screen tables, `README.md`.

## Add a shard rule

Examples: `4891d48`, `e378aff`, `6845f06`.

1. `app/rules/uoalive.json` and `app/rules/generic-osi.json`; `app/schema/rules.v1.schema.json`; `app/rules.mts` (a check the schema cannot express).
2. The consumer: for example `app/ui/inv-model.mts`, `app/ui/inventory.mts`, `app/ui/scrolls-model.mts`, or the solver caps.
3. Tests: `app/rules.test.mts`, the consumer's model test, `scripts/ui-state.test.mts`.
4. Docs: `docs/shard-rules.md`, `docs/ui.md`. A number not yet confirmed in game goes on the verify-in-game issue (#207).
