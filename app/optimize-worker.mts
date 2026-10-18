// optimize-worker.mts — runs one optimize call off the server's main thread: the core's own
// heuristic search (opts.exact falsy) or the HiGHS-backed exact orchestrator (opts.exact true,
// app/exact-solver.mts), falling back to the core when HiGHS does not load; it resolves the swing step table before either solver runs and finishes the result (app/solver/finish.mts: the swing, the summaries, diagnostics and shares), and cancel terminates the job's worker. One worker per job — HiGHS explores the tree itself, so there is no
// multi-thread branch-and-bound split left to run here. The worker posts throttled progress, a
// "warn" message for anything the server should log but not fail the job over, then its result.
// Cancelling = the server terminates the worker, so nothing here needs to be cooperative.
//
// This file's two boundaries — the workerData the server hands the Worker constructor, and every
// message posted back through parentPort — are exactly where an unknown value crosses a thread.
// OptimizeWorkerData and the Worker*Message types below name both shapes explicitly (exported so
// the server (app/services/jobs.mts) can build and read against the same types this file narrows into and emits from)
// rather than trusting `workerData`'s ambient `any`.
//
// map: builder
// owns: the worker message types
import { parentPort, workerData } from "node:worker_threads";
import { solveExact, type OptPools, type OptAssignment, type OptProfile, type ExactSolveResult, type SolveProgress } from "./exact-solver.mts";
import { poolStepsFor } from "./mip.mts";
import { DEFAULT_BUDGET_MS } from "./solver/scoring.mts";
import { finishResult, type WorkerResult } from "./solver/finish.mts";
import type { EffectiveProfile, OptItem } from "./vault-lib.mts";
import type * as Core from "../scripts/optimizer-core.mts";

type OptOptionsFull = NonNullable<Parameters<typeof Core.optimizeSuit>[3]>;
type OptResult = ReturnType<typeof Core.optimizeSuit>;

// What app/services/jobs.mts's `new Worker(...)` call for this file constructs, as `workerData` (see docs/module-map.md's
// optimize-worker.mts row).
export interface OptimizeWorkerData {
  coreUrl: string;
  pools: OptPools;
  current: OptAssignment;
  profile: OptProfile;
  opts: OptOptionsFull;
}

export interface WorkerProgressMessage {
  type: "progress";
  progress: SolveProgress;
}
export interface WorkerWarnMessage {
  type: "warn";
  message: string;
}
// Either path's result as finished (app/solver/finish.mts).
export type { WorkerResult };
export interface WorkerDoneMessage {
  type: "done";
  result: WorkerResult;
  ms: number;
}
export interface WorkerErrorMessage {
  type: "error";
  error: string;
}
export type WorkerMessage = WorkerProgressMessage | WorkerWarnMessage | WorkerDoneMessage | WorkerErrorMessage;

// workerData is only ever constructed by this one call site (see the header comment) — the cast is
// the trust boundary, same as every other JSON-shaped value this app reads without its own runtime
// schema (config.mts's env vars, mip-solve.mts's `highs` loader).
const { coreUrl, pools, current, profile, opts } = workerData as OptimizeWorkerData;
// This module only ever runs as a worker_threads entry point (loaded by the `new Worker(...)` call
// above), so parentPort is always set; `!` names that invariant rather than leaving it implicit.
const port = parentPort!;
const core = (await import(coreUrl)) as typeof Core;
try {
  const t0 = Date.now();
  const onWarn = (m: string): void => { port.postMessage({ type: "warn", message: m } satisfies WorkerWarnMessage); };
  const onProgress = (p: SolveProgress) => port.postMessage({ type: "progress", progress: { ...p, at: p.at ?? Date.now() } } satisfies WorkerProgressMessage);
  // The core's item and profile shapes are the same runtime objects as vault-lib's (see exact-solver.mts's header).
  const items = pools as unknown as Partial<Record<string, OptItem[]>>, worn = current as unknown as Partial<Record<string, OptItem | null>>, prof = profile as unknown as EffectiveProfile;
  // SSI by swing step: the step table both solvers score with, resolved once here, where the pool is known (app/swing.mts).
  const { ssiSteps, note } = poolStepsFor(prof, items, worn, opts.optionalSlots, opts.slots);
  const solveProfile: OptProfile = ssiSteps ? { ...profile, ssiSteps } : profile;
  const result: OptResult | ExactSolveResult = opts.exact
    ? await solveExact({ core, pools, current, profile: solveProfile, opts, onProgress, onWarn })
    : core.optimizeSuit(pools, current, solveProfile, { ...opts, heuristicBudgetMs: opts.timeBudgetMs ?? DEFAULT_BUDGET_MS, onProgress });   // the same default budget as solveExact and the server's job timer
  const done = finishResult({ core, result, pools, current, profile: solveProfile, opts, swingNote: note, onWarn });
  port.postMessage({ type: "done", result: done, ms: Date.now() - t0 } satisfies WorkerDoneMessage);
} catch (e) {
  const errObj = e as Error;
  port.postMessage({ type: "error", error: String((e && errObj.stack) || e) } satisfies WorkerErrorMessage);
}
