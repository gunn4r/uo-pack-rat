// ui-unravel.test.mts — [slow]: the Inventory's Unravel view (issue #271) in the real Electron window.
//
// `[slow]`: the Inventory's Unravel view (issue #271) in the real Electron window at 1024 × 768, over the demo scans with Kestrel at Imbuing 70: the picker on the highest Imbuing, the three forecast cards, the groups in their order (Wait for Imbuing 95, Enchanted Essence, Magical Residue) with each row's chance line at 70, a maybe tag with its title, Keep taking a row out and writing settings.json's unravelKeep, Change showing a chip per reason with its count, the Kept chip bringing the kept row back with Unkeep, which puts it back on the list, a row's checkbox, a shift-click range (none across a redraw) and Select these with the selection bar, the cards for a character below Imbuing 45, and no sideways scroll at 420 px. Issue #332: a group folded and unfolded (its count on the heading, Select these still taking its rows), condensed one-line rows with the place in the row's title, both kept in ui-prefs.json across a reload, the top staying put while only the list scrolls, and at 420 px the whole view scrolling with nothing sideways.
//
// Skipped when electron or playwright is absent, or under TEST_SKIP_ELECTRON.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { fitWindow, testEnv, noUpdateCheck, removeTempDir } from "./electron-window.mts";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const require_ = createRequire(import.meta.url);
function unavailable(): string | null {
  if (process.env.TEST_SKIP_ELECTRON) return "TEST_SKIP_ELECTRON is set";
  for (const dep of ["electron", "playwright"]) {
    try { require_.resolve(dep); } catch { return `${dep} is not installed`; }
  }
  return null;
}
// The demo scans, with Kestrel at Imbuing 70.
function seed(dataDir: string): void {
  writeFileSync(join(dataDir, "settings.json"), JSON.stringify({ schemaVersion: 1, shard: "uoalive", setupDone: true }));
  mkdirSync(join(dataDir, "scans"), { recursive: true });
  for (const name of ["Dorran", "Kestrel"]) {
    const scan = JSON.parse(readFileSync(join(ROOT, "app", "fixtures", `demo-${name}.json`), "utf8")) as { skills: Record<string, unknown> };
    if (name === "Kestrel") scan.skills = { ...scan.skills, Imbuing: { base: 70, value: 70, cap: 100 } };
    writeFileSync(join(dataDir, "scans", `demo-${name}.json`), JSON.stringify(scan));
  }
}

