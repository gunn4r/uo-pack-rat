// ui/builder-model.mts — the Suit Builder's pure logic (design spec 4.6-4.8): the one-line summaries a
// collapsed panel section shows, the Advanced fields' validation, a resist tile's outcome line, the result's
// "other changes" badges and "after the change" values, the compare table's differing rows and best values,
// and a saved run's label and badges. No DOM and no page state, so app/builder-model.test.mts can check it
// all directly; ui/builder.mts, ui/builder-result.mts and ui/runs.mts draw what it returns.
import { labelOf, fullOf, RESIST_KEYS, RESIST_CAP_LIMITS, SLOT_LABELS, settingsDiff, shardResistCap, WEAPON_SKILLS } from "../vault-lib.mts";
import type { PropMap, ResistCap, RunSettings } from "../vault-lib.mts";

export const plural = (n: number, word: string, many = `${word}s`): string => `${n.toLocaleString("en-US")} ${n === 1 ? word : many}`;
const num = (n: number): string => n.toLocaleString("en-US", { maximumFractionDigits: 2 });

// ---------------------------------------------------------------- property names
// A rule row names its property in words ("Physical resist", "Hit chance increase"); a summary or badge
// uses the short label ("Phys", "HCI"). The pools and skill bonuses read better short.
const POOLS = new Set(["stamPool", "manaPool", "hitsPool"]);
export function propName(k: string): string {
  if (POOLS.has(k)) return labelOf(k);
  if (k.startsWith("sk:")) return `${labelOf(k).slice(1)} skill bonus`;
  const f = fullOf(k);
  return f.replace(/(?!^)\b([A-Z])([a-z]+)/g, (_m, a: string, b: string) => a.toLowerCase() + b);
}

// ---------------------------------------------------------------- panel summaries
// "each resist 6" when all five resists carry the same value, else each one on its own.
function groupedEntries(values: Record<string, number>): Array<[string, number]> {
  const entries = Object.entries(values).filter(([k]) => k !== "tagPenalty");
  const resists = RESIST_KEYS.map((k) => values[k]);
  const same = resists.every((v) => v != null && v === resists[0]);
  if (!same) return entries.map(([k, v]) => [labelOf(k), v]);
  return [["each resist", resists[0]!], ...entries.filter(([k]) => !RESIST_KEYS.includes(k)).map(([k, v]): [string, number] => [labelOf(k), v])];
}
// "HCI 10 · DCI 10 · each resist 6 · SSI 5 · HPR 4 · DEX 4 · 7 more": the heaviest first.
export function weightsSummary(weights: Record<string, number> = {}, shown = 6): string {
  const all = groupedEntries(weights).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (!all.length) return "No weights set";
  const rest = all.length - shown;
  return [...all.slice(0, shown).map(([l, v]) => `${l} ${num(v)}`), rest > 0 ? `${rest} more` : ""].filter(Boolean).join(" · ");
}
// "each resist 65 · HCI 35 soft"
export function requirementsSummary(floors: Record<string, number> = {}, soft: string[] = []): string {
  const keys = Object.keys(floors).filter((k) => k !== "tagPenalty");
  if (!keys.length) return "No requirements";
  const resistsSoft = RESIST_KEYS.filter((k) => soft.includes(k));
  const grouped = groupedEntries(floors);
  return grouped.map(([l, v]) => {
    const k = l === "each resist" ? null : keys.find((x) => labelOf(x) === l);
    const isSoft = k ? soft.includes(k) : resistsSoft.length === RESIST_KEYS.length;
    return `${l} ${num(v)}${isSoft ? " soft" : ""}`;
  }).join(" · ");
}
export interface PoolSettings { allowOthersWorn?: boolean | undefined; allowGargoyle?: boolean | undefined; medOnly?: boolean | undefined; excludeWeapons?: string[] | undefined;
  lockedSlots?: string[] | undefined; excludeTags?: string[] | undefined; excludeSkills?: string[] | undefined; excludeRoots?: unknown[] | undefined }
