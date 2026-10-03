// ui/house-map-model.mts — the House map's pure rules (issue #10, spec section 4): the projection (the client's angle, or top-down), the polygons of a tile and of a box, the painter's order, a level's bounds and their fit; below, the joins of a stack with the inventory and the Organize labels, the colour modes, the cut-away, the callout, the totals, the house picker, keyboard moves, the plain grid for chests outside any drawn house, and the scene of one level. No DOM and no store.mts import, so app/ui-map.test.mts runs it under plain node:test; ui/house-map.mts draws what it returns. Coordinates are relative to the house's corner (x0, y0); heights to the level's floor.
import { bagLabel, itemOwnBlob, type Container, type Item } from "../vault-lib.mts";
import { plural, splitSerial } from "./inv-model.mts";
import type { AreaRect, Cell, ContainerLabel, FacetMapReason, HouseArea, HouseMapEntry, HouseModel, HouseSummary, InventoryData, Spot, Stack, TiledataFrom } from "./api-types.mts";

// A tile is W units wide at the game angle (half as tall), and one z step lifts a point K units: the client draws a 44-px tile and 4 px per z, a little flatter than this, which reads better at the map's size.
export const W = 32, K = 2;
// Heights in z: walls are cut down low so nothing hides behind them, a window lower still, the foundation's lip and a roof's edge a sliver, a chest a little under the 4 z between chests in a stack.
export const WALL_H = 6, WINDOW_H = 3, LIP_H = 1.5, ROOF_H = 1.5, CHEST_H = 3.4;
export type View = "angle" | "top";
export type Pt = [number, number];
export interface Box { x: number; y: number; w: number; h: number }

export function project(x: number, y: number, z: number, view: View): Pt {
  return view === "angle" ? [((x - y) * W) / 2, ((x + y) * W) / 2 - z * K] : [x * W, y * W];
}
// The tile (x, y) at height z as its four corners: north, east, south, west at the game angle. `inset` shrinks it toward its centre (a fraction of a tile).
export function tilePolygon(x: number, y: number, z: number, view: View, inset = 0): Pt[] {
  const a = inset, b = 1 - inset;
  return [project(x + a, y + a, z, view), project(x + b, y + a, z, view), project(x + b, y + b, z, view), project(x + a, y + b, z, view)];
}
// A box on a tile from z to z + h: its top, and at the game angle the two faces the viewer sees (south on the left, east on the right). From above only the top shows.
export interface Faces { top: Pt[]; left: Pt[]; right: Pt[] }
export function boxFaces(x: number, y: number, z: number, h: number, view: View, inset = 0): Faces {
  const lo = tilePolygon(x, y, z, view, inset), hi = tilePolygon(x, y, z + h, view, inset);
  if (view === "top") return { top: hi, left: [], right: [] };
  return { top: hi, left: [hi[3]!, hi[2]!, lo[2]!, lo[3]!], right: [hi[1]!, hi[2]!, lo[2]!, lo[1]!] };
}
export const pts = (p: readonly Pt[]): string => p.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
// Back to front, as the client draws: by x + y, then from low to high; equal keys keep their order.
export function paintOrder<T extends { x: number; y: number; z: number }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => a.x + a.y - (b.x + b.y) || a.z - b.z);
}

const CORNERS: ReadonlyArray<Pt> = [[0, 0], [1, 0], [1, 1], [0, 1]];
// What a level draws, in drawing units, with a tile's margin: every cell of the level (or of `area`'s rectangles) up to a cut wall's height, and every stack up to its top chest.
export function boundsOf(m: HouseModel, level: number, view: View, area: Pick<HouseArea, "rects"> | null = null): Box {
  const base = m.levels[level]?.floorZ ?? 0;
  const inArea = (x: number, y: number): boolean => !area || inRects(area.rects, x, y);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (x: number, y: number, lo: number, hi: number): void => {
    for (const [dx, dy] of CORNERS) for (const z of [lo, hi]) {
      const [px, py] = project(x - m.x0 + dx, y - m.y0 + dy, z, view);
      if (px < x0) x0 = px;
      if (px > x1) x1 = px;
      if (py < y0) y0 = py;
      if (py > y1) y1 = py;
    }
  };
  const heights = heightsOf(m, level), plinth = plinthOf(m, level, base, heights);
  for (const c of m.cells) if (c.level === level && inArea(c.x, c.y)) {
    const z = c.kind === "floor" || c.kind === "stair" ? c.z - base : 0, top = c.kind === "stair" ? stairTop(c, heights).z - base : z;
    add(c.x, c.y, plinth?.(c)?.lo ?? z, top + WALL_H);
  }
  for (const s of m.stacks) if (s.level === level && inArea(s.x, s.y)) add(s.x, s.y, 0, (drawnZs(s, base).at(-1) ?? 0) + CHEST_H);
  if (x0 === Infinity) return { x: 0, y: 0, w: 4 * W, h: 4 * W };
  return { x: x0 - W, y: y0 - W, w: x1 - x0 + 2 * W, h: y1 - y0 + 2 * W };
}
// The box grown to the viewport's shape around its centre, so the SVG fills its pane with nothing cut off.
export function fit(b: Box, vp: { width: number; height: number }): Box {
  const ar = vp.width > 0 && vp.height > 0 ? vp.width / vp.height : 4 / 3;
  let w = b.w, h = b.h;
  if (w / h < ar) w = h * ar; else h = w / ar;
  return { x: b.x + b.w / 2 - w / 2, y: b.y + b.h / 2 - h / 2, w, h };
}
// f < 1 zooms in, keeping (cx, cy) where it is on screen (the cursor's point for the wheel, the centre for the buttons).
export function zoomAt(b: Box, f: number, cx: number = b.x + b.w / 2, cy: number = b.y + b.h / 2): Box {
  const k = Math.min(Math.max(f, (2 * W) / b.w), (400 * W) / b.w);
  return { x: cx - (cx - b.x) * k, y: cy - (cy - b.y) * k, w: b.w * k, h: b.h * k };
}
export const vbText = (b: Box): string => [b.x, b.y, b.w, b.h].map((n) => n.toFixed(1)).join(" ");
// The point just above a stack's top chest, where its callout's line starts and keyboard moves measure from.
export function anchorOf(m: HouseModel, s: Stack, view: View): Pt {
  const base = m.levels[s.level]?.floorZ ?? 0;
  return project(s.x - m.x0 + 0.5, s.y - m.y0 + 0.5, (drawnZs(s, base).at(-1) ?? 0) + CHEST_H, view);
}
// A stack's chests' heights above the floor as drawn: each at least a chest's height above the one below it, so chests sharing a z on one tile sit one on another instead of inside each other (display only).
export function drawnZs(s: Stack, base: number): number[] {
  const out: number[] = [];
  for (const z of s.zs) out.push(Math.max(z - base, out.length ? out[out.length - 1]! + CHEST_H : -Infinity));
  return out;
}

// ---------------------------------------------------------------- a stack's chests, and how they are coloured
export type Mode = "contents" | "free";
// A chest as the map and its panel show it: its code, the name its label gives (else its in-game name: the engraving, or its scanned name without the serial a duplicate carries, or a seen-only chest's tiledata name), its label colour, fill, item count and height.
export interface ChestView { serial: number; code: string; name: string; inGame: string; color: string | null; fill: { items: number; max: number } | null; opened: boolean; items: number; z: number }
type Inv = Pick<InventoryData, "containers" | "rootCounts">;
export function chestViews(m: HouseModel, s: Stack, inv: Inv, labels: Readonly<Record<string, ContainerLabel>>): ChestView[] {
  const unopened = new Set(m.unopened);
  return s.serials.map((serial, i): ChestView => {
    const key = String(serial), c = inv.containers[key], lab = labels[key];
    const inGame = c ? splitSerial(c.label || bagLabel(c)).name : m.unopenedNames[key] ?? "container";
    return { serial, code: m.codes[key] ?? s.letter, name: lab?.name ?? inGame, inGame, color: lab?.color ?? null, fill: c?.capacity ? { items: c.capacity.items, max: c.capacity.maxItems } : null,
      opened: !unopened.has(serial), items: inv.rootCounts[key] ?? 0, z: s.zs[i] ?? 0 };
  }).reverse();
}
// A chest's colour: a token, or an Organize label's colour (the page paints that through safeColor, always with a border-strong edge).
export type Colour = { token: string } | { label: string };
export function colourOf(c: ChestView, mode: Mode): Colour {
  if (mode === "free") {
    if (!c.opened || !c.fill || c.fill.max <= 0) return { token: "--color-map-free-unknown" };
    const r = c.fill.items / c.fill.max;
    return { token: r === 0 ? "--color-map-free-empty" : r < 0.5 ? "--color-map-free-half" : r < 0.9 ? "--color-map-free-filling" : "--color-map-free-full" };
  }
  if (!c.opened) return { token: "--color-map-unopened" };
  if (c.color) return { label: c.color };
  return { token: c.fill && c.fill.items === 0 ? "--color-map-chest-empty" : "--color-map-chest" };
}
export function legendOf(mode: Mode): Array<{ token: string | null; text: string }> {
  return mode === "free"
    ? [{ token: "--color-map-free-empty", text: "Empty" }, { token: "--color-map-free-half", text: "Under half full" }, { token: "--color-map-free-filling", text: "Filling" }, { token: "--color-map-free-full", text: "90% or more full" }, { token: "--color-map-free-unknown", text: "Fill unknown" }]
    : [{ token: null, text: "A labeled container takes its label's color." }, { token: "--color-map-chest", text: "Not labeled" }, { token: "--color-map-chest-empty", text: "Not labeled, empty" }, { token: "--color-map-unopened", text: "Not opened yet" }];
}
export const fillWords = (c: ChestView): string => (!c.opened ? "not opened yet" : c.fill ? `${c.fill.items} of ${c.fill.max} items` : "fill unknown");
// Every chest element's accessible name.
export const chestLabel = (c: ChestView): string => `${c.code} ${c.name}, ${fillWords(c)}`;

