#!/usr/bin/env node
// site-shots.mts — the website's screenshots (site/img/), taken from the demo characters in headless Chromium: each one a crop of a screen, in the Britannia theme dark (`<name>.webp`) and the Default theme light (`<name>-light.webp`), which the page swaps with its own light and dark.
//   npm run site:shots              every image
//   npm run site:shots -- suit      only the images whose name starts with one of the words given
//
// It shares the README's demo data, server and helpers (scripts/shots-lib.mts). Each screen is shot at 2x, cropped to the part the page shows and saved as WebP by the browser's own encoder (a canvas), so no image tool is needed. It also draws the page's share image (`og.png`, 1200 × 630) from the logo, the headline and the Inventory crop. Item icons and the paperdoll come from PACKRAT_SHOTS_UO=<UO folder>, read only while capturing; the crops are screenshots, like docs/images/, and scripts/no-game-art.test.mts holds site/img/ to WebP screenshots at least 800 px wide. Never the Electron app.
//
// map: tooling
// owns: the website's screenshots
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Browser, Page } from "playwright";
import { buildUi } from "./build-ui.mts";
import { ROOT, cleanup, go, launchBrowser, pause, serve, withPage } from "./shots-lib.mts";

const OUT = join(ROOT, "site", "img");
const only = process.argv.slice(2);
const wanted = (name: string): boolean => only.length === 0 || only.some((w) => name.startsWith(w));

// The two looks every crop is taken in: the file name's suffix, the theme family and mode on <html> (ui/theme.mts).
interface Look { suffix: string; theme: string; mode: string }
const DARK: Look = { suffix: "", theme: "britannia", mode: "dark" }, LIGHT: Look = { suffix: "-light", theme: "default", mode: "light" };
const LOOKS = [DARK, LIGHT];
// A crop in CSS pixels of the page, and the width of the saved image (at most 1600 px; the crop is shot at 2x).
interface Crop { x: number; y: number; w: number; h: number; out?: number }

async function setLook(page: Page, look: Look): Promise<void> {
  await page.evaluate(([t, m]) => { document.documentElement.dataset.theme = t!; document.documentElement.dataset.mode = m!; document.dispatchEvent(new Event("themechange")); }, [look.theme, look.mode]);
  // The app's own faces, loaded before the picture: a shot taken while one is still on its way shows the fallback face.
  await page.evaluate(async () => {
    await Promise.all(["400", "500", "600"].map((w) => document.fonts.load(`${w} 13px "IBM Plex Sans"`)).concat(document.fonts.load('13px "IBM Plex Mono"'), document.fonts.load('600 16px "Cinzel"')));
    await document.fonts.ready;
  });
  await pause(page, 500);   // sleep: the theme's colors and frames settle
}

// A PNG made WebP by the browser: drawn on a canvas `width` px wide and encoded at quality 0.84.
async function toWebp(page: Page, png: Buffer, width: number): Promise<Buffer> {
  const b64 = await page.evaluate(async ({ src, width }) => {
    const img = new Image();
    img.src = src;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = Math.round(img.height * width / img.width);
    const g = canvas.getContext("2d")!;
    g.imageSmoothingQuality = "high";
    g.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/webp", 0.84).split(",")[1]!;
  }, { src: `data:image/png;base64,${png.toString("base64")}`, width });
  return Buffer.from(b64, "base64");
}

// One crop of a screen in the given looks: `open` gives a fresh server's URL for each (a build or an Accept changes the
// data, so those screens take a server of their own), `shoot` brings the page to the screen.
async function crop(browser: Browser, name: string, looks: readonly Look[], open: () => Promise<string>, shoot: (page: Page, url: string) => Promise<void>, c: Crop, opts: { size?: { width: number; height: number }; keep?: boolean } = {}): Promise<void> {
  for (const look of looks) {
    const file = `${name}${look.suffix}.webp`;
    if (!wanted(file)) continue;
    const url = await open();
    const webp = await withPage(browser, async (page) => { await shoot(page, url); await setLook(page, look); }, async (page) => {
      const png = await page.screenshot({ clip: { x: c.x, y: c.y, width: c.w, height: c.h } });
      return toWebp(page, png, c.out ?? Math.min(1600, c.w * 2));
    }, opts);
    writeFileSync(join(OUT, file), webp);
    console.log(`${file}  ${Math.round(statSync(join(OUT, file)).size / 1024)} KB`);
  }
}

