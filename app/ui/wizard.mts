// ui/wizard.mts — the first-run / "Run setup again" wizard: shard → client → locate → install, for a
// folder-transport client (see docs/adapter-guide.md) — or shard → client → (nothing to locate) →
// (nothing to install, go paste in the Import tab) for a paste-transport one, like the ClassicUO web
// client. Task 3, Phase 4; Task 5, Phase 6 added the branch. A <dialog id="wizard"> (index.html ships
// it empty) that this module fills and drives with showModal()/close(); every step is reachable AND
// skippable, and every close path (Finish, Skip, or Esc) marks setup done so the wizard never traps
// the user or re-opens itself.
import { state } from "./store.mts";
import { $, el, noteEl, toast } from "./dom.mts";
import type { ElAttrs } from "./dom.mts";
import { api } from "./api.mts";
import { clientErrorMessage, hostErrorMessage, importOutcome, installedIntoNote, pathsFileNote } from "./messages.mts";
import { renderSettings } from "./settings.mts";
import { changeShard } from "./shard.mts";
import { defaultAdapterId, availableAdapters, platformCompatible } from "./adapters.mts";
export { defaultAdapterId, availableAdapters, platformCompatible };
import type { SetupApiResponse, AdapterSummary, InstalledVersionInfo, LocateApiResponse, InstallApiResponse, ImportApiResponse, HostPickFolderApiResponse, ApiError, SettingsApiResponse } from "./api-types.mts";

// The shard's AFK rule, shown verbatim on step 1 only for shards that need it (uoalive today).
const AFK_NOTICE = "UO Alive allows AFK skill training, but bans unattended resource, combat and loot gathering. Pack Rat's scripts are attended tools: they read what you can see and move an item only when you click.";

// "What to press in game" is built from the script NAMES the install just reported, not copied from
// one adapter's README — adapters/tazuo/ ships packrat-refresh.py and adapters/razor-enhanced/
// doesn't, so a fixed TazUO-shaped list would be wrong (or incomplete) for any other folder-transport
// adapter. Every adapter that ships a script matching one of these three follows the same
// packrat-scanner.py / packrat-refresh.py / packrat-bridge.py naming convention (docs/adapter-guide.md);
// a script whose name matches none of them is a future kind of script this list doesn't know how to
// describe yet, so it's simply left out rather than guessed at.
function whatToPressLines(installedNames: string[]): string[] {
  const has = (key: string): string | undefined => installedNames.find((n) => n.includes(key));
  const lines: string[] = [];
  const refresh = has("refresh");
  if (refresh) lines.push(`After a gearing or skill-training session on a character: run \`${refresh}\`.`);
  const scanner = has("scanner");
  if (scanner) lines.push(`The first time you scan a character, or whenever chests/bags move or get restocked: stand near the cluster and run \`${scanner}\`; repeat at each cluster.`);
  const bridge = has("bridge");
  if (bridge) lines.push(`Whenever you want to use the app's Highlight/Grab/Go to buttons: start \`${bridge}\` and leave it running.`);
  return lines;
}

const STEP_TITLES: Record<number, string> = { 1: "Shard", 2: "Client" };
// Steps 3 and 4 read differently for a paste-transport client (nothing to locate, nothing to install)
// than a folder-transport one — see isPasteAdapter() below.
function stepTitle(step: number): string | undefined {
  if (step === 3) return isPasteAdapter() ? "Nothing to install" : "Locate your client folder";
  if (step === 4) return isPasteAdapter() ? "Import your scans" : "Install";
  return STEP_TITLES[step];
}

// whatToPressLines()'s strings carry Markdown-style backticks around each script name; this splits
// each on its backtick pairs and renders the wrapped part as a real <code> element via el() (text
// nodes only, no innerHTML) instead of showing the backtick characters literally.
function withCode(text: string): Array<string | HTMLElement> {
  return text.split("`").map((part, i) => (i % 2 === 1 ? el("code", {}, part) : part));
}

// This wizard "session"'s working state — rebuilt fresh every openWizard() call.
interface WizState {
  firstRun: boolean;
  setup: SetupApiResponse;
  step: number;
  shard: string;
  adapter: string | null;
  scriptsDir: string | null;
  locateError: string | null;
  installed: InstalledVersionInfo | null;
  noRunningChecked: boolean;
  installResult: InstallApiResponse | null;
  installError: string | null;
  importBusy: boolean;
  importMsg: string | null;
}
let wiz: WizState | null = null;