// ---------------------------------------------------------------- cut-away, callout, totals
// The stacks drawn in front of `focus` on its level (larger x + y, within three tiles each way): they fade and let the pointer through, so the inner rings of a dense vault can be reached.
export function cutAway(m: HouseModel, level: number, focus: Stack): Set<string> {
  return new Set(m.stacks.filter((s) => s.level === level && s !== focus && s.x + s.y > focus.x + focus.y && Math.abs(s.x - focus.x) <= 3 && Math.abs(s.y - focus.y) <= 3).map((s) => s.letter));
}
export interface CalloutLine { serial: number; code: string; name: string; fill: string; colour: Colour }
export function calloutLines(s: Stack, chests: readonly ChestView[], mode: Mode): { title: string; lines: CalloutLine[] } {
  return {
    title: chests.length > 1 ? `Stack ${s.letter}, top first` : `Stack ${s.letter}`,
    lines: chests.map((c) => ({ serial: c.serial, code: c.code, name: c.name, fill: !c.opened ? "not opened" : c.fill ? `${c.fill.items}/${c.fill.max}` : "?", colour: colourOf(c, mode) })),
  };
}
export interface HouseTotals { containers: number; used: number; capacity: number; empty: number; full: number; unopened: number; unknown: number }
export function houseTotals(chests: readonly ChestView[]): HouseTotals {
  const t: HouseTotals = { containers: chests.length, used: 0, capacity: 0, empty: 0, full: 0, unopened: 0, unknown: 0 };
  for (const c of chests) {
    if (!c.opened) { t.unopened++; continue; }
    if (!c.fill) { t.unknown++; continue; }
    t.used += c.fill.items; t.capacity += c.fill.max;
    if (c.fill.items === 0) t.empty++;
    else if (c.fill.max > 0 && c.fill.items / c.fill.max >= 0.9) t.full++;
  }
  return t;
}
// The chests in a house, or on one of its levels.
export const chestCount = (m: HouseModel, level: number | null = null): number => m.stacks.reduce((a, s) => a + (level == null || s.level === level ? s.serials.length : 0), 0);

// ---------------------------------------------------------------- picking a house, names and words
// The plain grid's id in the picker and the route (#/map/plain): house ids are "<facet>-<x>-<y>", so it never collides.
export const PLAIN = "plain";
export function pickHouse(choices: ReadonlyArray<{ id: string; containers: number }>, want: string | null, last: string | null): string | null {
  const has = (id: string | null): id is string => id != null && choices.some((c) => c.id === id);
  if (has(want)) return want;
  if (has(last)) return last;
  let best: { id: string; containers: number } | null = null;
  for (const c of choices) if (c.id !== PLAIN && (!best || c.containers > best.containers)) best = c;
  return best?.id ?? (has(PLAIN) ? PLAIN : null);
}
const FACETS = ["Felucca", "Trammel", "Ilshenar", "Malas", "Tokuno", "Ter Mur"];
export const facetName = (f: number | null): string => (f != null ? FACETS[f] : undefined) ?? "Unknown facet";
// A house the player named (issue #164) is called by its name, the facet after it in the picker.
export const houseLabel = (h: HouseSummary): string => `${h.name ? `${h.name} · ${facetName(h.facet)}` : `${facetName(h.facet)} house`}, ${h.width} × ${h.height}, ${plural(h.containers, "container")}`;
export const houseName = (m: Pick<HouseModel, "id" | "name" | "facet">): string => (m.id === PLAIN ? "Containers on the ground" : m.name ?? `${facetName(m.facet)} house`);
// A redesigned or moved house gets a new id (spec §1): the name and areas of a house no longer listed whose footprint, as
// it was when named or drawn, overlaps this house's on the same facet, to offer carrying over while this house has neither
// a name nor an area of its own. The first such id wins. Only the areas on a level this house has, and that still lie on
// it (AREA_MARGIN, as the server checks), come along, each with the rectangles that do.
export function carryOver(m: HouseModel, listed: readonly string[], names: Readonly<Record<string, HouseMapEntry>>): { id: string; name: string; areas: HouseArea[] } | null {
  if (m.id === PLAIN || m.name || liveAreas(names[m.id]?.areas, m.levels.length).length) return null;
  for (const [id, e] of Object.entries(names).sort((a, b) => a[0].localeCompare(b[0]))) {
    const b = e.bounds;
    if (!b || listed.includes(id) || b.facet !== m.facet || !(e.name || e.areas?.length)) continue;
    if (!(b.x0 <= m.x1 && m.x0 <= b.x1 && b.y0 <= m.y1 && m.y0 <= b.y1)) continue;
    const on = (r: AreaRect): boolean => r.x0 >= m.x0 - AREA_MARGIN && r.y0 >= m.y0 - AREA_MARGIN && r.x1 <= m.x1 + AREA_MARGIN && r.y1 <= m.y1 + AREA_MARGIN;
    const areas = liveAreas(e.areas, m.levels.length).map((a) => ({ ...a, rects: a.rects.filter(on) })).filter((a) => a.rects.length);
    if (e.name || areas.length) return { id, name: e.name, areas };
  }
  return null;
}
// The redraw failure's words: the server's reason with a full stop after it.
export const redrawFailed = (why: string, kept: boolean): string => `Could not save the new shape: ${/[.!?]$/.test(why.trim()) ? why.trim() : `${why.trim()}.`}${kept ? " Your drawing is kept: press Enter to try again, or Esc to cancel." : ""}`;
// The offer's words: what it would carry over.
export function carryOverText(o: { name: string; areas: readonly HouseArea[] }): { text: string; action: string } {
  const what = o.name && o.areas.length ? "name and areas" : o.name ? "name" : "areas";
  const text = !o.name ? `Use the ${what} from the earlier house here?` : o.areas.length ? `Use the ${what} of "${o.name}" from the earlier house here?` : `Use the name "${o.name}" from the earlier house here?`;
  return { text, action: `Use ${what}` };
}
export function stackWhere(m: HouseModel, s: Stack, areas: readonly HouseArea[] = []): string {
  const spot = s.spot == null ? "no standing spot reaches it" : s.direction === "here" ? `at standing spot ${s.spot + 1}` : `${s.direction} of standing spot ${s.spot + 1}`;
  return `${areaName(areas, s)} · ${spot} · ${plural(s.serials.length, "container")}${s.serials.length > 1 ? ", top first" : ""}`;
}
// Why the map is drawn in plain colours (GET /api/houses's tiledataFrom.reason), or null when tiledata.mul was read.
export function tiledataNote(reason: TiledataFrom["reason"]): string | null {
  const plain = "so the house is drawn in plain colors, with every impassable tile as a wall";
  switch (reason) {
    case null: return null;
    case "no-client": return `No game client is set up, so Pack Rat has no tiledata.mul to tell walls, floors and materials apart, ${plain}.`;
    case "no-tazuo-profile": return `TazUO's launcher names no UO folder holding a tiledata.mul, ${plain}.`;
    case "override-missing": return `The UO folder set in Settings has no tiledata.mul any more, ${plain}.`;
    case "unreadable": return `The tiledata.mul found is not one Pack Rat can read, ${plain}.`;
  }
}

