// ============================================================================
// optimizer-core.test.mts — offline test harness for optimizer-core.mts.
//
// Run:  node --test scripts/optimizer-core.test.mts   or   node scripts/optimizer-core.test.mts
//
// HOW THE CORE IS LOADED: no build step — every caller (this harness, the server, the bench) imports
// scripts/optimizer-core.mts straight from source, via Node's native TypeScript type stripping, by the
// path config.mts's corePath()/paths.core resolves (PACKRAT_CORE overrides it). The source stays
// paste-able into the game client (no imports of its own, no top-level exports beyond its one trailing
// `export { ... }` line) while this harness exercises the exact file that ships. Requires Node >= 22.18
// (stable type stripping); verified on v24. If a future runtime drops native stripping, the fallback is
// `npx tsx` on this same file.
//
// None of the cases below use an exact/budgeted search (no `exact: true`, no `timeBudgetMs`) — every
// one is a cheap heuristic-restart run, so all are tagged [fast].
//
// TYPES: `import type * as Core` pulls in the core's export TYPES only — fully erased by type
// stripping, so it changes nothing at runtime — while the actual value load stays the runtime-computed
// `await import(pathToFileURL(corePath()).href)` the real path (and PACKRAT_CORE) depends on; casting
// that value `as typeof Core` gives every destructured function its real signature instead of `any`,
// so a real arity/shape mistake here is a compile error, not a silent pass. The core exports no type
// names (only its functions, in one trailing `export { ... }` line — see CONTRIBUTING.md, and it must
// stay that way), so `OptItem`/`Pools`/`Assignment`/`OptResult` below are derived structurally through
// `Parameters<>`/`ReturnType<>` on `Core.optimizeSuit` rather than imported or hand-duplicated.
// ============================================================================

import { test } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { corePath } from "../app/config.mts";
import type * as Core from "./optimizer-core.mts";

const core = (await import(pathToFileURL(corePath()).href)) as typeof Core;
const { scoreSet, optimizeSuit, optIsValidAssignment, optMulberry32, optDefaultSlots, optAssignmentTotals } = core;

// ---------------------------------------------------------------------------
// Seeded synthetic data
// ---------------------------------------------------------------------------

type Pools = Parameters<typeof Core.optimizeSuit>[0];
type Assignment = Parameters<typeof Core.optimizeSuit>[1];
type OptItem = Pools[string][number];
type OptResult = ReturnType<typeof Core.optimizeSuit>;

const SLOTS = optDefaultSlots();
const PROPS = ["physResist", "fireResist", "coldResist", "poisonResist", "energyResist", "hci", "dci", "di", "ssi", "lmc", "stamInc", "hpInc"];

const PROFILE = {
  weights: { physResist: 1, fireResist: 1, coldResist: 1, poisonResist: 1, energyResist: 1, hci: 2, dci: 3, di: 0.5, ssi: 1.5, lmc: 1, stamInc: 0.5, hpInc: 0.8 },
  caps: { physResist: 70, fireResist: 70, coldResist: 70, poisonResist: 70, energyResist: 70, hci: 45, dci: 45, di: 100, ssi: 60, lmc: 40 },
  floors: { physResist: 65, fireResist: 65, coldResist: 65, poisonResist: 65, energyResist: 65 },
  floorBonus: 1000,
  floorPartial: 0.5
};