export async function openWizard({ firstRun = false }: { firstRun?: boolean } = {}): Promise<void> {
  const dialog = $<HTMLDialogElement>("#wizard");
  if (!dialog) return;
  let setup: SetupApiResponse;
  try { setup = await api<SetupApiResponse>("/api/setup"); }
  catch (e) { toast(`Could not load setup info: ${(e as Error).message}`, "bad"); return; }
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
    locateError: null,
    installed: client ? setup.installed : null,   // {version, files} for the already-configured client, if any
    noRunningChecked: false,
    installResult: null, installError: null,
    importBusy: false, importMsg: null,
  };
  // Reset from any previous session: returnValue sticks across showModal() calls, and the "close"
  // listener below only skips persistSetupDone() when it reads exactly "done" — without this, a
  // second open (e.g. "Run setup again") that ends in Esc would silently inherit the last session's
  // "done" and skip the close-as-Skip persist (harmless here since it's a no-op re-PUT, but wrong).
  dialog.returnValue = "";
  render();
  if (!dialog.open) dialog.showModal();
}

// The adapter object (listAdapters' shape: {id, name, scripts, capabilities, transport, summary})
// currently selected in the wizard — looked up fresh each call rather than cached on wiz, since the
// radio in step2() is the only thing that ever changes wiz.adapter and always re-renders right after.
function currentAdapterInfo(): AdapterSummary | null {
  return wiz!.setup.adapters.find((a) => a.id === wiz!.adapter) || null;
}
// A paste-transport client (docs/adapter-guide.md — the ClassicUO web client today) has no folder to
// locate and no scripts to install: steps 3 and 4 branch on this instead of naming the adapter.
function isPasteAdapter(): boolean {
  return currentAdapterInfo()?.transport === "paste";
}

function render(): void {
  const dialog = $<HTMLDialogElement>("#wizard");
  if (!dialog || !wiz) return;
  dialog.replaceChildren(
    el("div", { class: "wizard-head" },
      el("h2", {}, `Step ${wiz.step} of 4 · ${stepTitle(wiz.step)}`),
      el("span", { class: "small muted" }, wiz.firstRun ? "First-run setup" : "Setup")),
    el("div", { class: "wizard-body" }, stepBody()),
    footer());
}

function stepBody(): HTMLDivElement {
  if (wiz!.step === 1) return step1();
  if (wiz!.step === 2) return step2();
  if (isPasteAdapter()) return wiz!.step === 3 ? pasteStep3() : pasteStep4();
  if (wiz!.step === 3) return step3();
  return step4();
}

// ---------------------------------------------------------------- step 1: shard
function step1(): HTMLDivElement {
  const sel = el("select", {}, ...state.availableShards.map((r) => el("option", { value: r.id, selected: r.id === wiz!.shard ? "" : null }, r.name)));
  sel.onchange = async () => {
    const shard = sel.value;
    // Same path the header picker uses (ui/shard.mts): PUT then reload the whole page, so the new
    // shard's rules (caps, rarity, tag units, pools) apply everywhere at once. The old code here only
    // synced the header <select>'s displayed value and re-rendered the wizard itself, leaving
    // state.rules (and the inventory folded under it) on the previous shard until a manual reload —
    // Phase 4 final review, Important 3.
    const ok = await changeShard(shard);
    if (!ok) { sel.value = wiz!.shard; render(); return; }
    wiz!.shard = shard;
    // changeShard() already triggered location.reload() on success — nothing left to do here.
  };
  for (const o of sel.querySelectorAll("option[selected='null']")) o.removeAttribute("selected");
  return el("div", { class: "stack" },
    el("div", { class: "field" }, el("label", {}, "Which shard's rules?"), sel),
    wiz!.shard === "uoalive" ? el("div", { class: "msg" }, AFK_NOTICE) : null);
}

