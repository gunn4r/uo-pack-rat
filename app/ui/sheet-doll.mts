// ui/sheet-doll.mts — the character sheet's paperdoll (issue #57, layout 1B): the character's look wearing the suit the sheet shows, on a doll card kept per screen and character, so a redraw of the same suit fetches nothing again. The Characters screen passes it for the worn suit, the Suit Builder's Full sheet for the new suit, whose optimizer pieces carry no graphic or hue: those are looked up by serial (resolveItems) before the figure is drawn.
//
// map: ui-components
// owns: `sheetDoll`
import { state } from "./store.mts";
import { dollCard, type DollView } from "./doll-card.mts";
import { wornPieces } from "./doll-model.mts";
import { resolveItems } from "./items.mts";
import type { SheetAssignment, SheetItem } from "./sheet.mts";

const cards = new Map<string, { card: ReturnType<typeof dollCard>; asked: number }>();
// `scope` keeps one card per screen (a node can only be in one place).
export function sheetDoll(scope: string, name: string, set: SheetAssignment): HTMLElement {
  const key = `${scope}:${name}`;
  let entry = cards.get(key);
  if (!entry) cards.set(key, (entry = { card: dollCard(), asked: 0 }));
  const e = entry, my = ++e.asked;
  const c = state.inv!.characters[name], adapter = state.setup?.adapters.find((a) => a.id === c?.adapter?.id);
  const view = (worn: DollView["figures"][number]["worn"]): DollView => ({ name, scannedAt: c?.scannedAt ?? null, appearance: c?.appearance, client: adapter?.name ?? c?.adapter?.client ?? "This client",
    readsLook: adapter?.appearance ?? true, figures: [{ worn }] });
  const pieces = Object.values(set).filter((x): x is SheetItem => !!x), unknown = pieces.filter((p) => p.graphic == null).map((p) => p.serial);
  if (!unknown.length) e.card.show(view(wornPieces(pieces)));
  // only the newest call for this card draws, so a lookup that comes back late never replaces a newer suit
  else void resolveItems(unknown).then((got) => { if (my === e.asked) e.card.show(view(wornPieces(pieces.map((p) => (p.graphic == null ? got[p.serial] ?? p : p))))); });
  return e.card.node;
}
