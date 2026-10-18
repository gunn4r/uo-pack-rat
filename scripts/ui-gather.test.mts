// ui-gather.test.mts — [slow]: the Unravel view's Gather into a bag (issue #271) in the real Electron window.
//
// `[slow]`: the Unravel view's Gather into a bag (issue #271) in the real Electron window, over a house scan written into a temp `--data` folder's `scans/` (`app/organize-fixture.mts`: three magic rings in a chest and an empty bag in another) and a stand-in bridge that answers every trip as done: with no bag remembered the dialog offers only Another container…, says the pieces go in loose and why only a container on the ground can be filled, and gives their total weight; Pick a container… opens Move to's picker, the Move runs through the bridge's queue, the result line in the Unravel view says "Moved 3 pieces into" the bag and to use Unravel Container on it, with Move back; settings.json remembers the bag for the character; a piece in a backpack named as staying where it is, Move back, then the next Gather offering that bag first with "Gather 3 pieces" and running straight into it; and the dialog at 420 px with nothing scrolling sideways.
//
// Skipped when electron or playwright is absent, or under TEST_SKIP_ELECTRON.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fitWindow, sidewaysAt } from "./electron-window.mts";
import { fakeBridge, launchApp, skipWithoutElectron, until } from "./electron-app.mts";
import { houseScan } from "../app/organize-fixture.mts";

const CHEST = 0x40000001, BAG = 0x40000002, PACK = 0x40000003;
const RINGS = [0x40008001, 0x40008002, 0x40008003];
// Three rings with HCI and DCI 15 (Enchanted Essence, weight 240) in a chest, a fourth in a backpack (Move to leaves it); an empty bag on the ground.
function dataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "packrat-gather-"));
  writeFileSync(join(dir, "settings.json"), JSON.stringify({ schemaVersion: 1, shard: "uoalive", setupDone: true }));
  mkdirSync(join(dir, "scans"), { recursive: true });
  const scan = houseScan({
    scannedAt: new Date(Date.now() - 3600e3).toISOString(),
    boxes: [{ serial: CHEST, name: "Metal Chest", pos: { x: 1000, y: 1000, z: 0, facet: 1 }, max: 125 }, { serial: BAG, name: "Bag", pos: { x: 1002, y: 1000, z: 0, facet: 1 }, max: 125 }, { serial: PACK, name: "Backpack", kind: "backpack" }],
    things: [...RINGS.map((serial, i) => ({ serial, name: `Ring ${i + 1}`, in: CHEST, graphic: 0x108A, weight: 1, lines: ["Hit Chance Increase 15%", "Defense Chance Increase 15%"] })),
      { serial: 0x40008004, name: "Ring 4", in: PACK, graphic: 0x108A, weight: 1, lines: ["Hit Chance Increase 15%", "Defense Chance Increase 15%"] }],
  });
  writeFileSync(join(dir, "scans", "house.json"), JSON.stringify(scan));
  return dir;
}

