// organize-state.test.mts — app/organize-state.mts (issue #11): a trip's confirmed steps read into the overlay,
// entries a newer scan has settled dropped, when each labelled container was last seen, and a damaged state
// file salvaged. Pure. Tags: [fast]. Run: node --test app/organize-state.test.mts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { foldSnapshots, setRules } from "./vault-lib.mts";
import { houseScan, AT } from "./organize-fixture.mts";
import { emptyOrganizeConfig } from "./organize-config.mts";
import { emptyOrganizeState, harvestTrips, pruneOverlay, noteSeen, salvageOrganizeState, PENDING_GRACE_MS, type OrganizeState, type PendingGrab, type PendingTrip } from "./organize-state.mts";
import type { OverlayMove } from "./organize.mts";
import type { RulesV1 } from "./schema/types.d.mts";

setRules(JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "rules", "uoalive.json"), "utf8")) as RulesV1);
const A = 0x40000001, B = 0x40000002, PEARL = 0x40001001, RUBY = 0x40001002, GARLIC = 0x40001003;
const T1 = "2026-09-28T11:00:00Z", QUEUED = "2026-09-28T10:59:00Z";
const trip = (over: Partial<PendingTrip> = {}): PendingTrip => ({
  id: "t-1", adapter: "tazuo", index: 1, stamp: "0123abcd", queuedAt: QUEUED,
  steps: [{ serial: PEARL, name: "Black Pearl", from: B, to: A }, { serial: RUBY, name: "Ruby", from: A, to: B }, { serial: GARLIC, name: "Garlic", from: B, to: A }],
  ...over,
});
const state = (over: Partial<OrganizeState> = {}): OrganizeState => ({ ...emptyOrganizeState(), ...over });
const entry = (serial: number, to: number | null, at = T1): OverlayMove => ({ serial, name: "x", from: A, to, at, trip: "t-1" });

test("[fast] harvestTrips turns a trip's confirmed steps into overlay moves and forgets the trip", () => {
  const result = { ok: false, msg: "trip 1", t: T1, partial: false, stopped: false, steps: [
    { op: "take", serial: PEARL, ok: true, msg: "" }, { op: "take", serial: RUBY, ok: true, msg: "" }, { op: "take", serial: GARLIC, ok: false, msg: "rescan" },
    { op: "put", serial: PEARL, ok: true, msg: "" }, { op: "put", serial: RUBY, ok: false, msg: "bounced" }, { op: "put", serial: GARLIC, ok: false, msg: "skipped" }] };
  const next = harvestTrips(state({ pending: [trip()] }), { tazuo: { results: { "t-1": result }, current: null } }, Date.parse(QUEUED) + 30_000);
  assert.deepEqual(next.pending, []);
  assert.deepEqual(next.moves, [
    { serial: PEARL, name: "Black Pearl", from: B, to: A, at: T1, trip: "t-1" },
    { serial: RUBY, name: "Ruby", from: A, to: null, at: T1, trip: "t-1" },
  ]);
});

test("[fast] a direct move's take and put, reported together ahead of the other takes, file the item in its destination", () => {
  // Issue #130: the bridge reports a direct move as its take then its put, in execution order.
  const result = { ok: true, msg: "trip 1", t: T1, steps: [
    { op: "take", serial: PEARL, ok: true, msg: "" }, { op: "put", serial: PEARL, ok: true, msg: "" }, { op: "take", serial: RUBY, ok: true, msg: "" }] };
  const next = harvestTrips(state({ pending: [trip()] }), { tazuo: { results: { "t-1": result }, current: null } }, Date.parse(QUEUED) + 30_000);
  assert.deepEqual(next.moves.map((m) => [m.serial, m.to]), [[PEARL, A], [RUBY, null]]);
});

test("[fast] a put of an item an earlier trip left in the backpack keeps where it first came from", () => {
  const before = state({ moves: [{ serial: RUBY, name: "Ruby", from: A, to: null, at: T1, trip: "t-1" }],
    pending: [trip({ id: "t-2", steps: [{ serial: RUBY, name: "Ruby", from: null, to: B }] })] });
  const T2 = "2026-09-28T11:05:00Z";
  const next = harvestTrips(before, { tazuo: { results: { "t-2": { ok: true, msg: "", t: T2, steps: [{ op: "put", serial: RUBY, ok: true, msg: "" }] } }, current: null } }, Date.parse(T2));
  assert.deepEqual(next.moves, [{ serial: RUBY, name: "Ruby", from: A, to: B, at: T2, trip: "t-2" }]);
});

