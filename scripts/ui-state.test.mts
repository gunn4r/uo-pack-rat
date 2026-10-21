// ui-state.test.mts — [slow]: the page's state transitions in the real Electron window.
//
// `[slow]`: the page's state transitions in the real Electron window (same launch as `scripts/ui-smoke.test.mts`, on a writable `--data` directory seeded with the demo scans, since Forget refuses to write under `--demo`): a refresh keeps the Slot chip on the filter the table uses; Clear all clears the switches behind "+ Filter" and the search too, and hides the active strip; the table is virtual (a screenful of rows drawn, the last reached by scrolling); the item peek opens from a row click with the row selected, follows ↑/↓, closes with Esc (focus back on the row) and its Close button, reopens with Enter, and a row that keeps keyboard focus shows its tooltip after the delay; hovering a row shows its tooltip, hovering its action buttons hides it or keeps a pending one from opening, and hovering the row again brings it back; the Containers filters (a search by serial in any case, the Kind menu marking its current choice and opening on it, a Kind with no container, Clear filters; issue #487); with the table scrolled to its end, a Forget of the biggest container (from its row's ⋯ menu) still leaves rows on screen, keeps the builder's character and does not add weapon options; a build started for one character and finished while another is selected is not drawn under the other one, says whose build finished, and appears when its character is selected again; a saved run opened (with its fetch held back) just before a character switch is not drawn under the new character, and a slow run list for the old character does not fill the new one's drawer; a character's name in the Characters roster opens their sheet at `#/characters/<Name>`, next/previous and the breadcrumb walk the roster and back, a piece in the worn-gear list opens its tooltip, and Forget, reached from the row's ⋯ menu by keyboard (↑ wraps to it), removes the character's row, its worn set from the Location filter and its builder entry; "Show <name>'s items" sets the Inventory's Character filter rather than the search, and a piece's "Open in Inventory" shows that piece in the item peek; a failed `/api/profiles` during load (answered 500 through Playwright's request routing) still opens the first-run wizard, renders Settings and Import, and names the failed route in the Characters and Suit Builder tabs; and the Inventory column choice survives a restart of the app, whose page comes back on a new origin. Skipped the same way as the UI smoke test. Rarity at most (issue #11) leaves only the tier picked and lower ones, named in the active strip and on the chip. Also (issue #99) a container with items missing since its last scan: the "3 missing" badge on its row, none on a chest scanned once, and Show missing items listing them (a shrunk stack as "64 fewer"), a row's item tooltip drawn inside the dialog and the tooltip still on the page (and working) after the dialog is gone. A worn piece scanned low on durability (issue #98) gets its low-durability tag inside its own gear-list row and the sheet its one-line summary, a character with nothing low gets neither, and the roster badges it beside the character's name, inside the sticky Character cell and on screen without scrolling, with the sentence as the badge's accessible name and tooltip. A character scanned with Resisting Spells 100 (issue #261) has each resist held at 40 on the sheet's resist tiles, and the footnote names the ones the minimum lifts.
//
// Each of the first cases is a bug the 2026-09-22 review reproduced in a browser: a refresh resetting the filter while the table stayed filtered, the table showing nothing after a Forget shrank it, Forget re-running the whole page load (duplicated weapon options, the builder jumping to the first character), a build shown under whichever character was selected when it finished, a failed request leaving Settings on "loading…" forever, and no way to forget a character.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fitWindow, openFacet, settle, removeTempDir, pickCharacter, characterNames } from "./electron-window.mts";
import { ROOT, launchApp, skipWithoutElectron, tempDataDir, fakeBridge, until, type App, type FakeBridge, type QueuedCommand } from "./electron-app.mts";
import type { Page } from "playwright";

