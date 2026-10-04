// ui-map.test.mts — app/ui/house-map-model.mts, the House map's pure rules (issue #10): the projection, tile and box polygons, the painter's order, a level's bounds and fit, the joins of a stack with the inventory and the Organize labels, the colour modes, the cut-away, callouts, totals, the house picker, keyboard moves, the plain grid, the scene of a level (castle speed included), the drawn areas (issue #10: which area holds a chest, the screen-to-tile inverse, rectangles, outlines, label spots, ids, colours, the drawing cursor, carry-over), and (issue #164) where a house is: its centre tile and copy line, the facet overview's crop, its markers and why it may be missing; and the search on the map (issue #10: its route, an item's container on the floor, the matches by container and stack, the left pane's counts, the callouts' row, the view it zooms to, which house holds a container and the matches elsewhere). Tags: [fast]. Run: node --test app/ui-map.test.mts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildHouseModel } from "./house-model.mts";
import { fixtureTileData, vaultHouse, roofHouse, courtyardHouse, castleHouse, foundationHouse, stairHouse, G } from "./house-fixture.mts";
import type { Container, Item } from "./vault-lib.mts";
import type { HouseArea, HouseModel, Stack } from "./ui/api-types.mts";
import { project, tilePolygon, boxFaces, pts, paintOrder, boundsOf, fit, zoomAt, vbText, anchorOf, W, chestViews, colourOf, legendOf, chestLabel, cutAway, calloutLines, houseTotals, pickHouse, houseLabel, houseName, carryOver, carryOverText, PLAIN, chestCount, nearestInDirection, tiledataNote, stackWhere, plainGrid, sceneOf, drawnZs, CHEST_H, whereOf, whereTitle, FACET_SIZE, cropAround, facetMapUrl, markersOf, facetMapNote, parseRegion, markerRadii, contentsOf, contentsSummary, filterContents, drawerChest, drawerMeta, slotsText, drawerPicker, DRAWER_TABS_MAX, parseMapHash, mapHash, floorContainerOf, positionWords, houseHits, levelHits, levelHitText, areaHitText, hitsSummary, searchCount, calloutHead, calloutRow, CALLOUT_W, CALLOUT_MIN, hitsView, houseIndex, elsewhereOf, outsideText, DRAWER_W, DRAWER_MIN, drawerMax, clampDrawer, drawerKey, piecesOf, frontCorner, fitLabel, pillsOf, placePill, LABEL_FIT, areaOfStack, levelAreas, restName, unproject, tileAt, rectOf, sizeText, unionTiles, coveredCells, outlineOf, nextAreaId, nextAreaColor, moveCursor, clampTile, liveAreas, withOrphans, redrawFailed, AREA_COLORS, AREA_COLOR_NAMES, type ChestView, type ContentsNode } from "./ui/house-map-model.mts";

const td = fixtureTileData();
const has = (cls: string, c: string): boolean => cls.split(" ").includes(c);
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

// An inventory the way GET /api/inventory carries it, for ground chests at these places; chest i holds i % 126 of 125 items.
function invOf(rows: Array<{ serial: number; x: number; y: number; z: number; facet?: number | null; name?: string; tooltip?: string[] }>) {
  const containers: Record<string, Container> = {}, rootCounts: Record<string, number> = {};
  rows.forEach((r, i) => {
    containers[String(r.serial)] = { serial: r.serial, kind: "ground", name: r.name ?? "Metal Chest", parent: null, root: r.serial, tooltip: r.tooltip ?? [r.name ?? "Metal Chest"], pos: r.facet == null ? { x: r.x, y: r.y, z: r.z } : { x: r.x, y: r.y, z: r.z, facet: r.facet },
      capacity: { items: i % 126, maxItems: 125, stones: null, maxStones: null }, scannedBy: "Tester", scannedAt: "2026-10-01T12:00:00Z" };
    rootCounts[String(r.serial)] = i % 126;
  });
  return { containers, rootCounts };
}
// The shape of a real house the maintainer showed: nine stacks around one standing spot, six of them four high.
function ringHouse(): HouseModel {
  const around: Array<[number, number, number]> = [[4002, 4002, 4], [4003, 4002, 4], [4004, 4002, 4], [4004, 4003, 4], [4004, 4004, 4], [4003, 4004, 4], [4002, 4004, 1], [4002, 4003, 1], [4005, 4005, 1]];
  let serial = 0x40050000;
  const chests = around.flatMap(([x, y, n]) => Array.from({ length: n }, (_, h) => ({ serial: serial++, name: "Wooden Chest", facet: 1, x, y, z: 7 + 4 * h })));
  return buildHouseModel(roofHouse(), td, chests);
}

test("[fast] house map: a stack's chests top first, named by label, else by engraving or name without its serial, else the seen-only chest's tiledata name", () => {
  const { house, chests } = vaultHouse();
  const seen = { serial: 0x40000900, name: "metal chest", facet: 1, x: 3003, y: 1002, z: 27, opened: false };
  const m = buildHouseModel(house, td, [...chests, seen]);
  const inv = invOf(chests.map((c, i) => ({ ...c, tooltip: i === 1 ? ["Metal Chest", "Engraved: Gems"] : ["Metal Chest"] })));
  inv.containers[String(chests[2]!.serial)]!.label = "Metal Chest (0x40010002)";
  const s = m.stacks.find((x) => x.x === 3001 && x.y === 1001)!;
  const v = chestViews(m, s, inv, { [String(chests[0]!.serial)]: { serial: chests[0]!.serial, name: "Reagents", color: "#2f7f7f", origin: "manual" } });
  assert.deepEqual(v.map((c) => c.serial), [...s.serials].reverse(), "top first");
  const bottom = v[4]!;
  assert.deepEqual([bottom.name, bottom.inGame, bottom.color, bottom.code, bottom.fill, bottom.items, bottom.opened, bottom.z], ["Reagents", "Metal Chest", "#2f7f7f", `${s.letter}1`, { items: 0, max: 125 }, 0, true, 7]);
  assert.deepEqual([v[3]!.name, v[2]!.name], ["Gems", "Metal Chest"]);
  const up = chestViews(m, m.stacks.find((x) => x.serials.includes(seen.serial))!, inv, {})[0]!;
  assert.deepEqual([up.name, up.opened, up.fill, up.items], ["metal chest", false, null, 0]);
  assert.equal(chestLabel(bottom), `${s.letter}1 Reagents, 0 of 125 items`);
  assert.equal(chestLabel(up), `${up.code} metal chest, not opened yet`);
});

test("[fast] house map: Contents colours by label (unlabelled neutral, empty pale, unopened its own); Free space by how full", () => {
  const c = (over: Partial<ChestView>): ChestView => ({ serial: 1, code: "A", name: "x", inGame: "x", color: null, fill: { items: 10, max: 100 }, opened: true, items: 10, z: 7, ...over });
  assert.deepEqual(colourOf(c({ color: "#2f7f7f" }), "contents"), { label: "#2f7f7f" });
  assert.deepEqual(colourOf(c({}), "contents"), { token: "--color-map-chest" });
  assert.deepEqual(colourOf(c({ fill: { items: 0, max: 100 } }), "contents"), { token: "--color-map-chest-empty" });
  assert.deepEqual(colourOf(c({ opened: false, color: "#2f7f7f" }), "contents"), { token: "--color-map-unopened" });
  const free = (items: number | null) => colourOf(c(items == null ? { fill: null } : { fill: { items, max: 100 } }), "free");
  assert.deepEqual([free(0), free(49), free(50), free(89), free(90), free(null)].map((x) => (x as { token: string }).token),
    ["--color-map-free-empty", "--color-map-free-half", "--color-map-free-filling", "--color-map-free-filling", "--color-map-free-full", "--color-map-free-unknown"]);
  assert.deepEqual(legendOf("free").map((l) => l.text), ["Empty", "Under half full", "Filling", "90% or more full", "Fill unknown"]);
  assert.equal(legendOf("contents")[0]!.token, null, "the label line has no swatch of its own");
});

test("[fast] house map: the cut-away fades the stacks in front of the focused one, within three tiles on its level", () => {
  const m = vault(), inner = m.stacks.find((s) => s.x === 3002 && s.y === 1002)!;
  const cut = cutAway(m, 0, inner);
  assert.ok(cut.size > 0);
  for (const s of m.stacks) assert.equal(cut.has(s.letter), s.x + s.y > inner.x + inner.y && Math.abs(s.x - inner.x) <= 3 && Math.abs(s.y - inner.y) <= 3, s.letter);
  assert.equal(cutAway(m, 0, m.stacks.find((s) => s.x === 3005 && s.y === 1005)!).size, 0, "nothing stands in front of the front corner");
});

test("[fast] house map: a callout lists a stack's chests top first with their fill; totals count slots, empty, full and not opened", () => {
  const m = ringHouse(), s = m.stacks.find((x) => x.serials.length === 4)!;
  const inv = invOf(m.stacks.flatMap((st) => st.serials.map((serial, h) => ({ serial, x: st.x, y: st.y, z: st.zs[h]! }))));
  const v = chestViews(m, s, inv, {}), c = calloutLines(s, v, "contents");
  assert.equal(c.title, `Stack ${s.letter}, top first`);
  assert.deepEqual(c.lines.map((l) => l.code), [4, 3, 2, 1].map((h) => `${s.letter}${h}`));
  assert.match(c.lines[0]!.fill, /^\d+\/125$/);
  const all = m.stacks.flatMap((st) => chestViews(m, st, inv, {})), t = houseTotals(all);
  assert.deepEqual([m.stacks.length, m.spots.length, t.containers, t.capacity, t.unopened], [9, 1, 27, 27 * 125, 0]);
  assert.equal(t.used, all.reduce((a, x) => a + x.fill!.items, 0));
  assert.equal(t.empty, 1, "chest 0 holds nothing");
  assert.deepEqual(houseTotals([{ ...v[0]!, opened: false, fill: null }, { ...v[0]!, fill: null }]), { containers: 2, used: 0, capacity: 0, empty: 0, full: 0, unopened: 1, unknown: 1 });
  assert.equal(chestCount(m), 27);
  assert.equal(m.levels.reduce((a, l) => a + chestCount(m, l.index), 0), 27, "a level's count; the levels add up to the house");
  assert.equal(chestCount(m, m.levels.length), 0, "a level with no stacks");
  assert.match(stackWhere(m, s), new RegExp(`^Whole floor · [NESW]+ of standing spot 1 · 4 containers, top first$`));
  const area: HouseArea = { id: "a1", name: "Reagents", level: 0, color: "area-1", rects: [{ x0: s.x, y0: s.y, x1: s.x, y1: s.y }] };
  assert.match(stackWhere(m, s, [area]), /^Reagents · /);
  assert.match(stackWhere(m, m.stacks.find((x) => x !== s)!, [area]), /^Everything else · /);
});

