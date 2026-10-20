// ui-builder-settings.test.mts — [slow]: Auto Build Settings: its keys, tabs and scrim, Check your settings, the drawer's extras, swing steps, casting school, rarity and the STR limit.
//
// `[slow]`: the Suit Builder's Auto Build Settings drawer and its controls in the real Electron window, on a writable `--data` directory seeded with the demo scans. The Settings drawer (issue #272): ⌘, (Ctrl+,) and its button open it with the focus on its tab, Esc closes it onto the button, ← and → move between the tabs, each showing its own controls, a bad requirement opens it on Requirements when Build is pressed, its footer counts the settings changed since the shown run (none, then one after a weight edit), and its tab is remembered across a reload; Auto Build Settings (issue #320) is the shared modal drawer: a click away on the scrim closes it with the focus back on its button, and a click in a popover opened from it does not. Check your settings (issue #217): a hard Luck requirement no suit reaches is named with the best possible above the progress panel and in the result, and Lower and Make soft edit the panel's floor and the template badge without starting a build; The drawer's extras (issue #272): a weight's notched slider steps by 5 with its field following and never resizes another row, a value past 100 tagged, ± in the warn tone; the buffs by school with the character's skill, castable ones first and the rest greyed with their need; each requirement's status from the last build; no sideways scroll at 420 px. a switch's on track is at least 3:1 against its off track, with the knob moved right, in Default and Britannia, light and dark; STR limit is beside Race under Advanced, and a bad value there opens the drawer on it; Casting school (issue #213): the Faster Casting cap and its source beside the select, raised to 4 by naming Chivalry, which marks the template changed, and on a new FC requirement row that starts at the cap. Rarity (issue #262): Lower marks the template changed and shows a help line, the result's Solver details carry the Rarity row with the rarity total, Save profile keeps it, and applying a template without one clears it. Swing steps (issue #217), with Kestrel's worn weapon made the pool's best: the SSI weight's switch shows the worn weapon's steps and marks the template changed; the result says SSI was scored per point with Lock Weapon (1H) and shows the swing line, Next step follows the result's swing (none before the build); Lock starts no build and the next build scores by step; the switch is kept in the saved run's settings and by Save profile across a reload.
//
// Shared steps are in scripts/builder-ui.mts. Skipped when electron or playwright is absent, or under TEST_SKIP_ELECTRON.
import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fitWindow, pickCharacter, pickTemplate, settle, sideways, animationsDone } from "./electron-window.mts";
import { skipWithoutElectron, tempDataDir, until } from "./electron-app.mts";
import { built, closeSettings, launch, openBuilder, pressBuild, settings } from "./builder-ui.mts";
import type { Locator } from "playwright";

// Issue #272: the Settings drawer. ⌘, (Ctrl+,) and the Settings button open it with the focus on its tab, Esc closes it with
// the focus back on the button, ← and → move between the tabs and each shows its own controls, a bad requirement opens it
// on Requirements when Build is pressed, its footer counts the settings changed since the shown run, and its tab is
// remembered across a reload. Round 1 of review: Esc from anywhere, ⌘, over a popover, focus after a drawer build, the
// count following the runs drawer's diff and every knob, and the top bar at 1366 and 1024.
test("[slow] the Settings drawer: ⌘, and its button, Esc, the tabs, an error's tab, the changes count, the remembered tab", async (t) => {
  if (skipWithoutElectron(t)) return;
  const dataDir = tempDataDir("packrat-ui-drawer-", { demoScans: true });
  const { app, page, errors, close } = await launch(dataDir);
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
    // closes both, the focus back on Auto Build Settings.
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
    assert.ok(await until(tabSaved, (v) => v, "the tab in ui-prefs.json"), "the tab is in ui-prefs.json");
    await page.reload();
    await page.waitForSelector("#tab-builder:not([hidden]) #b-result .b-head-card", { timeout: 30_000 });   // coming back: the latest run
    assert.equal(await drawer.isHidden(), true, "closed after a reload");
    await page.click("#b-settings");
    assert.equal(await page.getAttribute("#b-tab-weights", "aria-selected"), "true", "open on the tab it was left on");

    // The sentence bar (issue #321): one line at 1366 (where the screen allows that width), Saved runs on the quieter row
    // under it; at 1024 the pickers wrap and Auto Build Settings and Build stay one group at the right of its row.
    const top = (sel: string): Promise<number> => page.locator(sel).evaluate((n) => Math.round(n.getBoundingClientRect().top));
    const tops = (...sels: string[]): Promise<number[]> => Promise.all(sels.map(top));
    if ((await fitWindow(app, page, { width: 1366, height: 900 })).width === 1366) {
      const [run, tpl, char] = await settle(() => tops("#b-run", "#b-tpl", "#b-char"), ([r, t, c]) => r === c && t === c);
      assert.equal(run, char, "one line at 1366");
      assert.equal(tpl, char);
    }
    assert.ok(await top("#b-runs-open") > await top("#b-run"), "Saved runs on the second row");
    await fitWindow(app, page, { width: 1024, height: 768 });
    const [settingsTop, runTop] = await settle(() => tops("#b-settings", "#b-run"), ([s, r]) => s === r);
    assert.equal(settingsTop, runTop);
    const bar = (await settle(async () => (await page.locator("#b-topbar").boundingBox())!, (b) => b.height < 170)), run = (await page.locator("#b-run").boundingBox())!;
    assert.ok(bar.x + bar.width - (run.x + run.width) < 40, "Build at the bar's right end");
    assert.ok(bar.height < 170, `the pickers wrap once at most, got ${bar.height}`);
    assert.deepEqual(errors, []);
  } finally {
    await close();
  }
});

