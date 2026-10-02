// ui/house-map.mts — the House map screen (#/map, #/map/<house id>; issue #10, spec section 4). It fetches the houses the scans captured (GET /api/houses) and every house's model (GET /api/houses/<id>), picks the deep-linked house (else the last one shown, else the one with the most chests; a deep link to a house that no longer exists falls back and the route is put back to #/map), and lays out three panes: levels, rooms and the yard on the left, the map in the middle, the details on the right. Ground chests outside every drawn house are a house of their own on a plain grid. Every rule and number is ui/house-map-model.mts's; this module builds the DOM and the SVG and wires the events.
import { state, bridge } from "./store.mts";
import { $, el, safeColor, fmtN, toast } from "./dom.mts";
import { api } from "./api.mts";
import { box, txt, button, segmented, pill, message, meter, keyValue, modalOpen, tipWrap } from "./components.mts";
import { labelContainer } from "./containers.mts";
import { showContainer } from "./inventory.mts";
import { bridgeActionReason, runBridgeAction, sendBridge, type BridgeTarget } from "./bridge.mts";
import { errorText } from "./messages.mts";
import { plural } from "./inv-model.mts";
import { fillTone } from "./organize-model.mts";
import { PLAIN, pickHouse, plainGrid, chestCount, roomCounts, houseLabel, houseName, tiledataNote, chestViews, colourOf, chestLabel, sceneOf, boundsOf, fit, vbText,
  cutAway, calloutLines, nearestInDirection, houseTotals, legendOf, stackWhere, anchorOf, zoomAt, fillWords,
  type View, type Mode, type Box, type Colour, type ChestView, type Piece, type Prism, type Pt, type Dir } from "./house-map-model.mts";
import type { ContainerLabel, HouseModel, HousesApiResponse, HouseApiResponse, Room, Stack } from "./api-types.mts";

const SVG_NS = "http://www.w3.org/2000/svg";
// The map's page state: the houses and models as last fetched, the one shown, its level, view and colour mode, the room zoomed to, the selected stack (by a serial in it, so a rescan that keeps the stack keeps the selection), the hovered and focused stacks (by letter), the viewBox, and a load error.
interface MapState { list: HousesApiResponse | null; models: HouseModel[]; plain: HouseModel | null; id: string | null; model: HouseModel | null; level: number; view: View; mode: Mode; room: number | null; selected: number | null; hover: string | null; focus: string | null; vb: Box | null; error: string | null }
const S: MapState = { list: null, models: [], plain: null, id: null, model: null, level: 0, view: "angle", mode: "contents", room: null, selected: null, hover: null, focus: null, vb: null, error: null };
let seq = 0;
const body = (): HTMLElement => $<HTMLElement>("#map-body")!;
const selectedStack = (): Stack | null => (S.selected == null ? null : S.model?.stacks.find((s) => s.serials.includes(S.selected!)) ?? null);

// The top bar's view and colour switches (index.html holds placeholders), and the house picker.
const viewSeg = segmented({ label: "View", value: "angle", options: [{ value: "angle", label: "Game angle" }, { value: "top", label: "Top-down" }], onChange: (v) => { S.view = v === "top" ? "top" : "angle"; S.vb = null; render(); } });
viewSeg.id = "map-view";
$<HTMLElement>("#map-view")!.replaceWith(viewSeg);
const modeSeg = segmented({ label: "Colours", value: "contents", options: [{ value: "contents", label: "Contents" }, { value: "free", label: "Free space" }], onChange: (v) => { S.mode = v === "free" ? "free" : "contents"; render(); } });
modeSeg.id = "map-mode";
$<HTMLElement>("#map-mode")!.replaceWith(modeSeg);
$<HTMLSelectElement>("#map-house")!.addEventListener("change", (e) => { location.hash = `#/map/${encodeURIComponent((e.target as HTMLSelectElement).value)}`; });