// The share image (og:image): the page's own colors, fonts, logo and headline beside the Inventory crop, 1200 × 630.
async function shareImage(browser: Browser): Promise<void> {
  const data = (path: string, type: string): string => `data:${type};base64,${readFileSync(join(ROOT, path)).toString("base64")}`;
  const face = (family: string, file: string, weight: string, style = "normal"): string => `@font-face { font-family: "${family}"; font-style: ${style}; font-weight: ${weight}; src: url("${data(`site/fonts/${file}`, "font/woff2")}"); }`;
  const html = `<style>
    ${face("Cormorant Garamond", "cormorant-garamond-latin-500-600-normal.woff2", "500 600")}
    ${face("Cormorant Garamond", "cormorant-garamond-latin-500-italic.woff2", "500", "italic")}
    ${face("Alegreya Sans", "alegreya-sans-latin-400-normal.woff2", "400")}
    body { margin: 0; width: 1200px; height: 630px; background: #140f0a; color: #f4ead2; font-family: "Alegreya Sans", sans-serif; overflow: hidden; position: relative; }
    .copy { position: absolute; left: 72px; top: 92px; width: 520px; }
    .copy img { width: 112px; height: 112px; filter: drop-shadow(0 18px 30px rgb(216 177 85 / .3)); }
    h1 { font: 500 76px/0.98 "Cormorant Garamond", serif; margin: 34px 0 22px; }
    h1 em { display: block; font-style: italic; color: #b49e78; }
    p { font-size: 26px; color: #dccba7; margin: 0; }
    .shot { position: absolute; left: 640px; top: 70px; width: 760px; border-radius: 6px; box-shadow: 0 0 0 1px #46341f, 0 0 0 7px #1f170f, 0 0 0 8px #46341f, 0 40px 80px -30px #000; }
  </style>
  <div class="copy"><img src="${data("app/assets/icon.png", "image/png")}"><h1>Stop opening chests. <em>Search them.</em></h1><p>Pack Rat · free for Ultima Online players on UO Alive</p></div>
  <img class="shot" src="${data("site/img/inventory.webp", "image/webp")}">`;
  await withPage(browser, async (page) => { await page.setContent(html); await page.evaluate(() => document.fonts.ready); }, (page) => page.screenshot({ path: join(OUT, "og.png") }), { size: { width: 1200, height: 630 }, scale: 1 });
  console.log(`og.png  ${Math.round(statSync(join(OUT, "og.png")).size / 1024)} KB`);
}

