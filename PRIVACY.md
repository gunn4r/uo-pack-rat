# Privacy

Pack Rat stores everything in one folder on your own machine and sends nothing anywhere, except the one request described below, which only happens when you ask for it.

## What the app sends over the network

**The only outbound request Pack Rat can make is the manual "Check for updates" button** (Settings tab). Pressing it sends one `GET` request to GitHub's public releases API for this repository, asking for the latest release's version number. It carries no data about you, your characters, or your inventory — no body, no query string, no cookie, and only two headers: what format to answer in, and a fixed `pack-rat` user agent. Nothing runs on a timer, on startup, or in the background; if you never press it, that request never happens. (GitHub necessarily sees the request's own IP address and which repository was asked about, the same as any web request would.)

There is no analytics, no telemetry, no crash reporting, and no account or sign-in of any kind. Nothing else in the app opens a connection to anything but itself, and there is no automatic updater — the update check reports a version and offers a link, and downloading anything is a decision you make in your own browser.

That last claim used to have a hole in it that had nothing to do with the app's own code: Electron ships with Chromium's spellchecker switched on, and on Windows and Linux that downloads a dictionary from Google's servers the first time you click into a text box — which Pack Rat has several of (the Import tab's paste box, the wizard's folder-path field, the box that names a saved run). The spellchecker is now switched off explicitly, in both the browser session and the window's own settings (`electron/main.mts`), and `scripts/electron-guards.test.mts` fails the build if either half goes missing. Nothing in this app benefits from spellchecking a folder path.

## The local server

The app's brain is a small HTTP server that runs on your own machine and talks only to itself:

- It listens on `127.0.0.1` (localhost) only — nothing outside your machine can reach it.
- Every request's `Host` header must name this same local server, on the port it actually bound, or the request is refused. When a request carries an `Origin` header — which a web page's request always does, and a script's or the game adapters' usually doesn't — that has to name the same local server too. This is what stops a malicious page in your regular browser reaching in, even if it points a hostname of its own at your own machine.
- Any request with a body must declare itself as JSON, which a web page cannot do across origins without asking the server's permission first — permission this server never gives.
- The page cannot be embedded in a frame by another site.
- The desktop app generates a random token each time it starts and requires it on every API request; a request without the right token is refused. The app's own page never sees the token — the desktop shell attaches it on the way out. Two kinds of request don't carry one: the app's own files (the page, its scripts and its stylesheet, which hold no data about you), and the live progress bar you see while a suit build is running, which uses a browser feature (`EventSource`) that cannot attach a token at all — that one connection is checked against a long, unguessable id generated fresh for that build instead. Everything still passes the `Host`/`Origin` checks above either way.

If you run the app from source with `npm start` rather than using the desktop app, there is **no token** — that mode is for development and for a browser you drive yourself. All the checks above still close every route to a web page, but another program running on the same machine can reach the port. **On a machine you share with other people, use the desktop app.**

You can read the exact checks in `CONTRIBUTING.md`'s Security section, and the reasoning behind each one in `docs/threat-model.md`.

## What is stored, and where

Everything lives under one data directory:

- **Scans** — the raw output of the in-game scripts, and the normalized inventory built from them. A scan arrives in `inbox/<client>/` and is moved into `scans/` once it parses; one that never parses stays in `inbox/<client>/rejected/` with a note about why, until you delete it.
- **Profiles** — your saved suit-builder settings per character (floors, weights, locked slots, and the rest).
- **Saved runs** — the results of past suit-builder searches, so you can revisit or compare them without rerunning the solver.
- **Settings** — which shard's rules you're using, which game-client folder is linked, and whether you've been through first-run setup.
- **View choices** — which columns the Inventory tab shows (`ui-prefs.json`).
- **The bridge queue** — commands waiting for the in-game bridge script (Highlight / Grab / Go to) to pick up and act on, and its own status file.
- **Logs** — see below.
- **The desktop app's browser profile.** Because everything belongs in one folder, the desktop app also points Electron's own Chromium storage here — caches, `Local Storage`, `Cookies`, and a handful of similar files. The page sets no cookies and stores nothing about you in them; they are browser-engine bookkeeping. They are listed because the Settings tab's "Open" button shows you this whole folder, and it is better to know what those files are than to wonder.

The server creates its own folders owner-only (`0700`) and writes settings, view choices, profiles, saved runs, accepted scans, the bridge queue and `server.log` owner-only (`0600`), so another account on a shared machine cannot read them — and cannot reach your scans either, since the folder holding them is owner-only too. On the desktop app the shell creates `logs/` and `logs/shell.log` itself before the server starts, also owner-only (`0700` and `0600`). The data directory itself is created with your system's ordinary default permissions, but nothing inside it is readable by another account.

**Deleting the data directory deletes all of it.** There's no copy anywhere else. The desktop app's Settings tab has a button that opens this folder directly if you want to look inside or back it up yourself.

### The logs

`logs/server.log` is an activity and error log, not a record of what you looked at — successful requests are not logged at all. What lands in it: scan files as they are imported (by full path and filename, so the lines carry your character names and your own folder layout), setup and install steps, and the stack trace behind any internal error, keyed by the short reference the app shows you when one happens. `logs/shell.log` (desktop app only) is the shell's own start-up and shutdown log plus whatever the server printed.

Your access token never appears in either one. Nothing is uploaded from them — but if you attach one to a bug report, it will show your operating-system username, your folder paths and every character name you have scanned. Neither file is ever trimmed or rotated, so both grow for as long as you use the app; deleting them is safe at any time.

## What a scan file says about you

A scan file is a complete picture of one character, and it is worth knowing what that means before you hand one to anybody.

It records the character's name; their full skill list with every value and cap; their stats, maximum pools and resistances; every item they own, with each item's in-game serial number and every line of its tooltip — which includes "Crafted by `<someone>`" lines and anything engraved on a bag or a piece of gear; and, because the in-game bridge has to be able to walk back to a container, the **world coordinates** of the character at the moment of the scan and of every ground container it read. In practice you scan standing among your own chests, so that usually means **your house's location**, plus the exact tile of each chest inside it.

The schema also has room for an opaque, hashed account identifier, which no shipped adapter writes today.

So: if you share a scan file — to report a bug, ask for help, or hand it to someone else — expect all of that to travel with it. Not just which character it came from, but where that character keeps their things, and an itemised list of what is worth taking. On a shard with house-adjacent theft mechanics, that is a targeting aid.

> **Before attaching a scan file to a public issue, a forum post or a Discord message, open it and look.** A GitHub issue is permanent, public and indexed. If you only need the app to reproduce a bug, say so in the issue and ask what to send — a few tooltip lines are usually enough, and the maintainer can take the rest privately.
