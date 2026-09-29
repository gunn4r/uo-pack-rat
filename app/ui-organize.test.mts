// ui-organize.test.mts — app/ui/organize-model.mts, the Organize screen's pure rules (issue #11): editing the
// setup (reorder, label, pin, unlabel, rule ids, a rule saved from the Inventory's filters, bags picked as
// targets), the words for rules and their target chains, the live match count, the relabelled location texts,
// the plan's reports and trip list, which trips may run, and how a running trip is watched until it reports
// back. The rendered screen is driven by scripts/ui-organize.test.mts.
import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { parseItemQuery } from "./item-query.mts";
import type { ItemQuery } from "./item-query.mts";
import type { Container } from "./vault-lib.mts";
import type { OrganizeConfig, OrganizeRule } from "./ui/api-types.mts";
import { CATCH_ALL_ID, moveRule, withLabel, withoutLabel, pinnedWith, upsertRule, withoutRule, newRuleId, ruleQueryFrom, blankQuery, droppedNote, ruleNameFrom, checkDraft, matchSummary, extraFilters, targetView, fillText, fillTone, targetOptions, withTargetLabels, matchLine, debounced, MATCH_DEBOUNCE_MS, organizeStage, labelledPlaces } from "./ui/organize-model.mts";

const A = 0x40000001, B = 0x40000002, C = 0x40000003, GONE = 0x40000009;
const chest = (serial: number, over: Partial<Container> = {}): Container => ({ serial, root: serial, parent: null, kind: "ground", name: "Metal Chest", tooltip: ["Metal Chest"], label: `Metal Chest (0x${serial.toString(16)})`, capacity: { items: 61, maxItems: 125, stones: null, maxStones: null }, scannedBy: "Tester", scannedAt: "2026-09-28T10:00:00Z", ...over });
const CONTAINERS: Record<string, Container> = {
  [A]: chest(A),
  [B]: chest(B, { capacity: null }),
  [C]: chest(C, { parent: A, root: A, name: "A Bag", tooltip: ["A Bag"], label: "A Bag", capacity: { items: 118, maxItems: 125, stones: null, maxStones: null } }),
};
const rule = (id: string, name: string, targets: number[] = [], over: Partial<OrganizeRule> = {}): OrganizeRule => ({ id, name, match: { query: blankQuery() }, targets, origin: "manual", ...over });
const CFG: OrganizeConfig = {
  version: 1,
  labels: { [A]: { serial: A, name: "Reagents", color: "#2f7f7f", origin: "manual" }, [B]: { serial: B, name: "Display", pinned: true, origin: "manual" }, [C]: { serial: C, name: "Gems", origin: "manual" } },
  rules: [rule("rule-1", "Reagents", [A]), rule("rule-2", "Gems", [C, A])],
  catchAll: A,
  pinnedItems: [],
};
const CTX = {
  slotLabel: (s: string) => ({ ring: "Ring" } as Record<string, string>)[s] || s,
  propLabel: (k: string) => ({ lmc: "LMC" } as Record<string, string>)[k] || k,
  places: [],
  ladder: ["Minor Magic Item", "Lesser Magic Item", "Greater Magic Item", "Major Magic Item", "Lesser Artifact", "Greater Artifact", "Major Artifact", "Legendary Artifact"],
};
const BASE: ItemQuery = parseItemQuery(new URLSearchParams());
const ids = (cfg: OrganizeConfig): string[] => cfg.rules.map((r) => r.id);

test("[fast] moveRule moves one rule, clamps to the ends, and leaves the setup it was given alone", () => {
  assert.deepEqual(ids(moveRule(CFG, 1, 0)), ["rule-2", "rule-1"]);
  assert.deepEqual(ids(moveRule(CFG, 0, 9)), ["rule-2", "rule-1"]);
  assert.equal(moveRule(CFG, 0, 0), CFG, "no move, same object");
  assert.equal(moveRule(CFG, 5, 0), CFG, "an index outside the list moves nothing");
  assert.deepEqual(ids(CFG), ["rule-1", "rule-2"]);
});

