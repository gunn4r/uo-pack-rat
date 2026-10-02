// ui-map.test.mts — [slow]: the House map (issue #10) in the real Electron window over a seeded data folder (the dense vault and the courtyard house of app/house-fixture.mts, their chests from app/organize-fixture.mts, a synthetic tiledata.mul behind a fake TazUO launcher): the nav entry, the picker and level pills, a stale deep link, the no-tiledata note, the drawing in both views, callouts, selection, cut-away, keyboard, pan and zoom, the detail panel's actions, the colour modes, a chest no scan opened, the plain grid over the demo scans, the empty state, the Settings UO folder card, the 1000 × 700 layout and contrast in both theme families. Skipped when electron or playwright is absent, or under TEST_SKIP_ELECTRON.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { fitWindow, type RealSize, testEnv, noUpdateCheck } from "./electron-window.mts";
import { houseScan } from "../app/organize-fixture.mts";
import { vaultHouse, courtyardHouse, fixtureTileData, FIXTURE_TILES } from "../app/house-fixture.mts";
import { syntheticTileData } from "../app/tiledata-fixture.mts";
import { buildHouseModel, type HouseModel } from "../app/house-model.mts";
import type { ElectronApplication, Page } from "playwright";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const require_ = createRequire(import.meta.url);
function unavailable(): string | null {
  if (process.env.TEST_SKIP_ELECTRON) return "TEST_SKIP_ELECTRON is set";
  for (const dep of ["electron", "playwright"]) {
    try { require_.resolve(dep); } catch { return `${dep} is not installed`; }
  }
  return null;
}
const VAULT = "1-3000-1000", COURT = "1-1000-2000";
const LABELLED = 0x40010000, YARD_CHEST = 0x40030001, SEEN_ONLY = 0x40030002;
// The models the server builds from the seeded scans, worked out here too so a test can name a stack by its tile.
const td = fixtureTileData();
const vaultModel = (() => { const { house, chests } = vaultHouse(); return buildHouseModel(house, td, chests); })();
const courtModel = buildHouseModel(courtyardHouse(), td, [{ serial: YARD_CHEST, name: "Wooden Chest", facet: 1, x: 1012, y: 2013, z: 7 }, { serial: SEEN_ONLY, name: "container", facet: 1, x: 1012, y: 2012, z: 7, opened: false }]);
const letter = (m: HouseModel, x: number, y: number): string => m.stacks.find((s) => s.x === x && s.y === y)!.letter;