// ---------------------------------------------------------------- where the house is (issue #164)
// Each facet's size in tiles (0 Felucca, 1 Trammel, 2 Ilshenar, 3 Malas, 4 Tokuno, 5 Ter Mur).
export const FACET_SIZE: ReadonlyArray<readonly [number, number]> = [[7168, 4096], [7168, 4096], [2304, 1600], [2560, 2048], [1448, 1448], [1280, 4096]];
// A house's place in the world from its plot (the front steps left out): the centre tile (the lower middle of an even side) and the one line the Location section shows and Copy puts on the clipboard, "<x>, <y> · <facet>".
export interface Where { centre: [number, number]; centreText: string; copy: string }
export function whereOf(h: Pick<HouseSummary, "facet" | "plot">): Where {
  const p = h.plot, centre: [number, number] = [Math.floor((p.x0 + p.x1) / 2), Math.floor((p.y0 + p.y1) / 2)];
  const centreText = `${centre[0]}, ${centre[1]}`;
  return { centre, centreText, copy: `${centreText} · ${facetName(h.facet)}` };
}
// The Where section's heading: "Location - <facet> - <x> <y>", the plot's centre tile.
export const whereTitle = (h: Pick<HouseSummary, "facet" | "plot">): string => `Location - ${facetName(h.facet)} - ${whereOf(h).centre.join(" ")}`;
// The facet overview shows 600 x 450 tiles around the house (on a 7168-wide facet the whole map would make it a speck), slid back inside the facet at its edges; null for an unknown facet. x1 and y1 are exclusive, as GET /api/facet-map takes them.
export interface Crop { x0: number; y0: number; x1: number; y1: number }
export const CROP_W = 600, CROP_H = 450;
export function cropAround(facet: number | null, [cx, cy]: readonly [number, number]): Crop | null {
  const size = facet == null ? undefined : FACET_SIZE[facet];
  if (!size) return null;
  const along = (c: number, span: number, max: number): [number, number] => { const w = Math.min(span, max), a = Math.max(0, Math.min(c - Math.floor(w / 2), max - w)); return [a, a + w]; };
  const [x0, x1] = along(cx, CROP_W, size[0]), [y0, y1] = along(cy, CROP_H, size[1]);
  return { x0, y0, x1, y1 };
}
export const facetMapUrl = (facet: number, c: Crop): string => `/api/facet-map/${facet}.png?x0=${c.x0}&y0=${c.y0}&x1=${c.x1}&y1=${c.y1}&w=${CROP_W}`;
// A marker per captured house on the facet whose centre tile lies in the crop, at the tile's middle in crop tiles; the house shown last, so it draws on top. Each is named by the house's name, else its coordinates.
export interface Marker { id: string; x: number; y: number; current: boolean; label: string }
export function markersOf(houses: readonly HouseSummary[], currentId: string | null, facet: number, c: Crop): Marker[] {
  const out: Marker[] = [];
  for (const h of houses) {
    if (h.facet !== facet) continue;
    const { centre: [x, y], centreText } = whereOf(h);
    if (x < c.x0 || x >= c.x1 || y < c.y0 || y >= c.y1) continue;
    const current = h.id === currentId, name = h.name ?? `${facetName(h.facet)} house at ${centreText}`;
    out.push({ id: h.id, x: x - c.x0 + 0.5, y: y - c.y0 + 0.5, current, label: current ? `${name} (this house)` : name });
  }
  return out.sort((a, b) => Number(a.current) - Number(b.current));
}
// The region GET /api/facet-map says it drew (its x-region header, "x0,y0,x1,y1"), or null for anything else.
export function parseRegion(v: string | null): Crop | null {
  const m = v ? /^(\d{1,5}),(\d{1,5}),(\d{1,5}),(\d{1,5})$/.exec(v) : null;
  if (!m) return null;
  const [x0, y0, x1, y1] = m.slice(1).map(Number) as [number, number, number, number];
  return x0 < x1 && y0 < y1 ? { x0, y0, x1, y1 } : null;
}
// The markers' radii in crop tiles for a crop `tiles` wide shown `px` pixels wide (300 before the frame is laid out): the house shown 6 px, another 4 px, its focus ring 9 px and its target 12 px (24 across).
export function markerRadii(tiles: number, px: number): { current: number; other: number; ring: number; hit: number } {
  const k = tiles / (px > 0 ? px : 300);
  return { current: 6 * k, other: 4 * k, ring: 9 * k, hit: 12 * k };
}
// Why the overview is not shown (GET /api/facet-map's 404 reason, or "error" when the request itself failed); the coordinates still are.
export function facetMapNote(reason: FacetMapReason | "error"): string {
  switch (reason) {
    case "no-client": return "No game client is set up, so Pack Rat has no UO folder to read the world map from.";
    case "no-tazuo-profile": return "TazUO's launcher names no UO folder, so Pack Rat has no world map to show.";
    case "override-missing": return "The UO folder set in Settings has no world map files any more, so Pack Rat has no world map to show.";
    case "missing": return "The UO folder has no world map file for this facet.";
    case "unreadable": return "The world map file for this facet is not one Pack Rat can read.";
    case "error": return "The world map could not be loaded.";
  }
}

// ---------------------------------------------------------------- the contents drawer
// Which chest a stack opens in the drawer: its top opened one (chests come top first), null when no scan opened any.
export const drawerChest = (chests: readonly ChestView[]): number | null => chests.find((c) => c.opened)?.serial ?? null;
export const drawerMeta = (c: ChestView, s: Pick<Stack, "letter" | "serials">): string => `In game: ${c.inGame} · Stack ${s.letter}, ${plural(s.serials.length, "container")}`;
// The drawer's width, dragged on its left edge or set from the keyboard (ui-prefs mapDrawerWidth): 400 px by default, at least DRAWER_MIN, and at most what leaves the map MAP_MIN px at the window's width (drawerMax, from the drawer's and the map's widths now).
export const DRAWER_W = 400, DRAWER_MIN = 320, MAP_MIN = 360;
export const drawerMax = (drawerW: number, mapW: number): number => Math.max(DRAWER_MIN, Math.floor(drawerW + mapW - MAP_MIN));
export const clampDrawer = (w: number, max: number): number => Math.round(Math.min(Math.max(w, DRAWER_MIN), Math.max(DRAWER_MIN, max)));
// A key on the focused handle: ← and → move the edge 16 px (64 with Shift) the way the arrow points, so ← widens the drawer; Home and End go to the minimum and maximum. Null for any other key.
export function drawerKey(key: string, shift: boolean, w: number, max: number): number | null {
  const step = shift ? 64 : 16;
  if (key === "ArrowLeft") return clampDrawer(w + step, max);
  if (key === "ArrowRight") return clampDrawer(w - step, max);
  if (key === "Home") return DRAWER_MIN;
  if (key === "End") return clampDrawer(max, max);
  return null;
}
// How the drawer picks a chest of the stack: a tab each (the segmented control, which is for 2 to 4 choices) up to DRAWER_TABS_MAX chests, else a select. Each choice is the chest's code and name; a chest no scan opened is disabled, "Not opened yet".
export const DRAWER_TABS_MAX = 4;
export interface DrawerChoice { value: string; label: string; sub: string; disabled: boolean; title: string }
export function drawerPicker(chests: readonly ChestView[]): { kind: "tabs" | "select"; options: DrawerChoice[] } {
  const kind = chests.length > DRAWER_TABS_MAX ? "select" : "tabs";
  return { kind, options: chests.map((x) => ({ value: String(x.serial), label: kind === "tabs" ? x.code : `${x.code} ${x.name}${x.opened ? "" : " · Not opened yet"}`, sub: x.name, disabled: !x.opened, title: x.opened ? `${x.code} ${x.name}` : "Not opened yet" })) };
}
export const slotsText = (c: ChestView): string => (c.fill ? `${c.fill.items} of ${c.fill.max} slots` : "Fill unknown");
// A chest's items as a tree: each bag (a scanned container, or anything an item sits in) with what it holds, bags first, then the items, each in the order given; `count` is everything inside a bag, bags in it included. An item whose bag is not among the items, or that sits in a container cycle, is shown loose rather than lost.
export type ContentsNode = { kind: "item"; item: Item } | { kind: "bag"; item: Item; count: number; kids: ContentsNode[] };
export interface Contents { nodes: ContentsNode[]; total: number; loose: number; inBags: number; bags: number }
const countOf = (ns: readonly ContentsNode[]): number => ns.reduce((n, x) => n + 1 + (x.kind === "bag" ? x.count : 0), 0);
export function contentsOf(items: readonly Item[], root: number, isBag: (serial: number) => boolean): Contents {
  const serials = new Set(items.map((it) => it.serial)), byParent = new Map<number, Item[]>();
  for (const it of items) {
    const parent = it.container != null && it.container !== it.serial && serials.has(it.container) ? it.container : root;
    const kids = byParent.get(parent);
    if (kids) kids.push(it); else byParent.set(parent, [it]);
  }
  const seen = new Set<number>();
  const build = (parent: number): ContentsNode[] => {
    const bags: ContentsNode[] = [], loose: ContentsNode[] = [];
    for (const it of byParent.get(parent) ?? []) {
      if (seen.has(it.serial)) continue;
      seen.add(it.serial);
      if (isBag(it.serial) || byParent.has(it.serial)) { const kids = build(it.serial); bags.push({ kind: "bag", item: it, count: countOf(kids), kids }); }
      else loose.push({ kind: "item", item: it });
    }
    return [...bags, ...loose];
  };
  // Items in a container cycle (each in another of them) are reached from no chest: they are shown loose.
  const nodes = [...build(root), ...items.filter((it) => !seen.has(it.serial)).map((item): ContentsNode => ({ kind: "item", item }))], top = nodes.filter((n) => n.kind === "bag");
  return { nodes, total: items.length, loose: nodes.length - top.length, inBags: countOf(top) - top.length, bags: top.length };
}
export function contentsSummary(c: Contents): string {
  if (!c.total) return "Empty";
  return c.bags ? `${plural(c.total, "item")} · ${c.loose} loose, ${c.inBags} in ${plural(c.bags, "container")}` : plural(c.total, "item");
}
// The drawer's filter: an item whose name, tooltip lines, rarity, kind or tags hold the text (any case); a bag stays when it matches itself (with all it holds) or holds a match, counting what it kept.
export function filterContents(nodes: readonly ContentsNode[], text: string): ContentsNode[] {
  const needle = text.trim().toLowerCase();
  if (!needle) return [...nodes];
  const hit = (it: Item): boolean => `${itemOwnBlob(it)} \n ${it.tags.join(" ")}`.toLowerCase().includes(needle);
  return nodes.flatMap((n): ContentsNode[] => {
    if (hit(n.item)) return [n];
    if (n.kind === "item") return [];
    const kids = filterContents(n.kids, needle);
    return kids.length ? [{ ...n, kids, count: countOf(kids) }] : [];
  });
}

