// ui-shell.test.mts — [slow]: the app shell (design spec 3.1, app/ui/shell.mts and app.mts's routes) in the
// real Electron window (same launch as scripts/ui-smoke.test.mts): the sidebar nav marks the current screen
// and each screen is its own <main> with an h1; #/containers is a view of Inventory; #/import and #/runs open
// their drawers over a screen and closing one puts the route back; closed drawers are hidden and inert; the
// sidebar collapses to icons below 1180 px, can be pinned collapsed, and the pin survives a restart (it is a
// ui-prefs field, not localStorage); the bridge control opens its popover; the shard picker lives in
// Settings. Skipped when electron or playwright is absent, or under TEST_SKIP_ELECTRON.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
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
async function launch(dataDir: string, width = 1440): Promise<{ app: ElectronApplication; page: Page; errors: string[] }> {
  const { _electron } = await import("playwright");
  const app = await _electron.launch({ args: [ROOT, "--demo", "--data", dataDir], cwd: ROOT, timeout: 60_000 });
  const page = await app.firstWindow();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await app.evaluate(({ BrowserWindow }, w) => BrowserWindow.getAllWindows()[0]!.setContentSize(w, 900), width);
  await page.locator("#inv-table tbody tr.item").first().waitFor({ timeout: 30_000 });
  return { app, page, errors };
}
const visibleScreens = (page: Page): Promise<string[]> => page.evaluate(() => [...document.querySelectorAll<HTMLElement>("main.screen")].filter((m) => !m.hidden).map((m) => m.id));
const current = (page: Page): Promise<string[]> => page.evaluate(() => [...document.querySelectorAll<HTMLElement>("#sidebar [aria-current=page]")].map((a) => a.dataset.nav || ""));
const drawerState = (page: Page, id: string): Promise<[boolean, boolean]> => page.evaluate((i) => { const r = document.getElementById(i)!; return [r.hidden, r.inert] as [boolean, boolean]; }, id);

