# Privacy

Pack Rat stores everything in one folder on your own machine and sends nothing anywhere, except the one request described below, which only happens when you ask for it.

## What the app sends over the network

**The only outbound request Pack Rat can make is the manual "Check for updates" button** (Settings tab). Pressing it sends one `GET` request to GitHub's public releases API for this repository, asking for the latest release's version number. It carries no data about you, your characters, or your inventory — just a request for a version string, and only when you press the button. Nothing runs on a timer, on startup, or in the background; if you never press it, that request never happens.

There is no analytics, no telemetry, no crash reporting, and no account or sign-in of any kind. Nothing else in the app opens a connection to anything but itself.

## The local server

The app's brain is a small HTTP server that runs on your own machine and talks only to itself:

- It listens on `127.0.0.1` (localhost) only — nothing outside your machine can reach it.
- Every request is checked against its `Host` and `Origin` headers, and refused if either one doesn't name this same local server — a guard against a malicious web page in your regular browser trying to reach into it.
- The desktop app generates a random token each time it starts and requires it on almost every request; a request without the right token is refused. There's one exception: the live progress bar you see while a suit build is running uses a browser feature (`EventSource`) that can't attach the token at all, so that one connection is checked a different way instead — a long, unguessable id generated fresh for that build, in place of the token. Both checks still pass through the Host/Origin guard above either way.

You can read the exact checks in `CONTRIBUTING.md`'s Security section if you want the details.

## What is stored, and where

Everything lives under one data directory:

- **Scans** — the raw output of the in-game scripts, and the normalized inventory built from them.
- **Profiles** — your saved suit-builder settings per character (floors, weights, locked slots, and the rest).
- **Saved runs** — the results of past suit-builder searches, so you can revisit or compare them without rerunning the solver.
- **Settings** — which shard's rules you're using, which game-client folder is linked, and whether you've been through first-run setup.
- **The bridge queue** — commands waiting for the in-game bridge script (Highlight / Grab / Go to) to pick up and act on, and its own status file.
- **Logs** — the server's own request log and, in the desktop app, the shell's startup/shutdown log. These are plain text on your disk; nothing is uploaded from them.

**Deleting the data directory deletes all of it.** There's no copy anywhere else. The desktop app's Settings tab has a button that opens this folder directly if you want to look inside or back it up yourself.

## Scan files identify you

A scan file records your characters' names, the items they own, and those items' in-game serial numbers, read straight off your own account. If you share a scan file — to report a bug, ask for help, or hand it to someone else — expect it to identify which character and account it came from. Strip or rename what you don't want visible before sharing one.
