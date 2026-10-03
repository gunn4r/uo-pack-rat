// ui/house-map.mts — the House map screen (#/map, #/map/<house id>; issue #10, spec section 4). It fetches the houses the scans captured (GET /api/houses) and every house's model (GET /api/houses/<id>), picks the deep-linked house (else the last one shown, else the one with the most chests; a deep link to a house that no longer exists falls back and the route is put back to #/map), and lays out three panes: levels and the player's own areas on the left (issue #10: drawn on the map by mouse or keyboard, named, renamed, recoloured, redrawn and deleted here), the map in the middle, the details on the right, and a chest's contents in a drawer beside them. Ground chests outside every drawn house are a house of their own on a plain grid. Every rule and number is ui/house-map-model.mts's; this module builds the DOM and the SVG and wires the events.
import { state, bridge } from "./store.mts";
import { $, el, itemTip, safeColor, fmtN, toast } from "./dom.mts";
import { api } from "./api.mts";
import { box, txt, button, segmented, pill, message, meter, keyValue, modalOpen, tipWrap, input, copyText, icon, kbd, menu, popover, closePopover, confirmDialog, select as selectEl } from "./components.mts";
import { labelContainer } from "./containers.mts";
import { showContainer, itemMenu, itemActions, rarityEl, tagEls } from "./inventory.mts";
import { propertyLines, RESISTS } from "./peek.mts";
import { bridgeActionReason, runBridgeAction, sendBridge, type BridgeTarget } from "./bridge.mts";
import { errorText } from "./messages.mts";
import { openWorldMap, fetchFacetImage, type FacetImage } from "./world-map.mts";
import { plural } from "./inv-model.mts";
import { fillTone } from "./organize-model.mts";
import { PLAIN, pickHouse, plainGrid, chestCount, houseLabel, houseName, carryOver, carryOverText, tiledataNote, chestViews, colourOf, chestLabel, sceneOf, boundsOf, fit, vbText,
  cutAway, calloutLines, nearestInDirection, houseTotals, legendOf, stackWhere, anchorOf, zoomAt, fillWords, whereOf, whereTitle, cropAround, facetMapUrl, markersOf, facetMapNote, markerRadii,
  drawerChest, drawerMeta, slotsText, drawerPicker, DRAWER_W, DRAWER_MIN, drawerMax, clampDrawer, drawerKey, contentsOf, contentsSummary, filterContents, areaOfStack, levelAreas, tileAt, clampTile, rectOf, sizeText, unionTiles, coveredCells, outlineOf, pillsOf, fitLabel, placePill as pillBox, LABEL_FIT, type AreaPill,
  nextAreaId, nextAreaColor, moveCursor, project, tilePolygon, pts, liveAreas, withOrphans, redrawFailed, AREA_COLORS, AREA_COLOR_NAMES, MAX_AREAS, MAX_RECTS, type PlainModel, type Tile, type Contents, type ContentsNode, type Marker, type View, type Mode, type Box, type Colour, type ChestView, type Piece, type Prism, type Pt, type Dir } from "./house-map-model.mts";
import type { AreaRect, ContainerLabel, HouseArea, HouseModel, UiPrefs, HousesApiResponse, HouseApiResponse, HouseMapApiResponse, HouseMapEntry, HouseMapPutApiResponse, ItemsApiResponse, Stack } from "./api-types.mts";
import type { Item } from "../vault-lib.mts";

const SVG_NS = "http://www.w3.org/2000/svg";
// The map's page state: the houses and models as last fetched, the player's house names and areas (issues #164, #10), the one shown, its level, view and colour mode, the area zoomed to (by id), the selected stack (by a serial in it, so a rescan that keeps the stack keeps the selection), the hovered and focused stacks (by letter), the viewBox, and a load error.
interface MapState { list: HousesApiResponse | null; names: Record<string, HouseMapEntry>; models: HouseModel[]; plain: PlainModel | null; id: string | null; model: HouseModel | null; level: number; view: View; mode: Mode; area: string | null; selected: number | null; hover: string | null; focus: string | null; vb: Box | null; error: string | null }
const S: MapState = { list: null, names: {}, models: [], plain: null, id: null, model: null, level: 0, view: "angle", mode: "contents", area: null, selected: null, hover: null, focus: null, vb: null, error: null };
let seq = 0;
let highlighting = false;   // Highlight the stack is sending (highlightStack)
let renaming: string | null = null;   // while renaming, the name as typed so far: a redraw rebuilds the field from it (renameField)
let nameError: string | null = null;  // the server's reason for the last refused name, shown under the field until a save or a cancel
// Each facet overview asked for, until the next load of the screen: loading, the image with the region the server drew, or why there is none (world-map.mts fetchFacetImage).
const facetImages = new Map<string, "loading" | FacetImage>();
const body = (): HTMLElement => $<HTMLElement>("#map-body")!;
const selectedStack = (): Stack | null => (S.selected == null ? null : S.model?.stacks.find((s) => s.serials.includes(S.selected!)) ?? null);
// The areas of the house as last saved: the player's (house-map.json) on the levels it has (liveAreas: one on a level a rebuild took away is left out of the list, the counts, the cap and the next save).
const savedAreas = (m: HouseModel): HouseArea[] => liveAreas(S.names[m.id]?.areas, m.levels.length);
// The areas of the house shown: as saved, with a redraw still being saved already in its new shape; or the plain grid's groups (read-only).
const areasNow = (): HouseArea[] => {
  if (S.id === PLAIN) return S.plain?.areas ?? [];
  const m = S.model, saved = m ? savedAreas(m) : [];
  return redrawn ? saved.map((a) => (a.id === redrawn!.id ? { ...a, rects: redrawn!.rects } : a)) : saved;
};
const areaById = (id: string | null): HouseArea | null => (id == null ? null : areasNow().find((a) => a.id === id) ?? null);
// ---------------------------------------------------------------- editing areas (issue #10)
// Drawing: the level, the area being redrawn (null for a new one), the rectangles finished, the one being dragged or laid by the keyboard (from its anchor), whether it is added to the others (Shift), and the keyboard's tile cursor (shown once the keyboard moves it).
interface Draw { level: number; target: string | null; color: string; rects: AreaRect[]; cur: AreaRect | null; anchor: Tile | null; add: boolean; cursor: Tile; keyed: boolean }
let draw: Draw | null = null;
let dragging = false;   // a mouse drag is drawing a rectangle
// A new area drawn and waiting for its name (the field's draft kept through redraws), an area being renamed, one asking to be deleted, and a save under way.
let naming: { level: number; color: string; rects: AreaRect[]; draft: string; error: string | null } | null = null;
let renamingArea: { id: string; draft: string; error: string | null } | null = null;
let redrawn: { id: string; rects: AreaRect[] } | null = null;   // a redraw shown before its save is answered
// The area under the pointer (on the map, or its row in the left pane) or focused in the pane: drawn stronger, its pill showing the whole name on top.
let hotArea: string | null = null;
// Whether the area name pills are hidden (ui-prefs areaLabels, set at load by applyMapPrefs; the zoom stack's toggle saves it).
let labelsHidden = false;
// The contents drawer's width as chosen (ui-prefs mapDrawerWidth, set at load by applyMapPrefs; its handle saves it), and as shown: the chosen width clamped to what the window leaves (fitDrawer).
let drawerW = DRAWER_W, shownW = DRAWER_W;
export function applyMapPrefs(prefs: UiPrefs | null): void { labelsHidden = prefs?.areaLabels === "hide"; drawerW = prefs?.mapDrawerWidth ?? DRAWER_W; }
function toggleLabels(): void {
  labelsHidden = !labelsHidden;
  paintLabelsButton();
  paintPills();
  api("/api/ui-prefs", { method: "PUT", body: { areaLabels: labelsHidden ? "hide" : "show" } }).catch((e: Error) => toast(`Could not save the area labels choice: ${e.message}`, "bad"));
}
// One name, Hide area labels; pressed while they are hidden.
function paintLabelsButton(): void { $<HTMLButtonElement>("#map-labels")?.setAttribute("aria-pressed", String(labelsHidden)); }
function setHot(id: string | null): void {
  if (id === hotArea) return;
  hotArea = id;
  for (const g of document.querySelectorAll<SVGGElement>("#map-svg .map-area-shape[data-area-shape]")) g.classList.toggle("hot", g.dataset.areaShape === id);
  paintPills(true);
}
const stopEditing = (): void => { draw = null; dragging = false; naming = null; renamingArea = null; };
// Leaving drawing mode any other way than Enter or Esc (another level, a crumb): said too.
const dropDrawing = (): void => { if (!draw) return; draw = null; dragging = false; announce("Drawing cancelled."); };

// The top bar's view and colour switches (index.html holds placeholders), and the house picker.
const viewSeg = segmented({ label: "View", value: "angle", options: [{ value: "angle", label: "Game angle" }, { value: "top", label: "Top-down" }], onChange: (v) => { S.view = v === "top" ? "top" : "angle"; S.vb = null; render(); } });
viewSeg.id = "map-view";
$<HTMLElement>("#map-view")!.replaceWith(viewSeg);
const modeSeg = segmented({ label: "Colours", value: "contents", options: [{ value: "contents", label: "Contents" }, { value: "free", label: "Free space" }], onChange: (v) => { S.mode = v === "free" ? "free" : "contents"; render(); } });
modeSeg.id = "map-mode";
$<HTMLElement>("#map-mode")!.replaceWith(modeSeg);
// What the drawing keys did, for a screen reader: outside the panes a redraw rebuilds, so an announcement made just after one is still heard.
$<HTMLElement>("#tab-map")!.append(box("div", { class: "sr", id: "map-draw-live", "aria-live": "polite" }));
// The live region is emptied, then filled on the next frame, so the same words said twice (two moves of the same size) are read twice; only the latest of several in one frame is said.
let announced = 0;
function announce(text: string): void {
  const live = $<HTMLElement>("#map-draw-live"), my = ++announced;
  if (!live) return;
  live.textContent = "";
  requestAnimationFrame(() => { if (my === announced) live.textContent = text; });
}
$<HTMLSelectElement>("#map-house")!.addEventListener("change", (e) => { location.hash = `#/map/${encodeURIComponent((e.target as HTMLSelectElement).value)}`; });

export async function showMap(want: string | null): Promise<void> {
  if (!state.inv) return;   // before the first load; reload() calls it again
  const my = ++seq;
  if (!S.model && !S.error) body().replaceChildren(message({ tone: "info", text: "Drawing the house map…", attrs: { "aria-busy": "true" } }));
  try {
    const [list, names] = await Promise.all([api<HousesApiResponse>("/api/houses"), api<HouseMapApiResponse>("/api/house-map")]);
    const models = await Promise.all(list.houses.map(async (h) => (await api<HouseApiResponse>(`/api/houses/${encodeURIComponent(h.id)}`)).house));
    if (my !== seq) return;
    S.list = list; S.names = names.houses; S.models = models; S.plain = plainGrid(state.inv, models); S.error = null;
    facetImages.clear();
  } catch (e) {
    if (my !== seq) return;
    S.error = errorText(e); S.model = null; render();
    return;
  }
  const choices = [...S.models.map((m) => ({ id: m.id, containers: chestCount(m) })), ...(S.plain ? [{ id: PLAIN, containers: chestCount(S.plain) }] : [])];
  const id = pickHouse(choices, want, S.id);
  if (want && id !== want) history.replaceState(null, "", "#/map");
  if (id !== S.id) { S.id = id; renaming = null; nameError = null; stopEditing(); S.level = 0; S.area = null; S.selected = null; S.hover = null; S.focus = null; S.vb = null; }
  S.model = id === PLAIN ? S.plain : S.models.find((m) => m.id === id) ?? null;
  if (S.model && S.level >= S.model.levels.length) { S.level = 0; S.vb = null; stopEditing(); }
  if (S.area && !areaById(S.area)) S.area = null;   // deleted meanwhile
  if (!selectedStack()) S.selected = null;   // the stack is gone since (a rescan moved its chests)
  if (!render() && D) void loadDrawer();   // a new scan: the open drawer's chest fetched again (once), its tab, filter, folded bags and scroll kept
}

