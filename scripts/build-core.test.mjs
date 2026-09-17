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
  utimesSync(src, new Date(), new Date(Date.now() + 5000));
  buildCore({ src, out }); assert.notEqual(statSync(out).mtimeMs, first, "rebuilt when source is newer");
});
