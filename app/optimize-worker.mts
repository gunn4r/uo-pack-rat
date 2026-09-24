// optimize-worker.mts — runs one optimize call off the server's main thread: the core's own
// heuristic search (opts.exact falsy) or the HiGHS-backed exact orchestrator (opts.exact true,
// app/exact-solver.mts). One worker per job — HiGHS explores the tree itself, so there is no
// multi-thread branch-and-bound split left to run here. The worker posts throttled progress, a
// "warn" message for anything the server should log but not fail the job over, then its result.
// Cancelling = the server terminates the worker, so nothing here needs to be cooperative.
//
// This file's two boundaries — the workerData the server hands the Worker constructor, and every
// message posted back through parentPort — are exactly where an unknown value crosses a thread.
// OptimizeWorkerData and the Worker*Message types below name both shapes explicitly (exported so
// the server, Task 8, can build/read against the same types this file narrows into and emits from)
// rather than trusting `workerData`'s ambient `any`.
import { parentPort, workerData } from "node:worker_threads";
import { solveExact, type OptPools, type OptAssignment, type OptProfile, type ExactSolveResult, type SolveProgress } from "./exact-solver.mts";
import type * as Core from "../scripts/optimizer-core.mts";

type OptOptionsFull = NonNullable<Parameters<typeof Core.optimizeSuit>[3]>;
type OptResult = ReturnType<typeof Core.optimizeSuit>;

// What app/vault-server.mts's `new Worker(new URL("./optimize-worker.mts", import.meta.url),
// { workerData: {...} })` call constructs (see CONTRIBUTING.md's optimize-worker.mts row).
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
export interface WorkerDoneMessage {
  type: "done";
  result: OptResult | ExactSolveResult;
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
  const onProgress = (p: SolveProgress) => port.postMessage({ type: "progress", progress: { ...p, at: p.at ?? Date.now() } } satisfies WorkerProgressMessage);
  const result: OptResult | ExactSolveResult = opts.exact
    ? await solveExact({ core, pools, current, profile, opts, onProgress, onWarn: (m) => port.postMessage({ type: "warn", message: m } satisfies WorkerWarnMessage) })
    : core.optimizeSuit(pools, current, profile, { ...opts, heuristicBudgetMs: opts.timeBudgetMs ?? 15000, onProgress });   // the same default budget as solveExact and the server's job timer   // the same default budget as solveExact and the server's job timer
  port.postMessage({ type: "done", result, ms: Date.now() - t0 } satisfies WorkerDoneMessage);
} catch (e) {
  const errObj = e as Error;
  port.postMessage({ type: "error", error: String((e && errObj.stack) || e) } satisfies WorkerErrorMessage);
}
