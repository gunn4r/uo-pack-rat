// ui-builder-templates.test.mts — [slow]: the template picker and the Manage templates drawer.
//
// `[slow]`: the Suit Builder's templates in the real Electron window, on a writable `--data` directory seeded with the demo scans. Templates (issue #212): the built-ins listed first under their own names, a built-in's badge, description, buffs and source under the picker; Apply sets Manual's buffs as one undo step that Undo takes back; the badge counts a buff changed since; Save as keeps the buffs. The Manage templates drawer (issue #336): the build's own card open first and marked "(this build)", a built-in with Duplicate only, on disk: a taken, a built-in-prefixed and an empty name refused, a rename carrying a character's saved link and the build, a duplicate of a template and of a built-in written with its own spec, a delete confirmed in the card leaving the build and the other character alone; a long name wrapping inside its buttons at 420; the focus kept in the drawer and back on the build picker when it closes.
//
// Shared steps are in scripts/builder-ui.mts. Skipped when electron or playwright is absent, or under TEST_SKIP_ELECTRON.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fitWindow, pickCharacter, pickTemplate } from "./electron-window.mts";
import { skipWithoutElectron, tempDataDir, until } from "./electron-app.mts";
import { closeSettings, launch, openBuilder, settings } from "./builder-ui.mts";

