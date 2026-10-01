// house-fixture.mts — synthetic houses for the house model's tests (issue #10): no game data, every graphic
// below is made up and described by the synthetic tiledata built here.
import { FLAG, readTileData, type TileData } from "./tiledata.mts";
import { syntheticTileData } from "./tiledata-fixture.mts";
import { houseIdOf, type HouseSource, type HouseTile, type HouseItem } from "./house-capture.mts";
import type { HouseContainerInput } from "./house-model.mts";

export const G = { dirt: 1, pavers: 2, grass: 3, planks: 4, stoneWall: 5, brickWall: 6, window: 7, stairs: 8, roof: 9, table: 10, door: 11, teleporter: 12, rug: 13, banister: 14 } as const;

export function fixtureTileData(): TileData {
  return readTileData(syntheticTileData([
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
  ]));
}

const source = (tiles: HouseTile[], items: HouseItem[] = []): HouseSource =>
  ({ id: houseIdOf(1, tiles), facet: 1, capturedAt: "2026-10-01T12:00:00Z", tiles, items, captures: 1 });

// A plot of 18 x 19 tiles at (1000, 2000). Ground level z 7: the building is the north part (y 2001..2007, full width) plus a west wing (x 1001..1008, y 2008..2012); the rest of the plot is the courtyard. Walls at z 7 ring the building; walls at z 0 ring the whole plot (the foundation's edge). Every designed floor tile has a dirt tile under it at the same z. The 2nd floor (z 27) covers exactly the building and has no walls. Front steps along y 2018. A door in the wing's east wall at (1009, 2010); a table at (1003, 2003); a rug at (1004, 2004).
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
