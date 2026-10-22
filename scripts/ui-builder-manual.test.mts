// ui-builder-manual.test.mts — [slow]: Manual mode, its hand-offs and No character.
//
// `[slow]`: the Suit Builder's Manual mode and No character in the real Electron window, on a writable `--data` directory seeded with the demo scans. Manual mode (issue #12): the live doll's pill (issue #57: the empty slot being chosen, a focused row previewed, Esc back to the New suit with the picker still open); a slot opens the picker on its pieces (narrowed by "Only what Auto would use" to the Automatic pool, issue #487), a row picked with the keyboard (focus, Enter) fills the slot, moves the totals and says so in the status line, the picker stays on that slot with the picked row marked "In this slot", the undo key empties the slot again (the status line saying what was undone) and redo puts the piece back, Esc closes it with focus back on the slot card, and the mode and the suit are in `ui-prefs.json`; and the hand-offs: another character picked mid-fill cancels the fill and leaves the suit alone, Fill the rest automatically fills empty slots around a placed ring in one undo step and shows the fetch list, Save as run puts a Manual run in the drawer that opens in the result view with Open in Manual, and an Automatic result's Start from this result loads it into Manual as one undo step. No character in Automatic (issue #12): no Race row, the buff picker speaking of no character, no "_nobody" anywhere in the page text, the Caster template's requirements, a build headed "Best suit · No character" with Grab disabled and its reason while no bridge is online, and with a bridge online on Kestrel (stubbed) Grab all queueing one grab per piece and the toast naming her, a Suit totals card, its run in its own drawer, Save profile kept across a reload, Manual on its No character, and Kestrel picked back with her own panel. With a character picked, Manual's fetch list follows the bridge: Grab goes live when it comes online and off when it goes away (issue #535).
//
// Shared steps are in scripts/builder-ui.mts. Skipped when electron or playwright is absent, or under TEST_SKIP_ELECTRON.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pickCharacter, pickTemplate } from "./electron-window.mts";
import { skipWithoutElectron, tempDataDir, until } from "./electron-app.mts";
import { built, closeSettings, launch, openBuilder, pressBuild, settings } from "./builder-ui.mts";

