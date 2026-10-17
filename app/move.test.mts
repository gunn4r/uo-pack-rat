// move.test.mts — `app/move.mts`, Move to's planner (issue #270), on hand-built house scans folded by the real fold.
//
// `app/move.mts` on hand-built house scans (`app/organize-fixture.mts`) folded by the real fold: the selection resolved from serials and an Inventory query less its exceptions, which containers can be filled, the trips into one container with its room simulated (all fit, some fit, none fit), the items left where they are and why (worn, in a backpack, a bag, blacklisted, in another house, already there), a trip command `queueTrip` accepts, Move back to where the overlay says each item came from (skipping items moved again or no longer known), and the moved items an Organize rule would take out again. All `[fast]`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { foldSnapshots, setRules, type Inventory } from "./vault-lib.mts";
import { houseScan, AT, type BoxSpec, type ThingSpec } from "./organize-fixture.mts";
import { emptyOrganizeConfig, emptyRuleQuery, type OrganizeConfig } from "./organize-config.mts";
import { applyOverlay, tripCommand, type OverlayMove } from "./organize.mts";
import { queueTrip } from "./bridge-trip.mts";
import { resolveConfig } from "./config.mts";
import { againstRules, backSteps, destProblem, planMoves, resolveSelection } from "./move.mts";
import type { RulesV1, ScanV2 } from "./schema/types.d.mts";

const HERE = dirname(fileURLToPath(import.meta.url));
setRules(JSON.parse(readFileSync(join(HERE, "rules", "uoalive.json"), "utf8")) as RulesV1);
const NOW = Date.parse(AT) + 3600e3;
const A = 0x40000001, B = 0x40000002, BAG = 0x40000003, FAR = 0x40000004, PACK = 0x40000005, TRASH = 0x40000006, BLIND = 0x40000007;
const PEARL = 0x40001001, RUBY = 0x40001002, ASH = 0x40001003, GARLIC = 0x40001004, RING = 0x40001005, WORN = 0x40001006, PACKED = 0x40001007, FARAWAY = 0x40001008, INB = 0x40001009;
const at = (x: number) => ({ x, y: 100, z: 0, facet: 1 });
// A at 100, B two tiles away (one house), FAR 1000 tiles off (another house), a backpack, a chest engraved as trash and a chest with no
// Contents line beside them. B holds one item already.
function house(bMax = 125, extra: Partial<{ things: ThingSpec[]; boxes: BoxSpec[] }> = {}): Inventory {
  const scan = houseScan({
    boxes: [{ serial: A, pos: at(100) }, { serial: B, pos: at(102), max: bMax }, { serial: BAG, parent: A, name: "Bag" }, { serial: FAR, pos: at(1100) }, { serial: PACK, kind: "backpack", name: "Backpack" },
      { serial: TRASH, pos: at(104), name: "Metal Chest", tooltip: ["Metal Chest", "Engraved: Trash Pile", "Contents: 0/125 Items, 0 Stones"] }, { serial: BLIND, pos: at(106), tooltip: null }, ...(extra.boxes ?? [])],
    things: [{ serial: PEARL, name: "Black Pearl", in: A }, { serial: RUBY, name: "Ruby", in: A }, { serial: ASH, name: "Sulfurous Ash", in: BAG }, { serial: GARLIC, name: "Garlic", in: A },
      { serial: RING, name: "Gold Ring", in: A }, { serial: PACKED, name: "Bloodmoss", in: PACK }, { serial: FARAWAY, name: "Ginseng", in: FAR }, { serial: INB, name: "Nightshade", in: B }, ...(extra.things ?? [])],
  }) as ScanV2 & { equipped: unknown[] };
  scan.equipped = [{ serial: WORN, nameSource: "opl", name: "Silver Ring", layer: "Ring", tooltip: ["Silver Ring"] }];
  return foldSnapshots([scan]);
}
const to = (serials: number[], dest: number) => serials.map((serial) => ({ serial, to: dest }));

