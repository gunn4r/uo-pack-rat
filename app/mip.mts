// mip.mts — the suit problem as a mixed-integer program, built as HiGHS sparse (CSR) arrays. Pure:
// no solver import here (app/mip-solve.mts owns the runtime). Every modelling choice reproduces
// app/bench/mip-spike.mts, which was validated to the decimal against the core's proven optima —
// see docs/solver.md for the model and app/bench/REPORT.md for the evidence.
import { GEAR_SLOTS, REQUIRED_SLOTS, RESIST_SKILL_KEY, RESIST_STEP_SLACK, type OptItem, type ResistStep } from "./vault-lib.mts";

export const HARD_FLOOR_BONUS = 1e7;   // == scripts/optimizer-core.mts HARD_FLOOR_BONUS
// Every gear slot (issue #202); all but the five armor pieces may be left empty. The core keeps its own copy (it
// imports nothing), and app/solver.test.mts checks the two agree.
export const DEFAULT_SLOTS: string[] = GEAR_SLOTS;
export const DEFAULT_OPTIONAL_SLOTS: string[] = GEAR_SLOTS.filter((s) => !REQUIRED_SLOTS.includes(s));
// A search's optional slots: the defaults less `keep` (the locked or pinned slots) and less a slot, the hands aside,
// whose worn piece has no properties at all. Such a piece ties with wearing nothing, so the search would plan plain
// boots or a shirt off for no gain and list every on/off mix as another suit of the same score; the hands stay
// optional for the two-hander rule.
export function optionalSlotsFor(current: Partial<Record<string, OptItem | null | undefined>>, keep: readonly string[] = []): string[] {
  const plainWorn = (s: string): boolean => !!current[s] && s !== "oneHanded" && s !== "twoHanded" && !Object.values(current[s]!.props).some(Boolean);
  return DEFAULT_OPTIONAL_SLOTS.filter((s) => !keep.includes(s) && !plainWorn(s));
}
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
  kind: "x" | "c" | "z" | "y" | "s" | "u" | "a" | "v" | "b" | "h";
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
  mins?: Record<string, number> | undefined;   // a value the property never falls below (scripts/optimizer-core.mts OptProfile.mins)
  ssiSteps?: Array<{ ssi: number; stam: number; credit: number }> | undefined;   // SSI by swing step (scripts/optimizer-core.mts OptProfile)
  resistSteps?: ResistStep[] | undefined;   // the minimums a suit's own Resisting Spells bonus lifts each resist to (vault-lib.mts EffectiveProfile)
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
// A property held up to a min (MipProfile.mins): v is what it scores, max(min, min(t, cap)); b, with a positive weight, is 1 when the suit's own total counts, 0 when the min does. `lifts`: with Resisting Spells steps, the min at each step (BuiltMip.resistStepCols' order), `min` the one below them. `col` is -1 when the term is the min alone (no v column: the step binaries carry its cost).
export interface MinCol {
  col: number;
  b: number | null;
  min: number;
  cap: number;
  lifts?: number[] | undefined;
}
export interface FloorCol {
  f: number;
  k: number;
  sMax: number;
  y: number | null;
  s: number;
  u: number | null;
  h?: number | undefined;   // the Resisting Spells step binary whose min meets this floor, when one does
}

export interface BuiltMip {
  cols: MipCol[];
  xIndex: Record<string, number[]>;
  dims: string[];
  unreachableFloors: string[];
  reach: Record<string, { max: number; min: number }>;   // propertyReach for every dimension: what the floors were tested against
  hardRows: Record<string, number>;
  scoreOffset: number;
  capCols: Record<string, CapCol>;
  minCols: Record<string, MinCol>;
  floorCols: Record<string, FloorCol>;
  stepCols: StepCol[];   // SSI by step: one binary per point, empty when steps are off
  resistStepCols: ResistStepCol[];   // Resisting Spells steps: one binary per step the pool's bonus reaches, empty with none
  model: MipModel;
}
export interface StepCol { col: number; ssi: number; stam: number }
// h = 1 when the suit's Resisting Spells bonus total reaches `at` (less RESIST_STEP_SLACK).
export interface ResistStepCol { col: number; at: number }

