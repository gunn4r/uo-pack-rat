// ui-map.test.mts — [slow]: the House map (issue #10) in the real Electron window over a seeded data folder (the dense vault and the courtyard house of app/house-fixture.mts, their chests from app/organize-fixture.mts, a synthetic tiledata.mul behind a fake TazUO launcher): the nav entry, the picker and level pills, a stale deep link, the no-tiledata note, the drawing in both views, callouts, selection, cut-away, keyboard (and a walk of the screen by keyboard alone that keeps focus through every redraw), pan and zoom, the detail panel's actions, the colour modes, a chest no scan opened, the plain grid over the demo scans, the empty state, the Settings UO folder card, where the house is (coordinates, the facet overview and its markers, and the world map lightbox, issue #164), the player's areas (issue #10: drawn by a mouse drag and by the keyboard alone, named, renamed and deleted, the counts and the tint, carried over to a redesigned house), the 1000 × 700 layout and contrast in both theme families. Skipped when electron or playwright is absent, or under TEST_SKIP_ELECTRON.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { fitWindow, type RealSize, testEnv, noUpdateCheck } from "./electron-window.mts";
import { probeContrast, failures, describeFailures, type ContrastRow } from "./contrast-probe.mts";
import { houseScan } from "../app/organize-fixture.mts";
import { vaultHouse, courtyardHouse, castleHouse, fixtureTileData, FIXTURE_TILES } from "../app/house-fixture.mts";
import { syntheticTileData } from "../app/tiledata-fixture.mts";
import { syntheticFacet, rgb555, type Run } from "../app/facet-fixture.mts";
import { buildHouseModel, type HouseModel } from "../app/house-model.mts";
import { anchorOf } from "../app/ui/house-map-model.mts";
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
const VAULT = "1-3000-1000", COURT = "1-1000-2000", CASTLE = castleHouse().house.id;
const LABELLED = 0x40010000, YARD_CHEST = 0x40030001, SEEN_ONLY = 0x40030002;
// The models the server builds from the seeded scans, worked out here too so a test can name a stack by its tile.
const td = fixtureTileData();
const vaultModel = (() => { const { house, chests } = vaultHouse(); return buildHouseModel(house, td, chests); })();
const courtModel = buildHouseModel(courtyardHouse(), td, [{ serial: YARD_CHEST, name: "Wooden Chest", facet: 1, x: 1012, y: 2013, z: 7 }, { serial: SEEN_ONLY, name: "container", facet: 1, x: 1012, y: 2012, z: 7, opened: false }]);
const letter = (m: HouseModel, x: number, y: number): string => m.stacks.find((s) => s.x === x && s.y === y)!.letter;
const VAULT_BOUNDS = { x0: vaultModel.x0, y0: vaultModel.y0, x1: vaultModel.x1, y1: vaultModel.y1, facet: 1 };

// A neighbour of the vault: the courtyard house moved 2100 tiles east and 900 north, so it stands inside the vault's facet overview.
const NEIGHBOUR = "1-3100-1100";
function neighbourCapture(): Record<string, unknown> {
  const court = courtyardHouse(), dx = 2100, dy = -900;
  const c = houseScan({ character: "Neighbour", scannedAt: court.capturedAt, boxes: [], things: [] });
  return { ...c, house: { facet: 1, capturedAt: court.capturedAt, at: { x: 1005 + dx, y: 2005 + dy }, tiles: court.tiles.map(([g, x, y, z, f]) => [g, x + dx, y + dy, z, f]), items: court.items.map(([s, g, x, y, z]) => [s, g, x + dx, y + dy, z]) } };
}
// The contents drawer's chests: the top chest of the stack at 3001, 1001 holds a bag of weapons with a bag of gems inside it, and arrows loose; the chest under it a bandage loose, a bag Spare with three pearls and a bag Supplies with 40, enough to scroll. `more` adds things (a later scan).
const FILLED = vaultModel.stacks.find((s) => s.x === 3001 && s.y === 1001)!.serials;
const TOP = FILLED.at(-1)!, UNDER = FILLED.at(-2)!, BAG = 0x40500001, GEMS = 0x40500002, SPARE = 0x40500003, SUPPLIES = 0x40500004;
type Thing = { serial: number; name: string; in: number; lines?: string[] };
function drawerItems(more: Thing[] = []): { boxes: Array<{ serial: number; name: string; parent: number }>; things: Thing[] } {
  const pearls = (bag: number, n: number, first: number, tag: string): Thing[] => Array.from({ length: n }, (_, i) => ({ serial: first + i, name: `Pearl ${tag}${String(i + 1).padStart(2, "0")}`, in: bag }));
  return {
    boxes: [{ serial: BAG, name: "Weapons", parent: TOP }, { serial: GEMS, name: "Gems", parent: BAG }, { serial: SPARE, name: "Spare", parent: UNDER }, { serial: SUPPLIES, name: "Supplies", parent: UNDER }],
    things: [{ serial: 0x40500010, name: "Katana", in: BAG, lines: ["Hit Chance Increase 15%", "Physical Resist 5%"] }, { serial: 0x40500011, name: "Bow", in: BAG },
      { serial: 0x40500012, name: "Ruby", in: GEMS }, { serial: 0x40500013, name: "Arrows", in: TOP }, { serial: 0x40500014, name: "Bandage", in: UNDER },
      ...pearls(SPARE, 3, 0x40500100, "S"), ...pearls(SUPPLIES, 40, 0x40500200, ""), ...more],
  };
}
// The vault's scan (with `items`, the drawer's chests filled, plus `more`).
function writeVault(dir: string, items: boolean, more: Thing[] = []): void {
  const { house: vault, chests } = vaultHouse();
  const filled = items ? drawerItems(more) : { boxes: [], things: [] };
  const v = houseScan({ scannedAt: vault.capturedAt, boxes: [...chests.map((c, i) => ({ serial: c.serial, name: c.name, pos: { x: c.x, y: c.y, z: c.z, facet: 1 }, count: (i * 13) % 126 })), ...filled.boxes], things: filled.things });
  writeFileSync(join(dir, "scans", "vault.json"), JSON.stringify({ ...v, house: { facet: 1, capturedAt: vault.capturedAt, at: { x: 3003, y: 1003 }, tiles: vault.tiles, items: vault.items } }));
}
// A data folder with both houses captured: the vault's 120 chests (chest i holds (13·i) % 126 of 125 items, the first one labelled Reagents in teal), the courtyard with a chest in the yard and one the capture saw but no scan opened; with `castle`, also the 4-level castle and its 300 chests (another character's scan, the speed check); the synthetic tiledata.mul behind a fake TazUO launcher, which settings.json points at unless `client` is false.
// With `items`, the top two chests of the stack at 3001, 1001 hold things (drawerItems).
// With `areas`, the vault has one area of its own, "North row" (the five stacks at y 1001).
function seed({ client = true, castle = false, facet = false, items = false, areas = false }: { client?: boolean; castle?: boolean; facet?: boolean; items?: boolean; areas?: boolean } = {}): { dir: string; uo: string } {
  const dir = mkdtempSync(join(tmpdir(), "packrat-map-"));
  mkdirSync(join(dir, "scans"), { recursive: true });
  writeVault(dir, items);
  const court = courtyardHouse();
  const c = houseScan({ character: "Other", scannedAt: court.capturedAt, boxes: [{ serial: YARD_CHEST, name: "Wooden Chest", pos: { x: 1012, y: 2013, z: 7, facet: 1 } }], things: [] });
  writeFileSync(join(dir, "scans", "courtyard.json"), JSON.stringify({ ...c, house: { facet: 1, capturedAt: court.capturedAt, at: { x: 1005, y: 2005 }, tiles: court.tiles, items: court.items, containers: [[SEEN_ONLY, 0x0E7C, 1012, 2012, 7]] } }));
  if (castle) {
    const { house: k, chests: kc } = castleHouse();
    const s = houseScan({ character: "Keeper", scannedAt: k.capturedAt, boxes: kc.map((b) => ({ serial: b.serial, name: b.name, pos: { x: b.x, y: b.y, z: b.z, facet: 1 } })), things: [] });
    writeFileSync(join(dir, "scans", "castle.json"), JSON.stringify({ ...s, house: { facet: 1, capturedAt: k.capturedAt, at: { x: 5002, y: 5002 }, tiles: k.tiles, items: k.items } }));
  }
  const root = join(dir, "client"), scripts = join(root, "TazUO", "LegionScripts"), uo = join(root, "UO");
  for (const d of [scripts, join(root, "Profiles", "Settings"), uo]) mkdirSync(d, { recursive: true });
  writeFileSync(join(uo, "tiledata.mul"), syntheticTileData(FIXTURE_TILES));
  // With `facet`, a Trammel overview (7168 x 4096 tiles in green and blue stripes) and the vault's neighbour.
  if (facet) {
    writeFileSync(join(uo, "facet01.mul"), syntheticFacet(7168, 4096, Array.from({ length: 4096 }, () => Array.from({ length: 32 }, (_, i): Run => [224, i % 2 ? rgb555(4, 12, 20) : rgb555(8, 16, 4)]))));
    writeFileSync(join(dir, "scans", "neighbour.json"), JSON.stringify(neighbourCapture()));
  }
  writeFileSync(join(root, "Profiles", "Settings", "p.json"), JSON.stringify({ ultimaonlinedirectory: uo }));
  writeFileSync(join(dir, "settings.json"), JSON.stringify({ schemaVersion: 1, shard: "uoalive", setupDone: true, ...(client ? { client: { adapter: "tazuo", scriptsDir: scripts } } : {}) }));
  writeFileSync(join(dir, "organize.json"), JSON.stringify({ version: 1, catchAll: null, pinnedItems: [], rules: [], labels: { [LABELLED]: { serial: LABELLED, name: "Reagents", color: "#2f7f7f", origin: "manual" } } }));
  if (areas) writeFileSync(join(dir, "house-map.json"), JSON.stringify({ version: 1, houses: { [VAULT]: { name: "", bounds: VAULT_BOUNDS, areas: [{ id: "a1", name: "North row", level: 0, color: "area-3", rects: [{ x0: 3001, y0: 1001, x1: 3005, y1: 1001 }] }] } } }));
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
    assert.ok(await page.locator("#map-svg .map-floor").count() > 0, "the house is still drawn");
    assert.equal(await page.locator("#map-svg .map-floor:not(.f-neutral)").count(), 0, "every floor neutral without tiledata");
    await go(page, "#/map/1-9-9", "#map-house");
    await page.waitForFunction(() => location.hash === "#/map", undefined, { timeout: 15_000 });
    assert.equal(await page.locator("#map-house").inputValue(), VAULT);
    assert.deepEqual(errors, []);
  } finally { await done(app, dir); }
});