// Manual mode (issue #12): a slot opens the picker on its pieces, a picked row fills the slot and moves the totals,
// and the picker stays on that slot with the row marked as the one in it; the undo key takes it out, redo puts it back. Esc closes it onto the slot card, and the
// suit is kept in ui-prefs.json. A buff turned on marks the totals it moves.
test("[slow] Manual mode: a picked piece fills its slot, moves the totals and leaves the picker on the slot", async (t) => {
  if (skipWithoutElectron(t)) return;
  const dataDir = tempDataDir("packrat-ui-manual-", { demoScans: true });
  const { page, errors, close } = await launch(dataDir);
  try {
    await openBuilder(page);
    await page.click('#b-mode [data-value="manual"]');
    await page.waitForSelector("#b-manual:not([hidden]) #mb-suit .mb-slot");
    assert.equal(await page.locator("#b-run").isVisible(), false, "Automatic's Build is out of the way");
    assert.equal(await page.locator("#b-settings").isVisible(), true, "Auto Build Settings stays, in the same place");
    const ring = page.locator('.mb-slot-pick[data-slot="ring"]');
    await ring.click();
    await page.waitForSelector("#mb-picker:not([hidden]) tbody tr.item");
    assert.equal(await page.locator("#mb-picker-h").textContent(), "Ring: choose a piece");
    // "Only what Auto would use" (#487): the picker asks for the Automatic panel's pool (auto=); off again, every ring.
    const ringsAfter = async (act: () => Promise<void>, auto: boolean): Promise<number> => {
      const r = page.waitForResponse((res) => res.url().includes("/api/items?") && !res.url().includes("fields=") && res.url().includes("auto=") === auto);
      await act();
      return ((await (await r).json()) as { total: number }).total;
    };
    const pooled = await ringsAfter(() => page.locator("#mb-auto-only").check(), true);
    const every = await ringsAfter(() => page.locator("#mb-auto-only").uncheck(), false);
    assert.ok(pooled > 0 && pooled <= every, `${pooled} of ${every} rings`);
    await page.waitForSelector("#mb-picker tbody tr.item");
    // Each total's tile (the five resists and the property and stat tiles), by its key: not the "N of 12" header.
    const tiles = (): Promise<Record<string, string>> => page.$$eval("#mb-totals [data-key]", (els) => Object.fromEntries(els.map((e) => [(e as HTMLElement).dataset.key!, (e as HTMLElement).innerText])));
    const totalsBefore = await tiles();
    // Picked from the keyboard, the way a player steps through pieces: the first row focused, then Enter.
    const row = page.locator("#mb-picker tbody tr.item").first();
    const name = (await row.locator("td").first().innerText()).trim();
    // the live doll (issue #57): its pill names the empty slot being chosen, then the focused row previewed in it; Esc first
    // goes back to the New suit and leaves the picker open
    const pill = (): Promise<string> => page.locator("#mb-doll-card .doll-pill").evaluate((e) => e.textContent || "");
    await page.mouse.move(0, 0);   // the click that opened the picker can leave the pointer over a row, which previews it
    await page.waitForFunction(() => document.querySelector("#mb-doll-card .doll-pill")?.textContent === "Ring: empty");
    await row.focus();
    await page.waitForFunction((n) => document.querySelector("#mb-doll-card .doll-pill")?.textContent === `Preview · Ring: ${n}`, name);
    await page.keyboard.press("Escape");
    assert.equal(await pill(), "Ring: empty");
    assert.equal(await page.locator("#mb-picker").isVisible(), true, "Esc took the preview off, not the picker");
    await page.keyboard.press("Enter");
    await page.waitForFunction((n) => document.querySelector('.mb-slot-pick[data-slot="ring"]')?.textContent?.includes(n), name);
    const totalsAfter = await tiles();
    assert.ok(Object.keys(totalsBefore).length >= 16, "every total has its tile");
    assert.ok(Object.keys(totalsAfter).some((k) => totalsAfter[k] !== totalsBefore[k]), "a total's tile moved");
    assert.equal(await page.locator("#mb-picker").isVisible(), true, "the picker stays open");
    assert.equal(await page.locator("#mb-picker-h").textContent(), "Ring: choose a piece", "on the same slot");
    assert.ok((await page.locator("#mb-status").textContent() || "").includes(`${name} is in Ring`), "the status line says where it went");
    const current = page.locator('#mb-picker tbody tr.item[aria-selected="true"]');
    await current.first().waitFor();
    assert.equal(await current.count(), 1, "one row marked as the piece in the slot");
    assert.match(await current.innerText(), /In this slot/);
    // Undo takes the pick back out of the slot, and redo puts it back (⌘Z / ⇧⌘Z on a Mac, Ctrl+Z / Ctrl+Y elsewhere).
    const mod = process.platform === "darwin" ? "Meta" : "Control";
    const ringText = (): Promise<string> => page.locator('.mb-slot-pick[data-slot="ring"]').innerText();
    await page.keyboard.press(`${mod}+z`);
    await page.waitForFunction((n) => !document.querySelector('.mb-slot-pick[data-slot="ring"]')?.textContent?.includes(n), name);
    assert.match(await ringText(), /Choosing/, "the slot is empty again");
    assert.ok((await page.locator("#mb-status").textContent() || "").startsWith("Undid: Ring → "), "the status line says what was undone");
    await page.keyboard.press(process.platform === "darwin" ? "Meta+Shift+z" : "Control+y");
    await page.waitForFunction((n) => document.querySelector('.mb-slot-pick[data-slot="ring"]')?.textContent?.includes(n), name);
    await page.keyboard.press("Escape");
    await page.waitForSelector("#mb-picker", { state: "hidden" });
    assert.equal(await page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.slot), "ring", "focus back on the slot card");
    // The suit is saved by a PUT the page does not wait on: poll the file until it holds the ring.
    type Prefs = { builderMode?: string; manualSuit?: Record<string, number>; manualBuffs?: string[] };
    const read = (): Prefs => { try { return JSON.parse(readFileSync(join(dataDir, "ui-prefs.json"), "utf8")) as Prefs; } catch { return {}; } };
    const prefs = await until(read, (p) => typeof p.manualSuit?.ring === "number", "the ring in ui-prefs.json");
    assert.equal(prefs.builderMode, "manual");
    assert.equal(typeof prefs.manualSuit?.ring, "number", "the suit is kept for the next launch");
    // A buff (app/buffs.mts): Add buff opens the buff picker in the side column, Divine Fury on puts its chip in the
    // Buffs row and a marker line under HCI, and Esc closes the picker onto Add buff.
    await page.click("#bf-add");
    await page.waitForSelector("#mb-buffs:not([hidden]) #bf-cb-divineFury");
    await page.locator("#bf-cb-divineFury").check();
    await page.waitForSelector('#mb-totals [data-key="hci"] .bf-sub');
    assert.match(await page.locator('#mb-totals [data-key="hci"] .bf-sub').innerText(), /\+1[05]/, "Divine Fury's HCI, flat or top tier");
    assert.match(await page.locator('#mb-totals .bf-strip .token[data-buff="divineFury"]').innerText(), /Divine Fury/);
    await page.keyboard.press("Escape");
    await page.waitForSelector("#mb-buffs", { state: "hidden" });
    assert.equal(await page.evaluate(() => document.activeElement?.id), "bf-add", "focus back on Add buff");
    const bp = await until(read, (p) => !!p.manualBuffs?.includes("divineFury"), "Divine Fury in ui-prefs.json");
    assert.deepEqual(bp.manualBuffs, ["divineFury"], "the buffs are kept for the next launch");
    assert.deepEqual(errors, []);
  } finally {
    await close();
  }
});

