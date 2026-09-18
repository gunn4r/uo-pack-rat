# Razor Enhanced adapter

Two IronPython 3.4 scripts that run inside [Razor Enhanced](https://razorenhanced.readthedocs.io/)
(Windows-only) and feed the Pack Rat app. Razor Enhanced is what the shard officially distributes,
so this adapter reaches the largest group of players Pack Rat couldn't previously serve at all.

**Status: unverified against a live client.** This adapter was written entirely from Razor
Enhanced's official API reference (https://razorenhanced.readthedocs.io/api/, fetched
2026-09-17) plus one community wiki page for the two conventions the official reference doesn't
cover (see Sources, below). No Windows machine or running Razor Enhanced client was available
while writing it — Pack Rat's own development happens on macOS. Everything below is either sourced
from that documentation, called out as a documented-but-unconfirmed assumption, or marked as a
genuine unknown. It ships without `fixture.scan.json` for exactly this reason: the fixture has to
come from a real scan (see `docs/adapter-guide.md`'s Fixture rules), and a live Windows run is
tracked as a later task. `app/contracts.test.mjs` skips any adapter folder missing a fixture, so
this one is simply not exercised by that test yet.

## Install

1. Copy both `.py` files into Razor Enhanced's Scripts folder (the folder its in-client Scripts
   tab reads from — typically wherever Razor Enhanced itself was installed, under a `Scripts`
   subfolder; RE has no fixed install location the way TazUO does, so there is no auto-detected
   candidate path for this adapter yet — point the setup wizard at it by hand, or copy the files
   in yourself).
2. If the app's data directory is not the default (`~/.pack-rat` — on the Windows machine running
   Razor Enhanced this is your Windows user profile, not the machine running Pack Rat itself,
   unless they're the same computer), copy `packrat-paths.example.json` to `packrat-paths.json` in
   that same folder, next to the two scripts, and set `dataDir` to wherever Pack Rat's data
   directory actually is reachable from this machine.
3. In Razor Enhanced's Scripts tab, add both files so they show up in the script list; each can be
   started with a click or bound to a hotkey the same way any other Razor Enhanced script is.

## What each script does

- **`packrat-scanner.py`** — full inventory scan. Reads every equipped layer, the backpack
  (nested bags included), the bank box if it's already open this session, and every openable
  container on the ground within reach (recursively — bags in chests in chests). Dumps raw
  tooltip lines; the app does all the parsing. Run it standing next to a chest cluster, once per
  cluster, once per character.
- **`packrat-bridge.py`** — the bridge. Leave it running while you use the app's Highlight, Grab,
  and Go to buttons on the Suit Builder or Containers tab. Highlight recolors the item (and its
  containing chest) for a few seconds and prints a local message; grab does the same walk/open
  steps then moves the item into your backpack; go to just walks there. Bounded to 8 hours.

There is no quick-refresh script in this adapter (`adapters/tazuo/packrat-refresh.py`'s
equivalent) — only the two files listed in this task. A full `packrat-scanner.py` run covers the
same ground; add a refresh script later if the extra speed turns out to matter.

## What this adapter reads, and the evidence for each capability

`capabilities.json` claims:

