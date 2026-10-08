// diagnostics.mts — settings that work against a build, each with the change that would fix it (issue #217): a requirement no suit in the pool can reach, hard requirements the suit could reach one at a time but not together, a weight that swamps the rest, and a required weapon property no weapon has. Pure and browser-safe. The server sends the floor ones with POST /api/optimize before the search starts; the worker attaches the full list to every result, on both solver paths, so a saved run keeps it.
import { propertyReach, DEFAULT_OPTIONAL_SLOTS, DEFAULT_SLOTS } from "./mip.mts";
import { RESIST_KEYS, SLOT_LABELS, labelOf, weaponPropName, playerCaps, propName, typicalRange, type OptItem, type ResistCap } from "./vault-lib.mts";
import { delayText, heldWeapon, stepCredit, swingSeconds, type Held, type SsiStepPoint, type SwingResult } from "./swing.mts";
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
  swing?: { steps?: boolean | undefined } | undefined;
  ssiSteps?: SsiStepPoint[] | undefined;   // the step table the solvers scored SSI with (app/swing.mts stepTable), when they did
}
export interface DiagnosticsInput {
  pools?: Partial<Record<string, OptItem[]>> | undefined;
  current?: Partial<Record<string, OptItem | null | undefined>> | undefined;
  optionalSlots?: string[] | undefined;
  slots?: string[] | undefined;
  profile: DiagnosticsProfile;
}
export interface ResultDiagnosticsInput extends DiagnosticsInput {
  result: { totals?: { after?: Record<string, number> | undefined } | undefined; floorsConflict?: boolean | undefined; best?: Partial<Record<string, Held | null>> | undefined; swing?: SwingResult | undefined };
  swingNote?: string | null | undefined;   // why SSI was scored per point though steps were asked for (app/swing.mts stepsFor)
}
// How close the next swing step has to be for swing_next_step to mention it, in SSI points.
export const NEXT_STEP_WITHIN = 10;

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

// The weapon properties a build requires (pool `weaponMustHave`, issue #214), said before the search and kept on the result: weapon_missing_flag for each locked slot whose worn weapon lacks one (the lock wins, so it stays; no action, since none unlocks a slot), and no_weapon_with_flag when no weapon in the pool carries them all (the suit is built without one). `kept` lists each such slot with its weapon and the properties it lacks.
const andList = (xs: string[]): string => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);
export function weaponFlagDiagnostics(required: string[], kept: Array<{ slot: string; name: string; missing: string[] }>, none: boolean): Diagnostic[] {
  const out: Diagnostic[] = kept.map(({ slot, name, missing }) => ({ code: "weapon_missing_flag", level: "warn",
    message: `${name} lacks ${andList(missing.map(weaponPropName))}, but ${SLOT_LABELS[slot] || slot} is locked, so it stays in the suit.`, actions: [] }));
  if (none) out.push({ code: "no_weapon_with_flag", level: "warn", message: `No weapon in your candidate pool has ${andList(required.map(weaponPropName))}, so the suit is built without one.`, actions: [] });
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
  out.push(...weightDiagnostics(profile, after, reachOf(input, [...Object.keys(obj(profile.weights)), "stamPool"])));
  out.push(...swingDiagnostics(input));
  return [...out.filter((d) => d.level === "warn"), ...out.filter((d) => d.level !== "warn")];
}