// Each slot's candidates, as the model's x columns take them: the pool's pieces for that slot, each serial once (as optCandidatesFor), and the worn piece always (keep what you wear). Slots with none are left out.
function slotCandidates(pools: Partial<Record<string, OptItem[]>>, current: Partial<Record<string, OptItem | null | undefined>>, slots: string[]): Record<string, OptItem[]> {
  const out: Record<string, OptItem[]> = {};
  for (const s of slots) {
    const seen = new Set<number>(), list: OptItem[] = [];
    for (const it of pools[s] || []) { if (it.slot === s && !seen.has(it.serial)) { seen.add(it.serial); list.push(it); } }
    const curItem = current[s];
    const cur = curItem && curItem.slot === s ? curItem : null;
    if (cur && !seen.has(cur.serial)) list.push(cur);
    if (list.length) out[s] = list;
  }
  return out;
}

// The range any suit's total can take in each key: `max` is the per-slot maxima summed, `min` the per-slot minima summed. For one property with no other constraint `max` is the exact optimum, since slots are independent apart from the hands rule, which it models: the two hand slots add up to the better of "a two-hander, one hand empty" and "no two-hander in twoHanded, plus the best one-hander" (summing both maxima would count a suit the hands row forbids). "Contribute 0" (leave the slot empty) is only a real option for an optional slot: a slot that is not optional and holds its worn piece takes the max over its own candidates, with no phantom 0 (mirrors scripts/optimizer-core.mts's suf/ext bound). `min` folds 0 in everywhere and ignores the two-hander rule; both only loosen it, and it is only ever used as a lower bound.
export function propertyReach(pools: Partial<Record<string, OptItem[]>>, current: Partial<Record<string, OptItem | null | undefined>>, optionalSlots: string[], slots: string[], keys: string[]): Record<string, { max: number; min: number }> {
  const cands = slotCandidates(pools, current, slots), optional = new Set(optionalSlots);
  const isRequired = (s: string): boolean => { const curItem = current[s]; return !optional.has(s) && !!curItem && curItem.slot === s; };
  const twoH = (cands.twoHanded || []).filter((it) => it.twoHanded === true), oneH = cands.oneHanded || [];
  const hands = twoH.length > 0 && oneH.length > 0;
  const out: Record<string, { max: number; min: number }> = {};
  for (const d of keys) {
    const val = (it: OptItem): number => it.props[d] || 0;
    const best = (s: string, its: OptItem[]): number => isRequired(s) ? Math.max(...its.map(val)) : Math.max(0, ...its.map(val));
    let max = 0, min = 0;
    for (const s of Object.keys(cands)) {
      if (!hands || (s !== "oneHanded" && s !== "twoHanded")) max += best(s, cands[s]!);
      min += Math.min(0, ...cands[s]!.map(val));
    }
    if (hands) {
      const noTwoHander = best("twoHanded", cands.twoHanded!.filter((it) => !twoH.includes(it))) + best("oneHanded", oneH);
      const twoHander = Math.max(...twoH.map(val)) + (isRequired("oneHanded") ? -INF : 0);
      max += Math.max(noTwoHander, twoHander);
    }
    out[d] = { max, min };
  }
  return out;
}

