#!/usr/bin/env node
// test-runner.mts — the project's standard test interface.
//   node scripts/test-runner.mts [--smoke|--fast]      (full when no flag)
// Drives node:test's run() over every **/*.test.mts found by a recursive walk of app/ + scripts/
// (node_modules/dist/fixtures excluded) and writes test_logs/latest_summary.json. Tags are name
// prefixes: [smoke] [fast] [slow]. TEST_SKIP_SLOW=1 skips the [slow] cases (see individual files).
// The counting itself lives in scripts/run-suite.mts, where scripts/run-suite.test.mts can prove it.
//
// The adapters' Python tests are not spawned from here any more. This file used to run
// adapters/tazuo/test_paths.py by name; app/adapters.test.mts now walks adapters/ for every
// test_*.py and runs each one as a [fast] node:test case with the same `python3 -W error` (and the
// same probe for python3-then-python), skipping with a note when neither is on PATH. That covers the
// same file in the same modes, counts into the same summary, and picks up a new adapter's tests with
// no edit here — so the copy that lived in this file was doing nothing the suite wasn't.
import { writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildUi } from "./build-ui.mts";
import { buildSchemaTypes } from "./build-schema-types.mts";
import { runSuite, type Mode } from "./run-suite.mts";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const mode: Mode = process.argv.includes("--smoke") ? "smoke" : process.argv.includes("--fast") ? "fast" : "full";
// Node 24 applies it to each test and Node 22 to each file as a whole. It sits well below CI's
// 20-minute job timeout, so a hang in CI still ends in a written summary naming the hung test or file
// (the job being killed would write nothing), and far above anything the suite needs: the whole full
// run takes a few minutes, its slowest file well under one.
const TEST_TIMEOUT_MS = 12 * 60 * 1000;

// Recursive so a test file in a new subdirectory (app/schema/validate.test.mts was the one this
// missed) is picked up automatically — a hard-coded third/fourth top-level directory is what
// created that hole, and would only postpone the next one. node_modules is a defensive exclusion
// (none exists under app/ or scripts/ today); dist is generated build output that must never be
// walked; fixtures holds test INPUT data (JSON fixtures consumed by tests), never tests themselves.
const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e): string[] => {
  const p = join(dir, e.name);
  if (e.isDirectory()) return e.name === "node_modules" || e.name === "dist" || e.name === "fixtures" ? [] : walk(p);
  return e.name.endsWith(".test.mts") ? [p] : [];
});

// The house rule is to read test_logs/latest_summary.json for results, never raw console output — so
// every failure, the builds included, has to end up in a freshly written summary rather than leave
// the previous (possibly green) one on disk. That is why the builds run inside runSuite's `prepare`.
const summary = await runSuite({
  root: ROOT,
  mode,
  timeout: TEST_TIMEOUT_MS,
  prepare: () => {
    // Build the schema types before buildUi() — this call, not tsconfig.browser.json's `include` (a
    // missing literal entry there is silently dropped, not an error), is what actually guarantees
    // app/schema/types.d.mts exists before anything imports from it. The optimizer core needs no
    // build step — every caller imports scripts/optimizer-core.mts straight from source.
    buildSchemaTypes();
    buildUi();   // app/server.test.mts's [smoke] cases fetch app/dist/item-query.mjs and the page itself
    return ["app", "scripts"].flatMap((d) => walk(join(ROOT, d)));
  },
});
mkdirSync(join(ROOT, "test_logs"), { recursive: true });
writeFileSync(join(ROOT, "test_logs", "latest_summary.json"), JSON.stringify(summary, null, 2) + "\n");
console.log(`${mode}: ${summary.passed}/${summary.total} passed, ${summary.failed} failed, ${summary.skipped} skipped`);
for (const f of summary.failures) console.log(`  FAIL ${f.file} ${f.test_name}: ${f.error}`);
process.exit(summary.failed ? 1 : 0);
