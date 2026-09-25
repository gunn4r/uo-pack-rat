// ui/settings.mts — the Settings screen (design spec 4.11): four sections (General, Game client, Data,
// Updates) in a 720px column of cards made of setting rows — title and help on the left, the control
// on the right. General holds the look (theme family, appearance) and the shard rules; Game client its
// status, Run setup and Reinstall; Data the data folder and logs with Open, the blacklisted containers,
// how long old scans and saved runs are kept, and the danger zone (forget a character, forget a container); Updates the version and the update check. Always re-fetches GET
// /api/setup on render (a cheap directory listing) so it reflects whatever the wizard, or this screen's
// own actions, just changed.
import { state } from "./store.mts";
import { $, el, noteEl } from "./dom.mts";
import { api } from "./api.mts";
import { badge, box, button, check, confirmDialog, copyText, input, message, segmented, select, switchControl, txt, showToast, type Kids } from "./components.mts";
import { plural } from "./builder-model.mts";
import { applyLook, currentLook, resolveTheme, BUILT_THEMES, type Appearance } from "./theme.mts";
import { changeShard } from "./shard.mts";
import { openWizard } from "./wizard.mts";
import { forgetCharacter } from "./characters.mts";
import { bridgeNote, renderDataDirNotice } from "./bridge.mts";
import { adapterCopy } from "./adapter-copy.mts";
import { clientErrorMessage, dataDirNotice, errorText, hostErrorMessage, installedIntoNote, pathsFileNote, relativeWhen } from "./messages.mts";
import { autostartNote, panelControls } from "./tazuo-panel.mts";
import type { SetupApiResponse, InstallApiResponse, UpdateCheckApiResponse, BlacklistApiResponse, CleanupApiResponse, RetentionSetting, SettingsApiResponse, PanelPrefs, TazuoPanelApiResponse } from "./api-types.mts";
import type { BlacklistEntry } from "../vault-lib.mts";

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
  renderDataDirNotice();
  root.replaceChildren(generalSection(), clientSection(setup), dataSection(setup), updatesSection(setup));
  void syncSettingsBlacklist();
  void syncPanelCard();
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
  const save = (body: Record<string, string>): void => { api("/api/ui-prefs", { method: "PUT", body }).catch((e: Error) => showToast(`Could not save the look: ${e.message}`, "bad")); };
  const theme = select(THEMES.map((t) => ({ value: t.id, label: isBuilt(t.id) ? t.label : `${t.label} (coming soon)`, disabled: !isBuilt(t.id) })), resolveTheme(look.theme), { attrs: { id: "set-theme", class: "select set-select" } });
  theme.addEventListener("change", () => { applyLook({ theme: theme.value }); save({ theme: theme.value }); });
  const appearance = segmented({ label: "Appearance", value: look.appearance,
    options: [{ value: "light", label: "Light" }, { value: "system", label: "System" }, { value: "dark", label: "Dark" }],
    onChange: (v) => { applyLook({ appearance: v as Appearance }); save({ appearance: v }); } });
  appearance.id = "set-appearance";
  const shard = select(state.availableShards.map((r) => ({ value: r.id, label: r.name })), state.settings?.shard || "", { attrs: { id: "shard", class: "select set-select" } });
  shard.addEventListener("change", async () => { if (!await changeShard(shard.value)) shard.value = state.settings!.shard; });
  return section("set-general", "General", box("div", { class: "card set-card" },
    row({ title: "Theme", label: "set-theme", control: theme,
      help: isBuilt("britannia") ? "Default is the clean look. Britannia dresses Pack Rat in parchment and brass frames." : "Default is the clean look. A Britannia theme with parchment and brass frames comes in a later release." }),
    row({ title: "Appearance", control: appearance, help: "System follows your computer's light or dark setting." }),
    row({ title: "Shard rules", label: "shard", control: shard, help: "Property caps, the Resisting Spells bonus, rarity colours and the gargoyle race lock." })));
}

