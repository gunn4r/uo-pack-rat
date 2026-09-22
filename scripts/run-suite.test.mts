// run-suite.test.mts — scripts/run-suite.mts, the counting half of the test runner, driven against
// throwaway test files written into a temp directory. Every other claim in the repo rests on the
// summary this produces, so each case here is a way a file could otherwise drop out of the count, or
// a stale green summary could survive, while the run still exits 0. All `[fast]`: each case spawns a
// few tiny child processes and nothing else.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runSuite, type Mode, type Summary } from "./run-suite.mts";

const PASSING = `import { test } from "node:test";
test("[fast] ok one", () => {});
test("[fast] ok two", () => {});
`;

// The suite runs in a plain node process of its own, never from inside this test process. This file
// is itself a node:test child: run() started from here inherits the markers node:test puts on its
// children (the NODE_TEST_CONTEXT variable, and flags such as the outer run's name pattern), and
// under them the inner files report differently or not at all, so these cases would prove nothing
// about the real runner. The driver prints the summary as JSON on its last line.
const RUN_SUITE_URL = new URL("./run-suite.mts", import.meta.url).href;

// `timeout` and `watchdogMs` are runSuite's own options, shortened so a hung file costs well under a
// second here instead of the real runner's minutes.
function suiteOver(sources: Record<string, string>, mode: Mode = "full", { timeout, watchdogMs = 500 }: { timeout?: number; watchdogMs?: number } = {}): Summary {
  const dir = mkdtempSync(join(tmpdir(), "packrat-run-suite-"));
  try {
    const files = Object.entries(sources).map(([name, source]) => {
      const p = join(dir, name);
      writeFileSync(p, source);
      return p;
    });
    const driver = `import { runSuite } from ${JSON.stringify(RUN_SUITE_URL)};
const s = await runSuite({ root: ${JSON.stringify(dir)}, mode: ${JSON.stringify(mode)}, timeout: ${JSON.stringify(timeout ?? null)} ?? undefined, watchdogMs: ${watchdogMs}, prepare: () => ${JSON.stringify(files)} });
console.log(JSON.stringify(s));`;
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    // A file, not `node -e`: run() hands its own execArgv to every child it starts, and a -e script
    // would ride along into each of them.
    const driverPath = join(dir, "driver.mts");
    writeFileSync(driverPath, driver);
    const r = spawnSync(process.execPath, [driverPath], { encoding: "utf8", env, timeout: 60_000 });
    const last = r.stdout.trim().split("\n").pop() ?? "";
    assert.ok(last.startsWith("{"), `the driver printed no summary (status ${r.status}): ${r.stderr.slice(-600)}`);
    return JSON.parse(last) as Summary;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("[fast] a file that exits with code 0 part-way through is a failure, not a file that vanished", () => {
  // The review's own probe: node:test reports nothing at all for this file except a synthetic pass
  // for the file wrapper — c1's pass, the exit and c3 are all lost.
  const s = suiteOver({
    "ok.test.mts": PASSING,
    "exits.test.mts": `import { test } from "node:test";
test("[fast] c1 passes", () => {});
test("[fast] c2 exits the process", () => { process.exit(0); });
test("[fast] c3 never runs", () => {});
`,
  });
  assert.equal(s.passed, 2, "the healthy file's two tests still count");
  assert.equal(s.failed, 1);
  assert.equal(s.failures[0]?.file, "exits.test.mts");
  assert.equal(s.failures[0]?.test_name, "file stopped before its tests finished");
});

test("[fast] a file that exits after some of its tests have already reported is still a failure", () => {
  // The quieter shape: the first test's pass does arrive, so the file does not look empty, but the
  // exit swallows the rest without any event.
  const s = suiteOver({
    "late-exit.test.mts": `import { test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
test("[fast] first", async () => { await sleep(50); });
test("[fast] second exits", async () => { await sleep(50); process.exit(0); });
test("[fast] third", () => {});
`,
  });
  assert.equal(s.passed, 1);
  assert.equal(s.failed, 1);
  assert.equal(s.failures[0]?.test_name, "file stopped before its tests finished");
});

test("[fast] a module that exits on import fails the file that imports it", () => {
  const s = suiteOver({ "exits-on-import.test.mts": `process.exit(0);\n` });
  assert.equal(s.failed, 1);
  assert.equal(s.failures[0]?.test_name, "file stopped before its tests finished");
});

test("[fast] a file whose tests are all filtered out by the mode is not a failure", () => {
  const s = suiteOver({
    "ok.test.mts": PASSING,
    "slow-only.test.mts": `import { test } from "node:test";\ntest("[slow] exhaustive", () => {});\n`,
  }, "fast");
  assert.deepEqual([s.total, s.passed, s.failed], [2, 2, 0], JSON.stringify(s.failures));
});

test("[fast] a file that fails to load records the real cause from its stderr, not just \"test failed\"", () => {
  const s = suiteOver({ "broken.test.mts": `throw new Error("late boom at import");\n` });
  assert.equal(s.failed, 1);
  assert.equal(s.failures[0]?.test_name, "file failed to load");
  assert.match(s.failures[0]?.error ?? "", /late boom at import/);
});

test("[fast] a failing test counts once, with its own name", () => {
  const s = suiteOver({
    "one-bad.test.mts": `import { test } from "node:test";
test("[fast] fine", () => {});
test("[fast] broken", () => { throw new Error("nope"); });
`,
  });
  assert.deepEqual([s.total, s.passed, s.failed], [2, 1, 1]);
  assert.equal(s.failures[0]?.test_name, "[fast] broken");
  assert.match(s.failures[0]?.error ?? "", /nope/);
});

test("[fast] a run where nothing ran is a failure, not 0/0 passed", () => {
  const s = suiteOver({ "slow-only.test.mts": `import { test } from "node:test";\ntest("[slow] exhaustive", () => {});\n` }, "smoke");
  assert.equal(s.failed, 1);
  assert.match(s.failures[0]?.error ?? "", /no tests ran in smoke mode/);
});

test("[fast] a build failure before the tests is recorded as a failure with the build's own message", async () => {
  // No child process needed here: prepare throws before run() is ever called.
  const s = await runSuite({ root: tmpdir(), mode: "full", prepare: () => { throw new Error("app/ui/app.mts(3,1): error TS2304"); } });
  assert.equal(s.failed, 1);
  assert.equal(s.failures[0]?.test_name, "test runner");
  assert.match(s.failures[0]?.error ?? "", /TS2304/);
});

test("[fast] a hung test fails on the timeout instead of blocking the run", () => {
  // The interval it leaves behind would also keep the file's process alive after the timeout, which on
  // Node 24 (per-test timeout) is the watchdog's job; Node 22 times the whole file out and kills it.
  const s = suiteOver({ "hangs.test.mts": `import { test } from "node:test";\ntest("[fast] hangs", () => new Promise(() => { setInterval(() => {}, 1000); }));\n` }, "full", { timeout: 300 });
  assert.ok(s.failed >= 1, JSON.stringify(s.failures));
  assert.ok(s.failures.every((f) => f.file === "hangs.test.mts"), JSON.stringify(s.failures));
  // Node 24 names the test; Node 22 applies the timeout to the whole file and names that.
  assert.ok(s.failures.some((f) => ["[fast] hangs", "file timed out"].includes(f.test_name) && /timed out/.test(f.error)), JSON.stringify(s.failures));
});

test("[fast] a file that leaves a handle open after its tests pass is stopped and named, not waited on for ever", () => {
  const s = suiteOver({ "leaks.test.mts": `import { test } from "node:test";\ntest("[fast] leaks an interval", () => { setInterval(() => {}, 1000); });\n` });
  assert.equal(s.passed, 1, "the test itself passed");
  assert.equal(s.failed, 1, JSON.stringify(s.failures));
  assert.equal(s.failures[0]?.test_name, "file kept running after its tests finished");
});

test("[fast] an error thrown after a test returned fails the file", () => {
  // A timer that throws once its test has already been reported as passing: node:test can only charge
  // it to the file, which is why nothing may cut a file short the moment its last test returns.
  const s = suiteOver({
    "late-throw.test.mts": `import { test } from "node:test";\ntest("[fast] returns first", () => { setTimeout(() => { throw new Error("late boom after return"); }, 20); });\n`,
  });
  assert.equal(s.passed, 1);
  assert.equal(s.failed, 1, JSON.stringify(s.failures));
  assert.equal(s.failures[0]?.test_name, "file failed after its tests finished");
  assert.match(s.failures[0]?.error ?? "", /late boom after return/);
});

test("[fast] a promise rejected after a test returned fails the file", () => {
  const s = suiteOver({
    "late-reject.test.mts": `import { test } from "node:test";\ntest("[fast] returns first", () => { void Promise.reject(new Error("late rejection")); });\n`,
  });
  assert.equal(s.failed, 1, JSON.stringify(s.failures));
  assert.equal(s.failures[0]?.test_name, "file failed after its tests finished");
  assert.match(s.failures[0]?.error ?? "", /late rejection/);
});

test("[fast] a failing exit code set by a passing test fails the file, and says so", () => {
  const s = suiteOver({ "exit-code.test.mts": `import { test } from "node:test";\ntest("[fast] sets it", () => { process.exitCode = 3; });\n` });
  assert.equal(s.failed, 1, JSON.stringify(s.failures));
  assert.equal(s.failures[0]?.test_name, "file failed after its tests finished");
});

test("[fast] process.exit(1) part-way through is a file that stopped early, not a load failure", () => {
  const s = suiteOver({
    "exit-one.test.mts": `import { test } from "node:test";\ntest("[fast] fine", () => {});\ntest("[fast] exits", () => { process.exit(1); });\ntest("[fast] never", () => {});\n`,
  });
  assert.equal(s.failed, 1, JSON.stringify(s.failures));
  assert.equal(s.failures[0]?.test_name, "file stopped before its tests finished");
});

test("[fast] a file with no tests in it fails with that diagnosis in a full run", () => {
  const s = suiteOver({ "ok.test.mts": PASSING, "empty.test.mts": `// forgot the tests\n` });
  assert.equal(s.failed, 1, JSON.stringify(s.failures));
  assert.equal(s.failures[0]?.file, "empty.test.mts");
  assert.equal(s.failures[0]?.test_name, "file registered no tests");
});
