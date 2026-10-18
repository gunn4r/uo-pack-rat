# The page: screens, models and data modules

The guide to `app/ui/`. `docs/ui.md` holds the full rules (tokens, components, themes, contrast), and each `docs/ui/<screen>.md` holds a screen's behavior.

## Read with:

`docs/ui.md` ("Hard rules", "Tokens", "Components", "Page modules and what they may import"), the screen's `docs/ui/<screen>.md`; `docs/module-map.md` (UI); `docs/change-checklists.md` ("Add a UI screen or view").

## Invariants

- **Three kinds of module.** A *screen* owns DOM and registers with `registerScreen` in `nav.mts`. A *model* (`*-model.mts`, `view-state.mts`, `messages.mts`) is pure and DOM-free, so a plain node test can import it. A *data module* is the one owner of a server resource the page keeps: it fetches and saves it and announces the change (`organize-data.mts` → `organizechange`, `inventory-data.mts`'s `reload()` → `inventorychange`, `profiles.mts`'s `editProfiles`, `prefs.mts` as the one writer of the view choices, `houses-data.mts`).
- **Every fetch goes through `api.mts`.** Response types come from `app/api/` through `api-types.mts`.
- **Import rules** (`scripts/layering.test.mts`):
  - nothing outside `app/ui/` imports from it (rule 1);
  - a server module the page imports reaches no `node:` module and has its own static route (rule 4);
  - no module imports `app.mts` (rule 7);
  - every screen is reached from `app.mts`, or its route never registers (rule 8).
  - Screens open each other only through `nav.mts` (`showItem`, `showContainer`, `showSearch`, `showKind`, `showCharacterItems`). Review keeps this until W3c's guard lands.
- **The Suit Builder's nine modules never import each other** (rule 9). They share `builder-session.mts`. A call between them is a `BuilderCommands` entry that exactly one module `provide()`s. A redraw is a `BuilderNews` key: the changer calls `announce(key)`, and exactly one module hears it with `onChange(key)` (rule 10).
- **Every color is a token** from `tokens.css` (or a theme family's `britannia.css`), paired with its `--color-on-*` text. No test catches a literal color elsewhere; review and the contrast scenes do.
- **A screen stylesheet never restyles a component class.** A new look is a component option. Every `@media` width comes from `breakpoints.mts`. `scripts/css-guard.test.mts` checks both, and each allowed override carries its reason there.
- **Shared pieces are used, not copied:** `toast()` and `confirmDialog()` (never `window.confirm`), `resistTile`, `plural` (`format.mts`), `fetchAllItems` and `inventoryLoader` (`inventory-data.mts`). A new shared piece is extracted only once it has two users. Nothing sets `innerHTML`.

## Extend it

- **A screen:** follow "Add a UI screen or view". Put the logic in a model with a node test, register the route with `registerScreen`, import the screen from `app.mts`, and add its stems to `SCREENS` in `scripts/select-tests.mts` (a missing stem selects every Electron test).
- **A Suit Builder panel piece:** it lives in the one module that owns its section (module map, Suit Builder). A new call between modules is a `BuilderCommands` key provided once. A new redraw is a `BuilderNews` key with one listener.
- **A resource the page caches:** a data module with a stamp, queued updates, a reload on `stale` and one change event. Copy `organize-data.mts`. Copy `houses-data.mts` when it has logic worth a node test: its fetch is injectable.
- **A new look for a component:** an option in `components.mts` and `components.css`, not a rule in a screen's stylesheet.

## Tests

- **Models:** a node test in `app/` (`app/ui-<view>.test.mts` or `app/<name>-model.test.mts`), since `tsconfig.browser.json` compiles all of `app/ui/` for the browser. `--changed` picks them.
- **Screens:** the Electron `scripts/ui-<screen>.test.mts` that `SCREENS` maps the stem to (`ui-builder-*` for the builder modules, `ui-forms` for Import, the wizard and Settings, `ui-map`, `ui-organize`, `ui-state` for Inventory, Characters and Runs). They don't run locally (`TEST_SKIP_ELECTRON=1`); CI runs them.
- **Narrow windows:** `sidewaysAt(app, page, { width: 420, height: 900 }, [...])` (`scripts/electron-window.mts`) asserts nothing scrolls sideways at 420 px. A screen with a drawer or a wide card checks it.
- **New CSS, screens or overlays:** a scene in `scripts/ui-contrast.test.mts`.
- **Guards:** `scripts/layering.test.mts`, `scripts/css-guard.test.mts`.

## Traps

- The Electron tests import `/ui/<module>.mjs` and call exports by name. Grep `scripts/ui-*.test.mts` before moving or renaming an export: a broken one fails only on CI.
- CSS classes are global across every stylesheet in `app/ui/`. Search for a class before naming a new one.
- A module that touches `document` at module scope cannot load under `node:test`. Keep models DOM-free.
- A page module cannot import a `node:`-reaching module even for a type: the browser build type-checks with no node types.
- More traps from building the page are in `docs/ui.md`, "Rules learned building it".
