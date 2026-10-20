// ui/manual-doll.mts — the Suit Builder Manual's live doll (issue #57, design 3.4 option A): the character in the suit being built, redrawn on every change, on one doll card that Manual puts in its own column (2× from the `doll` breakpoint up, 1× below it) or, on a narrow window, in a band at the top of the picker. A "Wearing now" | "New suit" toggle shows what the character wears now: held (pointer down, or Space) for a look, clicked to stay. A piece hovered or focused in the picker is previewed in its slot, with a pill naming it, and a warn-tone pill when it would clear the other hand. No character is the stand-in body. The pill's wording and the previewed suit are manual-model.mts's `dollPill` and `previewSuit`.
//
// map: ui-components
// owns: `manualDoll`
import { NOBODY } from "../vault-lib.mts";
import { badge, segmented } from "./components.mts";
import { dollCard } from "./doll-card.mts";
import { wornPieces } from "./doll-model.mts";
import { viewOf } from "./sheet-doll.mts";
import { dollPill, previewSuit, type ManualDollState } from "./manual-model.mts";

// The pill, its whole text also its tooltip.
const pillNode = (text: string, tone: "accent" | "warn" | null): HTMLElement => { const b = badge(text, tone ?? undefined); b.title = text; return b; };

export function manualDoll(): { node: HTMLElement; paint: (s: ManualDollState) => void } {
  let mode: "new" | "now" = "new", held = false, last: ManualDollState | null = null;
  const card = dollCard({ compact: true, adaptive: true, id: "mb-doll-card" });
  const toggle = segmented({ label: "Show", options: [{ value: "now", label: "Wearing now" }, { value: "new", label: "New suit" }], value: mode, size: "sm",
    onChange: (v) => { mode = v as typeof mode; held = false; repaint(); } });
  toggle.id = "mb-doll-toggle";
  // Holding "Wearing now" shows it at once, before the click (or the Space key's) switches to it; letting go elsewhere switches back.
  const nowBtn = toggle.querySelector<HTMLButtonElement>("[data-value=now]")!;
  const hold = (on: boolean): void => { if (held !== on && mode === "new") { held = on; repaint(); } };
  nowBtn.addEventListener("pointerdown", () => hold(true));
  for (const ev of ["pointerup", "pointerleave", "pointercancel"]) nowBtn.addEventListener(ev, () => hold(false));
  nowBtn.addEventListener("keydown", (e) => { if (e.key === " ") hold(true); });
  nowBtn.addEventListener("keyup", (e) => { if (e.key === " ") hold(false); });
  function repaint(): void {
    const s = last;
    if (!s) return;
    const showingNow = s.name !== null && (mode === "now" || held), pill = dollPill(s, showingNow);
    card.show({ ...viewOf(s.name ?? NOBODY), heading: showingNow ? "Wearing now" : "New suit", actions: s.name === null ? [] : [toggle],
      pill: pill ? pillNode(pill.text, pill.tone) : null, figures: [{ worn: wornPieces(showingNow ? s.worn : previewSuit(s)) }] });
  }
  return { node: card.node, paint: (s) => { if (s.name !== last?.name) { mode = "new"; toggle.setValue(mode); } last = s; repaint(); } };
}
