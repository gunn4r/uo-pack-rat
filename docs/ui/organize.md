# Organize

Part of the UI docs: [`docs/ui.md`](../ui.md) has the hard rules, tokens, components and the dependency rules every screen follows.

## Code

### Where each part lives

| Module | What it draws and does |
| --- | --- |
| `ui/organize.mts` | The screen at `#/organize` (`showOrganize`): the Rules card, the Plan card, running and following trips |
| `ui/organize-model.mts` | Pure: every decision and sentence on the screen (editing the setup, `matchSummary`, `targetView`, `tripRows`, `stepWatch`, `acceptGate`, …) |
| `ui/organize-data.mts` | The data module: the page's copy of the setup (`state.organize`), `loadOrganize`, `saveConfig`, the rule editor's live count (`matchCount`) |
| `ui/rule-editor.mts` | The rule drawer (`openRuleEditor`) |
| `ui/auto-organize.mts` | The Auto organize drawer (`openAutoOrganize`, `POST /api/organize/propose`) |
| `ui/organize.css` | The screen and both drawers |

The setup's shape and the rule filters are `app/organize-config.mts` (`RuleMatch`); the planner is `app/organize.mts`.

### State, events and routes

- **Saves:** every change to the setup is a `saveConfig(update)` in `organize-data.mts`. Saves run one at a time, each naming the stamp it read (`PUT /api/organize`'s `base`). A save refused as `stale` reloads the setup and says so.
- **`organizechange`:** a save, or a reload, dispatches it on `document`. The Organize screen, the Containers view, the Scrolls view and the Items rows listen for it.
- **`bridgestatus`:** dispatched by `ui/bridge.mts`'s poll with every status. The screen follows a running trip on it.
- **Routes:**
  - `GET /api/organize`, `GET /api/blacklist`, `GET /api/organize/presets`;
  - `POST /api/organize/match`, `POST /api/organize/propose`;
  - `GET /api/organize/plan`, `POST /api/organize/trip`, `POST /api/bridge/stop`.

### Tests

- `app/ui-organize.test.mts` covers `organize-model.mts`, with no DOM.
- Electron: `scripts/ui-organize.test.mts`. `SCREENS` maps `organize`, `auto-organize`, `rule-editor` and `organize-model` to it, and `organize-model` to `scripts/ui-map.test.mts` too.

### How to extend it

- **A new rule filter:** add the field to `RuleMatch` (`app/organize-config.mts`, with its salvage and the planner's match). Then give it a token in `rule-editor.mts` and words in `matchSummary`, each with a test in `app/ui-organize.test.mts`.
- **A new sentence or gate on the screen:** add it to `organize-model.mts` with its test, and draw it from `organize.mts`.

## The setup and how it is saved

The Organize screen (`#/organize`, issue #11) is two stacked cards at the page's width. Every decision and sentence on it comes from `ui/organize-model.mts` (no DOM, tested by `app/ui-organize.test.mts`).

`ui/organize-data.mts` holds the page's copy of the setup in `state.organize`: the config from `GET /api/organize` and its stamp, the problems its salvage reported, the blacklisted serials, the plan and the presets. It saves the setup whole with `PUT /api/organize`, naming the stamp it read as `base`, and dispatches `organizechange` on `document`.

A save may be refused because the setup was saved elsewhere since (another window, or an AI assistant through MCP). The page then reloads the setup, redraws, and says the change was not saved, so the player makes it again on what is there now (issue #280).

A save is a change to the setup (`saveConfig(update)`), not a finished copy. Saves run one at a time, and each change is made when its turn comes, on the setup the save before left and with its stamp. So quick edits (↓ twice on a rule, two selects) each build on the last, and none is refused or undone. Auto organize's Accept names the stamp its proposal was worked out from. The Organize screen, the Containers view, the Scrolls view and the Items rows each listen for `organizechange` and redraw.

## Empty states

- No ground container scanned: say so.
- Nothing labeled: explain that Organize only touches labeled containers (so a friend's chest is never moved into), and offer Open Containers.
- Labels but no rules: the Rules card asks for one.
- A hand-edited `organize.json` the server salvaged: show what was dropped, with **Save setup**, since no trip runs until the setup is saved as it now reads.

## Rules card

One row per rule, in priority order (first match wins). Each row has:

- a drag handle (`.org-grip`). ↑/↓ on the focused handle move the rule, and a polite live region says where it went;
- the name, with an Auto badge for strategy-made rules;
- a one-line summary of its filter (`matchSummary`, in the Inventory's own token words);
- the target chain, each container with its art at 24 px (issue #174, `containerArt`). The label color sits as a swatch in the tile's corner, or the swatch alone without art. Each target also shows a fill meter and "61/125" (`targetChip`); a target in no scan keeps its label's name and reads "not in any scan";
- the plan's counts: to move, in place, and no room as a warning badge;
- a ⋯ menu: Edit…, Move up/down, Delete….

The row is a grid that drops the chain and counts under the name at 900 px of list width or less. That is a container query, so a 1000 px window gets there even with the sidebar collapsed.

Under the list are two pickers, each with its counts: "Everything no rule takes", which picks the catch-all from labeled, unpinned containers, and "Empty bags", which picks where empty bags are gathered (issue #128).

## Rule drawer

`ui/rule-editor.mts` is the drawer. From the top:

- Name, and a preset to start from (`GET /api/organize/presets`; picking one replaces the names and the filter).
- "Name is any of" (one per line).
- **Filter:** the Inventory's filter bar (`ui/filter-bar.mts`, issue #487) without the Character, Location and Seen chips: search, Slot, Rarity, Kind (never "container": bags never move), Type, Weapon skill, and "+ Filter" for property rules (≥ ≤ = ≠ over the property catalogue, with counts), slayer, tags, gargoyle and meditation. Its text never mentions locations, since a rule's search does not match them.
- **Filtered by:** every filter the rule carries, as removable tokens like the Inventory's strip, plus the build a By build rule takes ("Build: Caster") and a scroll preset's school. A change from the bar redraws only these tokens and the count, so an open popover stays put.
- **Skip pieces of saved suits** (issue #133, `RuleMatch.skipSuits`): a piece of any saved Suit Builder run is left to the rules below, as the Undesirables presets have it.
- A live count, "Matches 12 items (e.g. …)", from `POST /api/organize/match` about 300 ms after typing pauses. A note says when rules above this one may claim some of them first.
- The targets in fill order, with ↑/↓/× per container. "Add a container…" lists each labeled container, with the scanned bags inside it indented under it, and never a pinned, blacklisted or unopened one. Picking an unlabeled bag labels it by its engraving or name when the rule is saved (`withTargetLabels`).

The draft lives in the module, not the DOM, so a redraw keeps what was typed.

The Inventory's filter strip has **Save as rule…**, which opens the drawer with the current item filters (`ruleQueryFrom`). A note names the location, character and seen filters it left out.

## Auto organize drawer

`ui/auto-organize.mts` is a wide drawer, opened by **Auto organize…** in the Rules card's actions and in the no-labels empty state. It has three sections:

- **The strategy:** a segmented Simple / Detailed / By build, with one sentence each.
- **The containers it may use:** one checkbox per usable ground container with its fill, under a "House N" heading when there are several houses. A container the player's own labels or rules use starts unticked, with a note saying why. The rest go in a closed "can't be used" list, each with its reason.
- **The proposal** (`POST /api/organize/propose`): worked out again 300 ms after a box is checked or cleared, and at once on a strategy change.
  - A headline, then a line each for the items that have no room and the items no rule takes, which stay where they are (shown only when there are some).
  - Notes, which include what the full layout still needs (the containers, and the bags for each shared container) when it needs any.
  - A table of groups, with the containers each gets ("…, in a bag of its own" for a group given a bag in a shared container, issue #132) and a Fits / Short / No container / No bag badge.
  - With Detailed and groups left over, it offers Try Simple instead.

Accept saves the proposal's `config` whole with `saveConfig`. It is disabled, with its reason, while a proposal is being worked out, when nothing is checked, and when the proposal is the current setup. If the setup changed since the proposal was shown, Accept works it out again first.

Each candidate's row starts with the container's art at 24 px when its scan recorded a graphic (issue #174, `containerArt`).

## Plan card

Reports come first:

- room shortfalls;
- items that belong at another house;
- the planner's warnings, grouped by kind. Containers are named by label and timestamps shown as dates, and a target nearly full after the plan is among them;
- the empty bags in labeled containers (`emptyBagsNote`: how many, the first five by name and place, and how to gather them);
- what a stopped trip left in the backpack, with Put them away;
- a trip's failed steps, each with Pin this item.

Then the headline: "N items to move in M trips, about K minutes", from the planner's per-trip estimate (`tripSeconds` in `app/organize.mts`). Under it are Run trip N / Run all / Stop, and the trip list: one collapsed `<details>` per trip, whose move table is built the first time it opens.

A client whose bridge does not declare `trip` gets the plan and a sentence instead of Run buttons. Offline or busy states disable the buttons, with their reason (`tripGate`).

## Running trips

Run trip posts `{index, stamp}` to `POST /api/organize/trip`. A stale plan is fetched again, with a sentence.

The page follows the trip on the `bridgestatus` event that `ui/bridge.mts`'s poll dispatches with every status, and on a 5 s timer (`stepWatch`):

- a trip the bridge never picks up, or whose bridge stops answering, is given up after 95 s (just past the 90 s the server holds it);
- any trip is given up after 15 minutes;
- a click while the trip is being queued queues nothing.

When a trip reports back, the plan is fetched again. Run all then runs the new plan's first trip, and stops on a stopped, partial or failed trip, or on a plan that did not get shorter. Stop posts `POST /api/bridge/stop`, and the bridge halts after its current step. The Organize nav item shows a busy dot while a trip runs.

`GET /api/organize/plan` also answers `running`: the trip the server has queued and not heard back about (`{id, index, queuedAt, picked}`), or else null. A page that was reloaded mid-trip, or a second window, follows that trip from its queue time with the same rules, Stop included, and says so (`adoptWatch`, `resumedNote`). Run all is not resumed. A trip the page already stopped following (it reported back, or the page gave up on it) is not followed again.

## Labels elsewhere

Inventory › Containers has:

- Highlight in game (issue #10): the bridge's highlight with the container itself as its target, gated like the item actions by `bridgeActionReason`;
- Label… / Edit label… in each ground container's ⋯ menu, except blacklisted ones. It sets the name, the color and Pinned, and pinning or removing a label that rules use first says which rules lose it;
- a Fill column.

Wherever the page prints an item's place (the Location column, the item peek and tooltip, grouped rows, the Suit Builder's plan and fetch list), `dom.mts`'s `whereText` reads a labeled container by its label (`labelledPlaces`).
