// ui/wizard.mts — the first-run / "Run setup" wizard (design spec 4.10): shard → client → client folder →
// install scanner for a folder-transport client (see docs/adapter-guide.md), or shard → client → nothing
// to install → paste your first scan for a paste-transport one, like the ClassicUO web client. The
// stepper names the steps, and picking a paste client renames steps 3 and 4 at once, so the branch shows
// up front. A <dialog id="wizard"> (index.html ships it empty) that this module fills and drives with
// showModal()/close(). Each step has one primary action; every close path (Finish, Set up later, Esc)
// marks setup done so the wizard never traps the user or reopens itself, and Settings keeps a reminder
// while no client is set up. What the wizard says about a client is written per adapter
// (ui/adapter-copy.mts), never assembled from its README title.
import { state } from "./store.mts";
import { $, el, noteEl } from "./dom.mts";
import { api } from "./api.mts";
import { box, button, check, field, input, message, select, stepper, txt, badge, showToast } from "./components.mts";
import { clientErrorMessage, errorText, hostErrorMessage, installedIntoNote, pathsFileNote } from "./messages.mts";
import { renderSettings } from "./settings.mts";
import { changeShard } from "./shard.mts";
import { defaultAdapterId, availableAdapters, platformCompatible } from "./adapters.mts";
import { adapterCopy, clientCard, wizardSteps } from "./adapter-copy.mts";
export { defaultAdapterId, availableAdapters, platformCompatible };
import type { SetupApiResponse, AdapterSummary, InstalledVersionInfo, LocateApiResponse, InstallApiResponse, HostPickFolderApiResponse, ApiError, SettingsApiResponse } from "./api-types.mts";

// The shard's AFK rule, shown verbatim on step 1 only for shards that need it (uoalive today).
const AFK_NOTICE = "UO Alive allows AFK skill training, but bans unattended resource, combat and loot gathering. Pack Rat's scripts are attended tools: they read what you can see and move an item only when you click.";

// "What to press in game" is built from the script NAMES the install just reported, not copied from
// one adapter's README — adapters/tazuo/ ships packrat-refresh.py and adapters/razor-enhanced/
// doesn't, so a fixed TazUO-shaped list would be wrong (or incomplete) for any other folder-transport
// adapter. Every adapter that ships a script matching one of these three follows the same
// packrat-scanner.py / packrat-refresh.py / packrat-bridge.py naming convention (docs/adapter-guide.md);
// a script whose name matches none of them is a future kind of script this list doesn't know how to
// describe yet, so it's simply left out rather than guessed at.
function whatToPress(installedNames: string[]): HTMLElement[] {
  const has = (key: string): string | undefined => installedNames.find((n) => n.includes(key));
  const line = (before: string, name: string, after: string): HTMLElement => el("li", {}, el("span", {}, before, el("code", {}, name), after));
  const lines: HTMLElement[] = [];
  const refresh = has("refresh");
  if (refresh) lines.push(line("After a gearing or skill-training session on a character: run ", refresh, "."));
  const scanner = has("scanner");
  if (scanner) lines.push(line("The first time you scan a character, or whenever chests or bags move or get restocked: stand near them and run ", scanner, ". Repeat at each cluster."));
  const bridge = has("bridge");
  if (bridge) lines.push(line("Whenever you want Pack Rat's Highlight, Grab and Go to buttons: start ", bridge, " and leave it running."));
  return lines;
}

// This wizard "session"'s working state — rebuilt fresh every openWizard() call.
interface WizState {
  firstRun: boolean;
  setup: SetupApiResponse;
  step: number;
  shard: string;
  adapter: string | null;
  scriptsDir: string | null;
  typedPath: string;           // kept in the field after a failed "Use this path"
  locateError: string | null;
  hostPicker: boolean;         // false once POST /api/host/pick-folder answers 501 (no desktop shell)
  installed: InstalledVersionInfo | null;
  noRunningChecked: boolean;
  installResult: InstallApiResponse | null;
  installError: string | null;
  busy: boolean;
}
let wiz: WizState | null = null;

