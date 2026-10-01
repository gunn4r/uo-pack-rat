// house-server.test.mts — GET /api/houses and GET /api/houses/<id> (issue #10) against a real listening server on a temp data folder: a scan with a house capture becomes a house, its ground chests become stacks, and the client's tiledata.mul is found through the TazUO launcher profile (or not, and the model falls back). Tags: [fast]. Run: node --test app/house-server.test.mts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveConfig, ensureLayout } from "./config.mts";
import { startServer, type ServerHandle } from "./vault-server.mts";
import { candidateClientRoots } from "./installer.mts";
import { houseScan } from "./organize-fixture.mts";
import { vaultHouse, G } from "./house-fixture.mts";
import { syntheticTileData } from "./tiledata-fixture.mts";
import { FLAG } from "./tiledata.mts";
import type { HouseModel } from "./house-model.mts";

const FAKE_HOME = mkdtempSync(join(tmpdir(), "pr-house-home-"));

const PACK = 0x40020001;

async function serve(withTiledata: boolean): Promise<{ s: ServerHandle; dir: string }> {
  const dir = mkdtempSync(join(tmpdir(), "pr-house-"));
  const config = ensureLayout(resolveConfig(["--port", "0", "--data", dir], {}));
  const { house, chests } = vaultHouse();
  const scan = houseScan({ scannedAt: house.capturedAt, boxes: [...chests.map((c) => ({ serial: c.serial, pos: { x: c.x, y: c.y, z: c.z, facet: 1 } })), { serial: PACK, kind: "backpack" as const, name: "Backpack" }], things: [] });
  (scan.containers[String(PACK)] as Record<string, unknown>).pos = { x: 3001, y: 1001, z: 27, facet: 1 };   // a root that is not a ground chest is never a stack, wherever it says it is
  writeFileSync(join(dir, "scans", "house.json"), JSON.stringify({ ...scan, house: { facet: 1, capturedAt: house.capturedAt, at: { x: 3003, y: 1003 }, tiles: house.tiles, items: house.items } }));
  if (withTiledata) {
    const root = mkdtempSync(join(tmpdir(), "pr-house-tazuo-")), scripts = join(root, "TazUO", "LegionScripts"), profiles = join(root, "Profiles", "Settings"), uo = join(root, "UO");
    for (const d of [scripts, profiles, uo]) mkdirSync(d, { recursive: true });
    writeFileSync(join(uo, "tiledata.mul"), syntheticTileData([{ graphic: G.pavers, flags: FLAG.surface, name: "stone pavers" }, { graphic: G.stoneWall, flags: FLAG.wall | FLAG.impassable, height: 20, name: "stone wall" }, { graphic: G.planks, flags: FLAG.surface, name: "wooden planks" }, { graphic: G.teleporter, flags: 0n, name: "house teleporter" }]));
    writeFileSync(join(profiles, "p.json"), JSON.stringify({ ultimaonlinedirectory: uo }));
    writeFileSync(join(dir, "settings.json"), JSON.stringify({ schemaVersion: 1, shard: "uoalive", client: { adapter: "tazuo", scriptsDir: scripts } }));
  }
  const s = await startServer(config, {
    clientSearch: { home: FAKE_HOME, candidates: (a) => candidateClientRoots({ adapter: a.id, home: FAKE_HOME, platform: "linux", env: {}, adapterPlatform: a.platform }) },
    clientRunning: () => false,
  });
  return { s, dir };
}
async function get<T>(s: ServerHandle, path: string): Promise<{ status: number; body: T }> {
  const r = await fetch(s.url + path);
  return { status: r.status, body: (await r.json()) as T };
}

test("[fast] houses: a scan with a house capture lists the house and serves its model with its chests", async () => {
  const { s } = await serve(true);
  try {
    const list = await get<{ houses: Array<{ id: string; containers: number; width: number; height: number; levels: number }>; tiledata: boolean }>(s, "/api/houses");
    assert.equal(list.status, 200);
    assert.equal(list.body.tiledata, true);
    assert.deepEqual(list.body.houses.map((h) => [h.id, h.containers, h.width, h.height]), [["1-3000-1000", 120, 7, 7]]);
    const one = await get<{ house: HouseModel }>(s, "/api/houses/1-3000-1000");
    assert.equal(one.status, 200);
    assert.equal(one.body.house.tiledata, true);
    assert.equal(one.body.house.levels[0]!.status, "built");
    assert.equal(one.body.house.stacks.reduce((a, st) => a + st.serials.length, 0), 120);
    assert.ok(!one.body.house.stacks.some((st) => st.serials.includes(PACK)), "a backpack root is not a ground chest");
    assert.equal(one.body.house.spots[0]!.teleporter, true);
  } finally { await s.close(); }
});

