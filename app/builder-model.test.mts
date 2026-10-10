// builder-model.test.mts — `app/ui/builder-model.mts`, the Suit Builder's pure logic.
//
// `app/ui/builder-model.mts`, the Suit Builder's pure logic: No character's name in words (issue #12), the one-line summaries collapsed panel sections show (weights heaviest first with equal resists folded into "each resist", requirements with soft ones marked, the candidate pool, the Advanced knobs), the Advanced fields' validation messages with the allowed range ("Enter a whole number from 1 to 10,000.") and that the page's limits equal the server's `OPTS_LIMITS`, which field a server refusal names, a resist tile's outcome line (short, meets, at cap, over cap), the result's other-changes badges (gains first, missed requirements as losses), "after the change" values and pool estimates, the compare table's differing piece cells, best totals (past the cap counts as the cap) and hidden-rows note, the three-run compare limit, and a saved run's automatic label and badges, and the Weapons chip and summary wording, and a weight row's worth hint (issue #217). All `[fast]`. The rarity preference (issue #262) in words: the pool summary, the help line, the settings change, the rarity total and the Rarity row.
//
// Lives in app/ for the reason app/ui-render.test.mts gives.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { NOBODY, setRules, resistCapsFor, playerCaps, settingsDiff } from "./vault-lib.mts";
import { buffSkillValues, runBuffs } from "./buffs.mts";
import type { RulesV1 } from "./schema/types.d.mts";
import {
  propName, weightsSummary, requirementsSummary, poolSummary, withStoredRoots, advancedSummary, knobError, firstKnobError, knobFromServerError, ruleValueError,
  resistOutcome, locationCrumbs, otherChanges, afterChange, compareModel, hiddenRowsNote, toggleCompare, runAutoLabel, runBadges, plural, KNOB_RANGES,
  resistCapError, withResistCap, capNote, resistCapsSummary, resistMinimumText, capsLine, anyOverridden, effectiveFloor, floorCapWarning, pruneResistCaps,
  weaponsSummary, weaponsChipText, weaponMustHaveChipText, toggleWeapon, weaponName, withBuffs, pastCapBadges, runSettingsDiff, weightWorth, templateBuffsLine, sourceTitle, who, rarityHelp, rarityTotal, rarityDetail,
  type Knobs,
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
  assert.equal(poolSummary({ allowOthersWorn: true, allowGargoyle: true, medOnly: true, excludeWeapons: ["swordsmanship", "fencing", "mace fighting", "throwing"], lockedSlots: ["ring"], excludeTags: ["cursed"], excludeSkills: ["necromancy", "spirit speak"], excludeRoots: [1, 2] }),
    "Includes gear worn by others · gargoyle-only allowed · meditation-safe only · archery weapons only · 1 slot locked · no cursed · 2 skill bonuses forbidden · 2 containers skipped");
  assert.deepEqual(withStoredRoots([{ value: "10", label: "Chest" }], [10, 0x4000abcd]), [{ value: "10", label: "Chest" }, { value: String(0x4000abcd), label: "Unknown container 0x4000ABCD (not in the scans)" }], "a listed serial that is no longer a root can still be unchecked");
  assert.deepEqual(withStoredRoots([{ value: "10", label: "Chest" }]), [{ value: "10", label: "Chest" }]);
  assert.equal(poolSummary({ onlyRoots: [1, 2], excludeRoots: [3] }), "Own gear and unworn gear · no gargoyle-only · any weapon · 2 containers only · 1 container skipped");
});