export async function showMap(want: string | null): Promise<void> {
  if (!state.inv) return;   // before the first load; reload() calls it again
  const my = ++seq;
  if (!S.model && !S.error) body().replaceChildren(message({ tone: "info", text: "Drawing the house map…", attrs: { "aria-busy": "true" } }));
  try {
    const list = await api<HousesApiResponse>("/api/houses");
    const models = await Promise.all(list.houses.map(async (h) => (await api<HouseApiResponse>(`/api/houses/${encodeURIComponent(h.id)}`)).house));
    if (my !== seq) return;
    S.list = list; S.models = models; S.plain = plainGrid(state.inv, models); S.error = null;
  } catch (e) {
    if (my !== seq) return;
    S.error = errorText(e); S.model = null; render();
    return;
  }
  const choices = [...S.models.map((m) => ({ id: m.id, containers: chestCount(m) })), ...(S.plain ? [{ id: PLAIN, containers: chestCount(S.plain) }] : [])];
  const id = pickHouse(choices, want, S.id);
  if (want && id !== want) history.replaceState(null, "", "#/map");
  if (id !== S.id) { S.id = id; S.level = 0; S.room = null; S.selected = null; S.hover = null; S.focus = null; S.vb = null; }
  S.model = id === PLAIN ? S.plain : S.models.find((m) => m.id === id) ?? null;
  if (S.model && S.level >= S.model.levels.length) { S.level = 0; S.vb = null; }
  if (!selectedStack()) S.selected = null;   // the stack is gone since (a rescan moved its chests)
  render();
}

function render(): void {
  paintTopbar();
  if (S.error) { body().replaceChildren(message({ tone: "bad", title: "Could not load the house map", text: S.error })); return; }
  if (!S.model) { body().replaceChildren(emptyState()); return; }
  body().replaceChildren(side(), stage(), box("aside", { class: "card map-panel", id: "map-panel", "aria-label": "Details" }));
  drawPanel();   // before the map, so the first fit measures the pane with the panel already filled
  drawMap();
}

function paintTopbar(): void {
  const sel = $<HTMLSelectElement>("#map-house")!;
  const opts = [...(S.list?.houses ?? []).map((h) => ({ value: h.id, label: houseLabel(h) })), ...(S.plain ? [{ value: PLAIN, label: `Chests outside a drawn house (${chestCount(S.plain)})` }] : [])];
  sel.replaceChildren(...opts.map((o) => el("option", { value: o.value }, o.label)));
  sel.value = S.id ?? "";
  sel.disabled = opts.length < 2;
  $<HTMLElement>("#map-levels")!.replaceChildren(...(S.model?.levels ?? []).map((l) => pill({ label: l.name, pressed: l.index === S.level, onToggle: () => setLevel(l.index) })));
  viewSeg.setValue(S.view);
  modeSeg.setValue(S.mode);
}
function setLevel(i: number): void {
  S.level = i; S.room = null; S.selected = null; S.hover = null; S.vb = null;
  render();
}
function zoomToRoom(r: Room): void {
  S.level = r.level; S.room = r.id; S.selected = null; S.hover = null; S.vb = null;
  render();
}

// Left: each level with its chest count and status, its rooms and the yard, each with a count; a room zooms the map to it.
function side(): HTMLElement {
  const m = S.model!, counts = roomCounts(m);
  return box("aside", { class: "card map-side", "aria-label": "Levels and rooms" }, ...m.levels.map((l) => box("section", { class: "map-level" },
    box("h2", { class: "map-level-name" }, txt(l.name, "strong"), txt(plural(chestCount(m, l.index), "container"), "t-sm muted")),
    l.status === "floor-only" && m.id !== PLAIN ? el("p", { class: "t-sm muted" }, "Floor only, no walls or stairs yet") : null,
    box("ul", { class: "map-rooms" }, ...m.rooms.filter((r) => r.level === l.index).map((r) => box("li", {},
      box("button", { type: "button", class: "map-room", "aria-pressed": String(S.room === r.id), onclick: () => zoomToRoom(r) },
        txt(r.name, "ellip"), txt(counts.get(r.id) ? plural(counts.get(r.id)!, "container") : "no containers", "t-sm muted"))))))));
}

