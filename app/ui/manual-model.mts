// ui/manual-model.mts — the Suit Builder's Manual mode, its pure logic (issue #12): the totals strip's keys and the
// line under each total, the caps it measures against, the picker's slot filter, the one-hand/two-hand rule, a
// saved suit read back, the slots whose piece left the scans, and a picker row's delta ("LRC +20 → 77"). No DOM and
// no page state, so app/manual-model.test.mts checks it directly; ui/builder-manual.mts draws what it returns.
import { RESIST_KEYS, OPTIMIZER_SLOTS, labelOf, profileResistCaps } from "../vault-lib.mts";
import type { EffectiveProfile, PropMap } from "../vault-lib.mts";
import type { ItemQuery } from "../item-query.mts";

const num = (n: number): string => n.toLocaleString("en-US", { maximumFractionDigits: 2 });

// ---------------------------------------------------------------- the totals strip
// The five resists, then the casting and combat totals, then the stats.
export const TOTAL_KEYS = ["lrc", "lmc", "fc", "fcr", "ssi", "dci", "hci", "di"];
export const STAT_KEYS = ["strBonus", "dexBonus", "intBonus"];
export const STRIP_KEYS = [...RESIST_KEYS, ...TOTAL_KEYS, ...STAT_KEYS];

// Resists in paperdoll terms: the item totals plus the character's Resisting Spells bonus (0 with no character).
export function paperdollTotals(totals: PropMap, rsb: number): PropMap {
  const t = { ...totals };
  for (const k of RESIST_KEYS) t[k] = (t[k] || 0) + rsb;
  return t;
}
// What the strip and the deltas measure against: the shard's caps, with each resist's in paperdoll terms (the
// player's override, else the race's cap).
export function manualCaps(prof: EffectiveProfile): Record<string, number> {
  const caps = { ...prof.caps }, resists = profileResistCaps(prof);
  for (const k of RESIST_KEYS) caps[k] = resists[k]!.cap;
  return caps;
}
// A total as the strip shows it: capped, with what is wasted past the cap.
export function capped(value: number, cap: number | null | undefined): { shown: number; wasted: number } {
  return cap == null ? { shown: value, wasted: 0 } : { shown: Math.min(value, cap), wasted: Math.max(0, value - cap) };
}
// The line under a total: "+9 wasted", "At cap", "23 to cap", "No cap", or "Nothing yet".
export function capLine(value: number, cap: number | null | undefined): { text: string; tone: "ok" | "warn" | "muted" } {
  if (!value) return { text: "Nothing yet", tone: "muted" };
  if (cap == null) return { text: "No cap", tone: "muted" };
  if (value > cap) return { text: `+${num(value - cap)} wasted`, tone: "warn" };
  if (value === cap) return { text: "At cap", tone: "ok" };
  return { text: `${num(cap - value)} to cap`, tone: "muted" };
}

// ---------------------------------------------------------------- slots
// The picker's fixed filter for a slot. An item's slot is one of OPTIMIZER_SLOTS as is, so it is that slot alone:
// "twoHanded" holds two-handed weapons and shields alike.
export const slotQuery = (slot: string): Partial<ItemQuery> => ({ slot: [slot] });

// The one-hand/two-hand rule, as the optimizer applies it (optimizer-core.mts's optIsValidAssignment): a two-handed
// weapon in the twoHanded slot rules out anything in oneHanded, while a shield goes with a one-handed weapon. The slot a
// pick clears, or null.
interface Held { twoHanded?: boolean | null | undefined }
export function handConflict(slot: string, pick: Held, suit: Partial<Record<string, Held | null | undefined>>): string | null {
  if (slot === "twoHanded" && pick.twoHanded && suit.oneHanded) return "oneHanded";
  if (slot === "oneHanded" && suit.twoHanded?.twoHanded) return "twoHanded";
  return null;
}
// The status line after a pick cleared a slot.
export const handNote = (removed: string, slotName: string): string => `${removed} left ${slotName}: a two-handed weapon takes both hands.`;

// A saved suit (ui-prefs `manualSuit`) as the page uses it: only the slots it knows, each a whole serial.
export function savedSlots(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return Object.fromEntries(OPTIMIZER_SLOTS.flatMap((s) => {
    const v = (raw as Record<string, unknown>)[s];
    return typeof v === "number" && Number.isInteger(v) && v > 0 ? [[s, v]] : [];
  }));
}
// The slots whose saved serial no longer resolves to an item (rescanned away, sold, forgotten), in slot order.
export const missingSlots = (slots: Record<string, number>, found: Record<number, unknown>): string[] =>
  OPTIMIZER_SLOTS.filter((s) => slots[s] != null && !found[slots[s]!]);

// ---------------------------------------------------------------- a picker row's delta
// The properties a row's delta speaks about: the strip's, then any other with a floor or a weight in the profile.
export function deltaKeys(prof: { floors?: Record<string, number>; weights?: Record<string, number> }): string[] {
  const more = [...new Set([...Object.keys(prof.floors || {}), ...Object.keys(prof.weights || {})])]
    .filter((k) => k !== "tagPenalty" && !STRIP_KEYS.includes(k)).sort((a, b) => labelOf(a).localeCompare(labelOf(b)));
  return [...STRIP_KEYS, ...more];
}
export interface DeltaPart { key: string; text: string; tone: "ok" | "bad" | "muted" }
// What putting a row in the slot changes, for each of `keys` that moves: "LRC +20 → 77" (the change in what counts,
// up to the cap, and the new capped total), a gain in the ok tone and a loss in the bad one; a change that lies
// wholly past the cap counts for nothing and reads "LMC +8 over cap", muted. `before` and `after` are in the
// strip's terms (paperdollTotals).
export function slotDelta(before: PropMap, after: PropMap, keys: string[], caps: Record<string, number | undefined>): DeltaPart[] {
  return keys.flatMap((k): DeltaPart[] => {
    const b = before[k] || 0, a = after[k] || 0;
    if (a === b) return [];
    const was = capped(b, caps[k]).shown, now = capped(a, caps[k]).shown;
    const sign = (d: number): string => `${d > 0 ? "+" : "−"}${num(Math.abs(d))}`;
    if (now === was) return [{ key: k, text: `${labelOf(k)} ${sign(a - b)} over cap`, tone: "muted" }];
    return [{ key: k, text: `${labelOf(k)} ${sign(now - was)} → ${num(now)}`, tone: now > was ? "ok" : "bad" }];
  });
}