test("[fast] pinning a label takes it off every rule's targets and the catch-all, and names what it came off", () => {
  const { config, dropped } = withLabel(CFG, { serial: A, name: "Reagents", pinned: true, origin: "manual" });
  assert.deepEqual(dropped, ["Reagents", "Gems", "Everything else"]);
  assert.deepEqual(config.rules.map((r) => r.targets), [[], [C]]);
  assert.equal(config.catchAll, null);
  assert.equal(config.labels[String(A)]!.pinned, true);
  const renamed = withLabel(CFG, { serial: A, name: "Regs", origin: "manual" });
  assert.deepEqual(renamed.dropped, []);
  assert.equal(renamed.config.labels[String(A)]!.name, "Regs");
  assert.deepEqual(renamed.config.rules, CFG.rules);
  assert.equal(CFG.labels[String(A)]!.name, "Reagents", "the input is untouched");
});

test("[fast] removing a label removes it from the rules that fill it", () => {
  const { config, dropped } = withoutLabel(CFG, C);
  assert.equal(config.labels[String(C)], undefined);
  assert.deepEqual(config.rules.map((r) => r.targets), [[A], [A]]);
  assert.deepEqual(dropped, ["Gems"]);
  assert.equal(config.catchAll, A);
});

test("[fast] rules are added, replaced, deleted and pinned items added without touching the input", () => {
  assert.deepEqual(ids(upsertRule(CFG, rule("rule-3", "Rings"))), ["rule-1", "rule-2", "rule-3"]);
  const replaced = upsertRule(CFG, rule("rule-1", "Regs", [A]));
  assert.deepEqual(replaced.rules.map((r) => r.name), ["Regs", "Gems"]);
  assert.deepEqual(ids(withoutRule(CFG, "rule-1")), ["rule-2"]);
  assert.deepEqual(pinnedWith(CFG, 77).pinnedItems, [77]);
  const once = pinnedWith(CFG, 77);
  assert.equal(pinnedWith(once, 77), once, "pinning twice changes nothing");
  assert.deepEqual(CFG.pinnedItems, []);
});

test("[fast] newRuleId takes the lowest free rule-N", () => {
  assert.equal(newRuleId([]), "rule-1");
  assert.equal(newRuleId([{ id: "rule-1" }, { id: "rule-3" }]), "rule-2");
  assert.equal(newRuleId(CFG.rules), "rule-3");
});

test("[fast] a rule saved from the Inventory keeps the item filters and names the location, character and seen filters it left out", () => {
  const q: ItemQuery = { ...BASE, q: "ring", chars: ["Tester"], loc: ["Metal Chest"], roots: [A], seenDays: 7, slot: ["ring"], kind: ["gear"], rarityMin: "Lesser Artifact", props: [{ key: "lmc", min: 8 }], group: true, sort: "lmc", dir: -1 };
  const { query, dropped } = ruleQueryFrom(q);
  assert.deepEqual(Object.keys(query).sort(), ["hideTags", "kind", "med", "nogarg", "props", "q", "rarity", "rarityMax", "rarityMin", "slayer", "slot"]);
  assert.deepEqual([query.q, query.slot, query.kind, query.rarityMin, query.props], ["ring", ["ring"], ["gear"], "Lesser Artifact", [{ key: "lmc", min: 8 }]]);
  assert.notEqual(query.props, q.props, "a copy, so editing the rule never edits the Inventory's filters");
  assert.deepEqual(dropped, ["Location", "Character", "Seen"]);
  assert.equal(droppedNote(dropped), "Location, Character and Seen filters are left out: a rule matches items wherever they are, so it keeps matching after they move.");
  assert.equal(droppedNote(["Location"]), "Location filter is left out: a rule matches items wherever they are, so it keeps matching after they move.");
  assert.equal(droppedNote([]), null);
  assert.equal(ruleNameFrom(q, CTX), "Search: ring");
  assert.equal(ruleNameFrom(BASE, CTX), "Saved search");
  assert.deepEqual(blankQuery(), ruleQueryFrom(BASE).query);
});

test("[fast] checkDraft trims the name and the names list and says what is wrong in plain words", () => {
  assert.deepEqual(checkDraft("  Reagents ", "black pearl\n\n  bloodmoss "), { name: "Reagents", names: ["black pearl", "bloodmoss"], errors: {} });
  assert.equal(checkDraft("", "").errors.name, "Give the rule a name, up to 64 characters.");
  assert.equal(checkDraft("x".repeat(65), "").errors.name, "Give the rule a name, up to 64 characters.");
  assert.equal(checkDraft("R", Array.from({ length: 101 }, (_, i) => `n${i}`).join("\n")).errors.names, "At most 100 names; this list has 101.");
  assert.equal(checkDraft("R", "y".repeat(70)).errors.names, "Each name can be up to 64 characters; line 1 has 70.");
});

