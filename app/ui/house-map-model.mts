// ui/house-map-model.mts — the House map's pure rules (issue #10, spec section 4): the projection (the client's angle, or top-down), the polygons of a tile and of a box, the painter's order, a level's bounds and their fit; below, the joins of a stack with the inventory and the Organize labels, the colour modes, the cut-away, the callout, the totals, the house picker, keyboard moves, the plain grid for chests outside any drawn house, and the scene of one level. No DOM and no store.mts import, so app/ui-map.test.mts runs it under plain node:test; ui/house-map.mts draws what it returns. Coordinates are relative to the house's corner (x0, y0); heights to the level's floor.
import { bagLabel } from "../vault-lib.mts";
import { plural, splitSerial } from "./inv-model.mts";
import type { Cell, ContainerLabel, HouseModel, HouseSummary, InventoryData, Room, Spot, Stack, TiledataFrom } from "./api-types.mts";

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
// What a level draws, in drawing units, with a tile's margin: every cell of the level (or of `room`'s bounding box) up to a cut wall's height, and every stack up to its top chest.
export function boundsOf(m: HouseModel, level: number, view: View, room: Room | null = null): Box {
  const base = m.levels[level]?.floorZ ?? 0;
  const inRoom = (x: number, y: number): boolean => !room || (x >= room.x0 && x <= room.x1 && y >= room.y0 && y <= room.y1);
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
  const heights = heightsOf(m, level), foot = plinthBase(m, level, base);
  for (const c of m.cells) if (c.level === level && inRoom(c.x, c.y)) {
    const z = c.kind === "floor" || c.kind === "stair" ? c.z - base : 0, top = c.kind === "stair" ? stairTop(c, heights).z - base : z;
    add(c.x, c.y, foot != null && c.kind !== "stair" ? Math.min(z, foot) : z, top + WALL_H);
  }
  for (const s of m.stacks) if (s.level === level && inRoom(s.x, s.y)) add(s.x, s.y, 0, (drawnZs(s, base).at(-1) ?? 0) + CHEST_H);
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
    : [{ token: null, text: "A labelled chest takes its label's colour." }, { token: "--color-map-chest", text: "Not labelled" }, { token: "--color-map-chest-empty", text: "Not labelled, empty" }, { token: "--color-map-unopened", text: "Not opened yet" }];
}
export const fillWords = (c: ChestView): string => (!c.opened ? "not opened yet" : c.fill ? `${c.fill.items} of ${c.fill.max} items` : "fill unknown");
// Every chest element's accessible name.
export const chestLabel = (c: ChestView): string => `${c.code} ${c.name}, ${fillWords(c)}`;