// Builds ~`perSlot` candidates for every slot. Deterministic for a given seed. Some twoHanded
// candidates are real two-handed weapons (twoHanded: true), the rest are shields.
function makeWorld(seed: number, perSlot: number): { pools: Pools; current: Assignment } {
  const rnd = optMulberry32(seed);
  const pick = (arr: readonly string[]): string => arr[Math.floor(rnd() * arr.length)]!;
  const pools: Pools = {};
  let serial = 1000;
  for (const slot of SLOTS) {
    const list: OptItem[] = [];
    for (let i = 0; i < perSlot; i++) {
      const props: Record<string, number> = {};
      const n = 2 + Math.floor(rnd() * 3);
      for (let j = 0; j < n; j++) {
        const p = pick(PROPS);
        const mag = p.endsWith("Resist") ? 3 + Math.floor(rnd() * 16) : 1 + Math.floor(rnd() * 20);
        props[p] = (props[p] || 0) + mag;
      }
      const item: OptItem = { serial: serial++, name: `${slot}-${i}`, slot, props };
      // A third of the twoHanded pool are two-handed weapons; the rest are shields.
      if (slot === "twoHanded" && i % 3 === 0) item.twoHanded = true;
      list.push(item);
    }
    pools[slot] = list;
  }
  // The "currently equipped" suit: one arbitrary (seeded) piece per slot, kept structurally legal.
  const current: Assignment = {};
  for (const slot of SLOTS) {
    const list = pools[slot]!;
    current[slot] = list[Math.floor(rnd() * list.length)]!;
  }
  if (current.twoHanded && current.twoHanded.twoHanded === true) current.oneHanded = null;
  return { pools, current };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

// (1) The 2H / shield structural constraint is never violated.
test("[fast] never returns a set violating the 2H/shield constraint", () => {
  for (const seed of [1, 2, 3, 7, 42, 1234]) {
    const { pools, current } = makeWorld(seed, 30);
    const r = optimizeSuit(pools, current, PROFILE, { seed, restarts: 20 });
    assert.ok(optIsValidAssignment(r.best), `seed ${seed}: optIsValidAssignment rejected the result`);
    const th = r.best.twoHanded;
    if (th && th.twoHanded === true) {
      assert.equal(r.best.oneHanded, null, `seed ${seed}: two-handed weapon equipped alongside a one-handed weapon`);
    }
    for (const slot of SLOTS) {
      const it = r.best[slot];
      if (it) assert.equal(it.slot, slot, `seed ${seed}: ${it.name} placed on ${slot}`);
    }
  }
});

// A two-handed weapon so dominant that it must be chosen, forcing the oneHanded layer empty.
test("[fast] takes a dominant 2H weapon and empties the oneHanded layer", () => {
  const { pools, current } = makeWorld(9, 12);
  pools.twoHanded!.push({ serial: 999001, name: "Obliterator", slot: "twoHanded", twoHanded: true, props: { di: 100, hci: 45, ssi: 60 } });
  const r = optimizeSuit(pools, current, PROFILE, { seed: 9, restarts: 20 });
  assert.equal(r.best.twoHanded!.name, "Obliterator");
  assert.equal(r.best.oneHanded, null);
  assert.ok(optIsValidAssignment(r.best));
});

// (2) The returned set is never worse than the current suit or the greedy seed.
test("[fast] score >= currentScore and >= greedyScore", () => {
  for (const seed of [1, 2, 3, 7, 42, 1234]) {
    const { pools, current } = makeWorld(seed, 30);
    const r = optimizeSuit(pools, current, PROFILE, { seed, restarts: 20 });
    assert.ok(r.score >= r.currentScore - 1e-9, `seed ${seed}: ${r.score} < current ${r.currentScore}`);
    assert.ok(r.score >= r.greedyScore - 1e-9, `seed ${seed}: ${r.score} < greedy ${r.greedyScore}`);
    assert.ok(Math.abs(r.delta - (r.score - r.currentScore)) < 1e-9, "delta does not match score - currentScore");
  }
});

// The pure public scoreSet must agree with the search's incremental fast path.
test("[fast] scoreSet (pure) agrees with the search's incremental scoring", () => {
  for (const seed of [4, 11, 77]) {
    const { pools, current } = makeWorld(seed, 25);
    const r = optimizeSuit(pools, current, PROFILE, { seed, restarts: 15 });
    assert.ok(Math.abs(scoreSet(r.best, PROFILE) - r.score) < 1e-6, `seed ${seed}: scoreSet ${scoreSet(r.best, PROFILE)} vs result ${r.score}`);
    assert.ok(Math.abs(scoreSet(current, PROFILE) - r.currentScore) < 1e-6, `seed ${seed}: current score mismatch`);
  }
});

// Over-cap points are worth nothing — the property that makes this a set-level problem at all.
test("[fast] points above a cap contribute zero", () => {
  const a: OptItem[] = [{ serial: 1, name: "a", slot: "helmet", props: { fireResist: 70 } }];
  const b: OptItem[] = [{ serial: 2, name: "b", slot: "helmet", props: { fireResist: 200 } }];
  const p = { weights: { fireResist: 1 }, caps: { fireResist: 70 } };
  assert.equal(scoreSet(a, p), scoreSet(b, p));
  assert.equal(scoreSet(a, p), 70);
});

// (3) Determinism: same seed, same everything.
test("[fast] determinism: same seed => identical result", () => {
  const { pools, current } = makeWorld(31337, 30);
  const key = (r: OptResult) => JSON.stringify({
    score: r.score,
    picks: SLOTS.map((s) => { const it = r.best[s]; return it ? it.serial : null; }),
    changes: r.perSlotChanges.map((c) => `${c.slot}:${c.fromSerial}->${c.toSerial}`),
    totals: r.totals
  });
  const a = optimizeSuit(pools, current, PROFILE, { seed: 12345, restarts: 25 });
  const b = optimizeSuit(pools, current, PROFILE, { seed: 12345, restarts: 25 });
  assert.equal(key(a), key(b));
  const c = optimizeSuit(pools, current, PROFILE, { seed: 999, restarts: 25 });
  assert.equal(typeof key(c), "string"); // a different seed is allowed to differ; it must still run
});

// (4) The case that proves set-level beats per-item greedy.
//
// Fire is the only floored resist and only two pieces carry it. Each of those pieces is
// individually WORSE than its slot-mate (which carries raw damage increase), and with
// floorPartial = 0 there is no partial credit to hint at the floor — so per-item greedy takes
// both damage pieces and a plain hill climb from there cannot escape (changing one slot alone
// strictly loses). Only whole-set reasoning finds Fire Crown + Ember Plate, which clears the
// floor together and is worth an order of magnitude more.
test("[fast] finds the known optimum that requires two individually-inferior pieces", () => {
  const profile = {
    weights: { di: 1, fireResist: 0.1 },
    caps: {},
    floors: { fireResist: 65 },
    floorBonus: 1000,
    floorPartial: 0
  };
  const pools: Pools = {};
  let serial = 500;
  for (const slot of SLOTS) {
    pools[slot] = [{ serial: serial++, name: `filler-${slot}`, slot, props: { di: 5 } }];
  }
  pools.helmet = [
    { serial: 601, name: "DI Helm", slot: "helmet", props: { di: 20 } },
    { serial: 602, name: "Fire Crown", slot: "helmet", props: { fireResist: 40 } }
  ];
  pools.chest = [
    { serial: 611, name: "DI Plate", slot: "chest", props: { di: 20 } },
    { serial: 612, name: "Ember Plate", slot: "chest", props: { fireResist: 30 } }
  ];
  const current: Assignment = {};
  for (const slot of SLOTS) current[slot] = pools[slot]![0]!;

  // restarts: 0 leaves only the deterministic seeds (current, greedy, gradient continuation).
  // Passing here proves the gradient seed is what escapes the greedy basin, rather than a lucky
  // random restart -- confirmed against a build with the gradient seed removed, which finds the
  // optimum in 0/20 seeds at restarts: 0.
  const r = optimizeSuit(pools, current, profile, { seed: 2024, restarts: 0 });
  const rWithRestarts = optimizeSuit(pools, current, profile, { seed: 2024, restarts: 30 });

  // 10 filler slots x di 5 = 50 di, fire 40 + 30 = 70 >= 65.
  const OPTIMUM = 1000 + 0.1 * 70 + 50;
  assert.equal(r.best.helmet!.name, "Fire Crown", `helmet was ${r.best.helmet && r.best.helmet.name}`);
  assert.equal(r.best.chest!.name, "Ember Plate", `chest was ${r.best.chest && r.best.chest.name}`);
  assert.ok(Math.abs(r.score - OPTIMUM) < 1e-6, `score ${r.score} != optimum ${OPTIMUM}`);
  assert.equal(r.totals.after.fireResist, 70);
  // Per-item greedy really does get stuck on the damage pieces — this is what set-level buys.
  assert.ok(r.greedyScore < r.score - 900, `greedy ${r.greedyScore} was unexpectedly close to ${r.score}`);
  assert.ok(r.currentScore < r.score - 900, `current ${r.currentScore} was unexpectedly close to ${r.score}`);
  assert.ok(Math.abs(rWithRestarts.score - OPTIMUM) < 1e-6, `with restarts: ${rWithRestarts.score} != optimum ${OPTIMUM}`);
});

// perSlotChanges is a faithful diff of current -> best.
test("[fast] perSlotChanges reports every changed slot with its property delta", () => {
  const { pools, current } = makeWorld(55, 20);
  const r = optimizeSuit(pools, current, PROFILE, { seed: 55, restarts: 20 });
  const changed = SLOTS.filter((s) => {
    const f = current[s] || null, t = r.best[s] || null;
    return (f ? f.serial : 0) !== (t ? t.serial : 0);
  });
  assert.equal(r.perSlotChanges.length, changed.length);
  for (const c of r.perSlotChanges) {
    const f = current[c.slot] || null, t = r.best[c.slot] || null;
    assert.equal(c.fromSerial, f ? f.serial : 0);
    assert.equal(c.toSerial, t ? t.serial : 0);
    for (const [k, d] of Object.entries(c.gainedProps)) {
      const expect = ((t && t.props[k]) || 0) - ((f && f.props[k]) || 0);
      assert.equal(d, expect, `${c.slot}.${k}`);
    }
  }
  const before = optAssignmentTotals(current);
  assert.deepEqual(r.totals.before, before);
});

// (5) Runtime: 12 slots x 30 candidates must finish well under 2 seconds.
test("[fast] runtime: 12 slots x 30 candidates under 2s", (t) => {
  const { pools, current } = makeWorld(8675309, 30);
  const runs = 5;
  const t0 = process.hrtime.bigint();
  let evals = 0;
  for (let i = 0; i < runs; i++) {
    const r = optimizeSuit(pools, current, PROFILE, { seed: 4242 }); // shipped default restart count
    evals = r.evaluations;
  }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6 / runs;
  t.diagnostic(`${ms.toFixed(1)} ms mean over ${runs} runs (12 slots x 30 candidates, default restarts, ${evals.toLocaleString("en-US")} set evaluations per run)`);
  assert.ok(ms < 2000, `mean run took ${ms.toFixed(1)}ms`);
});

// A realistic run, printed as a diagnostic so the output is inspectable by eye (`node --test` shows
// diagnostics; plain `node scripts/optimizer-core.test.mts` prints test results as TAP either way).
test("[fast] sample run is inspectable (seed 2026)", (t) => {
  const { pools, current } = makeWorld(2026, 30);
  const r = optimizeSuit(pools, current, PROFILE, { seed: 2026 });
  t.diagnostic(`current ${r.currentScore.toFixed(1)} -> greedy ${r.greedyScore.toFixed(1)} -> optimized ${r.score.toFixed(1)}  (delta ${r.delta.toFixed(1)}, ${r.perSlotChanges.length} slots changed)`);
  const res = ["physResist", "fireResist", "coldResist", "poisonResist", "energyResist"];
  const fmt = (tot: Record<string, number>) => res.map((k) => `${k.replace("Resist", "")} ${tot[k] || 0}`).join("  ");
  t.diagnostic(`resists before: ${fmt(r.totals.before)}`);
  t.diagnostic(`resists after:  ${fmt(r.totals.after)}`);
  t.diagnostic(`equipped: ${SLOTS.map((s) => { const it = r.best[s]; return `${s}=${it ? it.name : "-"}`; }).join(", ")}`);
  assert.ok(optIsValidAssignment(r.best));
});

// Phase 2 Task 5 gate fix: optBuildSpace used to index `profile.weights[k]` with no `|| {}` guard
// (unlike caps/floors on the same lines), so a profile that carries caps/floors but no weights key
// threw instead of scoring everything at weight 0. A profile missing `weights` entirely is a real
// shape a caller can send (e.g. a hard-floors-only build); it must return a normal result.
test("[fast] optimizeSuit with a profile lacking weights returns a result instead of throwing", () => {
  const { pools, current } = makeWorld(99, 10);
  const profile: Parameters<typeof optimizeSuit>[2] = { caps: PROFILE.caps, floors: PROFILE.floors, floorBonus: 1000 };   // no weights — OptProfile declares it optional
  const r = optimizeSuit(pools, current, profile, { seed: 99 });
  assert.ok(optIsValidAssignment(r.best));
  assert.equal(typeof r.score, "number");
});

// Review I4: a property with a negative weight AND a floor is not monotone (more can win the floor,
// less saves weight), but dominance pruning treated it as "more is better" and dropped the better
// ring here: A (luck 10) scores −10 + 100 = 90, B (luck 20) scores −20 + 100 = 80. The exact search's
// optimistic bound made the same assumption; the brute-force check in app/solver-fuzz.test.mts covers it.
test("[fast] dominance pruning keeps the better item on a negatively weighted, floored property", () => {
  const a: OptItem = { serial: 1, name: "A", slot: "ring", props: { luck: 10 } };
  const b: OptItem = { serial: 2, name: "B", slot: "ring", props: { luck: 20 } };
  const profile = { weights: { luck: -1 }, caps: {}, floors: { luck: 10 }, floorBonus: 100 };
  assert.ok(scoreSet([a], profile) > scoreSet([b], profile));
  const space = core.optBuildSpace(core.optCollectKeys({ ring: [a, b] }, {}, profile), profile);
  assert.ok(core.optDominancePrune([a, b], space, false).includes(a));
  const r = optimizeSuit({ ring: [b, a] }, {}, profile, { exact: true, restarts: 0, slots: ["ring"], optionalSlots: ["ring"] });
  assert.equal(r.proven, true);
  assert.equal(r.best.ring?.serial, a.serial);
});
