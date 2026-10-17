// ui-builder.test.mts — [slow]: the Suit Builder's keyboard, hover and panel behavior in the real Electron window.
//
// `[slow]`: the Suit Builder's keyboard and hover behaviour in the real Electron window, on a writable `--data` directory seeded with the demo scans: Goals (issue #292): a template's ranked goals with what each counts, ↓ moving a rank and its counts, = linking a row, another spare-points choice counted as one change, How the goals went after a build, a weight edited under the fine-tune switch folding the goals until Start from goals again, no sideways scroll at 420 px, and a profile with no goals opening on its weights; the Settings drawer (issue #272): ⌘, (Ctrl+,) and its button open it with the focus on its tab, Esc closes it onto the button, ← and → move between the tabs, each showing its own controls, a bad requirement opens it on Requirements when Build is pressed, its footer counts the settings changed since the shown run (none, then one after a weight edit), and its tab is remembered across a reload; the result's What changes (issue #272): Gauges by default with one gauge per moved non-resist property and a loss muted, Table with every property and no score breakdown, the choice kept across a reload, a breakdown row opening its weight in the drawer (Esc back to the row), a buff's past-cap note kept, and no sideways page scroll at 420 px; a raised resist cap (Fire 95) marked in the Resist caps group, built with, shown on the result's Fire tile and the saved run's badge, kept by Save profile across a reload, refused out of range with the error under the field, and reset to the shard's cap; ⌘↵ (Ctrl+Enter) builds with focus on the page body and while typing in a field in the drawer, and does nothing behind the Saved runs drawer; the Fetch list's pieces show the item tooltip on hover and after Tab focus, and so do both names in a Plan row, each its own piece's (issue #75; the row itself and its Slot cell show none, a kept row's worn name still does); a Fetch list row shows a deep bag path in full (nothing cut or ellipsised) and its copy button puts the container serial on the clipboard; STR limit is beside Race under Advanced, and a bad value there opens the drawer on it; a switch's on track is at least 3:1 against its off track, with the knob moved right, in Default and Britannia, light and dark; two excluded weapon skills show on the Weapons chip and survive Save profile and a reload; Check your settings (issue #217): a hard Luck requirement no suit reaches is named with the best possible above the progress panel and in the result, and Lower and Make soft edit the panel's floor and the template badge without starting a build; a weight row's weight row shows its importance and its hover follows the typed weight (the trade-off with the top property, or that it is the top one), and Set weight (a Luck weight that swamps the rest) edits the panel and the template badge, but not once the weight was changed since the build. Swing steps (issue #217), with Kestrel's worn weapon made the pool's best: the SSI weight's switch shows the worn weapon's steps and marks the template changed; the result says SSI was scored per point with Lock Weapon (1H) and shows the swing line, Next step follows the result's swing (none before the build); Lock starts no build and the next build scores by step; the switch is kept in the saved run's settings and by Save profile across a reload. Casting school (issue #213): the Faster Casting cap and its source beside the select, raised to 4 by naming Chivalry, which marks the template changed, and on a new FC requirement row that starts at the cap. Rarity (issue #262): Lower marks the template changed and shows a help line, the result's Solver details carry the Rarity row with the rarity total, Save profile keeps it, and applying a template without one clears it. Templates (issue #212): the built-ins listed first under their own names, a built-in's badge, description, buffs and source under the picker; Apply sets Manual's buffs as one undo step that Undo takes back; the badge counts a buff changed since; Save as keeps the buffs. Manual mode (issue #12): a slot opens the picker on its pieces, a row picked with the keyboard (focus, Enter) fills the slot, moves the totals and says so in the status line, the picker stays on that slot with the picked row marked "In this slot", the undo key empties the slot again (the status line saying what was undone) and redo puts the piece back, Esc closes it with focus back on the slot card, and the mode and the suit are in `ui-prefs.json`; and the hand-offs: another character picked mid-fill cancels the fill and leaves the suit alone, Fill the rest automatically fills empty slots around a placed ring in one undo step and shows the fetch list, Save as run puts a Manual run in the drawer that opens in the result view with Open in Manual, and an Automatic result's Start from this result loads it into Manual as one undo step. No character in Automatic (issue #12): no Race row, the buff picker speaking of no character, no "_nobody" anywhere in the page text, the Caster template's requirements, a build headed "Best suit · No character" with Grab disabled and its reason while no bridge is online, and with a bridge online on Kestrel (stubbed) Grab all queueing one grab per piece and the toast naming her, a Suit totals card, its run in its own drawer, Save profile kept across a reload, Manual on its No character, and Kestrel picked back with her own panel. Only containers (issue #12): the chip lists the same containers as Skip containers, counts the one checked, the build's saved run keeps the list, Save profile keeps it across a reload, and cleared it leaves the saved profile. The drawer's extras (issue #272): a weight's notched slider steps by 5 with its field following and never resizes another row, a value past 100 tagged, ± in the warn tone; the buffs by school with the character's skill, castable ones first and the rest greyed with their need; each requirement's status from the last build; no sideways scroll at 420 px. Arriving (issue #272): the first-visit view's four template cards, summary and Build, a card applying its template and saving it as the character's settings without any card moving, a result staying put through a scans refresh and a character switch and back, a reload with nothing changed coming back to the latest run with no settings changed and staying through a scans refresh, New build, another character's run opened from the first-visit view, and a newer scan's gear-changed banner (live and after a reload) whose Build again builds the run's settings. A card asks before it replaces tuned, saved settings (Cancel leaves the saved profile on disk as it was, Replace saves the card's template), and a runs list refreshed right after a character switch still lets the first-visit view or a run come up. Goals runs (issue #302): the first-visit summary listing the goals by rank under their names with "Spare points: Luck" on its own line, the run's banner naming its goals by those names, and a run reopened after a newer scan swaps the worn weapon keeping its Swing speed line, with no sideways scroll at 420 px. What changed in the gear (issue #291): a run reopened after newer scans lists a new piece, a piece of the suit moved into another container, one now worn by Kestrel and one gone, and the Plan marks them ("Now in", "Now worn by Kestrel", "No longer in the scans" with no Grab), a later scan putting the gone piece back updating the banner and the Plan together, the mark under the name at 420 px with no sideways scroll. Build Settings (issue #320) is the shared modal drawer: a click away on the scrim closes it with the focus back on its button, and a click in a popover opened from it does not. The sentence bar (issue #321): both pickers by keyboard alone (typing filters and marks the match, ↓ ↑ and ↵ pick, Esc closes onto the button), the build's state in words (unsaved changes, then settings changed from the template, never "modified"), going back to the saved build and starting over from a built-in after a yes, and at 420 px the words gone, the pickers full width and no sideways scroll, their lists open included. What changed (issue #336): the chip beside the build picker, hidden with nothing changed, "1 unsaved" with a dot, "1 change from **Melee** template" once saved; its popover with the unsaved edits first and the changes by group, an added requirement marked, Esc back onto the chip, a row opening Build Settings on its setting, Reset asking first, and no sideways scroll at 420.
//
// Each of the older cases is maintainer feedback on the redesign (PR #43), plus the resist cap overrides (issue #44), the weapon exclusions (issue #45) and the Weapon must have chip (issue #214). Skipped when electron or playwright is absent, or under TEST_SKIP_ELECTRON.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, copyFileSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { fitWindow, noUpdateCheck, removeTempDir, pickCharacter, pickTemplate } from "./electron-window.mts";
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
// The Settings drawer (issue #272) open on one of its tabs, and closed again (the focus back on the Settings button). On the
// Goals tab, the weights the goals set are shown too (issue #292), unless `weights` is false.
async function settings(page: Page, tab: "requirements" | "weights" | "buffs" | "pool" | "advanced", { weights = true }: { weights?: boolean } = {}): Promise<void> {
  if (await page.locator("#b-drawer").isHidden()) await page.click("#b-settings");
  await page.click(`#b-tab-${tab}`);
  const fine = page.locator("#b-finetune");
  if (tab === "weights" && weights && await fine.isVisible() && !await fine.isChecked()) await fine.check();
}
async function closeSettings(page: Page): Promise<void> {
  if (await page.locator("#b-drawer").isVisible()) await page.click("#b-drawer-close");
}
// The Suit Builder with its first character's first-visit view showing, and a 2 s time budget so builds are quick.
async function openBuilder(page: Page): Promise<void> {
  await page.locator("#inv-table tbody tr.item").first().waitFor({ timeout: 30_000 });
  await page.click('[data-nav="builder"]');
  await page.waitForSelector("#tab-builder:not([hidden]) #b-start", { timeout: 10_000 });
  await settings(page, "advanced");
  await page.fill("#b-budget", "2");
  await closeSettings(page);
}
// Build: the top bar's Build, or the drawer footer's while Build Settings is open over the top bar (issue #320).
async function pressBuild(page: Page): Promise<void> { await page.click(await page.locator("#b-drawer").isVisible() ? "#b-run-foot" : "#b-run"); }
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
    await page.click("#b-start p.muted");
    assert.equal(await page.evaluate(() => document.activeElement?.tagName), "BODY");
    await page.keyboard.press("ControlOrMeta+Enter");
    await built(page);
    assert.equal(starts, 1, "one build from the page body");

    // While typing in a field in the Settings drawer.
    await settings(page, "requirements");
    await page.locator("#b-sec-req input[type=number]").first().click();
    const second = page.waitForRequest((r) => r.method() === "POST" && new URL(r.url()).pathname === "/api/optimize", { timeout: 10_000 });
    await page.keyboard.press("ControlOrMeta+Enter");
    await second;
    await built(page);
    assert.equal(starts, 2, "a second build from a requirement field");

    // Behind the Saved runs drawer the screen is inert: no build.
    await closeSettings(page);
    await page.click("#b-runs-open");
    await page.waitForSelector("#runs-drawer:not([hidden])");
    await page.keyboard.press("ControlOrMeta+Enter");
    await page.waitForTimeout(500);
    assert.equal(await page.locator("#b-run").isDisabled(), false, "no build started behind the drawer");
    assert.equal(starts, 2);
    assert.deepEqual(errors, []);
  } finally {
    await app.close();
    removeTempDir(dataDir);
  }
});

