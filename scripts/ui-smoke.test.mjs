// ui-smoke.test.mjs — [slow]: drives the real Electron window with Playwright. The shell smoke test
// proves the app boots and serves; this one proves the page renders and its tabs work. Skipped when
// electron or playwright is absent (a plain clone), or under TEST_SKIP_ELECTRON.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const require_ = createRequire(import.meta.url);
function unavailable() {
  if (process.env.TEST_SKIP_ELECTRON) return "TEST_SKIP_ELECTRON is set";
  for (const dep of ["electron", "playwright"]) {
    try { require_.resolve(dep); } catch { return `${dep} is not installed`; }
  }
  return null;
}

test("[slow] the packaged UI renders, switches tabs and lists the demo inventory", async (t) => {
  const why = unavailable();
  if (why) return t.skip(why);

  const { _electron } = await import("playwright");
  const dataDir = mkdtempSync(join(tmpdir(), "packrat-ui-"));
  // Same shape as shell-smoke.test.mts's runSmoke: the absolute ROOT (not ".") as args[0] is what
  // main.mts expects in dev (process.argv.slice(2) skips the electron binary and this project path),
  // and cwd: ROOT keeps that resolution independent of wherever `node --test` was invoked from.
  const app = await _electron.launch({ args: [ROOT, "--demo", "--data", dataDir], cwd: ROOT, timeout: 60_000 });
  try {
    const page = await app.firstWindow();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));

    assert.equal(await page.title(), "Pack Rat");
    await page.waitForSelector("#status", { timeout: 30_000 });

    // The inventory tab is the default: the demo fixtures must produce rows, not the empty state.
    // #inv-table is the real markup (app/index.html) — the tab sections carry no data-tab-panel
    // attribute, only a plain id ("tab-inventory") toggled via the [hidden] attribute.
    const rows = page.locator("#inv-table tbody tr");
    await rows.first().waitFor({ timeout: 30_000 });
    assert.ok(await rows.count() > 0, "demo fixtures should fill the inventory table");

    // Task 2, Phase 6 (bug fix, later): a fresh --data dir has no settings.json, so no client is
    // configured yet, but GET /api/setup's `bridgeAdapter` still resolves to "tazuo" here (this run
    // uses the repo's real adapters/ dir, and POST /api/bridge itself already falls back to tazuo when
    // no client is configured) — so app/ui/bridge.mjs's currentAdapter() falls back to it too, and the
    // real tazuo adapter's full capabilities.bridge means every row gets all three buttons. The note
    // is a short explanation of that fallback, not a "here's what's missing" message — it still
    // contains "client", so it isn't asserted more precisely here (see the dedicated fallback-note
    // check in app/server.test.mjs and app/bridge-adapter-fallback.test.mjs).
    await page.waitForSelector("#inv-table .act button", { timeout: 10_000 });
    const fallbackLabels = await page.locator("#inv-table .act button").allInnerTexts();
    for (const want of ["Highlight", "Grab", "Go to"]) {
      assert.ok(fallbackLabels.includes(want), `expected a "${want}" button somewhere in the table (bridgeAdapter fallback), got ${JSON.stringify(fallbackLabels)}`);
    }
    await page.waitForSelector("#inv-bridge-note .bridge-note", { timeout: 10_000 });
    assert.match(await page.locator("#inv-bridge-note .bridge-note").innerText(), /client/i);

    // A fresh --data dir has no settings.json, so /api/setup reports firstRun and app.mjs's load()
    // opens the first-run wizard (a <dialog>) on top of everything — real behavior for a new user,
    // not a test artifact, so it's dismissed the way a user would (ui/wizard.mjs's Skip button)
    // rather than worked around.
    await page.waitForSelector("#wizard[open]", { timeout: 10_000 });
    await page.locator("#wizard").getByRole("button", { name: "Skip" }).click();
    await page.waitForSelector("#wizard", { state: "hidden", timeout: 10_000 });

    // Switching tabs is the one interaction every session starts with.
    await page.click('[role="tab"][data-tab="characters"]');
    await page.waitForSelector("#tab-characters:not([hidden])", { timeout: 10_000 });

    assert.deepEqual(errors, [], "no uncaught page errors during load and tab switch");
  } finally {
    await app.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

// Post-review fix (Task 2, Phase 6, round 1): the no-bridge case above was covered at the DOM level,
// but "TazUO shows all three buttons and no note" and "a partial-bridge adapter offers only its
// declared action" were only exercised through GET /api/setup's JSON (app/server.test.mjs) — a
// regression in the actual render path (app/ui/bridge.mjs's actButtons()/bridgeNote()) could pass
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
  const app = await _electron.launch({ args: [ROOT, "--demo", "--data", dataDir], cwd: ROOT, timeout: 60_000 });
  try {
    const page = await app.firstWindow();
    await page.waitForSelector("#status", { timeout: 30_000 });
    await page.locator("#inv-table tbody tr").first().waitFor({ timeout: 30_000 });

    await page.waitForSelector("#inv-table .act button", { timeout: 10_000 });
    const labels = await page.locator("#inv-table .act button").allInnerTexts();
    for (const want of ["Highlight", "Grab", "Go to"]) {
      assert.ok(labels.includes(want), `expected a "${want}" button somewhere in the table, got ${JSON.stringify(labels)}`);
    }
    assert.equal(await page.locator("#inv-bridge-note .bridge-note").count(), 0, "tazuo has full bridge support — nothing to explain");
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
  // PACKRAT_ADAPTERS_DIR (the same override app/config.mts/app/server.test.mjs use) points the whole
  // app — main process and the forked server child, which inherits main's process.env — at this
  // throwaway adapter instead of the repo's real adapters/, without touching electron/main.mts.
  const app = await _electron.launch({
    args: [ROOT, "--demo", "--data", dataDir], cwd: ROOT, timeout: 60_000,
    env: { ...process.env, PACKRAT_ADAPTERS_DIR: adaptersDir },
  });
  try {
    const page = await app.firstWindow();
    await page.waitForSelector("#status", { timeout: 30_000 });
    await page.locator("#inv-table tbody tr").first().waitFor({ timeout: 30_000 });

    await page.waitForSelector("#inv-table .act button", { timeout: 10_000 });
    const labels = await page.locator("#inv-table .act button").allInnerTexts();
    assert.ok(labels.length > 0, "at least one row should offer Highlight");
    assert.ok(labels.every((l) => l === "Highlight"), `only Highlight should render, got ${JSON.stringify(labels)}`);

    await page.waitForSelector("#inv-bridge-note .bridge-note", { timeout: 10_000 });
    const note = await page.locator("#inv-bridge-note .bridge-note").innerText();
    assert.match(note, /Highlight/, note);
    assert.match(note, /Grab/, note);
    assert.match(note, /Go to/, note);
  } finally {
    await app.close();
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(adaptersDir, { recursive: true, force: true });
  }
});

