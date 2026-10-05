// buffs.test.mts — app/buffs.mts, the Suit Builder's buffs, abilities and forms (issue #12): each shipped effect's
// formula against the research's numbers, skill scaling at 0, the threshold and 120, one form at a time, the stat
// slots where the largest share counts, a cap raise, a bonus past the cap that never counts toward it, Protection's
// lower Resisting Spells, the words the picker shows, and the saved choices' checks.
// Tags: [fast]. Run: node --test app/buffs.test.mts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setRules } from "./vault-lib.mts";
import type { PropMap } from "./vault-lib.mts";
import type { RulesV1 } from "./schema/types.d.mts";
import { BUFFS, BUFF_IDS, BUFF_GROUPS, BUFF_INPUTS, applyBuffs, buffSkillValues, buffText, isBuffList, isBuffSkills, toggleBuff } from "./buffs.mts";
import type { Skills, Stats } from "./buffs.mts";

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
  assert.deepEqual(alone("lichForm").add, { fireResist: -10, coldResist: 10, poisonResist: 10, manaRegen: 13, hpRegen: -5 });
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
  assert.equal(buffText("protection", { Inscription: 0 }, null, {}), "Phys −15 · FC −2 past the cap · Resisting Spells −35");
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
  assert.deepEqual(alone("savingThrow", { "Mastery level": 1 }).add, { hci: 5 });
});

test("[fast] buffs: potions scale with the suit's Enhance Potions (at most 50) and 10 per 33 Alchemy; the Human's +2 HPR", () => {
  assert.equal(alone("strengthPotion", { Alchemy: 120 }).add.strBonus, 13);
  assert.equal(alone("greaterStrengthPotion", { Alchemy: 120 }).add.strBonus, 26);
  assert.equal(alone("greaterAgilityPotion", { Alchemy: 0 }).add.dexBonus, 20);
  assert.equal(alone("greaterStrengthPotion", { Alchemy: 120 }, null, { enhancePotions: 60 }).add.strBonus, 36, "EP 50 + 30");
  assert.deepEqual(alone("human").add, { hpRegen: 2 });
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
  assert.equal(r.totals.strBonus, 13 + 26);
  assert.equal(r.totals.dexBonus, 11);
  assert.equal(r.totals.intBonus, 5);
  assert.deepEqual(r.beaten, [{ id: "bless", key: "strBonus", by: "greaterStrengthPotion" }]);
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
  assert.equal(buffText("stoneForm", { Mysticism: 120, "Focus or Imbuing": 120 }, null, {}), "All resists +10 · SSI −10 · FC −2 · Resist caps +5");
  assert.equal(buffText("whiteTiger", {}, null, {}), "DCI +20 · DCI cap +5");
  assert.equal(buffText("wolfKitsune", {}, null, {}), "HCI +20 · Hits +20");
  assert.equal(buffText("savingThrow", { "Mastery level": 1 }, null, {}), "HCI +5");
});

test("[fast] buffs: the saved choices' checks", () => {
  assert.ok(isBuffList([]) && isBuffList(["divineFury", "bless"]));
  for (const bad of [null, "divineFury", ["nope"], ["bless", "bless"], [5], {}]) assert.equal(isBuffList(bad), false, JSON.stringify(bad));
  assert.ok(isBuffSkills({}) && isBuffSkills({ Chivalry: 105.5, Karma: -15000, "Mastery level": 2 }));
  for (const bad of [null, [], { Chivalry: 151 }, { Karma: 15001 }, { "Mastery level": 0 }, { Chivalry: "120" }, { Chivalry: Number.NaN }, { Hiding: 100 }, JSON.parse('{"__proto__": 5}') as unknown]) {
    assert.equal(isBuffSkills(bad), false, JSON.stringify(bad));
  }
});
