// runs-lib.mts — saved suit-builder runs: the cache key, the reuse rule, and the list summary.
// Server-side only (uses node:crypto); the page never imports it.
import { createHash } from "node:crypto";
import { migrateWeaponSetting, totalsOf, type OptItem } from "./vault-lib.mts";

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
// 3: the reach estimate respects the hands row; heuristic-only runs honour the time budget.
// 4: a warm start keeps a slot that may not be empty filled (a locked slot's piece was dropped, and the search stuck).
export const SOLVER_VERSION = 4;
// The first SOLVER_VERSION whose "proven optimal" holds: before 2 a soft floor ruled out every suit with a
// negative total, so HiGHS could prove a worse suit optimal.
export const PROOF_SOUND_SINCE = 2;

// Everything that shapes the answer: the candidate pools, the worn suit, the scoring profile, the
// search options, and the solver version. A profile's `buffs` (app/buffs.mts plannedProfile: which buffs were planned
// with and their numbers) is left out: the caps and floors they shifted are what the solvers read, so buff sets that
// plan alike (Enemy of One alone, or none; an edit to a number no buff on reads) share a run.
export function runKey({ pools = {}, current = {}, profile = {}, opts = {} }: RunKeyInput): string {
  const { buffs: _planned, ...solved } = (profile || {}) as Record<string, unknown>;
  return createHash("sha1").update(JSON.stringify({ solver: SOLVER_VERSION, pools, current, profile: solved, opts: stripOpts(opts) })).digest("hex");
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
  solverVersion?: number | undefined;           // SOLVER_VERSION when saved; missing on runs saved before it was stamped
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
// A manual run (manualRun below) never answers: nothing searched for it.
export function reusableRun(runs: SavedRun[], key: string, opts: { timeBudgetMs?: number } = {}): SavedRun | null {
  const want = typeof opts.timeBudgetMs === "number" ? opts.timeBudgetMs : 15000;
  return runs.find((r) => r.key === key && r.result && r.result.method !== "manual" && r.result.solver !== "fallback" && (r.result.proven || r.result.method !== "exact" || (r.budgetMs ?? 0) >= want)) || null;
}

// A suit built by hand in the Suit Builder's Manual mode, saved as a run (issue #12, "Save as run"): `suit` and `worn`
// are slot -> piece over every gear slot (the six the optimizer has no slot for included), `worn` what the character
// wears now. Its result has the shape a search's has (best, perSlotChanges, totals before and after), with method
// "manual" and no score: the core's score needs the profile the page plans with, and a number a search never
// produced would only mislead beside the searched runs. Its key starts "manual:", so no search request can match it.
export interface ManualRunInput {
  id: string; character: string; createdAt: string; settings: RunSettingsRaw; inventoryStamp: unknown;
  suit: Record<string, OptItem>; worn: Record<string, OptItem>; slots: readonly string[];
}
export function manualRun({ id, character, createdAt, settings, inventoryStamp, suit, worn, slots }: ManualRunInput): SavedRun {
  const best = Object.fromEntries(slots.map((s) => [s, suit[s] ?? null]));
  const perSlotChanges = slots.filter((s) => (suit[s]?.serial ?? 0) !== (worn[s]?.serial ?? 0)).map((s) => {
    const from = worn[s], to = suit[s], gainedProps: Record<string, number> = {};
    for (const k of new Set([...Object.keys(to?.props || {}), ...Object.keys(from?.props || {})].sort())) {
      const d = (to?.props[k] || 0) - (from?.props[k] || 0);
      if (d) gainedProps[k] = d;
    }
    return { slot: s, from: from?.name ?? null, fromSerial: from?.serial ?? 0, to: to?.name ?? null, toSerial: to?.serial ?? 0, gainedProps };
  });
  const key = `manual:${createHash("sha1").update(JSON.stringify({ character, suit: Object.fromEntries(Object.entries(best).map(([s, it]) => [s, it?.serial ?? null])), settings })).digest("hex")}`;
  return { id, key, character, createdAt, label: "", settings, schemaVersion: 1, solverVersion: SOLVER_VERSION, inventoryStamp, poolSize: null, skipped: {}, ms: 0,
    result: { method: "manual", best, perSlotChanges, totals: { before: totalsOf(worn), after: totalsOf(suit) } } };
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

// Every piece of every saved run's suit (issue #133): what an Organize rule with skipSuits leaves alone. A run's
// result.best is the suit it found, slot -> {serial} or null for an empty slot.
export function suitPieces(runs: SavedRun[]): Set<number> {
  const out = new Set<number>();
  for (const r of runs) for (const it of Object.values((r.result?.best ?? {}) as Record<string, { serial?: unknown } | null>)) if (typeof it?.serial === "number") out.add(it.serial);
  return out;
}

// A run saved before the contract settled (2026-09-13) may carry `settings.allowOthers` (now
// `allowOthersWorn`) and `settings.budgetS` (now `settings.budgetMs`, milliseconds like every other
// stored/transmitted budget) and may be missing `schemaVersion`; one saved before the weapon exclusion
// list carries `settings.weaponSkill`, now `settings.excludeWeapons` (migrateWeaponSetting). A run without a
// solverVersion of at least PROOF_SOUND_SINCE loses its `proven` claim (undefined, which the page shows as no
// verdict at all rather than as "best within budget"). Apply wherever a run is read from
// disk so every run the server hands out — fresh or old — matches the current shape. Pure and
// idempotent: normalizeRun(normalizeRun(r)) deep-equals normalizeRun(r).
export function normalizeRun(run: SavedRun): SavedRun {
  const s: RunSettingsRaw = migrateWeaponSetting({ ...(run.settings || {}) });
  if ("allowOthers" in s) { s.allowOthersWorn = !!s.allowOthers; delete s.allowOthers; }
  if ("budgetS" in s) { s.budgetMs = 1000 * s.budgetS!; delete s.budgetS; }
  const result = run.result?.proven && (run.solverVersion ?? 1) < PROOF_SOUND_SINCE ? { ...run.result, proven: undefined } : run.result;
  return { ...run, schemaVersion: run.schemaVersion ?? 1, settings: s, result };
}
