// jobs.mts — optimizer jobs: one worker thread per build, its progress and outcome for the per-job event stream, one running build per client (a newer one supersedes it), a server-wide ceiling, and a finished build saved as a run.
import type http from "node:http";
import { Worker } from "node:worker_threads";
import { randomUUID } from "node:crypto";
import { runRecord, stripOpts, type RunOpts, type RunSettingsRaw } from "../runs-lib.mts";
import type { WorkerMessage, WorkerDoneMessage } from "../optimize-worker.mts";
import type { OptResult, ExactSolveResult, SolveProgress } from "../exact-solver.mts";
import { sse } from "./events.mts";

// A job keeps its last progress snapshot and its final result, so a page that reconnects (or
// reloads) can catch up. Cancel = terminate the worker. Finished jobs are dropped after a while.
// An exact build (opts.exact) runs entirely inside that one worker: app/exact-solver.mts hands the
// problem to HiGHS, which explores the tree itself — there is nothing left to split across a
// thread pool, so (unlike the pre-HiGHS branch-and-bound) this is always exactly one worker per job.
//
// input.pools/current/profile stay `unknown` all the way through a job's life, same as the request
// body they came from — runKey (runs-lib.mts) and the Worker constructor's own workerData option
// (typed `any` by @types/node) are the only two places that ever touch them, and neither requires a
// narrower type. meta is the caller's own free-form bookkeeping object (poolSize/skipped/character/
// settings/warning are added to it by the server; nothing beyond that is read off it besides what a
// caller chooses to stash there, e.g. a saved run's inventoryStamp).
export interface JobInput {
  pools: unknown;
  current: unknown;
  profile: unknown;
  opts: RunOpts;
}
export type JobState = "running" | "done" | "cancelled" | "error";
// What a job needs of its worker thread: node:worker_threads' Worker, or a test's stand-in.
export type JobWorker = Pick<Worker, "on" | "terminate">;
export interface Job {
  id: string;
  // Mirrors the `x-client-id` header's own declared type (string | string[] | undefined, per
  // @types/node's IncomingHttpHeaders index signature for a header with no dedicated field) — this
  // value is only ever compared for equality or handed back verbatim, never treated as a string
  // specifically, so no narrowing cast is needed anywhere it's read.
  clientId: string | string[] | null;
  key: string;
  meta: Record<string, unknown>;
  input: JobInput;
  save: boolean;                       // saved as a run when done (a Manual fill is not)
  state: JobState;
  startedAt: number;
  progress: SolveProgress | null;
  result: OptResult | ExactSolveResult | null;
  ms: number | null;
  error: string | null;
  runId: string | null;
  clients: Set<http.ServerResponse>;
  workers: Set<JobWorker>;
  // The stuck-build timer (budget + JOB_RUN_GRACE_MS); finish() clears it, so a finished job's
  // result is held by the retention timer alone rather than pinned by this one's closure too.
  stuckTimer: NodeJS.Timeout | null;
}
// How long a finished build's result stays readable (retentionMs, timed from when it finished), and
// how far past its own time budget a build may still be running before it is cancelled as stuck
// (runGraceMs). Only tests set these.
export interface JobTimings {
  retentionMs?: number | undefined;
  runGraceMs?: number | undefined;
}

