// ui/dialog.mts — the one-field prompt dialog, on components.mts's openDialog. Exists because Electron
// does not implement window.prompt() (it silently returns null/undefined with no error) —
// ui/builder.mts's saveTemplateAs used to call prompt() directly and simply did nothing in the desktop
// app, while working fine in a plain browser. Yes/no questions use components.mts's confirmDialog.
import { openDialog, button, field, input } from "./components.mts";

// The one bit of promptText() worth testing without a DOM: what typed text becomes the resolved
// value. Trimmed, and an empty/whitespace-only result reads as null — the same truthiness the old
// `(prompt(...) || "").trim()` call sites relied on.
export function normalizePromptValue(raw: string | null | undefined): string | null {
  return (raw ?? "").trim() || null;
}

export interface PromptTextOptions {
  title?: string | undefined;
  value?: string | undefined;
  okLabel?: string | undefined;
  placeholder?: string | undefined;
}
// promptText({title, value, okLabel, placeholder}) -> Promise<string|null>
// A single-field modal (.prompt-dialog, the dialog's own width; the input fills it). Save or Enter resolves
// the trimmed text, or null if it comes out empty; Cancel or Escape resolves null. Focus lands in the input
// with its existing text selected, so replacing a name is a type-over rather than an edit. The <dialog> is
// built fresh per call and removed from the DOM once it closes, so nothing leaks between calls.
export function promptText({ title = "", value = "", okLabel = "Save", placeholder = "" }: PromptTextOptions = {}): Promise<string | null> {
  return new Promise((resolve) => {
    const box = input({ value, placeholder, size: "lg" });
    let d: { close: () => void } | null = null;
    const done = (v: string | null): void => { d?.close(); resolve(v); };
    box.addEventListener("keydown", (e) => { if (e.key === "Enter") done(normalizePromptValue(box.value)); });
    d = openDialog({
      title, cls: "prompt-dialog", initialFocus: box, onCancel: () => resolve(null),
      body: [field({ label: "Name", control: box })],
      actions: [button({ label: "Cancel", onClick: () => done(null) }), button({ label: okLabel, variant: "primary", onClick: () => done(normalizePromptValue(box.value)) })],
    });
    box.select();
  });
}
