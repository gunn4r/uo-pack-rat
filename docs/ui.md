# The page's UI: tokens, components and rules

How the page (`app/index.html`, `app/ui/`) is styled and built. Read this before changing a screen. The approved design is the round-1 redesign spec; this file is what a contributor needs from it.

## Hard rules

1. **Text never caps its own width.** No `max-width`, `ch` width or measure token on `p`, `li`, headings, labels or any text element. Width is decided by containers only: the page, a grid track, a card, a drawer, a dialog, a table column. The token set has no measure token on purpose.
2. **Grid and flex never split an inline flow.** Any element that is `display: flex | grid | inline-flex` holds only element children; every run of text is one `<span>`, and a run that mixes text with inline elements (`<strong>`, `<code>`, a muted number) is wrapped as a whole in one `<span>`. A button is `[icon svg] [span label]`, a switch label is `[input] [span text]`, a nav item is `[svg] [span label] [span count]`. The builders in `app/ui/components.mts` enforce this (see "The one-span rule" below).
3. **Verify the rendered output, not the source.** Look at the screen in light and dark at 1440, 1280 and 1024 wide before calling a change done.

## Tokens (`app/ui/tokens.css`)

Three layers, so a second theme family is a value swap rather than a rewrite:

- **Brand constants** (`--brand-*`): the logo palette. Never changed by mode; used directly only by the logo tile.
- **Semantic roles** (`--color-*`, `--res-*`, `--rarity-*`, `--font-*`, `--radius-*`, `--shadow-*`, `--border-width-frame`, `--frame-image`, `--surface-texture`): every component reads only these. A theme family supplies a light and a dark set.
- **Structural tokens** (`--space-*`, `--text-*`/`--lh-*`, `--control-*`, `--row-*`, layout widths, `--z-*`, motion): shared by every theme, so no screen reflows between themes.

