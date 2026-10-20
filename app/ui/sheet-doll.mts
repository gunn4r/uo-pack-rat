// ui/sheet-doll.mts — the paperdolls of a character's suits (issue #57): the sheet's doll (layout 1B, the Characters screen and the Suit Builder's Full sheet) and the Suit Builder result's pair (layout 2A: Wearing now beside New suit), each on a doll card kept per place and character, so a redraw of the same suits fetches nothing again. An optimizer piece carries no graphic or hue: those are looked up by serial (resolveItems) before the figures are drawn. No character (the Suit Builder's NOBODY) is the stand-in body.
//
// map: ui-components
// owns: `sheetDoll`, `resultDoll`
import { state } from "./store.mts";
import { NOBODY } from "../vault-lib.mts";
import { dollCard, type DollView } from "./doll-card.mts";
import { wornPieces } from "./doll-model.mts";
import { resolveItems } from "./items.mts";
import type { SheetAssignment, SheetItem } from "./sheet.mts";

type Entry = { card: ReturnType<typeof dollCard>; asked: number };
const cards = new Map<string, Entry>();
// `place` keeps one card per place on the page (a node can only be in one place).
function entry(place: string, name: string): Entry {
  const key = `${place}:${name}`;
  let e = cards.get(key);
  if (!e) cards.set(key, (e = { card: dollCard({ compact: place === "result" }), asked: 0 }));
  return e;
}
// The card's view of a character, or of no character (the stand-in), without its figures.
function viewOf(name: string): Omit<DollView, "figures"> {
  if (name === NOBODY) return { name: null, appearance: null, client: "", readsLook: true };
  const c = state.inv!.characters[name], adapter = state.setup?.adapters.find((a) => a.id === c?.adapter?.id);
  return { name, scannedAt: c?.scannedAt ?? null, appearance: c?.appearance, client: adapter?.name ?? c?.adapter?.client ?? "This client", readsLook: adapter?.appearance ?? true };
}
// Shows `suits` on the card once every piece has its graphic and hue; only the newest call for a card draws, so a lookup that comes back late never replaces newer suits.
function showSuits(e: Entry, view: Omit<DollView, "figures">, suits: Array<{ set: SheetAssignment; caption?: string }>): void {
  const my = ++e.asked;
  e.card.frame(view);
  const lists = suits.map((s) => Object.values(s.set).filter((x): x is SheetItem => !!x));
  const unknown = lists.flat().filter((p) => p.graphic == null).map((p) => p.serial);
  const draw = (got: Record<number, { graphic?: number | null | undefined; hue?: number | null | undefined }>): void => e.card.show({ ...view,
    figures: suits.map((s, i) => ({ worn: wornPieces(lists[i]!.map((p) => (p.graphic == null ? got[p.serial] ?? p : p))), ...(s.caption ? { caption: s.caption } : {}) })) });
  if (!unknown.length) draw({});
  else void resolveItems(unknown).then((got) => { if (my === e.asked) draw(got); });
}

// The sheet's doll: the character in the suit the sheet's gear list shows. `place`: "characters" or "builder" (the Full sheet).
export function sheetDoll(place: string, name: string, set: SheetAssignment): HTMLElement {
  const e = entry(place, name);
  showSuits(e, viewOf(name), [{ set }]);
  return e.card.node;
}
// The Suit Builder result's card (layout 2A): Wearing now beside New suit, cut to one box, with the card's heading, its buttons after Customize and what it holds under the figures; for no character, the new suit alone on the stand-in body.
export function resultDoll(name: string, now: SheetAssignment, next: SheetAssignment, card: Pick<DollView, "heading" | "title" | "actions" | "below">): HTMLElement {
  const e = entry("result", name);
  showSuits(e, { ...viewOf(name), ...card }, name === NOBODY ? [{ set: next, caption: "New suit · stand-in body" }] : [{ set: now, caption: "Wearing now" }, { set: next, caption: "New suit" }]);
  return e.card.node;
}
