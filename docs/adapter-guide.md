# Writing an adapter

An adapter is a set of scripts that run inside a specific game client and produce scan files (and, optionally, run a bridge) that speak the contracts described in `docs/scan-schema.md` and `docs/bridge-protocol.md`. This document is for anyone adding support for a new client, or checking that an existing one still meets the contract. `adapters/tazuo/` is the reference implementation — read it alongside this document.

## What an adapter must ship

Every adapter lives at `adapters/<id>/` and ships four things:

| File(s) | Purpose |
|---|---|
| One or more scripts | The actual client-side code: at minimum something that produces scan files. `adapters/tazuo/` ships three — a full scanner, a quick refresh (stats/skills/worn/backpack only, for after a gearing session), and a bridge — but a minimal adapter can ship just a scanner. |
| `README.md` | Install steps (where the scripts go), what to press and when, and the adapter's limits (what it can't read, what it needs standing near). Written for a player, not a developer. |
| `capabilities.json` | This adapter's contract, as data: `{adapter, version, transport, platform?, capabilities: {...}}` matching the shape of a scan's own `adapter.capabilities` (see `docs/scan-schema.md`). The scripts' own `CAPABILITIES` dict (whatever they're written in) must match the `capabilities` object exactly — that's what the contract test checks. `platform` is optional — see "Platform restriction," below — and not part of the `capabilities` object itself, so the contract test's `capabilities`-only comparison doesn't touch it. |
| `fixture.scan.json` | One anonymised, real scan — see Fixture rules, below — that exercises this adapter's quirks: nested containers, worn items, whatever's distinctive about what this client can and can't see. |

Ship all four and the contract test (`app/contracts.test.mts`) picks the adapter up automatically — nothing to register anywhere else. An `adapters/<id>/` directory missing either `capabilities.json` or `fixture.scan.json` is simply skipped by that test file (not every subdirectory has to be a finished adapter, but one that claims to be needs both).

### Fixture rules

A fixture is a real scan, scrubbed, not a hand-written one — real data exercises real edge cases a synthetic fixture would miss. Anonymise it before it goes anywhere near the repo:

- Character name → `"Fixture"`.
- Every position (`{x, y, z}`, including containers' `pos`) → `{x: 1, y: 1, z: 0}` (or `{x:1,y:1}` where `z` isn't present).
- Every serial remapped, in order of first appearance, to `0x40000000 + n` — consistently across `roots`, `containers` (both the dict keys and every `serial`/`parent`/`root` field), `items`, and `equipped`, so the remapped document is still internally consistent.
- Tooltip lines matching `^Crafted By .*` → `Crafted By Nobody`; engraving-like lines (`^Engraved: `) → `Engraved: Fixture`.
- `scannedAt` → a fixed, unremarkable timestamp (`"2026-01-01T12:00:00+00:00"`).
- `account` dropped entirely.
- `stats`/`maxes`/`resists`/`skills` kept as-is — they're not personally identifying and the fold needs realistic numbers.

`adapters/tazuo/fixture.scan.json` was generated this way with `scripts/make-adapter-fixture.mts <real-scan.json> <out.json>` from a real scan in `local/scans/` (a developer-only, git-ignored folder — never committed) — pick the source scan with the most nested containers for the best coverage. Before committing a regenerated fixture, sanity-check by eye: `grep -c "<any real character name>" adapters/<id>/fixture.scan.json` must print `0`, and `grep -i "crafted by\|engraved" adapters/<id>/fixture.scan.json` should show only the scrubbed `Nobody`/`Fixture` placeholders.

## How the contract test runs over your fixture

`app/contracts.test.mts` walks every directory under `adapters/` and, for each one that ships both `capabilities.json` and `fixture.scan.json`, runs three checks with no adapter-specific code required:

1. **`capabilities.json` validates against the scan schema's capabilities shape** — the same `adapter.capabilities` subschema a real scan is checked against (`docs/scan-schema.md`).
2. **`fixture.scan.json` validates against `scan.v2.schema.json`** in full — the whole document, not just the capabilities block.
3. **The fixture folds correctly**: at least one character comes out of `foldSnapshots`, that character is the fixture's own `character` field, at least one nested container survives as a `kind: "container"` item with a `parent`, at least one worn item is present and located on the fixture's character, and — critically — `capabilities.json`'s `capabilities` object is deep-equal to the fixture's own `adapter.capabilities`. That last check is what keeps a script's `CAPABILITIES` dict, `capabilities.json`, and the fixture that was generated from a real run of that script from silently drifting apart from each other.

A final test (`"at least one adapter ships a capabilities.json + fixture.scan.json contract"`) fails the whole suite if every adapter directory somehow lost its contract files — a guard against the checks above silently testing nothing.

Run it on its own with `node --test app/contracts.test.mts`, or as part of the full suite (`npm test` — see `TESTING.md`).

## Transports

An adapter declares its transport in `capabilities.json`'s top-level `transport` field. Two are implemented today:

- **`"folder"` (implemented).** The adapter writes scan files to `<data>/inbox/<id>/` (config `paths.inboxFor(id)`; temp-then-rename, per the adapter's own write discipline — see `adapters/tazuo/`'s "Data directory resolution" for the concrete example) rather than straight into `<data>/scans/`, and, for a bridge, appends commands to and reads status from `<data>/bridge/<id>/`. `app/watcher.mts` watches every adapter's inbox (`fs.watch`, 300 ms debounce) and normalises an accepted file into `<data>/scans/` under a schema-valid v2 name within a moment of it landing — a file that keeps failing to parse or validate after a few retries is moved to `<data>/inbox/<id>/rejected/` with a reason file beside it instead. `GET /api/events` (SSE) broadcasts each accept/reject to every open browser tab, so a fresh scan shows up without a manual reload; see `docs/architecture.md`'s "The inbox watcher's lifecycle" for the full mechanics. `adapters/tazuo/` and `adapters/razor-enhanced/` both use this transport; a client that can write files to the local disk (any Legion-Script-like or plugin-style host) is a `"folder"` adapter. The app's setup wizard installs a `"folder"` adapter's scripts into a player-chosen folder and writes `packrat-paths.json` there so the scripts find `<data>/inbox/<id>/` on their own — the installer looks for files matching `packrat-*.py` in the adapter's own directory under `adapters/`, so a new adapter's scripts should follow that naming convention to be picked up the same way (`app/installer.mts`'s `listAdapters`/`installScripts`). `adapters/razor-enhanced/` is the second example: same mechanics, written entirely from Razor Enhanced's own published API reference with no live client available to verify it against — see its README's "Status" section — so it ships without a `fixture.scan.json` until a real Windows run produces one (`app/contracts.test.mts` simply skips an adapter folder missing that file).
- **`"paste"` (implemented).** For a client whose scripting sandbox can only print text, with no filesystem access at all — the ClassicUO web client's script log is exactly this. The script builds one schema-v2 document and prints it wrapped in `-----BEGIN PACK RAT SCAN-----`/`-----END PACK RAT SCAN-----` markers (`app/import.mts`'s `PASTE_BEGIN`/`PASTE_END`); the player copies the console output and pastes it into the app's Import tab, which accepts either the marked block or the bare JSON (and, for any adapter regardless of transport, a dropped file — useful even for a `"folder"` adapter's output when the watcher isn't running). `parsePastedScan` extracts and validates the pasted text with no filesystem access of its own; `writeScanToInbox` then does the one write, into `paths.inboxFor(adapter)` under the watcher's own `acceptedName` — so a pasted scan rejoins the exact same accept/reject/SSE path a `"folder"` adapter's file does the moment it lands (`docs/architecture.md`'s inbox-watcher lifecycle applies here too, just entered by a paste instead of a file drop). `adapters/classicuo-web/` uses this transport; it ships no bridge (`bridge: []` in `capabilities.json` — a paste-transport script has no persistent process in the game client to carry bridge commands back and forth), which is what makes the app hide that character's Highlight/Grab/Go-to buttons.

One more is on the roadmap, for a host that could act on its own but still can't write files where the app expects them:

- **HTTP to localhost (roadmap).** For a client that can make outbound requests — `POST` a scan directly to the running server, long-poll for bridge commands, `POST` results back. Same schemas, different delivery.

Whichever transport an adapter uses, the scan and bridge **schemas themselves don't change** — only how the bytes get from the game client to the app's data directory.

## Platform restriction

An adapter that only runs on one operating system declares that in `capabilities.json`'s optional top-level `platform` field, as the exact `process.platform` value its client needs (`"win32"`, `"darwin"`, or `"linux"`). Omit the field entirely when the client has no platform restriction — every adapter but one does this today. `adapters/razor-enhanced/capabilities.json` sets `"platform": "win32"`, since Razor Enhanced only runs on Windows (its own README's first line). `app/installer.mts`'s `listAdapters` surfaces this as `platform` on each adapter object it returns, and `GET /api/setup` reports the server's own `process.platform` alongside it (always the same machine the player's game client runs on, since this is a desktop app) so the page can compare the two. Nothing in the app hard-codes which adapter id is platform-restricted: `app/ui/adapters.mts`'s `platformCompatible(adapter, platform)` reads `adapter.platform` directly, `app/installer.mts`'s `candidateClientRoots` takes the same value as its `adapterPlatform` parameter (fed from the adapter's own `listAdapters` entry, not looked up by name), and both the setup wizard and the Import tab's adapter picker read it the same way — a future platform-restricted adapter needs only to set this one field, nothing else to teach the page about it. An incompatible adapter is still **shown** in both pickers (so a player who already knows the client's name isn't left wondering why it vanished), but its choice is disabled and carries a plain "`<platform>` only" note; `defaultAdapterId`/`availableAdapters` (also in `app/ui/adapters.mts`) never hand it out as an automatic default, so the app can't silently land a player on a client that cannot run on their machine.

## Shard rules for adapters

Whether an adapter is appropriate to write and ship at all depends on the shard rules of wherever it'll be used, not on this app's own rules (this app has none beyond "attended, inventory-only" — see below). Two examples worth knowing before proposing a new adapter:

- **Outlands: manual only.** UO Outlands' Code of Conduct states that "any method of automation or programmatic data extraction from the game client is not allowed," full stop — even data that's technically accessible through the official client and its sanctioned Razor assistant "must be acted upon manually by the player." No scanner adapter can exist for Outlands without putting every user of it on the wrong side of that shard's rules. The shard picker's entry for Outlands says "manual import only" — there is no `adapters/outlands/`, and there will not be one.
- **Never Stealth.** Stealth is a standalone, closed-source, Windows-only client built to run many characters headlessly — it is banned outright on major shards and is a bot client by design, not a scripting layer inside a normal client. Shipping a Stealth adapter would associate this app with bot-client automation regardless of how narrowly the adapter itself behaved, so one is never written or accepted, even as a community contribution.

More generally: a shard's own rules are what governs whether a player may run any adapter at all, on any client — this app does not adjudicate that per-shard, and an adapter's README should say plainly what it does (read-only inventory scan, or one-item-at-a-time bridge moves) so a player can check it against their own shard's rules themselves.

## The attended-only statement

Every adapter — no exceptions — is attended-only and inventory-only:

- A scanner or refresh script reads what the character can currently see (equipped items, opened containers) and writes one file. It does not wait, loop, or act on anything; it runs once and stops.
- A bridge script executes **one command at a time**, and only a command that a player's click in the app queued after the bridge started (see `docs/bridge-protocol.md`'s offset rule) — it has no loop of its own to leave running unattended, and it does nothing without a human having just clicked a button. It walks, opens a container, and either flashes a name or moves one item; it never fights, farms, loots a corpse, or gathers a resource.
- Every adapter script's messages to the player are local-only (see `docs/bridge-protocol.md`'s "adapters never speak publicly" rule) — nothing an adapter does should be visible to, or affect, anyone else in the game world.

An adapter proposal that can't honestly make all three of these claims does not belong in `adapters/`, regardless of which client it targets.
