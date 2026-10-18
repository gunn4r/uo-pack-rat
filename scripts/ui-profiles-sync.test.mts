// ui-profiles-sync.test.mts — [slow]: the page's profile saves against another window's in the real Electron window (quality pass 1, W1a), on a writable `--data` directory seeded with the demo scans. Another window's save (an edit sent from the page's origin) leaves the page's copy behind: a buff toggle after it lands beside the other window's character and template with no refusal, and the page reads the file again and lists that template; an Update of a template the other window deleted is refused (409 conflict), not made again, the page says why, and the template stays deleted. Launched through `scripts/electron-app.mts`; skipped when Electron can't run here.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "playwright";
import { launchApp, skipWithoutElectron, tempDataDir, until } from "./electron-app.mts";

interface Disk { characters: Record<string, { spec: { buffs?: { on: string[] } } }>; templates: Record<string, unknown> }
// Another window's save (PATCH /api/profiles from the page's origin, not through this page's own state).
type Change = "kestrelAndTemplate" | "deleteMine";
const otherWindow = (page: Page, change: Change): Promise<number> => page.evaluate(async (c) => {
  const got = await (await fetch("/api/profiles")).json() as { builtinTemplates: Record<string, unknown> };
  const edits = c === "kestrelAndTemplate" ? [{ op: "setBuffs", name: "Kestrel", buffs: { on: ["bless"] } }, { op: "putTemplate", id: "Other window", entry: got.builtinTemplates.melee }] : [{ op: "deleteTemplate", id: "Mine" }];
  const r = await fetch("/api/profiles", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ edits }) });
  return r.status;
}, change);

test("[slow] a stale window's saves: a buff toggle lands beside the other window's character and template; an Update of a template it deleted says why", async (t) => {
  if (skipWithoutElectron(t)) return;
  const dataDir = tempDataDir("packrat-ui-sync-", { demoScans: true });
  const { page, errors, close } = await launchApp(dataDir, { size: { width: 1440, height: 900 } });
  const disk = (): Disk => JSON.parse(readFileSync(join(dataDir, "profiles.json"), "utf8")) as Disk;
  const onDisk = (ok: (d: Disk) => boolean, what: string): Promise<Disk> => until(disk, ok, what, 10_000);
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
    await close();
  }
});
