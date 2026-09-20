// mip.mjs — the suit problem as a mixed-integer program, built as HiGHS sparse (CSR) arrays. Pure:
// no solver import here (app/mip-solve.mjs owns the runtime). Every modelling choice reproduces
// app/bench/mip-spike.mjs, which was validated to the decimal against the core's proven optima —
// see docs/solver.md for the model and app/bench/REPORT.md for the evidence.
export const HARD_FLOOR_BONUS = 1e7;   // == scripts/optimizer-core.mts HARD_FLOOR_BONUS
export const DEFAULT_SLOTS = ["helmet", "chest", "arms", "hands", "legs", "neck", "ring", "bracelet", "talisman", "cloak", "oneHanded", "twoHanded"];
export const DEFAULT_OPTIONAL_SLOTS = ["cloak", "talisman", "ring", "bracelet", "neck", "oneHanded", "twoHanded"];
const INF = Infinity;

export function buildSuitMip({ pools = {}, current = {}, profile, optionalSlots = DEFAULT_OPTIONAL_SLOTS, slots = DEFAULT_SLOTS, hardAsSoft = false }) {
  const optional = new Set(optionalSlots);
  const W = profile.weights || {}, CAPS = profile.caps || {}, FL = profile.floors || {};
  const hard = new Set(profile.hardFloors || []);
  const FB = typeof profile.floorBonus === "number" ? profile.floorBonus : 1000;
  const PARTIAL = typeof profile.floorPartial === "number" ? profile.floorPartial : 0.5;
  const dims = [...new Set([...Object.keys(W), ...Object.keys(CAPS), ...Object.keys(FL)])];
  for (const d of dims) if ((W[d] || 0) < 0 && Number.isFinite(CAPS[d])) throw new Error(`negative weight with a cap is non-concave: ${d}`);

  // ---- columns ----
  const cols = [], colCost = [], colLower = [], colUpper = [], integrality = [];
  const addCol = (col, cost, lo, hi, integer) => { cols.push(col); colCost.push(cost); colLower.push(lo); colUpper.push(hi); integrality.push(integer ? 1 : 0); return cols.length - 1; };
  const xIndex = {};
  for (const s of slots) {
    const seen = new Set(), list = [];
    for (const it of pools[s] || []) { if (it.slot === s && !seen.has(it.serial)) { seen.add(it.serial); list.push(it); } }   // as optCandidatesFor
    const cur = current[s] && current[s].slot === s ? current[s] : null;
    if (cur && !seen.has(cur.serial)) list.push(cur);                                     // keep what you wear: always a candidate
    if (!list.length) continue;
    xIndex[s] = list.map((it, i) => addCol({ name: `x_${s}_${i}`, kind: "x", slot: s, item: it }, 0, 0, 1, true));
  }
  const allX = Object.values(xIndex).flat();

  // ---- rows (CSR) ----
  const rowLower = [], rowUpper = [], starts = [0], indices = [], values = [];
  const addRow = (entries, lo, hi) => { for (const [j, v] of entries) { indices.push(j); values.push(v); } starts.push(indices.length); rowLower.push(lo); rowUpper.push(hi); return rowLower.length - 1; };
  let scoreOffset = 0;
  const unreachableFloors = [], hardRows = {}, capCols = {}, floorCols = {};
  for (const d of dims) {
    const w = W[d] || 0, cap = CAPS[d], f = FL[d] || 0;
    const xs = allX.map((j) => [j, cols[j].item.props[d] || 0]).filter(([, v]) => v !== 0);
    if (w !== 0) {
      if (Number.isFinite(cap) && w > 0) {                       // w·min(t, cap): c ≤ t, c ≤ cap, maximise w·c (min is concave); c may go negative like t
        const c = addCol({ name: `c_${d}`, kind: "c", dim: d }, w, -INF, cap, false);
        addRow([[c, 1], ...xs.map(([j, v]) => [j, -v])], -INF, 0);
        capCols[d] = { col: c, cap };
      } else {                                                    // uncapped: linear, aggregated per column
        for (const [j, v] of xs) colCost[j] += w * v;
      }
    }
    if (f <= 0) continue;
    // per-slot maxima: a floor above them can never be met, so its met-indicator is 0 for every suit
    let reach = 0; for (const s of Object.keys(xIndex)) reach += Math.max(0, ...xIndex[s].map((j) => cols[j].item.props[d] || 0));
    const isHard = hard.has(d), unreachable = reach < f;
    if (isHard && !hardAsSoft && !unreachable) { hardRows[d] = addRow(xs, f, INF); scoreOffset += HARD_FLOOR_BONUS; continue; }
    if (unreachable) unreachableFloors.push(d);
    // soft floor (or an unreachable / hardAsSoft hard floor): bonus·y + s with t ≥ f·y, s ≤ k·t, s ≤ bonus·partial·(1 − y)
    const bonus = isHard ? HARD_FLOOR_BONUS : FB, k = bonus * PARTIAL / f, sMax = bonus * PARTIAL;
    const y = unreachable ? null : addCol({ name: `y_${d}`, kind: "y", dim: d }, bonus, 0, 1, true);
    const sv = addCol({ name: `s_${d}`, kind: "s", dim: d }, 1, 0, sMax, false);
    if (y != null) addRow([...xs, [y, -f]], 0, INF);
    // the core gives zero partial credit below a total of 0: s ≤ k·t alone would make a negative-total
    // suit infeasible (s ≥ 0 but k·t < 0 there), so when a negative total is possible a binary u relaxes
    // that same row by k·N (N = −minReach, the most negative t can go) — u = 0 forces t ≥ 0 (s ≤ k·t
    // applies unrelaxed), u = 1 lifts s ≤ k·t by k·N and a separate row forces s = 0 outright.
    let minReach = 0; for (const s of Object.keys(xIndex)) minReach += Math.min(0, ...xIndex[s].map((j) => cols[j].item.props[d] || 0));
    const u = minReach < 0 ? addCol({ name: `u_${d}`, kind: "u", dim: d }, 0, 0, 1, true) : null;
    const kRow = [[sv, 1], ...xs.map(([j, v]) => [j, -k * v])];
    if (u != null) kRow.push([u, k * minReach]);        // + k·N·u, since k·minReach = −k·N
    addRow(kRow, -INF, 0);
    if (y != null) addRow([[sv, 1], [y, sMax]], -INF, sMax);
    if (u != null) {
      addRow([...xs, [u, -minReach]], 0, INF);              // t + N·u ≥ 0 with N = −minReach
      addRow([[sv, 1], [u, sMax]], -INF, sMax);              // s ≤ sMax·(1 − u)
    }
    floorCols[d] = { f, k, sMax, y, s: sv, u };
  }
  for (const s of Object.keys(xIndex)) {                        // one per slot: = 1 when required and worn, else ≤ 1
    const req = !optional.has(s) && current[s] && current[s].slot === s;
    addRow(xIndex[s].map((j) => [j, 1]), req ? 1 : -INF, 1);
  }
  const twoH = (xIndex.twoHanded || []).filter((j) => cols[j].item.twoHanded === true), oneH = xIndex.oneHanded || [];
  if (twoH.length && oneH.length) addRow([...twoH, ...oneH].map((j) => [j, 1]), -INF, 1);   // a two-hander forbids the one-hand slot

  const model = { numCols: cols.length, numRows: rowLower.length, sense: "maximize", offset: 0, colCost, colLower, colUpper, rowLower, rowUpper,
    matrix: { format: "csr", numRows: rowLower.length, numCols: cols.length, starts, indices, values }, integrality };
  return { cols, xIndex, dims, unreachableFloors, hardRows, scoreOffset, capCols, floorCols, model };
}

