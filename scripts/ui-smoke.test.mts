// ui-smoke.test.mts — [slow]: drives the real Electron window with Playwright. The shell smoke test
// proves the app boots and serves; this one proves the page renders and its tabs work. Skipped when
// electron or playwright is absent (a plain clone), or under TEST_SKIP_ELECTRON.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import type { Page } from "playwright";
import { testEnv } from "./electron-window.mts";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const require_ = createRequire(import.meta.url);
function unavailable(): string | null {
  if (process.env.TEST_SKIP_ELECTRON) return "TEST_SKIP_ELECTRON is set";
  for (const dep of ["electron", "playwright"]) {
    try { require_.resolve(dep); } catch { return `${dep} is not installed`; }
  }
  return null;
}

// The Inventory's row actions (ui/inventory.mts): icon buttons named by aria-label, drawn on every row
// and shown on hover. A disabled one hangs its reason on a wrapper's tooltip (components.mts tipWrap).
async function rowActionLabels(page: Page): Promise<string[]> {
  await page.waitForSelector("#inv-table tbody tr.item .rowact button", { state: "attached", timeout: 10_000 });
  return page.locator("#inv-table tbody tr.item").first().locator(".rowact button").evaluateAll((bs) => bs.map((b) => b.getAttribute("aria-label") || ""));
}
async function actionReason(page: Page, action: string): Promise<string> {
  const row = page.locator("#inv-table tbody tr.item").first();
  await row.hover();
  const wrap = row.locator(".rowact .tipwrap", { has: page.locator(`button[aria-label="${action}"]`) });
  if (!await wrap.count()) return "";
  await wrap.hover();
  const tip = page.locator(".tip[role=tooltip]").last();
  await tip.waitFor({ timeout: 5_000 });
  const text = await tip.innerText();
  await page.mouse.move(0, 0);
  return text;
}

