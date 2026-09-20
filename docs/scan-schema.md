# Scan file schema

A scan file is a snapshot written by an adapter script running inside a game client — one file per scan, never edited afterward. The server reads every file under `<data>/scans/`, upgrades each to the current shape, validates it, and folds the whole set into one inventory. This document describes schema v2, the v1→v2 upgrade, and the fold rules that turn a pile of snapshots into "what does everyone own right now."

Ground truth: `app/schema/scan.v2.schema.json` (the portable JSON Schema, restricted to the keyword subset `app/schema/validate.mts` supports) and `app/scan-schema.mts` (`SCAN_V2_SCHEMA`, a byte-identical inline copy — `app/scan-schema.test.mts` asserts the two files never drift apart, because `scan-schema.mts` is served straight to the browser and cannot `fs.readFileSync` the JSON file). Fold rules live in `app/vault-lib.mjs`'s `foldSnapshots`.

## Top-level fields

| Field | Type | Meaning |
|---|---|---|
| `schemaVersion` | integer, must be `2` | The scan format version. A v1 file (no `schemaVersion`, instead `version: 1`) is upgraded to this shape on read — see below. |
| `character` | string, non-empty | Whose scan this is. `_vault` is reserved for a Forget tombstone (see Fold rules) — never a real character name. |
| `scannedAt` | string, RFC 3339 date-time | When the scan was taken. Used to order every snapshot in the fold (`parseStamp`, `Date.parse` — an offset-less string is read as this machine's local time per ECMA-262, matching the v1→v2 upgrade's own rule). |
| `shard` | string or `null`, optional | Which shard's rules apply to this scan (`app/rules/<id>.json`). The server stamps the currently-configured shard onto a scan that doesn't already carry one; an already-stamped scan keeps its own. |
| `account` | string, optional | An **opaque, hashed** identifier for the game account — e.g. lowercase hex SHA-256 of the account name — never the plaintext account name. Never required; an adapter that cannot hash the name should omit the field entirely rather than send it in the clear. This is what keeps a scan file safe to attach to a bug report. |
| `adapter` | object, required | Describes the adapter that produced this scan — see below. |
| `stats` | object, required (can be empty) | Raw stat block, e.g. `{str, dex, int}`. Shape is adapter-defined; the app reads named fields it recognizes and ignores the rest. |
| `position` | object or `null`, optional | Where the character was standing, e.g. `{x, y, z}`. |
| `maxes` | object or `null`, optional | Max pools, e.g. `{hits, stam, mana}`. |
| `resists` | object or `null`, optional | Paperdoll resist totals as the client reports them (post-cap; see `CONTRIBUTING.md`'s resist notes). |
| `skills` | object, required (can be empty) | Skill name → `{value, cap}` (or whatever shape the adapter reads off the skill gump). Keys are skill names as the client shows them, e.g. `"Resisting Spells"`. |
| `roots` | array, required | The top-level containers this scan opened — see below. |
| `containers` | object, required (can be empty) | Every container this scan saw, keyed by serial (as a string) — see below. Not walked field-by-field by the schema (same tradeoff as `profiles.json`'s `characters`/`templates`): the validator only checks it is an object. |
| `items` | array, required | Every non-equipped item this scan saw, in any opened container — see below. |
| `equipped` | array, required | Every item on the character's paperdoll — see below. |

A scan file may carry additional top-level fields beyond these (`additionalProperties: true` at the top level) — the quick-refresh adapter script adds a `meta: {mode, name, roots}` key, which the fold simply ignores. `adapter` and `adapter.capabilities`, though, are a **closed contract**: `additionalProperties: false` there, so an adapter must match the shape below exactly, no extra fields.

## `adapter`

| Field | Type | Meaning |
|---|---|---|
| `id` | string, non-empty | Which adapter wrote this file, e.g. `"tazuo"`. The app's own Forget tombstone writer uses `"app"`. |
| `version` | string | The adapter's own version string (not the schema version). |
| `client` | string | The game client the adapter runs inside, e.g. `"TazUO"`. |
| `clientVersion` | string or `null` | The client's own version, when the adapter can read it. |
| `capabilities` | object, required | What this adapter can see and do — see below. |

### `adapter.capabilities`

| Field | Type | Meaning |
|---|---|---|
| `layers` | array of strings | Equip-layer names this adapter walks (e.g. `"OneHanded"`, `"Helmet"`, `"Arms"` — see `docs/adapter-guide.md` for the full list any adapter claiming full coverage should match). |
| `arms` | boolean | Can this adapter read the equipped arms layer? (Some clients hide it from scripts.) |
| `bank` | boolean | Can this adapter read the bank box (when open)? |
| `ground` | boolean | Can this adapter read containers sitting on the ground? |
| `nested` | boolean | Can this adapter recurse into bags inside bags? |
| `tooltips` | string, `"opl"` or `"label"` | Whether item text comes from the client's full on-paperdoll-line tooltip (`"opl"`, every property line readable) or just the bare name label (`"label"`, no properties). |
| `bridge` | array of strings | Which bridge actions (`"highlight"`, `"grab"`, `"goto"`) this adapter's bridge script can execute — see `docs/bridge-protocol.md`. Empty for an adapter that ships no bridge. |

The page uses a character's latest scan's `adapter.capabilities.bridge` list to decide which Highlight/Grab/Go-to buttons to offer for that character (`app/ui/bridge.mjs`'s `actButtons`); the bridge script itself is still the final word on what it will actually do.

## `roots`

One entry per top-level container the scan attempted to open: the backpack, the bank box, or a container sitting on the ground.

| Field | Type | Meaning |
|---|---|---|
| `serial` | integer | The container's serial. |
| `kind` | string, one of `"backpack"`, `"bank"`, `"ground"` | What kind of root this is. |
| `name` | string | Display name. |
| `opened` | boolean | Whether the scan actually opened it. `false` means the adapter saw the root (knows it exists) but couldn't get its contents — too far away, locked. See Fold rules for what this means for the inventory. |

## `containers`

Keyed by serial (as a string). Every container the scan saw, root or nested. A container entry generally carries `serial`, `kind`, `name`, `parent` (the containing serial, or `null` for a root), and `root` (which root this container ultimately sits under); an adapter may include more (e.g. `tooltip`, `pos` for a ground container's coordinates, used by the bridge's Go-to action).

## `items`

Every item in an opened container, not equipped.

| Field | Type | Meaning |
|---|---|---|
| `serial` | integer | The item's serial — stable across scans, so the fold can tell "the same physical item" apart from "a different item that happens to be in the same slot." |
| `container` | integer | The immediate container's serial (may be a root, or a nested bag). |
| `graphic` | number or `null` | The item's graphic id. |
| `hue` | number or `null` | The item's hue. |
| `amount` | number | Stack size (1 for a non-stackable item). |
| `name` | string | Display name. |
| `nameSource` | string, `"opl"` or `"label"` | Whether `name`/`tooltip` came from the full on-paperdoll-line tooltip or just the label — mirrors the adapter's own `capabilities.tooltips`, but per-item, since a specific read can fall back even when the adapter usually gets the full tooltip. |
| `tooltip` | array of strings | Every tooltip line, raw — `app/vault-lib.mjs`'s `parseTooltip` turns this into properties, tags, and flags. |

## `equipped`

Every item on the character's paperdoll. Same fields as `items`, plus `layer` (string or `null`) — the equip-layer name (`"OneHanded"`, `"Helmet"`, …), used to classify which optimizer slot the item occupies (`LAYER_TO_SLOT` in `app/vault-lib.mjs`) even when the name alone wouldn't say. `equipped` entries have no `container` field — they aren't in any container.

## v1 → v2 upgrade

Every scan file on disk is v1 or v2 shaped; the server upgrades v1 files to v2 on every read (`upgradeScan` in `app/scan-schema.mts`), so the fold and every schema check downstream only ever sees v2. Nothing is rewritten on disk — the upgrade happens in memory, every time the file is read, and the original v1 file is left alone.

A v1 file is recognized by `version: 1` (instead of `schemaVersion`). The upgrade:

- Sets `schemaVersion: 2` and drops `version`.
- Converts `scannedAt` from v1's naive local wall-clock string (`"2026-09-13T14:20:44"`, no offset — what `packrat-scanner.py`/`packrat-refresh.py` and the pre-v2 server both wrote) to RFC 3339, using **this machine's** UTC offset for that specific date and time (DST-correct — the offset is computed from a `Date` built out of the same year/month/day/hour/minute/second, not from "now").
- Stamps `adapter`: `{id: "tazuo", version: "1", client: "TazUO", clientVersion: null, capabilities: TAZUO_V1_CAPS}` — except a tombstone (`character` starting with `_`), which gets `id: "app"` instead, since a v1-shaped tombstone was never written by a game-client adapter. `TAZUO_V1_CAPS` (in `app/scan-schema.mts`) is the capability set the original scanner script actually had: all 20 equip layers, arms/bank/ground/nested all `true`, `tooltips: "opl"`, `bridge: ["highlight", "grab", "goto"]`.
- Marks every `roots[]` entry `opened: true` — v1 had no concept of a root the scan couldn't open, so every listed root is treated as successfully opened.
- Coerces every serial-shaped field to a number: `roots[].serial`, `containers` keys and each entry's `.serial`/`.parent`/`.root`, `items[].serial`/`.container`, `equipped[].serial`. (v1 data was occasionally serialized with string serials; the fold assumes numbers throughout.)
- Gives every `items[]`/`equipped[]` entry `nameSource: "opl"` (v1 tooltips were always the full on-paperdoll-line read; there was no `"label"`-only mode yet).

A v2 document passed through `upgradeScan` is returned as-is, except a scan with no `shard` field gets the shard passed in (`upgradeScan(raw, {shard})`) — it never overwrites a `shard` the scan already carries.

Passing something that is neither v1- nor v2-shaped throws `TypeError`. On the server, a scan file that fails to parse, fails to upgrade, or fails `validateScan` afterward is logged (`console.warn`) and skipped — never allowed to take down the whole fold (`readScans` in `app/vault-server.mjs`).

## Fold rules

`foldSnapshots(snapshots)` (`app/vault-lib.mjs`) takes every v2-upgraded, schema-valid scan and produces one inventory. It requires v2 input — call `upgradeScan` first, or it throws.

- **Order.** Every snapshot is a fact about the world at the moment it was taken. Snapshots are sorted by `scannedAt`, parsed to an epoch with `parseStamp` (not a plain string comparison — a v1 scan's original naive-local string and a v2 scan's RFC 3339 string don't necessarily sort correctly against each other as plain strings once time zones are involved, so the fold always compares real instants).
- **Replace-per-root.** A scan's `roots[]` (excluding any with `opened: false` — see below) names the set of containers this snapshot has fresh information about. Before folding a scan in, the fold deletes every previously-known item and container under any of those roots, then adds back exactly what this scan says is there now. A root not mentioned in a scan at all is left completely alone — the fold only ever touches what a scan actually claims to know about.
- **`opened: false` is invisible to the fold.** A root the adapter saw but could not open (too far, locked) is listed in `roots[]` with `opened: false` and no items for it. The fold treats this exactly like the scan hadn't mentioned that root at all — it does **not** clear the root's previously-known contents. (Every root a v1 scan lists is upgraded to `opened: true`, so this only matters for scans written by the v2-aware scanner.)
- **The worn set is replaced whole, per character.** `equipped[]` in a scan is a complete statement of "this is everything on this character's paperdoll right now" — every item this character had equipped before this scan is dropped, and the new `equipped[]` list replaces it entirely. A quick-refresh scan (which only opens the backpack, no bank or ground roots) still fully replaces the worn set — the backpack root is what catches a just-unequipped piece, since it lands there.
- **Nested containers become items.** A container whose `parent` is non-null (i.e., not a root itself) is folded into the inventory as a synthetic item — `kind: "container"`, named from its engraving when it has one (`bagLabel`) — so bags show up in the inventory and containers tabs like anything else. Root containers (the backpack, the bank box, a ground chest) are never items themselves — they're places, not things.
- **Tombstones.** `POST /api/forget` (see `CONTRIBUTING.md`'s route table) writes a v2 scan directly: `character: "_vault"`, one `roots[]` entry (`opened: true`, no items ever supplied for it) naming the forgotten container. Folded in at its `scannedAt` like any other scan, this clears everything the fold previously knew under that root — the standard replace-per-root rule, just with an empty replacement. A character name starting with `_` is never added to `inv.characters` (it isn't a real character).

## Minimal valid example

A one-root, one-nested-container, two-item scan for a `Fixture` character — passes `validateScan` as-is (checked with a throwaway `node -e` against this exact document: `validateScan(doc)` → `{ ok: true, errors: [] }`):

```json
{
  "schemaVersion": 2,
  "character": "Fixture",
  "scannedAt": "2026-01-01T12:00:00+00:00",
  "shard": "uoalive",
  "adapter": {
    "id": "tazuo",
    "version": "2.0.0",
    "client": "TazUO",
    "clientVersion": null,
    "capabilities": {
      "layers": ["OneHanded", "TwoHanded", "Shoes", "Pants", "Shirt", "Helmet", "Gloves",
        "Ring", "Talisman", "Necklace", "Waist", "Torso", "Bracelet", "Tunic",
        "Earrings", "Arms", "Cloak", "Robe", "Skirt", "Legs"],
      "arms": true, "bank": true, "ground": true, "nested": true, "tooltips": "opl",
      "bridge": ["highlight", "grab", "goto"]
    }
  },
  "stats": { "str": 60, "dex": 20, "int": 10 },
  "position": { "x": 1, "y": 1, "z": 0 },
  "maxes": { "hits": 70, "stam": 60, "mana": 30 },
  "resists": { "phys": 20, "fire": 10, "cold": 10, "poison": 10, "energy": 10 },
  "skills": { "Swordsmanship": { "value": 50.0, "cap": 100.0 } },
  "roots": [
    { "serial": 1073741825, "kind": "backpack", "name": "Backpack", "opened": true }
  ],
  "containers": {
    "1073741825": { "serial": 1073741825, "kind": "backpack", "name": "Backpack", "parent": null, "root": 1073741825 },
    "1073741826": { "serial": 1073741826, "kind": "container", "name": "A Pouch", "parent": 1073741825, "root": 1073741825, "tooltip": ["A Pouch"] }
  },
  "items": [
    { "serial": 1073741827, "container": 1073741825, "graphic": 3702, "hue": 0, "amount": 1, "name": "A Dagger", "nameSource": "opl", "tooltip": ["A Dagger"] },
    { "serial": 1073741828, "container": 1073741826, "graphic": 3821, "hue": 0, "amount": 5, "name": "Bandage", "nameSource": "opl", "tooltip": ["Bandage"] }
  ],
  "equipped": []
}
```

Folded on its own, this produces three inventory items: the pouch itself (a synthetic container item, `container: 1073741825`), the dagger (`container: 1073741825`, classified as gear), and the bandage inside the pouch (`container: 1073741826`) — and one character, `Fixture`.
