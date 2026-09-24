import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSuitMip, startVector, pickedOf, noGoodRow, HARD_FLOOR_BONUS, type BuiltMip } from "./mip.mts";
import type { OptItem } from "./vault-lib.mts";

// ---------------------------------------------------------------------------
// Shared fixtures and helpers
// ---------------------------------------------------------------------------

const mkItem = (serial: number, slot: string, props: Record<string, number>, extra: { twoHanded?: true } = {}): OptItem => ({ serial, name: `item${serial}`, slot, props, ...extra });

// The profile from the task brief: two capped positive weights (hci, dci), one uncapped weight
// that can go negative (tagPenalty), one hard floor (lrc) and one soft floor (fc).
const profile = { weights: { hci: 2, dci: 1, tagPenalty: -1 }, caps: { hci: 45, dci: 45 }, floors: { lrc: 100, fc: 2 }, hardFloors: ["lrc"], floorBonus: 1000, floorPartial: 0.5 };

const ringA = mkItem(1, "ring", { hci: 10, dci: 5, tagPenalty: 1, lrc: 70, fc: 3 });
const ringB = mkItem(2, "ring", { hci: 20, dci: 25, tagPenalty: 2, fc: -1 });
const ringC = mkItem(3, "ring", { hci: 1 });                      // the currently worn ring, NOT in the pool
const braceletA = mkItem(11, "bracelet", {});
const oneHandedA = mkItem(21, "oneHanded", { hci: 5 });
const twoHandedA = mkItem(22, "twoHanded", { hci: 5 }, { twoHanded: true });
const neckWorn = mkItem(31, "neck", { lrc: 40 });                 // worn, no pool at all

const pools = { ring: [ringA, ringB], bracelet: [braceletA], oneHanded: [oneHandedA], twoHanded: [twoHandedA] };
const current = { ring: ringA, neck: neckWorn, bracelet: braceletA };
const slots = ["ring", "neck", "bracelet", "oneHanded", "twoHanded"];
const optionalSlots = ["ring", "oneHanded", "twoHanded"];        // neck and bracelet are required

function build(overrides: Partial<Parameters<typeof buildSuitMip>[0]> = {}): BuiltMip {
  return buildSuitMip({ pools, current, profile, slots, optionalSlots, ...overrides });
}

// A structural check applied to every built model in this file: the CSR arrays are internally
// consistent and every column reference is in range.
function assertWellFormed(built: BuiltMip): void {
  const { starts, indices, values, numCols } = built.model.matrix;
  assert.equal(starts.length, built.model.numRows + 1, "starts.length === numRows + 1");
  assert.equal(starts.at(-1), indices.length, "starts.at(-1) === indices.length");
  assert.equal(indices.length, values.length, "indices.length === values.length");
  for (const j of indices) assert.ok(j >= 0 && j < numCols, `column index ${j} in range`);
}

function xCol(built: BuiltMip, slot: string, serial: number): number | undefined {
  return built.xIndex[slot]!.find((j) => built.cols[j]!.item!.serial === serial);
}
function colOfDim(built: BuiltMip, dim: string, kind: string): number {
  return built.cols.findIndex((c) => c.dim === dim && c.kind === kind);
}
// The dense row checker the brief asks for: every row's Σ(coeff·vec) sits inside its bounds.
function checkRows(built: BuiltMip, vec: Float64Array): void {
  const { matrix, rowLower, rowUpper, numRows } = built.model;
  for (let r = 0; r < numRows; r++) {
    let sum = 0;
    for (let k = matrix.starts[r]!; k < matrix.starts[r + 1]!; k++) sum += matrix.values[k]! * vec[matrix.indices[k]!]!;
    assert.ok(sum >= rowLower[r]! - 1e-9 && sum <= rowUpper[r]! + 1e-9, `row ${r} sum ${sum} not in [${rowLower[r]}, ${rowUpper[r]}]`);
  }
}

// ---------------------------------------------------------------------------
// Column bookkeeping
// ---------------------------------------------------------------------------

test("[fast] mip: one x per candidate per slot, and integrality is 1 for x/y and 0 for c/s", () => {
  const built = build();
  assertWellFormed(built);
  assert.equal(built.xIndex.ring!.length, pools.ring.length);      // current.ring (ringA) is already in the pool: no extra append
  for (const kind of ["x", "y"]) for (const c of built.cols.filter((c) => c.kind === kind)) assert.equal(built.model.integrality[built.cols.indexOf(c)], 1);
  for (const kind of ["c", "s"]) for (const c of built.cols.filter((c) => c.kind === kind)) assert.equal(built.model.integrality[built.cols.indexOf(c)], 0);
});