// ---------------------------------------------------------------- step 2: client
// Every adapter is offered here regardless of transport — a paste-transport client still needs to be
// named so the player identifies their own client and steps 3/4 branch correctly; it just carries an
// extra line saying what picking it means, since there's nothing to install for it (no adapter name
// is ever hard-coded here for the transport branch — that's entirely a.transport, read off
// capabilities.json). A platform-incompatible adapter (Razor Enhanced, Windows-only, on any other
// platform — a.platform from capabilities.json, never a hard-coded id here either, see
// platformCompatible) is still SHOWN, so a player who's heard of it doesn't wonder why it's missing,
// but its radio is disabled and it carries a plain "Windows only" note instead of being selectable —
// the wizard never lets a player pick a client that cannot run on this machine (Phase 6 final
// review). The initial/default selection (openWizard, above) is drawn from availableAdapters, so the
// wizard never silently lands on one either, even though it's visible here.
function step2(): HTMLDivElement {
  const adapters = wiz!.setup.adapters || [];
  if (!adapters.length) return el("div", { class: "msg bad" }, "No client adapters are available in this build.");
  return el("div", { class: "stack" }, ...adapters.map((a) => {
    const compatible = platformCompatible(a, wiz!.setup.platform);
    // el()'s generic branch does `setAttribute(k, v)` with no null handling — passing `disabled:
    // null`/`title: null` would set the literal string "null" (a boolean attribute is present, and
    // thus true, regardless of its value), backwards from "not disabled" here. Build the attrs
    // objects conditionally instead, same fix shape as step1()'s shard <select> uses for `selected`.
    const radioAttrs: ElAttrs = { type: "radio", name: "wiz-adapter", onchange: () => { wiz!.adapter = a.id; wiz!.scriptsDir = null; wiz!.locateError = null; wiz!.installed = null; render(); } };
    if (!compatible) radioAttrs.disabled = "";
    const radio = el("input", radioAttrs);
    radio.checked = a.id === wiz!.adapter;
    const labelAttrs: ElAttrs = { class: "row" };
    if (!compatible) labelAttrs.title = `${a.name} only runs on ${a.platform} — not available on this machine`;
    return el("label", labelAttrs, radio, el("div", {},
      el("div", {}, a.name),
      a.summary ? el("div", { class: "small muted" }, a.summary) : null,
      !compatible ? el("div", { class: "small muted" }, `${a.platform} only — not available on this machine`) : null,
      compatible && a.transport === "paste" ? el("div", { class: "small muted" }, "No files to install — you'll paste what its scanner prints into Import.") : null));
  }));
}

// ---------------------------------------------------------------- step 3: locate (folder-transport only)
function step3(): HTMLDivElement {
  const candidates = wiz!.setup.candidates[wiz!.adapter as string] || [];
  const radios = candidates.map((dir) => {
    const radio = el("input", { type: "radio", name: "wiz-dir", onchange: () => locate(dir) });
    radio.checked = dir === wiz!.scriptsDir;
    return el("label", { class: "row" }, radio, el("span", { class: "small" }, dir));
  });
  const clientName = currentAdapterInfo()?.name || "client";
  return el("div", { class: "stack" },
    candidates.length ? el("div", { class: "stack" }, ...radios) : el("div", { class: "small muted" }, "No likely folder found automatically."),
    pickFolderRow({ title: `Choose your ${clientName}'s scripts folder`, buttonLabel: "Choose a folder…", onResolved: locate }),
    wiz!.locateError ? el("div", { class: "msg bad" }, wiz!.locateError) : null,
    wiz!.scriptsDir && !wiz!.locateError ? el("div", { class: "msg" },
      `Resolved to: ${wiz!.scriptsDir}` + (wiz!.installed?.version ? ` — already has version ${wiz!.installed.version} installed.` : " — nothing installed there yet.")) : null);
}
async function locate(dir: string): Promise<void> {
  try {
    const r = await api<LocateApiResponse>("/api/setup/locate", { method: "POST", body: { adapter: wiz!.adapter, dir } });
    wiz!.scriptsDir = r.scriptsDir; wiz!.installed = r.installed; wiz!.locateError = null;
  } catch (e) { wiz!.locateError = (e as Error).message; wiz!.scriptsDir = null; wiz!.installed = null; }
  render();
}

