// prepare.mts — everything a build does to its input before the search, and the run key (issue #338).
//
// `prepareSolve` holds every transform of a solve's input, in the one order the run key depends on: the rarity tie costs
// on each piece, the search defaults, the Resisting Spells steps this pool reaches, the SSI step table and the scaled
// hard-floor bonus, then the key, then the pre-build diagnostics. A new transform goes here, before `runKey`: one after it
// silently reuses runs it shouldn't. The step table travels in the solve input, so the worker scores with this one.
// Pure: POST /api/optimize validates the body, builds the pools, and calls it.
//
// map: builder
// owns: `prepareSolve`, `stampTieCost`, `PrepareInput`, `SolveInput`, `PreparedSolve`
import { preBuildDiagnostics, requirementScaleDiagnostics, type Diagnostic, type DiagnosticsProfile } from "../diagnostics.mts";
import { rarityRank } from "../item-query.mts";
import { poolStepsFor, withHardFloorBonus, withReachableResistSteps, type MipProfile } from "../mip.mts";
import { RUN_DEFAULTS } from "../run-settings.mts";
import { runKey, type RunOpts } from "../runs-lib.mts";
import type { RulesV1RarityItem } from "../schema/types.d.mts";
import type { SsiStepPoint } from "./scoring.mts";
import type { Inventory, OptItem, RarityPreference, ResistStep } from "../vault-lib.mts";

// A rarity preference's per-piece cost (issue #262), stamped on each candidate and worn piece: the solvers minimize its
// sum among suits within the tolerance. "lower" costs a piece its rank on the shard's ladder, "higher" the ranks above
// it (an empty slot costs 0 either way); a serial the scans do not have ranks 0, below every tier.
export function stampTieCost<T extends { serial: number }>(it: T, inv: Inventory, rarity: RarityPreference, ladder: RulesV1RarityItem[]): T & { tieCost: number } {
  const rank = rarityRank(ladder, inv.items[it.serial]?.rarity);
  return { ...it, tieCost: rarity === "lower" ? rank : ladder.length - rank };
}

export interface PrepareInput {
  pools: Record<string, unknown>;
  current: Record<string, unknown>;
  profile: object;
  opts: RunOpts;                                                     // validated; optionalSlots set by the pool's builder
  rarity?: { inv: Inventory; ladder: RulesV1RarityItem[] } | null;   // what the tie costs read, with opts.tieBreak.rarity
  weaponMustHave?: string[] | undefined;                             // keyed with the build (runs-lib.mts runKey)
  onlyRoots?: number[] | undefined;
}
// What the worker runs: the input as keyed, and the SSI step table both solvers score with (null: SSI per point, `swingNote` says why when steps were asked for).
export interface SolveInput {
  pools: Record<string, unknown>;
  current: Record<string, unknown>;
  profile: object;
  opts: RunOpts;
  ssiSteps: SsiStepPoint[] | null;
  swingNote: string | null;
}
export interface PreparedSolve {
  input: SolveInput;
  key: string;
  scaleDiagnostics: Diagnostic[];   // a hard-floor bonus past its cap (diagnostics.mts requirementScaleDiagnostics)
  preDiagnostics: Diagnostic[];     // the requirements no suit in the pool can reach (diagnostics.mts preBuildDiagnostics)
}

export function prepareSolve({ pools, current, profile, opts, rarity, weaponMustHave, onlyRoots }: PrepareInput): PreparedSolve {
  const preference = (opts.tieBreak as { rarity?: RarityPreference } | undefined)?.rarity;
  if (preference && rarity) {
    const stamp = (it: unknown): unknown => (it && typeof it === "object" ? stampTieCost(it as { serial: number }, rarity.inv, preference, rarity.ladder) : it);
    pools = Object.fromEntries(Object.entries(pools).map(([slot, list]) => [slot, (list as unknown[]).map(stamp)]));
    current = Object.fromEntries(Object.entries(current).map(([slot, it]) => [slot, stamp(it)]));
  }
  const fullOpts: RunOpts = Object.assign({ seed: RUN_DEFAULTS.seed, restarts: RUN_DEFAULTS.restarts }, opts);
  const p = pools as Partial<Record<string, OptItem[]>>, c = current as Partial<Record<string, OptItem | null>>, optional = fullOpts.optionalSlots as string[] | undefined;
  // only the Resisting Spells steps this pool reaches, before the key: a pool without such pieces keys as before them
  profile = withReachableResistSteps(profile as { resistSteps?: ResistStep[] }, p, c, optional);
  // the step table both solvers score SSI with, and a hard floor's bonus large enough that nothing else in the score
  // outweighs it (issue #311), that table counted; a usual profile carries none. Past the cap the build runs at it and says so.
  const { ssiSteps, note } = poolStepsFor(profile as Parameters<typeof poolStepsFor>[0], p, c, optional, fullOpts.slots as string[] | undefined);
  profile = withHardFloorBonus(profile as MipProfile, p, c, optional, undefined, ssiSteps);
  const scaleDiagnostics = requirementScaleDiagnostics({ pools: p, current: c, optionalSlots: optional, profile: { ...(profile as DiagnosticsProfile), ...(ssiSteps ? { ssiSteps } : {}) } });
  const key = runKey({ pools, current, profile, opts: fullOpts, weaponMustHave, onlyRoots });
  const preDiagnostics = preBuildDiagnostics({ pools: p, current: c, optionalSlots: optional, profile: profile as DiagnosticsProfile });
  return { input: { pools, current, profile, opts: fullOpts, ssiSteps, swingNote: note }, key, scaleDiagnostics, preDiagnostics };
}
