// customize-model.test.mts — `app/ui/customize-model.mts` (issue #57): the doll card's Customize popover as data.
//
// `app/ui/customize-model.mts` (issue #57) over the game's creation lists (`creationOptions` on a synthetic hues.mul): the live scan's elf turned into choices (its skin and hair in the elf palettes) and back unchanged, its skin with the 0x8000 bit; the stand-in starting from the default human skin; a race or gender change re-picking a hair style it does not offer as none, a skin outside the new race's palette as the palette's first, while any other change keeps a scanned value outside the lists (a dyed hair color, a style the lists lack), and dropping facial hair for a female or an elf; facial hair taking the hair's color unless set apart; the scan's face kept only while the race is the scan's; and the session's looks kept per character (and for no character) until Reset or a newer scan. Also `dollPlan` drawing a customized look in color while a stand-in keeps its note. All `[fast]`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readHues } from "./art.mts";
import { syntheticHues } from "./art-fixture.mts";
import { creationOptions } from "./paperdoll-creation.mts";
import { STAND_IN, type Look } from "./paperdoll-look.mts";
import { choiceOf, customLook, hasFacialHair, lookOfChoice, repick, sameLook, setCustomLook } from "./ui/customize-model.mts";
import { dollPlan } from "./ui/doll-model.mts";

const races = creationOptions(readHues(syntheticHues(Array.from({ length: 0x0910 }, () => new Uint16Array(32))))!, new Map()).races;
// The live scan's elf: female body 606, skin 0x851D, hair 0x2FCC hue 519, a face.
const ELF: Look = { body: 606, hue: 0x851d, hair: { graphic: 0x2fcc, hue: 519 }, beard: null, face: { graphic: 0x3b46, hue: 0x824d } };

test("[fast] customize: a scanned look becomes choices and comes back the same; the stand-in starts from the default human skin", () => {
  const c = choiceOf(ELF);
  assert.deepEqual([c.race, c.female, c.skin, c.hairStyle, c.hairHue], ["elf", true, 0x051d, 0x2fcc, 519], "the scan's skin and hair are in the elf palettes");
  assert.deepEqual(lookOfChoice(c, ELF), ELF);
  const stand = choiceOf(STAND_IN);
  assert.deepEqual([stand.race, stand.female, stand.skin, stand.hairStyle], ["human", false, 0x03ea, 0]);
});

test("[fast] customize: a race or gender change keeps only valid choices", () => {
  const elf = choiceOf(ELF);
  const human = repick(elf, { ...elf, race: "human" }, races);
  assert.deepEqual([human.hairStyle, human.skin, human.hairHue], [0, 0x03ea, 0x044e], "an elf style and elf hues are not a human's");
  const male = repick(elf, { ...elf, female: false }, races);
  assert.equal(male.hairStyle, 0, "0x2FCC is a female elf style only");
  const bearded = repick(human, { ...human, female: false, facialStyle: 8256 }, races);
  assert.deepEqual([bearded.facialStyle, repick(bearded, { ...bearded, female: true }, races).facialStyle, repick(bearded, { ...bearded, race: "elf" }, races).facialStyle], [8256, 0, 0]);
  assert.deepEqual([hasFacialHair({ race: "gargoyle", female: false }), hasFacialHair({ race: "elf", female: false })], [true, false]);
});

test("[fast] customize: a scanned value outside the game's lists is kept until a race or gender change makes it invalid", () => {
  const dyed: Look = { ...ELF, hair: { graphic: 0x2fcc, hue: 1153 } }, off: Look = { ...ELF, hair: { graphic: 0x2fff, hue: 519 } };
  const c = choiceOf(dyed);
  assert.equal(c.hairHue, 1153, "a dyed hair color is not in the elf palette, and stays");
  assert.deepEqual(lookOfChoice(repick(c, { ...c, skin: 0x076c }, races), dyed).hair, dyed.hair, "a skin change keeps the dyed hair");
  assert.equal(repick(c, { ...c, race: "human" }, races).hairHue, 0x044e, "a new race takes its own palette");
  const o = choiceOf(off);
  assert.equal(repick(o, { ...o, hairHue: 0x0207 }, races).hairStyle, 0x2fff, "a style outside the list survives a color change");
  assert.equal(repick(o, { ...o, female: false }, races).hairStyle, 0, "and goes with a gender change");
});

test("[fast] customize: facial hair takes the hair's color unless set apart, and the scan's face stays only with its race", () => {
  const c = { ...choiceOf(STAND_IN), hairStyle: 8251, hairHue: 0x0451, facialStyle: 8256, facialHue: 0x0461, facialSameAsHair: true };
  assert.deepEqual(lookOfChoice(c, STAND_IN).beard, { graphic: 8256, hue: 0x0451 });
  assert.deepEqual(lookOfChoice({ ...c, facialSameAsHair: false }, STAND_IN).beard, { graphic: 8256, hue: 0x0461 });
  const elf = choiceOf(ELF);
  assert.deepEqual([lookOfChoice(elf, ELF).face, lookOfChoice({ ...elf, race: "human" }, ELF).face], [ELF.face, null]);
  assert.equal(sameLook(lookOfChoice(choiceOf(ELF), ELF), lookOfChoice(choiceOf(ELF), ELF)), true);
});

test("[fast] customize: a session's looks are kept per character until Reset or a newer scan, and draw in color", () => {
  const look = lookOfChoice(choiceOf(STAND_IN), STAND_IN);
  setCustomLook("Elfie", "2026-10-19T10:00:00Z", look);
  setCustomLook(null, null, look);
  assert.deepEqual([customLook("Elfie", "2026-10-19T10:00:00Z"), customLook(null, null), customLook("Other", null)], [look, look, null]);
  assert.equal(customLook("Elfie", "2026-10-19T11:00:00Z"), null, "a newer scan wins");
  assert.equal(customLook("Elfie", "2026-10-19T10:00:00Z"), null, "and the look is gone");
  setCustomLook(null, null, null);
  assert.equal(customLook(null, null), null, "Reset");
  const plan = dollPlan({ name: "Elfie", appearance: null, readsLook: true, client: "TazUO", custom: look });
  assert.deepEqual([plan.look, plan.gray, plan.note?.title], [look, false, "Rescan to show Elfie's look"]);
});
