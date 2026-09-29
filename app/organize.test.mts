// organize.test.mts — app/organize.mts, Organize's planner (issue #11), on hand-built house scans
// (app/organize-fixture.mts) folded by the real foldSnapshots, plus a fold of the TazUO adapter fixture.
// Pure: no server. Tags: [fast], one [smoke]. Run: node --test app/organize.test.mts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { foldSnapshots, setRules, type Inventory } from "./vault-lib.mts";
import { houseScan, AT, type BoxSpec, type ThingSpec } from "./organize-fixture.mts";
import { emptyRuleQuery, emptyOrganizeConfig, CATCH_ALL_ID, type OrganizeConfig, type OrganizeRule, type ContainerLabel } from "./organize-config.mts";
import type { RuleQuery } from "./item-query.mts";
import type { RulesV1 } from "./schema/types.d.mts";
import { resolveConfig } from "./config.mts";
import { queueTrip } from "./bridge-trip.mts";
import type { ScanV2 } from "./schema/types.d.mts";
import {
  ancestry, scopeOf, ruleMatches, claimOf, baseName, applyOverlay, homeOf, newSim, simTake, simPut, mark, rollback, MAX_STACK,
  sitesOf, planOrganize, tripCommand, lineBytes, type OverlayMove, type Sim, type Plan,
} from "./organize.mts";

const HERE = dirname(fileURLToPath(import.meta.url));
const RULES = JSON.parse(readFileSync(join(HERE, "rules", "uoalive.json"), "utf8")) as RulesV1;
setRules(RULES);
const NOW = Date.parse(AT) + 3600e3;
const A = 0x40000001, B = 0x40000002, BAG = 0x40000003, FAR = 0x40000004, STRANGER = 0x40000005, POUCH = 0x40000006, C = 0x40000007, PACK = 0x40000008;
const PEARL = 0x40001001, RUBY = 0x40001002, KATANA = 0x40001003, ASH = 0x40001004, GARLIC = 0x40001005, PEARL2 = 0x40001006, PEARL3 = 0x40001007;
const fold = (boxes: BoxSpec[], things: ThingSpec[] = []): Inventory => foldSnapshots([houseScan({ boxes, things })]);
const labels = (...serials: number[]): Record<string, ContainerLabel> =>
  Object.fromEntries(serials.map((s) => [String(s), { serial: s, name: `Box ${s}`, origin: "manual" as const }]));
const rule = (id: string, query: Partial<RuleQuery>, targets: number[], names?: string[]): OrganizeRule =>
  ({ id, name: id, match: { query: { ...emptyRuleQuery(), ...query }, ...(names ? { names } : {}) }, targets, origin: "manual" });
const config = (over: Partial<OrganizeConfig>): OrganizeConfig => ({ ...emptyOrganizeConfig(), ...over });
const at = (x: number, facet = 1) => ({ x, y: 100, z: 0, facet });

test("[fast] ancestry walks a container up to its root, and gives up on a missing link or past eight", () => {
  const inv = fold([{ serial: A }, { serial: BAG, parent: A }, { serial: POUCH, parent: BAG }]);
  assert.deepEqual(ancestry(inv, POUCH), [POUCH, BAG, A]);
  assert.equal(ancestry(inv, 0x4000ffff), null);
  assert.equal(ancestry(inv, null), null);
  const deep: BoxSpec[] = [{ serial: 0x40000100 }];
  for (let i = 1; i < 10; i++) deep.push({ serial: 0x40000100 + i, parent: 0x40000100 + i - 1 });
  assert.equal(ancestry(fold(deep), 0x40000109), null);
});

test("[fast] only items in labelled ground roots can move; unlabelled chests, bags, pinned items and pinned containers never do", () => {
  const inv = fold([{ serial: A }, { serial: BAG, parent: A }, { serial: STRANGER, pos: at(102) }, { serial: B, pos: at(104) }],
    [{ serial: PEARL, name: "Black Pearl", in: A }, { serial: RUBY, name: "Ruby", in: BAG }, { serial: ASH, name: "Sulfurous Ash", in: STRANGER },
      { serial: KATANA, name: "Katana", in: B }, { serial: GARLIC, name: "Garlic", in: B }]);
  const cfg = config({ labels: { ...labels(A), [String(B)]: { serial: B, name: "Display", pinned: true, origin: "manual" } }, pinnedItems: [PEARL] });
  const s = scopeOf(inv, cfg, { now: NOW });
  assert.deepEqual(s.movable, [RUBY]);
  assert.deepEqual(s.roots, [A, B]);
  assert.deepEqual([...s.usable], [A], "a pinned container is never filled");
  assert.deepEqual(s.warnings, []);
});