test("[fast] a selection is its listed serials the scans still have and every item matching an Inventory query but the ones unticked", () => {
  const inv = house();
  assert.deepEqual(resolveSelection(inv, { serials: [RUBY, PEARL, PEARL, 123] }).map((it) => it.serial), [PEARL, RUBY]);
  assert.deepEqual(resolveSelection(inv, { query: "q=ring", except: [] }).map((it) => it.serial), [RING, WORN]);
  assert.deepEqual(resolveSelection(inv, { query: "q=ring", except: [WORN] }).map((it) => it.serial), [RING]);
  assert.deepEqual(resolveSelection(inv, { query: "q=ring", except: [WORN], serials: [PEARL] }).map((it) => it.serial), [PEARL, RING], "rows ticked outside the query join it");
});

test("[fast] only a container on the ground with a known place and fill, not blacklisted and not trash, can be filled", () => {
  const inv = house();
  assert.equal(destProblem(inv, B), null);
  assert.equal(destProblem(inv, BAG), null, "a bag in a chest");
  assert.equal(destProblem(inv, 0x41000000), "that container is in no scan");
  assert.equal(destProblem(inv, PACK), "only a container on the ground can be filled");
  assert.equal(destProblem(inv, B, [B]), "it is blacklisted");
  assert.equal(destProblem(inv, BAG, [A]), "it is blacklisted", "a bag in a blacklisted chest");
  assert.equal(destProblem(inv, TRASH), "it is a trash container");
  assert.equal(destProblem(inv, BLIND), "its fill is not known: rescan it");
});

test("[fast] Move to plans takes then puts into the picked container, in Organize's trips, and queueTrip takes the trip", () => {
  const inv = house();
  const plan = planMoves(inv, [], to([PEARL, RUBY, ASH], B));
  assert.deepEqual(plan.trips.map((t) => [t.index, t.takes, t.puts]), [[1, [PEARL, RUBY, ASH], [PEARL, RUBY, ASH]]]);
  assert.deepEqual(plan.moves.map((m) => [m.serial, m.from, m.to]), [[PEARL, A, B], [RUBY, A, B], [ASH, BAG, B]]);
  assert.deepEqual([plan.left, plan.noRoom, plan.already], [[], [], []]);
  const input = tripCommand(applyOverlay(inv, []).inv, plan, 1)!;
  assert.deepEqual(input.takes.find((t) => t.serial === ASH)!.chain, [A, BAG]);
  assert.deepEqual(input.puts.map((p) => p.dest), [[B], [B], [B]]);
  const paths = resolveConfig(["--port", "0", "--data", mkdtempSync(join(tmpdir(), "packrat-move-"))], {}).paths;
  assert.equal(queueTrip(paths, "tazuo", input).ok, true);
  assert.equal(planMoves(inv, [], to([PEARL, RUBY, ASH], B)).stamp, plan.stamp, "the same inputs give the same plan");
});

test("[fast] a container with room for some moves what fits and names the rest; a full one moves nothing", () => {
  // B holds 1 of 3: room for 2.
  const some = planMoves(house(3), [], to([PEARL, RUBY, GARLIC, RING], B));
  assert.deepEqual(some.moves.map((m) => m.serial), [PEARL, RUBY]);
  assert.deepEqual(some.noRoom, [GARLIC, RING]);
  const none = planMoves(house(1), [], to([PEARL, RUBY], B));
  assert.deepEqual([none.moves, none.trips, none.noRoom], [[], [], [PEARL, RUBY]]);
  // More than a trip carries: the rest go in the next trips.
  const many = Array.from({ length: 25 }, (_, i) => ({ serial: 0x40002000 + i, name: `Gem ${i}`, in: A }));
  const big = planMoves(house(125, { things: many }), [], to(many.map((t) => t.serial), B));
  assert.deepEqual(big.trips.map((t) => t.puts.length), [20, 5]);
});

