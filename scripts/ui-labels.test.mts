// ui-labels.test.mts — [slow]: character build labels (issue #336) in the real Electron window.
//
// `[slow]`: character build labels (issue #336) in the real Electron window, over the demo scans with Kestrel at Archery 100 and Tactics 90: the Characters roster's "No build label" with Add label, ↵ saving the label into profiles.json and the focus back on the line's Edit, Esc putting an edit back, a blank Save removing the label; the Suit Builder's character picker showing the label in place of the top skills (the button and its option), the search matching a label and the skills behind it, the top skills for a character with no label; and no sideways scroll at 420 px with the label box open or the picker showing a label.
//
// Skipped when electron or playwright is absent, or under TEST_SKIP_ELECTRON.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { fitWindow, sidewaysAt, testEnv, noUpdateCheck, removeTempDir } from "./electron-window.mts";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const require_ = createRequire(import.meta.url);
function unavailable(): string | null {
  if (process.env.TEST_SKIP_ELECTRON) return "TEST_SKIP_ELECTRON is set";
  for (const dep of ["electron", "playwright"]) {
    try { require_.resolve(dep); } catch { return `${dep} is not installed`; }
  }
  return null;
}
// The demo scans, with Kestrel at Archery 100 and Tactics 90 so the picker has skills to show and to search.
function seed(dataDir: string): void {
  writeFileSync(join(dataDir, "settings.json"), JSON.stringify({ schemaVersion: 1, shard: "uoalive", setupDone: true }));
  mkdirSync(join(dataDir, "scans"), { recursive: true });
  for (const name of ["Dorran", "Kestrel"]) {
    const scan = JSON.parse(readFileSync(join(ROOT, "app", "fixtures", `demo-${name}.json`), "utf8")) as { skills: Record<string, unknown> };
    if (name === "Kestrel") scan.skills = { Archery: { base: 100, value: 100, cap: 100 }, Tactics: { base: 90, value: 90, cap: 100 } };
    writeFileSync(join(dataDir, "scans", `demo-${name}.json`), JSON.stringify(scan));
  }
}