test("[fast] an unopened bag's remembered contents and a blacklisted bag's never move", () => {
  const inv = fold([{ serial: A }, { serial: BAG, parent: A, opened: false }, { serial: POUCH, parent: A }],
    [{ serial: PEARL, name: "Black Pearl", in: BAG }, { serial: RUBY, name: "Ruby", in: POUCH }, { serial: GARLIC, name: "Garlic", in: A }]);
  assert.equal(inv.containers[BAG]!.opened, false, "the fold keeps the scan's opened:false");
  const s = scopeOf(inv, config({ labels: labels(A) }), { now: NOW, blacklist: [POUCH] });
  assert.deepEqual(s.movable, [GARLIC]);
});

test("[fast] a root blacklisted after it was labelled moves nothing and says so", () => {
  const inv = fold([{ serial: A }, { serial: B, pos: at(104) }], [{ serial: PEARL, name: "Black Pearl", in: A }, { serial: RUBY, name: "Ruby", in: B }]);
  const s = scopeOf(inv, config({ labels: labels(A, B), rules: [rule("gems", { kind: ["gem"] }, [A])] }), { now: NOW, blacklist: [A] });
  assert.deepEqual(s.movable, [RUBY]);
  assert.deepEqual(s.roots, [B]);
  assert.equal(s.usable.has(A), false);
  assert.deepEqual(s.warnings.map((w) => [w.kind, w.serial]), [["blacklisted", A]]);
});

test("[fast] labels on a backpack, on a chest with no position and on a vanished container are reported, not used", () => {
  const inv = fold([{ serial: PACK, kind: "backpack" }, { serial: A, pos: null }], [{ serial: PEARL, name: "Black Pearl", in: A }]);
  const s = scopeOf(inv, config({ labels: labels(PACK, A, 0x4000ffff) }), { now: NOW, seen: { [String(0x4000ffff)]: "2026-09-01T00:00:00Z" } });
  assert.deepEqual(s.movable, []);
  assert.deepEqual(s.warnings.map((w) => [w.kind, w.serial]), [["no-position", A], ["not-ground", PACK], ["missing-label", 0x4000ffff]].sort((x, y) => (x[1] as number) - (y[1] as number)));
  assert.match(s.warnings.find((w) => w.kind === "missing-label")!.detail, /not seen since 2026-09-01T00:00:00Z/);
});

test("[fast] a target whose fill is unknown is reported: a chest from an old scan as old scripts, one without a Contents line as unknown", () => {
  const inv = fold([{ serial: A, tooltip: null }, { serial: B, pos: at(104), tooltip: ["Box"] }]);
  const s = scopeOf(inv, config({ labels: labels(A, B), rules: [rule("any", {}, [A, B])] }), { now: NOW });
  assert.deepEqual([...s.usable], []);
  assert.deepEqual(s.warnings.map((w) => [w.kind, w.serial]), [["old-scripts", A], ["unknown-capacity", B]]);
});

test("[fast] a container last scanned over a week ago is warned about and still used", () => {
  const inv = fold([{ serial: A }]);
  const s = scopeOf(inv, config({ labels: labels(A) }), { now: Date.parse(AT) + 8 * 864e5 });
  assert.deepEqual(s.warnings.map((w) => [w.kind, w.serial]), [["stale-container", A]]);
  assert.equal(s.usable.has(A), true);
});

test("[fast] the first rule that matches claims an item; later matches are only recorded; unclaimed goes to the catch-all or stays", () => {
  const inv = fold([{ serial: A }], [{ serial: PEARL, name: "Black Pearl", in: A }, { serial: GARLIC, name: "Garlic", in: A }, { serial: KATANA, name: "Katana", in: A }]);
  const rules = [rule("pearls", {}, [A], ["black pearl"]), rule("reagents", { kind: ["reagent"] }, [A])];
  const cfg = config({ labels: labels(A), rules });
  assert.deepEqual(claimOf(inv.items[PEARL]!, cfg), { ruleId: "pearls", alsoMatched: ["reagents"] });
  assert.deepEqual(claimOf(inv.items[GARLIC]!, cfg), { ruleId: "reagents", alsoMatched: [] });
  assert.equal(claimOf(inv.items[KATANA]!, cfg), null);
  assert.deepEqual(claimOf(inv.items[KATANA]!, { ...cfg, catchAll: A }), { ruleId: CATCH_ALL_ID, alsoMatched: [] });
});

