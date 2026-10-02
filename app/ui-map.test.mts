// ui-map.test.mts — app/ui/house-map-model.mts, the House map's pure rules (issue #10): the projection, tile and box polygons, the painter's order, a level's bounds and fit, the joins of a stack with the inventory and the Organize labels, the colour modes, the cut-away, callouts, totals, the house picker, keyboard moves, the plain grid, and the scene of a level (castle speed included). Tags: [fast]. Run: node --test app/ui-map.test.mts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildHouseModel } from "./house-model.mts";
import { fixtureTileData, vaultHouse, roofHouse } from "./house-fixture.mts";
import type { Container } from "./vault-lib.mts";
import type { HouseModel } from "./ui/api-types.mts";
import { project, tilePolygon, boxFaces, pts, paintOrder, boundsOf, fit, zoomAt, vbText, anchorOf, W, chestViews, colourOf, legendOf, chestLabel, cutAway, calloutLines, houseTotals, pickHouse, PLAIN, chestCount, roomCounts, nearestInDirection, tiledataNote, stackWhere, plainGrid, type ChestView } from "./ui/house-map-model.mts";

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
  const v = vault();
  const inv = invOf([
    { serial: 0x40060001, x: 3001, y: 1001, z: 7, facet: 1 },    // inside the vault: drawn there, not here
    { serial: 0x40060002, x: 100, y: 100, z: 0, facet: 1 }, { serial: 0x40060003, x: 100, y: 100, z: 4, facet: 1 }, { serial: 0x40060004, x: 108, y: 100, z: 0, facet: 1 },
    { serial: 0x40060005, x: 300, y: 300, z: 0, facet: 1 },
    { serial: 0x40060006, x: 100, y: 100, z: 0, facet: 3 },
  ]);
  const g = plainGrid(inv, [v])!;
  assert.equal(g.id, PLAIN);
  assert.equal(chestCount(g), 5);
  assert.ok(!g.stacks.some((s) => s.serials.includes(0x40060001)));
  assert.deepEqual(g.rooms.map((r) => r.name), ["Trammel, group 1", "Trammel, group 2", "Malas, group 3"]);
  assert.deepEqual(g.stacks.find((s) => s.serials.includes(0x40060002))!.serials, [0x40060002, 0x40060003], "two chests on one tile are one stack, bottom first");
  assert.equal(new Set(g.stacks.map((s) => `${s.x}:${s.y}`)).size, g.stacks.length, "groups never overlap on the grid");
  assert.equal(new Set(g.stacks.map((s) => s.letter)).size, g.stacks.length);
  assert.ok(g.cells.every((c) => c.kind === "floor" && c.family === "neutral"));
  assert.equal(plainGrid(invOf([{ serial: 0x40060001, x: 3001, y: 1001, z: 7, facet: 1 }]), [v]), null);
  assert.equal(chestCount(plainGrid(invOf([{ serial: 1, x: 5, y: 5, z: 0 }]), [])!), 1, "a chest of an unknown facet is drawn too");
});
