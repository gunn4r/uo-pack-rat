// solver-fuzz.test.mts — a seeded brute-force equivalence check over small generated inventories.
// Every instance is small enough to enumerate outright, so the exhaustive maximum of the core's own
// `scoreSet` is the oracle for all three searches: the core's heuristic (a valid suit, never above
// the oracle), the core's exact branch-and-bound (proven, equal to the oracle), and `solveExact`
// through HiGHS (proven, equal to the oracle, bound never below its own score). The generator leans
// on the cases that broke before: negative property values under soft and hard floors, negative
// weights on capped and floored properties, locked slots, and the shield / two-hander pair.
import { test } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { corePath } from "./config.mts";
import { solveExact, type OptPools, type OptAssignment, type OptProfile } from "./exact-solver.mts";
import type * as Core from "../scripts/optimizer-core.mts";

const core = (await import(pathToFileURL(corePath()).href)) as typeof Core;
type OptOptions = Parameters<typeof solveExact>[0]["opts"];
type Item = NonNullable<OptPools[string]>[number];

const ALL_SLOTS = ["helmet", "chest", "neck", "ring", "bracelet", "cloak", "oneHanded", "twoHanded"];
const DIMS = ["hci", "dci", "luck", "mr", "fc"];

interface Instance { slots: string[]; optionalSlots: string[]; pools: OptPools; current: OptAssignment; profile: OptProfile }

function generate(rnd: () => number, serialBase: number): Instance {
  const int = (lo: number, hi: number): number => lo + Math.floor(rnd() * (hi - lo + 1));
  const pickSome = <T,>(list: T[], p: number): T[] => list.filter(() => rnd() < p);
  let serial = serialBase;
  const mkItem = (slot: string): Item => {
    const props: Record<string, number> = {};
    for (const d of pickSome(DIMS, 0.5)) props[d] = int(-12, 25);
    const it: Item = { serial: ++serial, name: `item${serial}`, slot, props };
    if (slot === "twoHanded" && rnd() < 0.5) it.twoHanded = true;
    return it;
  };
  const slots = pickSome(ALL_SLOTS, 0.6).slice(0, 6);
  for (const s of ["ring", "oneHanded"]) if (slots.length < 2 && !slots.includes(s)) slots.push(s);
  const optionalSlots = pickSome(slots, 0.5);
  const pools: OptPools = {}, current: OptAssignment = {};
  for (const s of slots) {
    pools[s] = Array.from({ length: int(1, 4) }, () => mkItem(s));
    const r = rnd();
    if (r < 0.3) current[s] = pools[s]![int(0, pools[s]!.length - 1)]!;   // worn and in the pool
    else if (r < 0.5) current[s] = mkItem(s);                              // worn, not in the pool (keep what you wear)
  }
  if (current.twoHanded?.twoHanded === true) delete current.oneHanded;      // nobody wears a one-hander beside a two-hander
  const weights: Record<string, number> = {}, caps: Record<string, number> = {}, floors: Record<string, number> = {};
  for (const d of DIMS) {
    weights[d] = int(-2, 3);
    if (rnd() < 0.35) caps[d] = int(0, 30);
  }
  for (const d of pickSome(DIMS, 0.35)) floors[d] = int(3, 40);
  const hardFloors = pickSome(Object.keys(floors), 0.3);
  return { slots, optionalSlots, pools, current, profile: { weights, caps, floors, hardFloors, floorBonus: 1000, floorPartial: rnd() < 0.5 ? 0.5 : 0.25 } };
}

// The core's candidate rules, restated independently: the pool plus the worn piece (deduplicated by
// serial), plus "empty" when the slot is optional, has nothing, or has nothing worn; a two-handed
// weapon empties the one-handed layer, so it is no candidate at all while that layer is locked.
function candidates({ slots, optionalSlots, pools, current }: Instance): Record<string, (Item | null)[]> {
  const out: Record<string, (Item | null)[]> = {};
  for (const s of slots) {
    const list: (Item | null)[] = [], seen = new Set<number>();
    for (const it of pools[s] || []) if (it.slot === s && !seen.has(it.serial)) { seen.add(it.serial); list.push(it); }
    const cur = current[s];
    if (cur && cur.slot === s && !seen.has(cur.serial)) list.push(cur);
    if (optionalSlots.includes(s) || list.length === 0 || !cur) list.push(null);
    out[s] = list;
  }
  if (out.oneHanded && out.twoHanded && !out.oneHanded.includes(null)) out.twoHanded = out.twoHanded.filter((it) => !it || it.twoHanded !== true);
  return out;
}