| Capability | Value | Why |
|---|---|---|
| `layers` | 20 equip layers (Razor Enhanced's own names — see below) | `Player.GetItemOnLayer(layer)` documents exactly these as readable layers, and `Items.Filter.Layers` — RE's own "wearable Items" enumeration — lists the same 20 (minus `Hair`/`FacialHair`, which aren't gear). |
| `arms` | `true` | `Arms` is explicitly one of the documented `GetItemOnLayer` layer names — unlike TazUO's web-client sibling, nothing in Razor Enhanced's docs suggests this layer is blind to scripts. |
| `bank` | `true` | `Player.Bank` returns the bank chest as an `Item`, and `Item.Contains` lists what's in it. Same discipline as `adapters/tazuo/`: the scanner only records the bank as a root when `Player.Bank.Contains` already has something in it this session — it never tries to force the bank open, since Razor Enhanced's docs don't say `Items.WaitForContents` can open a bank chest without a banker NPC. |
| `ground` | `true` | `Items.Filter` has documented `OnGround`, `RangeMax`, and `IsContainer` fields, built exactly for "containers on the ground within N tiles" — `Items.ApplyFilter(filter)` returns the matching list directly, no per-graphic guessing needed. |
| `nested` | `true` | `Item.Contains` on any container `Item`, walked breadth-first up to a depth bound (`MAX_NEST`), the same shape as `adapters/tazuo/`'s own recursion — each discovered sub-container is opened with `Items.WaitForContents` before its own `Contains` is trusted. |
| `tooltips` | `"opl"` | `Item.Properties` returns `List[Property]`, and `Property.ToString()` renders one tooltip line — the same full multi-line read as TazUO's `API.ItemNameAndProps`, requested per item with `Items.WaitForProps` first. |
| `bridge` | `["highlight", "grab", "goto"]` | See "The bridge actions," below — each is built from a specific documented call, not a guess. |

**Razor Enhanced's own layer names differ from TazUO's.** TazUO's adapter (and the scan schema's
own examples) use names like `OneHanded`, `Helmet`, `Necklace`, `Torso`. Razor Enhanced's
documented layer vocabulary is `RightHand`, `LeftHand`, `Shoes`, `Pants`, `Shirt`, `Head`,
`Gloves`, `Ring`, `Talisman`, `Neck`, `Waist`, `InnerTorso`, `Bracelet`, `MiddleTorso`,
`Earrings`, `Arms`, `Cloak`, `OuterTorso`, `OuterLegs`, `InnerLegs` — this adapter uses those
names, unchanged, in both `capabilities.json` and every `equipped[].layer` value. Eleven of them
happen to already match the app's own `LAYER_TO_SLOT` vocabulary (`Gloves`, `Pants`, `Shoes`,
`Shirt`, `Waist`, `Arms`, `Cloak`, `Ring`, `Talisman`, `Bracelet`, `Earrings`) and classify
correctly for free; the rest (the hand layers, `Head`, `Neck`, and the torso/leg splits) don't
match any `LAYER_TO_SLOT` key, so the app falls back to classifying those items by name instead —
which is how it classifies gear from adapters with no layer data at all, so nothing is lost,
only the "layer as a tie-breaker" shortcut. Translating `RightHand`/`LeftHand` to
`OneHanded`/`TwoHanded`, or `Head` to `Helmet`, would likely be safe (those are well-known
one-to-one UO layer synonyms), but the three-way `InnerTorso`/`MiddleTorso`/`OuterTorso` split
and the two-way `InnerLegs`/`OuterLegs` split don't have one correct universal answer — which
layer a given robe or set of leggings actually occupies is item-specific, not a fixed mapping —
so guessing at a translation risked silently misclassifying gear for every Razor Enhanced user.
Shipping the client's own honest layer names and letting the name-based classifier carry the
ambiguous ones was the safer call.

**Skill names are likewise Razor Enhanced's own**, not TazUO's: `EvalInt` not `Evaluating
Intelligence`, `Magic Resist` not `Resisting Spells`, `Macing` not `Mace Fighting`, `Blacksmith`
not `Blacksmithy`, `Inscribe` not `Inscription`, `Spell Weaving` not `Spellweaving`, `Detect
Hidden` not `Detecting Hidden`, `Item ID` not `Item Identification` — taken from the argument list
`Player.GetRealSkillValue`/`Player.UseSkill` document. `docs/scan-schema.md` says skill keys are
"skill names as the client shows them," and these are what this client shows.