test("[fast] rule names match the item's own name, stack count stripped, case-insensitive, and the query must pass too", () => {
  const inv = fold([{ serial: A }], [{ serial: ASH, name: "Grave Dust", amount: 75, in: A }, { serial: PEARL, name: "Black Pearl", in: A }]);
  const dust = inv.items[ASH]!;
  assert.equal(baseName(dust.name), "grave dust");
  assert.equal(ruleMatches(dust, { query: emptyRuleQuery(), names: ["grave dust"] }), true);
  assert.equal(ruleMatches(dust, { query: emptyRuleQuery(), names: ["GRAVE"] }), true);
  assert.equal(ruleMatches(inv.items[PEARL]!, { query: emptyRuleQuery(), names: ["grave dust"] }), false);
  assert.equal(ruleMatches(dust, { query: { ...emptyRuleQuery(), kind: ["gem"] }, names: ["grave dust"] }), false);
});

test("[fast] a rule's free text never matches where the item sits", () => {
  const inv = fold([{ serial: A, name: "Reagents" }], [{ serial: KATANA, name: "Katana", in: A }, { serial: GARLIC, name: "Garlic", in: A }]);
  const m = { query: { ...emptyRuleQuery(), q: "reagent" } };
  assert.equal(ruleMatches(inv.items[KATANA]!, m), false, "a sword in a chest called Reagents is not a reagent");
  assert.equal(ruleMatches(inv.items[GARLIC]!, m), true);
});

const T1 = "2026-09-28T11:00:00Z";
const step = (serial: number, name: string, from: number | null, to: number | null, when = T1): OverlayMove => ({ serial, name, from, to, at: when, trip: "t-1" });

test("[fast] homeOf: the nearest container above an item that is some rule's target", () => {
  const inv = fold([{ serial: A }, { serial: BAG, parent: A }, { serial: POUCH, parent: BAG }], [{ serial: PEARL, name: "Black Pearl", in: POUCH }]);
  const pearl = inv.items[PEARL]!;
  assert.equal(homeOf(inv, pearl, new Set([A])), A, "a sub-bag of a target counts as the target");
  assert.equal(homeOf(inv, pearl, new Set([A, BAG])), BAG, "a sub-bag that is itself a target is the item's home");
  assert.equal(homeOf(inv, pearl, new Set()), null);
});

test("[fast] the overlay puts a moved item where the bridge put it and adjusts both containers' counts", () => {
  const inv = fold([{ serial: A }, { serial: B, pos: at(104) }], [{ serial: PEARL, name: "Black Pearl", in: A, weight: 3 }]);
  const before = JSON.stringify(inv);
  const placed = applyOverlay(inv, [step(PEARL, "Black Pearl", A, B)]);
  assert.equal(placed.inv.items[PEARL]!.container, B);
  assert.equal(placed.inv.items[PEARL]!.root, B);
  assert.deepEqual(placed.counts.get(A), { items: 0, maxItems: 125, stones: 0, maxStones: null });
  assert.deepEqual(placed.counts.get(B), { items: 1, maxItems: 125, stones: 3, maxStones: null });
  assert.deepEqual(placed.carried, []);
  assert.equal(JSON.stringify(inv), before, "the inventory handed in is not changed");
});

test("[fast] an overlay step the scans have seen since is ignored", () => {
  const inv = fold([{ serial: A }, { serial: B, pos: at(104) }], [{ serial: PEARL, name: "Black Pearl", in: A }]);
  const placed = applyOverlay(inv, [step(PEARL, "Black Pearl", A, B, "2026-09-28T09:00:00Z")]);
  assert.equal(placed.inv.items[PEARL]!.container, A);
  assert.equal(placed.counts.get(B)!.items, 0);
});

