// mip-solve.mts — the HiGHS runtime wrapper around app/mip.mts's pure builder. Owns the one thing
// mip.mts deliberately doesn't: the `highs` (WASM) import, model lifecycle, and callback plumbing.
//
// The `highs` package ships its own types.d.ts, but its generic/branded surface (ObjectiveSense as
// a branded `1|-1`, one `CallbackEventFor<T>` per channel, a 9-key `HighsCallbackMap`) is far more
// than this file's fixed, narrow usage needs. HighsInstance/HighsModel/etc. below name exactly the
// subset of that API this module calls; loadHighs() is the one place that trusts the real loader's
// return value against that local shape (a cast, not `any`) — everything past it works only with
// the local interfaces.
import type { BuiltMip } from "./mip.mts";
import { noGoodRow } from "./mip.mts";

export interface HighsObjectiveSenseConstants {
  readonly maximize: number;
  readonly minimize: number;
}
export interface HighsModelStatusConstants {
  readonly optimal: number;
  readonly timeLimit: number;
  readonly infeasible: number;
  readonly interrupted: number;
  readonly [name: string]: number;
}
export interface HighsSolutionStatusConstants {
  readonly feasible: number;
  readonly [name: string]: number;
}
export interface HighsCallbackTypeConstants {
  readonly mipImprovingSolution: number;
  readonly mipLogging: number;
  readonly [name: string]: number;
}
export interface HighsConstants {
  readonly objectiveSense: HighsObjectiveSenseConstants;
  readonly modelStatus: HighsModelStatusConstants;
  readonly solutionStatus: HighsSolutionStatusConstants;
  readonly callbackType: HighsCallbackTypeConstants;
}

// The subset of one callback event's `data` this file reads (mipImprovingSolution/mipLogging only
// — see forward() below). Every field is optional: one interface covers every HiGHS callback
// channel, and only the fields documented for the active channel are actually populated.
export interface HighsCallbackData {
  objective_function_value?: number | undefined;
  mip_primal_bound?: number | undefined;
  mip_dual_bound?: number | undefined;
  mip_gap?: number | undefined;
  mip_node_count?: bigint | undefined;
  running_time?: number | undefined;
}
export interface HighsCallbackEvent {
  data: HighsCallbackData;
}
export type HighsCallback = (event: HighsCallbackEvent) => undefined;

export interface HighsSolution {
  colValue: Float64Array;
}
export interface HighsOptionStore {
  set: (values: Record<string, boolean | number | string | undefined>) => void;
}
export interface HighsInfoStore {
  get: (name: string) => number | bigint;
}
export interface HighsModel {
  passModel: (model: Record<string, unknown>) => void;
  options: HighsOptionStore;
  info: HighsInfoStore;
  setSolution: (solution: { colValue: Float64Array | number[] }) => void;
  run: (callbacks: Record<number, HighsCallback>) => void;
  getModelStatus: () => number;
  getSolution: () => HighsSolution;
  getObjectiveValue: () => number;
  addRow: (lower: number, upper: number, entries: { indices: number[]; values: number[] }) => void;
  disposed: boolean;
  dispose: () => void;
}
export interface HighsInstance {
  createModel: () => HighsModel;
  constants: HighsConstants;
}

export interface Handle {
  highs: HighsInstance;
  model: HighsModel;
  built: BuiltMip;
}

let cached: Promise<HighsInstance> | null = null;

// Memoised loader. `PACKRAT_NO_HIGHS` is a test hook: read on every call (never just the memo)
// so a test can force the "no solver available" fallback path without an env var set at process
// start.
export async function loadHighs(): Promise<HighsInstance> {
  if (process.env.PACKRAT_NO_HIGHS) throw new Error("HiGHS disabled by PACKRAT_NO_HIGHS");
  // The `highs` package's types.d.ts is typed as CommonJS (its package.json says
  // "type": "commonjs" and ships one shared .d.ts for both the "import" and "require"
  // conditions), so TS treats `.default` as Node's CJS/ESM interop default — the WHOLE module
  // namespace — even though the "import" condition's real build/highs.mjs is genuine ESM with a
  // real default export. This cast is the one place that trusts the real (ESM) runtime shape
  // over the mistyped one.
  if (!cached) cached = ((await import("highs")).default as unknown as () => Promise<HighsInstance>)();
  return cached;
}

// Creates the persistent model from a built model (app/mip.mts's `buildSuitMip(...).model`) and
// returns a handle carrying everything the rest of this module needs.
export function openModel(highs: HighsInstance, built: BuiltMip): Handle {
  const model = highs.createModel();
  const sense = built.model.sense === "maximize" ? highs.constants.objectiveSense.maximize : highs.constants.objectiveSense.minimize;
  model.passModel({ ...built.model, sense });
  model.options.set({ output_flag: false });
  return { highs, model, built };
}

export type HighsStatus = "optimal" | "timeLimit" | "infeasible" | "interrupted" | "other";