// The data folders hold the two demo scans (tempDataDir's demoScans), not --demo: Forget refuses to write into the committed fixtures.
// The real window, as close to 1440 × 900 as the screen allows (scripts/electron-window.mts). Below 1180 px the facet chips fold
// into "+ Filter", and pickOption/openFacet reach them there.
const launch = (dataDir: string): Promise<App> => launchApp(dataDir, { size: { width: 1440, height: 900 } });
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
  if (skipWithoutElectron(t)) return;
  const dataDir = tempDataDir("packrat-ui-state-", { demoScans: true });
  const { page, errors, close } = await launch(dataDir);
  try {
    await page.locator("#inv-table tbody tr.item").first().waitFor({ timeout: 30_000 });

    // A background refresh (what the "inventory" SSE event runs) must leave the filter chip showing
    // the filter the table still applies.
    await pickOption(page, "slot", "Slot", "bracelet");
    // Wait for the filtered count: "160 of 160" is the moment before the filter applies.
    await waitCount(page, /^(?!160 of)\d+ of 160 stacks/);
    const filtered = await countText(page);
    // The page's own module (same URL as its <script>, so the same instance). reload() redraws the filters (the chip) before it
    // returns; the rows and their count follow from a debounced GET /api/items. The count is blanked first, so its coming back
    // proves the table was drawn again from the refreshed answer.
    const refetched = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/items");
    await page.locator("#inv-foot .inv-count").evaluate((e) => { e.textContent = ""; });
    await page.evaluate(async (url) => { await (await import(url)).reload(); }, "/ui/inventory-data.mjs");
    await (await refetched).finished();
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

    // A Scroll of Transcendence's row names its skill and points, and the search finds it by them (issue #181).
    await page.fill("#f-text", "transcendence chivalry");
    await page.locator("#inv-table tbody tr.item", { hasText: "Scroll of Transcendence (Chivalry - 0.6 Pts)" }).first().waitFor({ timeout: 10_000 });
    await page.click("#f-clear");
    await waitCount(page, /^160 stacks · /);

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
    await page.waitForFunction(() => document.querySelector("#b-char")?.getAttribute("data-value"), { timeout: 10_000 });
    const names = await characterNames(page);
    await pickCharacter(page, names[1]!);
    // The Weapons chip's choices, counted in its popover: wiring the panel twice would draw a second chip. It is in the
    // Auto Build Settings drawer's Pool tab (issue #272).
    const weaponChoices = async (): Promise<number> => {
      assert.equal(await page.locator("#b-weapon").count(), 1, "one Weapons chip");
      if (await page.locator("#b-drawer").isHidden()) await page.click("#b-settings");
      await page.click("#b-tab-pool");
      await page.click("#b-weapon");
      const n = await page.locator(".pop input[type=checkbox]").count();
      await page.keyboard.press("Escape");
      await page.click("#b-drawer-close");
      return n;
    };
    const weaponOptions = await weaponChoices();

    await openTab(page, "containers");
    const rows = page.locator("#cont-table tbody tr[data-root]");
    // The Containers filters (#487): a search by serial narrows the rows and the footer says how many of all; a Kind with
    // no container (the demo's are on the ground) shows Clear filters, which brings every row back.
    const everyRow = await rows.count();
    const serial = (await rows.first().locator(".mono").innerText()).trim();
    await page.fill("#cont-q", `  ${serial.toUpperCase()} `);   // textHit: trimmed, any case
    await page.waitForFunction(() => document.querySelectorAll("#cont-table tbody tr[data-root]").length === 1);
    assert.match(await page.locator("#cont-foot").innerText(), new RegExp(`^1 of ${everyRow} containers`));
    await page.fill("#cont-q", "");
    assert.equal(await page.getAttribute("#cont-kind", "aria-haspopup"), "menu");
    await page.click("#cont-kind");
    assert.equal(await page.getByRole("menuitemradio", { name: /^Any kind/ }).getAttribute("aria-checked"), "true", "the current choice is marked");
    assert.match(await page.evaluate(() => document.activeElement?.textContent ?? ""), /^Any kind/, "the menu opens on its current choice");
    await page.getByRole("menuitemradio", { name: /^Backpack/ }).click();
    await page.click("#cont-kind");
    assert.equal(await page.getByRole("menuitemradio", { name: /^Backpack/ }).getAttribute("aria-checked"), "true");
    assert.match(await page.evaluate(() => document.activeElement?.textContent ?? ""), /^Backpack/, "and on the new one after a pick");
    assert.equal(await page.getByRole("menuitemradio", { name: /^Any kind/ }).getAttribute("aria-checked"), "false");
    await page.keyboard.press("Escape");
    await page.click("#cont-empty button");
    await page.waitForFunction((n) => document.querySelectorAll("#cont-table tbody tr[data-root]").length === n, everyRow);
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
    assert.equal(await page.getAttribute("#b-char", "data-value"), names[1], "Forget does not move the builder to another character");

    assert.deepEqual(errors, []);
  } finally {
    await close();
  }
});

// The item peek (design spec 4.3): a row click or Enter opens it beside the table with the row marked
// selected, ↑/↓ step through the rows with it following, Esc closes it and hands focus back to the row,
// and focusing a row for 400 ms shows the item tooltip.
test("[slow] the item peek opens from a row, follows the arrow keys and closes with Esc", async (t) => {
  if (skipWithoutElectron(t)) return;
  const dataDir = tempDataDir("packrat-ui-peek-", { demoScans: true });
  const { page, errors, close } = await launch(dataDir);
  try {
    const rows = page.locator("#inv-table tbody tr.item");
    await rows.first().waitFor({ timeout: 30_000 });
    const first = await rows.nth(0).getAttribute("data-serial");
    await rows.nth(0).click();
    await page.waitForSelector("#inv-peek:not([hidden])");
    assert.equal(await rows.nth(0).getAttribute("aria-selected"), "true");
    const title = await page.locator("#peek-title").innerText();
    assert.equal(title, await rows.nth(0).locator(".inv-name > .gi-name").innerText());
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
    // Hovering a row shows its tooltip; moving onto the row's action buttons hides it (#69), one still pending
    // on its delay never opens there, and moving back onto the row shows it again.
    await rows.nth(1).locator(".inv-name").hover();
    await page.waitForSelector("#tip[style*='block']", { timeout: 5_000 });
    await rows.nth(1).getByRole("button", { name: "More actions" }).hover();
    await page.waitForFunction(() => document.querySelector<HTMLElement>("#tip")?.style.display === "none");
    await rows.nth(2).locator(".inv-name").hover();
    await rows.nth(2).getByRole("button", { name: "More actions" }).hover();
    await page.waitForTimeout(700);   // sleep: past the tooltip's 400 ms delay, proving none shows
    assert.equal(await page.evaluate(() => document.querySelector<HTMLElement>("#tip")!.style.display), "none", "no item tooltip over the action buttons");
    await rows.nth(2).locator(".inv-name").hover();
    await page.waitForSelector("#tip[style*='block']", { timeout: 5_000 });
    await page.mouse.move(0, 0);
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
    await close();
  }
});

test("[slow] a build finished for one character is never shown under another", async (t) => {
  if (skipWithoutElectron(t)) return;
  const dataDir = tempDataDir("packrat-ui-build-", { demoScans: true });
  const { page, errors, close } = await launch(dataDir);
  try {
    await page.locator("#inv-table tbody tr.item").first().waitFor({ timeout: 30_000 });
    await openTab(page, "builder");
    await page.waitForFunction(() => document.querySelector("#b-char")?.getAttribute("data-value"), { timeout: 10_000 });
    const [builtFor, other] = await characterNames(page) as [string, string];
    await pickCharacter(page, builtFor);
    await page.click("#b-settings");   // the time budget is under Advanced, in the Settings drawer
    await page.click("#b-tab-advanced");
    await page.fill("#b-budget", "3");
    await page.click("#b-drawer-close");
    await page.click("#b-run");
    await pickCharacter(page, other);
    // The job ends when Build is enabled again.
    await page.waitForFunction(() => !document.querySelector<HTMLButtonElement>("#b-run")?.disabled, undefined, { timeout: 60_000 });
    const shown = await page.locator("#b-result").innerText();
    assert.doesNotMatch(shown, /Best suit for/, `the other character's panel must not show this build, got ${shown}`);
    const msg = await page.locator("#b-msg").innerText();
    assert.match(msg, new RegExp(`${builtFor}'s build finished`), `the message says whose build finished, got ${msg}`);

    // Switching back shows it, under the right name.
    await pickCharacter(page, builtFor);
    // the other character's first-visit heading is still there until the parked result draws: wait for it to go
    await page.waitForFunction((n) => document.querySelector("#b-result h2")?.textContent === `Best suit for ${n}`, builtFor, { timeout: 10_000 });
    await page.locator("#b-result").getByRole("button", { name: "Full sheet" }).click();
    assert.match(await page.locator("#b-result .sheet").first().innerText(), new RegExp(builtFor));

    assert.deepEqual(errors, []);
  } finally {
    await close();
  }
});

