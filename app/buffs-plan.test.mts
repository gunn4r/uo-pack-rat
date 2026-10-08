// buffs-plan.test.mts — Automatic's buffs in the optimizer's profile (issue #12, `app/buffs.mts` `plannedProfile`), across the combinations.
//
// `[fast]`: the buff plan's edge cases, checked against the plan's meaning rather than its code (`checkPlan`): every form alone and with Magic Reflection, Curse, Corpse Skin and the Gargoyle's cap changes, for No character and Resisting Spells 100; Corpse Skin, Stone Form and Curse together; resist shares past a cap, and a resist cap under the Resisting Spells bonus; a character lacking a buff's skill and an edited one; Bless and a potion sharing the STR slot; the 150 stat headroom with and without buffs; potions with Enhance Potions and Alchemy; a resist override set aside while a buff lowers that resist; the race locks; Enemy of One changing nothing; the requirement notes' wording; the run key (Enemy of One alone keys as none, a number no buff reads changes nothing, main's key with no buffs); every default template's profile with no buffs byte-equal to main's (02b052e), and with raw stats equal to it but for the stat caps, as a regression guard; and, through both solvers, a negative share pushing a hard floor out of reach (kept, reported unreachable), a share covering a floor, a share past a weighted cap, a potion filling DEX to 150, and Curse lowering a cap under the worn total.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { effectiveProfile, foldSnapshots, profileResistCaps, RESIST_KEYS } from "./vault-lib.mts";
import type { Character, EffectiveProfile, Profile, PropMap } from "./vault-lib.mts";
import { BUFFS, STAT_MAX, applyBuffs, article, buffSkillValues, gearNeedsText, overrideNote, planBuffs, plannedProfile, toggleBuff } from "./buffs.mts";
import type { BuffPlan, BuffResult, Skills, Stats } from "./buffs.mts";
import { solveExact, type OptPools, type OptProfile } from "./exact-solver.mts";
import { cell, core, defaultProfiles, fixture, templateNames } from "./solver-fixture.mts";   // also loads the uoalive rules
import { runKey } from "./runs-lib.mts";

const DEFAULTS = buffSkillValues(null, {}).values;
// A shipped template as the panel holds it, and the fixture character (the solver fixture's own cell builds these too).
const defaultTemplate = (n: string): Profile => ({ ...defaultProfiles.templates![n]!, softFloors: [] });
const FIXTURE = foldSnapshots([fixture]).characters.Fixture!;
const plan = (on: string[], skills: Skills = {}, { stats = null, race, worn = {} }: { stats?: Stats | null; race?: string; worn?: PropMap } = {}): BuffPlan =>
  ({ on, skills: { ...DEFAULTS, ...skills }, stats, who: race ? { race } : {}, worn });
// A character with Resisting Spells 100: +40 to each resist on uoalive.
const RS100 = { skills: { "Resisting Spells": { value: 100 } } } as unknown as Character;
const withRS = (p: BuffPlan): BuffPlan => ({ ...p, skills: { ...p.skills, "Resisting Spells": 100 } });
// A requirement and a weight on every key a buff moves.
const ALL: Profile = {
  floors: { physResist: 70, fireResist: 60, coldResist: 65, poisonResist: 50, energyResist: 70, hci: 30, dci: 30, ssi: 40, di: 60, sdi: 20, fc: 1, manaRegen: 4, hpRegen: 5, stamRegen: 3, strBonus: 20, dexBonus: 10, castingFocus: 5, "sk:stealth": 10 },
  weights: { hci: 2, dci: 2, ssi: 3, di: 1, sdi: 1, fc: 5, manaRegen: 2, hpRegen: 1, stamRegen: 1, luck: 1, physResist: 3, fireResist: 3, coldResist: 3, poisonResist: 3, energyResist: 3 },
};
const sum = (r: BuffResult, k: string): number => (r.shares[k] || []).filter((x) => !x.outside).reduce((n, x) => n + x.value, 0);

