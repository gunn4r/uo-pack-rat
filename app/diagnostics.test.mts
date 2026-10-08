// diagnostics.test.mts — `app/diagnostics.mts` and the per-slot bound it shares with the MIP (`app/mip.mts` propertyReach, issue #217): propertyReach gives the numbers the bound inside buildSuitMip used to compute (a copy of that code is the reference, over fuzzed pools with two-handers, required slots and negative values) and BuiltMip.reach is the same; `floor_unreachable` for a floor one above the bound (hard: Lower and Make soft; soft: info, Lower only), none for a floor exactly at it (which keeps its hard row); best possible in the player's terms (Resisting Spells, a buff's share, the cap), a buff that lifts reach over a floor; `floors_conflict` on the floors the suit misses, on the heuristic path and on HiGHS's; an empty inventory; the weight scale: `typicalRange` (registry, cap, Resisting Spells, skill bonuses), `weight_dominates` on a Fury-like suit (luck at weight 3, suggested 0.8) and quiet on a balanced profile, a one-property profile, zero and negative weights, each threshold alone, the suggested weight's rounding; and the page's side (`ui/builder-model.mts`): an action's words and edit (Set weight included), the weight rows' worth hint, and a saved run without `diagnostics` drawn from `unreachableFloors`. All `[fast]`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { propertyReach, buildSuitMip, type BuiltMip } from "./mip.mts";
import { preBuildDiagnostics, resultDiagnostics, weightDiagnostics, suggestedWeight, DOMINANT_SHARE, DOMINANT_WORTH, type DiagnosticsProfile } from "./diagnostics.mts";
import { solveExact, type OptPools } from "./exact-solver.mts";
import { core, type OptOptions } from "./solver-fixture.mts";
import { actionWords, applyAction, handledAction, resultChecks, weightWorth } from "./ui/builder-model.mts";
import { playerCaps, typicalRange, type OptItem } from "./vault-lib.mts";

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
  assert.deepEqual(hard, { code: "floor_unreachable", level: "warn", property: "ssi", message: "SSI 36 can't be reached with your inventory (best possible: 35).",
    values: { floor: 36, best: 35 }, actions: [{ kind: "setFloor", property: "ssi", value: 35 }, { kind: "makeSoft", property: "ssi" }] });
  const soft = preBuildDiagnostics({ pools: ssiPools, ...ssiSlots, profile: ssiProfile(36, { hardFloors: [] }) });
  assert.deepEqual(soft.map((d) => [d.level, d.actions]), [["info", [{ kind: "setFloor", property: "ssi", value: 35 }]]]);
  // the result's list starts with the same ones
  const res = resultDiagnostics({ pools: ssiPools, ...ssiSlots, profile: ssiProfile(36), result: { totals: { after: { ssi: 35 } } } });
  assert.deepEqual(res, [hard]);
});