// ---------------------------------------------------------------- steps 3/4, paste-transport branch
// Nothing to locate and nothing to install (docs/adapter-guide.md's "paste" transport) — sent straight
// to the Import tab instead. finish() is what actually persists settings.client for this branch (see
// below); "Go to Import" both finishes and navigates in one click, but the ordinary Finish button
// in the footer works too, just without the navigation.
function pasteStep3(): HTMLDivElement {
  const clientName = currentAdapterInfo()?.name || "This client";
  return el("div", { class: "stack" },
    el("div", { class: "msg" }, `${clientName} can't write files to disk, so there's no folder to locate or install scripts into.`));
}
function pasteStep4(): HTMLDivElement {
  const clientName = currentAdapterInfo()?.name || "This client";
  return el("div", { class: "stack" },
    el("div", { class: "msg" }, `Run ${clientName}'s scanner, copy what it prints, and paste it into Import — the app validates and folds it in exactly like a scan a folder-based client dropped into its inbox.`),
    el("button", { class: "primary", onclick: goToImport }, "Go to Import"));
}
async function goToImport(): Promise<void> {
  await finish();
  location.hash = "#/import";
}

// ---------------------------------------------------------------- step 4: install
function step4(): HTMLDivElement {
  const already = wiz!.installed?.version || wiz!.installResult?.version;
  const installedNames = wiz!.installResult?.installed;
  const checkbox = el("input", { type: "checkbox", onchange: (e) => { wiz!.noRunningChecked = e.target.checked; render(); } });
  checkbox.checked = wiz!.noRunningChecked;
  const installBtn = el("button", { class: "primary", onclick: doInstall }, already ? "Reinstall scripts" : "Install scripts");
  installBtn.disabled = !wiz!.noRunningChecked;
  return el("div", { class: "stack" },
    already && !wiz!.installResult ? el("div", { class: "msg" }, `Version ${already} is already installed in ${wiz!.scriptsDir}.`) : null,
    el("label", { class: "row" }, checkbox, "No scripts are running in the client"),
    installBtn,
    wiz!.installError ? el("div", { class: "msg bad" }, wiz!.installError) : null,
    installedNames ? el("div", { class: "stack" },
      el("div", { class: "msg" }, `Installed: ${installedNames.join(", ")}`),
      // The folder the server RESOLVED (what was picked and what was written to differ whenever a
      // client root was picked), and what became of packrat-paths.json — see messages.mts.
      noteEl(installedIntoNote(wiz!.installResult?.scriptsDir)),
      noteEl(pathsFileNote(wiz!.installResult?.pathsFile)),
      el("div", { class: "small" }, "What to press in game:"),
      el("ul", { class: "small" }, ...whatToPressLines(installedNames).map((t) => el("li", {}, ...withCode(t))))) : null,
    el("div", { class: "wizard-divider" }),
    el("div", { class: "small muted" }, "Already have scan files? Import a folder"),
    pickFolderRow({ title: "Choose a folder of scan files to import", buttonLabel: "Choose a folder…", onResolved: doImport }),
    wiz!.importMsg ? el("div", { class: "small" }, wiz!.importMsg) : null);
}
async function doInstall(): Promise<void> {
  wiz!.installError = null;
  try {
    const r = await api<InstallApiResponse>("/api/setup/install", { method: "POST", body: { adapter: wiz!.adapter, scriptsDir: wiz!.scriptsDir } });
    wiz!.installResult = r;
    // The server's own resolved folder, not the one this step sent: POST /api/setup/install turns a
    // picked client root into its nested scripts folder, and that is what it persisted as the client.
    state.settings = { ...state.settings!, client: { adapter: wiz!.adapter as string, scriptsDir: r.scriptsDir || (wiz!.scriptsDir as string) } };
    // The 409 "-stopall" text comes through verbatim; a folder that has gone missing since it was
    // located gets the one sentence that says what to do about it (messages.mts's clientFolderGone).
  } catch (e) { wiz!.installError = clientErrorMessage(e); }
  render();
  renderSettings();
}
async function doImport(dir: string): Promise<void> {
  wiz!.importBusy = true; render();
  try {
    // adapter: wiz.adapter (post-review fix) — this used to omit it and rely on the server's "tazuo"
    // default, which silently imported into the wrong adapter's inbox for anyone setting up
    // razor-enhanced here.
    const r = await api<ImportApiResponse>("/api/import", { method: "POST", body: { dir, adapter: wiz!.adapter } });
    // One sentence, shared with the Import tab (messages.mts) — this step used to word it for itself
    // and, like that one, said nothing at all about the files the import could not take.
    wiz!.importMsg = importOutcome(r);
  } catch (e) { wiz!.importMsg = (e as Error).message; }
  wiz!.importBusy = false; render();
}

