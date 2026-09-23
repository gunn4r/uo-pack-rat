// bridge-toast.test.mts — app/ui/bridge.mts's pollBridge() toasting what the bridge reports for the
// commands this page queued: a success as the bridge's own message, a refusal (an expired command, a
// chain the bridge would not open) named after the piece it was for, and nothing for an id this page
// never queued. The bridges record every refusal under the command's own id (docs/bridge-protocol.md,
// "What the bridge refuses"), so this is the whole path from a refused line to the player's screen.
//
// Same localStorage shim as app/bridge-adapter-fallback.test.mts, plus just enough of `document` and
// `fetch` for pollBridge(): one #bridge pill, a body that toasts append to, and the status response.
import "../scripts/localstorage-shim-for-tests.mts";

import test from "node:test";
import assert from "node:assert/strict";
import { bridge, state } from "./ui/store.mts";
import { pollBridge, renderDataDirNotice } from "./ui/bridge.mts";
import type { SetupApiResponse } from "./ui/api-types.mts";

interface FakeEl { nodeType: 1; className: string; textContent: string; title?: string; hidden?: boolean; kids: unknown[]; listeners: Record<string, () => void>; setAttribute(): void; addEventListener(type: string, fn: () => void): void; append(...k: unknown[]): void; replaceChildren(...k: unknown[]): void; remove(): void }
const toasts: { text: string; cls: string }[] = [];
function fakeEl(): FakeEl {
  return {
    nodeType: 1, className: "", textContent: "", kids: [], listeners: {},
    setAttribute() {}, remove() {},
    addEventListener(type: string, fn: () => void) { this.listeners[type] = fn; },
    append(...k: unknown[]) { for (const x of k) this.kids.push(x); },
    replaceChildren(...k: unknown[]) { this.kids = [...k]; },
  };
}
const pill = fakeEl(), notice = fakeEl();
// The text a fake element holds, however deep: el() appends text nodes ({text}) and child elements.
const textOf = (x: unknown): string => typeof x === "string" ? x : (x as { text?: string }).text ?? ((x as FakeEl).kids || []).map(textOf).join("");
const g = globalThis as Record<string, unknown>;
g.document = {
  querySelector: (s: string) => (s === "#bridge" ? pill : s === "#notice" ? notice : null),
  querySelectorAll: () => [],
  createElement: () => fakeEl(),
  createTextNode: (text: string) => ({ text }),
  body: { append: (t: FakeEl) => toasts.push({ text: textOf(t), cls: t.className }) },
};
let status: unknown = null;
g.fetch = async () => ({ ok: true, json: async () => status });

test("[fast] pollBridge toasts a refused command under the piece's name, a success as reported, and ignores ids it never queued", async () => {
  bridge.pending.set("1-1", "Ruby Ring");
  bridge.pending.set("1-2", "Leather Gorget");
  status = {
    ok: true, online: true, character: "Tester", current: null,
    results: {
      "1-1": { ok: false, msg: "expired: queued 73s ago, not run" },
      "1-2": { ok: true, msg: "grabbed Leather Gorget — it is in your backpack" },
      "rejected-2026-09-22T12:00:00Z-3": { ok: false, msg: "1 queue line(s) ignored (unreadable or not a command)" },
    },
  };
  await pollBridge();
  assert.deepEqual(toasts, [
    { text: "Ruby Ring: expired: queued 73s ago, not run", cls: "toast bad" },
    { text: "grabbed Leather Gorget — it is in your backpack", cls: "toast good" },
  ]);
  assert.equal(bridge.pending.size, 0);
  toasts.length = 0;
  await pollBridge();
  assert.deepEqual(toasts, [], "a result is toasted once");
});

// Issue #39: the scripts writing to one data folder while the app reads another used to look exactly
// like a bridge nobody had started.
const MISMATCH = { status: "mismatch", scriptsDir: "/Users/example/LegionScripts", scriptsDataDir: "/Users/example/dev-data", dataDir: "/Users/example/.pack-rat" } as const;

test("[fast] an offline bridge pill names a data-folder mismatch as the cause, and only that", async () => {
  status = { ok: true, online: false };
  state.setup = { dataDirCheck: MISMATCH } as unknown as SetupApiResponse;
  await pollBridge();
  assert.equal(pill.textContent, "bridge: offline — your game scripts write to another folder");
  assert.match(pill.title!, /\/Users\/example\/dev-data/, "the hover names the folders");
  state.setup = { dataDirCheck: { status: "match", scriptsDir: "/x" } } as unknown as SetupApiResponse;
  await pollBridge();
  assert.equal(pill.textContent, "bridge: offline");
  state.setup = null;
});

test("[fast] the data-folder banner shows the mismatch, stays dismissed, and comes back for a different message", () => {
  state.setup = { dataDirCheck: MISMATCH } as unknown as SetupApiResponse;
  renderDataDirNotice();
  assert.equal(notice.hidden, false);
  const text = textOf(notice);
  assert.match(text, /npm start -- --data \/Users\/example\/dev-data/);
  const button = notice.kids.find((k) => textOf(k) === "Dismiss") as FakeEl | undefined;
  assert.ok(button?.listeners.click, "a dismiss button is there");
  button.listeners.click();
  assert.equal(notice.hidden, true);
  renderDataDirNotice();
  assert.equal(notice.hidden, true, "a re-render (Settings refresh) keeps it dismissed");
  state.setup = { dataDirCheck: { ...MISMATCH, scriptsDataDir: "/Users/example/another" } } as unknown as SetupApiResponse;
  renderDataDirNotice();
  assert.equal(notice.hidden, false, "a different mismatch is news");
  state.setup = { dataDirCheck: { status: "none" } } as unknown as SetupApiResponse;
  renderDataDirNotice();
  assert.equal(notice.hidden, true, "nothing to say, nothing shown");
  state.setup = null;
});