export async function openWizard({ firstRun = false }: { firstRun?: boolean } = {}): Promise<void> {
  const dialog = $<HTMLDialogElement>("#wizard");
  if (!dialog) return;
  let setup: SetupApiResponse;
  try { setup = await api<SetupApiResponse>("/api/setup"); }
  catch (e) { showToast(`Could not load setup info: ${errorText(e)}`, "bad"); return; }
  state.setup = setup;
  const client = setup.settings.client;
  wiz = {
    firstRun, setup, step: 1,
    shard: setup.settings.shard || state.settings?.shard || state.availableShards?.[0]?.id || "",
    // availableAdapters filters out Razor Enhanced on any platform but win32 (Phase 6 final review,
    // deferred minor) — defaultAdapterId itself has no platform of its own to filter by, and
    // "razor-enhanced" sorts before "tazuo" alphabetically, so passing it the unfiltered list would
    // default a Mac/Linux player straight to the one adapter that can never work for them.
    adapter: client?.adapter || defaultAdapterId(availableAdapters(setup.adapters, setup.platform)),
    scriptsDir: client?.scriptsDir || null,
    typedPath: client?.scriptsDir || "",
    locateError: null, hostPicker: true,
    installed: client ? setup.installed : null,   // {version, files} for the already-configured client, if any
    noRunningChecked: false,
    installResult: null, installError: null, busy: false,
  };
  // Reset from any previous session: returnValue sticks across showModal() calls, and the "close"
  // listener below only skips persistSetupDone() when it reads exactly "done" — without this, a
  // second open (e.g. "Run setup") that ends in Esc would silently inherit the last session's "done".
  dialog.returnValue = "";
  render();
  if (!dialog.open) dialog.showModal();
  focusStep();
}

// The adapter object (listAdapters' shape) currently selected — looked up fresh each call, since the
// radio in step 2 is the only thing that ever changes wiz.adapter and always re-renders right after.
function currentAdapterInfo(): AdapterSummary | null {
  return wiz!.setup.adapters.find((a) => a.id === wiz!.adapter) || null;
}
// A paste-transport client (docs/adapter-guide.md — the ClassicUO web client today) has no folder to
// locate and no scripts to install: steps 3 and 4 branch on this instead of naming the adapter.
function isPasteAdapter(): boolean {
  return currentAdapterInfo()?.transport === "paste";
}
const copy = (): ReturnType<typeof adapterCopy> => adapterCopy(currentAdapterInfo() || { id: wiz!.adapter || "", name: wiz!.adapter || "your client" });

// ---------------------------------------------------------------- frame
function render(): void {
  const dialog = $<HTMLDialogElement>("#wizard");
  if (!dialog || !wiz) return;
  const steps = wizardSteps(isPasteAdapter());
  const { question, help, body } = stepContent();
  dialog.setAttribute("aria-labelledby", "wiz-title");
  dialog.replaceChildren(
    box("header", { class: "overlay-head wiz-head" },
      box("div", { class: "wiz-title-row" }, el("img", { src: "/favicon.png", alt: "", class: "wiz-logo" }), el("h2", { id: "wiz-title" }, "Set up Pack Rat"),
        el("span", { class: "spacer" }), txt(`Step ${wiz.step} of ${steps.length}`, "t-sm muted")),
      stepper(steps, wiz.step - 1, "Setup steps")),
    box("div", { class: "wiz-body" },
      box("div", { class: "wiz-question" }, el("h3", { class: "t-lg", id: "wiz-q" }, question), help ? el("p", { class: "muted" }, txt(help)) : null),
      ...body),
    footer());
}

interface StepContent { question: string; help?: string | undefined; body: Array<HTMLElement | null> }
function stepContent(): StepContent {
  if (wiz!.step === 1) return step1();
  if (wiz!.step === 2) return step2();
  if (isPasteAdapter()) return wiz!.step === 3 ? pasteStep3() : pasteStep4();
  return wiz!.step === 3 ? step3() : step4();
}

