// organize.test.mts — app/organize.mts, Organize's planner (issue #11), on hand-built house scans
// (app/organize-fixture.mts) folded by the real foldSnapshots, plus a fold of the TazUO adapter fixture.
// Pure: no server. Tags: [fast], one [smoke]. Run: node --test app/organize.test.mts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { foldSnapshots, setRules, type Inventory } from "./vault-lib.mts";
import { houseScan, AT, type BoxSpec, type ThingSpec } from "./organize-fixture.mts";
import { emptyRuleQuery, emptyOrganizeConfig, CATCH_ALL_ID, type OrganizeConfig, type OrganizeRule, type ContainerLabel } from "./organize-config.mts";
import type { RuleQuery } from "./item-query.mts";
import type { RulesV1 } from "./schema/types.d.mts";
import { ancestry, scopeOf, ruleMatches, claimOf, baseName, applyOverlay, homeOf, type OverlayMove } from "./organize.mts";

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
