# Pack Rat — guide for coding agents

Read this first, then `CONTRIBUTING.md` for the full contributor guide.

## Reading order

1. `docs/module-map.md`: where each concept lives, area by area, and which concepts are still copied by hand.
2. `docs/change-checklists.md`: for your kind of change, every place that has to change with it.
3. The one doc for your area: `docs/solver.md` (Suit Builder), `docs/ui.md` (the page), `docs/scan-schema.md`, `docs/bridge-protocol.md`, `docs/shard-rules.md`, `docs/adapter-guide.md`, `docs/mcp.md`, `docs/architecture.md` (processes and the data folder), `docs/threat-model.md` (security).

## Conventions reviews keep enforcing

- One paragraph is one line. No hard wraps in Markdown, comments, commit bodies or PR bodies; a line break only where a real break belongs.
- American spelling (`scripts/american-spelling.test.mts` checks the page's own strings).
- No shard-rule or attended-play commentary in the UI or the docs.
- No session links and no co-author or other trailers in commits, PRs or issues. This repository is public: no home paths, no real names (`scripts/scrub.test.mts`).
- Say "container", not "chest", in generic text.
- Every test name starts with a tag: `[smoke]`, `[fast]` or `[slow]` (`TESTING.md`). A new test file is listed in `TESTING.md`.
- Plain words. Match the surrounding code's comment density and naming.

## Local test loop

- `npm run typecheck`.
- `TEST_SKIP_ELECTRON=1 ./scripts/test_runner.sh --changed`, then `TEST_SKIP_ELECTRON=1 ./scripts/test_runner.sh --fast`.
- Read `test_logs/latest_summary.json` for results, not the console.
- Do not run the Electron UI tests locally (`TEST_SKIP_ELECTRON=1` skips them). CI runs the full suite on macOS, Windows and Linux, and that is the merge gate.

## Contract rules

- A JSON Schema in `app/schema/` and its TypeScript copy change together: the scan schema has an inline copy in `app/scan-schema.mts` that a test compares, and the generated types come from `npm run build:types`. A new schema keyword needs both `app/schema/validate.mts` and `scripts/build-schema-types.mts`.
- An adapter script change bumps that adapter's version: `version` in its `capabilities.json` and every `ADAPTER_VERSION` line together (`docs/adapter-guide.md`, Versions).
- A solver change that can change a result bumps `SOLVER_VERSION` in `app/runs-lib.mts`, so older saved runs stop being reused.
- A route's response and its type in `app/ui/api-types.mts` change together.

## The architecture pass

Issue #218 is moving each concept to one source of truth. Its rule applies to new code now: define a concept once and derive every other list from it, rather than adding another copy. Where `docs/module-map.md` lists a concept as restated, update every copy until it is removed.
