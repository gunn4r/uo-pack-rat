// dialog-prompt.test.mts — `app/ui/dialog.mts`'s `normalizePromptValue()`, the DOM-free part of the in-page prompt.
//
// `app/ui/dialog.mts`'s `normalizePromptValue()`, the DOM-free part of the in-page prompt that replaces `window.prompt()` (which Electron does not implement): typed text trimmed, an empty or whitespace-only answer, `null` or `undefined` resolving to `null`. Loads the same localStorage shim as `app/bridge-adapter-fallback.test.mts`. `[fast]`.
//
// promptText() is the in-page replacement for window.prompt(), which Electron does not implement (see ui/builder.mts's saveTemplateAs and scripts/ui-smoke.test.mts's Electron-level "Save as…" case); this is the pure bit of it that can be tested without a DOM: what typed text becomes the resolved value. Lives at the top level of app/ (not app/ui/), matching app/bridge-adapter-fallback.test.mts and app/wizard-default-adapter.test.mts, because tsconfig.browser.json compiles app/ui/** for the browser. The shim is imported first, as its own module, for the reason bridge-adapter-fallback.test.mts gives; no module ui/dialog.mts imports reads localStorage at module scope today (app/ui/store.mts no longer does), so it is a safety net.
import "../scripts/localstorage-shim-for-tests.mts";

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
