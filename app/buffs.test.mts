// buffs.test.mts — `app/buffs.mts`, the Suit Builder's buffs, abilities and forms (issue #12).
//
// `[fast]`: `app/buffs.mts`, the Suit Builder's buffs, abilities and forms (issue #12): each shipped effect's formula against the research's numbers, skill scaling at 0, the threshold and 120, one form at a time, the stat slots where the largest share counts, a cap raise, a bonus past the cap that never counts toward it, Protection's lower Resisting Spells, the words the picker shows, and the saved choices' checks.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { effectiveProfile, profileResistCaps, setRules } from "./vault-lib.mts";
import type { Character, Item, Profile, PropMap } from "./vault-lib.mts";
import type { RulesV1 } from "./schema/types.d.mts";
import { BUFFS, BUFF_IDS, BUFF_GROUPS, BUFF_INPUTS, applyBuffs, buffById, buffShift, buffSkillValues, buffText, buffsDiff, gearNeedsText, isBuffList, isBuffListsByCharacter, isBuffSkills, isBuffSkillsByCharacter, isRunBuffs, manualProfile, normalizeBuffListsByCharacter, normalizeBuffs, ownEntry, plannedFromWorn, plannedProfile, runBuffs, savedBuffs, toggleBuff } from "./buffs.mts";
import type { BuffPlan, Skills, Stats } from "./buffs.mts";

setRules(JSON.parse(readFileSync(new URL("./rules/uoalive.json", import.meta.url), "utf8")) as RulesV1);
const CAPS = (JSON.parse(readFileSync(new URL("./rules/uoalive.json", import.meta.url), "utf8")) as { caps: Record<string, number> }).caps;

// What one buff adds on its own to an empty suit, in-cap and past the cap, and its cap changes.
function alone(id: string, skills: Skills = {}, stats: Stats | null = null, totals: PropMap = {}): { add: PropMap; outside: PropMap; caps: PropMap } {
  const r = applyBuffs(totals, CAPS, [id], skills, stats);
  const add = Object.fromEntries(Object.entries(r.totals).filter(([k, v]) => v !== (totals[k] || 0)).map(([k, v]) => [k, v - (totals[k] || 0)]));
  const caps = Object.fromEntries(Object.entries(r.caps).filter(([k, v]) => v !== CAPS[k]).map(([k, v]) => [k, v - (CAPS[k] ?? 0)]));
  return { add, outside: r.outside, caps };
}

test("[fast] buffs: the catalog's ids are unique, each entry sits in a known group and scales with known inputs", () => {
  assert.equal(new Set(BUFF_IDS).size, BUFF_IDS.length);
  const groups = new Set(BUFF_GROUPS.map((g) => g.name));
  for (const b of BUFFS) {
    assert.ok(groups.has(b.group), `${b.id}'s group`);
    for (const i of [...b.inputs, ...(b.min ? [b.min[0]] : [])]) assert.ok(BUFF_INPUTS[i], `${b.id}'s input ${i}`);
    for (const i of b.inputs) assert.ok(BUFF_GROUPS.find((g) => g.name === b.group)!.inputs.includes(i), `${b.id}'s input ${i} is a field of its group`);
  }
});

test("[fast] buffs: Chivalry: Divine Fury's flat and top tiers, Consecrate Weapon and Enemy of One past the DI cap", () => {
  const flat = { hci: 10, di: 10, ssi: 10, dci: -20 };
  assert.deepEqual(alone("divineFury", { Chivalry: 105, Karma: 15000 }).add, flat, "below 120 Chivalry: the flat tier");
  assert.deepEqual(alone("divineFury", { Chivalry: 120, Karma: 9999 }).add, flat, "120 but under 10,000 karma: still flat");
  assert.deepEqual(alone("divineFury", { Chivalry: 120, Karma: 10000 }).add, { hci: 15, di: 20, ssi: 15, dci: -10 }, "the top tier");
  // Consecrate Weapon: (Chivalry − 90) / 2, nothing below 90: the wiki's 5 / 10 / 15 at 100 / 110 / 120
  for (const [chiv, di] of [[0, 0], [89.9, 0], [90, 0], [100, 5], [105, 7], [110, 10], [120, 15]] as const) {
    const r = alone("consecrateWeapon", { Chivalry: chiv });
    assert.deepEqual(r.add, {}, "never inside the cap");
    assert.equal(r.outside.di || 0, di, `Consecrate at ${chiv}`);
  }
  // Enemy of One: 10 + (Chivalry − 40) × 9 / 10, 82 at 120 (the wiki's cap)
  assert.equal(alone("enemyOfOne", { Chivalry: 120 }).outside.di, 82);
  assert.equal(alone("enemyOfOne", { Chivalry: 105 }).outside.di, 68);
  assert.equal(alone("enemyOfOne", { Chivalry: 40 }).outside.di, 10);
});

test("[fast] buffs: the Necromancy forms' resists, regeneration and DI, Horrific Beast's HPR past its cap", () => {
  assert.deepEqual(alone("wraithForm").add, { physResist: 15, fireResist: -5, energyResist: -5 });
  assert.match(buffText("wraithForm", { "Spirit Speak": 120 }, null, {}), /24% mana leech/);
  assert.match(buffText("wraithForm", { "Spirit Speak": 50 }, null, {}), /10% mana leech/);
  assert.deepEqual(alone("lichForm").add, { fireResist: -10, coldResist: 10, poisonResist: 10, manaRegen: 13 }, "its HP drain is no HPR");
  assert.match(buffText("lichForm", {}, null, {}), /drains 1 HP every 2 s/);
  assert.deepEqual(alone("vampiricEmbrace").add, { fireResist: -25, stamRegen: 15, manaRegen: 3 });
  const hb = alone("horrificBeast");
  assert.deepEqual(hb.add, { di: 25 });
  assert.deepEqual(hb.outside, { hpRegen: 20 });
});

test("[fast] buffs: Reaper Form counts the wiki's SSI 5, and each Arcane Focus level adds 1", () => {
  assert.deepEqual(alone("reaperForm").add, { ssi: 5, sdi: 10, physResist: 5, coldResist: 5, poisonResist: 5, energyResist: 5, fireResist: -25 });
  assert.deepEqual(alone("reaperForm", { "Arcane Focus": 6 }).add, { ssi: 11, sdi: 16, physResist: 11, coldResist: 11, poisonResist: 11, energyResist: 11, fireResist: -25 });
});

