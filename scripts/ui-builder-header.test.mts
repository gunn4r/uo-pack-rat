// ui-builder-header.test.mts — [slow]: the sentence bar's pickers, ⌘↵, arriving on the screen, the gear-changed banner and the What changed chip.
//
// `[slow]`: the Suit Builder's header, arriving and what changed, in the real Electron window, on a writable `--data` directory seeded with the demo scans. ⌘↵ (Ctrl+Enter) builds with focus on the page body and while typing in a field in the drawer, and does nothing behind the Saved runs drawer; Arriving (issue #272): the first-visit view's four template cards, summary and Build, a card applying its template and saving it as the character's settings without any card moving, a result staying put through a scans refresh and a character switch and back, a reload with nothing changed coming back to the latest run with no settings changed and staying through a scans refresh, New build, another character's run opened from the first-visit view, and a newer scan's gear-changed banner (live and after a reload) whose Build again builds the run's settings. A card asks before it replaces tuned, saved settings (Cancel leaves the saved profile on disk as it was, Replace saves the card's template), and a runs list refreshed right after a character switch still lets the first-visit view or a run come up. What changed in the gear (issue #291): a run reopened after newer scans lists a new piece, a piece of the suit moved into another container, one now worn by Kestrel and one gone, and the Plan marks them ("Now in", "Now worn by Kestrel", "No longer in the scans" with no Grab), a later scan putting the gone piece back updating the banner and the Plan together, the mark under the name at 420 px with no sideways scroll. The sentence bar (issue #321): both pickers by keyboard alone (typing filters and marks the match, ↓ ↑ and ↵ pick, Esc closes onto the button), the build's state in words (unsaved changes, then settings changed from the template, never "modified"), going back to the saved build and starting over from a built-in after a yes, and at 420 px the words gone, the pickers full width and no sideways scroll, their lists open included. What changed (issue #336): the chip beside the build picker, hidden with nothing changed, "1 unsaved" with a dot, "1 change from **Melee** template" once saved; its popover with the unsaved edits first and the changes by group, an added requirement marked, Esc back onto the chip, a row opening Build Settings on its setting, Reset asking first, and no sideways scroll at 420.
//
// Shared steps are in scripts/builder-ui.mts. Skipped when electron or playwright is absent, or under TEST_SKIP_ELECTRON.
import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fitWindow, pickCharacter, settle, sideways, sidewaysAt } from "./electron-window.mts";
import { ROOT, skipWithoutElectron, tempDataDir } from "./electron-app.mts";
import { built, closeSettings, launch, openBuilder, settings } from "./builder-ui.mts";
import type { Locator } from "playwright";

test("[slow] ⌘↵ builds from anywhere on the Builder screen, and not from behind a drawer", async (t) => {
  if (skipWithoutElectron(t)) return;
  const dataDir = tempDataDir("packrat-ui-buildkey-", { demoScans: true });
  const { page, errors, close } = await launch(dataDir);
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
    await page.waitForTimeout(500);   // sleep: proves no build starts behind the drawer, which no event can show
    assert.equal(await page.locator("#b-run").isDisabled(), false, "no build started behind the drawer");
    assert.equal(starts, 2);
    assert.deepEqual(errors, []);
  } finally {
    await close();
  }
});

// Issue #272 part 4, arriving: a fresh data folder shows Dorran's first-visit view (template cards, the summary, Build) with
// no sideways scroll at 420; a card applies its template in the top bar and Build shows a result, which stays put through a
// scans refresh; Kestrel shows her own first-visit view with Dorran's run under "Other characters' recent runs", and back
// on Dorran his last run opens again. A reload comes back to the run, New build returns to the first-visit view, the other
// character's card opens Dorran's run again, and a newer scan puts up the gear-changed banner whose Build again builds.
test("[slow] arriving: the first-visit view, coming back to the latest run, other characters' runs, New build, the gear-changed banner", async (t) => {
  if (skipWithoutElectron(t)) return;
  const dataDir = tempDataDir("packrat-ui-arrive-", { demoScans: true });
  const { app, page, errors, close } = await launch(dataDir);
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
    const fits = await sidewaysAt(app, page, { width: 420, height: 900 }) <= 0;
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
    await close();
  }
});

// Issue #291: a run reopened after newer scans moved its pieces lists what changed and marks the Plan. Of Dorran's suit, one
// piece the build swaps in is gone (its Grab goes with it), one is in the other character's container, one is worn by
// Kestrel, and a copy of the gone one is a new piece in the pool.
test("[slow] gear changed since a run: the banner lists the changes, the Plan marks the pieces, no sideways scroll at 420", async (t) => {
  if (skipWithoutElectron(t)) return;
  const dataDir = tempDataDir("packrat-ui-gear-", { demoScans: true });
  const { app, page, errors, close } = await launch(dataDir);
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
    const fits = await sidewaysAt(app, page, { width: 420, height: 900 }) <= 0;
    assert.ok(fits, `no sideways scroll at 420: ${await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth, ...[...document.querySelectorAll("body *")].filter((e) => e.getBoundingClientRect().right > innerWidth + 0.5).slice(0, 5).map((e) => `${e.tagName}.${e.className}#${e.id}`)].join(" "))}`);
    // narrow, the Plan has no Where column: the mark shows under the piece's name
    assert.equal(await row(labels[2]).locator(".b-mark-narrow").innerText(), "Now worn by Kestrel");
    assert.deepEqual(errors, []);
  } finally {
    await close();
  }
});

