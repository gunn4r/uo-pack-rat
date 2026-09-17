# Pack Rat Phase 3 — HiGHS Exact Solver, Server-Side Pools, Paged Inventory — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hand-written branch-and-bound as the app's exact solver with HiGHS (WASM, MIT) running in the existing worker thread, so 20,000–50,000-item hoards prove in seconds; move pool building to the server and page the inventory table so the browser payload stops growing with the hoard.

**Architecture:** A pure builder (`app/mip.mjs`) turns pools + worn suit + profile into HiGHS's sparse CSR model exactly as the validated spike did (one binary per candidate, capped totals as bounded continuous columns, hard floors as rows, soft floors as a met-binary plus a partial-credit column, the two-hander rule as one row, keep-what-you-wear by candidacy). A thin solver module (`app/mip-solve.mjs`) owns the HiGHS runtime (persistent model, callbacks for progress, `setSolution` for the MIP start, `addRow` no-good cuts for k-best). An orchestrator (`app/exact-solver.mjs`, run inside `optimize-worker.mjs`) runs the core's heuristic first as the MIP start, then HiGHS, then rebuilds the full report through the core so the result shape the page and the saved runs know is unchanged; if HiGHS cannot load it returns the heuristic result flagged as such. The server's multi-thread branch-and-bound path is retired. `vault-server.mjs` caches the folded inventory, builds pools itself for `POST /api/optimize {character, settings}`, serves a slim `GET /api/inventory` (facets, worn gear, counts — no item list) and a paged, searched, sorted `GET /api/items`; the page's Inventory tab consumes the pages.

**Tech Stack:** Node ≥ 22.18, ESM; the one runtime dependency `highs@1.15.3` (HiGHS compiled to WebAssembly, MIT; `build/highs.wasm` is 3.5 MB, loads in ~15 ms in a worker); `node:test`; the compiled core `app/dist/optimizer-core.mjs` (built from `scripts/optimizer-core.ts`).

**Spec:** `docs/superpowers/specs/2026-09-12-desktop-app-public-release-design.md` — §7 (scale strategy: HiGHS as the exact solver, pools on the server, paged table), §11b layer 3 (solver equivalence tests), §11c row 1 (fallback + gap + pool-size warning), §12 Phase 3. Evidence: `app/bench/REPORT.md` addendum and `app/bench/mip-spike.mjs` (the LP the builder reproduces; validated to the decimal against the core).

## Global Constraints