// "Own gear and unworn gear · no gargoyle-only · any weapon"
export function poolSummary(p: PoolSettings): string {
  return [
    p.allowOthersWorn ? "Includes gear worn by others" : "Own gear and unworn gear",
    p.allowGargoyle ? "gargoyle-only allowed" : "no gargoyle-only",
    p.medOnly ? "meditation-safe only" : "",
    weaponsSummary(p.excludeWeapons),
    p.lockedSlots?.length ? `${plural(p.lockedSlots.length, "slot")} locked` : "",
    p.excludeTags?.length ? `no ${p.excludeTags.join(", ")}` : "",
    p.excludeSkills?.length ? `${plural(p.excludeSkills.length, "skill bonus", "skill bonuses")} forbidden` : "",
    p.excludeRoots?.length ? `${plural(p.excludeRoots.length, "container")} skipped` : "",
  ].filter(Boolean).join(" · ");
}

// ---------------------------------------------------------------- weapons
// The Weapons control holds the weapon skills left out of the pool. The summary says them ("no archery or throwing
// weapons", "fencing weapons only"); the chip counts them ("Weapons: 2 excluded").
const orList = (xs: string[]): string => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} or ${xs[xs.length - 1]}`);
export const weaponName = (w: string): string => w[0]!.toUpperCase() + w.slice(1);
interface WeaponWords { any: string; none: string; only: (w: string) => string; some: (excluded: string[]) => string }
function weaponsText(excluded: string[], t: WeaponWords): string {
  const allowed = WEAPON_SKILLS.filter((w) => !excluded.includes(w));
  return !excluded.length ? t.any : !allowed.length ? t.none : allowed.length === 1 ? t.only(allowed[0]!) : t.some(WEAPON_SKILLS.filter((w) => excluded.includes(w)));
}
export const weaponsSummary = (excluded: string[] = []): string =>
  weaponsText(excluded, { any: "any weapon", none: "no weapons", only: (w) => `${w} weapons only`, some: (ex) => `no ${orList(ex)} weapons` });
export const weaponsChipText = (excluded: string[] = []): string =>
  weaponsText(excluded, { any: "Weapons: any", none: "Weapons: none", only: (w) => `Weapons: ${weaponName(w)} only`, some: (ex) => `Weapons: ${ex.length} excluded` });
// Ticking or unticking a skill; the list stays in WEAPON_SKILLS order, so the same exclusions always read the same.
export const toggleWeapon = (excluded: string[], w: string, on: boolean): string[] => WEAPON_SKILLS.filter((x) => (x === w ? on : excluded.includes(x)));

// ---------------------------------------------------------------- resist caps
// A resist's cap for a build is the shard's (race-aware) unless the player overrode it. The field takes a whole
// paperdoll number in RESIST_CAP_LIMITS; setting it back to the shard's value removes the override, so a
// profile only ever stores the caps that really differ.
export const resistCapError = (raw: string): string | null => rangeError(raw, { ...RESIST_CAP_LIMITS, whole: true });
export function withResistCap(overrides: Record<string, number> = {}, k: string, value: number, shard: number): Record<string, number> {
  const next = { ...overrides };
  if (value === shard) delete next[k]; else next[k] = value;
  return next;
}
// After a race change: an override that now equals the new race's shard cap is no override (a human's Energy 75
// becomes an Elf's own cap), so it is dropped rather than saved and reported as template drift.
export function pruneResistCaps(overrides: Record<string, number> = {}, race: string | null | undefined): Record<string, number> {
  return Object.fromEntries(Object.entries(overrides).filter(([k, v]) => v !== shardResistCap(k, race)));
}
// A resist requirement counts only up to that resist's cap (effectiveProfile clamps it for the solver), so every
// view that says whether one is met compares against min(floor, cap). Anything else is its floor as set.
export function effectiveFloor(k: string, floor: number, caps: Record<string, number>): number {
  return RESIST_KEYS.includes(k) && caps[k] != null ? Math.min(floor, caps[k]!) : floor;
}
// The requirement row's warning when its floor is past its resist's cap: "Counts only up to the Fire cap, 70".
export function floorCapWarning(k: string, floor: number, cap: number | null): string | null {
  return RESIST_KEYS.includes(k) && cap != null && floor > cap ? `Counts only up to the ${labelOf(k)} cap, ${cap}` : null;
}
// "raised from 70" / "lowered from 70", or null when the cap is the shard's.
export function capNote(c: ResistCap): string | null {
  if (c.cap === c.shard) return null;
  return `${c.cap > c.shard ? "raised" : "lowered"} from ${c.shard}`;
}
const overridden = (view: Record<string, ResistCap>): string[] => RESIST_KEYS.filter((k) => view[k] && view[k]!.cap !== view[k]!.shard);
// The collapsed section's line: "Shard caps: 70 each" (with a race's exception, "70, Energy 75"), or the overrides
// ("Fire 95 (raised from 70) · the rest at the shard's cap").
export function resistCapsSummary(view: Record<string, ResistCap>): string {
  const set = overridden(view);
  if (set.length) {
    const rest = RESIST_KEYS.length - set.length;
    return [...set.map((k) => `${labelOf(k)} ${view[k]!.cap} (${capNote(view[k]!)})`), rest ? `${rest === 1 ? "the other one" : "the rest"} at the shard's cap` : ""].filter(Boolean).join(" · ");
  }
  const { common, odd } = commonAndOdd(RESIST_KEYS.map((k): [string, number] => [k, view[k]!.cap]));
  return `Shard caps: ${odd.length ? [common, ...odd].join(", ") : `${common} each`}`;
}
// The most common value of the five and the others by name: { common: 70, odd: ["Energy 75"] }.
function commonAndOdd(pairs: Array<[string, number]>): { common: number; odd: string[] } {
  const count = new Map<number, number>();
  for (const [, v] of pairs) count.set(v, (count.get(v) || 0) + 1);
  const common = [...count.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]![0];
  return { common, odd: pairs.filter(([, v]) => v !== common).map(([k, v]) => `${labelOf(k)} ${v}`) };
}
// The Requirements section's note, in item terms: what gear has to supply under each cap once Resisting Spells
// has given its bonus. "so gear supplies up to 30 (Fire 55, Energy 35)".
export function gearCapsText(view: Record<string, ResistCap>, rsb: number): string {
  const { common, odd } = commonAndOdd(RESIST_KEYS.map((k): [string, number] => [k, Math.max(0, view[k]!.cap - rsb)]));
  return `so gear supplies up to ${common}${odd.length ? ` (${odd.join(", ")})` : ""}`;
}
// A result's line about its caps, for the compare view: "Fire 95 (raised from 70)", or "Shard caps".
export function capsLine(view: Record<string, ResistCap>): string {
  const set = overridden(view);
  return set.length ? set.map((k) => `${labelOf(k)} ${view[k]!.cap} (${capNote(view[k]!)})`).join(" · ") : "Shard caps";
}
export const anyOverridden = (view: Record<string, ResistCap>): boolean => overridden(view).length > 0;

