// exact-solver.mts — the orchestration between the core's heuristic search and the HiGHS exact
// solver (app/mip.mts + app/mip-solve.mts). One call, one job, no worker pool: HiGHS itself
// explores the tree, so there is nothing left to split across threads (that's what retired the
// multi-worker branch-and-bound path this app used to run in app/vault-server.mts, backed by the
// core's own `shared` option and a since-deleted shared-search.mjs).
//
// Flow: (1) run the core's own heuristic search for a fast, always-available incumbent: bestScore,
// currentScore, and everything else a "heuristic" OptResult carries. (2) build the suit as a MIP
// and hand it to HiGHS, seeded from the heuristic's best suit. (3) if the hard floors are jointly
// unreachable, retry once with every hard floor modelled as soft (hardAsSoft) so the honest,
// non-exact fallback still reports something useful. (4) optionally walk k-1 more no-good cuts to
// collect alternatives. (5) always hand the winning suit BACK to the core (exact:false,
// restarts:0, warmStart) so the returned OptResult carries every field the core computes
// (perSlotChanges, totals, greedyScore, …) and is re-scored by the SAME code path as every other
// result in this app — never a value computed only inside the MIP.
//
// TYPES: the core (scripts/optimizer-core.mts) exports no type names, only functions — Pools/
// Assignment/Profile/Options/Result below are derived structurally through Parameters<>/ReturnType<>
// on Core.optimizeSuit, the same pattern scripts/optimizer-core.test.mts uses, rather than imported
// or hand-duplicated. app/mip.mts separately declares its OWN item/profile shapes (sourced from
// vault-lib.mts's OptItem), because it has no dependency on the core at all — the two shapes
// describe the same runtime objects but are structurally slightly looser/stricter in different
// fields (e.g. mip.mts's OptItem.twoHanded is `true | undefined`, matching vault-lib.mts; the
// core's is a plain `boolean`), so this file — which sits between the two — casts pools/current/
// profile once at the top to the core's own shape before ever calling core.optimizeSuit/scoreSet,
// rather than fighting that structural mismatch at every call site.
//
// map: builder
// owns: `solveExact`
import type * as Core from "../scripts/optimizer-core.mts";
import type { OptItem } from "./vault-lib.mts";
import type { AltShortfall, ExactSolveResult as SharedExactSolveResult, SolveProgress, StrictStageProgress } from "./api/optimize.mts";
import { buildSuitMip, startVector, pickedOf, tieBreakModel, heldModel, stageObjective, tieCosts, changeCostFor, DEFAULT_SLOTS, DEFAULT_OPTIONAL_SLOTS, type BuiltMip } from "./mip.mts";
import { DEFAULT_BUDGET_MS, DEFAULT_RESTARTS, FLOAT_EPS, PROGRESS_EVERY_MS, TIE_SLACK, slackAt } from "./solver/scoring.mts";
import { startBudget } from "./solver/budget.mts";
import {
  loadHighs as defaultLoadHighs, openModel, solveModel as defaultSolveModel, addNoGood, closeModel,
  type HighsInstance, type Handle, type SolveModelOptions, type SolveResult,
} from "./mip-solve.mts";

type OptOptionsFull = NonNullable<Parameters<typeof Core.optimizeSuit>[3]>;
export type OptPools = Parameters<typeof Core.optimizeSuit>[0];
export type OptAssignment = Parameters<typeof Core.optimizeSuit>[1];
export type OptProfile = Parameters<typeof Core.optimizeSuit>[2];
export type OptResult = ReturnType<typeof Core.optimizeSuit>;
type CoreProgress = Parameters<NonNullable<OptOptionsFull["onProgress"]>>[0];

// The subset of the core module this file actually calls — injected (rather than imported
// directly) so app/optimize-worker.mts can hand it the dynamically `import()`-ed copy.
export interface CoreModule {
  optimizeSuit: typeof Core.optimizeSuit;
  scoreSet: typeof Core.scoreSet;
  optStrictStages: typeof Core.optStrictStages;
  optLexCmp: typeof Core.optLexCmp;
  optStrictScore: typeof Core.optStrictScore;
  optChanges: typeof Core.optChanges;
}

// The result and progress shapes (the exact search's own fields, the tie-break's and strict order's outcomes, why fewer
// alternatives than asked) are shared with the core, the worker and the page: app/api/optimize.mts.
export type { AltShortfall, StrictResult, StrictStageProgress, SolveProgress, TieBreakResult } from "./api/optimize.mts";
export type ExactSolveResult = SharedExactSolveResult<OptAssignment>;

