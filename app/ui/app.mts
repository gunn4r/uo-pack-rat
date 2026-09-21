// ui/app.mts — bootstrap: load(), the hash router, tab-nav wiring, the tooltip/bridge kickoff.
// Moved verbatim out of index.html's inline <script type="module"> (Task 4, the page split).
// `parseRoute`/`routeFor` are exported beyond the brief's explicit list because builder.mts's
// buildBuilder/selectCharacter call them directly (the router reaches into the builder for the
// #/builder/<name> deep link, and the builder reads the route back).
import { migrateProfiles, setRules } from "../vault-lib.mts";
import { state } from "./store.mts";
import { $, el, installTooltip } from "./dom.mts";
import { api } from "./api.mts";
import { pollBridge } from "./bridge.mts";
import { buildFilters, fetchItems } from "./inventory.mts";
import { renderCharacters } from "./characters.mts";
import { buildBuilder, selectCharacter } from "./builder.mts";
import { renderContainers } from "./containers.mts";
import { connectEvents } from "./events.mts";
import { openWizard } from "./wizard.mts";
import { renderSettings } from "./settings.mts";
import { renderImport } from "./import.mts";
import { changeShard } from "./shard.mts";
import type { SettingsApiResponse, RulesApiResponse, SetupApiResponse, InventoryApiResponse, ProfilesApiResponse } from "./api-types.mts";

// ---------------------------------------------------------------- data
export async function load(): Promise<void> {
  // The shard's rules (property caps, the Resisting Spells formula, race caps, tag units, the rarity
  // ladder, the free-skill list) must be loaded before anything that reads them, so this fetch and
  // setRules() run before the inventory/profiles load below. /api/setup rides along in the same
  // Promise.all — it answers before the inventory/profiles fetch and is needed for both the Settings
  // tab's first paint and the first-run wizard check below.
  const [settingsRes, rulesRes, setupRes] = await Promise.all([api<SettingsApiResponse>("/api/settings"), api<RulesApiResponse>("/api/rules"), api<SetupApiResponse>("/api/setup")]);
  state.settings = settingsRes.settings;
  state.rules = rulesRes.rules;
  state.availableShards = rulesRes.available;
  state.setup = setupRes;
  setRules(state.rules);
  renderShardPicker();
  const [inv, prof] = await Promise.all([api<InventoryApiResponse>("/api/inventory"), api<ProfilesApiResponse>("/api/profiles")]);
  state.inv = inv.inventory; state.profiles = migrateProfiles(prof.profiles).profiles;
  state.itemCache.clear();   // a rescan can move or drop a piece — stale by-serial lookups must not survive it
  state.facets = state.inv.facets;
  state.propKeys = state.inv.propKeys;
  state.newestScan = state.inv.scans.map((x) => x.scannedAt).sort().pop() || null;
  const chars = Object.keys(state.inv.characters);
  $<HTMLElement>("#status")!.textContent = inv.snapshotCount
    ? `${state.inv.itemCount} items · ${chars.length} character${chars.length === 1 ? "" : "s"} scanned (${chars.join(", ")}) · ${inv.snapshotCount} scans`
    : inv.demo ? "no scans yet (demo data)" : "no scans yet";
  buildFilters(); fetchItems(); renderCharacters(); buildBuilder(); renderContainers();
  renderSettings(setupRes);
  renderImport();
  connectEvents();
  if (setupRes.firstRun && !state.wizardShown) { state.wizardShown = true; openWizard({ firstRun: true }); }
}

// A live scan landing (events.mts, on the "inventory" SSE event) re-runs just the data half of
// load(): inventory/profiles, never rules/settings/setup (those don't change from a scan) — and
// never touches the visible tab or the builder's selected character, unlike buildBuilder(), which
// would otherwise silently jump to the route's/first character on every background refresh.
export async function reload(): Promise<void> {
  const [inv, prof] = await Promise.all([api<InventoryApiResponse>("/api/inventory"), api<ProfilesApiResponse>("/api/profiles")]);
  state.inv = inv.inventory; state.profiles = migrateProfiles(prof.profiles).profiles;
  state.itemCache.clear();
  state.facets = state.inv.facets;
  state.propKeys = state.inv.propKeys;
  state.newestScan = state.inv.scans.map((x) => x.scannedAt).sort().pop() || null;
  const chars = Object.keys(state.inv.characters);
  $<HTMLElement>("#status")!.textContent = inv.snapshotCount
    ? `${state.inv.itemCount} items · ${chars.length} character${chars.length === 1 ? "" : "s"} scanned (${chars.join(", ")}) · ${inv.snapshotCount} scans`
    : inv.demo ? "no scans yet (demo data)" : "no scans yet";
  buildFilters(); fetchItems(); renderCharacters(); renderContainers();
  // Refresh the builder's character list (a rescan can introduce a character never seen before)
  // without re-selecting one when the current selection is still valid — buildBuilder()'s
  // selectCharacter() call would otherwise reset the sidebar and wipe whatever result panel is on
  // screen for no reason.
  const names = [...new Set([...Object.keys(state.inv.characters), ...Object.keys(state.profiles.characters || {})])];
  const keep = state.builder.character;
  $<HTMLSelectElement>("#b-char")!.replaceChildren(...names.map((n) => el("option", { value: n }, n)));
  if (keep && names.includes(keep)) {
    $<HTMLSelectElement>("#b-char")!.value = keep;
  } else if (names.length) {
    // Either nothing was selected yet, or the previously selected character disappeared from the
    // inventory between reloads — not reachable via a scan-only SSE trigger today (a scan only adds
    // data), but the fallback is cheap and keeps state.builder.character from pointing at a
    // character state.inv/state.profiles no longer has.
    selectCharacter(names[0]!);
  } else {
    // Nothing left to build for at all: clear the stale selection instead of leaving it pointing at
    // a character that no longer exists anywhere in state.
    state.builder.character = null;
    $<HTMLElement>("#b-result")!.replaceChildren(el("div", { class: "panel empty" }, "No characters scanned yet."));
  }
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