// ---------------------------------------------------------------- areas (issue #10)
// The player's own areas on a level (house-map.json, app/house-names.mts): each a name, a colour token and tile rectangles (world tiles, inclusive). These mirror the server's rules, which the browser build cannot import.
export const AREA_COLORS = ["area-1", "area-2", "area-3", "area-4", "area-5", "area-6", "area-7", "area-8"] as const;
export const AREA_MARGIN = 8, MAX_AREAS = 32, MAX_RECTS = 16;
// Each colour token's name, for its swatch's label (the token's hue in both modes).
export const AREA_COLOR_NAMES: Readonly<Record<string, string>> = { "area-1": "Purple", "area-2": "Orange", "area-3": "Teal", "area-4": "Pink", "area-5": "Blue", "area-6": "Yellow", "area-7": "Green", "area-8": "Red" };
// The areas on the house's levels: one saved for a level the house no longer has (a rebuild took a storey away) is left out of the list, the counts, the cap and the next save.
export const liveAreas = (areas: readonly HouseArea[] | undefined, levels: number): HouseArea[] => (areas ?? []).filter((a) => a.level < levels);
// What a save of the areas writes: the edited live list, then the hidden orphan-level ones as they were, so a storey taken away in place and built again gets its areas back.
export const withOrphans = (edited: readonly HouseArea[], saved: readonly HouseArea[] | undefined, levels: number): HouseArea[] => [...edited, ...(saved ?? []).filter((a) => a.level >= levels)];
export type Tile = [number, number];
export const inRects = (rects: readonly AreaRect[], x: number, y: number): boolean => rects.some((r) => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1);
// The area a stack belongs to: the first, in list order, on its level whose rectangles hold its tile; null for the rest.
export const areaOfStack = (areas: readonly HouseArea[], s: Pick<Stack, "level" | "x" | "y">): HouseArea | null => areas.find((a) => a.level === s.level && inRects(a.rects, s.x, s.y)) ?? null;
// Where the rest of a level is: "Everything else" once the level has areas, else the level is one "Whole floor".
export const restName = (areas: readonly HouseArea[], level: number): string => (areas.some((a) => a.level === level) ? "Everything else" : "Whole floor");
export const areaName = (areas: readonly HouseArea[], s: Pick<Stack, "level" | "x" | "y">): string => areaOfStack(areas, s)?.name ?? restName(areas, s.level);
// A level's rows in the left pane: its areas in list order with their chest counts, then the rest.
export function levelAreas(m: HouseModel, areas: readonly HouseArea[], level: number): { rows: Array<{ area: HouseArea; chests: number }>; rest: { name: string; chests: number } } {
  const rows = areas.filter((a) => a.level === level).map((area) => ({ area, chests: 0 })), rest = { name: restName(areas, level), chests: 0 };
  for (const s of m.stacks) {
    if (s.level !== level) continue;
    const a = areaOfStack(areas, s), row = a ? rows.find((r) => r.area === a) : undefined;
    if (row) row.chests += s.serials.length; else rest.chests += s.serials.length;
  }
  return { rows, rest };
}
// The inverse of `project` at height z (house-relative tiles, fractional): which point of the floor a point on screen shows.
export function unproject([px, py]: Pt, z: number, view: View): Pt {
  if (view === "top") return [px / W, py / W];
  const sum = ((py + z * K) * 2) / W, diff = (px * 2) / W;
  return [(sum + diff) / 2, (sum - diff) / 2];
}
// The world tile under a point of the drawing, on the level's floor.
export function tileAt(m: HouseModel, p: Pt, view: View): Tile {
  const [x, y] = unproject(p, 0, view);
  return [Math.floor(x) + m.x0, Math.floor(y) + m.y0];
}
export const rectOf = (a: Tile, b: Tile): AreaRect => ({ x0: Math.min(a[0], b[0]), y0: Math.min(a[1], b[1]), x1: Math.max(a[0], b[0]), y1: Math.max(a[1], b[1]) });
export const sizeText = (r: AreaRect): string => { const w = r.x1 - r.x0 + 1, h = r.y1 - r.y0 + 1; return `${w} × ${h} = ${plural(w * h, "tile")}`; };
// Every tile the rectangles cover, each once, by row.
export function unionTiles(rects: readonly AreaRect[]): Tile[] {
  const seen = new Set<string>(), out: Tile[] = [];
  for (const r of rects) for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) { const k = `${x}:${y}`; if (!seen.has(k)) { seen.add(k); out.push([x, y]); } }
  return out.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
}
// The level's floor and stair cells the rectangles cover: what a drawn area (or one being drawn) tints.
export const coveredCells = (m: HouseModel, level: number, rects: readonly AreaRect[]): Cell[] => m.cells.filter((c) => c.level === level && (c.kind === "floor" || c.kind === "stair") && inRects(rects, c.x, c.y));
// The union's outline: the tile edges with the union on one side only, joined where they run on in a line, as segments between tile corners (world tiles).
export function outlineOf(rects: readonly AreaRect[]): Array<[Pt, Pt]> {
  const tiles = unionTiles(rects), has = new Set(tiles.map(([x, y]) => `${x}:${y}`)), on = (x: number, y: number): boolean => has.has(`${x}:${y}`);
  const rows = new Map<string, number[]>(), cols = new Map<string, number[]>();   // "y:side" → the x of each edge, "x:side" → the y
  const add = (m: Map<string, number[]>, k: string, v: number): void => { const l = m.get(k); if (l) l.push(v); else m.set(k, [v]); };
  for (const [x, y] of tiles) {
    if (!on(x, y - 1)) add(rows, `${y}:n`, x);
    if (!on(x, y + 1)) add(rows, `${y + 1}:s`, x);
    if (!on(x - 1, y)) add(cols, `${x}:w`, y);
    if (!on(x + 1, y)) add(cols, `${x + 1}:e`, y);
  }
  const runs = (vs: number[]): Array<[number, number]> => {
    const out: Array<[number, number]> = [];
    for (const v of [...vs].sort((a, b) => a - b)) { const last = out[out.length - 1]; if (last && last[1] === v) last[1] = v + 1; else out.push([v, v + 1]); }
    return out;
  };
  const segs: Array<[Pt, Pt]> = [];
  for (const [k, xs] of rows) { const y = Number(k.split(":")[0]); for (const [a, b] of runs(xs)) segs.push([[a, y], [b, y]]); }
  for (const [k, ys] of cols) { const x = Number(k.split(":")[0]); for (const [a, b] of runs(ys)) segs.push([[x, a], [x, b]]); }
  return segs.sort((a, b) => a[0][1] - b[0][1] || a[0][0] - b[0][0] || a[1][1] - b[1][1] || a[1][0] - b[1][0]);
}
// An area's pieces: its tiles split where they do not touch (4-neighbour), each piece by row, the pieces in the order of their first tile.
export function piecesOf(rects: readonly AreaRect[]): Tile[][] {
  const tiles = unionTiles(rects), left = new Map(tiles.map((t) => [`${t[0]}:${t[1]}`, t])), out: Tile[][] = [];
  for (const start of tiles) {
    if (!left.delete(`${start[0]}:${start[1]}`)) continue;
    const piece: Tile[] = [], todo = [start];
    while (todo.length) {
      const [x, y] = todo.pop()!;
      piece.push([x, y]);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) { const k = `${x + dx}:${y + dy}`, n = left.get(k); if (n) { left.delete(k); todo.push(n); } }
    }
    out.push(piece.sort((a, b) => a[1] - b[1] || a[0] - b[0]));
  }
  return out;
}
// A piece's front corner, where its label goes: the tile nearest the viewer at the game angle (the largest x + y); of several, the middle one along that row (by x).
export function frontCorner(tiles: readonly Tile[]): Tile {
  const top = Math.max(...tiles.map((t) => t[0] + t[1])), row = tiles.filter((t) => t[0] + t[1] === top).sort((a, b) => a[0] - b[0]);
  return row[Math.floor((row.length - 1) / 2)]!;
}
// A label's text: the whole name when it fits `maxW` screen px with the pill's padding and border (16 px), else the longest start of it, cut at a space's end, with "…" that fits; null (a dot) when fewer than 3 characters would fit. `measure` gives a text's width in px.
export const LABEL_FIT = 0.92, LABEL_PAD = 16;
export function fitLabel(name: string, maxW: number, measure: (text: string) => number): string | null {
  if (measure(name) + LABEL_PAD <= maxW) return name;
  let lo = 0, hi = name.length;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (measure(`${name.slice(0, mid).trimEnd()}…`) + LABEL_PAD <= maxW) lo = mid; else hi = mid - 1; }
  return lo >= 3 ? `${name.slice(0, lo).trimEnd()}…` : null;
}
// Where a pill goes on the map pane (px from its top left): centred on the anchor, sitting `lift` px below it at its foot (a dot: centred on it). An anchor outside the pane hides the pill and is left as it is. Otherwise the whole pill stays MARGIN px inside the pane, its top at least MARGIN down, and clear of `avoid` (the zoom buttons' box): a pill that would overlap it moves left of it.
export const PILL_MARGIN = 8;
export interface PillBox { left: number; top: number; hidden: boolean }
export function placePill(anchor: { x: number; y: number }, size: { w: number; h: number }, pane: { w: number; h: number }, lift: number, dot: boolean, avoid: { x0: number; y0: number; x1: number; y1: number } | null): PillBox {
  let left = anchor.x - size.w / 2, top = dot ? anchor.y - size.h / 2 : anchor.y + lift - size.h;
  if (anchor.x < 0 || anchor.y < 0 || anchor.x > pane.w || anchor.y > pane.h) return { left, top, hidden: true };
  const m = PILL_MARGIN, clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(v, hi));
  left = clamp(left, m, pane.w - m - size.w);
  top = clamp(top, m, pane.h - m - size.h);
  if (avoid && left + size.w > avoid.x0 - m && left < avoid.x1 + m && top < avoid.y1 + m && top + size.h > avoid.y0 - m) left = Math.max(m, avoid.x0 - m - size.w);
  return { left, top, hidden: false };
}
// A pill per piece of each area on the level: anchored at the middle of the piece's front corner tile on the floor (drawing units), with the piece's width as drawn (the label fits LABEL_FIT of it on screen).
export interface AreaPill { id: string; name: string; color: string; anchor: Pt; span: number }
export function pillsOf(m: HouseModel, areas: readonly HouseArea[], level: number, view: View): AreaPill[] {
  const out: AreaPill[] = [];
  for (const a of areas) {
    if (a.level !== level) continue;
    for (const piece of piecesOf(a.rects)) {
      const [fx, fy] = frontCorner(piece);
      let lo = Infinity, hi = -Infinity;
      for (const [x, y] of piece) for (const [dx, dy] of CORNERS) { const px = project(x - m.x0 + dx, y - m.y0 + dy, 0, view)[0]; if (px < lo) lo = px; if (px > hi) hi = px; }
      out.push({ id: a.id, name: a.name, color: a.color, anchor: project(fx - m.x0 + 0.5, fy - m.y0 + 0.5, 0, view), span: hi - lo });
    }
  }
  return out;
}
// A new area's id ("a1", "a2", … the first not taken) and colour (the first of the palette no area uses, else round again).
export function nextAreaId(areas: readonly Pick<HouseArea, "id">[]): string {
  const ids = new Set(areas.map((a) => a.id));
  for (let i = 1; ; i++) if (!ids.has(`a${i}`)) return `a${i}`;
}
export function nextAreaColor(areas: readonly Pick<HouseArea, "color">[]): string {
  return AREA_COLORS.find((c) => !areas.some((a) => a.color === c)) ?? AREA_COLORS[areas.length % AREA_COLORS.length]!;
}
// A tile kept within the house's bounds and AREA_MARGIN around them, where the server takes a rectangle.
type Bounds = Pick<HouseModel, "x0" | "y0" | "x1" | "y1">;
export function clampTile(m: Bounds, [x, y]: Tile): Tile {
  const clamp = (v: number, lo: number, hi: number): number => Math.max(lo - AREA_MARGIN, Math.min(hi + AREA_MARGIN, v));
  return [clamp(x, m.x0, m.x1), clamp(y, m.y0, m.y1)];
}
// The drawing cursor's move for an arrow key, as the key points on screen; null for any other key. Top-down, screen and world axes coincide: up is y − 1, right x + 1. At the game angle a tile's screen row is x + y and its screen column x − y (always of the same parity): ← and → move a whole tile sideways (column ∓ 2, so x ∓ 1 and y ± 1); ↑ and ↓ move half a tile up or down (row ∓ 1), so the column must change by one, to the odd column beside an even one and back (the column pair it stays in): a straight line up or down the screen, every tile reachable, and ↓ undoing ↑.
export function moveCursor(m: Bounds, [x, y]: Tile, key: string, view: View = "angle"): Tile | null {
  if (view === "top") {
    const step = ({ ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] } as Record<string, Tile>)[key];
    return step ? clampTile(m, [x + step[0], y + step[1]]) : null;
  }
  let r = x + y, c = x - y;
  if (key === "ArrowLeft") c -= 2;
  else if (key === "ArrowRight") c += 2;
  else if (key === "ArrowUp" || key === "ArrowDown") { r += key === "ArrowUp" ? -1 : 1; c += c % 2 === 0 ? 1 : -1; }
  else return null;
  return clampTile(m, [(r + c) / 2, (r - c) / 2]);
}