export interface SolveExactArgs {
  core: CoreModule;
  pools: OptPools;
  current: OptAssignment;
  profile: OptProfile;
  opts: OptOptionsFull;
  onProgress: (p: SolveProgress) => void;
  onWarn?: ((message: string) => void) | undefined;
  loadHighs?: (() => Promise<HighsInstance>) | undefined;
  solveModel?: ((handle: Handle, opts: SolveModelOptions) => SolveResult) | undefined;
  now?: (() => number) | undefined;
}

const countCandidates = (built: BuiltMip): number => Object.values(built.xIndex).reduce((n, list) => n + list.length, 0);
const assignmentOf = (picked: Partial<Record<string, OptItem>>, slots: string[]): OptAssignment =>
  // picked's values are mip.mts's OptItem (vault-lib's), one slot short of the core's own item
  // shape (see the file-header note) — the same runtime objects either way.
  Object.fromEntries(slots.map((s): [string, OptItem | null] => [s, picked[s] || null])) as unknown as OptAssignment;
// Scores near HARD_FLOOR_BONUS (1e7 per hard floor) carry float noise of a few 1e-9 from summing in
// a different order, so "one score beats another" needs a margin above that noise (and far below
// HiGHS's own mip_abs_gap of 1e-3) — else an exact tie reads as the heuristic leading. Every comparison
// takes it through slackAt (app/solver/scoring.mts), which grows it with the scores (issue #316: near 1e10 the noise
// passes 1e-6).
const SCORE_EPS = 1e-6;
// A result's best score: with a tie-break the returned suit may score under it (OptResult.tieBreak.topScore).
const topOf = (r: OptResult): number => r.tieBreak ? r.tieBreak.topScore : r.score;
const tieCostOf = (picked: Partial<Record<string, OptItem>>): number => Object.values(picked).reduce((n, it) => n + (it?.tieCost || 0), 0);
// How many slots of `picked` hold another piece than `current` (fewest changes).
const serialsKey = (a: OptAssignment): string => JSON.stringify(serialsOf(a));
const dot = (a: ArrayLike<number>, b: ArrayLike<number>): number => { let s = 0; for (let j = 0; j < a.length; j++) s += a[j]! * b[j]!; return s; };
const serialsOf = (suit: Partial<Record<string, { serial: number } | null>> | null | undefined): Record<string, number | null> =>
  Object.fromEntries(Object.entries(suit || {}).map(([slot, it]): [string, number | null] => [slot, it ? it.serial : null]));

