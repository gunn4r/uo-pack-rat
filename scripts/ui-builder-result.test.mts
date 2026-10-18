// ui-builder-result.test.mts — [slow]: What changes, the Fetch list and Plan tooltips, a Fetch list row's place, and the result's own scrolling.
//
// `[slow]`: the Suit Builder's result in the real Electron window, on a writable `--data` directory seeded with the demo scans. The result's What changes (issue #272): Gauges by default with one gauge per moved non-resist property and a loss muted, Table with every property and no score breakdown, the choice kept across a reload, a breakdown row opening its weight in the drawer (Esc back to the row), a buff's past-cap note kept, and no sideways page scroll at 420 px; the Fetch list's pieces show the item tooltip on hover and after Tab focus, and so do both names in a Plan row, each its own piece's (issue #75; the row itself and its Slot cell show none, a kept row's worn name still does); a Fetch list row shows a deep bag path in full (nothing cut or ellipsised) and its copy button puts the container serial on the clipboard; Independent scrolling (issue #333): the result scrolls with its side column staying put, and at 420 px the side column stacks with no sideways scroll.
//
// Shared steps are in scripts/builder-ui.mts. Skipped when electron or playwright is absent, or under TEST_SKIP_ELECTRON.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fitWindow, pickCharacter, sidewaysAt } from "./electron-window.mts";
import { skipWithoutElectron, tempDataDir, until } from "./electron-app.mts";
import { built, closeSettings, launch, openBuilder, pressBuild, settings } from "./builder-ui.mts";
import type { Locator, Page } from "playwright";

// The item tooltip's name once it shows (400 ms after a hover settles, or after keyboard focus).
async function tipName(page: Page): Promise<string> {
  await page.waitForFunction(() => getComputedStyle(document.querySelector("#tip")!).display === "block", undefined, { timeout: 10_000 });
  return page.locator("#tip .tip-name").innerText();
}
async function hoverTip(page: Page, target: Locator): Promise<string> {
  await page.mouse.move(2, 2);
  await page.waitForFunction(() => getComputedStyle(document.querySelector("#tip")!).display === "none");
  await target.hover();
  return tipName(page);
}

test("[slow] the Fetch list's pieces show the item tooltip on hover and on keyboard focus", async (t) => {
  if (skipWithoutElectron(t)) return;
  const dataDir = tempDataDir("packrat-ui-fetchtip-", { demoScans: true });
  const { page, errors, close } = await launch(dataDir);
  try {
    await openBuilder(page);
    await pressBuild(page);
    await built(page);
    const pieces = page.locator("section[aria-label='Fetch list'] .b-fetch-piece");
    assert.ok(await pieces.count() > 1, "the fetch list names its pieces one by one");
    const name = await pieces.nth(1).innerText();
    await pieces.nth(1).scrollIntoViewIfNeeded();
    assert.equal(await hoverTip(page, pieces.nth(1)), name);
    await page.mouse.move(2, 2);
    await pieces.nth(0).focus();
    await page.keyboard.press("Tab");
    assert.equal(await page.evaluate(() => document.activeElement?.textContent), name, "Tab reaches the next piece");
    assert.equal(await tipName(page), name);
    assert.deepEqual(errors, []);
  } finally {
    await close();
  }
});

