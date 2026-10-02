// house-model.mts — a house as the map draws it (issue #10), built from the newest capture of its tiles (app/house-capture.mts), the client's tiledata.mul (app/tiledata.mts; null when it was not found) and the fold's ground containers. Pure. Spec: docs/superpowers/specs/2026-10-01-house-map-design.md, section 3.
import { classify, FLAG, type TileData, type TileClass } from "./tiledata.mts";
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
const REACH = 2;
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

// The floor z that make storeys. The client lays every staircase on Surface filler blocks 5 or 10 high, which would chain the storeys into one, so with tiledata only flat (height 0) floors count. Without it every passable tile reads as floor, roofs and steps included; best effort, a storey is a z holding many of them, so only z with at least a quarter of the busiest z's count are kept (a roof climbs a row per z and a stair a step per z).
function storeyZs(floors: Array<{ height: number; t: Classed }>, tiledata: boolean): number[] {
  if (tiledata) return floors.filter((f) => f.height === 0).map((f) => f.t.z);
  const count = new Map<number, number>();
  for (const f of floors) count.set(f.t.z, (count.get(f.t.z) ?? 0) + 1);
  const most = Math.max(0, ...count.values());
  return floors.map((f) => f.t.z).filter((z) => count.get(z)! * 4 >= most);
}

function compassName(dx: number, dy: number): string {
  const v = dy < -1.5 ? "north" : dy > 1.5 ? "south" : "", h = dx < -1.5 ? "west" : dx > 1.5 ? "east" : "";
  const n = v && h ? `${v}-${h}` : v || h || "middle";
  return n[0]!.toUpperCase() + n.slice(1) + " room";
}

const topOf = (ts: Classed[]): Classed => ts.reduce((a, b) => (b.z > a.z ? b : a));