// Manual's hand-offs (issue #12): Fill the rest automatically fills the empty slots in one undo step and keeps the
// placed piece, here from the Auto Build Settings drawer opened over Manual (no Buffs tab, no Build or Save as template, its
// footer's Fill the rest); Save as run puts the suit in the runs drawer as a manual run, which opens in the result view with
// Open in Manual; and an Automatic result's Start from this result loads it into Manual in one undo step.
test("[slow] Manual hand-offs: fill the rest, save as run, reopen it, and start from an Automatic result", async (t) => {
  if (skipWithoutElectron(t)) return;
  const dataDir = tempDataDir("packrat-ui-handoffs-", { demoScans: true });
  const { page, errors, close } = await launch(dataDir);
  try {
    await openBuilder(page);
    await page.click('#b-mode [data-value="manual"]');
    await page.waitForSelector("#b-manual:not([hidden]) #mb-suit .mb-slot");
    // one placed piece: the first ring in the picker
    await page.click('.mb-slot-pick[data-slot="ring"]');
    const row = page.locator("#mb-picker tbody tr.item").first();
    await row.waitFor();
    const ringName = (await row.locator("td").first().innerText()).trim();
    await row.click();
    await page.waitForFunction((n) => document.querySelector('.mb-slot-pick[data-slot="ring"]')?.textContent?.includes(n), ringName);
    await page.keyboard.press("Escape");
    const filled = (): Promise<number> => page.locator("#mb-suit .mb-slot:not(.mb-empty)").count();
    assert.equal(await filled(), 1);
    // another character picked while a fill runs: the fill is canceled, and nothing lands in the shared suit
    await page.evaluate(() => {
      document.querySelector<HTMLButtonElement>("#mb-fill")!.click();
      const pick = document.querySelector<HTMLButtonElement>("#b-char")!, now = pick.dataset.value;
      pick.click();
      [...document.querySelectorAll<HTMLElement>(".pop [role=option]")].find((o) => o.dataset.value !== "_nobody" && o.dataset.value !== now)!.click();
    });
    await page.waitForFunction(() => document.querySelector(".mb-fill")?.textContent === "Fill canceled: the character changed");
    await page.waitForTimeout(1500);   // sleep: longer than the canceled search could take to land, proving it never does
    assert.equal(await filled(), 1, "the canceled fill left the suit alone");
    await page.click("#b-settings");
    await page.locator("#b-drawer").waitFor();
    assert.match(await page.locator(".overlay-sub:has(#b-drawer-tpl)").innerText(), /^Shared with Automatic · /);
    assert.equal(await page.locator("#b-tab-buffs").isVisible(), false, "Manual has its own buffs bar");
    assert.equal(await page.locator("#b-run-foot").isVisible(), false);
    assert.equal(await page.locator("#b-save-tpl").isVisible(), false);
    assert.match(await page.locator("#b-changes").innerText(), /^Fill plans the \d+ empty slots with these$/);
    await page.click("#b-fill-foot");
    assert.equal(await page.locator("#b-drawer").isVisible(), false, "the drawer closes onto the fill's progress");
    await page.waitForFunction(() => /^(Filled|Nothing filled)/.test(document.querySelector(".mb-fill")?.textContent || ""), undefined, { timeout: 60_000 });
    assert.ok(await filled() > 1, "the search filled empty slots");
    assert.match(await page.locator('.mb-slot-pick[data-slot="ring"]').innerText(), new RegExp(ringName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), "the placed ring stays");
    assert.match(await page.locator("#mb-undo").getAttribute("aria-label") || "", /^Undo: Fill the rest: \d+ slots?/, "one undo step");
    assert.ok(await page.locator("#mb-fetch").isVisible(), "the fetch list shows the pieces to fetch");
    assert.ok(await page.locator("#mb-fetch #mb-grab-all").count(), "with its Grab all");
    // a buff on in Manual, which a result planned without buffs takes off (and undo puts back)
    await page.click("#bf-add");
    await page.locator("#bf-cb-divineFury").check();
    await page.keyboard.press("Escape");
    const fury = page.locator('#mb-totals .bf-strip .token[data-buff="divineFury"]');
    await fury.waitFor();
    // Save as run, then open it from the drawer: the result view, a manual run, with Open in Manual
    await page.click("#mb-save-run");
    await page.waitForFunction(() => Number(document.querySelector("#b-runs-count")?.textContent) >= 1);
    await page.click("#b-runs-open");
    const card = page.locator("#b-runs .run-card").first();
    assert.match(await card.innerText(), /Manual[\s\S]*Suit built by hand/);
    await card.locator(".btn-icon").click();
    await page.click('.pop-over-drawer [role="menuitem"]:has-text("Open")');
    await page.waitForFunction(() => /Manual suit for/.test(document.querySelector("#b-result h2")?.textContent || ""));
    assert.equal(await page.locator("#b-manual").isVisible(), false, "the run shows in Automatic's result view");
    assert.equal(await page.locator("#b-to-manual").innerText(), "Open in Manual");
    // an Automatic result into Manual: Build, then Start from this result, one undo step
    await pressBuild(page);
    await built(page);
    await page.click("#b-to-manual");
    await page.waitForSelector("#b-manual:not([hidden]) #mb-suit .mb-slot");
    assert.match(await page.locator("#mb-undo").getAttribute("aria-label") || "", /^Undo: Start from the result/);
    assert.equal(await fury.count(), 0, "the result's buffs (none) replace Manual's");
    await page.click("#mb-undo");
    await fury.waitFor();
    assert.deepEqual(errors, []);
  } finally {
    await close();
  }
});