// Issue #272: the Settings drawer. ⌘, (Ctrl+,) and the Settings button open it with the focus on its tab, Esc closes it with
// the focus back on the button, ← and → move between the tabs and each shows its own controls, a bad requirement opens it
// on Requirements when Build is pressed, its footer counts the settings changed since the shown run, and its tab is
// remembered across a reload. Round 1 of review: Esc from anywhere, ⌘, over a popover, focus after a drawer build, the
// count following the runs drawer's diff and every knob, and the top bar at 1366 and 1024.
test("[slow] the Settings drawer: ⌘, and its button, Esc, the tabs, an error's tab, the changes count, the remembered tab", async (t) => {
  const why = unavailable();
  if (why) return t.skip(why);
  const dataDir = seedDataDir("packrat-ui-drawer-");
  const { app, page, errors } = await launch(dataDir);
  try {
    await openBuilder(page);   // leaves it closed, on Advanced
    const drawer = page.locator("#b-drawer"), focused = (): Promise<string | undefined> => page.evaluate(() => document.activeElement?.id);
    await page.click("#b-start p.muted");
    await page.keyboard.press("ControlOrMeta+Comma");
    await drawer.waitFor();
    assert.equal(await focused(), "b-tab-advanced", "the focus on the tab it was left on");
    assert.equal(await page.getAttribute("#b-settings", "aria-expanded"), "true");
    await page.keyboard.press("Escape");
    await drawer.waitFor({ state: "hidden" });
    assert.equal(await focused(), "b-settings", "Esc gives the focus back to the Settings button");
    await page.click("#b-settings");
    await page.click("#b-tab-requirements");
    const controls: Array<[string, string]> = [["requirements", "#b-addfloor"], ["weights", "#b-addgoal"], ["buffs", "#b-buff-add"], ["pool", "#b-weapon"], ["advanced", "#b-exact"]];
    for (const [tab, sel] of controls) {
      assert.equal(await page.getAttribute(`#b-tab-${tab}`, "aria-selected"), "true");
      assert.equal(await page.locator(sel).isVisible(), true, `${tab} shows ${sel}`);
      assert.equal(await page.locator("#b-panel-body [role=tabpanel]:not([hidden])").count(), 1, "one panel at a time");
      await page.keyboard.press("ArrowRight");
    }
    assert.equal(await focused(), "b-tab-requirements", "→ on the last tab wraps to the first");
    await page.keyboard.press("ControlOrMeta+Comma");
    await drawer.waitFor({ state: "hidden" });

    // A bad requirement with the drawer closed: Build opens it on Requirements, with the focus in the field.
    await page.click("#b-settings");
    const req = page.locator("#b-sec-req .rule-row input[type=number]").first(), was = await req.inputValue();
    await req.fill("");
    await page.click("#b-tab-pool");
    await closeSettings(page);
    await pressBuild(page);
    await drawer.waitFor();
    assert.equal(await page.getAttribute("#b-tab-requirements", "aria-selected"), "true");
    assert.equal(await page.evaluate(() => document.activeElement === document.querySelector("#b-sec-req .rule-row input[type=number]")), true, "the focus in the bad field");
    await req.fill(was);

    // The footer: no count with no run shown, none after a build, one after a weight edit.
    assert.equal(await page.locator("#b-changes").innerText(), "");
    await page.click("#b-run-foot");
    await built(page);
    assert.equal(await drawer.isVisible(), true, "the drawer stays open through a build");
    await page.waitForFunction(() => document.querySelector("#b-changes")?.textContent === "No changes since the last build", undefined, { timeout: 10_000 });
    assert.equal(await focused(), "b-run-foot", "a build from the drawer leaves the focus there");
    const count = (want: string): Promise<unknown> => page.waitForFunction((w) => document.querySelector("#b-changes")?.textContent === w, want, { timeout: 10_000 });
    await settings(page, "weights");
    const weight = page.locator("#b-sec-weights .rule-row input").first(), firstWeight = await weight.inputValue();
    await weight.fill(String(Number(firstWeight) + 5));
    await count("1 change since the last build");
    // The count is the runs drawer's diff (runSettingsDiff): the weight typed back is no change, and a search knob counts.
    await weight.fill(firstWeight);
    await count("No changes since the last build");
    await settings(page, "advanced");
    const restarts = await page.locator("#b-restarts").inputValue();
    await page.fill("#b-restarts", String(Number(restarts) + 7));
    await count("1 change since the last build");
    await page.fill("#b-restarts", restarts);
    await count("No changes since the last build");
    // Another time budget, built: whether the server answers from the earlier run or not, nothing differs from what was asked.
    await page.fill("#b-budget", "3");
    await page.click("#b-run-foot");
    await page.waitForFunction(() => !document.querySelector<HTMLButtonElement>("#b-run")?.disabled && !document.querySelector("#b-msg .b-progress"), undefined, { timeout: 60_000 });
    await count("No changes since the last build");
    // That run reopened from Saved runs is no longer the build just shown: the footer counts what the run's banner names,
    // and Load these settings leaves nothing.
    await closeSettings(page);
    await page.click("#b-runs-open");
    await page.locator("#b-runs .run-card.showing button[aria-haspopup=menu]").click();
    await page.click('.pop-over-drawer [role="menuitem"]:has-text("Open")');
    const banner = await (await page.waitForFunction(() => document.querySelector("#b-run-banner .saved-run")?.textContent || null, undefined, { timeout: 10_000 })).jsonValue();
    const named = /this run: (.*?)Load these settings/.exec(String(banner))?.[1]?.split(" · ").length ?? 0;
    await count(named ? `${named} change${named === 1 ? "" : "s"} since the last build` : "No changes since the last build");
    await closeSettings(page);   // the banner's button may sit under the drawer
    await page.locator("#b-run-banner .saved-run").getByRole("button", { name: "Load these settings" }).click();
    await count("No changes since the last build");

    // Esc closes it after a click on the drawer's blank space (the focus fallen to <body>).
    await settings(page, "advanced");
    await page.click("#b-sec-adv-h");
    await page.keyboard.press("Escape");
    await drawer.waitFor({ state: "hidden" });
    assert.equal(await focused(), "b-settings");
    // It is modal, as Saved runs is (issue #320): a click away, on the scrim over the result, closes it, the focus back
    // on the button.
    await page.click("#b-settings");
    await page.mouse.click(20, 450);
    await drawer.waitFor({ state: "hidden" });
    assert.equal(await focused(), "b-settings", "a click away gives the focus back to the button");
    // A popover opened from it sits above the scrim: a click in it leaves the drawer open. ⌘, with the popover open
    // closes both, the focus back on Build Settings.
    await settings(page, "requirements");
    await page.click("#b-addfloor");
    await page.waitForSelector(".pop .b-pick-list");
    const pop = (await page.locator(".pop").boundingBox())!;
    await page.mouse.click(pop.x + 8, pop.y + 8);   // its padding, not an option
    assert.equal(await page.locator(".pop").count(), 1, "the popover stays");
    assert.equal(await drawer.isVisible(), true, "a click in the popover is no click away");
    await page.keyboard.press("ControlOrMeta+Comma");
    await drawer.waitFor({ state: "hidden" });
    assert.equal(await page.locator(".pop").count(), 0, "the popover closed with it");
    assert.equal(await focused(), "b-settings");
    await settings(page, "weights");

    // The tab is kept in ui-prefs (a PUT the page does not wait on: poll the file), and the drawer comes back on it.
    const tabSaved = (): boolean => { try { return (JSON.parse(readFileSync(join(dataDir, "ui-prefs.json"), "utf8")) as { builderTab?: string }).builderTab === "weights"; } catch { return false; } };
    for (let i = 0; i < 50 && !tabSaved(); i++) await page.waitForTimeout(100);
    assert.ok(tabSaved(), "the tab is in ui-prefs.json");
    await page.reload();
    await page.waitForSelector("#tab-builder:not([hidden]) #b-result .b-head-card", { timeout: 30_000 });   // coming back: the latest run
    assert.equal(await drawer.isHidden(), true, "closed after a reload");
    await page.click("#b-settings");
    assert.equal(await page.getAttribute("#b-tab-weights", "aria-selected"), "true", "open on the tab it was left on");

    // The sentence bar (issue #321): one line at 1366 (where the screen allows that width), Saved runs on the quieter row
    // under it; at 1024 the pickers wrap and Build Settings and Build stay one group at the right of its row.
    const top = (sel: string): Promise<number> => page.locator(sel).evaluate((n) => Math.round(n.getBoundingClientRect().top));
    if ((await fitWindow(app, page, { width: 1366, height: 900 })).width === 1366) {
      assert.equal(await top("#b-run"), await top("#b-char"), "one line at 1366");
      assert.equal(await top("#b-tpl"), await top("#b-char"));
    }
    assert.ok(await top("#b-runs-open") > await top("#b-run"), "Saved runs on the second row");
    await fitWindow(app, page, { width: 1024, height: 768 });
    assert.equal(await top("#b-settings"), await top("#b-run"));
    const bar = (await page.locator("#b-topbar").boundingBox())!, run = (await page.locator("#b-run").boundingBox())!;
    assert.ok(bar.x + bar.width - (run.x + run.width) < 40, "Build at the bar's right end");
    assert.ok(bar.height < 170, `the pickers wrap once at most, got ${bar.height}`);
    assert.deepEqual(errors, []);
  } finally {
    await app.close();
    removeTempDir(dataDir);
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

test("[slow] the Fetch list's pieces show the item tooltip on hover and on keyboard focus", async (t) => {
  const why = unavailable();
  if (why) return t.skip(why);
  const dataDir = seedDataDir("packrat-ui-fetchtip-");
  const { app, page, errors } = await launch(dataDir);
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
    await app.close();
    removeTempDir(dataDir);
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
    removeTempDir(dataDir);
  }
});

test("[slow] a Fetch list row shows its whole place, wrapped not cut, and copies the container serial", async (t) => {
  const why = unavailable();
  if (why) return t.skip(why);
  const dataDir = seedDataDir("packrat-ui-fetchplace-");
  const { app, page, errors } = await launch(dataDir);
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
    await app.close();
    removeTempDir(dataDir);
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
    await settings(page, "requirements");
    const luckRow = page.locator("#b-sec-req .rule-row[data-key=luck]");
    if (!(await luckRow.count())) {
      await page.click("#b-addfloor");
      await page.click(".b-pick-list button[data-key=luck]");
    }
    await luckRow.locator("input").fill("100000");
    let starts = 0;
    page.on("request", (r) => { if (r.method() === "POST" && new URL(r.url()).pathname === "/api/optimize") starts++; });
    await page.click("#b-run-foot");
    // before the search ends: the block sits right above the progress card
    // read in the same poll that finds it, so a quick build can't replace it between the wait and the read
    const preText = await (await page.waitForFunction(() => document.querySelector("#b-msg .b-check:has(+ .b-progress)")?.textContent || null, undefined, { timeout: 15_000 })).jsonValue();
    assert.match(String(preText), /Check your settings[\s\S]*Luck 100000 can't be reached with your inventory \(best possible: \d+\)\./);
    await built(page);
    assert.equal(await page.locator("#b-msg .b-check").count(), 0, "the pre-build block goes with the progress card");
    await closeSettings(page);   // the drawer stays open through a build; closed, the whole result is in reach
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
    removeTempDir(dataDir);
  }
});

// Issue #292: the Goals tab. Dorran's Melee opens on its goals (Swing speed, then Hit chance = Defense chance, then Damage,
// spare points to Luck) with what each rank counts and Swing speed's SSI need; ↓ on Swing speed moves it under the linked
// pair (whose arrows name both) and the counts follow;
// "=" links Damage to the rank above; another spare-points choice is one change since the build; a build shows "How the
// goals went" beside the result, its swing in seconds and per point said there rather than as a warning, and spare points
// never a loss "went to"; a weight edited under "Show the weights these goals set" folds the goals into "Using your own
// weights" and "Start from goals again" brings them back with nothing changed; Load these settings brings a run's goals
// back; at 420 px the page never scrolls sideways. Kestrel's saved profile, written with weights and no goals, opens on
// its weights as before goals, and its run loaded over Melee's goals leaves goal mode.
test("[slow] goals: the ranked list, its counts, =, spare points, How the goals went, fine-tune and back, a profile with no goals", async (t) => {
  const why = unavailable();
  if (why) return t.skip(why);
  const dataDir = seedDataDir("packrat-ui-goals-");
  const pool = { lockedSlots: [], excludeTags: [], excludeSkills: [], excludeRoots: [], excludeWeapons: [], ubwsAnyWeapon: true, allowOthersWorn: false, allowGargoyle: false, medOnly: false, strLimit: "character" };
  writeFileSync(join(dataDir, "profiles.json"), JSON.stringify({ schemaVersion: 3, templates: {}, characters: { Kestrel: { race: "human", template: "builtin:melee",
    spec: { intent: { floors: {}, softFloors: [], weights: { dci: 10, luck: 1 }, floorBonus: 1000, resistCaps: {} }, buffs: { on: [], skills: {} }, pool } } } }));
  const { app, page, errors } = await launch(dataDir);
  try {
    await openBuilder(page);
    await pickCharacter(page, "Dorran");
    await page.waitForFunction(() => document.querySelector("#b-start h2")?.textContent === "What should Dorran's suit be for?", undefined, { timeout: 10_000 });
    await settings(page, "weights", { weights: false });
    await page.waitForSelector("#b-goals-h");
    assert.equal(await page.locator("#b-goals-h").innerText(), "What should this suit be best at?");
    const rows = (): Promise<string[]> => page.locator("#b-sec-goals .b-goal").evaluateAll((ls) => ls.map((l) => `${l.querySelector(".b-goal-name")!.textContent} ${l.querySelector(".b-goal-counts")!.textContent}`));
    assert.deepEqual(await rows(), ["1.Swing speed counts 100 · needs SSI 17", "2.Hit chance counts 80 · max 45", "2.Defense chance counts 80 · max 45", "3.Damage counts 65 · max 100"]);
    assert.equal(await page.locator("#b-sec-weights").isHidden(), true, "the weights stay out of sight");
    // ↓ moves Swing speed's rank under the linked pair, and the focus stays on the row's arrows
    await page.getByRole("button", { name: "Move Swing speed down", exact: true }).click();
    assert.deepEqual(await rows(), ["1.Hit chance counts 100 · max 45", "1.Defense chance counts 100 · max 45", "2.Swing speed counts 80 · needs SSI 17", "3.Damage counts 65 · max 100"]);
    assert.equal(await page.evaluate(() => document.activeElement?.closest(".b-goal")?.getAttribute("data-key")), "ssi");
    assert.equal(await page.getByRole("button", { name: "Move Hit chance and Defense chance down" }).count(), 2, "a linked rank's arrows name both, on both rows");
    await page.getByRole("button", { name: "Move Swing speed up", exact: true }).click();
    // "=" links Damage to the rank above
    const link = page.locator('.b-goal[data-key="di"] .pill');
    assert.equal(await link.getAttribute("aria-pressed"), "false");
    await link.click();
    assert.deepEqual(await rows(), ["1.Swing speed counts 100 · needs SSI 17", "2.Hit chance counts 80 · max 45", "2.Defense chance counts 80 · max 45", "2.Damage counts 80 · max 100"]);
    assert.equal(await page.locator('.b-goal[data-key="di"] .pill').getAttribute("aria-pressed"), "true");
    await page.locator('.b-goal[data-key="di"] .pill').click();
    assert.match(await page.locator("#b-tpl-state").innerText(), /equal the Melee template/, "back as the template had it");

    // a build, then another spare-points choice is one change
    await page.click("#b-run-foot");
    await built(page);
    const count = (want: string): Promise<unknown> => page.waitForFunction((w) => document.querySelector("#b-changes")?.textContent === w, want, { timeout: 10_000 });
    await count("No changes since the last build");
    const went = await page.locator("#b-goals-went").innerText();
    assert.match(went, /^How the goals went\n1\.\s*Swing speed\n[\d.]+ s with .+ · SSI \d+[\s\S]*3\.\s*Damage[\s\S]*Spare points(: none left over| went to: )/);
    assert.doesNotMatch(went, /as high as the gear allows|went to: \S+ −/, "no unproven verdict, and no loss as a destination");
    // built from goals, SSI counted per point is a note under the swing goal, not a warning in Check your settings
    assert.doesNotMatch(await page.locator(".b-head-card").innerText(), /SSI was scored per point/);
    assert.match(went, /Swing time isn't counted in steps here, because the suit isn't tied to one weapon\./);
    await page.click('#b-leftover [data-value="melee"]');
    await count("1 change since the last build");
    await page.click('#b-leftover [data-value="luck"]');
    await count("No changes since the last build");

    // fine-tune: a weight edited leaves goal mode; Start from goals again brings the goals back
    await page.locator("#b-finetune").check();
    const luck = page.locator('#b-sec-weights .rule-row[data-key="luck"] input[type=range]');
    await luck.focus();
    await page.keyboard.press("ArrowRight");
    await page.waitForSelector("#b-goals-again");
    assert.match(await page.locator("#b-sec-goals").innerText(), /^Using your own weights\.\s*Start from goals again$/);
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("type")), "range", "the slider keeps the focus");
    await count("1 change since the last build");
    await page.click("#b-goals-again");
    await page.waitForSelector("#b-goals-h");
    await count("No changes since the last build");

    // the run's Load these settings brings its goals back
    await page.getByRole("button", { name: "Move Swing speed down", exact: true }).click();
    await count("1 change since the last build");
    const loadRun = async (): Promise<void> => {
      await closeSettings(page);
      await page.click("#b-runs-open");
      await page.locator("#b-runs .run-card button[aria-haspopup=menu]").first().click();
      await page.click('.pop-over-drawer [role="menuitem"]:has-text("Open")');
      await page.waitForSelector("#b-run-banner .saved-run, #b-run-banner .b-gear-changed", { timeout: 10_000 });
      await closeSettings(page);
      await page.locator("#b-run-banner").getByRole("button", { name: "Load these settings" }).click();
    };
    await loadRun();
    await settings(page, "weights", { weights: false });
    assert.deepEqual(await rows(), ["1.Swing speed counts 100 · needs SSI 17", "2.Hit chance counts 80 · max 45", "2.Defense chance counts 80 · max 45", "3.Damage counts 65 · max 100"], "the run's goals are back");
    await count("No changes since the last build");

    // at phone width the drawer fits without a sideways scroll
    await fitWindow(app, page, { width: 420, height: 900 });
    const widths = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth, document.querySelector("#b-drawer .b-drawer-body")!.scrollWidth, document.querySelector("#b-drawer .b-drawer-body")!.clientWidth]);
    assert.ok(widths[0]! <= widths[1]! && widths[2]! <= widths[3]!, `no sideways scroll: ${widths.join(", ")}`);
    await fitWindow(app, page, { width: 1440, height: 900 });

    // a profile saved with weights and no goals opens on its weights; a run built from it, loaded over goals, leaves goal mode
    await closeSettings(page);
    await pickCharacter(page, "Kestrel");
    await settings(page, "weights", { weights: false });
    await page.waitForSelector('#b-sec-weights .rule-row[data-key="dci"]');
    assert.equal(await page.locator("#b-sec-goals").isHidden(), true);
    assert.equal(await page.locator("#b-sec-weights").isVisible(), true);
    await page.click("#b-run-foot");
    await page.waitForFunction(() => !document.querySelector<HTMLButtonElement>("#b-run")?.disabled && /Best suit for Kestrel/.test(document.querySelector("#b-result h2")?.textContent || ""), undefined, { timeout: 60_000 });
    await closeSettings(page);
    await pickTemplate(page, "builtin:melee");
    await page.waitForSelector("#b-goals-h", { state: "attached" });
    await loadRun();
    await settings(page, "weights", { weights: false });
    await page.waitForSelector('#b-sec-weights .rule-row[data-key="dci"]');
    assert.equal(await page.locator("#b-sec-goals").isHidden(), true, "the run had no goals: the panel's weights are its own");
    assert.deepEqual(errors, []);
  } finally {
    await app.close();
    removeTempDir(dataDir);
  }
});

