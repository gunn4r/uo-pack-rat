// organize-config.test.mts — app/organize-config.mts (issue #11): the strict check PUT /api/organize runs on
// an Organize setup, and the salvage every read of a hand-edited organize.json goes through. Pure.
// Tags: [fast]. Run: node --test app/organize-config.test.mts
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkOrganizeConfig, salvageOrganizeConfig, emptyOrganizeConfig, emptyRuleQuery, ruleMatchOf, CATCH_ALL_ID, EMPTY_BAGS_ID, MAX_SETUP_BYTES, type OrganizeConfig, type OrganizeRule } from "./organize-config.mts";
import { maxOrganizeConfig } from "./organize-fixture.mts";
import type { RuleQuery } from "./item-query.mts";

const A = 0x40000001, B = 0x40000002, P = 0x40000003;
function full(): OrganizeConfig {
  return {
    version: 1,
    labels: {
      [String(A)]: { serial: A, name: "Reagents", color: "#2a7f62", origin: "manual" },
      [String(B)]: { serial: B, name: "Gems", origin: "strategy:simple" },
      [String(P)]: { serial: P, name: "Display", pinned: true, origin: "manual" },
    },
    rules: [
      { id: "r1", name: "Reagents", match: { query: { ...emptyRuleQuery(), kind: ["reagent"] }, names: ["black pearl"] }, targets: [A], origin: "manual" },
      { id: "r2", name: "PS 110", match: { query: { ...emptyRuleQuery(), props: [{ key: "psLevel", min: 110, op: "eq" }] } }, targets: [B, A], origin: "strategy:simple" },
    ],
    catchAll: B,
    pinnedItems: [0x40001001],
  };
}
function refused(doc: unknown): string {
  const r = checkOrganizeConfig(doc);
  assert.equal(r.ok, false, "accepted");
  return r.ok ? "" : r.error;
}

test("[fast] checkOrganizeConfig accepts an empty setup and a full one", () => {
  assert.deepEqual(checkOrganizeConfig(emptyOrganizeConfig()), { ok: true, config: emptyOrganizeConfig() });
  const r = checkOrganizeConfig(full());
  assert.equal(r.ok, true, r.ok ? "" : r.error);
  const gather = checkOrganizeConfig({ ...full(), emptyBagsTo: A });
  assert.equal(gather.ok, true, gather.ok ? "" : gather.error);
  const built = full();
  built.rules[1]!.match.build = "hybrid";
  // Issue #133: a rule may require tags and skip saved suits; one saved before either (r1 here) still reads.
  built.rules[1]!.match.query.tags = ["brittle"];
  built.rules[1]!.match.skipSuits = true;
  const b = checkOrganizeConfig(built);
  assert.equal(b.ok, true, b.ok ? "" : b.error);
});