export async function solveExact({
  core, pools, current, profile, opts, onProgress, onWarn = () => {}, loadHighs = defaultLoadHighs, solveModel = defaultSolveModel, now = Date.now,
}: SolveExactArgs): Promise<ExactSolveResult> {
  const budget = startBudget(opts.timeBudgetMs ?? DEFAULT_BUDGET_MS, now);
  const restarts = opts.restarts ?? DEFAULT_RESTARTS;
  const optionalSlots = opts.optionalSlots ?? DEFAULT_OPTIONAL_SLOTS;
  const slots = opts.slots ?? DEFAULT_SLOTS;

  // ---- step 1: the heuristic incumbent, always available -----------------------------------
  // Its random restarts get at most half the budget, so HiGHS always keeps the other half.
  const heur = core.optimizeSuit(pools, current, profile, { ...opts, exact: false, restarts, heuristicBudgetMs: budget.heuristicMs, onProgress: (p: CoreProgress) => onProgress({ ...p, at: now() }) });
  const heuristicMs = budget.elapsedMs();
  // with a tie-break, the heuristic's best-scoring suit (its tie pick may score under it), for a hand-back from its suit
  const heurTop = opts.tieBreak && heur.tieBreak?.top ? { tieBreak: { ...opts.tieBreak, topStart: heur.tieBreak.top } } : {};

  // ---- step 2: build the MIP ----------------------------------------------------------------
  // mip.mts's own (looser) item/profile shapes accept the core's stricter ones without a cast —
  // see the file-header note.
  const mipPools = pools as unknown as Partial<Record<string, OptItem[]>>;
  const mipCurrent = current as unknown as Partial<Record<string, OptItem>>;
  // profile (the core's own OptProfile, caps required) satisfies mip.mts's MipProfile (every field
  // optional) as-is — no cast needed in this direction.
  // strict order (issue #292): the stages, most important first, which need the objective split by property
  const stages = opts.strict ? core.optStrictStages(profile, opts.strict.ranks, !!opts.strict.fewestChanges) : null;
  const built = buildSuitMip({ pools: mipPools, current: mipCurrent, profile, optionalSlots, slots, parts: !!stages });
  if (built.cols.every((c) => c.kind !== "x")) {
    // Nothing to decide (every slot fixed or empty): the heuristic's suit is trivially optimal.
    return { ...heur, method: "exact", proven: true, solver: "none", bound: heur.score, gapPoints: 0, mipMs: 0, heuristicMs, unreachableFloors: built.unreachableFloors };
  }
  const candidates = countCandidates(built);

  let highs: HighsInstance;
  try {
    highs = await loadHighs();
  } catch (e) {
    onWarn(`HiGHS unavailable: ${(e as Error).message}`);
    return {
      ...heur, method: "heuristic", solver: "fallback", fallbackReason: String((e as Error).message).slice(0, 200),
      bound: null, gapPoints: null, mipMs: 0, heuristicMs, unreachableFloors: built.unreachableFloors,
    };
  }

  // ---- step 3: solve ------------------------------------------------------------------------
  let active = built;
  let handle = openModel(highs, active);
  try {
    // Every HiGHS call (first solve, hardAsSoft retry, each alternative) shares what is left of the one budget
    // (app/solver/budget.mts); with a tie-break the first solve takes TIE_STAGE_SHARE of it.
    const tb = opts.tieBreak ? { rarity: opts.tieBreak.rarity, fewest: !!opts.tieBreak.fewestChanges, tolerance: Math.max(0, opts.tieBreak.tolerance || 0) } : null;
    // equal scores: the solvers' score precision with a tie-break (app/mip.mts TIE_SLACK, as the core and the stage-2 row), else SCORE_EPS
    const eps = tb ? TIE_SLACK : SCORE_EPS;
    let lastEmit = 0;
    // HiGHS reports ±Infinity for a bound it has not established yet (seen at sub-second budgets): no bound.
    const toScore = (v: number | null | undefined): number | null => (v == null || !Number.isFinite(v) ? null : v + active.scoreOffset);
    // a strict-order stage's events carry the stage and no score (a stage's objective is not the score)
    const onEvent = (ev: { kind: string; primal: number | undefined; dual: number | undefined; nodes: number }, stage?: StrictStageProgress) => {
      const at = now();
      if (lastEmit !== 0 && at - lastEmit < PROGRESS_EVERY_MS) return;
      lastEmit = at;
      const bestScore = toScore(ev.primal);
      const bound = toScore(ev.dual);
      onProgress({
        phase: "exact", elapsedMs: at - budget.startedAt, budgetMs: budget.ms, bestScore, bound,
        gapPoints: bestScore != null && bound != null ? Math.max(0, bound - bestScore) : null,
        nodes: ev.nodes, candidates, solver: "highs", currentScore: heur.currentScore, at, ...(stage ? { stage } : {}),
      });
    };

    const alt = opts.alternatives && opts.alternatives.count > 0 ? opts.alternatives : null;
    // ---- strict order: one solve per stage, most important first, each holding every earlier stage at what it reached
    // (app/mip.mts heldModel) and started from the stage before's suit. Each stage gets an equal share of what is left with
    // the solves still to come (the tie-break's and the other suits' count one each), so a quick stage leaves its time to
    // the rest. A stage that runs out of time stops the sequence: its incumbent, never worse than its start, is the suit,
    // and `proven` counts the stages proven in order. The result stands in for the one solve below: its objective is the
    // plain score of that suit, `colValue` the suit, and `held` every stage's objective for the tie-break and the other suits.
    let held: number[][] = [], achieved: number[] = [], strictValues: number[] = [], strictProven = 0;
    const solveStrict = (start: Float64Array): SolveResult => {
      const objectives = stages!.map((st) => stageObjective(active, st, mipCurrent)), extra = (tb ? 1 : 0) + (alt ? 1 : 0);
      const hardRows = Object.keys(active.hardRows).length > 0;
      let vec = start, last: SolveResult | null = null, nodes = 0;
      held = []; achieved = []; strictProven = 0;
      for (const [i, o] of objectives.entries()) {
        // a constant stage has nothing to choose, but the first is solved while the model has hard rows: that solve is
        // what checks them (a conflict then reaches the hardAsSoft retry, as in Best value)
        if (o.cost.every((c) => c === 0) && (i > 0 || !hardRows)) { held.push(o.cost); achieved.push(0); if (strictProven === i) strictProven++; continue; }
        const st = stages![i]!, stage = { at: i + 1, of: objectives.length, kind: st.kind, keys: st.keys };
        const run = (limit: number): SolveResult => {
          const h = openModel(highs, heldModel(active, vec, held, o.cost, "maximize", { values: achieved }));
          try {
            return solveModel(h, { timeLimitS: limit, start: vec, onEvent: (ev) => { onEvent({ ...ev, primal: undefined, dual: undefined }, stage); } });
          } finally {
            closeModel(h);
          }
        };
        onProgress({ phase: "exact", stage, elapsedMs: budget.elapsedMs(), budgetMs: budget.ms, candidates, solver: "highs", currentScore: heur.currentScore, bestScore: null, bound: null, gapPoints: null, at: now() });
        const share = budget.leftS() / (objectives.length - i + extra);
        last = run(share);
        nodes += last.nodes;
        // Out of time with time left: once more from its incumbent, with all that is left but the tie-break's and the other
        // suits' shares. The stages after it are worth nothing unproven, so its proof is what the time is for.
        if (last.status === "timeLimit" && last.colValue && budget.leftS() / (1 + extra) > 1.5 * share) {
          vec = startVector(active, pickedOf(active, last.colValue));
          last = run(budget.leftS() / (1 + extra));
          nodes += last.nodes;
        }
        if (last.colValue == null) break;   // infeasible (only the first stage's hard rows can be) or no incumbent
        vec = startVector(active, pickedOf(active, last.colValue));
        held.push(o.cost); achieved.push(dot(o.cost, vec));
        if (last.status === "optimal" && strictProven === i) strictProven++;
        if (last.status !== "optimal") break;
      }
      held = objectives.map((o) => o.cost);
      strictValues = objectives.map((o) => dot(o.cost, vec) + o.offset);
      const done = strictProven === objectives.length;
      if (last && last.colValue == null && vec === start) return { ...last, nodes };
      return { status: done ? "optimal" : last!.status === "infeasible" ? "other" : last!.status, statusText: done ? "strict order: every stage proven" : `strict order: ${strictProven} of ${objectives.length} stages proven`,
        objective: dot(active.model.colCost, vec), primal: null, dual: null, gapAbs: null, nodes, colValue: vec, ms: last?.ms ?? 0 };
    };
    const firstSolve = (): SolveResult => {
      const start = startVector(active, heur.best as unknown as Partial<Record<string, OptItem>>);
      return stages ? solveStrict(start) : solveModel(handle, { timeLimitS: budget.firstStageS(!!tb), start, onEvent });
    };
    let solve = firstSolve();
    let floorsConflict = false;

    if (solve.status === "infeasible") {
      // The hard floors conflict jointly (each is individually reachable — buildSuitMip already
      // marks a floor no suit can ever reach as "unreachable" and never gives it a hard row — but
      // no single suit satisfies all of them at once). Retry with every hard floor modelled as
      // soft so the fallback below still reports the best honestly-reachable suit.
      floorsConflict = true;
      closeModel(handle);
      active = buildSuitMip({ pools: mipPools, current: mipCurrent, profile, optionalSlots, slots, hardAsSoft: true, parts: !!stages });
      handle = openModel(highs, active);
      solve = firstSolve();
    }

    // A genuine floors conflict only ever gets HERE by way of the infeasible branch above: the
    // hardAsSoft retry it triggered is either still infeasible outright, or (relaxed as it is,
    // almost always feasible) simply never found an incumbent in what time was left — either way,
    // the ONE thing we know for certain is that the original hard floors cannot be met jointly, so
    // reporting that honestly is correct regardless of which of the two happened.
    if (floorsConflict && (solve.status === "infeasible" || solve.colValue == null)) {
      const mipMs = budget.elapsedMs() - heuristicMs;
      return {
        ...heur, method: "heuristic", solver: "fallback", fallbackReason: "no suit satisfies the required floors",
        floorsConflict: true, bound: null, gapPoints: null, mipMs, heuristicMs, unreachableFloors: active.unreachableFloors,
      };
    }

    // A plain timeout with no incumbent at all — NOT a floors conflict (floorsConflict is still
    // false here: the model was never even found infeasible, hard floors or otherwise; it simply
    // ran out of time before HiGHS accepted a first feasible integer solution, a realistic outcome
    // on a large pool with a tight budget). The heuristic's own suit is the best known, reported
    // through the core exactly like any other result rather than invented here.
    if (solve.colValue == null) {
      const final = core.optimizeSuit(pools, current, profile, { ...opts, exact: false, restarts: 0, warmStart: serialsOf(heur.best), ...heurTop });
      const mipMs = budget.elapsedMs() - heuristicMs;
      const bound = stages ? null : toScore(solve.dual);
      return {
        ...final, method: "exact", proven: false, solver: "highs", bound, gapPoints: bound != null ? bound - final.score : null,
        nodes: solve.nodes, restarts, evaluations: heur.evaluations + final.evaluations, alternatives: undefined, altTolerance: undefined,
        mipMs, heuristicMs, floorsConflict: false, unreachableFloors: active.unreachableFloors, pruned: undefined,
      };
    }

    const picked = pickedOf(active, solve.colValue);
    const mipScore = solve.objective! + active.scoreOffset;

    // ---- step 3b: the tie-break's second stage (optional) -----------------------------------
    // Among suits within the tolerance of stage 1's that meet every floor it meets, the lowest summed tie cost
    // (app/mip.mts tieBreakModel), started from stage 1's suit, so a timeout still returns a suit no worse than it.
    // With strict order, among the suits that hold every stage and meet the same floors. With fewest changes, the tie cost
    // counts the change cost for each slot changed from the worn suit (app/mip.mts tieCosts).
    let picked2 = picked, stage2Optimal = true;
    if (tb) {
      // stage 1's suit with every column worked out from its own totals: an unproven incumbent may leave a met floor's indicator at 0
      const start = startVector(active, picked), costs = tieCosts(active, tb.fewest ? mipCurrent : null);
      const h2 = openModel(highs, stages ? heldModel(active, start, held, costs, "minimize", { fixMet: true }) : tieBreakModel(active, start, tb.tolerance, costs));
      try {
        onProgress({ phase: "tie-break", elapsedMs: budget.elapsedMs(), budgetMs: budget.ms, bestScore: mipScore, at: now() });
        // with other suits asked for, half of what is left stays theirs
        const s2 = solveModel(h2, { timeLimitS: (alt ? 0.5 : 1) * budget.leftS(), start });
        if (s2.colValue) picked2 = pickedOf(active, s2.colValue);
        stage2Optimal = s2.status === "optimal";
      } finally {
        closeModel(h2);
      }
    }

    // ---- step 4: k-best alternatives (optional) --------------------------------------------
    const altTolerance = alt ? Math.max(0, alt.tolerance || 0) : undefined;
    const alternatives: { best: OptAssignment; score: number }[] = [];
    // the first cut is the returned suit, so with a tie-break the top-score suit can come back as the first alternative
    let lastPicked = picked2;
    // Why fewer alternatives came back than were asked for (unset when the count was met).
    let altShortfall: AltShortfall | undefined;
    if (alt) {
      // strict order: the suits that hold every stage (the tolerance plays no part), the best plain score first
      const kh = stages ? openModel(highs, heldModel(active, startVector(active, picked), held, active.model.colCost, "maximize")) : handle;
      try {
        for (let k = 0; k < alt.count && !budget.over(); k++) {
          addNoGood(kh, active, lastPicked);
          onProgress({ phase: "alternatives", found: alternatives.length, wanted: alt.count, elapsedMs: budget.elapsedMs(), budgetMs: budget.ms, bestScore: mipScore, at: now() });
          const sk = solveModel(kh, { timeLimitS: budget.leftS() });
          if (sk.status !== "optimal") { altShortfall = sk.status === "infeasible" ? "exhausted" : "budget"; break; }
          const score = sk.objective! + active.scoreOffset;
          if (!stages && score < mipScore - altTolerance! - slackAt(FLOAT_EPS, score, mipScore)) { altShortfall = "tolerance"; break; }
          const skPicked = pickedOf(active, sk.colValue!);
          const assignment = assignmentOf(skPicked, slots);
          alternatives.push({ best: assignment, score: core.scoreSet(assignment, profile) });
          lastPicked = skPicked;
        }
      } finally {
        if (kh !== handle) closeModel(kh);
      }
      if (alternatives.length < alt.count) altShortfall ??= "budget";   // the loop's own time check ended it
    }

    // ---- step 5: hand the winning suit back to the core for the full report ----------------
    // The MIP start guarantees HiGHS never returns an incumbent that scores below the heuristic
    // from that starting point on — but a `timeLimit` result can still lose the race: the
    // incumbent's own objective (mipScore) can come in under heur.score if the warm start was
    // declined, rejected on tolerance, or lost to a `hardAsSoft` retry that started over. Enforce
    // the invariant docs/solver.md promises ("can only find something better ... never regress from
    // it") here rather than assume the model upholds it in every case: whenever the reported suit
    // would score below the heuristic's own — either the MIP incumbent already trailed it, or the
    // core's own re-optimization of `picked` (a different search than HiGHS's) still landed below it
    // — hand the heuristic's OWN suit to the core instead, so `final` can never be a regression, and
    // report it honestly as unproven with a warning rather than silently as an exact result.
    // Each of the three guards below revokes `proven` and warns with the numbers. After an `optimal`
    // status any of them firing means the model and the core disagree about a suit's score — a
    // modelling bug, not a race — so HiGHS's bound is no bound on the core's scores either.
    const stats = `HiGHS status ${solve.status}, objective ${mipScore}, heuristic ${heur.score}`;
    // With a tie-break the guards compare best scores (topOf) and, where those agree, tie costs. With strict order they
    // compare the stage values (the core's `lex`, HiGHS's strictValues) stage by stage; a tie-break's suit holds the top's.
    type Top = number | number[];
    const topIn = (r: OptResult): Top => (stages ? r.lex! : topOf(r)), mipTop: Top = stages ? strictValues : mipScore;
    const cmpTop = (a: Top, b: Top, base: number): number => {
      if (stages) return core.optLexCmp(a as number[], b as number[]);
      const x = a as number, y = b as number, slack = slackAt(base, x, y);
      return x > y + slack ? 1 : x < y - slack ? -1 : 0;
    };
    const heuristicLeads = cmpTop(topIn(heur), mipTop, eps) > 0;
    // the top-score suit (stage 1's, or the heuristic's when it leads) rides along as one more start, so the core's best
    // score is that suit's, and the floors it meets are the ones both stages held
    const topSuit = heuristicLeads ? heur.tieBreak?.top : serialsOf(picked);
    const topStart = tb && topSuit ? { tieBreak: { ...opts.tieBreak!, topStart: topSuit } } : {};
    let final = core.optimizeSuit(pools, current, profile, { ...opts, exact: false, restarts: 0, warmStart: serialsOf(heuristicLeads ? heur.best : picked2), ...topStart });
    let coreImproved = false, rescoreMismatch = false;
    // a tie cost with fewest changes: the change cost for each slot changed, then the rarity tie cost
    const changeCost = changeCostFor(active);
    const tieOrder = (r: OptResult): number => r.tieBreak!.cost + changeCost * (r.tieBreak!.changes ?? 0);
    const cost2 = tieCostOf(picked2) + (tb?.fewest ? changeCost * core.optChanges(assignmentOf(picked2, slots), current, slots) : 0);
    if (!heuristicLeads) {
      if (cmpTop(topIn(final), mipTop, eps) > 0) {
        onWarn(stages ? `core improved on HiGHS's stages ${JSON.stringify(strictValues)}: ${JSON.stringify(topIn(final))} (${stats})` : `core improved on HiGHS by ${topOf(final) - mipScore} (${stats})`);
        coreImproved = true;
      } else if (tb && stage2Optimal && final.tieBreak && tieOrder(final) < cost2 - FLOAT_EPS) {
        onWarn(`core found a lower tie cost than HiGHS's proven ${cost2}: ${tieOrder(final)} (${stats})`);
        coreImproved = true;
      }
      if (cmpTop(topIn(final), mipTop, TIE_SLACK) < 0) {
        onWarn(stages ? `re-score mismatch: the core scores HiGHS's suit ${JSON.stringify(topIn(final))} against its stages ${JSON.stringify(strictValues)} (${stats})` : `re-score mismatch: the core scores HiGHS's suit ${topOf(final)} (${stats})`);
        rescoreMismatch = true;
      }
    }
    // a costlier suit than the heuristic's counts only against the same floors held (equal tops can meet different ones)
    const sameFloors = (a: OptResult, b: OptResult): boolean => (a.tieBreak?.floors || []).join() === (b.tieBreak?.floors || []).join();
    const costAbove = (a: OptResult, b: OptResult): boolean => !!(tb && a.tieBreak && b.tieBreak && cmpTop(topIn(a), topIn(b), eps) === 0 && sameFloors(a, b) && tieOrder(a) > tieOrder(b) + FLOAT_EPS);
    let belowHeuristic = heuristicLeads;
    if (!heuristicLeads && (cmpTop(topIn(final), topIn(heur), eps) < 0 || costAbove(final, heur))) {
      final = core.optimizeSuit(pools, current, profile, { ...opts, exact: false, restarts: 0, warmStart: serialsOf(heur.best), ...heurTop });
      belowHeuristic = true;
    }
    if (belowHeuristic) onWarn(stages ? `exact search's stages ${JSON.stringify(strictValues)} came in below the heuristic's ${JSON.stringify(heur.lex)} — reporting the heuristic's suit instead of a regression (${stats})` : `exact search's suit scored below the heuristic's ${heur.score} — reporting the heuristic's suit instead of a regression (${stats})`);
    // Other suits never list the returned suit: the core can hand back another suit than HiGHS's, even one the loop listed.
    // HiGHS's own suit is then one of them (in Best value when within the tolerance). In strict order keep only those equal
    // to the returned suit on every stage (a heuristic's suit can win on a later stage).
    const highsSuit = { best: assignmentOf(picked2, slots), score: core.scoreSet(assignmentOf(picked2, slots), profile) };
    const shownAlts = [...(stages || highsSuit.score >= final.score - (altTolerance ?? 0) - slackAt(FLOAT_EPS, highsSuit.score, final.score) ? [highsSuit] : []), ...alternatives]
      .filter((a, i, all) => serialsKey(a.best) !== serialsKey(final.best) && all.findIndex((x) => serialsKey(x.best) === serialsKey(a.best)) === i
        && (!stages || core.optLexCmp(core.optStrictScore(a.best, current, profile, opts.strict!, slots), final.lex!) === 0))
      .sort((x, y) => stages ? 0 : y.score - x.score)
      .slice(0, alt?.count ?? 0);
    // strict order: a list that came back short (not for time) is short because no more suits match on every goal
    if (alt && stages && shownAlts.length < alt.count && altShortfall !== "budget") altShortfall = "unequal";

    const mipMs = budget.elapsedMs() - heuristicMs;
    const disagree = solve.status === "optimal" && (coreImproved || belowHeuristic || rescoreMismatch);
    // strict order has no bound on the plain score: its proof is the stages', as far as the returned suit holds their
    // values (a heuristic's suit that wins on a later stage holds them; one that differs on a proven stage does not)
    let stillProven = 0;
    while (stages && stillProven < strictProven && Math.abs(final.lex![stillProven]! - strictValues[stillProven]!) <= slackAt(TIE_SLACK, final.lex![stillProven]!, strictValues[stillProven]!)) stillProven++;
    const boundRaw = disagree || stages ? null : solve.status === "optimal" ? solve.objective : solve.dual;
    const proven = solve.status === "optimal" && !coreImproved && !belowHeuristic && !rescoreMismatch;
    return {
      ...final,
      method: "exact",
      proven,
      solver: "highs",
      bound: toScore(boundRaw),
      gapPoints: disagree || stages ? null : solve.gapAbs,
      ...(stages ? { strictProven: disagree ? 0 : stillProven } : {}),
      nodes: solve.nodes,
      restarts,
      evaluations: heur.evaluations + final.evaluations,
      alternatives: alt ? shownAlts : undefined,
      altTolerance,
      altShortfall,
      mipMs, heuristicMs,
      floorsConflict,
      unreachableFloors: active.unreachableFloors,
      pruned: undefined,
      ...(tb && final.tieBreak ? { tieBreak: { topScore: Math.max(mipScore, topOf(final)), cost: final.tieBreak.cost, ...(final.tieBreak.changes != null ? { changes: final.tieBreak.changes, fewestChanges: true } : {}), ...(tb.rarity ? { rarity: tb.rarity } : {}), tolerance: tb.tolerance, costProven: proven && stage2Optimal } } : {}),
    };
  } finally {
    closeModel(handle);
  }
}
