// ui/item-browser.mts — the item browser (issue #12): the filter toolbar and its popovers, the active-filter strip,
// the columns and density popover, and the virtual table over its data source (GET /api/items by default), as a factory that can be mounted
// more than once. Each instance owns its query, its loaded page, its columns and its timers, and finds its parts
// inside its own root, never by a global id. The Inventory's Items view (inventory.mts) is one instance;
// inv-model.mts holds the pure rules (query string, token wording, counts, row window, keyboard model).
//
// The table has no pager: it is virtual. Its body draws only the rows in view (plus a few either side)
// between two spacer rows sized to the rest, and loads the matching rows from the server in 500-row
// chunks as they scroll into view, so a large inventory costs one request per screenful reached, never
// a pager click.
//
// map: ui-components
// owns: `createItemBrowser`
import { RESIST_KEYS } from "../vault-lib.mts";
import type { Item } from "../vault-lib.mts";
import type { ItemQuery, ItemQueryGroups } from "../item-query.mts";
import { state } from "./store.mts";
import { el, label, full, slotLabel, whereText } from "./dom.mts";
import { api } from "./api.mts";
import { prefs } from "./prefs.mts";
import { colsFromPrefs, COLS_VERSION } from "./view-state.mts";
import { relativeWhen } from "./messages.mts";
import { txt, box, icon, button, searchInput, token, segmented, popover, closePopover, message, toast } from "./components.mts";
import type { PopoverHandle } from "./components.mts";
import { withFixed, activeFilters, clearAll, matchLine, countFact, emptyCause, rowWindow, chunksToFetch, gridKey, colShort, colFull, groupColumns, COL_GROUPS, DEFAULT_COLS, ITEM_COLS } from "./inv-model.mts";
import type { FilterToken } from "./inv-model.mts";
import type { ItemsApiResponse, UiPrefs } from "./api-types.mts";
import { openRuleEditor } from "./rule-editor.mts";
import { createFilterBar, itemsSource, type ItemSource } from "./filter-bar.mts";
import { showItemTip, hideItemTip } from "./dom.mts";
import { filterContext, tagEls, rarityEl, locationEl } from "./item-parts.mts";
import { gearItem } from "./gear-item.mts";
import { retryLoad } from "./inventory-data.mts";
import { BREAKPOINTS, upTo } from "./breakpoints.mts";
import { plural, textHit } from "./format.mts";

const CHUNK = 500;              // rows per GET /api/items request (the server's own cap)
const NARROW = upTo(BREAKPOINTS.narrow);
const narrow = (): boolean => matchMedia(NARROW).matches;

// What a browser's table has loaded of its query from GET /api/items — rows XOR groups, matching
// item-query.mts's ItemQueryRows | ItemQueryGroups union, folded into one always-both-keys shape. The table is
// virtual and loads in chunks as it scrolls, so `rows`/`groups` are SPARSE: index i holds the i-th match once
// its chunk has landed. `total` counts rows (or names, grouped); `stacks` and `pieces` count the matching stacks
// and pieces in either view.
export interface PageState {
  rows: Item[];
  groups: ItemQueryGroups["groups"] | null;
  total: number;
  stacks: number;
  pieces: number;
}
// One extra cell per list row, after Name (the Suit Builder's "LRC +20 → 85"). It has nothing to sort on.
export interface ExtraColumn { label: string; title?: string; width: number; cell: (it: Item) => HTMLElement | null }
// A detail panel beside the table (the Inventory's peek): whether it is open and on which item, closing it, and
// following a reload (the item's new record, or closed when it left the list and `stillThere` is false).
export interface DetailHooks {
  open: () => boolean;
  serial: () => number | null;
  close: (focusRow?: boolean) => void;
  refresh: (find: (serial: number) => Item | undefined, stillThere: boolean) => void;
}
// A checkbox before each list row and a header checkbox for the rows loaded (the Inventory's selection, issue #270: ui/move-to.mts
// keeps it). `locked` says why a row cannot be ticked (a worn item); `header` is the header checkbox's look.
export interface SelectionHooks {
  checked: (it: Item) => boolean;
  locked: (it: Item) => string | null;
  toggle: (index: number, on: boolean, shift: boolean) => void;
  header: () => "all" | "some" | "none";
  toggleLoaded: (on: boolean) => void;
}
export interface ItemBrowserOptions {
  // Always applied (e.g. `{ slot: ["ring"] }`), overriding the player's value of any field it names. Only the matching
  // chips are hidden: the search box and the "+ Filter" entries for property rules, tags and gargoyle/meditation stay.
  fixed?: Partial<ItemQuery>;
  // The columns shown at first and after "Reset to default" (DEFAULT_COLS when left out).
  columns?: string[];
  extraColumn?: ExtraColumn;
  // A list row's primary action, on click or Enter; a grouped row always opens its stacks.
  onActivate: (it: Item, index: number) => void;
  // A row's Highlight / Grab / Go to and ⋯ buttons.
  rowActions: (it: Item) => HTMLElement;
  detail?: DetailHooks;
  // Whether column, width and density changes are saved to ui-prefs (the Inventory's are).
  persist?: boolean;
  // Whether the controls the factory builds carry the Inventory's ids (#f-text, #inv-settings, …), which its CSS
  // and the Electron tests select. A second instance leaves them off: an id is page-wide.
  globalIds?: boolean;
  // The rows and the facets (itemsSource when left out).
  source?: ItemSource;
  // List rows can be ticked (the Inventory's).
  selection?: SelectionHooks;
}
export interface ItemBrowser {
  readonly query: ItemQuery;
  readonly page: PageState;
  activeIndex: number;
  setQuery: (next: ItemQuery) => void;
  // A refresh (a live scan landed, a Forget): the same filters, the scroll position kept.
  fetch: () => void;
  // After every load and refresh: the facets changed, so the chips' words and the strip are redrawn, and the
  // toolbar comes back to life after a failed load.
  sync: () => void;
  // The load failed: say so in the table's own card, and disable what needs the data.
  failed: (e: unknown) => void;
  // GET /api/ui-prefs' answer (null when that request failed).
  applyPrefs: (prefs: UiPrefs | null) => void;
  focusRow: (i: number, focus?: boolean) => void;
  markSelected: () => void;
  // The checkboxes and the ticked rows' look redrawn after the selection changed.
  markPicked: () => void;
  // Activate the item with this serial once its row has landed (the next query's first chunk).
  reveal: (serial: number) => void;
}

