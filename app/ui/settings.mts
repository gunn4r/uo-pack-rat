// ui/settings.mts — the Settings screen (design spec 4.11): five sections (General, Game client, Data,
// AI assistants (MCP), Updates) in a column of cards made of setting rows — title and help on the left, the control
// on the right. General holds the look (theme family, appearance) and the shard rules; Game client its
// status, Run setup and Reinstall; Data the data folder and logs with Open, the blacklisted containers, export and
// import of the item kinds the player set,
// how long old scans and saved runs are kept, and the danger zone (forget a character, forget a container); AI assistants
// the built-in MCP server's two switches and how to connect a client (issue #211); Updates the version, the update check and its automatic switch. Always re-fetches GET
// /api/setup on render (a cheap directory listing) so it reflects whatever the wizard, or this screen's
// own actions, just changed.
import { state } from "./store.mts";
import { $, compactChildren, el, noteEl } from "./dom.mts";
import { api } from "./api.mts";
import { prefs } from "./prefs.mts";
import { badge, box, button, check, confirmDialog, copyText, input, message, segmented, select, switchControl, txt, showToast, type Kids } from "./components.mts";
import { plural } from "./builder-model.mts";
import { applyLook, currentLook, resolveTheme, BUILT_THEMES, type Appearance } from "./theme.mts";
import { changeShard } from "./shard.mts";
import { openWizard } from "./wizard.mts";
import { forgetCharacter } from "./characters.mts";
import { bridgeNote, renderDataDirNotice } from "./bridge.mts";
import { adapterCopy } from "./adapter-copy.mts";
import { copiedScanner, loadScanner, scannerCopy } from "./paste-scanner.mts";
import { clientErrorMessage, uoFolderErrorMessage, dataDirNotice, errorText, hostErrorMessage, installedIntoNote, pathsFileNote, relativeWhen } from "./messages.mts";
import { autostartNote, hotkeyLabel, panelControls } from "./tazuo-panel.mts";
import { exportKinds, importKinds } from "./kinds.mts";
import { tiledataNote } from "./house-map-model.mts";
import { registerScreen } from "./nav.mts";
import type { SetupApiResponse, InstallApiResponse, UpdateCheckApiResponse, BlacklistApiResponse, CleanupApiResponse, RetentionSetting, SettingsApiResponse, PanelPrefs, TazuoPanelApiResponse, McpApiResponse, HousesApiResponse, TiledataFrom, HostPickFolderApiResponse, ApiError, UiPrefs } from "./api-types.mts";
import { isPseudoCharacter, rulesUpgradeNote, type BlacklistEntry } from "../vault-lib.mts";

// Reinstall's own confirmation and result — separate from the wizard's, since this row acts on the client
// that is already set up (no need to re-walk shard/client/folder).
const reinstall: { checked: boolean; busy: boolean; error: string | null; result: InstallApiResponse | null } = { checked: false, busy: false, error: null, result: null };
let lastUpdateCheck: UpdateCheckApiResponse | null = null;
let checking = false;

// The theme families, in the order the select lists them. A family is chooseable once its tokens ship,
// i.e. once its id is in theme.mts's BUILT_THEMES; until then it is listed, disabled, "coming soon".
const THEMES = [{ id: "default", label: "Default" }, { id: "britannia", label: "Britannia" }];
const isBuilt = (id: string): boolean => (BUILT_THEMES as readonly string[]).includes(id);

export async function renderSettings(setup?: SetupApiResponse): Promise<void> {
  const root = $<HTMLElement>("#settings-body");
  if (!root) return;
  if (!setup) {
    try { setup = await api<SetupApiResponse>("/api/setup"); }
    catch (e) { root.replaceChildren(message({ tone: "bad", title: "Could not load setup info", text: errorText(e) })); return; }
  }
  state.setup = setup;
  mcpTokenShown = false;   // the token is hidden again whenever Settings is drawn afresh
  renderDataDirNotice();
  root.replaceChildren(generalSection(), clientSection(setup), dataSection(setup), mcpSection(), updatesSection(setup));
  void syncSettingsBlacklist();
  void syncMcpCard();
  void syncPanelCard();
  void syncUoFolderCard();
}

// ---------------------------------------------------------------- building blocks
// There is no section nav while the page is this short (the maintainer's call); a section that needs the
// player's attention (Game client with no client set up) carries a warning dot beside its heading.
function section(id: string, title: string, ...cards: Kids): HTMLElement {
  return sectionFlagged(id, title, false, ...cards);
}
function sectionFlagged(id: string, title: string, flag: boolean, ...cards: Kids): HTMLElement {
  const h = el("h2", { class: "t-lg", id: `${id}-h` }, title);
  return box("section", { class: "set-section", id, "aria-labelledby": `${id}-h` },
    flag ? box("div", { class: "set-section-head" }, h, el("span", { class: "dot warn", role: "img", "aria-label": "needs attention" })) : h, ...cards);
}
// A setting row: title and help on the left, the control on the right. `label` ties the title to a
// control with an id (a <label for>); otherwise the title is plain text.
function row({ title, help, control, label, muted = false, below = [] }: { title: string; help?: string | Node | undefined; control?: HTMLElement | null; label?: string; muted?: boolean; below?: Kids }): HTMLElement {
  const t = label ? el("label", { class: `t-md strong${muted ? " muted" : ""}`, for: label }, title) : txt(title, `t-md strong${muted ? " muted" : ""}`);
  const helpEl = help == null ? null : el("p", { class: "help" }, typeof help === "string" ? txt(help) : help);
  return box("div", { class: "set-row" },
    box("div", { class: "set-row-text" }, t, helpEl),
    control ? box("div", { class: "set-row-control" }, control) : null,
    ...below.filter((k): k is Node => !!k).map((k) => box("div", { class: "set-row-below" }, k as HTMLElement)));
}