test("[fast] mip: a worn candidate absent from the pool is appended (keep-what-you-wear)", () => {
  const built = build({ current: { ...current, ring: ringC } });
  assertWellFormed(built);
  assert.equal(built.xIndex.ring!.length, pools.ring.length + 1);
  const j = xCol(built, "ring", ringC.serial);
  assert.ok(j !== undefined);
  assert.equal(built.cols[j!]!.item!.serial, ringC.serial);
});

// A slot with no pool of its own but a worn piece gets exactly one candidate: the worn item,
// as a single x column. Whether that column is forced (required slot) or merely available
// (optional slot) is entirely down to the slot's own row — there is no separate "fixed" concept.
test("[fast] mip: a slot with no pool but a worn piece gets one x column, forced to 1 when the slot is required", () => {
  const built = build();
  assertWellFormed(built);
  assert.equal(built.xIndex.neck!.length, 1);
  const j = built.xIndex.neck![0]!;
  assert.equal(built.cols[j]!.item!.serial, neckWorn.serial);
  const rowIdxFor = (b: BuiltMip, jj: number): number => {
    const { matrix } = b.model;
    for (let r = 0; r < b.model.numRows; r++) {
      const start = matrix.starts[r]!, end = matrix.starts[r + 1]!;
      if (end - start === 1 && matrix.indices[start] === jj) return r;
    }
    return -1;
  };
  const rowIdx = rowIdxFor(built, j);
  assert.equal(built.model.rowLower[rowIdx], 1);   // required (neck not in optionalSlots) + worn => forced to 1
  assert.equal(built.model.rowUpper[rowIdx], 1);

  const optionalBuilt = build({ optionalSlots: [...optionalSlots, "neck"] });
  const j2 = optionalBuilt.xIndex.neck![0]!;
  const rowIdx2 = rowIdxFor(optionalBuilt, j2);
  assert.equal(optionalBuilt.model.rowLower[rowIdx2], -Infinity);   // optional: the same lone candidate is merely available
  assert.equal(optionalBuilt.model.rowUpper[rowIdx2], 1);
});

// ---------------------------------------------------------------------------
// Weights: capped (c column) vs. uncapped (aggregated into x cost)
// ---------------------------------------------------------------------------

test("[fast] mip: a capped positive weight makes a c column and a matching row", () => {
  const built = build();
  assertWellFormed(built);
  const cHci = colOfDim(built, "hci", "c");
  assert.ok(cHci >= 0);
  assert.equal(built.model.colCost[cHci], profile.weights.hci);
  assert.equal(built.model.colLower[cHci], -Infinity);
  assert.equal(built.model.colUpper[cHci], profile.caps.hci);
  // find the row through matrix.starts: the one row containing the c column
  const { matrix } = built.model;
  let rowIdx = -1;
  for (let r = 0; r < built.model.numRows && rowIdx < 0; r++) for (let k = matrix.starts[r]!; k < matrix.starts[r + 1]!; k++) if (matrix.indices[k] === cHci) rowIdx = r;
  assert.ok(rowIdx >= 0);
  assert.equal(built.model.rowUpper[rowIdx], 0);
  const start = matrix.starts[rowIdx]!, end = matrix.starts[rowIdx + 1]!;
  const coeffOf = (j: number): number => { for (let k = start; k < end; k++) if (matrix.indices[k] === j) return matrix.values[k]!; return 0; };
  assert.equal(coeffOf(cHci), 1);
  assert.equal(coeffOf(xCol(built, "ring", ringA.serial)!), -ringA.props.hci!);
  assert.equal(coeffOf(xCol(built, "ring", ringB.serial)!), -ringB.props.hci!);
  assert.equal(coeffOf(xCol(built, "oneHanded", oneHandedA.serial)!), -oneHandedA.props.hci!);
});

test("[fast] mip: an uncapped weight (tagPenalty) lands in colCost of each x; model.offset is always 0", () => {
  const built = build();
  assertWellFormed(built);
  assert.equal(built.model.colCost[xCol(built, "ring", ringA.serial)!], profile.weights.tagPenalty * ringA.props.tagPenalty!);
  assert.equal(built.model.colCost[xCol(built, "ring", ringB.serial)!], profile.weights.tagPenalty * ringB.props.tagPenalty!);
  assert.equal(colOfDim(built, "tagPenalty", "c"), -1);                 // never a capped column
  assert.equal(built.model.offset, 0);
});

