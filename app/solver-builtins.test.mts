// solver-builtins.test.mts — every UO Alive build template (issue #212) builds on the fixture with both solvers.
//
// `[slow]`: each build template in `app/data/templates/uoalive.json` (all but the four generic starters, which `solver-templates.test.mts` covers), planned with its own buffs and soft floors on the TazUO fixture, runs through HiGHS and the core (`runBoth`: no throw, HiGHS no worse than the core) and its result raises no `weight_dominates`. The casters' `floors_conflict` on this melee character's inventory is expected and allowed. A file of its own so the runner runs it in parallel with the other solver files.
import { test } from "node:test";
import assert from "node:assert/strict";
import { BASE_OPTS, cell, defaultProfiles, runBoth, templateNames } from "./solver-fixture.mts";
import { readFileSync } from "node:fs";
import { resultDiagnostics } from "./diagnostics.mts";
import { optionalSlotsFor } from "./mip.mts";
import type { TemplateMap } from "./build-spec.mts";

const shipped = (JSON.parse(readFileSync(new URL("./data/templates/uoalive.json", import.meta.url), "utf8")) as { templates: TemplateMap }).templates;
const builds = Object.keys(defaultProfiles.templates).filter((id) => !templateNames.includes(id));

test("[slow] each build template: both solvers build it on the fixture and no weight dominates the result", { skip: process.env.TEST_SKIP_SLOW === "1" }, async (t) => {
  assert.equal(builds.length, 13);
  for (const name of builds) {
    await t.test(name, async (t2) => {
      const c = cell(name, { soft: defaultProfiles.templates[name]!.softFloors, buffs: shipped[name]!.spec.buffs?.on ?? [] });
      const { r } = await runBoth(t2, c, { ...BASE_OPTS, timeBudgetMs: 5000 });
      const diagnostics = resultDiagnostics({ pools: c.pools as never, current: c.current as never, optionalSlots: optionalSlotsFor(c.current as never, []), profile: c.profile, result: r as never });
      assert.deepEqual(diagnostics.filter((d) => d.code === "weight_dominates").map((d) => d.message), [], name);
    });
  }
});
