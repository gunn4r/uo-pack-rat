# Pack Rat — guide for coding agents

Read this first, then `CONTRIBUTING.md` for the full contributor guide.

## Reading order

1. `docs/module-map.md`: where each concept lives, area by area, and which concepts are still copied by hand.
2. `docs/change-checklists.md`: for your kind of change, every place that has to change with it.
3. Touching the game scripts or a file they share: `adapters/CLAUDE.md` (the adapter invariants and how to extend and test them) and `app/schema/README.md` (the contract index: every shared file, its schema, writers, readers and cases).
4. The one doc for your area: `docs/solver.md` (Suit Builder), `docs/ui.md` (the page, then `docs/ui/<screen>.md` for the screen you touch), `docs/scan-schema.md`, `docs/bridge-protocol.md`, `docs/shard-rules.md`, `docs/adapter-guide.md`, `docs/mcp.md`, `docs/architecture.md` (processes and the data folder), `docs/threat-model.md` (security).

## Conventions reviews keep enforcing

- One paragraph is one line. No hard wraps in Markdown, comments, commit bodies or PR bodies; a line break only where a real break belongs.
- American spelling (`scripts/american-spelling.test.mts` checks the page's own strings).
- No shard-rule or attended-play commentary in the UI or the docs.
- No session links and no co-author or other trailers in commits, PRs or issues. This repository is public: no home paths, no real names (`scripts/scrub.test.mts`).
- Say "container", not "chest", in generic text.
- Every test name starts with a tag: `[smoke]`, `[fast]` or `[slow]` (`TESTING.md`). Every test file opens with a header comment saying what it covers, kept current with its tests; after adding a test file or changing a header's first sentence, run `npm run gen:test-index` (`scripts/test-index.test.mts` checks `TESTING.md`'s index). Every other module's header also carries its `docs/module-map.md` row (`// map: <area>`, `// owns: …`): after adding, moving or renaming a module or changing its header, run `npm run gen:modules`.
- A changelog entry goes in a new `changelog.d/<short-name>.md` (one line per entry, starting with `- `), never in `CHANGELOG.md`: `scripts/changelog.test.mts` fails a hand edit (`CONTRIBUTING.md`, Changelog).
- A backticked repo path in a Markdown file must exist (`scripts/docs-links.test.mts`).
- Plain words. Match the surrounding code's comment density and naming.

## Local test loop

- `npm run typecheck`.
- `TEST_SKIP_ELECTRON=1 ./scripts/test_runner.sh --changed`, then `TEST_SKIP_ELECTRON=1 ./scripts/test_runner.sh --fast`.
- Read `test_logs/latest_summary.json` for results, not the console.
- Do not run the Electron UI tests locally (`TEST_SKIP_ELECTRON=1` skips them). CI runs the full suite on macOS, Windows and Linux, and that is the merge gate.
- The Electron tests reach into page modules by name (`page.evaluate` importing `/ui/<module>.mjs` and calling an export). Before moving or renaming an export under `app/ui/`, grep `scripts/ui-*.test.mts` for it: a test that calls a moved function fails only on CI.
- Windows checks text files out with CRLF line endings (`.gitattributes` has `* text=auto`). Never compare a checked-in text fixture byte for byte with what the code writes; compare parsed JSON, or normalize `\r\n` first.
- An Electron test that clicks something and then reads a file or a count must wait for the server or the page to finish (poll until it changes), not read once: slow CI runners expose every such race.

## Working in parallel

- Merge `origin/main` before each push; never rebase or force-push a branch with a pull request.
- After a merge, re-run every generator (`npm run gen:test-index`, `npm run gen:modules`, `npm run gen:contracts`) rather than hand-resolving a generated block; resolve the conflicts first, then run the generators, since a generator run over leftover conflict markers leaves one side's lines behind.
- A changelog entry is a new `changelog.d/<issue>-<short-name>.md` (the issue number orders it at release), never a line in `CHANGELOG.md`.
- Two sessions on the same screen module are serialized, or their briefs name disjoint functions; a brief lists the files it touches.
- `npm run try -- <pr> <pr>…` tests a stack of pull requests together.
- A flaky CI failure is re-run once and named in the pull request; a second failure, or a new flake, gets an issue with the run link first (`CONTRIBUTING.md`, Working in parallel).

## Contract rules

- A JSON Schema in `app/schema/` and its TypeScript copy change together: the scan schema has an inline copy in `app/scan-schema.mts` that a test compares, and the generated types come from `npm run build:types`. A new schema keyword needs both `app/schema/validate.mts` and `scripts/build-schema-types.mts`.
- A change to what an adapter script does or writes bumps that adapter's version (a comment or marker edit does not): `version` in its `capabilities.json`, then `npm run gen:contracts` writes every script's `ADAPTER_VERSION`, the web scanner's included (`docs/adapter-guide.md`, Versions).
- A helper between `# BEGIN generated: <fragment>` / `# END generated: <fragment>` lines in an adapter script is a copy: edit `adapters/_shared/<fragment>.py`, then run `npm run gen:contracts`. `scripts/gen-contracts.test.mts` fails while any copy differs (`docs/adapter-guide.md`, Shared helpers).
- A data file's shape changes through `app/migrate.mts`: a rename, removal, change of meaning or newly required field raises the kind's version and adds a numbered, pure, idempotent step; an added optional field does not. Keep a golden file per version in `app/fixtures/golden/<kind>/` (`docs/change-checklists.md`, "Change the shape of a data file"). A file newer than the build is read-only, never overwritten.
- A solver change that can change a result bumps `SOLVER_VERSION` in `app/runs-lib.mts`, so older saved runs stop being reused.
- A route's response and its type change together. The houses, Organize plan and proposal, and `/api/runs` responses are shared types the route `satisfies` (`app/house-model-types.mts`, `app/organize-types.mts`, `app/runs-types.mts`), so the typecheck catches a mismatch; the rest are declared by hand in `app/ui/api-types.mts`.

## The architecture pass

Issue #218 is moving each concept to one source of truth. Its rule applies to new code now: define a concept once and derive every other list from it, rather than adding another copy. Where `docs/module-map.md` lists a concept as restated, update every copy until it is removed.
