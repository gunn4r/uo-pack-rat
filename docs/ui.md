# The page's UI: tokens, components and rules

How the page (`app/index.html`, `app/ui/`) is styled and built. Read this before changing a screen. The approved design is the round-1 redesign spec; this file is what a contributor needs from it.

## Hard rules

1. **Text never caps its own width.** No `max-width`, `ch` width or measure token on `p`, `li`, headings, labels or any text element. Width is decided by containers only: the page, a grid track, a card, a drawer, a dialog, a table column. The token set has no measure token on purpose.
2. **Grid and flex never split an inline flow.** Any element that is `display: flex | grid | inline-flex` holds only element children; every run of text is one `<span>`, and a run that mixes text with inline elements (`<strong>`, `<code>`, a muted number) is wrapped as a whole in one `<span>`. A button is `[icon svg] [span label]`, a switch label is `[input] [span text]`, a nav item is `[svg] [span label] [span count]`. The builders in `app/ui/components.mts` enforce this (see "The one-span rule" below).
3. **Verify the rendered output, not the source.** Look at the screen in light and dark at 1440, 1280 and 1024 wide before calling a change done.
4. **Electron UI tests use the real window size.** No test emulates a viewport larger than its real window; `fitWindow()` in `scripts/electron-window.mts` sizes the window within the screen and the test drives the layout that width shows (TESTING.md has the details and `PACKRAT_TEST_SCREEN` for trying a small screen).

## Tokens (`app/ui/tokens.css`)

Three layers, so a second theme family is a value swap rather than a rewrite:

- **Brand constants** (`--brand-*`): the logo palette. Never changed by mode; used directly only by the logo tile.
- **Semantic roles** (`--color-*`, `--res-*`, `--rarity-*`, `--font-*`, `--radius-*`, `--shadow-*`, `--border-width-frame`, `--frame-image`, `--surface-texture`): every component reads only these. A theme family supplies a light and a dark set.
- **Structural tokens** (`--space-*`, `--text-*`/`--lh-*`, `--control-*`, `--row-*`, layout widths, `--z-*`, motion): shared by every theme, so no screen reflows between themes.

Selection is two attributes on `<html>`, set by `app/ui/theme.mts` from the ui-prefs `theme` and `appearance` fields (`GET/PUT /api/ui-prefs`, kept in `<data>/ui-prefs.json` because the desktop app's page origin changes every launch): `data-theme="default|britannia"` and `data-mode="light|dark"`. Appearance "System" follows `prefers-color-scheme` live. Any subtree can flip mode by carrying its own `data-theme` + `data-mode` (the item tooltip `#tip` is always dark; under a Britannia page it takes Britannia's dark mode, see below). A new theme family is described under "The Britannia theme and adding a theme family".

**The on-* rule.** Every filled surface has a paired `--color-on-*` text token, and the rule that sets the fill sets its on-* text too (`background: var(--color-danger); color: var(--color-on-danger)`). No filled component inherits its text colour. `--color-border` is decorative (dividers, card edges); `--color-border-strong` is for anything the user must find the edge of (inputs, selects, chips, secondary buttons). Disabled controls use `--color-disabled` / `--color-on-disabled`, never opacity.

**Rarity** is data: the shard rules carry each tier's game colour, but most fail on a light page, so a tier is painted through its `--rarity-*` token (`rarityToken()` in `app/ui/items.mts`, `rarityColor()`/`rarCell()` in `app/ui/dom.mts`). A tier with no token falls back to its raw game colour inside a dark subtree.

**Fonts** are bundled: IBM Plex Sans 400/500/600 and IBM Plex Mono 400/500 (latin subset, woff2) in `app/ui/fonts/`, served by `GET /ui/fonts/<name>.woff2` under the page's `font-src 'self'` CSP. `--font-display` is the face for page titles (the top bar `h1`), card titles (`.card-head h2`), drawer and wizard titles (`.overlay-head h2`), Settings' section titles and KPI numbers (`.t-xl`, `.t-2xl`); in Default it is Plex Sans, so those elements look like the body text until a theme family swaps it. Mono is for identifiers only (serials, paths, pasted scan text, key hints); numbers use the body face with `font-variant-numeric: tabular-nums`.

