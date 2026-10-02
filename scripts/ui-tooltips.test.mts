// ui-tooltips.test.mts — [slow]: the item tooltip everywhere an item is shown (issue #10), in the real Electron window at
// 1024 × 768 over the demo scans with both demo chests labelled and a rule that moves the black pearls: an Inventory
// row in the list and in the grouped view, a row with the item peek open, a character sheet slot, a Suit Builder
// piece (the current suit and a result), a House map contents drawer row and an Organize plan move. Each hover must
// show #tip with that item's own name. A screen that draws items without dom.mts's itemTip fails here. Skipped when
// electron or playwright is absent, or under TEST_SKIP_ELECTRON.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { fitWindow, noUpdateCheck, setRows, testEnv } from "./electron-window.mts";
import type { Locator, Page } from "playwright";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const require_ = createRequire(import.meta.url);
function unavailable(): string | null {
  if (process.env.TEST_SKIP_ELECTRON) return "TEST_SKIP_ELECTRON is set";
  for (const dep of ["electron", "playwright"]) {
    try { require_.resolve(dep); } catch { return `${dep} is not installed`; }
  }
  return null;
}
const DORRAN = 0x700c0000, KESTREL = 0x700b0000;
const EMPTY_QUERY = { q: "", slot: [], rarity: "", rarityMin: "", rarityMax: "", kind: [], slayer: "", nogarg: false, med: false, hideTags: [], props: [] };
function seed(): string {
  const dir = mkdtempSync(join(tmpdir(), "packrat-tooltips-"));
  writeFileSync(join(dir, "settings.json"), JSON.stringify({ schemaVersion: 1, shard: "uoalive", setupDone: true }));
  writeFileSync(join(dir, "organize.json"), JSON.stringify({
    version: 1, catchAll: null, pinnedItems: [],
    labels: { [DORRAN]: { serial: DORRAN, name: "Reagents", origin: "manual" }, [KESTREL]: { serial: KESTREL, name: "Jewellery", origin: "manual" } },
    rules: [{ id: "rule-1", name: "Magery reagents", match: { query: EMPTY_QUERY, names: ["black pearl"] }, targets: [DORRAN], origin: "manual" }],
  }));
  return dir;
}
async function go(page: Page, hash: string, ready: string): Promise<void> {
  await page.evaluate((h) => { location.hash = h; }, hash);
  await page.waitForSelector(ready, { timeout: 30_000 });
}
// Hover `target` (from a pointer parked off every item) and check #tip shows the item its data-serial names.
async function tipShows(page: Page, target: Locator, where: string): Promise<void> {
  await page.mouse.move(2, 2);
  await page.waitForFunction(() => getComputedStyle(document.querySelector("#tip")!).display === "none", undefined, { timeout: 5_000 });
  await target.scrollIntoViewIfNeeded();
  const serial = await target.evaluate((e) => e.closest("[data-serial]")?.getAttribute("data-serial") ?? null);
  assert.ok(serial, `${where}: the item carries data-serial`);
  const name = await page.evaluate(async (s) => ((await (await fetch(`/api/items/by-serial?serials=${s}`)).json()) as { items: Record<string, { name: string }> }).items[s]?.name ?? null, serial);
  assert.ok(name, `${where}: ${serial} is a known item`);
  await target.hover();
  await page.waitForFunction(() => getComputedStyle(document.querySelector("#tip")!).display === "block", undefined, { timeout: 10_000 });
  const shown = await page.locator("#tip .tip-name").innerText();
  assert.ok(shown === name || shown.endsWith(` ${name}`), `${where}: the tooltip shows "${shown}", not ${name}`);
  const box = (await page.locator("#tip").boundingBox())!, vp = page.viewportSize() ?? await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= vp.width && box.y + box.height <= vp.height, `${where}: the tooltip is inside the window`);
}