// The Resisting Spells steps a suit from this pool can reach: those whose `at` (less RESIST_STEP_SLACK) is no more than
// `max`, the most bonus any suit carries (propertyReach).
export function reachableResistSteps(steps: ResistStep[] | undefined, max: number): ResistStep[] {
  return (steps || []).filter((s) => s.at - RESIST_STEP_SLACK <= max);
}
// A profile with only the Resisting Spells steps this pool reaches (reachableResistSteps). With none left the field goes,
// so a pool without such pieces builds, scores and keys (runs-lib.mts runKey) exactly as before the steps existed.
export function withReachableResistSteps<P extends { resistSteps?: ResistStep[] | undefined }>(profile: P, pools: Partial<Record<string, OptItem[]>>, current: Partial<Record<string, OptItem | null | undefined>>, optionalSlots: string[] = DEFAULT_OPTIONAL_SLOTS, slots: string[] = DEFAULT_SLOTS): P {
  if (!profile.resistSteps) return profile;
  const kept = reachableResistSteps(profile.resistSteps, propertyReach(pools, current, optionalSlots, slots, [RESIST_SKILL_KEY])[RESIST_SKILL_KEY]!.max);
  const { resistSteps: _all, ...rest } = profile;
  return (kept.length ? { ...rest, resistSteps: kept } : rest) as P;
}

