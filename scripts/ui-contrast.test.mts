// ui-contrast.test.mts — [slow]: the contrast check from design spec 2.3, run on the REAL page. It drives the
// Electron window with Playwright (the same launch as scripts/ui-smoke.test.mts) over the demo data, visits
// each scene below in both theme families (Default and Britannia, switched through theme.mts's applyLook) and
// in light and in dark (switched through prefers-color-scheme, which the page follows live while the
// Appearance choice is "System"), and measures every text/background pair, field value,
// placeholder, control boundary, meaningful icon and status dot with scripts/contrast-probe.mts. Any
// failing pair fails the build. A screen or overlay added to the app gets a scene here.
// [slow] and not [fast]: it launches Electron and runs a short build for the result screen.
// Skipped when electron or playwright is absent, or under TEST_SKIP_ELECTRON.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import type { ElectronApplication, Page } from "playwright";
import { fitWindow, openFacet, setRows, type RealSize } from "./electron-window.mts";
import { probeContrast, failures, describeFailures, type ContrastRow } from "./contrast-probe.mts";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const KESTREL = readFileSync(join(ROOT, "app", "fixtures", "demo-Kestrel.json"), "utf8");
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
// The wizard, opened from Settings' code path and walked forward `steps` times with its primary button.
function openWizardAt(steps: number): (page: Page) => Promise<void> {
  return async (page) => {
    await page.evaluate(async () => { await (await import("/ui/wizard.mjs" as string)).openWizard(); });
    await page.waitForSelector("#wizard[open] #wiz-primary");
    for (let i = 0; i < steps; i++) await page.click("#wiz-primary");
    await page.waitForTimeout(150);
  };
}
async function closeWizard(page: Page): Promise<void> { await page.keyboard.press("Escape"); await page.waitForSelector("#wizard", { state: "hidden" }); }
let releaseStart: (() => void) | null = null;   // lets the held build request of "builder running" go
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
    await openFacet(p, "rarity", "Rarity");
    await p.locator(".pop input[value='Greater Magic Item']").click();
    await openFacet(p, "kind", "Kind");
    await p.locator(".pop input[value=gear]").click();
    await p.waitForSelector("#inv-active:not([hidden]) .token");
  }, leave: (p) => p.keyboard.press("Escape") },
  { name: "inventory rarity popover", enter: async (p) => { await openFacet(p, "rarity", "Rarity"); await p.waitForSelector(".pop .rar-tier"); }, leave: (p) => p.keyboard.press("Escape") },
  { name: "inventory location popover", enter: async (p) => { await openFacet(p, "loc", "Location"); await p.waitForSelector(".pop .inv-opt"); }, leave: (p) => p.keyboard.press("Escape") },
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
  { name: "inventory peek tag meaning", enter: async (p) => {
    if (await p.locator("#f-clear").isVisible()) await p.click("#f-clear");
    await p.locator("#inv-table tbody tr.item", { hasText: "Animated Katana" }).first().click();
    await p.locator("#inv-peek .tag.tag-info").first().focus();
    await p.waitForSelector("body > .tip");
  }, leave: (p) => p.keyboard.press("Escape") },
  { name: "inventory row focus tooltip", enter: async (p) => {
    await p.locator("#inv-table tbody tr.item").first().focus();
    await p.keyboard.press("ArrowDown");
    await p.waitForSelector("#tip[style*='block'] .tip-lines", { timeout: 5_000 });
  }, leave: (p) => p.keyboard.press("Escape") },
  { name: "inventory empty result", enter: async (p) => {
    await openFacet(p, "rarity", "Rarity");
    await p.locator(".pop input[value='Legendary Artifact']").click();
    await p.waitForSelector("#inv-empty");
  } },
  { name: "inventory grouped", enter: async (p) => {
    await p.click("#f-clear");
    await setRows(p, "Grouped");
    await p.waitForFunction(() => /name/.test(document.querySelector("#inv-foot .inv-count")?.textContent || ""));
  }, leave: (p) => setRows(p, "List") },
  { name: "inventory load failed", enter: async (p) => {
    await p.evaluate(async () => (await import("/ui/inventory.mjs" as string)).inventoryFailed(new Error("/api/inventory failed: internal error")));
    await p.waitForSelector(".inv-error .msg");
  }, leave: (p) => p.evaluate(async () => { const I = await import("/ui/inventory.mjs" as string); I.buildFilters(); I.fetchItems(); }) },
  { name: "characters", enter: (p) => route(p, "#/characters", "#char-table tbody tr[data-name]") },
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
    await p.click("#b-sec-adv .b-sec-head button");   // Advanced: a short budget, and other suits so that card draws too
    await p.fill("#b-budget", "2"); await p.fill("#b-altcount", "5"); await p.fill("#b-alttol", "40");
    await p.click("#b-sec-adv .b-sec-head button");
    await p.click("#b-run");
    await p.waitForFunction(() => !document.querySelector<HTMLButtonElement>("#b-run")?.disabled && document.querySelector("#b-result h2"), undefined, { timeout: 60_000 });
  } },
  { name: "import drawer", enter: (p) => route(p, "#/import", "#import-drawer:not([hidden]) #imp-mode"), leave: (p) => p.keyboard.press("Escape") },
  { name: "runs drawer", enter: (p) => route(p, "#/runs", "#runs-drawer:not([hidden]) .run-card"), leave: (p) => p.keyboard.press("Escape") },
  { name: "bridge popover", enter: async (p) => { await p.click("#bridge"); await p.waitForSelector(".pop"); }, leave: (p) => p.keyboard.press("Escape") },
  // Pinned collapsed where the window is wide enough to show the sidebar expanded; below 1180 px it already is.
  { name: "collapsed sidebar", enter: async (p) => {
    await route(p, "#/inventory", "#inv-table tbody tr.item");
    if (await p.locator("#sidebar-pin").isVisible()) await p.click("#sidebar-pin");
    await p.waitForSelector("#app.collapsed");
  }, leave: async (p) => { if (await p.locator("#sidebar-pin[aria-pressed=true]").isVisible()) await p.click("#sidebar-pin"); } },
  { name: "settings", enter: (p) => route(p, "#/settings", "#set-general .set-row") },
  // ---- Settings (phase 12): the lower sections (the danger zone), with a failed update check under its row
  { name: "settings data and updates", enter: async (p) => {
    await route(p, "#/settings", "#set-general .set-row");
    await p.click("#settings-nav [data-section=set-updates]");
    // A fixed answer instead of a real call to GitHub: the scene measures the failure message, not the network.
    await p.route("**/api/update-check", (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, configured: true, error: "GitHub releases/latest returned 404" }) }));
    await p.click("#set-check-updates");
    await p.waitForSelector("#set-updates .msg", { timeout: 20_000 });
    await p.locator("#set-data").scrollIntoViewIfNeeded();
  } },
  // ---- import drawer states (phase 10): a clean paste with its preview, a paste that doesn't parse, scan files
  { name: "import preview", enter: async (p) => {
    await route(p, "#/import", "#import-drawer:not([hidden]) #imp-text");
    await p.fill("#imp-text", KESTREL);
    await p.waitForSelector(".imp-preview.ok");
  }, leave: (p) => p.keyboard.press("Escape") },
  { name: "import error", enter: async (p) => {
    await route(p, "#/import", "#import-drawer:not([hidden]) #imp-text");
    await p.fill("#imp-text", KESTREL.slice(0, 600));
    await p.waitForSelector(".imp-preview.bad");
  }, leave: async (p) => { await p.fill("#imp-text", ""); await p.keyboard.press("Escape"); } },
  { name: "import files", enter: async (p) => {
    await route(p, "#/import", "#import-drawer:not([hidden]) #imp-mode");
    await p.locator("#imp-mode").getByRole("radio", { name: "Scan files" }).click();
    await p.evaluate(([k]) => {
      const dt = new DataTransfer();
      dt.items.add(new File([k!], "Kestrel.json", { type: "application/json" }));
      dt.items.add(new File(["hello"], "notes.txt", { type: "text/plain" }));
      window.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
    }, [KESTREL]);
    await p.waitForSelector(".imp-file.bad");
  }, leave: async (p) => { await p.locator("#imp-mode").getByRole("radio", { name: "Paste a scan" }).click(); await p.keyboard.press("Escape"); } },
  // ---- setup wizard (phase 11): the shard step with its notice, the client cards (selected, plain, disabled),
  // a failed folder path, and the paste branch's last step
  { name: "wizard shard", enter: openWizardAt(0), leave: closeWizard },
  { name: "wizard client", enter: openWizardAt(1), leave: closeWizard },
  { name: "wizard folder error", enter: async (p) => {
    await openWizardAt(2)(p);
    await p.fill("#wiz-path", "/no/such/folder");
    await p.click("#wiz-use-path");
    await p.waitForSelector("#wizard .msg.bad");
  }, leave: closeWizard },
  { name: "wizard paste branch", enter: async (p) => {
    await openWizardAt(1)(p);
    await p.locator("#wizard input[value=classicuo-web]").check();
    await p.click("#wiz-primary"); await p.click("#wiz-primary");
    await p.waitForSelector("#wizard .msg.info");
  }, leave: closeWizard },
  // ---- characters
  { name: "character row menu", enter: async (p) => {
    await route(p, "#/characters", "#char-table tbody tr[data-name]");
    await p.locator("#char-table tbody tr[data-name]").first().getByRole("button", { name: /^More actions/ }).click();
    await p.waitForSelector(".pop-menu");
  }, leave: (p) => p.keyboard.press("Escape") },
  { name: "character sheet", enter: (p) => route(p, "#/characters/Dorran", "#tab-characters .sheet") },
  { name: "character slot detail", enter: async (p) => {
    await route(p, "#/characters/Dorran", "#tab-characters .sheet");
    await p.locator("#tab-characters .sheet button.slot").first().click();
    await p.waitForSelector(".pop.item-pop");
  }, leave: (p) => p.keyboard.press("Escape") },
  // ---- builder (phases 7-9): the result's lower cards, compare, the drawer's menu and rename, the panel's
  // popovers and field error, the running build, the empty state. They follow "builder result" above, whose
  // build they reuse.
  { name: "builder result details", enter: async (p) => {
    await route(p, "#/builder", "#b-result h2");
    await p.locator("#b-result").getByRole("switch", { name: "Show unchanged slots" }).check();
    await p.locator("#b-result").getByRole("button", { name: "Full sheet" }).click();
    await p.locator("#b-result .b-disclose").click();
    await p.waitForSelector("#b-details");
    await p.evaluate(() => { document.querySelector(".b-results")!.scrollTop = 99999; });
  } },
  { name: "builder compare suits", enter: async (p) => {
    const ticks = p.locator("section[aria-label='Other suits'] tbody input[type=checkbox]");
    await ticks.nth(0).check(); await ticks.nth(1).check();
    await p.getByRole("button", { name: "Compare 2 suits" }).click();
    await p.waitForSelector("#b-compare-view:not([hidden]) .b-cmp");
  }, leave: async (p) => { await p.getByRole("button", { name: "Back to result" }).click(); } },
  { name: "runs drawer menu and rename", enter: async (p) => {
    // a second run, so there are two to tick
    await p.click("#b-sec-adv .b-sec-head button"); await p.fill("#b-restarts", "150"); await p.click("#b-sec-adv .b-sec-head button");
    await p.click("#b-run");
    await p.waitForFunction(() => !document.querySelector<HTMLButtonElement>("#b-run")?.disabled && document.querySelector("#b-result h2"), undefined, { timeout: 60_000 });
    await route(p, "#/runs", "#runs-drawer:not([hidden]) .run-card");
    await p.waitForFunction(() => document.querySelectorAll("#b-runs .run-card").length >= 2);
    const ticks = p.locator("#b-runs input[type=checkbox]"); await ticks.nth(0).check(); await ticks.nth(1).check();
    await p.locator("#b-runs .run-card").nth(1).locator("button[aria-haspopup=menu]").click();
    await p.getByRole("menuitem", { name: "Rename" }).click();
    await p.waitForSelector("#b-runs .run-rename input");
    await p.locator("#b-runs .run-card").nth(0).locator("button[aria-haspopup=menu]").click();
    await p.waitForSelector(".pop[role=menu]");
  }, leave: async (p) => { await p.keyboard.press("Escape"); } },
  { name: "builder compare runs", enter: async (p) => {
    await p.click("#b-runs-compare");
    await p.waitForSelector("#b-compare-view:not([hidden]) .b-cmp");
  }, leave: async (p) => { await p.getByRole("button", { name: "Back to result" }).click(); } },
  { name: "builder template menu", enter: async (p) => { await p.click("#b-tpl-menu"); await p.waitForSelector(".pop[role=menu]"); }, leave: (p) => p.keyboard.press("Escape") },
  { name: "builder property picker", enter: async (p) => { await p.click("#b-addfloor"); await p.waitForSelector(".pop .b-pick-list"); }, leave: (p) => p.keyboard.press("Escape") },
  { name: "builder chip checklist", enter: async (p) => { await p.click("#b-locked"); await p.waitForSelector(".pop .b-checks"); }, leave: (p) => p.keyboard.press("Escape") },
  { name: "builder advanced field error", enter: async (p) => {
    await p.click("#b-sec-weights .b-sec-head button");   // the weights' rule rows too
    await p.click("#b-sec-adv .b-sec-head button");
    await p.fill("#b-restarts", "300000");
    await p.click("#b-run");
    await p.waitForSelector("#b-restarts-err");
  }, leave: async (p) => { await p.fill("#b-restarts", "200"); } },
  { name: "builder running", enter: async (p) => {
    // hold the start request so the progress card stays up while it is measured
    await p.route("**/api/optimize", async (r) => { await new Promise<void>((res) => { releaseStart = res; }); await r.abort().catch(() => {}); });
    await p.click("#b-run");
    await p.waitForSelector("#b-msg .b-progress");
  }, leave: async (p) => {
    await p.locator("#b-msg .b-progress").getByRole("button", { name: /Cancel/ }).click();
    await p.waitForFunction(() => !document.querySelector<HTMLButtonElement>("#b-run")?.disabled);
    releaseStart?.();
    await p.unroute("**/api/optimize");
  } },
  { name: "builder current suit", enter: async (p) => {
    const names = await p.locator("#b-char option").allInnerTexts();
    await p.selectOption("#b-char", names[1]!);
    await p.waitForSelector("#b-current");
  } },
];

