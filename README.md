# Pack Rat

Every item you own, every suit you could wear.

Pack Rat is a free, open-source desktop app for Ultima Online players. It knows every item you own, across every character and every container, by reading through small adapter scripts that run inside your own game client — everything runs attended, entirely on your own machine, and it never sends anything off that machine on its own. (See `PRIVACY.md` for the one request you can trigger yourself.)

What it does:

- Shows your whole inventory in one searchable table — every item, in every bag, chest and bank box, across every character you've scanned.
- Shows who is wearing what, character by character.
- Builds the best suit your inventory allows for a template you define (weights, floors, locked slots, and the rest), using an exact solver where it can prove the optimum.
- Highlights, grabs, or walks you to any item in the game client itself, from the app's own buttons, through an in-game bridge script.

## Status

Pre-release. No tagged version has been published yet — see `RELEASING.md` for how one gets cut. The app itself is functional end to end (inventory, suit builder, the setup wizard, the packaging and CI that will build the installers below), but until the first release is tagged there is nothing on the Releases page to download.

## Install

Once a release is published, download the file for your platform from this repository's [Releases page](https://github.com/gunn4r/uo-pack-rat/releases):

| Platform | File |
|---|---|
| macOS (Apple Silicon) | `Pack Rat-<version>-mac-arm64.dmg` |
| macOS (Intel) | `Pack Rat-<version>-mac-x64.dmg` |
| Windows | `Pack Rat-<version>-win-x64.exe` |
| Linux | `Pack Rat-<version>-linux-x86_64.AppImage` |

(`<version>` is the release's version number, e.g. `0.1.0`.) On macOS, a `.zip` of each build is also published alongside the `.dmg`, for anyone who'd rather unzip and drag the app to `Applications` by hand than use the installer.

### The unsigned-build warnings

Pack Rat isn't code-signed yet (see `SECURITY.md` and `RELEASING.md`'s Before 1.0 section) — every OS is going to warn you before it lets an unsigned app run. That warning is expected; here's how to get past it on each platform.

**macOS.** Gatekeeper will call the app "damaged" or refuse to open it, because it isn't signed. Right-click (or Control-click) `Pack Rat.app` and choose **Open** — that shows a dialog with an actual Open button that a plain double-click doesn't. If that still refuses, clear the quarantine flag from a terminal instead:

```
xattr -dr com.apple.quarantine "/Applications/Pack Rat.app"
```

**Windows.** SmartScreen will show "Windows protected your PC." Click **More info**, then **Run anyway**.

**Linux.** The AppImage needs its executable bit set before it will run:

```
chmod +x "Pack Rat-<version>-linux-x86_64.AppImage"
./"Pack Rat-<version>-linux-x86_64.AppImage"
```

## First run

The first time you launch Pack Rat, a setup wizard walks you through four short steps: which shard's rules to use, which game client to link (TazUO, Razor Enhanced, or the ClassicUO web client today), locating that client's scripts folder for TazUO or Razor Enhanced (auto-detected where possible for TazUO; Razor Enhanced has no single well-known install location, so its folder is always picked by hand for now — the ClassicUO web client has no folder to locate at all, since it can't write files, and instead sends you to the Import tab to paste what its scanner prints), and installing the adapter scripts into it. Every step can be skipped, and skipping never traps you — you can reopen the wizard later from the Settings tab.

Once the scripts are installed, there's nothing left to see until you run one in-game: stand near a chest cluster and run the scanner script (below), and its output appears in the app within a few seconds, picked up automatically.

If you already have scan files from somewhere else, the last step of the wizard (and the Settings tab) also has an **Import** button that copies a folder of them straight in.

## The game side

Three small Python scripts run inside the TazUO client and feed the app — installed for you by the setup wizard above, or by hand per `adapters/tazuo/README.md`:

- **The scanner** reads every equipped layer, your backpack, an open bank box, and every container you can reach, recursively. Run it standing next to a chest cluster; repeat at each cluster you want covered.
- **The refresh script** is a quick read of one character's stats, skills, resists, and backpack — no need to stand anywhere special. Run it after a gearing or training session.
- **The bridge** executes the app's Highlight, Grab, and Go to buttons in the game client. Start it and leave it running while you use those buttons.

All three are attended tools: they read what your character can see and move an item only when you click something in the app. They never fight, farm, or loop unattended — which matters, because most UO shards (including the one this was built for) ban unattended combat, resource, and loot gathering, sometimes with severe penalties. Nothing here is built to get around that rule; check your own shard's policy before running anything automated.

**On [Razor Enhanced](https://razorenhanced.readthedocs.io/)** (Windows-only, and what most shards officially distribute) two IronPython scripts do the same job: a scanner and a bridge, installed into Razor Enhanced's own Scripts folder — see `adapters/razor-enhanced/README.md` for install steps, exactly which capabilities are backed by which documented API call, and what's still unverified (this adapter, too, hasn't been run against a live client yet; development happens on macOS, and Razor Enhanced is Windows-only).

**On the [ClassicUO web client](https://play.classicuo.org)** there's no filesystem to install scripts into, so instead there's one script, `adapters/classicuo-web/packrat-scanner.ts`, that prints its scan to the console area below the scripting window; you copy that and paste it into the app's Import tab. See `adapters/classicuo-web/README.md` for the steps and, importantly, what that client can't see (the bank box, most likely the equipped arms slot, and any ground container outside a small known list) — this adapter hasn't been run against a live client yet either, and the README says exactly what's still unverified.

## Your data

Everything the app knows lives in one folder on your machine:

| Platform | Default data directory |
|---|---|
| macOS | `~/Library/Application Support/Pack Rat` |
| Windows | `%APPDATA%\Pack Rat` |
| Linux | `~/.config/Pack Rat` |

See `PRIVACY.md` for exactly what's stored there, and the one request the app can ever make off your machine.

## Developing

See `CONTRIBUTING.md` for the dev loop, the module layout, and the app's external contracts (scan files, the bridge protocol, shard rules). Run the desktop app with `npm run desktop`, the bare server with `npm start -- --open`, and the tests with `npm test` — see `TESTING.md` for the tag scheme and what each test file covers.

## License

MIT — see `LICENSE`.
