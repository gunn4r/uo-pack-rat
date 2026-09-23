// ui/inv-model.mts — the Inventory screen's pure rules: the query string a filter state sends, the
// active-filter tokens and their wording, the counts and plurals in the strip and the footer, the
// sentence that explains an empty result, which slice of rows the virtual table draws and fetches, and
// the table's keyboard model. No DOM and no store.mts import, so app/ui-inventory.test.mts runs it under
// plain node:test (the same arrangement as ui/view-state.mts).
import type { ItemQuery, PropFilter, Place } from "../item-query.mts";
import { clearedQuery } from "./view-state.mts";

// ---------------------------------------------------------------- counts and plurals
// "1 stack", "2 stacks", "1,204 pieces": a count and its noun, always agreeing.
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
}

// ---------------------------------------------------------------- columns
// The columns a fresh install shows besides Name, Rarity, Slot and Location: the item's tags (drawn right
// after Name wherever the list names them) and the nine property columns of spec 4.2.
export const DEFAULT_COLS = ["tags", "physResist", "fireResist", "coldResist", "poisonResist", "energyResist", "hci", "dci", "lmc", "lrc"];
// Columns that are not item properties: the item's own fields, offered in the Item group.
export const ITEM_COLS = ["tags", "amount", "kind", "seen", "med", "strReq", "weight"];
// Header text where the table's narrow columns want a shorter word than the property's label.
const SHORT: Record<string, string> = { tags: "Tags", poisonResist: "Pois", energyResist: "Nrg", amount: "Qty", kind: "Kind", seen: "Seen", med: "Med", strReq: "STR req", weight: "Wt" };
const FULL: Record<string, string> = { tags: "Tags", amount: "Quantity", kind: "Kind", seen: "Last seen", med: "Meditation-safe", strReq: "Strength requirement", weight: "Weight" };
export const colShort = (key: string, label: (k: string) => string): string => SHORT[key] || label(key);
export const colFull = (key: string, full: (k: string) => string): string => FULL[key] || full(key);
// The column picker's groups, in the order the popover lists them. The first three are open; the rest
// fold into one "N more" line until opened (spec 4.2).
export const COL_GROUPS = ["Resists", "Combat", "Casting", "Stats", "Regen", "Skills", "Item"] as const;
export type ColGroup = typeof COL_GROUPS[number];
const GROUP_OF: Record<string, ColGroup> = {
  physResist: "Resists", fireResist: "Resists", coldResist: "Resists", poisonResist: "Resists", energyResist: "Resists",
  hci: "Combat", dci: "Combat", ssi: "Combat", di: "Combat", reflectPhys: "Combat",
  lmc: "Casting", lrc: "Casting", fc: "Casting", fcr: "Casting", sdi: "Casting", manaRegen: "Casting", castingFocus: "Casting",
  strBonus: "Stats", dexBonus: "Stats", intBonus: "Stats", hpi: "Stats", stamInc: "Stats", manaInc: "Stats",
  hpRegen: "Regen", stamRegen: "Regen",
  luck: "Item", enhancePotions: "Item", selfRepair: "Item",
};
export function colGroup(key: string): ColGroup {
  if (key.startsWith("sk:")) return "Skills";
  if (ITEM_COLS.includes(key)) return "Item";
  if (GROUP_OF[key]) return GROUP_OF[key]!;
  return key.startsWith("hit") ? "Combat" : "Item";
}
// Every column key the picker offers, grouped. Within a group the familiar order comes first (the resists
// as the paperdoll lists them, HCI before DCI), then anything else alphabetically.
const ORDER = [...Object.keys(GROUP_OF).filter((k) => GROUP_OF[k] !== "Item"), ...ITEM_COLS, ...Object.keys(GROUP_OF).filter((k) => GROUP_OF[k] === "Item")];
const byOrder = (a: string, b: string): number => {
  const ia = ORDER.indexOf(a), ib = ORDER.indexOf(b);
  return ia >= 0 && ib >= 0 ? ia - ib : ia >= 0 ? -1 : ib >= 0 ? 1 : a.localeCompare(b);
};
export function groupColumns(keys: string[]): Array<{ group: ColGroup; keys: string[] }> {
  return COL_GROUPS.map((group) => ({ group, keys: keys.filter((k) => colGroup(k) === group).sort(byOrder) })).filter((g) => g.keys.length);
}