const STATUS_TEXT: Record<string, string> = {};   // reverse lookup of highs.constants.modelStatus, built lazily per highs instance
function statusTextFor(highs: HighsInstance | undefined, code: number | undefined): string {
  if (!STATUS_TEXT[code === undefined ? "__none__" : code] && highs) {
    for (const [name, value] of Object.entries(highs.constants.modelStatus)) STATUS_TEXT[value] = name;
  }
  return STATUS_TEXT[code as number] ?? "other";
}
function statusOf(highs: HighsInstance, code: number): HighsStatus {
  const m = highs.constants.modelStatus;
  if (code === m.optimal) return "optimal";
  if (code === m.timeLimit) return "timeLimit";
  if (code === m.infeasible) return "infeasible";
  if (code === m.interrupted) return "interrupted";
  return "other";
}

export interface GapEvent {
  dual?: number | null | undefined;
  primal?: number | null | undefined;
}

// The absolute gap this module reports (HiGHS's own `mip_gap` is relative): 0 once the solve is
// proven optimal, else |dual - primal| from the last event that carried both bounds, or null when
// no event ever carried both (e.g. the time limit hit before HiGHS's first improving/log callback)
// or a bound was still ±Infinity (not established yet, seen at sub-second budgets).
// Pure and deterministic so it can be tested without a real solve.
export function gapFromEvents(status: HighsStatus | string, lastEvent: GapEvent | null | undefined): number | null {
  if (status === "optimal") return 0;
  const gap = lastEvent && lastEvent.dual != null && lastEvent.primal != null ? Math.abs(lastEvent.dual - lastEvent.primal) : null;
  return gap != null && Number.isFinite(gap) ? gap : null;
}

interface SolveEventData {
  objective: number | undefined;
  primal: number | undefined;
  dual: number | undefined;
  gap: number | undefined;
  nodes: number;
  runningTime: number | undefined;
}
export interface SolveEvent extends SolveEventData {
  kind: "improving" | "log";
}

export interface SolveModelOptions {
  timeLimitS?: number | undefined;
  start?: Float64Array | number[] | undefined;
  onEvent?: ((e: SolveEvent) => void) | undefined;
}

export interface SolveResult {
  status: HighsStatus;
  statusText: string;
  objective: number | null;
  primal: number | null;
  dual: number | null;
  gapAbs: number | null;
  nodes: number;
  colValue: Float64Array | number[] | null;
  ms: number;
}

// Runs (or re-runs) the model. `start` is a full column vector (app/mip.mts's `startVector`) used
// as the MIP start; `onEvent({kind, objective, primal, dual, gap, nodes, runningTime})` mirrors the
// mipImprovingSolution / mipLogging callback channels.
export function solveModel(handle: Handle, { timeLimitS, start, onEvent }: SolveModelOptions = {}): SolveResult {
  const { highs, model } = handle;
  model.options.set({ time_limit: timeLimitS, mip_rel_gap: 0, mip_abs_gap: 1e-3 });
  if (start) model.setSolution({ colValue: start });
  let last: SolveEventData | null = null;
  const forward = (kind: "improving" | "log") => (e: HighsCallbackEvent): undefined => {
    last = { objective: e.data.objective_function_value, primal: e.data.mip_primal_bound, dual: e.data.mip_dual_bound,
      gap: e.data.mip_gap, nodes: Number(e.data.mip_node_count ?? 0n), runningTime: e.data.running_time };
    if (onEvent) onEvent({ kind, ...last });
  };
  const t0 = Date.now();
  model.run({ [highs.constants.callbackType.mipImprovingSolution]: forward("improving"), [highs.constants.callbackType.mipLogging]: forward("log") });
  const ms = Date.now() - t0;
  const code = model.getModelStatus();
  const status = statusOf(highs, code), statusText = statusTextFor(highs, code);
  const feasible = model.info.get("primal_solution_status") === highs.constants.solutionStatus.feasible;
  const colValue = (status === "optimal" || (status === "timeLimit" && feasible)) ? model.getSolution().colValue : null;
  const objective = feasible ? model.getObjectiveValue() : null;
  const nodes = Number(model.info.get("mip_node_count"));
  // `last` is only ever reassigned inside forward()'s closures, which TS's control-flow analysis
  // does not see across the opaque model.run() call — without this, it narrows `last` to exactly
  // `null` here (the only directly-visible assignment) and every read below to `never`. The cast
  // restores the variable's own declared type; it is not widening anything TS wasn't already told.
  const lastEvent = last as SolveEventData | null;
  // No callback carried a dual bound: only a proven optimum is its own bound. A timed-out incumbent
  // is not, so the bound is unknown (null) rather than the incumbent itself.
  const dual = lastEvent?.dual ?? (status === "optimal" ? objective : null);
  const primal = lastEvent?.primal ?? (objective ?? null);
  const gapAbs = gapFromEvents(status, lastEvent);
  return { status, statusText, objective, primal, dual, gapAbs, nodes, colValue, ms };
}

// Appends the no-good cut (app/mip.mts's `noGoodRow`) so the next `solveModel` call finds the
// runner-up instead of the same optimum.
export function addNoGood(handle: Handle, built: BuiltMip, picked: Parameters<typeof noGoodRow>[1]): void {
  const { lower, upper, indices, values } = noGoodRow(built, picked);
  handle.model.addRow(lower, upper, { indices, values });
}

export function closeModel(handle: Handle): void {
  if (!handle.model.disposed) handle.model.dispose();
}