// ---------------------------------------------------------------- Advanced: the solver knobs
// The ranges the server accepts (app/vault-server.mts's OPTS_LIMITS; app/server.test.mts checks this copy
// agrees). The page asks for the time budget in seconds, and a budget of 0 would leave the exact search no
// time at all, so its field starts at 1.
export const SOLVER_LIMITS = { restarts: { min: 1, max: 10000 }, timeBudgetMs: { min: 0, max: 60 * 60 * 1000 }, alternativesCount: { min: 0, max: 100 } } as const;
export interface Knobs { strLimit: string; restarts: string; exact: boolean; budgetS: string; altCount: string; altTol: string }
export type KnobField = Exclude<keyof Knobs, "exact">;
interface Range { min: number; max?: number | undefined; whole: boolean }
export const KNOB_RANGES: Record<KnobField, Range> = {
  strLimit: { min: 1, max: 1000, whole: true },
  restarts: { min: SOLVER_LIMITS.restarts.min, max: SOLVER_LIMITS.restarts.max, whole: true },
  budgetS: { min: 1, max: SOLVER_LIMITS.timeBudgetMs.max / 1000, whole: true },
  altCount: { min: SOLVER_LIMITS.alternativesCount.min, max: SOLVER_LIMITS.alternativesCount.max, whole: true },
  altTol: { min: 0, whole: false },
};
// The field's error in plain words with the allowed range, or null when the value is fine.
export function rangeError(raw: string, r: Range): string | null {
  const t = raw.trim(), v = Number(t);
  const ok = t !== "" && Number.isFinite(v) && (!r.whole || Number.isInteger(v)) && v >= r.min && (r.max == null || v <= r.max);
  if (ok) return null;
  if (r.max != null) return `Enter a ${r.whole ? "whole " : ""}number from ${num(r.min)} to ${num(r.max)}.`;
  return `Enter a ${r.whole ? "whole " : ""}number of ${num(r.min)} or more.`;
}
export const knobError = (field: KnobField, raw: string): string | null => rangeError(raw, KNOB_RANGES[field]);
// A requirement or weight value: any number.
export const ruleValueError = (raw: string): string | null => (raw.trim() !== "" && Number.isFinite(Number(raw)) ? null : "Enter a number.");
// The first knob that is wrong, in the order the fields are drawn.
export function firstKnobError(k: Knobs): { field: KnobField; error: string } | null {
  for (const field of ["strLimit", "restarts", "budgetS", "altCount", "altTol"] as KnobField[]) {
    if (!k.exact && (field === "budgetS" || field === "altCount" || field === "altTol")) continue;   // not sent without exact search
    const error = knobError(field, k[field]);
    if (error) return { field, error };
  }
  return null;
}
// Which field a server refusal is about ("opts.restarts must be an integer between 1 and 10000").
export function knobFromServerError(text: string): KnobField | null {
  if (/opts\.restarts/.test(text)) return "restarts";
  if (/opts\.timeBudgetMs/.test(text)) return "budgetS";
  if (/opts\.alternatives\.count/.test(text)) return "altCount";
  if (/opts\.alternatives\.tolerance/.test(text)) return "altTol";
  if (/strLimit/.test(text)) return "strLimit";
  return null;
}
// "Exact · 10,000 restarts · 300 s · 5 other suits within 40" (STR limit is not under Advanced: it has its
// own field beside Race)
export function advancedSummary(k: Knobs): string {
  const n = (s: string): number => Number(s);
  return [
    k.exact ? "Exact" : "Heuristic",
    `${plural(n(k.restarts), "restart")}`,
    k.exact ? `${num(n(k.budgetS))} s` : "",
    k.exact && n(k.altCount) > 0 ? `${plural(n(k.altCount), "other suit")} within ${num(n(k.altTol))}` : "",
  ].filter(Boolean).join(" · ");
}

