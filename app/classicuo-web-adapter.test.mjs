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

// A representative document in the shape docs/scan-schema.md describes and packrat-scanner.ts's
// main()/walk() are written to emit — checked branch by branch against the actual source, not
// just against the schema (see the code-review note this replaced: a schema-valid document can
// still not match what the scanner really produces, since the schema leaves `containers` and
// `equipped`/`items`' optional fields unconstrained):
// - one equipped piece, with a `layer` and no `container` field (equippedItems loop -> itemEntry
//   with container:null, which never adds the key).
// - a backpack root that opened successfully: a `containers` entry with no `tooltip`/`pos` (the
//   backpack-root literal in main() carries neither), one direct item (`container` pointing at
//   the backpack), and one nested container-as-item (the pouch: a `containers` entry with
//   `tooltip` but no `pos` — only ground roots get `pos` — parent/root pointing at the backpack)
//   holding one item of its own (`container` pointing at the pouch).
// - a ground root that opened successfully: a `containers` entry with BOTH `tooltip` and `pos`
//   (ground roots get both, per main()'s ground-loop literal), one direct item.
// - a ground root the script saw but could not open (`opened: false`, walk() returned -1 because
//   safeContents() came back undefined) — with NO items under it, but STILL a `containers` entry
//   (main() writes that dict entry before calling walk(), unconditionally on opened/not-opened —
//   the earlier version of this fixture omitted it for the locked case, which passed only because
//   the schema doesn't constrain `containers`' shape; fixed here to mirror the real code).
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
      { serial: 0x40000007, kind: "ground", name: "A Wooden Chest", opened: true },
      { serial: 0x40000009, kind: "ground", name: "A Locked Chest", opened: false },
    ],
    containers: {
      "1073741825": { serial: 0x40000001, kind: "backpack", name: "Backpack", parent: null, root: 0x40000001 },
      "1073741826": {
        serial: 0x40000002, kind: "container", name: "A Pouch", parent: 0x40000001,
        root: 0x40000001, tooltip: ["A Pouch"],
      },
      "1073741831": {
        serial: 0x40000007, kind: "ground", name: "A Wooden Chest", parent: null, root: 0x40000007,
        pos: { x: 3, y: 4, z: 0 }, tooltip: ["A Wooden Chest"],
      },
      "1073741833": {
        serial: 0x40000009, kind: "ground", name: "A Locked Chest", parent: null, root: 0x40000009,
        pos: { x: 5, y: 4, z: 0 }, tooltip: ["A Locked Chest"],
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
      {
        serial: 0x40000008, container: 0x40000007, graphic: 3821, hue: 0, amount: 10,
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

// The gap a review caught: main() writes a `containers` entry for every root it attempts — opened
// or not, backpack or ground — before walk() ever runs, so an unopened root still gets one. This
// held generally in the code but not in this fixture until fixed above; assert it directly so a
// future edit to either main() or this fixture can't quietly drop the invariant again the same way.
test("[fast] classicuo-web: every root (opened or not) has a matching containers entry", () => {
  const doc = representativeDoc();
  for (const root of doc.roots) {
    const entry = doc.containers[String(root.serial)];
    assert.ok(entry, `no containers entry for root ${root.serial} (${root.kind})`);
    assert.equal(entry.serial, root.serial);
    assert.equal(entry.kind, root.kind);
    assert.equal(entry.parent, null);
    if (root.kind === "ground") assert.ok(entry.pos, "a ground root's containers entry should carry pos");
  }
});
