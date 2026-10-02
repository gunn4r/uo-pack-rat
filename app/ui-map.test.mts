// ui-map.test.mts — app/ui/house-map-model.mts, the House map's pure rules (issue #10): the projection, tile and box polygons, the painter's order, a level's bounds and fit, the joins of a stack with the inventory and the Organize labels, the colour modes, the cut-away, callouts, totals, the house picker, keyboard moves, the plain grid, and the scene of a level (castle speed included). Tags: [fast]. Run: node --test app/ui-map.test.mts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildHouseModel } from "./house-model.mts";
import { fixtureTileData, vaultHouse, roofHouse, courtyardHouse, castleHouse, foundationHouse, stairHouse } from "./house-fixture.mts";
import type { Container } from "./vault-lib.mts";
import type { HouseModel } from "./ui/api-types.mts";
import { project, tilePolygon, boxFaces, pts, paintOrder, boundsOf, fit, zoomAt, vbText, anchorOf, W, chestViews, colourOf, legendOf, chestLabel, cutAway, calloutLines, houseTotals, pickHouse, PLAIN, chestCount, roomCounts, nearestInDirection, tiledataNote, stackWhere, plainGrid, sceneOf, drawnZs, CHEST_H, type ChestView } from "./ui/house-map-model.mts";

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
  assert.equal([...roomCounts(m).values()].reduce((a, n) => a + n, 0), 27);
  assert.match(stackWhere(m, s), new RegExp(`^Main room · [NESW]+ of standing spot 1 · 4 chests, top first$`));
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
  for (const r of ["no-client", "no-tazuo-profile", "override-missing", "unreadable"] as const) assert.match(tiledataNote(r)!, /plain colours/, r);
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
  assert.deepEqual(g.rooms.map((r) => r.name), ["Trammel, group 1", "Trammel, group 2", "Malas, group 3"]);
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
  assert.equal(g.rooms.length, 1, "8 apart is one group");
  assert.ok(g.cells.length <= 9 * rows.length, `${g.cells.length} cells`);
  assert.equal(new Set(g.cells.map((c) => `${c.x}:${c.y}`)).size, g.cells.length, "no tile twice");
  assert.ok(g.stacks.every((s) => g.cells.some((c) => c.x === s.x && c.y === s.y)), "every chest stands on a floor tile");
  assert.ok(g.x1 >= Math.max(...g.stacks.map((s) => s.x)) + 1 && g.y1 >= Math.max(...g.stacks.map((s) => s.y)) + 1);
});

test("[fast] house map: each plain-grid group stands on its own floor, its chests at their heights above it", () => {
  const g = plainGrid(invOf([{ serial: 1, x: 100, y: 100, z: 0, facet: 1 }, { serial: 2, x: 500, y: 500, z: 40, facet: 1 }, { serial: 3, x: 500, y: 500, z: 46, facet: 1 }]), [])!;
  assert.equal(g.rooms.length, 2);
  assert.ok(g.cells.every((c) => c.z === g.levels[0]!.floorZ), "every group's floor is drawn at the level's floor");
  assert.deepEqual(g.stacks.map((s) => s.zs), [[0], [0, 6]], "the high group's chests sit on its floor, not 40 above the low one");
});

test("[fast] house map: the plain grid is the same whatever order the inventory lists its chests", () => {
  const rows = [{ serial: 1, x: 100, y: 100, z: 0, facet: 1 }, { serial: 2, x: 104, y: 100, z: 0, facet: 1 }, { serial: 3, x: 100, y: 100, z: 5, facet: 1 }, { serial: 4, x: 300, y: 300, z: 2, facet: 1 }, { serial: 5, x: 10, y: 10, z: 0, facet: 3 }, { serial: 6, x: 110, y: 104, z: 0, facet: 1 }];
  const fwd = plainGrid(invOf(rows), [])!, rev = plainGrid(invOf([...rows].reverse()), [])!;
  assert.deepEqual(rev.stacks, fwd.stacks);
  assert.deepEqual(rev.cells, fwd.cells);
  assert.deepEqual(rev.rooms, fwd.rooms);
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
  assert.equal(m.rooms.find((r) => r.id === cell.room)?.kind, "yard", "(1012, 2013) is in the courtyard");
  const at = pts(tilePolygon(cell.x - m.x0, cell.y - m.y0, cell.z - m.levels[0]!.floorZ, "angle"));
  assert.equal(sc.floors.find((f) => f.pts === at)?.cls, "map-floor f-grass yard");
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