// The progress card holds focus while a build runs (Esc cancels it there); replacing it must hand focus on,
// never drop it on <body>: to the result's heading when it finishes, to "Build again" when cancelled, and back
// to Build when the build could not start.
test("[slow] focus moves on, not to the page body, when a build finishes, is cancelled or fails", async (t) => {
  if (skipWithoutElectron(t)) return;
  const dataDir = tempDataDir("packrat-ui-buildfocus-", { demoScans: true });
  const { page, errors, close } = await launch(dataDir);
  const active = (): Promise<{ tag: string; id: string; text: string }> => page.evaluate(() => { const a = document.activeElement as HTMLElement; return { tag: a.tagName, id: a.id, text: (a.innerText || "").trim() }; });
  try {
    await page.locator("#inv-table tbody tr.item").first().waitFor({ timeout: 30_000 });
    await openTab(page, "builder");
    await page.waitForFunction(() => document.querySelector("#b-char")?.getAttribute("data-value"), { timeout: 10_000 });
    const name = await page.getAttribute("#b-char", "data-value");
    await page.click("#b-settings");
    await page.click("#b-tab-advanced");
    await page.fill("#b-budget", "2");
    await page.click("#b-drawer-close");
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
    await close();
  }
});

// With no scans there is no character: the Build and save buttons are disabled and say why, rather than staying live
// and only answering with a toast.
test("[slow] with no character, Build, Save profile and Save as template are disabled with the reason", async (t) => {
  if (skipWithoutElectron(t)) return;
  const dataDir = mkdtempSync(join(tmpdir(), "packrat-ui-nochar-"));
  writeFileSync(join(dataDir, "settings.json"), JSON.stringify({ schemaVersion: 1, shard: "uoalive", setupDone: true }));
  const { page, errors, close } = await launch(dataDir);
  try {
    await openTab(page, "builder");
    await page.waitForSelector("#b-no-char", { state: "attached" });
    for (const id of ["#b-run", "#b-run-foot", "#b-save", "#b-save-tpl"]) {
      assert.equal(await page.locator(id).isDisabled(), true, `${id} is disabled`);
      assert.match(await page.locator(id).getAttribute("title") || "", /no character to build for/);
      assert.equal(await page.locator(id).getAttribute("aria-describedby"), "b-no-char");
    }
    // with no character the build picker reads "No build yet", focusing it is safe, and there is no What changed chip (issues #321, #336)
    assert.equal(await page.locator("#b-tpl .cbx-title").innerText(), "No build yet");
    await page.focus("#b-tpl");
    assert.equal(await page.locator("#b-chg").isVisible(), false);
    assert.deepEqual(errors, []);
  } finally {
    await close();
  }
});

test("[slow] a character's sheet opens from the roster, and a character can be forgotten from its row menu", async (t) => {
  if (skipWithoutElectron(t)) return;
  const dataDir = tempDataDir("packrat-ui-forgetchar-", { demoScans: true });
  const { page, errors, close } = await launch(dataDir);
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
    // a worn piece in the gear list shows that piece's tooltip lines
    const tile = page.locator("#tab-characters .sheet button.gi").first();
    const piece = await tile.locator(".gi-name").innerText();
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
    await openTab(page, "builder");
    assert.doesNotMatch((await characterNames(page)).join(" "), new RegExp(gone), "the Suit Builder's character picker no longer lists it");

    // "Show <name>'s items" narrows the Inventory with its Character filter, not a text search.
    await page.evaluate(() => { location.hash = "#/characters"; });
    await rows.first().waitFor();
    await rows.first().getByRole("button", { name: `More actions for ${other}` }).click();
    await page.getByRole("menuitem", { name: `Show ${other}'s items` }).click();
    await page.waitForFunction((n) => document.querySelector("#f-char")?.textContent === `Character: ${n}`, other, { timeout: 10_000 });
    assert.equal(await page.locator("#f-text").inputValue(), "");
    // A worn piece's popover opens it in the Inventory's item peek.
    await page.evaluate((n) => { location.hash = `#/characters/${encodeURIComponent(n)}`; }, other);
    const slot = page.locator("#tab-characters .sheet button.gi").first();
    await slot.waitFor({ timeout: 10_000 });
    const worn = await slot.locator(".gi-name").innerText();
    await slot.click();
    await page.locator(".pop.item-pop").getByRole("button", { name: "Open in Inventory" }).click();
    await page.waitForSelector("#inv-peek:not([hidden])", { timeout: 10_000 });
    assert.equal(await page.locator("#peek-title").innerText(), worn);

    assert.deepEqual(errors, []);
  } finally {
    await close();
  }
});

test("[slow] a failed request during load shows an error, renders Settings and still opens the wizard", async (t) => {
  if (skipWithoutElectron(t)) return;
  // No settings.json: a first run, so the wizard should open whatever the inventory fetch does.
  const dataDir = tempDataDir("packrat-ui-loadfail-", { demoScans: true, settings: null });
  const { page, close } = await launch(dataDir);
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
    await close();
  }
});

