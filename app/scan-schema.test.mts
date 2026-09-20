// scan-schema.test.mts — tests for the scan v2 schema and the v1→v2 upgrade-on-read.
// Tags: [smoke] [fast]. Run: node --test app/scan-schema.test.mts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { upgradeScan, validateScan, parseStamp, TAZUO_V1_CAPS, SCAN_V2_SCHEMA } from "./scan-schema.mts";

const HERE = dirname(fileURLToPath(import.meta.url));
const demoKestrel = JSON.parse(readFileSync(join(HERE, "fixtures", "demo-Kestrel.json"), "utf8"));
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?([+-]\d{2}:\d{2}|Z)$/;

test("[smoke] upgradeScan: a v1 fixture upgrades to a valid v2 doc", () => {
  const up = upgradeScan(demoKestrel, { shard: "uoalive" });
  const v = validateScan(up);
  assert.equal(v.ok, true, JSON.stringify(v.errors));
  assert.equal(up.schemaVersion, 2);
  assert.equal(up.adapter.id, "tazuo");
  assert.ok(up.roots.length > 0);
  assert.ok(up.roots.every((r) => r.opened === true));
  assert.match(up.scannedAt, RFC3339);
  assert.equal(parseStamp(up.scannedAt), new Date(2026, 0, 1, 12, 0, 0).getTime());
});

test("[smoke] upgradeScan: never mutates the raw input", () => {
  const before = JSON.parse(JSON.stringify(demoKestrel));
  upgradeScan(demoKestrel, { shard: "uoalive" });
  assert.deepEqual(demoKestrel, before);
});

test("[smoke] upgradeScan: a v2 doc passes through unchanged except shard stamped", () => {
  const v2doc = {
    schemaVersion: 2, character: "Kestrel", scannedAt: "2026-01-01T12:00:00+00:00",
    adapter: { id: "tazuo", version: "1", client: "TazUO", clientVersion: null, capabilities: TAZUO_V1_CAPS },
    stats: { str: 70 }, equipped: [], roots: [], containers: {}, items: [],
  };
  const up = upgradeScan(v2doc, { shard: "uoalive" });
  assert.equal(up.shard, "uoalive");
  assert.equal(up.character, "Kestrel");
  assert.deepEqual(up.stats, { str: 70 });
  // an already-stamped shard is left alone
  const already = upgradeScan({ ...v2doc, shard: "generic-osi" }, { shard: "uoalive" });
  assert.equal(already.shard, "generic-osi");
});

test("[smoke] upgradeScan: a tombstone (character starting with _) gets adapter.id \"app\"", () => {
  const tomb = { version: 1, character: "_vault", scannedAt: "2026-01-01T00:00:00", stats: {}, equipped: [], roots: [], containers: {}, items: [] };
  const up = upgradeScan(tomb, { shard: "uoalive" });
  assert.equal(up.adapter.id, "app");
  assert.equal(up.schemaVersion, 2);
});

test("[smoke] upgradeScan: a garbage object (neither v1 nor v2) throws TypeError", () => {
  assert.throws(() => upgradeScan({ foo: 1 }, { shard: "uoalive" }), TypeError);
  assert.throws(() => upgradeScan(null, { shard: "uoalive" }), TypeError);
});

test("[fast] upgradeScan: string serials in a v1 file become numbers everywhere", () => {
  const raw = {
    version: 1, character: "Tester", scannedAt: "2026-01-01T12:00:00", stats: {},
    equipped: [{ serial: "10", name: "Ring", tooltip: ["Ring"], amount: 1, container: null, layer: "Ring" }],
    roots: [{ serial: "100", kind: "backpack", name: "Backpack" }],
    containers: { 100: { serial: "100", name: "Backpack", parent: null, root: "100", kind: "backpack" } },
    items: [{ serial: "123", name: "Sword", tooltip: ["Sword"], amount: 1, container: "100" }],
  };
  const up = upgradeScan(raw, { shard: "test" });
  assert.equal(up.items[0]!.serial, 123); assert.equal(typeof up.items[0]!.serial, "number");
  assert.equal(up.items[0]!.container, 100); assert.equal(typeof up.items[0]!.container, "number");
  // containers is Record<string, unknown> in the generated ScanV2 type (the schema only declares its
  // top-level shape, not each entry's) — cast to read the fields upgradeScan() actually puts there.
  const container100 = up.containers["100"] as Record<string, unknown>;
  assert.equal(container100.serial, 100);
  assert.equal(container100.root, 100);
  assert.equal(up.roots[0]!.serial, 100); assert.equal(typeof up.roots[0]!.serial, "number");
  assert.equal(up.equipped[0]!.serial, 10); assert.equal(typeof up.equipped[0]!.serial, "number");
  assert.equal(up.items[0]!.nameSource, "opl");
  assert.equal(up.equipped[0]!.nameSource, "opl");
});

test("[fast] upgradeScan: adapter.capabilities equals TAZUO_V1_CAPS, which lists the 20 v1 scanner layers", () => {
  const up = upgradeScan(demoKestrel, { shard: "uoalive" });
  assert.deepEqual(up.adapter.capabilities, TAZUO_V1_CAPS);
  assert.equal(TAZUO_V1_CAPS.layers.length, 20);
  assert.deepEqual(TAZUO_V1_CAPS.bridge, ["highlight", "grab", "goto"]);
});

test("[fast] the embedded SCAN_V2_SCHEMA matches app/schema/scan.v2.schema.json exactly (served-to-browser modules cannot fs.readFileSync it)", () => {
  const onDisk = JSON.parse(readFileSync(join(HERE, "schema", "scan.v2.schema.json"), "utf8"));
  assert.deepEqual(SCAN_V2_SCHEMA, onDisk);
});

test("[fast] validateScan: a scannedAt with fractional seconds (new Date().toISOString(), what the /api/forget tombstone writes) is valid", () => {
  const doc = {
    schemaVersion: 2, character: "_vault", scannedAt: new Date().toISOString(),
    adapter: { id: "app", version: "1", client: "Pack Rat", clientVersion: null,
      capabilities: { layers: [], arms: false, bank: false, ground: false, nested: false, tooltips: "label", bridge: [] } },
    stats: {}, equipped: [], roots: [{ serial: 1, kind: "ground", name: "x", opened: true }], containers: {}, items: [],
  };
  const v = validateScan(doc);
  assert.equal(v.ok, true, JSON.stringify(v.errors));
});

test("[fast] validateScan: account must be a hashed-looking id (lowercase hex, 16-64 chars), never a plaintext name", () => {
  const base = {
    schemaVersion: 2, character: "Kestrel", scannedAt: new Date().toISOString(),
    adapter: { id: "tazuo", version: "1", client: "TazUO", clientVersion: null, capabilities: TAZUO_V1_CAPS },
    stats: {}, equipped: [], roots: [], containers: {}, items: [],
  };
  const hex64 = "a".repeat(64);
  assert.equal(validateScan({ ...base, account: hex64 }).ok, true);
  assert.equal(validateScan({ ...base, account: "plaintextaccountname" }).ok, false);   // plaintext-shaped, not hex
  assert.equal(validateScan({ ...base }).ok, true);   // still optional
});

test("[fast] parseStamp: a naive local stamp and its RFC 3339 upgrade parse to the same epoch", () => {
  const naive = "2026-03-15T09:30:00";
  const up = upgradeScan({ version: 1, character: "X", scannedAt: naive, stats: {}, equipped: [], roots: [], containers: {}, items: [] }, { shard: "uoalive" });
  assert.equal(parseStamp(naive), parseStamp(up.scannedAt));
});
