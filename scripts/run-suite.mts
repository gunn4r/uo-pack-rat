// run-suite.mts — the counting half of scripts/test-runner.mts: build, discover, drive node:test's
// run() over the files, and fold its event stream into the summary shape TESTING.md documents. It
// lives apart from the entry point so scripts/run-suite.test.mts can drive it against throwaway test
// files in a temp directory, which is the only way to prove the runner counts what it claims to. The
// entry point owns the process: writing test_logs/latest_summary.json, printing, the exit code.
import { run } from "node:test";
import type { test as NodeTest } from "node:test";
import { resolve, relative, sep } from "node:path";

export type Mode = "smoke" | "fast" | "full";
export interface Failure { file: string; line: number; test_name: string; error: string }
export interface Summary { timestamp: string; mode: Mode; total: number; passed: number; failed: number; skipped: number; failures: Failure[] }

export interface SuiteOptions {
  root: string;
  mode: Mode;
  // Everything that runs before the tests (the schema-types and page builds, then discovery). It is a
  // callback rather than work done by the caller so a failure in it lands in the summary like any
  // other: a tsc error in app/ui must never leave the previous run's green summary on disk.
  prepare: () => string[];
  // Per test, in ms. A hung test fails with its own name instead of blocking the run for ever.
  // Left out, node:test applies no limit.
  timeout?: number | undefined;
}

export const patternsFor = (mode: Mode): RegExp[] | undefined =>
  mode === "smoke" ? [/^\[smoke\]/] : mode === "fast" ? [/^\[(smoke|fast)\]/] : undefined;

// The summary is read on every platform, and path.relative gives backslashes on Windows.
const posixRelative = (root: string, file: string): string => relative(root, file).split(sep).join("/");

const ERROR_CAP = 600;

// A file whose tests are ALL excluded by testNamePatterns still emits one synthetic PASS for the
// file itself (nesting: 0, same as a real test — the nesting check alone doesn't catch it), with its
// name set to its own absolute path. Filter that out of test:pass so an empty file doesn't count as
// a test. The same shape (name === file) also shows up on test:fail when the file itself failed to
// load (syntax error, a throwing top-level import, a non-zero process.exit) — that MUST still count.
const isFileWrapper = (t: { name: string; file?: string | undefined }): boolean => t.name === t.file;

export async function runSuite({ root, mode, prepare, timeout }: SuiteOptions): Promise<Summary> {
  let total = 0, passed = 0, failed = 0, skipped = 0;
  const failures: Failure[] = [];
  const fail = (file: string, line: number, test_name: string, error: string): void => {
    total++; failed++;
    failures.push({ file, line, test_name, error: error.slice(0, ERROR_CAP) });
  };
  try {
    const files = prepare().map((f) => resolve(f));
    // A file that runs to completion always ends with a test:summary carrying its own path, whether
    // its tests passed, failed or were all filtered out. One that stops part-way (a process.exit(0)
    // in a test or in a module it imports) sends no summary, and often nothing else either: the tests
    // that had already passed, the one that exited and every one after it just never report. So the
    // summary is the only proof a file finished, and a file without one is a failure.
    const finished = new Set<string>();
    const failedToLoad = new Set<string>();
    // stderr is echoed as it arrives, and the tail is kept per file: a file that fails to load
    // reports only "test failed" through the event, and the real cause (ERR_MODULE_NOT_FOUND, the
    // thrown message) is on its stderr.
    const stderrTail = new Map<string, string>();
    // forceExit ends each file once its tests are done even if a handle is still open. Without it the
    // per-test timeout fails a hung test and then the file hangs anyway, on whatever that test left
    // running.
    const stream = run({ files, testNamePatterns: patternsFor(mode), concurrency: 1, timeout, forceExit: true });
    stream.on("test:pass", (t: NodeTest.EventData.TestPass) => { if (t.nesting > 0 || isFileWrapper(t)) return; total++; if (t.skip || t.todo) skipped++; else passed++; });
    stream.on("test:fail", (t: NodeTest.EventData.TestFail) => {
      if (t.nesting > 0) return;
      // A `{ todo: "..." }` test reports through test:fail when it throws (unlike the CLI reporter,
      // which buckets it as "todo" and never fails the run) — fold it into skipped so a todo case can
      // neither pass nor block the suite.
      if (t.todo && !isFileWrapper(t)) { total++; skipped++; return; }
      const file = t.file ? resolve(t.file) : "";
      const eventError = String(t.details?.error?.message || t.details?.error || "failed");
      if (isFileWrapper(t)) {
        failedToLoad.add(file);
        fail(posixRelative(root, file), t.line || 0, "file failed to load", stderrTail.get(file)?.trim() || eventError);
      } else {
        fail(posixRelative(root, file), t.line || 0, t.name, eventError);
      }
    });
    stream.on("test:stderr", (m: NodeTest.EventData.TestStderr) => {
      process.stderr.write(m.message);
      const file = resolve(m.file);
      stderrTail.set(file, ((stderrTail.get(file) ?? "") + m.message).slice(-ERROR_CAP));
    });
    stream.on("test:summary", (s: NodeTest.EventData.TestSummary) => { if (s.file) finished.add(resolve(s.file)); });
    // The TestsStream must actually be drained for its events to flow — awaiting only a terminal
    // "end"/"summary" event without consuming the stream leaves run() stalled.
    for await (const _chunk of stream) { /* events are handled by the listeners above */ }
    for (const file of files) {
      if (finished.has(file) || failedToLoad.has(file)) continue;
      fail(posixRelative(root, file), 0, "file stopped before its tests finished", "no end-of-file summary from node:test: the process exited part-way (a process.exit() in a test or in a module it imports?), so some of its tests never reported");
    }
    // Tests filtered out by the name pattern are neither run nor counted by node:test, so a run can
    // legitimately skip whole files. It can never legitimately run nothing at all: that is a pattern
    // or discovery mistake, and a summary reading 0/0 must not read as green.
    if (total === 0) fail("scripts/test-runner.mts", 0, "test runner", `no tests ran in ${mode} mode (${files.length} files discovered)`);
  } catch (e) {
    const err = e as { stack?: unknown };
    fail("scripts/test-runner.mts", 0, "test runner", String((e && err.stack) || e));
  }
  return { timestamp: new Date().toISOString(), mode, total, passed, failed, skipped, failures };
}
