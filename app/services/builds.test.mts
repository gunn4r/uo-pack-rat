// builds.test.mts — `app/services/builds.mts`, a checked build request into a started job or a saved run that answers it (issue #338).
//
// `[fast]`, on the TazUO fixture's inventory with a stand-in jobs service and run store: a by-character build submits the prepared input under its run key, saved, with the pool's figures on its meta and in the answer; the answer passes on a meta warning only when it is text; a character with no scans is a 404; a saved run with the same key answers at once, and the newest run of the character is the warm start otherwise; a fill is never saved nor answered by a saved run, even one under its own key, and a pin that is no gear piece of its slot is a 400; a hand-built request skips the pool step; and a full jobs service is a 429. `autoCandidates` (the Manual picker's "Only what Auto would use", #487) is the pool's pieces, held to the pool settings, a locked slot giving only its worn piece.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture, defaultProfiles } from "../solver-fixture.mts";
import { foldSnapshots } from "../vault-lib.mts";
import type { SavedRun } from "../runs-lib.mts";
import type { JobInput } from "./jobs.mts";
import { createBuildsService, autoCandidates, type BuildRequest } from "./builds.mts";

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

test("[fast] builds: the answer passes on a warning only as text", async () => {
  const answer = async (warning: unknown) => (await service().builds.start(request({ meta: { warning } }), null)).body;
  assert.equal((await answer("check the pool")).warning, "check the pool");
  for (const odd of [{ html: "<b>" }, 5, ["x"]]) assert.equal("warning" in (await answer(odd)), false, JSON.stringify(odd));
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

test("[fast] builds: autoCandidates is the pool a by-character build picks from, a locked slot only its worn piece", () => {
  const all = autoCandidates(inv, "Fixture", {});
  const items = [...all].map((s) => inv.items[s]!);
  assert.ok(items.length > 0 && items.every((it) => it.gear && it.slot), "gear pieces, each with its slot");
  assert.ok(items.every((it) => !it.equippedBy || it.equippedBy === "Fixture"), "nobody else's worn piece");
  const med = [...autoCandidates(inv, "Fixture", { medOnly: true })].map((s) => inv.items[s]!);
  assert.ok(med.length < items.length && med.every((it) => it.medable), "Meditation-safe only");
  const worn = items.find((it) => it.equippedBy === "Fixture")!;
  const locked = [...autoCandidates(inv, "Fixture", { lockedSlots: [worn.slot!] })].map((s) => inv.items[s]!).filter((it) => it.slot === worn.slot);
  assert.deepEqual(locked.map((it) => it.serial), [worn.serial], "a locked slot keeps what is worn there");
});