test("[fast] buffs: Magery: Bless takes 1 + Eval / 10 percent of the raw stats, Protection and Reactive Armor by Inscription", () => {
  const fury = { str: 125, dex: 80, int: 35 };
  assert.deepEqual(alone("bless", { "Evaluating Intelligence": 120 }, fury).add, { strBonus: 17, dexBonus: 11, intBonus: 5 }, "13% at 120, rounded up");
  assert.deepEqual(alone("bless", { "Evaluating Intelligence": 100 }, fury).add, { strBonus: 14, dexBonus: 9, intBonus: 4 }, "11% at 100");
  assert.deepEqual(alone("bless", { "Evaluating Intelligence": 0 }, fury).add, { strBonus: 2, dexBonus: 1, intBonus: 1 }, "1% at 0");
  assert.deepEqual(alone("strength", { "Evaluating Intelligence": 120 }, fury).add, { strBonus: 17 });
  assert.deepEqual(alone("cunning", { "Evaluating Intelligence": 120 }, fury).add, { intBonus: 5 });
  // no character: no raw stats, so the share is a percent and adds nothing
  const free = applyBuffs({}, CAPS, ["bless"], {}, null);
  assert.deepEqual(free.shares.strBonus, [{ id: "bless", value: 0, pct: 13 }]);
  assert.equal(buffText("bless", {}, null, {}), "STR, DEX, INT +13% of base");
  // Reactive Armor: Phys 15 + Inscription / 20, the others −5
  assert.deepEqual(alone("reactiveArmor", { Inscription: 0 }).add, { physResist: 15, fireResist: -5, coldResist: -5, poisonResist: -5, energyResist: -5 });
  assert.equal(alone("reactiveArmor", { Inscription: 100 }).add.physResist, 20);
  // Protection with no character's Resisting Spells: Phys −15 + Inscription / 20 and FC −2 after the cap
  assert.deepEqual(alone("protection", { Inscription: 0 }).add, { physResist: -15 });
  assert.deepEqual(alone("protection", { Inscription: 100 }).add, { physResist: -10 });
  assert.equal(buffText("protection", { Inscription: 0 }, null, {}), "Phys −15 · FC −2 after the cap · Resisting Spells −35");
});

test("[fast] buffs: Magic Reflection by the shard wiki: Phys −(20 − Inscription / 20) and its cap −5, the others +10", () => {
  for (const [insc, phys] of [[0, -20], [60, -17], [120, -14]] as const) {
    const r = alone("magicReflection", { Inscription: insc });
    assert.deepEqual(r.add, { physResist: phys, fireResist: 10, coldResist: 10, poisonResist: 10, energyResist: 10 }, `Inscription ${insc}`);
    assert.deepEqual(r.caps, { physResist: -5 }, `Inscription ${insc}: the Phys cap 5 lower`);
  }
  // its own toggle: it stacks with Reactive Armor and Protection
  const all = applyBuffs({}, CAPS, ["reactiveArmor", "protection", "magicReflection"], { Inscription: 0 }, null);
  assert.equal(all.totals.physResist, 15 - 15 - 20);
  assert.equal(all.caps.physResist, 65);
  assert.equal(buffText("magicReflection", { Inscription: 0 }, null, {}), "Phys −20 · Fire, Cold, Poison, Energy +10 · Phys cap −5");
});

test("[fast] buffs: Protection lowers Resisting Spells, and so the free resists it gives on UO Alive", () => {
  // Resisting Spells 100 gives +40; 35 less (Inscription 0) is 65, +26: every resist 14 lower, Phys 15 more on top
  const r = applyBuffs({ physResist: 70, fireResist: 70 }, CAPS, ["protection"], { Inscription: 0, "Resisting Spells": 100 }, null);
  assert.equal(r.totals.fireResist, 56);
  assert.equal(r.totals.physResist, 70 - 15 - 14);
  assert.equal(r.totals.coldResist, -14);
  // Inscription 100 takes 5 off the loss: Resisting Spells 70, +28
  assert.equal(applyBuffs({ fireResist: 70 }, CAPS, ["protection"], { Inscription: 100, "Resisting Spells": 100 }, null).totals.fireResist, 58);
  // FC −2 after the cap: a mage at the FC 2 cap casts at FC 0, and FC 3 is still 0 (min(cap − 2, fc − 2))
  for (const fc of [2, 3]) {
    const p = applyBuffs({ fc }, CAPS, ["protection"], {}, null);
    assert.equal(p.totals.fc, fc, "the in-cap FC is untouched");
    assert.equal(p.effective.fc, 0);
  }
});

test("[fast] buffs: Mysticism: Stone Form's resists and resist caps by (Mysticism + Focus or Imbuing), and Enchant", () => {
  const top = alone("stoneForm", { Mysticism: 120, "Focus or Imbuing": 120 });
  assert.deepEqual(top.add, { physResist: 10, fireResist: 10, coldResist: 10, poisonResist: 10, energyResist: 10, ssi: -10, fc: -2 });
  assert.deepEqual(top.caps, { physResist: 5, fireResist: 5, coldResist: 5, poisonResist: 5, energyResist: 5 });
  const low = alone("stoneForm", { Mysticism: 33, "Focus or Imbuing": 0 });
  assert.equal(low.add.physResist, 2, "at least 2");
  assert.equal(low.caps.physResist, 2);
  assert.deepEqual(alone("stoneForm", { Mysticism: 32.9 }).add, {}, "below the skill it takes, nothing");
  assert.deepEqual(alone("enchant.hitLightning", { Mysticism: 120, "Focus or Imbuing": 120 }).add, { hitLightning: 60, fc: -1 });
  assert.deepEqual(alone("enchant.hitFireball", { Mysticism: 70, "Focus or Imbuing": 50 }).add, { hitFireball: 30 }, "under 80 and 80: no Spell Channeling");
  const sc = applyBuffs({}, CAPS, ["enchant.hitLightning"], { Mysticism: 120, "Focus or Imbuing": 120 }, null, { weaponFlags: ["spell channeling"] });
  assert.deepEqual([sc.totals.hitLightning, sc.totals.fc], [60, undefined], "a weapon with Spell Channeling keeps its own: no second FC −1");
});

