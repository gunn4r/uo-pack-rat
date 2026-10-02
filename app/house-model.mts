// house-model.mts — a house as the map draws it (issue #10), built from the newest capture of its tiles (app/house-capture.mts), the client's tiledata.mul (app/tiledata.mts; null when it was not found) and the fold's ground containers. Pure. Spec: docs/superpowers/specs/2026-10-01-house-map-design.md, section 3.
import { classify, FLAG, type TileData, type TileClass } from "./tiledata.mts";
import type { HouseItem, HouseSource } from "./house-capture.mts";

// opened: false = a chest a house capture saw that no scan has opened (issue #10); absent = opened.
export interface HouseContainerInput { serial: number; name: string; facet: number | null; x: number; y: number; z: number; opened?: boolean | undefined }
export interface Level { index: number; name: string; floorZ: number; status: "built" | "floor-only" }
export type CellKind = "floor" | "wall" | "window" | "stair" | "roof";
export interface Cell { level: number; x: number; y: number; kind: CellKind; material: string; family: MaterialFamily; z: number; lip: boolean; indoor: boolean; doorway: boolean }

// The colour a tile is drawn in, from its tiledata name by keyword (spec section 2). Order matters: sandstone, marble and brick before stone, and "sand" alone (not sandstone) is dirt; "gold" floors read as marble, pavers as tile. A name nothing matches, or no name (no tiledata.mul), is neutral.
export type MaterialFamily = "stone" | "brick" | "plaster" | "wood" | "marble" | "sandstone" | "dirt" | "grass" | "water" | "tile" | "neutral";
const FAMILIES: ReadonlyArray<[MaterialFamily, RegExp]> = [
  ["water", /water|pool|pond|fountain|swamp/],
  ["grass", /grass|jungle|hedge|lea(f|ves)|palm|fern/],
  ["sandstone", /sandstone/],
  ["dirt", /dirt|mud|earth|\bsand\b|wasteland|cave/],
  ["marble", /marble|virtue|mosaic|gold/],
  ["brick", /brick/],
  ["plaster", /plaster|stucco|clay/],
  ["tile", /tile|slate|ceramic|ornate|crystal|paver/],
  ["stone", /stone|rock|cobble|flagstone|granite|ruin|arch|dungeon|medusa|battlement/],
  ["wood", /wood|plank|log|timber|shingl|thatch|bamboo|board|parquet|palisade|bark|hay|straw|reed|tent|hide|cloth/],
];
export function materialFamily(name: string): MaterialFamily {
  const n = name.toLowerCase();
  for (const [family, re] of FAMILIES) if (re.test(n)) return family;
  return "neutral";
}
export interface Furniture { serial: number; kind: "block" | "door" | "teleporter"; name: string; level: number; x: number; y: number; z: number; height: number }
export interface Stack { level: number; x: number; y: number; serials: number[]; zs: number[]; spot: number | null; direction: string; letter: string }
export interface Spot { id: number; level: number; x: number; y: number; teleporter: boolean }
export interface HouseModel { id: string; facet: number | null; capturedAt: string; captures: number; x0: number; y0: number; x1: number; y1: number; levels: Level[]; cells: Cell[]; furniture: Furniture[]; stacks: Stack[]; spots: Spot[]; codes: Record<string, string>; tiledata: boolean; unopened: number[]; unopenedNames: Record<string, string> }

const LEVEL_GAP = 15;
const LEVEL_SLACK = 3;
const MIN_REGION = 4;
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

const topOf = (ts: Classed[]): Classed => ts.reduce((a, b) => (b.z > a.z ? b : a));