test("[slow] House map: draws every vault chest and the courtyard's walls in both views, names each chest for screen readers, redraws a vault level and a castle level in under 100 ms, and keeps bare text out of flex and grid boxes", async (t) => {
  const why = unavailable();
  if (why) return t.skip(why);
  const { dir } = seed({ castle: true });
  const { app, page, errors } = await launch(dir);
  // Click a level pill and time the synchronous redraw it triggers (sceneOf and the whole SVG build).
  const timeLevel = (from: string, to: string): Promise<number> => page.evaluate(([a, b]) => {
    const pill = (name: string) => [...document.querySelectorAll<HTMLButtonElement>("#map-levels .pill")].find((x) => x.textContent === name)!;
    pill(a!).click();
    const t0 = performance.now(); pill(b!).click(); return performance.now() - t0;
  }, [from, to]);
  try {
    await go(page, `#/map/${VAULT}`, "#map-svg .map-stack");
    for (const view of ["Top-down", "Game angle"]) {
      await page.getByRole("radio", { name: view }).click();
      await page.waitForSelector("#map-svg .map-stack");
      assert.equal(await page.locator('#map-svg [data-chest][role="img"]').count(), 120, view);
      assert.equal(await page.locator("#map-svg .map-stack").count(), 24, view);
      assert.equal(await page.locator("#map-svg .map-wall").count(), 24, view);
    }
    assert.equal(await page.locator(`#map-svg [data-chest="${LABELLED}"]`).getAttribute("aria-label"), `${vaultModel.codes[String(LABELLED)]} Reagents, 0 of 125 items`);
    const inner = vaultModel.stacks.find((s) => s.x === 3002 && s.y === 1002)!;
    const said = await page.locator(`#map-svg .map-stack[data-stack="${inner.letter}"]`).getAttribute("aria-label") || "";
    assert.match(said, new RegExp(`^Stack ${inner.letter}, 5 chests: `), said);
    for (const serial of inner.serials) assert.ok(said.includes(`${vaultModel.codes[String(serial)]} Metal Chest, `), `the stack's name holds ${vaultModel.codes[String(serial)]}: ${said}`);
    const ms = await timeLevel("2nd floor", "Ground floor");
    assert.ok(ms < 100, `drew the vault's ground floor in ${ms.toFixed(0)} ms`);
    assert.equal(await page.locator("#map-svg [data-chest]").count(), 120);
    await page.selectOption("#map-house", CASTLE);
    await page.waitForFunction(() => document.querySelectorAll("#map-svg [data-chest]").length === 180, undefined, { timeout: 15_000 });
    const castleMs = await timeLevel("2nd floor", "Ground floor");
    assert.ok(castleMs < 100, `drew the castle's ground floor in ${castleMs.toFixed(0)} ms`);
    assert.equal(await page.locator("#map-svg [data-chest]").count(), 180);
    await page.selectOption("#map-house", COURT);
    await page.waitForFunction(() => document.querySelectorAll("#map-svg .map-lip").length > 0, undefined, { timeout: 15_000 });
    for (const view of ["Top-down", "Game angle"]) {
      await page.getByRole("radio", { name: view }).click();
      await page.waitForSelector("#map-svg .map-lip");
      assert.ok(await page.locator("#map-svg .map-wall").count() > 0, view);
      assert.ok(await page.locator("#map-svg .map-floor.f-grass").count() > 0, `${view}: families come from the client's tiledata`);
      assert.equal(await page.locator("#map-svg [data-chest]").count(), 2, view);
    }
    const split = await page.evaluate(() => {
      const bad: string[] = [];
      for (const e of document.querySelectorAll("#tab-map *")) {
        if (!/flex|grid/.test(getComputedStyle(e).display)) continue;
        if ([...e.childNodes].some((n) => n.nodeType === 3 && (n.textContent || "").trim())) bad.push(`<${e.tagName.toLowerCase()} class="${e.getAttribute("class")}">`);
      }
      return bad;
    });
    assert.deepEqual(split, [], "flex/grid containers holding bare text");
    assert.deepEqual(errors, []);
  } finally { await done(app, dir); }
});
test("[slow] House map: hover shows a stack's callout, a click selects it and fills the panel, Esc clears, pan and zoom only move the viewBox, and an inner stack of the dense vault is reached through the cut-away and the keyboard", async (t) => {
  const why = unavailable();
  if (why) return t.skip(why);
  const { dir } = seed();
  const { app, page, errors } = await launch(dir);
  try {
    await go(page, "#/map", "#map-svg .map-stack");
    await page.waitForTimeout(500);   // let the first layout settle before hovering
    const front = letter(vaultModel, 3005, 1005), inner = letter(vaultModel, 3002, 1002);
    const stack = (l: string) => page.locator(`#map-svg [data-stack="${l}"]`);
    await stack(front).hover();
    await page.waitForSelector("#map-callout:not([hidden])");
    assert.equal(await page.locator("#map-callout .map-callout-row").count(), 5);
    await stack(front).click();
    assert.equal(await stack(front).getAttribute("aria-pressed"), "true");
    assert.equal(await page.locator("#map-panel h2").textContent(), `Stack ${front}`);
    assert.equal(await page.locator("#map-panel .map-chest-row").count(), 5);
    assert.match(await page.locator("#map-crumbs").textContent() || "", new RegExp(`Stack ${front}$`));
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.querySelector('#map-svg .map-stack[aria-pressed="true"]'));
    assert.match(await page.locator("#map-panel").textContent() || "", /Item slots used/);

    // pan and zoom move the viewBox; the drawing stays the same nodes
    const vb = (): Promise<string | null> => page.locator("#map-svg").getAttribute("viewBox");
    const fitted = await vb();
    await page.evaluate(() => { (document.querySelector("#map-svg > g") as SVGGElement).dataset.mark = "kept"; });
    await page.locator("#map-zoom-in").click();
    const zoomed = await vb();
    assert.notEqual(zoomed, fitted);
    const r = (await page.locator("#map-svg").boundingBox())!;
    await page.mouse.move(r.x + 12, r.y + 12);
    await page.mouse.down();
    await page.mouse.move(r.x + 92, r.y + 52, { steps: 5 });
    await page.mouse.up();
    const panned = await vb();
    assert.notEqual(panned, zoomed);
    await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2);
    await page.mouse.wheel(0, -300);
    await page.waitForFunction((was) => document.querySelector("#map-svg")!.getAttribute("viewBox") !== was, panned);
    assert.equal(await page.locator('#map-svg > g[data-mark="kept"]').count(), 1, "pan and zoom never redraw the map");
    await page.locator("#map-fit").click();
    assert.equal(await vb(), fitted);
    // a press whose release happened off the map does not leave a drag behind: a move with no button held pans nothing
    // (setPointerCapture is stubbed for this one move: a synthetic pointer has no capture to take, and a throw there would stop a stale drag before it panned, so the check would pass on code that keeps the drag)
    const left = await page.evaluate(() => {
      const svg = document.querySelector<SVGSVGElement>("#map-svg")!, r = svg.getBoundingClientRect(), at = { clientX: r.left + 20, clientY: r.top + 20, pointerId: 1, bubbles: true };
      svg.setPointerCapture = () => {};
      try {
        svg.dispatchEvent(new PointerEvent("pointerdown", { ...at, button: 0, buttons: 1 }));
        svg.dispatchEvent(new PointerEvent("pointermove", { ...at, clientX: at.clientX + 200, clientY: at.clientY + 120, buttons: 0 }));
      } finally { delete (svg as { setPointerCapture?: unknown }).setPointerCapture; }
      return svg.classList.contains("dragging");
    });
    assert.equal(await vb(), fitted, "a move with no button held after a lost release does not pan");
    assert.equal(left, false, "and leaves no drag behind");

    // the stacks in front of an inner one fade and let the pointer through; the keyboard reaches it too
    await stack(inner).focus();
    const cut = await page.locator("#map-svg .map-stack.cut").evaluateAll((gs) => gs.map((g) => (g as SVGElement).dataset.stack!));
    const want = vaultModel.stacks.filter((s) => s.x + s.y > 3002 + 1002 && Math.abs(s.x - 3002) <= 3 && Math.abs(s.y - 1002) <= 3).map((s) => s.letter);
    assert.deepEqual(cut.sort(), want.sort());
    await page.keyboard.press("Enter");
    assert.equal(await page.locator("#map-panel h2").textContent(), `Stack ${inner}`);
    await page.keyboard.press("Escape");
    await stack(inner).click();
    assert.equal(await stack(inner).getAttribute("aria-pressed"), "true", "a click reaches the inner stack");
    await page.keyboard.press("ArrowDown");
    const moved = await page.evaluate(() => (document.activeElement as SVGElement | null)?.dataset?.stack ?? null);
    assert.ok(moved && moved !== inner, "an arrow key moves to the next stack that way");
    assert.deepEqual(errors, []);
  } finally { await done(app, dir); }
});