test("[fast] buffs: Ninjitsu's forms, White Tiger's DCI cap raise, and Honorable Execution by Bushido", () => {
  assert.deepEqual(alone("wolfKitsune").add, { hci: 20, hitsPool: 20 });
  assert.deepEqual(alone("wolfKitsune", { Ninjitsu: 84.9 }).add, {}, "the wiki's 85");
  assert.deepEqual(alone("kirin").add, { stamRegen: 20 });
  const wt = applyBuffs({ dci: 47 }, CAPS, ["whiteTiger"], {}, null);
  assert.equal(wt.caps.dci, 50, "the cap goes up first");
  assert.equal(wt.totals.dci, 67);
  assert.equal(wt.effective.dci, 50, "then the total is clamped at the raised cap");
  assert.deepEqual(wt.capShares.dci, [{ id: "whiteTiger", value: 5 }]);
  for (const [bushido, ssi] of [[0, 1], [60, 5], [120, 20]] as const) assert.equal(alone("honorableExecution", { Bushido: bushido }).add.ssi, ssi, `Bushido ${bushido}`);
});

test("[fast] buffs: the bard songs at 120 in every bard skill, and at the 90 they need", () => {
  const all = { Musicianship: 120, Provocation: 120, Peacemaking: 120, Discordance: 120 };
  assert.deepEqual(alone("inspire", all).add, { hci: 22, sdi: 22, di: 58 });
  assert.deepEqual(alone("invigorate", all).add, { strBonus: 14, dexBonus: 14, intBonus: 14, hitsPool: 26 });
  assert.deepEqual(alone("resilience", all).add, { hpRegen: 22, stamRegen: 22, manaRegen: 22 });
  assert.deepEqual(alone("perseverance", all).add, { dci: 30, castingFocus: 6 });
  // a Provocation and Musicianship bard: no collective bonus once the other two read 0
  assert.deepEqual(alone("inspire", { Musicianship: 120, Provocation: 120, Peacemaking: 0, Discordance: 0 }).add, { hci: 16, sdi: 16, di: 40 });
  // lacking them, they count at 120 and the song is planned: every bard skill is one of its inputs
  const bard = buffSkillValues({ Provocation: { value: 120 }, Musicianship: { value: 120 } }, {});
  assert.ok(bard.planned.has("Peacemaking") && bard.planned.has("Discordance") && !bard.planned.has("Provocation"));
  for (const id of ["inspire", "invigorate", "resilience", "perseverance"]) assert.ok(buffById(id)!.inputs.some((i) => bard.planned.has(i)), `${id} is planned`);
  const low = { Musicianship: 90, Provocation: 90, Peacemaking: 0, Discordance: 0 };
  assert.deepEqual(alone("inspire", low).add, { hci: 4, sdi: 4, di: 10 }, "base 2, no collective bonus");
  assert.deepEqual(alone("inspire", { ...low, Provocation: 89 }).add, {}, "below 90 the song can't be sung");
});

test("[fast] buffs: the other masteries by skill and mastery level", () => {
  assert.equal(alone("focusedEye", { Swordsmanship: 120, Tactics: 120, "Mastery level": 3 }).add.hci, 30);
  assert.equal(alone("focusedEye", { Swordsmanship: 0, Tactics: 0, "Mastery level": 1 }).add.hci, 3);
  assert.equal(alone("toughness", { "Mace Fighting": 120, Tactics: 120, "Mastery level": 3 }).add.hitsPool, 30);
  assert.equal(alone("intuition", { "Mastery level": 3 }).add.manaPool, 15);
  assert.deepEqual(alone("savingThrow", { "Mastery level": 3 }).add, { hci: 5, dci: 5, strBonus: 5, di: 5 });
  assert.deepEqual(alone("savingThrow", { "Mastery level": 1 }).add, { hci: 5, strBonus: 5 }, "STR +5 at every level");
});

test("[fast] buffs: potions scale with the shard wiki's Enhance Potions (the suit's, at most 50, + Alchemy / 3.3, or Alchemy / 2); the Human's +2 HPR", () => {
  assert.equal(alone("strengthPotion", { Alchemy: 120 }).add.strBonus, 16, "Alchemy / 2: EP 60");
  assert.equal(alone("greaterStrengthPotion", { Alchemy: 120 }).add.strBonus, 32);
  assert.equal(alone("greaterAgilityPotion", { Alchemy: 0 }).add.dexBonus, 20);
  assert.equal(alone("greaterStrengthPotion", { Alchemy: 120 }, null, { enhancePotions: 60 }).add.strBonus, 37, "EP 50 + 36.4");
  assert.deepEqual(alone("human").add, { hpRegen: 2 }, "with no character, any race's is open");
  assert.deepEqual(applyBuffs({}, CAPS, ["human"], {}, null, { race: "human" }).totals, { hpRegen: 2 });
  const elf = applyBuffs({}, CAPS, ["human"], {}, null, { race: "elf" });
  assert.deepEqual([elf.totals, elf.blocked], [{}, ["human"]], "an Elf has no Human passive");
});

test("[fast] buffs: one form at a time, a turned-on form names the one it replaced", () => {
  let t = toggleBuff([], "wraithForm");
  assert.deepEqual(t, { next: ["wraithForm"], replaced: null });
  t = toggleBuff(["divineFury", "wraithForm"], "whiteTiger");
  assert.deepEqual(t, { next: ["divineFury", "whiteTiger"], replaced: "wraithForm" }, "across schools, and Divine Fury stays");
  assert.deepEqual(toggleBuff(["whiteTiger"], "whiteTiger"), { next: [], replaced: null }, "toggling it again turns it off");
  assert.deepEqual(toggleBuff(["enchant.hitLightning"], "enchant.hitHarm").replaced, "enchant.hitLightning");
  assert.deepEqual(toggleBuff(["bless"], "divineFury").next, ["divineFury", "bless"], "kept in catalog order");
});