test("[fast] best possible is in the player's terms: the cap, the Resisting Spells bonus, a buff's share", () => {
  // the cap bounds it: a bound of 35 under a cap of 30
  assert.equal(preBuildDiagnostics({ pools: ssiPools, ...ssiSlots, profile: ssiProfile(40, { caps: { ssi: 30 } }) })[0]!.values!.best, 30);
  // a resist: item floor 40 is a paperdoll floor of 50 with Resisting Spells' +10; the pool reaches 35, so 45 on the paperdoll
  const res = { ring: [mk(1, "ring", { physResist: 20 })], neck: [mk(2, "neck", { physResist: 15 })] };
  const [phys] = preBuildDiagnostics({ pools: res, ...ssiSlots, profile: { floors: { physResist: 40 }, caps: { physResist: 60 }, hardFloors: ["physResist"], resistBonus: 10 } });
  assert.deepEqual(phys!.values, { floor: 50, best: 45 });
  // Divine Fury's +10 SSI: the player's floor of 60 is 50 from gear; the pool's 35 is 45 with the buff
  const [ssi] = preBuildDiagnostics({ pools: ssiPools, ...ssiSlots, profile: ssiProfile(50, { caps: { ssi: 50 }, buffs: { floors: { ssi: 60 } } }) });
  assert.deepEqual([ssi!.values, ssi!.message], [{ floor: 60, best: 45 }, "SSI 60 can't be reached with your inventory (best possible: 45)."]);
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
    assert.match(d[0]!.message, /can be reached, but not together with your other hard requirements: this suit has -?\d+\./);
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
  assert.deepEqual(actionWords(lowerTo), { label: "Lower to 55", done: "Lowered ✓", toast: "SSI requirement lowered to 55. Build again to use it." });
  assert.deepEqual(actionWords(soft), { label: "Make soft", done: "Made soft ✓", toast: "SSI requirement is soft now. Build again to use it." });
  const p: { floors?: Record<string, number>; softFloors?: string[] } = { floors: { ssi: 60 } };
  applyAction(p, lowerTo); applyAction(p, soft); applyAction(p, soft);
  assert.deepEqual(p, { floors: { ssi: 55 }, softFloors: ["ssi"] });
  assert.equal(handledAction({ kind: "swingSteps", on: true }), false, "later PRs' actions get no button yet");
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

// ---- the weight scale

test("[fast] typicalRange: the registry's typical, else the build's cap in the player's terms, else 15 for a skill bonus, else null", () => {
  // a Resisting Spells bonus of 20 leaves an item-total resist cap of 50, which is 70 on the paperdoll
  const caps = playerCaps({ caps: { physResist: 50, dci: 45, fc: 2, dexBonus: 70, ssi: 0 }, resistBonus: 20 });
  assert.equal(typicalRange("physResist", caps), 70);
  assert.equal(typicalRange("dci", caps), 45);
  assert.equal(typicalRange("fc", caps), 2);
  assert.equal(typicalRange("luck", caps), 500);
  assert.equal(typicalRange("dexBonus", caps), 25, "the stat ceiling less the raw stat is a character's limit, not a span");
  assert.equal(typicalRange("sk:magery", caps), 15);
  assert.equal(typicalRange("ssi", caps), null, "a cap of 0 has no span");
  assert.equal(typicalRange("castingFocus", caps), null, "no cap in this build and no typical");
  // a resist cap override, and caps before the buffs rather than after
  assert.equal(typicalRange("fireResist", playerCaps({ caps: { fireResist: 0 }, resistBonus: 20, resistCapOverrides: { fireResist: { cap: 95, shard: 70 } } })), 95);
  assert.equal(typicalRange("dci", playerCaps({ caps: { dci: 30 }, buffs: { caps: { dci: 45 } } })), 45);
});

// Fury before tuning: Resisting Spells +20 (item resist caps 50), luck weight 3, the totals of a suit like the one found.
const furyWeights = { physResist: 6, fireResist: 6, coldResist: 6, poisonResist: 6, energyResist: 6, dci: 10, hci: 10, ssi: 8, di: 6, hpRegen: 4, dexBonus: 4, strBonus: 3, hpi: 3, stamRegen: 3, stamInc: 2, lmc: 1, luck: 3, tagPenalty: -25 };
const furyCaps = { physResist: 50, fireResist: 50, coldResist: 50, poisonResist: 50, energyResist: 50, hci: 45, dci: 45, ssi: 60, di: 100, lmc: 40, hpRegen: 18, stamRegen: 24, hpi: 25 };
const furyAfter = { physResist: 45, fireResist: 45, coldResist: 50, poisonResist: 50, energyResist: 50, dci: 47, hci: 45, ssi: 45, di: 100, hpRegen: 10, dexBonus: 14, strBonus: 10, hpi: 10, stamRegen: 6, stamInc: 1, lmc: 5, luck: 655, tagPenalty: 3 };
const fury = (weights: Record<string, number> = furyWeights): DiagnosticsProfile => ({ weights, caps: furyCaps, resistBonus: 20 });

test("[fast] weight_dominates: luck at weight 3 on a Fury-like suit, and nothing else; Set weight to the median's 0.8", () => {
  const d = weightDiagnostics(fury(), furyAfter);
  assert.deepEqual(d.map((x) => [x.code, x.level, x.property, x.actions]), [["weight_dominates", "warn", "luck", [{ kind: "setWeight", property: "luck", value: 0.8 }]]]);
  // worths: resists 6 × 70 = 420 (five of them), DCI and HCI 450, SSI 480, DI 600, luck 1,500 ... median 420
  assert.deepEqual(d[0]!.values, { weight: 3, typical: 500, share: 36, ratio: 3.6, median: 420, suggested: 0.8 });
  assert.equal(d[0]!.message, "Luck makes up 36% of this suit's score: at weight 3, 500 Luck is worth as much as 3.6 times a typical property. Try 0.8.");
  // the result's list carries it, after the floor ones
  const res = resultDiagnostics({ pools: {}, current: {}, profile: fury(), result: { totals: { after: furyAfter } } });
  assert.deepEqual(res.map((x) => x.code), ["weight_dominates"]);
  // at the suggested weight it no longer dominates
  assert.deepEqual(weightDiagnostics(fury({ ...furyWeights, luck: 0.8 }), furyAfter), []);
});

test("[fast] weight_dominates stays quiet on a balanced profile, a one-property profile, zero weights and negative weights", () => {
  assert.deepEqual(weightDiagnostics(fury({ ...furyWeights, luck: 1 }), furyAfter), [], "balanced");
  assert.deepEqual(weightDiagnostics(fury({ luck: 3 }), furyAfter), [], "alone, a property is its own median");
  assert.deepEqual(weightDiagnostics(fury({ ...furyWeights, luck: 0 }), furyAfter), [], "a zero weight is no weight");
  assert.deepEqual(weightDiagnostics(fury(Object.fromEntries(Object.keys(furyWeights).map((k) => [k, 0]))), furyAfter), [], "all zero");
  assert.deepEqual(weightDiagnostics(fury({ ...furyWeights, luck: -3 }), furyAfter), [], "a negative weight never dominates");
  // a negative weight is left out of the median but its term still counts toward the score: a big one dilutes luck's share
  assert.equal(weightDiagnostics(fury({ ...furyWeights, intBonus: -1000 }), { ...furyAfter, intBonus: 5 }).length, 0);
  assert.equal(weightDiagnostics(fury({ ...furyWeights, intBonus: -1000 }), furyAfter).length, 1, "an intBonus of 0 adds nothing");
  assert.deepEqual(weightDiagnostics({ weights: { luck: 3 } }, {}), [], "an empty suit scores 0: nothing to share");
});

test("[fast] weight_dominates needs both thresholds: the worth ratio and the share of the score", () => {
  assert.deepEqual([DOMINANT_WORTH, DOMINANT_SHARE], [3, 0.25]);
  // worth 3.6 times the median, but little luck on the suit: under a quarter of the score
  assert.deepEqual(weightDiagnostics(fury(), { ...furyAfter, luck: 100 }), []);
  // most of the score, but worth under 3 times the median (weight 2: 1,000 is 2.4 times 420)
  const d = weightDiagnostics(fury({ ...furyWeights, luck: 2 }), { ...furyAfter, luck: 2000 });
  assert.deepEqual(d, []);
  // exactly 3 times the median counts: weight 2.52 is worth 1,260
  assert.equal(weightDiagnostics(fury({ ...furyWeights, luck: 2.52 }), furyAfter)[0]!.values!.ratio, 3);
});

test("[fast] the suggested weight is the median worth over the typical range, to one significant figure", () => {
  assert.equal(suggestedWeight(420, 500), 0.8);
  assert.equal(suggestedWeight(100, 300), 0.3);
  assert.equal(suggestedWeight(1234, 100), 10);
  assert.equal(suggestedWeight(48, 500), 0.1);
  assert.equal(suggestedWeight(450, 45), 10);
  assert.equal(suggestedWeight(420, 15), 30);
});

test("[fast] the page: the weight rows' worth hint, and Set weight's words and edit", () => {
  const caps = playerCaps({ caps: furyCaps, resistBonus: 20 });
  assert.equal(weightWorth("luck", 3, caps), "= 1,500 per 500 Luck");
  assert.equal(weightWorth("dci", 10, caps), "= 450 per 45 DCI");
  assert.equal(weightWorth("physResist", 6, caps), "= 420 per 70 Phys");
  assert.equal(weightWorth("luck", 0.8, caps), "= 400 per 500 Luck");
  assert.equal(weightWorth("sk:magery", 2, caps), "= 30 per 15 +Magery");
  assert.equal(weightWorth("castingFocus", 2, caps), null, "no typical range");
  const setLuck = { kind: "setWeight", property: "luck", value: 0.8 } as const;
  assert.equal(handledAction(setLuck), true);
  assert.deepEqual(actionWords(setLuck), { label: "Set Luck to 0.8", done: "Set ✓", toast: "Luck weight set to 0.8. Build again to use it." });
  const p: { weights?: Record<string, number> } = { weights: { luck: 3, dci: 10 } };
  applyAction(p, setLuck);
  assert.deepEqual(p, { weights: { luck: 0.8, dci: 10 } });
});
