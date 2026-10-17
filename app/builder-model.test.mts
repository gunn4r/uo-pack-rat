// builder-model.test.mts — `app/ui/builder-model.mts`, the Suit Builder's pure logic.
//
// `app/ui/builder-model.mts`, the Suit Builder's pure logic: No character's name in words (issue #12), the Settings drawer's count of settings changed since the last build (issue #272), the Advanced fields' validation messages with the allowed range ("Enter a whole number from 1 to 10,000.") and that the page's limits equal the server's `OPTS_LIMITS`, which field a server refusal names, a resist tile's outcome line (short, meets, at cap, over cap), the result's other-changes badges (gains first, missed requirements as losses), "after the change" values and pool estimates, the compare table's differing piece cells, best totals (past the cap counts as the cap) and hidden-rows note, the three-run compare limit, and a saved run's automatic label and badges, and the Weapons chip wording, and a weight row's trade-off hover in importance (issues #217, #274). All `[fast]`. The rarity preference (issue #262) in words: the help line, the settings change, the rarity total and the Rarity row. What made up the score (issue #273): the rows, the Other fold, a negative share set apart. A requirement's line from the result shown (issue #272). Goals (issue #292): the goal rows and names, the Goals tab's edits (↑ ↓ move a rank, = links and unlinks, ✕, + Add a goal), a Set weight leaving goal mode, and How the goals went: each goal against its cap with a verdict that claims only what is known, Swing speed in seconds from the suit's own swing, the trades (a higher goal down for a lower one up, at most three, in words with the swing), and spare points gained or given up. Arriving at the builder (issue #272): the latest run per character, whether the gear changed since a run (the newest scan is not the run's own, else one newer than the run; a late-landing scan counts), the run to come back to, the built-in templates suggested for a character's skills, and the first-visit summary's lines. Issue #302: one name per property (a pool and the property that feeds it told apart; the score breakdown and a weight row's hover reading the goals' names), the first-visit summary's goals by rank with the spare points on their own line, a missed swing-time goal with another weapon saying the goal does not apply (by speed when known), and the spare-points line in goal names.
//
// Lives in app/ for the reason app/ui-render.test.mts gives.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { NOBODY, setRules, resistCapsFor, settingsDiff, importanceOf, roundImportance, weightOfImportance, PROP_LABELS, NOT_BUILDER_KEYS, labelOf, type Goals } from "./vault-lib.mts";
import { buffSkillValues, runBuffs } from "./buffs.mts";
import type { RulesV1 } from "./schema/types.d.mts";
import {
  propName, withStoredRoots, knobError, firstKnobError, knobFromServerError, ruleValueError,
  resistOutcome, locationCrumbs, changeRows, gaugeRows, gaugeNote, worse, gaugeTrack, changesSummary, afterChange, compareModel, hiddenRowsNote, toggleCompare, runAutoLabel, runBadges, plural, KNOB_RANGES,
  resistCapError, withResistCap, capNote, resistMinimumText, capsLine, anyOverridden, effectiveFloor, floorCapWarning, pruneResistCaps,
  weaponsChipText, weaponMustHaveChipText, toggleWeapon, weaponName, withBuffs, pastCapNotes, runSettingsDiff, weightTradeoff, newWeight, editedValue, NEW_WEIGHT_IMPORTANCE, templateBuffsLine, sourceTitle, who, rarityHelp, rarityTotal, rarityDetail, shareRows, needStatus, shownImportance,
  latestRun, latestShownRun, otherCharactersRuns, gearChangedSince, suggestTemplates, SUGGEST_MIN_SKILL, needsLine, topWeights, poolLine, searchLine,
  goalWord, goalName, goalRows, goalSummary, moveGoal, linkGoal, removeGoal, addGoal, goalOutcomes, goalTrades, goalVerdict, swingOutcome, tradeText, spareLine, applyAction,
  type Knobs, type ChangeRow,
} from "./ui/builder-model.mts";
import { OPTS_LIMITS } from "./vault-server.mts";
import { RUN_SETTING_LIMITS } from "./run-settings.mts";
import { templateSettings } from "./build-spec.mts";

setRules(JSON.parse(readFileSync(new URL("./rules/uoalive.json", import.meta.url), "utf8")) as RulesV1);
const melee = templateSettings(JSON.parse(readFileSync(new URL("./data/templates/uoalive.json", import.meta.url), "utf8")).templates.melee);

test("[fast] builder model: No character's pseudo name reads as words, a character's name as it is (issue #12)", () => {
  assert.equal(who(NOBODY), "No character");
  assert.equal(who("Kestrel"), "Kestrel");
});

test("[fast] builder model: property names read as words in rule rows", () => {
  assert.equal(propName("physResist"), "Physical resist");
  assert.equal(propName("hci"), "Hit chance increase");
  assert.equal(propName("stamPool"), "Stam pool");
  assert.equal(propName("sk:magery"), "Magery skill bonus");
});

test("[fast] builder model: the Only containers chip keeps a listed container that is no longer a root", () => {
  assert.deepEqual(withStoredRoots([{ value: "10", label: "Chest" }], [10, 0x4000abcd]), [{ value: "10", label: "Chest" }, { value: String(0x4000abcd), label: "Unknown container 0x4000ABCD (not in the scans)" }], "a listed serial that is no longer a root can still be unchecked");
  assert.deepEqual(withStoredRoots([{ value: "10", label: "Chest" }]), [{ value: "10", label: "Chest" }]);
});

test("[fast] builder model: the Weapons chip says the exclusions in words", () => {
  assert.equal(weaponsChipText([]), "Weapons: any");
  assert.equal(weaponsChipText(["archery", "throwing"]), "Weapons: 2 excluded");
  assert.equal(weaponsChipText(["archery", "swordsmanship", "mace fighting", "throwing"]), "Weapons: Fencing only");
  assert.equal(weaponsChipText(["archery", "swordsmanship", "fencing", "mace fighting", "throwing"]), "Weapons: none");
  // Use Best Weapon Skill is named only when some melee skill is excluded and some is still allowed.
  assert.equal(weaponsChipText(["archery", "fencing", "mace fighting", "throwing"], true), "Weapons: Swordsmanship only, plus Use Best Weapon Skill");
  assert.equal(weaponsChipText(["archery", "throwing"], true), "Weapons: 2 excluded", "every melee skill allowed: UBWS weapons pass anyway");
  assert.equal(weaponsChipText(["fencing", "mace fighting"], true), "Weapons: 2 excluded, plus Use Best Weapon Skill");
  assert.equal(weaponsChipText([], true), "Weapons: any");
  assert.equal(weaponsChipText(["swordsmanship", "fencing", "mace fighting"], true), "Weapons: 3 excluded", "no melee skill left to swing with");
  assert.equal(weaponsChipText(["archery", "fencing", "mace fighting", "throwing"], false), "Weapons: Swordsmanship only");
  assert.deepEqual(toggleWeapon(["throwing"], "archery", true), ["archery", "throwing"], "kept in the skills' order");
  assert.deepEqual(toggleWeapon(["archery", "throwing"], "archery", false), ["throwing"]);
  // Issue #259: Spellbooks add ", no spellbooks" to the chip, last in the list.
  assert.equal(weaponsChipText(["spellbook"]), "Weapons: any, no spellbooks");
  assert.equal(weaponsChipText(["archery", "throwing", "spellbook"]), "Weapons: 2 excluded, no spellbooks");
  assert.equal(weaponsChipText(["archery", "swordsmanship", "mace fighting", "throwing", "spellbook"]), "Weapons: Fencing only, no spellbooks");
  assert.equal(weaponsChipText(["archery", "swordsmanship", "fencing", "mace fighting", "throwing", "spellbook"]), "Weapons: none, no spellbooks");
  assert.equal(weaponsChipText(["fencing", "mace fighting", "spellbook"], true), "Weapons: 2 excluded, plus Use Best Weapon Skill, no spellbooks");
  assert.deepEqual(toggleWeapon(["throwing"], "spellbook", true), ["throwing", "spellbook"]);
  assert.deepEqual(toggleWeapon(["spellbook"], "archery", true), ["archery", "spellbook"], "spellbooks last");
  assert.equal(weaponName("spellbook"), "Spellbooks");
});

