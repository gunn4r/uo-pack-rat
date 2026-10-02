// ui-world-map.test.mts — app/ui/world-map-model.mts (issue #164), the world map lightbox's pure rules: the first view (the facet fitted, nudged toward the house within the slack), zoom about a point between the fit and 2 screen px per tile, panning by screen pixels, keeping the facet in view, the region to request in whole tiles at screen resolution, screen positions, and the markers at a zoom with their labels kept from overlapping. Tags: [fast]. Run: node --test app/ui-world-map.test.mts
import { test } from "node:test";
import assert from "node:assert/strict";
import { firstView, zoomAnchor, zoomView, panView, clampView, toScreen, toWorld, overlayRequest, worldMarkers, pxPerTile, MAX_PX_PER_TILE, LABEL_PX_PER_TILE } from "./ui/world-map-model.mts";
import type { HouseSummary } from "./ui/api-types.mts";

const FACET = { width: 7168, height: 4096 }, VP = { width: 1400, height: 800 };
const close = (a: number, b: number, why: string): void => assert.ok(Math.abs(a - b) < 1e-6, `${why}: ${a} vs ${b}`);

test("[fast] world map: the first view fits the whole facet in its middle, and the zoom keys zoom about the house while it is in view", () => {
  const v = firstView(FACET, VP);
  close(v.w / v.h, VP.width / VP.height, "the viewport's shape");
  assert.ok(v.w >= FACET.width && v.h >= FACET.height, "the whole facet is in view");
  assert.ok(v.x <= 0 && v.x + v.w >= FACET.width && v.y <= 0 && v.y + v.h >= FACET.height);
  const tall = firstView({ width: 1280, height: 4096 }, VP);
  close(tall.h, 4096, "fitted on height");
  close(tall.x + tall.w / 2, 640, "the facet in the middle, the slack on both sides");
  assert.deepEqual(zoomAnchor(v, [3000, 1000]), [3000, 1000]);
  assert.deepEqual(zoomAnchor({ x: 0, y: 0, w: 700, h: 400 }, [3000, 1000]), [350, 200], "out of view: the view's centre");
});

test("[fast] world map: zoom keeps the point under the cursor, between the fit and 2 screen px per tile", () => {
  const fitV = firstView(FACET, VP);
  const at: [number, number] = [3000, 1000];
  const z = zoomView(fitV, 0.5, at, FACET, VP);
  close(z.w, fitV.w / 2, "half as wide");
  const before = toScreen(fitV, VP, at), after = toScreen(z, VP, at);
  close(before[0], after[0], "x stays under the cursor");
  close(before[1], after[1], "y stays under the cursor");
  let deep = fitV;
  for (let i = 0; i < 40; i++) deep = zoomView(deep, 0.5, at, FACET, VP);
  close(pxPerTile(deep, VP), MAX_PX_PER_TILE, "stops at 2 px per tile");
  let out = z;
  for (let i = 0; i < 10; i++) out = zoomView(out, 2, [0, 0], FACET, VP);
  close(out.w, fitV.w, "never wider than the fit");
  assert.ok(out.x <= 0 && out.x + out.w >= FACET.width, "and the facet is back in view");
});

test("[fast] world map: panning moves by screen pixels and stops at the facet's edges", () => {
  const z = zoomView(firstView(FACET, VP), 0.1, [3000, 1000], FACET, VP);
  const k = z.w / VP.width;
  const p = panView(z, -100, 50, FACET, VP);
  close(p.x, z.x + 100 * k, "dragging left shows more east");
  close(p.y, z.y - 50 * k, "dragging down shows more north");
  const west = panView(z, 1e7, 0, FACET, VP);
  close(west.x, 0, "stops at the west edge");
  const south = panView(z, 0, -1e7, FACET, VP);
  close(south.y + south.h, FACET.height, "stops at the south edge");
  assert.deepEqual(clampView({ x: -50, y: 5000, w: 700, h: 400 }, FACET), { x: 0, y: 3696, w: 700, h: 400 });
});

test("[fast] world map: the region to request is the visible tiles, whole and inside the facet, at screen resolution capped at 2048", () => {
  const v = { x: 100.4, y: 200.6, w: 700, h: 400 };
  assert.deepEqual(overlayRequest(v, VP, FACET), { x0: 100, y0: 200, x1: 801, y1: 601, size: 1402 });
  assert.deepEqual(overlayRequest({ x: -10, y: -10, w: 70, h: 40 }, VP, FACET), { x0: 0, y0: 0, x1: 60, y1: 30, size: 1200 }, "cut to the facet, scaled to its screen size");
  assert.equal(overlayRequest({ x: 0, y: 0, w: 7168, h: 4096 }, { width: 5000, height: 2857 }, FACET)!.size, 2048, "capped");
  assert.equal(overlayRequest({ x: 8000, y: 0, w: 100, h: 50 }, VP, FACET), null, "nothing of the facet in view");
});

test("[fast] world map: screen and world positions round-trip", () => {
  const v = { x: 1000, y: 500, w: 700, h: 400 };
  assert.deepEqual(toScreen(v, VP, [1350, 700]), [700, 400]);
  assert.deepEqual(toWorld(v, VP, [700, 400]), [1350, 700]);
});

const house = (id: string, facet: number, x0: number, y0: number, name?: string): HouseSummary => ({ id, facet, capturedAt: "", captures: 1, width: 18, height: 18, plot: { x0, y0, x1: x0 + 17, y1: y0 + 17 }, levels: 1, containers: 0, ...(name ? { name } : {}) });

test("[fast] world map: markers at a zoom sit at each house's centre tile in screen pixels; the house shown is labelled always, others once zoomed in, never overlapping", () => {
  const houses = [house("1-1000-1000", 1, 1000, 1000, "Main house"), house("1-1004-1000", 1, 1004, 1000, "Next door"), house("1-1300-1000", 1, 1300, 1000), house("3-1000-1000", 3, 1000, 1000, "Malas forge"), house("1-5000-3000", 1, 5000, 3000)];
  const fitV = firstView(FACET, VP);
  const far = worldMarkers(houses, "1-1000-1000", 1, fitV, VP);
  assert.deepEqual(far.map((m) => m.id), ["1-1004-1000", "1-1300-1000", "1-5000-3000", "1-1000-1000"], "this facet only, the house shown last (on top)");
  assert.deepEqual(far.map((m) => m.showLabel), [false, false, false, true]);
  assert.deepEqual(toScreen(fitV, VP, [1008.5, 1008.5]), [far[3]!.sx, far[3]!.sy]);
  assert.equal(far[2]!.label, "Trammel house at 5008, 3008");
  assert.equal(far[3]!.label, "Main house");
  const near = { x: 900, y: 900, w: VP.width / LABEL_PX_PER_TILE / 4, h: VP.height / LABEL_PX_PER_TILE / 4 };
  const ms = worldMarkers(houses, "1-1000-1000", 1, near, VP);
  const by = (id: string) => ms.find((m) => m.id === id)!;
  assert.equal(by("1-1000-1000").showLabel, true);
  assert.equal(by("1-1004-1000").showLabel, false, "its label would sit on the house shown's");
  assert.equal(by("1-1300-1000").showLabel, true, "far enough apart to be labelled");
  assert.ok(!ms.some((m) => m.id === "1-5000-3000"), "well outside the view: left out");
});
