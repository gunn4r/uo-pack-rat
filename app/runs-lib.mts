// runs-lib.mts — saved suit-builder runs: the cache key, the reuse rule, and the list summary.
// Server-side only (uses node:crypto); the page never imports it.
import { createHash } from "node:crypto";
import { totalsOf, type OptItem } from "./vault-lib.mts";
import type { RunResult, RunSettingsRaw, RunSummary, SavedRun } from "./runs-types.mts";
export type { RunResult, RunSettingsRaw, RunSummary, SavedRun } from "./runs-types.mts";

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
  weaponMustHave?: string[] | undefined;   // the weapon properties required (issue #214): keyed only when it lists any, so other keys are unchanged
  onlyRoots?: number[] | undefined;        // the containers the pool is narrowed to (issue #12): keyed only when it lists any, likewise
}
// The version of the search code a saved run's answer came from. Bump it on any change to the MIP
// model (app/mip.mts), the orchestration (app/exact-solver.mts) or the core's scoring and search
// (scripts/optimizer-core.mts) that can change a result, so runs saved before it stop matching and
// are never served as "reused". 2: soft floors allow negative totals, negative capped weights.
// 3: the reach estimate respects the hands row; heuristic-only runs honour the time budget.
// 4: a warm start keeps a slot that may not be empty filled (a locked slot's piece was dropped, and the search stuck).
// 5: both solvers search every gear slot, feet, shirt, middle torso, robe, waist, earrings and kilt included (#202).
// 6: every result carries `diagnostics` (app/diagnostics.mts), so a run saved before it is not reused without them.
// 7: SSI can be scored by swing step (app/swing.mts), weapons carry their speed, and a result carries its `swing`.
// 8: Resisting Spells is a minimum under each resist (`mins`), not a bonus taken off the resist caps and floors (#261).
export const SOLVER_VERSION = 8;
// The first SOLVER_VERSION whose saved diagnostics are in the player's terms as the page shows them now: before 8 a
// resist's numbers counted the Resisting Spells bonus (#261), so an older run's are dropped when read and it falls back
// as a run saved before diagnostics does.
export const DIAGNOSTICS_SOUND_SINCE = 8;
// The first SOLVER_VERSION whose "proven optimal" holds: before 2 a soft floor ruled out every suit with a
// negative total, so HiGHS could prove a worse suit optimal.
export const PROOF_SOUND_SINCE = 2;

// Everything that shapes the answer: the candidate pools, the worn suit, the scoring profile, the
// search options, and the solver version. A profile's `buffs` (app/buffs.mts plannedProfile: which buffs were planned
// with and their numbers) is left out: the caps and floors they shifted are what the solvers read, so buff sets that
// plan alike (Enemy of One alone, or none; an edit to a number no buff on reads) share a run. The required weapon
// properties are keyed too, though the pools usually show them: with both hands locked, or no weapon at all, the pools
// match a build without them, and the warnings they raise would not. Only containers is keyed for the same reason: two
// lists can give the same pools and differ in the slots they leave empty.
export function runKey({ pools = {}, current = {}, profile = {}, opts = {}, weaponMustHave, onlyRoots }: RunKeyInput): string {
  const { buffs: _planned, ...solved } = (profile || {}) as Record<string, unknown>;
  return createHash("sha1").update(JSON.stringify({ solver: SOLVER_VERSION, pools, current, profile: solved, opts: stripOpts(opts), ...(weaponMustHave?.length ? { weaponMustHave } : {}), ...(onlyRoots?.length ? { onlyRoots } : {}) })).digest("hex");
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
// are slot -> piece over every gear slot, `worn` what the character wears now. Its result has the shape a search's has
// (best, perSlotChanges, totals before and after), with method "manual" and no score: the core's score needs the
// profile the page plans with, and a number a search never produced would only mislead beside the searched runs. Its
// key starts "manual:", so no search request can match it.
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
  return runRecord({ id, key, character, createdAt, settings, inventoryStamp, poolSize: null, skipped: {}, ms: 0,
    result: { method: "manual", best, perSlotChanges, totals: { before: totalsOf(worn), after: totalsOf(suit) } } });
}

// A saved run's document, for both writers: a finished search (the jobs service's saveRun, with its `search` part) and a
// manual run (manualRun above). The two have always listed their fields in different orders, and each keeps its own,
// so a run file is byte for byte what it was.
export interface RunRecordInput<R> {
  id: string; key: string; character: string; createdAt: string; settings: RunSettingsRaw; inventoryStamp: unknown;
  poolSize: number | null; skipped: unknown; ms: number | null; result: R;
  search?: { opts: unknown; budgetMs: number | null; explored: unknown } | undefined;
}
export function runRecord<R>({ id, key, character, createdAt, settings, inventoryStamp, poolSize, skipped, ms, result, search }: RunRecordInput<R>) {
  const head = { id, key, character, createdAt, label: "" }, versions = { schemaVersion: 1, solverVersion: SOLVER_VERSION }, source = { inventoryStamp, poolSize, skipped };
  return search ? { ...head, ...versions, settings, ...source, ...search, result, ms } : { ...head, settings, ...versions, ...source, ms, result };
}

// The suit's item totals the drawer's badges read. A run saved while the optimizer searched only twelve slots
// (SOLVER_VERSION 4) did not plan the others: a search's count the character's `worn` pieces there, so it compares
// like for like with a run of every slot, and a manual run's kept those slots' pieces apart (`outside`).
function totalsAfter(res: RunResult, worn: OptItem[]): Record<string, number> | null {
  const t = res.totals as { after?: Record<string, number>; outside?: Record<string, number> } | undefined;
  if (!t?.after) return null;
  const out = { ...t.after }, planned = (res.best ?? {}) as object;
  const add = (props: Record<string, number>): void => { for (const [k, v] of Object.entries(props)) out[k] = (out[k] || 0) + v; };
  add(t.outside || {});
  for (const it of worn) if (it.slot && !Object.hasOwn(planned, it.slot)) add(it.props);
  return out;
}
// What the run list needs: everything except the suit itself. `worn`: what the run's character wears now.
export function runSummary(r: SavedRun, worn: OptItem[] = []): RunSummary {
  const res = r.result || {};
  return {
    id: r.id, character: r.character, createdAt: r.createdAt, label: r.label || "", settings: r.settings || {},
    schemaVersion: r.schemaVersion ?? 1,
    inventoryStamp: r.inventoryStamp || null, poolSize: r.poolSize ?? null, skipped: r.skipped || {}, ms: r.ms ?? null,
    method: res.method || null, proven: res.proven ?? null, score: res.score ?? null, currentScore: res.currentScore ?? null,
    delta: res.delta ?? null, nodes: res.nodes ?? null, explored: r.explored ?? null,
    changes: Array.isArray(res.perSlotChanges) ? res.perSlotChanges.length : null,
    totalsAfter: totalsAfter(res, worn),
  };
}

// Every piece of every saved run's suit (issue #133): what an Organize rule with skipSuits leaves alone. A run's
// result.best is the suit it found, slot -> {serial} or null for an empty slot.
export function suitPieces(runs: SavedRun[]): Set<number> {
  const out = new Set<number>();
  for (const r of runs) for (const it of Object.values((r.result?.best ?? {}) as Record<string, { serial?: unknown } | null>)) if (typeof it?.serial === "number") out.add(it.serial);
  return out;
}
