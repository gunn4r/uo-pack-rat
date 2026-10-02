// ui/house-map.mts — the House map screen (#/map, #/map/<house id>; issue #10, spec section 4). It fetches the houses the scans captured (GET /api/houses) and every house's model (GET /api/houses/<id>), picks the deep-linked house (else the last one shown, else the one with the most chests; a deep link to a house that no longer exists falls back and the route is put back to #/map), and lays out three panes: levels, rooms and the yard on the left, the map in the middle, the details on the right. Ground chests outside every drawn house are a house of their own on a plain grid. Every rule and number is ui/house-map-model.mts's; this module builds the DOM and the SVG and wires the events.
import { state } from "./store.mts";
import { $, el, safeColor } from "./dom.mts";
import { api } from "./api.mts";
import { box, txt, button, segmented, pill, message } from "./components.mts";
import { errorText } from "./messages.mts";
import { plural } from "./inv-model.mts";
import { PLAIN, pickHouse, plainGrid, chestCount, roomCounts, houseLabel, houseName, tiledataNote, chestViews, colourOf, chestLabel, sceneOf, boundsOf, fit, vbText,
  type View, type Mode, type Box, type Colour, type ChestView, type Piece, type Prism } from "./house-map-model.mts";
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

// The middle pane: notes above the map, the breadcrumb, then the SVG.
function stage(): HTMLElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.id = "map-svg";
  svg.setAttribute("class", "map-svg");
  svg.setAttribute("role", "group");
  svg.setAttribute("aria-label", "House map");
  return box("section", { class: "card map-stage", id: "map-stage", "aria-label": "Map" },
    ...notes(),
    box("nav", { class: "map-crumbs", id: "map-crumbs", "aria-label": "Breadcrumb" }),
    box("div", { class: "map-canvas", id: "map-canvas" }, svg));
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
// The selection and the roving tab stop (one stack at a time is in the tab order: the focused one, else the selected one, else the first in code order).
function paintStacks(): void {
  const m = S.model;
  if (!m) return;
  const sel = selectedStack(), here = m.stacks.filter((s) => s.level === S.level);
  const roving = here.find((s) => s.letter === S.focus)?.letter ?? (sel?.level === S.level ? sel.letter : here[0]?.letter);
  for (const e of document.querySelectorAll<SVGGElement>("#map-svg .map-stack")) {
    const letter = e.dataset.stack;
    e.classList.toggle("sel", letter === sel?.letter);
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
