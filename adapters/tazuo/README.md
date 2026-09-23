# TazUO adapter scripts

Three Legion Script (Python) files that run inside the TazUO game client and feed the Pack Rat app. Each is a self-contained, attended, one-shot or bounded tool — see "The AFK rule" below.

## Contract (scan v2 / bridge v1)

The scanner and refresh scripts write scan files as **schema v2** (`schemaVersion: 2`), and the bridge speaks **protocol v1**. Both are validated against `app/schema/scan.v2.schema.json` and `app/schema/bridge.v1.schema.json` respectively.

- `capabilities.json` in this folder is this adapter's contract: what it can read (every equipped layer including arms, the bank when open, ground containers, nested bags, OPL-sourced tooltips) and which bridge actions it executes (`highlight`, `grab`, `goto`). The three scripts' `CAPABILITIES` dict literal must match it exactly — `test_paths.py`, the cross-adapter `../test_adapters.py`, and the top-level `npm test` contract suite (`app/contracts.test.mts`, `app/adapters.test.mts`) all enforce this.
- `capabilities.json` also declares, beside `capabilities`, an **`actions`** list: what these scripts do *in the world*, as opposed to what they read. For TazUO that is `open-container` (double-clicking a container to open it), `move-to-own-backpack` (Grab, whose destination is hard-coded and is deliberately not a protocol field), `pathfind-local` (walking the character, bounded — see "What the bridge refuses") and `client-local-highlight` (overhead text and a marked tile, visible to nobody else). `app/adapters.test.mts` fails the build if a script calls one of those primitives without declaring it, or declares one it never calls.
- `fixture.scan.json` is an anonymised real scan (character renamed to `Fixture`, every position and serial scrubbed, `Crafted By`/`Engraved` tooltip lines replaced) used by `app/contracts.test.mts` to prove the schema, the capabilities, and the app's fold all agree. Regenerate it from a real scan in `local/scans/` (never commit that folder) with:

  ```
  node scripts/make-adapter-fixture.mts local/scans/<Character>-<timestamp>.json adapters/tazuo/fixture.scan.json
  ```

  Pick the real scan with the most nested containers for the best coverage; the script prints item/container/root counts when it's done. Sanity-check the result before committing: grep the fixture for each of your real character names (case-insensitive) and confirm none of them print, and `grep -i "crafted by\|engraved" adapters/tazuo/fixture.scan.json` should show only `Nobody`/`Fixture`.
