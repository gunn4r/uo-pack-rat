// diagnostics.test.mts — `app/diagnostics.mts` and the per-slot bound it shares with the MIP (`app/mip.mts` propertyReach, issue #217): propertyReach gives the numbers the bound inside buildSuitMip used to compute (a copy of that code is the reference, over fuzzed pools with two-handers, required slots and negative values) and BuiltMip.reach is the same, plus one bound written out by hand (a duplicated serial, a worn piece missing from the pool, a required slot with only negative pieces); `floor_unreachable` for a floor one above the bound (hard: Lower and Make soft; soft: info, Lower only), none for a floor exactly at it (which keeps its hard row); best possible in the player's terms (the Resisting Spells minimum, a floor at it met by any suit, a buff's share, the cap), a buff that lifts reach over a floor; `floors_conflict` on the floors the suit misses, on the heuristic path ("not found within the time limit") and on HiGHS's (a proven conflict); an empty inventory; a malformed profile (non-list `hardFloors`) read as far as it goes; a resist floor clipped to its cap saying so; and the page's side (`ui/builder-model.mts`): an action's words and edit, an action that no longer fits the panel (lowered by hand, removed, already soft) doing nothing, an alternative suit's card without `floors_conflict`, `withDiagnostics` leaving the field off when computing them fails, a saved run without `diagnostics` drawn from `unreachableFloors`, and Set weight (its words, and doing nothing once the weight changed or was removed since the build); and the weight scale: `typicalRange` (registry, cap, override, pools, skill bonuses), `weight_dominates` on a melee main's suit (luck at weight 3, suggested 0.8) measured against the OTHER weights (two properties can flag, one can't), quiet on a balanced profile, zero and negative weights, each threshold and the thin-suit guard alone, the suggested weight's rounding, the archer template on a weapon-only and a low-resist suit of the demo inventory (quiet, by the guard), and every shipped template on the demo characters' full suits (quiet); and swing (PR 3): `swing_linear` with Lock for the weapon's hand when the suit's weapon is the worn one (else the sentence says to equip it; none without a weapon), `swing_next_step` within 10 SSI with its stamina half only when a band up reaches the step, quiet with steps on, too far, at the cap or with no swing, the page's side of both (the switch, Lock, a step's requirement that raises or adds, soft, where Lower never raises, Next step and the swing line), and a weight's share with SSI scored by step counting the step credit; and `onlyRootsDiagnostics` (issue #12) naming the slots Only containers leaves empty. All `[fast]`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { propertyReach, buildSuitMip, type BuiltMip } from "./mip.mts";
import { preBuildDiagnostics, resultDiagnostics, withDiagnostics, weightDiagnostics, weaponFlagDiagnostics, onlyRootsDiagnostics, suggestedWeight, DOMINANT_SHARE, DOMINANT_WORTH, THIN_SUIT, type DiagnosticsProfile } from "./diagnostics.mts";
import { solveExact, type OptPools } from "./exact-solver.mts";
import { core, defaultProfiles, templateNames, type OptOptions } from "./solver-fixture.mts";
import { actionApplies, actionWords, applyAction, handledAction, nextSwingStep, resultChecks, swingLines } from "./ui/builder-model.mts";
import { readFileSync } from "node:fs";
import { buildPools, foldSnapshots, playerCaps, typicalRange, type OptItem } from "./vault-lib.mts";
import { upgradeScan } from "./scan-schema.mts";
import { plannedProfile } from "./buffs.mts";
import { optionalSlotsFor } from "./mip.mts";
import type { ScanV2 } from "./schema/types.d.mts";

const mk = (serial: number, slot: string, props: Record<string, number>, twoHanded = false): OptItem => ({ serial, name: `item${serial}`, slot, props, ...(twoHanded ? { twoHanded: true as const } : {}) });

