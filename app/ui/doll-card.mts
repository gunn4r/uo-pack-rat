// ui/doll-card.mts — the doll card (issue #57): a character's paperdoll figure, drawn by GET /api/paperdoll.png from the player's own client files, on a card that is dark in both themes. One figure, or a pair side by side (Wearing now / New suit) cut to the same box. Every update draws at once (no debounce); only the newest answer paints, and the figures on screen stay until the new ones have decoded, so an update never flickers. When there is no figure the card says why in its place (doll-model.mts failureNote), and a stand-in says why under it (dollPlan).
//
// map: house
// owns: `dollCard`, `DollView`, `forgetDollFigures`
import { box, message, button, tag, txt } from "./components.mts";
import { el } from "./dom.mts";
import { showSettings } from "./nav.mts";
import { DOLL_REASONS, dollPlan, dollRequests, dollUrl, failureNote, type DollNote, type DollPlan, type DollReason } from "./doll-model.mts";
import { customLook, setCustomLook } from "./customize-model.mts";
import { openCustomizer } from "./doll-customizer.mts";
import type { Look, Worn } from "../paperdoll-look.mts";

// What one card shows: the character (`name` null for no character) and when it was scanned (a look customized over an older scan is dropped), its scanned look (null when the scan has none), the client's name and whether its scripts read the look, and one figure or a pair (each its worn pieces and a caption).
export interface DollView {
  name: string | null;
  scannedAt?: string | null;
  title?: string | null;
  appearance: Look | null | undefined;
  client: string;
  readsLook: boolean;
  figures: Array<{ worn: Worn[]; caption?: string }>;
  // The Suit Builder's result card (layout 2A): its own heading in place of the name, buttons after Customize (the Full sheet toggle), and what the card holds under the figures (the stat tiles).
  heading?: string;
  actions?: HTMLElement[];
  below?: HTMLElement[];
}

type Frame = Pick<DollView, "name" | "heading" | "title" | "actions" | "below">;
type Loaded = { src: string; width: number; height: number } | { reason: DollReason };
// One figure as a data: URL (the page's CSP allows data: images, not blob:), decoded off-screen; or why there is none.
async function load(url: string, signal: AbortSignal): Promise<Loaded> {
  try {
    const r = await fetch(url, { signal });
    if (r.ok) {
      const blob = await r.blob();
      const src = await new Promise<string>((ok, no) => { const f = new FileReader(); f.onload = () => ok(String(f.result)); f.onerror = () => no(f.error); f.readAsDataURL(blob); });
      const img = new Image();
      img.src = src;
      await img.decode();
      return { src, width: img.naturalWidth, height: img.naturalHeight };
    }
    if (r.status === 404) {
      const b = (await r.json()) as { reason?: unknown };
      if (typeof b.reason === "string" && (DOLL_REASONS as readonly string[]).includes(b.reason)) return { reason: b.reason as DollReason };
    }
  } catch { /* the request failed, or a newer update aborted it */ }
  return { reason: "error" };
}

const noteNode = (n: DollNote): HTMLElement =>
  message({ tone: n.tone, title: n.title, text: n.text ?? "", actions: (n.actions ?? []).map((a, i) => button({ label: a.label, size: "sm", variant: i === 0 ? "primary" : "secondary", onClick: () => showSettings(a.to === "scanner" ? "set-scanner" : "set-uofolder") })) });

// Bumped when the UO folder changes (Settings calls forgetDollFigures after a save), so every card asks for its figures again on its next update.
let filesEpoch = 0;
export const forgetDollFigures = (): void => { filesEpoch++; };

