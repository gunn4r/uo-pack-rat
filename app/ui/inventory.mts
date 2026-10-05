// ui/inventory.mts — the Inventory screen's Items view (design spec 4.2): one item browser (item-browser.mts) on
// index.html's #inv-view-items, with the item peek (peek.mts) as its detail panel, its columns saved to ui-prefs,
// and the Inventory's ids kept. Also the row actions and ⋯ menu the House map's contents drawer shares, and the
// entry points other screens use to open the Items view on a filter.
import type { Item } from "../vault-lib.mts";
import type { ItemQuery } from "../item-query.mts";
import { state } from "./store.mts";
import { $, toast } from "./dom.mts";
import { bridgeActionReason, runBridgeAction } from "./bridge.mts";
import { rowActions, menu, copyText } from "./components.mts";
import type { MenuItem } from "./components.mts";
import { clearAll } from "./inv-model.mts";
import type { UiPrefs } from "./api-types.mts";
import { initPeek, openPeek, closePeek, peekOpen, peekSerial, peekRefresh } from "./peek.mts";
import { openClassify } from "./kinds.mts";
import { houseOfItem, showOnMap } from "./house-links.mts";
import { hideItemTip } from "./dom.mts";
import { createItemBrowser } from "./item-browser.mts";
import type { ItemBrowser } from "./item-browser.mts";
export { splitSerial } from "./inv-model.mts";
export { filterContext, tagWords, tagEls, rarityEl, locationEl } from "./item-browser.mts";

let inv: ItemBrowser;

// ---------------------------------------------------------------- row actions
const ACTIONS: Array<["highlight" | "grab" | "goto", string]> = [["highlight", "Highlight in game"], ["grab", "Grab to backpack"], ["goto", "Go to container"]];
// A row's ⋯ menu, also opened from the House map's contents drawer: there (or for an item that is no row of the table) Open details goes to the Inventory with the item in the peek.
export function itemMenu(anchor: HTMLElement, it: Item): void {
  const entries: MenuItem[] = [{ label: "Open details", icon: "panel-left", onSelect: () => { const i = inv.page.rows.findIndex((r) => r?.serial === it.serial); if (i >= 0 && location.hash.startsWith("#/inventory")) openPeekAt(i, true); else showItem(it); } }];
  if (it.root != null && !it.equippedBy) entries.push({ label: "Show everything in this container", icon: "folder", onSelect: () => showContainer(+it.root!) });
  const home = houseOfItem(it);
  if (home) entries.push({ label: "Show on map", icon: "house", count: home.name, onSelect: () => showOnMap(home.id, home.serial) });
  entries.push({ label: "Copy serial", icon: "clipboard", onSelect: () => {
    const s = `0x${it.serial.toString(16)}`;
    void copyText(s).then((ok) => ok ? toast(`Copied ${s}`, "good") : toast("Could not copy the serial.", "bad"));
  } });
  // Gear keeps its slot-based kind, and a scanned bag is always a container (issue #150).
  if (!it.gear && !state.inv?.containers[it.serial]) entries.push({ label: "Classify this…", icon: "sliders", onSelect: () => { void openClassify(it); } });
  menu(anchor, entries, { label: `More actions for ${it.name}` });
}
// An item row's actions: Highlight, Grab and Go to (gated by the bridge, a disabled one saying why) and the ⋯ menu. The
// House map's contents drawer shows the same on its rows.
export function itemActions(it: Item): HTMLSpanElement {
  return rowActions([
    ...ACTIONS.map(([action, text]) => ({ label: text, icon: action, disabled: bridgeActionReason(action, it), onClick: () => { runBridgeAction(action, it); } })),
    { label: "More actions", icon: "more" as const, onClick: (e: MouseEvent) => itemMenu(e.currentTarget as HTMLElement, it) },
  ]);
}

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

// ---------------------------------------------------------------- entry points (app.mts, containers.mts)
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
}
// After every load and refresh: the facets changed, so the chips' words and the strip are redrawn, and
// the toolbar comes back to life after a failed load.
export function buildFilters(): void { inv.sync(); }
// A refresh (a live scan landed, a Forget): the same filters, the scroll position kept.
export function fetchItems(): void { inv.fetch(); }
// load()'s GET /api/ui-prefs answer (null when that request failed): the saved columns and the density.
export function applyUiPrefs(prefs: UiPrefs | null): void { inv.applyPrefs(prefs); }
// app.mts's load() or reload() failed: say so in the table's own card, and disable what needs the data.
export function inventoryFailed(e: unknown): void { inv.failed(e); }
// The character sheet's "Open in Inventory": the Items view searching for the piece's name, with that
// piece open in the peek as soon as its row arrives.
export function showItem(it: { serial: number; name: string }): void {
  closePeek();
  inv.reveal(it.serial);
  inv.setQuery({ ...clearAll(inv.query), q: it.name.toLowerCase() });
  if (location.hash !== "#/inventory") location.hash = "#/inventory";
}
// Containers' "Show these items" and a row's "Show everything in this container": the Items view
// filtered to one root container.
// Characters' "Show Dorran's items": the Items view filtered to one character (worn, backpack, bank, and
// the ground containers that character scanned), every other filter cleared.
export function showCharacterItems(name: string): void {
  closePeek();
  inv.setQuery({ ...clearAll(inv.query), chars: [name] });
  if (location.hash !== "#/inventory") location.hash = "#/inventory";
}
export function showContainer(root: number): void { showOnly({ roots: [root] }); }
// The House map's "See all in Inventory": the Items view searching for the same text, every other filter cleared.
export function showSearch(q: string): void { showOnly({ q: q.trim().toLowerCase() }); }
// Every item of one kind: Organize's way to the items Pack Rat could not classify (issue #150).
export function showKind(kind: string): void { showOnly({ kind: [kind] }); }
function showOnly(filter: Partial<ItemQuery>): void {
  closePeek();
  inv.setQuery({ ...clearAll(inv.query), ...filter });
  if (location.hash !== "#/inventory") location.hash = "#/inventory";
}
