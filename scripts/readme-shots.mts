#!/usr/bin/env node
// readme-shots.mts — the README's screenshots and GIFs (docs/images/), taken from the demo characters in headless Chromium.
//   npm run readme:shots            every image
//   npm run readme:shots -- house   only the images whose name starts with one of the words given
//
// It seeds a throwaway data folder (the demo scans, Kestrel at Imbuing 70, and the synthetic vault house of
// app/house-fixture.mts), starts the server on it with a game-client search home of its own, so nothing on this
// computer is read, and drives the page with Playwright: Chromium when `npx playwright install chromium` has been
// run, else the installed Chrome. Stills are 1280 × 800 at 2x; GIFs are recorded at 1280 × 800 and turned into
// 15 fps, 960 px wide GIFs by ffmpeg (skipped, saying so, when ffmpeg is not on the PATH). Never the Electron app.
//
// map: tooling
// owns: the README's screenshots and GIFs
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type Page } from "playwright";
import { houseScan } from "../app/organize-fixture.mts";
import { claimHouses, vaultHouse, FIXTURE_TILES } from "../app/house-fixture.mts";
import { syntheticTileData } from "../app/tiledata-fixture.mts";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT = join(ROOT, "docs", "images");
const SIZE = { width: 1280, height: 800 };
const only = process.argv.slice(2);
const wanted = (name: string): boolean => only.length === 0 || only.some((w) => name.startsWith(w));

// The demo scans with Kestrel at Imbuing 70 (for Unravel). With `house`, also the vault house of app/house-fixture.mts:
// 120 chests in stacks of five, partly full, some labeled, a few holding things to find on the map.
function seed(dir: string, house: boolean): { home: string } {
  mkdirSync(join(dir, "scans"), { recursive: true });
  for (const name of ["Dorran", "Kestrel"]) {
    const scan = JSON.parse(readFileSync(join(ROOT, "app", "fixtures", `demo-${name}.json`), "utf8")) as { skills: Record<string, unknown> };
    if (name === "Kestrel") scan.skills = { ...scan.skills, Imbuing: { base: 70, value: 70, cap: 100 } };
    writeFileSync(join(dir, "scans", `demo-${name}.json`), JSON.stringify(scan));
  }
  const home = join(dir, "home"), client = join(dir, "client"), scripts = join(client, "TazUO", "LegionScripts"), uo = join(client, "UO");
  for (const d of [home, scripts, join(client, "Profiles", "Settings"), uo]) mkdirSync(d, { recursive: true });
  writeFileSync(join(dir, "settings.json"), JSON.stringify({ schemaVersion: 1, shard: "uoalive", setupDone: true, autoUpdateCheck: false, client: { adapter: "tazuo", scriptsDir: scripts } }));
  if (!house) return { home };
  const { house: vault, chests } = vaultHouse();
  const finds = ["Katana", "Ruby", "Katana", "Black Pearl", "Ruby", "Katana", "Sapphire", "Ruby"];
  const things = finds.map((name, i) => ({ serial: 0x40600000 + i, name, in: chests[(i * 17 + 4) % chests.length]!.serial }));
  const v = houseScan({ character: "Dorran", scannedAt: "2025-12-31T12:00:00Z", things, boxes: chests.map((c, i) => ({ serial: c.serial, name: c.name, pos: { x: c.x, y: c.y, z: c.z, facet: 1 }, count: (i * 37) % 126 })) });
  writeFileSync(join(dir, "scans", "vault.json"), JSON.stringify({ ...v, house: { facet: 1, capturedAt: vault.capturedAt, at: { x: 3003, y: 1003 }, tiles: vault.tiles, items: vault.items } }));
  claimHouses(dir, [vault]);
  // A label on every chest of some stacks, so the map shows the label colors.
  const kinds: Array<[string, string]> = [["Reagents", "#2f7f7f"], ["Armor", "#8a5a2b"], ["Weapons", "#a33b3b"], ["Jewelry", "#6b4fa0"], ["Scrolls", "#3d6fb0"]];
  const labels: Record<string, unknown> = {};
  chests.forEach((c, i) => { const stack = Math.floor(i / 5); if (stack % 3 === 0) { const [name, color] = kinds[(stack / 3) % kinds.length]!; labels[c.serial] = { serial: c.serial, name, color, origin: "manual" }; } });
  writeFileSync(join(dir, "organize.json"), JSON.stringify({ version: 1, catchAll: null, pinnedItems: [], rules: [], labels }));
  writeFileSync(join(uo, "tiledata.mul"), syntheticTileData(FIXTURE_TILES));
  writeFileSync(join(client, "Profiles", "Settings", "p.json"), JSON.stringify({ ultimaonlinedirectory: uo }));
  return { home };
}

async function freePort(): Promise<number> {
  return new Promise((ok, fail) => { const s = createServer(); s.once("error", fail); s.listen(0, "127.0.0.1", () => { const { port } = s.address() as { port: number }; s.close(() => ok(port)); }); });
}

