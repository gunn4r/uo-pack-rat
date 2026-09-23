// ui/app.mts — bootstrap: load(), the hash router, tab-nav wiring, the tooltip/bridge kickoff.
// Moved verbatim out of index.html's inline <script type="module"> (Task 4, the page split).
// `parseRoute`/`routeFor` are exported beyond the brief's explicit list because builder.mts's
// syncBuilderCharacters/selectCharacter call them directly (the router reaches into the builder for the
// #/builder/<name> deep link, and the builder reads the route back).
import { migrateProfiles, setRules } from "../vault-lib.mts";
import { state, newestStamp } from "./store.mts";
import { $, el, installTooltip } from "./dom.mts";
import { api } from "./api.mts";
import { pollBridge } from "./bridge.mts";
import { buildFilters, fetchItems, initFilters, applyUiPrefs } from "./inventory.mts";
import { renderCharacters, showCharacter } from "./characters.mts";
import { initBuilder, syncBuilderCharacters, selectCharacter } from "./builder.mts";
import { renderContainers } from "./containers.mts";
import { connectEvents } from "./events.mts";
import { openWizard } from "./wizard.mts";
import { renderSettings, syncSettingsCharacters } from "./settings.mts";
import { renderImport } from "./import.mts";
import { applyLook } from "./theme.mts";
import { initShell, applyShellPrefs, renderNavCounts, setCurrentNav } from "./shell.mts";
import { bindDrawer, segmented, clearToasts, closePopover } from "./components.mts";
import { openRunsDrawer, closeRunsDrawer } from "./runs.mts";
import type { SettingsApiResponse, RulesApiResponse, SetupApiResponse, InventoryApiResponse, ProfilesApiResponse, UiPrefsApiResponse } from "./api-types.mts";

// ---------------------------------------------------------------- data
// The panels a failed load has to say something in, instead of leaving them on "loading…" or empty.
// The inventory-backed tabs depend on /api/inventory and /api/profiles; Settings and Import only on the
// first three routes.
const DATA_PANELS = ["#inv-table tbody", "#char-body", "#b-result", "#cont-table tbody"];
const SETUP_PANELS = ["#settings-body", "#import-body"];
function loadFailed(e: unknown, panels: string[]): void {
  const msg = `Could not load: ${(e as Error).message}`;
  $<HTMLElement>("#status")!.textContent = "failed to load: " + (e as Error).message;
  for (const sel of panels) {
    const node = $<HTMLElement>(sel)!;
    const panel = el("div", { class: "panel empty" }, el("div", { class: "msg bad" }, msg), "Reload the page once the data folder is fixed; the Settings tab can open it.");
    node.replaceChildren(node.tagName === "TBODY" ? el("tr", {}, el("td", { colspan: 20 }, panel)) : panel);
  }
}
// api() throws with the server's own message ("internal error"); the panels above also need to know
// which request it was.
function get<T>(path: string): Promise<T> { return api<T>(path).catch((e: Error) => { throw new Error(`${path} failed: ${e.message}`); }); }

let wired = false;
export async function load(): Promise<void> {
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
  applyLook(prefs ? prefs.prefs : null);
  applyShellPrefs(prefs ? prefs.prefs : null);
  // Settings, Import, the live-scan stream and the first-run wizard need nothing from the inventory,
  // so they come up before it: a failed inventory or profiles fetch must not take the Settings tab
  // (the page's way to the data folder) down with it.
  renderSettings(setupRes);
  renderImport();
  connectEvents();
  if (setupRes.firstRun && !state.wizardShown) { state.wizardShown = true; openWizard({ firstRun: true }); }
  if (!wired) { wired = true; initFilters(); initBuilder(); }
  try { await reload(); } catch (e) { loadFailed(e, DATA_PANELS); }
}

// The data half of load(): inventory and profiles, and everything drawn from them. A live scan landing
// (events.mts, the "inventory" SSE event) and Forget run just this; rules/settings/setup don't change
// from a scan. It keeps the visible tab, the filters, the page and the builder's character and sidebar.
export async function reload(): Promise<void> {
  const [inv, prof] = await Promise.all([get<InventoryApiResponse>("/api/inventory"), get<ProfilesApiResponse>("/api/profiles")]);
  state.inv = inv.inventory; state.profiles = migrateProfiles(prof.profiles).profiles;
  state.itemCache.clear();   // a rescan can move or drop a piece — stale by-serial lookups must not survive it
  state.facets = state.inv.facets;
  state.propKeys = state.inv.propKeys;
  state.newestScan = newestStamp(state.inv.scans);
  renderNavCounts();
  buildFilters(); fetchItems(); renderCharacters(); renderContainers(); syncBuilderCharacters();
  syncSettingsCharacters();
}

