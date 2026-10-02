// house-names.test.mts — app/house-names.mts, <data>/house-map.json (issue #164): the name rules (trimmed, 1 to 60 characters, no control characters, empty removes), the optional bounds, unknown entry fields kept, the atomic write, and a corrupt file moved aside. Tags: [fast]. Run: node --test app/house-names.test.mts
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { checkHouseEntry, isHouseId, readHouseMap, writeHouseMap, withHouseEntry, emptyHouseMap, MAX_HOUSES, MAX_HOUSE_MAP_BYTES, type HouseMapDoc } from "./house-names.mts";

test("[fast] house names: a name is trimmed, 1 to 60 characters, with no control characters; an empty one removes the entry", () => {
  assert.deepEqual(checkHouseEntry({ name: "  Main house  " }), { ok: true, entry: { name: "Main house" } });
  assert.deepEqual(checkHouseEntry({ name: "x".repeat(60) }), { ok: true, entry: { name: "x".repeat(60) } });
  assert.deepEqual(checkHouseEntry({ name: "   " }), { ok: true, entry: null });
  assert.deepEqual(checkHouseEntry({ name: "" }), { ok: true, entry: null });
  for (const bad of [{ name: "x".repeat(61) }, { name: "Main\nhouse" }, { name: "a\u0007b" }, { name: "a\u007fb" }, { name: "a\u2028b" }, { name: "a\u2029b" }, { name: "a\u202eb" }, { name: "a\u202ab" }, { name: "a\u2066b" }, { name: "a\u2069b" }, { name: 5 }, {}, null, [], "Main"]) {
    const r = checkHouseEntry(bad);
    assert.equal(r.ok, false, JSON.stringify(bad));
  }
  assert.match((checkHouseEntry({ name: "x".repeat(61) }) as { error: string }).error, /1 to 60 characters/);
  assert.match((checkHouseEntry({ name: "a\tb" }) as { error: string }).error, /control characters/);
  assert.deepEqual(checkHouseEntry({ name: "Forge 👩\u200d🔧" }), { ok: true, entry: { name: "Forge 👩\u200d🔧" } }, "a zero-width joiner is kept");
});

test("[fast] house names: bounds are optional integers on a facet, and unknown entry fields are kept", () => {
  const bounds = { x0: 10, y0: 20, x1: 27, y1: 37, facet: 1 };
  assert.deepEqual(checkHouseEntry({ name: "Forge", bounds, rooms: { a: 1 } }), { ok: true, entry: { name: "Forge", bounds, rooms: { a: 1 } } });
  assert.deepEqual(checkHouseEntry({ name: "Forge", bounds: { ...bounds, facet: null } }), { ok: true, entry: { name: "Forge", bounds: { ...bounds, facet: null } } });
  for (const b of [{ ...bounds, x0: 1.5 }, { ...bounds, y1: "3" }, { x0: 1, y0: 2 }, [], 7]) assert.equal(checkHouseEntry({ name: "Forge", bounds: b }).ok, false, JSON.stringify(b));
});

test("[fast] house names: an id is <facet>-<x>-<y>, the facet a number or x", () => {
  for (const id of ["1-3000-1000", "x-5-6", "0-0-0"]) assert.equal(isHouseId(id), true, id);
  for (const id of ["plain", "1-3000", "../etc", "1-a-2", "-1-2-3", "1-2-3-4", ""]) assert.equal(isHouseId(id), false, id);
});

test("[fast] house names: write then read round-trips atomically, an entry set to null is removed, and a missing file reads empty", () => {
  const dir = mkdtempSync(join(tmpdir(), "pr-names-")), file = join(dir, "house-map.json");
  assert.deepEqual(readHouseMap(file), { doc: emptyHouseMap(), problem: null });
  let doc = withHouseEntry(emptyHouseMap(), "1-3000-1000", { name: "Main house", notes: "kept" });
  doc = withHouseEntry(doc, "3-10-20", { name: "Forge" });
  assert.equal(writeHouseMap(file, doc), null);
  assert.deepEqual(readHouseMap(file).doc, { version: 1, houses: { "1-3000-1000": { name: "Main house", notes: "kept" }, "3-10-20": { name: "Forge" } } });
  writeHouseMap(file, withHouseEntry(doc, "3-10-20", null));
  assert.deepEqual(Object.keys(readHouseMap(file).doc.houses), ["1-3000-1000"]);
  assert.deepEqual(readdirSync(dir), ["house-map.json"], "no temp file is left behind");
});

test("[fast] house names: a write is refused, leaving the file as it was, past MAX_HOUSES names or past the size a read accepts", () => {
  const dir = mkdtempSync(join(tmpdir(), "pr-names-")), file = join(dir, "house-map.json");
  const many: HouseMapDoc = { version: 1, houses: Object.fromEntries(Array.from({ length: MAX_HOUSES + 1 }, (_, i) => [`1-${i}-0`, { name: `H${i}` }])) };
  assert.match(writeHouseMap(file, many) ?? "", new RegExp(`at most ${MAX_HOUSES} houses`));
  const big: HouseMapDoc = { version: 1, houses: { "1-1-1": { name: "Big", notes: "x".repeat(MAX_HOUSE_MAP_BYTES) } } };
  assert.match(writeHouseMap(file, big) ?? "", /larger than 1 MB/);
  assert.equal(existsSync(file), false);
});

test("[fast] house names: a corrupt file is renamed .corrupt and reads empty; a bad entry in a good file is dropped", () => {
  const dir = mkdtempSync(join(tmpdir(), "pr-names-")), file = join(dir, "house-map.json");
  for (const body of ["{not json", JSON.stringify({ version: 2, houses: {} }), JSON.stringify([1])]) {
    writeFileSync(file, body);
    const r = readHouseMap(file);
    assert.deepEqual(r.doc, emptyHouseMap(), body);
    assert.match(r.problem ?? "", /moved to house-map\.json\.corrupt/, body);
    assert.equal(existsSync(file), false);
  }
  assert.equal(readFileSync(`${file}.corrupt`, "utf8"), "{not json", "an older .corrupt is never overwritten");
  writeFileSync(file, JSON.stringify({ version: 1, houses: { "1-1-1": { name: "Good" }, "1-2-2": { name: "bad\u0001" }, "nope": { name: "Bad id" } } }));
  const r = readHouseMap(file);
  assert.deepEqual(r.doc.houses, { "1-1-1": { name: "Good" } });
  assert.match(r.problem ?? "", /2 entries/);
  assert.equal(readFileSync(file, "utf8").includes("Bad id"), true, "a salvage read leaves the file alone");
});