// Issue #217: a hard requirement no suit reaches (Luck 100000) is named with the best possible above the progress panel while the build runs, then in the result's "Check your settings"; Lower and Make soft edit the panel and the template badge, turn into their done state and never start a build.
test("[slow] Check your settings: the block shows before and after the build, and Lower and Make soft edit the panel", async (t) => {
  if (skipWithoutElectron(t)) return;
  const dataDir = tempDataDir("packrat-ui-checks-", { demoScans: true });
  const { page, errors, close } = await launch(dataDir);
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
    await close();
  }
});

// Issue #272 part 3, the Settings drawer's extras on Kestrel given Chivalry 68.2 and Bushido 74 in her scan: a weight's slider moves in steps of 5 from the arrow keys with the number field following and its aria-valuetext the signed weight, the trade-off under the list following it, and another row's bar staying as it was; a typed 178 fills the bar and tags it "▸178", a typed 12.5 is kept; ± flips the sign and the bar takes the warn style. Buffs are listed by school with Kestrel's skill, only the castable ones until Show all, which adds Necromancy's forms greyed with what they need. After a build each requirement says what it came to. At 420 px the drawer never scrolls the page sideways.
test("[slow] drawer extras: notched weight sliders, buffs by school, each requirement's last-build status, no sideways scroll at 420", async (t) => {
  if (skipWithoutElectron(t)) return;
  const dataDir = tempDataDir("packrat-ui-extras-", { demoScans: true });
  const scan = join(dataDir, "scans", "demo-Kestrel.json"), raw = readFileSync(scan, "utf8");
  assert.ok(raw.includes('"skills": {},'));
  writeFileSync(scan, raw.replace('"skills": {},', '"skills": { "Chivalry": { "base": 68.2, "value": 68.2, "cap": 100 }, "Bushido": { "base": 74, "value": 74, "cap": 100 }, "Necromancy": { "base": 50, "value": 50, "cap": 100 } },'));
  const { app, page, errors, close } = await launch(dataDir);
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
    await animationsDone(page);   // the button's color transition
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
    for (const [q, v] of [["Swing Speed Increase", "30"], ["Defense Chance Increase", "45"]] as const) {
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
      assert.ok(await sideways(page) <= 0, `no sideways scroll on ${tab} at 420`);
    }
    assert.deepEqual(errors, []);
  } finally {
    await close();
  }
});

