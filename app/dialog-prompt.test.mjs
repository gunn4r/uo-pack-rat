// dialog-prompt.test.mjs — app/ui/dialog.mts's normalizePromptValue(): the pure bit of promptText()
// (the in-page replacement for window.prompt(), which Electron doesn't implement — see
// ui/builder.mts's saveTemplateAs and scripts/ui-smoke.test.mts's Electron-level "Save as…" case)
// that can be tested without a DOM: what typed text becomes the resolved value.
//
// Lives at the top level of app/ (not app/ui/), matching app/bridge-adapter-fallback.test.mts and
// app/wizard-default-adapter.test.mts — ui/dialog.mts imports ui/dom.mts, which imports ui/store.mts,
// which reads `localStorage.getItem` at MODULE SCOPE, so the shim below (imported first, its own
// module for the same reason bridge-adapter-fallback.test.mts's does) is needed to import it at all
// under plain node:test.
import "../scripts/localstorage-shim-for-tests.mjs";

import test from "node:test";
import assert from "node:assert/strict";
import { normalizePromptValue } from "./ui/dialog.mts";

test("[fast] normalizePromptValue trims and turns an empty/whitespace-only result into null", () => {
  assert.equal(normalizePromptValue("Sampire"), "Sampire");
  assert.equal(normalizePromptValue("  Sampire  "), "Sampire");
  assert.equal(normalizePromptValue(""), null);
  assert.equal(normalizePromptValue("   "), null);
  assert.equal(normalizePromptValue(null), null);
  assert.equal(normalizePromptValue(undefined), null);
});
