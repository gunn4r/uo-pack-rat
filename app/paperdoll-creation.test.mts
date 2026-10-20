// paperdoll-creation.test.mts — `app/paperdoll-creation.mts` and `app/cliloc.mts` (issue #57): the Customize popover's choices and the client's strings they are named from.
//
// `app/paperdoll-creation.mts` and `app/cliloc.mts` (issue #57) on synthetic files: Cliloc.enu read plain and BWT-packed (byte 3 0x8E), only the numbers asked for kept, and a file whose entries run past its end, or that does not unpack, refused; the creation table as the game's lists (each race's palette sizes and style counts, no facial hair for elves) and `creationOptions` offering each palette entry as the hue it gives (entry + 1, as the live scan shows) with its swatch color from ramp entry 18 (skin) and 20 (hair) as #rrggbb, a palette's repeats listed once, a hue the file lacks left out, names from the file, the two beard-and-moustache styles named so, and "None" and "Style n" where the file has no name. All `[fast]`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readHues } from "./art.mts";
import { bwtPack, syntheticHues } from "./art-fixture.mts";
import { rgb555 } from "./facet-fixture.mts";
import { readCliloc } from "./cliloc.mts";
import { CREATION, CREATION_LABELS, creationOptions } from "./paperdoll-creation.mts";

// A Cliloc.enu of these entries: the 6-byte header, then int32 number, flag, int16 length and UTF-8.
function cliloc(entries: Array<[number, string]>): Buffer {
  return Buffer.concat([Buffer.alloc(6), ...entries.map(([id, text]) => {
    const t = Buffer.from(text, "utf8"), b = Buffer.alloc(7);
    b.writeInt32LE(id, 0); b.writeInt16LE(t.length, 5);
    return Buffer.concat([b, t]);
  })]);
}

test("[fast] cliloc: entries read plain and BWT-packed, only the numbers asked for, and a file that runs past its end refused", () => {
  const file = cliloc([[3000340, "None"], [3000341, "Short"], [1112310, "Horn Style 1"], [42, "élan"]]);
  assert.deepEqual([...readCliloc(file, new Set([3000340, 42]))!], [[3000340, "None"], [42, "élan"]]);
  const packed = bwtPack(file);
  packed[3] = 0x8e;   // the header byte the client's packed files carry
  assert.deepEqual([...readCliloc(packed, new Set([1112310]))!], [[1112310, "Horn Style 1"]]);
  assert.equal(readCliloc(file.subarray(0, file.length - 2), new Set([42])), null, "an entry past the end");
  assert.equal(readCliloc(Buffer.from([0, 0, 0, 0x8e, 1]), new Set()), null, "a packed file that does not unpack");
});

test("[fast] creation table: the game's lists, with no facial hair for elves", () => {
  assert.deepEqual([CREATION.human.skin.length, CREATION.elf.skin.length, CREATION.gargoyle.skin.length], [64, 32, 28]);
  assert.deepEqual([CREATION.human.hair.length, CREATION.elf.hair.length, CREATION.gargoyle.hair.length], [48, 54, 18]);
  assert.deepEqual([CREATION.human.male.length, CREATION.human.female.length, CREATION.human.facial.length, CREATION.elf.facial.length, CREATION.gargoyle.facial.length], [10, 10, 8, 0, 5]);
  assert.ok(CREATION.elf.female.some(([, g]) => g === 0x2fcc), "the live scan's elf hair is an elf female style");
  assert.ok(CREATION_LABELS.has(3000340) && CREATION_LABELS.has(1074385));
});

test("[fast] creation options: swatches from ramp entries 18 and 20 as #rrggbb, repeats once, missing hues left out; names from the file, the beard-and-moustache styles renamed, fallbacks", () => {
  const hues = Array.from({ length: 0x0800 }, () => new Uint16Array(32));
  hues[0x03ea - 1]![18] = rgb555(31, 16, 0);
  hues[0x044e - 1]![20] = rgb555(0, 0, 31);
  const opts = creationOptions(readHues(syntheticHues(hues))!, new Map([[3000340, "None"], [3000341, "Short"], [1011060, "Short beard"]]));
  assert.deepEqual(opts.races.human.skin[0], { hue: 0x03ea, color: "#ff8400" }, "palette entry 0x03E9 gives hue 1002");
  assert.deepEqual(opts.races.human.hair[0], { hue: 0x044e, color: "#0000ff" });
  assert.equal(opts.races.human.skin.length, 57, "0x0421 is listed eight times in the game's palette");
  assert.equal(opts.races.gargoyle.skin.length, 25, "the gargoyle palette repeats its first three");
  assert.deepEqual(opts.races.human.hairStyles.male.slice(0, 3), [{ graphic: 0, label: "None" }, { graphic: 8251, label: "Short" }, { graphic: 8252, label: "Style 2" }]);
  assert.equal(opts.races.human.facialHair.find((s) => s.graphic === 8267)!.label, "Short beard & moustache");
  assert.deepEqual(opts.races.elf.facialHair, []);
  const few = creationOptions(readHues(syntheticHues([new Uint16Array(32)]))!, new Map());
  assert.deepEqual([few.races.human.skin, few.races.human.hairStyles.female[0]], [[], { graphic: 0, label: "None" }], "a hue the file lacks is left out");
});
