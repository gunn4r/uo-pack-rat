<p align="center"><img src="build/icon.png" width="160" height="160" alt="The Pack Rat logo: a rat peeking out of an overstuffed leather adventurer's backpack, holding a gold coin"></p>

<h1 align="center">Pack Rat</h1>

Pack Rat is a free app for Ultima Online players. It keeps a list of every item you own, on every character, in every bag, chest and bank box, and works out the best suit of gear you could put together from them.

It gets that list from small scripts you run yourself, inside your own game client. Everything stays on your computer.

What you can do with it:

- Search everything you own in one table.
- See what each character is wearing, on an in-game-style character sheet.
- Ask for the best suit your items allow, with the stats, floors and caps you care about.
- Press a button in the app to make the game show you where an item is, walk you to its chest, or put it in your backpack.
- Pick the **Britannia** theme in **Settings › Theme** for parchment, brass frames and a dark-wood night mode.

## Download and install

Go to the [Releases page](https://github.com/gunn4r/uo-pack-rat/releases) and, under the latest release, download the file for your computer:

| Your computer | File |
|---|---|
| Mac with an Apple chip (M1, M2, M3, M4…) | `PackRat-<version>-mac-arm64.dmg` |
| Mac with an Intel chip | `PackRat-<version>-mac-x64.dmg` |
| Windows (installer) | `PackRat-<version>-win-x64.exe` |
| Windows (no install) | `PackRat-<version>-portable-win-x64.exe` |
| Linux | `PackRat-<version>-linux-x86_64.AppImage` |

Not sure which Mac you have? Apple menu › **About This Mac**: **Chip: Apple M…** means the Apple chip file, **Processor: … Intel …** the Intel one. Each Mac build also comes as a `.zip` if you'd rather drag the app into Applications yourself.

Pack Rat is not code-signed (signing is a paid certificate that tells your computer who made an app), so the first launch shows a warning. That is expected.

**Mac.** Open the `.dmg` and drag **Pack Rat** into **Applications**. In Applications, right-click **Pack Rat** and choose **Open**, then **Open** again; you only do this once. If there is no **Open** button, go to **System Settings › Privacy & Security** and click **Open Anyway**. If macOS says the app **"is damaged and can't be opened"**, that is how it describes an unsigned download; run this in Terminal, then open it again:

```
xattr -dr com.apple.quarantine "/Applications/Pack Rat.app"
```

macOS may also ask whether Pack Rat can access your Desktop or another folder. That is Pack Rat reading your game client's folder (for example TazUO kept on the Desktop) to install and update its scripts; allow it.

**Windows.** Run the installer. If **"Windows protected your PC"** appears, click **More info**, then **Run anyway**. The portable `.exe` runs without installing and shows the same warning.

**Linux.** Make the AppImage executable, then run it:

```
chmod +x PackRat-<version>-linux-x86_64.AppImage
./PackRat-<version>-linux-x86_64.AppImage
```

## First run

The first time Pack Rat opens, a setup window walks you through four steps:

1. **Shard.** Pick the shard you play on.
2. **Client.** Pick your game client: **TazUO**, **Razor Enhanced** (Windows only) or the **ClassicUO web client** (the one you play in a browser).
3. **Client folder.** Pick the folder your client is installed in. Pack Rat finds TazUO on its own when it can; otherwise click **Choose a folder…** (for TazUO, the `TazUO` folder or the `LegionScripts` folder inside it; for Razor Enhanced, the folder `Razor.exe` is in).
4. **Install scanner.** If the game is running, stop any running Pack Rat scripts first, so none is replaced while it runs (TazUO: type `-stopall` in the game's chat; Razor Enhanced: press Stop on each in its Scripting tab). Tick the box that says you did, click **Install scanner**, then **Finish**. The last screen lists what to press in game, and when.

The ClassicUO web client can't save files, so there is nothing to install for it: step 3 gives you a **Copy scanner script** button instead, to paste into the web client, and **Settings › Game client** has the same button for later updates (see [below](#the-classicuo-web-client)).

**Set up later** is always safe. You can run setup again from **Settings › Run setup**.

TazUO scripts require **TazUO v26.0923.64 or later**; update TazUO from its launcher if yours is older.

## Everyday use

The setup window put these scripts in your client's scripts folder (which ones depends on the client):

- **`packrat-scanner.py`** — the full scan: what you wear, your backpack, and every chest and bag within 3 tiles, including bags inside them. With your bank box open it reads the bank instead of nearby chests. Trash barrels and chests are skipped.
- **`packrat-refresh.py`** — a quick refresh of your stats, skills, worn gear and backpack; takes a few seconds, works anywhere.
- **`packrat-bridge.py`** — makes the app's **Highlight**, **Grab** and **Go to** buttons work. Start it and leave it running; it stops on its own after 8 hours.
- **`packrat-blacklist.py`** — click a chest or bag and scans never open it again, such as a guild chest. You can also blacklist a container from the app's **Containers** view.
- **`packrat-panel.py`** — the in-game Pack Rat panel (TazUO only): a small window with buttons for all of the above, and Organize's **Put away** (below). It starts with TazUO; **Ctrl+Shift+P** shows or hides it, and you can change that hotkey in **Settings**.

The routine:

- **First time on a character, or when your chests change:** stand next to a group of chests and run the scanner; repeat at each group. For your bank, open the bank box and run it there.
- **After gearing up or training:** run the quick refresh.
- **To find or fetch an item:** start the bridge, then use the buttons on the item in **Inventory** or **Suit Builder**. **Highlight** marks it and its container in game, **Go to** walks you to its chest, **Grab** walks there and puts it in your backpack. To find a chest itself, use **Highlight in game** in its ⋯ menu under Inventory › Containers.

Scans show up in **Inventory** within a few seconds; you don't have to press anything in the app. **Characters** shows each character's sheet and paperdoll, and **Suit Builder** finds the best suit for a character from everything you own, with saved runs you can reopen and compare.

In TazUO, start a script from the in-game panel, or from the Script Manager (**Legion Script** in TazUO's top menu) with its **Play** button. In Razor Enhanced (Windows only), add the Pack Rat scripts on the **Scripts** tab and start them like any other script; it has every script but the in-game panel. More in [adapters/razor-enhanced/README.md](adapters/razor-enhanced/README.md).

### Organize

Organize gives every item in your house a home. Label the chests that are yours (Inventory › Containers, ⋯ › Label…), then add rules on the **Organize** screen: start from a preset such as Magery reagents or Rings, or save the Inventory's current filters as a rule, and pick the containers each rule fills, in order: your labelled chests, or a bag inside one. While you edit a rule it says how many of your items it matches. Items go to the first rule they match; anything no rule takes stays put, or goes to the container you pick for everything else.

**Auto organize** does the setting up for you. Press **Auto organize…** on the Organize screen, choose **Simple** (one container for each kind of thing: armour, weapons, jewelry, reagents, scrolls, resources and so on), **Detailed** (armour by slot, reagents by school, power scrolls by level, resources by type) or **By build** (gear sorted into Caster, Melee, Hybrid, Tank and Other gear by its properties, everything else as in Simple), and tick the chests it may use. It gives each group the chest that already holds most of it, adds more chests when a group is too big for one, lets the small groups of one kind share a chest when there are fewer chests than groups, and shows the proposal before anything is saved: which chest each group gets, what does not fit and how many more chests to place, and how many items will move. **Accept** labels the ticked chests and writes ordinary rules marked Auto, which you can edit like any other (an edited rule is yours from then on). Your own rules stay above Auto's, your own labels are never renamed, and running Auto organize again on a house it has already sorted changes nothing.

Pack Rat then shows the plan before anything moves: what does not fit and how many slots are missing, what belongs at another house, and the trips, with about how long they will take. With the TazUO client, **Run trip** carries one trip out in game while you watch, moving an item straight from chest to chest when the two stand close enough to reach both from one spot (**Run all** goes on trip by trip, **Stop** halts after the current step); with other clients the plan tells you what to move by hand. Only labelled containers are ever touched, a pinned container is never emptied or filled, and an item the server refuses to move can be pinned where it is.

**Put away** files what you bring home without the app window. Once the house is sorted, press **Put away backpack** on the in-game Pack Rat panel (TazUO): it refreshes your backpack, and Pack Rat puts each item loose at the top of it into the chest its rule names, in the house you stand in, trip after trip, until nothing is left. Items in a bag inside your backpack, blessed or insured items and pinned items stay with you, and nothing else in the house moves. Or drop your loot into one chest labelled as the **Inbox** (Label… › Inbox), stand by it and press **Put away Inbox**. The app must be running and the bridge started; the panel says how many items went where they belong, and what stayed and why.

Organize reads each container's fill from its tooltip. If the plan says a container's fill is unknown, or that it was scanned with older scripts, reinstall the scripts (**Settings › Game client › Reinstall**) and rescan your house.

### The ClassicUO web client

Click **Copy scanner script** (in setup, or later in **Settings › Game client**, which also says when a newer scanner ships) and paste it into the web client's scripting window as a new script; run it near what you want scanned. Copy the block it prints (from `-----BEGIN PACK RAT SCAN-----` to `-----END PACK RAT SCAN-----`), open **Import** in Pack Rat (⌘I, or Ctrl+I on Windows and Linux) and paste it. The web client can't see your bank box and has no bridge, so Highlight, Grab and Go to don't work for it. More in [adapters/classicuo-web/README.md](adapters/classicuo-web/README.md).

### Play attended

The scripts only read what your character can see, and only move an item when you click a button in the app. They never fight, gather or loot, and they don't keep acting while you are away. Most shards ban unattended fighting, gathering and looting, sometimes harshly; check your own shard's rules before running any script.

The Razor Enhanced and ClassicUO web client scripts have not been tried against a live game yet. If something goes wrong, please [open an issue](https://github.com/gunn4r/uo-pack-rat/issues).

## Updating

Pack Rat checks for a newer release shortly after it opens and every 6 hours while it stays open, and shows a notice with a **View release** link when there is one. Nothing downloads or installs on its own: download the new version from the Releases page and install it over the old one. You can check by hand, or turn the automatic check off, in **Settings › Updates**.

After updating the app, update the game scripts too: stop any running Pack Rat scripts (TazUO: `-stopall`; Razor Enhanced: Stop in its Scripting tab), then in **Settings** click **Reinstall** under **Reinstall scanner scripts**.

## Your data and privacy

Everything Pack Rat knows lives in one folder on your computer (**Settings › Data** has an **Open** button). Back it up by copying the folder; deleting it deletes everything. Only one Pack Rat can run on a data folder at a time.

| Computer | Folder |
|---|---|
| Mac | `~/Library/Application Support/Pack Rat` |
| Windows | `%APPDATA%\Pack Rat` |
| Linux | `~/.config/Pack Rat` |

The app sends nothing anywhere except the update check, which asks GitHub for the latest version number. A scan file lists everything a character owns and where your scanned chests are, which usually means where your house is, so look before you post one in public. [PRIVACY.md](PRIVACY.md) has the details.

## Verifying a download

Optional. Each release has a `SHA256SUMS` file for checking that a download is exactly the file this project published, which is worth doing if you got Pack Rat from anywhere other than the Releases page. The steps are in [RELEASING.md](RELEASING.md#verifying-a-download).

## Help

- **The setup window can't find my client folder.** Click **Choose a folder…** and pick it by hand; if Pack Rat says the folder isn't right, try one level up or down.
- **I ran the scanner but nothing showed up.** Check **Settings**: the client should show as installed. If you moved your game client, click **Run setup** again. A scan file Pack Rat can't read is put aside in a `rejected` folder in the data folder, with a note saying why.
- **Pack Rat says my game scripts write to another folder.** Stop any running Pack Rat scripts and reinstall the scripts from **Settings**; they will then write to the folder Pack Rat reads.
- **Pack Rat says a script is still running.** Stop it, then try again. TazUO: type `-stopall` in the game's chat and wait for **"No scripts are currently running"**. Razor Enhanced: in its Scripting tab, select each running Pack Rat script and press Stop.
- **The buttons say the bridge is offline.** Start `packrat-bridge.py` in game and wait until the app shows **Bridge ready** with your character's name.
- **A chest didn't get scanned.** The scanner only reads chests close to you that it can open; stand closer and run it again. A container that won't open keeps what was last scanned in it.

Questions and ideas: [Discussions](https://github.com/gunn4r/uo-pack-rat/discussions). Bugs: [Issues](https://github.com/gunn4r/uo-pack-rat/issues) — describe what you did and what you saw, and don't attach a scan file without reading it first.

## Building from source and contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for running from source, the tests, the architecture and the adapter contracts, and [SECURITY.md](SECURITY.md) for reporting a security problem.

## License

MIT — see `LICENSE`. The bundled IBM Plex Sans and IBM Plex Mono fonts (`app/ui/fonts/`) are © IBM Corp., and the Cinzel font the Britannia theme uses is © The Cinzel Project Authors, all under the SIL Open Font License 1.1; their licence texts sit next to them. The Britannia theme's frames and textures are drawn by the app itself; it uses no art from any game or game client.
