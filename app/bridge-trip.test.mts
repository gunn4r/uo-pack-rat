// bridge-trip.test.mts — queueTrip (app/bridge-trip.mts), the only writer of an Organize trip line,
// and the stop flag behind POST /api/bridge/stop. Run: node --test app/bridge-trip.test.mts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { resolveConfig, type ConfigPaths } from "./config.mts";
import { queueTrip, writeBridgeStop, TRIP_MAX_BYTES, TRIP_NAME_MAX, type TripInput } from "./bridge-trip.mts";
import { validate, type ValidatorSchema } from "./schema/validate.mts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(HERE);
const TRIP_SCHEMA = JSON.parse(readFileSync(join(HERE, "schema", "bridge-trip.v1.schema.json"), "utf8")) as ValidatorSchema;
const CHEST = 0x40000001, BAG = 0x40000002, DEST = 0x40000050, RING = 0x40000010;

function fresh(): { dir: string; paths: ConfigPaths } {
  const dir = mkdtempSync(join(tmpdir(), "qm-trip-"));
  return { dir, paths: resolveConfig(["--port", "0", "--data", dir], {}).paths };
}
function trip(over: Partial<TripInput> = {}): TripInput {
  return {
    index: 3, stamp: "2026-09-28T12:00:00.000Z",
    roots: { [String(CHEST)]: { x: 10, y: 10, z: 0 }, [String(DEST)]: { x: 12, y: 10, z: 0, facet: 1 } },
    takes: [{ serial: RING, name: "Ring", chain: [CHEST, BAG] }],
    puts: [{ serial: RING, name: "Ring", dest: [DEST] }],
    ...over,
  };
}
const queued = (paths: ConfigPaths, adapter = "tazuo"): Record<string, unknown>[] =>
  existsSync(paths.bridgeQueueFor(adapter)) ? readFileSync(paths.bridgeQueueFor(adapter), "utf8").trim().split("\n").map((l) => JSON.parse(l) as Record<string, unknown>) : [];
// Twenty takes and forty puts, every path eight containers deep, every root the same chest.
function largest(name: string): TripInput {
  const path = Array.from({ length: 8 }, (_, i) => CHEST + i);
  return trip({ roots: { [String(CHEST)]: { x: 10, y: 10, z: 0, facet: 1 } },
    takes: Array.from({ length: 20 }, (_, i) => ({ serial: 0x40001000 + i, name, chain: path })),
    puts: Array.from({ length: 40 }, (_, i) => ({ serial: 0x40002000 + i, name, dest: path })) });
}

test("[fast] queueTrip appends one schema-valid trip line to the adapter's own queue", () => {
  const { paths } = fresh();
  const now = new Date("2026-09-28T12:05:00.000Z");
  const r = queueTrip(paths, "tazuo", trip(), now);
  assert.ok(r.ok, JSON.stringify(r));
  const lines = queued(paths);
  assert.equal(lines.length, 1);
  const line = lines[0]!;
  assert.equal(line.id, r.ok ? r.id : "");
  assert.equal(line.action, "trip");
  assert.equal(line.queuedAt, now.toISOString());
  const v = validate(TRIP_SCHEMA, line);
  assert.ok(v.ok, JSON.stringify(v.errors));
  assert.equal(existsSync(paths.bridgeQueueFor("razor-enhanced")), false);
});

test("[fast] queueTrip writes putAway only on a Put away trip, which takes nothing (issue #131)", () => {
  const { paths } = fresh();
  assert.equal(queueTrip(paths, "tazuo", trip()).ok, true);
  const bad = queueTrip(paths, "tazuo", trip({ putAway: BAG }));
  assert.equal(bad.ok, false);
  assert.match(bad.ok ? "" : bad.error, /takes nothing/);
  assert.equal(queueTrip(paths, "tazuo", trip({ roots: { [String(DEST)]: { x: 12, y: 10, z: 0 } }, takes: [], putAway: BAG })).ok, true);
  const lines = queued(paths);
  assert.deepEqual(lines.map((l) => l.putAway), [undefined, BAG]);
  for (const l of lines) assert.equal(validate(TRIP_SCHEMA, l).ok, true);
});

