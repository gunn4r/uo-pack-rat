// house-fixture.mts — synthetic houses for the house model's tests (issue #10): no game data, every graphic below is made up and described by the synthetic tiledata built here.
import { FLAG, readTileData, type TileData } from "./tiledata.mts";
import { syntheticTileData, type FixtureTile } from "./tiledata-fixture.mts";
import { houseIdOf, type HouseSource, type HouseTile, type HouseItem } from "./house-capture.mts";
import type { HouseContainerInput } from "./house-model.mts";

export const G = { dirt: 1, pavers: 2, grass: 3, planks: 4, stoneWall: 5, brickWall: 6, window: 7, stairs: 8, roof: 9, table: 10, door: 11, teleporter: 12, rug: 13, banister: 14, block: 15, woodWall: 16 } as const;

export const FIXTURE_TILES: FixtureTile[] = [
    { graphic: G.dirt, flags: FLAG.surface, name: "dirt" },
    { graphic: G.pavers, flags: FLAG.surface, name: "stone pavers" },
    { graphic: G.grass, flags: FLAG.surface, name: "grass" },
    { graphic: G.planks, flags: FLAG.surface, name: "wooden planks" },
    { graphic: G.stoneWall, flags: FLAG.wall | FLAG.impassable, height: 20, name: "stone wall" },
    { graphic: G.brickWall, flags: FLAG.wall | FLAG.impassable, height: 3, name: "brick wall" },
    { graphic: G.window, flags: FLAG.wall | FLAG.window | FLAG.impassable, height: 20, name: "window" },
    { graphic: G.stairs, flags: FLAG.surface | FLAG.stairBack, height: 5, name: "stone stairs" },
    { graphic: G.roof, flags: FLAG.roof | FLAG.impassable, height: 3, name: "thatch roof" },
    { graphic: G.table, flags: FLAG.impassable | FLAG.surface, height: 6, name: "table" },
    { graphic: G.door, flags: FLAG.door | FLAG.impassable, height: 20, name: "wooden door" },
    { graphic: G.teleporter, flags: 0n, name: "house teleporter" },
    { graphic: G.rug, flags: 0n, name: "rug" },
    { graphic: G.banister, flags: FLAG.impassable, height: 8, name: "wooden banister" },
    { graphic: G.block, flags: FLAG.surface, height: 10, name: "stone" },
    { graphic: G.woodWall, flags: FLAG.wall | FLAG.impassable, height: 20, name: "wooden wall" },
];
export function fixtureTileData(): TileData {
  return readTileData(syntheticTileData(FIXTURE_TILES));
}

const source = (tiles: HouseTile[], items: HouseItem[] = []): HouseSource =>
  ({ id: houseIdOf(1, tiles), facet: 1, capturedAt: "2026-10-01T12:00:00Z", tiles, items, containers: [], captures: 1 });

// A plot of 18 x 18 tiles at (1000, 2000). Ground level z 7: the building is the north part (y 2001..2007, full width) plus a west wing (x 1001..1008, y 2008..2012); the rest of the plot is the courtyard. Walls at z 7 ring the building; walls at z 0 ring the whole plot (the foundation's edge). Every designed floor tile has a dirt tile under it at the same z. The 2nd floor (z 27) covers exactly the building and has no walls. Front steps along y 2018, outside the plot. A door in the wing's east wall at (1009, 2010); a table at (1003, 2003); a rug at (1004, 2004).
export function courtyardHouse(): HouseSource {
  const t: HouseTile[] = [];
  const X0 = 1000, Y0 = 2000, X1 = 1017, Y1 = 2017;
  const inBuilding = (x: number, y: number): boolean => (y >= Y0 + 1 && y <= Y0 + 7 && x >= X0 + 1 && x <= X1 - 1) || (y >= Y0 + 8 && y <= Y0 + 12 && x >= X0 + 1 && x <= X0 + 8);
  for (let x = X0; x <= X1; x++) for (let y = Y0; y <= Y1; y++) {
    const edge = x === X0 || x === X1 || y === Y0 || y === Y1;
    if (edge) { t.push([G.brickWall, x, y, 0, 1]); t.push([G.grass, x, y, 7, 0]); continue; }
    t.push([G.dirt, x, y, 7, 0]);
    if (inBuilding(x, y)) { t.push([G.pavers, x, y, 7, 0]); t.push([G.planks, x, y, 27, 0]); }
    else t.push([G.grass, x, y, 7, 0]);
  }
  // Building walls at z 7: north row y 2000 is the plot edge, so the building's own walls are the ring around inBuilding.
  for (let x = X0; x <= X1; x++) for (let y = Y0; y <= Y1; y++) {
    if (inBuilding(x, y)) continue;
    const touches = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]].some(([dx, dy]) => inBuilding(x + dx!, y + dy!));
    if (touches && !(x === X0 + 9 && y === Y0 + 10)) t.push([y === Y0 + 3 && x === X1 ? G.window : G.stoneWall, x, y, 7, 1]);
  }
  for (let x = X0; x <= X1; x++) t.push([G.stairs, x, Y1 + 1, 0, 0]);
  return source(t, [[0x40000101, G.table, X0 + 3, Y0 + 3, 7], [0x40000102, G.rug, X0 + 4, Y0 + 4, 7], [0x40000103, G.door, X0 + 9, Y0 + 10, 7]]);
}

