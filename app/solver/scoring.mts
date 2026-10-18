// scoring.mts — the scoring constants and small rules the optimizer core (scripts/optimizer-core.mts) and the MIP (app/mip.mts) share, stated once (issue #338).
//
// Both solvers used to keep their own copy of each of these, kept equal by hand. They read them from here now; what is still
// written twice (an evaluator in the core, linear rows in the MIP) is listed in docs/solver.md, "Before you change the
// solvers". Pure, no imports: the core loads it from source, and the page compiles it with the modules that read it.
//
// map: builder
// owns: `HARD_FLOOR_BONUS`, `HARD_FLOOR_BONUS_MAX`, `hardBonusOf`, `TIE_SLACK`, `SCORE_REL`, `slackAt`, `FLOAT_EPS`, `CHANGE_COST`, `GEAR_SLOT_COUNT`, `changeCost`, `RESIST_SKILL_KEY`, `RESIST_STEP_SLACK`, `DEFAULT_FLOOR_BONUS`, `DEFAULT_FLOOR_PARTIAL`, `DEFAULT_BUDGET_MS`, `DEFAULT_RESTARTS`

// A met hard floor's bonus, and the most app/mip.mts's withHardFloorBonus raises it to for a profile whose weights could
// otherwise outweigh it (issue #311).
export const HARD_FLOOR_BONUS = 1e7;
export const HARD_FLOOR_BONUS_MAX = 1e9;
// The hard-floor bonus a profile carries: its raised one, never below HARD_FLOOR_BONUS.
export const hardBonusOf = (profile: { hardFloorBonus?: number | undefined }): number =>
  (typeof profile.hardFloorBonus === "number" && profile.hardFloorBonus > HARD_FLOOR_BONUS ? profile.hardFloorBonus : HARD_FLOOR_BONUS);

// The solvers' score precision (HiGHS's mip_abs_gap): two scores closer than this are equal suits, in a tie-break, a Strict
// order stage and the exact solver's guards.
export const TIE_SLACK = 1e-3;
// Two scores closer than `base` count as equal, or than SCORE_REL of the largest magnitude when that is more (issue #316): a
// score near 1e10 carries float rounding of about 1e-5 from summing in another order, above every absolute slack. Every score
// comparison in both solvers and every score row in the MIP goes through it.
export const SCORE_REL = 1e-12;
export const slackAt = (base: number, ...scores: number[]): number => Math.max(base, SCORE_REL * Math.max(0, ...scores.map(Math.abs)));
// Float noise: sums compared within this are equal.
export const FLOAT_EPS = 1e-9;

// What one changed slot costs at least with the tie-break's fewest changes, and the cost for pieces whose largest tie cost is
// `maxTie`: above what the nineteen gear slots can sum to (a rules file's rarity ladder can be any length), so fewer changes
// always come first. 19 is GEAR_SLOTS.length (app/vault-lib.mts); a test holds them equal.
export const CHANGE_COST = 1000;
export const GEAR_SLOT_COUNT = 19;
export const changeCost = (maxTie: number): number => Math.max(CHANGE_COST, GEAR_SLOT_COUNT * maxTie + 1);

// The Resisting Spells skill's key in a suit's totals, and the slack a step's threshold is reached within (issue #264).
export const RESIST_SKILL_KEY = "sk:resisting spells";
export const RESIST_STEP_SLACK = 0.05;

// What an absent profile or option field means to the solvers: a soft floor's bonus and a hard floor's partial credit share,
// the search's time budget and the heuristic's restarts (the page's own defaults are app/run-settings.mts's RUN_DEFAULTS).
export const DEFAULT_FLOOR_BONUS = 1000;
export const DEFAULT_FLOOR_PARTIAL = 0.5;
export const DEFAULT_BUDGET_MS = 15_000;
export const DEFAULT_RESTARTS = 200;
