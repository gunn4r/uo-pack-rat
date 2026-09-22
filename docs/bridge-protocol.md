# Bridge protocol

The bridge is how the app reaches back into the game client: the Suit Builder and Containers tabs' Highlight, Grab, and Go-to buttons don't move anything themselves — they queue a command, and an adapter script running inside the game client (attended, one command at a time) carries it out. This document describes protocol v1: the file layout, the three message shapes, the actions, and the rules that keep it safe to leave running.

Ground truth: `app/schema/bridge.v1.schema.json` (validated by `app/contracts.test.mts`), `app/vault-server.mts` (`POST /api/bridge`, `GET /api/bridge/status`), `adapters/tazuo/packrat-bridge.py` (the reference adapter implementation), and `app/ui/bridge.mts` (the page's side).

## Files

Everything lives under `<data>/bridge/<adapter-id>/` — genuinely per adapter now (Phase 6 final review follow-up; it used to be hard-coded to `<data>/bridge/tazuo/` regardless of which client was actually configured, which meant a Razor Enhanced player's Highlight/Grab/Go-to buttons queued commands nothing would ever read). `app/config.mts`'s `paths.bridgeFor(adapter)`/`bridgeQueueFor(adapter)`/`bridgeStatusFor(adapter)` resolve the directory and its two files for whichever adapter is named; `paths.bridge`/`bridgeQueue`/`bridgeStatus` still exist as their own keys, unchanged in value — they are exactly `bridgeFor("tazuo")`'s own paths, kept for anything that still reads them directly. `POST /api/bridge` and `GET /api/bridge/status` (`app/vault-server.mts`) resolve the adapter live off `settings.client.adapter` on every call (falling back to `"tazuo"` only when no client is configured at all, matching this route's own pre-existing behavior for that case) — never a value captured once at server startup, so switching clients takes effect on the very next request.

That fallback used to be a server-only fact the page couldn't see: a player with no `settings.client` (pressed Skip in the wizard, or installed an adapter's scripts by hand — both leave it unset on purpose) had a real bridge running and reachable at this same fallback path, but the page's `currentAdapter()` had no way to know which adapter's `capabilities.bridge` to render buttons from, so every Highlight/Grab/Go-to button vanished. `GET /api/setup` (docs/architecture.md's "Capability-driven bridge controls") now also reports this exact routing id as `bridgeAdapter` — the same function's result, guarded to `null` when that id isn't among the discovered adapters — so `app/ui/bridge.mts`'s `currentAdapter()` can fall back to it too, keeping the button-visibility decision and the actual command-routing decision from ever disagreeing.

| File | Written by | Read by | Contents |
|---|---|---|---|
| `queue.jsonl` | `POST /api/bridge` (append-only) | the bridge script | One JSON **command** object per line. |
| `status.json` | the bridge script (whole-file, atomic replace) | `GET /api/bridge/status` | One JSON **status** object: is the bridge alive, what is it doing, and the last ~30 **results**. |

`queue.jsonl` is append-only from the server's side — every `POST /api/bridge` call appends one line and never rewrites the file. The bridge script tracks its own read offset into the file (see The offset rule, below); nothing ever truncates or rewrites lines that were already written.

## Command

One line of `queue.jsonl`, one JSON object per line:

```json
{"id": "1757800000000-4213", "action": "grab", "serial": 1234567890, "name": "Leather Gorget", "chain": [1073741825, 1073741826], "pos": {"x": 1520, "y": 1631, "z": 0}, "queuedAt": "2026-09-13T14:20:44.123Z"}
```

| Field | Type | Meaning |
|---|---|---|
| `id` | string, non-empty | Identifies this command — the page uses it to match a later result back to the button that queued it. |
| `action` | string, one of `"highlight"`, `"grab"`, `"goto"` | What to do — see Actions below. |
| `serial` | integer ≥ 1 | The target item's serial. |
| `name` | string, ≤ 120 characters | The item's display name (so the bridge script's on-screen messages don't have to look it up itself). It is only ever printed on screen. Each bridge truncates to the same 120. |
| `chain` | array of integers ≥ 1, at most 8 | The container chain from the root down to the item's immediate parent, outermost first (`[root, …, parent]`) — what the bridge needs to open, in order, to reach the item. Empty for an item sitting directly in a root already open (rare in practice). The cap is 8 because the page walks at most 8 parents and the scanner's own nesting limit is 4, so nothing legitimate is longer. |
| `pos` | object or `null` | The root container's last known world tile, when the app has one on file (from the scan that found it) — lets the bridge walk there even if the container isn't currently in view. A typed, closed shape: required integer `x` (0–7168), `y` (0–4096) and `z` (−128–127), plus an optional `facet` (0–5, Felucca through Ter Mur) that nothing writes today. The x/y bounds are the widest UO facet, so they are a sanity check rather than a per-facet one. `null` when no position is on file. |
| `queuedAt` | string, RFC 3339 | When the server appended this command. Not decoration — see Freshness below. |

`POST /api/bridge` builds this line itself from the request body (`{action, serial, name, chain, pos}` — `location` and any other extra field the page might send along is dropped, never carried into the queue), assigns the `id` and `queuedAt`, validates the assembled line against the `command` schema, and only then appends it. It requires `action` and `serial`; everything else defaults (`chain: []`, `pos: null`). The body is capped at 64 KB.

## Result

Not a separate file — one entry of `status.json`'s `results` object, keyed by the command's own `id`:

```json
{"ok": true, "msg": "grabbed Leather Gorget — it is in your backpack", "t": "2026-09-13T14:20:46+00:00"}
```

| Field | Type | Meaning |
|---|---|---|
| `ok` | boolean | Whether the command succeeded. |
| `msg` | string | A human-readable outcome — shown to the player in-game (`API.SysMsg`) and toasted on the page once the status poll picks it up. |
| `t` | string, RFC 3339 | When this result was recorded. |

## Status

The whole of `status.json`, replaced atomically (temp file + rename) roughly every couple of seconds and after every command:

```json
{
  "alive": "2026-09-13T14:22:10+00:00",
  "character": "Dorran",
  "current": null,
  "results": {
    "1757800000000-4213": {"ok": true, "msg": "grabbed Leather Gorget — it is in your backpack", "t": "2026-09-13T14:20:46+00:00"}
  },
  "counts": {"done": 4, "failed": 1}
}
```

| Field | Type | Meaning |
|---|---|---|
| `alive` | string, RFC 3339 | A heartbeat timestamp, rewritten on every status write. `GET /api/bridge/status` calls the bridge online when this is under 8 seconds old (`age < 8`, computed server-side); it also accepts a legacy numeric epoch-seconds `alive` from an older bridge build, for one release's worth of backward compatibility. |
| `character` | string | Whose game client the bridge is running in. |
| `current` | object or `null` | The command being worked on right now (`{id, action, name}`), or `null` between commands. |
| `results` | object | The last ~30 results, keyed by command id (older ones age out — the bridge only keeps a rolling window, not a full history). |
| `counts` | object, `{done, failed}` | Running totals for this bridge session (reset when the script restarts). |
| `stopped` | boolean, optional | Present and `true` only in the final status write after a clean Stop — never `false`; its absence means the bridge is still running or was killed some other way (crash, client exit) rather than stopped cleanly. |

`GET /api/bridge/status` on a fresh data directory (no `status.json` yet) returns `{ok: true, online: false}` rather than erroring.

## Actions

| Action | What the bridge script does |
|---|---|
| `highlight` | Walk within reach of the item's container if not already there, open the container chain, then for a few seconds flash the item's name above it and mark the containing chest's tile — both local-only overhead text (see "adapters never speak publicly," below), so nothing is visible to other players. Nothing is moved. |
| `grab` | Same reach/open steps, then move the item into the character's own backpack and verify it landed there (`API.MoveItem` followed by a re-read of the item's container) before reporting success. |
| `goto` | Walk within reach of the root container (from `chain[0]`, or straight to `pos` when there's no chain) and stop — no opening, no moving. Requires either a `chain` or a `pos`; an item with neither reports failure ("no container position known for this item"). |

An `action` the adapter's own `capabilities.bridge` list doesn't include (see `docs/scan-schema.md`'s `adapter.capabilities.bridge`) is refused with `"unknown action"` rather than attempted — the reference TazUO adapter supports all three (`CAPABILITIES["bridge"] = ["highlight", "grab", "goto"]`).

## The offset rule

The bridge script only ever acts on commands queued **after it started**. On launch it reads the queue file's current size and remembers that byte offset (`offset = os.path.getsize(QUEUE)`); every poll after that only reads bytes past the last offset it has already consumed. Anything already sitting in `queue.jsonl` from before this run — a stale command from a session that ended without the bridge running, or one queued while the bridge was closed — is never executed. This is a deliberate safety property, not an oversight: a player who starts the bridge should only ever see it act on things they click after that point, never replay a backlog blindly.

(If the queue file is ever truncated to something shorter than the remembered offset — the server rotating or clearing it — the bridge resets its offset to 0 and starts reading from the top again, since the file it knew about no longer exists in the form it expected.)

## What the bridge refuses

`queue.jsonl` is an ordinary file in the data directory. The app writes it, but so can anything else on the machine, and a line in it moves a real character in a live game. So a bridge script trusts nothing in that file and re-checks every line itself rather than assuming the server validated it — the server's check is real, but the file is not the server's to guard. The block of checks below is byte-identical in both bridge scripts, and a test asserts it stays that way. An adapter that ships a bridge is expected to implement all of it.

- **Freshness.** `queuedAt` is parsed, not ignored. A command older than **60 seconds**, more than **5 seconds** in the future, or carrying a missing or unparseable stamp is recorded as expired and never executed. This is what makes a replayed backlog inert, and the offset rule above is still the first line of that.
- **Duplicates.** An id the bridge has already accepted in this session is skipped — checked when the line is read, so two copies in one read, or a copy arriving while the first is still waiting its turn, run once. The last 500 are remembered. An id longer than 64 characters is refused (the app's own are about 18).
- **Rate.** At most **4 commands per poll** and **40 per rolling minute**. The excess is *deferred*, never dropped, and reading pauses while 64 are already pending, so nothing is lost to backpressure. Exceeding the minute budget is treated as a signal rather than a nuisance: the bridge records the refusal, says plainly in-game that the queue is being written faster than a person clicks, and **stops**. Forty a minute is comfortably above the largest burst the app itself produces (a twenty-piece "Grab all", sent a few hundred milliseconds apart).
- **Container-ness.** Every entry of `chain` must pass the same container test the scanner uses — corpses refused by both flag and graphic, and nothing named a deed — before it is opened. Double-click is UO's universal "use" verb: a potion drinks, a rune opens its gump, a deed places. A chain longer than 8 is refused outright.
- **Chain ownership.** Each entry is checked against the live client just before it is opened. `chain[0]` must lie on the ground or be the player's own backpack or open bank box — never a container another mobile carries — and every later entry must sit directly inside the entry opened before it. So a chain can only lead down into its own root: naming a stranger's pack, whether as the root or tucked in after a chest in reach, is refused without a double-click (a snoop attempt). A root the client knows to be someone else's is refused before any walk. A chain whose bags no longer nest the way the scan said (something was moved) is refused with "rescan and try again".
- **Distance.** A destination further than **24 tiles** (the client's own view range) from where the character is standing, or outside the map's bounds, is refused with "walk closer and retry" rather than pathfound. Still one pathfind attempt per command, bounded by the existing 20-second timeout. A chain rooted in the player's own backpack or bank needs no walk at all: a worn container's position says nothing about where the player stands.
- **Grab source.** The *destination* has always been hard-coded to the player's own backpack and is deliberately **not** a protocol field — keep it that way. The *source* is now checked too: the item's root must resolve to the player's backpack, their bank, or a container in the chain that same command just opened. A guild chest someone left open nearby, a stranger's pack, or something lying on the ground is refused.
- **Per-line containment.** Every line is handled in its own `try`, and a payload that is not a JSON object is rejected by type rather than reaching a field access. A junk line no longer takes the rest of its read with it. A refused line that still carries a usable `id` (an expired command, say) is recorded under that id with its reason, and counts against the rate budget like any other line; only lines with no usable id — unreadable, not an object, no id — are reported together as one aggregated `rejected-…` result, so a flood of garbage cannot itself flood the status file.
- **Bounded reads.** At most 256 KB per poll and 16 KB per line; a longer line is a counted refusal, never a silent drop. A partial trailing line waits for the next poll. `results` is trimmed to the last 30 in memory as well as at write time, so `status.json` cannot be made to grow without bound.

A refusal is always *recorded*, never silent: it becomes a `result` with `ok: false` and a readable message under the command's own id, which the page toasts (named after the piece, `app/ui/bridge.mts`'s `pollBridge`) and the player sees in game. Commands still waiting when the bridge stops — Stop, the time limit, or the rate stop — are recorded as "not run" the same way.

## The heartbeat

The page calls the bridge offline once `alive` is 8 seconds old and then refuses to queue anything. A highlight alone lasts 8 seconds and a walk up to 20, so both bridges rewrite `status.json` (with `current` still set) at least every 2 seconds *during* a command too: inside the highlight loop, after each container in the chain opens, and between polls of a walk. On TazUO the walk is a non-blocking `Pathfind`/`PathfindEntity`, polled until it arrives, `API.Pathfinding()` says it gave up, or the timeout passes (then `CancelPathfinding`).

## The wrong-character confirm

Every grab lands the item in **whichever character's client the bridge is currently running on** — not necessarily the character the Suit Builder tab is showing. Grab All (`app/ui/bridge.mts`) checks this before queuing anything: if the bridge's reported `character` doesn't match the builder's currently selected character, it asks first —

> "The bridge is running on `<bridge character>`, not `<builder character>`: the pieces would land in `<bridge character>`'s backpack. Grab them anyway?"

— and only proceeds on confirmation. A single per-item Grab button carries the same risk (the piece always lands wherever the bridge is running) but is not gated behind a confirm, since one item is a much smaller mistake to walk back than a whole suit's worth of Grab-alls landing on the wrong character.

## "Adapters never speak publicly"

Every message the bridge (or the scanner/refresh scripts) prints in-game must be **local-only** — visible to the player running the script and nobody else. On TazUO this means `API.SysMsg` (always local) and `API.HeadMsg` (local-only on TazUO specifically, unlike the overhead-speech API on some other clients, which is public and would show up as the character "saying" something other players can see). `packrat-bridge.py` uses only these two calls, for status lines, per-command outcomes, and the Highlight action's on-screen text. No adapter should ever use a public-speech call (a client's `Say`/chat-line API) for anything the app needs it to print — doing so would broadcast the player's inventory activity to everyone nearby.