const focused = (page: Page, sel: string): Promise<boolean> => page.evaluate((s) => !!document.activeElement?.matches(s), sel);
// Press Tab (or Shift+Tab) until the focus is on `sel`.
async function tabTo(page: Page, sel: string, key = "Tab"): Promise<void> {
  for (let i = 0; i < 80; i++) {
    await page.keyboard.press(key);
    if (await focused(page, sel)) return;
  }
  throw new Error(`${key} never reached ${sel}`);
}
test("[slow] House map: the keyboard alone walks the screen, and focus stays put through a level, an area, a selection, a reload and Esc from the panel", async (t) => {
  const why = unavailable();
  if (why) return t.skip(why);
  const { dir } = seed({ areas: true });
  const { app, page, errors } = await launch(dir);
  try {
    await go(page, "#/map", "#map-svg .map-stack");
    const pill = (i: number) => `#map-levels [data-level="${i}"]`;
    await tabTo(page, pill(1));
    await page.keyboard.press("Enter");
    assert.equal(await page.locator(pill(1)).getAttribute("aria-pressed"), "true");
    assert.ok(await focused(page, pill(1)), "focus stays on the 2nd floor pill");
    await tabTo(page, pill(0), "Shift+Tab");
    await page.keyboard.press("Enter");
    assert.ok(await focused(page, pill(0)), "focus stays on the Ground floor pill");
    await page.keyboard.press("Enter");
    assert.equal(await page.locator(pill(0)).getAttribute("aria-pressed"), "true", "the level shown stays pressed");
    assert.ok(await focused(page, pill(0)));

    const area = '.map-area[data-area="a1"]';
    await tabTo(page, area);
    await page.keyboard.press("Enter");
    assert.equal(await page.locator(area).getAttribute("aria-pressed"), "true");
    assert.ok(await focused(page, area), "focus stays on the area");
    assert.equal(await page.locator("#map-svg .map-area-shape.sel").count(), 1, "the area is highlighted on the map");

    await tabTo(page, "#map-svg [data-stack]");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Enter");
    const got = await page.evaluate(() => { const a = document.activeElement as SVGElement; return { letter: a.dataset.stack ?? "", pressed: a.getAttribute("aria-pressed"), vb: document.querySelector("#map-svg")!.getAttribute("viewBox") || "" }; });
    assert.equal(got.pressed, "true", "Enter selected the focused stack");
    const [x, y] = anchorOf(vaultModel, vaultModel.stacks.find((s) => s.letter === got.letter)!, "angle"), [vx, vy, vw, vh] = got.vb.split(" ").map(Number);
    assert.ok(x >= vx! && x <= vx! + vw! && y >= vy! && y <= vy! + vh!, `stack ${got.letter} at ${x},${y} is inside the viewBox ${got.vb}`);
    const stack = `#map-svg [data-stack="${got.letter}"]`;

    // a reload rebuilds the map and keeps the focus on the stack
    await page.evaluate(() => { (document.querySelector("#map-svg > g") as SVGGElement).dataset.mark = "old"; });
    await page.evaluate(async () => { await (await import("/ui/app.mjs" as string)).reload(); });
    await page.waitForFunction(() => !document.querySelector('#map-svg > g[data-mark="old"]') && !!document.querySelector('#map-svg [aria-pressed="true"]'), undefined, { timeout: 15_000 });
    assert.ok(await focused(page, stack), "focus is on the stack after a reload");

    await tabTo(page, "#map-highlight-stack, .tipwrap:has(#map-highlight-stack)");
    await page.keyboard.press("Escape");
    assert.equal(await page.locator('#map-svg [aria-pressed="true"]').count(), 0, "Esc cleared the selection");
    assert.ok(await focused(page, stack), "and focus went back to the stack");
    assert.deepEqual(errors, []);
  } finally { await done(app, dir); }
});

// The bridge, as far as the page can tell: a status file refreshed every second until stop(). The page's commands land in bridgeDir's queue.jsonl.
function bridgeOnline(dir: string): { bridgeDir: string; stop: () => void } {
  const bridgeDir = join(dir, "bridge", "tazuo");
  mkdirSync(bridgeDir, { recursive: true });
  const write = (): void => writeFileSync(join(bridgeDir, "status.json"), JSON.stringify({ alive: new Date().toISOString(), character: "Tester", current: null, counts: { done: 0, failed: 0 }, results: {} }));
  write();
  const timer = setInterval(write, 1000);
  return { bridgeDir, stop: () => clearInterval(timer) };
}
const readQueue = (d: string): Array<{ action: string; serial: number; name: string; chain: number[]; pos: Record<string, number> | null }> => {
  try { return readFileSync(join(d, "queue.jsonl"), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; }
};

test("[slow] House map: the panel lists a vault stack top first with its label, Highlight queues for the bridge, Free space changes the legend, Label… opens, a label colour keeps its edge, a reload keeps the selection, and a chest no scan opened highlights by its place and cannot be labelled", async (t) => {
  const why = unavailable();
  if (why) return t.skip(why);
  const { dir } = seed();
  const { bridgeDir, stop } = bridgeOnline(dir);
  const { app, page, errors } = await launch(dir);
  try {
    await go(page, "#/map", "#map-svg .map-stack");
    await page.waitForFunction(() => document.querySelector("#bridge")?.getAttribute("data-state") === "ready", undefined, { timeout: 15_000 });
    // a label colour fills the chest, and the chest keeps its border-strong edge
    const paint = await page.locator(`#map-svg [data-chest="${LABELLED}"] polygon.top`).evaluate((p) => {
      const probe = document.createElement("div");
      probe.style.color = "var(--color-border-strong)";
      document.body.append(probe);
      const edge = getComputedStyle(probe).color;
      probe.remove();
      const s = getComputedStyle(p);
      return { fill: s.fill, stroke: s.stroke, edge };
    });
    assert.equal(paint.fill, "rgb(47, 127, 127)");
    assert.equal(paint.stroke, paint.edge);

    const back = letter(vaultModel, 3001, 1001), serials = vaultModel.stacks.find((s) => s.letter === back)!.serials;
    await page.locator(`#map-svg [data-stack="${back}"]`).focus();
    await page.keyboard.press("Enter");
    const rows = page.locator("#map-panel .map-chest-row");
    assert.deepEqual(await rows.evaluateAll((r) => r.map((x) => Number((x as HTMLElement).dataset.chest))), [...serials].reverse());
    const mine = page.locator(`#map-panel li[data-chest="${LABELLED}"]`);
    assert.match(await mine.textContent() || "", /Reagents.*In game: Metal Chest/);
    await mine.locator('[data-act="highlight"]').click();
    const [one] = await until(() => readQueue(bridgeDir), (l) => l.length === 1, "the highlight queued");
    assert.deepEqual([one!.action, one!.serial, one!.name, one!.chain, one!.pos], ["highlight", LABELLED, "Reagents", [], { x: 3001, y: 1001, z: 7, facet: 1 }]);

    await page.getByRole("radio", { name: "Free space" }).click();
    await page.waitForFunction(() => /90% or more full/.test(document.querySelector("#map-legend")?.textContent || ""));
    await mine.locator('[data-act="label"]').click();
    await page.waitForSelector("#lbl-name");
    await page.keyboard.press("Escape");

    // data changing while the map is open: a reload keeps the selected stack
    await page.evaluate(async () => { await (await import("/ui/app.mjs" as string)).reload(); });
    await page.waitForSelector(`#map-svg [data-stack="${back}"][aria-pressed="true"]`);
    assert.equal(await rows.count(), 5);

    // a chest the capture saw and no scan opened
    await page.selectOption("#map-house", COURT);
    const seen = letter(courtModel, 1012, 2012);
    await page.waitForSelector(`#map-svg [data-stack="${seen}"]`);
    assert.equal(await page.locator(`#map-svg [data-chest="${SEEN_ONLY}"]`).getAttribute("class"), "map-chest unopened");
    await page.locator(`#map-svg [data-stack="${seen}"]`).focus();
    await page.keyboard.press("Enter");
    const row = page.locator(`#map-panel li[data-chest="${SEEN_ONLY}"]`);
    assert.match(await row.textContent() || "", /Not opened yet: scan from standing spot \d+/);
    assert.equal(await row.locator('[data-act="label"]').isDisabled(), true);
    assert.equal(await row.locator('[data-act="items"]').isDisabled(), true);
    await row.locator('[data-act="highlight"]').click();
    const lines = await until(() => readQueue(bridgeDir), (l) => l.length === 2, "the second highlight queued");
    assert.deepEqual([lines[1]!.serial, lines[1]!.chain, lines[1]!.pos], [SEEN_ONLY, [], { x: 1012, y: 2012, z: 7, facet: 1 }]);
    assert.deepEqual(errors, []);
  } finally {
    stop();
    await done(app, dir);
  }
});

test("[slow] House map: Highlight the stack queues one highlight per chest top first, once however fast it is pressed, each by its scanned place or, for a chest no scan opened, by the place its capture saw it", async (t) => {
  const why = unavailable();
  if (why) return t.skip(why);
  const { dir } = seed();
  const { bridgeDir, stop } = bridgeOnline(dir);
  const { app, page, errors } = await launch(dir);
  try {
    await go(page, "#/map", "#map-svg .map-stack");
    await page.waitForFunction(() => document.querySelector("#bridge")?.getAttribute("data-state") === "ready", undefined, { timeout: 15_000 });
    const back = letter(vaultModel, 3001, 1001), stack = vaultModel.stacks.find((s) => s.letter === back)!, top = [...stack.serials].reverse();
    await page.locator(`#map-svg [data-stack="${back}"]`).focus();
    await page.keyboard.press("Enter");
    await page.waitForSelector("#map-highlight-stack:not([disabled])");
    assert.equal((await page.locator("#map-highlight-stack").textContent())?.trim(), "Highlight the stack");
    // two presses in a row (the second on the button the first one's redraw replaced) send the stack once
    await page.evaluate(() => { const b = document.querySelector<HTMLButtonElement>("#map-highlight-stack")!; b.click(); b.click(); });
    const lines = await until(() => readQueue(bridgeDir), (l) => l.length === 5, "the stack's highlights queued");
    await page.waitForSelector("#map-highlight-stack:not([disabled])");
    assert.equal(readQueue(bridgeDir).length, 5, "Highlight the stack ran once");
    assert.deepEqual(lines.map((l) => [l.action, l.serial, l.chain, l.pos?.x, l.pos?.y]), top.map((s) => ["highlight", s, [], 3001, 1001]));
    assert.deepEqual(lines.map((l) => l.pos?.z), [...stack.zs].reverse());

    await page.selectOption("#map-house", COURT);
    const seen = letter(courtModel, 1012, 2012);
    await page.waitForSelector(`#map-svg [data-stack="${seen}"]`);
    await page.locator(`#map-svg [data-stack="${seen}"]`).focus();
    await page.keyboard.press("Enter");
    await page.waitForSelector("#map-highlight-stack:not([disabled])");
    await page.locator("#map-highlight-stack").click();
    const all = await until(() => readQueue(bridgeDir), (l) => l.length === 6, "the seen-only chest's highlight queued");
    assert.deepEqual([all[5]!.serial, all[5]!.chain, all[5]!.pos], [SEEN_ONLY, [], { x: 1012, y: 2012, z: 7, facet: 1 }]);
    assert.deepEqual(errors, []);
  } finally {
    stop();
    await done(app, dir);
  }
});

test("[slow] House map: ✎ renames a house (Esc cancels; Enter saves, and the heading, picker, crumb and page title follow with focus back on ✎), and a redesigned house is offered an earlier house's name and areas", async (t) => {
  const why = unavailable();
  if (why) return t.skip(why);
  const { dir } = seed();
  // A named house no longer captured, whose footprint overlaps the courtyard's (not the vault's).
  writeFileSync(join(dir, "house-map.json"), JSON.stringify({ version: 1, houses: { "1-1010-2010": { name: "Old courtyard", bounds: { x0: 1010, y0: 2010, x1: 1027, y1: 2027, facet: 1 },
    areas: [{ id: "a1", name: "Garden", level: 0, color: "area-7", rects: [{ x0: 1011, y0: 2011, x1: 1015, y1: 2016 }] }] } } }));
  const { app, page, errors } = await launch(dir);
  const heading = (): Promise<string | null> => page.locator("#map-panel .map-house-title h2").textContent();
  const focused = (): Promise<string | undefined> => page.evaluate(() => document.activeElement?.id);
  try {
    await go(page, `#/map/${VAULT}`, "#map-panel #map-rename");
    assert.equal(await page.locator("#map-carry").count(), 0, "the vault overlaps no earlier house");
    assert.equal(await page.locator("#map-rename").getAttribute("aria-label"), "Rename house");
    await page.locator("#map-rename").click();
    await page.waitForSelector("#map-panel #map-name");
    assert.equal(await focused(), "map-name");
    await page.locator("#map-name").fill("Scratch");
    await page.keyboard.press("Escape");
    await page.waitForSelector("#map-panel #map-rename");
    assert.equal(await heading(), "Trammel house", "Esc keeps the old heading");
    assert.equal(await focused(), "map-rename");
    await page.locator("#map-rename").click();
    await page.waitForSelector("#map-panel #map-name");
    // A reload while typing (as a new scan brings) rebuilds the field with the draft in it, focused, and saves nothing.
    await page.locator("#map-name").fill("Draft");
    await page.locator("#map-name").evaluate((e) => { e.dataset.old = "1"; });
    await page.evaluate(() => window.dispatchEvent(new HashChangeEvent("hashchange")));
    await page.waitForSelector("#map-panel #map-name:not([data-old])", { timeout: 15_000 });
    assert.equal(await page.locator("#map-name").inputValue(), "Draft");
    assert.equal(await focused(), "map-name");
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(readFileSync(join(dir, "house-map.json"), "utf8").includes("Draft"), false, "the replaced field's blur saved nothing");
    await page.locator("#map-name").fill("  Main house ");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => document.querySelector("#map-panel .map-house-title h2")?.textContent === "Main house", undefined, { timeout: 15_000 });
    assert.equal(await focused(), "map-rename");
    assert.equal(await page.locator(`#map-house option[value="${VAULT}"]`).textContent(), "Main house · Trammel, 7 × 7, 120 containers");
    assert.equal(await page.locator("#map-crumbs li").first().textContent(), "Main house");
    assert.equal(await page.title(), "Main house · Pack Rat");
    const saved = await until(() => JSON.parse(readFileSync(join(dir, "house-map.json"), "utf8")) as { houses: Record<string, { name: string; bounds?: unknown }> }, (d) => d.houses[VAULT]?.name === "Main house", "the name saved");
    assert.deepEqual(saved.houses[VAULT]!.bounds, { x0: vaultModel.x0, y0: vaultModel.y0, x1: vaultModel.x1, y1: vaultModel.y1, facet: 1 });
    await page.locator("#map-house").selectOption(COURT);
    await page.waitForSelector("#map-panel #map-carry");
    assert.match(await page.locator("#map-carry").textContent() || "", /^Use the name and areas of "Old courtyard" from the earlier house here\?Use name and areas$/);
    await page.locator("#map-carry-use").click();
    await page.waitForFunction(() => document.querySelector("#map-panel .map-house-title h2")?.textContent === "Old courtyard", undefined, { timeout: 15_000 });
    assert.equal(await page.locator("#map-carry").count(), 0, "the offer goes once the house is named");
    assert.match(await page.locator('.map-area[data-area="a1"]').textContent() || "", /^Garden2$/, "the area came along, holding the yard chest and the chest beside it no scan opened (1012, 2013 and 1012, 2012)");
    const carried = JSON.parse(readFileSync(join(dir, "house-map.json"), "utf8")) as { houses: Record<string, { areas?: Array<{ name: string }> }> };
    assert.deepEqual(carried.houses[COURT]!.areas?.map((a) => a.name), ["Garden"]);
    assert.match(await page.locator(`#map-house option[value="${COURT}"]`).textContent() || "", /^Old courtyard · Trammel, \d+ × \d+, \d+ containers?$/);
    await go(page, "#/inventory", "#tab-inventory:not([hidden])");
    assert.equal(await page.title(), "Pack Rat", "another screen puts the page title back");
    assert.deepEqual(errors, []);
  } finally { await done(app, dir); }
});