// A doll card. `scale`: the figure's size, 2 (whole pixels, pixelated) or 1; `compact`: the Suit Builder's tighter padding; `controls`: what the card head carries on the right, before the "Customized" tag and the Customize button.
export function dollCard({ id, scale = 2, compact = false, controls = [] }: { id?: string; scale?: 1 | 2; compact?: boolean; controls?: HTMLElement[] } = {}): { node: HTMLElement; show: (v: DollView) => void; frame: (v: Frame) => void } {
  const name = el("h2", {}), title = txt("", "t-sm muted doll-title");
  const stage = box("div", { class: `doll-stage${compact ? " doll-compact" : ""}` });
  const note = box("div", { class: "doll-note" }), below = box("div", { class: "doll-below" }), actions = box("div", { class: "doll-actions" });
  const customized = tag("Customized");
  const customize = button({ label: "Customize", icon: "person", variant: "ghost", size: "sm", attrs: { "aria-haspopup": "dialog", "aria-expanded": "false" }, onClick: () => { if (view) openCustomizerFor(view); } });
  const node = el("section", { class: "card doll-card", "data-mode": "dark", ...(id ? { id } : {}) },
    box("header", { class: "doll-head" }, box("div", { class: "doll-name" }, name, title), box("div", { class: "doll-controls" }, ...controls, customized, customize, actions)), stage, note, below);
  const requests = dollRequests();
  let abort: AbortController | null = null, plan: DollPlan | null = null, drawn = false, view: DollView | null = null;
  // The note under a drawn figure, from the newest update.
  const paintNote = (): void => { note.replaceChildren(...(drawn && plan?.note ? [noteNode(plan.note)] : [])); };
  // The popover beside the card, starting from the scanned look (or the stand-in) and redrawing the card on every change, with the newest view of the same character (the page builds a new view on every redraw).
  function openCustomizerFor(v: DollView): void {
    const base = dollPlan({ name: v.name, appearance: v.appearance, readsLook: v.readsLook, client: v.client });
    openCustomizer(customize, node, { scanned: base.look, custom: customLook(v.name, v.scannedAt ?? null), standIn: base.gray, nobody: v.name === null,
      onChange: (look) => { setCustomLook(v.name, v.scannedAt ?? null, look); if (view && view.name === v.name) show(view); } });
  }

  // The card around the figures: its heading, title, buttons and what it holds under them, drawn at once while the figures may still be on their way.
  function frame(v: Frame): void {
    name.textContent = v.heading ?? v.name ?? "No character";
    title.textContent = v.title ?? "";
    title.hidden = !v.title;
    actions.replaceChildren(...(v.actions ?? []));
    below.replaceChildren(...(v.below ?? []));
  }
  function show(v: DollView): void {
    view = v;
    frame(v);
    const custom = customLook(v.name, v.scannedAt ?? null);
    customized.hidden = !custom;
    const p = plan = dollPlan({ name: v.name, appearance: v.appearance, readsLook: v.readsLook, client: v.client, custom });
    const pair = v.figures.length === 2;
    const urls = v.figures.map((f, i) => dollUrl(p.look, f.worn, pair ? v.figures[1 - i]!.worn : null, p.gray));
    const my = requests.start(JSON.stringify([filesEpoch, urls, v.figures.map((f) => f.caption ?? ""), v.name]));
    // the same figures: only the note can have changed (a reinstalled client reads the look now, say)
    if (my === null) { paintNote(); return; }
    abort?.abort();
    abort = new AbortController();
    void Promise.all(urls.map((u) => load(u, abort!.signal))).then((got) => {
      const failed = got.find((g): g is { reason: DollReason } => "reason" in g);
      if (!requests.settle(my, !failed)) return;
      drawn = !failed;
      if (failed) {
        stage.replaceChildren(box("div", { class: "doll-empty" }, noteNode(failureNote(failed.reason))));
        paintNote();
        return;
      }
      stage.replaceChildren(box("div", { class: "doll-figs" }, ...got.map((g, i) => {
        const f = g as { src: string; width: number; height: number }, caption = v.figures[i]!.caption;
        const img = el("img", { class: "doll-img", src: f.src, alt: caption ? `${v.name ?? "Stand-in"}, ${caption}` : `${v.name ?? "Stand-in"}'s paperdoll`, width: String(f.width * scale), height: String(f.height * scale), draggable: "false" });
        return el("figure", { class: "doll-fig" }, img, caption ? el("figcaption", { class: "caps" }, caption) : null);
      })));
      paintNote();
    });
  }
  return { node, show, frame };
}
