// doll-model.test.mts — `app/ui/doll-model.mts` (issue #57): what a doll card shows, as data.
//
// `app/ui/doll-model.mts` (issue #57): the GET /api/paperdoll.png address (the look, the worn pieces, a pair and the gray stand-in, with the `graphic:hue` lists left readable), the plan for a character (its own look in color; the gray stand-in with a note for no look when the client can read it and when it cannot, for a form's body, and for no character), the note for each reason there is no figure (client files not found, files not supported, files that do not read, nothing drawn, a figure that could not be drawn), each button naming the part of Settings it opens (the scanner row for a rescan, else the UO folder), and the card's requests (`dollRequests`: the newest wins, going back to the figure on screen while another loads asks again, a failed request is asked again). All `[fast]`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DOLL_REASONS, dollPlan, dollRequests, dollUrl, failureNote } from "./ui/doll-model.mts";
import { STAND_IN, type Look } from "./paperdoll-look.mts";

// The live scan's elf.
const ELF: Look = { body: 606, hue: 0x851d, hair: { graphic: 0x2fcc, hue: 519 }, beard: null, face: { graphic: 0x3b46, hue: 0x824d } };

test("[fast] doll model: the figure's address carries the look, the worn pieces, a pair and the gray", () => {
  assert.equal(dollUrl(ELF, [{ graphic: 0x1415, hue: 0 }, { graphic: 0x13bf, hue: 2587 }], null, false), "/api/paperdoll.png?body=606&hue=34077&hair=12236:519&face=15174:33357&worn=5141:0,5055:2587");
  assert.equal(dollUrl(STAND_IN, [], [{ graphic: 1, hue: 2 }], true), "/api/paperdoll.png?body=400&hue=0&worn=&pair=1:2&gray=1");
});

test("[fast] doll model: a character's own look in color; a stand-in, gray, with a note saying why", () => {
  assert.deepEqual(dollPlan({ name: "Elfie", appearance: ELF, readsLook: true, client: "TazUO" }), { look: ELF, gray: false, note: null });
  const old = dollPlan({ name: "Elfie", appearance: null, readsLook: true, client: "TazUO" });
  assert.deepEqual([old.look, old.gray, old.note?.title, old.note?.actions], [STAND_IN, true, "Rescan to show Elfie's look", [{ label: "How to rescan", to: "scanner" }]], "rescanning starts at the scanner row");
  const cannot = dollPlan({ name: "Elfie", appearance: undefined, readsLook: false, client: "Razor Enhanced" });
  assert.deepEqual([cannot.gray, cannot.note?.title, cannot.note?.actions], [true, "Razor Enhanced's scripts can't read your character's look, so the figure is a stand-in.", undefined]);
  const form = dollPlan({ name: "Punch", appearance: { ...ELF, body: 746 }, readsLook: true, client: "TazUO" });
  assert.deepEqual([form.look, form.gray, form.note?.title], [STAND_IN, true, "Punch was in another form when scanned."], "a form's hair and face are not used either");
  const nobody = dollPlan({ name: null, appearance: ELF, readsLook: true, client: "TazUO" });
  assert.deepEqual([nobody.look, nobody.gray, nobody.note?.title], [STAND_IN, true, "No character is chosen, so the suit is shown on a stand-in body."]);
});

test("[fast] doll model: every reason there is no figure has its own note, its buttons opening the UO folder in Settings", () => {
  for (const r of ["no-client", "no-tazuo-profile", "override-missing", "missing"] as const) {
    assert.deepEqual([failureNote(r).title, failureNote(r).actions?.map((a) => a.label)], ["Pack Rat couldn't find your Ultima Online client files", ["Choose UO folder", "Why?"]], r);
  }
  assert.deepEqual(["unsupported", "unreadable", "empty"].map((r) => failureNote(r as "empty").title), ["This client's files aren't supported yet", "Your client files couldn't be read", "Nothing could be drawn"]);
  for (const r of DOLL_REASONS) assert.ok(failureNote(r).actions?.every((a) => a.to === "uofolder"), r);
  for (const r of ["error", "no-body"] as const) assert.equal(failureNote(r).title, "The figure couldn't be drawn", r);
  for (const r of DOLL_REASONS) assert.equal(failureNote(r).tone, "warn");
});

test("[fast] doll model: the newest request wins, a request for what is on screen is not skipped while another is on its way, and a failed one asks again", () => {
  const q = dollRequests();
  const a = q.start("A")!;
  assert.equal(q.settle(a, true), true, "A painted");
  assert.equal(q.start("A"), null, "A again: nothing to do");
  const b = q.start("B")!, a2 = q.start("A");
  assert.ok(a2 !== null, "back to A while B is loading asks for A again");
  assert.deepEqual([q.settle(b, true), q.settle(a2!, true)], [false, true], "B's late answer is dropped");
  const c = q.start("C")!;
  assert.equal(q.settle(c, false), true);
  assert.notEqual(q.start("C"), null, "a failed key asks again");
});
