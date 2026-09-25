// retention.test.mts — app/retention.mts: which old scans and saved runs pruning removes (issue #28),
// and that the inventory folded from what is left is the inventory folded from everything.
// Tags: [fast]. Run: node --test app/retention.test.mts
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { foldSnapshots, setRules } from "./vault-lib.mts";
import { validateScan } from "./scan-schema.mts";
import { RETENTION_DEFAULTS, retentionError, retentionOf, runsToPrune, sameFold, scansToPrune, type ScanFile } from "./retention.mts";
import type { RulesV1, ScanV2 } from "./schema/types.d.mts";

setRules(JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "rules", "uoalive.json"), "utf8")) as RulesV1);

const NOW = Date.parse("2026-09-24T12:00:00Z");
const daysAgo = (d: number): string => new Date(NOW - d * 86_400_000).toISOString();
const CHEST = 100, OLDCHEST = 110, EMPTIED = 120, BAG = 101, PACK = 300, PACK_B = 400;
const item = (serial: number, container: number, name: string) => ({ serial, container, name, nameSource: "opl", tooltip: [name] });
interface Root { serial: number; kind?: string; opened?: boolean }
const scan = (file: string, scannedAt: string, character: string, roots: Root[], containers: Record<string, unknown>, items: ReturnType<typeof item>[], equipped: unknown[] = [], extra: Record<string, unknown> = {}): ScanFile => {
  const doc = {
    schemaVersion: 2, character, scannedAt, stats: {},
    adapter: { id: "tazuo", version: "2.3.0", client: "TazUO", clientVersion: null,
      capabilities: { layers: [], arms: true, bank: true, ground: true, nested: true, tooltips: "opl", bridge: [] } },
    roots: roots.map((r) => ({ serial: r.serial, kind: r.kind || "ground", name: `Root ${r.serial}`, opened: r.opened !== false })),
    containers, items, equipped, ...extra,
  };
  const v = validateScan(doc);
  assert.equal(v.ok, true, JSON.stringify(v.errors));
  return { file, doc: doc as unknown as ScanV2 };
};
const box = (serial: number, root = serial, parent: number | null = null, extra: Record<string, unknown> = {}) => ({ serial, kind: parent == null ? "ground" : "container", name: `Box ${serial}`, parent, root, ...extra });
const worn = (serial: number, name: string) => ({ serial, name, layer: "Ring", nameSource: "opl", tooltip: [name] });

// Ninety days of one character's scans of a chest and their backpack, plus: a chest scanned once long
// ago, a character scanned once long ago, a chest emptied long ago, a bag the newest scan could not
// open, a Forget tombstone and a Forget-character tombstone, both old.
const history: ScanFile[] = [
  scan("a-90.json", daysAgo(90), "Aldo", [{ serial: CHEST }, { serial: PACK, kind: "backpack" }], { [CHEST]: box(CHEST), [BAG]: box(BAG, CHEST, CHEST), [PACK]: box(PACK) },
    [item(1, CHEST, "Gem"), item(2, BAG, "Ring"), item(3, PACK, "Bandage")], [worn(50, "Gold Ring")]),
  scan("a-60.json", daysAgo(60), "Aldo", [{ serial: CHEST }, { serial: PACK, kind: "backpack" }, { serial: OLDCHEST }, { serial: EMPTIED }],
    { [CHEST]: box(CHEST), [BAG]: box(BAG, CHEST, CHEST), [PACK]: box(PACK), [OLDCHEST]: box(OLDCHEST), [EMPTIED]: box(EMPTIED) },
    [item(1, CHEST, "Gem"), item(2, BAG, "Ring"), item(4, BAG, "Pearl"), item(3, PACK, "Bandage"), item(5, OLDCHEST, "Old Sword"), item(6, EMPTIED, "Doomed Shield")], [worn(50, "Gold Ring")]),
  scan("b-50.json", daysAgo(50), "Brin", [{ serial: PACK_B, kind: "backpack" }], { [PACK_B]: box(PACK_B) }, [item(7, PACK_B, "Lute")], [worn(51, "Silver Ring")]),
  scan("a-45.json", daysAgo(45), "Aldo", [{ serial: EMPTIED }], {}, []),
  scan("_forget-7b.json", daysAgo(44), "_vault", [{ serial: 123 }], {}, []),
  scan("_forget-char-6361.json", daysAgo(43), "_vault", [], {}, [], [], { forgetCharacter: "Cai" }),
  scan("a-40.json", daysAgo(40), "Aldo", [{ serial: CHEST }, { serial: PACK, kind: "backpack" }], { [CHEST]: box(CHEST), [BAG]: box(BAG, CHEST, CHEST, { opened: false }), [PACK]: box(PACK) },
    [item(1, CHEST, "Gem"), item(3, PACK, "Bandage")], [worn(50, "Gold Ring")]),
  scan("a-35.json", daysAgo(35), "Aldo", [{ serial: PACK, kind: "backpack" }], { [PACK]: box(PACK) }, [item(3, PACK, "Bandage"), item(8, PACK, "Scroll")], [worn(52, "Bone Ring")]),
  scan("a-10.json", daysAgo(10), "Aldo", [{ serial: CHEST }, { serial: PACK, kind: "backpack" }], { [CHEST]: box(CHEST), [BAG]: box(BAG, CHEST, CHEST, { opened: false }), [PACK]: box(PACK) },
    [item(1, CHEST, "Gem"), item(3, PACK, "Bandage")], [worn(52, "Bone Ring")]),
];
const docs = (files: ScanFile[]): ScanV2[] => files.map((s) => s.doc);