// The middle pane: notes above the map, the breadcrumb, then the SVG with its zoom buttons and the callout over it.
function stage(): HTMLElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.id = "map-svg";
  svg.setAttribute("class", "map-svg");
  svg.setAttribute("role", "group");
  svg.setAttribute("aria-label", "House map");
  wireSvg(svg);
  return box("section", { class: "card map-stage", id: "map-stage", "aria-label": "Map" },
    ...notes(),
    box("nav", { class: "map-crumbs", id: "map-crumbs", "aria-label": "Breadcrumb" }),
    box("div", { class: "map-canvas", id: "map-canvas" }, svg,
      box("div", { class: "map-zoom", role: "group", "aria-label": "Zoom" },
        button({ label: "Zoom in", icon: "zoom-in", iconOnly: true, size: "sm", attrs: { id: "map-zoom-in" }, onClick: () => zoomBy(1 / 1.25) }),
        button({ label: "Zoom out", icon: "zoom-out", iconOnly: true, size: "sm", attrs: { id: "map-zoom-out" }, onClick: () => zoomBy(1.25) }),
        button({ label: "Fit the level", icon: "fit", iconOnly: true, size: "sm", attrs: { id: "map-fit" }, onClick: fitTo })),
      box("div", { class: "map-callout", id: "map-callout", hidden: "" })));
}
function notes(): HTMLElement[] {
  const note = S.id === PLAIN || !S.list || S.list.tiledata ? null : tiledataNote(S.list.tiledataFrom.reason);
  return note ? [message({ tone: "warn", title: "Plain colours", text: note, attrs: { id: "map-tiledata-note" }, actions: [box("a", { class: "btn btn-sm", href: "#/settings" }, txt("Set the UO folder in Settings"))] })] : [];
}
function emptyState(): HTMLElement {
  return box("section", { class: "card map-empty" }, box("div", { class: "empty-state" },
    el("h2", { class: "t-lg" }, "No house to draw yet"),
    el("p", { class: "muted" }, "Scan from inside your house with the 2.11.0 scripts (TazUO), and the house map draws it here with every chest where it stands.")));
}

