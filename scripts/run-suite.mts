// run-suite.mts — the counting half of scripts/test-runner.mts: build, discover, drive node:test's
// run() over the files, and fold its event stream into the summary shape TESTING.md documents. It
// lives apart from the entry point so scripts/run-suite.test.mts can drive it against throwaway test
// files in a temp directory, which is the only way to prove the runner counts what it claims to. The
// entry point owns the process: writing test_logs/latest_summary.json, printing, the exit code.
import { run } from "node:test";
import type { test as NodeTest } from "node:test";
import { realpathSync } from "node:fs";
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
  // In ms, per test on Node 24 and per file on Node 22 (whose run() applies it to the file as a
  // whole). Either way a hung test fails the run instead of blocking it for ever. Left out, node:test
  // applies no limit.
  timeout?: number | undefined;
  // How long a file's process may keep running after its tests have finished before
  // scripts/test-file-watchdog.mts stops it. Default 10 s.
  watchdogMs?: number | undefined;
}

export const patternsFor = (mode: Mode): RegExp[] | undefined =>
  mode === "smoke" ? [/^\[smoke\]/] : mode === "fast" ? [/^\[(smoke|fast)\]/] : undefined;

// Every path is compared and reported in one canonical form. node:test reports some events under the
// file's real path and others under the path it was given, and the two differ whenever a directory on
// the way is a symlink (macOS's /var -> /private/var holds every temp directory).
const canonical = (p: string): string => {
  try {
    return realpathSync(p);
  } catch {
    return resolve(p);
  }
};
// The summary is read on every platform, and path.relative gives backslashes on Windows.
const posixRelative = (root: string, file: string): string => relative(canonical(root), file).split(sep).join("/");

const ERROR_CAP = 600;

// A file whose tests are ALL excluded by testNamePatterns still emits one synthetic PASS for the
// file itself (nesting: 0, same as a real test — the nesting check alone doesn't catch it), with its
// name set to its own absolute path. Filter that out of test:pass so an empty file doesn't count as
// a test. The same shape (name === file) also shows up on test:fail when the file itself failed (it
// did not load, it exited non-zero, an error fired after its tests) — that MUST still count.
const isFileWrapper = (t: { name: string; file?: string | undefined }): boolean => t.name === t.file;

// Preloaded into every test file's process; see that file for why it exists instead of forceExit.
const WATCHDOG_URL = new URL("./test-file-watchdog.mts", import.meta.url);
// The text scripts/test-file-watchdog.mts writes to a file's stderr when it stops the file.
const WATCHDOG_MARKER = "[pack-rat test watchdog]";

