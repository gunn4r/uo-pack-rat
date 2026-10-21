# House map

Part of the UI docs: [`docs/ui.md`](../ui.md) has the hard rules, tokens, components and the dependency rules every screen follows.

## Code

### Where each part lives

| Module | What it draws and does |
| --- | --- |
| `ui/house-map.mts` | The screen at `#/map` and `#/map/<house id>` (`showMap`): the panes, the SVG, areas and drawing, search, the Stack plan, the contents drawer, `applyMapPrefs` |
| `ui/house-map-model.mts` | Pure: every rule and number on the screen: projection, painter's order, bounds and fit, colors, areas, pills, callouts, the Stack plan, the drawer's width |
| `ui/houses-data.mts` | The data module: the houses, the names and areas, each house's model kept by id and capture stamp (`housesData`, with an injectable fetch) |
| `ui/house-links.mts` | The one index of which house holds each container, for Show on map and the search's elsewhere note |
| `ui/world-map.mts`, `ui/world-map-model.mts` | The world map lightbox, and its pure view rules (`zoomView`, `panView`) |
| `ui/house-map.css` | The screen's stylesheet |

It also uses the Inventory's item pieces (`item-parts.mts`, `peek.mts`'s `propertyLines`) and container art (`item-art.mts`).

### State, events and routes

