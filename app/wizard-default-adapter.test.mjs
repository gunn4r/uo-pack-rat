// wizard-default-adapter.test.mjs — app/ui/adapters.mjs: defaultAdapterId (the setup wizard and the
// Import tab must never silently default to a paste-transport adapter — Phase 6 final review, Blocker
// 2 — a new TazUO/Razor Enhanced player who clicked through the wizard without reading the radio
// buttons was routed down the paste branch because setup.adapters[0] sorts alphabetically, and
// classicuo-web sorts first) and availableAdapters/platformCompatible (the wizard and Import tab must
// never offer, or default to, the Windows-only Razor Enhanced adapter on any other platform — a
// deferred minor from the same final review, and a trap defaultAdapterId falls straight into on its
// own: "razor-enhanced" < "tazuo" alphabetically, so an unfiltered list defaults a Mac/Linux player to
// the one adapter that can never work for them). Lives at the top level of app/ (not app/ui/) because
// scripts/test-runner.mjs only globs app/*.test.mjs — app/ui/adapters.mjs is deliberately DOM-free so
// it can be imported directly under plain node:test, unlike the rest of ui/*.mjs (which import
// ui/store.mjs and touch localStorage at module scope).
import test from "node:test";
import assert from "node:assert/strict";
import { defaultAdapterId, availableAdapters, platformCompatible } from "./ui/adapters.mjs";

test("[fast] defaultAdapterId picks the first folder-transport adapter even when a paste adapter sorts first", () => {
  const adapters = [
    { id: "classicuo-web", transport: "paste" },
    { id: "razor-enhanced", transport: "folder" },
    { id: "tazuo", transport: "folder" },
  ];
  assert.equal(defaultAdapterId(adapters), "razor-enhanced");
});

test("[fast] defaultAdapterId never returns a paste-transport id when any folder-transport adapter exists, for every ordering", () => {
  const base = [
    { id: "classicuo-web", transport: "paste" },
    { id: "razor-enhanced", transport: "folder" },
    { id: "tazuo", transport: "folder" },
  ];
  // All 6 permutations of a 3-element array — the guarantee must not depend on list order.
  const permutations = (arr) => arr.length <= 1 ? [arr] : arr.flatMap((x, i) =>
    permutations([...arr.slice(0, i), ...arr.slice(i + 1)]).map((rest) => [x, ...rest]));
  for (const order of permutations(base)) {
    const picked = order.find((a) => a.id === defaultAdapterId(order));
    assert.ok(picked, `defaultAdapterId(${JSON.stringify(order.map((a) => a.id))}) returned an id not in the list`);
    assert.notEqual(picked.transport, "paste", `defaultAdapterId must not land on a paste-transport adapter for order ${JSON.stringify(order.map((a) => a.id))}`);
  }
});

test("[fast] defaultAdapterId falls back to the first adapter when every shipped adapter is paste-transport", () => {
  assert.equal(defaultAdapterId([{ id: "classicuo-web", transport: "paste" }, { id: "other-web", transport: "paste" }]), "classicuo-web");
});

test("[fast] defaultAdapterId returns null for an empty or missing adapter list", () => {
  assert.equal(defaultAdapterId([]), null);
  assert.equal(defaultAdapterId(null), null);
  assert.equal(defaultAdapterId(undefined), null);
});

// The exact failure mode this guards against: passing defaultAdapterId the FULL (unfiltered) adapter
// list on a non-Windows platform lands on razor-enhanced (it sorts before tazuo alphabetically), the
// one adapter that can never work there.
test("[fast] defaultAdapterId on the unfiltered list defaults to razor-enhanced — demonstrating why callers must filter first", () => {
  const adapters = [
    { id: "classicuo-web", transport: "paste" },
    { id: "razor-enhanced", transport: "folder" },
    { id: "tazuo", transport: "folder" },
  ];
  assert.equal(defaultAdapterId(adapters), "razor-enhanced");
});

const THREE_ADAPTERS = [
  { id: "classicuo-web", transport: "paste" },
  { id: "razor-enhanced", transport: "folder" },
  { id: "tazuo", transport: "folder" },
];

test("[fast] platformCompatible refuses razor-enhanced on anything but win32, and never refuses any other adapter", () => {
  for (const platform of ["darwin", "linux", "freebsd", undefined]) {
    assert.equal(platformCompatible({ id: "razor-enhanced" }, platform), false, `razor-enhanced should be refused on ${platform}`);
  }
  assert.equal(platformCompatible({ id: "razor-enhanced" }, "win32"), true);
  for (const id of ["tazuo", "classicuo-web", "some-future-adapter"]) {
    for (const platform of ["win32", "darwin", "linux", undefined]) {
      assert.equal(platformCompatible({ id }, platform), true, `${id} should never be refused (platform ${platform})`);
    }
  }
});

test("[fast] availableAdapters drops razor-enhanced on darwin/linux and keeps it on win32", () => {
  assert.deepEqual(availableAdapters(THREE_ADAPTERS, "darwin").map((a) => a.id), ["classicuo-web", "tazuo"]);
  assert.deepEqual(availableAdapters(THREE_ADAPTERS, "linux").map((a) => a.id), ["classicuo-web", "tazuo"]);
  assert.deepEqual(availableAdapters(THREE_ADAPTERS, "win32").map((a) => a.id), ["classicuo-web", "razor-enhanced", "tazuo"]);
});

test("[fast] availableAdapters tolerates a missing list", () => {
  assert.deepEqual(availableAdapters(null, "darwin"), []);
  assert.deepEqual(availableAdapters(undefined, "darwin"), []);
});

// The actual bug this whole file exists to prevent: on a non-Windows platform, defaultAdapterId over
// the PLATFORM-FILTERED list must land on tazuo (the real, working folder-transport choice), not
// razor-enhanced — the opposite of the "unfiltered list" test above.
test("[fast] defaultAdapterId(availableAdapters(...)) picks tazuo on darwin/linux, never razor-enhanced", () => {
  for (const platform of ["darwin", "linux"]) {
    assert.equal(defaultAdapterId(availableAdapters(THREE_ADAPTERS, platform)), "tazuo", `platform ${platform}`);
  }
  // On win32, razor-enhanced is back in the running and wins on alphabetical order — documenting the
  // actual behavior, not asserting it's the ideal one (both are real, working folder-transport
  // adapters there; defaultAdapterId has no basis to prefer one over the other beyond list order).
  assert.equal(defaultAdapterId(availableAdapters(THREE_ADAPTERS, "win32")), "razor-enhanced");
});