// ---------------------------------------------------------------- General: look and shard rules
// The theme family and light/system/dark are ui-prefs, applied at once by theme.mts; a shard switch
// reloads the page (shard.mts), since the rules reach everything the fold computed.
function generalSection(): HTMLElement {
  const look = currentLook();
  const save = (body: UiPrefs): void => prefs.set(body);
  const theme = select(THEMES.map((t) => ({ value: t.id, label: isBuilt(t.id) ? t.label : `${t.label} (coming soon)`, disabled: !isBuilt(t.id) })), resolveTheme(look.theme), { attrs: { id: "set-theme", class: "select set-select" } });
  theme.addEventListener("change", () => { applyLook({ theme: theme.value }); save({ theme: theme.value }); });
  const appearance = segmented({ label: "Appearance", value: look.appearance,
    options: [{ value: "light", label: "Light" }, { value: "system", label: "System" }, { value: "dark", label: "Dark" }],
    onChange: (v) => { applyLook({ appearance: v as Appearance }); save({ appearance: v as Appearance }); } });
  appearance.id = "set-appearance";
  const shard = select(state.availableShards.map((r) => ({ value: r.id, label: r.name })), state.settings?.shard || "", { attrs: { id: "shard", class: "select set-select" } });
  shard.addEventListener("change", async () => { if (!await changeShard(shard.value)) shard.value = state.settings!.shard; });
  return section("set-general", "General", box("div", { class: "card set-card" },
    row({ title: "Theme", label: "set-theme", control: theme,
      help: isBuilt("britannia") ? "Default is the clean look. Britannia dresses Pack Rat in parchment and brass frames." : "Default is the clean look. A Britannia theme with parchment and brass frames comes in a later release." }),
    row({ title: "Appearance", control: appearance, help: "System follows your computer's light or dark setting." }),
    row({ title: "Shard rules", label: "shard", control: shard, help: "Property caps, the Resisting Spells minimum, rarity colors and the gargoyle race lock.",
      below: [state.rules && rulesUpgradeNote(state.rules) ? message({ tone: "warn", text: rulesUpgradeNote(state.rules)! }) : null] })));
}