// `coreUrl` is the optimizer core each worker imports; `runStore` keeps a finished build as a run; `log` appends one
// line to the server log. `createWorker` starts a worker thread with its workerData (a test passes a stand-in).
export function createJobsService({ coreUrl, timings = {}, runStore, log, createWorker = (workerData) => new Worker(new URL("../optimize-worker.mts", import.meta.url), { workerData }) }: {
  coreUrl: string;
  timings?: JobTimings;
  runStore: { write(run: { id: string }): void };
  log: (line: string) => void;
  createWorker?: (workerData: Record<string, unknown>) => JobWorker;
}) {
  const jobs = new Map<string, Job>();
  // A finished job (done, failed or cancelled) stays readable for this long AFTER it finishes, so a
  // page that reconnects or reloads can still collect its result. This clock used to start with the
  // build and also cancel a build still running when it rang: a player's 15-minute budget (the route
  // accepts up to 60) was killed at 10:00, and a result finishing at 9:59 was dropped a second later.
  const JOB_RETENTION_MS = timings.retentionMs ?? 10 * 60 * 1000;
  // A running build is only cancelled as stuck once it is this far past its own time budget (the
  // core's 15 s default when it names none) — never before the budget the route accepted for it. The
  // grace covers the heuristic restarts that run ahead of the exact phase's budget.
  const JOB_RUN_GRACE_MS = timings.runGraceMs ?? 10 * 60 * 1000;
  const DEFAULT_TIME_BUDGET_MS = 15000;
  // Set by stop(): a worker terminated by shutdown is not a failed build.
  let closing = false;
  // A server-wide ceiling on live worker threads, on top of the per-X-Client-Id supersede below: that
  // rule is skipped entirely when the header is absent, so a caller that omits (or rotates) it could
  // start arbitrarily many `new Worker()` threads, each holding its full result for JOB_RETENTION_MS
  // (post-review fix, Important 5). Four is well past what one page ever has in flight — it only ever
  // runs one build at a time — and leaves room for a couple of stale jobs a client has walked away from.
  const MAX_RUNNING_JOBS = 4;
  const timers = new Set<NodeJS.Timeout>();   // every setTimeout this service owns, so stop() can clear them all

  // Job ids are crypto.randomUUID() (spec §4.5) rather than the old Date.now()-based id: the SSE
  // events route is exempt from the bearer token (EventSource can't carry one), so the id itself
  // must be unguessable — the events route's ownership check is the other half of that.
  function startJob(input: JobInput, key: string, meta: Record<string, unknown>, clientId: string | string[] | null = null, save = true): Job {
    const id = randomUUID();
    const job: Job = { id, clientId, key, meta, input, save, state: "running", startedAt: Date.now(), progress: null, result: null, ms: null, error: null, runId: null, clients: new Set(), workers: new Set(), stuckTimer: null };
    jobs.set(id, job);
    runJob(job).catch((e) => {
      // Cancelled (or the server is shutting down): the terminated workers reject, nothing to report.
      if (job.state !== "running" || closing) return;
      // Same stack-free rule as the route-level 500s, and now the same ref-keyed, file-backed log too
      // (post-review: job failures used to go to console.error only, with no ref and no file trail —
      // unrecoverable in a headless/backgrounded deployment). Note the worker's own try/catch
      // (optimize-worker.mts) already stringifies a caught error as `${e.stack}` before it ever leaves
      // the worker thread, so e.message here can ALREADY be a full stack trace in that path (an
      // uncaught worker crash instead reaches here as a normal Error with a normal e.message) — logging
      // e.stack ?? e.message covers both, and the client only ever sees the sanitized ref line either way.
      const ref = randomUUID().slice(0, 8);
      log(`${new Date().toISOString()} ${ref} job ${job.id}\n${(e && ((e as Error).stack || (e as Error).message)) || e}\n`);
      job.state = "error"; job.error = `internal error (ref ${ref})`;
      finish(job, "failed", { error: job.error });
    });
    const t = setTimeout(() => { timers.delete(t); job.stuckTimer = null; cancelJob(job); }, (input.opts.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS) + JOB_RUN_GRACE_MS);
    t.unref(); timers.add(t); job.stuckTimer = t;
    return job;
  }
  function spawnWorker(job: Job, data: { pools: unknown; current: unknown; profile: unknown; opts: RunOpts }, onProgress: (p: SolveProgress) => void, onWarn?: (message: string) => void): Promise<WorkerDoneMessage> {
    return new Promise((resolve, reject) => {
      const w = createWorker({ coreUrl, ...data });
      job.workers.add(w);
      let settled = false;
      w.on("message", (m: WorkerMessage) => {
        if (m.type === "progress") onProgress(m.progress);
        else if (m.type === "warn") { if (onWarn) onWarn(m.message); }
        else if (m.type === "done") { settled = true; resolve(m); }
        else if (m.type === "error") { settled = true; reject(new Error(m.error)); }
      });
      w.on("error", (e) => { settled = true; reject(e); });
      w.on("exit", (code) => { job.workers.delete(w); if (!settled) reject(new Error(`worker exited with code ${code}`)); });
    });
  }
  function emitProgress(job: Job, p: SolveProgress): void { job.progress = p; broadcast(job, "progress", p); }

  async function runJob(job: Job): Promise<void> {
    const { pools, current, profile, opts } = job.input;
    const t0 = Date.now();
    const onWarn = (message: string) => log(`${new Date().toISOString()} job ${job.id} warn: ${message}\n`);
    const { result } = await spawnWorker(job, { pools, current, profile, opts }, (p) => emitProgress(job, p), onWarn);
    if (job.state !== "running") return;
    job.state = "done"; job.result = result; job.ms = Date.now() - t0;
    if (job.save) try { job.runId = saveRun(job).id; } catch (e) { console.error(`could not save run ${job.id}: ${(e as Error).message}`); }
    finish(job, "done", { result, ms: job.ms, runId: job.runId });
  }
  function cancelJob(job: Job): void {
    if (job.state !== "running") return;
    job.state = "cancelled";
    job.ms = Date.now() - job.startedAt;
    for (const w of job.workers) w.terminate();
    finish(job, "cancelled", { ms: job.ms });
  }
  function jobSnapshot(job: Job) { return { id: job.id, state: job.state, progress: job.progress, result: job.result, ms: job.ms, error: job.error, runId: job.runId }; }
  function broadcast(job: Job, event: string, data: unknown): void { for (const c of job.clients) sse(c, event, data); }
  // The retention clock starts here, when the job ends — however it ends.
  function finish(job: Job, event: string, data: unknown): void {
    broadcast(job, event, data); for (const c of job.clients) c.end(); job.clients.clear();
    if (job.stuckTimer) { clearTimeout(job.stuckTimer); timers.delete(job.stuckTimer); job.stuckTimer = null; }
    const t = setTimeout(() => { jobs.delete(job.id); timers.delete(t); }, JOB_RETENTION_MS);
    t.unref(); timers.add(t);
  }
  function saveRun(job: Job) {
    const meta = job.meta || {};
    const run = runRecord({ id: job.id, key: job.key, character: (meta.character as string) || "?", createdAt: new Date().toISOString(),
      settings: (meta.settings as RunSettingsRaw) || {}, inventoryStamp: meta.inventoryStamp || null, poolSize: (meta.poolSize as number) ?? null, skipped: meta.skipped || {},
      search: { opts: stripOpts(job.input.opts), budgetMs: job.input.opts.timeBudgetMs ?? null, explored: job.progress?.explored ?? null },
      result: job.result, ms: job.ms });
    runStore.write(run);
    return run;
  }

  // POST /api/optimize's start: null when the ceiling refuses it (a 429), else the new job and the id of the one it superseded.
  function submit(input: JobInput, key: string, meta: Record<string, unknown>, headerClientId: string | string[] | null, save: boolean): { job: Job; superseded: string | null } | null {
    // Cap: one running optimize job per client. A real client id is only ever supplied by the
    // page's own ui/api.mts; a curl/test caller with no X-Client-Id is never deduped against itself.
    let previous: Job | null = null;
    if (headerClientId) {
      for (const j of jobs.values()) {
        if (j.clientId && j.clientId === headerClientId && j.state === "running") { previous = j; break; }
      }
    }
    // …and a server-wide ceiling behind it, for the callers the per-client rule can't see (see
    // MAX_RUNNING_JOBS). Checked BEFORE the supersede, counting the job it would replace as already
    // freed, so a refused request never cancels anything: a page that rebuilds while its own job
    // is still running never trips it, and one that does trip it keeps the build it had.
    let running = 0;
    for (const j of jobs.values()) if (j.state === "running" && j !== previous) running++;
    if (running >= MAX_RUNNING_JOBS) return null;
    if (previous) cancelJob(previous);
    const superseded = previous ? previous.id : null;
    const jobClientId = headerClientId || randomUUID();
    return { job: startJob(input, key, meta, jobClientId, save), superseded };
  }
  // Shutdown, first half: every job timer cleared, then closing set before the workers are terminated, so a build
  // still running when the server quits ends because of the quit and its worker's exit is not logged as a failure.
  function stop(): void {
    for (const t of timers) clearTimeout(t);
    timers.clear();
    closing = true;
    for (const job of jobs.values()) for (const w of job.workers) w.terminate();
  }
  // Shutdown, second half: every per-job event stream ended.
  function endStreams(): void { for (const job of jobs.values()) { for (const c of job.clients) c.end(); job.clients.clear(); } }

  return { get: (id: string): Job | undefined => jobs.get(id), submit, cancel: cancelJob, snapshot: jobSnapshot, stop, endStreams };
}
export type JobsService = ReturnType<typeof createJobsService>;