test("[fast] harvestTrips names the character whose bridge ran the trip, and salvage keeps it", () => {
  const result = { ok: true, msg: "", t: T1, steps: [{ op: "take", serial: PEARL, ok: true, msg: "" }] };
  const next = harvestTrips(state({ pending: [trip()] }), { tazuo: { results: { "t-1": result }, current: null, character: "Tester" } }, Date.parse(T1));
  assert.deepEqual(next.moves, [{ serial: PEARL, name: "Black Pearl", from: B, to: null, at: T1, trip: "t-1", character: "Tester" }]);
  assert.deepEqual(salvageOrganizeState(JSON.parse(JSON.stringify(next))).moves, next.moves);
  assert.equal(salvageOrganizeState({ ...next, moves: [{ ...next.moves[0], character: 5 }] }).moves[0]!.character, undefined, "a bad name is dropped, not the move");
});

test("[fast] harvestTrips keeps a trip the bridge is running or may still pick up, and drops one nobody will run", () => {
  const now = Date.parse(QUEUED) + PENDING_GRACE_MS + 1000;
  const running = trip({ id: "t-run" }), fresh = trip({ id: "t-new", queuedAt: new Date(now - 10_000).toISOString() }), old = trip({ id: "t-old" });
  const next = harvestTrips(state({ pending: [running, fresh, old] }), { tazuo: { results: {}, current: "t-run" } }, now);
  assert.deepEqual(next.pending.map((p) => p.id), ["t-run", "t-new"]);
});

test("[fast] harvestTrips ignores a malformed result and steps for items the trip did not carry", () => {
  const now = Date.parse(QUEUED) + 1000;
  const garbled = harvestTrips(state({ pending: [trip()] }), { tazuo: { results: { "t-1": { t: "yesterday", steps: "all" } }, current: null } }, now);
  assert.equal(garbled.pending.length, 1, "not a result: the trip is still waiting");
  const stray = { ok: true, msg: "", t: T1, steps: [{ op: "put", serial: 999, ok: true, msg: "" }, { op: "jump", serial: PEARL, ok: true }, "x"] };
  const next = harvestTrips(state({ pending: [trip()] }), { tazuo: { results: { "t-1": stray }, current: null } }, now);
  assert.deepEqual([next.pending, next.moves], [[], []]);
});

test("[fast] harvestTrips reads a Grab that worked in as a take marked grab, drops one that failed and keeps one still waiting", () => {
  // Issue #148: the grab left B; a pending overlay move of the ruby keeps the container it first came from.
  const grab = (id: string, serial: number): PendingGrab => ({ id, adapter: "tazuo", serial, name: "x", from: B, queuedAt: QUEUED });
  const before = state({ moves: [{ serial: RUBY, name: "Ruby", from: A, to: B, at: "2026-09-28T10:59:30Z", trip: "t-1" }],
    grabs: [grab("g-1", PEARL), grab("g-2", RUBY), grab("g-3", GARLIC), grab("g-4", 0x40001009)] });
  const results = { "g-1": { ok: true, msg: "grabbed x — it is in your backpack", t: T1 }, "g-2": { ok: true, msg: "", t: T1 }, "g-3": { ok: false, msg: "not reachable", t: T1 } };
  const next = harvestTrips(before, { tazuo: { results, current: null, character: "Tester" } }, Date.parse(QUEUED) + 30_000);
  assert.deepEqual(next.grabs.map((g) => g.id), ["g-4"]);
  assert.deepEqual(next.moves, [
    { serial: PEARL, name: "x", from: B, to: null, at: T1, trip: "g-1", character: "Tester", grab: true },
    { serial: RUBY, name: "x", from: A, to: null, at: T1, trip: "g-2", character: "Tester", grab: true },
  ]);
  assert.deepEqual(salvageOrganizeState(JSON.parse(JSON.stringify(next))), next, "salvage keeps grabs and the grab mark");
  assert.deepEqual(harvestTrips(next, { tazuo: { results: {}, current: null } }, Date.parse(QUEUED) + PENDING_GRACE_MS + 1000).grabs, [], "never picked up");
});

