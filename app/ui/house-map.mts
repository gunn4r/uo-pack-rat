// ui/house-map.mts — the House map screen (#/map, #/map/<house id>; issue #10, spec section 4). It fetches the houses the scans captured (GET /api/houses) and every house's model (GET /api/houses/<id>), picks the deep-linked house (else the last one shown, else the one with the most chests; a deep link to a house that no longer exists falls back and the route is put back to #/map), and lays out three panes: levels, rooms and the yard on the left, the map in the middle, the details on the right. Ground chests outside every drawn house are a house of their own on a plain grid. Every rule and number is ui/house-map-model.mts's; this module builds the DOM and the SVG and wires the events.
import { state } from "./store.mts";
import { $, el } from "./dom.mts";
import { api } from "./api.mts";
import { box, txt, segmented, pill, message } from "./components.mts";
import { errorText } from "./messages.mts";
import { plural } from "./inv-model.mts";
import { PLAIN, pickHouse, plainGrid, chestCount, roomCounts, houseLabel, tiledataNote, type View, type Mode, type Box } from "./house-map-model.mts";
import type { HouseModel, HousesApiResponse, HouseApiResponse, Room, Stack } from "./api-types.mts";

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
