// ui/import.mts — the Import drawer (design spec 4.9): paste a scan, or bring in scan files, with an
// instant preview of what will land before anything is sent. The paste box exists for a client whose
// sandbox can't write files at all (the ClassicUO web client — its scanner prints a marked block the
// player copies here instead). Scan files are read in the page and go through the same route as a
// paste, one per file, so every file gets the same preview. Both parse with app/paste-scan.mts, the rule
// POST /api/import/paste applies, so the preview never calls clean what the server then refuses. Rescan
// inbox is the escape hatch for a player whose folder watcher missed a drop. A scan that lands reaches
// the inventory through the SSE "inventory" event (ui/events.mts), not a call made from here.
import { state } from "./store.mts";
import { $, el } from "./dom.mts";
import { api } from "./api.mts";
import { parsePastedScan, type ParsePastedScanResult } from "../paste-scan.mts";
import { box, button, icon, message, segmented, select, textarea, txt, showToast, type Kids } from "./components.mts";
import { defaultImportAdapterId, platformCompatible } from "./adapters.mts";
import { importOptionLabel } from "./adapter-copy.mts";
import { importActionLabel, listText, plural, scanPreview, sendEach, sizeText, type ScanPreview } from "./import-preview.mts";
import { errorText, relativeWhen } from "./messages.mts";
import { closeImportDrawer } from "./app.mts";
import type { ImportPasteApiResponse, RescanApiResponse } from "./api-types.mts";

// A scan file bigger than the inbox accepts (app/watcher.mts's MAX_INBOX_BYTES) is refused before it is read.
const MAX_FILE_BYTES = 32 * 1024 * 1024;

interface ScanFile { name: string; size: number; text: string; parsed: ParsePastedScanResult }
type Mode = "paste" | "files";

// The drawer's working state. Survives closing and reopening the drawer (a half-finished paste is still
// there), not a page reload.
const imp: {
  mode: Mode; text: string; adapter: string | null; busy: boolean;
  files: ScanFile[]; error: string | null; rescan: { bad: boolean; text: string } | null;
} = { mode: "paste", text: "", adapter: null, busy: false, files: [], error: null, rescan: null };

// The explicit pick in this drawer, else the paste client (defaultImportAdapterId).
function pasteAdapterId(): string | null {
  return imp.adapter || defaultImportAdapterId(state.setup?.adapters, state.setup?.platform, state.settings?.client?.adapter);
}
// A scan file is filed under the client its own document names when Pack Rat knows that client; the
// paste default otherwise.
function fileAdapterId(f: ScanFile): string | null {
  const declared = f.parsed.ok ? f.parsed.doc.adapter?.id : undefined;
  return declared && state.setup?.adapters.some((a) => a.id === declared) ? declared : pasteAdapterId();
}

function previewOf(p: ParsePastedScanResult, adapter: string | null): ScanPreview | null {
  return p.ok ? scanPreview(p.doc, state.inv, { adapter, adapters: state.setup?.adapters }) : null;
}

// ---------------------------------------------------------------- render
// The body is rebuilt on a mode switch or after an action; typing in the textarea only redraws the parts
// that depend on it (size, preview, the primary button), so the caret and scroll never jump.
let parsed: ParsePastedScanResult | null = null;
let parseTimer: ReturnType<typeof setTimeout> | null = null;
const refs: { size?: HTMLElement; preview?: HTMLElement } = {};

export function renderImport(): void {
  const root = $<HTMLElement>("#import-body");
  if (!root || !state.setup) return;   // load() fetches GET /api/setup before this is ever called
  const mode = segmented({ label: "Import method", value: imp.mode,
    options: [{ value: "paste", label: "Paste a scan" }, { value: "files", label: "Scan files" }],
    onChange: (v) => { imp.mode = v as Mode; imp.error = null; renderImport(); } });
  mode.id = "imp-mode";
  const focusedId = document.activeElement?.id;
  root.replaceChildren(mode, ...(imp.mode === "paste" ? pasteBody() : filesBody()).filter((k): k is Node => !!k), rescanLine());
  renderFoot();
  // A rebuild must not drop focus out of an open drawer (Esc and the focus trap listen inside it): back to
  // the same control when it still exists, else the checked mode.
  const drawer = $<HTMLElement>("#import-drawer");
  if (drawer && !drawer.hidden && !drawer.contains(document.activeElement)) {
    ((focusedId && document.getElementById(focusedId)) || mode.querySelector<HTMLElement>("[aria-checked=true]"))?.focus();
  }
}