// ---------------------------------------------------------------- Game client: status, setup, reinstall
function clientSection(setup: SetupApiResponse): HTMLElement {
  const client = setup.settings.client;
  const adapter = client ? setup.adapters.find((a) => a.id === client.adapter) : undefined;
  const setupBtn = button({ label: "Run setup", variant: client ? "secondary" : "primary", onClick: () => void openWizard({ firstRun: false }), attrs: { id: "set-run-setup" } });
  let status: HTMLElement;
  let reinstallRow: HTMLElement;
  if (!client) {
    status = row({ title: "Client", control: setupBtn, help: "No client set up yet. In-game Highlight, Grab and Go to need one." });
    reinstallRow = row({ title: "Reinstall scanner scripts", muted: true, control: button({ label: "Reinstall", disabled: true }), help: "Available once a client is set up." });
  } else if (adapter?.transport === "paste") {
    // A paste-transport client has no scripts folder and nothing to reinstall (settings.client.scriptsDir is ""):
    // its scanner is copied from here into the client (ui/paste-scanner.mts), again after an update.
    const c = adapterCopy(adapter);
    status = row({ title: c.short, control: setupBtn, help: "Paste what its scanner prints into Import (⌘I)." });
    const s = scannerCopy(adapter.id, { id: "set-copy-scanner", onCopied: () => void renderSettings(setup) });
    reinstallRow = row({ title: "Scanner script", control: s.button, help: `Copy it into the ${c.short}'s scripting window as a new script, and again after a Pack Rat update.`,
      below: [box("div", { class: "set-inline", id: "set-scanner-version" }), s.fallback] });
    void loadScanner(adapter.id).then((r) => scannerVersion(r.version)).catch(() => { /* the button says why on click */ });
  } else {
    const c = adapterCopy(adapter || { id: client.adapter });
    const name = c.short;
    const installed = setup.installed?.version;
    const available = setup.available?.[client.adapter];
    const statusHelp = el("span", {}, installed ? `Scanner ${installed} installed in ` : "No scanner installed yet in ", el("span", { class: "mono" }, client.scriptsDir), ".");
    const note = bridgeNote();
    status = row({ title: name, control: setupBtn, help: statusHelp,
      below: [available && available !== installed ? box("div", { class: "set-inline" }, badge(`${available} available`, "accent"), txt("Reinstall to update the scanner.", "t-sm muted")) : null,
        note ? message({ tone: "warn", text: note }) : null] });
    const confirm = check({ label: c.stopConfirm!, checked: reinstall.checked, attrs: { id: "set-stopall" },
      onChange: (on) => { reinstall.checked = on; void renderSettings(setup); } });
    const btn = button({ label: reinstall.busy ? "Reinstalling…" : "Reinstall", disabled: !reinstall.checked || reinstall.busy, attrs: { id: "set-reinstall" }, onClick: async () => {
      reinstall.error = null; reinstall.busy = true; void renderSettings(setup);
      try { reinstall.result = await api<InstallApiResponse>("/api/setup/install", { method: "POST", body: { adapter: client.adapter, scriptsDir: client.scriptsDir } }); }
      // The 409 "stop the scripts" text comes through verbatim; the one failure worth rewording is the folder this
      // row just sent being gone since it was persisted (messages.mts's clientFolderGone).
      catch (e) { reinstall.error = clientErrorMessage(e); }
      reinstall.busy = false; reinstall.checked = false;
      void renderSettings();
    } });
    const r = reinstall.result;
    reinstallRow = row({ title: "Reinstall scanner scripts", control: btn, help: `Puts a fresh copy of the scanner in the scripts folder. ${c.stopHelp}`,
      below: [box("div", { class: "set-inline" }, confirm.root),
        reinstall.error ? message({ tone: "bad", title: "Could not reinstall", text: reinstall.error }) : null,
        // Where the scripts actually went (the server resolves it), and what became of packrat-paths.json —
        // a "kept" file is the whole reason scans then stop arriving (app/installer.mts's writePathsFile).
        r ? message({ tone: "ok", title: "Reinstalled", text: r.installed.join(", ") }) : null,
        r ? noteEl(installedIntoNote(r.scriptsDir)) : null,
        r ? noteEl(pathsFileNote(r.pathsFile)) : null,
        ...(() => { const n = r && autostartNote(r.autostart); return n ? [message({ tone: n.tone, text: n.text })] : []; })()] });
  }
  return sectionFlagged("set-client", "Game client", !setup.settings.client, box("div", { class: "card set-card" }, status, reinstallRow),
    client?.adapter === "tazuo" && client.scriptsDir ? box("div", { class: "card set-card", id: "set-panel" }) : null,
    uoFolderCard(uoFrom, null));
}

// The bundled web scanner's version beside its Copy button, and a newer-than-copied hint the way the
// installed-script check does it for a folder client.
function scannerVersion(version: string | null): void {
  const at = $<HTMLElement>("#set-scanner-version");
  if (!at || !version) return;
  const last = copiedScanner();
  at.replaceChildren(...(last && last !== version
    ? [badge(`${version} available`, "accent"), txt(`You copied ${last}. Copy again and replace the old script.`, "t-sm muted")]
    : [txt(`Scanner ${version}.`, "t-sm muted")]));
}

// The TazUO in-game panel's options (app/ui/tazuo-panel.mts), filled in once GET /api/tazuo-panel answers.
// Each change saves at once; the server's refusal shows under the row it came from.
let panelError: { text: string; row: "login" | "hotkey" } | null = null;
async function syncPanelCard(): Promise<void> {
  if (!$("#set-panel")) return;
  try { $<HTMLElement>("#set-panel")?.replaceWith(panelCard(await api<TazuoPanelApiResponse>("/api/tazuo-panel"))); } catch { /* the card keeps what it showed */ }
}
function panelCard(r: TazuoPanelApiResponse): HTMLElement {
  const save = async (change: Partial<PanelPrefs>): Promise<void> => {
    try { await api("/api/tazuo-panel", { method: "PUT", body: change }); }
    catch (e) { panelError = { text: errorText(e), row: "hotkey" in change ? "hotkey" : "login" }; }
    void syncPanelCard();
  };
  const c = panelControls(r.prefs, (change) => void save(change), "set-panel");
  const err = panelError;
  panelError = null;
  const errFor = (at: "login" | "hotkey") => err?.row === at ? message({ tone: "bad", text: err.text }) : null;
  return box("div", { class: "card set-card", id: "set-panel" },
    row({ title: "In-game panel", control: c.login, help: `The panel always starts with TazUO (hidden if off); ${hotkeyLabel(r.prefs.hotkey)} shows it.`, below: [errFor("login")] }),
    row({ title: "Panel hotkey", control: c.hotkey, help: "Shows or hides the panel in game. A letter or digit needs a modifier, since the hotkey also fires while you type in chat.", below: [errFor("hotkey")] }));
}