// w·min(t, cap) with w < 0 is convex, so maximising it needs c pinned to min(t, cap) from below too:
// a binary z with c ≥ t − M1·z and c ≥ cap − M2·(1 − z). This used to throw "non-concave" and fail
// the whole job, although the page lets a player enter a negative weight on any capped property.
test("[fast] mip: a negative weight with a finite cap adds a z column pinning c to min(t, cap)", () => {
  const rings = [mkItem(1, "ring", { dci: 10 }), mkItem(2, "ring", { dci: -4 })];
  const neck = [mkItem(3, "neck", { dci: 12 })];
  const built = buildSuitMip({ pools: { ring: rings, neck }, current: {}, profile: { weights: { dci: -1 }, caps: { dci: 15 }, floors: {} } });
  assertWellFormed(built);
  const cc = built.capCols.dci!;
  assert.equal(built.cols[cc.col]!.kind, "c");
  assert.equal(built.model.colCost[cc.col], -1);
  assert.ok(cc.z != null && built.cols[cc.z]!.kind === "z" && built.model.integrality[cc.z] === 1);
  // every suit's start vector (c = min(t, cap), z = t ≥ cap) satisfies every row
  for (const ring of [null, ...rings]) for (const nk of [null, ...neck]) {
    const assignment = { ...(ring ? { ring } : {}), ...(nk ? { neck: nk } : {}) };
    const t = (ring?.props.dci ?? 0) + (nk?.props.dci ?? 0);
    const vec = startVector(built, assignment);
    assert.equal(vec[cc.col], Math.min(t, 15));
    checkRows(built, vec);
  }
});

// ---------------------------------------------------------------------------
// Floors: hard, soft, unreachable, negative-value guard, hardAsSoft
// ---------------------------------------------------------------------------

test("[fast] mip: a reachable hard floor makes one row and counts HARD_FLOOR_BONUS into scoreOffset", () => {
  const built = build();
  assertWellFormed(built);
  assert.deepEqual(built.unreachableFloors, []);
  const rowIdx = built.hardRows.lrc;
  assert.ok(rowIdx !== undefined);
  assert.equal(built.model.rowLower[rowIdx!], profile.floors.lrc);
  assert.equal(built.model.rowUpper[rowIdx!], Infinity);
  assert.equal(built.scoreOffset, HARD_FLOOR_BONUS);
  assert.equal(colOfDim(built, "lrc", "y"), -1);                  // a hard, reachable floor gets a plain row, no y/s
});

test("[fast] mip: a soft floor makes y,s columns with costs bonus,1 and the three documented rows", () => {
  const built = build();
  assertWellFormed(built);
  const f = profile.floors.fc, bonus = profile.floorBonus, partial = profile.floorPartial;
  const k = (bonus * partial) / f, sMax = bonus * partial;
  const yJ = colOfDim(built, "fc", "y"), sJ = colOfDim(built, "fc", "s");
  assert.ok(yJ >= 0 && sJ >= 0);
  assert.equal(built.model.colCost[yJ], bonus);
  assert.equal(built.model.colCost[sJ], 1);
  assert.equal(built.model.colUpper[sJ], sMax);
  const { matrix } = built.model;
  const rowsOf = (j: number): number[] => { const out: number[] = []; for (let r = 0; r < built.model.numRows; r++) for (let k2 = matrix.starts[r]!; k2 < matrix.starts[r + 1]!; k2++) if (matrix.indices[k2] === j) out.push(r); return out; };
  const coeffIn = (r: number, j: number): number => { for (let k2 = matrix.starts[r]!; k2 < matrix.starts[r + 1]!; k2++) if (matrix.indices[k2] === j) return matrix.values[k2]!; return 0; };
  // the "met" row t ≥ f·y, as t − (f − minReach)·y ≥ minReach (ringB's fc −1 makes minReach −1)
  const minReach = -1;
  const yRow = rowsOf(yJ).find((r) => coeffIn(r, yJ) < 0)!;
  assert.equal(built.model.rowLower[yRow], minReach);
  assert.equal(built.model.rowUpper[yRow], Infinity);
  assert.equal(coeffIn(yRow, yJ), -(f - minReach));
  const boundRow = rowsOf(yJ).find((r) => coeffIn(r, yJ) === sMax)!;
  assert.equal(coeffIn(boundRow, sJ), 1);
  assert.equal(built.model.rowUpper[boundRow], sMax);
  const kRow = rowsOf(sJ).find((r) => coeffIn(r, xCol(built, "ring", ringA.serial)!) !== 0)!;
  assert.equal(coeffIn(kRow, xCol(built, "ring", ringA.serial)!), -k * ringA.props.fc!);
  assert.equal(built.model.rowUpper[kRow], 0);
});