test("[slow] build labels: added, edited and removed on the Characters page, shown and searched in the Suit Builder's character picker, and fitting at 420 px", async (t) => {
  const why = unavailable();
  if (why) return t.skip(why);
  const dataDir = mkdtempSync(join(tmpdir(), "packrat-labels-"));
  seed(dataDir);
  const saved = (): unknown => (JSON.parse(readFileSync(join(dataDir, "profiles.json"), "utf8")) as { characters: Record<string, { label?: string }> }).characters.Kestrel?.label;
  const { _electron } = await import("playwright");
  const app = await _electron.launch({ args: [ROOT, "--data", noUpdateCheck(dataDir)], cwd: ROOT, timeout: 60_000, env: testEnv() });
  try {
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.waitForLoadState("load");   // a hash set while the page is still loading is lost (issue #330)
    await fitWindow(app, page, { width: 1440, height: 900 });
    const active = (): Promise<string | null | undefined> => page.evaluate(() => document.activeElement?.id || document.activeElement?.getAttribute("aria-label"));
    const line = page.locator('#char-table tr[data-name="Kestrel"] .char-label');

    // The roster: no label yet, Add label opens a box with the focus in it, ↵ saves it.
    await page.evaluate(() => { location.hash = "#/characters"; });
    await line.waitFor({ timeout: 30_000 });
    assert.match(await line.innerText(), /^No build label\s*Add label$/);
    await page.getByRole("button", { name: "Add a build label for Kestrel" }).click();
    assert.equal(await active(), "char-label-input");
    assert.equal(await page.getAttribute("#char-label-input", "aria-label"), "Build label for Kestrel");
    assert.equal(await page.getAttribute("#char-label-input", "maxlength"), "40");
    await page.keyboard.type("  Archer-Bard ");
    await page.keyboard.press("Enter");
    await page.getByRole("button", { name: "Edit Kestrel's build label" }).waitFor({ timeout: 10_000 });
    assert.match(await line.innerText(), /^Archer-Bard\s*Edit$/);
    assert.equal(saved(), "Archer-Bard", "trimmed, in profiles.json");
    assert.equal(await active(), "Edit Kestrel's build label", "the focus back on the line's button");
    assert.match(await page.locator('#char-table tr[data-name="Dorran"] .char-label').innerText(), /^No build label/);

    // Esc puts an edit back; a blank Save removes the label.
    await page.keyboard.press("Enter");
    assert.equal(await page.inputValue("#char-label-input"), "Archer-Bard");
    await page.fill("#char-label-input", "Something else");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Edit Kestrel's build label" }).waitFor();
    assert.match(await line.innerText(), /^Archer-Bard/);
    assert.equal(await active(), "Edit Kestrel's build label");
    assert.equal(saved(), "Archer-Bard");
    await page.keyboard.press("Enter");
    await page.fill("#char-label-input", "   ");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByRole("button", { name: "Add a build label for Kestrel" }).waitFor({ timeout: 10_000 });
    assert.equal(saved(), undefined, "a blank label leaves no key");

    // Labelled again, then the label box open at 420 px: the roster scrolls in its own box, the page not at all.
    await page.getByRole("button", { name: "Add a build label for Kestrel" }).click();
    await page.keyboard.type("Archer-Bard");
    await page.keyboard.press("Enter");
    await page.getByRole("button", { name: "Edit Kestrel's build label" }).waitFor({ timeout: 10_000 });
    await page.getByRole("button", { name: "Edit Kestrel's build label" }).click();
    assert.equal(await sidewaysAt(app, page, { width: 420, height: 800 }), 0, "no sideways scroll at 420 px with the label box open");
    await page.keyboard.press("Escape");
    await fitWindow(app, page, { width: 1440, height: 900 });

    // The Suit Builder's character picker: the label in place of the top skills, on the button and in the list.
    await page.evaluate(() => { location.hash = "#/builder/Kestrel"; });
    await page.waitForFunction(() => document.querySelector("#b-char")?.getAttribute("data-value") === "Kestrel", undefined, { timeout: 30_000 });
    await page.waitForFunction(() => document.querySelector("#b-char .cbx-sub")?.textContent === "Archer-Bard", undefined, { timeout: 10_000 });
    await page.click("#b-char");
    const search = page.locator(".pop [role=combobox]");
    await search.waitFor();
    assert.equal(await search.getAttribute("placeholder"), "Find a character, label or skill…");
    const subs = (): Promise<Record<string, string>> => page.$$eval(".pop [role=option]", (os) => Object.fromEntries(os.map((o) => [(o as HTMLElement).dataset.value!, o.querySelector(".cbx-sub")?.textContent || ""])));
    assert.equal((await subs()).Kestrel, "Archer-Bard");
    assert.notEqual((await subs()).Dorran, "No build label", "no label: the top skills (none in Dorran's demo scan), never a placeholder");
    const values = (): Promise<string[]> => page.$$eval(".pop [role=option]", (os) => os.map((o) => (o as HTMLElement).dataset.value!));
    await page.keyboard.type("bard");
    assert.deepEqual(await values(), ["Kestrel"], "the label matches");
    await page.fill(".pop [role=combobox]", "archery");
    assert.deepEqual(await values(), ["Kestrel"], "the skills behind the label still match");
    await page.keyboard.press("Escape");
    assert.equal(await page.locator(".pop").count(), 0);

    // A character with no label shows their top skills.
    await page.evaluate(() => { location.hash = "#/characters"; });
    await page.getByRole("button", { name: "Edit Kestrel's build label" }).click();
    await page.fill("#char-label-input", "");
    await page.keyboard.press("Enter");
    await page.getByRole("button", { name: "Add a build label for Kestrel" }).waitFor({ timeout: 10_000 });
    await page.evaluate(() => { location.hash = "#/builder/Kestrel"; });
    await page.waitForFunction(() => document.querySelector("#b-char .cbx-sub")?.textContent === "Archery 100 · Tactics 90", undefined, { timeout: 10_000 });

    // The picker showing a label at 420 px.
    await page.evaluate(() => { location.hash = "#/characters"; });
    await page.getByRole("button", { name: "Add a build label for Kestrel" }).click();
    await page.keyboard.type("A rather long build label for one");
    await page.keyboard.press("Enter");
    await page.getByRole("button", { name: "Edit Kestrel's build label" }).waitFor({ timeout: 10_000 });
    await page.evaluate(() => { location.hash = "#/builder/Kestrel"; });
    await page.waitForFunction(() => document.querySelector("#b-char .cbx-sub")?.textContent === "A rather long build label for one", undefined, { timeout: 10_000 });
    assert.equal(await sidewaysAt(app, page, { width: 420, height: 800 }), 0, "no sideways scroll at 420 px with a label in the picker");
    assert.deepEqual(errors, []);
  } finally {
    await app.close();
    removeTempDir(dataDir);
  }
});