// Bug fix (round 2): the Suit Builder's "Save as…" used window.prompt(), which Electron does not
// implement (it returns null/undefined with no error, so the handler's `if (!name) return` bailed
// silently) — it worked in a plain browser, which is why the bug went unnoticed until it shipped.
// ui/dialog.mjs's promptText() replaces it with an in-page <dialog>; this drives the real Electron
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
  const app = await _electron.launch({ args: [ROOT, "--demo", "--data", dataDir], cwd: ROOT, timeout: 60_000 });
  try {
    const page = await app.firstWindow();
    await page.waitForSelector("#status", { timeout: 30_000 });

    await page.click('[role="tab"][data-tab="builder"]');
    await page.waitForSelector("#tab-builder:not([hidden])", { timeout: 10_000 });
    // buildBuilder() auto-selects the first character from the demo fixtures (Dorran/Kestrel) once
    // its <option>s exist — the "Save as…" button needs a selected character's settings to snapshot.
    await page.waitForFunction(() => document.querySelector("#b-char")?.value, { timeout: 10_000 });

    await page.click("#b-tpl-saveas");
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

    const r = await page.evaluate(() => fetch("/api/profiles").then((res) => res.json()));
    const names = Object.keys(r.profiles?.templates || {});
    assert.ok(names.includes(templateName), `expected "${templateName}" among the saved templates, got ${JSON.stringify(names)}`);
  } finally {
    await app.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});
// Small helper: assert the given locator's element is the page's activeElement — Playwright has no
// built-in "is focused" locator assertion in this project's test setup (no @playwright/test expect()),
// so this reads document.activeElement inside the page instead.
async function expectFocused(page, locator) {
  const handle = await locator.elementHandle();
  const focused = await page.evaluate((el) => el === document.activeElement, handle);
  assert.ok(focused, "expected the dialog's input to be focused");
}