// The client point of a tile's middle on the floor of the level shown (the page's own projection and viewBox), scrolled into view first.
async function tilePoint(page: Page, x: number, y: number): Promise<[number, number]> {
  await page.locator("#map-svg").scrollIntoViewIfNeeded();
  return page.evaluate(([x, y, x0, y0]) => {
    const svg = document.querySelector("#map-svg") as SVGSVGElement, ctm = svg.getScreenCTM()!, fx = x! - x0! + 0.5, fy = y! - y0! + 0.5;
    const p = new DOMPoint(((fx - fy) * 32) / 2, ((fx + fy) * 32) / 2).matrixTransform(ctm);
    return [p.x, p.y] as [number, number];
  }, [x, y, vaultModel.x0, vaultModel.y0]);
}
const readAreas = (dir: string): Array<{ id: string; name: string; color: string; rects: unknown[] }> | undefined => {
  try { return (JSON.parse(readFileSync(join(dir, "house-map.json"), "utf8")) as { houses: Record<string, { areas?: Array<{ id: string; name: string; color: string; rects: unknown[] }> }> }).houses[VAULT]?.areas; } catch { return undefined; }
};

test("[slow] House map areas: a mouse drag draws an area, Enter asks its name, Save adds its row with its chest count and tints the map; ✎ renames it and ⋯ › Delete asks inline before it goes (1024 × 768)", async (t) => {
  const why = unavailable();
  if (why) return t.skip(why);
  const { dir } = seed();
  const { app, page, errors } = await launch(dir, { want: { width: 1024, height: 768 } });
  const rest = '.map-level:first-child .map-area-row.rest';
  try {
    await go(page, `#/map/${VAULT}`, "#map-svg .map-stack");
    assert.match(await page.locator(rest).textContent() || "", /^Whole floor120$/, "before any area the level is one Whole floor");
    await page.locator("#map-new-area-0").click();
    await page.waitForSelector("#map-draw-hint");
    assert.equal(await page.locator("#map-draw-hint").textContent(), "Drag over tiles to draw the area. Shift-drag adds more. Enter to finish, Esc to cancel. Fit shows all. Keyboard: the arrow keys move a tile cursor, Space starts and ends a rectangle, Shift+Space starts one more, Enter finishes, Escape cancels.");
    assert.equal(await page.locator("#map-new-area-0").textContent(), "Drawing…");
    assert.equal(await page.locator("#map-svg").evaluate((e) => getComputedStyle(e).cursor), "crosshair");
    const vb = await page.locator("#map-svg").getAttribute("viewBox");
    const [ax, ay] = await tilePoint(page, 3001, 1001), [bx, by] = await tilePoint(page, 3005, 1001);
    await page.mouse.move(ax, ay);
    await page.mouse.down();
    await page.mouse.move((ax + bx) / 2, (ay + by) / 2, { steps: 3 });
    await page.mouse.move(bx, by, { steps: 3 });
    assert.equal(await page.locator("#map-draw-size").textContent(), "5 × 1 = 5 tiles");
    assert.equal(await page.locator("#map-svg").getAttribute("viewBox"), vb, "a drag draws, it does not pan");
    await page.mouse.up();
    assert.equal(await page.locator("#map-draft .map-area-tile").count(), 5, "the five covered floor tiles are tinted");
    await page.keyboard.press("Enter");
    await page.waitForSelector("#map-area-new-name");
    assert.equal(await page.evaluate(() => document.activeElement?.id), "map-area-new-name");
    assert.equal(await page.locator("#map-area-new-save").isDisabled(), true, "Save waits for a name");
    assert.match(await page.locator(".map-area-new").textContent() || "", /5 tiles · 25 chests/);
    await page.keyboard.type("North row");
    assert.equal(await page.locator("#map-area-new-save").isDisabled(), false);
    await page.locator("#map-area-new-save").click();
    await page.waitForSelector('.map-area[data-area="a1"]');
    assert.match(await page.locator('.map-area[data-area="a1"]').textContent() || "", /^North row25$/);
    assert.match(await page.locator(rest).textContent() || "", /^Everything else95$/);
    assert.equal(await page.locator("#map-svg .map-area-layer .map-area-tile").count(), 5, "the map shows the area's tint");
    assert.deepEqual(await page.locator("#map-pills .map-pill").allTextContents(), ["North row"], "its name pill");
    assert.equal(await page.locator("#map-draw-hint").count(), 0, "drawing is over");
    assert.deepEqual(await until(() => readAreas(dir), (a) => !!a?.length, "the area saved"), [{ id: "a1", name: "North row", level: 0, color: "area-1", rects: [{ x0: 3001, y0: 1001, x1: 3005, y1: 1001 }] }]);

    // ✎: Esc keeps the name, Enter saves a new one; focus goes back to ✎ either way.
    await page.locator("#map-area-edit-a1").click();
    await page.locator("#map-area-rename").fill("Scratch");
    await page.keyboard.press("Escape");
    await page.waitForSelector("#map-area-edit-a1");
    assert.match(await page.locator('.map-area[data-area="a1"]').textContent() || "", /^North row/);
    assert.equal(await page.evaluate(() => document.activeElement?.id), "map-area-edit-a1");
    await page.locator("#map-area-edit-a1").click();
    await page.locator("#map-area-rename").fill("Reagents");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => document.querySelector('.map-area[data-area="a1"]')?.textContent?.startsWith("Reagents"), undefined, { timeout: 15_000 });
    assert.equal(await page.evaluate(() => document.activeElement?.id), "map-area-edit-a1");
    await until(() => readAreas(dir), (a) => a?.[0]?.name === "Reagents", "the rename saved");

    // ⋯ › Delete asks with the page's yes/no dialog; Cancel keeps the area, focus back on its ⋯.
    await page.locator("#map-area-menu-a1").click();
    await page.locator('.pop [role="menuitem"]', { hasText: "Delete" }).click();
    await page.waitForSelector("dialog[open] [data-confirm]");
    assert.match(await page.locator("dialog[open]").textContent() || "", /Delete Reagents\?.*Its chests go to Whole floor\./);
    assert.equal(await page.locator("dialog[open] [data-confirm]").textContent(), "Delete area");
    await page.locator("dialog[open] [data-cancel]").click();
    await page.waitForSelector("dialog[open]", { state: "detached" });
    assert.equal(await page.evaluate(() => document.activeElement?.id), "map-area-menu-a1");
    assert.equal(await page.locator('.map-area[data-area="a1"]').count(), 1);
    // ⋯ › Change colour: the palette by name, the area's own pressed.
    await page.locator("#map-area-menu-a1").click();
    await page.locator('.pop [role="menuitem"]', { hasText: "Change colour" }).click();
    await page.waitForSelector("#map-colour-area-3");
    assert.equal(await page.locator("#map-colour-area-1").getAttribute("aria-pressed"), "true");
    assert.deepEqual(await page.locator(".map-colour").evaluateAll((bs) => bs.map((b) => b.getAttribute("aria-label"))), ["Purple", "Orange", "Teal", "Pink", "Blue", "Yellow", "Green", "Red"]);
    await page.locator("#map-colour-area-3").click();
    await until(() => readAreas(dir), (a) => a?.[0]?.color === "area-3", "the colour saved");
    await page.waitForFunction(() => (document.querySelector('.map-area[data-area="a1"] .map-swatch') as HTMLElement | null)?.style.background.includes("area-3"), undefined, { timeout: 15_000 });
    // ⋯ › Redraw: the area's row of stacks moved one row south, shown at once and saved.
    await page.locator("#map-area-menu-a1").click();
    await page.locator('.pop [role="menuitem"]', { hasText: "Redraw" }).click();
    await page.waitForSelector("#map-draw-hint");
    const [rx, ry] = await tilePoint(page, 3001, 1002), [sx, sy] = await tilePoint(page, 3005, 1002);
    await page.mouse.move(rx, ry);
    await page.mouse.down();
    await page.mouse.move(sx, sy, { steps: 4 });
    await page.mouse.up();
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => !document.querySelector("#map-draw-hint"), undefined, { timeout: 15_000 });
    assert.match(await page.locator('.map-area[data-area="a1"]').textContent() || "", /^Reagents25$/);
    assert.equal(await page.evaluate(() => document.activeElement?.id), "map-area-a1");
    assert.deepEqual((await until(() => readAreas(dir), (a) => (a?.[0]?.rects as Array<{ y0: number }> | undefined)?.[0]?.y0 === 1002, "the redraw saved"))![0]!.rects, [{ x0: 3001, y0: 1002, x1: 3005, y1: 1002 }]);
    await page.locator("#map-area-menu-a1").click();
    await page.locator('.pop [role="menuitem"]', { hasText: "Delete" }).click();
    await page.locator("dialog[open] [data-confirm]").click();
    await page.waitForFunction(() => !document.querySelector('.map-area[data-area="a1"]'), undefined, { timeout: 15_000 });
    assert.match(await page.locator(rest).textContent() || "", /^Whole floor120$/);
    assert.equal(await page.locator("#map-svg .map-area-tile").count(), 0);
    assert.equal(await page.evaluate(() => document.activeElement?.id), "map-new-area-0");
    await until(() => readAreas(dir), (a) => a === undefined, "the vault's entry gone with its last area (it has no name)");
    assert.deepEqual(errors, []);
  } finally { await done(app, dir); }
});

