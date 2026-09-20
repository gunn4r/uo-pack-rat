// ui/app.mjs — bootstrap: load(), the hash router, tab-nav wiring, the tooltip/bridge kickoff.
// Moved verbatim out of index.html's inline <script type="module"> (Task 4, the page split).
// `parseRoute`/`routeFor` are exported beyond the brief's explicit list because builder.mjs's
// buildBuilder/selectCharacter call them directly (the router reaches into the builder for the
// #/builder/<name> deep link, and the builder reads the route back).
import { migrateProfiles, setRules } from "../vault-lib.mts";
import { state } from "./store.mjs";
import { $, el, installTooltip } from "./dom.mjs";
import { api } from "./api.mjs";
import { pollBridge } from "./bridge.mjs";
import { buildFilters, fetchItems } from "./inventory.mjs";
import { renderCharacters } from "./characters.mjs";
import { buildBuilder, selectCharacter } from "./builder.mjs";
import { renderContainers } from "./containers.mjs";
import { connectEvents } from "./events.mjs";
import { openWizard } from "./wizard.mjs";
import { renderSettings } from "./settings.mjs";
import { renderImport } from "./import.mjs";
import { changeShard } from "./shard.mts";

// ---------------------------------------------------------------- data
export async function load() {
  // The shard's rules (property caps, the Resisting Spells formula, race caps, tag units, the rarity
  // ladder, the free-skill list) must be loaded before anything that reads them, so this fetch and
  // setRules() run before the inventory/profiles load below. /api/setup rides along in the same
  // Promise.all — it answers before the inventory/profiles fetch and is needed for both the Settings
  // tab's first paint and the first-run wizard check below.
  const [settingsRes, rulesRes, setupRes] = await Promise.all([api("/api/settings"), api("/api/rules"), api("/api/setup")]);
  state.settings = settingsRes.settings;
  state.rules = rulesRes.rules;
  state.availableShards = rulesRes.available;
  state.setup = setupRes;
  setRules(state.rules);
  renderShardPicker();
  const [inv, prof] = await Promise.all([api("/api/inventory"), api("/api/profiles")]);
  state.inv = inv.inventory; state.profiles = migrateProfiles(prof.profiles).profiles;
  state.itemCache.clear();   // a rescan can move or drop a piece — stale by-serial lookups must not survive it
  state.facets = state.inv.facets;
  state.propKeys = state.inv.propKeys;
  state.newestScan = state.inv.scans.map((x) => x.scannedAt).sort().pop() || null;
  const chars = Object.keys(state.inv.characters);
  $("#status").textContent = inv.snapshotCount
    ? `${state.inv.itemCount} items · ${chars.length} character${chars.length === 1 ? "" : "s"} scanned (${chars.join(", ")}) · ${inv.snapshotCount} scans`
    : inv.demo ? "no scans yet (demo data)" : "no scans yet";
  buildFilters(); fetchItems(); renderCharacters(); buildBuilder(); renderContainers();
  renderSettings(setupRes);
  renderImport();
  connectEvents();
  if (setupRes.firstRun && !state.wizardShown) { state.wizardShown = true; openWizard({ firstRun: true }); }
}

