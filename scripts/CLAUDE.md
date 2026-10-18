# Tests and tooling

The guide to `scripts/`: the test runner, the guards, the Electron test fixture and the generators. `TESTING.md` is the full reference (how the runner works, every test file's index, CI). This page holds the rules and the traps.

## Read with:

`TESTING.md` ("How the runner works", "Electron UI tests", "Tags", "Ad-hoc runs", "CI"); `docs/module-map.md` (Tooling & tests); `CONTRIBUTING.md` (Working in parallel).

## Invariants

- **One runner.** `./scripts/test_runner.sh` (`--smoke`, `--fast`, `--changed`, full) drives `node:test` over every `*.test.mts` under `app/` and `scripts/` and writes `test_logs/latest_summary.json`. Read the summary, not the console.
- **Every top-level test name starts with `[smoke]`, `[fast]` or `[slow]`** (`scripts/test-tags.test.mts`). `[slow]` is for exhaustive or exact-search proofs and Electron files. `--fast` skips `[slow]`, and `--changed` runs it.
- **Every test file opens with a header comment**, and its first sentence is its line in `TESTING.md`'s index (`scripts/test-index.test.mts`; `npm run gen:test-index`). Every other module carries its `// map:` and `// owns:` row (`scripts/module-map.test.mts`; `npm run gen:modules`).
- **Electron UI tests go through `scripts/electron-app.mts`:** they skip with `skipWithoutElectron(t)`, launch with `launchApp`, poll with `until`, and stand in for the bridge with `fakeBridge`. They never use a fixed sleep without a `// sleep: <reason>` comment (`scripts/electron-app.test.mts`). Window size, sideways checks and settling go through `scripts/electron-window.mts` (`fitWindow`, `sidewaysAt`, `settle`).
- **No test reaches a real game-client folder or GitHub.** Server tests start through `startTestServer`. Electron launches pass `testEnv()` and `noUpdateCheck(dataDir)`, which `launchApp` does for you.
- **Generated blocks are never edited by hand.** Run the generator after resolving merge conflicts: `gen:modules`, `gen:test-index`, `gen:contracts`, `build:types`.

## Extend it

- **A test file:** a header comment, a tag on every test, then `npm run gen:test-index`. A new `app/ui/` screen stem also needs its Electron test in `SCREENS` (`scripts/select-tests.mts`), or `--changed` runs every Electron file.
- **A guard's allow-list:** add the entry together with its reason, and never to hide something that moved. Fix the code or the doc instead.
  - `ALLOWED` in `scripts/docs-links.test.mts` takes a path and its reason;
  - `ALLOWED` in `scripts/css-guard.test.mts` takes a reason and its selectors;
  - `ALLOWED` in `scripts/slot-lists.test.mts` takes a file, how many slot lists it may hold, and why;
  - `BANNED` in `scripts/scrub.test.mts` lists the paths allowed to carry each pattern;
  - `FAN_OUT` in `scripts/api-routes.test.mts` covers a handler that serves several map entries.
  
  A guard whose listed exception is gone fails too, so each list stays current.
- **A new guard:** a `[smoke]` test in `scripts/` that reads the sources (`git ls-files`, untracked files included, as `scripts/layering.test.mts` does). Its failure message names the fix.

## Tests

- **Iterating:** `TEST_SKIP_ELECTRON=1 ./scripts/test_runner.sh --changed` and `npm run typecheck`. Before the first push, add `--fast`. CI's full run on three OSes is the merge gate. Don't run the Electron files locally: they take the mouse and keyboard focus.
- **One file:** `node --test app/x.test.mts`. Name the files: a bare `node --test` picks up `scripts/test-runner.mts` and re-enters itself.
- **CI's parts:** `--only-node`, `--only-electron` and `--shard=k/2` reproduce one CI job.
- **The tooling's own tests:** `scripts/select-tests.test.mts` (what `--changed` picks), `scripts/run-suite.test.mts` (counting) and `scripts/changelog.test.mts`.

## Traps

- **Time budgets:** a CI job times out at 20 minutes, and the runner stops a test at 12 so a hang still writes a summary naming it. The slowest file, `app/solver-large.test.mts`, takes a minute or two. Keep a new test well inside them; one that takes minutes is a `[slow]` proof.
- **Timing assertions** use `fastestMs` (`app/timing-fixture.mts`), never one sample: CI machines are shared and noisy.
- **Windows checks text files out with CRLF.** Compare parsed JSON or normalized text, never a fixture byte for byte.
- **Polling:** an Electron test that clicks and then reads a file or a count must poll with `until` until it changes. Slow runners expose every read-once race.
- **Exports used by name:** the Electron tests call page exports through `/ui/<module>.mjs`. Grep `scripts/ui-*.test.mts` before renaming one.
- **Loops in adapter scripts:** `scripts/no-unbounded-loop.test.mts` bans the unbounded-loop literals even in comments, matching TazUO's own plain-substring check on the scripts it runs.