// The plan against its meaning: for any gear total g, what the solver is paid for a capped key, min(g, cap), plus the
// constant the character brings (the Resisting Spells bonus and the buffs' in-cap share) is what the character has,
// min(g + bonus + share, the buffed cap); and a floor is met by gear exactly when gear + bonus + share reaches it (a
// resist's up to its buffed cap). The buffed caps and shares are applyBuffs' (part A's evaluator), from the caps the
// profile had before the buffs.
function checkPlan(p: Profile, ch: Character | null, pl: BuffPlan, label: string): { planned: EffectiveProfile; r: BuffResult } {
  const base = effectiveProfile(p, ch), planned = plannedProfile(p, ch, pl), rsb = base.resistBonus, view = profileResistCaps(base);
  const caps = { ...base.caps };
  for (const k of RESIST_KEYS) caps[k] = view[k]!.cap;
  if (pl.stats) Object.assign(caps, { strBonus: STAT_MAX - pl.stats.str, dexBonus: STAT_MAX - pl.stats.dex, intBonus: STAT_MAX - pl.stats.int });
  const r = applyBuffs(pl.worn, caps, pl.on, pl.skills, pl.stats, pl.who);
  const bonus = (k: string): number => (RESIST_KEYS.includes(k) ? rsb : 0);
  for (const [k, cap] of Object.entries(planned.caps)) {
    for (const g of [-30, -5, 0, 7, 20, 45, 64, 70, 90, 140]) {
      assert.equal(Math.min(g, cap) + bonus(k) + sum(r, k), Math.min(g + bonus(k) + sum(r, k), r.caps[k]!), `${label}: ${k} cap at gear ${g}`);
    }
  }
  for (const [k, f] of Object.entries(p.floors || {})) {
    const want = RESIST_KEYS.includes(k) ? Math.min(f, r.caps[k]!) : f, gearFloor = planned.floors[k]!;
    for (const g of [0, 3, 7, 20, 45, 64, 70, 90, 140]) {
      assert.equal(gearFloor > 0 ? g >= gearFloor : true, g + bonus(k) + sum(r, k) >= want, `${label}: ${k} floor at gear ${g}`);
    }
  }
  assert.deepEqual(planned.weights, base.weights, `${label}: the weights are the player's`);
  assert.deepEqual([planned.hardFloors, planned.resistBonus, planned.floorBonus], [base.hardFloors, base.resistBonus, base.floorBonus], label);
  return { planned, r };
}

test("[fast] buffs plan: every form, alone and with each buff that changes caps, for No character and with Resisting Spells", () => {
  const forms = BUFFS.filter((b) => b.excl === "form").map((b) => b.id);
  assert.equal(forms.length, 14);
  // Magic Reflection adds to a cap, Curse changes the running caps, Corpse Skin sets them; the Gargoyle's raises HCI's
  const capBuffs: Array<[string[], string | undefined]> = [[[], undefined], [["magicReflection"], undefined], [["curse"], undefined], [["corpseSkin"], undefined], [["gargoyle"], "gargoyle"], [["magicReflection", "curse", "corpseSkin"], undefined]];
  const skills = { Mysticism: 120, "Focus or Imbuing": 120, "Enemy Eval Int": 120, "Enemy Necro + SS": 240, Inscription: 60, Ninjitsu: 120, Spellweaving: 120, "Arcane Focus": 3 };
  for (const f of forms) {
    for (const [extra, race] of capBuffs) {
      const on = [f, ...extra], label = on.join(" + ");
      const pl = plan(on, skills, { stats: { str: 90, dex: 80, int: 60 }, ...(race ? { race } : {}) });
      const { planned } = checkPlan(ALL, null, pl, label);
      checkPlan(ALL, RS100, withRS(pl), `${label}, Resisting Spells 100`);
      assert.deepEqual(planned.buffs!.on, on, label);
    }
  }
  // two concrete ones: Wraith Form's −5 Fire raises what gear must give, White Tiger's cap +5 comes before its +20
  assert.deepEqual([plannedProfile(ALL, null, plan(["wraithForm"])).floors.fireResist, plannedProfile(ALL, null, plan(["wraithForm"])).caps.fireResist], [65, 75]);
  assert.deepEqual([plannedProfile(ALL, null, plan(["whiteTiger"])).caps.dci, plannedProfile(ALL, null, plan(["whiteTiger"])).floors.dci], [30, 10]);
});

