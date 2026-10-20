# The Inventory screen

Part of the UI docs: [`docs/ui.md`](../ui.md) has the hard rules, tokens, components and the dependency rules every screen follows.

## Code

### Where each part lives

| Module | What it draws and does |
| --- | --- |
| `ui/item-browser.mts` | The item browser (`createItemBrowser`): toolbar, active-filter strip, virtual table. One instance per mount, so it is reused (the Suit Builder's picker) |
| `ui/filter-bar.mts` | The filter bar (`createFilterBar`): search, facet chips and their popovers, "+ Filter". Shared by the item browser and the Organize rule editor, which leaves out Character, Location and Seen (issue #487) |
| `ui/inventory.mts` | The Items view: one item browser with the Inventory's options |
| `ui/inv-model.mts` | Pure: the query string, the active-filter tokens and their wording, counts, the empty-result sentence, the row window, the keyboard model, `slayerTree` |
| `ui/peek.mts` | The item peek beside the table |
| `ui/item-tip.mts` | Pure: where the item tooltip gets its record (`createTipResolver`); `dom.mts` draws the tooltip itself |
| `ui/move-to.mts`, `ui/move-model.mts` | Selection and Move to: the selection bar, the picker, the move's result line; `move-model.mts` holds the rules |
| `ui/containers.mts` | The Containers view |
| `ui/scrolls.mts`, `ui/scrolls-model.mts` | The Scrolls view; `scrolls-model.mts` holds every number |
| `ui/unravel.mts`, `ui/unravel-model.mts` | The Unravel view; `app/unravel.mts` holds every number, `unravel-model.mts` the Gather dialog's words |
| `ui/kinds.mts` | Classify this…, and the item kinds export and import |
| `ui/item-parts.mts`, `ui/item-art.mts` | Shared item widgets (rarity, tags, place, the row actions) and container art |
| `ui/inventory-data.mts` | The data module: `reload()`, `fetchAllItems`, `inventoryLoader` |
| `ui/inventory.css` | The screen's stylesheet |

### State, events and routes

- **Events:**
  - `inventorychange` (a new inventory) redraws every view;
  - `organizechange` redraws the rows' places and the Scrolls view;
  - `bridgechange` redraws the row actions;
  - `builderchange` with key `runs` refetches the Unravel candidates.
- **Routes:**
  - rows come from `GET /api/items` (500-row chunks);
  - one item from `GET /api/items/by-serial`;
  - moves from `POST /api/move/plan` and `POST /api/move/trip`;
  - missing items from `GET /api/missing`;
  - kinds from `POST /api/item-kinds`;
  - container art from `GET /api/item-art`.
- **Preferences:** view choices go through `prefs.mts`'s `prefs.set`. Unravel's kept pieces and bag go through `PUT /api/settings`.
- **Other screens** open the Items view through `nav.mts` (`showItem`, `showContainer`, `showSearch`, `showKind`, `showCharacterItems`).

### Tests

- **Pure:**
  - `app/ui-inventory.test.mts` (`inv-model.mts`);
  - `app/ui-item-tip.test.mts`;
  - `app/ui-move.test.mts`;
  - `app/scrolls-model.test.mts`;
  - `app/unravel.test.mts`;
  - `app/unravel-model.test.mts`;
  - `app/ui-state.test.mts` (`view-state.mts`).
- **Electron:**
  - `scripts/ui-state.test.mts` (the Items and Containers views);
  - `scripts/ui-scrolls.test.mts`;
  - `scripts/ui-move.test.mts`;
  - `scripts/ui-unravel.test.mts`;
  - `scripts/ui-gather.test.mts`;
  - `scripts/ui-tooltips.test.mts`, which hovers an item on every screen.
- **`SCREENS`:** it maps `inventory`, `inv-model`, `peek`, `containers` and `view-state` to `ui-state`, and the Scrolls modules to `ui-scrolls`. It maps the Move to modules to `ui-move` and `ui-gather`, the Unravel modules to `ui-unravel` and `ui-gather`, and `item-tip` to `ui-tooltips`.

### How to extend it

- **A filter:** add the query field to `app/item-query.mts`'s `parseItemQuery`, then the token and its wording to `inv-model.mts` with a test. Then add the control in `filter-bar.mts`, going through `setQuery()`; the Inventory, the Manual picker and the rule editor all get it. `docs/change-checklists.md` "Add an item property or property filter" lists the rest.
- **A column:** put its key in its group in `inv-model.mts` (`COL_GROUPS`; `ITEM_COLS` holds the item's own fields).
  - A column that is on by default also goes in `DEFAULT_COLS`.
  - So that column lists saved earlier get it once, raise `COLS_VERSION` and have `withNewDefaults` (`view-state.mts`) add it. Today that function adds only Tags.
- **A place that draws items:** wire each one with `itemTip(node, item)`, or `scripts/ui-tooltips.test.mts` fails.

## The item browser

`ui/inventory.mts` draws the Items view as one instance of the item browser, `ui/item-browser.mts` (issue #12). `createItemBrowser(root, opts)` builds the toolbar, strip, columns popover and virtual table inside `root`, and owns its query, loaded page, columns and timers, so it can be mounted more than once. Its options:

- `fixed`: a partial query always applied and never shown as a chip, token or "+ Filter" entry;
- `columns`: the default set, `DEFAULT_COLS` when left out;
- `extraColumn`: one more cell per list row, after Name;
- `onActivate`: a list row's click or Enter;
- `rowActions`;
- `detail`: the peek's hooks;
- `persist`: save columns, widths and density to ui-prefs;
- `globalIds`: the Inventory's `#f-text`, `#inv-settings`, … ids, which its CSS and the Electron tests select. A second instance leaves them off.

"/" focuses the search of the browser on screen, unless it was pressed inside another browser. The pure rules (the query string, the active-filter tokens and their wording, the counts and plurals, the empty-result sentence, the row window and the keyboard model) are in `ui/inv-model.mts`, tested under plain `node:test` by `app/ui-inventory.test.mts`.

## Filter state

The filter state is the browser's `query`, the shape `item-query.mts`'s `parseItemQuery` reads. Every control goes through `setQuery()`, which redraws the chips (in place, so an open popover keeps its anchor) and the active strip, and refetches.

- **Any-of lists:** Character, Slot, Location (as bag texts `loc`, whole root containers `root` and houses `house`), Kind, Type and Weapon skill.
  - A container labelled for Organize is listed in Location by its label, as the Location column shows it, with its scanned name beside the serial (`placeNames`); the list's own search finds either. The search box finds an item by its container's label too: `applyItemQuery` takes `labelledPlaces` as `places`, on the server and in Select all matching.
  - Type (`type=shield`) is what a piece is, from `domain/pools.mts`'s `itemTypeOf`: Shield, Two-handed weapon, One-handed weapon, Spellbook, Armor, Jewelry, Clothing or Other. A weapon (`isWeapon`: a held piece with a Skill Required or Weapon Speed line) is one- or two-handed by its tooltip's "One-handed Weapon" / "Two-handed Weapon" line, which classify reads ahead of the name; a held piece that is no weapon is a Shield in the two-handed slot, whatever its name, and a Spellbook in the one-handed one. Everything that is not gear is Other.
  - The chip sits beside Kind, with the facets' `types` counts. A browser fixed to slots (the Manual picker) offers only the types those slots hold (`typesOfSlot`), and hides the chip when that is one. While Type names no weapon type, the Weapon skill chip is hidden unless set.
  - Location lists the houses on the House map under **Houses** (claimed ones, by their House map names, `house-links.mts`'s `mapHouses`), each with its count, then each house's containers under its name, then the ground containers in no house under **On the ground**. A house's checkbox takes every container standing in it, now and as later scans add more: the server reads `house=<id>` through `HousesService.houseOfContainers` (the house model's stacks), and its token reads "Location: <house name>".
  - Weapon skill (issue #188) is written `wskill=swordsmanship`, with lower-cased skill names, and its tokens read "Weapon skill: Swordsmanship".
  - The facets' `weaponSkills` counts each skill from `vault-lib.mts`'s `weaponSkillsOf`. A Use Best Weapon Skill weapon also counts under Swordsmanship, Fencing and Mace Fighting, which the chip's popover says.
- **Rarity** is a range (`rarityMin`, `rarityMax`). An item with no tier counts as below every tier, and a Reforged tier ranks with its base tier.
- **Property rules** carry an operator (≥, ≤, = or ≠: `prop=lmc:le:4`, `prop=fc:ne:-1`), and can name a numeric tooltip line no property models (issue #133: the facets' `extraKeys`, gear's only, such as `prop=splintering weapon:10`).
  - The popover lists the whole catalogue (`domain/properties.mts`'s `PROPERTY_CATALOGUE`): every gear property the tooltip reader reads, by the shard's names with the unit ("Hit Chance Increase %", "Weapon Speed s"), in the groups Resists, Casting, Combat, Weapon, Defense & eaters, Stats & pools and Other, then **Yes or no** (`FLAG_CATALOGUE`).
  - Each option counts the stacks in view that carry it (`GET /api/items?…&fields=props`, `propCounts`, over the browser's query with its fixed fields): "Faster Casting 46". One no stack in view carries keeps its place, dimmed, with "0", and picking it gives the usual empty state ("None of the 300 stacks has Swarm ≥ 1.").
  - Every entry's tooltip line has been seen on the shard, in a scan or its vendor listings (Hit Curse, the Resonances, Lower Ammo Cost, Searing Weapon, Cannot Be Repaired); Bane and Assassin Honed are offered as plain-name yes/no lines, as the shard shows such properties. A property no tooltip has shown yet stays out until one does.
  - Values keep the tooltip's sign: Mage Weapon is negative ("Mage Weapon -10 Skill"), so a note under its rule (`MAGE_WEAPON_HINT`) says that ≥ -20 keeps penalties of 20 or less and that items with no Mage Weapon read 0. Power scroll level and Scroll of Transcendence points are scroll filters, not gear properties, so the popover does not offer them; a rule or link that names them still filters.
  - An item without the property reads 0 under every operator, so `fc:ne:-1` keeps the items with no FC, and ≠ 0 leaves them out, which a note under the rule says (`neZeroHint`).
- **Yes/no properties** are required with `flag` (issue #182: `flag=spell channeling`, repeated; every one must be present).
  - They are offered from `FLAG_CATALOGUE` as the property rule's last group, **Yes or no**, each with its count like the numeric ones.
  - Picking one hides the comparison and the number, moves the focus to Add rule, and shows a Title Case token ("Spell Channeling").
  - `domain/pools.mts`'s `flagKeys` (the facet MCP reads) says which tooltip flags count: a known yes/no property such as "(imbued)", read Imbued, or a plain-words line on gear. Never a slayer, a race lock, free text or a resource's material.
  - Its `flagKey` folds every "part of an armor set (N pieces)" into one Part of an Armor Set and lower-cases, for the facet and for matching alike.
- **Tags** are hidden (`hide`) or required, any of them (`tag`), from the one Tags… popover.

## Slayer filter

The slayer filter (issue #189, "+ Filter" › Slayer…) is a single-choice radio list: "No slayer filter", "Any slayer", then the slayers laid out like the shard's slayer charts, from the rules' `slayerGroups` (`inv-model.mts`'s `slayerTree`).

- **Order:** each super slayer ("Reptile Slayer", with a muted **Super** tag and its count) is followed by its lesser slayers, one step in ("Dragon Slayer"). A titled group ("Talisman slayers") follows, then **Other**, A–Z, for any slayer the table lacks. A hairline separates the groups (`slayerTree` marks each group's first row `first`). The "Super" tag is `aria-hidden`, and a heading row has `role="presentation"`.
- **Every slayer of the table is listed**, so any can be picked: one the inventory lacks is dimmed with a count of 0. A super slayer the inventory has under none of its names is listed by its first name.
- **Labels** are Title Case plus " Slayer" (`slayerLabel`). A capitalized bracket, the item's own wording, moves after it ("Undead Slayer (Silver)"). A lower-case bracket that only describes the group goes: "Exorcism (demons)" reads "Exorcism Slayer". The chip and token read "Slayer: Dragon Slayer".
- **Matching:** picking a lesser slayer finds the items with exactly that slayer, never its super slayer, which a muted line at the foot of the popover explains.

A shard without `slayerGroups` gets the plain A–Z list.

## The table

- **No pager.** The table is virtual: the body holds only the rows in view, between two spacer rows. Rows are patched rather than replaced, so a focused row is never detached, and they load from `GET /api/items` in 500-row chunks as they scroll into view. A new query keeps the old rows on screen until its first chunk lands. The header (sort arrow, grouped columns) follows the data, not the click.
- **Keyboard.** The toolbar is one tab stop (`role=toolbar`, ←/→ between controls; the search's arrows move its caret until an end). The table is one tab stop (↑/↓, Home/End, Page Up/Down). Row actions are reached with Tab from the focused row, and `/` focuses the search.
- **Columns.** Name, Rarity, Slot and Location are always shown. Slot is left out of a browser fixed to one slot (the Suit Builder's picker), where it would read the same on every row. Every other column is the player's choice. The item's tags (Cursed, Prized, …) are their own Tags column, drawn right after Name wherever the list names it and on by default; the Name cell holds only the name and a stack's quantity.
- **Responsive.** Below 1180 px the unset facet chips fold into "+ Filter" (the Weapon skill chip already below 1280 px, where the toolbar has no room for it), and List | Grouped moves into the table settings popover, so the toolbar never wraps.

## Selection and Move to

Selection and Move to are issue #270: `ui/move-to.mts` draws `ui/move-model.mts`'s rules, and the browser's `selection` option draws the checkbox column.

### Selecting

- Each list row has a checkbox (not in Grouped), and shift-click ticks every loaded row from the last one clicked.
- A worn row has a lock instead, titled "Worn: take it off first". It is left out of a range by name ("Left out Silver Ring: it's worn. Take it off in game to move it.").
- The header checkbox ticks the rows loaded so far, and unticking it unticks them (Clear takes everything).
- When the filter matches more rows than are loaded, the bar offers **Select all N matching the filter**, which `POST /api/move/plan` counts without loading the rows (worn items left out).
- The selection is kept by serial and, for all matching, as that filter less the rows unticked since. So it survives scrolling and filter changes. It clears once an action is queued.

The bar (`#inv-selbar`, at the top of the table's card; below 720 px under the rows) shows the count with **Grab** (ticked rows only, up to 20, through Grab all), **Move to…** and **Clear**.

### The picker and the plan

**Move to…** opens a picker of the containers the scans know that a trip can fill: on the ground with a known fill, never blacklisted, trash or unopened. They are grouped by house, with search, and each shows its fill, meter and room for the items a trip can take ("Room for all", "3 already here", "Room for 4", "Full", which can't be picked).

Picking one asks `POST /api/move/plan` for the exact plan:

- what moves;
- what doesn't fit ("Gem Chest has room for 4 of 9. The other 5 stay where they are.", with **Move the 4 that fit**);
- what stays where it is and why (worn, in a backpack or bank, in another house).

### Running a move

Move runs as Organize trips through `POST /api/move/trip`, one at a time, on exactly the items the picked plan showed (its `serials`, so a scan landing mid-run adds nothing). Each trip that reports back cleanly asks for the next.

The result line (`#inv-move-result`):

- counts the trips, with Stop;
- then says what moved and what didn't fit;
- names the moved items an Organize rule would take out again, with **Pin them here** (the Organize pin);
- offers **Move back** while the overlay still knows where each item came from.

Move back returns each item to the container it came from. It names the items it skipped because they moved since, and those whose container has no room for them now. A Stop pressed while the next trip is being queued is sent again once it is. The rows show the new places at once, from the overlay.

## Bridge gating

Row actions are always drawn, and disabled with a reason (`bridge.mts`'s `bridgeActionReason`: worn, client can't, no position for Go to, bridge offline). `pollBridge` dispatches `bridgechange` on `document` when the bridge's state changes, and the table redraws its rows.

## Preferences

These are ui-prefs fields:

- the chosen columns (`cols`);
- the column set they were saved against (`colsVersion`). A list saved before a column joined the defaults gets it once, then an "off" sticks (`view-state.mts`'s `colsFromPrefs`);
- the row density (`density`: `dense` 32 px or `regular` 40 px);
- the column widths dragged on the header edges, or set with ←/→ on a focused resize handle (`colWidths`: `{colKey: px}`, 40 to 1200, cleared by table settings' "Reset column widths").

Every screen writes its ui-prefs fields through `ui/prefs.mts`'s `prefs.set(patch)`, the one `PUT /api/ui-prefs` caller. Its failure toast is `messages.mts`'s `prefsSaveFailed`; a `quiet` write, such as the sidebar's, says nothing.

## Item peek

`ui/peek.mts`: a row click, Enter or Space opens the selected item in a panel docked beside the table (400 px, 360 below 1280, laid over the table below 1180).

While it is open, ↑/↓ step through rows with the peek following, and Esc closes it (focus goes back to the row). Both work from the table, the panel or the bare page: a click on the panel's text leaves focus on `<body>`, so the keys are heard on the document. A field being typed in, a popover, a dialog or a drawer keeps its own keys.

Its tag chips carry the shard's meaning for each tag (the rules' `tagInfo`, `dom.mts`'s `tagChip`) as a tooltip on hover and focus. Its footer's Highlight, Grab and Go to are gated like the row actions.

## Item tooltip

The item tooltip is `dom.mts`'s `tipNode`, `installTooltip`, `showItemTip` and `itemTip` (issue #10): the one `#tip`, always dark, 280 px. It shows 400 ms after the pointer settles on anything with `data-serial`, or after an item has had keyboard focus for 400 ms (with `aria-describedby="tip"` on it while open). It is `pointer-events: none`, placed inside the window.

### Wiring an item

Wherever the page draws an item it wires it with `itemTip(node, item, {focus})`. That sets `data-serial`, registers the record drawn and, unless `focus` is false, makes the node focusable and shows the tooltip on keyboard focus.

`ui/item-tip.mts` resolves what to show:

- the registered record, when it carries its tooltip lines;
- else `state.itemCache`;
- else one `GET /api/items/by-serial`. A serial the server says it does not know is asked for once per inventory, and a partial record, if registered, is shown instead. A lookup that failed on the network is asked again on the next hover.

Wired today:

- Inventory rows: the list, and grouped rows of a single stack (a group of several stacks has no one item to show);
- the Suit Builder's current suit, Plan, Fetch list and compare cells;
- character sheet slots;
- the House map's contents drawer rows and bags;
- Organize's plan moves and failed steps;
- the Scrolls view's detail rows.

`scripts/ui-tooltips.test.mts` hovers an item on every screen, so a new screen that draws items without `itemTip` fails there.

### When it hides

- It hides on leave, on Esc, and on a scroll that moves its item from under the pointer. That excludes the scroll a hover makes to bring a row into view; a keyboard tooltip follows its item instead.
- It hides when its item leaves the page.
- A `data-no-tip` region inside an item (row actions) counts as off it.
- An item whose own pop or menu is open (`aria-expanded="true"`, the character sheet's `.item-pop`) shows none.
- Inside an open modal dialog (the top layer), `#tip` moves into the dialog so it draws above it, and back to `<body>` when it hides (`dom.mts` holds the element, so a dialog's removal never takes it).
- The Missing items dialog's rows are wired with the record the dialog drew, since the server no longer has those items.

## Item names

Every screen shows `item.name` (issue #181), which the fold sets from `vault-lib.mts`'s `displayName`. It is the in-game name, except for a Scroll of Transcendence: that is named by the skill and points on its tooltip ("Scroll of Transcendence (Animal Lore - 0.1 Pts)"), so its rows, groups and name sort tell the skills apart.

The in-game name stays the tooltip's first line (`lines[0]`, read by `gameName`). The item tooltip (`tipNode`) shows it muted under the title, as "In game: <name>", whenever it differs from the shown name.

- **Classify this…** names the in-game name in its "every item named" scope.
- **The fold** looks up a name override by the shown name, then the in-game name, then the graphic.
- **Organize** sends the bridge the in-game name for an item whose shown name is longer than a trip allows.
- **The search** also matches the name with its punctuation read as spaces ("transcendence animal lore").
- **Every name sort** goes through `vault-lib.mts`'s `compareNames`, which compares numbers by value: the Inventory's, the Containers view's missing list, the House map's pins and callouts.

## Classify this…

**Classify this…** (`ui/kinds.mts`, issue #150) is in a row's ⋯ menu, for an item that is neither gear nor a scanned container. It opens a dialog with:

- the kind (every kind but gear and container, which Organize never moves);
- whether it applies to every item with this name (the default) or with this graphic;
- **Reset to automatic**, when one of the player's kinds applies. It takes away the entry the dialog names: the name's when there is one, else the graphic's.

It saves through `POST /api/item-kinds` and runs `reload()`, so the table, the Kind filter and the Organize plan follow at once.

- **Organize's catch-all row**, and the ⋯ menu of Auto organize's Other rule, have **Review unclassified items**: the Inventory filtered to kind `other` (`showKind`).
- **Settings › Data** has **Item kinds you set**:
  - Export… downloads `item-kinds.json`, through a Save dialog in Electron and the browser's download elsewhere;
  - Import… takes a file input, and `POST /api/item-kinds/import` merges it in. The toast says what it left out.

## Containers view

`ui/containers.mts`: one row per root container, grouped by character with the ground last, with a Fill column and a ⋯ menu (Show these items, Label…, Blacklist…, Forget…).

### Missing items

A root with items missing since its last scan (issue #99) shows an "N missing" warn tag after its name, and gets **Show missing items**. That opens a dialog listing each item's name, amount (a stack that shrank in place reads "N fewer") and when it was last seen there, sorted by name, fetched from `GET /api/missing?root=`. `GET /api/inventory` carries only the counts (`missingCounts`).

The server computes them beside the fold in `app/missing.mts`: a root's previous scan against its latest, less two things:

- anything the fold still has somewhere else (moved to another scanned container, or worn);
- what a vanished stack could have been merged into: the whole amount of each same graphic, hue and name stack seen elsewhere since the previous scan, and what one in the root grew by. Organize drops items onto matching stacks, and only the receiving stack's serial lives on.

Only the shortfall is reported, as "N fewer", so a sale can be under-reported while more of that kind is kept elsewhere. A merge is never reported.

## Scrolls view

`ui/scrolls.mts` (issue #181) is the Inventory's third view: power scrolls and Scrolls of Transcendence per skill, against the shard's Scroll Binder recipes (the rules' `scrollBinder`, `docs/shard-rules.md`). Every number comes from `ui/scrolls-model.mts` (no DOM, tested by `app/scrolls-model.test.mts`).

### Loading

The scrolls are three `GET /api/items` queries: power scrolls by `prop=psLevel:1`, Scrolls of Transcendence by `prop=sotPoints:0.1`, and `q=scroll binder`. They are fetched when the view shows, and again after a reload; the page holds no item list it could use instead. A refetch that fails while earlier scrolls are shown says so above the table, so they read as out of date.

### Layout

At the top: a toolbar with a skill filter ("/" focuses it) and Power scrolls | Scrolls of Transcendence with their counts, then a line of facts. For example: "95 power scrolls across 31 skills · 28 Scrolls of Transcendence across 15 skills · 1 empty Scroll Binder · Nothing is ready to bind yet". A skill ready in both tabs counts once.

Then comes one table per tab, in the Items view's card. The facts line is a live region, redrawn only when its words change, so typing in the filter does not announce it again.

### Power scrolls

The columns:

- **Skill.**
- **A count per level**, 105 to 120 (blank for none). Each count links to the Items view searching for exactly those scrolls (`powerQuery`: "scroll of provocation (110 skill)"), which in Grouped mode is their one grouped row.
- **Next roll-up:** the step needing the fewest more, the higher tier on a tie ("110 → 115: 5 of 12", with a meter labeled in words, "7 more").
- **Bind everything**, shown only when some skill can bind now and the detail is closed: what binding every full set would leave, each binding counting toward the level above before it binds ("1 × 115, 4 × 110"). It is blank on a row that binds nothing.

Rows sort by fewest more needed, then the higher tier, then name. A row that can bind now has a Ready badge and a green edge.

### Scrolls of Transcendence

The columns:

- **Skill.**
- **The scrolls' points, as chips.** Equal points share one chip ("18 × 0.3"), and a long row wraps in its cell. They are hidden while the detail is open.
- **Total.**
- **Progress:** a meter against the usable totals, with 2.0 marked and 5.0 at its end. Its value is held at 5.0 past it, and its `aria-valuetext` is the real total ("5.4 points").
- **Binder plan:**
  - the fewest scrolls adding up to exactly 5.0 when they can, else exactly 2.0 ("Bind 1.0 + 0.6 + 0.4 → 2.0");
  - with neither, and 5.0 or more in all, the set that goes past 5.0 least, then with the fewest scrolls, saying what is lost ("Bind 17 × 0.3 → 5.0 (0.1 lost)"; equal scrolls are written as a count);
  - else, how far short of the next usable total ("0.4 short of 2.0").

  Points are whole tenths, never floats.

A warning above the table spells out the binder's trap: past 2.0 it locks until 5.0, and anything above 5.0 is lost. The footers give the recipe and the order. Sorted columns carry `aria-sort` and an arrow; the order is fixed, so the headers are not buttons.

### Without binder recipes, or without scrolls

A shard without `scrollBinder` gets the plain holdings, with no roll-up, plan, warning or binder facts:

- power scrolls: Skill, the level counts, Total and Where (the places by name), sorted by skill;
- Transcendence: Skill, Scrolls, Total and Where.

With no scrolls at all, the table says "No power scrolls or Scrolls of Transcendence in your scans."

### Empty Scroll Binders and stat scrolls

**Empty Scroll Binders** are counted in the facts: a binder whose tooltip has nothing past its name but its weight and state lines (Blessed, Insured, a tag). A partly filled binder is ignored, in that count and in the roll-ups, until a scan shows how its tooltip says what it holds. Stat scrolls are not shown: no scan has shown how the shard names them.

### Detail

A row click, Enter or Space opens a panel in the item peek's look (`#scr-peek`, laid over the table below 1180 px). It shows:

- the skill, with ↑ / ↓ / close;
- how many scrolls are in how many containers;
- the roll-up (Next roll-up, Still needed, Bind everything when something binds, a meter), or the binder plan;
- the scrolls grouped by place: the place's name and serial, and who scanned it ("On the ground · scanned by Kestrel"). Each row is a level or points badge, the name and its tags, wired with `itemTip`.

Its footer has **Show in Inventory**, the Items view searching for all that skill's scrolls. ↑/↓ on a row move focus and, while the panel is open, the panel follows. Esc closes it and gives the row its focus back.

## Unravel view

`ui/unravel.mts` (issue #271, `#/unravel`) is the Inventory's fourth view: which pieces to unravel at a soul forge, and what they would give. Every number comes from `app/unravel.mts` (no DOM, tested by `app/unravel.test.mts`), with the shard rules' `unravel` thresholds (`docs/shard-rules.md`).

### Loading

The candidates are one `GET /api/items?unravel=1&unravelShow=all&sort=unravel` query. The server works out each piece's imbuing weight, the ingredient it gives, and why it is left out by default (`unravel.leftOut`).

What is on hand comes from three more queries, `q=` each ingredient's name, summed by `onHand`, which also reads a count at the start of a name ("205 Enchanted Essence").

All four are fetched again after a reload. The candidates are also fetched again after a saved Organize setup (its pins), or a saved or removed Suit Builder run (`builderchange` with key `runs`; while the view is hidden, on its next showing).

### Unraveled by

**Unraveled by** is a select of the scanned characters with their Imbuing from the latest scan, the highest first and picked by default.

### Forecast

The forecast is three cards: Relic Fragment, Enchanted Essence and Magical Residue. Each card shows:

- the expected total over every candidate shown, at that skill (`expectedYield`: a roll's chance times the average amount, its miss counted in the ingredient below, nothing while the forge refuses);
- how many pieces give it;
- how many are on hand.

Below the Relic gate, the Relic card reads "0 now" and says how many pieces are held, and about how many Relics they would give at the gate and at 100. Below the Essence gate, the Essence card reads "0 now" with its pieces held for that gate, and the Residue card no longer counts Essence misses.

### Left out

One line: "N pieces left out: worn, in a saved build, insured, pinned, imbued, blessed or kept.", naming only the reasons still left out. Its **Change** button (Done when open) shows a toggle chip per reason with its count: Worn, In a saved build, Insured, Organize pins, Imbued, Blessed, Kept. Pressed means left out, and every one is pressed by default. The choice lasts while the page is open.

### Groups and rows

The groups are:

- Relic Fragment (at or above the gate);
- **Wait for Imbuing 95**: Relic-tier pieces the forge refuses below it;
- Enchanted Essence;
- Magical Residue.

Each has a count, a line and **Select these**, with the rows heaviest first.

A row has:

- a checkbox;
- the name (with the item tooltip), its rarity tier, and the reasons it would be left out;
- its place;
- the ingredient, with a **maybe** tag when its weight is within the margin of a line (its title names the two ingredients);
- the chance line ("50% at 70, else Residue", "Refused until then (now 70)", "Always at Imbuing 45+");
- **Keep** (**Unkeep** on a kept piece).

A click on the row toggles its checkbox. **Keep** writes the whole list to settings.json's `unravelKeep` through `PUT /api/settings`, so it survives rescans. A kept piece leaves the list until the Kept chip shows it again, with Unkeep.

### Selection bar

The selection bar shows while something is selected, sticky above the list. It holds:

- the count, and how many of each group;
- **Keep**;
- **Grab**: `bridge.mts`'s `grabAll` into the picked character's backpack, asking first when the bridge runs on another character;
- **Clear**.

The selection is the Items view's model (`ui/move-model.mts`, issue #270):

- shift-click ticks every row from the last one clicked, in the order drawn. A redraw, such as another character picked or a chip toggled, starts the range afresh;
- a worn piece's checkbox is disabled ("Worn: take it off first"), and Select these skips worn pieces, naming them;
- Grab takes at most 20 pieces.

### Gather into a bag

**Gather into a bag…** (issue #271) moves the selected pieces, loose, into one bag through Move to, with no mover of its own. Its dialog offers:

- **The bag this character gathered into last time** (settings.json's `unravelBag`, by character, written whole through `PUT /api/settings`). An entry a hand edit left that is not a serial is ignored, and dropped on the next write. Beside it is what `POST /api/move/plan` says about it ("Bag will hold 6/125 items after this", or why it can't be filled, in which case it is disabled).
- **Another container…**, which opens Move to's picker (`move-to.mts` `openPicker`, so only containers a trip can fill are offered) and remembers the one picked.

A callout says:

- the pieces go in loose, because Unravel Container only reaches the bag's top level;
- their total weight, from their tooltips (`ui/unravel-model.mts`);
- Move to fills only a container on the ground or a bag in one, not a bag in a backpack or bank, so the bag is taken into the backpack at the forge;
- which pieces stay where they are and why (`leftText` over the plan's `left` counts, by reason), and why no trip can run now.

The button reads "Gather 3 pieces" ("Gather the N that fit") or "Pick a container…". The move runs through `move-to.mts` `startMove`, with its result line drawn in the Unravel view (`#unr-move-result`): "Moved 3 pieces into Bag." and "At a soul forge, use Unravel Container on it.", with Stop, Pin them here and Move back as for any move. Starting it clears the selection.

### Layout

- **Narrow windows:** at 720 px and below, a row stacks its place and ingredient under the name, and the Inventory's top bar wraps its view switch and Import scans onto a second line.
- **Scrolling (issue #332):** the top of the view (the picker, the forecast, the left-out line, Gather's result line and the selection bar) stays put, and only the list scrolls, in its own box inside the card. At 720 px and below, or on a window 640 px tall or less, that top would take about half the screen, so the whole view scrolls instead, and the selection bar sticks to the top of the card.
- **Folding:** each group's heading is a button (`aria-expanded`, `aria-controls` its rows) that folds the group. A folded group draws no rows, its chevron turns, and its heading shows the count. Select these still takes its pieces.
- **Full rows | Condensed**, beside the left-out line, picks one-line rows: name, rarity, ingredient and chance on one line, with the place and the chance in the row's `title`. At 720 px and below, the row drops the rarity and the chance to stay one line.

The folded groups (`unravelCollapsed`: relic, held, essence, residue) and the rows (`unravelRows`: full or condensed) are ui-prefs fields, set at load by `applyUnravelPrefs`.

## Container art

A container whose scan recorded its graphic shows its in-game art at 24 px (issue #174; `ui/item-art.mts` `containerArt`, from `GET /api/item-art`, with the hue). It appears:

- before the name in the Containers view, with its label's color swatch in the tile's corner;
- before an item's place in the Location column and the item peek. That is the art of the container the item sits in directly; a worn piece has none.

The line grows to 24 px for it, and the name keeps its place beside it. A container scanned before the adapters recorded a graphic, or with no UO folder or no art, shows as before.