test("[fast] buffs: a stat slot counts its largest share, so Greater Strength beats Bless on STR while Bless keeps DEX and INT", () => {
  const r = applyBuffs({ strBonus: 13 }, CAPS, ["bless", "greaterStrengthPotion"], { "Evaluating Intelligence": 120, Alchemy: 120 }, { str: 125, dex: 80, int: 35 });
  assert.equal(r.totals.strBonus, 13 + 32);
  assert.equal(r.totals.dexBonus, 11);
  assert.equal(r.totals.intBonus, 5);
  assert.deepEqual(r.beaten, [{ id: "bless", key: "strBonus", by: "greaterStrengthPotion" }]);
  // with no character Bless is a percent: which of it and a flat potion is larger depends on the base STR, so the
  // potion counts and neither is beaten
  const free = applyBuffs({}, CAPS, ["bless", "greaterStrengthPotion"], { Alchemy: 120 }, null);
  assert.equal(free.totals.strBonus, 32);
  assert.deepEqual(free.beaten, []);
  assert.deepEqual(free.unsure, [{ id: "bless", key: "strBonus", with: "greaterStrengthPotion" }]);
  // Invigorate has its own slot and stacks
  const inv = applyBuffs({}, CAPS, ["bless", "invigorate"], { "Evaluating Intelligence": 120, Musicianship: 120, Provocation: 120, Peacemaking: 120, Discordance: 120 }, { str: 125, dex: 80, int: 35 });
  assert.equal(inv.totals.strBonus, 17 + 14);
});

test("[fast] buffs: a bonus past the cap is never folded into the capped total", () => {
  const r = applyBuffs({ di: 100 }, CAPS, ["divineFury", "enemyOfOne", "consecrateWeapon"], { Chivalry: 120, Karma: 15000 }, null);
  assert.equal(r.totals.di, 120, "the in-cap sum, Divine Fury's 20 wasted");
  assert.equal(r.caps.di, 100, "the cap is the cap");
  assert.equal(r.outside.di, 82 + 15);
  assert.equal(r.effective.di, 100 + 97, "clamped first, then the outside shares");
  assert.deepEqual(r.shares.di!.map((s) => [s.id, s.value, !!s.outside]), [["divineFury", 20, false], ["consecrateWeapon", 15, true], ["enemyOfOne", 82, true]]);
});

test("[fast] buffs: a buff below the skill it needs is on but counts for nothing", () => {
  const r = applyBuffs({}, CAPS, ["lichForm"], { Necromancy: 50 }, null);
  assert.deepEqual(r.blocked, ["lichForm"]);
  assert.deepEqual(r.shares, {});
});

test("[fast] buffs: the inputs take an edit, else the character's skill, else 120; a missing skill or an edit is planned", () => {
  const fury = { Chivalry: { value: 105, cap: 120 }, Focus: { value: 10, cap: 100 }, Imbuing: { value: 40, cap: 100 }, "Resisting Spells": { value: 52.3, cap: 120 } };
  const { values, planned } = buffSkillValues(fury, { Bushido: 90 });
  assert.equal(values.Chivalry, 105);
  assert.equal(values["Focus or Imbuing"], 40, "the higher of the two");
  assert.equal(values.Necromancy, 120, "lacking it: 120");
  assert.equal(values.Bushido, 90, "the edit");
  assert.equal(values.Karma, 15000, "no scan carries karma: its default");
  assert.equal(values["Resisting Spells"], 52.3, "the character's own, for Protection");
  assert.ok(planned.has("Necromancy") && planned.has("Bushido"));
  assert.ok(!planned.has("Chivalry") && !planned.has("Karma"));
  const none = buffSkillValues(null, {});
  assert.equal(none.values.Chivalry, 120);
  assert.equal(none.planned.size, 0, "no character: the defaults are no plan");
  assert.equal(none.values["Resisting Spells"], undefined);
});

test("[fast] buffs: the picker's words for an entry", () => {
  assert.equal(buffText("divineFury", { Chivalry: 105 }, null, {}), "HCI +10 · DI +10 · SSI +10 · DCI −20");
  assert.equal(buffText("consecrateWeapon", { Chivalry: 105 }, null, {}), "DI +7 past the cap · hits the lowest resist");
  assert.equal(buffText("reaperForm", {}, null, {}), "SSI +5 · SDI +10 · Phys, Cold, Poison, Energy +5 · Fire −25");
  assert.equal(buffText("stoneForm", { Mysticism: 120, "Focus or Imbuing": 120 }, null, {}), "All resists +10 · SSI −10 · FC −2 · DI +5 past the cap · Resist caps +5");
  assert.equal(buffText("whiteTiger", {}, null, {}), "DCI +20 · DCI cap +5");
  assert.equal(buffText("wolfKitsune", {}, null, {}), "HCI +20 · Hits +20");
  assert.equal(buffText("savingThrow", { "Mastery level": 1 }, null, {}), "HCI +5 · STR +5");
});

test("[fast] buffs: the saved choices' checks", () => {
  assert.ok(isBuffList([]) && isBuffList(["divineFury", "bless"]));
  for (const bad of [null, "divineFury", ["nope"], ["bless", "bless"], [5], {}]) assert.equal(isBuffList(bad), false, JSON.stringify(bad));
  assert.ok(isBuffSkills({}) && isBuffSkills({ Chivalry: 105.5, Karma: -15000, "Mastery level": 2 }));
  for (const bad of [{ "Mastery level": 2.5 }, { "Arcane Focus": 1.5 }, { Karma: 0.5 }]) assert.equal(isBuffSkills(bad), false, `${JSON.stringify(bad)}: a whole number`);
  assert.ok(isBuffSkillsByCharacter({ Fury: { Chivalry: 120 }, "": { Necromancy: 100 } }));
  for (const bad of [{ Chivalry: 120 }, { Fury: { Hiding: 1 } }, { ["x".repeat(65)]: {} }, JSON.parse('{"__proto__": {}}') as unknown, []]) assert.equal(isBuffSkillsByCharacter(bad), false, JSON.stringify(bad));
  for (const bad of [null, [], { Chivalry: 151 }, { Karma: 15001 }, { "Mastery level": 0 }, { Chivalry: "120" }, { Chivalry: Number.NaN }, { Hiding: 100 }, JSON.parse('{"__proto__": 5}') as unknown]) {
    assert.equal(isBuffSkills(bad), false, JSON.stringify(bad));
  }
});

