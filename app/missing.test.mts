// missing.test.mts — missingSinceLastScan (issue #99): what left a root container between its last two scans
// and is nowhere else in the inventory now. Tags: [fast]. Run: node --test app/missing.test.mts
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { foldSnapshots, getRules, setRules } from "./vault-lib.mts";
import { missingSinceLastScan } from "./missing.mts";
import { validateScan } from "./scan-schema.mts";
import type { RulesV1, ScanV2 } from "./schema/types.d.mts";

setRules(JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "rules", "uoalive.json"), "utf8")) as RulesV1);

const CHEST = 100, CHEST2 = 110, BAG = 101, TRASH = 102, RING = 200, GEM = 201, PEARL = 202, BANDAGES = 203, SWORD = 204, PEARL2 = 205;
const T1 = "2026-09-20T10:00:00Z", T2 = "2026-09-21T10:00:00Z", T3 = "2026-09-22T10:00:00Z";
const item = (serial: number, container: number, name: string, amount = 1, hue = 0) => ({ serial, container, name, nameSource: "opl", amount, graphic: 0x0f7a, hue, tooltip: [amount > 1 ? `${amount} ${name}` : name] });
const chestOf = (serial: number) => ({ serial, kind: "ground", name: "Chest", parent: null, root: serial });
const bag = { serial: BAG, kind: "container", name: "Bag", parent: CHEST, root: CHEST };
const trash = { serial: TRASH, kind: "container", name: "Trash Barrel", parent: CHEST, root: CHEST };
const scan = (scannedAt: string, items: ReturnType<typeof item>[], { roots = [CHEST], containers = {} as Record<string, unknown>, equipped = [] as unknown[], character = "Tester" } = {}): ScanV2 => {
  const doc = {
    schemaVersion: 2, character, scannedAt, stats: {},
    adapter: { id: "tazuo", version: "2.3.0", client: "TazUO", clientVersion: null,
      capabilities: { layers: [], arms: true, bank: true, ground: true, nested: true, tooltips: "opl", bridge: [] } },
    roots: roots.map((serial) => ({ serial, kind: "ground", name: "Chest", opened: true })),
    containers: { ...Object.fromEntries(roots.map((r) => [r, chestOf(r)])), ...containers }, items, equipped,
  };
  const v = validateScan(doc);
  assert.equal(v.ok, true, JSON.stringify(v.errors));
  return doc as unknown as ScanV2;
};
const missing = (snaps: ScanV2[]) => missingSinceLastScan(snaps, foldSnapshots(snaps));

test("[fast] a root scanned once has nothing missing", () => {
  assert.deepEqual(missing([scan(T1, [item(RING, CHEST, "Ring")])]), {});
});

test("[fast] an item gone from a root and from everywhere else is missing, with when it was last seen there", () => {
  const got = missing([scan(T1, [item(RING, CHEST, "Ring"), item(GEM, CHEST, "Gem")]), scan(T2, [item(GEM, CHEST, "Gem")])]);
  assert.deepEqual(got, { [CHEST]: [{ serial: RING, name: "Ring", amount: 1, lastSeen: T1 }] });
});

test("[fast] an item moved to another scanned container, or now worn, is not missing", () => {
  const before = scan(T1, [item(RING, CHEST, "Ring"), item(SWORD, CHEST, "Katana")]);
  const after = scan(T2, [item(RING, CHEST2, "Ring")], { roots: [CHEST, CHEST2], equipped: [{ serial: SWORD, name: "Katana", nameSource: "opl", layer: "OneHanded", tooltip: ["Katana"] }] });
  assert.deepEqual(missing([before, after]), {});
});

test("[fast] a stack that shrank is reported as fewer, one that grew is not", () => {
  const got = missing([scan(T1, [item(BANDAGES, CHEST, "Bandages", 50), item(GEM, CHEST, "Gem", 2)]), scan(T2, [item(BANDAGES, CHEST, "Bandages", 38), item(GEM, CHEST, "Gem", 5)])]);
  assert.deepEqual(got, { [CHEST]: [{ serial: BANDAGES, name: "Bandages", amount: 50, fewer: 12, lastSeen: T1 }] });
});

test("[fast] only the last two scans of a root are compared", () => {
  const got = missing([scan(T1, [item(RING, CHEST, "Ring"), item(GEM, CHEST, "Gem")]), scan(T2, [item(GEM, CHEST, "Gem")]), scan(T3, [item(GEM, CHEST, "Gem"), item(PEARL, CHEST, "Pearl")])]);
  assert.deepEqual(got, {});
});

test("[fast] a bag and what was in it are missing when the bag is gone", () => {
  const got = missing([scan(T1, [item(RING, BAG, "Ring")], { containers: { [BAG]: bag } }), scan(T2, [])]);
  assert.deepEqual(got[CHEST]!.map((m) => m.serial).sort(), [BAG, RING]);
});

test("[fast] what a bag the newest scan could not open still holds is not missing", () => {
  const got = missing([scan(T1, [item(RING, BAG, "Ring")], { containers: { [BAG]: bag } }), scan(T2, [], { containers: { [BAG]: { ...bag, opened: false } } })]);
  assert.deepEqual(got, {});
});

test("[fast] what sat in a trash container is not missing", () => {
  const got = missing([scan(T1, [item(RING, TRASH, "Ring")], { containers: { [TRASH]: trash } }), scan(T2, [])]);
  assert.deepEqual(got, {});
});

test("[fast] a root that is no longer in the inventory (forgotten) reports nothing", () => {
  const forgotten = { ...scan(T2, []), character: "_vault" } as ScanV2;
  forgotten.containers = {};
  assert.deepEqual(missing([scan(T1, [item(RING, CHEST, "Ring")]), forgotten]), {});
});