// The desktop app serves the page from a new port on every launch, so a column choice kept in
// localStorage (scoped to one origin) was gone at the next start. It is kept by the server now.
test("[slow] the Inventory column choice survives a restart of the desktop app", async (t) => {
  if (skipWithoutElectron(t)) return;
  const dataDir = tempDataDir("packrat-ui-cols-", { demoScans: true });
  try {
    let chip: string, origin: string;
    {
      const { page, close } = await launch(dataDir);
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
        await close({ keepData: true });
      }
    }
    const { page, close } = await launch(dataDir);
    try {
      await page.locator("#inv-table tbody tr.item").first().waitFor({ timeout: 30_000 });
      assert.notEqual(new URL(page.url()).origin, origin, "a new launch is a new origin");
      await page.click("#inv-settings");   // the page applies the saved columns before it draws the first row
      assert.equal(await page.locator(`#inv-cols input[data-col="${chip}"]`).isChecked(), true, `the ${chip} column is still chosen after a restart`);
    } finally {
      await close({ keepData: true });
    }
  } finally {
    removeTempDir(dataDir);
  }
});

// The sheet's Properties card lists the chosen properties (issue #47): the default set carries the three
// leeches, the "Properties shown" popover adds and removes rows, and Reset puts the default back.
test("[slow] the character sheet's shown properties are chosen in a popover and reset", async (t) => {
  if (skipWithoutElectron(t)) return;
  const dataDir = tempDataDir("packrat-ui-sheetprops-", { demoScans: true });
  const { page, errors, close } = await launch(dataDir);
  try {
    await page.locator("#inv-table tbody tr.item").first().waitFor({ timeout: 30_000 });
    await page.evaluate(() => { location.hash = "#/characters/Dorran"; });
    await page.waitForSelector('#tab-characters .sheet[data-character="Dorran"]', { timeout: 10_000 });
    const card = page.locator('#tab-characters section[aria-label="Properties"]');
    const rows = (): Promise<string[]> => card.locator(".sheet-props .kv-k").allInnerTexts();
    const shown = await rows();
    for (const r of ["Faster Casting", "Hit Chance Increase", "Hit Life Leech", "Hit Mana Leech", "Hit Stamina Leech", "Luck"]) assert.ok(shown.includes(r), `${r} is shown by default`);
    assert.ok(!shown.includes("Hit Fireball"), "a property outside the default set is off");
    await card.getByRole("button", { name: "Properties shown" }).click();
    const pop = page.getByRole("dialog", { name: "Properties shown" });
    await pop.locator('input[value="hitFireball"]').check();
    await pop.locator('input[value="hci"]').uncheck();
    const after = await rows();
    assert.ok(after.includes("Hit Fireball") && !after.includes("Hit Chance Increase"), `the card follows the choice, got ${JSON.stringify(after)}`);
    await pop.getByRole("button", { name: "Reset to default" }).click();
    const reset = await rows();
    assert.ok(reset.includes("Hit Chance Increase") && reset.includes("Hit Life Leech") && !reset.includes("Hit Fireball"), `Reset puts the default back, got ${JSON.stringify(reset)}`);
    assert.deepEqual(errors, []);
  } finally {
    await close();
  }
});

// Durability watch (issue #98): Dorran's Armor Of Initiation scanned at 12 of 150 durability gets a "Low
// durability 12/150" warning tag on its row of the worn gear list (issue #57), inside the row, and the sheet a one-line
// summary; Kestrel, with nothing low, gets neither; the roster badges "1 low" beside Dorran's name, in the sticky Character column.
test("[slow] a worn piece low on durability is badged on the sheet and beside its character's name on the roster", async (t) => {
  if (skipWithoutElectron(t)) return;
  const dataDir = tempDataDir("packrat-ui-durability-", { demoScans: true });
  const scan = join(dataDir, "scans", "demo-Dorran.json");
  writeFileSync(scan, readFileSync(scan, "utf8").replace('"Durability 150 / 150"', '"Durability 12 / 150"'));
  const { page, errors, close } = await launch(dataDir);
  try {
    await page.locator("#inv-table tbody tr.item").first().waitFor({ timeout: 30_000 });
    await page.evaluate(() => { location.hash = "#/characters/Dorran"; });
    await page.waitForSelector('#tab-characters .sheet[data-character="Dorran"]', { timeout: 10_000 });
    // the tag is drawn in capitals; its text is the words
    const badges = page.locator("#tab-characters .sheet .gi .tag.warn", { hasText: /durability/i });
    assert.deepEqual(await badges.allTextContents(), ["Low durability 12/150"]);
    const tile = page.locator('#tab-characters .gi[data-serial="1879834625"]');
    assert.equal(await tile.locator(".tag.warn", { hasText: /durability/i }).textContent(), "Low durability 12/150", "the tag is on the low piece's own row");
    const [tb, bb] = [await tile.locator("xpath=ancestor::td").boundingBox(), await tile.locator(".tag.warn", { hasText: /durability/i }).boundingBox()];
    assert.ok(tb && bb && bb.x >= tb.x && bb.x + bb.width <= tb.x + tb.width + 0.5, `the tag fits inside its row (cell ${JSON.stringify(tb)}, tag ${JSON.stringify(bb)})`);
    assert.equal(await page.locator("#char-body > .msg.warn").innerText(), "1 worn piece is low on durability");
    await page.evaluate(() => { location.hash = "#/characters/Kestrel"; });
    await page.waitForSelector('#tab-characters .sheet[data-character="Kestrel"]', { timeout: 10_000 });
    assert.equal(await badges.count(), 0, "nothing low, no tag");
    assert.equal(await page.locator("#char-body > .msg.warn").count(), 0, "nothing low, no summary");
    await page.evaluate(() => { location.hash = "#/characters"; });
    await page.waitForSelector("#char-table", { timeout: 10_000 });
    const nameCell = page.locator('#char-table tr[data-name="Dorran"] td:first-child');
    const low = nameCell.getByRole("img", { name: "1 worn piece is low on durability" });
    assert.equal(await low.innerText(), "1 low", "the badge sits beside the name");
    const [cb, lb] = [await nameCell.boundingBox(), await low.boundingBox()];
    const viewport = page.viewportSize() ?? await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    assert.ok(cb && lb && lb.x >= cb.x && lb.x + lb.width <= cb.x + cb.width + 0.5 && lb.x + lb.width <= viewport.width,
      `the badge is inside the sticky Character cell and on screen without scrolling (cell ${JSON.stringify(cb)}, badge ${JSON.stringify(lb)}, viewport ${JSON.stringify(viewport)})`);
    await low.focus();
    // The badge's own tooltip, and it alone once an earlier hover's has gone (issue #330: two were in the page for a moment).
    await page.getByRole("tooltip").filter({ hasText: /^1 worn piece is low on durability$/ }).waitFor();
    assert.equal(await settle(() => page.getByRole("tooltip").count(), (n) => n === 1), 1, "one tooltip showing");
    assert.equal(await page.getByRole("tooltip").innerText(), "1 worn piece is low on durability");
    assert.equal(await page.locator('#char-table tr[data-name="Kestrel"] .badge').count(), 0, "nothing low, no badge");
    assert.deepEqual(errors, []);
  } finally {
    await close();
  }
});