// ---------------------------------------------------------------- keyboard
export type Dir = "up" | "down" | "left" | "right";
const DIRS: Record<Dir, Pt> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
// The candidate nearest `from` that way on screen, a sideways step counting double; null when nothing lies that way.
export function nearestInDirection(from: Pt, cands: ReadonlyArray<{ id: string; at: Pt }>, dir: Dir): string | null {
  const [ux, uy] = DIRS[dir];
  let best: { id: string; score: number } | null = null;
  for (const c of cands) {
    const dx = c.at[0] - from[0], dy = c.at[1] - from[1];
    const along = dx * ux + dy * uy, across = Math.abs(dx * uy - dy * ux);
    if (along <= 0.5) continue;
    const score = along + 2 * across;
    if (!best || score < best.score) best = { id: c.id, score };
  }
  return best?.id ?? null;
}

// ---------------------------------------------------------------- the plain grid
// Ground chests no drawn house holds (no captured house lists their serial), as a house of their own: grouped by facet and by distance (a chest within 8 tiles of a group joins it), each group an area of its own (read-only, named "<facet>, group <n>", its bounding box) of plain floor tiles one tile around each chest, on its own floor (its lowest chest), the groups laid side by side 3 tiles apart in rows about 40 tiles wide. Stacks are numbered 1, 2, …, and a chest's code is its stack's number and height ("3.2"). Null when there is no such chest.
const CLUSTER = 8, GAP = 3, ROW = 40;
export type PlainModel = HouseModel & { areas: HouseArea[] };
// A ground container with a place of its own: what the plain grid draws when no drawn house holds it.
const onTheGround = (c: Pick<Container, "parent" | "kind" | "pos">): boolean => c.parent == null && c.kind === "ground" && !!c.pos && Number.isFinite(c.pos.x) && Number.isFinite(c.pos.y);
export function plainGrid(inv: Pick<InventoryData, "containers">, houses: readonly HouseModel[]): PlainModel | null {
  const housed = new Set<number>();
  for (const h of houses) { for (const s of h.stacks) for (const serial of s.serials) housed.add(serial); for (const serial of Object.keys(h.codes)) housed.add(+serial); }
  const chests = Object.values(inv.containers).flatMap((c) => {
    const p = c.pos, facet = p?.facet ?? null;
    return onTheGround(c) && !housed.has(+c.serial)
      ? [{ serial: +c.serial, facet, x: p!.x!, y: p!.y!, z: p!.z ?? 0 }] : [];
  }).sort((a, b) => (a.facet ?? -1) - (b.facet ?? -1) || a.y - b.y || a.x - b.x || a.z - b.z || a.serial - b.serial);
  if (!chests.length) return null;
  let groups: Array<typeof chests> = [];
  for (const c of chests) {
    const near = groups.filter((g) => g[0]!.facet === c.facet && g.some((o) => Math.max(Math.abs(o.x - c.x), Math.abs(o.y - c.y)) <= CLUSTER));
    groups = [...groups.filter((g) => !near.includes(g)), [...near.flat(), c]];
  }
  groups = groups.map((g) => [...g].sort((a, b) => a.y - b.y || a.x - b.x || a.z - b.z || a.serial - b.serial))
    .sort((a, b) => (a[0]!.facet ?? -1) - (b[0]!.facet ?? -1) || a[0]!.y - b[0]!.y || a[0]!.x - b[0]!.x);
  const cells: Cell[] = [], areas: HouseArea[] = [], stacks: Stack[] = [], codes: Record<string, string> = {};
  let cx = 0, cy = 0, rowH = 0, x1 = 0, y1 = 0;
  groups.forEach((g, i) => {
    let gx0 = Infinity, gy0 = Infinity, gx1 = -Infinity, gy1 = -Infinity, z = Infinity;
    for (const c of g) { gx0 = Math.min(gx0, c.x - 1); gy0 = Math.min(gy0, c.y - 1); gx1 = Math.max(gx1, c.x + 1); gy1 = Math.max(gy1, c.y + 1); z = Math.min(z, c.z); }
    const w = gx1 - gx0 + 1, h = gy1 - gy0 + 1;
    if (cx > 0 && cx + w > ROW) { cx = 0; cy += rowH + GAP; rowH = 0; }
    const ox = cx - gx0, oy = cy - gy0, tiles = new Set<string>();
    for (const c of g) for (let y = c.y - 1; y <= c.y + 1; y++) for (let x = c.x - 1; x <= c.x + 1; x++) {
      if (tiles.has(`${x}:${y}`)) continue;
      tiles.add(`${x}:${y}`);
      cells.push({ level: 0, x: x + ox, y: y + oy, kind: "floor", material: "", family: "neutral", z: 0, lip: false, indoor: true, doorway: false });
    }
    areas.push({ id: `g${i + 1}`, name: `${facetName(g[0]!.facet)}, group ${i + 1}`, level: 0, color: AREA_COLORS[i % AREA_COLORS.length]!, rects: [{ x0: gx0 + ox, y0: gy0 + oy, x1: gx1 + ox, y1: gy1 + oy }] });
    const byTile = new Map<string, Stack>();
    for (const c of g) {
      let s = byTile.get(`${c.x}:${c.y}`);
      if (!s) { s = { level: 0, x: c.x + ox, y: c.y + oy, serials: [], zs: [], spot: null, direction: "", letter: "" }; byTile.set(`${c.x}:${c.y}`, s); stacks.push(s); }
      s.serials.push(c.serial); s.zs.push(c.z - z);
    }
    x1 = Math.max(x1, gx1 + ox); y1 = Math.max(y1, gy1 + oy);
    cx += w + GAP; rowH = Math.max(rowH, h);
  });
  stacks.forEach((s, i) => {
    s.letter = String(i + 1);
    s.serials.forEach((serial, h) => { codes[String(serial)] = s.serials.length === 1 ? s.letter : `${s.letter}.${h + 1}`; });
  });
  return { id: PLAIN, facet: null, capturedAt: "", captures: 0, x0: 0, y0: 0, x1, y1,
    levels: [{ index: 0, name: "Containers on the ground", floorZ: 0, status: "floor-only" }], cells, areas, furniture: [], stacks, spots: [], codes, tiledata: false, unopened: [], unopenedNames: {} };
}

