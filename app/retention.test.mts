// retention.test.mts — `app/retention.mts` (issue #28): which old scans and saved runs pruning removes, with the inventory folded from what is left equal to the inventory folded from everything.
//
// `app/retention.mts` (issue #28) on ninety days of synthetic scans: the fold of what pruning keeps equals the fold of everything (a bag the newest scan could not open still holds what an older scan saw, a chest scanned once long ago and a character scanned once long ago stay, a chest emptied long ago stays empty); exactly which files go (oldest first) and that the newest per root and both kinds of `_vault` tombstone stay; a shorter window prunes more with the same fold; Keep everything and a window covering every scan prune nothing; a fold that would differ prunes nothing and says so (`refused`); runs keep each character's newest N unnamed runs and every named one; `retention` settings validated with their bounds and a bad stored value read as its default; and (issue #10) house captures: the newest capture of a house holding a ground chest of the fold is kept however old, an older capture still giving the house a piece of furniture or a chest no scan opened that no newer one could see is kept (pruning leaving the house's chests as they were), a footprint a newer capture overlaps ages out with its scan, and a capture with no ground chest of the fold on its footprint (a boat, a house only visited) ages out like any scan, while a house with any kept capture keeps its captures from that one on (an eraser, a superseding footprint), so house captures beside the ordinary history, or a visited house kept for a bank, never stop pruning or change a listed house. All `[fast]`. House-only files (issue #10): one holding the house's newest capture or furniture is kept however old and pruned once a newer house-only file covers it, and one beside the ordinary history neither keeps a scan nor changes the fold. A capture whose `trash` list hides a seen chest (issue #162) is kept and pruning never brings the chest back; a trash serial no capture lists as a chest keeps nothing.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { foldSnapshots, setRules } from "./vault-lib.mts";
import { validateScan } from "./scan-schema.mts";
import { latestHouses } from "./house-capture.mts";
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

// A house capture (issue #10), and the character's newest scan holding a ground chest standing at (100, 100) on facet 1, inside every house below; without it (`recent`) no house is the player's own.
const capture = (at: string, tiles: number[][], items: number[][] = [], where = { x: 100, y: 100 }, containers?: number[][]) => ({ house: { facet: 1, capturedAt: at, at: where, tiles, items, ...(containers ? { containers } : {}) } });
const homeChest = scan("recent.json", daysAgo(1), "Builder", [{ serial: CHEST }], { [CHEST]: box(CHEST, CHEST, null, { pos: { x: 100, y: 100, z: 7, facet: 1 } }) }, []);
const recent = scan("recent.json", daysAgo(1), "Builder", [], {}, []);
const plot = [[1, 100, 100, 7, 0], [1, 101, 100, 7, 0]];

test("[fast] retention: the newest capture of each house is kept however old", () => {
  const older = scan("house-old.json", daysAgo(90), "Builder", [], {}, [], [], capture(daysAgo(90), plot));
  const newer = scan("house-new.json", daysAgo(80), "Builder", [], {}, [], [], capture(daysAgo(80), plot));
  assert.deepEqual(scansToPrune([older, newer, homeChest], foldSnapshots, RETENTION_DEFAULTS, NOW).files, ["house-old.json"], "homeChest is the character's newest scan, so only the house rule keeps house-new");
});

test("[fast] retention: an older capture is kept while it still gives the house a piece of furniture no newer capture could see", () => {
  const wide = [[1, 100, 100, 7, 0], [1, 140, 100, 7, 0]];
  const seenAgain = scan("house-a.json", daysAgo(95), "Builder", [], {}, [], [], capture(daysAgo(95), wide, [[20, 5, 101, 100, 7]]));
  const farEnd = scan("house-b.json", daysAgo(90), "Builder", [], {}, [], [], capture(daysAgo(90), wide, [[21, 5, 130, 100, 7]], { x: 135, y: 100 }));
  const newest = scan("house-c.json", daysAgo(80), "Builder", [], {}, [], [], capture(daysAgo(80), wide));
  assert.deepEqual(scansToPrune([seenAgain, farEnd, newest, homeChest], foldSnapshots, RETENTION_DEFAULTS, NOW).files, ["house-a.json"], "house-c (standing at 100, 100) no longer sees item 20 and cannot see item 21, 30 tiles away");
});

test("[fast] retention: a house footprint that a newer capture overlaps ages out with its scan", () => {
  const old = scan("house-old.json", daysAgo(90), "Builder", [], {}, [], [], capture(daysAgo(90), plot));
  const grown = scan("house-grown.json", daysAgo(80), "Builder", [], {}, [], [], capture(daysAgo(80), [[1, 99, 100, 7, 0], ...plot]));
  assert.deepEqual(scansToPrune([old, grown, homeChest], foldSnapshots, RETENTION_DEFAULTS, NOW).files, ["house-old.json"]);
});