test("[fast] an overlay step for an item gone from the scans still counts in its destination until that is rescanned", () => {
  const first = houseScan({ boxes: [{ serial: A }, { serial: B, pos: at(104) }], things: [{ serial: PEARL, name: "Black Pearl", in: A }] });
  const rescanOfA = houseScan({ scannedAt: "2026-09-28T12:00:00Z", boxes: [{ serial: A }] });
  const inv = foldSnapshots([first, rescanOfA]);
  assert.equal(inv.items[PEARL], undefined, "A was rescanned without it");
  const placed = applyOverlay(inv, [step(PEARL, "Black Pearl", A, B)]);
  assert.equal(placed.counts.get(A)!.items, 0, "A's Contents line was read after the step: it already leaves the pearl out");
  assert.equal(placed.counts.get(B)!.items, 1, "B's line predates the step");
});

test("[fast] an item taken and not yet put is carried, in no container", () => {
  const inv = fold([{ serial: A }], [{ serial: PEARL, name: "Black Pearl", in: A }]);
  const placed = applyOverlay(inv, [step(PEARL, "Black Pearl", A, null)]);
  assert.equal(placed.inv.items[PEARL]!.container, null);
  assert.equal(placed.inv.items[PEARL]!.root, null);
  assert.deepEqual(placed.carried, [{ serial: PEARL, name: "Black Pearl" }]);
  assert.equal(placed.counts.get(A)!.items, 0);
});

const simOf = (inv: Inventory): Sim => newSim(inv, applyOverlay(inv, []).counts);
const fill = (s: Sim, serial: number) => [s.counts.get(serial)!.items, s.counts.get(serial)!.stones];

test("[fast] a take frees a slot in its container and every container around it, and rollback puts it back", () => {
  const inv = fold([{ serial: A }, { serial: BAG, parent: A }], [{ serial: PEARL, name: "Black Pearl", in: BAG, weight: 2 }]);
  const s = simOf(inv);
  const m = mark(s);
  simTake(s, inv.items[PEARL]!);
  assert.deepEqual([fill(s, A), fill(s, BAG)], [[1, 0], [0, 0]]);
  rollback(s, m);
  assert.deepEqual([fill(s, A), fill(s, BAG)], [[2, 2], [1, 2]]);
});

test("[fast] a put needs room in the target and in every container around it", () => {
  const inv = fold([{ serial: A, max: 2 }, { serial: BAG, parent: A, max: 10 }, { serial: C, pos: at(106) }],
    [{ serial: RUBY, name: "Ruby", in: A }, { serial: GARLIC, name: "Garlic", in: C }]);
  const s = simOf(inv);
  assert.equal(simPut(s, inv.items[GARLIC]!, [BAG], new Set()), null, "the bag has room, the chest around it does not");
  simTake(s, inv.items[RUBY]!);
  assert.deepEqual(simPut(s, inv.items[GARLIC]!, [BAG], new Set()), { to: BAG, merged: false });
  assert.deepEqual([fill(s, A)[0], fill(s, BAG)[0]], [2, 1]);
});

test("[fast] the chain overflows into its next target when the first is full", () => {
  const inv = fold([{ serial: A, max: 1 }, { serial: C, pos: at(106) }, { serial: B, pos: at(104) }],
    [{ serial: RUBY, name: "Ruby", in: A }, { serial: GARLIC, name: "Garlic", in: B }]);
  assert.deepEqual(simPut(simOf(inv), inv.items[GARLIC]!, [A, C], new Set()), { to: C, merged: false });
});

test("[fast] a put merges into a same-name, same-hue, same-graphic stack already in that exact container, using no slot", () => {
  const inv = fold([{ serial: A, max: 1 }, { serial: B, pos: at(104) }],
    [{ serial: PEARL, name: "Black Pearl", amount: 10, weight: 10, in: A }, { serial: PEARL2, name: "Black Pearl", amount: 5, weight: 5, in: B }]);
  const s = simOf(inv);
  assert.deepEqual(simPut(s, inv.items[PEARL2]!, [A], new Set()), { to: A, merged: true });
  assert.deepEqual(fill(s, A), [1, 15]);
});

