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
import type { BridgeResultEntry, OrganizeConfig, OrganizePlan, OrganizeRule, PlanMove } from "./ui/api-types.mts";
import { CATCH_ALL_ID, moveRule, withLabel, withoutLabel, pinnedWith, upsertRule, withoutRule, newRuleId, ruleQueryFrom, blankQuery, droppedNote, ruleNameFrom, checkDraft, matchSummary, extraFilters, targetView, fillText, fillTone, targetOptions, withTargetLabels, matchLine, debounced, MATCH_DEBOUNCE_MS, organizeStage, labelledPlaces, ruleNameOf, containerNameOf, ruleCountParts, planHeadline, unclaimedNote, roomLines, crossSiteLines, warningGroups, tripRows, moveName, moveWhere, carriedView, tripGate, stepWatch, outcomeOf, outcomeText, failedSteps, runAllNext, tripRefusal, PICKUP_MS, TRIP_MS } from "./ui/organize-model.mts";

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

const move = (serial: number, name: string, from: number | null, to: number, ruleId: string, trip: number, amount = 1): PlanMove => ({ serial, name, amount, from, to, ruleId, alsoMatched: [], trip });
const PLAN: OrganizePlan = {
  inventoryStamp: "2026-09-28T10:00:00Z", stamp: "abcd1234", sites: [{ index: 0, roots: [A, B] }],
  moves: [move(11, "Black Pearl", B, A, "rule-1", 1, 40), move(12, "Ruby", null, C, "rule-2", 1), move(13, "Garlic", B, A, "rule-1", 2)],
  trips: [{ index: 1, site: 0, takes: [11], puts: [12, 11] }, { index: 2, site: 0, takes: [13], puts: [13] }],
  rules: [{ ruleId: "rule-1", matched: 50, inPlace: 40, toMove: 2, noRoom: 8 }, { ruleId: "rule-2", matched: 1, inPlace: 0, toMove: 1, noRoom: 0 }],
  room: [{ ruleId: "rule-1", needSlots: 10, freeSlots: 2, shortfall: 8 }, { ruleId: "rule-2", needSlots: 1, freeSlots: 7, shortfall: 0 }],
  crossSite: [{ ruleId: "rule-2", count: 1 }, { ruleId: CATCH_ALL_ID, count: 12 }],
  warnings: [{ kind: "stale-container", serial: B, detail: "last scanned 9 days ago" }, { kind: "unknown-capacity", serial: B, detail: "its tooltip has no Contents line" }, { kind: "unknown-capacity", serial: GONE, detail: "not in any scan" }],
  carried: [{ serial: 12, name: "Ruby" }], unclaimed: 3,
};
const nameOf = containerNameOf(CFG, CONTAINERS), ruleName = ruleNameOf(CFG);

test("[fast] the plan's headline, counts and unclaimed note", () => {
  assert.equal(planHeadline(PLAN), "3 items to move in 2 trips");
  assert.equal(planHeadline({ ...PLAN, moves: [], trips: [] }), "Everything is where it belongs.");
  assert.equal(unclaimedNote(PLAN), "3 items no rule takes stay where they are.");
  assert.equal(unclaimedNote({ ...PLAN, unclaimed: 1 }), "1 item no rule takes stays where it is.");
  assert.equal(unclaimedNote({ ...PLAN, unclaimed: 0 }), null);
  assert.deepEqual(ruleCountParts(PLAN.rules[0]!), [{ text: "2 to move", warn: false }, { text: "40 in place", warn: false }, { text: "8 no room", warn: true }]);
  assert.deepEqual(ruleCountParts(PLAN.rules[1]!).map((p) => p.text), ["1 to move", "0 in place"]);
  assert.equal(ruleName(CATCH_ALL_ID), "Everything else");
  assert.equal(ruleName("rule-9"), "rule-9");
});

test("[fast] the room and cross-site reports name the rule and say what to do", () => {
  assert.deepEqual(roomLines(PLAN, ruleName), ["Reagents: 8 items have no room (10 slots needed, 2 free). Add a container to its targets, or make room."]);
  assert.deepEqual(crossSiteLines(PLAN, ruleName), [
    "Gems: 1 item belongs in a container at another house. Carry it over by hand.",
    "Everything else: 12 items belong in a container at another house. Carry them over by hand.",
  ]);
});

