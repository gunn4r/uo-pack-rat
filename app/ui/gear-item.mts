// ui/gear-item.mts — the element that names a piece of gear (#504, #503): icon, rarity color, quantity, tags, tooltip, open action.
//
// Every screen that names an item draws it through `gearItem`, so the color, the tooltip and the icon come from one place.
//
// map: ui-components
// owns: `gearItem`, `gearText`, `gearInText`, `QUALITY_TAGS`, `forgetGearMisses`
import { itemTip, tagChip, type TooltipItem } from "./dom.mts";
import { box, txt } from "./components.mts";
import { artTile } from "./item-art.mts";
import { rarityToken, resolveItems } from "./items.mts";
import { state } from "./store.mts";

// What a caller may hand in: a full scanned item, or a partial record (an optimizer piece, a plan's move) that names it by serial. A missing graphic, hue, rarity or tags is filled from the page's item cache, else from one batched lookup by serial.
export type GearItemSource = TooltipItem & { serial: number; graphic?: number | null | undefined; hue?: number | null | undefined };
export interface GearItemOptions {
  // row: a table cell or list line; inline: a name inside a sentence; chip: a compact pill; card: the icon beside two lines (`label` and the name, then `sub`).
  variant?: "row" | "inline" | "chip" | "card" | undefined;
  // The icon's size: 24 by default, 32 for a card.
  size?: 24 | 32 | undefined;
  // false: no icon (a cell too narrow for one).
  showIcon?: boolean | undefined;
  // true: the quality tags (QUALITY_TAGS) after the name.
  showTags?: boolean | undefined;
  // A button: pressed (a click, Enter or Space), it calls `onOpen`, which shows the item's detail.
  onOpen?: ((item: GearItemSource, node: HTMLElement) => void) | undefined;
  // false: no item tooltip at all: no data-serial, nothing registered, so a host around it (a table row) that shows the tooltip still answers for it.
  tip?: boolean | undefined;
  // false: no empty box when there is no art (a title, where the box would only indent the name).
  keepBox?: boolean | undefined;
  // Elements after the name and tags (a "New" badge, a low-durability tag).
  after?: Array<HTMLElement | null> | undefined;
  // false: its tooltip shows on hover only, and it adds no tab stop (a list with a roving tab stop of its own, such as the Stack plan's cards).
  focus?: boolean | undefined;
  // A card's first words before the name (its slot), and its second line.
  label?: string | undefined;
  sub?: string | undefined;
  cls?: string | undefined;
}

// The tags that say something about a piece's quality; the rest (a slayer's, a set's) are in the tooltip.
export const QUALITY_TAGS: ReadonlySet<string> = new Set(["antique", "brittle", "cursed", "prized", "blessed"]);

const has = <K extends keyof GearItemSource>(it: GearItemSource, k: K): boolean => it[k] !== undefined;
// The record to draw: what the caller gave, with the cache's fields where it gave none.
function filled(it: GearItemSource): GearItemSource {
  const known = state.itemCache.get(it.serial);
  if (!known) return it;
  return { ...it, graphic: has(it, "graphic") ? it.graphic : known.graphic, hue: has(it, "hue") ? it.hue : known.hue, rarity: has(it, "rarity") ? it.rarity : known.rarity, tags: it.tags ?? known.tags };
}

// Lookups by serial, gathered for one tick and sent together (resolveItems asks only for serials the cache lacks). A serial waiting or in flight is not asked again, and one the server answered without is not asked again until a new inventory (forgetGearMisses). A new inventory also outdates every answer still on its way: it is neither drawn nor cached, and its serials are asked again of the new inventory, so the pieces waiting on them still get drawn. A request that failed records no miss.
const pending = new Map<number, Array<() => void>>(), queued = new Set<number>(), missed = new Set<number>();
let flushing: ReturnType<typeof setTimeout> | null = null, generation = 0;
export const forgetGearMisses = (): void => {
  missed.clear();
  generation++;
  for (const serial of pending.keys()) queued.add(serial);
  if (queued.size) flushSoon();
};
function whenKnown(serial: number, then: () => void): void {
  if (missed.has(serial)) return;
  const list = pending.get(serial);
  if (list) { list.push(then); return; }
  pending.set(serial, [then]);
  queued.add(serial);
  flushSoon();
}
function flushSoon(): void {
  flushing ??= setTimeout(() => {
    flushing = null;
    const batch = [...queued], gen = generation, answered = new Set<number>();
    queued.clear();
    void resolveItems(batch, { answered, current: () => gen === generation }).then((found) => {
      if (gen !== generation) return;
      for (const serial of batch) {
        const fns = pending.get(serial) || [];
        pending.delete(serial);
        if (found[serial]) for (const fn of fns) fn(); else if (answered.has(serial)) missed.add(serial);
      }
    });
  }, 0);
}

