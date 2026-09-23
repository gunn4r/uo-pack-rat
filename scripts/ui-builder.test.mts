// ui-builder.test.mts — [slow]: the Suit Builder's keyboard and hover behaviour, driven in the real Electron
// window with Playwright (the launch scripts/ui-state.test.mts uses). Each case is maintainer feedback on the
// redesign (PR #43): ⌘↵ building from anywhere on the screen, not only with focus inside it. Skipped when
// electron or playwright is absent, or under TEST_SKIP_ELECTRON.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { fitWindow } from "./electron-window.mts";
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
// A writable data directory holding the two demo scans, set up so the first-run wizard stays closed.
function seedDataDir(prefix: string): string {
  const dataDir = mkdtempSync(join(tmpdir(), prefix));
  mkdirSync(join(dataDir, "scans"), { recursive: true });
  for (const f of ["demo-Dorran.json", "demo-Kestrel.json"]) copyFileSync(join(ROOT, "app", "fixtures", f), join(dataDir, "scans", f));
  writeFileSync(join(dataDir, "settings.json"), JSON.stringify({ schemaVersion: 1, shard: "uoalive", setupDone: true }));
  return dataDir;
}
async function launch(dataDir: string): Promise<{ app: ElectronApplication; page: Page; errors: string[] }> {
  const { _electron } = await import("playwright");
  const app = await _electron.launch({ args: [ROOT, "--data", dataDir], cwd: ROOT, timeout: 60_000 });
  const page = await app.firstWindow();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await fitWindow(app, page, { width: 1440, height: 900 });
  return { app, page, errors };
}
// The Suit Builder with its first character's current suit showing, and a 2 s time budget so builds are quick.
async function openBuilder(page: Page): Promise<void> {
  await page.locator("#inv-table tbody tr.item").first().waitFor({ timeout: 30_000 });
  await page.click('[data-nav="builder"]');
  await page.waitForSelector("#tab-builder:not([hidden]) #b-current", { timeout: 10_000 });
  await page.click("#b-sec-adv .b-sec-head button");
  await page.fill("#b-budget", "2");
  await page.click("#b-sec-adv .b-sec-head button");
}
const built = (page: Page): Promise<void> => page.waitForFunction(() => !document.querySelector<HTMLButtonElement>("#b-run")?.disabled && /Best suit for/.test(document.querySelector("#b-result h2")?.textContent || ""), undefined, { timeout: 60_000 }).then(() => {});

test("[slow] ⌘↵ builds from anywhere on the Builder screen, and not from behind a drawer", async (t) => {
  const why = unavailable();
  if (why) return t.skip(why);
  const dataDir = seedDataDir("packrat-ui-buildkey-");
  const { app, page, errors } = await launch(dataDir);
  try {
    await openBuilder(page);
    let starts = 0;   // build requests the page sent (a repeat of the same settings saves no second run)
    page.on("request", (r) => { if (r.method() === "POST" && new URL(r.url()).pathname === "/api/optimize") starts++; });
    // A click on plain text leaves focus on <body>, outside the screen: the key still builds.
    await page.click("#b-current h2");
    assert.equal(await page.evaluate(() => document.activeElement?.tagName), "BODY");
    await page.keyboard.press("ControlOrMeta+Enter");
    await built(page);
    assert.equal(starts, 1, "one build from the page body");

    // While typing in a panel field.
    await page.locator("#b-sec-req input[type=number]").first().click();
    const second = page.waitForRequest((r) => r.method() === "POST" && new URL(r.url()).pathname === "/api/optimize", { timeout: 10_000 });
    await page.keyboard.press("ControlOrMeta+Enter");
    await second;
    await built(page);
    assert.equal(starts, 2, "a second build from a requirement field");

    // Behind the Saved runs drawer the screen is inert: no build.
    await page.click("#b-runs-open");
    await page.waitForSelector("#runs-drawer:not([hidden])");
    await page.keyboard.press("ControlOrMeta+Enter");
    await page.waitForTimeout(500);
    assert.equal(await page.locator("#b-run").isDisabled(), false, "no build started behind the drawer");
    assert.equal(starts, 2);
    assert.deepEqual(errors, []);
  } finally {
    await app.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});