test("[fast] house map: the picker takes the deep-linked house, else the last one shown, else the one with the most chests; the plain grid only when nothing else", () => {
  const houses = [{ id: "1-1-1", containers: 3 }, { id: "1-9-9", containers: 120 }, { id: PLAIN, containers: 500 }];
  assert.equal(pickHouse(houses, "1-1-1", null), "1-1-1");
  assert.equal(pickHouse(houses, "1-5-5", null), "1-9-9", "a deep link to a house that no longer exists falls back");
  assert.equal(pickHouse(houses, "1-5-5", "1-1-1"), "1-1-1");
  assert.equal(pickHouse(houses, PLAIN, null), PLAIN);
  assert.equal(pickHouse([{ id: PLAIN, containers: 2 }], null, null), PLAIN);
  assert.equal(pickHouse([], null, null), null);
});

test("[fast] house map: an arrow key moves to the nearest stack that way, preferring the straightest", () => {
  const c = [{ id: "R", at: [40, 2] as [number, number] }, { id: "D", at: [0, 30] as [number, number] }, { id: "RD", at: [25, 25] as [number, number] }, { id: "L", at: [-50, 0] as [number, number] }];
  assert.equal(nearestInDirection([0, 0], c, "right"), "R");
  assert.equal(nearestInDirection([0, 0], c, "down"), "D");
  assert.equal(nearestInDirection([0, 0], c, "left"), "L");
  assert.equal(nearestInDirection([0, 0], c, "up"), null);
});

test("[fast] house map: the no-tiledata note names its reason, and there is none with tiledata", () => {
  assert.equal(tiledataNote(null), null);
  for (const r of ["no-client", "no-tazuo-profile", "override-missing", "unreadable"] as const) assert.match(tiledataNote(r)!, /plain colors/, r);
  assert.match(tiledataNote("no-client")!, /No game client is set up/);
});

test("[fast] house map: ground chests outside every drawn house group by facet and distance onto a plain grid", () => {
  const v = vault(), housed = v.stacks[0]!.serials[0]!;
  const inv = invOf([
    { serial: housed, x: v.stacks[0]!.x, y: v.stacks[0]!.y, z: v.stacks[0]!.zs[0]!, facet: 1 },    // in the vault: drawn there, not here
    { serial: 0x40060002, x: 100, y: 100, z: 0, facet: 1 }, { serial: 0x40060003, x: 100, y: 100, z: 4, facet: 1 }, { serial: 0x40060004, x: 108, y: 100, z: 0, facet: 1 },
    { serial: 0x40060005, x: 300, y: 300, z: 0, facet: 1 },
    { serial: 0x40060006, x: 100, y: 100, z: 0, facet: 3 },
  ]);
  const g = plainGrid(inv, [v])!;
  assert.equal(g.id, PLAIN);
  assert.equal(chestCount(g), 5);
  assert.ok(!g.stacks.some((s) => s.serials.includes(housed)));
  assert.deepEqual(g.areas.map((r) => r.name), ["Trammel, group 1", "Trammel, group 2", "Malas, group 3"]);
  assert.ok(g.stacks.every((s) => areaOfStack(g.areas, s)), "each group is an area holding its own chests");
  assert.deepEqual(g.areas.map((a) => levelAreas(g, g.areas, 0).rows.find((r) => r.area === a)!.chests), [3, 1, 1]);
  assert.deepEqual(g.stacks.find((s) => s.serials.includes(0x40060002))!.serials, [0x40060002, 0x40060003], "two chests on one tile are one stack, bottom first");
  assert.equal(new Set(g.stacks.map((s) => `${s.x}:${s.y}`)).size, g.stacks.length, "groups never overlap on the grid");
  assert.equal(new Set(g.stacks.map((s) => s.letter)).size, g.stacks.length);
  assert.ok(g.cells.every((c) => c.kind === "floor" && c.family === "neutral"));
  assert.equal(plainGrid(invOf([{ serial: housed, x: v.stacks[0]!.x, y: v.stacks[0]!.y, z: 7, facet: 1 }]), [v]), null);
  assert.equal(chestCount(plainGrid(invOf([{ serial: 1, x: 5, y: 5, z: 0 }]), [])!), 1, "a chest of an unknown facet is drawn too");
});

test("[fast] house map: the plain grid leaves out a drawn house's chests by serial, wherever the inventory puts them", () => {
  const v = vault(), housed = v.stacks[0]!.serials[0]!;
  const g = plainGrid(invOf([{ serial: housed, x: 50, y: 50, z: 0, facet: 1 }, { serial: 0x40060010, x: 60, y: 60, z: 0, facet: 1 }]), [v])!;
  assert.deepEqual(g.stacks.flatMap((s) => s.serials), [0x40060010], "a house chest on a tile the house has no cell for is still the house's");
});

test("[fast] house map: a chain of ground chests floors only the tiles around each chest", () => {
  const rows = Array.from({ length: 40 }, (_, i) => ({ serial: 0x40070000 + i, x: 1000 + 8 * i, y: 1000 + 8 * i, z: 0, facet: 1 }));
  const g = plainGrid(invOf(rows), [])!;
  assert.equal(g.areas.length, 1, "8 apart is one group");
  assert.ok(g.cells.length <= 9 * rows.length, `${g.cells.length} cells`);
  assert.equal(new Set(g.cells.map((c) => `${c.x}:${c.y}`)).size, g.cells.length, "no tile twice");
  assert.ok(g.stacks.every((s) => g.cells.some((c) => c.x === s.x && c.y === s.y)), "every chest stands on a floor tile");
  assert.ok(g.x1 >= Math.max(...g.stacks.map((s) => s.x)) + 1 && g.y1 >= Math.max(...g.stacks.map((s) => s.y)) + 1);
});

test("[fast] house map: each plain-grid group stands on its own floor, its chests at their heights above it", () => {
  const g = plainGrid(invOf([{ serial: 1, x: 100, y: 100, z: 0, facet: 1 }, { serial: 2, x: 500, y: 500, z: 40, facet: 1 }, { serial: 3, x: 500, y: 500, z: 46, facet: 1 }]), [])!;
  assert.equal(g.areas.length, 2);
  assert.ok(g.cells.every((c) => c.z === g.levels[0]!.floorZ), "every group's floor is drawn at the level's floor");
  assert.deepEqual(g.stacks.map((s) => s.zs), [[0], [0, 6]], "the high group's chests sit on its floor, not 40 above the low one");
});

test("[fast] house map: the plain grid is the same whatever order the inventory lists its chests", () => {
  const rows = [{ serial: 1, x: 100, y: 100, z: 0, facet: 1 }, { serial: 2, x: 104, y: 100, z: 0, facet: 1 }, { serial: 3, x: 100, y: 100, z: 5, facet: 1 }, { serial: 4, x: 300, y: 300, z: 2, facet: 1 }, { serial: 5, x: 10, y: 10, z: 0, facet: 3 }, { serial: 6, x: 110, y: 104, z: 0, facet: 1 }];
  const fwd = plainGrid(invOf(rows), [])!, rev = plainGrid(invOf([...rows].reverse()), [])!;
  assert.deepEqual(rev.stacks, fwd.stacks);
  assert.deepEqual(rev.cells, fwd.cells);
  assert.deepEqual(rev.areas, fwd.areas);
  assert.deepEqual(rev.codes, fwd.codes);
});

test("[fast] house map: the vault's ground floor is 25 floor tiles, 24 cut walls, a teleporter, 24 stacks of 5 and a standing spot, back to front", () => {
  const m = vault(), sc = sceneOf(m, 0, "angle");
  assert.equal(sc.floors.filter((f) => f.cls.startsWith("map-floor")).length, 25);
  assert.ok(sc.floors.every((f) => !f.cls.startsWith("map-floor") || f.cls.includes("f-tile")), "pavers are tile");
  const kinds = (k: string, ...cls: string[]) => sc.pieces.filter((p) => p.kind === k && cls.every((c) => "cls" in p && has(p.cls, c))).length;
  assert.deepEqual([kinds("solid", "map-wall", "w-stone"), kinds("item", "map-teleporter"), kinds("stack"), kinds("spot")], [24, 1, 24, 1]);
  assert.equal(sc.pieces.flatMap((p) => (p.kind === "stack" ? p.chests : [])).length, 120);
  assert.equal(sc.reach.length, 1);
  const keys = sc.pieces.map((p) => p.x + p.y);
  assert.deepEqual(keys, [...keys].sort((a, b) => a - b));
  const top = sceneOf(m, 0, "top");
  assert.ok(top.pieces.every((p) => p.kind !== "stack" || p.chests.every((c) => c.prism.left === "" && c.prism.right === "")), "from above a chest is its top only");
  const up = sceneOf(m, 1, "angle");
  assert.deepEqual([up.below.length, up.floors.length, up.pieces.filter((p) => p.kind === "stack").length], [24, 49, 0], "the 2nd floor shows the walls below it faintly");
});

test("[fast] house map: chests sharing a z on one tile are drawn one on another, not inside each other", () => {
  const g = plainGrid(invOf([{ serial: 1, x: 100, y: 100, z: 0, facet: 1 }, { serial: 2, x: 100, y: 100, z: 0, facet: 1 }, { serial: 3, x: 100, y: 100, z: 9, facet: 1 }]), [])!;
  const s = g.stacks[0]!, base = g.levels[0]!.floorZ;
  assert.deepEqual(s.zs.map((z) => z - base), [0, 0, 9], "the model keeps the real heights");
  assert.deepEqual(drawnZs(s, base), [0, CHEST_H, 9], "the second chest sits on the first; the third is already clear of it");
  const piece = sceneOf(g, 0, "angle").pieces.find((p) => p.kind === "stack");
  assert.ok(piece?.kind === "stack");
  assert.equal(piece.chests[1]!.prism.top, pts(boxFaces(s.x - g.x0, s.y - g.y0, CHEST_H, CHEST_H, "angle", 0.18).top));
  assert.deepEqual(anchorOf(g, s, "angle"), project(s.x - g.x0 + 0.5, s.y - g.y0 + 0.5, 9 + CHEST_H, "angle"));
});

