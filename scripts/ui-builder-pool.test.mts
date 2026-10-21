// ui-builder-pool.test.mts — [slow]: resist caps, weapon exclusions, the Weapon must have and Only containers chips.
//
// `[slow]`: the Suit Builder's pool and resist-cap settings in the real Electron window, on a writable `--data` directory seeded with the demo scans. A raised resist cap (Fire 95) marked in the Resist caps group, built with, shown on the result's Fire tile and the saved run's badge, kept by Save profile across a reload, refused out of range with the error under the field, and reset to the shard's cap; two excluded weapon skills show on the Weapons chip and survive Save profile and a reload; Only containers (issue #12): the chip lists the same containers as Skip containers, counts the one checked, the build's saved run keeps the list, Save profile keeps it across a reload, and cleared it leaves the saved profile. Also: a floor past its cap warns, a race change drops a now-default override and a closed drawer still blocks Build; the Weapons popover's Spellbooks row excludes spellbooks and is saved with the profile; the Weapon must have chip shows the checked properties and is saved with the profile.
//
// Shared steps are in scripts/builder-ui.mts. Skipped when electron or playwright is absent, or under TEST_SKIP_ELECTRON.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { skipWithoutElectron, tempDataDir, until } from "./electron-app.mts";
import { built, closeSettings, launch, openBuilder, pressBuild, settings } from "./builder-ui.mts";

// Resist cap overrides (issue #44): a Fire cap raised to 95 for a Reaper Form suit is marked in the drawer, the
// result is measured against it and says so, the saved run shows it, and Save profile keeps it across a reload.
// A cap out of range stops the build with its reason under the field; the reset puts the shard's cap back.
test("[slow] a raised resist cap is marked, built with, shown in the result and the run, and saved with the profile; a buff is planned with", async (t) => {
  if (skipWithoutElectron(t)) return;
  const dataDir = tempDataDir("packrat-ui-rescaps-", { demoScans: true });
  const { page, errors, close } = await launch(dataDir);
  try {
    await openBuilder(page);
    const fire = page.locator("#b-cap-fireResist"), fireRow = page.locator("#b-sec-caps .rule-row[data-key=fireResist]");
    await settings(page, "advanced");
    assert.equal(await fire.inputValue(), "70", "the shard's cap until the player types another");
    assert.match(await fireRow.innerText(), /shard cap/);
    await fire.fill("95");
    assert.match(await fireRow.innerText(), /raised from 70/);
    assert.equal(await fireRow.getByRole("button", { name: "Reset Fire Resist cap to the shard's 70" }).count(), 1);
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
    await fireRow.getByRole("button", { name: /^Reset Fire Resist cap/ }).click();
    assert.equal(await fire.inputValue(), "70");
    assert.match(await page.locator("#b-sec-caps .rule-row[data-key=fireResist]").innerText(), /shard cap/);
    assert.deepEqual(errors, []);
  } finally {
    await close();
  }
});

// Review of #48: a requirement above its resist's cap warns on its row; a race change drops an override that is now
// the race's own cap, so Save does not store it; and an out-of-range cap stops Build with the drawer closed.
test("[slow] resist caps: a floor past its cap warns, a race change drops a now-default override, a closed drawer still blocks Build", async (t) => {
  if (skipWithoutElectron(t)) return;
  const dataDir = tempDataDir("packrat-ui-rescaps2-", { demoScans: true });
  const { page, errors, close } = await launch(dataDir);
  try {
    await openBuilder(page);
    await settings(page, "advanced");
    const fireReq = page.locator("#b-sec-req .rule-row[data-key=fireResist]");
    await page.fill("#b-cap-fireResist", "60");
    assert.match(await fireReq.innerText(), /Counts only up to the Fire Resist cap, 60/);
    await page.fill("#b-cap-fireResist", "70");
    assert.doesNotMatch(await fireReq.innerText(), /Counts only up to/);
    await settings(page, "requirements");
    await fireReq.locator("input[type=number]").fill("90");
    assert.match(await fireReq.innerText(), /Counts only up to the Fire Resist cap, 70/, "and it follows the floor as it is typed");
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
    await close();
  }
});

// Weapon exclusions (issue #45): checked skills in the Weapons popover say so on the chip, and Save profile keeps
// them across a reload, with the Use Best Weapon Skill check (issue #187).
test("[slow] excluded weapon skills and the Use Best Weapon Skill check show on the chip and are saved with the profile", async (t) => {
  if (skipWithoutElectron(t)) return;
  const dataDir = tempDataDir("packrat-ui-weapons-", { demoScans: true });
  const { page, errors, close } = await launch(dataDir);
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
    await close();
  }
});

// Spellbooks (issue #259): the Weapons popover ends in a Spellbooks row that adds ", no spellbooks" to the chip and is saved
// with the profile.
test("[slow] the Weapons popover's Spellbooks row excludes spellbooks and is saved with the profile", async (t) => {
  if (skipWithoutElectron(t)) return;
  const dataDir = tempDataDir("packrat-ui-books-", { demoScans: true });
  const { page, errors, close } = await launch(dataDir);
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
    await close();
  }
});

// Weapon properties (issue #214): the Weapon must have chip beside Weapons says what is checked, and Save profile keeps it
// across a reload; unchecking everything leaves the chip plain again.
test("[slow] the Weapon must have chip shows the checked properties and is saved with the profile", async (t) => {
  if (skipWithoutElectron(t)) return;
  const dataDir = tempDataDir("packrat-ui-wflags-", { demoScans: true });
  const { page, errors, close } = await launch(dataDir);
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
    await close();
  }
});

test("[slow] the Only containers chip narrows the pool, is built with, kept by the run and saved with the profile (issue #12)", async (t) => {
  if (skipWithoutElectron(t)) return;
  const dataDir = tempDataDir("packrat-ui-onlyroots-", { demoScans: true });
  const { page, errors, close } = await launch(dataDir);
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
    assert.ok(await until(kept, (v) => v, "the list in the saved run"), "the saved run keeps the list");
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
    assert.equal((await until(pool, (p) => !p.onlyRoots, "the list gone from the saved profile")).onlyRoots, undefined, "an empty list is not stored");
    assert.deepEqual(errors, []);
  } finally {
    await close();
  }
});