test("[fast] retention: an old capture of a house with no ground container of the fold inside it ages out like any scan", () => {
  const visited = scan("house-visited.json", daysAgo(90), "Builder", [], {}, [], [], capture(daysAgo(90), plot));
  assert.deepEqual(scansToPrune([visited, recent], foldSnapshots, RETENTION_DEFAULTS, NOW).files, ["house-visited.json"], "a boat, or a house the player only visited");
});

// A house-only file (TazUO's packrat-house-map-refresh.py, kind "house"): the house section and no inventory.
const houseOnly = (file: string, at: string, tiles: number[][], items: number[][] = []): ScanFile => scan(file, at, "Builder", [], {}, [], [], { kind: "house", ...capture(at, tiles, items, undefined, []) });

test("[fast] retention: a house-only file is kept however old while it carries the house's newest capture or furniture, and pruned once a newer capture covers it", () => {
  const full = scan("house-full.json", daysAgo(90), "Builder", [], {}, [], [], capture(daysAgo(90), plot, [[20, 5, 101, 100, 7]]));
  const only = houseOnly("house-only.json", daysAgo(80), plot, [[20, 5, 101, 100, 7]]);
  const all = [full, only, homeChest];
  assert.deepEqual(scansToPrune(all, foldSnapshots, RETENTION_DEFAULTS, NOW), { files: ["house-full.json"], refused: false }, "the house-only file is the newest capture");
  const later = houseOnly("house-later.json", daysAgo(70), plot, [[20, 5, 101, 100, 7]]);
  assert.deepEqual(scansToPrune([...all, later], foldSnapshots, RETENTION_DEFAULTS, NOW), { files: ["house-full.json", "house-only.json"], refused: false }, "a newer house-only file supersedes it");
  assert.deepEqual(houseShape([only, homeChest]), houseShape(all));
});

test("[fast] retention: a house-only file never keeps a scan nor stops pruning, and the fold without it is the same", () => {
  const only = houseOnly("house-only.json", daysAgo(5), plot);
  const r = scansToPrune([...history, only], foldSnapshots, RETENTION_DEFAULTS, NOW);
  assert.deepEqual(r, scansToPrune(history, foldSnapshots, RETENTION_DEFAULTS, NOW));
  assert.ok(sameFold(foldSnapshots(docs([...history, only])), foldSnapshots(docs(history))));
});

const houseShape = (files: ScanFile[]) => latestHouses(docs(files)).map((h) => [h.id, h.capturedAt, h.tiles, h.items, h.containers]);
const BANK = 130;

test("[fast] retention: a capture that erased a piece of furniture is kept while an older capture still showing it stays", () => {
  const wide = [[1, 100, 100, 7, 0], [1, 140, 100, 7, 0]];
  const s1 = scan("s1.json", daysAgo(95), "Builder", [{ serial: OLDCHEST }], { [OLDCHEST]: box(OLDCHEST) }, [], [], capture(daysAgo(95), wide, [[11, 5, 101, 100, 7]]));   // the newest opener of OLDCHEST
  const s2 = scan("s2.json", daysAgo(90), "Builder", [], {}, [], [], capture(daysAgo(90), wide, []));   // item 11 is gone
  const s3 = scan("s3.json", daysAgo(80), "Builder", [], {}, [], [], capture(daysAgo(80), wide, [], { x: 135, y: 100 }));
  const all = [s1, s2, s3, homeChest], r = scansToPrune(all, foldSnapshots, RETENTION_DEFAULTS, NOW);
  assert.deepEqual(r, { files: [], refused: false }, "s1 stays for its root, so s2 and s3 stay with it");
});

test("[fast] retention: a newer footprint is kept while the older one it superseded stays for another reason", () => {
  const a = scan("a.json", daysAgo(95), "Builder", [{ serial: OLDCHEST }], { [OLDCHEST]: box(OLDCHEST) }, [], [], capture(daysAgo(95), [[1, 200, 200, 7, 0], [1, 201, 200, 7, 0]]));
  const b = scan("b.json", daysAgo(90), "Builder", [], {}, [], [], capture(daysAgo(90), [[1, 199, 200, 7, 0], [1, 200, 200, 7, 0]]));
  const all = [a, b, recent], r = scansToPrune(all, foldSnapshots, RETENTION_DEFAULTS, NOW);
  assert.deepEqual(r, { files: [], refused: false }, "b supersedes a, so it stays while a does");
});

test("[fast] retention: house captures beside the ordinary history neither stop pruning nor change a house", () => {
  const wide = [[1, 100, 100, 7, 0], [1, 140, 100, 7, 0]];
  const s1 = scan("s1.json", daysAgo(95), "Builder", [{ serial: 140 }], { 140: box(140) }, [], [], capture(daysAgo(95), wide, [[11, 5, 101, 100, 7]]));   // the newest opener of chest 140 (OLDCHEST's newest is a-60)
  const s2 = scan("s2.json", daysAgo(90), "Builder", [], {}, [], [], capture(daysAgo(90), wide, []));
  const s3 = scan("s3.json", daysAgo(80), "Builder", [], {}, [], [], capture(daysAgo(80), wide, [], { x: 135, y: 100 }));
  const all = [...history, s1, s2, s3, homeChest], r = scansToPrune(all, foldSnapshots, RETENTION_DEFAULTS, NOW);
  assert.equal(r.refused, false);
  assert.deepEqual(r.files, ["a-90.json", "a-40.json", "a-35.json"], "what the history alone prunes; s1 stays for its chest and s2, s3 with it");
  assert.deepEqual(houseShape(all.filter((s) => !r.files.includes(s.file))), houseShape(all));
});