test("[fast] buffs plan: Corpse Skin, Stone Form and Curse together, each cap change in the game's order", () => {
  const pl = plan(["stoneForm", "curse", "corpseSkin"], { Mysticism: 120, "Focus or Imbuing": 120, "Enemy Eval Int": 120, "Enemy Necro + SS": 240 });
  const { planned, r } = checkPlan(ALL, null, pl, "Stone Form + Curse + Corpse Skin");
  // caps: Stone Form +5 to all; Curse −10 on every one but Physical now above 60; Corpse Skin sets Fire and Poison to 55
  assert.deepEqual(RESIST_KEYS.map((k) => r.caps[k]), [75, 55, 65, 55, 65]);
  // shares: Stone Form +10 to all, Corpse Skin −15 Fire and Poison, +10 Cold and Physical
  assert.deepEqual(RESIST_KEYS.map((k) => sum(r, k)), [20, -5, 20, -5, 10]);
  assert.deepEqual(RESIST_KEYS.map((k) => planned.caps[k]), [55, 60, 45, 60, 55]);
  assert.deepEqual(RESIST_KEYS.map((k) => planned.floors[k]), [50, 60, 45, 55, 55]);
  checkPlan(ALL, RS100, withRS(pl), "the three with Resisting Spells 100");
});

test("[fast] buffs plan: a character lacking the buff's skill plans at 120; an edit plans at its number, for that character only", () => {
  const fury = { Swordsmanship: { value: 120 } }, mythos = { Chivalry: { value: 105 } };
  const lacking = buffSkillValues(fury, {});
  assert.ok(lacking.planned.has("Chivalry"));
  assert.equal(plannedProfile(ALL, null, { ...plan(["divineFury"]), skills: lacking.values }).floors.dci, 40, "120 Chivalry, 15,000 karma: the top tier's DCI −10");
  const own = buffSkillValues(mythos, {});
  assert.equal(plannedProfile(ALL, null, { ...plan(["divineFury"]), skills: own.values }).floors.dci, 50, "the character's own 105: the flat tier's −20");
  const edited = buffSkillValues(fury, { Chivalry: 105 });
  assert.ok(edited.planned.has("Chivalry"));
  assert.equal(plannedProfile(ALL, null, { ...plan(["divineFury"]), skills: edited.values }).floors.dci, 50, "an edit to 105");
  assert.equal(buffSkillValues(mythos, {}).values.Chivalry, 105, "another character's edit never reaches this one (edits are passed per character)");
});

test("[fast] buffs plan: a stat slot takes its largest share beside gear STR, which always stacks", () => {
  const stats = { str: 100, dex: 80, int: 50 };
  // Bless at Eval 120: 13% of raw (13, 11, 7); a Greater Strength potion at no Alchemy: +20 STR, which beats Bless's 13
  const pl = plan(["bless", "greaterStrengthPotion"], { "Evaluating Intelligence": 120, Alchemy: 0 }, { stats });
  const { planned, r } = checkPlan(ALL, null, pl, "Bless + Greater Strength");
  assert.deepEqual([sum(r, "strBonus"), sum(r, "dexBonus")], [20, 11]);
  assert.deepEqual(r.beaten, [{ id: "bless", key: "strBonus", by: "greaterStrengthPotion" }]);
  assert.deepEqual([planned.floors.strBonus, planned.floors.dexBonus], [0, 0], "STR 20 met by the potion, DEX 10 by Bless");
  assert.equal(planned.caps.strBonus, 30, "gear STR adds on top of either, up to 150: 150 − raw 100 − the potion's 20");
  // raw stats are what Bless takes its share of: a stronger character gets more
  assert.equal(sum(applyBuffs({}, {}, ["bless"], pl.skills, { str: 125, dex: 0, int: 0 }), "strBonus"), 17);
});

