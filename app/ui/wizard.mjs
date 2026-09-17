// ui/wizard.mjs — the first-run / "Run setup again" wizard: shard → client → locate → install.
// Task 3, Phase 4. A <dialog id="wizard"> (index.html ships it empty) that this module fills and
// drives with showModal()/close(); every step is reachable AND skippable, and every close path
// (Finish, Skip, or Esc) marks setup done so the wizard never traps the user or re-opens itself.
import { state } from "./store.mjs";
import { $, el, toast } from "./dom.mjs";
import { api } from "./api.mjs";
import { renderSettings } from "./settings.mjs";
import { changeShard } from "./shard.mjs";

// The shard's AFK rule, shown verbatim on step 1 only for shards that need it (uoalive today).
const AFK_NOTICE = "UO Alive allows AFK skill training, but bans unattended resource, combat and loot gathering. Pack Rat's scripts are attended tools: they read what you can see and move an item only when you click.";

// Copied verbatim from adapters/tazuo/README.md's "What to press" list (Task 3 brief — no fetch,
// no re-derivation; if the README's wording changes, update this constant to match by hand).
const WHAT_TO_PRESS = [
  "After a gearing or skill-training session on a character: run `packrat-refresh.py`.",
  "The first time you scan a character, or whenever chests/bags move or get restocked: stand near the cluster and run `packrat-scanner.py`; repeat at each cluster.",
  "Whenever you want to use the app's Highlight/Grab/Go to buttons: start `packrat-bridge.py` and leave it running.",
];

const STEP_TITLES = { 1: "Shard", 2: "Client", 3: "Locate your client folder", 4: "Install" };

// WHAT_TO_PRESS's strings stay the verbatim copy (backticks included, matching the README's own
// Markdown); this splits each on its backtick pairs and renders the wrapped script name as a real
// <code> element via el() (text nodes only, no innerHTML) instead of showing the backtick
// characters literally.
function withCode(text) {
  return text.split("`").map((part, i) => (i % 2 === 1 ? el("code", {}, part) : part));
}

let wiz = null;   // this wizard "session"'s working state — rebuilt fresh every openWizard() call

