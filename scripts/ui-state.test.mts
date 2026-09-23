// ui-state.test.mts — [slow]: the page's state transitions, driven in the real Electron window with
// Playwright (the same launch as scripts/ui-smoke.test.mts, which covers boot and tabs). Each case
// here is a bug the 2026-09-22 review reproduced in a browser: a refresh resetting the filter
// filters while the table stayed filtered, the table showing nothing after a Forget shrank it, Forget
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
import { fitWindow, openFacet, testEnv } from "./electron-window.mts";
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
  const app = await _electron.launch({ args: [ROOT, "--data", dataDir], cwd: ROOT, timeout: 60_000, env: testEnv() });
  const page = await app.firstWindow();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  // The real window, as close to 1440 × 900 as the screen allows (scripts/electron-window.mts). Below 1180 px
  // the facet chips fold into "+ Filter", and pickOption/openFacet reach them there.
  await fitWindow(app, page, { width: 1440, height: 900 });
  return { app, page, errors };
}
const countText = (page: Page): Promise<string> => page.locator("#inv-foot .inv-count").innerText();
// The table fetch is debounced and asynchronous: wait until the footer's count fact shows `want`.
async function waitCount(page: Page, want: RegExp): Promise<void> {
  await page.waitForFunction((src) => new RegExp(src).test(document.querySelector("#inv-foot .inv-count")?.textContent || ""), want.source, { timeout: 15_000 });
}
// A checklist facet's popover (its chip, or "+ Filter" when the chip is folded): tick (or untick) one option by
// its value and close it.
async function pickOption(page: Page, id: string, name: string, value: string): Promise<void> {
  await openFacet(page, id, name);
  await page.locator(`.pop input[value="${value}"]`).click();
  await page.keyboard.press("Escape");
  await page.waitForSelector(".pop", { state: "detached" });
}
// Confirmations are the player's (components.mts's confirmDialog, a modal <dialog>): check the title
// names the object, then answer with the confirming button. Cancel is the one focused by default.
async function confirmYes(page: Page, title: RegExp): Promise<void> {
  const dialog = page.locator("dialog.dialog[open]");
  await dialog.waitFor({ timeout: 10_000 });
  assert.match(await dialog.locator("h2").innerText(), title);
  assert.equal(await page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.cancel), "", "Cancel has focus");
  await dialog.locator("[data-confirm]").click();
  await dialog.waitFor({ state: "detached", timeout: 10_000 });
}
// A screen through its sidebar nav item; Containers is the Inventory screen's second view, picked in its
// top bar (the view keeps the #tab-containers id).
async function openTab(page: Page, tab: string): Promise<void> {
  if (tab === "containers") {
    await page.click('[data-nav="inventory"]');
    await page.locator("#inv-view").getByRole("radio", { name: "Containers" }).click();
  } else {
    await page.click(`[data-nav="${tab}"]`);
  }
  await page.waitForSelector(`#tab-${tab}:not([hidden])`, { timeout: 10_000 });
}