test("[fast] buffs: one form at a time in a sent list; a saved one is healed on reading; a name like constructor is a name", () => {
  for (const bad of [["wraithForm", "lichForm"], ["enchant.hitLightning", "enchant.hitHarm"]]) assert.equal(isBuffList(bad), false, `${bad.join(" + ")}: one of an exclusive set`);
  assert.equal(isBuffList(["wraithForm", "enchant.hitHarm", "divineFury"]), true, "one of each set");
  assert.deepEqual(normalizeBuffs(["bless", "wraithForm", "lichForm", "bless", "divineFury"]), ["divineFury", "lichForm", "bless"], "the later form replaces the earlier, a repeat drops, catalog order");
  for (const bad of [null, "bless", ["nope"], [3]]) assert.equal(normalizeBuffs(bad), null, JSON.stringify(bad));
  const skills = runBuffs(["divineFury"], buffSkillValues(null, {}).values)!.skills;
  assert.deepEqual(savedBuffs({ buffs: { on: ["wraithForm", "lichForm"], skills } }), { on: ["lichForm"], skills }, "an old run's two forms, healed");
  assert.equal(isRunBuffs({ on: ["wraithForm", "lichForm"], skills }), false, "but never sent so");
  assert.equal(savedBuffs({ buffs: { on: [], skills } }), undefined, "an empty list is none");
  assert.deepEqual(normalizeBuffListsByCharacter({ constructor: ["reaperForm", "wraithForm"], toString: [] }), { constructor: ["wraithForm"], toString: [] });
  assert.equal(normalizeBuffListsByCharacter({ Kestrel: ["nope"] }), null);
  assert.ok(isBuffListsByCharacter({ constructor: ["bless"] }) && isBuffSkillsByCharacter({ constructor: { Chivalry: 100 } }));
  assert.equal(ownEntry({}, "constructor"), undefined, "never Object.prototype.constructor");
  assert.deepEqual(ownEntry({ constructor: ["bless"] }, "constructor"), ["bless"]);
});

test("[fast] buffs: Spellweaving's Arcane Empowerment, Attunement and Ethereal Form", () => {
  assert.deepEqual(alone("arcaneEmpowerment", { Spellweaving: 120, "Arcane Focus": 0 }).add, { sdi: 10 });
  assert.deepEqual(alone("arcaneEmpowerment", { Spellweaving: 120, "Arcane Focus": 2 }).add, { sdi: 20 });
  assert.deepEqual(alone("arcaneEmpowerment", { Spellweaving: 23 }).add, {}, "the shard's minimum of 24");
  assert.match(buffText("arcaneEmpowerment", { Spellweaving: 120, "Arcane Focus": 0 }, null, {}), /healing \+20%/);
  assert.match(buffText("attunement", { Spellweaving: 120, "Arcane Focus": 0 }, null, {}), /absorbs the next 51 melee damage/);
  assert.match(buffText("attunement", { Spellweaving: 10, "Arcane Focus": 6 }, null, {}), /absorbs the next 54 /);
  assert.deepEqual(alone("etherealForm").add, { physResist: -10, fireResist: -5, coldResist: -5, poisonResist: -5, energyResist: -5 });
  assert.deepEqual(alone("etherealForm", { Spellweaving: 119 }).add, {}, "the full Summoner only");
  assert.deepEqual(toggleBuff(["wraithForm"], "etherealForm"), { next: ["etherealForm"], replaced: "wraithForm" }, "a form");
});

test("[fast] buffs: Curse Weapon, and Ninjitsu's smaller forms and Mysterious Wisp", () => {
  assert.match(buffText("curseWeapon", { "Spirit Speak": 120 }, null, {}), /50% life leech on weapon hits · lasts 36 s/);
  assert.deepEqual(alone("ratRabbit").add, { "sk:stealth": 20 });
  assert.equal(buffText("ratRabbit", {}, null, {}), "Stealth +20");
  assert.deepEqual(alone("ferret").add, { "sk:stealing": 25 });
  assert.deepEqual(alone("catDog", { Ninjitsu: 120 }).outside, { hpRegen: 40 });
  assert.deepEqual(alone("catDog", { Ninjitsu: 40 }).outside, { hpRegen: 13 });
  assert.deepEqual(alone("catDog", { Ninjitsu: 39 }).outside, {}, "below 40");
  assert.deepEqual(alone("mysteriousWisp").add, { physResist: -10, fireResist: -5, coldResist: -5, poisonResist: -5, energyResist: -5 });
  assert.deepEqual(alone("mysteriousWisp", { Ninjitsu: 119 }).add, {});
  for (const id of ["ratRabbit", "ferret", "catDog", "mysteriousWisp"]) assert.equal(buffById(id)!.excl, "form");
});

test("[fast] buffs: Rampage by its stacks and mastery level, Playing the Odds as ServUO writes it", () => {
  const full = alone("rampage", { "Rampage hits": 60, "Mastery level": 3 });
  assert.deepEqual([full.add, full.outside], [{ ssi: 60 }, { hpRegen: 18, stamRegen: 24 }], "its Casting Focus is read nowhere in ServUO");
  const one = alone("rampage", { "Rampage hits": 1, "Mastery level": 3 });
  assert.deepEqual([one.add, one.outside], [{ ssi: 3 }, { hpRegen: 4, stamRegen: 3 }]);
  assert.deepEqual(alone("rampage", { "Rampage hits": 0 }).add, {});
  assert.deepEqual(alone("playingTheOdds", { Archery: 120, Tactics: 120 }).add, { hci: 45, ssi: 30 });
  assert.deepEqual(alone("playingTheOdds", { Archery: 0, Tactics: 0 }).add, { hci: 45, ssi: 30 }, "Math.Max: never below 45 and 30");
});