// ---- MIP start, extraction, and no-good cut ----
//
// startVector, pickedOf and noGoodRow all work only off the built model (no profile access):
// buildSuitMip hands startVector each dim's cap/floor metadata directly (`capCols`/`floorCols`),
// rather than making it reverse-engineer that from the CSR matrix, so it stays a pure, cheap
// function of (built, assignment).

export function startVector(built, assignment = {}) {
  const { cols, xIndex, dims, capCols, floorCols, model } = built;
  const vec = new Float64Array(model.numCols);
  const totals = Object.fromEntries(dims.map((d) => [d, 0]));
  for (const s of Object.keys(xIndex)) {
    const item = assignment[s];
    for (const j of xIndex[s]) {
      if (item && cols[j].item.serial === item.serial) {
        vec[j] = 1;
        for (const d of dims) totals[d] += cols[j].item.props[d] || 0;
      }
    }
  }
  for (const d of dims) {
    const t = totals[d];
    const cc = capCols[d];
    if (cc) vec[cc.col] = Math.min(t, cc.cap);
    const fc = floorCols[d];
    if (!fc) continue;
    const met = fc.y != null && t >= fc.f;
    if (fc.y != null) vec[fc.y] = met ? 1 : 0;
    vec[fc.s] = met ? 0 : fc.k * Math.max(0, t);
    if (fc.u != null) vec[fc.u] = t < 0 ? 1 : 0;
  }
  return vec;
}

export function pickedOf(built, colValue) {
  const out = {};
  for (const s of Object.keys(built.xIndex)) {
    for (const j of built.xIndex[s]) if (colValue[j] > 0.5) out[s] = built.cols[j].item;
  }
  return out;
}

// The proper cut Σ_picked x − Σ_unpicked x ≤ |picked| − 1 over every x column (mip-spike.mjs's
// KBEST inline text construction, reproduced over the sparse columns instead of LP text).
export function noGoodRow(built, picked) {
  const indices = [], values = [];
  let n = 0;
  for (const s of Object.keys(built.xIndex)) {
    if (picked[s]) n++;
    for (const j of built.xIndex[s]) { indices.push(j); values.push(picked[s] && built.cols[j].item.serial === picked[s].serial ? 1 : -1); }
  }
  return { lower: -Infinity, upper: n - 1, indices, values };
}
