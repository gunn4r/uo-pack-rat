// profile-edits.test.mts — `app/profile-edits.mts`: each ProfileEdit made on a profiles file (buffs, a label, a character's settings kept around what the panel doesn't edit, a deleted character, a template put, updated, deleted and renamed with its characters following), each made again changing nothing more, the ones that can't be made refused with why (a template gone, a name taken, a label for no such character), a list stopping at the first refusal, and the shape check. All `[fast]`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { characterEntry, characterProfile, specFromProfile, templateSpecFrom, type ProfilesV3, type TemplateMap } from "./build-spec.mts";
import { applyProfileEdit, applyProfileEdits, profileEditError, type ProfileEdit, type ProfileEditContext } from "./profile-edits.mts";

const builtins: TemplateMap = { melee: { name: "Melee", spec: templateSpecFrom({ floors: { physResist: 65 } }) } };
const ctx: ProfileEditContext = { builtins };
function doc(): ProfilesV3 {
  return {
    schemaVersion: 3,
    characters: { Dorran: { template: "Mine", label: "Main", note: "a field a newer build added", spec: { ...specFromProfile({ floors: { luck: 100 } }, { on: ["bless"], skills: { Chivalry: 90 } }), search: { restarts: 3 } } } },
    templates: { Mine: { description: "my own", spec: templateSpecFrom({ floors: { luck: 100 } }) } },
  } as ProfilesV3;
}
// Made once, then again: the second changes nothing more.
function twice(d: ProfilesV3, e: ProfileEdit, c = ctx): void {
  assert.equal(applyProfileEdit(d, e, c), null, `${e.op} made`);
  const once = structuredClone(d);
  assert.equal(applyProfileEdit(d, e, c), null, `${e.op} made again`);
  assert.deepEqual(d, once, `${e.op} again changes nothing more`);
}

test("[fast] setBuffs: merged into the saved buffs, or a new entry from the Suit Builder's defaults", () => {
  const d = doc();
  twice(d, { op: "setBuffs", name: "Dorran", buffs: { on: ["divineFury"] } });
  assert.deepEqual(d.characters.Dorran!.spec.buffs, { on: ["divineFury"], skills: { Chivalry: 90 } }, "the numbers kept");
  twice(d, { op: "setBuffs", name: "Kestrel", buffs: { on: ["bless"] } });
  assert.deepEqual(d.characters.Kestrel, characterEntry(characterProfile(doc(), "Kestrel", builtins), { on: ["bless"], skills: {} }));
});

test("[fast] setLabel: trimmed, blank removes, a new entry for a character with none, refused where canLabel says no", () => {
  const d = doc();
  twice(d, { op: "setLabel", name: "Dorran", label: "  Sampire " });
  assert.equal(d.characters.Dorran!.label, "Sampire");
  twice(d, { op: "setLabel", name: "Dorran", label: "" });
  assert.equal("label" in d.characters.Dorran!, false);
  assert.equal(applyProfileEdit(d, { op: "setLabel", name: "Kestrel", label: " " }, ctx), null);
  assert.equal(d.characters.Kestrel, undefined, "a blank label on no entry writes nothing");
  twice(d, { op: "setLabel", name: "Kestrel", label: "Archer" });
  assert.deepEqual(d.characters.Kestrel, { ...characterEntry(characterProfile(doc(), "Kestrel", builtins), { on: [], skills: {} }), label: "Archer" });
  const strict = { builtins, canLabel: (n: string) => n === "Dorran" };
  assert.equal(applyProfileEdit(d, { op: "setLabel", name: "_nobody", label: "x" }, strict), "no character named _nobody");
});

test("[fast] saveCharacter: the panel's race, template and spec over the entry, its buffs, label, other fields, goal and search kept", () => {
  const d = doc(), panel = characterEntry({ floors: { luck: 200 }, race: "elf", template: "builtin:melee" }, { on: [], skills: {} });
  twice(d, { op: "saveCharacter", name: "Dorran", entry: { ...panel, label: "from the page" } });
  const e = d.characters.Dorran!;
  assert.deepEqual([e.race, e.template, e.label, e.note], ["elf", "builtin:melee", "Main", "a field a newer build added"]);
  assert.deepEqual(e.spec.intent.floors, { luck: 200 });
  assert.deepEqual(e.spec.buffs, { on: ["bless"], skills: { Chivalry: 90 } }, "the saved buffs, not the page's");
  assert.deepEqual(e.spec.search, { restarts: 3 });
  twice(d, { op: "saveCharacter", name: "Kestrel", entry: panel });
  assert.deepEqual(d.characters.Kestrel!.spec.buffs, { on: [], skills: {} });
});

