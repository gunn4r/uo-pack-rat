// ui/inventory.mts — the Inventory screen's Items view (design spec 4.2): one item browser (item-browser.mts) on
// index.html's #inv-view-items, with the item peek (peek.mts) as its detail panel, its columns saved to ui-prefs,
// and the Inventory's ids kept. Also what other screens' ways into the Items view do (nav.mts hands them here); the
// row actions and ⋯ menu live in item-parts.mts.
import type { Item } from "../vault-lib.mts";
import type { ItemQuery } from "../item-query.mts";
import { $ } from "./dom.mts";
import { state } from "./store.mts";
import { clearAll } from "./inv-model.mts";
import type { UiPrefs } from "./api-types.mts";
import { initPeek, openPeek, closePeek, peekOpen, peekSerial, peekRefresh } from "./peek.mts";
import { hideItemTip } from "./dom.mts";
import { createItemBrowser } from "./item-browser.mts";
import type { ItemBrowser } from "./item-browser.mts";
import { itemActions, setItemNav } from "./item-parts.mts";
import { setItemsView, showItem, showContainer } from "./nav.mts";

let inv: ItemBrowser;

// ---------------------------------------------------------------- the peek
// The peek on row i, the row marked selected (accent fill and edge) and made the active row.
function openPeekAt(i: number, focusPeek = false): void {
  const it = inv.page.rows[i];
  if (!it) return;
  inv.activeIndex = i;
  hideItemTip();
  openPeek(it, { focus: focusPeek });
  inv.markSelected();
}

// ---------------------------------------------------------------- entry points (app.mts, nav.mts)
// Once, at startup: the toolbar, the table's header and its loading state.
export function initFilters(): void {
  inv = createItemBrowser($<HTMLElement>("#inv-view-items")!, {
    onActivate: (_it, i) => openPeekAt(i),
    rowActions: itemActions,
    detail: { open: peekOpen, serial: peekSerial, close: closePeek, refresh: peekRefresh },
    persist: true,
    globalIds: true,
  });
  initPeek({
    step: (delta) => { inv.focusRow(inv.activeIndex + delta, false); openPeekAt(inv.activeIndex); },
    closed: (focusRowAfter) => { inv.markSelected(); if (focusRowAfter) inv.focusRow(inv.activeIndex); },
  });
  // The ⋯ menu's Open details: the item's row when it is in the table on this screen, else the Items view on its name.
  setItemNav({
    openDetails: (it: Item) => { const i = inv.page.rows.findIndex((r) => r?.serial === it.serial); if (i >= 0 && location.hash.startsWith("#/inventory")) openPeekAt(i, true); else showItem(it); },
    showContainer,
  });
  setItemsView({ showItem: revealItem, showCharacterItems: showCharacterRows, showOnly });
}
// Every load and refresh: the facets changed, and the rows come back with the same filters.
document.addEventListener("inventorychange", () => { buildFilters(); fetchItems(); });
// A saved Organize setup changes how locations read: the rows come back with the new labels.
document.addEventListener("organizechange", () => { if (state.inv) fetchItems(); });
// After every load and refresh: the facets changed, so the chips' words and the strip are redrawn, and
// the toolbar comes back to life after a failed load.
export function buildFilters(): void { inv.sync(); }
// A refresh (a live scan landed, a Forget): the same filters, the scroll position kept.
export function fetchItems(): void { inv.fetch(); }
// load()'s GET /api/ui-prefs answer (null when that request failed): the saved columns and the density.
export function applyUiPrefs(prefs: UiPrefs | null): void { inv.applyPrefs(prefs); }
// app.mts's load() or reload() failed: say so in the table's own card, and disable what needs the data.
export function inventoryFailed(e: unknown): void { inv.failed(e); }
// nav.mts's showItem: the Items view searching for the piece's name, with that piece open in the peek as soon as its row arrives.
function revealItem(it: { serial: number; name: string }): void {
  closePeek();
  inv.reveal(it.serial);
  inv.setQuery({ ...clearAll(inv.query), q: it.name.toLowerCase() });
  if (location.hash !== "#/inventory") location.hash = "#/inventory";
}
// nav.mts's showCharacterItems: the Items view filtered to one character, every other filter cleared.
function showCharacterRows(name: string): void {
  closePeek();
  inv.setQuery({ ...clearAll(inv.query), chars: [name] });
  if (location.hash !== "#/inventory") location.hash = "#/inventory";
}
// nav.mts's showContainer, showSearch and showKind: the Items view on one filter, every other filter cleared.
function showOnly(filter: Partial<ItemQuery>): void {
  closePeek();
  inv.setQuery({ ...clearAll(inv.query), ...filter });
  if (location.hash !== "#/inventory") location.hash = "#/inventory";
}
