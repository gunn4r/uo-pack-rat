# Privacy

Pack Rat stores everything in one folder on your own machine and sends nothing anywhere, except the one request described below: the update check, which is on by default and can be switched off.

## What the app sends over the network

**The only outbound request Pack Rat can make is the update check** (Settings › Updates). It sends one `GET` request to GitHub's public releases API for this repository, asking for the latest release's version number. It carries no data about you, your characters, or your inventory — no body, no query string, no cookie, and only two headers: what format to answer in, and a fixed `pack-rat` user agent. It runs when you press **Check for updates**, and, while **Check for updates automatically** is on (the default), a few seconds after the app opens and every 6 hours while it stays open; while the app stays open, a successful answer is reused for an hour, so reloading the page or pressing the button again soon after asks nothing (the answer is kept in memory only, so a restart asks again). Turn the switch off and the request only happens when you press the button. (GitHub necessarily sees the request's own IP address and which repository was asked about, the same as any web request would.)

There is no analytics, no telemetry, no crash reporting, and no account or sign-in of any kind. Nothing else in the app opens a connection to anything but itself, and there is no automatic updater — the update check reports a version, shows a notice with a link to the release, and downloads and installs nothing; getting the new version is a decision you make in your own browser.

That last claim used to have a hole in it that had nothing to do with the app's own code: Electron ships with Chromium's spellchecker switched on, and on Windows and Linux that downloads a dictionary from Google's servers the first time you click into a text box — which Pack Rat has several of (the Import tab's paste box, the wizard's folder-path field, the box that names a saved run). The spellchecker is now switched off explicitly, in both the browser session and the window's own settings (`electron/main.mts`), and `scripts/electron-guards.test.mts` fails the build if either half goes missing. Nothing in this app benefits from spellchecking a folder path.

## The local server

The app's brain is a small HTTP server that runs on your own machine and talks only to itself:

- It listens on `127.0.0.1` (localhost) only — nothing outside your machine can reach it.
- Every request's `Host` header must name this same local server, on the port it actually bound, or the request is refused. When a request carries an `Origin` header — which a web page's request always does, and a script's or the game adapters' usually doesn't — that has to name the same local server too. This is what stops a malicious page in your regular browser reaching in, even if it points a hostname of its own at your own machine.
- Any request with a body must declare itself as JSON, which a web page cannot do across origins without asking the server's permission first — permission this server never gives.
- The page cannot be embedded in a frame by another site.
- The desktop app generates a random token each time it starts and requires it on every API request; a request without the right token is refused. The app's own page never sees the token — the desktop shell attaches it on the way out. Two kinds of request don't carry one: the app's own files (the page, its scripts and its stylesheet, which hold no data about you), and the live progress bar you see while a suit build is running, which uses a browser feature (`EventSource`) that cannot attach a token at all — that one connection is checked against a long, unguessable id generated fresh for that build instead. Everything still passes the `Host`/`Origin` checks above either way.

**AI assistants (MCP)** (Settings › AI assistants (MCP), off by default) open a second local port for MCP clients such as Claude Code. It too listens on `127.0.0.1` only, refuses any request from a web page (any `Origin` header) or naming another host, and needs its own token on every request, even when you run Pack Rat from source. The token is kept in `mcp.json` in the data folder so a client is set up once; **New token** replaces it. Pack Rat still sends nothing anywhere through it: a client you connect asks, and Pack Rat answers on your own machine. **What the client does with the answers is up to the client**: Claude Code, for one, sends tool results to its model like the rest of the conversation, so an inventory search you ask it for travels with your conversation. `docs/mcp.md` has the details.

If you run the app from source with `npm start` rather than using the desktop app, there is **no token** — that mode is for development and for a browser you drive yourself. All the checks above still close every route to a web page, but another program running on the same machine can reach the port. **On a machine you share with other people, use the desktop app.**

You can read the exact checks in `docs/architecture.md`'s "The server's request checks" section, and the reasoning behind each one in `docs/threat-model.md`.

## What is stored, and where

Everything lives under one data directory:

- **Scans** — the raw output of the in-game scripts, and the normalized inventory built from them. A scan arrives in `inbox/<client>/` (a scan pasted or dropped into the Import drawer is written there too) and is moved into `scans/` once it parses; one that never parses stays in `inbox/<client>/rejected/` with a note about why, until you delete it. Forgetting a container or a character writes a small `_forget-…` file into `scans/` rather than deleting anything.
- **Profiles** — your saved suit-builder settings per character (floors, weights, locked slots, the buffs you turned on in Automatic and the buff numbers you edited, and the rest), and your own templates. The built-in templates ship with the app and are not copied here.
- **Saved runs** — the results of past suit-builder searches (`runs/`), so you can revisit or compare them without rerunning the solver.
- **Settings** (`settings.json`) — which shard's rules you're using, which game client and scripts folder are linked, whether you've been through first-run setup, the data-retention choices (below), and whether the automatic update check is on.
- **Your own shard rules** — any rules file you put in `rules/` yourself; the app only reads that folder.
- **AI assistants** (`mcp.json`) — whether the MCP server and its in-game actions are on, its port and its token. Written only once you change one of its switches, and readable only by your account.
- **View choices** (`ui-prefs.json`) — the Inventory tab's columns, their widths and row height, the look (theme and light/dark), the sidebar, the properties a character sheet shows, the House map's labels and drawer width, the Suit Builder's mode, your Manual suit (item serials), the buffs you turned on in Manual and the buff numbers you edited for No character, and the last release whose update notice you dismissed.
- **The world map** — nothing is stored. The House map's Where section reads your own client's facet map files (`facet00.mul` … `facet05.mul`) from the UO folder, the same way it reads `tiledata.mul`, and draws a piece of the map around your house in memory. The image never leaves your machine, is never written to disk, and none of it ships with Pack Rat.
- **House names** (`house-map.json`) — the names you give your houses on the House map, each with the house's id and its footprint (facet and corner coordinates) when you named it.
- **Blacklisted containers** — the containers your scans skip, with a name, when you added each one and, for a chest on the ground, its position (`scan-blacklist.json`).
- **The bridge queue** — commands waiting for the in-game bridge script (Highlight / Grab / Go to) to pick up and act on, and its own status file, under `bridge/<client>/`.
- **The TazUO panel** — the in-game Pack Rat panel's show/hide hotkey and whether it shows at login (`tazuo-panel.json`, written by the app and by the panel's own button), and the heartbeat the running panel rewrites every 2 seconds (`bridge/tazuo/panel.json`, holding the time and the logged-in character's name).
- **Logs** — see below.
- **The desktop app's browser profile.** Because everything belongs in one folder, the desktop app also points Electron's own Chromium storage here — caches, `Local Storage`, `Cookies`, the single-instance lock that stops a second copy of the app opening on the same folder, and a handful of similar files. The page sets no cookies and stores nothing about you in them; they are browser-engine bookkeeping. They are listed because the Settings tab's "Open" button shows you this whole folder, and it is better to know what those files are than to wonder.

The server creates its own folders owner-only (`0700`) and writes settings, view choices, the panel settings, the blacklist, the Organize setup (`organize.json`), your item kinds (`item-kinds.json`), your house names (`house-map.json`), profiles, saved runs, accepted and pasted scans, the bridge queue and `server.log` owner-only (`0600`), so another account on a shared machine cannot read them — and cannot reach your scans either, since the folder holding them is owner-only too. On the desktop app the shell creates `logs/` and `logs/shell.log` itself before the server starts, also owner-only (`0700` and `0600`). When the data directory does not exist yet, Pack Rat creates it owner-only too; a folder that already existed (one you pointed `--data` at, say) keeps the permissions it had. The in-game scripts write their own files (a scan in the inbox, the bridge's status, the panel's heartbeat and settings, a blacklist entry) with your system's ordinary default permissions, inside those owner-only folders.

**Old scans and saved runs are pruned** unless you tell Pack Rat to keep everything (Settings › Data, stored as `retention` in `settings.json`). Out of the box, each time the app starts it deletes scans older than 30 days that no longer change what your inventory shows (the newest scan of each container you scanned always stays, and if removing the old ones would change anything, none are removed), and keeps each character's 50 newest unnamed saved runs; a run you named is never pruned. **Clean up now** in Settings does the same on demand. Turn on **Keep everything** and nothing is ever pruned.

**Outside the data directory**, Pack Rat writes only into the game-client scripts folder you link during setup: the in-game scripts themselves, a `packrat-paths.json` naming your data directory, and, for TazUO, one entry adding the Pack Rat panel to TazUO's autostart list in `Data/lscript.json` (a copy of the file as it was is kept beside it as `lscript.json.bak`, and nothing is written while TazUO is running).

**Deleting the data directory deletes all of it.** There's no copy anywhere else. The desktop app's Settings tab has a button that opens this folder directly if you want to look inside or back it up yourself.

### The logs

`logs/server.log` is an activity and error log, not a record of what you looked at — successful requests are not logged at all. What lands in it: scan files as they are imported (by full path and filename, so the lines carry your character names and your own folder layout), setup and install steps, the scan and run files data retention removed (by filename), and the stack trace behind any internal error, keyed by the short reference the app shows you when one happens. `logs/shell.log` (desktop app only) is the shell's own start-up and shutdown log plus whatever the server printed.

Your access token never appears in either one. Nothing is uploaded from them — but if you attach one to a bug report, it will show your operating-system username, your folder paths and every character name you have scanned. Neither file is ever trimmed or rotated, so both grow for as long as you use the app; deleting them is safe at any time.

## What a scan file says about you

A scan file is a complete picture of one character, and it is worth knowing what that means before you hand one to anybody.

It records the character's name; their full skill list with every value and cap; their stats, maximum pools and resistances; every item they own, with each item's in-game serial number and every line of its tooltip — which includes "Crafted by `<someone>`" lines and anything engraved on a bag or a piece of gear; and, because the in-game bridge has to be able to walk back to a container, the **world coordinates** of the character at the moment of the scan and of every ground container it read. In practice you scan standing among your own chests, so that usually means **your house's location**, plus the exact tile of each chest inside it. Two kinds of container are left out: a trash barrel or chest (anything named "trash") is never opened or recorded, and the TazUO and Razor Enhanced scanners do not open a container you blacklisted — a blacklisted chest on the ground is left out entirely, and a blacklisted bag is recorded only as an unopened bag.

The schema also has room for an opaque, hashed account identifier, which no shipped adapter writes today.

So: if you share a scan file — to report a bug, ask for help, or hand it to someone else — expect all of that to travel with it. Not just which character it came from, but where that character keeps their things, and an itemized list of what is worth taking. On a shard with house-adjacent theft mechanics, that is a targeting aid.

> **Before attaching a scan file to a public issue, a forum post or a Discord message, open it and look.** A GitHub issue is permanent, public and indexed. If you only need the app to reproduce a bug, say so in the issue and ask what to send — a few tooltip lines are usually enough, and the maintainer can take the rest privately.
