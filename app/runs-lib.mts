// runs-lib.mts — saved suit-builder runs: the cache key, the reuse rule, and the list summary.
// Server-side only (uses node:crypto); the page never imports it.
import { createHash } from "node:crypto";

// The optimizer search options a saved run was made with. Loosely shaped (an index signature) because
// this module only ever serializes opts wholesale (runKey) or reads the few named fields below — the
// actual search-option shape belongs to the optimizer, not to a run's cache key.
export interface RunOpts {
  timeBudgetMs?: number | undefined;
  warmStart?: unknown;
  onProgress?: unknown;
  progressEveryMs?: number | undefined;
  exact?: boolean | undefined;
  [key: string]: unknown;
}

// Options that do not change the answer a finished run stands for: the time budget (handled by the reuse
// rule), the warm start (only a starting point), and the progress callback.
export function stripOpts(opts: RunOpts = {}): RunOpts {
  const o: RunOpts = { ...opts };
  delete o.timeBudgetMs;
  delete o.warmStart;
  delete o.onProgress;
  delete o.progressEveryMs;
  return o;
}

export interface RunKeyInput {
  pools?: unknown;
  current?: unknown;
  profile?: unknown;
  opts?: RunOpts;
}
// Everything that shapes the answer: the candidate pools, the worn suit, the scoring profile, the search options.
export function runKey({ pools = {}, current = {}, profile = {}, opts = {} }: RunKeyInput): string {
  return createHash("sha1").update(JSON.stringify({ pools, current, profile, opts: stripOpts(opts) })).digest("hex");
}

export interface RunResult {
  proven?: boolean | undefined;
  method?: string | undefined;
  score?: number | undefined;
  currentScore?: number | undefined;
  delta?: number | undefined;
  nodes?: number | undefined;
  [key: string]: unknown;
}
// A run's settings snapshot as saved to disk, possibly still in its pre-2026-09-13 shape (see
// normalizeRun below).
export interface RunSettingsRaw {
  allowOthers?: boolean | undefined;
  allowOthersWorn?: boolean | undefined;
  budgetS?: number | undefined;
  budgetMs?: number | undefined;
  [key: string]: unknown;
}
export interface SavedRun {
  id?: string | undefined;
  key?: string | undefined;
  character?: string | undefined;
  createdAt?: string | undefined;
  label?: string | undefined;
  settings?: RunSettingsRaw | undefined;
  schemaVersion?: number | undefined;
  inventoryStamp?: unknown;
  poolSize?: number | null | undefined;
  skipped?: unknown;
  ms?: number | null | undefined;
  budgetMs?: number | undefined;
  explored?: unknown;
  result?: RunResult | undefined;
}

// A saved run answers a new request when its inputs match and running again could not do better: it was
// proven optimal, it was a heuristic run (deterministic for the same inputs), or it already had at least the
// time budget now asked for. `runs` is newest first, so the newest match wins.
export function reusableRun(runs: SavedRun[], key: string, opts: { timeBudgetMs?: number } = {}): SavedRun | null {
  const want = typeof opts.timeBudgetMs === "number" ? opts.timeBudgetMs : 15000;
  return runs.find((r) => r.key === key && r.result && (r.result.proven || r.result.method !== "exact" || (r.budgetMs ?? 0) >= want)) || null;
}

export interface RunSummary {
  id: string | undefined;
  character: string | undefined;
  createdAt: string | undefined;
  label: string;
  settings: RunSettingsRaw | Record<string, never>;
  schemaVersion: number;
  inventoryStamp: unknown;
  poolSize: number | null;
  skipped: unknown;
  ms: number | null;
  method: string | null;
  proven: boolean | null;
  score: number | null;
  currentScore: number | null;
  delta: number | null;
  nodes: number | null;
  explored: unknown;
}
// What the run list needs: everything except the suit itself.
export function runSummary(r: SavedRun): RunSummary {
  const res = r.result || {};
  return {
    id: r.id, character: r.character, createdAt: r.createdAt, label: r.label || "", settings: r.settings || {},
    schemaVersion: r.schemaVersion ?? 1,
    inventoryStamp: r.inventoryStamp || null, poolSize: r.poolSize ?? null, skipped: r.skipped || {}, ms: r.ms ?? null,
    method: res.method || null, proven: res.proven ?? null, score: res.score ?? null, currentScore: res.currentScore ?? null,
    delta: res.delta ?? null, nodes: res.nodes ?? null, explored: r.explored ?? null,
  };
}

// A run saved before the contract settled (2026-09-13) may carry `settings.allowOthers` (now
// `allowOthersWorn`) and `settings.budgetS` (now `settings.budgetMs`, milliseconds like every other
// stored/transmitted budget) and may be missing `schemaVersion`. Apply wherever a run is read from
// disk so every run the server hands out — fresh or old — matches the current shape. Pure and
// idempotent: normalizeRun(normalizeRun(r)) deep-equals normalizeRun(r).
export function normalizeRun(run: SavedRun): SavedRun {
  const s: RunSettingsRaw = { ...(run.settings || {}) };
  if ("allowOthers" in s) { s.allowOthersWorn = !!s.allowOthers; delete s.allowOthers; }
  if ("budgetS" in s) { s.budgetMs = 1000 * s.budgetS!; delete s.budgetS; }
  return { ...run, schemaVersion: run.schemaVersion ?? 1, settings: s };
}
