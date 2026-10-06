// bridge-status.test.mts — the bridge reporting itself: `readBridgeStatus` (`app/bridge-status.mts`), the one reader of status.json, and `bridgeFeatures` (`app/vault-lib.mts`), what a bridge can do.
//
// `readBridgeStatus`: no file, unreadable JSON and a file off the status schema read as not running; online is a heartbeat under 8 s old (a future one counts), an older bridge's epoch-seconds heartbeat still reads, and a newer bridge's extra fields (a count included) do not stop it reading, and an off-shape report of itself is dropped on its own while the status still reads as online. `bridgeFeatures`: the online bridge's own report first, then the newest scan made with that adapter (a v1 scan's made-up block skipped, "trip-bags" still read from the actions list where older scripts put it), then the shipped manifest; a bridge too old to report itself is judged exactly as before. Every queue line `queueTrip` writes carries `BRIDGE_PROTOCOL`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readBridgeStatus, ONLINE_S } from "./bridge-status.mts";
import { BRIDGE_PROTOCOL } from "./bridge-contract.mts";
import { queueTrip } from "./bridge-trip.mts";
import { resolveConfig } from "./config.mts";
import { bridgeFeatures, newestScanAdapter } from "./vault-lib.mts";
import { V1_ADAPTER_VERSION } from "./scan-schema.mts";

const NOW = Date.UTC(2026, 9, 6, 12, 0, 0);
const stamp = (ms: number): string => new Date(ms).toISOString();
const valid = (over: Record<string, unknown> = {}) => ({ alive: stamp(NOW - 2000), character: "Tester", current: null, results: {}, counts: { done: 0, failed: 0 }, ...over });
function statusFile(doc: unknown): string {
  const f = join(mkdtempSync(join(tmpdir(), "pr-bridge-status-")), "status.json");
  writeFileSync(f, typeof doc === "string" ? doc : JSON.stringify(doc));
  return f;
}

test("[fast] readBridgeStatus: no file, unreadable JSON or a file off the status schema reads as not running", () => {
  const none = readBridgeStatus(join(mkdtempSync(join(tmpdir(), "pr-bridge-none-")), "status.json"), NOW);
  assert.deepEqual([none.status, none.online, none.age], [null, false, Infinity]);
  for (const doc of ["{not json", [1, 2], "a string", 7, valid({ counts: {} }), valid({ alive: "yesterday" })]) {
    const r = readBridgeStatus(statusFile(doc), NOW);
    assert.deepEqual([r.status, r.online], [null, false], JSON.stringify(doc));
  }
});

test("[fast] readBridgeStatus: online is a heartbeat under 8 s old; an older build's epoch seconds and a newer bridge's extra fields still read", () => {
  const fresh = readBridgeStatus(statusFile(valid()), NOW);
  assert.deepEqual([fresh.online, fresh.age, fresh.status?.character], [true, 2, "Tester"]);
  assert.equal(readBridgeStatus(statusFile(valid({ alive: stamp(NOW - ONLINE_S * 1000) })), NOW).online, false, "8 s old is offline");
  assert.equal(readBridgeStatus(statusFile(valid({ alive: stamp(NOW + 60_000) })), NOW).online, true, "a heartbeat from the future counts, as it always has");
  const legacy = readBridgeStatus(statusFile(valid({ alive: (NOW - 3000) / 1000 })), NOW);
  assert.deepEqual([legacy.online, legacy.aliveMs], [true, NOW - 3000]);
  const newer = readBridgeStatus(statusFile(valid({ adapter: { id: "tazuo", version: "9.0.0", protocol: 2, features: ["grab"], since: "x" }, queueBytes: 12 })), NOW);
  assert.equal(newer.online, true);
  assert.deepEqual(newer.status?.adapter?.features, ["grab"]);
  assert.equal(readBridgeStatus(statusFile(valid({ counts: { done: 1, failed: 0, skipped: 2 } })), NOW).online, true, "a count a newer bridge adds");
});

test("[fast] readBridgeStatus: a report of itself off its shape is dropped on its own, and the bridge still reads as online", () => {
  for (const adapter of [{ id: "tazuo" }, { id: "tazuo", version: 216, protocol: 1, features: [] }, { id: "tazuo", version: "3.0.0", protocol: 2, features: "grab" }, "tazuo 3.0.0", null]) {
    const r = readBridgeStatus(statusFile(valid({ adapter })), NOW);
    assert.equal(r.online, true, JSON.stringify(adapter));
    assert.equal(r.status?.character, "Tester");
    assert.equal(r.status && "adapter" in r.status, false, `${JSON.stringify(adapter)} is dropped`);
    assert.equal(bridgeFeatures({ running: r.status?.adapter, manifest }).source, "app", "gating falls back as for an older bridge");
  }
});