test("[fast] buffs plan: a potion scales with the worn suit's Enhance Potions and the Alchemy skill", () => {
  const str = (alchemy: number, ep: number): number => 40 - plannedProfile({ floors: { strBonus: 40 } }, null, plan(["greaterStrengthPotion"], { Alchemy: alchemy }, { worn: { enhancePotions: ep } })).floors.strBonus!;
  assert.deepEqual([str(0, 0), str(0, 50), str(0, 80), str(100, 0), str(100, 50)], [20, 30, 30, 30, 36], "EP caps at 50; at 100 Alchemy the larger of EP + 30.3 and 50");
});

test("[fast] buffs plan: a race's passive counts only for that race, and the Elf has none", () => {
  const hp = (race: string): number => plannedProfile(ALL, null, plan(["human"], {}, { race })).floors.hpRegen!;
  assert.deepEqual([hp("human"), hp("gargoyle"), hp("elf")], [3, 5, 5]);
  const hci = (race: string): [number, number] => { const p = plannedProfile(ALL, null, plan(["gargoyle", "berserk"], { "HP lost": 40 }, { race })); return [p.caps.hci!, p.floors.di!]; };
  assert.deepEqual(hci("gargoyle"), [45, 30], "HCI cap 50, +5 from the passive; DI +30 from Berserk at 40% HP lost");
  assert.deepEqual(hci("human"), [45, 60]);
  assert.deepEqual(hci("elf"), [45, 60]);
  checkPlan(ALL, null, plan(["human", "gargoyle"], {}, { race: "elf" }), "an Elf with both");
});

test("[fast] buffs plan: Enemy of One never changes the plan, alone or beside other buffs", () => {
  const strip = (p: EffectiveProfile): EffectiveProfile => { const { buffs: _b, ...rest } = p; return rest; };
  assert.deepEqual(strip(plannedProfile(ALL, RS100, withRS(plan(["enemyOfOne"])))), effectiveProfile(ALL, RS100));
  for (const others of [["divineFury"], ["divineFury", "whiteTiger"], ["consecrateWeapon", "reaperForm"], ["horrificBeast", "corpseSkin"]]) {
    const on = toggleBuff(others, "enemyOfOne").next;
    assert.deepEqual(strip(plannedProfile(ALL, null, plan(on))), strip(plannedProfile(ALL, null, plan(others))), others.join(", "));
  }
});

// The regression guard: with no buffs, every default template's profile is byte for byte main's (02b052e), so the
// solvers get the same input, a run keys the same and reuses the runs saved before buffs.
test("[fast] buffs plan: no buffs give main's profile for every default template, soft floors and cap overrides included", () => {
  const MAIN: Record<string, string> = {
    melee: "fee523b37328bfe4c304145dd7ca14b59880b171", "melee+soft": "113027db8458aeb6e81b87bd7043659d78076f4b",
    caster: "79d3e11a3b80a82a4691fc3b3ff74a39a6d0e2f2", "caster+soft": "839806e9d519b8ec5c0f28aaf2564457fb681025",
    archer: "a87996ee726fc38bbb5de16775e73fe57f90dc55", "archer+soft": "00d7edc37ccdbfaff68d5363cb9d5675e1187b6d",
    tank: "4587136b1e65cd075ef4f93292c4afb43ec118a7", "tank+soft": "916801b68a8d8cf7b11c670c56456eb3ffc367ee",
  };
  assert.deepEqual(templateNames, ["melee", "caster", "archer", "tank"]);
  for (const n of templateNames) for (const soft of [[], ["luck"]]) {
    const c = cell(n, { soft, overrides: soft.length ? { resistCaps: { fireResist: 95 } } : {} });
    assert.equal(createHash("sha1").update(JSON.stringify(c.profile)).digest("hex"), MAIN[`${n}${soft.length ? "+soft" : ""}`], `${n}${soft.length ? " with a soft floor and Fire 95" : ""}`);
  }
  assert.deepEqual(plannedProfile(ALL, RS100, plan([])), effectiveProfile(ALL, RS100), "an empty set is no set");
});