- Branch `phase-3-solver` from `main` (`2446e9c`). Never touch `the original private workspace` or `~/Desktop/TazUO`. Never commit `local/`, `app/dist/`, `test_logs/`, `.superpowers/`, `node_modules/`. Commit `package-lock.json`.
- `package.json` gains exactly one runtime dependency: `"dependencies": { "highs": "1.15.3" }` (exact pin). The page never loads HiGHS; it runs only inside the server's worker thread. Nothing else is added.
- The core (`scripts/optimizer-core.ts`) keeps `scoreSet` and its exact branch-and-bound as the reference implementation for the equivalence tests; only its parallel (`shared`) plumbing is removed (Task 6). `HARD_FLOOR_BONUS` stays `1e7` and `app/mip.mjs` must use the same constant.
- Scoring semantics the MIP must reproduce exactly (from `optScoreVector`, `scripts/optimizer-core.ts:294-310`): per dimension `w·min(t, cap)` (no clamp at zero: a negative total scores `w·t`), plus for a floor `f > 0`: `bonus` when `t ≥ f`, else `bonus·partial·(t > 0 ? t/f : 0)`; `bonus` is `HARD_FLOOR_BONUS` for dims in `profile.hardFloors`, else `profile.floorBonus` (default 1000); `partial = profile.floorPartial` (default 0.5). Candidate lists: the pool's items of that slot deduped by serial, plus the worn piece if not present; the "empty" choice exists only for optional slots or slots with no worn piece (`optCandidatesFor`, core lines 381-400).
- Result shape: `optimizeSuit`'s `OptResult` (`best, score, currentScore, greedyScore, delta, perSlotChanges, totals, seed, restarts, evaluations, method, proven, nodes, pruned, alternatives, altTolerance`) stays the contract for the page and saved runs; Phase 3 adds `solver: "highs" | "fallback" | "none"`, `bound`, `gapPoints`, `mipMs`, `heuristicMs`, `fallbackReason?`, `floorsConflict?`, `unreachableFloors: string[]`. `workers` and `pruned` are no longer produced.
- Progress events keep `{phase, elapsedMs, budgetMs, bestScore, candidates, at}`; the exact phase adds `bound, gapPoints, nodes, solver`; the k-best phase is `phase: "alternatives"` with `found, wanted`. The page must render every phase it can receive.
- HTTP contracts added: `GET /api/items?...` (paged; `limit` ≤ 500, default 200); `GET /api/inventory` no longer returns `inventory.items` and adds `inventory.itemCount, facets, worn, rootCounts, propKeys`; `POST /api/optimize` accepts either the old `{pools, current, profile, opts, meta}` or the new `{character, settings, profile, opts, meta}` and always answers with `poolSize, skipped (counts), current` next to `id`/`cached`. All under the Phase 2 security rules (token, Host/Origin, JSON only).
- Every browser-served module change (`app/index.html`, `app/ui/*.mjs`, `app/vault-lib.mjs`) needs a browser load in its gate: start `node scripts/start.mjs --demo --port 0` (or `npm start -- --demo`), open the page, zero console errors, the tab in question renders. Implementers report what they saw; the coordinator repeats it with the browser tools before the task review passes (Phase 2 lesson: T1 broke the page and only T2 noticed).
- Tests on `node:test` with the `[smoke]`/`[fast]`/`[slow]` name prefixes; `npm test` green before every commit (`TEST_SKIP_SLOW=1 npm test` is acceptable mid-task, the full suite at every task's last step). Prose not hard-wrapped. Commits end with `Claude-Session: https://claude.ai/code/session_012Jc4pEtTUy9dfd8sp6EbPb`, never `Co-Authored-By`. No `while True` literals anywhere in a `.py` file (none are touched here).
- Usage: Sonnet implementers and task reviewers; Opus for the whole-branch final review; the coordinator does the browser gates.

## File structure after Phase 3

| Path | Responsibility |
|---|---|
| `app/mip.mjs` (new) | pure: `buildSuitMip(input) → built`, `startVector(built, assignment)`, `pickedOf(built, colValue)`, `noGoodRow(built, picked)`, `HARD_FLOOR_BONUS`, `DEFAULT_SLOTS`, `DEFAULT_OPTIONAL_SLOTS` |
| `app/mip.test.mjs` (new) | `[fast]` builder tests on tiny hand-made pools |
| `app/mip-solve.mjs` (new) | the only file that imports `highs`: `loadHighs()`, `solveSuitMip(highs, built, {timeLimitS, start, onEvent}) → solve`, `addNoGood(handle, built, picked)`; a persistent-model wrapper with dispose in `finally` |
| `app/exact-solver.mjs` (new) | `solveExact({core, pools, current, profile, opts, onProgress, onWarn, loadHighs}) → OptResult` — heuristic start → HiGHS → k-best → report via the core; fallback |
| `app/solver.test.mjs` (new) | solver-equivalence tests: `[fast]` on the adapter fixture and default profiles, tiny synthetic edge cases; `[slow]` on a generated 3,000-item cell |
| `app/optimize-worker.mjs` | `exact` → `solveExact`, else the core heuristic; no `shared` |
| `app/vault-server.mjs` | one worker per job (no `runParallel`); inventory cache; `/api/items`; slim `/api/inventory`; `/api/optimize` by character; pool-size warning |
| `app/item-query.mjs` (new) | pure: `parseItemQuery(searchParams)`, `applyItemQuery(items, query, ctx)`, `facetsOf(items, ctx)`, `colVal`, `EXTRA_COLS`, `rarityRank(ladder, name)` |
| `app/item-query.test.mjs` (new) | `[fast]` |
| `app/ui/inventory.mjs`, `ui/store.mjs`, `ui/app.mjs`, `ui/characters.mjs`, `ui/sheet.mjs`, `ui/containers.mjs`, `ui/dom.mjs`, `ui/builder.mjs`, `index.html` | page consumes pages/facets/worn; builder posts by character; MIP progress + stats |
| `app/shared-search.mjs` (deleted), `scripts/optimizer-core.ts` (shared plumbing removed), `app/bench/run-bench.mjs` (parallel mode removed) | retire the multi-thread branch-and-bound |
| `docs/solver.md` (new), `TESTING.md`, `README.md`, `CHANGELOG.md`, `CONTRIBUTING.md`, `app/bench/README.md` | the model documented; the dependency rule updated |

---

### Task 1: The dependency, the pure MIP builder, and the HiGHS solve module

**Files:**
- Modify: `package.json` (add `dependencies.highs = "1.15.3"`), commit `package-lock.json`
- Create: `app/mip.mjs`, `app/mip.test.mjs`, `app/mip-solve.mjs`

**Interfaces:**
- Consumes: `OptItem = {serial, name, slot, props: {[dim]: number}, twoHanded?: true}` pools as `buildPools` returns them (`app/vault-lib.mjs:335`); `profile` as `effectiveProfile` returns it (`{weights, caps, floors, floorBonus, hardFloors, floorPartial?}`).
- Produces:
  - `buildSuitMip({pools, current, profile, optionalSlots = DEFAULT_OPTIONAL_SLOTS, slots = DEFAULT_SLOTS, hardAsSoft = false}) → built` where `built = { cols: [{name, kind: "x"|"c"|"y"|"s"|"u", slot?, item?, dim?}], xIndex: {[slot]: number[]}, fixed: {[slot]: OptItem}, dims: string[], constTotals: {[dim]: number}, unreachableFloors: string[], hardRows: {[dim]: rowIndex}, scoreOffset: number, model: {numCols, numRows, sense: "maximize", offset, colCost, colLower, colUpper, rowLower, rowUpper, matrix: {format: "csr", numRows, numCols, starts, indices, values}, integrality} }`. `model.offset` carries only the uncapped-weight constants of fixed slots; `scoreOffset = HARD_FLOOR_BONUS × (number of hard floors modelled as rows)` so that `coreScore = objective + scoreOffset` for any feasible solution (the spike's `impliedScore`). `model.sense` is the string `"maximize"`; `mip-solve.mjs` maps it to `highs.constants.objectiveSense.maximize`.
  - `startVector(built, assignment) → Float64Array(numCols)` — a full, feasible column vector for the MIP start: `x = 1` for the assignment's serial in each slot's list, `c_d = min(constTotals_d + total_d, cap_d)`, `y_d = total ≥ f ? 1 : 0`, `s_d = y ? 0 : k·max(0, t)`, `u_d = t < 0 ? 1 : 0`.
  - `pickedOf(built, colValue) → {[slot]: OptItem}` — the `x` columns with value > 0.5 plus `built.fixed`.
  - `noGoodRow(built, picked) → {lower: -Infinity, upper: n − 1, indices, values}` — the proper cut Σ_picked x − Σ_unpicked x ≤ |picked| − 1 over every `x` column.
  - `mip-solve.mjs`: `loadHighs() → Promise<highs>` (memoised; `import("highs")` then `(await import).default()`; when `process.env.QM_FORCE_NO_HIGHS` is set it throws `new Error("HiGHS disabled by QM_FORCE_NO_HIGHS")` — the fallback test hook); `openModel(highs, built) → handle` (creates the persistent model, passes `built.model`, sets `output_flag: false`); `solveModel(handle, {timeLimitS, start, onEvent}) → {status: "optimal"|"timeLimit"|"infeasible"|"interrupted"|"other", statusText, objective, primal, dual, gapAbs, nodes, colValue: Float64Array|null, ms}`; `addNoGood(handle, built, picked)`; `closeModel(handle)` (dispose; idempotent). `onEvent({kind: "improving"|"log", objective, primal, dual, gap, nodes, runningTime})` is called from the `mipImprovingSolution` and `mipLogging` callbacks (convert `mip_node_count` from bigint with `Number()` before it leaves the handler).

- [ ] **Step 1: Add the dependency** — `cd ~/r/pack-rat && npm i highs@1.15.3 --save-exact` (creates `package-lock.json`; `node_modules/` is git-ignored). Verify `node -e 'import("highs").then(m => m.default()).then(h => console.log(h.version.string))'` prints a version.

- [ ] **Step 2: Builder tests (`app/mip.test.mjs`)** — all `[fast]`, using two tiny hand-made pools and a profile `{weights: {hci: 2, dci: 1, tagPenalty: -1}, caps: {hci: 45, dci: 45}, floors: {lrc: 100, fc: 2}, hardFloors: ["lrc"], floorBonus: 1000, floorPartial: 0.5}`:
  - column bookkeeping: one `x` per candidate per slot (`xIndex.ring.length === pools.ring.length`), the worn ring not in the pool is appended as a candidate (keep-what-you-wear), a slot with no pool and a worn piece lands in `fixed` and its props in `constTotals`, `integrality` is 1 for every `x` and `y` and 0 for `c`/`s`;
  - a capped positive weight makes a `c` column with `colCost = w`, `colLower = -Infinity`, `colUpper = cap`, and one row `c − Σ v·x ≤ constTotals` (find the row through `matrix.starts`; assert coefficients);
  - an uncapped weight (tagPenalty) lands in `colCost` of each `x` as `w·v` and in `model.offset` for fixed pieces;
  - a hard floor makes one row with `rowLower = f − constTotals` and `rowUpper = Infinity` and counts `HARD_FLOOR_BONUS` into `scoreOffset`; a soft floor makes `y`,`s` columns with costs `bonus`,`1` and the three rows with the documented coefficients (`t − f·y ≥ −const`; `s − k·t ≤ k·const`; `s + bonus·partial·y ≤ bonus·partial`);
  - a soft-floor dim where some candidate carries a negative value adds a `u` column and the two guard rows (`t + N·u ≥ 0` with `N = −Σ_slot min(0, min_v)` − min(0, const); `s ≤ bonus·partial·(1 − u)`) — and no `u` when nothing is negative;
  - a hard floor no suit can reach (per-slot maxima + const < f) is listed in `unreachableFloors`, gets no row, and is modelled as `s` with `y` omitted (credit `HARD_FLOOR_BONUS·partial·t/f`), not counted in `scoreOffset`;
  - `hardAsSoft: true` models every hard floor as a soft floor with `bonus = HARD_FLOOR_BONUS` (no hard rows, `scoreOffset = 0`);
  - slot rows: `= 1` (lower = upper = 1) for a required slot with a worn piece, `≤ 1` otherwise; `optionalSlots` respected;
  - hands row: present only when a `twoHanded: true` candidate and a oneHanded candidate both exist, coefficients 1 over exactly those columns, upper 1;
  - `startVector` on the worn suit satisfies every row (write a 10-line dense checker in the test: for each row compute Σ values·vec and assert within `[rowLower − 1e-9, rowUpper + 1e-9]`);
  - `noGoodRow` for `{ring: A}` with x columns [A, B, C] gives values `[+1, −1, −1]` and upper `0`;
  - `pickedOf` maps > 0.5 to items and merges `fixed`;
  - a negative weight with a finite cap throws (`non-concave`);
  - `matrix.starts.length === numRows + 1`, `starts.at(-1) === indices.length === values.length`, every index `< numCols` (a structural check that runs on every built model in this file via a helper `assertWellFormed(built)`).

- [ ] **Step 3: Write `app/mip.mjs`** — the builder. The code (complete; keep the comments, they are the documentation the reviewer checks against):

```js
// mip.mjs — the suit problem as a mixed-integer program, built as HiGHS sparse (CSR) arrays. Pure:
// no solver import here (app/mip-solve.mjs owns the runtime). Every modelling choice reproduces
// app/bench/mip-spike.mjs, which was validated to the decimal against the core's proven optima —
// see docs/solver.md for the model and app/bench/REPORT.md for the evidence.
export const HARD_FLOOR_BONUS = 1e7;   // == scripts/optimizer-core.ts HARD_FLOOR_BONUS
export const DEFAULT_SLOTS = ["helmet", "chest", "arms", "hands", "legs", "neck", "ring", "bracelet", "talisman", "cloak", "oneHanded", "twoHanded"];
export const DEFAULT_OPTIONAL_SLOTS = ["cloak", "talisman", "ring", "bracelet", "neck", "oneHanded", "twoHanded"];
const INF = Infinity;

export function buildSuitMip({ pools = {}, current = {}, profile, optionalSlots = DEFAULT_OPTIONAL_SLOTS, slots = DEFAULT_SLOTS, hardAsSoft = false }) {
  const optional = new Set(optionalSlots);
  const W = profile.weights || {}, CAPS = profile.caps || {}, FL = profile.floors || {};
  const hard = new Set(profile.hardFloors || []);
  const FB = typeof profile.floorBonus === "number" ? profile.floorBonus : 1000;
  const PARTIAL = typeof profile.floorPartial === "number" ? profile.floorPartial : 0.5;
  const dims = [...new Set([...Object.keys(W), ...Object.keys(CAPS), ...Object.keys(FL)])];
  for (const d of dims) if ((W[d] || 0) < 0 && Number.isFinite(CAPS[d])) throw new Error(`negative weight with a cap is non-concave: ${d}`);

  // ---- columns ----
  const cols = [], colCost = [], colLower = [], colUpper = [], integrality = [];
  const addCol = (col, cost, lo, hi, integer) => { cols.push(col); colCost.push(cost); colLower.push(lo); colUpper.push(hi); integrality.push(integer ? 1 : 0); return cols.length - 1; };
  const xIndex = {}, fixed = {}, constTotals = Object.fromEntries(dims.map((d) => [d, 0]));
  for (const s of slots) {
    const seen = new Set(), list = [];
    for (const it of pools[s] || []) { if (it.slot === s && !seen.has(it.serial)) { seen.add(it.serial); list.push(it); } }   // as optCandidatesFor
    const cur = current[s] && current[s].slot === s ? current[s] : null;
    if (cur && !seen.has(cur.serial)) list.push(cur);                                     // keep what you wear: always a candidate
    if (!list.length) { if (cur) { fixed[s] = cur; for (const d of dims) constTotals[d] += cur.props[d] || 0; } continue; }
    xIndex[s] = list.map((it, i) => addCol({ name: `x_${s}_${i}`, kind: "x", slot: s, item: it }, 0, 0, 1, true));
  }
  const allX = Object.values(xIndex).flat();

  // ---- rows (CSR) ----
  const rowLower = [], rowUpper = [], starts = [0], indices = [], values = [];
  const addRow = (entries, lo, hi) => { for (const [j, v] of entries) { indices.push(j); values.push(v); } starts.push(indices.length); rowLower.push(lo); rowUpper.push(hi); return rowLower.length - 1; };
  let offset = 0, scoreOffset = 0;
  const unreachableFloors = [], hardRows = {};
  for (const d of dims) {
    const w = W[d] || 0, cap = CAPS[d], f = FL[d] || 0, c0 = constTotals[d];
    const xs = allX.map((j) => [j, cols[j].item.props[d] || 0]).filter(([, v]) => v !== 0);
    if (w !== 0) {
      if (Number.isFinite(cap) && w > 0) {                       // w·min(t, cap): c ≤ t, c ≤ cap, maximise w·c (min is concave); c may go negative like t
        const c = addCol({ name: `c_${d}`, kind: "c", dim: d }, w, -INF, cap, false);
        addRow([[c, 1], ...xs.map(([j, v]) => [j, -v])], -INF, c0);
      } else {                                                    // uncapped: linear, aggregated per column
        for (const [j, v] of xs) colCost[j] += w * v;
        offset += w * c0;
      }
    }
    if (f <= 0) continue;
    // per-slot maxima: a floor above them can never be met, so its met-indicator is 0 for every suit
    let reach = c0; for (const s of Object.keys(xIndex)) reach += Math.max(0, ...xIndex[s].map((j) => cols[j].item.props[d] || 0));
    const isHard = hard.has(d), unreachable = reach < f;
    if (isHard && !hardAsSoft && !unreachable) { hardRows[d] = addRow(xs, f - c0, INF); scoreOffset += HARD_FLOOR_BONUS; continue; }
    if (unreachable) unreachableFloors.push(d);
    // soft floor (or an unreachable / hardAsSoft hard floor): bonus·y + s with t ≥ f·y, s ≤ k·t, s ≤ bonus·partial·(1 − y)
    const bonus = isHard ? HARD_FLOOR_BONUS : FB, k = bonus * PARTIAL / f, sMax = bonus * PARTIAL;
    const y = unreachable ? null : addCol({ name: `y_${d}`, kind: "y", dim: d }, bonus, 0, 1, true);
    const sv = addCol({ name: `s_${d}`, kind: "s", dim: d }, 1, 0, sMax, false);
    if (y != null) addRow([...xs, [y, -f]], -c0, INF);
    addRow([[sv, 1], ...xs.map(([j, v]) => [j, -k * v])], -INF, k * c0);
    if (y != null) addRow([[sv, 1], [y, sMax]], -INF, sMax);
    // the core gives zero partial credit below a total of 0; s ≤ k·t would make such suits infeasible, so
    // when a negative total is possible a binary u marks it: u = 0 forces t ≥ 0, u = 1 forces s = 0
    let minReach = Math.min(0, c0); for (const s of Object.keys(xIndex)) minReach += Math.min(0, ...xIndex[s].map((j) => cols[j].item.props[d] || 0));
    if (minReach < 0) {
      const u = addCol({ name: `u_${d}`, kind: "u", dim: d }, 0, 0, 1, true);
      addRow([...xs, [u, -minReach]], -c0, INF);            // t + N·u ≥ 0 with N = −minReach
      addRow([[sv, 1], [u, sMax]], -INF, sMax);              // s ≤ sMax·(1 − u)
    }
  }
  for (const s of Object.keys(xIndex)) {                        // one per slot: = 1 when required and worn, else ≤ 1
    const req = !optional.has(s) && current[s] && current[s].slot === s;
    addRow(xIndex[s].map((j) => [j, 1]), req ? 1 : -INF, 1);
  }
  const twoH = (xIndex.twoHanded || []).filter((j) => cols[j].item.twoHanded === true), oneH = xIndex.oneHanded || [];
  if (twoH.length && oneH.length) addRow([...twoH, ...oneH].map((j) => [j, 1]), -INF, 1);   // a two-hander forbids the one-hand slot

  const model = { numCols: cols.length, numRows: rowLower.length, sense: "maximize", offset, colCost, colLower, colUpper, rowLower, rowUpper,
    matrix: { format: "csr", numRows: rowLower.length, numCols: cols.length, starts, indices, values }, integrality };
  return { cols, xIndex, fixed, dims, constTotals, unreachableFloors, hardRows, scoreOffset, model };
}
```

  plus `startVector`, `pickedOf`, `noGoodRow` (each ≤ 20 lines, per the Interfaces block; `startVector` computes each dim's total from the assignment + `constTotals` and fills `c`/`y`/`s`/`u` from the rules above). Note `Math.max(0, ...[])` is `0` and `Math.min(0, ...[])` is `0`, which is what an empty slot list should contribute.

- [ ] **Step 4: Run `node --test app/mip.test.mjs`** — PASS.

- [ ] **Step 5: Write `app/mip-solve.mjs`** — the HiGHS wrapper (~90 lines). `openModel` maps `model.sense` to `highs.constants.objectiveSense.maximize`, calls `createModel()` then `passModel(model)` (the typed arrays are plain arrays; HiGHS accepts `readonly number[]`), `options.set({ output_flag: false })`. `solveModel` sets `time_limit: timeLimitS`, `mip_rel_gap: 0`, `mip_abs_gap: 1e-3` (the spike's settings), calls `setSolution({ colValue: start })` when `start` is given, then `run({ [callbackType.mipImprovingSolution]: h, [callbackType.mipLogging]: h })` where `h` forwards `{kind, objective: e.data.objective_function_value, primal: e.data.mip_primal_bound, dual: e.data.mip_dual_bound, gap: e.data.mip_gap, nodes: Number(e.data.mip_node_count ?? 0n), runningTime: e.data.running_time}`; maps `getModelStatus()` through `highs.constants.modelStatus` (`optimal → "optimal"`, `timeLimit → "timeLimit"`, `infeasible → "infeasible"`, `interrupted → "interrupted"`, else `"other"` with `statusText` from a reverse lookup of the constants object), reads `getSolution().colValue` when the status is optimal or time-limit-with-an-incumbent (`model.info.get("primal_solution_status")` is feasible; when it is not, `colValue: null`), `objective = getObjectiveValue()`, `nodes = Number(model.info.get("mip_node_count"))`, `gapAbs = info mip_gap` is relative in HiGHS, so compute `gapAbs = Math.abs(dual − primal)` from the last event (or 0 when optimal). `addNoGood(handle, built, picked)` calls `handle.model.addRow(lower, upper, {indices, values})` with `noGoodRow`'s output. `closeModel` calls `dispose()` once. A model handle is `{highs, model, built}`.

- [ ] **Step 6: Solve test (append to `app/mip.test.mjs`)** — `[fast] HiGHS solves a 3-slot toy exactly and the no-good cut yields the runner-up`: pools of 3 items per slot for `ring`, `bracelet`, `talisman` with hand-picked props so the optimum is unique and known (write the brute force inline: 4×4×4 combinations including empties, scored with the same formula as `optScoreVector` copied as a 6-line helper); `loadHighs()` → `openModel` → `solveModel({timeLimitS: 10, start: startVector(built, {})})` → `pickedOf` equals the brute-force best, `objective + scoreOffset` equals its score within 1e-6; `addNoGood(handle, built, picked)` → solve again → the brute-force second best; `closeModel`. Also `[fast] loadHighs rejects under QM_FORCE_NO_HIGHS` (set and delete the env var inside the test; `loadHighs` must read the env on every call before consulting its memo).

- [ ] **Step 7: `npm test` PASS; commit** — `git add package.json package-lock.json app/mip.mjs app/mip.test.mjs app/mip-solve.mjs && git commit -m "Add the HiGHS dependency, the suit MIP builder and the solve wrapper"` (with the Claude-Session trailer).

---

### Task 2: The exact-solver orchestrator in the worker, one worker per job, solver-equivalence tests

**Files:**
- Create: `app/exact-solver.mjs`, `app/solver.test.mjs`
- Modify: `app/optimize-worker.mjs`, `app/vault-server.mjs:202-320` (jobs section) and its imports (drop `availableParallelism`, `shared-search.mjs`), `app/server.test.mjs` (the optimize tests keep passing; one new case)

**Interfaces:**
- Consumes: Task 1's modules; `core.optimizeSuit(pools, current, profile, opts)` and `core.scoreSet`; the worker's `workerData = {coreUrl, pools, current, profile, opts}`.
- Produces: `solveExact({core, pools, current, profile, opts, onProgress, onWarn = () => {}, loadHighs = defaultLoadHighs, now = Date.now}) → Promise<OptResult>`; the worker posts `{type: "progress"|"done"|"error"|"warn"}`; the server logs `warn` messages to `<data>/logs/server.log` with the job id.

- [ ] **Step 1: Write `app/exact-solver.mjs`** — the orchestration, in this order:
  1. `t0 = now()`; `budget = opts.timeBudgetMs ?? 15000`; `restarts = opts.restarts ?? 200`; `optionalSlots = opts.optionalSlots ?? DEFAULT_OPTIONAL_SLOTS`.
  2. Heuristic start: `heur = core.optimizeSuit(pools, current, profile, {...opts, exact: false, restarts, onProgress: (p) => onProgress({...p, at: now()})})` — the core emits `phase: "heuristic"` events itself. `heuristicMs = now() − t0`.
  3. `built = buildSuitMip({pools, current, profile, optionalSlots})`. If `built.cols.every((c) => c.kind !== "x")` (everything fixed or empty) → return `{...heur, method: "exact", proven: true, solver: "none", bound: heur.score, gapPoints: 0, mipMs: 0, heuristicMs, unreachableFloors: built.unreachableFloors}`.
  4. `highs = await loadHighs()` inside try; on throw → `onWarn(\`HiGHS unavailable: ${e.message}\`)` and return the fallback: `{...heur, method: "heuristic", solver: "fallback", fallbackReason: String(e.message).slice(0, 200), bound: null, gapPoints: null, mipMs: 0, heuristicMs, unreachableFloors: built.unreachableFloors}`.
  5. `handle = openModel(highs, built)`; in `try … finally closeModel(handle)`: `remaining = () => Math.max(1, (budget − (now() − t0)) / 1000)` seconds; progress throttle 250 ms; `emit(kind, ev)` posts `{phase: "exact", elapsedMs, budgetMs: budget, bestScore: toScore(ev.primal), bound: toScore(ev.dual), gapPoints: Math.max(0, toScore(ev.dual) − toScore(ev.primal)), nodes: ev.nodes, candidates: built.xIndex count, solver: "highs", currentScore: heur.currentScore, at}` where `toScore = (v) => v + built.scoreOffset` (the core's score scale; the objective already includes `model.offset`). `solve = solveModel(handle, {timeLimitS: remaining(), start: startVector(built, heur.best), onEvent})`.
  6. If `solve.status === "infeasible"`: hard floors conflict jointly. `closeModel(handle)`; rebuild with `hardAsSoft: true`, reopen, solve again; set `floorsConflict = true`. If still infeasible or `colValue` is null → return the fallback shape with `solver: "highs"`, `proven: false`, `floorsConflict: true`, `method: "exact"` … no: return `{...heur, method: "heuristic", solver: "fallback", fallbackReason: "no suit satisfies the required floors", floorsConflict: true, …}` (the honest outcome; the page shows the floors report).
  7. `picked = pickedOf(built, solve.colValue)`; `mipScore = solve.objective + built.scoreOffset`.
  8. k-best: `alt = opts.alternatives?.count > 0 ? opts.alternatives : null`; `alternatives = []`; for `k < alt.count`: `addNoGood(handle, built, lastPicked)`; `onProgress({phase: "alternatives", found: alternatives.length, wanted: alt.count, elapsedMs, budgetMs, bestScore: mipScore, at})`; `sk = solveModel(handle, {timeLimitS: remaining()})`; stop unless `sk.status === "optimal"`; `score = sk.objective + scoreOffset`; stop if `score < mipScore − (alt.tolerance || 0) − 1e-9`; push `{best: assignmentOf(pickedOf(built, sk.colValue)), score: rescored}` where `rescored = core.scoreSet(assignment, profile)`; `lastPicked` = that pick. `assignmentOf(picked)` = `Object.fromEntries(DEFAULT_SLOTS.map((s) => [s, picked[s] || null]))`.
  9. Report through the core: `final = core.optimizeSuit(pools, current, profile, {...opts, exact: false, restarts: 0, warmStart: serialsOf(picked)})` (`serialsOf` = slot → serial|null; the core's local search from the MIP's suit stays on it or finds a strictly better one). `if (final.score > mipScore + 1e-6) { onWarn(\`core improved on HiGHS by ${final.score − mipScore}\`); proven = false; }`. `if (Math.abs(final.score − mipScore) > 1e-3 && final.score < mipScore) throw new Error("re-score mismatch")` — this must never happen (the warm start is the MIP's own suit); a throw surfaces as a job error with a ref, not a wrong suit.
  10. Return `{...final, method: "exact", proven: solve.status === "optimal" && !improved, solver: "highs", bound: toScore(last dual or solve.objective when optimal), gapPoints, nodes: solve.nodes, restarts, evaluations: heur.evaluations + final.evaluations, alternatives: alt ? alternatives : undefined, altTolerance: alt ? Math.max(0, alt.tolerance || 0) : undefined, mipMs, heuristicMs, floorsConflict, unreachableFloors: built.unreachableFloors, pruned: undefined, workers: undefined}`.

- [ ] **Step 2: Worker** — `app/optimize-worker.mjs`: import `solveExact`; `const result = opts.exact ? await solveExact({core, pools, current, profile, opts, onProgress: post("progress"), onWarn: (m) => parentPort.postMessage({type: "warn", message: m})}) : core.optimizeSuit(pools, current, profile, {...opts, onProgress})`; remove the `shared`/`sharedApi` import and the `minTasks` destructure; keep the try/catch → `{type: "error"}`.

- [ ] **Step 3: Server** — in `vault-server.mjs`: delete `runParallel`, `WORKERS`, `SOLO_MS`, the `shared-search.mjs` and `availableParallelism` imports, and the `mergeAlternatives`/`makeShared`/`readBest` uses; `runJob` becomes: spawn one worker with `{pools, current, profile, opts}`, forward every progress event through `emitProgress(job, p)`, on `warn` append `${iso} job ${job.id} warn: ${message}\n` to `CONFIG.paths.log`; the rest unchanged (`saveRun`, `finish`). Update the file's header comment (the "8 threads" sentences). In `spawnWorker`, handle `m.type === "warn"` via a new `onWarn` argument. Pool-size warning (§11c): in the POST route, if `poolSize > 50000` set `job.meta.warning = "over 50,000 candidates; the exact solver may take a while"` (the page shows it in Task 3).

- [ ] **Step 4: Solver-equivalence tests (`app/solver.test.mjs`)** — a helper `cell(profileName, {soft = [], overrides = {}} = {})` folds `adapters/tazuo/fixture.scan.json` (through `upgradeScan`, rules `uoalive`), builds pools for the fixture character "Fixture" with `buildPools(inv, "Fixture", {excludeGargoyle: true})`, takes the template `app/data/profiles.default.json → templates[profileName]` (read the file to learn the template names; use every template in a loop where the test says "each template"), applies `softFloors = soft` and `overrides`, and returns `{pools, current, profile: effectiveProfile(p, inv.characters.Fixture)}`. `core` is `await import(pathToFileURL(buildCore()).href)`. Tests:
  - `[fast] each default template: HiGHS equals the core's proven optimum on the fixture` — for each template: `r = await solveExact({core, pools, current, profile, opts: {exact: true, timeBudgetMs: 20000, restarts: 50, seed: 2026}, onProgress: () => {}})`; `ref = core.optimizeSuit(pools, current, profile, {exact: true, timeBudgetMs: 20000, restarts: 50, seed: 2026})`; assert `r.solver === "highs"`, `r.proven === true`, `ref.proven === true` (the fixture is 319 items; if a template does not prove in 20 s, assert `r.score >= ref.score − 1e-6` instead and note it), `Math.abs(r.score − ref.score) < 1e-3`, and `Math.abs(core.scoreSet(r.best, profile) − r.score) < 1e-6` (the returned score is the core's own re-score).
  - `[fast] soft floors match` — the first template with two of its floors moved to `softFloors`: same equality.
  - `[fast] k-best matches the core's alternatives score for score` — `opts.alternatives = {count: 3, tolerance: 1e9}` on both; assert the sorted score lists are equal within 1e-3 and no alternative equals the best's serial set.
  - `[fast] an unreachable hard floor scores the core's partial credit` — override `floors: {...floors, luck: 5000}` hard; assert `r.unreachableFloors` includes `luck`, `r.proven`, and score equality with the core.
  - `[fast] jointly unreachable hard floors fall back honestly` — tiny synthetic pools (`ring: [{phys 10}], bracelet: [{fire 10}]`, floors `physResist ≥ 10, fireResist ≥ 10` hard, both slots optional, one more slot with items so the MIP has structure); the per-slot maxima say both are reachable but no suit meets both → `r.floorsConflict === true`; `r.solver === "highs"` after the `hardAsSoft` retry with `Math.abs(r.score − coreBruteForce) < 1e-3`.
  - `[fast] a negative total on a soft-floored dimension gets zero credit, like the core` — synthetic: one candidate with `manaRegen: −3`, soft floor `manaRegen ≥ 2`, weights that make that item worth taking; assert equality with the core's exact result.
  - `[fast] HiGHS unavailable → the heuristic result, flagged` — `solveExact({..., loadHighs: async () => { throw new Error("nope"); }})` → `r.solver === "fallback"`, `r.method === "heuristic"`, `r.fallbackReason` contains `nope`, `r.best` equals the core's heuristic best for the same seed/restarts.
  - `[fast] progress reports the exact phase with a bound` — collect events; at least one `phase: "exact"` event with numeric `bestScore`, `bound`, `gapPoints ≥ 0`, `solver: "highs"`.
  - `[slow] a 3,000-item generated cell: HiGHS proves and the core agrees where it proves` — `learnModel([upgradedFixture], lib)` + `generateScan(model, {n: 3000, gearFraction: 1, seed: 7, lib})` from `app/bench/gen-inventory.mjs` (both exported; `generateScan` returns a raw v1-shaped scan → `upgradeScan`), fold with the fixture, first template, `timeBudgetMs: 60000` for the core; assert HiGHS `proven` within 20 s (`r.mipMs < 20000`), and equality when `ref.proven`, else `r.score ≥ ref.score − 1e-6`. `{ skip: process.env.TEST_SKIP_SLOW === "1" }`.

- [ ] **Step 5: Server test** — append to `app/server.test.mjs`: `[fast] POST /api/optimize exact: the job finishes with solver "highs", proven, and the saved run carries the same score` (poll `/status` every 100 ms up to 30 s; assert `result.solver === "highs"`, `result.proven === true`, `runId` set, `GET /api/runs/<id>` → `run.result.score === result.score`). The existing supersede/client-id/error tests must still pass (they post with `exact: true`; the worker now runs HiGHS).

- [ ] **Step 6: `npm test` PASS (full, including `[slow]`); commit** — `git add app && git commit -m "Run the exact search through HiGHS in the worker; retire the multi-thread branch-and-bound path"`.

---

### Task 3: The page shows the MIP's progress and verdict; `docs/solver.md`

**Files:**
- Modify: `app/ui/builder.mjs` (`runPanel` phases/text at lines ~229-278, `runStats` ~279-297), `app/index.html` (nothing structural unless a class is missing), `app/ui/styles.css` (only if a new pill class is needed)
- Create: `docs/solver.md`

**Interfaces:**
- Consumes: progress `{phase: "heuristic"|"exact"|"alternatives"|"done", …}` and result fields from Task 2's Global Constraints list; `meta.warning` from the job (exposed in `GET /api/optimize/<id>/status`? — no: the POST response; add `warning` to the POST response body in `vault-server.mjs` when set).
- Produces: nothing new for other tasks.

- [ ] **Step 1: Progress panel** — `PHASES = [["heuristic", "hill climbing"], ["exact", "proving with HiGHS"], ["alternatives", "other suits"]]`; in `update`: `exact` → `line.textContent = \`best so far ${fmtN(p.bestScore − p.currentScore)} over the worn suit · at most ${fmtN(p.gapPoints)} points from the bound · ${fmtN(p.nodes)} nodes · ${fmtN(p.candidates)} candidates\``, bar = `min(1, elapsed/budget)`; `alternatives` → `\`${p.found} of ${p.wanted} other suits found\``. Remove the `prune` phase and the `workers` mention. Keep the heartbeat.

- [ ] **Step 2: Result stats** — `runStats`: verdict pill: `res.solver === "fallback"` → `["exact solver unavailable — heuristic result; check the floors below", "warn"]` with `title = res.fallbackReason`; `res.floorsConflict` → `["no suit meets every required floor — best partial suit", "warn"]`; `res.method === "exact" && res.proven` → `["proven optimal for this inventory", "good"]`; exact not proven → `["best found within the time budget — at most ${fmtN(res.gapPoints)} points from the bound; raise the budget to finish", "warn"]`; heuristic → unchanged. Stats: `candidates` from `poolSize`; `search nodes` when `res.nodes`; `solver` = `HiGHS`/`heuristic`; `other suits` unchanged; `time` = `fmtSecs(r.ms)` plus `(heuristic ${fmtSecs(res.heuristicMs)} · HiGHS ${fmtSecs(res.mipMs)})` when both present; drop `suits scored` and `threads`. Show `meta.warning` (from the POST response, stored on the job) as a `msg warn` line above the panel. `res.unreachableFloors.length` → a small line "these required floors cannot be reached by any suit in the pool: …" using `label()`.

- [ ] **Step 3: Saved runs** — `renderRuns`/`openRun` in `ui/runs.mjs` read `explored` for old runs; a run without it renders as before (no change needed — verify by opening a Phase 2 run in `--demo` after a build: no console error).

- [ ] **Step 4: `docs/solver.md`** — ~80 lines: the problem statement, the variables and rows (copy the comment lines from `mip.mjs`), the score mapping (`objective + scoreOffset`), soft floors, negative totals, unreachable and conflicting floors, k-best cuts, the MIP start, progress (incumbent/bound/gap), the fallback rule ("the heuristic's result is never shown as meeting the floors without the requirements report"), the pool-size warning, numbers from `app/bench/REPORT.md` (30k in 2.5 s, 50k all-gear in 8.6 s, single-threaded WASM), and how to run the equivalence tests. Link it from `README.md`'s docs list.

- [ ] **Step 5: Browser gate** — `node scripts/start.mjs --demo --port 0`, open the page, Suit Builder → build with exact on: the panel shows the three phases, the result shows "proven optimal" and the solver stat; no console errors. Report what was seen.

- [ ] **Step 6: `npm test` PASS; commit** — `git add app docs README.md && git commit -m "Show the HiGHS solve in the builder panel and document the model"`.

---

### Task 4: Server-side inventory cache, item query module, `/api/items`, slim `/api/inventory`, `/api/optimize` by character

**Files:**
- Create: `app/item-query.mjs`, `app/item-query.test.mjs`
- Modify: `app/vault-server.mjs` (`readScans` → `getInventory()`, routes), `app/server.test.mjs`, `app/vault-lib.mjs` (only if `groupByName` needs a JSON-safe variant — see Step 2)

**Interfaces:**
- Produces:
  - `EXTRA_COLS = { strReq: ["STR req", "Strength Requirement"], weight: ["Wt", "Weight (stones)"] }`, `colVal(it, key)` (moved from `ui/dom.mjs`; `dom.mjs` re-exports both from `../item-query.mjs`), `rarityRank(ladder, name) → 1-based index or 0`.
  - `parseItemQuery(searchParams) → {q, slot, loc, rarity, kind, seenDays, slayer, nogarg, med, hideTags: string[], props: [{key, min}], group: bool, sort, dir: 1|-1, offset, limit}` — `hide=a,b`, `prop=hci:10,dci:5`, `nogarg=1`, `med=1`, `group=1`, `dir=-1`, `limit` clamped to `[1, 500]` default 200, `offset ≥ 0`, `sort` default `"name"`.
  - `applyItemQuery(items, query, {rarity: ladder, now = Date.now()}) → {rows, total, pieces}` — the exact predicate of the page's `filtered()` (`app/ui/inventory.mjs:405-420`, with `state.hideTags` → `query.hideTags`, `state.propFilters` → `query.props`, `$("#f-text")` → `query.q`) and the exact sort of `renderInventory()` (name/seen/rarity/kind/amount/slot/location/column keys; `slotLabel` from `vault-lib`'s `SLOT_LABELS`), then `rows = sorted.slice(offset, offset + limit)`; `total = sorted.length`, `pieces = Σ amount||1` over all matches. With `group: true`: `{groups, total}` where `groups` are `groupByName(matches)` sorted as the page sorts groups, sliced, and each group is JSON-safe: `{name, kind, slot, amount, stacks, locations: [[text, n], …]}` (no `items`, no `Map`).
  - `facetsOf(items, {rarity: ladder}) → {slots: string[] (sorted), locations: string[] (sorted), rarities: string[] (ladder order), slayers: [{name, count}], slayerAny: number, kinds: [{name, count}] (KINDS order, present only), propKeys: string[] (via propertyKeys), itemCount}`.
  - Server: `getInventory() → {inv, snapshotCount, stamp}` cached by a signature of the scans directory (`readdirSync` names + `statSync` mtimeMs + size, joined) plus the current shard id and the `vault-lib.mjs` mtime (the dev reload `lib()` already keys on); recomputed on change. Routes:
    - `GET /api/inventory` → `{ok, snapshotCount, demo, inventory: {scans, characters, containers, worn: {[name]: item[]}, rootCounts: {[serial]: n}, itemCount, facets, propKeys}}` — `worn[name]` = items with `equippedBy === name` (full item objects), `rootCounts` = items per root serial.
    - `GET /api/items?…` → `{ok, total, pieces, offset, limit, rows}` or with `group=1` `{ok, total, offset, limit, groups}`.
    - `POST /api/optimize` with `character`: `settings = {allowOthersWorn=false, strLimit=Infinity, excludeTags=[], excludeRoots=[], allowGargoyle=false, medOnly=false, weaponSkill=null, excludeSkills=[], lockedSlots=[]}` (validate types: strings/arrays/booleans, 400 otherwise); `{pools, current, skipped, blocked} = buildPools(inv, character, {allowOthersWorn, strength: strLimit, excludeTags, excludeRoots, excludeGargoyle: !allowGargoyle, medOnly, weaponSkill, excludeSkills})`; delete `current[s]` for blocked; `pools[s] = []` for locked; `opts.optionalSlots = DEFAULT_OPTIONAL_SLOTS.filter((s) => !lockedSlots.includes(s))`; then the existing flow. The response (cached or started) adds `poolSize`, `skipped` (counts per key), `current`, `blocked`, `warning?`. The old body form (`pools`/`current` given, no `character`) still works and gets the same extra fields (`poolSize` computed, `skipped: {}`).

- [ ] **Step 1: `app/item-query.test.mjs`** (`[fast]`, on hand-made items ~12 with props/tags/slayers/kinds/locations/seenAt): parse defaults and clamps; text search hits `itemSearchBlob`; each filter individually; `hideTags`; `props` min; `seenDays` cut; sort by a prop column desc then asc; sort by rarity uses the ladder; paging (`offset/limit`, `total`, `pieces`); group mode shapes and sorts; `facetsOf` counts; `rarityRank` unknown → 0.

- [ ] **Step 2: Write `app/item-query.mjs`** (imports `itemSearchBlob, groupByName, KINDS, SLOT_LABELS, propertyKeys` from `./vault-lib.mjs`; no DOM). Tests PASS. Then `ui/dom.mjs`: replace its `EXTRA_COLS`/`colVal` definitions with `export { EXTRA_COLS, colVal } from "../item-query.mjs";` and make `rarityRank = (name) => rarityRankOf(state.rules?.rarity || [], name)` importing `rarityRank as rarityRankOf`. Add `/item-query.mjs` to the server's static allowlist (a plain `GET /item-query.mjs` route like `/vault-lib.mjs`) and a `[smoke]` server test that it is served as `text/javascript` with nosniff.

- [ ] **Step 3: Inventory cache + routes** in `vault-server.mjs` per the Interfaces block. `readScans()` stays as the loader the cache calls. `/api/forget` and the tombstone path need no change (the signature changes when the file lands). The header comment's route list gains `/api/items` and the new POST form.

- [ ] **Step 4: Server tests** (`app/server.test.mjs`): `[smoke] /api/inventory carries facets, worn gear and counts, and no item list` (assert `inventory.items === undefined`, `itemCount > 0`, `facets.kinds.length > 0`, `Object.keys(worn).length > 0`); `[fast] /api/items pages, sorts and searches` (limit 5 → 5 rows and `total` = itemCount; `sort=name&dir=-1` reverses; `q=` of a known fixture item name matches ≥ 1; `limit=9999` clamps to 500; `group=1` returns groups); `[fast] /api/optimize by character builds the same pools as the client did` (post `{character, settings: {}, profile, opts: {exact: false}}` → response `poolSize` equals `buildPools(inv, character, {}).pools` flattened length, `current` deep-equals; post the old form with those pools → `cached: true` on one of the two orders — i.e. the run keys agree); `[fast] /api/optimize by character with a bad settings type is 400`; `[fast] a new scan file changes /api/inventory without a restart` (write a second fixture-derived scan with a new serial into the tmp scans dir; `itemCount` grows). Rewrite the existing optimize tests to the new form where they build pools client-side only to obtain `profile` (they may keep the old body form; it is still supported).

- [ ] **Step 5: `npm test` PASS; commit** — `git add app && git commit -m "Cache the folded inventory, page and search items on the server, build pools by character"`.

---

### Task 5: The page consumes facets, worn gear and item pages; the builder posts by character

**Files:**
- Modify: `app/ui/store.mjs`, `app/ui/app.mjs`, `app/ui/inventory.mjs`, `app/ui/characters.mjs`, `app/ui/sheet.mjs`, `app/ui/containers.mjs`, `app/ui/builder.mjs` (`runBuild`), `app/ui/runs.mjs` (only if it touched `state.items` — it does not), `app/index.html` (pager row), `app/ui/styles.css` (pager)

**Interfaces:**
- Consumes: Task 4's routes and `item-query.mjs` (`EXTRA_COLS`, `colVal` via `dom.mjs`).
- Produces: `state.query` (the `parseItemQuery` shape, page-side source of truth), `state.page = {rows, groups, total, pieces}`, `state.facets`; `fetchItems()` (debounced 150 ms, serialised: a stale response is dropped by a request counter).

- [ ] **Step 1: store/app** — `store.mjs`: remove `items`, add `facets: null, query: {q: "", slot: "", loc: "", rarity: "", kind: "", seenDays: 0, slayer: "", nogarg: false, med: false, hideTags: [], props: [], group: false, sort: "name", dir: 1, offset: 0, limit: 200}, page: {rows: [], groups: null, total: 0, pieces: 0}`; keep `hideTags`/`propFilters`/`sortKey`/`sortDir` only if still referenced (they are folded into `query` — delete them). `app.mjs` `load()`: `state.facets = inv.inventory.facets; state.propKeys = inv.inventory.propKeys;` status line uses `inv.inventory.itemCount`; call `buildFilters(); fetchItems(); …`.

- [ ] **Step 2: inventory.mjs** — `buildFilters` populates the selects from `state.facets` (slots/locs/rarities/slayers with counts/kinds with counts) and binds every input to `onFilterChange()` which reads the controls into `state.query` (offset reset to 0) and calls `scheduleFetch()`; `renderPropFilters`/`renderColChips` write `state.query.props` / `state.cols`; `fetchItems()` builds the query string (`hide=`, `prop=key:min,…`, `group=1`, …) → `api("/api/items?…")` → `state.page` → `renderInventory()`; `renderInventory()` draws `state.page.rows` (or groups) exactly as before minus the `slice(0, 800)` cap, the count line `\`${fmtN(total)} stacks · ${fmtN(pieces)} pieces\``, header click sets `query.sort/dir` and fetches; the pager (`#inv-pager`, new `<div class="row pager">` under the table in `index.html`): `‹ prev`, `\`${offset + 1}–${min(offset + limit, total)} of ${total}\``, `next ›`, and a page-size `<select>` 100/200/500. Empty state text unchanged.

- [ ] **Step 3: characters/sheet/containers** — `state.items.filter((i) => i.equippedBy === name)` → `state.inv.worn[name] || []` in `characters.mjs:17,45` and `sheet.mjs:29`; `containers.mjs:17` → `state.inv.rootCounts[r.serial] || 0`.

- [ ] **Step 4: builder.mjs `runBuild`** — stop calling `buildPools`; post `{character: name, settings: {allowOthersWorn: p.allowOthersWorn, strLimit: p.strLimit, excludeTags: p.excludeTags, excludeRoots: p.excludeRoots, allowGargoyle: p.allowGargoyle, medOnly: p.medOnly, weaponSkill: p.weaponSkill, excludeSkills: p.excludeSkills || [], lockedSlots: p.lockedSlots}, profile: optimizerProfile(), opts: {restarts, exact, timeBudgetMs, alternatives?}, meta: {character, settings: settingsSnapshot(), inventoryStamp: invStamp()}}`; take `job.poolSize`, `job.skipped` (counts), `job.current`, `job.warning` from the response; `meta.poolSize/skipped` are set by the server now (move that into the POST route: `meta.poolSize = poolSize; meta.skipped = counts`). Remove the now-unused `buildPools` import if nothing else in the file uses it (`grep`).

- [ ] **Step 5: Browser gate** — `--demo`: Inventory tab shows rows with the count line and a working pager, search narrows as you type, a header sort flips, group view works; Characters shows worn gear; Containers shows counts; Suit Builder builds (exact) and shows the result; Grab/Highlight buttons still render (bridge chain from containers). No console errors, no 4xx/5xx in the network log. Report.

- [ ] **Step 6: `npm test` PASS; commit** — `git add app && git commit -m "Page the inventory table from the server and post builds by character"`.

---

### Task 6: Retire the parallel search everywhere, docs and the phase gate

**Files:**
- Delete: `app/shared-search.mjs`
- Modify: `scripts/optimizer-core.ts` (remove `OptShared`, `opts.shared`, `minTasks`, the `shared ? … : …` branches in `optBranchAndBound` and `optimizeSuit`, `tasks`/`tasksDone` from progress if they were only for shared mode — keep `explored`), `app/gear-vault.test.mjs` (drop the simulated-workers test at ~682 and the `mergeAlternatives` import + "split" half of the alternatives test at ~695; keep the single-thread proofs), `app/bench/run-bench.mjs` (remove the parallel cell and the `makeShared` import; the bench's exact cells keep running the core), `app/bench/README.md` (a paragraph: the core's exact search is the reference, the app solves with HiGHS; `mip-spike.mjs` is the origin of `app/mip.mjs`), `app/bench/mip-spike.mjs` (header line: "superseded by app/mip.mjs + app/exact-solver.mjs; kept as evidence"), `TESTING.md`, `README.md`, `CHANGELOG.md`, `CONTRIBUTING.md`

- [ ] **Step 1: Core** — remove the shared plumbing; `npm test` (full) must keep every `[slow]` brute-force proof green; `grep -n shared scripts/optimizer-core.ts app/*.mjs` returns nothing.
- [ ] **Step 2: Bench** — `node app/bench/run-bench.mjs --help` (or its documented invocation with a tiny N) still runs a core cell; no reference to `shared-search`.
- [ ] **Step 3: Docs** — `TESTING.md`: the new files (`mip.test.mjs`, `solver.test.mjs`, `item-query.test.mjs`), the `[slow]` generated-cell equivalence test, `QM_FORCE_NO_HIGHS`, and the statement that `[fast]` now includes short HiGHS solves (a few seconds). `README.md`: status "Phase 3 done, Phase 4 (Electron shell) next", "one runtime dependency: HiGHS (MIT, WebAssembly)", link `docs/solver.md`. `CONTRIBUTING.md`: replace any "zero dependencies" rule with "no new runtime dependencies without a spec change; HiGHS is the one". `CHANGELOG.md`: Phase 3 entries (solver, server pools, paged inventory, the retired parallel search, the new routes). `grep -rn -i "zero runtime dep\|zero-dependency\|8 threads\|workers" README.md CONTRIBUTING.md TESTING.md docs app/vault-server.mjs` → nothing stale remains.
- [ ] **Step 4: Phase gate** — `npm test` (full) green; `npm run test:smoke` green; `node scripts/start.mjs --demo --port 0` boots and the coordinator's browser pass from Task 5 is repeated once; `git status` clean apart from ignored files.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "Retire the multi-thread branch-and-bound; document the HiGHS solver and the paged inventory"`.

---

## Self-review

- **Spec coverage.** §7(1) HiGHS as the exact solver in the existing worker: Tasks 1–2. Soft floors, k-best with proper no-good cuts, worker execution: Task 1 builder + Task 2 orchestrator. Progress via incumbent + gap: Task 2 step 1.5 / Task 3. MIP start from the heuristic: Task 2 step 1.5 (`startVector(built, heur.best)`). Fallback when the WASM fails to load, result never shown as meeting floors without a check: Task 2 step 4 + Task 3 verdict pill and the requirements report the page already renders. §7(2) pools on the server + paged, server-searched table: Tasks 4–5. §7(3) pruning no longer used for the search: Task 6 (the core keeps it only as the reference). §11b layer 3 equivalence tests incl. soft floors and k-best, slow cases tagged: Task 2 step 4. §11c row 1 (fallback, gap shown, warning above ~50k candidates): Tasks 2–3. §12 Phase 3 list: complete.
- **Placeholder scan.** No TBD/TODO. Every step names its file, its assertions and its command. The builder code is complete; the three helper functions are specified by their contracts (each is a direct read of the builder's arrays).
- **Type consistency.** `buildSuitMip`'s `built` fields (`cols, xIndex, fixed, dims, constTotals, unreachableFloors, hardRows, scoreOffset, model`) are what `startVector`, `pickedOf`, `noGoodRow`, `openModel` and `solveExact` read. `solveModel`'s `{status, objective, primal, dual, gapAbs, nodes, colValue, ms}` is what the orchestrator consumes. Progress and result field names match between Task 2 (producer) and Task 3 (consumer). `/api/optimize`'s new response fields (`poolSize, skipped, current, blocked, warning`) match Task 5's `runBuild`. `EXTRA_COLS`/`colVal` move to `item-query.mjs` in Task 4 and `dom.mjs` re-exports them, so Task 5's page code keeps its imports.
- **Rulings made for the user (report at the merge):** the `u` binary for negative totals on soft-floored dimensions (an exactness gap the spike never hit); jointly conflicting hard floors fall back to the heuristic suit flagged `floorsConflict` rather than a 1e7-coefficient soft model; the core's parallel search is removed rather than left dormant; the wasm is 3.5 MB, not the spec's ~2 MB.
