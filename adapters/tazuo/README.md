# TazUO adapter scripts

Three Legion Script (Python) files that run inside the TazUO game client and feed the Pack Rat app. Each is a self-contained, attended, one-shot or bounded tool — see "The AFK rule" below.

## Contract (scan v2 / bridge v1)

The scanner and refresh scripts write scan files as **schema v2** (`schemaVersion: 2`), and the bridge speaks **protocol v1**. Both are validated against `app/schema/scan.v2.schema.json` and `app/schema/bridge.v1.schema.json` respectively.

- `capabilities.json` in this folder is this adapter's contract: what it can read (every equipped layer including arms, the bank when open, ground containers, nested bags, OPL-sourced tooltips) and which bridge actions it executes (`highlight`, `grab`, `goto`). The three scripts' `CAPABILITIES` dict literal must match it exactly — a test (`test_paths.py`) and the top-level `npm test` contract suite (`app/contracts.test.mts`) both enforce this.
- `fixture.scan.json` is an anonymised real scan (character renamed to `Fixture`, every position and serial scrubbed, `Crafted By`/`Engraved` tooltip lines replaced) used by `app/contracts.test.mts` to prove the schema, the capabilities, and the app's fold all agree. Regenerate it from a real scan in `local/scans/` (never commit that folder) with:

  ```
  node scripts/make-adapter-fixture.mts local/scans/<Character>-<timestamp>.json adapters/tazuo/fixture.scan.json
  ```

  Pick the real scan with the most nested containers for the best coverage; the script prints item/container/root counts when it's done. Sanity-check the result before committing: grep the fixture for each of your real character names (case-insensitive) and confirm none of them print, and `grep -i "crafted by\|engraved" adapters/tazuo/fixture.scan.json` should show only `Nobody`/`Fixture`.
- A root the scanner could not open (too far, locked) is still listed in `roots[]`, but with `opened: false` and no items for that root — the app's fold treats that exactly like the root wasn't scanned at all, keeping whatever it last knew about it.
- The bridge's `status.json` `alive` field is always an RFC 3339 timestamp (never the old numeric epoch-seconds `0`); a clean Stop adds `"stopped": true` instead.

## What each script does

- **`packrat-scanner.py`** — full inventory scan. Reads every equipped layer, the backpack (nested bags included), the bank box if it is open, and every openable container within reach (recursively — bags in chests in chests). Dumps raw tooltips; the app does all the parsing. Run it standing next to a chest cluster, once per cluster, once per character. Takes anywhere from a few seconds to a couple of minutes depending on how much there is to open.
- **`packrat-refresh.py`** — quick refresh. Reads this character's stats, skills, maxes, resists, position, every equipped layer, and the backpack only — nothing else is opened. Takes a few seconds. Run it after gearing up or training, without needing to stand anywhere special.
- **`packrat-bridge.py`** — the bridge. Leave it running while you use the app's Highlight, Grab, and Go to buttons on the Suit Builder or Containers tab. It executes one command at a time: highlight flashes an item's name and marks its container's tile for a few seconds, grab walks to the item, opens its container chain, and moves it into your backpack, and go to just walks there. Bounded to 8 hours; Stop ends it cleanly.

## The AFK rule

These scripts read what your character can see and move one item when you click. They never fight, farm, or loop unattended.

## Install

The app's first-run setup wizard does this for you: pick TazUO as the client, either accept a detected `LegionScripts/` folder or browse to one, and its Install step copies all three scripts there and writes a `packrat-paths.json` beside them pointing at the app's own data directory. The Settings tab's Reinstall button repeats this later (picking up new script versions, or re-pointing at a moved data directory) without walking the whole wizard again. Either one refuses, with a 409 and a message naming the fix, if a script looks like it is still running in the client at that moment (see The AFK rule, below, for why that matters) — type `-stopall` in game, wait for "No scripts are currently running", then retry.

To install by hand instead — no wizard, or scripting a fresh checkout:

1. Copy all three `.py` files into `<TazUO>/TazUO/LegionScripts/`.
2. If the app's data directory is not the default (`~/.pack-rat`), copy `packrat-paths.example.json` to `packrat-paths.json` in that same folder, next to the three scripts, and set `dataDir` to match.
3. In TazUO's Script Manager, use "Create Macro Button" for each script, or bind a hotkey, so you can run them without opening the manager every time.

Either way TazUO's Script Manager still needs its own one-time hotkey/macro-button setup per script (step 3 above) — the installer places files, it doesn't touch TazUO's own configuration.

## What to press

- After a gearing or skill-training session on a character: run `packrat-refresh.py`.
- The first time you scan a character, or whenever chests/bags move or get restocked: stand near the cluster and run `packrat-scanner.py`; repeat at each cluster.
- Whenever you want to use the app's Highlight/Grab/Go to buttons: start `packrat-bridge.py` and leave it running.

## Data directory resolution

All three scripts resolve their data directory the same way, checked in order:

1. `packrat-paths.json` next to the script (`{"dataDir": "..."}`).
2. the `PACKRAT_DATA` environment variable.
3. `~/.pack-rat`.

The scanner and refresh scripts write to `<dataDir>/inbox/tazuo/<Character>-<YYYYmmdd-HHMMSS>.json` (the refresh script appends `-quick` before `.json`). The running app watches that folder (`app/watcher.mts`) and moves each file into `<dataDir>/scans/` under its own normalised name once it parses and validates — a file that keeps failing ends up under `<dataDir>/inbox/tazuo/rejected/` instead, with a `.reason.txt` beside it. The bridge reads `<dataDir>/bridge/tazuo/queue.jsonl` and writes `<dataDir>/bridge/tazuo/status.json`. Every write goes through a temp-file-then-rename so a crash or a read mid-write never leaves a half-written file behind.

## Limits

- Bank contents are only readable while the bank box is open; the scanner records the bank as a root only when it can see something in it.
- A container's contents only reach the client after it has been opened once in this session — the scanner and bridge both open a container before trying to read or move anything in it.