test("[fast] warnings are grouped by kind with each container named by its label", () => {
  assert.deepEqual(warningGroups(PLAN.warnings, nameOf), [
    { kind: "stale-container", title: "Not scanned for over a week", text: "Display: last scanned 9 days ago" },
    { kind: "unknown-capacity", title: "Fill unknown: reinstall the scripts and rescan (2)", text: "Display: its tooltip has no Contents line · 0x40000009: not in any scan" },
  ]);
  assert.equal(warningGroups([{ kind: "stale-container", serial: A, detail: "last scanned 2026-01-01T12:00:00-07:00" }], nameOf)[0]!.text, "Reagents: last scanned 2026-01-01", "the planner's timestamps read as dates");
});

test("[fast] tripRows sums each trip in one line and keeps its moves for the table", () => {
  const rows = tripRows(PLAN, nameOf);
  assert.deepEqual(rows.map((r) => [r.index, r.text, r.moves.map((m) => m.serial)]), [[1, "Trip 1 · 2 items · into Reagents, Gems", [11, 12]], [2, "Trip 2 · 1 item · into Reagents", [13]]]);
  const two = tripRows({ ...PLAN, sites: [{ index: 0, roots: [A] }, { index: 1, roots: [B] }] }, nameOf);
  assert.equal(two[0]!.text, "Trip 1 · 2 items · site 1 · into Reagents, Gems");
  assert.equal(moveName(PLAN.moves[0]!), "40 Black Pearl");
  assert.equal(moveWhere(PLAN.moves[0]!, nameOf), "Display → Reagents");
  assert.equal(moveWhere(PLAN.moves[1]!, nameOf), "your backpack → Gems");
});

test("[fast] tripRows groups a 1,000-move plan into one row per trip without losing a move", () => {
  const moves = Array.from({ length: 1000 }, (_, i) => move(0x41000000 + i, "Black Pearl", B, A, "rule-1", Math.floor(i / 20) + 1));
  const trips = Array.from({ length: 50 }, (_, i) => ({ index: i + 1, site: 0, takes: [], puts: [] }));
  const rows = tripRows({ ...PLAN, moves, trips }, nameOf);
  assert.equal(rows.length, 50);
  assert.ok(rows.every((r, i) => r.index === i + 1 && r.moves.length === 20 && r.text === `Trip ${i + 1} · 20 items · into Reagents`));
  assert.equal(rows.reduce((n, r) => n + r.moves.length, 0), 1000);
});

test("[fast] carriedView names what a stopped trip left in the backpack and which trip puts it away", () => {
  assert.deepEqual(carriedView(PLAN, 3), { text: "1 item from trip 3 is in your backpack.", names: "Ruby", putAway: 1, reason: null });
  assert.equal(carriedView(PLAN, null)!.text, "1 item from an earlier trip is in your backpack.");
  const stuck = carriedView({ ...PLAN, moves: PLAN.moves.filter((m) => m.from != null), carried: Array.from({ length: 7 }, (_, i) => ({ serial: i, name: `Gem ${i}` })) }, 2)!;
  assert.deepEqual(stuck, { text: "7 items from trip 2 are in your backpack.", names: "Gem 0, Gem 1, Gem 2, Gem 3, Gem 4 and 2 more", putAway: null, reason: "None of them has a place with room at this house. Put them away by hand." });
  assert.equal(carriedView({ ...PLAN, carried: [] }, 1), null);
});

test("[fast] tripGate says why no trip can run, most basic reason first", () => {
  const OFF = "Bridge offline. Press Play on packrat-bridge.py in game.";
  const ok = { client: "TazUO", canTrip: true, online: true, running: false };
  assert.equal(tripGate(ok, OFF), null);
  assert.equal(tripGate({ ...ok, client: null }, OFF), "No game client is set up. Choose one in Settings.");
  assert.equal(tripGate({ ...ok, client: "ClassicUO Web", canTrip: false }, OFF), "ClassicUO Web can't carry out Organize trips. Move the items by hand, then rescan.");
  assert.equal(tripGate({ ...ok, running: true, online: false }, OFF), "A trip is running. Wait for it to report back, or stop it.");
  assert.equal(tripGate({ ...ok, online: false }, OFF), OFF);
});

