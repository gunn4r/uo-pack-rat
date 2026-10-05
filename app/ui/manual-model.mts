// ui/manual-model.mts — the Suit Builder's Manual mode, its pure logic (issue #12): the totals strip's keys and the
// line under each total, the slot groups, the picker's slot filter, the one-hand/two-hand rule, a saved suit read
// back, the slots whose piece left the scans, a picker row's delta ("LRC +20 → 77"), the suit's undo history and
// keys, and the hand-offs with Automatic (a result into the suit, the pieces to fetch). No DOM and no page state, so
// app/manual-model.test.mts checks it directly; ui/builder-manual.mts draws what it returns.
import { RESIST_KEYS, GEAR_SLOTS, OPTIMIZER_SLOTS, labelOf } from "../vault-lib.mts";
import type { PropMap } from "../vault-lib.mts";
import type { ItemQuery } from "../item-query.mts";

const num = (n: number): string => n.toLocaleString("en-US", { maximumFractionDigits: 2 });

// ---------------------------------------------------------------- the totals strip
// The five resists, then the casting and combat totals, then the stats.
export const TOTAL_KEYS = ["lrc", "lmc", "fc", "fcr", "ssi", "dci", "hci", "di"];
export const STAT_KEYS = ["strBonus", "dexBonus", "intBonus"];
export const STRIP_KEYS = [...RESIST_KEYS, ...TOTAL_KEYS, ...STAT_KEYS];

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
// Manual's slot cards: every slot the classifier knows (GEAR_SLOTS), grouped as on the paperdoll, in two columns of
// nine (armor and weapons, then clothing and jewelry). A test checks the groups hold GEAR_SLOTS exactly, so a slot the
// classifier gains has to be placed here.
export const MANUAL_GROUPS: Array<Array<[string, string[]]>> = [
  [["Armor", ["helmet", "neck", "chest", "arms", "hands", "legs", "feet"]], ["Weapons", ["oneHanded", "twoHanded"]]],
  [["Clothing", ["shirt", "tunic", "robe", "waist", "cloak"]], ["Jewelry", ["ring", "bracelet", "earrings", "talisman"]]],
];
// The picker's fixed filter for a slot. An item's slot is one of GEAR_SLOTS as is, so it is that slot alone:
// "twoHanded" holds two-handed weapons and shields alike.
export const slotQuery = (slot: string): Partial<ItemQuery> => ({ slot: [slot] });

// The one-hand/two-hand rule, as the optimizer applies it (optimizer-core.mts's optIsValidAssignment): a two-handed
// weapon in the twoHanded slot rules out anything in oneHanded, while a shield goes with a one-handed weapon. The slot a
// pick clears, or null. `suit` has an entry for every filled slot: a piece no longer in the scans is `{}`, which still
// fills its hand but is never known to be two-handed.
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
  return Object.fromEntries(GEAR_SLOTS.flatMap((s) => {
    const v = (raw as Record<string, unknown>)[s];
    return typeof v === "number" && Number.isInteger(v) && v > 0 ? [[s, v]] : [];
  }));
}
// The slots whose saved serial no longer resolves to an item (rescanned away, sold, forgotten), in GEAR_SLOTS order.
export const missingSlots = (slots: Record<string, number>, found: Record<number, unknown>): string[] =>
  GEAR_SLOTS.filter((s) => slots[s] != null && !found[slots[s]!]);

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
// strip's terms (builder-model.mts's paperdoll).
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

// ---------------------------------------------------------------- undo and redo
// The manual suit's history: each change to it is one step (a pick, with the hand rule's clear in the same step; a
// Clear; Clear all; Start from what <name> wears; a buff turned on or off), kept 40 back. A step holds the state
// before and after it (Manual's: the suit and its buffs). Undo returns the step to apply its `before`; redo its
// `after`. A new change after an undo drops what could have been redone; a change that changes nothing is no step.
export type Suit = Record<string, number>;
export interface Step<T = Suit> { before: T; after: T; label: string }
export interface History<T = Suit> { past: Array<Step<T>>; future: Array<Step<T>> }
export const HISTORY_MAX = 40;
export const emptyHistory = <T = Suit,>(): History<T> => ({ past: [], future: [] });
// Equal states, whatever order their keys were written in.
const canon = (v: unknown): string => JSON.stringify(v, (_k, x: unknown) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x));
export function record<T>(h: History<T>, before: T, after: T, label: string): History<T> {
  if (canon(before) === canon(after)) return h;
  return { past: [...h.past, { before, after, label }].slice(-HISTORY_MAX), future: [] };
}
export function undoStep<T>(h: History<T>): { history: History<T>; step: Step<T> } | null {
  const step = h.past[h.past.length - 1];
  return step ? { history: { past: h.past.slice(0, -1), future: [step, ...h.future] }, step } : null;
}
export function redoStep<T>(h: History<T>): { history: History<T>; step: Step<T> } | null {
  const [step, ...rest] = h.future;
  return step ? { history: { past: [...h.past, step], future: rest }, step } : null;
}
// The undo and redo keys: ⌘Z and ⇧⌘Z on a Mac; Ctrl+Z, Ctrl+Y and Ctrl+Shift+Z elsewhere. Alt never.
interface KeyLike { key: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }
export function historyKey(e: KeyLike, mac: boolean): "undo" | "redo" | null {
  const mod = mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey, k = e.key.toLowerCase();
  if (!mod || e.altKey) return null;
  if (k === "z") return e.shiftKey ? "redo" : "undo";
  return !mac && k === "y" && !e.shiftKey ? "redo" : null;
}
// The keys' names on this platform, for the buttons' tooltips.
export const historyKeyNames = (mac: boolean): { undo: string; redo: string } => (mac ? { undo: "⌘Z", redo: "⇧⌘Z" } : { undo: "Ctrl+Z", redo: "Ctrl+Y" });

