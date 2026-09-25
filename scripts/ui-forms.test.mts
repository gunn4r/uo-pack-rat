// ui-forms.test.mts — [slow]: the form-like screens in the real Electron window (same launch as
// scripts/ui-shell.test.mts) over the demo data: the Import drawer (design spec 4.9 — the paste default,
// the instant preview and its error, the primary button that says what will happen, ⌘↵, success closing
// the drawer with a toast, files dropped anywhere opening it in Scan files mode), the setup wizard (4.10)
// and Settings (4.11), with its Data retention card. Skipped when electron or playwright is absent, or under TEST_SKIP_ELECTRON.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { fitWindow, testEnv } from "./electron-window.mts";
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
async function launch(dataDir: string, { demo = true } = {}): Promise<{ app: ElectronApplication; page: Page; errors: string[] }> {
  const { _electron } = await import("playwright");
  const app = await _electron.launch({ args: [ROOT, ...(demo ? ["--demo"] : []), "--data", dataDir], cwd: ROOT, timeout: 60_000, env: testEnv() });
  const page = await app.firstWindow();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  // The real window, as close to 1440 × 900 as the screen allows (scripts/electron-window.mts).
  await fitWindow(app, page, { width: 1440, height: 900 });
  return { app, page, errors };
}
// A paste lands as one insertion; typing a 43 KB scan key by key through page.fill() is slow enough to time out
// on a CI runner, and isn't what a player does.
async function paste(page: Page, selector: string, text: string): Promise<void> {
  await page.locator(selector).evaluate((el, t) => {
    const ta = el as HTMLTextAreaElement;
    ta.focus(); ta.value = t;
    ta.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertFromPaste" }));
  }, text);
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
    await paste(page, "#imp-text", KESTREL.slice(0, 600));
    await page.waitForSelector(".imp-preview.bad");
    assert.match(await page.locator(".imp-preview").innerText(), /This doesn't read as a scan[\s\S]*invalid JSON/);
    assert.equal(await page.locator("#imp-go").isDisabled(), true);

    // A clean paste: the preview's counts and the button that says what will happen.
    await paste(page, "#imp-text", KESTREL);
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

test("[slow] Wizard: named stepper with branch-aware labels, radio cards, kept typed path, install then Finish", async (t) => {
  const why = unavailable();
  if (why) return t.skip(why);
  const dataDir = mkdtempSync(join(tmpdir(), "packrat-forms-wizard-"));
  const client = mkdtempSync(join(tmpdir(), "packrat-forms-client-"));
  mkdirSync(join(client, "TazUO", "LegionScripts"), { recursive: true });
  // No settings.json: a first run, so the wizard opens by itself.
  const { app, page, errors } = await launch(dataDir);
  const steps = (): Promise<string[]> => page.locator("#wizard .stepper .step").evaluateAll((els) => els.map((e) => e.firstElementChild!.nextElementSibling!.textContent || ""));
  try {
    await page.waitForSelector("#wizard[open]", { timeout: 30_000 });
    assert.equal(await page.locator("#wiz-title").innerText(), "Set up Pack Rat");
    assert.deepEqual(await steps(), ["Shard", "Client", "Client folder", "Install scanner"]);
    assert.equal(await page.locator("#wizard [aria-current=step]").innerText(), "1\nShard");
    // Changing the shard keeps the wizard open (it is applied at Finish) and the AFK notice follows the pick.
    assert.match(await page.locator("#wizard .wiz-body").innerText(), /UO Alive allows AFK/);
    await page.selectOption("#wiz-shard", "generic-osi");
    assert.equal(await page.locator("#wizard[open]").count(), 1);
    assert.doesNotMatch(await page.locator("#wizard .wiz-body").innerText(), /UO Alive allows AFK/);
    await page.keyboard.press("Enter");   // ↵ is Continue

    // Step 2: radio cards, installable first; a client this machine can't run is shown disabled with the reason.
    await page.waitForSelector("#wizard .wiz-card");
    assert.match(await page.locator("#wizard").innerText(), /Step 2 of 4/);
    // Installable clients this machine can run come first (Razor Enhanced too, on Windows), then the paste client.
    const names = await page.locator("#wizard .wiz-card-name .strong").allInnerTexts();
    const installable = process.platform === "win32" ? ["Razor Enhanced", "TazUO"] : ["TazUO"];
    assert.deepEqual(names.slice(0, installable.length + 1), [...installable, "ClassicUO web client"]);
    assert.notEqual(await page.locator("#wizard input[name=wiz-adapter]:checked").getAttribute("value"), "classicuo-web", "defaults to an installable client");
    if (process.platform !== "win32") {
      assert.equal(await page.locator("#wizard input[value=razor-enhanced]").isDisabled(), true);
      assert.match(await page.locator("#wizard .wiz-card.off").innerText(), /Windows only[\s\S]*Not available on this (Mac|computer)\./);
    }
    // Picking the paste client renames steps 3 and 4 in the stepper at once.
    await page.locator("#wizard input[value=classicuo-web]").check();
    assert.deepEqual(await steps(), ["Shard", "Client", "Nothing to install", "Paste your first scan"]);
    await page.locator("#wizard input[value=tazuo]").check();
    assert.deepEqual(await steps(), ["Shard", "Client", "Client folder", "Install scanner"]);
    await page.click("#wiz-primary");

    // Step 3: a bad path stays in the field with the reason under it; Continue waits for a real folder.
    await page.waitForSelector("#wiz-path");
    assert.equal(await page.locator("#wiz-primary").isDisabled(), true);
    await page.fill("#wiz-path", "/no/such/folder");
    await page.click("#wiz-use-path");
    await page.waitForSelector("#wizard .msg.bad");
    assert.equal(await page.locator("#wiz-path").inputValue(), "/no/such/folder", "the typed path is kept");
    assert.equal(await page.locator("#wiz-path").getAttribute("aria-invalid"), "true");
    assert.match(await page.locator("#wizard .msg.bad").innerText(), /Check the path and try again\./);
    await page.fill("#wiz-path", join(client, "TazUO"));
    await page.locator("#wiz-path").press("Enter");
    await page.waitForSelector("#wizard .msg.ok");
    assert.match(await page.locator("#wizard .msg.ok").innerText(), /LegionScripts/);
    await page.click("#wiz-primary");

    // Step 4: the install is the one primary, gated on the -stopall line; Finish appears only after it succeeds.
    await page.waitForSelector("#wiz-stopall");
    assert.equal(await page.locator("#wiz-primary").innerText().then((s) => s.split("\n")[0]), "Install scanner");
    assert.equal(await page.locator("#wiz-primary").isDisabled(), true);
    assert.equal(await page.locator("#wizard").getByRole("button", { name: "Finish" }).count(), 0);
    await page.check("#wiz-stopall");
    // While the install runs, the button says so and cannot be pressed again.
    let release = (): void => {};
    const held = new Promise<void>((r) => { release = r; });
    await page.route("**/api/setup/install", async (r) => { await held; await r.continue(); });
    await page.click("#wiz-primary");
    await page.waitForFunction(() => document.querySelector<HTMLElement>("#wiz-primary")?.innerText.split("\n")[0] === "Installing…");
    assert.equal(await page.locator("#wiz-primary").isDisabled(), true);
    release();
    await page.waitForSelector("#wizard .wiz-press");
    await page.unroute("**/api/setup/install");
    assert.match(await page.locator("#wizard .wiz-press").innerText(), /packrat-scanner\.py/);
    assert.equal(await page.locator("#wiz-primary").innerText().then((s) => s.split("\n")[0]), "Finish");
    const reloaded = page.waitForEvent("load");   // Finish applies the new shard, which reloads the page
    await page.click("#wiz-primary");
    await page.waitForSelector("#wizard", { state: "hidden" });
    await reloaded;
    const settings = JSON.parse(readFileSync(join(dataDir, "settings.json"), "utf8")) as { shard: string; setupDone: boolean; client: { adapter: string; scriptsDir: string } };
    assert.equal(settings.shard, "generic-osi");
    assert.equal(settings.setupDone, true);
    assert.equal(settings.client.adapter, "tazuo");
    assert.match(settings.client.scriptsDir, /LegionScripts$/);
    assert.deepEqual(errors, []);
  } finally {
    await app.close();
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(client, { recursive: true, force: true });
  }
});

test("[slow] Settings: sections with the client warning, theme and appearance, Run setup, forget with confirm, update check messages", async (t) => {
  const why = unavailable();
  if (why) return t.skip(why);
  const dataDir = mkdtempSync(join(tmpdir(), "packrat-forms-settings-"));
  setupDone(dataDir);
  const { app, page, errors } = await launch(dataDir);
  try {
    await page.locator("#inv-table tbody tr.item").first().waitFor({ timeout: 30_000 });
    await page.evaluate(() => { location.hash = "#/settings"; });
    await page.waitForSelector("#set-general .set-row");
    // No section nav while the page is this short: the four sections' headings, and the client warning beside
    // Game client's.
    assert.equal(await page.locator("#settings-nav").count(), 0);
    assert.deepEqual(await page.locator("#settings-body .set-section h2").allInnerTexts(), ["General", "Game client", "Data", "Updates"]);
    assert.equal(await page.locator("#set-client .set-section-head .dot.warn[aria-label='needs attention']").count(), 1, "no client set up: a warning dot on Game client");
    assert.equal(await page.locator("#settings-body .dot.warn").count(), 1, "and on no other section");
    // The Logs path is the data folder's logs folder in the platform's own separators (Windows is where it matters).
    const [dataPath, logsPath] = await page.locator("#set-data .set-path .mono").allInnerTexts();
    assert.equal(logsPath, join(dataPath!, "logs"));

    // General: the Theme applies at once, is saved as a ui-pref and comes back on the next load; Appearance
    // likewise.
    assert.equal(await page.locator("#set-theme option[value=britannia]").isDisabled(), false);
    assert.equal(await page.locator("#set-theme option[value=britannia]").innerText(), "Britannia");
    await page.selectOption("#set-theme", "britannia");
    await page.waitForFunction(() => document.documentElement.dataset.theme === "britannia");
    await page.waitForFunction(async () => (await (await fetch("/api/ui-prefs")).json()).prefs.theme === "britannia");
    await page.reload();
    await page.waitForSelector("#set-general .set-row");
    await page.waitForFunction(() => document.documentElement.dataset.theme === "britannia");
    assert.equal(await page.locator("#set-theme").inputValue(), "britannia");
    assert.match(await page.locator("#tab-settings .topbar h1").evaluate((h) => getComputedStyle(h).fontFamily), /Cinzel/, "Britannia's display face on the page title");
    await page.selectOption("#set-theme", "default");
    await page.waitForFunction(() => document.documentElement.dataset.theme === "default");
    await page.waitForFunction(async () => (await (await fetch("/api/ui-prefs")).json()).prefs.theme === "default");
    await page.locator("#set-appearance").getByRole("radio", { name: "Dark" }).click();
    await page.waitForFunction(() => document.documentElement.dataset.mode === "dark");
    await page.waitForFunction(async () => (await (await fetch("/api/ui-prefs")).json()).prefs.appearance === "dark");
    await page.locator("#set-appearance").getByRole("radio", { name: "System" }).click();

    // Game client: Run setup is the primary while no client exists; Reinstall waits for one.
    assert.match(await page.locator("#set-run-setup").getAttribute("class") || "", /btn-primary/);
    assert.equal(await page.locator("#set-client").getByRole("button", { name: "Reinstall" }).isDisabled(), true);
    assert.match(await page.locator("#set-client").innerText(), /-stopall/);

    // Data's danger zone asks before forgetting, with the existing copy.
    await page.locator("#set-data").scrollIntoViewIfNeeded();
    assert.deepEqual(await page.locator("#set-forget-who option").allInnerTexts(), ["Dorran", "Kestrel"]);
    await page.click("#set-forget");
    await page.waitForSelector("dialog.dialog[open]");
    assert.equal(await page.locator("dialog.dialog[open] h2").innerText(), "Forget Dorran?");
    await page.keyboard.press("Escape");
    await page.waitForSelector("dialog.dialog[open]", { state: "detached" });
    assert.equal(await page.locator("#set-data a[href='#/containers']").innerText(), "Choose in Containers…");

    // Updates: the running version, and the check's answer as an inline message under its row.
    assert.match(await page.locator("#set-updates").innerText(), /Pack Rat \d+\.\d+\.\d+/);
    await page.route("**/api/update-check", (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, configured: true, error: "GitHub releases/latest returned 404" }) }));
    await page.click("#set-check-updates");
    await page.waitForSelector("#set-updates .msg.bad");
    assert.equal(await page.locator("#set-updates .msg.bad").innerText(), "Could not check: GitHub releases/latest returned 404. Try again later.");
    await page.unroute("**/api/update-check");
    await page.route("**/api/update-check", (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, configured: true, current: "0.1.0", latest: "0.1.0", upToDate: true }) }));
    await page.click("#set-check-updates");
    await page.waitForSelector("#set-updates .msg.ok");
    assert.equal(await page.locator("#set-updates .msg.ok").innerText(), "You have the latest version, 0.1.0.");
    assert.deepEqual(errors, []);
  } finally {
    await app.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("[slow] Settings › Data retention: Clean up now counts, confirms and removes; Keep everything disables it", async (t) => {
  const why = unavailable();
  if (why) return t.skip(why);
  // Not --demo, which prunes nothing: the demo scans plus an older copy of Dorran's, and three saved runs.
  // Keep everything is on at launch so the startup prune leaves them for the button.
  const dataDir = mkdtempSync(join(tmpdir(), "packrat-forms-retention-"));
  mkdirSync(join(dataDir, "scans"));
  mkdirSync(join(dataDir, "runs"));
  for (const name of ["Dorran", "Kestrel"]) writeFileSync(join(dataDir, "scans", `demo-${name}.json`), readFileSync(join(ROOT, "app", "fixtures", `demo-${name}.json`)));
  writeFileSync(join(dataDir, "scans", "old-Dorran.json"), JSON.stringify({ ...JSON.parse(readFileSync(join(ROOT, "app", "fixtures", "demo-Dorran.json"), "utf8")), scannedAt: "2025-01-01T12:00:00" }));
  for (const d of [20, 21, 22]) writeFileSync(join(dataDir, "runs", `r${d}.json`), JSON.stringify({ id: `r${d}`, key: `r${d}`, character: "Dorran", createdAt: `2026-09-${d}T10:00:00Z`, label: "", settings: {}, result: null }));
  writeFileSync(join(dataDir, "settings.json"), JSON.stringify({ schemaVersion: 1, shard: "uoalive", setupDone: true, retention: { keepAll: true, scanDays: 30, runsPerCharacter: 1 } }));
  const { app, page, errors } = await launch(dataDir, { demo: false });
  const retention = (): unknown => JSON.parse(readFileSync(join(dataDir, "settings.json"), "utf8")).retention;
  try {
    await page.locator("#inv-table tbody tr.item").first().waitFor({ timeout: 30_000 });
    await page.evaluate(() => { location.hash = "#/settings"; });
    await page.locator("#set-retention").scrollIntoViewIfNeeded();
    assert.equal(await page.locator("#set-ret-clean").isDisabled(), true, "Keep everything is on");
    await page.locator("#set-retention label.check").click();
    await page.waitForFunction(() => !(document.querySelector("#set-ret-clean") as HTMLButtonElement).disabled);
    assert.deepEqual(retention(), { keepAll: false, scanDays: 30, runsPerCharacter: 1 });

    await page.click("#set-ret-clean");
    await page.waitForSelector("dialog.dialog[open]");
    assert.equal(await page.locator("dialog.dialog[open] h2").innerText(), "Clean up old data?");
    assert.match(await page.locator("dialog.dialog[open]").innerText(), /This removes 1 scan and 2 runs from the data folder for good\. The inventory stays the same\./);
    await page.getByRole("button", { name: "Remove 1 scan and 2 runs" }).click();
    await page.waitForSelector(".toast.ok");
    assert.match(await page.locator(".toast.ok").last().innerText(), /Removed 1 scan and 2 runs\./);
    assert.deepEqual(readdirSync(join(dataDir, "scans")).sort(), ["demo-Dorran.json", "demo-Kestrel.json"]);
    assert.deepEqual(readdirSync(join(dataDir, "runs")), ["r22.json"], "the newest run stays");

    await page.locator("#set-retention label.check").click();
    await page.waitForFunction(() => (document.querySelector("#set-ret-clean") as HTMLButtonElement).disabled);
    assert.equal(await page.locator("#set-ret-runsPerCharacter").isDisabled(), true);
    assert.deepEqual(retention(), { keepAll: true, scanDays: 30, runsPerCharacter: 1 });
    assert.deepEqual(errors, []);
  } finally {
    await app.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});
