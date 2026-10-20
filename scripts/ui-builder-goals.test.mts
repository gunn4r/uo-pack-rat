// ui-builder-goals.test.mts — [slow]: the ranked goals, strict order, goals runs and the weight scale.
//
// `[slow]`: the Suit Builder's goals and weights in the real Electron window, on a writable `--data` directory seeded with the demo scans. Goals (issue #292): a template's ranked goals with what each counts, ↓ moving a rank and its counts, = linking a row, another spare-points choice counted as one change, How the goals went after a build, a weight edited under the fine-tune switch folding the goals until Start from goals again, no sideways scroll at 420 px, and a profile with no goals opening on its weights; Goals runs (issue #302): the first-visit summary listing the goals by rank under their names with "Spare points: Luck" on its own line, the run's banner naming its goals by those names, and a run reopened after a newer scan swaps the worn weapon keeping its Swing speed line, with no sideways scroll at 420 px. a weight row's weight row shows its importance and its hover follows the typed weight (the trade-off with the top property, or that it is the top one), and Set weight (a Luck weight that swamps the rest) edits the panel and the template badge, but not once the weight was changed since the build. Strict order: the strategy's subtitle, a strict build without trades, and fewest changes saved with the profile.
//
// Shared steps are in scripts/builder-ui.mts. Skipped when electron or playwright is absent, or under TEST_SKIP_ELECTRON.
import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fitWindow, pickCharacter, pickTemplate, sidewaysAt } from "./electron-window.mts";
import { ROOT, skipWithoutElectron, tempDataDir } from "./electron-app.mts";
import { built, closeSettings, launch, openBuilder, settings } from "./builder-ui.mts";

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
  if (skipWithoutElectron(t)) return;
  const dataDir = tempDataDir("packrat-ui-goals-", { demoScans: true });
  const pool = { lockedSlots: [], excludeTags: [], excludeSkills: [], excludeRoots: [], excludeWeapons: [], ubwsAnyWeapon: true, allowOthersWorn: false, allowGargoyle: false, medOnly: false, strLimit: "character" };
  writeFileSync(join(dataDir, "profiles.json"), JSON.stringify({ schemaVersion: 3, templates: {}, characters: { Kestrel: { race: "human", template: "builtin:melee",
    spec: { intent: { floors: {}, softFloors: [], weights: { dci: 10, luck: 1 }, floorBonus: 1000, resistCaps: {} }, buffs: { on: [], skills: {} }, pool } } } }));
  const { app, page, errors, close } = await launch(dataDir);
  try {
    await openBuilder(page);
    await pickCharacter(page, "Dorran");
    await page.waitForFunction(() => document.querySelector("#b-start h2")?.textContent === "What should Dorran's suit be for?", undefined, { timeout: 10_000 });
    await settings(page, "weights", { weights: false });
    await page.waitForSelector("#b-goals-h");
    assert.equal(await page.locator("#b-goals-h").innerText(), "What should this suit be best at?");
    const rows = (): Promise<string[]> => page.locator("#b-sec-goals .b-goal").evaluateAll((ls) => ls.map((l) => `${l.querySelector(".b-goal-name")!.textContent} ${l.querySelector(".b-goal-counts")!.textContent}`));
    assert.deepEqual(await rows(), ["1.Swing Speed Increase counts 100 · needs 17", "2.Hit Chance Increase counts 80 · max 45", "2.Defense Chance Increase counts 80 · max 45", "3.Damage Increase counts 65 · max 100"]);
    assert.equal(await page.locator("#b-sec-weights").isHidden(), true, "the weights stay out of sight");
    // ↓ moves Swing speed's rank under the linked pair, and the focus stays on the row's arrows
    await page.getByRole("button", { name: "Move Swing Speed Increase down", exact: true }).click();
    assert.deepEqual(await rows(), ["1.Hit Chance Increase counts 100 · max 45", "1.Defense Chance Increase counts 100 · max 45", "2.Swing Speed Increase counts 80 · needs 17", "3.Damage Increase counts 65 · max 100"]);
    assert.equal(await page.evaluate(() => document.activeElement?.closest(".b-goal")?.getAttribute("data-key")), "ssi");
    assert.equal(await page.getByRole("button", { name: "Move Hit Chance Increase and Defense Chance Increase down" }).count(), 2, "a linked rank's arrows name both, on both rows");
    await page.getByRole("button", { name: "Move Swing Speed Increase up", exact: true }).click();
    // "=" links Damage to the rank above
    const link = page.locator('.b-goal[data-key="di"] .pill');
    assert.equal(await link.getAttribute("aria-pressed"), "false");
    await link.click();
    assert.deepEqual(await rows(), ["1.Swing Speed Increase counts 100 · needs 17", "2.Hit Chance Increase counts 80 · max 45", "2.Defense Chance Increase counts 80 · max 45", "2.Damage Increase counts 80 · max 100"]);
    assert.equal(await page.locator('.b-goal[data-key="di"] .pill').getAttribute("aria-pressed"), "true");
    await page.locator('.b-goal[data-key="di"] .pill').click();
    assert.match(await page.locator("#b-tpl-state").innerText(), /equal the Melee template/, "back as the template had it");

    // a build, then another spare-points choice is one change
    await page.click("#b-run-foot");
    await built(page);
    const count = (want: string): Promise<unknown> => page.waitForFunction((w) => document.querySelector("#b-changes")?.textContent === w, want, { timeout: 10_000 });
    await count("No changes since the last build");
    const went = await page.locator("#b-goals-went").innerText();
    assert.match(went, /^How the goals went\n1\.\s*Swing Speed Increase\n[\d.]+ s with .+ · Swing Speed Increase \d+[\s\S]*3\.\s*Damage[\s\S]*Spare points(: none left over| went to: )/);
    assert.doesNotMatch(went, /as high as the gear allows|went to: \S+ −/, "no unproven verdict, and no loss as a destination");
    // built from goals, SSI counted per point is a note under the swing goal, not a warning in Check your settings
    assert.doesNotMatch(await page.locator(".b-head-card").innerText(), /Swing Speed Increase was scored per point/);
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
    await page.getByRole("button", { name: "Move Swing Speed Increase down", exact: true }).click();
    await count("1 change since the last build");
    const loadRun = async (): Promise<void> => {
      await closeSettings(page);
      await page.click("#b-runs-open");
      await page.locator("#b-runs .run-card button[aria-haspopup=menu]").first().click();
      await page.click('.pop-over-drawer [role="menuitem"]:has-text("Open")');
      await page.waitForSelector("#b-run-banner .saved-run, #b-run-banner .b-gear-changed", { timeout: 30_000 });   // a slow Windows runner took over 10 s (issue #330)
      await closeSettings(page);
      await page.locator("#b-run-banner").getByRole("button", { name: "Load these settings" }).click();
    };
    await loadRun();
    await settings(page, "weights", { weights: false });
    assert.deepEqual(await rows(), ["1.Swing Speed Increase counts 100 · needs 17", "2.Hit Chance Increase counts 80 · max 45", "2.Defense Chance Increase counts 80 · max 45", "3.Damage Increase counts 65 · max 100"], "the run's goals are back");
    await count("No changes since the last build");

    // at phone width the drawer fits without a sideways scroll
    const drawerOver = await sidewaysAt(app, page, { width: 420, height: 900 }, ["#b-drawer .b-drawer-body"]);
    assert.ok(drawerOver <= 0, `no sideways scroll: ${drawerOver}`);
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
    await close();
  }
});