// The Resisting Spells minimum on the sheet (issue #261): Dorran scanned with Resisting Spells 100 wears Physical 18,
// Fire 72, Cold 41, Poison 32 and Energy 60. The minimum of 40 holds Physical and Poison up, which the tiles show and
// the footnote names; the others are the gear's own, Fire capped at 70.
test("[slow] the character sheet holds each resist at the Resisting Spells minimum and says which ones it lifts", async (t) => {
  if (skipWithoutElectron(t)) return;
  const dataDir = tempDataDir("packrat-ui-resistmin-", { demoScans: true });
  const scan = join(dataDir, "scans", "demo-Dorran.json");
  const raw = readFileSync(scan, "utf8"), edited = raw.replace('"skills": {},', '"skills": { "Resisting Spells": { "base": 100, "value": 100, "cap": 100 } },');
  assert.notEqual(edited, raw, "the demo scan's empty skills were found and given Resisting Spells 100");
  writeFileSync(scan, edited);
  const { page, errors, close } = await launch(dataDir);
  try {
    await page.locator("#inv-table tbody tr.item").first().waitFor({ timeout: 30_000 });
    await page.evaluate(() => { location.hash = "#/characters/Dorran"; });
    await page.waitForSelector('#tab-characters .sheet[data-character="Dorran"]', { timeout: 10_000 });
    const values = await page.locator("#tab-characters .sheet .resist .kpi-value .t-2xl").allInnerTexts();
    assert.deepEqual(values, ["40", "70", "41", "40", "60"]);
    assert.equal(await page.locator("#tab-characters .sheet-foot > p").innerText(), "Resists are capped at 70, and Resisting Spells keeps each at 40 or more. Physical 40, Poison 40: the Resisting Spells minimum.");
    assert.deepEqual(errors, []);
  } finally {
    await close();
  }
});

// Inventory columns resize from the keyboard (issue #46): → on a header's resize handle widens the header
// and the rows' cells with it, and table settings' "Reset column widths" puts the default back.
test("[slow] an Inventory column is resized with the keyboard and reset in table settings", async (t) => {
  if (skipWithoutElectron(t)) return;
  const dataDir = tempDataDir("packrat-ui-colwidths-", { demoScans: true });
  const { page, errors, close } = await launch(dataDir);
  try {
    await page.locator("#inv-table tbody tr.item").first().waitFor({ timeout: 30_000 });
    const widths = (): Promise<[number, number]> => page.evaluate(() => {
      const i = [...document.querySelectorAll("#inv-table thead th")].findIndex((th) => th.textContent?.startsWith("Location"));
      const w = (e: Element | null | undefined): number => e?.getBoundingClientRect().width ?? 0;
      return [w(document.querySelectorAll("#inv-table thead th")[i]), w(document.querySelector("#inv-table tbody tr.item")?.children[i])];
    });
    const [head, cell] = await widths();
    assert.equal(cell, head, "a row cell is as wide as its header");
    const handle = page.getByRole("separator", { name: "Resize Location" });
    await handle.focus();
    for (let i = 0; i < 5; i++) await handle.press("ArrowRight");
    const [wideHead, wideCell] = await widths();
    assert.ok(wideHead > head, `→ widens the header (${head} → ${wideHead})`);
    assert.equal(wideCell, wideHead, "the rows' cells follow the header");
    await page.click("#inv-settings");
    await page.getByRole("dialog", { name: "Table settings" }).getByRole("button", { name: "Reset column widths" }).click();
    assert.deepEqual(await widths(), [head, cell], "Reset puts the default width back");
    assert.deepEqual(errors, []);
  } finally {
    await close();
  }
});

// The saved-runs path has its own awaits: openRun fetches the run and resolves its pieces before
// drawing, and loadRuns fetches the list. A character switch during either must not draw one
// character's run (or list) under another.
test("[slow] a saved run or run list that lands after a character switch is not shown under the new character", async (t) => {
  if (skipWithoutElectron(t)) return;
  const dataDir = tempDataDir("packrat-ui-runs-", { demoScans: true });
  const { page, errors, close } = await launch(dataDir);
  try {
    await page.locator("#inv-table tbody tr.item").first().waitFor({ timeout: 30_000 });
    await openTab(page, "builder");
    await page.waitForFunction(() => document.querySelector("#b-char")?.getAttribute("data-value"), { timeout: 10_000 });
    const [builtFor, other] = await characterNames(page) as [string, string];
    await pickCharacter(page, builtFor);
    await page.click("#b-settings");   // the time budget is under Advanced, in the Settings drawer
    await page.click("#b-tab-advanced");
    await page.fill("#b-budget", "3");
    await page.click("#b-drawer-close");
    await page.click("#b-run");
    await page.waitForFunction(() => !document.querySelector<HTMLButtonElement>("#b-run")?.disabled, undefined, { timeout: 60_000 });
    await page.waitForSelector("#b-runs .run-main", { state: "attached", timeout: 10_000 });

    // Open the saved run with its fetch held back, and switch character while it is in flight.
    await page.route("**/api/runs/*", async (route) => { await new Promise((r) => setTimeout(r, 1500)); await route.continue(); });   // sleep: the run's fetch held back on purpose
    await page.click("#b-runs-open");
    await page.click("#b-runs .run-card button[aria-haspopup=menu]");
    await page.getByRole("menuitem", { name: "Open", exact: true }).click();
    await pickCharacter(page, other);
    await page.waitForTimeout(3000);   // sleep: past the held-back fetch, proving its late answer is not drawn
    assert.doesNotMatch(await page.locator("#b-result").innerText(), /Best suit for/, "the run opened for one character is not drawn under the other");
    await page.unroute("**/api/runs/*");

    // A slow run list for the old character must not fill the drawer under the new one.
    await page.route(`**/api/runs?character=${encodeURIComponent(builtFor)}`, async (route) => { await new Promise((r) => setTimeout(r, 1500)); await route.continue(); });   // sleep: the list's fetch held back on purpose
    await pickCharacter(page, builtFor);
    await pickCharacter(page, other);
    await page.waitForTimeout(3000);   // sleep: past the held-back fetch, proving its late answer is not drawn
    assert.equal(await page.locator("#b-runs .run-main").count(), 0, `${other} has no saved runs; ${builtFor}'s late list must not show under ${other}`);

    assert.deepEqual(errors, []);
  } finally {
    await close();
  }
});

