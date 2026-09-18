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
  // Same shape as shell-smoke.test.mjs's runSmoke: the absolute ROOT (not ".") as args[0] is what
  // main.mjs expects in dev (process.argv.slice(2) skips the electron binary and this project path),
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

    // Task 2, Phase 6: a fresh --data dir has no settings.json, so no client is configured yet —
    // the capability-driven bridge controls (Highlight/Grab/Go to) must not render for any row, and
    // the one-line explanation takes their place instead of a silently missing button.
    assert.equal(await page.locator("#inv-table .act").count(), 0, "no bridge buttons should render with no client configured");
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
  // PACKRAT_ADAPTERS_DIR (the same override app/config.mjs/app/server.test.mjs use) points the whole
  // app — main process and the forked server child, which inherits main's process.env — at this
  // throwaway adapter instead of the repo's real adapters/, without touching electron/main.mjs.
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