- A root the scanner could not open (too far, locked) is still listed in `roots[]`, but with `opened: false` and no items for that root — the app's fold treats that exactly like the root wasn't scanned at all, keeping whatever it last knew about it. A bag *inside* a root that lists nothing and never opened (the client's `Opened` flag), or that sits deeper than `MAX_NEST`, is recorded in `containers` with `"opened": false`: the rest of the root updates, and the app keeps what it last knew inside that bag. The scanner says so in game, naming the bag. A scan stopped mid-way writes no file at all; so does a refresh whose backpack did not open. Things named like a container that never open as one — a deed, a bag of sending, a music box — are never double-clicked and are recorded as ordinary items (a Commodity Deed Box is a real container and is opened).
- The bridge's `status.json` `alive` field is always an RFC 3339 timestamp (never the old numeric epoch-seconds `0`); a clean Stop adds `"stopped": true` instead.

## What each script does

- **`packrat-scanner.py`** — full inventory scan. Reads every equipped layer, the backpack (nested bags included), the bank box if it is open, and every openable container within reach (recursively — bags in chests in chests). Dumps raw tooltips; the app does all the parsing. Run it standing next to a chest cluster, once per cluster, once per character. Takes anywhere from a few seconds to a couple of minutes depending on how much there is to open.
- **`packrat-refresh.py`** — quick refresh. Reads this character's stats, skills, maxes, resists, position, every equipped layer, and the backpack only — nothing else is opened. Takes a few seconds. Run it after gearing up or training, without needing to stand anywhere special.
- **`packrat-bridge.py`** — the bridge. Leave it running while you use the app's Highlight, Grab, and Go to buttons on the Suit Builder or Containers tab. It executes one command at a time: highlight flashes an item's name and marks its container's tile for a few seconds, grab walks to the item, opens its container chain, and moves it into your backpack, and go to just walks there. Bounded to 8 hours; Stop ends it cleanly.

## What the bridge refuses

`<dataDir>/bridge/tazuo/queue.jsonl` is an ordinary file. The app writes it, but so could anything else running on your machine, and a line in it drives your character. So the bridge trusts nothing in it and re-checks every line itself rather than assuming the app already did. What it will not do:

- **Open anything that is not a container.** Double-click is UO's universal "use" verb — a potion drinks, a rune opens its gump, a deed places — so every entry of a command's container chain has to pass the same `is_container()` check the scanner uses, corpse refusal included, before it is opened. A chain longer than 8 containers is refused outright (the deepest the app can even produce is 4).
- **Open a container that is not yours to open.** The first container in the chain must lie on the ground or be your own backpack or open bank box, and each one after it must sit inside the one before — checked against the live client just before each double-click, so another player's pack is never opened, whichever position in the chain names it.
- **Run a stale or repeated command.** A command carries the time the app queued it; anything older than 60 seconds, or more than 5 seconds in the future, is reported as expired and never executed, and an id that already ran is skipped. Commands queued before the script started are still ignored, as before.
- **Keep going when the queue is written faster than a person clicks.** A rolling budget of 40 commands a minute — comfortably more than the 20-piece "Grab all" that is the largest burst the app produces — stops the bridge with a message when it trips, because at that rate something other than you is writing that file.
- **Walk more than 24 tiles.** That is the client's own view range; a Go to (or the walk a Highlight/Grab does to reach a chest) further than that is refused with "walk closer and retry" instead of pathfinding across the map. The walk itself stays one attempt per command, bounded by the existing 20-second pathfind timeout, and runs without blocking so the status heartbeat keeps the app's bridge pill online (`API.Pathfinding()` / `CancelPathfinding()`). Nothing in your own backpack or bank is walked to.
- **Grab from anywhere but your own things.** The destination was always hard-coded to your backpack; the *source* is now checked too. The piece has to resolve to your backpack, your bank, or the container chain that same command just opened — a guild chest someone left open nearby, a stranger's pack, or an item lying on the ground is refused rather than moved.
- **Lose the rest of a batch to one bad line, or refuse quietly.** Every line is handled on its own: a junk line, a line that is not a JSON object, or one over 16 KB is counted and reported while the commands behind it still run. A refused command that carries an id is recorded under that id, so the app toasts the reason on the button you clicked. Reads are capped at 256 KB per poll and the kept results at 30, so neither the client nor `status.json` can be made to grow without bound.

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

1. `packrat-paths.json` next to the script (`{"dataDir": "..."}`). The script's folder comes from `__file__`, or from `API.ScriptPath` if TazUO runs the script without defining `__file__` (which build does is unverified), and this step is skipped if neither is available.
2. the `PACKRAT_DATA` environment variable.
3. `~/.pack-rat`.

The scanner and refresh scripts write to `<dataDir>/inbox/tazuo/<Character>-<YYYYmmdd-HHMMSS>.json` (the refresh script appends `-quick` before `.json`). The running app watches that folder (`app/watcher.mts`) and moves each file into `<dataDir>/scans/` under its own normalised name once it parses and validates — a file that keeps failing ends up under `<dataDir>/inbox/tazuo/rejected/` instead, with a `.reason.txt` beside it. The bridge reads `<dataDir>/bridge/tazuo/queue.jsonl` and writes `<dataDir>/bridge/tazuo/status.json`. Every write goes through a temp-file-then-rename so a crash or a read mid-write never leaves a half-written file behind.

## Limits

- Bank contents are only readable while the bank box is open; the scanner records the bank as a root only when it can see something in it.
- A container's contents only reach the client after it has been opened once in this session — the scanner and bridge both open a container before trying to read or move anything in it.
- The scanner and the refresh close every container window they opened themselves once the scan file is written (or after a Stop or an error), innermost first; a window that was already open before the run (the item's `Opened` flag, read just before the script opens it) is left open. Closing uses the item's own `GetContainerGump()` and that window's `Dispose()`, each looked up with `getattr`, so a client build without either leaves the windows open instead of failing. `API.CloseGump(serial)` is not used: it finds gumps by their server gump id, which a container window does not have, so it cannot close one. The bridge still leaves open whatever it opened.
