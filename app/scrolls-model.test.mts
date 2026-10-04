// scrolls-model.test.mts — app/ui/scrolls-model.mts, the Inventory's Scrolls view as data (issue #181): power scrolls
// grouped per skill and level, the Scroll Binder's next roll-up and "bind everything" cascade, the row order, Scrolls of
// Transcendence totals and their exact 2.0 / 5.0 plan, the empty Scroll Binder count, the header's facts, and the plain
// holdings a shard without binder recipes gets. Lives in app/ for the reason app/ui-render.test.mts gives.
// Tags: [fast]. Run: node --test app/scrolls-model.test.mts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Item } from "./vault-lib.mts";
import type { RulesV1 } from "./schema/types.d.mts";
import {
  powerSkill, powerRows, powerLevels, nextStep, bindEverything, holdingsText, sotRows, sotPlan, fewestSubset, planText, fmtTenths,
  isEmptyBinder, emptyBinderCount, scrollFacts, filterRows, powerQuery, sotQuery, placeGroups, whoText, listName,
} from "./ui/scrolls-model.mts";

const RULES = JSON.parse(readFileSync(new URL("./rules/uoalive.json", import.meta.url), "utf8")) as RulesV1;
const STEPS = RULES.scrollBinder!.powerScrolls!;
const USABLE = RULES.scrollBinder!.transcendence!.usableAt;
const TIER: Record<number, string> = { 105: "A Wondrous", 110: "An Exalted", 115: "A Mythical", 120: "A Legendary" };

let serial = 0x40000000;
function item(name: string, lines: string[], props: Record<string, number> = {}, over: Partial<Item> = {}): Item {
  serial++;
  return {
    serial, name, amount: 1, props, setBonus: {}, extras: {}, flags: [], tags: ["cursed"], strReq: 0, rarity: null, weight: 1, skillReq: null,
    lines: [lines[0] ?? name, ...lines.slice(1)], gargoyle: false, slayers: [], medable: false, slot: null, twoHanded: false, gear: false, kind: "scroll",
    root: 0x700b0000, container: 0x700b0000, equippedBy: null, layer: null, seenAt: "2026-10-01T10:00:00Z", scannedBy: "Kestrel",
    location: { kind: "ground", character: "Kestrel", text: "Metal Chest (0x700b0000)", root: 0x700b0000 }, ...over,
  };
}
const ps = (skill: string, level: number, over: Partial<Item> = {}): Item => {
  const name = `${TIER[level]} Scroll Of ${skill} (${level} Skill)`;
  return item(name, [name, "Cursed", "Weight: 1 Stone"], { psLevel: level, tagPenalty: 10 }, over);
};
const many = (n: number, skill: string, level: number): Item[] => Array.from({ length: n }, () => ps(skill, level));
const sot = (skill: string, points: number, over: Partial<Item> = {}): Item =>
  item(`Scroll of Transcendence (${skill} - ${points.toFixed(1)} Pts)`, ["Scroll Of Transcendence", "Cursed", "Weight: 1 Stone", `Skill: ${skill} ${points} Skill Points`], { sotPoints: points, tagPenalty: 10 }, over);
const binder = (lines: string[] = []): Item => item("Scroll Binder", ["Scroll Binder", "Weight: 1 Stone", ...lines], {}, { tags: [] });

test("[fast] scrolls model: a power scroll's skill comes from its name", () => {
  assert.equal(powerSkill("An Exalted Scroll Of Meditation (110 Skill)"), "Meditation");
  assert.equal(powerSkill("A Wondrous Scroll Of Evaluating Intelligence (105 Skill)"), "Evaluating Intelligence");
  assert.equal(powerSkill("A Legendary Scroll of Animal Lore (120 Skill)"), "Animal Lore");
  assert.equal(powerSkill("Scroll Binder"), null);
});

test("[fast] scrolls model: power scrolls are counted per skill and level, stacks by their amount", () => {
  const rows = powerRows([...many(5, "Meditation", 110), ps("Provocation", 115), ps("Provocation", 110, { amount: 3 }), ps("Meditation", 120)], STEPS);
  const med = rows.find((r) => r.skill === "Meditation")!;
  assert.deepEqual([med.counts[110], med.counts[120], med.counts[105] ?? 0, med.total, med.items.length], [5, 1, 0, 6, 6]);
  const pro = rows.find((r) => r.skill === "Provocation")!;
  assert.deepEqual([pro.counts[110], pro.counts[115], pro.total], [3, 1, 4]);
  assert.deepEqual(powerLevels(rows, STEPS), [105, 110, 115, 120]);
  assert.deepEqual(powerLevels([], []), [105, 110, 115, 120], "the four levels even with no recipes");
});

