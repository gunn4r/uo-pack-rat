// diagnostics.mts — settings that work against a build, each with the change that would fix it (issue #217): a requirement no suit in the pool can reach, hard requirements the suit could reach one at a time but not together, and a weight that swamps the rest. Pure and browser-safe. The server sends the floor ones with POST /api/optimize before the search starts; the worker attaches the full list to every result, on both solver paths, so a saved run keeps it.
import { propertyReach, DEFAULT_OPTIONAL_SLOTS, DEFAULT_SLOTS } from "./mip.mts";
import { RESIST_KEYS, labelOf, playerCaps, typicalRange, type OptItem, type ResistCap } from "./vault-lib.mts";
import type { Diagnostic, DiagnosticAction } from "./runs-types.mts";

export type { Diagnostic, DiagnosticAction, DiagnosticCode } from "./runs-types.mts";

// The fields of the effective profile (vault-lib.mts EffectiveProfile) these read, all optional so a hand-built request's profile is read as far as it goes. Floors and caps are in item terms; `resistBonus` and the buffs' floors before them turn a number back into the player's terms.
export interface DiagnosticsProfile {
  weights?: Record<string, number> | undefined;
  floors?: Record<string, number> | undefined;
  caps?: Record<string, number> | undefined;
  hardFloors?: string[] | undefined;
  resistBonus?: number | undefined;
  resistCapOverrides?: Record<string, ResistCap> | undefined;
  buffs?: { floors?: Record<string, number> | undefined; caps?: Record<string, number> | undefined } | undefined;
}
export interface DiagnosticsInput {
  pools?: Partial<Record<string, OptItem[]>> | undefined;
  current?: Partial<Record<string, OptItem | null | undefined>> | undefined;
  optionalSlots?: string[] | undefined;
  slots?: string[] | undefined;
  profile: DiagnosticsProfile;
}
export interface ResultDiagnosticsInput extends DiagnosticsInput {
  result: { totals?: { after?: Record<string, number> | undefined } | undefined };
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
// The floors that ask for something, in the order the profile lists them.
function floorsOf(profile: DiagnosticsProfile): Array<[string, number]> {
  const fl = profile.floors && typeof profile.floors === "object" ? profile.floors : {};
  return Object.entries(fl).flatMap(([k, v]): Array<[string, number]> => { const f = num(v); return f != null && f > 0 ? [[k, f]] : []; });
}
// What turns an item total into the player's terms: the Resisting Spells bonus on a resist, and a planned buff's share (the floor before the buffs less the floor after them).
function offsetOf(profile: DiagnosticsProfile, k: string, f: number): number {
  const before = num(profile.buffs?.floors?.[k]);
  return (RESIST_KEYS.includes(k) ? num(profile.resistBonus) ?? 0 : 0) + (before != null ? before - f : 0);
}
function reachOf({ pools = {}, current = {}, optionalSlots = DEFAULT_OPTIONAL_SLOTS, slots = DEFAULT_SLOTS }: DiagnosticsInput, keys: string[]): Record<string, { max: number; min: number }> {
  return propertyReach(pools, current, optionalSlots, slots, keys);
}
const lower = (k: string, value: number): DiagnosticAction[] => (value > 0 ? [{ kind: "setFloor", property: k, value }] : []);

// floor_unreachable: one per floor above what any suit in the pool reaches (the per-slot bound, propertyReach), hard or soft. A floor exactly at the bound is reachable. Best possible = min(cap, bound) in the player's terms; a hard floor is offered Lower and Make soft, a soft one (info) only Lower.
export function preBuildDiagnostics(input: DiagnosticsInput): Diagnostic[] {
  const { profile } = input, floors = floorsOf(profile);
  const reach = reachOf(input, floors.map(([k]) => k)), hard = new Set(profile.hardFloors || []), caps = profile.caps || {};
  const out: Diagnostic[] = [];
  for (const [k, f] of floors) {
    const max = reach[k]!.max;
    if (max >= f) continue;
    const off = offsetOf(profile, k, f), cap = num(caps[k]);
    const floor = Math.round(f + off), best = Math.floor(Math.min(cap ?? Infinity, max) + off), isHard = hard.has(k);
    out.push({ code: "floor_unreachable", level: isHard ? "warn" : "info", property: k,
      message: `${labelOf(k)} ${floor} can't be reached with your inventory (best possible: ${best}).`,
      values: { floor, best }, actions: [...lower(k, best), ...(isHard ? [{ kind: "makeSoft", property: k } as const] : [])] });
  }
  return out;
}

// Every diagnostic for a finished build: the floor ones, then floors_conflict for each hard floor the suit misses though one suit could reach it on its own (a floors conflict, or a timeout that left only the heuristic's suit). Warnings first.
export function resultDiagnostics(input: ResultDiagnosticsInput): Diagnostic[] {
  const { profile, result } = input, after = result.totals?.after || {}, hard = new Set(profile.hardFloors || []);
  const floors = floorsOf(profile).filter(([k]) => hard.has(k)), reach = reachOf(input, floors.map(([k]) => k));
  const out = preBuildDiagnostics(input);
  for (const [k, f] of floors) {
    const t = num(after[k]) ?? 0;
    if (reach[k]!.max < f || t >= f) continue;
    const off = offsetOf(profile, k, f), floor = Math.round(f + off), value = Math.floor(t + off);
    out.push({ code: "floors_conflict", level: "warn", property: k,
      message: `${labelOf(k)} ${floor} can be reached, but not together with your other hard requirements: this suit has ${value}.`,
      values: { floor, value }, actions: [{ kind: "makeSoft", property: k }, ...lower(k, value)] });
  }
  out.push(...weightDiagnostics(profile, after));
  return [...out.filter((d) => d.level === "warn"), ...out.filter((d) => d.level !== "warn")];
}

// weight_dominates: a property whose weight swamps the rest. A property's worth is its weight times its typical range (vault-lib.mts typicalRange, in the player's terms), so "= 1,500 per 500 Luck"; its share is |w × min(total, cap)| over the sum of those terms for every weighted property, on the suit found (floor bonuses and the tag penalty left out). It dominates when its worth is at least DOMINANT_WORTH times the median worth of the positively weighted properties with a typical range, and its share at least DOMINANT_SHARE. The suggested weight is the one that makes its worth the median, to one significant figure.
export const DOMINANT_WORTH = 3;
export const DOMINANT_SHARE = 0.25;
const median = (xs: number[]): number => { const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2; };
export const suggestedWeight = (medianWorth: number, typical: number): number => Number((medianWorth / typical).toPrecision(1));
const oneDecimal = (n: number): string => n.toLocaleString("en-US", { maximumFractionDigits: 1 });
export function weightDiagnostics(profile: DiagnosticsProfile, after: Record<string, number>): Diagnostic[] {
  const weights = Object.entries(profile.weights || {}).flatMap(([k, v]): Array<[string, number]> => { const w = num(v); return w != null && w !== 0 && k !== "tagPenalty" ? [[k, w]] : []; });
  const caps = profile.caps || {}, spans = playerCaps({ ...profile, caps });
  const term = (k: string, w: number): number => { const t = num(after[k]) ?? 0, c = num(caps[k]); return Math.abs(w * (c != null && c < t ? c : t)); };
  const total = weights.reduce((n, [k, w]) => n + term(k, w), 0);
  const worths = weights.flatMap(([k, w]) => { const typical = typicalRange(k, spans); return w > 0 && typical != null ? [{ k, w, typical, worth: w * typical }] : []; });
  if (!worths.length || total <= 0) return [];
  const mid = median(worths.map((x) => x.worth));
  return worths.flatMap(({ k, w, typical, worth }): Diagnostic[] => {
    const ratio = worth / mid, share = term(k, w) / total;
    if (ratio < DOMINANT_WORTH || share < DOMINANT_SHARE) return [];
    const suggested = suggestedWeight(mid, typical), pct = Math.round(share * 100), nm = labelOf(k);
    return [{ code: "weight_dominates", level: "warn", property: k,
      message: `${nm} makes up ${pct}% of this suit's score: at weight ${oneDecimal(w)}, ${typical.toLocaleString("en-US")} ${nm} is worth as much as ${oneDecimal(ratio)} times a typical property. Try ${suggested}.`,
      values: { weight: w, typical, share: pct, ratio: Math.round(ratio * 10) / 10, median: mid, suggested }, actions: [{ kind: "setWeight", property: k, value: suggested }] }];
  });
}