// ---------------------------------------------------------------- Game client: status, setup, reinstall
function clientSection(setup: SetupApiResponse): HTMLElement {
  const client = setup.settings.client;
  const adapter = client ? setup.adapters.find((a) => a.id === client.adapter) : undefined;
  const setupBtn = button({ label: "Run setup", variant: client ? "secondary" : "primary", onClick: () => void openWizard({ firstRun: false }), attrs: { id: "set-run-setup" } });
  const stopall = "Type -stopall in game first so no script is running.";
  let status: HTMLElement;
  let reinstallRow: HTMLElement;
  if (!client) {
    status = row({ title: "Client", control: setupBtn, help: "No client set up yet. In-game Highlight, Grab and Go to need one." });
    reinstallRow = row({ title: "Reinstall scanner scripts", muted: true, control: button({ label: "Reinstall", disabled: true }), help: `Available once a client is set up. ${stopall}` });
  } else if (adapter?.transport === "paste") {
    // A paste-transport client has no scripts folder and nothing to reinstall (settings.client.scriptsDir is "").
    const c = adapterCopy(adapter);
    status = row({ title: c.short, control: setupBtn, help: "Nothing to install: paste what its scanner prints into Import (⌘I)." });
    reinstallRow = row({ title: "Reinstall scanner scripts", muted: true, control: button({ label: "Reinstall", disabled: true }), help: `Nothing to install for the ${c.short}.` });
  } else {
    const name = adapter ? adapterCopy(adapter).short : client.adapter;
    const installed = setup.installed?.version;
    const available = setup.available?.[client.adapter];
    const statusHelp = el("span", {}, installed ? `Scanner ${installed} installed in ` : "No scanner installed yet in ", el("span", { class: "mono" }, client.scriptsDir), ".");
    const note = bridgeNote();
    status = row({ title: name, control: setupBtn, help: statusHelp,
      below: [available && available !== installed ? box("div", { class: "set-inline" }, badge(`${available} available`, "accent"), txt("Reinstall to update the scanner.", "t-sm muted")) : null,
        note ? message({ tone: "warn", text: note }) : null] });
    const confirm = check({ label: "I typed -stopall in game and nothing is running", checked: reinstall.checked, attrs: { id: "set-stopall" },
      onChange: (on) => { reinstall.checked = on; void renderSettings(setup); } });
    const btn = button({ label: reinstall.busy ? "Reinstalling…" : "Reinstall", disabled: !reinstall.checked || reinstall.busy, attrs: { id: "set-reinstall" }, onClick: async () => {
      reinstall.error = null; reinstall.busy = true; void renderSettings(setup);
      try { reinstall.result = await api<InstallApiResponse>("/api/setup/install", { method: "POST", body: { adapter: client.adapter, scriptsDir: client.scriptsDir } }); }
      // The 409 "-stopall" text comes through verbatim; the one failure worth rewording is the folder this
      // row just sent being gone since it was persisted (messages.mts's clientFolderGone).
      catch (e) { reinstall.error = clientErrorMessage(e); }
      reinstall.busy = false; reinstall.checked = false;
      void renderSettings();
    } });
    const r = reinstall.result;
    reinstallRow = row({ title: "Reinstall scanner scripts", control: btn, help: `Puts a fresh copy of the scanner in the scripts folder. ${stopall}`,
      below: [box("div", { class: "set-inline" }, confirm.root),
        reinstall.error ? message({ tone: "bad", title: "Could not reinstall", text: reinstall.error }) : null,
        // Where the scripts actually went (the server resolves it), and what became of packrat-paths.json —
        // a "kept" file is the whole reason scans then stop arriving (app/installer.mts's writePathsFile).
        r ? message({ tone: "ok", title: "Reinstalled", text: r.installed.join(", ") }) : null,
        r ? noteEl(installedIntoNote(r.scriptsDir)) : null,
        r ? noteEl(pathsFileNote(r.pathsFile)) : null] });
  }
  return sectionFlagged("set-client", "Game client", !setup.settings.client, box("div", { class: "card set-card" }, status, reinstallRow),
    client?.adapter === "tazuo" && client.scriptsDir ? box("div", { class: "card set-card", id: "set-panel" }) : null);
}

