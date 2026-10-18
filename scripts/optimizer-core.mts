// ============================================================================
// optimizer-core.mts — whole-suit gear optimizer CORE: the heuristic suit search and scoring of record, loaded from source by the path corePath() resolves.
// ----------------------------------------------------------------------------
// PURE LOGIC ONLY. No game globals (no `player`, `client`, `Gump`, ...) and no I/O. It imports the
// scoring constants it shares with app/mip.mts from app/solver/scoring.mts (issue #338) and exports
// through the one `export { ... }` line at the end. Everything is deterministic given a seed
// (mulberry32; `Math.random` is never called here).
//
// The problem: you have ~30 candidate items per slot across 19 slots. Exhaustive search is
// 30^19. The point of optimizing a SET rather than each slot independently is that scoring is
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
//
// map: builder
// owns: `optimizeSuit`, `scoreSet`, `optDefaultSlots`, `optDefaultOptionalSlots`, `optDominancePrune`
import { CHANGE_COST, DEFAULT_BUDGET_MS, DEFAULT_RESTARTS, FLOAT_EPS, RESIST_SKILL_KEY, RESIST_STEP_SLACK, TIE_SLACK, changeCost, scoringProfile, slackAt } from "../app/solver/scoring.mts";

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
  speed?: number | undefined;   // a weapon's base speed in seconds; the core never reads it (app/swing.mts does)
  tieCost?: number | undefined; // a tie-break cost (a rarity preference's, issue #262), never negative: with opts.tieBreak the search takes the lowest summed cost among suits within the tolerance of the best
}

// A full suit: slot name -> item, or null for "nothing equipped there".
interface OptAssignment {
  [slot: string]: OptItem | null;
}

// Scoring configuration. `weights[p]` is the value of one point of property p. `caps[p]` is
// the hard cap past which extra points are worthless (resists 70, HCI/DCI 45, LMC 40 ...);
// a property with no cap entry is uncapped. `floors[p]` is a whole-suit minimum that earns
// `floorBonus` when met and partial credit `floorBonus * floorPartial * (total/floor)` when
// not (a hard floor's divided by the number of hard floors) — the partial term is what gives
// the hill climber a gradient to follow toward a floor it has not reached yet, while the jump
// at the floor is what makes reaching it decisive.
interface OptProfile {
  weights?: Record<string, number> | undefined;   // optional: every read is `profile.weights || {}`
  caps: Record<string, number>;
  floors?: Record<string, number> | undefined;
  floorBonus?: number;
  floorPartial?: number;
  hardFloors?: string[] | undefined;    // floors that act as requirements: their bonus is HARD_FLOOR_BONUS (or hardFloorBonus), so no mix of other gains can buy a miss
  // `mins[p]`: a value the property never falls below (a resist's Resisting Spells minimum): it scores weights[p] × max(min, min(total, cap)), and a floor at or under it is met by every suit, so it is dropped.
  mins?: Record<string, number> | undefined;
  // SSI scored by swing step (app/swing.mts stepTable): with a positive SSI weight, SSI is worth weights.ssi × the largest `credit` among the points the suit reaches (ssi total >= ssi and stamPool total >= stam; 0 when it reaches none) in place of weights.ssi × min(ssi, cap). SSI floors still read the plain total.
  ssiSteps?: Array<{ ssi: number; stam: number; credit: number }> | undefined;
  // Resisting Spells steps (app/vault-lib.mts EffectiveProfile.resistSteps), lowest first: a suit whose RESIST_SKILL_KEY total is at least `at` (less RESIST_STEP_SLACK) holds each property in `mins` at that min in place of `mins` above. It scores weights[p] × max(that min, min(total, cap)), and a floor is met when the total or that min reaches it.
  resistSteps?: Array<{ at: number; mins: Record<string, number> }> | undefined;
  // A hard floor's bonus when above HARD_FLOOR_BONUS: app/mip.mts withHardFloorBonus sets it from the pool, so the rest of
  // the score can never move by half of it (issue #311).
  hardFloorBonus?: number | undefined;
}
// Strict order's stage values count as equal within TIE_SLACK: optStrictStages scales a stage so two different values sit far
// further apart.
const LEX_EPS = TIE_SLACK;
// The cost of one changed slot with the tie-break's fewestChanges (app/solver/scoring.mts changeCost).
function optChangeCost(maxTie: number): number {
  return changeCost(maxTie);
}
// The dimension strict order's fewest-changes stage scores in: a piece worn in its slot counts 1, a piece in a slot
// nobody wears -1, any other piece (and an empty slot) 0, so the total is the worn slots less the changes.
const CHANGES_KEY = "\u0000changes";

interface OptOptions {
  seed?: number;          // PRNG seed; same seed => byte-identical result
  restarts?: number;      // seeded-random restart count (default 200; ~160ms at 19 slots x 30 candidates)
  maxPasses?: number;     // safety bound on hill-climb passes per start (default 200)
  slots?: string[];       // slot universe (default optDefaultSlots())
  optionalSlots?: string[]; // slots where "equip nothing" is a legal choice
  yieldFn?: () => void;   // called between search starts — lets a sandboxed caller sleep() so a CPU watchdog doesn't kill sustained compute. Does not affect results (search order is fixed).
  yieldEvery?: number;    // search starts between yieldFn calls (default 1)
  exact?: boolean;        // after the heuristic, run dominance pruning + branch-and-bound (proves the optimum or reports best-within-budget)
  timeBudgetMs?: number;  // wall-clock budget for the exact phase (default 15000)
  heuristicBudgetMs?: number;  // wall-clock cap on the seeded-random restarts (default none): once spent, the remaining restarts are skipped. The fixed starts (worn, greedy, gradient, warm) always run.
  onProgress?: (p: OptProgress) => void;  // live progress, throttled to progressEveryMs (default 250); never affects results
  progressEveryMs?: number;
  warmStart?: Record<string, number | null>;  // slot -> serial of an earlier best suit; mapped onto this run's candidates and used as one more search start
  alternatives?: { count: number; tolerance: number };  // exact phase: also list up to `count` other suits scoring within `tolerance` of the best (0 = exact ties)
  // A second stage: among suits scoring at least (best - tolerance) that meet every floor the best suit meets, return the one with the lowest summed
  // OptItem.tieCost, the higher score on equal cost. `rarity` is the caller's label for where the costs came from; the core never reads it.
  // `topStart` (slot -> serial): the best-scoring suit an exact search found, one more search start, so the best score here matches it; when it scores
  // as well as the best found here (within 1e-3), the floors it meets are the ones held, so both searches hold the same set when equal tops differ.
  // `fewestChanges`: before the tie costs, the fewest slots that differ from `current` (each change costs CHANGE_COST, above any sum of tie costs).
  tieBreak?: { tolerance: number; rarity?: string | undefined; fewestChanges?: boolean | undefined; topStart?: Record<string, number | null> | undefined } | undefined;
  // Strict order (issue #292): the score is a vector compared stage by stage (optStrictStages: the requirements, each of
  // `ranks`' weighted properties, then every other weight), so no later stage ever buys a loss in an earlier one.
  // `fewestChanges`: the fewest slots changed from `current`, as a stage after the goals and soft partial credit and before the tag penalty and spare points.
  strict?: { ranks: string[][]; fewestChanges?: boolean | undefined } | undefined;
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
  // with opts.tieBreak: the best score found, the returned suit's summed tie cost, the best suit whose floors were held (slot -> serial) and those floors
  // (`changes`, with fewestChanges: how many slots differ from the worn suit)
  tieBreak?: { topScore: number; cost: number; changes?: number | undefined; top?: Record<string, number | null> | undefined; floors?: string[] | undefined } | undefined;
  lex?: number[] | undefined;   // with opts.strict: the returned suit's value in each stage (optStrictStages' order)
}