// ---------------------------------------------------------------- result
export type Tone = "ok" | "warn" | "bad" | "muted";
// A resist tile's outcome line, in paperdoll values: short of the requirement, over or at the cap, or met.
export function resistOutcome(after: number, floor: number | null | undefined, cap: number): { text: string; tone: Tone } {
  if (floor != null && after < floor) return { text: `${floor - after} short`, tone: "warn" };
  if (after > cap) return { text: `${after - cap} over cap`, tone: "muted" };
  if (after === cap) return { text: "At cap", tone: "ok" };
  if (floor != null) return { text: `Meets ${floor}`, tone: "ok" };
  return { text: `${cap - after} below cap`, tone: "muted" };
}
// A Fetch list row's place as its path of containers ("Dorran's bank › Metal Chest (0x…) › A Bag", vault-lib's
// locationOf text), one crumb each, so the row can wrap it whole instead of cutting it short.
export function locationCrumbs(text: string | null | undefined): string[] {
  const parts = (text || "").split(" › ").map((p) => p.trim()).filter(Boolean);
  return parts.length ? parts : ["Unknown place"];
}
// The result's other changes, as badges: every requirement or weighted property (resists have their own
// tiles) whose total moves, gains first. A requirement the suit misses is a loss whatever its direction.
export function otherChanges(keys: string[], before: PropMap, after: PropMap, caps: Record<string, number>, floors: Record<string, number> = {}): Array<{ text: string; tone: "ok" | "bad" }> {
  const rows = [...new Set(keys)].filter((k) => k !== "tagPenalty" && !RESIST_KEYS.includes(k)).flatMap((k) => {
    const b = before[k] || 0, a = after[k] || 0, cap = caps[k], floor = floors[k];
    const missed = floor != null && a < floor;
    if (a === b && !missed) return [];
    const text = `${labelOf(k)} ${num(b)} → ${num(a)}${cap != null ? ` / ${num(cap)}` : ""}${missed ? ` (needs ${num(floor)})` : ""}`;
    return [{ k, text, tone: (a > b && !missed ? "ok" : "bad") as "ok" | "bad" }];
  });
  return rows.sort((x, y) => (x.tone === y.tone ? labelOf(x.k).localeCompare(labelOf(y.k)) : x.tone === "ok" ? -1 : 1)).map(({ text, tone }) => ({ text, tone }));
}
// "<name> after the change": the attributes and pools, the ones that move first. The scan's attributes are
// totals with the current suit on, so after = total + the change in the bonus; the pools follow the sheet's
// estimate (STR/2 + HP Increase, DEX + Stamina Increase, INT + Mana Increase).
export interface AfterRow { key: string; label: string; before: number | null; after: number | null; delta: number }
export function afterChange(stats: Record<string, unknown>, maxes: Record<string, unknown>, before: PropMap, after: PropMap): AfterRow[] {
  const d = (k: string): number => (after[k] || 0) - (before[k] || 0);
  const val = (v: unknown): number | null => (v != null && Number.isFinite(Number(v)) ? Number(v) : null);
  const rows: AfterRow[] = ([
    ["str", "Strength", stats, d("strBonus")], ["hits", "Hits", maxes, Math.floor(d("strBonus") / 2) + d("hpi")],
    ["stam", "Stamina", maxes, d("dexBonus") + d("stamInc")], ["mana", "Mana", maxes, d("intBonus") + d("manaInc")],
    ["dex", "Dexterity", stats, d("dexBonus")], ["int", "Intelligence", stats, d("intBonus")],
  ] as Array<[string, string, Record<string, unknown>, number]>).map(([key, label, src, delta]) => {
    const now = val(src[key]);
    return { key, label, before: now, after: now == null ? null : now + delta, delta };
  });
  return [...rows.filter((r) => r.delta !== 0), ...rows.filter((r) => r.delta === 0)];
}

