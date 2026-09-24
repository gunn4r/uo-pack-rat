// runs-lib.mts — saved suit-builder runs: the cache key, the reuse rule, and the list summary.
// Server-side only (uses node:crypto); the page never imports it.
import { createHash } from "node:crypto";
import { migrateWeaponSetting } from "./vault-lib.mts";

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
// The version of the search code a saved run's answer came from. Bump it on any change to the MIP
// model (app/mip.mts), the orchestration (app/exact-solver.mts) or the core's scoring and search
// (scripts/optimizer-core.mts) that can change a result, so runs saved before it stop matching and
// are never served as "reused". 2: soft floors allow negative totals, negative capped weights.
export const SOLVER_VERSION = 2;

// Everything that shapes the answer: the candidate pools, the worn suit, the scoring profile, the
// search options, and the solver version.
export function runKey({ pools = {}, current = {}, profile = {}, opts = {} }: RunKeyInput): string {
  return createHash("sha1").update(JSON.stringify({ solver: SOLVER_VERSION, pools, current, profile, opts: stripOpts(opts) })).digest("hex");
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

// A saved run answers a new request when its inputs match and running again is not expected to do
// better: it was proven optimal, it was a heuristic run (its restarts are fixed by the seed; the warm
// start the server adds can only lift a rerun, so the saved one may trail a fresh one slightly), or
// it was an unproven exact run that already had at least the time budget now asked for. A solver
// fallback (`solver: "fallback"`: HiGHS failed to load, or the floors-conflict retry ran out of time)
// never answers — it depends on the environment and the clock, not only on the inputs. `runs` is
// newest first, so the newest match wins.
export function reusableRun(runs: SavedRun[], key: string, opts: { timeBudgetMs?: number } = {}): SavedRun | null {
  const want = typeof opts.timeBudgetMs === "number" ? opts.timeBudgetMs : 15000;
  return runs.find((r) => r.key === key && r.result && r.result.solver !== "fallback" && (r.result.proven || r.result.method !== "exact" || (r.budgetMs ?? 0) >= want)) || null;
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
  changes: number | null;                        // how many slots the run's suit changes
  totalsAfter: Record<string, number> | null;    // the suit's item totals, for the drawer's resist and requirement badges
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
    changes: Array.isArray(res.perSlotChanges) ? res.perSlotChanges.length : null,
    totalsAfter: (res.totals as { after?: Record<string, number> } | undefined)?.after ?? null,
  };
}

// A run saved before the contract settled (2026-09-13) may carry `settings.allowOthers` (now
// `allowOthersWorn`) and `settings.budgetS` (now `settings.budgetMs`, milliseconds like every other
// stored/transmitted budget) and may be missing `schemaVersion`; one saved before the weapon exclusion
// list carries `settings.weaponSkill`, now `settings.excludeWeapons` (migrateWeaponSetting). Apply wherever a run is read from
// disk so every run the server hands out — fresh or old — matches the current shape. Pure and
// idempotent: normalizeRun(normalizeRun(r)) deep-equals normalizeRun(r).
export function normalizeRun(run: SavedRun): SavedRun {
  const s: RunSettingsRaw = migrateWeaponSetting({ ...(run.settings || {}) });
  if ("allowOthers" in s) { s.allowOthersWorn = !!s.allowOthers; delete s.allowOthers; }
  if ("budgetS" in s) { s.budgetMs = 1000 * s.budgetS!; delete s.budgetS; }
  return { ...run, schemaVersion: run.schemaVersion ?? 1, settings: s };
}