test("[fast] retention: two old captures of a house only visited, the older one kept as a bank's newest opener, do not stop pruning", () => {
  const v1 = scan("v1.json", daysAgo(95), "Builder", [{ serial: BANK, kind: "bank" }], { [BANK]: box(BANK) }, [], [], capture(daysAgo(95), plot, [[31, 5, 100, 100, 7]]));
  const v2 = scan("v2.json", daysAgo(90), "Builder", [], {}, [], [], capture(daysAgo(90), plot, [[32, 5, 101, 100, 7]], { x: 130, y: 100 }));
  const old = scan("old.json", daysAgo(85), "Builder", [], {}, []);
  const all = [v1, v2, old, recent], r = scansToPrune(all, foldSnapshots, RETENTION_DEFAULTS, NOW);
  assert.deepEqual(r, { files: ["old.json"], refused: false });
  assert.deepEqual(houseShape(all.filter((s) => !r.files.includes(s.file))), houseShape(all));
});

test("[fast] retention: an older capture is kept while it still gives the house a chest no scan opened that no newer capture could see, and pruning never changes the house's chests", () => {
  const wide = [[1, 100, 100, 7, 0], [1, 140, 100, 7, 0]];
  const seenAgain = scan("house-a.json", daysAgo(95), "Builder", [], {}, [], [], capture(daysAgo(95), wide, [], { x: 100, y: 100 }, [[40, 0x0E7C, 101, 100, 7]]));
  const farEnd = scan("house-b.json", daysAgo(90), "Builder", [], {}, [], [], capture(daysAgo(90), wide, [], { x: 135, y: 100 }, [[41, 0x0E7C, 130, 100, 7]]));
  const newest = scan("house-c.json", daysAgo(80), "Builder", [], {}, [], [], capture(daysAgo(80), wide, [], { x: 100, y: 100 }, []));
  const all = [seenAgain, farEnd, newest, homeChest], r = scansToPrune(all, foldSnapshots, RETENTION_DEFAULTS, NOW);
  assert.deepEqual(r, { files: ["house-a.json"], refused: false }, "house-c (standing at 100, 100) no longer sees chest 40 and cannot see chest 41, 30 tiles away");
  assert.deepEqual(houseShape(all.filter((s) => !r.files.includes(s.file))), houseShape(all));
});

test("[fast] retention: an old capture whose trash list keeps a container off the house map is kept, and pruning never brings the container back (issue #162)", () => {
  const oldest = scan("house-0.json", daysAgo(100), "Builder", [], {}, [], [], capture(daysAgo(100), plot, [], { x: 110, y: 100 }, [[42, 0x2813, 101, 100, 7]]));
  const near = scan("house-a.json", daysAgo(95), "Builder", [], {}, [], [], { house: { ...capture(daysAgo(95), plot, [], { x: 100, y: 100 }, []).house, trash: [42] } });
  const far = scan("house-b.json", daysAgo(90), "Builder", [], {}, [], [], capture(daysAgo(90), plot, [], { x: 110, y: 100 }, [[42, 0x2813, 101, 100, 7]]));
  const newest = scan("house-c.json", daysAgo(80), "Builder", [], {}, [], [], capture(daysAgo(80), plot, [], { x: 110, y: 100 }, [[42, 0x2813, 101, 100, 7]]));
  const all = [oldest, near, far, newest, homeChest], r = scansToPrune(all, foldSnapshots, RETENTION_DEFAULTS, NOW);
  assert.deepEqual(r, { files: ["house-0.json"], refused: false }, "house-a carries the trash list, so it and every newer capture stay");
  assert.deepEqual(houseShape(all.filter((s) => !r.files.includes(s.file))), houseShape(all));
});

test("[fast] retention: a trash list naming a serial no capture lists as a chest keeps no capture (issue #162)", () => {
  const run = (trash: boolean): string[] => {
    const caps = [100, 90, 80, 70].map((d) => scan(`house-${d}.json`, daysAgo(d), "Builder", [], {}, [], [], { house: { ...capture(daysAgo(d), plot, [], { x: 100, y: 100 }, []).house, ...(trash && d === 100 ? { trash: [999] } : {}) } }));
    return scansToPrune([...caps, homeChest], foldSnapshots, RETENTION_DEFAULTS, NOW).files;
  };
  assert.deepEqual(run(true), run(false));
  assert.deepEqual(run(false), ["house-100.json", "house-90.json", "house-80.json"]);
});
