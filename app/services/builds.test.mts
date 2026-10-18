// builds.test.mts — `app/services/builds.mts`, a checked build request into a started job or a saved run that answers it (issue #338).
//
// `[fast]`, on the TazUO fixture's inventory with a stand-in jobs service and run store: a by-character build submits the prepared input under its run key, saved, with the pool's figures on its meta and in the answer; a character with no scans is a 404; a saved run with the same key answers at once, and the newest run of the character is the warm start otherwise; a fill is never saved nor answered by a saved run, even one under its own key, and a pin that is no gear piece of its slot is a 400; a hand-built request skips the pool step; and a full jobs service is a 429.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture, defaultProfiles } from "../solver-fixture.mts";
import { foldSnapshots } from "../vault-lib.mts";
import type { SavedRun } from "../runs-lib.mts";
import type { JobInput } from "./jobs.mts";
import { createBuildsService, type BuildRequest } from "./builds.mts";

const inv = foldSnapshots([fixture]);
const profile = { weights: { ...(defaultProfiles.templates.melee!.weights as Record<string, number>) }, caps: {}, floors: {} };
interface Submitted { input: JobInput; key: string; meta: Record<string, unknown>; save: boolean }
function service({ runs = [] as SavedRun[], full = false } = {}) {
  const submitted: Submitted[] = [];
  const builds = createBuildsService({
    getInventory: async () => ({ inv }), getRules: () => ({ rarity: [] }), runStore: { all: () => runs },
    jobService: { submit: (input, key, meta, _client, save) => { if (full) return null; submitted.push({ input, key, meta, save }); return { job: { id: `job${submitted.length}`, meta } as never, superseded: null }; } },
  });
  return { builds, submitted };
}
const request = (over: Partial<BuildRequest> = {}): BuildRequest => ({ pools: {}, current: {}, profile, opts: {}, meta: {}, character: "Fixture", settings: {}, pinned: null, ...over });

test("[fast] builds: a by-character build submits the prepared input under its key, saved, with the pool's figures", async () => {
  const { builds, submitted } = service();
  const { status, body } = await builds.start(request(), "client");
  assert.equal(status, 200);
  assert.equal(body.id, "job1");
  assert.equal(submitted.length, 1);
  const [{ input, key, meta, save }] = submitted as [Submitted];
  assert.ok(key && save, "keyed and saved");
  assert.ok(Object.keys(input.pools as object).length > 0 && Array.isArray(input.opts.optionalSlots), "the pool and its optional slots");
  assert.deepEqual([input.opts.seed != null, input.opts.restarts != null], [true, true], "the search defaults");
  assert.equal(meta.character, "Fixture");
  assert.equal(typeof meta.poolSize, "number");
  assert.ok(meta.pool, "the pool the saved run keeps");
  assert.deepEqual([body.poolSize, body.skipped], [meta.poolSize, meta.skipped]);
  assert.equal((await builds.start(request({ character: "Nobody Scanned" }), null)).status, 404);
});

test("[fast] builds: a saved run with the key answers, else the character's newest run is the warm start", async () => {
  const first = service();
  await first.builds.start(request(), null);
  const { key, input } = first.submitted[0]!;
  const best = Object.fromEntries(Object.entries(input.current as object).map(([slot, it]) => [slot, it]));
  const saved = { id: "run1", key, character: "Fixture", result: { best, method: "heuristic" } } as unknown as SavedRun;
  const cached = service({ runs: [saved] });
  const answer = await cached.builds.start(request(), null);
  assert.deepEqual([answer.body.cached, (answer.body.run as SavedRun).id, cached.submitted.length], [true, "run1", 0]);
  const warm = service({ runs: [{ ...saved, key: "another" } as SavedRun] });
  const started = await warm.builds.start(request(), null);
  assert.equal(started.body.warmFrom, "run1");
  assert.ok(warm.submitted[0]!.input.opts.warmStart, "the warm start rides on the options");
});

test("[fast] builds: a fill is never saved nor answered by a saved run, even one under its own key; a bad pin, a hand-built request and a full service", async () => {
  const piece = Object.values(inv.items).find((it) => it.gear && it.slot === "ring")!;
  const fill = service({ runs: [] });
  await fill.builds.start(request({ pinned: { ring: piece.serial } }), null);
  assert.equal(fill.submitted[0]!.save, false);
  assert.equal((await fill.builds.start(request({ pinned: { neck: piece.serial } }), null)).status, 400);
  // a saved run under the fill's own key does not answer it: the fill is searched
  const saved = { id: "run1", key: fill.submitted[0]!.key, character: "Fixture", result: { best: {}, method: "heuristic" } } as unknown as SavedRun;
  const again = service({ runs: [saved] });
  const searched = await again.builds.start(request({ pinned: { ring: piece.serial } }), null);
  assert.deepEqual([searched.body.cached, again.submitted.length, again.submitted[0]!.key], [undefined, 1, saved.key]);

  const hand = service();
  const pools = { ring: [{ serial: 1, name: "r", slot: "ring", props: { hci: 5 } }] };
  await hand.builds.start(request({ character: null, pools }), null);
  assert.deepEqual(hand.submitted[0]!.input.pools, pools);
  assert.equal(hand.submitted[0]!.meta.pool, undefined, "no pool step, no pool snapshot");

  const answer = await service({ full: true }).builds.start(request(), null);
  assert.equal(answer.status, 429);
});