// The data-folder banner (#39) with the scripts writing elsewhere: one short line with no paths, above every
// screen, and each screen shrinks to the room left (nothing past the window's bottom edge); "Show details"
// lands on Settings › Data, where the full sentence names both folders; Dismiss hides it. The client is planted
// in the test's own temp home (testEnv), never a real one.
test("[slow] the data-folder banner is one line above every screen, which fits below it, and leads to Settings › Data", async (t) => {
  if (skipWithoutElectron(t)) return;
  const dataDir = tempDataDir("packrat-ui-notice-", { demoScans: true });
  const home = mkdtempSync(join(tmpdir(), "packrat-ui-notice-home-"));
  const scripts = join(home, "Desktop", "TazUO", "TazUO", "LegionScripts");
  mkdirSync(scripts, { recursive: true });
  writeFileSync(join(scripts, "packrat-scanner.py"), "# planted by the test\n");
  writeFileSync(join(scripts, "packrat-paths.json"), JSON.stringify({ dataDir: join(home, "elsewhere") }));
  const { app, page, errors, close } = await launchApp(dataDir, { home });
  try {
    for (const size of [{ width: 1440, height: 900 }, { width: 1024, height: 700 }]) {
      const real = await fitWindow(app, page, size);
      for (const tab of ["inventory", "builder", "characters", "settings"]) {
        await openTab(page, tab);
        await page.waitForSelector("#notice:not([hidden])", { timeout: 15_000 });
        const m = await settle(() => page.evaluate((id) => ({
          notice: document.querySelector("#notice")!.getBoundingClientRect().height,
          text: document.querySelector("#notice > span")!.textContent,
          screenBottom: document.querySelector(`#tab-${id}`)!.getBoundingClientRect().bottom,
          vh: innerHeight,
        }), tab), (v) => v.notice <= 56 && v.screenBottom <= v.vh + 0.5);
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
    await close();
    removeTempDir(home);
  }
});

// Issue #38: a ground container blacklisted from its ⋯ menu in Containers (Remove also forgets what was
// scanned in it), listed in Settings › Data, and unblacklisted there.
test("[slow] a ground container is blacklisted from Containers and unblacklisted in Settings", async (t) => {
  if (skipWithoutElectron(t)) return;
  const dataDir = tempDataDir("packrat-ui-blacklist-", { demoScans: true });
  const { page, errors, close } = await launch(dataDir);
  try {
    await openTab(page, "containers");
    const rows = page.locator("#cont-table tbody tr[data-root]");
    await rows.first().waitFor({ timeout: 15_000 });
    const before = await rows.count();
    const ground = rows.last();   // the demo's roots are all ground containers
    const serial = await ground.getAttribute("data-root");
    await ground.getByRole("button", { name: /^Actions for / }).click();
    await page.getByRole("menuitem", { name: "Blacklist…" }).click();
    await confirmYes(page, /^Also remove .+ and its \d+ items? from Pack Rat\?$/);
    await page.waitForFunction((n) => document.querySelectorAll("#cont-table tbody tr[data-root]").length === n - 1, before, { timeout: 15_000 });
    assert.equal(await page.locator(`#cont-table tr[data-root="${serial}"]`).count(), 0, "Remove forgot what was scanned in it");

    await openTab(page, "settings");
    const card = page.locator("#set-blacklist");
    const unlist = card.getByRole("button", { name: /^Unblacklist / });
    await unlist.waitFor({ timeout: 15_000 });
    assert.equal(await unlist.count(), 1);
    await unlist.click();
    await page.waitForFunction(() => /None\./.test(document.querySelector("#set-blacklist")?.textContent || ""), undefined, { timeout: 15_000 });
    assert.deepEqual(JSON.parse(readFileSync(join(dataDir, "scan-blacklist.json"), "utf8")), []);
    assert.deepEqual(errors, []);
  } finally {
    await close();
  }
});

// Missing since last scan (issue #99): Kestrel's chest scanned twice, the second time without its Runebook and Drum
// and with 64 fewer gold. Its row carries a "3 missing" badge and its menu Show missing items, whose dialog lists
// them, each row with its item tooltip (drawn inside the dialog, and still on the page after it closes); Dorran's chest, scanned once, has neither. Recent stamps, or retention prunes the older scan at startup.
test("[slow] a container with items missing since its last scan shows a badge and lists them", async (t) => {
  if (skipWithoutElectron(t)) return;
  const dataDir = tempDataDir("packrat-ui-missing-", { demoScans: true });
  const kestrel = JSON.parse(readFileSync(join(ROOT, "app", "fixtures", "demo-Kestrel.json"), "utf8")) as { items: Array<{ name: string; amount: number; tooltip: string[] }> };
  const day = (n: number): string => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 19);   // v1 stamps are naive local time
  const later = kestrel.items.filter((it) => it.name !== "Runebook" && it.name !== "Drum")
    .map((it) => (it.name === "Gold Coin" ? { ...it, amount: it.amount - 64, tooltip: [`${it.amount - 64} Gold Coin`] } : it));
  writeFileSync(join(dataDir, "scans", "demo-Kestrel.json"), JSON.stringify({ ...kestrel, scannedAt: day(2) }));
  writeFileSync(join(dataDir, "scans", "demo-Kestrel-2.json"), JSON.stringify({ ...kestrel, scannedAt: day(1), items: later }));
  const { page, errors, close } = await launch(dataDir);
  try {
    await openTab(page, "containers");
    const row = page.locator('#cont-table tr[data-root="1879769088"]');   // Kestrel's chest, 0x700b0000
    await row.waitFor({ timeout: 15_000 });
    assert.equal(await row.locator(".tag.warn").textContent(), "3 missing");
    const other = page.locator('#cont-table tr[data-root="1879834624"]');   // Dorran's chest, 0x700c0000
    assert.equal(await other.locator(".tag.warn").count(), 0);
    await other.getByRole("button", { name: /^Actions for / }).click();
    assert.equal(await page.getByRole("menuitem", { name: "Show missing items" }).count(), 0, "nothing missing, no menu entry");
    await page.keyboard.press("Escape");

    await row.getByRole("button", { name: /^Actions for / }).click();
    await page.getByRole("menuitem", { name: "Show missing items" }).click();
    const dialog = page.locator("dialog.dialog[open]");
    await dialog.waitFor({ timeout: 10_000 });
    assert.match(await dialog.locator("h2").innerText(), /^Missing from /);
    const cells = await dialog.locator("tbody tr").evaluateAll((trs) => trs.map((tr) => [...tr.querySelectorAll("td")].slice(0, 2).map((td) => td.textContent)));
    assert.deepEqual(cells, [["Drum", "1"], ["Gold Coin", "64 fewer"], ["Runebook", "1"]]);
    assert.match(await dialog.locator("tbody tr").first().locator("td").nth(2).innerText(), /h ago|\d/);
    // a missing item's row shows the item tooltip (the record the dialog drew: the server no longer has the item),
    // drawn inside the modal dialog so it sits above it; closing the dialog removes it, never the tooltip
    await dialog.locator("tbody tr").first().hover();
    await page.waitForFunction(() => getComputedStyle(document.querySelector("#tip")!).display === "block", undefined, { timeout: 10_000 });
    assert.equal(await page.locator("#tip .tip-name").innerText(), "Drum");
    assert.equal(await page.evaluate(() => document.querySelector("#tip")!.parentElement?.tagName), "DIALOG");
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "detached", timeout: 10_000 });
    assert.equal(await page.evaluate(() => document.querySelector("#tip")?.parentElement === document.body), true, "the tooltip is back on the page");
    await page.locator("#inv-view").getByRole("radio", { name: "Items" }).click();
    await page.locator("#inv-table tbody tr.item td:nth-child(2)").first().hover();
    await page.waitForFunction(() => getComputedStyle(document.querySelector("#tip")!).display === "block", undefined, { timeout: 10_000 });
    assert.deepEqual(errors, []);
  } finally {
    await close();
  }
});