- **Events:** the screen redraws on:
  - `inventorychange` (models and contents fetched again as needed);
  - `organizechange` (labels and their colors);
  - `bridgechange` (the drawer's row actions);
  - `themechange` (the pills are fitted again).
- **Routes:**
  - `GET /api/houses` and `GET /api/houses/<id>`: the list and each model;
  - `GET /api/house-map`, and `PUT /api/house-map/<id>`: names and areas, one house's entry at a time, its saves queued one after another;
  - `DELETE /api/house-claims/<id>`;
  - `GET /api/items`: search hits and a container's contents;
  - `GET /api/facet-map/<facet>.png` and `GET /api/item-art`.
- **Preferences:** `areaLabels` and `mapDrawerWidth` are ui-prefs fields, applied at load by `applyMapPrefs`.

### Tests

- **Pure:** `app/ui-map.test.mts` (`house-map-model.mts`), `app/ui-world-map.test.mts`, `app/houses-data.test.mts`. `app/theme.test.mts` checks the area and map color tokens.
- **Electron:** `scripts/ui-map.test.mts`. `SCREENS` maps `house-map`, `house-map-model`, `world-map`, `world-map-model` and `houses-data` to it, and `house-links` to it and `scripts/ui-state.test.mts`.
- **Server side:** the model is built and tested outside the page (`app/house-server.test.mts` and the house-capture tests).

### How to extend it

- **A rule or number on the map:** a pure function in `house-map-model.mts` with its test in `app/ui-map.test.mts`; `house-map.mts` only draws what it returns.
- **A new field in a house's entry:** it travels in the whole entry through `PUT /api/house-map/<id>`. Queue its save with the others, so a save made meanwhile is never undone.
- **A new color:** a token set in both modes of both theme families, which `app/theme.test.mts` checks.

## The map

### Panes and top bar

The House map (`#/map`, issue #10) draws each house a scan captured, one level at a time, from `GET /api/houses` and each house's model (`GET /api/houses/<id>`). Both go through `ui/houses-data.mts`, which keeps each model by house id and capture stamp until a new inventory or other tiledata, so coming back to the map fetches only the list, the names and the models that changed.

There are three panes, and one column below 1100 px:

- **Left:** the levels with their status, and the player's own areas with container counts (280 px, its rows spaced `--space-1` apart with `--space-2` padding). An area zooms the map to it.
- **Middle:** the map.
- **Right:** the details, and a container's contents beside them, below.

The top bar holds the house picker, Game angle | Top-down | Stack plan, Contents | Free space, and a pill per level. The picker shows the deep-linked house. A link to a house that no longer exists falls back to the last house shown, else to the house with the most containers.

### The model and the drawing

Every rule and number comes from `ui/house-map-model.mts` (no DOM, tested by `app/ui-map.test.mts`):

- the projection (`screenX = (x − y)·W/2`, `screenY = (x + y)·W/2 − z·K`), the painter's order, and bounds and fit;
- the joins of a stack with the inventory and the Organize labels;
- the color modes, the cut-away, callouts, totals and the plain grid.

`ui/house-map.mts` builds the SVG with `createElementNS`, once per level, view, mode or data change. Pan (drag), zoom (the wheel, or the zoom in and zoom out buttons) and fit (the Fit the level button) change only the `viewBox`.

### Hover, focus and the keyboard

Hovering or focusing a stack shows an HTML callout at a fixed size and fades the stacks in front of it, which also stop taking the pointer.

- Stacks are one tab stop (roving tabindex, in code order).
- The arrow keys move to the nearest stack that way; one outside the view is brought to its middle.
- Enter selects, and Esc clears.
- A redraw (a level, an area, a crumb, a reload) keeps the keyboard focus on the same control, or, when it is gone, on the nearest stand-in. Back to the house, or Esc from the panel, returns it to the stack.

Every container is `role="img"`, with "<code> <name>, <fill>" as its name.

### Colors

Floors take `--color-map-<family>` from their material. Containers take their Organize label color through `safeColor` (always with a `--color-border-strong` edge), or a `--color-map-*` token. Every `--color-map-*` token is set in both modes of both theme families.

### Missing tiledata, unopened containers and the plain grid

- **Without a `tiledata.mul`** the house is still drawn, in neutral colors, under a note naming the reason, with a link to Settings › UO folder (house map).
- **A container a capture saw but no scan opened** is drawn dashed and listed as not opened yet. Highlight finds it by the place the capture saw it; Label… and Show items wait for a scan that opens it.
- **Ground containers outside every drawn house** are drawn on a plain grid, grouped by facet and distance.

## Areas

The model has no automatic rooms; its wall-aware regions stay inside it, for standing spots. The player draws the areas (issue #10). They are kept in the house's `house-map.json` entry (`areas`), saved with the whole entry by `PUT /api/house-map/<id>`.

### The list

Each level lists its areas in order. Each is:

- a `.map-area` button: a swatch in `--color-<color>`, the name and the container count. It zooms to the area and marks it `aria-pressed` and `.sel` on the map;
- ✎ (Rename <name>): a field like the house's. Enter or leaving it saves, and Esc cancels. A refused name keeps it open with the reason, and a redraw keeps the draft;
- ⋯, with three choices:
  - **Redraw.** It shows the new shape at once. If the save is refused, it puts the saved shape back and returns to drawing mode with the new one, so Enter tries again. A rename or delete under way is closed. An area deleted meanwhile is not saved again: the drawing is dropped, and the toast says so.
  - **Change color:** a popover of the eight colors, named Purple, Orange, Teal, Pink, Blue, Yellow, Green and Red (`AREA_COLOR_NAMES`).
  - **Delete,** which asks with `confirmDialog` ("Delete <name>?", where its containers go, with **Delete area** in danger). Cancel puts focus back on its ⋯. After a delete, focus goes to the next area's ⋯ on that level, else the one before, else + New area.

Then comes the rest of the level ("Everything else" once it has areas, else "Whole floor"), with a dashed swatch and its count, then **+ New area**.

A container belongs to the first area, in list order, whose rectangles hold its tile on its level (`areaOfStack`; counts from `levelAreas`).

### Areas of levels the house no longer has

An area saved for a level the house no longer has is left out of the list, the counts, the 32-area cap and the carry-over offer (`liveAreas`), but kept on disk. A save writes the edited list and then those hidden areas as they were (`withOrphans`), so a storey taken away in place and built again gets its areas back.

### Saving

Saves of the entry (a name, an area's name, color or shape, a new area, a delete) run one after another. Each is built when its turn comes, from the list as the one before left it, so a rename still being saved is never undone by a color change or a delete made meanwhile.

### Drawing an area

+ New area, or Redraw, starts drawing. + New area reads **Drawing…** meanwhile, and the other levels' + New area wait.

- A hint bar sits over the map: "Drag over tiles to draw the area. Shift-drag adds more. Enter to finish, Esc to cancel. Fit shows all." (Fit being the map's fit button), with a screen-reader-only line naming the keys.
- The cursor is a crosshair, and the map becomes a tab stop of its own (`role="application"`, focused) while stacks leave the tab order.
- A press and drag selects a tile rectangle: the pointer's point is taken back to a tile at the level's floor by `unproject`/`tileAt`, and kept 8 tiles off the house by `clampTile`. Shift adds one more, 16 at most.
- The left button no longer pans, and the wheel is off during a drag, but the middle button pans and the zoom buttons work.
- The rectangles show as their covered floor tiles tinted (`coveredCells`), under the walls and stacks, with their outline and the keyboard's cursor drawn over them, and a `.map-draw-size` pill ("w × h = n tiles", `sizeText`).

### The keyboard draws too

The arrow keys move a tile cursor the way they point on screen (`moveCursor`):

- top-down, one tile on the world axes;
- at the game angle, ← and → a whole tile sideways (x ∓ 1, y ± 1), and ↑ and ↓ half a tile up or down. The screen column switches within its pair, so two presses go straight, ↓ undoes ↑, and every tile is reachable.

Space starts a rectangle at the cursor and ends it (Shift+Space starts one that joins the others). Enter finishes, ending a rectangle under way. Esc cancels, with focus back on + New area, or on ⋯ for a redraw. Enter and Esc also work with focus elsewhere on the screen, except in a field.

A polite live region outside the panes (`#map-draw-live`) says each size and each rectangle count. It is emptied and refilled on the next frame, so the same words twice are read twice, and it says "Drawing canceled." when another level or a crumb ends drawing too.

A redraw saves at once. A new area asks its name in its row: "Name this area", its color, the field, "n tiles · m containers", Cancel and Save, with Save disabled while the field is empty. Enter saves, and Esc cancels. A new area waiting for its name keeps its row through a switch of level.

### On the map

Each area of the level shown is:

- a tint of its floor tiles (its color at 20%, through `color-mix`);
- a 1.5 px line along its union's outer edges (`outlineOf`, a non-scaling stroke);
- a `<title>` with its name (none while drawing).

Areas sit over the floors and under the walls and stacks, and a stack above an area still takes the click. Other levels' areas are not drawn.

### Name pills

Each piece of an area gets one pill. Rectangles that touch (4-neighbor) are one piece (`piecesOf`).

- **The layer:** the pills are in an HTML layer over the map (`#map-pills`, `pointer-events: none`), placed from the SVG's screen matrix again on every pan, zoom, resize and redraw. So a pill keeps its screen size at any zoom.
- **When it is worked out:** `pillsOf` runs once per redraw, and the fitted texts once per zoom, so a pan only moves the pills. They are fitted again when the fonts finish loading, and when the theme changes (`themechange` from `ui/theme.mts`).
- **Placement:** each pill is kept 8 px inside the map pane and clear of the zoom buttons, measured once it is in the page (`placePill`). One whose anchor is off the pane is hidden. A pill sits just above the middle of its piece's front corner tile, the one with the largest x + y (`frontCorner`; `pillsOf`).
- **Look:** 12 px text at weight 500, in `--color-text`, with a 1 px line in the area's color, on that color mixed 22% into the surface, `--radius-full` and `--shadow-chip`.
- **Long names:** a name too long for 92% of its piece's on-screen width is cut with "…" (`fitLabel`, measured on a canvas in the pill's font). It shows as a 10 px dot in the area's color when fewer than 3 characters would fit. Both carry the whole name in `title`.

These are lit, with the tint 12% stronger, the line 1.5 px thicker, and the pill showing the whole name, stronger, with a halo, over the others:

- the area under the pointer on the map (a stack standing in it counts, `areaOfStack`);
- its row in the left pane, when under the pointer or holding focus (`:focus-within`, its ✎ and ⋯ included);
- the area zoomed to.

### Hide area labels

**Hide area labels** is an icon button under Fit the level (`#map-labels`, one fixed name with `aria-pressed`, pressed while the labels are hidden). It hides every pill; tints, lines and hovering stay. The choice is the ui-prefs `areaLabels` ("show" or "hide"), applied at load (`applyMapPrefs`), so it survives a reload.

### Crumbs, the yard and the colors

- The yard tint reads a cell's `indoor` flag.
- The crumbs read house › level › area › stack. A stack in no area shows "Everything else" or "Whole floor" as text, and a stack's line in the panel and the drawer starts with its area.
- The plain grid's groups are read-only areas.
- The eight colors are `--color-area-1` … `--color-area-8`, set in both modes of both theme families. They are told apart from each other and from every floor color (`app/theme.test.mts`).

## Renaming a house

Renaming a house is issue #164. The ✎ inline after the panel's house heading (Rename house, so it follows the last word of a name that wraps) turns the heading into a name field.

- Enter, or leaving the field (not the window), saves through `PUT /api/house-map/<id>`, with the house's footprint. Esc cancels.
- A refused name keeps the field open with the server's reason under it, until a save or a cancel, and a redraw rebuilds the field with the draft and the reason.
- Focus goes back to the ✎. The picker (`<name> · <facet>, <w> × <h>, <n> containers`), the house crumb and the page title then use the name.

### Carrying over a name and areas

An unnamed house can overlap, on the same facet, a named house that is no longer captured (a redesign or a move gives a house a new id). It then gets a one-line offer to use that name, and its areas when it had some (only the rectangles still on this house). The offer reads "Use the name and areas of …", or "Use the areas …" for an earlier house with areas and no name (`carryOver` and `carryOverText` in `ui/house-map-model.mts`). It is made only while this house has neither a name nor areas of its own.

## Where the house is

### The location line

The Location section (issue #164) is headed "Location - <facet> - <x> <y>" (`whereTitle`). It starts with one line: the plot's center tile (the front steps left out, as in the size) and its facet, "<x>, <y> · <facet>" (`whereOf`). A copy button copies that line (`copyText`); when the clipboard refuses, the line is selected and a toast says to press ⌘C. No sextant reading and no corners are shown.

### The overview crop

Under it, the section shows 600 × 450 tiles of the facet's overview around the house (`cropAround`, slid inside the facet).

- **Fetching:** the crop is fetched once from `GET /api/facet-map/<facet>.png?x0&y0&x1&y1&w=600` and shown as a `data:` URL. The page's CSP allows `data:` images, not `blob:`. So the same request gives either the region the server drew (`x-region`, slid inside the facet when the crop reached past it; `parseRegion`), or the 404's reason.
- **The overlay:** an SVG overlay in that region's tiles (`preserveAspectRatio="none"` over an image of the crop's aspect).
  - A `--color-map-marker` dot marks the house (`role="img"`).
  - A smaller `--color-map-marker-other` dot marks every other captured house of the facet inside the crop. Each is an SVG `<a href="#/map/<id>">` named by the house (its name, else its coordinates), so a click, or Tab and Enter, opens its map.
- **Marker radii** are screen pixels turned into crop tiles from the frame's width (`markerRadii`, kept by a ResizeObserver): a 24 px target per link, and a two-tone focus ring (dark under light) that shows on pale and dark ground.

A crop was chosen over the whole facet plus an inset: it is one image, legible at the panel's width, and Felucca's 7168-tile width would make the house a speck.

### When there is no image

When there is no image, a muted line in its place says why (`facetMapNote`). A UO folder set in Settings that is gone reads like tiledata's. The heading and the coordinates stay. With no facet known, the section is the heading and the coordinates alone.

Each facet's size is `FACET_SIZE` in `ui/house-map-model.mts`. The marker tokens are the same in both modes, since the map under them is the game's own.

## The world map lightbox

The lightbox is `ui/world-map.mts`, with its rules in `ui/world-map-model.mts`.

### Opening and closing

The small map is an `<img role="button" id="map-where-open">` (Open the world map; click, Enter or Space). The SVG overlay lets the pointer through, except its links. It opens `openDialog` with `cls: "world-map-dialog"`, the window less 24 px a side. Esc, the Close button and a click on the backdrop close it, and focus goes back to the small map.

### The view

The view is a box of world tiles shaped like the viewport (`fit`).

- **Start:** it shows the whole facet, fitted in its middle.
- **Zoom:** between that and 2 screen px per tile (`zoomView`). The wheel zooms about the pointer, and a pinch arrives as a wheel with ctrlKey. The +/− buttons and the + / - / 0 keys zoom about the house, while it is in view.
- **Pan:** a drag, or the arrow keys (Shift for bigger steps). These keys work wherever focus is in the lightbox, a zoom button included.
- **Clamping:** the facet never leaves the view (`clampView`).

The zoom buttons' tooltips name their keys. A marker that scrolls out of view while it has focus hands the focus to the map first.

### Images

A base image of the whole facet is fetched once, at the dialog's size. A region of 8192 × 8192 tiles comes back cut to the facet, and its `x-region` gives the facet's real size.

When the view is sharper than the base, the visible tiles are fetched 150 ms after the view settles (`overlayRequest`: whole tiles, at screen resolution times the device pixel ratio, at most 2048 a side). Older answers are dropped by a request id. Each answer is laid over the base at the `x-region` it came back with, and the stretched base shows meanwhile.

### Markers

Every captured house of the facet has an HTML marker of a fixed 24 px (`worldMarkers`):

- the house shown is a labeled `role="img"`;
- another house is an `<a href="#/map/<id>">` that closes the lightbox and opens its map. A drag that starts on it opens nothing.

A marker is labeled once zoomed to 0.5 px per tile, and only where its label does not overlap one already placed.

## Claimed houses

The map shows only the houses the player claimed (issue #299, `<data>/house-claims.json`). `GET /api/houses` serves a house whose bounds overlap a claim on its facet, so one customized since it was claimed still shows.

- **Claiming:** a claim is made in game, standing in the house, with the Pack Rat panel's **Claim this house**. The houses already named or given areas were claimed by the app at its first start with claims. A house captured but never claimed is hidden, not deleted.
- **With no claimed house**, the empty state says "Stand inside your house in game and press Claim this house in the Pack Rat panel.". The plain grid's note says its containers are not inside a house you claimed, with the same instruction.

### Unclaiming

The panel with nothing selected ends with **Unclaim this house** (`#map-unclaim`, not on the plain grid).

- It asks with `confirmDialog`: "Unclaim <name>?", with an unnamed house named by its facet and centre tile ("Unclaim the Trammel house at 1777, 2364?"), and **Unclaim house** in danger. Cancel puts focus back on it.
- Then it calls `DELETE /api/house-claims/<id>`, and every claim over the house goes.
- The map loads again on another house, with focus on the house picker. When the picker is disabled because one choice or none is left, focus goes to the screen's heading instead (`#h-map`, given `tabindex="-1"`).

The house stays out of `GET /api/houses` (and so out of the picker, the markers, Show on map and MCP) until it is claimed again in game. Its name and areas stay in `house-map.json`, and its containers stay in the Inventory.

This replaced issue #298's Remove this house. Its `forgotten` list in `house-map.json` is now read only at the first start with claims, to leave those houses unclaimed.

## Search

The search (issue #10) is the box at the top bar's right end (`#map-q`).

### The query

It finds items with the Inventory's own query: `GET /api/items?q=&fields=hits`, the same query answered with lean rows (`item-query.mts` `hitRow`), up to `HIT_LIMIT` a page, so one request is normal.

- It runs 150 ms after typing, as in the Inventory. Nothing is filtered in the page, and an item's tooltip fetches the whole record by serial.
- The query is in the route (`#/map/<house>?q=`), so a reload or a deep link keeps it, and switching houses keeps it.
- Each match counts for the container on the floor it is in, through any bags (`floorContainerOf`, `houseHits`).

### While the house has matches

- The box has a gold ring (`--color-highlight`, outside its own edge, which keeps 3:1) and an "N in M" count: items, by amount, in containers.
- Matching containers keep their color with a gold outline, and their stack stands on a gold base. Every other container is a pale ghost.
- The map zooms to the level's matching stacks when the query changes (`hitsView`, with room above them).
- Each matching stack gets a pinned callout: "Stack I · 1 of 4 match", then, per matching container, its code, name, place in the stack and the items found.
  - The callouts sit in one row above the stacks, in their left-to-right order, so leaders never cross. Stacks in one screen column put the higher one's card on the left, for the same reason.
  - There are at most three, with a "+N more stacks" chip (`calloutRow`).
  - They are an `aria-hidden` HTML layer (`#map-pins`), placed with the area pills (`paintPills`). A click on one selects its stack.
- The left pane counts matching containers per level and area (a gold "N of M" badge, "–" for none), and a level pill with matches shows how many.
- The panel, with nothing selected, lists the level's matches instead of the totals and Location: code, name, area · stack · place, the items with their tooltips, and **Show items** (a click on the name selects the stack). After them come the other levels with matches, and how many are outside the house, with a link to the same search in the Inventory.

A selected stack shows its own panel, with the map still highlighted.

### With no match in this house

Nothing is ghosted, and a note under the box says where the matches are instead:

- another house, as a link to its map with the query, followed by the container when only one there holds them ("200 in Keep · A1 Wooden Box");
- a backpack or bank, as text;
- or "No items match".

### Layout and announcements

The top bar wraps when it is too narrow for everything, so the level pills never sit behind the box. The count reserves its own width in the box, and the callouts let the pointer through while an area is being drawn.

The count is said through the screen's polite live region, and a matching stack's name adds "matches". Esc in the box clears it.

## Stack plan

The Stack plan (issue #10) is the View control's third option: a flat, text-first view built for dense rooms. It is not in the route (neither is Game angle | Top-down). It lasts until the screen loads again, and the drawing keeps its angle for the way back.

### The layout

The middle pane holds `#map-plan` instead of the SVG, so there are no zoom buttons, pan, area labels or callouts. It shows a line "Seen from above, north up. …" with "10 stacks · 28 containers" at its right, then a CSS grid of the level. With an area zoomed to, the grid holds only that area's tiles, and the breadcrumb's level goes back.

`house-map-model.mts` `stackPlan` works it out:

- `planTracks` makes a track of each column (and row) holding a stack, and squeezes each run of empty ones into one 26 px track (`--plan-gap`), captioned "7 tiles with nothing on them" (`gapText`), turned on its side for a column.
- Tile tracks are `minmax(168px, 1fr)` (`--plan-card`), so about five cards fit, and a wider plan scrolls inside the pane. Below 1100 px the plan grows with its cards and the page scrolls. It never scrolls sideways on the page.

Whatever the map would zoom to (a "Show on map" stack, or a new search's matches), the plan scrolls into view instead (`scrollPlan`: the stack's card, or the first matching card), leaving the zoom for the map when the view goes back. The "Plain colors" note is not shown there.

### Cards

Each tile with a stack is a card: "Stack C" and "4 containers" (`planHead`), then its containers, top first (`planRows`). Each container row has:

- its code (the column as wide as the card's longest code);
- its label, as a chip in the label's color;
- the in-game name;
- a fill bar with "41/125", out of the container's own maximum, or "Not opened yet" / "Fill unknown".

A tile in the plan with nothing on it is a dashed cell.

### Areas, levels and the plain grid

- An area holding a container is a tint and outline in its color behind its cards (a box per rectangle, clipped to the plan). Its name and container count sit on a pill at its top-left that zooms to it.
- The areas with no container are named under the plan ("The Yard: no containers.").
- A level with no stacks reads "No containers on this floor."
- The plain grid gets the same plan from its tile positions.
- Between 1100 and 1799 px the levels pane folds as it does for the drawer (`.map-page.plan`), and the area pills carry the areas. Below 1100 px the page stacks as usual.
- New area and ⋯ › Redraw are disabled there, titled "Switch to Game angle or Top-down to draw". Switching to the plan cancels a drawing or a new area waiting for its name, and a refused redraw does not go back to drawing.

### Selection and the keyboard

Selection, the panel and the drawer are the map's:

- a click on a card selects its stack, and a second click unselects it;
- a click on a container row selects it and opens that container in the drawer, whose closing gives focus back to the card;
- the selected card has the accent outline, and the focused card a focus outline drawn over it.

The cards are a list (`ol role="list"`, `display: contents` inside the grid, its items `role="listitem"`, with the squeezed tracks' captions among them in reading order). Each card is a list of its containers, named "Stack C, 4 containers, Loot Corner".

One card is the tab stop (roving). The arrow keys move to the nearest card that way on the plan's grid (the map's own `stackKeys`, which asks `planNeighbor` there and `nearestInDirection` on the map). Enter or Space selects, and Esc clears.

### While searching

- A matching card has a gold outline. Its matching rows have a gold bar on a light gold wash, and a line naming the items found (cut with …): gear items without icons, each in its rarity's color with its own item tooltip on hover (no tab stop: the cards keep their roving one). The wash is 10% gold, light enough for every rarity color. Its other rows are dimmed.
- Cards with no match fade.
- The pills count the matches ("3 of 27").
- The panel lists the matches, as on the map.

## Show on map

An Inventory item's ⋯ menu (after "Show everything in this container") and a Containers view row's ⋯ menu offer Show on map (issue #10), with the house's name as the hint. They offer it when the item's container on the floor stands in a drawn house or on the plain grid.

`ui/house-links.mts` knows which, and is the one such index (the search's elsewhere note reads it too). `GET /api/houses` lists each house's container serials, fetched with every inventory load and whenever the map fetches the houses, with no house model needed. Any other ground container with a place is on the plain grid (`houseIndex`).

It goes to `#/map/<house>?select=<serial>`: the map opens that house and level, with the stack selected and zoomed to, and nothing else. The route then keeps only the house.

## The contents drawer

A container row's **Show items** (issue #10) opens a fourth pane, `#map-drawer` (a labeled region, "Contents of <code> <name>"), instead of leaving for the Inventory.

### Layout

- **It never covers anything.** It is a column of its own after the panel, 400 px by default and resizable (see "Its width" below). It grows from no width (`.entering`, `--duration-slow`, none under reduced motion) while the map column narrows.
- **Between 1100 and 1799 px**, the 280 px levels pane folds away while the drawer is open (its width, padding and border shrink to nothing with the same transition, then it is hidden), so the map keeps some room. The top bar's level pills still switch levels, and the pane comes back when the drawer closes.
- **Below 1100 px**, in the one column, everything stacks, the drawer after the panel.
- **Closed**, the page is the three panes.

### Following the selection

- Another stack (a click, or Enter on a focused one) swaps the drawer to that stack's top opened container (`drawerChest`).
- Another container's Show items swaps it to that container.
- Clearing the selection (Esc, Back to the house, a level, an area) closes it.
- The container shown has an accent bar and `aria-current` in the panel.

### Header and container picker

The header holds:

- the code and name: the label's, else the in-game name;
- "In game: <name> · Stack X, N containers" (`drawerMeta`);
- ✕ (Close contents);
- the fill meter ("n of N slots", `slotsText`) and the summary ("n items · a loose, b in k containers", `contentsSummary`).

The container picker (`drawerPicker`) is one of two forms, since the segmented control is for 2 to 4 choices:

- up to four containers, as a `segmented` tab each, with the code over the name. A container not opened yet is disabled, titled "Not opened yet";
- for a taller stack, a compact select labeled **Container** (`#map-drawer-chest`), with an option per container (its code and name; one not opened yet is disabled and marked "Not opened yet").

Below the picker are:

- a filter on name, tooltip lines, rarity, kind and tags (`filterContents`, client-side, kept from container to container), by the core's text rule (`matchesItem` with just the text, as an Organize rule's text, #487);
- **Open in Inventory** (`showContainer`).

### Items

Items come from `GET /api/items?root=<serial>` in 500-row pages, each serial kept once. That is the route's existing `root` filter, which matches every bag inside the container. There is one fetch per container shown, and per rescan.

`contentsOf` builds the tree once per fetch (the filter only filters it). Items in a container cycle are shown loose.

- **Bags** come first, as `<details>` groups with their item count, nested inside nested. A closed bag stays closed through a redraw.
- **Items** follow. Each item is a button of two lines, built from the Inventory's pieces (`gearItem` for the icon, name and quantity, issue #504; `rarityEl`, `tagEls`, peek.mts's `propertyLines` and `RESISTS`). A bag's head names it with `gearItem` too, and the pins and the search panel name their matching pieces with it, without icons. Resist numbers on an item's second line are in the body face with tabular figures (mono is for identifiers).
- **Tooltips:** each item has its item tooltip on hover and focus, which shows whatever a cut line leaves out. Bags carry theirs too.
- **Clicking an item** opens the Inventory row's ⋯ menu (`itemMenu`). Its Open details, anywhere but the Inventory's own Items view, opens the Inventory with the item in the peek.

At a row's right end are the Inventory row's own actions, in a `data-no-tip` zone (`inventory.mts`'s `itemActions`: Highlight in game, Grab to backpack, Go to container, and More actions). They are gated by `bridgeActionReason`, with the same disabled reasons. They show on hover and focus, and are transparent but still in the tab order otherwise. The drawer redraws on `bridgechange`.

### Its width

A handle on the drawer's left edge drags it (`#map-drawer-grip`: `role="separator"`, vertical, "Resize contents", with `aria-valuenow`/`min`/`max`).

- **Keys:** ←/→ move the edge 16 px (64 with Shift; ← widens). Home and End go to the minimum and maximum. A double-click chooses 400 px again (saved as 400, shown as wide as the window allows).
- **Limits:** at least 320 px, and at most what leaves the map 360 px (`house-map-model.mts`'s `drawerMax`, `clampDrawer`, `drawerKey`).
- **Clamping:** the width is clamped before the drawer grows open, measured with nothing animating, so a width saved on a wider screen never squeezes the map for a frame. It is clamped again whenever the page changes size (a ResizeObserver on `#map-body`).
- **Saving:** the save waits for a 300 ms pause. The chosen width is the ui-prefs `mapDrawerWidth` (a whole number from 320 to 4000, applied at load by `applyMapPrefs`), and it reaches the layout as `--drawer-w` on `#map-body`.

The map keeps its viewBox (the SVG scales it into the narrower pane, so the house never leaves the view), and its pills follow through their ResizeObserver. Below 1100 px the drawer stacks and has no handle.

### Rescans and focus

- A new scan fetches the container again, and keeps the tab, the filter, the closed bags and the scroll.
- Esc anywhere inside closes the drawer. Closing puts focus back on the Show items that opened it, else on the selected stack.
- A redraw keeps focus on the same drawer control (every one has an id).
- Tab order is the panel, then the drawer.

## Container art

Each row of a selected stack in the panel starts with the container's in-game art (issue #174; `ui/item-art.mts` `artTile`): a 32 px tile from `GET /api/item-art/<graphic>.png?hue=<n>`. The graphic and hue are its scan record's, else what a house capture saw (the model's `graphics` and `hues`, by serial). `chestViews` falls back to the inventory's record, which covers the plain grid. The contents drawer's header shows the container's art at 32 px before its code and name.

The server reads the art from the same UO folder as `tiledata.mul` (`artLegacyMUL.uop` and `hues.mul`, `app/art.mts`), cuts it to its opaque box, and never stores it.

- **Size:** the art is scaled down to fit the tile, or drawn twice its size with `image-rendering: pixelated` when that still fits (a pouch or a bag).
- **The swatch:** the row's color swatch sits in the tile's bottom-right corner.
- **Backing:** in dark mode the tile is `--color-art-backing`, a light wash, so black metal and near-black hues keep their outline. In light mode it is transparent.
- **No art:** a container no capture listed, or one whose art does not load, shows the swatch alone, as before. That covers no UO folder, no art file, and no art for the graphic (the 404's reason). A URL that failed is not asked again while the page stays open, so no broken image ever shows.
