// ui/inventory.mts — the Inventory screen's Items view (design spec 4.2): the filter toolbar and its
// popovers, the active-filter strip, the columns and density popover, and the virtual table over
// GET /api/items. state.query is the filter state (the shape item-query.mts's parseItemQuery reads);
// inv-model.mts holds the pure rules (query string, token wording, counts, row window, keyboard model).
//
// The table has no pager: it is virtual. Its body draws only the rows in view (plus a few either side)
// between two spacer rows sized to the rest, and loads the matching rows from the server in 500-row
// chunks as they scroll into view, so a large inventory costs one request per screenful reached, never
// a pager click.
import { SLOT_LABELS, tagUnits } from "../vault-lib.mts";
import type { Item } from "../vault-lib.mts";
import type { ItemQuery, Place } from "../item-query.mts";
import { state } from "./store.mts";
import { $, el, label, full, slotLabel, rarityColor, safeColor, toast } from "./dom.mts";
import { rarityToken } from "./items.mts";
import { api } from "./api.mts";
import { bridgeActionReason, runBridgeAction } from "./bridge.mts";
import { optionsKeeping, colsFromPrefs, COLS_VERSION } from "./view-state.mts";
import { relativeWhen } from "./messages.mts";
import { txt, box, icon, button, searchInput, filterChip, token, pill, segmented, switchControl, popover, closePopover, rowActions, message, menu, input, nextId } from "./components.mts";
import type { Kids, MenuItem, PopoverHandle } from "./components.mts";
import { plural, queryParams, activeFilters, clearAll, matchLine, countFact, emptyCause, rowWindow, chunksToFetch, gridKey, colShort, colFull, groupColumns, COL_GROUPS, DEFAULT_COLS, ITEM_COLS, shortTier, rootName } from "./inv-model.mts";
import type { FilterToken } from "./inv-model.mts";
import type { ItemsApiResponse, UiPrefs } from "./api-types.mts";
import { initPeek, openPeek, closePeek, peekOpen, peekSerial, peekRefresh } from "./peek.mts";
import { showItemTip, hideItemTip } from "./dom.mts";

const CHUNK = 500;              // rows per GET /api/items request (the server's own cap)
const NARROW = "(max-width: 1179px)";
const narrow = (): boolean => matchMedia(NARROW).matches;
const $el = <E extends HTMLElement = HTMLElement>(sel: string): E => $<E>(sel)!;

// ---------------------------------------------------------------- the filter state
function filterContext() {
  return {
    slotLabel: (s: string) => slotLabel(s),
    propLabel: (k: string) => label(k),
    places: state.facets?.places || [],
    ladder: (state.rules?.rarity || []).map((r) => r.name),
  };
}
const tokensNow = (): FilterToken[] => activeFilters(state.query, filterContext());
// Every filter control lands here: the new state, the toolbar's chips and the strip redrawn, and the
// table refetched from its first row.
function setQuery(next: ItemQuery): void {
  // A search keystroke still waiting out its debounce is superseded by any other change (Clear all above
  // all): left to fire, it would re-apply the search box's text over the new state and throw the table
  // back to its first row.
  clearTimeout(searchTimer);
  state.query = { ...next, offset: 0 };
  syncToolbar();
  requery(true);
}

// ---------------------------------------------------------------- toolbar
type ChipId = "char" | "slot" | "loc" | "rarity" | "kind" | "slayer" | "seen";
const chips = {} as Record<ChipId, HTMLButtonElement>;
let search: HTMLInputElement, addChip: HTMLButtonElement, viewSeg: HTMLDivElement & { setValue: (v: string) => void }, settingsBtn: HTMLButtonElement;
const FACETS: ChipId[] = ["char", "slot", "loc", "rarity", "kind"];
const CHIP_NAMES: Record<ChipId, string> = { char: "Character", slot: "Slot", loc: "Location", rarity: "Rarity", kind: "Kind", slayer: "Slayer", seen: "Seen" };

// A chip's words: "Slot", "Slot: Ring", "Slot: Ring +2".
function chipText(id: ChipId): string {
  const q = state.query, name = CHIP_NAMES[id];
  const many = (xs: string[]): string => (xs.length ? `${name}: ${xs[0]}${xs.length > 1 ? ` +${xs.length - 1}` : ""}` : name);
  switch (id) {
    case "char": return many(q.chars);
    case "slot": return many(q.slot.map((s) => (s === "?" ? "no slot" : slotLabel(s))));
    case "loc": return many([...q.roots.map((r) => splitSerial(rootName(r, state.facets?.places || [])).name), ...q.loc]);
    case "rarity": return q.rarityMin ? `Rarity ≥ ${shortTier(q.rarityMin)}` : name;
    case "kind": return many(q.kind);
    case "slayer": return q.slayer === "*" ? "Any slayer" : `Slayer: ${q.slayer}`;
    case "seen": return `Seen: ${q.seenDays === 1 ? "24 h" : `${q.seenDays} days`}`;
  }
}
function chipSet(id: ChipId): boolean {
  const q = state.query;
  switch (id) {
    case "char": return q.chars.length > 0;
    case "slot": return q.slot.length > 0;
    case "loc": return q.loc.length + q.roots.length > 0;
    case "rarity": return !!q.rarityMin;
    case "kind": return q.kind.length > 0;
    case "slayer": return !!q.slayer;
    case "seen": return !!q.seenDays;
  }
}
// The chips are updated in place (never rebuilt), so an open popover keeps its anchor.
function syncToolbar(): void {
  if (!search) return;
  for (const id of Object.keys(chips) as ChipId[]) {
    const c = chips[id], on = chipSet(id);
    c.querySelector("span")!.textContent = chipText(id);
    c.classList.toggle("set", on);
    // Slayer and Seen live behind "+ Filter" and show as a chip only while set.
    if (id === "slayer" || id === "seen") c.hidden = !on;
  }
  if (search.value.trim().toLowerCase() !== state.query.q) search.value = state.query.q;
  viewSeg.setValue(state.query.group ? "grouped" : "list");
  renderActive();
}

