// fold-unopened.test.mts — foldSnapshots and a container a scan saw but could not open. A scanner
// marks such a bag `opened: false` on its `containers` entry (a bag that did not open, one nested
// deeper than the adapter reads) instead of leaving the whole root unrecorded, and the fold keeps
// what it last knew INSIDE that bag while the rest of the root updates normally.
// Tags: [fast]. Run: node --test app/fold-unopened.test.mts
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { foldSnapshots, setRules } from "./vault-lib.mts";
import { validateScan } from "./scan-schema.mts";
import type { RulesV1, ScanV2 } from "./schema/types.d.mts";

setRules(JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "rules", "uoalive.json"), "utf8")) as RulesV1);

const CHEST = 100, CHEST2 = 110, BAG = 101, POUCH = 102, RING = 200, GEM = 201, PEARL = 202, NEWGEM = 203;
const item = (serial: number, container: number, name: string) => ({ serial, container, name, nameSource: "opl", tooltip: [name] });
const scan = (scannedAt: string, containers: Record<string, unknown>, items: ReturnType<typeof item>[],
  roots: number[] = [CHEST], character = "Tester"): ScanV2 => {
  const doc = {
    schemaVersion: 2, character, scannedAt, stats: {},
    adapter: { id: "tazuo", version: "2.2.0", client: "TazUO", clientVersion: null,
      capabilities: { layers: [], arms: true, bank: true, ground: true, nested: true, tooltips: "opl", bridge: [] } },
    roots: roots.map((serial) => ({ serial, kind: "ground", name: "Chest " + serial, opened: true })),
    containers, items, equipped: [],
  };
  const v = validateScan(doc);
  assert.equal(v.ok, true, JSON.stringify(v.errors));
  return doc as unknown as ScanV2;
};
const chest = { serial: CHEST, kind: "ground", name: "Chest", parent: null, root: CHEST };
const bag = (extra: Record<string, unknown> = {}) => ({ serial: BAG, kind: "container", name: "Bag", parent: CHEST, root: CHEST, ...extra });
const pouch = { serial: POUCH, kind: "container", name: "Pouch", parent: BAG, root: CHEST };

const first = scan("2026-09-20T10:00:00Z", { [CHEST]: chest, [BAG]: bag(), [POUCH]: pouch },
  [item(RING, BAG, "Ring"), item(PEARL, POUCH, "Pearl"), item(GEM, CHEST, "Gem")]);

test("[fast] a bag the newest scan could not open keeps its old contents while the rest of the root updates", () => {
  const second = scan("2026-09-21T10:00:00Z", { [CHEST]: chest, [BAG]: bag({ opened: false }) }, [item(NEWGEM, CHEST, "New Gem")]);
  const inv = foldSnapshots([first, second]);
  assert.ok(inv.items[RING], "the ring inside the unopened bag is kept");
  assert.ok(inv.items[PEARL], "so is the pearl in the pouch inside it");
  assert.ok(inv.items[POUCH] && inv.containers[POUCH], "and the pouch itself");
  assert.equal(inv.items[RING]!.seenAt, "2026-09-20T10:00:00Z", "kept items keep the date they were last seen");
  assert.ok(inv.items[BAG], "the bag is still listed as a bag in the chest");
  assert.ok(inv.items[NEWGEM], "the rest of the root updates");
  assert.equal(inv.items[GEM], undefined, "a piece gone from the opened part of the root is gone");
});

test("[fast] once the bag opens again its contents are replaced as usual", () => {
  const second = scan("2026-09-21T10:00:00Z", { [CHEST]: chest, [BAG]: bag({ opened: false }) }, []);
  const third = scan("2026-09-22T10:00:00Z", { [CHEST]: chest, [BAG]: bag() }, []);
  const inv = foldSnapshots([first, second, third]);
  assert.equal(inv.items[RING], undefined);
  assert.equal(inv.items[PEARL], undefined);
  assert.ok(inv.items[BAG]);
});

// The unopened bag may have moved since the last scan: into another chest, or another character's
// chest. What is kept inside it now lives under the bag's NEW root — otherwise the next scan of the
// old chest would delete it, though it is still in the bag.
for (const character of ["Tester", "Other"]) {
  test(`[fast] contents kept inside an unopened bag that moved to another chest follow it there (scanned by ${character})`, () => {
    const chest2 = { serial: CHEST2, kind: "ground", name: "Chest 2", parent: null, root: CHEST2 };
    const moved = scan("2026-09-21T10:00:00Z", { [CHEST]: chest, [CHEST2]: chest2, [BAG]: { ...bag({ opened: false }), parent: CHEST2, root: CHEST2 } }, [], [CHEST, CHEST2], character);
    let inv = foldSnapshots([first, moved]);
    for (const s of [RING, PEARL, POUCH]) {
      assert.equal(inv.items[s]!.root, CHEST2, `item ${s} follows the bag`);
      assert.equal(inv.items[s]!.scannedBy, character);
    }
    assert.equal(inv.containers[POUCH]!.root, CHEST2);
    assert.equal(inv.containers[POUCH]!.scannedBy, character);
    const oldChestAgain = scan("2026-09-22T10:00:00Z", { [CHEST]: chest }, []);
    inv = foldSnapshots([first, moved, oldChestAgain]);
    assert.ok(inv.items[RING] && inv.items[PEARL] && inv.items[POUCH], "a later scan of the old chest leaves them alone");
  });
}