// ---------------------------------------------------------------- compare
// 2-3 suits (or saved runs) side by side. A piece row differs when not every suit wears the same piece in
// that slot, and a cell is marked when it differs from the first suit's. A total row differs when the values
// are not all equal; its best cells are the highest value, where anything past the property's cap counts as
// the cap (70 fire and 86 fire are equally good). Differences only hides the rows that agree and lists them.
// A member's own caps (a saved run built with other resist caps than the others) decide its best values; else the
// shared caps do.
export interface CompareMember { assignment: Partial<Record<string, { serial: number; name: string } | null | undefined>>; totals: PropMap; caps?: Record<string, number> | undefined }
export interface ComparePieceRow { slot: string; label: string; cells: Array<{ text: string; diff: boolean }> }
export interface CompareTotalRow { key: string; label: string; values: number[]; best: boolean[] }
export interface CompareModel { pieces: ComparePieceRow[]; totals: CompareTotalRow[]; hiddenTotals: string[]; hiddenPieces: number }
export function compareModel(members: CompareMember[], slots: string[], keys: string[], caps: Record<string, number>, differencesOnly = true): CompareModel {
  const pieces: ComparePieceRow[] = [];
  let hiddenPieces = 0;
  for (const slot of slots) {
    const serials = members.map((m) => m.assignment[slot]?.serial || 0);
    const differs = serials.some((s) => s !== serials[0]);
    if (!differs && differencesOnly) { hiddenPieces++; continue; }
    pieces.push({ slot, label: SLOT_LABELS[slot] || slot, cells: members.map((m, i) => ({ text: m.assignment[slot]?.name || "nothing", diff: i > 0 && serials[i] !== serials[0] })) });
  }
  const totals: CompareTotalRow[] = [], hiddenTotals: string[] = [];
  for (const key of [...new Set(keys)].filter((k) => k !== "tagPenalty")) {
    const values = members.map((m) => m.totals[key] || 0);
    const same = values.every((v) => v === values[0]);
    if (same && differencesOnly) { hiddenTotals.push(propName(key)); continue; }
    const eff = values.map((v, i) => { const cap = (members[i]!.caps || caps)[key]; return cap != null ? Math.min(v, cap) : v; });
    const top = Math.max(...eff), tie = eff.every((v) => v === eff[0]);
    totals.push({ key, label: propName(key), values, best: eff.map((v) => !tie && v === top) });
  }
  return { pieces, totals, hiddenTotals, hiddenPieces };
}
// The compare footer: "Rows where all three agree are hidden: Fire resist, Cold resist, …".
export function hiddenRowsNote(count: number, hidden: string[], hiddenPieces: number, shown = 8): string {
  const who = count === 2 ? "both" : count === 3 ? "all three" : `all ${count}`;
  const names = [...(hiddenPieces ? [plural(hiddenPieces, "slot")] : []), ...hidden];
  if (!names.length) return "";
  const list = names.length > shown ? `${names.slice(0, shown).join(", ")} and ${names.length - shown} more` : names.join(", ");
  return `Rows where ${who} agree are hidden: ${list}`;
}
// Ticking a suit or run for comparison: at most `max`, and a tick past that is refused with a reason
// instead of silently disabling Compare.
export function toggleCompare(selected: ReadonlySet<string>, id: string, on: boolean, max = 3, noun = "runs"): { next: Set<string>; refused: string | null } {
  const next = new Set(selected);
  if (!on) { next.delete(id); return { next, refused: null }; }
  if (!next.has(id) && next.size >= max) return { next, refused: `Up to ${max} ${noun}` };
  next.add(id);
  return { next, refused: null };
}