// Regression coverage for a bug found through app/solver.test.mts's HiGHS-vs-core equivalence
// tests (Task 2): the k-row (s ≤ k·t) used to be added BEFORE u existed and never referenced it, so
// whenever a suit actually drove t negative, s ≤ k·t (negative) conflicted with s ≥ 0 regardless of
// u — the model was infeasible for the exact suits the u/guard-row pair was supposed to make
// feasible with s forced to 0. The fix folds a +k·N·u term into the k-row itself (N = −minReach), so
// u = 1 relaxes s ≤ k·t up to s ≤ k·(t − minReach) ≥ 0 for every reachable t, while u = 0 leaves the
// original s ≤ k·t in force (t is separately forced ≥ 0 in that branch by the "t + N·u ≥ 0" row).
test("[fast] mip: a soft-floor dim with a negative candidate adds a u column and relaxes the k-row so u=1 is feasible", () => {
  const built = build();
  assertWellFormed(built);
  const uJ = colOfDim(built, "fc", "u");
  assert.ok(uJ >= 0);
  const minReach = Math.min(0, ringA.props.fc!, ringB.props.fc!) + Math.min(0, 0) + Math.min(0, 0);
  const { matrix } = built.model;
  const rowsOf = (j: number): number[] => { const out: number[] = []; for (let r = 0; r < built.model.numRows; r++) for (let k2 = matrix.starts[r]!; k2 < matrix.starts[r + 1]!; k2++) if (matrix.indices[k2] === j) out.push(r); return out; };
  const rowSize = (r: number): number => matrix.starts[r + 1]! - matrix.starts[r]!;
  const coeffIn = (r: number, j: number): number => { for (let k2 = matrix.starts[r]!; k2 < matrix.starts[r + 1]!; k2++) if (matrix.indices[k2] === j) return matrix.values[k2]!; return 0; };
  const sJ = colOfDim(built, "fc", "s");
  const k = (profile.floorBonus * profile.floorPartial) / profile.floors.fc;

  // "t + N·u ≥ 0": the only u-row without sv in it.
  const guard1 = rowsOf(uJ).find((r) => coeffIn(r, sJ) === 0)!;
  assert.equal(coeffIn(guard1, uJ), -minReach);
  assert.equal(built.model.rowLower[guard1], 0);

  // "s ≤ sMax·(1 − u)": the u-row whose ONLY columns are sv and u (the k-row also has sv, but plus
  // every x column too, so column count disambiguates it unambiguously from the k-row below).
  const bonus = profile.floorBonus, partial = profile.floorPartial;
  const guard2 = rowsOf(uJ).find((r) => coeffIn(r, sJ) === 1 && rowSize(r) === 2)!;
  assert.equal(coeffIn(guard2, uJ), bonus * partial);
  assert.equal(built.model.rowUpper[guard2], bonus * partial);

  // the k-row itself: s ≤ k·t normally, relaxed by +k·minReach·u (the bug this test now guards).
  const kRow = rowsOf(uJ).find((r) => coeffIn(r, sJ) === 1 && rowSize(r) > 2);
  assert.ok(kRow !== undefined, "the k-row must reference u once a negative total is possible");
  assert.equal(coeffIn(kRow!, uJ), k * minReach);
  assert.equal(built.model.rowUpper[kRow!], 0);
});

// Regression (review C1): the met row used to be t − f·y ≥ 0, which with y = 0 still forced t ≥ 0 —
// every suit with a negative total on a REACHABLE soft floor was infeasible, although the core scores
// it (no credit on that floor, the rest counted). The u column only ever relaxed the k-row.
test("[fast] mip: a suit with a negative total on a reachable soft floor is feasible (y = 0 leaves t free)", () => {
  const built = build({ profile: { ...profile, floors: { fc: profile.floors.fc }, hardFloors: [] } });
  assert.ok(colOfDim(built, "fc", "y") >= 0, "the fc floor is reachable, so it has a met indicator");
  checkRows(built, startVector(built, { ring: ringB, neck: neckWorn, bracelet: braceletA }));   // fc total −1
});

// Review M4: the page shows unreachableFloors as "these required floors cannot be reached", so an
// out-of-reach SOFT floor (a preference, not a requirement) must not be listed there.
test("[fast] mip: an unreachable soft floor gets no met indicator and is not listed as an unreachable required floor", () => {
  const built = build({ profile: { ...profile, floors: { ...profile.floors, fc: 100000 } } });
  assert.equal(colOfDim(built, "fc", "y"), -1);
  assert.deepEqual(built.unreachableFloors, []);
});

test("[fast] mip: no u column when a soft floor's candidates are never negative", () => {
  const posPools = { ...pools, ring: [ringA, mkItem(4, "ring", { fc: 1 })] };
  const built = build({ pools: posPools });
  assertWellFormed(built);
  assert.equal(colOfDim(built, "fc", "u"), -1);
});

test("[fast] mip: a hard floor no suit can reach is listed unreachable, gets no row, and is modelled as s without y", () => {
  const built = build({ profile: { ...profile, floors: { ...profile.floors, lrc: 100000 } } });
  assertWellFormed(built);
  assert.deepEqual(built.unreachableFloors, ["lrc"]);
  assert.equal(built.hardRows.lrc, undefined);
  assert.equal(colOfDim(built, "lrc", "y"), -1);
  assert.ok(colOfDim(built, "lrc", "s") >= 0);
  assert.equal(built.scoreOffset, 0);        // an unreachable hard floor never counts toward scoreOffset
});