// ---------------------------------------------------------------- UO folder (house map, issue #10)
// The folder the house map reads tiledata.mul from: where it was found (TazUO's launcher, or set here) and, when there is none or it cannot be read, why (the map's own note), a path field with Choose a folder… in the desktop app, and Reset to automatic. GET /api/houses says where it came from; PUT /api/settings {uoFolder} checks the folder and saves it (its refusal never echoes the path). A refused path stays in the field. When GET /api/houses fails, the card still shows the field (and a save's refusal) with the last place it heard of. A re-render of the page (a scan landing, an update check) draws the card from that last place too, never blank, until GET /api/houses answers again.
let uoHostPicker = true;
let uoDraft: string | null = null;
let uoFrom: TiledataFrom = { folder: null, source: null, reason: null };
async function syncUoFolderCard(error: string | null = null): Promise<void> {
  if (!$("#set-uofolder")) return;
  try { uoFrom = (await api<HousesApiResponse>("/api/houses")).tiledataFrom; } catch { /* keep the last place heard of */ }
  $<HTMLElement>("#set-uofolder")?.replaceWith(uoFolderCard(uoFrom, error));
}
function uoFolderCard(from: TiledataFrom, error: string | null): HTMLElement {
  const path = input({ value: uoDraft ?? state.settings?.uoFolder ?? "", placeholder: "The folder holding tiledata.mul", attrs: { id: "set-uofolder-path", class: "input set-uofolder-path" } });
  path.addEventListener("input", () => { uoDraft = path.value; });
  const save = async (folder: string | null): Promise<void> => {
    try { state.settings = (await api<SettingsApiResponse>("/api/settings", { method: "PUT", body: { uoFolder: folder } })).settings; uoDraft = null; void syncUoFolderCard(); }
    catch (e) { void syncUoFolderCard(uoFolderErrorMessage(e)); }
  };
  const pick = async (): Promise<void> => {
    try {
      const r = await api<HostPickFolderApiResponse>("/api/host/pick-folder", { method: "POST", body: { title: "Choose your Ultima Online folder" } });
      if (r.path) { uoDraft = r.path; await save(r.path); }
    } catch (e) {
      // 501: no desktop shell (a bare `node vault-server.mts`), so the typed path is the way in; 504: the shell never answered.
      if ((e as ApiError).status === 501) { uoHostPicker = false; void syncUoFolderCard(); }
      else showToast(hostErrorMessage(e, "Could not open the folder picker"), "bad");
    }
  };
  const help = from.folder
    ? el("span", {}, from.source === "settings" ? "Set here:" : "Found through TazUO's launcher:", el("span", { class: "mono ellip set-uofolder-where", title: from.folder }, from.folder))
    : "The folder holding tiledata.mul, which tells the house map's walls, floors and materials apart.";
  const note = tiledataNote(from.reason);
  const set = !!state.settings?.uoFolder;
  return box("div", { class: "card set-card", id: "set-uofolder" },
    row({ title: "UO folder (house map)", label: "set-uofolder-path", help,
      control: uoHostPicker || set ? box("div", { class: "set-inline" },
        uoHostPicker ? button({ label: "Choose a folder…", icon: "folder", attrs: { id: "set-uofolder-pick" }, onClick: () => { void pick(); } }) : null,
        set ? button({ label: "Reset to automatic", variant: "ghost", attrs: { id: "set-uofolder-reset" }, onClick: () => { uoDraft = null; void save(null); } }) : null) : null,
      below: [box("div", { class: "set-inline" }, path, button({ label: "Save", attrs: { id: "set-uofolder-save" }, onClick: () => { const v = path.value.trim(); void save(v || null); } })),
        note ? message({ tone: "warn", text: note }) : null,
        error ? message({ tone: "bad", title: "Could not save the UO folder", text: error }) : null] }));
}

