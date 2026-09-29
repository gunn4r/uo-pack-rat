// ui-organize.test.mts — [slow]: Organize (issue #11) in the real Electron window over the demo scans, on a
// writable --data folder: the empty state that teaches labelling, Containers' Label… and Fill column, labels
// shown wherever an item's place is listed, rules from presets and from the Inventory's Save as rule…, a bag
// inside a chest picked as a target, the live match count, reordering by keyboard and by drag, the plan's
// reports and collapsed trip list, a client that cannot run trips, running a trip through the bridge's queue
// (Stop, a failed step, Pin this item), and the screen at 1000 × 700. Skipped when electron or playwright is
// absent, or under TEST_SKIP_ELECTRON.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { fitWindow, type RealSize, testEnv, noUpdateCheck } from "./electron-window.mts";
import type { ElectronApplication, Page } from "playwright";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const require_ = createRequire(import.meta.url);
// The two demo chests (app/fixtures/demo-*.json), side by side at 1000, 1000: Dorran's holds 40 of 125 items,
// Kestrel's 120 of 125.
const DORRAN = 0x700c0000, KESTREL = 0x700b0000;
function unavailable(): string | null {
  if (process.env.TEST_SKIP_ELECTRON) return "TEST_SKIP_ELECTRON is set";
  for (const dep of ["electron", "playwright"]) {
    try { require_.resolve(dep); } catch { return `${dep} is not installed`; }
  }
  return null;
}
interface SeedRule { id: string; name: string; names?: string[]; kind?: string[]; targets: number[] }
const EMPTY_QUERY = { q: "", slot: [], rarity: "", rarityMin: "", rarityMax: "", kind: [], slayer: "", nogarg: false, med: false, hideTags: [], props: [] };
// A data folder with the wizard done and, unless `rules` is null, both demo chests labelled and these rules.
function dataDirWith(rules: SeedRule[] | null): string {
  const dir = mkdtempSync(join(tmpdir(), "packrat-organize-"));
  writeFileSync(join(dir, "settings.json"), JSON.stringify({ schemaVersion: 1, shard: "uoalive", setupDone: true }));
  if (rules) writeFileSync(join(dir, "organize.json"), JSON.stringify({
    version: 1, catchAll: null, pinnedItems: [],
    labels: { [DORRAN]: { serial: DORRAN, name: "Reagents", origin: "manual" }, [KESTREL]: { serial: KESTREL, name: "Jewellery", color: "#2f7f7f", origin: "manual" } },
    rules: rules.map((r) => ({ id: r.id, name: r.name, match: { query: { ...EMPTY_QUERY, kind: r.kind || [] }, ...(r.names ? { names: r.names } : {}) }, targets: r.targets, origin: "manual" })),
  }));
  return dir;
}
interface OrganizeFile { labels: Record<string, { name: string; color?: string; pinned?: boolean; origin: string }>; rules: Array<{ id: string; name: string; targets: number[]; match: { query: Record<string, unknown>; names?: string[] } }>; catchAll: number | null; pinnedItems: number[] }
const readOrganize = (dir: string): OrganizeFile | null => { try { return JSON.parse(readFileSync(join(dir, "organize.json"), "utf8")) as OrganizeFile; } catch { return null; } };
// Poll a file-backed fact until it holds (a save is a PUT the page sends after the click).
async function until<T>(read: () => T, ok: (v: T) => boolean, what: string): Promise<T> {
  const end = Date.now() + 10_000;
  let v = read();
  while (!ok(v)) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}: ${JSON.stringify(v)}`);
    await new Promise((r) => setTimeout(r, 100));
    v = read();
  }
  return v;
}
async function launch(dataDir: string, want: RealSize = { width: 1440, height: 900 }, demo = true): Promise<{ app: ElectronApplication; page: Page; errors: string[]; size: RealSize }> {
  const { _electron } = await import("playwright");
  const app = await _electron.launch({ args: [ROOT, ...(demo ? ["--demo"] : []), "--data", noUpdateCheck(dataDir)], cwd: ROOT, timeout: 60_000, env: testEnv() });
  const page = await app.firstWindow();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const size = await fitWindow(app, page, want);
  await page.locator("#inv-table tbody tr.item").first().waitFor({ timeout: 30_000 });
  return { app, page, errors, size };
}
async function go(page: Page, hash: string, ready: string): Promise<void> {
  await page.evaluate((h) => { location.hash = h; }, hash);
  await page.waitForSelector(ready, { timeout: 15_000 });
}
const rowActions = (page: Page, root: number) => page.locator(`#cont-table tr[data-root="${root}"]`).getByRole("button", { name: /^Actions for / });

test("[slow] Organize teaches labelling until a container is labelled, and Label… names a chest wherever it is shown", async (t) => {
  const why = unavailable();
  if (why) return t.skip(why);
  const dataDir = dataDirWith(null);
  const { app, page, errors } = await launch(dataDir);
  try {
    // No labels: the screen says what labelling is for and takes the player to it.
    await go(page, "#/organize", "#tab-organize .org-empty");
    assert.match(await page.locator(".org-empty").innerText(), /Label your storage first[\s\S]*friend's chest/);
    await page.click("#org-open-containers");
    await page.waitForFunction(() => location.hash === "#/containers");
    await page.waitForSelector("#tab-containers:not([hidden])");

    // The Fill column reads each chest's Contents line.
    assert.match(await page.locator(`#cont-table tr[data-root="${DORRAN}"]`).innerText(), /40\/125/);
    assert.match(await page.locator(`#cont-table tr[data-root="${KESTREL}"]`).innerText(), /120\/125/);

    // Label… names the chest; the label shows in the row, on disk, and wherever its items are listed.
    await rowActions(page, DORRAN).click();
    await page.getByRole("menuitem", { name: "Label…" }).click();
    await page.waitForSelector("dialog[open] #lbl-name");
    assert.equal(await page.locator("#lbl-name").inputValue(), "Metal Chest", "the label starts from the chest's own name");
    await page.fill("#lbl-name", "Reagents");
    await page.selectOption("#lbl-colour", "#2f7f7f");
    await page.click("#lbl-save");
    await page.waitForFunction(() => !document.querySelector("dialog[open]"));
    const saved = await until(() => readOrganize(dataDir), (f) => !!f?.labels[String(DORRAN)], "the label in organize.json");
    assert.deepEqual([saved!.labels[String(DORRAN)]!.name, saved!.labels[String(DORRAN)]!.color], ["Reagents", "#2f7f7f"]);
    await page.waitForFunction((r) => document.querySelector(`#cont-table tr[data-root="${r}"]`)?.textContent?.includes("Reagents"), DORRAN);

    await go(page, "#/inventory", "#inv-table tbody tr.item");
    await page.fill("#f-text", "Mandrake");
    await page.waitForFunction(() => [...document.querySelectorAll("#inv-table tbody tr.item")].some((r) => r.textContent?.includes("Reagents")), undefined, { timeout: 15_000 });

    // Labelled but no rules yet: the Rules card asks for one, and there is no plan to show.
    await go(page, "#/organize", "#org-rules");
    assert.match(await page.locator("#org-rules").innerText(), /No rules yet/);
    assert.equal(await page.locator("#org-plan").count(), 0);
    assert.deepEqual(errors, []);
  } finally {
    await app.close();
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});