// bugfix-pass-review.md Important #1: `reach` (the per-dimension "best total any suit could ever
// reach" bound used to decide unreachability) used to fold `Math.max(0, ...)` over every slot's
// candidates, as if "contribute 0" (leave the slot empty) were always legal. That's only true for
// an OPTIONAL slot. A ring slot forced required by `current` (never optional, currently worn), whose
// only two candidates are both negative in `fc`, paired with an optional neck slot whose only
// candidate is exactly the hard floor (fc: 2): the phantom 0 for the ring slot made `reach` read
// 0 + 2 = 2, "reachable" — but the ring slot can never actually be left empty, so the true best total
// is neck's 2 plus the ring's least-bad real candidate (-3) = -1, genuinely below the floor.
function requiredNegativeFloorFixture(ringOptional: boolean): BuiltMip {
  const negRingA = mkItem(301, "ring", { fc: -5 });
  const negRingB = mkItem(302, "ring", { fc: -3 });
  const fcNeck = mkItem(311, "neck", { fc: 2 });
  const floorProfile = { weights: {}, caps: {}, floors: { fc: 2 }, hardFloors: ["fc"], floorBonus: 1000, floorPartial: 0.5 };
  return buildSuitMip({
    pools: { ring: [negRingA, negRingB], neck: [fcNeck] },
    current: { ring: negRingA },
    profile: floorProfile,
    slots: ["ring", "neck"],
    optionalSlots: ringOptional ? ["ring", "neck"] : ["neck"],
  });
}

test("[fast] mip: a hard floor is flagged unreachable when only a REQUIRED slot's negative-only candidates keep it out of reach", () => {
  const built = requiredNegativeFloorFixture(false);
  assertWellFormed(built);
  assert.deepEqual(built.unreachableFloors, ["fc"]);
  assert.equal(built.hardRows.fc, undefined, "no hard row for a floor the reach estimate itself proves unreachable");
});

test("[fast] mip: the same fixture with the slot made OPTIONAL is reachable (leaving it empty reaches the floor via neck alone) — guards against over-correcting", () => {
  const built = requiredNegativeFloorFixture(true);
  assertWellFormed(built);
  assert.deepEqual(built.unreachableFloors, []);
  assert.equal(typeof built.hardRows.fc, "number", "a genuine hard row: the floor really is reachable once the ring slot may be left empty");
});

// Issue #28: reach used to add the one-hand and two-hand maxima, counting a one-hander plus a
// two-hander, a suit the hands row forbids — a hard floor only that suit reaches cost an infeasible solve.
test("[fast] mip: reach respects the hands row — a one-hander plus a two-hander never reaches a floor, a one-hander plus a shield does", () => {
  const sword = mkItem(401, "oneHanded", { lrc: 60 }), bow = mkItem(402, "twoHanded", { lrc: 60 }, { twoHanded: true }), shield = mkItem(403, "twoHanded", { lrc: 50 });
  const floorProfile = { weights: {}, caps: {}, floors: { lrc: 100 }, hardFloors: ["lrc"], floorBonus: 1000, floorPartial: 0.5 };
  const handsOnly = (twoHanded: OptItem[]): BuiltMip => buildSuitMip({ pools: { oneHanded: [sword], twoHanded }, current: {}, profile: floorProfile, slots: ["oneHanded", "twoHanded"], optionalSlots: ["oneHanded", "twoHanded"] });
  assert.deepEqual(handsOnly([bow]).unreachableFloors, ["lrc"]);
  const withShield = handsOnly([bow, shield]);
  assert.deepEqual(withShield.unreachableFloors, []);
  assert.equal(typeof withShield.hardRows.lrc, "number");
});

test("[fast] mip: hardAsSoft models every hard floor as soft, with no hard rows and scoreOffset 0", () => {
  const built = build({ hardAsSoft: true });
  assertWellFormed(built);
  assert.deepEqual(built.hardRows, {});
  assert.equal(built.scoreOffset, 0);
  const yJ = colOfDim(built, "lrc", "y");
  assert.ok(yJ >= 0);
  assert.equal(built.model.colCost[yJ], HARD_FLOOR_BONUS);
});

// ---------------------------------------------------------------------------
// Slot rows and the hands row
// ---------------------------------------------------------------------------

test("[fast] mip: slot rows are = 1 for a required worn slot, ≤ 1 otherwise, respecting optionalSlots", () => {
  const built = build();
  assertWellFormed(built);
  const { matrix } = built.model;
  const rowFor = (slot: string): number => {
    const cols = new Set(built.xIndex[slot]);
    for (let r = 0; r < built.model.numRows; r++) {
      const start = matrix.starts[r]!, end = matrix.starts[r + 1]!;
      if (end - start === cols.size && Array.from({ length: end - start }, (_, i) => matrix.indices[start + i]).every((j) => cols.has(j!))) return r;
    }
    return -1;
  };
  const braceletRow = rowFor("bracelet");                          // required (not optional) and worn
  assert.equal(built.model.rowLower[braceletRow], 1);
  assert.equal(built.model.rowUpper[braceletRow], 1);
  const ringRow = rowFor("ring");                                   // optional, even though worn
  assert.equal(built.model.rowLower[ringRow], -Infinity);
  assert.equal(built.model.rowUpper[ringRow], 1);
});