test("[fast] houses: without a tiledata.mul the model still builds, and an unknown or malformed id is a 404", async () => {
  const { s } = await serve(false);
  try {
    const list = await get<{ tiledata: boolean }>(s, "/api/houses");
    assert.equal(list.body.tiledata, false);
    const one = await get<{ house: HouseModel }>(s, "/api/houses/1-3000-1000");
    assert.equal(one.body.house.tiledata, false);
    assert.equal(one.body.house.furniture.length, 0);
    for (const path of ["/api/houses/1-9-9", "/api/houses/..%2Fetc", "/api/houses/%E0%A4%A"]) {
      const r = await get<{ ok: boolean; error: string }>(s, path);
      assert.equal(r.status, 404, path);
      assert.deepEqual(r.body, { ok: false, error: "no such house" }, path);
    }
  } finally { await s.close(); }
});

test("[fast] houses: a footprint grown west replaces the old house, so a chest inside both is counted in one house", async () => {
  const { s, dir } = await serve(true);
  try {
    const { house } = vaultHouse();
    const later = new Date(Date.parse(house.capturedAt) + 60e3).toISOString();
    const scan = houseScan({ character: "Other", scannedAt: later, boxes: [], things: [] });
    writeFileSync(join(dir, "scans", "house-grown.json"), JSON.stringify({ ...scan, house: { facet: 1, capturedAt: later, at: { x: 3003, y: 1003 }, tiles: [...house.tiles, [G.pavers, 2999, 1003, 7, 0]], items: house.items } }));
    const list = await get<{ houses: Array<{ id: string; containers: number }> }>(s, "/api/houses");
    assert.deepEqual(list.body.houses.map((h) => [h.id, h.containers]), [["1-2999-1000", 120]]);
    assert.equal((await get(s, "/api/houses/1-3000-1000")).status, 404);
  } finally { await s.close(); }
});

test("[fast] houses: a captured house holding no ground chest is listed with 0 containers", async () => {
  const { s, dir } = await serve(true);
  try {
    const { house } = vaultHouse();
    const scan = houseScan({ character: "Other", scannedAt: house.capturedAt, boxes: [], things: [] });
    writeFileSync(join(dir, "scans", "house-empty.json"), JSON.stringify({ ...scan, house: { facet: 1, capturedAt: house.capturedAt, at: { x: 9003, y: 9003 }, tiles: house.tiles.map(([g, x, y, z, imp]) => [g, x + 6000, y + 8000, z, imp]), items: [] } }));
    const list = await get<{ houses: Array<{ id: string; containers: number }> }>(s, "/api/houses");
    assert.deepEqual(list.body.houses.map((h) => [h.id, h.containers]), [["1-3000-1000", 120], ["1-9000-9000", 0]]);
  } finally { await s.close(); }
});

test("[fast] houses: the same model is served again while nothing changes, and a newer capture replaces it", async () => {
  const { s, dir } = await serve(true);
  try {
    const first = await get<{ house: HouseModel }>(s, "/api/houses/1-3000-1000");
    const again = await get<{ house: HouseModel }>(s, "/api/houses/1-3000-1000");
    assert.deepEqual(again.body, first.body);
    const { house } = vaultHouse();
    const later = new Date(Date.parse(house.capturedAt) + 60e3).toISOString();
    const scan = houseScan({ character: "Other", scannedAt: later, boxes: [], things: [] });
    writeFileSync(join(dir, "scans", "house-later.json"), JSON.stringify({ ...scan, house: { facet: 1, capturedAt: later, at: { x: 3003, y: 1003 }, tiles: [...house.tiles, [G.pavers, 3007, 1003, 7, 0]], items: house.items } }));
    const next = await get<{ house: HouseModel }>(s, "/api/houses/1-3000-1000");
    assert.equal(next.body.house.capturedAt, later);
    assert.equal(next.body.house.captures, 2);
    assert.equal(next.body.house.x1, 3007);
    const list = await get<{ houses: Array<{ width: number; captures: number }> }>(s, "/api/houses");
    assert.deepEqual(list.body.houses.map((h) => [h.width, h.captures]), [[8, 2]]);
  } finally { await s.close(); }
});