// Returns whether it started fetching the drawer's chest (the selection moved it to another chest), so a reload asks for it only once.
function render(): boolean {
  const refocusScreen = keepFocus();
  document.title = S.model?.name ? `${S.model.name} · Pack Rat` : "Pack Rat";
  paintTopbar();
  let fetching = false;
  if (!S.model) {
    body().classList.remove("has-drawer");
    body().replaceChildren(S.error ? message({ tone: "bad", title: "Could not load the house map", text: S.error }) : emptyState());
  } else {
    fetching = followSelection();
    if (fetching) void loadDrawer();
    const drawer = $<HTMLElement>("#map-drawer");   // kept, so a redraw does not slide it in again
    body().replaceChildren(side(), stage(), box("aside", { class: "card map-panel", id: "map-panel", "aria-label": "Details" }), ...(drawer && D ? [drawer] : []));
    drawPanel();   // before the map, so the first fit measures the pane with the panel and the drawer already filled
    placeDrawer();
    drawMap();
  }
  refocusScreen?.();
  return fetching;
}
type Focusable = HTMLElement | SVGElement;
// The focused control on the map screen, as a function that puts focus on its rebuilt twin once render() is done: a level pill, a crumb or a stack by its data key, a control of the left pane by its id (an area's row, ✎ and ⋯, + New area, a name field), the map itself while drawing, a panel control by focusKey. One that is gone hands focus to a stand-in: the first pill for a pill, the last crumb still a button for a crumb, else the map's tab stop. Null when focus is outside the screen.
function keepFocus(): (() => void) | null {
  const a = document.activeElement, tab = $<HTMLElement>("#tab-map")!;
  if (!(a instanceof Element) || !tab.contains(a)) return null;
  const q = (sel: string): Focusable | null => tab.querySelector<Focusable>(sel);
  const stop = (): Focusable | null => q('#map-svg [data-stack][tabindex="0"]');
  const first = (...picks: Array<() => Focusable | null>): void => { for (const p of picks) { const e = p(); if (e) { e.focus(); return; } } };
  const key = (name: string): string | undefined => a.closest<Focusable>(`[data-${name}]`)?.dataset[name];
  const level = key("level"), crumb = key("crumb"), stack = key("stack");
  if (level != null) return () => first(() => q(`#map-levels [data-level="${level}"]`), () => q("#map-levels [data-level]"));
  if (a.id === "map-svg") return () => first(() => q("#map-svg"));
  const side = a.closest(".map-side") ? a.id : "";
  if (side) return () => first(() => q(`#${CSS.escape(side)}`), () => q(`#map-new-area-${S.level}`), stop);
  if (crumb != null) return () => first(() => q(`#map-crumbs [data-crumb="${crumb}"]`), () => [...tab.querySelectorAll<HTMLElement>("#map-crumbs button")].at(-1) ?? null, stop);
  if (stack != null) return () => first(() => q(`#map-svg [data-stack="${stack}"]`), stop);
  const drawer = $<HTMLElement>("#map-drawer"), inDrawer = drawer ? focusKey(drawer) : null;
  if (inDrawer) return () => { const d = $<HTMLElement>("#map-drawer"); if (d?.querySelector(inDrawer)) refocus(d, inDrawer, false); else first(stop); };
  const panel = $<HTMLElement>("#map-panel"), was = panel ? focusKey(panel) : null;
  return was ? () => { const p = $<HTMLElement>("#map-panel"); if (p?.querySelector(was)) refocus(p, was); else first(stop); } : null;
}

function paintTopbar(): void {
  const sel = $<HTMLSelectElement>("#map-house")!;
  const opts = [...(S.list?.houses ?? []).map((h) => ({ value: h.id, label: houseLabel(h) })), ...(S.plain ? [{ value: PLAIN, label: `Chests outside a drawn house (${chestCount(S.plain)})` }] : [])];
  sel.replaceChildren(...opts.map((o) => el("option", { value: o.value }, o.label)));
  sel.value = S.id ?? "";
  sel.disabled = opts.length < 2;
  $<HTMLElement>("#map-levels")!.replaceChildren(...(S.model?.levels ?? []).map((l) => { const p = pill({ label: l.name, pressed: l.index === S.level, onToggle: () => setLevel(l.index) }); p.dataset.level = String(l.index); return p; }));
  viewSeg.setValue(S.view);
  modeSeg.setValue(S.mode);
}
// The level shown already does nothing (its pill, which unpressed itself on the click, is pressed again).
function setLevel(i: number): void {
  if (i === S.level) { $<HTMLElement>(`#map-levels [data-level="${i}"]`)?.setAttribute("aria-pressed", "true"); return; }
  dropDrawing();   // a name being asked for stays, under its own level
  S.level = i; S.area = null; S.selected = null; S.hover = null; S.vb = null;
  render();
}
function zoomToArea(a: HouseArea): void {
  S.level = a.level; S.area = a.id; S.selected = null; S.hover = null; S.vb = null;
  render();
}

