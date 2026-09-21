# Security policy

## Reporting a vulnerability

**Preferred:** GitHub's private vulnerability reporting on this repository — the **Security** tab → **Report a vulnerability**. That opens a private advisory only the maintainer can see, rather than a public issue, so a fix can ship before the details are public. Private vulnerability reporting is enabled on this repository, so that button is there.

**If you can't reach it for any reason:** open a regular issue that says only that you've found a security issue and asks to be pointed at a private channel — do not describe the vulnerability itself in the issue. The maintainer will follow up with somewhere private to send the details.

**Do not open a public issue describing anything exploitable**, either way — a public issue is never the right channel for the vulnerability's actual details.

Expect a first reply within a week. This is a one-person project with no on-call rotation; there is no bounty.

## Supported versions

Pre-release: no version has been tagged yet, so the supported version is the current `main` branch. Once releases start, only the most recent one is supported — there are no backports to older tags. `CHANGELOG.md` is where a security fix is described in user terms.

## Scope

`docs/threat-model.md` is the long form: the processes, the trust boundaries, which defence stops which attack, and the findings that were deliberately left standing and why. Read it before reporting — it may already answer whether what you found is considered in scope.

In scope:

- The localhost HTTP server (`app/vault-server.mts`) and its token, `Host`/`Origin`/content-type checks, and request handling.
- The setup wizard's script installer (`app/installer.mts`) — path handling when copying adapter scripts into a game-client folder, the atomic-write helper, and the running-script guard.
- The scan and bridge file parsers (`app/scan-schema.mts`, `app/schema/validate.mts`, `app/watcher.mts`, `app/vault-lib.mts`) — anything that reads a file an adapter script or a player produced — and the page code that renders what comes out of them.
- The Electron shell (`electron/main.mts`, `electron/host-args.mts`) — window settings, navigation and permission restrictions, the fuses on a packaged build, and how the per-launch token is attached to requests.
- `POST /api/bridge` and the adapter bridge scripts. This is the one path whose input crosses into the player's running game client and moves their character, so it gets its own treatment in the threat model.
- The release path (`.github/workflows/`) — what a compromised action or build dependency could reach.

Out of scope:

- The game client itself (TazUO, Razor Enhanced, the ClassicUO web client) and anything about how it runs scripts.
- The shard's own servers, or anything about the game's network protocol.
- An attacker who already runs code as the player on the player's own machine. That process can read and write the data directory, read the token out of a process environment, and rewrite the adapter scripts in the game client's own folder, all without going through this app — no check here could stop it, and pretending otherwise would be theatre. The one exception worth reporting anyway: a way for this app to *extend* that attacker's reach, for instance by launching a file for them or writing outside a folder the player chose.
- Code signing. Every build is unsigned by design in this release; `RELEASING.md` tracks it as a pre-1.0 item.

## Unsigned builds

Every build this project ships is **unsigned by design** in this release (see `RELEASING.md`'s Before 1.0 section) — there is no code-signing certificate behind it yet, on macOS or Windows. Only download Pack Rat from this project's own [Releases page](https://github.com/gunn4r/uo-pack-rat/releases), and check what you downloaded against the `SHA256SUMS` file published beside it — `RELEASING.md`'s "Verifying a download" section has the exact command for each platform, and is honest about what a checksum published by the same workflow does and does not prove.