function pasteBody(): Kids {
  const setup = state.setup!;
  const client = select(setup.adapters.map((a) => ({ value: a.id, label: importOptionLabel(a, setup.platform), disabled: !platformCompatible(a, setup.platform) })),
    pasteAdapterId() || "", { attrs: { id: "imp-client" } });
  client.addEventListener("change", () => { imp.adapter = client.value; updatePaste(); });
  const text = textarea({ value: imp.text, rows: 9, attrs: { id: "imp-text", class: "textarea mono", spellcheck: "false", "aria-describedby": "imp-text-help" } });
  text.addEventListener("input", () => {
    imp.text = text.value; imp.error = null;
    if (parseTimer) clearTimeout(parseTimer);
    parseTimer = setTimeout(updatePaste, 120);   // a multi-megabyte paste parses once, not per keystroke
  });
  refs.size = txt("", "help");
  refs.preview = el("div", { class: "imp-preview-slot" });
  parsed = imp.text.trim() ? parsePastedScan(imp.text) : null;
  paintPaste();
  return [
    box("div", { class: "field" }, el("label", { class: "label", for: "imp-client" }, "Client that printed it"), client),
    box("div", { class: "field" }, el("label", { class: "label", for: "imp-text" }, "Scan text"), text,
      box("div", { class: "imp-help", id: "imp-text-help" }, txt("The whole block with its markers, or just the scan JSON.", "help"), el("span", { class: "spacer" }), refs.size)),
    refs.preview,
  ];
}
function updatePaste(): void {
  parsed = imp.text.trim() ? parsePastedScan(imp.text) : null;
  paintPaste();
  renderFoot();
}
function paintPaste(): void {
  if (refs.size) refs.size.textContent = imp.text ? `${sizeText(new TextEncoder().encode(imp.text).length)} pasted` : "";
  refs.preview?.replaceChildren(...(parsed ? [previewCard(parsed, pasteAdapterId())] : []));
}

// The preview card: "Kestrel's scan reads cleanly" with its counts, or the parse error, in one place. A
// server refusal after Import lands here too, never elsewhere on the page.
function previewCard(p: ParsePastedScanResult, adapter: string | null): HTMLElement {
  if (!p.ok) {
    return el("section", { class: "card imp-preview bad", "aria-label": "Preview" },
      message({ tone: "bad", title: "This doesn't read as a scan", text: p.error }));
  }
  const s = previewOf(p, adapter)!;
  const fact = (k: string, v: string): HTMLElement => box("div", { class: "imp-fact" }, txt(k, "t-sm muted"), txt(v));
  return box("section", { class: `card imp-preview ${imp.error ? "bad" : "ok"}`, "aria-label": "Preview" },
    box("div", { class: "imp-preview-head" }, icon("check", { cls: "imp-ok-icon" }), txt(`${s.character}'s scan reads cleanly`, "strong"),
      el("span", { class: "spacer" }), txt(plural(s.warnings.length, "warning"), "t-sm muted")),
    box("div", { class: "imp-facts" },
      fact("Scanned", relativeWhen(s.scannedAt) || s.scannedAt), fact("Worn", plural(s.worn, "piece")),
      fact("In containers", plural(s.stacks, "stack")), fact("Containers", String(s.containers))),
    ...s.warnings.map((w) => message({ tone: "warn", text: w })),
    s.replaces ? message({ tone: "info", text: s.replaces }) : null,
    imp.error ? message({ tone: "bad", title: "Could not import", text: imp.error }) : null);
}

