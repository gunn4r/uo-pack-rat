// ui-contrast.test.mts — [slow]: the contrast check from design spec 2.3, run on the REAL page. It drives the
// Electron window with Playwright (the same launch as scripts/ui-smoke.test.mts) over the demo data, visits
// each scene below in light and in dark (switched through prefers-color-scheme, which the page follows live
// while the Appearance choice is "System"), and measures every text/background pair, field value,
// placeholder, control boundary, meaningful icon and status dot with scripts/contrast-probe.mts. Any
// failing pair fails the build. A screen or overlay added to the app gets a scene here.
// [slow] and not [fast]: it launches Electron and runs a short build for the result screen.
// Skipped when electron or playwright is absent, or under TEST_SKIP_ELECTRON.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import type { ElectronApplication, Page } from "playwright";
import { probeContrast, failures, describeFailures, type ContrastRow } from "./contrast-probe.mts";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const require_ = createRequire(import.meta.url);
function unavailable(): string | null {
  if (process.env.TEST_SKIP_ELECTRON) return "TEST_SKIP_ELECTRON is set";
  for (const dep of ["electron", "playwright"]) {
    try { require_.resolve(dep); } catch { return `${dep} is not installed`; }
  }
  return null;
}

// Each scene brings the page into one state; the probe then measures whatever is visible, and `leave` undoes
// what must not carry over (an open overlay). Scenes run in order in one window, so a scene may rely on the
// one before (the build saves a run, which the runs drawer then lists).
interface Scene { name: string; enter: (page: Page) => Promise<void>; leave?: (page: Page) => Promise<void> }
async function route(page: Page, hash: string, ready: string): Promise<void> {
  await page.evaluate((h) => { location.hash = h; }, hash);
  await page.waitForSelector(ready, { timeout: 15_000 });
  await page.waitForTimeout(250);
}
const SCENES: Scene[] = [
  { name: "inventory", enter: (p) => route(p, "#/inventory", "#inv-table tbody tr.item") },
  { name: "item tooltip", enter: async (p) => {
    await route(p, "#/inventory", "#inv-table tbody tr.item");
    await p.locator("#inv-table tbody tr.item", { hasText: "Arcane" }).first().locator("td").nth(1).hover();
    await p.waitForSelector("#tip[style*='block']", { timeout: 5_000 });
  } },
  // ---- inventory
  { name: "inventory row actions", enter: async (p) => {
    await route(p, "#/inventory", "#inv-table tbody tr.item");
    await p.locator("#inv-table tbody tr.item").nth(2).hover();
    await p.waitForTimeout(100);
  }, leave: (p) => p.mouse.move(0, 0) },
  { name: "inventory filters and strip", enter: async (p) => {
    await p.click("#f-rarity");
    await p.locator(".pop input[value='Greater Magic Item']").click();
    await p.click("#f-kind");
    await p.locator(".pop input[value=gear]").click();
    await p.waitForSelector("#inv-active:not([hidden]) .token");
  }, leave: (p) => p.keyboard.press("Escape") },
  { name: "inventory rarity popover", enter: async (p) => { await p.click("#f-rarity"); await p.waitForSelector(".pop .rar-tier"); }, leave: (p) => p.keyboard.press("Escape") },
  { name: "inventory location popover", enter: async (p) => { await p.click("#f-loc"); await p.waitForSelector(".pop .inv-opt"); }, leave: (p) => p.keyboard.press("Escape") },
  { name: "inventory add-filter menu", enter: async (p) => { await p.click("#f-add"); await p.waitForSelector(".pop.pop-menu"); } },
  { name: "inventory property rule", enter: async (p) => {
    await p.getByRole("menuitem", { name: "Property rule…" }).click();
    await p.locator(".pop .inv-prop").first().click();
  }, leave: (p) => p.keyboard.press("Escape") },
  { name: "inventory hide tags", enter: async (p) => {
    await p.click("#f-add");
    await p.getByRole("menuitem", { name: "Hide tags…" }).click();
    await p.locator(".pop .pill").first().click();
  }, leave: (p) => p.keyboard.press("Escape") },
  { name: "inventory table settings", enter: async (p) => { await p.click("#inv-settings"); await p.waitForSelector("#inv-cols"); }, leave: (p) => p.keyboard.press("Escape") },
  { name: "inventory item peek", enter: async (p) => {
    if (await p.locator("#f-clear").isVisible()) await p.click("#f-clear");
    await p.locator("#inv-table tbody tr.item", { hasText: "Arcane Ringmail Leggings" }).first().click();
    await p.waitForSelector("#inv-peek:not([hidden]) .peek-resists");
  }, leave: (p) => p.keyboard.press("Escape") },
  { name: "inventory row focus tooltip", enter: async (p) => {
    await p.locator("#inv-table tbody tr.item").first().focus();
    await p.keyboard.press("ArrowDown");
    await p.waitForSelector("#tip[style*='block'] .tip-lines", { timeout: 5_000 });
  }, leave: (p) => p.keyboard.press("Escape") },
  { name: "inventory empty result", enter: async (p) => {
    await p.click("#f-rarity");
    await p.locator(".pop input[value='Legendary Artifact']").click();
    await p.waitForSelector("#inv-empty");
  } },
  { name: "inventory grouped", enter: async (p) => {
    await p.click("#f-clear");
    await p.locator("#inv-rows").getByRole("radio", { name: "Grouped" }).click();
    await p.waitForFunction(() => /name/.test(document.querySelector("#inv-foot .inv-count")?.textContent || ""));
  }, leave: (p) => p.locator("#inv-rows").getByRole("radio", { name: "List" }).click() },
  { name: "inventory load failed", enter: async (p) => {
    await p.evaluate(async () => (await import("/ui/inventory.mjs" as string)).inventoryFailed(new Error("/api/inventory failed: internal error")));
    await p.waitForSelector(".inv-error .msg");
  }, leave: (p) => p.evaluate(async () => { const I = await import("/ui/inventory.mjs" as string); I.buildFilters(); I.fetchItems(); }) },
  { name: "characters", enter: (p) => route(p, "#/characters", "#char-cards .panel") },
  { name: "containers", enter: (p) => route(p, "#/containers", "#cont-table tbody tr") },
  { name: "containers menu", enter: async (p) => {
    await p.locator("#cont-table tbody tr[data-root]").first().getByRole("button", { name: /^Actions for / }).click();
    await p.waitForSelector(".pop.pop-menu");
  } },
  { name: "confirm dialog", enter: async (p) => {
    await p.getByRole("menuitem", { name: "Forget…" }).click();
    await p.waitForSelector("dialog.dialog[open]");
  }, leave: (p) => p.keyboard.press("Escape") },
  { name: "toasts", enter: async (p) => {
    await p.evaluate(async () => {
      const C = await import("/ui/components.mjs" as string);
      C.showToast("8 grabs queued for Dorran", "ok"); C.showToast("Grab: Mighty Orc Mask queued for Dorran", "info");
      C.showToast("Bridge is offline. Press Play on packrat-bridge.py in game first.", "bad", { action: { label: "Details", onClick: () => {} } });
    });
  }, leave: (p) => p.evaluate(async () => (await import("/ui/components.mjs" as string)).clearToasts()) },
  { name: "builder result", enter: async (p) => {
    await route(p, "#/builder", "#b-run");
    await p.waitForFunction(() => document.querySelector<HTMLSelectElement>("#b-char")?.value, undefined, { timeout: 10_000 });
    await p.fill("#b-budget", "2");
    await p.click("#b-run");
    await p.waitForFunction(() => !document.querySelector<HTMLButtonElement>("#b-run")?.disabled && document.querySelector("#b-result h2"), undefined, { timeout: 60_000 });
  } },
  { name: "import drawer", enter: (p) => route(p, "#/import", "#import-drawer:not([hidden]) #import-body .panel"), leave: (p) => p.keyboard.press("Escape") },
  { name: "runs drawer", enter: (p) => route(p, "#/runs", "#runs-drawer:not([hidden]) .runrow"), leave: (p) => p.keyboard.press("Escape") },
  { name: "bridge popover", enter: async (p) => { await p.click("#bridge"); await p.waitForSelector(".pop"); }, leave: (p) => p.keyboard.press("Escape") },
  { name: "collapsed sidebar", enter: async (p) => { await route(p, "#/inventory", "#inv-table tbody tr.item"); await p.click("#sidebar-pin"); await p.waitForSelector("#app.collapsed"); },
    leave: (p) => p.click("#sidebar-pin") },
  { name: "settings", enter: (p) => route(p, "#/settings", "#settings-body .panel") },
];

