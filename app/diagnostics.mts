// diagnostics.mts — settings that work against a build, each with the change that would fix it (issue #217): a requirement no suit in the pool can reach, and hard requirements the suit could reach one at a time but not together. Pure and browser-safe. The server sends the floor ones with POST /api/optimize before the search starts; the worker attaches the full list to every result, on both solver paths, so a saved run keeps it.
import { propertyReach, DEFAULT_OPTIONAL_SLOTS, DEFAULT_SLOTS } from "./mip.mts";
import { RESIST_KEYS, propName, type OptItem } from "./vault-lib.mts";
import type { Diagnostic, DiagnosticAction } from "./runs-types.mts";

export type { Diagnostic, DiagnosticAction, DiagnosticCode } from "./runs-types.mts";

// The fields of the effective profile (vault-lib.mts EffectiveProfile) these read, all optional so a hand-built request's profile is read as far as it goes. Floors and caps are in item terms; `resistBonus` and the buffs' floors before them turn a number back into the player's terms.
export interface DiagnosticsProfile {
  floors?: Record<string, number> | undefined;
  caps?: Record<string, number> | undefined;
  hardFloors?: string[] | undefined;
  resistBonus?: number | undefined;
  buffs?: { floors?: Record<string, number> | undefined } | undefined;
}
export interface DiagnosticsInput {
  pools?: Partial<Record<string, OptItem[]>> | undefined;
  current?: Partial<Record<string, OptItem | null | undefined>> | undefined;
  optionalSlots?: string[] | undefined;
  slots?: string[] | undefined;
  profile: DiagnosticsProfile;
}
export interface ResultDiagnosticsInput extends DiagnosticsInput {
  result: { totals?: { after?: Record<string, number> | undefined } | undefined; floorsConflict?: boolean | undefined };
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {});
const hardOf = (profile: DiagnosticsProfile): Set<unknown> => new Set(Array.isArray(profile.hardFloors) ? profile.hardFloors : []);
// The floors that ask for something, in the order the profile lists them.
function floorsOf(profile: DiagnosticsProfile): Array<[string, number]> {
  return Object.entries(obj(profile.floors)).flatMap(([k, v]): Array<[string, number]> => { const f = num(v); return f != null && f > 0 ? [[k, f]] : []; });
}
// What turns an item total into the player's terms: the Resisting Spells bonus on a resist, and a planned buff's share (the floor before the buffs less the floor after them).
function offsetOf(profile: DiagnosticsProfile, k: string, f: number): number {
  const before = num(obj(obj(profile.buffs).floors)[k]);
  return (RESIST_KEYS.includes(k) ? num(profile.resistBonus) ?? 0 : 0) + (before != null ? before - f : 0);
}
function reachOf({ pools = {}, current = {}, optionalSlots = DEFAULT_OPTIONAL_SLOTS, slots = DEFAULT_SLOTS }: DiagnosticsInput, keys: string[]): Record<string, { max: number; min: number }> {
  return propertyReach(pools, current, optionalSlots, slots, keys);
}
const lower = (k: string, value: number): DiagnosticAction[] => (value > 0 ? [{ kind: "setFloor", property: k, value }] : []);

// floor_unreachable: one per floor above what any suit in the pool reaches (the per-slot bound, propertyReach), hard or soft. A floor exactly at the bound is reachable. Best possible = min(cap, bound) in the player's terms; a hard floor is offered Lower and Make soft, a soft one (info) only Lower.
export function preBuildDiagnostics(input: DiagnosticsInput): Diagnostic[] {
  const { profile } = input, floors = floorsOf(profile);
  const reach = reachOf(input, floors.map(([k]) => k)), hard = hardOf(profile), caps = obj(profile.caps);
  const out: Diagnostic[] = [];
  for (const [k, f] of floors) {
    const max = reach[k]!.max;
    if (max >= f) continue;
    const off = offsetOf(profile, k, f), cap = num(caps[k]);
    const floor = Math.round(f + off), best = Math.floor(Math.min(cap ?? Infinity, max) + off), isHard = hard.has(k);
    // a resist floor set above its cap counts only up to the cap (vault-lib.mts effectiveProfile), so the sentence says which number it is
    const atCap = RESIST_KEYS.includes(k) && cap != null && floor >= Math.round(cap + off);
    out.push({ code: "floor_unreachable", level: isHard ? "warn" : "info", property: k,
      message: `${propName(k)} ${floor}${atCap ? " (its cap)" : ""} can't be reached with your inventory (best possible: ${best}).`,
      values: { floor, best }, actions: [...lower(k, best), ...(isHard ? [{ kind: "makeSoft", property: k } as const] : [])] });
  }
  return out;
}

// Every diagnostic for a finished build: the floor ones, then floors_conflict for each hard floor the suit misses though one suit could reach it on its own. With `floorsConflict` set the exact search proved no suit meets them all; without it (a timeout that left only the heuristic's suit) the sentence says only that none was found in time. Warnings first.
export function resultDiagnostics(input: ResultDiagnosticsInput): Diagnostic[] {
  const { profile, result } = input, after = obj(result.totals?.after), hard = hardOf(profile);
  const floors = floorsOf(profile).filter(([k]) => hard.has(k)), reach = reachOf(input, floors.map(([k]) => k));
  const out = preBuildDiagnostics(input);
  for (const [k, f] of floors) {
    const t = num(after[k]) ?? 0;
    if (reach[k]!.max < f || t >= f) continue;
    const off = offsetOf(profile, k, f), floor = Math.round(f + off), value = Math.floor(t + off);
    out.push({ code: "floors_conflict", level: "warn", property: k,
      message: result.floorsConflict
        ? `${propName(k)} ${floor} can be reached, but not together with your other hard requirements: this suit has ${value}.`
        : `${propName(k)} ${floor} can be reached, but no suit meeting it together with your other hard requirements was found within the time limit: this suit has ${value}.`,
      values: { floor, value }, actions: [{ kind: "makeSoft", property: k }, ...lower(k, value)] });
  }
  return [...out.filter((d) => d.level === "warn"), ...out.filter((d) => d.level !== "warn")];
}
