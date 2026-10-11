// solver-buffs-fuzz.test.mts — Automatic's buffs (issue #12) under a seeded fuzz, the pattern of solver-fuzz.test.mts.
//
// Automatic's buffs (issue #12) fuzzed the same way: three seeds × 400 instances of random buff sets (forms one at a time), random input values, raw stats, race, worn Enhance Potions and Resisting Spells, random requirements, weights and resist cap overrides over the whole 0-150 range, and small pools with negative values in two to four of the nineteen gear slots. For `plannedProfile`'s profile the core's exact search must prove the brute-force maximum and HiGHS must reach it; over every suit, what the solver is paid for weighted properties must differ by one constant from what the character really has with the buffs (`applyBuffs`' buffed caps and shares, the 150 stat headroom included, a resist override above the shard's cap set aside where a buff has a negative in-cap share, derived on its own), and a requirement must be met by gear exactly when gear plus bonus plus share reaches it. HiGHS may report a few instances unproven only where it ran out of time (a finished solve that disagrees with the core fails the test); each is named in a diagnostic and capped at 2% of a seed. `[fast]` (about 3 s).
//
// What is checked, in detail: the core's exact search and HiGHS both prove the brute-force maximum of the core's own scoreSet; over every suit, what the solver is paid for weighted properties differs from what the character really has with the buffs (max(the Resisting Spells minimum, min(gear + in-cap share, buffed cap)), applyBuffs' numbers) by one constant, so no suit is ever paid for points past a real cap, and the best suit's paid totals stay within the real caps; a requirement is met by a suit's gear exactly when gear + bonus + share reaches it (a resist's up to its buffed cap), for every gear total the solvers can tell apart (a floor at 0 reads as none, which a negative gear total below it would really miss: no real suit carries one).
//
// Random buff sets go through toggleBuff. Resist cap overrides run the whole 0-150 range, under the Resisting Spells minimum included, and raw stats leave gear what is left to 150 of STR, DEX and INT.
//
// Issue #265: items carry Resisting Spells bonuses (0.1 to 15), characters a skill cap and sometimes a skill beside a breakpoint of the minimum, so a suit's own bonus lifts its minimum (resistSteps): the truth is held at the minimum of that suit's skill (minimumWith with its bonus and cap), and a floor the solvers count as met by the lifted minimum must be one the character really meets. Half the instances send only the steps the pool reaches, as the server does.
import { test } from "node:test";
import assert from "node:assert/strict";
import { effectiveProfile, liftedMin, profileResistCaps, RESIST_KEYS, RESIST_SKILL_KEY } from "./vault-lib.mts";
import type { Character, EffectiveProfile, Profile } from "./vault-lib.mts";
import { BUFF_IDS, BUFF_INPUTS, STAT_MAX, applyBuffs, minimumWith, plannedProfile, toggleBuff } from "./buffs.mts";
import type { BuffPlan, BuffResult, Skills } from "./buffs.mts";
import { solveExact, type OptPools, type OptAssignment, type OptProfile } from "./exact-solver.mts";
import { core, fuzzSlots } from "./solver-fixture.mts";   // also loads the uoalive rules
import { buildSuitMip, withReachableResistSteps } from "./mip.mts";

type Item = NonNullable<OptPools[string]>[number];
const DIMS = ["hci", "dci", "ssi", "di", "fc", "manaRegen", "hpRegen", "luck", "strBonus", "dexBonus", "physResist", "fireResist", "coldResist", "poisonResist", "energyResist"];
const EPS = 1e-6;

