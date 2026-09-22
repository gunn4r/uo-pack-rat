// ui-state.test.mts — [slow]: the page's state transitions, driven in the real Electron window with
// Playwright (the same launch as scripts/ui-smoke.test.mts, which covers boot and tabs). Each case
// here is a bug the 2026-09-22 review reproduced in a browser: a refresh resetting the filter
// dropdowns while the table stayed filtered, the pager running off the end after a Forget, Forget
// re-running the whole page load (duplicated weapon options, the builder jumping to the first
// character), a build shown under whichever character was selected when it finished, a failed request
// leaving Settings on "loading…" forever, and no way to forget a character. Skipped when electron or
// playwright is absent, or under TEST_SKIP_ELECTRON.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
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

// A writable data directory holding the two demo scans (not --demo: Forget refuses to write into the
// committed fixtures). setupDone skips the first-run wizard unless a case wants it.
function seedDataDir(prefix: string, { setupDone = true } = {}): string {
  const dataDir = mkdtempSync(join(tmpdir(), prefix));
  mkdirSync(join(dataDir, "scans"), { recursive: true });
  for (const f of ["demo-Dorran.json", "demo-Kestrel.json"]) copyFileSync(join(ROOT, "app", "fixtures", f), join(dataDir, "scans", f));
  if (setupDone) writeFileSync(join(dataDir, "settings.json"), JSON.stringify({ schemaVersion: 1, shard: "uoalive", setupDone: true }));
  return dataDir;
}
async function launch(dataDir: string): Promise<{ app: ElectronApplication; page: Page; errors: string[] }> {
  const { _electron } = await import("playwright");
  const app = await _electron.launch({ args: [ROOT, "--data", dataDir], cwd: ROOT, timeout: 60_000 });
  const page = await app.firstWindow();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  return { app, page, errors };
}
const pagerText = (page: Page): Promise<string> => page.locator("#inv-pager-text").innerText();
// The table fetch is debounced (150 ms) and asynchronous: wait until the pager shows `want`.
async function waitPager(page: Page, want: RegExp): Promise<void> {
  await page.waitForFunction((src) => new RegExp(src).test(document.querySelector("#inv-pager-text")?.textContent || ""), want.source, { timeout: 15_000 });
}
async function openTab(page: Page, tab: string): Promise<void> {
  await page.click(`[role="tab"][data-tab="${tab}"]`);
  await page.waitForSelector(`#tab-${tab}:not([hidden])`, { timeout: 10_000 });
}