// ---------------------------------------------------------------- Data: folders, danger zone
function pathRow(label: string, which: string, path: string, canOpen: boolean): HTMLElement {
  // Only the desktop shell can open a folder (GET /api/setup's canOpenFolders); in a plain browser the
  // useful thing is the path itself, so the button copies it instead.
  const action = canOpen
    ? button({ label: "Open", icon: "folder", size: "sm", attrs: { "aria-label": `Open the ${label.toLowerCase()}` }, onClick: async () => {
      try { await api("/api/host/open-path", { method: "POST", body: { which } }); }
      // 504 (the shell never answered) reads as a bare "did not answer" without this — messages.mts's hostErrorMessage.
      catch (e) { showToast(hostErrorMessage(e, `Could not open the ${label.toLowerCase()}`), "bad"); }
    } })
    : button({ label: "Copy path", icon: "clipboard", size: "sm", attrs: { "aria-label": `Copy the ${label.toLowerCase()} path` }, onClick: async () => {
      if (await copyText(path)) showToast(`Copied ${path}`, "ok"); else showToast(`Could not copy the ${label.toLowerCase()} path.`, "bad");
    } });
  return box("div", { class: "set-path" }, txt(label, "t-md strong"), el("span", { class: "mono ellip", title: path }, path), action);
}
// Everyone Pack Rat knows by name: scanned characters and characters with only a saved Suit Builder profile.
function knownCharacters(): string[] {
  return [...new Set([...Object.keys(state.inv?.characters || {}), ...Object.keys(state.profiles?.characters || {})])]
    .filter((n) => !isPseudoCharacter(n)).sort((a, b) => a.localeCompare(b));
}
// The containers scans never open, newest first, each with Unblacklist. Containers and the in-game
// packrat-blacklist.py both change the list, so this card alone is fetched again on every visit (nav.mts).
registerScreen({ name: "settings", show: () => void syncSettingsBlacklist() });
export async function syncSettingsBlacklist(): Promise<void> {
  if (!$("#set-blacklist")) return;
  try { $<HTMLElement>("#set-blacklist")?.replaceWith(blacklistCard((await api<BlacklistApiResponse>("/api/blacklist")).containers)); } catch { /* the card keeps what it showed */ }
}
function blacklistCard(list: BlacklistEntry[]): HTMLElement {
  return box("div", { class: "card set-card", id: "set-blacklist" },
    row({ title: "Blacklisted containers", help: list.length ? "Scans never open these." : "None. Blacklist a ground container from its ⋯ menu in Containers, or in game with packrat-blacklist.py (TazUO, Razor Enhanced)." }),
    ...[...list].reverse().map((e) => row({ title: e.name, help: [e.where, `added ${relativeWhen(e.addedAt)}`].filter(Boolean).join(" · "),
      control: button({ label: "Unblacklist", size: "sm", attrs: { "aria-label": `Unblacklist ${e.name}` }, onClick: async () => {
        try { await api(`/api/blacklist/${e.serial}`, { method: "DELETE" }); showToast(`Unblacklisted ${e.name}: the next scan reads it again.`, "ok"); }
        catch (err) { showToast(errorText(err), "bad"); }
        void syncSettingsBlacklist();
      } }) })));
}
// The item kinds the player set with Classify this… (issue #150): Export saves item-kinds.json to share; Import merges
// a file in, its entries winning.
function kindsCard(): HTMLElement {
  const picker = el("input", { type: "file", accept: ".json,application/json", class: "sr", tabindex: "-1", "aria-hidden": "true", id: "set-kinds-file" });
  picker.addEventListener("change", () => { const f = picker.files?.[0]; picker.value = ""; if (f) void importKinds(f); });
  return box("div", { class: "card set-card", id: "set-kinds" },
    row({ title: "Item kinds you set", help: "Classify this… on an item in Inventory sets its kind. Export them to share or keep; Import adds a file's kinds to yours.",
      control: box("div", { class: "set-inline" },
        button({ label: "Export…", size: "sm", attrs: { id: "set-kinds-export" }, onClick: () => { void exportKinds(); } }),
        button({ label: "Import…", size: "sm", attrs: { id: "set-kinds-import" }, onClick: () => picker.click() }), picker) }));
}
// Data retention (issue #28): how long old scans and saved runs are kept, saved to settings.json as
// each control changes, and Clean up now, which asks the server for a count first (a dry run) and
// says what it will remove before removing it.
function retentionCard(): HTMLElement | null {
  const r = state.settings?.retention;
  if (!r) return null;
  // Saves one change; the server's refusal (its limits, in its words) comes back as the error text.
  const save = async (change: Partial<RetentionSetting>): Promise<string | null> => {
    try { state.settings = (await api<SettingsApiResponse>("/api/settings", { method: "PUT", body: { retention: change } })).settings; return null; }
    catch (e) { return errorText(e); }
  };
  // A number field with its unit; a value the server refuses stays in the field, marked, with its reason under it.
  const numberRow = (key: "scanDays" | "runsPerCharacter", title: string, unit: string, help: string) => {
    const id = `set-ret-${key}`;
    const f = input({ type: "number", value: r[key], size: "sm", attrs: { id, "aria-describedby": `${id}-err` } });
    f.disabled = r.keepAll;
    const err = txt("", "field-error");
    err.id = `${id}-err`;
    err.hidden = true;
    f.addEventListener("change", async () => {
      const bad = await save({ [key]: Number(f.value) });
      f.classList.toggle("invalid", !!bad);
      if (bad) f.setAttribute("aria-invalid", "true"); else f.removeAttribute("aria-invalid");
      err.hidden = !bad;
      err.textContent = bad || "";
    });
    return { f, row: row({ title, label: id, control: box("div", { class: "set-inline" }, f, txt(unit, "t-sm muted")), help, below: [err] }) };
  };
  const days = numberRow("scanDays", "Keep scans for", "days", "Older scans are removed, except the ones the inventory still needs, so it never changes.");
  const runs = numberRow("runsPerCharacter", "Saved runs per character", "runs", "Each character keeps their newest saved Suit Builder runs. Named runs are always kept.");
  const counts = ({ scans, runs: n }: CleanupApiResponse): string => [scans ? plural(scans, "scan") : "", n ? plural(n, "run") : ""].filter(Boolean).join(" and ");
  const keptScans = "Every scan was kept: removing the old ones would change the inventory.";
  const clean = button({ label: "Clean up now", disabled: r.keepAll, attrs: { id: "set-ret-clean" }, onClick: async () => {
    try {
      const plan = await api<CleanupApiResponse>("/api/retention/cleanup", { method: "POST", body: { dryRun: true } });
      if (!plan.scans && !plan.runs) { showToast(plan.refused ? keptScans : "Nothing to clean up: everything is inside the limits.", plan.refused ? "info" : "ok"); return; }
      if (!await confirmDialog({ title: "Clean up old data?", body: `This removes ${counts(plan)} from the data folder for good. The inventory stays the same.`, confirmLabel: `Remove ${counts(plan)}` })) return;
      const done = await api<CleanupApiResponse>("/api/retention/cleanup", { method: "POST", body: { dryRun: false } });
      showToast([done.scans || done.runs ? `Removed ${counts(done)}.` : "Nothing was removed.", done.refused ? keptScans : ""].filter(Boolean).join(" "), done.refused ? "info" : "ok");
    } catch (e) { showToast(`Could not clean up: ${errorText(e)}`, "bad"); }
  } });
  const keep = switchControl({ label: "Keep everything", checked: r.keepAll, attrs: { id: "set-ret-keep" }, onChange: async (on) => {
    const bad = await save({ keepAll: on });
    if (bad) { keep.input.checked = !on; showToast(`Could not save: ${bad}`, "bad"); return; }
    days.f.disabled = runs.f.disabled = clean.disabled = on;
  } });
  return box("div", { class: "card set-card", id: "set-retention" },
    row({ title: "Data retention", control: keep.root, help: "Pack Rat removes old scans and saved runs when it starts. Keep everything turns that off." }),
    days.row, runs.row,
    row({ title: "Clean up now", control: clean, help: "Removes what the limits above let go, without waiting for the next start." }));
}
function dataSection(setup: SetupApiResponse): HTMLElement {
  // The data-folder mismatch (#39): the client's scripts write somewhere this app doesn't read. The banner
  // over every screen says so in one short line and links here, where the full sentence with both paths
  // sits next to the folder it is about, and stays.
  const mismatch = dataDirNotice(setup.dataDirCheck);
  const names = knownCharacters();
  const who = select(names.length ? names.map((n) => ({ value: n, label: n })) : [{ value: "", label: "No characters yet" }], names[0] || "", { attrs: { id: "set-forget-who", class: "select set-forget-select" } });
  who.disabled = !names.length;
  const forget = button({ label: "Forget…", variant: "danger-outline", disabled: !names.length, attrs: { id: "set-forget" }, onClick: async () => {
    if (!who.value) return;
    await forgetCharacter(who.value);   // the confirm dialog, the forget and the reload (ui/characters.mts)
    void renderSettings();
  } });
  return section("set-data", "Data",
    box("div", { class: "card set-card" },
      pathRow("Data folder", "data", setup.dataDir, setup.canOpenFolders === true),
      pathRow("Logs", "logs", `${setup.dataDir}${setup.platform === "win32" ? "\\" : "/"}logs`, setup.canOpenFolders === true),
      mismatch ? box("div", { class: "set-row-below set-pad" }, message({ tone: "warn", text: mismatch })) : null),
    retentionCard(),
    blacklistCard([]),
    kindsCard(),
    box("div", { class: "card set-card set-danger", "aria-labelledby": "set-danger-h" },
      el("h3", { class: "t-md strong set-danger-title", id: "set-danger-h" }, "Danger zone"),
      row({ title: "Forget a character", label: "set-forget-who", control: box("div", { class: "set-inline" }, who, forget),
        help: "Their card, worn gear, backpack and bank leave the inventory, and their saved Suit Builder profile is deleted. Their saved runs stay. Scanning them again brings them back." }),
      row({ title: "Forget a container", control: box("a", { class: "btn btn-danger-outline", href: "#/containers" }, txt("Choose in Containers…")),
        help: "Drop a container you emptied. Its last known contents leave the inventory until a scan sees it again." })));
}
// After a scan lands or a Forget, the danger zone's character list follows the inventory (inventory-data.mts's reload()).
document.addEventListener("inventorychange", () => syncSettingsCharacters());
export function syncSettingsCharacters(): void {
  const who = $<HTMLSelectElement>("#set-forget-who");
  if (!who || !state.setup) return;
  const names = knownCharacters();
  if (names.join("\n") === [...who.options].map((o) => o.value).join("\n")) return;
  void renderSettings(state.setup);
}

