// ui-builder.test.mts — [slow]: the Suit Builder's keyboard, hover and panel behavior in the real Electron window.
//
// `[slow]`: the Suit Builder's keyboard and hover behaviour in the real Electron window, on a writable `--data` directory seeded with the demo scans: a raised resist cap (Fire 95) marked in the Resist caps section, built with, shown on the result's Fire tile and the saved run's badge, kept by Save profile across a reload, refused out of range with the error under the field, and reset to the shard's cap; ⌘↵ (Ctrl+Enter) builds with focus on the page body and while typing in a panel field, and does nothing behind the Saved runs drawer; the current suit's and the Fetch list's pieces show the item tooltip on hover and after Tab focus, and so do both names in a Plan row, each its own piece's (issue #75; the row itself and its Slot cell show none, a kept row's worn name still does); a Fetch list row shows a deep bag path in full (nothing cut or ellipsised) and its copy button puts the container serial on the clipboard; STR limit is beside Race with Advanced closed, and a bad value there is focused without opening Advanced; a switch's on track is at least 3:1 against its off track, with the knob moved right, in Default and Britannia, light and dark; two excluded weapon skills show on the Weapons chip and survive Save profile and a reload; Check your settings (issue #217): a hard Luck requirement no suit reaches is named with the best possible above the progress panel and in the result, and Lower and Make soft edit the panel's floor and the template badge without starting a build; a weight row's worth hint follows the typed weight and hides on a bad value, and Set weight (a Luck weight that swamps the rest) edits the panel and the template badge, but not once the weight was changed since the build. Manual mode (issue #12): a slot opens the picker on its pieces, a row picked with the keyboard (focus, Enter) fills the slot, moves the totals and says so in the status line, the picker stays on that slot with the picked row marked "In this slot", the undo key empties the slot again (the status line saying what was undone) and redo puts the piece back, Esc closes it with focus back on the slot card, and the mode and the suit are in `ui-prefs.json`; and the hand-offs: another character picked mid-fill cancels the fill and leaves the suit alone, Fill the rest automatically fills empty slots around a placed ring in one undo step and shows the fetch list, Save as run puts a Manual run in the drawer that opens in the result view with Open in Manual, and an Automatic result's Start from this result loads it into Manual as one undo step.
//
// Each of the older cases is maintainer feedback on the redesign (PR #43), plus the resist cap overrides (issue #44) and the weapon exclusions (issue #45). Skipped when electron or playwright is absent, or under TEST_SKIP_ELECTRON.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, copyFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { fitWindow, noUpdateCheck } from "./electron-window.mts";
import type { ElectronApplication, Locator, Page } from "playwright";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const require_ = createRequire(import.meta.url);
function unavailable(): string | null {
  if (process.env.TEST_SKIP_ELECTRON) return "TEST_SKIP_ELECTRON is set";
  for (const dep of ["electron", "playwright"]) {
    try { require_.resolve(dep); } catch { return `${dep} is not installed`; }
  }
  return null;
}
// A writable data directory holding the two demo scans, set up so the first-run wizard stays closed.
function seedDataDir(prefix: string): string {
  const dataDir = mkdtempSync(join(tmpdir(), prefix));
  mkdirSync(join(dataDir, "scans"), { recursive: true });
  for (const f of ["demo-Dorran.json", "demo-Kestrel.json"]) copyFileSync(join(ROOT, "app", "fixtures", f), join(dataDir, "scans", f));
  writeFileSync(join(dataDir, "settings.json"), JSON.stringify({ schemaVersion: 1, shard: "uoalive", setupDone: true }));
  return dataDir;
}
async function launch(dataDir: string): Promise<{ app: ElectronApplication; page: Page; errors: string[] }> {
  const { _electron } = await import("playwright");
  const app = await _electron.launch({ args: [ROOT, "--data", noUpdateCheck(dataDir)], cwd: ROOT, timeout: 60_000 });
  const page = await app.firstWindow();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await fitWindow(app, page, { width: 1440, height: 900 });
  return { app, page, errors };
}
// The Suit Builder with its first character's current suit showing, and a 2 s time budget so builds are quick.
async function openBuilder(page: Page): Promise<void> {
  await page.locator("#inv-table tbody tr.item").first().waitFor({ timeout: 30_000 });
  await page.click('[data-nav="builder"]');
  await page.waitForSelector("#tab-builder:not([hidden]) #b-current", { timeout: 10_000 });
  await page.click("#b-sec-adv .b-sec-head button");
  await page.fill("#b-budget", "2");
  await page.click("#b-sec-adv .b-sec-head button");
}
const built = (page: Page): Promise<void> => page.waitForFunction(() => !document.querySelector<HTMLButtonElement>("#b-run")?.disabled && /Best suit for/.test(document.querySelector("#b-result h2")?.textContent || ""), undefined, { timeout: 60_000 }).then(() => {});