// Issue #12, No character in Automatic: its own panel (no Race row), its build headed "Best suit · No character" with Grab
// disabled while no bridge is online, its run in the drawer, Save profile kept across a reload, Manual on its No
// character, and a character picked again showing that character's own panel.
test("[slow] No character: built in Automatic from its own profile, saved as a run, kept by Save profile, shared with Manual (issue #12)", async (t) => {
  if (skipWithoutElectron(t)) return;
  const dataDir = tempDataDir("packrat-ui-nobody-", { demoScans: true });
  const { page, errors, close } = await launch(dataDir);
  try {
    await openBuilder(page);
    await pickCharacter(page, "_nobody");
    await page.waitForFunction(() => document.querySelector("#b-start h2")?.textContent === "What should the suit be for?");
    assert.equal(await page.locator("#b-wearing").count(), 0, "nothing worn to show");
    assert.equal(await page.locator("#b-race").count(), 0, "no Race row");
    const noPseudo = async (where: string): Promise<void> => assert.doesNotMatch(await page.evaluate(() => document.body.innerText), /_nobody/, `no "_nobody" in the page text (${where})`);
    // the buff picker speaks of no character, not of "_nobody"
    await settings(page, "buffs");
    await page.click("#b-buff-add");
    await page.locator("#abf-h").waitFor();
    assert.equal(await page.locator("#abf-h").innerText(), "Buffs");
    assert.match(await page.locator(".pop .bf-status").innerText(), /no character: every skill at 120/);
    await noPseudo("buff picker");
    await page.keyboard.press("Escape");
    await settings(page, "advanced");
    assert.ok(await page.locator("#b-str").isVisible(), "STR limit stays");
    await closeSettings(page);
    await pickTemplate(page, "builtin:caster");
    await settings(page, "requirements");
    await page.locator("#b-sec-req .rule-row[data-key=lrc]").waitFor();
    assert.equal(await page.locator("#b-sec-req .rule-row[data-key=lrc] input[type=number]").inputValue(), "100");
    assert.equal(await page.locator("#b-sec-req .rule-row[data-key=lmc] input[type=number]").inputValue(), "40");
    await page.click("#b-run-foot");
    await page.waitForFunction(() => !document.querySelector<HTMLButtonElement>("#b-run")?.disabled && document.querySelector("#b-result h2")?.textContent === "Best suit · No character", undefined, { timeout: 60_000 });
    assert.equal(await page.locator("#b-grab-all").isDisabled(), true);
    await closeSettings(page);
    await page.hover("#b-result .tipwrap:has(#b-grab-all)");
    await page.waitForFunction(() => [...document.querySelectorAll(".tip")].some((e) => e.textContent === "Log a character in to grab"));
    // the result's after-the-change card is the dark doll card (layout 2A, issue #57): the stand-in body under "Suit totals"
    assert.equal(await page.locator("#b-result .doll-card .doll-name h2").innerText(), "Suit totals");
    assert.equal(await page.locator("#b-result .doll-card[data-mode=dark]").count(), 1);
    await noPseudo("result");
    // with a bridge online on Kestrel, Grab puts the pieces in her backpack and the toast names her
    const queued: Array<{ action: string; serial: number }> = [];
    await page.route("**/api/bridge/status", (r) => r.fulfill({ json: { ok: true, online: true, character: "Kestrel", results: {} } }));
    await page.route((u) => u.pathname === "/api/bridge", (r) => { queued.push(r.request().postDataJSON()); return r.fulfill({ json: { ok: true, id: `t${queued.length}` } }); });
    await page.waitForFunction(() => /^Grab all \d+$/.test(document.querySelector("#b-grab-all")?.textContent || ""), undefined, { timeout: 10_000 });
    const n = Number((await page.locator("#b-grab-all").innerText()).replace(/\D/g, ""));
    await page.click("#b-grab-all");
    await page.waitForFunction((k) => new RegExp(`${k} grabs? queued for Kestrel`).test(document.body.textContent || ""), n, { timeout: 15_000 });
    assert.equal(queued.length, n);
    assert.ok(queued.every((q) => q.action === "grab"), JSON.stringify(queued));
    await page.unrouteAll({ behavior: "ignoreErrors" });
    await page.waitForFunction(() => document.querySelector<HTMLButtonElement>("#b-grab-all")?.disabled === true, undefined, { timeout: 10_000 });
    await page.waitForFunction(() => Number(document.querySelector("#b-runs-count")?.textContent) >= 1);
    await page.click("#b-runs-open");
    await page.waitForSelector("#runs-drawer:not([hidden]) .run-card");
    assert.match(await page.locator("#b-runs-who").innerText(), /^No character · 1 run/);
    await page.keyboard.press("Escape");
    // Save profile, then a reload comes back to No character with its requirements
    await settings(page, "requirements");
    await page.click("#b-save");
    await page.waitForFunction(() => /Profile for No character saved/.test(document.body.textContent || ""), undefined, { timeout: 10_000 });
    const saved = JSON.parse(readFileSync(join(dataDir, "profiles.json"), "utf8")) as { characters: Record<string, { spec: { intent: { floors: Record<string, number> } } }> };
    assert.equal(saved.characters._nobody!.spec.intent.floors.lrc, 100);
    await page.reload();
    await page.waitForSelector("body:has(#tab-builder:not([hidden])) #b-sec-req .rule-row[data-key=lrc]", { state: "attached", timeout: 30_000 });
    assert.equal(await page.getAttribute("#b-char", "data-value"), "_nobody");
    assert.equal(await page.locator("#b-race").count(), 0);
    // Manual shows its No character; a character picked back in Automatic has its own panel
    await page.click('#b-mode [data-value="manual"]');
    await page.waitForSelector("#b-manual:not([hidden]) #mb-suit .mb-slot");
    assert.equal(await page.getAttribute("#b-char", "data-value"), "_nobody");
    assert.equal(await page.locator("#mb-worn").count(), 0, "no worn suit to start from");
    await noPseudo("Manual");
    await page.click('#b-mode [data-value="automatic"]');
    await pickCharacter(page, "Kestrel");
    await page.waitForFunction(() => document.querySelector("#b-start h2")?.textContent === "What should Kestrel's suit be for?");
    assert.equal(await page.locator("#b-race").count(), 1);
    assert.deepEqual(errors, []);
  } finally {
    await close();
  }
});