// Left: each level with its chest count and status; its areas (issue #10), each with its colour, chest count, ✎ and ⋯ (a click zooms the map to it); the rest of the level ("Everything else", or "Whole floor" before it has areas); + New area. The plain grid's groups are areas too, but read-only.
function side(): HTMLElement {
  const m = S.model!, areas = areasNow(), own = m.id !== PLAIN;
  return box("aside", { class: "card map-side", "aria-label": "Levels and areas" }, ...m.levels.map((l) => {
    const { rows, rest } = levelAreas(m, areas, l.index);
    const drawingHere = draw?.level === l.index && draw.target == null;
    return box("section", { class: "map-level" },
      box("h2", { class: "map-level-name" }, txt(l.name, "strong"), txt(plural(chestCount(m, l.index), "container"), "t-sm muted")),
      l.status === "floor-only" && own ? el("p", { class: "t-sm muted" }, "Floor only, no walls or stairs yet") : null,
      box("ul", { class: "map-areas", "aria-label": `Areas on the ${l.name.toLowerCase()}` },
        ...rows.map((r) => areaRow(m, r.area, r.chests, own)),
        naming?.level === l.index ? namingRow(m, naming) : null,
        box("li", { class: "map-area-row rest" }, box("span", { class: "map-area-rest" }, el("span", { class: "map-swatch rest", "aria-hidden": "true" }), txt(rest.name, "ellip"), txt(String(rest.chests), "t-sm muted num")))),
      own ? button({ label: drawingHere ? "Drawing…" : "New area", icon: drawingHere ? undefined : "plus", size: "sm", variant: drawingHere ? "primary" : "secondary", cls: "map-new-area",
        disabled: !drawingHere && (!!draw || !!naming || areas.length >= MAX_AREAS),
        attrs: { id: `map-new-area-${l.index}`, ...(drawingHere ? { "aria-pressed": "true" } : {}), ...(areas.length >= MAX_AREAS ? { title: `A house can have at most ${MAX_AREAS} areas.` } : {}) },
        onClick: () => { if (drawingHere) finishDrawing(); else startDrawing(l.index, null); } }) : null);
  }));
}
// An area's row: its zoom button (colour, name, chest count), ✎ (Rename) and ⋯ (Redraw, Change colour, Delete); while renaming, the name field in its place; while asking to delete, the question with Delete and Cancel.
function areaRow(m: HouseModel, a: HouseArea, chests: number, editable: boolean): HTMLElement {
  const swatch = el("span", { class: "map-swatch", "aria-hidden": "true", style: `background:var(--color-${a.color})` });
  if (renamingArea?.id === a.id) return box("li", { class: "map-area-row editing" }, swatch, areaRenameField(m, a, renamingArea));
  const zoom = box("button", { type: "button", class: "map-area", id: `map-area-${a.id}`, "data-area": a.id, "aria-pressed": String(S.area === a.id), onclick: () => zoomToArea(a) },
    swatch, txt(a.name, "ellip"), txt(String(chests), "t-sm muted num"));
  zoom.setAttribute("aria-label", `${a.name}, ${plural(chests, "container")}`);
  if (!editable) return box("li", { class: "map-area-row" }, zoom);
  const more: HTMLButtonElement = button({ label: `More actions for ${a.name}`, icon: "more", iconOnly: true, variant: "ghost", size: "sm", attrs: { id: `map-area-menu-${a.id}`, "aria-haspopup": "menu", "aria-expanded": "false" },
    onClick: () => { menu(more, [
      { label: "Redraw", onSelect: () => startDrawing(a.level, a.id) },
      { label: "Change colour", onSelect: () => colourPicker(m, a, more) },
      "divider",
      { label: "Delete", danger: true, onSelect: () => { void askDelete(m, a); } },
    ], { label: `Actions for ${a.name}`, width: 160 }); } });
  const row = box("li", { class: "map-area-row" }, zoom,
    button({ label: `Rename ${a.name}`, icon: "pencil", iconOnly: true, variant: "ghost", size: "sm", attrs: { id: `map-area-edit-${a.id}` },
      onClick: () => { renamingArea = { id: a.id, draft: a.name, error: null }; render(); const f = $<HTMLInputElement>("#map-area-rename"); f?.focus(); f?.select(); } }),
    more);
  // The row under the pointer or holding focus lights its area on the map.
  // It stays lit while focus is anywhere in it (its ✎ or ⋯ too), looked at once the focus has moved.
  const cool = (): void => { if (hotArea === a.id && !row.matches(":focus-within") && !row.matches(":hover")) setHot(null); };
  row.addEventListener("pointerenter", () => setHot(a.id));
  row.addEventListener("pointerleave", () => { if (!row.matches(":focus-within")) setHot(null); });
  row.addEventListener("focusin", () => setHot(a.id));
  row.addEventListener("focusout", () => { setTimeout(cool, 0); });
  return row;
}
// Change colour: the palette as a row of swatches, the area's own pressed.
function colourPicker(m: HouseModel, a: HouseArea, anchor: HTMLElement): void {
  popover(anchor, [box("div", { class: "map-colours", role: "group", "aria-label": `Colour of ${a.name}` }, ...AREA_COLORS.map((c, i) =>
    box("button", { type: "button", class: "map-colour", id: `map-colour-${c}`, "aria-label": AREA_COLOR_NAMES[c] ?? `Colour ${i + 1}`, title: AREA_COLOR_NAMES[c] ?? "", "aria-pressed": String(a.color === c), style: `--area:var(--color-${c})`,
      onclick: () => { closePopover(); if (c !== a.color) void editAreas(m, (l) => l.map((x) => (x.id === a.id ? { ...x, color: c } : x))).then((why) => afterSave(why, `map-area-menu-${a.id}`)); } })))], { label: `Colour of ${a.name}` });
}
// Rename, as the house's name: Enter or leaving the field saves, Esc cancels, a refused name keeps the field open with the reason; a redraw rebuilds it from the draft.
function areaRenameField(m: HouseModel, a: HouseArea, r: { draft: string; error: string | null }): HTMLElement {
  const f = input({ size: "sm", value: r.draft, invalid: !!r.error, attrs: { id: "map-area-rename", maxlength: "60", "aria-label": `Name of ${a.name}`, ...(r.error ? { "aria-describedby": "map-area-rename-error" } : {}) } });
  let busy = false, closed = false;
  const back = (): void => { $<HTMLElement>(`#map-area-edit-${CSS.escape(a.id)}`)?.focus(); };
  const close = (): void => { closed = true; renamingArea = null; render(); back(); };
  const save = async (): Promise<void> => {
    if (busy || closed) return;
    const name = f.value.trim();
    if (!name || name === a.name) { close(); return; }
    busy = true;
    const why = await editAreas(m, (l) => l.map((x) => (x.id === a.id ? { ...x, name } : x)));
    busy = false;
    if (!why) { if (!closed) close(); }
    else if (!closed && renamingArea) { renamingArea.error = why; render(); $<HTMLInputElement>("#map-area-rename")?.focus(); }
  };
  f.addEventListener("input", () => { if (renamingArea) renamingArea.draft = f.value; });
  f.addEventListener("focus", () => { f.setSelectionRange(f.value.length, f.value.length); });
  f.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); void save(); }
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); if (!closed) close(); }
  });
  f.addEventListener("blur", () => { if (document.hasFocus()) setTimeout(() => { if (f.isConnected && !closed) void save(); }, 0); });
  return box("div", { class: "map-name-edit" }, f, r.error ? message({ tone: "bad", text: r.error, attrs: { id: "map-area-rename-error" } }) : null);
}
// A new area just drawn: "Name this area", its colour and the field, its size and chest count, Cancel and Save (Save waits for a name). Enter saves, Esc cancels.
function namingRow(m: HouseModel, n: NonNullable<typeof naming>): HTMLElement {
  const areas = areasNow(), probe: HouseArea = { id: "new", name: "", level: n.level, color: n.color, rects: n.rects };
  const chests = levelAreas(m, [...areas, probe], n.level).rows.find((r) => r.area === probe)?.chests ?? 0;
  const f = input({ size: "sm", value: n.draft, placeholder: "e.g. Potions", invalid: !!n.error, attrs: { id: "map-area-new-name", maxlength: "60", "aria-labelledby": "map-area-new-label", ...(n.error ? { "aria-describedby": "map-area-new-error" } : {}) } });
  const save = button({ label: "Save", variant: "primary", size: "sm", disabled: !n.draft.trim(), attrs: { id: "map-area-new-save" }, onClick: () => { void saveNew(m); } });
  f.addEventListener("input", () => { if (naming) naming.draft = f.value; save.disabled = !f.value.trim(); });
  f.addEventListener("focus", () => { f.setSelectionRange(f.value.length, f.value.length); });
  f.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); void saveNew(m); }
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); cancelNaming(); }
  });
  return box("li", { class: "map-area-row naming" }, box("div", { class: "map-area-new" },
    el("label", { class: "t-sm muted", id: "map-area-new-label", for: "map-area-new-name" }, "Name this area"),
    box("div", { class: "map-area-new-field" }, el("span", { class: "map-swatch", "aria-hidden": "true", style: `background:var(--color-${n.color})` }), f),
    txt(`${plural(unionTiles(n.rects).length, "tile")} · ${plural(chests, "chest")}`, "t-sm muted"),
    n.error ? message({ tone: "bad", text: n.error, attrs: { id: "map-area-new-error" } }) : null,
    box("div", { class: "map-area-new-actions" }, button({ label: "Cancel", size: "sm", attrs: { id: "map-area-new-cancel" }, onClick: cancelNaming }), save)));
}
function cancelNaming(): void {
  const level = naming?.level ?? S.level;
  naming = null;
  render();
  $<HTMLElement>(`#map-new-area-${level}`)?.focus();
}
async function saveNew(m: HouseModel): Promise<void> {
  const n = naming;
  if (!n || !n.draft.trim()) return;
  let id = "";
  const why = await editAreas(m, (l) => { id = nextAreaId(l); return [...l, { id, name: n.draft.trim(), level: n.level, color: n.color, rects: n.rects }]; });
  if (naming !== n) return;
  if (why) { n.error = why; render(); $<HTMLInputElement>("#map-area-new-name")?.focus(); return; }
  naming = null;
  S.area = id;
  render();
  $<HTMLElement>(`#map-area-${CSS.escape(id)}`)?.focus();
}
// Delete asks with the page's yes/no dialog. Cancel puts focus back on the row's ⋯; a delete puts it on the next area's ⋯ on that level, else on the one before, else on + New area.
async function askDelete(m: HouseModel, a: HouseArea): Promise<void> {
  const menuOf = (id: string): HTMLElement | null => $<HTMLElement>(`#map-area-menu-${CSS.escape(id)}`);
  if (!await confirmDialog({ title: `Delete ${a.name}?`, body: `Its chests go to ${levelAreas(m, areasNow().filter((x) => x.id !== a.id), a.level).rest.name}. The chests themselves stay where they are.`, confirmLabel: "Delete area" })) { menuOf(a.id)?.focus(); return; }
  const mates = areasNow().filter((x) => x.level === a.level), at = mates.findIndex((x) => x.id === a.id), next = mates[at + 1] ?? mates[at - 1] ?? null;
  const why = await editAreas(m, (l) => l.filter((x) => x.id !== a.id));
  if (why) { toast(why, "bad"); render(); menuOf(a.id)?.focus(); return; }
  if (S.area === a.id) { S.area = null; S.vb = null; }
  render();
  (next && menuOf(next.id) || $<HTMLElement>(`#map-new-area-${a.level}`))?.focus();
}
// Change the house's areas: `edit` is applied, when the save's turn comes (saveEntry), to the list as last saved, so a rename still being saved is never undone by a colour change or a delete made meanwhile; the hidden orphan-level areas are written back after it (withOrphans). Returns the server's reason when it refuses.
const editAreas = (m: HouseModel, edit: (saved: HouseArea[]) => HouseArea[]): Promise<string | null> => saveEntry(m, () => ({ areas: withOrphans(edit(savedAreas(m)), S.names[m.id]?.areas, m.levels.length) }));
// After a save from a menu (no field to show a refusal under): a toast says why, the page redraws, focus goes to the control with id `focusId`.
function afterSave(why: string | null, focusId: string): void {
  if (why) toast(why, "bad");
  render();
  $<HTMLElement>(`#${CSS.escape(focusId)}`)?.focus();
}
// Drawing mode: "+ New area" (a new area on that level) or Redraw (an area's rectangles anew). The map takes the keyboard: its cursor starts at the level's middle.
function startDrawing(level: number, target: string | null): void {
  const m = S.model;
  if (!m) return;
  const a = areaById(target), mid: Tile = [Math.floor((m.x0 + m.x1) / 2), Math.floor((m.y0 + m.y1) / 2)];
  naming = null; renamingArea = null;
  draw = { level, target, color: a?.color ?? nextAreaColor(areasNow()), rects: [], cur: null, anchor: null, add: false, cursor: mid, keyed: false };
  if (S.level !== level) { S.level = level; S.area = null; S.selected = null; S.vb = null; }
  S.hover = null;
  render();
  announce(target ? `Redrawing ${a?.name ?? "the area"}. Drag over tiles, or press Space, move with the arrow keys and press Space again. Enter to finish, Escape to cancel.` : "Drawing a new area. Drag over tiles, or press Space, move with the arrow keys and press Space again. Shift adds more. Enter to finish, Escape to cancel.");
  $<SVGSVGElement>("#map-svg")?.focus();
}
function cancelDrawing(): void {
  const d = draw;
  if (!d) return;
  draw = null; dragging = false;
  render();
  announce("Drawing cancelled.");
  (d.target ? $<HTMLElement>(`#map-area-menu-${CSS.escape(d.target)}`) : $<HTMLElement>(`#map-new-area-${d.level}`))?.focus();
}
// Enter: a rectangle the keyboard is laying is ended first; a redraw saves at once, a new area asks for its name.
function finishDrawing(): void {
  const d = draw, m = S.model;
  if (!d || !m) return;
  if (d.cur) endRect();
  if (!d.rects.length) { announce("Nothing drawn yet. Drag over tiles, or press Space to start a rectangle. Escape cancels."); return; }
  draw = null; dragging = false;
  if (d.target) { void saveRedraw(m, d, d.target); return; }
  naming = { level: d.level, color: d.color, rects: d.rects, draft: "", error: null };
  render();
  $<HTMLInputElement>("#map-area-new-name")?.focus();
}
// A redraw shows its new shape at once; if the save is refused the area goes back to its saved shape and drawing mode comes back with the new one, for Enter to try again. An area deleted meanwhile is not saved again: the drawing is dropped, and the toast says so.
async function saveRedraw(m: HouseModel, d: Draw, id: string): Promise<void> {
  const mine = { id, rects: d.rects };
  redrawn = mine;
  render();
  $<HTMLElement>(`#map-area-${CSS.escape(id)}`)?.focus();
  let gone = false;
  const why = await editAreas(m, (l) => { gone = !l.some((x) => x.id === id); if (gone) throw new Error("That area was deleted meanwhile, so the new shape was dropped."); return l.map((x) => (x.id === id ? { ...x, rects: mine.rects } : x)); });
  if (redrawn === mine) redrawn = null;
  if (!why) { render(); return; }
  if (gone) { toast(why, "bad"); render(); return; }
  if (S.model === m && !draw && !naming && areaById(id)) {
    renamingArea = null;
    draw = { ...d, cur: null, anchor: null };
    S.level = d.level;
    toast(redrawFailed(why, true), "bad");
    render();
    $<SVGSVGElement>("#map-svg")?.focus();
  } else { toast(redrawFailed(why, false), "bad"); render(); }
}
// A rectangle ends: it replaces the others, or (Shift) joins them, up to MAX_RECTS.
function endRect(): void {
  const d = draw;
  if (!d?.cur) return;
  if (d.add && d.rects.length >= MAX_RECTS) announce(`An area has at most ${MAX_RECTS} rectangles.`);
  else d.rects = d.add ? [...d.rects, d.cur] : [d.cur];
  d.cur = null; d.anchor = null;
  const n = unionTiles(d.rects).length;
  announce(`${plural(d.rects.length, "rectangle")}, ${plural(n, "tile")}. Enter to finish.`);
  paintDraft();
}
// The map's keys while drawing: an arrow moves the cursor (and the rectangle being laid), Space starts or ends a rectangle (Shift+Space starts one that joins the others), Enter finishes, Esc cancels.
function drawKeys(e: KeyboardEvent): boolean {
  const d = draw, m = S.model;
  if (!d || !m || e.metaKey || e.ctrlKey || e.altKey) return false;
  if (e.key === "Escape") { cancelDrawing(); return true; }
  if (e.key === "Enter") { finishDrawing(); return true; }
  if (e.key === " ") {
    if (d.anchor) endRect();
    else { d.keyed = true; d.anchor = d.cursor; d.add = e.shiftKey; d.cur = rectOf(d.cursor, d.cursor); announce(`Started at the cursor: ${sizeText(d.cur)}. Move with the arrow keys, Space to end.`); paintDraft(); }
    return true;
  }
  const next = moveCursor(m, d.cursor, e.key, S.view);
  if (!next) return false;
  d.keyed = true; d.cursor = next;
  if (d.anchor) { d.cur = rectOf(d.anchor, next); announce(sizeText(d.cur)); }
  paintDraft();
  keepInView(next);
  return true;
}
// The cursor's tile brought back to the middle when the keyboard moves it out of view.
function keepInView([x, y]: Tile): void {
  const m = S.model;
  if (!m || !S.vb) return;
  const at = project(x - m.x0 + 0.5, y - m.y0 + 0.5, 0, S.view);
  if (!inBox(S.vb, at)) setViewBox({ ...S.vb, x: at[0] - S.vb.w / 2, y: at[1] - S.vb.h / 2 });
}