test("[fast] house map: the courtyard draws its walls, window, foundation lip, stairs, table and door, and its yard tiles as yard", () => {
  const m = buildHouseModel(courtyardHouse(), td, []), sc = sceneOf(m, 0, "angle");
  const cls = sc.pieces.flatMap((p) => ("cls" in p ? [p.cls] : []));
  for (const want of ["map-wall w-stone", "map-wall window w-neutral", "map-lip w-brick", "map-block", "map-door"]) assert.ok(cls.some((c) => want.split(" ").every((w) => has(c, w))), want);
  assert.ok(sc.pieces.some((p) => p.kind === "solid" && has(p.cls, "map-stair") && p.steps?.length === 2), "the front steps rise to the rim");
  const cell = m.cells.find((c) => c.level === 0 && c.x === 1012 && c.y === 2013)!;
  assert.equal(cell.indoor, false, "(1012, 2013) is in the courtyard, under no roof or floor");
  const floorAt = (c: typeof cell) => sc.floors.find((f) => f.pts === pts(tilePolygon(c.x - m.x0, c.y - m.y0, c.z - m.levels[0]!.floorZ, "angle")))?.cls;
  assert.equal(floorAt(cell), "map-floor f-grass yard", "the yard tint comes from the cell being uncovered");
  const inside = m.cells.find((c) => c.level === 0 && c.x === 1002 && c.y === 2002)!;
  assert.equal(inside.indoor, true);
  assert.equal(has(floorAt(inside)!, "yard"), false, "covered floor is not yard");
  assert.ok(sceneOf(m, 1, "angle").floors.every((f) => !has(f.cls, "yard")), "an upper level is never yard");
});

test("[fast] house map: a stair rises as a block to meet the higher tile beside it, its steps running across the rise; a stair with nothing higher beside it stays flat", () => {
  const m = buildHouseModel(foundationHouse(), td, []), base = m.levels[0]!.floorZ;
  const stair = m.cells.find((c) => c.level === 0 && c.kind === "stair" && c.x === 9004)!, x = stair.x - m.x0, y = stair.y - m.y0;
  const rim = m.cells.find((c) => c.level === 0 && c.x === stair.x && c.y === stair.y - 1)!;
  assert.ok(rim.lip && rim.z > stair.z, "the steps lie below the rim to their north");
  for (const view of ["angle", "top"] as const) {
    const sc = sceneOf(m, 0, view);
    const block = sc.pieces.find((p) => p.kind === "solid" && has(p.cls, "map-stair") && p.x === x && p.y === y);
    const tile = sc.floors.find((f) => has(f.cls, "map-stair") && f.pts === pts(tilePolygon(x, y, rim.z - base, view)));
    // The bands run along x (across the rise to the north): their corners step in y.
    const across = [1, 3].map((k) => pts([project(x, y + k / 4, rim.z - base, view), project(x + 1, y + k / 4, rim.z - base, view), project(x + 1, y + (k + 1) / 4, rim.z - base, view), project(x, y + (k + 1) / 4, rim.z - base, view)]));
    if (view === "angle") {
      assert.ok(block?.kind === "solid", "a raised block at the game angle");
      assert.equal(block.z, stair.z - base, "ordered from its own height");
      const f = boxFaces(x, y, stair.z - base, rim.z - stair.z, view);
      assert.deepEqual(block.prism, { top: pts(f.top), left: pts(f.left), right: pts(f.right) });
      assert.equal(block.prism.top, pts(tilePolygon(x, y, rim.z - base, view)), "its top is level with the rim");
      assert.deepEqual(block.steps, across);
      assert.ok(!sc.floors.some((f) => has(f.cls, "map-stair") && f.pts === pts(tilePolygon(x, y, stair.z - base, view))), "no flat tile left at street level");
    } else {
      assert.ok(!block && tile, "from above it is a floor tile");
      for (const b of across) assert.ok(sc.floors.some((f) => f.cls === "map-step" && f.pts === b), "with the same bands");
    }
  }
  // A lone stair beside nothing higher lies flat at its own height, its bands across x: from above a floor tile as before, at the game angle a top only.
  const lone = { ...m, cells: [stair] }, z = stair.z - base, bands = (view: "angle" | "top") => [1, 3].map((k) => pts([project(x + k / 4, y, z, view), project(x + (k + 1) / 4, y, z, view), project(x + (k + 1) / 4, y + 1, z, view), project(x + k / 4, y + 1, z, view)]));
  const flat = sceneOf(lone, 0, "angle").pieces.find((p) => p.kind === "solid" && has(p.cls, "map-stair"));
  assert.ok(flat?.kind === "solid");
  assert.deepEqual([flat.prism, flat.steps], [{ top: pts(tilePolygon(x, y, z, "angle")), left: "", right: "" }, bands("angle")]);
  const above = sceneOf(lone, 0, "top");
  assert.ok(above.floors.some((f) => has(f.cls, "map-stair") && f.pts === pts(tilePolygon(x, y, z, "top"))));
  assert.deepEqual(above.floors.filter((f) => f.cls === "map-step").map((f) => f.pts), bands("top"));
});

test("[fast] house map: an interior staircase rises step by step, each step to the next one's height, its steps running across x; the top step stays flat, drawn after the step behind it", () => {
  const m = buildHouseModel(stairHouse(), td, []), base = m.levels[0]!.floorZ, sc = sceneOf(m, 0, "angle");
  const steps = m.cells.filter((c) => c.level === 0 && c.kind === "stair").sort((a, b) => a.x - b.x);
  assert.deepEqual(steps.map((c) => c.z), [7, 12, 17, 22]);
  steps.forEach((c, i) => {
    const x = c.x - m.x0, y = c.y - m.y0, block = sc.pieces.find((p) => p.kind === "solid" && has(p.cls, "map-stair") && p.x === x && p.y === y);
    if (i === steps.length - 1) {
      assert.ok(block?.kind === "solid", "the top step is a piece too");
      assert.deepEqual(block.prism, { top: pts(tilePolygon(x, y, c.z - base, "angle")), left: "", right: "" }, "nothing higher beside it on this level: flat");
      const prev = sc.pieces.findIndex((p) => p.kind === "solid" && has(p.cls, "map-stair") && p.x === x - 1 && p.y === y);
      assert.ok(prev >= 0 && sc.pieces.indexOf(block) > prev, "painted after step 3, whose side would otherwise cover it");
      return;
    }
    const top = steps[i + 1]!.z - base;
    assert.ok(block?.kind === "solid", `step ${i + 1} is raised`);
    assert.equal(block.prism.top, pts(tilePolygon(x, y, top, "angle")), `step ${i + 1} rises to the next`);
    assert.equal(block.steps?.[0], pts([project(x + 0.25, y, top, "angle"), project(x + 0.5, y, top, "angle"), project(x + 0.5, y + 1, top, "angle"), project(x + 0.25, y + 1, top, "angle")]), "bands across x, the way the run climbs");
  });
});

test("[fast] house map: with front steps the house stands on a plinth: its outward edge sides run down to the steps' height, at the game angle only, behind the steps", () => {
  const m = buildHouseModel(foundationHouse(), td, []), base = m.levels[0]!.floorZ;
  const low = Math.min(...m.cells.filter((c) => c.level === 0 && c.kind === "stair").map((c) => c.z)) - base;
  assert.equal(low, -7);
  const sc = sceneOf(m, 0, "angle"), plinths = sc.pieces.filter((p) => p.kind === "solid" && has(p.cls, "map-plinth"));
  const at = (x: number, y: number) => plinths.find((p) => p.x === x - m.x0 && p.y === y - m.y0);
  const faces = (x: number, y: number, z: number) => boxFaces(x - m.x0, y - m.y0, low, z - low, "angle");
  // The south rim's outward side faces the steps, the east rim's the street; the corner shows both; each runs from the steps up to the rim.
  const south = at(9004, 9009), east = at(9009, 9004), corner = at(9009, 9009);
  assert.ok(south?.kind === "solid" && east?.kind === "solid" && corner?.kind === "solid");
  assert.ok(has(south.cls, "w-stone"), south.cls);
  assert.deepEqual(south.prism, { top: "", left: pts(faces(9004, 9009, 0).left), right: "" });
  assert.deepEqual(east.prism, { top: "", left: "", right: pts(faces(9009, 9004, 0).right) });
  assert.deepEqual(corner.prism, { top: "", left: pts(faces(9009, 9009, 0).left), right: pts(faces(9009, 9009, 0).right) });
  assert.ok(plinths.every((p) => p.z === low));
  // Inner cells and the back (north and west) edges, whose outward sides face away, get none.
  assert.ok(plinths.every((p) => p.x + m.x0 === 9009 || p.y + m.y0 === 9009), "only the south and east edges");
  // Back to front: each plinth before its rim's lip, and before the raised step in front of it.
  const order = (pred: (p: (typeof sc.pieces)[number]) => boolean) => sc.pieces.findIndex(pred);
  const sx = 9004 - m.x0, sy = 9009 - m.y0;
  assert.ok(order((p) => p === south) < order((p) => p.kind === "solid" && has(p.cls, "map-lip") && p.x === sx && p.y === sy));
  assert.ok(order((p) => p === south) < order((p) => p.kind === "solid" && has(p.cls, "map-stair") && p.x === sx && p.y === sy + 1));
  assert.ok(!sceneOf(m, 0, "top").pieces.some((p) => "cls" in p && has(p.cls, "map-plinth")), "top-down: no plinth");
  // Without steps there is no plinth.
  const flat = { ...m, cells: m.cells.filter((c) => c.kind !== "stair") };
  assert.ok(!sceneOf(flat, 0, "angle").pieces.some((p) => "cls" in p && has(p.cls, "map-plinth")));
  assert.ok(!sceneOf(vault(), 0, "angle").pieces.some((p) => "cls" in p && has(p.cls, "map-plinth")));
  assert.ok(!sceneOf(buildHouseModel(stairHouse(), td, []), 0, "angle").pieces.some((p) => "cls" in p && has(p.cls, "map-plinth")), "an interior staircase starts at the floor: nothing to stand on");
});

test("[fast] house map: ground tiles at street level beside the steps are outside: the plinth runs unbroken along the rim, and they get none of their own", () => {
  const h = foundationHouse();
  const tiles = h.tiles.map((t): typeof t => (t[0] === G.stairs && (t[1] < 9004 || t[1] > 9005) ? [G.dirt, t[1], t[2], 0, 0] : t));
  const m = buildHouseModel({ ...h, tiles }, td, []), sc = sceneOf(m, 0, "angle");
  assert.deepEqual(m.cells.filter((c) => c.level === 0 && c.y === 9010).map((c) => c.kind).sort(), [...Array(8).fill("floor"), "stair", "stair"], "the step row: two stairs among ground tiles");
  const plinths = sc.pieces.filter((p) => p.kind === "solid" && has(p.cls, "map-plinth"));
  const at = (x: number, y: number) => plinths.find((p) => p.x === x - m.x0 && p.y === y - m.y0);
  for (let x = 9000; x <= 9009; x++) { const p = at(x, 9009); assert.ok(p?.kind === "solid" && p.prism.left !== "", `the rim's south side at ${x}`); }
  const corner = at(9009, 9009);
  assert.ok(corner?.kind === "solid" && corner.prism.right !== "", "and the corner's east side");
  assert.ok(!plinths.some((p) => p.y + m.y0 === 9010), "nothing on the ground tiles");
});

