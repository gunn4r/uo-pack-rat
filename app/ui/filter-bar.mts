// ui/filter-bar.mts — the item filters' toolbar (#487): the search, the facet chips and their popovers, and "+ Filter".
// The chips are Character, Slot, Location, Rarity, Kind, Type and Weapon skill, with Slayer and Seen while set; "+ Filter"
// adds property rules, slayer, seen, tags, gargoyle and meditation. The Inventory and the Suit Builder's Manual picker (item-browser.mts) and the
// Organize rule editor (rule-editor.mts) draw the same one; a surface leaves out the chips it has no use for.
//
// map: ui-components
// owns: `createFilterBar`, `itemsSource`, `ItemSource`
import { SLOT_LABELS, SLOT_GROUP, tagUnits, flagLabel, FLAG_CATALOGUE, PROPERTY_CATALOGUE, CATALOGUE_GROUPS, ITEM_TYPE_LABELS, typesOfSlot, type ItemType } from "../vault-lib.mts";
import type { Facets, ItemQuery, Place, PropCounts, PropOp } from "../item-query.mts";
import { state } from "./store.mts";
import { el, label, full, slotLabel, whereText } from "./dom.mts";
import { api } from "./api.mts";
import { optionsKeeping } from "./view-state.mts";
import { txt, box, button, searchInput, filterChip, pill, segmented, switchControl, popover, menu, input, nextId } from "./components.mts";
import type { Kids, MenuItem, PopoverHandle } from "./components.mts";
import { splitSerial, placeNames, queryParams, withFixed, shortTier, rootName, slayerTree, slayerLabel, missingHint, MAGE_WEAPON_HINT } from "./inv-model.mts";
import type { ItemPropCountsApiResponse, ItemsApiResponse } from "./api-types.mts";
import { rarityEl } from "./item-parts.mts";
import { houseNameOf, mapHouses } from "./house-links.mts";
import { textHit } from "./format.mts";

// Where a browser's rows and filter choices come from: one chunk of the rows matching a query (the fixed fields already
// applied), and the facets its chips list.
export interface ItemSource {
  fetch: (query: ItemQuery, offset: number, limit: number) => Promise<ItemsApiResponse>;
  facets: () => Facets | null;
  // How many of the stacks a query matches carry each property, for the property rule's list.
  propCounts: (query: ItemQuery) => Promise<PropCounts>;
}
// The default source: GET /api/items, and the facets of the inventory as last loaded.
export const itemsSource: ItemSource = {
  fetch: (query, offset, limit) => api<ItemsApiResponse>(`/api/items?${queryParams({ ...query, offset, limit }).toString()}`),
  facets: () => state.facets,
  propCounts: (query) => api<ItemPropCountsApiResponse>(`/api/items?${queryParams(query).toString()}&fields=props`),
};

// ---------------------------------------------------------------- the filter state
export type ChipId = "char" | "slot" | "loc" | "rarity" | "kind" | "type" | "wskill" | "slayer" | "seen";
export const FACETS: ChipId[] = ["char", "slot", "loc", "rarity", "kind", "type", "wskill"];
export const CHIP_NAMES: Record<ChipId, string> = { char: "Character", slot: "Slot", loc: "Location", rarity: "Rarity", kind: "Kind", type: "Type", wskill: "Weapon skill", slayer: "Slayer", seen: "Seen" };
// The query fields each chip sets: a fixed one hides the chip.
const CHIP_FIELDS: Record<ChipId, Array<keyof ItemQuery>> = { char: ["chars"], slot: ["slot"], loc: ["loc", "roots", "houses"], rarity: ["rarityMin", "rarityMax"], kind: ["kind"], type: ["type"], wskill: ["wskill"], slayer: ["slayer"], seen: ["seenDays"] };

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
      if (!textHit(filter, o.label, o.mono, o.group)) continue;
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
const SLOT_GROUP_ORDER = ["Armor", "Jewelry", "Weapons", "Clothing", "Other"];
function placesByCharacter(f: Facets | null): Map<string, Place[]> {
  const m = new Map<string, Place[]>();
  for (const p of f?.places || []) m.set(p.character, [...(m.get(p.character) || []), p]);
  return m;
}
// A picked value the facets no longer have (its last item was forgotten) stays listed, so the list keeps
// showing the filter the table still applies (view-state.mts's optionsKeeping).
const keeping = (opts: Option[], picked: string[], labelOf: (v: string) => string): Option[] =>
  picked.reduce<Option[]>((acc, v) => optionsKeeping(acc as Array<Option & { label: string }>, v, (x) => `${labelOf(x)} (none now)`), opts);
