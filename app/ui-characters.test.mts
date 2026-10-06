// ui-characters.test.mts — the Characters screen's pure logic (`app/ui/sheet.mts`'s formatters, `app/ui/roster.mts`).
//
// the Characters screen's pure logic: `app/ui/sheet.mts`'s formatters (the "cap +N" badge from a raw value past its cap, the at-cap meter, an attribute's "(own + gear)" split including a negative bonus, "now → after", a slot tile's two key numbers — nearest their shard cap, uncapped properties against 100, skill bonuses as "Magery +20", bookkeeping keys never shown and a power scroll's `psLevel` never offered on the Properties card — the tag tones, pluralising, and the durability watch: a piece low at 20% of its max or 10 points, never with a max of 0, at or past its max, or with no durability line, the count and its summary sentence) and `app/ui/roster.mts`'s search and sort (by name either way, by a resist's capped value or scan time with an unscanned character last, ties by name) and the sheet's scan summary (`sheetMeta`: the count of root containers the character's scans opened, backpack, bank and the containers inside others left out, its `#/containers/<Name>` link, and no count at none), and the worn-gear tiles holding every gear slot exactly once (issue #218). No DOM. All `[fast]`.
//
// Lives in app/ rather than app/ui/ for the reason app/ui-render.test.mts gives.
import "../scripts/localstorage-shim-for-tests.mts";   // a localStorage stub for the page modules below; none reads it at module scope today (app/ui/store.mts no longer does)
import { test } from "node:test";
import assert from "node:assert/strict";
import { capOver, capBadgeText, atCap, bonusBreakdown, poolChanges, moveText, keyNumbers, tagTone, plural, lowDurability, lowDurabilityCount, lowDurabilitySummary, SHEET_CATALOGUE, DEFAULT_SHEET_PROPS, SLOT_GROUPS } from "./ui/sheet.mts";
import { GEAR_SLOTS } from "./vault-lib.mts";
import { rosterView, triple, sheetMeta, openedRoots, type RosterRow } from "./ui/roster.mts";

test("[fast] sheet: the cap badge says how far the raw value is past the cap, and nothing at or under it", () => {
  assert.equal(capOver(72, 70), 2);
  assert.equal(capOver(70, 70), 0);
  assert.equal(capOver(18, 70), 0);
  assert.equal(capBadgeText(72, 70), "cap +2");
  assert.equal(capBadgeText(86, 70), "cap +16");
  assert.equal(capBadgeText(70, 70), null);
  assert.equal(capBadgeText(41, 75), null);
});

test("[fast] sheet: a meter is at cap only once the value reaches a real cap", () => {
  assert.equal(atCap(70, 70), true);
  assert.equal(atCap(69, 70), false);
  assert.equal(atCap(75, 70), true);
  assert.equal(atCap(0, 0), false, "a zero cap is no cap");
  assert.equal(atCap(10, null), false);
  assert.equal(atCap(10, undefined), false);
});

test("[fast] sheet: an attribute's bonus split reads (own + gear), a negative bonus with a minus, none at all when zero", () => {
  assert.equal(bonusBreakdown(110, 8), "(102 + 8)");
  assert.equal(bonusBreakdown(60, -2), "(62 − 2)");
  assert.equal(bonusBreakdown(60, 0), "");
  // Manual's buffs (issue #12): their share after the gear's
  assert.equal(bonusBreakdown(155, 13, 17), "(125 + 13 + 17 buffs)");
  assert.equal(bonusBreakdown(40, 0, 5), "(35 + 5 buffs)");
  // the pools: a stat's points past the 150 maximum raise none, a buff's own Hits do
  const none = { str: 0, dex: 0, int: 0 };
  assert.deepEqual(poolChanges({ strBonus: 30, hpi: 5, dexBonus: 11, manaInc: 2 }, {}, none), { hits: 20, stam: 11, mana: 2 });
  assert.deepEqual(poolChanges({ strBonus: 30, dexBonus: 11 }, { hitsPool: 20 }, { str: 5, dex: 11, int: 0 }), { hits: 32, stam: 0, mana: 0 });
});

test("[fast] sheet: a figure that moves reads 'now → after', one that doesn't reads once", () => {
  assert.equal(moveText(18, 22), "18 → 22");
  assert.equal(moveText(10, 27, "%"), "10% → 27%");
  assert.equal(moveText(60, 60), "60");
  assert.equal(moveText(5, 5, "%"), "5%");
});

