import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, statSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { buildCore } from "./build-core.mjs";

test("[smoke] buildCore strips types and exposes the optimizer's exports", async () => {
  const out = buildCore();
  const core = await import(pathToFileURL(out).href + "?t=" + Date.now());
  for (const k of ["scoreSet", "optimizeSuit", "optDefaultSlots", "optBuildSpace", "optDominancePrune"]) assert.equal(typeof core[k], "function", k);
  assert.ok(!/: number\b|interface /.test(readFileSync(out, "utf8")), "no TypeScript left");
});
test("[fast] buildCore rebuilds only when the source is newer", () => {
  const dir = mkdtempSync(join(tmpdir(), "core-"));
  const src = join(dir, "c.ts"), out = join(dir, "c.mjs");
  writeFileSync(src, "function f(x: number): number { return x; }\nexport { f };\n");
  buildCore({ src, out }); const first = statSync(out).mtimeMs;
  buildCore({ src, out }); assert.equal(statSync(out).mtimeMs, first, "untouched when up to date");
  // Back-date the output well into the past before forcing the rebuild below. Windows' file-mtime
  // write resolution is coarser than macOS/Linux (APFS/ext4 report sub-millisecond timestamps;
  // NTFS writes through Node can land on the same ~tens-of-ms tick), so the initial build above and
  // the rebuild's write can come back with an IDENTICAL mtimeMs there even though two real writes
  // happened — a multi-second gap makes the "did it actually rewrite the file" check below
  // resolution-independent on every platform, rather than racing the OS clock.
  utimesSync(out, new Date(Date.now() - 60000), new Date(Date.now() - 60000));
  const stale = statSync(out).mtimeMs;
  utimesSync(src, new Date(), new Date(Date.now() + 5000));
  buildCore({ src, out }); assert.notEqual(statSync(out).mtimeMs, stale, "rebuilt when source is newer");
});