test("[fast] builder model: the Weapons chip and summary say the exclusions in words", () => {
  assert.equal(weaponsChipText([]), "Weapons: any");
  assert.equal(weaponsChipText(["archery", "throwing"]), "Weapons: 2 excluded");
  assert.equal(weaponsChipText(["archery", "swordsmanship", "mace fighting", "throwing"]), "Weapons: Fencing only");
  assert.equal(weaponsChipText(["archery", "swordsmanship", "fencing", "mace fighting", "throwing"]), "Weapons: none");
  assert.equal(weaponsSummary(), "any weapon");
  assert.equal(weaponsSummary(["throwing", "archery", "swordsmanship"]), "no archery, swordsmanship or throwing weapons", "in the skills' own order");
  assert.equal(weaponsSummary(["archery", "swordsmanship", "fencing", "throwing"]), "mace fighting weapons only");
  // Use Best Weapon Skill is named only when some melee skill is excluded and some is still allowed.
  assert.equal(weaponsChipText(["archery", "fencing", "mace fighting", "throwing"], true), "Weapons: Swordsmanship only, plus Use Best Weapon Skill");
  assert.equal(weaponsChipText(["archery", "throwing"], true), "Weapons: 2 excluded", "every melee skill allowed: UBWS weapons pass anyway");
  assert.equal(weaponsChipText(["fencing", "mace fighting"], true), "Weapons: 2 excluded, plus Use Best Weapon Skill");
  assert.equal(weaponsChipText([], true), "Weapons: any");
  assert.equal(weaponsChipText(["swordsmanship", "fencing", "mace fighting"], true), "Weapons: 3 excluded", "no melee skill left to swing with");
  assert.equal(weaponsChipText(["archery", "fencing", "mace fighting", "throwing"], false), "Weapons: Swordsmanship only");
  assert.equal(weaponsSummary(["archery", "fencing", "mace fighting", "throwing"], true), "swordsmanship weapons only, plus Use Best Weapon Skill");
  assert.equal(poolSummary({ excludeWeapons: ["archery", "fencing", "mace fighting", "throwing"] }), "Own gear and unworn gear · no gargoyle-only · swordsmanship weapons only, plus Use Best Weapon Skill", "absent means on");
  assert.equal(poolSummary({ excludeWeapons: ["archery", "fencing", "mace fighting", "throwing"], ubwsAnyWeapon: false }), "Own gear and unworn gear · no gargoyle-only · swordsmanship weapons only");
  assert.deepEqual(toggleWeapon(["throwing"], "archery", true), ["archery", "throwing"], "kept in the skills' order");
  assert.deepEqual(toggleWeapon(["archery", "throwing"], "archery", false), ["throwing"]);
  // Issue #259: Spellbooks add ", no spellbooks" to the chip and summary, last in the list.
  assert.equal(weaponsChipText(["spellbook"]), "Weapons: any, no spellbooks");
  assert.equal(weaponsChipText(["archery", "throwing", "spellbook"]), "Weapons: 2 excluded, no spellbooks");
  assert.equal(weaponsChipText(["archery", "swordsmanship", "mace fighting", "throwing", "spellbook"]), "Weapons: Fencing only, no spellbooks");
  assert.equal(weaponsChipText(["archery", "swordsmanship", "fencing", "mace fighting", "throwing", "spellbook"]), "Weapons: none, no spellbooks");
  assert.equal(weaponsChipText(["fencing", "mace fighting", "spellbook"], true), "Weapons: 2 excluded, plus Use Best Weapon Skill, no spellbooks");
  assert.equal(weaponsSummary(["spellbook"]), "any weapon, no spellbooks");
  assert.equal(weaponsSummary(["archery", "throwing", "spellbook"]), "no archery or throwing weapons, no spellbooks");
  assert.deepEqual(toggleWeapon(["throwing"], "spellbook", true), ["throwing", "spellbook"]);
  assert.deepEqual(toggleWeapon(["spellbook"], "archery", true), ["archery", "spellbook"], "spellbooks last");
  assert.equal(weaponName("spellbook"), "Spellbooks");
});

test("[fast] builder model: the Weapon must have chip and the pool summary name the required properties", () => {
  assert.equal(weaponMustHaveChipText(), "Weapon must have");
  assert.equal(weaponMustHaveChipText(["spell channeling"]), "Weapon must have: Spell Channeling");
  assert.equal(weaponMustHaveChipText(["spell channeling", "balanced"]), "Weapon must have: Spell Channeling, Balanced");
  assert.equal(poolSummary({ weaponMustHave: ["balanced"] }), "Own gear and unworn gear · no gargoyle-only · any weapon · weapon must have Balanced");
  assert.equal(poolSummary({ weaponMustHave: [] }), "Own gear and unworn gear · no gargoyle-only · any weapon");
});