// Internal: a flattened property space so scoring is an array loop instead of object churn.
interface OptSpace {
  keys: string[];
  index: Record<string, number>;
  w: number[];
  cap: number[];
  min: number[];            // OptProfile.mins, -Infinity where there is none
  floor: number[];
  floorBonusArr: number[];  // per-dimension bonus (floorBonus, or HARD_FLOOR_BONUS for hard floors)
  floorBonus: number;
  partialArr: number[];     // per-dimension partial credit at the floor: bonus × floorPartial, a hard floor's shared among the hard floors
  zero: number[];
  vecCache: Map<OptItem, number[]>;
  evals: number;
  // SSI by step (OptProfile.ssiSteps): the ssi and stamPool dimensions (-1 when steps are off) and the points.
  stepSsi: number;
  stepStam: number;
  steps: { ssi: number[]; stam: number[]; credit: number[] };
  // Resisting Spells steps (OptProfile.resistSteps): the bonus dimension (-1 with no steps), each step's threshold (at less the slack) and each step's min per dimension (the dimension's own `min` where the step names none).
  rs: number;
  rsTau: number[];
  rsMin: number[][];
  // Strict order's fewest-changes stage (CHANGES_KEY): its dimension (-1 without it) and each piece's value there, set by optStrictSpaces.
  chg: number;
  changeOf?: ((it: OptItem) => number) | undefined;
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

// The 19 slots we optimize, one per paperdoll layer: the game refuses an item only when another worn item is on the
// same layer, plus the hand rule below. `oneHanded` is the weapon layer; `twoHanded` holds EITHER a shield OR a
// two-handed weapon.
function optDefaultSlots(): string[] {
  return ["helmet", "neck", "chest", "arms", "hands", "legs", "outerLegs", "feet", "oneHanded", "twoHanded",
    "shirt", "tunic", "robe", "waist", "cloak", "ring", "bracelet", "earrings", "talisman"];
}

// Slots where wearing nothing is a legitimate choice rather than a hole to be filled: all but the five armor pieces.
function optDefaultOptionalSlots(): string[] {
  return optDefaultSlots().filter(function (s) { return ["helmet", "chest", "arms", "hands", "legs"].indexOf(s) < 0; });
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
  const steps = { ssi: [] as number[], stam: [] as number[], credit: [] as number[] };
  const index: Record<string, number> = {};
  const w: number[] = [];
  const cap: number[] = [];
  const min: number[] = [];
  const floor: number[] = [];
  const zero: number[] = [];
  const sp = scoringProfile(profile), { caps, mins, weights } = sp;
  const floorBonusArr: number[] = [];
  // Partial credit at the floor (scoringProfile's partialOf): the hard floors share theirs, issue #204; the bonus itself is
  // large enough that the rest of the score never moves by the other half (hardFloorBonus, #311).
  const partialArr: number[] = [];
  // Steps need both dimensions in the space, even when no candidate carries them.
  const stepped = Array.isArray(profile.ssiSteps) && typeof weights["ssi"] === "number" && weights["ssi"] > 0;
  if (stepped) for (const k of ["ssi", "stamPool"]) if (keys.indexOf(k) < 0) keys = keys.concat([k]);
  // Resisting Spells steps need the bonus dimension in the space, even when no candidate carries it.
  const rSteps = Array.isArray(profile.resistSteps) ? profile.resistSteps : [], lifted = rSteps.length > 0;
  if (lifted && keys.indexOf(RESIST_SKILL_KEY) < 0) keys = keys.concat([RESIST_SKILL_KEY]);
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i]!;
    index[k] = i;
    w.push(typeof weights[k] === "number" ? weights[k] : 0);
    cap.push(typeof caps[k] === "number" ? caps[k] : Infinity);
    min.push(typeof mins[k] === "number" ? mins[k] : -Infinity);
    floor.push(sp.floorOf(k));
    floorBonusArr.push(sp.bonusOf(k));
    partialArr.push(sp.partialOf(k));
    zero.push(0);
  }
  return {
    keys: keys,
    index: index,
    w: w,
    cap: cap,
    min: min,
    floor: floor,
    floorBonusArr: floorBonusArr,
    floorBonus: sp.floorBonus,
    partialArr: partialArr,
    zero: zero,
    vecCache: new Map(),
    evals: 0,
    stepSsi: stepped ? index["ssi"]! : -1,
    stepStam: stepped ? index["stamPool"]! : -1,
    steps: stepped ? { ssi: profile.ssiSteps!.map((p) => p.ssi), stam: profile.ssiSteps!.map((p) => p.stam), credit: profile.ssiSteps!.map((p) => p.credit) } : steps,
    rs: lifted ? index[RESIST_SKILL_KEY]! : -1,
    rsTau: lifted ? rSteps.map((st) => st.at - RESIST_STEP_SLACK) : [],
    rsMin: lifted ? rSteps.map((st) => keys.map((k, i) => (typeof st.mins[k] === "number" ? st.mins[k] : min[i]!))) : [],
    chg: keys.indexOf(CHANGES_KEY)
  };
}

// The highest Resisting Spells step a bonus total of `s` reaches, -1 for none.
function optLiftIndex(space: OptSpace, s: number): number {
  let li = -1;
  for (let i = 0; i < space.rsTau.length; i++) if (s >= space.rsTau[i]!) li = i;
  return li;
}
// Dimension i's min at step `li` (-1: its own).
function optMinAt(space: OptSpace, i: number, li: number): number {
  return li >= 0 ? space.rsMin[li]![i]! : space.min[i]!;
}
// Whether dimension i's floor is met at total t with the min m: the total or the min reaches it.
function optFloorMetAt(space: OptSpace, i: number, t: number, m: number): boolean {
  const f = space.floor[i]!;
  return t >= f || m >= f;
}
function optFloorMet(space: OptSpace, totals: number[], i: number): boolean {
  return optFloorMetAt(space, i, totals[i]!, optMinAt(space, i, space.rs >= 0 ? optLiftIndex(space, totals[space.rs]!) : -1));
}

// The largest step credit a suit with `ssi` SSI and `stam` Stamina pool reaches (0 when it reaches none). It never falls as either total rises, so its value at the top of a reachable range bounds every suit below it.
function optStepCredit(space: OptSpace, ssi: number, stam: number): number {
  const st = space.steps;
  let best = 0;
  for (let i = 0; i < st.credit.length; i++) if (ssi >= st.ssi[i]! - FLOAT_EPS && stam >= st.stam[i]! - FLOAT_EPS && st.credit[i]! > best) best = st.credit[i]!;
  return best;
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
  if (space.chg >= 0 && space.changeOf) v[space.chg] = space.changeOf(it);
  space.vecCache.set(it, v);
  return v;
}