// Issue #75: a Plan row's two names each show their own piece's tooltip; the rest of the row shows none.
test("[slow] the Plan's worn and replacement names each show their own piece's tooltip", async (t) => {
  if (skipWithoutElectron(t)) return;
  const dataDir = tempDataDir("packrat-ui-plantip-", { demoScans: true });
  const { page, errors, close } = await launch(dataDir);
  try {
    await openBuilder(page);
    await pressBuild(page);
    await built(page);
    const plan = page.locator(".b-plan tbody");
    assert.equal(await plan.locator("tr[data-serial]").count(), 0, "the rows carry no serial of their own");
    const row = plan.locator("tr", { has: page.locator("td:nth-child(2) .b-tip") }).filter({ has: page.locator("td:nth-child(3) .b-tip") }).first();
    await row.scrollIntoViewIfNeeded();
    const [now, next] = [row.locator("td").nth(1).locator(".b-tip"), row.locator("td").nth(2).locator(".b-tip")];
    assert.equal(await hoverTip(page, now), await now.innerText());
    assert.equal(await hoverTip(page, next), await next.innerText());
    assert.notEqual(await now.getAttribute("data-serial"), await next.getAttribute("data-serial"));
    // The Slot cell is not a piece: no tooltip after the delay.
    await page.mouse.move(2, 2);
    await row.locator("td").nth(0).hover();
    await page.waitForTimeout(700);   // sleep: past the tooltip's 400 ms delay, proving none shows
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector("#tip")!).display), "none");
    // Keyboard focus shows it too: Tab from the worn name reaches the replacement.
    await now.focus();
    await page.keyboard.press("Tab");
    assert.equal(await tipName(page), await next.innerText());
    // An unchanged ("keep") row still shows the worn piece's tooltip.
    await page.getByRole("switch", { name: "Show unchanged slots" }).click();
    const kept = plan.locator("tr", { has: page.locator("td:nth-child(3)", { hasText: /^keep$/ }) }).filter({ has: page.locator("td:nth-child(2) .b-tip") }).first().locator("td").nth(1).locator(".b-tip");
    await kept.scrollIntoViewIfNeeded();
    assert.equal(await hoverTip(page, kept), await kept.innerText());
    assert.deepEqual(errors, []);
  } finally {
    await close();
  }
});

test("[slow] a Fetch list row shows its whole place, wrapped not cut, and copies the container serial", async (t) => {
  if (skipWithoutElectron(t)) return;
  const dataDir = tempDataDir("packrat-ui-fetchplace-", { demoScans: true });
  const { app, page, errors, close } = await launch(dataDir);
  try {
    await openBuilder(page);
    await pressBuild(page);
    await built(page);
    // A deep bag path on the first row's pieces (the demo's chests sit on the ground, one level deep), then a
    // redraw through the Plan's switch.
    const long = "Dorran's bank › Metal Chest (0x40001a2b) › Engraved: Caster Jewellery and Spare Suits › A Very Small Pouch Inside The Bag";
    await page.evaluate(async (text) => {
      const { state } = await import("/ui/store.mjs" as string);
      const serials = [...document.querySelectorAll<HTMLElement>("section[aria-label='Fetch list'] .b-fetch:first-child [data-serial]")].map((n) => +n.dataset.serial!);
      for (const s of serials) { const it = state.itemCache.get(s); it.location = { ...it.location, text }; }
    }, long);
    const sw = page.getByRole("switch", { name: "Show unchanged slots" });
    await sw.click(); await sw.click();
    const place = page.locator("section[aria-label='Fetch list'] .b-fetch").first().locator(".b-place");
    await place.scrollIntoViewIfNeeded();
    assert.equal((await place.innerText()).replace(/\s+/g, " ").trim(), "Dorran's bank › Metal Chest 0x40001a2b › Engraved: Caster Jewellery and Spare Suits › A Very Small Pouch Inside The Bag");
    const fits = await place.evaluate((n) => [...n.querySelectorAll("*")].every((c) => c.scrollWidth <= c.clientWidth + 1 && getComputedStyle(c).textOverflow !== "ellipsis"));
    assert.equal(fits, true, "no part of the place is cut short");

    const copy = page.locator("section[aria-label='Fetch list'] .b-fetch").first().getByRole("button", { name: /^Copy container serial 0x/ });
    const hex = (await copy.getAttribute("aria-label"))!.replace("Copy container serial ", "");
    // Its tooltip sits beside it, clear of the path above.
    await copy.hover();
    const tip = page.locator(".tip[role=tooltip]", { hasText: "Copy container serial" });
    await tip.waitFor({ timeout: 5_000 });
    const [tb, pb, cb] = [await tip.boundingBox(), await place.boundingBox(), await copy.boundingBox()];
    assert.ok(tb!.y >= pb!.y + pb!.height, `the tooltip (top ${tb!.y}) is below the path (bottom ${pb!.y + pb!.height})`);
    assert.ok(tb!.x >= cb!.x + cb!.width, "and to the right of the button");
    await copy.click();
    await page.waitForFunction(() => /Copied 0x/.test(document.body.textContent || ""));
    assert.equal(await app.evaluate(({ clipboard }) => clipboard.readText()), hex);
    assert.deepEqual(errors, []);
  } finally {
    await close();
  }
});

