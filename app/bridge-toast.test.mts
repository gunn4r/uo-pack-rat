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
import { bridge } from "./ui/store.mts";
import { pollBridge } from "./ui/bridge.mts";

interface FakeEl { className: string; textContent: string; kids: string[]; setAttribute(): void; addEventListener(): void; append(...k: unknown[]): void; remove(): void }
const toasts: { text: string; cls: string }[] = [];
function fakeEl(): FakeEl {
  return {
    className: "", textContent: "", kids: [],
    setAttribute() {}, addEventListener() {}, remove() {},
    append(...k: unknown[]) { for (const x of k) this.kids.push(String((x as { text?: string }).text ?? x)); },
  };
}
const pill = fakeEl();
const g = globalThis as Record<string, unknown>;
g.document = {
  querySelector: (s: string) => (s === "#bridge" ? pill : null),
  querySelectorAll: () => [],
  createElement: () => fakeEl(),
  createTextNode: (text: string) => ({ text }),
  body: { append: (t: FakeEl) => toasts.push({ text: t.kids.join(""), cls: t.className }) },
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