test("[slow] the Unravel view forecasts, groups the candidates by ingredient, keeps and unkeeps a piece, and fits at 420 px", async (t) => {
  const why = unavailable();
  if (why) return t.skip(why);
  const dataDir = mkdtempSync(join(tmpdir(), "packrat-unravel-"));
  seed(dataDir);
  const kept = (): unknown => JSON.parse(readFileSync(join(dataDir, "settings.json"), "utf8")).unravelKeep;
  const { _electron } = await import("playwright");
  const app = await _electron.launch({ args: [ROOT, "--data", noUpdateCheck(dataDir)], cwd: ROOT, timeout: 60_000, env: testEnv() });
  try {
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await fitWindow(app, page, { width: 1024, height: 768 });
    await page.locator("#inv-table tbody tr.item").first().waitFor({ timeout: 30_000 });

    // The fourth view of the Inventory's switch.
    await page.getByRole("radio", { name: "Unravel", exact: true }).click();
    await page.waitForFunction(() => location.hash === "#/unravel");
    await page.locator(".unr-row").first().waitFor({ timeout: 15_000 });
    assert.equal(await page.locator("#unr-who").inputValue(), "Kestrel", "the highest Imbuing first");
    assert.match(await page.locator("#unr-who option:checked").innerText(), /Kestrel · Imbuing 70/);

    // Three forecast cards; below 95 the Relic card says how many pieces wait for it.
    const cards = await page.locator(".unr-fc").allInnerTexts();
    assert.equal(cards.length, 3);
    assert.match(cards[0]!, /Relic Fragment[\s\S]*0 now[\s\S]*pieces? held for Imbuing 95\. At 95 about \d+, at 100 about \d+\. On hand: 0\./i);
    assert.match(cards[1]!, /Enchanted Essence[\s\S]*≈ \d+[\s\S]*From \d+ pieces?\. On hand: 0\./i);
    assert.match(cards[2]!, /Magical Residue[\s\S]*≈ \d+[\s\S]*Essence misses\. On hand: 0\./i);

    // The groups in order, each row's ingredient and chance line at Imbuing 70.
    assert.deepEqual(await page.locator(".unr-group-head h3").allInnerTexts(), ["Wait for Imbuing 95", "Enchanted Essence", "Magical Residue"]);
    const lines = async (g: string): Promise<string[]> => page.locator(`.unr-group.${g} .unr-yield`).allInnerTexts();
    assert.ok((await lines("held")).every((l) => /^Relic Fragment at Imbuing 95\s*(maybe)?\s*Refused until then \(now 70\)$/i.test(l.trim())), (await lines("held"))[0]);
    assert.ok((await lines("essence")).every((l) => /^Enchanted Essence ×[2-4]\s*(maybe)?\s*50% at 70, else Residue$/i.test(l.trim())), (await lines("essence"))[0]);
    assert.ok((await lines("residue")).every((l) => /^Magical Residue (×1|1–2|2–3)\s*(maybe)?\s*Always at Imbuing 45\+$/i.test(l.trim())), (await lines("residue"))[0]);
    const weights = await page.locator(".unr-group.essence .unr-row").count();
    assert.ok(weights > 1, "more than one Essence piece");
    const maybe = page.locator(".unr-row .unr-maybe").first();
    assert.match(await maybe.getAttribute("title") ?? "", /^Close to the line between .+: it could go either way$/);

    // Keep takes the row out and writes the Keep list.
    const left = async (): Promise<number> => +((await page.locator("#unr-excl").innerText()).match(/^(\d+) pieces? left out/)?.[1] ?? 0);
    const leftBefore = await left();
    const first = page.locator(".unr-group.essence .unr-row").first();
    const serial = Number(await first.getAttribute("data-serial"));
    await first.locator(".unr-keep").click();
    await page.waitForFunction((s) => !document.querySelector(`.unr-row[data-serial="${s}"]`), serial);
    assert.deepEqual(kept(), [serial]);
    assert.equal(await left(), leftBefore + 1);

    // Change: a chip per reason with its count, every one left out; the Kept chip shows the kept row again, with Unkeep.
    await page.locator("#unr-change").click();
    const chips = await page.locator("#unr-excl .unr-chip").allInnerTexts();
    assert.deepEqual(chips.map((c) => c.replace(/\s*\d+$/, "")), ["Worn", "In a saved build", "Insured", "Organize pins", "Imbued", "Blessed", "Kept"]);
    assert.match(chips[6]!, /Kept\s*1$/);
    assert.equal(await page.locator('#unr-excl .unr-chip[aria-pressed="true"]').count(), 7, "all left out by default");
    await page.locator('#unr-excl .unr-chip[data-reason="kept"]').click();
    const back = page.locator(`.unr-row[data-serial="${serial}"]`);
    await back.waitFor();
    assert.equal(await back.locator(".unr-keep").innerText(), "Unkeep");
    assert.match(await back.locator(".unr-sub").innerText(), /Kept/i);
    await back.locator(".unr-keep").click();
    await page.waitForFunction((s) => document.querySelector(`.unr-row[data-serial="${s}"] .unr-keep`)?.textContent === "Keep", serial);
    for (let i = 0; i < 50 && JSON.stringify(kept()) !== "[]"; i++) await page.waitForTimeout(100);
    assert.deepEqual(kept(), []);

    // A row's checkbox selects it alone, shift-click the rows from it to another (the Inventory's selection model), and
    // Clear hides the bar.
    const cbs = page.locator(".unr-group.essence .unr-cb");
    await cbs.nth(0).click();
    assert.match(await page.locator("#unr-selbar").innerText(), /^1 selected\s*1 Essence/);
    assert.equal(await cbs.nth(0).isChecked(), true);
    await cbs.nth(2).click({ modifiers: ["Shift"] });
    assert.match(await page.locator("#unr-selbar").innerText(), /^3 selected\s*3 Essence/);
    assert.equal(await cbs.nth(1).isChecked(), true);
    await page.locator("#unr-selbar").getByRole("button", { name: "Clear" }).click();
    await page.locator("#unr-selbar").waitFor({ state: "hidden" });
    // A redrawn list (here the picker changed and back) drops the anchor: the next shift-click ticks that row alone.
    await cbs.nth(0).click();
    await page.locator("#unr-who").selectOption("Dorran");
    await page.locator("#unr-who").selectOption("Kestrel");
    await page.waitForFunction(() => /70, else Residue/.test(document.querySelector(".unr-group.essence .unr-why")?.textContent || ""));
    await cbs.nth(2).click({ modifiers: ["Shift"] });
    assert.match(await page.locator("#unr-selbar").innerText(), /^2 selected/);
    assert.equal(await cbs.nth(1).isChecked(), false);
    await page.locator("#unr-selbar").getByRole("button", { name: "Clear" }).click();
    await page.locator("#unr-selbar").waitFor({ state: "hidden" });

    // Select these: the whole Essence group, and the selection bar says so.
    await page.locator('.unr-group.essence [data-select="essence"]').click();
    await page.locator("#unr-selbar").waitFor();
    assert.match(await page.locator("#unr-selbar").innerText(), new RegExp(`${weights} selected\\s*${weights} Essence`));
    assert.equal(await page.locator(".unr-group.essence .unr-cb:checked").count(), weights);

    // Below Imbuing 45 (Dorran has none) every Essence piece is held too, and gives no misses.
    await page.locator("#unr-who").selectOption("Dorran");
    await page.waitForFunction(() => /held for Imbuing 45/.test(document.querySelectorAll(".unr-fc")[1]?.textContent || ""));
    const low = await page.locator(".unr-fc").allInnerTexts();
    assert.match(low[1]!, /0 now[\s\S]*pieces? held for Imbuing 45\./);
    assert.doesNotMatch(low[2]!, /Essence misses/);

    // No sideways scroll at 420 px.
    await fitWindow(app, page, { width: 420, height: 900 });
    const w = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
    assert.ok(w[0]! <= w[1]!, `no sideways scroll at 420 (${w.join(", ")})`);
    assert.deepEqual(errors, []);
  } finally {
    await app.close();
    removeTempDir(dataDir);
  }
});

