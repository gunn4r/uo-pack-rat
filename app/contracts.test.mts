// contracts.test.mts — folds every adapter's fixture.scan.json against its own capabilities.json, checking the two agree with each other and with the shared scan and bridge schemas.
//
// walks every `adapters/<id>/` directory that ships both `capabilities.json` and `fixture.scan.json` (today: `adapters/tazuo/`, and `adapters/razor-enhanced/`, whose fixture comes from the fake client) and checks, with no adapter-specific code: the whole `capabilities.json` validates against `app/schema/adapter-manifest.v1.schema.json` and names its own folder, a folder adapter's `install` section lists its scripts folders and a paste adapter's holds only `register`; its `capabilities` object validates against the scan schema's `adapter.capabilities` shape; `fixture.scan.json` validates against the full `scan.v2.schema.json`; the fixture folds into a character with at least one nested container and at least one worn item located on it; and `capabilities.json`'s `capabilities` object (and its `features`) is deep-equal to the fixture's own `adapter.capabilities` (and `adapter.features`); every declared feature is one the app gates on, and an adapter with a bridge declares the `protocol` the app writes (catches a script's `CAPABILITIES` dict, its `capabilities.json`, and its fixture drifting apart from each other). Every ground root in a fixture carries its tooltip, with a Contents line, and a facet (issue #11). A guard test fails the whole suite if no adapter directory ships a contract at all. Also covers `app/schema/bridge.v1.schema.json` directly: the documented command/result/status examples (including a `stopped: true` status) validate, and an unknown `action` is rejected. See `docs/adapter-guide.md` for what shipping a contract requires.
//
// An "adapter" here is any directory under adapters/ that ships both a capabilities.json and a fixture.scan.json; a future adapter picks these tests up for free just by shipping those two files. With app/scan-schema.test.mts, app/rules.test.mts and app/bridge-trip.test.mts it keeps the contracts in docs/scan-schema.md, docs/bridge-protocol.md and docs/shard-rules.md honest against the code that ships.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validate, type ValidatorSchema } from "./schema/validate.mts";
import { BRIDGE_PROTOCOL } from "./bridge-contract.mts";
import { BAG_TAKES } from "./organize.mts";
import { SCAN_V2_SCHEMA } from "./scan-schema.mts";
import { foldSnapshots, setRules } from "./vault-lib.mts";
import type { AdapterManifestV1, RulesV1, ScanV2, ScanV2AdapterCapabilities } from "./schema/types.d.mts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(HERE);
const ADAPTERS_DIR = join(ROOT, "adapters");

// Every test in this file runs against the UO Alive shard rules, same as gear-vault.test.mts —
// foldSnapshots needs setRules() called before anything else touches it.
setRules(JSON.parse(readFileSync(join(HERE, "rules", "uoalive.json"), "utf8")) as RulesV1);

