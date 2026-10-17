// ui-move.test.mts — `app/ui/move-model.mts`, Move to's pure rules (issue #270).
//
// `app/ui/move-model.mts`, Move to's pure rules: the selection (a ticked row, a shift-click range that leaves worn rows out and names them, unticking a range, the header ticking the rows loaded and clearing everything, then every item matching the filter with its exceptions and the ticks outside it kept, all of it surviving a change of the rows shown, worn rows never selected), what the server is sent, Grab's limit, the containers the picker offers (on the ground with a known fill, never blacklisted or trash, grouped by house), the room line and the picked container's sentence, and the result line's words (moved, stopped, didn't fit, the Organize rule note, Move back's skipped items). All `[fast]`.
//
// The rendered screen is driven by scripts/ui-move.test.mts.
import test from "node:test";
import assert from "node:assert/strict";
import { parseItemQuery, type ItemQuery } from "./item-query.mts";
import type { Container, Item } from "./vault-lib.mts";
import { emptySelection, isSelected, selectedCount, toggleRows, toggleLoaded, loadedState, selectAllMatching, selectionBody, grabItems, destGroups, roomText, pickedText, leftText, movedText, againstText, skippedText, noRoomText, wornNote, GRAB_MAX, OUTSIDE, type Matches } from "./ui/move-model.mts";

const item = (serial: number, name: string, worn = false): Item => ({ serial, name, ...(worn ? { equippedBy: "Tester" } : {}) }) as unknown as Item;
const ROWS = [item(1, "Gold Ring"), item(2, "Silver Ring", true), item(3, "Jade Ring"), item(4, "Ruby Ring"), item(5, "Onyx Ring")];
const none: Matches = () => false;
const RINGS: ItemQuery = { ...parseItemQuery(new URLSearchParams("q=ring")) };

test("[fast] a ticked row is selected; shift-click ticks every loaded row from the anchor and leaves worn rows out by name", () => {
  let { sel, worn } = toggleRows(emptySelection(), ROWS, 0, true, false, none);
  assert.deepEqual([selectedCount(sel), worn], [1, []]);
  ({ sel, worn } = toggleRows(sel, ROWS, 3, true, true, none));
  assert.deepEqual([[...sel.items.keys()], worn], [[1, 3, 4], ["Silver Ring"]]);
  assert.equal(isSelected(sel, ROWS[1]!, none), false, "a worn row is never selected");
  assert.equal(wornNote(worn), "Left out Silver Ring: it's worn. Take it off in game to move it.");
  assert.equal(wornNote(["a", "b"]), "Left out 2 worn items. Take them off in game to move them.");
  ({ sel, worn } = toggleRows(sel, ROWS, 2, false, true, none));
  assert.deepEqual([[...sel.items.keys()], worn], [[1], []], "a shift-click unticking unticks the range from the last anchor");
  assert.equal(toggleRows(sel, ROWS, 4, true, false, none).sel.anchor, 4);
});

test("[fast] the header ticks every row loaded so far (naming the worn ones), shows some or all, and unticking it unticks only them", () => {
  const sparse = [ROWS[0], undefined, ROWS[1], ROWS[2]];
  const { sel, worn } = toggleLoaded(emptySelection(), sparse, true, none);
  assert.deepEqual([[...sel.items.keys()], worn], [[1, 3], ["Silver Ring"]]);
  assert.equal(loadedState(sel, sparse, none), "all");
  assert.equal(loadedState(toggleRows(sel, sparse, 0, false, false, none).sel, sparse, none), "some");
  assert.equal(loadedState(emptySelection(), sparse, none), "none");
  assert.equal(selectedCount(toggleLoaded(sel, sparse, false, none).sel), 0);
  // Unticking the header unticks the loaded rows only: a row ticked under another filter stays.
  const elsewhere = toggleRows(sel, [item(50, "Black Pearl")], 0, true, false, none).sel;
  assert.deepEqual([...toggleLoaded(elsewhere, sparse, false, none).sel.items.keys()], [50]);
});

test("[fast] all matching counts every match but the unticked ones, keeps ticks outside the filter, and survives the rows changing", () => {
  const isRing: Matches = (it) => /ring/i.test(it.name);
  const pearl = item(9, "Black Pearl");
  let sel = toggleRows(emptySelection(), [pearl, ...ROWS], 0, true, false, none).sel;
  sel = toggleRows(sel, [pearl, ...ROWS], 1, true, false, none).sel;
  sel = selectAllMatching(sel, RINGS, 300, 7, isRing);
  assert.deepEqual([selectedCount(sel), [...sel.items.keys()]], [301, [9]], "the ring ticked by hand folds into the filter; the pearl stays");
  sel = toggleRows(sel, ROWS, 2, false, false, isRing).sel;
  assert.equal(selectedCount(sel), 300);
  assert.equal(isSelected(sel, ROWS[2]!, isRing), false);
  // Another filter shows other rows: an unseen ring still counts as selected, a worn one never does.
  assert.equal(isSelected(sel, item(77, "Star Ring"), isRing), true);
  assert.equal(isSelected(sel, item(78, "Worn Ring", true), isRing), false);
  const body = selectionBody(sel);
  assert.deepEqual([body.serials, new URLSearchParams(body.query).get("q"), body.except], [[9], "ring", [3]]);
  assert.equal(grabItems(sel), null, "Grab takes ticked rows only");
});

