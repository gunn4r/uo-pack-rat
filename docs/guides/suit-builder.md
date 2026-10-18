# The Suit Builder's core and solvers

The guide to what turns a build request into a suit (`app/build-spec.mts`, `app/solver/`, the core, the MIP and the exact solver). The pipeline, the scoring constants and the rules written twice are in `docs/solver.md`'s "Before you change the solvers": read that first. The screen is `docs/ui/suit-builder.md`, and its modules are in `app/ui/CLAUDE.md`.

## Read with:

`docs/solver.md` ("Before you change the solvers", then the section for your feature: "Goals", "Strict order and fewest changes", "Floors, hard and soft", …); `docs/module-map.md` (Suit Builder, and "Where concepts are restated today"); `docs/change-checklists.md` ("Add or change a scoring term", "Add or change a BuildSpec field", "Add a buff, form or ability", "Add or change a gear slot").

## Invariants

- **A BuildSpec is the one build request.** The page, the MCP tools and `POST /api/optimize` all build through `planBuild` (`app/build-spec.mts`), which turns a spec into the profile, the pool and the search options. A new build knob is a BuildSpec field, never an extra argument on one caller's path.
- **What the solvers score with is `intent.weights`.** Ranked goals are compiled into weights by `compileGoals` (`app/vault-lib.mts`), and `goals` rides along only to say where they came from. Strict order is a search option: `planBuild` turns a strict goals strategy into `opts.strict` (one solve per rank), and "fewest changes" into a tie-break or a stage of its own.
- **Both solvers score alike.** The core's `scoreSet` is the scorer of record, and the MIP must agree with it suit by suit. Shared terms live once in `app/solver/scoring.mts`; the rules still written twice are listed in "Before you change the solvers".
- **The run key covers the whole solve.** Every transform happens in `prepareSolve` before `runKey`, and anything that can change a result bumps `SOLVER_VERSION` (`app/runs-lib.mts`, with a line in its comment), so saved runs stop being reused.
- **One result shape.** The core's `OptResult` and the finished `OptimizeResult` are declared once in `app/api/optimize.mts`, which the core, the exact solver, `finishResult`, the routes and the page read.
- **One vocabulary for slots and properties.** Slots come from `GEAR_SLOTS` and its group tables, and properties from `PROPERTIES` (`app/vault-lib.mts`). The core's own slot lists are hand mirrors that `app/solver.test.mts` holds to them.

## Extend it

- **A new scoring term or rule:** follow "Add or change a scoring term". Put the term in `app/solver/scoring.mts` when both solvers can call it, and add a row to the rules-written-twice table when one cannot.
- **A new BuildSpec field:** follow "Add or change a BuildSpec field". It is checked by `buildSpecError`, read by `planBuild`, and held by `runSettingsError` once a run carries it.
- **A new search mode:** each mode is an objective, `OptObjective` in `scripts/optimizer-core.mts` (`OPT_BEST_VALUE`, `optStrictObjective`) and `ExactObjective` in `app/solver/exact/objective.mts` (`bestValueObjective`, `strictOrderObjective`). A new mode is one more implementation of each, chosen where `optimizeSuit` and `solveExact` pick the objective from `opts`; `docs/solver.md`'s "Before you change the solvers" has the recipe. A tie-break is an option on top of a mode (`opts.tieBreak`), not a mode.
- **Result-changing work:** bump `SOLVER_VERSION`. Behavior-preserving work proves itself with `node app/bench/compare-cores.mts --base origin/main`, and its summary goes in the PR body.

## Tests

- **Agreement:** `app/solver/agreement.test.mts` (core = MIP objective = the score shares, suit by suit), `app/solver-fuzz.test.mts` (2,000 small inventories against brute force), `app/solver-buffs-fuzz.test.mts` (buffs and minimums) and `app/solver.test.mts` (`solveExact` against the core's proven optimum per template).
- **Pipeline:** `app/solver/prepare.test.mts` (what the run key covers), `app/solver/finish.test.mts`, `app/solver/scoring.test.mts`, `app/build-spec.test.mts`, `app/goals.test.mts`, `app/mip.test.mts`, `app/diagnostics.test.mts`, `scripts/optimizer-core.test.mts`.
- **The slow proofs:** `[slow]` tests in `app/solver.test.mts`, `app/solver-fuzz.test.mts`, `app/solver-builtins.test.mts` (every built-in template) and `app/solver-large.test.mts` (a 3,000-item cell). `--fast` skips them and `--changed` runs them. To run only them: `node --test --test-name-pattern '^\[slow\]' 'app/solver*.test.mts'`.

## Traps

- A transform added outside `prepareSolve`, or after `runKey`, gives instant repeats of runs that no longer match. Nothing fails at once.
- HiGHS's objective is not the answer: `solveExact` hands its suit back to the core, which re-scores it. A number shown to the player that comes straight from the MIP is a bug.
- A time limit that cuts the search makes results differ run to run. Compare outputs byte for byte only with the restarts run in full and the exact phase proven, as `compare-cores.mts` does.
- `alternatives` never contains the returned suit. A new alternatives path must filter it out too.
