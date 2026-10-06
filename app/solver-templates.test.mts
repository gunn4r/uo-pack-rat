// solver-templates.test.mts — HiGHS and the core agree on the fixture for every shipped default template, and with soft floors.
//
// HiGHS matches the core's proven optimum on every default template over the fixture inventory, and with soft floors. All `[fast]`, and the longest of the fast solver checks, hence a file of their own. It and the solver files beside it share `app/solver-fixture.mts` (the fixture folded and pooled, the templates, `cell()` and `runBoth()`).
import { test } from "node:test";
import assert from "node:assert/strict";
import { BASE_OPTS, cell, defaultProfiles, runBoth, templateNames } from "./solver-fixture.mts";

test("[fast] each default template: HiGHS equals the core's proven optimum on the fixture", async (t) => {
  for (const name of templateNames) {
    await t.test(name, async (t2) => { await runBoth(t2, cell(name), BASE_OPTS); });
  }
});

test("[fast] soft floors match", async (t) => {
  const name = templateNames[0]!;
  const floorKeys = Object.keys(defaultProfiles.templates![name]!.floors);
  const soft = floorKeys.slice(0, 2);
  assert.ok(soft.length === 2, `template ${name} needs at least two floors for this test`);
  await runBoth(t, cell(name, { soft }), BASE_OPTS);
});