// ---------------------------------------------------------------- search on the map, and the links to it (issue #10)
// The route: #/map/<house>?q=<query>&select=<container serial>, the query trimmed (the server lower-cases it), `select` a stack to open on (by a container in it). Other routes' parts after "?" are not the map's.
export interface MapRoute { house: string | null; q: string; select: number | null }
export function parseMapHash(hash: string): MapRoute {
  const body = hash.replace(/^#\/?/, ""), at = body.indexOf("?");
  const parts = (at < 0 ? body : body.slice(0, at)).split("/").filter(Boolean), sp = new URLSearchParams(at < 0 ? "" : body.slice(at + 1));
  let house: string | null = null;
  if (parts[0] === "map" && parts[1]) { try { house = decodeURIComponent(parts[1]); } catch { house = parts[1]; } }
  const sel = sp.get("select");
  return { house, q: (sp.get("q") ?? "").trim(), select: sel && /^\d{1,10}$/.test(sel) ? Number(sel) : null };
}
export function mapHash(r: Partial<MapRoute>): string {
  const sp = new URLSearchParams();
  if (r.q?.trim()) sp.set("q", r.q.trim());
  if (r.select != null) sp.set("select", String(r.select));
  const qs = sp.toString();
  return `#/map${r.house ? `/${encodeURIComponent(r.house)}` : ""}${qs ? `?${qs}` : ""}`;
}
// The container on the floor an item is in: up the containers it sits in to the one with no parent, so a bag in a bag in a chest counts for the chest. An item in a container the scans never listed (or in a cycle) counts for its scan root; one worn, or in nothing, for none.
type Tree = Readonly<Record<string, Pick<Container, "parent">>>;
export function floorContainerOf(it: Pick<Item, "root" | "container">, containers: Tree): number | null {
  let cur = it.container ?? it.root;
  const seen = new Set<number>();
  while (cur != null && !seen.has(cur)) {
    seen.add(cur);
    const c = containers[String(cur)];
    if (!c) break;
    if (c.parent == null) return cur;
    cur = c.parent;
  }
  return it.root ?? null;
}
// Where a container stands in its stack, counted from the floor (index 0 is the bottom one).
const ordinal = (n: number): string => { const t = n % 100; return `${n}${t >= 11 && t <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th"}`; };
export function positionWords(index: number, count: number): string {
  if (count <= 1) return "On its own";
  if (index <= 0) return "Bottom";
  if (index >= count - 1) return "Top";
  return `${ordinal(index + 1)} from bottom`;
}
// A query's matches in a house: each matching container (in the house's stack order, top first within a stack) with its height in the stack and its matching items by name (amounts added up, in name order, the first of each name standing for it in a tooltip); each stack's matching containers; the matches' total amount; and the matches outside the house.
export interface HitLine { name: string; amount: number; item: Item }
export interface HitChest { serial: number; stack: Stack; index: number; position: string; amount: number; lines: HitLine[] }
export interface HouseHits { chests: HitChest[]; stacks: Map<string, HitChest[]>; serials: Set<number>; amount: number; outside: Item[] }
const amountOf = (it: Pick<Item, "amount">): number => it.amount || 1;
export function houseHits(m: HouseModel, items: readonly Item[], containers: Tree): HouseHits {
  const where = new Map<number, { stack: Stack; index: number; order: number }>();
  m.stacks.forEach((stack, order) => stack.serials.forEach((serial, index) => where.set(serial, { stack, index, order })));
  const by = new Map<number, Item[]>(), outside: Item[] = [];
  for (const it of items) {
    const f = floorContainerOf(it, containers);
    if (f == null || !where.has(f)) { outside.push(it); continue; }
    const list = by.get(f);
    if (list) list.push(it); else by.set(f, [it]);
  }
  const chests = [...by].map(([serial, list]): HitChest & { order: number } => {
    const { stack, index, order } = where.get(serial)!, names = new Map<string, HitLine>();
    for (const it of list) { const l = names.get(it.name); if (l) l.amount += amountOf(it); else names.set(it.name, { name: it.name, amount: amountOf(it), item: it }); }
    return { serial, stack, index, order, position: positionWords(index, stack.serials.length), amount: list.reduce((a, it) => a + amountOf(it), 0), lines: [...names.values()].sort((a, b) => a.name.localeCompare(b.name)) };
  }).sort((a, b) => a.order - b.order || b.index - a.index).map(({ order: _, ...c }): HitChest => c);
  const stacks = new Map<string, HitChest[]>();
  for (const c of chests) { const l = stacks.get(c.stack.letter); if (l) l.push(c); else stacks.set(c.stack.letter, [c]); }
  return { chests, stacks, serials: new Set(chests.map((c) => c.serial)), amount: chests.reduce((a, c) => a + c.amount, 0), outside };
}
// While searching, a level's counts for the left pane: how many of its containers match, in each of its areas (by id) and in the rest.
export interface Tally { matches: number; containers: number }
export function levelHits(m: HouseModel, areas: readonly HouseArea[], level: number, hit: ReadonlySet<number>): Tally & { areas: Map<string, Tally>; rest: Tally } {
  const out = { matches: 0, containers: 0, areas: new Map<string, Tally>(areas.filter((a) => a.level === level).map((a) => [a.id, { matches: 0, containers: 0 }])), rest: { matches: 0, containers: 0 } };
  for (const s of m.stacks) {
    if (s.level !== level) continue;
    const a = areaOfStack(areas, s), t = (a && out.areas.get(a.id)) || out.rest, n = s.serials.filter((x) => hit.has(x)).length;
    t.matches += n; t.containers += s.serials.length; out.matches += n; out.containers += s.serials.length;
  }
  return out;
}
export const levelHitText = (t: Tally): string => (t.matches ? `${fmtCount(t.matches)} of ${plural(t.containers, "container")} match` : "no matches");
export const areaHitText = (t: Tally): string => (t.matches ? `${fmtCount(t.matches)} of ${fmtCount(t.containers)}` : "–");
export const hitsSummary = (amount: number, containers: number): string => `${plural(amount, "item")} in ${plural(containers, "container")}`;
export const searchCount = (amount: number, containers: number): string => `${fmtCount(amount)} in ${fmtCount(containers)}`;
const fmtCount = (n: number): string => n.toLocaleString("en-US");
// A pinned callout's heading: the stack, and how many of its containers match ("1 container" for a stack of one).
export const calloutHead = (s: Pick<Stack, "letter" | "serials">, matches: number): { title: string; count: string } => ({ title: `Stack ${s.letter}`, count: s.serials.length > 1 ? `${matches} of ${s.serials.length} match` : "1 container" });
// The pinned callouts sit in one row across the map pane (px), in their stacks' left-to-right order, so no two leaders cross: as many as fit at least CALLOUT_MIN px wide, up to `max` (the stacks given first win, the rest are a "+N more stacks" chip at the row's end), each at most CALLOUT_W wide, the row centred over its stacks and kept `margin` px inside the pane, clear of the zoom buttons on the right (`reserve`). Each leader leaves its card's foot over its stack, at least 16 px in from the card's sides.
export const CALLOUT_W = 248, CALLOUT_MIN = 150, CALLOUT_MAX = 3;
export interface CalloutSlot { id: string; left: number; width: number; leaderX: number }
export function calloutRow(anchors: ReadonlyArray<{ id: string; x: number }>, paneW: number, { max = CALLOUT_MAX, gap = 8, margin = 12, reserve = 52, chipW = 120 }: { max?: number; gap?: number; margin?: number; reserve?: number; chipW?: number } = {}): { cards: CalloutSlot[]; more: { left: number; width: number; count: number } | null } {
  const room = Math.max(0, paneW - 2 * margin - reserve);
  const fits = (k: number): boolean => k * CALLOUT_MIN + (k - 1) * gap + (k < anchors.length ? chipW + gap : 0) <= room;
  let k = Math.min(max, anchors.length);
  while (k > 1 && !fits(k)) k--;
  if (!anchors.length) return { cards: [], more: null };
  const shown = anchors.slice(0, k).sort((a, b) => a.x - b.x), rest = anchors.length - k, chip = rest ? chipW + gap : 0;
  const width = Math.max(1, Math.min(CALLOUT_W, (room - chip - (k - 1) * gap) / k)), rowW = k * width + (k - 1) * gap + chip;
  const mid = shown.reduce((a, s) => a + s.x, 0) / k;
  const left0 = Math.max(margin, Math.min(mid - rowW / 2, margin + room - rowW));
  const cards = shown.map((a, i): CalloutSlot => { const left = left0 + i * (width + gap); return { id: a.id, left, width, leaderX: Math.max(left + Math.min(16, width / 2), Math.min(left + width - Math.min(16, width / 2), a.x)) }; });
  return { cards, more: rest ? { left: left0 + k * (width + gap), width: chipW, count: rest } : null };
}
// The view a search zooms to: the matching stacks as drawn, at least 8 tiles across and 6 high, with as much again above them for the callouts (`room`; without it, as "Show on map" zooms to one stack, they are in the middle).
export function hitsView(m: HouseModel, stacks: readonly Stack[], view: View, room = true): Box {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of stacks) {
    const base = m.levels[s.level]?.floorZ ?? 0, top = (drawnZs(s, base).at(-1) ?? 0) + CHEST_H;
    for (const [dx, dy] of CORNERS) for (const z of [0, top]) {
      const [px, py] = project(s.x - m.x0 + dx, s.y - m.y0 + dy, z, view);
      x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py);
    }
  }
  if (x0 === Infinity) return boundsOf(m, 0, view);
  const w = Math.max(x1 - x0 + 2 * W, 8 * W), h = Math.max(y1 - y0 + 2 * W, 6 * W), cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  return room ? { x: cx - w / 2, y: cy - h / 2 - h, w, h: 2 * h } : { x: cx - w / 2, y: cy - h / 2, w, h };
}
// Which house holds each container, by serial: the houses' stacks (GET /api/houses lists each house's container serials), and every other ground container with a place of its own on the plain grid. What "Show on map" and the search's "Elsewhere" go by.
export interface HouseRef { id: string; name: string }
export function houseIndex(houses: ReadonlyArray<Pick<HouseModel, "id" | "facet"> & { name?: string | undefined; serials: readonly number[] }>, containers: Readonly<Record<string, Pick<Container, "parent" | "kind" | "pos">>>): Map<number, HouseRef> {
  const out = new Map<number, HouseRef>();
  for (const h of houses) { const ref = { id: h.id, name: houseName(h) }; for (const s of h.serials) out.set(s, ref); }
  const plain = { id: PLAIN, name: houseName({ id: PLAIN, facet: null }) };
  for (const [key, c] of Object.entries(containers)) if (!out.has(+key) && onTheGround(c)) out.set(+key, plain);
  return out;
}
// The matches outside the house shown: those in another house (by house, linked from the note) and those anywhere else (by place: a backpack, a bank, a container on no map), each by its total amount, the most first.
export interface Elsewhere { amount: number; houses: Array<HouseRef & { amount: number }>; places: Array<{ name: string; amount: number }> }
const placeOf = (it: Item): string => it.location?.text.split(" › ")[0]?.trim() || "an unknown place";
export function elsewhereOf(items: readonly Item[], index: ReadonlyMap<number, HouseRef>, containers: Tree, here: string | null): Elsewhere {
  const houses = new Map<string, HouseRef & { amount: number }>(), places = new Map<string, number>();
  let amount = 0;
  for (const it of items) {
    const f = floorContainerOf(it, containers), h = f == null ? undefined : index.get(f);
    if (h?.id === here) continue;
    amount += amountOf(it);
    if (h) { const e = houses.get(h.id); if (e) e.amount += amountOf(it); else houses.set(h.id, { ...h, amount: amountOf(it) }); }
    else places.set(placeOf(it), (places.get(placeOf(it)) ?? 0) + amountOf(it));
  }
  const most = <T extends { name: string; amount: number }>(l: T[]): T[] => l.sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name));
  return { amount, houses: most([...houses.values()]), places: most([...places].map(([name, n]) => ({ name, amount: n }))) };
}
// The panel's line about them: "3 more outside this house (Another house, Ann's backpack, and 1 more place)."
export function outsideText(e: Elsewhere): string {
  const names = [...e.houses, ...e.places].map((x) => x.name), rest = names.length - 2;
  return `${fmtCount(e.amount)} more outside this house (${names.slice(0, 2).join(", ")}${rest > 0 ? `, and ${plural(rest, "more place")}` : ""}).`;
}