test("[fast] house map: an interior staircase is inside: with front steps too, no plinth is drawn within the walls", () => {
  const h = stairHouse(), step = h.tiles.find((t) => t[0] === G.stairs)!;
  const m = buildHouseModel({ ...h, tiles: [...h.tiles, ...[2002, 2003, 2004].map((x): typeof step => [G.stairs, x, 3008, 0, 0])] }, td, []);
  const plinths = sceneOf(m, 0, "angle").pieces.filter((p) => p.kind === "solid" && has(p.cls, "map-plinth"));
  assert.ok(plinths.length > 0, "the house stands on a plinth");
  // The walls ring x 2000..2007, y 3000..3007; inside them, and on the north and west walls, every side faces in.
  for (const p of plinths) { const x = p.x + m.x0, y = p.y + m.y0; assert.ok(x === 2007 || y === 3007, `a plinth at ${x}, ${y}`); }
});

test("[fast] house map: a side of the plinth runs down only to the tile beyond it: a sunken floor inside the house is a pit, not the street", () => {
  const h = foundationHouse(), pit = (x: number, y: number) => x >= 9006 && x <= 9007 && y >= 9006 && y <= 9007;
  const m = buildHouseModel({ ...h, tiles: h.tiles.map((t): typeof t => (t[0] === G.dirt && pit(t[1], t[2]) ? [G.dirt, t[1], t[2], 4, 0] : t)) }, td, []);
  assert.ok(m.cells.filter((c) => pit(c.x, c.y)).every((c) => c.level === 0 && c.kind === "floor" && c.z - m.levels[0]!.floorZ === -3), "a 2 x 2 pit 3 below the floor");
  const plinths = sceneOf(m, 0, "angle").pieces.filter((p) => p.kind === "solid" && has(p.cls, "map-plinth"));
  const inner = plinths.filter((p) => p.x + m.x0 < 9009 && p.y + m.y0 < 9009);
  assert.ok(inner.every((p) => p.z === -3), "nothing inside goes below the pit's floor");
  const north = inner.find((p) => p.x + m.x0 === 9006 && p.y + m.y0 === 9005), west = inner.find((p) => p.x + m.x0 === 9005 && p.y + m.y0 === 9006);
  assert.ok(north?.kind === "solid" && west?.kind === "solid");
  assert.deepEqual(north.prism, { top: "", left: pts(boxFaces(9006 - m.x0, 9005 - m.y0, -3, 3, "angle").left), right: "" });
  assert.deepEqual(west.prism, { top: "", left: "", right: pts(boxFaces(9005 - m.x0, 9006 - m.y0, -3, 3, "angle").right) });
  assert.ok(!plinths.some((p) => pit(p.x + m.x0, p.y + m.y0)), "the pit's own tiles stand below the floor: none");
});

test("[fast] house map: a ground tile below the floor but above the steps gets no plinth of its own; the rim's side above it stops at its height", () => {
  const h = foundationHouse();
  const m = buildHouseModel({ ...h, tiles: h.tiles.map((t): typeof t => (t[0] === G.stairs && t[1] === 9002 ? [G.dirt, t[1], t[2], 4, 0] : t)) }, td, []);
  const plinths = sceneOf(m, 0, "angle").pieces.filter((p) => p.kind === "solid" && has(p.cls, "map-plinth"));
  assert.ok(!plinths.some((p) => p.y + m.y0 === 9010), "nothing in the step row");
  const rim = plinths.find((p) => p.x + m.x0 === 9002 && p.y + m.y0 === 9009);
  assert.ok(rim?.kind === "solid");
  assert.equal(rim.prism.left, pts(boxFaces(9002 - m.x0, 9009 - m.y0, -3, 3, "angle").left));
});

test("[fast] house map: the plinth is one material, the ground level's most common lip family, whatever stands on each edge tile", () => {
  const m = buildHouseModel(courtyardHouse(), td, []), sc = sceneOf(m, 0, "angle");
  const fam = (x: number, y: number) => sc.pieces.find((p) => p.kind === "solid" && has(p.cls, "map-plinth") && p.x === x - m.x0 && p.y === y - m.y0);
  const onTop = (x: number, y: number) => m.cells.find((c) => c.level === 0 && c.x === x && c.y === y)!;
  assert.equal(onTop(1017, 2003).kind, "window", "the east edge holds the building's window");
  assert.equal(onTop(1017, 2005).kind, "wall", "and its walls");
  const south = fam(1005, 2017)!;
  assert.ok(south.kind === "solid" && has(south.cls, "w-brick"), "the brick rim's family");
  for (const [x, y] of [[1017, 2003], [1017, 2005], [1017, 2015]] as const) { const p = fam(x, y); assert.ok(p?.kind === "solid" && has(p.cls, "w-brick") && !has(p.cls, "w-stone") && !has(p.cls, "w-neutral"), `${x}, ${y}`); }
  // With no lip on the ground level, the plain lip colour.
  const bare = { ...m, cells: m.cells.map((c) => ({ ...c, lip: false })) };
  assert.ok(sceneOf(bare, 0, "angle").pieces.filter((p) => p.kind === "solid" && has(p.cls, "map-plinth")).every((p) => p.kind === "solid" && has(p.cls, "w-neutral")));
});

test("[fast] house map: a level's bounds hold the plinth's bottom and a raised stair's top", () => {
  const m = buildHouseModel(foundationHouse(), td, []);
  const cell = (x: number, y: number) => m.cells.find((c) => c.level === 0 && c.x === x && c.y === y)!;
  // An east rim tile and a stair far to its west: the rim's plinth runs 7 below it, lower on screen than anything else.
  const plinth = { ...m, cells: [cell(9009, 9004), cell(9000, 9010)] };
  assert.ok(boundsOf(plinth, 0, "angle").y + boundsOf(plinth, 0, "angle").h >= project(10, 5, -7, "angle")[1] + W);
  // A stair at the floor beside a tile 20 higher rises to it, a cut wall's height above that.
  const stair = cell(9004, 9010), high = { ...cell(9004, 9009), y: 9011, z: stair.z + 20, lip: false };
  const raised = { ...m, cells: [stair, high] }, z = stair.z + 20 - m.levels[0]!.floorZ;
  assert.ok(boundsOf(raised, 0, "angle").y <= project(9004 - m.x0, 9010 - m.y0, z + 6, "angle")[1] - W);
});

test("[fast] house map: walls and the foundation's lip take their material's colour family: a wooden stall is wood, the stone rim stone", () => {
  const m = buildHouseModel(foundationHouse(), td, []), sc = sceneOf(m, 0, "angle");
  const at = (x: number, y: number) => sc.pieces.filter((p) => p.kind === "solid" && !has(p.cls, "map-plinth") && p.x === x - m.x0 && p.y === y - m.y0).map((p) => ("cls" in p ? p.cls : ""));
  const one = (x: number, y: number, ...want: string[]) => { const c = at(x, y); assert.equal(c.length, 1, `${x}, ${y}`); assert.ok(want.every((w) => has(c[0]!, w)), `${x}, ${y}: ${c[0]}`); };
  one(9003, 9003, "map-wall", "w-wood");
  for (const [x, y] of [[9000, 9005], [9009, 9005], [9005, 9000], [9005, 9009]] as const) one(x, y, "map-lip", "w-stone");
  assert.ok(!sc.pieces.some((p) => "cls" in p && has(p.cls, "map-wall") && !has(p.cls, "w-wood")), "no foundation tile is drawn as a wall");
});

test("[fast] house map: a castle's level becomes a scene in well under the 100 ms page budget", () => {
  const { house, chests } = castleHouse(), m = buildHouseModel(house, td, chests);
  // The best of three runs (the JIT warm), so a loaded CI runner times the code, not its neighbours.
  let sc = sceneOf(m, 0, "angle"), ms = Infinity;
  for (let i = 0; i < 3; i++) { const t0 = performance.now(); sc = sceneOf(m, 0, "angle"); ms = Math.min(ms, performance.now() - t0); }
  assert.ok(sc.pieces.length > 300);
  assert.ok(ms < 100, `took ${ms.toFixed(0)} ms`);
});

test("[fast] house map: the picker and the headings use the player's name when the house has one", () => {
  const h = { id: "1-3000-1000", facet: 1, capturedAt: "", captures: 1, width: 18, height: 18, plot: { x0: 3000, y0: 1000, x1: 3017, y1: 1017 }, levels: 2, containers: 120, serials: [] };
  assert.equal(houseLabel(h), "Trammel house, 18 × 18, 120 containers");
  assert.equal(houseLabel({ ...h, name: "Main house" }), "Main house · Trammel, 18 × 18, 120 containers");
  const m = vault();
  assert.equal(houseName(m), "Trammel house");
  assert.equal(houseName({ ...m, name: "Main house" }), "Main house");
});

test("[fast] house map: a name kept for a house no longer listed is offered to an unnamed house whose footprint overlaps it on the same facet", () => {
  const m = vault();   // facet 1, x 3000-3006, y 1000-1006
  const old = { name: "Old vault", bounds: { x0: 3004, y0: 1004, x1: 3010, y1: 1010, facet: 1 } };
  assert.deepEqual(carryOver(m, [m.id], { "1-3004-1004": old }), { id: "1-3004-1004", name: "Old vault", areas: [] });
  assert.equal(carryOver({ ...m, name: "Vault" }, [m.id], { "1-3004-1004": old }), null, "a named house is offered nothing");
  assert.equal(carryOver(m, [m.id, "1-3004-1004"], { "1-3004-1004": old }), null, "the named house is still listed");
  assert.equal(carryOver(m, [m.id], { "3-3004-1004": { ...old, bounds: { ...old.bounds, facet: 3 } } }), null, "another facet");
  assert.equal(carryOver(m, [m.id], { "1-3007-1004": { ...old, bounds: { ...old.bounds, x0: 3007 } } }), null, "no overlap");
  assert.equal(carryOver(m, [m.id], { "1-3004-1004": { name: "No bounds" } }), null, "a name saved without its footprint");
  assert.equal(carryOver({ ...m, id: PLAIN }, [], { "1-3004-1004": old }), null, "never the plain grid");
  assert.deepEqual(carryOverText({ name: "Old vault", areas: [] }), { text: 'Use the name "Old vault" from the earlier house here?', action: "Use name" });
});