// A live scan landing (events.mjs, on the "inventory" SSE event) re-runs just the data half of
// load(): inventory/profiles, never rules/settings/setup (those don't change from a scan) — and
// never touches the visible tab or the builder's selected character, unlike buildBuilder(), which
// would otherwise silently jump to the route's/first character on every background refresh.
export async function reload() {
  const [inv, prof] = await Promise.all([api("/api/inventory"), api("/api/profiles")]);
  state.inv = inv.inventory; state.profiles = migrateProfiles(prof.profiles).profiles;
  state.itemCache.clear();
  state.facets = state.inv.facets;
  state.propKeys = state.inv.propKeys;
  state.newestScan = state.inv.scans.map((x) => x.scannedAt).sort().pop() || null;
  const chars = Object.keys(state.inv.characters);
  $("#status").textContent = inv.snapshotCount
    ? `${state.inv.itemCount} items · ${chars.length} character${chars.length === 1 ? "" : "s"} scanned (${chars.join(", ")}) · ${inv.snapshotCount} scans`
    : inv.demo ? "no scans yet (demo data)" : "no scans yet";
  buildFilters(); fetchItems(); renderCharacters(); renderContainers();
  // Refresh the builder's character list (a rescan can introduce a character never seen before)
  // without re-selecting one when the current selection is still valid — buildBuilder()'s
  // selectCharacter() call would otherwise reset the sidebar and wipe whatever result panel is on
  // screen for no reason.
  const names = [...new Set([...Object.keys(state.inv.characters), ...Object.keys(state.profiles.characters || {})])];
  const keep = state.builder.character;
  $("#b-char").replaceChildren(...names.map((n) => el("option", { value: n }, n)));
  if (keep && names.includes(keep)) {
    $("#b-char").value = keep;
  } else if (names.length) {
    // Either nothing was selected yet, or the previously selected character disappeared from the
    // inventory between reloads — not reachable via a scan-only SSE trigger today (a scan only adds
    // data), but the fallback is cheap and keeps state.builder.character from pointing at a
    // character state.inv/state.profiles no longer has.
    selectCharacter(names[0]);
  } else {
    // Nothing left to build for at all: clear the stale selection instead of leaving it pointing at
    // a character that no longer exists anywhere in state.
    state.builder.character = null;
    $("#b-result").replaceChildren(el("div", { class: "panel empty" }, "No characters scanned yet."));
  }
}

// ---------------------------------------------------------------- shard picker
function renderShardPicker() {
  const sel = $("#shard");
  sel.replaceChildren(...state.availableShards.map((r) => el("option", { value: r.id, selected: r.id === state.settings.shard ? "" : null }, r.name)));
  for (const o of sel.querySelectorAll("option[selected='null']")) o.removeAttribute("selected");
  sel.onchange = async () => {
    const shard = sel.value;
    const ok = await changeShard(shard);   // ui/shard.mts: PUT then reload — same path the wizard's shard step uses
    if (!ok) sel.value = state.settings.shard;
  };
}

// ---------------------------------------------------------------- tabs + hash routes
// #/inventory, #/characters, #/containers, #/builder/<Character>, #/import, #/settings. A reload lands where
// you were; tab clicks add a history entry (back/forward walk the tabs); switching the builder's character
// replaces the entry instead.
const TABS = ["inventory", "characters", "builder", "containers", "import", "settings"];
export function parseRoute() {
  const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean).map((x) => { try { return decodeURIComponent(x); } catch { return x; } });
  const tab = TABS.includes(parts[0]) ? parts[0] : "inventory";
  return { tab, character: tab === "builder" ? parts[1] || null : null };
}
export function routeFor(tab) { return tab === "builder" && state.builder.character ? `#/builder/${encodeURIComponent(state.builder.character)}` : `#/${tab}`; }
function showTab(tab) {
  for (const x of document.querySelectorAll("nav [role=tab]")) x.setAttribute("aria-selected", x.dataset.tab === tab);
  for (const sec of document.querySelectorAll("main > section")) sec.hidden = sec.id !== "tab-" + tab;
}
function applyRoute() {
  const r = parseRoute();
  showTab(r.tab);
  if (r.tab === "builder" && state.inv) {
    if (r.character && r.character !== state.builder.character && state.inv.characters[r.character]) selectCharacter(r.character);
    else if (!r.character && state.builder.character) history.replaceState(null, "", routeFor("builder"));
  }
}
for (const b of document.querySelectorAll("nav [role=tab]")) b.addEventListener("click", () => {
  const next = routeFor(b.dataset.tab);
  if (location.hash === next) showTab(b.dataset.tab); else location.hash = next;
});
window.addEventListener("hashchange", applyRoute);
showTab(parseRoute().tab);   // before the inventory loads, so a reload never flashes the wrong tab

// A build left running when the tab closes would burn CPU for nothing: tell the server to drop it.
window.addEventListener("pagehide", () => { const j = state.builder.job; if (j?.id) navigator.sendBeacon(`/api/optimize/${j.id}/cancel`); });

installTooltip();
setInterval(pollBridge, 2500); pollBridge();

load().catch((e) => { $("#status").textContent = "failed to load: " + e.message; });
