// ui-characters.test.mts — the Characters screen's pure logic: the sheet's formatters (the "cap +N" badge,
// the at-cap meter, the attribute bonus split, "now → after", a slot tile's key numbers, tag tones,
// pluralising) from app/ui/sheet.mts, and the roster's search and sort from app/ui/roster.mts. Lives in
// app/ rather than app/ui/ for the reason app/ui-render.test.mts gives. Tags: [fast].
import "../scripts/localstorage-shim-for-tests.mts";   // app/ui/store.mts reads localStorage at module scope
import { test } from "node:test";
import assert from "node:assert/strict";
import { capOver, capBadgeText, atCap, bonusBreakdown, moveText, keyNumbers, tagTone, plural } from "./ui/sheet.mts";
import { rosterView, triple, type RosterRow } from "./ui/roster.mts";

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

const res = (vals: number[]): RosterRow["resists"] =>
  ["physResist", "fireResist", "coldResist", "poisonResist", "energyResist"].map((key, i) => ({ key, label: key, cls: key, cap: 70, raw: vals[i]!, value: Math.min(70, vals[i]!) }));
const ROWS: RosterRow[] = [
  { name: "Kestrel", scannedAt: "2026-01-02T12:00:00Z", stats: [70, 100, 40], pools: [100, 100, 100], resists: res([18, 55, 12, 44, 29]), worn: 8 },
  { name: "Dorran", scannedAt: "2026-01-01T12:00:00Z", stats: [110, 60, 20], pools: [100, 100, 100], resists: res([18, 72, 41, 32, 60]), worn: 7 },
  { name: "Aldo", scannedAt: null, stats: [null, null, null], pools: [null, null, null], resists: null, worn: 0 },
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
