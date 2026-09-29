// electron-window.mts — the Electron UI tests' one way to size the window (docs/ui.md, TESTING.md). The rule:
// no test emulates a viewport larger than the real window (page.setViewportSize draws a wide layout inside a
// narrow window, and the player never sees that page). A test asks for the size it wants; the window is set to
// that size clamped to the screen's work area, and the test reads back the width it really got and drives the
// layout that width shows (a collapsed sidebar, facet chips folded into "+ Filter" below 1180 px). An assertion
// only reachable above the real width is skipped with that reason, and still runs where the screen allows.
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Readable } from "node:stream";
import type { ElectronApplication, Page } from "playwright";
import { DEFAULT_SHARD } from "../app/rules.mts";

// On Linux each test file that imports this gets an X display of its own. The runner runs the Electron files
// in parallel, and under one shared display (CI's `xvfb-run`, which has no window manager) every window opens
// at the same spot and the X input focus moves to whichever window was shown last: the others lose focus, so
// their focus and hover tooltips close or never open. Without Xvfb installed the shared display is kept.
// Launches that pass no `env` inherit process.env, and testEnv() copies it, so both pick the new DISPLAY.
async function ownDisplay(): Promise<void> {
  const xvfb = spawn("Xvfb", ["-displayfd", "3", "-screen", "0", "1280x1024x24", "-nolisten", "tcp"], { stdio: ["ignore", "ignore", "ignore", "pipe"] });
  const fd = xvfb.stdio[3] as Readable;
  const display = await new Promise<string | null>((resolve) => {
    let out = "";
    fd.on("data", (d: Buffer) => { out += String(d); if (out.includes("\n")) resolve(out.trim()); });
    xvfb.on("error", () => resolve(null));
    xvfb.on("exit", () => resolve(null));
  });
  fd.destroy();
  if (!display) {
    console.warn("electron-window: could not start Xvfb, so this file shares the display with the others");
    return;
  }
  process.env.DISPLAY = `:${display}`;
  xvfb.unref();
  process.on("exit", () => xvfb.kill());
}
if (process.platform === "linux") await ownDisplay();

export interface RealSize { width: number; height: number }

// Resize the window's content area towards `want`, within the work area of the display it is on, move it fully
// on screen, and resolve with the page's real innerWidth/innerHeight once they have settled.
// PACKRAT_TEST_SCREEN=<width>x<height> stands in for a smaller screen (a CI runner's), so the narrow paths can
// be run on a big one: `PACKRAT_TEST_SCREEN=1000x700 node --test scripts/ui-*.test.mts`.
function testScreen(): RealSize | null {
  const m = /^(\d+)x(\d+)$/.exec(process.env.PACKRAT_TEST_SCREEN || "");
  return m ? { width: +m[1]!, height: +m[2]! } : null;
}
export async function fitWindow(app: ElectronApplication, page: Page, want: RealSize): Promise<RealSize> {
  const cap = testScreen();
  if (cap) want = { width: Math.min(want.width, cap.width), height: Math.min(want.height, cap.height) };
  const target = await app.evaluate(({ BrowserWindow, screen }, w) => {
    const win = BrowserWindow.getAllWindows()[0]!;
    const { workArea } = screen.getDisplayMatching(win.getBounds());
    const [outerW, outerH] = win.getSize(), [innerW, innerH] = win.getContentSize();
    const frameW = outerW! - innerW!, frameH = outerH! - innerH!;
    const width = Math.min(w.width, workArea.width - frameW), height = Math.min(w.height, workArea.height - frameH);
    win.setPosition(workArea.x, workArea.y);
    win.setContentSize(width, height);
    return { width, height };
  }, want);
  // The resize reaches the page asynchronously; wait until the viewport matches it (or stops changing).
  let last = { width: -1, height: -1 };
  for (let i = 0; i < 40; i++) {
    const got = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    if ((got.width === target.width && got.height === target.height) || (got.width === last.width && got.height === last.height && i > 4)) return got;
    last = got;
    await page.waitForTimeout(50);
  }
  return last;
}

// The Inventory's facet chips fold into "+ Filter" below 1180 px (spec 3.7) unless they hold a value. Opens
// the facet's panel whichever way this width shows it.
export async function openFacet(page: Page, id: string, name: string): Promise<void> {
  const chip = page.locator(`#f-${id}`);
  if (await chip.isVisible()) { await chip.click(); return; }
  await page.click("#f-add");
  await page.getByRole("menuitem", { name: `${name}…` }).click();
}

// The Inventory's List | Grouped switch sits in the toolbar, or inside table settings below 1180 px.
export async function setRows(page: Page, view: "List" | "Grouped"): Promise<void> {
  const inline = page.locator("#inv-rows");
  if (await inline.isVisible()) { await inline.getByRole("radio", { name: view }).click(); return; }
  await page.click("#inv-settings");
  await page.locator(".pop").getByRole("radiogroup", { name: "Rows" }).getByRole("radio", { name: view }).click();
  await page.keyboard.press("Escape");
}

// The environment every Electron UI test launches the app with: the test's own process.env plus
// PACKRAT_CLIENT_HOME, a throwaway folder the server searches for game clients instead of the real home
// (app/vault-server.mts's defaultClientSearch). Without it a test run finds the machine's real client
// folders and reads their packrat-paths.json, and the page shows the player's own paths. One empty home per
// test process unless a test passes its own (to plant a client in it); `extra` adds variables.
let sharedHome: string | null = null;
export function testEnv(extra: Record<string, string> = {}, home?: string): Record<string, string> {
  if (!home) {
    if (!sharedHome) {
      const made = mkdtempSync(join(tmpdir(), "packrat-client-home-"));
      process.on("exit", () => rmSync(made, { recursive: true, force: true }));
      sharedHome = made;
    }
    home = sharedHome;
  }
  // Playwright's `env` wants plain strings; process.env's entries are, at runtime.
  return { ...(process.env as Record<string, string>), PACKRAT_CLIENT_HOME: home, ...extra };
}

// The data folder every Electron UI test launches the app with, passed through this first: it turns the
// automatic update check (#67, on by default) off in that folder's settings.json, keeping whatever the test
// wrote there, so no launch asks GitHub for the latest release. A test of the check turns it back on itself,
// with GET /api/update-check mocked.
export function noUpdateCheck(dataDir: string): string {
  const file = join(dataDir, "settings.json");
  let doc: Record<string, unknown> = { schemaVersion: 1, shard: DEFAULT_SHARD };
  try { doc = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>; } catch { /* none yet: the app's own default */ }
  writeFileSync(file, JSON.stringify({ ...doc, autoUpdateCheck: false }));
  return dataDir;
}