test("[fast] builder model: the Weapon must have chip names the required properties", () => {
  assert.equal(weaponMustHaveChipText(), "Weapon must have");
  assert.equal(weaponMustHaveChipText(["spell channeling"]), "Weapon must have: Spell Channeling");
  assert.equal(weaponMustHaveChipText(["spell channeling", "balanced"]), "Weapon must have: Spell Channeling, Balanced");
});

const knobs = (over: Partial<Knobs> = {}): Knobs => ({ strLimit: "110", restarts: "10000", exact: true, budgetS: "300", altCount: "5", altTol: "40", ...over });
// Issue #272: the Settings drawer's footer counts what runSettingsDiff names between the shown run and the panel, the
// same diff the runs drawer's "Same settings as the panel" reads, so the two never disagree.
test("[fast] builder model: the drawer's changes count is runSettingsDiff's, with the run drawer's defaults", () => {
  const run = { floors: { fireResist: 70, hci: 45 }, weights: { dci: 10 }, softFloors: [], lockedSlots: ["helmet", "ring"], excludeTags: ["cursed"], exact: true, restarts: 50, budgetMs: 2000, altCount: 0, altTol: 0, buffs: { on: ["divineFury"], skills: {} } };
  const count = (a: object, b: object): number => runSettingsDiff(a, b).length;
  assert.equal(count(run, structuredClone(run)), 0);
  // what the panel's snapshot always carries, against a run saved before those fields: Load these settings writes the
  // same defaults back, so loading an old run leaves nothing to count
  assert.equal(count(run, { ...run, allowGargoyle: false, medOnly: false, allowOthersWorn: false, ubwsAnyWeapon: true, excludeRoots: [], excludeSkills: [] }), 0, "an older run's absent fields read as their defaults");
  assert.equal(count(run, { ...run, lockedSlots: ["ring", "helmet"] }), 0, "a list in another order is the same set");
  assert.equal(count({ ...run, exact: false }, { ...run, exact: false, budgetMs: 300_000 }), 0, "the time budget does nothing without exact search");
  assert.equal(count(run, { ...run, weights: { dci: 11 } }), 1, "one weight changed");
  assert.equal(count(run, { ...run, weights: { dci: 11, luck: 1 } }), 2, "a weight changed and one added");
  assert.equal(count(run, { ...run, restarts: 77 }), 1, "a search knob");
  assert.equal(count(run, { ...run, buffs: { on: ["divineFury", "enemyOfOne"], skills: {} } }), 1, "a buff turned on");
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
  assert.deepEqual(KNOB_RANGES.restarts, { ...OPTS_LIMITS.restarts, whole: true });
  assert.equal(KNOB_RANGES.budgetS.max! * 1000, OPTS_LIMITS.timeBudgetMs.max);
  assert.deepEqual(KNOB_RANGES.altCount, { ...OPTS_LIMITS.alternativesCount, whole: true });
  assert.deepEqual(KNOB_RANGES.strLimit, RUN_SETTING_LIMITS.strLimit);
  assert.deepEqual(KNOB_RANGES.altTol, RUN_SETTING_LIMITS.altTol);
});

test("[fast] builder model: a resist tile says short, at cap, over cap or met", () => {
  assert.deepEqual(resistOutcome(18, 65, 70), { text: "47 short", tone: "warn" });
  assert.deepEqual(resistOutcome(69, 65, 70), { text: "Meets 65", tone: "ok" });
  assert.deepEqual(resistOutcome(70, 65, 70), { text: "At cap", tone: "ok" });
  assert.deepEqual(resistOutcome(86, 65, 70), { text: "16 over cap", tone: "muted" });
  assert.deepEqual(resistOutcome(40, null, 70), { text: "30 below cap", tone: "muted" });
});

test("[fast] builder model: a Fetch list location reads as its path of containers, never cut", () => {
  assert.deepEqual(locationCrumbs("Dorran's bank › Metal Chest (0x40001a2b) › A Bag"), ["Dorran's bank", "Metal Chest (0x40001a2b)", "A Bag"]);
  assert.deepEqual(locationCrumbs("Metal Chest (0x700b0000)"), ["Metal Chest (0x700b0000)"]);
  assert.deepEqual(locationCrumbs("Worn by Kestrel"), ["Worn by Kestrel"]);
  assert.deepEqual(locationCrumbs(""), ["Unknown place"]);
  assert.deepEqual(locationCrumbs(undefined), ["Unknown place"]);
});

test("[fast] builder model: What changes lists every property, gauges the moved non-resists gains first, and notes each against its cap (issue #272)", () => {
  const before = { dci: 20, hci: 25, di: 60, ssi: 30, luck: 340, strBonus: 8, physResist: 58, mageWeapon: -20 }, after = { dci: 45, hci: 45, di: 100, ssi: 55, luck: 120, strBonus: 6, physResist: 70, hpRegen: 7 };
  const caps = { dci: 45, hci: 45, di: 100, ssi: 60, hpRegen: 18, physResist: 70 };
  const rows = changeRows(before, after, caps, { floors: { hci: 40 }, weights: { intBonus: 1 }, extra: ["tagPenalty"], shares: [{ property: "physResist", share: 0.4 }, { property: "dci", share: 0.3 }, { property: "intBonus", share: 0 }] });
  assert.deepEqual(rows.map((r) => r.key), ["physResist", "hci", "dci", "ssi", "di", "hpRegen", "strBonus", "intBonus", "luck"], "registry order, resists first; a weight with nothing counts, never the tag penalty or Mage Weapon");
  assert.deepEqual(rows.find((r) => r.key === "dci"), { key: "dci", now: 20, suit: 45, cap: 45, delta: 25, share: 0.3, floor: null, sign: 1 });
  assert.equal(rows.find((r) => r.key === "intBonus")!.share, null, "a share of nothing is blank");
  assert.equal(rows.find((r) => r.key === "luck")!.cap, null);
  const all = gaugeRows(rows, rows.map((r) => r.key)), g = all.gauges;
  assert.deepEqual(g.map((r) => r.key), ["hci", "dci", "ssi", "di", "hpRegen", "strBonus", "luck"], "no resist, nothing unchanged, the losses last");
  assert.equal(all.more, 0);
  // only what the build asks for gets a gauge, a loss of it included; the rest is counted for the Table
  const some = gaugeRows(rows, ["hci", "luck", "intBonus", "physResist"]);
  assert.deepEqual([some.gauges.map((r) => r.key), some.more], [["hci", "luck"], 5]);
  // a pool never beside its bonus's gauge, alone it keeps one
  const pools = changeRows({ stamInc: 0, stamPool: 0, manaPool: 5 }, { stamInc: 10, stamPool: 10, manaPool: 9 }, {});
  assert.deepEqual([gaugeRows(pools, ["stamInc", "stamPool", "manaPool"]).gauges.map((r) => r.key), gaugeRows(pools, ["stamInc", "stamPool", "manaPool"]).more], [["stamInc", "manaPool"], 1]);
  const at = (k: string, next: number | null = null): string => gaugeNote(g.find((r) => r.key === k)!, next).text;
  assert.deepEqual([at("dci"), at("di"), at("hpRegen"), at("luck"), at("strBonus")], ["at cap", "at cap", "11 under cap", "given up", "given up"]);
  assert.equal(at("ssi", 58), "next step 58");
  assert.equal(at("ssi"), "5 under cap", "no swing: against the cap");
  assert.equal(at("ssi", 65), "5 under cap", "a step past the cap is not offered");
  const row = (o: Partial<ChangeRow>): ChangeRow => ({ key: "hci", now: 0, suit: 0, cap: null, delta: 0, share: null, floor: null, sign: 1, ...o });
  assert.deepEqual(gaugeNote(row({ now: 30, suit: 35, cap: 45, delta: 5, floor: 40 })), { text: "needs 40", warn: true }, "a missed requirement wins");
  assert.equal(gaugeNote(row({ key: "di", now: 90, suit: 110, cap: 100, delta: 10 })).text, "10 over cap");
  assert.equal(gaugeNote(row({ key: "sk:magery", suit: 5, delta: 5 })).text, "up from 0");
  assert.deepEqual(gaugeTrack(g.find((r) => r.key === "ssi")!), { fill: (100 * 55) / 60, tick: 50 });
  assert.deepEqual(gaugeTrack(g.find((r) => r.key === "luck")!), { fill: (100 * 120) / 340, tick: 100 }, "no cap: against the larger of the two");
  assert.deepEqual(gaugeTrack(row({ key: "strBonus", now: -5, suit: -2, delta: 3 })), { fill: 40, tick: 100 }, "negative totals with no cap draw by size");
  assert.equal(changesSummary(g), "5 up · 2 down · HCI, DCI and DI reach their caps");
  assert.equal(changesSummary(g.filter((r) => r.key === "dci")), "1 up · DCI reaches its cap");
  assert.equal(changesSummary([]), "No other property changes");
});

