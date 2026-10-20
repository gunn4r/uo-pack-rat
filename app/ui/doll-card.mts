// ui/doll-card.mts — the doll card (issue #57): a character's paperdoll figure, drawn by GET /api/paperdoll.png from the player's own client files, on a card that is dark in both themes. One figure, or a pair side by side (Wearing now / New suit) cut to the same box. Every update draws at once (no debounce); only the newest answer paints, and the figures on screen stay until the new ones have decoded, so an update never flickers. When there is no figure the card says why in its place (doll-model.mts failureNote), and a stand-in says why under it (dollPlan).
//
// map: house
// owns: `dollCard`, `DollView`
import { box, message, button, txt } from "./components.mts";
import { el } from "./dom.mts";
import { showSettings } from "./nav.mts";
import { DOLL_REASONS, dollPlan, dollUrl, failureNote, type DollNote, type DollReason } from "./doll-model.mts";
import type { Look, Worn } from "../paperdoll-look.mts";

// What one card shows: the character (`name` null for no character), its scanned look (null when the scan has none), the client's name and whether its scripts read the look, and one figure or a pair (each its worn pieces and a caption).
export interface DollView {
  name: string | null;
  title?: string | null;
  appearance: Look | null | undefined;
  client: string;
  readsLook: boolean;
  figures: Array<{ worn: Worn[]; caption?: string }>;
}

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
  message({ tone: n.tone, title: n.title, text: n.text ?? "", actions: (n.actions ?? []).map((label, i) => button({ label, size: "sm", variant: i === 0 ? "primary" : "secondary", onClick: () => showSettings("set-client") })) });

// A doll card. `scale`: the figure's size, 2 (whole pixels, pixelated) or 1; `compact`: the Suit Builder's tighter padding; `controls`: what the card head carries on the right.
export function dollCard({ id, scale = 2, compact = false, controls = [] }: { id?: string; scale?: 1 | 2; compact?: boolean; controls?: HTMLElement[] } = {}): { node: HTMLElement; show: (v: DollView) => void } {
  const name = el("h2", {}), title = txt("", "t-sm muted doll-title");
  const stage = box("div", { class: `doll-stage${compact ? " doll-compact" : ""}` });
  const note = box("div", { class: "doll-note" });
  const node = el("section", { class: "card doll-card", "data-mode": "dark", ...(id ? { id } : {}) },
    box("header", { class: "doll-head" }, box("div", { class: "doll-name" }, name, title), controls.length ? box("div", { class: "doll-controls" }, ...controls) : null), stage, note);
  let seq = 0, shown = "", abort: AbortController | null = null;

  function show(v: DollView): void {
    name.textContent = v.name ?? "No character";
    title.textContent = v.title ?? "";
    title.hidden = !v.title;
    const plan = dollPlan({ name: v.name, appearance: v.appearance, readsLook: v.readsLook, client: v.client });
    const pair = v.figures.length === 2;
    const urls = v.figures.map((f, i) => dollUrl(plan.look, f.worn, pair ? v.figures[1 - i]!.worn : null, plan.gray));
    const key = JSON.stringify([urls, v.figures.map((f) => f.caption ?? "")]);
    if (key === shown) return;
    const my = ++seq;
    abort?.abort();
    abort = new AbortController();
    void Promise.all(urls.map((u) => load(u, abort!.signal))).then((got) => {
      if (my !== seq) return;
      shown = key;
      const failed = got.find((g): g is { reason: DollReason } => "reason" in g);
      if (failed) {
        stage.replaceChildren(box("div", { class: "doll-empty" }, noteNode(failureNote(failed.reason))));
        note.replaceChildren();
        return;
      }
      stage.replaceChildren(box("div", { class: "doll-figs" }, ...got.map((g, i) => {
        const f = g as { src: string; width: number; height: number }, caption = v.figures[i]!.caption;
        const img = el("img", { class: "doll-img", src: f.src, alt: caption ? `${v.name ?? "Stand-in"}, ${caption}` : `${v.name ?? "Stand-in"}'s paperdoll`, width: String(f.width * scale), height: String(f.height * scale), draggable: "false" });
        return el("figure", { class: "doll-fig" }, img, caption ? el("figcaption", { class: "t-sm muted" }, caption) : null);
      })));
      note.replaceChildren(...(plan.note ? [noteNode(plan.note)] : []));
    });
  }
  return { node, show };
}
