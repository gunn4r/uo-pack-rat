// house-capture.test.mts — app/house-capture.mts: house ids, the newest capture per house, furniture merged across captures from different spots (a capture that could not read the ground changing none), superseded footprints. Tags: [fast]. Run: node --test app/house-capture.test.mts
import { test } from "node:test";
import assert from "node:assert/strict";
import { houseIdOf, latestHouses, type HouseCapture, type HouseTile } from "./house-capture.mts";
import type { ScanV2 } from "./schema/types.d.mts";

const tiles = (x0: number, y0: number): HouseTile[] => [[1, x0, y0, 7, 0], [1, x0 + 5, y0 + 5, 7, 0]];
const scan = (capturedAt: string, house: { [K in keyof HouseCapture]?: HouseCapture[K] | undefined } | null): ScanV2 => ({
  schemaVersion: 2, character: "Tester", scannedAt: capturedAt, roots: [], containers: {}, items: [], equipped: [],
  ...(house ? { house: { capturedAt, at: { x: 100, y: 100 }, tiles: tiles(100, 100), items: [], facet: 1, ...house } } : {}),
} as unknown as ScanV2);

test("[fast] house capture: the id is the facet and the footprint's corner", () => {
  assert.equal(houseIdOf(1, tiles(100, 200)), "1-100-200");
  assert.equal(houseIdOf(undefined, tiles(100, 200)), "x-100-200");
});

test("[fast] house capture: the newest capture of a house gives its tiles; another footprint is another house", () => {
  const houses = latestHouses([
    scan("2026-10-01T10:00:00Z", { tiles: [[1, 100, 100, 7, 0]] }),
    scan("2026-10-01T12:00:00Z", { tiles: [[2, 100, 100, 7, 0]] }),
    scan("2026-10-01T11:00:00Z", { tiles: tiles(300, 300) }),
    scan("2026-10-01T13:00:00Z", null),
  ]);
  assert.deepEqual(houses.map((h) => [h.id, h.capturedAt, h.tiles[0]![0], h.captures]), [["1-100-100", "2026-10-01T12:00:00Z", 2, 2], ["1-300-300", "2026-10-01T11:00:00Z", 1, 1]]);
});

test("[fast] house capture: furniture merges across captures; a capture that should have seen an item and did not drops it", () => {
  const [h] = latestHouses([
    scan("2026-10-01T10:00:00Z", { at: { x: 100, y: 100 }, items: [[11, 5, 101, 101, 7], [12, 5, 130, 130, 7]] }),
    scan("2026-10-01T12:00:00Z", { at: { x: 102, y: 102 }, items: [[13, 5, 103, 103, 7]] }),
  ]);
  assert.deepEqual(h!.items.map((i) => i[0]), [12, 13], "11 was in reach of the newer capture and gone; 12 was out of its reach");
});

test("[fast] house capture: a capture that could not read the ground (no items) erases no furniture and adds none", () => {
  const unread = JSON.parse(JSON.stringify(scan("2026-10-01T12:00:00Z", { tiles: [[2, 100, 100, 7, 0]], items: undefined }))) as ScanV2;
  assert.equal("items" in unread.house!, false);
  const [h] = latestHouses([scan("2026-10-01T10:00:00Z", { items: [[11, 5, 101, 101, 7]] }), unread]);
  assert.deepEqual([h!.items.map((i) => i[0]), h!.tiles[0]![0], h!.captures], [[11], 2, 2]);
});

test("[fast] house capture: a newer capture of another footprint overlapping a house on the same facet supersedes it (a redesign or a move)", () => {
  const houses = latestHouses([
    scan("2026-10-01T10:00:00Z", { tiles: [[1, 100, 100, 7, 0], [1, 105, 105, 7, 0]] }),
    scan("2026-10-01T12:00:00Z", { tiles: [[1, 99, 100, 7, 0], [1, 105, 105, 7, 0]] }),
    scan("2026-10-01T11:00:00Z", { tiles: tiles(300, 300) }),
    scan("2026-10-01T13:00:00Z", { facet: 2, tiles: [[1, 98, 100, 7, 0], [1, 105, 105, 7, 0]] }),
    scan("2026-10-01T14:00:00Z", { facet: undefined, tiles: [[1, 97, 100, 7, 0], [1, 105, 105, 7, 0]] }),
  ]);
  assert.deepEqual(houses.map((h) => h.id), ["1-300-300", "1-99-100", "2-98-100", "x-97-100"], "another facet, or an unknown one, supersedes nothing");
});

test("[fast] house capture: a malformed capturedAt sorts as the oldest capture", () => {
  const [h] = latestHouses([
    scan("2026-10-01T10:00:00Z", { tiles: [[1, 100, 100, 7, 0]] }),
    scan("not a date", { tiles: [[2, 100, 100, 7, 0]] }),
  ]);
  assert.equal(h!.tiles[0]![0], 1);
});

test("[fast] house capture: chests seen but not opened merge like furniture, and a capture without the list erases none", () => {
  const unread = JSON.parse(JSON.stringify(scan("2026-10-01T13:00:00Z", { at: { x: 101, y: 101 }, containers: undefined }))) as ScanV2;
  assert.equal("containers" in unread.house!, false);
  const [h] = latestHouses([
    scan("2026-10-01T10:00:00Z", { at: { x: 100, y: 100 }, containers: [[21, 0x0E7C, 101, 101, 7], [22, 0x0E7C, 130, 130, 7]] }),
    scan("2026-10-01T12:00:00Z", { at: { x: 102, y: 102 }, containers: [[23, 0x0E7C, 103, 103, 7]] }),
    unread,
  ]);
  assert.deepEqual(h!.containers.map((c) => c[0]), [22, 23], "21 was in reach of the 12:00 capture and gone; the 13:00 capture read no ground");
});