export function buildHouseModel(house: HouseSource, td: TileData | null, containers: HouseContainerInput[]): HouseModel {
  // Everything below works from sorted tiles, cells, items and containers, so the model (spots and codes) is the same however a capture listed them.
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
  // A foundation edge (spec section 3): a tile with no floor or stair, on the footprint's outer boundary or beside a floor, whose walls all start (base z: foundation pieces are tall) below the floor beside them, is the rim, drawn as a lip like the edge tiles that do carry a floor. "The floor beside them" is the lowest floor (stairs aside: front steps run down past the foundation) among the 8 neighbours on the same level (diagonals too, so a sunken room's corner walls stand on its floor), else the level's floor. It belongs to no region or spot (rims below).
  const footprintAt = new Set(classed.map((c) => `${c.x}:${c.y}`));
  const groundZ = (level: number, x: number, y: number, steps = true): number | undefined => {
    const g = byCell.get(key(level, x, y))?.tiles.filter((t) => t.cls === "floor" || t.cls === "door" || (steps && t.cls === "stair"));
    return g?.length ? topOf(g).z : undefined;
  };
  const SIDES = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
  const cells: Cell[] = [], doors = new Set<Cell>(), rims = new Set<Cell>();
  for (const e of byCell.values()) {
    const floors = e.tiles.filter((t) => t.cls === "floor" || t.cls === "door"), stairs = e.tiles.filter((t) => t.cls === "stair");
    const roofs = e.tiles.filter((t) => t.cls === "roof"), walls = e.tiles.filter((t) => t.cls === "wall" || t.cls === "window" || t.cls === "block");
    const ground = [...floors, ...stairs];
    const floorTop = ground.length ? topOf(ground).z : -Infinity;
    const wallBase = floors.length ? topOf(floors).z : floorTop;
    const floorZ = bands[e.level]!.floorZ;
    let rim = false;
    if (!ground.length && walls.length && SIDES.some(([dx, dy]) => !footprintAt.has(`${e.x + dx}:${e.y + dy}`) || groundZ(e.level, e.x + dx, e.y + dy) !== undefined)) {
      const beside = NEIGHBOURS.map(([dx, dy]) => groundZ(e.level, e.x + dx, e.y + dy, false)).filter((z): z is number => z !== undefined);
      const ref = beside.length ? Math.min(...beside) : floorZ;
      rim = walls.every((t) => t.z < ref);
    }
    const real = rim ? [] : walls.filter((t) => !ground.length || t.z >= wallBase);
    let kind: CellKind, material: string;
    if (real.length) {
      kind = real.some((t) => t.cls === "window") && !real.some((t) => t.cls !== "window") ? "window" : "wall";
      material = topOf(real).name;
    } else if (stairs.length) { kind = "stair"; material = topOf(stairs).name; }
    else if (walls.length && (rim || floors.length)) { kind = "floor"; material = topOf(walls).name; } // a lip, in its foundation's colour
    else if (floors.length) { kind = "floor"; const designed = floors.filter((t) => t.name !== "dirt"); material = topOf(designed.length ? designed : floors).name; }
    else if (roofs.length) { kind = "roof"; material = topOf(roofs).name; }
    else continue;
    const z = rim ? floorZ : ground.length ? floorTop : topOf(e.tiles).z;
    const cell: Cell = { level: e.level, x: e.x, y: e.y, kind, material, family: materialFamily(material), z, lip: walls.length > 0 && real.length === 0, indoor: ground.length > 0 && roofs.some((t) => t.z > floorTop), doorway: false };
    if (floors.some((t) => t.cls === "door")) { cell.doorway = true; doors.add(cell); }
    if (rim) rims.add(cell);
    cells.push(cell);
  }
  cells.sort((a, b) => a.level - b.level || a.y - b.y || a.x - b.x);

  const at = new Map(cells.map((c) => [key(c.level, c.x, c.y), c]));
  const covered = new Set(cells.filter((u) => u.level > 0 && (u.kind === "floor" || u.kind === "roof")).map((u) => `${u.x}:${u.y}`));
  const solid = (l: number, x: number, y: number): boolean => { const c = at.get(key(l, x, y)); return !!c && (c.kind === "wall" || c.kind === "window"); };
  for (const c of cells) {
    if ((c.kind !== "floor" && c.kind !== "stair") || rims.has(c)) continue;
    c.indoor = c.level > 0 || c.indoor || covered.has(`${c.x}:${c.y}`);
    if (c.kind === "floor" && ((solid(c.level, c.x - 1, c.y) && solid(c.level, c.x + 1, c.y)) || (solid(c.level, c.x, c.y - 1) && solid(c.level, c.x, c.y + 1)))) c.doorway = true;
  }

  // Furniture: doors (the doorway they stand in, or beside when open, stays out of hallways like a door tile's), teleporters by name, impassable items as blocks; passable decoration is not drawn.
  const furniture: Furniture[] = [];
  const own = houseItemSerial(house);
  if (td) for (const [serial, graphic, x, y, z] of [...house.items].sort((a, b) => a[0] - b[0])) {
    if (serial === own) continue;
    const info = td.info(graphic);
    if (!info) continue;
    const kind = classify(info, false) === "door" ? "door" : /teleporter/i.test(info.name) ? "teleporter" : (info.flags & FLAG.impassable) !== 0n ? "block" : null;
    if (!kind) continue;
    const level = levelOf(z);
    furniture.push({ serial, kind, name: info.name, level, x, y, z, height: info.height });
    const c = kind === "door" ? doorCell(at, solid, rims, level, x, y) : undefined;
    if (c) { c.doorway = true; doors.add(c); }
  }

  const built = new Set(cells.filter((c) => c.kind === "wall" || c.kind === "window").map((c) => c.level));
  const levels: Level[] = bands.map((b, i) => ({ index: i, name: ORDINALS[i] ?? `${i + 1}th floor`, floorZ: b.floorZ, status: built.has(i) ? "built" : "floor-only" }));
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const t of house.tiles) { if (t[1] < x0) x0 = t[1]; if (t[1] > x1) x1 = t[1]; if (t[2] < y0) y0 = t[2]; if (t[2] > y1) y1 = t[2]; }
  if (!house.tiles.length) x0 = y0 = x1 = y1 = 0;
  const region = regionsOf(cells, at, doors, rims, levels);

  // Stacks: the house's containers (same facet, either side unknown counts; on the footprint: some level has a cell at its tile) per tile, bottom first; a tile's column splits where the next container is a storey (LEVEL_GAP) higher or stands at or above the top of a higher level's floor or stair on that tile, and each stack sits on its bottom container's level.
  const footprint = new Set(cells.map((c) => `${c.x}:${c.y}`));
  const inside = (c: HouseContainerInput): boolean => (c.facet === null || house.facet === null || c.facet === house.facet) && footprint.has(`${c.x}:${c.y}`);
  const onUpperFloor = (c: HouseContainerInput, level: number): boolean => levels.some((l) => {
    const u = l.index > level ? at.get(key(l.index, c.x, c.y)) : undefined;
    return !!u && (u.kind === "floor" || u.kind === "stair") && c.z >= u.z;
  });
  const stackAt = new Map<string, Stack[]>(), stackRegion = new Map<Stack, number | null>(), below = new Map<string, { s: Stack; z: number }>();
  for (const c of containers.filter(inside).sort((a, b) => a.z - b.z || a.serial - b.serial)) {
    const col = `${c.x}:${c.y}`, prev = below.get(col);
    let s = prev && c.z - prev.z < LEVEL_GAP && !onUpperFloor(c, prev.s.level) ? prev.s : undefined;
    if (!s) {
      const level = levelOf(c.z), k = key(level, c.x, c.y);
      s = { level, x: c.x, y: c.y, serials: [], zs: [], spot: null, direction: "", letter: "" };
      const r = at.get(k);
      stackRegion.set(s, r ? region.get(r) ?? null : null);
      stackAt.set(k, [...(stackAt.get(k) ?? []), s]);
    }
    s.serials.push(c.serial); s.zs.push(c.z); below.set(col, { s, z: c.z });
  }
  const stacks = [...stackAt.values()].flat();
  // The stacked chests no scan has opened, with the names their tiledata gives (the page shows them as not opened yet).
  const seenOnly = new Map(containers.filter((c) => c.opened === false).map((c) => [c.serial, c.name]));
  const unopened = stacks.flatMap((s) => s.serials).filter((n) => seenOnly.has(n)).sort((a, b) => a - b);
  const unopenedNames = Object.fromEntries(unopened.map((n) => [String(n), seenOnly.get(n)!]));
  const spots = spotsOf(cells.filter((c) => !rims.has(c)), at, stackAt, furniture, levels, (c) => region.get(c) ?? null, (s) => stackRegion.get(s) ?? null);

  const angle = (s: Stack): number => { const p = spots[s.spot!]!; return Math.round(((Math.atan2(s.x - p.x, -(s.y - p.y)) * 180) / Math.PI + 360) % 360); };
  const ring = (s: Stack): number => { const p = spots[s.spot!]!; return Math.max(Math.abs(s.x - p.x), Math.abs(s.y - p.y)); };
  const ordered = [...stacks].sort((a, b) =>
    (a.spot ?? Infinity) - (b.spot ?? Infinity) || (a.spot !== null && b.spot !== null ? angle(a) - angle(b) || ring(a) - ring(b) : 0) || a.y - b.y || a.x - b.x);
  const codes: Record<string, string> = {};
  ordered.forEach((s, i) => {
    s.letter = letterOf(i);
    s.serials.forEach((serial, h) => { codes[String(serial)] = s.serials.length === 1 ? s.letter : `${s.letter}${h + 1}`; });
  });

  return { id: house.id, facet: house.facet, capturedAt: house.capturedAt, captures: house.captures, x0, y0, x1, y1, levels, cells,
    furniture, stacks: ordered, spots, codes, tiledata: td !== null, unopened, unopenedNames };
}

