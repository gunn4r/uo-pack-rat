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
import { renderCharacters } from "./characters.mts";
import { initBuilder, syncBuilderCharacters, selectCharacter } from "./builder.mts";
import { renderContainers } from "./containers.mts";
import { connectEvents } from "./events.mts";
import { openWizard } from "./wizard.mts";
import { renderSettings } from "./settings.mts";
import { renderImport } from "./import.mts";
import { changeShard } from "./shard.mts";
import type { SettingsApiResponse, RulesApiResponse, SetupApiResponse, InventoryApiResponse, ProfilesApiResponse, UiPrefsApiResponse } from "./api-types.mts";

// ---------------------------------------------------------------- data
// The panels a failed load has to say something in, instead of leaving them on "loading…" or empty.
// The inventory-backed tabs depend on /api/inventory and /api/profiles; Settings and Import only on the
// first three routes.
const DATA_PANELS = ["#inv-table tbody", "#char-cards", "#b-result", "#cont-table tbody"];
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
  renderShardPicker();
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
  const chars = Object.keys(state.inv.characters);
  $<HTMLElement>("#status")!.textContent = inv.snapshotCount
    ? `${state.inv.itemCount} items · ${chars.length} character${chars.length === 1 ? "" : "s"} scanned (${chars.join(", ")}) · ${inv.snapshotCount} scans`
    : inv.demo ? "no scans yet (demo data)" : "no scans yet";
  buildFilters(); fetchItems(); renderCharacters(); renderContainers(); syncBuilderCharacters();
}

// ---------------------------------------------------------------- shard picker
function renderShardPicker(): void {
  const sel = $<HTMLSelectElement>("#shard")!;
  sel.replaceChildren(...state.availableShards.map((r) => el("option", { value: r.id, selected: r.id === state.settings!.shard ? "" : null }, r.name)));
  for (const o of sel.querySelectorAll("option[selected='null']")) o.removeAttribute("selected");
  sel.onchange = async () => {
    const shard = sel.value;
    const ok = await changeShard(shard);   // ui/shard.mts: PUT then reload — same path the wizard's shard step uses
    if (!ok) sel.value = state.settings!.shard;
  };
}

// ---------------------------------------------------------------- tabs + hash routes
// #/inventory, #/characters, #/containers, #/builder/<Character>, #/import, #/settings. A reload lands where
// you were; tab clicks add a history entry (back/forward walk the tabs); switching the builder's character
// replaces the entry instead.
const TABS = ["inventory", "characters", "builder", "containers", "import", "settings"];
export function parseRoute(): { tab: string; character: string | null } {
  const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean).map((x) => { try { return decodeURIComponent(x); } catch { return x; } });
  const tab = TABS.includes(parts[0] as string) ? parts[0]! : "inventory";
  return { tab, character: tab === "builder" ? parts[1] || null : null };
}
export function routeFor(tab: string): string { return tab === "builder" && state.builder.character ? `#/builder/${encodeURIComponent(state.builder.character)}` : `#/${tab}`; }
function showTab(tab: string): void {
  // setAttribute's own binding stringifies via ToString regardless of what's declared here — same
  // reasoning as dom.mts's el(), and the same compiler-only cast (native setAttribute calls don't go
  // through el()'s own ElAttrValue-typed bag, so this is the one place on this page a boolean reaches
  // it directly).
  for (const x of document.querySelectorAll<HTMLElement>("nav [role=tab]")) x.setAttribute("aria-selected", (x.dataset.tab === tab) as unknown as string);
  for (const sec of document.querySelectorAll<HTMLElement>("main > section")) sec.hidden = sec.id !== "tab-" + tab;
}
function applyRoute(): void {
  const r = parseRoute();
  showTab(r.tab);
  if (r.tab === "builder" && state.inv) {
    if (r.character && r.character !== state.builder.character && state.inv.characters[r.character]) selectCharacter(r.character);
    else if (!r.character && state.builder.character) history.replaceState(null, "", routeFor("builder"));
  }
}
for (const b of document.querySelectorAll<HTMLElement>("nav [role=tab]")) b.addEventListener("click", () => {
  const next = routeFor(b.dataset.tab as string);
  if (location.hash === next) showTab(b.dataset.tab as string); else location.hash = next;
});
window.addEventListener("hashchange", applyRoute);
showTab(parseRoute().tab);   // before the inventory loads, so a reload never flashes the wrong tab

// A build left running when the tab closes would burn CPU for nothing: tell the server to drop it.
window.addEventListener("pagehide", () => { const j = state.builder.job; if (j?.id) navigator.sendBeacon(`/api/optimize/${j.id}/cancel`); });

installTooltip();
setInterval(pollBridge, 2500); pollBridge();

load().catch((e) => { $<HTMLElement>("#status")!.textContent = "failed to load: " + (e as Error).message; });
