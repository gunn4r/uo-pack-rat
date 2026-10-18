// optimize.mts — what a build answers (app/http/routes/optimize.mts, app/services/builds.mts, app/services/jobs.mts): the optimizer's result in each of its stages, the progress a job reports, and the optimize routes' bodies.
//
// One definition for the core (scripts/optimizer-core.mts), the exact solver (app/exact-solver.mts), the worker's finish
// (app/solver/finish.mts), the routes and the page (app/ui/api-types.mts re-exports it). Types only, so the core's
// `import type` of it is erased when Node loads the core from source. A suit is generic: the core and the solvers hold
// their own item type, and the wire carries vault-lib's `OptItem`.
//
// map: api
// owns: `Suit`, `SlotChange`, `Alternative`, `CoreTieBreak`, `OptResult`, `TieBreakResult`, `StrictStageProgress`, `StrictResult`, `AltShortfall`, `SolveProgress`, `ExactFields`, `ExactSolveResult`, `OptimizeResult`, `OptimizeStartApiResponse`, `OptimizeCancelApiResponse`, `JobSnapshot`, `OptimizeStatusApiResponse`, `JobDoneEvent`, `JobFailedEvent`, `JobCancelledEvent`, `EvaluateApiResponse`
import type { Diagnostic, SavedRun, ScoreShare, SwingResult } from "../runs-types.mts";
import type { OptItem } from "../vault-lib.mts";
import type { SuitEvaluation } from "../evaluate.mts";

// A suit on the wire: a slot to its piece, or null for nothing there.
export type Suit = Record<string, OptItem | null>;

// One slot the suit changes against the worn one, and what the change gains.
export interface SlotChange {
  slot: string;
  from: string | null;
  fromSerial: number;
  to: string | null;
  toSerial: number;
  gainedProps: Record<string, number>;
}
// One of the other suits a search kept (opts.alternatives), best first, never the best itself; the worker adds its shares.
export interface Alternative<S = Suit> { best: S; score: number; shares?: ScoreShare[] | undefined }
// The core's tie-break summary (opts.tieBreak): the best score found, the returned suit's summed tie cost, the best suit
// whose floors were held (slot -> serial) and those floors; with fewestChanges, how many slots differ from the worn suit.
export interface CoreTieBreak { topScore: number; cost: number; changes?: number | undefined; top?: Record<string, number | null> | undefined; floors?: string[] | undefined }

// The core's own result (scripts/optimizer-core.mts optimizeSuit).
export interface OptResult<S = Suit> {
  best: S;
  score: number;
  currentScore: number;
  greedyScore: number;
  delta: number;
  perSlotChanges: SlotChange[];
  totals: { before: Record<string, number>; after: Record<string, number> };
  seed: number;
  restarts: number;
  evaluations: number;
  method?: string;        // "heuristic" | "exact"
  proven?: boolean | undefined;       // exact phase finished the whole tree: this is the optimum for the given pools/profile
  nodes?: number | undefined;         // branch-and-bound nodes visited
  pruned?: { before: number; after: number } | undefined;   // candidate counts before/after dominance pruning
  alternatives?: Alternative<S>[] | undefined;
  altTolerance?: number | undefined;
  tieBreak?: CoreTieBreak | undefined;
  lex?: number[] | undefined;   // with opts.strict: the returned suit's value in each stage (optStrictStages' order)
}

// A tie-break's outcome (opts.tieBreak, issue #262): the best score found, the returned suit's summed tie cost, and,
// from the exact search, the preference and tolerance it ran with and whether that cost is proven the lowest (`proven`
// is the score's proof alone: a second stage that runs out of time leaves it, and says so here). With fewest changes,
// `changes` is how many slots the suit changes.
export interface TieBreakResult { topScore: number; cost: number; changes?: number | undefined; rarity?: string | undefined; fewestChanges?: boolean | undefined; tolerance?: number | undefined; costProven?: boolean | undefined }
// A strict-order stage in progress: which of how many, what it scores and its properties (scripts/optimizer-core.mts OptStage).
export interface StrictStageProgress { at: number; of: number; kind: string; keys: string[] | null }
// A strict-order build's outcome (issue #292), as the worker puts it on the result: each stage (optStrictStages: its kind,
// a weights stage's properties) with the returned suit's value there, scaled as the core scales it, how many stages, in
// order, are proven best, and with fewest changes how many slots the suit changes.
export interface StrictResult { stages: Array<{ kind: string; keys: string[] | null; value: number }>; proven: number; changes?: number | undefined }
// Why the k-best search returned fewer alternatives than asked: the time budget ran out, the next suit scored outside the
// tolerance, no other suit exists, or (strict order) no more suits match on every goal.
export type AltShortfall = "budget" | "tolerance" | "exhausted" | "unequal";

