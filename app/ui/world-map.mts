// ui/world-map.mts — the world map lightbox (issue #164): the Where section's small map opens the whole facet in a modal dialog (components.mts openDialog: Esc, focus kept in and given back), fitted at first; the zoom buttons and keys zoom about the house while it is in view. A low-resolution image of the whole facet is the base; when the view zooms past it, the visible region is fetched again at screen resolution (150 ms after the view settles, older answers ignored) and laid over the base where the server's x-region says it belongs. The wheel (a pinch arrives as a wheel with ctrlKey) zooms about the pointer, +, − and 0 (fit) zoom, a drag or the arrow keys pan. Every captured house of the facet has a marker of a fixed screen size; another house's marker closes the lightbox and opens its map. Every rule and number is ui/world-map-model.mts's.
import { $, el } from "./dom.mts";
import { box, txt, button, openDialog } from "./components.mts";
import { facetName, parseRegion, FACET_SIZE, type Box, type Crop, type Pt } from "./house-map-model.mts";
import { firstView, zoomAnchor, zoomView, panView, toScreen, toWorld, overlayRequest, worldMarkers, pxPerTile, type Size } from "./world-map-model.mts";
import type { FacetMapReason, HouseSummary } from "./api-types.mts";

// One request for a facet image: the PNG as a data: URL (the page's CSP allows data: images, not blob:) with the region the server drew, or why there is none.
export type FacetImage = { src: string; crop: Crop } | { reason: FacetMapReason | "error" };
const REASONS: readonly string[] = ["override-missing", "no-client", "no-tazuo-profile", "missing", "unreadable"];
export async function fetchFacetImage(url: string): Promise<FacetImage> {
  try {
    const r = await fetch(url), crop = parseRegion(r.headers.get("x-region"));
    if (r.ok && crop) {
      const blob = await r.blob();
      const src = await new Promise<string>((ok, no) => { const f = new FileReader(); f.onload = () => ok(String(f.result)); f.onerror = () => no(f.error); f.readAsDataURL(blob); });
      return { src, crop };
    }
    if (r.status === 404) {
      const b = (await r.json()) as { reason?: unknown };
      if (typeof b.reason === "string" && REASONS.includes(b.reason)) return { reason: b.reason as FacetMapReason };
    }
  } catch { /* the request itself failed */ }
  return { reason: "error" };
}
const facetUrl = (facet: number, r: Crop, size: number): string => `/api/facet-map/${facet}.png?x0=${r.x0}&y0=${r.y0}&x1=${r.x1}&y1=${r.y1}&w=${size}`;