// A 10 x 10 plot at (9000, 9000) on a raised foundation, as a custom house's capture lists it: a dirt floor at z 7 and the foundation's stone walls at z 0 (each listed twice) on every edge tile. The west and north edge tiles (x 9000, y 9000) hold only those walls; the east and south ones also hold the dirt floor. A 3 x 3 wooden stall (walls at z 7 round (9004, 9004), a door tile in its south side at (9004, 9005)), and front steps outside the plot along y 9010.
export function foundationHouse(): HouseSource {
  const t: HouseTile[] = [];
  const X0 = 9000, Y0 = 9000, X1 = 9009, Y1 = 9009;
  for (let x = X0; x <= X1; x++) for (let y = Y0; y <= Y1; y++) {
    if (x === X0 || x === X1 || y === Y0 || y === Y1) t.push([G.stoneWall, x, y, 0, 1], [G.stoneWall, x, y, 0, 1]);
    if (x !== X0 && y !== Y0) t.push([G.dirt, x, y, 7, 0]);
  }
  for (let x = X0 + 3; x <= X0 + 5; x++) for (let y = Y0 + 3; y <= Y0 + 5; y++) {
    if (x === X0 + 4 && y === Y0 + 4) continue;
    t.push(x === X0 + 4 && y === Y0 + 5 ? [G.door, x, y, 7, 1] : [G.woodWall, x, y, 7, 1]);
  }
  for (let x = X0; x <= X1; x++) t.push([G.stairs, x, Y1 + 1, 0, 0]);
  return source(t);
}

// A 7 x 7 walled room at (3000, 1000) with a 5 x 5 interior, a teleporter on the centre tile, and five metal chests (z 7, 11, 15, 19, 23) on each of the other 24 interior tiles: 120 chests. A 2nd floor over it.
export function vaultHouse(): { house: HouseSource; chests: HouseContainerInput[] } {
  const t: HouseTile[] = [], chests: HouseContainerInput[] = [];
  const X0 = 3000, Y0 = 1000;
  for (let x = X0; x <= X0 + 6; x++) for (let y = Y0; y <= Y0 + 6; y++) {
    const edge = x === X0 || x === X0 + 6 || y === Y0 || y === Y0 + 6;
    t.push([edge ? G.stoneWall : G.pavers, x, y, 7, edge ? 1 : 0]);
    t.push([G.planks, x, y, 27, 0]);
  }
  let serial = 0x40010000;
  for (let x = X0 + 1; x <= X0 + 5; x++) for (let y = Y0 + 1; y <= Y0 + 5; y++) {
    if (x === X0 + 3 && y === Y0 + 3) continue;
    for (const z of [7, 11, 15, 19, 23]) chests.push({ serial: serial++, name: "Metal Chest", facet: 1, x, y, z });
  }
  return { house: source(t, [[0x40000201, G.teleporter, X0 + 3, Y0 + 3, 7]]), chests };
}

// A 32 x 32 keep at (5000, 5000) with four walled levels (z 7, 27, 47, 67), an inner wall grid every 8 tiles with doorways, and 300 chests in stacks of 3 along the inner walls of every level. Used for the speed test.
export function castleHouse(): { house: HouseSource; chests: HouseContainerInput[] } {
  const t: HouseTile[] = [], chests: HouseContainerInput[] = [];
  const X0 = 5000, Y0 = 5000, N = 32;
  let serial = 0x40020000;
  for (const z of [7, 27, 47, 67]) {
    for (let x = X0; x < X0 + N; x++) for (let y = Y0; y < Y0 + N; y++) {
      const wall = (x - X0) % 8 === 0 || (y - Y0) % 8 === 0 || x === X0 + N - 1 || y === Y0 + N - 1;
      const doorway = ((x - X0) % 8 === 4 || (y - Y0) % 8 === 4) && x !== X0 && y !== Y0 && x !== X0 + N - 1 && y !== Y0 + N - 1;
      t.push([G.pavers, x, y, z, 0]);
      if (wall && !doorway) t.push([G.stoneWall, x, y, z, 1]);
    }
    for (let x = X0 + 1; x < X0 + N - 1 && chests.length < 300; x += 2) for (const y of [Y0 + 1, Y0 + 9, Y0 + 17, Y0 + 25]) {
      if (chests.length >= 300) break;
      for (const dz of [0, 4, 8]) chests.push({ serial: serial++, name: "Metal Chest", facet: 1, x, y, z: z + dz });
    }
  }
  return { house: source(t), chests: chests.slice(0, 300) };
}

