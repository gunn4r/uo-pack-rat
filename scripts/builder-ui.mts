// builder-ui.mts — the Suit Builder Electron tests' shared steps (scripts/ui-builder-*.test.mts): the launch at 1440 × 900, Auto Build Settings
// open on a tab and closed again, the Suit Builder opened with a quick time budget, Build pressed, and the wait for its result.
//
// map: tooling
// owns: `launch`, `settings`, `openBuilder`, `pressBuild`, `built`
import type { Page } from "playwright";
import { explained, launchApp, type App } from "./electron-app.mts";

export const launch = (dataDir: string): Promise<App> => launchApp(dataDir, { size: { width: 1440, height: 900 } });
// The Settings drawer (issue #272) open on one of its tabs, and closed again (the focus back on the Settings button). On the
// Goals tab, the weights the goals set are shown too (issue #292), unless `weights` is false.
export async function settings(page: Page, tab: "requirements" | "weights" | "buffs" | "pool" | "advanced", { weights = true }: { weights?: boolean } = {}): Promise<void> {
  if (await page.locator("#b-drawer").isHidden()) await page.click("#b-settings");
  await page.click(`#b-tab-${tab}`);
  const fine = page.locator("#b-finetune");
  if (tab === "weights" && weights && await fine.isVisible() && !await fine.isChecked()) await fine.check();
}
export async function closeSettings(page: Page): Promise<void> {
  if (await page.locator("#b-drawer").isVisible()) await page.click("#b-drawer-close");
}
// The Suit Builder with its first character's first-visit view showing, and a 2 s time budget so builds are quick.
export async function openBuilder(page: Page): Promise<void> {
  await explained(page, page.locator("#inv-table tbody tr.item").first().waitFor({ timeout: 30_000 }));
  await page.click('[data-nav="builder"]');
  await page.waitForSelector("#tab-builder:not([hidden]) #b-start", { timeout: 10_000 });
  await settings(page, "advanced");
  await page.fill("#b-budget", "2");
  await closeSettings(page);
}
// Build: the top bar's Build, or the drawer footer's while Auto Build Settings is open over the top bar (issue #320).
export async function pressBuild(page: Page): Promise<void> { await page.click(await page.locator("#b-drawer").isVisible() ? "#b-run-foot" : "#b-run"); }
export const built = (page: Page): Promise<void> => page.waitForFunction(() => !document.querySelector<HTMLButtonElement>("#b-run")?.disabled && /Best suit for/.test(document.querySelector("#b-result h2")?.textContent || ""), undefined, { timeout: 60_000 }).then(() => {});
