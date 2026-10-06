// facet-map.test.mts — `app/facet-map.mts` (issue #164): decoding a facetNN.mul overview bitmap and cutting a region out of it.
//
// `app/facet-map.mts` (issue #164) on synthetic `facetNN.mul` files built in the test (`app/facet-fixture.mts`): the runs of every row read to one colour per tile with no pixel buffer kept (the file's bytes and each row's start); a region in the middle skipping the runs before it; an empty or truncated file, a row short of or past the width, a zero or negative size, a side over 8192, a header claiming more rows than the file could hold, a byte count that is odd, negative or past the end, and trailing bytes all decoding to null without throwing; a region at its own width widening 5-bit colours to 8, a narrower width box-averaging with the aspect ratio kept, and a tall region capped in height too. All `[fast]`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeFacet, renderRegion } from "./facet-map.mts";
import { syntheticFacet, rgb555 } from "./facet-fixture.mts";

const RED = rgb555(31, 0, 0), BLUE = rgb555(0, 0, 31), WHITE = rgb555(31, 31, 31);

// A tile's colour as renderRegion draws it at full size: 5-bit channels widened to 8.
const rgb8 = (c: number): number[] => [(c >> 10) & 31, (c >> 5) & 31, c & 31].map((v) => Math.round((v * 255) / 31));

test("[fast] facet map: decodes the runs of every row into one colour per tile, keeping only the file and where each row starts", () => {
  const buf = syntheticFacet(4, 2, [[[3, RED], [1, BLUE]], [[1, WHITE], [0, RED], [3, BLUE]]]);
  const f = decodeFacet(buf);
  assert.ok(f);
  assert.equal(f.width, 4);
  assert.equal(f.height, 2);
  assert.equal(f.buf, buf, "no copy and no pixel buffer");
  assert.deepEqual([...f.rowStart], [8, 18]);
  assert.deepEqual([...renderRegion(f, { x0: 0, y0: 0, x1: 4, y1: 2 }, 1024).rgb], [RED, RED, RED, BLUE, WHITE, BLUE, BLUE, BLUE].flatMap(rgb8));
});

test("[fast] facet map: a region in the middle skips the runs before it and stops at its end", () => {
  const f = decodeFacet(syntheticFacet(6, 3, [[[2, RED], [2, BLUE], [2, WHITE]], [[1, BLUE], [4, WHITE], [1, RED]], [[6, RED]]]))!;
  assert.deepEqual([...renderRegion(f, { x0: 2, y0: 1, x1: 5, y1: 2 }, 1024).rgb], [WHITE, WHITE, WHITE].flatMap(rgb8));
  assert.deepEqual([...renderRegion(f, { x0: 1, y0: 0, x1: 3, y1: 3 }, 1024).rgb], [RED, BLUE, WHITE, WHITE, RED, RED].flatMap(rgb8));
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
    ["wider than 8192 (its one row adds up)", syntheticFacet(8193, 1, [[...Array.from({ length: 32 }, (): [number, number] => [249, RED]), [225, RED]]])],
    ["a header claiming more rows than the file could hold", syntheticFacet(4, 4000, [[[4, RED]]])],
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

test("[fast] facet map: a tall region is capped in height too, the aspect ratio kept", () => {
  const f = decodeFacet(syntheticFacet(2, 40, Array.from({ length: 40 }, () => [[2, BLUE]] as Array<[number, number]>)))!;
  const r = renderRegion(f, { x0: 0, y0: 0, x1: 2, y1: 40 }, 10);
  assert.deepEqual([r.width, r.height], [1, 10]);
  assert.deepEqual([...r.rgb.subarray(0, 3)], rgb8(BLUE));
});

test("[fast] facet map: a narrower width box-averages the tiles and keeps the aspect ratio", () => {
  const f = decodeFacet(syntheticFacet(4, 4, Array.from({ length: 4 }, () => [[1, RED], [1, BLUE], [2, WHITE]] as Array<[number, number]>)))!;
  const r = renderRegion(f, { x0: 0, y0: 0, x1: 4, y1: 4 }, 2);
  assert.equal(r.width, 2);
  assert.equal(r.height, 2);
  // Left half: red and blue averaged; right half: white.
  assert.deepEqual([...r.rgb.subarray(0, 6)], [128, 0, 128, 255, 255, 255]);
});