// Focus the step's first control (or the question) after a step change, so the keyboard lands on it.
function focusStep(): void {
  const d = $<HTMLDialogElement>("#wizard");
  const first = d?.querySelector<HTMLElement>(".wiz-body input[type=radio]:checked") || d?.querySelector<HTMLElement>(".wiz-body :is(input:not([disabled]), select, button:not([disabled]))");
  (first || d?.querySelector<HTMLElement>("#wiz-primary"))?.focus();
}
function go(step: number): void { wiz!.step = step; render(); focusStep(); }

// ---------------------------------------------------------------- step 1: shard
function step1(): StepContent {
  const sel = select(state.availableShards.map((r) => ({ value: r.id, label: r.name })), wiz!.shard, { size: "lg", attrs: { id: "wiz-shard" } });
  // The pick is only remembered here: changeShard reloads the page, which would close the wizard, so
  // finish() applies it (Set up later and Esc leave the saved shard alone).
  sel.addEventListener("change", () => { wiz!.shard = sel.value; render(); $<HTMLSelectElement>("#wiz-shard")?.focus(); });
  return {
    question: "Which shard do you play on?",
    help: "Pack Rat reads item property caps, rarity colours and the Resisting Spells bonus from the shard's rules.",
    body: [field({ label: "Shard rules", control: sel }), wiz!.shard === "uoalive" ? message({ tone: "info", text: AFK_NOTICE }) : null],
  };
}

// ---------------------------------------------------------------- step 2: client
// Every adapter is offered as a radio card regardless of transport — a paste-transport client still
// needs to be named so steps 3/4 branch correctly. A platform-incompatible adapter (Razor Enhanced on a
// Mac — a.platform from capabilities.json, never a hard-coded id, see platformCompatible) is still SHOWN,
// so a player who's heard of it doesn't wonder why it's missing, but its card is disabled and says why.
// The default selection (openWizard) is drawn from availableAdapters, so the wizard never lands on it.
function step2(): StepContent {
  const adapters = wiz!.setup.adapters || [];
  if (!adapters.length) return { question: "Which game client do you play on?", body: [message({ tone: "bad", text: "This build has no game clients to set up. Reinstall Pack Rat." })] };
  // Clients this machine can run first, installable before paste, then the ones it can't.
  const rank = (a: AdapterSummary): number => (platformCompatible(a, wiz!.setup.platform) ? (a.transport === "paste" ? 1 : 0) : 2);
  const cards = [...adapters].sort((a, b) => rank(a) - rank(b)).map((a) => {
    const c = clientCard(a, wiz!.setup.platform);
    const radio = el("input", { type: "radio", name: "wiz-adapter", value: a.id, "aria-describedby": `wiz-card-${a.id}` });
    radio.checked = a.id === wiz!.adapter;
    radio.disabled = !c.available;
    radio.addEventListener("change", () => {
      wiz!.adapter = a.id; wiz!.scriptsDir = null; wiz!.typedPath = ""; wiz!.locateError = null; wiz!.installed = null; wiz!.installResult = null;
      render();
      $<HTMLInputElement>(`#wizard input[value="${a.id}"]`)?.focus();
    });
    return box("label", { class: `card wiz-card${radio.checked ? " on" : ""}${c.available ? "" : " off"}` }, radio,
      box("span", { class: "wiz-card-name" }, txt(c.name, "strong t-md"), badge(c.badge.text, c.badge.tone)),
      el("span", { class: "wiz-card-text muted", id: `wiz-card-${a.id}` }, txt(c.sentence)));
  });
  return {
    question: "Which game client do you play on?",
    help: "Pack Rat puts a small scanner into your client, or reads what it prints. You can change this later in Settings.",
    body: [el("fieldset", { class: "wiz-cards" }, el("legend", { class: "sr" }, "Game client"), ...cards)],
  };
}