export function buildHouseModel(house: HouseSource, td: TileData | null, containers: HouseContainerInput[]): HouseModel {
  // Everything below works from sorted tiles, cells, items and containers, so the model (room ids and names, spots, codes) is the same however a capture listed them.
  const tiles = [...house.tiles].sort((a, b) => a[2] - b[2] || a[1] - b[1] || a[3] - b[3] || a[0] - b[0] || a[4] - b[4]);
  const classed = tiles.map(([graphic, x, y, z, imp]) => {
    const info = td?.info(graphic) ?? null;
    return { x, y, height: info?.height ?? 0, t: { cls: classify(info, imp === 1), name: info?.name ?? "", z } as Classed };
  }).filter((c) => c.t.cls !== "other");
  const floorZs = storeyZs(classed.filter((c) => c.t.cls === "floor"), td !== null);
  const bands = levelsOf(floorZs.length ? floorZs : [0]);
  const levelOf = (z: number): number => { let i = 0; bands.forEach((b, j) => { if (b.lo - LEVEL_SLACK <= z) i = j; }); return i; };

  const byCell = new Map<string, { level: number; x: number; y: number; tiles: Classed[] }>();
  for (const c of classed) {
    const level = levelOf(c.t.z), k = key(level, c.x, c.y);
    const e = byCell.get(k) ?? { level, x: c.x, y: c.y, tiles: [] };
    e.tiles.push(c.t); byCell.set(k, e);
  }
  const cells: Cell[] = [], doors = new Set<Cell>();
  for (const e of byCell.values()) {
    const floors = e.tiles.filter((t) => t.cls === "floor" || t.cls === "door"), stairs = e.tiles.filter((t) => t.cls === "stair");
    const roofs = e.tiles.filter((t) => t.cls === "roof"), walls = e.tiles.filter((t) => t.cls === "wall" || t.cls === "window" || t.cls === "block");
    const ground = [...floors, ...stairs];
    const floorTop = ground.length ? topOf(ground).z : -Infinity;
    const wallBase = floors.length ? topOf(floors).z : floorTop;
    const real = walls.filter((t) => !ground.length || t.z >= wallBase);
    let kind: CellKind, material: string;
    if (real.length) {
      kind = real.some((t) => t.cls === "window") && !real.some((t) => t.cls !== "window") ? "window" : "wall";
      material = topOf(real).name;
    } else if (stairs.length) { kind = "stair"; material = topOf(stairs).name; }
    else if (floors.length) { kind = "floor"; const designed = floors.filter((t) => t.name !== "dirt"); material = topOf(designed.length ? designed : floors).name; }
    else if (roofs.length) { kind = "roof"; material = topOf(roofs).name; }
    else continue;
    const z = ground.length ? floorTop : topOf(e.tiles).z;
    const cell: Cell = { level: e.level, x: e.x, y: e.y, kind, material, z, lip: walls.length > 0 && real.length === 0, indoor: ground.length > 0 && roofs.some((t) => t.z > floorTop), doorway: false, room: null };
    if (floors.some((t) => t.cls === "door")) { cell.doorway = true; doors.add(cell); }
    cells.push(cell);
  }
  cells.sort((a, b) => a.level - b.level || a.y - b.y || a.x - b.x);

  const at = new Map(cells.map((c) => [key(c.level, c.x, c.y), c]));
  const covered = new Set(cells.filter((u) => u.level > 0 && (u.kind === "floor" || u.kind === "roof")).map((u) => `${u.x}:${u.y}`));
  const solid = (l: number, x: number, y: number): boolean => { const c = at.get(key(l, x, y)); return !!c && (c.kind === "wall" || c.kind === "window"); };
  for (const c of cells) {
    if (c.kind !== "floor" && c.kind !== "stair") continue;
    c.indoor = c.level > 0 || c.indoor || covered.has(`${c.x}:${c.y}`);
    if (c.kind === "floor" && ((solid(c.level, c.x - 1, c.y) && solid(c.level, c.x + 1, c.y)) || (solid(c.level, c.x, c.y - 1) && solid(c.level, c.x, c.y + 1)))) c.doorway = true;
  }

  // Furniture: doors (the doorway they stand in, or beside when open, stays out of hallways like a door tile's), teleporters by name, impassable items as blocks; passable decoration is not drawn.
  const furniture: Furniture[] = [];
  if (td) for (const [serial, graphic, x, y, z] of [...house.items].sort((a, b) => a[0] - b[0])) {
    const info = td.info(graphic);
    if (!info) continue;
    const kind = classify(info, false) === "door" ? "door" : /teleporter/i.test(info.name) ? "teleporter" : (info.flags & FLAG.impassable) !== 0n ? "block" : null;
    if (!kind) continue;
    const level = levelOf(z);
    furniture.push({ serial, kind, name: info.name, level, x, y, z, height: info.height });
    const c = kind === "door" ? doorCell(at, solid, level, x, y) : undefined;
    if (c) { c.doorway = true; doors.add(c); }
  }

  const built = new Set(cells.filter((c) => c.kind === "wall" || c.kind === "window").map((c) => c.level));
  const levels: Level[] = bands.map((b, i) => ({ index: i, name: ORDINALS[i] ?? `${i + 1}th floor`, floorZ: b.floorZ, status: built.has(i) ? "built" : "floor-only" }));
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const t of house.tiles) { if (t[1] < x0) x0 = t[1]; if (t[1] > x1) x1 = t[1]; if (t[2] < y0) y0 = t[2]; if (t[2] > y1) y1 = t[2]; }
  if (!house.tiles.length) x0 = y0 = x1 = y1 = 0;
  const rooms = roomsOf(cells, at, doors, levels, (x0 + x1) / 2, (y0 + y1) / 2);

  // Stacks: the house's containers (same facet, either side unknown counts; on the footprint: some level has a cell at its tile) per tile, bottom first; a tile's column splits where the next container is a storey (LEVEL_GAP) higher or stands at or above the top of a higher level's floor or stair on that tile, and each stack sits on its bottom container's level.
  const footprint = new Set(cells.map((c) => `${c.x}:${c.y}`));
  const inside = (c: HouseContainerInput): boolean => (c.facet === null || house.facet === null || c.facet === house.facet) && footprint.has(`${c.x}:${c.y}`);
  const onUpperFloor = (c: HouseContainerInput, level: number): boolean => levels.some((l) => {
    const u = l.index > level ? at.get(key(l.index, c.x, c.y)) : undefined;
    return !!u && (u.kind === "floor" || u.kind === "stair") && c.z >= u.z;
  });
  const stackAt = new Map<string, Stack[]>(), below = new Map<string, { s: Stack; z: number }>();
  for (const c of containers.filter(inside).sort((a, b) => a.z - b.z || a.serial - b.serial)) {
    const col = `${c.x}:${c.y}`, prev = below.get(col);
    let s = prev && c.z - prev.z < LEVEL_GAP && !onUpperFloor(c, prev.s.level) ? prev.s : undefined;
    if (!s) {
      const level = levelOf(c.z), k = key(level, c.x, c.y);
      s = { level, x: c.x, y: c.y, room: at.get(k)?.room ?? null, serials: [], spot: null, direction: "", letter: "" };
      stackAt.set(k, [...(stackAt.get(k) ?? []), s]);
    }
    s.serials.push(c.serial); below.set(col, { s, z: c.z });
  }
  const stacks = [...stackAt.values()].flat();
  const spots = spotsOf(cells, at, stackAt, furniture, levels);

  const angle = (s: Stack): number => { const p = spots[s.spot!]!; return Math.round(((Math.atan2(s.x - p.x, -(s.y - p.y)) * 180) / Math.PI + 360) % 360); };
  const ring = (s: Stack): number => { const p = spots[s.spot!]!; return Math.max(Math.abs(s.x - p.x), Math.abs(s.y - p.y)); };
  const ordered = [...stacks].sort((a, b) =>
    (a.spot ?? Infinity) - (b.spot ?? Infinity) || (a.spot !== null && b.spot !== null ? angle(a) - angle(b) || ring(a) - ring(b) : 0) || a.y - b.y || a.x - b.x);
  const codes: Record<string, string> = {};
  ordered.forEach((s, i) => {
    s.letter = letterOf(i);
    s.serials.forEach((serial, h) => { codes[String(serial)] = s.serials.length === 1 ? s.letter : `${s.letter}${h + 1}`; });
  });

  return { id: house.id, facet: house.facet, capturedAt: house.capturedAt, captures: house.captures, x0, y0, x1, y1, levels, cells, rooms,
    furniture, stacks: ordered, spots, codes, tiledata: td !== null };
}