test("[fast] builder model: What changes keeps a missed requirement, judges on what counts under the cap, and follows a negative weight (issue #272)", () => {
  // a requirement the suit misses has a gauge even when it does not move
  const missed = changeRows({ hci: 30 }, { hci: 30 }, { hci: 45 }, { floors: { hci: 35 } });
  const mg = gaugeRows(missed, []).gauges;
  assert.deepEqual(mg.map((r) => [r.key, r.delta, gaugeNote(r).text]), [["hci", 0, "needs 35"]]);
  assert.equal(changesSummary(mg), "1 requirement not met");
  // over the cap: DI 130 worn and 100 in the suit, cap 100, is no change; 110 → 120 neither; 130 → 90 is −10
  const capped = changeRows({ di: 130, hci: 50, dci: 130 }, { di: 100, hci: 60, dci: 90 }, { di: 100, hci: 45, dci: 100 }, { weights: { di: 1, hci: 1, dci: 1 } });
  assert.deepEqual(capped.map((r) => [r.key, r.delta]), [["hci", 0], ["dci", -10], ["di", 0]]);
  const cg = gaugeRows(capped, ["di", "hci", "dci"]);
  assert.deepEqual([cg.gauges.map((r) => r.key), cg.more], [["dci"], 0], "only the change in what counts");
  assert.equal(changesSummary(cg.gauges), "1 down");
  // a negative weight: a drop is what the build wants, a rise counts against it
  const neg = changeRows({ "sk:necromancy": 5, intBonus: 0 }, { "sk:necromancy": 0, intBonus: 4 }, {}, { weights: { "sk:necromancy": -50, intBonus: -2 } });
  const ng = gaugeRows(neg, ["sk:necromancy", "intBonus"]).gauges;
  assert.deepEqual(ng.map((r) => [r.key, r.sign, worse(r), gaugeNote(r).text]), [["sk:necromancy", -1, false, "down from 5"], ["intBonus", -1, true, "counts against"]], "the better one first");
  assert.equal(worse(changeRows({ luck: 100 }, { luck: 50 }, {})[0]!), true, "a plain loss");
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
  assert.deepEqual(m.pieces.map((r) => r.cells.map((c) => c.serial)), [[7, null, null], [8, 8, 9]], "a piece's serial, for its item tooltip");
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
  // Resisting Spells' minimum of 40: Cold's 10 reads 40, which meets its requirement of 40; Poison's 50 misses 65
  const badges = runBadges(8, { physResist: 69, fireResist: 80, coldResist: 10, poisonResist: 50, energyResist: 65 }, { physResist: 65, fireResist: 65, coldResist: 40, poisonResist: 65, energyResist: 65 }, 40, { physResist: 70, fireResist: 70, coldResist: 70, poisonResist: 70, energyResist: 70 });
  assert.deepEqual(badges.map((b) => b.text), ["8 changes", "4 of 5 met", "Phys 69", "Fire 70", "Cold 40", "Poison 50", "Energy 65"]);
  assert.equal(badges[1]!.tone, "warn");
  const met = runBadges(8, { physResist: 69, fireResist: 80, coldResist: 10, poisonResist: 65, energyResist: 65 }, { coldResist: 40 }, 40, { physResist: 70, fireResist: 70, coldResist: 70, poisonResist: 70, energyResist: 70 });
  assert.deepEqual([met[1]!.text, met[1]!.tone], ["1 of 1 met", "ok"]);
  assert.ok(runBadges(1, { coldResist: 10 }, {}, null, { coldResist: 70 }).some((b) => b.text === "Cold 10"), "no minimum: the item total");
  assert.deepEqual(runBadges(null, null, {}, null, {}), [], "an old run with no summary data gets no badges");
  assert.equal(plural(1, "change"), "1 change");
  assert.equal(plural(2, "skill bonus", "skill bonuses"), "2 skill bonuses");
});

test("[fast] builder model: a run's buffs show in its label and diff, and a run saved before buffs reads as none", () => {
  const values = { ...buffSkillValues(null, {}).values, Chivalry: 105 };
  const df = runBuffs(["divineFury"], values)!, old = { floors: { ssi: 60 } };
  assert.equal(runAutoLabel(old, { ...old, buffs: df }).text, "+Divine Fury");
  assert.equal(runAutoLabel({ ...old, buffs: df }, old).text, "−Divine Fury");
  assert.equal(runAutoLabel(old, { floors: { ssi: 50 }, buffs: df }).text, "SSI floor 60 → 50 · +Divine Fury");
  assert.equal(runAutoLabel(old, { ...old }).text, "Same settings as the run before", "two runs from before buffs");
  assert.deepEqual(runSettingsDiff({ ...old, buffs: df }, { ...old, buffs: runBuffs(["divineFury"], { ...values, Chivalry: 120 }) }), ["Chivalry 105 → 120"]);
});

test("[fast] builder model: a result's totals with the buffs it planned with, in paperdoll terms, and what they add past the cap", () => {
  const caps = { physResist: 70, fireResist: 70, coldResist: 70, poisonResist: 70, energyResist: 70, ssi: 60, dci: 45, di: 100 };
  const plan = { on: ["divineFury", "enemyOfOne"], skills: { ...buffSkillValues(null, {}).values, Chivalry: 105 }, stats: null, who: {} };
  const r = withBuffs({ ssi: 45, dci: 30, di: 90, fireResist: 30 }, 70, caps, plan);
  assert.deepEqual([r.totals.ssi, r.totals.dci, r.totals.fireResist, r.totals.di], [55, 10, 30, 100], "Fire 30 over the minimum of 20: gear's own");
  assert.deepEqual(pastCapNotes(r), { di: { text: "+68 past the cap (Enemy of One)", short: "+68 past" } });
  const none = withBuffs({ ssi: 45 }, 70, caps, null);
  assert.deepEqual([none.totals.ssi, none.totals.fireResist, none.lifted.length, pastCapNotes(none)], [45, 20, 5, {}], "without buffs: the paperdoll totals alone, every resist held at the minimum");
  assert.equal(withBuffs({ ssi: 45 }, null, caps, null).totals.fireResist, undefined, "no minimum: nothing added");
});

