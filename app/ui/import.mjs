// ui/import.mjs — the Import tab (Task 1, Phase 6): paste a scan, import a folder of scan files, and
// rescan the inbox. The paste box exists for a client whose sandbox can't write files at all (the
// ClassicUO web client — its scanner prints a marked block the player copies here instead); the
// folder import reuses the same host-folder-picker/typed-path row the wizard and Settings already
// use; rescan is the escape hatch for a player whose folder watcher missed a drop. All three land a
// file in an adapter's inbox and nudge the watcher server-side — the inventory refresh itself rides
// the existing SSE "inventory" event -> ui/events.mjs's reload(), not a call made from here.
import { state } from "./store.mjs";
import { $, el } from "./dom.mjs";
import { api } from "./api.mjs";
import { pickFolderRow } from "./wizard.mjs";

// This tab's own working state — text box contents, the picked adapter (once there's more than one
// to choose from), busy flag, and the last result line. Survives switching away and back (the section
// is only hidden, not unmounted) but not a full page reload, same as the wizard's `wiz` and the
// builder's in-memory state elsewhere in this app.
const imp = { text: "", adapter: null, busy: false, result: null };

function adapterId() {
  return imp.adapter || state.settings?.client?.adapter || state.setup?.adapters?.[0]?.id || null;
}

// Only shown once a second adapter actually exists (today: just tazuo) — no point asking a player to
// pick from a list of one.
function adapterPicker() {
  const adapters = state.setup?.adapters || [];
  if (adapters.length <= 1) return null;
  const current = adapterId();
  const sel = el("select", { onchange: (e) => { imp.adapter = e.target.value; } },
    ...adapters.map((a) => el("option", { value: a.id, selected: a.id === current ? "" : null }, a.name)));
  for (const o of sel.querySelectorAll("option[selected='null']")) o.removeAttribute("selected");
  return el("div", { class: "field" }, el("label", {}, "Adapter"), sel);
}

export function renderImport() {
  const root = $("#import-body");
  if (!root || !state.setup) return;   // load() fetches GET /api/setup before this is ever called

  const textarea = el("textarea", { rows: 10, placeholder: "Paste what the client's scanner printed — the whole block, markers included, or just the scan JSON on its own." });
  textarea.value = imp.text;
  textarea.oninput = (e) => { imp.text = e.target.value; };
  const pasteBtn = el("button", { class: "primary", onclick: doPaste }, "Paste scan");
  pasteBtn.disabled = imp.busy;

  const rescanBtn = el("button", { onclick: doRescan }, "Rescan inbox");
  rescanBtn.disabled = imp.busy;

  root.replaceChildren(
    el("div", { class: "panel stack" }, el("h3", {}, "Paste a scan"),
      el("div", { class: "small muted" }, "For a client that can't write files itself: run its scanner, copy what it printed, and paste it here."),
      adapterPicker(),
      textarea,
      pasteBtn),
    el("div", { class: "panel stack" }, el("h3", {}, "Import a folder"),
      el("div", { class: "small muted" }, "Already have scan files on disk? Import every one from a folder."),
      pickFolderRow({ title: "Choose a folder of scan files to import", onResolved: doImportFolder })),
    el("div", { class: "panel stack" }, el("h3", {}, "Rescan"),
      el("div", { class: "small muted" }, "If a scan dropped in the client never showed up, sweep the inbox again — this catches anything a folder watcher missed."),
      rescanBtn),
    imp.result ? el("div", { class: `msg ${imp.result.bad ? "bad" : ""}` }, imp.result.text) : null);
}

function setResult(bad, text) {
  imp.result = { bad, text };
}

async function doPaste() {
  const adapter = adapterId();
  if (!adapter) { setResult(true, "No client is set up yet — run setup first."); renderImport(); return; }
  if (!imp.text.trim()) { setResult(true, "Paste some scan text first."); renderImport(); return; }
  imp.busy = true; renderImport();
  try {
    const r = await api("/api/import/paste", { method: "POST", body: { text: imp.text, adapter } });
    setResult(false, `${r.character}'s scan landed — it'll show up in the inventory in a moment.`);
    imp.text = "";
  } catch (e) {
    setResult(true, e.message);
  }
  imp.busy = false; renderImport();
}

async function doImportFolder(dir) {
  const adapter = adapterId();
  if (!adapter) { setResult(true, "No client is set up yet — run setup first."); renderImport(); return; }
  imp.busy = true; renderImport();
  try {
    const r = await api("/api/import", { method: "POST", body: { dir, adapter } });
    setResult(false, r.copied
      ? `copied ${r.copied} scan file${r.copied === 1 ? "" : "s"}${r.skipped ? ` (skipped ${r.skipped} already present)` : ""} — they'll show up in the inventory in a moment.`
      : `nothing new in that folder${r.skipped ? ` — ${r.skipped} file${r.skipped === 1 ? " was" : "s were"} already imported` : ""}.`);
  } catch (e) {
    setResult(true, e.message);
  }
  imp.busy = false; renderImport();
}

async function doRescan() {
  imp.busy = true; renderImport();
  try {
    const r = await api("/api/import/rescan", { method: "POST", body: {} });
    setResult(false, r.adapters.length
      ? `rescanned ${r.adapters.join(", ")} — anything already sitting in the inbox will show up in the inventory in a moment.`
      : "nothing to rescan — no client is being watched yet.");
  } catch (e) {
    setResult(true, e.message);
  }
  imp.busy = false; renderImport();
}