test("[fast] items a trip cannot take stay where they are, each with its reason, and one already there is skipped", () => {
  const inv = house();
  const plan = planMoves(inv, [], to([WORN, PACKED, BAG, FARAWAY, INB, PEARL, 0x41000000], B), { blacklist: [] });
  assert.deepEqual(plan.left.map((l) => [l.serial, l.why]), [[BAG, "bag"], [WORN, "worn"], [PACKED, "pack"], [FARAWAY, "site"], [0x41000000, "gone"]]);
  assert.deepEqual(plan.already, [INB]);
  assert.deepEqual(plan.moves.map((m) => m.serial), [PEARL]);
  // Blacklisted on the way out, or into a container the trip cannot fill.
  assert.deepEqual(planMoves(inv, [], to([PEARL], B), { blacklist: [A] }).left.map((l) => l.why), ["unreachable"]);
  assert.deepEqual(planMoves(inv, [], to([PEARL], TRASH)).left.map((l) => l.why), ["unreachable"]);
});

test("[fast] the plan starts from the overlay: an item a finished trip put away is planned from where it is now", () => {
  const inv = house();
  const overlay: OverlayMove[] = [{ serial: PEARL, name: "Black Pearl", from: A, to: B, at: new Date(NOW).toISOString(), trip: "t1" }];
  const plan = planMoves(inv, overlay, to([PEARL, RUBY], B));
  assert.deepEqual(plan.already, [PEARL]);
  assert.deepEqual(plan.moves.map((m) => m.serial), [RUBY]);
});

test("[fast] Move back sends each item to the container its Move took it from, and skips items moved again or no longer known", () => {
  const inv = house();
  const t = new Date(NOW).toISOString();
  const overlay: OverlayMove[] = [
    { serial: PEARL, name: "Black Pearl", from: A, to: B, at: t, trip: "move-1" },
    { serial: ASH, name: "Sulfurous Ash", from: BAG, to: B, at: t, trip: "move-1" },
    { serial: RUBY, name: "Ruby", from: B, to: A, at: t, trip: "organize-9" },   // moved again since, by another trip
  ];
  const { steps, skipped } = backSteps(inv, overlay, [PEARL, RUBY, ASH, GARLIC], ["move-1"]);
  assert.deepEqual(steps, [{ serial: PEARL, to: A }, { serial: ASH, to: BAG }]);
  assert.deepEqual(skipped.map((s) => s.name), ["Ruby", "Garlic"]);
  const back = planMoves(inv, overlay, steps);
  assert.deepEqual(back.moves.map((m) => [m.serial, m.from, m.to]), [[PEARL, B, A], [ASH, B, BAG]]);
});

test("[fast] moved items an Organize rule files elsewhere are named with that rule's container; pinned items and unlabeled destinations are not", () => {
  const inv = house();
  const lab = (s: number) => ({ serial: s, name: `Box ${s}`, origin: "manual" as const });
  const cfg: OrganizeConfig = { ...emptyOrganizeConfig(), labels: { [A]: lab(A), [B]: lab(B) },
    rules: [{ id: "r1", name: "Reagents", match: { query: emptyRuleQuery(), names: ["black pearl", "ruby"] }, targets: [A], origin: "manual" }] };
  const opts = { now: NOW };
  assert.deepEqual(againstRules(inv, cfg, [PEARL, RUBY, GARLIC], B, opts), [{ serial: PEARL, name: "Black Pearl", target: A }, { serial: RUBY, name: "Ruby", target: A }]);
  assert.deepEqual(againstRules(inv, { ...cfg, pinnedItems: [PEARL] }, [PEARL, RUBY], B, opts).map((x) => x.serial), [RUBY]);
  assert.deepEqual(againstRules(inv, cfg, [PEARL], BAG, opts), [], "a bag in the rule's own container is home");
  assert.deepEqual(againstRules(inv, { ...cfg, labels: { [A]: lab(A) } }, [PEARL], B, opts), [], "Organize never takes from an unlabeled container");
  assert.deepEqual(againstRules(inv, { ...cfg, labels: { [A]: lab(A), [B]: { ...lab(B), pinned: true } } }, [PEARL], B, opts), [], "nor from a pinned one");
});