// ---- resist cap overrides (issue #44)
test("[fast] resist caps: the field takes a whole number 0-150, and a cap set back to the shard's is no override", () => {
  assert.equal(resistCapError("95"), null);
  assert.equal(resistCapError("0"), null);
  assert.equal(resistCapError("150"), null);
  for (const bad of ["", "abc", "95.5", "-1", "151"]) assert.equal(resistCapError(bad), "Enter a whole number from 0 to 150.", bad);
  assert.deepEqual(withResistCap({}, "fireResist", 95, 70), { fireResist: 95 });
  assert.deepEqual(withResistCap({ fireResist: 95 }, "fireResist", 70, 70), {}, "back at the shard's cap");
  assert.deepEqual(withResistCap(undefined, "coldResist", 60, 70), { coldResist: 60 });
  const before = { fireResist: 95 };
  withResistCap(before, "coldResist", 60, 70);
  assert.deepEqual(before, { fireResist: 95 }, "pure: the old overrides are untouched");
});

test("[fast] resist caps: notes, the Requirements note, the compare line", () => {
  assert.equal(capNote({ cap: 95, shard: 70 }), "raised from 70");
  assert.equal(capNote({ cap: 50, shard: 70 }), "lowered from 70");
  assert.equal(capNote({ cap: 70, shard: 70 }), null);
  const human = resistCapsFor("human", {}), elf = resistCapsFor("elf", {});
  assert.equal(resistMinimumText("Ana", 40), "Resisting Spells keeps each of Ana's resists at 40 or more: a resist requirement of 40 or less is met by any suit.");
  assert.equal(resistMinimumText("Ana", null), null, "no minimum, nothing said");
  assert.equal(resistMinimumText("Ana", 0), null, "a minimum of 0 meets no requirement: nothing said");
  assert.equal(capsLine(human), "Shard caps");
  assert.equal(capsLine(resistCapsFor("human", { fireResist: 95 })), "Fire 95 (raised from 70)");
  assert.equal(anyOverridden(elf), false, "an Elf's Energy 75 is the shard's own");
  assert.equal(anyOverridden(resistCapsFor("human", { energyResist: 75 })), true);
});

test("[fast] resist caps: a run's badges say its overridden cap, and compare judges each run by its own caps", () => {
  const caps = { physResist: 70, fireResist: 95, coldResist: 70, poisonResist: 70, energyResist: 70 };
  const shard = { ...caps, fireResist: 70 };
  const badges = runBadges(3, { physResist: 70, fireResist: 90, coldResist: 30, poisonResist: 30, energyResist: 30 }, {}, 40, caps, shard).map((b) => b.text);
  assert.ok(badges.includes("Fire 90 · cap 95"), JSON.stringify(badges));
  assert.ok(badges.includes("Phys 70"), "an untouched resist reads as before");
  assert.ok(runBadges(3, { fireResist: 90 }, {}, 40, shard).map((b) => b.text).includes("Fire 70"), "no shard caps given: nothing is marked");
  // Fire 90 in a run built for a cap of 95 beats Fire 86 in one built for 70 (worth 70 there).
  const m = compareModel([{ assignment: {}, totals: { fireResist: 86 } }, { assignment: {}, totals: { fireResist: 90 }, caps: { fireResist: 95 } }], [], ["fireResist"], { fireResist: 70 });
  assert.deepEqual(m.totals[0]!.best, [false, true]);
});

// Review of #48: a requirement above its resist's cap counts only up to the cap (the solver clamps it), so every
// "met" view agrees with the solver, the row warns, and a race change drops an override that became the shard's.
test("[fast] resist caps: a floor above its cap counts only up to it, warns, and a race change drops a now-default override", () => {
  const caps = { physResist: 70, fireResist: 70, coldResist: 70, poisonResist: 70, energyResist: 70 };
  assert.equal(effectiveFloor("fireResist", 90, caps), 70);
  assert.equal(effectiveFloor("fireResist", 60, caps), 60);
  assert.equal(effectiveFloor("hci", 90, caps), 90, "only resists are clamped");
  assert.equal(floorCapWarning("fireResist", 90, 70), "Counts only up to the Fire cap, 70");
  assert.equal(floorCapWarning("fireResist", 70, 70), null);
  assert.equal(floorCapWarning("hci", 90, 45), null);
  // Fire 90 required, cap back at 70, suit Fire 86: met, as the headline and the solver say.
  const badges = runBadges(1, { physResist: 70, fireResist: 86, coldResist: 70, poisonResist: 70, energyResist: 70 }, { physResist: 65, fireResist: 90, coldResist: 65, poisonResist: 65, energyResist: 65 }, null, caps).map((b) => b.text);
  assert.ok(badges.includes("5 of 5 met"), JSON.stringify(badges));
  assert.deepEqual(pruneResistCaps({ energyResist: 75, fireResist: 95 }, "elf"), { fireResist: 95 });
  assert.deepEqual(pruneResistCaps({ energyResist: 75 }, "human"), { energyResist: 75 });
  assert.deepEqual(pruneResistCaps(undefined, "elf"), {});
});

test("[fast] builder model: a weight row's hover says the trade-off with the top weight, in whole units of the smaller one (issue #274)", () => {
  const w = melee.weights!;   // from its goals: SSI 100, HCI = DCI 80, DI 65, Luck 5
  assert.equal(weightTradeoff("luck", w), "At these settings, 1 SSI is worth about 167 Luck.");
  assert.equal(weightTradeoff("dci", w), "At these settings, 1 DCI is worth about 1.1 SSI.");
  assert.equal(weightTradeoff("ssi", w), "Swing speed has the highest weight: the other weights are compared with it.");
  assert.equal(weightTradeoff("physResist", { dci: 10, physResist: 6 }), "At these settings, 1 DCI is worth about 2 Phys.");
  assert.equal(weightTradeoff("di", { di: 1, luck: 0.5 }), "At these settings, 1 DI is worth about 2 Luck.", "the top by importance, Luck, is worth less per point");
  assert.equal(weightTradeoff("luck", { luck: 0.001, dci: 10 }), "At these settings, 1 DCI is worth far more than 1,000 Luck.", "no number past 1,000");
  assert.equal(weightTradeoff("luck", { tagPenalty: 100, dci: 1, luck: 0.05 }), "At these settings, 1 DCI is worth about 20 Luck.", "the tag penalty is not a weight row");
  // a negative weight, either way round; a zero weight; no positive weight to compare with
  assert.equal(weightTradeoff("intBonus", { dci: 10, intBonus: -2 }), "At these settings, 1 DCI makes up for about 5 INT.");
  assert.equal(weightTradeoff("intBonus", { dci: 1, intBonus: -5 }), "At these settings, 1 INT takes away what about 5 DCI adds.");
  assert.equal(weightTradeoff("intBonus", { dci: 10, intBonus: -7.2 }), "At these settings, 1 DCI makes up for about 1.4 INT.", "one decimal under 1.5");
  assert.equal(weightTradeoff("hci", { dci: 10, hci: 10 }), "At these settings, 1 HCI is worth about 1 DCI.");
  assert.equal(weightTradeoff("luck", { dci: 10, luck: 0 }), "At weight 0, Luck doesn't count.");
  assert.equal(weightTradeoff("intBonus", { intBonus: -2 }), "Intelligence counts against the score.");
  // a Resisting Spells skill bonus also lifts the resist minimums, which its weight leaves out
  assert.equal(weightTradeoff("sk:resisting spells", { dci: 10, "sk:resisting spells": 2 }), "At these settings, 1 DCI is worth about 5 Resisting Spells. It also raises your resist minimums.");
});

