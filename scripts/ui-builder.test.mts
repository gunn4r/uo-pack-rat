// ui-builder.test.mts — [slow]: the Suit Builder's keyboard, hover and panel behaviour, driven in the real
// Electron window with Playwright (the launch scripts/ui-state.test.mts uses). Each case is maintainer feedback
// on the redesign (PR #43): ⌘↵ building from anywhere on the screen, not only with focus inside it; the item
// tooltip on the current suit's and the Fetch list's pieces; a Fetch list place shown whole; STR limit out of
// Advanced; a switch whose off and on states read apart. And the resist cap overrides (issue #44) and the weapon exclusions (issue #45). Skipped when electron or playwright is absent, or
// under TEST_SKIP_ELECTRON.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { fitWindow } from "./electron-window.mts";
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
  const app = await _electron.launch({ args: [ROOT, "--data", dataDir], cwd: ROOT, timeout: 60_000 });
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
    rmSync(dataDir, { recursive: true, force: true });
  }
});

// The item tooltip's name once it shows (400 ms after a hover settles, or after keyboard focus).
async function tipName(page: Page): Promise<string> {
  await page.waitForFunction(() => getComputedStyle(document.querySelector("#tip")!).display === "block", undefined, { timeout: 5_000 });
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
    rmSync(dataDir, { recursive: true, force: true });
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
    rmSync(dataDir, { recursive: true, force: true });
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
    rmSync(dataDir, { recursive: true, force: true });
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
    rmSync(dataDir, { recursive: true, force: true });
  }
});

// Resist cap overrides (issue #44): a Fire cap raised to 95 for a Reaper Form suit is marked in the panel, the
// result is measured against it and says so, the saved run shows it, and Save profile keeps it across a reload.
// A cap out of range stops the build with its reason under the field; the reset puts the shard's cap back.
test("[slow] a raised resist cap is marked, built with, shown in the result and the run, and saved with the profile", async (t) => {
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

    await page.click("#b-run");
    await built(page);
    const tile = page.locator("#b-result .b-head-card .resist", { hasText: "Fire" });
    assert.match(await tile.innerText(), /\/ 95/);
    assert.match(await tile.innerText(), /Cap raised from 70/);
    await page.click("#b-runs-open");
    await page.waitForSelector("#runs-drawer:not([hidden]) .run-card");
    assert.match(await page.locator("#b-runs .run-card").first().innerText(), /cap 95/, "the saved run names its cap");
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
    rmSync(dataDir, { recursive: true, force: true });
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
      return r.profiles.characters[who].resistCaps;
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
    rmSync(dataDir, { recursive: true, force: true });
  }
});

// Weapon exclusions (issue #45): ticking two skills in the Weapons popover says so on the chip, and Save profile
// keeps them across a reload.
test("[slow] two excluded weapon skills show on the chip and are saved with the profile", async (t) => {
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
    assert.equal(await chip.innerText(), "Weapons: 2 excluded");
    await page.keyboard.press("Escape");
    await page.click("#b-save");
    await page.waitForFunction(() => /Profile for .* saved/.test(document.body.textContent || ""), undefined, { timeout: 10_000 });
    await page.reload();
    await page.waitForSelector("#tab-builder:not([hidden]) #b-weapon", { timeout: 30_000 });
    assert.equal(await chip.innerText(), "Weapons: 2 excluded");
    await chip.click();
    assert.deepEqual(await page.locator(".pop input:checked").evaluateAll((is) => is.map((i) => (i as HTMLInputElement).value)), ["archery", "throwing"]);
    assert.deepEqual(errors, []);
  } finally {
    await app.close();
    rmSync(dataDir, { recursive: true, force: true });
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
    rmSync(dataDir, { recursive: true, force: true });
  }
});
