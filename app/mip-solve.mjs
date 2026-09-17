// mip-solve.mjs — the HiGHS runtime wrapper around app/mip.mjs's pure builder. Owns the one thing
// mip.mjs deliberately doesn't: the `highs` (WASM) import, model lifecycle, and callback plumbing.
import { noGoodRow } from "./mip.mjs";

let cached = null;

// Memoised loader. `PACKRAT_NO_HIGHS` is a test hook: read on every call (never just the memo)
// so a test can force the "no solver available" fallback path without an env var set at process
// start.
export async function loadHighs() {
  if (process.env.PACKRAT_NO_HIGHS) throw new Error("HiGHS disabled by PACKRAT_NO_HIGHS");
  if (!cached) cached = (await import("highs")).default();
  return cached;
}

// Creates the persistent model from a built model (app/mip.mjs's `buildSuitMip(...).model`) and
// returns a handle carrying everything the rest of this module needs.
export function openModel(highs, built) {
  const model = highs.createModel();
  const sense = built.model.sense === "maximize" ? highs.constants.objectiveSense.maximize : highs.constants.objectiveSense.minimize;
  model.passModel({ ...built.model, sense });
  model.options.set({ output_flag: false });
  return { highs, model, built };
}

const STATUS_TEXT = {};   // reverse lookup of highs.constants.modelStatus, built lazily per highs instance
function statusTextFor(highs, code) {
  if (!STATUS_TEXT[code === undefined ? "__none__" : code] && highs) {
    for (const [name, value] of Object.entries(highs.constants.modelStatus)) STATUS_TEXT[value] = name;
  }
  return STATUS_TEXT[code] ?? "other";
}
function statusOf(highs, code) {
  const m = highs.constants.modelStatus;
  if (code === m.optimal) return "optimal";
  if (code === m.timeLimit) return "timeLimit";
  if (code === m.infeasible) return "infeasible";
  if (code === m.interrupted) return "interrupted";
  return "other";
}

// The absolute gap this module reports (HiGHS's own `mip_gap` is relative): 0 once the solve is
// proven optimal, else |dual - primal| from the last event that carried both bounds, or null when
// no event ever carried both (e.g. the time limit hit before HiGHS's first improving/log callback).
// Pure and deterministic so it can be tested without a real solve.
export function gapFromEvents(status, lastEvent) {
  if (status === "optimal") return 0;
  return lastEvent && lastEvent.dual != null && lastEvent.primal != null ? Math.abs(lastEvent.dual - lastEvent.primal) : null;
}

// Runs (or re-runs) the model. `start` is a full column vector (app/mip.mjs's `startVector`) used
// as the MIP start; `onEvent({kind, objective, primal, dual, gap, nodes, runningTime})` mirrors the
// mipImprovingSolution / mipLogging callback channels.
export function solveModel(handle, { timeLimitS, start, onEvent } = {}) {
  const { highs, model } = handle;
  model.options.set({ time_limit: timeLimitS, mip_rel_gap: 0, mip_abs_gap: 1e-3 });
  if (start) model.setSolution({ colValue: start });
  let last = null;
  const forward = (kind) => (e) => {
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
  const dual = last?.dual ?? (objective ?? null);
  const primal = last?.primal ?? (objective ?? null);
  const gapAbs = gapFromEvents(status, last);
  return { status, statusText, objective, primal, dual, gapAbs, nodes, colValue, ms };
}

// Appends the no-good cut (app/mip.mjs's `noGoodRow`) so the next `solveModel` call finds the
// runner-up instead of the same optimum.
export function addNoGood(handle, built, picked) {
  const { lower, upper, indices, values } = noGoodRow(built, picked);
  handle.model.addRow(lower, upper, { indices, values });
}

export function closeModel(handle) {
  if (!handle.model.disposed) handle.model.dispose();
}