// Issue #292 part 2, on the first character with Melee's goals: the strategy choice switches the Goals tab's subtitle, and in Strict
// order a goal row shows only its cap; a strict build's How the goals went says it made no trades and Solver details name
// the strategy; the fewest-changes checkbox and the strategy are saved with the profile across a reload; no sideways
// scroll at 420 px.
test("[slow] strict order: the strategy's subtitle, a strict build without trades, and fewest changes saved with the profile", async (t) => {
  if (skipWithoutElectron(t)) return;
  const dataDir = tempDataDir("packrat-ui-strict-", { demoScans: true });
  const { app, page, errors, close } = await launch(dataDir);
  const text = (sel: string, re: RegExp): Promise<unknown> => page.waitForFunction(([q, src]) => new RegExp(src!).test(document.querySelector(q!)?.textContent || ""), [sel, re.source], { timeout: 10_000 });
  const noSideways = async (what: string): Promise<void> => {
    const over = await sidewaysAt(app, page, { width: 420, height: 900 });
    assert.ok(over <= 0, `${what}: no sideways scroll at 420 (${over} px)`);
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
    await close();
  }
});

// Issue #302, on Dorran with Melee's goals: the first-visit "What matters most" lists the goals by rank under their names
// with the spare points on their own line (and fits at 420 px); a build with a swing time, then a goals change, and the run's
// banner names the run's goals by their names; a newer scan that swaps the worn weapon for a slower one under another name,
// and the reopened run's Swing speed line is the one the build showed, set for the weapon it was built with.
test("[slow] goals runs: the first-visit goals, the run line in goal names, and a reopened run keeping its swing goal's weapon", async (t) => {
  if (skipWithoutElectron(t)) return;
  const dataDir = tempDataDir("packrat-ui-goalruns-", { demoScans: true });
  const { app, page, errors, close } = await launch(dataDir);
  try {
    await openBuilder(page);
    await page.waitForFunction(() => /Melee will build for/.test(document.querySelector("#b-start .b-start-sum")?.textContent || ""), undefined, { timeout: 10_000 });
    const most = await page.locator("#b-start .b-start-sum .b-imps").innerText();
    assert.match(most, /^1\. Swing Speed Increase\s+100\s+2\. Hit Chance Increase = Defense Chance Increase\s+80\s+3\. Damage Increase\s+65$/);
    const sum = await page.locator("#b-start .b-start-sum").innerText();
    assert.match(sum, /Spare points: Luck\s+Goals in Auto Build Settings/);
    assert.doesNotMatch(sum, /more in Auto Build Settings/, "the spare points are no extra row");
    assert.ok(await sidewaysAt(app, page, { width: 420, height: 900 }) <= 0, "no sideways scroll at 420 on the first-visit view");
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
    assert.match(before, /^1\.\s*Swing Speed Increase\n/);

    // a goals change since: the run's banner names the run's goals by their names
    await settings(page, "weights", { weights: false });
    await page.getByRole("button", { name: "Move Swing Speed Increase down", exact: true }).click();
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
    assert.match(banner, /goals: Swing Speed Increase every [\d.]+ s › Hit Chance Increase = Defense Chance Increase › Damage Increase, spare points to luck/);
    assert.doesNotMatch(banner, /SSI|HCI|DCI/, "goal names, not abbreviations");
    assert.equal(await swingRow(), before, "the reopened run's Swing Speed Increase line is the build's");
    assert.doesNotMatch(await page.locator("#b-goals-went").innerText(), /Practice Staff/, "not the weapon worn now");
    assert.ok(await sidewaysAt(app, page, { width: 420, height: 900 }) <= 0, "no sideways scroll at 420 on the reopened run");
    assert.deepEqual(errors, []);
  } finally {
    await close();
  }
});