test("[fast] buffs plan: gear STR, DEX and INT are capped at what raw stats and the buffs leave to 150, with or without buffs", () => {
  const stats = { str: 90, dex: 125, int: 40 }, p: Profile = { weights: { dexBonus: 1, luck: 1 } };
  assert.equal(plannedProfile(p, null, null).caps.dexBonus, undefined, "no character: no stat caps");
  const none = plannedProfile(p, null, plan([], {}, { stats }));
  assert.deepEqual([none.caps.strBonus, none.caps.dexBonus, none.caps.intBonus], [60, 25, 110]);
  assert.equal(none.buffs, undefined, "no buffs planned: nothing to name in the result");
  // Greater Agility at no Alchemy: DEX +20, so gear can add 5 before 150
  const gap = checkPlan(p, null, plan(["greaterAgilityPotion"], { Alchemy: 0 }, { stats }), "Greater Agility at raw DEX 125").planned;
  assert.equal(gap.caps.dexBonus, 5);
  // past 150 already (Invigorate's +13 and the potion's +30 on raw 125): gear earns nothing there, exactly
  const past = checkPlan(p, null, plan(["greaterAgilityPotion", "invigorate"], { Alchemy: 100 }, { stats }), "Greater Agility and Invigorate").planned;
  assert.ok(past.caps.dexBonus! < 0, "below 0, which keeps min(gear, cap − share) + share exact");
  // the guard below holds stat caps apart: with raw stats and no buffs, every other number is main's
  for (const n of templateNames) {
    const c = cell(n), { strBonus: _s, dexBonus: _d, intBonus: _i, ...caps } = plannedProfile(defaultTemplate(n), FIXTURE, plan([], {}, { stats })).caps;
    assert.deepEqual(caps, c.profile.caps, `${n}: only the stat caps are new`);
  }
});

test("[fast] buffs plan: a resist override above the shard's cap is set aside while a buff lowers that resist, and the note says so", () => {
  const p: Profile = { floors: { fireResist: 70, coldResist: 70 }, weights: { fireResist: 1 }, resistCaps: { fireResist: 95, coldResist: 60 } };
  const reaper = withRS(plan(["reaperForm"], { Spellweaving: 120, "Arcane Focus": 0 }));
  const { prof, r } = planBuffs(p, RS100, reaper);
  assert.deepEqual(prof.buffs!.overridesIgnored, { fireResist: 95 }, "Fire's 95 would count Reaper's −25 twice; Cold's 60 is below the shard's cap and stays");
  assert.deepEqual([prof.caps.fireResist, prof.floors.fireResist], [55, 55], "planned at the shard's 70: gear supplies 70 − 40 + 25");
  assert.deepEqual([prof.caps.coldResist, prof.floors.coldResist], [15, 15], "Cold at its own 60, less 40 and Reaper's +5");
  assert.equal(overrideNote("fireResist", 95, r!), "Fire 95 override ignored: Reaper Form's −25 is counted");
  assert.equal(plannedProfile(p, RS100, withRS(plan(["divineFury"]))).buffs!.overridesIgnored, undefined, "no buff lowers Fire: the override counts");
  checkPlan({ ...p, resistCaps: { coldResist: 60 } }, RS100, reaper, "Reaper with Cold at 60");
});

test("[fast] buffs plan: a resist cap under the Resisting Spells bonus is exact once a buff touches it, and main's with none", () => {
  const p: Profile = { weights: { coldResist: 2, luck: 1 }, resistCaps: { coldResist: 20 } };
  assert.equal(plannedProfile(p, RS100, withRS(plan([]))).caps.coldResist, 0, "no buff on Cold: stopped at 0, as main does");
  const mr = checkPlan(p, RS100, withRS(plan(["magicReflection"], { Inscription: 0 })), "Magic Reflection with Cold at 20").planned;
  assert.equal(mr.caps.coldResist, -30, "20 − 40 − 10");
});