// ---------------------------------------------------------------- hand-offs with Automatic
// A result's or a saved run's suit into Manual's ("Start from this result", "Open in Manual"): each slot it plans
// (`covered`) takes its piece or is emptied, and every other slot keeps its own.
export function suitFrom(current: Suit, best: Partial<Record<string, { serial: number } | null>>, covered: readonly string[]): Suit {
  const next = { ...current };
  for (const s of covered) { const it = best[s]; if (it) next[s] = it.serial; else delete next[s]; }
  return next;
}
// The search's slots that are empty: "Fill the rest automatically" fills these, less the one-hand slot beside a
// two-handed weapon. A slot the search has no slot for (feet, robe…) is never one.
export function fillableSlots(suit: Suit, twoHanded: boolean): string[] {
  return OPTIMIZER_SLOTS.filter((s) => suit[s] == null && !(s === "oneHanded" && twoHanded));
}
// Buff numbers an undo step set for one character (`who`) by key, null for "back to the character's own": applied key
// by key, and only where the number is still the one the other side of the step left (`expect`), so undoing a step
// never takes back a number edited after it.
export type EditMap = Record<string, Record<string, number>>;
export interface EditStep { who: string; values: Record<string, number | null> }
export function applyEditStep(all: EditMap, who: string, expect: Record<string, number | null>, set: Record<string, number | null>): EditMap {
  const mine = { ...(Object.hasOwn(all, who) ? all[who] : {}) };
  let moved = false;
  for (const [k, v] of Object.entries(set)) {
    if ((mine[k] ?? null) !== (expect[k] ?? null) || (mine[k] ?? null) === v) continue;
    if (v == null) delete mine[k]; else mine[k] = v;
    moved = true;
  }
  return moved ? { ...all, [who]: mine } : all;
}
// "Fill the rest": what a search started from (whose suit, the buffs the totals counted, the suit and its empty slots,
// and `plan`, a key of what it planned with: the profile, the buff numbers in it, the pool settings) and its answer
// against Manual now. Stale, with why, when any of them changed meanwhile (a character switched, a buff or the Count
// switch flipped, a piece placed or cleared, a requirement, weight or buff number edited); else the found pieces for the slots that were empty, never
// a placed piece again.
export interface FillStart { who: string | null; buffs: string[]; suit: Suit; plan: string; empty: string[] }
export function fillPicks(start: FillStart, now: Omit<FillStart, "empty">, best: Partial<Record<string, { serial: number } | null>>): { stale: string } | { picks: Suit } {
  if (start.who !== now.who) return { stale: "Fill canceled: the character changed" };
  if (start.buffs.join() !== now.buffs.join()) return { stale: "Fill canceled: the buffs changed" };
  const keys = Object.keys(start.suit);
  if (keys.length !== Object.keys(now.suit).length || keys.some((s) => start.suit[s] !== now.suit[s])) return { stale: "Fill canceled: the suit changed" };
  if (start.plan !== now.plan) return { stale: "Fill canceled: the settings changed" };
  const placed = new Set(Object.values(start.suit));
  return { picks: Object.fromEntries(start.empty.flatMap((s) => { const it = best[s]; return it && !placed.has(it.serial) ? [[s, it.serial]] : []; })) };
}
// "Waist", "Waist and Earrings", "Feet, Waist and Earrings".
export const listWords = (xs: readonly string[]): string => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
// Start from this result: the filled slots it leaves as they were (Manual's feet, robe and so on), by name.
export const keptSlots = (suit: Suit, covered: readonly string[]): string[] => Object.keys(suit).filter((s) => !covered.includes(s));
// The fetch list's pieces: those the character doesn't wear, every piece with No character (`name` null).
export const fetchPieces = <T extends { equippedBy?: string | null | undefined }>(pieces: T[], name: string | null): T[] =>
  pieces.filter((it) => !name || it.equippedBy !== name);
