// house-model.test.mts — app/house-model.mts against synthetic houses (app/house-fixture.mts): levels, cells, the
// dirt-under-floor and foundation-lip rules, indoor and yard, rooms and doorways, furniture, stacks, standing spots,
// engraving codes, the no-tiledata fallback and a castle's speed. Tags: [fast]. Run: node --test app/house-model.test.mts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildHouseModel, letterOf, type HouseModel, type Cell } from "./house-model.mts";
import { G, fixtureTileData, courtyardHouse, stairHouse, roofHouse, hallHouse, vaultHouse, castleHouse } from "./house-fixture.mts";

const td = fixtureTileData();
const cell = (m: HouseModel, level: number, x: number, y: number): Cell | undefined => m.cells.find((c) => c.level === level && c.x === x && c.y === y);

test("[fast] house model: a courtyard house has a built ground floor and a floor-only 2nd floor", () => {
  const m = buildHouseModel(courtyardHouse(), td, []);
  assert.deepEqual(m.levels.map((l) => [l.name, l.floorZ, l.status]), [["Ground floor", 7, "built"], ["2nd floor", 27, "floor-only"]]);
  assert.deepEqual([m.x0, m.y0, m.x1, m.y1], [1000, 2000, 1017, 2018]);
  assert.equal(m.tiledata, true);
});

test("[fast] house model: the designed floor wins over the dirt laid under it; dirt shows where nothing else is", () => {
  const m = buildHouseModel(courtyardHouse(), td, []);
  assert.equal(cell(m, 0, 1002, 2002)!.material, "stone pavers");
  assert.equal(cell(m, 0, 1012, 2012)!.material, "grass");
});

test("[fast] house model: foundation walls under a floor are a lip, not a wall; building walls are walls", () => {
  const m = buildHouseModel(courtyardHouse(), td, []);
  const edge = cell(m, 0, 1012, 2017)!;
  assert.deepEqual([edge.kind, edge.lip], ["floor", true]);
  assert.equal(cell(m, 0, 1017, 2003)!.kind, "window");
  assert.equal(cell(m, 0, 1009, 2012)!.kind, "wall");
});

test("[fast] house model: under the 2nd floor is indoors, the courtyard is the yard", () => {
  const m = buildHouseModel(courtyardHouse(), td, []);
  assert.equal(cell(m, 0, 1002, 2002)!.indoor, true);
  assert.equal(cell(m, 0, 1012, 2012)!.indoor, false);
  const yard = m.rooms.find((r) => r.kind === "yard")!;
  assert.equal(yard.name, "Yard");
  assert.equal(cell(m, 0, 1012, 2012)!.room, yard.id);
});

test("[fast] house model: one indoor room on the ground floor is the Main room; the open 2nd floor is Open floor", () => {
  const m = buildHouseModel(courtyardHouse(), td, []);
  assert.deepEqual(m.rooms.filter((r) => r.kind === "room").map((r) => [r.level, r.name]), [[0, "Main room"], [1, "Open floor"]]);
  const main = m.rooms.find((r) => r.name === "Main room")!;
  assert.equal(cell(m, 0, 1002, 2002)!.room, main.id);
  assert.equal(cell(m, 0, 1002, 2011)!.room, main.id, "the west wing is part of the same open room");
});

test("[fast] house model: without tiledata, impassable house tiles are walls and the rest floor, and it still builds", () => {
  const m = buildHouseModel(courtyardHouse(), null, []);
  assert.equal(m.tiledata, false);
  assert.equal(cell(m, 0, 1009, 2012)!.kind, "wall");
  assert.equal(cell(m, 0, 1002, 2002)!.kind, "floor");
  assert.equal(cell(m, 0, 1002, 2002)!.material, "");
});

test("[fast] house model: stairs between floors stay on the lower level and do not merge the levels", () => {
  const m = buildHouseModel(stairHouse(), td, []);
  assert.deepEqual(m.levels.map((l) => [l.name, l.floorZ, l.status]), [["Ground floor", 7, "built"], ["2nd floor", 27, "floor-only"]]);
  assert.deepEqual([2001, 2002, 2003, 2004].map((x) => [cell(m, 0, x, 3001)!.kind, cell(m, 0, x, 3001)!.indoor]), Array(4).fill(["stair", true]));
  assert.equal(cell(m, 0, 2000, 3003)!.kind, "wall");
  assert.equal(cell(m, 0, 2003, 3004)!.indoor, true);
  assert.deepEqual(m.rooms.filter((r) => r.level === 0).map((r) => [r.kind, r.name, r.tiles]), [["room", "Main room", 36]]);
});

test("[fast] house model: a one-storey house under a roof is indoors, not a yard", () => {
  const m = buildHouseModel(roofHouse(), td, []);
  assert.deepEqual(m.levels.map((l) => [l.name, l.status]), [["Ground floor", "built"]]);
  assert.equal(cell(m, 0, 4003, 4003)!.indoor, true);
  assert.deepEqual(m.rooms.map((r) => [r.kind, r.name, r.tiles]), [["room", "Main room", 36]]);
});

