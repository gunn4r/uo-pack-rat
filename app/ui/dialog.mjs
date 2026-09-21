// ui/dialog.mjs — small reusable in-page dialogs, built on the native <dialog> element. Exists
// because Electron does not implement window.prompt() (it silently returns null/undefined with no
// error) — ui/builder.mjs's saveTemplateAs used to call prompt() directly and simply did nothing in
// the desktop app, while working fine in a plain browser. confirm() DOES work in Electron and is left
// alone everywhere it's already used (the overwrite/delete confirmations in ui/builder.mjs).
import { el } from "./dom.mjs";

// The one bit of promptText() worth testing without a DOM: what typed text becomes the resolved
// value. Trimmed, and an empty/whitespace-only result reads as null — the same truthiness the old
// `(prompt(...) || "").trim()` call sites relied on.
export function normalizePromptValue(raw) {
  return (raw ?? "").trim() || null;
}

// promptText({title, value, okLabel, placeholder}) -> Promise<string|null>
// A single-field modal styled like the wizard's own restyled <dialog> (styles.css's .wizard, plus
// .prompt-dialog for the narrower width a one-field form needs). Save or Enter resolves the trimmed
// text, or null if it comes out empty; Cancel or Escape resolves null. Focus lands in the input with
// its existing text selected, so replacing a name is a type-over rather than an edit. The <dialog> is
// built fresh per call and removed from the DOM once it closes, so nothing leaks between calls.
export function promptText({ title = "", value = "", okLabel = "Save", placeholder = "" } = {}) {
  return new Promise((resolve) => {
    const input = el("input", { type: "text", value, placeholder });
    const submit = () => done(normalizePromptValue(input.value));
    const cancel = () => done(null);
    const dialog = el("dialog", { class: "wizard prompt-dialog" },
      el("div", { class: "wizard-head" }, el("h2", {}, title)),
      el("div", { class: "wizard-body" }, el("div", { class: "field" }, input)),
      el("div", { class: "row wizard-foot" }, el("span", { class: "grow" }), el("button", { onclick: cancel }, "Cancel"), el("button", { class: "primary", onclick: submit }, okLabel)));
    function done(v) { dialog.close(); dialog.remove(); resolve(v); }
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
    dialog.addEventListener("cancel", cancel);   // Escape fires the dialog's native "cancel" event before it closes itself
    document.body.append(dialog);
    dialog.showModal();
    input.focus();
    input.select();
  });
}
