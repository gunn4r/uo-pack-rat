// ui/house-map-model.mts — the House map's pure rules (issue #10, spec section 4): the projection (the client's angle, or top-down), the polygons of a tile and of a box, the painter's order, a level's bounds and their fit; below, the joins of a stack with the inventory and the Organize labels, the colour modes, the cut-away, the callout, the totals, the house picker, keyboard moves, the plain grid for chests outside any drawn house, and the scene of one level. No DOM and no store.mts import, so app/ui-map.test.mts runs it under plain node:test; ui/house-map.mts draws what it returns. Coordinates are relative to the house's corner (x0, y0); heights to the level's floor.
import type { HouseModel, Room, Stack } from "./api-types.mts";

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
  for (const c of m.cells) if (c.level === level && inRoom(c.x, c.y)) { const z = c.kind === "floor" || c.kind === "stair" ? c.z - base : 0; add(c.x, c.y, z, z + WALL_H); }
  for (const s of m.stacks) if (s.level === level && inRoom(s.x, s.y)) add(s.x, s.y, 0, (s.zs[s.zs.length - 1] ?? base) - base + CHEST_H);
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
  return project(s.x - m.x0 + 0.5, s.y - m.y0 + 0.5, (s.zs[s.zs.length - 1] ?? base) - base + CHEST_H, view);
}
