// house-model.mts — a house as the map draws it (issue #10), built from the newest capture of its tiles (app/house-capture.mts), the client's tiledata.mul (app/tiledata.mts; null when it was not found) and the fold's ground containers. Pure. Spec: docs/superpowers/specs/2026-10-01-house-map-design.md, section 3.
import { classify, type TileData, type TileClass } from "./tiledata.mts";
import type { HouseSource } from "./house-capture.mts";

export interface HouseContainerInput { serial: number; name: string; facet: number | null; x: number; y: number; z: number }
export interface Level { index: number; name: string; floorZ: number; status: "built" | "floor-only" }
export type CellKind = "floor" | "wall" | "window" | "stair" | "roof";
export interface Cell { level: number; x: number; y: number; kind: CellKind; material: string; z: number; lip: boolean; indoor: boolean; doorway: boolean; room: number | null }
export interface Room { id: number; level: number; kind: "room" | "yard"; name: string; tiles: number; x0: number; y0: number; x1: number; y1: number }
export interface Furniture { serial: number; kind: "block" | "door" | "teleporter"; name: string; level: number; x: number; y: number; z: number; height: number }
export interface Stack { level: number; x: number; y: number; room: number | null; serials: number[]; spot: number | null; direction: string; letter: string }
export interface Spot { id: number; level: number; x: number; y: number; room: number | null; teleporter: boolean }
export interface HouseModel { id: string; facet: number | null; capturedAt: string; captures: number; x0: number; y0: number; x1: number; y1: number; levels: Level[]; cells: Cell[]; rooms: Room[]; furniture: Furniture[]; stacks: Stack[]; spots: Spot[]; codes: Record<string, string>; tiledata: boolean }

const LEVEL_GAP = 15;
const LEVEL_SLACK = 3;
const MIN_ROOM = 4;
const ORDINALS = ["Ground floor", "2nd floor", "3rd floor", "4th floor", "5th floor", "6th floor"];

interface Classed { cls: TileClass; name: string; z: number }
const key = (level: number, x: number, y: number): string => `${level}:${x}:${y}`;

// Floor z clusters → each level's lowest floor z and most common floor z (ties to the higher z).
function levelsOf(floorZs: number[]): Array<{ lo: number; floorZ: number }> {
  const zs = [...floorZs].sort((a, b) => a - b);
  const groups: number[][] = [];
  for (const z of zs) {
    const g = groups[groups.length - 1];
    if (!g || z - g[g.length - 1]! >= LEVEL_GAP) groups.push([z]); else g.push(z);
  }
  return groups.map((g) => {
    const count = new Map<number, number>();
    for (const z of g) count.set(z, (count.get(z) ?? 0) + 1);
    const floorZ = [...count].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]![0];
    return { lo: g[0]!, floorZ };
  });
}

function compassName(dx: number, dy: number): string {
  const v = dy < -1.5 ? "north" : dy > 1.5 ? "south" : "", h = dx < -1.5 ? "west" : dx > 1.5 ? "east" : "";
  const n = v && h ? `${v}-${h}` : v || h || "middle";
  return n[0]!.toUpperCase() + n.slice(1) + " room";
}

const topOf = (ts: Classed[]): Classed => ts.reduce((a, b) => (b.z > a.z ? b : a));

