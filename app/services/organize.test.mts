// organize.test.mts — `app/services/organize.mts` on its own, with stand-in stores.
//
// `app/services/organize.mts` with stand-in stores: a harvest with nothing pending only reading the state file, the saved suits read only when a rule skips them, a Put away request removed and always answered, and a Move to trip recorded on the state file as it is: a Grab recorded while the route awaits the inventory kept, and a second trip planned from the same read refused while the first has not reported back. All `[fast]`; the routes are `app/organize-server.test.mts`.
//
// With nothing pending a harvest writes nothing and sends no event.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveConfig } from "../config.mts";
import { emptyOrganizeConfig } from "../organize-config.mts";
import { addGrab, emptyOrganizeState } from "../organize-state.mts";
import { foldSnapshots, setRules } from "../vault-lib.mts";
import { planMoves } from "../move.mts";
import { houseScan } from "../organize-fixture.mts";
import { createOrganizeStateStore } from "../store/organize-state.mts";
import { loadRules } from "../rules.mts";
import { updater } from "../store/json-file.mts";
import { createOrganizeService } from "./organize.mts";

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "pr-organize-svc-")), paths = resolveConfig(["--data", dir], {}).paths;
  let stateReads = 0, stateWrites = 0, runReads = 0;
  const events: string[] = [], logged: string[] = [];
  const service = createOrganizeService({
    paths, getInventory: async () => { throw new Error("not planned"); },
    organizeStore: { read: () => ({ config: emptyOrganizeConfig(), problems: [] }), stamp: () => "none" },
    organizeStateStore: { update: updater(() => { stateReads++; return emptyOrganizeState(); }, () => { stateWrites++; }) },
    blacklistStore: { read: () => [] }, runStore: { all: () => { runReads++; return []; } },
    rules: () => loadRules("uoalive"), bridgeAdapter: () => "tazuo", manifest: () => null, events: { broadcast: (e) => events.push(e) }, log: (line) => logged.push(line),
  });
  return { dir, paths, service, events, logged, counts: () => ({ stateReads, stateWrites, runReads }) };
}

test("[fast] organize service: with nothing pending a harvest only reads the state file", () => {
  const t = setup();
  const { state, bridges } = t.service.harvestNow(Date.now());
  assert.deepEqual(state, emptyOrganizeState());
  assert.deepEqual(bridges, {});
  assert.deepEqual(t.counts(), { stateReads: 1, stateWrites: 0, runReads: 0 });
  assert.deepEqual(t.events, []);
});

test("[fast] organize service: the saved suits are read only when a rule skips them", () => {
  const t = setup();
  assert.equal(t.service.suitsFor([{ query: {} } as never]), undefined);
  assert.equal(t.counts().runReads, 0);
  assert.deepEqual(t.service.suitsFor([{ query: {}, skipSuits: true } as never]), new Set());
  assert.equal(t.counts().runReads, 1);
});

test("[fast] organize service: a Put away request file is removed and answered in putaway.json, here with a refusal", async () => {
  const t = setup();
  const request = join(t.dir, "putaway-request.json");
  writeFileSync(request, JSON.stringify({ id: "r1" }));
  await t.service.putAway("tazuo", request);
  assert.equal(existsSync(request), false);
  const reply = JSON.parse(readFileSync(join(t.paths.bridgeFor("tazuo"), "putaway.json"), "utf8")) as Record<string, unknown>;
  assert.equal(reply.ok, false);
  assert.ok(typeof reply.msg === "string" && reply.msg.length > 0);
  assert.deepEqual(t.logged, []);
});

// The service over a real organize-state.json and a house with two containers: `inventory` is what the route's own
// `await getInventory()` runs, `during` what lands in the state file while it is awaited.
function moveSetup(during: () => void = () => {}) {
  setRules(loadRules("uoalive"));   // the fold classifies by the shard's rules
  const dir = mkdtempSync(join(tmpdir(), "pr-organize-move-")), paths = resolveConfig(["--data", dir], {}).paths;
  const A = 0x40000001, B = 0x40000002, PEARL = 0x40001001;
  const fold = foldSnapshots([houseScan({ boxes: [{ serial: A, pos: { x: 100, y: 100, z: 0, facet: 1 } }, { serial: B, pos: { x: 104, y: 100, z: 0, facet: 1 } }], things: [{ serial: PEARL, name: "Black Pearl", in: B }] })]);
  const stateStore = createOrganizeStateStore(join(dir, "organize-state.json"));
  const service = createOrganizeService({
    paths, getInventory: async () => ({ fold }),
    organizeStore: { read: () => ({ config: emptyOrganizeConfig(), problems: [] }), stamp: () => "none" },
    organizeStateStore: stateStore, blacklistStore: { read: () => [] }, runStore: { all: () => [] },
    rules: () => loadRules("uoalive"), bridgeAdapter: () => "tazuo", manifest: () => null, events: { broadcast: () => {} }, log: () => {},
  });
  const inventory = async () => { during(); return { fold }; };
  const plan = (moves: Parameters<typeof planMoves>[1]) => planMoves(fold, moves, [{ serial: PEARL, to: A }]);
  return { paths, service, stateStore, inventory, plan };
}

test("[fast] organize service: a Move to trip keeps a Grab recorded while the route awaited the inventory", async () => {
  const grab = { id: "g1", adapter: "tazuo", serial: 0x40001002, name: "Ruby", from: null, queuedAt: "2026-10-18T10:00:00.000Z" };
  const t = moveSetup(() => { t.stateStore.update((s) => addGrab(s, grab)); });
  // POST /api/move/trip's order: organizeInputs, then (for `to`) the inventory awaited, then the trip queued.
  const { fold, state } = await t.service.organizeInputs();
  await t.inventory();
  const plan = t.plan(state.moves), trip = plan.trips[0]!;
  const queued = t.service.queuePlanTrip("tazuo", fold, state.moves, plan, trip.index);
  assert.ok(queued.ok, JSON.stringify(queued));
  const after = t.stateStore.read();
  assert.deepEqual(after.grabs, [grab]);
  assert.deepEqual(after.pending.map((p) => p.id), [queued.id]);
});

test("[fast] organize service: of two Move to trips planned from the same read, the second is refused while the first has not reported back", async () => {
  const t = moveSetup();
  const first = await t.service.organizeInputs(), second = await t.service.organizeInputs();
  const p1 = t.plan(first.state.moves), p2 = t.plan(second.state.moves);
  const q1 = t.service.queuePlanTrip("tazuo", first.fold, first.state.moves, p1, p1.trips[0]!.index);
  assert.ok(q1.ok);
  const q2 = t.service.queuePlanTrip("tazuo", second.fold, second.state.moves, p2, p2.trips[0]!.index);
  assert.deepEqual(q2, { ok: false, error: `trip ${p1.trips[0]!.index} has not reported back yet`, waiting: p1.trips[0]!.index });
  assert.deepEqual(t.stateStore.read().pending.map((p) => p.id), [q1.id]);
  assert.equal(readFileSync(t.paths.bridgeQueueFor("tazuo"), "utf8").trim().split("\n").length, 1, "one trip line queued");
});
