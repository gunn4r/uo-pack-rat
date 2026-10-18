// optimize-worker.mts — runs one optimize call off the server's main thread: the core's own
// heuristic search (opts.exact falsy) or the HiGHS-backed exact orchestrator (opts.exact true,
// app/exact-solver.mts), falling back to the core when HiGHS does not load; it resolves the swing step table before either solver runs and attaches the diagnostics and the suit's swing to the result, and cancel terminates the job's worker. One worker per job — HiGHS explores the tree itself, so there is no
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
import { solveExact, type OptPools, type OptAssignment, type OptProfile, type ExactSolveResult, type SolveProgress, type StrictResult } from "./exact-solver.mts";
import { resultDiagnostics, scoreShares, withDiagnostics, type Diagnostic, type DiagnosticsProfile, type ScoreShare } from "./diagnostics.mts";
import { DEFAULT_SLOTS, poolStepsFor } from "./mip.mts";
import { DEFAULT_BUDGET_MS } from "./solver/scoring.mts";
import { heldWeapon, ssiShareOf, swingOf, type SwingResult } from "./swing.mts";
import { totalsOf, type EffectiveProfile, type OptItem } from "./vault-lib.mts";
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
// Either path's result, with the settings that worked against it (app/diagnostics.mts; no `diagnostics` when computing them failed) and the suit's swing (app/swing.mts).
// Each suit carries what made up its score (scoreShares), with the minimums this build held resists at.
export type WorkerResult = (OptResult | ExactSolveResult) & { diagnostics?: Diagnostic[]; swing?: SwingResult | undefined; shares?: ScoreShare[]; strict?: StrictResult | undefined };
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
  // The core's item and profile shapes are the same runtime objects as vault-lib's (see exact-solver.mts's header).
  const items = pools as unknown as Partial<Record<string, OptItem[]>>, worn = current as unknown as Partial<Record<string, OptItem | null>>, prof = profile as unknown as EffectiveProfile;
  // SSI by swing step: the step table both solvers score with, resolved once here, where the pool is known (app/swing.mts).
  const { ssiSteps, note } = poolStepsFor(prof, items, worn, opts.optionalSlots, opts.slots);
  const solveProfile: OptProfile = ssiSteps ? { ...profile, ssiSteps } : profile;
  const result: OptResult | ExactSolveResult = opts.exact
    ? await solveExact({ core, pools, current, profile: solveProfile, opts, onProgress, onWarn: (m) => port.postMessage({ type: "warn", message: m } satisfies WorkerWarnMessage) })
    : core.optimizeSuit(pools, current, solveProfile, { ...opts, heuristicBudgetMs: opts.timeBudgetMs ?? DEFAULT_BUDGET_MS, onProgress });   // the same default budget as solveExact and the server's job timer
  // the suit's swing, whether steps were on or not, when it holds a weapon with a speed and the build has a character
  const weapon = heldWeapon(result.best), sw = prof.swing;
  const swing = weapon && sw ? swingOf(weapon.speed!, sw.stamBase, result.totals?.after || {}, ssiShareOf(prof)) : undefined;
  // a tie-break's outcome names the preference and tolerance it ran with (the exact search's already does)
  const tb = result.tieBreak;
  const tieBreak = tb && opts.tieBreak ? { tieBreak: { ...(opts.tieBreak.rarity ? { rarity: opts.tieBreak.rarity } : {}), ...(opts.tieBreak.fewestChanges ? { fewestChanges: true, changes: tb.changes } : {}), tolerance: Math.max(0, opts.tieBreak.tolerance || 0), topScore: tb.topScore, cost: tb.cost, ...("costProven" in tb ? { costProven: (tb as { costProven?: boolean }).costProven } : {}) } } : {};
  // strict order: each stage with the suit's value there and how many are proven (the exact search counts them; the core proves all or none)
  const stages = opts.strict && result.lex ? core.optStrictStages(solveProfile, opts.strict.ranks, !!opts.strict.fewestChanges) : null;
  const strict: StrictResult | null = stages ? { stages: stages.map((st, i) => ({ kind: st.kind, keys: st.keys, value: result.lex![i]! })), proven: (result as ExactSolveResult).strictProven ?? (result.proven ? stages.length : 0),
    ...(opts.strict!.fewestChanges ? { changes: core.optChanges(result.best, current, opts.slots ?? DEFAULT_SLOTS) } : {}) } : null;
  const { lex: _lex, strictProven: _proven, ...plain } = result as ExactSolveResult;
  const withSwing = { ...plain, ...(swing ? { swing } : {}), ...tieBreak, ...(strict ? { strict } : {}) };
  // A failure here never costs the suit (withDiagnostics): the result goes out without diagnostics and the server logs why.
  const withDiags = withDiagnostics(withSwing, () => resultDiagnostics({ pools: items, current: worn, optionalSlots: opts.optionalSlots, slots: opts.slots, profile: solveProfile as DiagnosticsProfile, result: withSwing, swingNote: note }),
    (e) => port.postMessage({ type: "warn", message: `diagnostics failed, the result goes out without them: ${String((e as Error)?.stack || e)}` } satisfies WorkerWarnMessage));
  // Each suit's score by property, the alternatives' too; like the diagnostics, a failure here goes out as a result without them.
  const sharesOf = (after: Record<string, number>): ScoreShare[] => scoreShares(solveProfile as DiagnosticsProfile, after);
  let done: WorkerResult = withDiags;
  try {
    done = { ...withDiags, shares: sharesOf(result.totals?.after || {}),
      ...(result.alternatives ? { alternatives: result.alternatives.map((a) => ({ ...a, shares: sharesOf(totalsOf(a.best as unknown as Partial<Record<string, OptItem>>)) })) } : {}) };
  } catch (e) { port.postMessage({ type: "warn", message: `score shares failed, the result goes out without them: ${String((e as Error)?.stack || e)}` } satisfies WorkerWarnMessage); }
  port.postMessage({ type: "done", result: done, ms: Date.now() - t0 } satisfies WorkerDoneMessage);
} catch (e) {
  const errObj = e as Error;
  port.postMessage({ type: "error", error: String((e && errObj.stack) || e) } satisfies WorkerErrorMessage);
}