// Issue #535: with a character picked, Manual's fetch list follows the bridge, as the result's does: its Grab buttons go
// live when the bridge comes online and off again when it goes away.
test("[slow] Manual's fetch list with a character follows the bridge: Grab goes live online and off offline (issue #535)", async (t) => {
  if (skipWithoutElectron(t)) return;
  const dataDir = tempDataDir("packrat-ui-manual-bridge-", { demoScans: true });
  const { page, errors, close } = await launch(dataDir);
  try {
    await openBuilder(page);
    await pickCharacter(page, "Kestrel");
    await page.click('#b-mode [data-value="manual"]');
    await page.waitForSelector("#b-manual:not([hidden]) #mb-suit .mb-slot");
    assert.equal(await page.getAttribute("#b-char", "data-value"), "Kestrel");
    // a ring Kestrel neither wears nor carries, so the fetch list has something to grab
    await page.click('.mb-slot-pick[data-slot="ring"]');
    const rows = page.locator("#mb-picker tbody tr.item");
    await rows.first().waitFor();
    const grabAll = page.locator("#mb-fetch #mb-grab-all");
    for (let i = 0; i < await rows.count(); i++) {
      const name = (await rows.nth(i).locator("td").first().innerText()).trim();
      await rows.nth(i).click();
      await page.waitForFunction((n) => document.querySelector('.mb-slot-pick[data-slot="ring"]')?.textContent?.includes(n), name);
      if (await grabAll.count() && /^Grab all \d+$/.test((await grabAll.innerText()).trim())) break;
    }
    await page.keyboard.press("Escape");
    assert.match((await grabAll.innerText()).trim(), /^Grab all \d+$/, "a piece to fetch");
    assert.equal(await grabAll.isDisabled(), true, "offline, Grab all is off");
    const placeGrab = page.locator("#mb-fetch .b-fetch-acts button", { hasText: "Grab" }).first();
    assert.equal(await placeGrab.isDisabled(), true, "and so is the place's Grab");
    await page.route("**/api/bridge/status", (r) => r.fulfill({ json: { ok: true, online: true, character: "Kestrel", results: {} } }));
    await page.waitForFunction(() => document.querySelector<HTMLButtonElement>("#mb-fetch #mb-grab-all")?.disabled === false, undefined, { timeout: 10_000 });
    assert.equal(await placeGrab.isDisabled(), false, "online, the place's Grab is live too");
    await page.unrouteAll({ behavior: "ignoreErrors" });
    await page.waitForFunction(() => document.querySelector<HTMLButtonElement>("#mb-fetch #mb-grab-all")?.disabled === true, undefined, { timeout: 10_000 });
    assert.equal(await placeGrab.isDisabled(), true, "offline again, off again");
    assert.deepEqual(errors, []);
  } finally {
    await close();
  }
});
