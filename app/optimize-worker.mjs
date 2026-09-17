// optimize-worker.mjs — runs one optimize call off the server's main thread: the core's own
// heuristic search (opts.exact falsy) or the HiGHS-backed exact orchestrator (opts.exact true,
// app/exact-solver.mjs). One worker per job — HiGHS explores the tree itself, so there is no
// multi-thread branch-and-bound split left to run here. The worker posts throttled progress, a
// "warn" message for anything the server should log but not fail the job over, then its result.
// Cancelling = the server terminates the worker, so nothing here needs to be cooperative.
import { parentPort, workerData } from "node:worker_threads";
import { solveExact } from "./exact-solver.mjs";

const { coreUrl, pools, current, profile, opts } = workerData;
const core = await import(coreUrl);
try {
  const t0 = Date.now();
  const onProgress = (p) => parentPort.postMessage({ type: "progress", progress: { ...p, at: p.at ?? Date.now() } });
  const result = opts.exact
    ? await solveExact({ core, pools, current, profile, opts, onProgress, onWarn: (m) => parentPort.postMessage({ type: "warn", message: m }) })
    : core.optimizeSuit(pools, current, profile, { ...opts, onProgress });
  parentPort.postMessage({ type: "done", result, ms: Date.now() - t0 });
} catch (e) {
  parentPort.postMessage({ type: "error", error: String((e && e.stack) || e) });
}