test("[fast] house areas: the carry-over offer brings the earlier house's areas, the rectangles still on this house only, and says so", () => {
  const m = vault();   // facet 1, x 3000-3006, y 1000-1006
  const a = (id: string, rects: HouseArea["rects"]): HouseArea => ({ id, name: `Area ${id}`, level: 0, color: "area-2", rects });
  const near = a("a1", [{ x0: 3001, y0: 1001, x1: 3003, y1: 1002 }, { x0: 3020, y0: 1001, x1: 3021, y1: 1002 }]), far = a("a2", [{ x0: 3100, y0: 1100, x1: 3101, y1: 1101 }]);
  const old = { name: "Old vault", bounds: { x0: 3004, y0: 1004, x1: 3010, y1: 1010, facet: 1 }, areas: [near, far] };
  assert.deepEqual(carryOver(m, [m.id], { "1-3004-1004": old }), { id: "1-3004-1004", name: "Old vault", areas: [{ ...near, rects: [near.rects[0]!] }] });
  assert.deepEqual(carryOverText({ name: "Old vault", areas: [near] }), { text: 'Use the name and areas of "Old vault" from the earlier house here?', action: "Use name and areas" });
  const unnamed = { name: "", bounds: old.bounds, areas: [near] };
  assert.deepEqual(carryOver(m, [m.id], { "1-3004-1004": unnamed })?.areas.map((x) => x.id), ["a1"], "an earlier house with areas and no name");
  assert.deepEqual(carryOverText({ name: "", areas: [near] }), { text: "Use the areas from the earlier house here?", action: "Use areas" });
  assert.equal(carryOver(m, [m.id], { "1-3004-1004": old, [m.id]: { name: "", bounds: old.bounds, areas: [far] } }), null, "a house with areas of its own is offered nothing");
  assert.equal(carryOver(m, [m.id], { "1-3004-1004": { ...unnamed, areas: [far] } }), null, "nothing left to carry");
  const upstairs = { ...near, id: "a3", level: 2 };   // the vault has two levels
  assert.deepEqual(carryOver(m, [m.id], { "1-3004-1004": { ...old, areas: [near, upstairs] } })?.areas.map((x) => x.id), ["a1"], "an area on a level this house lacks stays behind");
  assert.notEqual(carryOver(m, [m.id], { "1-3004-1004": old, [m.id]: { name: "", bounds: old.bounds, areas: [upstairs] } }), null, "an orphan-level area of its own is no area");
});

test("[fast] house areas: an area on a level the house no longer has is left out of the list (and so of the counts and the cap)", () => {
  const a = (id: string, level: number): HouseArea => ({ id, name: id, level, color: "area-1", rects: [{ x0: 0, y0: 0, x1: 0, y1: 0 }] });
  assert.deepEqual(liveAreas([a("g", 0), a("u", 1), a("gone", 2)], 2).map((x) => x.id), ["g", "u"]);
  assert.deepEqual(liveAreas(undefined, 2), []);
  // A save keeps the hidden ones on disk: the edited live list, then the orphans as they were.
  const saved = [a("g", 0), a("gone", 2), a("u", 1)];
  assert.deepEqual(withOrphans(liveAreas(saved, 2).filter((x) => x.id !== "g"), saved, 2).map((x) => x.id), ["u", "gone"]);
  assert.deepEqual(withOrphans([], undefined, 2), []);
  assert.deepEqual(liveAreas(withOrphans([a("u", 1)], saved, 2), 3).map((x) => x.id), ["u", "gone"], "a storey built again shows its areas again");
  assert.equal(redrawFailed("Disk full", false), "Could not save the new shape: Disk full.");
  assert.equal(redrawFailed("Disk full.", true), "Could not save the new shape: Disk full. Your drawing is kept: press Enter to try again, or Esc to cancel.");
  assert.deepEqual(Object.keys(AREA_COLOR_NAMES), [...AREA_COLORS], "a name for every colour token");
  assert.equal(new Set(Object.values(AREA_COLOR_NAMES)).size, AREA_COLORS.length);
});

// ---------------------------------------------------------------- areas (issue #10)
const areaOf = (id: string, level: number, rects: HouseArea["rects"], name = `Area ${id}`): HouseArea => ({ id, name, level, color: "area-1", rects });

test("[fast] house areas: a stack belongs to the first area in list order holding its tile on its level; the rest is Everything else, or the Whole floor before the level has areas", () => {
  const m = vault();   // 24 stacks of 5 on level 0, x 3001-3005, y 1001-1005 (the centre a teleporter)
  assert.deepEqual(levelAreas(m, [], 0), { rows: [], rest: { name: "Whole floor", chests: 120 } });
  const north = areaOf("n", 0, [{ x0: 3001, y0: 1001, x1: 3005, y1: 1001 }]), corner = areaOf("c", 0, [{ x0: 3001, y0: 1001, x1: 3001, y1: 1005 }]);
  const upstairs = areaOf("u", 1, [{ x0: 3000, y0: 1000, x1: 3006, y1: 1006 }]);
  const areas = [north, corner, upstairs], at = (x: number, y: number) => m.stacks.find((s) => s.x === x && s.y === y)!;
  assert.equal(areaOfStack(areas, at(3001, 1001)), north, "on both: the first in list order wins");
  assert.equal(areaOfStack([corner, north], at(3001, 1001)), corner);
  assert.equal(areaOfStack(areas, at(3001, 1003)), corner);
  assert.equal(areaOfStack(areas, at(3003, 1003 + 1)), null, "an area on another level never holds a stack");
  const l0 = levelAreas(m, areas, 0);
  assert.deepEqual(l0.rows.map((r) => [r.area.id, r.chests]), [["n", 25], ["c", 20]]);
  assert.deepEqual(l0.rest, { name: "Everything else", chests: 75 });
  assert.equal(l0.rows.reduce((a, r) => a + r.chests, l0.rest.chests), chestCount(m, 0), "the counts add up to the level");
  assert.deepEqual(levelAreas(m, areas, 1), { rows: [{ area: upstairs, chests: 0 }], rest: { name: "Everything else", chests: 0 } });
  assert.equal(restName([north], 1), "Whole floor", "a level with no areas of its own");
});

test("[fast] house areas: a point on screen maps back to the tile under it at the level's floor, the inverse of the projection", () => {
  for (const view of ["angle", "top"] as const) for (const [x, y, z] of [[0, 0, 0], [3.25, 7.5, 0], [12.9, 0.1, 4], [-2, 5, 10]] as const) {
    const back = unproject(project(x, y, z, view), view === "top" ? 0 : z, view);
    assert.ok(Math.abs(back[0] - x) < 1e-9 && Math.abs(back[1] - y) < 1e-9, `${view} ${x},${y},${z} → ${back}`);
  }
  const m = vault();
  for (const [tx, ty] of [[3000, 1000], [3004, 1002], [3006, 1006]] as const) for (const view of ["angle", "top"] as const) {
    const centre = project(tx - m.x0 + 0.5, ty - m.y0 + 0.5, 0, view), corner = project(tx - m.x0 + 0.02, ty - m.y0 + 0.02, 0, view);
    assert.deepEqual(tileAt(m, centre, view), [tx, ty], `${view} centre`);
    assert.deepEqual(tileAt(m, corner, view), [tx, ty], `${view} near the north corner`);
  }
});

test("[fast] house areas: a dragged rectangle, its size, and the floor tiles it tints", () => {
  assert.deepEqual(rectOf([5, 9], [2, 4]), { x0: 2, y0: 4, x1: 5, y1: 9 });
  assert.equal(sizeText(rectOf([0, 0], [5, 5])), "6 × 6 = 36 tiles");
  assert.equal(sizeText(rectOf([3, 3], [3, 3])), "1 × 1 = 1 tile");
  const m = vault();   // floor x 3001-3005, y 1001-1005 on level 0; walls around
  const r = rectOf([2998, 999], [3002, 1002]);
  assert.deepEqual(coveredCells(m, 0, [r]).map((c) => [c.x, c.y]), [[3001, 1001], [3002, 1001], [3001, 1002], [3002, 1002]], "only the floor tiles, not walls or tiles off the house");
  assert.deepEqual(unionTiles([rectOf([0, 0], [1, 1]), rectOf([1, 1], [2, 1])]), [[0, 0], [1, 0], [0, 1], [1, 1], [2, 1]], "overlapping tiles once");
  assert.deepEqual(clampTile(m, [2000, 1003]), [3000 - 8, 1003]);
});

test("[fast] house areas: the outline of a union of rectangles runs along its outer edges only, joined in straight runs", () => {
  assert.deepEqual(outlineOf([rectOf([0, 0], [1, 0])]), [[[0, 0], [2, 0]], [[0, 0], [0, 1]], [[2, 0], [2, 1]], [[0, 1], [2, 1]]], "a 2 × 1 rectangle is 4 edges, not 6");
  // An L: a 2 × 2 square and the tile east of its south-east corner, overlapping it.
  const l = outlineOf([rectOf([0, 0], [1, 1]), rectOf([1, 1], [2, 1])]);
  assert.equal(l.length, 6, JSON.stringify(l));
  assert.ok(l.some(([a, b]) => a[0] === 0 && a[1] === 2 && b[0] === 3 && b[1] === 2), "the south edge runs on under both");
  assert.ok(!l.some(([a, b]) => a[0] === 1 && b[0] === 2 && a[1] === 1 && b[1] === 1), "no edge between two tiles of the union");
  const ring = outlineOf([rectOf([0, 0], [2, 0]), rectOf([0, 2], [2, 2]), rectOf([0, 0], [0, 2]), rectOf([2, 0], [2, 2])]);
  assert.equal(ring.length, 8, "a ring has an outer and an inner outline");
  assert.deepEqual(outlineOf([]), []);
});

test("[fast] house areas: rectangles that touch (4-neighbour) are one piece; a piece's front corner is its tile with the largest x + y", () => {
  assert.deepEqual(piecesOf([rectOf([0, 0], [1, 1]), rectOf([2, 1], [3, 1])]).map((p) => p.length), [6], "touching side by side: one piece");
  assert.deepEqual(piecesOf([rectOf([0, 0], [1, 1]), rectOf([2, 2], [3, 3])]).map((p) => p.length), [4, 4], "only a corner shared: two pieces");
  assert.deepEqual(piecesOf([rectOf([10, 10], [10, 10]), rectOf([0, 0], [1, 0])]).map((p) => p[0]), [[0, 0], [10, 10]], "pieces in row order, whatever the rectangles' order");
  assert.deepEqual(piecesOf([]), []);
  assert.deepEqual(frontCorner([[0, 0], [1, 0], [0, 1], [1, 1]]), [1, 1]);
  assert.deepEqual(frontCorner([[0, 2], [1, 1], [2, 0], [0, 0]]), [1, 1], "a tie: the middle one");
});