// Every phase a build reports (the heuristic's own progress, the exact phase's bound and gap, the k-best phase's
// found/wanted) in one loose shape: not every field applies to every phase, so everything but `phase` is optional.
export interface SolveProgress {
  phase: string;
  elapsedMs?: number | undefined;
  restartsDone?: number | undefined;
  restarts?: number | undefined;
  nodes?: number | undefined;
  explored?: number | undefined;
  budgetMs?: number | undefined;
  improvements?: number | undefined;
  lastImprovementMs?: number | undefined;
  bestScore?: number | null | undefined;
  currentScore?: number | undefined;
  floorsMet?: number | undefined;
  floorsTotal?: number | undefined;
  candidates?: number | undefined;
  bound?: number | null | undefined;
  gapPoints?: number | null | undefined;
  solver?: string | undefined;
  found?: number | undefined;
  wanted?: number | undefined;
  at?: number | undefined;
  stage?: StrictStageProgress | undefined;   // strict order: the stage being solved
}

// What the exact solver (app/exact-solver.mts solveExact) adds to the core's result.
export interface ExactFields {
  solver: string;
  bound: number | null;
  gapPoints: number | null;
  mipMs: number;
  heuristicMs: number;
  unreachableFloors: string[];
  fallbackReason?: string | undefined;
  floorsConflict?: boolean | undefined;
  altShortfall?: AltShortfall | undefined;
  strictProven?: number | undefined;   // strict order: how many stages, in order, HiGHS proved (all of them when `proven`)
}
export interface ExactSolveResult<S = Suit> extends OptResult<S>, ExactFields {
  method: string;
  tieBreak?: TieBreakResult | undefined;
}

// A finished build's result, as the worker sends it (app/solver/finish.mts) and the job, its events and a saved run carry
// it: either solver's result, the exact fields only from the exact one, the core's `lex` and the exact search's
// `strictProven` dropped (the stages carry it), plus the result
// diagnostics, the suit's swing, its score shares and a strict-order build's stages.
export type OptimizeResult<S = Suit> = Omit<OptResult<S>, "tieBreak" | "lex"> & Partial<Omit<ExactFields, "strictProven">> & {
  tieBreak?: TieBreakResult | undefined;
  diagnostics?: Diagnostic[] | undefined;   // absent when computing them failed, and on a run saved before SOLVER_VERSION 6
  swing?: SwingResult | undefined;          // when the suit holds a weapon with a known speed and the build has a character
  shares?: ScoreShare[] | undefined;        // what made up the suit's score; absent on a run saved before issue #273
  strict?: StrictResult | undefined;
};

// POST /api/optimize: a fresh job (`id`) or, for a build a saved run cannot better, that run straight away (`cached`).
export interface OptimizeStartApiResponse<Run = SavedRun> {
  ok: boolean;
  id?: string | undefined;
  warmFrom?: string | null | undefined;
  superseded?: string | null | undefined;
  warning?: string | undefined;
  poolSize: number;
  skipped: Record<string, number>;
  current: Suit;
  blocked: string[];
  cached?: boolean | undefined;
  run?: Run | undefined;
  diagnostics?: Diagnostic[] | undefined;   // the requirements no suit in the pool can reach, before the search starts
}
// POST /api/optimize/<id>/cancel.
export interface OptimizeCancelApiResponse { ok: boolean; state: string }
// A job as GET /api/optimize/<id>/status answers it and its event stream's snapshot sends it.
export interface JobSnapshot<S = Suit> {
  id: string;
  state: string;
  progress: SolveProgress | null;
  result: OptimizeResult<S> | null;
  ms: number | null;
  error: string | null;
  runId: string | null;
}
export type OptimizeStatusApiResponse<S = Suit> = { ok: boolean } & JobSnapshot<S>;
// The event stream's other messages: `done`, `failed` and `cancelled`.
export interface JobDoneEvent<S = Suit> { result: OptimizeResult<S>; ms: number; runId: string | null }
export interface JobFailedEvent { error: string }
export interface JobCancelledEvent { ms: number }
// POST /api/evaluate: one suit's paperdoll.
export interface EvaluateApiResponse { ok: boolean; evaluation: SuitEvaluation }