// Issues #217, #274: Kestrel's Melee weights with Luck at importance 2000, from a profile saved with Melee's weights before goals (issue #292: its goals' few weights leave the demo suit thin, so nothing would dominate). The Luck row shows the template's per-point 0.05 as importance 5.6, and its hover names the trade-off with the top weight until Luck becomes the top one; the build names Luck in "Check your settings" with Set Luck; a weight changed since the build leaves Set Luck doing nothing, and on a fresh build it sets the panel's weight and marks the template badge.
test("[slow] weight scale: the row shows importance with a trade-off hover, and Set weight edits the panel only while it holds the build's weight", async (t) => {
  if (skipWithoutElectron(t)) return;
  const dataDir = tempDataDir("packrat-ui-weights-", { demoScans: true });
  const pool = { lockedSlots: [], excludeTags: [], excludeSkills: [], excludeRoots: [], excludeWeapons: [], ubwsAnyWeapon: true, allowOthersWorn: false, allowGargoyle: false, medOnly: false, strLimit: "character" };
  const resists = (n: number): Record<string, number> => ({ physResist: n, fireResist: n, coldResist: n, poisonResist: n, energyResist: n });
  const weights = { ...resists(6), dci: 10, hci: 10, ssi: 5, di: 3, hpRegen: 4, dexBonus: 4, strBonus: 3, hpi: 3, stamRegen: 3, stamInc: 2, lmc: 1, luck: 0.05, tagPenalty: -25 };
  writeFileSync(join(dataDir, "profiles.json"), JSON.stringify({ schemaVersion: 3, templates: {}, characters: { Kestrel: { race: "human", template: "builtin:melee",
    spec: { intent: { floors: resists(65), softFloors: [], weights, floorBonus: 1000, resistCaps: {} }, buffs: { on: [], skills: {} }, pool } } } }));
  const { page, errors, close } = await launch(dataDir);
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
    await hover("^At these settings, 1 (Defense Chance Increase|Hit Chance Increase) is worth about 200 Luck\\.$");
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
    await hover("^At these settings, 1 (Defense Chance Increase|Hit Chance Increase) is worth about \\d+ Luck\\.$");
    assert.match(await page.locator("#b-tpl-state").innerText(), new RegExp(`Luck weight [\\d.]+ → ${to.replace(".", "\\.")}`), "the template badge names the change");
    assert.equal(await block.getByRole("button", { name: "Set ✓" }).isDisabled(), true);
    assert.deepEqual(errors, []);
  } finally {
    await close();
  }
});
