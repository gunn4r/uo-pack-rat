# The page's UI: tokens, components and rules

How the page (`app/index.html`, `app/ui/`) is styled and built. Read this before changing a screen, then the page for that screen (the table under "The shell and where each screen lives"). The approved design is the round-1 redesign spec; these files are what a contributor needs from it.

| Screen | How it behaves |
|---|---|
| Inventory, with its Items, Containers and Scrolls views | [`docs/ui/inventory.md`](ui/inventory.md) |
| House map | [`docs/ui/house-map.md`](ui/house-map.md) |
| Organize | [`docs/ui/organize.md`](ui/organize.md) |
| Characters and the shared character sheet | [`docs/ui/characters.md`](ui/characters.md) |
| Suit Builder and its Saved runs drawer | [`docs/ui/suit-builder.md`](ui/suit-builder.md) |
| The Import drawer, the setup wizard and Settings | [`docs/ui/forms.md`](ui/forms.md) |
| The shell (sidebar, routes, bridge control) | below |

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

**The on-* rule.** Every filled surface has a paired `--color-on-*` text token, and the rule that sets the fill sets its on-* text too (`background: var(--color-danger); color: var(--color-on-danger)`). No filled component inherits its text color. `--color-border` is decorative (dividers, card edges); `--color-border-strong` is for anything the user must find the edge of (inputs, selects, chips, secondary buttons). Disabled controls use `--color-disabled` / `--color-on-disabled`, never opacity.

**Rarity** is data: the shard rules carry each tier's game color, but most fail on a light page, so a tier is painted through its `--rarity-*` token (`rarityToken()` in `app/ui/items.mts`, `rarityColor()`/`rarCell()` in `app/ui/dom.mts`). A tier with no token falls back to its raw game color inside a dark subtree.

**Fonts** are bundled: IBM Plex Sans 400/500/600 and IBM Plex Mono 400/500 (latin subset, woff2) in `app/ui/fonts/`, served by `GET /ui/fonts/<name>.woff2` under the page's `font-src 'self'` CSP. `--font-display` is the face for page titles (the top bar `h1`), card titles (`.card-head h2`), drawer and wizard titles (`.overlay-head h2`), Settings' section titles and KPI numbers (`.t-xl`, `.t-2xl`); in Default it is Plex Sans, so those elements look like the body text until a theme family swaps it. Mono is for identifiers only (serials, paths, pasted scan text, key hints); numbers use the body face with `font-variant-numeric: tabular-nums`.

## The shell and where each screen lives

`app/index.html` is one shell (`#app`, a grid of the sidebar and `.main`) holding one `<main class="screen">` per screen, each with its `h1` in a 48 px top bar (`header.topbar`) and its content in `.page`. Overlays sit outside `#app`, which goes inert while a drawer is open. Each screen's markup is its own delimited block of `index.html` (or is built by its module), and each has its own stylesheet, linked from `index.html`, so work on one screen rarely touches another's files:

| Screen or overlay | Markup | Module | Stylesheet |
|---|---|---|---|
| Shell: sidebar, bridge control and popover, collapse | `#app > nav#sidebar` | `ui/shell.mts` (routes in `ui/nav.mts`) | `ui/shell.css` |
| Inventory, with its Items, Containers and Scrolls views | `main#tab-inventory` (`#inv-view-items`, `#tab-containers`, `#tab-scrolls`) | `ui/inventory.mts`, `ui/containers.mts`, `ui/scrolls.mts` (`ui/scrolls-model.mts`) | `ui/inventory.css` |
| House map | `main#tab-map` (body `#map-body`) | `ui/house-map.mts` (screen, SVG, events), `ui/house-map-model.mts` (pure geometry, joins and modes) | `ui/house-map.css` |
| Characters | `main#tab-characters` | `ui/characters.mts`, `ui/sheet.mts` | `ui/characters.css` |
| Suit Builder | `main#tab-builder` (Manual: `#b-manual`) | `ui/builder.mts` (panel, build), `ui/builder-result.mts` (result, compare), `ui/builder-model.mts` (pure logic), `ui/builder-manual.mts` (Manual mode), `ui/manual-model.mts` (its pure logic), `ui/runs.mts` (saved runs), `ui/builder-session.mts` (their shared state and commands), `ui/builder-parts.mts` (what more than one of them draws) | `ui/builder.css` |
| Saved runs drawer | `#runs-drawer` | `ui/runs.mts` | `ui/runs.css` |
| Organize, with its rule drawer and the Auto organize drawer | `main#tab-organize` (body `#org-body`); the drawer is built by its module | `ui/organize.mts` (screen, trips), `ui/rule-editor.mts` (drawer), `ui/auto-organize.mts` (Auto organize drawer), `ui/organize-data.mts` (the setup), `ui/organize-model.mts` (pure logic) | `ui/organize.css` |
| Settings | `main#tab-settings` | `ui/settings.mts` | `ui/settings.css` |
| Import drawer | `#import-drawer` (body `#import-body`) | `ui/import.mts` | `ui/import.css` |
| Setup wizard | `dialog#wizard` | `ui/wizard.mts` | `ui/wizard.css` |