async function launch(dataDir: string): Promise<{ app: ElectronApplication; page: Page; errors: string[]; size: RealSize }> {
  const { _electron } = await import("playwright");
  const app = await _electron.launch({ args: [ROOT, "--demo", "--data", dataDir], cwd: ROOT, timeout: 60_000 });
  const page = await app.firstWindow();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  // The real window, as close to 1440 × 900 as the screen allows (scripts/electron-window.mts): the scenes
  // measure whichever layout that width shows.
  const size = await fitWindow(app, page, { width: 1440, height: 900 });
  return { app, page, errors, size };
}

// Every theme family the page ships, each measured in both modes on every scene.
const FAMILIES = ["default", "britannia"] as const;

test("[slow] every text, control edge, icon and status dot on the real page passes contrast in both themes, light and dark", async (t) => {
  const why = unavailable();
  if (why) return t.skip(why);
  const dataDir = mkdtempSync(join(tmpdir(), "packrat-contrast-"));
  // setupDone skips the first-run wizard; --demo reads the committed demo scans.
  writeFileSync(join(dataDir, "settings.json"), JSON.stringify({ schemaVersion: 1, shard: "uoalive", setupDone: true }));
  const { app, page, errors, size } = await launch(dataDir);
  t.diagnostic(`window ${size.width} × ${size.height}`);
  try {
    await page.locator("#inv-table tbody tr.item").first().waitFor({ timeout: 30_000 });
    const rows: Array<ContrastRow & { where: string }> = [];
    const seen: string[] = [];
    for (const scene of SCENES) {
      await scene.enter(page);
      // hover fills are states, not surfaces: park the pointer on an empty stretch of the top bar (the
      // tooltip scene keeps its hover, it is what that scene measures)
      if (scene.name !== "item tooltip") await page.mouse.move(Math.min(900, size.width - 20), 4);
      for (const family of FAMILIES) {
        // the page only (applyLook), not the saved ui-prefs: the scene stays as it is while the look changes
        await page.evaluate(async (f) => (await import("/ui/theme.mjs" as string)).applyLook({ theme: f }), family);
        for (const mode of ["light", "dark"] as const) {
          // reduced motion: no colour transition is half-way when the probe reads the computed colours
          await page.emulateMedia({ colorScheme: mode, reducedMotion: "reduce" });
          await page.waitForFunction(([f, m]) => document.documentElement.dataset.theme === f && document.documentElement.dataset.mode === m, [family, mode], { timeout: 5_000 });
          await page.waitForTimeout(80);
          const got = await page.evaluate(probeContrast);
          assert.ok(got.length > 10, `${scene.name} (${family} ${mode}) measured only ${got.length} pairs — did the scene render?`);
          for (const r of got) rows.push({ ...r, where: `${scene.name} · ${family} ${mode}` });
          seen.push(`${scene.name} · ${family} ${mode}: ${got.length}`);
        }
      }
      await page.evaluate(async () => (await import("/ui/theme.mjs" as string)).applyLook({ theme: "default" }));
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
