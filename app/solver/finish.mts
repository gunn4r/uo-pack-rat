// finish.mts — everything a build does after the search (issue #338): the suit's swing, the tie-break's and Strict order's summaries, the result diagnostics and each suit's score shares.
//
// The worker (app/optimize-worker.mts) calls it on either solver's result. Pure: the core comes in as an argument, and a
// warning goes out through `onWarn`, so a test can call it on a result it built by hand. A diagnostics or shares failure
// never costs the suit: the result goes out without them and `onWarn` says why.
//
// map: builder
// owns: `finishResult`, `FinishInput`, `WorkerResult`
import { resultDiagnostics, scoreShares, withDiagnostics, type Diagnostic, type DiagnosticsProfile, type ScoreShare } from "../diagnostics.mts";
import type { ExactSolveResult, OptAssignment, OptPools, OptProfile, StrictResult } from "../exact-solver.mts";
import { DEFAULT_SLOTS } from "../mip.mts";
import { heldWeapon, ssiShareOf, swingOf, type SwingResult } from "../swing.mts";
import { totalsOf, type EffectiveProfile, type OptItem } from "../vault-lib.mts";
import type * as Core from "../../scripts/optimizer-core.mts";

type OptOptionsFull = NonNullable<Parameters<typeof Core.optimizeSuit>[3]>;
type OptResult = ReturnType<typeof Core.optimizeSuit>;

// Either path's result, with the settings that worked against it (app/diagnostics.mts; no `diagnostics` when computing them failed) and the suit's swing (app/swing.mts).
// Each suit carries what made up its score (scoreShares), with the minimums this build held resists at.
export type WorkerResult = (OptResult | ExactSolveResult) & { diagnostics?: Diagnostic[]; swing?: SwingResult | undefined; shares?: ScoreShare[]; strict?: StrictResult | undefined };

export interface FinishInput {
  core: typeof Core;
  result: OptResult | ExactSolveResult;
  pools: OptPools;
  current: OptAssignment;
  profile: OptProfile;          // the profile the solver scored with (its SSI step table on it)
  opts: OptOptionsFull;
  swingNote: string | null;     // why SSI was scored per point though steps were asked for (app/swing.mts stepsFor)
  onWarn: (message: string) => void;
}

export function finishResult({ core, result, pools, current, profile, opts, swingNote, onWarn }: FinishInput): WorkerResult {
  // The core's item and profile shapes are the same runtime objects as vault-lib's (see exact-solver.mts's header).
  const items = pools as unknown as Partial<Record<string, OptItem[]>>, worn = current as unknown as Partial<Record<string, OptItem | null>>, prof = profile as unknown as EffectiveProfile;
  // the suit's swing, whether steps were on or not, when it holds a weapon with a speed and the build has a character
  const weapon = heldWeapon(result.best), sw = prof.swing;
  const swing = weapon && sw ? swingOf(weapon.speed!, sw.stamBase, result.totals?.after || {}, ssiShareOf(prof)) : undefined;
  // a tie-break's outcome names the preference and tolerance it ran with (the exact search's already does)
  const tb = result.tieBreak;
  const tieBreak = tb && opts.tieBreak ? { tieBreak: { ...(opts.tieBreak.rarity ? { rarity: opts.tieBreak.rarity } : {}), ...(opts.tieBreak.fewestChanges ? { fewestChanges: true, changes: tb.changes } : {}), tolerance: Math.max(0, opts.tieBreak.tolerance || 0), topScore: tb.topScore, cost: tb.cost, ...("costProven" in tb ? { costProven: (tb as { costProven?: boolean }).costProven } : {}) } } : {};
  // strict order: each stage with the suit's value there and how many are proven (the exact search counts them; the core proves all or none)
  const stages = opts.strict && result.lex ? core.optStrictStages(profile, opts.strict.ranks, !!opts.strict.fewestChanges) : null;
  const strict: StrictResult | null = stages ? { stages: stages.map((st, i) => ({ kind: st.kind, keys: st.keys, value: result.lex![i]! })), proven: (result as ExactSolveResult).strictProven ?? (result.proven ? stages.length : 0),
    ...(opts.strict!.fewestChanges ? { changes: core.optChanges(result.best, current, opts.slots ?? DEFAULT_SLOTS) } : {}) } : null;
  const { lex: _lex, strictProven: _proven, ...plain } = result as ExactSolveResult;
  const withSwing = { ...plain, ...(swing ? { swing } : {}), ...tieBreak, ...(strict ? { strict } : {}) };
  const withDiags = withDiagnostics(withSwing, () => resultDiagnostics({ pools: items, current: worn, optionalSlots: opts.optionalSlots, slots: opts.slots, profile: profile as DiagnosticsProfile, result: withSwing, swingNote }),
    (e) => onWarn(`diagnostics failed, the result goes out without them: ${String((e as Error)?.stack || e)}`));
  // Each suit's score by property, the alternatives' too.
  const sharesOf = (after: Record<string, number>): ScoreShare[] => scoreShares(profile as DiagnosticsProfile, after);
  try {
    return { ...withDiags, shares: sharesOf(result.totals?.after || {}),
      ...(result.alternatives ? { alternatives: result.alternatives.map((a) => ({ ...a, shares: sharesOf(totalsOf(a.best as unknown as Partial<Record<string, OptItem>>)) })) } : {}) };
  } catch (e) {
    onWarn(`score shares failed, the result goes out without them: ${String((e as Error)?.stack || e)}`);
    return withDiags;
  }
}
