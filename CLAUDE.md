# Pack Rat — guide for coding agents

Read this first, then `CONTRIBUTING.md` for the full contributor guide.

## Guides

Every change: `docs/module-map.md` (where each concept lives, and which are still copied by hand) and `docs/change-checklists.md` (every place a kind of change touches). Then the guide for your area. Each guide opens with Read with:, Invariants, Extend it, Tests and Traps, and points at its full doc.

| Area | Guide | Full doc |
| --- | --- | --- |
| The server: routes, stores, services | `app/http/CLAUDE.md` | `docs/server.md` |
| The page | `app/ui/CLAUDE.md` | `docs/ui.md`, then `docs/ui/<screen>.md` |
| The Suit Builder's core and solvers | `docs/guides/suit-builder.md` | `docs/solver.md` |
| The game scripts and the files they share | `adapters/CLAUDE.md` | `docs/adapter-guide.md`, `app/schema/README.md` |
| Tests and tooling | `scripts/CLAUDE.md` | `TESTING.md` |

The website is `site/` (one static page, deployed to GitHub Pages by `.github/workflows/pages.yml`; `CONTRIBUTING.md` and `RELEASING.md`, "The website").

Other docs: `docs/scan-schema.md`, `docs/bridge-protocol.md`, `docs/shard-rules.md`, `docs/mcp.md`, `docs/architecture.md` (processes and the data folder), `docs/threat-model.md` (security).

## Conventions reviews keep enforcing

- One paragraph is one line. No hard wraps in Markdown, comments, commit bodies or PR bodies; a line break only where a real break belongs.
- American spelling (`scripts/american-spelling.test.mts` checks the page's own strings).
- No shard-rule or attended-play commentary in the UI or the docs.
- No session links and no co-author or other trailers in commits, PRs or issues. This repository is public: no home paths, no real names (`scripts/scrub.test.mts`).
- Say "container", not "chest", in generic text.
- Every test name starts with a tag: `[smoke]`, `[fast]` or `[slow]` (`TESTING.md`). Every test file opens with a header comment saying what it covers, kept current with its tests; after adding a test file or changing a header's first sentence, run `npm run gen:test-index`. Every other module's header carries its `docs/module-map.md` row (`// map: <area>`, `// owns: …`): after adding, moving or renaming a module or changing its header, run `npm run gen:modules`.
- A changelog entry goes in a new `changelog.d/<issue>-<short-name>.md` (one line per entry, starting with `- `), never in `CHANGELOG.md` (`scripts/changelog.test.mts`).
- Docs stay checkable: a backticked repo path must exist (`scripts/docs-links.test.mts`); a backticked code name must be in the code, each doc keeps to its size budget, and no prose line passes 2,500 characters (`scripts/docs-freshness.test.mts`).
- One source of truth: define a concept once and derive every other list from it. Where `docs/module-map.md` lists a concept as restated, update every copy until it is removed.
- Plain words. Match the surrounding code's comment density and naming.

## Local test loop

- `npm run typecheck`, then `TEST_SKIP_ELECTRON=1 ./scripts/test_runner.sh --changed`, then `--fast` before the first push.
- Read `test_logs/latest_summary.json` for results, not the console.
- Do not run the Electron UI tests locally. CI runs the full suite on macOS, Windows and Linux, and that is the merge gate.
- The traps (exports the Electron tests call by name, CRLF checkouts, read-once races) are in `scripts/CLAUDE.md`.

## Working in parallel

- Merge `origin/main` before each push; never rebase or force-push a branch with a pull request.
- After a merge, resolve the conflicts first, then re-run every generator (`npm run gen:test-index`, `npm run gen:modules`, `npm run gen:contracts`) rather than hand-resolving a generated block: a generator run over leftover conflict markers leaves one side's lines behind.
- Two sessions on the same screen module are serialized, or their briefs name disjoint functions; a brief lists the files it touches.
- `npm run try -- <pr> <pr>…` tests a stack of pull requests together.
- A flaky CI failure is re-run once and named in the pull request; a second failure, or a new flake, gets an issue with the run link first (`CONTRIBUTING.md`, Working in parallel).

## Contract rules

Each is spelled out in its guide; these are the ones that break another side when forgotten.

- A JSON Schema in `app/schema/` and its TypeScript copy change together (`npm run build:types`; the scan schema's inline copy in `app/scan-schema.mts`). A new schema keyword needs both `app/schema/validate.mts` and `scripts/build-schema-types.mts`.
- A change to what an adapter script does or writes bumps that adapter's version, and a generated block is edited in its `adapters/_shared/` fragment, then `npm run gen:contracts` (`adapters/CLAUDE.md`).
- A data file's shape changes through `app/migrate.mts`, with a golden file per version; a file newer than the build is read-only, never overwritten (`docs/change-checklists.md`, "Change the shape of a data file").
- A solver change that can change a result bumps `SOLVER_VERSION` in `app/runs-lib.mts` (`docs/guides/suit-builder.md`).
- A route's response and its type change together: every /api route's answer is a shared type that the route `satisfies` (`app/http/CLAUDE.md`).