// The house's plot as the player knows it: its bounds without an outer row or column of front steps (a custom house's steps stand outside the plot): a ground-level row holding a stair tile with every tile in it below the ground floor's z. The model's bounds keep the steps, so they still draw.
export function plotBounds(m: HouseModel): { x0: number; y0: number; x1: number; y1: number } {
  let { x0, y0, x1, y1 } = m;
  const floorZ = m.levels[0]?.floorZ ?? 0;
  const steps = (on: (c: Cell) => boolean): boolean => { const row = m.cells.filter((c) => c.level === 0 && on(c)); return row.some((c) => c.kind === "stair") && row.every((c) => c.z < floorZ); };
  if (x1 > x0 && steps((c) => c.x === x0)) x0++;
  if (x1 > x0 && steps((c) => c.x === x1)) x1--;
  if (y1 > y0 && steps((c) => c.y === y0)) y0++;
  if (y1 > y0 && steps((c) => c.y === y1)) y1--;
  return { x0, y0, x1, y1 };
}
export function plotSize(m: HouseModel): { width: number; height: number } {
  const p = plotBounds(m);
  return { width: p.x1 - p.x0 + 1, height: p.y1 - p.y0 + 1 };
}

// A, B … Z, AA, AB … ZZ, AAA … (bijective base 26).
export function letterOf(n: number): string {
  let s = "";
  for (let k = n + 1; k > 0; k = Math.floor((k - 1) / 26)) s = String.fromCharCode(65 + ((k - 1) % 26)) + s;
  return s;
}