test("[fast] builder model: a new weight starts at importance 25 for every property, and a weight field merely touched keeps its exact value (issue #274)", () => {
  for (const k of [...Object.keys(PROP_LABELS).filter((x) => !NOT_BUILDER_KEYS.has(x)), "sk:magery"]) assert.ok(Math.abs(importanceOf(k, newWeight(k)) - NEW_WEIGHT_IMPORTANCE) < 1e-9, k);
  assert.equal(NEW_WEIGHT_IMPORTANCE, 25);
  // Melee's DI (3 per point) shows 67 and Luck (0.05) shows 5.6
  const conv = (k: string) => ({ show: (w: number) => roundImportance(importanceOf(k, w)), store: (n: number) => weightOfImportance(k, n) });
  assert.equal(editedValue(3, 3, 67, conv("di")), 3, "retyping the shown number");
  const up = editedValue(0.05, 0.05, 5.7, conv("luck"));
  assert.equal(up, weightOfImportance("luck", 5.7), "↑ stores the new number");
  assert.equal(editedValue(0.05, up, 5.6, conv("luck")), 0.05, "↓ back to the first shown number puts the first value back");
  assert.equal(editedValue(0.05, 0.0504, 5.6, conv("luck")), 0.05);
  const typed = editedValue(3, 3, 12.5, conv("di"));
  assert.equal(editedValue(3, typed, 13, conv("di")), typed, "the number the current value shows keeps it");
  // and a change too small to show is not named
  assert.deepEqual(settingsDiff({ weights: { luck: 0.05, di: 3 } }, { weights: { luck: 0.0504, di: 3.015 } }), []);
  assert.deepEqual(settingsDiff({ weights: { luck: 0.05 } }, { weights: { luck: 0.06 } }), ["Luck weight 5.6 → 6.7"]);
});

// Issue #212: the template badge's buffs line compares the lists as sets, and a source link is named by its page.
test("[fast] builder model: the template badge's buffs line and a source page's title", () => {
  assert.equal(templateBuffsLine(["divineFury", "consecrateWeapon"], ["consecrateWeapon", "divineFury"]), null, "order does not matter");
  assert.equal(templateBuffsLine(["divineFury", "consecrateWeapon"], ["divineFury", "enemyOfOne"]), "Buffs: +Enemy of One, −Consecrate Weapon");
  assert.equal(templateBuffsLine([], ["bless"]), "Buffs: +Bless");
  assert.equal(sourceTitle("https://uoalive.com/wiki/PlayerGuide:Lazy_Pally"), "Lazy Pally");
  assert.equal(sourceTitle("https://uoalive.com/wiki/The_Crusade_Milestone_(Healing/Paladin_Update)"), "The Crusade Milestone (Healing/Paladin Update)");
  assert.equal(sourceTitle("https://uoalive.com/forum/threads/archer-chiv-build.267/"), "archer chiv build");
  assert.equal(sourceTitle("https://uoalive.com/wiki/PlayerGuide:ABC_Tamer_-_Hunter"), "ABC Tamer - Hunter");
  assert.equal(sourceTitle("not a url"), "not a url");
});

// Issue #262: the rarity preference in words: the help line, a template's or run's change, and the
// result's Rarity row with the rarity total (higher means rarer, whichever way the preference points).
test("[fast] rarity preference: help line, settings change, rarity total and the Rarity row", () => {
  assert.equal(rarityHelp(undefined), "");
  assert.equal(rarityHelp("lower"), "Among equally good suits, use the lowest-rarity pieces. Requirements come first.");
  assert.equal(rarityHelp("higher"), "Among equally good suits, use the highest-rarity pieces. Requirements come first.");
  assert.deepEqual(settingsDiff({}, { rarity: "lower" }), ["prefer lower rarity"]);
  assert.deepEqual(settingsDiff({ rarity: "higher" }, {}), ["any rarity"]);
  assert.deepEqual(settingsDiff({ rarity: "higher" }, { rarity: "higher" }), []);
  // a Legendary (8) and a Minor Magic Item (1), and a slot left empty: 9 either way
  assert.equal(rarityTotal({ ring: { tieCost: 8 }, neck: { tieCost: 1 }, waist: null }, "lower", 8), 9);
  assert.equal(rarityTotal({ ring: { tieCost: 0 }, neck: { tieCost: 7 }, waist: null }, "higher", 8), 9);
  assert.equal(rarityDetail({ topScore: 10, cost: 6, rarity: "lower", tolerance: 0, costProven: true }, 6), "Lowest-rarity pieces among equal suits · rarity total 6");
  assert.equal(rarityDetail({ topScore: 10, cost: 30, rarity: "higher", tolerance: 0 }, 66), "Highest-rarity pieces among equal suits · rarity total 66 (the highest found, not proven)");
});

test("[fast] builder model: what made up the score, largest first, shares under 2% folded into Other, a negative one set apart after them (issue #273)", () => {
  const rows = shareRows([{ property: "di", share: 0.41 }, { property: "physResist", share: 0.3, fromMin: true }, { property: "hci", share: 0.2 }, { property: "luck", share: 0.012 }, { property: "lmc", share: 0.004 }, { property: "intBonus", share: -0.074 }]);
  assert.deepEqual(rows.map((r) => [r.label, r.pct, r.negative]), [["Damage", "41%", false], ["Physical resist", "30%", false], ["Hit chance", "20%", false], ["Other (2)", "2%", false], ["Intelligence", "−7%", true]]);
  assert.equal(rows[1]!.note, "includes the Resisting Spells minimum");
  assert.equal(rows[3]!.holds, "Luck, Lower mana cost");
  assert.deepEqual(rows.map((r) => r.key), ["di", "physResist", "hci", null, "intBonus"], "each row names its property for its weight link; Other has none");
  // a lone small share keeps its own name; a share that rounds to nothing says so
  assert.deepEqual(shareRows([{ property: "di", share: 0.996 }, { property: "luck", share: 0.004 }]).map((r) => [r.label, r.pct]), [["Damage", "100%"], ["Luck", "<1%"]]);
  assert.deepEqual(shareRows([]), [], "a run saved before #273 has none");
  // Show all: a fold of 0 lists every property on its own row
  assert.deepEqual(shareRows([{ property: "di", share: 0.9 }, { property: "luck", share: 0.01 }, { property: "lmc", share: 0.01 }, { property: "hci", share: 0 }], 0).map((r) => [r.label, r.pct]), [["Damage", "90%"], ["Luck", "1%"], ["Lower mana cost", "1%"], ["Hit chance", "0%"]]);
});

