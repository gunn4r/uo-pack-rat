// ui-components.test.mts — [slow]: app/ui/components.mts's overlays and keyboard behaviour, in the real
// Electron window (same launch as scripts/ui-smoke.test.mts). The builders' structure is unit-tested in
// app/ui-components.test.mts on a fake DOM; what needs a browser is here: the confirm dialog's focus and
// answers, the drawer's focus trap, Esc, inert-when-closed and focus return, the popover's light dismiss,
// the toast stack, the tooltip on focus, and — measured on the rendered page — that no flex or grid
// container the builders draw holds a bare text node. Skipped when electron or playwright is absent, or
// under TEST_SKIP_ELECTRON.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
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
async function launch(dataDir: string): Promise<{ app: ElectronApplication; page: Page; errors: string[] }> {
  const { _electron } = await import("playwright");
  const app = await _electron.launch({ args: [ROOT, "--demo", "--data", dataDir], cwd: ROOT, timeout: 60_000 });
  const page = await app.firstWindow();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  return { app, page, errors };
}
const activeId = (page: Page): Promise<string> => page.evaluate(() => (document.activeElement as HTMLElement | null)?.id || document.activeElement?.getAttribute("aria-label") || document.activeElement?.tagName || "");

test("[slow] components: confirm dialog, drawer, popover, toasts and tooltip behave, and no flex container holds bare text", async (t) => {
  const why = unavailable();
  if (why) return t.skip(why);
  const dataDir = mkdtempSync(join(tmpdir(), "packrat-components-"));
  writeFileSync(join(dataDir, "settings.json"), JSON.stringify({ schemaVersion: 1, shard: "uoalive", setupDone: true }));
  const { app, page, errors } = await launch(dataDir);
  try {
    await page.locator("#inv-table tbody tr.item").first().waitFor({ timeout: 30_000 });
    // A test bench of the builders, appended to the page; window.C is the module, as the page loads it.
    await page.evaluate(async () => {
      const C = await import("/ui/components.mjs" as string);
      (window as unknown as { C: unknown }).C = C;
      const bench = document.createElement("div");
      bench.id = "bench";
      bench.style.cssText = "position:fixed;left:0;top:0;width:900px;background:var(--color-bg);z-index:5;padding:8px";
      const opener = C.button({ label: "Open", attrs: { id: "opener" } });
      const anchor = C.filterChip({ label: "Slot", attrs: { id: "anchor" } });
      const tipped = C.button({ label: "Hint", attrs: { id: "tipped" } });
      C.tooltip(tipped, "Bridge offline. Press Play on packrat-bridge.py in game.");
      bench.append(opener, anchor, tipped,
        C.segmented({ label: "View", options: [{ value: "a", label: "Items" }, { value: "b", label: "Containers" }], value: "a" }),
        C.token({ label: "Kind: gear", removeLabel: "Remove filter: Kind", onRemove: () => {} }),
        C.pill({ label: "cursed", pressed: true, off: true }), C.badge("Proven optimal", "ok"), C.tag("Antique", "warn"),
        C.message({ tone: "warn", title: "Heads up", text: "Something to know." }), C.meter(41, 70, { tone: "ok" }),
        C.stepper(["Shard", "Client", "Folder"], 1), C.keyValue([["Strength", "110"]]),
        C.switchControl({ label: "Meditation-safe only", checked: true }).root,
        C.field({ label: "Restarts", control: C.input({ type: "number", value: 300000 }), error: "Enter a whole number from 1 to 10,000." }),
        C.card({ title: "Card", actions: [C.button({ label: "Act", size: "sm" })], body: [C.tableFoot("1 stack", "1 piece")] }),
        C.table({ label: "T", columns: [{ label: "Name", sort: "ascending" }], rows: [{ cells: ["Arcane Ring"] }] }),
        C.rowActions([{ label: "Grab", icon: "grab", onClick: () => {} }, { label: "Go to", icon: "goto", onClick: () => {}, disabled: "Bridge offline." }]));
      document.body.append(bench);
    });

    // --- rendered one-span lint over everything the builders drew
    const split = await page.evaluate(() => {
      const bad: string[] = [];
      for (const el of document.querySelectorAll("#bench *")) {
        const d = getComputedStyle(el).display;
        if (!/flex|grid/.test(d)) continue;
        if ([...el.childNodes].some((n) => n.nodeType === 3 && (n.textContent || "").trim())) bad.push(`<${el.tagName.toLowerCase()} class="${el.className}">`);
      }
      return bad;
    });
    assert.deepEqual(split, [], "flex/grid containers holding bare text");

    // --- confirm dialog: Cancel focused; Esc and Cancel say no; the confirming button says yes; focus returns
    await page.focus("#opener");
    const answer = (click: string | null) => page.evaluate(async (sel) => {
      const C = (window as unknown as { C: { confirmDialog: (o: object) => Promise<boolean> } }).C;
      const p = C.confirmDialog({ title: "Forget Dorran?", body: "Their card leaves the inventory.", confirmLabel: "Forget Dorran" });
      await new Promise((r) => setTimeout(r, 50));
      const d = document.querySelector("dialog.dialog[open]")!;
      const info = { role: d.getAttribute("role"), focused: (document.activeElement as HTMLElement).dataset.cancel === "", danger: !!d.querySelector("[data-confirm].btn-danger") };
      if (sel) d.querySelector<HTMLElement>(sel)!.click(); else d.dispatchEvent(new Event("cancel", { cancelable: true }));
      return { ...info, result: await p, left: document.querySelectorAll("dialog.dialog").length };
    }, click);
    for (const [sel, want] of [["[data-confirm]", true], ["[data-cancel]", false], [null, false]] as const) {
      const r = await answer(sel);
      assert.deepEqual(r, { role: "alertdialog", focused: true, danger: true, result: want, left: 0 }, `answer via ${sel ?? "Esc"}`);
    }
    assert.equal(await activeId(page), "opener", "focus returns to what opened the dialog");

    // --- drawer: closed = hidden + inert; open traps Tab and takes Esc; focus returns to the opener
    await page.evaluate(() => {
      const C = (window as unknown as { C: Record<string, (...a: unknown[]) => unknown> }).C;
      const b1 = C.button!({ label: "One", attrs: { id: "d-one" } }), b2 = C.button!({ label: "Two", attrs: { id: "d-two" } });
      (window as unknown as { D: unknown }).D = C.createDrawer!({ id: "test-drawer", title: "Test drawer", subtitle: "sub", body: [b1, b2] });
    });
    assert.deepEqual(await page.evaluate(() => { const r = document.getElementById("test-drawer")!; return [r.hidden, r.inert]; }), [true, true]);
    await page.focus("#opener");
    await page.evaluate(() => (window as unknown as { D: { open: (o: Element | null) => void } }).D.open(document.getElementById("opener")));
    assert.equal(await activeId(page), "d-one", "focus moves into the drawer");
    await page.keyboard.press("Shift+Tab");
    assert.equal(await activeId(page), "Close Test drawer", "Shift+Tab from the first control goes to the close button, still inside");
    await page.keyboard.press("Shift+Tab");
    assert.equal(await activeId(page), "d-two", "and wraps to the last control, never out of the drawer");
    await page.keyboard.press("Tab");
    assert.equal(await activeId(page), "Close Test drawer", "Tab from the last control wraps to the first");
    await page.keyboard.press("Escape");
    assert.deepEqual(await page.evaluate(() => { const r = document.getElementById("test-drawer")!; return [r.hidden, r.inert]; }), [true, true], "Esc closes it back to hidden + inert");
    assert.equal(await activeId(page), "opener", "focus returns to the opener");

    // --- popover: opens anchored, Esc closes and returns focus, a click outside closes it
    await page.evaluate(() => {
      const C = (window as unknown as { C: Record<string, (...a: unknown[]) => unknown> }).C;
      C.popover!(document.getElementById("anchor"), [C.button!({ label: "Inside", attrs: { id: "pop-in" } })], { label: "Slot filter" });
    });
    assert.equal(await page.getAttribute("#anchor", "aria-expanded"), "true");
    assert.equal(await activeId(page), "pop-in", "focus moves into the popover");
    await page.keyboard.press("Escape");
    assert.equal(await page.locator(".pop").count(), 0);
    assert.equal(await activeId(page), "anchor", "focus returns to the anchor");
    assert.equal(await page.getAttribute("#anchor", "aria-expanded"), "false");
    await page.evaluate(() => { const C = (window as unknown as { C: Record<string, (...a: unknown[]) => unknown> }).C; C.popover!(document.getElementById("anchor"), [C.txt!("x")], { label: "Slot filter" }); });
    await page.mouse.click(1200, 800);
    assert.equal(await page.locator(".pop").count(), 0, "a click outside closes it");

    // --- toasts: bottom-right stack of at most three; an error is an alert and stays
    await page.evaluate(() => { const C = (window as unknown as { C: { showToast: (t: string, tone?: string) => void } }).C; C.showToast("one", "ok"); C.showToast("two"); C.showToast("three", "bad"); C.showToast("four", "ok"); });
    assert.deepEqual(await page.locator("#toasts .toast .toast-text").allInnerTexts(), ["two", "three", "four"]);
    assert.equal(await page.locator("#toasts .toast.bad").getAttribute("role"), "alert");
    await page.locator("#toasts .toast.bad").getByRole("button", { name: "Dismiss" }).click();
    assert.deepEqual(await page.locator("#toasts .toast .toast-text").allInnerTexts(), ["two", "four"]);

    // --- tooltip: keyboard focus shows it, and the control is described by it
    await page.focus("#tipped");
    const tip = page.locator(".tip[role=tooltip]");
    await tip.waitFor({ timeout: 2_000 });
    assert.equal(await tip.innerText(), "Bridge offline. Press Play on packrat-bridge.py in game.");
    assert.equal(await page.getAttribute("#tipped", "aria-describedby"), await tip.getAttribute("id"));

    assert.deepEqual(errors, []);
  } finally {
    await app.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});