test("[slow] House map areas: a name pill per piece of an area at a fixed size, cut short to fit and whole on hover, never in the pointer's way; Hide area labels hides them and the choice survives a reload (1024 × 768)", async (t) => {
  const why = unavailable();
  if (why) return t.skip(why);
  const { dir } = seed();
  const LONG = "A very long name for a tiny spot";
  writeFileSync(join(dir, "house-map.json"), JSON.stringify({ version: 1, houses: { [VAULT]: { name: "", bounds: VAULT_BOUNDS, areas: [
    { id: "a1", name: "Loot Corner", level: 0, color: "area-2", rects: [{ x0: 3001, y0: 1001, x1: 3002, y1: 1002 }, { x0: 3004, y0: 1004, x1: 3005, y1: 1005 }] },
    { id: "a2", name: LONG, level: 0, color: "area-5", rects: [{ x0: 3005, y0: 1001, x1: 3005, y1: 1001 }] }] } } }));
  const { app, page, errors } = await launch(dir, { want: { width: 1024, height: 768 } });
  const pills = (id: string) => page.locator(`#map-pills .map-pill[data-area="${id}"]`);
  try {
    await go(page, `#/map/${VAULT}`, "#map-pills .map-pill");
    assert.equal(await pills("a1").count(), 2, "a pill for each piece of Loot Corner");
    for (const text of await pills("a1").allTextContents()) assert.match(text, /^(Loot Corner|Loo[^…]*…)$/, "the name, or as much of it as the piece's width takes");
    assert.deepEqual(await pills("a1").evaluateAll((es) => es.map((e) => e.getAttribute("title"))), ["Loot Corner", "Loot Corner"]);
    const style = await pills("a1").first().evaluate((e) => { const c = getComputedStyle(e); return [c.fontSize, c.fontWeight, c.pointerEvents, getComputedStyle(e.parentElement!).pointerEvents]; });
    assert.deepEqual(style, ["12px", "500", "none", "none"]);
    assert.equal(await page.locator('#map-svg .map-area-shape[data-area-shape="a1"] > title').textContent(), "Loot Corner", "the tint carries the name as a tooltip");
    const short = await pills("a2").textContent();
    assert.notEqual(short, LONG, "a one-tile piece is too narrow for the whole name");
    assert.ok(short === "" || short!.endsWith("…"), `cut short or a dot: ${short}`);
    // The pill keeps its screen size through a zoom.
    const before = await pills("a1").first().evaluate((e) => e.getBoundingClientRect().height);
    await page.locator("#map-zoom-in").click();
    assert.equal(await pills("a1").first().evaluate((e) => e.getBoundingClientRect().height), before);
    // Hovering the area's row shows its whole name on top.
    await page.locator('.map-area[data-area="a2"]').hover();
    await page.waitForFunction((n) => document.querySelector('#map-pills .map-pill[data-area="a2"]')?.textContent === n, LONG, { timeout: 15_000 });
    assert.match(await pills("a2").getAttribute("class") || "", /\bhot\b/);
    assert.match(await page.locator('#map-svg .map-area-shape[data-area-shape="a2"]').getAttribute("class") || "", /\bhot\b/);
    // A click on a stack under a pill still selects the stack.
    const stack = `#map-svg [data-stack="${letter(vaultModel, 3005, 1005)}"]`;
    await page.locator(stack).click({ force: true });
    assert.equal(await page.locator(stack).getAttribute("aria-pressed"), "true");
    // Hide area labels: no pills, the button pressed, and the choice is saved and survives a reload.
    assert.equal(await page.locator("#map-labels").getAttribute("aria-label"), "Hide area labels");
    await page.locator("#map-labels").click();
    assert.equal(await page.locator("#map-pills .map-pill").count(), 0);
    assert.equal(await page.locator("#map-labels").getAttribute("aria-pressed"), "true");
    assert.equal(await page.locator("#map-labels").getAttribute("aria-label"), "Hide area labels", "one fixed name; pressed means hidden");
    assert.equal(await page.locator("#map-svg .map-area-shape").count(), 2, "the tints stay");
    await until(() => { try { return JSON.parse(readFileSync(join(dir, "ui-prefs.json"), "utf8")).areaLabels as string; } catch { return ""; } }, (v) => v === "hide", "the choice saved");
    await page.reload();
    await go(page, `#/map/${VAULT}`, "#map-svg .map-stack");
    assert.equal(await page.locator("#map-labels").getAttribute("aria-pressed"), "true");
    assert.equal(await page.locator("#map-pills .map-pill").count(), 0, "still hidden after a reload");
    await page.locator("#map-labels").click();
    assert.equal(await pills("a1").count(), 2, "shown again");
    assert.deepEqual(errors, []);
  } finally { await done(app, dir); }
});