test("[fast] buffs: the Eodon potions, Urali's FC −2 shared with Protection, Grapes of Wrath, fish pies and tinctures", () => {
  assert.deepEqual(alone("barrab").outside, { hpRegen: 100 });
  assert.deepEqual(alone("jukari").add, { fireResist: 10, stamPool: 10 });
  assert.deepEqual(alone("barako").add, { physResist: 10, coldResist: 5 });
  assert.deepEqual(alone("sakkhra").add, { poisonResist: 10, energyResist: 5 });
  assert.deepEqual(alone("urali").add, { manaPool: 10 });
  const both = applyBuffs({ fc: 2 }, CAPS, ["protection", "urali"], { Inscription: 0 }, null);
  assert.equal(both.effective.fc, 0, "one penalty, not two");
  assert.deepEqual(both.beaten, [{ id: "urali", key: "fc", by: "protection" }]);
  assert.deepEqual(alone("grapesOfWrath").add, { di: 35, sdi: 15 });
  for (const [key, value] of [["di", 5], ["sdi", 5], ["hci", 8], ["dci", 8], ["hpRegen", 3], ["stamRegen", 3], ["manaRegen", 3]] as const) assert.deepEqual(alone(`fishPie.${key}`).add, { [key]: value });
  assert.deepEqual(alone("tincture.minstrel").add, {}, "its size is unknown: no number");
  assert.match(buffText("tincture.minstrel", {}, null, {}), /raises Musicianship for an hour/);
  for (const id of ["barrab", "jukari", "barako", "sakkhra", "urali", "grapesOfWrath", "fishPie.di", "tincture.shadows"]) assert.equal(buffById(id)!.unconfirmed, true, `${id} may not exist on UO Alive`);
});

test("[fast] buffs: the Gargoyle's passive and Berserk by HP lost (the shard wiki's tiers), locked to Gargoyles like the Human's to Humans", () => {
  const g = applyBuffs({}, CAPS, ["gargoyle"], {}, null, { race: "gargoyle" });
  assert.deepEqual([g.totals, g.caps.hci], [{ hci: 5, manaRegen: 2 }, 50]);
  for (const [lost, di, sdi] of [[0, 0, 0], [19, 0, 0], [20, 15, 3], [60, 45, 9], [80, 60, 12], [100, 60, 12]] as const) {
    const r = applyBuffs({}, CAPS, ["berserk"], { "HP lost": lost }, null, { race: "gargoyle" });
    assert.deepEqual([r.totals.di ?? 0, r.totals.sdi ?? 0], [di, sdi], `${lost}% lost`);
  }
  for (const id of ["gargoyle", "berserk"]) assert.deepEqual(applyBuffs({}, CAPS, [id], {}, null, { race: "human" }).blocked, [id], `${id}: Gargoyles only`);
  assert.deepEqual(applyBuffs({}, CAPS, ["human"], {}, null, { race: "gargoyle" }).blocked, ["human"]);
  assert.deepEqual(alone("berserk").add, { di: 60, sdi: 12 }, "with no character any race's is open");
});

test("[fast] buffs: the debuffs cast on you, in their own group, folded by default", () => {
  const g = BUFF_GROUPS.find((x) => x.name === "Debuffs (cast on you)")!;
  assert.equal(g.collapsed, true);
  assert.deepEqual(BUFFS.filter((b) => b.group === g.name).map((b) => b.id), ["curse", "corpseSkin", "mindRot"]);
  // Curse: 8 + 12 − 0 = 20% of each raw stat, rounded up, and every resist cap but Physical 10 lower above 60
  const fury = { str: 125, dex: 80, int: 35 };
  const c = applyBuffs({}, { ...CAPS, energyResist: 75 }, ["curse"], { "Enemy Eval Int": 120, "Resisting Spells": 0 }, fury);
  assert.deepEqual([c.totals.strBonus, c.totals.dexBonus, c.totals.intBonus], [-25, -16, -7]);
  assert.deepEqual([c.caps.physResist, c.caps.fireResist, c.caps.energyResist], [70, 60, 65], "an Elf's 75 Energy cap goes to 65");
  assert.equal(applyBuffs({}, { ...CAPS, fireResist: 60 }, ["curse"], {}, null).caps.fireResist, 60, "a cap of 60 or less stays");
  // your Resisting Spells 100 takes 10 points off; 120 more than cancels it
  assert.equal(applyBuffs({}, CAPS, ["curse"], { "Enemy Eval Int": 120, "Resisting Spells": 100 }, fury).totals.strBonus, -13);
  assert.deepEqual(applyBuffs({}, CAPS, ["curse"], { "Enemy Eval Int": 0, "Resisting Spells": 120 }, fury).shares.strBonus, undefined);
  assert.equal(buffText("curse", { "Enemy Eval Int": 120 }, null, {}), "STR, DEX, INT −20% of base · Fire, Cold, Poison, Energy cap −10");
  // Corpse Skin: malus min(15, (Necromancy + Spirit Speak) × 0.075), Fire and Poison caps 70 − malus
  const cs = applyBuffs({}, CAPS, ["corpseSkin"], { "Enemy Necro + SS": 240 }, null);
  assert.deepEqual([cs.totals.fireResist, cs.totals.poisonResist, cs.totals.coldResist, cs.totals.physResist, cs.caps.fireResist, cs.caps.poisonResist], [-15, -15, 10, 10, 55, 55]);
  assert.equal(applyBuffs({}, CAPS, ["corpseSkin"], { "Enemy Necro + SS": 100 }, null).caps.fireResist, 63);
  assert.match(buffText("mindRot", {}, null, {}), /spells cost 25% more mana, after LMC/);
  assert.equal(buffText("corpseSkin", { "Enemy Necro + SS": 240 }, null, {}), "Fire, Poison −15 · Cold, Phys +10 · Fire, Poison cap 55");
});

test("[fast] buffs: resist caps change in ServUO's order: additions, then Curse on the running cap, then Corpse Skin's absolute cap", () => {
  const skills = { Mysticism: 120, "Focus or Imbuing": 120, "Enemy Necro + SS": 240, "Enemy Eval Int": 120 };
  // Corpse Skin sets Fire and Poison to 70 − 15 whatever came before: Stone Form's +5 is gone, Curse's −10 too
  const stone = applyBuffs({}, CAPS, ["stoneForm", "corpseSkin"], skills, null);
  assert.deepEqual([stone.caps.fireResist, stone.caps.poisonResist, stone.caps.coldResist], [55, 55, 75]);
  const cursed = applyBuffs({}, CAPS, ["curse", "corpseSkin"], skills, null);
  assert.deepEqual([cursed.caps.fireResist, cursed.caps.coldResist], [55, 60]);
  // Curse reads the running cap: a 55 cap raised to 60 by a weak Stone Form is not above 60, so it stays
  const low = applyBuffs({}, { ...CAPS, coldResist: 55 }, ["stoneForm", "curse"], { ...skills, Mysticism: 60, "Focus or Imbuing": 60 }, null);
  assert.equal(low.caps.coldResist, 57, "55 + Stone Form's 2, not above 60: Curse leaves it");
  const high = applyBuffs({}, { ...CAPS, coldResist: 58 }, ["stoneForm", "curse"], skills, null);
  assert.equal(high.caps.coldResist, 53, "58 + 5 = 63 is above 60: Curse takes 10");
  assert.deepEqual(high.capShares.coldResist, [{ id: "stoneForm", value: 5 }, { id: "curse", value: -10 }]);
});

