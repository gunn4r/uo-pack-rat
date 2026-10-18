// objective.mts — what the exact solver maximizes (issue #338, W3e): Best value or Strict order, the same choice as the core's OptObjective (scripts/optimizer-core.mts), asked at each point of a build where the two differ.
//
// app/exact-solver.mts picks one per build from opts.strict and asks it for the first solve (one HiGHS solve, or one per
// stage), the tie-break's and the other suits' models, the guards' comparison of the core's value with HiGHS's, which
// other suits are listed, the warnings' wording and the proof the result carries. A suit's value (`Top`) is a number
// (Best value: its best score) or its stage values (Strict order). Each answer is the code the mode's arm held.
//
// map: builder
// owns: `ExactObjective`, `Top`, `bestValueObjective`, `strictOrderObjective`
import type { AltShortfall } from "../../api/optimize.mts";
import type { OptItem } from "../../vault-lib.mts";
import { heldModel, pickedOf, stageObjective, startVector, tieBreakModel, type BuiltMip } from "../../mip.mts";
import { closeModel, openModel, type SolveResult } from "../../mip-solve.mts";
import { FLOAT_EPS, TIE_SLACK, slackAt } from "../scoring.mts";
import { dot, topOf, type ExactRun, type OptAssignment, type OptResult } from "./run.mts";
import type * as Core from "../../../scripts/optimizer-core.mts";

export type Top = number | number[];
export interface ExactObjective {
  firstSolve(start: Float64Array): SolveResult;
  boundOf(solve: SolveResult): number | null;                   // a solve that found no suit: what bound it reached
  tieModel(start: Float64Array, costs: number[], tolerance: number): BuiltMip;   // the tie-break's second stage
  altModel(picked: Partial<Record<string, OptItem>>): BuiltMip | null;   // the other suits' model; null: the first solve's own
  altOutside(score: number, top: number, tolerance: number): boolean;    // an other suit past the tolerance ends the list
  topIn(r: OptResult): Top;
  mipTop(mipScore: number): Top;
  cmp(a: Top, b: Top, base: number): number;
  improvedText(final: OptResult, mipScore: number): string;
  mismatchText(final: OptResult): string;
  belowText(heur: OptResult): string;
  listsHighsSuit(highsScore: number, finalScore: number, tolerance: number): boolean;
  altKeeps(best: OptAssignment, final: OptResult): boolean;
  altOrder(x: { score: number }, y: { score: number }): number;
  shortfall(asked: number, shown: number, found: AltShortfall | undefined): AltShortfall | undefined;
  proof(final: OptResult, solve: SolveResult, disagree: boolean): { bound: number | null; gapPoints: number | null; strictProven?: number };
}

// Best value: one solve, its bound and gap the proof; a suit's value is its best score, compared within a slack.
export function bestValueObjective(run: ExactRun): ExactObjective {
  return {
    firstSolve: (start) => run.solveModel(run.handle, { timeLimitS: run.budget.firstStageS(!!run.tb), start, onEvent: run.onEvent }),
    boundOf: (solve) => run.toScore(solve.dual),
    tieModel: (start, costs, tolerance) => tieBreakModel(run.active, start, tolerance, costs),
    altModel: () => null,
    altOutside: (score, top, tolerance) => score < top - tolerance - slackAt(FLOAT_EPS, score, top),
    topIn: (r) => topOf(r),
    mipTop: (mipScore) => mipScore,
    cmp: (a, b, base) => {
      const x = a as number, y = b as number, slack = slackAt(base, x, y);
      return x > y + slack ? 1 : x < y - slack ? -1 : 0;
    },
    improvedText: (final, mipScore) => `core improved on HiGHS by ${topOf(final) - mipScore}`,
    mismatchText: (final) => `re-score mismatch: the core scores HiGHS's suit ${topOf(final)}`,
    belowText: (heur) => `exact search's suit scored below the heuristic's ${heur.score} — reporting the heuristic's suit instead of a regression`,
    listsHighsSuit: (highsScore, finalScore, tolerance) => highsScore >= finalScore - tolerance - slackAt(FLOAT_EPS, highsScore, finalScore),
    altKeeps: () => true,
    altOrder: (x, y) => y.score - x.score,
    shortfall: (_asked, _shown, found) => found,
    proof: (_final, solve, disagree) => ({ bound: run.toScore(disagree ? null : solve.status === "optimal" ? solve.objective : solve.dual), gapPoints: disagree ? null : solve.gapAbs }),
  };
}