test("[fast] buffs plan: a requirement's note: its article, a full cap, no cap at or under 0, Protection's lower Resisting Spells", () => {
  const notes = (p: Profile, ch: Character | null, pl: BuffPlan, k: string): string | null => { const { prof, r } = planBuffs(p, ch, pl); return gearNeedsText(k, prof.floors[k]!, prof.caps[k], r!); };
  assert.equal(notes(ALL, null, plan(["divineFury"], { Chivalry: 105 }), "dci"), "Gear needs 50: Divine Fury takes 20");
  assert.equal(notes({ floors: { dci: 45 } }, null, plan(["divineFury"], { Chivalry: 105 }), "dci"), "Gear needs its full 65 cap: Divine Fury takes 20");
  assert.equal(notes({ floors: { physResist: 65 } }, null, plan(["magicReflection"], { Inscription: 120 }), "physResist"), "Gear needs its full 79 cap: Magic Reflection −14, Magic Reflection cap −5");
  assert.equal(notes({ floors: { physResist: 60 } }, null, plan(["magicReflection"], { Inscription: 120 }), "physResist"), "Gear needs 74 of a 79 cap: Magic Reflection −14, Magic Reflection cap −5");
  assert.equal(notes({ floors: { physResist: 60 } }, null, plan(["magicReflection", "reactiveArmor"], { Inscription: 120 }), "physResist"), "Gear needs 53 of a 58 cap: Reactive Armor +21, Magic Reflection −14, Magic Reflection cap −5");
  assert.equal(notes({ floors: { physResist: 60 } }, null, plan(["magicReflection"], { Inscription: 100 }), "physResist"), "Gear needs 75 of an 80 cap: Magic Reflection −15, Magic Reflection cap −5");
  assert.deepEqual([1, 7, 8, 11, 18, 80, 88, 110, 180, 800, 1100, 1800].map(article), ["a", "a", "an", "an", "an", "an", "an", "a", "a", "an", "an", "an"]);
  assert.equal(notes({ floors: { dci: 45 } }, null, plan(["whiteTiger", "perseverance", "savingThrow"], { "Mastery level": 3 }), "dci"), "Gear needs 0: White Tiger Form +20, Perseverance +30, Saving Throw (passive) +5, White Tiger Form cap +5", "a cap at or under 0 (50 − 55) is not named");
  assert.equal(notes({ floors: { fireResist: 70 } }, RS100, withRS(plan(["protection"], { Inscription: 0 })), "fireResist"), "Gear needs its full 44 cap: Protection takes 14 (lower Resisting Spells)");
  assert.equal(notes({ floors: { physResist: 70 } }, RS100, withRS(plan(["protection"], { Inscription: 0 })), "physResist"), "Gear needs its full 59 cap: Protection −15, Protection −14 (lower Resisting Spells)");
});

// The run key leaves out the plan's own bookkeeping, so it follows what the solvers read and nothing else.
test("[fast] buffs plan: the run key follows the plan: Enemy of One alone keys as none, numbers no buff reads change nothing", () => {
  const c = cell("melee"), key = (pl: BuffPlan | null): string => runKey({ pools: c.pools, current: c.current, profile: plannedProfile(defaultTemplate("melee"), FIXTURE, pl), opts: { seed: 2026, restarts: 200 } });
  const none = key(null);
  assert.equal(none, "9429d42878d9b905b4b2de73408227ae9c709241", "the key for the melee template at SOLVER_VERSION 7, the fixture's Faster Casting cap 4 from Bushido (was ad809043… at a flat cap of 2, 51a4b93c… at 6, a18a559b… at 5, 2c90c9b1… at 4, ac4629c8… at 3): a change here means every saved run stops being reused");
  assert.equal(key(plan(["enemyOfOne"])), none, "Enemy of One plans like none");
  assert.notEqual(key(plan(["divineFury"], { Chivalry: 105 })), key(plan(["divineFury"], { Chivalry: 120 })), "another tier, another plan");
  assert.equal(key(plan(["divineFury"], { Chivalry: 105 })), key(plan(["divineFury"], { Chivalry: 105, Necromancy: 40, Bushido: 3 })), "an edit no buff on reads");
  assert.notEqual(key(plan(["divineFury"], { Chivalry: 105 })), none);
});

