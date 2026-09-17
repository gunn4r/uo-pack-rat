#!/usr/bin/env node
// test-runner.mjs — the project's standard test interface.
//   node scripts/test-runner.mjs [--smoke|--fast]      (full when no flag)
// Drives node:test's run() over app/*.test.mjs + scripts/*.test.mjs, spawns the Python adapter test
// (fast + full modes only), and writes test_logs/latest_summary.json. Tags are name prefixes:
// [smoke] [fast] [slow]. TEST_SKIP_SLOW=1 skips the [slow] cases (see individual test files).
import { run } from "node:test";
import { writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { buildCore } from "./build-core.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const mode = process.argv.includes("--smoke") ? "smoke" : process.argv.includes("--fast") ? "fast" : "full";
const patterns = mode === "smoke" ? [/^\[smoke\]/] : mode === "fast" ? [/^\[(smoke|fast)\]/] : undefined;
buildCore();

const files = ["app", "scripts"].flatMap((d) => readdirSync(join(ROOT, d)).filter((f) => f.endsWith(".test.mjs")).map((f) => join(ROOT, d, f)));
let total = 0, passed = 0, failed = 0, skipped = 0; const failures = [];

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
const isFileWrapper = (t) => t.name === t.file;

// The house rule is to read test_logs/latest_summary.json for results, never raw console output — so
// a thrown run() (a bad node:test option, an unexpected stream error, …) must still overwrite the
// previous (possibly green) summary with a failing one, instead of leaving stale results on disk.
// Everything that can throw between here and the write lives in this try; the write itself lives in
// the finally so it runs on every path, success or failure.
try {
  const stream = run({ files, testNamePatterns: patterns, concurrency: 1 });
  stream.on("test:pass", (t) => { if (t.nesting > 0 || isFileWrapper(t)) return; total++; if (t.skip || t.todo) skipped++; else passed++; });
  stream.on("test:fail", (t) => {
    if (t.nesting > 0) return;
    if (t.todo && !isFileWrapper(t)) { total++; skipped++; return; }
    total++; failed++;
    const name = isFileWrapper(t) ? "file failed to load" : t.name;
    failures.push({ file: relative(ROOT, t.file || ""), line: t.line || 0, test_name: name, error: String(t.details?.error?.message || t.details?.error || "failed").slice(0, 600) });
  });
  stream.on("test:stderr", (m) => process.stderr.write(m.message));
  // The TestsStream must actually be drained for its "test:pass"/"test:fail" events to flow — awaiting
  // only a terminal "end"/"summary" event without consuming the stream leaves run() stalled.
  for await (const _chunk of stream) { /* events are handled by the listeners above */ }
  // tests filtered out by the name pattern are neither run nor counted by node:test; this runner's
  // summary only reports what node:test actually ran (skipped[] here means `skip: true` tests, e.g. [slow]
  // cases under TEST_SKIP_SLOW — not tests a --smoke/--fast pattern excluded entirely).

  if (mode !== "smoke") runPython();
} catch (e) {
  total++; failed++;
  failures.push({ file: "scripts/test-runner.mjs", line: 0, test_name: "test runner", error: String((e && e.stack) || e).slice(0, 600) });
} finally {
  mkdirSync(join(ROOT, "test_logs"), { recursive: true });
  const summary = { timestamp: new Date().toISOString(), mode, total, passed, failed, skipped, failures };
  writeFileSync(join(ROOT, "test_logs", "latest_summary.json"), JSON.stringify(summary, null, 2) + "\n");
  console.log(`${mode}: ${passed}/${total} passed, ${failed} failed, ${skipped} skipped`);
  for (const f of failures) console.log(`  FAIL ${f.file} ${f.test_name}: ${f.error}`);
}
process.exit(failed ? 1 : 0);

function runPython() {
  const cmds = ["python3", "python"];
  const py = cmds.find((c) => { const r = spawnSync(c, ["--version"], { encoding: "utf8" }); return !r.error && /^Python 3/.test((r.stdout || "") + (r.stderr || "")); });
  total++;
  if (!py) { skipped++; console.log("  SKIP adapters/tazuo/test_paths.py (no python3/python on PATH)"); return; }
  const r = spawnSync(py, ["-W", "error", join(ROOT, "adapters", "tazuo", "test_paths.py")], { encoding: "utf8" });
  if (r.status === 0) passed++; else { failed++; failures.push({ file: "adapters/tazuo/test_paths.py", line: 0, test_name: "adapter path tests", error: (r.stderr || r.stdout).slice(-600) }); }
}