test("[slow] House map areas: the keyboard alone draws an area (arrows move the cursor, Space starts and ends a rectangle, Shift+Space adds one, the size is announced, Enter finishes, Esc cancels)", async (t) => {
  const why = unavailable();
  if (why) return t.skip(why);
  const { dir } = seed();
  const { app, page, errors } = await launch(dir, { want: { width: 1024, height: 768 } });
  // The live region is emptied and refilled on the next frame: wait for the words.
  const live = async (want: string): Promise<void> => { await page.waitForFunction((w) => document.querySelector("#map-draw-live")?.textContent === w, want, { timeout: 15_000 }); };
  const keys = async (...ks: string[]): Promise<void> => { for (const k of ks) await page.keyboard.press(k); };
  try {
    await go(page, `#/map/${VAULT}`, "#map-svg .map-stack");
    // Esc cancels, focus back on + New area.
    await tabTo(page, "#map-new-area-0");
    await page.keyboard.press("Enter");
    await page.waitForSelector("#map-draw-hint");
    assert.ok(await focused(page, "#map-svg"), "the map takes the keyboard");
    await keys("Space", "ArrowRight", "Escape");
    await page.waitForFunction(() => !document.querySelector("#map-draw-hint"), undefined, { timeout: 15_000 });
    assert.ok(await focused(page, "#map-new-area-0"));
    await live("Drawing cancelled.");

    // The cursor starts mid-house (3003, 1003) and the arrows move it the way they point on screen (↑ half a tile up, → a whole tile right): four ↑ to the north corner (3001, 1001), then four ↓ and two → lay the row of five to 3005, 1001; Shift+Space and four ↓ and two ← add the column down to 3005, 1005.
    await page.keyboard.press("Enter");
    await page.waitForSelector("#map-draw-hint");
    await keys("ArrowUp", "ArrowUp", "ArrowUp", "ArrowUp", "Space");
    assert.equal(await page.locator("#map-svg .map-draw-cursor").count(), 1, "the cursor is drawn");
    await keys("ArrowDown", "ArrowDown", "ArrowDown", "ArrowDown", "ArrowRight", "ArrowRight");
    await live("5 × 1 = 5 tiles");
    await keys("Space");
    await live("1 rectangle, 5 tiles. Enter to finish.");
    await keys("Shift+Space", "ArrowDown", "ArrowDown", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowLeft");
    await live("1 × 5 = 5 tiles");
    await keys("Space");
    await live("2 rectangles, 9 tiles. Enter to finish.");
    await keys("Enter");
    await page.waitForSelector("#map-area-new-name");
    assert.ok(await focused(page, "#map-area-new-name"));
    await page.keyboard.type("East corner");
    await keys("Enter");
    await page.waitForSelector('.map-area[data-area="a1"]');
    assert.match(await page.locator('.map-area[data-area="a1"]').textContent() || "", /^East corner45$/, "nine stacks of five");
    assert.ok(await focused(page, '.map-area[data-area="a1"]'), "focus on the new area's row");
    assert.deepEqual((await until(() => readAreas(dir), (a) => !!a?.length, "the area saved"))![0]!.rects, [{ x0: 3001, y0: 1001, x1: 3005, y1: 1001 }, { x0: 3005, y0: 1001, x1: 3005, y1: 1005 }]);
    assert.deepEqual(errors, []);
  } finally { await done(app, dir); }
});

test("[slow] House map: with no house captured the demo's ground chests stand on a plain grid with a hint to rescan, and with nothing scanned an empty state says how to scan a house", async (t) => {
  const why = unavailable();
  if (why) return t.skip(why);
  const demoDir = mkdtempSync(join(tmpdir(), "packrat-map-demo-"));
  writeFileSync(join(demoDir, "settings.json"), JSON.stringify({ schemaVersion: 1, shard: "uoalive", setupDone: true }));
  const demo = await launch(demoDir, { demo: true });
  try {
    await go(demo.page, "#/map", "#map-svg .map-stack");
    assert.equal(await demo.page.locator("#map-house").inputValue(), "plain");
    assert.equal(await demo.page.locator("#map-svg [data-chest]").count(), 2);
    assert.match(await demo.page.locator("#map-stage").textContent() || "", /Scan from inside the house with the 2\.11\.0 scripts to draw it/);
    await demo.page.locator("#map-svg .map-stack").first().focus();
    await demo.page.keyboard.press("Enter");
    assert.equal(await demo.page.locator("#map-panel .map-chest-row").count(), 2);
    assert.deepEqual(demo.errors, []);
  } finally { await done(demo.app, demoDir); }
  const emptyDir = mkdtempSync(join(tmpdir(), "packrat-map-empty-"));
  writeFileSync(join(emptyDir, "settings.json"), JSON.stringify({ schemaVersion: 1, shard: "uoalive", setupDone: true }));
  const empty = await launch(emptyDir);
  try {
    await go(empty.page, "#/map", ".map-empty");
    assert.match(await empty.page.locator(".map-empty").textContent() || "", /2\.11\.0 scripts/);
    assert.deepEqual(empty.errors, []);
  } finally { await done(empty.app, emptyDir); }
});

test("[slow] Settings › UO folder (house map): shows where tiledata.mul is found, refuses a relative path, saves a folder and resets to automatic", async (t) => {
  const why = unavailable();
  if (why) return t.skip(why);
  const { dir, uo } = seed();
  const other = join(dir, "other-uo");
  mkdirSync(other);
  writeFileSync(join(other, "tiledata.mul"), syntheticTileData(FIXTURE_TILES));
  const saved = (): string | null | undefined => (JSON.parse(readFileSync(join(dir, "settings.json"), "utf8")) as { uoFolder?: string | null }).uoFolder;
  const { app, page, errors } = await launch(dir);
  try {
    await go(page, "#/settings", "#set-uofolder .set-uofolder-where");   // the card as GET /api/houses tells it, not its first draw
    const card = page.locator("#set-uofolder");
    assert.match(await card.textContent() || "", /Found through TazUO's launcher/);
    assert.ok((await card.textContent() || "").includes(uo));
    await page.locator("#set-uofolder-path").fill("relative/uo");
    await page.locator("#set-uofolder-save").click();
    await page.waitForSelector("#set-uofolder .msg.bad");
    assert.match(await page.locator("#set-uofolder .msg.bad").textContent() || "", /Enter the full path of a folder\./);
    await page.locator("#set-uofolder-path").fill(other);
    await page.locator("#set-uofolder-save").click();
    await until(saved, (v) => v === other, "the folder saved");
    await page.waitForFunction(() => /Set here/.test(document.querySelector("#set-uofolder")?.textContent || ""));
    await page.locator("#set-uofolder-reset").click();
    await until(saved, (v) => v === null, "back to automatic");
    await page.waitForFunction(() => /Found through TazUO's launcher/.test(document.querySelector("#set-uofolder")?.textContent || ""));
    assert.deepEqual(errors, []);
  } finally { await done(app, dir); }
});

test("[slow] Settings › UO folder (house map): a folder set here whose tiledata.mul cannot be read, or is gone, says why under the folder", async (t) => {
  const why = unavailable();
  if (why) return t.skip(why);
  const { dir } = seed();
  const mine = join(dir, "my-uo");
  mkdirSync(mine);
  writeFileSync(join(mine, "tiledata.mul"), Buffer.alloc(100));
  const settings = JSON.parse(readFileSync(join(dir, "settings.json"), "utf8")) as Record<string, unknown>;
  writeFileSync(join(dir, "settings.json"), JSON.stringify({ ...settings, uoFolder: mine }));
  const { app, page, errors } = await launch(dir);
  try {
    await go(page, "#/settings", "#set-uofolder .set-uofolder-where");   // the card as GET /api/houses tells it, not its first draw
    const card = page.locator("#set-uofolder");
    const text = await card.textContent() || "";
    assert.match(text, /Set here/);
    assert.ok(text.includes(mine));
    assert.match(await card.locator(".msg.warn").textContent() || "", /not one Pack Rat can read.*plain colours/);
    assert.equal(await page.locator("#set-uofolder-reset").count(), 1);
    rmSync(join(mine, "tiledata.mul"));
    await page.locator("#set-uofolder-save").click();   // the field still holds the folder: refused, and the card looks again
    await page.waitForSelector("#set-uofolder .msg.bad");
    assert.match(await card.locator(".msg.bad").textContent() || "", /That folder has no tiledata\.mul\./);
    assert.ok(!(await card.locator(".msg.bad").textContent() || "").includes(mine), "the refusal never echoes the path");
    assert.match(await card.locator(".msg.warn").textContent() || "", /no tiledata\.mul any more.*plain colours/);
    assert.equal(await page.locator("#set-uofolder-path").inputValue(), mine);
    assert.deepEqual(errors, []);
  } finally { await done(app, dir); }
});

// One scene measured in both theme families, light and dark (the page's own look only, as ui-contrast.test.mts does); some measured text must match `shows`, so the scene is the one meant.
async function measure(page: Page, name: string, shows: RegExp, rows: Array<ContrastRow & { where: string }>): Promise<void> {
  for (const family of ["default", "britannia"] as const) {
    await page.evaluate(async (f) => (await import("/ui/theme.mjs" as string)).applyLook({ theme: f }), family);
    for (const mode of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: mode, reducedMotion: "reduce" });
      await page.waitForFunction(([f, m]) => document.documentElement.dataset.theme === f && document.documentElement.dataset.mode === m, [family, mode], { timeout: 5_000 });
      await page.waitForTimeout(80);
      const got = await page.evaluate(probeContrast);
      assert.ok(got.length > 10, `${name} (${family} ${mode}) measured only ${got.length} pairs — did the scene render?`);
      assert.ok(got.some((r) => shows.test(r.text)), `${name} (${family} ${mode}) measured no text matching ${shows}`);
      for (const r of got) rows.push({ ...r, where: `${name} · ${family} ${mode}` });
    }
  }
  await page.evaluate(async () => (await import("/ui/theme.mjs" as string)).applyLook({ theme: "default" }));
  await page.emulateMedia({ colorScheme: "light" });
}

test("[slow] House map: the Location section shows the house's coordinates under its heading and the facet overview with a marker per house, another house's marker opens its map by click or keyboard, and without the facet file a line says why", async (t) => {
  const skip = unavailable();
  if (skip) { t.skip(skip); return; }
  const { dir } = seed({ facet: true });
  const { app, page, errors } = await launch(dir);
  try {
    await go(page, `#/map/${VAULT}`, "#map-panel #map-where");
    // The coordinates are the Location section's first line, under its heading; the heading area above has no coordinates or corners.
    assert.deepEqual(await page.locator("#map-where > *").evaluateAll((es) => es.slice(0, 2).map((e) => e.id || e.className)), ["map-where-title", "map-where-coords"]);
    assert.equal(await page.locator("#map-where-title").textContent(), "Location - Trammel - 3003 1003");
    assert.equal(await page.locator("#map-where #map-where-text").textContent(), "3003, 1003 · Trammel");
    assert.doesNotMatch(await page.locator("#map-panel .map-panel-head").textContent() || "", /Corners|3003, 1003/);
    assert.equal(await page.locator("#map-where-copy").getAttribute("aria-label"), "Copy the coordinates");
    await page.waitForFunction(() => { const i = document.querySelector<HTMLImageElement>("#map-where .map-where-img"); return !!i && i.complete && i.naturalWidth === 600 && i.naturalHeight === 450; }, null, { timeout: 30_000 });
    assert.equal(await page.locator("#map-where .map-where-mark.current").getAttribute("aria-label"), "Trammel house at 3003, 1003 (this house)");
    const other = page.locator(`#map-where a.map-where-mark[data-house="${NEIGHBOUR}"]`);
    assert.equal(await other.getAttribute("aria-label"), "Trammel house at 3108, 1108");
    await other.click();
    await page.waitForFunction((id) => location.hash === `#/map/${id}`, NEIGHBOUR, { timeout: 10_000 });
    await page.waitForSelector(`#map-where a.map-where-mark[data-house="${VAULT}"]`, { timeout: 30_000 });
    await page.locator(`#map-where a.map-where-mark[data-house="${VAULT}"]`).focus();
    await page.keyboard.press("Enter");
    await page.waitForFunction((id) => location.hash === `#/map/${id}`, VAULT, { timeout: 10_000 });
    await go(page, `#/map/${COURT}`, "#map-panel #map-where");
    // The vault's section may still be on screen: wait for the courtyard's own marker before counting.
    await page.waitForSelector('#map-where .map-where-mark.current[aria-label="Trammel house at 1008, 2008 (this house)"]', { timeout: 30_000 });
    assert.equal(await page.locator("#map-where a.map-where-mark").count(), 0, "no other house within the courtyard's crop");
    assert.deepEqual(errors, []);
  } finally { await done(app, dir); }
  const { dir: bare } = seed();
  const b = await launch(bare);
  try {
    await go(b.page, `#/map/${VAULT}`, "#map-panel #map-where-note");
    assert.match((await b.page.locator("#map-where-note").textContent())!, /no world map file for this facet/);
    assert.equal(await b.page.locator("#map-where #map-where-text").textContent(), "3003, 1003 · Trammel", "the heading and the coordinates stay, the reason under them");
    assert.deepEqual(await b.page.locator("#map-where > *").evaluateAll((es) => es.map((e) => e.id || e.className)), ["map-where-title", "map-where-coords", "map-where-note"]);
    assert.equal(await b.page.locator("#map-where img").count(), 0);
  } finally { await done(b.app, bare); }
});

test("[slow] House map: the small map opens the world map lightbox by click or Enter; + asks for the visible region at screen resolution and lays it over the base; Esc and Close close it with focus back on the small map; another house's marker opens its map", async (t) => {
  const skip = unavailable();
  if (skip) { t.skip(skip); return; }
  const { dir } = seed({ facet: true });
  const { app, page, errors } = await launch(dir);
  const asked: string[] = [];
  page.on("request", (r) => { if (r.url().includes("/api/facet-map/1.png")) asked.push(new URL(r.url()).search); });
  const isBase = (q: string): boolean => q.startsWith("?x0=0&y0=0&x1=8192&y1=8192&");
  const baseShown = async (): Promise<void> => { await page.waitForFunction(() => { const i = document.querySelector<HTMLImageElement>("dialog.world-map-dialog[open] .wm-base"); return !!i && !i.hidden && i.complete && i.naturalWidth > 0; }, null, { timeout: 30_000 }); };
  try {
    await go(page, `#/map/${VAULT}`, "#map-panel #map-where-open");
    assert.equal(await page.locator("#map-where-open").getAttribute("aria-label"), "Open the world map");
    assert.equal(await page.locator("#map-where-open").getAttribute("role"), "button");
    await page.locator("#map-where-open").click();
    await page.waitForSelector("dialog.world-map-dialog[open]", { timeout: 10_000 });
    assert.ok(await page.locator("dialog.world-map-dialog .wm-viewport").isVisible());
    await baseShown();
    assert.ok(asked.some(isBase), `the base is the whole facet: ${asked.join(" ")}`);
    assert.equal(await page.locator(".wm-marker.current").getAttribute("aria-label"), "Trammel house at 3003, 1003 (this house)");
    assert.equal(await page.locator(`.wm-marker[data-house="${NEIGHBOUR}"]`).getAttribute("href"), `#/map/${NEIGHBOUR}`);
    const before = asked.length;
    await page.locator("#wm-zoom-in").click();
    await page.waitForFunction(() => { const i = document.querySelector<HTMLImageElement>(".wm-overlay"); return !!i && !i.hidden && i.complete && i.naturalWidth > 0; }, null, { timeout: 30_000 });
    const overlayAsks = asked.slice(before).filter((q) => !isBase(q));
    assert.equal(overlayAsks.length, 1, `one region asked for after +: ${overlayAsks.join(" ")}`);
    assert.match(overlayAsks[0]!, /^\?x0=\d+&y0=\d+&x1=\d+&y1=\d+&w=\d+$/);
    await page.keyboard.press("Escape");
    await page.waitForSelector("dialog.world-map-dialog", { state: "detached", timeout: 10_000 });
    assert.equal(await page.evaluate(() => document.activeElement?.id), "map-where-open", "focus back on the small map");
    await page.keyboard.press("Enter");
    await page.waitForSelector("dialog.world-map-dialog[open]", { timeout: 10_000 });
    await page.locator("#wm-close").click();
    await page.waitForSelector("dialog.world-map-dialog", { state: "detached", timeout: 10_000 });
    assert.equal(await page.evaluate(() => document.activeElement?.id), "map-where-open");
    await page.locator("#map-where-open").click();
    await baseShown();
    // + zooms about the house shown, so twice spreads the two markers well apart on any window size before the click.
    await page.locator("#wm-zoom-in").click();
    await page.locator("#wm-zoom-in").click();
    await page.locator(`.wm-marker[data-house="${NEIGHBOUR}"]:not([hidden])`).click();
    await page.waitForFunction((id) => location.hash === `#/map/${id}`, NEIGHBOUR, { timeout: 10_000 });
    await page.waitForSelector("dialog.world-map-dialog", { state: "detached", timeout: 10_000 });
    assert.deepEqual(errors, []);
  } finally { await done(app, dir); }
});

test("[slow] House map: every text, control edge and icon passes contrast on the map, a selected stack, the contents drawer, a callout, the no-tiledata note and the empty state, in both theme families light and dark; at 1000 × 700 the panes stack and nothing scrolls sideways", async (t) => {
  const why = unavailable();
  if (why) return t.skip(why);
  const rows: Array<ContrastRow & { where: string }> = [];
  const { dir } = seed({ items: true });
  const { app, page, errors, size } = await launch(dir);
  try {
    await go(page, "#/map", "#map-svg .map-stack");
    await page.mouse.move(size.width - 20, 4);
    await measure(page, "house map", /Item slots/, rows);
    const front = letter(vaultModel, 3005, 1005);
    await page.locator(`#map-svg [data-stack="${front}"]`).focus();
    await page.keyboard.press("Enter");
    await page.waitForSelector("#map-panel .map-chest-row");
    await measure(page, "selected stack", /Stack /, rows);
    await page.locator(`#map-svg [data-stack="${letter(vaultModel, 3001, 1001)}"]`).focus();
    await page.keyboard.press("Enter");
    await page.locator(`#map-panel li[data-chest="${TOP}"] [data-act="items"]`).click();
    await page.waitForSelector("#map-drawer .map-item");
    await measure(page, "contents drawer", /loose/, rows);
    await page.keyboard.press("Escape");
    await page.waitForSelector("#map-drawer", { state: "detached" });
    await page.locator(`#map-svg [data-stack="${front}"]`).focus();
    await page.keyboard.press("Enter");
    await page.locator(`#map-svg [data-stack="${front}"]`).hover();
    await page.waitForSelector("#map-callout:not([hidden])");
    await measure(page, "callout", /top first/, rows);
    // The houses list without tiledata: the real body read through the page (a route's own refetch lacks the app's token and gets 401), then answered with the reason swapped in.
    const real = await page.evaluate(async () => (await fetch("/api/houses")).json() as Promise<Record<string, unknown>>);
    await page.route("**/api/houses", (route) => route.fulfill({ json: { ...real, tiledata: false, tiledataFrom: { folder: null, source: null, reason: "no-client" } } }));
    await go(page, `#/map/${COURT}`, "#map-tiledata-note");
    await page.unroute("**/api/houses");
    await page.mouse.move(size.width - 20, 4);
    await measure(page, "no-tiledata note", /No game client/, rows);   // the note's text row starts with its title and is cut at 60 characters, before the word tiledata

    // a small window: one column, no sideways scroll anywhere on the screen
    await fitWindow(app, page, { width: 1000, height: 700 });
    await go(page, `#/map/${VAULT}`, `#map-svg [data-chest="${LABELLED}"]`);   // a vault-only chest: the courtyard drawn before it has stacks too
    const layout = await page.evaluate(() => {
      const over = (sel: string): number => { const e = document.querySelector(sel) as HTMLElement; return e.scrollWidth - e.clientWidth; };
      return { cols: getComputedStyle(document.querySelector("#map-body")!).gridTemplateColumns.split(" ").length, page: over("html"), body: over("#map-body"), top: over("#tab-map .topbar") };
    });
    assert.deepEqual(layout, { cols: 1, page: 0, body: 0, top: 0 });
    assert.deepEqual(errors, []);
  } finally { await done(app, dir); }
  const emptyDir = mkdtempSync(join(tmpdir(), "packrat-map-empty-"));
  writeFileSync(join(emptyDir, "settings.json"), JSON.stringify({ schemaVersion: 1, shard: "uoalive", setupDone: true }));
  const empty = await launch(emptyDir);
  try {
    await go(empty.page, "#/map", ".map-empty");
    await empty.page.mouse.move(empty.size.width - 20, 4);
    await measure(empty.page, "empty state", /No house|scan/i, rows);
  } finally { await done(empty.app, emptyDir); }
  const failed = failures(rows);
  assert.equal(failed.length, 0, `contrast failures (${failed.length} of ${rows.length} pairs):\n${describeFailures(failed)}`);
});

// Where the drawer sits for the window's width: its own column right of the panel from 1100 px (the levels pane folded away below 1800, there from 1800), else after the panel in the one column.
async function drawerLayout(page: Page, width: number, mapBefore: number): Promise<void> {
  await page.waitForTimeout(400);   // the columns' width transition
  const box = async (sel: string) => (await page.locator(sel).boundingBox())!;
  const [panel, drawer, map] = [await box("#map-panel"), await box("#map-drawer"), await box("#map-stage")];
  const side = await page.locator("#tab-map .map-side").evaluate((e) => e.getBoundingClientRect().width);
  if (width >= 1100) {
    assert.ok(drawer.x >= panel.x + panel.width - 1, `the drawer is right of the panel (${drawer.x} < ${panel.x + panel.width})`);
    assert.ok(map.width < mapBefore, `the map narrows (${map.width} ≥ ${mapBefore})`);
    if (width < 1800) assert.ok(side < 1, `below 1800 px the levels pane folds away (${side} px)`);
    else assert.ok(side > 270, `from 1800 px the 280 px levels pane stays (${side} px)`);
    if (width >= 1440) assert.ok(map.width >= 360, `with the drawer open the map keeps room (${map.width} px)`);
  } else assert.ok(drawer.y >= panel.y + panel.height - 1, "below 1100 px the drawer comes after the panel");
}

test("[slow] House map: Show items opens the contents drawer as a column of its own and the map narrows (after the panel in one column on a small screen); its tabs switch chests, the filter narrows the list, another stack swaps it, Esc and ✕ close it with focus back where it came from, a new scan keeps its tab, filter, folded bag and scroll, and an item's Open details opens it in Inventory", async (t) => {
  const why = unavailable();
  if (why) return t.skip(why);
  const { dir } = seed({ items: true });
  const { app, page, errors, size } = await launch(dir);
  try {
    await go(page, "#/map", "#map-svg .map-stack");
    const back = letter(vaultModel, 3001, 1001), front = letter(vaultModel, 3005, 1005);
    await page.locator(`#map-svg [data-stack="${back}"]`).focus();
    await page.keyboard.press("Enter");
    await page.waitForSelector(`#map-panel li[data-chest="${TOP}"]`);
    const before = (await page.locator("#map-stage").boundingBox())!.width;
    const opener = page.locator(`#map-panel li[data-chest="${TOP}"] [data-act="items"]`);
    assert.equal(await opener.textContent(), "Show items");
    await opener.click();
    const drawer = page.locator("#map-drawer");
    await page.waitForSelector("#map-drawer .map-item");
    await drawerLayout(page, size.width, before);
    assert.equal(await page.evaluate(() => location.hash), "#/map", "the map stays on screen");
    const code = (await page.locator(`#map-panel li[data-chest="${TOP}"] .map-chest-name .mono`).textContent())!;
    const name = (await page.locator(`#map-panel li[data-chest="${TOP}"] .map-chest-name .ellip`).textContent())!;
    assert.equal(await drawer.getAttribute("role"), "region");
    assert.equal(await drawer.getAttribute("aria-label"), `Contents of ${code} ${name}`);
    assert.match(await page.locator("#map-drawer-meta").textContent() || "", new RegExp(`^In game: .* · Stack ${back}, ${FILLED.length} chests$`));
    const summary = (): Promise<string | null> => page.locator("#map-drawer-summary").textContent();
    const summaryIs = (text: string): Promise<unknown> => page.waitForFunction((x) => document.querySelector("#map-drawer-summary")?.textContent === x, text, { timeout: 10_000 });
    assert.equal(await summary(), "6 items · 1 loose, 4 in 1 bag");
    assert.equal(await page.locator('#map-panel li.open').getAttribute("data-chest"), String(TOP), "the opened chest's row carries the accent bar");
    const names = (): Promise<string[]> => page.locator("#map-drawer-body .map-item-name, #map-drawer-body .map-bag-name").allTextContents();
    assert.deepEqual(await names(), ["Weapons", "Gems", "Ruby", "Bow", "Katana", "Arrows"], "bags first, then the items by name, nested inside nested");
    assert.match(await page.locator("#map-drawer-body .map-bag-head").first().textContent() || "", /4 items/);
    // five chests: a select labelled Chest (tabs are for up to four), an option per chest, the shown one chosen
    assert.equal(await page.locator("#map-drawer [role=radio]").count(), 0);
    assert.equal(await page.locator("#map-drawer-chest option").count(), FILLED.length);
    assert.equal(await page.locator('#map-drawer label[for="map-drawer-chest"]').textContent(), "Chest");
    assert.equal(await page.locator("#map-drawer-chest").inputValue(), String(TOP));
    await page.locator("#map-drawer-chest").selectOption(String(UNDER));
    await summaryIs("46 items · 1 loose, 43 in 2 bags");
    assert.equal(await page.locator('#map-panel li.open').getAttribute("data-chest"), String(UNDER));
    await page.locator("#map-drawer-chest").selectOption(String(TOP));
    await summaryIs("6 items · 1 loose, 4 in 1 bag");
    await page.locator("#map-drawer-filter").fill("ruby");
    await page.waitForFunction(() => document.querySelectorAll("#map-drawer-body .map-item").length === 1);
    assert.deepEqual(await names(), ["Weapons", "Gems", "Ruby"]);
    await page.locator("#map-drawer-filter").fill("hit chance");
    await page.waitForFunction(() => document.querySelector("#map-drawer-body .map-item-name")?.textContent === "Katana");
    assert.deepEqual(await names(), ["Weapons", "Katana"], "a property line matches");
    // Esc from inside the drawer closes it, focus back on the Show items that opened it, and the levels pane comes back
    await page.keyboard.press("Escape");
    await page.waitForSelector("#map-drawer", { state: "detached" });
    assert.equal(await page.evaluate(() => document.activeElement?.closest("li[data-chest]")?.getAttribute("data-chest")), String(TOP));
    assert.equal(await page.evaluate(() => (document.activeElement as HTMLElement).dataset.act), "items");
    assert.equal(await page.locator("#map-panel li.open").count(), 0);
    await page.waitForTimeout(400);
    assert.ok(await page.locator("#tab-map .map-side").evaluate((e) => e.getBoundingClientRect().width) > 270, "the 280 px levels pane is back");
    // another stack swaps the drawer to that stack's top chest; ✕ closes it with focus on the stack
    await opener.click();
    await page.waitForSelector("#map-drawer .map-item");
    const frontTop = vaultModel.stacks.find((s) => s.letter === front)!.serials.at(-1)!;
    await page.locator(`#map-svg [data-stack="${front}"]`).click();
    await page.waitForFunction((s) => (document.querySelector("#map-drawer-chest") as HTMLSelectElement | null)?.value === String(s), frontTop, { timeout: 10_000 });
    await summaryIs("Empty");
    assert.equal(await page.locator('#map-panel li.open').getAttribute("data-chest"), String(frontTop));
    await page.locator("#map-drawer [aria-label='Close contents']").click();
    await page.waitForSelector("#map-drawer", { state: "detached" });
    assert.equal(await page.evaluate(() => (document.activeElement as HTMLElement | null)?.closest("[data-stack]")?.getAttribute("data-stack")), front);

    // a new scan: the drawer keeps its tab, filter, folded bag and scroll, and shows the new item
    await page.locator(`#map-svg [data-stack="${back}"]`).focus();
    await page.keyboard.press("Enter");
    await opener.click();
    await page.waitForSelector("#map-drawer .map-item");
    await page.locator("#map-drawer-chest").selectOption(String(UNDER));
    await summaryIs("46 items · 1 loose, 43 in 2 bags");
    await page.locator("#map-drawer-filter").fill("pearl");
    await page.locator(`#map-drawer-bag-${SPARE}`).click();
    assert.equal(await page.locator(`#map-drawer-bag-${SPARE}`).evaluate((e) => (e.parentElement as HTMLDetailsElement).open), false);
    const list = page.locator("#map-drawer-body");
    const scrolled = await list.evaluate((e) => { e.scrollTop = 200; return e.scrollTop; });
    assert.ok(scrolled > 50, `the list scrolls (${scrolled})`);
    await page.waitForTimeout(150);
    writeVault(dir, true, [{ serial: 0x40500300, name: "Pearl 41", in: SUPPLIES }]);
    await page.evaluate(async () => { await (await import("/ui/app.mjs" as string)).reload(); });
    await summaryIs("47 items · 1 loose, 44 in 2 bags");
    assert.ok((await names()).includes("Pearl 41"), "the new item shows");
    assert.equal(await page.locator("#map-drawer-chest").inputValue(), String(UNDER));
    assert.equal(await page.locator("#map-drawer-filter").inputValue(), "pearl");
    assert.equal(await page.locator(`#map-drawer-bag-${SPARE}`).evaluate((e) => (e.parentElement as HTMLDetailsElement).open), false, "the folded bag stays folded");
    assert.equal(await page.locator(`#map-drawer-bag-${SUPPLIES}`).evaluate((e) => (e.parentElement as HTMLDetailsElement).open), true);
    assert.ok(Math.abs(await list.evaluate((e) => e.scrollTop) - scrolled) <= 1, "the scroll is kept");
    assert.equal(await page.evaluate(() => document.activeElement?.id), `map-drawer-bag-${SPARE}`, "focus stays on the folded bag's summary");

    // an item's ⋯ menu: Open details leaves for the Inventory with the item in the peek
    await page.locator(`#map-drawer-item-${0x40500200}`).click();
    await page.getByRole("menuitem", { name: "Open details" }).click();
    await page.waitForFunction(() => location.hash === "#/inventory", undefined, { timeout: 10_000 });
    await page.waitForSelector("#inv-peek:not([hidden]) #peek-title", { timeout: 15_000 });
    assert.equal(await page.locator("#peek-title").textContent(), "Pearl 01");
    assert.deepEqual(errors, []);
  } finally { await done(app, dir); }
});

test("[slow] House map: a stack of up to four chests picks its chest in the drawer by tabs, not a select (1024 × 768)", async (t) => {
  const why = unavailable();
  if (why) return t.skip(why);
  const { dir } = seed();
  const { app, page, errors } = await launch(dir, { want: { width: 1024, height: 768 } });
  try {
    await go(page, `#/map/${COURT}`, `#map-svg [data-stack="${letter(courtModel, 1012, 2013)}"]`);
    await page.locator(`#map-svg [data-stack="${letter(courtModel, 1012, 2013)}"]`).click({ force: true });
    await page.locator(`#map-panel li[data-chest="${YARD_CHEST}"] [data-act="items"]`).click();
    await page.waitForSelector("#map-drawer");
    assert.equal(await page.locator(`#map-drawer [role=radio]#map-drawer-tab-${YARD_CHEST}`).getAttribute("aria-checked"), "true");
    assert.equal(await page.locator("#map-drawer-chest").count(), 0);
    assert.deepEqual(errors, []);
  } finally { await done(app, dir); }
});

test("[slow] House map: in a 1920 × 1000 window the contents drawer is a fourth column and the levels pane stays", async (t) => {
  const why = unavailable();
  if (why) return t.skip(why);
  const { dir } = seed({ items: true });
  const { app, page, size } = await launch(dir, { want: { width: 1920, height: 1000 } });
  try {
    if (size.width < 1920) return t.skip(`this screen fits a window only ${size.width} px wide; the four columns need 1920`);
    await go(page, "#/map", "#map-svg .map-stack");
    await page.locator(`#map-svg [data-stack="${letter(vaultModel, 3001, 1001)}"]`).focus();
    await page.keyboard.press("Enter");
    await page.waitForSelector(`#map-panel li[data-chest="${TOP}"]`);
    const before = (await page.locator("#map-stage").boundingBox())!.width;
    await page.locator(`#map-panel li[data-chest="${TOP}"] [data-act="items"]`).click();
    await page.waitForSelector("#map-drawer .map-item");
    await drawerLayout(page, size.width, before);
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector("#map-body")!).gridTemplateColumns.split(" ").length), 4);
  } finally { await done(app, dir); }
});

