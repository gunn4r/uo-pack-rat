# Adapters: a guide for coding agents

The game-client scripts. Each adapter is a folder, `adapters/<id>/`, with its scripts, `capabilities.json` (the manifest, `app/schema/adapter-manifest.v1.schema.json`) and a `README.md` for players. `docs/adapter-guide.md` is the full guide for someone writing a new client; this page is the short list of what breaks if you forget it.

## The invariants

- **Each script installs as one file.** TazUO lists every `.py` in its scripts folder as a runnable script, and Razor Enhanced can't import a sibling, so shared code is copied in, never imported.
- **Never edit a generated block by hand.** The lines between `# BEGIN generated: <name>` and `# END generated: <name>` (`//` in the web scanner) are copies of `adapters/_shared/<name>.py` or are rendered from `capabilities.json` (`manifest`, `manifest_version`). Edit the fragment or the manifest, then run `npm run gen:contracts`. A script's own markers show which fragments it carries.
- **Razor Enhanced runs IronPython 2.7.** A fragment a Razor script carries is ASCII only, with no f-strings (`gen:contracts` refuses one that isn't).
- **TazUO quirks:** `import API` sits alone on its line, and the unbounded-loop literals TazUO refuses (spelled out in `scripts/no-unbounded-loop.test.mts`) appear nowhere in a script, comments included. Loop on `not API.StopRequested` with a bound.
- **No public speech.** A bridge never calls a primitive that speaks in game; local messages only.
- **A change to what a script does or writes bumps its adapter's version** (`version` in `capabilities.json`, then `npm run gen:contracts`). A comment or marker edit doesn't. Old scans and old installed scripts must keep working: add fields, never rename them, and give any code that keeps an older build working a `compat: <id>` row in `docs/architecture.md` (Compatibility shims).
- **Every file a script writes has a schema** in `app/schema/` (index: `app/schema/README.md`), and a file both sides read has shared cases in `app/fixtures/contract-cases/`.

## How to extend

- **A shared helper:** add `adapters/_shared/<name>.py` (`_shared/<adapter>/<name>.py` for one adapter only), put an empty `BEGIN`/`END` pair in each script that needs it, run `npm run gen:contracts` (`docs/adapter-guide.md`, Shared helpers).
- **A bridge action:** `docs/change-checklists.md`, "Add or change a bridge command".
- **A scan field:** `docs/change-checklists.md`, "Change the scan format".
- **A new client:** `docs/change-checklists.md`, "Add an adapter". Client-specific install steps and lookups are manifest values (`install.register`, `install.panel`, `install.uoFolder`), not `if adapter === ...` branches in the app.

## How to test

- `python3 adapters/test_adapters.py` (conventions, fragments, shared cases), `adapters/test_scanners.py`, `adapters/test_bridges.py`, `adapters/test_panel.py`, `adapters/tazuo/test_paths.py`. They drive the scripts through the fakes in `adapters/fake_clients.py`.
- `node scripts/gen-contracts.mts --check`: every generated block is current.
- `app/adapter-outputs.test.mts`: every file the scripts write in those runs validates against its schema and is taken by the app's reader as written.
- `app/contracts.test.mts` and `app/adapters.test.mts`: the manifests and each adapter's fixture scan.