// Highlight in game (issue #10): a ground container's row menu queues the bridge's highlight for the container
// itself, with no chain (nothing to open) and its scanned tile; offline, the item is disabled with the reason.
test("[slow] Highlight in game queues a highlight for a ground container, and is disabled while the bridge is offline", async (t) => {
  if (skipWithoutElectron(t)) return;
  const dataDir = tempDataDir("packrat-ui-highlight-", { demoScans: true });
  const { page, errors, close } = await launch(dataDir);
  let bridge: FakeBridge | undefined;
  try {
    await openTab(page, "containers");
    const row = page.locator("#cont-table tbody tr[data-root]").last();   // the demo's roots are all ground containers
    await row.waitFor({ timeout: 15_000 });
    const serial = Number(await row.getAttribute("data-root"));
    const item = page.getByRole("menuitem", { name: "Highlight in game" });
    await row.getByRole("button", { name: /^Actions for / }).click();
    assert.equal(await item.getAttribute("aria-disabled"), "true");
    assert.match(await item.getAttribute("title") || "", /^Bridge offline/);
    await page.keyboard.press("Escape");

    bridge = fakeBridge(dataDir);
    await page.waitForFunction(() => document.querySelector("#bridge")?.getAttribute("data-state") === "ready", undefined, { timeout: 15_000 });
    await row.getByRole("button", { name: /^Actions for / }).click();
    await item.click();
    const lines = await until(() => bridge!.queue<QueuedCommand & { serial: number; name: string; chain: number[]; pos: { x: number; y: number } | null }>(), (l) => l.length > 0, "a queued command");
    assert.equal(lines.length, 1, "one command queued");
    const cmd = lines[0]!;
    assert.deepEqual([cmd.action, cmd.serial, cmd.chain], ["highlight", serial, []]);
    assert.equal(cmd.name, "Metal Chest");
    assert.deepEqual([cmd.pos?.x, cmd.pos?.y], [1000, 1000]);
    assert.deepEqual(errors, []);
  } finally {
    bridge?.stop();
    await close();
  }
});

// Rarity at most (issue #11): the Rarity popover's second list caps the tier. The strip and the chip say
// so, and every tier left in the table is the one picked or a lower one.
test("[slow] Rarity at most keeps the tier picked and the ones below it", async (t) => {
  if (skipWithoutElectron(t)) return;
  const dataDir = tempDataDir("packrat-ui-raritymax-", { demoScans: true });
  const { page, errors, close } = await launch(dataDir);
  try {
    await page.locator("#inv-table tbody tr.item").first().waitFor({ timeout: 30_000 });
    await openFacet(page, "rarity", "Rarity");
    await page.locator(".pop").getByRole("radiogroup", { name: "Rarity at most" }).locator('input[value="Lesser Magic Item"]').click();
    await waitCount(page, / of /);
    assert.ok((await page.locator("#inv-active .token").allInnerTexts()).some((s) => s.includes("Rarity ≤ Lesser Magic Item")), "the strip names the ceiling");
    if (await page.locator("#f-rarity").isVisible()) assert.match(await page.locator("#f-rarity").innerText(), /Rarity ≤ Lesser Magic/);
    for (const tier of await page.locator("#inv-table tbody tr.item .rar-tier").allInnerTexts()) {
      assert.ok(["Minor Magic Item", "Lesser Magic Item"].includes(tier.trim()), `a ${tier} row is above the ceiling`);
    }
    assert.deepEqual(errors, []);
  } finally {
    await close();
  }
});