let searchTimer = 0;
function buildToolbar(): void {
  const s = searchInput({ label: "Search items", placeholder: "Search name, property, slayer, location", hint: "/", attrs: { id: "f-text", "data-stop": "" } });
  search = s.input;
  s.root.classList.add("inv-search");
  search.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      const q = search.value.trim().toLowerCase();
      if (q !== state.query.q) setQuery({ ...state.query, q });
    }, 150) as unknown as number;
  });
  search.addEventListener("keydown", (e) => { if (e.key === "Escape" && search.value) { e.stopPropagation(); search.value = ""; setQuery({ ...state.query, q: "" }); } });
  for (const id of [...FACETS, "slayer", "seen"] as ChipId[]) {
    chips[id] = filterChip({ label: CHIP_NAMES[id], attrs: { id: `f-${id}`, "data-stop": "", ...(FACETS.includes(id) ? { "data-facet": "" } : {}) }, onClick: () => openFacet(id, chips[id]) });
  }
  addChip = filterChip({ label: "Filter", add: true, attrs: { id: "f-add", "data-stop": "" }, onClick: () => openAddMenu() });
  viewSeg = segmented({ label: "Rows", options: [{ value: "list", label: "List" }, { value: "grouped", label: "Grouped" }], value: "list", onChange: (v) => setView(v === "grouped") });
  viewSeg.id = "inv-rows";
  settingsBtn = button({ label: "Table settings: columns and density", icon: "sliders", iconOnly: true, size: "sm", attrs: { id: "inv-settings", "aria-haspopup": "dialog", "aria-expanded": "false", "data-stop": "" }, onClick: () => openSettings() });
  $el("#inv-toolbar").replaceChildren(s.root, ...FACETS.map((id) => chips[id]), chips.slayer, chips.seen, addChip, el("span", { class: "spacer" }), viewSeg, settingsBtn);
  rovingToolbar($el("#inv-toolbar"));
  syncToolbar();
}
function setView(grouped: boolean): void {
  if (state.query.group === grouped) return;
  if (grouped) closePeek();
  // The grouped view sorts by Name, Kind, Total or Stacks; any other sort falls back to Name.
  const keep = grouped ? ["name", "kind", "amount", "stacks"].includes(state.query.sort) : state.query.sort !== "stacks";
  setQuery({ ...state.query, group: grouped, ...(keep ? {} : { sort: "name", dir: 1 as const }) });
}

