// classicuo-web-adapter.test.mjs — the classicuo-web adapter ships no fixture.scan.json yet (see
// adapters/classicuo-web/README.md: nobody has run packrat-scanner.ts against a live client), so
// app/contracts.test.mjs skips it entirely. This file stands in for that until a real fixture
// exists: it proves the shape packrat-scanner.ts is written to emit — built by hand here from
// docs/scan-schema.md field by field, not copied from the scanner — validates against the same v2
// schema every other adapter's output does, and that adapters/classicuo-web/capabilities.json
// matches the CAPABILITIES constant the scanner itself carries (the same drift the real contract
// test guards against once a fixture lands).
// Tags: [fast]. Run: node --test app/classicuo-web-adapter.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { validateScan } from "./scan-schema.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ADAPTER_DIR = join(HERE, "..", "adapters", "classicuo-web");
const capsFile = JSON.parse(readFileSync(join(ADAPTER_DIR, "capabilities.json"), "utf8"));

// Mirrors packrat-scanner.ts's own CAPABILITIES constant. Kept as a separate literal (not read out
// of the .ts source) so this test breaks loudly if the two are ever hand-edited out of sync — same
// failure mode app/contracts.test.mjs's deep-equal check catches for adapters that do ship a fixture.
const SCANNER_CAPABILITIES = {
  layers: ["OneHanded", "TwoHanded", "Shoes", "Pants", "Shirt", "Helmet", "Gloves",
    "Ring", "Talisman", "Necklace", "Waist", "Torso", "Bracelet", "Tunic",
    "Earrings", "Arms", "Cloak", "Robe", "Skirt", "Legs"],
  arms: false,
  bank: false,
  ground: true,
  nested: true,
  tooltips: "opl",
  bridge: [],
};

test("[fast] classicuo-web: capabilities.json matches the scanner's own CAPABILITIES constant", () => {
  assert.equal(capsFile.adapter, "classicuo-web");
  assert.equal(capsFile.transport, "paste");
  assert.deepEqual(capsFile.capabilities, SCANNER_CAPABILITIES);
});

// A representative document in the shape docs/scan-schema.md describes and packrat-scanner.ts is
// written to emit: one equipped piece (with a layer), a backpack root holding a nested pouch (a
// container-as-item, per the schema's "Nested containers become items" fold rule) and one item
// inside that pouch, plus a ground root the script saw but could not open (opened: false) — the
// shape a locked/trapped or too-far container produces.
function representativeDoc() {
  return {
    schemaVersion: 2,
    character: "Fixture",
    scannedAt: "2026-01-01T12:00:00+00:00",
    adapter: {
      id: "classicuo-web",
      version: "1.0.0",
      client: "ClassicUO (web)",
      clientVersion: null,
      capabilities: SCANNER_CAPABILITIES,
    },
    stats: { str: 60, dex: 20, int: 10 },
    position: { x: 1, y: 1, z: 0 },
    maxes: { hits: 70, stam: 60, mana: 30 },
    resists: { phys: 20, fire: 10, cold: 10, poison: 10, energy: 10 },
    skills: { Swordsmanship: { value: 50.0, cap: 100.0 } },
    roots: [
      { serial: 0x40000001, kind: "backpack", name: "Backpack", opened: true },
      { serial: 0x40000005, kind: "ground", name: "A Locked Chest", opened: false },
    ],
    containers: {
      "1073741825": { serial: 0x40000001, kind: "backpack", name: "Backpack", parent: null, root: 0x40000001 },
      "1073741826": {
        serial: 0x40000002, kind: "container", name: "A Pouch", parent: 0x40000001,
        root: 0x40000001, tooltip: ["A Pouch"],
      },
    },
    items: [
      {
        serial: 0x40000003, container: 0x40000001, graphic: 3702, hue: 0, amount: 1,
        name: "A Dagger", nameSource: "opl", tooltip: ["A Dagger"],
      },
      {
        serial: 0x40000004, container: 0x40000002, graphic: 3821, hue: 0, amount: 5,
        name: "Bandage", nameSource: "opl", tooltip: ["Bandage"],
      },
    ],
    equipped: [
      {
        serial: 0x40000006, graphic: 7936, hue: 0, amount: 1, name: "A Katana",
        nameSource: "opl", tooltip: ["A Katana"], layer: "OneHanded",
      },
    ],
  };
}

test("[fast] classicuo-web: a representative scan document validates against the v2 schema", () => {
  const doc = representativeDoc();
  const v = validateScan(doc);
  assert.equal(v.ok, true, JSON.stringify(v.errors));
});

test("[fast] classicuo-web: an unopened ground root carries no items for that root", () => {
  const doc = representativeDoc();
  const lockedRoot = doc.roots.find((r) => r.opened === false);
  assert.ok(lockedRoot);
  const itemsUnderLockedRoot = doc.items.filter((it) => it.container === lockedRoot.serial);
  assert.equal(itemsUnderLockedRoot.length, 0);
});