export function buildSuitMip({ pools = {}, current = {}, profile, optionalSlots = DEFAULT_OPTIONAL_SLOTS, slots = DEFAULT_SLOTS, hardAsSoft = false }: BuildSuitMipOptions): BuiltMip {
  const optional = new Set(optionalSlots);
  const W = profile.weights || {}, CAPS = profile.caps || {}, FL = profile.floors || {}, MINS = profile.mins || {};
  const hard = new Set(profile.hardFloors || []);
  const FB = typeof profile.floorBonus === "number" ? profile.floorBonus : 1000;
  const PARTIAL = typeof profile.floorPartial === "number" ? profile.floorPartial : 0.5;
  // SSI by step (scripts/optimizer-core.mts optScoreVector): with a positive SSI weight, the SSI term is w × the best credit among the points the suit reaches, in place of w·min(t, cap). It needs the Stamina pool's total too.
  const steps = Array.isArray(profile.ssiSteps) && (W.ssi || 0) > 0 ? profile.ssiSteps : null;
  const dims = [...new Set([...Object.keys(W), ...Object.keys(CAPS), ...Object.keys(FL), ...(steps ? ["ssi", "stamPool"] : [])])];

  // ---- columns ----
  const cols: MipCol[] = [], colCost: number[] = [], colLower: number[] = [], colUpper: number[] = [], integrality: number[] = [];
  const addCol = (col: MipCol, cost: number, lo: number, hi: number, integer: boolean): number => { cols.push(col); colCost.push(cost); colLower.push(lo); colUpper.push(hi); integrality.push(integer ? 1 : 0); return cols.length - 1; };
  const xIndex: Record<string, number[]> = {};
  for (const [s, list] of Object.entries(slotCandidates(pools, current, slots))) xIndex[s] = list.map((it, i) => addCol({ name: `x_${s}_${i}`, kind: "x", slot: s, item: it }, 0, 0, 1, true));
  const allX: number[] = Object.values(xIndex).flat();
  // A slot's x-columns are forced to exactly 1 (never "leave it empty") exactly when it is not
  // optional and its currently-worn item is one of its own candidates — the same predicate the
  // "one per slot" row below builds from, and propertyReach's.
  const isRequired = (s: string): boolean => {
    const curItem = current[s];
    return !optional.has(s) && !!curItem && curItem.slot === s;
  };
  // The hands row (added after the floors): a two-hander in the twoHanded slot excludes the one-hand slot.
  const twoH = (xIndex.twoHanded || []).filter((j) => cols[j]!.item!.twoHanded === true), oneH = xIndex.oneHanded || [];
  const hands = twoH.length > 0 && oneH.length > 0;

  // ---- rows (CSR) ----
  const rowLower: number[] = [], rowUpper: number[] = [], starts: number[] = [0], indices: number[] = [], values: number[] = [];
  const addRow = (entries: Term[], lo: number, hi: number): number => { for (const [j, v] of entries) { indices.push(j); values.push(v); } starts.push(indices.length); rowLower.push(lo); rowUpper.push(hi); return rowLower.length - 1; };
  let scoreOffset = 0;
  const reach = propertyReach(pools, current, optionalSlots, slots, dims);
  const unreachableFloors: string[] = [], hardRows: Record<string, number> = {}, capCols: Record<string, CapCol> = {}, minCols: Record<string, MinCol> = {}, floorCols: Record<string, FloorCol> = {}, stepCols: StepCol[] = [];
  // Resisting Spells steps (MipProfile.resistSteps): the min a resist is held at rises with the suit's Resisting Spells
  // bonus total S. One binary h_i per step the pool's bonus reaches, made only when a resist is weighted or floored:
  // h_i = 1 needs S ≥ τ_i (τ_i = at_i − RESIST_STEP_SLACK), written S − (τ_i − Smin)·h_i ≥ Smin. The min is then
  // m0 + Σ (L_i − L_{i−1})·h_i, with L_i the step's min and L_{−1} = m0. A negative resist weight would leave h at 0
  // to keep that min low, so its first use adds the rows that force h_i = 1 once S passes τ_i: S − (Smax − τ_i)·h_i ≤ τ_i.
  const rsReach = profile.resistSteps?.length ? propertyReach(pools, current, optionalSlots, slots, [RESIST_SKILL_KEY])[RESIST_SKILL_KEY]! : { max: 0, min: 0 };
  const rSteps = reachableResistSteps(profile.resistSteps, rsReach.max), resistStepCols: ResistStepCol[] = [];
  const liftsOf = (d: string): number[] | null => (rSteps.length && rSteps.every((st) => typeof st.mins[d] === "number") ? rSteps.map((st) => st.mins[d]!) : null);
  const rsXs: Term[] = rSteps.length ? allX.map((j): Term => [j, cols[j]!.item!.props[RESIST_SKILL_KEY] || 0]).filter(([, v]) => v !== 0) : [];
  if (dims.some((d) => liftsOf(d) && ((W[d] || 0) !== 0 || (FL[d] || 0) > 0))) {
    for (const [i, st] of rSteps.entries()) {
      const h = addCol({ name: `h_${i}`, kind: "h", dim: RESIST_SKILL_KEY }, 0, 0, 1, true), tau = st.at - RESIST_STEP_SLACK;
      resistStepCols.push({ col: h, at: st.at });
      addRow([...rsXs, [h, -(tau - rsReach.min)]], rsReach.min, INF);
    }
  }
  let forced = false;
  const forceSteps = (): void => {
    if (forced) return;
    forced = true;
    for (const { col, at } of resistStepCols) addRow([...rsXs, [col, -(rsReach.max - (at - RESIST_STEP_SLACK))]], -INF, at - RESIST_STEP_SLACK);
  };
  for (const d of dims) {
    // a floor at or under the property's min is met by every suit: dropped, as the core drops it
    const w = W[d] || 0, cap = CAPS[d], m = MINS[d], f = m != null && (FL[d] || 0) <= m ? 0 : FL[d] || 0;
    // Every j in allX is an x column, which always carries `item` (set in the loop above) — the two
    // `!` below are in range by construction, not an unchecked assumption about caller input.
    const xs: Term[] = allX.map((j): Term => [j, cols[j]!.item!.props[d] || 0]).filter(([, v]) => v !== 0);
    // The range any suit's total can take (propertyReach): the floors below test against `max`, and the big-M rows use both.
    const { max: reachD, min: minReach } = reach[d]!;
    // with Resisting Spells steps: each step's min, and m0, the min below them (with no min of its own, one no suit's own total falls under)
    const lifts = resistStepCols.length ? liftsOf(d) : null;
    const m0 = lifts ? m ?? Math.min(minReach, cap ?? INF, lifts[0]!) : 0;
    const liftTerms = (): Term[] => lifts!.map((L, i): Term => [resistStepCols[i]!.col, -(L - (i ? lifts![i - 1]! : m0))]);
    if (steps && d === "ssi") {
      // one binary a_p per point, worth w·credit_p; at most one pays (the maximum picks the best the suit reaches), and a_p = 1 forces t_ssi ≥ ssi_p and t_stam ≥ stam_p, each in the floor rows' form t − (v − minReach)·a ≥ minReach. A requirement at or below the lowest total any suit reaches needs no row.
      const stamXs: Term[] = allX.map((j): Term => [j, cols[j]!.item!.props.stamPool || 0]).filter(([, v]) => v !== 0);
      const stamMin = reach.stamPool!.min;
      for (const [i, pt] of steps.entries()) {
        const a = addCol({ name: `a_${i}`, kind: "a", dim: d }, w * pt.credit, 0, 1, true);
        stepCols.push({ col: a, ssi: pt.ssi, stam: pt.stam });
        if (pt.ssi > minReach) addRow([...xs, [a, -(pt.ssi - minReach)]], minReach, INF);
        if (pt.stam > stamMin) addRow([...stamXs, [a, -(pt.stam - stamMin)]], stamMin, INF);
      }
      if (stepCols.length) addRow(stepCols.map(({ col }): Term => [col, 1]), -INF, 1);
    } else if (w > 0 && lifts) {
      // w·max(M, min(t, cap)) with M = m0 + Σ ΔL·h, top = min(cap, reach) and Mmax the last step's min. Where no suit's
      // own total gets past m0 the term is M itself: w·m0 into scoreOffset and w·ΔL_i on h_i. Else, as with a plain min,
      // a binary b: b = 1 holds v ≤ top and v ≤ t, b = 0 holds v ≤ M, each with the other side relaxed by its widest gap.
      const top = Math.min(cap ?? INF, reachD), mMax = lifts[lifts.length - 1]!;
      if (top <= m0) {
        scoreOffset += w * m0;
        for (const [j, v] of liftTerms()) colCost[j]! -= w * v;
        minCols[d] = { col: -1, b: null, min: m0, cap: cap ?? INF, lifts };
      } else {
        const v = addCol({ name: `v_${d}`, kind: "v", dim: d }, w, -INF, INF, false);
        const b = addCol({ name: `b_${d}`, kind: "b", dim: d }, 0, 0, 1, true);
        const k1 = Math.max(0, mMax - top), k2 = top - m0, k3 = Math.max(0, mMax - minReach);
        addRow([[v, 1], [b, k1]], -INF, top + k1);
        addRow([[v, 1], ...liftTerms(), [b, -k2]], -INF, m0);
        addRow([[v, 1], ...xs.map(([j, val]): Term => [j, -val]), [b, k3]], -INF, k3);
        minCols[d] = { col: v, b, min: m0, cap: cap ?? INF, lifts };
      }
    } else if (w !== 0) {
      // A min some suit could fall under: w·max(m, min(t, cap)). It is the constant w·m when no suit gets past m, which
      // includes a cap at or under m whatever the totals (min(t, cap) never passes it).
      const lift = m != null && minReach < m, top = Math.min(cap ?? INF, reachD), mm = m ?? 0;
      if (m != null && top <= mm && !lifts) scoreOffset += w * mm;
      else if (lift && w > 0) {
        // maximising a max needs a binary b: b = 1 lets v reach min(t, cap) (v ≤ t, v ≤ top), b = 0 holds v ≤ m; the
        // better of the two is max(m, min(t, cap)). Written v ≤ m + (top − m)·b and v − t ≤ (m − minReach)·(1 − b).
        const v = addCol({ name: `v_${d}`, kind: "v", dim: d }, w, -INF, INF, false);
        const b = addCol({ name: `b_${d}`, kind: "b", dim: d }, 0, 0, 1, true);
        addRow([[v, 1], [b, -(top - mm)]], -INF, mm);
        addRow([[v, 1], ...xs.map(([j, val]): Term => [j, -val]), [b, mm - minReach]], -INF, mm - minReach);
        minCols[d] = { col: v, b, min: mm, cap: cap ?? INF };
      } else {
        // a negative weight drives v down to max(m, ·) on its own: v ≥ m (its lower bound) and v ≥ min(t, cap), the
        // c column below (pinned to min(t, cap) by z) or t itself when uncapped
        // with Resisting Spells steps, v ≥ M = m0 + Σ ΔL·h, the step binaries forced to what the suit reaches
        const v = lifts ? addCol({ name: `v_${d}`, kind: "v", dim: d }, w, -INF, INF, false) : lift ? addCol({ name: `v_${d}`, kind: "v", dim: d }, w, mm, INF, false) : null;
        if (lifts) { forceSteps(); addRow([[v!, 1], ...liftTerms()], m0, INF); }
        if (v != null) minCols[d] = { col: v, b: null, min: lifts ? m0 : mm, cap: cap ?? INF, ...(lifts ? { lifts } : {}) };
        if (Number.isFinite(cap)) {                                 // w·min(t, cap): c ≤ t, c ≤ cap, objective w·c; c may go negative like t
          // Number.isFinite(number: unknown) is not a type predicate, so TS can't narrow `cap` itself
          // from the check just above — re-reading the same CAPS[d] (never mutated in between) into a
          // shadowed, honestly-typed `cap` restores plain `cap` use (incl. the `capCols` shorthand)
          // for the rest of this block, in range by construction rather than asserted.
          const cap = CAPS[d] as number;
          const c = addCol({ name: `c_${d}`, kind: "c", dim: d }, v != null ? 0 : w, -INF, cap, false);
          addRow([[c, 1], ...xs.map(([j, v]): Term => [j, -v])], -INF, 0);
          // A positive weight drives c up to min(t, cap) on its own (min is concave, and we maximise).
          // A negative one would drive c down without limit, so a binary z pins c to min(t, cap) from
          // below as well: c ≥ t − M1·z and c ≥ cap − M2·(1 − z), with M1 = reach − cap and
          // M2 = cap − minReach the widest either gap can be. z = 0 forces c = t (so t ≤ cap), z = 1
          // forces c = cap (so t ≥ cap).
          let z: number | null = null;
          if (w < 0) {
            const M1 = Math.max(0, reachD - cap), M2 = Math.max(0, cap - minReach);
            z = addCol({ name: `z_${d}`, kind: "z", dim: d }, 0, 0, 1, true);
            addRow([[c, 1], ...xs.map(([j, v]): Term => [j, -v]), [z, M1]], 0, INF);
            addRow([[c, 1], [z, -M2]], cap - M2, INF);
          }
          capCols[d] = { col: c, cap, z };
          if (v != null) addRow([[v, 1], [c, -1]], 0, INF);
        } else if (v != null) {
          addRow([[v, 1], ...xs.map(([j, val]): Term => [j, -val])], 0, INF);
        } else {                                                    // uncapped: linear, aggregated per column
          for (const [j, v] of xs) colCost[j]! += w * v;
        }
      }
    }
    if (f <= 0) continue;
    // a Resisting Spells step whose min meets the floor meets it whatever the total: its binary h lifts the met row by f − minReach
    const li = lifts ? lifts.findIndex((L) => L >= f) : -1, h = li >= 0 ? resistStepCols[li]!.col : null, hLift: Term[] = h != null ? [[h, Math.max(0, f - minReach)]] : [];
    // a floor above the per-slot maxima (and every step's min) can never be met, so its met-indicator is 0 for every suit
    const isHard = hard.has(d), unreachable = reachD < f && h == null;
    if (isHard && !hardAsSoft && !unreachable) { hardRows[d] = addRow([...xs, ...hLift], f, INF); scoreOffset += HARD_FLOOR_BONUS; continue; }
    if (unreachable && isHard) unreachableFloors.push(d);
    // soft floor (or an unreachable / hardAsSoft hard floor): bonus·y + s with t ≥ f·y, s ≤ k·t, s ≤ bonus·partial·(1 − y)
    const bonus = isHard ? HARD_FLOOR_BONUS : FB, k = bonus * PARTIAL / f, sMax = bonus * PARTIAL;
    const y = unreachable ? null : addCol({ name: `y_${d}`, kind: "y", dim: d }, bonus, 0, 1, true);
    const sv = addCol({ name: `s_${d}`, kind: "s", dim: d }, 1, 0, sMax, false);
    // "met" row, t ≥ f·y written as t − (f − minReach)·y ≥ minReach: y = 1 still forces t ≥ f, and
    // y = 0 leaves t free down to the lowest total any suit reaches (a plain t − f·y ≥ 0 would forbid
    // every negative-total suit outright, although the core scores it: no credit on this floor, the
    // rest of the suit counted as usual).
    if (y != null) addRow([...xs, [y, -(f - minReach)], ...hLift], minReach, INF);
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
    floorCols[d] = { f, k, sMax, y, s: sv, u, ...(h != null ? { h } : {}) };
  }
  for (const s of Object.keys(xIndex)) addRow(xIndex[s]!.map((j) => [j, 1]), isRequired(s) ? 1 : -INF, 1);   // one per slot: = 1 when required and worn, else ≤ 1
  if (hands) addRow([...twoH, ...oneH].map((j) => [j, 1]), -INF, 1);   // a two-hander forbids the one-hand slot

  const model: MipModel = { numCols: cols.length, numRows: rowLower.length, sense: "maximize", offset: 0, colCost, colLower, colUpper, rowLower, rowUpper,
    matrix: { format: "csr", numRows: rowLower.length, numCols: cols.length, starts, indices, values }, integrality };
  return { cols, xIndex, dims, unreachableFloors, reach, hardRows, scoreOffset, capCols, minCols, floorCols, stepCols, resistStepCols, model };
}