// The doorway a door item stands in: its own cell when that is not a wall or window. An open door stands on the wall beside the gap it closes (issue #159), so then the first floor neighbour (north, west, east, south, then the diagonals) with walls on both opposite sides; undefined when there is none.
const NEIGHBOURS: ReadonlyArray<[number, number]> = [[0, -1], [-1, 0], [1, 0], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]];
function doorCell(at: Map<string, Cell>, solid: (l: number, x: number, y: number) => boolean, rims: Set<Cell>, level: number, x: number, y: number): Cell | undefined {
  const c = at.get(key(level, x, y));
  if (!c || (c.kind !== "wall" && c.kind !== "window")) return c;
  for (const [dx, dy] of NEIGHBOURS) {
    const n = at.get(key(level, x + dx, y + dy));
    if (n?.kind === "floor" && !rims.has(n) && ((solid(level, n.x - 1, n.y) && solid(level, n.x + 1, n.y)) || (solid(level, n.x, n.y - 1) && solid(level, n.x, n.y + 1)))) return n;
  }
  return undefined;
}

function directionOf(dx: number, dy: number): string {
  if (!dx && !dy) return "here";
  return (dy < 0 ? "N" : dy > 0 ? "S" : "") + (dx > 0 ? "E" : dx < 0 ? "W" : "");
}