test("[fast] templates: put, update (refused when gone), delete, rename with characters following (refused when gone or taken)", () => {
  const d = doc(), spec = templateSpecFrom({ floors: { dci: 45 } });
  twice(d, { op: "putTemplate", id: "Spare", entry: { spec } });
  twice(d, { op: "updateTemplate", id: "Mine", spec, savedAt: "2026-10-17T00:00:00.000Z" });
  assert.deepEqual(d.templates.Mine, { description: "my own", spec, savedAt: "2026-10-17T00:00:00.000Z" }, "its other fields kept");
  assert.match(applyProfileEdit(d, { op: "updateTemplate", id: "Gone", spec, savedAt: "x" }, ctx) ?? "", /Gone template was deleted elsewhere/);
  assert.equal(d.templates.Gone, undefined, "not made again");
  twice(d, { op: "renameTemplate", from: "Mine", to: "Main" });
  assert.deepEqual([Object.keys(d.templates).sort(), d.characters.Dorran!.template], [["Main", "Spare"], "Main"]);
  assert.match(applyProfileEdit(d, { op: "renameTemplate", from: "Main", to: "Spare" }, ctx) ?? "", /already a template named Spare/);
  assert.match(applyProfileEdit(d, { op: "renameTemplate", from: "Gone", to: "Other" }, ctx) ?? "", /Gone template was deleted elsewhere/);
  twice(d, { op: "deleteTemplate", id: "Spare" });
  twice(d, { op: "deleteCharacter", name: "Dorran" });
  assert.deepEqual([Object.keys(d.templates), Object.keys(d.characters)], [["Main"], []]);
});

test("[fast] applyProfileEdits stops at the first edit that can't be made and says why", () => {
  const d = doc();
  const why = applyProfileEdits(d, [{ op: "deleteTemplate", id: "Mine" }, { op: "updateTemplate", id: "Mine", spec: templateSpecFrom({}), savedAt: "x" }, { op: "deleteCharacter", name: "Dorran" }], ctx);
  assert.match(why ?? "", /Mine template was deleted elsewhere/);
  assert.ok(d.characters.Dorran, "the edit after it was not made");
});

test("[fast] profileEditError: each op's fields, an unknown op and a non-object", () => {
  for (const ok of [{ op: "setBuffs", name: "A", buffs: {} }, { op: "setLabel", name: "A", label: "x" }, { op: "saveCharacter", name: "A", entry: { spec: {} } }, { op: "deleteCharacter", name: "A" },
    { op: "putTemplate", id: "t", entry: { spec: {} } }, { op: "updateTemplate", id: "t", spec: {}, savedAt: "x" }, { op: "deleteTemplate", id: "t" }, { op: "renameTemplate", from: "a", to: "b" }]) assert.equal(profileEditError(ok), null, ok.op);
  for (const [bad, msg] of [[null, /must be an object/], [{ op: "nope" }, /unknown edit "nope"/], [{ op: "setBuffs", name: "", buffs: {} }, /name must be/], [{ op: "setBuffs", name: "A", buffs: [] }, /buffs must be an object/],
    [{ op: "setLabel", name: "A", label: "a\nb" }, /one line/], [{ op: "setLabel", name: "x".repeat(65), label: "" }, /name must be/], [{ op: "saveCharacter", name: "A", entry: {} }, /entry must be/],
    [{ op: "putTemplate", id: 7, entry: { spec: {} } }, /id must be/], [{ op: "updateTemplate", id: "t", spec: {} }, /savedAt/], [{ op: "renameTemplate", from: "a" }, /to must be/]] as const) {
    assert.match(profileEditError(bad) ?? "", msg, JSON.stringify(bad));
  }
});