let noteIds = 0;
const amountText = (n: number): string => n.toLocaleString("en-US");
function parts(node: HTMLElement, it: GearItemSource, o: GearItemOptions, size: 24 | 32): HTMLElement[] {
  const token = rarityToken(it.rarity);
  const name = txt(it.name, "gi-name");
  if (token) name.style.color = `var(${token})`;
  const qty = (it.amount || 1) > 1 ? txt(` ×${amountText(it.amount!)}`, "gi-qty") : null;
  const tags = o.showTags ? (it.tags || []).filter((t) => QUALITY_TAGS.has(t)).map((t) => tagChip(t)) : [];
  const icon = o.showIcon === false ? null : artTile(it.graphic, { size, hue: it.hue ?? 0, keepBox: o.keepBox !== false });
  const tail = [qty, ...tags, ...(o.after || [])].filter((x): x is HTMLElement => !!x);
  // A button is named by the piece alone; its tags and badges describe it.
  if (o.onOpen) {
    node.setAttribute("aria-label", qty ? `${it.name} ×${amountText(it.amount!)}` : it.name);
    const notes = [...tags, ...(o.after || [])].filter((x): x is HTMLElement => !!x);
    for (const n of notes) n.id ||= `gi-note-${++noteIds}`;
    if (notes.length) node.setAttribute("aria-describedby", notes.map((n) => n.id).join(" ")); else node.removeAttribute("aria-describedby");
  }
  if (o.variant !== "card") return [icon, name, ...tail].filter((x): x is HTMLElement => !!x);
  const line = box("span", { class: "gi-card-line" }, o.label ? txt(o.label, "caps muted") : null, name, ...tail);
  return [icon, box("span", { class: "gi-card-text" }, line, o.sub ? txt(o.sub, "t-sm muted ellip") : null)].filter((x): x is HTMLElement => !!x);
}

// One piece of gear as an element: the icon (aria-hidden; an empty box of the same size when there is no art, so names in a column line up), the name in its rarity's color (cut short with an ellipsis, never wrapped), its quantity, its quality tags and `after`. It shows the item tooltip on hover and keyboard focus, and with `onOpen` it is a button that opens the item.
export function gearItem(item: GearItemSource, o: GearItemOptions = {}): HTMLElement {
  const variant = o.variant ?? "row", size = o.size ?? (variant === "card" ? 32 : 24);
  let it = filled(item);
  const cls = `gi gi-${variant}${o.onOpen ? " gi-link" : ""}${o.cls ? ` ${o.cls}` : ""}`;
  const node = o.onOpen ? box("button", { type: "button", class: cls }) : box("span", { class: cls });
  node.append(...parts(node, it, o, size));
  if (o.onOpen) node.addEventListener("click", () => o.onOpen!(it, node));
  if (o.tip !== false) itemTip(node, it, { focus: o.focus !== false });
  const lacking = (o.showIcon !== false && !has(it, "graphic")) || !has(it, "rarity") || (o.showTags && !it.tags);
  if (lacking && !state.itemCache.has(it.serial)) whenKnown(it.serial, () => { it = filled(item); node.replaceChildren(...parts(node, it, o, size)); if (o.tip !== false) itemTip(node, it, { focus: false }); });
  return node;
}

// A piece named inside a sentence: an inline gearItem without an icon that flows and wraps as text (its rarity color, its tooltip on hover).
export const gearInText = (p: GearItemSource): HTMLElement => gearItem(p, { variant: "inline", showIcon: false, focus: false, cls: "gi-in-text" });
// A sentence that names pieces of gear ("2.75 s with Broadsword"), as text with each named piece drawn in it as an inline
// gearItem without an icon (its rarity color, its tooltip on hover), flowing and wrapping as text: every whole-word match
// of a piece's name, the longer name first where two overlap. Pieces sharing a name take its matches in the order they
// are listed (the suit's Longsword, then the worn one), the last of them any further ones. A piece the sentence does not
// name, or a null one, is left out.
export function gearText(text: string, pieces: ReadonlyArray<GearItemSource | null | undefined>): Array<string | HTMLElement> {
  const named = pieces.filter((p): p is GearItemSource => !!p?.name);
  const names = [...new Set(named.map((p) => p.name))].sort((a, b) => b.length - a.length), used = new Map<string, number>();
  const out: Array<string | HTMLElement> = [];
  const word = (c: string | undefined): boolean => !!c && /[\p{L}\p{N}]/u.test(c);
  let i = 0, from = 0;
  while (i < text.length) {
    const name = names.find((n) => text.startsWith(n, i) && !word(text[i - 1]) && !word(text[i + n.length]));
    if (!name) { i++; continue; }
    const same = named.filter((q) => q.name === name), k = used.get(name) ?? 0, p = same[Math.min(k, same.length - 1)]!;
    used.set(name, k + 1);
    if (i > from) out.push(text.slice(from, i));
    out.push(gearInText(p));
    i += name.length; from = i;
  }
  if (from < text.length) out.push(text.slice(from));
  return out;
}
