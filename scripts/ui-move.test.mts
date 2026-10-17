// ui-move.test.mts — [slow]: the Inventory's selection, Move to and Move back (issue #270) in the real Electron window.
//
// `[slow]`: the Inventory's selection, Move to and Move back (issue #270) in the real Electron window, over a house scan written into a temp `--data` folder's `scans/` (`app/organize-fixture.mts`: 590 gems in a labeled chest, an empty labeled chest with room for 3 beside it, two rings and a worn one) with an Organize rule filing gems in the first chest, and a stand-in bridge that answers every trip as done: shift-click ticking a range, a worn row locked with its reason and left out of a range by name, the selection surviving a filter change, the header ticking the 500 rows loaded and then "Select all 590 matching", the picker's room line and "Move the 3 that fit", the trips running through the bridge's queue, the result naming the 2 that did not fit and the Organize rule that would take the 3 out again, the rows showing their new place at once, Pin them here pinning them in organize.json, and Move back returning them to the chest they came from. Then the bar and the picker at 420 × 860 with nothing scrolling sideways, in light and dark.
//
// Skipped when electron or playwright is absent, or under TEST_SKIP_ELECTRON.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { fitWindow, type RealSize, testEnv, noUpdateCheck, completeLines, removeTempDir } from "./electron-window.mts";
import { houseScan } from "../app/organize-fixture.mts";
import type { ElectronApplication, Page } from "playwright";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const require_ = createRequire(import.meta.url);
const GEMS = 0x40000001, SPARE = 0x40000002, WORN = 0x40009001;
const GEM_COUNT = 590;
function unavailable(): string | null {
  if (process.env.TEST_SKIP_ELECTRON) return "TEST_SKIP_ELECTRON is set";
  for (const dep of ["electron", "playwright"]) {
    try { require_.resolve(dep); } catch { return `${dep} is not installed`; }
  }
  return null;
}
// The house: the gems' chest, a chest beside it with room for 3, two rings in it and one worn; Organize files gems in the first.
function dataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "packrat-move-"));
  writeFileSync(join(dir, "settings.json"), JSON.stringify({ schemaVersion: 1, shard: "uoalive", setupDone: true }));
  mkdirSync(join(dir, "scans"), { recursive: true });
  const scan = houseScan({
    scannedAt: new Date(Date.now() - 3600e3).toISOString(),
    boxes: [{ serial: GEMS, name: "Metal Chest", pos: { x: 1000, y: 1000, z: 0, facet: 1 }, max: 1000 }, { serial: SPARE, name: "Wooden Chest", pos: { x: 1002, y: 1000, z: 0, facet: 1 }, max: 3 }],
    things: [...Array.from({ length: GEM_COUNT }, (_, i) => ({ serial: 0x40001000 + i, name: `Gem ${String(i).padStart(3, "0")}`, in: GEMS })),
      { serial: 0x40008001, name: "Gold Ring", in: GEMS }, { serial: 0x40008002, name: "Topaz Ring", in: GEMS }],
  }) as unknown as { equipped: unknown[] };
  scan.equipped = [{ serial: WORN, nameSource: "opl", name: "Silver Ring", layer: "Ring", tooltip: ["Silver Ring"] }];
  writeFileSync(join(dir, "scans", "house.json"), JSON.stringify(scan));
  writeFileSync(join(dir, "organize.json"), JSON.stringify({ version: 1, catchAll: null, pinnedItems: [],
    labels: { [GEMS]: { serial: GEMS, name: "Jewel Chest", origin: "manual" }, [SPARE]: { serial: SPARE, name: "Spare Chest", origin: "manual" } },
    rules: [{ id: "gems", name: "Gems", match: { query: { q: "", slot: [], rarity: "", rarityMin: "", rarityMax: "", kind: [], slayer: "", nogarg: false, med: false, hideTags: [], props: [] }, names: ["gem"] }, targets: [GEMS], origin: "manual" }] }));
  return dir;
}
// The bridge, as far as the page can tell: a status file refreshed every half second that answers each queued trip, a second later, with every step done.
function standInBridge(dir: string): { stop: () => void; trips: () => Array<{ id: string; puts: Array<{ serial: number; dest: number[] }> }> } {
  const bridgeDir = join(dir, "bridge", "tazuo");
  mkdirSync(bridgeDir, { recursive: true });
  const results: Record<string, unknown> = {}, seen = new Set<string>();
  const trips = () => completeLines(join(bridgeDir, "queue.jsonl")).map((l) => JSON.parse(l) as { id: string; action: string; takes: Array<{ serial: number }>; puts: Array<{ serial: number; dest: number[] }> }).filter((c) => c.action === "trip");
  const tick = (): void => {
    for (const c of trips()) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      setTimeout(() => { results[c.id] = { ok: true, msg: "trip done", t: new Date().toISOString(), partial: false, stopped: false, steps: [...c.takes.map((t) => ({ op: "take", serial: t.serial, ok: true, msg: "took" })), ...c.puts.map((p) => ({ op: "put", serial: p.serial, ok: true, msg: "put" }))] }; }, 1000).unref();
    }
    writeFileSync(join(bridgeDir, "status.json"), JSON.stringify({ alive: new Date().toISOString(), character: "Tester", current: null, counts: { done: 0, failed: 0 }, results }));
  };
  tick();
  const timer = setInterval(tick, 500).unref();
  return { stop: () => clearInterval(timer), trips };
}
async function launch(dir: string, want: RealSize, scheme: "light" | "dark" = "light"): Promise<{ app: ElectronApplication; page: Page; errors: string[] }> {
  const { _electron } = await import("playwright");
  const app = await _electron.launch({ args: [ROOT, "--data", noUpdateCheck(dir)], cwd: ROOT, timeout: 60_000, env: testEnv() });
  try {
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.emulateMedia({ colorScheme: scheme });
    await fitWindow(app, page, want);
    await page.locator("#inv-table tbody tr.item").first().waitFor({ timeout: 30_000 });
    return { app, page, errors };
  } catch (e) {
    await app.close();
    throw e;
  }
}
async function until<T>(read: () => T | Promise<T>, ok: (v: T) => boolean, what: string): Promise<T> {
  const end = Date.now() + 20_000;
  let v = await read();
  while (!ok(v)) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}: ${JSON.stringify(v)}`);
    await new Promise((r) => setTimeout(r, 100));
    v = await read();
  }
  return v;
}
async function search(page: Page, q: string): Promise<void> {
  await page.fill("#f-text", q);
  // The search applies after a debounce; the rows can already match (gems sort first), so wait for the filter itself, then its rows.
  await until(() => page.locator("#inv-active").innerText().catch(() => ""), (t) => t.toLowerCase().includes(`search: ${q}`), `the search "${q}" applied`);
  await until(() => page.locator("#inv-table tbody tr.item").first().innerText(), (t) => t.toLowerCase().includes(q), `rows matching "${q}"`);
}
const box = (page: Page, n: number) => page.locator("#inv-table tbody tr.item").nth(n).locator("input.sel-cb");
const barText = (page: Page) => page.locator("#inv-selbar").innerText();

test("[slow] select rows, Move to a container that holds only some, then Pin them and Move back", async (t) => {
  const why = unavailable();
  if (why) return t.skip(why);
  const dir = dataDir(), bridge = standInBridge(dir);
  const { app, page, errors } = await launch(dir, { width: 1440, height: 900 });
  try {
    // A worn row is locked and says why; a range over it leaves it out by name.
    await search(page, "ring");
    const worn = page.locator(`#inv-table tbody tr.item[data-serial="${WORN}"]`);
    assert.equal(await worn.locator("input.sel-cb").count(), 0);
    assert.equal(await worn.locator(".sel-lock").getAttribute("title"), "Worn: take it off first");
    await box(page, 0).click();
    await page.locator("#inv-table tbody tr.item").nth(2).locator("input.sel-cb").click({ modifiers: ["Shift"] });
    assert.match(await barText(page), /2 items selected[\s\S]*Left out Silver Ring: it's worn\. Take it off in game to move it\./);
    // The selection survives a filter change.
    await search(page, "gem");
    await box(page, 0).click();
    assert.match(await barText(page), /3 items selected/);
    await page.click("#mv-clear");
    assert.equal(await page.locator("#inv-selbar").isHidden(), true);

    // The header ticks the 500 rows loaded; the next step takes every match, counted by the server.
    await page.locator("#inv-table thead input.sel-cb").click();
    assert.match(await barText(page), /500 items selected[\s\S]*The 500 items shown are selected\./);
    await page.click("#mv-select-all");
    await until(() => barText(page), (s) => s.includes(`${GEM_COUNT} items selected`), "every match selected");
    assert.match(await barText(page), new RegExp(`All ${GEM_COUNT} items matching the filter are selected`));
    await page.click("#mv-clear");

    // Five gems into a chest with room for three.
    await box(page, 0).click();
    await box(page, 4).click({ modifiers: ["Shift"] });
    await page.click("#mv-move");
    const spare = page.locator(`.mv-dest[data-serial="${SPARE}"]`);
    await spare.waitFor();
    assert.match(await spare.innerText(), /Spare Chest[\s\S]*0\/3 items[\s\S]*Room for 3/);
    await spare.click();
    await until(() => page.locator("#mv-go").innerText(), (s) => s === "Move the 3 that fit", "the partial-fit button");
    assert.match(await page.locator(".mv-msg").innerText(), /Spare Chest has room for 3 of 5\. The other 2 stay where they are\./);
    await page.click("#mv-go");
    assert.equal(await page.locator("#inv-selbar").isHidden(), true, "the selection clears once the move is queued");
    const result = page.locator("#inv-move-result");
    await until(() => result.innerText(), (s) => /Moved 3 items to Spare Chest\. 2 didn't fit and stayed put\./.test(s), "the move's result");
    assert.match(await result.innerText(), /3 of these go back on the next Organize run, because a rule files them in Jewel Chest\./);
    assert.deepEqual(bridge.trips().map((c) => c.puts.map((p) => p.dest)), [[[SPARE], [SPARE], [SPARE]]]);
    const moved = bridge.trips()[0]!.puts.map((p) => p.serial);
    // The rows show where the items went without a rescan.
    await until(() => page.locator(`#inv-table tbody tr.item[data-serial="${moved[0]}"]`).innerText(), (s) => s.includes("Spare Chest"), "the row's new place");

    await page.click("#mv-pin");
    await until(() => (JSON.parse(readFileSync(join(dir, "organize.json"), "utf8")) as { pinnedItems: number[] }).pinnedItems, (p) => moved.every((s) => p.includes(s)), "the moved gems pinned");
    await until(() => result.innerText(), (s) => s.includes("Pinned in Spare Chest. Organize will leave them there."), "the pin noted");

    await page.locator("#mv-back").click();
    await until(() => bridge.trips().length, (n) => n === 2, "the Move back trip");
    assert.deepEqual(bridge.trips()[1]!.puts.map((p) => [p.serial, p.dest]), moved.map((s) => [s, [GEMS]]));
    await until(() => result.innerText(), (s) => /Moved 3 items back to where each one came from\./.test(s), "Move back's result");
    assert.deepEqual(errors, []);
  } finally {
    bridge.stop();
    await app.close();
    removeTempDir(dir);
  }
});

for (const scheme of ["light", "dark"] as const) {
  test(`[slow] at 420 × 860 (${scheme}) the selection bar and the picker fit with nothing scrolling sideways`, async (t) => {
    const why = unavailable();
    if (why) return t.skip(why);
    const dir = dataDir(), bridge = standInBridge(dir);
    const { app, page, errors } = await launch(dir, { width: 420, height: 860 }, scheme);
    const sideways = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    try {
      await search(page, "gem");
      await box(page, 0).click();
      await box(page, 2).click({ modifiers: ["Shift"] });
      assert.match(await barText(page), /3 items selected/);
      assert.equal(await page.locator("#mv-move").isVisible(), true);
      assert.equal(await sideways(), 0);
      await page.click("#mv-move");
      await page.locator(`.mv-dest[data-serial="${SPARE}"]`).click();
      await until(() => page.locator("#mv-go").innerText(), (s) => s === "Move 3 items", "the Move button");
      assert.equal(await sideways(), 0);
      assert.deepEqual(errors, []);
    } finally {
      bridge.stop();
      await app.close();
      removeTempDir(dir);
    }
  });
}
