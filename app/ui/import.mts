// ui/import.mts — the Import tab (Task 1, Phase 6): paste a scan, import a folder of scan files, and
// rescan the inbox. The paste box exists for a client whose sandbox can't write files at all (the
// ClassicUO web client — its scanner prints a marked block the player copies here instead); the
// folder import reuses the same host-folder-picker/typed-path row the wizard and Settings already
// use; rescan is the escape hatch for a player whose folder watcher missed a drop. All three land a
// file in an adapter's inbox and nudge the watcher server-side — the inventory refresh itself rides
// the existing SSE "inventory" event -> ui/events.mts's reload(), not a call made from here.
import { state } from "./store.mts";
import { $, el } from "./dom.mts";
import type { ElAttrs } from "./dom.mts";
import { api } from "./api.mts";
import { pickFolderRow } from "./wizard.mts";
import { defaultAdapterId, availableAdapters, platformCompatible } from "./adapters.mts";
import type { ImportApiResponse, ImportPasteApiResponse, RescanApiResponse } from "./api-types.mts";

// This tab's own working state — text box contents, the picked adapter (once there's more than one
// to choose from), busy flag, and the last result line. Survives switching away and back (the section
// is only hidden, not unmounted) but not a full page reload, same as the wizard's `wiz` and the
// builder's in-memory state elsewhere in this app.
const imp: { text: string; adapter: string | null; busy: boolean; result: { bad: boolean; text: string } | null } = { text: "", adapter: null, busy: false, result: null };

// Falls back through: an adapter explicitly picked in this tab's own <select>, then the configured
// client, then defaultAdapterId's first-installable-adapter rule over the PLATFORM-FILTERED adapter
// list (never state.setup.adapters[0], or the unfiltered list, directly — the former sorts
// alphabetically by directory name and would default to the paste-transport classicuo-web adapter,
// the latter would default a non-Windows player to the Windows-only razor-enhanced adapter since
// "razor-enhanced" < "tazuo" alphabetically; see wizard.mts's defaultAdapterId/availableAdapters for
// why both matter, Phase 6 final review, Blocker 2 and a deferred minor).
function adapterId(): string | null {
  return imp.adapter || state.settings?.client?.adapter || defaultAdapterId(availableAdapters(state.setup?.adapters, state.setup?.platform)) || null;
}

// Only shown once a second adapter actually exists at all — no point asking a player to pick from a
// list of one. Shows every shipped adapter (never pre-filtered by platform — see wizard.mts's step2()
// for why): a platform-incompatible one (Razor Enhanced, Windows-only, on any other platform —
// platformCompatible reads a.platform from capabilities.json, never a hard-coded id) still appears,
// disabled, with its name suffixed " (Windows only)" rather than silently missing, so a player who's
// heard of it isn't left wondering where it went. adapterId()'s own default (above) still only ever
// draws from availableAdapters, so this picker's *default selection* is never one a player can't use.
function adapterPicker(): HTMLDivElement | null {
  const adapters = state.setup?.adapters || [];
  if (adapters.length <= 1) return null;
  const current = adapterId();
  const sel = el("select", { onchange: (e) => { imp.adapter = e.target.value; } },
    ...adapters.map((a) => {
      const compatible = platformCompatible(a, state.setup?.platform);
      // el() has no null-attribute handling (setAttribute(k, null) sets the literal string "null",
      // which for a boolean attribute like `disabled` is still "present" — see wizard.mts's step2()
      // for the same fix shape): build attrs conditionally instead of passing null for "off".
      const optAttrs: ElAttrs = { value: a.id, selected: a.id === current ? "" : null };
      if (!compatible) optAttrs.disabled = "";
      const opt = el("option", optAttrs, compatible ? a.name : `${a.name} (${a.platform} only)`);
      return opt;
    }));
  for (const o of sel.querySelectorAll("option[selected='null']")) o.removeAttribute("selected");
  return el("div", { class: "field" }, el("label", {}, "Adapter"), sel);
}

export function renderImport(): void {
  const root = $<HTMLElement>("#import-body");
  if (!root || !state.setup) return;   // load() fetches GET /api/setup before this is ever called

  const textarea = el("textarea", { rows: 10, placeholder: "Paste what the client's scanner printed — the whole block, markers included, or just the scan JSON on its own." });
  textarea.value = imp.text;
  textarea.oninput = (e) => { imp.text = (e.target as HTMLTextAreaElement).value; };
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
    // @ts-expect-error — pre-existing: replaceChildren()'s real (Node | string) signature has no
    // null member, and a literal null argument WebIDL-coerces to the text node "null" rather than
    // being skipped (unlike a null nested inside an el() call's own kids, which dom.mts's el()
    // explicitly filters — see its `kid != null` check). Click path: open the Import tab before
    // pasting/importing/rescanning anything (imp.result's default) — a stray "null" text node
    // renders after the Rescan panel. Not fixed here (this task migrates types, not behaviour); every
    // other render function in this codebase that can hit this either filters with `.filter(Boolean)`
    // (builder.mts's renderResult) or builds an array first (runs.mts's renderRuns) — this call site
    // is the one place that pattern was missed.
    imp.result ? el("div", { class: `msg ${imp.result.bad ? "bad" : ""}` }, imp.result.text) : null);
}

function setResult(bad: boolean, text: string): void {
  imp.result = { bad, text };
}

async function doPaste(): Promise<void> {
  const adapter = adapterId();
  if (!adapter) { setResult(true, "No client is set up yet — run setup first."); renderImport(); return; }
  if (!imp.text.trim()) { setResult(true, "Paste some scan text first."); renderImport(); return; }
  imp.busy = true; renderImport();
  try {
    const r = await api<ImportPasteApiResponse>("/api/import/paste", { method: "POST", body: { text: imp.text, adapter } });
    // r.warning: the adapter picked above doesn't match what the pasted document itself declares
    // (POST /api/import/paste's own post-review minor fix) — harmless to the fold, but worth showing
    // rather than filing it silently, since the picker is hidden whenever only one client is set up.
    setResult(false, `${r.character}'s scan landed — it'll show up in the inventory in a moment.${r.warning ? ` (${r.warning})` : ""}`);
    imp.text = "";
  } catch (e) {
    setResult(true, (e as Error).message);
  }
  imp.busy = false; renderImport();
}

async function doImportFolder(dir: string): Promise<void> {
  const adapter = adapterId();
  if (!adapter) { setResult(true, "No client is set up yet — run setup first."); renderImport(); return; }
  imp.busy = true; renderImport();
  try {
    const r = await api<ImportApiResponse>("/api/import", { method: "POST", body: { dir, adapter } });
    setResult(false, r.copied
      ? `copied ${r.copied} scan file${r.copied === 1 ? "" : "s"}${r.skipped ? ` (skipped ${r.skipped} already present)` : ""} — they'll show up in the inventory in a moment.`
      : `nothing new in that folder${r.skipped ? ` — ${r.skipped} file${r.skipped === 1 ? " was" : "s were"} already imported` : ""}.`);
  } catch (e) {
    setResult(true, (e as Error).message);
  }
  imp.busy = false; renderImport();
}

async function doRescan(): Promise<void> {
  imp.busy = true; renderImport();
  try {
    const r = await api<RescanApiResponse>("/api/import/rescan", { method: "POST", body: {} });
    setResult(false, r.adapters.length
      ? `rescanned ${r.adapters.join(", ")} — anything already sitting in the inbox will show up in the inventory in a moment.`
      : "nothing to rescan — no client is being watched yet.");
  } catch (e) {
    setResult(true, (e as Error).message);
  }
  imp.busy = false; renderImport();
}