// ---------------------------------------------------------------- drawing
const labels = (): Record<string, ContainerLabel> => state.organize.config?.labels ?? {};
// A chest colour as CSS: a token, or a label colour that passed safeColor (anything else draws as an unlabelled chest).
const cssColour = (c: Colour): string => ("token" in c ? `var(${c.token})` : safeColor(c.label) ?? "var(--color-map-chest)");
function sv(tag: string, attrs: Record<string, string>, ...kids: SVGElement[]): SVGElement {
  const e = document.createElementNS(SVG_NS, tag) as SVGElement;
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  e.append(...kids);
  return e;
}
// A box as its two shaded sides (the stylesheet darkens them) and its top.
function prismEl(cls: string, p: Prism): SVGElement {
  const g = sv("g", { class: cls });
  if (p.left) g.append(sv("polygon", { class: "side-l", points: p.left }));
  if (p.right) g.append(sv("polygon", { class: "side-r", points: p.right }));
  g.append(sv("polygon", { class: "top", points: p.top }));
  return g;
}
function viewsOf(m: HouseModel): Map<number, ChestView> {
  const inv = state.inv!, labs = labels();
  return new Map(m.stacks.filter((s) => s.level === S.level).flatMap((s) => chestViews(m, s, inv, labs)).map((v) => [v.serial, v]));
}
function pieceEl(p: Piece, views: Map<number, ChestView>): SVGElement {
  switch (p.kind) {
    case "solid": return prismEl(p.cls, p.prism);
    case "item": { const g = prismEl(p.cls, p.prism); g.dataset.name = p.name || "furniture"; return g; }
    case "spot": return sv("g", { class: "map-spot", role: "img", "aria-label": `Standing spot ${p.spot.id + 1}: every chest in its dashed square is within reach` },
      sv("ellipse", { cx: String(p.at[0]), cy: String(p.at[1]), rx: "6", ry: "3" }),
      sv("rect", { x: String(p.at[0] - 3), y: String(p.at[1] - 17), width: "6", height: "14", rx: "3" }),
      sv("circle", { cx: String(p.at[0]), cy: String(p.at[1] - 20), r: "3.6" }));
    case "stack": {
      // A button's children are presentational, so the stack's own name carries its chests, top first, as each chest's label words them.
      const named = p.chests.flatMap((c) => { const v = views.get(c.serial); return v ? [chestLabel(v)] : []; }).reverse();
      const g = sv("g", { class: "map-stack", "data-stack": p.stack.letter, role: "button", tabindex: "-1", "aria-pressed": "false", "aria-label": `Stack ${p.stack.letter}, ${plural(p.stack.serials.length, "chest")}: ${named.join("; ")}` });
      for (const c of p.chests) {
        const v = views.get(c.serial);
        if (!v) continue;
        const ch = prismEl(v.opened ? "map-chest" : "map-chest unopened", c.prism);
        ch.setAttribute("role", "img");
        ch.setAttribute("aria-label", chestLabel(v));
        ch.setAttribute("data-chest", String(c.serial));
        ch.style.setProperty("--chest", cssColour(colourOf(v, S.mode)));
        g.append(ch);
      }
      return g;
    }
  }
}
function viewport(): { width: number; height: number } {
  const svg = $<SVGSVGElement>("#map-svg");
  return { width: svg?.clientWidth || 800, height: svg?.clientHeight || 600 };
}
// The current level, built once per level, view, mode or data change; pan and zoom only ever change the viewBox. The breadcrumb is drawn before the first fit, so the viewport it measures is the one left under it.
function drawMap(): void {
  const svg = $<SVGSVGElement>("#map-svg"), m = S.model;
  if (!svg || !m) return;
  const scene = sceneOf(m, S.level, S.view), views = viewsOf(m);
  const ground = sv("g", { class: "map-ground" }), solids = sv("g", { class: "map-solids" });
  for (const p of scene.below) ground.append(sv("polygon", { class: "map-below", points: p }));
  for (const f of scene.floors) ground.append(sv("polygon", { class: f.cls, points: f.pts }));
  for (const r of scene.reach) ground.append(sv("polygon", { class: "map-reach", points: r }));
  for (const p of scene.pieces) solids.append(pieceEl(p, views));
  svg.replaceChildren(ground, solids);
  drawCrumbs();
  if (!S.vb) S.vb = fit(boundsOf(m, S.level, S.view, m.rooms.find((r) => r.id === S.room) ?? null), viewport());
  svg.setAttribute("viewBox", vbText(S.vb));
  paintStacks();
}
// The selection, the cut-away in front of the hovered (or focused) stack, else the selected one (Game angle only: top-down nothing hides anything), and the roving tab stop (the focused stack, else the selected one, else the first in code order).
function paintStacks(): void {
  const m = S.model;
  if (!m) return;
  const sel = selectedStack(), here = m.stacks.filter((s) => s.level === S.level);
  const focus = here.find((s) => s.letter === S.hover) ?? (sel?.level === S.level ? sel : null);
  const cut = focus && S.view === "angle" ? cutAway(m, S.level, focus) : new Set<string>();
  const roving = here.find((s) => s.letter === S.focus)?.letter ?? (sel?.level === S.level ? sel.letter : here[0]?.letter);
  for (const e of document.querySelectorAll<SVGGElement>("#map-svg .map-stack")) {
    const letter = e.dataset.stack;
    e.classList.toggle("sel", letter === sel?.letter);
    e.classList.toggle("cut", !!letter && cut.has(letter));
    e.setAttribute("aria-pressed", String(letter === sel?.letter));
    e.setAttribute("tabindex", letter === roving ? "0" : "-1");
  }
}
// house › level › room › stack; each part above the last goes back up to it.
function drawCrumbs(): void {
  const nav = $<HTMLElement>("#map-crumbs"), m = S.model;
  if (!nav || !m) return;
  const sel = selectedStack(), level = m.levels[S.level], room = m.rooms.find((r) => r.id === (sel?.room ?? S.room)) ?? null;
  const crumb = (label: string, go: (() => void) | null): HTMLElement => box("li", {}, go ? button({ label, variant: "ghost", size: "sm", onClick: go }) : txt(label, "strong"));
  const up = (level: number): void => { S.level = level; S.room = null; S.selected = null; S.hover = null; S.vb = null; render(); };
  nav.replaceChildren(box("ol", { class: "map-crumb-list" },
    crumb(houseName(m), sel || S.room != null || S.level !== 0 ? () => up(0) : null),
    level ? crumb(level.name, sel || S.room != null ? () => up(S.level) : null) : null,
    room ? crumb(room.name, sel ? () => zoomToRoom(room) : null) : null,
    sel ? crumb(`Stack ${sel.letter}`, null) : null));
}