function filesBody(): Kids {
  const picker = el("input", { type: "file", multiple: "", webkitdirectory: "", class: "sr", tabindex: "-1", "aria-hidden": "true", id: "imp-folder-input" });
  picker.addEventListener("change", async () => { await addFiles([...(picker.files || [])].filter((f) => /\.json$/i.test(f.name))); picker.value = ""; });
  const zone = box("div", { class: "imp-drop", id: "imp-drop" }, icon("import"),
    txt("Drop scan files here, or anywhere on the window", "strong"), txt("Scan files are the .json files a client's scanner writes.", "t-sm muted"),
    button({ label: "Choose a folder…", icon: "folder", onClick: () => picker.click() }), picker);
  const bad = imp.files.filter((f) => !f.parsed.ok).length;
  return [
    zone,
    imp.files.length ? box("div", { class: "imp-files", role: "list", "aria-label": "Scan files" }, ...imp.files.map(fileRow)) : null,
    bad ? message({ tone: "warn", text: `${plural(bad, "file")} won't be imported. Remove ${bad === 1 ? "it" : "them"}, or fix the scan and drop it again.` }) : null,
    imp.error ? message({ tone: "bad", title: "Could not import", text: imp.error }) : null,
  ];
}
function fileRow(f: ScanFile, i: number): HTMLElement {
  const s = previewOf(f.parsed, fileAdapterId(f));
  const remove = button({ label: `Remove ${f.name}`, icon: "close", iconOnly: true, variant: "ghost", size: "sm", onClick: () => { imp.files.splice(i, 1); renderImport(); } });
  const detail = s
    ? txt([plural(s.total, "stack"), `scanned ${relativeWhen(s.scannedAt) || s.scannedAt}`, s.replaces ? "replaces the older scan" : "new to Pack Rat"].join(" · "), "t-sm muted")
    : txt(f.parsed.error || "", "t-sm imp-file-error");
  return box("div", { class: `imp-file${s ? "" : " bad"}`, role: "listitem" },
    icon(s ? "check" : "alert", { cls: s ? "imp-ok-icon" : "imp-bad-icon" }),
    box("div", { class: "imp-file-text" }, txt(s ? `${s.character} · ${f.name}` : f.name, "ellip"), detail),
    remove);
}
async function addFiles(list: File[]): Promise<void> {
  for (const f of list) {
    if (imp.files.some((x) => x.name === f.name && x.size === f.size)) continue;
    let result: ParsePastedScanResult;
    let text = "";
    if (!/\.json$/i.test(f.name)) result = { ok: false, error: "Not a scan file. Scans are .json files." };
    else if (f.size > MAX_FILE_BYTES) result = { ok: false, error: `Too large to be a scan (${sizeText(f.size)}).` };
    else {
      try { text = await f.text(); result = parsePastedScan(text); }
      catch (e) { result = { ok: false, error: `Could not read the file: ${errorText(e)}` }; }
    }
    imp.files.push({ name: f.name, size: f.size, text, parsed: result });
  }
  imp.error = null;
  renderImport();
}

function rescanLine(): HTMLElement {
  return box("div", { class: "imp-rescan" },
    box("div", { class: "imp-rescan-row" }, txt("Clients that write scan files are picked up by themselves. Missed one?", "t-sm muted"), el("span", { class: "spacer" }),
      button({ label: "Rescan inbox", icon: "refresh", variant: "ghost", size: "sm", disabled: imp.busy, onClick: doRescan })),
    imp.rescan ? message({ tone: imp.rescan.bad ? "bad" : "ok", text: imp.rescan.text }) : null);
}