test("[fast] house areas: a label fits about 92% of its piece's width: the whole name, else cut short with …, else a dot when fewer than 3 characters fit", () => {
  const measure = (t: string): number => t.length * 7;   // 7 px a character, the pill's padding and border 16 more
  assert.equal(fitLabel("Loot Corner", 200, measure), "Loot Corner");
  assert.equal(fitLabel("Loot Corner", 7 * 11 + 16, measure), "Loot Corner", "exactly fits");
  assert.equal(fitLabel("Loot Corner", 7 * 6 + 16, measure), "Loot…", "cut short: 5 characters and the ellipsis, the trailing space trimmed");
  assert.equal(fitLabel("Loot Corner", 7 * 4 + 16, measure), "Loo…");
  assert.equal(fitLabel("Loot Corner", 7 * 3 + 16, measure), null, "fewer than 3 characters: the dot");
  assert.equal(fitLabel("Ab", 200, measure), "Ab", "a short name that fits whole is never a dot");
  assert.equal(LABEL_FIT, 0.92);
});

test("[fast] house areas: a pill is centered over its anchor and kept 8 px inside the pane, clear of the zoom buttons; an anchor off the pane hides it", () => {
  const pane = { w: 600, h: 400 }, size = { w: 80, h: 20 }, zoom = { x0: 560, y0: 8, x1: 592, y1: 140 };
  assert.deepEqual(placePill({ x: 300, y: 200 }, size, pane, 7, false, zoom), { left: 260, top: 187, hidden: false }, "centered, its foot 7 px below the anchor");
  assert.deepEqual(placePill({ x: 300, y: 200 }, { w: 10, h: 10 }, pane, 7, true, zoom), { left: 295, top: 195, hidden: false }, "a dot is centered on it");
  assert.deepEqual(placePill({ x: 10, y: 200 }, size, pane, 7, false, null), { left: 8, top: 187, hidden: false }, "the left edge");
  assert.deepEqual(placePill({ x: 590, y: 300 }, size, pane, 7, false, zoom), { left: 512, top: 287, hidden: false }, "the right edge, below the zoom buttons");
  assert.deepEqual(placePill({ x: 4, y: 3 }, size, pane, 7, false, null), { left: 8, top: 8, hidden: false }, "the top at least 8 px down");
  assert.deepEqual(placePill({ x: 300, y: 399 }, size, pane, 7, false, null), { left: 260, top: 372, hidden: false }, "the bottom edge");
  assert.deepEqual(placePill({ x: 560, y: 60 }, size, pane, 7, false, zoom), { left: 472, top: 47, hidden: false }, "moved left of the zoom buttons");
  assert.equal(placePill({ x: -5, y: 200 }, size, pane, 7, false, zoom).hidden, true, "an anchor off the pane hides the pill");
  assert.equal(placePill({ x: 300, y: 401 }, size, pane, 7, false, zoom).hidden, true);
});

test("[fast] house areas: a pill per piece of each area on the level, anchored at the piece's front corner tile's middle, with the piece's width on screen", () => {
  const m = vault();
  const two = areaOf("t", 0, [rectOf([3001, 1001], [3002, 1001]), rectOf([3004, 1004], [3005, 1005])], "Loot Corner"), up = areaOf("u", 1, [rectOf([3001, 1001], [3001, 1001])]);
  const pills = pillsOf(m, [two, up], 0, "angle");
  assert.deepEqual(pills.map((p) => [p.id, p.name, p.color]), [["t", "Loot Corner", "area-1"], ["t", "Loot Corner", "area-1"]], "two pieces, two pills; none from another level");
  assert.deepEqual(pills[0]!.anchor, project(3002 - m.x0 + 0.5, 1001 - m.y0 + 0.5, 0, "angle"), "the first piece's front corner");
  assert.deepEqual(pills[1]!.anchor, project(3005 - m.x0 + 0.5, 1005 - m.y0 + 0.5, 0, "angle"));
  assert.equal(pills[0]!.span, (3 * W) / 2, "two tiles in a row at the game angle: from the first's west corner to the second's east, three half-tiles");
  assert.equal(pillsOf(m, [two], 0, "top")[0]!.span, 2 * W, "top-down: two tiles wide");
});

test("[fast] house areas: a new area takes the first free id and the first unused palette colour; the cursor moves a tile north, east, south or west", () => {
  assert.equal(nextAreaId([]), "a1");
  assert.equal(nextAreaId([{ id: "a1" }, { id: "a3" }]), "a2");
  assert.equal(nextAreaColor([]), "area-1");
  assert.equal(nextAreaColor([{ color: "area-1" }, { color: "area-3" }]), "area-2");
  assert.equal(nextAreaColor(AREA_COLORS.map((color) => ({ color }))), "area-1", "all used: round again");
  const m = vault();
  assert.deepEqual(moveCursor(m, [3003, 1003], "ArrowUp", "top"), [3003, 1002], "top-down: screen and world axes coincide");
  assert.deepEqual(moveCursor(m, [3003, 1003], "ArrowRight", "top"), [3004, 1003]);
  assert.deepEqual(moveCursor(m, [3003, 1003], "ArrowDown", "top"), [3003, 1004]);
  assert.deepEqual(moveCursor(m, [3003, 1003], "ArrowLeft", "top"), [3002, 1003]);
  assert.deepEqual(moveCursor(m, [2992, 1003], "ArrowLeft", "top"), [2992, 1003], "no further than 8 tiles off the house");
  assert.equal(moveCursor(m, [3003, 1003], "Enter"), null);
  assert.equal(moveCursor(m, [3003, 1003], "Enter", "top"), null);
});

test("[fast] house areas: at the game angle the arrow keys move the cursor the way they point on screen, ↓ undoes ↑, and every tile is reachable", () => {
  const m = vault(), at = (t: readonly number[]) => project(t[0]!, t[1]!, 0, "angle");
  for (const start of [[3003, 1003], [3002, 1003], [3001, 1004]] as Array<[number, number]>) {
    const go = (k: string) => moveCursor(m, start, k)!, d = (k: string): [number, number] => { const a = at(start), b = at(go(k)); return [b[0] - a[0], b[1] - a[1]]; };
    assert.deepEqual(d("ArrowLeft"), [-W, 0], "← one tile left");
    assert.deepEqual(d("ArrowRight"), [W, 0], "→ one tile right");
    const up = d("ArrowUp"), down = d("ArrowDown");
    assert.ok(up[1] === -W / 2 && Math.abs(up[0]) === W / 2, `↑ half a tile up the screen: ${up}`);
    assert.ok(down[1] === W / 2 && Math.abs(down[0]) === W / 2, `↓ half a tile down: ${down}`);
    assert.deepEqual(moveCursor(m, go("ArrowUp"), "ArrowDown"), start, "↓ undoes ↑");
    assert.deepEqual(moveCursor(m, go("ArrowDown"), "ArrowUp"), start, "↑ undoes ↓");
    // Two presses go straight up or down: the column comes back.
    const up2 = moveCursor(m, go("ArrowUp"), "ArrowUp")!;
    assert.deepEqual([at(up2)[0] - at(start)[0], at(up2)[1] - at(start)[1]], [0, -W]);
  }
  // From the house's middle, the arrows reach every tile of the house.
  const seen = new Set<string>(["3003:1003"]), todo: Array<[number, number]> = [[3003, 1003]];
  while (todo.length) {
    const t = todo.pop()!;
    for (const k of ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]) {
      const n = moveCursor(m, t, k)!;
      if (n[0] < m.x0 || n[0] > m.x1 || n[1] < m.y0 || n[1] > m.y1 || seen.has(n.join(":"))) continue;
      seen.add(n.join(":")); todo.push(n);
    }
  }
  assert.equal(seen.size, (m.x1 - m.x0 + 1) * (m.y1 - m.y0 + 1));
});

test("[fast] house areas: boundsOf an area covers its rectangles only", () => {
  const m = vault(), all = boundsOf(m, 0, "angle"), one = boundsOf(m, 0, "angle", areaOf("x", 0, [rectOf([3001, 1001], [3002, 1002])]));
  assert.ok(one.w < all.w && one.h < all.h);
});

// ---------------------------------------------------------------- where the house is (issue #164)
const summary = (id: string, facet: number | null, x0: number, y0: number, name?: string) => ({ id, facet, capturedAt: "", captures: 1, width: 18, height: 18, plot: { x0, y0, x1: x0 + 17, y1: y0 + 17 }, levels: 1, containers: 0, serials: [] as number[], ...(name ? { name } : {}) });

test("[fast] house map: a house's centre tile in world tiles and the one line the Location section shows and Copy puts on the clipboard", () => {
  const w = whereOf(summary("1-1427-1684", 1, 1427, 1684));
  assert.deepEqual(w, { centre: [1435, 1692], centreText: "1435, 1692", copy: "1435, 1692 · Trammel" }, "no corners, no sextant reading");
  assert.equal(whereOf(summary("1-7000-100", 1, 7000, 100)).copy, "7008, 108 · Trammel");
  assert.equal(whereOf(summary("x-5-6", null, 5, 6)).copy, "13, 14 · Unknown facet");
  assert.deepEqual(FACET_SIZE[1], [7168, 4096]);
  assert.equal(whereTitle(summary("3-1000-400", 3, 1000, 400)), "Location - Malas - 1008 408", "the Where heading names the facet and the centre tile");
});

test("[fast] house map: the overview's crop is 600 x 450 tiles around the house, slid back inside the facet at its edges", () => {
  assert.deepEqual(cropAround(1, [1435, 1692]), { x0: 1135, y0: 1467, x1: 1735, y1: 1917 });
  assert.deepEqual(cropAround(1, [10, 4090]), { x0: 0, y0: 3646, x1: 600, y1: 4096 });
  assert.deepEqual(cropAround(4, [1440, 5]), { x0: 848, y0: 0, x1: 1448, y1: 450 });
  assert.equal(cropAround(null, [10, 10]), null);
  assert.equal(cropAround(9, [10, 10]), null);
  assert.equal(facetMapUrl(3, { x0: 1, y0: 2, x1: 601, y1: 452 }), "/api/facet-map/3.png?x0=1&y0=2&x1=601&y1=452&w=600");
});

test("[fast] house map: markers sit at each house's centre tile inside the crop; houses on another facet or outside the crop have none", () => {
  const here = summary("1-1427-1684", 1, 1427, 1684, "Main house");
  const crop = cropAround(1, whereOf(here).centre)!;
  const list = [here, summary("1-1500-1700", 1, 1500, 1700), summary("3-1427-1684", 3, 1427, 1684, "Malas forge"), summary("1-3000-3000", 1, 3000, 3000), summary("0-1500-1700", 0, 1500, 1700)];
  const ms = markersOf(list, here.id, 1, crop);
  assert.deepEqual(ms.map((m) => [m.id, m.current, m.x, m.y]), [["1-1500-1700", false, 373.5, 241.5], ["1-1427-1684", true, 300.5, 225.5]], "the others first, this house drawn last, on top");
  assert.equal(ms.find((m) => m.current)!.label, "Main house (this house)");
  assert.equal(ms.find((m) => !m.current)!.label, "Trammel house at 1508, 1708");
  assert.deepEqual(markersOf(list, "nope", 1, crop).map((m) => m.current), [false, false], "no current house, still the others");
});