**Skill values are `Player.GetRealSkillValue`, documented as "the base/real value of the skill"**
— not necessarily the same number the paperdoll shows once item bonuses (Resisting Spells' gear
bonus, for instance) are added in. No separate "effective/displayed" skill read turned up
anywhere in the fetched Player docs. `docs/scan-schema.md` doesn't require a specific shape here
("whatever shape the adapter reads off the skill gump"), so this isn't a schema violation, just a
fidelity note: treat this adapter's skill values as trained skill, not necessarily paperdoll
skill, until someone confirms otherwise against a live client.

## The bridge actions

- **`highlight`** — Razor Enhanced's docs have no "flash text above an arbitrary item" call (only
  `Player.HeadMessage`, which is above the *player*, not the item). Instead this recolors the item
  — and, when the command carries a container chain, the chest it's inside — with
  `Items.SetColor(serial, hue)`, documented as affecting only your own client and not persisting,
  for a few seconds, then restores the original hue. A `Player.HeadMessage` naming the item plays
  alongside it as a local status line. This is a different mechanic from TazUO's overhead text, but
  it satisfies the same job: something visibly changes, locally, near the item, for a few seconds.
- **`grab`** — `Items.Move(source, destination, amount)`, with `amount: -1` (documented as "the
  whole stack") moving the item into `Player.Backpack`, then a re-read of the item's `Container`
  to confirm it landed before reporting success — same verify-after-move discipline as
  `adapters/tazuo/`.
- **`goto`** — `Player.PathFindTo(x, y, z)` to the container's position (from the live `Item` when
  the client already knows it, else the scanned `pos`), polled against `Player.DistanceTo`/manual
  distance math until in reach or a timeout. Whether `PathFindTo` blocks until arrival or returns
  immediately isn't documented either way — the poll loop after it is safe regardless (it either
  finds itself already in range on the first check, or waits out the actual walk).

All three require the container chain to be opened first with `Items.WaitForContents`, per
container, in order — the same "open, then trust the contents" discipline the scanner itself uses.

## Stopping the bridge

