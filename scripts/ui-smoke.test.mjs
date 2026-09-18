// ui-smoke.test.mjs — [slow]: drives the real Electron window with Playwright. The shell smoke test
// proves the app boots and serves; this one proves the page renders and its tabs work. Skipped when
// electron or playwright is absent (a plain clone), or under TEST_SKIP_ELECTRON.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
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
