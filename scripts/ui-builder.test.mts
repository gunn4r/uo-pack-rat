// ui-builder.test.mts — [slow]: the Suit Builder's keyboard, hover and panel behaviour, driven in the real
// Electron window with Playwright (the launch scripts/ui-state.test.mts uses). Each case is maintainer feedback
// on the redesign (PR #43): ⌘↵ building from anywhere on the screen, not only with focus inside it; the item
// tooltip on the current suit's and the Fetch list's pieces; a Fetch list place shown whole; STR limit out of
// Advanced; a switch whose off and on states read apart. Skipped when electron or playwright is absent, or
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

// A switch's off and on states read apart at a glance: the on track's fill is at least 3:1 against the off
// track's (hollow, the surface's own colour), and the knob moves from left to right.
test("[slow] a switch's on state stands apart from its off state in each theme and mode", async (t) => {
  const why = unavailable();
  if (why) return t.skip(why);
  const dataDir = seedDataDir("packrat-ui-switch-");
  const { app, page, errors } = await launch(dataDir);
  try {
    await openBuilder(page);
    await page.getByRole("switch", { name: "Allow gargoyle-only gear" }).check();
    for (const theme of ["default", "britannia"]) for (const mode of ["light", "dark"]) {
      await page.evaluate(([th, md]) => { document.documentElement.dataset.theme = th!; document.documentElement.dataset.mode = md!; }, [theme, mode]);
      await page.waitForTimeout(400);   // the track's colour transition
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