// Issue #292 part 2, on the first character with Melee's goals: the strategy choice switches the Goals tab's subtitle, and in Strict
// order a goal row shows only its cap; a strict build's How the goals went says it made no trades and Solver details name
// the strategy; the fewest-changes checkbox and the strategy are saved with the profile across a reload; no sideways
// scroll at 420 px.
test("[slow] strict order: the strategy's subtitle, a strict build without trades, and fewest changes saved with the profile", async (t) => {
  const why = unavailable();
  if (why) return t.skip(why);
  const dataDir = seedDataDir("packrat-ui-strict-");
  const { app, page, errors } = await launch(dataDir);
  const text = (sel: string, re: RegExp): Promise<unknown> => page.waitForFunction(([q, src]) => new RegExp(src!).test(document.querySelector(q!)?.textContent || ""), [sel, re.source], { timeout: 10_000 });
  const noSideways = async (what: string): Promise<void> => {
    await fitWindow(app, page, { width: 420, height: 900 });
    const w = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
    assert.ok(w[0]! <= w[1]!, `${what}: no sideways scroll at 420 (${w.join(", ")})`);
    await fitWindow(app, page, { width: 1440, height: 900 });
  };
  try {
    await openBuilder(page);
    await settings(page, "weights", { weights: false });
    await page.waitForSelector("#b-strategy");
    assert.equal(await page.locator('#b-strategy [data-value="value"]').getAttribute("aria-checked"), "true", "Best value by default");
    assert.equal(await page.locator("#b-strategy-help").innerText(), "Most important first. Higher goals count more, but a small loss up top can buy a big gain lower down.");
    assert.match(await page.locator('.b-goal[data-key="hci"] .b-goal-counts').innerText(), /^counts 80 · max 45$/);
    await page.click('#b-strategy [data-value="strict"]');
    await text("#b-strategy-help", /^Most important first\. A higher goal is never given up for a lower one\. Requirements come before every goal\.$/);
    assert.equal(await page.locator('.b-goal[data-key="hci"] .b-goal-counts').innerText(), "max 45", "what a goal counts is Best value's");
    await text("#b-tpl-state", /strict order/);
    await noSideways("the Goals tab");

    // a strict build: no trades in How the goals went, the strategy in Solver details
    await page.click("#b-run-foot");
    await built(page);
    await closeSettings(page);
    const went = await page.locator("#b-goals-went").innerText();
    assert.match(went, /Strict order: no trades\. A higher goal is never given up for a lower one\./);
    assert.doesNotMatch(went, /Trade made/);
    await page.click("#b-result .b-disclose");
    await text("#b-details", /Strategy\s*Strict order: /);
    await noSideways("the result");

    // fewest changes, saved with the strategy
    await settings(page, "weights", { weights: false });
    assert.equal(await page.locator("#b-fewest").isChecked(), false);
    await page.locator("#b-fewest").check();
    await text("#b-tpl-state", /fewest changes/);
    await page.click("#b-save");
    await page.waitForFunction(() => /Profile for .* saved/.test(document.body.textContent || ""), undefined, { timeout: 10_000 });
    await page.reload();
    await page.waitForSelector("body:has(#tab-builder:not([hidden])) #b-fewest", { state: "attached", timeout: 30_000 });
    await settings(page, "weights", { weights: false });
    assert.equal(await page.locator("#b-fewest").isChecked(), true, "fewest changes is saved with the profile");
    assert.equal(await page.locator('#b-strategy [data-value="strict"]').getAttribute("aria-checked"), "true", "so is the strategy");
    assert.deepEqual(errors, []);
  } finally {
    await app.close();
    removeTempDir(dataDir);
  }
});

// Issue #302, on Dorran with Melee's goals: the first-visit "What matters most" lists the goals by rank under their names
// with the spare points on their own line (and fits at 420 px); a build with a swing time, then a goals change, and the run's
// banner names the run's goals by their names; a newer scan that swaps the worn weapon for a slower one under another name,
// and the reopened run's Swing speed line is the one the build showed, set for the weapon it was built with.
test("[slow] goals runs: the first-visit goals, the run line in goal names, and a reopened run keeping its swing goal's weapon", async (t) => {
  const why = unavailable();
  if (why) return t.skip(why);
  const dataDir = seedDataDir("packrat-ui-goalruns-");
  const { app, page, errors } = await launch(dataDir);
  try {
    await openBuilder(page);
    await page.waitForFunction(() => /Melee will build for/.test(document.querySelector("#b-start .b-start-sum")?.textContent || ""), undefined, { timeout: 10_000 });
    const most = await page.locator("#b-start .b-start-sum .b-imps").innerText();
    assert.match(most, /^1\. Swing speed\s+100\s+2\. Hit chance = Defense chance\s+80\s+3\. Damage\s+65$/);
    const sum = await page.locator("#b-start .b-start-sum").innerText();
    assert.match(sum, /Spare points: Luck\s+Goals in Build Settings/);
    assert.doesNotMatch(sum, /more in Build Settings/, "the spare points are no extra row");
    await fitWindow(app, page, { width: 420, height: 900 });
    const fits = await page.waitForFunction(() => document.documentElement.scrollWidth - document.documentElement.clientWidth <= 0, undefined, { timeout: 5_000 }).then(() => true, () => false);
    assert.ok(fits, "no sideways scroll at 420 on the first-visit view");
    await fitWindow(app, page, { width: 1440, height: 900 });

    // a swing time: the worn weapon's fastest step
    await settings(page, "weights", { weights: false });
    const fastest = await page.locator("#b-swing-goal option").last().getAttribute("value");
    await page.selectOption("#b-swing-goal", fastest!);
    await page.click("#b-run-foot");
    await built(page);
    await closeSettings(page);
    const swingRow = (): Promise<string> => page.locator("#b-goals-went .b-went > li").first().innerText();
    const before = await swingRow();
    assert.match(before, /^1\.\s*Swing speed\n/);

    // a goals change since: the run's banner names the run's goals by their names
    await settings(page, "weights", { weights: false });
    await page.getByRole("button", { name: "Move Swing speed down", exact: true }).click();
    await closeSettings(page);
    // the worn Double Bladed Staff, a newer scan later, is a slower weapon under another name
    const scan = readFileSync(join(ROOT, "app", "fixtures", "demo-Dorran.json"), "utf8"), now = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 19);
    assert.ok(scan.includes('"scannedAt": "2026-01-01T12:00:00"') && scan.includes('"Weapon Speed 2.25s"'));
    writeFileSync(join(dataDir, "scans", "demo-Dorran-newer.json"), scan.replace('"scannedAt": "2026-01-01T12:00:00"', `"scannedAt": "${now}"`).replaceAll("Double Bladed Staff", "Practice Staff").replace('"Weapon Speed 2.25s"', '"Weapon Speed 4s"'));
    await page.evaluate(async (url) => { await (await import(url)).reload(); }, "/ui/inventory-data.mjs");
    await page.click("#b-runs-open");
    await page.locator("#b-runs .run-card button[aria-haspopup=menu]").first().click();
    await page.click('.pop-over-drawer [role="menuitem"]:has-text("Open")');
    await page.waitForFunction(() => /Your gear changed since/.test(document.querySelector("#b-run-banner")?.textContent || ""), undefined, { timeout: 10_000 });
    await closeSettings(page);
    const banner = await page.locator("#b-run-banner").innerText();
    assert.match(banner, /goals: Swing speed every [\d.]+ s › Hit chance = Defense chance › Damage, spare points to luck/);
    assert.doesNotMatch(banner, /SSI|HCI|DCI/, "goal names, not abbreviations");
    assert.equal(await swingRow(), before, "the reopened run's Swing speed line is the build's");
    assert.doesNotMatch(await page.locator("#b-goals-went").innerText(), /Practice Staff/, "not the weapon worn now");
    await fitWindow(app, page, { width: 420, height: 900 });
    const fitsRun = await page.waitForFunction(() => document.documentElement.scrollWidth - document.documentElement.clientWidth <= 0, undefined, { timeout: 5_000 }).then(() => true, () => false);
    assert.ok(fitsRun, "no sideways scroll at 420 on the reopened run");
    assert.deepEqual(errors, []);
  } finally {
    await app.close();
    removeTempDir(dataDir);
  }
});

// Issues #217, #274: Kestrel's Melee weights with Luck at importance 2000, from a profile saved with Melee's weights before goals (issue #292: its goals' few weights leave the demo suit thin, so nothing would dominate). The Luck row shows the template's per-point 0.05 as importance 5.6, and its hover names the trade-off with the top weight until Luck becomes the top one; the build names Luck in "Check your settings" with Set Luck; a weight changed since the build leaves Set Luck doing nothing, and on a fresh build it sets the panel's weight and marks the template badge.
test("[slow] weight scale: the row shows importance with a trade-off hover, and Set weight edits the panel only while it holds the build's weight", async (t) => {
  const why = unavailable();
  if (why) return t.skip(why);
  const dataDir = seedDataDir("packrat-ui-weights-");
  const pool = { lockedSlots: [], excludeTags: [], excludeSkills: [], excludeRoots: [], excludeWeapons: [], ubwsAnyWeapon: true, allowOthersWorn: false, allowGargoyle: false, medOnly: false, strLimit: "character" };
  const resists = (n: number): Record<string, number> => ({ physResist: n, fireResist: n, coldResist: n, poisonResist: n, energyResist: n });
  const weights = { ...resists(6), dci: 10, hci: 10, ssi: 5, di: 3, hpRegen: 4, dexBonus: 4, strBonus: 3, hpi: 3, stamRegen: 3, stamInc: 2, lmc: 1, luck: 0.05, tagPenalty: -25 };
  writeFileSync(join(dataDir, "profiles.json"), JSON.stringify({ schemaVersion: 3, templates: {}, characters: { Kestrel: { race: "human", template: "builtin:melee",
    spec: { intent: { floors: resists(65), softFloors: [], weights, floorBonus: 1000, resistCaps: {} }, buffs: { on: [], skills: {} }, pool } } } }));
  const { app, page, errors } = await launch(dataDir);
  try {
    await openBuilder(page);
    await pickCharacter(page, "Kestrel");
    await page.waitForFunction(() => document.querySelector("#b-tpl")?.getAttribute("data-value") === "builtin:melee", undefined, { timeout: 10_000 });
    await settings(page, "weights");
    const luck = page.locator("#b-sec-weights .rule-row[data-key=luck]"), field = luck.locator("input[type=number]");
    // read the hover's text (the row's accessible description) inside the wait, so a repaint between the wait and a read can't race it
    const hover = (want: string): Promise<unknown> => page.waitForFunction((w) => {
      const i = document.querySelector("#b-sec-weights .rule-row[data-key=luck] input");
      const e = document.getElementById(i?.getAttribute("aria-describedby")?.split(" ")[0] ?? "");
      return !!e && new RegExp(w).test(e.textContent ?? "");
    }, want, { timeout: 5_000 });
    assert.equal(await field.inputValue(), "5.56", "the importance as stored, to two decimals");
    await hover("^At these settings, 1 (Defense chance|Hit chance) is worth about 200 Luck\\.$");
    await field.fill("2000");
    await hover("^Luck has the highest weight: the other weights are compared with it\\.$");
    await field.fill("");
    await hover("^Luck has the highest weight");
    await field.fill("2000");
    await page.click("#b-run-foot");
    await built(page);
    const block = page.locator(".b-head-card .b-check");
    const to = /Luck makes up \d+% of this suit's score: at weight 2000, it counts [\d.]+ times the median of your other weights\. Try ([\d.]+)\./.exec(await block.innerText())?.[1];
    assert.ok(to && Number(to) < 2000, await block.innerText());
    const setLuck = block.getByRole("button", { name: `Set Luck to ${to}` });
    // changed since the build: the click says so, turns the button off and leaves the weight alone
    await field.fill("1900");
    await closeSettings(page);
    await setLuck.click();
    assert.equal(await field.inputValue(), "1900");
    assert.equal(await setLuck.isDisabled(), true);
    await settings(page, "weights");
    await field.fill("2000");
    await page.click("#b-run-foot");
    await built(page);
    await closeSettings(page);
    await block.getByRole("button", { name: `Set Luck to ${to}` }).click();
    assert.equal(await field.inputValue(), to, "the panel's weight is set");
    await hover("^At these settings, 1 (Defense chance|Hit chance) is worth about \\d+ Luck\\.$");
    assert.match(await page.locator("#b-tpl-state").innerText(), new RegExp(`Luck weight [\\d.]+ → ${to.replace(".", "\\.")}`), "the template badge names the change");
    assert.equal(await block.getByRole("button", { name: "Set ✓" }).isDisabled(), true);
    assert.deepEqual(errors, []);
  } finally {
    await app.close();
    removeTempDir(dataDir);
  }
});

// Issue #272 part 2, on Kestrel's melee build (the best suit gives up some of what she wears): What changes shows Gauges by default, only for moved non-resist properties the build weights or requires (no pool beside its bonus), a loss muted, and "+N more changes in Table" counting the rest and switching to it; Table lists every property, resists included, and hides the score breakdown; the choice is kept in ui-prefs across a reload; a breakdown row opens the drawer on Weights with that weight's field focused, or Add weight once the weight is gone, and Esc hands the focus back to the row; with Enemy of One planned, its past-cap amount shows under What changes and after the DI cap in the Table; at 420 px the page never scrolls sideways (the table scrolls in its own labelled box, its Property column staying put).
test("[slow] What changes: Gauges for what the build asks, Table with every property, the choice kept, breakdown rows open their weight, past-cap notes, no sideways scroll at 420", async (t) => {
  const why = unavailable();
  if (why) return t.skip(why);
  const dataDir = seedDataDir("packrat-ui-changes-");
  const { app, page, errors } = await launch(dataDir);
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
    for (let i = 0; i < 50 && !saved(); i++) await page.waitForTimeout(100);
    assert.ok(saved(), "the choice is in ui-prefs.json");

    // At phone width the page doesn't scroll sideways; the table scrolls inside its box.
    await fitWindow(app, page, { width: 420, height: 900 });
    // the resized window's layout settles over a frame or two (the header's pickers reflow): measure once it has
    await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth, undefined, { timeout: 5_000 }).catch(() => {});
    const widths = await page.evaluate(() => { const r = document.querySelector(".b-results")!, b = document.querySelector(".b-chg-scroll")!; return [document.documentElement.scrollWidth, innerWidth, r.scrollWidth, r.clientWidth, b.scrollWidth, b.clientWidth]; });
    assert.ok(widths[0]! <= widths[1]! && widths[2]! <= widths[3]!, `no sideways page scroll: ${widths.join(", ")}`);
    assert.ok(widths[4]! > widths[5]!, "the table scrolls in its own box");
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
    await app.close();
    removeTempDir(dataDir);
  }
});