// ---------------------------------------------------------------- cut-away, callout, totals
// The stacks drawn in front of `focus` on its level (larger x + y, within three tiles each way): they fade and let the pointer through, so the inner rings of a dense room can be reached.
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
export function roomCounts(m: HouseModel): Map<number, number> {
  const out = new Map<number, number>();
  for (const s of m.stacks) if (s.room != null) out.set(s.room, (out.get(s.room) ?? 0) + s.serials.length);
  return out;
}

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
export const houseLabel = (h: HouseSummary): string => `${facetName(h.facet)} house, ${h.width} × ${h.height}, ${plural(h.containers, "container")}`;
export const houseName = (m: HouseModel): string => (m.id === PLAIN ? "Chests on the ground" : `${facetName(m.facet)} house`);
export function stackWhere(m: HouseModel, s: Stack): string {
  const room = m.rooms.find((r) => r.id === s.room)?.name ?? "No room";
  const spot = s.spot == null ? "no standing spot reaches it" : s.direction === "here" ? `at standing spot ${s.spot + 1}` : `${s.direction} of standing spot ${s.spot + 1}`;
  return `${room} · ${spot} · ${plural(s.serials.length, "chest")}${s.serials.length > 1 ? ", top first" : ""}`;
}
// Why the map is drawn in plain colours (GET /api/houses's tiledataFrom.reason), or null when tiledata.mul was read.
export function tiledataNote(reason: TiledataFrom["reason"]): string | null {
  const plain = "so the house is drawn in plain colours, with every impassable tile as a wall";
  switch (reason) {
    case null: return null;
    case "no-client": return `No game client is set up, so Pack Rat has no tiledata.mul to tell walls, floors and materials apart, ${plain}.`;
    case "no-tazuo-profile": return `TazUO's launcher names no UO folder holding a tiledata.mul, ${plain}.`;
    case "override-missing": return `The UO folder set in Settings has no tiledata.mul any more, ${plain}.`;
    case "unreadable": return `The tiledata.mul found is not one Pack Rat can read, ${plain}.`;
  }
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
// Ground chests no drawn house holds (no captured house lists their serial), as a house of their own: grouped by facet and by distance (a chest within 8 tiles of a group joins it), each group a "room" of plain floor tiles one tile around each chest, on its own floor (its lowest chest), the groups laid side by side 3 tiles apart in rows about 40 tiles wide. Stacks are numbered 1, 2, …, and a chest's code is its stack's number and height ("3.2"). Null when there is no such chest.
const CLUSTER = 8, GAP = 3, ROW = 40;
export function plainGrid(inv: Pick<InventoryData, "containers">, houses: readonly HouseModel[]): HouseModel | null {
  const housed = new Set<number>();
  for (const h of houses) { for (const s of h.stacks) for (const serial of s.serials) housed.add(serial); for (const serial of Object.keys(h.codes)) housed.add(+serial); }
  const chests = Object.values(inv.containers).flatMap((c) => {
    const p = c.pos, facet = p?.facet ?? null;
    return c.parent == null && c.kind === "ground" && p && Number.isFinite(p.x) && Number.isFinite(p.y) && !housed.has(+c.serial)
      ? [{ serial: +c.serial, facet, x: p.x!, y: p.y!, z: p.z ?? 0 }] : [];
  }).sort((a, b) => (a.facet ?? -1) - (b.facet ?? -1) || a.y - b.y || a.x - b.x || a.z - b.z || a.serial - b.serial);
  if (!chests.length) return null;
  let groups: Array<typeof chests> = [];
  for (const c of chests) {
    const near = groups.filter((g) => g[0]!.facet === c.facet && g.some((o) => Math.max(Math.abs(o.x - c.x), Math.abs(o.y - c.y)) <= CLUSTER));
    groups = [...groups.filter((g) => !near.includes(g)), [...near.flat(), c]];
  }
  groups = groups.map((g) => [...g].sort((a, b) => a.y - b.y || a.x - b.x || a.z - b.z || a.serial - b.serial))
    .sort((a, b) => (a[0]!.facet ?? -1) - (b[0]!.facet ?? -1) || a[0]!.y - b[0]!.y || a[0]!.x - b[0]!.x);
  const cells: Cell[] = [], rooms: Room[] = [], stacks: Stack[] = [], codes: Record<string, string> = {};
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
      cells.push({ level: 0, x: x + ox, y: y + oy, kind: "floor", material: "", family: "neutral", z: 0, lip: false, indoor: true, doorway: false, room: i });
    }
    rooms.push({ id: i, level: 0, kind: "room", name: `${facetName(g[0]!.facet)}, group ${i + 1}`, tiles: tiles.size, x0: gx0 + ox, y0: gy0 + oy, x1: gx1 + ox, y1: gy1 + oy });
    const byTile = new Map<string, Stack>();
    for (const c of g) {
      let s = byTile.get(`${c.x}:${c.y}`);
      if (!s) { s = { level: 0, x: c.x + ox, y: c.y + oy, room: i, serials: [], zs: [], spot: null, direction: "", letter: "" }; byTile.set(`${c.x}:${c.y}`, s); stacks.push(s); }
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
    levels: [{ index: 0, name: "Chests on the ground", floorZ: 0, status: "floor-only" }], cells, rooms, furniture: [], stacks, spots: [], codes, tiledata: false, unopened: [], unopenedNames: {} };
}