`while Player.Connected` — not a literal `while True` — bounds the main loop, per a community
convention documented on the UO Eventine wiki (see Sources): the loop ends on its own if the
character disconnects or logs out, and it's bounded to `MAX_HOURS` regardless. **What isn't
verified: whether Razor Enhanced exposes anything like TazUO's `API.StopRequested` for detecting a
mid-loop Stop-button press from inside a running script.** No such flag turned up in the official
API reference. If Razor Enhanced's Stop button works the way most embedded scripting engines of
this shape do (aborting the script's thread outright), the bridge simply ends wherever it happens
to be, which is an acceptable, safe failure mode for a script that only ever acts on one command
at a time — but this is unconfirmed, not a documented guarantee, and the first live run should
specifically check that Stop actually ends the script promptly.

## The AFK rule

These scripts read what your character can see and move one item when you click. They never
fight, farm, or loop unattended — the same statement every Pack Rat adapter makes (see
`docs/adapter-guide.md`'s "attended-only statement").

## Data directory resolution

Both scripts resolve their data directory the same way, checked in order:

1. `packrat-paths.json` next to the script (`{"dataDir": "..."}`).
2. the `PACKRAT_DATA` environment variable.
3. `~/.pack-rat`.

The scanner writes to `<dataDir>/inbox/razor-enhanced/<Character>-<YYYYmmdd-HHMMSS>.json`. The
running app watches that folder (`app/watcher.mjs`) and moves each file into `<dataDir>/scans/`
under its own normalised name once it parses and validates — a file that keeps failing ends up
under `<dataDir>/inbox/razor-enhanced/rejected/` instead, with a `.reason.txt` beside it. The
bridge reads `<dataDir>/bridge/razor-enhanced/queue.jsonl` and writes
`<dataDir>/bridge/razor-enhanced/status.json`. Every write goes through a temp-file-then-rename so
a crash or a read mid-write never leaves a half-written file behind.

## Limits

- Bank contents are only readable while the bank box is already open this session — same
  restriction as `adapters/tazuo/`.
- A container's contents only reach the client after `Items.WaitForContents` has opened it once in
  this session — the scanner and bridge both do this before trusting a container's contents.
- No quick-refresh script yet (see "What each script does," above).
- `Player.GetRealSkillValue` reads the base/real skill, not necessarily the item-bonused value the
  paperdoll shows (see above).

## What's still outstanding

- **Nothing has run against a live client.** Every API call this adapter uses is individually
  documented, but nobody has run either script against a real character on a real Windows machine.
  Treat the first live run as a real test. `Items.Filter()`'s constructor call, whether
  `Player.PathFindTo` blocks, and the Stop-button behavior noted above are the specific spots most
  likely to surprise.
- **No `fixture.scan.json`.** See "Status," above — a real run (Task 6) should generate one the
  way `adapters/tazuo/fixture.scan.json` was: play a scan, scrub it per `docs/adapter-guide.md`'s
  Fixture rules, and drop it in here.
- **No candidate-path auto-detection.** `app/installer.mjs`'s `candidateClientRoots` only knows
  where TazUO tends to land (`adapter !== "tazuo"` returns no candidates for anything else) —
  Razor Enhanced has no single well-known install location the way TazUO's Desktop/Downloads/
  Documents convention does, so this adapter's setup step always needs the folder picked by hand.
  A later task could add real candidate paths once someone confirms where Razor Enhanced actually
  tends to be installed.

## Sources

- https://razorenhanced.readthedocs.io/api/ — the official Python API reference (fetched
  2026-09-17), specifically the `Player`, `Item`, `Items`, `Items.Filter`, `Property`,
  `PathFinding`, and `Misc` pages. Confirms: `Item.Contains`/`IsContainer`/`IsCorpse`/`ItemID`/
  `Layer`/`RootContainer`/`Properties`; `Items.WaitForContents(bag, delay)` ("Open a container an
  wait for the Items to load"); `Items.WaitForProps(item, delay)`; `Items.Move(source,
  destination, amount, x, y)` with `amount: -1` for the whole stack; `Items.SetColor(serial,
  color)` as client-local and non-persistent; `Items.Filter`'s `OnGround`/`RangeMax`/
  `IsContainer`/`IsCorpse`/`Layers` fields and `Items.ApplyFilter`; `Player.GetItemOnLayer`/
  `CheckLayer`'s full layer-name list; `Player.GetRealSkillValue`/`GetSkillCap`/`UseSkill`'s full
  skill-name list; `Player.Backpack`/`Bank`/`Str`/`Dex`/`Int`/`Hits`/`HitsMax`/`Mana`/`ManaMax`/
  `Stam`/`StamMax`/`AR`/`FireResistance`/`ColdResistance`/`PoisonResistance`/`EnergyResistance`/
  `Position`; `Player.HeadMessage` as "Visible only by the Player"; `Player.ChatSay`/`ChatWhisper`/
  `ChatYell` as network speech, distinct from the above; `Player.PathFindTo(x, y, z)`;
  `Player.DistanceTo`/`InRangeItem`; `Misc.SendMessage(msg, color, wait)` as "Send a message to
  the client" (distinguished from the `Chat*` family the same way); `Misc.Pause(millisec)`.
- https://uoeventine.net/wiki/index.php/Razor_Enhanced_Basics — a community wiki, not official
  documentation, cited for exactly two conventions the official reference doesn't state: that
  `Items.WaitForContents` "should always be used when opening a container with a script before
  having it look through the contents" (the basis for this adapter's open-before-read discipline),
  and that `while Player.Connected:` is the idiomatic replacement for `while True:` in a
  long-running Razor Enhanced script (the basis for the bridge's main loop condition). Both are
  presented there as established community practice, not as a claim this adapter's own behavior
  has been tested.
