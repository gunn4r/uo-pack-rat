# TazUO adapter scripts

Six small scripts that run inside the TazUO game client and send what your character owns to the Pack Rat app. You only run them when you are at the keyboard (see [The AFK rule](#the-afk-rule)).

**Requires TazUO v26.0923.64 (September 23, 2026) or later.** Update TazUO from its launcher if yours is older.

- **`packrat-scanner.py` — the full scan.** Reads everything you are wearing, your backpack, your bank box if it is open, and every chest and bag you can reach, including bags inside chests.
- **`packrat-character-refresh.py` — the character refresh.** Reads just your stats, skills, what you are wearing and your backpack. (Called `packrat-refresh.py` before 2.12.0; installing 2.12.0 removes the old copy.)
- **`packrat-house-map-refresh.py` — the house map refresh.** Records just the house you stand in for the app's House map: its floors and walls, its furniture and where every chest stands. Opens nothing.
- **`packrat-bridge.py` — the bridge.** Makes the app's **Highlight**, **Grab** and **Go to** buttons work.
- **`packrat-blacklist.py` — blacklist a container.** Click a chest or bag, and scans never open or record it again.
- **`packrat-panel.py` — the Pack Rat window.** A small in-game window with a button for each script above, showing which are running and when you last scanned, and Organize's **Put away...**.

## Install

The easy way is the setup window in the Pack Rat app: pick **TazUO** as your client, let it find (or pick) your TazUO folder, choose whether the in-game panel shows at login and its show/hide hotkey, check **I typed -stopall in game and nothing is running**, and click **Install scanner**. The main [README](../../README.md#first-run) walks through it. To get new versions of the scripts later, use **Reinstall scanner scripts** in the app's **Settings**, under **Game client**.

Before installing or reinstalling, if the game is running: type `-stopall` in the game's chat and wait for **"No scripts are currently running"**. Pack Rat refuses to replace the scripts while the bridge or the Pack Rat window is running, and tells you to do exactly this.

To install by hand instead:

1. Copy the six `packrat-….py` files into the folder where TazUO keeps its scripts (the `LegionScripts` folder inside your TazUO folder).
2. Tell the scripts where Pack Rat keeps its data. In the Pack Rat app, open the **Settings** tab and note the folder shown next to **Data folder** (under **Data**). Copy `packrat-paths.example.json` into the same folder as the scripts, rename the copy to `packrat-paths.json`, open it in a text editor, and replace `~/.pack-rat` with that folder. On Windows, write the folder with forward slashes (`C:/Users/example/AppData/Roaming/Pack Rat`) so the file stays valid. (You can skip this step only if you run Pack Rat from source with its default data folder, `~/.pack-rat`.)

## What to press

- **The easy way: the Pack Rat window.** Its buttons run the scripts: **Character refresh**, **House map refresh**, **Scan here**, **Start bridge** / **Stop bridge**, **Blacklist a container**, and **Put away...**, which asks you to click a container (your backpack, a bag in it, or a labeled chest you stand next to) and files what lies directly in it by your Organize rules while the app is running and the bridge is on. The install makes it start with TazUO at every login, and **Ctrl+Shift+P** shows or hides it. Whether the window shows at login or waits hidden for the hotkey, and the hotkey itself, are set in the app's **Settings** under **Game client** (**Show the Pack Rat panel at login** and **Panel hotkey**); the window's **Close** button hides it until you press the hotkey again; the window's **Show at login** button changes the first too, from your next login. If TazUO was open during the install, quit it and reinstall, or check **Autostart** for `packrat-panel.py` in the Script Manager; until then type `-playlscript packrat-panel.py` in the game's chat to open it (type it: TazUO's chat does not accept a paste). If a button says **Didn't start** right after an install, open the Script Manager once or relog, because TazUO only notices new script files then.

Or run each script yourself:

- **The first time you scan a character, or whenever your chests or bags change:** walk to a group of chests and run `packrat-scanner.py`. Walk to the next group and run it again. To include your bank, open your bank box first.
- **After gearing up or training a character:** run `packrat-character-refresh.py`. It works anywhere.
- **After moving furniture or chests around your house:** stand anywhere inside it and run `packrat-house-map-refresh.py` (or press **House map refresh** in the Pack Rat window). It changes only the House map; the inventory keeps what the last scans read.
- **To stop scans opening a container** (a guild chest, a vendor's stock): run `packrat-blacklist.py` and click it. Esc cancels. You can also blacklist a chest from its **⋯** menu in the app's **Containers** page. The app's **Settings** lists what you blacklisted, with **Unblacklist**.
- **When you want to use the app's Highlight, Grab or Go to buttons:** start `packrat-bridge.py` and leave it running. The app's sidebar shows **Bridge ready · *your character*** while it is running.

## Starting a script

1. In the game, open the Script Manager from TazUO's top menu: **Legion Script**.
2. Find the script in the list and press its **Play** button once. It is a toggle, so a double click (easy on a Mac, where the first click only focuses the window) starts the script and stops it again at once.

To start a script with one key, right-click it in the Script Manager, choose **Set Hotkey**, and press the key you want. Pressing the key again stops it. The Script Manager's **Create Macro Button** is another way to get a one-click button for a script. Pack Rat's installer copies the files and adds the Pack Rat window to TazUO's autostart list (only while TazUO is closed); any hotkeys for the other scripts are up to you, once per script.

## Good to know

- The scanner only reads chests close enough to open. A chest it can't open is kept as it was in your last scan, not emptied.
- The bank is only read while your bank box is open. While it is open, the full scan reads only your backpack and bank, not nearby chests.
- Trash barrels and chests (anything with the word "trash" in its name) are never opened or recorded, whether on the ground or inside another container: the server empties them on a timer. The scan says how many it skipped, and a scan inside a house records their serials in `house.trash` (2.13.0), so the house map leaves them out even after a scan from across the room. You don't need to blacklist them.
- A scan takes from a few seconds to a couple of minutes, depending on how many bags it has to open. If you stop it part way, it saves nothing, and you can simply run it again.
- The bridge stops by itself after 8 hours, or when you press Stop. Start it again when you need it.
- The bridge only walks up to 24 tiles. If an item is further away, it tells you to walk closer and try again.
- A scan file shows where your house and chests are. Don't share one publicly without reading the main README's [privacy note](../../README.md#your-data-and-privacy).

## The AFK rule

These scripts read what your character can see and move one item when you click. They never fight, farm, or loop unattended.

## For developers

Everything below is for people working on the adapter itself.

What has run against a live client: the scanner, refresh and bridge were verified live, attended, before version 2.1.0, and `packrat-panel.py` was run live on build 26.0923.64 (buttons, hotkey, start at login, but not yet starting hidden). Every other change since 2.1.0, up to this 2.13.0, has only run against the fake clients in `adapters/fake_clients.py` (see `TESTING.md`).

### Contract (scan v2 / bridge v1)

The scanner and refresh scripts write scan files as **schema v2** (`schemaVersion: 2`), and the bridge speaks **protocol v1**. Both are validated against `app/schema/scan.v2.schema.json` and `app/schema/bridge.v1.schema.json` respectively.

- `capabilities.json` in this folder is this adapter's contract: what it can read (every equipped layer including arms, the bank when open, ground containers, nested bags, OPL-sourced tooltips) and which bridge actions it executes (`highlight`, `grab`, `goto`, and `trip`, Organize's take-and-put trips). The three scripts' `CAPABILITIES` dict literal must match it exactly — `test_paths.py`, the cross-adapter `../test_adapters.py`, and the top-level `npm test` contract suite (`app/contracts.test.mts`, `app/adapters.test.mts`) all enforce this.
- `capabilities.json` also declares, beside `capabilities`, an **`actions`** list: what these scripts do *in the world*, as opposed to what they read. For TazUO that is `open-container` (double-clicking a container to open it), `move-to-own-backpack` (Grab, whose destination is hard-coded and is deliberately not a protocol field, and a trip's takes), `move-into-ground-container` (a trip's puts, only of items the bridge itself took, or on a Put away trip the panel asked for, of items lying directly in the container you picked in your backpack, into labeled ground containers, straight from the chest the take found them in when both are in reach), `pathfind-local` (walking the character, bounded — see "What the bridge refuses") and `client-local-highlight` (overhead text and a marked tile, visible to nobody else). `app/adapters.test.mts` fails the build if a script calls one of those primitives without declaring it, or declares one it never calls.
- `fixture.scan.json` is an anonymized real scan (character renamed to `Fixture`, every position and serial scrubbed, `Crafted By`/`Engraved` tooltip lines replaced) used by `app/contracts.test.mts` to prove the schema, the capabilities, and the app's fold all agree. Regenerate it from a real scan in `local/scans/` (never commit that folder) with:

  ```
  node scripts/make-adapter-fixture.mts local/scans/<Character>-<timestamp>.json adapters/tazuo/fixture.scan.json
  ```

  Pick the real scan with the most nested containers for the best coverage; the script prints item/container/root counts when it's done. Sanity-check the result before committing: grep the fixture for each of your real character names (case-insensitive) and confirm none of them print, and `grep -i "crafted by\|engraved" adapters/tazuo/fixture.scan.json` should show only `Nobody`/`Fixture`.
- A root the scanner could not open (too far, locked) is still listed in `roots[]`, but with `opened: false` and no items for that root — the app's fold treats that exactly like the root wasn't scanned at all, keeping whatever it last knew about it. A bag *inside* a root that lists nothing and never opened (the client's `Opened` flag), or that sits deeper than `MAX_NEST`, is recorded in `containers` with `"opened": false`: the rest of the root updates, and the app keeps what it last knew inside that bag. The scanner says so in game, naming the bag. A scan stopped mid-way writes no file at all; so does a refresh whose backpack did not open. Things named like a container that never open as one — a deed, a bag of sending, a music box — are never double-clicked and are recorded as ordinary items (a Commodity Deed Box is a real container and is opened).
- The bridge's `status.json` `alive` field is always an RFC 3339 timestamp (never the old numeric epoch-seconds `0`); a clean Stop adds `"stopped": true` instead.

### What each script does

- **`packrat-scanner.py`** — full inventory scan. Reads every equipped layer, the backpack (nested bags included), the bank box if it is open, and every openable container within reach (recursively — bags in chests in chests). Dumps raw tooltips; the app does all the parsing. Run it standing next to a chest cluster, once per cluster, once per character. Takes anywhere from a few seconds to a couple of minutes depending on how much there is to open.
- **`packrat-character-refresh.py`** — character refresh (the quick refresh; `packrat-refresh.py` before 2.12.0). Reads this character's stats, skills, maxes, resists, position, every equipped layer, and the backpack only — nothing else is opened. Takes a few seconds. Run it after gearing up or training, without needing to stand anywhere special.
- **`packrat-house-map-refresh.py`** — house map refresh. Records the house you stand in exactly as a full scan's `house` section does (its tiles on every level, the furniture inside the footprint, and every container on its floor, opened or not), from what the client already has: it opens nothing and makes no tooltip or property request. Trash is known by the client's cached name only, and blacklisted containers and corpses are never listed as chests. Writes `<Character>-<stamp>-house.json`, a house-only file (`"kind": "house"`, no inventory; [docs/scan-schema.md](../../docs/scan-schema.md)) that the app reads for the House map alone. Outside a house, or on a build without the multi calls, it writes nothing and says so.
- **`packrat-bridge.py`** — the bridge. Leave it running while you use the app's Highlight, Grab, and Go to buttons on the Suit Builder or Inventory tab. It executes one command at a time: highlight flashes an item's name and marks its container's tile for a few seconds, grab walks to the item, opens its container chain, and moves it into your backpack, and go to just walks there. Bounded to 8 hours; Stop ends it cleanly.

- **`packrat-panel.py`** — the in-game window. Its buttons call `API.PlayScript` on the five scripts above (and `API.StopScript` on the bridge) by fixed name, in the folder the panel runs from, and it rewrites a heartbeat, `<dataDir>/bridge/tazuo/panel.json`, for the installer's running-script guard. **Put away...** raises a target cursor (`API.RequestTarget`), refuses a pick that is not a container, trash, blacklisted, outside your own backpack and not on the ground, or a ground container further than 3 tiles away, then runs the character refresh (a container in your pack) or the scanner (a chest), waits for its scan file, drops `<dataDir>/inbox/tazuo/putaway-request.json` (an id, the picked container, the character and where it stands; nothing else), reads the app's answer from `<dataDir>/bridge/tazuo/putaway.json` and follows the queued trip's result in the bridge's `status.json`, asking again after each trip that put everything it tried (at most 10 trips a click); while it runs its button reads **Cancel put away**. For the length of the run it sets the shared variable `packrat_putaway` to the picked container and the run's end (and reads it back, ending the run at once on a client where it does not hold; it is cleared however the run or the panel ends), without which the bridge refuses to put anything you carry, and with which it puts only what lies directly in that container (docs/bridge-protocol.md, Put away). Its hotkey and `showAtLogin` come from `<dataDir>/tazuo-panel.json`, which the app and the panel's own button write and the panel re-reads every 3 seconds. It starts at login because the install adds `packrat-panel.py` to `GlobalAutoStartScripts` in TazUO's `Data/lscript.json`, which the app only edits at install and only while TazUO is closed. Bounded to 24 hours (`MAX_HOURS`); Stop, `-stopall` or logout ends it.

### What the bridge refuses

`<dataDir>/bridge/tazuo/queue.jsonl` is an ordinary file. The app writes it, but so could anything else running on your machine, and a line in it drives your character. So the bridge trusts nothing in it and re-checks every line itself rather than assuming the app already did. What it will not do:

- **Open anything that is not a container.** Double-click is UO's universal "use" verb — a potion drinks, a rune opens its gump, a deed places — so every entry of a command's container chain has to pass the same `is_container()` check the scanner uses, corpse refusal included, before it is opened. That check never takes a book for a container (spellbooks of every school, runebooks, a runic atlas, a tome — the client calls them containers, but double-clicking one opens a spellbook or runebook, by name or by graphic), and it only falls back on a container-like name ("chest", "bag") when the client's own `IsContainer` flag and the known container graphics have not answered, and never for armor or clothing ("Platemail Chest" by its name, "Gargish Stone Chest" by the client calling it wearable). A Gargish Chest, which UO Alive's tiledata does not flag as a container, is recognized by its graphics (0x4025/0x4026). A chain longer than 8 containers is refused outright (the deepest the app can even produce is 4).
- **Open a container that is not yours to open.** The first container in the chain must lie on the ground or be your own backpack or open bank box, and each one after it must sit inside the one before — checked against the live client just before each double-click, so another player's pack is never opened, whichever position in the chain names it.
- **Run a stale or repeated command.** A command carries the time the app queued it; anything older than 60 seconds, or more than 5 seconds in the future, is reported as expired and never executed, and an id that already ran is skipped. Commands queued before the script started are still ignored, as before.
- **Keep going when the queue is written faster than a person clicks.** A rolling budget of 40 commands a minute — comfortably more than the 20-piece "Grab all" that is the largest burst the app produces — stops the bridge with a message when it trips, because at that rate something other than you is writing that file.
- **Walk more than 24 tiles.** That is the client's own view range; a Go to (or the walk a Highlight/Grab does to reach a chest) further than that is refused with "walk closer and retry" instead of pathfinding across the map. The walk itself stays one attempt per command, bounded by the existing 20-second pathfind timeout, and runs without blocking so the status heartbeat keeps the app's bridge pill online (`API.Pathfinding()` / `CancelPathfinding()`). Nothing in your own backpack or bank is walked to.
- **Grab from anywhere but your own things.** The destination was always hard-coded to your backpack; the *source* is now checked too. The piece has to resolve to your backpack, your bank, or the container chain that same command just opened — a guild chest someone left open nearby, a stranger's pack, or an item lying on the ground is refused rather than moved.
- **Lose the rest of a batch to one bad line, or refuse quietly.** Every line is handled on its own: a junk line, a line that is not a JSON object, or one over 16 KB is counted and reported while the commands behind it still run. A refused command that carries an id is recorded under that id, so the app toasts the reason on the button you clicked. Reads are capped at 256 KB per poll and the kept results at 30, so neither the client nor `status.json` can be made to grow without bound.

### What the installer does

The app's first-run setup wizard installs this adapter: pick TazUO as the client, either accept a detected `LegionScripts/` folder or browse to one, and its Install step copies every `packrat-….py` script there and writes a `packrat-paths.json` beside them pointing at the app's own data directory (an existing one that names a different folder is kept as it is and reported; one that does not parse, or has no `dataDir`, is replaced after a copy to `packrat-paths.json.bak`). Settings' **Reinstall scanner scripts** row repeats this later (picking up new script versions; it does not re-point a `packrat-paths.json` that names another folder, per the rule above) without walking the whole wizard again. Either one refuses, with a 409 and a message naming the fix, if a script looks like it is still running in the client at that moment — the bridge's `status.json` or the panel's `panel.json` heartbeat (both in `<dataDir>/bridge/tazuo/`) is under 30 seconds old and does not say `stopped` — (overwriting a script file while a Legion script thread is mid-run against it can orphan that thread) — type `-stopall` in game, wait for "No scripts are currently running", then retry. Both then add `packrat-panel.py` to `GlobalAutoStartScripts` in `<TazUO>/Data/lscript.json` (`app/tazuo-panel.mts`), but only when no TazUO process is running, since a running client saves its own copy over that file at logout; the edit merges, keeps a BOM, and copies the old file to `lscript.json.bak` first. That is the only TazUO file the app touches: hotkeys or macro buttons for the other scripts are still the player's own one-time Script Manager setup.

### Data directory resolution

Every script resolves its data directory the same way, checked in order:

1. `packrat-paths.json` next to the script (`{"dataDir": "..."}`, `~` expanded). The script's folder comes from `__file__`, or from `API.ScriptPath` if TazUO runs the script without defining `__file__` (which build does is unverified), and this step is skipped if neither is available.
2. the `PACKRAT_DATA` environment variable.
3. `~/.pack-rat`.

`~/.pack-rat` is the bare server's default (`npm start`). The desktop app keeps its data in the platform's application-data folder instead (see the main README's "Your data"), which is why the hand install above always writes `packrat-paths.json` for a desktop-app player.

The scanner and refresh scripts write to `<dataDir>/inbox/tazuo/<Character>-<YYYYmmdd-HHMMSS>.json` (the refresh script appends `-quick` before `.json`). The running app watches that folder (`app/watcher.mts`) and moves each file into `<dataDir>/scans/` under its own normalized name once it parses and validates — a file that keeps failing ends up under `<dataDir>/inbox/tazuo/rejected/` instead, with a `.reason.txt` beside it. The bridge reads `<dataDir>/bridge/tazuo/queue.jsonl` and writes `<dataDir>/bridge/tazuo/status.json`. Every write goes through a temp-file-then-rename so a crash or a read mid-write never leaves a half-written file behind.

### Limits

- Bank contents are only readable while the bank box is open; the scanner records the bank as a root only when it can see something in it.
- A container's contents only reach the client after it has been opened once in this session — the scanner and bridge both open a container before trying to read or move anything in it.
- The scanner and the refresh close every container window they opened themselves once the scan file is written (or after a Stop or an error), innermost first; a window that was already open before the run (the item's `Opened` flag, read just before the script opens it) is left open. Closing uses the item's own `GetContainerGump()` and that window's `Dispose()`, each looked up with `getattr`, so a client build without either leaves the windows open instead of failing. `API.CloseGump(serial)` is not used: it finds gumps by their server gump id, which a container window does not have, so it cannot close one. The bridge still leaves open whatever it opened.