test("[fast] buffs: the less sure entries carry their confidence; the high ones carry none", () => {
  const conf = Object.fromEntries(BUFFS.filter((b) => b.confidence).map((b) => [b.id, b.confidence]));
  for (const id of ["catDog", "playingTheOdds", "barrab", "tincture.minstrel"]) assert.equal(conf[id], "low", id);
  for (const id of ["magicReflection", "arcaneEmpowerment", "etherealForm", "mysteriousWisp", "berserk", "curse", "stoneForm", "strengthPotion"]) assert.equal(conf[id], "medium", id);
  for (const id of ["divineFury", "wraithForm", "bless", "rampage", "attunement"]) assert.equal(conf[id], undefined, id);
});

// ---------------------------------------------------------------- Automatic: the buffs in the optimizer's profile
// A plan for `on` with every input at its default (120 skills, 15,000 karma) over `skills`, no stats and nothing worn.
const plan = (on: string[], skills: Skills = {}, worn: PropMap = {}): BuffPlan => ({ on, skills: { ...buffSkillValues(null, {}).values, ...skills }, stats: null, who: {}, worn });
const PROFILE: Profile = { floors: { ssi: 40, dci: 30, physResist: 70, fireResist: 60, coldResist: 65 }, weights: { ssi: 1, luck: 1 } };

test("[fast] buffs: a planned buff's in-cap share comes off the cap and the floor, a negative one adds to both", () => {
  const base = effectiveProfile(PROFILE, null), p = plannedProfile(PROFILE, null, plan(["divineFury"], { Chivalry: 105 }));
  // the flat tier: SSI +10, DCI −20, HCI and DI +10
  assert.deepEqual([p.caps.ssi, p.floors.ssi], [50, 30], "SSI: the gear needs 10 less, and 10 less is worth anything");
  assert.deepEqual([p.caps.dci, p.floors.dci], [65, 50], "DCI −20: the gear has to make up the 20, and can be worth 20 more");
  assert.deepEqual([p.caps.hci, p.caps.di], [35, 90]);
  assert.equal(p.floors.hci, undefined, "no floor is invented for a key the profile has none on");
  assert.deepEqual(p.weights, base.weights);
  assert.deepEqual(p.buffs, { on: ["divineFury"], skills: plan([], { Chivalry: 105 }).skills, stats: null, who: {}, caps: base.caps, floors: base.floors }, "the profile carries the plan, and the caps and floors before it");
  assert.deepEqual(profileResistCaps(p), profileResistCaps(base), "a result is shown against the caps before the buffs");
  // a share past the cap: never below 0
  const big = plannedProfile({ floors: { ssi: 5 } }, null, plan(["playingTheOdds"]));   // SSI +30
  assert.deepEqual([big.caps.ssi, big.floors.ssi], [30, 0]);
  assert.deepEqual(plannedProfile(PROFILE, null, plan([])), base, "no buffs: the plain profile, no buffs field");
  assert.deepEqual(plannedProfile(PROFILE, null, null), base);
});

test("[fast] buffs: a cap change lands before the share is taken off, in applyBuffs' order", () => {
  // White Tiger: DCI +20 and its cap +5 → gear's DCI cap 50 − 20, its floor 30 − 20
  const wt = plannedProfile(PROFILE, null, plan(["whiteTiger"]));
  assert.deepEqual([wt.caps.dci, wt.floors.dci], [30, 10]);
  // Divine Fury's −20 with it: they cancel, the cap still 5 higher
  const both = plannedProfile(PROFILE, null, plan(["divineFury", "whiteTiger"], { Chivalry: 105 }));
  assert.deepEqual([both.caps.dci, both.floors.dci], [50, 30]);
  // Magic Reflection: Phys cap 65 and Phys −20 at no Inscription, so the Phys floor of 70 counts to 65 and gear needs 85
  const mr = plannedProfile(PROFILE, null, plan(["magicReflection"], { Inscription: 0 }));
  assert.deepEqual([mr.caps.physResist, mr.floors.physResist, mr.caps.fireResist, mr.floors.fireResist], [85, 85, 60, 50]);
  // Corpse Skin sets Fire and Poison caps to 70 − 15 and takes 15 from each: gear's Fire cap 70, its floor 55 + 15
  const cs = plannedProfile(PROFILE, null, plan(["corpseSkin"], { "Enemy Necro + SS": 240 }));
  assert.deepEqual([cs.caps.fireResist, cs.floors.fireResist, cs.caps.poisonResist, cs.caps.coldResist, cs.floors.coldResist], [70, 70, 70, 60, 55]);
  // Stone Form raises every resist cap: a floor above the old cap now counts to the new one
  const sf = plannedProfile({ floors: { coldResist: 80 } }, null, plan(["stoneForm"], { Mysticism: 120, "Focus or Imbuing": 120 }));
  assert.deepEqual([sf.caps.coldResist, sf.floors.coldResist], [65, 65], "cap 75, share +10: gear needs 65 of 65");
});

test("[fast] buffs: with a character, the Resisting Spells bonus and the shares both come off; Protection lowers that bonus", () => {
  const ch = { skills: { "Resisting Spells": { value: 100 } } } as unknown as Character;   // +40 on uoalive
  const values = buffSkillValues({ "Resisting Spells": { value: 100 } }, {}).values;
  const p = plannedProfile(PROFILE, ch, { on: ["protection"], skills: { ...values, Inscription: 0 }, stats: null, who: {}, worn: {} });
  // Resisting Spells 100 → 65: its bonus 40 → 26, so every resist −14, and Phys −15 more
  assert.deepEqual([p.caps.physResist, p.floors.physResist, p.caps.fireResist, p.floors.fireResist], [59, 59, 44, 34]);
  assert.equal(p.resistBonus, 40);
});