test("[slow] refresh, Forget and paging keep the page's state", async (t) => {
  const why = unavailable();
  if (why) return t.skip(why);
  const dataDir = seedDataDir("packrat-ui-state-");
  const { app, page, errors } = await launch(dataDir);
  try {
    await page.locator("#inv-table tbody tr.item").first().waitFor({ timeout: 30_000 });
    // Confirmation prompts are the player's; the test answers yes.
    await page.evaluate(() => { window.confirm = () => true; });

    // A background refresh (what the "inventory" SSE event runs) must leave the filter dropdown
    // showing the filter the table still applies.
    await page.selectOption("#f-slot", "bracelet");
    await waitPager(page, /^1–\d+ of \d+$/);
    const filtered = await pagerText(page);
    // The page's own module (same URL as its <script>, so the same instance).
    await page.evaluate(async (url) => { await (await import(url)).reload(); }, "/ui/app.mjs");
    await waitPager(page, /of/);
    assert.equal(await page.locator("#f-slot").inputValue(), "bracelet", "the Slot filter still reads bracelet after a refresh");
    assert.equal(await pagerText(page), filtered);

    // "Clear all" clears every filter, the checkboxes and Kind included.
    await page.check("#f-nogarg");
    await page.click("#f-clear");
    await waitPager(page, /^1–100 of 160$|^1–160 of 160$/);
    assert.equal(await page.locator("#f-slot").inputValue(), "");
    assert.equal(await page.locator("#f-nogarg").isChecked(), false);

    // Paging: 100 per page, go to the second page, then Forget the biggest container. The pager must
    // land on a page that has rows, not "101–48 of 48" over an empty table.
    await page.selectOption("#inv-pagesize", "100");
    await waitPager(page, /^1–100 of 160$/);
    await page.click("#inv-next");
    await waitPager(page, /^101–160 of 160$/);

    // Pick the second character in the builder, so a Forget that reloads the whole page (and snaps
    // the builder back to the first character) shows up.
    await openTab(page, "builder");
    await page.waitForFunction(() => document.querySelector<HTMLSelectElement>("#b-char")?.value, { timeout: 10_000 });
    const names = await page.locator("#b-char option").allInnerTexts();
    await page.selectOption("#b-char", names[1]!);
    const weaponOptions = await page.locator("#b-weapon option").count();

    await openTab(page, "containers");
    const counts = await page.locator("#cont-table tbody tr td:nth-child(5)").allInnerTexts();
    const biggest = counts.map(Number).reduce((best, n, i, all) => (n > all[best]! ? i : best), 0);
    await page.locator("#cont-table tbody tr").nth(biggest).getByRole("button", { name: "Forget" }).click();
    await waitPager(page, /^1–\d+ of \d+$/);
    const after = await pagerText(page);
    assert.match(after, /^1–(\d+) of \1$/, `the pager lands on the only page left, got ${after}`);
    assert.ok(await page.locator("#inv-table tbody tr.item").count() > 0, "rows are shown after the Forget");
    assert.equal(await page.locator("#b-weapon option").count(), weaponOptions, "Forget does not add another set of weapon options");
    assert.equal(await page.locator("#b-char").inputValue(), names[1], "Forget does not move the builder to another character");

    assert.deepEqual(errors, []);
  } finally {
    await app.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("[slow] a build finished for one character is never shown under another", async (t) => {
  const why = unavailable();
  if (why) return t.skip(why);
  const dataDir = seedDataDir("packrat-ui-build-");
  const { app, page, errors } = await launch(dataDir);
  try {
    await page.locator("#inv-table tbody tr.item").first().waitFor({ timeout: 30_000 });
    await openTab(page, "builder");
    await page.waitForFunction(() => document.querySelector<HTMLSelectElement>("#b-char")?.value, { timeout: 10_000 });
    const [builtFor, other] = await page.locator("#b-char option").allInnerTexts() as [string, string];
    await page.selectOption("#b-char", builtFor);
    await page.fill("#b-budget", "3");
    await page.click("#b-run");
    await page.selectOption("#b-char", other);
    // The job ends when Build is enabled again.
    await page.waitForFunction(() => !document.querySelector<HTMLButtonElement>("#b-run")?.disabled, undefined, { timeout: 60_000 });
    const shown = await page.locator("#b-result").innerText();
    assert.doesNotMatch(shown, /Best suit for/, `the other character's panel must not show this build, got ${shown}`);
    const msg = await page.locator("#b-msg").innerText();
    assert.match(msg, new RegExp(`${builtFor}'s build finished`), `the message says whose build finished, got ${msg}`);

    // Switching back shows it, under the right name.
    await page.selectOption("#b-char", builtFor);
    await page.waitForSelector("#b-result h2", { timeout: 10_000 });
    assert.equal(await page.locator("#b-result h2").first().innerText(), `Best suit for ${builtFor}`);
    assert.match(await page.locator("#b-result .sheet").first().innerText(), new RegExp(builtFor));

    assert.deepEqual(errors, []);
  } finally {
    await app.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("[slow] a character can be forgotten from the Characters tab", async (t) => {
  const why = unavailable();
  if (why) return t.skip(why);
  const dataDir = seedDataDir("packrat-ui-forgetchar-");
  const { app, page, errors } = await launch(dataDir);
  try {
    await page.locator("#inv-table tbody tr.item").first().waitFor({ timeout: 30_000 });
    await page.evaluate(() => { window.confirm = () => true; });
    await openTab(page, "characters");
    const cards = page.locator("#char-cards > .panel");
    assert.equal(await cards.count(), 2);
    const gone = await cards.first().locator("h2").innerText();
    await cards.first().getByRole("button", { name: "Forget" }).click();
    await page.waitForFunction(() => document.querySelectorAll("#char-cards > .panel").length === 1, undefined, { timeout: 15_000 });
    assert.notEqual(await cards.first().locator("h2").innerText(), gone);
    // Its worn set left the inventory with it.
    const locs = await page.locator("#f-loc option").allInnerTexts();
    assert.ok(!locs.includes(`Worn by ${gone}`), `no "Worn by ${gone}" location is left, got ${JSON.stringify(locs)}`);
    assert.doesNotMatch(await page.locator("#b-char").innerText(), new RegExp(gone));

    assert.deepEqual(errors, []);
  } finally {
    await app.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("[slow] a failed request during load shows an error, renders Settings and still opens the wizard", async (t) => {
  const why = unavailable();
  if (why) return t.skip(why);
  // No settings.json: a first run, so the wizard should open whatever the inventory fetch does.
  const dataDir = seedDataDir("packrat-ui-loadfail-", { setupDone: false });
  const { app, page } = await launch(dataDir);
  try {
    await page.waitForSelector("#status", { timeout: 30_000 });
    await page.route("**/api/profiles", (route) => route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ ok: false, error: "internal error" }) }));
    await page.reload();
    await page.waitForSelector("#wizard[open]", { timeout: 15_000 });
    await page.locator("#wizard").getByRole("button", { name: "Skip" }).click();
    await page.waitForFunction(() => !/loading/.test(document.querySelector("#settings-body")?.textContent || "loading"), undefined, { timeout: 15_000 });
    assert.doesNotMatch(await page.locator("#import-body").innerText(), /^loading/);
    await openTab(page, "characters");
    assert.match(await page.locator("#char-cards").innerText(), /\/api\/profiles/, "the Characters tab names the request that failed");
    await openTab(page, "builder");
    assert.match(await page.locator("#b-result").innerText(), /\/api\/profiles/, "the Suit Builder names the request that failed");
  } finally {
    await app.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

// The desktop app serves the page from a new port on every launch, so a column choice kept in
// localStorage (scoped to one origin) was gone at the next start. It is kept by the server now.
test("[slow] the Inventory column choice survives a restart of the desktop app", async (t) => {
  const why = unavailable();
  if (why) return t.skip(why);
  const dataDir = seedDataDir("packrat-ui-cols-");
  try {
    let chip: string, origin: string;
    {
      const { app, page } = await launch(dataDir);
      try {
        await page.locator("#inv-table tbody tr.item").first().waitFor({ timeout: 30_000 });
        origin = new URL(page.url()).origin;
        const off = page.locator('#cols button[aria-pressed="false"]').first();
        chip = await off.innerText();
        await off.click();
        await page.waitForFunction((c) => [...document.querySelectorAll("#inv-table thead th")].some((th) => th.textContent?.startsWith(c)), chip, { timeout: 10_000 });
        // The PUT is fire-and-forget from the page; wait until the server has it.
        await page.waitForFunction(async () => ((await (await fetch("/api/ui-prefs")).json()).prefs.cols || []).length > 0, undefined, { timeout: 10_000 });
      } finally {
        await app.close();
      }
    }
    const { app, page } = await launch(dataDir);
    try {
      await page.locator("#inv-table tbody tr.item").first().waitFor({ timeout: 30_000 });
      assert.notEqual(new URL(page.url()).origin, origin, "a new launch is a new origin");
      await page.waitForFunction((c) => [...document.querySelectorAll("#cols button")].some((b) => b.textContent === c && b.getAttribute("aria-pressed") === "true"), chip, { timeout: 10_000 });
    } finally {
      await app.close();
    }
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

// The saved-runs path has its own awaits: openRun fetches the run and resolves its pieces before
// drawing, and loadRuns fetches the list. A character switch during either must not draw one
// character's run (or list) under another.
test("[slow] a saved run or run list that lands after a character switch is not shown under the new character", async (t) => {
  const why = unavailable();
  if (why) return t.skip(why);
  const dataDir = seedDataDir("packrat-ui-runs-");
  const { app, page, errors } = await launch(dataDir);
  try {
    await page.locator("#inv-table tbody tr.item").first().waitFor({ timeout: 30_000 });
    await openTab(page, "builder");
    await page.waitForFunction(() => document.querySelector<HTMLSelectElement>("#b-char")?.value, { timeout: 10_000 });
    const [builtFor, other] = await page.locator("#b-char option").allInnerTexts() as [string, string];
    await page.selectOption("#b-char", builtFor);
    await page.fill("#b-budget", "3");
    await page.click("#b-run");
    await page.waitForFunction(() => !document.querySelector<HTMLButtonElement>("#b-run")?.disabled, undefined, { timeout: 60_000 });
    await page.waitForSelector("#b-runs .run-main", { state: "attached", timeout: 10_000 });

    // Open the saved run with its fetch held back, and switch character while it is in flight.
    await page.route("**/api/runs/*", async (route) => { await new Promise((r) => setTimeout(r, 1500)); await route.continue(); });
    await page.click("#b-runs-open");
    await page.click("#b-runs .run-main");
    await page.selectOption("#b-char", other);
    await page.waitForTimeout(3000);
    assert.doesNotMatch(await page.locator("#b-result").innerText(), /Best suit for/, "the run opened for one character is not drawn under the other");
    await page.unroute("**/api/runs/*");

    // A slow run list for the old character must not fill the drawer under the new one.
    await page.route(`**/api/runs?character=${encodeURIComponent(builtFor)}`, async (route) => { await new Promise((r) => setTimeout(r, 1500)); await route.continue(); });
    await page.selectOption("#b-char", builtFor);
    await page.selectOption("#b-char", other);
    await page.waitForTimeout(3000);
    assert.equal(await page.locator("#b-runs .run-main").count(), 0, `${other} has no saved runs; ${builtFor}'s late list must not show under ${other}`);

    assert.deepEqual(errors, []);
  } finally {
    await app.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});
