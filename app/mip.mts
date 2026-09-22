// mip.mts — the suit problem as a mixed-integer program, built as HiGHS sparse (CSR) arrays. Pure:
// no solver import here (app/mip-solve.mts owns the runtime). Every modelling choice reproduces
// app/bench/mip-spike.mts, which was validated to the decimal against the core's proven optima —
// see docs/solver.md for the model and app/bench/REPORT.md for the evidence.
import type { OptItem } from "./vault-lib.mts";

export const HARD_FLOOR_BONUS = 1e7;   // == scripts/optimizer-core.mts HARD_FLOOR_BONUS
export const DEFAULT_SLOTS: string[] = ["helmet", "chest", "arms", "hands", "legs", "neck", "ring", "bracelet", "talisman", "cloak", "oneHanded", "twoHanded"];
export const DEFAULT_OPTIONAL_SLOTS: string[] = ["cloak", "talisman", "ring", "bracelet", "neck", "oneHanded", "twoHanded"];
const INF = Infinity;

// One CSR-row entry: [columnIndex, coefficient]. A plain inline `[a, b]` array literal infers as
// `number[]`, not this tuple, so every row-building callback below that returns one is annotated
// `: Term =>` (erased at compile time, changes no literal) rather than relying on inference.
type Term = [number, number];

// A model column. Every "x" column carries slot+item (one candidate in one slot); every "c"/"y"/
// "z"/"s"/"u" column carries the dimension it was built for — see buildSuitMip's comments for what
// each kind means.
export interface MipCol {
  name: string;
  kind: "x" | "c" | "z" | "y" | "s" | "u";
  slot?: string | undefined;
  item?: OptItem | undefined;
  dim?: string | undefined;
}

// The profile fields buildSuitMip itself reads. Every field is read through a fallback (`|| {}`,
// `typeof ... === "number"`), so every field here is optional — this is deliberately looser than
// vault-lib.mts's EffectiveProfile (which has no floorPartial): any EffectiveProfile is a valid
// MipProfile, but a MipProfile need not carry every EffectiveProfile field.
export interface MipProfile {
  weights?: Record<string, number> | undefined;
  caps?: Record<string, number> | undefined;
  floors?: Record<string, number> | undefined;
  hardFloors?: string[] | undefined;
  floorBonus?: number | undefined;
  floorPartial?: number | undefined;
}

export interface BuildSuitMipOptions {
  pools?: Partial<Record<string, OptItem[]>> | undefined;
  current?: Partial<Record<string, OptItem>> | undefined;
  profile: MipProfile;
  optionalSlots?: string[] | undefined;
  slots?: string[] | undefined;
  hardAsSoft?: boolean | undefined;
}

export type MipSense = "maximize" | "minimize";

export interface MipMatrix {
  format: "csr";
  numRows: number;
  numCols: number;
  starts: number[];
  indices: number[];
  values: number[];
}

// The HiGHS `passModel` payload shape (app/mip-solve.mts spreads this with `sense` translated to
// the loaded highs instance's own enum before calling it).
export interface MipModel {
  numCols: number;
  numRows: number;
  sense: MipSense;
  offset: number;
  colCost: number[];
  colLower: number[];
  colUpper: number[];
  rowLower: number[];
  rowUpper: number[];
  matrix: MipMatrix;
  integrality: number[];
}

export interface CapCol {
  col: number;
  cap: number;
  z: number | null;
}
export interface FloorCol {
  f: number;
  k: number;
  sMax: number;
  y: number | null;
  s: number;
  u: number | null;
}

export interface BuiltMip {
  cols: MipCol[];
  xIndex: Record<string, number[]>;
  dims: string[];
  unreachableFloors: string[];
  hardRows: Record<string, number>;
  scoreOffset: number;
  capCols: Record<string, CapCol>;
  floorCols: Record<string, FloorCol>;
  model: MipModel;
}