test("[fast] builder model: a requirement's line from the result shown: met, short, a floor or a total past its cap, the next swing step (issue #272)", () => {
  const caps = { dci: 45, ssi: 60, fireResist: 70 };
  assert.deepEqual(needStatus("dci", 45, 45, caps), { text: "Met: 45", tone: "ok" });
  assert.deepEqual(needStatus("dci", 45, 32, caps), { text: "13 short", tone: "warn" });
  // a resist requirement past its cap counts only up to the cap, as the solver scores it
  assert.deepEqual(needStatus("fireResist", 80, 70, caps), { text: "Met: 70", tone: "ok" });
  assert.deepEqual(needStatus("fireResist", 70, 68, caps), { text: "2 short", tone: "warn" });
  // a total past the cap reads the cap, as the paperdoll does, and says what the cap wastes
  assert.deepEqual(needStatus("physResist", 60, 78, { physResist: 70 }), { text: "Met: 70 (+8 past cap)", tone: "ok" });
  assert.deepEqual(needStatus("dci", 45, 52, caps), { text: "Met: 45 (+7 past cap)", tone: "ok" });
  assert.deepEqual(needStatus("luck", 100, 150, caps), { text: "Met: 150", tone: "ok" }, "no cap: the total");
  // met or short is the solver's: the raw total against the floor, a non-resist floor past its cap included
  assert.deepEqual(needStatus("dci", 50, 60, caps), { text: "Met: 45 (+15 past cap)", tone: "ok" });
  assert.deepEqual(needStatus("dci", 50, 40, caps), { text: "10 short", tone: "warn" });
  const next = { value: 58, seconds: 1.25 };
  assert.deepEqual(needStatus("ssi", 50, 55, caps, next, "Katana"), { text: "Next swing step at 58 (1.25 s with Katana)", tone: "ok" });
  assert.deepEqual(needStatus("ssi", 58, 55, caps, next, "Katana"), { text: "3 short · Next swing step at 58 (1.25 s with Katana)", tone: "warn" });
  assert.deepEqual(needStatus("ssi", 50, 60, caps, null, null), { text: "Met: 60", tone: "ok" }, "no faster step within the cap");
});

test("[fast] builder model: a weight's box shows its importance as stored, to two decimals with no trailing zeros (issue #272)", () => {
  assert.equal(String(shownImportance(12.5)), "12.5");
  assert.equal(String(shownImportance(93.33333333)), "93.33");
  assert.equal(String(shownImportance(100.0000001)), "100");
  assert.equal(String(shownImportance(-40)), "-40");
  // a typed decimal survives the round trip through the stored per-point weight
  for (const [k, typed] of [["luck", 12.5], ["dci", 7.25], ["physResist", 93.33]] as const) assert.equal(shownImportance(importanceOf(k, weightOfImportance(k, typed))), typed, k);
});

test("[fast] builder model: the latest run per character, and the gear changed since a run (issue #272)", () => {
  const runs = [
    { id: "a1", character: "Ana", createdAt: "2026-10-10T10:00:00Z" },
    { id: "a2", character: "Ana", createdAt: "2026-10-12T10:00:00Z" },
    { id: "b1", character: "Bo", createdAt: "2026-10-11T10:00:00Z" },
    { id: "c1", character: "Cy", createdAt: "2026-10-09T10:00:00Z" },
    { id: "d1", character: "Di", createdAt: "2026-10-08T10:00:00Z" },
    { id: "x", createdAt: "2026-10-13T10:00:00Z" },
  ];
  assert.equal(latestRun(runs.slice(0, 2))?.id, "a2", "by when it was built, not the list's order");
  assert.equal(latestRun([]), null);
  assert.deepEqual(otherCharactersRuns(runs, "Bo").map((r) => r.id), ["a2", "c1", "d1"], "one per character, newest first, the character's own and a run with no character left out");
  assert.deepEqual(otherCharactersRuns(runs, "Ana", 2).map((r) => r.id), ["b1", "c1"]);
  assert.deepEqual(otherCharactersRuns(runs.slice(0, 2), "Ana"), []);

  const scans = [{ scannedAt: "2026-10-12T09:00:00Z" }, { scannedAt: "2026-10-12T11:00:00Z" }];
  // a run with the stamp of the scan it was built from: changed exactly when the newest scan is another
  assert.equal(gearChangedSince(scans, { inventoryStamp: "2026-10-12T11:00:00Z", createdAt: "2026-10-12T11:05:00Z" }), false, "built from the newest scan");
  assert.equal(gearChangedSince(scans, { inventoryStamp: "2026-10-12T09:00:00Z", createdAt: "2026-10-12T09:05:00Z" }), true, "a newer scan since");
  // a scan started before the build and landing after it: stamped earlier than the run's time, still a change
  const late = [{ scannedAt: "2026-10-12T10:00:00Z" }, { scannedAt: "2026-10-12T10:30:00Z" }];
  assert.equal(gearChangedSince(late, { inventoryStamp: "2026-10-12T10:00:00Z", createdAt: "2026-10-12T10:31:00Z" }), true, "the late-landing scan");
  assert.equal(gearChangedSince([], { inventoryStamp: "2026-10-12T10:00:00Z", createdAt: "2026-10-12T10:31:00Z" }), false, "no scan");
  // no stamp recorded: a scan newer than the run's build time
  assert.equal(gearChangedSince(scans, { createdAt: "2026-10-12T10:00:00Z" }), true, "a scan newer than the run");
  assert.equal(gearChangedSince(scans, { inventoryStamp: "", createdAt: "2026-10-12T12:00:00Z" }), false);
  assert.equal(gearChangedSince(scans, { inventoryStamp: null, createdAt: "2026-10-12T11:00:00Z" }), false, "a scan at the run's own time is no change");
  assert.equal(gearChangedSince([], { createdAt: "2026-10-12T10:00:00Z" }), false, "no scan");
  assert.equal(gearChangedSince(scans, {}), false, "neither a stamp nor a time");
  assert.equal(gearChangedSince(scans, { createdAt: "not a time" }), false);
  assert.equal(gearChangedSince([{ scannedAt: "" }], { createdAt: "2026-10-12T10:00:00Z" }), false, "a scan with no time");
  assert.equal(latestShownRun([...runs.slice(0, 2).map((r) => ({ ...r, method: "exact" })), { id: "z", character: "Ana", createdAt: "2026-10-14T10:00:00Z", method: null }])?.id, "a2", "a run with no suit is passed over");
});

test("[fast] builder model: the built-in templates suggested for a character's skills (issue #272)", () => {
  const cands = [
    { ref: "builtin:melee", text: "Melee" }, { ref: "builtin:caster", text: "Caster" }, { ref: "builtin:archer", text: "Archer" }, { ref: "builtin:tank", text: "Tank" },
    { ref: "builtin:chivArcher", text: "Archer (Chivalry) Archery, Tactics, Anatomy, Healing and Chivalry archer" },
    { ref: "builtin:summoner", text: "Summoner Magery, Eval, Mysticism, Focus Magery" },
  ];
  assert.deepEqual(suggestTemplates(cands, {}), ["builtin:melee", "builtin:caster", "builtin:archer"], "no skills: catalog order");
  assert.deepEqual(suggestTemplates(cands, { Archery: 100, Chivalry: 90, Magery: 40 }), ["builtin:chivArcher", "builtin:summoner", "builtin:melee"], "the most skill points named first");
  assert.deepEqual(suggestTemplates(cands, { Magery: SUGGEST_MIN_SKILL - 1 }, 2), ["builtin:melee", "builtin:caster"], "an untrained skill counts for nothing");
});

