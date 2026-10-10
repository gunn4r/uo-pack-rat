// evaluate.mts — one suit evaluation (issue #216): a suit's item totals, its totals in paperdoll terms with the buffs
// that count, the caps they leave, and the build's requirements against it. Manual's totals and deltas, Automatic's buff
// picker, the MCP tools and POST /api/evaluate all call evaluateSuit, so the page and a model read the same numbers.
// Pure and browser-safe, like vault-lib.mts and buffs.mts.
import { RESIST_KEYS, RESIST_SKILL_KEY, effectiveProfile, getRules, profileResistCaps, requirementReport, resistSkillCapOf, totalsOf } from "./vault-lib.mts";
import type { Character, EffectiveProfile, OptItem, Profile, PropMap, RequirementRow, ResistCap, SuitSkill } from "./vault-lib.mts";
import { applyBuffs, planBuffs, type BuffPlan, type BuffResult } from "./buffs.mts";

// The Resisting Spells skill in a suit: the character's own (null: none), the suit's own Resisting Spells bonus and the
// skill's cap (null: none known; vault-lib skillInSuit).
export const suitResist = (skill: number | null, totals: PropMap, cap: number | null = null): SuitSkill | null => (skill == null ? null : { skill, bonus: totals[RESIST_SKILL_KEY] || 0, cap });
// The shard's caps with the build's resist caps (overrides included) in place of its resist ones, and the build's
// Faster Casting cap (vault-lib.mts fcCapFor: a built profile's `caps.fc`) when given.
export function paperdollCaps(resists: Record<string, ResistCap>, fc?: number | undefined): Record<string, number> {
  const caps: Record<string, number> = { ...(getRules().caps as Record<string, number>), ...(fc != null ? { fc } : {}) };
  for (const k of RESIST_KEYS) caps[k] = resists[k]!.cap;
  return caps;
}

export interface EvaluateInput {
  profile: Profile;                                           // the build's profile, before any buff
  character: Character | null;                                // null: No character, raw item totals
  suit: Partial<Record<string, Pick<OptItem, "props"> | null | undefined>>;   // the pieces, by slot (or any key)
  buffs: BuffPlan | null;                                     // what the build plans with (buffPlanOf, manualPlan)
}
export interface SuitEvaluation {
  gearTotals: PropMap;              // the pieces' item totals
  effectiveTotals: PropMap;         // in paperdoll terms, the buffs' in-cap shares added, each resist held at the Resisting Spells minimum: not clamped, so what is wasted shows
  caps: Record<string, number>;     // the paperdoll caps, the buffs' changes applied
  baseCaps: Record<string, number>; // the paperdoll caps before any buff
  wasted: PropMap;                  // how far each total is past its cap
  requirements: RequirementRow[];   // every floor and weighted property, in item terms against the planned profile (the floors the gear has to reach)
  planned: EffectiveProfile;        // the profile the solvers search with these buffs (buffs.mts planBuffs)
  buffs: BuffResult;                // what each buff gave (applyBuffs): the shares, what lands past the cap, which were blocked
}
// A suit evaluated for a build: `profile` and `character` give the resist caps and the Resisting Spells minimum, `buffs`
// the buffs that count and the numbers they take. With no plan, nothing is counted.
export function evaluateSuit({ profile, character, suit, buffs }: EvaluateInput): SuitEvaluation {
  const gearTotals = totalsOf(suit as Partial<Record<string, OptItem>>);
  const base = effectiveProfile(profile, character), baseCaps = paperdollCaps(profileResistCaps(base), base.caps.fc);
  const r = applyBuffs(gearTotals, baseCaps, buffs?.on || [], buffs?.skills || {}, buffs?.stats ?? null, buffs?.who, suitResist(base.resistSkill, gearTotals, resistSkillCapOf(character?.skills)));
  const wasted: PropMap = {};
  for (const [k, v] of Object.entries(r.totals)) if (r.caps[k] != null && v > r.caps[k]!) wasted[k] = v - r.caps[k]!;
  const planned = planBuffs(profile, character, buffs).prof;
  return { gearTotals, effectiveTotals: r.totals, caps: r.caps, baseCaps, wasted, requirements: requirementReport(gearTotals, planned), planned, buffs: r };
}