mkdirSync(OUT, { recursive: true });
buildUi();   // the server serves app/dist/, so the shots show the page as the source has it now
const browser = await launchBrowser();
try {
  const url = await serve(true);
  const same = async (): Promise<string> => url;
  const ringSearch = async (page: Page, u: string): Promise<void> => {
    await go(page, u, "inventory", "#inv-table tbody tr.item");
    await page.fill("#f-text", "ring");
    await pause(page, 800);
    await page.locator("#inv-table tbody tr.item").nth(2).click();
    await page.waitForSelector("#inv-peek:not([hidden])");
    await pause(page, 600);
  };
  await crop(browser, "inventory", LOOKS, same, ringSearch, { x: 235, y: 90, w: 1045, h: 710 });
  // The ring's detail in each theme, side by side on the page.
  await crop(browser, "theme-britannia", [DARK], same, ringSearch, { x: 840, y: 115, w: 450, h: 440, out: 880 });
  await crop(browser, "theme-default", [{ ...LIGHT, suffix: "" }], same, ringSearch, { x: 840, y: 115, w: 450, h: 440, out: 880 });
  await crop(browser, "containers", LOOKS, same, async (page, u) => { await go(page, u, "containers", "#tab-inventory:not([hidden])"); await pause(page, 800); }, { x: 235, y: 115, w: 1045, h: 380 });
  await crop(browser, "scrolls", LOOKS, same, async (page, u) => { await go(page, u, "scrolls", "#tab-inventory:not([hidden])"); await pause(page, 800); }, { x: 235, y: 60, w: 1045, h: 225 });
  await crop(browser, "unravel", LOOKS, same, async (page, u) => { await go(page, u, "unravel", ".unr-row"); }, { x: 235, y: 75, w: 1045, h: 450 });
  await crop(browser, "character", LOOKS, same, async (page, u) => { await go(page, u, "characters/Dorran", "#tab-characters:not([hidden])"); }, { x: 240, y: 90, w: 1040, h: 790 }, { size: { width: 1280, height: 1000 } });
  await crop(browser, "wizard", LOOKS, same, async (page, u) => { await go(page, u, "settings", "#set-run-setup"); await page.click("#set-run-setup"); await pause(page, 1200); }, { x: 340, y: 180, w: 620, h: 440 }, { keep: true });
  await crop(browser, "import", LOOKS, same, async (page, u) => { await go(page, u, "import", "#import-body"); await pause(page, 1200); }, { x: 720, y: 0, w: 560, h: 380 }, { keep: true });
  // The House map on its own server: the house's synthetic tiles, the real art beside them.
  const mapUrl = await serve(true, true);
  await crop(browser, "house", LOOKS, async () => mapUrl, async (page, u) => {
    await go(page, u, "map", "#tab-map:not([hidden]) svg");
    await page.fill("#map-search input", "katana");
    await page.keyboard.press("Enter");
    await pause(page, 1500);
  }, { x: 240, y: 80, w: 1040, h: 720 });
  // Organize on the demo containers alone (the house's empty ones would fill the proposal): the rules after Auto
  // organize's Accept, and the drawer before it, each on a server of its own.
  const accepted = async (): Promise<string> => {
    const u = await serve(false);
    await withPage(browser, async (page) => {
      await go(page, u, "organize", "#tab-organize:not([hidden]) #org-auto");
      await page.click("#org-auto");
      await page.waitForSelector('#auto-drawer:not([hidden]) #auto-proposal[aria-busy="false"] #auto-headline');
      await page.click("#auto-accept");
      await page.waitForSelector("#org-plan #org-headline", { timeout: 30_000 });
    }, async () => undefined);
    return u;
  };
  await crop(browser, "organize", LOOKS, accepted, async (page, u) => { await go(page, u, "organize", "#org-plan #org-headline"); }, { x: 250, y: 165, w: 750, h: 380, out: 1500 });
  await crop(browser, "organize-auto", LOOKS, () => serve(false), async (page, u) => {
    await go(page, u, "organize", "#tab-organize:not([hidden]) #org-auto");
    await page.click("#org-auto");
    await page.waitForSelector('#auto-drawer:not([hidden]) #auto-proposal[aria-busy="false"] #auto-headline');
    await pause(page, 1200);
  }, { x: 720, y: 0, w: 560, h: 800 }, { keep: true });
  // Each build on a server of its own: a second build of the same settings would show the first as a saved run.
  await crop(browser, "suit", LOOKS, () => serve(true), async (page, u) => {
    await go(page, u, "builder", "#b-run");
    await page.click("#b-run");
    await page.waitForSelector("#b-result .b-head-card", { timeout: 120_000 });
    await pause(page, 800);
  }, { x: 240, y: 120, w: 1040, h: 660 });
  // Manual: the live doll previewing a ring, the picker narrowed to what Auto would use. 1440 px wide, where the doll has
  // its own column.
  await crop(browser, "manual", LOOKS, () => serve(true), async (page, u) => {
    await go(page, u, "builder", "#b-run");
    await page.click('#b-mode [data-value="manual"]');
    await page.waitForSelector("#b-manual:not([hidden]) #mb-suit .mb-slot");
    await page.click('.mb-slot-pick[data-slot="ring"]');
    await page.waitForSelector("#mb-picker:not([hidden]) tbody tr.item");
    await page.locator("#mb-auto-only").check();
    await pause(page, 1200);
    await page.locator("#mb-picker tbody tr.item").nth(2).hover();
    await page.waitForFunction(() => document.querySelector("#mb-doll-card .doll-pill")?.textContent?.startsWith("Preview"));
    await pause(page, 1500);   // the previewed figure loads
  }, { x: 250, y: 215, w: 1190, h: 690 }, { size: { width: 1440, height: 900 }, keep: true });
  if (wanted("og.png")) await shareImage(browser);
} finally {
  await browser.close();
  await cleanup();
}