test("[fast] a root the newest scan could not open compares its two last opened scans", () => {
  const closed = scan(T3, []);
  closed.roots = [{ ...closed.roots[0]!, opened: false }];
  closed.containers = {};
  const got = missing([scan(T1, [item(RING, CHEST, "Ring")]), scan(T2, []), closed]);
  assert.deepEqual(got[CHEST]!.map((m) => m.serial), [RING]);
});

// Stacks (Organize drops an item onto a matching stack, and only that stack's serial lives on).
test("[fast] a stack merged into a same-kind stack in another scanned chest is not missing", () => {
  const got = missing([scan(T1, [item(PEARL, CHEST, "Black Pearl", 50), item(PEARL2, CHEST2, "Black Pearl", 100)], { roots: [CHEST, CHEST2] }),
    scan(T2, [item(PEARL2, CHEST2, "Black Pearl", 150)], { roots: [CHEST, CHEST2] })]);
  assert.deepEqual(got, {});
});

test("[fast] two stacks combined in the same chest are not missing", () => {
  const got = missing([scan(T1, [item(PEARL, CHEST, "Black Pearl", 50), item(PEARL2, CHEST, "Black Pearl", 20)]), scan(T2, [item(PEARL2, CHEST, "Black Pearl", 70)])]);
  assert.deepEqual(got, {});
});

test("[fast] a stack sold outright is missing: no same-kind stack took it in", () => {
  const got = missing([scan(T1, [item(PEARL, CHEST, "Black Pearl", 50), item(PEARL2, CHEST2, "Black Pearl", 100, 0x455)], { roots: [CHEST, CHEST2] }),
    scan(T2, [item(PEARL2, CHEST2, "Black Pearl", 100, 0x455)], { roots: [CHEST, CHEST2] })]);
  assert.deepEqual(got, { [CHEST]: [{ serial: PEARL, name: "Black Pearl", amount: 50, lastSeen: T1 }] });
});

test("[fast] a same-kind stack last seen before the chest's previous scan explains nothing", () => {
  const got = missing([scan(T1, [item(PEARL2, CHEST2, "Black Pearl", 100)], { roots: [CHEST2] }), scan(T2, [item(PEARL, CHEST, "Black Pearl", 50)]), scan(T3, [])]);
  assert.deepEqual(got, { [CHEST]: [{ serial: PEARL, name: "Black Pearl", amount: 50, lastSeen: T2 }] });
});

test("[fast] only what a same-kind stack could hold is taken as moved; the rest reads as fewer", () => {
  const got = missing([scan(T1, [item(PEARL, CHEST, "Black Pearl", 50)]), scan(T2, [item(PEARL2, CHEST2, "Black Pearl", 20)], { roots: [CHEST, CHEST2] })]);
  assert.deepEqual(got, { [CHEST]: [{ serial: PEARL, name: "Black Pearl", amount: 50, fewer: 30, lastSeen: T1 }] });
});

test("[fast] a stack partly used in place reads as fewer even with a same-kind stack elsewhere", () => {
  const got = missing([scan(T1, [item(PEARL, CHEST, "Black Pearl", 50)]), scan(T2, [item(PEARL, CHEST, "Black Pearl", 36), item(PEARL2, CHEST2, "Black Pearl", 100)], { roots: [CHEST, CHEST2] })]);
  assert.deepEqual(got, { [CHEST]: [{ serial: PEARL, name: "Black Pearl", amount: 50, fewer: 14, lastSeen: T1 }] });
});

test("[fast] a single item is not taken as merged into a same-named single item", () => {
  const got = missing([scan(T1, [item(RING, CHEST, "Ring")]), scan(T2, [item(GEM, CHEST2, "Ring")], { roots: [CHEST, CHEST2] })]);
  assert.deepEqual(got, { [CHEST]: [{ serial: RING, name: "Ring", amount: 1, lastSeen: T1 }] });
});

// A Scroll of Transcendence goes by its skill and points (issue #181) on both sides of the merge check, and in the list.
const sot = (serial: number, container: number, amount: number) => ({ ...item(serial, container, "Scroll Of Transcendence", amount), tooltip: [amount > 1 ? `${amount} Scroll Of Transcendence` : "Scroll Of Transcendence", "Skill: Chivalry 0.6 Skill Points"] });
test("[fast] two stacks of Scrolls of Transcendence merged in another chest are not missing (issue #181)", () => {
  const got = missing([scan(T1, [sot(PEARL, CHEST, 2), sot(PEARL2, CHEST2, 3)], { roots: [CHEST, CHEST2] }), scan(T2, [sot(PEARL2, CHEST2, 5)], { roots: [CHEST, CHEST2] })]);
  assert.deepEqual(got, {});
});
test("[fast] a missing Scroll of Transcendence is listed by its skill and points (issue #181)", () => {
  const got = missing([scan(T1, [sot(PEARL, CHEST, 1)]), scan(T2, [])]);
  assert.deepEqual(got, { [CHEST]: [{ serial: PEARL, name: "Scroll of Transcendence (Chivalry - 0.6 Pts)", amount: 1, lastSeen: T1 }] });
});
test("[fast] missingSinceLastScan reads no shard rules (issue #181)", () => {
  const snaps = [scan(T1, [sot(PEARL, CHEST, 1)]), scan(T2, [])];
  const inv = foldSnapshots(snaps);
  const rules = getRules();
  setRules(null as unknown as RulesV1);
  try {
    assert.deepEqual(missingSinceLastScan(snaps, inv), { [CHEST]: [{ serial: PEARL, name: "Scroll of Transcendence (Chivalry - 0.6 Pts)", amount: 1, lastSeen: T1 }] });
  } finally {
    setRules(rules);
  }
});
