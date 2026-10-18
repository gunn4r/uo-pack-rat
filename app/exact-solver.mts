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
// ExactRun (app/solver/exact/run.mts), and where Best value and Strict order differ the build asks its objective
// (app/solver/exact/objective.mts).
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
import type { AltShortfall, ExactSolveResult as SharedExactSolveResult, SolveProgress } from "./api/optimize.mts";
import { buildSuitMip, startVector, pickedOf, tieCosts, changeCostFor, DEFAULT_SLOTS, DEFAULT_OPTIONAL_SLOTS, type BuiltMip } from "./mip.mts";
import { DEFAULT_BUDGET_MS, DEFAULT_RESTARTS, FLOAT_EPS, TIE_SLACK } from "./solver/scoring.mts";
import { startBudget } from "./solver/budget.mts";
import { startRun, topOf, type CoreModule, type OptAssignment, type OptOptionsFull, type OptPools, type OptProfile, type OptResult } from "./solver/exact/run.mts";
import { bestValueObjective, strictOrderObjective } from "./solver/exact/objective.mts";
import {
  loadHighs as defaultLoadHighs, openModel, solveModel as defaultSolveModel, addNoGood, closeModel,
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
const tieCostOf = (picked: Partial<Record<string, OptItem>>): number => Object.values(picked).reduce((n, it) => n + (it?.tieCost || 0), 0);
// How many slots of `picked` hold another piece than `current` (fewest changes).
const serialsKey = (a: OptAssignment): string => JSON.stringify(serialsOf(a));
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
  const heur = core.optimizeSuit(pools, current, profile, { ...opts, exact: false, restarts, heuristicBudgetMs: budget.heuristicCapMs, onProgress: (p: CoreProgress) => onProgress({ ...p, at: now() }) });
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

    // ---- step 3b: the tie-break's second stage (optional) -----------------------------------
    // Among suits within the tolerance of stage 1's that meet every floor it meets, the lowest summed tie cost
    // (app/mip.mts tieBreakModel), started from stage 1's suit, so a timeout still returns a suit no worse than it.
    // With strict order, among the suits that hold every stage and meet the same floors. With fewest changes, the tie cost
    // counts the change cost for each slot changed from the worn suit (app/mip.mts tieCosts).
    let picked2 = picked, stage2Optimal = true;
    if (tb) {
      // stage 1's suit with every column worked out from its own totals: an unproven incumbent may leave a met floor's indicator at 0
      const start = startVector(run.active, picked), costs = tieCosts(run.active, tb.fewest ? mipCurrent : null);
      const h2 = openModel(highs, objective.tieModel(start, costs, tb.tolerance));
      try {
        onProgress({ phase: "tie-break", elapsedMs: budget.elapsedMs(), budgetMs: budget.ms, bestScore: mipScore, at: now() });
        // with other suits asked for, half of what is left stays theirs
        const s2 = solveModel(h2, { timeLimitS: (alt ? 0.5 : 1) * budget.leftS(), start });
        if (s2.colValue) picked2 = pickedOf(run.active, s2.colValue);
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
      const altBuilt = objective.altModel(picked), kh = altBuilt ? openModel(highs, altBuilt) : run.handle;
      try {
        for (let k = 0; k < alt.count && !budget.over(); k++) {
          addNoGood(kh, run.active, lastPicked);
          onProgress({ phase: "alternatives", found: alternatives.length, wanted: alt.count, elapsedMs: budget.elapsedMs(), budgetMs: budget.ms, bestScore: mipScore, at: now() });
          const sk = solveModel(kh, { timeLimitS: budget.leftS() });
          if (sk.status !== "optimal") { altShortfall = sk.status === "infeasible" ? "exhausted" : "budget"; break; }
          const score = sk.objective! + run.active.scoreOffset;
          if (objective.altOutside(score, mipScore, altTolerance!)) { altShortfall = "tolerance"; break; }
          const skPicked = pickedOf(run.active, sk.colValue!);
          const assignment = assignmentOf(skPicked, slots);
          alternatives.push({ best: assignment, score: core.scoreSet(assignment, profile) });
          lastPicked = skPicked;
        }
      } finally {
        if (kh !== run.handle) closeModel(kh);
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
    const topIn = objective.topIn, mipTop = objective.mipTop(mipScore), cmpTop = objective.cmp;
    const heuristicLeads = cmpTop(topIn(heur), mipTop, eps) > 0;
    // the top-score suit (stage 1's, or the heuristic's when it leads) rides along as one more start, so the core's best
    // score is that suit's, and the floors it meets are the ones both stages held
    const topSuit = heuristicLeads ? heur.tieBreak?.top : serialsOf(picked);
    const topStart = tb && topSuit ? { tieBreak: { ...opts.tieBreak!, topStart: topSuit } } : {};
    let final = core.optimizeSuit(pools, current, profile, { ...opts, exact: false, restarts: 0, warmStart: serialsOf(heuristicLeads ? heur.best : picked2), ...topStart });
    let coreImproved = false, rescoreMismatch = false;
    // a tie cost with fewest changes: the change cost for each slot changed, then the rarity tie cost
    const changeCost = changeCostFor(run.active);
    const tieOrder = (r: OptResult): number => r.tieBreak!.cost + changeCost * (r.tieBreak!.changes ?? 0);
    const cost2 = tieCostOf(picked2) + (tb?.fewest ? changeCost * core.optChanges(assignmentOf(picked2, slots), current, slots) : 0);
    if (!heuristicLeads) {
      if (cmpTop(topIn(final), mipTop, eps) > 0) {
        onWarn(`${objective.improvedText(final, mipScore)} (${stats})`);
        coreImproved = true;
      } else if (tb && stage2Optimal && final.tieBreak && tieOrder(final) < cost2 - FLOAT_EPS) {
        onWarn(`core found a lower tie cost than HiGHS's proven ${cost2}: ${tieOrder(final)} (${stats})`);
        coreImproved = true;
      }
      if (cmpTop(topIn(final), mipTop, TIE_SLACK) < 0) {
        onWarn(`${objective.mismatchText(final)} (${stats})`);
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
    if (belowHeuristic) onWarn(`${objective.belowText(heur)} (${stats})`);
    // Other suits never list the returned suit: the core can hand back another suit than HiGHS's, even one the loop listed.
    // HiGHS's own suit is then one of them (in Best value when within the tolerance). In strict order keep only those equal
    // to the returned suit on every stage (a heuristic's suit can win on a later stage).
    const highsSuit = { best: assignmentOf(picked2, slots), score: core.scoreSet(assignmentOf(picked2, slots), profile) };
    const shownAlts = [...(objective.listsHighsSuit(highsSuit.score, final.score, altTolerance ?? 0) ? [highsSuit] : []), ...alternatives]
      .filter((a, i, all) => serialsKey(a.best) !== serialsKey(final.best) && all.findIndex((x) => serialsKey(x.best) === serialsKey(a.best)) === i
        && objective.altKeeps(a.best, final))
      .sort(objective.altOrder)
      .slice(0, alt?.count ?? 0);
    if (alt) altShortfall = objective.shortfall(alt.count, shownAlts.length, altShortfall);

    const mipMs = budget.elapsedMs() - heuristicMs;
    const disagree = solve.status === "optimal" && (coreImproved || belowHeuristic || rescoreMismatch);
    const pf = objective.proof(final, solve, disagree);
    const proven = solve.status === "optimal" && !coreImproved && !belowHeuristic && !rescoreMismatch;
    return {
      ...final,
      method: "exact",
      proven,
      solver: "highs",
      bound: pf.bound,
      gapPoints: pf.gapPoints,
      ...(pf.strictProven != null ? { strictProven: pf.strictProven } : {}),
      nodes: solve.nodes,
      restarts,
      evaluations: heur.evaluations + final.evaluations,
      alternatives: alt ? shownAlts : undefined,
      altTolerance,
      altShortfall,
      mipMs, heuristicMs,
      floorsConflict,
      unreachableFloors: run.active.unreachableFloors,
      pruned: undefined,
      ...(tb && final.tieBreak ? { tieBreak: { topScore: Math.max(mipScore, topOf(final)), cost: final.tieBreak.cost, ...(final.tieBreak.changes != null ? { changes: final.tieBreak.changes, fewestChanges: true } : {}), ...(tb.rarity ? { rarity: tb.rarity } : {}), tolerance: tb.tolerance, costProven: proven && stage2Optimal } } : {}),
    };
  } finally {
    closeModel(run.handle);
  }
}