## The shell and where each screen lives

`app/index.html` is one shell (`#app`, a grid of the sidebar and `.main`) holding one `<main class="screen">` per screen, each with its `h1` in a 48 px top bar (`header.topbar`) and its content in `.page`. Overlays sit outside `#app`, which goes inert while a drawer is open. Each screen's markup is its own delimited block of `index.html` (or is built by its module), and each has its own stylesheet, linked from `index.html`, so work on one screen rarely touches another's files:

| Screen or overlay | Markup | Module | Stylesheet |
|---|---|---|---|
| Shell: sidebar, bridge control and popover, collapse | `#app > nav#sidebar` | `ui/shell.mts` (routes in `ui/app.mts`) | `ui/shell.css` |
| Inventory, with its Items and Containers views | `main#tab-inventory` (`#inv-view-items`, `#tab-containers`) | `ui/inventory.mts`, `ui/containers.mts` | `ui/inventory.css` |
| Characters | `main#tab-characters` | `ui/characters.mts`, `ui/sheet.mts` | `ui/characters.css` |
| Suit Builder | `main#tab-builder` | `ui/builder.mts` (panel, build), `ui/builder-result.mts` (result, compare), `ui/builder-model.mts` (pure logic) | `ui/builder.css` |
| Saved runs drawer | `#runs-drawer` | `ui/runs.mts` | `ui/runs.css` |
| Settings | `main#tab-settings` | `ui/settings.mts` | `ui/settings.css` |
| Import drawer | `#import-drawer` (body `#import-body`) | `ui/import.mts` | `ui/import.css` |
| Setup wizard | `dialog#wizard` | `ui/wizard.mts` | `ui/wizard.css` |

Routes (`ui/app.mts`): `#/inventory`, `#/containers` (Inventory's Containers view), `#/characters`, `#/characters/<Name>` (that character's sheet), `#/builder/<Character>`, `#/runs` (the builder with the saved-runs drawer open), `#/import` (the Import drawer over whichever screen was showing; ⌘I opens it) and `#/settings`. Closing a drawer puts the route back without a history entry; changing screen clears the toasts and closes any popover. The sidebar collapses to 56 px icons below 1180 px, or at any width when pinned (the ui-prefs `sidebar` field); nav labels stay in the accessibility tree when collapsed.

The bridge status control at the sidebar foot has four states (ready, busy, offline, no client set up), worded by `bridgeView()` in `ui/messages.mts` and redrawn by `pollBridge()` in `ui/bridge.mts`; its popover says the state in words, the client, when it last answered, and offers Check again and Client settings. The shard picker and the Theme and Appearance controls are in Settings › General.

## Stylesheets

- `app/ui/tokens.css` — the tokens and `@font-face`.
- `app/ui/britannia.css` — the Britannia theme family's two mode blocks and its display face, linked right after `tokens.css`.
- `app/ui/components.css` — base resets and the shared component classes. Resets are wrapped in `:where()` (zero specificity) and variants are compound classes (`.btn.btn-primary`), so a reset can never outrank a component: `.pr button { color: inherit }` (0,1,1) would beat `.btn-primary` (0,1,0) and every filled button would inherit dark text.
- `app/ui/shell.css` and one file per screen (table above).
- `app/ui/styles.css` — the older shared classes the screens still use (`.panel`, `.stack`, `.field`, `.empty`, `.small`, plain tables, the item tooltip, the scrollbars) until each screen moves onto components. No literal colours anywhere: every colour is a token.

`<body class="pr">` is the root the resets hang off.

## Components (`app/ui/components.mts`)

Small DOM builders over `el()` (`app/ui/dom.mts`); their CSS is `app/ui/components.css`, ported from the approved design canvas. Nothing sets `innerHTML` (scan files are hostile input, `docs/threat-model.md`); icons are built node by node from a fixed path table.

