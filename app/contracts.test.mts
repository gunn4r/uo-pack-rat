// contracts.test.mts — folds every adapter's fixture.scan.json against its own capabilities.json,
// checking the two contracts agree with each other and with the shared scan/bridge schemas. An
// "adapter" here is any directory under adapters/ that ships both a capabilities.json and a
// fixture.scan.json (today: adapters/tazuo/); a future adapter picks these tests up for free just by
// shipping those two files.
// Run: node --test app/contracts.test.mts   or   node app/contracts.test.mts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validate, type ValidatorSchema } from "./schema/validate.mts";
import { SCAN_V2_SCHEMA } from "./scan-schema.mts";
import { foldSnapshots, setRules } from "./vault-lib.mts";
import type { RulesV1, ScanV2, ScanV2AdapterCapabilities } from "./schema/types.d.mts";

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

// capabilities.json's own shape (app/installer.mts's AdapterInfo reads more of it; this file only ever
// reads .capabilities off it).
interface CapabilitiesFile {
  capabilities: ScanV2AdapterCapabilities;
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

  test(`[smoke] adapters/${name}: capabilities.json validates against the scan schema's capabilities shape`, () => {
    const caps = JSON.parse(readFileSync(capsPath, "utf8")) as CapabilitiesFile;
    const { ok, errors } = validate(SCAN_V2_SCHEMA.properties.adapter.properties.capabilities, caps.capabilities);
    assert.ok(ok, JSON.stringify(errors));
  });

  test(`[smoke] adapters/${name}: every declared bridge action has an app button and a script that runs it`, () => {
    const caps = JSON.parse(readFileSync(capsPath, "utf8")) as CapabilitiesFile;
    const declared = caps.capabilities.bridge;
    for (const action of declared) {
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

  const fixturePath = join(dir, "fixture.scan.json");
  if (!existsSync(fixturePath)) continue;   // a fixture has to come from a real scan; not every adapter has had one yet

  test(`[smoke] adapters/${name}: fixture.scan.json validates against scan.v2.schema.json`, () => {
    const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as ScanV2;   // known-good fixture: the cast stands in for the validateScan() a real caller runs
    const { ok, errors } = validate(SCAN_V2_SCHEMA, fixture);
    assert.ok(ok, JSON.stringify(errors));
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
  });
}

test("[smoke] at least one adapter ships a capabilities.json + fixture.scan.json contract", () => {
  const withContracts = adapterDirs.filter((name) => existsSync(join(ADAPTERS_DIR, name, "capabilities.json")) && existsSync(join(ADAPTERS_DIR, name, "fixture.scan.json")));
  assert.ok(withContracts.length >= 1, `expected at least one of ${JSON.stringify(adapterDirs)} to ship both files`);
});

// ---- bridge v1 protocol schema (BRIDGE_SCHEMA is loaded at the top of this file) -------------
test("[fast] bridge.v1.schema.json accepts the documented command, result and status examples", () => {
  const command = { id: "1700000000000-1234", action: "grab", serial: 0x40000010, name: "Ring",
    chain: [0x40000001, 0x40000002], pos: { x: 120, y: 340, z: 0 }, queuedAt: "2026-01-01T12:00:00.000Z" };
  assert.ok(validate(BRIDGE_SCHEMA.command, command).ok);

  const result = { ok: true, msg: "grabbed Ring — it is in your backpack", t: "2026-01-01T12:00:01-07:00" };
  assert.ok(validate(BRIDGE_SCHEMA.result, result).ok);

  const status = { alive: "2026-01-01T12:00:02-07:00", character: "Fixture", current: null,
    results: { "1700000000000-1234": result }, counts: { done: 1, failed: 0 } };
  assert.ok(validate(BRIDGE_SCHEMA.status, status).ok);

  const stoppedStatus = { ...status, stopped: true };
  assert.ok(validate(BRIDGE_SCHEMA.status, stoppedStatus).ok);
});

test("[fast] bridge.v1.schema.json rejects an unknown action", () => {
  const command = { id: "x", action: "delete-everything", serial: 1, name: "n", chain: [], pos: null, queuedAt: "2026-01-01T12:00:00.000Z" };
  const { ok } = validate(BRIDGE_SCHEMA.command, command);
  assert.equal(ok, false);
});

// ---- what the app actually sends today ---------------------------------------------------------
// POST /api/bridge (app/vault-server.mts) builds every line as
// {id, action, serial, name, chain: body.chain || [], pos: body.pos ?? null, queuedAt: new
// Date().toISOString()}, and app/ui/bridge.mts's sendBridge() supplies action/serial/name/chain
// (chainOf, at most 8 entries) and pos (rootPos, `null` for every item the fold produces today).
// The tightened `pos`/`queuedAt` types below must keep all of that valid — a schema that refused the
// app's own Grab-all burst would be a worse bug than the one it fixes.
test("[fast] bridge.v1.schema.json accepts exactly what POST /api/bridge writes today", () => {
  const line = (over: Record<string, unknown> = {}) => ({
    id: `${Date.now()}-4213`, action: "grab", serial: 0x40000010, name: "Ring",
    chain: [0x40000001, 0x40000002], pos: null, queuedAt: new Date().toISOString(), ...over,
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
  const line = (queuedAt: unknown) => ({ id: "x", action: "grab", serial: 1, name: "n", chain: [], pos: null, queuedAt });
  assert.ok(validate(BRIDGE_SCHEMA.command, line(new Date().toISOString())).ok);
  assert.ok(validate(BRIDGE_SCHEMA.command, line("2026-01-01T12:00:00+02:00")).ok);
  for (const bad of ["", "yesterday", "2026-01-01", 1767268800]) {
    assert.equal(validate(BRIDGE_SCHEMA.command, line(bad)).ok, false, `accepted queuedAt=${JSON.stringify(bad)}`);
  }
  const { ok } = validate(BRIDGE_SCHEMA.command, { id: "x", action: "grab", serial: 1, name: "n", chain: [], pos: null });
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
