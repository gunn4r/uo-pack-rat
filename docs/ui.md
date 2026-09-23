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

## Stylesheets

- `app/ui/tokens.css` — the tokens and `@font-face`.
- `app/ui/components.css` — base resets and the shared component classes. Resets are wrapped in `:where()` (zero specificity) and variants are compound classes (`.btn.btn-primary`), so a reset can never outrank a component: `.pr button { color: inherit }` (0,1,1) would beat `.btn-primary` (0,1,0) and every filled button would inherit dark text.
- `app/ui/styles.css` — layouts that are not yet a screen file of their own. No literal colours anywhere: every colour is a token.

`<body class="pr">` is the root the resets hang off.

## Contrast check

`scripts/contrast-probe.mts` measures contrast on the rendered page: every text/background pair (compositing semi-transparent fills down to an opaque layer), field values, placeholders, control boundaries, icons in icon-only buttons and messages, and status dots. `scripts/ui-contrast.test.mts` (`[slow]`, full suite) runs it in the Electron window over the demo data on every scene in light and dark, and fails on any pair under 4.5:1 for text (3:1 for large text) or 3:1 for edges, icons and dots; a disabled control only needs 3:1 text. When you add a screen, drawer, popover or dialog, add a scene there.
