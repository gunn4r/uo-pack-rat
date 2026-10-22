#!/usr/bin/env node
// readme-shots.mts — the README's screenshots and GIFs (docs/images/), taken from the demo characters in headless Chromium.
//   npm run readme:shots            every image
//   npm run readme:shots -- house   only the images whose name starts with one of the words given
//
// The demo data, the server and the capture helpers are scripts/shots-lib.mts, shared with the website's shots (scripts/site-shots.mts). Stills are 1280 × 800 at 2x; GIFs are recorded at 1280 × 800 and turned into 15 fps, 960 px wide GIFs by ffmpeg (skipped, saying so, when ffmpeg is not on the PATH). Never the Electron app. Item icons and the paperdoll come from PACKRAT_SHOTS_UO=<UO folder> (see shots-lib.mts). Only the PNGs and GIFs written to docs/images/ are ever committed (scripts/no-game-art.test.mts fails on a client file or decoded art).
//
// map: tooling
// owns: the README's screenshots and GIFs
import { mkdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Browser, Page } from "playwright";
import { buildUi } from "./build-ui.mts";
import { ROOT, SIZE, cleanup, go, launchBrowser, pause, recordGif, serve, typeSlowly, withPage } from "./shots-lib.mts";

const OUT = join(ROOT, "docs", "images");
const only = process.argv.slice(2);
const wanted = (name: string): boolean => only.length === 0 || only.some((w) => name.startsWith(w));
function report(file: string): void {
  console.log(`${file}  ${Math.round(statSync(join(OUT, file)).size / 1024)} KB`);
}
// A still in docs/images/: the page at 2x (see withPage for `size` and `keep`).
async function still(browser: Browser, name: string, shoot: (page: Page) => Promise<void>, opts: { size?: { width: number; height: number }; keep?: boolean } = {}): Promise<void> {
  if (!wanted(name)) return;
  await withPage(browser, shoot, (page) => page.screenshot({ path: join(OUT, `${name}.png`) }), opts);
  report(`${name}.png`);
}
async function gif(browser: Browser, url: string, name: string, hash: string, ready: string, act: (page: Page) => Promise<void>): Promise<void> {
  if (!wanted(name)) return;
  if (await recordGif(browser, url, join(OUT, `${name}.gif`), hash, ready, act)) report(`${name}.gif`);
}