test("[slow] a yes/no property picked in the property rule narrows the rows to the items that have it (issue #182)", async (t) => {
  if (skipWithoutElectron(t)) return;
  const dataDir = tempDataDir("packrat-ui-flag-", { demoScans: true });
  const { app, page, errors, close } = await launch(dataDir);
  try {
    await fitWindow(app, page, { width: 1024, height: 768 });
    await page.locator("#inv-table tbody tr.item").first().waitFor({ timeout: 30_000 });
    await page.click("#f-add");
    await page.getByRole("menuitem", { name: "Property rule…" }).click();
    const pop = page.locator(".pop");
    await pop.getByPlaceholder("Find a property").fill("spell");
    await pop.getByRole("option", { name: "Spell Channeling" }).click();
    assert.equal(await pop.getByRole("radiogroup", { name: "Comparison" }).isHidden(), true, "a yes/no property has no comparison");
    assert.equal(await pop.getByRole("spinbutton", { name: "Value" }).isHidden(), true, "and no number");
    assert.equal(await page.evaluate(() => document.activeElement?.textContent), "Add rule", "Add rule takes the focus, so Enter adds it");
    await page.keyboard.press("Enter");
    await waitCount(page, /^1 of /);
    assert.ok((await page.locator("#inv-active .token").allInnerTexts()).some((s) => s.trim() === "Spell Channeling"), "the strip shows the property as a token");
    assert.deepEqual((await page.locator("#inv-table tbody tr.item").allInnerTexts()).map((s) => s.includes("Animated Katana")), [true]);
    await page.locator("#inv-active").getByRole("button", { name: "Remove filter: Spell Channeling" }).click();
    await waitCount(page, /^[\d,]+ stacks/);
    assert.deepEqual(errors, []);
  } finally {
    await close();
  }
});

test("[slow] Swordsmanship picked in the Weapon skill chip narrows the rows to swords (issue #188)", async (t) => {
  if (skipWithoutElectron(t)) return;
  const dataDir = tempDataDir("packrat-ui-wskill-", { demoScans: true });
  const { app, page, errors, close } = await launch(dataDir);
  try {
    await fitWindow(app, page, { width: 1024, height: 768 });
    await page.locator("#inv-table tbody tr.item").first().waitFor({ timeout: 30_000 });
    await openFacet(page, "wskill", "Weapon skill");
    assert.match(await page.locator(".pop").innerText(), /Use Best Weapon Skill weapons count under Swordsmanship, Fencing and Mace Fighting\./);
    await page.locator('.pop input[value="swordsmanship"]').click();
    await page.keyboard.press("Escape");
    await waitCount(page, /^13 of 160 stacks/);
    assert.ok((await page.locator("#inv-active .token").allInnerTexts()).some((s) => s.trim() === "Weapon skill: Swordsmanship"), "the strip shows the skill as a token");
    const swords = ["Animated Katana", "Arcane Crescent Blade", "Bladed Staff Of Haste", "Broadsword", "Cleaver", "Halberd", "Halberd Of The Vampire", "Longsword", "Vicious Crescent Blade"];
    const rows = await page.locator("#inv-table tbody tr.item .inv-name").allInnerTexts();
    assert.ok(rows.length > 0 && rows.every((r) => swords.some((s) => r.includes(s))), JSON.stringify(rows));
    assert.deepEqual(errors, []);
  } finally {
    await close();
  }
});

test("[slow] the Slayer filter lists each super slayer above its lesser slayers, and picking one narrows the rows (issue #189)", async (t) => {
  if (skipWithoutElectron(t)) return;
  const dataDir = tempDataDir("packrat-ui-slayer-", { demoScans: true });
  const { app, page, errors, close } = await launch(dataDir);
  try {
    await fitWindow(app, page, { width: 1024, height: 768 });
    await page.locator("#inv-table tbody tr.item").first().waitFor({ timeout: 30_000 });
    await page.click("#f-add");
    await page.getByRole("menuitem", { name: "Slayer…" }).click();
    const list = page.locator(".pop").getByRole("radiogroup", { name: "Slayer" });
    const rows = (await list.locator(".inv-opt").allInnerTexts()).map((s) => s.split("\n")[0]!.trim());
    // The demo scans hold Gargoyle Slayer items but no Demon Slayer one: Demon still heads them, pickable at 0, and so is every slayer of the table.
    const demon = rows.findIndex((s) => s.startsWith("Demon Slayer")), gargoyle = rows.indexOf("Gargoyle Slayer");
    assert.ok(demon >= 0 && gargoyle > demon, `Demon Slayer heads Gargoyle Slayer: ${JSON.stringify(rows)}`);
    assert.equal((await list.locator(".inv-opt").nth(demon).locator(".inv-opt-count").innerText()).trim(), "0", "a slayer the inventory lacks is listed at 0");
    assert.equal(await list.locator('input[value="Demon"]').count(), 1, "and can be picked");
    assert.ok(rows.includes("Wolf Slayer"), "every slayer of the table is listed");
    const count = (await list.locator(".inv-opt").nth(gargoyle).locator(".inv-opt-count").innerText()).trim();
    await list.locator('input[value="Gargoyle"]').click();
    await waitCount(page, new RegExp(`^${count} of `));
    assert.ok((await page.locator("#inv-active .token").allInnerTexts()).some((s) => s.includes("Slayer: Gargoyle Slayer")), "the strip names the slayer");
    assert.equal(await page.locator("#inv-table tbody tr.item").count(), Number(count));
    assert.deepEqual(errors, []);
  } finally {
    await close();
  }
});
