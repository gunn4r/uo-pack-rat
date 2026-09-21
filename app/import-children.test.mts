// import-children.test.mts — app/ui/dom.mts's compactChildren(), extracted for app/ui/import.mts's
// renderImport() fix. renderImport() itself calls el()/$, which need `document`, and this repo has no
// jsdom/happy-dom dependency to fake one, so it can't run under plain node:test (see
// app/wizard-default-adapter.test.mts and app/bridge-adapter-fallback.test.mts for the same DOM-free-
// testing constraint on other ui/*.mts modules; ui/import.mts specifically also transitively imports
// ui/wizard.mts, which calls `$(...)` at MODULE SCOPE — even a DOM-free pure helper defined inside
// import.mts itself can't be imported under plain node:test for that reason, which is why the helper
// lives in dom.mts instead, whose own `document` uses are all inside function bodies or a lazily-
// evaluated default-parameter expression).
//
// The bug: opening the Import tab before pasting/importing/rescanning anything rendered the literal
// word "null" after the Rescan panel. renderImport() passed `imp.result ? el(...) : null` straight as
// the last argument to replaceChildren(...) — that method's real (Node | string) signature has no null
// member, so a literal null argument WebIDL-coerces to the text node "null" instead of being skipped
// (unlike a null nested inside an el() call's own kids, which el() explicitly filters via its
// `kid != null` check). compactChildren() is the fix: build the full list, then filter nulls out before
// it ever reaches replaceChildren.
//
// Generic over T (plain strings stand in for the DOM nodes renderImport actually passes) — the bug and
// the fix live entirely in the list-building/filtering logic, not in anything DOM-specific.
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
