// ui-profiles-sync.test.mts — [slow]: the page's profile saves against another window's in the real Electron window (quality pass 1, W1a), on a writable `--data` directory seeded with the demo scans. Another window's save (a whole-file PUT with its own stamp, sent from the page's origin) makes the page's copy stale: a buff toggle after it goes up as an edit (PATCH), lands beside the other window's character (marked by its buffs: a whole-file save keeps only stored labels) and template with no stale refusal, and the page reads the file again and lists that template; an Update of a template the other window deleted is refused (409 conflict), not made again, the page says why, and the template stays deleted. Skipped the same way as the UI smoke test.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, copyFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { fitWindow, noUpdateCheck, removeTempDir } from "./electron-window.mts";
import type { ElectronApplication, Page } from "playwright";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const require_ = createRequire(import.meta.url);
function unavailable(): string | null {
  if (process.env.TEST_SKIP_ELECTRON) return "TEST_SKIP_ELECTRON is set";
  for (const dep of ["electron", "playwright"]) {
    try { require_.resolve(dep); } catch { return `${dep} is not installed`; }
  }
  return null;
}
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
interface Disk { characters: Record<string, { spec: { buffs?: { on: string[] } } }>; templates: Record<string, unknown> }
// Another window's whole-file save, made with the stamp it reads now: `change` runs on its copy (in the page's context).
type Change = "kestrelAndTemplate" | "deleteMine";
const otherWindow = (page: Page, change: Change): Promise<number> => page.evaluate(async (c) => {
  const got = await (await fetch("/api/profiles")).json() as { profiles: { characters: Record<string, Record<string, unknown>>; templates: Record<string, unknown> }; builtinTemplates: Record<string, unknown>; stamp: string };
  const p = got.profiles;
  if (c === "kestrelAndTemplate") {
    p.characters.Kestrel = { ...p.characters.Dorran, spec: { ...(p.characters.Dorran as { spec: object }).spec, buffs: { on: ["bless"], skills: {} } } };
    p.templates["Other window"] = got.builtinTemplates.melee;
  } else delete p.templates.Mine;
  const r = await fetch("/api/profiles", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...p, base: got.stamp }) });
  return r.status;
}, change);

test("[slow] a stale window's saves: a buff toggle lands beside the other window's character and template; an Update of a template it deleted says why", async (t) => {
  const why = unavailable();
  if (why) return t.skip(why);
  const dataDir = seedDataDir("packrat-ui-sync-");
  const { app, page, errors } = await launch(dataDir);
  const disk = (): Disk => JSON.parse(readFileSync(join(dataDir, "profiles.json"), "utf8")) as Disk;
  const onDisk = async (ok: (d: Disk) => boolean, what: string): Promise<void> => {
    for (let i = 0; i < 100 && !ok(disk()); i++) await page.waitForTimeout(100);
    assert.ok(ok(disk()), what);
  };
  const buff = async (id: string): Promise<void> => {
    if (await page.locator("#b-drawer").isHidden()) await page.click("#b-settings");
    await page.click("#b-tab-buffs");
    await page.click("#b-buff-add");
    await page.locator(`#abf-cb-${id}`).check();
    await page.keyboard.press("Escape");
  };
  let refused = 0;   // the page's saves refused
  page.on("response", (r) => { if (new URL(r.url()).pathname === "/api/profiles" && r.request().method() !== "GET" && r.status() >= 400) refused++; });
  try {
    await page.locator("#inv-table tbody tr.item").first().waitFor({ timeout: 30_000 });
    await page.click('[data-nav="builder"]');
    await page.waitForSelector("#tab-builder:not([hidden]) #b-start", { timeout: 10_000 });
    assert.equal(await page.getAttribute("#b-char", "data-value"), "Dorran");
    // a buff toggle saves Dorran's entry the ordinary way
    await buff("enemyOfOne");
    await onDisk((d) => !!d.characters.Dorran?.spec.buffs?.on.includes("enemyOfOne"), "Dorran's first buff saved");
    // another window saves Kestrel and a template: the page's copy is now stale
    assert.equal(await otherWindow(page, "kestrelAndTemplate"), 200);
    await buff("divineFury");
    await onDisk((d) => !!d.characters.Dorran?.spec.buffs?.on.includes("divineFury"), "the toggle saved after the reload");
    assert.equal(refused, 0, "an edit is never stale");
    const after = disk();
    assert.deepEqual(after.characters.Dorran!.spec.buffs!.on.sort(), ["divineFury", "enemyOfOne"]);
    assert.deepEqual(after.characters.Kestrel?.spec.buffs?.on, ["bless"], "the other window's character stays");
    assert.ok(Object.hasOwn(after.templates, "Other window"), "and its template");
    assert.equal(await page.locator(".toast.bad").count(), 0, "nothing to tell");
    await page.keyboard.press("Escape");
    await page.click("#b-tpl");
    assert.equal(await page.locator(".pop [role=option]", { hasText: "Other window" }).count(), 1, "the page lists the other window's template");
    await page.keyboard.press("Escape");
    // a template of the page's own, then deleted by the other window: Update can't be made again, and says so
    await page.click("#b-tpl");
    await page.locator(".pop").getByRole("button", { name: "Save as template…" }).click();
    await page.locator(".prompt-dialog[open] input[type=text]").fill("Mine");
    await page.locator(".prompt-dialog[open]").getByRole("button", { name: "Save" }).click();
    await onDisk((d) => Object.hasOwn(d.templates, "Mine"), "Mine saved");
    assert.equal(await otherWindow(page, "deleteMine"), 200);
    await page.click("#b-tpl");
    await page.locator(".pop").getByRole("button", { name: "Manage templates…" }).click();
    const card = page.locator('#tpl-drawer .tm-card[data-template="Mine"]');
    if (await card.locator(".tm-head").getAttribute("aria-expanded") !== "true") await card.locator(".tm-head").click();
    await card.getByRole("button", { name: /^Update Mine/ }).click();
    await page.locator("dialog[open]").getByRole("button", { name: "Update Mine" }).click();
    await page.locator(".toast.bad", { hasText: "the Mine template was deleted elsewhere, so it was not updated" }).waitFor({ timeout: 10_000 });
    assert.equal(Object.hasOwn(disk().templates, "Mine"), false, "not made again");
    assert.equal(refused, 1, "the Update refused");
    assert.ok(Object.hasOwn(disk().templates, "Other window") && disk().characters.Kestrel?.spec.buffs?.on[0] === "bless", "nothing else lost");
    await page.locator('#tpl-drawer .tm-card[data-template="Mine"]').waitFor({ state: "detached", timeout: 10_000 });
    assert.deepEqual(errors, []);
  } finally {
    await app.close();
    removeTempDir(dataDir);
  }
});