// ---------------------------------------------------------------- saved runs
// A run's name when the player gave it none: how its settings differ from the run saved before it.
export function runAutoLabel(prev: RunSettings | null, settings: RunSettings): { text: string; diff: string[] } {
  if (!prev) return { text: "First saved run", diff: [] };
  const diff = settingsDiff(prev, settings);
  if (!diff.length) return { text: "Same settings as the run before", diff };
  const head = diff.slice(0, 3).join(" · ") + (diff.length > 3 ? ` · ${diff.length - 3} more` : "");
  return { text: head[0]!.toUpperCase() + head.slice(1), diff };
}
// A run's badges: its change count, how many requirements its suit meets, and the five resists in
// paperdoll values (item totals + the character's Resisting Spells bonus, clipped at each cap); a resist requirement
// is met at its cap when set above it, as the solver scored it. A resist whose cap
// the run overrode says so: "Fire 90 · cap 95".
export function runBadges(changes: number | null | undefined, totals: PropMap | null | undefined, floors: Record<string, number>, rsb: number, caps: Record<string, number>, shardCaps: Record<string, number> = caps): Array<{ text: string; tone?: "ok" | "warn" | undefined }> {
  const out: Array<{ text: string; tone?: "ok" | "warn" | undefined }> = [];
  if (changes != null) out.push({ text: plural(changes, "change") });
  if (!totals) return out;
  const pd = (k: string, v: number): number => (RESIST_KEYS.includes(k) ? v + rsb : v);
  const floorKeys = Object.keys(floors);
  if (floorKeys.length) {
    const met = floorKeys.filter((k) => pd(k, totals[k] || 0) >= effectiveFloor(k, floors[k]!, caps)).length;
    out.push({ text: `${met} of ${floorKeys.length} met`, tone: met === floorKeys.length ? "ok" : "warn" });
  }
  for (const k of RESIST_KEYS) {
    const cap = caps[k] ?? 70;
    out.push({ text: `${labelOf(k)} ${Math.min(cap, pd(k, totals[k] || 0))}${cap !== (shardCaps[k] ?? cap) ? ` · cap ${cap}` : ""}` });
  }
  return out;
}
