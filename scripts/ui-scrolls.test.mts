// ui-scrolls.test.mts — [slow]: the Inventory's Scrolls view (issue #181) in the real Electron window at 1024 × 768,
// over the demo scans with more scrolls in Kestrel's chest (scripts/scrolls-fixture.mts) on a writable --data folder:
// the power scrolls per skill with their counts and the next roll-up, the Scrolls of Transcendence tab's exact binder
// plan, the detail opened and stepped by keyboard with its items' tooltips, and a count cell landing on exactly those
// scrolls in the Items view. Skipped when electron or playwright is absent, or under TEST_SKIP_ELECTRON.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { fitWindow, testEnv, noUpdateCheck } from "./electron-window.mts";
import { writeScrollScans } from "./scrolls-fixture.mts";
import type { Page } from "playwright";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const require_ = createRequire(import.meta.url);
function unavailable(): string | null {
  if (process.env.TEST_SKIP_ELECTRON) return "TEST_SKIP_ELECTRON is set";
  for (const dep of ["electron", "playwright"]) {
    try { require_.resolve(dep); } catch { return `${dep} is not installed`; }
  }
  return null;
}
const row = (page: Page, skill: string) => page.locator(`#scr-table tbody tr[data-skill="${skill}"]`);
const cells = (page: Page, skill: string): Promise<string[]> => row(page, skill).locator("td").allInnerTexts();