test("[fast] buffs: what a buff adds past the cap never shapes the plan, so Enemy of One changes nothing", () => {
  const base = effectiveProfile(PROFILE, null);
  for (const on of [["enemyOfOne"], ["consecrateWeapon"], ["enemyOfOne", "consecrateWeapon"]]) {
    const { buffs, ...rest } = plannedProfile(PROFILE, null, plan(on));
    assert.deepEqual(rest, base, on.join(", "));
    assert.deepEqual(buffs!.on, on, "but it is named in the plan");
  }
  // Horrific Beast: its DI counts (in the cap), its HPR +20 is past the cap and does not
  const hb = plannedProfile({ floors: { hpRegen: 10, di: 50 } }, null, plan(["horrificBeast"]));
  assert.deepEqual([hb.floors.hpRegen, hb.caps.hpRegen, hb.floors.di, hb.caps.di], [10, 18, 25, 75]);
});

test("[fast] buffs: a potion is planned with the worn suit's Enhance Potions, and is named as taken from it", () => {
  const at = (ep: number): number => plannedProfile({ floors: { strBonus: 40 } }, null, plan(["greaterStrengthPotion"], { Alchemy: 0 }, { enhancePotions: ep })).floors.strBonus!;
  assert.deepEqual([at(0), at(50)], [20, 10], "+20, or +30 with 50 Enhance Potions");
  assert.deepEqual(plannedFromWorn(["divineFury", "greaterStrengthPotion", "enchant.hitLightning", "bless"]), ["greaterStrengthPotion", "enchant.hitLightning"]);
});

test("[fast] buffs: a requirement's note says what gear still needs and which buff gave what", () => {
  const prof = (on: string[], skills: Skills = {}) => { const pl = plan(on, skills); return { p: plannedProfile(PROFILE, null, pl), r: buffShift(effectiveProfile(PROFILE, null), pl).r }; };
  const df = prof(["divineFury"], { Chivalry: 105 });
  assert.equal(gearNeedsText("ssi", df.p.floors.ssi!, df.p.caps.ssi, df.r), "Gear needs 30: Divine Fury gives 10");
  assert.equal(gearNeedsText("dci", df.p.floors.dci!, df.p.caps.dci, df.r), "Gear needs 50: Divine Fury takes 20");
  assert.equal(gearNeedsText("luck", 0, undefined, df.r), null, "a requirement no buff touches has no note");
  const two = prof(["divineFury", "whiteTiger"], { Chivalry: 105 });
  assert.equal(gearNeedsText("dci", two.p.floors.dci!, two.p.caps.dci, two.r), "Gear needs 30 of a 50 cap: Divine Fury −20, White Tiger Form +20, White Tiger Form cap +5");
  const eoo = prof(["enemyOfOne"]);
  assert.equal(gearNeedsText("di", 100, 100, eoo.r), null, "past the cap: no note");
});

test("[fast] buffs: a run saves its buffs and their numbers; a change shows in the diff; a run saved before them has none", () => {
  const values = buffSkillValues(null, {}).values;
  assert.equal(runBuffs([], values), undefined, "none on: nothing saved, so the settings keep their old shape");
  const r = runBuffs(["divineFury"], { ...values, Chivalry: 105, "Resisting Spells": 80 })!;
  assert.deepEqual(r.on, ["divineFury"]);
  assert.equal(r.skills.Chivalry, 105);
  assert.equal(r.skills["Resisting Spells"], undefined, "the character's own, never saved as an input");
  assert.deepEqual(Object.keys(r.skills).sort(), Object.keys(BUFF_INPUTS).sort());
  assert.deepEqual(savedBuffs({ buffs: r }), r);
  for (const bad of [undefined, null, {}, { on: ["nope"], skills: {} }, { on: ["bless"], skills: { Chivalry: 999 } }]) assert.equal(savedBuffs({ buffs: bad }), undefined, JSON.stringify(bad));
  const two = runBuffs(["divineFury", "bless"], { ...values, Chivalry: 120 })!;
  assert.deepEqual(buffsDiff(undefined, r), ["+Divine Fury"]);
  assert.deepEqual(buffsDiff(r, undefined), ["−Divine Fury"]);
  assert.deepEqual(buffsDiff(r, two), ["+Bless", "Chivalry 105 → 120"]);
  assert.deepEqual(buffsDiff(two, two), []);
  assert.deepEqual(buffsDiff(undefined, { on: ["bogus"] }), [], "a damaged entry counts as none");
  // the panel's buffs by character, held to the same rule as the edits
  assert.equal(isBuffListsByCharacter({ Dorran: ["divineFury", "bless"], Kestrel: [] }), true);
  for (const bad of [[], { Dorran: ["nope"] }, { Dorran: ["bless", "bless"] }, { Dorran: "bless" }, null]) assert.equal(isBuffListsByCharacter(bad), false, JSON.stringify(bad));
});

test("[fast] buffs: manualProfile plans a hand-picked suit from that suit's weapon and totals, the raw stats from what is worn now", () => {
  const item = (serial: number, slot: string, props: PropMap, flags: string[] = []): Item => ({ serial, name: `Piece ${serial}`, amount: 1, props, setBonus: {}, extras: {}, flags, tags: [], strReq: 0, rarity: null, weight: null, skillReq: null,
    lines: [], gargoyle: false, slayers: [], medable: false, slot, twoHanded: false, gear: true, kind: "gear", root: null, container: null, equippedBy: null, layer: null, seenAt: "", scannedBy: "" });
  const ch = { name: "Kestrel", stats: { str: 100, dex: 90, int: 60 }, skills: {}, scannedAt: "", position: null, maxes: null, resists: null, adapter: null } as unknown as Character;
  const worn = [item(1, "oneHanded", { dexBonus: 10 })];
  const picked = { oneHanded: item(2, "oneHanded", { ep: 15 }, ["spell channeling"]) };
  const p = manualProfile({ floors: { hci: 10 } }, ch, worn, picked, "human", ["divineFury"], {});
  assert.deepEqual(p.buffs?.who.weaponFlags, ["spell channeling"], "the picked weapon's flags, not the worn one's");
  assert.deepEqual(p.buffs?.stats, { str: 100, dex: 80, int: 60 }, "raw stats: the scan less what is worn now");
  const none = manualProfile({ floors: { hci: 10 }, race: "elf" }, null, [], picked, null, ["divineFury"], {});
  assert.equal(none.buffs?.stats, null);
  assert.equal(none.buffs?.who.race, null, "no character: no race");
});