test("[slow] Gather into a bag: pick a bag through Move to, the Move runs, the bag is remembered, and the dialog fits at 420 px", async (t) => {
  if (skipWithoutElectron(t)) return;
  const dir = dataDir(), bridge = fakeBridge(dir, { every: 500, answerTrips: 1000 });
  const bags = (): unknown => JSON.parse(readFileSync(join(dir, "settings.json"), "utf8")).unravelBag;
  const { app, page, errors, close } = await launchApp(dir, { size: { width: 1024, height: 768 } });
  try {
    await page.locator("#inv-table tbody tr.item").first().waitFor({ timeout: 30_000 });
    await page.getByRole("radio", { name: "Unravel", exact: true }).click();
    await page.locator(".unr-row").first().waitFor({ timeout: 15_000 });
    assert.equal(await page.locator(".unr-row").count(), 4);

    // No bag remembered yet: only Another container…, the loose and ground sentences, and the weight.
    await page.locator('.unr-group.essence [data-select="essence"]').click();
    await page.click("#unr-gather");
    const dialog = page.locator("dialog.unr-gather");
    await dialog.waitFor();
    assert.match(await dialog.locator("h2").innerText(), /^Gather 4 pieces into a bag$/);
    assert.deepEqual(await dialog.locator(".unr-opt-t").allInnerTexts(), ["Another container…"]);
    const callout = await dialog.locator(".unr-callout").innerText();
    assert.match(callout, /Pieces go in loose, not in sub-bags: Unravel Container only reaches the bag's top level\. Total weight 4 stones\./);
    assert.match(callout, /Staying where they are: 1 in a backpack, a bank box or carried/);
    assert.match(callout, /Move to fills only a container on the ground or a bag in one, not a bag in a backpack or bank/);
    assert.equal(await page.locator("#unr-gather-go").innerText(), "Pick a container…");

    // Pick a container…: Move to's picker; the bag; the Move runs as trips, and the result line is the Unravel view's.
    await page.click("#unr-gather-go");
    const bag = page.locator(`.mv-dest[data-serial="${BAG}"]`);
    await bag.waitFor();
    await bag.click();
    await until(() => page.locator("#mv-go").isEnabled(), (on) => on, "the Move button");
    await page.click("#mv-go");
    await until(() => page.locator("#unr-move-result").innerText().catch(() => ""), (s) => /Moved 3 pieces into/.test(s), "the result line");
    const result = await page.locator("#unr-move-result").innerText();
    assert.match(result, /Moved 3 pieces into Bag[\s\S]*At a soul forge, use Unravel Container on it\./);
    assert.deepEqual(bridge.trips()[0]!.puts.map((p) => p.dest), [[BAG], [BAG], [BAG]]);
    await page.locator("#unr-move-result #mv-back").waitFor();
    assert.deepEqual(await until(bags, (b) => !!b, "the remembered bag"), { Tester: BAG });
    assert.equal(await page.locator("#unr-selbar").isHidden(), true, "the selection is cleared once the Move starts");

    // Move back puts them in the chest again; the next Gather offers the remembered bag first, picked, for all three.
    await page.click("#unr-move-result #mv-back");
    await until(() => bridge.trips().length, (n) => n === 2, "the Move back trip");
    await until(() => page.locator("#unr-move-result").innerText().catch(() => ""), (s) => /^Moved 3 items back/.test(s), "Move back's result");
    await page.locator('.unr-group.essence [data-select="essence"]').click();
    await page.click("#unr-gather");
    await dialog.waitFor();
    const opts = await dialog.locator(".unr-opt-t").allInnerTexts();
    assert.equal(opts.length, 2);
    assert.match(opts[0]!, /^Bag/);
    assert.match(await dialog.locator(".unr-opt").first().innerText(), /Pack Rat remembers this bag for Tester\./);
    assert.equal(await dialog.locator('input[value="bag"]').isChecked(), true);
    assert.equal(await page.locator("#unr-gather-go").innerText(), "Gather 3 pieces");

    // At 420 px the dialog fits with nothing scrolling sideways.
    const over = await sidewaysAt(app, page, { width: 420, height: 860 }, ["dialog.unr-gather"]);
    assert.ok(over <= 0, `no sideways scroll at 420 (${over} px)`);
    await fitWindow(app, page, { width: 1024, height: 768 });

    // Gather 3 pieces: straight into the remembered bag, with no picker, and it stays remembered.
    await page.click("#unr-gather-go");
    await until(() => bridge.trips().length, (n) => n === 3, "the Gather trip");
    assert.deepEqual(bridge.trips()[2]!.puts.map((p) => p.dest), [[BAG], [BAG], [BAG]]);
    await until(() => page.locator("#unr-move-result").innerText().catch(() => ""), (s) => /^Moved 3 pieces into Bag/.test(s), "the second result line");
    assert.deepEqual(bags(), { Tester: BAG });
    assert.deepEqual(errors, []);
  } finally {
    bridge.stop();
    await close();
  }
});
