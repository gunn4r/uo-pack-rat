// house-names.test.mts — `app/house-names.mts`, the house names and drawn areas in `<data>/house-map.json` (issue #164).
//
// `[fast]`: `app/house-names.mts`, `<data>/house-map.json` (issue #164): the name rules (trimmed, 1 to 60 characters, no control characters, empty removes), optional integer bounds, unknown entry fields kept; the drawn areas (issue #10): id, trimmed name, level, a palette colour and rectangles checked (each refusal by its reason), unknown area fields kept, an area-only house kept with an empty name and no name and no areas removing the entry, rectangles allowed 8 tiles past the bounds and no further, at most 32 areas and 16 rectangles with the largest entry under the PUT cap, a round trip through the file (a bad area drops its house's entry on read), and areas carried over to a redesigned house's bounds; the house-id shape, an atomic round trip, and a corrupt file moved aside as `.corrupt` (an older one never overwritten) while a bad entry in a good file is left out of the read; a map a newer Pack Rat made read and marked read-only, never moved aside.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { checkHouseEntry, isHouseId, readHouseMap, saveHouseEntry, emptyHouseMap, MAX_HOUSES, MAX_HOUSE_MAP_BYTES, MAX_AREAS, MAX_RECTS, AREA_COLORS, AREA_MARGIN, MAX_ENTRY_BYTES, type HouseMapDoc, type HouseArea } from "./house-names.mts";

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

const B = { x0: 100, y0: 200, x1: 117, y1: 217, facet: 1 };
const area = (o: Partial<HouseArea> = {}): HouseArea => ({ id: "a1", name: "Reagents", level: 0, color: "area-1", rects: [{ x0: 101, y0: 201, x1: 104, y1: 203 }], ...o });
const err = (v: unknown): string => { const r = checkHouseEntry(v); assert.equal(r.ok, false, JSON.stringify(v)); return (r as { error: string }).error; };

test("[fast] house areas: an area is an id, a trimmed name, a level, a palette colour and rectangles; unknown fields on the entry and the area are kept", () => {
  const r = checkHouseEntry({ name: "Forge", bounds: B, areas: [area({ name: "  Reagents ", note: "kept" }), area({ id: "b-2_x", level: 1, color: "area-8", rects: [{ x0: 110, y0: 210, x1: 110, y1: 210 }, { x0: 100, y0: 200, x1: 117, y1: 217 }] })], notes: "kept" });
  assert.deepEqual(r, { ok: true, entry: { name: "Forge", bounds: B, notes: "kept", areas: [area({ note: "kept" }), area({ id: "b-2_x", level: 1, color: "area-8", rects: [{ x0: 110, y0: 210, x1: 110, y1: 210 }, { x0: 100, y0: 200, x1: 117, y1: 217 }] })] } });
  assert.deepEqual(AREA_COLORS, ["area-1", "area-2", "area-3", "area-4", "area-5", "area-6", "area-7", "area-8"]);
});

test("[fast] house areas: a house with areas and no name is kept with an empty name; no name and no areas removes the entry", () => {
  assert.deepEqual(checkHouseEntry({ name: "  ", bounds: B, areas: [area()] }), { ok: true, entry: { name: "", bounds: B, areas: [area()] } });
  assert.deepEqual(checkHouseEntry({ name: "", bounds: B, areas: [] }), { ok: true, entry: null });
  assert.deepEqual(checkHouseEntry({ name: "Forge", bounds: B, areas: [] }), { ok: true, entry: { name: "Forge", bounds: B } }, "an empty list is not stored");
});

