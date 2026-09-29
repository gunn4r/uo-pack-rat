// atomic-write.test.mts — app/atomic-write.mts's renameRetrying: on Windows a rename onto a file another process
// holds open fails for a moment (EPERM, EACCES, EBUSY) and is tried again; any other error, and any error on another
// platform, is final. Pure: the rename is a stand-in. Tags: [fast].
// Run: node --test app/atomic-write.test.mts
import { test } from "node:test";
import assert from "node:assert/strict";
import { renameRetrying } from "./atomic-write.mts";

const failing = (codes: string[]): { rename: (a: string, b: string) => void; calls: () => number } => {
  let n = 0;
  return { rename: () => { const code = codes[n++]; if (code) throw Object.assign(new Error(code), { code }); }, calls: () => n };
};

test("[fast] renameRetrying: on Windows a rename onto a file held open is tried again until it lands", () => {
  const r = failing(["EPERM", "EBUSY", "EACCES"]);
  renameRetrying("a.new", "a", r.rename, "win32");
  assert.equal(r.calls(), 4);
});

test("[fast] renameRetrying: it gives up after about a second, and never retries another error or another platform", () => {
  const always = failing(Array(20).fill("EPERM"));
  const t0 = Date.now();
  assert.throws(() => renameRetrying("a.new", "a", always.rename, "win32"), { code: "EPERM" });
  assert.equal(always.calls(), 8);
  assert.ok(Date.now() - t0 < 3000);
  const other = failing(["ENOENT"]);
  assert.throws(() => renameRetrying("a.new", "a", other.rename, "win32"), { code: "ENOENT" });
  assert.equal(other.calls(), 1);
  const mac = failing(["EPERM"]);
  assert.throws(() => renameRetrying("a.new", "a", mac.rename, "darwin"), { code: "EPERM" });
  assert.equal(mac.calls(), 1);
});