test("[slow] refresh, Clear all, the virtual table and Forget keep the page's state", async (t) => {
  const why = unavailable();
  if (why) return t.skip(why);
  const dataDir = seedDataDir("packrat-ui-state-");
  const { app, page, errors } = await launch(dataDir);
  try {
    await page.locator("#inv-table tbody tr.item").first().waitFor({ timeout: 30_000 });

    // A background refresh (what the "inventory" SSE event runs) must leave the filter chip showing
    // the filter the table still applies.
    await pickOption(page, "slot", "Slot", "bracelet");
    await waitCount(page, /^\d+ of 160 stacks/);
    const filtered = await countText(page);
    // The page's own module (same URL as its <script>, so the same instance).
    await page.evaluate(async (url) => { await (await import(url)).reload(); }, "/ui/app.mjs");
    await page.waitForTimeout(500);
    await waitCount(page, /stacks/);
    assert.equal(await page.locator("#f-slot").innerText(), "Slot: Bracelet", "the Slot chip still reads Bracelet after a refresh");
    assert.equal(await page.locator("#f-slot.set").count(), 1);
    assert.equal(await countText(page), filtered);

    // "Clear all" clears every filter, the switches behind "+ Filter" included, and the search.
    await page.click("#f-add");
    await page.getByRole("menuitem", { name: "Gargoyle and meditation…" }).click();
    await page.getByRole("switch", { name: "Hide gargoyle-only gear" }).click();
    await page.keyboard.press("Escape");
    await page.fill("#f-text", "bracelet");
    await page.waitForFunction(() => /Search: bracelet/.test(document.querySelector("#inv-active")?.textContent || ""), undefined, { timeout: 10_000 });
    assert.match(await page.locator("#inv-active").innerText(), /No gargoyle-only/);
    await page.click("#f-clear");
    await waitCount(page, /^160 stacks · /);
    assert.equal(await page.locator("#f-slot").innerText(), "Slot");
    assert.equal(await page.locator("#f-text").inputValue(), "", "Clear all clears the search too");
    assert.equal(await page.locator("#inv-active").isHidden(), true, "no active filters, no strip");

    // No pager: the table is virtual. It draws a screenful of rows, and scrolling to the end brings the
    // last one in.
    const drawn = await page.locator("#inv-table tbody tr.item").count();
    assert.ok(drawn > 0 && drawn < 160, `only the rows in view are drawn, got ${drawn}`);
    // Scrolled to the end the way a player does, until it stays there: the spacers can grow once the real row
    // height is measured (fonts and scale differ between machines), which moves the end further down.
    await page.waitForFunction(() => {
      const s = document.querySelector<HTMLElement>("#inv-scroll")!;
      s.scrollTop = s.scrollHeight;
      return !!document.querySelector('#inv-table tbody tr.item[aria-rowindex="161"]');
    }, undefined, { timeout: 10_000, polling: 100 });

    // Pick the second character in the builder, so a Forget that reloads the whole page (and snaps
    // the builder back to the first character) shows up.
    await openTab(page, "builder");
    await page.waitForFunction(() => document.querySelector<HTMLSelectElement>("#b-char")?.value, { timeout: 10_000 });
    const names = await page.locator("#b-char option").allInnerTexts();
    await page.selectOption("#b-char", names[1]!);
    // The Weapons chip's choices, counted in its popover: wiring the panel twice would draw a second chip.
    const weaponChoices = async (): Promise<number> => {
      assert.equal(await page.locator("#b-weapon").count(), 1, "one Weapons chip");
      await page.click("#b-weapon");
      const n = await page.locator(".pop input[type=radio]").count();
      await page.keyboard.press("Escape");
      return n;
    };
    const weaponOptions = await weaponChoices();

    await openTab(page, "containers");
    const rows = page.locator("#cont-table tbody tr[data-root]");
    const counts = await rows.locator("td:nth-child(5)").allInnerTexts();
    const biggest = counts.map((c) => Number(c.replace(/,/g, ""))).reduce((best, n, i, all) => (n > all[best]! ? i : best), 0);
    await rows.nth(biggest).getByRole("button", { name: /^Actions for / }).click();
    await page.getByRole("menuitem", { name: "Forget…" }).click();
    await confirmYes(page, /^Forget /);
    await waitCount(page, /^(?!160 )\d+ stacks/);
    const after = await countText(page);
    assert.doesNotMatch(after, /^160 stacks/, `the forgotten container's items left the table, got ${after}`);
    // The table was scrolled to its end before the Forget shrank it: it must show rows, not a blank body.
    await openTab(page, "inventory");
    await page.waitForSelector("#inv-table tbody tr.item", { timeout: 10_000 });
    assert.ok(await page.locator("#inv-table tbody tr.item").count() > 0, "rows are shown after the Forget");
    await openTab(page, "builder");
    assert.equal(await weaponChoices(), weaponOptions, "Forget does not add another set of weapon options");
    assert.equal(await page.locator("#b-char").inputValue(), names[1], "Forget does not move the builder to another character");

    assert.deepEqual(errors, []);
  } finally {
    await app.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

// The item peek (design spec 4.3): a row click or Enter opens it beside the table with the row marked
// selected, ↑/↓ step through the rows with it following, Esc closes it and hands focus back to the row,
// and focusing a row for 400 ms shows the item tooltip.
test("[slow] the item peek opens from a row, follows the arrow keys and closes with Esc", async (t) => {
  const why = unavailable();
  if (why) return t.skip(why);
  const dataDir = seedDataDir("packrat-ui-peek-");
  const { app, page, errors } = await launch(dataDir);
  try {
    const rows = page.locator("#inv-table tbody tr.item");
    await rows.first().waitFor({ timeout: 30_000 });
    const first = await rows.nth(0).getAttribute("data-serial");
    await rows.nth(0).click();
    await page.waitForSelector("#inv-peek:not([hidden])");
    assert.equal(await rows.nth(0).getAttribute("aria-selected"), "true");
    const title = await page.locator("#peek-title").innerText();
    assert.equal(title, await rows.nth(0).locator(".inv-name > .ellip").innerText());
    await page.keyboard.press("ArrowDown");
    await page.waitForFunction((s) => document.querySelector("#inv-table tbody tr.item.sel")?.getAttribute("data-serial") !== s, first);
    assert.equal(await rows.nth(1).getAttribute("aria-selected"), "true", "the peek follows the row the arrows moved to");
    await page.keyboard.press("Escape");
    await page.waitForSelector("#inv-peek", { state: "hidden" });
    assert.equal(await page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.index), "1", "focus is back on the row");
    // Enter opens it again on the focused row; its Close button closes it.
    await page.keyboard.press("Enter");
    await page.waitForSelector("#inv-peek:not([hidden])");
    await page.getByRole("button", { name: "Close detail" }).click();
    await page.waitForSelector("#inv-peek", { state: "hidden" });
    // A row that keeps keyboard focus shows its tooltip after the delay; it is gone once focus leaves.
    await page.mouse.move(0, 0);
    await rows.nth(1).focus();
    await page.keyboard.press("ArrowDown");
    await page.waitForSelector("#tip[style*='block']", { timeout: 5_000 });
    await page.locator("#f-text").focus();
    await page.waitForFunction(() => document.querySelector<HTMLElement>("#tip")?.style.display === "none");
    // The way a player uses it: a click on a row, a click on the peek's text (focus drops to <body>), then
    // the keys. ↑/↓ still step and Esc still closes; typing in the search box keeps its arrows.
    await rows.nth(2).click();
    await page.waitForSelector("#inv-peek:not([hidden])");
    await page.locator("#inv-peek .peek-sec .caps").first().click();
    assert.equal(await page.evaluate(() => document.activeElement === document.body), true, "the click on the peek's text leaves focus on the page");
    await page.keyboard.press("ArrowDown");
    await page.waitForFunction(() => document.querySelector("#inv-table tbody tr.item.sel")?.getAttribute("data-index") === "3");
    await page.keyboard.press("ArrowUp");
    await page.waitForFunction(() => document.querySelector("#inv-table tbody tr.item.sel")?.getAttribute("data-index") === "2");
    await page.locator("#f-text").click();
    await page.keyboard.press("ArrowDown");
    assert.equal(await rows.nth(2).getAttribute("aria-selected"), "true", "arrows in the search box do not step the peek");
    await page.evaluate(() => (document.activeElement as HTMLElement).blur());
    await page.keyboard.press("Escape");
    await page.waitForSelector("#inv-peek", { state: "hidden" });
    // A row's "⋯" menu is as wide as its longest item: "Show everything in this container" on one line, whole.
    await rows.nth(2).hover();
    await rows.nth(2).getByRole("button", { name: "More actions" }).click();
    const item = page.getByRole("menuitem", { name: "Show everything in this container" });
    const fit = await item.evaluate((b) => { const s = b.querySelector<HTMLElement>("span:not(.count)")!; return { lines: Math.round(s.getBoundingClientRect().height / parseFloat(getComputedStyle(s).lineHeight)), cut: s.scrollWidth > s.clientWidth }; });
    assert.deepEqual(fit, { lines: 1, cut: false }, "the menu item's words neither wrap nor get cut off");
    await page.keyboard.press("Escape");
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
    await page.click("#b-sec-adv .b-sec-head button");   // the time budget is under Advanced, collapsed by default
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
    await page.locator("#b-result").getByRole("button", { name: "Full sheet" }).click();
    assert.match(await page.locator("#b-result .sheet").first().innerText(), new RegExp(builtFor));

    assert.deepEqual(errors, []);
  } finally {
    await app.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

// The progress card holds focus while a build runs (Esc cancels it there); replacing it must hand focus on,
// never drop it on <body>: to the result's heading when it finishes, to "Build again" when cancelled, and back
// to Build when the build could not start.
test("[slow] focus moves on, not to the page body, when a build finishes, is cancelled or fails", async (t) => {
  const why = unavailable();
  if (why) return t.skip(why);
  const dataDir = seedDataDir("packrat-ui-buildfocus-");
  const { app, page, errors } = await launch(dataDir);
  const active = (): Promise<{ tag: string; id: string; text: string }> => page.evaluate(() => { const a = document.activeElement as HTMLElement; return { tag: a.tagName, id: a.id, text: (a.innerText || "").trim() }; });
  try {
    await page.locator("#inv-table tbody tr.item").first().waitFor({ timeout: 30_000 });
    await openTab(page, "builder");
    await page.waitForFunction(() => document.querySelector<HTMLSelectElement>("#b-char")?.value, { timeout: 10_000 });
    const name = await page.locator("#b-char").inputValue();
    await page.click("#b-sec-adv .b-sec-head button");
    await page.fill("#b-budget", "2");
    await page.click("#b-run");
    await page.waitForFunction(() => !document.querySelector<HTMLButtonElement>("#b-run")?.disabled && document.querySelector("#b-result h2"), undefined, { timeout: 60_000 });
    await page.waitForFunction(() => document.activeElement?.tagName === "H2", undefined, { timeout: 5_000 });
    assert.deepEqual(await active(), { tag: "H2", id: "", text: `Best suit for ${name}` }, "finished: the result's heading");

    // Held at the start request, so the card is up; Esc on the card cancels.
    let release = (): void => {};
    await page.route("**/api/optimize", async (r) => { await new Promise<void>((res) => { release = res; }); await r.abort().catch(() => {}); });
    await page.click("#b-run");
    await page.waitForSelector("#b-msg .b-progress");
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.querySelector<HTMLButtonElement>("#b-run")?.disabled);
    assert.equal((await active()).text, "Build again", "cancelled: Build again");
    release();
    await page.unroute("**/api/optimize");

    await page.route("**/api/optimize", (r) => r.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ ok: false, error: "internal error" }) }));
    await page.click("#b-run");
    await page.waitForSelector("#b-msg .msg.bad");
    assert.equal((await active()).id, "b-run", "failed to start: back to Build");
    await page.unroute("**/api/optimize");
    assert.deepEqual(errors, []);
  } finally {
    await app.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

// With no scans there is no character: Build and Save are disabled and say why, rather than staying live
// and only answering with a toast.
test("[slow] with no character, Build best suit and Save profile are disabled with the reason", async (t) => {
  const why = unavailable();
  if (why) return t.skip(why);
  const dataDir = mkdtempSync(join(tmpdir(), "packrat-ui-nochar-"));
  writeFileSync(join(dataDir, "settings.json"), JSON.stringify({ schemaVersion: 1, shard: "uoalive", setupDone: true }));
  const { app, page, errors } = await launch(dataDir);
  try {
    await openTab(page, "builder");
    await page.waitForSelector("#b-no-char");
    for (const id of ["#b-run", "#b-save"]) {
      assert.equal(await page.locator(id).isDisabled(), true, `${id} is disabled`);
      assert.match(await page.locator(id).getAttribute("title") || "", /no character to build for/);
      assert.equal(await page.locator(id).getAttribute("aria-describedby"), "b-no-char");
    }
    assert.deepEqual(errors, []);
  } finally {
    await app.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("[slow] a character's sheet opens from the roster, and a character can be forgotten from its row menu", async (t) => {
  const why = unavailable();
  if (why) return t.skip(why);
  const dataDir = seedDataDir("packrat-ui-forgetchar-");
  const { app, page, errors } = await launch(dataDir);
  try {
    await page.locator("#inv-table tbody tr.item").first().waitFor({ timeout: 30_000 });
    await openTab(page, "characters");
    const rows = page.locator("#char-table tbody tr[data-name]");
    await rows.first().waitFor({ timeout: 10_000 });
    assert.equal(await rows.count(), 2);
    const gone = (await rows.first().getAttribute("data-name"))!;
    const other = (await rows.nth(1).getAttribute("data-name"))!;
    // The name opens the sheet at its own route; next/previous walk the roster; the breadcrumb goes back.
    await rows.first().getByRole("link", { name: gone }).click();
    await page.waitForSelector(`#tab-characters .sheet[data-character="${gone}"]`);
    assert.equal(await page.evaluate(() => location.hash), `#/characters/${gone}`);
    assert.equal(await page.locator("#h-characters").innerText(), gone);
    await page.getByRole("button", { name: `Next character: ${other}` }).click();
    await page.waitForSelector(`#tab-characters .sheet[data-character="${other}"]`);
    // a filled slot tile shows that piece's tooltip lines
    const tile = page.locator("#tab-characters .sheet button.slot").first();
    const piece = await tile.locator(".nm").innerText();
    await tile.click();
    assert.ok((await page.locator(".pop.item-pop").innerText()).includes(piece), `the slot popover names ${piece}`);
    await page.keyboard.press("Escape");
    await page.locator("#tab-characters .crumbs").getByRole("link", { name: "Characters" }).click();
    await rows.first().waitFor();
    // Forget lives in the row's ⋯ menu, which the keyboard reaches: ↑ from the first item wraps to the last
    await rows.first().getByRole("button", { name: `More actions for ${gone}` }).click();
    const menu = page.getByRole("menu", { name: `Actions for ${gone}` });
    await menu.waitFor();
    await page.keyboard.press("ArrowUp");
    assert.equal(await page.evaluate(() => document.activeElement?.textContent), `Forget ${gone}…`, "↑ from the first item wraps to Forget");
    await page.keyboard.press("Enter");
    await confirmYes(page, new RegExp(`^Forget ${gone}\\?$`));
    await page.waitForFunction(() => document.querySelectorAll("#char-table tbody tr[data-name]").length === 1, undefined, { timeout: 15_000 });
    assert.notEqual(await rows.first().getAttribute("data-name"), gone);
    // Its worn set left the inventory with it: the Location filter no longer offers it.
    await openTab(page, "inventory");
    await openFacet(page, "loc", "Location");
    const locs = await page.locator(".pop input[type=checkbox]").evaluateAll((is) => is.map((i) => (i as HTMLInputElement).value));
    await page.keyboard.press("Escape");
    assert.ok(!locs.includes(`loc:Worn by ${gone}`), `no "Worn by ${gone}" location is left, got ${JSON.stringify(locs)}`);
    assert.doesNotMatch(await page.locator("#b-char").innerText(), new RegExp(gone));

    // "Show <name>'s items" narrows the Inventory with its Character filter, not a text search.
    await page.evaluate(() => { location.hash = "#/characters"; });
    await rows.first().waitFor();
    await rows.first().getByRole("button", { name: `More actions for ${other}` }).click();
    await page.getByRole("menuitem", { name: `Show ${other}'s items` }).click();
    await page.waitForFunction((n) => document.querySelector("#f-char")?.textContent === `Character: ${n}`, other, { timeout: 10_000 });
    assert.equal(await page.locator("#f-text").inputValue(), "");
    // A slot tile's popover opens the piece in the Inventory's item peek.
    await page.evaluate((n) => { location.hash = `#/characters/${encodeURIComponent(n)}`; }, other);
    const slot = page.locator("#tab-characters .sheet button.slot").first();
    await slot.waitFor({ timeout: 10_000 });
    const worn = await slot.locator(".nm").innerText();
    await slot.click();
    await page.locator(".pop.item-pop").getByRole("button", { name: "Open in Inventory" }).click();
    await page.waitForSelector("#inv-peek:not([hidden])", { timeout: 10_000 });
    assert.equal(await page.locator("#peek-title").innerText(), worn);

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
    await page.waitForSelector("#status", { state: "attached", timeout: 30_000 });   // attached, not visible: a narrow window collapses the sidebar, which hides the status line
    await page.route("**/api/profiles", (route) => route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ ok: false, error: "internal error" }) }));
    await page.reload();
    await page.waitForSelector("#wizard[open]", { timeout: 15_000 });
    await page.locator("#wizard").getByRole("button", { name: "Set up later" }).click();
    await page.waitForFunction(() => !/loading/.test(document.querySelector("#settings-body")?.textContent || "loading"), undefined, { timeout: 15_000 });
    assert.doesNotMatch(await page.locator("#import-body").innerText(), /^loading/);
    await openTab(page, "characters");
    assert.match(await page.locator("#char-body").innerText(), /\/api\/profiles/, "the Characters screen names the request that failed");
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
        const heads = await page.locator("#inv-table thead th").count();
        await page.click("#inv-settings");
        const off = page.locator("#inv-cols input[data-col]:not(:checked)").first();
        chip = (await off.getAttribute("data-col"))!;
        await off.click();
        await page.keyboard.press("Escape");
        await page.waitForFunction((n) => document.querySelectorAll("#inv-table thead th").length === n + 1, heads, { timeout: 10_000 });
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
      await page.waitForTimeout(500);
      await page.click("#inv-settings");
      assert.equal(await page.locator(`#inv-cols input[data-col="${chip}"]`).isChecked(), true, `the ${chip} column is still chosen after a restart`);
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
    await page.click("#b-sec-adv .b-sec-head button");   // the time budget is under Advanced, collapsed by default
    await page.fill("#b-budget", "3");
    await page.click("#b-run");
    await page.waitForFunction(() => !document.querySelector<HTMLButtonElement>("#b-run")?.disabled, undefined, { timeout: 60_000 });
    await page.waitForSelector("#b-runs .run-main", { state: "attached", timeout: 10_000 });

    // Open the saved run with its fetch held back, and switch character while it is in flight.
    await page.route("**/api/runs/*", async (route) => { await new Promise((r) => setTimeout(r, 1500)); await route.continue(); });
    await page.click("#b-runs-open");
    await page.click("#b-runs .run-card button[aria-haspopup=menu]");
    await page.getByRole("menuitem", { name: "Open" }).click();
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

// The data-folder banner (#39) with the scripts writing elsewhere: one short line with no paths, above every
// screen, and each screen shrinks to the room left (nothing past the window's bottom edge); "Show details"
// lands on Settings › Data, where the full sentence names both folders; Dismiss hides it. The client is planted
// in the test's own temp home (testEnv), never a real one.
test("[slow] the data-folder banner is one line above every screen, which fits below it, and leads to Settings › Data", async (t) => {
  const why = unavailable();
  if (why) return t.skip(why);
  const dataDir = seedDataDir("packrat-ui-notice-");
  const home = mkdtempSync(join(tmpdir(), "packrat-ui-notice-home-"));
  const scripts = join(home, "Desktop", "TazUO", "TazUO", "LegionScripts");
  mkdirSync(scripts, { recursive: true });
  writeFileSync(join(scripts, "packrat-scanner.py"), "# planted by the test\n");
  writeFileSync(join(scripts, "packrat-paths.json"), JSON.stringify({ dataDir: join(home, "elsewhere") }));
  const { _electron } = await import("playwright");
  const app = await _electron.launch({ args: [ROOT, "--data", dataDir], cwd: ROOT, timeout: 60_000, env: testEnv({}, home) });
  const page = await app.firstWindow();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  try {
    for (const size of [{ width: 1440, height: 900 }, { width: 1024, height: 700 }]) {
      const real = await fitWindow(app, page, size);
      for (const tab of ["inventory", "builder", "characters", "settings"]) {
        await openTab(page, tab);
        await page.waitForSelector("#notice:not([hidden])", { timeout: 15_000 });
        await page.waitForTimeout(300);
        const m = await page.evaluate((id) => ({
          notice: document.querySelector("#notice")!.getBoundingClientRect().height,
          text: document.querySelector("#notice > span")!.textContent,
          screenBottom: document.querySelector(`#tab-${id}`)!.getBoundingClientRect().bottom,
          vh: innerHeight,
        }), tab);
        assert.equal(m.text, "Your game scripts write scans to a different folder than Pack Rat is reading.");
        assert.ok(m.notice <= 56, `${tab} at ${real.width}: the banner is one line, got ${m.notice}px`);
        assert.ok(m.screenBottom <= m.vh + 0.5, `${tab} at ${real.width}: the screen ends at the window's bottom (${m.screenBottom} > ${m.vh})`);
      }
    }
    await openTab(page, "inventory");
    await page.locator("#notice").getByRole("link", { name: "Show details" }).click();
    await page.waitForSelector("#tab-settings:not([hidden]) #set-data .msg");
    assert.match(await page.locator("#set-data .msg").innerText(), /elsewhere/, "Settings › Data names the scripts' folder in full");
    await page.waitForFunction(() => { const r = document.querySelector("#set-data")!.getBoundingClientRect(); return r.top >= 0 && r.top < innerHeight; });
    await page.locator("#notice").getByRole("button", { name: "Dismiss" }).click();
    await page.waitForSelector("#notice", { state: "hidden" });
    assert.deepEqual(errors, []);
  } finally {
    await app.close();
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});
