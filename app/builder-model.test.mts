// builder-model.test.mts — app/ui/builder-model.mts, the Suit Builder's pure logic: the collapsed sections'
// summaries, the Advanced fields' validation messages, a resist tile's outcome, the result's other-changes
// badges and after-the-change values, the compare table's differing rows and best values, and a saved run's
// label, badges and the three-run compare limit. Lives in app/ for the reason app/ui-render.test.mts gives.
// Tags: [fast]. Run: node --test app/builder-model.test.mts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setRules } from "./vault-lib.mts";
import type { RulesV1 } from "./schema/types.d.mts";
import {
  propName, weightsSummary, requirementsSummary, poolSummary, advancedSummary, knobError, firstKnobError, knobFromServerError, ruleValueError,
  resistOutcome, otherChanges, afterChange, compareModel, hiddenRowsNote, toggleCompare, runAutoLabel, runBadges, plural, SOLVER_LIMITS,
  type Knobs,
} from "./ui/builder-model.mts";
import { OPTS_LIMITS } from "./vault-server.mts";

setRules(JSON.parse(readFileSync(new URL("./rules/uoalive.json", import.meta.url), "utf8")) as RulesV1);
const melee = JSON.parse(readFileSync(new URL("./data/profiles.default.json", import.meta.url), "utf8")).templates.melee;

test("[fast] builder model: property names read as words in rule rows", () => {
  assert.equal(propName("physResist"), "Physical resist");
  assert.equal(propName("hci"), "Hit chance increase");
  assert.equal(propName("stamPool"), "Stam pool");
  assert.equal(propName("sk:magery"), "Magery skill bonus");
});

test("[fast] builder model: the weights summary puts the heaviest first, folds equal resists and counts the rest", () => {
  assert.equal(weightsSummary(melee.weights), "DCI 10 · HCI 10 · each resist 6 · SSI 5 · DEX 4 · HPR 4 · 7 more");
  assert.equal(weightsSummary({ fireResist: 6, hci: 2 }), "Fire 6 · HCI 2", "unequal or partial resists are listed one by one");
  assert.equal(weightsSummary({}), "No weights set");
  assert.equal(weightsSummary({ tagPenalty: -25 }), "No weights set", "the tag penalty is not a weight the player sets here");
});

test("[fast] builder model: the requirements summary folds equal resists and marks soft ones", () => {
  assert.equal(requirementsSummary(melee.floors, []), "each resist 65");
  assert.equal(requirementsSummary({ physResist: 65, hci: 35 }, ["hci"]), "Phys 65 · HCI 35 soft");
  assert.equal(requirementsSummary({}), "No requirements");
});

test("[fast] builder model: the candidate pool summary says what is in and out", () => {
  assert.equal(poolSummary({}), "Own gear and unworn gear · no gargoyle-only · any weapon");
  assert.equal(poolSummary({ allowOthersWorn: true, allowGargoyle: true, medOnly: true, weaponSkill: "archery", lockedSlots: ["ring"], excludeTags: ["cursed"], excludeSkills: ["necromancy", "spirit speak"], excludeRoots: [1, 2] }),
    "Includes gear worn by others · gargoyle-only allowed · meditation-safe only · archery weapons only · 1 slot locked · no cursed · 2 skill bonuses forbidden · 2 containers skipped");
});

const knobs = (over: Partial<Knobs> = {}): Knobs => ({ strLimit: "110", restarts: "10000", exact: true, budgetS: "300", altCount: "5", altTol: "40", ...over });
test("[fast] builder model: the Advanced summary names the search, its restarts, budget and other suits", () => {
  assert.equal(advancedSummary(knobs()), "Exact · 10,000 restarts · 300 s · 5 other suits within 40 · STR limit 110");
  assert.equal(advancedSummary(knobs({ exact: false, restarts: "1", strLimit: "" })), "Heuristic · 1 restart");
  assert.equal(advancedSummary(knobs({ altCount: "0" })), "Exact · 10,000 restarts · 300 s · STR limit 110");
});