// Issue #212, with the built-in Melee given a description, a source and Divine Fury (the page's GET /api/profiles
// answer edited) and Manual holding Bless with its totals not counting buffs: the picker lists the built-ins first
// under their own names and shows Melee's badge, description, buffs and source; Apply turns Divine Fury on in Manual
// (counted) as one undo step, and Undo puts Bless and the switch back; a buff turned on since marks the template
// changed; Save as stores the buffs with the copy, listed under "Your templates".
test("[slow] templates: built-ins first with their description, Apply sets Manual's buffs in one undo step, the badge and Save as count buffs", async (t) => {
  if (skipWithoutElectron(t)) return;
  const dataDir = tempDataDir("packrat-ui-templates-", { demoScans: true });
  const { app, page, errors, close } = await launch(dataDir);
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
    // The Manage templates drawer (issue #336) reaches any saved template without applying it. Kestrel's saved settings come
    // from Mine; the build's own card opens first, marked "(this build)"; a built-in has Duplicate only. On disk: a taken, a
    // built-in-prefixed and an empty name are refused; renaming Mine carries Kestrel's link and the build to the new name;
    // a duplicate (of a template and of a built-in) is a new entry with its own spec; Delete asks in the card and leaves the
    // build and Kestrel alone. At 420 a long name wraps inside its buttons, with no sideways scroll.
    type Disk = { templates: Record<string, { spec: unknown }>; characters: Record<string, { template?: string }> };
    const profiles = (): Disk => JSON.parse(readFileSync(join(dataDir, "profiles.json"), "utf8")) as Disk;
    const onDisk = async (ok: (d: Disk) => boolean, what: string): Promise<void> => { assert.ok(ok(await until(profiles, ok, what)), what); };
    await page.evaluate(async (url) => { const { state } = await import(url); state.profiles.templates.Spare = { spec: state.profiles.templates.Mine.spec }; }, "/ui/store.mjs");
    await settings(page, "requirements");
    await page.click("#b-save");
    await onDisk((d) => d.characters.Kestrel?.template === "Mine" && !!d.templates.Spare, "Kestrel's saved settings come from Mine");
    await closeSettings(page);
    await page.click("#b-tpl");
    await page.locator(".pop").getByRole("button", { name: "Manage templates…" }).click();
    const drawer = page.locator("#tpl-drawer");
    await drawer.waitFor();
    assert.equal(await page.getByRole("dialog", { name: "Manage templates" }).count(), 1);
    assert.deepEqual(await drawer.locator(".tm-h").allTextContents(), ["Your templates · 2", "Built in · 17"]);
    const card = (n: string) => drawer.locator(`.tm-card[data-template="${n}"]`);
    assert.equal(await card("Mine").locator(".tm-head").getAttribute("aria-expanded"), "true", "the build's own template opens first");
    assert.equal(await card("Mine").locator(".tm-cur").innerText(), "Kestrel (this build)");
    assert.equal(await card("builtin:melee").getByRole("button").count(), 1, "a built-in has Duplicate only");
    const name = async (n: string): Promise<void> => { await page.locator(".prompt-dialog[open] input[type=text]").fill(n); await page.locator(".prompt-dialog[open]").getByRole("button", { name: "Save" }).click(); };
    // refused names leave the file as it was
    const before = JSON.stringify(profiles());
    await card("Spare").locator(".tm-head").click();
    for (const bad of ["Mine", "builtin:x", ""]) {
      await card("Spare").getByRole("button", { name: "Rename Spare" }).click();
      await name(bad);
      await page.waitForTimeout(300);   // sleep: proves a refused name renames nothing, which no event can show
      assert.equal(await card("Spare").count(), 1, `"${bad}" refused`);
    }
    assert.equal(JSON.stringify(profiles()), before, "nothing written for a refused name");
    // rename Mine: Kestrel's saved link and the build follow
    await card("Mine").locator(".tm-head").click();
    await card("Mine").getByRole("button", { name: "Rename Mine" }).click();
    await name("Main");
    await card("Main").waitFor();
    await onDisk((d) => !!d.templates.Main && !d.templates.Mine && d.characters.Kestrel?.template === "Main", "renamed on disk with Kestrel's link");
    assert.equal(await page.getAttribute("#b-tpl", "data-value"), "Main", "the build follows the new name");
    assert.equal(await page.evaluate(() => !!document.activeElement?.closest("#tpl-drawer")), true, "the focus stays in the drawer");
    // duplicate a template and a built-in: new entries, each with its own spec
    await card("Main").getByRole("button", { name: "Duplicate Main" }).click();
    assert.equal(await page.locator(".prompt-dialog[open] input[type=text]").inputValue(), "Main copy");
    await name("Main copy");
    await onDisk((d) => !!d.templates["Main copy"], "the copy is on disk");
    assert.deepEqual(profiles().templates["Main copy"]!.spec, profiles().templates.Main!.spec);
    await card("builtin:melee").getByRole("button", { name: "Duplicate Melee" }).click();
    assert.equal(await page.locator(".prompt-dialog[open] input[type=text]").inputValue(), "Melee copy");
    await name("Melee copy");
    await onDisk((d) => !!d.templates["Melee copy"], "a built-in's copy is a template of the player's");
    // Delete asks in the card, then the build and Kestrel stay on Main
    const kestrelBefore = JSON.stringify(profiles().characters.Kestrel);
    await card("Spare").locator(".tm-head").click();
    await card("Spare").getByRole("button", { name: "Delete Spare…" }).click();
    assert.match(await card("Spare").locator(".msg").innerText(), /Delete “Spare”\? No one uses it\./);
    await card("Spare").getByRole("button", { name: "Delete Spare", exact: true }).click();
    await onDisk((d) => !d.templates.Spare, "deleted on disk");
    assert.equal(await card("Spare").count(), 0);
    assert.equal(await page.getAttribute("#b-tpl", "data-value"), "Main", "the build still comes from Main");
    assert.equal(JSON.stringify(profiles().characters.Kestrel), kestrelBefore, "Kestrel's saved profile untouched");
    // a long name at 420: its buttons wrap, nothing scrolls sideways
    await fitWindow(app, page, { width: 420, height: 900 });
    const long = "A very long template name that goes on and on well past the drawer";
    await card("builtin:caster").getByRole("button", { name: "Duplicate Caster" }).click();
    await name(long);
    await card(long).waitFor();
    await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth, undefined, { timeout: 5_000 }).catch(() => {});
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "no sideways scroll at 420");
    assert.ok(await drawer.locator(".drawer-body").evaluate((b) => b.scrollWidth <= b.clientWidth), "nothing wider than the drawer");
    await fitWindow(app, page, { width: 1440, height: 900 });
    await page.keyboard.press("Escape");
    await drawer.waitFor({ state: "hidden" });
    assert.equal(await page.evaluate(() => document.activeElement?.id), "b-tpl", "closing gives the focus back to the build picker");
    assert.deepEqual(errors, []);
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
    await close();
  }
});