// Issue #332: the groups fold (the count on a folded heading, Select these still taking its rows), condensed one-line rows,
// both kept in ui-prefs.json across a reload; the top stays put while only the list scrolls, and at 420 px the whole view
// scrolls with nothing sideways.
test("[slow] the Unravel view folds its groups, condenses its rows, and keeps its top in place while the list scrolls", async (t) => {
  const why = unavailable();
  if (why) return t.skip(why);
  const dataDir = mkdtempSync(join(tmpdir(), "packrat-unravel-polish-"));
  seed(dataDir);
  const uiPrefs = (): Record<string, unknown> => { try { return JSON.parse(readFileSync(join(dataDir, "ui-prefs.json"), "utf8")); } catch { return {}; } };
  const until = async (ok: () => boolean, what: string): Promise<void> => {
    for (let i = 0; i < 100 && !ok(); i++) await new Promise((r) => setTimeout(r, 100));
    assert.ok(ok(), what);
  };
  const { _electron } = await import("playwright");
  const app = await _electron.launch({ args: [ROOT, "--data", noUpdateCheck(dataDir)], cwd: ROOT, timeout: 60_000, env: testEnv() });
  try {
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await fitWindow(app, page, { width: 1024, height: 768 });
    await page.locator("#inv-table tbody tr.item").first().waitFor({ timeout: 30_000 });
    await page.getByRole("radio", { name: "Unravel", exact: true }).click();
    await page.locator(".unr-row").first().waitFor({ timeout: 15_000 });

    // The top stays put: the list scrolls in its own box, the view itself does not.
    const top = async (): Promise<number> => (await page.locator("#unr-forecast").boundingBox())!.y;
    const before = await top();
    const scrolled = await page.evaluate(() => { const l = document.querySelector<HTMLElement>("#unr-list")!; l.scrollTop = 1e6; return [l.scrollTop, document.querySelector<HTMLElement>("#tab-unravel")!.scrollTop]; });
    assert.ok(scrolled[0]! > 0, "the list scrolls");
    assert.equal(scrolled[1], 0, "the view does not");
    assert.equal(await top(), before, "the forecast stays where it was");
    await page.evaluate(() => { document.querySelector<HTMLElement>("#unr-list")!.scrollTop = 0; });

    // Fold "Wait for Imbuing 95": its rows go, its heading shows the count, and the choice is saved.
    const fold = page.locator('[data-fold="held"]');
    const held = await page.locator(".unr-group.held .unr-row").count();
    assert.ok(held > 0);
    await fold.click();
    assert.equal(await fold.getAttribute("aria-expanded"), "false");
    assert.equal(await page.locator(".unr-group.held .unr-row").count(), 0);
    assert.match(await fold.innerText(), new RegExp(`Wait for Imbuing 95\\s*${held}$`));
    await until(() => JSON.stringify(uiPrefs().unravelCollapsed) === '["held"]', "unravelCollapsed saved");
    // Select these still takes a folded group's pieces.
    await page.locator('[data-select="held"]').click();
    assert.match(await page.locator("#unr-selbar").innerText(), new RegExp(`^${held} selected`));
    await page.locator("#unr-selbar").getByRole("button", { name: "Clear" }).click();

    // Condensed rows: one line each, the place in the row's title, and the choice saved.
    const fullHeight = (await page.locator(".unr-group.essence .unr-row").first().boundingBox())!.height;
    await page.locator('#unr-rows [data-value="condensed"]').click();
    assert.equal(await page.locator("#unr-list.condensed").count(), 1);
    const row = page.locator(".unr-group.essence .unr-row").first();
    assert.ok((await row.boundingBox())!.height < fullHeight, "a condensed row is shorter");
    assert.ok(((await row.getAttribute("title")) ?? "").length > 0, "the place is the row's title");
    assert.equal(await row.locator(".unr-where").isVisible(), false);
    await until(() => uiPrefs().unravelRows === "condensed", "unravelRows saved");

    // Both survive a reload; unfolding brings the rows back.
    await page.reload();
    await page.locator(".unr-row").first().waitFor({ timeout: 30_000 });
    assert.equal(await page.locator('[data-fold="held"]').getAttribute("aria-expanded"), "false");
    assert.equal(await page.locator("#unr-list.condensed").count(), 1);
    await page.locator('[data-fold="held"]').click();
    assert.equal(await page.locator(".unr-group.held .unr-row").count(), held);
    await until(() => JSON.stringify(uiPrefs().unravelCollapsed) === "[]", "unravelCollapsed cleared");

    // At 420 px the whole view scrolls instead, with nothing sideways.
    await fitWindow(app, page, { width: 420, height: 900 });
    const w = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
    assert.ok(w[0]! <= w[1]!, `no sideways scroll at 420 (${w.join(", ")})`);
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector("#tab-unravel")!).overflowY), "auto");
    assert.deepEqual(errors, []);
  } finally {
    await app.close();
    removeTempDir(dataDir);
  }
});