test("[fast] mip: the hands row appears only when a two-hander and a one-hander both exist", () => {
  const built = build();
  assertWellFormed(built);
  const { matrix } = built.model;
  const twoJ = xCol(built, "twoHanded", twoHandedA.serial)!, oneJ = xCol(built, "oneHanded", oneHandedA.serial)!;
  let handsRow = -1;
  for (let r = 0; r < built.model.numRows; r++) {
    const start = matrix.starts[r]!, end = matrix.starts[r + 1]!;
    if (end - start === 2 && [matrix.indices[start], matrix.indices[start + 1]].sort().join() === [twoJ, oneJ].sort().join()) handsRow = r;
  }
  assert.ok(handsRow >= 0);
  assert.equal(built.model.rowUpper[handsRow], 1);
  const built2 = build({ pools: { ...pools, twoHanded: [] } });     // no two-hander candidate: no hands row at all
  assert.equal(built2.model.numRows, built.model.numRows - 2);      // loses the hands row and the (now-empty) twoHanded slot row
});

// ---------------------------------------------------------------------------
// startVector, pickedOf, noGoodRow
// ---------------------------------------------------------------------------

test("[fast] mip: startVector on the worn suit satisfies every row", () => {
  const built = build();
  // neck has no pool of its own, so it is a single-candidate x-column — the worn assignment must
  // still pick it explicitly, same as any other slot.
  const vec = startVector(built, { ring: ringA, neck: neckWorn, bracelet: braceletA });
  assert.equal(vec.length, built.model.numCols);
  checkRows(built, vec);
});

test("[fast] mip: floorCols and capCols name the same columns the cols array does", () => {
  const built = build();
  for (const [d, cc] of Object.entries(built.capCols)) {
    assert.equal(built.cols[cc.col]!.kind, "c");
    assert.equal(built.cols[cc.col]!.dim, d);
    assert.equal(cc.cap, profile.caps[d as keyof typeof profile.caps]);
  }
  for (const [d, fc] of Object.entries(built.floorCols)) {
    assert.equal(built.cols[fc.s]!.kind, "s");
    assert.equal(built.cols[fc.s]!.dim, d);
    if (fc.y != null) { assert.equal(built.cols[fc.y]!.kind, "y"); assert.equal(built.cols[fc.y]!.dim, d); }
    if (fc.u != null) { assert.equal(built.cols[fc.u]!.kind, "u"); assert.equal(built.cols[fc.u]!.dim, d); }
  }
  // every dim that actually got a c/y/s/u column is named by exactly one of the two maps
  const colDims = new Set(built.cols.filter((c) => c.dim != null).map((c) => c.dim));
  const namedDims = new Set([...Object.keys(built.capCols), ...Object.keys(built.floorCols)]);
  assert.deepEqual([...colDims].sort(), [...namedDims].sort());
});

test("[fast] mip: pickedOf maps > 0.5 columns to items", () => {
  const built = build();
  const colValue = new Float64Array(built.model.numCols);
  colValue[xCol(built, "ring", ringA.serial)!] = 1;
  colValue[xCol(built, "bracelet", braceletA.serial)!] = 1;
  colValue[built.xIndex.neck![0]!] = 1;
  const picked = pickedOf(built, colValue);
  assert.equal(picked.ring!.serial, ringA.serial);
  assert.equal(picked.bracelet!.serial, braceletA.serial);
  assert.equal(picked.neck!.serial, neckWorn.serial);
});

test("[fast] mip: noGoodRow is the proper cut over every x column", () => {
  const A = mkItem(101, "ring", {}), B = mkItem(102, "ring", {}), C = mkItem(103, "ring", {});
  const built = buildSuitMip({ pools: { ring: [A, B, C] }, current: {}, profile: { weights: {}, caps: {}, floors: {} }, slots: ["ring"], optionalSlots: ["ring"] });
  assertWellFormed(built);
  const row = noGoodRow(built, { ring: A });
  assert.equal(row.lower, -Infinity);
  assert.equal(row.upper, 0);
  assert.deepEqual(row.indices, built.xIndex.ring);
  assert.deepEqual(row.values, [1, -1, -1]);
});

// ---------------------------------------------------------------------------
// The HiGHS solve itself
// ---------------------------------------------------------------------------