export function buildSuitMip({ pools = {}, current = {}, profile, optionalSlots = DEFAULT_OPTIONAL_SLOTS, slots = DEFAULT_SLOTS, hardAsSoft = false }: BuildSuitMipOptions): BuiltMip {
  const optional = new Set(optionalSlots);
  const W = profile.weights || {}, CAPS = profile.caps || {}, FL = profile.floors || {};
  const hard = new Set(profile.hardFloors || []);
  const FB = typeof profile.floorBonus === "number" ? profile.floorBonus : 1000;
  const PARTIAL = typeof profile.floorPartial === "number" ? profile.floorPartial : 0.5;
  const dims = [...new Set([...Object.keys(W), ...Object.keys(CAPS), ...Object.keys(FL)])];

  // ---- columns ----
  const cols: MipCol[] = [], colCost: number[] = [], colLower: number[] = [], colUpper: number[] = [], integrality: number[] = [];
  const addCol = (col: MipCol, cost: number, lo: number, hi: number, integer: boolean): number => { cols.push(col); colCost.push(cost); colLower.push(lo); colUpper.push(hi); integrality.push(integer ? 1 : 0); return cols.length - 1; };
  const xIndex: Record<string, number[]> = {};
  for (const s of slots) {
    const seen = new Set<number>(), list: OptItem[] = [];
    for (const it of pools[s] || []) { if (it.slot === s && !seen.has(it.serial)) { seen.add(it.serial); list.push(it); } }   // as optCandidatesFor
    const curItem = current[s];
    const cur = curItem && curItem.slot === s ? curItem : null;
    if (cur && !seen.has(cur.serial)) list.push(cur);                                     // keep what you wear: always a candidate
    if (!list.length) continue;
    xIndex[s] = list.map((it, i) => addCol({ name: `x_${s}_${i}`, kind: "x", slot: s, item: it }, 0, 0, 1, true));
  }
  const allX: number[] = Object.values(xIndex).flat();
  // A slot's x-columns are forced to exactly 1 (never "leave it empty") exactly when it is not
  // optional and its currently-worn item is one of its own candidates — the same predicate the
  // "one per slot" row below builds from. `reach` (just below) needs this same distinction: "the
  // slot could contribute 0" is only a real option for a slot this predicate says is NOT required.
  const isRequired = (s: string): boolean => {
    const curItem = current[s];
    return !optional.has(s) && !!curItem && curItem.slot === s;
  };

  // ---- rows (CSR) ----
  const rowLower: number[] = [], rowUpper: number[] = [], starts: number[] = [0], indices: number[] = [], values: number[] = [];
  const addRow = (entries: Term[], lo: number, hi: number): number => { for (const [j, v] of entries) { indices.push(j); values.push(v); } starts.push(indices.length); rowLower.push(lo); rowUpper.push(hi); return rowLower.length - 1; };
  let scoreOffset = 0;
  const unreachableFloors: string[] = [], hardRows: Record<string, number> = {}, capCols: Record<string, CapCol> = {}, floorCols: Record<string, FloorCol> = {};
  for (const d of dims) {
    const w = W[d] || 0, cap = CAPS[d], f = FL[d] || 0;
    // Every j in allX is an x column, which always carries `item` (set in the loop above) — the two
    // `!` below are in range by construction, not an unchecked assumption about caller input.
    const xs: Term[] = allX.map((j): Term => [j, cols[j]!.item!.props[d] || 0]).filter(([, v]) => v !== 0);
    // The range any suit's total can take: per-slot maxima summed (see "per-slot maxima" below for
    // why a required slot folds in no phantom 0) and per-slot minima summed (a valid lower bound,
    // with 0 folded in everywhere, and the two-hander rule ignored — both only loosen it).
    let reach = 0, minReach = 0;
    for (const s of Object.keys(xIndex)) {
      const vals = xIndex[s]!.map((j) => cols[j]!.item!.props[d] || 0);
      reach += isRequired(s) ? Math.max(...vals) : Math.max(0, ...vals);
      minReach += Math.min(0, ...vals);
    }
    if (w !== 0) {
      if (Number.isFinite(cap)) {                                 // w·min(t, cap): c ≤ t, c ≤ cap, objective w·c; c may go negative like t
        // Number.isFinite(number: unknown) is not a type predicate, so TS can't narrow `cap` itself
        // from the check just above — re-reading the same CAPS[d] (never mutated in between) into a
        // shadowed, honestly-typed `cap` restores plain `cap` use (incl. the `capCols` shorthand)
        // for the rest of this block, in range by construction rather than asserted.
        const cap = CAPS[d] as number;
        const c = addCol({ name: `c_${d}`, kind: "c", dim: d }, w, -INF, cap, false);
        addRow([[c, 1], ...xs.map(([j, v]): Term => [j, -v])], -INF, 0);
        // A positive weight drives c up to min(t, cap) on its own (min is concave, and we maximise).
        // A negative one would drive c down without limit, so a binary z pins c to min(t, cap) from
        // below as well: c ≥ t − M1·z and c ≥ cap − M2·(1 − z), with M1 = reach − cap and
        // M2 = cap − minReach the widest either gap can be. z = 0 forces c = t (so t ≤ cap), z = 1
        // forces c = cap (so t ≥ cap).
        let z: number | null = null;
        if (w < 0) {
          const M1 = Math.max(0, reach - cap), M2 = Math.max(0, cap - minReach);
          z = addCol({ name: `z_${d}`, kind: "z", dim: d }, 0, 0, 1, true);
          addRow([[c, 1], ...xs.map(([j, v]): Term => [j, -v]), [z, M1]], 0, INF);
          addRow([[c, 1], [z, -M2]], cap - M2, INF);
        }
        capCols[d] = { col: c, cap, z };
      } else {                                                    // uncapped: linear, aggregated per column
        for (const [j, v] of xs) colCost[j]! += w * v;
      }
    }
    if (f <= 0) continue;
    // per-slot maxima (`reach`, above): a floor above them can never be met, so its met-indicator is
    // 0 for every suit. "Contribute 0" (leave the slot empty) is only ever a real option for an
    // OPTIONAL slot — a required slot's true best is the max over its own real candidates, with no
    // phantom 0 folded in (mirrors scripts/optimizer-core.mts's suf/ext bound, which never injects one either).
    const isHard = hard.has(d), unreachable = reach < f;
    if (isHard && !hardAsSoft && !unreachable) { hardRows[d] = addRow(xs, f, INF); scoreOffset += HARD_FLOOR_BONUS; continue; }
    if (unreachable && isHard) unreachableFloors.push(d);
    // soft floor (or an unreachable / hardAsSoft hard floor): bonus·y + s with t ≥ f·y, s ≤ k·t, s ≤ bonus·partial·(1 − y)
    const bonus = isHard ? HARD_FLOOR_BONUS : FB, k = bonus * PARTIAL / f, sMax = bonus * PARTIAL;
    const y = unreachable ? null : addCol({ name: `y_${d}`, kind: "y", dim: d }, bonus, 0, 1, true);
    const sv = addCol({ name: `s_${d}`, kind: "s", dim: d }, 1, 0, sMax, false);
    // "met" row, t ≥ f·y written as t − (f − minReach)·y ≥ minReach: y = 1 still forces t ≥ f, and
    // y = 0 leaves t free down to the lowest total any suit reaches (a plain t − f·y ≥ 0 would forbid
    // every negative-total suit outright, although the core scores it: no credit on this floor, the
    // rest of the suit counted as usual).
    if (y != null) addRow([...xs, [y, -(f - minReach)]], minReach, INF);
    // the core gives zero partial credit below a total of 0: s ≤ k·t alone would make a negative-total
    // suit infeasible (s ≥ 0 but k·t < 0 there), so when a negative total is possible a binary u relaxes
    // that same row by k·N (N = −minReach, the most negative t can go) — u = 0 forces t ≥ 0 (s ≤ k·t
    // applies unrelaxed), u = 1 lifts s ≤ k·t by k·N and a separate row forces s = 0 outright.
    const u = minReach < 0 ? addCol({ name: `u_${d}`, kind: "u", dim: d }, 0, 0, 1, true) : null;
    const kRow: Term[] = [[sv, 1], ...xs.map(([j, v]): Term => [j, -k * v])];
    if (u != null) kRow.push([u, k * minReach]);        // + k·N·u, since k·minReach = −k·N
    addRow(kRow, -INF, 0);
    if (y != null) addRow([[sv, 1], [y, sMax]], -INF, sMax);
    if (u != null) {
      addRow([...xs, [u, -minReach]], 0, INF);              // t + N·u ≥ 0 with N = −minReach
      addRow([[sv, 1], [u, sMax]], -INF, sMax);              // s ≤ sMax·(1 − u)
    }
    floorCols[d] = { f, k, sMax, y, s: sv, u };
  }
  for (const s of Object.keys(xIndex)) addRow(xIndex[s]!.map((j) => [j, 1]), isRequired(s) ? 1 : -INF, 1);   // one per slot: = 1 when required and worn, else ≤ 1
  const twoH = (xIndex.twoHanded || []).filter((j) => cols[j]!.item!.twoHanded === true), oneH = xIndex.oneHanded || [];
  if (twoH.length && oneH.length) addRow([...twoH, ...oneH].map((j) => [j, 1]), -INF, 1);   // a two-hander forbids the one-hand slot

  const model: MipModel = { numCols: cols.length, numRows: rowLower.length, sense: "maximize", offset: 0, colCost, colLower, colUpper, rowLower, rowUpper,
    matrix: { format: "csr", numRows: rowLower.length, numCols: cols.length, starts, indices, values }, integrality };
  return { cols, xIndex, dims, unreachableFloors, hardRows, scoreOffset, capCols, floorCols, model };
}