// ---------------------------------------------------------------- the scene of one level
// What ui/house-map.mts draws for a level, in drawing units: the walls of the level below as faint tiles (on an upper level), the floor and stair tiles (with step bands; uncovered ground-level floor is the yard), each standing spot's dashed reach, then every solid thing back to front: cut walls and windows and the foundation's lip in their material's colour (w-<family>), the ground level's plinth (with front steps, the outward sides of its edge tiles run down to the lowest step, at the game angle), stairs (at the game angle, raised to meet the tile they lead to; from above they stay tiles), roof edges, furniture, doors and teleporters, the stacks (one box per chest at its real height, lifted clear of one below it that shares its z) and the standing spots' figures.
export interface Prism { top: string; left: string; right: string }
export type Piece =
  | { kind: "solid"; x: number; y: number; z: number; cls: string; prism: Prism; steps?: string[] }
  | { kind: "item"; x: number; y: number; z: number; cls: string; prism: Prism; name: string }
  | { kind: "stack"; x: number; y: number; z: number; stack: Stack; chests: Array<{ serial: number; prism: Prism }> }
  | { kind: "spot"; x: number; y: number; z: number; spot: Spot; at: Pt };
export interface Scene { below: string[]; floors: Array<{ pts: string; cls: string }>; reach: string[]; pieces: Piece[] }
const REACH = 2;
function prism(x: number, y: number, z: number, h: number, view: View, inset: number): Prism {
  const f = boxFaces(x, y, z, h, view, inset);
  return { top: pts(f.top), left: pts(f.left), right: pts(f.right) };
}
// A band of a tile across x (or across y), from a to b (fractions of the tile): a stair's steps.
const band = (x: number, y: number, z: number, view: View, a: number, b: number, acrossY: boolean): Pt[] => acrossY
  ? [project(x, y + a, z, view), project(x + 1, y + a, z, view), project(x + 1, y + b, z, view), project(x, y + b, z, view)]
  : [project(x + a, y, z, view), project(x + b, y, z, view), project(x + b, y + 1, z, view), project(x + a, y + 1, z, view)];
