// scan-schema.test.mts — tests for the scan v2 schema and the v1→v2 upgrade-on-read.
// Tags: [smoke] [fast]. Run: node --test app/scan-schema.test.mts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { upgradeScan, validateScan, parseStamp, TAZUO_V1_CAPS, SCAN_V2_SCHEMA } from "./scan-schema.mts";
import type { ScanV2 } from "./schema/types.d.mts";

const HERE = dirname(fileURLToPath(import.meta.url));
const demoKestrel = JSON.parse(readFileSync(join(HERE, "fixtures", "demo-Kestrel.json"), "utf8"));
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?([+-]\d{2}:\d{2}|Z)$/;

test("[smoke] upgradeScan: a v1 fixture upgrades to a valid v2 doc", () => {
  const up = upgradeScan(demoKestrel, { shard: "uoalive" }) as ScanV2;   // known-good fixture: the cast stands in for the validateScan() a real caller runs
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
  const up = upgradeScan(tomb, { shard: "uoalive" }) as ScanV2;   // known-good fixture: the cast stands in for the validateScan() a real caller runs
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
  const up = upgradeScan(raw, { shard: "test" }) as ScanV2;   // known-good fixture: the cast stands in for the validateScan() a real caller runs
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
  const up = upgradeScan(demoKestrel, { shard: "uoalive" }) as ScanV2;   // known-good fixture: the cast stands in for the validateScan() a real caller runs
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
  const up = upgradeScan({ version: 1, character: "X", scannedAt: naive, stats: {}, equipped: [], roots: [], containers: {}, items: [] }, { shard: "uoalive" }) as ScanV2;   // known-good fixture: the cast stands in for the validateScan() a real caller runs
  assert.equal(parseStamp(naive), parseStamp(up.scannedAt));
});

// ---- bounds and payload shapes (Phase 7 security review, Area 2) ----------------------------
// The schema used to validate the skeleton and not the payload: stats/maxes/resists/position/skills/
// containers had no `properties` at all, and no string, array or number anywhere had a bound. A scan
// file is attacker-controlled text (another player's "here's my suit" paste), so each of these is a
// value that reached the fold, the page or a filename unchecked.
const bounded = {
  schemaVersion: 2, character: "Kestrel", scannedAt: "2026-01-01T12:00:00Z",
  adapter: { id: "tazuo", version: "1", client: "TazUO", clientVersion: null, capabilities: TAZUO_V1_CAPS },
  stats: { str: 70, dex: 100, int: 40 }, equipped: [], roots: [], containers: {}, items: [],
};
const invalid = (doc: unknown): string => { const v = validateScan(doc); assert.equal(v.ok, false, `expected a rejection, got ok: ${JSON.stringify(doc).slice(0, 120)}`); return `${v.errors[0]!.path} ${v.errors[0]!.msg}`; };

test("[fast] validateScan: stats, maxes, resists and position hold numbers, not arbitrary values", () => {
  assert.equal(validateScan({ ...bounded, maxes: { hits: 154, stam: 86, mana: 40 }, resists: { phys: 70 }, position: { x: 1, y: 1, z: 0 } }).ok, true);
  assert.equal(validateScan({ ...bounded, maxes: null, resists: null, position: null }).ok, true);   // all three stay nullable
  invalid({ ...bounded, stats: { str: '<img src=x onerror="alert(1)">' } });
  invalid({ ...bounded, maxes: { hits: { toString: 1 } } });
  invalid({ ...bounded, resists: { phys: "70" } });
  invalid({ ...bounded, position: { x: [1] } });
});

test("[fast] validateScan: a skills entry must be a {value, cap} pair of numbers", () => {
  assert.equal(validateScan({ ...bounded, skills: { Magery: { value: 110, base: 110, cap: 110 } } }).ok, true);
  assert.equal(validateScan({ ...bounded, skills: { Magery: { value: 50, cap: 100 } } }).ok, true);   // base is optional — adapters/classicuo-web omits it
  invalid({ ...bounded, skills: { Magery: "not-an-object" } });
  invalid({ ...bounded, skills: { Magery: {} } });
  invalid({ ...bounded, skills: { Magery: null } });
  invalid({ ...bounded, skills: { Magery: { value: "x", cap: 100 } } });
});

test("[fast] validateScan: a serial is a 32-bit unsigned integer, not any integer JS happens to hold", () => {
  const root = (serial: unknown) => ({ ...bounded, roots: [{ serial, kind: "ground", name: "x", opened: true }] });
  assert.equal(validateScan(root(1879769088)).ok, true);
  invalid(root(1e308));        // Number.isInteger(1e308) is true; two such serials collapse into one fold entry
  invalid(root(-1));
  invalid(root(2 ** 32));
  invalid(root(1.5));
  invalid({ ...bounded, containers: { k: { serial: "__proto__", root: 1, parent: null } } });
  invalid({ ...bounded, items: [{ serial: 1e308, container: 1, nameSource: "opl" }] });
});

