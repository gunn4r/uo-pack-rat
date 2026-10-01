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

async function serve(withTiledata: boolean): Promise<ServerHandle> {
  const dir = mkdtempSync(join(tmpdir(), "pr-house-"));
  const config = ensureLayout(resolveConfig(["--port", "0", "--data", dir], {}));
  const { house, chests } = vaultHouse();
  const scan = houseScan({ scannedAt: house.capturedAt, boxes: chests.map((c) => ({ serial: c.serial, pos: { x: c.x, y: c.y, z: c.z, facet: 1 } })), things: [] });
  writeFileSync(join(dir, "scans", "house.json"), JSON.stringify({ ...scan, house: { facet: 1, capturedAt: house.capturedAt, at: { x: 3003, y: 1003 }, tiles: house.tiles, items: house.items } }));
  if (withTiledata) {
    const root = mkdtempSync(join(tmpdir(), "pr-house-tazuo-")), scripts = join(root, "TazUO", "LegionScripts"), profiles = join(root, "Profiles", "Settings"), uo = join(root, "UO");
    for (const d of [scripts, profiles, uo]) mkdirSync(d, { recursive: true });
    writeFileSync(join(uo, "tiledata.mul"), syntheticTileData([{ graphic: G.pavers, flags: FLAG.surface, name: "stone pavers" }, { graphic: G.stoneWall, flags: FLAG.wall | FLAG.impassable, height: 20, name: "stone wall" }, { graphic: G.planks, flags: FLAG.surface, name: "wooden planks" }, { graphic: G.teleporter, flags: 0n, name: "house teleporter" }]));
    writeFileSync(join(profiles, "p.json"), JSON.stringify({ ultimaonlinedirectory: uo }));
    writeFileSync(join(dir, "settings.json"), JSON.stringify({ schemaVersion: 1, shard: "uoalive", client: { adapter: "tazuo", scriptsDir: scripts } }));
  }
  return startServer(config, {
    clientSearch: { home: FAKE_HOME, candidates: (a) => candidateClientRoots({ adapter: a.id, home: FAKE_HOME, platform: "linux", env: {}, adapterPlatform: a.platform }) },
    clientRunning: () => false,
  });
}
async function get<T>(s: ServerHandle, path: string): Promise<{ status: number; body: T }> {
  const r = await fetch(s.url + path);
  return { status: r.status, body: (await r.json()) as T };
}

test("[fast] houses: a scan with a house capture lists the house and serves its model with its chests", async () => {
  const s = await serve(true);
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
    assert.equal(one.body.house.spots[0]!.teleporter, true);
  } finally { await s.close(); }
});

test("[fast] houses: without a tiledata.mul the model still builds, and an unknown or malformed id is a 404", async () => {
  const s = await serve(false);
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
