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
import { resultDiagnostics, withDiagnostics, type Diagnostic, type DiagnosticsProfile } from "./diagnostics.mts";
import type { OptItem } from "./vault-lib.mts";
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
// Either path's result, with the settings that worked against it (app/diagnostics.mts); no `diagnostics` when computing them failed.
export type WorkerResult = (OptResult | ExactSolveResult) & { diagnostics?: Diagnostic[] };
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
  const onProgress = (p: SolveProgress) => port.postMessage({ type: "progress", progress: { ...p, at: p.at ?? Date.now() } } satisfies WorkerProgressMessage);
  const result: OptResult | ExactSolveResult = opts.exact
    ? await solveExact({ core, pools, current, profile, opts, onProgress, onWarn: (m) => port.postMessage({ type: "warn", message: m } satisfies WorkerWarnMessage) })
    : core.optimizeSuit(pools, current, profile, { ...opts, heuristicBudgetMs: opts.timeBudgetMs ?? 15000, onProgress });   // the same default budget as solveExact and the server's job timer
  // The core's item and profile shapes are the same runtime objects as vault-lib's (see exact-solver.mts's header). A failure here never costs the suit (withDiagnostics): the result goes out without diagnostics and the server logs why.
  const withDiags = withDiagnostics(result, () => resultDiagnostics({ pools: pools as unknown as Partial<Record<string, OptItem[]>>, current: current as unknown as Partial<Record<string, OptItem | null>>,
    optionalSlots: opts.optionalSlots, slots: opts.slots, profile: profile as DiagnosticsProfile, result }),
  (e) => port.postMessage({ type: "warn", message: `diagnostics failed, the result goes out without them: ${String((e as Error)?.stack || e)}` } satisfies WorkerWarnMessage));
  port.postMessage({ type: "done", result: withDiags, ms: Date.now() - t0 } satisfies WorkerDoneMessage);
} catch (e) {
  const errObj = e as Error;
  port.postMessage({ type: "error", error: String((e && errObj.stack) || e) } satisfies WorkerErrorMessage);
}