test("[fast] the server is sent the ticked serials alone when nothing matches a filter, and Grab takes up to a Grab all's worth", () => {
  const sel = toggleLoaded(emptySelection(), ROWS, true, none).sel;
  assert.deepEqual(selectionBody(sel), { serials: [1, 3, 4, 5] });
  assert.deepEqual(grabItems(sel)!.map((it) => it.serial), [1, 3, 4, 5]);
  const many = Array.from({ length: GRAB_MAX + 1 }, (_, i) => item(100 + i, `Gem ${i}`));
  assert.equal(grabItems(toggleLoaded(emptySelection(), many, true, none).sel), null);
});

test("[fast] the picker offers containers on the ground with a known fill, by house, never blacklisted, trash or unopened", () => {
  const cap = (items: number) => ({ items, maxItems: 125, stones: null, maxStones: null });
  const box = (serial: number, name: string, over: Partial<Container> = {}): Container => ({ serial, name, label: name, kind: "ground", parent: null, root: serial, pos: { x: 1, y: 1, z: 0 }, capacity: cap(10), scannedBy: "T", scannedAt: "", ...over });
  const containers: Record<string, Container> = {
    1: box(1, "Jewelry Box"), 2: box(2, "Armor Box"), 3: box(3, "Spare Bag", { kind: "container", parent: 2, root: 2, pos: null }),
    4: box(4, "Gem Chest", { capacity: null }), 5: box(5, "Trash Barrel"), 6: box(6, "Backpack", { kind: "backpack", pos: null }), 7: box(7, "Locked Box"),
    8: box(8, "Old Bag", { kind: "container", parent: 1, root: 1, pos: null, opened: false }), 9: box(9, "Yard Chest"),
  };
  const groups = destGroups(containers, (root) => (root === 9 ? null : "Stone Keep"), (c) => c.name!, [7]);
  assert.deepEqual(groups.map((g) => [g.title, g.rows.map((r) => [r.name, r.sub])]), [
    ["Stone Keep", [["Armor Box", "Stone Keep"], ["Spare Bag", "in Armor Box"], ["Jewelry Box", "Stone Keep"]]],
    [OUTSIDE, [["Yard Chest", ""]]],
  ]);
});

test("[fast] a container's room line and the picked container's sentence say what fits", () => {
  assert.deepEqual(roomText({ items: 125, max: 125 }, 3, 0), { text: "Full", short: true });
  assert.deepEqual(roomText({ items: 121, max: 125 }, 9, 0), { text: "Room for 4", short: true });
  assert.deepEqual(roomText({ items: 40, max: 125 }, 9, 4), { text: "4 already here", short: false });
  assert.deepEqual(roomText({ items: 40, max: 125 }, 9, 0), { text: "Room for all", short: false });
  const plan = { moving: 4, serials: [], trips: 1, already: 0, noRoom: 5, left: {}, against: [] };
  assert.deepEqual(pickedText("Gem Chest", plan, { items: 121, max: 125 }), { text: "Gem Chest has room for 4 of 9. The other 5 stay where they are.", short: true, button: "Move the 4 that fit" });
  assert.deepEqual(pickedText("Gem Chest", { ...plan, noRoom: 0, already: 1 }, { items: 40, max: 125 }), { text: "Gem Chest will hold 44/125 items after this. 1 item already there is skipped.", short: false, button: "Move 4 items" });
  assert.equal(pickedText("Gem Chest", { ...plan, moving: 0, noRoom: 2 }, { items: 125, max: 125 }).button, null);
  assert.equal(leftText({ pack: 2, site: 1 }, 1), "Staying where they are: 1 worn, 2 in a backpack, a bank box or carried (Move to takes only from containers on the ground), 1 in another house.");
  assert.equal(leftText({}, 0), null);
});

test("[fast] the result line says what moved, what didn't fit, what Organize would undo, and what Move back skipped or had no room for", () => {
  assert.equal(movedText(6, "Suit Chest · Marble Workshop", false, { noRoom: 3 }), "Moved 6 items to Suit Chest · Marble Workshop. 3 didn't fit and stayed put.");
  assert.equal(movedText(2, "Gem Chest", false, { stopped: true }), "Stopped. 2 items moved to Gem Chest; the rest stay where they are.");
  assert.equal(movedText(3, "Gem Chest", true, { noRoom: 2 }), "Moved 3 items back to where each one came from. 2 didn't fit back and stayed put.");
  assert.equal(noRoomText(["Ruby", "Pearl"]), "No room left for Ruby, Pearl where they came from.");
  assert.equal(movedText(1, "Gem Chest", true, { failed: 1 }), "Moved 1 item back to where it came from. 1 item could not be moved.");
  const name = (s: number) => (s === 1 ? "Jewelry Box" : "Gem Chest");
  assert.equal(againstText([{ target: 1 }, { target: 1 }], name), "2 of these go back on the next Organize run, because a rule files them in Jewelry Box.");
  assert.equal(againstText([{ target: 1 }], name), "1 of these goes back on the next Organize run, because a rule files it in Jewelry Box.");
  assert.equal(againstText([{ target: 1 }, { target: 2 }], name), "2 of these go back on the next Organize run, because rules file them in other containers.");
  assert.equal(againstText([], name), null);
  assert.equal(skippedText(["Ruby"]), "Skipped Ruby: moved since, or a scan has caught up and Pack Rat no longer knows where it came from.");
  assert.match(skippedText(["a", "b", "c", "d", "e"])!, /^Skipped a, b, c and 2 more:/);
});