export interface WorldMapOptions { facet: number; houses: readonly HouseSummary[]; currentId: string; centre: Pt }
export function openWorldMap(o: WorldMapOptions): void {
  const base = el("img", { class: "wm-base", alt: "", draggable: "false", hidden: "" });
  const overlay = el("img", { class: "wm-overlay", alt: "", draggable: "false", hidden: "" });
  const markers = box("div", { class: "wm-markers" });
  const status = el("p", { class: "wm-status t-sm", id: "wm-status", role: "status" }, "Loading the world map…");
  const viewport = box("div", { class: "wm-viewport", id: "wm-viewport", tabindex: "0", role: "group", "aria-label": "World map. Drag or use the arrow keys to move, + and − to zoom, 0 to fit." }, base, overlay, markers, status);
  let facet: Size = { width: FACET_SIZE[o.facet]?.[0] ?? 1024, height: FACET_SIZE[o.facet]?.[1] ?? 1024 };
  let vp: Size = { width: 1, height: 1 }, v: Box = { x: 0, y: 0, w: 1, h: 1 }, baseK = 0;
  let overlayAt: Crop | null = null, timer: ReturnType<typeof setTimeout> | null = null, reqId = 0, dragged = false;

  const measure = (): Size => ({ width: viewport.clientWidth || 1, height: viewport.clientHeight || 1 });
  const place = (img: HTMLImageElement, r: Crop): void => {
    const [l, t] = toScreen(v, vp, [r.x0, r.y0]), k = pxPerTile(v, vp);
    img.style.left = `${l}px`; img.style.top = `${t}px`; img.style.width = `${(r.x1 - r.x0) * k}px`; img.style.height = `${(r.y1 - r.y0) * k}px`;
  };
  const els = new Map<string, HTMLElement>();
  const draw = (): void => {
    place(base, { x0: 0, y0: 0, x1: facet.width, y1: facet.height });
    if (overlayAt) place(overlay, overlayAt);
    const shown = new Set<string>();
    for (const m of worldMarkers(o.houses, o.currentId, o.facet, v, vp)) {
      let e = els.get(m.id);
      if (!e) { e = markerEl(m.id, m.label, m.current); els.set(m.id, e); markers.append(e); }   // appended once (moving a node would drop its focus); the house shown sits on top by z-index
      e.hidden = false;
      e.style.transform = `translate(${m.sx}px, ${m.sy}px)`;
      e.querySelector(".wm-label")!.classList.toggle("off", !m.showLabel);
      shown.add(m.id);
    }
    for (const [id, e] of els) {
      if (shown.has(id) || e.hidden) continue;
      if (e.contains(document.activeElement)) viewport.focus({ preventScroll: true });   // a hidden marker would drop the focus out of the map, and its keys with it
      e.hidden = true;
    }
  };
  // The visible region at screen resolution, once the view has settled; nothing while the base already shows the view as sharply.
  const scheduleOverlay = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      const id = ++reqId, dpr = window.devicePixelRatio || 1;
      if (!baseK || pxPerTile(v, vp) * dpr <= baseK * 1.05) { overlay.hidden = true; overlayAt = null; return; }
      const req = overlayRequest(v, { width: vp.width * dpr, height: vp.height * dpr }, facet);
      if (!req) return;
      // Decoded off screen first, then the picture and its place change together, so the old picture never shows in the new box.
      void fetchFacetImage(facetUrl(o.facet, req, req.size)).then(async (got) => {
        if (id !== reqId || !("src" in got)) return;
        const next = new Image();
        next.src = got.src;
        try { await next.decode(); } catch { return; }
        if (id !== reqId) return;
        overlay.src = got.src;
        overlayAt = got.crop;
        overlay.hidden = false;
        draw();
      });
    }, 150);
  };
  const setView = (next: Box): void => { v = next; draw(); scheduleOverlay(); };
  const centre = (): Pt => [v.x + v.w / 2, v.y + v.h / 2];
  const zoomBy = (f: number, at: Pt = zoomAnchor(v, [o.centre[0] + 0.5, o.centre[1] + 0.5])): void => setView(zoomView(v, f, at, facet, vp));
  const fitAll = (): void => setView(firstView(facet, vp));

  const markerEl = (id: string, label: string, current: boolean): HTMLElement => {
    const kids = [el("span", { class: "wm-dot", "aria-hidden": "true" }), txt(label, "wm-label")];
    if (current) return box("span", { class: "wm-marker current", role: "img", "aria-label": `${label} (this house)` }, ...kids);
    return box("a", { class: "wm-marker", href: `#/map/${encodeURIComponent(id)}`, "aria-label": label, "data-house": id, onclick: (e: Event) => {
      e.preventDefault();
      if (dragged) return;
      d.close();
      location.hash = `#/map/${encodeURIComponent(id)}`;
    } }, ...kids);
  };

  const d = openDialog({ title: `World map · ${facetName(o.facet)}`, body: [viewport], width: "md", cls: "world-map-dialog", initialFocus: viewport, actions: [
    button({ label: "Zoom out", icon: "zoom-out", iconOnly: true, size: "sm", attrs: { id: "wm-zoom-out", title: "Zoom out (−)" }, onClick: () => zoomBy(1.5) }),
    button({ label: "Zoom in", icon: "zoom-in", iconOnly: true, size: "sm", attrs: { id: "wm-zoom-in", title: "Zoom in (+)" }, onClick: () => zoomBy(1 / 1.5) }),
    button({ label: "Fit the facet", icon: "fit", iconOnly: true, size: "sm", attrs: { id: "wm-fit", title: "Fit the facet (0)" }, onClick: fitAll }),
    button({ label: "Close", attrs: { id: "wm-close" }, onClick: () => d.close() }),
  ] });
  const dialog = d.dialog;
  // A click on the backdrop lands on the <dialog> itself; focus goes back to the small map even when a redraw replaced it meanwhile.
  dialog.addEventListener("click", (e) => { if (e.target === dialog) d.close(); });
  dialog.addEventListener("close", () => { if (timer) clearTimeout(timer); reqId++; watch.disconnect(); if (!dialog.contains(document.activeElement) && document.activeElement === document.body) $<HTMLElement>("#map-where-open")?.focus(); });

  vp = measure();
  v = firstView(facet, vp);
  draw();
  // The base: the whole facet at the dialog's size (a region past the facet comes back cut to it, which gives the facet's real size).
  void fetchFacetImage(facetUrl(o.facet, { x0: 0, y0: 0, x1: 8192, y1: 8192 }, Math.min(2048, Math.ceil(Math.max(vp.width, vp.height))))).then((got) => {
    if (!dialog.open) return;
    if (!("src" in got)) { status.textContent = "The world map could not be loaded."; return; }
    facet = { width: got.crop.x1, height: got.crop.y1 };
    base.onload = () => { baseK = base.naturalWidth / facet.width; status.hidden = true; base.hidden = false; setView(firstView(facet, vp)); };
    base.src = got.src;
  });
  const watch = new ResizeObserver(() => { if (!dialog.open) return; vp = measure(); setView(zoomView({ ...v, h: (v.w * vp.height) / vp.width }, 1, centre(), facet, vp)); });
  watch.observe(viewport);

  // Pan by dragging (a press that moves more than 3 px; a marker under it then opens nothing), zoom with the wheel about the pointer.
  let drag: { x: number; y: number; v: Box; id: number } | null = null;
  const local = (e: MouseEvent): Pt => { const r = viewport.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  viewport.addEventListener("pointerdown", (e) => { if (e.button === 0) { drag = { x: e.clientX, y: e.clientY, v, id: e.pointerId }; dragged = false; } });
  viewport.addEventListener("pointermove", (e) => {
    if (!drag) return;
    if (!(e.buttons & 1)) { drag = null; viewport.classList.remove("dragging"); return; }
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!dragged && Math.abs(dx) + Math.abs(dy) > 3) { dragged = true; viewport.setPointerCapture(drag.id); viewport.classList.add("dragging"); }
    if (dragged) setView(panView(drag.v, dx, dy, facet, vp));
  });
  const endDrag = (): void => { drag = null; viewport.classList.remove("dragging"); setTimeout(() => { dragged = false; }, 0); };
  viewport.addEventListener("pointerup", endDrag);
  viewport.addEventListener("pointercancel", endDrag);
  viewport.addEventListener("wheel", (e) => {
    e.preventDefault();
    if (e.deltaY === 0) return;
    zoomBy(Math.exp(e.deltaY * (e.ctrlKey ? 0.01 : 0.002)), toWorld(v, vp, local(e)));
  }, { passive: false });
  dialog.addEventListener("keydown", (e) => {
    // Only a form field keeps its own keys; after a zoom button is clicked, the arrows and + / − / 0 still move the map (Enter and Space are not map keys, so the buttons keep those).
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || (e.target as Element).closest?.("input, textarea, select, [contenteditable]")) return;
    const step = e.shiftKey ? 240 : 80;
    const act: Record<string, () => void> = {
      "+": () => zoomBy(1 / 1.5), "=": () => zoomBy(1 / 1.5), "-": () => zoomBy(1.5), _: () => zoomBy(1.5), "0": fitAll,
      ArrowLeft: () => setView(panView(v, step, 0, facet, vp)), ArrowRight: () => setView(panView(v, -step, 0, facet, vp)),
      ArrowUp: () => setView(panView(v, 0, step, facet, vp)), ArrowDown: () => setView(panView(v, 0, -step, facet, vp)),
    };
    const run = act[e.key];
    if (run) { e.preventDefault(); run(); }
  });
}