// The middle pane: notes above the map, the breadcrumb, then the SVG with its zoom buttons and the callout over it. While drawing an area: the hint bar over the map, the size pill, and the map takes the keyboard (a tab stop of its own, its live region saying what the keys did).
function stage(): HTMLElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.id = "map-svg";
  svg.setAttribute("class", `map-svg${draw ? " drawing" : ""}`);
  svg.setAttribute("role", draw ? "application" : "group");
  svg.setAttribute("aria-label", draw ? "House map, drawing an area" : "House map");
  if (draw) { svg.setAttribute("tabindex", "0"); svg.setAttribute("aria-describedby", "map-draw-hint"); }
  wireSvg(svg);
  // A pane that changes size moves the map under the pills: place them again.
  const sized = new ResizeObserver(() => { if (svg.isConnected) paintPills(); else sized.disconnect(); });
  sized.observe(svg);
  return box("section", { class: "card map-stage", id: "map-stage", "aria-label": "Map" },
    ...notes(),
    box("nav", { class: "map-crumbs", id: "map-crumbs", "aria-label": "Breadcrumb" }),
    box("div", { class: "map-canvas", id: "map-canvas" }, svg, box("div", { class: "map-pills", id: "map-pills", "aria-hidden": "true" }),
      draw ? box("div", { class: "map-draw-hint", id: "map-draw-hint" }, el("span", { class: "map-draw-dot", "aria-hidden": "true" }),
        el("span", { class: "map-draw-text" }, el("strong", {}, "Drag over tiles to draw the area."), " Shift-drag adds more. ", kbd("Enter"), " to finish, ", kbd("Esc"), " to cancel. Fit shows all.",
          el("span", { class: "sr" }, " Keyboard: the arrow keys move a tile cursor, Space starts and ends a rectangle, Shift+Space starts one more, Enter finishes, Escape cancels."))) : null,
      draw ? box("div", { class: "map-draw-size", id: "map-draw-size", hidden: "" }) : null,
      box("div", { class: "map-zoom", role: "group", "aria-label": "Zoom" },
        button({ label: "Zoom in", icon: "zoom-in", iconOnly: true, size: "sm", attrs: { id: "map-zoom-in" }, onClick: () => zoomBy(1 / 1.25) }),
        button({ label: "Zoom out", icon: "zoom-out", iconOnly: true, size: "sm", attrs: { id: "map-zoom-out" }, onClick: () => zoomBy(1.25) }),
        button({ label: "Fit the level", icon: "fit", iconOnly: true, size: "sm", attrs: { id: "map-fit" }, onClick: fitTo }),
        button({ label: "Hide area labels", icon: "label", iconOnly: true, size: "sm", attrs: { id: "map-labels", "aria-pressed": String(labelsHidden), title: "Hide area labels" }, onClick: toggleLabels })),
      box("div", { class: "map-callout", id: "map-callout", hidden: "" })));
}
// Above the map: why it is drawn in plain colours (no tiledata.mul), or, on the plain grid, how to get the house drawn.
function notes(): HTMLElement[] {
  if (S.id === PLAIN) return [message({ tone: "info", text: "These chests are not inside a house a scan has drawn. Scan from inside the house with the 2.11.0 scripts to draw it.", attrs: { id: "map-plain-note" } })];
  const note = !S.list || S.list.tiledata ? null : tiledataNote(S.list.tiledataFrom.reason);
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
// A box as its two shaded sides (the stylesheet darkens them) and its top (a plinth has none).
function prismEl(cls: string, p: Prism): SVGElement {
  const g = sv("g", { class: cls });
  if (p.left) g.append(sv("polygon", { class: "side-l", points: p.left }));
  if (p.right) g.append(sv("polygon", { class: "side-r", points: p.right }));
  if (p.top) g.append(sv("polygon", { class: "top", points: p.top }));
  return g;
}
function viewsOf(m: HouseModel): Map<number, ChestView> {
  const inv = state.inv!, labs = labels();
  return new Map(m.stacks.filter((s) => s.level === S.level).flatMap((s) => chestViews(m, s, inv, labs)).map((v) => [v.serial, v]));
}
function pieceEl(p: Piece, views: Map<number, ChestView>): SVGElement {
  switch (p.kind) {
    case "solid": { const g = prismEl(p.cls, p.prism); for (const b of p.steps ?? []) g.append(sv("polygon", { class: "map-step", points: b })); return g; }
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
  // The areas over the floors and under the walls and stacks (their names are pills over the map: paintPills). Each takes the pointer only to light up and show its name as a tooltip; a stack above it still takes the click.
  const areas = sv("g", { class: "map-area-layer" });
  for (const a of areasNow()) {
    if (a.level !== S.level || draw?.target === a.id) continue;
    const g = areaEl(m, a, a.id === S.area);
    g.dataset.areaShape = a.id;
    g.classList.toggle("hot", a.id === hotArea);
    if (!draw) { const title = sv("title", {}); title.textContent = a.name; g.prepend(title); }   // no tooltip in the way while drawing
    areas.append(g);
  }
  pillBase = pillsOf(m, areasNow().filter((a) => draw?.target !== a.id), S.level, S.view);
  pillTexts = null;
  svg.replaceChildren(ground, areas, sv("g", { id: "map-draft", class: "map-draft" }), solids, sv("g", { id: "map-draft-top", class: "map-draft" }));
  drawCrumbs();
  if (!S.vb) S.vb = fit(boundsOf(m, S.level, S.view, areaById(S.area)), viewport());
  svg.setAttribute("viewBox", vbText(S.vb));
  paintStacks();
  paintDraft();
  paintPills(true);
}
// The area name pills, an HTML layer over the map at a fixed screen size: one per piece of each area on the level, just above the middle of its front corner tile, placed from the SVG's screen matrix (so again after every pan, zoom, resize and redraw). A name is cut short with "…" to fit LABEL_FIT of its piece's width on screen, or a dot when under 3 characters fit; the area under the pointer, focused or zoomed to shows its whole name, on top. None while drawing a new shape for that area or with the labels hidden. They never take the pointer: the area's tint carries the name as a tooltip too.
// The pills of the level shown (pillsOf, worked out once per drawMap), and their fitted texts at one zoom (a pan moves the pills and keeps them; a zoom, a font arriving or a theme change fits them again).
const PILL_PX = 12;
let pillBase: AreaPill[] = [];
let pillTexts: { scale: number; texts: Array<string | null> } | null = null;
let measureCtx: CanvasRenderingContext2D | null = null;
function fittedTexts(scale: number): Array<string | null> {
  if (pillTexts?.scale === scale) return pillTexts.texts;
  measureCtx ??= document.createElement("canvas").getContext("2d");
  const ctx = measureCtx, font = `500 ${PILL_PX}px ${getComputedStyle(document.body).fontFamily}`;   // read once per fit
  if (ctx) ctx.font = font;
  const measure = (t: string): number => (ctx ? ctx.measureText(t).width : t.length * PILL_PX * 0.6);
  pillTexts = { scale, texts: pillBase.map((p) => fitLabel(p.name, Math.max(24, p.span * scale * LABEL_FIT), measure)) };
  return pillTexts.texts;
}
let pillsBuilt: string | null = null;   // what the pills on screen were built for: the zoom, the area lit and the one zoomed to
// `rebuild` (a redraw, the area lit changing) builds the pills again; otherwise they are only built again when the zoom changed, and moved.
function paintPills(rebuild = false): void {
  const layer = $<HTMLElement>("#map-pills"), svg = $<SVGSVGElement>("#map-svg"), m = S.model, ctm = svg?.getScreenCTM();
  if (!layer || !svg || !m) return;
  if (labelsHidden || !ctm) { layer.replaceChildren(); pillsBuilt = null; return; }
  const key = `${ctm.a.toFixed(5)}|${hotArea}|${S.area}`;
  if (rebuild || key !== pillsBuilt || layer.childElementCount !== pillBase.length) {
    const texts = fittedTexts(ctm.a);
    layer.replaceChildren(...pillBase.map((p, i) => {
      const hot = p.id === hotArea || p.id === S.area, text = hot ? p.name : texts[i] ?? null;
      return el("div", { class: `map-pill${text == null ? " dot" : ""}${hot ? " hot" : ""}`, title: p.name, "data-area": p.id, style: `--area:var(--color-${p.color})` }, text ?? "");
    }));
    pillsBuilt = key;
  }
  // Placed after they are in the page, so their own width keeps them inside the pane and clear of the zoom buttons.
  const r = layer.getBoundingClientRect(), z = $<HTMLElement>("#map-canvas .map-zoom")?.getBoundingClientRect();
  const avoid = z ? { x0: z.left - r.left, y0: z.top - r.top, x1: z.right - r.left, y1: z.bottom - r.top } : null;
  [...layer.children].forEach((node, i) => {
    const e = node as HTMLElement, p = pillBase[i]!, at = new DOMPoint(p.anchor[0], p.anchor[1]).matrixTransform(ctm);
    e.hidden = false;   // measured shown
    const box = pillBox({ x: at.x - r.left, y: at.y - r.top }, { w: e.offsetWidth, h: e.offsetHeight }, { w: r.width, h: r.height }, PILL_PX * 0.6, e.classList.contains("dot"), avoid);
    e.hidden = box.hidden;
    e.style.left = `${box.left}px`;
    e.style.top = `${box.top}px`;
  });
}
// A font arriving after the first paint, or another theme, changes the text widths: fit the pills again.
const refit = (): void => { pillTexts = null; if (S.model && !$<HTMLElement>("#tab-map")!.hidden) paintPills(true); };
void document.fonts?.ready.then(refit);
document.addEventListener("themechange", refit);
// An area as a tint over its covered floor tiles and a thin line along the union's outer edges, in its colour.
function areaEl(m: HouseModel, a: Pick<HouseArea, "level" | "rects" | "color">, sel: boolean, cls = "map-area-shape"): SVGElement {
  const base = m.levels[a.level]?.floorZ ?? 0, g = sv("g", { class: `${cls}${sel ? " sel" : ""}`, style: `--area:var(--color-${a.color})` });
  for (const c of coveredCells(m, a.level, a.rects)) g.append(sv("polygon", { class: "map-area-tile", points: pts(tilePolygon(c.x - m.x0, c.y - m.y0, c.z - base, S.view)) }));
  const d = outlineOf(a.rects).map(([p, q]) => { const s0 = project(p[0] - m.x0, p[1] - m.y0, 0, S.view), s1 = project(q[0] - m.x0, q[1] - m.y0, 0, S.view); return `M${s0[0].toFixed(1)} ${s0[1].toFixed(1)}L${s1[0].toFixed(1)} ${s1[1].toFixed(1)}`; }).join("");
  if (d) g.append(sv("path", { class: "map-area-edge", d }));
  return g;
}
// The area being drawn (or waiting for its name): its rectangles and the one being dragged tinted over the floor, their outline and the keyboard's cursor over the stacks (a dense room hides its floor), and the size pill.
function paintDraft(): void {
  const layer = $<SVGGElement>("#map-draft"), top = $<SVGGElement>("#map-draft-top"), m = S.model;
  if (!layer || !top || !m) return;
  const d = draw, rects = d ? [...d.rects, ...(d.cur ? [d.cur] : [])] : naming?.level === S.level ? naming.rects : [];
  const color = d?.color ?? naming?.color ?? "area-1", shape = rects.length ? areaEl(m, { level: S.level, rects, color }, false, "map-area-shape draft") : null;
  const edge = shape?.querySelector(".map-area-edge");
  layer.replaceChildren(...(shape ? [shape] : []));
  top.replaceChildren(...(edge && shape ? [sv("g", { class: "map-area-shape draft", style: shape.getAttribute("style") ?? "" }, edge as SVGElement)] : []));
  if (d?.keyed) top.append(sv("polygon", { class: "map-draw-cursor", points: pts(tilePolygon(d.cursor[0] - m.x0, d.cursor[1] - m.y0, 0, S.view)) }));
  const pill = $<HTMLElement>("#map-draw-size"), shown = d?.cur ?? d?.rects.at(-1) ?? null;
  if (!pill) return;
  if (!shown) { pill.hidden = true; return; }
  pill.textContent = sizeText(shown);
  pill.hidden = false;
  placePill(pill, project(shown.x1 + 1 - m.x0, shown.y1 + 1 - m.y0, 0, S.view));
}
// Under the rectangle's south corner, kept 8 px inside the map pane.
function placePill(out: HTMLElement, at: Pt): void {
  const svg = $<SVGSVGElement>("#map-svg"), canvas = $<HTMLElement>("#map-canvas"), ctm = svg?.getScreenCTM();
  if (!svg || !canvas || !ctm) return;
  const p = new DOMPoint(at[0], at[1]).matrixTransform(ctm), r = canvas.getBoundingClientRect(), w = out.offsetWidth, h = out.offsetHeight;
  out.style.left = `${Math.max(8, Math.min(p.x - r.left - w / 2, r.width - w - 8))}px`;
  out.style.top = `${Math.max(8, Math.min(p.y - r.top + 8, r.height - h - 8))}px`;
}
// The selection, the cut-away in front of the hovered (or focused) stack, else the selected one (Game angle only: top-down nothing hides anything), and the roving tab stop (the focused stack, else the selected one, else the first in code order in the area zoomed to, else the first in view, else the first).
function paintStacks(): void {
  const m = S.model;
  if (!m) return;
  const sel = selectedStack(), here = m.stacks.filter((s) => s.level === S.level);
  const focus = here.find((s) => s.letter === S.hover) ?? (sel?.level === S.level ? sel : null);
  const cut = focus && S.view === "angle" ? cutAway(m, S.level, focus) : new Set<string>();
  const roving = here.find((s) => s.letter === S.focus)?.letter ?? (sel?.level === S.level ? sel.letter
    : (here.find((s) => S.area != null && areaOfStack(areasNow(), s)?.id === S.area) ?? here.find((s) => S.vb && inBox(S.vb, anchorOf(m, s, S.view))) ?? here[0])?.letter);
  for (const e of document.querySelectorAll<SVGGElement>("#map-svg .map-stack")) {
    const letter = e.dataset.stack;
    if (draw) { e.setAttribute("tabindex", "-1"); continue; }   // the map itself is the tab stop while drawing
    e.classList.toggle("sel", letter === sel?.letter);
    e.classList.toggle("cut", !!letter && cut.has(letter));
    e.setAttribute("aria-pressed", String(letter === sel?.letter));
    e.setAttribute("tabindex", letter === roving ? "0" : "-1");
  }
}
// house › level › area › stack; each part above the last goes back up to it. A selected stack outside every area shows where it is ("Everything else", or the "Whole floor") as plain text.
function drawCrumbs(): void {
  const nav = $<HTMLElement>("#map-crumbs"), m = S.model;
  if (!nav || !m) return;
  const sel = selectedStack(), level = m.levels[S.level], areas = areasNow(), area = sel ? areaOfStack(areas, sel) : areaById(S.area);
  const crumb = (key: string, label: string, go: (() => void) | null): HTMLElement => box("li", {}, go ? button({ label, variant: "ghost", size: "sm", attrs: { "data-crumb": key }, onClick: go }) : txt(label, "strong"));
  const up = (level: number): void => { dropDrawing(); S.level = level; S.area = null; S.selected = null; S.hover = null; S.vb = null; render(); };
  nav.replaceChildren(box("ol", { class: "map-crumb-list" },
    crumb("house", houseName(m), sel || S.area != null || S.level !== 0 ? () => up(0) : null),
    level ? crumb("level", level.name, sel || S.area != null ? () => up(S.level) : null) : null,
    area ? crumb("area", area.name, sel ? () => zoomToArea(area) : null) : sel ? box("li", {}, txt(levelAreas(m, areas, sel.level).rest.name, "muted")) : null,
    sel ? crumb("stack", `Stack ${sel.letter}`, null) : null));
}

// ---------------------------------------------------------------- interaction
// A press that moves more than 3 px pans the viewBox; one that does not is a click (a stack selects it, anywhere else clears). The wheel zooms about the pointer. Neither touches the drawing. A drag ends however the pointer leaves it: released off the map, cancelled, or its capture lost (an OS gesture, a switch of window). While drawing an area a press draws a rectangle instead (Shift: one more), and neither panning nor the wheel moves the map during it (the zoom buttons still do); the middle button pans then, and its click does nothing.
function wireSvg(svg: SVGSVGElement): void {
  let drag: { x: number; y: number; vb: Box; id: number; moved: boolean; button: number } | null = null;
  const endDrag = (): void => { drag = null; svg.classList.remove("dragging"); };
  const tileOf = (e: PointerEvent): Tile => clampTile(S.model!, tileAt(S.model!, svgPoint(svg, e.clientX, e.clientY), S.view));
  const endRectDrag = (e: PointerEvent): void => {
    if (!dragging) return;
    dragging = false;
    if (svg.hasPointerCapture(e.pointerId)) svg.releasePointerCapture(e.pointerId);
    endRect();
  };
  svg.addEventListener("pointerdown", (e) => {
    if (draw && S.model && e.button === 1 && S.vb && !dragging) { e.preventDefault(); drag = { x: e.clientX, y: e.clientY, vb: S.vb, id: e.pointerId, moved: false, button: 4 }; return; }
    if (draw && S.model) {
      if (e.button !== 0) return;
      e.preventDefault();
      svg.focus();
      const t = tileOf(e);
      draw.anchor = t; draw.add = e.shiftKey; draw.cur = rectOf(t, t); dragging = true;
      svg.setPointerCapture(e.pointerId);
      paintDraft();
      return;
    }
    if (e.button === 0 && S.vb) drag = { x: e.clientX, y: e.clientY, vb: S.vb, id: e.pointerId, moved: false, button: 1 };
  });
  svg.addEventListener("pointermove", (e) => {
    if (draw && !drag) {
      if (!dragging || !draw.anchor || !S.model) return;
      if (!(e.buttons & 1)) { endRectDrag(e); return; }
      const next = rectOf(draw.anchor, tileOf(e)), cur = draw.cur;
      if (cur && cur.x0 === next.x0 && cur.y0 === next.y0 && cur.x1 === next.x1 && cur.y1 === next.y1) return;
      draw.cur = next;
      paintDraft();
      return;
    }
    if (drag && !(e.buttons & drag.button)) endDrag();
    if (!drag) { hoverAt(e); return; }
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) > 3) { drag.moved = true; svg.setPointerCapture(drag.id); svg.classList.add("dragging"); hideCallout(); }
    if (drag.moved) { const k = drag.vb.w / (svg.clientWidth || 1); setViewBox({ ...drag.vb, x: drag.vb.x - dx * k, y: drag.vb.y - dy * k }); }
  });
  svg.addEventListener("pointerup", (e) => {
    if (draw && !drag) { endRectDrag(e); return; }
    const d = drag;
    endDrag();
    if (!d) return;
    if (d.moved) { if (svg.hasPointerCapture(e.pointerId)) svg.releasePointerCapture(e.pointerId); paintDraft(); return; }
    if (draw) return;
    const hit = (e.target as Element).closest?.("[data-stack]") as SVGElement | null;
    pick(hit?.dataset.stack ?? null);
  });
  svg.addEventListener("pointercancel", (e) => { endDrag(); endRectDrag(e); });
  svg.addEventListener("lostpointercapture", (e) => { endDrag(); endRectDrag(e); });
  svg.addEventListener("pointerleave", () => { if (!drag && !draw) { S.hover = null; paintStacks(); hideCallout(); setHot(null); } });
  svg.addEventListener("auxclick", (e) => { if (draw) e.preventDefault(); });   // no middle-click paste or autoscroll while drawing
  svg.addEventListener("wheel", (e) => { e.preventDefault(); if (e.deltaY === 0 || dragging) return; zoomBy(e.deltaY > 0 ? 1.15 : 1 / 1.15, svgPoint(svg, e.clientX, e.clientY)); }, { passive: false });
  svg.addEventListener("keydown", (e) => { if (draw) { if (drawKeys(e)) { e.preventDefault(); e.stopPropagation(); } return; } stackKeys(e); });
  // A stack the keyboard reaches outside the view is brought to its middle, at the same zoom (a press focuses too, and must not move the stack from under the pointer).
  svg.addEventListener("focusin", (e) => {
    const t = (e.target as Element).closest?.("[data-stack]") as SVGElement | null, m = S.model, s = m?.stacks.find((x) => x.letter === t?.dataset.stack);
    if (!m || !s || draw) return;
    S.focus = S.hover = s.letter;
    paintStacks();
    const at = anchorOf(m, s, S.view);
    if (!drag && S.vb && !inBox(S.vb, at)) setViewBox({ ...S.vb, x: at[0] - S.vb.w / 2, y: at[1] - S.vb.h / 2 });
    showCallout(s.letter);
  });
  svg.addEventListener("focusout", () => { S.hover = null; paintStacks(); hideCallout(); });
}
function hoverAt(e: PointerEvent): void {
  if (draw) return;
  // An area lights up under the pointer, also through a stack standing in it.
  const shape = ((e.target as Element).closest?.("[data-area-shape]") as SVGElement | null)?.dataset.areaShape;
  const over = shape ? null : S.model?.stacks.find((x) => x.letter === ((e.target as Element).closest?.("[data-stack]") as SVGElement | null)?.dataset.stack);
  setHot(shape ?? (over ? areaOfStack(areasNow(), over)?.id ?? null : null));
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
const inBox = (b: Box, p: Pt): boolean => p[0] >= b.x && p[0] <= b.x + b.w && p[1] >= b.y && p[1] <= b.y + b.h;
function setViewBox(b: Box): void {
  S.vb = b;
  $<SVGSVGElement>("#map-svg")?.setAttribute("viewBox", vbText(b));
  hideCallout();
  paintPills();
}
function zoomBy(f: number, at?: Pt): void { if (S.vb) { setViewBox(zoomAt(S.vb, f, at?.[0], at?.[1])); paintDraft(); } }
function fitTo(): void {
  if (!S.model) return;
  if (S.area != null) { S.area = null; drawMap(); for (const b of document.querySelectorAll(".map-area[aria-pressed]")) b.setAttribute("aria-pressed", "false"); }
  setViewBox(fit(boundsOf(S.model, S.level, S.view), viewport()));
  paintDraft();
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
  if (followSelection()) void loadDrawer();
  paintStacks();
  drawCrumbs();
  drawPanel();
  placeDrawer();
}
// Back to the house, or Esc: the selection clears, and focus in the panel (whose controls go with it) returns to the stack that was selected.
function unselect(): void {
  const s = selectedStack(), inPanel = !!$<HTMLElement>("#map-panel")?.contains(document.activeElement);
  select(null);
  if (s && inPanel) focusStack(s.letter);
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
// While drawing, Enter and Esc work wherever focus is on the map screen (the drawing's own button, a crumb, after a click on blank space), but not in a field, a dialog or a menu.
document.addEventListener("keydown", (e) => {
  if (!draw || (e.key !== "Escape" && e.key !== "Enter") || e.defaultPrevented || $<HTMLElement>("#tab-map")!.hidden || modalOpen() || document.querySelector(".pop")) return;
  const t = e.target as Element | null;
  if (t?.closest?.("input, textarea, select, [contenteditable], dialog, .drawer-root, #map-svg") || (e.key === "Enter" && t?.closest?.("button, a"))) return;
  if (drawKeys(e)) e.preventDefault();
});
// Esc clears the selection, unless something nearer the user takes it (a field, a dialog, a drawer or a popover), another screen is showing, or a modifier is held. On the document: after a click on blank space focus is on <body>, outside the map.
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || S.selected == null || draw || $<HTMLElement>("#tab-map")!.hidden) return;
  const t = e.target as Element | null;
  if (t?.closest?.("input, textarea, select, [contenteditable], dialog, .drawer-root") || document.querySelector(".pop, .drawer-root:not([hidden])") || modalOpen()) return;
  e.preventDefault();
  unselect();
});

