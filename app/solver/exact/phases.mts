// phases.mts — the steps of an exact build after its first solve (issue #338, W3e): the tie-break's second stage, the other suits, and the hand-back of the winning suit to the core with the guards that keep the result honest.
//
// app/exact-solver.mts runs them in order on its ExactRun (app/solver/exact/run.mts), asking the build's objective
// (app/solver/exact/objective.mts) wherever Best value and Strict order differ. Each phase takes what the ones before it
// found and returns what the next needs; the code is the steps as they were inside solveExact.
//
// map: builder
// owns: `tieBreakPhase`, `alternativesPhase`, `handBack`, `HandBackInput`
import type { AltShortfall, ExactSolveResult as SharedExactSolveResult } from "../../api/optimize.mts";
import type { OptItem } from "../../vault-lib.mts";
import { changeCostFor, pickedOf, startVector, tieCosts } from "../../mip.mts";
import { addNoGood, closeModel, openModel, type SolveResult } from "../../mip-solve.mts";
import { FLOAT_EPS, TIE_SLACK } from "../scoring.mts";
import type { ExactObjective } from "./objective.mts";
import { assignmentOf, serialsKey, serialsOf, tieCostOf, topOf, type ExactRun, type OptAssignment, type OptResult } from "./run.mts";

type Picked = Partial<Record<string, OptItem>>;

// The tie-break's second stage (opts.tieBreak), from the first solve's suit `picked`.
export function tieBreakPhase(run: ExactRun, objective: ExactObjective, picked: Picked, mipScore: number): { picked2: Picked; stage2Optimal: boolean } {
  const { highs, solveModel, budget, now, onProgress, mipCurrent, tb, alt } = run;
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
  return { picked2, stage2Optimal };
}

// The other suits (opts.alternatives): k more no-good cuts after the returned suit `picked2`.
export function alternativesPhase(run: ExactRun, objective: ExactObjective, picked: Picked, picked2: Picked, mipScore: number): { alternatives: { best: OptAssignment; score: number }[]; altShortfall: AltShortfall | undefined; altTolerance: number | undefined } {
  const { core, highs, solveModel, budget, now, onProgress, profile, slots, alt } = run;
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
  return { alternatives, altShortfall, altTolerance };
}

// What the hand-back reads from the solve and the phases before it.
export interface HandBackInput {
  solve: SolveResult;
  picked: Picked;
  picked2: Picked;
  mipScore: number;
  stage2Optimal: boolean;
  alternatives: { best: OptAssignment; score: number }[];
  altShortfall: AltShortfall | undefined;
  altTolerance: number | undefined;
  floorsConflict: boolean;
}

// Hand the winning suit back to the core for the full report, with the three guards that revoke `proven` and warn.
export function handBack(run: ExactRun, objective: ExactObjective, input: HandBackInput): SharedExactSolveResult<OptAssignment> {
  const { core, budget, pools, current, profile, opts, slots, heur, tb, alt, eps, heurTop, heuristicMs, restarts, onWarn } = run;
  const { solve, picked, picked2, mipScore, stage2Optimal, alternatives, altTolerance, floorsConflict } = input;
  let { altShortfall } = input;
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
}
