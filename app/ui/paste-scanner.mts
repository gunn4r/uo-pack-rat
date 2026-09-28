// ui/paste-scanner.mts — the Copy scanner script button for a paste-transport client (the ClassicUO web
// client): the wizard's copy step and Settings › Game client both use it. The script is the app's own
// bundled copy (GET /api/setup/scanner), so the player never goes looking for a file. It is fetched when
// the button is drawn, so the click writes the clipboard straight away; if the write is refused, the
// script shows in a read-only box, selected, for the player to copy by hand. The version last copied is
// remembered (ui-prefs copiedScanner), so Settings can say when the app ships a newer one.
import { api } from "./api.mts";
import { box, button, copyText, message, showToast, textarea } from "./components.mts";
import { errorText } from "./messages.mts";
import type { PasteScannerApiResponse } from "./api-types.mts";

export const COPIED_TEXT = "Copied — paste it into the web client's scripting window as a new script.";

let copied: string | undefined;
const loaded = new Map<string, Promise<PasteScannerApiResponse>>();

// app.mts hands over ui-prefs' copiedScanner at load.
export function setCopiedScanner(v: string | undefined): void { copied = v; }
export const copiedScanner = (): string | undefined => copied;

export function loadScanner(adapter: string): Promise<PasteScannerApiResponse> {
  let p = loaded.get(adapter);
  if (!p) {
    p = api<PasteScannerApiResponse>(`/api/setup/scanner?adapter=${encodeURIComponent(adapter)}`);
    p.catch(() => loaded.delete(adapter));   // a failed fetch is tried again on the next click
    loaded.set(adapter, p);
  }
  return p;
}

// The button, and a spot for the read-only fallback when the clipboard refuses (empty until then), each
// placed by the caller. onCopied runs after a copy that worked.
export function scannerCopy(adapter: string, { id, size, onCopied }: { id: string; size?: "lg"; onCopied?: () => void }): { button: HTMLButtonElement; fallback: HTMLElement } {
  void loadScanner(adapter).catch(() => { /* the click says why */ });
  const fallback = box("div", { class: "scanner-fallback" });
  const btn = button({ label: "Copy scanner script", icon: "clipboard", variant: "primary", ...(size ? { size } : {}), attrs: { id }, onClick: async () => {
    let s: PasteScannerApiResponse;
    try { s = await loadScanner(adapter); }
    catch (e) { showToast(`Could not load the scanner: ${errorText(e)}`, "bad"); return; }
    if (!await copyText(s.script)) {
      const ta = textarea({ value: s.script, rows: 8, attrs: { readonly: "", id: `${id}-text`, "aria-label": "Scanner script" } });
      fallback.replaceChildren(message({ tone: "warn", text: "Pack Rat could not reach the clipboard. The script is selected below: press ⌘C or Ctrl+C to copy it." }), ta);
      ta.focus(); ta.select();
      return;
    }
    fallback.replaceChildren();
    showToast(COPIED_TEXT, "ok");
    if (s.version) {
      copied = s.version;
      api("/api/ui-prefs", { method: "PUT", body: { copiedScanner: s.version } }).catch(() => { /* only the "newer scanner" hint depends on it */ });
    }
    onCopied?.();
  } });
  return { button: btn, fallback };
}