test("[fast] single items never merge, nor stacks past 60,000, nor other hues, nor into a stack that is itself moving", () => {
  const cases: [string, ThingSpec, ThingSpec, Set<number>][] = [
    ["two single items", { serial: KATANA, name: "Katana", in: A }, { serial: PEARL2, name: "Katana", in: B }, new Set()],
    ["past the stack cap", { serial: PEARL, name: "Black Pearl", amount: MAX_STACK - 2, in: A }, { serial: PEARL2, name: "Black Pearl", amount: 5, in: B }, new Set()],
    ["another hue", { serial: PEARL, name: "Black Pearl", amount: 10, in: A }, { serial: PEARL2, name: "Black Pearl", amount: 5, hue: 1150, in: B }, new Set()],
    ["a stack that is moving", { serial: PEARL, name: "Black Pearl", amount: 10, in: A }, { serial: PEARL2, name: "Black Pearl", amount: 5, in: B }, new Set([PEARL])],
  ];
  for (const [what, there, incoming, movers] of cases) {
    const inv = fold([{ serial: A, max: 1 }, { serial: B, pos: at(104) }], [there, incoming]);
    assert.equal(simPut(simOf(inv), inv.items[incoming.serial]!, [A], movers), null, what);
  }
});

test("[fast] weight is checked only where the container has a stone cap", () => {
  const inv = fold([{ serial: A, maxStones: 10 }, { serial: B, pos: at(104) }, { serial: C, pos: at(106) }],
    [{ serial: PEARL, name: "Black Pearl", in: A, weight: 9 }, { serial: GARLIC, name: "Garlic", in: C, weight: 2 }, { serial: RUBY, name: "Ruby", in: C, weight: 1 }]);
  const s = simOf(inv);
  assert.equal(simPut(s, inv.items[GARLIC]!, [A], new Set()), null);
  assert.deepEqual(simPut(s, inv.items[RUBY]!, [A], new Set()), { to: A, merged: false });
  assert.deepEqual(simPut(s, inv.items[GARLIC]!, [B], new Set()), { to: B, merged: false }, "no cap on B");
});

const reagents = (targets: number[]) => rule("reagents", { kind: ["reagent"] }, targets);
const gems = (targets: number[]) => rule("gems", { kind: ["gem"] }, targets);
const moved = (p: Plan): (number | null)[][] => p.moves.map((m) => [m.serial, m.from, m.to, m.trip]).sort((x, y) => x[0]! - y[0]!);
const pearls = (n: number, inside: number, weight = 1): ThingSpec[] => Array.from({ length: n }, (_, i) => ({ serial: 0x40002000 + i, name: "Black Pearl", in: inside, weight }));

test("[fast] items move into their rule's target; unclaimed items stay; unlabelled chests are never touched", () => {
  const inv = fold([{ serial: A, pos: at(100) }, { serial: B, pos: at(104) }, { serial: STRANGER, pos: at(102) }],
    [{ serial: PEARL, name: "Black Pearl", in: B }, { serial: RUBY, name: "Ruby", in: A }, { serial: KATANA, name: "Katana", in: A },
      { serial: ASH, name: "Sulfurous Ash", in: STRANGER }, { serial: GARLIC, name: "Garlic", in: A }]);
  const plan = planOrganize(inv, config({ labels: labels(A, B), rules: [reagents([A]), gems([B])] }), [], { now: NOW });
  assert.deepEqual(moved(plan), [[PEARL, B, A, 1], [RUBY, A, B, 1]]);
  assert.deepEqual(plan.trips, [{ index: 1, site: 0, takes: [RUBY, PEARL], puts: [RUBY, PEARL] }]);
  assert.deepEqual(plan.rules, [{ ruleId: "reagents", matched: 2, inPlace: 1, toMove: 1, noRoom: 0 }, { ruleId: "gems", matched: 1, inPlace: 0, toMove: 1, noRoom: 0 }]);
  assert.equal(plan.unclaimed, 1);
  assert.deepEqual(plan.sites, [{ index: 0, roots: [A, B] }]);
});

test("[fast] a chest that is both source and target in one trip: its takes free the room its puts use", () => {
  const inv = fold([{ serial: A, max: 1 }, { serial: B, max: 1, pos: at(104) }], [{ serial: RUBY, name: "Ruby", in: A }, { serial: PEARL, name: "Black Pearl", in: B }]);
  const plan = planOrganize(inv, config({ labels: labels(A, B), rules: [reagents([A]), gems([B])] }), [], { now: NOW });
  assert.deepEqual(moved(plan), [[PEARL, B, A, 1], [RUBY, A, B, 1]]);
  assert.deepEqual(plan.room.map((r) => r.shortfall), [0, 0]);
});

test("[fast] a slot freed by one trip is used by the next, never the other way round", () => {
  const inv = fold([{ serial: A, max: 1 }, { serial: B, max: 5, pos: at(104) }], [{ serial: RUBY, name: "Ruby", in: A }, { serial: PEARL, name: "Black Pearl", in: B }]);
  const plan = planOrganize(inv, config({ labels: labels(A, B), rules: [reagents([A]), gems([B])] }), [], { now: NOW, tripItems: 1 });
  assert.deepEqual(moved(plan), [[PEARL, B, A, 2], [RUBY, A, B, 1]]);
});

