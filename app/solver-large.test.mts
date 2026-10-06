// solver-large.test.mts — app/solver.test.mts's one real-sized case, a 3,000-item generated cell, in a file of its own.
//
// `[slow]`: solver.test.mts's real-sized case, in its own file so it runs in parallel with the rest: a generated 3,000-item cell that HiGHS must prove (in about 10 s), with the core agreeing wherever the core also proves it in its 60 s budget, and otherwise no better than HiGHS. The core usually runs out that budget, which makes this the suite's slowest file.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPools, effectiveProfile, foldSnapshots } from "./vault-lib.mts";
import * as VaultLib from "./vault-lib.mts";
import { upgradeScan } from "./scan-schema.mts";
import type { ScanV2 } from "./schema/types.d.mts";
import { solveExact, type OptPools, type OptAssignment } from "./exact-solver.mts";
import { learnModel, generateScan } from "./bench/gen-inventory.mts";
import { core, defaultProfiles, fixture, templateNames, type OptOptions } from "./solver-fixture.mts";

test("[slow] a 3,000-item generated cell: HiGHS proves and the core agrees where it proves",
  { skip: process.env.TEST_SKIP_SLOW === "1" }, async () => {
    const model = learnModel([fixture], VaultLib);
    const genRaw = generateScan(model, { n: 3000, gearFraction: 1, seed: 7, lib: VaultLib });
    const genScan = upgradeScan(genRaw, { shard: "uoalive" }) as ScanV2;   // known-good generated scan: same cast as `fixture` above
    const bigInv = foldSnapshots([fixture, genScan]);
    const { pools, current } = buildPools(bigInv, "Fixture", { excludeGargoyle: true });
    const name = templateNames[0]!;
    const profile = effectiveProfile(defaultProfiles.templates![name], bigInv.characters.Fixture!);
    const opts: OptOptions = { exact: true, timeBudgetMs: 60000, restarts: 50, seed: 2026 };
    const r = await solveExact({ core, pools: pools as unknown as OptPools, current: current as unknown as OptAssignment, profile, opts, onProgress: () => {} });
    assert.equal(r.solver, "highs");
    assert.ok(r.proven, "HiGHS should prove within the 60s budget on a 3,000-item pool");
    assert.ok(r.mipMs < 20000, `mipMs was ${r.mipMs}, expected under 20000`);
    const ref = core.optimizeSuit(pools as unknown as OptPools, current as unknown as OptAssignment, profile, opts);
    if (ref.proven) assert.ok(Math.abs(r.score - ref.score) < 1e-3, `${r.score} vs ${ref.score}`);
    else assert.ok(r.score >= ref.score - 1e-6, `HiGHS ${r.score} worse than the core's ${ref.score}`);
  });
