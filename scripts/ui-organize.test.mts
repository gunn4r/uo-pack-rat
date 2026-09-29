// ui-organize.test.mts — [slow]: Organize (issue #11) in the real Electron window over the demo scans, on a
// writable --data folder: the empty state that teaches labelling, Containers' Label… and Fill column, labels
// shown wherever an item's place is listed, rules from presets and from the Inventory's Save as rule…, a bag
// inside a chest picked as a target, the live match count, reordering by keyboard and by drag, the plan's
// reports and collapsed trip list, a client that cannot run trips, running a trip through the bridge's queue
// (Stop, a failed step, Pin this item), and the screen at 1000 × 700. Skipped when electron or playwright is
// absent, or under TEST_SKIP_ELECTRON.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { fitWindow, openFacet, type RealSize, testEnv, noUpdateCheck } from "./electron-window.mts";
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

test("[slow] the Rules card: each rule's filter, targets with their fill and counts, the catch-all, and reordering by keyboard and by drag", async (t) => {
  const why = unavailable();
  if (why) return t.skip(why);
  const dataDir = dataDirWith([
    { id: "rule-1", name: "Magery reagents", names: ["sulfurous ash", "mandrake root"], targets: [DORRAN] },
    { id: "rule-2", name: "Rings", kind: ["gear"], targets: [KESTREL, DORRAN] },
  ]);
  const { app, page, errors } = await launch(dataDir);
  try {
    await go(page, "#/organize", '.org-rule[data-rule="rule-2"]');
    const one = page.locator('.org-rule[data-rule="rule-1"]'), two = page.locator('.org-rule[data-rule="rule-2"]');
    assert.match(await one.innerText(), /Name: sulfurous ash, mandrake root/);
    assert.match(await one.innerText(), /Reagents[\s\S]*40\/125/);
    assert.match(await two.innerText(), /Kind: gear/);
    assert.match(await two.innerText(), /Jewellery[\s\S]*120\/125[\s\S]*Reagents[\s\S]*40\/125/, "the chain in fill order");
    await page.waitForFunction(() => /in place/.test(document.querySelector('.org-rule[data-rule="rule-1"] .org-counts')?.textContent || ""), undefined, { timeout: 15_000 });
    assert.equal(await page.locator("#org-catchall").inputValue(), "", "no catch-all: unclaimed items stay put");

    // The catch-all takes any labelled, unpinned container.
    await page.selectOption("#org-catchall", String(DORRAN));
    await until(() => readOrganize(dataDir), (f) => f?.catchAll === DORRAN, "the catch-all saved");

    // Keyboard: ↑ on a rule's handle moves it up, says so, and keeps focus on the handle.
    await page.locator('.org-rule[data-rule="rule-2"] .org-grip').focus();
    await page.keyboard.press("ArrowUp");
    await until(() => readOrganize(dataDir), (f) => f?.rules[0]?.id === "rule-2", "rule-2 first");
    await page.waitForFunction(() => document.querySelector("#org-live")?.textContent === "Rings moved to position 1 of 2.");
    assert.equal(await page.evaluate(() => (document.activeElement?.closest(".org-rule") as HTMLElement | null)?.dataset.rule), "rule-2");

    // Drag: rule-1's handle dropped on rule-2 puts rule-1 first again.
    await page.locator('.org-rule[data-rule="rule-1"] .org-grip').dragTo(page.locator('.org-rule[data-rule="rule-2"]'));
    await until(() => readOrganize(dataDir), (f) => f?.rules.map((r) => r.id).join() === "rule-1,rule-2", "rule-1 first after the drag");
    assert.deepEqual(errors, []);
  } finally {
    await app.close();
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});

// A checklist facet's popover: tick one option by its value and close it (as scripts/ui-state.test.mts does).
async function pickOption(page: Page, id: string, name: string, value: string): Promise<void> {
  await openFacet(page, id, name);
  await page.locator(`.pop input[value="${value}"]`).click();
  await page.keyboard.press("Escape");
  await page.waitForSelector(".pop", { state: "detached" });
}

test("[slow] + Rule from a preset, then targets in fill order; the editor lists a target no scan has", async (t) => {
  const why = unavailable();
  if (why) return t.skip(why);
  const GONE = 0x40000099;
  const dataDir = dataDirWith([]);
  const doc = readOrganize(dataDir)!;
  (doc.labels as Record<string, unknown>)[String(GONE)] = { serial: GONE, name: "Old chest", origin: "manual" };
  writeFileSync(join(dataDir, "organize.json"), JSON.stringify(doc));
  const { app, page, errors } = await launch(dataDir);
  try {
    await go(page, "#/organize", "#org-add");
    await page.click("#org-add");
    await page.getByRole("menuitem", { name: "From a preset…" }).click();
    await page.waitForSelector("#rule-drawer:not([hidden]) #rule-preset");
    assert.equal(await page.evaluate(() => document.activeElement?.id), "rule-preset", "the preset picker has focus");
    await page.selectOption("#rule-preset", "magery-reagents");
    assert.equal(await page.locator("#rule-name").inputValue(), "Magery reagents");
    assert.match(await page.locator("#rule-names").inputValue(), /^black pearl\nbloodmoss/);
    await page.selectOption("#rule-add-target", String(DORRAN));
    await page.selectOption("#rule-add-target", String(GONE));
    assert.match(await page.locator("#rule-targets").innerText(), /Reagents[\s\S]*40\/125[\s\S]*Old chest[\s\S]*not in any scan/);
    // Fill order: Old chest up to first.
    await page.getByRole("button", { name: "Fill Old chest earlier" }).click();
    await page.click("#rule-save");
    await page.waitForSelector("#rule-drawer", { state: "hidden" });
    const saved = await until(() => readOrganize(dataDir), (f) => f?.rules.length === 1, "the rule saved");
    assert.deepEqual([saved!.rules[0]!.id, saved!.rules[0]!.name, saved!.rules[0]!.targets], ["rule-1", "Magery reagents", [GONE, DORRAN]]);
    assert.deepEqual(saved!.rules[0]!.match.query.kind, ["reagent"]);

    // Edit…: the forgotten target is still listed and can be removed.
    await page.locator('.org-rule[data-rule="rule-1"]').getByRole("button", { name: /^Actions for / }).click();
    await page.getByRole("menuitem", { name: "Edit…" }).click();
    await page.waitForSelector("#rule-drawer:not([hidden]) #rule-targets");
    await page.getByRole("button", { name: "Remove Old chest" }).click();
    await page.click("#rule-save");
    await until(() => readOrganize(dataDir), (f) => f?.rules[0]?.targets.join() === String(DORRAN), "the forgotten target removed");

    // A name the rule cannot have keeps the drawer open with the reason under the field.
    await page.click("#org-add");
    await page.getByRole("menuitem", { name: "Blank rule" }).click();
    await page.waitForSelector("#rule-drawer:not([hidden]) #rule-name");
    await page.click("#rule-save");
    assert.match(await page.locator("#rule-drawer").innerText(), /Give the rule a name, up to 64 characters\./);
    await page.keyboard.press("Escape");
    assert.deepEqual(errors, []);
  } finally {
    await app.close();
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});

test("[slow] a bag inside a labelled chest can be picked as a target, is labelled on save, and the editor counts what the rule would take", async (t) => {
  const why = unavailable();
  if (why) return t.skip(why);
  // The demo scans as the player's own, with a pouch inside Dorran's chest holding its Ring.
  const POUCH = 0x700c0100;
  const dataDir = dataDirWith([{ id: "rule-1", name: "Magery reagents", names: ["sulfurous ash"], targets: [DORRAN] }]);
  mkdirSync(join(dataDir, "scans"));
  for (const name of ["Dorran", "Kestrel"]) {
    const scan = JSON.parse(readFileSync(join(ROOT, "app", "fixtures", `demo-${name}.json`), "utf8")) as { containers: Record<string, unknown>; items: Array<{ name: string; container: number }> };
    if (name === "Dorran") {
      scan.containers[String(POUCH)] = { serial: POUCH, name: "Pouch", kind: "container", root: DORRAN, parent: DORRAN, tooltip: ["Pouch", "Contents: 1/125 Items, 1 Stones"] };
      scan.items.find((it) => it.name === "Ring")!.container = POUCH;
    }
    writeFileSync(join(dataDir, "scans", `demo-${name}.json`), JSON.stringify(scan));
  }
  const { app, page, errors } = await launch(dataDir, undefined, false);
  try {
    await go(page, "#/organize", "#org-add");
    await page.click("#org-add");
    await page.getByRole("menuitem", { name: "Blank rule" }).click();
    await page.waitForSelector("#rule-drawer:not([hidden]) #rule-name");
    await page.fill("#rule-name", "Rings");

    // The live count: what the filter alone takes from the labelled chests, and a word about the rule above.
    await page.fill("#rule-names", "ring");
    await page.waitForFunction(() => /^Matches \d+ items? \(e\.g\. [^)]*Ring/.test(document.querySelector("#rule-match")?.textContent || ""), undefined, { timeout: 10_000 });
    assert.match(await page.locator("#rule-match").innerText(), /Rules above this one may claim some of them first\./);

    // The picker: each labelled chest, the bag inside it indented under it.
    const opts = await page.locator("#rule-add-target option").evaluateAll((os) => os.map((o) => [(o as HTMLOptionElement).value, o.textContent || ""]));
    const at = (v: number): number => opts.findIndex(([value]) => value === String(v));
    assert.ok(at(DORRAN) >= 0 && at(POUCH) === at(DORRAN) + 1, `the pouch sits right under its chest: ${JSON.stringify(opts)}`);
    assert.match(opts[at(POUCH)]![1]!, /^\s+Pouch · 1\/125$/, "indented under the chest, with its fill");
    await page.selectOption("#rule-add-target", String(POUCH));
    assert.match(await page.locator("#rule-targets").innerText(), /Pouch[\s\S]*1\/125/);
    await page.click("#rule-save");
    await page.waitForSelector("#rule-drawer", { state: "hidden" });
    const saved = await until(() => readOrganize(dataDir), (f) => f?.rules.length === 2, "the rule saved");
    assert.deepEqual(saved!.rules[1]!.targets, [POUCH]);
    assert.deepEqual(saved!.labels[String(POUCH)], { serial: POUCH, name: "Pouch", origin: "manual" }, "the bag was labelled with the rule");
    assert.match(await page.locator('.org-rule[data-rule="rule-2"]').innerText(), /Pouch[\s\S]*1\/125/);
    assert.deepEqual(errors, []);
  } finally {
    await app.close();
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});

test("[slow] Save as rule… keeps the Inventory's item filters and leaves the location out, saying so", async (t) => {
  const why = unavailable();
  if (why) return t.skip(why);
  const dataDir = dataDirWith([]);
  const { app, page, errors } = await launch(dataDir);
  try {
    await page.fill("#f-text", "ring");
    await pickOption(page, "loc", "Location", `root:${KESTREL}`);
    await page.click("#f-save-rule");
    await page.waitForSelector("#rule-drawer:not([hidden]) #rule-q");
    assert.equal(await page.locator("#rule-q").inputValue(), "ring");
    assert.match(await page.locator("#rule-drawer").innerText(), /Location filter is left out: a rule matches items wherever they are/);
    assert.equal(await page.locator("#rule-name").inputValue(), "Search: ring");
    await page.selectOption("#rule-add-target", String(KESTREL));
    await page.click("#rule-save");
    await page.waitForSelector("#rule-drawer", { state: "hidden" });
    const saved = await until(() => readOrganize(dataDir), (f) => f?.rules.length === 1, "the rule saved");
    const q = saved!.rules[0]!.match.query;
    assert.equal(q.q, "ring");
    assert.ok(!("loc" in q) && !("roots" in q) && !("chars" in q), "no location, root or character filter in a rule");
    await page.getByRole("button", { name: "Open Organize" }).click();
    await page.waitForSelector('.org-rule[data-rule="rule-1"]');
    assert.deepEqual(errors, []);
  } finally {
    await app.close();
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});

// A 600-move plan in 30 trips with a room shortfall and a warning, served in place of the real one.
function bigPlan(): unknown {
  const moves = Array.from({ length: 600 }, (_, i) => ({ serial: 0x41000000 + i, name: "Black Pearl", amount: 1, from: KESTREL, to: DORRAN, ruleId: "rule-1", alsoMatched: [], trip: Math.floor(i / 20) + 1 }));
  const trips = Array.from({ length: 30 }, (_, i) => ({ index: i + 1, site: 0, takes: moves.slice(i * 20, i * 20 + 20).map((m) => m.serial), puts: moves.slice(i * 20, i * 20 + 20).map((m) => m.serial) }));
  return { ok: true, plan: { inventoryStamp: "2026-09-28T10:00:00Z", stamp: "big00001", sites: [{ index: 0, roots: [DORRAN, KESTREL] }], moves, trips,
    rules: [{ ruleId: "rule-1", matched: 640, inPlace: 30, toMove: 600, noRoom: 10 }], room: [{ ruleId: "rule-1", needSlots: 95, freeSlots: 85, shortfall: 10 }],
    crossSite: [], warnings: [{ kind: "unknown-capacity", serial: KESTREL, detail: "rescan with the current scripts to read its fill" }], carried: [], unclaimed: 0 } };
}

test("[slow] the plan puts its reports first and keeps a 600-move trip list collapsed; a client without trips gets no Run buttons", async (t) => {
  const why = unavailable();
  if (why) return t.skip(why);
  const dataDir = dataDirWith([{ id: "rule-1", name: "Magery reagents", names: ["black pearl"], targets: [DORRAN] }]);
  const { app, page, errors } = await launch(dataDir);
  try {
    await page.route("**/api/organize/plan", (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify(bigPlan()) }));
    await go(page, "#/organize", "#org-plan #org-headline");
    assert.equal(await page.locator("#org-headline").innerText(), "600 items to move in 30 trips");
    const order = await page.evaluate(() => {
      const plan = document.querySelector("#org-plan")!;
      const room = [...plan.querySelectorAll(".msg")].find((m) => /no room/.test(m.textContent || ""))!;
      const warn = [...plan.querySelectorAll(".msg")].find((m) => /Fill unknown/.test(m.textContent || ""))!;
      const head = plan.querySelector("#org-headline")!;
      const before = (a: Element, b: Element): boolean => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
      return { room: before(room, head), warn: before(warn, head), roomText: room.textContent };
    });
    assert.deepEqual([order.room, order.warn], [true, true], "the room report and warnings sit above the trip list");
    assert.match(order.roomText!, /Magery reagents: 10 items have no room \(95 slots needed, 85 free\)/);
    assert.equal(await page.locator(".org-trip").count(), 30);
    assert.equal(await page.locator(".org-move").count(), 0, "no move row is built until its trip is opened");
    await page.locator('.org-trip[data-trip="1"] > summary').click();
    await page.waitForFunction(() => document.querySelectorAll(".org-move").length === 20, undefined, { timeout: 5_000 });
    assert.match(await page.locator('.org-trip[data-trip="1"] .org-move').first().innerText(), /Black Pearl[\s\S]*Jewellery → Reagents/);
    assert.equal(await page.locator("#org-run").count(), 1, "TazUO can run trips");

    // A client whose bridge cannot run trips: the plan still shows, with a sentence instead of Run buttons.
    const put = await page.evaluate(async () => (await fetch("/api/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ client: { adapter: "classicuo-web", scriptsDir: "" } }) })).status);
    assert.equal(put, 200);
    await page.reload();
    await page.locator("#inv-table tbody tr.item").first().waitFor({ state: "attached", timeout: 30_000 });
    await go(page, "#/organize", "#org-plan #org-headline");
    assert.equal(await page.locator("#org-run").count(), 0);
    assert.match(await page.locator("#org-plan").innerText(), /can't carry out Organize trips\. Move the items by hand, then rescan\./);
    assert.deepEqual(errors, []);
  } finally {
    await app.close();
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});

test("[slow] Run trip queues one trip; Stop writes the stop flag; a failed put leaves the item in the backpack and offers Pin this item", async (t) => {
  const why = unavailable();
  if (why) return t.skip(why);
  // Kestrel's Sulfurous Ash belongs in Dorran's chest, so the plan has one trip.
  const dataDir = dataDirWith([{ id: "rule-1", name: "Magery reagents", names: ["sulfurous ash"], targets: [DORRAN] }]);
  const bridgeDir = join(dataDir, "bridge", "tazuo");
  mkdirSync(bridgeDir, { recursive: true });
  // The bridge, as far as the page can tell: a status file refreshed every second (online = answered within 8 s).
  let results: Record<string, unknown> = {};
  const writeStatus = (): void => writeFileSync(join(bridgeDir, "status.json"), JSON.stringify({ alive: new Date().toISOString(), character: "Tester", current: null, counts: { done: 0, failed: 0 }, results }));
  writeStatus();
  const alive = setInterval(writeStatus, 1000);
  const { app, page, errors } = await launch(dataDir);
  try {
    await go(page, "#/organize", "#org-plan #org-headline");
    assert.match(await page.locator("#org-headline").innerText(), /^\d+ items? to move in 1 trip$/);
    await page.waitForSelector("#org-run:not([disabled])", { timeout: 15_000 });
    await page.click("#org-run");
    const queue = join(bridgeDir, "queue.jsonl");
    const lines = await until(() => (existsSync(queue) ? readFileSync(queue, "utf8").trim().split("\n") : []), (l) => l.length === 1, "one queued trip");
    const cmd = JSON.parse(lines[0]!) as { id: string; action: string; index: number; takes: { serial: number }[] };
    assert.deepEqual([cmd.action, cmd.index], ["trip", 1]);
    await page.waitForSelector("#org-stop");
    assert.match(await page.locator("#org-status").innerText(), /^Trip 1 running/);
    assert.ok(await page.locator("#org-run").isDisabled(), "no second trip while one runs");

    await page.click("#org-stop");
    await until(() => existsSync(join(dataDir, "bridge", "stop")), (v) => v, "the stop flag");

    // The bridge reports: every take worked, the first put bounced.
    const [first, ...rest] = cmd.takes.map((x) => x.serial);
    const t0 = new Date().toISOString();
    results = { [cmd.id]: { ok: true, msg: "trip 1: 1 put failed", t: t0, partial: false, stopped: false, steps: [
      ...cmd.takes.map((x) => ({ op: "take", serial: x.serial, ok: true, msg: "took it" })),
      { op: "put", serial: first, ok: false, msg: "bounced (full, or refused)" },
      ...rest.map((s) => ({ op: "put", serial: s, ok: true, msg: "put away" })),
    ] } };
    writeStatus();
    await page.waitForSelector("text=Pin this item", { timeout: 20_000 });
    assert.equal(await page.locator("#org-stop").count(), 0, "the trip is over");
    assert.match(await page.locator("#org-plan").innerText(), /Trip 1: 1 step failed\./);
    assert.match(await page.locator("#org-plan").innerText(), /1 item from trip 1 is in your backpack\./);
    assert.equal(await page.locator("#org-put-away").count(), 1);

    await page.getByRole("button", { name: "Pin this item" }).click();
    await until(() => readOrganize(dataDir), (f) => !!f?.pinnedItems.includes(first!), "the item pinned");
    assert.deepEqual(errors, []);
  } finally {
    clearInterval(alive);
    await app.close();
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});

test("[slow] Organize fits a 1000 × 700 window: rows reflow, nothing scrolls sideways, Run and the drawer stay reachable", async (t) => {
  const why = unavailable();
  if (why) return t.skip(why);
  const dataDir = dataDirWith([
    { id: "rule-1", name: "Magery reagents", names: ["sulfurous ash", "mandrake root", "black pearl", "bloodmoss"], targets: [DORRAN, KESTREL] },
    { id: "rule-2", name: "Rings", kind: ["gear"], targets: [KESTREL] },
  ]);
  const bridgeDir = join(dataDir, "bridge", "tazuo");
  mkdirSync(bridgeDir, { recursive: true });
  const writeStatus = (): void => writeFileSync(join(bridgeDir, "status.json"), JSON.stringify({ alive: new Date().toISOString(), character: "Tester", current: null, counts: { done: 0, failed: 0 }, results: {} }));
  writeStatus();
  const alive = setInterval(writeStatus, 1000);
  const { app, page, errors, size } = await launch(dataDir, { width: 1000, height: 700 });
  t.diagnostic(`window ${size.width} × ${size.height}`);
  try {
    await go(page, "#/organize", "#org-plan #org-headline");
    const overflow = await page.evaluate(() => {
      const page_ = document.querySelector("#org-body") as HTMLElement;
      const rows = [...document.querySelectorAll<HTMLElement>(".org-rule, .org-catchall, #org-plan .card-body > *")];
      return { page: page_.scrollWidth - page_.clientWidth, rows: rows.filter((r) => r.scrollWidth > r.clientWidth + 1).map((r) => r.className || r.id) };
    });
    assert.equal(overflow.page, 0, "no sideways scroll");
    assert.deepEqual(overflow.rows, [], "no row is wider than its card");
    // The rows reflow (chain and counts under the name) exactly when the rule list is 900 px or narrower, which a
    // 1000 px window makes it even with the sidebar collapsed to icons.
    const layout = await page.evaluate(() => {
      const r = document.querySelector('.org-rule[data-rule="rule-1"]')!;
      return { width: document.querySelector(".org-rules")!.clientWidth, below: r.querySelector(".org-chain")!.getBoundingClientRect().top > r.querySelector(".org-rule-main")!.getBoundingClientRect().bottom - 1 };
    });
    t.diagnostic(`rule list ${layout.width} px`);
    assert.equal(layout.below, layout.width <= 900, "the chain drops under the name on a narrow card, and only there");
    if (size.width <= 1000) assert.ok(layout.below, "a 1000 px window reflows the rows");
    const run = page.locator("#org-run");
    await run.scrollIntoViewIfNeeded();
    assert.ok(await run.isVisible());
    await page.locator('.org-rule[data-rule="rule-1"]').getByRole("button", { name: /^Actions for / }).click();
    await page.getByRole("menuitem", { name: "Edit…" }).click();
    await page.waitForSelector("#rule-drawer:not([hidden]) #rule-save");
    // The drawer slides in: measure it once it has come to rest.
    await page.waitForFunction(() => { const r = document.querySelector("#rule-drawer .drawer")!.getBoundingClientRect(); return r.right <= innerWidth + 1; }, undefined, { timeout: 5_000 }).catch(() => undefined);
    const box_ = await page.locator("#rule-drawer .drawer").boundingBox();
    assert.ok(box_ && box_.x >= 0 && box_.x + box_.width <= size.width + 1, "the drawer fits the window");
    await page.locator("#rule-save").scrollIntoViewIfNeeded();
    assert.ok(await page.locator("#rule-save").isVisible());
    await page.keyboard.press("Escape");
    assert.deepEqual(errors, []);
  } finally {
    clearInterval(alive);
    await app.close();
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});

test("[slow] a hand-edited organize.json that lost a rule says so, refuses trips, and Save setup clears it", async (t) => {
  const why = unavailable();
  if (why) return t.skip(why);
  const dataDir = dataDirWith([{ id: "rule-1", name: "Magery reagents", names: ["sulfurous ash"], targets: [DORRAN] }, { id: "rule-2", name: "Rings", targets: [KESTREL] }]);
  const doc = readOrganize(dataDir)!;
  doc.rules[1]!.match.query.loc = ["Metal Chest"];   // not a rule filter: the read drops rule-2
  writeFileSync(join(dataDir, "organize.json"), JSON.stringify(doc));
  const bridgeDir = join(dataDir, "bridge", "tazuo");
  mkdirSync(bridgeDir, { recursive: true });
  const writeStatus = (): void => writeFileSync(join(bridgeDir, "status.json"), JSON.stringify({ alive: new Date().toISOString(), character: "Tester", current: null, counts: { done: 0, failed: 0 }, results: {} }));
  writeStatus();
  const alive = setInterval(writeStatus, 1000);
  const { app, page, errors } = await launch(dataDir);
  try {
    await go(page, "#/organize", "#org-save-setup");
    assert.match(await page.locator("#org-body").innerText(), /Part of organize\.json could not be read[\s\S]*rules\[1\]\.match\.query\.loc is not a rule filter/);
    await page.waitForSelector("#org-run:not([disabled])", { timeout: 15_000 });
    await page.click("#org-run");
    await page.waitForFunction(() => /no trip runs until you have checked the setup and pressed Save setup/.test(document.querySelector("#org-plan")?.textContent || ""), undefined, { timeout: 10_000 });
    assert.equal(existsSync(join(bridgeDir, "queue.jsonl")), false, "nothing was queued");
    await page.click("#org-save-setup");
    await until(() => readOrganize(dataDir), (f) => f?.rules.length === 1, "the setup saved as it now reads");
    await page.waitForSelector("#org-save-setup", { state: "detached" });
    assert.deepEqual(errors, []);
  } finally {
    clearInterval(alive);
    await app.close();
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});
