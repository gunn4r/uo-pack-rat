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
// result in this app — never a value computed only inside the MIP. What a build carries through these steps is an
// ExactRun (app/solver/exact/run.mts), where Best value and Strict order differ the build asks its objective
// (app/solver/exact/objective.mts), and steps 3b to 5 (the tie-break's second stage, the other suits, the hand-back and
// its guards) are app/solver/exact/phases.mts.
//
// TYPES: the core (scripts/optimizer-core.mts) exports no type names, only functions — Pools/
// Assignment/Profile/Options/Result (app/solver/exact/run.mts) are derived structurally through Parameters<>/ReturnType<>
// on Core.optimizeSuit, the same pattern scripts/optimizer-core.test.mts uses, rather than imported
// or hand-duplicated. app/mip.mts separately declares its OWN item/profile shapes (sourced from
// vault-lib.mts's OptItem), because it has no dependency on the core at all — the two shapes
// describe the same runtime objects but are structurally slightly looser/stricter in different
// fields (e.g. mip.mts's OptItem.slot is `string | null`, matching vault-lib.mts; the core's is a
// plain `string`), so this file — which sits between the two — casts pools/current/
// profile once at the top to the core's own shape before ever calling core.optimizeSuit/scoreSet,
// rather than fighting that structural mismatch at every call site.
//
// map: builder
// owns: `solveExact`
import type { OptItem } from "./vault-lib.mts";
import type { ExactSolveResult as SharedExactSolveResult, SolveProgress } from "./api/optimize.mts";
import { buildSuitMip, startVector, pickedOf, DEFAULT_SLOTS, DEFAULT_OPTIONAL_SLOTS, type BuiltMip } from "./mip.mts";
import { DEFAULT_BUDGET_MS, DEFAULT_RESTARTS, TIE_SLACK } from "./solver/scoring.mts";
import { startBudget } from "./solver/budget.mts";
import { serialsOf, startRun, type CoreModule, type OptAssignment, type OptOptionsFull, type OptPools, type OptProfile } from "./solver/exact/run.mts";
import { bestValueObjective, strictOrderObjective } from "./solver/exact/objective.mts";
import { alternativesPhase, handBack, tieBreakPhase } from "./solver/exact/phases.mts";
import {
  loadHighs as defaultLoadHighs, openModel, solveModel as defaultSolveModel, closeModel,
  type HighsInstance, type Handle, type SolveModelOptions, type SolveResult,
} from "./mip-solve.mts";

// The core's types (derived from its functions) and the core subset this file calls live with the build's state.
export type { CoreModule, OptAssignment, OptPools, OptProfile, OptResult } from "./solver/exact/run.mts";
type CoreProgress = Parameters<NonNullable<OptOptionsFull["onProgress"]>>[0];

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
// Scores near HARD_FLOOR_BONUS (1e7 per hard floor) carry float noise of a few 1e-9 from summing in
// a different order, so "one score beats another" needs a margin above that noise (and far below
// HiGHS's own mip_abs_gap of 1e-3) — else an exact tie reads as the heuristic leading. Every comparison
// takes it through slackAt (app/solver/scoring.mts), which grows it with the scores (issue #316: near 1e10 the noise
// passes 1e-6).
const SCORE_EPS = 1e-6;

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
  // Every HiGHS call (first solve, hardAsSoft retry, each alternative) shares what is left of the one budget
  // (app/solver/budget.mts); with a tie-break the first solve takes TIE_STAGE_SHARE of it.
  const tb = opts.tieBreak ? { rarity: opts.tieBreak.rarity, fewest: !!opts.tieBreak.fewestChanges, tolerance: Math.max(0, opts.tieBreak.tolerance || 0) } : null;
  const alt = opts.alternatives && opts.alternatives.count > 0 ? opts.alternatives : null;
  const run = startRun({ core, highs, solveModel, budget, now, onProgress, pools, current, profile, opts, slots, mipCurrent, heur, candidates, tb, alt, active: built, handle: openModel(highs, built) });
  try {
    // equal scores: the solvers' score precision with a tie-break (app/mip.mts TIE_SLACK, as the core and the stage-2 row), else SCORE_EPS
    const eps = tb ? TIE_SLACK : SCORE_EPS;
    const objective = stages ? strictOrderObjective(run, stages) : bestValueObjective(run);
    const firstSolve = (): SolveResult => objective.firstSolve(startVector(run.active, heur.best as unknown as Partial<Record<string, OptItem>>));
    let solve = firstSolve();
    let floorsConflict = false;

    if (solve.status === "infeasible") {
      // The hard floors conflict jointly (each is individually reachable — buildSuitMip already
      // marks a floor no suit can ever reach as "unreachable" and never gives it a hard row — but
      // no single suit satisfies all of them at once). Retry with every hard floor modelled as
      // soft so the fallback below still reports the best honestly-reachable suit.
      floorsConflict = true;
      closeModel(run.handle);
      run.active = buildSuitMip({ pools: mipPools, current: mipCurrent, profile, optionalSlots, slots, hardAsSoft: true, parts: !!stages });
      run.handle = openModel(highs, run.active);
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
        floorsConflict: true, bound: null, gapPoints: null, mipMs, heuristicMs, unreachableFloors: run.active.unreachableFloors,
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
      const bound = objective.boundOf(solve);
      return {
        ...final, method: "exact", proven: false, solver: "highs", bound, gapPoints: bound != null ? bound - final.score : null,
        nodes: solve.nodes, restarts, evaluations: heur.evaluations + final.evaluations, alternatives: undefined, altTolerance: undefined,
        mipMs, heuristicMs, floorsConflict: false, unreachableFloors: run.active.unreachableFloors, pruned: undefined,
      };
    }

    const picked = pickedOf(run.active, solve.colValue);
    const mipScore = solve.objective! + run.active.scoreOffset;

    // ---- step 3b: the tie-break's second stage, step 4: the other suits, step 5: the hand-back (app/solver/exact/phases.mts)
    const { picked2, stage2Optimal } = tieBreakPhase(run, objective, picked, mipScore);
    const { alternatives, altShortfall, altTolerance } = alternativesPhase(run, objective, picked, picked2, mipScore);
    return handBack(run, objective, { solve, picked, picked2, mipScore, stage2Optimal, alternatives, altShortfall, altTolerance, eps, heurTop, heuristicMs, restarts, floorsConflict, onWarn });
  } finally {
    closeModel(run.handle);
  }
}