// ---------------------------------------------------------------- the query string
// The GET /api/items query for a filter state, in the wire form item-query.mts's parseItemQuery reads.
export function queryParams(q: ItemQuery): URLSearchParams {
  const p = new URLSearchParams();
  if (q.q) p.set("q", q.q);
  for (const c of q.chars) p.append("char", c);
  for (const s of q.slot) p.append("slot", s);
  for (const l of q.loc) p.append("loc", l);
  for (const r of q.roots) p.append("root", String(r));
  if (q.rarity) p.set("rarity", q.rarity);
  if (q.rarityMin) p.set("rarityMin", q.rarityMin);
  for (const k of q.kind) p.append("kind", k);
  if (q.seenDays) p.set("seenDays", String(q.seenDays));
  if (q.slayer) p.set("slayer", q.slayer);
  if (q.nogarg) p.set("nogarg", "1");
  if (q.med) p.set("med", "1");
  for (const t of q.hideTags) p.append("hide", t);
  for (const f of q.props) p.append("prop", f.op ? `${f.key}:${f.op}:${f.min}` : `${f.key}:${f.min}`);
  if (q.group) p.set("group", "1");
  p.set("sort", q.sort);
  p.set("dir", String(q.dir));
  p.set("offset", String(q.offset));
  p.set("limit", String(q.limit));
  return p;
}

