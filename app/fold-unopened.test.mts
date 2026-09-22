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

const CHEST = 100, BAG = 101, POUCH = 102, RING = 200, GEM = 201, PEARL = 202, NEWGEM = 203;
const item = (serial: number, container: number, name: string) => ({ serial, container, name, nameSource: "opl", tooltip: [name] });
const scan = (scannedAt: string, containers: Record<string, unknown>, items: ReturnType<typeof item>[]): ScanV2 => {
  const doc = {
    schemaVersion: 2, character: "Tester", scannedAt, stats: {},
    adapter: { id: "tazuo", version: "2.2.0", client: "TazUO", clientVersion: null,
      capabilities: { layers: [], arms: true, bank: true, ground: true, nested: true, tooltips: "opl", bridge: [] } },
    roots: [{ serial: CHEST, kind: "ground", name: "Chest", opened: true }],
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