export async function runSuite({ root, mode, prepare, timeout, watchdogMs = 10_000 }: SuiteOptions): Promise<Summary> {
  let total = 0, passed = 0, failed = 0, skipped = 0;
  const failures: Failure[] = [];
  const fail = (file: string, line: number, test_name: string, error: string): void => {
    total++; failed++;
    failures.push({ file, line, test_name, error: error.slice(0, ERROR_CAP) });
  };
  try {
    const files = prepare().map(canonical);
    // A file that runs to completion always sends a test:summary carrying its own path, whether its
    // tests passed, failed or were all filtered out, and its counts say how many top-level tests it
    // registered. That summary is the only proof a file finished.
    const finished = new Map<string, number>();
    // Files that sent at least one top-level result of their own, and files that failed as a whole.
    const reported = new Set<string>();
    const fileFailed = new Set<string>();
    // stderr is echoed as it arrives, and the tail is kept per file: a file-level failure reports only
    // "test failed" through the event, and the real cause (ERR_MODULE_NOT_FOUND, a thrown message, the
    // watchdog's note) is on its stderr.
    const stderrTail = new Map<string, string>();
    // node:test's own per-file notes, kept the same way. An error that fires after its test has
    // returned (a timer that throws, a promise rejected without an await) is only described here: the
    // file then fails as a whole with nothing but "test failed" on the event.
    const diagnostics = new Map<string, string>();
    const keepTail = (tails: Map<string, string>, file: string, text: string): void => {
      tails.set(file, ((tails.get(file) ?? "") + text).slice(-ERROR_CAP));
    };
    const stream = run({
      files, testNamePatterns: patternsFor(mode), concurrency: 1, timeout,
      execArgv: ["--import", `${WATCHDOG_URL.href}?ms=${watchdogMs}`],
    });
    stream.on("test:pass", (t: NodeTest.EventData.TestPass) => {
      if (t.nesting > 0 || isFileWrapper(t)) return;
      if (t.file) reported.add(canonical(t.file));
      total++; if (t.skip || t.todo) skipped++; else passed++;
    });
    stream.on("test:fail", (t: NodeTest.EventData.TestFail) => {
      if (t.nesting > 0) return;
      const file = t.file ? canonical(t.file) : "";
      // A `{ todo: "..." }` test reports through test:fail when it throws (unlike the CLI reporter,
      // which buckets it as "todo" and never fails the run) — fold it into skipped so a todo case can
      // neither pass nor block the suite.
      if (t.todo && !isFileWrapper(t)) { reported.add(file); total++; skipped++; return; }
      const eventError = String(t.details?.error?.message || t.details?.error || "failed");
      if (!isFileWrapper(t)) {
        reported.add(file);
        return fail(posixRelative(root, file), t.line || 0, t.name, eventError);
      }
      // The file itself failed; how decides what the summary calls it.
      fileFailed.add(file);
      const stderr = stderrTail.get(file)?.trim() ?? "";
      const error = t.details?.error as { failureType?: unknown; exitCode?: unknown } | undefined;
      const failureType = error?.failureType;
      let name: string;
      // Node 22 applies run()'s `timeout` to each file as a whole, so a hung test shows up as its file
      // timing out rather than as the test itself (Node 24 reports the test).
      if (failureType === "testTimeoutFailure") name = "file timed out";
      else if (stderr.includes(WATCHDOG_MARKER)) name = "file kept running after its tests finished";
      // Its end-of-file summary already arrived, so every test ran: an error thrown or a promise
      // rejected after a test returned, or a failing process.exitCode.
      else if (finished.has(file)) name = "file failed after its tests finished";
      // Nothing to explain it on stderr is a process.exit(<non-zero>) part-way: the tests it had
      // already passed are lost with it, exactly as with a process.exit(0).
      else if (reported.has(file) || !stderr) name = "file stopped before its tests finished";
      else name = "file failed to load";
      const exitCode = typeof error?.exitCode === "number" && error.exitCode !== 0 ? `exit code ${error.exitCode}` : "";
      const detail = [diagnostics.get(file)?.trim(), stderr, exitCode].filter(Boolean).join("\n");
      fail(posixRelative(root, file), t.line || 0, name, detail || eventError);
    });
    stream.on("test:stderr", (m: NodeTest.EventData.TestStderr) => {
      process.stderr.write(m.message);
      keepTail(stderrTail, canonical(m.file), m.message);
    });
    stream.on("test:diagnostic", (d: NodeTest.EventData.TestDiagnostic) => { if (d.file) keepTail(diagnostics, canonical(d.file), d.message + "\n"); });
    stream.on("test:summary", (s: NodeTest.EventData.TestSummary) => { if (s.file) finished.set(canonical(s.file), s.counts.topLevel); });
    // The TestsStream must actually be drained for its events to flow — awaiting only a terminal
    // "end"/"summary" event without consuming the stream leaves run() stalled.
    for await (const _chunk of stream) { /* events are handled by the listeners above */ }
    for (const file of files) {
      if (fileFailed.has(file)) continue;
      const stderr = stderrTail.get(file)?.trim() ?? "";
      if (stderr.includes(WATCHDOG_MARKER)) {
        fail(posixRelative(root, file), 0, "file kept running after its tests finished", stderr);
      } else if (!finished.has(file)) {
        // One that stops part-way (a process.exit(0) in a test or in a module it imports) sends no
        // summary, and often nothing else either: the tests that had already passed, the one that
        // exited and every one after it just never report.
        fail(posixRelative(root, file), 0, "file stopped before its tests finished", "no end-of-file summary from node:test: the process exited part-way (a process.exit() in a test or in a module it imports?), so some of its tests never reported");
      } else if (mode === "full" && finished.get(file) === 0) {
        // --smoke/--fast can filter out every test in a file, but a full run applies no pattern, so a
        // file that registered nothing is a mistake: a test file with no tests in it.
        fail(posixRelative(root, file), 0, "file registered no tests", "the file ran to the end without registering a single test");
      }
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
