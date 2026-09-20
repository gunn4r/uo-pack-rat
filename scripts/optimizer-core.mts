// ============================================================================
// optimizer-core.mts — whole-suit gear optimizer CORE.
// ----------------------------------------------------------------------------
// PURE LOGIC ONLY. No game globals (no `player`, `client`, `Gump`, ...), no imports, no
// top-level exports — this file is meant to be PASTED INLINE into a game script, so it is
// written as plain interfaces + function declarations. Everything is deterministic given a
// seed (mulberry32 — `Math.random` is banned in the sandbox and is never called here).
//
// The problem: you have ~30 candidate items per slot across 12 slots. Exhaustive search is
// 30^12. The point of optimizing a SET rather than each slot independently is that scoring is
// NOT separable — a property that is already at its cap contributes ZERO more, and resist
// FLOORS ("all five resists >= 65") are a whole-suit property that individually-inferior
// pieces can reach together. So per-item greedy is provably wrong and the search has to move
// in set space.
//
// Search = multi-start steepest-ascent hill climbing over single-slot swaps, with the
// one/two-handed weapon pair re-optimized exhaustively as a single structural move. Seeds:
// greedy, the currently equipped suit, a GRADIENT seed (see optGradientProfile below), and N
// seeded-random restarts. Best local optimum wins.
//
// Companion offline test: optimizer-core.test.mts (`node scripts/optimizer-core.test.mts`).
// ============================================================================

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// One candidate piece of gear. `props` is an open bag of mod name -> magnitude, e.g.
// { physResist: 12, fireResist: 8, dci: 5, hci: 10, ssi: 5, di: 25, lmc: 3, stamInc: 7 }.
// `twoHanded: true` marks a TWO-HANDED WEAPON (not a shield). Shields live on the twoHanded
// slot with `twoHanded` falsy — a shield occupies the same slot as a two-handed weapon, which is
// how the UO equip model treats hands.
interface OptItem {
  serial: number;
  name: string;
  slot: string;
  twoHanded?: boolean;
  props: Record<string, number>;
}

// A full suit: slot name -> item, or null for "nothing equipped there".
interface OptAssignment {
  [slot: string]: OptItem | null;
}

// Scoring configuration. `weights[p]` is the value of one point of property p. `caps[p]` is
// the hard cap past which extra points are worthless (resists 70, HCI/DCI 45, LMC 40 ...);
// a property with no cap entry is uncapped. `floors[p]` is a whole-suit minimum that earns
// `floorBonus` when met and partial credit `floorBonus * floorPartial * (total/floor)` when
// not — the partial term is what gives the hill climber a gradient to follow toward a floor
// it has not reached yet, while the jump at the floor is what makes reaching it decisive.
interface OptProfile {
  weights?: Record<string, number> | undefined;   // optional: every read is `profile.weights || {}`
  caps: Record<string, number>;
  floors?: Record<string, number> | undefined;
  floorBonus?: number;
  floorPartial?: number;
  hardFloors?: string[] | undefined;    // floors that act as requirements: their bonus is HARD_FLOOR_BONUS, so no mix of other gains can buy a miss
}
const HARD_FLOOR_BONUS = 1e7;

interface OptOptions {
  seed?: number;          // PRNG seed; same seed => byte-identical result
  restarts?: number;      // seeded-random restart count (default 200; ~100ms at 12 slots x 30 candidates)
  maxPasses?: number;     // safety bound on hill-climb passes per start (default 200)
  slots?: string[];       // slot universe (default optDefaultSlots())
  optionalSlots?: string[]; // slots where "equip nothing" is a legal choice
  yieldFn?: () => void;   // called between search starts — lets a sandboxed caller sleep() so a CPU watchdog doesn't kill sustained compute. Does not affect results (search order is fixed).
  yieldEvery?: number;    // search starts between yieldFn calls (default 1)
  exact?: boolean;        // after the heuristic, run dominance pruning + branch-and-bound (proves the optimum or reports best-within-budget)
  timeBudgetMs?: number;  // wall-clock budget for the exact phase (default 15000)
  onProgress?: (p: OptProgress) => void;  // live progress, throttled to progressEveryMs (default 250); never affects results
  progressEveryMs?: number;
  warmStart?: Record<string, number | null>;  // slot -> serial of an earlier best suit; mapped onto this run's candidates and used as one more search start
  alternatives?: { count: number; tolerance: number };  // exact phase: also list up to `count` other suits scoring within `tolerance` of the best (0 = exact ties)
}

// Progress snapshot handed to onProgress. `explored` is the fraction of the exact search tree
// already behind the search (visited OR pruned away), so it is a real 0..1 progress measure that
// reaches 1 only when the optimum is proven.
interface OptProgress {
  phase: string;            // "heuristic" | "prune" | "exact" | "done"
  elapsedMs: number;
  restartsDone: number;
  restarts: number;
  nodes: number;
  explored: number;
  budgetMs: number;
  improvements: number;     // times the incumbent improved (heuristic starts + exact leaves)
  lastImprovementMs: number;
  bestScore: number;
  currentScore: number;
  floorsMet: number;
  floorsTotal: number;
  candidates: number;       // candidate items in play (after pruning once that has run)
}

interface OptSlotChange {
  slot: string;
  from: string | null;
  fromSerial: number;
  to: string | null;
  toSerial: number;
  gainedProps: Record<string, number>;
}

interface OptResult {
  best: OptAssignment;
  score: number;
  currentScore: number;
  greedyScore: number;
  delta: number;
  perSlotChanges: OptSlotChange[];
  totals: { before: Record<string, number>; after: Record<string, number> };
  seed: number;
  restarts: number;
  evaluations: number;
  method?: string;        // "heuristic" | "exact"
  proven?: boolean | undefined;       // exact phase finished the whole tree: this is the optimum for the given pools/profile
  nodes?: number | undefined;         // branch-and-bound nodes visited
  pruned?: { before: number; after: number } | undefined;   // candidate counts before/after dominance pruning
  alternatives?: { best: OptAssignment; score: number }[] | undefined;   // other suits within altTolerance of the best, best first (never the best itself)
  altTolerance?: number | undefined;
}