// Resisting Spells bonuses an item may carry (#265): whole points as loot rolls them, and tenths, so a total lands on and
// beside every step. Skills near the minimum's breakpoints (40, 55, 100, 105, 120) and caps from 100 to 120 (or none).
const RS_BONUS = [0.1, 0.5, 1, 1.5, 2, 5, 10, 15];
const RS_NEAR = [39.9, 40, 41.4, 54.9, 55, 99.9, 100, 104.9, 105, 115, 119.9];
const RS_CAPS = [100, 105, 110, 120, null];
interface Instance { slots: string[]; optionalSlots: string[]; pools: OptPools; current: OptAssignment; p: Profile; ch: Character | null; plan: BuffPlan; trim: boolean }
// `rnd2` draws only what issue #265 added (the bonuses, the skill near a breakpoint, its cap, trimming), so `rnd` draws
// every instance as before it.
function generate(rnd: () => number, serialBase: number, rnd2: () => number, rsBonus = true): Instance {
  const int = (lo: number, hi: number): number => lo + Math.floor(rnd() * (hi - lo + 1));
  const pickSome = <T,>(list: T[], pr: number): T[] => list.filter(() => rnd() < pr);
  const one = <T,>(list: T[]): T => list[Math.floor(rnd2() * list.length)]!;
  let serial = serialBase;
  const mkItem = (slot: string): Item => {
    const props: Record<string, number> = Object.fromEntries(pickSome(DIMS, 0.35).map((d) => [d, int(-8, 30)]));
    if (rsBonus && rnd2() < 0.3) props[RESIST_SKILL_KEY] = one(RS_BONUS);
    return { serial: ++serial, name: `item${serial}`, slot, props };
  };
  const slots = fuzzSlots(rnd, 4);
  const pools: OptPools = {}, current: OptAssignment = {};
  for (const s of slots) {
    pools[s] = Array.from({ length: int(1, 4) }, () => mkItem(s));
    if (rnd() < 0.4) current[s] = pools[s]![int(0, pools[s]!.length - 1)]!;
  }
  // buffs: each with a small chance, forms and Enchants one at a time; every input at a random value in its range
  const on = BUFF_IDS.filter(() => rnd() < 0.08).reduce<string[]>((acc, id) => toggleBuff(acc, id).next, []);
  const skills: Skills = Object.fromEntries(Object.entries(BUFF_INPUTS).map(([k, i]) => [k, i.int ? int(i.min, i.max) : Math.round((i.min + rnd() * (i.max - i.min)) * 10) / 10]));
  const drawn = rnd() < 0.5 ? int(0, 120) : null, rs = drawn != null && rnd2() < 0.5 ? one(RS_NEAR) : drawn, cap = one(RS_CAPS);
  if (rs != null) skills["Resisting Spells"] = rs;
  const race = ["human", "elf", "gargoyle"][int(0, 2)]!;
  const p: Profile = {
    race,
    weights: Object.fromEntries(DIMS.map((d) => [d, int(-2, 3)])),
    floors: Object.fromEntries(pickSome(DIMS, 0.3).map((d) => [d, int(3, RESIST_KEYS.includes(d) ? 85 : 50)])),
    resistCaps: rnd() < 0.3 ? { [RESIST_KEYS[int(0, 4)]!]: int(0, 150) } : undefined,
  };
  p.softFloors = pickSome(Object.keys(p.floors!), 0.4);
  const plan: BuffPlan = { on, skills, stats: rnd() < 0.7 ? { str: int(10, 125), dex: int(10, 125), int: int(10, 125) } : null, who: { race }, worn: { enhancePotions: int(0, 60) } };
  const ch = rs == null ? null : ({ skills: { "Resisting Spells": { value: rs, ...(cap != null ? { cap: Math.max(cap, rs) } : {}) } } } as unknown as Character);
  return { slots, optionalSlots: pickSome(slots, 0.5), pools, current, p, ch, plan, trim: rnd2() < 0.5 };
}

// Every suit of an instance, by the core's candidate rules (the pool plus the worn piece, and "empty" where allowed).
function suits(inst: Instance): OptAssignment[] {
  const cands = inst.slots.map((s) => {
    const list: Array<Item | null> = [...inst.pools[s]!];
    const cur = inst.current[s];
    if (cur && !list.some((it) => it?.serial === cur.serial)) list.push(cur);
    if (inst.optionalSlots.includes(s) || !cur) list.push(null);
    return list;
  });
  const out: OptAssignment[] = [];
  const rec = (i: number, pick: OptAssignment): void => {
    if (i === inst.slots.length) { out.push({ ...pick }); return; }
    for (const it of cands[i]!) rec(i + 1, { ...pick, [inst.slots[i]!]: it });
  };
  rec(0, {});
  return out;
}
const gear = (a: OptAssignment, k: string): number => Object.values(a).reduce((n, it) => n + (it?.props[k] || 0), 0);