// Issue #272 part 2, on Kestrel's melee build (the best suit gives up some of what she wears): What changes shows Gauges by default, only for moved non-resist properties the build weights or requires (no pool beside its bonus), a loss muted, and "+N more changes in Table" counting the rest and switching to it; Table lists every property, resists included, and hides the score breakdown; the choice is kept in ui-prefs across a reload; a breakdown row opens the drawer on Weights with that weight's field focused, or Add weight once the weight is gone, and Esc hands the focus back to the row; with Enemy of One planned, its past-cap amount shows under What changes and after the DI cap in the Table; at 420 px the page never scrolls sideways (the table scrolls in its own labelled box, its Property column staying put).
test("[slow] What changes: Gauges for what the build asks, Table with every property, the choice kept, breakdown rows open their weight, past-cap notes, no sideways scroll at 420", async (t) => {
  if (skipWithoutElectron(t)) return;
  const dataDir = tempDataDir("packrat-ui-changes-", { demoScans: true });
  const { app, page, errors, close } = await launch(dataDir);
  try {
    await openBuilder(page);
    await pickCharacter(page, "Kestrel");
    await page.waitForFunction(() => document.querySelector("#b-tpl")?.getAttribute("data-value") === "builtin:melee", undefined, { timeout: 10_000 });
    await pressBuild(page);
    await built(page);
    const view = (): Promise<string> => page.locator("#b-chg-view [aria-checked=true]").innerText();
    assert.equal(await view(), "Gauges", "Gauges by default");
    assert.match(await page.locator(".b-chg-head").first().innerText(), /\d+ up/);
    const gauges = (await page.locator(".b-gauge .b-gauge-top > span[title]").evaluateAll((es) => es.map((e) => e.getAttribute("title") ?? ""))).sort();
    assert.ok(gauges.length > 0);
    const loss = page.locator(".b-gauge.loss").first();
    assert.ok(await page.locator(".b-gauge.loss").count(), "the suit gives something up");
    assert.deepEqual(await loss.locator(".b-gauge-delta").evaluate((e) => [e.classList.contains("muted"), e.classList.contains("tone-bad")]), [true, false], "a loss is muted, not red");
    const fill = (sel: string): Promise<string> => page.locator(sel).first().evaluate((e) => getComputedStyle(e).backgroundColor);
    assert.notEqual(await fill(".b-gauge.loss .b-gauge-track > i"), await fill(".b-gauge:not(.loss) .b-gauge-track > i"), "a loss's fill is grey, not the accent");
    assert.ok(await page.locator(".b-shares").count(), "the score breakdown shows with the gauges");
    const more = Number(/^\+(\d+) more changes? in Table$/.exec(await page.locator(".b-chg-more").innerText())?.[1]);

    // "+N more changes in Table" switches to the Table, which has every property
    await page.click(".b-chg-more");
    await page.waitForSelector(".b-chg-tbl");
    assert.equal(await page.locator(".b-shares").count(), 0, "the table carries the breakdown");
    const rows = await page.locator(".b-chg-tbl tbody tr").evaluateAll((trs) => trs.map((tr) => [...tr.querySelectorAll("td")].map((td) => td.textContent ?? "")));
    const names = rows.map((r) => r[0]);
    for (const r of ["Physical resist", "Fire resist", "Cold resist", "Poison resist", "Energy resist"]) assert.ok(names.includes(r), `${r} in the table`);
    assert.ok(rows.some((r) => r[4] === "0"), "an unchanged property is listed too");
    const moved = rows.filter((r) => r[4] !== "0" && !/ resist$/.test(r[0]!)).map((r) => r[0]!);
    assert.ok(gauges.every((g) => moved.includes(g)), "a gauge only for a property that moves");
    // only what the build asks for: a non-zero weight or a requirement; a pool never beside its bonus
    const asked = await page.evaluate(() => [...document.querySelectorAll<HTMLInputElement>("#b-sec-weights .rule-row input[type=number], #b-sec-req .rule-row input[type=number]")]
      .filter((i) => !/ weight$/.test(i.getAttribute("aria-label") ?? "") || Number(i.value) !== 0).map((i) => (i.getAttribute("aria-label") ?? "").replace(/ (weight|minimum)$/, "")));
    assert.ok(gauges.every((g) => asked.includes(g)), `every gauge is weighted or required: ${gauges.join(", ")}`);
    assert.ok(!(gauges.includes("Stamina increase") && gauges.includes("Stamina from gear and buffs")), "no pool beside its bonus");
    assert.ok(moved.length > gauges.length, "the build moves more than it asks for");
    assert.equal(more, moved.length - gauges.length, "the link counts the moved properties with no gauge");
    const saved = (): boolean => { try { return (JSON.parse(readFileSync(join(dataDir, "ui-prefs.json"), "utf8")) as { builderChanges?: string }).builderChanges === "table"; } catch { return false; } };
    assert.ok(await until(saved, (v) => v, "the choice in ui-prefs.json"), "the choice is in ui-prefs.json");

    // At phone width the page doesn't scroll sideways; the table scrolls inside its box.
    const resultsOver = await sidewaysAt(app, page, { width: 420, height: 900 }, [".b-results"]);
    assert.ok(resultsOver <= 0, `no sideways page scroll: ${resultsOver}`);
    const [boxW, boxClient] = await page.locator(".b-chg-scroll").evaluate((b) => [b.scrollWidth, b.clientWidth]);
    assert.ok(boxW! > boxClient!, "the table scrolls in its own box");
    const box = page.locator(".b-chg-scroll");
    assert.deepEqual([await box.getAttribute("role"), await box.getAttribute("tabindex"), await box.evaluate((e) => e.classList.contains("more-right"))], ["region", "0", true], "a labelled region the keyboard can scroll, marked when more is on the right");
    const [nameLeft, boxLeft] = await page.evaluate(() => { const b = document.querySelector(".b-chg-scroll")!; b.scrollLeft = b.scrollWidth; return [document.querySelector(".b-chg-tbl tbody td")!.getBoundingClientRect().left, b.getBoundingClientRect().left]; });
    assert.ok(Math.abs(nameLeft! - boxLeft!) < 3, "the Property column stays put while it scrolls");
    await fitWindow(app, page, { width: 1440, height: 900 });

    await page.reload();
    await page.waitForSelector("#tab-builder:not([hidden]) #b-result .b-head-card", { timeout: 30_000 });   // coming back: the latest run
    assert.equal(await view(), "Table", "kept across a reload");

    // A breakdown row opens the drawer on Weights with its weight's field focused; with the weight gone, Add weight.
    await page.click("#b-chg-view [data-value=gauges]");
    const row = page.locator(".b-share-list .b-share").first();
    const label = (await row.locator(".b-share-name").innerText()).replace(/ · incl\. min$/, "");
    const focused = (): Promise<string | null> => page.evaluate(() => { const a = document.activeElement; return a?.closest("#b-sec-weights .rule-row") ? a.getAttribute("aria-label") : a?.id ?? null; });
    await row.click();
    await page.locator("#b-drawer").waitFor({ state: "visible" });
    assert.equal(await page.getAttribute("#b-tab-weights", "aria-selected"), "true");
    assert.equal(await focused(), `${label} weight`);
    await page.getByRole("button", { name: `Remove weight: ${label}`, exact: true }).click();
    await closeSettings(page);
    await row.click();
    await page.locator("#b-drawer").waitFor({ state: "visible" });
    assert.equal(await focused(), "b-addweight", "no weight left: Add weight");
    await page.keyboard.press("Escape");
    assert.equal(await page.evaluate(() => document.activeElement?.classList.contains("b-share")), true, "Esc hands the focus back to the row");

    // A buff's past-cap amount stays in view: on its gauge, or a line under the gauges, and after the cap in the Table.
    await settings(page, "buffs");
    await page.click("#b-buff-add");
    await page.locator("#abf-cb-enemyOfOne").check();
    await page.keyboard.press("Escape");
    await pressBuild(page);
    await built(page);
    await closeSettings(page);
    assert.match(await page.locator(".b-chg").innerText(), /\+\d+ past the cap \(Enemy of One\)/, "the note under What changes");
    await page.click("#b-chg-view [data-value=table]");
    const di = page.locator(".b-chg-tbl tbody tr", { has: page.locator("td:first-child", { hasText: /^Damage$/ }) }).locator("td").nth(3);
    assert.match(await di.innerText(), /· \+\d+ past/);
    assert.match(await di.locator(".b-cap-past").getAttribute("title") ?? "", /past the cap \(Enemy of One\)/);
    assert.deepEqual(errors, []);
  } finally {
    await close();
  }
});

