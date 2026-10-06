# Module map

Where each concept lives, area by area. Each table row is one module: its path, what it does, and the names it owns (the one place that name is defined). When you add, move or delete a module, update this file in the same change: `scripts/module-map.test.mts` fails when a tracked `.mts` file under `app/`, `scripts/` or `electron/` is missing here, or when a path named here no longer exists.

`docs/change-checklists.md` says which of these modules a given kind of change touches. `docs/architecture.md` has the processes and the data folder; `docs/ui.md` the page's design rules.

Three files keep names from before the project became Pack Rat: `app/vault-server.mts`, `app/vault-lib.mts` and `app/gear-vault.test.mts`. Nothing else about them is legacy, and there is no plan to rename them.

## Scan & fold

| Module | Role | Owns |
|---|---|---|
| `app/scan-schema.mts` | The scan v2 schema inline (deep-equal to the JSON copy, a test checks), the v1→v2 upgrade on read, scan ordering by time. Browser-safe. | `SCAN_V2_SCHEMA`, `TAZUO_V1_CAPS`, `validateScan`, `upgradeScan`, `parseStamp`, `isRealStamp`, `isPseudoCharacter` |
| `app/schema/scan.v2.schema.json` | The scan contract as JSON Schema (`docs/scan-schema.md`). | the scan shape |
| `app/schema/validate.mts` | The hand-written JSON Schema subset validator every schema here is checked with. Browser-safe. | `validate`, the supported keyword subset |
| `app/paste-scan.mts` | Finds, parses, upgrades and validates a pasted scan. Browser-safe, so the Import drawer's preview and `POST /api/import/paste` apply one rule. | `parsePastedScan`, `PASTE_BEGIN`/`PASTE_END`, `jsonErrorReason` |
| `app/import.mts` | Writes a pasted or rescanned scan into an adapter's inbox for the watcher. | `writeScanToInbox` |
| `app/watcher.mts` | The inbox watcher: one per adapter, `fs.watch` with a 300 ms debounce, retry then quarantine to `<data>/inbox/<adapter>/rejected/`, normalize-then-move into `<data>/scans/`. A symlink, directory or device, or a file over `MAX_INBOX_BYTES` (32 MiB), is refused unread; idempotent, never throws. | `startWatcher`, `ingestFile`, `acceptedName` (the one place scan text becomes a file name), `MAX_INBOX_BYTES` |
| `app/vault-lib.mts` | The shared kernel, page and server alike. Its scan side: the inventory types, the tooltip parser and the fold (a scan replaces everything under each root it lists). Its other parts are listed under the areas below. | `Item`, `Container`, `Character`, `Inventory`, `ScanSummary`, `parseTooltip`, `foldSnapshots`, `locationOf`, `containerPath`, `capacityOf`, `TRASH_RE`, `groupByName`, `slayersOf`, `medableOf` |
| `app/missing.mts` | Missing since last scan: what a root's previous scan saw that is nowhere in the fold now. | `missingSinceLastScan`, `MissingItem` |
| `app/retention.mts` | Which old scans and saved runs may be pruned (the fold must not change). Pure; the server deletes what it names. | `scansToPrune`, `runsToPrune`, `RETENTION_DEFAULTS`, `RETENTION_LIMITS`, `retentionOf` |
| `app/fixtures/demo-Dorran.json`, `app/fixtures/demo-Kestrel.json` | Synthetic scans for tests and `--demo` (`app/fixtures/README.md`). | the demo characters |

## Kinds & classification