const TAZUO_ACTIONS = ["highlight", "grab", "goto", "trip"];
const manifest = { capabilities: { bridge: TAZUO_ACTIONS }, features: ["trip-bags"] };
const scanned = (version: string, bridge: string[], features?: string[], scannedAt = "2026-10-01T12:00:00Z", id = "tazuo") =>
  ({ scannedAt, adapter: { id, version, capabilities: { bridge }, ...(features ? { features } : {}) } });
const sorted = (s: Iterable<string>): string[] => [...s].sort();

test("[fast] bridgeFeatures: the online bridge's own report first, then the newest scan made with that adapter, then the shipped manifest", () => {
  const characters = { A: scanned("2.15.0", TAZUO_ACTIONS), B: scanned("2.16.0", TAZUO_ACTIONS, ["trip-bags"], "2026-10-02T12:00:00Z"), C: scanned("1.12.0", ["highlight"], undefined, "2026-10-03T12:00:00Z", "razor-enhanced") };
  const scan = newestScanAdapter(characters, "tazuo");
  assert.equal(scan?.version, "2.16.0", "the newest of that adapter's scans, not the newest overall");
  const running = { id: "tazuo", version: "2.16.0", protocol: 1, features: ["highlight", "grab"] };
  assert.deepEqual(bridgeFeatures({ running, scan, manifest }).source, "bridge");
  assert.deepEqual(sorted(bridgeFeatures({ running, scan, manifest }).features), ["grab", "highlight"], "the bridge says what it can do, whatever was shipped");
  const fromScan = bridgeFeatures({ running: null, scan, manifest });
  assert.deepEqual([fromScan.source, sorted(fromScan.features)], ["scan", ["goto", "grab", "highlight", "trip", "trip-bags"]]);
  assert.deepEqual(bridgeFeatures({ running: null, scan: null, manifest }).source, "app");
  assert.deepEqual(bridgeFeatures({}), { features: new Set(), source: null });
});

test("[fast] bridgeFeatures: trip-bags still counts from the actions list older scripts put it in, and a v1 scan's made-up adapter block is skipped", () => {
  const old = newestScanAdapter({ A: scanned("2.15.1", [...TAZUO_ACTIONS, "trip-bags"]) }, "tazuo");
  assert.ok(bridgeFeatures({ scan: old }).features.has("trip-bags"));
  assert.equal(bridgeFeatures({ scan: newestScanAdapter({ A: scanned("2.8.0", ["highlight", "grab", "goto"]) }, "tazuo") }).features.has("trip-bags"), false);
  assert.equal(newestScanAdapter({ A: scanned(V1_ADAPTER_VERSION, ["highlight", "grab", "goto"], undefined, "2026-12-01T00:00:00Z"), B: scanned("2.16.0", TAZUO_ACTIONS) }, "tazuo")?.version, "2.16.0");
  assert.equal(newestScanAdapter({ A: scanned(V1_ADAPTER_VERSION, ["highlight"]) }, "tazuo"), null);
});

test("[fast] bridgeFeatures: a bridge too old to report itself is judged as before, by the newest scan for trip-bags and the manifest without one", () => {
  // Before the report, Organize read trip-bags off the newest scan and the page its buttons off the manifest; a
  // bridge with no adapter block in its status gives `running` nothing, so the same scan and manifest decide.
  const scan = newestScanAdapter({ A: scanned("2.15.1", [...TAZUO_ACTIONS, "trip-bags"]) }, "tazuo");
  const old = bridgeFeatures({ running: undefined, scan, manifest });
  assert.deepEqual(sorted(old.features), sorted([...TAZUO_ACTIONS, "trip-bags"]));
  assert.deepEqual(sorted(bridgeFeatures({ running: null, scan: null, manifest }).features), sorted([...TAZUO_ACTIONS, "trip-bags"]));
  assert.equal(bridgeFeatures({ running: { features: "grab" }, scan, manifest }).source, "scan", "a report without a features list is no report");
});

test("[fast] every trip line queueTrip writes names the protocol the app speaks", () => {
  const paths = resolveConfig(["--data", mkdtempSync(join(tmpdir(), "pr-bridge-protocol-"))], {}).paths;
  const r = queueTrip(paths, "tazuo", { index: 1, stamp: "s", roots: { "1073741825": { x: 1, y: 1, z: 0 } }, takes: [{ serial: 1073741840, name: "Pearl", chain: [1073741825] }], puts: [] });
  assert.ok(r.ok);
  const line = JSON.parse(readFileSync(paths.bridgeQueueFor("tazuo"), "utf8").trim()) as { protocol?: unknown };
  assert.equal(line.protocol, BRIDGE_PROTOCOL);
});