test("[fast] house areas: bad names, ids, levels, colours and rectangles are refused", () => {
  assert.match(err({ name: "", bounds: B, areas: [area({ name: " " })] }), /1 to 60 characters/);
  assert.match(err({ name: "", bounds: B, areas: [area({ name: "x".repeat(61) })] }), /1 to 60 characters/);
  assert.match(err({ name: "", bounds: B, areas: [area({ name: "a\nb" })] }), /control characters/);
  assert.match(err({ name: "", bounds: B, areas: [area({ name: 5 as unknown as string })] }), /name must be a string/);
  for (const id of ["", "a b", "x".repeat(25), 7, "a/b"]) assert.match(err({ name: "", bounds: B, areas: [area({ id: id as string })] }), /id/, String(id));
  assert.match(err({ name: "", bounds: B, areas: [area(), area({ name: "Other" })] }), /share the id a1/);
  for (const level of [-1, 1.5, 16, "0"]) assert.match(err({ name: "", bounds: B, areas: [area({ level: level as number })] }), /level/, String(level));
  for (const color of ["area-0", "area-9", "#ff0000", "red", "var(--x)", null]) assert.match(err({ name: "", bounds: B, areas: [area({ color: color as string })] }), /color must be one of area-1/, String(color));
  for (const rects of [[], "x", [{ x0: 101, y0: 201, x1: 100, y1: 203 }], [{ x0: 101, y0: 201, x1: 102 }], [{ x0: 101.5, y0: 201, x1: 102, y1: 203 }], [7]]) assert.ok(err({ name: "", bounds: B, areas: [area({ rects: rects as HouseArea["rects"] })] }), JSON.stringify(rects));
  assert.match(err({ name: "", bounds: B, areas: "x" }), /must be a list/);
  assert.match(err({ name: "", bounds: B, areas: [7] }), /must be an object/);
  assert.match(err({ name: "Forge", areas: [area()] }), /need the house's bounds/);
});

test("[fast] house areas: a rectangle may reach a few tiles past the house's bounds, no further", () => {
  const ok = (r: HouseArea["rects"][number]): boolean => checkHouseEntry({ name: "", bounds: B, areas: [area({ rects: [r] })] }).ok;
  assert.equal(ok({ x0: B.x0 - AREA_MARGIN, y0: B.y0 - AREA_MARGIN, x1: B.x1 + AREA_MARGIN, y1: B.y1 + AREA_MARGIN }), true);
  assert.equal(ok({ x0: B.x0 - AREA_MARGIN - 1, y0: B.y0, x1: B.x0, y1: B.y0 }), false);
  assert.equal(ok({ x0: B.x1, y0: B.y1, x1: B.x1, y1: B.y1 + AREA_MARGIN + 1 }), false);
  assert.match(err({ name: "", bounds: B, areas: [area({ rects: [{ x0: 5000, y0: 5000, x1: 5001, y1: 5001 }] })] }), /lie on the house/);
});

test("[fast] house areas: at most 32 areas a house and 16 rectangles an area; the largest entry fits the PUT cap", () => {
  const rects = Array.from({ length: MAX_RECTS }, (_, i) => ({ x0: 100 + i, y0: 200, x1: 100 + i, y1: 217 }));
  const many = Array.from({ length: MAX_AREAS }, (_, i) => area({ id: `area-${i}`, name: "👩\u200d🔧".repeat(12), color: AREA_COLORS[i % 8]!, rects }));
  const full = checkHouseEntry({ name: "x".repeat(60), bounds: B, areas: many });
  assert.equal(full.ok, true);
  assert.ok(Buffer.byteLength(JSON.stringify((full as { entry: unknown }).entry)) < MAX_ENTRY_BYTES, "the biggest valid entry fits the PUT body cap");
  assert.match(err({ name: "", bounds: B, areas: [...many, area({ id: "one-more" })] }), /at most 32 areas/);
  assert.match(err({ name: "", bounds: B, areas: [area({ rects: [...rects, rects[0]!] })] }), /1 to 16 rectangles/);
});

test("[fast] house areas: the entry round-trips through the file, and a corrupt area drops only its house's entry on read", () => {
  const dir = mkdtempSync(join(tmpdir(), "pr-names-")), file = join(dir, "house-map.json");
  assert.equal(saveHouseEntry(file, emptyHouseMap(), "1-100-200", { name: "", bounds: B, areas: [area()] }), null);
  assert.deepEqual(readHouseMap(file).doc.houses, { "1-100-200": { name: "", bounds: B, areas: [area()] } });
  writeFileSync(file, JSON.stringify({ version: 1, houses: { "1-100-200": { name: "Good", bounds: B, areas: [area()] }, "1-1-1": { name: "Bad", bounds: B, areas: [area({ color: "#f00" })] } } }));
  const r = readHouseMap(file);
  assert.deepEqual(Object.keys(r.doc.houses), ["1-100-200"]);
  assert.match(r.problem ?? "", /1 entry/);
});

test("[fast] house areas: carried over to a redesigned house (a new id, an overlapping footprint), the areas save under the new bounds", () => {
  const dir = mkdtempSync(join(tmpdir(), "pr-names-")), file = join(dir, "house-map.json");
  assert.equal(saveHouseEntry(file, emptyHouseMap(), "1-108-208", { name: "Forge", bounds: B, areas: [area()] }), null);
  const old = readHouseMap(file).doc.houses["1-108-208"]!, moved = { x0: 98, y0: 199, x1: 115, y1: 216, facet: 1 };
  const carried = checkHouseEntry({ name: old.name, bounds: moved, areas: old.areas });
  assert.equal(carried.ok, true);
  assert.equal(saveHouseEntry(file, readHouseMap(file).doc, "1-106-207", (carried as { entry: HouseMapDoc["houses"][string] }).entry), null);
  assert.deepEqual(readHouseMap(file).doc.houses["1-106-207"], { name: "Forge", bounds: moved, areas: [area()] });
});

test("[fast] house names: an id is <facet>-<x>-<y>, the facet a number or x", () => {
  for (const id of ["1-3000-1000", "x-5-6", "0-0-0"]) assert.equal(isHouseId(id), true, id);
  for (const id of ["plain", "1-3000", "../etc", "1-a-2", "-1-2-3", "1-2-3-4", ""]) assert.equal(isHouseId(id), false, id);
});

test("[fast] house names: write then read round-trips atomically, an entry set to null is removed, and a missing file reads empty", () => {
  const dir = mkdtempSync(join(tmpdir(), "pr-names-")), file = join(dir, "house-map.json");
  assert.deepEqual(readHouseMap(file), { doc: emptyHouseMap(), problem: null, readOnly: null });
  assert.equal(saveHouseEntry(file, emptyHouseMap(), "1-3000-1000", { name: "Main house", notes: "kept" }), null);
  assert.equal(saveHouseEntry(file, readHouseMap(file).doc, "3-10-20", { name: "Forge" }), null);
  assert.deepEqual(readHouseMap(file).doc, { version: 1, houses: { "1-3000-1000": { name: "Main house", notes: "kept" }, "3-10-20": { name: "Forge" } } });
  assert.equal(saveHouseEntry(file, readHouseMap(file).doc, "3-10-20", null), null);
  assert.deepEqual(Object.keys(readHouseMap(file).doc.houses), ["1-3000-1000"]);
  assert.deepEqual(readdirSync(dir), ["house-map.json"], "no temp file is left behind");
});

test("[fast] house names: a change that grows a full map is refused, leaving the file as it was; clearing or shortening a name always goes through", () => {
  const dir = mkdtempSync(join(tmpdir(), "pr-names-")), file = join(dir, "house-map.json");
  const many: HouseMapDoc = { version: 1, houses: Object.fromEntries(Array.from({ length: MAX_HOUSES }, (_, i) => [`1-${i}-0`, { name: `House ${i}` }])) };
  assert.match(saveHouseEntry(file, many, "1-9999-0", { name: "One more" }) ?? "", new RegExp(`at most ${MAX_HOUSES} houses`));
  assert.equal(existsSync(file), false);
  assert.equal(saveHouseEntry(file, many, "1-7-0", { name: "Renamed" }), null, "renaming a named house is no new id");
  assert.equal(saveHouseEntry(file, many, "1-8-0", null), null, "clearing a name");
  // Over the size a read accepts (a file grown by hand, say): a change that does not grow it still saves.
  const big: HouseMapDoc = { version: 1, houses: { "1-1-1": { name: "Big", notes: "x".repeat(MAX_HOUSE_MAP_BYTES) }, "1-2-2": { name: "A long name here" } } };
  assert.match(saveHouseEntry(file, big, "1-3-3", { name: "New" }) ?? "", /larger than 1 MB/);
  assert.match(saveHouseEntry(file, big, "1-2-2", { name: "A longer name than before" }) ?? "", /larger than 1 MB/);
  assert.equal(saveHouseEntry(file, big, "1-2-2", { name: "Short" }), null, "shortening a name");
  assert.equal(saveHouseEntry(file, big, "1-2-2", null), null, "clearing a name");
});

test("[fast] house names: a corrupt file is renamed .corrupt and reads empty; a bad entry in a good file is dropped", () => {
  const dir = mkdtempSync(join(tmpdir(), "pr-names-")), file = join(dir, "house-map.json");
  for (const body of ["{not json", JSON.stringify({ version: "2", houses: {} }), JSON.stringify([1])]) {
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

test("[fast] house names: a map made by a newer Pack Rat is read as far as this build understands it and marked read-only, never moved aside", () => {
  const dir = mkdtempSync(join(tmpdir(), "pr-names-")), file = join(dir, "house-map.json");
  writeFileSync(file, JSON.stringify({ version: 2, houses: { "1-1-1": { name: "Good", future: true }, "nope": { name: "Bad id" } }, more: [] }));
  const r = readHouseMap(file);
  assert.deepEqual(r.doc, { version: 1, houses: { "1-1-1": { name: "Good", future: true } } });
  assert.equal(r.readOnly, "house-map.json was made by a newer Pack Rat (version 2); it is read-only here until Pack Rat is updated");
  assert.deepEqual(readdirSync(dir), ["house-map.json"]);
  writeFileSync(file, JSON.stringify({ version: 1, houses: {} }));
  assert.equal(readHouseMap(file).readOnly, null);
});