// ---- the tie-break's second stage (issue #262) ----
// The model the second stage solves, from the first stage's model and its suit as `startVector` gives it (every column
// worked out from the suit's own totals, so a floor the suit meets has its indicator at 1 even when an unproven
// incumbent left it at 0): minimize the summed tie cost of the picked pieces (each x column's item.tieCost) over the
// suits that score at least that suit less `tolerance` and meet every floor it meets. Three changes to a copy of
// `built.model`: (1) the objective is the tie costs, minimized; (2) each floor-met indicator (y) at 1 is fixed at 1, hard
// floors in the hardAsSoft model included; (3) one score row, Σ c_j·v_j ≥ S − tolerance − TIE_SLACK, with c the first
// stage's objective and S its value at the suit. The row leaves out the fixed y's (constant on both sides) and an unfixed
// hardAsSoft y (worth 1e7: a suit meeting one more hard floor would outscore the best), but keeps an unfixed soft floor's
// y: a suit that meets one more soft floor gains its bonus, and without it the row would cut that suit. When no column
// is left (a floors-only build) there is no row. The suit itself is feasible here, so it is the stage's MIP start.
// TIE_SLACK is the solvers' score precision (HiGHS's mip_abs_gap): scores closer than this are equal suits, in this row,
// in the core's tie-break (scripts/optimizer-core.mts keeps its own copy) and in the exact solver's guards. With 1e-6
// HiGHS's presolve called a row the suit meets exactly infeasible.
export const TIE_SLACK = 1e-3;
export function tieBreakModel(built: BuiltMip, start: ArrayLike<number>, tolerance: number): BuiltMip {
  const m = built.model, cost = m.colCost, isY = (j: number): boolean => built.cols[j]!.kind === "y";
  const colCost = built.cols.map((c) => (c.kind === "x" ? c.item!.tieCost || 0 : 0));
  const colLower = m.colLower.map((lo, j) => (isY(j) && start[j]! > 0.5 ? 1 : lo));
  const terms: Term[] = [];
  let score = 0;
  for (let j = 0; j < m.numCols; j++) {
    if (cost[j] === 0 || (isY(j) && (colLower[j]! >= 1 || cost[j]! >= HARD_FLOOR_BONUS))) continue;
    terms.push([j, cost[j]!]); score += cost[j]! * start[j]!;
  }
  const rowLower = [...m.rowLower], rowUpper = [...m.rowUpper], starts = [...m.matrix.starts], indices = [...m.matrix.indices], values = [...m.matrix.values];
  if (terms.length) {
    for (const [j, v] of terms) { indices.push(j); values.push(v); }
    starts.push(indices.length);
    rowLower.push(score - Math.max(0, tolerance) - TIE_SLACK);
    rowUpper.push(INF);
  }
  const numRows = rowLower.length;
  return { ...built, model: { ...m, sense: "minimize", offset: 0, colCost, colLower, numRows, rowLower, rowUpper, matrix: { format: "csr", numRows, numCols: m.numCols, starts, indices, values } } };
}

