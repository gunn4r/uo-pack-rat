// ui-sextant.test.mts — app/ui/sextant.mts (issue #164): the UO sextant reading of a world tile, as TazUO's Sextant.Format computes it, pinned against the centre, two readings UOGuide publishes for Britain, the lost lands' own centre, wrap-around at the east and south edges, and the places it has none. Tags: [fast]. Run: node --test app/ui-sextant.test.mts
import { test } from "node:test";
import assert from "node:assert/strict";
import { sextant, sextantText } from "./ui/sextant.mts";

const read = (facet: number | null, x: number, y: number): string | null => { const s = sextant(facet, x, y); return s ? sextantText(s) : null; };

test("[fast] sextant: Lord British's throne is the centre, as the client words it (south and east at zero)", () => {
  assert.deepEqual(sextant(1, 1323, 1624), { lat: 0, latMin: 0, south: true, long: 0, longMin: 0, east: true });
  assert.equal(read(0, 1323, 1624), "0°00'S 0°00'E");
});

test("[fast] sextant: Britain's First Bank and Public Library read as UOGuide lists them", () => {
  // UOGuide, Britain: First Bank Of Britain 6°03'S 7°56'E, Britain Public Library 2°32'N 6°49'E. Each is the only tile reading so.
  assert.equal(read(1, 1436, 1693), "6°03'S 7°56'E");
  assert.equal(read(1, 1420, 1595), "2°32'N 6°49'E");
});

test("[fast] sextant: west and north of the centre, and wrap-around past 180° at the east and south edges", () => {
  assert.equal(read(1, 0, 0), "142°44'N 93°01'W");
  // x 5119: (5119 - 1323) * 360 / 5120 = 266.9°, past 180 so -180 + 86.9 = 93.09° west.
  assert.equal(read(1, 5119, 1624), "0°00'S 93°05'W");
  // y 4095: (4095 - 1624) * 360 / 4096 = 217.2°, past 180 so -180 + 37.2 = 142.8° north.
  assert.equal(read(1, 1323, 4095), "142°49'N 0°00'E");
});

test("[fast] sextant: the lost lands of Felucca and Trammel have their own centre; the rest of their east has no reading", () => {
  assert.equal(read(0, 5936, 3112), "0°00'S 0°00'E");
  assert.equal(read(1, 5937, 3113), "0°05'S 0°04'E");
  assert.equal(read(1, 5500, 100), null, "north of the lost lands");
  assert.equal(read(0, 6500, 3000), null, "east of the lost lands");
});

test("[fast] sextant: the other facets share Britannia's centre inside their own size; an unknown facet or a tile outside has none", () => {
  assert.equal(read(3, 1323, 1624), "0°00'S 0°00'E");
  assert.equal(read(2, 100, 100), "133°56'N 85°59'W");
  assert.equal(read(3, 2560, 10), null, "Malas is 2560 wide");
  assert.equal(read(4, 1448, 0), null);
  assert.equal(read(null, 1323, 1624), null);
  assert.equal(read(6, 1323, 1624), null);
  assert.equal(read(1, -1, 5), null);
});