mkdirSync(OUT, { recursive: true });
buildUi();   // the server serves app/dist/, so the shots show the page as the source has it now
const browser = await launchBrowser();
try {
  const url = await serve(true);
  await still(browser, "inventory", async (page) => {
    await go(page, url, "inventory", "#inv-table tbody tr.item");
    await page.fill("#f-text", "ring");
    await pause(page, 800);
    await page.locator("#inv-table tbody tr.item").nth(2).click();
    await page.waitForSelector("#inv-peek:not([hidden])");
    await pause(page, 600);
  });
  await gif(browser, url, "inventory-search", "inventory", "#inv-table tbody tr.item", async (page) => {
    await pause(page, 800);
    await typeSlowly(page, "#f-text", "hit chance");
    await pause(page, 1200);
    await page.locator("#inv-table tbody tr.item").nth(1).click();
    await page.waitForSelector("#inv-peek:not([hidden])");
    await page.mouse.move(SIZE.width - 2, SIZE.height - 2);
    await pause(page, 2500);
  });
  // The property rule: the catalogue with its counts, ≠, and the note on items without the property.
  await still(browser, "inventory-filters", async (page) => {
    await go(page, url, "inventory", "#inv-table tbody tr.item");
    await page.click("#f-add");
    await page.getByRole("menuitem", { name: "Property rule…" }).click();
    await page.locator(".pop .inv-prop-list").getByText("Faster Casting", { exact: true }).first().click();
    await page.locator('.pop [role=radio][data-value="ne"]').click();
    await page.locator(".pop input[type=number]").fill("-1");
    await pause(page, 600);
  }, { keep: true });
  await still(browser, "characters", async (page) => {
    await go(page, url, "characters/Dorran", "#tab-characters:not([hidden])");
  }, { size: { width: 1280, height: 1000 } });
  // The House map on its own server: the house's synthetic tiles, the real art beside them. The still is zoomed in a wheel
  // step, so the house fills the map.
  const mapUrl = await serve(true, true);
  await still(browser, "house-map", async (page) => {
    await go(page, mapUrl, "map", "#tab-map:not([hidden]) svg");
    const box = (await page.locator("#map-svg").boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, -100);   // one wheel step in about the centre: 1.15x, the corners just in view
    await pause(page, 600);
  });
  await gif(browser, mapUrl, "house-map-search", "map", "#tab-map:not([hidden]) svg", async (page) => {
    await pause(page, 1000);
    await typeSlowly(page, "#map-search input", "katana");
    await page.keyboard.press("Enter");
    await pause(page, 2500);
    await page.locator('#map-view [data-value="top"]').click();
    await pause(page, 2000);
  });
  await still(browser, "unravel", async (page) => {
    await go(page, url, "unravel", ".unr-row");
  });

  // Organize on the demo chests alone (the house's empty chests would fill the proposal).
  const plain = await serve(false);
  await gif(browser, plain, "organize", "organize", "#tab-organize:not([hidden]) #org-auto", async (page) => {
    await pause(page, 800);
    await page.click("#org-auto");
    await page.waitForSelector('#auto-drawer:not([hidden]) #auto-proposal[aria-busy="false"] #auto-headline');
    await pause(page, 1200);
    await page.locator("#auto-headline").scrollIntoViewIfNeeded();
    await pause(page, 2000);
    await page.click("#auto-accept");
    await page.waitForSelector("#org-plan #org-headline", { timeout: 30_000 });
    await pause(page, 3000);
  });
  await still(browser, "organize", async (page) => {
    await go(page, plain, "organize", "#org-plan #org-headline");
  });
  // A rule with the Inventory's filter bar: Type Shield and Faster Casting ≠ -1, its tokens and the note under them.
  await still(browser, "organize-rule", async (page) => {
    await go(page, plain, "organize", "#org-add");
    await page.click("#org-add");
    await page.getByRole("menuitem", { name: "Blank rule" }).click();
    await page.waitForSelector("#rule-drawer:not([hidden]) #rule-name");
    await page.fill("#rule-name", "Shields without an FC penalty");
    await page.click("#rule-f-type");
    await page.locator(".pop label").filter({ hasText: /^Shield/ }).first().click();
    await page.keyboard.press("Escape");
    await page.click("#rule-f-add");
    await page.getByRole("menuitem", { name: "Property rule…" }).click();
    await page.locator(".pop .inv-prop-list").getByText("Faster Casting", { exact: true }).first().click();
    await page.locator('.pop [role=radio][data-value="ne"]').click();
    await page.locator(".pop input[type=number]").fill("-1");
    await page.getByRole("button", { name: "Add rule" }).click();
    await page.waitForSelector("#rule-drawer .rule-missing");
    await pause(page, 1200);   // the live count lands
    // The drawer from its top, its name in view, however far adding the filters scrolled it.
    await page.locator("#rule-drawer").evaluate((d) => { for (const el of [d, ...d.querySelectorAll("*")]) if (el.scrollTop) el.scrollTop = 0; });
  });
  // Each build on a server of its own: a second build of the same settings would show the first as a saved run.
  let fresh = await serve(true);
  await still(browser, "suit-builder", async (page) => {
    await go(page, fresh, "builder", "#b-run");
    await page.click("#b-run");
    await page.waitForSelector("#b-result .b-head-card", { timeout: 120_000 });
    await pause(page, 800);
  });
  fresh = await serve(true);
  await gif(browser, fresh, "suit-builder", "builder", "#b-run", async (page) => {
    await pause(page, 1200);
    await page.click("#b-run");
    await page.waitForSelector("#b-result .b-head-card", { timeout: 120_000 });
    await pause(page, 1500);
    await page.locator(".b-results").evaluate((e) => e.scrollBy({ top: 500, behavior: "smooth" }));
    await pause(page, 2500);
  });
  // Manual: the live doll previewing a ring, the picker narrowed to what Auto would use. 1440 px wide, where the doll has
  // its own column (narrower, it folds into a band over the picker).
  await still(browser, "manual", async (page) => {
    await go(page, url, "builder", "#b-run");
    await page.click('#b-mode [data-value="manual"]');
    await page.waitForSelector("#b-manual:not([hidden]) #mb-suit .mb-slot");
    await page.click('.mb-slot-pick[data-slot="ring"]');
    await page.waitForSelector("#mb-picker:not([hidden]) tbody tr.item");
    await page.locator("#mb-auto-only").check();
    await pause(page, 1200);
    await page.locator("#mb-picker tbody tr.item").nth(2).hover();
    await page.waitForFunction(() => document.querySelector("#mb-doll-card .doll-pill")?.textContent?.startsWith("Preview"));
    await pause(page, 1500);   // the previewed figure loads
  }, { size: { width: 1440, height: 900 }, keep: true });
} finally {
  await browser.close();
  await cleanup();
}