// ---- MIP start, extraction, and no-good cut ----
//
// startVector, pickedOf and noGoodRow all work only off the built model (no profile access):
// buildSuitMip hands startVector each dim's cap/floor metadata directly (`capCols`/`floorCols`),
// rather than making it reverse-engineer that from the CSR matrix, so it stays a pure, cheap
// function of (built, assignment).

export function startVector(built: BuiltMip, assignment: Partial<Record<string, OptItem>> = {}): Float64Array {
  const { cols, xIndex, dims, capCols, floorCols, model } = built;
  const vec = new Float64Array(model.numCols);
  const totals = Object.fromEntries(dims.map((d) => [d, 0]));
  for (const s of Object.keys(xIndex)) {
    const item = assignment[s];
    for (const j of xIndex[s]!) {
      // Every j in xIndex[s] is one of this slot's x columns, which always carries `item`.
      if (item && cols[j]!.item!.serial === item.serial) {
        vec[j] = 1;
        // Every d here comes from `dims`, the same array totals was built from — always present.
        for (const d of dims) totals[d]! += cols[j]!.item!.props[d] || 0;
      }
    }
  }
  for (const d of dims) {
    const t = totals[d]!;
    const cc = capCols[d];
    if (cc) vec[cc.col] = Math.min(t, cc.cap);
    if (cc && cc.z != null) vec[cc.z] = t >= cc.cap ? 1 : 0;
    const fc = floorCols[d];
    if (!fc) continue;
    const met = fc.y != null && t >= fc.f;
    if (fc.y != null) vec[fc.y] = met ? 1 : 0;
    vec[fc.s] = met ? 0 : fc.k * Math.max(0, t);
    if (fc.u != null) vec[fc.u] = t < 0 ? 1 : 0;
  }
  return vec;
}

export function pickedOf(built: BuiltMip, colValue: ArrayLike<number>): Partial<Record<string, OptItem>> {
  const out: Partial<Record<string, OptItem>> = {};
  for (const s of Object.keys(built.xIndex)) {
    for (const j of built.xIndex[s]!) if (colValue[j]! > 0.5) out[s] = built.cols[j]!.item;
  }
  return out;
}

export interface NoGoodRow {
  lower: number;
  upper: number;
  indices: number[];
  values: number[];
}

// The proper cut Σ_picked x − Σ_unpicked x ≤ |picked| − 1 over every x column (mip-spike.mts's
// KBEST inline text construction, reproduced over the sparse columns instead of LP text).
export function noGoodRow(built: BuiltMip, picked: Partial<Record<string, OptItem>>): NoGoodRow {
  const indices: number[] = [], values: number[] = [];
  let n = 0;
  for (const s of Object.keys(built.xIndex)) {
    const pickedItem = picked[s];
    if (pickedItem) n++;
    for (const j of built.xIndex[s]!) { indices.push(j); values.push(pickedItem && built.cols[j]!.item!.serial === pickedItem.serial ? 1 : -1); }
  }
  return { lower: -Infinity, upper: n - 1, indices, values };
}