test("[fast] a rule's one-line summary: its names first, then the Inventory's filter words", () => {
  const match = { query: { ...blankQuery(), kind: ["reagent"] }, names: ["black pearl", "bloodmoss", "garlic", "ginseng"] };
  assert.equal(matchSummary(match, CTX), "Name: black pearl, bloodmoss, garlic +1 more · Kind: reagent");
  assert.equal(matchSummary({ query: blankQuery() }, CTX), "Every item (no filter yet)");
});

test("[fast] extraFilters lists the filters the editor has no control for, and removes one at a time", () => {
  const query = { ...blankQuery(), q: "x", kind: ["gear"], slot: ["ring"], rarityMin: "Lesser Artifact", props: [{ key: "lmc", min: 8 }] };
  const extra = extraFilters(query, CTX);
  assert.deepEqual(extra.map((t) => t.label), ["Slot: Ring", "LMC ≥ 8"]);
  const noSlot = extra[0]!.remove(query);
  assert.deepEqual([noSlot.slot, noSlot.kind, noSlot.q, noSlot.props.length], [[], ["gear"], "x", 1]);
  assert.deepEqual(Object.keys(noSlot).sort(), Object.keys(query).sort(), "still exactly a rule query");
});

test("[fast] a target reads by its label with its fill, and a forgotten target keeps its label's name and reads as not in any scan", () => {
  const a = targetView(A, CFG, CONTAINERS);
  assert.deepEqual(a, { serial: A, name: "Reagents", color: "#2f7f7f", pinned: false, fill: { items: 61, max: 125 }, gone: false });
  assert.equal(fillText(a), "61/125");
  assert.equal(fillTone(a.fill!), undefined);
  assert.equal(fillTone(targetView(C, CFG, CONTAINERS).fill!), "warn", "118 of 125 is nearly full");
  assert.equal(fillText(targetView(B, CFG, CONTAINERS)), "fill unknown");
  const withGone: OrganizeConfig = { ...CFG, labels: { ...CFG.labels, [GONE]: { serial: GONE, name: "Old chest", origin: "manual" } }, rules: [rule("rule-1", "Reagents", [GONE, A])] };
  const gone = targetView(GONE, withGone, CONTAINERS);
  assert.deepEqual([gone.name, gone.gone, gone.fill, fillText(gone)], ["Old chest", true, null, "not in any scan"]);
  assert.equal(targetView(0x40000077, CFG, CONTAINERS).name, "0x40000077", "neither labelled nor scanned: its serial");
});

test("[fast] targetOptions offers labelled, unpinned containers not already chosen, by name; the catch-all's list has no unlabelled bags", () => {
  assert.deepEqual(targetOptions(CFG, CONTAINERS, [A]), [{ value: String(C), label: "Gems · 118/125", depth: 1 }]);
  assert.deepEqual(targetOptions(CFG, CONTAINERS).map((o) => o.value), [String(A), String(C)]);
  assert.deepEqual(targetOptions(CFG, CONTAINERS, [], { bags: false }).map((o) => [o.value, o.depth]), [[String(C), 0], [String(A), 0]]);
});

test("[fast] targetOptions lists the scanned bags inside each labelled chest under it, and never a blacklisted, unopened or pinned one", () => {
  const D = 0x40000004, E = 0x40000005, F = 0x40000006, G = 0x40000007, H = 0x40000008;
  const bag = (serial: number, parent: number, root: number, name: string, over: Partial<Container> = {}): Container => chest(serial, { parent, root, name, tooltip: [name], label: name, capacity: { items: 3, maxItems: 125, stones: null, maxStones: null }, ...over });
  const all: Record<string, Container> = {
    ...CONTAINERS,
    [D]: bag(D, A, A, "A Pouch"),
    [E]: bag(E, A, A, "A Locked Box", { opened: false }),
    [F]: bag(F, D, A, "A Small Bag", { capacity: null }),
    [G]: bag(G, B, B, "A Bag In The Display"),
    [H]: bag(H, A, A, "A Blacklisted Bag"),
  };
  const opts = targetOptions(CFG, all, [], { blacklist: [H] });
  assert.deepEqual(opts, [
    { value: String(A), label: "Reagents · 61/125", depth: 0 },
    { value: String(D), label: "A Pouch · 3/125", depth: 1 },
    { value: String(F), label: "A Small Bag · fill unknown", depth: 2 },
    { value: String(C), label: "Gems · 118/125", depth: 1 },
  ]);
  const bagUnderBlacklisted = targetOptions(CFG, all, [], { blacklist: [D] });
  assert.deepEqual(bagUnderBlacklisted.map((o) => o.value), [String(A), String(H), String(C)], "nothing under a blacklisted bag either");
});