// Toolbar keyboard (spec 3.6): one tab stop; ←/→ move between the controls, Home/End jump. In the search
// field the arrows move the caret until it reaches an end. The List/Grouped radios keep ↑/↓ for their value.
function rovingToolbar(bar: HTMLElement): void {
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

// ---------------------------------------------------------------- facet popovers
interface Option { value: string; label: string; count?: number | undefined; group?: string | undefined; sub?: boolean | undefined; mono?: string | undefined }
// A checklist popover body: an optional search (past seven options), the options (grouped when they
// carry a group), and a Clear button once anything is picked.
function checklist({ title, options, selected, onChange, searchable = options.length > 7 }: { title: string; options: Option[]; selected: string[]; onChange: (next: string[]) => void; searchable?: boolean }): Kids {
  let picked = [...selected];
  const list = box("div", { class: "inv-opts", role: "group", "aria-label": title });
  const clear = button({ label: "Clear", variant: "ghost", size: "sm", onClick: () => { picked = []; for (const i of list.querySelectorAll<HTMLInputElement>("input")) i.checked = false; onChange(picked); clear.hidden = true; } });
  clear.hidden = !picked.length;
  const draw = (filter: string): void => {
    const kids: HTMLElement[] = [];
    let group: string | undefined;
    for (const o of options) {
      if (filter && !`${o.label} ${o.mono || ""} ${o.group || ""}`.toLowerCase().includes(filter)) continue;
      if (o.group && o.group !== group) { group = o.group; kids.push(txt(o.group, "inv-opt-group t-sm muted")); }
      const cb = el("input", { type: "checkbox", value: o.value });
      cb.checked = picked.includes(o.value);
      cb.addEventListener("change", () => {
        picked = cb.checked ? [...picked, o.value] : picked.filter((v) => v !== o.value);
        clear.hidden = !picked.length;
        onChange(picked);
      });
      kids.push(box("label", { class: `check inv-opt${o.sub ? " sub" : ""}` }, cb, txt(o.label, "ellip"), o.mono ? txt(o.mono, "mono faint") : null, o.count != null ? txt(o.count.toLocaleString("en-US"), "inv-opt-count") : null));
    }
    if (!kids.length) kids.push(txt("Nothing matches.", "t-sm muted"));
    list.replaceChildren(...kids);
  };
  draw("");
  const find = searchable ? searchInput({ label: `Find a ${title.toLowerCase()}`, placeholder: `Find a ${title.toLowerCase()}` }) : null;
  if (find) { find.input.classList.add("input-sm"); find.input.addEventListener("input", () => draw(find.input.value.trim().toLowerCase())); }
  return [box("div", { class: "inv-pop-head" }, txt(title, "caps"), el("span", { class: "spacer" }), clear), find?.root, list];
}
const SLOT_GROUPS: Record<string, string> = {
  helmet: "Armour", chest: "Armour", arms: "Armour", hands: "Armour", legs: "Armour",
  neck: "Jewellery", ring: "Jewellery", bracelet: "Jewellery", earrings: "Jewellery", talisman: "Jewellery",
  oneHanded: "Weapons", twoHanded: "Weapons",
  cloak: "Clothing", robe: "Clothing", tunic: "Clothing", shirt: "Clothing", feet: "Clothing", waist: "Clothing",
};
const SLOT_GROUP_ORDER = ["Armour", "Jewellery", "Weapons", "Clothing", "Other"];
function placesByCharacter(): Map<string, Place[]> {
  const m = new Map<string, Place[]>();
  for (const p of state.facets?.places || []) m.set(p.character, [...(m.get(p.character) || []), p]);
  return m;
}
// A picked value the facets no longer have (its last item was forgotten) stays listed, so the list keeps
// showing the filter the table still applies (view-state.mts's optionsKeeping).
const keeping = (opts: Option[], picked: string[], labelOf: (v: string) => string): Option[] =>
  picked.reduce<Option[]>((acc, v) => optionsKeeping(acc as Array<Option & { label: string }>, v, (x) => `${labelOf(x)} (none now)`), opts);
function charOptions(): Option[] {
  const by = placesByCharacter();
  const names = [...new Set([...Object.keys(state.inv?.characters || {}), ...by.keys()])].filter((n) => n && n !== "?").sort();
  return keeping(names.map((n) => ({ value: n, label: n, count: (by.get(n) || []).reduce((a, p) => a + p.count, 0) })), state.query.chars, String);
}
function slotOptions(): Option[] {
  const order = Object.keys(SLOT_LABELS);
  const opts: Option[] = (state.facets?.slots || []).map((s) => ({ value: s, label: slotLabel(s), group: SLOT_GROUPS[s] || "Other" }))
    .sort((a, b) => SLOT_GROUP_ORDER.indexOf(a.group!) - SLOT_GROUP_ORDER.indexOf(b.group!) || order.indexOf(a.value) - order.indexOf(b.value));
  opts.push({ value: "?", label: "No known slot", group: "Other" });
  return keeping(opts, state.query.slot, slotLabel);
}
function kindOptions(): Option[] {
  return keeping((state.facets?.kinds || []).map((k) => ({ value: k.name, label: k.name, count: k.count })), state.query.kind, String);
}
// "Metal Chest (0x700b0000)" → the name and its serial, drawn apart (the serial in faint mono).
export function splitSerial(text: string): { name: string; serial: string } {
  const m = text.match(/^(.*?)\s*\((0x[0-9a-f]+)\)(.*)$/i);
  return m ? { name: `${m[1]}${m[3]}`, serial: m[2]! } : { name: text, serial: "" };
}
// The Location tree: each character's worn set, backpack and bank (with the bags inside them), then the
// containers on the ground. A root's checkbox takes everything inside it; a bag's takes just that bag.
function locationOptions(): Option[] {
  const out: Option[] = [];
  const add = (group: string, ps: Place[], nameOf: (p: Place) => string): void => {
    const roots = new Map<number, Place[]>();
    for (const p of ps) if (p.root != null) roots.set(p.root, [...(roots.get(p.root) || []), p]);
    for (const [root, inRoot] of roots) {
      const top = inRoot.reduce((a, b) => (a.text.length <= b.text.length ? a : b));
      const serial = splitSerial(top.rootName).serial;
      out.push({ value: `root:${root}`, label: nameOf(top), group, count: inRoot.reduce((a, p) => a + p.count, 0), ...(serial ? { mono: serial } : {}) });
      for (const p of inRoot) if (p.text.includes(" › ")) out.push({ value: `loc:${p.text}`, label: p.text.split(" › ").slice(1).join(" › "), group, sub: true, count: p.count });
    }
  };
  const ground: Place[] = [];
  for (const [who, ps] of [...placesByCharacter()].sort(([a], [b]) => a.localeCompare(b))) {
    const worn = ps.find((p) => p.kind === "equipped");
    if (worn) out.push({ value: `loc:${worn.text}`, label: "Worn", group: who, count: worn.count });
    add(who, ps.filter((p) => p.kind === "backpack"), () => "Backpack");
    add(who, ps.filter((p) => p.kind === "bank"), () => "Bank");
    ground.push(...ps.filter((p) => !["equipped", "backpack", "bank"].includes(p.kind)));
  }
  add("On the ground", ground, (p) => splitSerial(p.rootName).name);
  for (const r of state.query.roots) if (!out.some((o) => o.value === `root:${r}`)) out.push({ value: `root:${r}`, label: `${rootName(r, [])} (none now)`, group: "No longer scanned" });
  for (const l of state.query.loc) if (!out.some((o) => o.value === `loc:${l}`)) out.push({ value: `loc:${l}`, label: `${l} (none now)`, group: "No longer scanned" });
  return out;
}
// A single-choice list of radios; picking one sets the filter and closes the popover.
function radioList(title: string, rows: Array<{ value: string; label: HTMLElement; count?: number | undefined }>, current: string, pick: (v: string) => void): HTMLElement {
  const name = nextId("radio");
  return box("div", { class: "inv-opts", role: "radiogroup", "aria-label": title }, ...rows.map((row) => {
    const r = el("input", { type: "radio", name, value: row.value });
    r.checked = current === row.value;
    r.addEventListener("change", () => pick(row.value));
    return box("label", { class: "check inv-opt" }, r, row.label, row.count != null ? txt(row.count.toLocaleString("en-US"), "inv-opt-count") : null);
  }));
}
function rarityPanel(close: () => void): Kids {
  const ladder = state.rules?.rarity || [];
  return [box("div", { class: "inv-pop-head" }, txt("Rarity at least", "caps")),
    radioList("Rarity at least", [{ value: "", label: txt("Any rarity") }, ...ladder.map((t) => ({ value: t.name, label: rarityEl(t.name) ?? txt(t.name) }))],
      state.query.rarityMin, (v) => { setQuery({ ...state.query, rarityMin: v }); close(); })];
}
function slayerPanel(close: () => void): Kids {
  const f = state.facets;
  return [box("div", { class: "inv-pop-head" }, txt("Slayer", "caps")),
    radioList("Slayer", [{ value: "", label: txt("No slayer filter") }, { value: "*", label: txt("Any slayer"), count: f?.slayerAny || 0 }, ...(f?.slayers || []).map((s) => ({ value: s.name, label: txt(s.name, "ellip"), count: s.count }))],
      state.query.slayer, (v) => { setQuery({ ...state.query, slayer: v }); close(); })];
}
function seenPanel(): Kids {
  const seg = segmented({ label: "Seen", options: [{ value: "0", label: "Any" }, { value: "1", label: "24 h" }, { value: "7", label: "7 days" }, { value: "30", label: "30 days" }], value: String(state.query.seenDays || 0), onChange: (v) => setQuery({ ...state.query, seenDays: +v }) });
  return [box("div", { class: "inv-pop-head" }, txt("Seen in the last", "caps")), seg];
}
function tagsPanel(): Kids {
  const pills = Object.keys(tagUnits()).map((t) => pill({ label: cap(t), pressed: state.query.hideTags.includes(t), off: true,
    onToggle: (on) => setQuery({ ...state.query, hideTags: on ? [...state.query.hideTags, t] : state.query.hideTags.filter((x) => x !== t) }) }));
  return [box("div", { class: "inv-pop-head" }, txt("Hide items tagged", "caps")), box("div", { class: "inv-pills" }, ...pills), txt("A struck-through tag is hidden.", "t-sm muted")];
}
function gearPanel(): Kids {
  const garg = switchControl({ label: "Hide gargoyle-only gear", checked: state.query.nogarg, onChange: (on) => setQuery({ ...state.query, nogarg: on }) });
  const med = switchControl({ label: "Meditation-safe gear only", checked: state.query.med, onChange: (on) => setQuery({ ...state.query, med: on }) });
  return [box("div", { class: "inv-pop-head" }, txt("Gear", "caps")), garg.root, med.root];
}
function facetPanel(id: ChipId, close: () => void): Kids {
  const q = state.query;
  switch (id) {
    case "char": return checklist({ title: "Character", options: charOptions(), selected: q.chars, onChange: (v) => setQuery({ ...state.query, chars: v }) });
    case "slot": return checklist({ title: "Slot", options: slotOptions(), selected: q.slot, searchable: false, onChange: (v) => setQuery({ ...state.query, slot: v }) });
    case "kind": return checklist({ title: "Kind", options: kindOptions(), selected: q.kind, onChange: (v) => setQuery({ ...state.query, kind: v }) });
    case "loc": return checklist({ title: "Location", options: locationOptions(), selected: [...q.roots.map((r) => `root:${r}`), ...q.loc.map((l) => `loc:${l}`)], searchable: true,
      onChange: (v) => setQuery({ ...state.query, roots: v.filter((x) => x.startsWith("root:")).map((x) => +x.slice(5)), loc: v.filter((x) => x.startsWith("loc:")).map((x) => x.slice(4)) }) });
    case "rarity": return rarityPanel(close);
    case "slayer": return slayerPanel(close);
    case "seen": return seenPanel();
  }
}
function openPanel(anchor: HTMLElement, title: string, body: (close: () => void) => Kids, width = 280): void {
  let h: PopoverHandle | null = null;
  h = popover(anchor, body(() => h?.close()), { label: title, width });
  h.root.classList.add("inv-pop");
}
const openFacet = (id: ChipId, anchor: HTMLElement): void => openPanel(anchor, CHIP_NAMES[id], (c) => facetPanel(id, c), id === "loc" ? 320 : 280);

// ---------------------------------------------------------------- "+ Filter"
function openAddMenu(): void {
  const entries: MenuItem[] = [];
  // Below 1180 px the unset facet chips fold in here, so the toolbar never wraps (spec 3.7).
  if (narrow()) for (const id of FACETS) if (!chipSet(id)) entries.push({ label: `${CHIP_NAMES[id]}…`, onSelect: () => openFacet(id, addChip) });
  entries.push(
    { label: "Property rule…", onSelect: () => openPanel(addChip, "Property rule", propertyPanel, 300) },
    { label: "Slayer…", onSelect: () => openPanel(addChip, "Slayer", slayerPanel) },
    { label: "Seen…", onSelect: () => openPanel(addChip, "Seen", () => seenPanel()) },
    { label: "Hide tags…", onSelect: () => openPanel(addChip, "Hide tags", () => tagsPanel()) },
    { label: "Gargoyle and meditation…", onSelect: () => openPanel(addChip, "Gear", () => gearPanel()) },
  );
  menu(addChip, entries, { label: "Add a filter" });
}
// A property rule: the property (searchable, grouped like the column picker), ≥ ≤ =, a number. Rules
// add up (an item must pass every one), which the popover says.
function propertyPanel(close: () => void): Kids {
  const keys = [...new Set([...state.propKeys, "strReq", "weight"])];
  let key = "", op = "ge";
  const chosen = txt("Pick a property", "t-sm muted");
  const find = searchInput({ label: "Find a property", placeholder: "Find a property" });
  find.input.classList.add("input-sm");
  const list = box("div", { class: "inv-opts inv-prop-list", role: "listbox", "aria-label": "Properties" });
  const num = input({ type: "number", value: 1, size: "sm", attrs: { "aria-label": "Value" } });
  const opSeg = segmented({ label: "Comparison", options: [{ value: "ge", label: "≥" }, { value: "le", label: "≤" }, { value: "eq", label: "=" }], value: "ge", onChange: (v) => { op = v; } });
  const add = button({ label: "Add rule", variant: "primary", size: "sm", disabled: true, onClick: () => {
    if (!key || num.value === "" || !Number.isFinite(+num.value)) { num.focus(); return; }
    setQuery({ ...state.query, props: [...state.query.props, { key, min: +num.value, ...(op === "ge" ? {} : { op: op as "le" | "eq" }) }] });
    close();
  } });
  const draw = (filter: string): void => {
    const kids: HTMLElement[] = [];
    for (const g of groupColumns(keys)) {
      const ks = g.keys.filter((k) => !filter || `${label(k)} ${colFull(k, full)}`.toLowerCase().includes(filter));
      if (!ks.length) continue;
      kids.push(txt(g.group, "inv-opt-group t-sm muted"));
      for (const k of ks) {
        const b = box("button", { type: "button", class: "menu-item inv-prop", role: "option", "aria-selected": String(k === key) }, txt(colFull(k, full), "ellip"), txt(label(k), "t-sm muted"));
        b.addEventListener("click", () => {
          key = k; chosen.textContent = colFull(k, full); chosen.className = "t-sm strong"; add.disabled = false;
          for (const o of list.querySelectorAll("[role=option]")) o.setAttribute("aria-selected", String(o === b));
          num.focus(); num.select();
        });
        kids.push(b);
      }
    }
    list.replaceChildren(...(kids.length ? kids : [txt("No property matches.", "t-sm muted")]));
  };
  find.input.addEventListener("input", () => draw(find.input.value.trim().toLowerCase()));
  num.addEventListener("keydown", (e) => { if (e.key === "Enter") add.click(); });
  draw("");
  return [box("div", { class: "inv-pop-head" }, txt("Property rule", "caps")), find.root, list, chosen, box("div", { class: "inv-rule" }, opSeg, num, add), txt("An item must pass every rule you add.", "t-sm muted")];
}

// ---------------------------------------------------------------- active-filter strip
function renderActive(): void {
  const strip = $el("#inv-active");
  const tokens = tokensNow();
  strip.hidden = !tokens.length;
  if (!tokens.length) { strip.replaceChildren(); return; }
  const p = state.page;
  strip.replaceChildren(
    txt(matchLine({ shown: p.stacks, total: state.facets?.itemCount || 0, grouped: !!p.groups, names: p.total }), "t-sm muted inv-match"),
    ...tokenEls(tokens),
    button({ label: "Clear all", variant: "ghost", size: "sm", attrs: { id: "f-clear" }, onClick: () => { closePopover(); setQuery(clearAll(state.query)); search.focus(); } }));
}
const tokenEls = (tokens: FilterToken[]): HTMLElement[] => tokens.map((t) => token({ label: t.label, removeLabel: t.removeLabel, onRemove: () => setQuery(t.remove(state.query)) }));

// ---------------------------------------------------------------- columns and density popover
// Every column the picker offers: the inventory's property keys plus the item's own fields and whatever
// the saved choice names.
const allCols = (): string[] => [...new Set([...state.propKeys, ...ITEM_COLS, ...state.cols])];
// The column choice is kept by the server (<data>/ui-prefs.json), not localStorage: the desktop app
// serves the page from a new port on every launch, and localStorage belongs to one origin.
function saveCols(): void {
  api("/api/ui-prefs", { method: "PUT", body: { cols: state.cols, colsVersion: COLS_VERSION } }).catch((e: Error) => toast(`Could not save the column choice: ${e.message}`, "bad"));
}
function setCols(cols: string[]): void { state.cols = cols; saveCols(); rebuildTable(); }
function openSettings(): void {
  const all = allCols();
  const count = txt("", "t-sm muted");
  const paintCount = (): void => { count.textContent = `${state.cols.filter((c) => all.includes(c)).length} of ${all.length}`; };
  paintCount();
  const density = segmented({ label: "Row density", options: [{ value: "dense", label: "Dense · 32" }, { value: "regular", label: "Regular · 40" }], value: state.density, onChange: (v) => {
    state.density = v === "regular" ? "regular" : "dense";
    api("/api/ui-prefs", { method: "PUT", body: { density: state.density } }).catch((e: Error) => toast(`Could not save the density: ${e.message}`, "bad"));
    rebuildTable();
  } });
  const find = searchInput({ label: "Find a column", placeholder: "Find a column", attrs: { id: "inv-col-q" } });
  find.input.classList.add("input-sm");
  const list = box("div", { class: "inv-opts", id: "inv-cols" });
  let expanded = false;
  const draw = (): void => {
    const filter = find.input.value.trim().toLowerCase();
    const groups = groupColumns(all);
    const open = new Set<string>(expanded || filter ? COL_GROUPS : COL_GROUPS.slice(0, 3));
    const kids: HTMLElement[] = [];
    for (const g of groups) {
      if (!open.has(g.group)) continue;
      const keys = g.keys.filter((k) => !filter || `${colShort(k, label)} ${colFull(k, full)}`.toLowerCase().includes(filter));
      if (!keys.length) continue;
      kids.push(txt(g.group, "inv-opt-group t-sm muted"));
      for (const k of keys) {
        const cb = el("input", { type: "checkbox", "data-col": k });
        cb.checked = state.cols.includes(k);
        cb.addEventListener("change", () => { setCols(cb.checked ? [...state.cols, k] : state.cols.filter((c) => c !== k)); paintCount(); });
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
  const view = narrow() ? segmented({ label: "Rows", options: [{ value: "list", label: "List" }, { value: "grouped", label: "Grouped" }], value: state.query.group ? "grouped" : "list", onChange: (v) => setView(v === "grouped") }) : null;
  h = popover(settingsBtn, [
    view ? box("div", { class: "inv-pop-sec" }, txt("View", "caps"), view) : null,
    box("div", { class: "inv-pop-sec" }, txt("Density", "caps"), density),
    el("div", { class: "divider" }),
    box("div", { class: "inv-pop-sec" }, box("div", { class: "inv-pop-head" }, txt("Columns", "caps"), el("span", { class: "spacer" }), count), find.root),
    list,
    box("div", { class: "overlay-foot inv-pop-foot" },
      button({ label: "Reset to default", variant: "ghost", size: "sm", onClick: () => { setCols([...DEFAULT_COLS]); paintCount(); draw(); } }),
      el("span", { class: "spacer" }),
      button({ label: "Done", size: "sm", onClick: () => h?.close() })),
  ], { label: "Table settings", width: 288 });
  h.root.classList.add("inv-pop", "inv-settings-pop");
}
// load()'s GET /api/ui-prefs answer (null when that request failed): the saved columns (colsFromPrefs
// decides whether a choice this browser saved before the server kept it is adopted) and the density.
export function applyUiPrefs(prefs: UiPrefs | null): void {
  let legacy: unknown = null;
  try { legacy = JSON.parse(localStorage.getItem("vault.cols") || "null"); } catch { /* unreadable: nothing to adopt */ }
  const { cols, save } = colsFromPrefs(prefs, legacy);
  if (cols) state.cols = cols;
  if (save) saveCols();
  if (prefs?.density) state.density = prefs.density;
  if (search) rebuildTable();
}

// ---------------------------------------------------------------- the table: columns and cells
interface ColDef { key: string; label: string; title: string; num: boolean; width: number; sortable: boolean }
const RESISTS = ["physResist", "fireResist", "coldResist", "poisonResist", "energyResist"];
// The table's columns follow what it SHOWS: the previous query's rows stay up until the new one's first
// chunk lands, so the header changes with the data, not with the click.
const grouped = (): boolean => (loadedOnce ? !!state.page.groups : state.query.group);
function columns(): ColDef[] {
  const c = (key: string, text: string, width: number, num = false, title = ""): ColDef => ({ key, label: text, title, num, width, sortable: true });
  if (grouped()) return [c("name", "Name", 300), c("kind", "Kind", 120), c("amount", "Total", 88, true), c("stacks", "Stacks", 80, true), { ...c("where", "Where", 480), sortable: false }];
  const width = (k: string): number => (k === "seen" ? 112 : k === "kind" ? 96 : RESISTS.includes(k) ? 52 : Math.max(52, colShort(k, label).length * 8 + 28));
  // Tags, when shown, sits right after Name wherever the saved list names it; it has nothing to sort on.
  const tags = state.cols.includes("tags") ? [{ ...c("tags", "Tags", 108), sortable: false }] : [];
  return [c("name", "Name", 250), ...tags, c("rarity", "Rarity", 156), c("slot", "Slot", 120), c("location", "Location", 180),
    ...state.cols.filter((k) => k !== "tags").map((k) => c(k, colShort(k, label), width(k), !["kind", "seen", "med"].includes(k), colFull(k, full)))];
}
// Numbers sort highest first at dir 1 and names A to Z (item-query.mts), so the arrow follows the kind.
function sortState(col: ColDef): "ascending" | "descending" | "none" {
  if (state.query.sort !== col.key) return "none";
  const ascending = col.num ? state.query.dir < 0 : state.query.dir > 0;
  return ascending ? "ascending" : "descending";
}
function sortedBy(): string {
  const col = columns().find((c) => c.key === state.query.sort);
  const name = !col ? state.query.sort : col.key === "name" ? "name" : col.title || col.label;
  if (col?.num) return `Sorted by ${name}, ${state.query.dir > 0 ? "highest" : "lowest"} first`;
  return `Sorted by ${name}${state.query.dir < 0 ? ", Z to A" : ""}`;
}
const TAG_TONE: Record<string, "bad" | "warn" | undefined> = { cursed: "bad", brittle: "warn", antique: "warn", massive: "warn", unwieldy: "warn" };
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
// The shard's tag words ("cursed", "prized", …), lower-cased: a tooltip line that is one of them is a tag.
export const tagWords = (): string[] => Object.keys(tagUnits());
export function tagEls(it: Item): HTMLElement[] {
  return it.tags.map((t) => box("span", { class: `tag${TAG_TONE[t] ? " " + TAG_TONE[t] : ""}` }, txt(cap(t))));
}
// A tier as its dot and name in its --rarity-* colour; a tier with no token keeps its game colour inside a
// dark subtree, where the game colours were designed to live.
export function rarityEl(rarity: string | null | undefined, cls = ""): HTMLElement | null {
  if (!rarity) return null;
  if (rarityToken(rarity)) return box("span", { class: `rar-tier${cls ? " " + cls : ""}`, style: `color:${rarityColor(rarity)}` }, txt(rarity));
  const raw = rarityColor(rarity);
  return box("span", { class: `rar-tier${cls ? " " + cls : ""}`, "data-theme": "default", "data-mode": "dark", style: raw ? `color:${safeColor(raw) || raw}` : "" }, txt(rarity));
}
export function locationEl(it: Item): HTMLElement {
  const { name, serial } = splitSerial(it.location?.text || "");
  return serial ? box("span", { class: "inv-loc" }, txt(name, "ellip"), txt(serial, "mono faint")) : txt(name, "ellip");
}
function cell(col: ColDef, it: Item): HTMLTableCellElement {
  const td = el("td", col.num ? { class: "num" } : {});
  switch (col.key) {
    case "name": td.append(box("span", { class: "inv-name" }, txt(it.name, "ellip"), (it.amount || 1) > 1 ? txt(`×${it.amount.toLocaleString("en-US")}`, "t-sm muted") : null)); break;
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
type Group = NonNullable<typeof state.page.groups>[number];
function groupCell(col: ColDef, g: Group): HTMLTableCellElement {
  const td = el("td", col.num ? { class: "num" } : {});
  const text = col.key === "name" ? g.name : col.key === "kind" ? g.kind : col.key === "amount" ? g.amount.toLocaleString("en-US") : col.key === "stacks" ? String(g.stacks)
    : g.locations.map(([l, n]) => `${l} (${n.toLocaleString("en-US")})`).join(" · ");
  td.append(txt(text, col.key === "where" || col.key === "name" ? "ellip" : ""));
  return td;
}

// ---------------------------------------------------------------- the table: rows and actions
const ACTIONS: Array<["highlight" | "grab" | "goto", string]> = [["highlight", "Highlight in game"], ["grab", "Grab to backpack"], ["goto", "Go to container"]];
export function itemMenu(anchor: HTMLElement, it: Item): void {
  const entries: MenuItem[] = [{ label: "Open details", icon: "panel-left", onSelect: () => { const i = state.page.rows.findIndex((r) => r?.serial === it.serial); if (i >= 0) openPeekAt(i, true); } }];
  if (it.root != null && !it.equippedBy) entries.push({ label: "Show everything in this container", icon: "folder", onSelect: () => showContainer(+it.root!) });
  entries.push({ label: "Copy serial", icon: "clipboard", onSelect: () => {
    const s = `0x${it.serial.toString(16)}`;
    navigator.clipboard?.writeText(s).then(() => toast(`Copied ${s}`, "good"), () => toast("Could not copy the serial.", "bad"));
  } });
  menu(anchor, entries, { label: `More actions for ${it.name}` });
}
function actionsCell(it: Item): HTMLTableCellElement {
  return el("td", { class: "act-cell" }, rowActions([
    ...ACTIONS.map(([action, text]) => ({ label: text, icon: action, disabled: bridgeActionReason(action, it), onClick: () => { runBridgeAction(action, it); } })),
    { label: "More actions", icon: "more" as const, onClick: (e: MouseEvent) => itemMenu(e.currentTarget as HTMLElement, it) },
  ]));
}

let rowCache = new Map<number, HTMLTableRowElement>();
let activeIndex = 0;
let rowH = 32;
function rowFor(i: number, cols: ColDef[]): HTMLTableRowElement {
  const cached = rowCache.get(i);
  if (cached) return cached;
  const p = state.page;
  let tr: HTMLTableRowElement;
  if (p.groups) {
    const g = p.groups[i];
    if (!g) return skeletonRow(cols, i);
    tr = el("tr", { class: "item", "data-index": i, "aria-rowindex": i + 2, tabindex: "-1" }, ...cols.map((c) => groupCell(c, g)));
  } else {
    const it = p.rows[i];
    if (!it) return skeletonRow(cols, i);
    state.itemCache.set(it.serial, it);   // a drawn row IS the full record: seed the cache so the tooltip and builder never re-fetch it
    const sel = peekSerial() === it.serial;
    tr = el("tr", { class: `item${sel ? " sel" : ""}`, "data-serial": it.serial, "data-index": i, "aria-rowindex": i + 2, "aria-selected": String(sel), tabindex: "-1" }, ...cols.map((c) => cell(c, it)), actionsCell(it));
  }
  rowCache.set(i, tr);
  return tr;
}
const SKEL_W = [72, 54, 80, 46, 66, 58, 76, 50];
function skeletonRow(cols: ColDef[], i: number): HTMLTableRowElement {
  return el("tr", { class: "skel-row", "data-index": i, "aria-hidden": "true" },
    ...cols.map((c, j) => el("td", c.num ? { class: "num" } : {}, el("span", { class: "skel", style: c.num ? `width:${12 + ((i + j) % 3) * 4}px;margin-left:auto` : `width:${SKEL_W[(i + j) % SKEL_W.length]}%` }))),
    grouped() ? null : el("td", { class: "act-cell" }));
}
const spacer = (cls: string): HTMLTableRowElement => el("tr", { class: `vpad ${cls}`, "aria-hidden": "true" }, el("td", {}));

// ---------------------------------------------------------------- the table: data
// A request generation, so a slow chunk of an old query can never land in a newer one's table, and the
// chunk offsets this generation has or is fetching. `fresh` says the page still shows the previous
// query's rows, kept on screen (never blanked) until the first chunk of the new query lands.
let gen = 0, fresh = false, loadError: string | null = null, loadedOnce = false;
const have = new Set<number>();
let debounceTimer = 0;
// A refresh (a live scan landed, a Forget): the same filters, the scroll position kept.
export function fetchItems(): void {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => requery(false), 150) as unknown as number;
}
function requery(toTop: boolean): void {
  gen++; have.clear(); fresh = true; emptyAlone = null;
  if (toTop) { $el("#inv-scroll").scrollTop = 0; activeIndex = 0; }
  fetchChunk(0, gen);
}
async function fetchChunk(offset: number, g: number): Promise<void> {
  have.add(offset);
  let res: ItemsApiResponse;
  try { res = await api<ItemsApiResponse>(`/api/items?${queryParams({ ...state.query, offset, limit: CHUNK }).toString()}`); }
  catch (e) {
    if (g !== gen) return;
    have.delete(offset);
    // The first chunk failing leaves nothing to show; a later one leaves its rows as skeletons and says so.
    if (offset === 0 && !loadedOnce) { inventoryFailed(e); return; }
    toast(`Could not load more of the inventory: ${(e as Error).message}`, "bad");
    return;
  }
  if (g !== gen) return;   // a newer query has been issued since: this answer is stale
  if (fresh) {
    fresh = false; loadedOnce = true;
    rowCache = new Map();
    state.page = "groups" in res
      ? { rows: [], groups: new Array(res.total), total: res.total, stacks: res.stacks, pieces: res.pieces }
      : { rows: new Array(res.total), groups: null, total: res.total, stacks: res.total, pieces: res.pieces };
    activeIndex = Math.min(activeIndex, Math.max(0, res.total - 1));
    if (!res.total && tokensNow().length) findEmptyCause(g);
    renderActive();
    rebuildTable();   // the header follows the data: its sort arrow, and the grouped view's columns
  }
  const got: unknown[] = "groups" in res ? res.groups : res.rows;
  const into: unknown[] = state.page.groups || state.page.rows;
  got.forEach((r, i) => { into[offset + i] = r; rowCache.delete(offset + i); });
  renderTable();
  // A piece asked for from elsewhere (showItem): open it in the peek once its row has landed.
  if (peekWanted != null && !state.page.groups) {
    const i = state.page.rows.findIndex((r) => r?.serial === peekWanted);
    peekWanted = null;
    if (i >= 0) { focusRow(i, false); openPeekAt(i); return; }
  }
  // The peek follows a reload: its item's new record, or closed when the item left the list.
  if (offset === 0 && !state.page.groups) peekRefresh((serial) => state.page.rows.find((r) => r?.serial === serial), state.page.total > CHUNK);
  else if (state.page.groups) closePeek();
}

// ---------------------------------------------------------------- the table: drawing
let emptyAlone: string[] | null = null;
function rebuildTable(): void {
  const t = $el<HTMLTableElement>("#inv-table");
  const cols = columns(), isGrouped = grouped();
  t.classList.toggle("tbl-regular", state.density === "regular");
  rowH = state.density === "regular" ? 40 : 32;
  t.setAttribute("aria-colcount", String(cols.length));
  t.style.minWidth = `${cols.reduce((a, c) => a + c.width, 0)}px`;
  t.querySelector("colgroup")!.replaceChildren(...cols.map((c) => el("col", { style: `width:${c.width}px` })), ...(isGrouped ? [] : [el("col", { class: "act-col" })]));
  t.querySelector("thead")!.replaceChildren(el("tr", { "aria-rowindex": 1 }, ...cols.map((c) => {
    const sort = c.sortable ? sortState(c) : null;
    const inner = c.sortable
      ? box("button", { type: "button", ...(c.title ? { title: c.title } : {}), onclick: () => {
        const q = state.query;
        setQuery(q.sort === c.key ? { ...q, dir: q.dir > 0 ? -1 : 1 } : { ...q, sort: c.key, dir: 1 });
      } }, txt(c.label), sort && sort !== "none" ? icon(sort === "ascending" ? "arrow-up" : "arrow-down", { size: "sm" }) : null)
      : txt(c.label);
    return el("th", { class: c.num ? "num" : "", scope: "col", ...(sort ? { "aria-sort": sort } : {}) }, inner);
  }), isGrouped ? null : el("th", { class: "act-cell", scope: "col" }, txt("Actions", "sr"))));
  // A focused row is about to be detached (focus would drop to <body>): the redrawn active row takes it.
  const rowHadFocus = !!document.activeElement?.matches("#inv-table tbody tr.item");
  rowCache = new Map();
  t.querySelector("tbody")!.replaceChildren();
  renderTable();
  if (rowHadFocus) rowEl(activeIndex)?.focus();
}
// A timer rather than requestAnimationFrame: a window in the background gets no animation frames, and the
// table must still catch up with a scroll or resize made while it was hidden.
let renderTimer = 0;
function scheduleRender(): void { if (!renderTimer) renderTimer = setTimeout(() => { renderTimer = 0; renderTable(); }, 0) as unknown as number; }
function renderTable(): void {
  const t = $el<HTMLTableElement>("#inv-table"), body = t.querySelector("tbody")!, scroller = $el("#inv-scroll");
  const cols = columns(), span = cols.length + (grouped() ? 0 : 1);
  const p = state.page;
  if (loadError) { body.replaceChildren(); showState(errorState(loadError)); t.removeAttribute("aria-busy"); renderFoot(); return; }
  if (!loadedOnce) {
    // Still loading: skeleton rows under the real header; the filters stay usable.
    body.replaceChildren(...Array.from({ length: 14 }, (_, i) => skeletonRow(cols, i)));
    t.setAttribute("aria-busy", "true");
    $el("#inv-state").hidden = true;
    renderFoot();
    return;
  }
  t.removeAttribute("aria-busy");
  t.setAttribute("aria-rowcount", String(p.total + 1));
  if (!p.total) { body.replaceChildren(); showState(state.facets?.itemCount ? emptyResultState() : noScansState()); renderFoot(); return; }
  $el("#inv-state").hidden = true;
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
  renderFoot();
}
function showState(node: HTMLElement): void {
  const holder = $el("#inv-state");
  holder.replaceChildren(node);
  holder.hidden = false;
}
function noScansState(): HTMLElement {
  const noClient = !state.setup?.settings?.client;
  return box("div", { class: "empty-state" }, icon("inventory"), el("h3", { class: "t-lg" }, "No scans yet"),
    el("p", { class: "muted" }, txt(noClient ? "Set up your game client, then press Play on packrat-scanner.py in game to fill your inventory." : "Press Play on packrat-scanner.py in game, or import scan files you already have.")),
    noClient
      ? button({ label: "Run setup", variant: "primary", onClick: async () => { const { openWizard } = await import("./wizard.mts"); openWizard(); } })
      : box("a", { class: "btn btn-primary", href: "#/import" }, txt("Import scans")));
}
function emptyResultState(): HTMLElement {
  const tokens = tokensNow();
  const cause = emptyAlone ? emptyCause(tokens, emptyAlone, state.facets?.itemCount || 0) : tokens.length === 1 ? emptyCause(tokens, [], state.facets?.itemCount || 0) : "Checking which filter excludes everything…";
  return box("div", { class: "empty-state", id: "inv-empty" }, icon("search"), el("h3", { class: "t-lg" }, "No items match"), el("p", { class: "muted" }, txt(cause)),
    tokens.length ? box("div", { class: "inv-empty-tokens" }, txt("Remove a filter:", "t-sm muted"), ...tokenEls(tokens)) : null,
    button({ label: "Clear all filters", variant: "primary", onClick: () => { setQuery(clearAll(state.query)); search.focus(); } }));
}
// Which active filters match nothing on their own: one small query per filter, asked only when the
// result is empty, so the sentence can name the cause (spec 3.5).
async function findEmptyCause(g: number): Promise<void> {
  const tokens = tokensNow();
  if (tokens.length < 2) { emptyAlone = []; return; }
  const alone: string[] = [];
  await Promise.all(tokens.map(async (t) => {
    // The query holding only this filter: every OTHER filter removed.
    const only = tokens.filter((o) => o.id !== t.id).reduce((q, o) => o.remove(q), { ...state.query });
    try {
      const r = await api<ItemsApiResponse>(`/api/items?${queryParams({ ...only, group: false, offset: 0, limit: 1 }).toString()}`);
      if (!r.total) alone.push(t.id);
    } catch { /* the sentence falls back to naming the combination */ }
  }));
  if (g !== gen) return;
  emptyAlone = alone;
  if (!state.page.total) showState(emptyResultState());
}
function errorState(text: string): HTMLElement {
  return box("div", { class: "inv-error" }, message({ tone: "bad", title: "Couldn't load the inventory", text: `${text}. Your scans are safe on disk.`,
    actions: [
      button({ label: "Try again", variant: "primary", size: "sm", onClick: async () => { loadError = null; loadedOnce = false; renderTable(); const { load } = await import("./app.mts"); load(); } }),
      button({ label: "Open logs", size: "sm", onClick: () => { api("/api/host/open-path", { method: "POST", body: { which: "logs" } }).catch(() => { location.hash = "#/settings"; }); } }),
    ] }));
}
// app.mts's load() or reload() failed: say so in the table's own card, and disable what needs the data.
export function inventoryFailed(e: unknown): void {
  loadError = String((e as Error).message || e).replace(/\.$/, "");
  for (const c of $el("#inv-toolbar").querySelectorAll<HTMLButtonElement | HTMLInputElement>("button, input")) c.disabled = true;
  renderTable();
}
const dot = (): HTMLElement => el("span", { class: "faint", "aria-hidden": "true" }, "·");
function renderFoot(): void {
  const foot = $el("#inv-foot"), p = state.page;
  if (!loadedOnce || loadError) {
    foot.replaceChildren(...(loadError ? [txt("Nothing loaded")] : [el("span", { class: "dot busy" }), txt("Loading inventory…"), el("span", { class: "spacer" }), txt("Filters stay usable")]));
    $el("#inv-fade").hidden = true;
    return;
  }
  const tokens = tokensNow(), all = allCols(), more = hiddenCols(), total = state.facets?.itemCount || 0;
  $el("#inv-fade").hidden = !more;
  const stacks = countFact({ shown: p.groups ? p.stacks : p.total, total, pieces: p.pieces, filtered: tokens.length > 0 });
  const kids: Array<HTMLElement | null> = [txt(p.groups ? `${plural(p.total, "name")} · ${stacks}` : stacks, "inv-count"),
    tokens.length ? dot() : null, tokens.length ? txt(plural(tokens.length, "filter"), "inv-foot-filters") : null, el("span", { class: "spacer" })];
  if (more) kids.push(box("span", { class: "inv-more-cols" }, txt(`Scroll right for ${more} more ${more === 1 ? "column" : "columns"}`), icon("arrow-right", { size: "sm" })));
  // How the table is sorted and how many columns it shows: dropped first when the card gets narrow.
  kids.push(box("span", { class: "inv-foot-view" }, more ? dot() : null, txt(sortedBy()), ...(p.groups ? [] : [dot(), txt(`${state.cols.filter((c) => all.includes(c)).length} of ${all.length} columns`)])));
  foot.replaceChildren(...kids.filter((k): k is HTMLElement => !!k));
}
// How many header cells sit wholly or partly past the scroller's right edge.
function hiddenCols(): number {
  const scroller = $el("#inv-scroll");
  const edge = scroller.getBoundingClientRect().right;
  let n = 0;
  for (const th of scroller.querySelectorAll<HTMLElement>("thead th:not(.act-cell)")) if (th.getBoundingClientRect().right > edge + 1) n++;
  return n;
}

// ---------------------------------------------------------------- keyboard, focus, pointer
function rowEl(i: number): HTMLTableRowElement | null { return $el("#inv-table").querySelector<HTMLTableRowElement>(`tbody tr.item[data-index="${i}"]`); }
// Scroll row i into view under the sticky header, draw, and focus it.
function focusRow(i: number, focus = true): void {
  const scroller = $el("#inv-scroll"), head = $el<HTMLTableElement>("#inv-table").tHead?.offsetHeight || 36;
  activeIndex = Math.max(0, Math.min(state.page.total - 1, i));
  const top = activeIndex * rowH, view = scroller.clientHeight - head;
  if (top < scroller.scrollTop) scroller.scrollTop = top;
  else if (top + rowH > scroller.scrollTop + view) scroller.scrollTop = top + rowH - view;
  renderTable();
  if (focus) rowEl(activeIndex)?.focus();
}
// A row's primary action: a list row opens the item peek, a grouped row opens its stacks.
function activate(i: number): void {
  if (state.page.groups) showGroup(i); else openPeekAt(i);
}
// The peek on row i, the row marked selected (accent fill and edge) and made the active row.
function openPeekAt(i: number, focusPeek = false): void {
  const it = state.page.rows[i];
  if (!it) return;
  activeIndex = i;
  hideItemTip();
  openPeek(it, { focus: focusPeek });
  markSelected();
}
function markSelected(): void {
  const serial = peekSerial();
  for (const tr of rowCache.values()) {
    if (!tr.classList.contains("item")) continue;
    const on = serial != null && +(tr.dataset.serial || -1) === serial;
    tr.classList.toggle("sel", on);
    tr.setAttribute("aria-selected", String(on));
  }
}
function wireTable(): void {
  const scroller = $el("#inv-scroll"), body = $el<HTMLTableElement>("#inv-table").querySelector("tbody")!;
  scroller.addEventListener("scroll", () => { scroller.classList.toggle("scrolled-x", scroller.scrollLeft > 0); scheduleRender(); }, { passive: true });
  new ResizeObserver(scheduleRender).observe(scroller);
  body.addEventListener("keydown", (e) => {
    const tr = e.target as HTMLElement;
    if (!tr.matches("tr.item")) return;
    const i = +tr.dataset.index!;
    const page = Math.max(1, Math.floor((scroller.clientHeight - 36) / rowH) - 1);
    if (e.key === "ArrowUp" && i === 0) { e.preventDefault(); $el<HTMLTableElement>("#inv-table").tHead?.querySelector("button")?.focus(); return; }
    const m = gridKey(e.key, i, state.page.total, page);
    if (!m || (m.kind === "close" && !peekOpen())) return;
    e.preventDefault();
    if (m.kind === "move") { focusRow(m.index); if (peekOpen()) openPeekAt(m.index); }
    else if (m.kind === "open") activate(i);
    else closePeek(true);
  });
  body.addEventListener("focusin", (e) => {
    const tr = (e.target as HTMLElement).closest<HTMLTableRowElement>("tr.item");
    if (!tr) return;
    // Focusing a row for 400 ms shows its item tooltip, as hovering does (spec 3.6); not while the peek
    // already shows the item in full.
    if (e.target === tr && tr.dataset.serial && !peekOpen() && tr.matches(":focus-visible")) showItemTip(+tr.dataset.serial, tr);
    if (+tr.dataset.index! === activeIndex) return;
    activeIndex = +tr.dataset.index!;
    for (const r of body.querySelectorAll<HTMLTableRowElement>("tr.item")) r.tabIndex = r === tr ? 0 : -1;
  });
  body.addEventListener("focusout", () => hideItemTip());
  // From a column header, ↓ goes into the rows (the header comes first in the tab order); ↑ from the first
  // row comes back up to the Name header.
  $el<HTMLTableElement>("#inv-table").tHead!.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowDown" || !state.page.total) return;
    e.preventDefault();
    focusRow(activeIndex);
  });
  body.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    if (t.closest(".act-cell")) return;
    const tr = t.closest<HTMLTableRowElement>("tr.item");
    if (!tr) return;
    activeIndex = +tr.dataset.index!;
    tr.focus();
    activate(activeIndex);
  });
  // "/" focuses the search from anywhere on the Inventory screen (spec 3.6).
  document.addEventListener("keydown", (e) => {
    if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target as HTMLElement;
    if (t.closest("input, textarea, select, [contenteditable], dialog, .drawer-root") || $el("#inv-view-items").offsetParent === null) return;
    e.preventDefault();
    search.focus(); search.select();
  });
  document.addEventListener("bridgechange", () => { rowCache = new Map(); renderTable(); });
}
// A grouped row opens its stacks: the list view searching for that name.
function showGroup(i: number): void {
  const g = state.page.groups?.[i];
  if (g) setQuery({ ...state.query, group: false, q: g.name.toLowerCase(), sort: "name", dir: 1 });
}

// ---------------------------------------------------------------- entry points (app.mts, containers.mts)
// Once, at startup: the toolbar, the table's header and its loading state.
export function initFilters(): void {
  buildToolbar();
  wireTable();
  initPeek({
    step: (delta) => { focusRow(activeIndex + delta, false); openPeekAt(activeIndex); },
    closed: (focusRowAfter) => { markSelected(); if (focusRowAfter) focusRow(activeIndex); },
  });
  rebuildTable();
}
// After every load and refresh: the facets changed, so the chips' words and the strip are redrawn, and
// the toolbar comes back to life after a failed load.
export function buildFilters(): void {
  for (const c of $el("#inv-toolbar").querySelectorAll<HTMLButtonElement | HTMLInputElement>("button, input")) c.disabled = false;
  loadError = null;
  syncToolbar();
}
// The character sheet's "Open in Inventory": the Items view searching for the piece's name, with that
// piece open in the peek as soon as its row arrives.
let peekWanted: number | null = null;
export function showItem(it: { serial: number; name: string }): void {
  closePeek();
  peekWanted = it.serial;
  setQuery({ ...clearAll(state.query), q: it.name.toLowerCase() });
  if (location.hash !== "#/inventory") location.hash = "#/inventory";
}
// Containers' "Show these items" and a row's "Show everything in this container": the Items view
// filtered to one root container.
// Characters' "Show Dorran's items": the Items view filtered to one character (worn, backpack, bank, and
// the ground containers that character scanned), every other filter cleared.
export function showCharacterItems(name: string): void {
  closePeek();
  setQuery({ ...clearAll(state.query), chars: [name] });
  if (location.hash !== "#/inventory") location.hash = "#/inventory";
}
export function showContainer(root: number): void {
  closePeek();
  setQuery({ ...clearAll(state.query), roots: [root] });
  if (location.hash !== "#/inventory") location.hash = "#/inventory";
}