// ---------------------------------------------------------------- screens + hash routes
// Four screens (Inventory, Characters, Suit Builder, Settings), each a <main> in index.html, and routes on
// top of them: #/inventory, #/containers (Inventory's Containers view), #/characters,
// #/characters/<Character> (that character's sheet), #/builder/<Character>, #/runs (the Suit Builder with the saved-runs drawer open), #/import (the Import
// drawer over whichever screen was showing) and #/settings. A reload lands where you were; nav clicks add a
// history entry (back/forward walk them, and close a drawer); switching the builder's character replaces the
// entry instead.
const ROUTES = ["inventory", "containers", "characters", "builder", "runs", "import", "settings"];
export function parseRoute(): { tab: string; character: string | null; sheet: string | null } {
  const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean).map((x) => { try { return decodeURIComponent(x); } catch { return x; } });
  const tab = ROUTES.includes(parts[0] as string) ? parts[0]! : "inventory";
  return { tab, character: tab === "builder" ? parts[1] || null : null, sheet: tab === "characters" ? parts[1] || null : null };
}
export function routeFor(tab: string): string { return tab === "builder" && state.builder.character ? `#/builder/${encodeURIComponent(state.builder.character)}` : `#/${tab}`; }

let lastScreen = "inventory";
const screenOf = (tab: string): string => (tab === "containers" ? "inventory" : tab === "runs" ? "builder" : tab === "import" ? lastScreen : tab);
const importDrawer = bindDrawer($<HTMLElement>("#import-drawer")!);
// The Import drawer closes itself once a scan lands (ui/import.mts); the drawerclose listener below puts the route back.
export const closeImportDrawer = (): void => importDrawer.close();
// Inventory's Items | Containers switch (in its top bar) is a view of one screen, not a screen of its own.
const invView = segmented({ label: "View", options: [{ value: "items", label: "Items" }, { value: "containers", label: "Containers" }], value: "items", onChange: (v) => { location.hash = v === "containers" ? "#/containers" : "#/inventory"; } });
invView.id = "inv-view";
$<HTMLElement>("#inv-view")!.replaceWith(invView);
function showInventoryView(view: "items" | "containers"): void {
  invView.setValue(view);
  $<HTMLElement>("#inv-view-items")!.hidden = view !== "items";
  $<HTMLElement>("#tab-containers")!.hidden = view !== "containers";
}
function showTab(tab: string): void {
  const screen = screenOf(tab);
  if (screen !== lastScreen) clearToasts();   // a toast belongs to the page it was raised on
  closePopover();
  for (const sec of document.querySelectorAll<HTMLElement>(".screen")) sec.hidden = sec.id !== "tab-" + screen;
  setCurrentNav(tab === "containers" ? "inventory" : tab);
  if (tab === "inventory" || tab === "containers") showInventoryView(tab === "containers" ? "containers" : "items");
  if (tab !== "import") lastScreen = screen;
  if (tab === "import") importDrawer.open(); else importDrawer.close();
  if (tab === "runs") openRunsDrawer(); else if (screen !== "builder") closeRunsDrawer();
}
function applyRoute(): void {
  const r = parseRoute();
  showTab(r.tab);
  if (r.tab === "characters") showCharacter(r.sheet);
  if (r.tab === "builder" && state.inv) {
    if (r.character && r.character !== state.builder.character && state.inv.characters[r.character]) selectCharacter(r.character);
    else if (!r.character && state.builder.character) history.replaceState(null, "", routeFor("builder"));
  }
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
initShell();
showTab(parseRoute().tab);   // before the inventory loads, so a reload never flashes the wrong screen
showCharacter(parseRoute().sheet);   // and a reload on a sheet lands on that sheet

// A build left running when the tab closes would burn CPU for nothing: tell the server to drop it.
window.addEventListener("pagehide", () => { const j = state.builder.job; if (j?.id) navigator.sendBeacon(`/api/optimize/${j.id}/cancel`); });

// The look before any data arrives: the system's light/dark until the saved choice lands in load().
applyLook(null);
installTooltip();
setInterval(pollBridge, 2500); pollBridge();

load().catch((e) => { $<HTMLElement>("#status")!.textContent = "failed to load: " + (e as Error).message; });