const SEEDS = [5, 11, 2026];
const PER_SEED = 400;
for (const seed of SEEDS) {
  test(`[fast] buffs fuzz: both solvers prove the brute-force best of the planned profile, which pays only for real capped totals (seed ${seed})`, async (t) => {
    const rnd = core.optMulberry32(seed), rnd2 = core.optMulberry32(seed + 265);
    let shifted = 0, lifted = 0, stepped = 0, mattered = 0;
    const unproven: string[] = [];
    for (let i = 0; i < PER_SEED; i++) {
      const inst = generate(rnd, seed * 100000 + i * 100, rnd2), label = `seed ${seed} instance ${i} (${inst.plan.on.join(", ") || "no buffs"})`;
      // half the time with only the steps the pool reaches, as the server sends them; else every step, which the solvers must read alike
      const planned = plannedProfile(inst.p, inst.ch, inst.plan), prof = (inst.trim ? withReachableResistSteps(planned, inst.pools as never, inst.current as never, inst.optionalSlots, inst.slots) : planned) as OptProfile;
      // what the character really has: applyBuffs on the caps before the buffs
      const st = inst.plan.stats;
      const buffed = (b: EffectiveProfile): { caps0: Record<string, number>; r: BuffResult } => {
        const view = profileResistCaps(b), caps0 = { ...b.caps };
        for (const k of RESIST_KEYS) caps0[k] = view[k]!.cap;
        if (st) Object.assign(caps0, { strBonus: STAT_MAX - st.str, dexBonus: STAT_MAX - st.dex, intBonus: STAT_MAX - st.int });
        return { caps0, r: applyBuffs(inst.plan.worn, caps0, inst.plan.on, inst.plan.skills, inst.plan.stats, inst.plan.who) };
      };
      // an override above the shard's cap on a resist a buff lowers (a negative in-cap share) is set aside by design
      // (docs/solver.md), so the character really has the shard's cap there
      const unfiltered = effectiveProfile(inst.p, inst.ch), r0 = buffed(unfiltered).r;
      const ignored = RESIST_KEYS.filter((k) => { const o = unfiltered.resistCapOverrides?.[k]; return !!o && o.cap > o.shard && (r0.shares[k] || []).some((x) => !x.outside && x.value < 0); });
      const base = effectiveProfile({ ...inst.p, resistCaps: Object.fromEntries(Object.entries(inst.p.resistCaps || {}).filter(([k]) => !ignored.includes(k))) }, inst.ch);
      if (JSON.stringify(planned.caps) !== JSON.stringify(base.caps) || JSON.stringify(planned.floors) !== JSON.stringify(base.floors)) shifted++;
      const { r } = buffed(base);
      const share = (k: string): number => (r.shares[k] || []).filter((x) => !x.outside).reduce((n, x) => n + x.value, 0);
      // a resist is held at the Resisting Spells minimum the buffs leave (Protection lowers it) in that suit, its own
      // bonus added up to the skill's cap (vault-lib skillInSuit), after the cap
      const live = inst.plan.on.filter((id) => !r.blocked.includes(id)), rsCap = (inst.ch?.skills?.["Resisting Spells"] as { cap?: number } | undefined)?.cap ?? null;
      const minIn = (a: OptAssignment): number | null => (base.resistSkill == null ? null : minimumWith({ skill: base.resistSkill, bonus: gear(a, RESIST_SKILL_KEY), cap: rsCap }, live, inst.plan.skills));
      const held = (k: string, v: number, m: number | null): number => (RESIST_KEYS.includes(k) && m != null && v < m ? m : v);
      const real = (k: string, g: number, m: number | null): number => held(k, Math.min(g + share(k), r.caps[k] ?? Infinity), m);
      const weightsOnly = { ...prof, floors: {}, hardFloors: [] };
      const w = planned.weights;

      const all = suits(inst);
      let oracle = -Infinity, offset: number | null = null;
      // how often a reachable step is there, and changes the brute-force best's score
      const reachable = withReachableResistSteps(planned, inst.pools as never, inst.current as never, inst.optionalSlots, inst.slots), { resistSteps: _st, ...flat } = planned;
      if (reachable.resistSteps) {
        stepped++;
        const best = (pr: object): number => Math.max(...all.map((a) => core.scoreSet(a, pr as OptProfile)));
        if (Math.abs(best(planned) - best(flat)) > EPS) mattered++;
      }
      for (const a of all) {
        oracle = Math.max(oracle, core.scoreSet(a, prof));
        const m = minIn(a), bonus = gear(a, RESIST_SKILL_KEY);
        if (bonus > 0) lifted++;
        const truth = DIMS.reduce((n, k) => n + (w[k] || 0) * real(k, gear(a, k), m), 0);
        const d = truth - core.scoreSet(a, weightsOnly);
        if (offset == null) offset = d;
        assert.ok(Math.abs(d - offset) < EPS, `${label}: a suit is paid ${d - offset} off what the buffs really leave it`);
        for (const [k, f] of Object.entries(inst.p.floors || {})) {
          const g = gear(a, k), gearFloor = planned.floors[k]!, want = RESIST_KEYS.includes(k) ? Math.min(f, r.caps[k]!) : f;
          if (gearFloor <= 0 && g < 0) continue;   // a floor at 0 reads as none: only a negative gear total could tell
          const dropped = gearFloor <= (planned.mins?.[k] ?? -Infinity);   // at or under the solvers' min: met by any suit
          const have = RESIST_KEYS.includes(k) ? real(k, g, m) : g + share(k);
          // the solvers' floor: the gear total or the min the suit's own bonus lifts it to reaches it
          const solverMet = g >= gearFloor || (liftedMin(planned, k, bonus) ?? -Infinity) >= gearFloor;
          assert.equal(gearFloor > 0 && !dropped ? solverMet : true, have >= want, `${label}: ${k} ≥ ${f} at gear ${g}, Resisting Spells +${bonus}`);
        }
      }

      const opts = { seed: 1, restarts: 2, slots: inst.slots, optionalSlots: inst.optionalSlots };
      const exact = core.optimizeSuit(inst.pools, inst.current, prof, { ...opts, exact: true, timeBudgetMs: 5000 });
      assert.equal(exact.proven, true, `${label}: the core did not prove`);
      assert.ok(Math.abs(exact.score - oracle) < EPS, `${label}: core ${exact.score} != brute force ${oracle}`);
      const warned: string[] = [];
      const h = await solveExact({ core, pools: inst.pools, current: inst.current, profile: prof, opts: { ...opts, exact: true, timeBudgetMs: 10000 }, onProgress: () => {}, onWarn: (w: string) => warned.push(w) });
      assert.equal(h.solver === "highs" || h.solver === "none", true, `${label}: solver ${h.solver} (${h.fallbackReason})`);
      // HiGHS proves, and the score is the brute-force best. Unproven only where HiGHS ran out of time: a finished solve (status optimal) that still loses to the core is a
      // model the core disagrees with, the Resisting Spells minimum's included.
      if (!h.proven) { unproven.push(label); assert.ok(!warned.some((m) => m.includes("HiGHS status optimal")), `${label}: HiGHS finished but disagrees with the core: ${warned.join("; ")}`); }
      assert.ok(Math.abs(h.score - oracle) < 1e-3, `${label}: HiGHS ${h.score} != brute force ${oracle}`);
      // the best suit's paid totals, with the shares, never pass a real cap
      for (const [k, c] of Object.entries(planned.caps)) {
        if (!w[k]) continue;
        assert.ok(Math.min(gear(h.best, k), c) + share(k) <= r.caps[k]! + EPS, `${label}: ${k} paid past its real cap ${r.caps[k]}`);
      }
    }
    assert.ok(shifted > PER_SEED / 3, `the buffs moved the profile in ${shifted} of ${PER_SEED} instances`);
    assert.ok(lifted > PER_SEED && stepped > PER_SEED / 10 && mattered > PER_SEED / 50, `${lifted} suits carried a Resisting Spells bonus; ${stepped} instances could reach a step, in ${mattered} it changed the best score`);
    t.diagnostic(`${stepped} instances could reach a Resisting Spells step, in ${mattered} it changed the best score`);
    if (unproven.length) t.diagnostic(`HiGHS unproven, the core's best reported: ${unproven.join("; ")}`);
    assert.ok(unproven.length <= PER_SEED / 50, `HiGHS unproven in ${unproven.length} instances`);
  });
}