async function launch(dataDir: string): Promise<{ app: ElectronApplication; page: Page; errors: string[] }> {
  const { _electron } = await import("playwright");
  const app = await _electron.launch({ args: [ROOT, "--demo", "--data", dataDir], cwd: ROOT, timeout: 60_000 });
  const page = await app.firstWindow();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 900));
  return { app, page, errors };
}

test("[slow] every text, control edge, icon and status dot on the real page passes contrast in light and dark", async (t) => {
  const why = unavailable();
  if (why) return t.skip(why);
  const dataDir = mkdtempSync(join(tmpdir(), "packrat-contrast-"));
  // setupDone skips the first-run wizard; --demo reads the committed demo scans.
  writeFileSync(join(dataDir, "settings.json"), JSON.stringify({ schemaVersion: 1, shard: "uoalive", setupDone: true }));
  const { app, page, errors } = await launch(dataDir);
  try {
    await page.locator("#inv-table tbody tr.item").first().waitFor({ timeout: 30_000 });
    const rows: Array<ContrastRow & { where: string }> = [];
    const seen: string[] = [];
    for (const scene of SCENES) {
      await scene.enter(page);
      // hover fills are states, not surfaces: park the pointer on an empty stretch of the top bar (the
      // tooltip scene keeps its hover, it is what that scene measures)
      if (scene.name !== "item tooltip") await page.mouse.move(900, 4);
      for (const mode of ["light", "dark"] as const) {
        // reduced motion: no colour transition is half-way when the probe reads the computed colours
        await page.emulateMedia({ colorScheme: mode, reducedMotion: "reduce" });
        await page.waitForFunction((m) => document.documentElement.dataset.mode === m, mode, { timeout: 5_000 });
        await page.waitForTimeout(80);
        const got = await page.evaluate(probeContrast);
        assert.ok(got.length > 10, `${scene.name} (${mode}) measured only ${got.length} pairs — did the scene render?`);
        for (const r of got) rows.push({ ...r, where: `${scene.name} · ${mode}` });
        seen.push(`${scene.name} · ${mode}: ${got.length}`);
      }
      await page.emulateMedia({ colorScheme: "light" });
      await scene.leave?.(page);
    }
    const failed = failures(rows);
    assert.equal(failed.length, 0, `contrast failures (${failed.length} of ${rows.length} pairs):\n${describeFailures(failed)}`);
    assert.ok(rows.some((r) => r.kind === "boundary") && rows.some((r) => r.kind === "field-value"), "the probe measured control edges and field values");
    t.diagnostic(`checked ${rows.length} pairs: ${seen.join("; ")}`);
    assert.deepEqual(errors, []);

    // The probe is not vacuous: a pale label on the page is reported.
    await page.evaluate(() => { const s = document.createElement("span"); s.id = "contrast-canary"; s.textContent = "pale"; s.style.cssText = "color:#bbbbbb;background:#ffffff;position:fixed;top:0;left:0"; document.body.append(s); });
    const canary = failures(await page.evaluate(probeContrast)).filter((r) => r.text === "pale");
    assert.equal(canary.length, 1, "a #bbb on white label is a failing pair");
  } finally {
    await app.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});
