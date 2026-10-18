# Module map

Where each concept lives, area by area. Each table row is one module: its path, what it does, and the names it owns (the one place that name is defined). The tables between `module-map:start` and `module-map:end` markers are generated from each module's own header (`scripts/module-index.mts`): the Role is the first sentence of its `// <name> — <role>` line, the table is its `// map: <area>` line and the Owns column its `// owns:` line. When you add, move, rename or delete a module, or change one of those lines, run `npm run gen:modules`; resolve a conflict in a table the same way, never by hand. `scripts/module-map.test.mts` fails when a table is out of date, a module's header lacks those lines, or a path named here no longer exists. The "Also here" tables (data files, folders and the other parts of a module listed elsewhere) and everything else are written by hand.

`docs/change-checklists.md` says which of these modules a given kind of change touches. `docs/architecture.md` has the processes and the data folder; `docs/ui.md` the page's design rules.

Three files keep names from before the project became Pack Rat: `app/vault-server.mts`, `app/vault-lib.mts` and `app/gear-vault.test.mts`. Nothing else about them is legacy, and there is no plan to rename them.

## Scan & fold

<!-- module-map:start scan -->
| Module | Role | Owns |
|---|---|---|
| `app/import.mts` | The import paths that aren't "an adapter dropped a file and the watcher noticed": a player pasting what the ClassicUO web client's sandboxed scanner printed (it cannot write files at all), and a manual rescan for a player whose folder watcher missed a drop. | `writeScanToInbox` |
| `app/missing.mts` | Missing since last scan (issue #99): what a root's previous scan saw that is nowhere in the fold now. | `missingSinceLastScan`, `MissingItem` |
| `app/paste-scan.mts` | Making sense of a pasted scan: find the JSON in what the player pasted, parse it, and run it through the same upgrade + schema validation an inbox file gets. | `parsePastedScan`, `PASTE_BEGIN`/`PASTE_END`, `jsonErrorReason` |
| `app/retention.mts` | Which saved scans and runs the data folder can let go of (issue #28). | `scansToPrune`, `runsToPrune`, `RETENTION_DEFAULTS`, `RETENTION_LIMITS`, `retentionOf` |
| `app/scan-schema.mts` | The scan v2 schema inline (deep-equal to the JSON copy, a test checks), the v1→v2 upgrade-on-read (app/migrate.mts's scan step, and the watcher's and a paste's read), epoch-based scan ordering, and the pseudo character names (a name starting with `_`, and NOBODY, the Suit Builder's No character, re-exported by vault-lib.mts). | `SCAN_V2_SCHEMA`, `TAZUO_V1_CAPS`, `validateScan`, `upgradeScan`, `parseStamp`, `isRealStamp`, `isPseudoCharacter`, `NOBODY` |
| `app/schema/validate.mts` | The hand-written JSON Schema SUBSET validator every schema here is checked with, browser-safe. | `validate`, the supported keyword subset |
| `app/vault-lib.mts` | Pack Rat's shared kernel, page and server alike: the inventory types, tooltip parsing, slot classification, snapshot folding (a scan replaces everything under each root it lists), optimizer pool building and requirement reports. | `Item`, `Container`, `Character`, `Inventory`, `ScanSummary`, `parseTooltip`, `foldSnapshots`, `locationOf`, `containerPath`, `capacityOf`, `TRASH_RE`, `groupByName`, `slayersOf`, `medableOf` |
| `app/watcher.mts` | Inbox ingestion: adapters drop scan files into <data>/inbox/<adapter>/ (temp-then-rename, per adapter contract) instead of writing straight into <data>/scans/; one watcher per adapter, fs.watch with a 300 ms debounce, retry then quarantine to <data>/inbox/<adapter>/rejected/, and normalize-then-move into <data>/scans/; a symlink, directory or device, or a file over MAX_INBOX_BYTES (32 MiB), is refused unread; idempotent, never throws. | `startWatcher`, `ingestFile`, `acceptedName` (the one place scan text becomes a file name), `MAX_INBOX_BYTES` |
<!-- module-map:end -->

| Also here | Role | Owns |
|---|---|---|
| `app/schema/scan.v2.schema.json` | The scan contract as JSON Schema (`docs/scan-schema.md`). | the scan shape |
| `app/fixtures/demo-Dorran.json`, `app/fixtures/demo-Kestrel.json` | Synthetic scans for tests and `--demo` (`app/fixtures/README.md`). | the demo characters |

## Kinds & classification

<!-- module-map:start kinds -->
| Module | Role | Owns |
|---|---|---|
| `app/item-kinds.mts` | The player's own item kinds (issue #150), <data>/item-kinds.json: this module checks, merges and resets its document, purely; an entry this version does not know is left out and named, never an error, and the server folds again when the file changes and refuses a change past MAX_KINDS_BYTES with a 409. | `salvageKindOverrides`, `withKinds`, `withoutKinds`, `kindsDocument`, `MAX_KINDS_BYTES` |
| `scripts/gen-graphic-layers.mts` | Regenerate the wearable-graphic table in app/vault-lib.mts from a client's tiledata.mul. | `wearableLayers`, `spliceTable` |
<!-- module-map:end -->

| Also here | Role | Owns |
|---|---|---|
| `app/vault-lib.mts` (classifier part) | Which slot a piece goes in (the worn layer, then the graphic's tiledata layer, then name rules) and which kind every item is. | `LAYER_TO_SLOT`, `GEAR_SLOTS`, `GEAR_SLOT_GROUPS`, `SLOT_GROUP`, `SLOTS_IN_GROUP`, `REQUIRED_SLOTS`, `SLOT_LABELS`, `NECK_ARMOR_WORDS`, `isNeckArmor`, `classify`, `layerOfGraphic`, the wearable-graphic table, `spellSchoolOf`, `KINDS`, `OVERRIDE_KINDS`, `kindOf`, `overriddenKind`, `INSTRUMENTS` |

## Item query

<!-- module-map:start query -->
| Module | Role | Owns |
|---|---|---|
| `app/item-query.mts` | Pure item-list filtering/sorting/paging/faceting, shared by the browser (ui/dom.mts re-exports EXTRA_COLS/colVal; ui/inventory.mts's filtered()/renderInventory() logic will move here in a later task) and the server (vault-server.mts's GET /api/items, GET /api/inventory's facets). | `parseItemQuery`, `matchesItem`, `applyItemQuery`, `facetsOf`, `ItemQuery`, `RuleQuery`, `EXTRA_COLS`, `colVal`, `rarityRank`, `HIT_LIMIT` |
<!-- module-map:end -->

| Also here | Role | Owns |
|---|---|---|
| `app/vault-lib.mts` (property part) | The property keys a tooltip line becomes, their labels and the search blobs, and the span a good suit covers in each, which turns a per-point weight into the importance the page shows and back (the only place the two convert). | `PROPERTIES`, `PropKey`, `typicalRange`, `IMPORTANCE_K`, `importanceOf`, `weightOfImportance`, `roundImportance`, the goals that compile to weights (issue #292: `Goals`, `compileGoals`, `goalsActive`, `goalsError`, `goalsText`, `RANK_IMPORTANCE`, `LEFTOVER_GROUPS`), `withCurrentActions`, `PROP_PATTERNS`, `PROP_LABELS`, `PROP_FULL`, `NOT_BUILDER_KEYS`, `SKILL_NAMES`, `RESIST_META`, `RESIST_KEYS`, `labelOf`, `fullOf`, `propertyKeys`, `extraKeys`, `flagKeys`, `BOOLEAN_FLAGS`, `itemSearchBlob` |

## Shard rules

<!-- module-map:start rules -->
| Module | Role | Owns |
|---|---|---|
| `app/rules.mts` | Loads a shard's rules file (app/rules/<id>.json, or userRulesDir/<id>.json first when given) and validates it against app/schema/rules.v1.schema.json before anything downstream sees it. | `loadRules`, `listRules`, `DEFAULT_SHARD`, `scrollBinderProblem`, `slayerGroupsProblem` |
<!-- module-map:end -->

| Also here | Role | Owns |
|---|---|---|
| `app/rules/uoalive.json`, `app/rules/generic-osi.json` | The builtin shard rules files (`docs/shard-rules.md`). | caps, `raceCaps`, `resistMinimum`, `tagUnits`, `rarity`, `raceLock`, `freeSkills`, `scrollBinder`, `slayerGroups`, `unravel` |
| `app/schema/rules.v1.schema.json` | The contract every rules file is checked against. | the rules shape |
| `app/vault-lib.mts` (rules part) | Holds the loaded rules for page and server, and the rules-driven math. | `setRules`, `getRules`, `minResistAt`, `resistMinimum`, `paperdollResist`, `shardResistCap`, `tagUnits`, `tagInfo` |

## Suit Builder

Profiles, buffs, pools, solvers, saved runs and Manual. `docs/solver.md` describes the model.

<!-- module-map:start builder -->
| Module | Role | Owns |
|---|---|---|
| `app/bench/compare-cores.mts` | Runs the solvers' code at a git ref and the working tree's on identical inputs and checks every output is byte-identical, so a solver refactor can show it changes nothing. | — |
| `app/bench/gen-inventory.mts` | Synthetic scan generator for the suit-builder scale benchmark. | `learnModel`, `generateScan` |
| `app/bench/make-fixtures.mts` | Regenerate app/fixtures/demo-*.json from the empirical model. | — |
| `app/bench/mip-spike.mts` | SPIKE (Sep 13 2026): solve the suit problem as a mixed-integer program with HiGHS (WASM) and compare against the core's proven scores. | — |
| `app/bench/run-bench.mts` | The suit builder's scale benchmark, a sweep through app/optimize-worker.mts. | — |
| `app/buffs.mts` | The Suit Builder's buffs, abilities and forms (issue #12): a catalog, as data, of what a spell, a form, a mastery or a potion adds to a suit's totals, and applyBuffs, a pure evaluator that shows a suit "with Divine Fury on" or "in Reaper Form", and the debuffs an enemy casts on you. | `BUFFS`, `BUFF_INPUTS`, `BUFF_GROUPS`, `applyBuffs`, `minimumWith`, `buffPlanOf`, `manualProfile`, `manualBase`, `manualPlan`, `plannedProfile`, `planBuffs`, `isBuffList`, `normalizeBuffs`, `isRunBuffs`, `savedBuffs` |
| `app/build-spec.mts` | A build's intent as one document (issue #218, BuildSpec): what "good" means (intent), the buffs it plans with (buffs), which pieces it may use (pool), and optionally the goal and the search knobs; the one check it is held to and its defaults; planBuild (a spec into the profile the solvers score with, the pool settings, the search options and the saved run's snapshot); the panel's flat profile and back; and the profiles.json v2 → v3 migration that moves Automatic's buffs in from ui-prefs; pure, page and server alike, and the page, POST /api/optimize, POST /api/evaluate and the MCP tools all build through it. | `BuildSpec`, `ProfilesV3`, `buildSpec`, `buildSpecError`, `planBuild`, `goalSsiCap`, `specFromProfile`, `profileFromSpec`, `characterProfile`, `characterBuffs`, `characterEntry`, `characterLabel`, `labelError`, `findTemplate`, `templateRefs`, `BUILTIN_PREFIX`, `migrateProfilesV3` |
| `app/diagnostics.mts` | Settings that work against a build, each with the change that would fix it (issue #217): a requirement no suit in the pool can reach, hard requirements the suit could reach one at a time but not together, a weight that swamps the rest, and a required weapon property no weapon has. | `preBuildDiagnostics`, `resultDiagnostics`, `swingDiagnostics`, `weightDiagnostics`, `weaponFlagDiagnostics`, `onlyRootsDiagnostics` |
| `app/evaluate.mts` | One suit evaluation (issue #216): a suit's item totals, its totals in paperdoll terms with the buffs that count, the caps they leave, and the build's requirements against it. | `evaluateSuit`, `SuitEvaluation`, `paperdollCaps` |
| `app/exact-solver.mts` | The orchestration between the core's heuristic search and the HiGHS exact solver (app/mip.mts + app/mip-solve.mts). | `solveExact` |
| `app/mip-solve.mts` | The HiGHS runtime wrapper around app/mip.mts's pure builder. | `loadHighs`, `openModel`, `solveModel`, `addNoGood`, `closeModel`, `gapFromEvents` |
| `app/mip.mts` | The suit problem as a mixed-integer program, built as HiGHS sparse (CSR) arrays. | `buildSuitMip`, `propertyReach`, `startVector`, `pickedOf`, `noGoodRow`, `HARD_FLOOR_BONUS`, `DEFAULT_SLOTS`, `optionalSlotsFor`, `heldModel`, `tieBreakModel`, `stageObjective`, `tieCosts`, `withHardFloorBonus`, `hardFloorSpread` |
| `app/optimize-worker.mts` | Runs one optimize call off the server's main thread: the core's own heuristic search (opts.exact falsy) or the HiGHS-backed exact orchestrator (opts.exact true, app/exact-solver.mts, which falls back to the core's heuristic when HiGHS does not load); it scores SSI with the step table the server prepared (app/solver/prepare.mts) and finishes the result (app/solver/finish.mts: the swing, the summaries, diagnostics and shares), and cancel terminates the job's worker. | the worker message types |
| `app/profile-edits.mts` | The changes a page or a tool makes to the player's profiles, as data (quality pass 1, W1a): a closed `ProfileEdit` union and `applyProfileEdit`, pure and browser-safe. | `ProfileEdit`, `applyProfileEdit`, `applyProfileEdits`, `profileEditError` |
| `app/run-settings.mts` | A build's run settings: their shape, the one check every route holds them to (`settings` and `meta.settings` on POST /api/optimize, a manual run's `settings` on POST /api/runs), the search knobs' ranges the page's Advanced fields share, and the defaults. | `runSettingsError`, `RUN_SETTING_LIMITS`, `OPTS_LIMITS`, `RUN_DEFAULTS`, `defaultStrLimit` |
| `app/runs-lib.mts` | Saved suit-builder runs: the cache key (pools, worn suit, scoring profile and options, minus budget and warm start), the reuse rule (proven, heuristic, or a budget already as large; never a fallback result), the list summary, a manual run, the one constructor of a saved run's document, and what changed in the gear since a run (the pool serials and suit places a search run keeps, compared with its pool rebuilt now, issue #291); bump SOLVER_VERSION on any change to the model, the orchestration or the core's scoring. | `SOLVER_VERSION`, `runKey`, `reusableRun`, `runSummary`, `manualRun`, `runRecord`, `poolSnapshot`, `gearChanges` |
| `app/runs-types.mts` | A saved suit-builder run and its list summary (app/runs-lib.mts), and the GET /api/runs and /api/runs/<id> responses built from them. | `SavedRun`, `RunSummary`, `RunResult`, `SwingResult`, `RunSettingsRaw`, `RunsListBody`, `RunBody`, `GearChanges` |
| `app/services/builds.mts` | The Suit Builder's builds (issue #338): a checked POST /api/optimize request into a started job, or a saved run that answers it. | `createBuildsService`, `BuildsService`, `BuildRequest`, `poolOptions`, `givenSettings`, `scannedWho`, `manualSuitError` |
| `app/solver-fixture.mts` | What the solver-equivalence test files share: the TazUO adapter fixture folded and pooled, the shipped default templates, cell() to build a solver input from one of them, and runBoth() to run HiGHS and the core on it and check they agree. | `cell`, `runBoth`, `fuzzSlots` |
| `app/solver/finish.mts` | Everything a build does after the search (issue #338): the suit's swing, the tie-break's and Strict order's summaries, the result diagnostics and each suit's score shares. | `finishResult`, `FinishInput`, `WorkerResult` |
| `app/solver/prepare.mts` | Everything a build does to its input before the search, and the run key (issue #338). | `prepareSolve`, `stampTieCost`, `PrepareInput`, `SolveInput`, `PreparedSolve` |
| `app/solver/scoring.mts` | The scoring constants, the profile reading and the single-suit terms the optimizer core (scripts/optimizer-core.mts) and the MIP (app/mip.mts) share, stated once (issue #338). | `HARD_FLOOR_BONUS`, `HARD_FLOOR_BONUS_MAX`, `hardBonusOf`, `TIE_SLACK`, `SCORE_REL`, `slackAt`, `FLOAT_EPS`, `CHANGE_COST`, `GEAR_SLOT_COUNT`, `changeCost`, `RESIST_SKILL_KEY`, `RESIST_STEP_SLACK`, `DEFAULT_FLOOR_BONUS`, `DEFAULT_FLOOR_PARTIAL`, `DEFAULT_BUDGET_MS`, `DEFAULT_RESTARTS`, `scoringProfile`, `ScoringProfile`, `ResistStep`, `stepReached`, `liftedMin`, `heldTotal`, `floorMet`, `SsiStepPoint`, `pointReached`, `stepCredit`, `keptValue` |
| `app/swing.mts` | Swing speed (issue #217): how long a weapon takes between swings for a character's stamina and Swing Speed Increase, the steps SSI moves it through, and the table both solvers score SSI with when the build scores it by step. | `swingSeconds`, `ssiForTicks`, `swingSteps`, `stepTable`, `stepsFor`, `swingOf`, `weaponSpeedOf`, `heldWeapon` |
| `app/ui/builder-buffs.mts` | The Suit Builder's buffs (issue #12): Manual's Buffs row in the totals card (each buff that is on as a removable chip, Add buff, and the "Count buffs in the totals" switch), a total's marker line saying what the buffs did to it, and the buff picker: a search, the catalog by group with each entry's numbers worked out from the character's skills, a field per number a group scales with, and the note when a form replaced another. | `buffChip`, `createBuffPicker` |
| `app/ui/builder-header.mts` | The Suit Builder's sentence bar (issue #321): the character picker, the build picker with the templates to start over from and the saved settings to go back to, and the What changed chip beside it with its popover (issue #336). | `initPickers` |
| `app/ui/builder-job.mts` | The Suit Builder's build job (design spec 4.6): Build checks the panel's fields, starts the optimize job (POST /api/optimize) with the panel as a build, follows it over SSE in the inline progress card (its phases, bar and stats, Cancel), and ends it with the result shown, parked for another character, a refusal or a cancel. | `runBuild`, `cancelJob`, `runPanel` |
| `app/ui/builder-manual.mts` | The Suit Builder's Manual mode (issue #12): an Automatic \| Manual switch in the top bar, and in Manual a suit built by hand. | `initManual`, `applyBuilderPrefs`, `savePrefs` |
| `app/ui/builder-model.mts` | The Suit Builder's pure logic (design spec 4.6-4.8): the Advanced fields' validation, a resist tile's outcome line, the result's "What changes" gauges and table and "after the change" values, the compare table's differing rows and best values, and a saved run's label and badges. | `KNOB_RANGES`, `changeRows`, `compareModel`, `runAutoLabel`, `who` |
| `app/ui/builder-parts.mts` | What more than one Suit Builder module draws or reads, holding no state of its own: a piece's key properties and item tooltip, a result's verdict, the Fetch list and its Grab all (the result's and Manual's), and an optimize job's event stream and progress words (the Automatic build's and Manual's fill), a template's shown name, the panel's buffs on and the no-character line, a drawer group's frame, the checklist popover behind a chip, and the panel's Faster Casting cap with its note. | `fetchCard`, `grabAllButton`, `verdict`, `followJob`, `progressText`, `plainName`, `NO_CHARACTER`, `buffsOn`, `group`, `checklist`, `panelFcCap`, `fcCapNote` |
| `app/ui/builder-requirements.mts` | The Suit Builder's Requirements and Goals tabs and the resist caps (issues #272, #292): the requirement rows with what each came to in the shown result, the forbidden skill bonuses, the resist caps, the ranked goals that set the weights, the weight rows with their sliders, the swing-step settings and the property picker behind "+ Add". | `applyRequirementsPrefs`, `requirementsSection`, `capsSection`, `goalsSection`, `weightsSection` |
| `app/ui/builder-result.mts` | A Suit Builder result (design spec 4.7) in answer-first order (headline with the resist tiles and What changes, the Plan, the Fetch list, the other suits, "<name> after the change", Solver details) with the character's runs beside it (ui/runs.mts runsCard), and the compare view for 2-3 suits or saved runs. | `applyResultPrefs` |
| `app/ui/builder-session.mts` | The Suit Builder's one session: the state its nine modules share (builder.mts's panel, builder-header.mts's sentence bar, builder-templates.mts's templates, builder-requirements.mts's Requirements and Goals tabs, builder-job.mts's build job, builder-start.mts's first-visit view, builder-result.mts's result, builder-manual.mts's Manual mode, runs.mts's saved runs) and the commands they call on each other. | `session`, `commands`, `provide`, `announce`, `onChange`, `readControls`, `applyKnobs` |
| `app/ui/builder-start.mts` | The Suit Builder's first-visit view (issue #272), shown while no result is on screen for the selected character or No character: the template cards (the panel's own template, suggested built-ins and the player's own), a read-only summary of what Build will build for and the weights that matter most, each opening the Build Settings drawer on its tab, and a big Build; beside it what the character wears now and the other characters' latest runs. | — |
| `app/ui/builder-templates.mts` | The Suit Builder's templates (issue #336): the Manage templates drawer and what it does (Save as, Update, Rename, Duplicate, Delete), and a template picked as the panel's starting point (pickTemplate, from the build picker or a first-visit card). | `pickTemplate`, `saveTemplateAs`, `openTemplatesDrawer` |
| `app/ui/builder.mts` | The Suit Builder screen (design spec 4.6, issues #272, #321): the sentence bar's Build Settings and Build, the Build Settings drawer (its tabs: Requirements, Goals, Buffs, Pool, Advanced) with its footer, the panel as a build and the finished build shown. | `initBuilder`, `applyPanelPrefs`, `selectCharacter` |
| `app/ui/manual-model.mts` | The Suit Builder's Manual mode, its pure logic (issue #12): the totals strip's keys and the line under each total, the slot groups, the picker's slot filter, the one-hand/two-hand rule, a saved suit read back, the slots whose piece left the scans, a picker row's delta ("LRC +20 → 77"), the suit's undo history and keys, and the hand-offs with Automatic (a result into the suit, the pieces to fetch). | `TOTAL_KEYS`, `STAT_KEYS`, `MANUAL_GROUPS`, `handConflict`, `slotDelta`, `fillableSlots` |
| `app/ui/runs.mts` | The Saved runs drawer (design spec 4.8): one card per run with its name or automatic label, meta line and summary badges, a ⋯ menu (Open, Rename inline, Delete with a confirm dialog), a filter, and a footer that ticks up to three runs for the compare view (ui/builder-result.mts's openRunCompare). | `applySettings`, `openRunsDrawer`, `loadRuns` |
| `scripts/optimizer-core.mts` | Whole-suit gear optimizer CORE: the heuristic suit search and scoring of record, loaded from source by the path corePath() resolves. | `optimizeSuit`, `scoreSet`, `optDefaultSlots`, `optDefaultOptionalSlots`, `optDominancePrune` |
<!-- module-map:end -->

| Also here | Role | Owns |
|---|---|---|
| `app/vault-lib.mts` (builder part) | Profiles and templates, the effective profile the solvers see (the Faster Casting cap by casting school included), pools, weapons, run settings and requirement reports. | `Profile`, `EffectiveProfile`, `effectiveProfile`, `CASTING_SCHOOLS`, `fcCapFor`, `RESIST_CAP_LIMITS`, `resistCapsFor`, `TEMPLATE_KEYS`, `templateFrom`, `migrateProfiles` (v1 → v2), `OptItem`, `toOptItem`, `buildPools`, `WEAPON_SKILLS`, `MELEE_SKILLS`, `WEAPON_MUST_HAVE`, `isWeapon`, `missingFlags`, `weaponHasFlags`, `weaponMustHaveError`, `RunSettings`, `settingsDiff`, `totalsOf`, `requirementReport` |
| `app/data/profiles.default.json` | A new `<data>/profiles.json`, written on first run: schemaVersion 3, no characters and no templates of the player's own. | the first-run file |
| `app/data/templates/` | One file per shard (uoalive, generic-osi): the shard's built-in Suit Builder templates, read at run time, shown read-only, never copied into `<data>/profiles.json`. | the built-in templates |
| `app/schema/profiles.v3.schema.json` | The contract a profiles save (`PATCH /api/profiles`) checks the file's shape against (each spec then goes through `buildSpecError`). | the profiles shape |

## Organize

<!-- module-map:start organize -->
| Module | Role | Owns |
|---|---|---|
| `app/move.mts` | Move to (issue #270): items the player selected in the Inventory put into one container they picked, or each put back where a Move took it from, planned as Organize trips (organize.mts's packSite) so the bridge runs them as it runs Organize's. | `resolveSelection`, `destProblem`, `planMoves`, `backSteps`, `againstRules`, `Selection` |
| `app/organize-config.mts` | Organize's saved setup (issue #11), <data>/organize.json: which containers are labelled (the playing field), the ordered rules (first match wins), the catch-all, and the items that never move. | `OrganizeConfig`, `checkOrganizeConfig`, `salvageOrganizeConfig`, `salvagedRefusal`, `ruleMatchOf`, `CATCH_ALL_ID`, `EMPTY_BAGS_ID`, `BUILDS`, `SCHOOLS`, `LIMITS` |
| `app/organize-fixture.mts` | Hand-built house scans for the Organize tests (app/organize*.test.mts): chests on the ground at chosen tiles, bags inside them and items inside those. | `houseScan` |
| `app/organize-presets.mts` | Ready-made rule filters for Organize (issue #11). | `PRESETS`, `ruleFromPreset` |
| `app/organize-state.mts` | Organize's results overlay (issue #11), <data>/organize-state.json: the trips the server queued and has not yet heard back about (`pending`), the bridge Grabs likewise (`grabs`, issue #148), every step the bridge confirmed (`moves`, which planOrganize applies so a finished trip is not planned again before the next scan), and when each labelled container was last in a scan (`seen`, for "not seen since"). | `OrganizeState`, `harvestTrips`, `addGrab`, `pruneOverlay`, `noteSeen` |
| `app/organize-strategies.mts` | Organize's Auto mode (issue #11, spec §5): the Simple, Detailed and By build (#91) strategies (which items form a group, each group written as ordinary rule filters, mostly the presets), assignGroups (which of the ticked chests each group gets) and proposeOrganize (the whole setup Accept saves). | `STRATEGIES`, `groupItems`, `assignGroups`, `proposeOrganize` |
| `app/organize-types.mts` | Organize's plan and Auto organize's proposal, and the GET /api/organize/plan and POST /api/organize/propose responses built from them; types only, importing only organize-config.mts's types, so the page's browser build can use them: app/organize.mts and app/organize-strategies.mts re-export them, the routes `satisfies` them, and ui/api-types.mts re-exports them. | `Plan`, `PlanMove`, `PlanTrip`, `PlanWarning`, `WarningKind`, `RuleReport`, `RoomReport`, `Carried`, `EmptyBag`, `Proposal`, `ProposeResult`, `StrategyId`, `Family`, `Candidate`, `GroupReport`, `Layout`, `OrganizePlanApiResponse`, `OrganizeProposeApiResponse`, `OrganizeProposeBody`, `OrganizePreset`, `OrganizeApiResponse`, `OrganizePutApiResponse`, `OrganizePresetsApiResponse`, `OrganizeTripApiResponse`, `MovePlanSummary`, `MovePlanApiResponse`, `MoveBackApiResponse`, `MoveTripApiResponse`, `OrganizeMatchApiResponse` |
| `app/organize.mts` | Organize's planner (issue #11): which item goes from which container to which, in which trip, and what does not fit. | `planOrganize`, `tripCommand`, `packSite`, `scopeOf`, `claimOf`, `buildOf`, `CASTER_PROPS`, `MELEE_PROPS`, `TRIP_DEFAULTS` |
| `app/put-away.mts` | Put away (issue #131): the TazUO panel's filing, by the current Organize rules, of what lies directly in one container the player picks with a target cursor: the backpack, a bag in it, or a container in a labelled ground chest. | `PUT_AWAY_REQUEST`, `PUT_AWAY_REPLY`, `checkPutAwayRequest` |
| `app/ui/auto-organize.mts` | Auto organize (issue #11, spec §5): a wide drawer opened from the Organize screen. | `openAutoOrganize` |
| `app/ui/organize-data.mts` | The page's copy of the Organize setup (issue #11): loading it with the blacklist (GET /api/organize, GET /api/blacklist), saving it whole (PUT /api/organize), the presets (GET /api/organize/presets, fetched once), the rule editor's live count (POST /api/organize/match) and the location texts relabelled from it. | `loadOrganize`, `saveConfig`, `matchCount` |
| `app/ui/organize-model.mts` | The Organize screen's pure rules (issue #11): editing the setup (reordering rules, labelling, pinning and unlabelling containers, new rule ids, a rule saved from the Inventory's filters, bags picked as targets), the words the screen shows (rule summaries, target chains with their fill, the live match count, the plan's reports and warnings, the trip list), which trips may run and why not, and how a running trip is watched until it reports back. | `LABEL_COLOURS`, `targetView`, `tripRows`, `stepWatch`, `acceptGate` |
| `app/ui/organize.mts` | The Organize screen (#/organize, issue #11, spec §3): the Rules card (ordered rules with a drag handle, a one-line filter summary, the target chain with each container's fill, the plan's counts, the catch-all, where empty bags are gathered) and the Plan card (room, cross-site, warnings and empty bags first, then the trip list and Run trip / Run all / Stop). | `showOrganize` |
| `app/ui/rule-editor.mts` | The Organize rule editor (issue #11, spec §3): a drawer with the rule's name, what it takes (a preset to start from, "name is any of", and the filter: search text, kinds and the rarity range, plus any other filter it was saved with from the Inventory, as removable tokens) and where those items go (labelled, unpinned containers and the bags inside them, in fill order, each with its fill). | `openRuleEditor` |
<!-- module-map:end -->

## Bridge & trips

<!-- module-map:start bridge -->
| Module | Role | Owns |
|---|---|---|
| `app/bridge-contract.mts` | The bridge protocol this app writes and the limits every packrat-bridge.py enforces on an Organize trip, as plain constants with no I/O, so a planner (app/organize.mts) can use them without loading the trip writer (app/bridge-trip.mts). | `BRIDGE_PROTOCOL`, `TRIP_MAX_BYTES`, `TRIP_NAME_MAX` |
| `app/bridge-status.mts` | The one reader of a bridge's status.json (docs/bridge-protocol.md, Status), checked against the status schema, with the one "online" definition; the status route and the Organize service read it. | `readBridgeStatus`, `ONLINE_S`, `BridgeStatus`, `BridgeResultRead` |
| `app/bridge-trip.mts` | The one writer of an Organize trip (issue #11). | `queueTrip`, `writeBridgeStop` |
| `app/ui/bridge.mts` | Highlight / Grab / Go-to buttons and the packrat-bridge.py connection status. | `sendBridge`, `runBridgeAction`, `grabAll`, `pollBridge`, `bridgeActionReason`, `bridgeFeatureSet` |
<!-- module-map:end -->

| Also here | Role | Owns |
|---|---|---|
| `app/schema/bridge.v1.schema.json` | The bridge protocol: command, result and status (`docs/bridge-protocol.md`). | the bridge shapes |
| `app/schema/bridge-trip.v1.schema.json` | An Organize trip line. | the trip shape |
| `app/vault-lib.mts` (bridge part) | What a bridge can do (the running bridge's report, else the newest scan, else the shipped manifest), the chain a command opens, and why an action cannot run, in the buttons' and the MCP tools' words. | `bridgeFeatures`, `newestScanAdapter`, `containerChain`, `bridgeRefusal`, `BRIDGE_ACTION_LABELS`, `BRIDGE_OFFLINE` |

## House map & client files

<!-- module-map:start house -->
| Module | Role | Owns |
|---|---|---|
| `app/art-fixture.mts` | Synthetic client files for the item-art tests (no game data ships in the repo): a UOP container holding named entries, one item's static art, and a hues.mul. | `syntheticUop`, `syntheticArt`, `syntheticHues` |
| `app/art.mts` | Item art from the player's own client files (issue #174): the UOP container artLegacyMUL.uop (its table of entries, each found by the lookup3 hash of its name), one item's static art in it, and the colours of hues.mul. | `readUopTable`, `readUopEntry`, `uopHash`, `decodeStatic`, `readHues`, `hueOf`, `toRgba` |
| `app/facet-fixture.mts` | Builds a synthetic facetNN.mul for tests (no game data ships in the repo): the int16 width and height, then per row an int32 byte count and its runs, each a uint8 pixel count and a uint16 ARGB1555 colour. | `syntheticFacet` |
| `app/facet-map.mts` | The client's facetNN.mul world-map overviews, read from the player's own UO folder (issue #164). | `decodeFacet`, `renderRegion`, `MAX_SIDE` |
| `app/house-areas.mts` | The player's areas on the House map (issue #10, house-map.json): which area a stack of containers sits in. | `areaOfStack`, `inRects` |
| `app/house-capture.mts` | The houses the scans have captured (issue #10). | `houseIdOf`, `latestHouses`, `houseGroups`, `HOUSE_ITEM_REACH` |
| `app/house-fixture.mts` | Synthetic houses for the house model's tests (issue #10): no game data, every graphic below is made up and described by the synthetic tiledata built here. | the synthetic houses |
| `app/house-model-types.mts` | The house model's types and the GET /api/houses responses built from them, and the player's house names, areas and claims (GET/PUT /api/house-map, GET /api/house-claims); types only, importing only the schema's types, so the page's browser build can use them: app/house-model.mts re-exports them, the routes `satisfies` them, and ui/api-types.mts re-exports them. | `HouseModel`, `Level`, `Cell`, `Furniture`, `Stack`, `Spot`, `HouseSummary`, `HousesApiResponse`, `HouseApiResponse`, `HouseBounds`, `AreaRect`, `HouseArea`, `HouseEntry`, `HouseMapApiResponse`, `HouseMapPutApiResponse`, `HouseClaimsApiResponse` |
| `app/house-model.mts` | A house as the map draws it (issue #10), built from the newest capture of its tiles (app/house-capture.mts), the client's tiledata.mul (app/tiledata.mts; null when it was not found) and the fold's ground containers. | `buildHouseModel`, `plotBounds` |
| `app/house-names.mts` | <data>/house-map.json (issues #164 and #10): what the player says about each house, by house id ({ version: 1, houses: { "<id>": { name, bounds?, areas? } } }). | `checkHouseEntry`, `readHouseMap`, `saveHouseEntry`, `NAME_MAX`, `MAX_AREAS`, `AREA_COLORS` |
| `app/png.mts` | A minimal PNG encoder on node built-ins (issue #164): 8-bit RGB (or RGBA, issue #174), no interlace, every row filter type 0, one IDAT deflated by node:zlib, chunk CRCs from the table below. | `encodePng`, `encodePngRgba`, `crc32` |
| `app/tiledata-fixture.mts` | Builds a synthetic 7.x tiledata.mul for tests (no game data ships in the repo). | `syntheticTileData` |
| `app/tiledata.mts` | The client's tiledata.mul, read from the player's own UO folder (issue #10). | `readTileData`, `classify` (tiles), `FLAG`, `uoFolderFromTazuo`, `loadTileData` |
| `app/ui/house-links.mts` | Which house holds each container (issue #10), the one index of it: Inventory's item rows and the Containers view offer "Show on map" by it without loading any house's model, and the House map's search says where its other matches are by it. | `houseOfContainer`, `houseOfItem`, `showOnMap` |
| `app/ui/house-map-model.mts` | The House map's pure rules (issue #10, spec section 4): the projection (the client's angle, or top-down), the polygons of a tile and of a box, the painter's order, a level's bounds and their fit; below, the joins of a stack with the inventory and the Organize labels, the colour modes, the cut-away, the callout, the totals, the house picker, keyboard moves, the plain grid for chests outside any drawn house, and the scene of one level. | `project`, `paintOrder`, `chestViews`, `pickHouse` |
| `app/ui/house-map.mts` | The House map screen (#/map, #/map/<house id>; issue #10, spec section 4). | `showMap`, `applyMapPrefs` |
| `app/ui/houses-data.mts` | The House map's data (issue #10): the houses the scans captured (GET /api/houses), the player's house names and areas (GET /api/house-map, one house's entry saved with PUT /api/house-map/<id>, a house unclaimed with DELETE /api/house-claims/<id>), and each house's model (GET /api/houses/<id>). | `houses`, `housesData` |
| `app/ui/item-art.mts` | A container's in-game art (issue #174), drawn from the player's own client files through GET /api/item-art: an <img> in a square tile of the given size, scaled down to fit, or twice its size (pixelated) when that still fits (art under 16 px both ways in a 32 px tile), so a pouch still reads as a pouch. | `artTile`, `artUrl`, `containerArt` |
| `app/ui/world-map-model.mts` | The world map lightbox's pure rules (issue #164). | `MAX_PX_PER_TILE`, `zoomView`, `panView` |
| `app/ui/world-map.mts` | The world map lightbox (issue #164): the Where section's small map opens the whole facet in a modal dialog (components.mts openDialog: Esc, focus kept in and given back), fitted at first; the zoom buttons and keys zoom about the house while it is in view. | `openWorldMap` |
<!-- module-map:end -->

## Scrolls

<!-- module-map:start scrolls -->
| Module | Role | Owns |
|---|---|---|
| `app/ui/scrolls-model.mts` | The Inventory's Scrolls view as data (issue #181): power scrolls per skill and level, how close each skill is to a roll-up in the shard's Scroll Binder, what binding everything would leave, Scrolls of Transcendence per skill with an exact plan for the binder, the empty binders, and the header's facts. | `powerRows`, `sotPlan`, `bindEverything` |
| `app/ui/scrolls.mts` | The Inventory screen's Scrolls view (issue #181, #/scrolls and #/scrolls/sot): power scrolls and Scrolls of Transcendence per skill, against the shard's Scroll Binder recipes (the rules' scrollBinder; the math is ui/scrolls-model.mts). | `showScrolls` |
| `scripts/scrolls-fixture.mts` | The demo scans with more scrolls in Kestrel's chest, for the Scrolls view's Electron test (scripts/ui-scrolls.test.mts, issue #181): a skill that can bind now, one close to a roll-up, Scrolls of Transcendence that make an exact 2.0, some that can only bind past 5.0, and an empty Scroll Binder. | `writeScrollScans` |
<!-- module-map:end -->

The recipes are the shard rules' `scrollBinder` (Shard rules, above).

## Unravel

<!-- module-map:start unravel -->
| Module | Role | Owns |
|---|---|---|
| `app/ui/unravel-model.mts` | The words of the Unravel view's Gather into a bag dialog (issue #271), with no DOM, so app/unravel-model.test.mts tests them under plain node:test. | `gatherWeight`, `gatherButton` |
| `app/ui/unravel.mts` | The Inventory screen's Unravel view (issue #271, #/unravel): which pieces to unravel at a soul forge, and what they would give: the picker, the forecast, what is left out, the candidates by ingredient, Keep, the selection bar and Gather into a bag (through ui/move-to.mts's openPicker and startMove). | the `unravel` screen |
| `app/unravel.mts` | What unraveling a piece at a soul forge gives (issue #271): which pieces can be unraveled (unravelType), the imbuing weight the ingredient comes from (unravelWeight, ServUO Imbuing.GetTotalWeight with the imbuing maxes), and what a character with a given Imbuing gets for that weight (unravelYield). | `unravelType`, `unravelWeight`, `unravelYield`, `expectedYield`, `leftOutReasons`, `onHand`, `PROPERTY_WEIGHTS`, `LEFT_OUT` |
<!-- module-map:end -->

The thresholds are the shard rules' `unravel` (Shard rules, above); `GET /api/items?unravel=1` (`app/item-query.mts`) lists the candidates, and the Keep list is settings.json's `unravelKeep`.

## MCP

<!-- module-map:start mcp -->
| Module | Role | Owns |
|---|---|---|
| `app/mcp-tools.mts` | The MCP server's tools (issue #211; the protocol and the listener are app/mcp.mts), one table entry each, calling the app's own routes over loopback, and where the page computes before a route, calling the same shared function; tools that wait stop at 45 s by default, 50 at most. | `TOOLS`, `INSTRUCTIONS`, `ToolContext` |
| `app/mcp.mts` | Pack Rat's built-in MCP server (issue #211): a second loopback listener inside the server process that speaks the stateless subset of MCP's Streamable HTTP transport, so Claude Code and other MCP clients can search the inventory, read character sheets and saved runs, run the Suit Builder and, with a second switch, act in game. | `createMcp`, `readMcpConfig`, `writeMcpConfig`, `PROTOCOL_VERSIONS`, `MCP_DEFAULT_PORT` |
<!-- module-map:end -->

## HTTP API contract

<!-- module-map:start api -->
| Module | Role | Owns |
|---|---|---|
| `app/api/bridge.mts` | What the bridge routes answer (app/http/routes/bridge.mts): GET /api/bridge/status, the command a POST /api/bridge queued, and POST /api/bridge/stop's acknowledgement. | `BridgeCurrentCommand`, `TripStepResult`, `BridgeResultEntry`, `BridgeAdapterReport`, `BridgeStatusApiResponse`, `BridgeQueueApiResponse` |
| `app/api/host.mts` | What the desktop shell's routes answer and take (app/http/routes/host.mts): POST /api/host/pick-folder's chosen folder and POST /api/host/open-path. | `HostPickFolderApiResponse`, `PickFolderBody`, `OpenPathBody` |
| `app/api/import.mts` | What the import routes answer and take (app/http/routes/import.mts): POST /api/import/paste's filed scan and POST /api/import/rescan's swept inboxes. | `ImportPasteApiResponse`, `ImportPasteBody`, `RescanApiResponse` |
| `app/api/inventory.mts` | What the inventory routes answer (app/http/routes/inventory.mts): GET /api/inventory's fold summary, GET /api/missing, GET /api/items in its rows, groups and hits forms, GET /api/items/by-serial, the scan blacklist and Forget. | `InventoryData`, `InventoryApiResponse`, `MissingApiResponse`, `ItemsApiResponse`, `ItemHitsApiResponse`, `ItemsBySerialApiResponse`, `BlacklistApiResponse`, `BlacklistPostBody`, `ForgetApiResponse` |
| `app/api/kinds.mts` | What the item-kinds routes answer and take (app/http/routes/kinds.mts): the player's own item kinds (<data>/item-kinds.json, app/item-kinds.mts) after GET, a change or an import. | `ItemKindsApiResponse`, `ItemKindsPostBody` |
| `app/api/mcp.mts` | What the MCP settings routes answer and take (app/http/routes/mcp.mts): the built-in MCP server's settings and its listener (app/mcp.mts). | `McpConfig`, `McpLive`, `McpApiResponse`, `McpPutBody` |
| `app/api/optimize.mts` | What a build answers (app/http/routes/optimize.mts, app/services/builds.mts, app/services/jobs.mts): the optimizer's result in each of its stages, the progress a job reports, and the optimize routes' bodies. | `Suit`, `SlotChange`, `Alternative`, `CoreTieBreak`, `OptResult`, `TieBreakResult`, `StrictStageProgress`, `StrictResult`, `AltShortfall`, `SolveProgress`, `ExactFields`, `ExactSolveResult`, `OptimizeResult`, `OptimizeStartApiResponse`, `OptimizeCancelApiResponse`, `JobSnapshot`, `OptimizeStatusApiResponse`, `JobDoneEvent`, `JobFailedEvent`, `JobCancelledEvent`, `EvaluateApiResponse` |
| `app/api/prefs.mts` | What the profile and preference routes answer (app/http/routes/prefs.mts): the profiles with the shard's built-in templates and a PATCH's stamps, the page's own view choices, and the TazUO panel's options. | `UiPrefs`, `UiPrefsApiResponse`, `ProfilesApiResponse`, `ProfilesPatchApiResponse`, `TazuoPanelApiResponse` |
| `app/api/routes.mts` | The HTTP API's route map: every /api route the server registers (app/http/routes/), keyed "METHOD /path" with a path parameter written <name>, and the type of what it answers with 200 (`res`) and of the JSON body it reads (`body`). | `ApiRoutes`, `ApiEntry`, `OkApiResponse`, `Untyped`, `EventStream`, `Png`, `ApiResponse`, `ApiBody` |
| `app/api/setup.mts` | What the setup and settings routes answer and take (app/http/routes/setup.mts, settings.mts): settings.json as the server reports it, the shard's rules, the setup wizard's adapters, locate and install, the paste scanner, the update check and the retention clean-up. | `ClientSettings`, `Retention`, `SettingsData`, `SettingsApiResponse`, `SettingsPutBody`, `CleanupBody`, `CleanupApiResponse`, `ShardOption`, `RulesApiResponse`, `AdapterSummary`, `AdapterCapabilities`, `InstalledVersionInfo`, `SetupApiResponse`, `PasteScannerApiResponse`, `LocateApiResponse`, `InstallApiResponse`, `UpdateCheckApiResponse`, `LocateBody`, `InstallBody` |
<!-- module-map:end -->

The route map is checked against the routes `app/http/routes/` registers by `scripts/api-routes.test.mts`, both ways.

## Server

<!-- module-map:start server -->
| Module | Role | Owns |
|---|---|---|
| `app/atomic-write.mts` | The one way this app replaces a file: write a randomly-named temp beside it, then rename the temp over the destination. | `atomicReplace`, `writeFileAtomic`, `moveAside` |
| `app/config.mts` | Every path the server, bench and adapters agree on, the port and the token, resolved once from flags, then the environment, then defaults; it also creates the data folder's directories. | `resolveConfig`, `ensureLayout`, `corePath`, `DATA_DIR_MODE`, `DATA_FILE_MODE`, `DEFAULT_PORT` |
| `app/data-dir-notice.mts` | GET /api/setup's dataDirCheck and the sentence that explains it, that the client's scripts write to another data folder; browser-safe, so the server's startup log and the page (app/ui/messages.mts re-exports it) share one sentence. | `dataDirNotice`, `DataDirCheckInfo` |
| `app/guards.mts` | The checks a request field or a hand-edited data file is held to: a real string of bounded length, an integer in an inclusive range, a serial. | `isBoundedString`, `isBoundedInt`, `MAX_SERIAL`, `short` |
| `app/http/context.mts` | What the route modules are built from: the config, what only the desktop shell or a test supplies, the stores and the services, all made once by startServer (app/vault-server.mts, the composition root). | `ServerContext`, `HostBridge`, `ClientSearch` |
| `app/http/respond.mts` | How the server answers: send() with the headers every response carries, the event streams' own header set, the Content-Security-Policy, and the guard that turns a body that is not a JSON object into a 400. | `send`, `SSE_HEADERS`, `CSP`, `asObject` |
| `app/http/router.mts` | The route table: each route a method and a path (a string matched exactly, or a RegExp), tried in table order. | `Route`, `NEXT`, `dispatch` |
| `app/http/routes/blacklist.mts` | GET\|POST /api/blacklist and DELETE /api/blacklist/<serial>. | `routes` |
| `app/http/routes/bridge.mts` | The in-game bridge: POST /api/bridge, POST /api/bridge/stop and GET /api/bridge/status. | `routes` |
| `app/http/routes/forget.mts` | POST /api/forget and POST /api/forget-character. | `routes` |
| `app/http/routes/host.mts` | What only the desktop shell can do (POST /api/host/pick-folder and /api/host/open-path) and the shared event stream (GET /api/events). | `routes` |
| `app/http/routes/houses.mts` | The house map: GET /api/houses[/<id>], GET /api/facet-map/<facet>.png, GET /api/item-art/<graphic>.png, GET /api/house-map, PUT /api/house-map/<id>, GET /api/house-claims and DELETE /api/house-claims/<id>. | `routes` |
| `app/http/routes/import.mts` | POST /api/import/paste and /api/import/rescan. | `routes` |
| `app/http/routes/inventory.mts` | The inventory: GET /api/inventory, /api/missing, /api/items and /api/items/by-serial. | `routes` |
| `app/http/routes/kinds.mts` | The player's item kinds: GET\|POST /api/item-kinds and POST /api/item-kinds/import. | `routes` |
| `app/http/routes/mcp.mts` | The built-in MCP server's settings: GET\|PUT /api/mcp and POST /api/mcp/token. | `routes` |
| `app/http/routes/optimize.mts` | The Suit Builder's builds and saved runs: POST /api/optimize, the per-job /api/optimize/<id>/events\|cancel\|status, POST\|GET /api/runs and GET\|PUT\|DELETE /api/runs/<id>, and POST /api/evaluate. | `routes` |
| `app/http/routes/organize.mts` | Organize: GET\|PUT /api/organize, GET /api/organize/presets, POST /api/organize/match and /api/organize/propose, GET /api/organize/plan and POST /api/organize/trip; and Move to (issue #270), which runs as Organize trips: POST /api/move/plan and /api/move/trip. | `routes` |
| `app/http/routes/prefs.mts` | The player's saved choices: GET\|PATCH /api/profiles, /api/ui-prefs and /api/tazuo-panel. | `routes`, `patchProfiles` |
| `app/http/routes/settings.mts` | GET\|PUT /api/settings, POST /api/retention/cleanup and GET /api/rules. | `routes` |
| `app/http/routes/setup.mts` | The setup wizard: GET /api/setup, GET /api/setup/scanner, POST /api/setup/locate and /api/setup/install, and GET /api/update-check. | `routes`, `MAX_PATH_LEN`, `NO_CLIENT_FOLDER` |
| `app/http/routes/static.mts` | The page and the browser-shared modules: GET / (index.html), the favicon and logo, each module the page imports at run time (/<name>.mjs, compiled into app/dist/), GET /ui/<name> and GET /ui/fonts/<name>.woff2. | `routes` |
| `app/log.mts` | The one way the server appends a line to its log file. | `safeAppendLog` |
| `app/migrate.mts` | The one registry of data-file migrations: for each kind of document Pack Rat keeps (scan, profiles, runs, organize, organize-state, item-kinds, house-map, mcp, settings, ui-prefs), the version this build writes and the ordered, numbered, pure steps that bring an older document up to it, each calling its kind's own domain function; a newer document comes back untouched and marked `newer`, and app/fixtures/golden/ holds golden files per version. | `migrate`, `DOC_KINDS`, `DocKind`, `versionOf`, `newerNotice`, `MigrateContext` |
| `app/read-body.mts` | Reading a request's JSON body under a byte cap, shared by the app server (app/vault-server.mts) and the MCP listener (app/mcp.mts). | `readBody`, `HttpError`, `isJsonContentType` |
| `app/store/blacklist.mts` | <data>/scan-blacklist.json: the containers scans never open (GET/POST/DELETE /api/blacklist). | `createBlacklistStore` |
| `app/store/house-claims.mts` | <data>/house-claims.json (issue #299): the houses the player claimed, which the TazUO panel writes too: only valid entries read, which claims a house's bounds fall under, and the claims made at the first start from the houses already named. | `createHouseClaimsStore`, `claimsOver`, `claimsFromHouseMap`, `MAX_CLAIMS` |
| `app/store/item-kinds.mts` | <data>/item-kinds.json: the player's own item kinds (issue #150, app/item-kinds.mts; the /api/item-kinds routes). | `createItemKindsStore` |
| `app/store/json-file.mts` | The one way a store reads and writes a JSON data file: each reader's bad-file policy named (empty, aside, skip), the writer's folder, atomic write, indent and trailing newline, the 409 for a file a newer Pack Rat made, and a file's content stamp for saves that name what they read. | `readJsonFile`, `writeJsonFile`, `updater`, `newerOnDisk`, `refuseNewer`, `fileStamp` |
| `app/store/organize-state.mts` | <data>/organize-state.json: Organize's results overlay (app/organize-state.mts). | `createOrganizeStateStore` |
| `app/store/organize.mts` | <data>/organize.json: Organize's setup (issue #11, app/organize-config.mts; GET/PUT /api/organize). | `createOrganizeStore` |
| `app/store/profiles.mts` | <data>/profiles.json, the Suit Builder's characters and templates (GET/PATCH /api/profiles): seeded from the defaults, a damaged file moved aside and reseeded, an old shape migrated (with <data>/ui-prefs.json beside it) after a dated backup of each, a newer one read-only, and the shard's built-in templates read. | `createProfilesStore` |
| `app/store/runs.mts` | <data>/runs/: one JSON file per saved run (finished builds and Manual suits; /api/runs). | `createRunsStore` |
| `app/store/scans.mts` | <data>/scans/: every accepted scan, one JSON file each (the watcher writes them, writeTombstone adds the tombstones /api/forget* asks for, retention removes old ones). | `createScansStore`, `TombstoneRoot` |
| `app/store/settings.mts` | <data>/settings.json: the shard, the client, the setup and retention choices. | `createSettingsStore`, `SettingsDoc` |
| `app/store/ui-prefs.mts` | <data>/ui-prefs.json: the page's view choices (GET/PUT /api/ui-prefs), the fields it may hold, and the checks a request's or a hand-edited file's value is held to. | `createUiPrefsStore`, `UI_PREF_CHOICES`, `UI_PREF_LISTS`, `UI_PREF_VERSIONS`, `isColWidths`, `isDrawerWidth`, `isManualSuit` |
| `app/vault-server.mts` | Pack Rat's local HTTP server and its composition root: startServer(config) returns { server, port, url, close() } and nothing runs at import time; it builds the stores, services and route table, runs the Host, Origin and token checks, dispatches, maps errors to statuses and listens, and close() tears down every timer, stream and worker; every HTML response carries the Content-Security-Policy, every response sent through send() carries nosniff, no-store and DENY framing, a body-reading PUT or POST must declare JSON, and headersTimeout is 60 s and requestTimeout 300 s, with only the idle-socket timeout off so an SSE stream survives (docs/architecture.md, "The server's request checks"). | `startServer`, `defaultClientSearch`, `ServerHandle`, `StartServerOptions`; re-exports `OPTS_LIMITS`, `HostBridge`, `ClientSearch`, `JobTimings` |
<!-- module-map:end -->

| Also here | Role | Owns |
|---|---|---|
| `app/schema/house-claims.v1.schema.json` | One entry of `<data>/house-claims.json`, which the app and the TazUO panel both write: `app/store/house-claims.mts` checks entries against it, and its accept and reject cases (`app/fixtures/contract-cases/house-claims.json`) run in the TypeScript and the Python suites. | the house claims shape |
| `app/schema/blacklist.v1.schema.json` | One entry of `<data>/scan-blacklist.json`, which the app and the game clients' blacklist scripts both write: `app/store/blacklist.mts` checks entries against it, and its shared cases (`app/fixtures/contract-cases/blacklist.json`) say what the app keeps and what the scanners still skip. | the blacklist shape |

The services below are factories with explicit dependencies (stores, getters, a log function), built once by `startServer` and never importing `app/http/`:

<!-- module-map:start services -->
| Module | Role | Owns |
|---|---|---|
| `app/services/events.mts` | Server-Sent Events: one event written to a stream, and the shared bus behind GET /api/events that tells every open page what changed (a scan accepted or rejected, the inventory or the runs changed). | `sse`, `createEventBus` |
| `app/services/houses.mts` | The house map's client files and models (issues #10, #164, #174): the UO folder, its tiledata.mul and facetNN.mul, the facet PNGs cut from them, the item art PNGs drawn from its artLegacyMUL.uop and hues.mul, and the house models built from the inventory, each kept while its inputs stay the same. | `createHousesService` |
| `app/services/inventory.mts` | The inventory every view and bridge command reads: the scans folded (cached), with Organize's results overlay applied (cached on its own). | `createInventoryService`, `FoldValue`, `InvValue` |
| `app/services/jobs.mts` | Optimizer jobs: one worker thread per build, its progress and outcome for the per-job event stream, one running build per client (a newer one supersedes it), a server-wide ceiling, and a finished build saved as a run. | `createJobsService`, `Job`, `JobTimings` |
| `app/services/organize.mts` | The Organize service (issues #11, #127, #131): finished trips read back into the results overlay, what a plan starts from, the plan, a trip queued for the bridge, and Put away's requests from the in-game panel. | `createOrganizeService` |
| `app/services/retention.mts` | The retention service (issue #28): which old scans and saved runs settings.json's `retention` lets go, and removing them, one prune at a time. | `createRetentionService` |
| `app/services/settings.mts` | The settings this run uses and the shard's rules: settings.json as saved, with the two startup fallbacks laid over it, and the rules that settings.json names, handed to vault-lib. | `createSettingsService`, `EffectiveSettings` |
| `app/services/setup.mts` | The adapters this install ships and what the client setup needs of them: which ids are real, what each one's bridge declares it can do, and whether the client's installed scripts write to this data folder. | `createSetupService` |
<!-- module-map:end -->

What still lives inside `startServer`: the startup warning; the wiring of the stores, services and route table from the config's paths (the single files in the data folder, `<data>/ui-prefs.json`, `<data>/tazuo-panel.json`, `<data>/scan-blacklist.json`, `<data>/item-kinds.json`, `<data>/organize.json`, `<data>/house-map.json`, `<data>/organize-state.json`, have their paths built here or in their route module, not in `app/config.mts`); the inbox watchers (`startWatchers`); the Host, Origin and token checks ahead of every route (`docs/architecture.md`, "The server's request checks"); the 404, the `HttpError` status mapping and the stack-free 500; listening and closing.

## Desktop shell

<!-- module-map:start shell -->
| Module | Role | Owns |
|---|---|---|
| `electron/host-args.mts` | The runtime checks electron/main.mts runs on the two host-bridge arguments before they reach an OS call (shell.openPath, dialog.showOpenDialog). | `openPathTarget`, `dialogTitle` |
| `electron/main.mts` | The Electron shell's main process: it forks the server, opens one window, stamps a per-launch token, keeps a single instance, and answers the native folder picker and Open folder. | the window and token lifecycle |
| `electron/navigation.mts` | The two decisions electron/main.mts makes about where the page may go: whether a navigation stays on the local server's origin, and whether a link the page tries to open in a new window may be handed to the OS browser. | `navigationDecision`, `externalOpenDecision` |
| `electron/pending-calls.mts` | The id→promise registry electron/server-entry.mts keeps for the host calls it has relayed to the main process (see ./protocol.mts's HostRequestMessage/HostResultMessage). | `createPendingHostCalls`, `HOST_CALL_TIMEOUT_MS` |
| `electron/protocol.mts` | The message shapes carried over the two-way channel between electron/main.mts (the Electron main process) and electron/server-entry.mts (its utilityProcess.fork() child running the Pack Rat server, see docs/architecture.md's "The host bridge" section). | `HostRequestMessage`, `HostResultMessage`, `ChildToMainMessage`, `MainToChildMessage` |
| `electron/restart-policy.mts` | Whether electron/main.mts restarts a server child that exited unexpectedly. | `shouldRestart`, `RESTART_WINDOW_MS` |
| `electron/server-entry.mts` | The Pack Rat server, forked as an Electron utility process by electron/main.mts (utilityProcess.fork). | — |
<!-- module-map:end -->

`electron/README.md` and `docs/architecture.md` describe the processes.

## Installer & adapters

<!-- module-map:start installer -->
| Module | Role | Owns |
|---|---|---|
| `app/installer.mts` | Pure functions behind the setup wizard and Settings: adapter discovery, client-folder detection, script install/verify, the running-script guard, scan import, the data-folder check and a GitHub-releases update check, everything per client (scripts folders, the client folder's name, retired scripts, the stop hint, the registrar) coming from the adapter manifest's install section; it rejects relative and UNC folder paths, reads an installed version from regular files only (O_NOFOLLOW, first 64 KiB), writes each script atomically with packrat-paths.json last, accepts a release URL only under this repository's releases, and imports no Electron. | `listAdapters`, `candidateClientRoots`, `validateScriptsDir`, `installedVersion`, `installScripts`, `checkForUpdates`, `checkScriptsDataDir`, `heartbeatAlive`, `RUNNING_MESSAGE_OTHER`, `REGISTRARS` |
| `app/tazuo-panel-prefs.mts` | The TazUO panel's options and their validation, with no Node imports, so the page's types (app/ui/api-types.mts) can share them. | `PANEL_DEFAULTS`, `panelPrefsError`, `panelPrefsOf`, `HOTKEY_KEYS` |
| `app/tazuo-panel.mts` | The app's side of the TazUO in-game panel (adapters/tazuo/packrat-panel.py). | `readPanelPrefs`, `writePanelPrefs`, `addPanelAutostart`, `tazuoRunning` |
| `scripts/gen-contracts.mts` | Copy the adapters' shared Python helpers from adapters/_shared/ into every script that carries them, between `# BEGIN generated: <fragment>` / `# END generated: <fragment>` markers, render each script's manifest constants from its capabilities.json, and write the web scanner's TypeScript copies (`// BEGIN generated:` blocks) through a TypeScript emitter; --check fails when a committed script differs. | `generate`, `splice`, `fragmentProblems`, `renderManifest`, `tsFragment` |
| `scripts/make-adapter-fixture.mts` | `node scripts/make-adapter-fixture.mts <real-scan.json> <out.json>` turns one real scan file (v1 or v2, from local/scans/, never committed) into an anonymised fixture safe to commit and fold in tests. | — |
<!-- module-map:end -->

| Also here | Role | Owns |
|---|---|---|
| `adapters/tazuo/`, `adapters/razor-enhanced/`, `adapters/classicuo-web/` | Each game client's scripts, `adapters/<id>/capabilities.json` (the manifest, `app/schema/adapter-manifest.v1.schema.json`) and README (`docs/adapter-guide.md`). | the adapter contract and install facts, `ADAPTER_VERSION` |
| `app/schema/tazuo-panel.v1.schema.json` | `<data>/tazuo-panel.json`, which the app and the TazUO panel both write and read field by field: the shape, and the shared cases (`app/fixtures/contract-cases/tazuo-panel.json`) both readers run. | the panel prefs shape |
| `app/schema/put-away.v1.schema.json` | Put away's two files between the TazUO panel and the app: the request the panel drops in its inbox and the answer the app writes back, with the shared request cases (`app/fixtures/contract-cases/put-away.json`). | the Put away shapes |
| `app/schema/packrat-paths.v1.schema.json` | The packrat-paths.json beside the installed game scripts, naming the data folder they write into: the shape, and the shared cases (`app/fixtures/contract-cases/packrat-paths.json`) the scripts' `data_dir()` and Setup's data-folder check both run. | the paths file shape |
| `app/schema/heartbeat.v1.schema.json` | The TazUO panel's heartbeat, `<data>/bridge/<adapter>/panel.json`, which the installer's running-script guard reads with the bridge's status.json, and its shared cases (`app/fixtures/contract-cases/heartbeat.json`). | the heartbeat shape |
| `adapters/_shared/` | The shared Python helper fragments: one file per helper family, `<adapter>/` for one adapter's own. Not shipped. | the shared adapter helpers |
| `adapters/fake_clients.py`, `adapters/test_adapters.py`, `adapters/test_scanners.py`, `adapters/test_bridges.py`, `adapters/test_panel.py` | Fake game clients and the adapter tests, run by `app/adapters.test.mts`. | — |

## UI

The page is `app/index.html` plus `app/ui/`, compiled by `scripts/build-ui.mts` and served through the `/ui/<name>` route. Screens that belong to one feature are listed in that feature's section above: Suit Builder, Organize, House map, Scrolls, Unravel. The DOM-free modules are the ones `node:test` suites import directly.

### Bootstrap

<!-- module-map:start ui-bootstrap -->
| Module | Role | Owns |
|---|---|---|
| `app/ui/app.mts` | Bootstrap: load(), screen and drawer switching, tab-nav wiring, the tooltip/bridge kickoff. | — |
| `app/ui/breakpoints.mts` | The page's width breakpoints in CSS pixels, each the widest window its narrower layout applies to (a `max-width` query; a `min-width` query starts one pixel above it). | `BREAKPOINTS`, `upTo` |
| `app/ui/inventory-data.mts` | The inventory and profiles the page draws from: reload() fetches them into the store and then dispatches "inventorychange" on document, which every screen drawn from them listens for. | `reload`, `retryLoad`, `fetchAllItems`, `inventoryLoader` |
| `app/ui/nav.mts` | The hash routes, the screen registry they dispatch to, and the cross-screen ways into the Inventory's Items view. | `parseRoute`, `routeFor`, `registerScreen`, `showRoute`, `showItem`, `showContainer`, `showSearch`, `showKind`, `showCharacterItems` |
| `app/ui/shell.mts` | The app shell (design spec 3.1): the left sidebar (nav, the shard and last-scan line, the bridge status control and its popover), collapsing to icons below 1180 px or when pinned collapsed, the nav's counts and current item, and ⌘I for Import. | `initShell`, `renderNavCounts` |
| `app/ui/theme.mts` | The look: which theme family and light/dark mode <html> carries (data-theme, data-mode; app/ui/tokens.css reads both). | `resolveTheme`, `resolveMode`, `applyLook`, `BUILT_THEMES` |
<!-- module-map:end -->

| Also here | Role | Owns |
|---|---|---|
| `app/index.html` | The page shell: markup, one `<main>` per screen, the stylesheet links, the one module script. No inline scripts (the CSP forbids them) and no remote loads: the fonts are bundled under `app/ui/fonts/` with their OFL license texts. | the screens' containers |

### Infrastructure

<!-- module-map:start ui-infra -->
| Module | Role | Owns |
|---|---|---|
| `app/ui/api-types.mts` | Every response shape the page reads off its own fetches: the house, Organize and saved-run shapes re-exported from the types-only modules (runs narrowed), the settings and setup shapes from app/api/setup.mts the inventory shapes from app/api/inventory.mts and the bridge's from app/api/bridge.mts, the rest declared here. | the hand-declared `*ApiResponse` types |
| `app/ui/api.mts` | The one place every page fetch goes through (Task 4, localhost security). | `api`, `CLIENT_ID` |
| `app/ui/dom.mts` | DOM helpers, formatting/label helpers, rarity, and the in-game style hover tooltip. | `el`, `$`, `fmtN`, `slotLabel`, `rarityColor`, `installTooltip` |
| `app/ui/events.mts` | The one shared EventSource("/api/events") for the page's life (Task 3, Phase 4). | `connectEvents` |
| `app/ui/item-tip.mts` | Where the one item tooltip (dom.mts's #tip) gets the item it shows (issue #10). | `createTipResolver` |
| `app/ui/items.mts` | resolveItems(serials): the page's one place to turn a bare serial into a full item record (location, tags, equippedBy…), now that GET /api/inventory no longer carries the whole item map (Task 5). | `resolveItems` |
| `app/ui/prefs.mts` | The one writer of the page's view choices (PUT /api/ui-prefs). | `prefs` |
| `app/ui/profiles.mts` | The one writer of the player's profiles (app/build-spec.mts's v3 shape). | `editProfiles`, `loadProfiles`, `setCharacterBuffs`, `setCharacterLabel` |
| `app/ui/store.mts` | The shared mutable state object, the bridge connection state, and invStamp. | `state`, `bridge`, `invStamp`, `AppState` |
<!-- module-map:end -->

### Components and shared widgets

<!-- module-map:start ui-components -->
| Module | Role | Owns |
|---|---|---|
| `app/ui/components.mts` | The page's component primitives (docs/ui.md), as small DOM builders over dom.mts's el(). | `box`, `txt`, `button`, `input`, `select`, `popover`, `combobox`, `createDrawer`, `openDialog`, `confirmDialog`, `table`, `menu`, `toast`, `FLEX_CLASSES` |
| `app/ui/dialog.mts` | The one-field prompt dialog, on components.mts's openDialog. | `promptText` |
| `app/ui/item-browser.mts` | The item browser (issue #12): the filter toolbar and its popovers, the active-filter strip, the columns and density popover, and the virtual table over its data source (GET /api/items by default), as a factory that can be mounted more than once. | `createItemBrowser`, `itemsSource` |
| `app/ui/item-parts.mts` | The item widgets every screen shares: an item's rarity, tags and location as elements, the row actions (Highlight, Grab, Go to) and the ⋯ menu, and the filter context the filter wording needs. | `rarityEl`, `tagEls`, `locationEl`, `tagWords`, `itemActions`, `itemMenu`, `filterContext`, `setItemNav` |
| `app/ui/paste-scanner.mts` | The Copy scanner script button for a paste-transport client (the ClassicUO web client): the wizard's copy step and Settings › Game client both use it. | `scannerCopy` |
| `app/ui/shard.mts` | changeShard(shard): the one place a shard switch is persisted and applied. | `changeShard` |
| `app/ui/sheet.mts` | The character sheet (design spec 4.5), shared by the Characters screen and the Suit Builder's result panel: a KPI row (five resists against their caps, attributes, pools), the worn gear as slot tiles in fixed groups, the properties as key/value lists, the skills and a footnote. | `sheetNode`, `SLOT_GROUPS`, `SHEET_GROUPS`, `RESISTS` |
| `app/ui/tazuo-panel.mts` | The two options of the TazUO in-game panel (app/tazuo-panel.mts): whether it shows its window at login, and its show/hide hotkey. | `panelControls` |
<!-- module-map:end -->

### Data modules (pure)

<!-- module-map:start ui-data -->
| Module | Role | Owns |
|---|---|---|
| `app/ui/adapter-copy.mts` | What the page says about each game client, written per adapter rather than assembled from its README title ("Run ClassicUO web client adapter (paste transport)'s scanner" is the sentence this replaces). | `adapterCopy`, `shortName`, `wizardSteps` |
| `app/ui/adapters.mts` | Pure adapter-selection helpers shared by the wizard and the Import tab. | `defaultAdapterId`, `availableAdapters`, `platformCompatible` |
| `app/ui/messages.mts` | The plain sentences the page shows for an outcome the server reports as a count, a status code or a one-word field. | `errorText`, `bridgeView`, `optimizeErrorMessage`, `prefsSaveFailed` |
| `app/ui/view-state.mts` | The page's pure state rules: what a refresh keeps and what "Clear all" resets. | `optionsKeeping`, `clearedQuery`, `COLS_VERSION` |
<!-- module-map:end -->

### Screens

<!-- module-map:start ui-screens -->
| Module | Role | Owns |
|---|---|---|
| `app/ui/characters.mts` | The Characters screen (design spec 4.4, 4.5): the roster at #/characters, one 48 px row per character with their resists against the cap, and a character's sheet at #/characters/<Name> (the sheet itself is sheet.mts's sheetNode, shared with the Suit Builder). | `renderCharacters`, `showCharacter` |
| `app/ui/containers.mts` | The Inventory screen's Containers view (design spec 4.2): every scanned root container in the same dense table the Items view uses, grouped by character with the ground containers last, a Fill column (each container's Contents line), and a row "⋯" menu with "Show these items", "Show on map" (a container a house map holds: ui/house-links.mts, issue #10), "Show missing items" (a root with items missing since its last scan, which also shows a badge; issue #99), "Highlight in game" (ground containers; the bridge's highlight with the container as its target, issue #10), "Label…" / "Edit label…" (ground containers not blacklisted; Organize, issue #11), "Blacklist…" (ground containers) and "Forget…". | `renderContainers`, `labelContainer` |
| `app/ui/import.mts` | The Import drawer (design spec 4.9): paste a scan, or bring in scan files, with an instant preview of what will land before anything is sent. | `renderImport` |
| `app/ui/inventory.mts` | The Inventory screen's Items view (design spec 4.2): one item browser (item-browser.mts) on index.html's #inv-view-items, with the item peek (peek.mts) as its detail panel, its columns saved to ui-prefs, and the Inventory's ids kept. | `initFilters`, `fetchItems` |
| `app/ui/kinds.mts` | The player's own item kinds (issue #150), <data>/item-kinds.json through /api/item-kinds. | `openClassify`, `exportKinds`, `importKinds` |
| `app/ui/move-to.mts` | The Inventory's selection and Move to (issue #270): the checkboxes' hooks for the item browser, the selection bar (#inv-selbar: the count, why worn rows were left out, Select all matching, Grab, Move to… and Clear), the Move to… picker, and the result line (#inv-move-result) that follows a Move's trips, with Stop, Pin them here and Move back. | `selectionHooks`, `attachMoveTo` |
| `app/ui/peek.mts` | The Inventory's item peek (design spec 4.3, artboard 3): the selected row's item in a panel docked beside the table (400 px, 360 below 1280, laid over the table below 1180), while the table stays live. | `openPeek`, `closePeek` |
| `app/ui/settings.mts` | The Settings screen (design spec 4.11): five sections (General, Game client, Data, AI assistants (MCP), Updates) in a column of cards made of setting rows — title and help on the left, the control on the right. | `renderSettings` |
| `app/ui/wizard.mts` | The first-run / "Run setup" wizard (design spec 4.10): shard → client → client folder → install scanner for a folder-transport client (see docs/adapter-guide.md), or shard → client → copy scanner → paste your first scan for a paste-transport one, like the ClassicUO web client. | `openWizard` |
<!-- module-map:end -->

### Models (pure)

<!-- module-map:start ui-models -->
| Module | Role | Owns |
|---|---|---|
| `app/ui/format.mts` | Pure text formatting the whole page shares: a count and its noun. | `plural` |
| `app/ui/import-preview.mts` | The Import drawer's preview card, as data: what a parsed scan holds, whether it replaces one already in Pack Rat, and the sentence the primary button says. | `scanPreview` |
| `app/ui/inv-model.mts` | The Inventory screen's pure rules: the query string a filter state sends, the active-filter tokens and their wording, the counts and plurals in the strip and the footer, the sentence that explains an empty result, which slice of rows the virtual table draws and fetches, and the table's keyboard model. | `DEFAULT_COLS`, `ITEM_COLS`, `COL_GROUPS`, `queryParams`, `activeFilters` |
| `app/ui/move-model.mts` | Move to's pure rules (issue #270): the Inventory's selection (ticked rows, a shift-click range, the rows loaded so far, then every item matching the filter; a worn item is never in it), the containers the picker offers, and the words of the selection bar, the picker and the result line. | `Selection`, `toggleRows`, `selectAllMatching`, `selectionBody`, `destGroups` |
| `app/ui/roster.mts` | The Characters roster's rows, filter and sort, and the sheet's scan summary, kept free of the DOM and of app.mts so app/ui-characters.test.mts can import them. | `rosterView`, `sheetMeta`, `characterNames` |
<!-- module-map:end -->

Stylesheets (`app/ui/tokens.css`, `app/ui/britannia.css`, `app/ui/components.css`, `app/ui/styles.css`, `app/ui/shell.css` and one per screen) and the bundled fonts under `app/ui/fonts/` are served straight from source. CSS classes are global across every stylesheet. Icons are `app/assets/icon.png`, `app/assets/favicon.png` and `app/assets/logo-mark.png`; the installers' master is `build/icon.png`.

## Tooling & tests

<!-- module-map:start tooling -->
| Module | Role | Owns |
|---|---|---|
| `app/server-fixture.mts` | Test fixture: startTestServer starts the real server the way every server test file needs it, with no reach outside the test. | `startTestServer`, `FAKE_HOME`, `updateRequests` |
| `app/server-routes-fixture.mts` | Test fixture for the route test files (app/server.test.mts and app/server-<family>.test.mts): the response shapes they read, asJson(), the shard's rules, and the helpers more than one of them uses (raw requests, an SSE reader, the demo fold, the log). | `asJson`, `UOALIVE`, `rawReq`, `sseReader`, `foldFixtures`, `logText` |
| `app/timing-fixture.mts` | Speed checks that time the code, not a busy CI runner (issue #195). | `fastestMs` |
| `scripts/build-schema-types.mts` | Derive app/schema/types.d.mts from the JSON Schema files that are the runtime authority for Pack Rat's scan, bridge, bridge trip, rules, profile, adapter manifest and house claims shapes (app/schema/*.schema.json, enforced at runtime by app/schema/validate.mts). | `buildSchemaTypes`, `schemaToTypeSource` |
| `scripts/build-ui.mts` | Compile the browser-facing TypeScript (app/ui/**, vault-lib.*, item-query.*, unravel.*, organize-config.*, buffs.*, evaluate.*, run-settings.*, build-spec.*, swing.*, solver/scoring.*, guards.*, data-dir-notice.*, scan-schema.*, schema/validate.*) via tsconfig.browser.json into app/dist/, which is what the server actually serves the page from (never the source tree — see app/http/routes/static.mts). | `buildUi` |
| `scripts/builder-ui.mts` | The Suit Builder Electron tests' shared steps (scripts/ui-builder-*.test.mts): the launch at 1440 × 900, Build Settings open on a tab and closed again, the Suit Builder opened with a quick time budget, Build pressed, and the wait for its result. | `launch`, `settings`, `openBuilder`, `pressBuild`, `built` |
| `scripts/changelog.mts` | The changelog's fragments: each pull request adds `changelog.d/<short-name>.md`, and a release puts them together into CHANGELOG.md. | `fragmentError`, `changelogError`, `release` |
| `scripts/contrast-probe.mts` | Measures WCAG contrast on the rendered page (design spec 2.3). | `probeContrast` |
| `scripts/electron-app.mts` | The one way an Electron UI test launches Pack Rat (issue #338, the quality pass's shared fixture): the skip when Electron can't run here, a temp data folder, the launch itself (update check off, the test's own client home, the page's errors collected, the page loaded before a test sets a hash, the window sized), the teardown, a stand-in bridge and a poll for file-backed facts. | `skipWithoutElectron`, `tempDataDir`, `launchApp`, `fakeBridge`, `until` |
| `scripts/electron-window.mts` | The Electron UI tests' one way to size the window (docs/ui.md, TESTING.md). | `fitWindow`, `testEnv` |
| `scripts/localstorage-shim-for-tests.mts` | A minimal globalThis.localStorage stub, installed as a side effect of importing this module (it has no exports). | — |
| `scripts/module-index.mts` | The module tables in docs/module-map.md, generated from each module's own header. | `headerOf`, `renderTables`, `withTables` |
| `scripts/run-suite.mts` | The counting half of scripts/test-runner.mts: build, discover, drive node:test's run() over the files, and fold its event stream into the summary shape TESTING.md documents. | `runSuite`, `patternsFor` |
| `scripts/select-tests.mts` | The mapping behind `./scripts/test_runner.sh --changed`: from the files a branch changed to the test files worth running for them. | `selectTests`, `SCREENS` |
| `scripts/start.mts` | Start the Pack Rat server (bare, no Electron). | — |
| `scripts/test-file-watchdog.mts` | Preloaded into every test file's process by scripts/run-suite.mts (`--import <this file>?ms=<grace>`). | — |
| `scripts/test-index.mts` | The index of test files in TESTING.md: each test file with the first sentence of its header. | `renderIndex`, `summaryOf`, `indexIsCurrent` |
| `scripts/test-runner.mts` | The project's standard test interface behind scripts/test_runner.sh: --smoke, --fast, --changed, full. | the summary file, test_logs/latest_summary.json |
<!-- module-map:end -->

Every `*.test.mts` file sits beside the module it is named after and describes itself in its header comment; `TESTING.md`'s test index lists them with each header's first sentence.

## Where concepts are restated today

These concepts have one owner above but are copied by hand elsewhere. Until the architecture pass (#218) gives each one source, a change to one copy means updating the others.

- **The solvers' scoring rules.** Owner of the shared constants, the profile's reading and the single-suit terms: `app/solver/scoring.mts`. The core (`scripts/optimizer-core.mts`) and the MIP (`app/mip.mts`) still each state a few rules in their own shape (an evaluator and rows): the Resisting Spells minimum, the start vector's step pick, the slot lists, and diagnostics' own reading of which floors ask for something. The list, and what catches a mismatch, is the "rules written twice" table in `docs/solver.md`'s "Before you change the solvers".
- **Gear slots.** Owner: `app/vault-lib.mts` (`LAYER_TO_SLOT`, `GEAR_SLOTS`, the slot-to-group table `GEAR_SLOT_GROUPS` with `SLOT_GROUP` and `SLOTS_IN_GROUP`, `REQUIRED_SLOTS`, `SLOT_LABELS`). The sheet's tiles, the item browser's slot filter and the meditation slot set derive from the table. Still listed by hand: `JEWEL_SLOTS` inside `app/vault-lib.mts`; the default and optional slot lists in `scripts/optimizer-core.mts` (kept as their own lists; `app/solver.test.mts` and `app/slot-groups.test.mts` tie them to the table); `MANUAL_GROUPS` in `app/ui/manual-model.mts` (a layout; its test checks it holds `GEAR_SLOTS` once, in order); the Armor and Jewelry groups in `app/organize-strategies.mts`, which keep the neck with Jewelry on purpose (neck armor joins Armor by name, through `NECK_ARMOR_WORDS`). `scripts/slot-lists.test.mts` fails on any other gear slot list.
- **Property display groups.** Owner: `app/vault-lib.mts` (`PROPERTIES`, from which `PROP_PATTERNS`, `PROP_LABELS`, `PROP_FULL`, `NOT_BUILDER_KEYS` and `app/item-query.mts`'s `EXTRA_COLS` are derived). Still grouped by hand: the column groups in `app/ui/inv-model.mts`; the sheet groups in `app/ui/sheet.mts`; `TOTAL_KEYS` in `app/ui/manual-model.mts`; `CASTER_PROPS` and `MELEE_PROPS` in `app/organize.mts`; bare key strings in `app/buffs.mts`, `app/mip.mts` and the core.
- **HTTP response shapes.** The houses, Organize plan and proposal, and `/api/runs` responses are shared: `app/house-model-types.mts`, `app/organize-types.mts` and `app/runs-types.mts`, which the routes `satisfies` and `app/ui/api-types.mts` re-exports, so a renamed field fails the typecheck on both sides. Every other response, `GET /api/bridge/status` included, is still declared by hand in `app/ui/api-types.mts`, and no test compares those with what the routes in `app/http/routes/` build. Change such a route's response and its type together.
- **The browser-shared module list.** A server module the page imports at run time is compiled into `app/dist/` by `build:ui` (`tsc` emits every module the page reaches, listed in `tsconfig.browser.json`'s `include` or not) and must be served by its own static route in `app/http/routes/static.mts` (`/vault-lib.mjs`, `/item-query.mjs`, `/scan-schema.mjs`, `/paste-scan.mjs`, `/organize-config.mjs`, `/buffs.mjs`, `/evaluate.mjs`, `/swing.mjs`, `/solver/scoring.mjs`, `/data-dir-notice.mjs`, `/schema/validate.mjs`); without the route the page gets a 404 at load. `scripts/layering.test.mts` checks that every such module has its route and reaches no `node:` module. The list is also written out in the header comment of `scripts/build-ui.mts`, in `docs/architecture.md`'s HTTP routes and in `docs/architecture.md`'s "The dev loop in detail".
- **House claims.** Owner: `app/store/house-claims.mts`. `adapters/_shared/tazuo/claims.py` checks a claim and its overlap with a house the same way, and its `house_here` (in `adapters/_shared/tazuo/house_footprint.py`) names a house as `app/house-capture.mts`'s `houseIdOf` does; a change to one is a change to the other.
- **Adapter helpers.** Game scripts cannot import their siblings, so each adapter copies its helpers into every script. The copies of the helpers in `adapters/_shared/` (the paths, time and blacklist helpers, container detection, the trash and never-a-container rules, the container walk, the house footprint and capture, the house claims reader, the TazUO scan scripts' names and folder, Put away's consent between the TazUO panel and bridge, and the bridge's untrusted-input block) are generated by `scripts/gen-contracts.mts`; edit the fragment and run it. Helpers no fragment holds yet, such as the TazUO panel's own `facet` and the bridges' `find` or `walk_to`, are still separate code, and `ADAPTER_ID`, `ADAPTER_VERSION` and `CAPABILITIES` are rendered by the same script from `adapters/<id>/capabilities.json` (the `manifest` blocks).