// Issue #272 part 3, the Settings drawer's extras on Kestrel given Chivalry 68.2 and Bushido 74 in her scan: a weight's slider moves in steps of 5 from the arrow keys with the number field following and its aria-valuetext the signed weight, the trade-off under the list following it, and another row's bar staying as it was; a typed 178 fills the bar and tags it "▸178", a typed 12.5 is kept; ± flips the sign and the bar takes the warn style. Buffs are listed by school with Kestrel's skill, only the castable ones until Show all, which adds Necromancy's forms greyed with what they need. After a build each requirement says what it came to. At 420 px the drawer never scrolls the page sideways.
test("[slow] drawer extras: notched weight sliders, buffs by school, each requirement's last-build status, no sideways scroll at 420", async (t) => {
  const why = unavailable();
  if (why) return t.skip(why);
  const dataDir = seedDataDir("packrat-ui-extras-");
  const scan = join(dataDir, "scans", "demo-Kestrel.json"), raw = readFileSync(scan, "utf8");
  assert.ok(raw.includes('"skills": {},'));
  writeFileSync(scan, raw.replace('"skills": {},', '"skills": { "Chivalry": { "base": 68.2, "value": 68.2, "cap": 100 }, "Bushido": { "base": 74, "value": 74, "cap": 100 }, "Necromancy": { "base": 50, "value": 50, "cap": 100 } },'));
  const { app, page, errors } = await launch(dataDir);
  try {
    await openBuilder(page);
    await pickCharacter(page, "Kestrel");
    await page.waitForFunction(() => document.querySelector("#b-tpl")?.getAttribute("data-value") === "builtin:melee", undefined, { timeout: 10_000 });
    await settings(page, "weights");
    const rows = page.locator("#b-sec-weights .rule-row.weight"), row = (i: number): { num: Locator; slider: Locator } => ({ num: rows.nth(i).locator("input[type=number]"), slider: rows.nth(i).locator("input[type=range]") });
    const fill = (l: Locator): Promise<string> => l.evaluate((x) => (x as HTMLElement).style.getPropertyValue("--fill"));
    const other = await fill(row(1).slider);
    await row(0).slider.focus();
    await page.keyboard.press("ArrowLeft");
    const v1 = Number(await row(0).num.inputValue());
    assert.equal(v1 % 5, 0, "the arrow key steps by 5");
    assert.equal(await row(0).slider.inputValue(), String(v1));
    await page.keyboard.press("ArrowLeft");
    assert.equal(Number(await row(0).num.inputValue()), v1 - 5, "and the number field follows");
    assert.equal(await row(0).slider.getAttribute("aria-valuetext"), String(v1 - 5));
    assert.equal(await fill(row(1).slider), other, "another row's bar keeps its size");
    assert.match(await page.locator("#b-wreadout").innerText(), /^At these settings|has the highest weight/);
    // the trade-off tooltip on screen follows the slider as it moves
    await row(1).slider.focus();
    for (let i = 0; i < 14; i++) await page.keyboard.press("ArrowLeft");
    assert.equal(await page.locator(".tip").last().innerText(), await page.locator("#b-wreadout").innerText());
    await row(2).num.fill("178");
    assert.equal(await rows.nth(2).locator(".b-wover").innerText(), "▸178");
    assert.equal(await fill(row(2).slider), "100%");
    // past 100 → leaves the typed value alone; ← takes it to the full bar's 100
    await row(2).slider.focus();
    await page.keyboard.press("ArrowRight");
    assert.equal(await row(2).num.inputValue(), "178");
    assert.equal(await rows.nth(2).locator(".b-wover").innerText(), "▸178");
    await page.keyboard.press("ArrowLeft");
    assert.equal(await row(2).num.inputValue(), "100");
    await row(2).num.fill("12.5");
    assert.equal(await row(2).num.inputValue(), "12.5");
    assert.equal(await fill(row(2).slider), "12.5%");
    // the handle sits at 12.5 and says so; the arrows go to the next notch that way (→ 15, 20; ← 15, 10)
    assert.equal(await row(2).slider.inputValue(), "12.5");
    assert.equal(await row(2).slider.getAttribute("aria-valuetext"), "12.5");
    await row(2).slider.focus();
    for (const [key, want] of [["ArrowRight", "15"], ["ArrowRight", "20"], ["ArrowLeft", "15"]] as const) { await page.keyboard.press(key); assert.equal(await row(2).num.inputValue(), want, key); }
    await row(2).num.fill("12.5");
    await row(2).slider.focus();
    await page.keyboard.press("ArrowLeft");
    assert.equal(await row(2).num.inputValue(), "10");
    await row(2).num.fill("12.5");
    const before = Number(await row(3).num.inputValue());
    await rows.nth(3).locator(".b-wsign").click();
    assert.equal(Number(await row(3).num.inputValue()), -before);
    assert.equal(await rows.nth(3).locator(".b-wsign").getAttribute("aria-pressed"), "true");
    // the pressed ± is drawn tinted, unlike a positive row's, with the pointer away
    await page.mouse.move(0, 0);
    await page.waitForTimeout(400);   // the button's color transition
    const look = (i: number): Promise<string> => rows.nth(i).locator(".b-wsign").evaluate((b) => { const c = getComputedStyle(b); return `${c.color} ${c.backgroundColor} ${c.borderColor}`; });
    assert.notEqual(await look(3), await look(0));
    assert.match(await rows.nth(3).locator(".b-wtrack").getAttribute("class") ?? "", /\bneg\b/);
    // at 0, ± keeps the row negative ("−0", the warn style) so a drag up from there goes negative
    await row(4).num.fill("0");
    await rows.nth(4).locator(".b-wsign").click();
    assert.equal(await row(4).num.inputValue(), "-0");
    assert.equal(await rows.nth(4).locator(".b-wsign").getAttribute("aria-pressed"), "true");
    assert.match(await rows.nth(4).locator(".b-wtrack").getAttribute("class") ?? "", /\bneg\b/);
    await row(4).slider.focus();
    await page.keyboard.press("ArrowRight");
    assert.equal(await row(4).num.inputValue(), "-5");

    await settings(page, "buffs");
    const headings = (): Promise<string[]> => page.$$eval("#b-sec-buffs .b-bf-head", (h) => h.map((x) => (x as HTMLElement).innerText.replace(/\s+/g, " ")));
    const heads = await headings();
    assert.ok(heads.some((h) => /^Chivalry skill 68\.2$/i.test(h)), heads.join(" | "));
    assert.ok(heads.some((h) => /^Necromancy skill 50$/i.test(h)), "Horrific Beast (40) is usable at Necromancy 50");
    assert.ok(!heads.some((h) => /^Spellweaving/i.test(h)), "Spellweaving, not in the scan, waits for Show all");
    assert.equal(await page.locator('#b-sec-buffs .b-bf[data-buff="vampiricEmbrace"]').count(), 0);
    assert.match(await page.locator('#b-sec-buffs .b-bf[data-buff="divineFury"]').innerText(), /swing speed up[\s\S]*defense chance down/);
    await page.click("#b-bf-all");
    assert.equal(await page.evaluate(() => document.activeElement?.id), "b-bf-all", "Show all keeps the focus");
    // greyed exactly when the plan blocks it; a skill the scan lacks is counted at 120 and only said
    assert.match(await page.locator('#b-sec-buffs .b-bf.b-bf-cant[data-buff="vampiricEmbrace"]').innerText(), /Needs Necromancy 99/);
    const reaper = page.locator('#b-sec-buffs .b-bf[data-buff="reaperForm"]');
    assert.match(await reaper.innerText(), /Spellweaving not in the scan: counted at 120/);
    assert.doesNotMatch(await reaper.getAttribute("class") ?? "", /b-bf-cant/);
    assert.ok((await headings()).some((h) => /^Spellweaving not in the scan$/i.test(h)));
    await page.locator("#b-bf-divineFury").check();
    assert.equal(await page.evaluate(() => document.activeElement?.id), "b-bf-divineFury", "the switch keeps the focus through the redraw");
    // the picker's anchor survives a toggle inside the picker: Esc closes it onto the button, aria-expanded following
    await page.click("#b-buff-add");
    assert.equal(await page.getAttribute("#b-buff-add", "aria-expanded"), "true");
    await page.locator("#abf-cb-bless").check();
    assert.equal(await page.getAttribute("#b-buff-add", "aria-expanded"), "true", "still the picker's live anchor");
    assert.equal(await page.locator('#b-bf-bless').isChecked(), true);
    await page.keyboard.press("Escape");
    await page.locator(".pop").waitFor({ state: "detached" });
    assert.equal(await page.evaluate(() => document.activeElement?.id), "b-buff-add");
    assert.equal(await page.getAttribute("#b-buff-add", "aria-expanded"), "false");
    // the buff toggles redrew the weights: the box shows the stored importance as typed, 12.5, not a rounded 13
    await settings(page, "weights");
    assert.equal(await fill(row(2).slider), "12.5%");
    assert.equal(await row(2).num.inputValue(), "12.5");
    // saved and reloaded, with no memory of the typing: the box shows the stored 12.5 as it is
    await page.click("#b-save");
    await page.waitForFunction(() => /Profile for .* saved/.test(document.body.textContent || ""), undefined, { timeout: 10_000 });
    await page.reload();
    await page.waitForSelector("body:has(#tab-builder:not([hidden])) #b-sec-weights", { state: "attached", timeout: 30_000 });
    await pickCharacter(page, "Kestrel");
    await settings(page, "advanced");
    await page.fill("#b-budget", "2");
    await settings(page, "weights");
    assert.equal(await row(2).num.inputValue(), "12.5", "after a reload");
    assert.equal(await fill(row(2).slider), "12.5%");

    await settings(page, "requirements");
    assert.equal(await page.locator("#b-sec-req .b-need-status").first().innerText(), "", "no status before a build");
    // a soft DCI 45 the suit misses, and an SSI 30 it meets with a faster step to come
    for (const [q, v] of [["Swing speed", "30"], ["Defense chance", "45"]] as const) {
      await page.click("#b-addfloor");
      await page.keyboard.type(q);
      await page.keyboard.press("Enter");
      await page.keyboard.type(v);
    }
    await page.locator("#b-sec-req .rule-row[data-key=dci] [data-value=soft]").click();
    await page.click("#b-run-foot");
    await built(page);
    // each resist need says the number its tile shows, held at the cap of 70 (the Melee floor is 65)
    for (const [k, name] of [["physResist", "Physical"], ["fireResist", "Fire"]] as const) {
      const n = Number(await page.locator("#b-result .b-head-card .resist", { has: page.locator(".resist-name", { hasText: new RegExp(`^${name}$`) }) }).locator(".b-resist-val .t-xl").innerText());
      const want = n < 65 ? `${65 - n} short` : n > 70 ? `Met: 70 (+${n - 70} past cap)` : `Met: ${n}`;
      assert.equal(await page.locator(`#b-sec-req .rule-row[data-key=${k}] .b-need-status`).innerText(), want, k);
    }
    // DCI: what its gauge shows short of 45, in the warn tone
    const dci = Number(await page.locator("#b-result .b-gauge", { has: page.locator(".b-gauge-name", { hasText: /^DCI$/ }) }).locator(".b-gauge-val").innerText());
    assert.ok(dci < 45, `DCI ${dci} misses 45`);
    const dciStatus = page.locator("#b-sec-req .rule-row[data-key=dci] .b-need-status");
    assert.equal(await dciStatus.innerText(), `${45 - dci} short`);
    assert.match(await dciStatus.getAttribute("class") ?? "", /tone-warn/);
    // SSI: the next step the result's swing line has not reached, with its delay and the held weapon
    const ssi = /^Next swing step at (\d+) \(([\d.]+ s) with (.+)\)$/.exec(await page.locator("#b-sec-req .rule-row[data-key=ssi] .b-need-status").innerText());
    assert.ok(ssi, "the SSI status names the next step");
    const steps = await page.locator("#b-result .b-head-card").innerText();
    assert.ok(steps.includes(`${ssi[2]} ≥ ${ssi[1]}`) && !steps.includes(`${ssi[2]} ≥ ${ssi[1]} ✓`), `the step is one the swing line lists unreached: ${ssi[0]}`);
    assert.ok(steps.includes(ssi[3]!), "the held weapon is the swing line's");
    await fitWindow(app, page, { width: 420, height: 900 });
    for (const tab of ["weights", "buffs", "requirements"] as const) {
      await settings(page, tab);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0, `no sideways scroll on ${tab} at 420`);
    }
    assert.deepEqual(errors, []);
  } finally {
    await app.close();
    removeTempDir(dataDir);
  }
});

// Issue #217 (swing steps), on Kestrel with her worn War Axe made the best weapon in the pool (strong properties, Swordsmanship), so the result holds the worn weapon: the SSI weight row's switch, on from Melee's Swing speed goal (issue #292) with the worn weapon's steps under it, marks the template changed when turned off; the build says SSI was scored per point (the pool holds weapons of several speeds) and offers Lock Weapon (1H), shows the swing line, and Next step follows the result's swing (none before the build); Lock edits the panel without a build, and the next build scores by step with no warning; the switch is kept in the saved run's settings and by Save profile across a reload.
test("[slow] swing steps: the switch, the swing line, Next step from the result, Lock, and the switch saved with the run and the profile", async (t) => {
  const why = unavailable();
  if (why) return t.skip(why);
  const dataDir = seedDataDir("packrat-ui-swing-");
  const scanFile = join(dataDir, "scans", "demo-Kestrel.json"), scan = JSON.parse(readFileSync(scanFile, "utf8")) as { equipped: Array<{ name: string; tooltip: string[] }> };
  const axe = scan.equipped.find((i) => i.name === "War Axe")!;
  axe.tooltip = [...axe.tooltip.filter((l) => !/^(Antique|Defense Chance Increase|Swing Speed Increase|Skill Required)/.test(l)), "Skill Required: Swordsmanship", "Hit Chance Increase 45%", "Defense Chance Increase 45%",
    "Damage Increase 100%", "Hit Point Increase 25", "Dexterity Bonus 25", "Strength Bonus 25", "Physical Resist 20%", "Fire Resist 20%", "Cold Resist 20%", "Poison Resist 20%", "Energy Resist 20%"];
  writeFileSync(scanFile, JSON.stringify(scan));
  const { app, page, errors } = await launch(dataDir);
  try {
    await openBuilder(page);
    await pickCharacter(page, "Kestrel");
    await page.waitForFunction(() => document.querySelector("#b-tpl")?.getAttribute("data-value") === "builtin:melee", undefined, { timeout: 10_000 });
    await settings(page, "weights");
    const sw = page.locator("#b-swing-steps");
    await sw.waitFor({ timeout: 10_000 });
    assert.equal(await sw.isChecked(), true, "Melee's Swing speed goal scores SSI by step");
    assert.match(String(await page.locator("#b-sec-weights .b-swing-set").textContent()), /Counts SSI only where the swing gets faster\. War Axe 3 s at stamina \d+: .+ ≥ \d+/);
    await sw.uncheck();
    assert.match(await page.locator("#b-tpl-state").innerText(), /SSI by point/);
    await sw.check();
    assert.match(await page.locator("#b-tpl-state").innerText(), /equal the Melee template/);
    await settings(page, "requirements");
    await page.click("#b-addfloor");
    await page.click(".b-pick-list button[data-key=ssi]");
    await page.locator('#b-sec-req .rule-row[data-key="ssi"] input').fill("1");
    assert.equal(await page.locator("#b-sec-req .b-next-step").count(), 0, "the worn suit is at its fastest step: no Next step before the build");
    let starts = 0;
    page.on("request", (r) => { if (r.method() === "POST" && new URL(r.url()).pathname === "/api/optimize") starts++; });
    await page.click("#b-run-foot");
    await built(page);
    // read in the same poll that finds them, so a redraw can't land between the wait and the read
    const read = async (sel: string): Promise<string> => String(await (await page.waitForFunction((s) => document.querySelector(s)?.textContent || null, sel, { timeout: 10_000 })).jsonValue());
    assert.match(await read(".b-head-card .b-check"), /SSI was scored per point: the pool holds weapons with \d+ different speeds\. Lock the weapon slot to score swing speed by step\./);
    const line = await read(".b-head-card .b-swing");
    assert.match(line, /^War Axe 3 s · stamina \d+ · SSI \d+ → swings every [\d.]+ s/);
    // Next step is the first step the result's swing has not reached
    const unreached = /(?:: |· )[\d.]+ s ≥ (\d+)(?! ✓)(?: ·|$)/.exec(line.split("Steps at stamina")[1] || "")?.[1];
    assert.ok(unreached, line);
    assert.equal(await read("#b-sec-req .b-next-step"), `Next step: ${unreached}`);
    await closeSettings(page);
    await page.locator(".b-head-card .b-check").getByRole("button", { name: "Lock Weapon (1H)" }).click();
    assert.equal(await page.locator(".b-head-card .b-check").getByRole("button", { name: "Locked ✓" }).isDisabled(), true);
    assert.equal(starts, 1, "Lock starts no build");
    // the next build scores by step: no warning, the swing line still there
    await pressBuild(page);
    await page.waitForFunction(() => !document.querySelector<HTMLButtonElement>("#b-run")?.disabled && /Best suit for/.test(document.querySelector("#b-result h2")?.textContent || "")
      && !/scored per point/.test(document.querySelector("#b-result")?.textContent || ""), undefined, { timeout: 60_000 });
    assert.match(await read(".b-head-card .b-swing"), /^War Axe 3 s · stamina \d+ · SSI \d+ → swings every [\d.]+ s/);
    // the saved run keeps the switch (the server writes it as the build finishes: wait for the file)
    const kept = (): boolean => existsSync(join(dataDir, "runs")) && readdirSync(join(dataDir, "runs")).filter((f: string) => f.endsWith(".json"))
      .some((f: string) => (JSON.parse(readFileSync(join(dataDir, "runs", f), "utf8")) as { settings?: { swingSteps?: boolean } }).settings?.swingSteps === true);
    for (let i = 0; i < 50 && !kept(); i++) await page.waitForTimeout(100);
    assert.ok(kept(), "the saved run keeps the switch");
    await settings(page, "weights");
    await page.click("#b-save");
    await page.waitForFunction(() => /Profile for .* saved/.test(document.body.textContent || ""), undefined, { timeout: 10_000 });
    await page.reload();
    await page.waitForSelector("body:has(#tab-builder:not([hidden])) #b-weapon", { state: "attached", timeout: 30_000 });
    await pickCharacter(page, "Kestrel");
    await settings(page, "weights");
    assert.equal(await page.locator("#b-swing-steps").isChecked(), true, "Save profile kept the switch");
    assert.deepEqual(errors, []);
  } finally {
    await app.close();
    removeTempDir(dataDir);
  }
});