test("[slow] the item tooltip shows on every screen that draws an item: Inventory (list, grouped, with the peek open), a character sheet, the Suit Builder, the House map's contents drawer and the Organize plan (1024 × 768)", async (t) => {
  const why = unavailable();
  if (why) return t.skip(why);
  const dir = seed();
  const { _electron } = await import("playwright");
  const app = await _electron.launch({ args: [ROOT, "--demo", "--data", noUpdateCheck(dir)], cwd: ROOT, timeout: 60_000, env: testEnv() });
  try {
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await fitWindow(app, page, { width: 1024, height: 768 });
    await page.locator("#inv-table tbody tr.item").first().waitFor({ timeout: 30_000 });

    await tipShows(page, page.locator("#inv-table tbody tr.item td:nth-child(2)").first(), "an Inventory row");
    await page.locator("#inv-table tbody tr.item").nth(1).click();
    await page.waitForSelector("#inv-peek:not([hidden])");
    await tipShows(page, page.locator("#inv-table tbody tr.item td:nth-child(2)").nth(3), "an Inventory row with the peek open");
    await page.keyboard.press("Escape");
    await setRows(page, "Grouped");
    await tipShows(page, page.locator("#inv-table tbody tr.item[data-serial] td:first-child").first(), "a grouped Inventory row");
    await setRows(page, "List");

    await go(page, "#/characters/Dorran", "#tab-characters .sheet .slot[data-serial]");
    await tipShows(page, page.locator("#tab-characters .sheet .slot[data-serial]").first(), "a character sheet slot");

    await go(page, "#/builder/Dorran", "#b-current .b-tip");
    await tipShows(page, page.locator("#b-current .b-tip").first(), "the Suit Builder's current suit");
    await page.click("#b-sec-adv .b-sec-head button");
    await page.fill("#b-budget", "2");
    await page.click("#b-run");
    await page.waitForFunction(() => /Best suit for/.test(document.querySelector("#b-result h2")?.textContent || ""), undefined, { timeout: 60_000 });
    await tipShows(page, page.locator("#b-result .b-tip").first(), "a Suit Builder result piece");

    await go(page, "#/map", "#map-svg .map-stack");
    await page.locator("#map-svg .map-stack").first().focus();
    await page.keyboard.press("Enter");
    await page.locator("#map-panel [data-act=items]:not([disabled])").first().click();
    await page.waitForSelector("#map-drawer .map-item");
    await tipShows(page, page.locator("#map-drawer .map-item").first(), "a House map contents drawer row");

    await go(page, "#/organize", "#org-plan .org-trip > summary");
    await page.locator("#org-plan .org-trip > summary").first().click();
    await tipShows(page, page.locator("#org-plan .org-move").first(), "an Organize plan move");
    assert.deepEqual(errors, []);
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});

test("[slow] the item tooltip hides on Esc and on a scroll, follows keyboard focus with aria-describedby, and gives way to a character sheet slot's own pop", async (t) => {
  const why = unavailable();
  if (why) return t.skip(why);
  const dir = seed();
  const { _electron } = await import("playwright");
  const app = await _electron.launch({ args: [ROOT, "--demo", "--data", noUpdateCheck(dir)], cwd: ROOT, timeout: 60_000, env: testEnv() });
  const shown = (page: Page): Promise<boolean> => page.evaluate(() => getComputedStyle(document.querySelector("#tip")!).display === "block");
  try {
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await fitWindow(app, page, { width: 1024, height: 768 });
    await page.locator("#inv-table tbody tr.item").first().waitFor({ timeout: 30_000 });
    // Esc hides it (on the Inventory: in the House map's drawer Esc closes the drawer too)
    await tipShows(page, page.locator("#inv-table tbody tr.item td:nth-child(2)").first(), "an Inventory row");
    await page.keyboard.press("Escape");
    assert.equal(await shown(page), false, "Esc hides it");
    await go(page, "#/map", "#map-svg .map-stack");
    await page.locator("#map-svg .map-stack").first().focus();
    await page.keyboard.press("Enter");
    await page.locator("#map-panel [data-act=items]:not([disabled])").first().click();
    await page.waitForSelector("#map-drawer .map-item");
    // a scroll hides it
    await tipShows(page, page.locator("#map-drawer .map-item").first(), "a drawer row");
    await page.locator("#map-drawer-body").dispatchEvent("scroll");
    assert.equal(await shown(page), false, "a scroll hides it");
    // keyboard focus: shown after 400 ms with aria-describedby, gone on blur
    await page.mouse.move(2, 2);
    await page.locator("#map-drawer-filter").focus();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");   // past Open in Inventory, onto the first row
    const focused = page.locator("#map-drawer .map-item:focus");
    await focused.waitFor();
    await page.waitForFunction(() => getComputedStyle(document.querySelector("#tip")!).display === "block", undefined, { timeout: 5_000 });
    assert.equal(await focused.getAttribute("aria-describedby"), "tip");
    await page.keyboard.press("Tab");
    assert.equal(await shown(page), false);
    assert.equal(await page.locator("#map-drawer .map-item").first().getAttribute("aria-describedby"), null);
    // a character sheet slot's pop and the hover tooltip never show together
    await go(page, "#/characters/Dorran", "#tab-characters .sheet .slot[data-serial]");
    const slot = page.locator("#tab-characters .sheet .slot[data-serial]").first();
    await slot.click();
    await page.waitForSelector(".item-pop");
    await page.mouse.move(2, 2);
    await slot.hover();
    await page.waitForTimeout(700);
    assert.equal(await shown(page), false, "no hover tooltip while the slot's pop is open");
    assert.deepEqual(errors, []);
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});