// A, B … Z, AA, AB … ZZ, AAA … (bijective base 26).
export function letterOf(n: number): string {
  let s = "";
  for (let k = n + 1; k > 0; k = Math.floor((k - 1) / 26)) s = String.fromCharCode(65 + ((k - 1) % 26)) + s;
  return s;
}

// The doorway a door item stands in: its own cell when that is not a wall or window. An open door stands on the wall beside the gap it closes (issue #159), so then the first floor neighbour (north, west, east, south, then the diagonals) with walls on both opposite sides; undefined when there is none.
const NEIGHBOURS: ReadonlyArray<[number, number]> = [[0, -1], [-1, 0], [1, 0], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]];
function doorCell(at: Map<string, Cell>, solid: (l: number, x: number, y: number) => boolean, level: number, x: number, y: number): Cell | undefined {
  const c = at.get(key(level, x, y));
  if (!c || (c.kind !== "wall" && c.kind !== "window")) return c;
  for (const [dx, dy] of NEIGHBOURS) {
    const n = at.get(key(level, x + dx, y + dy));
    if (n?.kind === "floor" && ((solid(level, n.x - 1, n.y) && solid(level, n.x + 1, n.y)) || (solid(level, n.x, n.y - 1) && solid(level, n.x, n.y + 1)))) return n;
  }
  return undefined;
}

function directionOf(dx: number, dy: number): string {
  if (!dx && !dy) return "here";
  return (dy < 0 ? "N" : dy > 0 ? "S" : "") + (dx > 0 ? "E" : dx < 0 ? "W" : "");
}