test("[fast] builder model: the first-visit summary's lines (issue #272)", () => {
  const short = (k: string): string => labelOf(k);
  assert.equal(needsLine({ physResist: 70, fireResist: 70, coldResist: 70, poisonResist: 70, energyResist: 70, dci: 45, ssi: 55 }, ["ssi"], short), `Resists 70 · ${short("dci")} 45 · ${short("ssi")} 55 (soft)`);
  assert.equal(needsLine({ physResist: 70, fireResist: 65, dci: 45 }, ["fireResist"], short), `${short("physResist")} 70 · ${short("fireResist")} 65 (soft) · ${short("dci")} 45`, "resists that differ are listed one by one");
  assert.equal(needsLine({ physResist: 70, fireResist: 70, coldResist: 70, poisonResist: 70, energyResist: 70 }, ["fireResist"], short).startsWith("Resists"), false, "one soft resist breaks the group");
  assert.equal(needsLine({}, [], short), "None");
  assert.equal(needsLine({ tagPenalty: 1 }, [], short), "None", "not a builder property");

  const w = { physResist: 6, fireResist: 6, coldResist: 6, poisonResist: 6, energyResist: 6, dci: 10, hci: 10, ssi: 5, luck: 0.05, lmc: 0, tagPenalty: -25 };
  const top = topWeights(w);
  assert.deepEqual(top.rows.map((r) => r.key), ["dci", "hci", "resists", "ssi"]);
  assert.equal(top.rows[2]!.importance, importanceOf("physResist", 6));
  assert.equal(top.more, 1, "Luck is the one more; a zero weight and the tag penalty are not weights that add");
  assert.deepEqual(topWeights({ ...w, fireResist: 3 }, 10).rows.filter((r) => /Resist$/.test(r.key)).length, 5, "resists that differ are rows of their own");
  assert.deepEqual(topWeights({}), { rows: [], more: 0 });

  assert.equal(poolLine([], true, 1284), "Any weapon · 1,284 pieces · any rarity");
  assert.equal(poolLine(["archery", "fencing", "mace fighting", "throwing"], false, null, "lower"), "Swordsmanship only · prefer lower rarity");
  assert.equal(poolLine(["archery", "throwing"], false, 1), "2 weapon skills left out · 1 piece · any rarity");
  assert.equal(searchLine({ exact: true, budgetS: "30", restarts: "20" }), "Exact, up to 30 s");
  assert.equal(searchLine({ exact: false, budgetS: "30", restarts: "20" }), "Heuristic, 20 restarts");
});

// Issue #292: the Goals tab's rows and edits, and the result's "How the goals went".
const MELEE_GOALS: Goals = { ranks: [["ssi"], ["hci", "dci"], ["di"]], swing: { mode: "fastest" }, leftover: "luck" };
test("[fast] builder model: the goal rows, their names and the Goals tab's edits (issue #292)", () => {
  assert.deepEqual(goalRows(MELEE_GOALS), [{ key: "ssi", rank: 1, linked: false, counts: 100 }, { key: "hci", rank: 2, linked: false, counts: 80 }, { key: "dci", rank: 2, linked: true, counts: 80 }, { key: "di", rank: 3, linked: false, counts: 65 }]);
  assert.deepEqual(["ssi", "hci", "di", "physResist", "lmc", "sk:magery"].map(goalName), ["Swing speed", "Hit chance", "Damage", "Physical resist", "Lower mana cost", "Magery skill bonus"]);
  assert.equal(goalWord("hci"), "hit chance");
  // issue #302: a pool and the property that feeds it can't be mixed up; the weight rows and the score breakdown use these names too
  assert.deepEqual(["stamPool", "stamInc", "manaPool", "manaInc", "hitsPool", "hpi"].map(goalName), ["Stamina (total)", "Stamina bonus", "Mana (total)", "Mana bonus", "Hit points (total)", "Hit point bonus"]);
  assert.equal(new Set(["stamPool", "stamInc", "manaPool", "manaInc", "hitsPool", "hpi", "stamRegen", "manaRegen", "hpRegen"].map(goalName)).size, 9);
  assert.deepEqual(shareRows([{ property: "ssi", share: 0.5 }, { property: "stamInc", share: 0.5 }]).map((r) => r.label), [goalName("ssi"), goalName("stamInc")], "the breakdown reads the goals' names");
  assert.match(weightTradeoff("ssi", { ssi: 1 }), /^Swing speed has/, "so does a weight row's hover");
  // ↑ and ↓ move a whole rank; the ends go nowhere
  assert.deepEqual(moveGoal(MELEE_GOALS, "di", -1).ranks, [["ssi"], ["di"], ["hci", "dci"]]);
  assert.deepEqual(moveGoal(MELEE_GOALS, "dci", -1).ranks, [["hci", "dci"], ["ssi"], ["di"]], "a linked row moves with its rank");
  assert.equal(moveGoal(MELEE_GOALS, "ssi", -1), MELEE_GOALS);
  assert.equal(moveGoal(MELEE_GOALS, "di", 1), MELEE_GOALS);
  // "=" links a row to the one above, and unlinking gives it its own rank, the rows linked under it with it
  assert.deepEqual(linkGoal(MELEE_GOALS, "di", true).ranks, [["ssi"], ["hci", "dci", "di"]]);
  assert.deepEqual(linkGoal(MELEE_GOALS, "dci", false).ranks, [["ssi"], ["hci"], ["dci"], ["di"]]);
  assert.deepEqual(linkGoal({ ...MELEE_GOALS, ranks: [["a", "b", "c"]] }, "b", false).ranks, [["a"], ["b", "c"]]);
  assert.deepEqual(linkGoal(MELEE_GOALS, "ssi", true).ranks, MELEE_GOALS.ranks, "the first row has nothing above it");
  // ✕ removes a row (an emptied rank goes); a new goal goes last, once
  assert.deepEqual(removeGoal(MELEE_GOALS, "ssi").ranks, [["hci", "dci"], ["di"]]);
  assert.deepEqual(removeGoal(MELEE_GOALS, "hci").ranks, [["ssi"], ["dci"], ["di"]]);
  assert.deepEqual(addGoal(MELEE_GOALS, "luck").ranks, [["ssi"], ["hci", "dci"], ["di"], ["luck"]]);
  assert.equal(addGoal(MELEE_GOALS, "hci"), MELEE_GOALS);
  assert.deepEqual(MELEE_GOALS.ranks, [["ssi"], ["hci", "dci"], ["di"]], "no edit changes the goals it is given");
  // a weight set from "Check your settings" leaves goal mode, as a slider does
  const p = { weights: { luck: 1 }, goals: MELEE_GOALS };
  applyAction(p, { kind: "setWeight", property: "luck", value: 5 }, 1);
  assert.equal(p.goals.ownWeights, true);
});