// Internal: a flattened property space so scoring is an array loop instead of object churn.
interface OptSpace {
  keys: string[];
  index: Record<string, number>;
  w: number[];
  cap: number[];
  floor: number[];
  floorBonusArr: number[];  // per-dimension bonus (floorBonus, or HARD_FLOOR_BONUS for hard floors)
  floorBonus: number;
  floorPartial: number;
  zero: number[];
  vecCache: Map<OptItem, number[]>;
  evals: number;
}

// ---------------------------------------------------------------------------
// Deterministic PRNG (mulberry32). Math.random is banned in the sandbox and unusable for
// reproducible results anyway.
// ---------------------------------------------------------------------------

function optMulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function (): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Slot model
// ---------------------------------------------------------------------------

// The 12 slots we optimize. `oneHanded` is the weapon layer; `twoHanded` holds EITHER a shield
// OR a two-handed weapon.
function optDefaultSlots(): string[] {
  return ["helmet", "chest", "arms", "hands", "legs", "neck", "ring", "bracelet", "talisman", "cloak", "oneHanded", "twoHanded"];
}

// Slots where wearing nothing is a legitimate choice rather than a hole to be filled.
function optDefaultOptionalSlots(): string[] {
  return ["cloak", "talisman", "ring", "bracelet", "neck", "oneHanded", "twoHanded"];
}

function optIsTwoHandedWeapon(it: OptItem | null): boolean {
  return !!it && it.twoHanded === true;
}

// The structural rule: a two-handed weapon on the twoHanded layer forbids anything on the
// oneHanded layer. A shield (twoHanded falsy) coexists with a one-handed weapon.
function optIsValidAssignment(a: OptAssignment): boolean {
  const th = a["twoHanded"] || null;
  const oh = a["oneHanded"] || null;
  if (optIsTwoHandedWeapon(th) && oh) return false;
  const slots = Object.keys(a);
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i]!;
    const it = a[s];
    if (it && it.slot !== s) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Property space + scoring
// ---------------------------------------------------------------------------

function optCollectKeys(pools: Record<string, OptItem[]>, current: OptAssignment, profile: OptProfile): string[] {
  const seen: Record<string, boolean> = {};
  const out: string[] = [];
  const add = function (k: string): void {
    if (!seen[k]) { seen[k] = true; out.push(k); }
  };
  // Profile keys first, in a stable order, so the space layout does not depend on pool order.
  const wk = Object.keys(profile.weights || {}).sort();
  for (let i = 0; i < wk.length; i++) add(wk[i]!);
  const ck = Object.keys(profile.caps || {}).sort();
  for (let i = 0; i < ck.length; i++) add(ck[i]!);
  const fk = Object.keys(profile.floors || {}).sort();
  for (let i = 0; i < fk.length; i++) add(fk[i]!);
  const poolSlots = Object.keys(pools).sort();
  for (let i = 0; i < poolSlots.length; i++) {
    const list = pools[poolSlots[i]!] || [];
    for (let j = 0; j < list.length; j++) {
      const pk = Object.keys(list[j]!.props || {}).sort();
      for (let k = 0; k < pk.length; k++) add(pk[k]!);
    }
  }
  const curSlots = Object.keys(current || {}).sort();
  for (let i = 0; i < curSlots.length; i++) {
    const it = current[curSlots[i]!];
    if (!it) continue;
    const pk = Object.keys(it.props || {}).sort();
    for (let k = 0; k < pk.length; k++) add(pk[k]!);
  }
  return out;
}

function optBuildSpace(keys: string[], profile: OptProfile): OptSpace {
  const index: Record<string, number> = {};
  const w: number[] = [];
  const cap: number[] = [];
  const floor: number[] = [];
  const zero: number[] = [];
  const caps = profile.caps || {};
  const floors = profile.floors || {};
  const weights = profile.weights || {};
  const hard: Record<string, boolean> = {};
  const hardList = profile.hardFloors || [];
  for (let i = 0; i < hardList.length; i++) hard[hardList[i]!] = true;
  const baseBonus = typeof profile.floorBonus === "number" ? profile.floorBonus : 1000;
  const floorBonusArr: number[] = [];
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i]!;
    index[k] = i;
    w.push(typeof weights[k] === "number" ? weights[k] : 0);
    cap.push(typeof caps[k] === "number" ? caps[k] : Infinity);
    floor.push(typeof floors[k] === "number" ? floors[k] : 0);
    floorBonusArr.push(hard[k] ? HARD_FLOOR_BONUS : baseBonus);
    zero.push(0);
  }
  return {
    keys: keys,
    index: index,
    w: w,
    cap: cap,
    floor: floor,
    floorBonusArr: floorBonusArr,
    floorBonus: baseBonus,
    floorPartial: typeof profile.floorPartial === "number" ? profile.floorPartial : 0.5,
    zero: zero,
    vecCache: new Map(),
    evals: 0
  };
}

function optVec(it: OptItem | null, space: OptSpace): number[] {
  if (!it) return space.zero;
  const hit = space.vecCache.get(it);
  if (hit) return hit;
  const v: number[] = space.zero.slice();
  const props = it.props || {};
  const pk = Object.keys(props);
  for (let i = 0; i < pk.length; i++) {
    const idx = space.index[pk[i]!];
    if (idx === undefined) continue; // property outside the space contributes nothing
    v[idx]! += props[pk[i]!]!;
  }
  space.vecCache.set(it, v);
  return v;
}