Routes (`ui/nav.mts`): `#/inventory`, `#/containers` and `#/containers/<Character>` (Inventory's Containers view; the second lists only the containers that character's scans opened), `#/scrolls` and `#/scrolls/sot` (Inventory's Scrolls view on its Power scrolls or Scrolls of Transcendence tab), `#/map` and `#/map/<house id>` (the House map; `#/map/plain` for ground containers outside any drawn house; `?q=<query>` searches it and `?select=<container serial>` opens on that container's stack, which "Show on map" uses: `house-map-model.mts` `parseMapHash`/`mapHash`), `#/characters`, `#/characters/<Name>` (that character's sheet), `#/builder/<Character>`, `#/runs` (the builder with the saved-runs drawer open), `#/organize` (Organize: labels, rules, the plan and its trips), `#/import` (the Import drawer over whichever screen was showing; ⌘I opens it) and `#/settings`. Routes are hash routes, so a reload keeps your place. Changing screen adds a history entry, so back and forward walk the screens; switching the builder's character replaces the entry; an unknown hash falls back to the Inventory. Closing a drawer puts the route back without a history entry; changing screen clears the toasts and closes any popover. The sidebar collapses to 56 px icons below 1180 px, or at any width when pinned (the ui-prefs `sidebar` field); nav labels stay in the accessibility tree when collapsed.

How screens are wired: `ui/app.mts` shows the route's `<main>` and drawers, then `ui/nav.mts` calls the `show(route)` the screen registered with `registerScreen({ name, show })`. Other screens open the Items view through `nav.mts` (`showItem`, `showContainer`, `showSearch`, `showKind`, `showCharacterItems`), never by importing a screen. A new inventory (`ui/inventory-data.mts` `reload()`: the first load, a live scan, a Forget) redraws the sidebar counts and then dispatches `inventorychange` on `document`; each screen drawn from the inventory listens for it. No module in `app/ui/` imports `app.mts` (`scripts/layering.test.mts`).

The sidebar's brand row is the mark, the rat's head cropped from the logo, as a 40 px circle in a brass ring (36 px, centered, in the collapsed rail) beside the wordmark; it reads `GET /logo-mark.png` (`app/assets/logo-mark.png`, 80 px so it is sharp on a 2x screen; how it is made is in `build/README.md`). The full logo stays the favicon and the window icon. The bridge status control at the sidebar foot has four states (ready, busy, offline, no client set up), worded by `bridgeView()` in `ui/messages.mts` and redrawn by `pollBridge()` in `ui/bridge.mts`; its popover says the state in words, the client, when it last answered, and offers Check again and Client settings. The shard picker and the Theme and Appearance controls are in Settings › General.

## Stylesheets

- `app/ui/tokens.css` — the tokens and `@font-face`.
- `app/ui/britannia.css` — the Britannia theme family's two mode blocks and its display face, linked right after `tokens.css`.
- `app/ui/components.css` — base resets and the shared component classes. Resets are wrapped in `:where()` (zero specificity) and variants are compound classes (`.btn.btn-primary`), so a reset can never outrank a component: `.pr button { color: inherit }` (0,1,1) would beat `.btn-primary` (0,1,0) and every filled button would inherit dark text.
- `app/ui/shell.css` and one file per screen (table above).
- `app/ui/styles.css` — the older shared classes the screens still use (`.panel`, `.stack`, `.field`, `.empty`, `.small`, plain tables, the item tooltip, the scrollbars) until each screen moves onto components. No literal colors anywhere: every color is a token.

`<body class="pr">` is the root the resets hang off.

## Components (`app/ui/components.mts`)

Small DOM builders over `el()` (`app/ui/dom.mts`); their CSS is `app/ui/components.css`, ported from the approved design canvas. Nothing sets `innerHTML` (scan files are hostile input, `docs/threat-model.md`); icons are built node by node from a fixed path table.

**The one-span rule.** `txt(text, cls?)` returns exactly one `<span>`. `box(tag, attrs, ...kids)` builds a flex/grid container and throws on a bare string or number child. Every builder that takes a label wraps it itself. `FLEX_CLASSES` lists every class `components.css` draws as flex or grid; `app/ui-components.test.mts` checks the list against the stylesheet and that no builder puts a text node inside one, and `scripts/ui-components.test.mts` checks the rendered result. A new flex/grid class in `components.css` must be added to `FLEX_CLASSES`.

What exists:

- Text and containers: `txt`, `box`, `icon(name, {size})`, `kbd`.
- Buttons: `button({label, icon, iconAfter, variant: primary|secondary|ghost|danger|danger-outline, size: sm|md|lg, iconOnly, kbd, disabled, block, cls, onClick, attrs})`. An icon-only button's label becomes its `aria-label`.
- Fields: `input`, `select`, `textarea`, `searchInput({label, placeholder, hint})`, `field({label, control, help, error})` (wires `for`, `aria-describedby`, `aria-invalid`), `check` and `switchControl` (`[input] [span]` rows; a switch is off as a hollow track, the surface inside a strong edge with a small muted knob on the left, and on as an accent-filled track with a larger knob on the right, so the two never read alike), `segmented({label, options, value, onChange})` (radiogroup, arrow keys; an option may carry `sub`, a smaller second line cut to its width, and `title`, its tooltip).
- Chips and labels: `filterChip({label, set, add})`, `token({label, removeLabel, onRemove})`, `pill({label, pressed, off})`, `badge(text, tone)`, `tag(text, tone)`.
- Status: `message({tone, title, text, actions})`, `meter(value, max, {tone})`, `progress(value, max, label)`, `stepper(steps, current)`.
- Layout: `keyValue(pairs)`, `card({title, actions, body})`, the resist tile (`.resist`; with `tint tint-<phys|fire|cold|poison|energy>` it gets a soft wash of its `--res-*` color from the top-right corner and a semibold name, as on the Builder, the character sheet and the item peek; the contrast probe composites text under the wash at its strongest, `--tint-a`), `table({label, columns, rows})`, `tableFoot(...facts)`, `rowActions(actions)` (a disabled action carries its reason as a tooltip).
- Overlays: `popover(anchor, content, {label, beside})` (anchored, light dismiss, Esc, focus back to the anchor; under the anchor, or with `beside` right of that element, level with the anchor: `besidePlacement`), `menu(anchor, items, {label, width})` (an action menu as wide as its longest item, so no item wraps: `width` is only its minimum, 360 px its maximum), `tooltip(anchor, text, {side?})` (above, or `"right"` beside the anchor) and `tipWrap(control, text)` for a disabled control, `createDrawer({id, title, subtitle, body, footer})` / `bindDrawer(root)` for drawer markup already in `index.html` (focus trap, Esc, scrim, hidden + inert when closed, focus back to the opener, the shell `#app` inert while open), `openDialog({title, body, actions, role})` on the native `<dialog>`, `confirmDialog({title, body, confirmLabel, danger})` → `Promise<boolean>` (Cancel focused; the page's only yes/no question — never `window.confirm`), `showToast(text, tone, {action})` and `clearToasts()` (bottom-right stack of three; errors stay). A "⋯" menu's items take an optional icon, count or key hint, "divider" rules separate them, arrow keys move between them, and a disabled item carries its reason. `dom.mts`'s `toast(text, cls)` and `dialog.mts`'s `promptText()` sit on top of these.

## The Britannia theme and adding a theme family

Britannia (`app/ui/britannia.css`, chosen in Settings › General › Theme and saved as the ui-prefs `theme`) dresses the page as an Ultima Online gump: light mode is a parchment ground with aged-paper cards, iron-gall ink text, a deep brass accent and crimson danger; dark mode is a dark-wood ground with leather surfaces, parchment text and a brighter brass. The logo teal is its link color and its info fill. It changes only what spec 2.5 lets a family change, so no screen moves between themes:

- every `--color-*` role (and the legacy aliases and `--ring-focus`, which are resolved per block);
- `--res-*` and `--rarity-*`, restated per mode: Default's values, with the light ones that fell under 4.6:1 on the parchment darkened just enough;
- `--font-display`: Cinzel 600 (SIL OFL, `app/ui/fonts/cinzel-latin-600-normal.woff2` with `OFL-Cinzel.txt`). Cinzel is capitals and small capitals only, so it goes on titles made of fixed words or names, never on anything whose letter case carries meaning (a serial like `0x700b0000` would read `0X700B0000`); that is why dialog titles, which can name a container, stay in the body face;
- `--radius-lg` and `--radius-xl` (2 px, square gump corners), `--border-width-frame` (3 px);
- `--frame-image`: a brass bevel (dark outer line, brass, pale highlight, lighter corner rivets) drawn as a 9 × 9 SVG data URI and sliced 3 px into a `border-image`. Cards, the old `.panel`, popovers, drawers and dialogs read it. A card inside another framed surface drops back to a plain 1 px edge (`components.css`, "one frame per stack"), and a card whose border color carries a state (Settings' danger zone, the Import preview) sets `border-image: none` so its color shows;
- `--surface-texture`: noise from `feTurbulence` as an SVG data URI on the page ground only (never under dense text): fine grain plus a slow mottle on the parchment, long horizontal grain on the wood. Each tile holds the noise four times, mirrored, so the tiling has no seam;
- `--shadow-2` and `--shadow-3`, warmer and deeper.

Nothing in the theme comes from a game or a game client: the colors are the logo's, the frame and textures are drawn in the stylesheet, and the face is an open-license font.

`britannia.css` is linked after `tokens.css` on purpose. A subtree that flips mode carries `data-theme="default" data-mode="dark"` (the item tooltip, the rarity chips drawn in game colors); under a Britannia page it matches both Default's dark block (its own attributes) and Britannia's dark block (`[data-theme="britannia"] [data-mode="dark"]`, through `<html>`) at the same specificity, and the later file wins, so the tooltip is leather rather than Default's slate.

To add another theme family `<family>`:

1. Write `app/ui/<family>.css` with two blocks, `[data-theme="<family>"][data-mode="light"], [data-theme="<family>"] [data-mode="light"]` and the same for `dark`. Each must set every `--color-*` role Default's light block sets and every property Default's dark block sets (game colors, shadows, `--ring-focus`, the aliases), and nothing Default doesn't define; `app/theme.test.mts` checks both, so a new role added to Default later can't silently fall back to Default's light value inside the family. Structural tokens (spacing, type scale, heights, layout widths, z-layers, motion) are not overridable.
2. Bundle any font as woff2 under `app/ui/fonts/` with its license text, `@font-face` in the family's stylesheet, and name it only through `--font-display`. Keep images inline (`data:`); the CSP allows `img-src 'self' data:` and the theme test refuses any other `url()`.
3. Link the stylesheet in `app/index.html` right after `tokens.css`, add the id to `BUILT_THEMES` in `app/ui/theme.mts`, the label to `THEMES` in `app/ui/settings.mts`, and the id to `UI_PREF_CHOICES.theme` in `app/store/ui-prefs.mts`.
4. Add the id to `FAMILIES` in `scripts/ui-contrast.test.mts`, which then measures every scene in the new family in both modes, and look at every screen in both modes before calling it done.

## Contrast check

`scripts/contrast-probe.mts` measures contrast on the rendered page: every text/background pair (compositing semi-transparent fills down to an opaque layer), field values, placeholders, control boundaries, switch edges and knobs, icons in icon-only buttons and messages, and status dots. `scripts/ui-contrast.test.mts` (`[slow]`, full suite) runs it in the Electron window over the demo data on every scene in each theme family (Default and Britannia) in light and dark, and fails on any pair under 4.5:1 for text (3:1 for large text) or 3:1 for edges, icons and dots; a disabled control only needs 3:1 text. When you add a screen, drawer, popover or dialog, add a scene there. The House map's scenes (the map, a selected stack's panel, a callout, the no-tiledata note and the empty state) are measured by `scripts/ui-map.test.mts` on its own seeded data folder, since the demo scans hold no house.

## Page modules and what they may import

`app/ui/` is what used to be the page's single inline `<script type="module">`, split one concern per file — strict TypeScript, compiled by `npm run build:ui` into `app/dist/` and served from there through the `/ui/<name>` route. `docs/module-map.md`'s UI section has one line per module. The pure, DOM-free modules are the ones the `node:test` suites import directly; their tests live in `app/`, not `app/ui/`, because `tsconfig.browser.json` compiles `app/ui/**` for the browser.

A page module may import a server-side module, type or value, when that module and everything it imports is browser-safe (no `node:` import anywhere in the chain). One that reaches `node:` cannot be imported even for a type, because the browser build type-checks with `"types": []`. A shape the page needs from such a module goes in a types-only module beside it (`app/house-model-types.mts`, `app/organize-types.mts`, `app/runs-types.mts`): the owner re-exports it, the route `satisfies` it and `app/ui/api-types.mts` re-exports it, so a renamed field fails the typecheck on both sides. The rest are still declared by hand in `app/ui/api-types.mts`.

`scripts/layering.test.mts` holds the rest: nothing outside `app/ui/` imports from it; every module the page imports from outside `app/ui/` has its own static route in `app/http/routes/static.mts` and reaches no `node:` module; no `app/ui/` module imports `app/ui/app.mts`; and the Suit Builder's four modules (`builder`, `builder-manual`, `builder-result`, `runs`) never import each other: they read and set the builder's state through `ui/builder-session.mts` and call each other through its `commands`, which each module registers with `provide()` as it loads. Screens open each other through `ui/nav.mts` (see "How screens are wired" above).

## Rules learned building it

- Grid items need `min-width: 0` or a wide table pushes the page sideways; a sticky `th` cannot cross an `overflow-x` ancestor, so the inventory table scrolls inside its own box; Inventory and Suit Builder are app-shell layouts (the page never scrolls, columns scroll independently).
- The page's CSS classes are global across every stylesheet in `app/ui/` (an early saved-runs row reused the build-progress panel's class and stacked every row into a column with an accent border). Check for an existing class before naming a new one.
- Verifying in a browser: navigating to a URL that differs from the current one only by its hash is a hash navigation, not a reload, so the page keeps running the code it first loaded. After editing the page and running `npm run build:ui`, navigate to a different query string (`/?r=2#/builder/Kestrel`) to force a real reload.
