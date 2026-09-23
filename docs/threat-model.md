# Threat model

What Pack Rat is defending, from whom, and which defence is doing the work. Written after the phase-7 security review, and checked against the code as it stands rather than against the review's own notes.

`SECURITY.md` is the short version and says how to report something. This document is the reasoning: the processes and the data that crosses between them, each trust boundary and what holds it, the attackers considered and the ones deliberately not, and — at the end — the findings left standing on purpose, each with the reason.

Two things to know before reading. First, every defence named here is described at the level of a file and a function, never a line number, because line numbers rot and nobody notices. Second, this document describes classes of problem and the defence against them; it is not a recipe, and it should not become one.

## What the app is

Pack Rat reads a player's Ultima Online inventory — every item, on every character, in every container — through small adapter scripts that run inside their own game client, and builds the best suit that inventory allows. Everything runs on the player's own machine. There is no back end, no account and no hosted component of any kind — the HTTP server below is a loopback one inside the app itself — and the single outbound request the app can make is a manual update check, which `PRIVACY.md` covers.

### Processes

| Process | What it is | What it can do |
|---|---|---|
| **Electron main** (`electron/main.mts`) | The shell. One window, one child process, the single-instance lock. | The only part of the app that can reach the OS: a native folder dialog, opening a folder in Finder/Explorer. It runs none of the server's own code. |
| **The server child** (`electron/server-entry.mts` → `app/vault-server.mts`) | A `utilityProcess.fork()` child: an ordinary Node process with no Electron globals. Under `npm start` this is simply the whole app. | Binds a loopback HTTP port, reads and writes the data directory, watches the inbox, parses scan files, spawns worker threads. |
| **The renderer** (`app/index.html` + `app/dist/ui/*.mjs`) | A sandboxed `BrowserWindow` pointed at the local server. `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, **no preload script at all**. | Fetches from the local server. Nothing else — there is no bridge object to abuse, because there is no preload to expose one. |
| **Optimize workers** (`app/optimize-worker.mts`) | One worker thread per suit-build job, inside the server child. | Runs the solver. Reachable only through `new Worker()` from the server, with data the server assembled. |
| **Adapter scripts** (`adapters/*/packrat-*.py`, `adapters/classicuo-web/packrat-scanner.ts`) | Python (or TypeScript) that the *game client* runs, not this app. Installed into a folder the player picked. | Reads what the character can see; writes scan files; the bridge script opens containers, moves one item into the player's own backpack, and walks the character a short distance. |

### Data flows

- **Game client → app.** An adapter scanner writes a JSON scan file into `<data>/inbox/<adapter>/`. `app/watcher.mts` (`ingestFile`) validates it and moves it into `<data>/scans/`. The paste-transport adapter prints its document to the client's console instead and the player pastes it into the Import tab, which joins the same path at `app/import.mts`'s `parsePastedScan`.
- **App → page.** `GET /api/inventory` and `GET /api/items` serve the fold of every scan (`app/vault-lib.mts`'s `foldSnapshots`). Scan-derived text — item names, container engravings, tooltip lines, character names — reaches the page here and is rendered there.
- **Page → app → game client.** A Highlight / Grab / Go-to click posts to `POST /api/bridge`, which appends one validated line to `<data>/bridge/<adapter>/queue.jsonl`. The adapter's bridge script, running inside the client, reads that file and acts in the world. It writes `status.json` back; `GET /api/bridge/status` reads it.
- **App → game-client folder.** The setup wizard's Install step (`app/installer.mts`'s `installScripts`) copies the adapter scripts and a `packrat-paths.json` into the folder the player chose.
- **Server child → Electron main.** Two operations only — show a folder dialog, open a folder — as messages over `process.parentPort`, checked on arrival by `electron/host-args.mts`.

## Attackers considered

**A web page in the player's ordinary browser.** The player is browsing while Pack Rat runs. Any page they visit can make requests to `127.0.0.1` on any port, and can put the app's own page in a frame. It cannot read a cross-origin response, cannot read a process environment, and cannot read the token. This is the attacker the server's front door exists for.

**A hostile scan file.** Scans get shared — "here's my suit, run your optimizer on it" in a guild chat, a file attached to a bug report, a folder someone hands over. A scan file is attacker-controlled text that the player themselves invites in, and that then persists in `<data>/scans/` and is re-parsed on every fold and every restart.

**A hostile bridge queue or status file.** `<data>/bridge/<adapter>/queue.jsonl` is an ordinary file that drives the player's character in a live game. Two things can write it: the server's own route, and anything else on the machine that can write a file there. A shard's penalty for behaviour that looks automated is severe — a full account wipe on the shard this app was built for — so making an account *look* botted is a complete payload on its own, with nothing stolen.

**Another local user on a shared machine.** A different account on the same computer, with no special privileges. They cannot read files that are owner-only, but they can reach a loopback port.

**A compromised dependency, action or release.** A package in the development tree, a third-party GitHub Action, or whatever ends up on the Releases page. Builds are unsigned, so there is no downstream signal that an installer is what the source produces.

## Attackers deliberately out of scope

**A process already running as the player.** Malware or any other program running under the player's own account. It can read and write the whole data directory, read the token out of another same-user process's environment, and rewrite the adapter scripts inside the game client's folder directly — all without going anywhere near this app. No check in this app could stop any of it, and building one would only produce something that looks like a defence. The residual is written down rather than argued away: the token is a barrier against a web page and against unprivileged software, not against this attacker.

There is one thing still worth reporting in this class: a way for Pack Rat to *extend* such an attacker's reach — to launch a file for them, or to write outside a folder the player chose. That is a real finding, and the utility-process boundary below exists exactly for it.

**The game client and the shard.** How TazUO runs a Legion script, what the shard's server does with a packet, whether a shard's rules permit automation at all. Not this app's to adjudicate; `docs/adapter-guide.md` covers the rules question for adapter authors.

**Code signing.** Every build is unsigned by design in this release. That is a tracked pre-1.0 item in `RELEASING.md`, not a finding to report, and several defences below say plainly where they would be worth more once signing exists.

## Trust boundaries

### 1. The network → the local HTTP server

**Trusted:** nothing. **Not trusted:** every header, every path, every body.

`startServer` binds `127.0.0.1` explicitly, never `0.0.0.0`, and under the desktop shell the port is OS-assigned rather than well-known. Before any route runs, `app/vault-server.mts`'s request middleware applies, in order:

- **Host.** The `Host` header must be exactly `127.0.0.1:<port>` or `localhost:<port>`, where `<port>` is read from `server.address()` — the port actually bound, not the one requested, so `--port 0` still works. Anything else is a 403.
- **Origin.** When an `Origin` header is present it must name one of those same two forms. A missing `Origin` passes, deliberately: same-origin navigations, `curl` and the adapters never send one.
- **Token.** With a token configured, every `/api/*` route carries `Authorization: Bearer <token>` or gets a 401, compared with `crypto.timingSafeEqual` behind a length check. Static routes (the page, its modules, the stylesheet) never need it. The SSE progress stream is exempt because `EventSource` cannot set a header, and is instead checked against the job's own `randomUUID` id and a matching `?client=`.
- **Content type.** Any request whose body is read must declare `application/json`, or 415.

Every response that goes through the server's one `send` helper carries `x-content-type-options: nosniff`, `cache-control: no-store` and `x-frame-options: DENY`; the HTML response also carries the CSP, which includes `frame-ancestors 'none'`. The two SSE routes write their own headers and send `x-frame-options: DENY` and `content-security-policy: frame-ancestors 'none'` themselves. No CORS header is ever sent, so a cross-origin read is refused by the browser itself.

**Load-bearing:** the **Host allowlist** is what defeats DNS rebinding. An `Origin` check alone would not: a rebound hostname sends its own name in `Host`, and a plain navigation or frame load carries no `Origin` at all. And the **content-type requirement** is what forces a preflight — a cross-origin form post cannot produce `application/json`, and a cross-origin `fetch` that declares it triggers a preflight this server never answers with allow headers. Those two are independently sufficient against a web page; everything else here is depth.

### 2. A request body → a route

**Trusted:** nothing in the body, including its top-level type.

A body that parses to anything but a plain JSON object is a 400 on every route that reads one (`asObject`; `PUT /api/profiles` gets the same answer from its own schema), which removes a whole family of internal errors at once. Most routes also drop from the 50 MB default body cap to 8 KB, or 64 KB for the bridge. Beyond that, each route checks its own fields rather than destructuring and hoping: `POST /api/forget` requires a string `name` and caps it, checks the tombstone it is about to write against the scan schema, and keeps one file per root instead of accumulating one per call (`POST /api/forget-character` follows the same rules, one file per character, and refuses a name starting with `_` or one the inventory has never had); `PUT /api/ui-prefs` writes only a bounded list of column keys; `POST /api/optimize` validates `pools`, `current` and `profile`, accepts only an allowlist of `opts` keys with bounded values, copies only known fields out of the caller's `meta`, and refuses past four concurrent jobs; `POST /api/setup/install` and `PUT /api/settings` both run the destination through `validateScriptsDir` and persist the *resolved* folder rather than the raw string; `PUT /api/profiles` keeps its 1 MB cap and schema check. `POST /api/setup/locate` no longer echoes the path it probed. Requests time out, and a host call that never answers becomes a 504 rather than a socket held open forever.

Failures return `{error: "internal error", ref}` and nothing else — the stack goes to `<data>/logs/server.log` keyed by that ref. A caller's own malformed input never takes that path: a body that is not valid JSON is a 400 carrying only the shape of the parse failure (never the body's bytes), so no local caller can append stacks to the unrotated log by sending garbage. The one place a value out of a pasted document reaches a log line — the adapter id a document declares for itself — is bounded and written through `JSON.stringify`, so it cannot open a second, plausible-looking line in the file the `ref` scheme depends on.

### 3. A scan file → the parser, the fold and the page

**Trusted:** nothing. A scan is a document a stranger may have written.

- **At the door.** `ingestFile` `lstat`s before it reads: anything that is not a regular file (a symlink, a directory, a device) is refused unread, and so is anything over 32 MB. `importScans` applies the same ceiling on the source side, so an oversized file is never copied into the inbox to be rejected on every startup sweep thereafter. A rejection reason — from the inbox or from a paste — no longer quotes the file's own bytes back into a message the page displays.
- **At the schema.** `app/schema/scan.v2.schema.json` now types the arbitrarily-keyed maps instead of accepting any object: `stats`, `maxes`, `resists` and `position` take numbers, a `skills` entry is `{value, cap}` (optional `base`) bounded 0–1000, every serial is a 32-bit integer, `containers` entries require `serial` and `root`, and every string and array has a maximum. `app/schema/validate.mts` enforces `maxLength`, `maxItems` and schema-valued `additionalProperties`, and checks `required`/`properties` by own property rather than by `in`, so an inherited `Object.prototype` member can neither satisfy a requirement nor be validated as one.
- **In the fold.** `foldSnapshots` builds its maps with a null prototype, so a serial or character name that happens to be `__proto__` sets an ordinary key instead of re-pointing an object's prototype, and it indexes each snapshot's containers once instead of scanning them per item. `parseTooltip`'s catch-all numeric-line pattern is anchored to the tail so its parts cannot overlap, and every tooltip line is capped before it is matched — the shapes that previously made parse time grow with the square of a line's length.
- **At the page.** The character sheet and the item tooltip are built from DOM nodes, and `el()` no longer has an `html` path at all, so there is no sink left for scan text to become markup. The one dynamic attribute, a tooltip colour, must match a strict hex pattern. The CSP on every HTML response is `default-src 'none'; script-src 'self'` with no `unsafe-inline` for script, `connect-src 'self'`, and `frame-ancestors 'none'`.

**Load-bearing:** **the CSP plus the absence of any HTML sink** is what keeps a shared scan file inert. Either alone would be uncomfortable — the CSP holding a live injection is defence in depth that happens to work, and text nodes with a loose CSP would still be one refactor from trouble. Together they mean scan text is data on every path it takes.

### 4. The bridge queue → the game client

**Trusted:** nothing in the queue file. This is the only input that crosses into a live game and moves a real character, and the file can be written without going through the server at all — so the adapter re-checks everything rather than assuming the app validated it.

Server side, `POST /api/bridge` validates the line against the bridge schema before appending and copies only the documented fields, never the page's whole body. Client side, each `packrat-bridge.py` refuses:

- a command whose `queuedAt` is missing, unparseable, more than 60 seconds old or more than 5 seconds in the future, and any id it has already accepted (or one longer than 64 characters). A refused line with a usable id is recorded under that id, so the page shows why;
- more than 4 commands per poll or 40 per rolling minute — the excess is deferred, never dropped, and a sustained flood stops the script with a message, because at that rate something other than a person is writing the file;
- opening anything that is not a live container, corpses included, using the same check the scanners use, and any chain longer than 8 (the deepest the app can produce is 4);
- opening a chain that does not lead down from its own root: `chain[0]` must lie on the ground or be the player's own backpack or open bank box, and each later entry must sit directly inside the one before it, checked against the live client before each double-click — so a line cannot name another player's pack and make the character snoop it;
- a walk further than 24 tiles — the client's own view range — or a destination outside the map's bounds;
- a grab whose *source* does not resolve to the player's own backpack, their bank, or the chain that same command just opened. The *destination* has always been hard-coded to the player's own backpack and is deliberately not a protocol field; keep it that way.

Every line is handled in its own `try`, so one junk line no longer takes the rest of its batch with it; reads are capped per poll and per line, and the kept results are trimmed, so neither the client's memory nor `status.json` can be made to grow without bound. The long-standing offset rule still holds: a backlog written before the script started is never replayed.

**Load-bearing:** the **adapter's own re-checks**. The server's validation is real but it is not the boundary, because the boundary is a file on disk that the server does not own.

### 5. The server child → the Electron main process

**Trusted:** only that the message came from this app's own child. **Not trusted:** its contents.

The utility-process split exists so that the code which parses untrusted scan files and runs third-party adapter watchers cannot reach `BrowserWindow`, `shell`, or the OS. Two operations cross back, and `electron/host-args.mts` checks both before either reaches an OS call. `openPath` takes a **discriminator** — `"data"` or `"logs"` — which main maps to the two directories it computed itself; a message can never name a third path for the OS to launch. `pickFolder`'s `title` is coerced to a short, control-character-free string before it can become the caption on an app-modal native dialog.

A native dialog can stay open for minutes, which makes the reply path its own small boundary. A result is posted only to the child that asked for it: if the server child died mid-dialog and was respawned, the answer is dropped rather than delivered to a different process whose own call ids — they restart at 1 each launch — mean something else entirely. The child's side of that register (`electron/pending-calls.mts`) expires every entry after a minute, matching the server's own `withHostTimeout`, so whichever side notices first the caller sees the same 504 and neither a promise nor a socket is left hanging.

**Load-bearing:** **the utility-process split plus the discriminator**, together. The split alone would be undone by a free-form path crossing it — "open this as a double-click would" launches an application on every platform, which turns a write inside the sandboxed child into code execution outside it. The discriminator is what makes the split mean something.

### 6. The page → the shell

**Trusted:** nothing, on the assumption that renderer code could be running that the app did not write.

`app.on("web-contents-created")` attaches the same guards to every `webContents`, so a future window inherits them instead of depending on someone remembering: navigation off the local origin is refused on `will-navigate`, `will-frame-navigate` and `will-redirect`; `<webview>` attachment is refused; `setWindowOpenHandler` never creates a second Electron window and passes only a length-bounded, throttled `https:` URL to the OS browser, with the promise handled. Both decisions live in `electron/navigation.mts`, where they are unit-tested with real URLs. The session denies every permission request, permission check and device request — the page is a Secure Context on loopback, so with no handler Electron would *grant* camera, microphone, geolocation and clipboard. Chromium's spellchecker is off in both the session and `webPreferences`. DevTools are off in a packaged build unless `--devtools` is passed.

The update check no longer forwards GitHub's own `html_url` into the page: `checkForUpdates` accepts it only when it is an `https://github.com/<this repository>/releases…` address and otherwise substitutes that releases page, so an altered API response cannot choose where "View release" sends a player who is about to install something unsigned.

Packaged builds flip the Electron fuses that would otherwise leave the installed binary usable as a general-purpose Node interpreter: `runAsNode`, `enableNodeOptionsEnvironmentVariable`, `enableNodeCliInspectArguments` and `grantFileProtocolExtraPrivileges` off, `onlyLoadAppFromAsar` on, plus `resetAdHocDarwinSignature` so that rewriting the binary to flip them does not leave an Apple Silicon build unable to launch. Application code lives inside the asar — only `adapters/**` (which the installer must copy out as real files) and the HiGHS WebAssembly package are unpacked — so tampering means rebuilding an archive rather than editing a file in place.

### 7. The installer → a folder the player chose

**Trusted:** the player's intent. **Not trusted:** the folder's existing contents. Game clients in this ecosystem ship as all-in-one archives, and an archive may contain symlinks.

Every write the installer and the scan importer make goes through one helper: a random, `O_EXCL` temp name (so a pre-planted path can never be the one opened), an `lstat` refusal of any destination that is not either absent or a plain regular file, a rename into place, and cleanup on failure. That covers the scripts, `packrat-paths.json` — which used to be written in place, following whatever sat at its name — and the import copy loop. `validateScriptsDir` rejects relative paths and Windows UNC forms, and looks each adapter's folder shape up by own property so an id shaped like a prototype member cannot crash the lookup. `installedVersion` (and every other installer read) opens regular files only — an `lstat` refusal before the open, which is the only symlink check on Windows, where there is no `O_NOFOLLOW` and opening a file symlink follows it, then `O_NOFOLLOW` where it exists and a 64 KiB cap — which closes both the read-through-a-symlink oracle and the case where a named pipe at an expected filename would block the single-threaded server forever. The server's own state files in the data directory (settings, profiles, saved runs, accepted scans, tombstones) go through the same helper, so a `settings.json` or `profiles.json` that is a symlink is refused on save rather than written through; a player who wants one of them elsewhere has to link the whole data directory (`--data`/`PACKRAT_DATA`), not the file.

**Load-bearing:** the **`lstat` refusal and the unpredictable `O_EXCL` temp name**, as a pair. The refusal states the rule; the temp name closes the gap between checking and opening.

### 8. The supply chain and the release path

**Trusted:** the lockfile's integrity hashes, and the commit SHAs actions are pinned to. **Not trusted:** a mutable tag, or a build dependency's good behaviour.

There is exactly one runtime dependency (`highs`, MIT, WebAssembly, read from disk and never fetched). The lockfile is fully pinned with an integrity hash on every entry, all from one registry. Every `uses:` in both workflows names a full 40-character commit SHA with the tag in a trailing comment. Both workflows install with `npm ci --ignore-scripts`. `.github/dependabot.yml` keeps npm and the action pins moving with reviewable pull requests.

The release workflow splits publishing from building, which is the point of its structure: the `build` matrix runs roughly three hundred development packages as ordinary code on the runner and holds `contents: read` and **no release token at all**, uploading installers as workflow artifacts; a separate `publish` job with no checkout and no npm install downloads those artifacts, generates `SHA256SUMS` and uploads them. A `workflow_dispatch` run is build-only from any ref. A compromised build dependency can corrupt an installer; it cannot publish one or reach the repository. `RELEASING.md` documents the flow, the verification command, and the repository settings that still have to be switched on by hand.

The honest limit: `publish` uploads bytes built on three other runners without re-verifying them, and `SHA256SUMS` is generated by the same workflow, so it proves nothing against a compromised token. What it proves is that the copy in a player's hands matches what this project uploaded — the question worth asking about a build that arrived from a repost or a mirror.

## Rulings

Findings deliberately left standing, with the reason. Each is a decision, not an oversight; re-litigating one should start here.

**Bare `npm start` runs with no token.** That mode is the development and browser path, and it is the default when running from source. Every route is still closed to a web page by the Host, Origin and content-type checks, so the attacker who gains anything is a local process — out of scope for the same-user case. On a *shared* machine, though, another user's process can reach the loopback port, and that is a real difference. The ruling is to keep the mode and to say so plainly instead: **on a shared machine, use the desktop app**, which mints a per-launch token. `PRIVACY.md` and `CONTRIBUTING.md` both carry that sentence.

**The per-launch token is passed to the server child in an environment variable.** Any process with the same UID can read another same-user process's environment. That is precisely the attacker already out of scope, and a file at `0600` has the same exposure, so the delivery mechanism is not what would fix it. Recorded so nobody later mistakes the token for a defence against local software.

**A newer scan claiming your character replaces that character's data.** The fold orders snapshots by time and lets the newest statement about a root win; that is what makes the app work at all. A scan file carries no signature, and nothing in it could be checked — an "is this really mine" test would be a guess wearing a uniform. So the defence is advice, and it belongs where the file is imported: **only import scan files you made, or that you trust as much as your own.** Someone else's scan of their own character is fine; someone else's scan claiming *your* character can quietly replace what you had recorded for them.

**Embedded asar integrity validation is off.** On an unsigned build the expected hash sits in a file exactly as writable as the asar it describes, so an attacker who can edit one can edit the other. It costs a real failure mode (a fuse rewrite invalidates the ad-hoc signature) and buys nothing until the build is signed. Revisit with code signing. `onlyLoadAppFromAsar` is on regardless, since it is useful on its own. `enableCookieEncryption` is off for a related reason: it takes a key from the OS keychain at startup, an unsigned build's identity changes every release, and it would prompt every player to protect cookies this app does not have.

**The installer's running-script guard only covers the bridge.** It reads `<data>/bridge/<adapter>/status.json`, which only the *bridge* script writes. The scanner and refresh scripts are overwritten by an install too, and publish no liveness, so an install can rewrite a scanner mid-run — the orphaned-thread trap the guard exists to prevent. Fixing it properly means an adapter protocol change (every script publishing a heartbeat), which is a larger piece of work than this pass, and the consequence is a confusing failure rather than a security one. Tracked here rather than closed.

**`packrat-paths.json` and `settings.json` are trusted as local configuration.** Both can redirect where the app and the in-client scripts read and write, and neither is authenticated. `packrat-paths.json` names the data directory the in-client scripts use, and the scripts take it as given (the server also reads it, only to warn when it names a folder other than its own — through the installer's bounded read that refuses a symlink or anything else that isn't a regular file, never touches a UNC or device path it names, strips control characters before printing it, and never acts on it); `settings.json`'s client record is validated on every route that writes it, and at startup a persisted adapter id that is not a shipped adapter is ignored for that run, so a hand-edited id never reaches a path join. Writing either file requires write access to the data directory or to the game client's scripts folder — the same access needed to replace an adapter script outright, which is the out-of-scope attacker. They are configuration, at the same trust level as the launch flags beside them (`--data`, `PACKRAT_ADAPTERS_DIR`), and treated as such. A `settings.json` that is not valid JSON, or not an object, is set aside as `settings.json.corrupt` with a warning in `server.log`, and the app starts on defaults.

**The bridge's new limits are unverified in a live client.** Everything in boundary 4 was written and tested against fakes; neither bridge script has been run against a real game client since. The assumptions that would fail first, if any do: that the client's own container test (`IsContainer`, `IsCorpse`, graphic) identifies every container the app will legitimately ask for, so a real chest is never refused as "not a container"; that a 24-tile cap is comfortably above every walk the app actually queues; that 40 commands a minute is comfortably above the largest "Grab all"; and that the client's clock and the app's agree closely enough for a 60-second freshness window. A false refusal is the expected failure shape, and it reports itself in-game and on the page.

**Log files are not rotated.** `safeAppendLog` appends and never trims, and the shell's own logger does the same; `server.log` and `shell.log` both grow for as long as the app is used. Neither holds a credential — the token is never printed — and deleting either is safe at any moment. The cost of the miss is disk, not disclosure. Both are owner-only: the server writes `server.log` `0600`, and the shell creates `logs/` `0700` and `shell.log` `0600`.

## What a shared scan file discloses

Short version, because it is the disclosure players are most likely to make by accident: a scan file is a complete picture of one character. The character's name; every skill with its value and cap; stats, maximum pools and resistances; every item with its serial and every raw tooltip line, which carries "Crafted by" attributions and anything engraved; and the **world coordinates** of the character and of every ground container that was read — which, since the intended way to scan is to stand among your own chests, is usually the player's house and the tile of each chest inside it.

`PRIVACY.md` says this in the place a player will actually read it, with the advice attached: look at the file before attaching it to a public issue. For fixtures committed to this repository there is a scrubber — `scripts/make-adapter-fixture.mts` — and `docs/adapter-guide.md`'s Fixture rules describe exactly what it removes.

## Reporting

`SECURITY.md` has the channel and the scope. In short: private vulnerability reporting on this repository's Security tab, and never a public issue describing anything exploitable.
