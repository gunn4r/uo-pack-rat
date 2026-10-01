// house-model.test.mts — app/house-model.mts against synthetic houses (app/house-fixture.mts): levels, cells, the
// dirt-under-floor and foundation-lip rules, indoor and yard, rooms and doorways, furniture, stacks, standing spots,
// engraving codes, the no-tiledata fallback and a castle's speed. Tags: [fast]. Run: node --test app/house-model.test.mts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildHouseModel, type HouseModel, type Cell } from "./house-model.mts";
import { fixtureTileData, courtyardHouse, stairHouse, roofHouse, hallHouse } from "./house-fixture.mts";

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