test("[fast] builder model: how the goals went, the trades the build made and where spare points went (issue #292)", () => {
  const caps = { ssi: 60, hci: 45, dci: 45, di: 100 };
  const now = { ssi: 56, hci: 30, dci: 45, di: 100, luck: 200 }, suit = { ssi: 55, hci: 45, dci: 45, di: 110, luck: 320 };
  assert.deepEqual(goalOutcomes(MELEE_GOALS, suit, caps), [
    { key: "ssi", rank: 1, value: 55, cap: 60, maxed: false }, { key: "hci", rank: 2, value: 45, cap: 45, maxed: true },
    { key: "dci", rank: 2, value: 45, cap: 45, maxed: true }, { key: "di", rank: 3, value: 100, cap: 100, maxed: true }]);
  assert.equal(goalOutcomes(MELEE_GOALS, suit, caps, true)[0]!.maxed, true, "Swing speed is maxed by its swing, not its SSI");
  assert.equal(goalOutcomes(MELEE_GOALS, { ...suit, ssi: 60 }, caps, false)[0]!.maxed, false, "at the SSI cap with a swing short of its goal");
  assert.deepEqual(goalOutcomes({ ranks: [["luck"]], leftover: "none" }, suit, caps), [{ key: "luck", rank: 1, value: 320, cap: null, maxed: false }], "no cap: never maxed");
  // SSI went down while HCI, ranked below it, went up; DI's 110 is held at its cap of 100, so it did not move
  const trades = goalTrades(MELEE_GOALS, now, suit, caps);
  assert.deepEqual(trades, [{ key: "ssi", from: 56, to: 55, ups: [{ key: "hci", by: 15 }] }]);
  assert.equal(tradeText(trades[0]!, { from: 1.5, to: 1.5 }), "−1 swing speed (56 → 55, still a 1.5 s swing) for +15 hit chance");
  assert.equal(tradeText(trades[0]!, { from: 1.5, to: 1.75 }), "−1 swing speed (56 → 55, 1.5 s → 1.75 s swing) for +15 hit chance");
  assert.equal(tradeText({ key: "hci", from: 45, to: 40, ups: [{ key: "di", by: 10 }, { key: "luck", by: 50 }] }), "−5 hit chance (45 → 40) for +10 damage and +50 luck");
  // a lower goal down for a higher one up is no trade; nor a loss with no gain below it; linked goals share a rank
  assert.deepEqual(goalTrades(MELEE_GOALS, { ssi: 50, di: 100 }, { ssi: 55, di: 90 }, caps), []);
  assert.deepEqual(goalTrades(MELEE_GOALS, { hci: 45, dci: 30 }, { hci: 40, dci: 45 }, caps), [], "HCI and DCI share their rank");
  const many: Goals = { ranks: [["a"], ["b"], ["c"], ["d"], ["e"]], leftover: "none" };
  assert.equal(goalTrades(many, { a: 9, b: 9, c: 9, d: 9, e: 0 }, { a: 8, b: 8, c: 8, d: 8, e: 9 }, {}).length, 3, "at most three");
  // verdicts say only what is known: maxed, given up in a trade, or what came first
  const out = goalOutcomes(MELEE_GOALS, suit, caps);
  assert.deepEqual(out.map((o) => goalVerdict(o, trades)), ["went down to make room for hit chance", "maxed", "maxed", "maxed"]);
  assert.equal(goalVerdict({ key: "ssi", rank: 1, value: 40, cap: 60, maxed: false }, []), "not maxed: your requirements, or the pieces you have, came first");
  assert.equal(goalVerdict({ key: "di", rank: 3, value: 40, cap: 100, maxed: false }, []), "not maxed: higher goals or your requirements came first");
  // Swing speed in seconds from the suit's own swing, against a swing-time goal or its fastest step
  const every: Goals = { ...MELEE_GOALS, swing: { mode: "every", seconds: 1.5 } };
  const broad = { seconds: 1.25, weapon: "Double Bladed Staff" };
  assert.deepEqual(swingOutcome(MELEE_GOALS, { seconds: 1.75, ssi: 31 }, "Broadsword", true, broad), { text: "1.75 s with Broadsword (fastest it can reach)", ssi: "SSI 31", after: null, maxed: true, verdict: null });
  assert.deepEqual(swingOutcome(MELEE_GOALS, { seconds: 2.75, ssi: 0 }, "Broadsword", false, broad), { text: "2.75 s with Broadsword", ssi: "SSI 0", after: "1.25 s possible with Double Bladed Staff", maxed: false, verdict: null });
  assert.equal(swingOutcome(MELEE_GOALS, { seconds: 1.25, ssi: 0 }, "Broadsword", false, broad).after, null, "nothing faster to point at");
  assert.deepEqual(swingOutcome(every, { seconds: 1.5, ssi: 29 }, "War Axe", false, { seconds: 1.25, weapon: "War Axe" }), { text: "1.5 s with War Axe · goal met", ssi: "SSI 29", after: null, maxed: true, verdict: null });
  // issue #302: missed with another weapon than the goal's, the verdict says the goal does not apply (by speed when both are known)
  assert.deepEqual(swingOutcome(every, { seconds: 1.75, ssi: 31 }, "Longsword", false, { seconds: 1.25, weapon: "Katana" }), { text: "1.75 s with Longsword", ssi: "SSI 31", after: null, maxed: false, verdict: "the suit uses a Longsword, so the 1.5 s goal for your Katana does not apply" });
  assert.equal(swingOutcome(every, { seconds: 1.75, ssi: 31 }, "Executioner's Axe", false, { seconds: 1.25, weapon: "Katana" }).verdict, "the suit uses an Executioner's Axe, so the 1.5 s goal for your Katana does not apply");
  assert.equal(swingOutcome(every, { seconds: 1.75, ssi: 31, speed: 3.25 }, "Radiant Scimitar", false, { seconds: 1.25, weapon: "Scimitar", speed: 3.25 }).verdict, null, "the same speed: the goal applies");
  assert.equal(swingOutcome(every, { seconds: 1.75, ssi: 31, speed: 3.25 }, "Katana", false, { seconds: 1.25, weapon: "Katana", speed: 2.5 }).verdict?.startsWith("the suit uses a Katana"), true, "another speed under the same name");
  assert.equal(swingOutcome(every, { seconds: 1.5, ssi: 29 }, "Longsword", false, { seconds: 1.25, weapon: "Katana" }).verdict, null, "met with another weapon: met");
  assert.equal(swingOutcome(every, { seconds: 1.75, ssi: 31 }, "War Axe", false, { seconds: 1.25, weapon: "War Axe" }).text, "1.75 s with War Axe · goal was every 1.5 s");
  // Where spare points went: risers only, else none left over (stayed, or what the goals cost); nothing for Nothing
  assert.equal(spareLine(MELEE_GOALS, { luck: 60 }, { luck: 180 }), "Spare points went to: Luck +120 (60 → 180)");
  assert.equal(spareLine(MELEE_GOALS, { luck: 96 }, { luck: 96 }), "Spare points: none left over (Luck stays 96)");
  assert.equal(spareLine(MELEE_GOALS, { luck: 126 }, { luck: 96 }), "Spare points: none left over. The goals cost some Luck (126 → 96)");
  assert.equal(spareLine({ ...MELEE_GOALS, leftover: "none" }, now, suit), null);
  assert.equal(spareLine({ ranks: [["luck"]], leftover: "luck" }, now, suit), null, "every member a goal");
  assert.equal(spareLine({ ranks: [["dexBonus"]], leftover: "melee" }, { strBonus: 5 }, { strBonus: 3, stamInc: 8, hpRegen: 2 }), "Spare points went to: Stamina bonus +8, Hit point regeneration +2");
  assert.equal(spareLine({ ranks: [["dexBonus"]], leftover: "melee" }, { strBonus: 5 }, { strBonus: 3 }), `Spare points: none left over. The goals cost some ${goalName("strBonus")} (5 → 3)`);
});

// Issue #302: the first-visit view's "What matters most" with goals: one row per rank by the goals' names, the spare points on their own line.
test("[fast] builder model: the first-visit summary lists the goals by rank and where spare points go (issue #302)", () => {
  assert.deepEqual(goalSummary(MELEE_GOALS), { rows: [{ rank: 1, names: "Swing speed", counts: 100 }, { rank: 2, names: "Hit chance = Defense chance", counts: 80 }, { rank: 3, names: "Damage", counts: 65 }], more: 0, spare: "Spare points: Luck" });
  assert.equal(goalSummary({ ...MELEE_GOALS, swing: { mode: "every", seconds: 1.5 } }).rows[0]!.names, "Swing speed every 1.5 s");
  const six: Goals = { ranks: [["a"], ["b"], ["c"], ["d"], ["e"], ["f"]], leftover: "caster" };
  assert.deepEqual([goalSummary(six).rows.length, goalSummary(six).more, goalSummary(six).spare], [4, 2, "Spare points: Caster stats"]);
  assert.equal(goalSummary({ ranks: [], leftover: "none" }).spare, "Spare points: Nothing");
});