// ---- MIP start, extraction, and no-good cut ----
//
// startVector, pickedOf and noGoodRow all work only off the built model (no profile access):
// buildSuitMip hands startVector each dim's cap/floor metadata directly (`capCols`/`floorCols`),
// rather than making it reverse-engineer that from the CSR matrix, so it stays a pure, cheap
// function of (built, assignment).

export function startVector(built: BuiltMip, assignment: Partial<Record<string, OptItem>> = {}): Float64Array {
  const { cols, xIndex, dims, capCols, minCols, floorCols, stepCols, resistStepCols = [], model } = built;
  const vec = new Float64Array(model.numCols);
  const totals = Object.fromEntries(dims.map((d) => [d, 0]));
  let bonus = 0;   // the Resisting Spells bonus total, for the steps
  for (const s of Object.keys(xIndex)) {
    const item = assignment[s];
    for (const j of xIndex[s]!) {
      // Every j in xIndex[s] is one of this slot's x columns, which always carries `item`.
      if (item && cols[j]!.item!.serial === item.serial) {
        vec[j] = 1;
        // Every d here comes from `dims`, the same array totals was built from — always present.
        for (const d of dims) totals[d]! += cols[j]!.item!.props[d] || 0;
        bonus += cols[j]!.item!.props[RESIST_SKILL_KEY] || 0;
      }
    }
  }
  let reached = -1;
  for (const [i, rc] of resistStepCols.entries()) if (bonus >= rc.at - RESIST_STEP_SLACK) { vec[rc.col] = 1; reached = i; }
  for (const d of dims) {
    const t = totals[d]!;
    const cc = capCols[d];
    if (cc) vec[cc.col] = Math.min(t, cc.cap);
    if (cc && cc.z != null) vec[cc.z] = t >= cc.cap ? 1 : 0;
    const mc = minCols[d];
    if (mc && mc.col >= 0) {
      const own = Math.min(t, mc.cap), min = mc.lifts && reached >= 0 ? mc.lifts[reached]! : mc.min;
      vec[mc.col] = Math.max(min, own);
      if (mc.b != null) vec[mc.b] = own > min ? 1 : 0;
    }
    const fc = floorCols[d];
    if (!fc) continue;
    const met = fc.y != null && (t >= fc.f || (fc.h != null && vec[fc.h]! > 0.5));
    if (fc.y != null) vec[fc.y] = met ? 1 : 0;
    vec[fc.s] = met ? 0 : fc.k * Math.max(0, t);
    if (fc.u != null) vec[fc.u] = t < 0 ? 1 : 0;
  }
  // the best-paying point the start suit reaches
  let bestStep: StepCol | null = null;
  for (const p of stepCols) {
    if (totals.ssi! >= p.ssi - 1e-9 && totals.stamPool! >= p.stam - 1e-9 && (!bestStep || model.colCost[p.col]! > model.colCost[bestStep.col]!)) bestStep = p;
  }
  if (bestStep) vec[bestStep.col] = 1;
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