test("[fast] sheet: a slot tile shows the two properties nearest their cap, in the item's own order", () => {
  const caps = { physResist: 70, fireResist: 70, energyResist: 70, lmc: 40, fc: 2 };
  // Energy 27/70 and Fire 25/70 beat Phys 3/70; shown in the order the item lists them
  assert.deepEqual(keyNumbers({ physResist: 3, fireResist: 25, energyResist: 27 }, caps), ["Fire 25", "Energy 27"]);
  // an uncapped property is measured against 100 (Luck 126 outranks Phys 9/70), a skill bonus reads "Magery +20"
  assert.deepEqual(keyNumbers({ luck: 126, physResist: 9, fireResist: 7 }, caps), ["Luck 126", "Phys 9"]);
  assert.deepEqual(keyNumbers({ "sk:magery": 20, fc: 1, fireResist: 12 }, caps), ["Magery +20", "FC 1"]);
  // bookkeeping keys, zeros and non-numbers never show; fewer than two is fine
  assert.deepEqual(keyNumbers({ tagPenalty: 4, hitsPool: 10, dci: 0, lmc: Number.NaN, fireResist: 5 }, caps), ["Fire 5"]);
  assert.deepEqual(keyNumbers({}, caps), []);
});

test("[fast] sheet: the Properties card lists each property once, shows today's set plus the three leeches by default", () => {
  const listed = SHEET_CATALOGUE.flatMap(([, rows]) => rows.map(([k]) => k));
  assert.equal(new Set(listed).size, listed.length, "no property is listed twice");
  for (const k of ["fc", "sdi", "hci", "reflectPhys", "hpRegen", "luck", "hitLifeLeech", "hitManaLeech", "hitStamLeech"]) assert.ok(DEFAULT_SHEET_PROPS.includes(k), `${k} is shown by default`);
  for (const k of ["hitFireball", "selfRepair", "strBonus"]) assert.ok(!DEFAULT_SHEET_PROPS.includes(k) && listed.includes(k), `${k} is listed but off`);
});

test("[fast] sheet: a power scroll's level is never offered on the Properties card", () => {
  assert.ok(!SHEET_CATALOGUE.flatMap(([, rows]) => rows.map(([k]) => k)).includes("psLevel"));
});

test("[fast] sheet: tags take the danger or warning tone the inventory uses", () => {
  assert.equal(tagTone("cursed"), "bad");
  assert.equal(tagTone("brittle"), "warn");
  assert.equal(tagTone("antique"), "warn");
  assert.equal(tagTone("prized"), undefined);
});

test("[fast] sheet: counts pluralise", () => {
  assert.equal(plural(1, "piece"), "1 piece");
  assert.equal(plural(7, "piece"), "7 pieces");
  assert.equal(plural(0, "item"), "0 items");
});

test("[fast] sheet: a worn piece is low on durability at 20% of its max or at 10 points, never at its max, with no max or with no line", () => {
  const dur = (current: number, max: number): { extras: { durability: [number, number] } } => ({ extras: { durability: [current, max] } });
  assert.equal(lowDurability(dur(12, 255)), "Low durability 12/255");
  assert.equal(lowDurability(dur(51, 255)), "Low durability 51/255", "exactly 20% is low");
  assert.equal(lowDurability(dur(52, 255)), null);
  assert.equal(lowDurability(dur(10, 26)), "Low durability 10/26", "10 points is low even above 20% of a small max");
  assert.equal(lowDurability(dur(11, 26)), null);
  assert.equal(lowDurability(dur(0, 0)), null, "a max of 0 is never low");
  assert.equal(lowDurability(dur(8, 8)), null, "a piece at its own small max is not low, however few its points");
  assert.equal(lowDurability(dur(9, 8)), null, "nor one past its max");
  assert.equal(lowDurability(dur(7, 8)), "Low durability 7/8");
  assert.equal(lowDurability({ extras: {} }), null, "no durability line");
  assert.equal(lowDurability({}), null, "no extras at all");
  assert.equal(lowDurability({ extras: { durability: 5 } }), null, "a lone number is not a current/max pair");
});

test("[fast] sheet: the low-durability count and its summary sentence, nothing when nothing is low", () => {
  const worn = [{ extras: { durability: [3, 150] as [number, number] } }, { extras: { durability: [150, 150] as [number, number] } }, { extras: {} }, { extras: { durability: [9, 40] as [number, number] } }];
  assert.equal(lowDurabilityCount(worn), 2);
  assert.equal(lowDurabilityCount([]), 0);
  assert.equal(lowDurabilitySummary(2), "2 worn pieces are low on durability");
  assert.equal(lowDurabilitySummary(1), "1 worn piece is low on durability");
  assert.equal(lowDurabilitySummary(0), null);
});

const res = (vals: number[]): RosterRow["resists"] =>
  ["physResist", "fireResist", "coldResist", "poisonResist", "energyResist"].map((key, i) => ({ key, label: key, cls: key, cap: 70, raw: vals[i]!, value: Math.min(70, vals[i]!) }));