// A browser's filters and sort start here — the exact shape parseItemQuery (item-query.mts) reads off a
// URLSearchParams (inv-model.mts's queryParams builds the query string from it; offset/limit are set per chunk).
// Nothing hidden by default: power scrolls are Cursed.
const BLANK_QUERY: ItemQuery ={ q: "", chars: [], slot: [], loc: [], roots: [], houses: [], rarity: "", rarityMin: "", rarityMax: "", kind: [], seenDays: 0, slayer: "", nogarg: false, med: false, hideTags: [], tags: [], props: [], flags: [], wskill: [], type: [], group: false, sort: "name", dir: 1, offset: 0, limit: 500 };

// ---------------------------------------------------------------- the toolbar's keyboard
// Toolbar keyboard (spec 3.6): one tab stop; ←/→ move between the controls, Home/End jump. In the search
// field the arrows move the caret until it reaches an end. The List/Grouped radios keep ↑/↓ for their value.
function rovingToolbar(bar: HTMLElement, search: HTMLInputElement): void {
  const stops = (): HTMLElement[] => [...bar.querySelectorAll<HTMLElement>("[data-stop], .seg [aria-checked=true]")].filter((e) => e.getClientRects().length > 0);
  const settle = (on: HTMLElement): void => { for (const s of bar.querySelectorAll<HTMLElement>("[data-stop], .seg button")) s.tabIndex = s === on ? 0 : -1; };
  bar.addEventListener("keydown", (e) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
    const t = e.target as HTMLElement;
    if (t === search && (e.key === "Home" || e.key === "End" || (e.key === "ArrowLeft" && (search.selectionStart ?? 0) > 0) || (e.key === "ArrowRight" && (search.selectionEnd ?? 0) < search.value.length))) return;
    const list = stops();
    const seg = t.closest(".seg");
    const at = list.findIndex((s) => s === t || (seg && s.closest(".seg") === seg));
    const to = e.key === "Home" ? 0 : e.key === "End" ? list.length - 1 : at + (e.key === "ArrowRight" ? 1 : -1);
    const next = list[Math.max(0, Math.min(list.length - 1, to))];
    if (!next) return;
    e.preventDefault(); e.stopPropagation();
    settle(next); next.focus();
  }, true);
  bar.addEventListener("focusin", (e) => { const t = e.target as HTMLElement; if (t.matches("[data-stop], .seg button")) settle(t); });
  settle(search);
}

// ---------------------------------------------------------------- the table: cells
interface ColDef { key: string; label: string; title: string; num: boolean; width: number; sortable: boolean }
const EXTRA = "__extra";   // the extra column's key: no property is named this
const SEL = "__sel";       // the checkbox column's
function cell(col: ColDef, it: Item): HTMLTableCellElement {
  const td = el("td", col.num ? { class: "num" } : {});
  switch (col.key) {
    case "name": td.append(gearItem(it, { tip: false, cls: "inv-name" })); break;   // the row is its tooltip host
    case "tags": if (it.tags.length) td.append(box("span", { class: "inv-tags" }, ...tagEls(it))); break;
    case "rarity": { const r = rarityEl(it.rarity); if (r) td.append(r); break; }
    case "slot": if (it.slot) td.append(txt(slotLabel(it.slot))); break;
    case "location": td.append(locationEl(it)); break;
    case "amount": td.append(txt((it.amount || 1).toLocaleString("en-US"))); break;
    case "kind": td.append(txt(it.kind)); break;
    case "seen": td.append(txt(relativeWhen(it.seenAt))); break;
    case "med": if (it.gear) td.append(txt(it.medable ? "Yes" : "No", it.medable ? "" : "muted")); break;
    default: {
      const v = col.key === "strReq" ? it.strReq : col.key === "weight" ? it.weight : it.props[col.key];
      if (v) td.append(txt(String(v)));
    }
  }
  return td;
}
type Group = NonNullable<PageState["groups"]>[number];
function groupCell(col: ColDef, g: Group): HTMLTableCellElement {
  const td = el("td", col.num ? { class: "num" } : {});
  const text = col.key === "name" ? g.name : col.key === "kind" ? g.kind : col.key === "amount" ? g.amount.toLocaleString("en-US") : col.key === "stacks" ? String(g.stacks)
    : g.locations.map(([l, n]) => `${whereText(l)} (${n.toLocaleString("en-US")})`).join(" · ");
  td.append(txt(text, col.key === "where" || col.key === "name" ? "ellip" : ""));
  return td;
}
const SKEL_W = [72, 54, 80, 46, 66, 58, 76, 50];
const spacer = (cls: string): HTMLTableRowElement => el("tr", { class: `vpad ${cls}`, "aria-hidden": "true" }, el("td", {}));
function noScansState(): HTMLElement {
  const noClient = !state.setup?.settings?.client;
  return box("div", { class: "empty-state" }, icon("inventory"), el("h3", { class: "t-lg" }, "No scans yet"),
    el("p", { class: "muted" }, txt(noClient ? "Set up your game client, then press Play on packrat-scanner.py in game to fill your inventory." : "Press Play on packrat-scanner.py in game, or import scan files you already have.")),
    noClient
      ? button({ label: "Run setup", variant: "primary", onClick: async () => { const { openWizard } = await import("./wizard.mts"); openWizard(); } })
      : box("a", { class: "btn btn-primary", href: "#/import" }, txt("Import scans")));
}
const dot = (): HTMLElement => el("span", { class: "faint", "aria-hidden": "true" }, "·");