function charOptions(q: ItemQuery, f: Facets | null): Option[] {
  const by = placesByCharacter(f);
  const names = [...new Set([...Object.keys(state.inv?.characters || {}), ...by.keys()])].filter((n) => n && n !== "?").sort();
  return keeping(names.map((n) => ({ value: n, label: n, count: (by.get(n) || []).reduce((a, p) => a + p.count, 0) })), q.chars, String);
}
function slotOptions(q: ItemQuery, f: Facets | null): Option[] {
  const order = Object.keys(SLOT_LABELS);
  const opts: Option[] = (f?.slots || []).map((s) => ({ value: s, label: slotLabel(s), group: SLOT_GROUP[s] || "Other" }))
    .sort((a, b) => SLOT_GROUP_ORDER.indexOf(a.group!) - SLOT_GROUP_ORDER.indexOf(b.group!) || order.indexOf(a.value) - order.indexOf(b.value));
  opts.push({ value: "?", label: "No known slot", group: "Other" });
  return keeping(opts, q.slot, slotLabel);
}
// Issue #188: the weapon skills weapons count under, with Use Best Weapon Skill weapons under each melee skill.
function weaponSkillOptions(q: ItemQuery, f: Facets | null): Option[] {
  return keeping((f?.weaponSkills || []).map((w) => ({ value: w.name, label: flagLabel(w.name), count: w.count })), q.wskill, flagLabel);
}
// The Type chip's choices; a browser fixed to some slots (the Manual picker) offers only the types those slots hold,
// whose whole-inventory counts are then that picker's, since a type sits in one slot or one group.
const typeLabel = (t: string): string => ITEM_TYPE_LABELS[t as ItemType] ?? t;
const typesIn = (slots: string[] | undefined): Set<string> | null => (slots?.length ? new Set(slots.flatMap(typesOfSlot)) : null);
function typeOptions(q: ItemQuery, f: Facets | null, slots: string[] | undefined): Option[] {
  const only = typesIn(slots);
  return keeping((f?.types || []).filter((t) => !only || only.has(t.name)).map((t) => ({ value: t.name, label: typeLabel(t.name), count: t.count })), q.type, typeLabel);
}
function kindOptions(q: ItemQuery, f: Facets | null): Option[] {
  return keeping((f?.kinds || []).map((k) => ({ value: k.name, label: k.name, count: k.count })), q.kind, String);
}
// The Location tree: each character's worn set, backpack and bank (with the bags inside them), then the houses on the
// House map, then each house's containers and last the containers on the ground in no house. A house's checkbox takes
// every container standing in it, a root's everything inside it, a bag's just that bag. A container labelled for Organize
// is listed by its label, as the Location column shows it.
function locationOptions(q: ItemQuery, f: Facets | null): Option[] {
  const out: Option[] = [];
  const bags = (text: string): string => text.split(" › ").slice(1).join(" › ");
  const add = (group: string, ps: Place[], fixed?: string): void => {
    const roots = new Map<number, Place[]>();
    for (const p of ps) if (p.root != null) roots.set(p.root, [...(roots.get(p.root) || []), p]);
    for (const [root, inRoot] of roots) {
      const top = inRoot.reduce((a, b) => (a.text.length <= b.text.length ? a : b));
      const { name, serial } = splitSerial(top.rootName);
      const shown = fixed ?? splitSerial(whereText(top.text).split(" › ")[0]!).name;
      out.push({ value: `root:${root}`, group, count: inRoot.reduce((a, p) => a + p.count, 0), ...placeNames(fixed ?? name, shown, serial) });
      for (const p of inRoot) if (p.text.includes(" › ")) out.push({ value: `loc:${p.text}`, group, sub: true, count: p.count, ...placeNames(bags(p.text), bags(whereText(p.text))) });
    }
  };
  const ground: Place[] = [];
  for (const [who, ps] of [...placesByCharacter(f)].sort(([a], [b]) => a.localeCompare(b))) {
    const worn = ps.find((p) => p.kind === "equipped");
    if (worn) out.push({ value: `loc:${worn.text}`, label: "Worn", group: who, count: worn.count });
    add(who, ps.filter((p) => p.kind === "backpack"), "Backpack");
    add(who, ps.filter((p) => p.kind === "bank"), "Bank");
    ground.push(...ps.filter((p) => !["equipped", "backpack", "bank"].includes(p.kind)));
  }
  const houses = mapHouses(), houseOf = new Map(houses.flatMap((h) => h.serials.map((s): [number, string] => [s, h.id])));
  const housed = ground.filter((p) => p.root != null && houseOf.has(p.root)), inHouse = new Set(housed);
  for (const h of houses) {
    const count = housed.reduce((a, p) => a + (houseOf.get(p.root!) === h.id ? p.count : 0), 0);
    if (count || q.houses.includes(h.id)) out.push({ value: `house:${h.id}`, label: h.name, group: "Houses", count });
  }
  for (const h of houses) add(h.name, housed.filter((p) => houseOf.get(p.root!) === h.id));
  add("On the ground", ground.filter((p) => !inHouse.has(p)));
  for (const h of q.houses) if (!out.some((o) => o.value === `house:${h}`)) out.push({ value: `house:${h}`, label: `${houseNameOf(h)} (none now)`, group: "No longer scanned" });
  for (const r of q.roots) if (!out.some((o) => o.value === `root:${r}`)) out.push({ value: `root:${r}`, label: `${rootName(r, [])} (none now)`, group: "No longer scanned" });
  for (const l of q.loc) if (!out.some((o) => o.value === `loc:${l}`)) out.push({ value: `loc:${l}`, label: `${l} (none now)`, group: "No longer scanned" });
  return out;
}
// A single-choice list of radios; picking one sets the filter and closes the popover. A row without a value is a
// heading: no radio, so the arrow keys pass over it, and presentation only, so it is not read as a member of the group.
interface RadioRow { value: string | null; label: HTMLElement; count?: number | undefined; cls?: string | undefined }
function radioList(title: string, rows: RadioRow[], current: string, pick: (v: string) => void): HTMLElement {
  const name = nextId("radio");
  return box("div", { class: "inv-opts", role: "radiogroup", "aria-label": title }, ...rows.map((row) => {
    const count = row.count != null ? txt(row.count.toLocaleString("en-US"), "inv-opt-count") : null;
    const cls = `inv-opt${row.cls ? ` ${row.cls}` : ""}`;
    const value = row.value;
    if (value == null) return box("div", { class: `${cls} head`, role: "presentation" }, row.label, count);
    const r = el("input", { type: "radio", name, value });
    r.checked = current === value;
    r.addEventListener("change", () => pick(value));
    return box("label", { class: `check ${cls}` }, r, row.label, count);
  }));
}
function openPanel(anchor: HTMLElement, title: string, body: (close: () => void) => Kids, width = 280): void {
  let h: PopoverHandle | null = null;
  h = popover(anchor, body(() => h?.close()), { label: title, width });
  h.root.classList.add("inv-pop");
}