test("[slow] the Scrolls view rolls power scrolls and Scrolls of Transcendence up per skill, opens a skill's detail and links to exactly its scrolls (1024 × 768)", async (t) => {
  const why = unavailable();
  if (why) return t.skip(why);
  const dataDir = mkdtempSync(join(tmpdir(), "packrat-scrolls-"));
  writeFileSync(join(dataDir, "settings.json"), JSON.stringify({ schemaVersion: 1, shard: "uoalive", setupDone: true }));
  writeScrollScans(dataDir);
  const { _electron } = await import("playwright");
  const app = await _electron.launch({ args: [ROOT, "--data", noUpdateCheck(dataDir)], cwd: ROOT, timeout: 60_000, env: testEnv() });
  try {
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await fitWindow(app, page, { width: 1024, height: 768 });
    await page.locator("#inv-table tbody tr.item").first().waitFor({ timeout: 30_000 });

    // The third view of the Inventory's switch, on its Power scrolls tab.
    await page.getByRole("radio", { name: "Scrolls", exact: true }).click();
    await page.waitForFunction(() => location.hash === "#/scrolls");
    await row(page, "Provocation").waitFor({ timeout: 15_000 });
    assert.equal(await page.locator("#inv-view [aria-checked=true]").innerText(), "Scrolls");
    assert.match(await page.locator("#scr-tabs").innerText(), /Power scrolls\s*25[\s\S]*Scrolls of Transcendence\s*29/);
    assert.equal((await page.locator("#scr-facts").innerText()).replace(/\s+/g, " "), "25 power scrolls across 6 skills · 29 Scrolls of Transcendence across 7 skills · 1 empty Scroll Binder · 2 skills ready to bind");

    // One row per skill, closest to a roll-up first: Meditation can bind now; Archery and Provocation need 7 more each,
    // Archery's at the higher tier. Counts sit under their level; a zero is a blank cell.
    assert.deepEqual(await page.locator("#scr-table tbody tr.item").evaluateAll((trs) => trs.map((tr) => (tr as HTMLElement).dataset.skill)), ["Meditation", "Archery", "Provocation", "Spellweaving", "Mysticism", "Spirit Speak"]);
    const heads = await page.locator("#scr-table thead th").allInnerTexts();
    assert.deepEqual(heads.slice(0, 5), ["Skill", "105", "110", "115", "120"]);
    const pro = await cells(page, "Provocation");
    assert.deepEqual(pro.slice(1, 5), ["", "5", "1", ""]);
    assert.match(pro[5]!, /110 → 115: 5 of 12\s*7 more/);
    assert.match((await cells(page, "Archery"))[5]!, /115 → 120: 3 of 10\s*7 more/);
    const med = await cells(page, "Meditation");
    assert.match(med[0]!, /Meditation\s*Ready/);
    assert.equal(heads[6], "Bind everything");
    assert.equal(med[6], "1 × 115");
    assert.equal(pro[6], "", "a row that binds nothing has no text there");
    assert.equal(await row(page, "Provocation").locator('[role="meter"]').getAttribute("aria-label"), "5 of 12 110 scrolls toward a 115");

    // The filter narrows the skills, and leaves the facts (a live region) as they are, not drawn again.
    await page.evaluate(() => { (document.querySelector("#scr-facts span") as HTMLElement & { kept?: boolean }).kept = true; });
    await page.fill("#scr-q", "spir");
    await page.waitForFunction(() => document.querySelectorAll("#scr-table tbody tr.item").length === 1);
    assert.match(await page.locator("#scr-foot").innerText(), /1 of 6 skills · 1 scroll/);
    assert.equal(await page.evaluate(() => (document.querySelector("#scr-facts span") as HTMLElement & { kept?: boolean }).kept), true);
    await page.fill("#scr-q", "");
    await row(page, "Provocation").waitFor();

    // The detail: Enter on a row opens it, with the roll-up and every scroll by place; ↓ steps to the next skill, Esc
    // closes it and gives the row its focus back. Its rows carry the item tooltip.
    await row(page, "Provocation").focus();
    await page.keyboard.press("Enter");
    const peek = page.locator("#scr-peek");
    await peek.waitFor({ state: "visible" });
    assert.equal(await peek.locator("h2").innerText(), "Provocation");
    assert.match(await peek.innerText(), /6 power scrolls[\s\S]*1 container[\s\S]*Next roll-up\s*110 → 115: 5 of 12[\s\S]*Still needed\s*7 more × 110[\s\S]*Metal Chest[\s\S]*On the ground · scanned by Kestrel/);
    assert.equal(await peek.locator(".scr-list li").count(), 6);
    assert.equal(await peek.getByRole("button", { name: "Show in Inventory" }).count(), 1);
    assert.equal(await peek.getByRole("button", { name: /Grab/ }).count(), 0, "no Grab all");
    const li = peek.locator(".scr-list li").first();
    await li.hover();
    await page.waitForFunction(() => getComputedStyle(document.querySelector("#tip")!).display === "block", undefined, { timeout: 10_000 });
    assert.equal(await page.locator("#tip .tip-name").innerText(), "A Mythical Scroll Of Provocation (115 Skill)");
    const box = (await peek.boundingBox())!;
    assert.ok(box.x + box.width <= 1024 && box.y + box.height <= 768, "the detail fits the window");
    await row(page, "Provocation").focus();
    await page.keyboard.press("ArrowDown");
    await page.waitForFunction(() => document.querySelector("#scr-peek h2")?.textContent === "Spellweaving");
    await page.keyboard.press("Escape");
    await peek.waitFor({ state: "hidden" });
    assert.equal(await page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.skill), "Spellweaving");

    // The Scrolls of Transcendence tab: the totals against 2.0 and 5.0, and an exact plan with the fewest scrolls.
    await page.getByRole("radio", { name: /Scrolls of Transcendence/ }).click();
    await page.waitForFunction(() => location.hash === "#/scrolls/sot");
    await row(page, "Chivalry").waitFor();
    assert.match(await page.locator(".scr-warn").innerText(), /Going past 2\.0 locks the binder until 5\.0/);
    const medSot = await cells(page, "Meditation");
    assert.deepEqual([medSot[1]!.replace(/\s+/g, " ").trim(), medSot[2]], ["1.0 0.6 0.4 0.3", "2.3"]);
    assert.equal(medSot[4], "Bind 1.0 + 0.6 + 0.4 → 2.0");
    assert.equal((await cells(page, "Chivalry"))[4], "0.8 short of 2.0");
    assert.equal(await row(page, "Chivalry").locator('[role="meter"]').getAttribute("aria-valuetext"), "1.2 points");
    // 18 × 0.3 make neither 2.0 nor 5.0: bind 17 of them for 5.1, a usable 5.0 with 0.1 lost. The meter stops at 5.0
    // and its text keeps the real total.
    const tactics = await cells(page, "Tactics");
    assert.equal(tactics[4], "Bind 17 × 0.3 → 5.0 (0.1 lost)");
    const bar = row(page, "Tactics").locator('[role="meter"]');
    assert.deepEqual([await bar.getAttribute("aria-valuenow"), await bar.getAttribute("aria-valuetext")], ["5", "5.4 points"]);

    // A count cell lands on the Items view searching for exactly those scrolls.
    await page.evaluate(() => { location.hash = "#/scrolls"; });
    await row(page, "Provocation").waitFor();
    await row(page, "Provocation").getByRole("link", { name: "Show the 5 110 Provocation scrolls in Inventory" }).click();
    await page.waitForFunction(() => location.hash === "#/inventory");
    assert.equal(await page.inputValue("#f-text"), "scroll of provocation (110 skill)");
    await page.waitForFunction(() => {
      const names = [...document.querySelectorAll("#inv-table tbody tr.item")].map((tr) => tr.textContent ?? "");
      return names.length === 5 && names.every((n) => n.includes("An Exalted Scroll Of Provocation (110 Skill)"));
    }, undefined, { timeout: 15_000 });
    assert.deepEqual(errors, []);
  } finally {
    await app.close();
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});