test("[fast] buffs plan: Enemy of One keys as none with a resist override under the Resisting Spells bonus too", () => {
  const p: Profile = { weights: { coldResist: 1 }, resistCaps: { coldResist: 20 } }, stats = { str: 80, dex: 80, int: 80 };
  const none = plannedProfile(p, RS100, withRS(plan([], {}, { stats }))), eoo = plannedProfile(p, RS100, withRS(plan(["enemyOfOne"], {}, { stats })));
  assert.deepEqual([none.caps.coldResist, eoo.caps.coldResist], [0, 0], "a resist no buff touches keeps main's cap, stopped at 0");
  const k = (x: EffectiveProfile): string => runKey({ pools: {}, current: {}, profile: x, opts: {} });
  assert.equal(k(eoo), k(none));
});

// ---------------------------------------------------------------- the solvers on small pools
const OPTS = { exact: true, timeBudgetMs: 5000, restarts: 5, seed: 1, slots: ["helmet", "chest"], optionalSlots: ["helmet", "chest"] };
type Piece = { serial: number; name: string; slot: string; props: PropMap };
async function both(pools: Record<string, Piece[]>, profile: EffectiveProfile, current: Record<string, Piece> = {}) {
  const prof = profile as OptProfile, p = pools as unknown as OptPools;
  const heur = core.optimizeSuit(p, current as never, prof, { ...OPTS, exact: true });
  const r = await solveExact({ core, pools: p, current: current as never, profile: prof, opts: OPTS, onProgress: () => {} });
  assert.equal(r.solver, "highs");
  assert.ok(Math.abs(r.score - heur.score) < 1e-6, `HiGHS ${r.score} and the core ${heur.score} agree`);
  assert.deepEqual([r.best.helmet?.serial ?? null, r.best.chest?.serial ?? null], [heur.best.helmet?.serial ?? null, heur.best.chest?.serial ?? null], "on the suit too");
  return r;
}

test("[fast] buffs plan: a negative share that pushes a hard floor past reach keeps the floor and says it can't be met", async () => {
  const pools = { helmet: [{ serial: 92001, name: "Guard Helm", slot: "helmet", props: { dci: 20 } }], chest: [{ serial: 92002, name: "Guard Tunic", slot: "chest", props: { dci: 25 } }, { serial: 92003, name: "Lucky Tunic", slot: "chest", props: { luck: 80 } }] };
  const p: Profile = { floors: { dci: 45 }, weights: { luck: 1 } };
  const without = await both(pools, plannedProfile(p, null, null));
  assert.deepEqual([without.unreachableFloors, without.floorsConflict ?? false], [[], false], "45 from gear alone is reachable");
  const df = plannedProfile(p, null, plan(["divineFury"], { Chivalry: 105 }));
  assert.equal(df.floors.dci, 65, "Divine Fury's −20: gear has to give 65");
  assert.deepEqual(df.hardFloors, ["dci"], "the floor is kept, still hard");
  const r = await both(pools, df);
  assert.deepEqual(r.unreachableFloors, ["dci"], "named as out of reach, for the result's message");
  assert.deepEqual([r.best.helmet?.serial, r.best.chest?.serial], [92001, 92002], "the closest suit, not one that dropped the floor for Luck");
});

test("[fast] buffs plan: a share that covers a floor drops it to 0, and gear spends nothing on it", async () => {
  const pools = { helmet: [{ serial: 92101, name: "Swift Helm", slot: "helmet", props: { ssi: 10 } }, { serial: 92102, name: "Lucky Helm", slot: "helmet", props: { luck: 50 } }] };
  const p: Profile = { floors: { ssi: 10 }, weights: { luck: 1 } };
  assert.equal((await both(pools, plannedProfile(p, null, null))).best.helmet?.serial, 92101);
  const df = plannedProfile(p, null, plan(["divineFury"], { Chivalry: 105 }));
  assert.equal(df.floors.ssi, 0);
  assert.equal((await both(pools, df)).best.helmet?.serial, 92102);
});

