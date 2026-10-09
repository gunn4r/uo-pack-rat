// solver-buffs-fuzz.test.mts — Automatic's buffs (issue #12) under a seeded fuzz, the pattern of solver-fuzz.test.mts.
//
// Automatic's buffs (issue #12) fuzzed the same way: three seeds × 400 instances of random buff sets (forms one at a time), random input values, raw stats, race, worn Enhance Potions and Resisting Spells, random requirements, weights and resist cap overrides over the whole 0-150 range, and small pools with negative values in two to four of the nineteen gear slots. For `plannedProfile`'s profile the core's exact search must prove the brute-force maximum and HiGHS must reach it; over every suit, what the solver is paid for weighted properties must differ by one constant from what the character really has with the buffs (`applyBuffs`' buffed caps and shares, the 150 stat headroom included, a resist override above the shard's cap set aside where a buff has a negative in-cap share, derived on its own), and a requirement must be met by gear exactly when gear plus bonus plus share reaches it. HiGHS may report a few instances unproven only where it ran out of time (a finished solve that disagrees with the core fails the test); each is named in a diagnostic and capped at 2% of a seed. `[fast]` (about 3 s).
//
// What is checked, in detail: the core's exact search and HiGHS both prove the brute-force maximum of the core's own scoreSet; over every suit, what the solver is paid for weighted properties differs from what the character really has with the buffs (max(the Resisting Spells minimum, min(gear + in-cap share, buffed cap)), applyBuffs' numbers) by one constant, so no suit is ever paid for points past a real cap, and the best suit's paid totals stay within the real caps; a requirement is met by a suit's gear exactly when gear + bonus + share reaches it (a resist's up to its buffed cap), for every gear total the solvers can tell apart (a floor at 0 reads as none, which a negative gear total below it would really miss: no real suit carries one).
//
// Random buff sets go through toggleBuff. Resist cap overrides run the whole 0-150 range, under the Resisting Spells minimum included, and raw stats leave gear what is left to 150 of STR, DEX and INT.
import { test } from "node:test";
import assert from "node:assert/strict";
import { effectiveProfile, profileResistCaps, RESIST_KEYS } from "./vault-lib.mts";
import type { Character, EffectiveProfile, Profile } from "./vault-lib.mts";
import { BUFF_IDS, BUFF_INPUTS, STAT_MAX, applyBuffs, minimumWith, plannedProfile, toggleBuff } from "./buffs.mts";
import type { BuffPlan, BuffResult, Skills } from "./buffs.mts";
import { solveExact, type OptPools, type OptAssignment, type OptProfile } from "./exact-solver.mts";
import { core, fuzzSlots } from "./solver-fixture.mts";   // also loads the uoalive rules

type Item = NonNullable<OptPools[string]>[number];
const DIMS = ["hci", "dci", "ssi", "di", "fc", "manaRegen", "hpRegen", "luck", "strBonus", "dexBonus", "physResist", "fireResist", "coldResist", "poisonResist", "energyResist"];
const EPS = 1e-6;

interface Instance { slots: string[]; optionalSlots: string[]; pools: OptPools; current: OptAssignment; p: Profile; ch: Character | null; plan: BuffPlan }
function generate(rnd: () => number, serialBase: number): Instance {
  const int = (lo: number, hi: number): number => lo + Math.floor(rnd() * (hi - lo + 1));
  const pickSome = <T,>(list: T[], pr: number): T[] => list.filter(() => rnd() < pr);
  let serial = serialBase;
  const mkItem = (slot: string): Item => ({ serial: ++serial, name: `item${serial}`, slot, props: Object.fromEntries(pickSome(DIMS, 0.35).map((d) => [d, int(-8, 30)])) });
  const slots = fuzzSlots(rnd, 4);
  const pools: OptPools = {}, current: OptAssignment = {};
  for (const s of slots) {
    pools[s] = Array.from({ length: int(1, 4) }, () => mkItem(s));
    if (rnd() < 0.4) current[s] = pools[s]![int(0, pools[s]!.length - 1)]!;
  }
  // buffs: each with a small chance, forms and Enchants one at a time; every input at a random value in its range
  const on = BUFF_IDS.filter(() => rnd() < 0.08).reduce<string[]>((acc, id) => toggleBuff(acc, id).next, []);
  const skills: Skills = Object.fromEntries(Object.entries(BUFF_INPUTS).map(([k, i]) => [k, i.int ? int(i.min, i.max) : Math.round((i.min + rnd() * (i.max - i.min)) * 10) / 10]));
  const rs = rnd() < 0.5 ? int(0, 120) : null;
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
  return { slots, optionalSlots: pickSome(slots, 0.5), pools, current, p, ch: rs == null ? null : ({ skills: { "Resisting Spells": { value: rs } } } as unknown as Character), plan };
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
    const rnd = core.optMulberry32(seed);
    let shifted = 0;
    const unproven: string[] = [];
    for (let i = 0; i < PER_SEED; i++) {
      const inst = generate(rnd, seed * 100000 + i * 100), label = `seed ${seed} instance ${i} (${inst.plan.on.join(", ") || "no buffs"})`;
      const planned = plannedProfile(inst.p, inst.ch, inst.plan), prof = planned as OptProfile;
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
      // a resist is held at the Resisting Spells minimum the buffs leave (Protection lowers it), after the cap
      const m = minimumWith(base.resistSkill, inst.plan.on.filter((id) => !r.blocked.includes(id)), inst.plan.skills);
      const held = (k: string, v: number): number => (RESIST_KEYS.includes(k) && m != null && v < m ? m : v);
      const real = (k: string, g: number): number => held(k, Math.min(g + share(k), r.caps[k] ?? Infinity));
      const weightsOnly = { ...prof, floors: {}, hardFloors: [] };
      const w = planned.weights;

      const all = suits(inst);
      let oracle = -Infinity, offset: number | null = null;
      for (const a of all) {
        oracle = Math.max(oracle, core.scoreSet(a, prof));
        const truth = DIMS.reduce((n, k) => n + (w[k] || 0) * real(k, gear(a, k)), 0);
        const d = truth - core.scoreSet(a, weightsOnly);
        if (offset == null) offset = d;
        assert.ok(Math.abs(d - offset) < EPS, `${label}: a suit is paid ${d - offset} off what the buffs really leave it`);
        for (const [k, f] of Object.entries(inst.p.floors || {})) {
          const g = gear(a, k), gearFloor = planned.floors[k]!, want = RESIST_KEYS.includes(k) ? Math.min(f, r.caps[k]!) : f;
          if (gearFloor <= 0 && g < 0) continue;   // a floor at 0 reads as none: only a negative gear total could tell
          const dropped = gearFloor <= (planned.mins?.[k] ?? -Infinity);   // at or under the solvers' min: met by any suit
          const have = RESIST_KEYS.includes(k) ? real(k, g) : g + share(k);
          assert.equal(gearFloor > 0 && !dropped ? g >= gearFloor : true, have >= want, `${label}: ${k} ≥ ${f} at gear ${g}`);
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
    if (unproven.length) t.diagnostic(`HiGHS unproven, the core's best reported: ${unproven.join("; ")}`);
    assert.ok(unproven.length <= PER_SEED / 50, `HiGHS unproven in ${unproven.length} instances`);
  });
}