test("[fast] a full chain leaves the rest where they are, counted as no room", () => {
  const inv = fold([{ serial: A, max: 1 }, { serial: C, max: 1, pos: at(106) }, { serial: B, pos: at(104) }],
    [{ serial: PEARL, name: "Black Pearl", in: B }, { serial: PEARL2, name: "Black Pearl", in: B }, { serial: PEARL3, name: "Black Pearl", in: B }]);
  const plan = planOrganize(inv, config({ labels: labels(A, B, C), rules: [reagents([A, C])] }), [], { now: NOW });
  assert.deepEqual(moved(plan), [[PEARL, B, A, 1], [PEARL2, B, C, 1]]);
  assert.deepEqual(plan.rules, [{ ruleId: "reagents", matched: 3, inPlace: 0, toMove: 2, noRoom: 1 }]);
  assert.deepEqual(plan.room, [{ ruleId: "reagents", needSlots: 3, freeSlots: 2, shortfall: 1 }]);
});

test("[fast] a rule targeting a chest at another house plans no move and reports it", () => {
  const OTHER_FACET = 0x40000009;
  const inv = fold([{ serial: A, pos: at(100) }, { serial: FAR, pos: at(400) }, { serial: OTHER_FACET, pos: at(100, 2) }], [{ serial: RUBY, name: "Ruby", in: A }]);
  for (const target of [FAR, OTHER_FACET]) {
    const plan = planOrganize(inv, config({ labels: labels(A, target), rules: [gems([target])] }), [], { now: NOW });
    assert.deepEqual(plan.moves, []);
    assert.deepEqual(plan.crossSite, [{ ruleId: "gems", count: 1 }]);
    assert.equal(plan.sites.length, 2);
  }
});

test("[fast] sites join chests single-link within 24 tiles on the same facet", () => {
  const D = 0x40000010;
  const inv = fold([{ serial: A, pos: at(100) }, { serial: B, pos: at(120) }, { serial: C, pos: at(140) }, { serial: D, pos: at(110, 2) }]);
  assert.deepEqual(sitesOf(inv, [D, C, B, A]), [[A, B, C], [D]]);
});

test("[fast] with a catch-all, unclaimed items go there; without one they stay", () => {
  const inv = fold([{ serial: A }, { serial: C, pos: at(106) }], [{ serial: KATANA, name: "Katana", in: A }]);
  const plan = planOrganize(inv, config({ labels: labels(A, C), catchAll: C }), [], { now: NOW });
  assert.deepEqual(plan.moves.map((m) => [m.serial, m.to, m.ruleId]), [[KATANA, C, CATCH_ALL_ID]]);
  assert.equal(planOrganize(inv, config({ labels: labels(A, C) }), [], { now: NOW }).unclaimed, 1);
});

test("[fast] a rule naming a container no scan has seen moves nothing, even into its other targets", () => {
  const inv = fold([{ serial: A }, { serial: B, pos: at(104) }], [{ serial: PEARL, name: "Black Pearl", in: B }]);
  const plan = planOrganize(inv, config({ labels: { ...labels(A, B), ...labels(0x4000ffff) }, rules: [reagents([0x4000ffff, A])] }), [], { now: NOW });
  assert.deepEqual(plan.moves, []);
  assert.ok(plan.warnings.some((w) => w.kind === "missing-target" && w.serial === 0x4000ffff));
});

test("[fast] trips hold at most tripItems items and tripStones stones", () => {
  const light = fold([{ serial: A }, { serial: B, pos: at(104) }], pearls(25, B));
  const cfg = config({ labels: labels(A, B), rules: [reagents([A])] });
  assert.deepEqual(planOrganize(light, cfg, [], { now: NOW }).trips.map((t) => t.takes.length), [20, 5]);
  const heavy = fold([{ serial: A }, { serial: B, pos: at(104) }], pearls(25, B, 10));
  assert.deepEqual(planOrganize(heavy, cfg, [], { now: NOW }).trips.map((t) => t.takes.length), [15, 10]);
});

