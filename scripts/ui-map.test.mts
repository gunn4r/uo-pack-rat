// ui-map.test.mts — [slow]: the House map (issue #10) in the real Electron window over a seeded data folder (the dense vault and the courtyard house of app/house-fixture.mts, their chests from app/organize-fixture.mts, a synthetic tiledata.mul behind a fake TazUO launcher): the nav entry, the picker and level pills, a stale deep link, the no-tiledata note, the drawing in both views, callouts, selection, cut-away, keyboard (and a walk of the screen by keyboard alone that keeps focus through every redraw), pan and zoom, the detail panel's actions, the colour modes, a chest no scan opened, the plain grid over the demo scans, the empty state, the Settings UO folder card, the 1000 × 700 layout and contrast in both theme families. Skipped when electron or playwright is absent, or under TEST_SKIP_ELECTRON.
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

// A data folder with both houses captured: the vault's 120 chests (chest i holds (13·i) % 126 of 125 items, the first one labelled Reagents in teal), the courtyard with a chest in the yard and one the capture saw but no scan opened; with `castle`, also the 4-level castle and its 300 chests (another character's scan, the speed check); the synthetic tiledata.mul behind a fake TazUO launcher, which settings.json points at unless `client` is false.
function seed({ client = true, castle = false }: { client?: boolean; castle?: boolean } = {}): { dir: string; uo: string } {
  const dir = mkdtempSync(join(tmpdir(), "packrat-map-"));
  mkdirSync(join(dir, "scans"), { recursive: true });
  const { house: vault, chests } = vaultHouse();
  const v = houseScan({ scannedAt: vault.capturedAt, boxes: chests.map((c, i) => ({ serial: c.serial, name: c.name, pos: { x: c.x, y: c.y, z: c.z, facet: 1 }, count: (i * 13) % 126 })), things: [] });
  writeFileSync(join(dir, "scans", "vault.json"), JSON.stringify({ ...v, house: { facet: 1, capturedAt: vault.capturedAt, at: { x: 3003, y: 1003 }, tiles: vault.tiles, items: vault.items } }));
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
test("[slow] House map: the keyboard alone walks the screen, and focus stays put through a level, a room, a selection, a reload and Esc from the panel", async (t) => {
  const why = unavailable();
  if (why) return t.skip(why);
  const { dir } = seed();
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

    const room = '.map-room[data-room="0"]';
    await tabTo(page, room);
    await page.keyboard.press("Enter");
    assert.equal(await page.locator(room).getAttribute("aria-pressed"), "true");
    assert.ok(await focused(page, room), "focus stays on the room");

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

test("[slow] House map: ✎ renames a house (Esc cancels; Enter saves, and the heading, picker, crumb and page title follow with focus back on ✎), and a redesigned house is offered an earlier house's name", async (t) => {
  const why = unavailable();
  if (why) return t.skip(why);
  const { dir } = seed();
  // A named house no longer captured, whose footprint overlaps the courtyard's (not the vault's).
  writeFileSync(join(dir, "house-map.json"), JSON.stringify({ version: 1, houses: { "1-1010-2010": { name: "Old courtyard", bounds: { x0: 1010, y0: 2010, x1: 1027, y1: 2027, facet: 1 } } } }));
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
    assert.match(await page.locator("#map-carry").textContent() || "", /^Use the name "Old courtyard" from the earlier house here\?Use name$/);
    await page.locator("#map-carry-use").click();
    await page.waitForFunction(() => document.querySelector("#map-panel .map-house-title h2")?.textContent === "Old courtyard", undefined, { timeout: 15_000 });
    assert.equal(await page.locator("#map-carry").count(), 0, "the offer goes once the house is named");
    assert.match(await page.locator(`#map-house option[value="${COURT}"]`).textContent() || "", /^Old courtyard · Trammel, \d+ × \d+, \d+ containers?$/);
    await go(page, "#/inventory", "#tab-inventory:not([hidden])");
    assert.equal(await page.title(), "Pack Rat", "another screen puts the page title back");
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

test("[slow] House map: every text, control edge and icon passes contrast on the map, a selected stack, a callout, the no-tiledata note and the empty state, in both theme families light and dark; at 1000 × 700 the panes stack and nothing scrolls sideways", async (t) => {
  const why = unavailable();
  if (why) return t.skip(why);
  const rows: Array<ContrastRow & { where: string }> = [];
  const { dir } = seed();
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