// Issue #213: the demo characters have no casting skills, so the Faster Casting cap starts at 2 and says why; naming Chivalry under Advanced raises it to 4, marks the template changed, and an FC requirement added then starts at 4 with the cap's source on its row.
test("[slow] casting school: the FC cap's source beside the select and on the FC requirement row", async (t) => {
  const why = unavailable();
  if (why) return t.skip(why);
  const dataDir = seedDataDir("packrat-ui-fccap-");
  const { app, page, errors } = await launch(dataDir);
  try {
    await openBuilder(page);
    await settings(page, "advanced");
    const note = page.locator("#b-sec-char .b-school .b-fc-cap");
    await note.waitFor({ timeout: 10_000 });
    assert.equal(await note.innerText(), "cap 2: no Chivalry, Spellweaving or Bushido");
    await page.selectOption("#b-school", "Chivalry");
    assert.equal(await note.innerText(), "cap 4: Chivalry (chosen)");
    assert.match(await page.locator("#b-tpl-state").innerText(), /casting school Chivalry/);
    await settings(page, "requirements");
    await page.click("#b-addfloor");
    await page.click(".b-pick-list button[data-key=fc]");
    const row = page.locator('#b-sec-req .rule-row[data-key="fc"]');
    assert.equal(await row.locator("input").inputValue(), "4");
    assert.equal(await row.locator(".b-fc-cap").innerText(), "cap 4: Chivalry (chosen)");
    assert.deepEqual(errors, []);
  } finally {
    await app.close();
    removeTempDir(dataDir);
  }
});

// Issue #262: Rarity in the Pool tab: Lower marks the template changed and shows a help line; the build's
// Solver details carry the Rarity row with the rarity total; Save profile keeps it across a reload; and applying a
// template that has no preference clears it. Every read polls, so a later redraw cannot race it.
test("[slow] rarity preference: the segmented control, its help line, the result's Rarity row, Save profile and template Apply", async (t) => {
  const why = unavailable();
  if (why) return t.skip(why);
  const dataDir = seedDataDir("packrat-ui-rarity-");
  const { app, page, errors } = await launch(dataDir);
  const text = (sel: string, re: RegExp): Promise<unknown> => page.waitForFunction(([q, src]) => new RegExp(src!).test(document.querySelector(q!)?.textContent || ""), [sel, re.source], { timeout: 10_000 });
  const lowerOn = (on: boolean): Promise<unknown> => page.waitForFunction((want) => document.querySelector('#b-rarity [data-value="lower"]')?.getAttribute("aria-checked") === String(want), on, { timeout: 10_000 });
  try {
    await openBuilder(page);
    await settings(page, "pool");
    await page.waitForFunction(() => (document.querySelector("#b-rarity-help") as HTMLElement | null)?.hidden === true);
    await page.click('#b-rarity [data-value="lower"]');
    await text("#b-rarity-help", /^Among equally good suits, use the lowest-rarity pieces\. Requirements come first\.$/);
    await text("#b-tpl-state", /prefer lower rarity/);
    await page.click("#b-run-foot");
    await built(page);
    await closeSettings(page);
    await page.click("#b-result .b-disclose");
    await text("#b-details", /Rarity\s*Lowest-rarity pieces among equal suits · rarity total \d+/);
    await settings(page, "pool");
    await page.click("#b-save");
    await page.waitForFunction(() => /Profile for .* saved/.test(document.body.textContent || ""), undefined, { timeout: 10_000 });
    await page.reload();
    await page.waitForSelector("body:has(#tab-builder:not([hidden])) #b-rarity", { state: "attached", timeout: 30_000 });
    await lowerOn(true);
    // a template is a full set of settings: starting over from one with no preference clears it
    await pickTemplate(page, "builtin:melee");
    await page.waitForFunction(() => document.querySelector('#b-rarity [data-value=""]')?.getAttribute("aria-checked") === "true", undefined, { timeout: 10_000 });
    await lowerOn(false);
    await page.waitForFunction(() => (document.querySelector("#b-rarity-help") as HTMLElement | null)?.hidden === true);
    assert.deepEqual(errors, []);
  } finally {
    await app.close();
    removeTempDir(dataDir);
  }
});

test("[slow] STR limit sits beside Race under Advanced, and a bad value opens the drawer there", async (t) => {
  const why = unavailable();
  if (why) return t.skip(why);
  const dataDir = seedDataDir("packrat-ui-strlimit-");
  const { app, page, errors } = await launch(dataDir);
  try {
    await openBuilder(page);
    await settings(page, "advanced");
    const str = page.getByLabel("STR limit");
    assert.equal(await str.isVisible(), true);
    assert.equal(await page.locator("#b-sec-char #b-race").count(), 1, "beside Race, in the Character group");
    assert.equal(await page.locator("#b-sec-char #b-str").count(), 1);
    await str.fill("0");
    await closeSettings(page);
    await pressBuild(page);
    await page.waitForSelector("#b-str-err");
    assert.equal(await page.evaluate(() => document.activeElement?.id), "b-str", "Build opens the drawer and puts focus on the bad field");
    assert.equal(await page.getAttribute("#b-tab-advanced", "aria-selected"), "true", "on Advanced");
    assert.deepEqual(errors, []);
  } finally {
    await app.close();
    removeTempDir(dataDir);
  }
});

// Resist cap overrides (issue #44): a Fire cap raised to 95 for a Reaper Form suit is marked in the drawer, the
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
    await settings(page, "advanced");
    assert.equal(await fire.inputValue(), "70", "the shard's cap until the player types another");
    assert.match(await fireRow.innerText(), /shard cap/);
    await fire.fill("95");
    assert.match(await fireRow.innerText(), /raised from 70/);
    assert.equal(await fireRow.getByRole("button", { name: "Reset Fire resist cap to the shard's 70" }).count(), 1);
    // A buff (issue #12): Divine Fury turned on in Automatic's picker is on in the Buffs tab's list, and the build
    // plans with it: its headline says so, and "Show without buffs" redraws the totals without it.
    await settings(page, "buffs");
    await page.click("#b-buff-add");
    await page.locator("#abf-cb-divineFury").check();
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("#b-bf-divineFury").isChecked(), true, "its switch in the Buffs tab is on");

    await pressBuild(page);
    await built(page);
    const tile = page.locator("#b-result .b-head-card .resist", { hasText: "Fire" });
    assert.match(await tile.innerText(), /\/ 95/);
    assert.match(await tile.innerText(), /Cap raised from 70/);
    assert.match(await page.locator("#b-result .b-planned").innerText(), /Planned with\s*Divine Fury/);
    await closeSettings(page);
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
    await settings(page, "advanced");
    await page.click("#b-save");
    await page.waitForFunction(() => /Profile for .* saved/.test(document.body.textContent || ""), undefined, { timeout: 10_000 });
    await page.reload();
    await page.waitForSelector("body:has(#tab-builder:not([hidden])) #b-sec-caps", { state: "attached", timeout: 30_000 });
    await settings(page, "advanced");
    assert.equal(await fire.inputValue(), "95", "the profile kept the override");

    // Out of range: the build does not run, and the field says why and takes focus.
    await fire.fill("200");
    assert.equal(await page.locator("#b-cap-fireResist-err").innerText(), "Enter a whole number from 0 to 150.");
    await page.click("#b-run-foot");
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
    removeTempDir(dataDir);
  }
});

// Review of #48: a requirement above its resist's cap warns on its row; a race change drops an override that is now
// the race's own cap, so Save does not store it; and an out-of-range cap stops Build with the drawer closed.
test("[slow] resist caps: a floor past its cap warns, a race change drops a now-default override, a closed drawer still blocks Build", async (t) => {
  const why = unavailable();
  if (why) return t.skip(why);
  const dataDir = seedDataDir("packrat-ui-rescaps2-");
  const { app, page, errors } = await launch(dataDir);
  try {
    await openBuilder(page);
    await settings(page, "advanced");
    const fireReq = page.locator("#b-sec-req .rule-row[data-key=fireResist]");
    await page.fill("#b-cap-fireResist", "60");
    assert.match(await fireReq.innerText(), /Counts only up to the Fire cap, 60/);
    await page.fill("#b-cap-fireResist", "70");
    assert.doesNotMatch(await fireReq.innerText(), /Counts only up to/);
    await settings(page, "requirements");
    await fireReq.locator("input[type=number]").fill("90");
    assert.match(await fireReq.innerText(), /Counts only up to the Fire cap, 70/, "and it follows the floor as it is typed");
    await fireReq.locator("input[type=number]").fill("65");
    await settings(page, "advanced");

    // Human with Energy 75 (raised), then Elf: 75 is the Elf's own cap, so nothing is overridden or saved.
    await page.fill("#b-cap-energyResist", "75");
    assert.match(await page.locator("#b-sec-caps .rule-row[data-key=energyResist]").innerText(), /raised from 70/);
    await page.locator("#b-race").getByRole("radio", { name: "Elf" }).click();
    assert.match(await page.locator("#b-sec-caps .rule-row[data-key=energyResist]").innerText(), /shard cap/);
    await page.click("#b-save");
    await page.waitForFunction(() => /Profile for .* saved/.test(document.body.textContent || ""), undefined, { timeout: 10_000 });
    const saved = await page.evaluate(async () => {
      const r = await (await import("/ui/api.mjs" as string)).api("/api/profiles");
      const who = document.querySelector("#b-char")!.getAttribute("data-value")!;
      return r.profiles.characters[who].spec.intent.resistCaps;
    });
    assert.deepEqual(saved, {}, "no override stored for the Elf's own Energy cap");

    // Out of range, drawer closed: Build opens it on the field instead of building.
    await page.fill("#b-cap-coldResist", "200");
    await closeSettings(page);
    assert.equal(await page.locator("#b-cap-coldResist").isHidden(), true, "the drawer is closed");
    await pressBuild(page);
    await page.waitForSelector("#b-cap-coldResist-err");
    assert.equal(await page.evaluate(() => document.activeElement?.id), "b-cap-coldResist");
    assert.equal(await page.locator("#b-cap-coldResist").inputValue(), "200", "the typed value is kept");
    assert.equal(await page.locator("#b-run").isDisabled(), false, "no build started");
    assert.deepEqual(errors, []);
  } finally {
    await app.close();
    removeTempDir(dataDir);
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
    await settings(page, "pool");
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
    await page.waitForSelector("body:has(#tab-builder:not([hidden])) #b-weapon", { state: "attached", timeout: 30_000 });
    await settings(page, "pool");
    assert.equal(await chip.innerText(), "Weapons: Swordsmanship only");
    await chip.click();
    assert.ok(!(await page.locator(".pop #b-ubws").isChecked()), "the switch saved off");
    assert.deepEqual(await page.locator(".pop .b-checks input:checked").evaluateAll((is) => is.map((i) => (i as HTMLInputElement).value)), ["archery", "fencing", "mace fighting", "throwing"]);
    assert.deepEqual(errors, []);
  } finally {
    await app.close();
    removeTempDir(dataDir);
  }
});

// Spellbooks (issue #259): the Weapons popover ends in a Spellbooks row that adds ", no spellbooks" to the chip and is saved
// with the profile.
test("[slow] the Weapons popover's Spellbooks row excludes spellbooks and is saved with the profile", async (t) => {
  const why = unavailable();
  if (why) return t.skip(why);
  const dataDir = seedDataDir("packrat-ui-books-");
  const { app, page, errors } = await launch(dataDir);
  try {
    await openBuilder(page);
    await settings(page, "pool");
    const chip = page.locator("#b-weapon");
    await chip.click();
    await page.waitForFunction(() => [...document.querySelectorAll(".pop .b-checks label")].map((l) => (l.textContent || "").trim()).join("|") === "Archery|Swordsmanship|Fencing|Mace fighting|Throwing|Spellbooks", undefined, { timeout: 10_000 });
    await page.locator('.pop input[value="spellbook"]').check();
    await page.waitForFunction(() => document.querySelector("#b-weapon")?.textContent?.trim() === "Weapons: any, no spellbooks", undefined, { timeout: 10_000 });
    await page.locator('.pop input[value="throwing"]').check();
    await page.waitForFunction(() => document.querySelector("#b-weapon")?.textContent?.trim() === "Weapons: 1 excluded, no spellbooks", undefined, { timeout: 10_000 });
    await page.keyboard.press("Escape");
    await page.click("#b-save");
    await page.waitForFunction(() => /Profile for .* saved/.test(document.body.textContent || ""), undefined, { timeout: 10_000 });
    await page.reload();
    await page.waitForSelector("body:has(#tab-builder:not([hidden])) #b-weapon", { state: "attached", timeout: 30_000 });
    await page.waitForFunction(() => document.querySelector("#b-weapon")?.textContent?.trim() === "Weapons: 1 excluded, no spellbooks", undefined, { timeout: 10_000 });
    await settings(page, "pool");
    await chip.click();
    assert.deepEqual(await page.locator(".pop .b-checks input:checked").evaluateAll((is) => is.map((i) => (i as HTMLInputElement).value)), ["throwing", "spellbook"]);
    assert.deepEqual(errors, []);
  } finally {
    await app.close();
    removeTempDir(dataDir);
  }
});

// Weapon properties (issue #214): the Weapon must have chip beside Weapons says what is checked, and Save profile keeps it
// across a reload; unchecking everything leaves the chip plain again.
test("[slow] the Weapon must have chip shows the checked properties and is saved with the profile", async (t) => {
  const why = unavailable();
  if (why) return t.skip(why);
  const dataDir = seedDataDir("packrat-ui-wflags-");
  const { app, page, errors } = await launch(dataDir);
  try {
    await openBuilder(page);
    await settings(page, "pool");
    const chip = page.locator("#b-wflags");
    assert.equal(await chip.innerText(), "Weapon must have");
    await chip.click();
    assert.deepEqual(await page.locator(".pop .b-checks input").evaluateAll((is) => is.map((i) => (i as HTMLInputElement).value)), ["spell channeling", "balanced"]);
    await page.locator('.pop input[value="spell channeling"]').check();
    assert.equal(await chip.innerText(), "Weapon must have: Spell Channeling");
    await page.locator('.pop input[value="balanced"]').check();
    assert.equal(await chip.innerText(), "Weapon must have: Spell Channeling, Balanced");
    await page.locator('.pop input[value="balanced"]').uncheck();
    await page.keyboard.press("Escape");
    await page.click("#b-save");
    await page.waitForFunction(() => /Profile for .* saved/.test(document.body.textContent || ""), undefined, { timeout: 10_000 });
    await page.reload();
    await page.waitForSelector("body:has(#tab-builder:not([hidden])) #b-wflags", { state: "attached", timeout: 30_000 });
    await settings(page, "pool");
    assert.equal(await chip.innerText(), "Weapon must have: Spell Channeling");
    await chip.click();
    assert.deepEqual(await page.locator(".pop .b-checks input:checked").evaluateAll((is) => is.map((i) => (i as HTMLInputElement).value)), ["spell channeling"]);
    await page.locator('.pop input[value="spell channeling"]').uncheck();
    assert.equal(await chip.innerText(), "Weapon must have");
    assert.deepEqual(errors, []);
  } finally {
    await app.close();
    removeTempDir(dataDir);
  }
});