// ---------------------------------------------------------------- interaction
// A press that moves more than 3 px pans the viewBox; one that does not is a click (a stack selects it, anywhere else clears). The wheel zooms about the pointer. Neither touches the drawing. A drag ends however the pointer leaves it: released off the map, cancelled, or its capture lost (an OS gesture, a switch of window).
function wireSvg(svg: SVGSVGElement): void {
  let drag: { x: number; y: number; vb: Box; id: number; moved: boolean } | null = null;
  const endDrag = (): void => { drag = null; svg.classList.remove("dragging"); };
  svg.addEventListener("pointerdown", (e) => { if (e.button === 0 && S.vb) drag = { x: e.clientX, y: e.clientY, vb: S.vb, id: e.pointerId, moved: false }; });
  svg.addEventListener("pointermove", (e) => {
    if (drag && !(e.buttons & 1)) endDrag();
    if (!drag) { hoverAt(e); return; }
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) > 3) { drag.moved = true; svg.setPointerCapture(drag.id); svg.classList.add("dragging"); hideCallout(); }
    if (drag.moved) { const k = drag.vb.w / (svg.clientWidth || 1); setViewBox({ ...drag.vb, x: drag.vb.x - dx * k, y: drag.vb.y - dy * k }); }
  });
  svg.addEventListener("pointerup", (e) => {
    const d = drag;
    endDrag();
    if (!d) return;
    if (d.moved) { if (svg.hasPointerCapture(e.pointerId)) svg.releasePointerCapture(e.pointerId); return; }
    const hit = (e.target as Element).closest?.("[data-stack]") as SVGElement | null;
    pick(hit?.dataset.stack ?? null);
  });
  svg.addEventListener("pointercancel", endDrag);
  svg.addEventListener("lostpointercapture", endDrag);
  svg.addEventListener("pointerleave", () => { if (!drag) { S.hover = null; paintStacks(); hideCallout(); } });
  svg.addEventListener("wheel", (e) => { e.preventDefault(); if (e.deltaY === 0) return; zoomBy(e.deltaY > 0 ? 1.15 : 1 / 1.15, svgPoint(svg, e.clientX, e.clientY)); }, { passive: false });
  svg.addEventListener("keydown", stackKeys);
  svg.addEventListener("focusin", (e) => {
    const t = (e.target as Element).closest?.("[data-stack]") as SVGElement | null;
    if (!t?.dataset.stack) return;
    S.focus = S.hover = t.dataset.stack;
    paintStacks();
    showCallout(t.dataset.stack);
  });
  svg.addEventListener("focusout", () => { S.hover = null; paintStacks(); hideCallout(); });
}
function hoverAt(e: PointerEvent): void {
  const t = e.target as Element, st = t.closest?.("[data-stack]") as SVGElement | null, item = t.closest?.("[data-name]") as SVGElement | null;
  const letter = st?.dataset.stack ?? null, changed = letter !== S.hover;
  if (changed) { S.hover = letter; paintStacks(); }
  const svg = $<SVGSVGElement>("#map-svg");
  if (letter) { if (changed || $<HTMLElement>("#map-callout")?.hidden) showCallout(letter); }   // a stack's callout is built once per stack hovered (again after a pan or zoom hid it)
  else if (item?.dataset.name && svg) showName(item.dataset.name, svgPoint(svg, e.clientX, e.clientY));
  else hideCallout();
}
// The callout: a stack's chests top first with their fill, at a fixed on-screen size, beside the stack and inside the map pane.
function showCallout(letter: string): void {
  const m = S.model, s = m?.stacks.find((x) => x.letter === letter), out = $<HTMLElement>("#map-callout");
  if (!m || !s || !out) return;
  const c = calloutLines(s, chestViews(m, s, state.inv!, labels()), S.mode);
  out.replaceChildren(txt(c.title, "t-sm strong"), ...c.lines.map((l) => box("div", { class: "map-callout-row" }, swatchEl(l.colour), txt(l.code, "mono t-sm"), txt(l.name, "ellip t-sm"), txt(l.fill, "num muted t-sm"))));
  out.hidden = false;
  place(out, anchorOf(m, s, S.view));
}
function showName(name: string, at: Pt): void {
  const out = $<HTMLElement>("#map-callout");
  if (!out) return;
  out.replaceChildren(txt(name, "t-sm"));
  out.hidden = false;
  place(out, at);
}
function hideCallout(): void { const out = $<HTMLElement>("#map-callout"); if (out) out.hidden = true; }
// To the right of the point, else to its left, and clamped 8 px inside the map pane.
function place(out: HTMLElement, at: Pt): void {
  const svg = $<SVGSVGElement>("#map-svg"), canvas = $<HTMLElement>("#map-canvas"), ctm = svg?.getScreenCTM();
  if (!svg || !canvas || !ctm) return;
  const p = new DOMPoint(at[0], at[1]).matrixTransform(ctm), r = canvas.getBoundingClientRect(), w = out.offsetWidth, h = out.offsetHeight;
  let x = p.x - r.left + 16;
  if (x + w > r.width - 8) x = p.x - r.left - w - 16;
  out.style.left = `${Math.max(8, x)}px`;
  out.style.top = `${Math.max(8, Math.min(p.y - r.top - 12, r.height - h - 8))}px`;
}
function svgPoint(svg: SVGSVGElement, x: number, y: number): Pt {
  const ctm = svg.getScreenCTM();
  if (!ctm) return [0, 0];
  const p = new DOMPoint(x, y).matrixTransform(ctm.inverse());
  return [p.x, p.y];
}
function setViewBox(b: Box): void {
  S.vb = b;
  $<SVGSVGElement>("#map-svg")?.setAttribute("viewBox", vbText(b));
  hideCallout();
}
function zoomBy(f: number, at?: Pt): void { if (S.vb) setViewBox(zoomAt(S.vb, f, at?.[0], at?.[1])); }
function fitTo(): void {
  if (!S.model) return;
  S.room = null;
  for (const b of document.querySelectorAll(".map-room")) b.setAttribute("aria-pressed", "false");
  setViewBox(fit(boundsOf(S.model, S.level, S.view), viewport()));
  drawCrumbs();
}
// A click or Enter on a stack selects it (again unselects it); anywhere else clears the selection.
function pick(letter: string | null): void {
  const s = letter ? S.model?.stacks.find((x) => x.letter === letter) ?? null : null;
  select(s && s !== selectedStack() ? s.serials[0]! : null);
}
function select(serial: number | null): void {
  S.selected = serial;
  const s = selectedStack();
  if (s) S.focus = s.letter;
  paintStacks();
  drawCrumbs();
  drawPanel();
}
// Enter or Space selects the focused stack; an arrow key moves to the nearest stack that way on screen.
const ARROWS: Record<string, Dir> = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" };
function stackKeys(e: KeyboardEvent): void {
  const t = (e.target as Element).closest?.("[data-stack]") as SVGElement | null, m = S.model;
  if (!t?.dataset.stack || !m || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(t.dataset.stack); return; }
  const dir = ARROWS[e.key];
  if (!dir) return;
  e.preventDefault();
  const here = m.stacks.find((s) => s.letter === t.dataset.stack)!;
  const next = nearestInDirection(anchorOf(m, here, S.view), m.stacks.filter((s) => s.level === S.level && s !== here).map((s) => ({ id: s.letter, at: anchorOf(m, s, S.view) })), dir);
  if (next) focusStack(next);
}
function focusStack(letter: string): void {
  S.focus = letter;
  paintStacks();
  $<SVGElement>(`#map-svg [data-stack="${letter}"]`)?.focus();
}
// Esc clears the selection, unless something nearer the user takes it (a field, a dialog, a drawer or a popover), another screen is showing, or a modifier is held. On the document: after a click on blank space focus is on <body>, outside the map.
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || S.selected == null || $<HTMLElement>("#tab-map")!.hidden) return;
  const t = e.target as Element | null;
  if (t?.closest?.("input, textarea, select, [contenteditable], dialog, .drawer-root") || document.querySelector(".pop, .drawer-root:not([hidden])") || modalOpen()) return;
  e.preventDefault();
  select(null);
});