test("[fast] buffs plan: a share past a weighted property's cap leaves gear nothing to earn there", async () => {
  const pools = { helmet: [{ serial: 92201, name: "Keen Helm", slot: "helmet", props: { hci: 30 } }, { serial: 92202, name: "Lucky Helm", slot: "helmet", props: { luck: 10 } }] };
  const p: Profile = { weights: { hci: 5, luck: 1 } };
  assert.equal((await both(pools, plannedProfile(p, null, null))).best.helmet?.serial, 92201, "150 points of HCI beat 10 of Luck");
  // Divine Fury's top tier +15 and Playing the Odds' +45: 60 HCI, past the 45 cap
  const full = plannedProfile(p, null, plan(["divineFury", "playingTheOdds"]));
  assert.equal(full.caps.hci, -15, "a cap below 0 keeps min(gear, cap − share) + share exact");
  const prof = full as OptProfile, keen = pools.helmet[0]! as never, lucky = pools.helmet[1]! as never;
  assert.equal(core.scoreSet({ helmet: keen }, prof), core.scoreSet({}, prof), "HCI gear is worth nothing");
  assert.equal(core.scoreSet({ helmet: lucky }, prof) - core.scoreSet({}, prof), 10);
  assert.equal((await both(pools, full)).best.helmet?.serial, 92202);
});

test("[fast] buffs plan: resist shares past a resist's cap with Resisting Spells: the gear's cap goes below 0 and stays exact", async () => {
  // Reactive Armor (Phys +21 at 120 Inscription), Wraith Form (+15), Corpse Skin (+10) and Barako (+10): 56, and 40 more
  // from Resisting Spells, against a cap of 70
  const pl = withRS(plan(["reactiveArmor", "wraithForm", "corpseSkin", "barako"], { Inscription: 120, "Enemy Necro + SS": 240 }));
  const { planned } = checkPlan({ weights: { physResist: 3, luck: 1 }, floors: { physResist: 70 } }, RS100, pl, "Phys past its cap");
  assert.deepEqual([planned.caps.physResist, planned.floors.physResist], [-26, 0]);
  const pools = { helmet: [{ serial: 92401, name: "Plate Helm", slot: "helmet", props: { physResist: 12 } }, { serial: 92402, name: "Lucky Helm", slot: "helmet", props: { luck: 5 } }] };
  assert.equal((await both(pools, planned)).best.helmet?.serial, 92402, "Physical from gear is worth nothing more");
});

test("[fast] buffs plan: past the 150 a potion fills, gear DEX earns nothing, so Luck wins", async () => {
  const pools = { helmet: [{ serial: 92501, name: "Nimble Helm", slot: "helmet", props: { dexBonus: 30 } }, { serial: 92502, name: "Lucky Helm", slot: "helmet", props: { luck: 10 } }] };
  const p: Profile = { weights: { dexBonus: 1, luck: 1 } }, stats = { str: 66, dex: 125, int: 42 };
  assert.equal((await both(pools, plannedProfile(p, null, null))).best.helmet?.serial, 92501, "no character: 30 DEX beats 10 Luck");
  assert.equal((await both(pools, plannedProfile(p, null, plan([], {}, { stats })))).best.helmet?.serial, 92501, "raw 125: 25 DEX still beats 10 Luck");
  assert.equal((await both(pools, plannedProfile(p, null, plan(["greaterAgilityPotion"], { Alchemy: 0 }, { stats })))).best.helmet?.serial, 92502, "the potion's +20 leaves 5");
});

test("[fast] buffs plan: a buff that lowers a cap under the worn total makes the excess worthless", async () => {
  const worn = { serial: 92301, name: "Fire Tunic", slot: "chest", props: { fireResist: 68 } };
  const pools = { chest: [worn, { serial: 92302, name: "Lucky Fire Tunic", slot: "chest", props: { fireResist: 60, luck: 5 } }] };
  const p: Profile = { weights: { fireResist: 1, luck: 1 } };
  assert.equal((await both(pools, plannedProfile(p, null, null), { chest: worn })).best.chest?.serial, 92301, "68 Fire beats 60 + 5 Luck");
  const cursed = plannedProfile(p, null, plan(["curse"], { "Enemy Eval Int": 120 }));
  assert.equal(cursed.caps.fireResist, 60, "Curse: the Fire cap 70 → 60");
  assert.equal((await both(pools, cursed, { chest: worn })).best.chest?.serial, 92302, "Fire past 60 is worth nothing, so Luck wins");
});