const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

// ---------------------------------------------------------------- the bar
export interface FilterBarOptions {
  query: () => ItemQuery;
  // Every control lands here with the new state; the surface redraws what it shows and calls `sync`.
  setQuery: (next: ItemQuery) => void;
  source: ItemSource;
  // Always applied, overriding the field (item-browser.mts's `fixed`): its chips are hidden.
  fixed?: Partial<ItemQuery> | undefined;
  // Chips the surface has no use for (the rule editor: Character, Location, Seen).
  omit?: readonly ChipId[] | undefined;
  // Kinds the Kind chip does not offer (the rule editor: "container", since bags never move).
  hideKinds?: readonly string[] | undefined;
  // The search box's placeholder and its "/" shortcut hint (the rule editor's text never matches a location, and "/"
  // focuses the browser's search, not the rule's).
  placeholder?: string | undefined;
  slashHint?: boolean | undefined;
  // The id a control carries, by the Inventory's names ("f-text", "f-slot", "f-add"); none when left out.
  idOf?: ((name: string) => { id?: string }) | undefined;
}
export interface FilterBar {
  // The search box's field and its wrapper, the chips in toolbar order and "+ Filter".
  search: HTMLInputElement;
  searchRoot: HTMLElement;
  chips: HTMLButtonElement[];
  addChip: HTMLButtonElement;
  // The chips' words, set state and visibility, and the search box, from the query.
  sync: () => void;
  // A search keystroke still waiting out its debounce is dropped (any other change supersedes it).
  cancelSearch: () => void;
  // …or applied now (the rule editor's Save, and its redraws, so the last keystrokes are never lost).
  flushSearch: () => void;
}
export function createFilterBar(o: FilterBarOptions): FilterBar {
  const query = o.query, source = o.source, fixed = o.fixed ?? {}, omit = o.omit ?? [], hideKinds = o.hideKinds ?? [];
  const idOf = o.idOf ?? ((): { id?: string } => ({}));
  let searchTimer = 0;
  const setQuery = (next: ItemQuery): void => { clearTimeout(searchTimer); searchTimer = 0; o.setQuery(next); };
  const chips = {} as Partial<Record<ChipId, HTMLButtonElement>>;
  // A Type chip with one choice to offer (a picker fixed to a helmet) is as good as fixed; so is a chip left out.
  const isFixed = (id: ChipId): boolean => omit.includes(id) || CHIP_FIELDS[id].some((f) => f in fixed) || (id === "type" && (typesIn(fixed.slot)?.size ?? 2) < 2);

  // A chip's words: "Slot", "Slot: Ring", "Slot: Ring +2".
  function chipText(id: ChipId): string {
    const q = query(), name = CHIP_NAMES[id];
    const many = (xs: string[]): string => (xs.length ? `${name}: ${xs[0]}${xs.length > 1 ? ` +${xs.length - 1}` : ""}` : name);
    switch (id) {
      case "char": return many(q.chars);
      case "slot": return many(q.slot.map((s) => (s === "?" ? "no slot" : slotLabel(s))));
      case "loc": return many([...q.houses.map(houseNameOf), ...q.roots.map((r) => splitSerial(rootName(r, source.facets()?.places || [])).name), ...q.loc]);
      case "rarity": return q.rarityMin && q.rarityMax ? `Rarity: ${shortTier(q.rarityMin)} – ${shortTier(q.rarityMax)}`
        : q.rarityMin ? `Rarity ≥ ${shortTier(q.rarityMin)}` : q.rarityMax ? `Rarity ≤ ${shortTier(q.rarityMax)}` : name;
      case "kind": return many(q.kind);
      case "type": return many(q.type.map(typeLabel));
      case "wskill": return many(q.wskill.map(flagLabel));
      case "slayer": return q.slayer === "*" ? "Any slayer" : `Slayer: ${slayerLabel(q.slayer)}`;
      case "seen": return `Seen: ${q.seenDays === 1 ? "24 h" : `${q.seenDays} days`}`;
    }
  }
  function chipSet(id: ChipId): boolean {
    const q = query();
    switch (id) {
      case "char": return q.chars.length > 0;
      case "slot": return q.slot.length > 0;
      case "loc": return q.loc.length + q.roots.length + q.houses.length > 0;
      case "rarity": return !!(q.rarityMin || q.rarityMax);
      case "kind": return q.kind.length > 0;
      case "type": return q.type.length > 0;
      case "wskill": return q.wskill.length > 0;
      case "slayer": return !!q.slayer;
      case "seen": return !!q.seenDays;
    }
  }
  // The chips are updated in place (never rebuilt), so an open popover keeps its anchor.
  function sync(): void {
    const q = query();
    for (const id of Object.keys(chips) as ChipId[]) {
      const c = chips[id]!, on = chipSet(id);
      c.querySelector("span")!.textContent = chipText(id);
      c.classList.toggle("set", on);
      // Slayer and Seen live behind "+ Filter" and show as a chip only while set.
      // Weapon skill goes while the Type filter picks only pieces that are no weapon (Shield, Spellbook…).
      const noWeapons = q.type.length > 0 && !q.type.some((t) => t === "one-handed" || t === "two-handed");
      c.hidden = isFixed(id) || ((id === "slayer" || id === "seen") && !on) || (id === "wskill" && !on && noWeapons);
    }
    if (search.value.trim().toLowerCase() !== q.q) search.value = q.q;
  }

  const s = searchInput({ label: "Search items", placeholder: o.placeholder ?? "Search name, property, slayer, location", ...(o.slashHint === false ? {} : { hint: "/" }), attrs: { ...idOf("f-text"), "data-stop": "" } });
  const search = s.input;
  s.root.classList.add("inv-search");
  search.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      searchTimer = 0;
      const q = search.value.trim().toLowerCase();
      if (q !== query().q) setQuery({ ...query(), q });
    }, 150) as unknown as number;
  });
  search.addEventListener("keydown", (e) => { if (e.key === "Escape" && search.value) { e.stopPropagation(); search.value = ""; setQuery({ ...query(), q: "" }); } });
  for (const c of [...FACETS, "slayer", "seen"] as ChipId[]) {
    if (omit.includes(c)) continue;
    chips[c] = filterChip({ label: CHIP_NAMES[c], attrs: { ...idOf(`f-${c}`), "data-stop": "", ...(FACETS.includes(c) ? { "data-facet": "" } : {}) }, onClick: () => openFacet(c, chips[c]!) });
  }
  const addChip = filterChip({ label: "Filter", add: true, attrs: { ...idOf("f-add"), "data-stop": "" }, onClick: () => openAddMenu() });

  // ---------------------------------------------------------------- facet popovers
  // A floor and a ceiling on the shard's ladder, each a single-choice list; picking either sets that bound and
  // closes the popover. Each list draws its own tier labels (a DOM node lives in one place).
  function rarityPanel(close: () => void): Kids {
    const ladder = state.rules?.rarity || [];
    const tiers = () => [{ value: "", label: txt("Any rarity") }, ...ladder.map((t) => ({ value: t.name, label: rarityEl(t.name) ?? txt(t.name) }))];
    return [box("div", { class: "inv-pop-head" }, txt("Rarity at least", "caps")),
      radioList("Rarity at least", tiers(), query().rarityMin, (v) => { setQuery({ ...query(), rarityMin: v }); close(); }),
      box("div", { class: "inv-pop-head" }, txt("Rarity at most", "caps")),
      radioList("Rarity at most", tiers(), query().rarityMax, (v) => { setQuery({ ...query(), rarityMax: v }); close(); })];
  }
  // Laid out like the shard's slayer charts (issue #189, inv-model.mts's slayerTree): each super slayer, its lesser slayers
  // one step in, the talisman slayers and any others under small titles, a hairline between groups.
  function slayerPanel(close: () => void): Kids {
    const f = source.facets();
    const tree = slayerTree(f?.slayers || [], state.rules?.slayerGroups);
    const rows = tree.map((r): RadioRow => {
      const cls = (...c: string[]) => [...c, r.first ? "sep" : ""].filter(Boolean).join(" ") || undefined;
      if (r.kind === "title") return { value: null, label: txt(r.label, "t-sm muted"), cls: cls("title") };
      const zero = r.count ? "" : " muted";
      if (r.kind === "super") return { value: r.value, label: el("span", { class: `ellip${zero}` }, r.label, el("span", { class: "inv-opt-tag", "aria-hidden": "true" }, "Super")), count: r.count, cls: cls() };
      return { value: r.value, label: txt(r.label, `ellip${zero}`), count: r.count, cls: cls(r.level ? "sub" : "") };
    });
    return [box("div", { class: "inv-pop-head" }, txt("Slayer", "caps")),
      radioList("Slayer", [{ value: "", label: txt("No slayer filter") }, { value: "*", label: txt("Any slayer"), count: f?.slayerAny || 0 }, ...rows],
        query().slayer, (v) => { setQuery({ ...query(), slayer: v }); close(); }),
      tree.some((r) => r.kind === "super") ? txt("A super slayer also hits its lesser slayers' creatures, but at double damage instead of triple.", "t-sm muted") : null];
  }
  function seenPanel(): Kids {
    const seg = segmented({ label: "Seen", options: [{ value: "0", label: "Any" }, { value: "1", label: "24 h" }, { value: "7", label: "7 days" }, { value: "30", label: "30 days" }], value: String(query().seenDays || 0), onChange: (v) => setQuery({ ...query(), seenDays: +v }) });
    return [box("div", { class: "inv-pop-head" }, txt("Seen in the last", "caps")), seg];
  }
  // Hide the items with a tag, or (issue #133) show only the items with one: "Splintering and brittle" needs the latter.
  function tagsPanel(): Kids {
    const pills = (key: "hideTags" | "tags", off: boolean): HTMLElement => box("div", { class: "inv-pills" }, ...Object.keys(tagUnits()).map((t) => pill({ label: cap(t), pressed: query()[key].includes(t), off,
      onToggle: (on) => setQuery({ ...query(), [key]: on ? [...query()[key], t] : query()[key].filter((x) => x !== t) }) })));
    return [box("div", { class: "inv-pop-head" }, txt("Hide items tagged", "caps")), pills("hideTags", true), txt("A struck-through tag is hidden.", "t-sm muted"),
      box("div", { class: "inv-pop-head" }, txt("Only items tagged", "caps")), pills("tags", false), txt("An item with any of the chosen tags is shown.", "t-sm muted")];
  }
  function gearPanel(): Kids {
    const garg = switchControl({ label: "Hide gargoyle-only gear", checked: query().nogarg, onChange: (on) => setQuery({ ...query(), nogarg: on }) });
    const med = switchControl({ label: "Meditation-safe gear only", checked: query().med, onChange: (on) => setQuery({ ...query(), med: on }) });
    return [box("div", { class: "inv-pop-head" }, txt("Gear", "caps")), garg.root, med.root];
  }
  function facetPanel(id: ChipId, close: () => void): Kids {
    const q = query();
    switch (id) {
      case "char": return checklist({ title: "Character", options: charOptions(q, source.facets()), selected: q.chars, onChange: (v) => setQuery({ ...query(), chars: v }) });
      case "slot": return checklist({ title: "Slot", options: slotOptions(q, source.facets()), selected: q.slot, searchable: false, onChange: (v) => setQuery({ ...query(), slot: v }) });
      case "kind": return checklist({ title: "Kind", options: kindOptions(q, source.facets()).filter((k) => !hideKinds.includes(k.value)), selected: q.kind, onChange: (v) => setQuery({ ...query(), kind: v }) });
      case "type": return checklist({ title: "Type", options: typeOptions(q, source.facets(), fixed.slot), selected: q.type, searchable: false, onChange: (v) => setQuery({ ...query(), type: v }) });
      case "wskill": return [...checklist({ title: "Weapon skill", options: weaponSkillOptions(q, source.facets()), selected: q.wskill, searchable: false, onChange: (v) => setQuery({ ...query(), wskill: v }) }),
        txt("Use Best Weapon Skill weapons count under Swordsmanship, Fencing and Mace Fighting.", "t-sm muted")];
      case "loc": return checklist({ title: "Location", options: locationOptions(q, source.facets()), selected: [...q.houses.map((h) => `house:${h}`), ...q.roots.map((r) => `root:${r}`), ...q.loc.map((l) => `loc:${l}`)], searchable: true,
        onChange: (v) => setQuery({ ...query(), houses: v.filter((x) => x.startsWith("house:")).map((x) => x.slice(6)), roots: v.filter((x) => x.startsWith("root:")).map((x) => +x.slice(5)), loc: v.filter((x) => x.startsWith("loc:")).map((x) => x.slice(4)) }) });
      case "rarity": return rarityPanel(close);
      case "slayer": return slayerPanel(close);
      case "seen": return seenPanel();
    }
  }
  const openFacet = (id: ChipId, anchor: HTMLElement): void => openPanel(anchor, CHIP_NAMES[id], (c) => facetPanel(id, c), id === "loc" ? 320 : 280);

  // ---------------------------------------------------------------- "+ Filter"
  function openAddMenu(): void {
    const entries: MenuItem[] = [];
    // Below 1180 px the unset facet chips fold in here, so the toolbar never wraps (spec 3.7); Weapon skill below 1280 px.
    for (const id of FACETS) if (!chipSet(id) && !isFixed(id) && !chips[id]!.getClientRects().length) entries.push({ label: `${CHIP_NAMES[id]}…`, onSelect: () => openFacet(id, addChip) });
    entries.push({ label: "Property rule…", onSelect: () => openPanel(addChip, "Property rule", propertyPanel, 300) });
    if (!isFixed("slayer")) entries.push({ label: "Slayer…", onSelect: () => openPanel(addChip, "Slayer", slayerPanel) });
    if (!isFixed("seen")) entries.push({ label: "Seen…", onSelect: () => openPanel(addChip, "Seen", () => seenPanel()) });
    entries.push(
      { label: "Tags…", onSelect: () => openPanel(addChip, "Tags", () => tagsPanel()) },
      { label: "Gargoyle and meditation…", onSelect: () => openPanel(addChip, "Gear", () => gearPanel()) },
    );
    menu(addChip, entries, { label: "Add a filter" });
  }
  // A property rule: the property (searchable, from the whole catalogue in its groups, each with how many stacks in view
  // carry it; none dims it but keeps its place), ≥ ≤ = ≠, a number. Rules add up (an item must pass every one), which the
  // popover says. A yes/no property (issue #182, the last group) is just "has": picking one hides the comparison and the number.
  function propertyPanel(close: () => void): Kids {
    let counts: PropCounts | null = null;
    let key = "", op = "ge", flag = false;
    const chosen = txt("Pick a property", "t-sm muted");
    const find = searchInput({ label: "Find a property", placeholder: "Find a property" });
    find.input.classList.add("input-sm");
    const list = box("div", { class: "inv-opts inv-prop-list", role: "listbox", "aria-label": "Properties" });
    const num = input({ type: "number", value: 1, size: "sm", attrs: { "aria-label": "Value" } });
    const hint = txt("", "t-sm muted");
    const showHint = (): void => { const h = flag || !key ? null : key === "mageWeapon" ? MAGE_WEAPON_HINT : missingHint(op, num.value, full(key)); hint.textContent = h || ""; hint.hidden = !h; };
    showHint();
    num.addEventListener("input", showHint);
    const opSeg = segmented({ label: "Comparison", options: [{ value: "ge", label: "≥" }, { value: "le", label: "≤" }, { value: "eq", label: "=" }, { value: "ne", label: "≠" }], value: "ge", onChange: (v) => { op = v; showHint(); } });
    const add = button({ label: "Add rule", variant: "primary", size: "sm", disabled: true, onClick: () => {
      if (flag) { setQuery({ ...query(), flags: [...new Set([...query().flags, key])] }); close(); return; }
      if (!key || num.value === "" || !Number.isFinite(+num.value)) { num.focus(); return; }
      setQuery({ ...query(), props: [...query().props, { key, min: +num.value, ...(op === "ge" ? {} : { op: op as PropOp }) }] });
      close();
    } });
    const pick = (b: HTMLElement, k: string, name: string, isFlag: boolean): void => {
      key = k; flag = isFlag; chosen.textContent = name; chosen.className = "t-sm strong"; add.disabled = false;
      opSeg.hidden = num.hidden = isFlag;
      showHint();
      for (const o of list.querySelectorAll("[role=option]")) o.setAttribute("aria-selected", String(o === b));
      if (isFlag) add.focus(); else { num.focus(); num.select(); }
    };
    const option = (k: string, name: string, unit: string, n: number | undefined, isFlag: boolean): HTMLElement => {
      const zero = n === 0 ? " muted" : "";
      const b = box("button", { type: "button", class: "menu-item inv-prop", role: "option", "aria-selected": String(flag === isFlag && k === key) },
        el("span", { class: `ellip${zero}` }, name, unit ? txt(` ${unit}`, "muted") : null), txt(n == null ? "" : n.toLocaleString("en-US"), `inv-opt-count${zero}`));
      b.addEventListener("click", () => pick(b, k, name, isFlag));
      return b;
    };
    const draw = (filter: string): void => {
      const kids: HTMLElement[] = [];
      const hit = (words: string): boolean => textHit(filter, words);
      for (const group of CATALOGUE_GROUPS) {
        const es = PROPERTY_CATALOGUE.filter((c) => c.group === group && hit(`${c.name} ${label(c.key)}`));
        if (!es.length) continue;
        kids.push(txt(group, "inv-opt-group t-sm muted"));
        for (const c of es) kids.push(option(c.key, c.name, c.unit, counts ? counts.props[c.key] || 0 : undefined, false));
      }
      const fs = FLAG_CATALOGUE.filter((f) => hit(flagLabel(f)));
      if (fs.length) kids.push(txt("Yes or no", "inv-opt-group t-sm muted"));
      for (const f of fs) kids.push(option(f, flagLabel(f), "", counts ? counts.flags[f] || 0 : undefined, true));
      list.replaceChildren(...(kids.length ? kids : [txt("No property matches.", "t-sm muted")]));
    };
    void source.propCounts(withFixed(query(), fixed)).then((c) => { counts = c; draw(find.input.value.trim().toLowerCase()); }, () => {});
    find.input.addEventListener("input", () => draw(find.input.value.trim().toLowerCase()));
    num.addEventListener("keydown", (e) => { if (e.key === "Enter") add.click(); });
    draw("");
    return [box("div", { class: "inv-pop-head" }, txt("Property rule", "caps")), find.root, list, chosen, box("div", { class: "inv-rule" }, opSeg, num, add), hint, txt("An item must pass every rule you add.", "t-sm muted")];
  }

  sync();
  const flushSearch = (): void => {
    if (!searchTimer) return;
    clearTimeout(searchTimer); searchTimer = 0;
    const q = search.value.trim().toLowerCase();
    if (q !== query().q) setQuery({ ...query(), q });
  };
  return { search, searchRoot: s.root, chips: Object.values(chips) as HTMLButtonElement[], addChip, sync, cancelSearch: () => { clearTimeout(searchTimer); searchTimer = 0; }, flushSearch };
}