// Greedy cover per level: candidates are free floor and stair cells plus teleporter tiles, none holding a stack or a block; each reaches the stacks within REACH tiles (Chebyshev) in its own region (regionsOf), or in no region (an alcove or doorway cell) from any region, so never through a wall, worked out once. Each round picks the candidate reaching the most uncovered containers, ties to the smaller total Manhattan distance, then y, then x; it stops when no candidate reaches anything. Spots are then numbered by level, region (none last) and pick order, so letters run room by room. Sets each covered stack's spot and direction.
// A house is itself an Item whose graphic is its multi id, standing at the plot centre (ServUO Scripts/Multis/HousePlacementTool.cs: every customizable house uses a multi id from 0x13EC to 0x147B); a static of the same id would be named as furniture (0x147B reads as a telescope). But ServUO's Telescope addon (Scripts/Items/Addons/Telescope.cs) has a real component with graphic 0x147B, so only ONE item is dropped: the in-range one nearest the centre of the tiles' x/y bounds, ties to the lowest serial, and only when it is within HOUSE_ITEM_CENTRE_RADIUS of that centre.
const HOUSE_MULTI_MIN = 0x13ec, HOUSE_MULTI_MAX = 0x147b;
const HOUSE_ITEM_CENTRE_RADIUS = 2;   // the bounds include steps and the rim, so their centre sits up to about a tile off the multi origin, and an even-sized plot has a .5 centre
function houseItemSerial(house: HouseSource): number | null {
  const cand = house.items.filter((i) => i[1] >= HOUSE_MULTI_MIN && i[1] <= HOUSE_MULTI_MAX);
  if (!cand.length || !house.tiles.length) return null;
  const xs = house.tiles.map((t) => t[1]), ys = house.tiles.map((t) => t[2]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const d = (i: HouseItem) => (i[2] - cx) ** 2 + (i[3] - cy) ** 2;
  const best = cand.reduce((a, b) => (d(b) < d(a) || (d(b) === d(a) && b[0] < a[0]) ? b : a));
  return Math.max(Math.abs(best[2] - cx), Math.abs(best[3] - cy)) <= HOUSE_ITEM_CENTRE_RADIUS ? best[0] : null;
}

function spotsOf(cells: Cell[], at: Map<string, Cell>, stackAt: Map<string, Stack[]>, furniture: Furniture[], levels: Level[], cellRegion: (c: Cell) => number | null, stackRegion: (s: Stack) => number | null): Spot[] {
  const spots: Spot[] = [], spotRegion = new Map<number, number | null>();
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
        for (const s of stackAt.get(key(lv.index, c.x + dx, c.y + dy)) ?? []) if (stackRegion(s) === null || stackRegion(s) === cellRegion(c)) near.push(s);
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
      spots.push({ id, level: lv.index, x: c.x, y: c.y, teleporter: teleports.has(key(lv.index, c.x, c.y)) });
      spotRegion.set(id, cellRegion(c));
      for (const s of best.cov) { s.spot = id; s.direction = directionOf(s.x - c.x, s.y - c.y); }
    }
  }
  const order = [...spots].sort((a, b) => a.level - b.level || (spotRegion.get(a.id) ?? Infinity) - (spotRegion.get(b.id) ?? Infinity) || a.id - b.id);
  const renumber = new Map(order.map((p, i) => [p.id, i]));
  for (const s of [...stackAt.values()].flat()) if (s.spot !== null) s.spot = renumber.get(s.spot)!;
  order.forEach((p, i) => { p.id = i; });
  return order;
}

// The wall-aware regions standing spots work in (issue #10: never shown, the player draws their own areas): doorway cells (walls on both opposite sides) split the indoor floor into rooms of at least MIN_REGION cells, level by level; afterwards the indoor cells still in none form hallways (a 1-wide corridor is doorway cells end to end), except cells holding a door; the ground level's uncovered floor (the foundation's rim aside) is one region last. Numbered in that order, so spot order (and with it every letter) is deterministic.
function regionsOf(cells: Cell[], at: Map<string, Cell>, doors: Set<Cell>, rims: Set<Cell>, levels: Level[]): Map<Cell, number> {
  const region = new Map<Cell, number>();
  let next = 0;
  const claim = (cs: Cell[]): void => { const id = next++; for (const c of cs) region.set(c, id); };
  const open = (c: Cell): boolean => c.indoor && (c.kind === "floor" || c.kind === "stair");
  const fill = (ok: (c: Cell | undefined) => c is Cell): Array<{ level: number; cells: Cell[] }> => {
    const found: Array<{ level: number; cells: Cell[] }> = [], seen = new Set<Cell>();
    for (const start of cells) {
      if (!ok(start) || seen.has(start)) continue;
      const part: Cell[] = [], todo = [start];
      seen.add(start);
      while (todo.length) {
        const c = todo.pop()!;
        part.push(c);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const n = at.get(key(c.level, c.x + dx, c.y + dy));
          if (ok(n) && !seen.has(n)) { seen.add(n); todo.push(n); }
        }
      }
      if (part.length >= MIN_REGION) found.push({ level: start.level, cells: part });
    }
    return found;
  };
  const found = fill((c): c is Cell => !!c && open(c) && !c.doorway);
  for (const lv of levels) for (const f of found) if (f.level === lv.index) claim(f.cells);
  const halls = fill((c): c is Cell => !!c && open(c) && !region.has(c) && !doors.has(c));
  for (const lv of levels) for (const f of halls) if (f.level === lv.index) claim(f.cells);
  const yard = cells.filter((c) => c.level === 0 && !c.indoor && (c.kind === "floor" || c.kind === "stair") && !rims.has(c));
  if (yard.length) claim(yard);
  return region;
}