// ---------------------------------------------------------------- shared: "Choose a folder…" with a
// text-input fallback when POST /api/host/pick-folder answers 501 (no desktop shell attached).
export function pickFolderRow({ title, buttonLabel = "Choose a folder…", onResolved }: { title: string; buttonLabel?: string; onResolved: (path: string) => void | Promise<void> }): HTMLDivElement {
  const wrap = el("div", { class: "row" });
  const pick = async (): Promise<void> => {
    try {
      const r = await api<HostPickFolderApiResponse>("/api/host/pick-folder", { method: "POST", body: { title } });
      if (r.path) onResolved(r.path);
    } catch (e) {
      if ((e as ApiError).status === 501) wrap.replaceChildren(...fallback());
      // 504: the shell never answered the picker (app/vault-server.mts's withHostTimeout). The
      // typed-path fallback is still there, so say what happened rather than leaving a dead button.
      else toast(hostErrorMessage(e, "Could not open the folder picker"), "bad");
    }
  };
  function fallback(): [HTMLInputElement, HTMLButtonElement] {
    const input = el("input", { type: "text", placeholder: "folder path", style: "flex:1" });
    const go = (): void => { const v = input.value.trim(); if (v) onResolved(v); };
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
    return [input, el("button", { onclick: go }, "Use this path")];
  }
  wrap.append(el("button", { onclick: pick }, buttonLabel));
  return wrap;
}

// ---------------------------------------------------------------- footer / navigation / close
function footer(): HTMLDivElement {
  const backBtn = el("button", { onclick: () => { wiz!.step--; render(); } }, "Back");
  backBtn.disabled = wiz!.step === 1;
  const nextBtn = el("button", { class: "primary", onclick: () => { wiz!.step++; render(); } }, "Next");
  // Step 3 only gates on a resolved scriptsDir for a folder-transport client — a paste-transport one
  // has nothing to locate, so pasteStep3() never sets wiz.scriptsDir and must not be stuck here.
  nextBtn.disabled = wiz!.step === 3 && !isPasteAdapter() && !wiz!.scriptsDir;
  const isLast = wiz!.step === 4;
  return el("div", { class: "row wizard-foot" },
    backBtn,
    el("span", { class: "grow" }),
    el("button", { onclick: skip }, "Skip"),
    isLast ? el("button", { class: "primary", onclick: finish }, "Finish") : nextBtn);
}
async function persistSetupDone(): Promise<void> {
  try {
    const r = await api<SettingsApiResponse>("/api/settings", { method: "PUT", body: { setupDone: true } });
    state.settings = r.settings;
  } catch (e) { toast((e as Error).message, "bad"); }
  renderSettings();
}
function closeAs(kind: string): void {
  const dialog = $<HTMLDialogElement>("#wizard")!;
  dialog.returnValue = kind;
  dialog.close();
}
async function skip(): Promise<void> { await persistSetupDone(); closeAs("done"); }
// finish() is the one path that persists a paste-transport pick: a folder-transport client already got
// settings.client written by doInstall()'s own POST /api/setup/install, but a paste-transport client
// never calls that route (there's nothing to install), so finish() writes settings.client here instead
// — reached both by the footer's own Finish button and by pasteStep4()'s "Go to Import" (which
// calls finish() then navigates). Skip deliberately does NOT do this: skipping means "I didn't finish
// setup," not "commit whatever radio happened to be selected."
async function finish(): Promise<void> {
  if (isPasteAdapter() && wiz!.adapter) {
    try {
      const r = await api<SettingsApiResponse>("/api/settings", { method: "PUT", body: { client: { adapter: wiz!.adapter, scriptsDir: "" } } });
      state.settings = r.settings;
      // PUT /api/settings validates client.scriptsDir before persisting it and answers 400 naming the
      // field when the folder is no longer one it will read — clientErrorMessage is what turns that
      // into a sentence with a next step in it (messages.mts).
    } catch (e) { toast(clientErrorMessage(e), "bad"); }
  }
  await persistSetupDone();
  closeAs("done");
}

// Esc fires the dialog's native "cancel" then "close" with no returnValue set — treat that exactly
// like Skip (setupDone: true) so leaving the wizard by any path never leaves it re-opening itself.
$<HTMLDialogElement>("#wizard")?.addEventListener("close", () => {
  const dialog = $<HTMLDialogElement>("#wizard")!;
  if (dialog.returnValue !== "done") persistSetupDone();
});
