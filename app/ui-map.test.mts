// ui-map.test.mts — app/ui/house-map-model.mts, the House map's pure rules (issue #10): the projection, tile and box polygons, the painter's order, a level's bounds and fit, the joins of a stack with the inventory and the Organize labels, the colour modes, the cut-away, callouts, totals, the house picker, keyboard moves, the plain grid, and the scene of a level (castle speed included). Tags: [fast]. Run: node --test app/ui-map.test.mts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildHouseModel } from "./house-model.mts";
import { fixtureTileData, vaultHouse } from "./house-fixture.mts";
import { project, tilePolygon, boxFaces, pts, paintOrder, boundsOf, fit, zoomAt, vbText, anchorOf, W } from "./ui/house-map-model.mts";

const td = fixtureTileData();
const vault = () => { const { house, chests } = vaultHouse(); return buildHouseModel(house, td, chests); };

test("[fast] house map: the game angle puts x right-down and y left-down and lifts z; top-down is x right, y down, no z", () => {
  assert.deepEqual(project(1, 0, 0, "angle"), [16, 16]);
  assert.deepEqual(project(0, 1, 0, "angle"), [-16, 16]);
  assert.deepEqual(project(0, 0, 5, "angle"), [0, -10]);
  assert.deepEqual(project(2, 3, 9, "top"), [64, 96]);
});

test("[fast] house map: a tile is four corners; a box shows its top and two sides at the game angle, only its top from above", () => {
  assert.equal(tilePolygon(0, 0, 0, "angle").length, 4);
  const a = boxFaces(0, 0, 0, 4, "angle"), t = boxFaces(0, 0, 0, 4, "top");
  assert.deepEqual([a.top.length, a.left.length, a.right.length], [4, 4, 4]);
  assert.deepEqual([t.top.length, t.left.length, t.right.length], [4, 0, 0]);
  assert.deepEqual(a.top[0], [0, -8], "the top sits h·K above the floor");
  assert.equal(pts([[1, 2], [3.25, 4]]), "1.0,2.0 3.3,4.0");
});

test("[fast] house map: the painter's order is back to front by x + y, then low to high", () => {
  const got = paintOrder([{ x: 2, y: 2, z: 0, n: "c" }, { x: 0, y: 1, z: 9, n: "b" }, { x: 1, y: 0, z: 0, n: "a" }, { x: 2, y: 2, z: -3, n: "d" }]);
  assert.deepEqual(got.map((o) => o.n), ["a", "b", "d", "c"]);
});

test("[fast] house map: a level's bounds hold every tile and stack, fit keeps them inside at the viewport's shape, and zoom keeps its centre", () => {
  const m = vault(), b = boundsOf(m, 0, "angle");
  const [x0, y0] = project(0, 0, 0, "angle"), [x1] = project(7, 0, 0, "angle");
  assert.ok(b.x < x0 && b.y < y0 && b.x + b.w > x1, JSON.stringify(b));
  const f = fit(b, { width: 800, height: 400 });
  assert.equal(+(f.w / f.h).toFixed(6), 2);
  assert.ok(f.x <= b.x && f.y <= b.y && f.x + f.w >= b.x + b.w && f.y + f.h >= b.y + b.h);
  const z = zoomAt(f, 0.5, f.x, f.y);
  assert.deepEqual([z.x, z.y, z.w, z.h], [f.x, f.y, f.w / 2, f.h / 2]);
  assert.equal(vbText({ x: 1, y: 2.25, w: 3, h: 4 }), "1.0 2.3 3.0 4.0");
  const s = m.stacks[0]!, [ax, ay] = anchorOf(m, s, "angle");
  assert.equal(ax, ((s.x - m.x0 + 0.5 - (s.y - m.y0 + 0.5)) * W) / 2);
  assert.ok(ay < project(s.x - m.x0 + 0.5, s.y - m.y0 + 0.5, 0, "angle")[1], "the callout anchors above the stack");
  assert.deepEqual(boundsOf({ ...m, cells: [], stacks: [] }, 0, "top"), { x: 0, y: 0, w: 4 * W, h: 4 * W });
});