// ---------------------------------------------------------------- active filters
// What the wording needs from the page: labels for slots and properties, the location facet (root
// names), the rarity ladder (to say "or better"), and the total stack count the sentences quote.
export interface FilterContext {
  slotLabel: (slot: string) => string;
  propLabel: (key: string) => string;
  places: Place[];
  ladder: string[];      // rarity tier names, lowest first
}
// One active filter, as the strip draws it: its token text, the × button's name, how to take it out of
// a query, and the sentence that explains an empty result when this filter alone excludes everything.
export interface FilterToken {
  id: string;
  label: string;
  removeLabel: string;
  remove: (q: ItemQuery) => ItemQuery;
  cause: (total: number) => string;
}
const OP_SIGN = { ge: "≥", le: "≤", eq: "=" } as const;
export const propRuleLabel = (f: PropFilter, propLabel: (k: string) => string): string => `${propLabel(f.key)} ${OP_SIGN[f.op || "ge"]} ${f.min}`;
const without = <T,>(list: T[], v: T): T[] => list.filter((x) => x !== v);
// "Greater Magic Item" reads "Greater Magic" on a chip; the token keeps the whole name.
export const shortTier = (tier: string): string => tier.replace(/\s+Item$/i, "");
const a = (word: string): string => (/^[aeiou]/i.test(word) ? `an ${word}` : `a ${word}`);
const listWords = (xs: string[]): string => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} or ${xs[xs.length - 1]}`);
export function rootName(serial: number, places: Place[]): string {
  return places.find((p) => p.root === serial)?.rootName || `container 0x${serial.toString(16)}`;
}

export function activeFilters(q: ItemQuery, ctx: FilterContext): FilterToken[] {
  const out: FilterToken[] = [];
  const none = (total: number): string => `None of the ${plural(total, "stack")}`;
  if (q.q) out.push({ id: "q", label: `Search: ${q.q}`, removeLabel: "Clear the search", remove: (x) => ({ ...x, q: "" }), cause: () => `Nothing matches the search "${q.q}".` });
  for (const c of q.chars) out.push({ id: `char:${c}`, label: `Character: ${c}`, removeLabel: `Remove filter: Character ${c}`, remove: (x) => ({ ...x, chars: without(x.chars, c) }), cause: (t) => `${none(t)} belongs to ${c}.` });
  for (const s of q.slot) {
    const name = s === "?" ? "no known slot" : ctx.slotLabel(s);
    out.push({ id: `slot:${s}`, label: `Slot: ${name}`, removeLabel: `Remove filter: Slot ${name}`, remove: (x) => ({ ...x, slot: without(x.slot, s) }), cause: (t) => s === "?" ? `Every one of the ${plural(t, "stack")} has a known slot.` : `${none(t)} goes in the ${name} slot.` });
  }
  for (const r of q.roots) {
    const name = rootName(r, ctx.places);
    out.push({ id: `root:${r}`, label: `Location: ${name}`, removeLabel: `Remove filter: Location ${name}`, remove: (x) => ({ ...x, roots: without(x.roots, r) }), cause: (t) => `${none(t)} is in ${name}.` });
  }
  for (const l of q.loc) out.push({ id: `loc:${l}`, label: `Location: ${l}`, removeLabel: `Remove filter: Location ${l}`, remove: (x) => ({ ...x, loc: without(x.loc, l) }), cause: (t) => l.startsWith("Worn by ") ? `${none(t)} is ${l.charAt(0).toLowerCase()}${l.slice(1)}.` : `${none(t)} is in ${l}.` });
  if (q.rarityMin) {
    const top = ctx.ladder[ctx.ladder.length - 1] === q.rarityMin;
    out.push({ id: "rarityMin", label: `Rarity ≥ ${q.rarityMin}`, removeLabel: "Remove filter: Rarity", remove: (x) => ({ ...x, rarityMin: "" }), cause: (t) => `${none(t)} is ${a(q.rarityMin)}${top ? "" : " or better"}.` });
  }
  if (q.rarity) out.push({ id: "rarity", label: `Rarity: ${q.rarity}`, removeLabel: "Remove filter: Rarity", remove: (x) => ({ ...x, rarity: "" }), cause: (t) => `${none(t)} is ${a(q.rarity)}.` });
  for (const k of q.kind) out.push({ id: `kind:${k}`, label: `Kind: ${k}`, removeLabel: `Remove filter: Kind ${k}`, remove: (x) => ({ ...x, kind: without(x.kind, k) }), cause: (t) => `${none(t)} is of the kind ${k}.` });
  q.props.forEach((f, i) => {
    const text = propRuleLabel(f, ctx.propLabel);
    out.push({ id: `prop:${i}`, label: text, removeLabel: `Remove filter: ${text}`, remove: (x) => ({ ...x, props: x.props.filter((_, j) => j !== i) }), cause: (t) => `${none(t)} has ${text}.` });
  });
  if (q.slayer) {
    const any = q.slayer === "*";
    out.push({ id: "slayer", label: any ? "Any slayer" : `Slayer: ${q.slayer}`, removeLabel: "Remove filter: Slayer", remove: (x) => ({ ...x, slayer: "" }), cause: (t) => any ? `${none(t)} is a slayer.` : `${none(t)} is ${a(q.slayer)} slayer.` });
  }
  if (q.seenDays) {
    const span = q.seenDays === 1 ? "24 hours" : `${q.seenDays} days`;
    out.push({ id: "seen", label: `Seen in the last ${span}`, removeLabel: "Remove filter: Seen", remove: (x) => ({ ...x, seenDays: 0 }), cause: (t) => `${none(t)} was seen in the last ${span}.` });
  }
  if (q.hideTags.length) {
    const tags = q.hideTags.join(", ");
    out.push({ id: "hide", label: `Hiding: ${tags}`, removeLabel: `Remove filter: Hiding ${tags}`, remove: (x) => ({ ...x, hideTags: [] }), cause: (t) => `Hiding ${listWords(q.hideTags)} hides all ${plural(t, "stack")}.` });
  }
  if (q.nogarg) out.push({ id: "nogarg", label: "No gargoyle-only", removeLabel: "Remove filter: No gargoyle-only", remove: (x) => ({ ...x, nogarg: false }), cause: (t) => `Every one of the ${plural(t, "stack")} is gargoyle-only.` });
  if (q.med) out.push({ id: "med", label: "Meditation-safe", removeLabel: "Remove filter: Meditation-safe", remove: (x) => ({ ...x, med: false }), cause: (t) => `${none(t)} is meditation-safe gear.` });
  return out;
}

// Everything back to its default, the search included (the old "Clear all" left it). The view stays.
export const clearAll = (q: ItemQuery): ItemQuery => clearedQuery(q);

// "45 of 160 stacks match" at the start of the strip; in the grouped view the names are what the table
// shows, so it counts names and says how many stacks sit behind them.
export function matchLine({ shown, total, grouped = false, names = 0 }: { shown: number; total: number; grouped?: boolean; names?: number }): string {
  const stacks = `${shown.toLocaleString("en-US")} of ${plural(total, "stack")} match`;
  return grouped ? `${plural(names, "name")} · ${stacks}` : stacks;
}
// The footer's first fact: "45 of 160 stacks · 45 pieces" when filtered, "160 stacks · 312 pieces" when not.
export function countFact({ shown, total, pieces, filtered }: { shown: number; total: number; pieces: number; filtered: boolean }): string {
  const stacks = filtered ? `${shown.toLocaleString("en-US")} of ${plural(total, "stack")}` : plural(shown, "stack");
  return `${stacks} · ${plural(pieces, "piece")}`;
}

// The empty result's explanation. `alone` holds the ids of filters that by themselves already match
// nothing (the page asks the server once per filter); the first one names the cause. With none of them
// alone to blame, the sentence says the combination is what excludes everything.
export function emptyCause(tokens: FilterToken[], alone: string[], total: number): string {
  const culprit = tokens.find((t) => alone.includes(t.id));
  if (culprit) return culprit.cause(total);
  if (tokens.length === 1) return tokens[0]!.cause(total);
  return `No stack matches all ${plural(tokens.length, "filter")} together. Remove one to see more.`;
}

// ---------------------------------------------------------------- virtual rows
// The rows to draw for a scroll position: the ones in view plus `overscan` either side, clamped to the
// list. `end` is exclusive.
export function rowWindow({ scrollTop, viewport, rowHeight, count, overscan = 8 }: { scrollTop: number; viewport: number; rowHeight: number; count: number; overscan?: number }): { start: number; end: number } {
  if (count <= 0 || rowHeight <= 0) return { start: 0, end: 0 };
  const visible = Math.ceil(Math.max(0, viewport) / rowHeight);
  // A scroll position past the end (the list shrank under it) reads as the last screenful.
  const first = Math.min(Math.floor(Math.max(0, scrollTop) / rowHeight), Math.max(0, count - visible));
  const start = Math.max(0, first - overscan);
  const end = Math.min(count, first + visible + overscan);
  return { start, end: Math.max(start, end) };
}
// The page offsets (multiples of `chunk`) that hold rows [start, end) and are not loaded or on the way.
export function chunksToFetch(start: number, end: number, chunk: number, total: number, have: Set<number>): number[] {
  const out: number[] = [];
  if (total <= 0 || end <= start) return out;
  for (let o = Math.floor(start / chunk) * chunk; o < Math.min(end, total); o += chunk) if (!have.has(o)) out.push(o);
  return out;
}

// ---------------------------------------------------------------- the table's keyboard model (spec 3.6)
// One row is in the tab order; the arrow keys move it, Home/End jump, Page Up/Down move a screenful,
// Enter or Space opens the item peek and Esc closes it. Returns what the key does from row `index` of
// `count`, or null for a key the table leaves alone.
export type GridMove = { kind: "move"; index: number } | { kind: "open" } | { kind: "close" };
export function gridKey(key: string, index: number, count: number, page: number): GridMove | null {
  if (!count) return null;
  const to = (i: number): GridMove => ({ kind: "move", index: Math.max(0, Math.min(count - 1, i)) });
  switch (key) {
    case "ArrowDown": return to(index + 1);
    case "ArrowUp": return to(index - 1);
    case "Home": return to(0);
    case "End": return to(count - 1);
    case "PageDown": return to(index + Math.max(1, page));
    case "PageUp": return to(index - Math.max(1, page));
    case "Enter": case " ": return { kind: "open" };
    case "Escape": return { kind: "close" };
    default: return null;
  }
}
