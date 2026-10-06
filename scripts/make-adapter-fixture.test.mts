// make-adapter-fixture.test.mts — `scripts/make-adapter-fixture.mts` run as a real child process, the way a maintainer invokes it, against temp in/out paths.
//
// runs `scripts/make-adapter-fixture.mts` as a real child process against temp in/out paths: a valid v2 scan (`adapters/tazuo/fixture.scan.json`) and a valid v1 scan (`app/fixtures/demo-Kestrel.json`) both exit 0 and produce a fixture that itself passes `validateScan`; a version-tagged but malformed scan (`{schemaVersion: 2, shard: {}}` — missing every other required field, `shard` the wrong type) exits non-zero, names a real missing/invalid field on stderr, and writes no output file. A scan from `razor-enhanced` comes out labelled as that adapter, with its own `client` and the version and capabilities from `adapters/razor-enhanced/capabilities.json`; a scan from an adapter with no `capabilities.json` is refused; and a scan whose character name (any case) or account id survives in a root or item name is refused with those JSON paths on stderr and no file written, as is a single word of a multi-word name ("Aldric" from "Aldric the Bold") while "the" is not. A container's `facet` survives anonymising while its tile becomes `{x: 1, y: 1, z: 0}` (issue #11). Covers the fix that makes this tool earn its `ScanV2` (`validateScan` the upgraded input, and the anonymised fixture it's about to write, before ever reading either as validated or writing the file) the same way `app/import.mts` and `app/watcher.mts` already do — this is the tool that will turn the first real scans from two never-run-against-a-live-client adapters into committed fixtures, exactly when a malformed scan is most likely. All `[fast]`.
//
// A fixture built from an invalid scan would get committed as the adapter's contract.
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
  containers: Record<string, { pos?: Record<string, number> | null }>;
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

test("[fast] each word of a multi-word character name is refused on its own, short words aside", () => {
  withScan((scan) => {
    scan.character = "Aldric the Bold";
    scan.roots[0]!.name = "Aldric's Backpack";           // the first name alone
    scan.items[0]!.name = "bold sword";                   // the last word alone, any case
    scan.items[1]!.name = "the Backpack";                 // "the" joins the name, it is not part of it
  }, (inPath, outPath) => {
    const r = run(inPath, outPath);
    assert.notEqual(r.status, 0, `the fixture must not be written; stdout: ${r.stdout}`);
    assert.match(r.stderr, /\/roots\/0\/name/);
    assert.match(r.stderr, /\/items\/0\/name/);
    assert.doesNotMatch(r.stderr, /\/items\/1\/name/);
    assert.ok(!existsSync(outPath), "no output file may be written");
  });
});

// Organize (issue #11) groups chests by facet: which map a house is on names nobody, so it survives anonymising.
test("[fast] a ground container's facet survives anonymising; its tile does not", () => {
  withScan((scan) => {
    for (const c of Object.values(scan.containers)) if (c.pos) c.pos = { x: 1520, y: 1631, z: 5, facet: 3 };
  }, (inPath, outPath) => {
    const r = run(inPath, outPath);
    assert.equal(r.status, 0, `expected exit 0, stderr: ${r.stderr}`);
    const out = JSON.parse(readFileSync(outPath, "utf8")) as { containers: Record<string, { pos?: unknown }> };
    const placed = Object.values(out.containers).filter((c) => c.pos);
    assert.ok(placed.length > 0, "the fixture has ground containers");
    for (const c of placed) assert.deepEqual(c.pos, { x: 1, y: 1, z: 0, facet: 3 });
  });
});

test("[fast] a house the source scan captured never reaches the fixture: a synthetic house stands in for it, and a scan with none gets none", () => {
  withScan((scan) => {
    (scan as unknown as Record<string, unknown>).house = { facet: 1, capturedAt: "2026-09-30T20:00:00Z", at: { x: 4321, y: 2345 }, tiles: [[1301, 4321, 2345, 7, 0], [100, 4320, 2345, 7, 1]], items: [[0x40001234, 2868, 4321, 2345, 7]], containers: [[0x40001235, 3708, 4321, 2345, 7]] };
  }, (inPath, outPath) => {
    const r = run(inPath, outPath);
    assert.equal(r.status, 0, `expected exit 0, stderr: ${r.stderr}`);
    const text = readFileSync(outPath, "utf8"), out = JSON.parse(text) as { house?: { at: unknown; tiles: number[][] } };
    for (const n of ["4321", "2345", "2026-09-30T20"]) assert.ok(!text.includes(n), `${n} from the real house is in the fixture`);
    assert.deepEqual(out.house!.at, { x: 1, y: 1 });
    assert.ok(!text.includes(String(0x40001235)), "the real house's chest is in the fixture");
    assert.equal(validateScan(JSON.parse(text)).ok, true);
  });
  withScan((scan) => { delete (scan as unknown as Record<string, unknown>).house; }, (inPath, outPath) => {
    assert.equal(run(inPath, outPath).status, 0);
    assert.equal("house" in JSON.parse(readFileSync(outPath, "utf8")), false);
  });
});