// ---------------------------------------------------------------- step 3: client folder (folder transport)
function step3(): StepContent {
  const c = copy();
  const candidates = wiz!.setup.candidates[wiz!.adapter as string] || [];
  const found = candidates.length ? el("fieldset", { class: "wiz-dirs" }, el("legend", { class: "label" }, "Found on this computer"),
    ...candidates.map((dir) => {
      const radio = el("input", { type: "radio", name: "wiz-dir", value: dir, onchange: () => { wiz!.typedPath = dir; void locate(dir); } });
      radio.checked = dir === wiz!.scriptsDir;
      return box("label", { class: "check" }, radio, txt(dir, "mono ellip"));
    })) : null;
  // The path field keeps what was typed after a failed "Use this path", with the reason under it.
  const path = input({ value: wiz!.typedPath, placeholder: "/path/to/the/folder", invalid: !!wiz!.locateError, attrs: { id: "wiz-path", class: "input mono", spellcheck: "false", autocomplete: "off" } });
  path.addEventListener("input", () => { wiz!.typedPath = path.value; });
  path.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); usePath(); } });
  const err = wiz!.locateError ? message({ tone: "bad", text: wiz!.locateError, attrs: { id: "wiz-path-err" } }) : null;
  if (err) path.setAttribute("aria-describedby", "wiz-path-err");
  const resolved = wiz!.scriptsDir && !wiz!.locateError
    ? message({ tone: "ok", title: "Found it", text: el("span", {}, el("span", { class: "mono" }, wiz!.scriptsDir), wiz!.installed?.version ? ` already has scanner ${wiz!.installed.version}. Installing again updates it.` : " is where the scanner goes.") })
    : null;
  return {
    question: c.folderQuestion!, help: c.folderHelp,
    body: [
      found,
      box("div", { class: "field" }, el("label", { class: "label", for: "wiz-path" }, candidates.length ? "Or type its path" : "Folder path"),
        box("div", { class: "wiz-path-row" }, path,
          button({ label: "Use this path", disabled: wiz!.busy, onClick: usePath, attrs: { id: "wiz-use-path" } }),
          wiz!.hostPicker ? button({ label: "Choose a folder…", icon: "folder", disabled: wiz!.busy, onClick: () => void pickFolder(c.folderPick!) }) : null)),
      err,
      resolved,
    ],
  };
}
function usePath(): void {
  const v = wiz!.typedPath.trim();
  if (!v) { wiz!.locateError = "Type the folder's full path first."; render(); $<HTMLInputElement>("#wiz-path")?.focus(); return; }
  void locate(v);
}
async function pickFolder(title: string): Promise<void> {
  try {
    const r = await api<HostPickFolderApiResponse>("/api/host/pick-folder", { method: "POST", body: { title } });
    if (r.path) { wiz!.typedPath = r.path; await locate(r.path); }
  } catch (e) {
    // 501: no desktop shell (a bare `node vault-server.mts`) — the typed path is the way in.
    if ((e as ApiError).status === 501) { wiz!.hostPicker = false; render(); $<HTMLInputElement>("#wiz-path")?.focus(); }
    // 504: the shell never answered the picker (app/vault-server.mts's withHostTimeout).
    else showToast(hostErrorMessage(e, "Could not open the folder picker"), "bad");
  }
}
async function locate(dir: string): Promise<void> {
  wiz!.busy = true; render();
  try {
    const r = await api<LocateApiResponse>("/api/setup/locate", { method: "POST", body: { adapter: wiz!.adapter, dir } });
    wiz!.scriptsDir = r.scriptsDir; wiz!.installed = r.installed; wiz!.locateError = null;
  } catch (e) {
    // The typed path stays in its field (wiz.typedPath), with the reason under it.
    const why = errorText(e);
    wiz!.locateError = `${why.charAt(0).toUpperCase()}${why.slice(1)}. Check the path and try again.`; wiz!.scriptsDir = null; wiz!.installed = null;
  }
  wiz!.busy = false; render();
  $<HTMLElement>(wiz!.locateError ? "#wiz-path" : "#wiz-primary")?.focus();
}