test("[fast] house map: the region the server drew is read from its x-region header, and markers are sized in screen pixels", () => {
  assert.deepEqual(parseRegion("848,0,1448,450"), { x0: 848, y0: 0, x1: 1448, y1: 450 });
  for (const bad of [null, "", "1,2,3", "1,2,3,4,5", "4,0,4,9", "a,b,c,d", "-1,0,4,4", " 1,2,3,4"]) assert.equal(parseRegion(bad), null, String(bad));
  assert.deepEqual(markerRadii(600, 300), { current: 12, other: 8, ring: 18, hit: 24 }, "at half scale, a 24 px target is 48 tiles across");
  assert.deepEqual(markerRadii(600, 600), { current: 6, other: 4, ring: 9, hit: 12 });
  assert.deepEqual(markerRadii(600, 0), markerRadii(600, 300), "before layout, 300 px is assumed");
});

test("[fast] house map: why the overview is missing, in plain words", () => {
  for (const r of ["no-client", "no-tazuo-profile", "override-missing", "missing", "unreadable", "error"] as const) {
    const t = facetMapNote(r);
    assert.ok(t.length > 20, r);
    assert.ok(!/undefined|null/.test(t), r);
  }
  assert.match(facetMapNote("missing"), /facet/);
});

// ---------------------------------------------------------------- the contents drawer
const thing = (serial: number, name: string, container: number, extra: Partial<Item> = {}): Item => ({ serial, name, container, root: 1, kind: "other", lines: [name], tags: [], rarity: null, props: {}, amount: 1, ...extra } as unknown as Item);
const chestItems = (): Item[] => [
  thing(10, "Arrows", 1), thing(11, "Weapons", 1, { kind: "container" }), thing(12, "Katana", 11, { lines: ["Katana", "Hit Chance Increase 15%"], rarity: "Greater Magic" }),
  thing(13, "Gems", 11), thing(14, "Ruby", 13), thing(15, "Bow", 11, { tags: ["cursed"] }), thing(16, "Empty pouch", 1), thing(17, "Bandage", 1),
];
const bagSerials = new Set([11, 13, 16]);

test("[fast] house map drawer: a chest's items as a tree, bags first and nested inside nested, with the loose and in-bag counts", () => {
  const c = contentsOf(chestItems(), 1, (s) => bagSerials.has(s));
  const shape = (ns: ContentsNode[]): unknown[] => ns.map((n) => (n.kind === "bag" ? [n.item.name, n.count, shape(n.kids)] : n.item.name));
  assert.deepEqual(shape(c.nodes), [["Weapons", 4, [["Gems", 1, ["Ruby"]], "Katana", "Bow"]], ["Empty pouch", 0, []], "Arrows", "Bandage"]);
  assert.deepEqual([c.total, c.loose, c.inBags, c.bags], [8, 2, 4, 2]);
  assert.equal(contentsSummary(c), "8 items · 2 loose, 4 in 2 containers");
  assert.equal(contentsSummary(contentsOf([thing(1, "A", 9)], 9, () => false)), "1 item");
  assert.equal(contentsSummary(contentsOf([], 9, () => false)), "Empty");
  // an item whose bag is not among the items (not scanned) is shown loose rather than lost
  assert.deepEqual(contentsOf([thing(5, "Stray", 77)], 9, () => false).nodes.map((n) => n.item.name), ["Stray"]);
});

test("[fast] house map drawer: items in a container cycle, reachable from no chest, are shown loose rather than lost", () => {
  const c = contentsOf([thing(1, "Pouch", 2), thing(2, "Box", 3), thing(3, "Crate", 1), thing(4, "Arrows", 9)], 9, () => false);
  assert.deepEqual(c.nodes.map((n) => [n.kind, n.item.name]), [["item", "Arrows"], ["item", "Pouch"], ["item", "Box"], ["item", "Crate"]]);
  assert.deepEqual([c.total, c.loose, c.inBags, c.bags], [4, 4, 0, 0]);
  assert.equal(contentsSummary(c), "4 items");
});

test("[fast] house map drawer: the filter matches name, tooltip line and tag text, keeps a bag holding a match (or matching itself) and counts what it kept", () => {
  const c = contentsOf(chestItems(), 1, (s) => bagSerials.has(s));
  const names = (ns: ContentsNode[]): string[] => ns.flatMap((n) => [n.item.name, ...(n.kind === "bag" ? names(n.kids) : [])]);
  assert.deepEqual(names(filterContents(c.nodes, "")), names(c.nodes), "no needle, everything");
  assert.deepEqual(names(filterContents(c.nodes, "ruby")), ["Weapons", "Gems", "Ruby"]);
  assert.deepEqual(names(filterContents(c.nodes, " HIT CHANCE ")), ["Weapons", "Katana"], "a property line, any case");
  assert.deepEqual(names(filterContents(c.nodes, "cursed")), ["Weapons", "Bow"], "a tag");
  assert.deepEqual(names(filterContents(c.nodes, "gems")), ["Weapons", "Gems", "Ruby"], "a matching bag keeps all it holds");
  assert.equal((filterContents(c.nodes, "ruby")[0] as Extract<ContentsNode, { kind: "bag" }>).count, 2);
  assert.deepEqual(filterContents(c.nodes, "nothing like it"), []);
});

test("[fast] house map drawer: up to 4 chests the stack's chests are tabs; more are a select, each option the code and name, a chest not opened yet disabled", () => {
  const view = (serial: number, opened: boolean): ChestView => ({ serial, code: `A${serial}`, name: `Chest ${serial}`, inGame: "Metal Chest", color: null, fill: null, opened, items: 0, z: 0 });
  const four = drawerPicker([view(4, true), view(3, false), view(2, true), view(1, true)]);
  assert.equal(four.kind, "tabs");
  assert.deepEqual(four.options[1], { value: "3", label: "A3", sub: "Chest 3", disabled: true, title: "Not opened yet" });
  assert.deepEqual(four.options[0], { value: "4", label: "A4", sub: "Chest 4", disabled: false, title: "A4 Chest 4" });
  const five = drawerPicker([5, 4, 3, 2, 1].map((n) => view(n, n !== 3)));
  assert.equal(five.kind, "select");
  assert.equal(five.options.length, 5);
  assert.deepEqual(five.options[2], { value: "3", label: "A3 Chest 3 · Not opened yet", sub: "Chest 3", disabled: true, title: "Not opened yet" });
  assert.equal(five.options[0]!.label, "A5 Chest 5");
  assert.equal(DRAWER_TABS_MAX, 4);
});

test("[fast] house map drawer: a stack opens its top opened chest; the header words the chest, its stack and its fill", () => {
  const view = (serial: number, opened: boolean, extra: Partial<ChestView> = {}): ChestView => ({ serial, code: `A${serial}`, name: `Chest ${serial}`, inGame: "Metal Chest", color: null, fill: { items: 106, max: 125 }, opened, items: 0, z: 0, ...extra });
  assert.equal(drawerChest([view(4, false), view(3, true), view(2, true)]), 3, "top first, the first opened one");
  assert.equal(drawerChest([view(4, false)]), null);
  const s = { letter: "A", serials: [1, 2, 3, 4] } as unknown as Stack;
  assert.equal(drawerMeta(view(3, true), s), "In game: Metal Chest · Stack A, 4 containers");
  assert.equal(slotsText(view(3, true)), "106 of 125 slots");
  assert.equal(slotsText(view(3, true, { fill: null })), "Fill unknown");
});

test("[fast] house map: the contents drawer is 400 px by default, at least 320, and at most what leaves the map 360 px", () => {
  assert.deepEqual([DRAWER_W, DRAWER_MIN], [400, 320]);
  assert.equal(drawerMax(400, 600), 640, "the map's 240 px above its 360 go to the drawer");
  assert.equal(drawerMax(400, 300), 340, "a map already under 360 px takes the drawer down to give it back");
  assert.equal(drawerMax(320, 100), 320, "never under the minimum");
  assert.equal(clampDrawer(500.4, 640), 500);
  assert.equal(clampDrawer(200, 640), 320);
  assert.equal(clampDrawer(900, 640), 640);
  assert.equal(clampDrawer(900, 200), 320, "a window too narrow for both keeps the minimum");
});

test("[fast] house map: the drawer's resize handle moves 16 px per arrow (64 with Shift) the way the arrow points, Home and End go to the minimum and maximum", () => {
  assert.equal(drawerKey("ArrowLeft", false, 400, 640), 416, "← moves the edge left: wider");
  assert.equal(drawerKey("ArrowRight", false, 400, 640), 384);
  assert.equal(drawerKey("ArrowLeft", true, 400, 640), 464);
  assert.equal(drawerKey("ArrowRight", true, 360, 640), 320, "clamped");
  assert.equal(drawerKey("ArrowLeft", true, 620, 640), 640, "clamped");
  assert.equal(drawerKey("Home", false, 500, 640), 320);
  assert.equal(drawerKey("End", false, 500, 640), 640);
  assert.equal(drawerKey("Enter", false, 500, 640), null);
});

// ---------------------------------------------------------------- search on the map (issue #10)
test("[fast] house map search: the route keeps the house, the query and a stack to select, and reads back what it wrote", () => {
  assert.deepEqual(parseMapHash("#/map/1-3000-1000?q=spell%20book&select=1073807360"), { house: "1-3000-1000", q: "spell book", select: 0x40010000 });
  assert.deepEqual(parseMapHash("#/map"), { house: null, q: "", select: null });
  assert.deepEqual(parseMapHash("#/map?q=a%2Fb"), { house: null, q: "a/b", select: null }, "a slash in the query is not a house");
  assert.deepEqual(parseMapHash("#/map/plain?select=x"), { house: "plain", q: "", select: null });
  for (const r of [{ house: "1-3000-1000", q: "Pearl & ruby", select: 12 }, { house: null, q: "x", select: null }, { house: "plain", q: "", select: 3 }]) assert.deepEqual(parseMapHash(mapHash(r)), r);
  assert.equal(mapHash({ house: "1-3000-1000" }), "#/map/1-3000-1000");
  assert.equal(mapHash({ house: "1-3000-1000", q: "  " }), "#/map/1-3000-1000", "a blank query is no query");
});