test("[fast] HiGHS solves a 3-slot toy exactly and the no-good cut yields the runner-up", async () => {
  const { loadHighs, openModel, solveModel, addNoGood, closeModel } = await import("./mip-solve.mts");
  const toyProfile = { weights: { val: 1 }, caps: {}, floors: {} };
  const toyPools = {
    ring: [mkItem(201, "ring", { val: 5 }), mkItem(202, "ring", { val: 3 }), mkItem(203, "ring", { val: -2 })],
    bracelet: [mkItem(211, "bracelet", { val: 4 }), mkItem(212, "bracelet", { val: -1 }), mkItem(213, "bracelet", { val: 2.5 })],
    talisman: [mkItem(221, "talisman", { val: 6 }), mkItem(222, "talisman", { val: 1 }), mkItem(223, "talisman", { val: -3 })],
  };
  const toySlots = ["ring", "bracelet", "talisman"];
  const built = buildSuitMip({ pools: toyPools, current: {}, profile: toyProfile, slots: toySlots, optionalSlots: toySlots });
  assertWellFormed(built);

  // brute force: every combination of the 3 candidates plus "empty" per slot, scored exactly as optScoreVector does
  const scoreOf = (items: (OptItem | null)[]): number => {
    const totals: Record<string, number> = {};
    for (const it of items) if (it) for (const [k, v] of Object.entries(it.props)) totals[k] = (totals[k] || 0) + v;
    let s = 0;
    for (const [d, w] of Object.entries(toyProfile.weights)) { const cap = (toyProfile.caps as Record<string, number>)[d], t = totals[d] || 0; s += w * (Number.isFinite(cap) && t > cap! ? cap! : t); }
    return s;
  };
  const withEmpty = <T,>(list: T[]): (T | null)[] => [...list, null];
  const combos: { ring: OptItem | null; bracelet: OptItem | null; talisman: OptItem | null }[] = [];
  for (const r of withEmpty(toyPools.ring)) for (const b of withEmpty(toyPools.bracelet)) for (const t of withEmpty(toyPools.talisman)) combos.push({ ring: r, bracelet: b, talisman: t });
  const scored = combos.map((c) => ({ c, score: scoreOf([c.ring, c.bracelet, c.talisman]) })).sort((a, b) => b.score - a.score);
  const [best, second] = scored as [{ c: typeof combos[number]; score: number }, { c: typeof combos[number]; score: number }];

  const highs = await loadHighs();
  const handle = openModel(highs, built);
  try {
    const start = startVector(built, {});
    const result = solveModel(handle, { timeLimitS: 10, start });
    assert.equal(result.status, "optimal");
    const picked = pickedOf(built, result.colValue!);
    assert.ok(Math.abs(result.objective! + built.scoreOffset - best.score) < 1e-6, `${result.objective} + ${built.scoreOffset} != ${best.score}`);
    for (const s of toySlots) assert.equal(picked[s]?.serial, best.c[s as keyof typeof best.c]?.serial);

    addNoGood(handle, built, picked);
    const result2 = solveModel(handle, { timeLimitS: 10 });
    assert.equal(result2.status, "optimal");
    const picked2 = pickedOf(built, result2.colValue!);
    assert.ok(Math.abs(result2.objective! + built.scoreOffset - second.score) < 1e-6, `${result2.objective} + ${built.scoreOffset} != ${second.score}`);
    for (const s of toySlots) assert.equal(picked2[s]?.serial ?? null, second.c[s as keyof typeof second.c]?.serial ?? null);
  } finally {
    closeModel(handle);
  }
});

test("[fast] loadHighs rejects under PACKRAT_NO_HIGHS", async () => {
  const { loadHighs } = await import("./mip-solve.mts");
  await loadHighs();                                   // populate the memo first
  process.env.PACKRAT_NO_HIGHS = "1";
  await assert.rejects(() => loadHighs(), /HiGHS disabled by PACKRAT_NO_HIGHS/);
  delete process.env.PACKRAT_NO_HIGHS;
  await assert.doesNotReject(() => loadHighs());        // the memo (populated before the env var was set) still works
});