// Issue #217 (swing steps), on Kestrel with her worn War Axe made the best weapon in the pool (strong properties, Swordsmanship), so the result holds the worn weapon: the SSI weight row's switch, on from Melee's Swing speed goal (issue #292) with the worn weapon's steps under it, marks the template changed when turned off; the build says SSI was scored per point (the pool holds weapons of several speeds) and offers Lock Weapon (1H), shows the swing line, and Next step follows the result's swing (none before the build); Lock edits the panel without a build, and the next build scores by step with no warning; the switch is kept in the saved run's settings and by Save profile across a reload.
test("[slow] swing steps: the switch, the swing line, Next step from the result, Lock, and the switch saved with the run and the profile", async (t) => {
  if (skipWithoutElectron(t)) return;
  const dataDir = tempDataDir("packrat-ui-swing-", { demoScans: true });
  const scanFile = join(dataDir, "scans", "demo-Kestrel.json"), scan = JSON.parse(readFileSync(scanFile, "utf8")) as { equipped: Array<{ name: string; tooltip: string[] }> };
  const axe = scan.equipped.find((i) => i.name === "War Axe")!;
  axe.tooltip = [...axe.tooltip.filter((l) => !/^(Antique|Defense Chance Increase|Swing Speed Increase|Skill Required)/.test(l)), "Skill Required: Swordsmanship", "Hit Chance Increase 45%", "Defense Chance Increase 45%",
    "Damage Increase 100%", "Hit Point Increase 25", "Dexterity Bonus 25", "Strength Bonus 25", "Physical Resist 20%", "Fire Resist 20%", "Cold Resist 20%", "Poison Resist 20%", "Energy Resist 20%"];
  writeFileSync(scanFile, JSON.stringify(scan));
  const { page, errors, close } = await launch(dataDir);
  try {
    await openBuilder(page);
    await pickCharacter(page, "Kestrel");
    await page.waitForFunction(() => document.querySelector("#b-tpl")?.getAttribute("data-value") === "builtin:melee", undefined, { timeout: 10_000 });
    await settings(page, "weights");
    const sw = page.locator("#b-swing-steps");
    await sw.waitFor({ timeout: 10_000 });
    assert.equal(await sw.isChecked(), true, "Melee's Swing Speed Increase goal scores SSI by step");
    assert.match(String(await page.locator("#b-sec-weights .b-swing-set").textContent()), /Counts Swing Speed Increase only where the swing gets faster\. War Axe 3 s at stamina \d+: .+ ≥ \d+/);
    await sw.uncheck();
    assert.match(await page.locator("#b-tpl-state").innerText(), /Swing Speed Increase by point/);
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
    assert.match(await read(".b-head-card .b-check"), /Swing Speed Increase was scored per point: the pool holds weapons with \d+ different speeds\. Lock the weapon slot to score swing speed by step\./);
    const line = await read(".b-head-card .b-swing");
    assert.match(line, /^War Axe 3 s · stamina \d+ · Swing Speed Increase \d+ → swings every [\d.]+ s/);
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
    assert.match(await read(".b-head-card .b-swing"), /^War Axe 3 s · stamina \d+ · Swing Speed Increase \d+ → swings every [\d.]+ s/);
    // the saved run keeps the switch (the server writes it as the build finishes: wait for the file)
    const kept = (): boolean => existsSync(join(dataDir, "runs")) && readdirSync(join(dataDir, "runs")).filter((f: string) => f.endsWith(".json"))
      .some((f: string) => (JSON.parse(readFileSync(join(dataDir, "runs", f), "utf8")) as { settings?: { swingSteps?: boolean } }).settings?.swingSteps === true);
    assert.ok(await until(kept, (v) => v, "the switch in the saved run"), "the saved run keeps the switch");
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
    await close();
  }
});

// Issue #213: the demo characters have no casting skills, so the Faster Casting cap starts at 2 and says why; naming Chivalry under Advanced raises it to 4, marks the template changed, and an FC requirement added then starts at 4 with the cap's source on its row.
test("[slow] casting school: the FC cap's source beside the select and on the FC requirement row", async (t) => {
  if (skipWithoutElectron(t)) return;
  const dataDir = tempDataDir("packrat-ui-fccap-", { demoScans: true });
  const { page, errors, close } = await launch(dataDir);
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
    await close();
  }
});

// Issue #262: Rarity in the Pool tab: Lower marks the template changed and shows a help line; the build's
// Solver details carry the Rarity row with the rarity total; Save profile keeps it across a reload; and applying a
// template that has no preference clears it. Every read polls, so a later redraw cannot race it.
test("[slow] rarity preference: the segmented control, its help line, the result's Rarity row, Save profile and template Apply", async (t) => {
  if (skipWithoutElectron(t)) return;
  const dataDir = tempDataDir("packrat-ui-rarity-", { demoScans: true });
  const { page, errors, close } = await launch(dataDir);
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
    await close();
  }
});

test("[slow] STR limit sits beside Race under Advanced, and a bad value opens the drawer there", async (t) => {
  if (skipWithoutElectron(t)) return;
  const dataDir = tempDataDir("packrat-ui-strlimit-", { demoScans: true });
  const { page, errors, close } = await launch(dataDir);
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
    await close();
  }
});

// A switch's off and on states read apart at a glance: the on track's fill is at least 3:1 against the off
// track's (hollow, the surface's own colour), and the knob moves from left to right.
test("[slow] a switch's on state stands apart from its off state in each theme and mode", async (t) => {
  if (skipWithoutElectron(t)) return;
  const dataDir = tempDataDir("packrat-ui-switch-", { demoScans: true });
  const { page, errors, close } = await launch(dataDir);
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
    await close();
  }
});