// Issue #272 part 4, fix round 2: a template card asks before it replaces settings there is something to lose in (Kestrel's
// tuned and saved weights): Cancel leaves the saved profile as it was on disk, Replace saves the card's template. And a runs
// list refreshed right as a character is switched to never leaves the builder blank.
test("[slow] arriving: a card asks before replacing tuned settings, and a list refresh during a switch still lands", async (t) => {
  if (skipWithoutElectron(t)) return;
  const dataDir = tempDataDir("packrat-ui-arrive2-", { demoScans: true });
  const { page, errors, close } = await launch(dataDir);
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
    await page.waitForTimeout(300);   // sleep: proves Cancel writes nothing, which no event can show
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
    await close();
  }
});

// Issue #321: the sentence bar. Both pickers work by keyboard alone: typing filters (the match marked), ↓ ↑ and ↵ pick, Esc
// closes with the focus back on the button. The build picker's line says in words how the settings stand: unsaved changes,
// then, saved, the settings changed from the template, never a bare "modified". Its own group goes back to the saved build
// after a yes, and starting over from a built-in template asks first, as a template card does. At 420 px the sentence's words
// go, the pickers take the width and nothing scrolls sideways, the pickers' lists included.
test("[slow] the sentence bar: typeahead pickers by keyboard, the build's state in words, going back and starting over", async (t) => {
  if (skipWithoutElectron(t)) return;
  const dataDir = tempDataDir("packrat-ui-header-", { demoScans: true });
  const { app, page, errors, close } = await launch(dataDir);
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
    const narrow = await sidewaysAt(app, page, { width: 420, height: 900 });
    assert.equal(await page.locator(".b-w-for").isVisible(), false);
    const top = (sel: string): Promise<number> => page.locator(sel).evaluate((n) => Math.round(n.getBoundingClientRect().top));
    const [settingsTop, runTop, tplTop, charTop] = await settle(() => Promise.all(["#b-settings", "#b-run", "#b-tpl", "#b-char"].map(top)), ([s, r, t, c]) => s === r && t! > c!);
    assert.equal(settingsTop, runTop);
    assert.ok(tplTop! > charTop!, "the pickers on rows of their own");
    assert.ok(narrow <= 0, `no sideways scroll at 420: ${narrow}`);
    for (const pick of ["#b-char", "#b-tpl"]) {
      await page.click(pick);
      await page.locator(".pop [role=combobox]").waitFor();
      assert.ok(await sideways(page) <= 0, `no sideways scroll with ${pick}'s list open`);
      await page.keyboard.press("Escape");
    }
    await fitWindow(app, page, { width: 1440, height: 900 });
    assert.deepEqual(errors, []);
  } finally {
    await close();
  }
});

// Issue #336, part 1: the What changed chip beside the build picker, in place of its tooltip. With nothing changed it is
// hidden; an unsaved requirement shows a dot and "1 unsaved"; saved, it reads "1 change from **Melee** template". Its
// popover (a dialog) lists the changes by group with the template's value and this build's, an added requirement marked;
// the unsaved edits come first; Esc closes it onto the chip; a row opens Build Settings on that setting; Reset to “Melee”…
// asks first and leaves nothing changed. No sideways scroll at 420 with it open.
test("[slow] the What changed chip and its popover: unsaved first, by group, a row opens its setting, Reset asks", async (t) => {
  if (skipWithoutElectron(t)) return;
  const dataDir = tempDataDir("packrat-ui-changes-", { demoScans: true });
  const { app, page, errors, close } = await launch(dataDir);
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
    assert.deepEqual((await pop.locator(".b-diff-h").allTextContents()), ["Not saved yet · 1"], "an unsaved edit is listed once, in its own section");
    assert.match(await pop.locator(".b-diff-head").innerText(), /1 change from Melee template\s+1 change not saved to Dorran's profile yet/);
    // the header's count is the rows the sections list
    const agree = async (): Promise<void> => {
      const head = Number(/^(\d+)/.exec(await pop.locator(".b-diff-head strong").innerText())![1]);
      const rows = (await pop.locator(".b-diff-h").allTextContents()).reduce((sum, h) => sum + Number(/· (\d+)$/.exec(h)![1]), 0);
      assert.equal(head, rows, "the header counts what the sections list");
    };
    await agree();
    assert.deepEqual(await pop.locator(".b-diff").first().locator("thead th:not(:has(.sr))").allInnerTexts(), ["Melee", "Saved", "Now"], "an unsaved edit shows the template's value too");
    const luck = pop.locator(".b-diff").first().locator("tr", { hasText: "Luck" });
    assert.deepEqual(await luck.locator("td").allInnerTexts(), ["Luck", "none", "→", "none", "→", "300"]);
    assert.match(await luck.locator("td").last().getAttribute("class") ?? "", /b-diff-add/, "an added requirement is marked");
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
    assert.equal(await chip.getAttribute("aria-label"), null, "its name is its visible text");
    await chip.click();
    assert.deepEqual((await pop.locator(".b-diff-h").allTextContents()), ["Requirements · 1"], "saved, it is a change from the template");
    await agree();
    await page.keyboard.press("Escape");
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
    await close();
  }
});