**The one-span rule.** `txt(text, cls?)` returns exactly one `<span>`. `box(tag, attrs, ...kids)` builds a flex/grid container and throws on a bare string or number child. Every builder that takes a label wraps it itself. `FLEX_CLASSES` lists every class `components.css` draws as flex or grid; `app/ui-components.test.mts` checks the list against the stylesheet and that no builder puts a text node inside one, and `scripts/ui-components.test.mts` checks the rendered result. A new flex/grid class in `components.css` must be added to `FLEX_CLASSES`.

What exists:

- Text and containers: `txt`, `box`, `icon(name, {size})`, `kbd`.
- Buttons: `button({label, icon, iconAfter, variant: primary|secondary|ghost|danger|danger-outline, size: sm|md|lg, iconOnly, kbd, disabled, block, cls, onClick, attrs})`. An icon-only button's label becomes its `aria-label`.
- Fields: `input`, `select`, `textarea`, `searchInput({label, placeholder, hint})`, `field({label, control, help, error})` (wires `for`, `aria-describedby`, `aria-invalid`), `check` and `switchControl` (`[input] [span]` rows), `segmented({label, options, value, onChange})` (radiogroup, arrow keys).
- Chips and labels: `filterChip({label, set, add})`, `token({label, removeLabel, onRemove})`, `pill({label, pressed, off})`, `badge(text, tone)`, `tag(text, tone)`.
- Status: `message({tone, title, text, actions})`, `meter(value, max, {tone})`, `progress(value, max, label)`, `stepper(steps, current)`.
- Layout: `keyValue(pairs)`, `card({title, actions, body})`, `table({label, columns, rows})`, `tableFoot(...facts)`, `rowActions(actions)` (a disabled action carries its reason as a tooltip).
- Overlays: `popover(anchor, content, {label})` (anchored, light dismiss, Esc, focus back to the anchor), `tooltip(anchor, text)` and `tipWrap(control, text)` for a disabled control, `createDrawer({id, title, subtitle, body, footer})` / `bindDrawer(root)` for drawer markup already in `index.html` (focus trap, Esc, scrim, hidden + inert when closed, focus back to the opener, the shell `#app` inert while open), `openDialog({title, body, actions, role})` on the native `<dialog>`, `confirmDialog({title, body, confirmLabel, danger})` → `Promise<boolean>` (Cancel focused; the page's only yes/no question — never `window.confirm`), `showToast(text, tone, {action})` and `clearToasts()` (bottom-right stack of three; errors stay), `menu(anchor, items, {label})` for a "⋯" menu (menu items with an optional icon, count or key hint, "divider" rules, arrow keys, a disabled item carries its reason). `dom.mts`'s `toast(text, cls)` and `dialog.mts`'s `promptText()` sit on top of these.

## The Inventory screen

`ui/inventory.mts` draws the Items view; its pure rules (the query string, the active-filter tokens and their wording, the counts and plurals, the empty-result sentence, the row window and the keyboard model) are in `ui/inv-model.mts`, tested under plain `node:test` by `app/ui-inventory.test.mts`.

- **Filter state** is `state.query`, the shape `item-query.mts`'s `parseItemQuery` reads. Character, Slot, Location (as bag texts `loc` and whole root containers `root`) and Kind are any-of lists; Rarity is a minimum (`rarityMin`); property rules carry an operator (`prop=lmc:le:4`). Every control goes through `setQuery()`, which redraws the chips (in place, so an open popover keeps its anchor) and the active strip, and refetches.
- **No pager.** The table is virtual: the body holds only the rows in view between two spacer rows, patched rather than replaced so a focused row is never detached, and rows load from `GET /api/items` in 500-row chunks as they scroll into view. A new query keeps the old rows on screen until its first chunk lands; the header (sort arrow, grouped columns) follows the data, not the click.
- **Keyboard.** The toolbar is one tab stop (`role=toolbar`, ←/→ between controls, the search's arrows move its caret until an end); the table is one tab stop (↑/↓, Home/End, Page Up/Down), row actions are reached with Tab from the focused row, and `/` focuses the search.
- **Bridge gating.** Row actions are always drawn and disabled with a reason (`bridge.mts`'s `bridgeActionReason`: worn, client can't, no position for Go to, bridge offline); `pollBridge` dispatches `bridgechange` on `document` when the bridge's state changes, and the table redraws its rows.
- **Preferences.** The chosen columns (`cols`) and the row density (`density`: `dense` 32 px or `regular` 40 px) are ui-prefs fields.
- **Item peek** (`ui/peek.mts`): a row click, Enter or Space opens the selected item in a panel docked beside the table (400 px, 360 below 1280, laid over the table below 1180); ↑/↓ from the table or the panel step through rows with the peek following, Esc closes it and focus goes back to the row. Its footer's Highlight, Grab and Go to are gated like the row actions.
- **Item tooltip** (`dom.mts` `tipNode`, `installTooltip`, `showItemTip`): the one `#tip`, always dark, 280 px, shown 400 ms after the pointer settles on anything with `data-serial` (Inventory rows, the Suit Builder's current suit, Plan and Fetch list pieces) or after a row has had keyboard focus for 400 ms; `pointer-events: none`.
- **Responsive.** Below 1180 px the unset facet chips fold into "+ Filter" and List | Grouped moves into the table settings popover, so the toolbar never wraps.

## The Britannia theme and adding a theme family

Britannia (`app/ui/britannia.css`, chosen in Settings › General › Theme and saved as the ui-prefs `theme`) dresses the page as an Ultima Online gump: light mode is a parchment ground with aged-paper cards, iron-gall ink text, a deep brass accent and crimson danger; dark mode is a dark-wood ground with leather surfaces, parchment text and a brighter brass. The logo teal is its link colour and its info fill. It changes only what spec 2.5 lets a family change, so no screen moves between themes:

- every `--color-*` role (and the legacy aliases and `--ring-focus`, which are resolved per block);
- `--res-*` and `--rarity-*`, restated per mode: Default's values, with the light ones that fell under 4.6:1 on the parchment darkened just enough;
- `--font-display`: Cinzel 600 (SIL OFL, `app/ui/fonts/cinzel-latin-600-normal.woff2` with `OFL-Cinzel.txt`). Cinzel is capitals and small capitals only, so it goes on titles made of fixed words or names, never on anything whose letter case carries meaning (a serial like `0x700b0000` would read `0X700B0000`); that is why dialog titles, which can name a container, stay in the body face;
- `--radius-lg` and `--radius-xl` (2 px, square gump corners), `--border-width-frame` (3 px);
- `--frame-image`: a brass bevel (dark outer line, brass, pale highlight, lighter corner rivets) drawn as a 9 × 9 SVG data URI and sliced 3 px into a `border-image`. Cards, the old `.panel`, popovers, drawers and dialogs read it. A card inside another framed surface drops back to a plain 1 px edge (`components.css`, "one frame per stack"), and a card whose border colour carries a state (Settings' danger zone, the Import preview) sets `border-image: none` so its colour shows;
- `--surface-texture`: noise from `feTurbulence` as an SVG data URI on the page ground only (never under dense text): fine grain plus a slow mottle on the parchment, long horizontal grain on the wood. Each tile holds the noise four times, mirrored, so the tiling has no seam;
- `--shadow-2` and `--shadow-3`, warmer and deeper.

Nothing in the theme comes from a game or a game client: the colours are the logo's, the frame and textures are drawn in the stylesheet, and the face is an open-licence font.

`britannia.css` is linked after `tokens.css` on purpose. A subtree that flips mode carries `data-theme="default" data-mode="dark"` (the item tooltip, the rarity chips drawn in game colours); under a Britannia page it matches both Default's dark block (its own attributes) and Britannia's dark block (`[data-theme="britannia"] [data-mode="dark"]`, through `<html>`) at the same specificity, and the later file wins, so the tooltip is leather rather than Default's slate.

To add another theme family `<family>`:

1. Write `app/ui/<family>.css` with two blocks, `[data-theme="<family>"][data-mode="light"], [data-theme="<family>"] [data-mode="light"]` and the same for `dark`. Each must set every `--color-*` role Default's light block sets and every property Default's dark block sets (game colours, shadows, `--ring-focus`, the aliases), and nothing Default doesn't define; `app/theme.test.mts` checks both, so a new role added to Default later can't silently fall back to Default's light value inside the family. Structural tokens (spacing, type scale, heights, layout widths, z-layers, motion) are not overridable.
2. Bundle any font as woff2 under `app/ui/fonts/` with its licence text, `@font-face` in the family's stylesheet, and name it only through `--font-display`. Keep images inline (`data:`); the CSP allows `img-src 'self' data:` and the theme test refuses any other `url()`.
3. Link the stylesheet in `app/index.html` right after `tokens.css`, add the id to `BUILT_THEMES` in `app/ui/theme.mts`, the label to `THEMES` in `app/ui/settings.mts`, and the id to `UI_PREF_CHOICES.theme` in `app/vault-server.mts`.
4. Add the id to `FAMILIES` in `scripts/ui-contrast.test.mts`, which then measures every scene in the new family in both modes, and look at every screen in both modes before calling it done.

## Contrast check

`scripts/contrast-probe.mts` measures contrast on the rendered page: every text/background pair (compositing semi-transparent fills down to an opaque layer), field values, placeholders, control boundaries, icons in icon-only buttons and messages, and status dots. `scripts/ui-contrast.test.mts` (`[slow]`, full suite) runs it in the Electron window over the demo data on every scene in each theme family (Default and Britannia) in light and dark, and fails on any pair under 4.5:1 for text (3:1 for large text) or 3:1 for edges, icons and dots; a disabled control only needs 3:1 text. When you add a screen, drawer, popover or dialog, add a scene there.

## Characters and the shared character sheet

The Characters screen has two routes: `#/characters` is the roster (one 48 px row per character: last scan, STR · DEX · INT, Hits · Stam · Mana, the five paperdoll resists with a meter to the cap, pieces worn, "Build suit" and a ⋯ menu), filtered by the top-bar search and sorted by its header buttons; `#/characters/<Name>` is that character's sheet, with a breadcrumb, previous/next, "Show <Name>'s items", "Build a suit" and a ⋯ menu. `parseRoute()` returns the sheet's name as `sheet` (the builder's `character` is untouched). The ⋯ menus are `menu(anchor, items, {label})` from `components.mts`: a popover with `role=menu`, ↑/↓/Home/End between the items, a danger item for Forget (which goes through `confirmDialog`). "Show <Name>'s items" opens the Inventory with its Character filter set to that character (`inventory.mts`'s `showCharacterItems`).

The sheet itself is one themed component, `sheetNode(name, before, after, opts?)` in `ui/sheet.mts`, used by the Characters screen and the Suit Builder result:

- `before`: the suit to show, a `SheetAssignment` (`Record<string, SheetItem>` keyed by slot or serial; a `SheetItem` is `{serial, name, slot, props, rarity?, tags?}`, which both a scanned `Item` and an optimizer `OptItem` satisfy). `wornSet(name)` gives the character's worn set in this shape.
- `after`: `null` for the one-suit sheet; a second assignment for the "now → after" variant, where every figure that moves reads "18 → 22" (the after number in success or danger colour), the slot tiles show the `after` suit with its new pieces badged "New", and the footnote adds the Hits/Stamina/Mana estimate note. Worn pieces the optimizer never touches count on both sides.
- `opts.onSlot(item, tile)`: called when a filled slot tile is pressed; without it the tiles are still buttons carrying `data-serial`, so the page's hover tooltip works on them. The Characters screen opens the piece's tooltip (the same `tipNode` as the hover tooltip) in an always-dark popover (`.item-pop`), with "Open in Inventory", which shows the piece in the Inventory's item peek (`inventory.mts`'s `showItem`).

It returns a `div.sheet` (with `data-character`): a KPI row of seven tiles (five resists as value / cap with a meter and a "cap +N" badge when the raw sum passes the cap, then Attributes with the gear bonus split and Pools), then two cards in a 7fr / 5fr grid: Worn gear (Armour 3 × 2, Weapons and jewellery 3 × 2, Clothing a row of 5, anything else under Other; rarity-coloured borders, dashed empty slots) and Properties (Casting, Combat, Regeneration, Pools and other as key/value lists with the shard cap muted, the skills or an info message when the scan has none, and the Resisting Spells footnote). The sheet lays itself out from its own width with container queries (`ui/characters.css`): below 1040 px the attributes and pools drop under the resists, below 960 px the cards stack, so it fits whatever column it is put in. `resistFigures(name, set)` is the resist maths the roster shares with it. The pure formatters (`capBadgeText`, `atCap`, `bonusBreakdown`, `moveText`, `keyNumbers`, `tagTone`, `plural`) are exported and unit-tested in `app/ui-characters.test.mts`.

## Forms: the Import drawer, the setup wizard and Settings

- **Import drawer** (`ui/import.mts`). A pasted scan or a scan file is parsed in the page by `app/paste-scan.mts` — the same `parsePastedScan` POST `/api/import/paste` runs, browser-safe and served at `/paste-scan.mjs` — so the preview can never call clean what the server then refuses. Scan files (dropped anywhere on the window, or a chosen folder) are read in the page and sent through that same paste route one by one, so every file gets the same preview. The preview card's counts and the primary button's sentence come from the DOM-free `ui/import-preview.mts`. A re-render never drops focus out of the open drawer (Esc and the focus trap listen inside it).
- **Client wording** (`ui/adapter-copy.mts`). Everything the page says about a game client — short names, the wizard's client cards, per-step questions and help, the Import drawer's client options, the wizard's step names — is written per adapter there, never assembled from an adapter's README title. An adapter the table doesn't know still gets plain text from its own name and summary; a new shipped adapter should get its own entry.
- **Wizard** (`ui/wizard.mts`, a `.dialog`). One primary per step (`#wiz-primary`), which ↵ runs; the paste branch renames steps 3 and 4 as soon as a paste client is picked. Step 3's typed path lives in the wizard's state, so it survives a failed "Use this path".
- **Settings** (`ui/settings.mts`). The section nav is links to the Settings route itself whose click only scrolls (the location hash is the router); setting rows are `.set-row` (title and help left, control right, anything spanning below in `.set-row-below`). The Theme select lists every theme family and enables one once its id is in `ui/theme.mts`'s `BUILT_THEMES`; a choice applies at once and is saved with the other ui-prefs. The data-folder mismatch (`dataDirNotice`) shows in the Data card as well as the banner, and the danger zone's character list follows the inventory (`syncSettingsCharacters`, called from `reload()`).

## Suit Builder

The panel (`ui/builder.mts`) is drawn from state, never read back from the DOM: `state.builder.profile` holds the template settings, requirements, weights and candidate pool, and the exported `knobs` object holds the Advanced fields as typed strings, so a bad value can sit in its field with its error until fixed. A build, a saved profile and a saved run's settings snapshot (`ui/runs.mts`'s `settingsSnapshot`) all read from there. Sections redraw one at a time (`redraw(id)`), so an edit keeps the panel's scroll and focus. The numbers and words the screen shows (section summaries, validation messages with the allowed range, resist outcomes, other-changes badges, compare rows and best values, run labels and badges) come from `ui/builder-model.mts`, which has no DOM and is tested directly (`app/builder-model.test.mts`); its `SOLVER_LIMITS` must equal the server's `OPTS_LIMITS` (a test checks).

The Plan and Fetch list gate their bridge actions with `ui/bridge.mts`'s `bridgeActionReason(action, item)` and run them with `runBridgeAction`; Grab all is `grabAll(items, me)` (Grabs one after another, leaving out what `grabbable()` says is already with the character or worn), and the result redraws on the `bridgechange` event. `setNavBusy(nav, busy)` in `ui/shell.mts` puts a busy dot on a nav item while a build runs. The template and saved-run ⋯ menus are components.mts's `menu()`; a menu opened inside the Saved runs drawer gets `pop-over-drawer` so it sits above the drawer.

The compare view (2-3 suits from a result's Other suits, or 2-3 saved runs from the drawer) replaces the panel and results with a full-width table and swaps the top bar for a breadcrumb (`#b-cmp-topbar`); "Back to result" or the breadcrumb returns. "Full sheet" in "<name> after the change" opens the shared `sheetNode` in its now → after variant.

