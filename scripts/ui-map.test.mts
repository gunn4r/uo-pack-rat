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
import { vaultHouse, courtyardHouse, castleHouse, fixtureTileData, FIXTURE_TILES } from "../app/house-fixture.mts";
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

const readQueue = (d: string): Array<{ action: string; serial: number; name: string; chain: number[]; pos: Record<string, number> | null }> => {
  try { return readFileSync(join(d, "queue.jsonl"), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; }
};

test("[slow] House map: the panel lists a vault stack top first with its label, Highlight queues for the bridge, Free space changes the legend, Label… opens, a label colour keeps its edge, a reload keeps the selection, and a chest no scan opened highlights by its place and cannot be labelled", async (t) => {
  const why = unavailable();
  if (why) return t.skip(why);
  const { dir } = seed();
  const bridgeDir = join(dir, "bridge", "tazuo");
  mkdirSync(bridgeDir, { recursive: true });
  const writeStatus = (): void => writeFileSync(join(bridgeDir, "status.json"), JSON.stringify({ alive: new Date().toISOString(), character: "Tester", current: null, counts: { done: 0, failed: 0 }, results: {} }));
  writeStatus();
  const alive = setInterval(writeStatus, 1000);
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
    clearInterval(alive);
    await done(app, dir);
  }
});

test("[slow] House map: Highlight the stack queues one highlight per chest top first, each by its scanned place or, for a chest no scan opened, by the place its capture saw it", async (t) => {
  const why = unavailable();
  if (why) return t.skip(why);
  const { dir } = seed();
  const bridgeDir = join(dir, "bridge", "tazuo");
  mkdirSync(bridgeDir, { recursive: true });
  const writeStatus = (): void => writeFileSync(join(bridgeDir, "status.json"), JSON.stringify({ alive: new Date().toISOString(), character: "Tester", current: null, counts: { done: 0, failed: 0 }, results: {} }));
  writeStatus();
  const alive = setInterval(writeStatus, 1000);
  const { app, page, errors } = await launch(dir);
  try {
    await go(page, "#/map", "#map-svg .map-stack");
    await page.waitForFunction(() => document.querySelector("#bridge")?.getAttribute("data-state") === "ready", undefined, { timeout: 15_000 });
    const back = letter(vaultModel, 3001, 1001), stack = vaultModel.stacks.find((s) => s.letter === back)!, top = [...stack.serials].reverse();
    await page.locator(`#map-svg [data-stack="${back}"]`).focus();
    await page.keyboard.press("Enter");
    await page.waitForSelector("#map-highlight-stack:not([disabled])");
    assert.equal((await page.locator("#map-highlight-stack").textContent())?.trim(), "Highlight the stack");
    await page.locator("#map-highlight-stack").click();
    const lines = await until(() => readQueue(bridgeDir), (l) => l.length === 5, "the stack's highlights queued");
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
    clearInterval(alive);
    await done(app, dir);
  }
});