// A data folder with both houses captured: the vault's 120 chests (chest i holds (13·i) % 126 of 125 items, the first one labelled Reagents in teal), the courtyard with a chest in the yard and one the capture saw but no scan opened; the synthetic tiledata.mul behind a fake TazUO launcher, which settings.json points at unless `client` is false.
function seed({ client = true }: { client?: boolean } = {}): { dir: string; uo: string } {
  const dir = mkdtempSync(join(tmpdir(), "packrat-map-"));
  mkdirSync(join(dir, "scans"), { recursive: true });
  const { house: vault, chests } = vaultHouse();
  const v = houseScan({ scannedAt: vault.capturedAt, boxes: chests.map((c, i) => ({ serial: c.serial, name: c.name, pos: { x: c.x, y: c.y, z: c.z, facet: 1 }, count: (i * 13) % 126 })), things: [] });
  writeFileSync(join(dir, "scans", "vault.json"), JSON.stringify({ ...v, house: { facet: 1, capturedAt: vault.capturedAt, at: { x: 3003, y: 1003 }, tiles: vault.tiles, items: vault.items } }));
  const court = courtyardHouse();
  const c = houseScan({ character: "Other", scannedAt: court.capturedAt, boxes: [{ serial: YARD_CHEST, name: "Wooden Chest", pos: { x: 1012, y: 2013, z: 7, facet: 1 } }], things: [] });
  writeFileSync(join(dir, "scans", "courtyard.json"), JSON.stringify({ ...c, house: { facet: 1, capturedAt: court.capturedAt, at: { x: 1005, y: 2005 }, tiles: court.tiles, items: court.items, containers: [[SEEN_ONLY, 0x0E7C, 1012, 2012, 7]] } }));
  const root = join(dir, "client"), scripts = join(root, "TazUO", "LegionScripts"), uo = join(root, "UO");
  for (const d of [scripts, join(root, "Profiles", "Settings"), uo]) mkdirSync(d, { recursive: true });
  writeFileSync(join(uo, "tiledata.mul"), syntheticTileData(FIXTURE_TILES));
  writeFileSync(join(root, "Profiles", "Settings", "p.json"), JSON.stringify({ ultimaonlinedirectory: uo }));
  writeFileSync(join(dir, "settings.json"), JSON.stringify({ schemaVersion: 1, shard: "uoalive", setupDone: true, ...(client ? { client: { adapter: "tazuo", scriptsDir: scripts } } : {}) }));
  writeFileSync(join(dir, "organize.json"), JSON.stringify({ version: 1, catchAll: null, pinnedItems: [], rules: [], labels: { [LABELLED]: { serial: LABELLED, name: "Reagents", color: "#2f7f7f", origin: "manual" } } }));
  return { dir, uo };
}
async function launch(dataDir: string, { want = { width: 1440, height: 900 }, demo = false }: { want?: RealSize; demo?: boolean } = {}): Promise<{ app: ElectronApplication; page: Page; errors: string[]; size: RealSize }> {
  const { _electron } = await import("playwright");
  const app = await _electron.launch({ args: [ROOT, ...(demo ? ["--demo"] : []), "--data", noUpdateCheck(dataDir)], cwd: ROOT, timeout: 60_000, env: testEnv() });
  // A launch that fails here happens before the caller's try: close it, or the Electron process outlives the test file.
  try {
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    const size = await fitWindow(app, page, want);
    return { app, page, errors, size };
  } catch (e) {
    await app.close();
    throw e;
  }
}
async function done(app: ElectronApplication, dir: string): Promise<void> {
  await app.close();
  rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
async function go(page: Page, hash: string, ready: string): Promise<void> {
  await page.evaluate((h) => { location.hash = h; }, hash);
  await page.waitForSelector(ready, { timeout: 30_000 });
}
// Poll a file-backed fact until it holds.
async function until<T>(read: () => T, ok: (v: T) => boolean, what: string): Promise<T> {
  const end = Date.now() + 10_000;
  let v = read();
  while (!ok(v)) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}: ${JSON.stringify(v)}`);
    await new Promise((r) => setTimeout(r, 100));
    v = read();
  }
  return v;
}

test("[slow] House map: the nav entry opens it, the picker lists both houses with the biggest chosen, a pill per level, a stale deep link falls back, and without a client the no-tiledata note shows", async (t) => {
  const why = unavailable();
  if (why) return t.skip(why);
  const { dir } = seed({ client: false });
  const { app, page, errors } = await launch(dir);
  try {
    await page.locator('#sidebar [data-nav="map"]').click();
    await page.waitForSelector("#tab-map:not([hidden]) #map-tiledata-note", { timeout: 30_000 });
    assert.equal(await page.evaluate(() => location.hash), "#/map");
    const nav = await page.locator("#sidebar [data-nav]").evaluateAll((as) => as.map((a) => (a as HTMLElement).dataset.nav));
    assert.deepEqual(nav.slice(0, 3), ["inventory", "map", "characters"]);
    assert.deepEqual(await page.locator("#map-house option").evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value)), [COURT, VAULT]);
    assert.equal(await page.locator("#map-house").inputValue(), VAULT, "the house with the most chests");
    assert.deepEqual(await page.locator("#map-levels .pill").allTextContents(), ["Ground floor", "2nd floor"]);
    assert.equal(await page.locator('#map-levels .pill[aria-pressed="true"]').textContent(), "Ground floor");
    assert.match(await page.locator("#map-tiledata-note").textContent() || "", /No game client is set up.*plain colours/);
    assert.equal(await page.locator('#map-tiledata-note a[href="#/settings"]').count(), 1);
    await go(page, "#/map/1-9-9", "#map-house");
    await page.waitForFunction(() => location.hash === "#/map", undefined, { timeout: 15_000 });
    assert.equal(await page.locator("#map-house").inputValue(), VAULT);
    assert.deepEqual(errors, []);
  } finally { await done(app, dir); }
});