async function startServer(dir: string, home: string): Promise<{ url: string; child: ChildProcess }> {
  const port = await freePort();
  const child = spawn(process.execPath, [join(ROOT, "app", "vault-server.mts"), "--data", dir, "--port", String(port)], { stdio: "ignore", env: { ...process.env, PACKRAT_CLIENT_HOME: home } });
  const url = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try { if ((await fetch(`${url}/api/settings`)).ok) return { url, child }; } catch { /* not listening yet */ }
    await new Promise((r) => setTimeout(r, 200));   // sleep: polling for the server to listen
  }
  child.kill();
  throw new Error("the server did not start within 30 s");
}

async function launchBrowser(): Promise<Browser> {
  try { return await chromium.launch(); } catch { return chromium.launch({ channel: "chrome" }); }
}

async function go(page: Page, url: string, hash: string, ready: string): Promise<void> {
  await page.goto(`${url}/#/${hash}`);
  await page.waitForSelector(ready, { timeout: 30_000 });
  await page.waitForTimeout(600);   // sleep: fonts and transitions settle before the picture
}

// Types `text` a key at a time, as a person would, for the GIFs.
const typeSlowly = (page: Page, selector: string, text: string): Promise<void> => page.locator(selector).pressSequentially(text, { delay: 120 });
const pause = (page: Page, ms: number): Promise<void> => page.waitForTimeout(ms);   // sleep: a beat for the viewer of the GIF

// A still: the page at 2x.
async function still(browser: Browser, name: string, shoot: (page: Page) => Promise<void>): Promise<void> {
  if (!wanted(name)) return;
  const context = await browser.newContext({ viewport: SIZE, deviceScaleFactor: 2, colorScheme: "light" });
  const page = await context.newPage();
  try {
    await shoot(page);
    await page.mouse.move(SIZE.width - 2, SIZE.height - 2);   // no hover tooltip in the picture
    await pause(page, 400);
    await page.screenshot({ path: join(OUT, `${name}.png`) });
    report(`${name}.png`);
  } finally { await context.close(); }
}

// A GIF: screenshots taken back to back while `act` runs, each shown for as long as it was on screen, turned by ffmpeg
// into a 15 fps palette GIF 960 px wide. The recording starts once `hash` has loaded and `ready` shows.
async function gif(browser: Browser, url: string, name: string, hash: string, ready: string, act: (page: Page) => Promise<void>): Promise<void> {
  if (!wanted(name)) return;
  if (spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status !== 0) { console.log(`skipped ${name}.gif: ffmpeg is not on the PATH`); return; }
  const frameDir = mkdtempSync(join(tmpdir(), "packrat-frames-"));
  const context = await browser.newContext({ viewport: SIZE, deviceScaleFactor: 1, colorScheme: "light" });
  const page = await context.newPage();
  await go(page, url, hash, ready);
  const frames: Array<{ file: string; at: number }> = [];
  let recording = true;
  const start = Date.now();
  const recorder = (async () => {
    while (recording) {
      const file = join(frameDir, `${String(frames.length).padStart(5, "0")}.png`);
      await page.screenshot({ path: file });
      frames.push({ file, at: (Date.now() - start) / 1000 });
    }
  })();
  try { await act(page); } finally { recording = false; await recorder; await context.close(); }
  const list = frames.map((f, i) => `file '${f.file}'\nduration ${((frames[i + 1]?.at ?? f.at + 0.1) - f.at).toFixed(3)}`).join("\n") + `\nfile '${frames.at(-1)!.file}'\n`;
  writeFileSync(join(frameDir, "frames.txt"), list);
  const filters = "fps=15,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle";
  const r = spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", join(frameDir, "frames.txt"), "-vf", filters, "-loop", "0", join(OUT, `${name}.gif`)], { stdio: "inherit" });
  rmSync(frameDir, { recursive: true, force: true });
  if (r.status !== 0) throw new Error(`ffmpeg failed on ${name}`);
  report(`${name}.gif`);
}

function report(file: string): void {
  console.log(`${file}  ${Math.round(statSync(join(OUT, file)).size / 1024)} KB`);
}

const servers: Array<{ dir: string; child: ChildProcess }> = [];
async function serve(house: boolean): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "packrat-shots-"));
  const { home } = seed(dir, house);
  const { url, child } = await startServer(dir, home);
  servers.push({ dir, child });
  return url;
}

mkdirSync(OUT, { recursive: true });
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
  await still(browser, "characters", async (page) => {
    await go(page, url, "characters/Dorran", "#tab-characters:not([hidden])");
  });
  await still(browser, "house-map", async (page) => {
    await go(page, url, "map", "#tab-map:not([hidden]) svg");
  });
  await gif(browser, url, "house-map-search", "map", "#tab-map:not([hidden]) svg", async (page) => {
    await pause(page, 1000);
    await typeSlowly(page, "#map-search input", "katana");
    await page.keyboard.press("Enter");
    await pause(page, 2500);
    await page.locator('#map-view [data-value="plan"]').click();
    await pause(page, 2000);
  });
  await still(browser, "unravel", async (page) => {
    await go(page, url, "unravel", ".unr-row");
  });

  // Organize on the demo chests alone (the vault's 120 empty chests would fill the proposal).
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
} finally {
  await browser.close();
  for (const { dir, child } of servers) { child.kill(); rmSync(dir, { recursive: true, force: true }); }
}