test("[fast] validateScan: amount, graphic and hue are bounded, so no total can reach Infinity", () => {
  assert.equal(validateScan({ ...bounded, items: [{ serial: 1, container: 1, nameSource: "opl", amount: 717, graphic: 19674, hue: 2952 }] }).ok, true);
  invalid({ ...bounded, items: [{ serial: 1, container: 1, nameSource: "opl", amount: 1e308 }] });
  invalid({ ...bounded, items: [{ serial: 1, container: 1, nameSource: "opl", graphic: 1e9 }] });
  invalid({ ...bounded, items: [{ serial: 1, container: 1, nameSource: "opl", hue: -1 }] });
});

test("[fast] validateScan: character, names and tooltip lines are length-bounded", () => {
  invalid({ ...bounded, character: "K".repeat(100_000) });   // becomes a filename via acceptedName — an unbounded one is ENAMETOOLONG, three retries and a reject
  invalid({ ...bounded, items: [{ serial: 1, container: 1, nameSource: "opl", name: "n".repeat(100_000) }] });
  invalid({ ...bounded, items: [{ serial: 1, container: 1, nameSource: "opl", tooltip: ["a" + " ".repeat(200_000) + "5x"] }] });
  invalid({ ...bounded, equipped: [{ serial: 1, nameSource: "opl", tooltip: Array.from({ length: 5000 }, () => "Weight: 1 Stone") }] });
});

test("[fast] validateScan: the shipped fixtures and every adapter's real output still validate", () => {
  for (const name of ["demo-Kestrel.json", "demo-Dorran.json"]) {
    const up = upgradeScan(JSON.parse(readFileSync(join(HERE, "fixtures", name), "utf8")), { shard: "uoalive" });
    const v = validateScan(up);
    assert.equal(v.ok, true, `${name}: ${JSON.stringify(v.errors)}`);
  }
  const fixture = JSON.parse(readFileSync(join(HERE, "..", "adapters", "tazuo", "fixture.scan.json"), "utf8"));
  const v = validateScan(upgradeScan(fixture, { shard: "uoalive" }));
  assert.equal(v.ok, true, `adapters/tazuo/fixture.scan.json: ${JSON.stringify(v.errors)}`);
});

// adapter.id used to be any non-empty string. It names an inbox, a bridge directory and an adapters/
// folder elsewhere in the app, so a scan must not carry one that could not be an adapter id at all.
test("[fast] validateScan: adapter.id must look like an adapter id (lowercase, digits, hyphens, at most 64)", () => {
  const fixture = JSON.parse(readFileSync(join(HERE, "..", "adapters", "tazuo", "fixture.scan.json"), "utf8")) as ScanV2;
  for (const id of ["tazuo", "razor-enhanced", "classicuo-web", "app"]) {
    const v = validateScan({ ...fixture, adapter: { ...fixture.adapter, id } });
    assert.equal(v.ok, true, `${id}: ${JSON.stringify(v.errors)}`);
  }
  for (const id of ["../../evil", "TazUO", "taz uo", "tazuo\n", "a".repeat(65), ""]) {
    const v = validateScan({ ...fixture, adapter: { ...fixture.adapter, id } });
    assert.equal(v.ok, false, `${JSON.stringify(id)} must be refused`);
    assert.ok(v.errors.some((e) => e.path === "/adapter/id"), JSON.stringify(v.errors));
  }
});

// The scannedAt pattern cannot tell a real date from month 13 or hour 25, and Date.parse returns NaN
// for those, which used to scramble the fold's time order (see gear-vault.test.mts's fold test).
test("[fast] validateScan: a scannedAt that is not a real date/time is rejected", () => {
  const doc = (scannedAt: string) => ({
    schemaVersion: 2, character: "_vault", scannedAt,
    adapter: { id: "app", version: "1", client: "Pack Rat", clientVersion: null,
      capabilities: { layers: [], arms: false, bank: false, ground: false, nested: false, tooltips: "label", bridge: [] } },
    stats: {}, equipped: [], roots: [{ serial: 1, kind: "ground", name: "x", opened: true }], containers: {}, items: [],
  });
  for (const bad of ["2026-13-01T10:00:00Z", "2026-09-11T25:00:00Z", "2026-09-11T10:61:00Z", "2026-02-30T10:00:00+02:00", "2026-09-11T10:00:60Z", "2026-09-11T10:00:00+24:00"]) {
    const v = validateScan(doc(bad));
    assert.equal(v.ok, false, bad);
    assert.ok(v.errors.some((e) => e.path === "/scannedAt"), `${bad}: ${JSON.stringify(v.errors)}`);
  }
  for (const good of ["2026-02-28T23:59:59Z", "2028-02-29T00:00:00-07:00", "2026-09-11T10:00:00.123Z", "2026-09-11T10:00:00+14:00"]) {
    const v = validateScan(doc(good));
    assert.equal(v.ok, true, `${good}: ${JSON.stringify(v.errors)}`);
  }
});