// Issue #265: with no Resisting Spells bonus in the pool, the steps change nothing: the server drops them before the key,
// and the MIP built from a profile that still carries them is byte for byte the one built without them.
test("[fast] buffs fuzz: a pool without Resisting Spells bonuses keys, models and solves as before the steps", () => {
  for (const seed of SEEDS) {
    const rnd = core.optMulberry32(seed), rnd2 = core.optMulberry32(seed + 265);
    let withSteps = 0;
    for (let i = 0; i < 200; i++) {
      const inst = generate(rnd, seed * 100000 + i * 100, rnd2, false), label = `seed ${seed} instance ${i}`;
      const planned = plannedProfile(inst.p, inst.ch, inst.plan), { resistSteps, ...without } = planned;
      if (resistSteps) withSteps++;
      assert.deepEqual(withReachableResistSteps(planned, inst.pools as never, inst.current as never, inst.optionalSlots, inst.slots), without, `${label}: the server keeps no step`);
      const mip = (profile: object): string => JSON.stringify(buildSuitMip({ pools: inst.pools as never, current: inst.current as never, profile, optionalSlots: inst.optionalSlots, slots: inst.slots }).model);
      assert.equal(mip(planned), mip(without), `${label}: the same model`);
      const opts = { seed: 1, restarts: 2, slots: inst.slots, optionalSlots: inst.optionalSlots, exact: true, timeBudgetMs: 5000 };
      const a = core.optimizeSuit(inst.pools, inst.current, planned as OptProfile, opts), b = core.optimizeSuit(inst.pools, inst.current, without as OptProfile, opts);
      assert.deepEqual([a.score, a.best], [b.score, b.best], `${label}: the same suit`);
    }
    assert.ok(withSteps > 50, `${withSteps} profiles carried steps`);
  }
});