// Score a totals VECTOR. Over-cap points are worth exactly zero — that is the whole reason
// this is a set-level problem.
function optScoreVector(totals: number[], space: OptSpace): number {
  space.evals++;
  let s = 0;
  for (let i = 0; i < totals.length; i++) {
    const t = totals[i]!;
    const c = space.cap[i]!;
    s += space.w[i]! * (t < c ? t : c);
    const f = space.floor[i]!;
    if (f > 0) {
      const fb = space.floorBonusArr[i]!;
      if (t >= f) s += fb;
      else s += fb * space.floorPartial * (t > 0 ? t / f : 0);
    }
  }
  return s;
}

// PUBLIC, fully pure scoring entry point. Accepts either an assignment object or a plain array
// of items (nulls tolerated). Builds its own property space every call, so it is O(items*props)
// and self-contained — the search uses an incremental fast path internally but must agree with
// this function exactly (asserted in the test).
function scoreSet(items: OptAssignment | (OptItem | null)[], profile: OptProfile): number {
  const list: (OptItem | null)[] = [];
  if (Array.isArray(items)) {
    for (let i = 0; i < items.length; i++) list.push(items[i] as OptItem | null);
  } else {
    const slots = Object.keys(items).sort();
    for (let i = 0; i < slots.length; i++) list.push(items[slots[i]!] as OptItem | null);
  }
  const seen: Record<string, boolean> = {};
  const keys: string[] = [];
  const addKeys = function (o: Record<string, number>): void {
    const ks = Object.keys(o || {}).sort();
    for (let i = 0; i < ks.length; i++) if (!seen[ks[i]!]) { seen[ks[i]!] = true; keys.push(ks[i]!); }
  };
  addKeys(profile.weights || {});
  addKeys(profile.caps || {});
  addKeys(profile.floors || {});
  for (let i = 0; i < list.length; i++) if (list[i]) addKeys((list[i] as OptItem).props);
  const space = optBuildSpace(keys, profile);
  const totals = space.zero.slice();
  for (let i = 0; i < list.length; i++) {
    const v = optVec(list[i] as OptItem | null, space);
    for (let j = 0; j < totals.length; j++) totals[j]! += v[j]!;
  }
  return optScoreVector(totals, space);
}

// Plain property totals for an assignment, for reporting (zero-valued props omitted).
function optAssignmentTotals(a: OptAssignment): Record<string, number> {
  const out: Record<string, number> = {};
  const slots = Object.keys(a).sort();
  for (let i = 0; i < slots.length; i++) {
    const it = a[slots[i]!];
    if (!it) continue;
    const props = it.props || {};
    const pk = Object.keys(props).sort();
    for (let j = 0; j < pk.length; j++) out[pk[j]!] = (out[pk[j]!] || 0) + props[pk[j]!]!;
  }
  const keys = Object.keys(out);
  for (let i = 0; i < keys.length; i++) if (out[keys[i]!] === 0) delete out[keys[i]!];
  return out;
}

// The GRADIENT profile: identical, but unmet floors pay FULL linear partial credit. Hill
// climbing under the real profile can stall short of a floor that needs two pieces changed at
// once (each piece alone looks worse). Optimizing under the gradient profile first, then
// re-climbing the result under the real profile, is a cheap continuation method that walks
// into the floor-satisfying basin deterministically instead of hoping a random restart lands
// in it. This is what makes the "two individually-inferior pieces" case solvable without luck.
function optGradientProfile(profile: OptProfile): OptProfile {
  return {
    weights: profile.weights,
    caps: profile.caps,
    floors: profile.floors,
    floorBonus: typeof profile.floorBonus === "number" ? profile.floorBonus : 1000,
    floorPartial: 1,
    hardFloors: profile.hardFloors
  };
}

// ---------------------------------------------------------------------------
// Candidate pools
// ---------------------------------------------------------------------------

// Candidates for a slot = the pool, plus the currently equipped piece (deduped by serial),
// plus null when leaving the slot empty is legal. Order is stable, which is half of determinism.
function optCandidatesFor(slot: string, pools: Record<string, OptItem[]>, current: OptAssignment, optional: Record<string, boolean>): (OptItem | null)[] {
  const out: (OptItem | null)[] = [];
  const seenSerial: Record<string, boolean> = {};
  const pool = pools[slot] || [];
  for (let i = 0; i < pool.length; i++) {
    const it = pool[i]!;
    if (it.slot !== slot) continue;
    if (seenSerial[String(it.serial)]) continue;
    seenSerial[String(it.serial)] = true;
    out.push(it);
  }
  const cur = current ? current[slot] || null : null;
  if (cur && cur.slot === slot && !seenSerial[String(cur.serial)]) {
    seenSerial[String(cur.serial)] = true;
    out.push(cur);
  }
  if (optional[slot] || out.length === 0 || !cur) out.push(null);
  return out;
}

// ---------------------------------------------------------------------------
// Search internals — an assignment is carried as a parallel (items, totals) pair so a swap is
// an O(props) vector edit instead of a full rescore.
// ---------------------------------------------------------------------------

function optTotalsOf(a: OptAssignment, slots: string[], space: OptSpace): number[] {
  const totals = space.zero.slice();
  for (let i = 0; i < slots.length; i++) {
    const v = optVec(a[slots[i]!] || null, space);
    for (let j = 0; j < totals.length; j++) totals[j]! += v[j]!;
  }
  return totals;
}

function optAddVec(totals: number[], v: number[], sign: number): void {
  for (let i = 0; i < totals.length; i++) totals[i]! += sign * v[i]!;
}