test("[fast] pruneOverlay drops what a newer scan has settled and keeps the rest", () => {
  const inv = foldSnapshots([houseScan({ boxes: [{ serial: A }, { serial: B }], things: [{ serial: RUBY, name: "Ruby", in: A }] })]);
  const now = Date.parse(T1) + 3600e3;
  const moves = [
    entry(PEARL, B),                                   // vanished from the scans, B not rescanned since: kept
    entry(RUBY, B, "2026-09-28T09:00:00Z"),            // Ruby seen at AT, after the step: settled
    entry(GARLIC, 0x4000ffff),                         // its destination is in no scan: dropped
    entry(0x40001009, null),                           // in the backpack, not seen since: kept
    entry(0x4000100a, null, "2026-09-01T00:00:00Z"),   // older than a week: dropped
  ];
  assert.deepEqual(pruneOverlay(state({ moves }), inv, now).moves.map((m) => m.serial), [PEARL, 0x40001009]);
  const rescanOfB = foldSnapshots([houseScan({ boxes: [{ serial: A }, { serial: B }], things: [{ serial: RUBY, name: "Ruby", in: A }] }), houseScan({ scannedAt: "2026-09-28T12:00:00Z", boxes: [{ serial: B }] })]);
  assert.deepEqual(pruneOverlay(state({ moves: [entry(PEARL, B)] }), rescanOfB, now).moves, [], "B rescanned after the step");
  // Issue #148: the item seen since, but not the container it left: kept, as that container's fill still counts it.
  const rescanOfRuby = foldSnapshots([houseScan({ boxes: [{ serial: A }, { serial: B }] }), houseScan({ scannedAt: "2026-09-28T12:00:00Z", boxes: [{ serial: B }], things: [{ serial: RUBY, name: "Ruby", in: B }] })]);
  assert.deepEqual(pruneOverlay(state({ moves: [entry(RUBY, null)] }), rescanOfRuby, now).moves.map((m) => m.serial), [RUBY]);
});

test("[fast] pruneOverlay keeps a step whose destination a newer scan saw but could not open", () => {
  const first = houseScan({ boxes: [{ serial: A }, { serial: B, parent: A }], things: [{ serial: RUBY, name: "Ruby", in: A }] });
  const closed = houseScan({ scannedAt: "2026-09-28T12:00:00Z", boxes: [{ serial: A }, { serial: B, parent: A, opened: false }], things: [{ serial: RUBY, name: "Ruby", in: A }] });
  const inv = foldSnapshots([first, closed]);
  assert.equal(inv.containers[B]!.opened, false);
  assert.deepEqual(pruneOverlay(state({ moves: [entry(PEARL, B)] }), inv, Date.parse(T1) + 3600e3).moves.map((m) => m.serial), [PEARL]);
});

test("[fast] noteSeen remembers when each labelled container was last in a scan, and forgets unlabelled ones", () => {
  const inv = foldSnapshots([houseScan({ boxes: [{ serial: A }] })]);
  const cfg = { ...emptyOrganizeConfig(), labels: { [String(A)]: { serial: A, name: "A", origin: "manual" as const }, [String(B)]: { serial: B, name: "B", origin: "manual" as const } } };
  const next = noteSeen(state({ seen: { [String(B)]: "2026-09-01T00:00:00Z", "12345": "2026-09-01T00:00:00Z" } }), cfg, inv);
  assert.deepEqual(next.seen, { [String(A)]: AT, [String(B)]: "2026-09-01T00:00:00Z" });
});

test("[fast] salvageOrganizeState keeps well-formed entries and drops the rest", () => {
  const raw = { version: 1, pending: [trip(), { ...trip(), index: 0 }, "x"], moves: [entry(PEARL, B), { ...entry(RUBY, B), at: "never" }, null], seen: { [String(A)]: AT, junk: AT, [String(B)]: 5 } };
  const s = salvageOrganizeState(raw);
  assert.deepEqual(s.pending.map((p) => p.id), ["t-1"]);
  assert.deepEqual(s.moves.map((m) => m.serial), [PEARL]);
  assert.deepEqual(s.seen, { [String(A)]: AT });
  for (const bad of [null, [], { version: 2 }]) assert.deepEqual(salvageOrganizeState(bad), emptyOrganizeState());
});