// Issue #265: a requirement the gear can't reach, met only by the minimum a Resisting Spells bracelet lifts.
test("[fast] Resisting Spells steps: a hard floor met only through the lifted minimum, in both solvers, and not with Protection on", async () => {
  const item = (serial: number, slot: string, props: Record<string, number>): Item => ({ serial, name: `item${serial}`, slot, props });
  const pools: OptPools = { bracelet: [item(1, "bracelet", { [RESIST_SKILL_KEY]: 10 }), item(2, "bracelet", { luck: 100 })], chest: [item(3, "chest", { fireResist: 20 })], ring: [item(4, "ring", { [RESIST_SKILL_KEY]: 0.1 }), item(5, "ring", { luck: 50 })] };
  const slots = ["bracelet", "chest", "ring"], optionalSlots = ["bracelet", "ring"];
  const solve = async (skill: number, cap: number, on: string[] = []): Promise<Array<[number, number | null]>> => {
    const ch = { skills: { "Resisting Spells": { base: skill, value: skill, cap } } } as unknown as Character;
    const p: Profile = { floors: { fireResist: 40 }, weights: { luck: 1 } };
    const planned = plannedProfile(p, ch, { on, skills: { Inscription: 0, "Resisting Spells": skill }, stats: null, who: {}, worn: {} });
    const prof = withReachableResistSteps(planned, pools as never, {}, optionalSlots, slots) as OptProfile;
    const opts = { seed: 1, restarts: 2, slots, optionalSlots, exact: true, timeBudgetMs: 5000 };
    const c = core.optimizeSuit(pools, {}, prof, opts);
    const h = await solveExact({ core, pools, current: {}, profile: prof, opts, onProgress: () => {}, onWarn: () => {} });
    assert.ok(c.proven && h.proven && Math.abs(c.score - h.score) < 1e-3, `skill ${skill}: core ${c.score}, HiGHS ${h.score}`);
    return [[c.best.bracelet?.serial ?? 0, c.best.ring?.serial ?? null], [h.best.bracelet?.serial ?? 0, h.best.ring?.serial ?? null]];
  };
  assert.deepEqual(await solve(90, 120), [[1, 5], [1, 5]], "90 + 10: a minimum of 40 meets the floor, Luck from the ring");
  assert.deepEqual(await solve(90, 95), [[2, 5], [2, 5]], "the cap holds 90 + 10 at 95 (a minimum of 36): the floor is out of reach, Luck from both");
  assert.deepEqual(await solve(99.9, 120), [[2, 4], [2, 4]], "99.9: the ring's 0.1 is enough, the bracelet goes to Luck");
  assert.deepEqual(await solve(99.9, 120, ["protection"]), [[2, 5], [2, 5]], "Protection −35 first: 64.9 + 10.1 = 75, a minimum of 23");
});
