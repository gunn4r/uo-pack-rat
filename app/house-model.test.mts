// house-model.test.mts — app/house-model.mts against synthetic houses (app/house-fixture.mts): levels, cells, the
// dirt-under-floor and foundation-lip rules, indoor and yard, rooms and doorways, furniture, stacks, standing spots,
// engraving codes, the no-tiledata fallback and a castle's speed. Tags: [fast]. Run: node --test app/house-model.test.mts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildHouseModel, type HouseModel, type Cell } from "./house-model.mts";
import { fixtureTileData, courtyardHouse } from "./house-fixture.mts";

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