test("[fast] house model: a 1-wide corridor between two rooms is a Hallway; the doors belong to no room", () => {
  const m = buildHouseModel(hallHouse(), td, []);
  assert.deepEqual(m.rooms.map((r) => [r.kind, r.name, r.tiles]), [["room", "West room", 36], ["room", "East room", 36], ["room", "Hallway", 4]]);
  const hall = m.rooms.find((r) => r.name === "Hallway")!;
  assert.deepEqual([6008, 6009, 6010, 6011].map((x) => cell(m, 0, x, 7003)!.room), Array(4).fill(hall.id));
  assert.deepEqual([cell(m, 0, 6007, 7003)!.room, cell(m, 0, 6012, 7003)!.room], [null, null]);
});

test("[fast] house model: a house with no tiles has zero bounds", () => {
  const m = buildHouseModel({ ...roofHouse(), tiles: [] }, td, []);
  assert.deepEqual([m.x0, m.y0, m.x1, m.y1, m.cells.length, m.rooms.length], [0, 0, 0, 0, 0, 0]);
});

test("[fast] house model: impassable furniture and doors are kept, passable decoration is not", () => {
  const m = buildHouseModel(courtyardHouse(), td, []);
  assert.deepEqual(m.furniture.map((f) => [f.kind, f.name, f.height]), [["block", "table", 6], ["door", "wooden door", 20]]);
  assert.equal(cell(m, 0, 1009, 2010)!.doorway, true);
  assert.deepEqual(buildHouseModel(courtyardHouse(), null, []).furniture, []);
});

test("[fast] house model: a door item splits rooms and stays out of the hallway like a door tile", () => {
  const h = hallHouse(), doors = h.tiles.filter((t) => t[0] === G.door);
  const m = buildHouseModel({ ...h, tiles: h.tiles.filter((t) => t[0] !== G.door), items: doors.map(([g, x, y, z], i) => [0x40000300 + i, g, x, y, z]) }, td, []);
  assert.deepEqual(m.rooms.map((r) => [r.name, r.tiles]), [["West room", 36], ["East room", 36], ["Hallway", 4]]);
  assert.deepEqual([cell(m, 0, 6007, 7003)!.room, cell(m, 0, 6012, 7003)!.room], [null, null]);
});

test("[fast] house model: a dense vault is one standing spot on the teleporter reaching all 120 chests", () => {
  const { house, chests } = vaultHouse();
  const m = buildHouseModel(house, td, chests);
  assert.equal(m.stacks.length, 24);
  assert.ok(m.stacks.every((s) => s.serials.length === 5));
  assert.deepEqual(m.spots.map((s) => [s.x, s.y, s.teleporter]), [[3003, 1003, true]]);
  assert.ok(m.stacks.every((s) => s.spot === 0));
  assert.equal(m.furniture[0]!.kind, "teleporter");
});

test("[fast] house model: codes run clockwise from north, inner ring first, height in the stack after the letter", () => {
  const { house, chests } = vaultHouse();
  const m = buildHouseModel(house, td, chests);
  const north = m.stacks.find((s) => s.x === 3003 && s.y === 1002)!, farNorth = m.stacks.find((s) => s.x === 3003 && s.y === 1001)!;
  assert.deepEqual([north.letter, north.direction, farNorth.letter], ["A", "N", "B"]);
  assert.equal(m.codes[String(north.serials[0])], "A1");
  assert.equal(m.codes[String(north.serials[4])], "A5");
  assert.equal(new Set(m.stacks.map((s) => s.letter)).size, 24);
});

test("[fast] house model: letters go A–Z, then AA, AB …, then AAA after ZZ", () => {
  assert.deepEqual([0, 25, 26, 27, 51, 52, 701, 702].map(letterOf), ["A", "Z", "AA", "AB", "AZ", "BA", "ZZ", "AAA"]);
});

test("[fast] house model: a container on another facet or outside the footprint is not in the house", () => {
  const { house, chests } = vaultHouse();
  const m = buildHouseModel(house, td, [chests[0]!, { ...chests[1]!, facet: 0 }, { ...chests[2]!, x: 4000 }]);
  assert.equal(m.stacks.reduce((a, s) => a + s.serials.length, 0), 1);
});

test("[fast] house model: a chest on a table and a table tile are never a standing spot", () => {
  const m = buildHouseModel(courtyardHouse(), td, [{ serial: 0x40000500, name: "Wooden Chest", facet: 1, x: 1003, y: 2003, z: 13 }]);
  assert.equal(m.stacks[0]!.serials.length, 1);
  assert.notDeepEqual([m.spots[0]!.x, m.spots[0]!.y], [1003, 2003]);
  assert.equal(m.stacks[0]!.spot, 0);
});