// weight_dominates: a property whose weight swamps the others. A property's worth is its weight times its typical range (vault-lib.mts typicalRange, in the player's terms), so "= 1,500 per 500 Luck"; its share is |w × min(total, cap)| over the sum of those terms for every weighted property, on the suit found (floor bonuses and the tag penalty left out). It dominates when its worth is at least DOMINANT_WORTH times the median worth of the OTHER positively weighted properties with a typical range (none other: no check), and its share at least DOMINANT_SHARE. A thin suit (a new character, a small or narrowed pool) makes any big weight look dominant, so nothing is raised when the suit's score from the positive weights is below THIN_SUIT of what the pool could give them, Σ w × min(reach, cap) with `reach` the per-slot bound (propertyReach). The suggested weight makes its worth the others' median, to one significant figure.
export const DOMINANT_WORTH = 3;
export const DOMINANT_SHARE = 0.25;
export const THIN_SUIT = 0.5;
const median = (xs: number[]): number => { const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2; };
export const suggestedWeight = (medianWorth: number, typical: number): number => Number((medianWorth / typical).toPrecision(1));
const oneDecimal = (n: number): string => n.toLocaleString("en-US", { maximumFractionDigits: 1 });
export function weightDiagnostics(profile: DiagnosticsProfile, after: Record<string, unknown>, reach: Record<string, { max: number }>): Diagnostic[] {
  const weights = Object.entries(obj(profile.weights)).flatMap(([k, v]): Array<[string, number]> => { const w = num(v); return w != null && w !== 0 && k !== "tagPenalty" ? [[k, w]] : []; });
  const caps = obj(profile.caps) as Record<string, number>, spans = playerCaps({ ...profile, caps });
  const capped = (k: string, t: number): number => { const c = num(caps[k]); return c != null && c < t ? c : t; };
  // with SSI scored by swing step (`ssiSteps`), its term is the step credit the totals reach, as the solvers scored it
  const steps = Array.isArray(profile.ssiSteps) ? profile.ssiSteps : null;
  const valueAt = (k: string, at: (key: string) => number): number => (steps && k === "ssi" ? stepCredit(steps, at("ssi"), at("stamPool")) : capped(k, at(k)));
  const got = (key: string): number => num(after[key]) ?? 0, top = (key: string): number => reach[key]?.max ?? 0;
  const term = (k: string, w: number): number => Math.abs(w * valueAt(k, got));
  const positive = weights.filter(([, w]) => w > 0);
  const score = positive.reduce((n, [k, w]) => n + w * valueAt(k, got), 0);
  const potential = positive.reduce((n, [k, w]) => n + w * Math.max(0, valueAt(k, top)), 0);
  const total = weights.reduce((n, [k, w]) => n + term(k, w), 0);
  if (total <= 0 || score < THIN_SUIT * potential) return [];
  const worths = positive.flatMap(([k, w]) => { const typical = typicalRange(k, spans); return typical != null ? [{ k, w, typical, worth: w * typical }] : []; });
  return worths.flatMap(({ k, w, typical, worth }): Diagnostic[] => {
    const others = worths.filter((x) => x.k !== k).map((x) => x.worth);
    if (!others.length) return [];
    const mid = median(others), ratio = worth / mid, share = term(k, w) / total;
    if (ratio < DOMINANT_WORTH || share < DOMINANT_SHARE) return [];
    const suggested = suggestedWeight(mid, typical), pct = Math.round(share * 100);
    return [{ code: "weight_dominates", level: "warn", property: k,
      message: `${propName(k)} makes up ${pct}% of this suit's score: at weight ${oneDecimal(w)}, ${typical.toLocaleString("en-US")} ${labelOf(k)} is worth as much as ${oneDecimal(ratio)} times the median of your other weights. Try ${suggested}.`,
      values: { weight: w, typical, share: pct, ratio: Math.round(ratio * 10) / 10, median: mid, suggested }, actions: [{ kind: "setWeight", property: k, value: suggested }] }];
  });
}

// swing_linear: steps were asked for but SSI was scored per point (the weapon is not fixed). A lock keeps the worn piece, so Lock is offered for the suit's weapon's hand only when that weapon is the one worn there; otherwise the sentence says to equip it first. swing_next_step (info): steps are off, and the next faster step is within NEXT_STEP_WITHIN SSI of the suit's; it offers steps on and an SSI requirement at that step, and says when one more stamina band would reach it as well.
export function swingDiagnostics({ profile, result, swingNote, current = {} }: ResultDiagnosticsInput): Diagnostic[] {
  const out: Diagnostic[] = [];
  if (swingNote) {
    const w = heldWeapon(result.best), slot = w ? (w.twoHanded ? "twoHanded" : "oneHanded") : null;
    const worn = !!slot && !!w && (current[slot] as { serial?: unknown } | null | undefined)?.serial === (w as { serial?: unknown }).serial;
    out.push({ code: "swing_linear", level: "warn", property: "ssi",
      message: `SSI was scored per point: ${swingNote}. ${worn ? "Lock the weapon slot to score swing speed by step." : "Equip the weapon you want and lock its slot to score swing speed by step."}`,
      actions: worn ? [{ kind: "lockSlot", slot: slot! }] : [] });
  }
  const sw = result.swing;
  if (sw && !profile.swing?.steps) {
    const next = sw.steps.find((st) => st.ssi > sw.ssi);
    if (next && next.ssi - sw.ssi <= NEXT_STEP_WITHIN) {
      const more = 30 * (Math.floor(sw.stamina / 30) + 1) - sw.stamina;
      const byStamina = swingSeconds(sw.speed, sw.stamina + more, sw.ssi) <= next.seconds;
      out.push({ code: "swing_next_step", level: "info", property: "ssi",
        message: `SSI ${sw.ssi} swings every ${delayText(sw.seconds)} at this suit's stamina (${sw.stamina}). ${next.ssi} would make it ${delayText(next.seconds)}${byStamina ? `, and so would ${more} more stamina` : ""}.`,
        values: { ssi: sw.ssi, seconds: sw.seconds, stamina: sw.stamina, next: next.ssi, nextSeconds: next.seconds, ...(byStamina ? { moreStamina: more } : {}) },
        actions: [{ kind: "swingSteps", on: true }, { kind: "setFloor", property: "ssi", value: next.ssi }] });
    }
  }
  return out;
}

// A result with its diagnostics, as the worker sends it. If computing them throws, the result goes out as it is, with no `diagnostics` field (so the page falls back to `unreachableFloors`, as for an old run), and `onError` hears why: a diagnostics bug never costs a finished search.
export function withDiagnostics<R extends object>(result: R, compute: () => Diagnostic[], onError: (e: unknown) => void): R & { diagnostics?: Diagnostic[] } {
  try { return { ...result, diagnostics: compute() }; } catch (e) { onError(e); return result; }
}
