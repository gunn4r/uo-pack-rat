// finish.test.mts — `app/solver/finish.mts`, everything a build does after the search (issue #338).
//
// `[fast]`: on the core's result for the fixture's melee template, `finishResult` names the tie-break it ran with (fewest changes, tolerance, the changes), summarizes Strict order's stages (one value per stage, all proven by the heuristic's own proof, the changes), drops the solver's internal `lex`, gives the suit and every alternative (one put on the result by hand: the heuristic finds none) its score shares, and attaches diagnostics; a diagnostics failure costs only the diagnostics (the result still goes out, with its shares, and `onWarn` says why).
import { test } from "node:test";
import assert from "node:assert/strict";
import { core, cell } from "../solver-fixture.mts";
import { finishResult } from "./finish.mts";
import { DEFAULT_SLOTS } from "../mip.mts";

const opts = { exact: false, restarts: 10, seed: 3 } as const;

test("[fast] finish: the tie-break and Strict order summaries, shares for every suit, and diagnostics", () => {
  const { pools, current, profile } = cell("melee");
  const tbOpts = { ...opts, tieBreak: { tolerance: 25, fewestChanges: true } };
  // alternatives come from the exact phase only; one stands in here, the found suit again
  const found = core.optimizeSuit(pools, current, profile, tbOpts), withAlt = { ...found, alternatives: [{ best: found.best, score: found.score }] } as typeof found;
  const tb = finishResult({ core, result: withAlt, pools, current, profile, opts: tbOpts, swingNote: null, onWarn: (m) => assert.fail(m) });
  const summary = tb.tieBreak as { tolerance?: number; fewestChanges?: boolean; changes?: number } | undefined;
  assert.deepEqual([summary?.tolerance, summary?.fewestChanges, typeof summary?.changes], [25, true, "number"]);
  assert.ok(Array.isArray(tb.diagnostics), "diagnostics attached");
  assert.ok(tb.shares && tb.shares.length > 0, "the suit's shares");
  assert.ok(tb.alternatives && tb.alternatives.length > 0 && tb.alternatives.every((a) => Array.isArray((a as { shares?: unknown }).shares)), "every alternative's shares");

  const ranks = [Object.keys(profile.weights || {}).slice(0, 2)], stOpts = { ...opts, strict: { ranks, fewestChanges: true } };
  const raw = core.optimizeSuit(pools, current, profile, stOpts);
  const st = finishResult({ core, result: raw, pools, current, profile, opts: stOpts, swingNote: null, onWarn: (m) => assert.fail(m) });
  const stages = core.optStrictStages(profile, ranks, true);
  assert.deepEqual(st.strict?.stages.map((s) => s.kind), stages.map((s) => s.kind));
  assert.deepEqual(st.strict?.stages.map((s) => s.value), raw.lex);
  assert.equal(st.strict?.proven, raw.proven ? stages.length : 0);
  assert.equal(st.strict?.changes, core.optChanges(raw.best, current, DEFAULT_SLOTS));
  assert.equal("lex" in st, false, "the solver's own stage values stay internal");
});

test("[fast] finish: a diagnostics failure costs only the diagnostics", () => {
  const { pools, current, profile } = cell("melee");
  const result = core.optimizeSuit(pools, current, profile, opts), warnings: string[] = [];
  const broken = new Proxy(current, { get: () => { throw new Error("boom"); }, ownKeys: () => { throw new Error("boom"); } });
  const done = finishResult({ core, result, pools, current: broken, profile, opts, swingNote: null, onWarn: (m) => warnings.push(m) });
  assert.equal(done.diagnostics, undefined);
  assert.deepEqual(done.best, result.best);
  assert.ok(done.shares && done.shares.length > 0, "the shares still go out");
  assert.equal(warnings.length, 1);
  assert.match(warnings[0]!, /^diagnostics failed, the result goes out without them: .*boom/);
});
