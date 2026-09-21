// make-adapter-fixture.test.mts — scripts/make-adapter-fixture.mts, run as a real child process
// (the way a maintainer actually invokes it), against temp in/out paths. Covers the fix that makes
// this tool earn its ScanV2 the way app/import.mts and app/watcher.mts do: a real scan the tool turns
// into a committed fixture.scan.json is the first thing two never-run-against-a-live-client adapters
// (Razor Enhanced, the ClassicUO web client) will produce, which is exactly when a malformed scan is
// most likely — and a fixture built from an invalid one would get committed as the adapter's contract.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { validateScan } from "../app/scan-schema.mts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const SCRIPT = join(ROOT, "scripts", "make-adapter-fixture.mts");
const TAZUO_FIXTURE = join(ROOT, "adapters", "tazuo", "fixture.scan.json");   // shipped, valid v2 scan
const DEMO_KESTREL = join(ROOT, "app", "fixtures", "demo-Kestrel.json");     // shipped, valid v1 scan

function run(inPath: string, outPath: string): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [SCRIPT, inPath, outPath], { encoding: "utf8" });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

test("[fast] a valid v2 scan produces a fixture that itself validates", () => {
  const dir = mkdtempSync(join(tmpdir(), "packrat-make-fixture-"));
  try {
    const outPath = join(dir, "fixture.scan.json");
    const r = run(TAZUO_FIXTURE, outPath);
    assert.equal(r.status, 0, `expected exit 0, stderr: ${r.stderr}`);
    assert.ok(existsSync(outPath), "the fixture file must exist");
    const fixture: unknown = JSON.parse(readFileSync(outPath, "utf8"));
    const v = validateScan(fixture);
    assert.equal(v.ok, true, `written fixture failed validateScan: ${JSON.stringify(v.errors)}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("[fast] a version-tagged but malformed scan is refused: non-zero exit, a validation problem on stderr, no output file written", () => {
  const dir = mkdtempSync(join(tmpdir(), "packrat-make-fixture-"));
  try {
    const inPath = join(dir, "bad.scan.json");
    const outPath = join(dir, "fixture.scan.json");
    writeFileSync(inPath, JSON.stringify({ schemaVersion: 2, shard: {} }));
    const r = run(inPath, outPath);
    assert.notEqual(r.status, 0, "a malformed scan must exit non-zero");
    // Required fields missing (character, scannedAt, adapter, stats, roots, containers, items,
    // equipped) and shard given the wrong type ({} instead of string|null) — assert on the schema
    // error naming a real field, not just that stderr is non-empty.
    assert.match(r.stderr, /character/, "stderr should name a missing/invalid field, e.g. \"character\"");
    assert.ok(!existsSync(outPath), "no output file should be written when the input doesn't validate");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("[fast] a valid v1-shaped scan still upgrades and produces a valid fixture", () => {
  const dir = mkdtempSync(join(tmpdir(), "packrat-make-fixture-"));
  try {
    const outPath = join(dir, "fixture.scan.json");
    const r = run(DEMO_KESTREL, outPath);
    assert.equal(r.status, 0, `expected exit 0, stderr: ${r.stderr}`);
    assert.ok(existsSync(outPath), "the fixture file must exist");
    const fixture: unknown = JSON.parse(readFileSync(outPath, "utf8"));
    const v = validateScan(fixture);
    assert.equal(v.ok, true, `written fixture failed validateScan: ${JSON.stringify(v.errors)}`);
    assert.equal((fixture as { schemaVersion: number }).schemaVersion, 2, "the v1 input must have been upgraded to v2");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