// Score a totals VECTOR. Over-cap points are worth exactly zero — that is the whole reason
// this is a set-level problem. A total under its min counts as the min (the Resisting Spells step its bonus reaches).
function optScoreVector(totals: number[], space: OptSpace): number {
  space.evals++;
  let s = 0;
  const li = space.rs >= 0 ? optLiftIndex(space, totals[space.rs]!) : -1;
  for (let i = 0; i < totals.length; i++) {
    const t = totals[i]!;
    const c = space.cap[i]!, m = li >= 0 ? space.rsMin[li]![i]! : space.min[i]!;
    const v = t < c ? t : c;
    s += i === space.stepSsi ? space.w[i]! * optStepCredit(space, t, totals[space.stepStam]!) : space.w[i]! * (v < m ? m : v);
    const f = space.floor[i]!;
    if (f > 0) {
      const fb = space.floorBonusArr[i]!;
      if (t >= f || m >= f) s += fb;   // the total or the min reaches it (optFloorMetAt)
      else s += space.partialArr[i]! * (t > 0 ? t / f : 0);
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

// ---------------------------------------------------------------------------
// Strict order (issue #292): the score as a vector, compared stage by stage
// ---------------------------------------------------------------------------

// A strict-order stage: what it scores (optStrictSpaces), its properties for a weights stage, and the factor its weights
// are scaled by.
type OptStageKind = "requirements" | "goal" | "softPartial" | "changes" | "tags" | "spare";
interface OptStage { kind: OptStageKind; keys: string[] | null; scale: number }
const TAG_KEY = "tagPenalty";
// A strict-order build's stages, most important first: the requirements (each floor met, and a hard floor's partial
// credit), each goal rank's weighted properties, a soft floor's partial credit (when there is a soft floor), the fewest
// changes (`fewest`), the tag penalty, then every other weighted property (spare points). So a tagged piece is never
// worn for spare points alone, and neither is a piece changed. A weights stage's weights are scaled so the smallest is
// 1: with whole property totals, two different values of a stage then sit at least a small fraction of a point apart,
// far above LEX_EPS. A rank with no weighted property is left out. app/exact-solver.mts builds its stages from this list.
function optStrictStages(profile: OptProfile, ranks: string[][], fewest: boolean = false): OptStage[] {
  const w = profile.weights || {}, used: Record<string, boolean> = {};
  const out: OptStage[] = [{ kind: "requirements", keys: null, scale: 1 }];
  const add = function (kind: OptStageKind, keys: string[]): void {
    const live = keys.filter(function (k) { return typeof w[k] === "number" && w[k] !== 0; });
    let least = Infinity;
    for (let i = 0; i < live.length; i++) least = Math.min(least, Math.abs(w[live[i]!]!));
    if (live.length) out.push({ kind: kind, keys: live, scale: 1 / least });
  };
  for (let i = 0; i < ranks.length; i++) { add("goal", ranks[i]!); for (let j = 0; j < ranks[i]!.length; j++) used[ranks[i]![j]!] = true; }
  const hard = profile.hardFloors || [], floors = profile.floors || {};
  if (Object.keys(floors).some(function (k) { return floors[k]! > 0 && hard.indexOf(k) < 0; })) out.push({ kind: "softPartial", keys: null, scale: 1 });
  if (fewest) out.push({ kind: "changes", keys: null, scale: 1 });
  if (!used[TAG_KEY]) add("tags", [TAG_KEY]);
  add("spare", Object.keys(w).sort().filter(function (k) { return !used[k] && k !== TAG_KEY; }));
  return out;
}
// One space per stage, over the search space's keys so the totals line up:
// - requirements: the floors alone, a soft floor counting only when met, a hard floor with its partial credit too (it
//   outweighs every weight in Best value as well);
// - softPartial: a soft floor's partial credit alone, so getting closer to a soft requirement never costs a goal;
// - changes: the CHANGES_KEY dimension, whose values `changeOf` gives;
// - the weights stages: their properties' weight terms alone (scaled), with no floors.
function optStrictSpaces(keys: string[], profile: OptProfile, stages: OptStage[], changeOf: (it: OptItem) => number): OptSpace[] {
  const hard = profile.hardFloors || [];
  return stages.map(function (st) {
    const isHard = function (sp: OptSpace, i: number): boolean { return hard.indexOf(sp.keys[i]!) >= 0; };
    let sp: OptSpace;
    if (st.kind === "requirements" || st.kind === "softPartial") {
      sp = optBuildSpace(keys, { ...profile, weights: {} });
      const soft = st.kind === "softPartial";
      sp.partialArr = sp.partialArr.map(function (p, i) { return isHard(sp, i) !== soft ? p : 0; });
      if (soft) sp.floorBonusArr = sp.floorBonusArr.map(function () { return 0; });
    } else if (st.kind === "changes") {
      sp = optBuildSpace(keys, { ...profile, weights: { [CHANGES_KEY]: 1 }, floors: {}, hardFloors: [] });
    } else {
      const weights: Record<string, number> = {};
      for (let i = 0; i < st.keys!.length; i++) weights[st.keys![i]!] = profile.weights![st.keys![i]!]! * st.scale;
      sp = optBuildSpace(keys, { ...profile, weights: weights, floors: {}, hardFloors: [] });
    }
    sp.changeOf = changeOf;
    return sp;
  });
}
// A piece's value in the CHANGES_KEY dimension against the worn suit `cur`.
function optChangeOf(cur: OptAssignment): (it: OptItem) => number {
  return function (it) { const w = cur[it.slot]; return !w ? -1 : w.serial === it.serial ? 1 : 0; };
}
// A suit's stage values under opts.strict, for a caller holding the suit alone (app/exact-solver.mts's other suits).
function optStrictScore(items: OptAssignment, current: OptAssignment, profile: OptProfile, strict: { ranks: string[][]; fewestChanges?: boolean | undefined }, slots?: string[]): number[] {
  const sl = slots || optDefaultSlots(), cur = optSanitize(current || {}, sl), a = optSanitize(items, sl);
  const stages = optStrictStages(profile, strict.ranks, !!strict.fewestChanges);
  const keys = optCollectKeys({}, a, profile).concat(stages.some(function (s) { return s.kind === "changes"; }) ? [CHANGES_KEY] : []);
  const base = optBuildSpace(keys, profile), lex = optStrictSpaces(base.keys, profile, stages, optChangeOf(cur));
  return optLexOf(optTotalsOf(a, sl, lex[0]!), lex);
}
function optLexOf(totals: number[], lex: OptSpace[]): number[] {
  return lex.map(function (sp) { return optScoreVector(totals, sp); });
}
// 1 when a beats b in strict order, -1 when b beats a, 0 when every stage is equal (within LEX_EPS).
function optLexCmp(a: number[], b: number[]): number {
  for (let i = 0; i < a.length; i++) {
    const e = slackAt(LEX_EPS, a[i]!, b[i]!);
    if (a[i]! > b[i]! + e) return 1;
    if (a[i]! < b[i]! - e) return -1;
  }
  return 0;
}
// Whether every stage of `v` reaches `mins` (within LEX_EPS).
function optLexHolds(v: number[], mins: number[]): boolean {
  for (let i = 0; i < v.length; i++) if (v[i]! < mins[i]! - slackAt(LEX_EPS, v[i]!, mins[i]!)) return false;
  return true;
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
    floorBonus: scoringProfile(profile).floorBonus,
    floorPartial: 1,
    hardFloors: profile.hardFloors,
    mins: profile.mins,
    ssiSteps: profile.ssiSteps,
    resistSteps: profile.resistSteps,
    hardFloorBonus: profile.hardFloorBonus
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
// With `lex` (strict order) the pair is the best in strict order, and `vec` its stage values.
function optBestWeaponPair(totals: number[], a: OptAssignment, oneCands: (OptItem | null)[], twoCands: (OptItem | null)[], space: OptSpace, lex?: OptSpace[] | null): { one: OptItem | null; two: OptItem | null; score: number; vec: number[] | null } {
  const curOne = a["oneHanded"] || null;
  const curTwo = a["twoHanded"] || null;
  optAddVec(totals, optVec(curOne, space), -1);
  optAddVec(totals, optVec(curTwo, space), -1);
  let bestOne: OptItem | null = null;
  let bestTwo: OptItem | null = null;
  let bestScore = -Infinity;
  let bestVec: number[] | null = null;
  const better = function (s: number): boolean {
    if (!lex) return s > bestScore;
    const v = optLexOf(totals, lex);
    if (bestVec && optLexCmp(v, bestVec) <= 0) return false;
    bestVec = v;
    return true;
  };
  for (let i = 0; i < twoCands.length; i++) {
    const two = twoCands[i] as OptItem | null;
    const vTwo = optVec(two, space);
    optAddVec(totals, vTwo, 1);
    if (optIsTwoHandedWeapon(two)) {
      // A two-hander forbids the one-handed layer entirely: exactly one combination to score.
      const s = optScoreVector(totals, space);
      if (better(s)) { bestScore = s; bestOne = null; bestTwo = two; }
    } else {
      for (let j = 0; j < oneCands.length; j++) {
        const one = oneCands[j] as OptItem | null;
        const vOne = optVec(one, space);
        optAddVec(totals, vOne, 1);
        const s = optScoreVector(totals, space);
        if (better(s)) { bestScore = s; bestOne = one; bestTwo = two; }
        optAddVec(totals, vOne, -1);
      }
    }
    optAddVec(totals, vTwo, -1);
  }
  // Restore the caller's totals exactly as handed in.
  optAddVec(totals, optVec(curOne, space), 1);
  optAddVec(totals, optVec(curTwo, space), 1);
  return { one: bestOne, two: bestTwo, score: bestScore, vec: bestVec };
}

// Steepest ascent: evaluate every single-slot swap plus the weapon-pair move, apply only the
// single best strictly-improving one, repeat until nothing improves. Strict improvement plus
// fixed iteration order keeps this deterministic (no tie-break coin flips).
// With `lex` (strict order) a move must improve the suit in strict order, and the best such move is taken.
function optLocalSearch(a: OptAssignment, slots: string[], cands: Record<string, (OptItem | null)[]>, space: OptSpace, maxPasses: number, lex?: OptSpace[] | null): { assignment: OptAssignment; score: number; vec: number[] | null } {
  const EPS = FLOAT_EPS;
  const cur: OptAssignment = {};
  for (let i = 0; i < slots.length; i++) cur[slots[i]!] = a[slots[i]!] || null;
  const totals = optTotalsOf(cur, slots, space);
  let score = optScoreVector(totals, space);
  let vec = lex ? optLexOf(totals, lex) : null;
  for (let pass = 0; pass < maxPasses; pass++) {
    let bestGain = EPS;
    let bestSlot = "";
    let bestItem: OptItem | null = null;
    let bestPair: { one: OptItem | null; two: OptItem | null; score: number; vec: number[] | null } | null = null;
    let bestVec = vec;   // strict order: the best move's stage values, which must beat the suit's
    const gains = function (s: number): boolean {
      if (!lex) return s - score > bestGain;
      const v = optLexOf(totals, lex);
      if (optLexCmp(v, bestVec!) <= 0) return false;
      bestVec = v;
      return true;
    };
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
        const up = gains(s);
        optAddVec(totals, vC, -1);
        if (up) { bestGain = s - score; bestSlot = slot; bestItem = cand; bestPair = null; }
      }
      optAddVec(totals, vHave, 1);
    }
    const pair = optBestWeaponPair(totals, cur, cands["oneHanded"] || [null], cands["twoHanded"] || [null], space, lex);
    if ((lex ? optLexCmp(pair.vec!, bestVec!) > 0 : pair.score - score > bestGain) && (pair.one !== (cur["oneHanded"] || null) || pair.two !== (cur["twoHanded"] || null))) {
      bestGain = pair.score - score;
      bestPair = pair;
      bestSlot = "";
      bestItem = null;
      bestVec = pair.vec;
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
    vec = bestVec;
  }
  const end = optTotalsOf(cur, slots, space);
  return { assignment: cur, score: optScoreVector(end, space), vec: lex ? optLexOf(end, lex) : null };
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
// The score is separable per property: a weight term w·min(t, cap) (non-decreasing in t when w > 0,
// non-increasing when w < 0 — the tag penalty) plus a floor term (non-decreasing in t). A property
// with a negative weight AND a floor is neither: more can win the floor, less saves weight.
// So (1) a candidate that is >= another on every "good" dimension, <= on every "bad" one and equal
// on every non-monotone one can never be part of a better suit than the other: drop it; (2) an
// optimistic bound for a partial suit takes, per dimension, the weight term at whichever end of the
// reachable range it prefers and the floor term at the top end, which lets whole subtrees be
// skipped when the bound cannot beat the incumbent.
// ---------------------------------------------------------------------------
// +1 more is better, -1 less is better, 0 irrelevant, 2 neither (negative weight with a floor).
function optDimSign(space: OptSpace, i: number): number {
  if (i === space.chg) return 1;   // strict order's fewest changes: keeping the worn piece is better
  // with SSI by step, more stamina can reach a faster step: it counts as good unless its own weight is negative
  if (i === space.stepStam) return space.w[i]! < 0 ? 2 : 1;
  // with Resisting Spells steps, more bonus lifts the mins: good for a weighted or floored resist, bad for one weighted
  // below 0, so it is good, bad or neither by every dimension it lifts and its own weight and floor
  if (i === space.rs) {
    let good = space.w[i]! > 0 || space.floor[i]! > 0, bad = space.w[i]! < 0;
    const top = space.rsMin[space.rsMin.length - 1]!;
    for (let d = 0; d < space.keys.length; d++) {
      if (d === i || !(top[d]! > space.min[d]!)) continue;
      if (space.w[d]! > 0 || space.floor[d]! > 0) good = true;
      if (space.w[d]! < 0) bad = true;
    }
    return good && bad ? 2 : good ? 1 : bad ? -1 : 0;
  }
  if (space.w[i]! < 0 && space.floor[i]! > 0) return 2;
  if (space.w[i]! > 0 || space.floor[i]! > 0) return 1;
  if (space.w[i]! < 0) return -1;
  return 0;
}

function optDominates(a: number[], b: number[], space: OptSpace): boolean {
  // true when a is at least as good as b on every dimension that matters
  for (let i = 0; i < a.length; i++) {
    const sg = optDimSign(space, i);
    if (sg === 1 && a[i]! < b[i]!) return false;
    if (sg === -1 && a[i]! > b[i]!) return false;
    if (sg === 2 && a[i]! !== b[i]!) return false;
  }
  return true;
}

// `keepNull`: the slot may stay empty. Outside the hands an empty slot is then still dropped for a piece that scores
// exactly like it (a worn pair of plain boots): the same score, and the search no longer splits on every such tie.
function optDominancePrune(list: (OptItem | null)[], space: OptSpace, keepNull: boolean, hand: boolean): (OptItem | null)[] {
  const out: (OptItem | null)[] = [];
  const asEmpty = function (b: OptItem | null): boolean {
    if (b === null) return false;
    const v = optVec(b, space);
    return optDominates(v, space.zero, space) && optDominates(space.zero, v, space);
  };
  for (let i = 0; i < list.length; i++) {
    const a = list[i] as OptItem | null;
    if (a === null) {
      const keep = keepNull ? hand || !list.some(asEmpty) : !list.some((b) => b !== null && optDominates(optVec(b, space), space.zero, space));
      if (keep) out.push(null);
      continue;
    }
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

// A suit's summed tie cost (OptItem.tieCost; an empty slot costs 0), or its sum under `costOf`.
function optTieCost(a: OptAssignment, slots: string[], costOf?: (it: OptItem | null) => number): number {
  let c = 0;
  for (let i = 0; i < slots.length; i++) { const it = a[slots[i]!]; if (costOf) c += costOf(it || null); else if (it) c += it.tieCost || 0; }
  return c;
}
// How many slots of `a` hold another piece than `cur` (an empty slot counts as no piece).
function optChanges(a: OptAssignment, cur: OptAssignment, slots: string[]): number {
  let n = 0;
  for (let i = 0; i < slots.length; i++) { const x = a[slots[i]!], y = cur[slots[i]!]; if ((x ? x.serial : 0) !== (y ? y.serial : 0)) n++; }
  return n;
}

// `tie`: the tie-break pass (OptOptions.tieBreak). A leaf counts when it scores at least `min` and meets the floors on
// the dimensions in `met`, and wins on a lower summed tie cost (the higher score on an equal one); the incumbent's cost
// is `cost`. A subtree is dropped when its score bound is under `min`, a floor in `met` is out of reach, or its cost so
// far plus the cheapest piece of each remaining slot passes the incumbent's. `costOf` replaces OptItem.tieCost as a piece's cost.
// `lex` (strict order): leaves and bounds are compared stage by stage against the incumbent's values; in the tie pass a
// leaf must hold every stage at `lexMins` in place of `min`, and other suits (`alt`) are the suits equal on every stage.
function optBranchAndBound(slots: string[], cands: Record<string, (OptItem | null)[]>, space: OptSpace, incumbent: OptAssignment, incumbentScore: number, budgetMs: number, tick?: (nodes: number, bestScore: number, improvements: number, explored: number) => void, tickEveryMs?: number, alt?: { count: number; tolerance: number }, tie?: { min: number; met: number[]; cost: number; costOf?: ((it: OptItem | null) => number) | undefined; lexMins?: number[] | undefined }, lex?: OptSpace[] | null): { best: OptAssignment; score: number; proven: boolean; nodes: number; improvements: number; alts: { a: OptAssignment; score: number }[] } {
  // slot order: most constrained (fewest candidates) first; the weapon pair goes last so the
  // two-hander rule is a cheap local check (twoHanded is enumerated before oneHanded).
  const order = slots.filter((x) => x !== "oneHanded" && x !== "twoHanded").sort((a, b) => cands[a]!.length - cands[b]!.length);
  if (slots.indexOf("twoHanded") >= 0) order.push("twoHanded");
  if (slots.indexOf("oneHanded") >= 0) order.push("oneHanded");
  const n = order.length, dims = space.keys.length;
  // candidates sorted by their own capped contribution, best first, so good incumbents appear early
  const costOf = tie && tie.costOf ? tie.costOf : function (it: OptItem | null): number { return it ? it.tieCost || 0 : 0; };
  const lists: (OptItem | null)[][] = order.map((s) => {
    const l = (cands[s] || [null]).slice();
    // the tie pass looks at cheap pieces first, so a low-cost incumbent appears early
    l.sort((a, b) => (tie ? costOf(a) - costOf(b) : 0) || optScoreVector(optVec(b, space), space) - optScoreVector(optVec(a, space), space));
    return l;
  });
  // the least tie cost the remaining slots can add (each slot's cheapest candidate)
  const sufCost: number[] = new Array(n + 1).fill(0);
  for (let k = n - 1; k >= 0; k--) { let mn = Infinity; for (let j = 0; j < lists[k]!.length; j++) mn = Math.min(mn, costOf(lists[k]![j] as OptItem | null)); sufCost[k] = sufCost[k + 1]! + mn; }
  let costSoFar = 0, bestCost = tie ? tie.cost : 0;
  // suffix range of what the remaining slots can still add, per dimension: sufHi the most, sufLo the least
  const sufHi: number[][] = new Array(n + 1), sufLo: number[][] = new Array(n + 1);
  sufHi[n] = space.zero.slice(); sufLo[n] = space.zero.slice();
  for (let k = n - 1; k >= 0; k--) {
    const hi = sufHi[k + 1]!.slice(), lo = sufLo[k + 1]!.slice();
    for (let d = 0; d < dims; d++) {
      let mx = -Infinity, mn = Infinity;
      for (let j = 0; j < lists[k]!.length; j++) {
        const v = optVec(lists[k]![j] as OptItem | null, space)[d]!;
        if (v > mx) mx = v;
        if (v < mn) mn = v;
      }
      hi[d]! += mx; lo[d]! += mn;
    }
    sufHi[k] = hi; sufLo[k] = lo;
  }
  // The bounds for one space: the search's own, and with strict order each stage's (the same keys, so the same totals and
  // suffix ranges).
  const boundsFor = function (space: OptSpace): { loose: (k: number) => number; tight: (k: number) => number; liftHi: (k: number) => number } {
    // Tighter bound for the capped weight terms. For a dimension whose weight is >= 0 and whose item values are all
    // >= 0, w*min(t, cap) is concave, so the joint gain of several items is at most the sum of their separate
    // gains. So the most the remaining slots can add on those dimensions is the sum, over slots, of the best single
    // item's gain at the current totals. Unlike the per-dimension bound it never pretends one piece carries the
    // best of every property at once. Both are valid upper bounds; the search takes the smaller one.
    const concave: boolean[] = new Array(dims);
    for (let d = 0; d < dims; d++) {
      let ok = space.w[d]! >= 0 && d !== space.stepSsi;   // a step credit is not concave
      for (let k = 0; k < n && ok; k++) for (let j = 0; j < lists[k]!.length && ok; j++) if (optVec(lists[k]![j] as OptItem | null, space)[d]! < 0) ok = false;
      concave[d] = ok;
    }
    const sparse: number[][][] = lists.map((l) => l.map((it) => {
      const v = optVec(it, space), out: number[] = [];
      for (let d = 0; d < dims; d++) if (concave[d] && space.w[d]! > 0 && v[d]! > 0) out.push(d, v[d]!);
      return out;
    }));
    const capped = function (d: number, t: number, m: number = space.min[d]!): number { const c = space.cap[d]!, v = t < c ? t : c; return space.w[d]! * (v < m ? m : v); };
    // The highest Resisting Spells step the remaining slots can still reach (-1 for none, or no steps): its min bounds a
    // positive weight's term and a floor from above. A negative weight's best is its own min, the lowest any step leaves.
    const liftHi = function (k: number): number { return space.rs >= 0 ? optLiftIndex(space, totals[space.rs]! + sufHi[k]![space.rs]!) : -1; };
    // ... and the step every completion reaches (the least the remaining slots can add).
    const liftLo = function (k: number): number { return space.rs >= 0 ? optLiftIndex(space, totals[space.rs]! + sufLo[k]![space.rs]!) : -1; };
    // w·min(t, cap) without the min. With a min the term is not concave, but its gain from any t never passes this one's
    // (under the min it is 0 until the total reaches it, then the same), which is concave: the sparse bound takes it.
    const cappedRaw = function (d: number, t: number): number { const c = space.cap[d]!; return space.w[d]! * (t < c ? t : c); };
    const floorTerm = function (d: number, t: number, li: number): number {
      const f = space.floor[d]!;
      if (!(f > 0)) return 0;
      const fb = space.floorBonusArr[d]!;
      return optFloorMetAt(space, d, t, optMinAt(space, d, li)) ? fb : space.partialArr[d]! * (t > 0 ? t / f : 0);
    };
    // The weight term's best over the reachable range [t + sufLo, t + sufHi] (w·max(min, min(t, cap)) is monotone,
    // so it is one of the two ends), and the floor term's best (always the top end).
    const weightBest = function (d: number, k: number, li: number): number {
      const t = totals[d]!;
      if (d === space.stepSsi) { const m = space.stepStam; return space.w[d]! * optStepCredit(space, t + sufHi[k]![d]!, totals[m]! + sufHi[k]![m]!); }
      return space.w[d]! < 0 ? capped(d, t + sufLo[k]![d]!) : capped(d, t + sufHi[k]![d]!, optMinAt(space, d, li));
    };
    const looseBound = function (k: number): number {
      space.evals++;
      let s = 0;
      const li = liftHi(k);
      for (let d = 0; d < dims; d++) s += weightBest(d, k, li) + floorTerm(d, totals[d]! + sufHi[k]![d]!, li);
      return s;
    };
    // With Resisting Spells steps, a concave term's min is the one every completion reaches (with none, the highest's), and
    // what a higher step could add is counted apart: w·max(hi, x) ≤ w·max(lo, x) + w·(hi − max(lo, x0))⁺, x0 the least
    // capped total any completion has, so nothing is added once the totals are past the highest min.
    const tightBound = function (k: number): number {
      let s = 0, gainA = 0;
      const li = liftHi(k), lo = liftLo(k);
      for (let d = 0; d < dims; d++) {
        const t = totals[d]!;
        if (concave[d]) {
          const mHi = optMinAt(space, d, li), reached = optMinAt(space, d, lo), mLo = reached > -Infinity ? reached : mHi, now = capped(d, t, mLo);
          const c = space.cap[d]!, x0 = t + sufLo[k]![d]!, held = Math.max(mLo, x0 < c ? x0 : c);
          s += now + (mHi > held ? space.w[d]! * (mHi - held) : 0);
          gainA += capped(d, t + sufHi[k]![d]!, mLo) - now;
        }
        else s += weightBest(d, k, li);
        s += floorTerm(d, t + sufHi[k]![d]!, li);
      }
      let gainB = 0;
      for (let lvl = k; lvl < n && gainB < gainA; lvl++) {
        const sp = sparse[lvl]!;
        let best = 0;   // every gain here is >= 0, so 0 never underestimates the best choice
        for (let j = 0; j < sp.length; j++) {
          const e = sp[j]!;
          let gain = 0;
          for (let q = 0; q < e.length; q += 2) { const d = e[q]!, t = totals[d]!; gain += cappedRaw(d, t + e[q + 1]!) - cappedRaw(d, t); }
          if (gain > best) best = gain;
        }
        gainB += best;
      }
      return s + (gainB < gainA ? gainB : gainA);
    };
    return { loose: looseBound, tight: tightBound, liftHi: liftHi };
  };
  const bounds = boundsFor(space), stageBounds = lex ? lex.map(boundsFor) : null;
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
  const EPS = FLOAT_EPS;
  // Alternatives: keep the best (count + 1) leaves scoring at least cut - tolerance. Pruning then only drops a
  // subtree whose bound is strictly below that threshold, so ties survive. The threshold only ever rises (cut
  // rises, the list's lowest score rises), so a subtree dropped early stays correctly dropped.
  const altMax = alt ? alt.count + 1 : 0, altTol = alt ? Math.max(0, alt.tolerance || 0) : 0;
  const altList: { a: OptAssignment; score: number }[] = [];
  let altMin = -Infinity;
  const altThr = function (): number { const base = cut - altTol; return altList.length >= altMax && altMin > base ? altMin : base; };
  const pruneAt = function (b: number): boolean { return tie ? b < tie.min - EPS : alt ? b < altThr() - EPS : b <= cut + EPS; };
  // Strict order: the incumbent's stage values, and whether a subtree can't beat them: the first stage whose bound is not
  // equal to the incumbent's decides, and a subtree equal on every stage can't do better (other suits keep it: they are
  // the suits equal on every stage). In the tie pass a subtree goes as soon as one stage can't reach what it must hold.
  let cutVec = lex ? optLexOf(optTotalsOf(incumbent, order, space), lex) : null;
  const lexPrune = function (k: number): boolean {
    for (let s = 0; s < stageBounds!.length; s++) {
      const B = stageBounds![s]!, ref = tie ? tie.lexMins![s]! : cutVec![s]!;
      let b = B.loose(k);
      const e = slackAt(LEX_EPS, b, ref);
      if (b >= ref - e && n - k >= 2) b = Math.min(b, B.tight(k));
      if (b < ref - e) return true;
      if (!tie && b > ref + e) return false;
    }
    return !tie && (!alt || altList.length >= altMax);
  };
  const pickNow = function (): OptAssignment { const a: OptAssignment = {}; for (let i = 0; i < n; i++) a[order[i]!] = pick[i] as OptItem | null; return a; };
  const rec = function (k: number): boolean {   // returns false when the budget is exhausted
    if (k === n && lex && !tie) {
      const vec = optLexOf(totals, lex), c = optLexCmp(vec, cutVec!), sc = optScoreVector(totals, space);
      if (c > 0) { cutVec = vec; bestScore = sc; cut = sc; improvements++; best = pickNow(); altList.length = 0; }
      if (alt && c >= 0 && altList.length < altMax) altList.push({ a: pickNow(), score: sc });
      return true;
    }
    if (k === n && tie) {
      const sc = optScoreVector(totals, space);
      let ok = lex ? optLexHolds(optLexOf(totals, lex), tie.lexMins!) : sc >= tie.min - EPS;
      for (let i = 0; i < tie.met.length && ok; i++) if (!optFloorMet(space, totals, tie.met[i]!)) ok = false;
      if (ok && (costSoFar < bestCost - EPS || (costSoFar <= bestCost + EPS && sc > bestScore + EPS))) {
        bestScore = sc;
        bestCost = costSoFar;
        improvements++;
        const a: OptAssignment = {};
        for (let i = 0; i < n; i++) a[order[i]!] = pick[i] as OptItem | null;
        best = a;
      }
      return true;
    }
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
      // the slack from the suit's own score: the threshold and the list's lowest start infinite
      if (alt && sc >= altThr() - slackAt(EPS, sc, 0) && (altList.length < altMax || sc > altMin + slackAt(EPS, sc, 0))) {
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
    if (tie) {
      if (costSoFar + sufCost[k]! > bestCost + EPS) return true;   // cannot get as cheap as the incumbent
      const li = bounds.liftHi(k);
      for (let i = 0; i < tie.met.length; i++) { const d = tie.met[i]!; if (!optFloorMetAt(space, d, totals[d]! + sufHi[k]![d]!, optMinAt(space, d, li))) return true; }   // a floor out of reach
    }
    if (lex) { if (lexPrune(k)) return true; }                  // strict order: the stages decide
    else if (pruneAt(bounds.loose(k))) return true;             // subtree cannot beat the incumbent (or reach the alternatives list)
    else if (n - k >= 2 && pruneAt(bounds.tight(k))) return true;   // ... nor under the tighter, item-coupled bound
    const slot = order[k], list = lists[k]!;
    const twoH = slot === "oneHanded" && k > 0 && order[k - 1] === "twoHanded" && optIsTwoHandedWeapon(pick[k - 1] as OptItem | null);
    for (let j = 0; j < list.length; j++) {
      idx[k] = j;
      const it = list[j] as OptItem | null;
      if (twoH && it !== null) continue;              // a two-handed weapon leaves no free hand
      const v = optVec(it, space);
      for (let d = 0; d < dims; d++) totals[d]! += v[d]!;
      pick[k] = it;
      costSoFar += costOf(it);
      const ok = rec(k + 1);
      costSoFar -= costOf(it);
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
  const restarts = typeof opts.restarts === "number" ? opts.restarts : DEFAULT_RESTARTS;
  const maxPasses = typeof opts.maxPasses === "number" ? opts.maxPasses : 200;
  const optionalList = opts.optionalSlots || optDefaultOptionalSlots();
  const optional: Record<string, boolean> = {};
  for (let i = 0; i < optionalList.length; i++) optional[optionalList[i]!] = true;

  const cur = optSanitize(current || {}, slots);
  // strict order: a space per stage; every comparison below is then stage by stage, and `score` stays the plain score. With
  // its fewest-changes stage every space carries the CHANGES_KEY dimension (weight 0 outside that stage).
  const stages = opts.strict ? optStrictStages(profile, opts.strict.ranks, !!opts.strict.fewestChanges) : null;
  const keys = optCollectKeys(pools || {}, cur, profile).concat(stages && stages.some(function (s) { return s.kind === "changes"; }) ? [CHANGES_KEY] : []);
  const space = optBuildSpace(keys, profile);
  const gradSpace = optBuildSpace(keys, optGradientProfile(profile));
  const changeOf = optChangeOf(cur);
  space.changeOf = changeOf; gradSpace.changeOf = changeOf;
  const lex = stages ? optStrictSpaces(space.keys, profile, stages, changeOf) : null;
  const lexAt = function (a: OptAssignment): number[] { return optLexOf(optTotalsOf(a, slots, space), lex!); };

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
  const budgetMs = typeof opts.timeBudgetMs === "number" ? opts.timeBudgetMs : DEFAULT_BUDGET_MS;
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
    for (let i = 0; i < space.keys.length; i++) if (space.floor[i]! > 0 && optFloorMet(space, tv, i)) met++;
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

  // With a tie-break, every start's climbed suit (and the warm start as given) is a candidate for the second stage.
  const tb = opts.tieBreak ? { tolerance: Math.max(0, opts.tieBreak.tolerance || 0) } : null;
  const tieCands: OptAssignment[] = [];
  let bestVec = lex ? lexAt(cur) : null;
  const consider = function (start: OptAssignment): void {
    if (yieldFn && ++sinceYield >= yieldEvery) { sinceYield = 0; yieldFn(); }
    const r = optLocalSearch(start, slots, cands, space, maxPasses, lex);
    if (tb) tieCands.push(r.assignment);
    if (lex ? optLexCmp(r.vec!, bestVec!) > 0 : r.score > bestScore) { bestScore = r.score; bestVec = r.vec; best = r.assignment; prog.improvements++; noteBest(best, bestScore); }
  };
  emit(true);
  consider(cur);
  consider(greedy);
  consider(gradSeed);
  // An earlier run's best suit, re-scored under this run's profile. Pieces no longer in the pool become
  // empty slots; the local search repairs the rest. Only a starting point: it can never lower the result.
  // A slot that may not be empty (a locked slot, or Manual's pinned piece) keeps its current piece, else its
  // first candidate: an empty one there would be a suit no search may return, and the incumbent would stick.
  const fromSerials = function (serials: Record<string, number | null>): OptAssignment {
    const warm: OptAssignment = {};
    for (let i = 0; i < slots.length; i++) {
      const want = serials[slots[i]!];
      let hit: OptItem | null = null;
      const list = cands[slots[i]!]!;
      for (let j = 0; j < list.length && want; j++) { const c = list[j] as OptItem | null; if (c && c.serial === want) { hit = c; break; } }
      if (!hit && list.indexOf(null) < 0) {
        const own = cur[slots[i]!];
        for (let j = 0; j < list.length && own; j++) { const c = list[j] as OptItem | null; if (c && c.serial === own.serial) { hit = c; break; } }
        if (!hit) hit = list[0] as OptItem | null;
      }
      warm[slots[i]!] = hit;
    }
    return optSanitize(warm, slots);
  };
  if (opts.warmStart) {
    const warm = fromSerials(opts.warmStart);
    if (tb) tieCands.push(warm);
    consider(warm);
  }
  if (tb && opts.tieBreak!.topStart) consider(fromSerials(opts.tieBreak!.topStart));
  const rnd = optMulberry32(seed);
  const heuristicBudgetMs = typeof opts.heuristicBudgetMs === "number" ? opts.heuristicBudgetMs : Infinity;
  for (let i = 0; i < restarts && Date.now() - t0 < heuristicBudgetMs; i++) { consider(optRandomSeed(slots, cands, rnd)); prog.restartsDone = i + 1; emit(); }
  emit(true);   // the end of a phase always reports, however fast it went

  best = optSanitize(best, slots);
  bestScore = optScoreVector(optTotalsOf(best, slots, space), space);
  if (lex) bestVec = lexAt(best);

  let method = "heuristic", proven: boolean | undefined = undefined, nodes: number | undefined = undefined;
  let pruned: { before: number; after: number } | undefined = undefined;
  const alt = opts.exact && opts.alternatives && opts.alternatives.count > 0 ? opts.alternatives : null;
  const altTol = alt ? Math.max(0, alt.tolerance || 0) : 0;
  let alternatives: { best: OptAssignment; score: number }[] | undefined = undefined;
  let bbAlts: { a: OptAssignment; score: number }[] = [];
  const exactStart = Date.now();
  if (opts.exact) {
    prog.phase = "prune"; emit(true);
    let before = 0, after = 0;
    const pcands: Record<string, (OptItem | null)[]> = {};
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i]!;
      const hand = s === "oneHanded" || s === "twoHanded", keepNull = hand || !!optional[s];
      // Dominance pruning is safe for the single best suit only: a dominated piece can still belong in a runner-up.
      pcands[s] = alt ? cands[s]!.slice() : optDominancePrune(cands[s]!, space, keepNull, hand);
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
    // with a tie-break, the score pass keeps a quarter of the budget for the tie pass below
    const bb = optBranchAndBound(slots, pcands, space, best, bestScore, tb ? budgetMs * 0.75 : budgetMs, opts.onProgress ? tick : undefined, progressEvery, alt || undefined, undefined, lex);
    const bbBest = optSanitize(bb.best, slots);
    if (lex ? optLexCmp(lexAt(bbBest), bestVec!) > 0 : bb.score > bestScore) { best = bbBest; bestScore = bb.score; noteBest(best, bestScore); if (lex) bestVec = lexAt(best); }
    method = "exact"; proven = bb.proven; nodes = bb.nodes; pruned = { before: before, after: after };
    bbAlts = bb.alts;
    prog.improvements = heuristicImprovements + bb.improvements;
  }

  // The tie-break's second stage. `top` is the best score found; a suit qualifies when it scores at least top - tolerance
  // and meets every floor the best suit (`ref`: opts.tieBreak.topStart when it scores as well, else the best found) meets. Among the candidates (every start's climbed suit, the warm start as given,
  // the best suit), take the lowest tie cost, then the higher score, then the first; then descend: each pass takes the
  // single-slot swap or weapon pair that lowers the cost most and keeps the suit qualifying (ties to the higher score),
  // until none does. The exact phase then proves it with a tie pass of the branch-and-bound over every candidate.
  const topScore = bestScore;
  let tieInfo: { topScore: number; cost: number; changes?: number; top: Record<string, number | null>; floors: string[] } | undefined = undefined;
  let tieRef: OptAssignment = best, tieMet: number[] = [];
  let tieKeeps: ((a: OptAssignment) => boolean) | null = null;   // the trim below must not give up a floor the best suit meets
  // With the tie-break's fewestChanges a piece also costs the change cost in a slot nobody wears, and the worn piece costs
  // it less than nothing (any other piece, and an empty slot, 0), so a suit's cost is its tie cost plus the change cost for
  // each slot it changes, less a constant. The change cost (optChangeCost) is above any suit's summed tie cost, so one
  // changed slot more always costs more than any rarity can save.
  const fewest = !!(opts.tieBreak && opts.tieBreak.fewestChanges);
  let maxTie = 0;
  for (let i = 0; i < slots.length; i++) { const l = cands[slots[i]!]!; for (let j = 0; j < l.length; j++) { const c = l[j]; if (c && (c.tieCost || 0) > maxTie) maxTie = c.tieCost || 0; } }
  const changeCost = optChangeCost(maxTie);
  const costOf = function (it: OptItem | null): number {
    const own = it ? it.tieCost || 0 : 0;
    if (!fewest || !it) return own;
    return own + changeCost * -changeOf(it);
  };
  if (tb) {
    // scores within TIE_SLACK count as equal, the exact solver's precision, or within SCORE_REL of a large one
    const EPS = slackAt(TIE_SLACK, topScore, 0), min = topScore - tb.tolerance;
    if (opts.tieBreak!.topStart) {
      const ts = fromSerials(opts.tieBreak!.topStart);
      if (lex ? optLexCmp(lexAt(ts), bestVec!) >= 0 : optScoreVector(optTotalsOf(ts, slots, space), space) >= topScore - EPS) tieRef = ts;
    }
    const topTv = optTotalsOf(tieRef, slots, space), met: number[] = tieMet;
    // strict order: a suit qualifies when it holds every stage at the top suit's values (the tolerance plays no part)
    const topVec = lex ? optLexOf(topTv, lex) : null;
    for (let i = 0; i < space.keys.length; i++) if (space.floor[i]! > 0 && optFloorMet(space, topTv, i)) met.push(i);
    const qualifies = function (tv: number[], sc: number): boolean {
      if (lex ? !optLexHolds(optLexOf(tv, lex), topVec!) : sc < min - EPS) return false;
      for (let i = 0; i < met.length; i++) if (!optFloorMet(space, tv, met[i]!)) return false;
      return true;
    };
    tieKeeps = function (a: OptAssignment): boolean { const tv = optTotalsOf(a, slots, space); for (let i = 0; i < met.length; i++) if (!optFloorMet(space, tv, met[i]!)) return false; return true; };
    let pick = tieRef, pickScore = optScoreVector(topTv, space), pickCost = optTieCost(tieRef, slots, costOf);
    tieCands.push(best);
    for (let i = 0; i < tieCands.length; i++) {
      const a = optSanitize(tieCands[i]!, slots), tv = optTotalsOf(a, slots, space), sc = optScoreVector(tv, space), c = optTieCost(a, slots, costOf);
      if (!qualifies(tv, sc)) continue;
      if (c < pickCost - FLOAT_EPS || (c <= pickCost + FLOAT_EPS && sc > pickScore + EPS)) { pick = a; pickScore = sc; pickCost = c; }
    }
    const cur2: OptAssignment = { ...pick }, totals = optTotalsOf(cur2, slots, space);
    const oneCands = cands["oneHanded"] || [null], twoCands = cands["twoHanded"] || [null];
    for (let pass = 0; pass < maxPasses; pass++) {
      let bestDrop = FLOAT_EPS, moveScore = -Infinity, moveSlot = "", moveItem: OptItem | null = null, movePair: { one: OptItem | null; two: OptItem | null } | null = null;
      const consider2 = function (drop: number, sc: number): boolean {
        if (drop > bestDrop + FLOAT_EPS || (drop >= bestDrop - FLOAT_EPS && moveScore > -Infinity && sc > moveScore + EPS)) { bestDrop = drop; moveScore = sc; return true; }
        return false;
      };
      for (let i = 0; i < slots.length; i++) {
        const slot = slots[i]!;
        if (slot === "oneHanded" || slot === "twoHanded") continue;
        const have = cur2[slot] || null, vHave = optVec(have, space);
        optAddVec(totals, vHave, -1);
        const list = cands[slot]!;
        for (let j = 0; j < list.length; j++) {
          const cand = list[j] as OptItem | null;
          if (cand === have) continue;
          const drop = costOf(have) - costOf(cand);
          if (drop < bestDrop - FLOAT_EPS) continue;
          const vC = optVec(cand, space);
          optAddVec(totals, vC, 1);
          const sc = optScoreVector(totals, space);
          if (qualifies(totals, sc) && consider2(drop, sc)) { moveSlot = slot; moveItem = cand; movePair = null; }
          optAddVec(totals, vC, -1);
        }
        optAddVec(totals, vHave, 1);
      }
      if (slots.indexOf("oneHanded") >= 0 && slots.indexOf("twoHanded") >= 0) {
        const haveOne = cur2["oneHanded"] || null, haveTwo = cur2["twoHanded"] || null;
        optAddVec(totals, optVec(haveOne, space), -1);
        optAddVec(totals, optVec(haveTwo, space), -1);
        for (let i = 0; i < twoCands.length; i++) {
          const two = twoCands[i] as OptItem | null, ones = optIsTwoHandedWeapon(two) ? [null] : oneCands;
          for (let j = 0; j < ones.length; j++) {
            const one = ones[j] as OptItem | null;
            if (one === haveOne && two === haveTwo) continue;
            const drop = costOf(haveOne) + costOf(haveTwo) - costOf(one) - costOf(two);
            if (drop < bestDrop - FLOAT_EPS) continue;
            const v1 = optVec(one, space), v2 = optVec(two, space);
            optAddVec(totals, v1, 1); optAddVec(totals, v2, 1);
            const sc = optScoreVector(totals, space);
            if (qualifies(totals, sc) && consider2(drop, sc)) { movePair = { one: one, two: two }; moveSlot = ""; moveItem = null; }
            optAddVec(totals, v1, -1); optAddVec(totals, v2, -1);
          }
        }
        optAddVec(totals, optVec(haveOne, space), 1);
        optAddVec(totals, optVec(haveTwo, space), 1);
      }
      if (movePair) {
        optAddVec(totals, optVec(cur2["oneHanded"] || null, space), -1);
        optAddVec(totals, optVec(cur2["twoHanded"] || null, space), -1);
        cur2["oneHanded"] = movePair.one; cur2["twoHanded"] = movePair.two;
        optAddVec(totals, optVec(movePair.one, space), 1);
        optAddVec(totals, optVec(movePair.two, space), 1);
      } else if (moveSlot) {
        optAddVec(totals, optVec(cur2[moveSlot] || null, space), -1);
        cur2[moveSlot] = moveItem;
        optAddVec(totals, optVec(moveItem, space), 1);
      } else break;
    }
    best = optSanitize(cur2, slots);
    bestScore = optScoreVector(optTotalsOf(best, slots, space), space);
    if (opts.exact) {
      const bb2 = optBranchAndBound(slots, cands, space, best, bestScore, Math.max(0, budgetMs - (Date.now() - exactStart)), undefined, undefined, undefined, { min: min - EPS, met: met, cost: optTieCost(best, slots, costOf), costOf: costOf, lexMins: topVec || undefined }, lex);
      best = optSanitize(bb2.best, slots);
      bestScore = optScoreVector(optTotalsOf(best, slots, space), space);
      proven = proven && bb2.proven;
      nodes = (nodes || 0) + bb2.nodes;
    }
  }
  if (alt) {
    const sigOf = function (a: OptAssignment): string { const parts: string[] = []; for (let i = 0; i < slots.length; i++) { const it = a[slots[i]!]; parts.push(it ? String(it.serial) : "0"); } return parts.join(","); };
    const seen: Record<string, boolean> = {};
    seen[sigOf(best)] = true;
    // strict order: only suits equal to the best on every stage, whatever the tolerance
    const list = bbAlts.map(function (e) { const a = optSanitize(e.a, slots); return { best: a, score: optScoreVector(optTotalsOf(a, slots, space), space) }; })
      .filter(function (e) { return !lex || optLexCmp(lexAt(e.best), bestVec!) === 0; });
    list.sort(function (x, y) { return y.score - x.score; });
    alternatives = [];
    for (let i = 0; i < list.length && alternatives.length < alt.count; i++) {
      const e = list[i]!;
      if (!lex && e.score < topScore - altTol - slackAt(FLOAT_EPS, e.score, topScore)) break;   // ranked against the best score, which a tie-break's suit may sit under
      const k = sigOf(e.best);
      if (seen[k]) continue;
      seen[k] = true;
      alternatives.push(e);
    }
  }
  prog.phase = "done"; emit(true);

  // An unworn piece in an optional slot (the hands aside) that adds nothing to the score comes off: a tie with wearing
  // nothing would only send the player to fetch it. One pass after the search, so both solvers' final suits agree.
  const untrimmed = scoreSet(best, profile);
  let tied = untrimmed;
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i]!, it = best[s] || null;
    if (!it || !optional[s] || s === "oneHanded" || s === "twoHanded" || (cur[s] && cur[s]!.serial === it.serial)) continue;
    const without: OptAssignment = { ...best, [s]: null }, sc = scoreSet(without, profile);
    // strict order: it comes off when no stage is lower without it
    if ((lex ? optLexCmp(lexAt(without), lexAt(best)) >= 0 : sc >= tied - FLOAT_EPS) && (!tieKeeps || tieKeeps(without))) { best = without; tied = sc; }
  }
  bestScore += tied - untrimmed;
  if (tb) {
    const top: Record<string, number | null> = {};
    for (let i = 0; i < slots.length; i++) { const it = tieRef[slots[i]!]; top[slots[i]!] = it ? it.serial : null; }
    tieInfo = { topScore: Math.max(topScore, bestScore), cost: optTieCost(best, slots), ...(fewest ? { changes: optChanges(best, cur, slots) } : {}), top: top, floors: tieMet.map(function (i) { return space.keys[i]!; }).sort() };
  }

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
    altTolerance: alt ? altTol : undefined,
    ...(tieInfo ? { tieBreak: tieInfo } : {}),
    ...(lex ? { lex: lexAt(best) } : {})
  };
}

export { optStrictStages, optStrictScore, optLexCmp, optChanges, CHANGE_COST, optChangeCost, scoreSet, optimizeSuit, optIsValidAssignment, optMulberry32, optDefaultSlots, optDefaultOptionalSlots, optAssignmentTotals, optGradientProfile, optCollectKeys, optBuildSpace, optDominancePrune, optVec, optScoreVector, optIsTwoHandedWeapon };
