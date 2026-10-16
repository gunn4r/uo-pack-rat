// fold-blank.test.mts — `foldSnapshots` and an item a scan recorded with no name and no tooltip (issue #298).
//
// Such a record (its tooltip never arrived before the scan moved on) says only where the item is. It keeps the last known name and properties, the one in the same root and one that moved to another container alike, and takes the new place and the graphic, hue and amount the client reported; a worn piece too. A blank item the fold never saw before is still listed. `[fast]`.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { foldSnapshots, setRules } from "./vault-lib.mts";
import { validateScan } from "./scan-schema.mts";
import type { RulesV1, ScanV2 } from "./schema/types.d.mts";

setRules(JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "rules", "uoalive.json"), "utf8")) as RulesV1);

const CHEST = 100, CHEST2 = 110, RING = 200, GEM = 201, NEW = 202;
const RING_TIP = ["Ruby Ring", "Strength Bonus 5", "Hit Chance Increase 10%"];
const item = (serial: number, container: number, tooltip: string[]) => ({ serial, container, name: tooltip[0] ?? "", nameSource: "opl", tooltip, graphic: 0x108a, hue: 0, amount: 1 });
const ground = (serial: number) => ({ serial, kind: "ground", name: "Chest " + serial, parent: null, root: serial });
const scan = (scannedAt: string, items: ReturnType<typeof item>[], roots = [CHEST], equipped: unknown[] = []): ScanV2 => {
  const doc = {
    schemaVersion: 2, character: "Tester", scannedAt, stats: {},
    adapter: { id: "tazuo", version: "2.18.0", client: "TazUO", clientVersion: null,
      capabilities: { layers: [], arms: true, bank: true, ground: true, nested: true, tooltips: "opl", bridge: [] } },
    roots: roots.map((serial) => ({ serial, kind: "ground", name: "Chest " + serial, opened: true })),
    containers: Object.fromEntries(roots.map((r) => [r, ground(r)])), items, equipped,
  };
  const v = validateScan(doc);
  assert.equal(v.ok, true, JSON.stringify(v.errors));
  return doc as unknown as ScanV2;
};
const first = scan("2026-09-20T10:00:00Z", [item(RING, CHEST, RING_TIP), item(GEM, CHEST, ["Ruby"])]);

test("[fast] a blank record keeps the older name and properties", () => {
  const inv = foldSnapshots([first, scan("2026-09-21T10:00:00Z", [item(RING, CHEST, []), item(GEM, CHEST, ["Ruby"])])]);
  const ring = inv.items[RING]!;
  assert.equal(ring.name, "Ruby Ring");
  assert.deepEqual(ring.lines, foldSnapshots([first]).items[RING]!.lines);
  assert.equal(ring.seenAt, "2026-09-21T10:00:00Z", "it was seen in this scan");
});

test("[fast] a blank record takes the graphic, hue and amount the client reported", () => {
  const now = { ...item(RING, CHEST, []), graphic: 0x108b, hue: 0x21, amount: 120 };
  const ring = foldSnapshots([first, scan("2026-09-21T10:00:00Z", [now])]).items[RING]!;
  assert.equal(ring.name, "Ruby Ring");
  assert.deepEqual([ring.graphic, ring.hue, ring.amount], [0x108b, 0x21, 120]);
});

test("[fast] a blank record that moved keeps its name and takes the new place", () => {
  const inv = foldSnapshots([first, scan("2026-09-21T10:00:00Z", [item(RING, CHEST2, [])], [CHEST2])]);
  assert.equal(inv.items[RING]!.name, "Ruby Ring");
  assert.equal(inv.items[RING]!.root, CHEST2);
  assert.equal(inv.items[RING]!.container, CHEST2);
  assert.ok(inv.items[GEM], "the old root was not rescanned");
});

test("[fast] a blank worn piece keeps its name", () => {
  const worn = { ...item(RING, 0, []), container: null, layer: "Ring" };
  const inv = foldSnapshots([first, scan("2026-09-21T10:00:00Z", [], [CHEST2], [worn])]);
  assert.equal(inv.items[RING]!.name, "Ruby Ring");
  assert.equal(inv.items[RING]!.equippedBy, "Tester");
  assert.equal(inv.items[RING]!.root, null);
});

test("[fast] a blank item never seen before still shows up", () => {
  const inv = foldSnapshots([first, scan("2026-09-21T10:00:00Z", [item(NEW, CHEST, [])])]);
  assert.ok(inv.items[NEW]);
  assert.equal(inv.items[NEW]!.container, CHEST);
  assert.equal(inv.items[RING], undefined, "the rest of the root is replaced as usual");
});