test("[fast] scrolls model: the next roll-up is the step needing the fewest more, the higher tier on a tie", () => {
  assert.deepEqual(nextStep({ 110: 5 }, STEPS), { from: 110, to: 115, count: 12, have: 5, more: 7 });
  // 3 of 12 at 110 and 1 of 10 at 115 both need 9 more: the higher tier wins.
  assert.deepEqual(nextStep({ 110: 3, 115: 1, 120: 1 }, STEPS), { from: 115, to: 120, count: 10, have: 1, more: 9 });
  assert.deepEqual(nextStep({ 105: 1, 110: 1 }, STEPS)?.from, 105, "7 more at 105 beats 11 more at 110");
  assert.deepEqual(nextStep({ 110: 14 }, STEPS), { from: 110, to: 115, count: 12, have: 14, more: 0 });
  assert.equal(nextStep({ 120: 4 }, STEPS), null, "nothing to roll up from 120");
  assert.equal(nextStep({ 110: 4 }, []), null, "no recipes, no roll-up");
});

test("[fast] scrolls model: bind everything cascades leftovers up the tiers, top tier first", () => {
  assert.equal(bindEverything({ 110: 11 }, STEPS), null, "nothing binds");
  assert.deepEqual(bindEverything({ 110: 12 }, STEPS), { 105: 0, 110: 0, 115: 1, 120: 0 });
  // 8 × 105 → 1 × 110; 12 + 1 = 13 × 110 → 1 × 115 and 1 left; 9 + 1 = 10 × 115 → 1 × 120.
  const h = bindEverything({ 105: 9, 110: 12, 115: 9, 120: 2 }, STEPS)!;
  assert.deepEqual(h, { 105: 1, 110: 1, 115: 0, 120: 3 });
  assert.equal(holdingsText(h), "3 × 120, 1 × 110, 1 × 105");
  assert.equal(holdingsText(bindEverything({ 110: 16, 115: 4 }, STEPS)!), "5 × 115, 4 × 110");
});

test("[fast] scrolls model: rows sort by fewest more needed, then higher tier, then name; ready rows first", () => {
  const rows = powerRows([
    ...many(5, "Meditation", 110), ...many(3, "Archery", 115), ...many(5, "Spirit Speak", 110), ps("Animal Lore", 105), ps("Animal Lore", 110),
    ...many(12, "Healing", 110), ps("Tactics", 120), ...many(2, "Bushido", 115),
  ], STEPS);
  assert.deepEqual(rows.map((r) => r.skill), ["Healing", "Archery", "Meditation", "Spirit Speak", "Animal Lore", "Bushido", "Tactics"]);
  const heal = rows[0]!;
  assert.equal(heal.ready, true);
  assert.equal(heal.bindAll, "1 × 115");
  assert.equal(rows.find((r) => r.skill === "Meditation")!.bindAll, null, "nothing binds: no text at all");
  assert.equal(rows.find((r) => r.skill === "Tactics")!.next, null);
});

test("[fast] scrolls model: without recipes, power rows list holdings by skill name", () => {
  const rows = powerRows([...many(12, "Healing", 110), ps("Archery", 115)], []);
  assert.deepEqual(rows.map((r) => [r.skill, r.total, r.next, r.ready, r.bindAll]), [["Archery", 1, null, false, null], ["Healing", 12, null, false, null]]);
});

test("[fast] scrolls model: the fewest Scrolls of Transcendence that add up exactly, in whole tenths", () => {
  assert.deepEqual(fewestSubset([6, 5, 5, 4, 4, 2, 2, 1, 1], 20), [6, 5, 5, 4]);
  assert.deepEqual(fewestSubset([10, 10, 5, 5, 5, 5], 20), [10, 10]);
  assert.equal(fewestSubset([3, 3, 3, 3, 3, 3, 3], 20), null, "sevens of 0.3 never make 2.0");
  assert.deepEqual(fewestSubset([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1], 20)!.length, 20);
  assert.equal(fmtTenths(20), "2.0");
  assert.equal(fmtTenths(3), "0.3");
});