// Strict order: one solve per stage, the stages' proof; a suit's value is its stage values. The tie-break and the other
// suits hold every stage (app/mip.mts heldModel), and the tolerance plays no part.
//
// The stage solves: most important first, each holding every earlier stage at what it reached (heldModel) and started
// from the stage before's suit. Each stage gets an equal share of what is left with the solves still to come (the
// tie-break's and the other suits' count one each), so a quick stage leaves its time to the rest. A stage that runs out
// of time stops the sequence: its incumbent, never worse than its start, is the suit, and `proven` counts the stages
// proven in order. The result stands in for Best value's one solve: its objective is the plain score of that suit,
// `colValue` the suit, and `held` every stage's objective for the tie-break and the other suits.
export function strictOrderObjective(run: ExactRun, stages: ReturnType<typeof Core.optStrictStages>): ExactObjective {
  let held: number[][] = [], achieved: number[] = [], strictValues: number[] = [], strictProven = 0;
  const solveStrict = (start: Float64Array): SolveResult => {
    const objectives = stages.map((st) => stageObjective(run.active, st, run.mipCurrent)), extra = (run.tb ? 1 : 0) + (run.alt ? 1 : 0);
    const hardRows = Object.keys(run.active.hardRows).length > 0;
    let vec = start, last: SolveResult | null = null, nodes = 0;
    held = []; achieved = []; strictProven = 0;
    for (const [i, o] of objectives.entries()) {
      // a constant stage has nothing to choose, but the first is solved while the model has hard rows: that solve is
      // what checks them (a conflict then reaches the hardAsSoft retry, as in Best value)
      if (o.cost.every((c) => c === 0) && (i > 0 || !hardRows)) { held.push(o.cost); achieved.push(0); if (strictProven === i) strictProven++; continue; }
      const st = stages[i]!, stage = { at: i + 1, of: objectives.length, kind: st.kind, keys: st.keys };
      const solveStage = (limit: number): SolveResult => {
        const h = openModel(run.highs, heldModel(run.active, vec, held, o.cost, "maximize", { values: achieved }));
        try {
          return run.solveModel(h, { timeLimitS: limit, start: vec, onEvent: (ev) => { run.onEvent({ ...ev, primal: undefined, dual: undefined }, stage); } });
        } finally {
          closeModel(h);
        }
      };
      run.onProgress({ phase: "exact", stage, elapsedMs: run.budget.elapsedMs(), budgetMs: run.budget.ms, candidates: run.candidates, solver: "highs", currentScore: run.heur.currentScore, bestScore: null, bound: null, gapPoints: null, at: run.now() });
      const share = run.budget.leftS() / (objectives.length - i + extra);
      last = solveStage(share);
      nodes += last.nodes;
      // Out of time with time left: once more from its incumbent, with all that is left but the tie-break's and the other
      // suits' shares. The stages after it are worth nothing unproven, so its proof is what the time is for.
      if (last.status === "timeLimit" && last.colValue && run.budget.leftS() / (1 + extra) > 1.5 * share) {
        vec = startVector(run.active, pickedOf(run.active, last.colValue));
        last = solveStage(run.budget.leftS() / (1 + extra));
        nodes += last.nodes;
      }
      if (last.colValue == null) break;   // infeasible (only the first stage's hard rows can be) or no incumbent
      vec = startVector(run.active, pickedOf(run.active, last.colValue));
      held.push(o.cost); achieved.push(dot(o.cost, vec));
      if (last.status === "optimal" && strictProven === i) strictProven++;
      if (last.status !== "optimal") break;
    }
    held = objectives.map((o) => o.cost);
    strictValues = objectives.map((o) => dot(o.cost, vec) + o.offset);
    const done = strictProven === objectives.length;
    if (last && last.colValue == null && vec === start) return { ...last, nodes };
    return { status: done ? "optimal" : last!.status === "infeasible" ? "other" : last!.status, statusText: done ? "strict order: every stage proven" : `strict order: ${strictProven} of ${objectives.length} stages proven`,
      objective: dot(run.active.model.colCost, vec), primal: null, dual: null, gapAbs: null, nodes, colValue: vec, ms: last?.ms ?? 0 };
  };
  return {
    firstSolve: (start) => solveStrict(start),
    boundOf: () => null,
    tieModel: (start, costs) => heldModel(run.active, start, held, costs, "minimize", { fixMet: true }),
    altModel: (picked) => heldModel(run.active, startVector(run.active, picked), held, run.active.model.colCost, "maximize"),
    altOutside: () => false,
    topIn: (r) => r.lex!,
    mipTop: () => strictValues,
    cmp: (a, b) => run.core.optLexCmp(a as number[], b as number[]),
    improvedText: (final) => `core improved on HiGHS's stages ${JSON.stringify(strictValues)}: ${JSON.stringify(final.lex!)}`,
    mismatchText: (final) => `re-score mismatch: the core scores HiGHS's suit ${JSON.stringify(final.lex!)} against its stages ${JSON.stringify(strictValues)}`,
    belowText: (heur) => `exact search's stages ${JSON.stringify(strictValues)} came in below the heuristic's ${JSON.stringify(heur.lex)} — reporting the heuristic's suit instead of a regression`,
    listsHighsSuit: () => true,
    altKeeps: (best, final) => run.core.optLexCmp(run.core.optStrictScore(best, run.current, run.profile, run.opts.strict!, run.slots), final.lex!) === 0,
    altOrder: () => 0,
    // a list that came back short (not for time) is short because no more suits match on every goal
    shortfall: (asked, shown, found) => (shown < asked && found !== "budget" ? "unequal" : found),
    // no bound on the plain score: the proof is the stages', as far as the returned suit holds their values (a heuristic's
    // suit that wins on a later stage holds them; one that differs on a proven stage does not)
    proof: (final, _solve, disagree) => {
      let stillProven = 0;
      while (stillProven < strictProven && Math.abs(final.lex![stillProven]! - strictValues[stillProven]!) <= slackAt(TIE_SLACK, final.lex![stillProven]!, strictValues[stillProven]!)) stillProven++;
      return { bound: run.toScore(null), gapPoints: null, strictProven: disagree ? 0 : stillProven };
    },
  };
}
