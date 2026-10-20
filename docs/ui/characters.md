# Characters and the shared character sheet

Part of the UI docs: [`docs/ui.md`](../ui.md) has the hard rules, tokens, components and the dependency rules every screen follows.

## Code

### Where each part lives

| Module | What it draws and does |
| --- | --- |
| `ui/characters.mts` | The screen (`registerScreen` as "characters"): the roster at `#/characters`, a character's page at `#/characters/<Name>`, the ⋯ menus, Forget, and the build label's edit box |
| `ui/roster.mts` | Pure: the roster's rows, filter and sort (`rosterView`), the sheet page's summary line (`sheetMeta`) |
| `ui/sheet.mts` | The sheet component `sheetNode`, shared with the Suit Builder result, and its pure formatters; `SHEET_GROUPS` and `SLOT_GROUPS` |
| `ui/profiles.mts` | The profiles data module: `setCharacterLabel` writes a build label as one `PATCH /api/profiles` edit |
| `ui/characters.css` | The roster and the sheet, laid out with container queries |

### State, events and routes

- The screen draws from the inventory in `state.inv` and redraws on `inventorychange`.
- A build label is written through `profiles.mts` (`PATCH /api/profiles`, a `setLabel` edit), never by saving the whole profiles file.
- Forget calls `POST /api/forget-character` behind `confirmDialog`.
- Other screens open a character's items through `nav.mts`'s `showCharacterItems`, and a piece through `showItem`.

### Tests

- `app/ui-characters.test.mts`: `rosterView`, `sheetMeta` and the sheet's formatters. `app/ui-render.test.mts` builds the sheet's DOM. `app/ui-profiles.test.mts` covers the profile saves.
- Electron: `scripts/ui-state.test.mts` (the roster and the sheet) and `scripts/ui-labels.test.mts` (build labels).

### How to extend it

- **A roster column or sort:** add it to `rosterView` with its test, then draw it in `characters.mts`.
- **A figure on the sheet:** put the maths in a pure formatter in `sheet.mts`, exported and tested in `app/ui-characters.test.mts`, then draw it in `sheetNode`. Both the Characters screen and the Suit Builder result get it, so check the "now → after" variant too.

## The roster (`#/characters`)

`#/characters` is the roster: one 48 px row per character. Each row has:

- **The name**, with a warning badge beside it ("2 low") when any worn piece is low on durability. The badge's accessible name and tooltip are its sentence, "2 worn pieces are low on durability". The badge sits in the sticky Character column, so the warning stays in view however far the table scrolls.
- **Under the name, its build label** (issue #336) with Edit, or "No build label" with Add label. A build label is the player's own name for the build, such as "Main Crafter", stored as a `label` on the character's `profiles.json` entry; `build-spec.mts`'s `characterLabel` reads it trimmed.
  - Edit or Add label opens a box in place (`#char-label-input`, "Build label for <Name>") with Save. ↵ saves, Esc puts it back, and a blank Save removes the label. The focus then returns to the line's button.
  - `profiles.mts`'s `setCharacterLabel` writes it as a `setLabel` edit (`PATCH /api/profiles`, `app/profile-edits.mts`), which changes only that label in the file on the server, so a page holding an older copy never drops or reverts one. A character with no saved settings gets the ones the Suit Builder shows it, as a buff toggle does.
  - A label is at most 40 characters on one line, with no control characters (`labelError`, and the schema's pattern).
- **The rest of the row:** last scan, STR · DEX · INT, Hits · Stam · Mana, the five paperdoll resists with a meter to the cap, pieces worn, "Build suit" and a ⋯ menu.

The top-bar search filters the rows by names and build labels, and the header buttons sort them.

## A character's page (`#/characters/<Name>`)

`#/characters/<Name>` is that character's sheet. Above it are a breadcrumb, previous/next, "Show <Name>'s items", "Build a suit" and a ⋯ menu, then one summary line from `roster.mts`'s `sheetMeta`: "Scanned 7 h ago · 11 pieces worn · opened 37 containers". The last part is left out when there are none, and no serials are shown. `parseRoute()` returns the sheet's name as `sheet` (the builder's `character` is untouched).

The summary line's last part links to `#/containers/<Name>`. That is the Containers view listing only the root containers that character's scans opened, their backpack and bank aside (`openedRoots`, the same list the line counts; `parseRoute()`'s `scanner`), with a Show all link in its footer.

The ⋯ menus are `menu(anchor, items, {label})` from `components.mts`: a popover with `role=menu`, with ↑/↓/Home/End moving between the items. Forget is a danger item, and it goes through `confirmDialog`. "Show <Name>'s items" opens the Inventory with its Character filter set to that character (`showCharacterItems`).

## The sheet component

The sheet itself is one themed component, `sheetNode(name, before, after, opts?)` in `ui/sheet.mts`, used by the Characters screen and the Suit Builder result:

- `before`: the suit to show, a `SheetAssignment` (`Record<string, SheetItem>` keyed by slot or serial; a `SheetItem` is `{serial, name, slot, props, rarity?, tags?, extras?, graphic?, hue?}`, which both a scanned `Item` and an optimizer `OptItem` satisfy). `wornSet(name)` gives the character's worn set in this shape.
- `after`: `null` for the one-suit sheet; a second assignment for the "now → after" variant, where every figure that moves reads "18 → 22" (the after number in success or danger color), the gear list shows the `after` suit with its new pieces badged "New", and the footnote adds the Hits/Stamina/Mana estimate note. Worn pieces `before` leaves out (those a run saved with twelve slots never planned, or no slot holds) count on both sides; a piece in `before` counts once.
- `opts.onSlot(item, tile)`: called when a piece in the gear list is pressed; with or without it the pieces carry the page's item tooltip (`itemTip`), on hover and keyboard focus. The Characters screen opens the piece's tooltip (the same `tipNode` as the hover tooltip) in an always-dark popover (`.item-pop`), with "Open in Inventory", which shows the piece in the Inventory's item peek (`inventory.mts`'s `showItem`); the hover tooltip stays away from the piece while it is open.
- `opts.doll(set)`: the sheet's paperdoll, given the suit the gear list shows (`after` when there is one) with the worn extras; the node is drawn beside the worn gear. The Characters screen and the Suit Builder's Full sheet both pass `ui/sheet-doll.mts`'s `sheetDoll` (one doll card per screen and character, kept between redraws; an optimizer piece's graphic and hue are looked up by serial through `resolveItems` before the figure is drawn); without it the gear list fills the row.

`sheetNode` returns a `div.sheet` (with `data-character`).

### The KPI row

Seven tiles: the five resists as value / cap, with a meter and a "cap +N" badge when the raw sum passes the cap, then Attributes with the gear bonus split, and Pools.

### Worn gear and Properties

Then comes a row (layout 1B, issue #57): the paperdoll on the left, 420 px wide, and the worn gear filling the rest at the doll's height, then the Properties card under them.

- **Paperdoll:** the doll card (`app/ui/doll-card.mts`) drawing the character's look in the shown suit (`wornPieces` turns each piece's `graphic` and `hue` into what the renderer draws): what they wear on the Characters screen, the new suit on the Suit Builder's Full sheet.
- **Worn gear:** a table with one row per filled slot, in the slot groups' order (Armor, Weapons and jewelry, Clothing, the Kilt / Skirt only while one is worn, issue #202), then anything else as Other. Each row is the slot and the piece: its name in its rarity's color (the tier's `--rarity-*` token, as Manual's slot cards and the tooltip title; no color for a tier without one), a "New" badge, its quality tags (antique, brittle, cursed, prized, blessed) and the low-durability tag. The list scrolls inside the row when it is longer than the doll; "Nothing worn." when no slot is filled.
- **Properties:**
  - the chosen properties, as key/value lists with the shard cap muted, in Casting, Combat, Leech, Regeneration, Pools and other, and Other;
  - the card's "Properties shown" popover picks them from every property the tooltip reader knows. The choice is saved as the ui-prefs `sheetProps`, default `SHEET_GROUPS`;
  - the skills, or an info message when the scan has none;
  - the footnote: the resist cap, the Resisting Spells minimum, and each resist the minimum holds up ("Fire 44: the Resisting Spells minimum.").

### Layout

The sheet lays itself out from its own width with container queries (`ui/characters.css`): below 1040 px the attributes and pools drop under the resists, and below 960 px the gear list goes under the doll, at most 480 px tall. So it fits whatever column it is put in. `resistFigures(name, set)` is the resist maths the roster shares with it.

### Low durability

The one-suit sheet tags a worn piece that is low on durability ("Low durability 12/255") in its gear-list row. A piece is low at 20% of its max or 10 points (`lowDurability`). A piece is never low when its max is 0, when it has no durability line, or when it is at or past its max.

The Characters sheet page puts a one-line warning under the meta line ("2 worn pieces are low on durability"). Nothing shows when nothing is low. The now → after sheet shows no tag, since an optimizer piece carries no durability.

The pure formatters (`capBadgeText`, `atCap`, `bonusBreakdown`, `moveText`, `tagTone`, `lowDurability`, `lowDurabilityCount`, `lowDurabilitySummary`) are exported and unit-tested in `app/ui-characters.test.mts`, with the counts worded by `format.mts`'s `plural`.