test("[fast] queueTrip cuts names to the bridge's limit", () => {
  const { paths } = fresh();
  const r = queueTrip(paths, "tazuo", trip({ takes: [{ serial: RING, name: "N".repeat(500), chain: [CHEST, BAG] }] }));
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal((queued(paths)[0]!.takes as { name: string }[])[0]!.name.length, TRIP_NAME_MAX);
});

test("[fast] queueTrip refuses a trip the bridge would refuse, and writes nothing", () => {
  const { paths } = fresh();
  const cases: [string, Partial<TripInput>][] = [
    ["a roots key that is not a serial", { roots: { "0x40000001": { x: 10, y: 10, z: 0 }, [String(DEST)]: { x: 12, y: 10, z: 0 } } }],
    ["a step whose root has no position", { roots: { [String(CHEST)]: { x: 10, y: 10, z: 0 } } }],
    ["a root no step uses", { roots: { ...trip().roots, "1073742000": { x: 1, y: 1, z: 0 } } }],
    ["nothing to do", { takes: [], puts: [] }],
    ["a serial taken twice", { takes: [{ serial: RING, name: "a", chain: [CHEST] }, { serial: RING, name: "b", chain: [CHEST] }] }],
    ["21 takes", { takes: Array.from({ length: 21 }, (_, i) => ({ serial: 0x40001000 + i, name: "x", chain: [CHEST] })), puts: [] }],
    ["an empty chain", { takes: [{ serial: RING, name: "x", chain: [] }], puts: [] }],
    ["a position off the map", { roots: { [String(CHEST)]: { x: 99999, y: 10, z: 0 }, [String(DEST)]: { x: 12, y: 10, z: 0 } } }],
  ];
  for (const [what, over] of cases) {
    const r = queueTrip(paths, "tazuo", trip(over));
    assert.equal(r.ok, false, `accepted ${what}`);
  }
  assert.deepEqual(queued(paths), []);
});

test("[fast] queueTrip refuses a line the bridge would refuse unread, and the largest trip the limits allow still fits", () => {
  const { paths } = fresh();
  assert.ok(queueTrip(paths, "tazuo", largest("N".repeat(TRIP_NAME_MAX))).ok, "a full-size trip with plain names");
  // A control character serializes as \u0001, six bytes: forty of them in each of sixty names pass
  // every field limit and still take the line past MAX_LINE_BYTES.
  const r = queueTrip(paths, "tazuo", largest("\u0001".repeat(TRIP_NAME_MAX)));
  assert.equal(r.ok, false);
  assert.match(r.ok ? "" : r.error, /bytes/);
  assert.equal(queued(paths).length, 1, "only the full-size trip was written");
  for (const line of readFileSync(paths.bridgeQueueFor("tazuo"), "utf8").trim().split("\n")) {
    assert.ok(Buffer.byteLength(line, "utf8") <= TRIP_MAX_BYTES);
  }
});

test("[fast] TRIP_MAX_BYTES is every bridge's own line limit", () => {
  for (const adapter of ["tazuo", "razor-enhanced"]) {
    const py = readFileSync(join(ROOT, "adapters", adapter, "packrat-bridge.py"), "utf8");
    assert.match(py, new RegExp(`^MAX_LINE_BYTES = ${TRIP_MAX_BYTES}\\b`, "m"), adapter);
    assert.match(py, new RegExp(`^MAX_TRIP_NAME = ${TRIP_NAME_MAX}\\b`, "m"), adapter);
  }
});

test("[fast] writeBridgeStop writes <data>/bridge/stop, and rewrites it", () => {
  const { dir, paths } = fresh();
  assert.equal(paths.bridgeStop, join(dir, "bridge", "stop"));
  writeBridgeStop(paths);
  writeBridgeStop(paths);
  assert.ok(existsSync(join(dir, "bridge", "stop")));
});