test("[slow] the shell: screens, routes, drawers, the bridge popover and Settings' shard picker", async (t) => {
  const why = unavailable();
  if (why) return t.skip(why);
  const dataDir = mkdtempSync(join(tmpdir(), "packrat-shell-"));
  writeFileSync(join(dataDir, "settings.json"), JSON.stringify({ schemaVersion: 1, shard: "uoalive", setupDone: true }));
  const { app, page, errors } = await launch(dataDir);
  try {
    assert.deepEqual(await visibleScreens(page), ["tab-inventory"]);
    assert.deepEqual(await current(page), ["inventory"]);
    assert.equal(await page.locator("#tab-inventory h1").innerText(), "Inventory");
    assert.match(await page.locator("#status").innerText(), /^UO Alive · last scan /, "the shard and scan freshness sit at the sidebar foot");
    assert.equal(await page.locator("#nav-count-inventory").innerText(), "160");

    // Containers is a view of Inventory, reached by its route or its segmented switch.
    await page.evaluate(() => { location.hash = "#/containers"; });
    await page.waitForSelector("#tab-containers:not([hidden])");
    assert.deepEqual(await visibleScreens(page), ["tab-inventory"]);
    assert.deepEqual(await current(page), ["inventory"]);
    assert.equal(await page.locator("#inv-view [aria-checked=true]").innerText(), "Containers");
    await page.locator("#inv-view").getByRole("radio", { name: "Items" }).click();
    await page.waitForFunction(() => location.hash === "#/inventory");
    await page.waitForSelector("#tab-containers", { state: "hidden" });
    assert.equal(await page.locator("#inv-view-items").isVisible(), true);

    // Every screen is a <main> with its h1 in the top bar, and the nav says which one is showing.
    for (const [nav, h1] of [["characters", "Characters"], ["builder", "Suit Builder"], ["settings", "Settings"]] as const) {
      await page.click(`[data-nav="${nav}"]`);
      await page.waitForSelector(`#tab-${nav}:not([hidden])`);
      assert.deepEqual(await visibleScreens(page), [`tab-${nav}`]);
      assert.deepEqual(await current(page), [nav]);
      assert.equal(await page.locator(`#tab-${nav} h1`).innerText(), h1);
    }
    // The shard picker moved from the header into Settings.
    assert.equal(await page.locator("#tab-settings #shard").inputValue(), "uoalive");

    // Import opens as a drawer over the screen that was showing; closing it puts the route back.
    assert.deepEqual(await drawerState(page, "import-drawer"), [true, true], "closed drawers are hidden and inert");
    await page.keyboard.press(process.platform === "darwin" ? "Meta+i" : "Control+i");
    await page.waitForSelector("#import-drawer:not([hidden])");
    assert.equal(await page.evaluate(() => location.hash), "#/import");
    assert.deepEqual(await drawerState(page, "import-drawer"), [false, false]);
    assert.deepEqual(await visibleScreens(page), ["tab-settings"], "the screen behind stays");
    assert.equal(await page.evaluate(() => document.getElementById("app")!.inert), true, "the shell is inert behind the drawer");
    await page.keyboard.press("Escape");
    await page.waitForSelector("#import-drawer", { state: "hidden" });
    assert.equal(await page.evaluate(() => location.hash), "#/settings", "the route is back to the screen behind");
    assert.deepEqual(await drawerState(page, "import-drawer"), [true, true]);
    assert.equal(await page.evaluate(() => document.getElementById("app")!.inert), false);

    // Runs opens the builder with the saved-runs drawer; navigating away closes it.
    await page.click('[data-nav="runs"]');
    await page.waitForSelector("#runs-drawer:not([hidden])");
    assert.deepEqual(await visibleScreens(page), ["tab-builder"]);
    await page.evaluate(() => { location.hash = "#/characters"; });
    await page.waitForSelector("#tab-characters:not([hidden])");
    assert.deepEqual(await drawerState(page, "runs-drawer"), [true, true]);

    // The bridge control opens its popover with the state in words and a way to Settings.
    await page.click("#bridge");
    const pop = page.locator(".pop[aria-label='Bridge status']");
    await pop.waitFor();
    assert.match(await pop.innerText(), /No client set up|Bridge offline|Bridge ready/);
    assert.match(await pop.innerText(), /Last answered/);
    await page.keyboard.press("Escape");
    assert.equal(await pop.count(), 0);
    assert.equal(await page.evaluate(() => document.activeElement?.id), "bridge", "focus returns to the control");
    assert.deepEqual(errors, []);
  } finally {
    await app.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("[slow] the sidebar collapses to icons below 1180 px, and pinning it collapsed survives a restart", async (t) => {
  const why = unavailable();
  if (why) return t.skip(why);
  const dataDir = mkdtempSync(join(tmpdir(), "packrat-shell-pin-"));
  writeFileSync(join(dataDir, "settings.json"), JSON.stringify({ schemaVersion: 1, shard: "uoalive", setupDone: true }));
  const collapsed = (page: Page): Promise<boolean> => page.evaluate(() => document.getElementById("app")!.classList.contains("collapsed"));
  const sidebarWidth = (page: Page): Promise<number> => page.evaluate(() => document.getElementById("sidebar")!.getBoundingClientRect().width);
  let run = await launch(dataDir, 1100);
  try {
    assert.equal(await collapsed(run.page), true, "1100 px wide: icons only");
    assert.equal(await sidebarWidth(run.page), 56);
    // Collapsed, every nav item keeps its name for a screen reader.
    assert.ok(await run.page.getByRole("link", { name: "Characters" }).isVisible());
    await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 900));
    await run.page.waitForFunction(() => !document.getElementById("app")!.classList.contains("collapsed"));
    assert.equal(await sidebarWidth(run.page), 216);
    await run.page.click("#sidebar-pin");
    assert.equal(await collapsed(run.page), true, "pinned collapsed at 1440 px");
    await run.page.waitForFunction(async () => (await (await fetch("/api/ui-prefs")).json()).prefs.sidebar === "collapsed");
    assert.deepEqual(run.errors, []);
  } finally { await run.app.close(); }
  assert.equal(JSON.parse(readFileSync(join(dataDir, "ui-prefs.json"), "utf8")).sidebar, "collapsed");
  run = await launch(dataDir, 1440);
  try {
    await run.page.waitForFunction(() => document.getElementById("app")!.classList.contains("collapsed"), undefined, { timeout: 10_000 });
    await run.page.click("#sidebar-pin");
    assert.equal(await collapsed(run.page), false, "unpinned, 1440 px shows labels again");
  } finally {
    await run.app.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});