test("[fast] house model: a chest in a hallway is reached from the hallway and gets a code", () => {
  const m = buildHouseModel(hallHouse(), td, [{ serial: 0x40000600, name: "Wooden Chest", facet: 1, x: 6009, y: 7003, z: 7 }]);
  const hall = m.rooms.find((r) => r.name === "Hallway")!;
  assert.deepEqual([m.stacks[0]!.room, m.spots.length, m.spots[0]!.room, m.codes[String(0x40000600)]], [hall.id, 1, hall.id, "A"]);
});

test("[fast] house model: a castle (32 x 32, 4 levels, 300 chests) models in under 250 ms", () => {
  const { house, chests } = castleHouse();
  const t0 = performance.now();
  const m = buildHouseModel(house, td, chests);
  const ms = performance.now() - t0;
  assert.equal(m.levels.length, 4);
  assert.equal(m.stacks.reduce((a, s) => a + s.serials.length, 0), 300);
  assert.ok(m.stacks.every((s) => s.spot !== null), "every stack is reachable from some spot");
  assert.ok(ms < 250, `took ${ms.toFixed(0)} ms`);
});

test("[fast] house model: a tall stack reaching past the upper floor's z stays one stack on its bottom chest's level", () => {
  const { house, chests } = vaultHouse();
  const m = buildHouseModel(house, td, [...chests, { serial: 0x40000700, name: "Metal Chest", facet: 1, x: 3001, y: 1001, z: 27 }]);
  const s = m.stacks.find((t) => t.x === 3001 && t.y === 1001)!;
  assert.deepEqual([m.stacks.length, s.level, s.serials.length], [24, 0, 6]);
  assert.deepEqual(s.serials.map((n) => m.codes[String(n)]), [1, 2, 3, 4, 5, 6].map((h) => `${s.letter}${h}`));
});

test("[fast] house model: chests a storey apart on one tile are two stacks on two levels", () => {
  const { house } = vaultHouse();
  const m = buildHouseModel(house, td, [7, 27].map((z, i) => ({ serial: 0x40000710 + i, name: "Metal Chest", facet: 1, x: 3001, y: 1001, z })));
  assert.deepEqual(m.stacks.map((s) => [s.level, s.serials.length]), [[0, 1], [1, 1]]);
  const same = buildHouseModel(house, td, [7, 22].map((z, i) => ({ serial: 0x40000710 + i, name: "Metal Chest", facet: 1, x: 3001, y: 1001, z })));
  assert.deepEqual(same.stacks.map((s) => [s.level, s.serials.length]), [[0, 1], [0, 1]], "a storey's gap splits even within one level");
});

test("[fast] house model: letters run room by room, not in pick order", () => {
  const chest = (i: number, x: number, z: number) => ({ serial: 0x40000720 + i, name: "Wooden Chest", facet: 1, x, y: 7002, z });
  const m = buildHouseModel(hallHouse(), td, [chest(0, 6002, 7), chest(1, 6014, 7), chest(2, 6014, 11)]);
  const west = m.rooms.find((r) => r.name === "West room")!;
  assert.deepEqual(m.stacks.map((s) => [s.room === west.id, s.letter]), [[true, "A"], [false, "B"]]);
  assert.deepEqual(m.spots.map((s) => s.room), [west.id, m.rooms.find((r) => r.name === "East room")!.id]);
});

test("[fast] house model: a teleporter holding a chest is not a standing spot", () => {
  const { house, chests } = vaultHouse();
  const m = buildHouseModel(house, td, [...chests, { serial: 0x40000730, name: "Metal Chest", facet: 1, x: 3003, y: 1003, z: 7 }]);
  assert.ok(m.spots.every((s) => !s.teleporter));
});

test("[fast] house model: the model does not depend on the order of tiles, items or containers", () => {
  let seed = 7;
  const shuffle = <T,>(xs: T[]): T[] => { const r = [...xs]; for (let i = r.length - 1; i > 0; i--) { seed = (seed * 1103515245 + 12345) % 2147483648; const j = seed % (i + 1); [r[i], r[j]] = [r[j]!, r[i]!]; } return r; };
  const pick = (m: HouseModel) => ({ cells: m.cells, rooms: m.rooms, furniture: m.furniture, spots: m.spots, stacks: m.stacks, codes: m.codes });
  const { house: castle, chests } = castleHouse();
  for (const [house, cs] of [[castle, chests], [courtyardHouse(), [{ serial: 0x40000500, name: "Wooden Chest", facet: 1, x: 1003, y: 2003, z: 13 }]]] as const) {
    const want = pick(buildHouseModel(house, td, [...cs]));
    for (const order of [<T,>(xs: readonly T[]): T[] => [...xs].reverse(), <T,>(xs: readonly T[]): T[] => shuffle([...xs])]) {
      assert.deepEqual(pick(buildHouseModel({ ...house, tiles: order(house.tiles), items: order(house.items) }, td, order(cs))), want);
    }
  }
});