// The TazUO in-game panel's options (app/ui/tazuo-panel.mts), filled in once GET /api/tazuo-panel answers.
// Each change saves at once; what became of it (or the server's refusal) shows under the controls.
let panelNote: { tone: "ok" | "warn" | "bad"; text: string; row: "login" | "hotkey" } | null = null;
async function syncPanelCard(): Promise<void> {
  if (!$("#set-panel")) return;
  try { $<HTMLElement>("#set-panel")?.replaceWith(panelCard(await api<TazuoPanelApiResponse>("/api/tazuo-panel"))); } catch { /* the card keeps what it showed */ }
}
function panelCard(r: TazuoPanelApiResponse): HTMLElement {
  const save = async (change: Partial<PanelPrefs>): Promise<void> => {
    const at = "hotkey" in change ? "hotkey" : "login";
    try { const n = autostartNote((await api<TazuoPanelApiResponse>("/api/tazuo-panel", { method: "PUT", body: change })).autostart); panelNote = n && { ...n, row: "login" }; }
    catch (e) { panelNote = { tone: "bad", text: errorText(e), row: at }; }
    void syncPanelCard();
  };
  const c = panelControls(r.prefs, (change) => void save(change), "set-panel");
  // A choice not yet in TazUO's list (saved while TazUO ran, or never saved at all) says so.
  const note = panelNote ?? (r.autostartOn != null && r.autostartOn !== r.prefs.openAtLogin
    ? { tone: "warn" as const, text: "Not in TazUO's autostart list yet. Pack Rat changes that list only while TazUO is closed.", row: "login" as const } : null);
  panelNote = null;
  const noteFor = (at: "login" | "hotkey") => note?.row === at ? message({ tone: note.tone, text: note.text }) : null;
  return box("div", { class: "card set-card", id: "set-panel" },
    row({ title: "In-game panel", control: c.login, help: "Adds packrat-panel.py to TazUO's autostart list, so its window opens every time you log in.", below: [noteFor("login")] }),
    row({ title: "Panel hotkey", control: c.hotkey, help: "Shows or hides the panel in game. A letter or digit needs a modifier, since the hotkey also fires while you type in chat.", below: [noteFor("hotkey")] }));
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
    .filter((n) => !n.startsWith("_")).sort((a, b) => a.localeCompare(b));
}
// The containers scans never open, newest first, each with Unblacklist. Containers and the in-game
// packrat-blacklist.py both change the list, so this card alone is fetched again on every visit (app.mts).
export async function syncSettingsBlacklist(): Promise<void> {
  if (!$("#set-blacklist")) return;
  try { $<HTMLElement>("#set-blacklist")?.replaceWith(blacklistCard((await api<BlacklistApiResponse>("/api/blacklist")).containers)); } catch { /* the card keeps what it showed */ }
}
function blacklistCard(list: BlacklistEntry[]): HTMLElement {
  return box("div", { class: "card set-card", id: "set-blacklist" },
    row({ title: "Blacklisted containers", help: list.length ? "Scans never open these." : "None. Blacklist a ground container from its ⋯ menu in Containers, or in game with packrat-blacklist.py (TazUO)." }),
    ...[...list].reverse().map((e) => row({ title: e.name, help: [e.where, `added ${relativeWhen(e.addedAt)}`].filter(Boolean).join(" · "),
      control: button({ label: "Unblacklist", size: "sm", attrs: { "aria-label": `Unblacklist ${e.name}` }, onClick: async () => {
        try { await api(`/api/blacklist/${e.serial}`, { method: "DELETE" }); showToast(`Unblacklisted ${e.name}: the next scan reads it again.`, "ok"); }
        catch (err) { showToast(errorText(err), "bad"); }
        void syncSettingsBlacklist();
      } }) })));
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
    box("div", { class: "card set-card set-danger", "aria-labelledby": "set-danger-h" },
      el("h3", { class: "t-md strong set-danger-title", id: "set-danger-h" }, "Danger zone"),
      row({ title: "Forget a character", label: "set-forget-who", control: box("div", { class: "set-inline" }, who, forget),
        help: "Their card, worn gear, backpack and bank leave the inventory, and their saved Suit Builder profile is deleted. Their saved runs stay. Scanning them again brings them back." }),
      row({ title: "Forget a container", control: box("a", { class: "btn btn-danger-outline", href: "#/containers" }, txt("Choose in Containers…")),
        help: "Drop a container you emptied. Its last known contents leave the inventory until a scan sees it again." })));
}
// After a scan lands or a Forget, the danger zone's character list follows the inventory (app.mts's reload()).
export function syncSettingsCharacters(): void {
  const who = $<HTMLSelectElement>("#set-forget-who");
  if (!who || !state.setup) return;
  const names = knownCharacters();
  if (names.join("\n") === [...who.options].map((o) => o.value).join("\n")) return;
  void renderSettings(state.setup);
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
  return section("set-updates", "Updates", box("div", { class: "card set-card" },
    row({ title: setup.version ? `Pack Rat ${setup.version}` : "Pack Rat", control: btn, help: "Checks GitHub for a newer release. Nothing downloads without asking.",
      below: [lastUpdateCheck ? updateMessage(lastUpdateCheck, setup.version) : null] })));
}