const adapterDirs = existsSync(ADAPTERS_DIR)
  ? readdirSync(ADAPTERS_DIR, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
  : [];

// ---- bridge v1 protocol schema (its own cases are at the bottom of this file; declared here
// because the per-adapter loop below checks each declared action against its `action` enum) -------
const BRIDGE_SCHEMA = JSON.parse(readFileSync(join(HERE, "schema", "bridge.v1.schema.json"), "utf8")) as { command: ValidatorSchema; result: ValidatorSchema; status: ValidatorSchema };
// The Organize trip (issue #11): its own shape, written only by app/bridge-trip.mts's queueTrip.
const TRIP_SCHEMA = JSON.parse(readFileSync(join(HERE, "schema", "bridge-trip.v1.schema.json"), "utf8")) as ValidatorSchema;
// The whole capabilities.json (its capabilities object is the scan schema's, checked below).
const MANIFEST_SCHEMA = JSON.parse(readFileSync(join(HERE, "schema", "adapter-manifest.v1.schema.json"), "utf8")) as ValidatorSchema;

// capabilities.json's own shape (app/installer.mts's AdapterInfo reads more of it; this file only ever
// reads .capabilities off it).
interface CapabilitiesFile {
  capabilities: ScanV2AdapterCapabilities;
  features?: string[];
  protocol?: number;
}

// Every adapter directory that ships a capabilities.json gets the manifest checks, whether or not it
// also ships a fixture (Phase 7 security review, finding 9: these ran for tazuo alone, because the
// fixture gate skipped the whole block — so razor-enhanced's and classicuo-web's manifests were
// unverified end to end). Only the fixture-dependent tests stay behind that gate.
const ALL_BRIDGE_ACTIONS = ["highlight", "grab", "goto"];

for (const name of adapterDirs) {
  const dir = join(ADAPTERS_DIR, name);
  const capsPath = join(dir, "capabilities.json");
  if (!existsSync(capsPath)) continue;   // not an adapter directory at all

  test(`[smoke] adapters/${name}: capabilities.json validates against the adapter manifest schema and names its own folder`, () => {
    const manifest = JSON.parse(readFileSync(capsPath, "utf8")) as AdapterManifestV1;
    const { ok, errors } = validate(MANIFEST_SCHEMA, manifest);
    assert.ok(ok, JSON.stringify(errors));
    assert.equal(manifest.adapter, name);
    // A folder client needs a folder to find; a paste client installs nothing, so it carries only register.
    if (manifest.transport === "folder") assert.ok(manifest.install.scriptsSuffix?.length, "a folder adapter lists install.scriptsSuffix");
    else assert.deepEqual(Object.keys(manifest.install), ["register"], "a paste adapter's install section holds only register");
  });

  test(`[smoke] adapters/${name}: capabilities.json validates against the scan schema's capabilities shape`, () => {
    const caps = JSON.parse(readFileSync(capsPath, "utf8")) as CapabilitiesFile;
    const { ok, errors } = validate(SCAN_V2_SCHEMA.properties.adapter.properties.capabilities, caps.capabilities);
    assert.ok(ok, JSON.stringify(errors));
  });

  test(`[smoke] adapters/${name}: every declared bridge action has an app button and a script that runs it`, () => {
    const caps = JSON.parse(readFileSync(capsPath, "utf8")) as CapabilitiesFile;
    const declared = caps.capabilities.bridge;
    for (const action of declared) {
      // trip is Organize's own command, with its own schema; the Organize view that queues it gates
      // on this same capability list.
      if (action === "trip") {
        assert.ok(validate(TRIP_SCHEMA.properties!.action!, action).ok, "trip is not bridge-trip.v1.schema.json's action");
        continue;
      }
      // trip-bags is a feature, not a command (issue #128): its trips take a bag only once they have read it empty. It stays
      // in this list, where every Pack Rat reads it, until an app that reads a scan's adapter.features has been out a release.
      if (action === BAG_TAKES) {
        assert.ok(declared.includes("trip"), "trip-bags without trip");
        continue;
      }
      assert.ok(ALL_BRIDGE_ACTIONS.includes(action), `unknown bridge action ${JSON.stringify(action)} — app/ui/bridge.mts renders no button for it, so nothing would ever queue it`);
      assert.ok(validate(BRIDGE_SCHEMA.command.properties!.action!, action).ok, `${action} is not in bridge.v1.schema.json's action enum`);
    }
    // An adapter claiming it executes commands must ship the script that reads the queue; without
    // one the app renders Highlight/Grab/Go-to buttons whose commands nothing will ever run.
    const hasBridgeScript = ["packrat-bridge.py", "packrat-bridge.ts"].some((f) => existsSync(join(dir, f)));
    assert.equal(declared.length > 0, hasBridgeScript, declared.length > 0
      ? `declares ${JSON.stringify(declared)} but ships no packrat-bridge script`
      : `ships a packrat-bridge script but declares no bridge actions`);
  });

  test(`[smoke] adapters/${name}: every feature is one the app gates on, and a bridge declares the protocol the app writes`, () => {
    const caps = JSON.parse(readFileSync(capsPath, "utf8")) as CapabilitiesFile;
    // trip-bags (issue #128): its trips take a bag only once they have read it empty. Organize reads it through
    // bridgeFeatures; the bridge refuses it as an action.
    for (const f of caps.features ?? []) {
      assert.ok(f === BAG_TAKES, `unknown feature ${JSON.stringify(f)}: nothing in the app gates on it`);
      assert.ok(caps.capabilities.bridge.includes("trip"), `${f} without trip`);
    }
    assert.equal(caps.protocol, caps.capabilities.bridge.length ? BRIDGE_PROTOCOL : undefined, "protocol is the bridge.v1 protocol the app writes, declared by an adapter with a bridge");
  });

  const fixturePath = join(dir, "fixture.scan.json");
  if (!existsSync(fixturePath)) continue;   // a fixture has to come from a real scan; not every adapter has had one yet

  test(`[smoke] adapters/${name}: fixture.scan.json validates against scan.v2.schema.json`, () => {
    const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as ScanV2;   // known-good fixture: the cast stands in for the validateScan() a real caller runs
    const { ok, errors } = validate(SCAN_V2_SCHEMA, fixture);
    assert.ok(ok, JSON.stringify(errors));
  });

  // Organize (issue #11) reads a chest's room from its tooltip's Contents line and groups chests by
  // facet: a fixture from a current scanner carries both on every ground root.
  test(`[fast] adapters/${name}: every ground root in the fixture carries its tooltip and a facet`, () => {
    const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as ScanV2;   // known-good fixture: the cast stands in for the validateScan() a real caller runs
    const grounds = fixture.roots.filter((r) => r.kind === "ground");
    assert.ok(grounds.length > 0);
    for (const r of grounds) {
      const c = fixture.containers[String(r.serial)];
      assert.ok(c?.tooltip?.some((l) => /^Contents: /.test(l)), `root ${r.serial} has no Contents line`);
      assert.equal(typeof c?.pos?.facet, "number", `root ${r.serial} has no facet`);
    }
  });

  test(`[smoke] adapters/${name}: fixture folds into a character with a nested container and worn items located on it`, () => {
    const caps = JSON.parse(readFileSync(capsPath, "utf8")) as CapabilitiesFile;
    const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as ScanV2;   // known-good fixture: the cast stands in for the validateScan() a real caller runs
    const inv = foldSnapshots([fixture]);

    assert.ok(Object.keys(inv.characters).length >= 1, "at least one character");
    assert.ok(inv.characters[fixture.character], "the fixture's own character is present");

    const nestedContainerItems = Object.values(inv.items).filter((i) => i.kind === "container");
    assert.ok(
      nestedContainerItems.some((i) => inv.containers[i.serial]?.parent != null),
      "at least one nested container item (kind === 'container' with a parent)",
    );

    const worn = Object.values(inv.items).filter((i) => i.equippedBy);
    assert.ok(worn.length >= 1, "at least one worn item");
    for (const it of worn) assert.equal(it.equippedBy, fixture.character, `${it.name} located on the fixture character`);

    assert.deepEqual(caps.capabilities, fixture.adapter.capabilities, "capabilities.json matches the fixture's adapter.capabilities");
    assert.deepEqual(caps.features ?? [], fixture.adapter.features ?? [], "capabilities.json's features match the fixture's adapter.features");
  });
}

test("[smoke] at least one adapter ships a capabilities.json + fixture.scan.json contract", () => {
  const withContracts = adapterDirs.filter((name) => existsSync(join(ADAPTERS_DIR, name, "capabilities.json")) && existsSync(join(ADAPTERS_DIR, name, "fixture.scan.json")));
  assert.ok(withContracts.length >= 1, `expected at least one of ${JSON.stringify(adapterDirs)} to ship both files`);
});

// ---- bridge v1 protocol schema (BRIDGE_SCHEMA is loaded at the top of this file) -------------
test("[fast] bridge.v1.schema.json accepts the documented command, result and status examples", () => {
  const command = { id: "1700000000000-1234", action: "grab", serial: 0x40000010, name: "Ring",
    chain: [0x40000001, 0x40000002], pos: { x: 120, y: 340, z: 0 }, queuedAt: "2026-01-01T12:00:00.000Z", protocol: 1 };
  assert.ok(validate(BRIDGE_SCHEMA.command, command).ok);
  const { protocol: _, ...unversioned } = command;
  assert.equal(validate(BRIDGE_SCHEMA.command, unversioned).ok, false, "every line the app writes names its protocol");

  const result = { ok: true, msg: "grabbed Ring — it is in your backpack", t: "2026-01-01T12:00:01-07:00" };
  assert.ok(validate(BRIDGE_SCHEMA.result, result).ok);

  const status = { alive: "2026-01-01T12:00:02-07:00", character: "Fixture", current: null,
    results: { "1700000000000-1234": result }, counts: { done: 1, failed: 0 } };
  assert.ok(validate(BRIDGE_SCHEMA.status, status).ok);

  const stoppedStatus = { ...status, stopped: true };
  assert.ok(validate(BRIDGE_SCHEMA.status, stoppedStatus).ok);

  // TazUO 2.16.0 and Razor Enhanced 1.12.0 report themselves; a field from a newer bridge is still a status.
  const reporting = { ...status, adapter: { id: "tazuo", version: "2.16.0", protocol: 1, features: ["highlight", "grab", "goto", "trip", "trip-bags"] } };
  assert.ok(validate(BRIDGE_SCHEMA.status, reporting).ok);
  assert.ok(validate(BRIDGE_SCHEMA.status, { ...reporting, adapter: { ...reporting.adapter, since: 1 }, queueBytes: 0 }).ok);
  assert.equal(validate(BRIDGE_SCHEMA.status, { ...reporting, adapter: { id: "tazuo", version: "2.16.0" } }).ok, false, "a report names its protocol and features");
  assert.ok(validate(BRIDGE_SCHEMA.status, { ...status, alive: 1767268800 }).ok, "an older build's epoch-seconds heartbeat");
});

test("[fast] bridge.v1.schema.json rejects an unknown action", () => {
  const command = { id: "x", action: "delete-everything", serial: 1, name: "n", chain: [], pos: null, queuedAt: "2026-01-01T12:00:00.000Z", protocol: 1 };
  const { ok } = validate(BRIDGE_SCHEMA.command, command);
  assert.equal(ok, false);
});

// ---- what the app actually sends today ---------------------------------------------------------
// POST /api/bridge (app/vault-server.mts) builds every line as
// {id, action, serial, name, chain: body.chain || [], pos: body.pos ?? null, queuedAt: new
// Date().toISOString(), protocol: BRIDGE_PROTOCOL}, and app/ui/bridge.mts's sendBridge() supplies action/serial/name/chain
// (chainOf, at most 8 entries) and pos (rootPos, `null` for every item the fold produces today).
// The tightened `pos`/`queuedAt` types below must keep all of that valid — a schema that refused the
// app's own Grab-all burst would be a worse bug than the one it fixes.
test("[fast] bridge.v1.schema.json accepts exactly what POST /api/bridge writes today", () => {
  const line = (over: Record<string, unknown> = {}) => ({
    id: `${Date.now()}-4213`, action: "grab", serial: 0x40000010, name: "Ring",
    chain: [0x40000001, 0x40000002], pos: null, queuedAt: new Date().toISOString(), protocol: BRIDGE_PROTOCOL, ...over,
  });
  // A whole "Grab all" burst: one line per fetch-list piece, every chain depth chainOf() can walk.
  for (let depth = 0; depth <= 8; depth++) {
    const chain = Array.from({ length: depth }, (_, i) => 0x40000001 + i);
    const { ok, errors } = validate(BRIDGE_SCHEMA.command, line({ chain }));
    assert.ok(ok, `chain of ${depth}: ${JSON.stringify(errors)}`);
  }
  for (const action of ["highlight", "grab", "goto"]) assert.ok(validate(BRIDGE_SCHEMA.command, line({ action })).ok, action);
  // …and a scanner-written root position, the one shape `pos` is ever non-null from.
  assert.ok(validate(BRIDGE_SCHEMA.command, line({ pos: { x: 1520, y: 1631, z: 0 } })).ok);
  assert.ok(validate(BRIDGE_SCHEMA.command, line({ pos: { x: 1520, y: 1631, z: -5, facet: 1 } })).ok);
});

test("[fast] bridge.v1.schema.json types pos: null or bounded integer x/y/z, nothing else", () => {
  const line = (pos: unknown) => ({ id: "x", action: "goto", serial: 1, name: "n", chain: [1], pos, queuedAt: "2026-01-01T12:00:00.000Z" });
  for (const bad of [{}, { x: "1", y: 2, z: 0 }, { x: 1, y: 2 }, { x: -1, y: 2, z: 0 }, { x: 7169, y: 2, z: 0 },
    { x: 1, y: 4097, z: 0 }, { x: 1, y: 2, z: 200 }, { x: 1.5, y: 2, z: 0 }, { x: 1, y: 2, z: 0, facet: 9 },
    { x: 1, y: 2, z: 0, cmd: "anything" }]) {
    assert.equal(validate(BRIDGE_SCHEMA.command, line(bad)).ok, false, `accepted pos=${JSON.stringify(bad)}`);
  }
});

test("[fast] bridge.v1.schema.json requires queuedAt to be a parseable RFC 3339 stamp", () => {
  const line = (queuedAt: unknown) => ({ id: "x", action: "grab", serial: 1, name: "n", chain: [], pos: null, queuedAt, protocol: 1 });
  assert.ok(validate(BRIDGE_SCHEMA.command, line(new Date().toISOString())).ok);
  assert.ok(validate(BRIDGE_SCHEMA.command, line("2026-01-01T12:00:00+02:00")).ok);
  for (const bad of ["", "yesterday", "2026-01-01", 1767268800]) {
    assert.equal(validate(BRIDGE_SCHEMA.command, line(bad)).ok, false, `accepted queuedAt=${JSON.stringify(bad)}`);
  }
  const { ok } = validate(BRIDGE_SCHEMA.command, { id: "x", action: "grab", serial: 1, name: "n", chain: [], pos: null, protocol: 1 });
  assert.equal(ok, false, "queuedAt is required");
});

test("[fast] bridge.v1.schema.json declares the chain cap the bridges enforce", () => {
  // app/schema/validate.mts implements no maxItems keyword, so this bound is documentation here and
  // a refusal inside each packrat-bridge.py (MAX_CHAIN, covered by adapters/test_adapters.py). The
  // assertion pins the declared number so the two cannot drift apart silently; a server-side
  // refusal needs maxItems support in the validator first (see the schema's own $comment).
  const chain = (BRIDGE_SCHEMA.command.properties as Record<string, ValidatorSchema & { maxItems?: number }>).chain!;
  assert.equal(chain.maxItems, 8);
  assert.equal(chain.items?.minimum, 1, "a chain entry must be a positive serial");
  const pyBounds = readFileSync(join(ROOT, "adapters", "tazuo", "packrat-bridge.py"), "utf8");
  assert.match(pyBounds, new RegExp(`^MAX_CHAIN = ${chain.maxItems}\\b`, "m"), "the bridge's MAX_CHAIN has drifted from the schema's maxItems");
});

// ---- bridge trip schema (Organize, issue #11) ---------------------------------------------------
const tripLine = (over: Record<string, unknown> = {}) => ({
  id: "0b6f3c1e-2a4d-4e8f-9c3a-5d7e1f2a3b4c", action: "trip", index: 3, stamp: "2026-09-28T12:00:00.000Z",
  queuedAt: "2026-09-28T12:05:00.000Z", protocol: 1,
  roots: { "1073741825": { x: 1520, y: 1631, z: 0, facet: 1 }, "1073741904": { x: 1522, y: 1631, z: 0 } },
  takes: [{ serial: 1073741840, name: "Black Pearl", chain: [1073741825, 1073741826] }],
  puts: [{ serial: 1073741840, name: "Black Pearl", dest: [1073741904, 1073741905] }],
  ...over,
});

test("[fast] bridge-trip.v1.schema.json accepts the documented trip and refuses anything else", () => {
  const { ok, errors } = validate(TRIP_SCHEMA, tripLine());
  assert.ok(ok, JSON.stringify(errors));
  const many = (n: number, key: string) => Array.from({ length: n }, (_, i) => ({ serial: 0x40001000 + i, name: "x", [key]: [1073741825] }));
  for (const bad of [{ action: "grab" }, { index: 0 }, { index: 1.5 }, { stamp: "" }, { takes: many(21, "chain") }, { puts: many(41, "dest") },
    { takes: [{ serial: 1, name: "x", chain: [] }] }, { takes: [{ serial: 1, name: "x", chain: Array(9).fill(1) }] },
    { puts: [{ serial: 1, name: "x".repeat(41), dest: [1] }] }, { roots: { "1": { x: 1, y: 2 } } }, { roots: { "1": null } },
    { takes: [{ serial: 1, name: "x", chain: [1], extra: true }] }, { serial: 1 }, { protocol: 0 }, { protocol: "1" }]) {
    assert.equal(validate(TRIP_SCHEMA, tripLine(bad)).ok, false, `accepted ${JSON.stringify(bad)}`);
  }
});

test("[fast] bridge.v1.schema.json's result carries a trip's steps, partial and stopped", () => {
  const result = { ok: false, msg: "trip 3: 1 put away, 1 step failed — backpack full, trip cut short", t: "2026-09-28T12:05:09-06:00",
    partial: true, stopped: false,
    steps: [{ op: "take", serial: 1073741840, ok: true, msg: "took Black Pearl" }, { op: "put", serial: 1073741841, ok: false, msg: "skipped: not taken on this trip" }] };
  const { ok, errors } = validate(BRIDGE_SCHEMA.result, result);
  assert.ok(ok, JSON.stringify(errors));
  assert.equal(validate(BRIDGE_SCHEMA.result, { ...result, steps: [{ op: "drop", serial: 1, ok: true, msg: "" }] }).ok, false);
  assert.equal(validate(BRIDGE_SCHEMA.result, { ...result, steps: [{ serial: 1, ok: true, msg: "" }] }).ok, false);
  // `ms` is optional on the trip and on each step (#119): a bridge before 2.9.0 sends none.
  const timed = { ...result, ms: 4210, steps: result.steps.map((s, i) => ({ ...s, ms: i ? 0 : 3860 })) };
  assert.ok(validate(BRIDGE_SCHEMA.result, timed).ok, JSON.stringify(validate(BRIDGE_SCHEMA.result, timed).errors));
  assert.equal(validate(BRIDGE_SCHEMA.result, { ...timed, ms: 1.5 }).ok, false);
});

test("[fast] bridge.v1.schema.json's command has no trip action: only queueTrip writes one", () => {
  assert.equal(validate(BRIDGE_SCHEMA.command.properties!.action!, "trip").ok, false);
});

test("[fast] bridge-trip.v1.schema.json declares the limits every bridge enforces", () => {
  const p = TRIP_SCHEMA.properties!;
  const take = p.takes!.items!.properties!;
  const py = readFileSync(join(ROOT, "adapters", "tazuo", "packrat-bridge.py"), "utf8");
  assert.match(py, new RegExp(`^MAX_TRIP_TAKES = ${p.takes!.maxItems}\\b`, "m"));
  assert.match(py, new RegExp(`^MAX_TRIP_PUTS = ${p.puts!.maxItems}\\b`, "m"));
  assert.match(py, new RegExp(`^MAX_TRIP_NAME = ${take.name!.maxLength}\\b`, "m"));
  assert.match(py, new RegExp(`^MAX_TRIP_INDEX = ${p.index!.maximum}\\b`, "m"));
  assert.match(py, new RegExp(`^MAX_CHAIN = ${take.chain!.maxItems}\\b`, "m"));
});
