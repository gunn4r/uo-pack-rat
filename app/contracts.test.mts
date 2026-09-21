// contracts.test.mjs — folds every adapter's fixture.scan.json against its own capabilities.json,
// checking the two contracts agree with each other and with the shared scan/bridge schemas. An
// "adapter" here is any directory under adapters/ that ships both a capabilities.json and a
// fixture.scan.json (today: adapters/tazuo/); a future adapter picks these tests up for free just by
// shipping those two files.
// Run: node --test app/contracts.test.mjs   or   node app/contracts.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validate } from "./schema/validate.mts";
import { SCAN_V2_SCHEMA } from "./scan-schema.mts";
import { foldSnapshots, setRules } from "./vault-lib.mts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(HERE);
const ADAPTERS_DIR = join(ROOT, "adapters");

// Every test in this file runs against the UO Alive shard rules, same as gear-vault.test.mjs —
// foldSnapshots needs setRules() called before anything else touches it.
setRules(JSON.parse(readFileSync(join(HERE, "rules", "uoalive.json"), "utf8")));

const adapterDirs = existsSync(ADAPTERS_DIR)
  ? readdirSync(ADAPTERS_DIR, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
  : [];

for (const name of adapterDirs) {
  const dir = join(ADAPTERS_DIR, name);
  const capsPath = join(dir, "capabilities.json");
  const fixturePath = join(dir, "fixture.scan.json");
  if (!existsSync(capsPath) || !existsSync(fixturePath)) continue;   // not every adapters/* subdir ships a contract yet

  test(`[smoke] adapters/${name}: capabilities.json validates against the scan schema's capabilities shape`, () => {
    const caps = JSON.parse(readFileSync(capsPath, "utf8"));
    const { ok, errors } = validate(SCAN_V2_SCHEMA.properties.adapter.properties.capabilities, caps.capabilities);
    assert.ok(ok, JSON.stringify(errors));
  });

  test(`[smoke] adapters/${name}: fixture.scan.json validates against scan.v2.schema.json`, () => {
    const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
    const { ok, errors } = validate(SCAN_V2_SCHEMA, fixture);
    assert.ok(ok, JSON.stringify(errors));
  });

  test(`[smoke] adapters/${name}: fixture folds into a character with a nested container and worn items located on it`, () => {
    const caps = JSON.parse(readFileSync(capsPath, "utf8"));
    const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
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

// ---- bridge v1 protocol schema -------------------------------------------------------------
const BRIDGE_SCHEMA = JSON.parse(readFileSync(join(HERE, "schema", "bridge.v1.schema.json"), "utf8"));

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
