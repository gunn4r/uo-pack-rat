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

// Only the fields these cases rewrite; the rest of the shipped fixture passes through untouched.
interface EditableScan {
  character: string;
  account?: string | undefined;
  adapter: Record<string, unknown>;
  roots: { name: string }[];
  items: { name: string }[];
}

// The shipped TazUO fixture, reworked by `edit` into the "real scan" a case needs.
function withScan(edit: (scan: EditableScan) => void, body: (inPath: string, outPath: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "packrat-make-fixture-"));
  try {
    const scan = JSON.parse(readFileSync(TAZUO_FIXTURE, "utf8")) as EditableScan;
    edit(scan);
    const inPath = join(dir, "real.scan.json");
    writeFileSync(inPath, JSON.stringify(scan));
    body(inPath, join(dir, "fixture.scan.json"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const RAZOR_CAPS = JSON.parse(readFileSync(join(ROOT, "adapters", "razor-enhanced", "capabilities.json"), "utf8")) as { adapter: string; version: string; capabilities: unknown };

test("[fast] the fixture carries the identity of the adapter that produced the scan, not TazUO's", () => {
  withScan((scan) => {
    scan.adapter = { id: "razor-enhanced", version: "0.0.1", client: "Razor Enhanced", clientVersion: "0.8.2.242", capabilities: RAZOR_CAPS.capabilities };
  }, (inPath, outPath) => {
    const r = run(inPath, outPath);
    assert.equal(r.status, 0, `expected exit 0, stderr: ${r.stderr}`);
    const adapter = (JSON.parse(readFileSync(outPath, "utf8")) as { adapter: Record<string, unknown> }).adapter;
    assert.equal(adapter.id, "razor-enhanced");
    assert.equal(adapter.client, "Razor Enhanced", "the scan's own client name is kept");
    // Version and capabilities come from the adapter's capabilities.json as it ships today, which is
    // what app/contracts.test.mts compares the fixture against.
    assert.equal(adapter.version, RAZOR_CAPS.version);
    assert.deepEqual(adapter.capabilities, RAZOR_CAPS.capabilities);
  });
});

test("[fast] a scan from an adapter this repository does not ship is refused", () => {
  withScan((scan) => { scan.adapter.id = "no-such-adapter"; }, (inPath, outPath) => {
    const r = run(inPath, outPath);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /adapters\/no-such-adapter\/capabilities\.json/);
    assert.ok(!existsSync(outPath), "no output file may be written");
  });
});

test("[fast] a fixture that still names the character or the account is refused, naming where", () => {
  withScan((scan) => {
    scan.character = "Somebody";
    // The account is a hashed id in a v2 scan, never the plaintext name, but it is still an identifier.
    scan.account = "0123456789abcdef";
    scan.roots[0]!.name = "SOMEBODY's Backpack";                      // any case
    scan.items[0]!.name = "Pouch 0123456789ABCDEF";
  }, (inPath, outPath) => {
    const r = run(inPath, outPath);
    assert.notEqual(r.status, 0, `the fixture must not be written; stdout: ${r.stdout}`);
    assert.match(r.stderr, /\/roots\/0\/name/);
    assert.match(r.stderr, /\/items\/0\/name/);
    assert.ok(!existsSync(outPath), "no output file may be written");
  });
});