// ---------------------------------------------------------------- step 4: install scanner (folder transport)
function step4(): StepContent {
  const c = copy();
  const already = wiz!.installed?.version;
  const r = wiz!.installResult;
  if (r) {
    return {
      question: "The scanner is installed", help: "Here is what to run in game, and when.",
      body: [
        message({ tone: "ok", title: `Installed ${r.installed.length === 1 ? "1 script" : `${r.installed.length} scripts`}`, text: r.installed.join(", ") }),
        noteEl(installedIntoNote(r.scriptsDir)),
        noteEl(pathsFileNote(r.pathsFile)),
        box("div", { class: "wiz-press" }, txt("What to press in game", "label"), el("ul", { class: "wiz-press-list" }, ...whatToPress(r.installed))),
      ],
    };
  }
  const confirm = check({ label: "I typed -stopall in game and nothing is running", checked: wiz!.noRunningChecked, attrs: { id: "wiz-stopall" },
    onChange: (on) => { wiz!.noRunningChecked = on; render(); $<HTMLInputElement>("#wiz-stopall")?.focus(); } });
  return {
    question: c.installQuestion!, help: c.installHelp,
    body: [
      already ? message({ tone: "info", text: el("span", {}, `Scanner ${already} is already installed in `, el("span", { class: "mono" }, wiz!.scriptsDir || ""), ". Installing again updates it.") }) : null,
      wiz!.installError ? message({ tone: "bad", title: "Could not install", text: wiz!.installError }) : null,
      box("div", { class: "wiz-confirm" }, confirm.root),
    ],
  };
}
async function doInstall(): Promise<void> {
  wiz!.installError = null; wiz!.busy = true; render();
  try {
    const r = await api<InstallApiResponse>("/api/setup/install", { method: "POST", body: { adapter: wiz!.adapter, scriptsDir: wiz!.scriptsDir } });
    wiz!.installResult = r;
    // The server's own resolved folder, not the one this step sent: POST /api/setup/install turns a
    // picked client root into its nested scripts folder, and that is what it persisted as the client.
    state.settings = { ...state.settings!, client: { adapter: wiz!.adapter as string, scriptsDir: r.scriptsDir || (wiz!.scriptsDir as string) } };
    // The 409 "-stopall" text comes through verbatim; a folder that has gone missing since it was
    // located gets the one sentence that says what to do about it (messages.mts's clientFolderGone).
  } catch (e) { wiz!.installError = clientErrorMessage(e); }
  wiz!.busy = false; render();
  $<HTMLElement>("#wiz-primary")?.focus();
  void renderSettings();
}

// ---------------------------------------------------------------- steps 3/4, paste-transport branch
// Nothing to locate and nothing to install (docs/adapter-guide.md's "paste" transport). finish() is what
// persists settings.client for this branch; "Open Import" finishes and opens the Import drawer.
function pasteStep3(): StepContent {
  const c = copy();
  return { question: `Nothing to install for the ${c.short}`, help: c.pasteHelp, body: [] };
}
function pasteStep4(): StepContent {
  const c = copy();
  return {
    question: "Paste your first scan",
    help: `Run the scanner in the ${c.short}, copy everything it prints, then paste it into Import. Pack Rat shows what it read before anything is saved.`,
    body: [message({ tone: "info", text: "Import is in the sidebar, or press ⌘I anywhere in Pack Rat." })],
  };
}

// ---------------------------------------------------------------- footer: one primary per step
function footer(): HTMLElement {
  const step = wiz!.step;
  const paste = isPasteAdapter();
  // Nothing to go back to once the scanner is installed: Finish is the only way on.
  const back = step > 1 && !(step === 4 && wiz!.installResult) ? button({ label: "Back", size: "lg", disabled: wiz!.busy, onClick: () => go(step - 1) }) : null;
  let primary: HTMLButtonElement;
  let secondary: HTMLButtonElement | null = null;
  const cont = (disabled = false): HTMLButtonElement => button({ label: "Continue", variant: "primary", size: "lg", kbd: "↵", disabled: disabled || wiz!.busy, onClick: () => go(step + 1), attrs: { id: "wiz-primary" } });
  if (step === 1) primary = cont();
  else if (step === 2) primary = cont(!wiz!.adapter || !platformCompatible(currentAdapterInfo(), wiz!.setup.platform));
  else if (step === 3) primary = cont(!paste && !wiz!.scriptsDir);
  else if (paste) {
    secondary = button({ label: "Finish", size: "lg", onClick: () => void finish() });
    primary = button({ label: "Open Import", variant: "primary", size: "lg", kbd: "↵", onClick: () => void finish("#/import"), attrs: { id: "wiz-primary" } });
  } else if (wiz!.installResult) {
    primary = button({ label: "Finish", variant: "primary", size: "lg", kbd: "↵", onClick: () => void finish(), attrs: { id: "wiz-primary" } });
  } else {
    // The install is this step's one primary; Finish appears only once it succeeds.
    primary = button({ label: wiz!.busy ? "Installing…" : wiz!.installed?.version ? "Reinstall scanner" : "Install scanner", variant: "primary", size: "lg", kbd: "↵",
      disabled: !wiz!.noRunningChecked || wiz!.busy, onClick: () => void doInstall(), attrs: { id: "wiz-primary" } });
  }
  return box("footer", { class: "overlay-foot wiz-foot" },
    button({ label: "Set up later", variant: "ghost", onClick: () => void later(), attrs: { id: "wiz-later" } }),
    txt("Settings keeps a reminder", "t-sm muted"),
    el("span", { class: "spacer" }), back, secondary, primary);
}

