// ui/settings.mts — the Settings tab: data/log locations, client install status, import, update
// check. Task 3, Phase 4. Always re-fetches GET /api/setup on render (it's a cheap directory
// listing) so the tab reflects whatever the wizard, or this tab's own actions, just changed —
// unlike the rest of the app's renderX() functions, which are pure over state the caller already
// fetched, this one owns its own freshness because so many different actions can invalidate it.
import { state } from "./store.mts";
import { $, el, toast } from "./dom.mts";
import { api } from "./api.mts";
import { openWizard } from "./wizard.mts";
import { bridgeNoteEl } from "./bridge.mts";
import type { ApiError, SetupApiResponse, AdapterSummary, InstallApiResponse, UpdateCheckApiResponse } from "./api-types.mts";

// Reinstall's own checkbox/result — separate from the wizard's, since this panel can act
// independently of it (the client is already configured; no need to re-walk shard/client/locate).
const reinstall: { checked: boolean; error: string | null; result: InstallApiResponse | null } = { checked: false, error: null, result: null };
let lastUpdateCheck: UpdateCheckApiResponse | null = null;
// Optimistic until the first 501 proves POST /api/host/* isn't wired up (a bare `node vault-server.mts`
// rather than the Electron shell). Deliberately never re-probed afterward: whether a desktop host is
// attached is fixed for the whole life of the page (set once when the process started, never toggled
// at runtime), so once a 501 answers the question there is nothing to learn by asking again.
let hostAvailable = true;

export async function renderSettings(setup?: SetupApiResponse): Promise<void> {
  const root = $<HTMLElement>("#settings-body");
  if (!root) return;
  if (!setup) {
    try { setup = await api<SetupApiResponse>("/api/setup"); }
    catch (e) { root.replaceChildren(el("div", { class: "panel empty" }, `Could not load setup info: ${(e as Error).message}`)); return; }
  }
  state.setup = setup;
  root.replaceChildren(storagePanel(setup), clientPanel(setup), importPointer(), updatePanel());
}

// ---------------------------------------------------------------- storage: data dir / logs
// .kv is the settings tab's own label/value[/action] grid row (styles.css) — distinct from the
// shared flex .row utility, which the checkbox and folder-picker rows below still use as-is.
function openPathRow(label: string, which: string, path: string): HTMLDivElement {
  if (!hostAvailable) return el("div", { class: "kv" }, el("span", { class: "small muted" }, `${label}: `), el("span", { class: "small" }, path));
  const btn = el("button", { class: "small", onclick: async () => {
    try { await api("/api/host/open-path", { method: "POST", body: { which } }); }
    catch (e) {
      if ((e as ApiError).status === 501) { hostAvailable = false; renderSettings(); }
      else toast((e as Error).message, "bad");
    }
  } }, "Open");
  return el("div", { class: "kv" }, el("span", { class: "small muted" }, `${label}: `), el("span", { class: "small" }, path), btn);
}
function storagePanel(setup: SetupApiResponse): HTMLDivElement {
  return el("div", { class: "panel stack" }, el("h3", {}, "Storage"),
    openPathRow("Data directory", "data", setup.dataDir),
    openPathRow("Logs", "logs", `${setup.dataDir}/logs`));
}