test("[fast] pruning old scans leaves the folded inventory exactly as it was", () => {
  const pruned = scansToPrune(history, foldSnapshots, RETENTION_DEFAULTS, NOW).files;
  assert.ok(pruned.length > 0, "something old was pruned");
  const kept = history.filter((s) => !pruned.includes(s.file));
  assert.ok(sameFold(foldSnapshots(docs(history)), foldSnapshots(docs(kept))));
  const inv = foldSnapshots(docs(kept));
  assert.ok(inv.items[2] && inv.items[4], "the unopened bag still holds what an older scan saw in it");
  assert.ok(inv.items[5], "a chest scanned once long ago keeps its contents");
  assert.equal(inv.items[6], undefined, "a chest emptied long ago stays empty");
  assert.ok(inv.characters.Brin && inv.items[51], "a character scanned once long ago keeps their card and worn set");
});

test("[fast] kept: recent scans, the newest per root, what the fold still shows, and tombstones", () => {
  const pruned = scansToPrune(history, foldSnapshots, RETENTION_DEFAULTS, NOW).files;
  // a-40 and a-35 are old and everything they said was overwritten by a-10; a-60 is the newest scan
  // of the old chest and what the unopened bag still shows; a-45 the newest (empty) scan of EMPTIED.
  assert.deepEqual(pruned, ["a-90.json", "a-40.json", "a-35.json"]);
});

test("[fast] a shorter window prunes more, still without changing the fold", () => {
  const extra = [...history, scan("a-80.json", daysAgo(80), "Aldo", [{ serial: CHEST }], { [CHEST]: box(CHEST) }, [item(1, CHEST, "Gem")])];
  const pruned = scansToPrune(extra, foldSnapshots, { ...RETENTION_DEFAULTS, scanDays: 1 }, NOW).files;
  assert.deepEqual(pruned, ["a-90.json", "a-80.json", "a-40.json", "a-35.json"], "oldest first");
  assert.ok(sameFold(foldSnapshots(docs(extra)), foldSnapshots(docs(extra.filter((s) => !pruned.includes(s.file))))));
});

test("[fast] Keep everything prunes nothing, and neither does a window that covers every scan", () => {
  assert.deepEqual(scansToPrune(history, foldSnapshots, { ...RETENTION_DEFAULTS, keepAll: true }, NOW), { files: [], refused: false });
  assert.deepEqual(scansToPrune(history, foldSnapshots, { ...RETENTION_DEFAULTS, scanDays: 365 }, NOW), { files: [], refused: false });
});

test("[fast] when the pruned fold would differ, nothing is pruned and the refusal is reported", () => {
  const countingFold = (d: ScanV2[]) => ({ characters: {}, containers: {}, items: { n: d.length } as never, scans: [] });
  assert.deepEqual(scansToPrune(history, countingFold, RETENTION_DEFAULTS, NOW), { files: [], refused: true });
});

test("[fast] saved runs: each character keeps its newest N unnamed runs, and every named one", () => {
  const runs = [
    ...[1, 2, 3, 4, 5].map((d) => ({ file: `a${d}.json`, character: "Aldo", createdAt: daysAgo(d), label: d === 2 || d === 5 ? "keeper" : "" })),
    { file: "b1.json", character: "Brin", createdAt: daysAgo(100), label: "" },
  ];
  assert.deepEqual(runsToPrune(runs, { ...RETENTION_DEFAULTS, runsPerCharacter: 2 }).sort(), ["a4.json"]);
  assert.deepEqual(runsToPrune(runs, RETENTION_DEFAULTS), []);
  assert.deepEqual(runsToPrune(runs, { keepAll: true, scanDays: 1, runsPerCharacter: 1 }), []);
});

test("[fast] retention settings are validated with their bounds, and a bad stored value reads as its default", () => {
  assert.equal(retentionError({ keepAll: true }), null);
  assert.equal(retentionError({ scanDays: 7, runsPerCharacter: 10 }), null);
  assert.match(retentionError({ scanDays: 0 })!, /Days to keep scans must be a whole number from 1 to 3650\./);
  assert.match(retentionError({ runsPerCharacter: 2.5 })!, /Saved runs per character must be a whole number from 1 to 1000\./);
  assert.match(retentionError({ keepAll: "yes" })!, /keepAll must be a boolean/);
  assert.match(retentionError({ days: 3 })!, /days is not a setting/);
  assert.match(retentionError([1])!, /must be an object/);
  assert.deepEqual(retentionOf(undefined), RETENTION_DEFAULTS);
  assert.deepEqual(retentionOf({ scanDays: -4, runsPerCharacter: 20, keepAll: "no" }), { ...RETENTION_DEFAULTS, runsPerCharacter: 20 });
});