const knobs = (over: Partial<Knobs> = {}): Knobs => ({ strLimit: "110", restarts: "10000", exact: true, budgetS: "300", altCount: "5", altTol: "40", ...over });
test("[fast] builder model: the Advanced summary names the search, its restarts, budget and other suits", () => {
  assert.equal(advancedSummary(knobs()), "Exact · 10,000 restarts · 300 s · 5 other suits within 40", "STR limit has its own field, not under Advanced");
  assert.equal(advancedSummary(knobs({ exact: false, restarts: "1", strLimit: "" })), "Heuristic · 1 restart");
  assert.equal(advancedSummary(knobs({ altCount: "0" })), "Exact · 10,000 restarts · 300 s");
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
  assert.deepEqual(pastCapBadges(r), ["DI +68 past the cap (Enemy of One)"]);
  const none = withBuffs({ ssi: 45 }, 70, caps, null);
  assert.deepEqual([none.totals.ssi, none.totals.fireResist, none.lifted.length, pastCapBadges(none)], [45, 20, 5, []], "without buffs: the paperdoll totals alone, every resist held at the minimum");
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

test("[fast] resist caps: notes, the collapsed summary, the Requirements note, the compare line", () => {
  assert.equal(capNote({ cap: 95, shard: 70 }), "raised from 70");
  assert.equal(capNote({ cap: 50, shard: 70 }), "lowered from 70");
  assert.equal(capNote({ cap: 70, shard: 70 }), null);
  const human = resistCapsFor("human", {}), elf = resistCapsFor("elf", {});
  assert.equal(resistCapsSummary(human), "Shard caps: 70 each");
  assert.equal(resistCapsSummary(elf), "Shard caps: 70, Energy 75");
  assert.equal(resistCapsSummary(resistCapsFor("human", { fireResist: 95 })), "Fire 95 (raised from 70) · the rest at the shard's cap");
  assert.equal(resistCapsSummary(resistCapsFor("human", { fireResist: 95, coldResist: 60, physResist: 80, poisonResist: 90 })),
    "Phys 80 (raised from 70) · Fire 95 (raised from 70) · Cold 60 (lowered from 70) · Poison 90 (raised from 70) · the other one at the shard's cap");
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

test("[fast] builder model: a weight row's worth hint names what the weight makes a typical range worth", () => {
  // A melee main's caps: resist caps of 70 on the paperdoll
  const caps = playerCaps({ caps: { physResist: 70, dci: 45, hpRegen: 18 } });
  assert.equal(weightWorth("luck", 3, caps), "= 1,500 per 500 Luck");
  assert.equal(weightWorth("dci", 10, caps), "= 450 per 45 DCI");
  assert.equal(weightWorth("physResist", 6, caps), "= 420 per 70 Phys");
  assert.equal(weightWorth("luck", 0.8, caps), "= 400 per 500 Luck");
  assert.equal(weightWorth("stamPool", 2, caps), "= 90 per 45 Stam pool");
  assert.equal(weightWorth("sk:magery", 2, caps), "= 30 per 15 +Magery");
  assert.equal(weightWorth("castingFocus", 2, caps), null, "no typical range");
  assert.equal(weightWorth("luck", Number.NaN, caps), null, "no number, no hint");
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

// Issue #262: the rarity preference in words: the pool summary, the help line, a template's or run's change, and the
// result's Rarity row with the rarity total (higher means rarer, whichever way the preference points).
test("[fast] rarity preference: summary, help line, settings change, rarity total and the Rarity row", () => {
  assert.equal(poolSummary({ rarity: "lower" }), "Own gear and unworn gear · no gargoyle-only · any weapon · prefer lower rarity");
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