// What the primary button will import right now.
// `file` is the list entry a pasted-in file came from, so a partial failure can drop exactly the ones sent.
function ready(): Array<{ text: string; adapter: string | null; preview: ScanPreview; file?: ScanFile }> {
  if (imp.mode === "paste") {
    const adapter = pasteAdapterId();
    const pv = parsed ? previewOf(parsed, adapter) : null;
    return pv ? [{ text: imp.text, adapter, preview: pv }] : [];
  }
  return imp.files.flatMap((f) => { const adapter = fileAdapterId(f); const pv = previewOf(f.parsed, adapter); return pv ? [{ text: f.text, adapter, preview: pv, file: f }] : []; });
}
function renderFoot(): void {
  const foot = $<HTMLElement>("#import-foot");
  if (!foot) return;
  const todo = ready();
  const hadFocus = foot.contains(document.activeElement);
  const go = button({ label: importActionLabel(todo.map((t) => t.preview)), variant: "primary", size: "lg", kbd: "⌘↵", disabled: imp.busy || !todo.length, onClick: doImport, attrs: { id: "imp-go" } });
  foot.replaceChildren(button({ label: "Cancel", attrs: { "data-drawer-close": "" } }), el("span", { class: "spacer" }), go);
  // A disabled button can't hold focus; keep it in the drawer on the footer's own frame instead.
  if (hadFocus) { if (go.disabled) { foot.tabIndex = -1; foot.focus(); } else go.focus(); }
}

// ---------------------------------------------------------------- actions
async function doImport(): Promise<void> {
  const todo = ready();
  if (!todo.length || imp.busy) return;
  if (todo.some((t) => !t.adapter)) { imp.error = "No client is set up yet. Run setup in Settings first."; renderImport(); return; }
  imp.busy = true; imp.error = null; renderFoot();
  const sent = await sendEach(todo, (t) => api<ImportPasteApiResponse>("/api/import/paste", { method: "POST", body: { text: t.text, adapter: t.adapter } }));
  const landed = sent.landed.map((l) => l.result.character);
  if (sent.error) imp.error = landed.length ? `${errorText(sent.error)} (${listText([...new Set(landed)])} landed before this.)` : errorText(sent.error);
  imp.busy = false;
  if (imp.error) {
    // The files that landed leave the list, so trying again sends only the rest.
    const done = new Set(sent.landed.map((l) => l.item.file));
    if (imp.mode === "files") imp.files = imp.files.filter((f) => !done.has(f));
    renderImport();
    return;
  }
  // Success closes the drawer and says so in a toast; the inventory refresh rides the SSE event.
  if (imp.mode === "paste") imp.text = ""; else imp.files = [];
  renderImport();
  closeImportDrawer();
  const names = [...new Set(landed)];
  showToast(landed.length === 1 ? `${names[0]}'s scan landed` : `${plural(landed.length, "scan")} landed for ${listText(names)}`, "ok");
}

async function doRescan(): Promise<void> {
  imp.busy = true; renderImport();
  try {
    const r = await api<RescanApiResponse>("/api/import/rescan", { method: "POST", body: {} });
    imp.rescan = r.adapters.length
      ? { bad: false, text: "Swept the inbox. Anything waiting there shows up in the inventory in a moment." }
      : { bad: true, text: "Nothing to rescan: no client is being watched yet. Run setup in Settings." };
  } catch (e) {
    imp.rescan = { bad: true, text: errorText(e) };
  }
  imp.busy = false; renderImport();
}

// ---------------------------------------------------------------- ⌘↵ and drop anywhere
$<HTMLElement>("#import-drawer")?.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void doImport(); }
});
// Files dropped anywhere on the window open the drawer in Scan files mode. Only a drag that carries files
// is taken over; everything else (text, a link) keeps the browser's own behaviour.
const carriesFiles = (e: DragEvent): boolean => !!e.dataTransfer && [...e.dataTransfer.types].includes("Files");
window.addEventListener("dragover", (e) => { if (carriesFiles(e)) { e.preventDefault(); e.dataTransfer!.dropEffect = "copy"; } });
window.addEventListener("drop", (e) => {
  if (!carriesFiles(e)) return;
  e.preventDefault();
  imp.mode = "files";
  if (location.hash !== "#/import") location.hash = "#/import";
  void addFiles([...(e.dataTransfer!.files || [])]);
});
