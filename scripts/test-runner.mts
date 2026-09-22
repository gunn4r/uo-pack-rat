#!/usr/bin/env node
// test-runner.mts — the project's standard test interface.
//   node scripts/test-runner.mts [--smoke|--fast]      (full when no flag)
// Drives node:test's run() over every **/*.test.mts found by a recursive walk of app/ + scripts/
// (node_modules/dist/fixtures excluded) and writes test_logs/latest_summary.json. Tags are name
// prefixes: [smoke] [fast] [slow]. TEST_SKIP_SLOW=1 skips the [slow] cases (see individual files).
//
// The adapters' Python tests are not spawned from here any more. This file used to run
// adapters/tazuo/test_paths.py by name; app/adapters.test.mts now walks adapters/ for every
// test_*.py and runs each one as a [fast] node:test case with the same `python3 -W error` (and the
// same probe for python3-then-python), skipping with a note when neither is on PATH. That covers the
// same file in the same modes, counts into the same summary, and picks up a new adapter's tests with
// no edit here — so the copy that lived in this file was doing nothing the suite wasn't.
import { run } from "node:test";
import type { test as NodeTest } from "node:test";
import { writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { buildUi } from "./build-ui.mts";
import { buildSchemaTypes } from "./build-schema-types.mts";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const mode = process.argv.includes("--smoke") ? "smoke" : process.argv.includes("--fast") ? "fast" : "full";
const patterns = mode === "smoke" ? [/^\[smoke\]/] : mode === "fast" ? [/^\[(smoke|fast)\]/] : undefined;
// Build the schema types before buildUi() — this call, not tsconfig.browser.json's `include` (a
// missing literal entry there is silently dropped, not an error), is what actually guarantees
// app/schema/types.d.mts exists before anything imports from it. The optimizer core needs no build
// step — every caller imports scripts/optimizer-core.mts straight from source.
buildSchemaTypes();
buildUi();   // app/server.test.mts's [smoke] cases fetch app/dist/item-query.mjs and the page itself

// Recursive so a test file in a new subdirectory (app/schema/validate.test.mts was the one this
// missed) is picked up automatically — a hard-coded third/fourth top-level directory is what
// created that hole, and would only postpone the next one. node_modules is a defensive exclusion
// (none exists under app/ or scripts/ today); dist is generated build output that must never be
// walked; fixtures holds test INPUT data (JSON fixtures consumed by tests), never tests themselves.
//
// Only *.test.mts now — every test file in the repo finished its .mjs -> .mts migration in this
// same phase (scripts/make-adapter-fixture.mts and friends were the last non-test .mjs files, and
// the ONLY *.test.mjs the walk ever found were this project's own), so the .test.mjs arm this walk
// used to carry is dead code; `git ls-files '*.test.mjs'` prints nothing, confirming it.
const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e): string[] => {
  const p = join(dir, e.name);
  if (e.isDirectory()) return e.name === "node_modules" || e.name === "dist" || e.name === "fixtures" ? [] : walk(p);
  return e.name.endsWith(".test.mts") ? [p] : [];
});
const files = ["app", "scripts"].flatMap((d) => walk(join(ROOT, d)));
let total = 0, passed = 0, failed = 0, skipped = 0; const failures: { file: string; line: number; test_name: string; error: string }[] = [];

// A file whose tests are ALL excluded by testNamePatterns still emits one synthetic PASS for the
// file itself (nesting: 0, same as a real test — the nesting check alone doesn't catch it), with
// its name set to its own absolute path. Filter that out of test:pass so an empty file doesn't count
// as a test. But the same shape (name === file) also shows up on test:fail when the file itself
// failed to load (syntax error, a throwing top-level import, etc.) — that MUST still count as a
// failure, or a broken test file silently vanishes (not counted, not in failures[], exit 0). So the
// guard only applies to test:pass; test:fail always counts.
// A `{ todo: "..." }` test reports through test:pass when it passes and test:fail when it throws
// (unlike the CLI reporter, which buckets both outcomes as "todo" and never fails the run) — fold
// both into skipped here so a todo case can neither pass nor block the suite.
const isFileWrapper = (t: { name: string; file?: string | undefined }): boolean => t.name === t.file;

// The house rule is to read test_logs/latest_summary.json for results, never raw console output — so
// a thrown run() (a bad node:test option, an unexpected stream error, …) must still overwrite the
// previous (possibly green) summary with a failing one, instead of leaving stale results on disk.
// Everything that can throw between here and the write lives in this try; the write itself lives in
// the finally so it runs on every path, success or failure.
try {
  const stream = run({ files, testNamePatterns: patterns, concurrency: 1 });
  stream.on("test:pass", (t: NodeTest.EventData.TestPass) => { if (t.nesting > 0 || isFileWrapper(t)) return; total++; if (t.skip || t.todo) skipped++; else passed++; });
  stream.on("test:fail", (t: NodeTest.EventData.TestFail) => {
    if (t.nesting > 0) return;
    if (t.todo && !isFileWrapper(t)) { total++; skipped++; return; }
    total++; failed++;
    const name = isFileWrapper(t) ? "file failed to load" : t.name;
    failures.push({ file: relative(ROOT, t.file || ""), line: t.line || 0, test_name: name, error: String(t.details?.error?.message || t.details?.error || "failed").slice(0, 600) });
  });
  stream.on("test:stderr", (m: NodeTest.EventData.TestStderr) => process.stderr.write(m.message));
  // The TestsStream must actually be drained for its "test:pass"/"test:fail" events to flow — awaiting
  // only a terminal "end"/"summary" event without consuming the stream leaves run() stalled.
  for await (const _chunk of stream) { /* events are handled by the listeners above */ }
  // tests filtered out by the name pattern are neither run nor counted by node:test; this runner's
  // summary only reports what node:test actually ran (skipped[] here means `skip: true` tests, e.g. [slow]
  // cases under TEST_SKIP_SLOW — not tests a --smoke/--fast pattern excluded entirely).
} catch (e) {
  total++; failed++;
  const err = e as { stack?: unknown };
  failures.push({ file: "scripts/test-runner.mts", line: 0, test_name: "test runner", error: String((e && err.stack) || e).slice(0, 600) });
} finally {
  mkdirSync(join(ROOT, "test_logs"), { recursive: true });
  const summary = { timestamp: new Date().toISOString(), mode, total, passed, failed, skipped, failures };
  writeFileSync(join(ROOT, "test_logs", "latest_summary.json"), JSON.stringify(summary, null, 2) + "\n");
  console.log(`${mode}: ${passed}/${total} passed, ${failed} failed, ${skipped} skipped`);
  for (const f of failures) console.log(`  FAIL ${f.file} ${f.test_name}: ${f.error}`);
}
process.exit(failed ? 1 : 0);
