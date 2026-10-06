// import-children.test.mts — `app/ui/dom.mts`'s `compactChildren()`, the fix for the Import tab rendering the word "null".
//
// `app/ui/dom.mts`'s `compactChildren()`: drops a `null`/`undefined` entry from a children array instead of letting it reach `replaceChildren()`, keeps every non-null entry (including the always-present ones alongside a genuinely-set one), and never returns a list containing `null`/`undefined` for either the empty or the set case. This is the fix for the Import tab rendering the literal word "null" after the Rescan panel on first open (`imp.result ? el(...) : null` used to go straight into `root.replaceChildren(...)`, whose real `(Node | string)` signature has no `null` member and WebIDL-coerces a literal `null` argument into the text node `"null"`). The helper lives in `dom.mts` rather than `import.mts` itself — `import.mts` transitively imports `ui/wizard.mts`, which calls `$(...)` at module scope, so nothing importing `import.mts` can load under plain `node:test` without a real DOM; `dom.mts`'s own `document` uses are all inside function bodies or a lazily-evaluated default-parameter expression, so it imports cleanly standalone. All `[fast]`.
//
// renderImport() itself calls el()/$, which need `document`, and this repo has no jsdom or happy-dom dependency to fake one, so it can't run under plain node:test (app/wizard-default-adapter.test.mts and app/bridge-adapter-fallback.test.mts work under the same DOM-free constraint). A null nested inside an el() call's own kids was never the problem, since el() filters those with its `kid != null` check. The test is generic over T (plain strings stand in for the DOM nodes renderImport passes): the bug and the fix live entirely in the list-building and filtering logic, not in anything DOM-specific.
import "../scripts/localstorage-shim-for-tests.mts";

import test from "node:test";
import assert from "node:assert/strict";
import { compactChildren } from "./ui/dom.mts";

test("[fast] compactChildren drops a null result panel instead of passing it through", () => {
  const kids = compactChildren(["paste", "folder", "rescan", null]);
  assert.deepEqual(kids, ["paste", "folder", "rescan"]);
  assert.ok(!kids.includes(null as unknown as string), "no null slipped into the child list");
});

test("[fast] compactChildren keeps every static panel and appends the result panel when one is set", () => {
  const kids = compactChildren(["paste", "folder", "rescan", "result: ok"]);
  assert.deepEqual(kids, ["paste", "folder", "rescan", "result: ok"]);
});

test("[fast] compactChildren never returns a list containing null or undefined, regardless of the result panel", () => {
  for (const resultPanel of [null, undefined, "some result"]) {
    const kids = compactChildren(["a", "b", "c", resultPanel]);
    for (const k of kids) assert.notEqual(k, null);
    for (const k of kids) assert.notEqual(k, undefined);
  }
});
