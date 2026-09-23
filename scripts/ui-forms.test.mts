// ui-forms.test.mts — [slow]: the form-like screens in the real Electron window (same launch as
// scripts/ui-shell.test.mts) over the demo data: the Import drawer (design spec 4.9 — the paste default,
// the instant preview and its error, the primary button that says what will happen, ⌘↵, success closing
// the drawer with a toast, files dropped anywhere opening it in Scan files mode), the setup wizard (4.10)
// and Settings (4.11). Skipped when electron or playwright is absent, or under TEST_SKIP_ELECTRON.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import type { ElectronApplication, Page } from "playwright";

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
async function launch(dataDir: string): Promise<{ app: ElectronApplication; page: Page; errors: string[] }> {
  const { _electron } = await import("playwright");
  const app = await _electron.launch({ args: [ROOT, "--demo", "--data", dataDir], cwd: ROOT, timeout: 60_000 });
  const page = await app.firstWindow();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 900));
  return { app, page, errors };
}
const setupDone = (dataDir: string): void => writeFileSync(join(dataDir, "settings.json"), JSON.stringify({ schemaVersion: 1, shard: "uoalive", setupDone: true }));

test("[slow] Import: paste default, instant preview, errors in the card, ⌘↵ imports and closes with a toast, drop opens Scan files", async (t) => {
  const why = unavailable();
  if (why) return t.skip(why);
  const dataDir = mkdtempSync(join(tmpdir(), "packrat-forms-import-"));
  setupDone(dataDir);
  const { app, page, errors } = await launch(dataDir);
  try {
    await page.locator("#inv-table tbody tr.item").first().waitFor({ timeout: 30_000 });
    await page.evaluate(() => { location.hash = "#/import"; });
    await page.waitForSelector("#import-drawer:not([hidden]) #imp-text");
    assert.equal(await page.locator("#imp-client").inputValue(), "classicuo-web", "a paste defaults to the paste client");
    assert.equal(await page.locator("#imp-client option[value=razor-enhanced]").isDisabled(), process.platform !== "win32");
    assert.equal(await page.locator("#imp-go").isDisabled(), true, "nothing to import yet");

    // A paste that doesn't parse: the error sits in the preview card, the primary stays off.
    await page.fill("#imp-text", KESTREL.slice(0, 600));
    await page.waitForSelector(".imp-preview.bad");
    assert.match(await page.locator(".imp-preview").innerText(), /This doesn't read as a scan[\s\S]*invalid JSON/);
    assert.equal(await page.locator("#imp-go").isDisabled(), true);

    // A clean paste: the preview's counts and the button that says what will happen.
    await page.fill("#imp-text", KESTREL);
    await page.waitForSelector(".imp-preview.ok");
    const card = await page.locator(".imp-preview").innerText();
    assert.match(card, /Kestrel's scan reads cleanly/);
    assert.match(card, /8 pieces/);
    assert.match(card, /112 stacks/);
    assert.match(card, /Kestrel is already in Pack Rat\. This scan replaces the older one for Metal Chest 0x700b0000 and the worn gear\./);
    assert.match(await page.locator("#imp-text-help").innerText(), /KB pasted/);
    assert.equal((await page.locator("#imp-go").innerText()).split("\n")[0], "Import 120 stacks for Kestrel");

    // ⌘↵ imports: the drawer closes, the route goes back, a toast says it landed, the file is in the inbox.
    await page.locator("#imp-text").press("ControlOrMeta+Enter");
    await page.waitForFunction(() => document.getElementById("import-drawer")!.hidden || document.querySelector(".imp-preview .msg.bad"), undefined, { timeout: 15_000 });
    assert.equal(await page.locator(".imp-preview .msg.bad").count(), 0, `the import failed: ${await page.locator("#import-body").innerText()}`);
    await page.waitForFunction(() => location.hash === "#/inventory");
    await page.waitForSelector(".toast.ok");
    assert.match(await page.locator(".toast.ok").innerText(), /Kestrel's scan landed/);
    assert.equal(readdirSync(join(dataDir, "inbox", "classicuo-web")).filter((f) => f.endsWith(".json")).length, 1);

    // Files dropped anywhere on the window open the drawer in Scan files mode, one row per file.
    await page.evaluate(([k]) => {
      const dt = new DataTransfer();
      dt.items.add(new File([k!], "Kestrel.json", { type: "application/json" }));
      dt.items.add(new File(["hello"], "notes.txt", { type: "text/plain" }));
      window.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
    }, [KESTREL]);
    await page.waitForSelector("#import-drawer:not([hidden]) .imp-file.bad");
    assert.equal(await page.locator("#imp-mode [aria-checked=true]").innerText(), "Scan files");
    assert.equal(await page.locator(".imp-file").count(), 2);
    assert.match(await page.locator(".imp-file.bad").innerText(), /Not a scan file/);
    assert.equal((await page.locator("#imp-go").innerText()).split("\n")[0], "Import 120 stacks for Kestrel", "only the file that parses counts");
    await page.keyboard.press("Escape");
    await page.waitForSelector("#import-drawer", { state: "hidden" });
    assert.deepEqual(errors, []);
  } finally {
    await app.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});