// ---------------------------------------------------------------- the scene of one level
// What ui/house-map.mts draws for a level, in drawing units: the walls of the level below as faint tiles (on an upper level), the floor and stair tiles (with step bands), each standing spot's dashed reach, then every solid thing back to front: cut walls and windows and the foundation's lip in their material's colour (w-<family>), the ground level's plinth (with front steps, the outward sides of its edge tiles run down to the lowest step, at the game angle), stairs (at the game angle, raised to meet the tile they lead to; from above they stay tiles), roof edges, furniture, doors and teleporters, the stacks (one box per chest at its real height, lifted clear of one below it that shares its z) and the standing spots' figures.
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
// The ground level stands on a plinth down to its lowest stair (its front steps), above its floor; null on an upper level or with no stairs.
function plinthBase(m: HouseModel, level: number, base: number): number | null {
  if (level !== 0) return null;
  let lo = Infinity;
  for (const c of m.cells) if (c.level === 0 && c.kind === "stair") lo = Math.min(lo, c.z);
  return lo === Infinity ? null : lo - base;
}
export function sceneOf(m: HouseModel, level: number, view: View): Scene {
  const base = m.levels[level]?.floorZ ?? 0;
  const yard = new Set(m.rooms.filter((r) => r.kind === "yard").map((r) => r.id));
  const below: string[] = [], floors: Scene["floors"] = [], reach: string[] = [], solids: Piece[] = [];
  const heights = heightsOf(m, level), foot = view === "angle" ? plinthBase(m, level, base) : null, kinds = new Map<string, Cell["kind"]>();
  if (foot != null) for (const c of m.cells) if (c.level === level) kinds.set(`${c.x}:${c.y}`, c.kind);
  // A side of the plinth shows where the tile beyond it (south on the left, east on the right) is outside the house or a stair.
  const out = (x: number, y: number): boolean => { const k = kinds.get(`${x}:${y}`); return k == null || k === "stair"; };
  for (const c of m.cells) {
    const x = c.x - m.x0, y = c.y - m.y0;
    if (level > 0 && c.level === level - 1 && (c.kind === "wall" || c.kind === "window")) below.push(pts(tilePolygon(x, y, c.z - base, view)));
    if (c.level !== level) continue;
    const bottom = c.kind === "floor" || c.kind === "stair" ? c.z - base : 0;
    if (foot != null && c.kind !== "stair" && bottom > foot) {
      const s = out(c.x, c.y + 1), e = out(c.x + 1, c.y), f = boxFaces(x, y, foot, bottom - foot, view);
      if (s || e) solids.push({ kind: "solid", x, y, z: foot, cls: `map-plinth w-${c.family}`, prism: { top: "", left: s ? pts(f.left) : "", right: e ? pts(f.right) : "" } });
    }
    if (c.kind === "floor" || c.kind === "stair") {
      const z = c.z - base, top = c.kind === "stair" ? stairTop(c, heights) : null, tz = top ? top.z - base : z;
      const steps = top ? [1, 3].map((k) => pts(band(x, y, tz, view, k / 4, (k + 1) / 4, top.acrossY))) : [];
      // At the game angle every stair is a solid in back-to-front order (a flat one is a top only), so a step in front is never painted over by the one behind it.
      if (top && view === "angle") solids.push({ kind: "solid", x, y, z, cls: "map-stair", prism: tz > z ? prism(x, y, z, tz - z, view, 0) : { top: pts(tilePolygon(x, y, z, view)), left: "", right: "" }, steps });
      else {
        floors.push({ pts: pts(tilePolygon(x, y, tz, view)), cls: `map-floor f-${c.family}${c.room != null && yard.has(c.room) ? " yard" : ""}${top ? " map-stair" : ""}` });
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