// The bound as buildSuitMip computed it inline before propertyReach (SOLVER_VERSION 5), over the built columns.
function oldReach(built: BuiltMip, current: Partial<Record<string, OptItem>>, optionalSlots: string[], d: string): number {
  const { cols, xIndex } = built, optional = new Set(optionalSlots);
  const isRequired = (s: string): boolean => { const curItem = current[s]; return !optional.has(s) && !!curItem && curItem.slot === s; };
  const twoH = (xIndex.twoHanded || []).filter((j) => cols[j]!.item!.twoHanded === true), oneH = xIndex.oneHanded || [];
  const hands = twoH.length > 0 && oneH.length > 0;
  const val = (j: number): number => cols[j]!.item!.props[d] || 0;
  const best = (s: string, js: number[]): number => isRequired(s) ? Math.max(...js.map(val)) : Math.max(0, ...js.map(val));
  let reach = 0;
  for (const s of Object.keys(xIndex)) if (!hands || (s !== "oneHanded" && s !== "twoHanded")) reach += best(s, xIndex[s]!);
  if (hands) {
    const noTwoHander = best("twoHanded", xIndex.twoHanded!.filter((j) => !twoH.includes(j))) + best("oneHanded", oneH);
    const twoHander = Math.max(...twoH.map(val)) + (isRequired("oneHanded") ? -Infinity : 0);
    reach += Math.max(noTwoHander, twoHander);
  }
  return reach;
}
function rng(seed: number): () => number { let a = seed; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

test("[fast] propertyReach gives the numbers the bound inside buildSuitMip did, and BuiltMip.reach is it", () => {
  const slots = ["ring", "neck", "bracelet", "oneHanded", "twoHanded"], keys = ["ssi", "dci", "luck"];
  for (let seed = 1; seed <= 300; seed++) {
    const r = rng(seed), int = (lo: number, hi: number): number => lo + Math.floor(r() * (hi - lo + 1));
    let serial = seed * 1000;
    const pools: Record<string, OptItem[]> = {}, current: Record<string, OptItem> = {};
    for (const s of slots) {
      const n = int(0, 3);
      pools[s] = Array.from({ length: n }, () => mk(serial++, s, Object.fromEntries(keys.filter(() => r() < 0.7).map((k) => [k, int(-10, 30)])), s === "twoHanded" && r() < 0.6));
      if (r() < 0.5) current[s] = r() < 0.5 && pools[s]!.length ? pools[s]![0]! : mk(serial++, s, { ssi: int(-5, 10) }, s === "twoHanded" && r() < 0.5);
    }
    const optionalSlots = slots.filter(() => r() < 0.5);
    const reach = propertyReach(pools, current, optionalSlots, slots, keys);
    const built = buildSuitMip({ pools, current, optionalSlots, slots, profile: { weights: { ssi: 1, dci: -1 }, caps: { dci: 20 }, floors: { luck: 5 } } });
    for (const k of keys) {
      assert.equal(reach[k]!.max, oldReach(built, current, optionalSlots, k), `seed ${seed} ${k}`);
      assert.deepEqual(built.reach[k], reach[k], `seed ${seed} ${k}: BuiltMip.reach`);
    }
  }
});

// Two slots with SSI: the bound is 20 + 15 = 35.
const ssiPools = { ring: [mk(1, "ring", { ssi: 20 }), mk(2, "ring", { ssi: 5 })], neck: [mk(3, "neck", { ssi: 15 })] };
const ssiSlots = { slots: ["ring", "neck"], optionalSlots: ["ring", "neck"] };
const ssiProfile = (floor: number, extra: DiagnosticsProfile = {}): DiagnosticsProfile => ({ floors: { ssi: floor }, caps: { ssi: 60 }, hardFloors: ["ssi"], ...extra });

test("[fast] a floor exactly at the bound is reachable: no diagnostic, and the MIP keeps its hard row", () => {
  assert.deepEqual(preBuildDiagnostics({ pools: ssiPools, ...ssiSlots, profile: ssiProfile(35) }), []);
  const built = buildSuitMip({ pools: ssiPools, ...ssiSlots, profile: { weights: {}, ...ssiProfile(35) } });
  assert.ok(built.hardRows.ssi != null && !built.unreachableFloors.length);
});

test("[fast] a floor one above the bound: floor_unreachable with the best possible; hard offers Lower and Make soft, soft only Lower", () => {
  const [hard] = preBuildDiagnostics({ pools: ssiPools, ...ssiSlots, profile: ssiProfile(36) });
  assert.deepEqual(hard, { code: "floor_unreachable", level: "warn", property: "ssi", message: "Swing speed increase 36 can't be reached with your inventory (best possible: 35).",
    values: { floor: 36, best: 35 }, actions: [{ kind: "setFloor", property: "ssi", value: 35 }, { kind: "makeSoft", property: "ssi" }] });
  const soft = preBuildDiagnostics({ pools: ssiPools, ...ssiSlots, profile: ssiProfile(36, { hardFloors: [] }) });
  assert.deepEqual(soft.map((d) => [d.level, d.actions]), [["info", [{ kind: "setFloor", property: "ssi", value: 35 }]]]);
  // the result's list starts with the same ones
  const res = resultDiagnostics({ pools: ssiPools, ...ssiSlots, profile: ssiProfile(36), result: { totals: { after: { ssi: 35 } } } });
  assert.deepEqual(res, [hard]);
});

test("[fast] best possible is in the player's terms: the cap, the Resisting Spells minimum, a buff's share", () => {
  // the cap bounds it: a bound of 35 under a cap of 30
  assert.equal(preBuildDiagnostics({ pools: ssiPools, ...ssiSlots, profile: ssiProfile(40, { caps: { ssi: 30 } }) })[0]!.values!.best, 30);
  // a resist held at Resisting Spells' minimum of 40: the pool reaches 35, so the best is the minimum, 40, short of a floor of 50
  const res = { ring: [mk(1, "ring", { physResist: 20 })], neck: [mk(2, "neck", { physResist: 15 })] };
  const resist = (floor: number): DiagnosticsProfile => ({ floors: { physResist: floor }, caps: { physResist: 70 }, hardFloors: ["physResist"], mins: { physResist: 40 } });
  const [phys] = preBuildDiagnostics({ pools: res, ...ssiSlots, profile: resist(50) });
  assert.deepEqual(phys!.values, { floor: 50, best: 40 });
  assert.deepEqual(preBuildDiagnostics({ pools: res, ...ssiSlots, profile: resist(40) }), [], "a floor at the minimum is met by any suit");
  assert.deepEqual(resultDiagnostics({ pools: res, ...ssiSlots, profile: resist(40), result: { totals: { after: { physResist: 0 } } } }), []);
  // Divine Fury's +10 SSI: the player's floor of 60 is 50 from gear; the pool's 35 is 45 with the buff
  const [ssi] = preBuildDiagnostics({ pools: ssiPools, ...ssiSlots, profile: ssiProfile(50, { caps: { ssi: 50 }, buffs: { floors: { ssi: 60 } } }) });
  assert.deepEqual([ssi!.values, ssi!.message], [{ floor: 60, best: 45 }, "Swing speed increase 60 can't be reached with your inventory (best possible: 45)."]);
});

test("[fast] a buff whose share lifts the reach over the floor: no diagnostic", () => {
  // the player asks for 45; the buff gives 10, so gear needs 35, which the pool reaches exactly
  assert.deepEqual(preBuildDiagnostics({ pools: ssiPools, ...ssiSlots, profile: ssiProfile(35, { caps: { ssi: 50 }, buffs: { floors: { ssi: 45 } } }) }), []);
});

test("[fast] an empty inventory: the bound is 0, every floor is out of reach with best 0 and no Lower to 0, and nothing throws", () => {
  assert.deepEqual(propertyReach({}, {}, [], ["ring"], ["ssi"]), { ssi: { max: 0, min: 0 } });
  const d = resultDiagnostics({ pools: {}, current: {}, profile: ssiProfile(10), result: {} });
  assert.deepEqual(d.map((x) => [x.code, x.values, x.actions.map((a) => a.kind)]), [["floor_unreachable", { floor: 10, best: 0 }, ["makeSoft"]]]);
  assert.deepEqual(preBuildDiagnostics({ profile: {} }), []);
});

// Two hard floors each reachable alone, never together (solver.test.mts's jointly unreachable cell).
function jointCell() {
  const ring = mk(90001, "ring", { physResist: 10, fireResist: -1000 }), bracelet = mk(90002, "bracelet", { fireResist: 10, physResist: -1000 });
  const slots = ["ring", "bracelet"];
  const profile = { weights: { physResist: 1, fireResist: 1 }, caps: {}, floors: { physResist: 10, fireResist: 10 }, hardFloors: ["physResist", "fireResist"], floorBonus: 1000 };
  return { pools: { ring: [ring], bracelet: [bracelet] } as unknown as OptPools, current: {}, profile, slots, optionalSlots: slots };
}

test("[fast] floors_conflict names each hard floor the suit misses with its value, on the heuristic path and on HiGHS's", async () => {
  const c = jointCell();
  const opts: OptOptions = { exact: true, timeBudgetMs: 5000, restarts: 20, seed: 1, slots: c.slots, optionalSlots: c.optionalSlots };
  const exact = await solveExact({ core, ...c, opts, onProgress: () => {} });
  const heur = core.optimizeSuit(c.pools, c.current, c.profile, { ...opts, exact: false });
  assert.equal(exact.floorsConflict, true);
  for (const result of [exact, heur]) {
    const d = resultDiagnostics({ ...c, pools: c.pools as unknown as Record<string, OptItem[]>, result });
    const after = result.totals.after;
    const missed = ["physResist", "fireResist"].filter((k) => (after[k] || 0) < 10);
    assert.ok(missed.length > 0, "no suit meets both");
    assert.deepEqual(d.map((x) => [x.code, x.property, x.values]), missed.map((k) => ["floors_conflict", k, { floor: 10, value: after[k] || 0 }]));
    // HiGHS proved the conflict; the heuristic only ran out of time, and the sentence says no more than that
    assert.match(d[0]!.message, result === exact ? /can be reached, but not together with your other hard requirements: this suit has -?\d+\./
      : /can be reached, but no suit meeting it together with your other hard requirements was found within the time limit: this suit has -?\d+\./);
    assert.equal(d[0]!.actions[0]!.kind, "makeSoft");
  }
});

test("[fast] floor_unreachable comes out of both solver paths, and a met floor raises nothing", async () => {
  const pools = { ...ssiPools, bracelet: [mk(4, "bracelet", { dci: 10 })] }, slots = ["ring", "neck", "bracelet"], corePools = pools as unknown as OptPools;
  const profile = { weights: { ssi: 1, dci: 1 }, caps: { ssi: 60, dci: 45 }, floors: { ssi: 40, dci: 10 }, hardFloors: ["ssi", "dci"], floorBonus: 1000 };
  const opts: OptOptions = { exact: true, timeBudgetMs: 5000, restarts: 20, seed: 1, slots, optionalSlots: slots };
  const exact = await solveExact({ core, pools: corePools, current: {}, profile, opts, onProgress: () => {} });
  const heur = core.optimizeSuit(corePools, {}, profile, { ...opts, exact: false });
  for (const result of [exact, heur]) {
    const d = resultDiagnostics({ pools, current: {}, slots, optionalSlots: slots, profile, result });
    assert.deepEqual(d.map((x) => [x.code, x.property, x.values]), [["floor_unreachable", "ssi", { floor: 40, best: 35 }]]);
  }
});

test("[fast] the page: an action's words and its edit to the panel's profile", () => {
  const lowerTo = { kind: "setFloor", property: "ssi", value: 55 } as const, soft = { kind: "makeSoft", property: "ssi" } as const;
  assert.deepEqual(actionWords(lowerTo), { label: "Lower to 55", done: "Lowered ✓", toast: "Swing speed increase requirement lowered to 55. Build again to use it.", stale: "The requirement changed since this build, so this no longer applies." });
  assert.deepEqual(actionWords(soft), { label: "Make soft", done: "Made soft ✓", toast: "Swing speed increase requirement is soft now. Build again to use it.", stale: "The requirement changed since this build, so this no longer applies." });
  const p: { floors?: Record<string, number>; softFloors?: string[] } = { floors: { ssi: 60 } };
  applyAction(p, lowerTo); applyAction(p, soft); applyAction(p, soft);
  assert.deepEqual(p, { floors: { ssi: 55 }, softFloors: ["ssi"] });
  assert.ok([{ kind: "swingSteps", on: true } as const, { kind: "lockSlot", slot: "oneHanded" } as const, { kind: "setWeight", property: "luck", value: 1 } as const].every(handledAction), "every action kind has a button");
});

test("[fast] the page: an action applies only while the panel still holds what it changes", () => {
  const lowerTo = { kind: "setFloor", property: "ssi", value: 55 } as const, soft = { kind: "makeSoft", property: "ssi" } as const;
  // lowered by hand below the suggestion since the build: Lower would raise it, so it does nothing
  const lowered = { floors: { ssi: 40 } };
  assert.equal(actionApplies(lowered, lowerTo), false);
  applyAction(lowered, lowerTo);
  assert.deepEqual(lowered, { floors: { ssi: 40 } });
  // removed since: neither action puts it back or marks a missing floor soft
  const removed: { floors: Record<string, number>; softFloors?: string[] } = { floors: {} };
  assert.deepEqual([actionApplies(removed, lowerTo), actionApplies(removed, soft)], [false, false]);
  applyAction(removed, lowerTo); applyAction(removed, soft);
  assert.deepEqual(removed, { floors: {} });
  // already soft: Make soft no longer fits; Lower still does
  const already = { floors: { ssi: 60 }, softFloors: ["ssi"] };
  assert.deepEqual([actionApplies(already, soft), actionApplies(already, lowerTo)], [false, true]);
});

test("[fast] the page: a result's checks, warnings first; a saved run without diagnostics is drawn from unreachableFloors", () => {
  const info = { code: "floor_unreachable" as const, level: "info" as const, message: "i", actions: [] }, warn = { ...info, level: "warn" as const, message: "w" };
  assert.deepEqual(resultChecks({ diagnostics: [info, warn] }, false).map((d) => d.message), ["w", "i"]);
  assert.deepEqual(resultChecks({ diagnostics: [], unreachableFloors: ["luck"] }, false), [], "an empty list is the answer, not a cue to fall back");
  const [old] = resultChecks({ unreachableFloors: ["luck", "ssi"] }, true);
  assert.equal(old!.level, "warn");
  assert.match(old!.message, /^No suit in the pool can reach these requirements, even with the buffs: Luck, .+\.$/);
  assert.deepEqual(resultChecks({}, false), []);
});

test("[fast] the page: an alternative suit's card leaves out floors_conflict, whose values are the best suit's", () => {
  const unreachable = { code: "floor_unreachable" as const, level: "warn" as const, property: "ssi", message: "u", actions: [] };
  const conflict = { code: "floors_conflict" as const, level: "warn" as const, property: "dci", message: "c", actions: [] };
  assert.deepEqual(resultChecks({ diagnostics: [unreachable, conflict] }, false).map((d) => d.message), ["u", "c"]);
  assert.deepEqual(resultChecks({ diagnostics: [unreachable, conflict] }, false, true).map((d) => d.message), ["u"]);
});

test("[fast] a malformed profile is read as far as it goes, and a resist floor at its cap says so", () => {
  // hardFloors that is not a list counts as none: soft diagnostics, no throw
  const odd = { floors: { ssi: 36 }, caps: { ssi: 60 }, hardFloors: 5 as unknown as string[] };
  assert.deepEqual(preBuildDiagnostics({ pools: ssiPools, ...ssiSlots, profile: odd }).map((d) => d.level), ["info"]);
  assert.deepEqual(resultDiagnostics({ pools: ssiPools, ...ssiSlots, profile: { ...odd, hardFloors: {} as unknown as string[] }, result: { totals: { after: "x" as unknown as Record<string, number> } } }).map((d) => d.code), ["floor_unreachable"]);
  // a Physical floor of 75 clipped to the cap of 70
  const res = { ring: [mk(1, "ring", { physResist: 20 })] };
  const [phys] = preBuildDiagnostics({ pools: res, ...ssiSlots, profile: { floors: { physResist: 70 }, caps: { physResist: 70 }, hardFloors: ["physResist"] } });
  assert.equal(phys!.message, "Physical resist 70 (its cap) can't be reached with your inventory (best possible: 20).");
});

test("[fast] propertyReach's candidate rule against a bound written out: a serial listed twice counts once, and a worn piece missing from the pool is a candidate", () => {
  // ring: the pool lists serial 1 twice (luck 10 and, under the same serial, 99: the first copy wins) and serial 2 (luck 5); the worn ring (serial 3, luck 40) is not in the pool. Neck: required (worn, not optional), its only pieces luck −4 and −2. Expected 40 + (−2) = 38.
  const pools = { ring: [mk(1, "ring", { luck: 10 }), mk(1, "ring", { luck: 99 }), mk(2, "ring", { luck: 5 })], neck: [mk(4, "neck", { luck: -4 }), mk(5, "neck", { luck: -2 })] };
  const current = { ring: mk(3, "ring", { luck: 40 }), neck: pools.neck[0]! };
  assert.deepEqual(propertyReach(pools, current, ["ring"], ["ring", "neck"], ["luck"]), { luck: { max: 38, min: -4 } });
});

// ---- the weight scale (weight_dominates)

test("[fast] typicalRange: the registry's typical, else the build's cap in the player's terms, else 15 for a skill bonus, else null", () => {
  const caps = playerCaps({ caps: { physResist: 70, dci: 45, fc: 2, dexBonus: 70, ssi: 0 } });
  assert.equal(typicalRange("physResist", caps), 70);
  assert.equal(typicalRange("dci", caps), 45);
  assert.equal(typicalRange("fc", caps), 2);
  assert.equal(typicalRange("luck", caps), 500);
  assert.equal(typicalRange("dexBonus", caps), 25, "the stat ceiling less the raw stat is a character's limit, not a span");
  assert.deepEqual(["stamPool", "manaPool", "hitsPool"].map((k) => typicalRange(k, caps)), [45, 45, 35], "a pool's span follows its parts");
  assert.equal(typicalRange("sk:magery", caps), 15);
  assert.equal(typicalRange("ssi", caps), null, "a cap of 0 has no span");
  assert.equal(typicalRange("castingFocus", caps), null, "no cap in this build and no typical");
  // a resist cap override, and caps before the buffs rather than after
  assert.equal(typicalRange("fireResist", playerCaps({ caps: { fireResist: 0 }, resistCapOverrides: { fireResist: { cap: 95, shard: 70 } } })), 95);
  assert.equal(typicalRange("dci", playerCaps({ caps: { dci: 30 }, buffs: { caps: { dci: 45 } } })), 45);
});

// A melee main: Resisting Spells 100 (a minimum of 40), luck weight 3, the totals of a suit like the one found. `full` is a pool that reaches no more than the suit has, so the thin-suit guard passes.
const meleeWeights = { physResist: 6, fireResist: 6, coldResist: 6, poisonResist: 6, energyResist: 6, dci: 10, hci: 10, ssi: 8, di: 6, hpRegen: 4, dexBonus: 4, strBonus: 3, hpi: 3, stamRegen: 3, stamInc: 2, lmc: 1, luck: 3, tagPenalty: -25 };
const meleeCaps = { physResist: 70, fireResist: 70, coldResist: 70, poisonResist: 70, energyResist: 70, hci: 45, dci: 45, ssi: 60, di: 100, lmc: 40, hpRegen: 18, stamRegen: 24, hpi: 25 };
const meleeAfter: Record<string, number> = { physResist: 65, fireResist: 65, coldResist: 70, poisonResist: 70, energyResist: 70, dci: 47, hci: 45, ssi: 45, di: 100, hpRegen: 10, dexBonus: 14, strBonus: 10, hpi: 10, stamRegen: 6, stamInc: 1, lmc: 5, luck: 655, tagPenalty: 3 };
const meleeMain = (weights: Record<string, number> = meleeWeights): DiagnosticsProfile => ({ weights, caps: meleeCaps, mins: { physResist: 40, fireResist: 40, coldResist: 40, poisonResist: 40, energyResist: 40 } });
const full = (after: Record<string, number>): Record<string, { max: number }> => Object.fromEntries(Object.entries(after).map(([k, v]) => [k, { max: v }]));

test("[fast] weight_dominates: luck at weight 3 on a melee main's suit, and nothing else; Set weight to the others' median, 0.8", () => {
  const d = weightDiagnostics(meleeMain(), meleeAfter, full(meleeAfter));
  assert.deepEqual(d.map((x) => [x.code, x.level, x.property, x.actions]), [["weight_dominates", "warn", "luck", [{ kind: "setWeight", property: "luck", value: 0.8 }]]]);
  // the others' worths: resists 6 × 70 = 420 (five of them), DCI and HCI 450, SSI 480, DI 600 ... median 420
  assert.deepEqual(d[0]!.values, { weight: 3, typical: 500, share: 33, ratio: 3.6, median: 420, suggested: 0.8 });
  assert.equal(d[0]!.message, "Luck makes up 33% of this suit's score: at weight 3, 500 Luck is worth as much as 3.6 times the median of your other weights. Try 0.8.");
  // the result's list carries it, with the pool's per-slot bound as the reach
  const pools = { ring: [mk(1, "ring", meleeAfter)] }, slots = { slots: ["ring"], optionalSlots: ["ring"] };
  assert.deepEqual(resultDiagnostics({ pools, ...slots, profile: meleeMain(), result: { totals: { after: meleeAfter } } }).map((x) => x.code), ["weight_dominates"]);
  // at the suggested weight it no longer dominates
  assert.deepEqual(weightDiagnostics(meleeMain({ ...meleeWeights, luck: 0.8 }), meleeAfter, full(meleeAfter)), []);
});

test("[fast] weight_dominates compares with the OTHER weights: two properties can flag, one can't", () => {
  const after = { luck: 500, dci: 40 };
  const d = weightDiagnostics({ weights: { luck: 3, dci: 1 }, caps: { dci: 45 } }, after, full(after));
  assert.deepEqual(d.map((x) => [x.property, x.values!.ratio, x.values!.suggested]), [["luck", 33.3, 0.09]]);
  assert.deepEqual(weightDiagnostics({ weights: { luck: 3 } }, { luck: 500 }, full({ luck: 500 })), [], "alone, there is nothing to compare it with");
});

test("[fast] weight_dominates stays quiet on a balanced profile, zero weights and negative weights", () => {
  const r = full(meleeAfter);
  assert.deepEqual(weightDiagnostics(meleeMain({ ...meleeWeights, luck: 1 }), meleeAfter, r), [], "balanced");
  assert.deepEqual(weightDiagnostics(meleeMain({ ...meleeWeights, luck: 0 }), meleeAfter, r), [], "a zero weight is no weight");
  assert.deepEqual(weightDiagnostics(meleeMain(Object.fromEntries(Object.keys(meleeWeights).map((k) => [k, 0]))), meleeAfter, r), [], "all zero");
  assert.deepEqual(weightDiagnostics(meleeMain({ ...meleeWeights, luck: -3 }), meleeAfter, r), [], "a negative weight never dominates");
  // a negative weight is left out of the median but its term still counts toward the score: a big one dilutes luck's share
  assert.equal(weightDiagnostics(meleeMain({ ...meleeWeights, intBonus: -1000 }), { ...meleeAfter, intBonus: 5 }, r).length, 0);
  assert.equal(weightDiagnostics(meleeMain({ ...meleeWeights, intBonus: -1000 }), meleeAfter, r).length, 1, "an intBonus of 0 adds nothing");
  assert.deepEqual(weightDiagnostics({ weights: { luck: 3, dci: 1 } }, {}, {}), [], "an empty suit scores 0: nothing to share");
});

test("[fast] weight_dominates needs both thresholds, and a suit that isn't thin", () => {
  assert.deepEqual([DOMINANT_WORTH, DOMINANT_SHARE, THIN_SUIT], [3, 0.25, 0.5]);
  const r = full(meleeAfter);
  // worth 3.6 times the median, but little luck on the suit: under a quarter of the score
  assert.deepEqual(weightDiagnostics(meleeMain(), { ...meleeAfter, luck: 100 }, r), []);
  // most of the score, but worth under 3 times the median (weight 2: 1,000 is 2.4 times 420)
  assert.deepEqual(weightDiagnostics(meleeMain({ ...meleeWeights, luck: 2 }), { ...meleeAfter, luck: 2000 }, full({ ...meleeAfter, luck: 2000 })), []);
  // exactly 3 times the median counts: weight 2.52 is worth 1,260
  assert.equal(weightDiagnostics(meleeMain({ ...meleeWeights, luck: 2.52 }), meleeAfter, r)[0]!.values!.ratio, 3);
  // a suit of luck alone, from a pool that reaches the melee main's whole suit: with no Resisting Spells minimum it scores 37% of what the pool could give, so it is thin and quiet; from a pool that reaches only that suit, luck is flagged
  const luckOnly = { luck: 655 }, noMinimum: DiagnosticsProfile = { weights: meleeWeights, caps: meleeCaps };
  assert.deepEqual(weightDiagnostics(noMinimum, luckOnly, r), []);
  assert.equal(weightDiagnostics(noMinimum, luckOnly, full(luckOnly))[0]!.property, "luck");
  // the minimum's 40 on every resist counts toward the suit's score, so the same suit is no longer thin
  assert.equal(weightDiagnostics(meleeMain(), luckOnly, r)[0]!.property, "luck");
});

test("[fast] the suggested weight is the others' median worth over the typical range, to one significant figure", () => {
  assert.equal(suggestedWeight(420, 500), 0.8);
  assert.equal(suggestedWeight(100, 300), 0.3);
  assert.equal(suggestedWeight(1234, 100), 10);
  assert.equal(suggestedWeight(48, 500), 0.1);
  assert.equal(suggestedWeight(450, 45), 10);
  assert.equal(suggestedWeight(420, 15), 30);
});

// The demo data (app/fixtures/demo-*.json) folded, and a shipped template planned for one of its characters with that character's own pools.
const demoScan = (name: string): ScanV2 => upgradeScan(JSON.parse(readFileSync(new URL(`./fixtures/demo-${name}.json`, import.meta.url), "utf8")), { shard: "uoalive" }) as ScanV2;
const demoInv = foldSnapshots([demoScan("Kestrel"), demoScan("Dorran")]);
function demoCell(who: string, template: string) {
  const c = demoInv.characters[who]!;
  const { pools, current } = buildPools(demoInv, who, { excludeGargoyle: true, strength: Number(c.stats?.str ?? 125) });
  return { pools, current, optionalSlots: optionalSlotsFor(current, []), profile: plannedProfile({ ...defaultProfiles.templates[template]!, race: "human" }, c, null) };
}

test("[fast] weight_dominates: the archer template on a thin suit (a weapon only, low resists) is quiet, though its median is low", () => {
  const c = demoCell("Kestrel", "archer");
  const weaponOnly = { di: 40, ssi: 10, hci: 5, luck: 100 };
  const lowResists = { physResist: 30, fireResist: 10, coldResist: 10, poisonResist: 10, energyResist: 10, di: 100, ssi: 30, hci: 15 };
  for (const after of [weaponOnly, lowResists]) {
    assert.deepEqual(resultDiagnostics({ ...c, result: { totals: { after } } }).filter((d) => d.code === "weight_dominates"), []);
    // it is the thin-suit guard that keeps it quiet: against a pool that reaches only this suit, DI would be flagged
    assert.ok(weightDiagnostics(c.profile, after, full(after)).some((d) => d.property === "di"));
  }
});

test("[fast] weight_dominates: every shipped template on the demo characters' full suits flags nothing", () => {
  for (const who of ["Kestrel", "Dorran"]) for (const template of templateNames) {
    const c = demoCell(who, template);
    const result = core.optimizeSuit(c.pools as unknown as OptPools, c.current as never, c.profile, { seed: 1, restarts: 20, optionalSlots: c.optionalSlots });
    assert.deepEqual(resultDiagnostics({ ...c, result }).filter((d) => d.code === "weight_dominates").map((d) => d.message), [], `${who} ${template}`);
  }
});

test("[fast] the page: Set weight's words, and it applies only while the panel holds the weight the build ran with", () => {
  const setLuck = { kind: "setWeight", property: "luck", value: 0.8 } as const;
  assert.equal(handledAction(setLuck), true);
  assert.deepEqual(actionWords(setLuck), { label: "Set Luck to 0.8", done: "Set ✓", toast: "Luck weight set to 0.8. Build again to use it.", stale: "The weight changed since this build, so this no longer applies." });
  const p: { weights?: Record<string, number> } = { weights: { luck: 3, dci: 10 } };
  applyAction(p, setLuck, 3);
  assert.deepEqual(p, { weights: { luck: 0.8, dci: 10 } });
  // changed since the build (0.5): left alone; removed since: not put back; no build weight known: no button
  const changed = { weights: { luck: 0.5 } }, removed: { weights: Record<string, number> } = { weights: {} };
  assert.deepEqual([actionApplies(changed, setLuck, 3), actionApplies(removed, setLuck, 3), actionApplies({ weights: { luck: 3 } }, setLuck)], [false, false, false]);
  applyAction(changed, setLuck, 3); applyAction(removed, setLuck, 3);
  assert.deepEqual([changed, removed], [{ weights: { luck: 0.5 } }, { weights: {} }]);
});

// ---- swing (issue #217 PR 3)
const SWING = { speed: 3.5, stamina: 89, ssi: 45, share: 0, seconds: 2, steps: [{ seconds: 2.5, ssi: 1 }, { seconds: 2.25, ssi: 12 }, { seconds: 2, ssi: 24 }, { seconds: 1.75, ssi: 51 }] };

test("[fast] swing_linear: steps asked for but the weapon is not fixed, with Lock for the hand the suit's weapon is in when it is the worn one", () => {
  const axe = { ...mk(1, "twoHanded", { ssi: 20 }, true), speed: 3.25 }, sword = { ...mk(2, "oneHanded", { ssi: 20 }), speed: 3.5 };
  const profile: DiagnosticsProfile = { swing: { steps: true } };
  const two = resultDiagnostics({ profile, current: { twoHanded: axe }, result: { best: { twoHanded: axe } }, swingNote: "the pool holds weapons with 2 different speeds" });
  assert.deepEqual(two.map((d) => [d.code, d.level, d.actions]), [["swing_linear", "warn", [{ kind: "lockSlot", slot: "twoHanded" }]]]);
  assert.equal(two[0]!.message, "SSI was scored per point: the pool holds weapons with 2 different speeds. Lock the weapon slot to score swing speed by step.");
  assert.deepEqual(resultDiagnostics({ profile, current: { oneHanded: sword }, result: { best: { oneHanded: sword } }, swingNote: "x" })[0]!.actions, [{ kind: "lockSlot", slot: "oneHanded" }]);
  // a lock keeps what is worn: with another weapon worn there, the sentence says to equip the suit's first
  const other = resultDiagnostics({ profile, current: { oneHanded: { ...sword, serial: 9 } }, result: { best: { oneHanded: sword } }, swingNote: "x" })[0]!;
  assert.deepEqual([other.message, other.actions], ["SSI was scored per point: x. Equip the weapon you want and lock its slot to score swing speed by step.", []]);
  const none = resultDiagnostics({ profile, result: { best: {} }, swingNote: "no weapon in the pool has a known speed" });
  assert.deepEqual(none[0]!.actions, [], "no weapon to lock");
  assert.deepEqual(resultDiagnostics({ profile, result: { best: { oneHanded: sword } } }), [], "steps were used: nothing to say");
});

test("[fast] swing_next_step: steps off and the next faster step within 10 SSI, with the stamina half only when a band up reaches it", () => {
  const off: DiagnosticsProfile = { swing: { steps: false } };
  const [d] = resultDiagnostics({ profile: off, result: { swing: SWING } });
  assert.equal(d!.code, "swing_next_step");
  assert.equal(d!.level, "info");
  assert.equal(d!.message, "SSI 45 swings every 2.0 s at this suit's stamina (89). 51 would make it 1.75 s, and so would 1 more stamina.");
  assert.deepEqual(d!.actions, [{ kind: "swingSteps", on: true }, { kind: "setFloor", property: "ssi", value: 51 }]);
  assert.deepEqual(d!.values, { ssi: 45, seconds: 2, stamina: 89, next: 51, nextSeconds: 1.75, moreStamina: 1 });
  // at stamina 50 the next band (60) still swings at 2.0 s with 45: no stamina half
  const low = { ...SWING, stamina: 50 };
  assert.equal(resultDiagnostics({ profile: off, result: { swing: low } })[0]!.message, "SSI 45 swings every 2.0 s at this suit's stamina (50). 51 would make it 1.75 s.");
  assert.deepEqual(resultDiagnostics({ profile: { swing: { steps: true } }, result: { swing: SWING } }), [], "steps on: quiet");
  assert.deepEqual(resultDiagnostics({ profile: off, result: { swing: { ...SWING, ssi: 40 } } }), [], "11 away: quiet");
  assert.deepEqual(resultDiagnostics({ profile: off, result: { swing: { ...SWING, ssi: 60, seconds: 1.75 } } }), [], "no faster step within the cap: quiet");
  assert.deepEqual(resultDiagnostics({ profile: {}, result: {} }), [], "no swing (no character or no weapon): quiet");
});

test("[fast] the page: the swing actions' words, when they apply and their edits; Next step and the swing line", () => {
  const p: { floors: Record<string, number>; softFloors: string[]; swingSteps?: boolean; lockedSlots?: string[] } = { floors: { ssi: 40 }, softFloors: [] };
  const on = { kind: "swingSteps", on: true } as const, lock = { kind: "lockSlot", slot: "oneHanded" } as const, step = { kind: "setFloor", property: "ssi", value: 51 } as const;
  assert.ok([on, lock, step].every(handledAction));
  assert.equal(actionWords(on).label, "Score swing speed by step");
  assert.equal(actionWords(lock).label, "Lock Weapon (1H)");
  assert.equal(actionWords(step, "swing_next_step").label, "SSI floor 51 (soft)");
  assert.equal(actionWords(step, "floor_unreachable").label, "Lower to 51");
  // a step's floor raises the requirement, or adds it; Lower never raises one
  assert.equal(actionApplies(p, step, undefined, "swing_next_step"), true);
  assert.equal(actionApplies(p, step, undefined, "floor_unreachable"), false);
  applyAction(p, step, undefined, "swing_next_step");
  assert.equal(p.floors.ssi, 51);
  assert.deepEqual(p.softFloors, ["ssi"], "a step's requirement goes in soft, so it can't conflict with the hard ones");
  assert.equal(actionApplies(p, step, undefined, "swing_next_step"), false, "already there");
  const bare: { floors?: Record<string, number>; softFloors?: string[] } = {};
  applyAction(bare, step, undefined, "swing_next_step");
  assert.deepEqual(bare, { floors: { ssi: 51 }, softFloors: ["ssi"] });
  applyAction(p, on);
  assert.equal(p.swingSteps, true);
  assert.equal(actionApplies(p, on), false);
  applyAction(p, lock);
  assert.deepEqual(p.lockedSlots, ["oneHanded"]);
  assert.equal(actionApplies(p, lock), false);
  assert.deepEqual(nextSwingStep(SWING), { value: 51, seconds: 1.75, tip: "1.75 s at stamina 89; another suit's stamina can move the step." });
  assert.equal(nextSwingStep({ ...SWING, ssi: 51, seconds: 1.75 }), null);
  const line = swingLines({ ...SWING, ssi: 45, share: 10 }, "Longsword", ["Divine Fury"]);
  assert.equal(line.head, "Longsword 3.5 s · stamina 89 · SSI 45 (+10 Divine Fury) → swings every 2.0 s");
  assert.deepEqual(line.steps, [{ text: "2.5 s ≥ 1", reached: true }, { text: "2.25 s ≥ 12", reached: true }, { text: "2.0 s ≥ 24", reached: true }, { text: "1.75 s ≥ 51", reached: false }]);
  assert.equal(line.out, "1.5 s out of reach");
  assert.equal(swingLines({ ...SWING, steps: [{ seconds: 1.25, ssi: 40 }] }, null).out, null, "1.25 s is the floor");
});

test("[fast] withDiagnostics: the result carries them; a failure leaves the field off (the page then reads unreachableFloors) and is reported, the suit kept", () => {
  const result = { score: 7, unreachableFloors: ["luck"] };
  assert.deepEqual(withDiagnostics(result, () => [], () => assert.fail("no error")), { ...result, diagnostics: [] });
  const errors: unknown[] = [];
  const failed = withDiagnostics(result, () => { throw new Error("boom"); }, (e) => errors.push(e));
  assert.deepEqual(failed, result);
  assert.equal("diagnostics" in failed, false);
  assert.equal(String(errors[0]), "Error: boom");
  assert.equal(resultChecks(failed, false)[0]!.message, "No suit in the pool can reach these requirements: Luck.");
});

test("[fast] weight_dominates with SSI scored by step: SSI's share is the step credit the suit reaches, as the solvers scored it", () => {
  const profile: DiagnosticsProfile = { weights: { ssi: 10, dci: 1, hci: 1, di: 1 }, caps: { ssi: 60, dci: 45, hci: 45, di: 100 } };
  const after = { ssi: 37, stamPool: 0, dci: 10, hci: 10, di: 10 }, reach = { ssi: { max: 40 }, stamPool: { max: 0 }, dci: { max: 10 }, hci: { max: 10 }, di: { max: 10 } };
  const share = (p: DiagnosticsProfile): number | undefined => weightDiagnostics(p, after, reach).find((d) => d.property === "ssi")?.values?.share;
  assert.equal(share(profile), 93, "per point: 370 of 400");
  // the step at 23 SSI is the best 37 reaches: worth 23 points, so 230 of 260
  assert.equal(share({ ...profile, ssiSteps: [{ ssi: 23, stam: -100, credit: 23 }, { ssi: 38, stam: -100, credit: 38 }] }), 88);
});

// Issue #214: the weapon properties a build requires. A locked weapon without them stays (no action unlocks a slot), and no
// weapon with them builds the suit without one; both are warnings with no action.
test("[fast] weaponFlagDiagnostics: a locked weapon that lacks them, and no weapon that has them", () => {
  assert.deepEqual(weaponFlagDiagnostics(["spell channeling"], [], false), []);
  const [kept] = weaponFlagDiagnostics(["spell channeling", "balanced"], [{ slot: "oneHanded", name: "War Axe", missing: ["spell channeling", "balanced"] }], false);
  assert.deepEqual(kept, { code: "weapon_missing_flag", level: "warn", message: "War Axe lacks Spell Channeling and Balanced, but Weapon (1H) is locked, so it stays in the suit.", actions: [] });
  const [none] = weaponFlagDiagnostics(["spell channeling", "balanced"], [], true);
  assert.deepEqual(none, { code: "no_weapon_with_flag", level: "warn", message: "No weapon in your candidate pool has Spell Channeling and Balanced, so the suit is built without one.", actions: [] });
  assert.deepEqual(resultChecks({ diagnostics: [none!] }, false), [none], "the result's Check your settings lists it");
});

// Issue #12: the slots Only containers leaves with nothing from a container; information, no action.
test("[fast] onlyRootsDiagnostics: one line naming the slots, none without any", () => {
  assert.deepEqual(onlyRootsDiagnostics([]), []);
  const [d] = onlyRootsDiagnostics(["helmet", "ring"]);
  assert.deepEqual(d, { code: "only_containers_empty", level: "info", message: "Your Only containers hold nothing for Head and Ring, so the suit takes nothing from them there.", values: { slots: 2 }, actions: [] });
  assert.deepEqual(resultChecks({ diagnostics: [d!] }, false), [d], "the result's Check your settings lists it");
});