test("[slow] ⌘↵ builds from anywhere on the Builder screen, and not from behind a drawer", async (t) => {
  const why = unavailable();
  if (why) return t.skip(why);
  const dataDir = seedDataDir("packrat-ui-buildkey-");
  const { app, page, errors } = await launch(dataDir);
  try {
    await openBuilder(page);
    let starts = 0;   // build requests the page sent (a repeat of the same settings saves no second run)
    page.on("request", (r) => { if (r.method() === "POST" && new URL(r.url()).pathname === "/api/optimize") starts++; });
    // A click on plain text leaves focus on <body>, outside the screen: the key still builds.
    await page.click("#b-current h2");
    assert.equal(await page.evaluate(() => document.activeElement?.tagName), "BODY");
    await page.keyboard.press("ControlOrMeta+Enter");
    await built(page);
    assert.equal(starts, 1, "one build from the page body");

    // While typing in a panel field.
    await page.locator("#b-sec-req input[type=number]").first().click();
    const second = page.waitForRequest((r) => r.method() === "POST" && new URL(r.url()).pathname === "/api/optimize", { timeout: 10_000 });
    await page.keyboard.press("ControlOrMeta+Enter");
    await second;
    await built(page);
    assert.equal(starts, 2, "a second build from a requirement field");

    // Behind the Saved runs drawer the screen is inert: no build.
    await page.click("#b-runs-open");
    await page.waitForSelector("#runs-drawer:not([hidden])");
    await page.keyboard.press("ControlOrMeta+Enter");
    await page.waitForTimeout(500);
    assert.equal(await page.locator("#b-run").isDisabled(), false, "no build started behind the drawer");
    assert.equal(starts, 2);
    assert.deepEqual(errors, []);
  } finally {
    await app.close();
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});

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

test("[slow] the current suit's pieces show the item tooltip on hover and on keyboard focus", async (t) => {
  const why = unavailable();
  if (why) return t.skip(why);
  const dataDir = seedDataDir("packrat-ui-buildtip-");
  const { app, page, errors } = await launch(dataDir);
  try {
    await openBuilder(page);
    const rows = page.locator("#b-current tbody tr");
    assert.ok(await rows.count() > 0, "the current suit lists worn pieces");
    const name = await rows.nth(1).locator("td").nth(1).innerText();
    assert.equal(await hoverTip(page, rows.nth(1)), name);
    // Tab from the row before reaches the row, and the tooltip follows it.
    await page.mouse.move(2, 2);
    await rows.nth(0).focus();
    await page.keyboard.press("Tab");
    assert.equal(await page.evaluate(() => document.activeElement?.closest("tr")?.dataset.serial != null), true, "the row takes focus");
    assert.equal(await tipName(page), name);
    assert.deepEqual(errors, []);
  } finally {
    await app.close();
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});

test("[slow] the Fetch list's pieces show the item tooltip on hover and on keyboard focus", async (t) => {
  const why = unavailable();
  if (why) return t.skip(why);
  const dataDir = seedDataDir("packrat-ui-fetchtip-");
  const { app, page, errors } = await launch(dataDir);
  try {
    await openBuilder(page);
    await page.click("#b-run");
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
    await app.close();
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});

// Issue #75: a Plan row's two names each show their own piece's tooltip; the rest of the row shows none.
test("[slow] the Plan's worn and replacement names each show their own piece's tooltip", async (t) => {
  const why = unavailable();
  if (why) return t.skip(why);
  const dataDir = seedDataDir("packrat-ui-plantip-");
  const { app, page, errors } = await launch(dataDir);
  try {
    await openBuilder(page);
    await page.click("#b-run");
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
    await page.waitForTimeout(700);
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
    await app.close();
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});

test("[slow] a Fetch list row shows its whole place, wrapped not cut, and copies the container serial", async (t) => {
  const why = unavailable();
  if (why) return t.skip(why);
  const dataDir = seedDataDir("packrat-ui-fetchplace-");
  const { app, page, errors } = await launch(dataDir);
  try {
    await openBuilder(page);
    await page.click("#b-run");
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
    await app.close();
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});

// Issue #217: a hard requirement no suit reaches (Luck 100000) is named with the best possible above the progress panel while the build runs, then in the result's "Check your settings"; Lower and Make soft edit the panel and the template badge, turn into their done state and never start a build.
test("[slow] Check your settings: the block shows before and after the build, and Lower and Make soft edit the panel", async (t) => {
  const why = unavailable();
  if (why) return t.skip(why);
  const dataDir = seedDataDir("packrat-ui-checks-");
  const { app, page, errors } = await launch(dataDir);
  try {
    await openBuilder(page);
    const luckRow = page.locator("#b-sec-req .rule-row[data-key=luck]");
    if (!(await luckRow.count())) {
      await page.click("#b-addfloor");
      await page.click(".b-pick-list button[data-key=luck]");
    }
    await luckRow.locator("input").fill("100000");
    let starts = 0;
    page.on("request", (r) => { if (r.method() === "POST" && new URL(r.url()).pathname === "/api/optimize") starts++; });
    await page.click("#b-run");
    // before the search ends: the block sits right above the progress card
    const pre = page.locator("#b-msg .b-check:has(+ .b-progress)");
    await pre.waitFor({ timeout: 15_000 });
    assert.match(await pre.innerText(), /Check your settings[\s\S]*Luck 100000 can't be reached with your inventory \(best possible: \d+\)\./);
    await built(page);
    assert.equal(await page.locator("#b-msg .b-check").count(), 0, "the pre-build block goes with the progress card");
    const block = page.locator(".b-head-card .b-check");
    const text = await block.innerText();
    const best = Number(/Luck 100000 can't be reached with your inventory \(best possible: (\d+)\)\./.exec(text)?.[1]);
    assert.ok(best > 0 && best < 100000, text);
    const lower = block.getByRole("button", { name: `Lower to ${best}` }), soft = block.getByRole("button", { name: "Make soft" });
    await lower.click();
    assert.equal(await luckRow.locator("input").inputValue(), String(best), "the panel's floor is lowered");
    assert.match(await page.locator("#b-tpl-state").innerText(), new RegExp(`Luck floor[^.]*${best}`), "the template badge names the change");
    assert.equal(await block.getByRole("button", { name: "Lowered ✓" }).isDisabled(), true);
    await soft.click();
    assert.match(await page.locator("#b-tpl-state").innerText(), /Luck floor made soft/);
    assert.equal(await block.getByRole("button", { name: "Made soft ✓" }).isDisabled(), true);
    assert.equal(await page.locator("#b-run").isDisabled(), false, "no build started");
    assert.equal(starts, 1, "only the one build that was asked for");
    assert.deepEqual(errors, []);
  } finally {
    await app.close();
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});

// Issue #217: Kestrel's Melee weights with Luck at 20. The Luck row's hint follows the typed weight and hides while the field holds no number; the build names Luck in "Check your settings" with Set Luck; a weight changed since the build leaves Set Luck doing nothing, and on a fresh build it sets the panel's weight and marks the template badge.
test("[slow] weight scale: the worth hint follows the weight, and Set weight edits the panel only while it holds the build's weight", async (t) => {
  const why = unavailable();
  if (why) return t.skip(why);
  const dataDir = seedDataDir("packrat-ui-weights-");
  const { app, page, errors } = await launch(dataDir);
  try {
    await openBuilder(page);
    await page.selectOption("#b-char", "Kestrel");
    await page.waitForFunction(() => (document.querySelector("#b-tpl") as HTMLSelectElement | null)?.value === "builtin:melee", undefined, { timeout: 10_000 });
    await page.click("#b-sec-weights .b-sec-head button");
    const luck = page.locator("#b-sec-weights .rule-row[data-key=luck]"), field = luck.locator("input");
    // read the hint inside the wait, so a repaint between the wait and a read can't race it
    const hint = (want: string | null): Promise<unknown> => page.waitForFunction((w) => {
      const e = document.querySelector("#b-sec-weights .rule-row[data-key=luck] .b-worth") as HTMLElement | null;
      return w === null ? !!e?.hidden : !!e && !e.hidden && e.textContent === w;
    }, want, { timeout: 5_000 });
    await hint("= 25 per 500 Luck");
    await field.fill("20");
    await hint("= 10,000 per 500 Luck");
    await field.fill("");
    await hint(null);
    await field.fill("20");
    await hint("= 10,000 per 500 Luck");
    await page.click("#b-run");
    await built(page);
    const block = page.locator(".b-head-card .b-check");
    const to = /Luck makes up \d+% of this suit's score: at weight 20, 500 Luck is worth as much as [\d.]+ times the median of your other weights\. Try ([\d.]+)\./.exec(await block.innerText())?.[1];
    assert.ok(to && Number(to) < 20, await block.innerText());
    const setLuck = block.getByRole("button", { name: `Set Luck to ${to}` });
    // changed since the build: the click says so, turns the button off and leaves the weight alone
    await field.fill("19");
    await setLuck.click();
    assert.equal(await field.inputValue(), "19");
    assert.equal(await setLuck.isDisabled(), true);
    await field.fill("20");
    await page.click("#b-run");
    await built(page);
    await block.getByRole("button", { name: `Set Luck to ${to}` }).click();
    assert.equal(await field.inputValue(), to, "the panel's weight is set");
    await hint(`= ${(Number(to) * 500).toLocaleString("en-US")} per 500 Luck`);
    assert.match(await page.locator("#b-tpl-state").innerText(), new RegExp(`Luck weight [\\d.]+ → ${to.replace(".", "\\.")}`), "the template badge names the change");
    assert.equal(await block.getByRole("button", { name: "Set ✓" }).isDisabled(), true);
    assert.deepEqual(errors, []);
  } finally {
    await app.close();
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});

test("[slow] STR limit sits beside Race, in view with Advanced closed, and a bad value is shown there", async (t) => {
  const why = unavailable();
  if (why) return t.skip(why);
  const dataDir = seedDataDir("packrat-ui-strlimit-");
  const { app, page, errors } = await launch(dataDir);
  try {
    await openBuilder(page);
    assert.equal(await page.locator("#b-sec-adv-body").count(), 0, "Advanced is closed");
    const str = page.getByLabel("STR limit");
    assert.equal(await str.isVisible(), true);
    assert.equal(await page.locator("#b-sec-adv #b-str").count(), 0, "not under Advanced");
    await page.click("#b-sec-adv .b-sec-head button");
    assert.equal(await page.locator("#b-sec-adv #b-str").count(), 0, "not under Advanced when it is open either");
    await page.click("#b-sec-adv .b-sec-head button");
    await str.fill("0");
    await page.click("#b-run");
    await page.waitForSelector("#b-str-err");
    assert.equal(await page.evaluate(() => document.activeElement?.id), "b-str", "Build puts focus on the bad field");
    assert.equal(await page.locator("#b-sec-adv-body").count(), 0, "and leaves Advanced closed");
    assert.deepEqual(errors, []);
  } finally {
    await app.close();
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});

// Resist cap overrides (issue #44): a Fire cap raised to 95 for a Reaper Form suit is marked in the panel, the
// result is measured against it and says so, the saved run shows it, and Save profile keeps it across a reload.
// A cap out of range stops the build with its reason under the field; the reset puts the shard's cap back.
test("[slow] a raised resist cap is marked, built with, shown in the result and the run, and saved with the profile; a buff is planned with", async (t) => {
  const why = unavailable();
  if (why) return t.skip(why);
  const dataDir = seedDataDir("packrat-ui-rescaps-");
  const { app, page, errors } = await launch(dataDir);
  try {
    await openBuilder(page);
    const fire = page.locator("#b-cap-fireResist"), fireRow = page.locator("#b-sec-caps .rule-row[data-key=fireResist]");
    await page.click("#b-sec-caps .b-sec-head button");
    assert.equal(await fire.inputValue(), "70", "the shard's cap until the player types another");
    assert.match(await fireRow.innerText(), /shard cap/);
    await fire.fill("95");
    assert.match(await fireRow.innerText(), /raised from 70/);
    assert.equal(await fireRow.getByRole("button", { name: "Reset Fire resist cap to the shard's 70" }).count(), 1);
    // A buff (issue #12): Divine Fury turned on in Automatic's picker is a chip in the Buffs section, and the build
    // plans with it: its headline says so, and "Show without buffs" redraws the totals without it.
    await page.click("#b-buff-add");
    await page.locator("#abf-cb-divineFury").check();
    await page.keyboard.press("Escape");
    assert.match(await page.locator('#b-buff-chips .token[data-buff="divineFury"]').innerText(), /Divine Fury/);

    await page.click("#b-run");
    await built(page);
    const tile = page.locator("#b-result .b-head-card .resist", { hasText: "Fire" });
    assert.match(await tile.innerText(), /\/ 95/);
    assert.match(await tile.innerText(), /Cap raised from 70/);
    assert.match(await page.locator("#b-result .b-planned").innerText(), /Planned with\s*Divine Fury/);
    await page.click("#b-buffs-shown");
    await page.waitForSelector('#b-buffs-shown[aria-pressed="true"]');
    assert.equal(await page.locator("#b-buffs-shown").innerText(), "Show without buffs", "one label, its state in aria-pressed");
    assert.equal(await page.evaluate(() => document.activeElement?.id), "b-buffs-shown", "the button keeps the focus");
    await page.click("#b-runs-open");
    await page.waitForSelector("#runs-drawer:not([hidden]) .run-card");
    assert.match(await page.locator("#b-runs .run-card").first().innerText(), /cap 95/, "the saved run names its cap");
    assert.match(await page.locator("#b-runs .run-card").first().innerText(), /with Divine Fury/, "and its buff");
    await page.keyboard.press("Escape");

    // Saved with the profile: a reload brings it back.
    await page.click("#b-save");
    await page.waitForFunction(() => /Profile for .* saved/.test(document.body.textContent || ""), undefined, { timeout: 10_000 });
    await page.reload();
    await page.waitForSelector("#tab-builder:not([hidden]) #b-sec-caps", { timeout: 30_000 });
    await page.click("#b-sec-caps .b-sec-head button");
    assert.equal(await fire.inputValue(), "95", "the profile kept the override");

    // Out of range: the build does not run, and the field says why and takes focus.
    await fire.fill("200");
    assert.equal(await page.locator("#b-cap-fireResist-err").innerText(), "Enter a whole number from 0 to 150.");
    await page.click("#b-run");
    assert.equal(await page.evaluate(() => document.activeElement?.id), "b-cap-fireResist");
    assert.equal(await page.locator("#b-run").isDisabled(), false, "no build started");

    // Reset: back to the shard's cap, no override left.
    await fire.fill("95");
    await fireRow.getByRole("button", { name: /^Reset Fire resist cap/ }).click();
    assert.equal(await fire.inputValue(), "70");
    assert.match(await page.locator("#b-sec-caps .rule-row[data-key=fireResist]").innerText(), /shard cap/);
    assert.deepEqual(errors, []);
  } finally {
    await app.close();
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});

// Review of #48: a requirement above its resist's cap warns on its row; a race change drops an override that is now
// the race's own cap, so Save does not store it; and an out-of-range cap stops Build with the section closed.
test("[slow] resist caps: a floor past its cap warns, a race change drops a now-default override, a closed section still blocks Build", async (t) => {
  const why = unavailable();
  if (why) return t.skip(why);
  const dataDir = seedDataDir("packrat-ui-rescaps2-");
  const { app, page, errors } = await launch(dataDir);
  try {
    await openBuilder(page);
    await page.click("#b-sec-caps .b-sec-head button");
    const fireReq = page.locator("#b-sec-req .rule-row[data-key=fireResist]");
    await page.fill("#b-cap-fireResist", "60");
    assert.match(await fireReq.innerText(), /Counts only up to the Fire cap, 60/);
    await page.fill("#b-cap-fireResist", "70");
    assert.doesNotMatch(await fireReq.innerText(), /Counts only up to/);
    await fireReq.locator("input[type=number]").fill("90");
    assert.match(await fireReq.innerText(), /Counts only up to the Fire cap, 70/, "and it follows the floor as it is typed");
    await fireReq.locator("input[type=number]").fill("65");

    // Human with Energy 75 (raised), then Elf: 75 is the Elf's own cap, so nothing is overridden or saved.
    await page.fill("#b-cap-energyResist", "75");
    assert.match(await page.locator("#b-sec-caps .rule-row[data-key=energyResist]").innerText(), /raised from 70/);
    await page.locator("#b-race").getByRole("radio", { name: "Elf" }).click();
    assert.match(await page.locator("#b-sec-caps .rule-row[data-key=energyResist]").innerText(), /shard cap/);
    await page.click("#b-save");
    await page.waitForFunction(() => /Profile for .* saved/.test(document.body.textContent || ""), undefined, { timeout: 10_000 });
    const saved = await page.evaluate(async () => {
      const r = await (await import("/ui/api.mjs" as string)).api("/api/profiles");
      const who = (document.querySelector("#b-char") as HTMLSelectElement).value;
      return r.profiles.characters[who].spec.intent.resistCaps;
    });
    assert.deepEqual(saved, {}, "no override stored for the Elf's own Energy cap");

    // Out of range, section closed: Build opens it on the field instead of building.
    await page.fill("#b-cap-coldResist", "200");
    await page.click("#b-sec-caps .b-sec-head button");
    assert.equal(await page.locator("#b-cap-coldResist").count(), 0, "the section is closed");
    await page.click("#b-run");
    await page.waitForSelector("#b-cap-coldResist-err");
    assert.equal(await page.evaluate(() => document.activeElement?.id), "b-cap-coldResist");
    assert.equal(await page.locator("#b-cap-coldResist").inputValue(), "200", "the typed value is kept");
    assert.equal(await page.locator("#b-run").isDisabled(), false, "no build started");
    assert.deepEqual(errors, []);
  } finally {
    await app.close();
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});

// Weapon exclusions (issue #45): checked skills in the Weapons popover say so on the chip, and Save profile keeps
// them across a reload, with the Use Best Weapon Skill check (issue #187).
test("[slow] excluded weapon skills and the Use Best Weapon Skill check show on the chip and are saved with the profile", async (t) => {
  const why = unavailable();
  if (why) return t.skip(why);
  const dataDir = seedDataDir("packrat-ui-weapons-");
  const { app, page, errors } = await launch(dataDir);
  try {
    await openBuilder(page);
    const chip = page.locator("#b-weapon");
    assert.equal(await chip.innerText(), "Weapons: any");
    await chip.click();
    for (const w of ["archery", "throwing"]) await page.locator(`.pop input[value="${w}"]`).check();
    assert.equal(await chip.innerText(), "Weapons: 2 excluded", "every melee skill allowed: no Use Best Weapon Skill suffix");
    for (const w of ["fencing", "mace fighting"]) await page.locator(`.pop input[value="${w}"]`).check();
    assert.equal(await chip.innerText(), "Weapons: Swordsmanship only, plus Use Best Weapon Skill");
    const ubws = page.locator(".pop #b-ubws");
    assert.ok(await ubws.isChecked(), "Use Best Weapon Skill is on by default");
    await ubws.uncheck();
    assert.equal(await chip.innerText(), "Weapons: Swordsmanship only");
    await page.locator('.pop input[value="swordsmanship"]').check();
    assert.ok(await ubws.isDisabled(), "every melee skill excluded: the check has nothing to swing with");
    assert.equal(await ubws.getAttribute("title"), "Use Best Weapon Skill swings with Swordsmanship, Fencing or Mace Fighting, all excluded");
    await page.locator('.pop input[value="swordsmanship"]').uncheck();
    assert.ok(await ubws.isEnabled());
    await page.keyboard.press("Escape");
    await page.click("#b-save");
    await page.waitForFunction(() => /Profile for .* saved/.test(document.body.textContent || ""), undefined, { timeout: 10_000 });
    await page.reload();
    await page.waitForSelector("#tab-builder:not([hidden]) #b-weapon", { timeout: 30_000 });
    assert.equal(await chip.innerText(), "Weapons: Swordsmanship only");
    await chip.click();
    assert.ok(!(await page.locator(".pop #b-ubws").isChecked()), "the switch saved off");
    assert.deepEqual(await page.locator(".pop .b-checks input:checked").evaluateAll((is) => is.map((i) => (i as HTMLInputElement).value)), ["archery", "fencing", "mace fighting", "throwing"]);
    assert.deepEqual(errors, []);
  } finally {
    await app.close();
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});

// A switch's off and on states read apart at a glance: the on track's fill is at least 3:1 against the off
// track's (hollow, the surface's own colour), and the knob moves from left to right.
test("[slow] a switch's on state stands apart from its off state in each theme and mode", async (t) => {
  const why = unavailable();
  if (why) return t.skip(why);
  const dataDir = seedDataDir("packrat-ui-switch-");
  const { app, page, errors } = await launch(dataDir);
  try {
    // reduced motion: a slow runner can otherwise read the track's colour half-way through its transition
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openBuilder(page);
    await page.getByRole("switch", { name: "Allow gargoyle-only gear" }).check();
    for (const theme of ["default", "britannia"]) for (const mode of ["light", "dark"]) {
      await page.evaluate(([th, md]) => { document.documentElement.dataset.theme = th!; document.documentElement.dataset.mode = md!; }, [theme, mode]);
      const got = await page.evaluate(() => {
        const rgb = (c: string): number[] => c.match(/[\d.]+/g)!.slice(0, 3).map(Number);
        const lum = (c: string): number => { const [r, g, b] = rgb(c).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!; };
        const ratio = (a: string, b: string): number => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
        const off = document.querySelector<HTMLInputElement>("#b-others")!, on = document.querySelector<HTMLInputElement>("#b-garg")!;
        const fill = (n: Element): string => getComputedStyle(n).backgroundColor;
        const knobLeft = (n: Element): number => parseFloat(getComputedStyle(n, "::after").left);
        return { fills: ratio(fill(on), fill(off)), offLeft: knobLeft(off), onLeft: knobLeft(on), checked: [off.checked, on.checked] };
      });
      assert.deepEqual(got.checked, [false, true]);
      assert.ok(got.fills >= 3, `${theme} ${mode}: on vs off track ${got.fills.toFixed(2)}:1`);
      assert.ok(got.onLeft > got.offLeft + 8, `${theme} ${mode}: the knob moves right when on`);
    }
    assert.deepEqual(errors, []);
  } finally {
    await app.close();
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});

// Manual mode (issue #12): a slot opens the picker on its pieces, a picked row fills the slot and moves the totals,
// and the picker stays on that slot with the row marked as the one in it; the undo key takes it out, redo puts it back. Esc closes it onto the slot card, and the
// suit is kept in ui-prefs.json. A buff turned on marks the totals it moves.
test("[slow] Manual mode: a picked piece fills its slot, moves the totals and leaves the picker on the slot", async (t) => {
  const why = unavailable();
  if (why) return t.skip(why);
  const dataDir = seedDataDir("packrat-ui-manual-");
  const { app, page, errors } = await launch(dataDir);
  try {
    await openBuilder(page);
    await page.click('#b-mode [data-value="manual"]');
    await page.waitForSelector("#b-manual:not([hidden]) #mb-suit .mb-slot");
    assert.equal(await page.locator("#b-panel").isVisible(), false, "the Automatic panel is out of the way");
    const ring = page.locator('.mb-slot-pick[data-slot="ring"]');
    await ring.click();
    await page.waitForSelector("#mb-picker:not([hidden]) tbody tr.item");
    assert.equal(await page.locator("#mb-picker-h").textContent(), "Ring: choose a piece");
    // Each total's tile (the five resists and the property and stat tiles), by its key: not the "N of 12" header.
    const tiles = (): Promise<Record<string, string>> => page.$$eval("#mb-totals [data-key]", (els) => Object.fromEntries(els.map((e) => [(e as HTMLElement).dataset.key!, (e as HTMLElement).innerText])));
    const totalsBefore = await tiles();
    // Picked from the keyboard, the way a player steps through pieces: the first row focused, then Enter.
    const row = page.locator("#mb-picker tbody tr.item").first();
    const name = (await row.locator("td").first().innerText()).trim();
    await row.focus();
    await page.keyboard.press("Enter");
    await page.waitForFunction((n) => document.querySelector('.mb-slot-pick[data-slot="ring"]')?.textContent?.includes(n), name);
    const totalsAfter = await tiles();
    assert.ok(Object.keys(totalsBefore).length >= 16, "every total has its tile");
    assert.ok(Object.keys(totalsAfter).some((k) => totalsAfter[k] !== totalsBefore[k]), "a total's tile moved");
    assert.equal(await page.locator("#mb-picker").isVisible(), true, "the picker stays open");
    assert.equal(await page.locator("#mb-picker-h").textContent(), "Ring: choose a piece", "on the same slot");
    assert.ok((await page.locator("#mb-status").textContent() || "").includes(`${name} is in Ring`), "the status line says where it went");
    const current = page.locator('#mb-picker tbody tr.item[aria-selected="true"]');
    await current.first().waitFor();
    assert.equal(await current.count(), 1, "one row marked as the piece in the slot");
    assert.match(await current.innerText(), /In this slot/);
    // Undo takes the pick back out of the slot, and redo puts it back (⌘Z / ⇧⌘Z on a Mac, Ctrl+Z / Ctrl+Y elsewhere).
    const mod = process.platform === "darwin" ? "Meta" : "Control";
    const ringText = (): Promise<string> => page.locator('.mb-slot-pick[data-slot="ring"]').innerText();
    await page.keyboard.press(`${mod}+z`);
    await page.waitForFunction((n) => !document.querySelector('.mb-slot-pick[data-slot="ring"]')?.textContent?.includes(n), name);
    assert.match(await ringText(), /Choosing/, "the slot is empty again");
    assert.ok((await page.locator("#mb-status").textContent() || "").startsWith("Undid: Ring → "), "the status line says what was undone");
    await page.keyboard.press(process.platform === "darwin" ? "Meta+Shift+z" : "Control+y");
    await page.waitForFunction((n) => document.querySelector('.mb-slot-pick[data-slot="ring"]')?.textContent?.includes(n), name);
    await page.keyboard.press("Escape");
    await page.waitForSelector("#mb-picker", { state: "hidden" });
    assert.equal(await page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.slot), "ring", "focus back on the slot card");
    // The suit is saved by a PUT the page does not wait on: poll the file until it holds the ring.
    type Prefs = { builderMode?: string; manualSuit?: Record<string, number>; manualBuffs?: string[] };
    const read = (): Prefs => { try { return JSON.parse(readFileSync(join(dataDir, "ui-prefs.json"), "utf8")) as Prefs; } catch { return {}; } };
    let prefs = read();
    for (let i = 0; i < 50 && typeof prefs.manualSuit?.ring !== "number"; i++) { await page.waitForTimeout(100); prefs = read(); }
    assert.equal(prefs.builderMode, "manual");
    assert.equal(typeof prefs.manualSuit?.ring, "number", "the suit is kept for the next launch");
    // A buff (app/buffs.mts): Add buff opens the buff picker in the side column, Divine Fury on puts its chip in the
    // Buffs row and a marker line under HCI, and Esc closes the picker onto Add buff.
    await page.click("#bf-add");
    await page.waitForSelector("#mb-buffs:not([hidden]) #bf-cb-divineFury");
    await page.locator("#bf-cb-divineFury").check();
    await page.waitForSelector('#mb-totals [data-key="hci"] .bf-sub');
    assert.match(await page.locator('#mb-totals [data-key="hci"] .bf-sub').innerText(), /\+1[05]/, "Divine Fury's HCI, flat or top tier");
    assert.match(await page.locator('#mb-totals .bf-strip .token[data-buff="divineFury"]').innerText(), /Divine Fury/);
    await page.keyboard.press("Escape");
    await page.waitForSelector("#mb-buffs", { state: "hidden" });
    assert.equal(await page.evaluate(() => document.activeElement?.id), "bf-add", "focus back on Add buff");
    let bp = read();
    for (let i = 0; i < 50 && !bp.manualBuffs?.includes("divineFury"); i++) { await page.waitForTimeout(100); bp = read(); }
    assert.deepEqual(bp.manualBuffs, ["divineFury"], "the buffs are kept for the next launch");
    assert.deepEqual(errors, []);
  } finally {
    await app.close();
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});

// Manual's hand-offs (issue #12): Fill the rest automatically fills the empty slots in one undo step and keeps the
// placed piece; Save as run puts the suit in the runs drawer as a manual run, which opens in the result view with
// Open in Manual; and an Automatic result's Start from this result loads it into Manual in one undo step.
test("[slow] Manual hand-offs: fill the rest, save as run, reopen it, and start from an Automatic result", async (t) => {
  const why = unavailable();
  if (why) return t.skip(why);
  const dataDir = seedDataDir("packrat-ui-handoffs-");
  const { app, page, errors } = await launch(dataDir);
  try {
    await openBuilder(page);
    await page.click('#b-mode [data-value="manual"]');
    await page.waitForSelector("#b-manual:not([hidden]) #mb-suit .mb-slot");
    // one placed piece: the first ring in the picker
    await page.click('.mb-slot-pick[data-slot="ring"]');
    const row = page.locator("#mb-picker tbody tr.item").first();
    await row.waitFor();
    const ringName = (await row.locator("td").first().innerText()).trim();
    await row.click();
    await page.waitForFunction((n) => document.querySelector('.mb-slot-pick[data-slot="ring"]')?.textContent?.includes(n), ringName);
    await page.keyboard.press("Escape");
    const filled = (): Promise<number> => page.locator("#mb-suit .mb-slot:not(.mb-empty)").count();
    assert.equal(await filled(), 1);
    // another character picked while a fill runs: the fill is canceled, and nothing lands in the shared suit
    await page.evaluate(() => {
      document.querySelector<HTMLButtonElement>("#mb-fill")!.click();
      const sel = document.querySelector<HTMLSelectElement>("#b-char")!, other = [...sel.options].find((o) => o.value && o.value !== sel.value)!;
      sel.value = other.value; sel.dispatchEvent(new Event("change"));
    });
    await page.waitForFunction(() => document.querySelector(".mb-fill")?.textContent === "Fill canceled: the character changed");
    await page.waitForTimeout(1500);
    assert.equal(await filled(), 1, "the canceled fill left the suit alone");
    await page.click("#mb-fill");
    await page.waitForFunction(() => /^(Filled|Nothing filled)/.test(document.querySelector(".mb-fill")?.textContent || ""), undefined, { timeout: 60_000 });
    assert.ok(await filled() > 1, "the search filled empty slots");
    assert.match(await page.locator('.mb-slot-pick[data-slot="ring"]').innerText(), new RegExp(ringName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), "the placed ring stays");
    assert.match(await page.locator("#mb-undo").getAttribute("aria-label") || "", /^Undo: Fill the rest: \d+ slots?/, "one undo step");
    assert.ok(await page.locator("#mb-fetch").isVisible(), "the fetch list shows the pieces to fetch");
    assert.ok(await page.locator("#mb-fetch #mb-grab-all").count(), "with its Grab all");
    // a buff on in Manual, which a result planned without buffs takes off (and undo puts back)
    await page.click("#bf-add");
    await page.locator("#bf-cb-divineFury").check();
    await page.keyboard.press("Escape");
    const fury = page.locator('#mb-totals .bf-strip .token[data-buff="divineFury"]');
    await fury.waitFor();
    // Save as run, then open it from the drawer: the result view, a manual run, with Open in Manual
    await page.click("#mb-save-run");
    await page.waitForFunction(() => Number(document.querySelector("#b-runs-count")?.textContent) >= 1);
    await page.click("#b-runs-open");
    const card = page.locator("#b-runs .run-card").first();
    assert.match(await card.innerText(), /Manual[\s\S]*Suit built by hand/);
    await card.locator(".btn-icon").click();
    await page.click('.pop-over-drawer [role="menuitem"]:has-text("Open")');
    await page.waitForFunction(() => /Manual suit for/.test(document.querySelector("#b-result h2")?.textContent || ""));
    assert.equal(await page.locator("#b-manual").isVisible(), false, "the run shows in Automatic's result view");
    assert.equal(await page.locator("#b-to-manual").innerText(), "Open in Manual");
    // an Automatic result into Manual: Build, then Start from this result, one undo step
    await page.click("#b-run");
    await built(page);
    await page.click("#b-to-manual");
    await page.waitForSelector("#b-manual:not([hidden]) #mb-suit .mb-slot");
    assert.match(await page.locator("#mb-undo").getAttribute("aria-label") || "", /^Undo: Start from the result/);
    assert.equal(await fury.count(), 0, "the result's buffs (none) replace Manual's");
    await page.click("#mb-undo");
    await fury.waitFor();
    assert.deepEqual(errors, []);
  } finally {
    await app.close();
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});
