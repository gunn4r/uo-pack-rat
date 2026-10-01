// tiledata.test.mts — app/tiledata.mts: reading a 7.x tiledata.mul's item entries (flags, height, name), classifying a tile the way the house map draws it, and finding the file through TazUO's launcher profiles. Tags: [fast]. Run: node --test app/tiledata.test.mts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readTileData, classify, FLAG, LAND_BYTES } from "./tiledata.mts";
import { syntheticTileData } from "./tiledata-fixture.mts";

test("[fast] tiledata: reads flags, height and name of an item graphic", () => {
  const td = readTileData(syntheticTileData([{ graphic: 40, flags: FLAG.impassable | FLAG.surface, height: 6, name: "table" }]));
  assert.equal(td.count, 64);
  assert.deepEqual(td.info(40), { flags: FLAG.impassable | FLAG.surface, height: 6, name: "table" });
  assert.deepEqual(td.info(41), { flags: 0n, height: 0, name: "" });
  assert.equal(td.info(64), null, "past the end");
  assert.equal(td.info(-1), null);
  assert.equal(td.info(1.5), null);
});

test("[fast] tiledata: a 20-character name with no terminator is read whole", () => {
  const td = readTileData(syntheticTileData([{ graphic: 3, flags: 0n, name: "ornate elven booksh" + "e" }]));
  assert.equal(td.info(3)!.name, "ornate elven bookshe");
});

test("[fast] tiledata: refuses a file that is not the 7.x layout", () => {
  assert.throws(() => readTileData(Buffer.alloc(LAND_BYTES + 100)), /not a 7\.x tiledata/);
});

test("[fast] tiledata: classify follows door, stair, roof, window, wall, floor, block, other", () => {
  const t = (flags: bigint, name = "x") => ({ flags, height: 0, name });
  assert.equal(classify(t(FLAG.door | FLAG.wall | FLAG.impassable), true), "door");
  assert.equal(classify(t(FLAG.stairBack | FLAG.surface), false), "stair");
  assert.equal(classify(t(FLAG.surface, "stone stairs"), false), "stair");
  assert.equal(classify(t(FLAG.roof | FLAG.impassable), true), "roof");
  assert.equal(classify(t(FLAG.window | FLAG.wall), true), "window");
  assert.equal(classify(t(FLAG.wall | FLAG.impassable), true), "wall");
  assert.equal(classify(t(FLAG.surface, "wooden planks"), false), "floor");
  assert.equal(classify(t(FLAG.impassable, "wooden banister"), true), "block");
  assert.equal(classify(t(0n, "nodraw"), false), "other");
});

test("[fast] tiledata: without the file, an impassable tile is a wall and anything else a floor", () => {
  assert.equal(classify(null, true), "wall");
  assert.equal(classify(null, false), "floor");
});