test("[fast] house map search: an item counts for the container on the floor it is in, through nested bags; an unlisted bag or a cycle falls back to the scan root, a worn item to none", () => {
  const containers = { 1: { parent: null }, 2: { parent: 1 }, 3: { parent: 2 }, 8: { parent: 9 }, 9: { parent: 8 } };
  assert.equal(floorContainerOf({ container: 1, root: 1 }, containers), 1);
  assert.equal(floorContainerOf({ container: 3, root: 1 }, containers), 1, "a bag in a bag in the chest");
  assert.equal(floorContainerOf({ container: 77, root: 1 }, containers), 1, "a bag no scan listed");
  assert.equal(floorContainerOf({ container: 8, root: 5 }, containers), 5, "a cycle");
  assert.equal(floorContainerOf({ container: null, root: null }, containers), null);
});

test("[fast] house map search: a container's place in its stack in words, counted from the floor", () => {
  assert.equal(positionWords(0, 1), "On its own");
  assert.deepEqual([0, 1, 2, 3, 4].map((i) => positionWords(i, 5)), ["Bottom", "2nd from bottom", "3rd from bottom", "4th from bottom", "Top"]);
  assert.equal(positionWords(10, 13), "11th from bottom");
  assert.equal(positionWords(20, 23), "21st from bottom");
});

test("[fast] house map search: the matches in a house by container (stack order, top first) with their items by name and amount, each stack's matches, and the rest outside the house", () => {
  const m = vault(), [s0, s1] = m.stacks, bottom = s0!.serials[0]!, top = s0!.serials.at(-1)!, other = s1!.serials[2]!;
  const containers: Record<string, { parent: number | null }> = Object.fromEntries(m.stacks.flatMap((s) => s.serials.map((x) => [String(x), { parent: null }])));
  containers[900] = { parent: top }; containers[901] = { parent: 900 };   // a bag in a bag in the top chest
  const items = [thing(1, "Pearl", bottom, { root: bottom, amount: 3 }), thing(2, "Pearl", bottom, { root: bottom, amount: 2 }), thing(3, "Black Pearl", 901, { root: top }),
    thing(4, "Pearl", other, { root: other, amount: 0 }), thing(5, "Pearl", 50, { root: 50 }), thing(6, "Pearl", 0, { root: null, container: null })];
  const h = houseHits(m, items, containers);
  assert.deepEqual(h.chests.map((c) => [c.serial, c.stack.letter, c.position, c.amount, c.lines.map((l) => `${l.name} × ${l.amount}`)]), [
    [top, s0!.letter, "Top", 1, ["Black Pearl × 1"]], [bottom, s0!.letter, "Bottom", 5, ["Pearl × 5"]], [other, s1!.letter, "3rd from bottom", 1, ["Pearl × 1"]]]);
  assert.equal(h.chests[1]!.lines[0]!.item.serial, 1, "the first item of a name stands for it");
  assert.deepEqual([...h.stacks.keys()], [s0!.letter, s1!.letter]);
  assert.deepEqual(h.stacks.get(s0!.letter)!.map((c) => c.serial), [top, bottom]);
  assert.equal(h.amount, 7);
  assert.deepEqual(h.outside.map((it) => it.serial), [5, 6]);
  assert.deepEqual([...h.serials].sort(), [top, bottom, other].sort());
});

test("[fast] house map search: the left pane's counts per level, area and rest, and their words", () => {
  const m = vault(), north: HouseArea = { id: "a1", name: "North", level: 0, color: "area-1", rects: [{ x0: 3001, y0: 1001, x1: 3005, y1: 1001 }] };
  const inNorth = m.stacks.find((s) => s.y === 1001)!, elsewhere = m.stacks.find((s) => s.y === 1005)!;
  const t = levelHits(m, [north], 0, new Set([inNorth.serials[0]!, inNorth.serials[1]!, elsewhere.serials[4]!]));
  assert.deepEqual([t.matches, t.containers], [3, 120]);
  assert.deepEqual(t.areas.get("a1"), { matches: 2, containers: 25 });
  assert.deepEqual(t.rest, { matches: 1, containers: 95 });
  assert.equal(levelHitText(t), "3 of 120 containers match");
  assert.equal(levelHitText({ matches: 0, containers: 9 }), "no matches");
  assert.equal(areaHitText(t.areas.get("a1")!), "2 of 25");
  assert.equal(areaHitText({ matches: 0, containers: 4 }), "–");
  assert.equal(hitsSummary(7, 3), "7 items in 3 containers");
  assert.equal(hitsSummary(1, 1), "1 item in 1 container");
  assert.equal(searchCount(1200, 3), "1,200 in 3");
  assert.deepEqual(calloutHead({ letter: "I", serials: [1, 2, 3, 4] }, 1), { title: "Stack I", count: "1 of 4 match" });
  assert.deepEqual(calloutHead({ letter: "F", serials: [1] }, 1), { title: "Stack F", count: "1 container" });
});

test("[fast] house map search: the callouts sit in one row in their stacks' left-to-right order, never overlapping, kept clear of the zoom buttons, at most 3 with a +N more chip", () => {
  const row = calloutRow([{ id: "C", x: 600 }, { id: "I", x: 200 }, { id: "F", x: 400 }], 900);
  assert.deepEqual(row.cards.map((c) => c.id), ["I", "F", "C"]);
  assert.equal(row.more, null);
  for (let i = 1; i < row.cards.length; i++) assert.ok(row.cards[i]!.left >= row.cards[i - 1]!.left + row.cards[i - 1]!.width, "no overlap");
  for (const c of row.cards) {
    assert.ok(c.width <= CALLOUT_W && c.left >= 12 && c.left + c.width <= 900 - 12 - 52, JSON.stringify(c));
    assert.ok(c.leaderX >= c.left + 16 && c.leaderX <= c.left + c.width - 16);
  }
  for (let i = 1; i < row.cards.length; i++) assert.ok(row.cards[i]!.leaderX >= row.cards[i - 1]!.leaderX, "leaders never cross");
  const many = calloutRow([{ id: "A", x: 100 }, { id: "B", x: 50 }, { id: "C", x: 300 }, { id: "D", x: 10 }, { id: "E", x: 20 }], 1200);
  assert.deepEqual(many.cards.map((c) => c.id), ["B", "A", "C"], "the first three given, in screen order");
  assert.equal(many.more?.count, 2);
  assert.ok(many.more!.left >= many.cards.at(-1)!.left + many.cards.at(-1)!.width);
  assert.ok(many.more!.left + many.more!.width <= 1200 - 12 - 52);
  const narrow = calloutRow([{ id: "A", x: 100 }, { id: "B", x: 200 }, { id: "C", x: 300 }], 400);
  assert.ok(narrow.cards.length < 3 && narrow.cards.every((c) => c.width >= CALLOUT_MIN), "a narrow pane shows fewer, never thinner than the minimum");
  assert.equal(narrow.more?.count, 3 - narrow.cards.length);
  assert.deepEqual(calloutRow([], 900), { cards: [], more: null });
  // stacks in one screen column: the left card takes the higher anchor, so the two leaders never cross
  const column = calloutRow([{ id: "low", x: 400, y: 500 }, { id: "high", x: 401, y: 300 }, { id: "far", x: 700, y: 100 }], 1200);
  assert.deepEqual(column.cards.map((c) => c.id), ["high", "low", "far"]);
  assert.deepEqual(calloutRow([{ id: "high", x: 400, y: 300 }, { id: "low", x: 403, y: 500 }], 1200).cards.map((c) => c.id), ["high", "low"]);
});

test("[fast] house map search: the view zooms to the matching stacks, at least 8 tiles across, with room above for the callouts", () => {
  const m = vault(), s = m.stacks[0]!, v = hitsView(m, [s], "angle"), a = anchorOf(m, s, "angle");
  assert.ok(v.w >= 8 * W && v.h >= 12 * W, JSON.stringify(v));
  assert.ok(a[0] > v.x && a[0] < v.x + v.w && a[1] > v.y + v.h / 2 && a[1] < v.y + v.h, "the stack in the lower half");
  const both = hitsView(m, [m.stacks[0]!, m.stacks.at(-1)!], "angle"), b = anchorOf(m, m.stacks.at(-1)!, "angle");
  assert.ok(b[0] > both.x && b[0] < both.x + both.w && b[1] < both.y + both.h);
  const front = m.stacks.reduce((a, b) => (b.x + b.y > a.x + a.y ? b : a)), fv = hitsView(m, [front], "angle"), fh = hitsView(m, [front], "angle", false).h;
  for (const o of m.stacks) { const [ox, oy] = anchorOf(m, o, "angle"); if (Math.abs(ox - (fv.x + fv.w / 2)) <= fv.w / 2) assert.ok(oy - fv.y >= fh - 0.01, `the room is above stack ${o.letter} too`); }
  const mid = hitsView(m, [s], "angle", false);
  assert.ok(a[1] > mid.y && a[1] < mid.y + mid.h && mid.h === v.h / 2, "without room the stack is in the middle");
});

test("[fast] house map links: which house holds each container (a drawn house's stacks, else the plain grid for a ground container with a place), and the matches elsewhere by house and by place", () => {
  const containers = { 1: { parent: null, kind: "ground", pos: { x: 1, y: 1 } }, 2: { parent: null, kind: "ground", pos: { x: 9, y: 9 } }, 3: { parent: null, kind: "backpack", pos: null }, 4: { parent: 2, kind: "bag", pos: null } };
  const idx = houseIndex([{ id: "1-5-5", facet: 1, name: "Keep", serials: [1] }, { id: "1-8-8", facet: 0, serials: [7] }], containers);
  assert.deepEqual(idx.get(1), { id: "1-5-5", name: "Keep" });
  assert.deepEqual(idx.get(7), { id: "1-8-8", name: "Felucca house" });
  assert.deepEqual(idx.get(2), { id: PLAIN, name: "Containers on the ground" });
  assert.equal(idx.get(3), undefined);
  assert.equal(idx.get(4), undefined, "a bag is in its container's house, not one of its own");
  const items = [thing(1, "Ingot", 1, { root: 1, amount: 200 }), thing(2, "Ingot", 4, { root: 2, amount: 5 }), thing(3, "Ingot", 3, { root: 3, amount: 364, location: { text: "Ann's backpack › Pouch", kind: "backpack", character: "Ann", root: 3 } }), thing(4, "Ingot", 7, { root: 7 })];
  const e = elsewhereOf(items, idx, containers, "1-8-8");
  assert.equal(e.amount, 569);
  assert.deepEqual(e.houses.map((h) => [h.id, h.amount, h.serials]), [["1-5-5", 200, [1]], [PLAIN, 5, [2]]], "each house with the containers there that hold the matches");
  assert.deepEqual(e.places, [{ name: "Ann's backpack", amount: 364 }]);
  assert.equal(outsideText(e), "569 more outside this house (Keep, Containers on the ground, and 1 more place).");
  assert.equal(outsideText(elsewhereOf([items[2]!], idx, containers, null)), "364 more outside this house (Ann's backpack).");
});
