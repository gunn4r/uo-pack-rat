// retention.test.mts — app/services/retention.mts on its own: under --demo nothing is planned; a prune removes the runs past the per-character count (a labeled one kept), logs what it removed and tells the pages; two prunes run one after the other. Tags: [fast]. Run: node --test app/services/retention.test.mts
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createScansStore } from "../store/scans.mts";
import { createRunsStore } from "../store/runs.mts";
import { createRetentionService } from "./retention.mts";

function setup(demo: boolean) {
  const dir = mkdtempSync(join(tmpdir(), "pr-retention-")), scans = join(dir, "scans");
  mkdirSync(scans);
  const scanStore = createScansStore({ dir: scans, shard: () => "uoalive" }), runStore = createRunsStore(join(dir, "runs"));
  for (const [id, day, label] of [["a", 1, ""], ["b", 2, ""], ["c", 3, ""], ["d", 0, "keep"]] as const) runStore.write({ id, character: "Kestrel", createdAt: `2026-01-0${day + 1}T00:00:00.000Z`, label, settings: {} } as { id: string });
  const events: Array<[string, unknown]> = [], logged: string[] = [];
  const service = createRetentionService({ demo, retention: () => ({ runsPerCharacter: 1 }), scanStore, runStore, events: { broadcast: (e, d) => events.push([e, d]) }, log: (line) => logged.push(line) });
  return { service, runs: join(dir, "runs"), events, logged };
}

test("[fast] retention service: nothing is planned or removed under --demo", async () => {
  const t = setup(true);
  assert.deepEqual(await t.service.plan(), { scans: [], runs: [], refused: false });
  assert.deepEqual(await t.service.prune("startup"), { scans: 0, runs: 0, refused: false });
  assert.ok(existsSync(join(t.runs, "a.json")));
  assert.deepEqual(t.events, []);
});

test("[fast] retention service: a prune removes the runs past the count, keeps a labeled one, logs it and tells the pages, one prune at a time", async () => {
  const t = setup(false);
  assert.deepEqual((await t.service.plan()).runs.sort(), ["a.json", "b.json"]);
  const [first, second] = await Promise.all([t.service.prune("startup"), t.service.prune("clean up now")]);
  assert.deepEqual(first, { scans: 0, runs: 2, refused: false });
  assert.deepEqual(second, { scans: 0, runs: 0, refused: false }, "the second waited for the first");
  assert.deepEqual(["a", "b", "c", "d"].map((id) => existsSync(join(t.runs, `${id}.json`))), [false, false, true, true]);
  assert.equal(t.logged.length, 1);
  assert.match(t.logged[0]!, /^\S+ retention \(startup\) removed 0 scans \[\] and 2 runs \["[ab]\.json","[ab]\.json"\]\n$/);
  assert.deepEqual(t.events.map(([e, d]) => [e, (d as { what: string }).what]), [["changed", "runs"]]);
});