test("[slow] the Only containers chip narrows the pool, is built with, kept by the run and saved with the profile (issue #12)", async (t) => {
  const why = unavailable();
  if (why) return t.skip(why);
  const dataDir = seedDataDir("packrat-ui-onlyroots-");
  const { app, page, errors } = await launch(dataDir);
  try {
    await openBuilder(page);
    await settings(page, "pool");
    const who = (await page.getAttribute("#b-char", "data-value"))!, chip = page.locator("#b-onlyroots");
    await page.waitForFunction(() => document.querySelector<HTMLElement>("#b-onlyroots")?.innerText === "Only containers");
    await chip.click();
    const values = await page.locator(".pop .b-checks input").evaluateAll((is) => is.map((i) => (i as HTMLInputElement).value));
    assert.equal(values.length, 2, "the two demo containers, as Skip containers offers them");
    const picked = Number(values[0]);
    await page.locator(`.pop input[value="${picked}"]`).check();
    await page.waitForFunction(() => document.querySelector<HTMLElement>("#b-onlyroots")?.innerText === "Only containers: 1");
    await page.keyboard.press("Escape");
    await pressBuild(page);
    await built(page);
    // the saved run keeps the list (the server writes it as the build finishes: wait for the file)
    const kept = (): boolean => existsSync(join(dataDir, "runs")) && readdirSync(join(dataDir, "runs")).filter((f: string) => f.endsWith(".json"))
      .some((f: string) => JSON.stringify((JSON.parse(readFileSync(join(dataDir, "runs", f), "utf8")) as { settings?: { onlyRoots?: number[] } }).settings?.onlyRoots) === JSON.stringify([picked]));
    for (let i = 0; i < 50 && !kept(); i++) await page.waitForTimeout(100);
    assert.ok(kept(), "the saved run keeps the list");
    await page.click("#b-save");
    await page.waitForFunction(() => /Profile for .* saved/.test(document.body.textContent || ""), undefined, { timeout: 10_000 });
    const pool = (): { onlyRoots?: number[] } => (JSON.parse(readFileSync(join(dataDir, "profiles.json"), "utf8")) as { characters: Record<string, { spec: { pool: { onlyRoots?: number[] } } }> }).characters[who]!.spec.pool;
    assert.deepEqual(pool().onlyRoots, [picked]);
    await page.reload();
    await page.waitForSelector("body:has(#tab-builder:not([hidden])) #b-onlyroots", { state: "attached", timeout: 30_000 });
    await settings(page, "pool");
    await page.waitForFunction(() => document.querySelector<HTMLElement>("#b-onlyroots")?.innerText === "Only containers: 1");
    // cleared, it is no filter and leaves the saved profile
    await chip.click();
    await page.locator(`.pop input[value="${picked}"]`).uncheck();
    await page.waitForFunction(() => document.querySelector<HTMLElement>("#b-onlyroots")?.innerText === "Only containers");
    await page.keyboard.press("Escape");
    await page.click("#b-save");
    for (let i = 0; i < 50 && pool().onlyRoots; i++) await page.waitForTimeout(100);
    assert.equal(pool().onlyRoots, undefined, "an empty list is not stored");
    assert.deepEqual(errors, []);
  } finally {
    await app.close();
    removeTempDir(dataDir);
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
    await settings(page, "pool");
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
    removeTempDir(dataDir);
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
    assert.equal(await page.locator("#b-settings").isVisible(), false, "Automatic's Settings are out of the way");
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
    removeTempDir(dataDir);
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
      const pick = document.querySelector<HTMLButtonElement>("#b-char")!, now = pick.dataset.value;
      pick.click();
      [...document.querySelectorAll<HTMLElement>(".pop [role=option]")].find((o) => o.dataset.value !== "_nobody" && o.dataset.value !== now)!.click();
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
    await pressBuild(page);
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
    removeTempDir(dataDir);
  }
});

// Issue #212, with the built-in Melee given a description, a source and Divine Fury (the page's GET /api/profiles
// answer edited) and Manual holding Bless with its totals not counting buffs: the picker lists the built-ins first
// under their own names and shows Melee's badge, description, buffs and source; Apply turns Divine Fury on in Manual
// (counted) as one undo step, and Undo puts Bless and the switch back; a buff turned on since marks the template
// changed; Save as stores the buffs with the copy, listed under "Your templates".
test("[slow] templates: built-ins first with their description, Apply sets Manual's buffs in one undo step, the badge and Save as count buffs", async (t) => {
  const why = unavailable();
  if (why) return t.skip(why);
  const dataDir = seedDataDir("packrat-ui-templates-");
  const { app, page, errors } = await launch(dataDir);
  const SOURCE = "https://uoalive.com/wiki/PlayerGuide:Lazy_Pally";
  try {
    await openBuilder(page);
    assert.equal(await page.evaluate(() => fetch("/api/ui-prefs", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ manualBuffs: ["bless"], buffsCount: "off" }) }).then((r) => r.ok)), true, "Manual's buffs seeded");
    // The real answer is read by the page itself ("?real" skips this route): route.fetch() would go around Electron's
    // session, which adds the server's token, and get a 401.
    await page.route(/\/api\/profiles$/, async (r) => {
      if (r.request().method() !== "GET") { await r.continue(); return; }
      const body = await page.evaluate(() => fetch("/api/profiles?real").then((res) => res.json())) as { builtinTemplates: Record<string, { spec: Record<string, unknown> }> };
      const melee = body.builtinTemplates.melee!;
      body.builtinTemplates.melee = { ...melee, description: "A test build.", sources: [SOURCE], spec: { ...melee.spec, buffs: { on: ["divineFury"], skills: {} } } } as typeof melee;
      body.builtinTemplates.caster = { ...body.builtinTemplates.caster!, spec: { ...body.builtinTemplates.caster!.spec, buffs: { on: [], skills: {} } } };
      await r.fulfill({ json: body });
    });
    await page.reload();
    await page.waitForSelector("#tab-builder:not([hidden]) #b-tpl", { timeout: 30_000 });
    await pickCharacter(page, "Kestrel");
    // the build picker: Kestrel's own build, then the built-ins to start over from (no saved templates yet)
    const groups = (): Promise<string[]> => page.$$eval(".pop .cbx-grp", (els) => els.map((e) => e.textContent || ""));
    await page.click("#b-tpl");
    assert.deepEqual(await groups(), ["Kestrel's own", "Start over from a built-in template"]);
    assert.deepEqual(await page.$$eval(".pop .cbx-group:last-child [role=option] .cbx-title", (els) => els.map((e) => e.textContent)), ["Melee", "Caster", "Archer", "Tank", "Sampire", "Paladin (Lazy Pally)", "Summoner", "Tamer (Archer)", "Archer (Chivalry)", "Archer-Bard", "Necro-Mage", "Mystic-Mage", "Spellweaver (Necroweaver)", "Thrower (Gargoyle)", "Tank (Mystic)", "Horrific Beast Wrestler", "Hemomancer"]);
    await page.keyboard.press("Escape");
    await settings(page, "buffs");   // the template's description shows at the drawer's top
    await page.waitForFunction(() => /Loads: Divine Fury/.test(document.querySelector("#b-tpl-info")?.textContent || ""));
    assert.match(await page.locator("#b-tpl-info").innerText(), /Built-in\s+A test build\.\s+Loads: Divine Fury\s+Source: Lazy Pally/);
    assert.equal(await page.locator("#b-tpl-info a").getAttribute("href"), SOURCE);
    await closeSettings(page);
    // Start over from Melee: Divine Fury on in Automatic and in Manual, counted, as one undo step
    await pickTemplate(page, "builtin:melee");
    await page.waitForFunction(() => /equal the Melee template/.test(document.querySelector("#b-tpl-state")?.textContent || ""));
    await settings(page, "buffs");
    assert.equal(await page.locator("#b-bf-divineFury").isChecked(), true);
    // a buff turned on since marks the template changed
    await page.click("#b-buff-add");
    await page.locator("#abf-cb-bless").check();
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => /^from template “Melee”, with 1 setting changed[\s\S]*Changed from Melee: Buffs: \+Bless/.test(document.querySelector("#b-tpl-state")?.textContent || ""));
    // Save as keeps the buffs with the copy
    await closeSettings(page);
    await page.click("#b-tpl");
    await page.locator(".pop").getByRole("button", { name: "Save as template…" }).click();
    const dialog = page.locator(".prompt-dialog[open]");
    await dialog.locator("input[type=text]").fill("Mine");
    await dialog.getByRole("button", { name: "Save" }).click();
    await page.waitForFunction(() => /Template Mine saved/.test(document.body.textContent || ""), undefined, { timeout: 10_000 });
    const saved = JSON.parse(readFileSync(join(dataDir, "profiles.json"), "utf8")) as { templates: Record<string, { spec: { buffs?: { on: string[]; skills: object } } }> };
    const mine = saved.templates.Mine!.spec.buffs!;
    assert.deepEqual([[...mine.on].sort(), mine.skills], [["bless", "divineFury"], {}]);
    await page.click("#b-tpl");
    assert.deepEqual(await groups(), ["Kestrel's own", "Start over from a saved template", "Start over from a built-in template"]);
    await page.keyboard.press("Escape");
    // Manage templates reaches any saved template without applying it: a second one, deleted after its confirmation, leaves
    // the build on Mine and Kestrel's saved profile as it was (review M2)
    const profiles = (): { templates: Record<string, unknown>; characters: Record<string, { template?: string }> } => JSON.parse(readFileSync(join(dataDir, "profiles.json"), "utf8"));
    await page.evaluate(async (url) => { const { state } = await import(url); state.profiles.templates.Spare = { spec: state.profiles.templates.Mine.spec }; }, "/ui/store.mjs");
    const kestrelBefore = JSON.stringify(profiles().characters.Kestrel);
    await page.click("#b-tpl");
    await page.locator(".pop").getByRole("button", { name: "Manage templates…" }).click();
    const manage = page.getByRole("menu", { name: "Manage templates" });
    assert.deepEqual((await manage.getByRole("menuitem").allInnerTexts()).map((x) => x.trim()), ["Update “Mine” with these settings", "Delete “Mine”…", "Update “Spare” with these settings", "Delete “Spare”…"], "the build's own first");
    // a click on the build picker's button with the menu open closes the menu, with no error (re-review R1)
    await page.click("#b-tpl");
    assert.equal(await page.locator(".pop").count(), 0, "the menu closed");
    assert.deepEqual(errors, []);
    await page.click("#b-tpl");
    await page.locator(".pop").getByRole("button", { name: "Manage templates…" }).click();
    await manage.getByRole("menuitem", { name: "Delete “Spare”…" }).click();
    await page.locator("dialog[open]").getByRole("button", { name: "Delete Spare" }).click();
    await page.waitForFunction(() => /Template Spare deleted/.test(document.body.textContent || ""), undefined, { timeout: 10_000 });
    assert.equal(Object.hasOwn(profiles().templates, "Spare"), false);
    assert.equal(await page.getAttribute("#b-tpl", "data-value"), "Mine", "the build still comes from Mine");
    assert.equal(JSON.stringify(profiles().characters.Kestrel), kestrelBefore, "Kestrel's saved profile untouched");
    // Manual: the template's buffs, counted, one undo step; Undo puts Bless and the switch back
    await page.click('#b-mode [data-value="manual"]');
    await page.waitForSelector("#b-manual:not([hidden]) #mb-suit .mb-slot");
    await page.waitForFunction(() => /^Undo: Melee buffs/.test(document.querySelector("#mb-undo")?.getAttribute("aria-label") || ""));
    assert.deepEqual(await page.$$eval("#mb-totals .bf-strip .token[data-buff]", (els) => els.map((e) => (e as HTMLElement).dataset.buff)), ["divineFury"]);
    assert.equal(await page.locator("#bf-count").isChecked(), true);
    await page.click("#mb-undo");
    await page.waitForFunction(() => [...document.querySelectorAll<HTMLElement>("#mb-totals .bf-strip .token[data-buff]")].map((e) => e.dataset.buff).join() === "bless");
    assert.equal(await page.locator("#bf-count").isChecked(), false);
    // a template with no buffs empties Manual's list in one undo step and leaves the count switch off
    await page.click('#b-mode [data-value="automatic"]');
    await pickTemplate(page, "builtin:caster");
    await page.click('#b-mode [data-value="manual"]');
    await page.waitForFunction(() => /^Undo: Caster buffs/.test(document.querySelector("#mb-undo")?.getAttribute("aria-label") || ""));
    assert.equal(await page.locator("#mb-totals .bf-strip .token[data-buff]").count(), 0);
    assert.equal(await page.locator("#bf-count").isChecked(), false);
    assert.deepEqual(errors, []);
  } finally {
    await page.unrouteAll({ behavior: "ignoreErrors" });
    await app.close();
    removeTempDir(dataDir);
  }
});

// Issue #12, No character in Automatic: its own panel (no Race row), its build headed "Best suit · No character" with Grab
// disabled while no bridge is online, its run in the drawer, Save profile kept across a reload, Manual on its No
// character, and a character picked again showing that character's own panel.
test("[slow] No character: built in Automatic from its own profile, saved as a run, kept by Save profile, shared with Manual (issue #12)", async (t) => {
  const why = unavailable();
  if (why) return t.skip(why);
  const dataDir = seedDataDir("packrat-ui-nobody-");
  const { app, page, errors } = await launch(dataDir);
  try {
    await openBuilder(page);
    await pickCharacter(page, "_nobody");
    await page.waitForFunction(() => document.querySelector("#b-start h2")?.textContent === "What should the suit be for?");
    assert.equal(await page.locator("#b-wearing").count(), 0, "nothing worn to show");
    assert.equal(await page.locator("#b-race").count(), 0, "no Race row");
    const noPseudo = async (where: string): Promise<void> => assert.doesNotMatch(await page.evaluate(() => document.body.innerText), /_nobody/, `no "_nobody" in the page text (${where})`);
    // the buff picker speaks of no character, not of "_nobody"
    await settings(page, "buffs");
    await page.click("#b-buff-add");
    await page.locator("#abf-h").waitFor();
    assert.equal(await page.locator("#abf-h").innerText(), "Buffs");
    assert.match(await page.locator(".pop .bf-status").innerText(), /no character: every skill at 120/);
    await noPseudo("buff picker");
    await page.keyboard.press("Escape");
    await settings(page, "advanced");
    assert.ok(await page.locator("#b-str").isVisible(), "STR limit stays");
    await closeSettings(page);
    await pickTemplate(page, "builtin:caster");
    await settings(page, "requirements");
    await page.locator("#b-sec-req .rule-row[data-key=lrc]").waitFor();
    assert.equal(await page.locator("#b-sec-req .rule-row[data-key=lrc] input[type=number]").inputValue(), "100");
    assert.equal(await page.locator("#b-sec-req .rule-row[data-key=lmc] input[type=number]").inputValue(), "40");
    await page.click("#b-run-foot");
    await page.waitForFunction(() => !document.querySelector<HTMLButtonElement>("#b-run")?.disabled && document.querySelector("#b-result h2")?.textContent === "Best suit · No character", undefined, { timeout: 60_000 });
    assert.equal(await page.locator("#b-grab-all").isDisabled(), true);
    await closeSettings(page);
    await page.hover("#b-result .tipwrap:has(#b-grab-all)");
    await page.waitForFunction(() => [...document.querySelectorAll(".tip")].some((e) => e.textContent === "Log a character in to grab"));
    assert.equal(await page.locator("#b-result section[aria-label='Suit totals'] > .card-head h2").innerText(), "Suit totals");
    await noPseudo("result");
    // with a bridge online on Kestrel, Grab puts the pieces in her backpack and the toast names her
    const queued: Array<{ action: string; serial: number }> = [];
    await page.route("**/api/bridge/status", (r) => r.fulfill({ json: { ok: true, online: true, character: "Kestrel", results: {} } }));
    await page.route((u) => u.pathname === "/api/bridge", (r) => { queued.push(r.request().postDataJSON()); return r.fulfill({ json: { ok: true, id: `t${queued.length}` } }); });
    await page.waitForFunction(() => /^Grab all \d+$/.test(document.querySelector("#b-grab-all")?.textContent || ""), undefined, { timeout: 10_000 });
    const n = Number((await page.locator("#b-grab-all").innerText()).replace(/\D/g, ""));
    await page.click("#b-grab-all");
    await page.waitForFunction((k) => new RegExp(`${k} grabs? queued for Kestrel`).test(document.body.textContent || ""), n, { timeout: 15_000 });
    assert.equal(queued.length, n);
    assert.ok(queued.every((q) => q.action === "grab"), JSON.stringify(queued));
    await page.unrouteAll({ behavior: "ignoreErrors" });
    await page.waitForFunction(() => document.querySelector<HTMLButtonElement>("#b-grab-all")?.disabled === true, undefined, { timeout: 10_000 });
    await page.waitForFunction(() => Number(document.querySelector("#b-runs-count")?.textContent) >= 1);
    await page.click("#b-runs-open");
    await page.waitForSelector("#runs-drawer:not([hidden]) .run-card");
    assert.match(await page.locator("#b-runs-who").innerText(), /^No character · 1 run/);
    await page.keyboard.press("Escape");
    // Save profile, then a reload comes back to No character with its requirements
    await settings(page, "requirements");
    await page.click("#b-save");
    await page.waitForFunction(() => /Profile for No character saved/.test(document.body.textContent || ""), undefined, { timeout: 10_000 });
    const saved = JSON.parse(readFileSync(join(dataDir, "profiles.json"), "utf8")) as { characters: Record<string, { spec: { intent: { floors: Record<string, number> } } }> };
    assert.equal(saved.characters._nobody!.spec.intent.floors.lrc, 100);
    await page.reload();
    await page.waitForSelector("body:has(#tab-builder:not([hidden])) #b-sec-req .rule-row[data-key=lrc]", { state: "attached", timeout: 30_000 });
    assert.equal(await page.getAttribute("#b-char", "data-value"), "_nobody");
    assert.equal(await page.locator("#b-race").count(), 0);
    // Manual shows its No character; a character picked back in Automatic has its own panel
    await page.click('#b-mode [data-value="manual"]');
    await page.waitForSelector("#b-manual:not([hidden]) #mb-suit .mb-slot");
    assert.equal(await page.getAttribute("#b-char", "data-value"), "_nobody");
    assert.equal(await page.locator("#mb-worn").count(), 0, "no worn suit to start from");
    await noPseudo("Manual");
    await page.click('#b-mode [data-value="automatic"]');
    await pickCharacter(page, "Kestrel");
    await page.waitForFunction(() => document.querySelector("#b-start h2")?.textContent === "What should Kestrel's suit be for?");
    assert.equal(await page.locator("#b-race").count(), 1);
    assert.deepEqual(errors, []);
  } finally {
    await app.close();
    removeTempDir(dataDir);
  }
});

