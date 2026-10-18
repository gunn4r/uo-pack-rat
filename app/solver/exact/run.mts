// run.mts — what one exact build carries through its phases (issue #338, W3e): the core and HiGHS, the budget, the request, the heuristic's result, and the model the solves run on.
//
// app/exact-solver.mts makes one per build (`startRun`) once HiGHS has loaded and the model is built, and hands it to the
// objective (app/solver/exact/objective.mts) and the phases. `active` and `handle` change once, when the hard floors
// conflict and the build retries with them soft. The core's types are derived from its functions, as in exact-solver.mts.
//
// map: builder
// owns: `ExactRun`, `CoreModule`, `OptPools`, `OptAssignment`, `OptProfile`, `OptResult`, `OptOptionsFull`, `TieBreakAsked`, `startRun`, `topOf`, `dot`, `assignmentOf`, `tieCostOf`, `serialsOf`, `serialsKey`
import type * as Core from "../../../scripts/optimizer-core.mts";
import type { OptItem } from "../../vault-lib.mts";
import type { SolveProgress, StrictStageProgress } from "../../api/optimize.mts";
import type { BuiltMip } from "../../mip.mts";
import type { Handle, HighsInstance, SolveModelOptions, SolveResult } from "../../mip-solve.mts";
import type { Budget } from "../budget.mts";
import { PROGRESS_EVERY_MS } from "../scoring.mts";

export type OptOptionsFull = NonNullable<Parameters<typeof Core.optimizeSuit>[3]>;
export type OptPools = Parameters<typeof Core.optimizeSuit>[0];
export type OptAssignment = Parameters<typeof Core.optimizeSuit>[1];
export type OptProfile = Parameters<typeof Core.optimizeSuit>[2];
export type OptResult = ReturnType<typeof Core.optimizeSuit>;

// The subset of the core module the exact solver calls — injected (rather than imported directly) so
// app/optimize-worker.mts can hand it the dynamically `import()`-ed copy.
export interface CoreModule {
  optimizeSuit: typeof Core.optimizeSuit;
  scoreSet: typeof Core.scoreSet;
  optStrictStages: typeof Core.optStrictStages;
  optLexCmp: typeof Core.optLexCmp;
  optStrictScore: typeof Core.optStrictScore;
  optChanges: typeof Core.optChanges;
}

// A tie-break as the exact solver reads it from opts.tieBreak.
export interface TieBreakAsked { rarity: string | undefined; fewest: boolean; tolerance: number }

export interface ExactRun {
  core: CoreModule;
  highs: HighsInstance;
  solveModel: (handle: Handle, opts: SolveModelOptions) => SolveResult;
  budget: Budget;
  now: () => number;
  onProgress: (p: SolveProgress) => void;
  pools: OptPools;
  current: OptAssignment;
  profile: OptProfile;
  opts: OptOptionsFull;
  slots: string[];
  mipCurrent: Partial<Record<string, OptItem>>;
  heur: OptResult;                                   // the heuristic's result, the incumbent HiGHS starts from
  candidates: number;                                // candidate pieces in the model, for progress
  tb: TieBreakAsked | null;
  alt: { count: number; tolerance: number } | null;  // opts.alternatives, when it asks for any
  active: BuiltMip;                                  // the model the solves run on (the hardAsSoft retry replaces it)
  handle: Handle;                                    // that model, open in HiGHS
  // a HiGHS objective as a score (the model's offset added); ±Infinity, a bound HiGHS has not established yet, is none
  toScore(v: number | null | undefined): number | null;
  // a solve's progress event, throttled to PROGRESS_EVERY_MS; a strict-order stage's events carry the stage and no score
  onEvent(ev: { kind: string; primal: number | undefined; dual: number | undefined; nodes: number }, stage?: StrictStageProgress): void;
}

export function startRun(given: Omit<ExactRun, "toScore" | "onEvent">): ExactRun {
  let lastEmit = 0;
  const run: ExactRun = {
    ...given,
    toScore: (v) => (v == null || !Number.isFinite(v) ? null : v + run.active.scoreOffset),
    onEvent: (ev, stage) => {
      const at = run.now();
      if (lastEmit !== 0 && at - lastEmit < PROGRESS_EVERY_MS) return;
      lastEmit = at;
      const bestScore = run.toScore(ev.primal);
      const bound = run.toScore(ev.dual);
      run.onProgress({
        phase: "exact", elapsedMs: at - run.budget.startedAt, budgetMs: run.budget.ms, bestScore, bound,
        gapPoints: bestScore != null && bound != null ? Math.max(0, bound - bestScore) : null,
        nodes: ev.nodes, candidates: run.candidates, solver: "highs", currentScore: run.heur.currentScore, at, ...(stage ? { stage } : {}),
      });
    },
  };
  return run;
}

// A result's best score: with a tie-break the returned suit may score under it (OptResult.tieBreak.topScore).
export const topOf = (r: OptResult): number => r.tieBreak ? r.tieBreak.topScore : r.score;
export const dot = (a: ArrayLike<number>, b: ArrayLike<number>): number => { let s = 0; for (let j = 0; j < a.length; j++) s += a[j]! * b[j]!; return s; };
// A model's picked pieces as a suit over `slots` (an empty slot null). picked's values are mip.mts's OptItem (vault-lib's),
// one field looser than the core's own item shape — the same runtime objects either way.
export const assignmentOf = (picked: Partial<Record<string, OptItem>>, slots: string[]): OptAssignment =>
  Object.fromEntries(slots.map((s): [string, OptItem | null] => [s, picked[s] || null])) as unknown as OptAssignment;
// The summed tie cost of the picked pieces (a rarity preference's, app/mip.mts tieCosts).
export const tieCostOf = (picked: Partial<Record<string, OptItem>>): number => Object.values(picked).reduce((n, it) => n + (it?.tieCost || 0), 0);
// A suit as slot -> serial (an empty slot null), the shape warm starts and tie-break starts take; and as a key.
export const serialsOf = (suit: Partial<Record<string, { serial: number } | null>> | null | undefined): Record<string, number | null> =>
  Object.fromEntries(Object.entries(suit || {}).map(([slot, it]): [string, number | null] => [slot, it ? it.serial : null]));
export const serialsKey = (a: OptAssignment): string => JSON.stringify(serialsOf(a));