// Greedy cover per level: candidates are free floor and stair cells plus teleporter tiles, none holding a stack or a block; each reaches the stacks within REACH tiles (Chebyshev) in its own room, or in no room (an alcove or doorway cell) from any room, worked out once. Each round picks the candidate reaching the most uncovered containers, ties to the smaller total Manhattan distance, then y, then x; it stops when no candidate reaches anything. Spots are then numbered by level, room (none last) and pick order, so letters run room by room. Sets each covered stack's spot and direction.
function spotsOf(cells: Cell[], at: Map<string, Cell>, stackAt: Map<string, Stack[]>, furniture: Furniture[], levels: Level[]): Spot[] {
  const spots: Spot[] = [];
  const blocked = new Set(furniture.filter((f) => f.kind === "block").map((f) => key(f.level, f.x, f.y)));
  const teleports = new Set(furniture.filter((f) => f.kind === "teleporter").map((f) => key(f.level, f.x, f.y)));
  for (const lv of levels) {
    const free = (k: string): boolean => !stackAt.has(k) && !blocked.has(k);
    const cands = new Set(cells.filter((c) => c.level === lv.index && (c.kind === "floor" || c.kind === "stair") && free(key(c.level, c.x, c.y))));
    for (const k of teleports) { const c = at.get(k); if (c && c.level === lv.index && free(k)) cands.add(c); }
    const reach: Array<{ c: Cell; stacks: Stack[] }> = [];
    for (const c of cands) {
      const near: Stack[] = [];
      for (let dx = -REACH; dx <= REACH; dx++) for (let dy = -REACH; dy <= REACH; dy++) {
        for (const s of stackAt.get(key(lv.index, c.x + dx, c.y + dy)) ?? []) if (s.room === null || s.room === c.room) near.push(s);
      }
      if (near.length) reach.push({ c, stacks: near });
    }
    for (;;) {
      let best: { c: Cell; n: number; d: number; cov: Stack[] } | null = null;
      for (const r of reach) {
        const cov = r.stacks.filter((s) => s.spot === null);
        if (!cov.length) continue;
        const { c } = r, n = cov.reduce((a, s) => a + s.serials.length, 0), d = cov.reduce((a, s) => a + Math.abs(s.x - c.x) + Math.abs(s.y - c.y), 0);
        if (!best || n > best.n || (n === best.n && (d < best.d || (d === best.d && (c.y < best.c.y || (c.y === best.c.y && c.x < best.c.x)))))) best = { c, n, d, cov };
      }
      if (!best) break;
      const { c } = best, id = spots.length;
      spots.push({ id, level: lv.index, x: c.x, y: c.y, room: c.room, teleporter: teleports.has(key(lv.index, c.x, c.y)) });
      for (const s of best.cov) { s.spot = id; s.direction = directionOf(s.x - c.x, s.y - c.y); }
    }
  }
  const order = [...spots].sort((a, b) => a.level - b.level || (a.room ?? Infinity) - (b.room ?? Infinity) || a.id - b.id);
  const renumber = new Map(order.map((p, i) => [p.id, i]));
  for (const s of [...stackAt.values()].flat()) if (s.spot !== null) s.spot = renumber.get(s.spot)!;
  order.forEach((p, i) => { p.id = i; });
  return order;
}

// Doorway cells (walls on both opposite sides) split rooms; afterwards the indoor cells still without a room form hallways (a 1-wide corridor is doorway cells end to end), except cells holding a door.
function roomsOf(cells: Cell[], at: Map<string, Cell>, doors: Set<Cell>, levels: Level[], cx: number, cy: number): Room[] {
  const rooms: Room[] = [];
  const open = (c: Cell): boolean => c.indoor && (c.kind === "floor" || c.kind === "stair");
  const fill = (ok: (c: Cell | undefined) => c is Cell): Array<{ level: number; cells: Cell[] }> => {
    const found: Array<{ level: number; cells: Cell[] }> = [], seen = new Set<Cell>();
    for (const start of cells) {
      if (!ok(start) || seen.has(start)) continue;
      const region: Cell[] = [], todo = [start];
      seen.add(start);
      while (todo.length) {
        const c = todo.pop()!;
        region.push(c);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const n = at.get(key(c.level, c.x + dx, c.y + dy));
          if (ok(n) && !seen.has(n)) { seen.add(n); todo.push(n); }
        }
      }
      if (region.length >= MIN_ROOM) found.push({ level: start.level, cells: region });
    }
    return found;
  };
  const found = fill((c): c is Cell => !!c && open(c) && !c.doorway);
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
  const halls = fill((c): c is Cell => !!c && open(c) && c.room === null && !doors.has(c));
  for (const lv of levels) halls.filter((f) => f.level === lv.index).forEach((f, i) => rooms.push(roomFrom(rooms.length, lv.index, "room", i ? `Hallway ${i + 1}` : "Hallway", f.cells)));
  const yard = cells.filter((c) => c.level === 0 && !c.indoor && (c.kind === "floor" || c.kind === "stair"));
  if (yard.length) rooms.push(roomFrom(rooms.length, 0, "yard", "Yard", yard));
  return rooms;
}

function roomFrom(id: number, level: number, kind: "room" | "yard", name: string, cells: Cell[]): Room {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const c of cells) { c.room = id; if (c.x < x0) x0 = c.x; if (c.x > x1) x1 = c.x; if (c.y < y0) y0 = c.y; if (c.y > y1) y1 = c.y; }
  return { id, level, kind, name, tiles: cells.length, x0, y0, x1, y1 };
}