// Exhaustively re-optimize the weapon pair (oneHanded x twoHanded) against a fixed rest of the
// suit. This is the structural move: it is the only way to cross between "1H + shield" and
// "2H weapon", and it is cheap enough (|1H| x |2H|) to just brute force.
function optBestWeaponPair(totals: number[], a: OptAssignment, oneCands: (OptItem | null)[], twoCands: (OptItem | null)[], space: OptSpace): { one: OptItem | null; two: OptItem | null; score: number } {
  const curOne = a["oneHanded"] || null;
  const curTwo = a["twoHanded"] || null;
  optAddVec(totals, optVec(curOne, space), -1);
  optAddVec(totals, optVec(curTwo, space), -1);
  let bestOne: OptItem | null = null;
  let bestTwo: OptItem | null = null;
  let bestScore = -Infinity;
  for (let i = 0; i < twoCands.length; i++) {
    const two = twoCands[i] as OptItem | null;
    const vTwo = optVec(two, space);
    optAddVec(totals, vTwo, 1);
    if (optIsTwoHandedWeapon(two)) {
      // A two-hander forbids the one-handed layer entirely: exactly one combination to score.
      const s = optScoreVector(totals, space);
      if (s > bestScore) { bestScore = s; bestOne = null; bestTwo = two; }
    } else {
      for (let j = 0; j < oneCands.length; j++) {
        const one = oneCands[j] as OptItem | null;
        const vOne = optVec(one, space);
        optAddVec(totals, vOne, 1);
        const s = optScoreVector(totals, space);
        if (s > bestScore) { bestScore = s; bestOne = one; bestTwo = two; }
        optAddVec(totals, vOne, -1);
      }
    }
    optAddVec(totals, vTwo, -1);
  }
  // Restore the caller's totals exactly as handed in.
  optAddVec(totals, optVec(curOne, space), 1);
  optAddVec(totals, optVec(curTwo, space), 1);
  return { one: bestOne, two: bestTwo, score: bestScore };
}

// Steepest ascent: evaluate every single-slot swap plus the weapon-pair move, apply only the
// single best strictly-improving one, repeat until nothing improves. Strict improvement plus
// fixed iteration order keeps this deterministic (no tie-break coin flips).
function optLocalSearch(a: OptAssignment, slots: string[], cands: Record<string, (OptItem | null)[]>, space: OptSpace, maxPasses: number): { assignment: OptAssignment; score: number } {
  const EPS = 1e-9;
  const cur: OptAssignment = {};
  for (let i = 0; i < slots.length; i++) cur[slots[i]!] = a[slots[i]!] || null;
  const totals = optTotalsOf(cur, slots, space);
  let score = optScoreVector(totals, space);
  for (let pass = 0; pass < maxPasses; pass++) {
    let bestGain = EPS;
    let bestSlot = "";
    let bestItem: OptItem | null = null;
    let bestPair: { one: OptItem | null; two: OptItem | null; score: number } | null = null;
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i]!;
      if (slot === "oneHanded" || slot === "twoHanded") continue; // handled by the pair move
      const have = cur[slot] || null;
      const vHave = optVec(have, space);
      optAddVec(totals, vHave, -1);
      const list = cands[slot]!;
      for (let j = 0; j < list.length; j++) {
        const cand = list[j] as OptItem | null;
        if (cand === have) continue;
        const vC = optVec(cand, space);
        optAddVec(totals, vC, 1);
        const s = optScoreVector(totals, space);
        optAddVec(totals, vC, -1);
        if (s - score > bestGain) { bestGain = s - score; bestSlot = slot; bestItem = cand; bestPair = null; }
      }
      optAddVec(totals, vHave, 1);
    }
    const pair = optBestWeaponPair(totals, cur, cands["oneHanded"] || [null], cands["twoHanded"] || [null], space);
    if (pair.score - score > bestGain && (pair.one !== (cur["oneHanded"] || null) || pair.two !== (cur["twoHanded"] || null))) {
      bestGain = pair.score - score;
      bestPair = pair;
      bestSlot = "";
      bestItem = null;
    }
    if (bestPair) {
      optAddVec(totals, optVec(cur["oneHanded"] || null, space), -1);
      optAddVec(totals, optVec(cur["twoHanded"] || null, space), -1);
      cur["oneHanded"] = bestPair.one;
      cur["twoHanded"] = bestPair.two;
      optAddVec(totals, optVec(cur["oneHanded"], space), 1);
      optAddVec(totals, optVec(cur["twoHanded"], space), 1);
      score = bestPair.score;
    } else if (bestSlot) {
      optAddVec(totals, optVec(cur[bestSlot] || null, space), -1);
      cur[bestSlot] = bestItem;
      optAddVec(totals, optVec(bestItem, space), 1);
      score += bestGain;
    } else {
      break; // local optimum
    }
  }
  return { assignment: cur, score: optScoreVector(optTotalsOf(cur, slots, space), space) };
}

// Greedy seed: walk the slots in order and take the best MARGINAL piece for each against what
// has been chosen so far. Fast, and exactly the per-item reasoning that set-level search has to
// beat — kept in the result as `greedyScore` so callers can see the margin.
function optGreedySeed(slots: string[], cands: Record<string, (OptItem | null)[]>, space: OptSpace): OptAssignment {
  const cur: OptAssignment = {};
  for (let i = 0; i < slots.length; i++) cur[slots[i]!] = null;
  const totals = space.zero.slice();
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i]!;
    if (slot === "oneHanded" || slot === "twoHanded") continue;
    const list = cands[slot]!;
    let best: OptItem | null = null;
    let bestScore = -Infinity;
    for (let j = 0; j < list.length; j++) {
      const vC = optVec(list[j] as OptItem | null, space);
      optAddVec(totals, vC, 1);
      const s = optScoreVector(totals, space);
      optAddVec(totals, vC, -1);
      if (s > bestScore) { bestScore = s; best = list[j] as OptItem | null; }
    }
    cur[slot] = best;
    optAddVec(totals, optVec(best, space), 1);
  }
  const pair = optBestWeaponPair(totals, cur, cands["oneHanded"] || [null], cands["twoHanded"] || [null], space);
  cur["oneHanded"] = pair.one;
  cur["twoHanded"] = pair.two;
  return cur;
}