export async function openWizard({ firstRun = false } = {}) {
  const dialog = $("#wizard");
  if (!dialog) return;
  let setup;
  try { setup = await api("/api/setup"); }
  catch (e) { toast(`Could not load setup info: ${e.message}`, "bad"); return; }
  state.setup = setup;
  const client = setup.settings.client;
  wiz = {
    firstRun, setup, step: 1,
    shard: setup.settings.shard || state.settings?.shard || state.availableShards?.[0]?.id || "",
    adapter: client?.adapter || setup.adapters[0]?.id || null,
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

function render() {
  const dialog = $("#wizard");
  if (!dialog || !wiz) return;
  dialog.replaceChildren(
    el("div", { class: "wizard-head" },
      el("h2", {}, `Step ${wiz.step} of 4 · ${STEP_TITLES[wiz.step]}`),
      el("span", { class: "small muted" }, wiz.firstRun ? "First-run setup" : "Setup")),
    el("div", { class: "wizard-body" }, stepBody()),
    footer());
}

function stepBody() {
  if (wiz.step === 1) return step1();
  if (wiz.step === 2) return step2();
  if (wiz.step === 3) return step3();
  return step4();
}

// ---------------------------------------------------------------- step 1: shard
function step1() {
  const sel = el("select", {}, ...state.availableShards.map((r) => el("option", { value: r.id, selected: r.id === wiz.shard ? "" : null }, r.name)));
  sel.onchange = async () => {
    const shard = sel.value;
    // Same path the header picker uses (ui/shard.mjs): PUT then reload the whole page, so the new
    // shard's rules (caps, rarity, tag units, pools) apply everywhere at once. The old code here only
    // synced the header <select>'s displayed value and re-rendered the wizard itself, leaving
    // state.rules (and the inventory folded under it) on the previous shard until a manual reload —
    // Phase 4 final review, Important 3.
    const ok = await changeShard(shard);
    if (!ok) { sel.value = wiz.shard; render(); return; }
    wiz.shard = shard;
    // changeShard() already triggered location.reload() on success — nothing left to do here.
  };
  for (const o of sel.querySelectorAll("option[selected='null']")) o.removeAttribute("selected");
  return el("div", { class: "stack" },
    el("div", { class: "field" }, el("label", {}, "Which shard's rules?"), sel),
    wiz.shard === "uoalive" ? el("div", { class: "msg" }, AFK_NOTICE) : null);
}

// ---------------------------------------------------------------- step 2: client
function step2() {
  if (!wiz.setup.adapters.length) return el("div", { class: "msg bad" }, "No client adapters are available in this build.");
  return el("div", { class: "stack" }, ...wiz.setup.adapters.map((a) => {
    const radio = el("input", { type: "radio", name: "wiz-adapter", onchange: () => { wiz.adapter = a.id; wiz.scriptsDir = null; wiz.locateError = null; wiz.installed = null; render(); } });
    radio.checked = a.id === wiz.adapter;
    return el("label", { class: "row" }, radio, el("div", {}, el("div", {}, a.name), a.summary ? el("div", { class: "small muted" }, a.summary) : null));
  }));
}

// ---------------------------------------------------------------- step 3: locate
function step3() {
  const candidates = wiz.setup.candidates[wiz.adapter] || [];
  const radios = candidates.map((dir) => {
    const radio = el("input", { type: "radio", name: "wiz-dir", onchange: () => locate(dir) });
    radio.checked = dir === wiz.scriptsDir;
    return el("label", { class: "row" }, radio, el("span", { class: "small" }, dir));
  });
  return el("div", { class: "stack" },
    candidates.length ? el("div", { class: "stack" }, ...radios) : el("div", { class: "small muted" }, "No likely folder found automatically."),
    pickFolderRow({ title: "Choose your TazUO client's LegionScripts folder", buttonLabel: "Choose a folder…", onResolved: locate }),
    wiz.locateError ? el("div", { class: "msg bad" }, wiz.locateError) : null,
    wiz.scriptsDir && !wiz.locateError ? el("div", { class: "msg" },
      `Resolved to: ${wiz.scriptsDir}`,
      wiz.installed?.version ? ` — already has version ${wiz.installed.version} installed.` : " — nothing installed there yet.") : null);
}
async function locate(dir) {
  try {
    const r = await api("/api/setup/locate", { method: "POST", body: { adapter: wiz.adapter, dir } });
    wiz.scriptsDir = r.scriptsDir; wiz.installed = r.installed; wiz.locateError = null;
  } catch (e) { wiz.locateError = e.message; wiz.scriptsDir = null; wiz.installed = null; }
  render();
}

// ---------------------------------------------------------------- step 4: install
function step4() {
  const already = wiz.installed?.version || wiz.installResult?.version;
  const installedNames = wiz.installResult?.installed;
  const checkbox = el("input", { type: "checkbox", onchange: (e) => { wiz.noRunningChecked = e.target.checked; render(); } });
  checkbox.checked = wiz.noRunningChecked;
  const installBtn = el("button", { class: "primary", onclick: doInstall }, already ? "Reinstall scripts" : "Install scripts");
  installBtn.disabled = !wiz.noRunningChecked;
  return el("div", { class: "stack" },
    already && !wiz.installResult ? el("div", { class: "msg" }, `Version ${already} is already installed in ${wiz.scriptsDir}.`) : null,
    el("label", { class: "row" }, checkbox, "No scripts are running in the client"),
    installBtn,
    wiz.installError ? el("div", { class: "msg bad" }, wiz.installError) : null,
    installedNames ? el("div", { class: "stack" },
      el("div", { class: "msg" }, `Installed: ${installedNames.join(", ")}`),
      el("div", { class: "small" }, "What to press in game:"),
      el("ul", { class: "small" }, ...WHAT_TO_PRESS.map((t) => el("li", {}, ...withCode(t))))) : null,
    el("div", { class: "wizard-divider" }),
    el("div", { class: "small muted" }, "Already have scan files? Import a folder"),
    pickFolderRow({ title: "Choose a folder of scan files to import", buttonLabel: "Choose a folder…", onResolved: doImport }),
    wiz.importMsg ? el("div", { class: "small" }, wiz.importMsg) : null);
}
async function doInstall() {
  wiz.installError = null;
  try {
    const r = await api("/api/setup/install", { method: "POST", body: { adapter: wiz.adapter, scriptsDir: wiz.scriptsDir } });
    wiz.installResult = r;
    state.settings = { ...state.settings, client: { adapter: wiz.adapter, scriptsDir: wiz.scriptsDir } };
  } catch (e) { wiz.installError = e.message; }   // includes the 409 "-stopall" text verbatim
  render();
  renderSettings();
}
async function doImport(dir) {
  wiz.importBusy = true; render();
  try {
    const r = await api("/api/import", { method: "POST", body: { dir } });
    wiz.importMsg = `copied ${r.copied}${r.skipped ? ` (skipped ${r.skipped} already present)` : ""}`;
  } catch (e) { wiz.importMsg = e.message; }
  wiz.importBusy = false; render();
}

// ---------------------------------------------------------------- shared: "Choose a folder…" with a
// text-input fallback when POST /api/host/pick-folder answers 501 (no desktop shell attached).
export function pickFolderRow({ title, buttonLabel = "Choose a folder…", onResolved }) {
  const wrap = el("div", { class: "row" });
  const pick = async () => {
    try {
      const r = await api("/api/host/pick-folder", { method: "POST", body: { title } });
      if (r.path) onResolved(r.path);
    } catch (e) {
      if (e.status === 501) wrap.replaceChildren(...fallback());
      else toast(e.message, "bad");
    }
  };
  function fallback() {
    const input = el("input", { type: "text", placeholder: "folder path", style: "flex:1" });
    const go = () => { const v = input.value.trim(); if (v) onResolved(v); };
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
    return [input, el("button", { onclick: go }, "Use this path")];
  }
  wrap.append(el("button", { onclick: pick }, buttonLabel));
  return wrap;
}

// ---------------------------------------------------------------- footer / navigation / close
function footer() {
  const backBtn = el("button", { onclick: () => { wiz.step--; render(); } }, "Back");
  backBtn.disabled = wiz.step === 1;
  const nextBtn = el("button", { class: "primary", onclick: () => { wiz.step++; render(); } }, "Next");
  nextBtn.disabled = wiz.step === 3 && !wiz.scriptsDir;
  const isLast = wiz.step === 4;
  return el("div", { class: "row wizard-foot" },
    backBtn,
    el("span", { class: "grow" }),
    el("button", { onclick: skip }, "Skip"),
    isLast ? el("button", { class: "primary", onclick: finish }, "Finish") : nextBtn);
}
async function persistSetupDone() {
  try {
    const r = await api("/api/settings", { method: "PUT", body: { setupDone: true } });
    state.settings = r.settings;
  } catch (e) { toast(e.message, "bad"); }
  renderSettings();
}
function closeAs(kind) {
  const dialog = $("#wizard");
  dialog.returnValue = kind;
  dialog.close();
}
async function skip() { await persistSetupDone(); closeAs("done"); }
async function finish() { await persistSetupDone(); closeAs("done"); }

// Esc fires the dialog's native "cancel" then "close" with no returnValue set — treat that exactly
// like Skip (setupDone: true) so leaving the wizard by any path never leaves it re-opening itself.
$("#wizard")?.addEventListener("close", () => {
  const dialog = $("#wizard");
  if (dialog.returnValue !== "done") persistSetupDone();
});