// ---------------------------------------------------------------- client: install status + reinstall
function clientPanel(setup: SetupApiResponse): HTMLDivElement {
  const client = setup.settings.client;
  const runAgain = el("button", { onclick: () => openWizard({ firstRun: false }) }, "Run setup again");
  if (!client) {
    return el("div", { class: "panel stack" }, el("h3", {}, "Client"), el("div", { class: "small muted" }, "No client configured yet."), runAgain);
  }
  const adapter: AdapterSummary | undefined = setup.adapters.find((a) => a.id === client.adapter);
  // A paste-transport client (docs/adapter-guide.md) has no scripts folder and nothing to reinstall —
  // settings.client.scriptsDir is "" for one of these (see wizard.mts's finish()), never a real path.
  if (adapter?.transport === "paste") {
    return el("div", { class: "panel stack" }, el("h3", {}, "Client"),
      el("div", {}, adapter.name),
      el("div", { class: "small muted" }, "Nothing installed for this client — paste scan text into the Import tab."),
      runAgain);
  }
  const installedVersion = setup.installed?.version;
  const availableVersion = setup.available?.[client.adapter];
  const checkbox = el("input", { type: "checkbox", onchange: (e) => { reinstall.checked = e.target.checked; renderSettings(setup); } });
  checkbox.checked = reinstall.checked;
  const reinstallBtn = el("button", { onclick: async () => {
    reinstall.error = null;
    try { reinstall.result = await api<InstallApiResponse>("/api/setup/install", { method: "POST", body: { adapter: client.adapter, scriptsDir: client.scriptsDir } }); }
    catch (e) { reinstall.error = (e as Error).message; }   // includes the 409 "-stopall" text verbatim
    renderSettings();
  } }, "Reinstall scripts");
  reinstallBtn.disabled = !reinstall.checked;
  return el("div", { class: "panel stack" }, el("h3", {}, "Client"),
    el("div", {}, adapter?.name || client.adapter),
    el("div", { class: "small muted" }, client.scriptsDir),
    el("div", { class: "small" }, installedVersion ? `installed ${installedVersion}` : "not installed",
      availableVersion && availableVersion !== installedVersion ? ` · ${availableVersion} available` : ""),
    bridgeNoteEl(),
    el("label", { class: "row" }, checkbox, "No scripts are running in the client"),
    reinstallBtn,
    reinstall.error ? el("div", { class: "msg bad" }, reinstall.error) : null,
    reinstall.result ? el("div", { class: "msg" }, `Installed: ${reinstall.result.installed.join(", ")}`) : null,
    runAgain);
}

// ---------------------------------------------------------------- import
// Task 5, Phase 6 (post-review consolidation): this panel used to have its own "Import a folder"
// control, duplicating the one Task 1 added to the Import tab (app/ui/import.mts) — and the two had
// drifted apart, since this one never sent `adapter` in its POST /api/import body and so silently
// imported into the tazuo inbox regardless of which client was actually configured. Kept the Import
// tab's control as the one place to import a folder (it already has the adapter picker, the paste box
// for a paste-transport client, and Rescan — this panel had none of that); Settings now just points
// there instead of maintaining a second, adapter-unaware copy.
function importPointer(): HTMLDivElement {
  return el("div", { class: "panel stack" }, el("h3", {}, "Import"),
    el("div", { class: "small muted" }, "Import scan files or paste a scan from the ", el("a", { href: "#/import" }, "Import tab"), "."));
}

// ---------------------------------------------------------------- update check
function updateText(r: UpdateCheckApiResponse): string {
  if (!r.configured) return "This build has no update source configured.";
  if (r.error) return `Could not check: ${r.error}`;
  return `current ${r.current} · latest ${r.latest} · ${r.upToDate ? "up to date" : "update available"}`;
}
function updatePanel(): HTMLDivElement {
  const btn = el("button", { onclick: async () => {
    try { lastUpdateCheck = await api<UpdateCheckApiResponse>("/api/update-check"); } catch (e) { lastUpdateCheck = { configured: true, error: (e as Error).message }; }
    renderSettings();
  } }, "Check for updates");
  return el("div", { class: "panel stack" }, el("h3", {}, "Updates"), btn,
    lastUpdateCheck ? el("div", { class: "small" }, updateText(lastUpdateCheck)) : null,
    // lastUpdateCheck.url is `unknown` on purpose (installer.mts's checkForUpdates forwards GitHub's
    // html_url unvalidated) — this cast is the one place that reaches the page, flagged for the
    // security review rather than narrowed here (api-types.mts's own comment on the field).
    lastUpdateCheck?.url ? el("a", { href: lastUpdateCheck.url as string, target: "_blank", rel: "noopener noreferrer" }, "View release") : null);
}