// ---------------------------------------------------------------- AI assistants (MCP), issue #211
// The built-in MCP server (app/mcp.mts): its switch, the second switch for in-game actions, and, while it runs, the
// address, the token (hidden until Show), and a Claude Code command and a JSON snippet built from both. The card is
// filled once GET /api/mcp answers, and drawn again after every change. While it is off only the two switches show.
let mcpTokenShown = false;
function mcpSection(): HTMLElement {
  return section("set-mcp", "AI assistants (MCP)", box("div", { class: "card set-card", id: "set-mcp-card" }));
}
async function syncMcpCard(): Promise<void> {
  if (!$("#set-mcp-card")) return;
  let card: HTMLElement;
  try { card = mcpCard(await api<McpApiResponse>("/api/mcp")); }
  catch (e) { card = box("div", { class: "card set-card", id: "set-mcp-card" }, box("div", { class: "set-row-below set-pad" }, message({ tone: "bad", title: "Could not read the MCP settings", text: errorText(e) }))); }
  $<HTMLElement>("#set-mcp-card")?.replaceWith(card);
}
// One line, so it pastes the same into any shell (a trailing backslash continues a line only in POSIX shells).
const mcpCommand = (url: string, token: string): string => `claude mcp add --transport http --scope user pack-rat ${url} --header "Authorization: Bearer ${token}"`;
const mcpJson = (url: string, token: string): string => JSON.stringify({ mcpServers: { "pack-rat": { type: "http", url, headers: { Authorization: `Bearer ${token}` } } } }, null, 2);
async function copyWith(text: string, what: string): Promise<void> {
  if (await copyText(text)) showToast(`Copied the ${what}.`, "ok"); else showToast(`Could not copy the ${what}.`, "bad");
}
function mcpCard(r: McpApiResponse): HTMLElement {
  const { config: c, live } = r;
  const save = async (change: { enabled?: boolean; allowActions?: boolean }): Promise<void> => {
    try { await api("/api/mcp", { method: "PUT", body: change }); } catch (e) { showToast(`Could not save: ${errorText(e)}`, "bad"); }
    void syncMcpCard();
  };
  const on = switchControl({ label: c.enabled ? "On" : "Off", checked: c.enabled, attrs: { id: "set-mcp-on" }, onChange: (v) => { void save({ enabled: v }); } });
  const acts = switchControl({ label: c.allowActions ? "On" : "Off", checked: c.allowActions, attrs: { id: "set-mcp-actions" }, onChange: (v) => { void save({ allowActions: v }); } });
  const rows: HTMLElement[] = [
    row({ title: "MCP server", label: "set-mcp-on", control: on.root, help: "Lets Claude Code and other MCP clients search your inventory, read character sheets, compare saved runs and run the Suit Builder. Only programs on this computer that have the token can connect. What a connected assistant reads can be sent to its AI provider.",
      below: [c.enabled && !live.listening ? message({ tone: "bad", text: "The MCP server could not start. The server log in the data folder says why." }) : null] }),
    row({ title: "Allow in-game actions", label: "set-mcp-actions", control: acts.root, help: "Also lets them Highlight, Go to, Grab and run Organize trips, through the same bridge and checks as the buttons." }),
  ];
  if (c.enabled && live.listening && live.port != null && c.token) {
    const url = `http://127.0.0.1:${live.port}/mcp`, token = c.token;
    const shown = mcpTokenShown ? token : token.replace(/[^-]/g, "•");
    rows.push(
      row({ title: "Address", help: el("span", { class: "mono", id: "set-mcp-url" }, url), control: button({ label: "Copy", attrs: { id: "set-mcp-copy-url", "aria-label": "Copy address" }, onClick: () => { void copyWith(url, "address"); } }),
        below: [live.portBusy != null ? message({ tone: "warn", title: `Port ${live.portBusy} was busy`, text: `Pack Rat is using port ${live.port} this time. Clients set up with the old address can't connect until the next launch frees it, or copy the command again.` }) : null] }),
      row({ title: "Token", help: el("span", {}, el("span", { class: "mono", id: "set-mcp-token" }, shown), " A new token disconnects every client set up with the old one."),
        control: box("div", { class: "set-inline" },
          button({ label: mcpTokenShown ? "Hide" : "Show", variant: "ghost", attrs: { id: "set-mcp-show" }, onClick: () => { mcpTokenShown = !mcpTokenShown; void syncMcpCard(); } }),
          button({ label: "Copy", attrs: { id: "set-mcp-copy-token", "aria-label": "Copy token" }, onClick: () => { void copyWith(token, "token"); } }),
          button({ label: "New token", attrs: { id: "set-mcp-new-token" }, onClick: async () => {
            if (!await confirmDialog({ title: "Make a new token?", body: "Every MCP client set up with the current token stops connecting until you give it the new one: copy the command or the JSON again.", confirmLabel: "New token" })) return;
            try { await api("/api/mcp/token", { method: "POST", body: {} }); showToast("New token made. Copy the command or the JSON again.", "ok"); }
            catch (e) { showToast(`Could not make a new token: ${errorText(e)}`, "bad"); }
            void syncMcpCard();
          } })) }),
      row({ title: "Claude Code", help: el("span", {}, "Run this once in a terminal. ", el("span", { class: "mono" }, "--scope user"), " makes Pack Rat available in every project."),
        control: button({ label: "Copy command", variant: "primary", attrs: { id: "set-mcp-copy-command" }, onClick: () => { void copyWith(mcpCommand(url, token), "command"); } }),
        below: [el("pre", { class: "set-code", id: "set-mcp-command" }, mcpCommand(url, shown))] }),
      row({ title: "Other MCP clients", help: "Paste into the client's MCP settings (Streamable HTTP).",
        control: button({ label: "Copy JSON", attrs: { id: "set-mcp-copy-json" }, onClick: () => { void copyWith(mcpJson(url, token), "JSON"); } }),
        below: [el("pre", { class: "set-code", id: "set-mcp-json" }, mcpJson(url, shown))] }));
  }
  return box("div", { class: "card set-card", id: "set-mcp-card" }, ...rows);
}