test("[slow] the packaged UI renders, switches tabs and lists the demo inventory", async (t) => {
  const why = unavailable();
  if (why) return t.skip(why);

  const { _electron } = await import("playwright");
  const dataDir = mkdtempSync(join(tmpdir(), "packrat-ui-"));
  // Same shape as shell-smoke.test.mts's runSmoke: the absolute ROOT (not ".") as args[0] is what
  // main.mts expects in dev (process.argv.slice(2) skips the electron binary and this project path),
  // and cwd: ROOT keeps that resolution independent of wherever `node --test` was invoked from.
  const app = await _electron.launch({ args: [ROOT, "--demo", "--data", dataDir], cwd: ROOT, timeout: 60_000, env: testEnv() });
  try {
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));

    assert.equal(await page.title(), "Pack Rat");
    await page.waitForSelector("#status", { state: "attached", timeout: 30_000 });   // attached, not visible: a narrow window collapses the sidebar, which hides the status line

    // The inventory tab is the default: the demo fixtures must produce rows, not the empty state.
    // #inv-table is the real markup (app/index.html) — the tab sections carry no data-tab-panel
    // attribute, only a plain id ("tab-inventory") toggled via the [hidden] attribute.
    const rows = page.locator("#inv-table tbody tr.item");
    await rows.first().waitFor({ timeout: 30_000 });
    assert.ok(await rows.count() > 0, "demo fixtures should fill the inventory table");

    // A fresh --data dir has no settings.json, so /api/setup reports firstRun and app.mts's load()
    // opens the first-run wizard (a <dialog>) on top of everything — real behavior for a new user,
    // not a test artifact, so it's dismissed the way a user would (ui/wizard.mts's Set up later button)
    // rather than worked around.
    await page.waitForSelector("#wizard[open]", { timeout: 10_000 });
    await page.locator("#wizard").getByRole("button", { name: "Set up later" }).click();
    await page.waitForSelector("#wizard", { state: "hidden", timeout: 10_000 });

    // Task 2, Phase 6 (bug fix, later): a fresh --data dir has no settings.json, so no client is
    // configured yet, but GET /api/setup's `bridgeAdapter` still resolves to "tazuo" here (this run
    // uses the repo's real adapters/ dir, and POST /api/bridge itself already falls back to tazuo when
    // no client is configured) — so app/ui/bridge.mts's currentAdapter() falls back to it too, and the
    // real tazuo adapter's full capabilities.bridge means every row gets all three actions. The bridge
    // itself is not running, so each is drawn disabled with the offline reason (design spec 3.5), and
    // the old amber "No client set up" bar above the table is gone: the sidebar's bridge control says it.
    const labels = await rowActionLabels(page);
    for (const want of ["Highlight in game", "Grab to backpack", "Go to container"]) {
      assert.ok(labels.includes(want), `expected a "${want}" row action somewhere in the table (bridgeAdapter fallback), got ${JSON.stringify(labels)}`);
    }
    assert.match(await actionReason(page, "Grab to backpack"), /Bridge offline/);
    assert.equal(await page.locator("#tab-inventory .bridge-note").count(), 0, "no amber client bar inside the Inventory");


    // Switching tabs is the one interaction every session starts with.
    await page.click('[data-nav="characters"]');
    await page.waitForSelector("#tab-characters:not([hidden])", { timeout: 10_000 });

    assert.deepEqual(errors, [], "no uncaught page errors during load and tab switch");
  } finally {
    await app.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

// Post-review fix (Task 2, Phase 6, round 1): the no-bridge case above was covered at the DOM level,
// but "TazUO shows all three buttons and no note" and "a partial-bridge adapter offers only its
// declared action" were only exercised through GET /api/setup's JSON (app/server.test.mts) — a
// regression in the actual render path (app/ui/bridge.mts's actButtons()/bridgeNote()) could pass
// every existing test. These two prove the other two gate conditions at the DOM level too.
test("[slow] with tazuo configured, the demo inventory shows all three bridge buttons and no note", async (t) => {
  const why = unavailable();
  if (why) return t.skip(why);

  const { _electron } = await import("playwright");
  const dataDir = mkdtempSync(join(tmpdir(), "packrat-ui-tazuo-"));
  // Pre-seed settings.json (setupDone: true skips the wizard; client names the real tazuo adapter,
  // whose adapters/tazuo/capabilities.json declares all three bridge actions) rather than driving
  // the wizard through the UI — this test is about the render path once a client IS configured, not
  // about the wizard flow itself (already covered above).
  writeFileSync(join(dataDir, "settings.json"), JSON.stringify({
    schemaVersion: 1, shard: "uoalive", setupDone: true, client: { adapter: "tazuo", scriptsDir: dataDir },
  }));
  const app = await _electron.launch({ args: [ROOT, "--demo", "--data", dataDir], cwd: ROOT, timeout: 60_000, env: testEnv() });
  try {
    const page = await app.firstWindow();
    await page.waitForSelector("#status", { state: "attached", timeout: 30_000 });   // attached, not visible: a narrow window collapses the sidebar, which hides the status line
    await page.locator("#inv-table tbody tr.item").first().waitFor({ timeout: 30_000 });

    const labels = await rowActionLabels(page);
    for (const want of ["Highlight in game", "Grab to backpack", "Go to container"]) {
      assert.ok(labels.includes(want), `expected a "${want}" row action somewhere in the table, got ${JSON.stringify(labels)}`);
    }
    // TazUO supports all three, so the only reason a Grab is off here is the bridge not running.
    assert.equal(await actionReason(page, "Grab to backpack"), "Bridge offline. Press Play on packrat-bridge.py in game.");
    assert.equal(await page.locator("#tab-inventory .bridge-note").count(), 0, "tazuo has full bridge support — nothing to explain");
    assert.equal(await page.locator("#wizard[open]").count(), 0, "setupDone:true should skip the first-run wizard");
  } finally {
    await app.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("[slow] a partial-bridge adapter only offers its declared action, and the note names what's missing", async (t) => {
  const why = unavailable();
  if (why) return t.skip(why);

  const { _electron } = await import("playwright");
  const dataDir = mkdtempSync(join(tmpdir(), "packrat-ui-partial-"));
  const adaptersDir = mkdtempSync(join(tmpdir(), "packrat-ui-partial-adapters-"));
  const partialDir = join(adaptersDir, "partial-bridge");
  mkdirSync(partialDir, { recursive: true });
  writeFileSync(join(partialDir, "capabilities.json"), JSON.stringify({
    adapter: "partial-bridge", version: "1.0.0", transport: "folder",
    capabilities: { layers: [], arms: false, bank: false, ground: false, nested: false, tooltips: "label", bridge: ["highlight"] },
  }));
  writeFileSync(join(dataDir, "settings.json"), JSON.stringify({
    schemaVersion: 1, shard: "uoalive", setupDone: true, client: { adapter: "partial-bridge", scriptsDir: dataDir },
  }));
  // PACKRAT_ADAPTERS_DIR (the same override app/config.mts/app/server.test.mts use) points the whole
  // app — main process and the forked server child, which inherits main's process.env — at this
  // throwaway adapter instead of the repo's real adapters/, without touching electron/main.mts.
  const app = await _electron.launch({
    args: [ROOT, "--demo", "--data", dataDir], cwd: ROOT, timeout: 60_000,
    env: testEnv({ PACKRAT_ADAPTERS_DIR: adaptersDir }),
  });
  try {
    const page = await app.firstWindow();
    await page.waitForSelector("#status", { state: "attached", timeout: 30_000 });   // attached, not visible: a narrow window collapses the sidebar, which hides the status line
    await page.locator("#inv-table tbody tr.item").first().waitFor({ timeout: 30_000 });

    // The row keeps all three buttons, so the table never changes shape; the two this client lacks
    // are disabled and say why, naming the client.
    const labels = await rowActionLabels(page);
    for (const want of ["Highlight in game", "Grab to backpack", "Go to container"]) assert.ok(labels.includes(want), `${want} in ${JSON.stringify(labels)}`);
    assert.match(await actionReason(page, "Grab to backpack"), /can't Grab/);
    assert.match(await actionReason(page, "Go to container"), /can't Go to/);
    assert.match(await actionReason(page, "Highlight in game"), /Bridge offline/, "Highlight is supported, so only the bridge being off holds it back");
  } finally {
    await app.close();
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(adaptersDir, { recursive: true, force: true });
  }
});

// Bug fix (round 2): the Suit Builder's "Save as…" used window.prompt(), which Electron does not
// implement (it returns null/undefined with no error, so the handler's `if (!name) return` bailed
// silently) — it worked in a plain browser, which is why the bug went unnoticed until it shipped.
// ui/dialog.mts's promptText() replaces it with an in-page <dialog>; this drives the real Electron
// window through Save as… end to end (open the builder, click Save as…, type a name in the dialog,
// confirm) and checks the template landed server-side, the one thing window.prompt() could never do.
test("[slow] Save as… in the suit builder opens an in-page dialog and saves the template (Electron has no window.prompt)", async (t) => {
  const why = unavailable();
  if (why) return t.skip(why);

  const { _electron } = await import("playwright");
  const dataDir = mkdtempSync(join(tmpdir(), "packrat-ui-saveas-"));
  // setupDone:true skips the first-run wizard (already covered above) — this test is about the
  // Save as… dialog, not the wizard flow.
  writeFileSync(join(dataDir, "settings.json"), JSON.stringify({ schemaVersion: 1, shard: "uoalive", setupDone: true }));
  const app = await _electron.launch({ args: [ROOT, "--demo", "--data", dataDir], cwd: ROOT, timeout: 60_000, env: testEnv() });
  try {
    const page = await app.firstWindow();
    await page.waitForSelector("#status", { state: "attached", timeout: 30_000 });   // attached, not visible: a narrow window collapses the sidebar, which hides the status line

    await page.click('[data-nav="builder"]');
    await page.waitForSelector("#tab-builder:not([hidden])", { timeout: 10_000 });
    // buildBuilder() auto-selects the first character from the demo fixtures (Dorran/Kestrel) once
    // its <option>s exist — the "Save as…" button needs a selected character's settings to snapshot.
    await page.waitForFunction(() => document.querySelector<HTMLSelectElement>("#b-char")?.value, { timeout: 10_000 });

    await page.click("#b-tpl-menu");   // Save as… lives in the template's ⋯ menu
    await page.getByRole("menuitem", { name: "Save as…" }).click();
    const dialog = page.locator(".prompt-dialog[open]");
    await dialog.waitFor({ timeout: 10_000 });
    const input = dialog.locator("input[type=text]");
    // Focus lands in the input with its text selected (any existing text is a type-over, not an edit) —
    // typing replaces the selection rather than appending to it.
    await expectFocused(page, input);
    const templateName = `UI Smoke Template ${Date.now()}`;
    await input.fill(templateName);
    await dialog.getByRole("button", { name: "Save" }).click();
    await dialog.waitFor({ state: "detached", timeout: 10_000 });

    const r: { profiles?: { templates?: Record<string, unknown> } } = await page.evaluate(() => fetch("/api/profiles").then((res) => res.json()));
    const names = Object.keys(r.profiles?.templates || {});
    assert.ok(names.includes(templateName), `expected "${templateName}" among the saved templates, got ${JSON.stringify(names)}`);
  } finally {
    await app.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});
// A test launch must never read a real game-client folder (it once found the maintainer's own TazUO
// packrat-paths.json and showed his home paths in the data-folder banner). testEnv() points the server's client
// search at a throwaway home; here a client planted in that home, whose scripts write elsewhere, is the only
// one the app finds, so the search looked there and nowhere else (a real ~/Desktop/TazUO on the machine
// running the test would show up as a second candidate or as the mismatch's folder).
test("[slow] an Electron test launch searches only its own temp home for game clients", async (t) => {
  const why = unavailable();
  if (why) return t.skip(why);
  const { _electron } = await import("playwright");
  const dataDir = mkdtempSync(join(tmpdir(), "packrat-ui-clienthome-data-"));
  const home = mkdtempSync(join(tmpdir(), "packrat-ui-clienthome-"));
  const scripts = join(home, "Desktop", "TazUO", "TazUO", "LegionScripts");
  mkdirSync(scripts, { recursive: true });
  writeFileSync(join(scripts, "packrat-scanner.py"), "# planted by the test\n");
  writeFileSync(join(scripts, "packrat-paths.json"), JSON.stringify({ dataDir: join(home, "elsewhere") }));
  writeFileSync(join(dataDir, "settings.json"), JSON.stringify({ schemaVersion: 1, shard: "uoalive", setupDone: true }));
  // Not --demo: the data-folder check (the banner's source) only runs on a real data folder.
  const app = await _electron.launch({ args: [ROOT, "--data", dataDir], cwd: ROOT, timeout: 60_000, env: testEnv({}, home) });
  try {
    const page = await app.firstWindow();
    await page.waitForSelector("#status", { state: "attached", timeout: 30_000 });
    const setup: { candidates: Record<string, string[]>; dataDirCheck?: { status: string; scriptsDir?: string } } = await page.evaluate(() => fetch("/api/setup").then((r) => r.json()));
    const found = Object.values(setup.candidates).flat();
    assert.deepEqual(found.map((p) => realpathSync(p)), [realpathSync(scripts)], "the planted client is the only one found");
    assert.equal(setup.dataDirCheck?.status, "mismatch");
    assert.equal(realpathSync(setup.dataDirCheck!.scriptsDir!), realpathSync(scripts));
  } finally {
    await app.close();
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});
// Small helper: assert the given locator's element is the page's activeElement — Playwright has no
// built-in "is focused" locator assertion in this project's test setup (no @playwright/test expect()),
// so this reads document.activeElement inside the page instead.
async function expectFocused(page: Page, locator: ReturnType<Page["locator"]>): Promise<void> {
  const handle = await locator.elementHandle();
  const focused = await page.evaluate((el) => el === document.activeElement, handle);
  assert.ok(focused, "expected the dialog's input to be focused");
}
