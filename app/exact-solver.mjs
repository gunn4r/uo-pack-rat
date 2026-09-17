// exact-solver.mjs — the orchestration between the core's heuristic search and the HiGHS exact
// solver (app/mip.mjs + app/mip-solve.mjs). One call, one job, no worker pool: HiGHS itself
// explores the tree, so there is nothing left to split across threads (that's what retired the
// multi-worker branch-and-bound path this app used to run in app/vault-server.mjs, backed by the
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
import { buildSuitMip, startVector, pickedOf, DEFAULT_SLOTS, DEFAULT_OPTIONAL_SLOTS } from "./mip.mjs";
import { loadHighs as defaultLoadHighs, openModel, solveModel as defaultSolveModel, addNoGood, closeModel } from "./mip-solve.mjs";

const countCandidates = (built) => Object.values(built.xIndex).reduce((n, list) => n + list.length, 0);
const assignmentOf = (picked) => Object.fromEntries(DEFAULT_SLOTS.map((s) => [s, picked[s] || null]));
const serialsOf = (suit) => Object.fromEntries(Object.entries(suit || {}).map(([slot, it]) => [slot, it ? it.serial : null]));

export async function solveExact({ core, pools, current, profile, opts, onProgress, onWarn = () => {}, loadHighs = defaultLoadHighs, solveModel = defaultSolveModel, now = Date.now }) {
  const t0 = now();
  const budget = opts.timeBudgetMs ?? 15000;
  const restarts = opts.restarts ?? 200;
  const optionalSlots = opts.optionalSlots ?? DEFAULT_OPTIONAL_SLOTS;

  // ---- step 1: the heuristic incumbent, always available -----------------------------------
  const heur = core.optimizeSuit(pools, current, profile, { ...opts, exact: false, restarts, onProgress: (p) => onProgress({ ...p, at: now() }) });
  const heuristicMs = now() - t0;

  // ---- step 2: build the MIP ----------------------------------------------------------------
  const built = buildSuitMip({ pools, current, profile, optionalSlots });
  if (built.cols.every((c) => c.kind !== "x")) {
    // Nothing to decide (every slot fixed or empty): the heuristic's suit is trivially optimal.
    return { ...heur, method: "exact", proven: true, solver: "none", bound: heur.score, gapPoints: 0, mipMs: 0, heuristicMs, unreachableFloors: built.unreachableFloors };
  }
  const candidates = countCandidates(built);

  let highs;
  try {
    highs = await loadHighs();
  } catch (e) {
    onWarn(`HiGHS unavailable: ${e.message}`);
    return {
      ...heur, method: "heuristic", solver: "fallback", fallbackReason: String(e.message).slice(0, 200),
      bound: null, gapPoints: null, mipMs: 0, heuristicMs, unreachableFloors: built.unreachableFloors,
    };
  }

  // ---- step 3: solve ------------------------------------------------------------------------
  let active = built;
  let handle = openModel(highs, active);
  try {
    const remaining = () => Math.max(1, (budget - (now() - t0)) / 1000);
    let lastEmit = 0;
    const toScore = (v) => (v == null ? null : v + active.scoreOffset);
    const onEvent = (ev) => {
      const at = now();
      if (lastEmit !== 0 && at - lastEmit < 250) return;
      lastEmit = at;
      const bestScore = toScore(ev.primal);
      const bound = toScore(ev.dual);
      onProgress({
        phase: "exact", elapsedMs: at - t0, budgetMs: budget, bestScore, bound,
        gapPoints: bestScore != null && bound != null ? Math.max(0, bound - bestScore) : null,
        nodes: ev.nodes, candidates, solver: "highs", currentScore: heur.currentScore, at,
      });
    };

    let solve = solveModel(handle, { timeLimitS: remaining(), start: startVector(active, heur.best), onEvent });
    let floorsConflict = false;

    if (solve.status === "infeasible") {
      // The hard floors conflict jointly (each is individually reachable — buildSuitMip already
      // marks a floor no suit can ever reach as "unreachable" and never gives it a hard row — but
      // no single suit satisfies all of them at once). Retry with every hard floor modelled as
      // soft so the fallback below still reports the best honestly-reachable suit.
      floorsConflict = true;
      closeModel(handle);
      active = buildSuitMip({ pools, current, profile, optionalSlots, hardAsSoft: true });
      handle = openModel(highs, active);
      solve = solveModel(handle, { timeLimitS: remaining(), start: startVector(active, heur.best), onEvent });
    }

    // A genuine floors conflict only ever gets HERE by way of the infeasible branch above: the
    // hardAsSoft retry it triggered is either still infeasible outright, or (relaxed as it is,
    // almost always feasible) simply never found an incumbent in what time was left — either way,
    // the ONE thing we know for certain is that the original hard floors cannot be met jointly, so
    // reporting that honestly is correct regardless of which of the two happened.
    if (floorsConflict && (solve.status === "infeasible" || solve.colValue == null)) {
      const mipMs = now() - t0 - heuristicMs;
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
      const final = core.optimizeSuit(pools, current, profile, { ...opts, exact: false, restarts: 0, warmStart: serialsOf(heur.best) });
      const mipMs = now() - t0 - heuristicMs;
      const bound = toScore(solve.dual);
      return {
        ...final, method: "exact", proven: false, solver: "highs", bound, gapPoints: bound != null ? bound - final.score : null,
        nodes: solve.nodes, restarts, evaluations: heur.evaluations + final.evaluations, alternatives: undefined, altTolerance: undefined,
        mipMs, heuristicMs, floorsConflict: false, unreachableFloors: active.unreachableFloors, pruned: undefined, workers: undefined,
      };
    }

    const picked = pickedOf(active, solve.colValue);
    const mipScore = solve.objective + active.scoreOffset;

    // ---- step 4: k-best alternatives (optional) --------------------------------------------
    const alt = opts.alternatives?.count > 0 ? opts.alternatives : null;
    const altTolerance = alt ? Math.max(0, alt.tolerance || 0) : undefined;
    const alternatives = [];
    let lastPicked = picked;
    if (alt) {
      for (let k = 0; k < alt.count; k++) {
        addNoGood(handle, active, lastPicked);
        onProgress({ phase: "alternatives", found: alternatives.length, wanted: alt.count, elapsedMs: now() - t0, budgetMs: budget, bestScore: mipScore, at: now() });
        const sk = solveModel(handle, { timeLimitS: remaining() });
        if (sk.status !== "optimal") break;
        const score = sk.objective + active.scoreOffset;
        if (score < mipScore - altTolerance - 1e-9) break;
        const skPicked = pickedOf(active, sk.colValue);
        const assignment = assignmentOf(skPicked);
        alternatives.push({ best: assignment, score: core.scoreSet(assignment, profile) });
        lastPicked = skPicked;
      }
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
    const heuristicLeads = heur.score > mipScore + 1e-9;
    let final = core.optimizeSuit(pools, current, profile, { ...opts, exact: false, restarts: 0, warmStart: serialsOf(heuristicLeads ? heur.best : picked) });
    let coreImproved = false;
    if (!heuristicLeads) {
      if (final.score > mipScore + 1e-6) {
        onWarn(`core improved on HiGHS by ${final.score - mipScore}`);
        coreImproved = true;
      }
      if (Math.abs(final.score - mipScore) > 1e-3 && final.score < mipScore) throw new Error("re-score mismatch");
    }
    let belowHeuristic = heuristicLeads;
    if (!heuristicLeads && final.score < heur.score - 1e-9) {
      final = core.optimizeSuit(pools, current, profile, { ...opts, exact: false, restarts: 0, warmStart: serialsOf(heur.best) });
      belowHeuristic = true;
    }
    if (belowHeuristic) onWarn(`exact search's suit scored below the heuristic's ${heur.score} — reporting the heuristic's suit instead of a regression`);

    const mipMs = now() - t0 - heuristicMs;
    const boundRaw = solve.status === "optimal" ? solve.objective : solve.dual;
    return {
      ...final,
      method: "exact",
      proven: solve.status === "optimal" && !coreImproved && !belowHeuristic,
      solver: "highs",
      bound: toScore(boundRaw),
      gapPoints: solve.gapAbs,
      nodes: solve.nodes,
      restarts,
      evaluations: heur.evaluations + final.evaluations,
      alternatives: alt ? alternatives : undefined,
      altTolerance,
      mipMs, heuristicMs,
      floorsConflict,
      unreachableFloors: active.unreachableFloors,
      pruned: undefined,
      workers: undefined,
    };
  } finally {
    closeModel(handle);
  }
}
