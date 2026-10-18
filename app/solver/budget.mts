// budget.mts — the exact solver's time budget (issue #338, W3e): how long a build has run, what is left in seconds for HiGHS, and the shares the heuristic and a tie-break's first stage get.
//
// One object per build, made when it starts, read by each phase of app/exact-solver.mts. `now` is injected so a test can
// drive the clock. The optimizer core keeps its own budget arithmetic (it imports only app/solver/scoring.mts at run
// time), with the tie-break share from the same constant.
//
// map: builder
// owns: `Budget`, `startBudget`
import { TIE_STAGE_SHARE } from "./scoring.mts";

export interface Budget {
  readonly ms: number;                 // the whole build's budget
  readonly startedAt: number;          // now() when the build started, for a phase that read the clock itself
  readonly heuristicCapMs: number;     // the most the heuristic's restarts may take: half, so HiGHS always keeps the other half
  elapsedMs(): number;                 // since the build started
  over(): boolean;                     // the budget is spent
  leftS(): number;                     // what is left for a HiGHS call, in seconds, never below 0 (a limit of 0 still returns the MIP start)
  firstStageS(tieBreak: boolean): number;   // a first solve's limit: with a tie-break, TIE_STAGE_SHARE of what is left, so the second stage keeps a share
}

export function startBudget(ms: number, now: () => number): Budget {
  const t0 = now();
  const leftS = (): number => Math.max(0, (ms - (now() - t0)) / 1000);
  return {
    ms,
    startedAt: t0,
    heuristicCapMs: ms / 2,
    elapsedMs: () => now() - t0,
    over: () => now() - t0 >= ms,
    leftS,
    firstStageS: (tieBreak) => (tieBreak ? TIE_STAGE_SHARE * leftS() : leftS()),
  };
}