test("[fast] builder model: an out-of-range knob gets a plain message with the allowed range", () => {
  assert.equal(knobError("restarts", "300000"), "Enter a whole number from 1 to 10,000.");
  assert.equal(knobError("restarts", "2.5"), "Enter a whole number from 1 to 10,000.");
  assert.equal(knobError("restarts", ""), "Enter a whole number from 1 to 10,000.");
  assert.equal(knobError("restarts", "10000"), null);
  assert.equal(knobError("budgetS", "0"), "Enter a whole number from 1 to 3,600.");
  assert.equal(knobError("altCount", "101"), "Enter a whole number from 0 to 100.");
  assert.equal(knobError("altTol", "-1"), "Enter a number of 0 or more.");
  assert.equal(knobError("altTol", "0.5"), null);
  assert.equal(ruleValueError("abc"), "Enter a number.");
  assert.equal(ruleValueError("65"), null);
  assert.deepEqual(firstKnobError(knobs({ restarts: "0", altCount: "500" })), { field: "restarts", error: "Enter a whole number from 1 to 10,000." });
  assert.equal(firstKnobError(knobs({ exact: false, budgetS: "0" })), null, "the budget is not sent without exact search, so it cannot block a build");
  assert.equal(knobFromServerError("opts.restarts must be an integer between 1 and 10000"), "restarts");
  assert.equal(knobFromServerError("opts.timeBudgetMs must be an integer between 0 and 3600000"), "budgetS");
  assert.equal(knobFromServerError("no character"), null);
});

test("[fast] builder model: the page's solver limits are the server's", () => {
  assert.deepEqual(SOLVER_LIMITS, OPTS_LIMITS);
});

test("[fast] builder model: a resist tile says short, at cap, over cap or met", () => {
  assert.deepEqual(resistOutcome(18, 65, 70), { text: "47 short", tone: "warn" });
  assert.deepEqual(resistOutcome(69, 65, 70), { text: "Meets 65", tone: "ok" });
  assert.deepEqual(resistOutcome(70, 65, 70), { text: "At cap", tone: "ok" });
  assert.deepEqual(resistOutcome(86, 65, 70), { text: "16 over cap", tone: "muted" });
  assert.deepEqual(resistOutcome(40, null, 70), { text: "30 below cap", tone: "muted" });
});

test("[fast] builder model: other changes are badges, gains first, resists and unchanged values left out", () => {
  const got = otherChanges(Object.keys(melee.weights), { dci: 0, hci: 4, luck: 126, stamRegen: 5, physResist: 3 }, { dci: 20, hci: 22, luck: 96, stamRegen: 3, physResist: 29 }, { dci: 45, hci: 45, stamRegen: 24 });
  assert.deepEqual(got, [
    { text: "DCI 0 → 20 / 45", tone: "ok" }, { text: "HCI 4 → 22 / 45", tone: "ok" },
    { text: "Luck 126 → 96", tone: "bad" }, { text: "SR 5 → 3 / 24", tone: "bad" },
  ]);
  assert.deepEqual(otherChanges(["hci"], { hci: 30 }, { hci: 30 }, {}, { hci: 35 }), [{ text: "HCI 30 → 30 (needs 35)", tone: "bad" }], "a missed requirement shows even when it does not move");
});

test("[fast] builder model: after the change lists the values that move first, with the pool estimates", () => {
  const rows = afterChange({ str: 110, dex: 60, int: 20 }, { hits: 100, stam: 100, mana: 100 }, { strBonus: 8, dexBonus: 0, stamInc: 10 }, { strBonus: 6, hpi: 10, manaInc: 7 });
  assert.deepEqual(rows.map((r) => [r.label, r.before, r.after, r.delta]), [
    ["Strength", 110, 108, -2], ["Hits", 100, 109, 9], ["Stamina", 100, 90, -10], ["Mana", 100, 107, 7],
    ["Dexterity", 60, 60, 0], ["Intelligence", 20, 20, 0],
  ]);
  assert.equal(afterChange({}, {}, {}, { strBonus: 2 })[0]!.after, null, "a scan without stats says ? rather than inventing one");
});