test("[fast] every trip's queue line fits tripBytes", () => {
  const inv = fold([{ serial: A }, { serial: B, pos: at(104) }], pearls(20, B));
  const plan = planOrganize(inv, config({ labels: labels(A, B), rules: [reagents([A])] }), [], { now: NOW, tripBytes: 1024 });
  assert.ok(plan.trips.length > 1);
  for (const t of plan.trips) assert.ok(lineBytes(tripCommand(inv, plan, t.index)!) <= 1024, `trip ${t.index}`);
  assert.equal(plan.moves.length, 20);
});

test("[fast] two full chests trade contents: each trip takes for both rules, so the takes make the room", () => {
  const garlic: ThingSpec[] = Array.from({ length: 20 }, (_, i) => ({ serial: 0x40002000 + i, name: "Garlic", in: A, hue: i }));
  const rubies: ThingSpec[] = Array.from({ length: 20 }, (_, i) => ({ serial: 0x40003000 + i, name: "Ruby", in: B, hue: i }));
  const inv = fold([{ serial: A, max: 20 }, { serial: B, max: 20, pos: at(104) }], [...garlic, ...rubies]);
  const plan = planOrganize(inv, config({ labels: labels(A, B), rules: [reagents([B]), gems([A])] }), [], { now: NOW });
  assert.deepEqual(plan.rules.map((r) => [r.ruleId, r.toMove, r.noRoom]), [["reagents", 20, 0], ["gems", 20, 0]]);
  assert.deepEqual(plan.trips.map((t) => [t.takes.length, t.puts.length]), [[20, 20], [20, 20]]);
});

test("[fast] items a trip carried and did not put are planned as puts with nothing to take", () => {
  const inv = fold([{ serial: A }, { serial: B, pos: at(104) }], [{ serial: PEARL, name: "Black Pearl", in: B }]);
  const plan = planOrganize(inv, config({ labels: labels(A, B), rules: [reagents([A])] }), [step(PEARL, "Black Pearl", B, null)], { now: NOW });
  assert.deepEqual(plan.carried, [{ serial: PEARL, name: "Black Pearl" }]);
  assert.deepEqual(moved(plan), [[PEARL, null, A, 1]]);
  assert.deepEqual(plan.trips, [{ index: 1, site: 0, takes: [], puts: [PEARL] }]);
});

test("[fast] a carried item pinned since (a put the server refused) is not planned again", () => {
  const inv = fold([{ serial: A }, { serial: B, pos: at(104) }], [{ serial: PEARL, name: "Black Pearl", in: B }]);
  const plan = planOrganize(inv, config({ labels: labels(A, B), rules: [reagents([A])], pinnedItems: [PEARL] }), [step(PEARL, "Black Pearl", B, null)], { now: NOW });
  assert.deepEqual(plan.carried, [{ serial: PEARL, name: "Black Pearl" }]);
  assert.deepEqual(plan.moves, []);
});

test("[fast] a finished trip in the overlay is not planned again", () => {
  const inv = fold([{ serial: A }, { serial: B, pos: at(104) }], [{ serial: PEARL, name: "Black Pearl", in: B }]);
  const plan = planOrganize(inv, config({ labels: labels(A, B), rules: [reagents([A])] }), [step(PEARL, "Black Pearl", B, A)], { now: NOW });
  assert.deepEqual(plan.moves, []);
  assert.deepEqual(plan.rules, [{ ruleId: "reagents", matched: 1, inPlace: 1, toMove: 0, noRoom: 0 }]);
});

test("[fast] the same inputs in any order give the same plan", () => {
  const boxes: BoxSpec[] = [{ serial: A, max: 3 }, { serial: BAG, parent: A }, { serial: B, pos: at(104) }, { serial: C, pos: at(110) }];
  const things: ThingSpec[] = [...pearls(6, B), { serial: RUBY, name: "Ruby", in: BAG }, { serial: KATANA, name: "Katana", in: B }, { serial: GARLIC, name: "Garlic", in: C }];
  const cfg = config({ labels: labels(A, B, C), rules: [reagents([A, C]), gems([B])], catchAll: C });
  const shuffled = { ...cfg, labels: Object.fromEntries(Object.entries(cfg.labels).reverse()) };
  const one = planOrganize(fold(boxes, things), cfg, [], { now: NOW });
  const two = planOrganize(fold([...boxes].reverse(), [...things].reverse()), shuffled, [], { now: NOW });
  assert.equal(JSON.stringify(two), JSON.stringify(one));
});