// A tiny, deterministic PRNG (mulberry32) so the "deliberately large" model below is reproducible.
function mulberry32(seed: number): () => number {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Review M7: when no callback carried a dual bound, `dual` fell back to the primal objective, so a
// time-limited incumbent looked proven (bound == incumbent). docs/solver.md promises null there.
test("[fast] mip-solve: a timeLimit solve with no callback reports no dual bound, not the incumbent", async () => {
  const { solveModel } = await import("./mip-solve.mts");
  const constants = {
    objectiveSense: { maximize: 1, minimize: 2 }, modelStatus: { optimal: 7, timeLimit: 13, infeasible: 8, interrupted: 17 },
    solutionStatus: { feasible: 2 }, callbackType: { mipImprovingSolution: 3, mipLogging: 4 },
  };
  const model = {
    passModel: () => {}, options: { set: () => {} }, setSolution: () => {}, run: () => {}, addRow: () => {}, disposed: false, dispose: () => {},
    info: { get: (name: string) => (name === "primal_solution_status" ? 2 : 0) },
    getModelStatus: () => 13, getSolution: () => ({ colValue: new Float64Array(1) }), getObjectiveValue: () => 42,
  };
  const r = solveModel({ highs: { createModel: () => model, constants }, model, built: build() }, { timeLimitS: 1 });
  assert.equal(r.status, "timeLimit");
  assert.equal(r.objective, 42);
  assert.equal(r.dual, null);
  assert.equal(r.gapAbs, null);
});

test("[fast] mip-solve: gapFromEvents computes the absolute gap from the last event carrying both bounds", async () => {
  const { gapFromEvents } = await import("./mip-solve.mts");
  assert.equal(gapFromEvents("optimal", { dual: 999, primal: -999 }), 0, "optimal is always gap 0, whatever the last event says");
  assert.equal(gapFromEvents("optimal", null), 0, "optimal is gap 0 even with no event at all");
  assert.equal(gapFromEvents("timeLimit", { dual: 120, primal: 100 }), 20);
  assert.equal(gapFromEvents("timeLimit", { dual: 100, primal: 120 }), 20, "absolute: sign of dual - primal does not matter");
  assert.equal(gapFromEvents("timeLimit", { dual: null, primal: 100 }), null, "missing dual: gap unknown");
  assert.equal(gapFromEvents("timeLimit", { dual: 100, primal: null }), null, "missing primal: gap unknown");
  assert.equal(gapFromEvents("timeLimit", null), null, "no event carried both bounds: gap unknown");
  assert.equal(gapFromEvents("timeLimit", { dual: Infinity, primal: 100 }), null, "a dual bound not established yet (Infinity): gap unknown");
  assert.equal(gapFromEvents("infeasible", null), null);
});

test("[fast] mip-solve: a short time limit on a large model reports a status-consistent gapAbs either way", async () => {
  const { loadHighs, openModel, solveModel, closeModel, gapFromEvents } = await import("./mip-solve.mts");
  // A small toy (like the one above) proves optimal almost instantly, so exercising the time-limit
  // path needs a model deliberately sized to plausibly still be mid-solve at a short time limit: 20
  // slots x 400 candidates over 5 weighted/floored dims (8,005 x columns). This assertion never
  // assumes which way the clock falls (machine load can go either way) — it accepts "optimal" (gap
  // 0) or "timeLimit" (gap computed by gapFromEvents from the same captured events), never a
  // hard-coded expectation of which status shows up.
  const rand = mulberry32(2026);
  const DIMS = ["d0", "d1", "d2", "d3", "d4"];
  const bigSlots = Array.from({ length: 20 }, (_, i) => `bigSlot${i}`);
  // Deliberately lighter than OptItem (no `name`, a string serial): buildSuitMip only ever reads
  // slot/serial/props/twoHanded off a candidate, so this scale fixture skips what it never checks.
  const bigPools = Object.fromEntries(bigSlots.map((s): [string, { serial: string; slot: string; props: Record<string, number> }[]] => [s, Array.from({ length: 400 }, (_, i) => ({
    serial: `${s}-${i}`, slot: s, props: Object.fromEntries(DIMS.map((d): [string, number] => [d, Math.round((rand() * 100 - 40) * 10) / 10])) }))]));
  const bigProfile = { weights: { d0: 3, d1: 2, d2: -1, d3: 1 }, caps: { d0: 800, d1: 600 }, floors: { d2: 900, d4: 300 }, hardFloors: ["d2"], floorBonus: 1000, floorPartial: 0.5 };
  const built = buildSuitMip({ pools: bigPools as unknown as Partial<Record<string, OptItem[]>>, current: {}, profile: bigProfile, slots: bigSlots, optionalSlots: bigSlots });
  assertWellFormed(built);

  const highs = await loadHighs();
  const handle = openModel(highs, built);
  handle.model.options.set({ mip_min_logging_interval: 0 });   // HiGHS's own default (5s) would never fire within this test
  try {
    const events: { dual: number | undefined; primal: number | undefined }[] = [];
    const result = solveModel(handle, { timeLimitS: 1.1, start: startVector(built, {}), onEvent: (e) => events.push(e) });
    assert.ok(result.status === "optimal" || result.status === "timeLimit", `unexpected status ${result.status}`);
    if (result.status === "optimal") {
      assert.equal(result.gapAbs, 0);
    } else {
      const last = [...events].reverse().find((e) => e.dual != null && e.primal != null) || null;
      assert.equal(result.gapAbs, gapFromEvents(result.status, last));
    }
    assert.ok(result.colValue === null || result.colValue.length === built.model.numCols);
  } finally {
    closeModel(handle);
  }
});
