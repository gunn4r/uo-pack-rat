// ui/app.mts — bootstrap: load(), screen and drawer switching, tab-nav wiring, the tooltip/bridge kickoff.
// Moved verbatim out of index.html's inline <script type="module"> (Task 4, the page split). The routes and the
// screen registry are nav.mts; reload() and the inventorychange event are inventory-data.mts.
import { setRules } from "../vault-lib.mts";
import { state } from "./store.mts";
import { $, el, installTooltip } from "./dom.mts";
import { api } from "./api.mts";
import { pollBridge } from "./bridge.mts";
import { fetchItems, initFilters, applyUiPrefs, inventoryFailed } from "./inventory.mts";
import { showCharacter } from "./characters.mts";
import { initBuilder, applyAutoBuffPrefs } from "./builder.mts";
import { applyBuilderPrefs } from "./builder-manual.mts";
import { renderContainers } from "./containers.mts";
import { scrollsChanged } from "./scrolls.mts";
import { connectEvents } from "./events.mts";
import { openWizard } from "./wizard.mts";
import { renderSettings, startUpdateChecks } from "./settings.mts";
import { setCopiedScanner } from "./paste-scanner.mts";
import { renderImport, importDrawer } from "./import.mts";
import { applyLook } from "./theme.mts";
import { initShell, applyShellPrefs, setCurrentNav } from "./shell.mts";
import { segmented, clearToasts, closePopover } from "./components.mts";
import { openRunsDrawer, closeRunsDrawer } from "./runs.mts";
import "./organize.mts";   // registers its route and its inventorychange listener; nothing else imports it
import { applyMapPrefs } from "./house-map.mts";
import { parseRoute, routeFor, showRoute } from "./nav.mts";
import { get, reload, setPageLoad } from "./inventory-data.mts";
import type { SettingsApiResponse, RulesApiResponse, SetupApiResponse, UiPrefsApiResponse } from "./api-types.mts";

// ---------------------------------------------------------------- data
// The panels a failed load has to say something in, instead of leaving them on "loading…" or empty.
// The inventory-backed tabs depend on /api/inventory and /api/profiles; Settings and Import only on the
// first three routes.
// The Inventory screen says it in its own table card (inventory.mts's inventoryFailed).
const DATA_PANELS = ["#char-body", "#b-result", "#map-body"];
const SETUP_PANELS = ["#settings-body", "#import-body"];
function loadFailed(e: unknown, panels: string[]): void {
  const msg = `Could not load: ${(e as Error).message}`;
  $<HTMLElement>("#status")!.textContent = "failed to load: " + (e as Error).message;
  for (const sel of panels) {
    const node = $<HTMLElement>(sel)!;
    const panel = el("div", { class: "panel empty" }, el("div", { class: "msg bad" }, msg), "Reload the page once the data folder is fixed; the Settings tab can open it.");
    node.replaceChildren(node.tagName === "TBODY" ? el("tr", {}, el("td", { colspan: 20 }, panel)) : panel);
  }
  inventoryFailed(e);
}
let wired = false;
async function load(): Promise<void> {
  // The shard's rules (property caps, the Resisting Spells formula, race caps, tag units, the rarity
  // ladder, the free-skill list) must be loaded before anything that reads them, so this fetch and
  // setRules() run before the inventory/profiles load below. /api/ui-prefs never fails the load: the
  // default columns stand in for it.
  let settingsRes: SettingsApiResponse, rulesRes: RulesApiResponse, setupRes: SetupApiResponse, prefs: UiPrefsApiResponse | null;
  try {
    [settingsRes, rulesRes, setupRes, prefs] = await Promise.all([get<SettingsApiResponse>("/api/settings"), get<RulesApiResponse>("/api/rules"), get<SetupApiResponse>("/api/setup"), api<UiPrefsApiResponse>("/api/ui-prefs").catch(() => null)]);
  } catch (e) { loadFailed(e, [...DATA_PANELS, ...SETUP_PANELS]); return; }
  state.settings = settingsRes.settings;
  state.rules = rulesRes.rules;
  state.availableShards = rulesRes.available;
  state.setup = setupRes;
  setRules(state.rules);
  applyUiPrefs(prefs ? prefs.prefs : null);
  state.sheetProps = prefs?.prefs.sheetProps ?? null;
  applyLook(prefs ? prefs.prefs : null);
  applyShellPrefs(prefs ? prefs.prefs : null);
  applyMapPrefs(prefs ? prefs.prefs : null);
  applyBuilderPrefs(prefs ? prefs.prefs : null);
  applyAutoBuffPrefs(prefs ? prefs.prefs : null);
  // Settings, Import, the live-scan stream and the first-run wizard need nothing from the inventory,
  // so they come up before it: a failed inventory or profiles fetch must not take the Settings tab
  // (the page's way to the data folder) down with it.
  setCopiedScanner(prefs?.prefs.copiedScanner);
  renderSettings(setupRes);
  startUpdateChecks(prefs?.prefs.dismissedUpdate);
  renderImport();
  connectEvents();
  if (setupRes.firstRun && !state.wizardShown) { state.wizardShown = true; openWizard({ firstRun: true }); }
  if (!wired) { wired = true; initBuilder(); }
  try { await reload(); } catch (e) { loadFailed(e, DATA_PANELS); }
}