function bruteForce(inst: Instance, cands: Record<string, (Item | null)[]>): number {
  let best = -Infinity;
  const pick: OptAssignment = {};
  const rec = (i: number): void => {
    if (i === inst.slots.length) {
      if (pick.twoHanded?.twoHanded === true && pick.oneHanded) return;
      best = Math.max(best, core.scoreSet(pick, inst.profile));
      return;
    }
    const s = inst.slots[i]!;
    for (const it of cands[s]!) { pick[s] = it; rec(i + 1); }
  };
  rec(0);
  return best;
}

function assertValidSuit(inst: Instance, cands: Record<string, (Item | null)[]>, best: OptAssignment, label: string): void {
  for (const s of inst.slots) {
    const it = best[s] || null;
    assert.ok(cands[s]!.some((c) => (c ? c.serial : null) === (it ? it.serial : null)), `${label}: ${s} holds a non-candidate`);
  }
  assert.ok(!(best.twoHanded?.twoHanded === true && best.oneHanded), `${label}: two-hander worn with a one-handed piece`);
}

const EPS = 1e-6;
const SEEDS = [3, 7, 23, 101, 2026];
const PER_SEED = 400;

for (const seed of SEEDS) {
  test(`[fast] brute force agrees with the heuristic, the core's exact search and HiGHS (seed ${seed})`, async () => {
    const rnd = core.optMulberry32(seed);
    for (let i = 0; i < PER_SEED; i++) {
      const inst = generate(rnd, seed * 100000 + i * 100);
      const label = `seed ${seed} instance ${i}`;
      const cands = candidates(inst);
      const oracle = bruteForce(inst, cands);
      const base: OptOptions = { seed: 1, restarts: 2, slots: inst.slots, optionalSlots: inst.optionalSlots };

      const heur = core.optimizeSuit(inst.pools, inst.current, inst.profile, { ...base, exact: false });
      assertValidSuit(inst, cands, heur.best, `${label} heuristic`);
      assert.ok(Math.abs(heur.score - core.scoreSet(heur.best, inst.profile)) < EPS, `${label}: heuristic score is not its own re-score`);
      assert.ok(heur.score <= oracle + EPS, `${label}: heuristic ${heur.score} above the brute-force maximum ${oracle}`);

      const exact = core.optimizeSuit(inst.pools, inst.current, inst.profile, { ...base, exact: true, timeBudgetMs: 5000 });
      assertValidSuit(inst, cands, exact.best, `${label} core exact`);
      assert.equal(exact.proven, true, `${label}: the core's exact search did not prove a tiny instance`);
      assert.ok(Math.abs(exact.score - oracle) < EPS, `${label}: core exact ${exact.score} != brute force ${oracle}`);

      const r = await solveExact({ core, ...inst, opts: { ...base, exact: true, timeBudgetMs: 10000 }, onProgress: () => {} });
      assertValidSuit(inst, cands, r.best, `${label} HiGHS`);
      assert.equal(r.solver === "highs" || r.solver === "none", true, `${label}: solver ${r.solver} (${r.fallbackReason})`);
      assert.ok(Math.abs(r.score - core.scoreSet(r.best, inst.profile)) < EPS, `${label}: HiGHS score is not the core's re-score`);
      assert.equal(r.proven, true, `${label}: HiGHS did not prove a tiny instance (score ${r.score}, brute force ${oracle}, bound ${r.bound})`);
      assert.ok(Math.abs(r.score - oracle) < 1e-3, `${label}: HiGHS ${r.score} != brute force ${oracle}`);
      if (r.bound != null) assert.ok(r.bound >= r.score - 1e-3, `${label}: bound ${r.bound} below the returned score ${r.score}`);
    }
  });
}
