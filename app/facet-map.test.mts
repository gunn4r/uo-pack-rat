// facet-map.test.mts — app/facet-map.mts (issue #164): decoding a facetNN.mul overview bitmap built byte by byte (a good file, and truncated or inconsistent ones that decode to null), and cutting a region out of it at a smaller width by box average. Tags: [fast]. Run: node --test app/facet-map.test.mts
import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeFacet, renderRegion } from "./facet-map.mts";
import { syntheticFacet, rgb555 } from "./facet-fixture.mts";

const RED = rgb555(31, 0, 0), BLUE = rgb555(0, 0, 31), WHITE = rgb555(31, 31, 31);

test("[fast] facet map: decodes the runs of every row into one colour per tile", () => {
  const f = decodeFacet(syntheticFacet(4, 2, [[[3, RED], [1, BLUE]], [[1, WHITE], [0, RED], [3, BLUE]]]));
  assert.ok(f);
  assert.equal(f.width, 4);
  assert.equal(f.height, 2);
  assert.deepEqual([...f.pixels], [RED, RED, RED, BLUE, WHITE, BLUE, BLUE, BLUE]);
});

test("[fast] facet map: a truncated or inconsistent file decodes to null and never throws", () => {
  const good = syntheticFacet(4, 2, [[[4, RED]], [[2, RED], [2, BLUE]]]);
  const bad: Array<[string, Buffer]> = [
    ["empty", Buffer.alloc(0)],
    ["header cut", good.subarray(0, 3)],
    ["a row missing", good.subarray(0, 4 + 7)],
    ["a run cut short", good.subarray(0, good.length - 1)],
    ["a row short of the width", syntheticFacet(4, 1, [[[3, RED]]])],
    ["a row past the width", syntheticFacet(4, 1, [[[3, RED], [2, BLUE]]])],
    ["zero width", syntheticFacet(0, 1, [[]])],
    ["negative height", syntheticFacet(4, -1, [])],
  ];
  // A byte count that is not a whole number of runs, and one larger than the file.
  const odd = Buffer.from(good); odd.writeInt32LE(4, 4);
  const huge = Buffer.from(good); huge.writeInt32LE(0x7fffffff, 4);
  const negative = Buffer.from(good); negative.writeInt32LE(-3, 4);
  bad.push(["odd byte count", odd], ["byte count past the end", huge], ["negative byte count", negative]);
  for (const [why, buf] of bad) assert.equal(decodeFacet(buf), null, why);
});

test("[fast] facet map: trailing bytes after the last row are refused", () => {
  const good = syntheticFacet(2, 1, [[[2, RED]]]);
  assert.ok(decodeFacet(good));
  assert.equal(decodeFacet(Buffer.concat([good, Buffer.alloc(2)])), null);
});

test("[fast] facet map: a region at its own width is the tiles' colours, 5 bits widened to 8", () => {
  const f = decodeFacet(syntheticFacet(4, 2, [[[1, RED], [1, BLUE], [2, WHITE]], [[4, BLUE]]]))!;
  const r = renderRegion(f, { x0: 1, y0: 0, x1: 3, y1: 2 }, 100);
  assert.equal(r.width, 2, "never wider than the region");
  assert.equal(r.height, 2);
  assert.deepEqual([...r.rgb], [0, 0, 255, 255, 255, 255, 0, 0, 255, 0, 0, 255]);
});

test("[fast] facet map: a narrower width box-averages the tiles and keeps the aspect ratio", () => {
  const f = decodeFacet(syntheticFacet(4, 4, Array.from({ length: 4 }, () => [[1, RED], [1, BLUE], [2, WHITE]] as Array<[number, number]>)))!;
  const r = renderRegion(f, { x0: 0, y0: 0, x1: 4, y1: 4 }, 2);
  assert.equal(r.width, 2);
  assert.equal(r.height, 2);
  // Left half: red and blue averaged; right half: white.
  assert.deepEqual([...r.rgb.subarray(0, 6)], [128, 0, 128, 255, 255, 255]);
});