// ---------------------------------------------------------------- the panel
function swatchEl(c: Colour | null): HTMLElement | null {
  return c ? el("span", { class: "map-swatch", "aria-hidden": "true", style: `background:${cssColour(c)}` }) : null;
}
function legend(): HTMLElement {
  return box("ul", { class: "map-legend", id: "map-legend", "aria-label": "Colours" }, ...legendOf(S.mode).map((l) => box("li", { class: "map-legend-item" }, swatchEl(l.token ? { token: l.token } : null), txt(l.text, "t-sm"))));
}
// The selected stack's chests, else the house's totals. Highlight the stack is offered on the same terms as each chest's Highlight.
function drawPanel(): void {
  const p = $<HTMLElement>("#map-panel"), m = S.model;
  if (!p || !m) return;
  const s = selectedStack();
  if (!s) { p.replaceChildren(...totalsPanel(m)); return; }
  const chests = chestViews(m, s, state.inv!, labels());
  const why = stackReason(m, s, chests);
  const all = button({ label: chests.length > 1 ? "Highlight the stack" : "Highlight", icon: "highlight", size: "sm", disabled: !!why, attrs: { id: "map-highlight-stack" }, onClick: () => { void highlightStack(m, s, chests); } });
  p.replaceChildren(
    box("header", { class: "map-panel-head" }, el("h2", { class: "t-lg" }, chests.length > 1 ? `Stack ${s.letter}` : chests[0]!.name), txt(stackWhere(m, s), "t-sm muted")),
    box("ol", { class: "map-chests", "aria-label": "Chests, top first" }, ...chests.map((c) => chestRow(m, s, c))),
    box("div", { class: "map-panel-actions" }, why ? tipWrap(all, why) : all, button({ label: "Back to the house", variant: "ghost", size: "sm", onClick: () => select(null) })),
    legend());
}
// Nothing selected: the house's totals, the colours, and how to start.
function totalsPanel(m: HouseModel): HTMLElement[] {
  const t = houseTotals(m.stacks.flatMap((s) => chestViews(m, s, state.inv!, labels())));
  return [
    box("header", { class: "map-panel-head" }, el("h2", { class: "t-lg" }, houseName(m)),
      txt(m.id === PLAIN ? "Ground chests outside any drawn house" : `${plural(m.levels.length, "level")} · ${plural(m.stacks.length, "stack")} · ${plural(m.spots.length, "standing spot")}`, "t-sm muted")),
    ...(t.capacity ? [meter(t.used, t.capacity, { label: `${t.used} of ${t.capacity} item slots used` })] : []),
    keyValue([["Containers", fmtN(t.containers)], ["Item slots used", `${fmtN(t.used)} of ${fmtN(t.capacity)}`], ["Item slots free", fmtN(t.capacity - t.used)], ["Empty", fmtN(t.empty)], ["Full or nearly", fmtN(t.full)], ["Not opened yet", fmtN(t.unopened)]]),
    legend(),
    el("p", { class: "t-sm muted" }, "Click a stack on the map, or a room on the left."),
  ];
}
// A chest as the bridge's target: the chest itself, with no chain. A chest no scan opened has no scanned root, so it carries the place its house capture saw it.
function chestTarget(m: HouseModel, s: Stack, c: ChestView): { it: BridgeTarget; opts: { pos?: unknown } } {
  return { it: { serial: c.serial, name: c.name, container: null, root: c.opened ? c.serial : null }, opts: c.opened ? {} : { pos: { x: s.x, y: s.y, z: c.z, ...(m.facet != null ? { facet: m.facet } : {}) } } };
}
const stackReason = (m: HouseModel, s: Stack, chests: ChestView[]): string | null => chests.map((c) => bridgeActionReason("highlight", chestTarget(m, s, c).it)).find((r) => r) ?? null;
// One chest of the selected stack: its code and name (the in-game name too when a label renames it), its fill and item count or why they are not known yet, and Highlight, Label… and Show items. Label… and Show items wait for a scan that opens the chest.
function chestRow(m: HouseModel, s: Stack, c: ChestView): HTMLElement {
  const { it, opts } = chestTarget(m, s, c);
  const notOpened = `Not opened yet: scan from standing spot ${(s.spot ?? 0) + 1} to label it and list what is in it.`;
  const why = bridgeActionReason("highlight", it);
  const hl = button({ label: "Highlight", icon: "highlight", size: "sm", disabled: !!why, attrs: { "data-act": "highlight" }, onClick: () => { void runBridgeAction("highlight", it, opts); } });
  const container = state.inv!.containers[String(c.serial)];
  const noLabel = !c.opened ? notOpened : state.organize.blacklist.includes(c.serial) ? "Blacklisted: scans skip it. Unblacklist it in Settings to label it." : null;
  const lbl = button({ label: labels()[String(c.serial)] ? "Edit label…" : "Label…", size: "sm", disabled: !!noLabel, attrs: { "data-act": "label" }, onClick: () => { if (container) void labelContainer(container); } });
  const items = button({ label: "Show items", size: "sm", disabled: !c.opened, attrs: { "data-act": "items" }, onClick: () => showContainer(c.serial) });
  return box("li", { class: `map-chest-row${c.opened ? "" : " unopened"}`, "data-chest": String(c.serial) },
    swatchEl(colourOf(c, S.mode)),
    box("div", { class: "map-chest-text" },
      box("span", { class: "map-chest-name" }, txt(c.code, "mono strong"), txt(c.name, "ellip strong")),
      c.name !== c.inGame ? txt(`In game: ${c.inGame}`, "t-sm muted ellip") : null,
      c.fill ? box("span", { class: "cont-fill" }, meter(c.fill.items, c.fill.max, { tone: fillTone(c.fill), label: fillWords(c) }), txt(`${c.fill.items}/${c.fill.max}`, "t-sm num")) : txt("Fill unknown", "t-sm muted"),
      txt(c.opened ? plural(c.items, "item") : notOpened, c.opened ? "t-sm muted" : "t-sm")),
    box("div", { class: "map-chest-actions" }, why ? tipWrap(hl, why) : hl, noLabel ? tipWrap(lbl, noLabel) : lbl, c.opened ? items : tipWrap(items, notOpened)));
}
// Highlight the stack: one highlight per chest, top first, 300 ms apart, stopping at the first refusal; one toast says how it went.
async function highlightStack(m: HouseModel, s: Stack, chests: ChestView[]): Promise<void> {
  const why = stackReason(m, s, chests);
  if (why) { toast(why, "bad"); return; }
  let sent = 0, stopped: string | null = null;
  for (const c of chests) {
    const { it, opts } = chestTarget(m, s, c);
    const r = await sendBridge("highlight", it, opts);
    if (!r.ok) { stopped = `${c.name}: ${r.error}`; break; }
    sent++;
    if (sent < chests.length) await new Promise((res) => setTimeout(res, 300));
  }
  toast(stopped ? `${sent} of ${chests.length} queued, stopped at ${stopped}` : `${plural(sent, "highlight")} queued for ${bridge.character}`, stopped ? "bad" : "");
}
// A saved label changes chest colours and names; the bridge going on or off line changes what Highlight may do.
document.addEventListener("organizechange", () => { if (S.model && !$<HTMLElement>("#tab-map")!.hidden) { drawMap(); drawPanel(); } });
document.addEventListener("bridgechange", () => { if (S.model && !$<HTMLElement>("#tab-map")!.hidden) drawPanel(); });