// ---------------------------------------------------------------- the panel
function swatchEl(c: Colour | null): HTMLElement | null {
  return c ? el("span", { class: "map-swatch", "aria-hidden": "true", style: `background:${cssColour(c)}` }) : null;
}
function legend(): HTMLElement {
  return box("ul", { class: "map-legend", id: "map-legend", "aria-label": "Colours" }, ...legendOf(S.mode).map((l) => box("li", { class: "map-legend-item" }, swatchEl(l.token ? { token: l.token } : null), txt(l.text, "t-sm"))));
}
// The selected stack's chests, else the house's totals. Highlight the stack is offered on the same terms as each chest's Highlight, and not while it is still sending. A redraw keeps the focus on the same control when it is still there.
function drawPanel(): void {
  const p = $<HTMLElement>("#map-panel"), m = S.model;
  if (!p || !m) return;
  const was = focusKey(p), s = selectedStack();
  if (!s) p.replaceChildren(...totalsPanel(m));
  else {
    const chests = chestViews(m, s, state.inv!, labels());
    const why = stackReason(m, s, chests) ?? (highlighting ? "Sending the highlights…" : null);
    const all = button({ label: chests.length > 1 ? "Highlight the stack" : "Highlight", icon: "highlight", size: "sm", disabled: !!why, attrs: { id: "map-highlight-stack" }, onClick: () => { void highlightStack(m, s, chests); } });
    p.replaceChildren(
      box("header", { class: "map-panel-head" }, el("h2", { class: "t-lg" }, chests.length > 1 ? `Stack ${s.letter}` : chests[0]!.name), txt(stackWhere(m, s, areasNow()), "t-sm muted")),
      box("ol", { class: "map-chests", "aria-label": "Chests, top first" }, ...chests.map((c) => chestRow(m, s, c))),
      box("div", { class: "map-panel-actions" }, why ? tipWrap(all, why) : all, button({ label: "Back to the house", variant: "ghost", size: "sm", onClick: unselect })),
      legend());
  }
  if (was) refocus(p, was);
}
// The focused panel control as a selector (its chest row, then its data-act or id), or null when focus is elsewhere or on a control with neither. A disabled control's focus sits on its tooltip wrapper, so the wrapper's control stands for it.
function focusKey(p: HTMLElement): string | null {
  const a = document.activeElement;
  if (!(a instanceof HTMLElement) || !p.contains(a)) return null;
  const c = a.matches("[data-act], [id]") ? a : a.querySelector<HTMLElement>("[data-act], [id]");
  if (!c) return null;
  const row = c.closest<HTMLElement>("li[data-chest]")?.dataset.chest;
  return `${row ? `li[data-chest="${row}"] ` : ""}${c.dataset.act ? `[data-act="${c.dataset.act}"]` : `#${CSS.escape(c.id)}`}`;
}
// `scroll` false for the drawer: its redraw puts the list's scroll back itself, and focusing a row would scroll it into view.
function refocus(p: HTMLElement, key: string, scroll = true): void {
  const c = p.querySelector<HTMLElement>(key);
  if (!c) return;
  const wrap = c.parentElement?.classList.contains("tipwrap") ? c.parentElement : null;
  (c.matches(":disabled") && wrap ? wrap : c).focus({ preventScroll: !scroll });
}
// Nothing selected: the house's totals, the colours, and how to start.
function totalsPanel(m: HouseModel): HTMLElement[] {
  const t = houseTotals(m.stacks.flatMap((s) => chestViews(m, s, state.inv!, labels())));
  return [
    houseHead(m),
    ...(t.capacity ? [meter(t.used, t.capacity, { label: `${t.used} of ${t.capacity} item slots used` })] : []),
    keyValue([["Containers", fmtN(t.containers)], ["Item slots used", `${fmtN(t.used)} of ${fmtN(t.capacity)}`], ["Item slots free", fmtN(t.capacity - t.used)], ["Empty", fmtN(t.empty)], ["Full or nearly", fmtN(t.full)], ["Not opened yet", fmtN(t.unopened)], ...(t.unknown ? [["Fill unknown", fmtN(t.unknown)] as [string, string]] : [])]),
    legend(),
    el("p", { class: "t-sm muted" }, "Click a stack on the map, or an area on the left."),
    whereSection(m),
  ].filter((e): e is HTMLElement => e != null);
}
// ---------------------------------------------------------------- where the house is (issue #164)
const summaryOf = (m: HouseModel) => (m.id === PLAIN ? undefined : S.list?.houses.find((h) => h.id === m.id));
// The Location section's first line: the centre tile and the facet, with a copy button.
function whereLine(h: NonNullable<ReturnType<typeof summaryOf>>): HTMLElement {
  const w = whereOf(h), line = txt(w.copy, "t-sm");
  line.id = "map-where-text";
  const copy = button({ label: "Copy the coordinates", icon: "clipboard", iconOnly: true, variant: "ghost", size: "sm", attrs: { id: "map-where-copy" }, onClick: async () => {
    if (await copyText(w.copy)) { toast(`Copied ${w.copy}`, "good"); return; }
    const t = $<HTMLElement>("#map-where-text");
    if (t) getSelection()?.selectAllChildren(t);
    toast("Pack Rat could not reach the clipboard. The coordinates are selected: press ⌘C or Ctrl+C to copy them.", "bad");
  } });
  return box("div", { class: "map-where-coords" }, line, copy);
}
// The Location section: its heading, the coordinates line, then 600 x 450 tiles of the facet's overview around the house (GET /api/facet-map), a marker on it and a smaller one on every other captured house there, each of those a link to its map, placed in the region the server says it drew (x-region). When the image does not load, a line under the coordinates says why; with no facet known, the coordinates alone.
function whereSection(m: HouseModel): HTMLElement | null {
  const h = summaryOf(m);
  if (!h) return null;
  const section = (...kids: HTMLElement[]): HTMLElement => box("section", { class: "map-where", id: "map-where", "aria-labelledby": "map-where-title" }, el("h3", { class: "t-md", id: "map-where-title" }, whereTitle(h)), whereLine(h), ...kids);
  const crop = cropAround(h.facet, whereOf(h).centre);
  if (h.facet == null || !crop) return section();
  const url = facetMapUrl(h.facet, crop), got = facetImages.get(url);
  if (!got) void loadFacetImage(url);
  if (!got || got === "loading") return section(el("p", { class: "t-sm muted", id: "map-where-loading", "aria-busy": "true" }, "Loading the world map…"));
  if ("reason" in got) return section(el("p", { class: "t-sm muted", id: "map-where-note" }, facetMapNote(got.reason)));
  const c = got.crop, w = c.x1 - c.x0, ht = c.y1 - c.y0;
  // The small map opens the whole facet in the world map lightbox (world-map.mts), by a click or by Enter or Space.
  const open = (): void => openWorldMap({ facet: h.facet!, houses: S.list!.houses, currentId: m.id, centre: whereOf(h).centre });
  const img = el("img", { class: "map-where-img", id: "map-where-open", src: got.src, alt: `The world map around ${houseName(m)}`, role: "button", tabindex: "0", "aria-label": "Open the world map", width: String(w), height: String(ht),
    onclick: open, onkeydown: (e: Event) => { const k = (e as KeyboardEvent).key; if (k === "Enter" || k === " ") { e.preventDefault(); open(); } } });
  const marks = sv("svg", { class: "map-where-marks", viewBox: `0 0 ${w} ${ht}`, preserveAspectRatio: "none", role: "group", "aria-label": "Houses on the world map" }, ...markersOf(S.list!.houses, m.id, h.facet, c).map(markerEl));
  const frame = box("div", { class: "map-where-frame" }, img, marks);
  // Marker sizes are screen pixels (a 24 px target for a link), so they follow the frame's width.
  const size = (): void => { const r = markerRadii(w, frame.clientWidth); for (const e of marks.querySelectorAll<SVGCircleElement>("circle[data-r]")) e.setAttribute("r", String(r[e.dataset.r as keyof typeof r])); };
  const watch = new ResizeObserver(() => { if (frame.isConnected) size(); else watch.disconnect(); });
  watch.observe(frame);
  size();
  return section(frame);
}
// The house shown is a plain marker; another house is a link to its map, so the keyboard reaches it and Enter opens it. Its focus ring is two circles, dark under light, seen on pale and dark ground alike.
function markerEl(mk: Marker): SVGElement {
  const title = sv("title", {});
  title.textContent = mk.label;
  const at = { cx: String(mk.x), cy: String(mk.y) };
  if (mk.current) return sv("g", { class: "map-where-mark current", role: "img", "aria-label": mk.label }, title, sv("circle", { ...at, "data-r": "current", class: "map-where-dot" }));
  return sv("a", { class: "map-where-mark", href: `#/map/${encodeURIComponent(mk.id)}`, "aria-label": mk.label, "data-house": mk.id }, title,
    sv("circle", { ...at, "data-r": "hit", class: "map-where-hit" }), sv("circle", { ...at, "data-r": "ring", class: "map-where-ring-out" }), sv("circle", { ...at, "data-r": "ring", class: "map-where-ring-in" }),
    sv("circle", { ...at, "data-r": "other", class: "map-where-dot" }));
}
// One request for the small map; then the panel is drawn again with it.
async function loadFacetImage(url: string): Promise<void> {
  facetImages.set(url, "loading");
  const got = await fetchFacetImage(url);
  if (facetImages.get(url) !== "loading") return;   // the screen loaded again meanwhile
  facetImages.set(url, got);
  if ($<HTMLElement>("#map-where")) drawPanel();
}
// The house's heading with its ✎ (Rename house), or the name field while renaming; under it the house's counts, and
// the offer to carry over the name of an earlier house this one replaced (house-map-model.mts carryOver).
function houseHead(m: HouseModel): HTMLElement {
  const meta = txt(m.id === PLAIN ? "Ground chests outside any drawn house" : `${plural(m.levels.length, "level")} · ${plural(m.stacks.length, "stack")} · ${plural(m.spots.length, "standing spot")}`, "t-sm muted");
  if (renaming != null) return box("header", { class: "map-panel-head" }, renameField(m, renaming, nameError), meta);
  const offer = carryOver(m, S.list?.houses.map((h) => h.id) ?? [], S.names), words = offer ? carryOverText(offer) : null;
  return box("header", { class: "map-panel-head" },
    // One block in the flex header, its heading and ✎ inline, so the ✎ follows the last word of a name that wraps.
    box("div", { class: "map-house-title" }, el("h2", { class: "t-lg" }, houseName(m)),
      m.id === PLAIN ? null : button({ label: "Rename house", icon: "pencil", iconOnly: true, variant: "ghost", size: "sm", attrs: { id: "map-rename" }, onClick: () => { renaming = m.name ?? ""; nameError = null; drawPanel(); const f = $<HTMLInputElement>("#map-name"); f?.focus(); f?.select(); } })),
    meta,
    offer && words ? box("div", { class: "map-carry", id: "map-carry" }, txt(words.text, "t-sm"),
      button({ label: words.action, size: "sm", attrs: { id: "map-carry-use" }, onClick: () => { void saveEntry(m, () => ({ name: offer.name, ...(offer.areas.length ? { areas: offer.areas } : {}) })).then((err) => { if (err) { toast(err, "bad"); return; } render(); $<HTMLElement>("#map-rename")?.focus(); }); } })) : null);
}
// Enter or leaving the field saves, Esc cancels; a refused save keeps the field open with the server's reason under it.
// Either way out puts the focus back on the ✎. A redraw (a reload on a new scan) rebuilds the field from the draft;
// the field it replaces is gone by the time its blur is looked at, so it saves nothing. Leaving the window (to the
// game) is not leaving the field.
function renameField(m: HouseModel, draft: string, error: string | null): HTMLElement {
  const f = input({ size: "sm", value: draft, placeholder: houseName(m), invalid: !!error, attrs: { id: "map-name", maxlength: "60", "aria-label": "House name", ...(error ? { "aria-describedby": "map-name-error" } : {}) } });
  let busy = false, closed = false;
  const close = (saved: boolean): void => { closed = true; renaming = null; nameError = null; if (saved) render(); else drawPanel(); $<HTMLElement>("#map-rename")?.focus(); };
  const save = async (): Promise<void> => {
    if (busy || closed) return;
    if (f.value.trim() === (m.name ?? "")) { close(false); return; }
    busy = true;
    const why = await saveName(m, f.value);
    busy = false;
    if (!why) { if (closed) render(); else close(true); }   // saved after an Esc: the name still changed
    else if (!closed) { nameError = why; drawPanel(); }   // the field (this one, or the one a redraw put in its place) shows it
  };
  f.addEventListener("input", () => { renaming = f.value; });
  f.addEventListener("focus", () => { f.setSelectionRange(f.value.length, f.value.length); });   // a rebuilt field keeps typing at the end
  f.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); void save(); }
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); if (!closed) close(false); }
  });
  f.addEventListener("blur", () => { if (document.hasFocus()) setTimeout(() => { if (f.isConnected) void save(); }, 0); });
  return box("div", { class: "map-name-edit" }, f, error ? message({ tone: "bad", text: error, attrs: { id: "map-name-error" } }) : null);
}
// PUT the house's whole entry (its name and areas, and any other fields it carries, kept unless `patch` sets them) with
// its footprint now, so a later redesign can be offered the name and areas, and keep the answer in the page state (the
// caller redraws). Returns the server's reason when it refuses.
// Saves run one after another (saveChain), each built from the entry as the one before it left it: `patch` is called when its turn comes.
const saveName = (m: HouseModel, name: string): Promise<string | null> => saveEntry(m, () => ({ name }));
let saveChain: Promise<unknown> = Promise.resolve();
function saveEntry(m: HouseModel, patch: () => { name?: string; areas?: HouseArea[] }): Promise<string | null> {
  const run = saveChain.then(() => putEntry(m, patch));
  saveChain = run;
  return run;
}
async function putEntry(m: HouseModel, patch: () => { name?: string; areas?: HouseArea[] }): Promise<string | null> {
  let r: HouseMapPutApiResponse;
  try {
    const body = { ...S.names[m.id], name: m.name ?? "", ...patch(), bounds: { x0: m.x0, y0: m.y0, x1: m.x1, y1: m.y1, facet: m.facet } };
    r = await api<HouseMapPutApiResponse>(`/api/house-map/${encodeURIComponent(m.id)}`, { method: "PUT", body });
  } catch (e) { return errorText(e); }
  if (r.entry) S.names[m.id] = r.entry; else delete S.names[m.id];
  for (const h of [...S.models, ...(S.list?.houses ?? [])]) if (h.id === m.id) h.name = r.entry?.name || undefined;
  return null;
}
// A chest as the bridge's target: the chest itself, with no chain. A chest no scan opened has no scanned root, so it carries the place its house capture saw it.
function chestTarget(m: HouseModel, s: Stack, c: ChestView): { it: BridgeTarget; opts: { pos?: unknown } } {
  return { it: { serial: c.serial, name: c.name, container: null, root: c.opened ? c.serial : null }, opts: c.opened ? {} : { pos: { x: s.x, y: s.y, z: c.z, ...(m.facet != null ? { facet: m.facet } : {}) } } };
}
const stackReason = (m: HouseModel, s: Stack, chests: ChestView[]): string | null => chests.map((c) => bridgeActionReason("highlight", chestTarget(m, s, c).it)).find((r) => r) ?? null;
// One chest of the selected stack: its code and name (the in-game name too when a label renames it), its fill and item count or why they are not known yet, and Highlight, Label… and Show items. Label… and Show items wait for a scan that opens the chest.
function chestRow(m: HouseModel, s: Stack, c: ChestView): HTMLElement {
  const { it, opts } = chestTarget(m, s, c);
  const notOpened = s.spot == null ? "Not opened yet: no standing spot reaches it — scan from beside it to label it and list what is in it." : `Not opened yet: scan from standing spot ${s.spot + 1} to label it and list what is in it.`;
  const why = bridgeActionReason("highlight", it);
  const hl = button({ label: "Highlight", icon: "highlight", size: "sm", disabled: !!why, attrs: { "data-act": "highlight" }, onClick: () => { void runBridgeAction("highlight", it, opts); } });
  const container = state.inv!.containers[String(c.serial)];
  const noLabel = !c.opened ? notOpened : state.organize.blacklist.includes(c.serial) ? "Blacklisted: scans skip it. Unblacklist it in Settings to label it." : null;
  const lbl = button({ label: labels()[String(c.serial)] ? "Edit label…" : "Label…", size: "sm", disabled: !!noLabel, attrs: { "data-act": "label" }, onClick: () => { if (container) void labelContainer(container); } });
  const items = button({ label: "Show items", size: "sm", disabled: !c.opened, attrs: { "data-act": "items" }, onClick: () => openDrawer(c.serial) });
  const open = D?.chest === c.serial;
  return box("li", { class: `map-chest-row${c.opened ? "" : " unopened"}${open ? " open" : ""}`, "data-chest": String(c.serial), ...(open ? { "aria-current": "true" } : {}) },
    swatchEl(colourOf(c, S.mode)),
    box("div", { class: "map-chest-text" },
      box("span", { class: "map-chest-name" }, txt(c.code, "mono strong"), txt(c.name, "ellip strong")),
      c.name !== c.inGame ? txt(`In game: ${c.inGame}`, "t-sm muted ellip") : null,
      c.fill ? box("span", { class: "cont-fill" }, meter(c.fill.items, c.fill.max, { tone: fillTone(c.fill), label: fillWords(c) }), txt(`${c.fill.items}/${c.fill.max}`, "t-sm num")) : txt("Fill unknown", "t-sm muted"),
      txt(c.opened ? `${plural(c.items, "item")} scanned` : notOpened, c.opened ? "t-sm muted" : "t-sm")),
    box("div", { class: "map-chest-actions" }, why ? tipWrap(hl, why) : hl, noLabel ? tipWrap(lbl, noLabel) : lbl, c.opened ? items : tipWrap(items, notOpened)));
}
// Highlight the stack: one highlight per chest, top first, 300 ms apart, stopping at the first refusal; one toast says how it went. One run at a time: the button is disabled while it sends, and a second press (an old button a redraw replaced) does nothing.
async function highlightStack(m: HouseModel, s: Stack, chests: ChestView[]): Promise<void> {
  if (highlighting) return;
  const why = stackReason(m, s, chests);
  if (why) { toast(why, "bad"); return; }
  let sent = 0, stopped: string | null = null;
  try {
    highlighting = true;
    drawPanel();
    for (const c of chests) {
      const { it, opts } = chestTarget(m, s, c);
      const r = await sendBridge("highlight", it, opts);
      if (!r.ok) { stopped = `${c.name}: ${r.error}`; break; }
      sent++;
      if (sent < chests.length) await new Promise((res) => setTimeout(res, 300));
    }
  } finally {
    highlighting = false;
    drawPanel();
  }
  toast(stopped ? `${sent} of ${chests.length} queued, stopped at ${stopped}` : `${plural(sent, "highlight")} queued for ${bridge.character}`, stopped ? "bad" : "");
}
// ---------------------------------------------------------------- the contents drawer
// A column after the panel that lists a chest of the selected stack without leaving the map: the chest shown (null when no scan opened any chest of the stack), the filter typed (kept from chest to chest), the bags closed, its items as last fetched (kept on screen while a rescan's are fetched), the list's scroll, and the chest whose Show items opened it, where focus goes back on close.
interface Drawer { chest: number | null; filter: string; closed: Set<number>; items: Item[] | null; error: string | null; scroll: number; opener: number | null }
let D: Drawer | null = null;
let drawerSeq = 0;
const ITEMS_CHUNK = 500;   // GET /api/items' own cap
const shownChest = (chest: number | null): Pick<Drawer, "chest" | "closed" | "items" | "error" | "scroll"> => ({ chest, closed: new Set(), items: null, error: null, scroll: 0 });
// Show items: the drawer on that chest, focus in its filter.
function openDrawer(chest: number): void {
  const fresh = !D;
  D = { filter: D?.filter ?? "", opener: chest, ...shownChest(chest) };
  drawPanel();
  placeDrawer(fresh);
  void loadDrawer();
  $<HTMLInputElement>("#map-drawer-filter")?.focus();
}
function closeDrawer(): void {
  if (!D) return;
  const opener = D.opener;
  D = null;
  drawerSeq++;
  placeDrawer();
  drawPanel();
  const back = opener == null ? null : $<HTMLElement>(`#map-panel li[data-chest="${opener}"] [data-act="items"]`), s = selectedStack();
  if (back) back.focus();
  else if (s) focusStack(s.letter);
}
// The drawer follows the selection: gone with none, on the stack's top opened chest when the selection moves to another stack. True when it moved to another chest, whose items the caller fetches.
function followSelection(): boolean {
  if (!D) return false;
  const s = selectedStack();
  if (!s || !S.model) { D = null; drawerSeq++; return false; }
  if (D.chest != null && s.serials.includes(D.chest)) return false;
  Object.assign(D, shownChest(drawerChest(chestViews(S.model, s, state.inv!, labels()))));
  return true;
}
// A tab: another chest of the stack.
function showChest(serial: number): void {
  if (!D || D.chest === serial) return;
  const onTab = !!document.activeElement?.closest("#map-drawer [role=radio]");
  Object.assign(D, shownChest(serial));
  drawDrawer();
  drawPanel();
  void loadDrawer();
  if (onTab) $<HTMLElement>(`#map-drawer-tab-${serial}`)?.focus();
}
// Put the drawer in the page (or take it out), then draw it. A drawer just opened grows from no width.
function placeDrawer(animate = false): void {
  const page = body();
  let d = $<HTMLElement>("#map-drawer");
  if (!D || !S.model) { d?.remove(); page.classList.remove("has-drawer"); return; }
  const fresh = !d;
  if (!d) { d = box("aside", { class: "card map-drawer", id: "map-drawer", role: "region", onkeydown: drawerKeys }); page.append(d); }
  page.classList.add("has-drawer");
  drawDrawer();
  if (!fresh) { fitDrawer(); return; }
  // Clamped before it shows: with nothing animating, the page is laid out with the drawer in at no width, the room
  // it leaves measured and the width set. Only then does it grow (and the levels pane fold), straight to that width,
  // so a width chosen on a wider screen never squeezes the map, not even for a frame.
  page.classList.add("resizing");
  d.classList.add("entering");
  void d.offsetWidth;
  showDrawerW(drawerW, stacked() ? Infinity : drawerLimit());
  if (animate) page.classList.remove("has-drawer"); else d.classList.remove("entering");
  void d.offsetWidth;
  page.classList.remove("resizing");
  if (animate) { page.classList.add("has-drawer"); void d.offsetWidth; d.classList.remove("entering"); }
}
// ---------------------------------------------------------------- the drawer's width
// Its handle (on its left edge, from 1100 px up): a drag, ← and → (16 px, 64 with Shift), Home and End set the width, a double-click puts back the default; each saves it. The map keeps MAP_MIN px however wide the window is: the width shown is the chosen one clamped to that (when the drawer opens and whenever the page changes size), and the map's viewBox never needs a re-fit (the SVG scales it to fit) while its pills follow through their ResizeObserver.
const stacked = (): boolean => matchMedia("(max-width: 1099px)").matches;
function drawerLimit(): number {
  const d = $<HTMLElement>("#map-drawer"), m = $<HTMLElement>("#map-stage");
  return d && m ? drawerMax(d.getBoundingClientRect().width, m.getBoundingClientRect().width) : DRAWER_W;
}
function showDrawerW(w: number, max = drawerLimit()): number {
  shownW = clampDrawer(w, max);
  body().style.setProperty("--drawer-w", `${shownW}px`);
  const g = $<HTMLElement>("#map-drawer-grip");
  if (g) { g.setAttribute("aria-valuenow", String(shownW)); g.setAttribute("aria-valuemax", String(isFinite(max) ? Math.max(DRAWER_MIN, max) : shownW)); }
  return shownW;
}
function fitDrawer(): void { if ($<HTMLElement>("#map-drawer") && !stacked() && !$<HTMLElement>("#tab-map")!.hidden) showDrawerW(drawerW); }   // a hidden screen measures 0
// The width chosen (a double-click chooses 400 even where less fits: a wider window shows it again), shown clamped, saved once the keys or the drag pause.
let saveTimer = 0;
function setDrawerW(chosen: number, max?: number): void {
  drawerW = chosen;
  showDrawerW(chosen, max);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    api("/api/ui-prefs", { method: "PUT", body: { mapDrawerWidth: drawerW } }).catch((e: Error) => toast(`Could not save the contents width: ${e.message}`, "bad"));
  }, 300) as unknown as number;
}
// The page's size changes with the window (or the sidebar): fit the drawer again. Watched from the start, so its first call comes before any drawer opens.
new ResizeObserver(() => fitDrawer()).observe(body());
// The levels pane folds or comes back (a window crossing 1800 px): fit again once it has. Only the pane's own width transition counts, so the drawer's resize it may cause cannot call this again.
body().addEventListener("transitionend", (e) => { if ((e.target as Element).classList?.contains("map-side") && e.propertyName === "width") fitDrawer(); });
function drawerGrip(): HTMLElement {
  const g = box("div", { class: "map-drawer-grip", id: "map-drawer-grip", role: "separator", tabindex: "0", "aria-orientation": "vertical", "aria-label": "Resize contents", "aria-valuemin": DRAWER_MIN, "aria-valuenow": shownW, "aria-valuemax": shownW });
  g.addEventListener("pointerdown", (e: PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const x0 = e.clientX, w0 = shownW, max = drawerLimit();
    let moved = false;
    g.setPointerCapture(e.pointerId);
    body().classList.add("resizing");
    const move = (m: PointerEvent): void => { moved = true; showDrawerW(w0 + x0 - m.clientX, max); };
    const ends = ["pointerup", "pointercancel", "lostpointercapture"] as const;
    const up = (): void => {
      g.removeEventListener("pointermove", move);
      for (const t of ends) g.removeEventListener(t, up);
      body().classList.remove("resizing");
      if (moved) setDrawerW(shownW, max);
    };
    g.addEventListener("pointermove", move);
    for (const t of ends) g.addEventListener(t, up);
  });
  g.addEventListener("dblclick", () => setDrawerW(DRAWER_W));
  g.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const max = drawerLimit(), w = drawerKey(e.key, e.shiftKey, shownW, max);
    if (w == null) return;
    e.preventDefault();
    setDrawerW(w, max);
  });
  return g;
}
// Esc from anywhere inside the drawer closes it (a menu opened from a row lives outside it and keeps its own Esc).
function drawerKeys(e: Event): void {
  const k = e as KeyboardEvent;
  if (k.key !== "Escape" || k.defaultPrevented || k.metaKey || k.ctrlKey || k.altKey || k.shiftKey) return;
  k.preventDefault();
  k.stopPropagation();
  closeDrawer();
}
const isBag = (serial: number): boolean => !!state.inv?.containers[String(serial)];
// The header (code and name, where it is, ✕, the fill, the summary, a tab per chest of the stack, the filter and Open in Inventory) over the list. Every control has an id, so a redraw puts focus back on the same one (focusKey).
function drawDrawer(): void {
  const d = $<HTMLElement>("#map-drawer"), m = S.model, s = selectedStack(), dr = D;
  if (!d || !m || !s || !dr) return;
  const was = focusKey(d), chests = chestViews(m, s, state.inv!, labels()), c = chests.find((x) => x.serial === dr.chest) ?? null;
  d.setAttribute("aria-label", `Contents of ${c ? `${c.code} ${c.name}` : `Stack ${s.letter}`}`);
  // A tab per chest up to four (drawerPicker); a taller stack is a select labelled Chest.
  const pick = drawerPicker(chests);
  let tabs: HTMLElement;
  if (pick.kind === "tabs") {
    tabs = segmented({ label: "Chests in this stack", value: String(dr.chest ?? ""), onChange: (v) => showChest(+v), options: pick.options });
    for (const b of tabs.querySelectorAll<HTMLButtonElement>("button")) b.id = `map-drawer-tab-${b.dataset.value}`;
  } else {
    const sel = selectEl(pick.options, String(dr.chest ?? ""), { size: "sm", attrs: { id: "map-drawer-chest" } });
    sel.addEventListener("change", () => showChest(+sel.value));
    tabs = box("div", { class: "map-drawer-pick" }, el("label", { class: "t-sm muted", for: "map-drawer-chest" }, "Chest"), sel);
  }
  const filter = input({ type: "search", size: "sm", value: dr.filter, placeholder: c ? `Filter ${c.code} contents…` : "Filter contents…", attrs: { id: "map-drawer-filter", "aria-label": c ? `Filter ${c.code} contents` : "Filter contents" } });
  filter.addEventListener("input", () => { dr.filter = filter.value; dr.scroll = 0; drawDrawerBody(); });
  const list = box("div", { class: "map-drawer-body", id: "map-drawer-body" });
  list.addEventListener("scroll", () => { if (list.isConnected) dr.scroll = list.scrollTop; });   // a list being replaced reads 0 once detached
  const meta = txt(c ? drawerMeta(c, s) : stackWhere(m, s, areasNow()), "t-sm muted ellip"), summary = txt("", "t-sm muted");
  meta.id = "map-drawer-meta";
  summary.id = "map-drawer-summary";
  d.replaceChildren(drawerGrip(),
    box("header", { class: "map-drawer-head" },
      box("div", { class: "map-drawer-title" },
        box("div", { class: "map-drawer-titles" }, box("h2", { class: "t-lg map-drawer-name" }, ...(c ? [txt(c.code, "mono"), txt(c.name, "ellip")] : [txt(`Stack ${s.letter}`, "ellip")])), meta),
        button({ label: "Close contents", icon: "close", iconOnly: true, variant: "ghost", size: "sm", attrs: { id: "map-drawer-close" }, onClick: closeDrawer })),
      c?.fill ? box("div", { class: "map-drawer-fill" }, meter(c.fill.items, c.fill.max, { tone: fillTone(c.fill), label: fillWords(c) }), txt(slotsText(c), "t-sm num")) : null,
      summary,
      box("div", { class: "map-drawer-tabs" }, tabs),
      box("div", { class: "map-drawer-tools" }, filter, button({ label: "Open in Inventory", size: "sm", disabled: dr.chest == null, attrs: { id: "map-drawer-inventory" }, onClick: () => { if (dr.chest != null) showContainer(dr.chest); } }))),
    list);
  drawDrawerBody();
  if (was) refocus(d, was, false);
}
// The list (and the summary over it): bags as groups that open and close, nested inside nested, then the items; the filter applied.
function drawDrawerBody(): void {
  const list = $<HTMLElement>("#map-drawer-body"), summary = $<HTMLElement>("#map-drawer-summary"), dr = D;
  if (!list || !summary || !dr) return;
  const note = (text: string, busy = false): HTMLElement => el("p", { class: "t-sm muted map-drawer-note", ...(busy ? { "aria-busy": "true" } : {}) }, text);
  if (dr.chest == null) { summary.textContent = "Not opened yet"; list.replaceChildren(note("No chest in this stack has been opened yet: scan from beside it to list what is in it.")); return; }
  if (dr.error) { summary.textContent = ""; list.replaceChildren(message({ tone: "bad", title: "Could not load the contents", text: dr.error })); return; }
  if (!dr.items) { summary.textContent = "Loading…"; list.replaceChildren(note("Loading the contents…", true)); return; }
  const all = treeOf(dr.items, dr.chest), shown = filterContents(all.nodes, dr.filter);
  summary.textContent = contentsSummary(all);
  const was = focusKey(list);   // a row or bag summary keeps focus through a rescan's new list
  list.replaceChildren(...(shown.length ? shown.map(nodeEl) : [note(all.total ? `Nothing here matches "${dr.filter.trim()}".` : "Nothing in this chest.")]));
  list.scrollTop = dr.scroll;
  if (was) refocus(list, was, false);
}
// The tree of the items last fetched, built once per fetch: typing in the filter only filters it.
let tree: { items: Item[]; chest: number; contents: Contents } | null = null;
function treeOf(items: Item[], chest: number): Contents {
  if (tree?.items !== items || tree.chest !== chest) tree = { items, chest, contents: contentsOf(items, chest, isBag) };
  return tree.contents;
}
function nodeEl(n: ContentsNode): HTMLElement {
  if (n.kind === "item") return itemRow(n.item);
  const serial = n.item.serial, group = el("details", { class: "map-bag" });
  group.open = !D?.closed.has(serial);
  group.addEventListener("toggle", () => { if (group.open) D?.closed.delete(serial); else D?.closed.add(serial); });
  group.append(
    itemTip(box("summary", { class: "map-bag-head", id: `map-drawer-bag-${serial}` }, icon("chevron-right", { size: "sm" }), txt(n.item.name, "ellip strong map-bag-name"), txt(plural(n.count, "item"), "t-sm muted num")), n.item),
    box("div", { class: "map-bag-kids" }, ...n.kids.map(nodeEl)));
  return group;
}
const ROW_ACTS = ["highlight", "grab", "goto", "more"];
// An item in two lines, the Inventory's own pieces: the name and tags, then the rarity, the properties and the resists. Hovering or focusing it shows the item tooltip, which has everything a cut line leaves out. A click opens the item's menu. At its right end, shown on hover and focus and always in the tab order, the Inventory row's actions (itemActions), in a data-no-tip zone so aiming at them never pops the tooltip.
function itemRow(it: Item): HTMLElement {
  const name = (it.amount || 1) > 1 ? `${it.name} ×${it.amount.toLocaleString("en-US")}` : it.name;
  const props = propertyLines(it).filter((l) => !l.muted).map((l) => (l.value ? `${l.name} ${l.value}` : l.name)).join(" · ");
  const res = RESISTS.filter(([k]) => it.props[k]), rarity = rarityEl(it.rarity, "t-sm");
  const main = box("button", { type: "button", class: "map-item", id: `map-drawer-item-${it.serial}`, "aria-haspopup": "menu", onclick: (e: Event) => itemMenu(e.currentTarget as HTMLElement, it) },
    box("span", { class: "map-item-l1" }, txt(name, "ellip map-item-name"), ...tagEls(it)),
    rarity || props || res.length ? box("span", { class: "map-item-l2" }, rarity, props ? txt(props, "ellip t-sm muted map-item-props") : null,
      res.length ? box("span", { class: "map-item-res" }, ...res.map(([k, short, token]) => el("span", { style: `color:var(${token})` }, `${short.slice(0, 2)}${it.props[k]}`))) : null) : null);
  const acts = itemActions(it);
  acts.querySelectorAll("button").forEach((b, i) => { b.id = `map-drawer-${ROW_ACTS[i] ?? i}-${it.serial}`; });   // so a redraw keeps focus on it (focusKey)
  return box("div", { class: "map-item-row" }, itemTip(main, it), box("span", { class: "map-item-acts", "data-no-tip": "" }, acts));
}
// Every item under the chest, in GET /api/items' 500-row pages, name order, each serial once; an answer for a chest no longer shown is dropped.
async function loadDrawer(): Promise<void> {
  const chest = D?.chest;
  if (chest == null) return;
  const my = ++drawerSeq, rows = new Map<number, Item>();   // by serial: a page that shifted under a change between requests repeats none
  try {
    for (let offset = 0, total = Infinity; offset < total;) {
      const r = await api<ItemsApiResponse>(`/api/items?root=${chest}&offset=${offset}&limit=${ITEMS_CHUNK}`);
      if (my !== drawerSeq) return;
      const got = "rows" in r ? r.rows : [];
      for (const it of got) rows.set(it.serial, it);
      offset += got.length;
      total = got.length ? r.total : offset;
    }
  } catch (e) {
    if (my === drawerSeq && D) { D.error = errorText(e); drawDrawerBody(); }
    return;
  }
  if (my !== drawerSeq || !D || D.chest !== chest) return;
  D.items = [...rows.values()];
  D.error = null;
  drawDrawerBody();
}
// A saved label changes chest colours and names; the bridge going on or off line changes what Highlight, Grab and Go to may do.
document.addEventListener("organizechange", () => { if (S.model && !$<HTMLElement>("#tab-map")!.hidden) { drawMap(); drawPanel(); } });
document.addEventListener("bridgechange", () => { if (S.model && !$<HTMLElement>("#tab-map")!.hidden) { drawPanel(); drawDrawerBody(); } });