test("[fast] stepWatch gives up on a trip nobody picked up after 75 s, and on any trip after 15 minutes", () => {
  const w = { id: "t-1", index: 2, queuedAt: 0, picked: false };
  assert.deepEqual(stepWatch(w, { currentId: null, result: null }, 10_000), { kind: "wait", watch: w });
  const picked = stepWatch(w, { currentId: "t-1", result: null }, 20_000);
  assert.deepEqual(picked, { kind: "wait", watch: { ...w, picked: true } });
  const lost = stepWatch(w, { currentId: null, result: null }, PICKUP_MS + 1);
  assert.equal(lost.kind, "lost");
  assert.match((lost as { message: string }).message, /^The bridge did not pick up trip 2\. Nothing was moved\./);
  assert.equal(stepWatch({ ...w, picked: true }, { currentId: null, result: null }, PICKUP_MS + 1).kind, "wait", "a trip the bridge started may take minutes");
  const late = stepWatch({ ...w, picked: true }, { currentId: "t-1", result: null }, TRIP_MS + 1);
  assert.deepEqual(late, { kind: "lost", message: "Trip 2 has not reported back after 15 minutes. Check the game, then press Reload plan." });
  const result: BridgeResultEntry = { ok: true, msg: "trip 2: 3 put away", steps: [{ op: "take", serial: 1, ok: true, msg: "" }] };
  assert.deepEqual(stepWatch(w, { currentId: null, result }, 99 * 60_000), { kind: "reported", outcome: "done", result });
});

test("[fast] a trip's outcome: stopped, partial and failed each stop Run all with their own sentence", () => {
  const step = (ok: boolean) => ({ op: "put" as const, serial: 5, ok, msg: ok ? "put away" : "bounced (full, or refused)" });
  assert.equal(outcomeOf({ ok: true, msg: "", steps: [step(true)] }), "done");
  assert.equal(outcomeOf({ ok: true, msg: "", stopped: true, steps: [step(true)] }), "stopped");
  assert.equal(outcomeOf({ ok: true, msg: "", partial: true }), "partial");
  assert.equal(outcomeOf({ ok: true, msg: "", steps: [step(true), step(false)] }), "failed");
  assert.equal(outcomeOf({ ok: false, msg: "expired: queued 73s ago, not run" }), "failed");
  assert.equal(outcomeText("done", 1, { ok: true, msg: "" }), null);
  assert.equal(outcomeText("stopped", 1, { ok: true, msg: "" }), "Trip 1 was stopped. Anything it took and had not put away is listed above.");
  assert.equal(outcomeText("partial", 2, { ok: true, msg: "" }), "Trip 2 ended early: the backpack could not carry more, so it only put away what it took. The plan was worked out again.");
  assert.equal(outcomeText("failed", 3, { ok: true, msg: "", steps: [step(false), step(false)] }), "Trip 3: 2 steps failed.");
  assert.equal(outcomeText("failed", 3, { ok: false, msg: "expired: queued 73s ago, not run" }), "Trip 3 failed: expired: queued 73s ago, not run");
});

test("[fast] failedSteps names each failed item once, from the trip's own moves", () => {
  const r: BridgeResultEntry = { ok: true, msg: "", steps: [{ op: "take", serial: 11, ok: false, msg: "not there" }, { op: "put", serial: 11, ok: false, msg: "not carried" }, { op: "put", serial: 99, ok: false, msg: "bounced (full, or refused)" }, { op: "put", serial: 12, ok: true, msg: "" }] };
  assert.deepEqual(failedSteps(r, new Map([[11, "Black Pearl"]])), [{ serial: 11, name: "Black Pearl", msg: "not there" }, { serial: 99, name: "0x63", msg: "bounced (full, or refused)" }]);
  assert.deepEqual(failedSteps({ ok: true, msg: "" }, new Map()), []);
});

test("[fast] runAllNext runs the new plan's first trip, and stops when a reported trip did not shorten the plan", () => {
  assert.deepEqual(runAllNext(4, PLAN), { index: 1 });
  assert.deepEqual(runAllNext(3, PLAN), { stop: "The plan did not get shorter after the last trip, so Run all stopped. Check the trip's results, then press Reload plan." });
  assert.deepEqual(runAllNext(3, { ...PLAN, moves: [], trips: [] }), { stop: null });
});

test("[fast] a refused trip reads as what to do next, and a hand-edited setup asks to be saved first", () => {
  assert.equal(tripRefusal("the plan has changed since it was shown; reload it"), "The plan changed since it was shown: a scan arrived, a rule changed or a trip reported back. Here is the new plan; check it and press Run again.");
  assert.equal(tripRefusal("organize.json was hand-edited and parts of it were dropped (rules[0] x); open Organize and save the setup first"), "Part of organize.json could not be read and was left out, so no trip runs until you have checked the setup and pressed Save setup (above).");
  assert.equal(tripRefusal("trip 1 has not reported back yet"), "trip 1 has not reported back yet");
});