// ---------------------------------------------------------------- the factory
// `root` holds the Items view's markup (index.html's #inv-view-items): .inv-toolbar, .inv-active, and a card with
// .inv-scroll (the table.inv-tbl with its colgroup, thead and tbody, and .inv-state), .inv-fade and .tbl-foot.
export function createItemBrowser(root: HTMLElement, opts: ItemBrowserOptions): ItemBrowser {
  const fixed = opts.fixed || {};
  const source = opts.source || itemsSource;
  const defaultCols = opts.columns || DEFAULT_COLS;
  const idOf = (name: string): { id?: string } => (opts.globalIds ? { id: name } : {});
  const part = <E extends HTMLElement = HTMLElement>(sel: string): E => root.querySelector<E>(sel)!;
  const toolbar = part(".inv-toolbar"), strip = part(".inv-active"), scroller = part(".inv-scroll"), table = part<HTMLTableElement>("table.inv-tbl");
  const stateHolder = part(".inv-state"), fade = part(".inv-fade"), foot = part(".tbl-foot");
  root.dataset.itemBrowser = "";

  let query: ItemQuery = { ...BLANK_QUERY };
  let page: PageState = { rows: [], groups: null, total: 0, stacks: 0, pieces: 0 };
  // The column choice, the dragged widths by column key, and the rows' density (32 or 40 px).
  const view: { cols: string[]; colWidths: Record<string, number>; density: "dense" | "regular" } = { cols: [...defaultCols], colWidths: {}, density: "dense" };

  const tokensNow = (): FilterToken[] => activeFilters(query, filterContext());
  // Every filter control lands here: the new state, the toolbar's chips and the strip redrawn, and the
  // table refetched from its first row.
  function setQuery(next: ItemQuery): void {
    // A search keystroke still waiting out its debounce is superseded by any other change (Clear all above
    // all): left to fire, it would re-apply the search box's text over the new state and throw the table
    // back to its first row.
    bar.cancelSearch();
    query = { ...next, offset: 0 };
    syncToolbar();
    requery(true);
  }

  // ---------------------------------------------------------------- toolbar
  // The search box, chips and "+ Filter" are the shared filter bar (filter-bar.mts); the view switch and the
  // table settings are the browser's own.
  const bar = createFilterBar({ query: () => query, setQuery, source, fixed, idOf });
  const search = bar.search;
  let viewSeg: HTMLDivElement & { setValue: (v: string) => void }, settingsBtn: HTMLButtonElement;
  function syncToolbar(): void {
    if (!viewSeg) return;
    bar.sync();
    viewSeg.setValue(query.group ? "grouped" : "list");
    renderActive();
  }
  function buildToolbar(): void {
    viewSeg = segmented({ label: "Rows", options: [{ value: "list", label: "List" }, { value: "grouped", label: "Grouped" }], value: "list", onChange: (v) => setView(v === "grouped") });
    if (opts.globalIds) viewSeg.id = "inv-rows";
    settingsBtn = button({ label: "Table settings: columns and density", icon: "sliders", iconOnly: true, size: "sm", attrs: { ...idOf("inv-settings"), "aria-haspopup": "dialog", "aria-expanded": "false", "data-stop": "" }, onClick: () => openSettings() });
    toolbar.replaceChildren(bar.searchRoot, ...bar.chips, bar.addChip, el("span", { class: "spacer" }), viewSeg, settingsBtn);
    rovingToolbar(toolbar, search);
    syncToolbar();
  }
  function setView(grouped: boolean): void {
    if (query.group === grouped) return;
    if (grouped) opts.detail?.close();
    // The grouped view sorts by Name, Kind, Total or Stacks; any other sort falls back to Name.
    const keep = grouped ? ["name", "kind", "amount", "stacks"].includes(query.sort) : query.sort !== "stacks";
    setQuery({ ...query, group: grouped, ...(keep ? {} : { sort: "name", dir: 1 as const }) });
  }

  // ---------------------------------------------------------------- active-filter strip
  function renderActive(): void {
    const tokens = tokensNow();
    strip.hidden = !tokens.length;
    if (!tokens.length) { strip.replaceChildren(); return; }
    const p = page;
    strip.replaceChildren(
      txt(matchLine({ shown: p.stacks, total: source.facets()?.itemCount || 0, grouped: !!p.groups, names: p.total }), "t-sm muted inv-match"),
      ...tokenEls(tokens),
      button({ label: "Save as rule…", variant: "ghost", size: "sm", attrs: idOf("f-save-rule"), onClick: () => { closePopover(); void openRuleEditor({ fromQuery: query }); } }),
      button({ label: "Clear all", variant: "ghost", size: "sm", attrs: idOf("f-clear"), onClick: () => { closePopover(); setQuery(clearAll(query)); search.focus(); } }));
  }
  const tokenEls = (tokens: FilterToken[]): HTMLElement[] => tokens.map((t) => token({ label: t.label, removeLabel: t.removeLabel, onRemove: () => setQuery(t.remove(query)) }));

  // ---------------------------------------------------------------- columns and density popover
  // Every column the picker offers: the inventory's property keys plus the item's own fields and whatever
  // the saved choice names.
  const allCols = (): string[] => [...new Set([...state.propKeys, ...ITEM_COLS, ...view.cols])];
  // The column choice is kept by the server (<data>/ui-prefs.json), not localStorage: the desktop app
  // serves the page from a new port on every launch, and localStorage belongs to one origin.
  function saveCols(): void {
    if (!opts.persist) return;
    prefs.set({ cols: view.cols, colsVersion: COLS_VERSION });
  }
  function setCols(cols: string[]): void { view.cols = cols; saveCols(); rebuildTable(); }
  function setColWidths(widths: Record<string, number>): void {
    view.colWidths = widths;
    if (opts.persist) prefs.set({ colWidths: widths });
  }
  function openSettings(): void {
    const all = allCols();
    const count = txt("", "t-sm muted");
    const paintCount = (): void => { count.textContent = `${view.cols.filter((c) => all.includes(c)).length} of ${all.length}`; };
    paintCount();
    const density = segmented({ label: "Row density", options: [{ value: "dense", label: "Dense · 32" }, { value: "regular", label: "Regular · 40" }], value: view.density, onChange: (v) => {
      view.density = v === "regular" ? "regular" : "dense";
      if (opts.persist) prefs.set({ density: view.density });
      rebuildTable();
    } });
    const find = searchInput({ label: "Find a column", placeholder: "Find a column", attrs: idOf("inv-col-q") });
    find.input.classList.add("input-sm");
    const list = box("div", { class: "inv-opts", ...idOf("inv-cols") });
    let expanded = false;
    const draw = (): void => {
      const filter = find.input.value.trim().toLowerCase();
      const groups = groupColumns(all);
      const open = new Set<string>(expanded || filter ? COL_GROUPS : COL_GROUPS.slice(0, 3));
      const kids: HTMLElement[] = [];
      for (const g of groups) {
        if (!open.has(g.group)) continue;
        const keys = g.keys.filter((k) => textHit(filter, colShort(k, label), colFull(k, full)));
        if (!keys.length) continue;
        kids.push(txt(g.group, "inv-opt-group t-sm muted"));
        for (const k of keys) {
          const cb = el("input", { type: "checkbox", "data-col": k });
          cb.checked = view.cols.includes(k);
          cb.addEventListener("change", () => { setCols(cb.checked ? [...view.cols, k] : view.cols.filter((c) => c !== k)); paintCount(); });
          kids.push(box("label", { class: "check inv-opt" }, cb, txt(colFull(k, full), "ellip")));
        }
      }
      const rest = groups.filter((g) => !open.has(g.group));
      if (rest.length) {
        const more = box("button", { type: "button", class: "menu-item inv-more", "aria-expanded": "false" }, txt(`${rest.map((g) => g.group).join(", ")} · ${rest.reduce((a, g) => a + g.keys.length, 0)} more`), icon("chevron-down", { size: "sm" }));
        more.addEventListener("click", () => { expanded = true; draw(); list.querySelector<HTMLInputElement>(`input[data-col="${rest[0]!.keys[0]}"]`)?.focus(); });
        kids.push(more);
      }
      if (!kids.length) kids.push(txt("No column matches.", "t-sm muted"));
      list.replaceChildren(...kids);
    };
    find.input.addEventListener("input", draw);
    draw();
    let h: PopoverHandle | null = null;
    // Below 1180 px the List | Grouped switch moves in here from the toolbar (spec 3.7).
    const rowsSeg = narrow() ? segmented({ label: "Rows", options: [{ value: "list", label: "List" }, { value: "grouped", label: "Grouped" }], value: query.group ? "grouped" : "list", onChange: (v) => setView(v === "grouped") }) : null;
    h = popover(settingsBtn, [
      rowsSeg ? box("div", { class: "inv-pop-sec" }, txt("View", "caps"), rowsSeg) : null,
      box("div", { class: "inv-pop-sec" }, txt("Density", "caps"), density),
      el("div", { class: "divider" }),
      box("div", { class: "inv-pop-sec" }, box("div", { class: "inv-pop-head" }, txt("Columns", "caps"), el("span", { class: "spacer" }), count), find.root,
        button({ label: "Reset column widths", size: "sm", onClick: () => { setColWidths({}); rebuildTable(); } })),
      list,
      box("div", { class: "overlay-foot inv-pop-foot" },
        button({ label: "Reset to default", variant: "ghost", size: "sm", onClick: () => { setCols([...defaultCols]); paintCount(); draw(); } }),
        el("span", { class: "spacer" }),
        button({ label: "Done", size: "sm", onClick: () => h?.close() })),
    ], { label: "Table settings", width: 288 });
    h.root.classList.add("inv-pop", "inv-settings-pop");
  }
  // load()'s GET /api/ui-prefs answer (null when that request failed): the saved columns (colsFromPrefs
  // decides whether a choice this browser saved before the server kept it is adopted) and the density.
  function applyPrefs(prefs: UiPrefs | null): void {
    let legacy: unknown = null;
    try { legacy = JSON.parse(localStorage.getItem("vault.cols") || "null"); } catch { /* unreadable: nothing to adopt */ }
    const { cols, save } = colsFromPrefs(prefs, legacy);
    if (cols) view.cols = cols;
    if (save) saveCols();
    if (prefs?.density) view.density = prefs.density;
    if (prefs?.colWidths) view.colWidths = prefs.colWidths;
    rebuildTable();
  }

  // ---------------------------------------------------------------- the table: columns
  // The table's columns follow what it SHOWS: the previous query's rows stay up until the new one's first
  // chunk lands, so the header changes with the data, not with the click.
  const grouped = (): boolean => (loadedOnce ? !!page.groups : query.group);
  function columns(): ColDef[] {
    const c = (key: string, text: string, width: number, num = false, title = ""): ColDef => ({ key, label: text, title, num, width: Object.hasOwn(view.colWidths, key) ? view.colWidths[key]! : width, sortable: true });
    if (grouped()) return [c("name", "Name", 300), c("kind", "Kind", 120), c("amount", "Total", 88, true), c("stacks", "Stacks", 80, true), { ...c("where", "Where", 480), sortable: false }];
    const width = (k: string): number => (k === "seen" ? 112 : k === "kind" ? 96 : RESIST_KEYS.includes(k) ? 52 : Math.max(52, colShort(k, label).length * 8 + 28));
    const x = opts.extraColumn;
    const extra = x ? [{ ...c(EXTRA, x.label, x.width, true, x.title), sortable: false }] : [];
    // Tags, when shown, sits right after Name wherever the saved list names it; it has nothing to sort on.
    const tags = view.cols.includes("tags") ? [{ ...c("tags", "Tags", 108), sortable: false }] : [];
    // Fixed to one slot (the Suit Builder's picker), every row would read the same in a Slot column.
    const slot = fixed.slot?.length === 1 ? [] : [c("slot", "Slot", 120)];
    const sel: ColDef[] = opts.selection ? [{ key: SEL, label: "", title: "", num: false, width: 36, sortable: false }] : [];
    return [...sel, c("name", "Name", 250), ...extra, ...tags, c("rarity", "Rarity", 156), ...slot, c("location", "Location", 180),
      ...view.cols.filter((k) => k !== "tags").map((k) => c(k, colShort(k, label), width(k), !["kind", "seen", "med"].includes(k), colFull(k, full)))];
  }
  // Numbers sort highest first at dir 1 and names A to Z (item-query.mts), so the arrow follows the kind.
  function sortState(col: ColDef): "ascending" | "descending" | "none" {
    if (query.sort !== col.key) return "none";
    const ascending = col.num ? query.dir < 0 : query.dir > 0;
    return ascending ? "ascending" : "descending";
  }
  function sortedBy(): string {
    const col = columns().find((c) => c.key === query.sort);
    const name = !col ? query.sort : col.key === "name" ? "name" : col.title || col.label;
    if (col?.num) return `Sorted by ${name}, ${query.dir > 0 ? "highest" : "lowest"} first`;
    return `Sorted by ${name}${query.dir < 0 ? ", Z to A" : ""}`;
  }
  function extraCell(it: Item): HTMLTableCellElement {
    const kid = opts.extraColumn!.cell(it);
    return el("td", { class: "num" }, kid);
  }
  // A row's checkbox, or a lock with the reason it cannot be ticked.
  function selCell(it: Item, i: number): HTMLTableCellElement {
    const s = opts.selection!, why = s.locked(it);
    if (why) return el("td", { class: "sel-cell", "data-no-tip": "" }, box("span", { class: "sel-lock", role: "img", title: why, "aria-label": `${it.name}: ${why}` }, icon("lock", { size: "sm" })));
    const cb = el("input", { type: "checkbox", class: "sel-cb", "aria-label": `Select ${it.name}` });
    cb.checked = s.checked(it);
    cb.addEventListener("click", (e) => s.toggle(i, cb.checked, e.shiftKey));
    return el("td", { class: "sel-cell", "data-no-tip": "" }, cb);
  }
  function headerBox(): HTMLInputElement {
    const cb = el("input", { type: "checkbox", class: "sel-cb", "aria-label": "Select the rows loaded" });
    cb.addEventListener("click", () => opts.selection!.toggleLoaded(cb.checked));
    return cb;
  }
  function syncHeaderBox(): void {
    const h = table.tHead?.querySelector<HTMLInputElement>("input.sel-cb"), s = opts.selection;
    if (!h || !s) return;
    const st = s.header();
    h.checked = st === "all";
    h.indeterminate = st === "some";
  }
  function markPicked(): void {
    const s = opts.selection;
    if (!s || page.groups) return;
    for (const tr of rowCache.values()) {
      const it = tr.classList.contains("item") ? page.rows[+tr.dataset.index!] : undefined;
      if (!it) continue;
      const on = s.checked(it);
      tr.classList.toggle("picked", on);
      const cb = tr.querySelector<HTMLInputElement>("input.sel-cb");
      if (cb) cb.checked = on;
    }
    syncHeaderBox();
  }

  // ---------------------------------------------------------------- the table: rows
  let rowCache = new Map<number, HTMLTableRowElement>();
  let activeIndex = 0;
  let rowH = 32;
  function rowFor(i: number, cols: ColDef[]): HTMLTableRowElement {
    const cached = rowCache.get(i);
    if (cached) return cached;
    const p = page;
    let tr: HTMLTableRowElement;
    if (p.groups) {
      const g = p.groups[i];
      if (!g) return skeletonRow(cols, i);
      // a group of one stack is that item, with its tooltip; several stacks may differ, so no one of them speaks for the group
      tr = el("tr", { class: "item", ...(g.stacks === 1 ? { "data-serial": g.serial } : {}), "data-index": i, "aria-rowindex": i + 2, tabindex: "-1" }, ...cols.map((c) => groupCell(c, g)));
    } else {
      const it = p.rows[i];
      if (!it) return skeletonRow(cols, i);
      state.itemCache.set(it.serial, it);   // a drawn row IS the full record: seed the cache so the tooltip and builder never re-fetch it
      const sel = opts.detail?.serial() === it.serial, picked = !!opts.selection?.checked(it);
      tr = el("tr", { class: `item${sel ? " sel" : ""}${picked ? " picked" : ""}`, "data-serial": it.serial, "data-index": i, "aria-rowindex": i + 2, "aria-selected": String(sel), tabindex: "-1" },
        ...cols.map((c) => (c.key === EXTRA ? extraCell(it) : c.key === SEL ? selCell(it, i) : cell(c, it))), el("td", { class: "act-cell", "data-no-tip": "" }, opts.rowActions(it)));
    }
    rowCache.set(i, tr);
    return tr;
  }
  function skeletonRow(cols: ColDef[], i: number): HTMLTableRowElement {
    return el("tr", { class: "skel-row", "data-index": i, "aria-hidden": "true" },
      ...cols.map((c, j) => el("td", c.num ? { class: "num" } : {}, el("span", { class: "skel", style: c.num ? `width:${12 + ((i + j) % 3) * 4}px;margin-left:auto` : `width:${SKEL_W[(i + j) % SKEL_W.length]}%` }))),
      grouped() ? null : el("td", { class: "act-cell" }));
  }

  // ---------------------------------------------------------------- the table: data
  // A request generation, so a slow chunk of an old query can never land in a newer one's table, and the
  // chunk offsets this generation has or is fetching. `fresh` says the page still shows the previous
  // query's rows, kept on screen (never blanked) until the first chunk of the new query lands.
  let gen = 0, fresh = false, loadError: string | null = null, loadedOnce = false;
  const have = new Set<number>();
  let debounceTimer = 0;
  let wanted: number | null = null;
  function fetchItems(): void {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => requery(false), 150) as unknown as number;
  }
  function requery(toTop: boolean): void {
    gen++; have.clear(); fresh = true; emptyAlone = null;
    if (toTop) { scroller.scrollTop = 0; activeIndex = 0; }
    fetchChunk(0, gen);
  }
  async function fetchChunk(offset: number, g: number): Promise<void> {
    have.add(offset);
    let res: ItemsApiResponse;
    try { res = await source.fetch(withFixed(query, fixed), offset, CHUNK); }
    catch (e) {
      if (g !== gen) return;
      have.delete(offset);
      // The first chunk failing leaves nothing to show; a later one leaves its rows as skeletons and says so.
      if (offset === 0 && !loadedOnce) { failed(e); return; }
      toast(`Could not load more of the inventory: ${(e as Error).message}`, "bad");
      return;
    }
    if (g !== gen) return;   // a newer query has been issued since: this answer is stale
    // A row with keyboard focus is replaced below (focus would drop to <body>): the redrawn active row takes it.
    const body = table.tBodies[0]!, hadFocus = !!document.activeElement?.matches("tr.item") && body.contains(document.activeElement);
    if (fresh) {
      fresh = false; loadedOnce = true;
      rowCache = new Map();
      page = "groups" in res
        ? { rows: [], groups: new Array(res.total), total: res.total, stacks: res.stacks, pieces: res.pieces }
        : { rows: new Array(res.total), groups: null, total: res.total, stacks: res.total, pieces: res.pieces };
      activeIndex = Math.min(activeIndex, Math.max(0, res.total - 1));
      if (!res.total && tokensNow().length) findEmptyCause(g);
      renderActive();
      rebuildTable();   // the header follows the data: its sort arrow, and the grouped view's columns
    }
    const got: unknown[] = "groups" in res ? res.groups : res.rows;
    const into: unknown[] = page.groups || page.rows;
    got.forEach((r, i) => { into[offset + i] = r; rowCache.delete(offset + i); });
    renderTable();
    if (hadFocus && !body.contains(document.activeElement)) focusRow(activeIndex);   // scrolled clear of the sticky header
    // An item asked for from elsewhere (reveal): activate it once its row has landed.
    if (wanted != null && !page.groups) {
      const i = page.rows.findIndex((r) => r?.serial === wanted);
      wanted = null;
      if (i >= 0) { focusRow(i, false); activate(i); return; }
    }
    // The detail panel follows a reload: its item's new record, or closed when the item left the list.
    if (offset === 0 && !page.groups) opts.detail?.refresh((serial) => page.rows.find((r) => r?.serial === serial), page.total > CHUNK);
    else if (page.groups) opts.detail?.close();
  }

  // ---------------------------------------------------------------- the table: drawing
  let emptyAlone: string[] | null = null;
  function rebuildTable(): void {
    const t = table;
    const cols = columns(), isGrouped = grouped();
    t.classList.toggle("tbl-regular", view.density === "regular");
    t.classList.toggle("inv-selectable", !!opts.selection && !isGrouped);
    rowH = view.density === "regular" ? 40 : 32;
    t.setAttribute("aria-colcount", String(cols.length));
    const widths = cols.map((c) => c.width), colEls = cols.map((c) => el("col", { style: `width:${c.width}px` }));
    t.style.minWidth = `${widths.reduce((a, w) => a + w, 0)}px`;
    t.querySelector("colgroup")!.replaceChildren(...colEls, ...(isGrouped ? [] : [el("col", { class: "act-col" })]));
    t.querySelector("thead")!.replaceChildren(el("tr", { "aria-rowindex": 1 }, ...cols.map((c, i) => {
      if (c.key === SEL) return el("th", { class: "sel-cell", scope: "col" }, headerBox());
      const sort = c.sortable ? sortState(c) : null;
      const inner = c.sortable
        ? box("button", { type: "button", ...(c.title ? { title: c.title } : {}), onclick: () => {
          const q = query;
          setQuery(q.sort === c.key ? { ...q, dir: q.dir > 0 ? -1 : 1 } : { ...q, sort: c.key, dir: 1 });
        } }, txt(c.label), sort && sort !== "none" ? icon(sort === "ascending" ? "arrow-up" : "arrow-down", { size: "sm" }) : null)
        : txt(c.label);
      return el("th", { class: c.num ? "num" : "", scope: "col", ...(sort ? { "aria-sort": sort } : {}) }, inner, resizeHandle(c, (w) => {
        widths[i] = w;
        colEls[i]!.style.width = `${w}px`;
        t.style.minWidth = `${widths.reduce((a, x) => a + x, 0)}px`;
        scheduleRender();   // the footer's "more columns" count and the right-edge fade
      }));
    }), isGrouped ? null : el("th", { class: "act-cell", scope: "col" }, txt("Actions", "sr"))));
    // A focused row is about to be detached (focus would drop to <body>): the redrawn active row takes it.
    const body = t.querySelector("tbody")!, focused = document.activeElement;
    const rowHadFocus = !!focused?.matches("tr.item") && body.contains(focused);
    rowCache = new Map();
    body.replaceChildren();
    renderTable();
    if (rowHadFocus) rowEl(activeIndex)?.focus();
  }
  // A column's resize handle, on the right edge of its header: dragged, or ←/→ while focused. The width is
  // drawn as it changes and saved once, when the drag or key ends.
  function resizeHandle(c: ColDef, draw: (w: number) => void): HTMLElement {
    const h = el("span", { class: "col-resize", role: "separator", "aria-orientation": "vertical", "aria-label": `Resize ${c.title || c.label}`,
      "aria-valuemin": 40, "aria-valuemax": 1200, "aria-valuenow": c.width, tabindex: "0" });
    let w = c.width, saved = c.width, startX = 0, startW = 0;
    const set = (next: number): void => { w = Math.round(Math.min(1200, Math.max(40, next))); h.setAttribute("aria-valuenow", String(w)); draw(w); };
    const save = (): void => { if (w !== saved) { saved = w; setColWidths({ ...view.colWidths, [c.key]: w }); } };
    h.addEventListener("pointerdown", (e) => { if (e.button !== 0) return; e.preventDefault(); h.setPointerCapture(e.pointerId); startX = e.clientX; startW = w; h.classList.add("dragging"); });
    h.addEventListener("pointermove", (e) => { if (h.hasPointerCapture(e.pointerId)) set(startW + e.clientX - startX); });
    // after a normal pointerup, and after a pointercancel or the window losing focus mid-drag
    h.addEventListener("lostpointercapture", () => { h.classList.remove("dragging"); save(); });
    h.addEventListener("keydown", (e) => { if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return; e.preventDefault(); set(w + (e.key === "ArrowLeft" ? -16 : 16)); });
    h.addEventListener("keyup", (e) => { if (e.key === "ArrowLeft" || e.key === "ArrowRight") save(); });
    return h;
  }
  // A timer rather than requestAnimationFrame: a window in the background gets no animation frames, and the
  // table must still catch up with a scroll or resize made while it was hidden.
  let renderTimer = 0;
  function scheduleRender(): void { if (!renderTimer) renderTimer = setTimeout(() => { renderTimer = 0; renderTable(); }, 0) as unknown as number; }
  function renderTable(): void {
    const t = table, body = t.querySelector("tbody")!;
    const cols = columns(), span = cols.length + (grouped() ? 0 : 1);
    const p = page;
    if (loadError) { body.replaceChildren(); showState(errorState(loadError)); t.removeAttribute("aria-busy"); renderFoot(); return; }
    if (!loadedOnce) {
      // Still loading: skeleton rows under the real header; the filters stay usable.
      body.replaceChildren(...Array.from({ length: 14 }, (_, i) => skeletonRow(cols, i)));
      t.setAttribute("aria-busy", "true");
      stateHolder.hidden = true;
      renderFoot();
      return;
    }
    t.removeAttribute("aria-busy");
    t.setAttribute("aria-rowcount", String(p.total + 1));
    if (!p.total) { body.replaceChildren(); showState(source.facets()?.itemCount ? emptyResultState() : noScansState()); renderFoot(); return; }
    stateHolder.hidden = true;
    const head = t.tHead?.offsetHeight || 36;
    const { start, end } = rowWindow({ scrollTop: scroller.scrollTop, viewport: scroller.clientHeight - head, rowHeight: rowH, count: p.total });
    if (!fresh) for (const o of chunksToFetch(start, end, CHUNK, p.total, have)) fetchChunk(o, gen);
    const want: HTMLTableRowElement[] = [];
    for (let i = start; i < end; i++) want.push(rowFor(i, cols));
    // Patch the body instead of replacing it: the focused row is never detached (a detached row loses
    // focus), and rows already in place are not touched.
    const top = body.querySelector<HTMLTableRowElement>(":scope > tr.vpad.top") || spacer("top");
    const bottom = body.querySelector<HTMLTableRowElement>(":scope > tr.vpad.bottom") || spacer("bottom");
    const keep = new Set<Node>([top, bottom, ...want]);
    for (const n of [...body.children]) if (!keep.has(n)) n.remove();
    if (body.firstChild !== top) body.prepend(top);
    let prev: Node = top;
    for (const tr of want) { if (prev.nextSibling !== tr) body.insertBefore(tr, prev.nextSibling); prev = tr; }
    if (prev.nextSibling !== bottom) body.insertBefore(bottom, prev.nextSibling);
    for (const [pad, h] of [[top, start * rowH], [bottom, (p.total - end) * rowH]] as const) {
      const td = pad.firstChild as HTMLTableCellElement;
      td.colSpan = span;
      td.style.height = `${h}px`;
      pad.hidden = h === 0;
    }
    // One row in the tab order: the active one, or the first drawn while the active one is scrolled away.
    const rows = want.filter((tr) => tr.classList.contains("item"));
    const current = rows.find((tr) => +tr.dataset.index! === activeIndex) || rows[0];
    for (const tr of rows) tr.tabIndex = tr === current ? 0 : -1;
    // The spacers must match the real row height exactly: measure it once rows exist.
    const real = rows[0]?.getBoundingClientRect().height;
    if (real && Math.abs(real - rowH) > 0.5) { rowH = real; scheduleRender(); }
    syncHeaderBox();
    renderFoot();
  }
  function showState(node: HTMLElement): void {
    stateHolder.replaceChildren(node);
    stateHolder.hidden = false;
  }
  function emptyResultState(): HTMLElement {
    const tokens = tokensNow();
    const cause = emptyAlone ? emptyCause(tokens, emptyAlone, source.facets()?.itemCount || 0) : tokens.length === 1 ? emptyCause(tokens, [], source.facets()?.itemCount || 0) : "Checking which filter excludes everything…";
    return box("div", { class: "empty-state", ...idOf("inv-empty") }, icon("search"), el("h3", { class: "t-lg" }, "No items match"), el("p", { class: "muted" }, txt(cause)),
      tokens.length ? box("div", { class: "inv-empty-tokens" }, txt("Remove a filter:", "t-sm muted"), ...tokenEls(tokens)) : null,
      button({ label: "Clear all filters", variant: "primary", onClick: () => { setQuery(clearAll(query)); search.focus(); } }));
  }
  // Which active filters match nothing on their own: one small query per filter, asked only when the
  // result is empty, so the sentence can name the cause (spec 3.5).
  async function findEmptyCause(g: number): Promise<void> {
    const tokens = tokensNow();
    if (tokens.length < 2) { emptyAlone = []; return; }
    const alone: string[] = [];
    await Promise.all(tokens.map(async (t) => {
      // The query holding only this filter: every OTHER filter removed.
      const only = tokens.filter((o) => o.id !== t.id).reduce((q, o) => o.remove(q), { ...query });
      try {
        const r = await source.fetch(withFixed({ ...only, group: false }, fixed), 0, 1);
        if (!r.total) alone.push(t.id);
      } catch { /* the sentence falls back to naming the combination */ }
    }));
    if (g !== gen) return;
    emptyAlone = alone;
    if (!page.total) showState(emptyResultState());
  }
  function errorState(text: string): HTMLElement {
    return box("div", { class: "inv-error" }, message({ tone: "bad", title: "Couldn't load the inventory", text: `${text}. Your scans are safe on disk.`,
      actions: [
        button({ label: "Try again", variant: "primary", size: "sm", onClick: () => { loadError = null; loadedOnce = false; renderTable(); void retryLoad(); } }),
        button({ label: "Open logs", size: "sm", onClick: () => { api("/api/host/open-path", { method: "POST", body: { which: "logs" } }).catch(() => { location.hash = "#/settings"; }); } }),
      ] }));
  }
  function failed(e: unknown): void {
    loadError = String((e as Error).message || e).replace(/\.$/, "");
    for (const c of toolbar.querySelectorAll<HTMLButtonElement | HTMLInputElement>("button, input")) c.disabled = true;
    renderTable();
  }
  function renderFoot(): void {
    const p = page;
    if (!loadedOnce || loadError) {
      foot.replaceChildren(...(loadError ? [txt("Nothing loaded")] : [el("span", { class: "dot busy" }), txt("Loading inventory…"), el("span", { class: "spacer" }), txt("Filters stay usable")]));
      fade.hidden = true;
      return;
    }
    const tokens = tokensNow(), all = allCols(), more = hiddenCols(), total = source.facets()?.itemCount || 0;
    fade.hidden = !more;
    const stacks = countFact({ shown: p.groups ? p.stacks : p.total, total, pieces: p.pieces, filtered: tokens.length > 0 });
    const kids: Array<HTMLElement | null> = [txt(p.groups ? `${plural(p.total, "name")} · ${stacks}` : stacks, "inv-count"),
      tokens.length ? dot() : null, tokens.length ? txt(plural(tokens.length, "filter"), "inv-foot-filters") : null, el("span", { class: "spacer" })];
    if (more) kids.push(box("span", { class: "inv-more-cols" }, txt(`Scroll right for ${more} more ${more === 1 ? "column" : "columns"}`), icon("arrow-right", { size: "sm" })));
    // How the table is sorted and how many columns it shows: dropped first when the card gets narrow.
    kids.push(box("span", { class: "inv-foot-view" }, more ? dot() : null, txt(sortedBy()), ...(p.groups ? [] : [dot(), txt(`${view.cols.filter((c) => all.includes(c)).length} of ${all.length} columns`)])));
    foot.replaceChildren(...kids.filter((k): k is HTMLElement => !!k));
  }
  // How many header cells sit wholly or partly past the scroller's right edge.
  function hiddenCols(): number {
    const edge = scroller.getBoundingClientRect().right;
    let n = 0;
    for (const th of scroller.querySelectorAll<HTMLElement>("thead th:not(.act-cell)")) if (th.getBoundingClientRect().right > edge + 1) n++;
    return n;
  }

  // ---------------------------------------------------------------- keyboard, focus, pointer
  function rowEl(i: number): HTMLTableRowElement | null { return table.querySelector<HTMLTableRowElement>(`tbody tr.item[data-index="${i}"]`); }
  // Scroll row i into view under the sticky header, draw, and focus it.
  function focusRow(i: number, focus = true): void {
    const head = table.tHead?.offsetHeight || 36;
    activeIndex = Math.max(0, Math.min(page.total - 1, i));
    const top = activeIndex * rowH, viewH = scroller.clientHeight - head;
    if (top < scroller.scrollTop) scroller.scrollTop = top;
    else if (top + rowH > scroller.scrollTop + viewH) scroller.scrollTop = top + rowH - viewH;
    renderTable();
    if (focus) rowEl(activeIndex)?.focus();
  }
  // A row's primary action: a list row is the caller's (onActivate), a grouped row opens its stacks.
  function activate(i: number): void {
    if (page.groups) { showGroup(i); return; }
    const it = page.rows[i];
    if (it) opts.onActivate(it, i);
  }
  // The detail panel's row marked selected (accent fill and edge).
  function markSelected(): void {
    const serial = opts.detail?.serial() ?? null;
    for (const tr of rowCache.values()) {
      if (!tr.classList.contains("item")) continue;
      const on = serial != null && +(tr.dataset.serial || -1) === serial;
      tr.classList.toggle("sel", on);
      tr.setAttribute("aria-selected", String(on));
    }
  }
  function wireTable(): void {
    const body = table.querySelector("tbody")!;
    const detailOpen = (): boolean => !!opts.detail?.open();
    scroller.addEventListener("scroll", () => { scroller.classList.toggle("scrolled-x", scroller.scrollLeft > 0); scheduleRender(); }, { passive: true });
    new ResizeObserver(scheduleRender).observe(scroller);
    body.addEventListener("keydown", (e) => {
      const tr = e.target as HTMLElement;
      if (!tr.matches("tr.item")) return;
      const i = +tr.dataset.index!;
      const pageRows = Math.max(1, Math.floor((scroller.clientHeight - 36) / rowH) - 1);
      if (e.key === "ArrowUp" && i === 0) { e.preventDefault(); table.tHead?.querySelector("button")?.focus(); return; }
      const m = gridKey(e.key, i, page.total, pageRows);
      if (!m || (m.kind === "close" && !detailOpen())) return;
      e.preventDefault();
      if (m.kind === "move") { focusRow(m.index); if (detailOpen() && !page.groups) activate(m.index); }
      else if (m.kind === "open") activate(i);
      else opts.detail!.close(true);
    });
    body.addEventListener("focusin", (e) => {
      const tr = (e.target as HTMLElement).closest<HTMLTableRowElement>("tr.item");
      if (!tr) return;
      // Focusing a row for 400 ms shows its item tooltip, as hovering does (spec 3.6); not while the detail
      // panel already shows the item in full.
      if (e.target === tr && tr.dataset.serial && !detailOpen() && tr.matches(":focus-visible")) showItemTip(+tr.dataset.serial, tr);
      if (+tr.dataset.index! === activeIndex) return;
      activeIndex = +tr.dataset.index!;
      for (const r of body.querySelectorAll<HTMLTableRowElement>("tr.item")) r.tabIndex = r === tr ? 0 : -1;
    });
    body.addEventListener("focusout", () => hideItemTip());
    // A cut-off cell shows its whole text as a native tooltip, set on the first hover; a list row's name and
    // location are left to the item tooltip, which already shows both in full.
    body.addEventListener("mouseover", (e) => {
      const td = (e.target as HTMLElement).closest("td");
      if (!td || td.title || td.classList.contains("act-cell") || (td.parentElement!.dataset.serial && ["name", "location"].includes(columns()[td.cellIndex]?.key ?? ""))) return;
      if ([td, ...td.querySelectorAll<HTMLElement>(".ellip")].some((n) => n.scrollWidth > n.clientWidth)) td.title = td.innerText.replace(/\s+/g, " ").trim();
    });
    // From a column header, ↓ goes into the rows (the header comes first in the tab order); ↑ from the first
    // row comes back up to the Name header.
    table.tHead!.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowDown" || !page.total) return;
      e.preventDefault();
      focusRow(activeIndex);
    });
    body.addEventListener("click", (e) => {
      const t = e.target as HTMLElement;
      if (t.closest(".act-cell, .sel-cell")) return;
      const tr = t.closest<HTMLTableRowElement>("tr.item");
      if (!tr) return;
      activeIndex = +tr.dataset.index!;
      tr.focus();
      activate(activeIndex);
    });
    // "/" focuses the search from anywhere on the browser's screen (spec 3.6): only a shown browser answers, and
    // not when the key is pressed inside another one.
    document.addEventListener("keydown", (e) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, [contenteditable], dialog, .drawer-root") || root.offsetParent === null) return;
      const owner = t.closest("[data-item-browser]");
      if (owner && owner !== root) return;
      e.preventDefault();
      search.focus(); search.select();
    });
    document.addEventListener("bridgechange", () => { rowCache = new Map(); renderTable(); });
  }
  // A grouped row opens its stacks: the list view searching for that name.
  function showGroup(i: number): void {
    const g = page.groups?.[i];
    if (g) setQuery({ ...query, group: false, q: g.name.toLowerCase(), sort: "name", dir: 1 });
  }

  buildToolbar();
  wireTable();
  rebuildTable();
  return {
    get query() { return query; },
    get page() { return page; },
    get activeIndex() { return activeIndex; },
    set activeIndex(i: number) { activeIndex = i; },
    setQuery,
    fetch: fetchItems,
    sync: () => {
      for (const c of toolbar.querySelectorAll<HTMLButtonElement | HTMLInputElement>("button, input")) c.disabled = false;
      loadError = null;
      syncToolbar();
    },
    failed,
    applyPrefs,
    focusRow,
    markSelected,
    markPicked,
    reveal: (serial) => { wanted = serial; },
  };
}
