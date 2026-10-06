// tiledata.test.mts — `app/tiledata.mts` (issue #10): reading a 7.x tiledata.mul, classifying a tile the way the house map draws it, and finding the file.
//
// `app/tiledata.mts` (issue #10) against synthetic 7.x tiledata.mul files built byte by byte: an item graphic's flags, height and name (a 20-character name with no terminator read whole), a file of the wrong layout refused, `classify` (door, stair, roof, window, wall, floor, block, other, and impassable = wall without the file), finding the UO folder through TazUO's launcher profiles (a profile whose folder has no tiledata.mul passed over, and with several profiles the newest one's folder winning), and `loadTileData`'s cache by mtime and size. All `[fast]`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readTileData, classify, uoFolderFromTazuo, loadTileData, FLAG, LAND_BYTES } from "./tiledata.mts";
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

function tazuoLayout(): { root: string; scripts: string; profiles: string } {
  const root = mkdtempSync(join(tmpdir(), "pr-tazuo-"));
  const scripts = join(root, "TazUO", "LegionScripts"), profiles = join(root, "Profiles", "Settings");
  mkdirSync(scripts, { recursive: true }); mkdirSync(profiles, { recursive: true });
  return { root, scripts, profiles };
}

test("[fast] tiledata: finds the UO folder named in a TazUO launcher profile", () => {
  const { root, scripts, profiles } = tazuoLayout();
  const uo = join(root, "UO");
  mkdirSync(uo); writeFileSync(join(uo, "tiledata.mul"), syntheticTileData([]));
  writeFileSync(join(profiles, "a.json"), "\ufeff" + JSON.stringify({ ultimaonlinedirectory: uo + "/" }));
  writeFileSync(join(profiles, "a.json.bak-20260917"), JSON.stringify({ ultimaonlinedirectory: "/nowhere" }));
  assert.equal(uoFolderFromTazuo(scripts), uo + "/");
});

test("[fast] tiledata: with several launcher profiles the newest one's UO folder wins", () => {
  const { root, scripts, profiles } = tazuoLayout();
  const t = Date.now() / 1000;
  for (const [name, age] of [["a-older", 3600], ["b-oldest", 7200], ["c-newest", 60]] as const) {   // the newest sorts last by name, so only the mtime order picks it
    const uo = join(root, name);
    mkdirSync(uo); writeFileSync(join(uo, "tiledata.mul"), syntheticTileData([]));
    writeFileSync(join(profiles, `${name}.json`), JSON.stringify({ ultimaonlinedirectory: uo }));
    utimesSync(join(profiles, `${name}.json`), t - age, t - age);
  }
  assert.equal(uoFolderFromTazuo(scripts), join(root, "c-newest"));
});

test("[fast] tiledata: a profile naming a folder without tiledata.mul is passed over; none found is null", () => {
  const { root, scripts, profiles } = tazuoLayout();
  writeFileSync(join(profiles, "old.json"), JSON.stringify({ ultimaonlinedirectory: join(root, "gone") }));
  writeFileSync(join(profiles, "bad.json"), "{not json");
  assert.equal(uoFolderFromTazuo(scripts), null);
  assert.equal(uoFolderFromTazuo(join(root, "no", "such", "dir")), null);
});

test("[fast] tiledata: loadTileData caches by mtime and size and answers null for a bad file", () => {
  const dir = mkdtempSync(join(tmpdir(), "pr-td-"));
  const file = join(dir, "tiledata.mul");
  writeFileSync(file, syntheticTileData([{ graphic: 5, flags: FLAG.wall, height: 20, name: "stone wall" }]));
  const a = loadTileData(file);
  assert.equal(a!.info(5)!.name, "stone wall");
  assert.equal(loadTileData(file), a, "same file, same object");
  writeFileSync(file, syntheticTileData([{ graphic: 5, flags: FLAG.wall, height: 20, name: "brick wall" }]));
  utimesSync(file, new Date(), new Date(Date.now() + 5000));
  assert.equal(loadTileData(file)!.info(5)!.name, "brick wall");
  writeFileSync(file, Buffer.alloc(10));
  utimesSync(file, new Date(), new Date(Date.now() + 10000));
  assert.equal(loadTileData(file), null);
  assert.equal(loadTileData(join(dir, "missing.mul")), null);
});