// ↵ runs the step's primary, unless focus is on a control that has its own Enter (a button, a link; the path
// field handles its own).
$<HTMLDialogElement>("#wizard")?.addEventListener("keydown", (e) => {
  if (e.key !== "Enter" || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
  const t = e.target as HTMLElement;
  if (t.closest("button, a, textarea")) return;
  const primary = $<HTMLButtonElement>("#wiz-primary");
  if (primary && !primary.disabled) { e.preventDefault(); primary.click(); }
});

// ---------------------------------------------------------------- close
async function persistSetupDone(): Promise<void> {
  try {
    const r = await api<SettingsApiResponse>("/api/settings", { method: "PUT", body: { setupDone: true } });
    state.settings = r.settings;
  } catch (e) { showToast(errorText(e), "bad"); }
  // The Inventory's row actions and the peek read the client from state.setup, which renderSettings
  // refreshes; they redraw on "bridgechange" (bridge.mts), so the client set up here reaches them at once.
  void renderSettings().then(() => document.dispatchEvent(new Event("bridgechange")));
}
function closeAs(kind: string): void {
  const dialog = $<HTMLDialogElement>("#wizard")!;
  dialog.returnValue = kind;
  dialog.close();
}
// "Set up later": nothing is committed (not even the client radio that happened to be selected); Settings
// shows "Run setup" and a warning dot on Game client until a client is set up.
async function later(): Promise<void> { await persistSetupDone(); closeAs("done"); }
// finish() is the one path that persists a paste-transport pick: a folder-transport client already got
// settings.client written by doInstall()'s own POST /api/setup/install, but a paste-transport client never
// calls that route (there's nothing to install), so finish() writes settings.client here instead.
async function finish(then?: string): Promise<void> {
  if (isPasteAdapter() && wiz!.adapter) {
    try {
      const r = await api<SettingsApiResponse>("/api/settings", { method: "PUT", body: { client: { adapter: wiz!.adapter, scriptsDir: "" } } });
      state.settings = r.settings;
      // PUT /api/settings validates client.scriptsDir before persisting it and answers 400 naming the
      // field when the folder is no longer one it will read — clientErrorMessage turns that into a
      // sentence with a next step in it (messages.mts).
    } catch (e) { showToast(clientErrorMessage(e), "bad"); }
  }
  await persistSetupDone();
  closeAs("done");
  if (then) location.hash = then;
  // Same path the Settings picker uses (ui/shard.mts): PUT then reload the whole page, so the new
  // shard's rules apply everywhere at once (Phase 4 final review, Important 3).
  if (wiz!.shard !== state.settings?.shard) await changeShard(wiz!.shard);
}

// Esc fires the dialog's native "cancel" then "close" with no returnValue set — treat that exactly
// like Set up later (setupDone: true) so leaving the wizard by any path never leaves it reopening itself.
$<HTMLDialogElement>("#wizard")?.addEventListener("close", () => {
  const dialog = $<HTMLDialogElement>("#wizard")!;
  if (dialog.returnValue !== "done") void persistSetupDone();
});