export function buildHouseModel(house: HouseSource, td: TileData | null, containers: HouseContainerInput[]): HouseModel {
  const classed = house.tiles.map(([graphic, x, y, z, imp]) => {
    const info = td?.info(graphic) ?? null;
    return { x, y, t: { cls: classify(info, imp === 1), name: info?.name ?? "", z } as Classed };
  }).filter((c) => c.t.cls !== "other");
  const floorZs = classed.filter((c) => c.t.cls === "floor" || c.t.cls === "stair").map((c) => c.t.z);
  const bands = levelsOf(floorZs.length ? floorZs : [0]);
  const levelOf = (z: number): number => { let i = 0; bands.forEach((b, j) => { if (b.lo - LEVEL_SLACK <= z) i = j; }); return i; };

  const byCell = new Map<string, { level: number; x: number; y: number; tiles: Classed[] }>();
  for (const c of classed) {
    const level = levelOf(c.t.z), k = key(level, c.x, c.y);
    const e = byCell.get(k) ?? { level, x: c.x, y: c.y, tiles: [] };
    e.tiles.push(c.t); byCell.set(k, e);
  }
  const cells: Cell[] = [];
  for (const e of byCell.values()) {
    const floors = e.tiles.filter((t) => t.cls === "floor" || t.cls === "door"), stairs = e.tiles.filter((t) => t.cls === "stair");
    const roofs = e.tiles.filter((t) => t.cls === "roof"), walls = e.tiles.filter((t) => t.cls === "wall" || t.cls === "window" || t.cls === "block");
    const ground = [...floors, ...stairs];
    const floorTop = ground.length ? topOf(ground).z : -Infinity;
    const real = walls.filter((t) => !ground.length || t.z >= floorTop);
    let kind: CellKind, material: string;
    if (real.length) {
      kind = real.some((t) => t.cls === "window") && !real.some((t) => t.cls !== "window") ? "window" : "wall";
      material = topOf(real).name;
    } else if (stairs.length) { kind = "stair"; material = topOf(stairs).name; }
    else if (floors.length) { kind = "floor"; const designed = floors.filter((t) => t.name !== "dirt"); material = topOf(designed.length ? designed : floors).name; }
    else if (roofs.length) { kind = "roof"; material = topOf(roofs).name; }
    else continue;
    const z = ground.length ? floorTop : topOf(e.tiles).z;
    cells.push({ level: e.level, x: e.x, y: e.y, kind, material, z, lip: walls.length > 0 && real.length === 0, indoor: false, doorway: floors.some((t) => t.cls === "door"), room: null });
  }

  const at = new Map(cells.map((c) => [key(c.level, c.x, c.y), c]));
  const covered = new Set(cells.filter((u) => u.level > 0 && (u.kind === "floor" || u.kind === "roof")).map((u) => `${u.x}:${u.y}`));
  const solid = (l: number, x: number, y: number): boolean => { const c = at.get(key(l, x, y)); return !!c && (c.kind === "wall" || c.kind === "window"); };
  for (const c of cells) {
    if (c.kind !== "floor" && c.kind !== "stair") continue;
    c.indoor = c.level > 0 || covered.has(`${c.x}:${c.y}`);
    if (c.kind === "floor" && ((solid(c.level, c.x - 1, c.y) && solid(c.level, c.x + 1, c.y)) || (solid(c.level, c.x, c.y - 1) && solid(c.level, c.x, c.y + 1)))) c.doorway = true;
  }

  const built = new Set(cells.filter((c) => c.kind === "wall" || c.kind === "window").map((c) => c.level));
  const levels: Level[] = bands.map((b, i) => ({ index: i, name: ORDINALS[i] ?? `${i + 1}th floor`, floorZ: b.floorZ, status: built.has(i) ? "built" : "floor-only" }));
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const t of house.tiles) { if (t[1] < x0) x0 = t[1]; if (t[1] > x1) x1 = t[1]; if (t[2] < y0) y0 = t[2]; if (t[2] > y1) y1 = t[2]; }
  const rooms = roomsOf(cells, at, levels, (x0 + x1) / 2, (y0 + y1) / 2);

  return { id: house.id, facet: house.facet, capturedAt: house.capturedAt, captures: house.captures, x0, y0, x1, y1, levels, cells, rooms,
    furniture: [], stacks: [], spots: [], codes: {}, tiledata: td !== null };
}

function roomsOf(cells: Cell[], at: Map<string, Cell>, levels: Level[], cx: number, cy: number): Room[] {
  const rooms: Room[] = [];
  const walkable = (c: Cell | undefined): c is Cell => !!c && c.indoor && (c.kind === "floor" || c.kind === "stair") && !c.doorway;
  const found: Array<{ level: number; cells: Cell[] }> = [];
  const seen = new Set<Cell>();
  for (const start of cells) {
    if (!walkable(start) || seen.has(start)) continue;
    const region: Cell[] = [], todo = [start];
    seen.add(start);
    while (todo.length) {
      const c = todo.pop()!;
      region.push(c);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const n = at.get(key(c.level, c.x + dx, c.y + dy));
        if (walkable(n) && !seen.has(n)) { seen.add(n); todo.push(n); }
      }
    }
    if (region.length >= MIN_ROOM) found.push({ level: start.level, cells: region });
  }
  for (const lv of levels) {
    const mine = found.filter((f) => f.level === lv.index), used = new Map<string, number>();
    for (const f of mine) {
      const mx = f.cells.reduce((a, c) => a + c.x, 0) / f.cells.length - cx, my = f.cells.reduce((a, c) => a + c.y, 0) / f.cells.length - cy;
      let name = lv.index > 0 && lv.status === "floor-only" ? "Open floor" : mine.length === 1 ? "Main room" : compassName(mx, my);
      const n = (used.get(name) ?? 0) + 1; used.set(name, n);
      if (n > 1) name += ` ${n}`;
      rooms.push(roomFrom(rooms.length, lv.index, "room", name, f.cells));
    }
  }
  const yard = cells.filter((c) => c.level === 0 && !c.indoor && (c.kind === "floor" || c.kind === "stair"));
  if (yard.length) rooms.push(roomFrom(rooms.length, 0, "yard", "Yard", yard));
  return rooms;
}

function roomFrom(id: number, level: number, kind: "room" | "yard", name: string, cells: Cell[]): Room {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const c of cells) { c.room = id; if (c.x < x0) x0 = c.x; if (c.x > x1) x1 = c.x; if (c.y < y0) y0 = c.y; if (c.y > y1) y1 = c.y; }
  return { id, level, kind, name, tiles: cells.length, x0, y0, x1, y1 };
}
