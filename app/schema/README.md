# Schemas: the contract index

Each file the app shares with a game script, a page or another build has a JSON Schema here, restricted to the keyword subset `validate.mts` supports. Each schema's own `$comment` has the detail; this table is the map. `npm run build:types` turns the registered ones into `types.d.mts` (`scripts/build-schema-types.mts`).

| Schema | The file | Written by | Read by | Shared cases |
|---|---|---|---|---|
| `scan.v2.schema.json` | a scan, `<data>/scans/` and the inbox | the scanners and refreshes | the app (`app/scan-schema.mts`, which keeps an inline copy a test compares) | the adapters' `fixture.scan.json` |
| `bridge.v1.schema.json` | `<data>/bridge/<adapter>/queue.jsonl` lines (`command`, `scan`), a trip's or command's `result`, `status.json` (`status`) | the app (queue), the bridges (result, status) | the bridges (`adapters/_shared/untrusted_input.py`), the app (`app/bridge-status.mts`) | — |
| `bridge-trip.v1.schema.json` | an Organize trip, one `queue.jsonl` line | the app (`app/bridge-trip.mts`) | the TazUO bridge (`check_trip`) | — |
| `heartbeat.v1.schema.json` | `<data>/bridge/tazuo/panel.json` | the TazUO panel | the installer's guard (`heartbeatAlive`) and, as `status.json`, `readBridgeStatus` | `heartbeat.json` |
| `put-away.v1.schema.json` | `putaway-request.json` (`request`) and `putaway.json` (`reply`) | the panel (request), the app (reply) | the app (`app/put-away.mts`), the panel | `put-away.json` |
| `house-claims.v1.schema.json` | `<data>/house-claims.json` | the app and the panel | the app, the panel and the TazUO scanners | `house-claims.json` |
| `blacklist.v1.schema.json` | `<data>/scan-blacklist.json` | the app and both `packrat-blacklist.py` | the app, the scanners and the bridges | `blacklist.json` |
| `tazuo-panel.v1.schema.json` | `<data>/tazuo-panel.json` | the app and the panel | both | `tazuo-panel.json` |
| `packrat-paths.v1.schema.json` | `packrat-paths.json` beside the installed scripts | the installer, or the player by hand | every script's `data_dir()`, Settings' data-folder check | `packrat-paths.json` |
| `adapter-manifest.v1.schema.json` | `adapters/<id>/capabilities.json` | the repo | the installer (`app/installer.mts`), `gen-contracts` | — |
| `profiles.v3.schema.json` | `<data>/profiles.json` | the app | the app | golden files in `app/fixtures/golden/profiles/` |
| `rules.v1.schema.json` | a shard rules file, `app/rules/` and `<data>/rules/` | the repo or the player | the app (`app/rules.mts`) | — |

Shared cases live in `app/fixtures/contract-cases/<file>`; the TypeScript and Python suites both run them, so the two readers can't drift. `app/adapter-outputs.test.mts` checks every file the Python scripts write against its schema.

## The rules

- **An added optional field doesn't bump the version.** Readers keep objects open where a newer writer may add a field, at every level, so an older reader still takes the file.
- **A rename, a removal, a change of meaning or a newly required field does:** a new `v<N>` schema, a numbered step in `app/migrate.mts` and a golden file in `app/fixtures/golden/<kind>/` (`docs/change-checklists.md`, "Change the shape of a data file").
- **A rule the keyword subset can't say** (bounds that run low to high, a time window) is checked beside the schema, on both sides, and the `$comment` says so.
- **A file both sides read gets shared cases; a file a script writes also gets its output validated** in `app/adapter-outputs.test.mts`.
- **Code that keeps an older build working** gets a `compat: <id>` comment and a row in `docs/architecture.md`, Compatibility shims, naming the release that removes it.
- **A new schema keyword** needs both `validate.mts` and `scripts/build-schema-types.mts`.