const ROWS: RosterRow[] = [
  { name: "Kestrel", scannedAt: "2026-01-02T12:00:00Z", stats: [70, 100, 40], pools: [100, 100, 100], resists: res([18, 55, 12, 44, 29]), worn: 8, lowDurability: 0 },
  { name: "Dorran", scannedAt: "2026-01-01T12:00:00Z", stats: [110, 60, 20], pools: [100, 100, 100], resists: res([18, 72, 41, 32, 60]), worn: 7, lowDurability: 2 },
  { name: "Aldo", scannedAt: null, stats: [null, null, null], pools: [null, null, null], resists: null, worn: 0, lowDurability: 0 },
];
const names = (rows: RosterRow[]): string[] => rows.map((r) => r.name);

test("[fast] roster: sorts by name either way", () => {
  assert.deepEqual(names(rosterView(ROWS, "", { key: "name", dir: 1 })), ["Aldo", "Dorran", "Kestrel"]);
  assert.deepEqual(names(rosterView(ROWS, "", { key: "name", dir: -1 })), ["Kestrel", "Dorran", "Aldo"]);
});

test("[fast] roster: sorts by a resist's shown (capped) value or by scan time, an unscanned character last either way", () => {
  assert.deepEqual(names(rosterView(ROWS, "", { key: "fireResist", dir: -1 })), ["Dorran", "Kestrel", "Aldo"]);
  assert.deepEqual(names(rosterView(ROWS, "", { key: "fireResist", dir: 1 })), ["Kestrel", "Dorran", "Aldo"]);
  assert.deepEqual(names(rosterView(ROWS, "", { key: "scan", dir: -1 })), ["Kestrel", "Dorran", "Aldo"]);
  assert.deepEqual(names(rosterView(ROWS, "", { key: "scan", dir: 1 })), ["Dorran", "Kestrel", "Aldo"]);
  // a tie falls back to the name
  assert.deepEqual(names(rosterView(ROWS, "", { key: "physResist", dir: -1 })), ["Dorran", "Kestrel", "Aldo"]);
});

test("[fast] roster: the search matches anywhere in the name, ignoring case and surrounding spaces", () => {
  assert.deepEqual(names(rosterView(ROWS, "  rel ", { key: "name", dir: 1 })), ["Kestrel"]);
  assert.deepEqual(names(rosterView(ROWS, "D", { key: "name", dir: 1 })), ["Aldo", "Dorran"]);
  assert.deepEqual(names(rosterView(ROWS, "zzz", { key: "name", dir: 1 })), []);
  assert.equal(rosterView(ROWS, "", { key: "name", dir: 1 }).length, 3);
});

test("[fast] roster: stat triples join with middots and dash a missing number", () => {
  assert.equal(triple([110, 60, 20]), "110 · 60 · 20");
  assert.equal(triple([100, null, 100]), "100 · – · 100");
});

test("[fast] sheet: the scan summary counts the containers the character's scans opened, links to them, and leaves the count out at none", () => {
  const containers = {
    "1": { serial: 1, root: 1, parent: null, kind: "ground", scannedBy: "Dorran" },
    "2": { serial: 2, root: 2, parent: null, kind: "ground", scannedBy: "Dorran" },
    "3": { serial: 3, root: 1, parent: 1, kind: "container", scannedBy: "Dorran" },   // a bag inside 1: not a root
    "4": { serial: 4, root: 4, parent: null, kind: "backpack", scannedBy: "Dorran" },
    "5": { serial: 5, root: 5, parent: null, kind: "bank", scannedBy: "Dorran" },
    "6": { serial: 6, root: 6, parent: null, kind: "ground", scannedBy: "Kestrel" },
  };
  assert.deepEqual(openedRoots(containers, "Dorran").map((c) => c.serial), [1, 2], "roots only, the backpack and bank aside");
  assert.deepEqual(sheetMeta("Dorran", "7 h ago", 11, containers),
    { scanned: "Scanned 7 h ago", worn: "11 pieces worn", opened: { text: "opened 2 containers", href: "#/containers/Dorran" } });
  assert.deepEqual(sheetMeta("Kestrel", "1 d ago", 1, containers).opened, { text: "opened 1 container", href: "#/containers/Kestrel" });
  assert.equal(sheetMeta("Sir Ana", "now", 0, containers).opened, null, "no container opened: no count and no link");
  const spaced = { "7": { serial: 7, root: 7, parent: null, kind: "ground", scannedBy: "Sir Ana" } };
  assert.equal(sheetMeta("Sir Ana", "now", 0, spaced).opened!.href, "#/containers/Sir%20Ana", "the name is encoded for the hash");
});

test("[fast] sheet: the worn-gear tiles list every gear slot exactly once", () => {
  const listed = SLOT_GROUPS.flatMap(([, slots]) => slots);
  assert.deepEqual([...listed].sort(), [...GEAR_SLOTS].sort());
  assert.equal(new Set(listed).size, listed.length);
  assert.deepEqual(SLOT_GROUPS.map(([title]) => title), ["Armor", "Weapons and jewelry", "Clothing"]);
});