test("[fast] checkOrganizeConfig refuses each broken part and names it", () => {
  const cases: [string, (c: OrganizeConfig) => void, RegExp][] = [
    ["a newer version", (c) => { (c as unknown as { version: number }).version = 2; }, /version must be 1/],
    ["an unknown top-level field", (c) => { Object.assign(c, { extra: 1 }); }, /extra is not an Organize field/],
    ["a label keyed by a non-serial", (c) => { c.labels["0x10"] = { serial: 16, name: "x", origin: "manual" }; }, /labels key "0x10"/],
    ["a label whose serial disagrees with its key", (c) => { c.labels[String(A)]!.serial = B; }, /labels\.1073741825\.serial must be 1073741825/],
    ["an empty label name", (c) => { c.labels[String(A)]!.name = ""; }, /name must be 1 to 64 characters/],
    ["a colour that is not #rrggbb", (c) => { c.labels[String(A)]!.color = "red"; }, /#rrggbb/],
    ["an unknown origin", (c) => { c.labels[String(A)]!.origin = "auto" as "manual"; }, /origin/],
    ["a rule id used twice", (c) => { c.rules[1]!.id = "r1"; }, /used twice/],
    ["a rule id that is the catch-all's", (c) => { c.rules[0]!.id = CATCH_ALL_ID; }, /reserved/],
    ["a rule id that is the empty bags'", (c) => { c.rules[0]!.id = EMPTY_BAGS_ID; }, /reserved for the empty bags/],
    ["a rule query with a location filter", (c) => { Object.assign(c.rules[0]!.match.query, { loc: ["Chest"] }); }, /loc is not a rule filter/],
    ["a rule query missing a field", (c) => { delete (c.rules[0]!.match.query as Partial<RuleQuery>).kind; }, /kind is missing/],
    ["a property filter with a bad operator", (c) => { c.rules[1]!.match.query.props = [{ key: "psLevel", min: 110, op: "ge" as "le" }]; }, /props\[0\]/],
    ["an empty name in names", (c) => { c.rules[0]!.match.names = [""]; }, /names/],
    ["an unknown build", (c) => { c.rules[0]!.match.build = "wizard" as "caster"; }, /rules\[0\]\.match\.build must be one of caster, melee, hybrid, tank, other/],
    ["an unknown school", (c) => { c.rules[0]!.match.school = "pyromancy" as "magery"; }, /rules\[0\]\.match\.school must be one of magery, necromancy, mysticism, spellweaving/],
    ["too many required tags", (c) => { c.rules[0]!.match.query.tags = Array(11).fill("brittle"); }, /rules\[0\]\.match\.query\.tags must be a list of at most 10 tags/],
    ["a skipSuits that is not true or false", (c) => { c.rules[0]!.match.skipSuits = "yes" as unknown as boolean; }, /rules\[0\]\.match\.skipSuits must be true or false/],
    ["a target that is not labelled", (c) => { c.rules[0]!.targets = [0x40000009]; }, /not a labeled container/],
    ["a pinned target, naming the rule and the container", (c) => { c.rules[0]!.targets = [P]; }, /^The rule "Reagents" puts items into Display, which is pinned: nothing is put into a pinned container\. Take it off the rule, or unpin it\.$/],
    ["a target listed twice", (c) => { c.rules[0]!.targets = [A, A]; }, /twice/],
    ["a pinned catch-all", (c) => { c.catchAll = P; }, /catchAll.*pinned/],
    ["an unlabelled catch-all", (c) => { c.catchAll = 0x40000009; }, /catchAll/],
    ["a pinned gather container", (c) => { c.emptyBagsTo = P; }, /emptyBagsTo.*pinned/],
    ["an unlabelled gather container", (c) => { c.emptyBagsTo = 0x40000009; }, /emptyBagsTo: \d+ is not a labeled container/],
    ["a pinned item listed twice", (c) => { c.pinnedItems = [5, 5]; }, /pinnedItems/],
    ["too many rules", (c) => { c.rules = Array.from({ length: 201 }, (_, i) => ({ ...c.rules[0]!, id: `r${i}` })); }, /at most 200/],
  ];
  for (const [what, change, why] of cases) {
    const doc = full();
    change(doc);
    assert.match(refused(doc), why, what);
  }
  for (const doc of [null, [], "x", 5]) assert.match(refused(doc), /must be an object/);
});

test("[fast] salvageOrganizeConfig keeps what still makes sense in a hand-edited file and names what it dropped", () => {
  const doc = full();
  doc.labels["junk"] = { serial: 1, name: "x", origin: "manual" };
  Object.assign(doc.rules[1]!.match.query, { roots: [A] });
  doc.pinnedItems = [7, -1, 7, "x" as unknown as number];
  const { config, problems } = salvageOrganizeConfig(doc);
  assert.deepEqual(Object.keys(config.labels).map(Number).sort((a, b) => a - b), [A, B, P]);
  assert.deepEqual(config.rules.map((r) => r.id), ["r1"]);
  assert.equal(config.catchAll, B);
  assert.deepEqual(config.pinnedItems, [7]);
  assert.equal(problems.length, 3, problems.join("\n"));
  assert.match(problems.join("\n"), /labels key "junk" is not a container serial; label dropped/);
  assert.match(problems.join("\n"), /rules\[1\]\.match\.query\.roots is not a rule filter.*; rule dropped/);
  assert.match(problems.join("\n"), /pinnedItems: 3 entries dropped/);
  const again = checkOrganizeConfig(config);
  assert.equal(again.ok, true, again.ok ? "" : again.error);
});

test("[fast] salvage: a label dropped costs the rules that name it that target only, so their items never fall through to the catch-all", () => {
  const doc = full();
  doc.labels[String(A)]!.color = "blue";
  const { config, problems } = salvageOrganizeConfig(doc);
  assert.deepEqual(Object.keys(config.labels).map(Number).sort((a, b) => a - b), [B, P]);
  assert.deepEqual(config.rules.map((r) => [r.id, r.targets]), [["r1", []], ["r2", [B]]]);
  assert.equal(config.catchAll, B);
  assert.equal(problems.length, 3, problems.join("\n"));
  assert.match(problems.join("\n"), /rules\[0\]\.targets: \d+ is not a labeled container; target dropped/);
  const again = checkOrganizeConfig(config);
  assert.equal(again.ok, true, again.ok ? "" : again.error);
});

test("[fast] salvage: a gather container that lost its label is cleared, and a good one kept (issue #128)", () => {
  const { config, problems } = salvageOrganizeConfig({ ...full(), emptyBagsTo: 0x40000009 });
  assert.equal(config.emptyBagsTo, undefined);
  assert.match(problems.join("\n"), /emptyBagsTo: \d+ is not a labeled container; empty bags left where they are/);
  assert.equal(salvageOrganizeConfig({ ...full(), emptyBagsTo: A }).config.emptyBagsTo, A);
});

test("[fast] salvage: a rule with an unknown build is dropped like any other broken rule", () => {
  const doc = full();
  (doc.rules[0]!.match as { build?: string }).build = "wizard";
  const { config, problems } = salvageOrganizeConfig(doc);
  assert.deepEqual(config.rules.map((r) => r.id), ["r2"]);
  assert.match(problems.join("\n"), /rules\[0\]\.match\.build must be one of .*; rule dropped/);
});

test("[fast] salvage: anything that is not a version 1 Organize file starts empty", () => {
  for (const raw of [null, [], "x", { version: 2 }, {}]) {
    const { config, problems } = salvageOrganizeConfig(raw);
    assert.deepEqual(config, emptyOrganizeConfig());
    assert.equal(problems.length, 1);
  }
});

test("[fast] emptyRuleQuery hands out a fresh object every time", () => {
  const a = emptyRuleQuery();
  a.kind.push("gem");
  assert.deepEqual(emptyRuleQuery().kind, []);
});

test("[fast] the largest setup the check allows fits MAX_SETUP_BYTES as the server saves it", () => {
  const max = maxOrganizeConfig();
  assert.equal(checkOrganizeConfig(max).ok, true);
  assert.ok(Buffer.byteLength(JSON.stringify(max, null, 2) + "\n") <= MAX_SETUP_BYTES);
});

test("[fast] ruleMatchOf reads an Auto rule for tools as taking crafting tools while none of Auto's rules asks for them; a player's own rule as it is (issue #150)", () => {
  const rule = (id: string, kind: string[], origin: OrganizeRule["origin"] = "strategy:simple"): OrganizeRule => ({ id, name: id, match: { query: { ...emptyRuleQuery(), kind } }, targets: [A], origin });
  const tools = rule("auto-tools", ["tool"]), mine = rule("mine", ["tool", "crafting"], "manual");
  assert.deepEqual(ruleMatchOf(tools, [tools, mine]).query.kind, ["tool", "crafting"], "a player's rule asking for crafting leaves it be");
  assert.deepEqual(ruleMatchOf(tools, [tools, rule("auto-tools-2", ["crafting"])]).query.kind, ["tool"], "a proposal made since reads as written");
  assert.deepEqual(ruleMatchOf({ ...tools, origin: "manual" }, [tools]).query.kind, ["tool"]);
  assert.deepEqual(ruleMatchOf(rule("auto-reagents", ["reagent"]), [tools]).query.kind, ["reagent"]);
});