test("[fast] saving a rule labels each unlabelled bag it picked, by the bag's own name", () => {
  const D = 0x40000004;
  const all: Record<string, Container> = { ...CONTAINERS, [D]: chest(D, { parent: A, root: A, name: "A Pouch", tooltip: ["A Pouch", "Engraved: Rings"], label: "A Pouch" }) };
  const next = withTargetLabels(CFG, [C, D, A], all);
  assert.deepEqual(next.labels[String(D)], { serial: D, name: "Rings", origin: "manual" }, "the engraving, as bagLabel reads it");
  assert.equal(next.labels[String(C)], CFG.labels[String(C)], "an existing label is kept");
  assert.equal(withTargetLabels(CFG, [A, C], all), CFG, "nothing new: the same setup");
  assert.equal(CFG.labels[String(D)], undefined, "the input is untouched");
});

test("[fast] the live match line says how many items the filter takes, with examples, and that higher rules may claim some", () => {
  assert.deepEqual(matchLine({ count: 3, pieces: 43, sample: ["Black Pearl", "Garlic", "Sulfurous Ash"] }, 2), { text: "Matches 3 items (e.g. Black Pearl, Garlic, Sulfurous Ash)", note: "Rules above this one may claim some of them first." });
  assert.deepEqual(matchLine({ count: 1, pieces: 1, sample: ["Ruby"] }, 0), { text: "Matches 1 item (e.g. Ruby)", note: null });
  assert.deepEqual(matchLine({ count: 0, pieces: 0, sample: [] }, 3), { text: "Matches no item in your labelled containers.", note: null });
  assert.equal(matchLine(null, 1), null);
});

test("[fast] debounced runs only the last call, once the typing has paused", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const got: string[] = [];
    const run = debounced((s: string) => { got.push(s); }, MATCH_DEBOUNCE_MS);
    assert.equal(MATCH_DEBOUNCE_MS, 300);
    run("b"); mock.timers.tick(200); run("bl"); mock.timers.tick(299);
    assert.deepEqual(got, []);
    mock.timers.tick(1);
    assert.deepEqual(got, ["bl"]);
    run("bla"); mock.timers.tick(300);
    assert.deepEqual(got, ["bl", "bla"]);
  } finally {
    mock.timers.reset();
  }
});

test("[fast] organizeStage says what the player must do first", () => {
  const empty: OrganizeConfig = { version: 1, labels: {}, rules: [], catchAll: null, pinnedItems: [] };
  assert.equal(organizeStage(null, 2), "no-labels");
  assert.equal(organizeStage(empty, 0), "no-scans");
  assert.equal(organizeStage(empty, 2), "no-labels");
  assert.equal(organizeStage({ ...CFG, rules: [], catchAll: null }, 2), "no-rules");
  assert.equal(organizeStage({ ...CFG, rules: [] }, 2), "ready", "a catch-all alone is enough to plan");
  assert.equal(organizeStage(CFG, 2), "ready");
});

test("[fast] labelledPlaces maps each location text inside a labelled container to the same path by label", () => {
  const P = 0x40000010, Q = 0x40000011, U = 0x40000012;
  const all: Record<string, Container> = {
    ...CONTAINERS,
    [P]: chest(P, { kind: "backpack", name: "Backpack", label: "Backpack", capacity: null }),
    [Q]: chest(Q, { parent: P, root: P, kind: null, name: "A Pouch", label: "A Pouch", capacity: null }),
    [U]: chest(U, { name: "Wooden Box", label: "Wooden Box" }),
  };
  const places = labelledPlaces(all, { ...CFG.labels, [Q]: { serial: Q, name: "Reagent pouch", origin: "manual" } });
  assert.equal(places.get("Metal Chest (0x40000001)"), "Reagents");
  assert.equal(places.get("Metal Chest (0x40000001) › A Bag"), "Reagents › Gems");
  assert.equal(places.get("Metal Chest (0x40000002)"), "Display");
  assert.equal(places.get("Tester's backpack › A Pouch"), "Tester's backpack › Reagent pouch");
  assert.equal(places.has("Wooden Box"), false, "an unlabelled container reads as scanned");
  assert.equal(labelledPlaces(all, {}).size, 0);
});

test("[fast] the catch-all's plan id matches the planner's", () => {
  assert.equal(CATCH_ALL_ID, "catch-all");
});