test("[slow] House map: a contents drawer row shows the Inventory row's Highlight, Grab, Go to and ⋯ on hover and focus, reachable by Tab, and Highlight queues that item for the bridge", async (t) => {
  const why = unavailable();
  if (why) return t.skip(why);
  const { dir } = seed({ items: true });
  const { bridgeDir, stop } = bridgeOnline(dir);
  const { app, page, errors } = await launch(dir);
  const ARROWS = 0x40500013;
  try {
    await go(page, "#/map", "#map-svg .map-stack");
    await page.waitForFunction(() => document.querySelector("#bridge")?.getAttribute("data-state") === "ready", undefined, { timeout: 15_000 });
    await page.locator(`#map-svg [data-stack="${letter(vaultModel, 3001, 1001)}"]`).focus();
    await page.keyboard.press("Enter");
    await page.locator(`#map-panel li[data-chest="${TOP}"] [data-act="items"]`).click();
    await page.waitForSelector(`#map-drawer-item-${ARROWS}`);
    const row = page.locator("#map-drawer .map-item-row", { has: page.locator(`#map-drawer-item-${ARROWS}`) });
    const acts = row.locator(".map-item-acts");
    assert.equal(await acts.getAttribute("data-no-tip"), "", "aiming at the actions never pops the item tooltip");
    assert.deepEqual(await acts.locator("button").evaluateAll((bs) => bs.map((b) => b.getAttribute("aria-label"))), ["Highlight in game", "Grab to backpack", "Go to container", "More actions"]);
    const opacity = (): Promise<string> => acts.evaluate((e) => getComputedStyle(e).opacity);
    await page.mouse.move(2, 2);
    assert.equal(await opacity(), "0", "hidden until the row is hovered or focused");
    // focus: Tab from the row goes into its actions, which show
    await page.locator(`#map-drawer-item-${ARROWS}`).focus();
    assert.equal(await opacity(), "1");
    await page.keyboard.press("Tab");
    assert.equal(await page.evaluate(() => document.activeElement?.id), `map-drawer-highlight-${ARROWS}`);
    // hover, then Highlight: queued for the bridge with this item
    await row.hover();
    assert.equal(await opacity(), "1");
    await acts.getByRole("button", { name: "Highlight in game" }).click();
    const [one] = await until(() => readQueue(bridgeDir), (l) => l.length === 1, "the highlight queued");
    assert.deepEqual([one!.action, one!.serial, one!.name], ["highlight", ARROWS, "Arrows"]);
    assert.deepEqual(errors, []);
  } finally { stop(); await done(app, dir); }
});