// ---------------------------------------------------------------- screens (the routes are nav.mts)
let lastScreen = "inventory";
const isInvView = (tab: string): boolean => tab === "inventory" || tab === "containers" || tab === "scrolls";
const screenOf = (tab: string): string => (isInvView(tab) ? "inventory" : tab === "runs" ? "builder" : tab === "import" ? lastScreen : tab);
// Inventory's Items | Containers | Scrolls switch (in its top bar) is a view of one screen, not a screen of its own.
type InvView = "items" | "containers" | "scrolls";
const invView = segmented({ label: "View", options: [{ value: "items", label: "Items" }, { value: "containers", label: "Containers" }, { value: "scrolls", label: "Scrolls" }], value: "items", onChange: (v) => { location.hash = v === "items" ? "#/inventory" : `#/${v}`; } });
invView.id = "inv-view";
$<HTMLElement>("#inv-view")!.replaceWith(invView);
function showInventoryView(view: InvView): void {
  invView.setValue(view);
  $<HTMLElement>("#inv-view-items")!.hidden = view !== "items";
  $<HTMLElement>("#tab-containers")!.hidden = view !== "containers";
  $<HTMLElement>("#tab-scrolls")!.hidden = view !== "scrolls";
}
function showTab(tab: string): void {
  const screen = screenOf(tab);
  if (screen !== lastScreen) clearToasts();   // a toast belongs to the page it was raised on
  closePopover();
  if (screen !== "map") document.title = "Pack Rat";   // the House map names the page after a named house (ui/house-map.mts)
  for (const sec of document.querySelectorAll<HTMLElement>(".screen")) sec.hidden = sec.id !== "tab-" + screen;
  setCurrentNav(isInvView(tab) ? "inventory" : tab);
  if (isInvView(tab)) showInventoryView(tab === "inventory" ? "items" : tab as InvView);
  if (tab !== "import") lastScreen = screen;
  if (tab === "import") importDrawer.open(); else importDrawer.close();
  if (tab === "runs") openRunsDrawer(); else if (screen !== "builder") closeRunsDrawer();
}
function applyRoute(): void {
  const r = parseRoute();
  showTab(r.tab);
  showRoute(r);
}
// A drawer the player closed (Esc, the scrim, ×) takes its route with it, without a history entry.
importDrawer.root.addEventListener("drawerclose", () => { if (parseRoute().tab === "import") { history.replaceState(null, "", routeFor(lastScreen)); setCurrentNav(lastScreen); } });
$<HTMLElement>("#runs-drawer")!.addEventListener("drawerclose", () => { if (parseRoute().tab === "runs") { history.replaceState(null, "", routeFor("builder")); setCurrentNav("builder"); } });
// A nav click goes to that screen's own route (the builder keeps its character).
for (const a of document.querySelectorAll<HTMLAnchorElement>("#sidebar [data-nav]")) a.addEventListener("click", (e) => {
  e.preventDefault();
  const next = routeFor(a.dataset.nav as string);
  if (location.hash === next) showTab(a.dataset.nav as string); else location.hash = next;
});
window.addEventListener("hashchange", applyRoute);
// A saved Organize setup changes how locations read: the Containers view and the Items rows redraw.
document.addEventListener("organizechange", () => { if (state.inv) { renderContainers(); fetchItems(); scrollsChanged(); } });
initShell();
initFilters();   // the Inventory's toolbar and loading skeleton, before any data arrives
showTab(parseRoute().tab);   // before the inventory loads, so a reload never flashes the wrong screen
showCharacter(parseRoute().sheet);   // and a reload on a sheet lands on that sheet

// A build left running when the tab closes would burn CPU for nothing: tell the server to drop it.
window.addEventListener("pagehide", () => { const j = state.builder.job; if (j?.id) navigator.sendBeacon(`/api/optimize/${j.id}/cancel`); });

// The look before any data arrives: the system's light/dark until the saved choice lands in load().
applyLook(null);
installTooltip();
setInterval(pollBridge, 2500); pollBridge();

setPageLoad(load);
load().catch((e) => { $<HTMLElement>("#status")!.textContent = "failed to load: " + (e as Error).message; });