test("[fast] builder model: compare keeps differing rows, marks cells that differ from the first suit and the best totals", () => {
  const cloak = { serial: 7, name: "Cloak" }, sword = { serial: 8, name: "Broadsword" }, katana = { serial: 9, name: "Animated Katana" }, mask = { serial: 1, name: "Mighty Orc Mask" };
  const members = [
    { assignment: { cloak, oneHanded: sword, helmet: mask }, totals: { physResist: 69, fireResist: 70, dexBonus: 0, fc: 0, hitLightning: 36 } },
    { assignment: { cloak: null, oneHanded: sword, helmet: mask }, totals: { physResist: 69, fireResist: 70, dexBonus: 0, fc: 0, hitLightning: 36 } },
    { assignment: { cloak: null, oneHanded: katana, helmet: mask }, totals: { physResist: 70, fireResist: 70, dexBonus: 3, fc: -1, hitLightning: 0 } },
  ];
  const m = compareModel(members, ["helmet", "cloak", "oneHanded"], ["physResist", "fireResist", "dexBonus", "fc", "hitLightning"], { physResist: 70, fireResist: 70, fc: 2 });
  assert.deepEqual(m.pieces.map((r) => [r.label, r.cells.map((c) => `${c.text}${c.diff ? "*" : ""}`)]), [
    ["Cloak", ["Cloak", "nothing*", "nothing*"]],
    ["Weapon (1H)", ["Broadsword", "Broadsword", "Animated Katana*"]],
  ]);
  assert.deepEqual(m.totals.map((r) => [r.key, r.best]), [
    ["physResist", [false, false, true]], ["dexBonus", [false, false, true]], ["fc", [true, true, false]], ["hitLightning", [true, true, false]],
  ]);
  assert.deepEqual(m.hiddenTotals, ["Fire resist"]);
  assert.equal(m.hiddenPieces, 1);
  assert.equal(hiddenRowsNote(3, m.hiddenTotals, m.hiddenPieces), "Rows where all three agree are hidden: 1 slot, Fire resist");
  const all = compareModel(members, ["helmet", "cloak", "oneHanded"], ["fireResist"], { fireResist: 70 }, false);
  assert.equal(all.pieces.length, 3, "Differences only off shows every slot");
  assert.deepEqual(all.totals[0]!.best, [false, false, false], "a row where every suit agrees has no best cell");
  const capped = compareModel([{ assignment: {}, totals: { fireResist: 86 } }, { assignment: {}, totals: { fireResist: 70 } }], [], ["fireResist"], { fireResist: 70 });
  assert.deepEqual(capped.totals[0]!.best, [false, false], "past the cap counts as the cap: 86 is no better than 70");
});

test("[fast] builder model: a fourth run cannot be ticked for comparison, and says why", () => {
  let sel = new Set(["a", "b", "c"]);
  const r = toggleCompare(sel, "d", true);
  assert.equal(r.refused, "Up to 3 runs");
  assert.deepEqual([...r.next], ["a", "b", "c"]);
  sel = toggleCompare(sel, "b", false).next;
  assert.deepEqual([...toggleCompare(sel, "d", true).next], ["a", "c", "d"]);
  assert.equal(toggleCompare(new Set(["0", "1", "2"]), "3", true, 3, "suits").refused, "Up to 3 suits");
});

test("[fast] builder model: a run's automatic label and its badges", () => {
  assert.equal(runAutoLabel(null, {}).text, "First saved run");
  assert.equal(runAutoLabel({ floors: { di: 20 } }, { floors: { di: 20 } }).text, "Same settings as the run before");
  assert.equal(runAutoLabel({ floors: { di: 20 } }, { floors: { di: 30 } }).text, "DI floor 20 → 30");
  const badges = runBadges(8, { physResist: 29, fireResist: 40, coldResist: 30, poisonResist: 30, energyResist: 30 }, { physResist: 65, fireResist: 65, coldResist: 65, poisonResist: 65, energyResist: 65 }, 40, { physResist: 70, fireResist: 70, coldResist: 70, poisonResist: 70, energyResist: 70 });
  assert.deepEqual(badges.map((b) => b.text), ["8 changes", "5 of 5 met", "Phys 69", "Fire 70", "Cold 70", "Poison 70", "Energy 70"]);
  assert.equal(badges[1]!.tone, "ok");
  assert.deepEqual(runBadges(null, null, {}, 0, {}), [], "an old run with no summary data gets no badges");
  assert.equal(plural(1, "change"), "1 change");
  assert.equal(plural(2, "skill bonus", "skill bonuses"), "2 skill bonuses");
});