// ---------------------------------------------------------------- Updates
function updateMessage(r: UpdateCheckApiResponse, current: string | undefined): HTMLElement {
  if (!r.configured) return message({ tone: "info", text: "This build has no update source, so it can't check for updates." });
  if (r.error) return message({ tone: "bad", text: `Could not check: ${r.error}. Try again later.` });
  if (r.upToDate) return message({ tone: "ok", text: `You have the latest version, ${r.current || current}.` });
  // r.url is a string the server vouched for: installer.mts's checkForUpdates runs GitHub's html_url
  // through releaseUrl(), which returns it only when it really is an https://github.com/<this repo>/
  // releases… address and falls back to that repository's own releases page otherwise.
  return message({ tone: "info", title: `Pack Rat ${r.latest} is out`, text: `You have ${r.current || current}. Nothing downloads without asking.`,
    actions: r.url ? [el("a", { href: r.url, target: "_blank", rel: "noopener noreferrer" }, "View release")] : [] });
}
function updatesSection(setup: SetupApiResponse): HTMLElement {
  const btn = button({ label: checking ? "Checking…" : "Check for updates", icon: "refresh", disabled: checking, attrs: { id: "set-check-updates" }, onClick: async () => {
    checking = true; void renderSettings(setup);
    try { lastUpdateCheck = await api<UpdateCheckApiResponse>("/api/update-check"); }
    catch (e) { lastUpdateCheck = { configured: true, error: errorText(e) }; }
    checking = false; void renderSettings(setup);
  } });
  const auto = switchControl({ label: "Check automatically", checked: state.settings?.autoUpdateCheck !== false, attrs: { id: "set-auto-update" }, onChange: async (on) => {
    try { state.settings = (await api<SettingsApiResponse>("/api/settings", { method: "PUT", body: { autoUpdateCheck: on } })).settings; }
    catch (e) { auto.input.checked = !on; showToast(`Could not save: ${errorText(e)}`, "bad"); return; }
    scheduleUpdateChecks();
  } });
  return section("set-updates", "Updates", box("div", { class: "card set-card" },
    row({ title: setup.version ? `Pack Rat ${setup.version}` : "Pack Rat", control: btn, help: "Checks GitHub for a newer release. Nothing downloads without asking.",
      below: [lastUpdateCheck ? updateMessage(lastUpdateCheck, setup.version) : null] }),
    row({ title: "Check for updates automatically", control: auto.root, help: "Looks for a newer release shortly after Pack Rat opens and every 6 hours while it stays open, and says so above the screen. Nothing downloads." })));
}
// The automatic check (#67): with the switch above on, GET /api/update-check shortly after load and every
// 6 hours after that. A release newer than this one shows #update-notice above the screen with a link to
// it and Dismiss, which saves that version (ui-prefs dismissedUpdate) so only a later release shows again.
// A failed check or a build with no update source says nothing here; the button above is where that shows.
const AUTO_CHECK_DELAY_MS = 5_000, AUTO_CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
let autoTimer: ReturnType<typeof setTimeout> | undefined;
let autoFound: UpdateCheckApiResponse | null = null;
let dismissedUpdate: string | undefined;
export function startUpdateChecks(dismissed: string | undefined): void {
  dismissedUpdate = dismissed;
  scheduleUpdateChecks();
}
function scheduleUpdateChecks(): void {
  clearTimeout(autoTimer);
  renderUpdateNotice();
  if (state.settings?.autoUpdateCheck === false) return;
  const tick = async (): Promise<void> => {
    autoTimer = setTimeout(tick, AUTO_CHECK_EVERY_MS);
    try { autoFound = await api<UpdateCheckApiResponse>("/api/update-check"); } catch { return; }
    renderUpdateNotice();
  };
  autoTimer = setTimeout(tick, AUTO_CHECK_DELAY_MS);
}
function renderUpdateNotice(): void {
  const n = $<HTMLElement>("#update-notice");
  if (!n) return;
  const r = autoFound;
  n.hidden = !r?.configured || !!r.error || r.upToDate !== false || !r.latest || r.latest === dismissedUpdate || state.settings?.autoUpdateCheck === false;
  if (n.hidden || !r) { n.replaceChildren(); return; }
  const latest = r.latest!;
  // r.url is vetted by the server exactly as updateMessage's is (installer.mts's releaseUrl).
  n.replaceChildren(...compactChildren([
    el("span", {}, `Pack Rat ${latest} is available.`),
    r.url ? el("a", { class: "btn btn-sm", href: r.url, target: "_blank", rel: "noopener noreferrer" }, "View release") : null,
    el("button", { type: "button", class: "btn btn-ghost btn-sm", onclick: () => {
      dismissedUpdate = latest; renderUpdateNotice();
      prefs.set({ dismissedUpdate: latest }, { quiet: true });   // a view choice; it just shows again next launch
    } }, "Dismiss"),
  ]));
}