function optRandomSeed(slots: string[], cands: Record<string, (OptItem | null)[]>, rnd: () => number): OptAssignment {
  const cur: OptAssignment = {};
  for (let i = 0; i < slots.length; i++) {
    const list = cands[slots[i]!]!;
    cur[slots[i]!] = list[Math.floor(rnd() * list.length)] || null;
  }
  if (optIsTwoHandedWeapon(cur["twoHanded"] || null)) cur["oneHanded"] = null;
  return cur;
}

function optSanitize(a: OptAssignment, slots: string[]): OptAssignment {
  const out: OptAssignment = {};
  for (let i = 0; i < slots.length; i++) {
    const it = a ? a[slots[i]!] || null : null;
    out[slots[i]!] = it && it.slot === slots[i] ? it : null;
  }
  if (optIsTwoHandedWeapon(out["twoHanded"] || null)) out["oneHanded"] = null;
  return out;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Exact phase: dominance pruning + branch-and-bound.
// The score is separable per property and monotone in each total (non-decreasing where the weight
// is positive or a floor exists, non-increasing where the weight is negative — the tag penalty).
// So (1) a candidate that is >= another on every "good" dimension and <= on every "bad" one can
// never be part of a better suit than the other: drop it; (2) an optimistic bound for a partial
// suit is the score of totals + the per-dimension best any remaining slot could still add, which
// lets whole subtrees be skipped when the bound cannot beat the incumbent.
// ---------------------------------------------------------------------------
function optDimSign(space: OptSpace, i: number): number {
  if (space.w[i]! > 0 || space.floor[i]! > 0) return 1;
  if (space.w[i]! < 0) return -1;
  return 0;
}

function optDominates(a: number[], b: number[], space: OptSpace): boolean {
  // true when a is at least as good as b on every dimension that matters
  for (let i = 0; i < a.length; i++) {
    const sg = optDimSign(space, i);
    if (sg > 0 && a[i]! < b[i]!) return false;
    if (sg < 0 && a[i]! > b[i]!) return false;
  }
  return true;
}

function optDominancePrune(list: (OptItem | null)[], space: OptSpace, keepNull: boolean): (OptItem | null)[] {
  const out: (OptItem | null)[] = [];
  for (let i = 0; i < list.length; i++) {
    const a = list[i] as OptItem | null;
    if (a === null) { if (keepNull || !list.some((b) => b !== null && optDominates(optVec(b, space), space.zero, space))) out.push(null); continue; }
    const va = optVec(a, space);
    let dominated = false;
    for (let j = 0; j < list.length && !dominated; j++) {
      const b = list[j] as OptItem | null;
      if (b === null || b === a) continue;
      if (b.twoHanded === true && a.twoHanded !== true) continue;   // a two-handed weapon cannot stand in for a shield: the shield leaves a hand free
      const vb = optVec(b, space);
      if (!optDominates(vb, va, space)) continue;
      // b dominates a. Equal vectors: keep the one with the lower serial (deterministic tie-break).
      if (optDominates(va, vb, space) && a.serial < b.serial) continue;
      dominated = true;
    }
    if (!dominated) out.push(a);
  }
  return out;
}

function optBranchAndBound(slots: string[], cands: Record<string, (OptItem | null)[]>, space: OptSpace, incumbent: OptAssignment, incumbentScore: number, budgetMs: number, tick?: (nodes: number, bestScore: number, improvements: number, explored: number) => void, tickEveryMs?: number, alt?: { count: number; tolerance: number }): { best: OptAssignment; score: number; proven: boolean; nodes: number; improvements: number; alts: { a: OptAssignment; score: number }[] } {
  // slot order: most constrained (fewest candidates) first; the weapon pair goes last so the
  // two-hander rule is a cheap local check (twoHanded is enumerated before oneHanded).
  const order = slots.filter((x) => x !== "oneHanded" && x !== "twoHanded").sort((a, b) => cands[a]!.length - cands[b]!.length);
  if (slots.indexOf("twoHanded") >= 0) order.push("twoHanded");
  if (slots.indexOf("oneHanded") >= 0) order.push("oneHanded");
  const n = order.length, dims = space.keys.length;
  // candidates sorted by their own capped contribution, best first, so good incumbents appear early
  const lists: (OptItem | null)[][] = order.map((s) => {
    const l = (cands[s] || [null]).slice();
    l.sort((a, b) => optScoreVector(optVec(b, space), space) - optScoreVector(optVec(a, space), space));
    return l;
  });
  // suffix "best possible remaining addition" per dimension (max for good dims, min for bad dims)
  const suf: number[][] = new Array(n + 1);
  suf[n] = space.zero.slice();
  for (let k = n - 1; k >= 0; k--) {
    const acc = suf[k + 1]!.slice();
    for (let d = 0; d < dims; d++) {
      const sg = optDimSign(space, d);
      if (sg === 0) continue;
      let ext = sg > 0 ? -Infinity : Infinity;
      for (let j = 0; j < lists[k]!.length; j++) {
        const v = optVec(lists[k]![j] as OptItem | null, space)[d]!;
        if (sg > 0 ? v > ext : v < ext) ext = v;
      }
      acc[d]! += ext;
    }
    suf[k] = acc;
  }
  // Tighter bound for the capped weight terms. For a dimension whose weight is >= 0 and whose item values are all
  // >= 0, w*min(t, cap) is concave, so the joint gain of several items is at most the sum of their separate
  // gains. So the most the remaining slots can add on those dimensions is the sum, over slots, of the best single
  // item's gain at the current totals. Unlike the per-dimension bound it never pretends one piece carries the
  // best of every property at once. Both are valid upper bounds; the search takes the smaller one.
  const concave: boolean[] = new Array(dims);
  for (let d = 0; d < dims; d++) {
    let ok = space.w[d]! >= 0;
    for (let k = 0; k < n && ok; k++) for (let j = 0; j < lists[k]!.length && ok; j++) if (optVec(lists[k]![j] as OptItem | null, space)[d]! < 0) ok = false;
    concave[d] = ok;
  }
  const sparse: number[][][] = lists.map((l) => l.map((it) => {
    const v = optVec(it, space), out: number[] = [];
    for (let d = 0; d < dims; d++) if (concave[d] && space.w[d]! > 0 && v[d]! > 0) out.push(d, v[d]!);
    return out;
  }));
  const capped = function (d: number, t: number): number { const c = space.cap[d]!; return space.w[d]! * (t < c ? t : c); };
  const tightBound = function (k: number): number {
    let s = 0, gainA = 0;
    for (let d = 0; d < dims; d++) {
      const t = totals[d]!, tOpt = t + suf[k]![d]!;
      if (concave[d]) { const now = capped(d, t); s += now; gainA += capped(d, tOpt) - now; }
      else s += capped(d, tOpt);
      const f = space.floor[d]!;
      if (f > 0) { const fb = space.floorBonusArr[d]!; s += tOpt >= f ? fb : fb * space.floorPartial * (tOpt > 0 ? tOpt / f : 0); }
    }
    let gainB = 0;
    for (let lvl = k; lvl < n && gainB < gainA; lvl++) {
      const sp = sparse[lvl]!;
      let best = 0;   // every gain here is >= 0, so 0 never underestimates the best choice
      for (let j = 0; j < sp.length; j++) {
        const e = sp[j]!;
        let gain = 0;
        for (let q = 0; q < e.length; q += 2) { const d = e[q]!, t = totals[d]!; gain += capped(d, t + e[q + 1]!) - capped(d, t); }
        if (gain > best) best = gain;
      }
      gainB += best;
    }
    return s + (gainB < gainA ? gainB : gainA);
  };
  const totals: number[] = space.zero.slice();
  const pick: (OptItem | null)[] = new Array(n).fill(null);
  // idx[k] = position within lists[k] on the current path; with the cumulative list sizes it gives
  // the fraction of the whole tree (in leaves) that lies behind the search — pruned subtrees included.
  const idx: number[] = new Array(n).fill(0);
  const leavesBelow: number[] = new Array(n + 1);   // leaves under one node at depth k
  leavesBelow[n] = 1;
  for (let k = n - 1; k >= 0; k--) leavesBelow[k] = leavesBelow[k + 1]! * lists[k]!.length;
  const explored = function (): number {   // fraction of the whole tree behind the search
    let done = 0;
    for (let k = 0; k < n; k++) done += idx[k]! * leavesBelow[k + 1]!;
    return leavesBelow[0]! > 0 ? done / leavesBelow[0]! : 1;
  };
  // bestScore is the score of `best`, the best suit this search found; cut is the pruning threshold.
  let best: OptAssignment = incumbent, bestScore = incumbentScore, cut = incumbentScore, nodes = 0, proven = true, improvements = 0;
  const t0 = Date.now();
  const every = typeof tickEveryMs === "number" && tickEveryMs > 0 ? tickEveryMs : 250;
  let nextTick = t0 + every;
  const bound: number[] = new Array(dims);
  const EPS = 1e-9;
  // Alternatives: keep the best (count + 1) leaves scoring at least cut - tolerance. Pruning then only drops a
  // subtree whose bound is strictly below that threshold, so ties survive. The threshold only ever rises (cut
  // rises, the list's lowest score rises), so a subtree dropped early stays correctly dropped.
  const altMax = alt ? alt.count + 1 : 0, altTol = alt ? Math.max(0, alt.tolerance || 0) : 0;
  const altList: { a: OptAssignment; score: number }[] = [];
  let altMin = -Infinity;
  const altThr = function (): number { const base = cut - altTol; return altList.length >= altMax && altMin > base ? altMin : base; };
  const pruneAt = function (b: number): boolean { return alt ? b < altThr() - EPS : b <= cut + EPS; };
  const rec = function (k: number): boolean {   // returns false when the budget is exhausted
    if (k === n) {
      const sc = optScoreVector(totals, space);
      if (sc > cut + EPS) {
        bestScore = sc;
        cut = sc;
        improvements++;
        const a: OptAssignment = {};
        for (let i = 0; i < n; i++) a[order[i]!] = pick[i] as OptItem | null;
        best = a;
      }
      if (alt && sc >= altThr() - EPS && (altList.length < altMax || sc > altMin + EPS)) {
        const a: OptAssignment = {};
        for (let i = 0; i < n; i++) a[order[i]!] = pick[i] as OptItem | null;
        if (altList.length < altMax) altList.push({ a: a, score: sc });
        else { let mi = 0; for (let i = 1; i < altList.length; i++) if (altList[i]!.score < altList[mi]!.score) mi = i; altList[mi] = { a: a, score: sc }; }
        if (altList.length >= altMax) { altMin = Infinity; for (let i = 0; i < altList.length; i++) if (altList[i]!.score < altMin) altMin = altList[i]!.score; }
      }
      return true;
    }
    if ((++nodes & 1023) === 0) {
      const now = Date.now();
      if (tick && now >= nextTick) { nextTick = now + every; tick(nodes, cut, improvements, explored()); }
      if (now - t0 > budgetMs) return false;
    }
    for (let d = 0; d < dims; d++) bound[d] = totals[d]! + suf[k]![d]!;
    if (pruneAt(optScoreVector(bound, space))) return true;   // subtree cannot beat the incumbent (or reach the alternatives list)
    if (n - k >= 2 && pruneAt(tightBound(k))) return true;     // ... nor under the tighter, item-coupled bound
    const slot = order[k], list = lists[k]!;
    const twoH = slot === "oneHanded" && k > 0 && order[k - 1] === "twoHanded" && optIsTwoHandedWeapon(pick[k - 1] as OptItem | null);
    for (let j = 0; j < list.length; j++) {
      idx[k] = j;
      const it = list[j] as OptItem | null;
      if (twoH && it !== null) continue;              // a two-handed weapon leaves no free hand
      const v = optVec(it, space);
      for (let d = 0; d < dims; d++) totals[d]! += v[d]!;
      pick[k] = it;
      const ok = rec(k + 1);
      for (let d = 0; d < dims; d++) totals[d]! -= v[d]!;
      pick[k] = null;
      if (!ok) { proven = false; return false; }
    }
    idx[k] = 0;
    return true;
  };
  rec(0);
  if (tick) tick(nodes, cut, improvements, proven ? 1 : explored());
  return { best: best, score: bestScore, proven: proven, nodes: nodes, improvements: improvements, alts: altList };
}

function optimizeSuit(pools: Record<string, OptItem[]>, current: OptAssignment, profile: OptProfile, options?: OptOptions): OptResult {
  const opts = options || {};
  const slots = opts.slots || optDefaultSlots();
  const seed = typeof opts.seed === "number" ? opts.seed : 0x5eed;
  const restarts = typeof opts.restarts === "number" ? opts.restarts : 200;
  const maxPasses = typeof opts.maxPasses === "number" ? opts.maxPasses : 200;
  const optionalList = opts.optionalSlots || optDefaultOptionalSlots();
  const optional: Record<string, boolean> = {};
  for (let i = 0; i < optionalList.length; i++) optional[optionalList[i]!] = true;

  const cur = optSanitize(current || {}, slots);
  const keys = optCollectKeys(pools || {}, cur, profile);
  const space = optBuildSpace(keys, profile);
  const gradSpace = optBuildSpace(keys, optGradientProfile(profile));

  const cands: Record<string, (OptItem | null)[]> = {};
  for (let i = 0; i < slots.length; i++) cands[slots[i]!] = optCandidatesFor(slots[i]!, pools || {}, cur, optional);
  // A two-handed weapon needs the one-handed layer empty. When that layer has no empty option (it is locked to the
  // worn weapon), two-handed weapons are not candidates at all; otherwise the hill climber's weapon-pair move could
  // swap one in and quietly drop the locked weapon.
  if (cands["oneHanded"] && cands["twoHanded"] && cands["oneHanded"].indexOf(null) < 0) {
    const noTwo = cands["twoHanded"].filter(function (it) { return !optIsTwoHandedWeapon(it); });
    cands["twoHanded"] = noTwo.length ? noTwo : [null];
  }

  const currentScore = optScoreVector(optTotalsOf(cur, slots, space), space);
  const greedy = optGreedySeed(slots, cands, space);
  const greedyScore = optScoreVector(optTotalsOf(greedy, slots, space), space);

  // Gradient continuation: solve under the smoothed floor profile, then hand the result back to
  // the real profile as a seed.
  const gradSeed = optLocalSearch(optGreedySeed(slots, cands, gradSpace), slots, cands, gradSpace, maxPasses).assignment;

  let best = cur;
  let bestScore = currentScore;
  const yieldFn = opts.yieldFn;
  const yieldEvery = typeof opts.yieldEvery === "number" && opts.yieldEvery > 0 ? opts.yieldEvery : 1;
  let sinceYield = 0;

  // Progress reporting (throttled; a no-op without opts.onProgress).
  const t0 = Date.now();
  const budgetMs = typeof opts.timeBudgetMs === "number" ? opts.timeBudgetMs : 15000;
  const progressEvery = typeof opts.progressEveryMs === "number" && opts.progressEveryMs > 0 ? opts.progressEveryMs : 250;
  let candCount = 0;
  for (let i = 0; i < slots.length; i++) candCount += cands[slots[i]!]!.length;
  const prog: OptProgress = { phase: "heuristic", elapsedMs: 0, restartsDone: 0, restarts: restarts, nodes: 0, explored: 0, budgetMs: budgetMs,
    improvements: 0, lastImprovementMs: 0, bestScore: bestScore, currentScore: currentScore, floorsMet: 0, floorsTotal: 0, candidates: candCount };
  for (let i = 0; i < space.keys.length; i++) if (space.floor[i]! > 0) prog.floorsTotal++;
  let nextProgress = t0;
  const noteBest = function (assignment: OptAssignment, score: number): void {
    prog.bestScore = score;
    prog.lastImprovementMs = Date.now() - t0;
    const tv = optTotalsOf(assignment, slots, space);
    let met = 0;
    for (let i = 0; i < space.keys.length; i++) if (space.floor[i]! > 0 && tv[i]! >= space.floor[i]!) met++;
    prog.floorsMet = met;
  };
  const emit = function (force?: boolean): void {
    if (!opts.onProgress) return;
    const now = Date.now();
    if (!force && now < nextProgress) return;
    nextProgress = now + progressEvery;
    prog.elapsedMs = now - t0;
    opts.onProgress(prog);
  };
  noteBest(cur, currentScore);   // the starting suit is the first incumbent

  const consider = function (start: OptAssignment): void {
    if (yieldFn && ++sinceYield >= yieldEvery) { sinceYield = 0; yieldFn(); }
    const r = optLocalSearch(start, slots, cands, space, maxPasses);
    if (r.score > bestScore) { bestScore = r.score; best = r.assignment; prog.improvements++; noteBest(best, bestScore); }
  };
  emit(true);
  consider(cur);
  consider(greedy);
  consider(gradSeed);
  if (opts.warmStart) {
    // An earlier run's best suit, re-scored under this run's profile. Pieces no longer in the pool become
    // empty slots; the local search repairs the rest. Only a starting point: it can never lower the result.
    const warm: OptAssignment = {};
    for (let i = 0; i < slots.length; i++) {
      const want = opts.warmStart[slots[i]!];
      let hit: OptItem | null = null;
      const list = cands[slots[i]!]!;
      for (let j = 0; j < list.length && want; j++) { const c = list[j] as OptItem | null; if (c && c.serial === want) { hit = c; break; } }
      warm[slots[i]!] = hit;
    }
    consider(optSanitize(warm, slots));
  }
  const rnd = optMulberry32(seed);
  for (let i = 0; i < restarts; i++) { consider(optRandomSeed(slots, cands, rnd)); prog.restartsDone = i + 1; emit(); }
  emit(true);   // the end of a phase always reports, however fast it went

  best = optSanitize(best, slots);
  bestScore = optScoreVector(optTotalsOf(best, slots, space), space);

  let method = "heuristic", proven: boolean | undefined = undefined, nodes: number | undefined = undefined;
  let pruned: { before: number; after: number } | undefined = undefined;
  const alt = opts.exact && opts.alternatives && opts.alternatives.count > 0 ? opts.alternatives : null;
  const altTol = alt ? Math.max(0, alt.tolerance || 0) : 0;
  let alternatives: { best: OptAssignment; score: number }[] | undefined = undefined;
  if (opts.exact) {
    prog.phase = "prune"; emit(true);
    let before = 0, after = 0;
    const pcands: Record<string, (OptItem | null)[]> = {};
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i]!;
      const keepNull = s === "oneHanded" || s === "twoHanded" || !!optional[s];
      // Dominance pruning is safe for the single best suit only: a dominated piece can still belong in a runner-up.
      pcands[s] = alt ? cands[s]!.slice() : optDominancePrune(cands[s]!, space, keepNull);
      before += cands[s]!.length; after += pcands[s]!.length;
    }
    prog.phase = "exact"; prog.candidates = after; emit(true);
    const heuristicImprovements = prog.improvements;
    const tick = function (bbNodes: number, bbScore: number, bbImprovements: number, explored: number): void {
      prog.nodes = bbNodes; prog.explored = explored;
      if (bbScore > prog.bestScore) { prog.bestScore = bbScore; prog.lastImprovementMs = Date.now() - t0; }
      prog.improvements = heuristicImprovements + bbImprovements;
      emit(true);
    };
    const bb = optBranchAndBound(slots, pcands, space, best, bestScore, budgetMs, opts.onProgress ? tick : undefined, progressEvery, alt || undefined);
    if (bb.score > bestScore) { best = optSanitize(bb.best, slots); bestScore = bb.score; noteBest(best, bestScore); }
    method = "exact"; proven = bb.proven; nodes = bb.nodes; pruned = { before: before, after: after };
    if (alt) {
      const sigOf = function (a: OptAssignment): string { const parts: string[] = []; for (let i = 0; i < slots.length; i++) { const it = a[slots[i]!]; parts.push(it ? String(it.serial) : "0"); } return parts.join(","); };
      const seen: Record<string, boolean> = {};
      seen[sigOf(best)] = true;
      const list = bb.alts.map(function (e) { const a = optSanitize(e.a, slots); return { best: a, score: optScoreVector(optTotalsOf(a, slots, space), space) }; });
      list.sort(function (x, y) { return y.score - x.score; });
      alternatives = [];
      for (let i = 0; i < list.length && alternatives.length < alt.count; i++) {
        const e = list[i]!;
        if (e.score < bestScore - altTol - 1e-9) break;
        const k = sigOf(e.best);
        if (seen[k]) continue;
        seen[k] = true;
        alternatives.push(e);
      }
    }
    prog.improvements = heuristicImprovements + bb.improvements;
  }
  prog.phase = "done"; emit(true);

  // Per-slot diff report.
  const changes: OptSlotChange[] = [];
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i]!;
    const from = cur[slot] || null;
    const to = best[slot] || null;
    if (from === to) continue;
    if (from && to && from.serial === to.serial) continue;
    const gained: Record<string, number> = {};
    const seenKey: Record<string, boolean> = {};
    const collect = function (o: Record<string, number>): string[] {
      return Object.keys(o || {}).sort();
    };
    const fk = from ? collect(from.props) : [];
    const tk = to ? collect(to.props) : [];
    const all: string[] = [];
    for (let j = 0; j < tk.length; j++) if (!seenKey[tk[j]!]) { seenKey[tk[j]!] = true; all.push(tk[j]!); }
    for (let j = 0; j < fk.length; j++) if (!seenKey[fk[j]!]) { seenKey[fk[j]!] = true; all.push(fk[j]!); }
    all.sort();
    for (let j = 0; j < all.length; j++) {
      const k = all[j]!;
      const d = ((to && to.props[k]) || 0) - ((from && from.props[k]) || 0);
      if (d !== 0) gained[k] = d;
    }
    changes.push({
      slot: slot,
      from: from ? from.name : null,
      fromSerial: from ? from.serial : 0,
      to: to ? to.name : null,
      toSerial: to ? to.serial : 0,
      gainedProps: gained
    });
  }

  return {
    best: best,
    score: bestScore,
    currentScore: currentScore,
    greedyScore: greedyScore,
    delta: bestScore - currentScore,
    perSlotChanges: changes,
    totals: { before: optAssignmentTotals(cur), after: optAssignmentTotals(best) },
    seed: seed,
    restarts: restarts,
    evaluations: space.evals + gradSpace.evals,
    method: method,
    proven: proven,
    nodes: nodes,
    pruned: pruned,
    alternatives: alternatives,
    altTolerance: alt ? altTol : undefined
  };
}

export { scoreSet, optimizeSuit, optIsValidAssignment, optMulberry32, optDefaultSlots, optDefaultOptionalSlots, optAssignmentTotals, optGradientProfile, optCollectKeys, optBuildSpace, optDominancePrune, optVec, optScoreVector, optIsTwoHandedWeapon };