// Issue #333: side by side, the result's main column scrolls and its side column ("How the goals went", the character's
// runs) stays put; at 420 px the side column stacks under the result and nothing scrolls sideways.
test("[slow] the result scrolls on its own and the side column stays put; stacked at 420 with no sideways scroll", async (t) => {
  if (skipWithoutElectron(t)) return;
  const dataDir = tempDataDir("packrat-ui-scroll-", { demoScans: true });
  const { app, page, errors, close } = await launch(dataDir);
  try {
    await openBuilder(page);
    await pressBuild(page);
    await built(page);
    // side by side needs a results box 1000 px wide; a CI screen can be smaller than 1440, so zoom out until the page is wide
    // enough (0.7 makes even a 1024 px screen 1460 CSS px), and fail rather than skip when it is not
    const zoom = (f: number): Promise<void> => app.evaluate(({ BrowserWindow }, z) => { BrowserWindow.getAllWindows()[0]!.webContents.setZoomFactor(z); }, f);
    await zoom(0.7);
    await page.waitForFunction(() => document.querySelector(".b-results")!.clientWidth >= 1000, undefined, { timeout: 5_000 });
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector(".b-arrive-side")!).position), "sticky", "sticky side by side");
    {
      const tops = (): Promise<number[]> => page.evaluate(() => [".b-arrive-side", ".b-arrive-main"].map((s) => Math.round(document.querySelector(s)!.getBoundingClientRect().top)));
      const [side, main] = await tops();
      const scrolled = await page.evaluate(() => { const r = document.querySelector(".b-results")!; r.scrollTop = 400; return r.scrollTop; });
      assert.ok(scrolled > 100, `the result scrolls: ${scrolled}`);
      await page.waitForFunction((m) => Math.round(document.querySelector(".b-arrive-main")!.getBoundingClientRect().top) < m, main!, { timeout: 5_000 });
      assert.equal((await tops())[0], side, "the side column stays where it was");
    }
    await zoom(1);
    await fitWindow(app, page, { width: 420, height: 900 });
    await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth, undefined, { timeout: 5_000 }).catch(() => {});
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "no sideways scroll at 420");
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector(".b-arrive-side")!).position), "static", "stacked, it scrolls with the result");
    await fitWindow(app, page, { width: 1440, height: 900 });
    assert.deepEqual(errors, []);
  } finally {
    await close();
  }
});