// A stair rises to the highest floor, lip or stair tile beside it on its level that is above it by at most STAIR_RISE (the first of north, east, south, west on a tie), its steps running across that way; with none it lies flat, its steps across x.
const STAIR_RISE = 20;
const SIDES: ReadonlyArray<[number, number, boolean]> = [[0, -1, true], [1, 0, false], [0, 1, true], [-1, 0, false]];
function stairTop(c: Cell, heights: ReadonlyMap<string, number>): { z: number; acrossY: boolean } {
  let z = c.z, acrossY = false;
  for (const [dx, dy, ay] of SIDES) {
    const n = heights.get(`${c.x + dx}:${c.y + dy}`);
    if (n != null && n > z && n - c.z <= STAIR_RISE) { z = n; acrossY = ay; }
  }
  return { z, acrossY };
}
// The highest floor or stair z on each tile of a level, by "x:y".
function heightsOf(m: HouseModel, level: number): Map<string, number> {
  const out = new Map<string, number>();
  for (const c of m.cells) if (c.level === level && (c.kind === "floor" || c.kind === "stair")) { const k = `${c.x}:${c.y}`; out.set(k, Math.max(c.z, out.get(k) ?? -Infinity)); }
  return out;
}
// The plinth is one material: the most common family among the ground level's lip tiles (ties by name), else neutral (the plain lip colour).
function plinthFamily(m: HouseModel): string {
  const n = new Map<string, number>();
  for (const c of m.cells) if (c.level === 0 && c.lip) n.set(c.family, (n.get(c.family) ?? 0) + 1);
  return [...n].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))[0]?.[0] ?? "neutral";
}
// The ground level stands on a plinth down to its lowest stair (its front steps), above its floor; null on an upper level or with no stairs.
function plinthBase(m: HouseModel, level: number, base: number): number | null {
  if (level !== 0) return null;
  let lo = Infinity;
  for (const c of m.cells) if (c.level === 0 && c.kind === "stair") lo = Math.min(lo, c.z);
  return lo === Infinity ? null : lo - base;
}
// A cell's piece of the plinth, up to the cell's bottom: its south (left) and east (right) sides where the tile beyond faces outward (no cell of the level there, or a floor or stair below the level's floor; a wall never does), each down to that tile's height (the plinth's foot where there is none), so a sunken floor inside the house reads as a pit. Only cells standing at or above the floor get one; null for a cell without, and no function at all with no plinth. Known limit: each tile draws only its own sides, so at a notch in the footprint the wedge where two edges meet is not filled.
type PlinthPiece = { lo: number; hi: number; s: number | null; e: number | null };
function plinthOf(m: HouseModel, level: number, base: number, heights: ReadonlyMap<string, number>): ((c: Cell) => PlinthPiece | null) | null {
  const foot = plinthBase(m, level, base);
  if (foot == null) return null;
  const here = new Set<string>();
  for (const c of m.cells) if (c.level === level) here.add(`${c.x}:${c.y}`);
  // How deep the side facing (x, y) runs, or null when that tile is not outward.
  const depth = (x: number, y: number): number | null => { const k = `${x}:${y}`, h = heights.get(k); return !here.has(k) ? foot : h != null && h - base < 0 ? Math.max(foot, h - base) : null; };
  return (c) => {
    if (c.kind === "stair") return null;
    const bottom = c.kind === "floor" ? c.z - base : 0;
    if (bottom < 0) return null;
    const side = (x: number, y: number): number | null => { const d = depth(x, y); return d != null && d < bottom ? d : null; };
    const s = side(c.x, c.y + 1), e = side(c.x + 1, c.y);
    return s != null || e != null ? { lo: Math.min(s ?? Infinity, e ?? Infinity), hi: bottom, s, e } : null;
  };
}
export function sceneOf(m: HouseModel, level: number, view: View): Scene {
  const base = m.levels[level]?.floorZ ?? 0;
  const below: string[] = [], floors: Scene["floors"] = [], reach: string[] = [], solids: Piece[] = [];
  const heights = heightsOf(m, level), plinth = view === "angle" ? plinthOf(m, level, base, heights) : null;
  const plinthCls = plinth ? `map-plinth w-${plinthFamily(m)}` : "";
  for (const c of m.cells) {
    const x = c.x - m.x0, y = c.y - m.y0;
    if (level > 0 && c.level === level - 1 && (c.kind === "wall" || c.kind === "window")) below.push(pts(tilePolygon(x, y, c.z - base, view)));
    if (c.level !== level) continue;
    const pp = plinth?.(c);
    if (pp) solids.push({ kind: "solid", x, y, z: pp.lo, cls: plinthCls, prism: { top: "",
      left: pp.s != null ? pts(boxFaces(x, y, pp.s, pp.hi - pp.s, view).left) : "", right: pp.e != null ? pts(boxFaces(x, y, pp.e, pp.hi - pp.e, view).right) : "" } });
    if (c.kind === "floor" || c.kind === "stair") {
      const z = c.z - base, top = c.kind === "stair" ? stairTop(c, heights) : null, tz = top ? top.z - base : z;
      const steps = top ? [1, 3].map((k) => pts(band(x, y, tz, view, k / 4, (k + 1) / 4, top.acrossY))) : [];
      // At the game angle every stair is a solid in back-to-front order (a flat one is a top only), so a step in front is never painted over by the one behind it.
      if (top && view === "angle") solids.push({ kind: "solid", x, y, z, cls: "map-stair", prism: tz > z ? prism(x, y, z, tz - z, view, 0) : { top: pts(tilePolygon(x, y, z, view)), left: "", right: "" }, steps });
      else {
        floors.push({ pts: pts(tilePolygon(x, y, tz, view)), cls: `map-floor f-${c.family}${c.level === 0 && !c.indoor ? " yard" : ""}${top ? " map-stair" : ""}` });
        for (const b of steps) floors.push({ pts: b, cls: "map-step" });
      }
      if (c.lip) solids.push({ kind: "solid", x, y, z, cls: `map-lip w-${c.family}`, prism: prism(x, y, z, LIP_H, view, 0) });
    } else if (c.kind === "roof") solids.push({ kind: "solid", x, y, z: 0, cls: "map-roof", prism: prism(x, y, 0, ROOF_H, view, 0) });
    else solids.push({ kind: "solid", x, y, z: 0, cls: `map-wall${c.kind === "window" ? " window" : ""} w-${c.family}`, prism: prism(x, y, 0, c.kind === "window" ? WINDOW_H : WALL_H, view, 0.08) });
  }
  for (const f of m.furniture) {
    if (f.level !== level) continue;
    const x = f.x - m.x0, y = f.y - m.y0, z = f.z - base;
    if (f.kind === "block") solids.push({ kind: "item", x, y, z, cls: "map-block", prism: prism(x, y, z, Math.max(1, f.height), view, 0.15), name: f.name });
    else solids.push({ kind: "item", x, y, z: z + 0.5, cls: f.kind === "door" ? "map-door" : "map-teleporter", prism: { top: pts(tilePolygon(x, y, z + 0.5, view, f.kind === "door" ? 0.3 : 0.15)), left: "", right: "" }, name: f.name });
  }
  for (const s of m.stacks) {
    if (s.level !== level) continue;
    const x = s.x - m.x0, y = s.y - m.y0, zs = drawnZs(s, base);
    solids.push({ kind: "stack", x, y, z: zs[0] ?? 0, stack: s,
      chests: s.serials.map((serial, i) => ({ serial, prism: prism(x, y, zs[i] ?? 0, CHEST_H, view, view === "top" ? Math.min(0.4, 0.12 + 0.06 * i) : 0.18) })) });
  }
  for (const p of m.spots) {
    if (p.level !== level) continue;
    const x = p.x - m.x0, y = p.y - m.y0;
    reach.push(pts([project(x - REACH, y - REACH, 0, view), project(x + REACH + 1, y - REACH, 0, view), project(x + REACH + 1, y + REACH + 1, 0, view), project(x - REACH, y + REACH + 1, 0, view)]));
    solids.push({ kind: "spot", x, y, z: 0, spot: p, at: project(x + 0.5, y + 0.5, 0, view) });
  }
  return { below, floors, reach, pieces: paintOrder(solids) };
}
