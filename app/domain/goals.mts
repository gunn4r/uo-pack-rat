// domain/goals.mts — the Suit Builder's goals (issue #292): ranks of properties to get as high as the gear allows, what spare points go to, a swing-speed goal and the strategy; compileGoals turns them into the profile's weights through the importance conversion, goalsError is the check wherever they are stored or sent, and goalsText/goalLabel name them.
//
// map: builder
// owns: `Goals`, `compileGoals`, `goalsError`, `goalsActive`, `goalsText`, `goalLabel`, `copyGoals`, `GOAL_STRATEGIES`, `STRATEGY_HELP`, `RANK_IMPORTANCE`, `LEFTOVER_GROUPS`
import { delayText } from "../swing.mts";
import { NOT_BUILDER_KEYS, PROP_LABELS, propName, SKILL_SET, weightOfImportance } from "./properties.mts";

// Goals (issue #292): the properties to get as high as the gear allows, up to each one's cap, most important first, a rank
// holding two or more that count the same; what spare points go to; and for a Swing speed goal, the fastest swing or a
// swing every `seconds` (the SSI that takes with the weapon worn now caps SSI, app/build-spec.mts planBuild). `ownWeights`:
// the weights were edited by hand since the goals set them, so the goals are kept only to start from again. Goals compile
// to the profile's weights through the importance conversion above (compileGoals), so the solvers, saved runs and every
// reader that knows only weights are unchanged.
export const GOAL_LEFTOVERS = ["luck", "melee", "caster", "none"] as const;
export type GoalLeftover = (typeof GOAL_LEFTOVERS)[number];
export const SWING_GOALS = ["fastest", "every"] as const;
export interface GoalSwing { mode: (typeof SWING_GOALS)[number]; seconds?: number | undefined }
// strategy: "value" (absent means it too) can trade a small loss up top for a big gain lower down, through the compiled
// weights; "strict" never gives up a higher goal for a lower one (a staged solve, opts.strict). fewestChanges: among
// suits as good, the fewest slots changed from what is worn now (the tie-break's first part).
export const GOAL_STRATEGIES = ["value", "strict"] as const;
// What each strategy means, in the Goals tab, How the goals went and build_suit's description.
export const STRICT_PROMISE = "A higher goal is never given up for a lower one.";
export const STRATEGY_HELP: Record<(typeof GOAL_STRATEGIES)[number], string> = { value: "Higher goals count more, but a small loss up top can buy a big gain lower down.", strict: `${STRICT_PROMISE} Requirements come before every goal.` };
// What Change as few pieces as possible does in each strategy: Best value breaks exact ties, Strict order solves it after the goals.
// Under How the goals went when a strict suit wears a tagged piece the worn suit doesn't.
export const TAGGED_NOTE = "Strict order takes tagged pieces (Cursed, Antique…) when they help a goal. To keep them out, use Exclude tags in the Pool tab.";
export const FEWEST_HELP: Record<(typeof GOAL_STRATEGIES)[number], string> = { value: "Finally, among equally good suits, keep the most of what you wear.", strict: "After the goals, keep the most of what you wear, before tagged pieces and spare points." };
export interface Goals { ranks: string[][]; swing?: GoalSwing | undefined; leftover: GoalLeftover; strategy?: (typeof GOAL_STRATEGIES)[number] | undefined; fewestChanges?: boolean | undefined; ownWeights?: boolean | undefined }
// What a rank counts on the importance scale: the first 100, the second 80, and so on, 15 for every rank from the ninth.
export const RANK_IMPORTANCE: readonly number[] = [100, 80, 65, 50, 40, 30, 25, 20, 15];
export const rankImportance = (rank: number): number => RANK_IMPORTANCE[Math.min(rank, RANK_IMPORTANCE.length - 1)]!;
// Spare points get a low importance, so their group only takes what the goals leave.
export const LEFTOVER_IMPORTANCE = 5;
export const LEFTOVER_GROUPS: Record<GoalLeftover, readonly string[]> = { luck: ["luck"], melee: ["strBonus", "dexBonus", "stamInc", "hpRegen"], caster: ["intBonus", "manaInc", "manaRegen", "lmc", "lrc"], none: [] };
export const LEFTOVER_LABELS: Record<GoalLeftover, string> = { luck: "Luck", melee: "Melee stats", caster: "Caster stats", none: "Nothing" };
// Whether goals set the profile's weights: there are goals, and the weights were not edited by hand since.
export const goalsActive = (g: Goals | null | undefined): g is Goals => !!g && !g.ownWeights;
// The weights goals set, and whether SSI is scored by swing step (when Swing speed is a goal): each rank's properties at
// that rank's importance, then the spare-points group's properties that are not goals at LEFTOVER_IMPORTANCE. A weight the
// builder never offers (the tag penalty) is kept from `kept`, the profile's weights. A weight is rounded to 12 significant
// digits, so DI's 65 is 2.925 per point rather than 2.9250000000000003.
export function compileGoals(g: Goals, kept: Readonly<Record<string, number>> = {}): { weights: Record<string, number>; swingSteps: boolean } {
  const weights: Record<string, number> = Object.fromEntries(Object.entries(kept).filter(([k]) => NOT_BUILDER_KEYS.has(k)));
  const per = (k: string, importance: number): number => Number(weightOfImportance(k, importance).toPrecision(12));
  g.ranks.forEach((rank, i) => { for (const k of rank) weights[k] = per(k, rankImportance(i)); });
  const goal = new Set(g.ranks.flat());
  for (const k of LEFTOVER_GROUPS[g.leftover]) if (!goal.has(k)) weights[k] = per(k, LEFTOVER_IMPORTANCE);
  return { weights, swingSteps: goal.has("ssi") };
}
// Goals in a line, for a settings diff: "Swing speed every 1.5 s › Hit chance = Defense chance › Damage, spare points to luck".
export function goalsText(g: Goals): string {
  return `${g.ranks.map((r) => r.map((k) => goalLabel(g, k)).join(" = ")).join(" › ") || "no goals"}, spare points to ${LEFTOVER_LABELS[g.leftover].toLowerCase()}${g.strategy === "strict" ? ", strict order" : ""}${g.fewestChanges ? ", fewest changes" : ""}`;
}
// The most ranks goals hold, and the most properties one rank holds (the Goals tab stops at both).
export const GOAL_RANKS_MAX = 40, GOAL_RANK_SIZE_MAX = 10;
// A property a goal can name: one the builder offers, or a skill bonus ("sk:magery").
export const isGoalProperty = (k: string): boolean => (Object.hasOwn(PROP_LABELS, k) && !NOT_BUILDER_KEYS.has(k)) || (k.startsWith("sk:") && SKILL_SET.has(k.slice(3)));
// The check goals are held to wherever they are stored or sent (a profile's spec, a run's settings, build_suit): only
// these fields; ranks a list of at most GOAL_RANKS_MAX lists of at most GOAL_RANK_SIZE_MAX known properties
// (isGoalProperty), none named twice; a swing time from 1.25 to 10 s in quarter seconds. `label` names the field in the
// reason; null when fine.
export function goalsError(v: unknown, label: string): string | null {
  const obj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
  if (!obj(v)) return `${label} must be an object`;
  const extra = Object.keys(v).find((k) => !["ranks", "swing", "leftover", "strategy", "fewestChanges", "ownWeights"].includes(k));
  if (extra) return `${label}.${extra.slice(0, 64)} is not a goals setting`;
  if (!Array.isArray(v.ranks) || v.ranks.length > GOAL_RANKS_MAX || !v.ranks.every((r) => Array.isArray(r) && r.length > 0 && r.length <= GOAL_RANK_SIZE_MAX && r.every((k) => typeof k === "string")))
    return `${label}.ranks must be a list of at most ${GOAL_RANKS_MAX} ranks, each a list of 1 to ${GOAL_RANK_SIZE_MAX} property names`;
  const keys = (v.ranks as string[][]).flat(), unknown = keys.find((k) => !isGoalProperty(k));
  if (unknown != null) return `${label}.ranks names ${JSON.stringify(unknown.slice(0, 64))}, which is not a property the Suit Builder offers (property keys such as "ssi", "hci", "luck" or "sk:magery")`;
  if (new Set(keys).size !== keys.length) return `${label}.ranks names a property twice`;
  if (!(GOAL_LEFTOVERS as readonly unknown[]).includes(v.leftover)) return `${label}.leftover must be one of ${GOAL_LEFTOVERS.join(", ")}`;
  if (v.strategy != null && !(GOAL_STRATEGIES as readonly unknown[]).includes(v.strategy)) return `${label}.strategy must be one of ${GOAL_STRATEGIES.join(", ")}`;
  if (v.fewestChanges != null && typeof v.fewestChanges !== "boolean") return `${label}.fewestChanges must be a boolean`;
  if (v.ownWeights != null && typeof v.ownWeights !== "boolean") return `${label}.ownWeights must be a boolean`;
  if (v.swing != null) {
    const s = v.swing;
    if (!obj(s) || Object.keys(s).some((k) => k !== "mode" && k !== "seconds") || !(SWING_GOALS as readonly unknown[]).includes(s.mode)) return `${label}.swing must be { mode: ${SWING_GOALS.join(" or ")}, seconds? }`;
    if (s.seconds != null && !(typeof s.seconds === "number" && s.seconds >= 1.25 && s.seconds <= 10 && Number.isInteger(s.seconds * 4))) return `${label}.swing.seconds must be a swing time from 1.25 to 10 s, in quarter seconds`;
    if (s.mode === "every" && s.seconds == null) return `${label}.swing.seconds is needed for a swing every so many seconds`;
  }
  return null;
}

// A goal as a list names it: Swing speed with its swing time when it has one ("Swing speed every 1.5 s").
export const goalLabel = (g: Goals, k: string): string => (k === "ssi" && g.swing?.mode === "every" && g.swing.seconds != null ? `${propName(k)} every ${delayText(g.swing.seconds)}` : propName(k));

// A copy of goals that shares no list with them.
export const copyGoals = (g: Goals): Goals => ({ ...g, ranks: g.ranks.map((r) => [...r]), ...(g.swing ? { swing: { ...g.swing } } : {}) });