Selection is two attributes on `<html>`, set by `app/ui/theme.mts` from the ui-prefs `theme` and `appearance` fields (`GET/PUT /api/ui-prefs`, kept in `<data>/ui-prefs.json` because the desktop app's page origin changes every launch): `data-theme="default"` and `data-mode="light|dark"`. Appearance "System" follows `prefers-color-scheme` live. Any subtree can flip mode by carrying its own `data-theme` + `data-mode` (the item tooltip `#tip` is always dark). A new theme family adds `[data-theme="<family>"][data-mode="light"]` and `…[data-mode="dark"]` blocks overriding only the semantic roles, and its id to `BUILT_THEMES` in `app/ui/theme.mts`.

**The on-* rule.** Every filled surface has a paired `--color-on-*` text token, and the rule that sets the fill sets its on-* text too (`background: var(--color-danger); color: var(--color-on-danger)`). No filled component inherits its text colour. `--color-border` is decorative (dividers, card edges); `--color-border-strong` is for anything the user must find the edge of (inputs, selects, chips, secondary buttons). Disabled controls use `--color-disabled` / `--color-on-disabled`, never opacity.

**Rarity** is data: the shard rules carry each tier's game colour, but most fail on a light page, so a tier is painted through its `--rarity-*` token (`rarityToken()` in `app/ui/items.mts`, `rarityColor()`/`rarCell()` in `app/ui/dom.mts`). A tier with no token falls back to its raw game colour inside a dark subtree.

**Fonts** are bundled: IBM Plex Sans 400/500/600 and IBM Plex Mono 400/500 (latin subset, woff2) in `app/ui/fonts/`, served by `GET /ui/fonts/<name>.woff2` under the page's `font-src 'self'` CSP. Mono is for identifiers only (serials, paths, pasted scan text, key hints); numbers use the body face with `font-variant-numeric: tabular-nums`.

## The shell and where each screen lives

`app/index.html` is one shell (`#app`, a grid of the sidebar and `.main`) holding one `<main class="screen">` per screen, each with its `h1` in a 48 px top bar (`header.topbar`) and its content in `.page`. Overlays sit outside `#app`, which goes inert while a drawer is open. Each screen's markup is its own delimited block of `index.html` (or is built by its module), and each has its own stylesheet, linked from `index.html`, so work on one screen rarely touches another's files:

| Screen or overlay | Markup | Module | Stylesheet |
|---|---|---|---|
| Shell: sidebar, bridge control and popover, collapse | `#app > nav#sidebar` | `ui/shell.mts` (routes in `ui/app.mts`) | `ui/shell.css` |
| Inventory, with its Items and Containers views | `main#tab-inventory` (`#inv-view-items`, `#tab-containers`) | `ui/inventory.mts`, `ui/containers.mts` | `ui/inventory.css` |
| Characters | `main#tab-characters` | `ui/characters.mts`, `ui/sheet.mts` | `ui/characters.css` |
| Suit Builder | `main#tab-builder` | `ui/builder.mts` | `ui/builder.css` |
| Saved runs drawer | `#runs-drawer` | `ui/runs.mts` | `ui/runs.css` |
| Settings | `main#tab-settings` | `ui/settings.mts` | `ui/settings.css` |
| Import drawer | `#import-drawer` (body `#import-body`) | `ui/import.mts` | `ui/import.css` |
| Setup wizard | `dialog#wizard` | `ui/wizard.mts` | `ui/wizard.css` |

Routes (`ui/app.mts`): `#/inventory`, `#/containers` (Inventory's Containers view), `#/characters`, `#/builder/<Character>`, `#/runs` (the builder with the saved-runs drawer open), `#/import` (the Import drawer over whichever screen was showing; ⌘I opens it) and `#/settings`. Closing a drawer puts the route back without a history entry; changing screen clears the toasts and closes any popover. The sidebar collapses to 56 px icons below 1180 px, or at any width when pinned (the ui-prefs `sidebar` field); nav labels stay in the accessibility tree when collapsed.

The bridge status control at the sidebar foot has four states (ready, busy, offline, no client set up), worded by `bridgeView()` in `ui/messages.mts` and redrawn by `pollBridge()` in `ui/bridge.mts`; its popover says the state in words, the client, when it last answered, and offers Check again and Client settings. The shard picker and the Theme and Appearance controls are in Settings › General.

## Stylesheets

- `app/ui/tokens.css` — the tokens and `@font-face`.
- `app/ui/components.css` — base resets and the shared component classes. Resets are wrapped in `:where()` (zero specificity) and variants are compound classes (`.btn.btn-primary`), so a reset can never outrank a component: `.pr button { color: inherit }` (0,1,1) would beat `.btn-primary` (0,1,0) and every filled button would inherit dark text.
- `app/ui/shell.css` and one file per screen (table above).
- `app/ui/styles.css` — the older shared classes the screens still use (`.panel`, `.stack`, `.row`, plain tables, the character sheet, the item tooltip) until each screen moves onto components. No literal colours anywhere: every colour is a token.

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
- Overlays: `popover(anchor, content, {label})` (anchored, light dismiss, Esc, focus back to the anchor), `tooltip(anchor, text)` and `tipWrap(control, text)` for a disabled control, `createDrawer({id, title, subtitle, body, footer})` / `bindDrawer(root)` for drawer markup already in `index.html` (focus trap, Esc, scrim, hidden + inert when closed, focus back to the opener, the shell `#app` inert while open), `openDialog({title, body, actions, role})` on the native `<dialog>`, `confirmDialog({title, body, confirmLabel, danger})` → `Promise<boolean>` (Cancel focused; the page's only yes/no question — never `window.confirm`), `showToast(text, tone, {action})` and `clearToasts()` (bottom-right stack of three; errors stay). `dom.mts`'s `toast(text, cls)` and `dialog.mts`'s `promptText()` sit on top of these.

## Contrast check

`scripts/contrast-probe.mts` measures contrast on the rendered page: every text/background pair (compositing semi-transparent fills down to an opaque layer), field values, placeholders, control boundaries, icons in icon-only buttons and messages, and status dots. `scripts/ui-contrast.test.mts` (`[slow]`, full suite) runs it in the Electron window over the demo data on every scene in light and dark, and fails on any pair under 4.5:1 for text (3:1 for large text) or 3:1 for edges, icons and dots; a disabled control only needs 3:1 text. When you add a screen, drawer, popover or dialog, add a scene there.

## Forms: the Import drawer, the setup wizard and Settings

- **Import drawer** (`ui/import.mts`). A pasted scan or a scan file is parsed in the page by `app/paste-scan.mts` — the same `parsePastedScan` POST `/api/import/paste` runs, browser-safe and served at `/paste-scan.mjs` — so the preview can never call clean what the server then refuses. Scan files (dropped anywhere on the window, or a chosen folder) are read in the page and sent through that same paste route one by one, so every file gets the same preview. The preview card's counts and the primary button's sentence come from the DOM-free `ui/import-preview.mts`. A re-render never drops focus out of the open drawer (Esc and the focus trap listen inside it).
- **Client wording** (`ui/adapter-copy.mts`). Everything the page says about a game client — short names, the wizard's client cards, per-step questions and help, the Import drawer's client options, the wizard's step names — is written per adapter there, never assembled from an adapter's README title. An adapter the table doesn't know still gets plain text from its own name and summary; a new shipped adapter should get its own entry.
- **Wizard** (`ui/wizard.mts`, a `.dialog`). One primary per step (`#wiz-primary`), which ↵ runs; the paste branch renames steps 3 and 4 as soon as a paste client is picked. Step 3's typed path lives in the wizard's state, so it survives a failed "Use this path".
- **Settings** (`ui/settings.mts`). The section nav is links to the Settings route itself whose click only scrolls (the location hash is the router); setting rows are `.set-row` (title and help left, control right, anything spanning below in `.set-row-below`). The Theme select lists every theme family and enables one once its id is in `ui/theme.mts`'s `BUILT_THEMES` — making Britannia chooseable is that one-line change. The data-folder mismatch (`dataDirNotice`) shows in the Data card as well as the banner, and the danger zone's character list follows the inventory (`syncSettingsCharacters`, called from `reload()`).
