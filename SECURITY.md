# Security policy

## Reporting a vulnerability

**Preferred:** GitHub's private vulnerability reporting on this repository — the **Security** tab → **Report a vulnerability**. That opens a private advisory only the maintainer can see, rather than a public issue, so a fix can ship before the details are public.

**If that tab or button isn't there:** private vulnerability reporting is off by default on a new GitHub repository, so it may not be turned on yet. Open a regular issue that says only that you've found a security issue and asks to be pointed at a private channel — do not describe the vulnerability itself in the issue. The maintainer will follow up with somewhere private to send the details. This route always works, since Issues stays open on this repository regardless of what else is or isn't enabled.

**Do not open a public issue describing anything exploitable**, either way — a public issue is never the right channel for the vulnerability's actual details.

## Scope

In scope:

- The localhost HTTP server (`app/vault-server.mjs`) and its token, `Host`/`Origin` checks, and request handling.
- The setup wizard's script installer (`app/installer.mjs`) — path handling when copying adapter scripts into a game-client folder, and the running-script guard.
- The scan and bridge file parsers (`app/scan-schema.mjs`, `app/watcher.mjs`, the bridge protocol handling in `app/vault-server.mjs`) — anything that reads a file an adapter script or a player produced.
- The Electron shell (`electron/main.mjs`) — window settings, navigation restrictions, and how the per-launch token is attached to requests.

Out of scope:

- The game client itself (TazUO) and anything about how it runs Legion Scripts.
- The shard's own servers, or anything about the game's network protocol.
- An attacker who already has code execution or file access on the player's own machine — Pack Rat is a local, single-user tool with no remote attack surface once you're on the same machine as the player.

## Unsigned builds

Every build this project ships is **unsigned by design** in this release (see `RELEASING.md`'s Before 1.0 section) — there is no code-signing certificate behind it yet, on macOS or Windows. Only download Pack Rat from this project's own [Releases page](https://github.com/gunn4r/uo-pack-rat/releases). A copy from anywhere else has no way to be verified against what this project actually built.
