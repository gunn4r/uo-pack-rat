// ui/settings.mjs — the Settings tab: data/log locations, client install status, import, update
// check. Task 3, Phase 4. Always re-fetches GET /api/setup on render (it's a cheap directory
// listing) so the tab reflects whatever the wizard, or this tab's own actions, just changed —
// unlike the rest of the app's renderX() functions, which are pure over state the caller already
// fetched, this one owns its own freshness because so many different actions can invalidate it.
import { state } from "./store.mjs";
import { $, el, toast } from "./dom.mjs";
import { api } from "./api.mjs";
import { openWizard, pickFolderRow } from "./wizard.mjs";

// Reinstall's own checkbox/result — separate from the wizard's, since this panel can act
// independently of it (the client is already configured; no need to re-walk shard/client/locate).
const reinstall = { checked: false, error: null, result: null };
let lastUpdateCheck = null;
// Optimistic until the first 501 proves POST /api/host/* isn't wired up (a bare `node vault-server.mjs`
// rather than the Electron shell). Deliberately never re-probed afterward: whether a desktop host is
// attached is fixed for the whole life of the page (set once when the process started, never toggled
// at runtime), so once a 501 answers the question there is nothing to learn by asking again.
let hostAvailable = true;

export async function renderSettings(setup) {
  const root = $("#settings-body");
  if (!root) return;
  if (!setup) {
    try { setup = await api("/api/setup"); }
    catch (e) { root.replaceChildren(el("div", { class: "panel empty" }, `Could not load setup info: ${e.message}`)); return; }
  }
  state.setup = setup;
  root.replaceChildren(storagePanel(setup), clientPanel(setup), importPanel(), updatePanel());
}

// ---------------------------------------------------------------- storage: data dir / logs
// .kv is the settings tab's own label/value[/action] grid row (styles.css) — distinct from the
// shared flex .row utility, which the checkbox and folder-picker rows below still use as-is.
function openPathRow(label, which, path) {
  if (!hostAvailable) return el("div", { class: "kv" }, el("span", { class: "small muted" }, `${label}: `), el("span", { class: "small" }, path));
  const btn = el("button", { class: "small", onclick: async () => {
    try { await api("/api/host/open-path", { method: "POST", body: { which } }); }
    catch (e) {
      if (e.status === 501) { hostAvailable = false; renderSettings(); }
      else toast(e.message, "bad");
    }
  } }, "Open");
  return el("div", { class: "kv" }, el("span", { class: "small muted" }, `${label}: `), el("span", { class: "small" }, path), btn);
}
function storagePanel(setup) {
  return el("div", { class: "panel stack" }, el("h3", {}, "Storage"),
    openPathRow("Data directory", "data", setup.dataDir),
    openPathRow("Logs", "logs", `${setup.dataDir}/logs`));
}

// ---------------------------------------------------------------- client: install status + reinstall
function clientPanel(setup) {
  const client = setup.settings.client;
  const runAgain = el("button", { onclick: () => openWizard({ firstRun: false }) }, "Run setup again");
  if (!client) {
    return el("div", { class: "panel stack" }, el("h3", {}, "Client"), el("div", { class: "small muted" }, "No client configured yet."), runAgain);
  }
  const adapter = setup.adapters.find((a) => a.id === client.adapter);
  const installedVersion = setup.installed?.version;
  const availableVersion = setup.available?.[client.adapter];
  const checkbox = el("input", { type: "checkbox", onchange: (e) => { reinstall.checked = e.target.checked; renderSettings(setup); } });
  checkbox.checked = reinstall.checked;
  const reinstallBtn = el("button", { onclick: async () => {
    reinstall.error = null;
    try { reinstall.result = await api("/api/setup/install", { method: "POST", body: { adapter: client.adapter, scriptsDir: client.scriptsDir } }); }
    catch (e) { reinstall.error = e.message; }   // includes the 409 "-stopall" text verbatim
    renderSettings();
  } }, "Reinstall scripts");
  reinstallBtn.disabled = !reinstall.checked;
  return el("div", { class: "panel stack" }, el("h3", {}, "Client"),
    el("div", {}, adapter?.name || client.adapter),
    el("div", { class: "small muted" }, client.scriptsDir),
    el("div", { class: "small" }, installedVersion ? `installed ${installedVersion}` : "not installed",
      availableVersion && availableVersion !== installedVersion ? ` · ${availableVersion} available` : ""),
    el("label", { class: "row" }, checkbox, "No scripts are running in the client"),
    reinstallBtn,
    reinstall.error ? el("div", { class: "msg bad" }, reinstall.error) : null,
    reinstall.result ? el("div", { class: "msg" }, `Installed: ${reinstall.result.installed.join(", ")}`) : null,
    runAgain);
}

// ---------------------------------------------------------------- import
function importPanel() {
  const msg = el("span", { class: "small" });
  return el("div", { class: "panel stack" }, el("h3", {}, "Import"),
    el("div", { class: "small muted" }, "Already have scan files? Import a folder"),
    pickFolderRow({ title: "Choose a folder of scan files to import", onResolved: async (dir) => {
      try { const r = await api("/api/import", { method: "POST", body: { dir } }); msg.textContent = `copied ${r.copied}${r.skipped ? ` (skipped ${r.skipped} already present)` : ""}`; }
      catch (e) { msg.textContent = e.message; }
    } }),
    msg);
}

// ---------------------------------------------------------------- update check
function updateText(r) {
  if (!r.configured) return "This build has no update source configured.";
  if (r.error) return `Could not check: ${r.error}`;
  return `current ${r.current} · latest ${r.latest} · ${r.upToDate ? "up to date" : "update available"}`;
}
function updatePanel() {
  const btn = el("button", { onclick: async () => {
    try { lastUpdateCheck = await api("/api/update-check"); } catch (e) { lastUpdateCheck = { configured: true, error: e.message }; }
    renderSettings();
  } }, "Check for updates");
  return el("div", { class: "panel stack" }, el("h3", {}, "Updates"), btn,
    lastUpdateCheck ? el("div", { class: "small" }, updateText(lastUpdateCheck)) : null,
    lastUpdateCheck?.url ? el("a", { href: lastUpdateCheck.url, target: "_blank", rel: "noopener noreferrer" }, "View release") : null);
}
