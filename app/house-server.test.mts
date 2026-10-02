// house-server.test.mts — GET /api/houses and GET /api/houses/<id> (issue #10) against a real listening server on a temp data folder: a scan with a house capture becomes a house, its ground chests become stacks, and the client's tiledata.mul is found through the TazUO launcher profile (or not, and the model falls back); and (issue #164) each house's plot and GET /api/facet-map/<facet>.png from the same UO folder's facetNN.mul. Tags: [fast]. Run: node --test app/house-server.test.mts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveConfig, ensureLayout } from "./config.mts";
import { startServer, type ServerHandle } from "./vault-server.mts";
import { candidateClientRoots } from "./installer.mts";
import { houseScan } from "./organize-fixture.mts";
import { vaultHouse, G } from "./house-fixture.mts";
import { syntheticTileData } from "./tiledata-fixture.mts";
import { syntheticFacet, rgb555, type Run } from "./facet-fixture.mts";
import { FLAG } from "./tiledata.mts";
import type { HouseModel } from "./house-model.mts";

const FAKE_HOME = mkdtempSync(join(tmpdir(), "pr-house-home-"));

const PACK = 0x40020001;

// settings: fields laid over settings.json before the server starts, as a player's hand edit would be.
async function serve(withTiledata: boolean, settings?: Record<string, unknown>): Promise<{ s: ServerHandle; dir: string }> {
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
  if (settings) writeFileSync(join(dir, "settings.json"), JSON.stringify({ ...JSON.parse(readFileSync(join(dir, "settings.json"), "utf8")), ...settings }));
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

test("[fast] houses: a house-only file (packrat-house-map-refresh.py) moves the house map on and leaves the inventory, the character card and its worn set exactly as they were", async () => {
  const { s, dir } = await serve(true);
  const RING = 0x40040001;
  try {
    const { house } = vaultHouse();
    const worn = houseScan({ scannedAt: new Date(Date.parse(house.capturedAt) + 30e3).toISOString(), boxes: [{ serial: PACK, kind: "backpack" as const, name: "Backpack" }], things: [] });
    writeFileSync(join(dir, "scans", "worn.json"), JSON.stringify({ ...worn, stats: { str: 90, dex: 20, int: 10 }, equipped: [{ serial: RING, name: "Gold Ring", layer: "Ring", nameSource: "opl", tooltip: ["Gold Ring"] }] }));
    const before = await get<{ snapshotCount: number; inventory: { characters: Record<string, { scannedAt: string; stats: Record<string, number> }> } }>(s, "/api/inventory");
    const later = new Date(Date.parse(house.capturedAt) + 60e3).toISOString();
    const only = { ...houseScan({ scannedAt: later, boxes: [], things: [] }), kind: "house", stats: {}, house: { facet: 1, capturedAt: later, at: { x: 3003, y: 1003 }, tiles: house.tiles, items: house.items, containers: [] } };
    writeFileSync(join(dir, "scans", "house-only.json"), JSON.stringify(only));
    const after = await get<typeof before.body>(s, "/api/inventory");
    assert.equal(after.body.snapshotCount, before.body.snapshotCount + 1, "the file is read");
    assert.deepEqual(after.body.inventory, before.body.inventory, "the inventory, the cards, the worn sets and Missing are untouched");
    assert.deepEqual(after.body.inventory.characters.Tester!.stats, { str: 90, dex: 20, int: 10 });
    const one = await get<{ house: HouseModel }>(s, "/api/houses/1-3000-1000");
    assert.equal(one.body.house.capturedAt, later);
    assert.equal(one.body.house.stacks.reduce((a, st) => a + st.serials.length, 0), 120, "the chests the full scan opened are still on the map");
  } finally { await s.close(); }
});

test("[fast] houses: a chest a capture saw but no scan opened is on the map as not opened, named from tiledata, and never in the inventory", async () => {
  const { s, dir } = await serve(true);
  const SEEN = 0x40030001, NAMED = 0x40030002;
  try {
    const { house } = vaultHouse();
    const later = new Date(Date.parse(house.capturedAt) + 60e3).toISOString();
    const scan = houseScan({ character: "Other", scannedAt: later, boxes: [], things: [] });
    // 0x0E7C is past the synthetic tiledata's end (no name, so "container"); any graphic the synthetic file names stands in for a named chest.
    writeFileSync(join(dir, "scans", "house-seen.json"), JSON.stringify({ ...scan, house: { facet: 1, capturedAt: later, at: { x: 3003, y: 1003 }, tiles: house.tiles, items: house.items,
      containers: [[SEEN, 0x0E7C, 3003, 1002, 27], [NAMED, G.planks, 3004, 1002, 27], [0x40010000, 0x0E7C, 3001, 1001, 7]] } }));
    const one = await get<{ house: HouseModel }>(s, "/api/houses/1-3000-1000");
    assert.deepEqual(one.body.house.unopened, [SEEN, NAMED], "a chest the fold knows is drawn from the fold");
    assert.deepEqual(one.body.house.unopenedNames, { [String(SEEN)]: "container", [String(NAMED)]: "wooden planks" });
    assert.equal(one.body.house.stacks.find((st) => st.serials.includes(SEEN))!.level, 1);
    const list = await get<{ houses: Array<{ containers: number }> }>(s, "/api/houses");
    assert.equal(list.body.houses[0]!.containers, 122);
    const inv = await get<{ inventory: { containers: Record<string, unknown> } }>(s, "/api/inventory");
    assert.equal(String(SEEN) in inv.body.inventory.containers, false, "a chest no scan opened is nowhere in the inventory");
  } finally { await s.close(); }
});

test("[fast] houses: a trash container an earlier capture listed in trash is no stack and not unopened when a later far capture sees it; an opened chest is drawn whatever a trash list says (issue #162)", async () => {
  const { s, dir } = await serve(true);
  const TRASH = 0x40030003, OPENED = 0x40010000;
  try {
    const { house } = vaultHouse();
    const at = (ms: number): string => new Date(Date.parse(house.capturedAt) + ms).toISOString();
    const capture = (when: string, extra: Record<string, unknown>) => ({ ...houseScan({ character: "Other", scannedAt: when, boxes: [], things: [] }), house: { facet: 1, capturedAt: when, at: { x: 3003, y: 1003 }, tiles: house.tiles, items: house.items, ...extra } });
    writeFileSync(join(dir, "scans", "house-far.json"), JSON.stringify(capture(at(120e3), { containers: [[TRASH, 0x2813, 3003, 1002, 27], [OPENED, 0x0E7C, 3001, 1001, 7]] })));
    const unopened = async (): Promise<HouseModel> => (await get<{ house: HouseModel }>(s, "/api/houses/1-3000-1000")).body.house;
    let m = await unopened();
    assert.deepEqual(m.unopened, [TRASH], "without a trash list the far capture's container still shows");
    writeFileSync(join(dir, "scans", "house-near.json"), JSON.stringify(capture(at(60e3), { containers: [], trash: [TRASH, OPENED] })));
    m = await unopened();
    assert.deepEqual([m.unopened, m.unopenedNames], [[], {}]);
    assert.equal(m.stacks.some((st) => st.serials.includes(TRASH)), false);
    assert.equal(m.stacks.some((st) => st.serials.includes(OPENED)), true, "a chest a scan opened is never dropped by a trash list");
  } finally { await s.close(); }
});

type From = { folder: string | null; source: string | null; reason: string | null };
async function put(s: ServerHandle, body: unknown): Promise<{ status: number; body: { ok: boolean; error?: string; settings?: { uoFolder?: string | null } } }> {
  const r = await fetch(s.url + "/api/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: r.status, body: (await r.json()) as { ok: boolean; error?: string; settings?: { uoFolder?: string | null } } };
}
const uoFolderWith = (bytes: Buffer): string => { const d = mkdtempSync(join(tmpdir(), "pr-house-uo-")); writeFileSync(join(d, "tiledata.mul"), bytes); return d; };

test("[fast] houses: the UO folder set in Settings wins over TazUO's launcher, and says where it came from", async () => {
  const { s } = await serve(true);
  try {
    const auto = await get<{ tiledataFrom: From }>(s, "/api/houses");
    assert.equal(auto.body.tiledataFrom.source, "tazuo-profile");
    const mine = uoFolderWith(syntheticTileData([{ graphic: G.pavers, flags: FLAG.surface, name: "marble floor" }, { graphic: G.stoneWall, flags: FLAG.wall | FLAG.impassable, height: 20, name: "stone wall" }]));
    try {
      const r = await put(s, { uoFolder: mine });
      assert.equal(r.status, 200);
      assert.equal(r.body.settings!.uoFolder, mine);
      const list = await get<{ tiledata: boolean; tiledataFrom: From }>(s, "/api/houses");
      assert.deepEqual([list.body.tiledata, list.body.tiledataFrom], [true, { folder: mine, source: "settings", reason: null }]);
      const one = await get<{ house: HouseModel }>(s, "/api/houses/1-3000-1000");
      assert.equal(one.body.house.cells.find((c) => c.x === 3002 && c.y === 1002 && c.level === 0)!.family, "marble");
      assert.equal((await put(s, { uoFolder: null })).body.settings!.uoFolder, null, "null goes back to automatic");
      assert.equal((await get<{ tiledataFrom: From }>(s, "/api/houses")).body.tiledataFrom.source, "tazuo-profile");
    } finally { rmSync(mine, { recursive: true, force: true }); }
  } finally { await s.close(); }
});

test("[fast] houses: a UO folder that lost its tiledata.mul, a file that is not a 7.x tiledata.mul, and no client each say why there is none", async () => {
  const { s } = await serve(true);
  try {
    const gone = uoFolderWith(syntheticTileData([])), junk = uoFolderWith(Buffer.alloc(100));
    try {
      assert.equal((await put(s, { uoFolder: gone })).status, 200);
      rmSync(join(gone, "tiledata.mul"));
      assert.deepEqual((await get<{ tiledata: boolean; tiledataFrom: From }>(s, "/api/houses")).body.tiledataFrom, { folder: gone, source: "settings", reason: "override-missing" });
      assert.equal((await put(s, { uoFolder: junk })).status, 200);
      const list = await get<{ tiledata: boolean; tiledataFrom: From }>(s, "/api/houses");
      assert.deepEqual([list.body.tiledata, list.body.tiledataFrom], [false, { folder: junk, source: "settings", reason: "unreadable" }]);
    } finally { for (const d of [gone, junk]) rmSync(d, { recursive: true, force: true }); }
  } finally { await s.close(); }
  const { s: bare } = await serve(false);
  try {
    assert.deepEqual((await get<{ tiledataFrom: From }>(bare, "/api/houses")).body.tiledataFrom, { folder: null, source: null, reason: "no-client" });
  } finally { await bare.close(); }
});

test("[fast] houses: PUT /api/settings refuses a relative path, a UNC path and a folder without tiledata.mul, without echoing the path", async () => {
  const { s } = await serve(true);
  try {
    const empty = mkdtempSync(join(tmpdir(), "pr-house-empty-"));
    try {
      for (const bad of ["uo/folder", "\\\\host\\share\\UO", "//host/share/UO", empty, 42, ""]) {
        const r = await put(s, { uoFolder: bad });
        assert.equal(r.status, 400, String(bad));
        if (typeof bad === "string" && bad) assert.ok(!r.body.error!.includes(bad), `the error names no path: ${r.body.error}`);
      }
    } finally { rmSync(empty, { recursive: true, force: true }); }
  } finally { await s.close(); }
});

test("[fast] houses: a hand-edited UO folder of a UNC or relative shape is reported wrong without being read, and a TazUO client with no launcher profile says so", async () => {
  for (const uoFolder of ["\\\\server\\share", "//server/share", "uo/folder"]) {
    const { s } = await serve(true, { uoFolder });
    try {
      assert.deepEqual((await get<{ tiledata: boolean; tiledataFrom: From }>(s, "/api/houses")).body.tiledataFrom, { folder: null, source: null, reason: "override-missing" }, uoFolder);
    } finally { await s.close(); }
  }
  const bare = mkdtempSync(join(tmpdir(), "pr-house-noprofile-")), scripts = join(bare, "TazUO", "LegionScripts");
  mkdirSync(scripts, { recursive: true });
  const { s } = await serve(false, { client: { adapter: "tazuo", scriptsDir: scripts } });
  try {
    assert.deepEqual((await get<{ tiledataFrom: From }>(s, "/api/houses")).body.tiledataFrom, { folder: null, source: null, reason: "no-tazuo-profile" });
  } finally { await s.close(); rmSync(bare, { recursive: true, force: true }); }
});

// The house names (issue #164): GET /api/house-map and PUT /api/house-map/<id> on <data>/house-map.json, and each house's name in GET /api/houses and /api/houses/<id>.
async function putName(s: ServerHandle, path: string, body: unknown): Promise<{ status: number; body: { ok: boolean; error?: string; entry?: unknown } }> {
  const r = await fetch(s.url + path, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: r.status, body: (await r.json()) as { ok: boolean; error?: string; entry?: unknown } };
}
test("[fast] house names: GET starts empty, a PUT is stored trimmed and shows in the houses list and the model, an empty name removes it", async () => {
  const { s, dir } = await serve(false);
  try {
    assert.deepEqual((await get(s, "/api/house-map")).body, { ok: true, houses: {} });
    const bounds = { x0: 3000, y0: 1000, x1: 3006, y1: 1006, facet: 1 };
    const saved = await putName(s, "/api/house-map/1-3000-1000", { name: "  Main house ", bounds });
    assert.equal(saved.status, 200);
    assert.deepEqual(saved.body, { ok: true, entry: { name: "Main house", bounds } });
    assert.deepEqual((await get(s, "/api/house-map")).body, { ok: true, houses: { "1-3000-1000": { name: "Main house", bounds } } });
    assert.deepEqual(JSON.parse(readFileSync(join(dir, "house-map.json"), "utf8")), { version: 1, houses: { "1-3000-1000": { name: "Main house", bounds } } });
    assert.equal((await get<{ houses: Array<{ name?: string }> }>(s, "/api/houses")).body.houses[0]!.name, "Main house");
    assert.equal((await get<{ house: { name?: string } }>(s, "/api/houses/1-3000-1000")).body.house.name, "Main house");
    assert.equal((await putName(s, "/api/house-map/3-10-20", { name: "Gone house" })).status, 200, "a name may be kept for a house not listed now");
    const cleared = await putName(s, "/api/house-map/1-3000-1000", { name: "" });
    assert.deepEqual(cleared.body, { ok: true, entry: null });
    assert.deepEqual((await get(s, "/api/house-map")).body, { ok: true, houses: { "3-10-20": { name: "Gone house" } } });
    assert.equal("name" in (await get<{ houses: Array<{ name?: string }> }>(s, "/api/houses")).body.houses[0]!, false);
  } finally { await s.close(); rmSync(dir, { recursive: true, force: true }); }
});
test("[fast] house names: a bad name, a malformed id or a body that is not JSON is refused", async () => {
  const { s, dir } = await serve(false);
  try {
    const long = await putName(s, "/api/house-map/1-3000-1000", { name: "x".repeat(61) });
    assert.equal(long.status, 400);
    assert.match(long.body.error ?? "", /1 to 60 characters/);
    assert.equal((await putName(s, "/api/house-map/1-3000-1000", { name: "a\nb" })).status, 400);
    const badId = await putName(s, "/api/house-map/plain", { name: "Main" });
    assert.equal(badId.status, 400);
    assert.match(badId.body.error ?? "", /not a house id/);
    assert.equal((await putName(s, "/api/house-map/..%2Fetc", { name: "Main" })).status, 400);
    const r = await fetch(s.url + "/api/house-map/1-3000-1000", { method: "PUT", body: "{}" });
    assert.equal(r.status, 415);
    assert.deepEqual((await get(s, "/api/house-map")).body, { ok: true, houses: {} });
  } finally { await s.close(); rmSync(dir, { recursive: true, force: true }); }
});
test("[fast] house names: a PUT that would grow the map past 500 named houses or past 1 MB is refused with a 409 and the file is left as it was, while clearing or shortening a name still saves", async () => {
  const { s, dir } = await serve(false);
  try {
    const file = join(dir, "house-map.json");
    const full = JSON.stringify({ version: 1, houses: Object.fromEntries(Array.from({ length: 500 }, (_, i) => [`1-${i}-0`, { name: `H${i}` }])) });
    writeFileSync(file, full);
    const over = await putName(s, "/api/house-map/1-3000-1000", { name: "One more" });
    assert.equal(over.status, 409);
    assert.match(over.body.error ?? "", /at most 500 houses/);
    assert.equal((await putName(s, "/api/house-map/1-7-0", { name: "Renamed" })).status, 200, "renaming a named house is still fine");
    assert.equal((await putName(s, "/api/house-map/1-8-0", { name: "" })).status, 200, "clearing a name on a full map");
    // 125 entries of about 7.9 kB each: under 1 MB on disk, and one more entry tips it over.
    const big = JSON.stringify({ version: 1, houses: Object.fromEntries(Array.from({ length: 125 }, (_, i) => [`1-${i}-0`, { name: `H${i}`, notes: "x".repeat(7900) }])) });
    writeFileSync(file, big);
    const huge = await putName(s, "/api/house-map/1-3000-1000", { name: "Main", notes: "x".repeat(7900) });
    assert.equal(huge.status, 409);
    assert.match(huge.body.error ?? "", /larger than 1 MB/);
    assert.equal(readFileSync(file, "utf8"), big);
    assert.equal((await putName(s, "/api/house-map/1-3-0", { name: "H3" })).status, 200, "shortening an entry on a full file");
    assert.equal((await putName(s, "/api/house-map/1-4-0", { name: "" })).status, 200, "clearing one");
  } finally { await s.close(); rmSync(dir, { recursive: true, force: true }); }
});

// The facet overview (issue #164): GET /api/facet-map/<facet>.png from the UO folder's facetNN.mul, a region of it and a width.
async function png(s: ServerHandle, path: string): Promise<{ status: number; type: string | null; region: string | null; buf: Buffer }> {
  const r = await fetch(s.url + path);
  return { status: r.status, type: r.headers.get("content-type"), region: r.headers.get("x-region"), buf: Buffer.from(await r.arrayBuffer()) };
}
const ihdrSize = (b: Buffer): [number, number] => [b.readUInt32BE(16), b.readUInt32BE(20)];

test("[fast] facet map: a region of the UO folder's facet file is served as a PNG no larger than asked, and one reaching past the facet is slid inside it", async () => {
  const { s } = await serve(true);
  const uo = uoFolderWith(syntheticTileData([]));
  writeFileSync(join(uo, "facet01.mul"), syntheticFacet(8, 4, Array.from({ length: 4 }, () => [[4, rgb555(31, 0, 0)], [4, rgb555(0, 0, 31)]] as Run[])));
  try {
    assert.equal((await put(s, { uoFolder: uo })).status, 200);
    const whole = await png(s, "/api/facet-map/1.png?x0=0&y0=0&x1=8&y1=4");
    assert.equal(whole.status, 200);
    assert.equal(whole.type, "image/png");
    assert.equal(whole.region, "0,0,8,4");
    assert.deepEqual([...whole.buf.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.deepEqual(ihdrSize(whole.buf), [8, 4]);
    assert.deepEqual(ihdrSize((await png(s, "/api/facet-map/1.png?x0=0&y0=0&x1=8&y1=4&w=4")).buf), [4, 2], "the aspect ratio is kept");
    assert.deepEqual(ihdrSize((await png(s, "/api/facet-map/1.png?x0=2&y0=1&x1=6&y1=3&w=1024")).buf), [4, 2], "a region is never drawn larger than it is");
    const slid = await png(s, "/api/facet-map/1.png?x0=6&y0=3&x1=10&y1=5");
    assert.deepEqual([slid.status, slid.region, ihdrSize(slid.buf)], [200, "4,2,8,4", [4, 2]], "slid back inside, same size");
    const big = await png(s, "/api/facet-map/1.png?x0=3&y0=0&x1=603&y1=450");
    assert.deepEqual([big.status, big.region], [200, "0,0,8,4"], "cut to the facet's size");
  } finally { await s.close(); rmSync(uo, { recursive: true, force: true }); }
});

test("[fast] facet map: an image is at most 2048 pixels on either side, the default 1024", async () => {
  const { s } = await serve(true);
  const uo = uoFolderWith(syntheticTileData([]));
  writeFileSync(join(uo, "facet01.mul"), syntheticFacet(3000, 3000, Array.from({ length: 3000 }, () => Array.from({ length: 12 }, (): Run => [250, rgb555(0, 10, 20)]))));
  try {
    assert.equal((await put(s, { uoFolder: uo })).status, 200);
    const R = "x0=0&y0=0&x1=3000&y1=1500";
    assert.deepEqual(ihdrSize((await png(s, `/api/facet-map/1.png?${R}&w=2048`)).buf), [2048, 1024]);
    assert.deepEqual(ihdrSize((await png(s, `/api/facet-map/1.png?${R}`)).buf), [1024, 512]);
    assert.deepEqual(ihdrSize((await png(s, "/api/facet-map/1.png?x0=0&y0=0&x1=1000&y1=3000&w=2048")).buf), [683, 2048], "a tall region is capped by its height");
  } finally { await s.close(); rmSync(uo, { recursive: true, force: true }); }
});

test("[fast] facet map: a bad facet, region or size is a 400; a missing or unreadable file, a Settings folder that is gone, or no UO folder, a 404 with a reason and never the path", async () => {
  const { s } = await serve(true);
  const uo = uoFolderWith(syntheticTileData([]));
  writeFileSync(join(uo, "facet01.mul"), syntheticFacet(8, 4, Array.from({ length: 4 }, () => [[8, 0]] as Run[])));
  writeFileSync(join(uo, "facet02.mul"), Buffer.from([8, 0, 4, 0, 1]));
  const R = "x0=0&y0=0&x1=4&y1=4";
  try {
    assert.equal((await put(s, { uoFolder: uo })).status, 200);
    for (const path of [`/api/facet-map/6.png?${R}`, `/api/facet-map/-1.png?${R}`, `/api/facet-map/01.png?${R}`, `/api/facet-map/1.5.png?${R}`, `/api/facet-map/x.png?${R}`, `/api/facet-map/1?${R}`,
      "/api/facet-map/1.png", `/api/facet-map/1.png?${R}&w=0`, `/api/facet-map/1.png?${R}&w=2049`, `/api/facet-map/1.png?${R}&w=abc`, "/api/facet-map/1.png?x0=0&y0=0&x1=4",
      "/api/facet-map/1.png?x0=4&y0=0&x1=4&y1=4", "/api/facet-map/1.png?x0=-1&y0=0&x1=4&y1=4", "/api/facet-map/1.png?x0=0.5&y0=0&x1=4&y1=4"]) {
      const r = await get<{ ok: boolean }>(s, path);
      assert.equal(r.status, 400, path);
      assert.equal(r.body.ok, false, path);
    }
    for (const [path, reason] of [[`/api/facet-map/3.png?${R}`, "missing"], [`/api/facet-map/2.png?${R}`, "unreadable"]] as const) {
      const r = await fetch(s.url + path), text = await r.text();
      assert.equal(r.status, 404, path);
      assert.deepEqual(JSON.parse(text), { ok: false, reason }, path);
      assert.ok(!text.includes(uo), "the folder is never echoed");
    }
    rmSync(uo, { recursive: true, force: true });
    assert.deepEqual(await get(s, `/api/facet-map/1.png?${R}`), { status: 404, body: { ok: false, reason: "override-missing" } }, "the folder set in Settings is gone");
  } finally { await s.close(); rmSync(uo, { recursive: true, force: true }); }
  const { s: bare } = await serve(false);
  try {
    assert.deepEqual(await get(bare, `/api/facet-map/1.png?${R}`), { status: 404, body: { ok: false, reason: "no-client" } });
  } finally { await bare.close(); }
});

test("[fast] houses: each listed house carries its plot, the footprint without the front steps", async () => {
  const { s } = await serve(true);
  try {
    const list = await get<{ houses: Array<{ width: number; height: number; plot: { x0: number; y0: number; x1: number; y1: number } }> }>(s, "/api/houses");
    const h = list.body.houses[0]!;
    assert.deepEqual([h.plot.x1 - h.plot.x0 + 1, h.plot.y1 - h.plot.y0 + 1], [h.width, h.height]);
    assert.equal(h.plot.x0, 3000);
    assert.equal(h.plot.y0, 1000);
  } finally { await s.close(); }
});