// Issue #272 part 4, arriving: a fresh data folder shows Dorran's first-visit view (template cards, the summary, Build) with
// no sideways scroll at 420; a card applies its template in the top bar and Build shows a result, which stays put through a
// scans refresh; Kestrel shows her own first-visit view with Dorran's run under "Other characters' recent runs", and back
// on Dorran his last run opens again. A reload comes back to the run, New build returns to the first-visit view, the other
// character's card opens Dorran's run again, and a newer scan puts up the gear-changed banner whose Build again builds.
test("[slow] arriving: the first-visit view, coming back to the latest run, other characters' runs, New build, the gear-changed banner", async (t) => {
  const why = unavailable();
  if (why) return t.skip(why);
  const dataDir = seedDataDir("packrat-ui-arrive-");
  const { app, page, errors } = await launch(dataDir);
  try {
    await openBuilder(page);
    assert.equal(await page.locator("#b-start h2").innerText(), "What should Dorran's suit be for?");
    const cards = page.locator("#b-start .b-tpl-card");
    assert.equal(await cards.count(), 4, "four template cards, one row");
    assert.match(await cards.first().innerText(), /^Suggested\s+Melee/);
    assert.equal(await cards.first().getAttribute("aria-pressed"), "true");
    assert.match(await page.locator("#b-start .b-start-sum").innerText(), /Melee will build for\s+Needs\s+Resists 65[\s\S]*What matters most/);
    assert.equal(await page.locator("#b-start-build").innerText(), "Build Dorran's suit");
    assert.match(await page.locator("#b-wearing").innerText(), /^Dorran is wearing now/);
    await fitWindow(app, page, { width: 420, height: 900 });
    // polled: the sidebar folds as the window narrows, so a read in the middle of the resize can catch it wider
    const fits = await page.waitForFunction(() => document.documentElement.scrollWidth - document.documentElement.clientWidth <= 0, undefined, { timeout: 5_000 }).then(() => true, () => false);
    assert.ok(fits, `no sideways scroll at 420: ${await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth, ...[...document.querySelectorAll("body *")].filter((e) => e.getBoundingClientRect().right > innerWidth + 0.5).slice(0, 5).map((e) => `${e.tagName}.${e.className}#${e.id}`)].join(" "))}`);
    await fitWindow(app, page, { width: 1440, height: 900 });

    // a card does what the build picker does, applies the template and saves it as Dorran's settings; no card moves
    const order = await cards.allInnerTexts();
    const caster = cards.filter({ hasText: "Caster" }).first();
    await caster.click();
    await page.waitForFunction(() => /Caster saved as Dorran's settings/.test(document.body.textContent || ""), undefined, { timeout: 10_000 });
    await page.waitForFunction(() => document.querySelector("#b-tpl")?.getAttribute("data-value") === "builtin:caster", undefined, { timeout: 10_000 });
    await page.waitForFunction(() => /Caster will build for/.test(document.querySelector("#b-start .b-start-sum")?.textContent || ""), undefined, { timeout: 10_000 });
    assert.equal(await cards.filter({ hasText: "Caster" }).first().getAttribute("aria-pressed"), "true");
    assert.deepEqual(await cards.allInnerTexts(), order, "the cards keep their places and badges");
    await page.click("#b-start-build");
    await built(page);
    await page.waitForFunction(() => /Dorran's runs/.test(document.querySelector("#b-myruns")?.textContent || ""), undefined, { timeout: 10_000 });
    // the scans refreshed (the page's own reload, which redraws every screen): the build stays on screen
    const refreshScans = (): Promise<void> => page.evaluate(async (url) => { await (await import(url)).reload(); }, "/ui/inventory-data.mjs");
    const runId = await page.evaluate(async (url) => (await import(url)).session.openRun, "/ui/builder-session.mjs");
    await refreshScans();
    assert.match(await page.locator("#b-result h2").first().innerText(), /^Best suit for Dorran/);
    assert.equal(await page.evaluate(async (url) => (await import(url)).session.openRun, "/ui/builder-session.mjs"), runId, "the same run");

    // Kestrel: her own first-visit view, with Dorran's run among the others; back on Dorran, his last run again
    await pickCharacter(page, "Kestrel");
    await page.waitForSelector("#b-start #b-other-runs", { timeout: 10_000 });
    assert.match(await page.locator("#b-other-runs").innerText(), /Other characters' recent runs\s+Dorran · /);
    await pickCharacter(page, "Dorran");
    await page.waitForFunction(() => /^Best suit for Dorran/.test(document.querySelector("#b-result h2")?.textContent || ""), undefined, { timeout: 10_000 });

    // a reload with nothing changed comes back to it with no settings changed (its time budget, which a profile does not
    // keep, comes back from the run), and it stays through a scans refresh; New build returns to the first-visit view
    await page.reload();
    await page.waitForSelector("#tab-builder:not([hidden]) #b-result .b-head-card", { timeout: 30_000 });
    assert.match(await page.locator("#b-run-banner .saved-run").innerText(), /^Saved run[\s\S]*Same settings as the panel\./);
    await page.waitForFunction(() => document.querySelector("#b-changes")?.textContent === "No changes since the last build", undefined, { timeout: 10_000 });
    assert.equal(await page.getAttribute("#b-tpl", "data-value"), "builtin:caster", "the header names the card's template");
    assert.match(await page.locator("#b-tpl-state").innerText(), /equal the Caster template/);
    assert.match(await page.locator("#b-myruns .b-run-row.current").innerText(), /First saved run/);
    await page.click("#b-runs-open");
    assert.equal(await page.locator("#b-runs-new").isEnabled(), true, "New build in the Saved runs drawer too");
    await page.keyboard.press("Escape");
    await refreshScans();
    assert.match(await page.locator("#b-result h2").first().innerText(), /^Best suit for Dorran/, "an opened run stays through a scans refresh");
    assert.match(await page.locator("#b-run-banner .saved-run").innerText(), /Same settings as the panel\./);
    await page.click("#b-new-build");
    await page.waitForSelector("#b-start", { timeout: 10_000 });
    assert.equal(await page.locator(".saved-run").count(), 0, "the run's banner goes with it");

    // the other character's card opens Dorran's run from Kestrel
    await pickCharacter(page, "Kestrel");
    await page.locator("#b-other-runs .b-run-row").first().click();
    await page.waitForFunction(() => /^Best suit for Dorran/.test(document.querySelector("#b-result h2")?.textContent || ""), undefined, { timeout: 10_000 });
    assert.equal(await page.getAttribute("#b-char", "data-value"), "Dorran");

    // a scan newer than the run: the banner says the gear changed, and Build again builds
    const scan = readFileSync(join(ROOT, "app", "fixtures", "demo-Kestrel.json"), "utf8"), now = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 19);
    assert.ok(scan.includes('"scannedAt": "2026-01-01T12:00:00"'));
    writeFileSync(join(dataDir, "scans", "demo-Kestrel-newer.json"), scan.replace('"scannedAt": "2026-01-01T12:00:00"', `"scannedAt": "${now}"`));
    await refreshScans();
    const banner = page.locator("#b-run-banner .saved-run");
    await page.waitForFunction(() => /Your gear changed since: newer scans came in\./.test(document.querySelector("#b-run-banner .saved-run")?.textContent || ""), undefined, { timeout: 10_000 });
    assert.match(await banner.innerText(), /^This is your build from /);
    // and coming back after a reload says it too
    await page.reload();
    await page.waitForFunction(() => /Your gear changed since: newer scans came in\./.test(document.querySelector("#b-run-banner .saved-run")?.textContent || ""), undefined, { timeout: 30_000 });
    // Build again builds the run's settings, not the panel's: a time budget changed since is put back
    await settings(page, "advanced");
    await page.fill("#b-budget", "3");
    await closeSettings(page);
    await refreshScans();
    await page.waitForFunction(() => /and 1 setting changed/.test(document.querySelector("#b-run-banner .saved-run")?.textContent || ""), undefined, { timeout: 10_000 });
    const again = page.waitForRequest((r) => r.method() === "POST" && new URL(r.url()).pathname === "/api/optimize", { timeout: 10_000 });
    await banner.getByRole("button", { name: /Build again/ }).click();
    const sent = JSON.parse((await again).postData() || "{}") as { meta?: { settings?: { budgetMs?: number } } };
    assert.equal(sent.meta?.settings?.budgetMs, 2000, "the run's time budget");
    await built(page);
    assert.deepEqual(errors, []);
  } finally {
    await app.close();
    removeTempDir(dataDir);
  }
});

// Issue #291: a run reopened after newer scans moved its pieces lists what changed and marks the Plan. Of Dorran's suit, one
// piece the build swaps in is gone (its Grab goes with it), one is in the other character's container, one is worn by
// Kestrel, and a copy of the gone one is a new piece in the pool.
test("[slow] gear changed since a run: the banner lists the changes, the Plan marks the pieces, no sideways scroll at 420", async (t) => {
  const why = unavailable();
  if (why) return t.skip(why);
  const dataDir = seedDataDir("packrat-ui-gear-");
  const { app, page, errors } = await launch(dataDir);
  try {
    await openBuilder(page);
    await page.click("#b-start-build");
    await built(page);
    const res = await page.evaluate(async (url) => (await import(url)).session.result, "/ui/builder-session.mjs") as { best: Record<string, { serial: number } | null>; perSlotChanges: Array<{ slot: string; toSerial: number }> };
    const swap = res.perSlotChanges.find((c) => c.toSerial)!;
    assert.ok(swap, "the build swaps in a piece from a container");
    const [inBox, onKestrel] = Object.values(res.best).flatMap((p) => (p && p.serial !== swap.toSerial ? [p.serial] : []));
    assert.ok(inBox && onKestrel, "the suit has two more pieces");
    const slotOf = (serial: number): string => Object.entries(res.best).find(([, p]) => p?.serial === serial)![0];
    const labels = await page.evaluate(async ({ url, slots }) => { const { slotLabel } = await import(url); return slots.map((s) => slotLabel(s) as string); }, { url: "/ui/dom.mjs", slots: [swap.slot, slotOf(inBox), slotOf(onKestrel)] }) as [string, string, string];
    const show = page.locator("#b-result").getByRole("switch", { name: "Show unchanged slots" });
    if (!await show.isChecked()) await show.check();
    const row = (label: string): Locator => page.locator(".b-plan tbody tr").filter({ has: page.locator("td:first-child", { hasText: new RegExp(`^${label}$`) }) });
    assert.equal(await row(labels[0]).getByRole("button", { name: /^Grab / }).count(), 1, "the swapped-in piece can be grabbed");

    // newer scans: the swapped-in piece gone, another piece in the other character's container, a third worn by Kestrel, a copy of the first new
    type Entry = { serial: number; name: string; container?: number };
    type Scan = { scannedAt: string; equipped: Entry[]; items: Entry[]; roots: Array<{ serial: number }> };
    const scans: Record<string, Scan> = Object.fromEntries(["Dorran", "Kestrel"].map((c) => [c, JSON.parse(readFileSync(join(dataDir, "scans", `demo-${c}.json`), "utf8")) as Scan]));
    const take = (serial: number): [Entry, string] => {
      for (const [c, s] of Object.entries(scans)) for (const list of [s.equipped, s.items]) { const i = list.findIndex((e) => e.serial === serial); if (i >= 0) return [list.splice(i, 1)[0]!, c]; }
      throw new Error(`no piece ${serial} in the scans`);
    };
    const [gone] = take(swap.toSerial), [boxed, from] = take(inBox), [worn] = take(onKestrel);
    const to = from === "Kestrel" ? "Dorran" : "Kestrel";
    scans[to]!.items.push({ ...boxed, container: scans[to]!.roots[0]!.serial });
    delete worn.container;
    scans.Kestrel!.equipped.push(worn);
    scans.Dorran!.items.push({ ...gone, serial: 1879999999, container: scans.Dorran!.roots[0]!.serial });
    const now = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 19);
    for (const [c, s] of Object.entries(scans)) writeFileSync(join(dataDir, "scans", `demo-${c}-newer.json`), JSON.stringify({ ...s, scannedAt: now }));
    await page.reload();
    await page.waitForFunction(() => /is no longer in the scans/.test(document.querySelector("#b-run-banner .saved-run")?.textContent || ""), undefined, { timeout: 30_000 });
    const lines = await page.locator("#b-run-banner .b-gear-lines li").allInnerTexts();
    assert.equal(lines.length, 4, lines.join(" | "));
    assert.match(lines[0]!, /^1 new piece you could use in Metal Chest/);
    assert.deepEqual(lines.slice(1).map((l) => l.replace(/Metal Chest.*$/, "Metal Chest")).sort(), [`${boxed.name} is now in Metal Chest`, `${worn.name} is now worn by Kestrel`, `${gone.name} is no longer in the scans`].sort());
    assert.match(await page.locator("#b-run-banner .saved-run").innerText(), /Build again/);

    if (!await show.isChecked()) await show.check();
    assert.match(await row(labels[0]).innerText(), /No longer in the scans/);
    assert.equal(await row(labels[0]).getByRole("button", { name: /^Grab / }).count(), 0, "nothing to grab for a piece that is gone");
    assert.match(await row(labels[1]).innerText(), /Now in Metal Chest/);
    assert.match(await row(labels[2]).innerText(), /Now worn by Kestrel/);
    // a later scan puts the gone piece in Dorran's container: the banner and the Plan both follow it, Grab back
    const later = new Date(Date.now() + 2000 - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 19);
    scans.Dorran!.items.push({ ...gone, container: scans.Dorran!.roots[0]!.serial });
    writeFileSync(join(dataDir, "scans", "demo-Dorran-later.json"), JSON.stringify({ ...scans.Dorran, scannedAt: later }));
    await page.evaluate(async (url) => { await (await import(url)).reload(); }, "/ui/inventory-data.mjs");
    await page.waitForFunction(() => !/is no longer in the scans/.test(document.querySelector("#b-run-banner .saved-run")?.textContent || ""), undefined, { timeout: 10_000 });
    await page.waitForFunction(() => !/No longer in the scans/.test(document.querySelector(".b-plan")?.textContent || ""), undefined, { timeout: 10_000 });
    assert.match(await row(labels[0]).innerText(), /Now in Metal Chest/);
    assert.equal(await row(labels[0]).getByRole("button", { name: /^Grab / }).count(), 1);
    await fitWindow(app, page, { width: 420, height: 900 });
    const fits = await page.waitForFunction(() => document.documentElement.scrollWidth - document.documentElement.clientWidth <= 0, undefined, { timeout: 5_000 }).then(() => true, () => false);
    assert.ok(fits, `no sideways scroll at 420: ${await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth, ...[...document.querySelectorAll("body *")].filter((e) => e.getBoundingClientRect().right > innerWidth + 0.5).slice(0, 5).map((e) => `${e.tagName}.${e.className}#${e.id}`)].join(" "))}`);
    // narrow, the Plan has no Where column: the mark shows under the piece's name
    assert.equal(await row(labels[2]).locator(".b-mark-narrow").innerText(), "Now worn by Kestrel");
    assert.deepEqual(errors, []);
  } finally {
    await app.close();
    removeTempDir(dataDir);
  }
});

// Issue #272 part 4, fix round 2: a template card asks before it replaces settings there is something to lose in (Kestrel's
// tuned and saved weights): Cancel leaves the saved profile as it was on disk, Replace saves the card's template. And a runs
// list refreshed right as a character is switched to never leaves the builder blank.
test("[slow] arriving: a card asks before replacing tuned settings, and a list refresh during a switch still lands", async (t) => {
  const why = unavailable();
  if (why) return t.skip(why);
  const dataDir = seedDataDir("packrat-ui-arrive2-");
  const { app, page, errors } = await launch(dataDir);
  try {
    await openBuilder(page);
    await pickCharacter(page, "Kestrel");
    await page.waitForFunction(() => document.querySelector("#b-start h2")?.textContent === "What should Kestrel's suit be for?", undefined, { timeout: 10_000 });
    await settings(page, "weights");
    const weight = page.locator("#b-sec-weights .rule-row input[type=number]").first();
    await weight.fill(String(Number(await weight.inputValue()) + 5));
    await page.click("#b-save");
    await page.waitForFunction(() => /Profile for Kestrel saved/.test(document.body.textContent || ""), undefined, { timeout: 10_000 });
    await closeSettings(page);
    const saved = (): string => readFileSync(join(dataDir, "profiles.json"), "utf8");
    const before = saved();
    const archer = page.locator("#b-start .b-tpl-card").filter({ hasText: "Archer" }).first();
    await archer.click();
    const dialog = page.locator("dialog.dialog[open]");
    await dialog.waitFor({ timeout: 10_000 });
    assert.match(await dialog.innerText(), /Replace Kestrel's saved settings with Archer\?[\s\S]*only kept in runs built with them/);
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await dialog.waitFor({ state: "detached", timeout: 10_000 }).catch(() => dialog.waitFor({ state: "hidden", timeout: 10_000 }));
    await page.waitForTimeout(300);
    assert.equal(saved(), before, "Cancel leaves the saved profile alone");
    assert.equal(await page.getAttribute("#b-tpl", "data-value"), "builtin:melee");
    await archer.click();
    await dialog.getByRole("button", { name: "Replace" }).click();
    await page.waitForFunction(() => /Archer saved as Kestrel's settings/.test(document.body.textContent || ""), undefined, { timeout: 10_000 });
    assert.equal((JSON.parse(saved()) as { characters: Record<string, { template?: string }> }).characters.Kestrel!.template, "builtin:archer", "Replace saves the card's template");

    // a plain list refresh right after a switch: the first-visit view still comes up
    await pickCharacter(page, "Dorran");
    await page.evaluate(async (url) => { void (await import(url)).loadRuns(); }, "/ui/runs.mjs");
    await page.waitForSelector("#b-result #b-start, #b-result .b-head-card", { timeout: 10_000 });
    assert.deepEqual(errors, []);
  } finally {
    await app.close();
    removeTempDir(dataDir);
  }
});

// Issue #321: the sentence bar. Both pickers work by keyboard alone: typing filters (the match marked), ↓ ↑ and ↵ pick, Esc
// closes with the focus back on the button. The build picker's line says in words how the settings stand: unsaved changes,
// then, saved, the settings changed from the template, never a bare "modified". Its own group goes back to the saved build
// after a yes, and starting over from a built-in template asks first, as a template card does. At 420 px the sentence's words
// go, the pickers take the width and nothing scrolls sideways, the pickers' lists included.
test("[slow] the sentence bar: typeahead pickers by keyboard, the build's state in words, going back and starting over", async (t) => {
  const why = unavailable();
  if (why) return t.skip(why);
  const dataDir = seedDataDir("packrat-ui-header-");
  const { app, page, errors } = await launch(dataDir);
  try {
    await openBuilder(page);
    const active = (): Promise<string | null | undefined> => page.evaluate(() => document.activeElement?.id || document.activeElement?.getAttribute("role"));
    const values = (): Promise<string[]> => page.$$eval(".pop [role=option]", (os) => os.map((o) => (o as HTMLElement).dataset.value!));
    const highlighted = (): Promise<string | undefined> => page.evaluate(() => document.getElementById(document.querySelector(".pop [role=combobox]")?.getAttribute("aria-activedescendant") || "")?.dataset.value);
    const sub = (sel: string): Promise<string> => page.locator(`${sel} .cbx-sub`).innerText();
    const face = (want: RegExp): Promise<unknown> => page.waitForFunction((src) => new RegExp(src).test(document.querySelector("#b-tpl .cbx-sub")?.textContent || ""), want.source, { timeout: 10_000 });

    // The character picker: type to filter, ↵ picks, the focus back on the button.
    assert.equal(await page.getAttribute("#b-char", "aria-label"), "Character: Dorran");
    await page.focus("#b-char");
    await page.keyboard.press("Enter");
    await page.locator(".pop [role=combobox]").waitFor();
    assert.equal(await active(), "combobox", "the focus in the search box");
    assert.equal(await page.getAttribute("#b-char", "aria-expanded"), "true");
    assert.deepEqual(await page.$$eval(".pop .cbx-grp", (gs) => gs.map((g) => g.textContent)), ["Characters", "Without a character"]);
    await page.keyboard.type("kes");
    assert.deepEqual(await values(), ["Kestrel"]);
    assert.equal(await page.locator(".pop .cbx-hit").first().innerText(), "Kes", "the typed text is marked");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => document.querySelector("#b-char")?.getAttribute("data-value") === "Kestrel", undefined, { timeout: 10_000 });
    assert.equal(await active(), "b-char");
    await page.waitForFunction(() => document.querySelector("#b-start h2")?.textContent === "What should Kestrel's suit be for?", undefined, { timeout: 10_000 });
    // ↓ and ↑ from the current one (highlighted on opening), ↵ picks.
    await page.keyboard.press("Enter");
    assert.equal(await highlighted(), "Kestrel");
    await page.keyboard.press("ArrowDown");
    assert.equal(await highlighted(), "_nobody");
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowUp");
    assert.equal(await highlighted(), "Dorran");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => document.querySelector("#b-char")?.getAttribute("data-value") === "Dorran", undefined, { timeout: 10_000 });
    // Esc closes, the choice unchanged and the focus back on the button.
    await page.keyboard.press("Enter");
    await page.keyboard.type("zzz");
    assert.equal(await page.locator(".pop .cbx-empty").innerText(), "No character matches.");
    await page.keyboard.press("Escape");
    assert.equal(await page.locator(".pop").count(), 0);
    assert.equal(await active(), "b-char");
    assert.equal(await page.getAttribute("#b-char", "data-value"), "Dorran");
    assert.equal(await page.getAttribute("#b-char", "aria-expanded"), "false");

    // The build picker's line: clean, then an unsaved change, in words.
    assert.equal(await sub("#b-tpl"), "from template “Melee”");
    await settings(page, "requirements");
    const floor = page.locator("#b-sec-req .rule-row input[type=number]").first(), was = await floor.inputValue();
    await floor.fill(String(Number(was) + 1));
    await closeSettings(page);
    await face(/^from template “Melee” · 1 unsaved change$/);
    assert.match(await page.locator("#b-tpl-state").textContent() ?? "", /Changed from Melee: .+Not saved to Dorran's profile yet: .+/);
    assert.doesNotMatch(await page.locator("#b-topbar").innerText(), /modified/);
    // Its own group goes back to the saved build, after a yes.
    await page.focus("#b-tpl");
    await page.keyboard.press("Enter");
    assert.deepEqual(await page.$$eval(".pop .cbx-grp", (gs) => gs.map((g) => g.textContent)), ["Dorran's own", "Start over from a built-in template"]);
    await page.keyboard.type("dorran");
    assert.deepEqual(await values(), ["\u0000own", "\u0000saved"]);
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    const dialog = page.locator("dialog.dialog[open]");
    await dialog.waitFor({ timeout: 10_000 });
    assert.match(await dialog.innerText(), /Drop 1 unsaved change\?/);
    await dialog.getByRole("button", { name: "Drop changes" }).click();
    await face(/^from template “Melee”$/);
    await settings(page, "requirements");
    assert.equal(await floor.inputValue(), was, "the saved value is back");
    // Saved with a change: the line says what changed from the template.
    await floor.fill(String(Number(was) + 1));
    await page.click("#b-save");
    await page.waitForFunction(() => /Profile for Dorran saved/.test(document.body.textContent || ""), undefined, { timeout: 10_000 });
    await closeSettings(page);
    await face(/^from template “Melee”, with 1 setting changed$/);
    // Starting over from a built-in asks first, then it is the build's template, saved.
    await page.focus("#b-tpl");
    await page.keyboard.press("Enter");
    await page.keyboard.type("caster");
    await page.keyboard.press("Enter");
    await dialog.waitFor({ timeout: 10_000 });
    assert.match(await dialog.innerText(), /Replace Dorran's saved settings with Caster\?/);
    await dialog.getByRole("button", { name: "Replace" }).click();
    await page.waitForFunction(() => /Caster saved as Dorran's settings/.test(document.body.textContent || ""), undefined, { timeout: 10_000 });
    assert.equal(await page.getAttribute("#b-tpl", "data-value"), "builtin:caster");
    await face(/^from template “Caster”$/);

    // At phone width: the words go, each picker takes the width, Build Settings and Build share a row, no sideways scroll.
    await fitWindow(app, page, { width: 420, height: 900 });
    const sideways = (): Promise<number> => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.equal(await page.locator(".b-w-for").isVisible(), false);
    const top = (sel: string): Promise<number> => page.locator(sel).evaluate((n) => Math.round(n.getBoundingClientRect().top));
    assert.equal(await top("#b-settings"), await top("#b-run"));
    assert.ok(await top("#b-tpl") > await top("#b-char"), "the pickers on rows of their own");
    assert.ok(await sideways() <= 0, `no sideways scroll at 420: ${await sideways()}`);
    for (const pick of ["#b-char", "#b-tpl"]) {
      await page.click(pick);
      await page.locator(".pop [role=combobox]").waitFor();
      assert.ok(await sideways() <= 0, `no sideways scroll with ${pick}'s list open`);
      await page.keyboard.press("Escape");
    }
    await fitWindow(app, page, { width: 1440, height: 900 });
    assert.deepEqual(errors, []);
  } finally {
    await app.close();
    removeTempDir(dataDir);
  }
});

// Issue #336, part 1: the What changed chip beside the build picker, in place of its tooltip. With nothing changed it is
// hidden; an unsaved requirement shows a dot and "1 unsaved"; saved, it reads "1 change from **Melee** template". Its
// popover (a dialog) lists the changes by group with the template's value and this build's, an added requirement marked;
// the unsaved edits come first; Esc closes it onto the chip; a row opens Build Settings on that setting; Reset to “Melee”…
// asks first and leaves nothing changed. No sideways scroll at 420 with it open.
test("[slow] the What changed chip and its popover: unsaved first, by group, a row opens its setting, Reset asks", async (t) => {
  const why = unavailable();
  if (why) return t.skip(why);
  const dataDir = seedDataDir("packrat-ui-changes-");
  const { app, page, errors } = await launch(dataDir);
  try {
    await openBuilder(page);
    const chip = page.locator("#b-chg");
    assert.equal(await chip.isVisible(), false, "hidden with nothing changed");
    assert.equal(await page.evaluate(() => document.querySelector("#b-tpl")!.getAttribute("aria-describedby")), "b-tpl-state", "no tooltip describes the picker any more");
    // an added requirement, not saved yet
    await settings(page, "requirements");
    await page.click("#b-addfloor");
    await page.keyboard.type("Luck");
    await page.keyboard.press("Enter");
    await page.keyboard.type("300");
    await closeSettings(page);
    await page.waitForFunction(() => /unsaved/.test(document.querySelector("#b-chg")?.textContent || ""), undefined, { timeout: 10_000 });
    assert.match(await chip.innerText(), /1 change from Melee template[\s\S]*1 unsaved/);
    assert.equal(await chip.locator("strong").innerText(), "Melee", "the template's name in bold");
    await chip.click();
    const pop = page.getByRole("dialog", { name: "Changes from the Melee template" });
    await pop.waitFor();
    assert.equal(await chip.getAttribute("aria-expanded"), "true");
    assert.deepEqual((await pop.locator(".b-diff-h").allTextContents()), ["Not saved yet · 1", "Requirements · 1"], "unsaved first, then by group");
    assert.match(await pop.locator(".b-diff-head").innerText(), /1 change from Melee template\s+1 change not saved to Dorran's profile yet/);
    const luck = pop.locator(".b-diff").nth(1).locator("tr", { hasText: "Luck" });
    assert.deepEqual(await luck.locator("td").allInnerTexts(), ["Luck", "none", "→", "300"]);
    assert.match(await luck.locator("td").nth(3).getAttribute("class") ?? "", /b-diff-add/, "an added requirement is marked");
    await page.keyboard.press("Escape");
    assert.equal(await page.locator(".pop").count(), 0);
    assert.equal(await page.evaluate(() => document.activeElement?.id), "b-chg", "Esc gives the focus back to the chip");
    // Save profile: the dot goes, the change stays
    await settings(page, "requirements");
    await page.click("#b-save");
    await page.waitForFunction(() => /Profile for Dorran saved/.test(document.body.textContent || ""), undefined, { timeout: 10_000 });
    await closeSettings(page);
    await page.waitForFunction(() => !/unsaved/.test(document.querySelector("#b-chg")?.textContent || ""), undefined, { timeout: 10_000 });
    assert.equal((await chip.innerText()).trim(), "1 change from Melee template");
    // a row opens Build Settings on its setting
    await chip.click();
    await pop.locator("button", { hasText: "Luck" }).click();
    await page.locator("#b-drawer").waitFor();
    assert.equal(await page.evaluate(() => document.activeElement === document.querySelector('#b-sec-req .rule-row[data-key="luck"] input[type=number]')), true, "the focus on the Luck requirement");
    await page.keyboard.press("Escape");
    await page.locator("#b-drawer").waitFor({ state: "hidden" });
    assert.equal(await page.evaluate(() => document.activeElement?.id), "b-chg", "closing gives the focus back to the chip");
    // no sideways scroll at 420 with the popover open
    await fitWindow(app, page, { width: 420, height: 900 });
    await chip.click();
    await pop.waitFor();
    await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth, undefined, { timeout: 5_000 }).catch(() => {});
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "no sideways scroll at 420");
    // Reset to “Melee”… asks first, then nothing is changed
    await pop.getByRole("button", { name: "Reset to “Melee”…" }).click();
    const dialog = page.locator("dialog.dialog[open]");
    await dialog.waitFor({ timeout: 10_000 });
    assert.match(await dialog.innerText(), /Replace Dorran's saved settings with Melee\?/);
    await dialog.getByRole("button", { name: "Replace" }).click();
    await page.waitForFunction(() => (document.querySelector("#b-chg") as HTMLElement | null)?.hidden === true, undefined, { timeout: 10_000 });
    await fitWindow(app, page, { width: 1440, height: 900 });
    assert.deepEqual(errors, []);
  } finally {
    await app.close();
    removeTempDir(dataDir);
  }
});