test("[fast] the stamp changes when the plan changes, and only then", () => {
  const inv = fold([{ serial: A }, { serial: B, pos: at(104) }], [{ serial: PEARL, name: "Black Pearl", in: B }]);
  const cfg = config({ labels: labels(A, B), rules: [reagents([A])] });
  const stamp = planOrganize(inv, cfg, [], { now: NOW }).stamp;
  assert.match(stamp, /^[0-9a-f]{8}$/);
  assert.equal(planOrganize(inv, cfg, [], { now: NOW + 1000 }).stamp, stamp);
  assert.notEqual(planOrganize(inv, { ...cfg, rules: [reagents([B])] }, [], { now: NOW }).stamp, stamp);
  assert.notEqual(planOrganize(inv, cfg, [step(PEARL, "Black Pearl", B, A)], { now: NOW }).stamp, stamp);
});

test("[fast] tripCommand builds the line queueTrip writes: every root placed once, chains root first, the plan's stamp", () => {
  const inv = fold([{ serial: A }, { serial: BAG, parent: A }, { serial: B, pos: { x: 104, y: 100, z: 5, facet: 1 } }],
    [{ serial: PEARL, name: "Black Pearl", in: B }, { serial: RUBY, name: "Ruby", in: BAG }]);
  const plan = planOrganize(inv, config({ labels: { ...labels(A, B), ...labels(BAG) }, rules: [reagents([BAG]), gems([B])] }), [], { now: NOW });
  const trip = tripCommand(inv, plan, 1)!;
  assert.deepEqual(trip, {
    index: 1, stamp: plan.stamp,
    roots: { [String(A)]: { x: 100, y: 100, z: 0, facet: 1 }, [String(B)]: { x: 104, y: 100, z: 5, facet: 1 } },
    takes: [{ serial: RUBY, name: "Ruby", chain: [A, BAG] }, { serial: PEARL, name: "Black Pearl", chain: [B] }],
    puts: [{ serial: RUBY, name: "Ruby", dest: [B] }, { serial: PEARL, name: "Black Pearl", dest: [A, BAG] }],
  });
  assert.equal(tripCommand(inv, plan, 2), null);
  const paths = resolveConfig(["--port", "0", "--data", mkdtempSync(join(tmpdir(), "qm-organize-trip-"))], {}).paths;
  const queued = queueTrip(paths, "tazuo", trip);
  assert.equal(queued.ok, true, JSON.stringify(queued));
});

test("[smoke] the TazUO fixture: every put fits when the trips are replayed in order", () => {
  const raw = JSON.parse(readFileSync(join(HERE, "..", "adapters", "tazuo", "fixture.scan.json"), "utf8")) as ScanV2;
  const inv = foldSnapshots([raw]);
  const grounds = Object.values(inv.containers).filter((c) => c.parent == null && c.kind === "ground").map((c) => +c.serial).sort((a, b) => a - b);
  const cfg = config({ labels: labels(...grounds), rules: [rule("gear", { kind: ["gear"] }, [grounds[2]!, grounds[3]!])] });
  const now = Date.parse(raw.scannedAt) + 3600e3;
  const plan = planOrganize(inv, cfg, [], { now });
  assert.ok(plan.moves.length > 0);
  for (const m of plan.moves) assert.ok(cfg.labels[String(ancestry(inv, m.to)!.at(-1))], `move ${m.serial} lands in a labelled root`);
  const counts = new Map(Object.values(inv.containers).filter((c) => c.capacity).map((c) => [+c.serial, c.capacity!.items]));
  const bump = (serial: number | null, d: number): void => { for (const s of ancestry(inv, serial) ?? []) if (counts.has(s)) counts.set(s, counts.get(s)! + d); };
  for (const trip of plan.trips) {
    for (const s of trip.takes) bump(plan.moves.find((m) => m.serial === s)!.from, -1);
    for (const s of trip.puts) {
      const m = plan.moves.find((x) => x.serial === s)!;
      bump(m.to, 1);
      for (const c of ancestry(inv, m.to)!) assert.ok(counts.get(c)! <= inv.containers[c]!.capacity!.maxItems, `trip ${trip.index} overfills ${c}`);
    }
  }
  const reordered = foldSnapshots([{ ...raw, items: [...raw.items].reverse() }]);
  assert.equal(JSON.stringify(planOrganize(reordered, cfg, [], { now })), JSON.stringify(plan));
});