| Module | Role | Owns |
|---|---|---|
| `app/vault-lib.mts` (classifier part) | Which slot a piece goes in (the worn layer, then the graphic's tiledata layer, then name rules) and which kind every item is. | `LAYER_TO_SLOT`, `GEAR_SLOTS`, `GEAR_SLOT_GROUPS`, `SLOT_GROUP`, `SLOTS_IN_GROUP`, `REQUIRED_SLOTS`, `SLOT_LABELS`, `NECK_ARMOR_WORDS`, `isNeckArmor`, `classify`, `layerOfGraphic`, the wearable-graphic table, `spellSchoolOf`, `KINDS`, `OVERRIDE_KINDS`, `kindOf`, `overriddenKind`, `INSTRUMENTS` |
| `app/item-kinds.mts` | The player's own item kinds, `<data>/item-kinds.json`: checks, merges and resets the document. Pure. An entry this version does not know is left out and named, never an error; the server folds again when the file changes, and refuses a change past `MAX_KINDS_BYTES` with a 409. | `salvageKindOverrides`, `withKinds`, `withoutKinds`, `kindsDocument`, `MAX_KINDS_BYTES` |
| `scripts/gen-graphic-layers.mts` | Regenerates the wearable-graphic table in `app/vault-lib.mts` from a client's tiledata.mul. | `wearableLayers`, `spliceTable` |

## Item query

| Module | Role | Owns |
|---|---|---|
| `app/item-query.mts` | Pure item filtering, sorting, paging and facets, shared by `GET /api/items` and the page. | `parseItemQuery`, `matchesItem`, `applyItemQuery`, `facetsOf`, `ItemQuery`, `RuleQuery`, `EXTRA_COLS`, `colVal`, `rarityRank`, `HIT_LIMIT` |
| `app/vault-lib.mts` (property part) | The property keys a tooltip line becomes, their labels and the search blobs. | `PROPERTIES`, `PropKey`, `PROP_PATTERNS`, `PROP_LABELS`, `PROP_FULL`, `NOT_BUILDER_KEYS`, `SKILL_NAMES`, `RESIST_META`, `RESIST_KEYS`, `labelOf`, `fullOf`, `propertyKeys`, `extraKeys`, `flagKeys`, `itemSearchBlob` |

## Shard rules

| Module | Role | Owns |
|---|---|---|
| `app/rules.mts` | Node-only loader: a rules file from `<data>/rules/` or the builtin set, validated before anything sees it. | `loadRules`, `listRules`, `DEFAULT_SHARD`, `scrollBinderProblem`, `slayerGroupsProblem` |
| `app/rules/uoalive.json`, `app/rules/generic-osi.json` | The builtin shard rules files (`docs/shard-rules.md`). | caps, `raceCaps`, `resistSkillBonus`, `tagUnits`, `rarity`, `raceLock`, `freeSkills`, `scrollBinder`, `slayerGroups` |
| `app/schema/rules.v1.schema.json` | The contract every rules file is checked against. | the rules shape |
| `app/vault-lib.mts` (rules part) | Holds the loaded rules for page and server, and the rules-driven math. | `setRules`, `getRules`, `resistSkillBonus`, `shardResistCap`, `tagUnits`, `tagInfo` |

## Suit Builder

Profiles, buffs, pools, solvers, saved runs and Manual. `docs/solver.md` describes the model.

| Module | Role | Owns |
|---|---|---|
| `app/vault-lib.mts` (builder part) | Profiles and templates, the effective profile the solvers see, pools, weapons, run settings and requirement reports. | `Profile`, `EffectiveProfile`, `effectiveProfile`, `RESIST_CAP_LIMITS`, `resistCapsFor`, `TEMPLATE_KEYS`, `templateFrom`, `migrateProfiles`, `characterProfile`, `OptItem`, `toOptItem`, `buildPools`, `WEAPON_SKILLS`, `MELEE_SKILLS`, `RunSettings`, `settingsDiff`, `totalsOf`, `requirementReport` |
| `app/data/profiles.default.json` | Default profiles and templates, copied to `<data>/profiles.json` on first run and migrated on read. `schemaVersion: 2`: no `caps` key, since caps are shard rules. | the shipped templates |
| `app/schema/profiles.v2.schema.json` | The contract `PUT /api/profiles` checks a body against. | the profiles shape |
| `app/buffs.mts` | Buffs, forms and abilities as data, and their effect on a suit and on the planned profile. Page and server alike. | `BUFFS`, `BUFF_INPUTS`, `BUFF_GROUPS`, `applyBuffs`, `buffPlanOf`, `manualProfile`, `plannedProfile`, `planBuffs`, `isBuffList`, `normalizeBuffs`, `isRunBuffs`, `savedBuffs` |
| `scripts/optimizer-core.mts` | The heuristic suit search and scoring. Paste-able: no imports, one export line; loaded from source by the path `corePath()` resolves. | `optimizeSuit`, `scoreSet`, `optDefaultSlots`, `optDefaultOptionalSlots`, `optDominancePrune` |
| `app/mip.mts` | The suit problem as a mixed-integer program (HiGHS sparse arrays). Pure. | `buildSuitMip`, `startVector`, `pickedOf`, `noGoodRow`, `HARD_FLOOR_BONUS`, `DEFAULT_SLOTS`, `optionalSlotsFor` |
| `app/mip-solve.mts` | The HiGHS runtime: load, solve, add a no-good cut, close. | `loadHighs`, `openModel`, `solveModel`, `addNoGood`, `closeModel`, `gapFromEvents` |
| `app/exact-solver.mts` | One exact solve: the core's heuristic for an incumbent, then HiGHS for the proof, alternatives and the floors-conflict retry. | `solveExact` |
| `app/optimize-worker.mts` | Worker thread that runs one optimize job off the main thread: the core's heuristic, or the exact orchestrator, falling back to the core when HiGHS does not load. One worker per job; cancel terminates it. | the worker message types |
| `app/runs-lib.mts` | Saved runs: the cache key (pools, worn suit, scoring profile and options, minus budget and warm start), the reuse rule (proven, heuristic, or a budget already as large; never a fallback result), the list summary, a manual run, and the one constructor of a saved run's document. Node-only (`node:crypto`). Bump `SOLVER_VERSION` on any change to the model, the orchestration or the core's scoring. | `SOLVER_VERSION`, `runKey`, `reusableRun`, `runSummary`, `manualRun`, `runRecord`, `normalizeRun` |
| `app/run-settings.mts` | A run's settings: the one check `POST /api/optimize` (`settings`, `meta.settings`) and `POST /api/runs` hold them to, the search knobs' ranges the page's Advanced fields share, and the defaults. Pure, page and server alike. | `runSettingsError`, `RUN_SETTING_LIMITS`, `OPTS_LIMITS`, `RUN_DEFAULTS`, `defaultStrLimit` |
| `app/runs-types.mts` | A saved run and its list summary, and the `/api/runs` response bodies. Types only, no imports: `app/runs-lib.mts` re-exports them, the routes `satisfies` them, and the page narrows them in `app/ui/api-types.mts`. | `SavedRun`, `RunSummary`, `RunResult`, `RunSettingsRaw`, `RunsListBody`, `RunBody` |
| `app/solver-fixture.mts` | Test fixture: the adapter fixture folded and pooled, and `runBoth` to check HiGHS against the core. | `cell`, `runBoth`, `fuzzSlots` |
| `app/bench/gen-inventory.mts` | Synthetic scan generator learned from real gear, for the scale benchmark. | `learnModel`, `generateScan` |
| `app/bench/run-bench.mts` | The scale benchmark sweep through `app/optimize-worker.mts`. | — |
| `app/bench/make-fixtures.mts` | Regenerates the demo fixtures from the generator's model (needs real scans). | — |
| `app/bench/mip-spike.mts` | The HiGHS spike, superseded by `app/mip.mts`; kept as evidence for `app/bench/REPORT.md`. | — |
| `app/ui/builder.mts` | The Suit Builder screen: the panel, the optimize job over SSE, the empty state. | `initBuilder`, `selectCharacter`, `readControls`, `followJob`, `cancelJob` |
| `app/ui/builder-result.mts` | The result beside the panel and the compare view. | `renderResult`, `renderCurrentSuit`, `openRunCompare` |
| `app/ui/builder-manual.mts` | Manual mode: slot cards, picker, totals, undo, Fill the rest, Save as run; the builder's ui-prefs. | `renderManual`, `openInManual`, `applyBuilderPrefs`, `savePrefs`, `buffInputsOf`, `editBuffInputs` |
| `app/ui/builder-buffs.mts` | The buff chips, Manual's Buffs row and the buff picker. | `buffChip`, `createBuffPicker` |
| `app/ui/builder-model.mts` | Pure: summaries, Advanced-field checks, resist-cap lines, badges, compare rows, run labels. | `KNOB_RANGES`, `compareModel`, `runAutoLabel` |
| `app/ui/manual-model.mts` | Pure: Manual's totals keys, slot groups, hand rule, deltas, undo history, hand-offs. | `TOTAL_KEYS`, `STAT_KEYS`, `MANUAL_GROUPS`, `handConflict`, `slotDelta`, `fillableSlots` |
| `app/ui/runs.mts` | The Saved runs drawer, and the settings snapshot a run is saved with. | `settingsSnapshot`, `applySettings`, `openRunsDrawer` |

## Organize

| Module | Role | Owns |
|---|---|---|
| `app/organize-config.mts` | Organize's saved setup, `<data>/organize.json`: labels, ordered rules, catch-all, pinned items. Pure. | `OrganizeConfig`, `checkOrganizeConfig`, `salvageOrganizeConfig`, `ruleMatchOf`, `CATCH_ALL_ID`, `EMPTY_BAGS_ID`, `BUILDS`, `SCHOOLS`, `LIMITS` |
| `app/organize.mts` | The planner: which item goes where, in which trip, and what does not fit. Pure and deterministic. | `planOrganize`, `tripCommand`, `scopeOf`, `claimOf`, `buildOf`, `CASTER_PROPS`, `MELEE_PROPS`, `TRIP_DEFAULTS` |
| `app/organize-presets.mts` | Ready-made rule filters. | `PRESETS`, `ruleFromPreset` |
| `app/organize-strategies.mts` | Auto organize: the Simple, Detailed and By build strategies and the proposal. | `STRATEGIES`, `groupItems`, `assignGroups`, `proposeOrganize` |
| `app/organize-types.mts` | The plan's and the proposal's shapes, and the `GET /api/organize/plan` and `POST /api/organize/propose` responses. Types only, importing only `app/organize-config.mts`'s types: `app/organize.mts` and `app/organize-strategies.mts` re-export them, the routes `satisfies` them, and `app/ui/api-types.mts` re-exports them. | `Plan`, `PlanMove`, `PlanTrip`, `PlanWarning`, `WarningKind`, `RuleReport`, `RoomReport`, `Carried`, `EmptyBag`, `Proposal`, `ProposeResult`, `StrategyId`, `Family`, `Candidate`, `GroupReport`, `Layout`, `OrganizePlanApiResponse`, `OrganizeProposeApiResponse` |
| `app/organize-state.mts` | The results overlay, `<data>/organize-state.json`: pending trips and grabs, confirmed moves. | `OrganizeState`, `harvestTrips`, `addGrab`, `pruneOverlay`, `noteSeen` |
| `app/put-away.mts` | Put away: the panel's request file checked field by field, and the reply's words. | `PUT_AWAY_REQUEST`, `PUT_AWAY_REPLY`, `checkPutAwayRequest` |
| `app/organize-fixture.mts` | Test fixture: hand-built house scans for the Organize tests. | `houseScan` |
| `app/ui/organize.mts` | The Organize screen: the Rules card and the Plan card with Run trip / Run all / Stop. | `showOrganize` |
| `app/ui/organize-model.mts` | Pure: setup edits, the screen's words, trip watching, proposal text. | `LABEL_COLOURS`, `targetView`, `tripRows`, `stepWatch`, `acceptGate` |
| `app/ui/organize-data.mts` | The page's copy of the setup: load, save whole, presets, live match count. | `loadOrganize`, `saveConfig`, `matchCount` |
| `app/ui/rule-editor.mts` | The rule editor drawer. | `openRuleEditor` |
| `app/ui/auto-organize.mts` | The Auto organize drawer. | `openAutoOrganize` |

## Bridge & trips

| Module | Role | Owns |
|---|---|---|
| `app/schema/bridge.v1.schema.json` | The bridge protocol: command, result and status (`docs/bridge-protocol.md`). | the bridge shapes |
| `app/schema/bridge-trip.v1.schema.json` | An Organize trip line. | the trip shape |
| `app/bridge-trip.mts` | The only writer of a trip line, and the Stop flag. | `queueTrip`, `writeBridgeStop` |
| `app/bridge-contract.mts` | The limits every game bridge script enforces on a trip, as plain constants with no I/O, so the Organize planner needn't load the trip writer. | `TRIP_MAX_BYTES`, `TRIP_NAME_MAX` |
| `app/vault-lib.mts` (bridge part) | The chain a command opens and why an action cannot run, in the buttons' and the MCP tools' words. | `containerChain`, `bridgeRefusal`, `BRIDGE_ACTION_LABELS`, `BRIDGE_OFFLINE` |
| `app/ui/bridge.mts` | Highlight / Grab / Go to, Grab all, and the bridge status polling. | `sendBridge`, `runBridgeAction`, `grabAll`, `pollBridge`, `bridgeActionReason` |

## House map & client files

| Module | Role | Owns |
|---|---|---|
| `app/tiledata.mts` | Reads the client's tiledata.mul and classifies tiles. | `readTileData`, `classify` (tiles), `FLAG`, `uoFolderFromTazuo`, `loadTileData` |
| `app/facet-map.mts` | Decodes a facetNN.mul world-map overview and renders a region. Pure. | `decodeFacet`, `renderRegion`, `MAX_SIDE` |
| `app/png.mts` | A minimal PNG encoder for the facet image. | `encodePng`, `crc32` |
| `app/house-capture.mts` | The houses the scans captured: ids and the newest tiles with furniture merged. | `houseIdOf`, `latestHouses`, `houseGroups`, `HOUSE_ITEM_REACH` |
| `app/house-model.mts` | A house as the map draws it: levels, cells, rooms, furniture, stacks, spots. Pure. | `buildHouseModel`, `plotBounds` |
| `app/house-model-types.mts` | The house model's shapes and the `GET /api/houses` responses. Types only, no imports: `app/house-model.mts` re-exports them, the routes `satisfies` them, and `app/ui/api-types.mts` re-exports them. | `HouseModel`, `Level`, `Cell`, `Furniture`, `Stack`, `Spot`, `HouseSummary`, `HousesApiResponse`, `HouseApiResponse` |
| `app/house-names.mts` | `<data>/house-map.json`: house names and drawn areas, with its own reads and saves. A file that does not parse is moved aside as `.corrupt`; a save that would grow the map past 500 names or 1 MB is refused (the route answers 409). | `checkHouseEntry`, `readHouseMap`, `saveHouseEntry`, `NAME_MAX`, `MAX_AREAS`, `AREA_COLORS` |
| `app/house-fixture.mts`, `app/tiledata-fixture.mts`, `app/facet-fixture.mts` | Test fixtures: synthetic houses, tiledata and facet files. | `syntheticTileData`, `syntheticFacet` |
| `app/ui/house-map.mts` | The House map screen: SVG levels, callouts, cut-away, pan and zoom, the detail panel. | `showMap`, `applyMapPrefs` |
| `app/ui/house-map-model.mts` | Pure: projection, painter's order, fit, container joins with the inventory, color modes, callouts, totals, house picker. | `project`, `paintOrder`, `chestViews`, `pickHouse` |
| `app/ui/house-links.mts` | Which house holds each container, for "Show on map". | `houseOfContainer`, `houseOfItem`, `showOnMap` |
| `app/ui/world-map.mts` | The world map lightbox. | `openWorldMap` |
| `app/ui/world-map-model.mts` | Pure: the lightbox's zoom and pan. | `MAX_PX_PER_TILE`, `zoomView`, `panView` |

## Scrolls

| Module | Role | Owns |
|---|---|---|
| `app/ui/scrolls.mts` | The Inventory's Scrolls view: power scrolls and Scrolls of Transcendence per skill. | `showScrolls` |
| `app/ui/scrolls-model.mts` | Pure: counts, roll-ups against the shard's Scroll Binder recipes, the binder plan. | `powerRows`, `sotPlan`, `bindEverything` |
| `scripts/scrolls-fixture.mts` | The demo scans with extra scrolls, for the Electron test. | `writeScrollScans` |

The recipes are the shard rules' `scrollBinder` (Shard rules, above).

## MCP

| Module | Role | Owns |
|---|---|---|
| `app/mcp.mts` | The built-in MCP server: a second loopback listener, its guards, the JSON-RPC subset, `<data>/mcp.json` (`docs/mcp.md`). | `createMcp`, `readMcpConfig`, `writeMcpConfig`, `PROTOCOL_VERSIONS`, `MCP_DEFAULT_PORT` |
| `app/mcp-tools.mts` | The tools, one table entry each, calling the app's own routes over loopback; where the page computes before a route, a tool calls the same shared function. Tools that wait stop at 45 s by default, 50 at most. | `TOOLS`, `INSTRUCTIONS`, `ToolContext` |

## Server

| Module | Role | Owns |
|---|---|---|
| `app/vault-server.mts` | The local HTTP server and its composition root. `startServer(config)` returns `{ server, port, url, close() }` and nothing runs at import time; it builds the stores, services and route table, runs the Host, Origin and token checks, dispatches, maps errors to statuses, listens, and `close()` tears down every timer, stream and worker. Every HTML response carries the Content-Security-Policy, every response sent through `send()` carries `nosniff`, `no-store` and `DENY` framing, and a body-reading `PUT`/`POST` must declare JSON; `headersTimeout` is 60 s and `requestTimeout` 300 s, with only the idle-socket timeout off so an SSE stream survives (`CONTRIBUTING.md`, Security). | `startServer`, `defaultClientSearch`, `ServerHandle`, `StartServerOptions`; re-exports `OPTS_LIMITS`, `HostBridge`, `ClientSearch`, `JobTimings` |
| `app/read-body.mts` | A request's JSON body under a byte cap, shared with the MCP listener. | `readBody`, `HttpError`, `isJsonContentType` |
| `app/config.mts` | Every path, the port and the token, from flags then environment then defaults; creates the data folder's directories. | `resolveConfig`, `ensureLayout`, `corePath`, `DATA_DIR_MODE`, `DATA_FILE_MODE`, `DEFAULT_PORT` |
| `app/data-dir-notice.mts` | The sentence that says the client's scripts write to another data folder. Browser-safe, so the server's startup log and the page (`app/ui/messages.mts` re-exports it) share one sentence. | `dataDirNotice`, `DataDirCheckInfo` |
| `app/atomic-write.mts` | The one way this app replaces a file. | `atomicReplace`, `writeFileAtomic`, `moveAside` |
| `app/http/respond.mts` | How the server answers: `send()` with the headers every response carries, the event streams' header set, the Content-Security-Policy, and `asObject`'s 400 for a body that is not an object. | `send`, `SSE_HEADERS`, `CSP`, `asObject` |
| `app/guards.mts` | The bounded string, integer and serial checks, shared by the HTTP layer, the stores and the services. | `isBoundedString`, `isBoundedInt`, `MAX_SERIAL`, `short` |
| `app/log.mts` | The one way the server appends a line to its log file, never throwing. | `safeAppendLog` |
| `app/http/router.mts` | The route table: a method and a path (a string or a RegExp) per route, tried in order; `NEXT` passes a request on; nothing answered is the server's 404. | `Route`, `NEXT`, `dispatch` |
| `app/http/context.mts` | What the route modules are built from: the config, the shell's and a test's options, the stores and the services. | `ServerContext`, `HostBridge`, `ClientSearch` |
| `app/http/routes/static.mts` | The page, its assets and fonts, and one route per browser-shared module (`/<name>.mjs`). | `routes` |
| `app/http/routes/inventory.mts` | `GET /api/inventory`, `/api/missing`, `/api/items`, `/api/items/by-serial`. | `routes` |
| `app/http/routes/prefs.mts` | `GET\|PUT /api/profiles`, `/api/ui-prefs`, `/api/tazuo-panel`. | `routes` |
| `app/http/routes/settings.mts` | `GET\|PUT /api/settings`, `POST /api/retention/cleanup`, `GET /api/rules`. | `routes` |
| `app/http/routes/setup.mts` | The setup wizard's routes and `GET /api/update-check` (with its hour-long cache). | `routes`, `MAX_PATH_LEN`, `NO_CLIENT_FOLDER` |
| `app/http/routes/import.mts` | `POST /api/import/paste`, `/api/import/rescan`. | `routes` |
| `app/http/routes/host.mts` | `POST /api/host/pick-folder` and `/api/host/open-path` (bounded by `withHostTimeout`), and the shared `GET /api/events` stream. | `routes` |
| `app/http/routes/optimize.mts` | `POST /api/optimize` with its request checks, the per-job event stream (`streamJob`), cancel and status, and the saved runs' routes. | `routes` |
| `app/http/routes/mcp.mts` | `GET\|PUT /api/mcp`, `POST /api/mcp/token`. | `routes` |
| `app/http/routes/bridge.mts` | `POST /api/bridge`, `/api/bridge/stop`, `GET /api/bridge/status`. | `routes` |
| `app/http/routes/forget.mts` | `POST /api/forget`, `/api/forget-character` (tombstone scans). | `routes` |
| `app/http/routes/blacklist.mts` | `GET\|POST /api/blacklist`, `DELETE /api/blacklist/<serial>`. | `routes` |
| `app/http/routes/houses.mts` | `GET /api/houses[/<id>]`, `/api/facet-map/<facet>.png`, `GET /api/house-map`, `PUT /api/house-map/<id>` (`readNames` logs a names problem once). | `routes` |
| `app/http/routes/kinds.mts` | `GET\|POST /api/item-kinds`, `POST /api/item-kinds/import`. | `routes` |
| `app/http/routes/organize.mts` | The Organize routes: setup, presets, match, propose, plan and trip. | `routes` |
| `app/store/json-file.mts` | The one way a store reads and writes a JSON data file: each reader's bad-file policy named (`empty`, `aside`, `skip`), and the writer's folder, atomic write, indent and trailing newline. | `readJsonFile`, `writeJsonFile` |
| `app/store/settings.mts` | `<data>/settings.json`: read with the move-aside-and-default fallback, written whole. | `createSettingsStore`, `SettingsDoc`, `ClientSettings` |
| `app/store/profiles.mts` | `<data>/profiles.json`: seeded from the defaults, a damaged file moved aside and reseeded, an old shape migrated with a dated backup. | `createProfilesStore` |
| `app/store/ui-prefs.mts` | `<data>/ui-prefs.json`: the page's view choices, the fields it may hold and their checks, salvaged field by field. | `createUiPrefsStore`, `UI_PREF_CHOICES`, `UI_PREF_LISTS`, `UI_PREF_VERSIONS`, `isColWidths`, `isDrawerWidth`, `isManualSuit` |
| `app/store/blacklist.mts` | `<data>/scan-blacklist.json`, which the in-game scripts write too: only valid entries read. | `createBlacklistStore` |
| `app/store/item-kinds.mts` | `<data>/item-kinds.json`: a bad file moved aside, entries that make no sense left out with a warning, a write refused past the caps. | `createItemKindsStore` |
| `app/store/organize.mts` | `<data>/organize.json`: salvaged rule by rule, a bad file moved aside with `problems` saying so. | `createOrganizeStore` |
| `app/store/organize-state.mts` | `<data>/organize-state.json`: Organize's results overlay, a damaged file read as empty. | `createOrganizeStateStore` |
| `app/store/runs.mts` | `<data>/runs/`: one file per saved run, a damaged one skipped in the list and reported on its own. | `createRunsStore` |
| `app/store/scans.mts` | `<data>/scans/`: every scan upgraded and validated on read (a bad one skipped), and the folder's signature. | `createScansStore` |

The services below are factories with explicit dependencies (stores, getters, a log function), built once by `startServer` and never importing `app/http/`:

| Module | Role | Owns |
|---|---|---|
| `app/services/settings.mts` | The settings this run uses: settings.json as saved, with the unknown-client and unloadable-shard fallbacks laid over it in memory only; the current rules, handed to vault-lib; a save that merges only the changed fields; the bridge adapter. | `createSettingsService` |
| `app/services/events.mts` | Server-Sent Events: one frame written, and the bus behind `GET /api/events`. | `sse`, `createEventBus` |
| `app/services/setup.mts` | The adapters this install ships (read from disk on every call), which bridge runs trips, and the data-folder check. | `createSetupService` |
| `app/services/houses.mts` | The house map's client files and models: the UO folder, tiledata, the facet bitmaps and PNG cache, the house model memo. | `createHousesService` |
| `app/services/inventory.mts` | `getInventory`: the fold cached by the scans folder, shard and item-kinds.json, and the overlay cached by organize-state.json and the hour. | `createInventoryService`, `FoldValue`, `InvValue` |
| `app/services/organize.mts` | Organize: finished trips harvested, what a plan starts from, the plan, a trip queued, Put away's requests, the saved suits a rule skips. | `createOrganizeService` |
| `app/services/jobs.mts` | Optimizer jobs: worker threads, the per-job broadcast, one build per client with a server-wide ceiling, the stuck and retention timers, a finished build saved as a run. | `createJobsService`, `Job`, `JobTimings` |
| `app/services/retention.mts` | Pruning old scans and saved runs per settings.json's `retention`, one prune at a time. | `createRetentionService` |

What still lives inside `startServer`: the startup warning; the wiring of the stores, services and route table from the config's paths (the single files in the data folder, `<data>/ui-prefs.json`, `<data>/tazuo-panel.json`, `<data>/scan-blacklist.json`, `<data>/item-kinds.json`, `<data>/organize.json`, `<data>/house-map.json`, `<data>/organize-state.json`, have their paths built here or in their route module, not in `app/config.mts`); the inbox watchers (`startWatchers`); the Host, Origin and token checks ahead of every route (`CONTRIBUTING.md`, Security); the 404, the `HttpError` status mapping and the stack-free 500; listening and closing.

## Desktop shell

| Module | Role | Owns |
|---|---|---|
| `electron/main.mts` | The main process: forks the server, one window, the per-launch token, single instance, the native folder picker and Open folder. | the window and token lifecycle |
| `electron/server-entry.mts` | The server's utility-process entry, which calls `startServer()`. | — |
| `electron/protocol.mts` | Type-only message shapes between the main process and the server child. | `HostRequestMessage`, `HostResultMessage`, `ChildToMainMessage`, `MainToChildMessage` |
| `electron/host-args.mts` | Runtime checks on the two host-bridge arguments. | `openPathTarget`, `dialogTitle` |
| `electron/navigation.mts` | Where the page may navigate and which links go to the OS browser. | `navigationDecision`, `externalOpenDecision` |
| `electron/pending-calls.mts` | The id→promise registry for relayed host calls. | `createPendingHostCalls`, `HOST_CALL_TIMEOUT_MS` |
| `electron/restart-policy.mts` | Whether a crashed server child is restarted. | `shouldRestart`, `RESTART_WINDOW_MS` |

`electron/README.md` and `docs/architecture.md` describe the processes.

## Installer & adapters

| Module | Role | Owns |
|---|---|---|
| `app/installer.mts` | Behind the setup wizard and Settings: adapters, client folders, install, the running-script guard, the update check, the data-folder check. Rejects relative and UNC folder paths; reads an installed version from regular files only (`O_NOFOLLOW`, first 64 KiB); writes each script atomically with packrat-paths.json last; accepts a release URL only under this repository's releases. No Electron import. | `listAdapters`, `candidateClientRoots`, `validateScriptsDir`, `installedVersion`, `installScripts`, `checkForUpdates`, `checkScriptsDataDir`, `RUNNING_MESSAGE` |
| `app/tazuo-panel.mts` | The TazUO in-game panel's options file and adding the panel to TazUO's autostart list. | `readPanelPrefs`, `writePanelPrefs`, `addPanelAutostart`, `tazuoRunning` |
| `app/tazuo-panel-prefs.mts` | The panel options' checks, with no Node imports. | `PANEL_DEFAULTS`, `panelPrefsError`, `panelPrefsOf`, `HOTKEY_KEYS` |
| `scripts/make-adapter-fixture.mts` | Turns a real scan into an anonymized adapter fixture. | — |
| `adapters/tazuo/`, `adapters/razor-enhanced/`, `adapters/classicuo-web/` | Each game client's scripts, `adapters/<id>/capabilities.json` and README (`docs/adapter-guide.md`). | the adapter contract, `ADAPTER_VERSION` |
| `scripts/gen-contracts.mts` | Copies the shared Python helpers from `adapters/_shared/` into every adapter script, between `# BEGIN generated: <fragment>` / `# END generated: <fragment>` markers; `--check` fails when a committed script differs. | `generate`, `splice`, `fragmentProblems` |
| `adapters/_shared/` | The shared Python helper fragments: one file per helper family, `<adapter>/` for one adapter's own. Not shipped. | the shared adapter helpers |
| `adapters/fake_clients.py`, `adapters/test_adapters.py`, `adapters/test_scanners.py`, `adapters/test_bridges.py`, `adapters/test_panel.py` | Fake game clients and the adapter tests, run by `app/adapters.test.mts`. | — |

## UI

The page is `app/index.html` plus `app/ui/`, compiled by `scripts/build-ui.mts` and served through the `/ui/<name>` route. Screens that belong to one feature are listed in that feature's section above: Suit Builder, Organize, House map, Scrolls. The DOM-free modules are the ones `node:test` suites import directly.

### Bootstrap

| Module | Role | Owns |
|---|---|---|
| `app/index.html` | The page shell: markup, one `<main>` per screen, the stylesheet links, the one module script. No inline scripts (the CSP forbids them) and no remote loads: the fonts are bundled under `app/ui/fonts/` with their OFL license texts. | the screens' containers |
| `app/ui/app.mts` | `load()`, screen and drawer switching on a route change, the sidebar nav clicks. | — |
| `app/ui/nav.mts` | The hash routes, the screen registry they dispatch to, and the ways into the Items view other screens use. | `parseRoute`, `routeFor`, `registerScreen`, `showRoute`, `showItem`, `showContainer`, `showSearch`, `showKind`, `showCharacterItems` |
| `app/ui/inventory-data.mts` | `reload()`: the inventory and profiles into the store, then the `inventorychange` event the screens redraw on. | `reload`, `retryLoad` |
| `app/ui/shell.mts` | The left sidebar: nav with counts, the shard and last-scan line, the bridge control, collapse. | `initShell`, `renderNavCounts` |
| `app/ui/theme.mts` | Theme family and light/system/dark mode. | `resolveTheme`, `resolveMode`, `applyLook`, `BUILT_THEMES` |

### Infrastructure

| Module | Role | Owns |
|---|---|---|
| `app/ui/store.mts` | The shared mutable page state. | `state`, `bridge`, `invStamp`, `AppState` |
| `app/ui/api.mts` | The one place every page fetch goes through. | `api`, `CLIENT_ID` |
| `app/ui/prefs.mts` | The one writer of the page's view choices (`PUT /api/ui-prefs`), with one failure toast. | `prefs` |
| `app/ui/api-types.mts` | Every response shape the page reads off its fetches: the house, Organize and saved-run shapes re-exported from the types-only modules (runs narrowed), the rest declared here. | the hand-declared `*ApiResponse` types |
| `app/ui/events.mts` | The one shared `EventSource("/api/events")`. | `connectEvents` |
| `app/ui/items.mts` | Turns a serial into a full item record. | `resolveItems` |
| `app/ui/item-tip.mts` | Where the item tooltip gets its item. DOM-free. | `createTipResolver` |
| `app/ui/dom.mts` | DOM helpers, formatting, labels, rarity color, toasts, the hover tooltip. | `el`, `$`, `fmtN`, `slotLabel`, `rarityColor`, `toast`, `installTooltip` |

### Components and shared widgets

| Module | Role | Owns |
|---|---|---|
| `app/ui/components.mts` | The component primitives as DOM builders, styled by `app/ui/components.css`. `box()` refuses a bare text child. | `box`, `txt`, `button`, `input`, `select`, `popover`, `createDrawer`, `openDialog`, `confirmDialog`, `table`, `menu`, `FLEX_CLASSES` |
| `app/ui/dialog.mts` | A one-field prompt (Electron has no `window.prompt`). | `promptText` |
| `app/ui/item-parts.mts` | The item widgets every screen shares: rarity, tags and location elements, the row actions and the ⋯ menu, and the filter wording's context. | `rarityEl`, `tagEls`, `locationEl`, `tagWords`, `itemActions`, `itemMenu`, `filterContext`, `setItemNav` |
| `app/ui/item-browser.mts` | The item browser: filter toolbar, filter strip, column popover and virtual table, mounted more than once. | `createItemBrowser` |
| `app/ui/sheet.mts` | The character sheet, shared by Characters and the Suit Builder. | `sheetNode`, `SLOT_GROUPS`, `SHEET_GROUPS`, `RESISTS` |
| `app/ui/tazuo-panel.mts` | The TazUO panel's two options as controls. | `panelControls` |
| `app/ui/paste-scanner.mts` | The Copy scanner script button for a paste-transport client. | `scannerCopy` |
| `app/ui/shard.mts` | The one place a shard switch is saved and the page reloaded. | `changeShard` |

### Data modules (pure)

| Module | Role | Owns |
|---|---|---|
| `app/ui/messages.mts` | The sentences the page shows for a server outcome. | `errorText`, `bridgeView`, `optimizeErrorMessage`, `prefsSaveFailed` |
| `app/ui/adapters.mts` | Adapter-selection helpers. | `defaultAdapterId`, `availableAdapters`, `platformCompatible` |
| `app/ui/adapter-copy.mts` | What the page says about each game client. | `adapterCopy`, `shortName`, `wizardSteps` |
| `app/ui/view-state.mts` | What a refresh keeps, what Clear all resets, the starting columns. | `optionsKeeping`, `clearedQuery`, `COLS_VERSION` |

### Screens

| Module | Role | Owns |
|---|---|---|
| `app/ui/inventory.mts` | The Inventory's Items view, and what `app/ui/nav.mts`'s ways into it do. | `initFilters`, `fetchItems` |
| `app/ui/containers.mts` | The Inventory's Containers view. | `renderContainers`, `labelContainer` |
| `app/ui/peek.mts` | The item peek beside the table. | `openPeek`, `closePeek` |
| `app/ui/kinds.mts` | Classify this…, and the kinds file's export and import. | `openClassify`, `exportKinds`, `importKinds` |
| `app/ui/characters.mts` | The Characters roster and a character's sheet. | `renderCharacters`, `showCharacter` |
| `app/ui/settings.mts` | The Settings screen. | `renderSettings` |
| `app/ui/wizard.mts` | The first-run / Run setup wizard. | `openWizard` |
| `app/ui/import.mts` | The Import drawer. | `renderImport` |

### Models (pure)

| Module | Role | Owns |
|---|---|---|
| `app/ui/inv-model.mts` | The Inventory's query string, filter tokens, counts, row window and keyboard model. | `DEFAULT_COLS`, `ITEM_COLS`, `COL_GROUPS`, `queryParams`, `activeFilters` |
| `app/ui/roster.mts` | The Characters roster's filter and sort, and the sheet's scan summary. | `rosterView`, `sheetMeta` |
| `app/ui/import-preview.mts` | The Import drawer's preview card as data. | `scanPreview` |

Stylesheets (`app/ui/tokens.css`, `app/ui/britannia.css`, `app/ui/components.css`, `app/ui/styles.css`, `app/ui/shell.css` and one per screen) and the bundled fonts under `app/ui/fonts/` are served straight from source. CSS classes are global across every stylesheet. Icons are `app/assets/icon.png`, `app/assets/favicon.png` and `app/assets/logo-mark.png`; the installers' master is `build/icon.png`.

## Tooling & tests

| Module | Role | Owns |
|---|---|---|
| `scripts/test-runner.mts` | The test interface behind `scripts/test_runner.sh`: `--smoke`, `--fast`, `--changed`, full. | the summary file, test_logs/latest_summary.json |
| `scripts/run-suite.mts` | The counting half of the runner: build, discover, run, fold the events into the summary. | `runSuite`, `patternsFor` |
| `scripts/select-tests.mts` | Which test files `--changed` runs for the changed paths. | `selectTests`, `SCREENS` |
| `scripts/test-file-watchdog.mts` | Ends a test file's process that does not exit on its own after its tests. | — |
| `scripts/build-ui.mts` | Compiles the page into app/dist/ (git-ignored). | `buildUi` |
| `scripts/build-schema-types.mts` | Generates app/schema/types.d.mts (git-ignored) from the JSON Schema files. | `buildSchemaTypes`, `schemaToTypeSource` |
| `scripts/start.mts` | `npm start`: builds, then runs the bare server. | — |
| `scripts/electron-window.mts` | How the Electron UI tests size the window. | `fitWindow`, `testEnv` |
| `scripts/contrast-probe.mts` | Measures WCAG contrast on the rendered page. | `probeContrast` |
| `scripts/localstorage-shim-for-tests.mts` | A `localStorage` stub installed on import, for tests of modules that use it. | — |
| `app/timing-fixture.mts` | Speed checks that keep the fastest of several samples. | `fastestMs` |
| `app/server-fixture.mts` | Test fixture: the real server on an empty temp home, with no client running and a fake update check. | `startTestServer`, `FAKE_HOME`, `updateRequests` |
| `app/server-routes-fixture.mts` | Test fixture for the route test files (`app/server.test.mts`, `app/server-<family>.test.mts`): the response shapes, `asJson`, the shard's rules and the helpers more than one of them uses. | `asJson`, `UOALIVE`, `rawReq`, `sseReader`, `foldFixtures`, `logText` |

Every `*.test.mts` file sits beside the module it is named after, and `TESTING.md` lists them with their tags.

## Where concepts are restated today

These concepts have one owner above but are copied by hand elsewhere. Until the architecture pass (#218) gives each one source, a change to one copy means updating the others.

- **Gear slots.** Owner: `app/vault-lib.mts` (`LAYER_TO_SLOT`, `GEAR_SLOTS`, the slot-to-group table `GEAR_SLOT_GROUPS` with `SLOT_GROUP` and `SLOTS_IN_GROUP`, `REQUIRED_SLOTS`, `SLOT_LABELS`). The sheet's tiles, the item browser's slot filter and the meditation slot set derive from the table. Still listed by hand: `JEWEL_SLOTS` inside `app/vault-lib.mts`; the default and optional slot lists in `scripts/optimizer-core.mts` (paste-able, so no imports; `app/solver.test.mts` and `app/slot-groups.test.mts` tie them to the table); `MANUAL_GROUPS` in `app/ui/manual-model.mts` (a layout; its test checks it holds `GEAR_SLOTS` once, in order); the Armor and Jewelry groups in `app/organize-strategies.mts`, which keep the neck with Jewelry on purpose (neck armor joins Armor by name, through `NECK_ARMOR_WORDS`). `scripts/slot-lists.test.mts` fails on any other gear slot list.
- **Property display groups.** Owner: `app/vault-lib.mts` (`PROPERTIES`, from which `PROP_PATTERNS`, `PROP_LABELS`, `PROP_FULL`, `NOT_BUILDER_KEYS` and `app/item-query.mts`'s `EXTRA_COLS` are derived). Still grouped by hand: the column groups in `app/ui/inv-model.mts`; the sheet groups in `app/ui/sheet.mts`; `TOTAL_KEYS` in `app/ui/manual-model.mts`; `CASTER_PROPS` and `MELEE_PROPS` in `app/organize.mts`; bare key strings in `app/buffs.mts`, `app/mip.mts` and the core.
- **HTTP response shapes.** The houses, Organize plan and proposal, and `/api/runs` responses are shared: `app/house-model-types.mts`, `app/organize-types.mts` and `app/runs-types.mts`, which the routes `satisfies` and `app/ui/api-types.mts` re-exports, so a renamed field fails the typecheck on both sides. Every other response, `GET /api/bridge/status` included, is still declared by hand in `app/ui/api-types.mts`, and no test compares those with what the routes in `app/http/routes/` build. Change such a route's response and its type together.
- **The browser-shared module list.** A server module the page imports at run time is compiled into `app/dist/` by `build:ui` (`tsc` emits every module the page reaches, listed in `tsconfig.browser.json`'s `include` or not) and must be served by its own static route in `app/http/routes/static.mts` (`/vault-lib.mjs`, `/item-query.mjs`, `/scan-schema.mjs`, `/paste-scan.mjs`, `/organize-config.mjs`, `/buffs.mjs`, `/data-dir-notice.mjs`, `/schema/validate.mjs`); without the route the page gets a 404 at load. `scripts/layering.test.mts` checks that every such module has its route and reaches no `node:` module. The list is also written out in the header comment of `scripts/build-ui.mts`, in `docs/architecture.md`'s HTTP routes and in `CONTRIBUTING.md`'s Run / dev loop.
- **Adapter helpers.** Game scripts cannot import their siblings, so each adapter copies its helpers into every script. The copies of the helpers in `adapters/_shared/` (the paths, time and blacklist helpers, container detection, the trash and never-a-container rules, the container walk, the house capture and the bridge's untrusted-input block) are generated by `scripts/gen-contracts.mts`; edit the fragment and run it. Helpers no fragment holds yet, such as the TazUO panel's own `facet` and the bridges' `find` or `walk_to`, are still separate code, and `ADAPTER_VERSION` and `CAPABILITIES` are still literals that `adapters/test_adapters.py` checks against each adapter's manifest.