test("[fast] scrolls model: the binder plan binds to exactly 5.0 when it can, else 2.0, else says how far off", () => {
  assert.deepEqual(sotPlan([8], USABLE), { kind: "short", target: 20, short: 12 });
  assert.equal(planText(sotPlan([8], USABLE)), "1.2 short of 2.0");
  assert.deepEqual(sotPlan([10, 6, 4, 3], USABLE), { kind: "bind", target: 20, pick: [10, 6, 4], lost: 0 });
  assert.equal(planText(sotPlan([10, 6, 4, 3], USABLE)), "Bind 1.0 + 0.6 + 0.4 → 2.0");
  assert.deepEqual(sotPlan([20, 20, 10, 5, 1], USABLE), { kind: "bind", target: 50, pick: [20, 20, 10], lost: 0 });
  // 2.4 in all, none adding up to 2.0: going past 2.0 locks the binder until 5.0.
  assert.deepEqual(sotPlan([3, 3, 3, 3, 3, 3, 3, 3], USABLE), { kind: "short", target: 50, short: 26 });
  assert.equal(planText(sotPlan([3, 3, 3, 3, 3, 3, 3, 3], USABLE)), "2.6 short of 5.0");
  // 18 × 0.3 (5.4) make neither 2.0 nor 5.0 exactly: past 5.0 the binder is usable and the rest is lost, so bind the
  // set that overshoots least, with the fewest scrolls: 17 × 0.3 = 5.1, 0.1 lost.
  const eighteen = Array.from({ length: 18 }, () => 3);
  assert.deepEqual(sotPlan(eighteen, USABLE), { kind: "bind", target: 50, pick: eighteen.slice(1), lost: 1 });
  assert.equal(planText(sotPlan(eighteen, USABLE)), `Bind ${Array.from({ length: 17 }, () => "0.3").join(" + ")} → 5.0 (0.1 lost)`);
  // Least overshoot first, then fewest scrolls: 2.4 + 2.7 (5.1) over 2.4 + 2.4 + 0.3 (also 5.1, three scrolls) and 2.7 + 2.7.
  assert.deepEqual(sotPlan([27, 27, 24, 24, 3], USABLE), { kind: "bind", target: 50, pick: [27, 24], lost: 1 });
  // An exact set still wins over an overshoot: 1.3 + 0.7 make 2.0 exactly.
  assert.deepEqual(sotPlan([27, 27, 13, 7], USABLE), { kind: "bind", target: 20, pick: [13, 7], lost: 0 });
});

test("[fast] scrolls model: a Scroll of Transcendence's skill comes from its shown name, with no rules loaded", () => {
  assert.deepEqual(sotRows([sot("Animal Lore", 0.1), item("Scroll Of Transcendence", ["Scroll Of Transcendence"], { sotPoints: 0.1 })], null).map((r) => r.skill), ["Animal Lore"]);
});

test("[fast] scrolls model: Scrolls of Transcendence total per skill, sorted by total", () => {
  const rows = sotRows([sot("Chivalry", 0.6), sot("Chivalry", 0.6), sot("Focus", 0.1), sot("Meditation", 0.4), sot("Meditation", 0.8, { amount: 2 })], USABLE);
  assert.deepEqual(rows.map((r) => [r.skill, r.tenths, fmtTenths(r.total)]), [["Meditation", [8, 8, 4], "2.0"], ["Chivalry", [6, 6], "1.2"], ["Focus", [1], "0.1"]]);
  assert.deepEqual(rows[0]!.plan, { kind: "bind", target: 20, pick: [8, 8, 4], lost: 0 });
  assert.equal(rows[0]!.ready, true);
  const plain = sotRows([sot("Focus", 0.1), sot("Chivalry", 0.6)], null);
  assert.deepEqual(plain.map((r) => [r.skill, r.plan, r.ready]), [["Chivalry", null, false], ["Focus", null, false]]);
});

test("[fast] scrolls model: an empty Scroll Binder is one with nothing past its name, weight and state lines", () => {
  assert.equal(isEmptyBinder(binder()), true);
  assert.equal(isEmptyBinder(binder(["Blessed"])), true);
  assert.equal(isEmptyBinder(binder(["Insured"])), true);
  assert.equal(isEmptyBinder(binder(["Power Scroll: Meditation 110 (3/12)"])), false, "a partly filled binder is not counted");
  assert.equal(isEmptyBinder(ps("Meditation", 110)), false);
  assert.equal(emptyBinderCount([binder(), binder(), binder(["Skill: Focus 0.4"]), ps("Meditation", 110)]), 2);
});