// Paver floor tiles at z 7 for every spot in `floor`, stone walls at z 7 on every tile touching one (diagonals included), a door tile on each `doors` spot (which must also be floor), and `cover` (a roof or an upper floor) over every floor tile.
function walled(floor: Array<[number, number]>, doors: Array<[number, number]>, cover: { graphic: number; z: number }): HouseTile[] {
  const t: HouseTile[] = [], has = new Set(floor.map(([x, y]) => `${x}:${y}`)), walls = new Set<string>();
  for (const [x, y] of floor) {
    t.push([G.pavers, x, y, 7, 0], [cover.graphic, x, y, cover.z, 0]);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      const k = `${x + dx}:${y + dy}`;
      if (!has.has(k) && !walls.has(k)) { walls.add(k); t.push([G.stoneWall, x + dx, y + dy, 7, 1]); }
    }
  }
  for (const [x, y] of doors) t.push([G.door, x, y, 7, 1]);
  return t;
}
const rect = (x0: number, y0: number, x1: number, y1: number): Array<[number, number]> => {
  const r: Array<[number, number]> = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) r.push([x, y]);
  return r;
};

// A stair run climbing east from (x0, y) at z, one step per tile 5 z higher, each step standing on the filler blocks the client lays under every staircase (Surface tiles 10 high at z, z + 5, ...).
function stairRun(x0: number, y: number, z: number): HouseTile[] {
  const t: HouseTile[] = [];
  for (let i = 0; i < 4; i++) {
    t.push([G.stairs, x0 + i, y, z + 5 * i, 0]);
    for (let b = 0; b < i; b++) t.push([G.block, x0 + i, y, z + 5 * b, 0]);
  }
  return t;
}

// An 8 x 8 walled room at (2000, 3000) with a 2nd floor (z 27) over its 6 x 6 interior and a stair run climbing east along its north row: z 7, 12, 17, 22 at x 2001..2004, on its blocks.
export function stairHouse(): HouseSource {
  return source([...walled(rect(2001, 3001, 2006, 3006), [], { graphic: G.planks, z: 27 }), ...stairRun(2001, 3001, 7)]);
}

// An 8 x 8 walled box at (7000, 7000), three storeys floored at z 7, 27 and 47 and walled at each, with a stair run on its blocks from 7 to 22 along y 7001 and from 27 to 42 along y 7003.
export function towerHouse(): HouseSource {
  const ground = walled(rect(7001, 7001, 7006, 7006), [], { graphic: G.planks, z: 27 });
  const upper = ground.filter((t) => t[0] === G.stoneWall).flatMap(([g, x, y, , imp]): HouseTile[] => [[g, x, y, 27, imp], [g, x, y, 47, imp]]);
  return source([...ground, ...upper, ...rect(7001, 7001, 7006, 7006).map(([x, y]): HouseTile => [G.planks, x, y, 47, 0]), ...stairRun(7001, 7001, 7), ...stairRun(7001, 7003, 27)]);
}

// An 8 x 8 walled one-storey room at (4000, 4000) under a lean-to roof over its 6 x 6 interior: one row per z, rising 3 a row from z 27 in the north, as roof tiles climb in the client.
export function roofHouse(): HouseSource {
  return source(walled(rect(4001, 4001, 4006, 4006), [], { graphic: G.roof, z: 27 }).map((t): HouseTile => t[0] === G.roof ? [t[0], t[1], t[2], 27 + 3 * (t[2] - 4001), t[4]] : t));
}

// Two 6 x 6 rooms at (6001..6006, 7001..7006) and (6013..6018, 7001..7006) joined along y 7003 by a 1-wide corridor x 6008..6011, with doors at (6007, 7003) and (6012, 7003); all under a roof at z 27.
export function hallHouse(): HouseSource {
  const doors: Array<[number, number]> = [[6007, 7003], [6012, 7003]];
  const corridor: Array<[number, number]> = [[6008, 7003], [6009, 7003], [6010, 7003], [6011, 7003]];
  return source(walled([...rect(6001, 7001, 6006, 7006), ...corridor, ...doors, ...rect(6013, 7001, 6018, 7006)], doors, { graphic: G.roof, z: 27 }));
}