test("[fast] scrolls model: the header's facts", () => {
  const power = powerRows([...many(5, "Meditation", 110), ...many(12, "Healing", 110)], STEPS);
  const trans = sotRows([sot("Focus", 0.1)], USABLE);
  assert.deepEqual(scrollFacts({ power, sot: trans, binders: 1, binder: true }), ["17 power scrolls across 2 skills", "1 Scroll of Transcendence across 1 skill", "1 empty Scroll Binder", "1 skill ready to bind"]);
  assert.deepEqual(scrollFacts({ power: powerRows(many(5, "Meditation", 110), STEPS), sot: [], binders: 0, binder: true }), ["5 power scrolls across 1 skill", "0 Scrolls of Transcendence across 0 skills", "0 empty Scroll Binders", "Nothing is ready to bind yet"]);
  // A skill ready in both tabs counts once.
  const both = sotRows([sot("Healing", 1.0), sot("Healing", 1.0)], USABLE);
  assert.equal(scrollFacts({ power, sot: both, binders: 0, binder: true })[3], "1 skill ready to bind");
  assert.equal(scrollFacts({ power, sot: [...both, ...sotRows([sot("Focus", 2.0)], USABLE)], binders: 0, binder: true })[3], "2 skills ready to bind");
  assert.deepEqual(scrollFacts({ power, sot: trans, binders: 1, binder: false }), ["17 power scrolls across 2 skills", "1 Scroll of Transcendence across 1 skill"], "no binder recipes: no binder facts");
});

test("[fast] scrolls model: the filter matches skill names, and the Inventory links name exactly those scrolls", () => {
  const rows = powerRows([ps("Animal Lore", 110), ps("Animal Taming", 110), ps("Magery", 110)], STEPS);
  assert.deepEqual(filterRows(rows, " ANIMAL ").map((r) => r.skill), ["Animal Lore", "Animal Taming"]);
  assert.equal(filterRows(rows, "").length, 3);
  assert.equal(powerQuery("Animal Lore", 110), "scroll of animal lore (110 skill)");
  assert.equal(powerQuery("Animal Lore"), "scroll of animal lore (");
  assert.equal(sotQuery("Animal Lore"), "scroll of transcendence (animal lore -");
});

test("[fast] scrolls model: the detail groups scrolls by where they are, in the order given", () => {
  const a = ps("Provocation", 115, { root: 1, location: { kind: "ground", character: "Kestrel", text: "Chest A (0x1)", root: 1 } });
  const b = ps("Provocation", 110, { root: 2, location: { kind: "ground", character: "Dorran", text: "Chest B (0x2)", root: 2 } });
  const c = ps("Provocation", 110, { root: 1, location: { kind: "ground", character: "Kestrel", text: "Chest A (0x1)", root: 1 } });
  const groups = placeGroups([a, b, c]);
  assert.deepEqual(groups.map((g) => [g.text, g.items.map((i) => i.serial)]), [["Chest A (0x1)", [a.serial, c.serial]], ["Chest B (0x2)", [b.serial]]]);
  assert.equal(listName(a.name), "Mythical Scroll Of Provocation");
  assert.equal(listName(sot("Animal Lore", 0.1).name), "Scroll of Transcendence");
  assert.equal(whoText(a.location), "On the ground · scanned by Kestrel");
  assert.equal(whoText({ kind: "backpack", character: "Dorran", text: "Backpack", root: 3 }), "Dorran's backpack");
});

test("[fast] scrolls model: the fewest-scrolls plan agrees with trying every subset", () => {
  let seed = 181;
  const rnd = (n: number): number => { seed = (seed * 1103515245 + 12345) % 2147483648; return 1 + (seed % n); };
  for (let round = 0; round < 300; round++) {
    const vals = Array.from({ length: rnd(10) }, () => rnd(12)), target = [20, 50][round % 2]!;
    let fewest = Infinity;
    for (let mask = 1; mask < 1 << vals.length; mask++) {
      const picked = vals.filter((_, i) => mask & (1 << i));
      if (picked.reduce((a, v) => a + v, 0) === target) fewest = Math.min(fewest, picked.length);
    }
    const got = fewestSubset(vals, target);
    if (fewest === Infinity) { assert.equal(got, null, `${vals} → ${target}`); continue; }
    assert.equal(got!.length, fewest, `${vals} → ${target}`);
    assert.equal(got!.reduce((a, v) => a + v, 0), target);
    const left = [...vals];
    for (const v of got!) { const i = left.indexOf(v); assert.ok(i >= 0, `${v} used more often than held in ${vals}`); left.splice(i, 1); }
  }
});
