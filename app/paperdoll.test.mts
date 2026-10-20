// paperdoll.test.mts — `app/paperdoll.mts` (issue #57), the paperdoll figure, on synthetic client files.
//
// `app/paperdoll.mts` (issue #57) on synthetic gumps, tiledata and hues (no game art): gump.def and Equipconv.def read as ClassicUO reads them (a line kept only when it starts with a digit, comments, an alias only for a gump the archive lacks, the first alt that exists, an earlier alias counting as existing, Equipconv's 0 and -1 gumps and a gump past 65,535 skipped, a later line winning); the gump source (the archive first, gump.def's alias with its hue, nothing for a gump that does not decode); which bodies are drawn and the stand-in for none or a form's body; `paperdollOrder` and `isCovered` on hand-picked cases from ClassicUO's rules (both were also checked against ClassicUO's own PaperdollOrder.Build and MobileView.IsCovered on 200,000 random worn sets, outside the repo); and a composed figure: the live scan's elf (body 606, skin 0x851D, hair 0x2FCC hue 519, face 0x3B46 hue 0x824D) with the skin partial on the body and the hair and face hued in full, the face under the hair, the female gump offset falling back to the male one and back (also when the female id passes 0xFFFF, never wrapping to gump 0), the hued layers kept up to the cache size in bytes, Equipconv and a gump.def alias with its hue, a robe hiding the torso and an open robe not, the arms-late table, the 0x0001 lining drawn only over something, pieces on the look's own layers, the backpack, unknown graphics and duplicate layers, the GM body, the crop box of a pair and the stand-in's grey. All `[fast]`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readHues, readUopTable, toRgba, uopIndex, gumpArtName, type ReadAt } from "./art.mts";
import { syntheticGump, syntheticHues, syntheticUop } from "./art-fixture.mts";
import { rgb555 } from "./facet-fixture.mts";
import { FLAG, readTileData } from "./tiledata.mts";
import { syntheticTileData, type FixtureTile } from "./tiledata-fixture.mts";
import { CANVAS, LAYER, STAND_IN, createPaperdoll, drawsBody, figureBox, greyRgba, gumpSource, isCovered, lookOf, paperdollOrder, readEquipConv, readGumpDef, type Look, type Worn } from "./paperdoll.mts";

const GREY = rgb555(16, 16, 16), RED = rgb555(31, 0, 0), BLUE = rgb555(0, 0, 31), GREEN = rgb555(0, 31, 0);
// A gump `w` x `h` filled with one colour, from (x0, y0) on (transparent before it).
const solid = (w: number, h: number, colour: number, x0 = 0, y0 = 0): Buffer =>
  syntheticGump(x0 + w, y0 + h, Array.from({ length: y0 + h }, (_, y) => (y < y0 ? [[0, x0 + w]] : [[0, x0], [colour, w]]) as Array<[number, number]>).map((r) => r.filter(([, n]) => n > 0)));

// Client files from gumps by id (each packed as 7.x does, flag 3), tiledata entries, hues (1-based, in order) and the two .def texts.
function files(gumps: Record<number, Buffer>, tiles: FixtureTile[] = [], hues: Uint16Array[] = [], gumpDef = "", equipConv = "") {
  const uop = syntheticUop(Object.entries(gumps).map(([id, data]) => ({ name: gumpArtName(+id), data, bwt: true })));
  const read: ReadAt = (at, n) => (at + n <= uop.length ? uop.subarray(at, at + n) : null);
  const table = readUopTable(read, uop.length)!;
  const defs = readGumpDef(gumpDef, (id) => uopIndex(table, gumpArtName(id)) >= 0);
  return { gump: gumpSource(table, read, defs), tiles: readTileData(syntheticTileData(tiles)), hues: readHues(syntheticHues(hues.length ? hues : [new Uint16Array(32)]))!, equipConv: readEquipConv(equipConv) };
}
const px = (art: { width: number; pixels: Uint16Array }, x: number, y: number): number => art.pixels[y * art.width + x]!;
const ramp = (g: number) => new Uint16Array(32).map((_, k) => rgb555(k, g, 31 - k));
const hued = (g: number, red: number): number => 0x8000 | rgb555(red, g, 31 - red);

test("[fast] gump.def: an alias only for a gump the archive lacks, its first alt that exists, with the line's hue; comments and non-numeric lines skipped", () => {
  const archive = new Set([100, 200, 300]);
  const defs = readGumpDef([
    "# a comment", "abc 1 {2} 3", "",
    "50 {7, 100, 200} 33   # first existing alt",
    "51 {7} 1", "52 {300} 5", "52 {100} 6", "100 {200} 9",
    "60 {50} 12", "61 0x10 4", "62 {0x64} 1", "63 {200}",
  ].join("\n"), (id) => archive.has(id));
  assert.deepEqual(defs.get(50), { from: 100, hue: 33 });
  assert.equal(defs.has(51), false, "no alt exists");
  assert.deepEqual(defs.get(52), { from: 300, hue: 5 }, "the first line for an id wins");
  assert.equal(defs.has(100), false, "the archive has it");
  assert.deepEqual(defs.get(60), { from: 100, hue: 12 }, "an alias of an alias names where the art is");
  assert.equal(defs.has(61), false, "not a group");
  assert.equal(defs.has(62), false, "a hex alt is not read");
  assert.equal(defs.has(63), false, "fewer than three tokens");
});

test("[fast] Equipconv.def: keyed by body then anim; a gump of 0 is the anim, -1 or 65535 the new anim; past 65,535 skipped; a later line wins", () => {
  const conv = readEquipConv(["# body anim new gump colour", "606 10 11 0 0", "606 12 13 -1 0", "606 14 15 65535 0", "606 16 17 70000 0", "606 18 19 50500 0", "606 18 19 60700 0", "400\t20 21 22 0"].join("\n"));
  assert.deepEqual([...conv.get(606)!], [[10, 10], [12, 13], [14, 15], [18, 60700]]);
  assert.deepEqual([...conv.get(400)!], [[20, 22]]);
});

test("[fast] gump source: the archive's gump without a hue, a gump.def alias with its hue, and nothing for a gump that is missing or does not decode", () => {
  const f = files({ 5: solid(2, 2, RED), 6: Buffer.from("not a gump") }, [], [], "7 {5} 3\n8 {6} 4\n");
  assert.deepEqual([f.gump(5)!.art.width, f.gump(5)!.hue], [2, 0]);
  assert.deepEqual([f.gump(7)!.art.width, f.gump(7)!.hue], [2, 3]);
  assert.equal(f.gump(6), null, "in the archive but not a gump: no fallback");
  assert.equal(f.gump(9), null);
  assert.equal(f.gump(-1), null);
});

test("[fast] gump source: decoded gumps are kept up to the cache's size in bytes, then read again", () => {
  const uop = syntheticUop([5, 10].map((id) => ({ name: gumpArtName(id), data: solid(2, 2, RED), bwt: true })));
  const reads = (cacheBytes: number): number => {
    let n = 0;
    const read: ReadAt = (at, k) => { n++; return at + k <= uop.length ? uop.subarray(at, at + k) : null; };
    const table = readUopTable(read, uop.length)!, src = gumpSource(table, read, new Map(), cacheBytes);
    src(5); const first = n;
    src(10); src(5);
    return n - first;
  };
  const one = reads(1 << 20);
  assert.ok(one > 0 && reads(10) > one, "gump 5 (2 x 2 = 8 bytes) is read again after gump 10 overflows a 10-byte cache");
});

test("[fast] bodies: human, elf, gargoyle and the GM body are drawn; any other is a form's, and the stand-in takes its place, as it does for no look", () => {
  for (const b of [400, 401, 403, 605, 606, 666, 667, 694, 695, 0x3db]) assert.equal(drawsBody(b), true, String(b));
  assert.equal(drawsBody(0x4e5), false);
  const elf: Look = { body: 606, hue: 0x851d, hair: { graphic: 0x2fcc, hue: 519 }, beard: null, face: { graphic: 0x3b46, hue: 0x824d } };
  assert.deepEqual(lookOf(elf), { look: elf, standIn: null });
  assert.deepEqual(lookOf(null), { look: STAND_IN, standIn: "none" });
  assert.deepEqual(lookOf({ ...elf, body: 746 }), { look: STAND_IN, standIn: "form" }, "a form's hair and face are not used either");
});

test("[fast] draw order: T2 by default, T1 for late arms, T3 torso-first only on a female or gargoyle body, and the per-graphic moves", () => {
  const gfx = (o: Record<number, number>) => { const g = new Array<number>(25).fill(0); for (const [l, a] of Object.entries(o)) g[+l] = a; return g; };
  const at = (order: number[], l: number) => order.indexOf(l);
  const plain = paperdollOrder(gfx({}), false);
  assert.deepEqual(plain.slice(0, 7), [LAYER.Cloak, LAYER.Shirt, LAYER.Pants, LAYER.Shoes, LAYER.Legs, LAYER.Arms, LAYER.Torso]);
  assert.ok(!plain.includes(LAYER.Backpack) && !plain.includes(LAYER.Mount));
  assert.ok(at(plain, LAYER.Face) < at(plain, LAYER.Hair), "the face under the hair");
  const late = paperdollOrder(gfx({ [LAYER.Arms]: 0x210 }), false);
  assert.ok(at(late, LAYER.Arms) > at(late, LAYER.Torso), "T1: arms after the torso");
  assert.equal(paperdollOrder(gfx({ [LAYER.Torso]: 0x39a }), true)[1], LAYER.Torso, "T3 on a female body");
  assert.deepEqual(paperdollOrder(gfx({ [LAYER.Torso]: 0x39a }), false), plain, "not on a male one");
  const swap = paperdollOrder(gfx({ [LAYER.Pants]: 0x200 }), false);
  assert.ok(at(swap, LAYER.Shoes) < at(swap, LAYER.Pants), "pants 0x200 after the shoes");
  const quiver = paperdollOrder(gfx({ [LAYER.Cloak]: 0x380 }), false);
  assert.equal(at(quiver, LAYER.Cloak), at(quiver, LAYER.Robe) + 1, "the quiver after the robe");
  const neck = paperdollOrder(gfx({ [LAYER.Helmet]: 0x201, [LAYER.Necklace]: 0x1c8 }), false);
  assert.equal(at(neck, LAYER.Necklace), at(neck, LAYER.Helmet) + 1, "a gorget over this helmet");
});

test("[fast] coverage: a robe hides torso and arms (an open one does not), legs hide pants and shoes, and a hood hides hair and helmet except on a gargoyle", () => {
  const on = (o: Record<number, [graphic: number, anim: number]>) => (l: number) => (o[l] ? { graphic: o[l]![0], anim: o[l]![1] } : null);
  const robe = on({ [LAYER.Robe]: [0x1f03, 0x1f0], [LAYER.Torso]: [0x1415, 0x1], [LAYER.Arms]: [0x1410, 0x2] });
  assert.deepEqual([isCovered(robe, 400, LAYER.Torso), isCovered(robe, 400, LAYER.Arms)], [true, true]);
  const open = on({ [LAYER.Robe]: [0x9985, 0x1f0], [LAYER.Torso]: [0x1415, 0x1] });
  assert.equal(isCovered(open, 400, LAYER.Torso), false);
  const legs = on({ [LAYER.Legs]: [0x1411, 0x3], [LAYER.Pants]: [0x152e, 0x4], [LAYER.Shoes]: [0x170b, 0x5] });
  assert.deepEqual([isCovered(legs, 400, LAYER.Pants), isCovered(legs, 400, LAYER.Shoes)], [true, true]);
  const hood = on({ [LAYER.Robe]: [0x2683, 0x1f0], [LAYER.Hair]: [0x203b, 0x6], [LAYER.Helmet]: [0x1408, 0x7] });
  assert.deepEqual([isCovered(hood, 606, LAYER.Hair), isCovered(hood, 606, LAYER.Helmet), isCovered(hood, 667, LAYER.Hair)], [true, true, true], "this hood hides on every body");
  const cowl = on({ [LAYER.Robe]: [0x4b9d, 0x1f0], [LAYER.Hair]: [0x203b, 0x6] });
  assert.deepEqual([isCovered(cowl, 606, LAYER.Hair), isCovered(cowl, 667, LAYER.Hair)], [true, false], "this one not on a gargoyle");
  assert.equal(isCovered(on({ [LAYER.Hair]: [0x203b, 0x6] }), 606, LAYER.Hair), false);
});

// The live scan's elf: body 606 (gump 0x0F), skin 0x851D (hue 1309), hair 0x2FCC hue 519, face 0x3B46 hue 0x824D (hue 589). Made-up anims 0x100 (hair) and 0x101 (face).
const ELF: Look = { body: 606, hue: 0x851d, hair: { graphic: 0x2fcc, hue: 519 }, beard: null, face: { graphic: 0x3b46, hue: 0x824d } };
function elfFiles(extra: Record<number, Buffer> = {}, tiles: FixtureTile[] = [], gumpDef = "", equipConv = "") {
  const hues = Array.from({ length: 1400 }, () => new Uint16Array(32));
  hues[1309 - 1] = ramp(1); hues[519 - 1] = ramp(2); hues[589 - 1] = ramp(3); hues[7 - 1] = ramp(7); hues[8 - 1] = ramp(8);
  return files({
    0x0f: syntheticGump(8, 2, [[[GREY, 4], [RED, 4]], [[GREY, 8]]]),          // the body: grey skin, and a red pixel run the partial skin hue leaves alone
    [60000 + 0x101]: solid(3, 1, GREY, 0, 1),                                    // the face, on row 1, x 0-2
    [60000 + 0x100]: solid(2, 1, GREY, 2, 1),                                    // the hair, on row 1, x 2-3: over the face at x 2
    ...extra,
  }, [{ graphic: 0x2fcc, flags: FLAG.wearable, layer: 11, anim: 0x100 }, { graphic: 0x3b46, flags: FLAG.wearable, layer: 15, anim: 0x101 }, ...tiles], hues, gumpDef, equipConv);
}

test("[fast] figure: the live scan's elf — the skin hues only the body's grey, the face and hair take their hues in full, and the hair is drawn over the face", () => {
  const fig = createPaperdoll(elfFiles()).compose(ELF, [])!;
  assert.deepEqual([fig.width, fig.height], [CANVAS.width, CANVAS.height]);
  assert.equal(px(fig, 0, 0), hued(1, 16), "skin on grey");
  assert.equal(px(fig, 5, 0), 0x8000 | RED, "the partial skin leaves the red alone");
  assert.equal(px(fig, 0, 1), hued(3, 16), "the face, hue 589");
  assert.equal(px(fig, 2, 1), hued(2, 16), "the hair over the face, hue 519");
  assert.equal(px(fig, 4, 1), hued(1, 16), "the body where nothing is worn");
});

test("[fast] figure: a female piece with no female gump uses the male one, and a male piece with no male gump the female one", () => {
  const tiles = [{ graphic: 0x1500, flags: FLAG.wearable, layer: LAYER.Torso, anim: 0x200 }];
  const female = createPaperdoll(elfFiles({ [50000 + 0x200]: solid(1, 1, BLUE, 7, 0) }, tiles)).compose(ELF, [{ graphic: 0x1500, hue: 0 }])!;
  assert.equal(px(female, 7, 0), 0x8000 | BLUE);
  const f = elfFiles({ 0x0c: solid(8, 2, GREY), [60000 + 0x200]: solid(1, 1, BLUE, 7, 0) }, tiles);
  assert.equal(px(createPaperdoll(f).compose({ ...STAND_IN }, [{ graphic: 0x1500, hue: 0 }])!, 7, 0), 0x8000 | BLUE);
});

test("[fast] figure: a female gump past 0xFFFF takes the male one, never the gump its id wraps to", () => {
  const tiles = [{ graphic: 0x1500, flags: FLAG.wearable, layer: LAYER.Torso, anim: 5536 }];   // 5536 + 60000 = 65536, which wraps to gump 0
  const fig = createPaperdoll(elfFiles({ 0: solid(1, 1, RED, 7, 0), [50000 + 5536]: solid(1, 1, BLUE, 7, 0) }, tiles)).compose(ELF, [{ graphic: 0x1500, hue: 0 }])!;
  assert.equal(px(fig, 7, 0), 0x8000 | BLUE);
});

test("[fast] figure: the hued layers are kept up to the cache's size in bytes, then read again", () => {
  const reads = (cacheBytes: number): number => {
    const f = elfFiles(), gump = f.gump;
    let n = 0;
    const r = createPaperdoll({ ...f, gump: (id) => { if (id === 0x0f) n++; return gump(id); } }, cacheBytes);
    const a = r.compose(ELF, [])!, b = r.compose(ELF, [])!;
    assert.deepEqual(b.pixels, a.pixels);
    return n;
  };
  assert.equal(reads(1 << 20), 1, "the body is read once");
  assert.equal(reads(50), 2, "the body (8 x 2 = 48 bytes) and the face do not fit in 50 bytes together");
});

test("[fast] figure: Equipconv.def swaps a piece's gump for this body, and a gump.def alias is hued in full by its line, then by the piece", () => {
  const tiles = [{ graphic: 0x1500, flags: FLAG.wearable, layer: LAYER.Torso, anim: 0x200 }, { graphic: 0x1501, flags: FLAG.wearable, layer: LAYER.Gloves, anim: 0x300 }];
  const f = elfFiles({ [60000 + 0x222]: solid(1, 1, BLUE, 7, 0), 0x7000: solid(1, 1, GREY, 6, 0) }, tiles, `${60000 + 0x300} {${0x7000}} 7`, `606 ${0x200} 0 ${60000 + 0x222} 0`);
  const fig = createPaperdoll(f).compose(ELF, [{ graphic: 0x1500, hue: 0 }, { graphic: 0x1501, hue: 0 }])!;
  assert.equal(px(fig, 7, 0), 0x8000 | BLUE, "Equipconv's gump");
  assert.equal(px(fig, 6, 0), hued(7, 16), "the alias's hue 7");
  const twice = createPaperdoll(f).compose(ELF, [{ graphic: 0x1501, hue: 8 }])!;
  assert.equal(px(twice, 6, 0), hued(8, 16), "then the piece's hue 8, by the red channel the alias's hue left");
});

test("[fast] figure: a robe hides the torso while an open robe shows it, and late arms are drawn over the torso", () => {
  const tiles = [
    { graphic: 0x1415, flags: FLAG.wearable, layer: LAYER.Torso, anim: 0x201 }, { graphic: 0x1f03, flags: FLAG.wearable, layer: LAYER.Robe, anim: 0x202 },
    { graphic: 0x9985, flags: FLAG.wearable, layer: LAYER.Robe, anim: 0x203 }, { graphic: 0x1410, flags: FLAG.wearable, layer: LAYER.Arms, anim: 0x210 },
  ];
  const f = elfFiles({ [60000 + 0x201]: solid(1, 1, BLUE, 7, 0), [60000 + 0x210]: solid(1, 1, GREEN, 7, 0) }, tiles);
  const r = createPaperdoll(f);
  assert.equal(px(r.compose(ELF, [{ graphic: 0x1415, hue: 0 }, { graphic: 0x1f03, hue: 0 }])!, 7, 0), 0x8000 | RED, "hidden: the body shows");
  assert.equal(px(r.compose(ELF, [{ graphic: 0x1415, hue: 0 }, { graphic: 0x9985, hue: 0 }])!, 7, 0), 0x8000 | BLUE);
  assert.equal(px(r.compose(ELF, [{ graphic: 0x1415, hue: 0 }, { graphic: 0x1410, hue: 0 }])!, 7, 0), 0x8000 | GREEN, "arms anim 0x210 picks the arms-late table");
});

test("[fast] figure: a 0x0001 lining pixel is drawn over something and left out over empty space", () => {
  const tiles = [{ graphic: 0x1408, flags: FLAG.wearable, layer: LAYER.Helmet, anim: 0x204 }];
  const f = elfFiles({ [60000 + 0x204]: syntheticGump(10, 1, [[[0, 7], [0x0001, 3]]]) }, tiles);
  const fig = createPaperdoll(f).compose(ELF, [{ graphic: 0x1408, hue: 0 }])!;
  assert.equal(px(fig, 7, 0), 0x8001, "over the body");
  assert.equal(px(fig, 8, 0), 0, "over nothing");
});

test("[fast] figure: a worn piece on the look's own layers, the backpack, an unknown graphic, and the earlier of two on a layer are left out; a form's body draws nothing", () => {
  const tiles = [
    { graphic: 0x2040, flags: FLAG.wearable, layer: LAYER.Hair, anim: 0x205 }, { graphic: 0x0e75, flags: FLAG.wearable, layer: LAYER.Backpack, anim: 0x206 },
    { graphic: 0x1500, flags: FLAG.wearable, layer: LAYER.Torso, anim: 0x200 }, { graphic: 0x1501, flags: FLAG.wearable, layer: LAYER.Torso, anim: 0x207 },
  ];
  const f = elfFiles({ [60000 + 0x205]: solid(1, 1, BLUE, 7, 1), [60000 + 0x206]: solid(1, 1, BLUE, 6, 1), [60000 + 0x200]: solid(1, 1, BLUE, 7, 0), [60000 + 0x207]: solid(1, 1, GREEN, 7, 0) }, tiles);
  const r = createPaperdoll(f);
  const worn: Worn[] = [{ graphic: 0x2040, hue: 0 }, { graphic: 0x0e75, hue: 0 }, { graphic: 0xfff0, hue: 0 }, { graphic: 0x1500, hue: 0 }, { graphic: 0x1501, hue: 0 }];
  const fig = r.compose(ELF, worn)!;
  assert.deepEqual([px(fig, 7, 1), px(fig, 6, 1), px(fig, 7, 0)], [hued(1, 16), hued(1, 16), 0x8000 | GREEN]);
  assert.equal(r.compose({ ...ELF, body: 746 }, []), null);
});

test("[fast] figure: the GM body is drawn with hue 0x3EA under its overlay in the look's hue", () => {
  const hues = Array.from({ length: 1100 }, () => new Uint16Array(32));
  hues[0x3ea - 1] = ramp(4); hues[9 - 1] = ramp(5);
  const f = files({ 0x0c: solid(2, 1, GREY), 0xc72b: solid(1, 1, GREY, 1, 0) }, [], hues);
  const fig = createPaperdoll(f).compose({ body: 0x3db, hue: 9, hair: null, beard: null, face: null }, [])!;
  assert.deepEqual([px(fig, 0, 0), px(fig, 1, 0)], [hued(4, 16), hued(5, 16)]);
});

test("[fast] figure box: the union of a pair's opaque boxes plus 6 pixels, kept on the canvas; the stand-in's grey is each pixel's luminance", () => {
  const a = { width: CANVAS.width, height: CANVAS.height, pixels: new Uint16Array(CANVAS.width * CANVAS.height) }, b = { ...a, pixels: new Uint16Array(a.pixels.length) };
  a.pixels[20 * CANVAS.width + 10] = 0x8000 | RED;
  b.pixels[40 * CANVAS.width + 30] = 0x8000 | RED;
  assert.deepEqual(figureBox([a, b]), { x0: 4, y0: 14, x1: 36, y1: 46 });
  const img = toRgba(a, null, figureBox([a, b]))!;
  assert.deepEqual([img.width, img.height], [33, 33], "the first figure cropped to the pair's box");
  b.pixels[(CANVAS.height - 1) * CANVAS.width + CANVAS.width - 1] = 0x8000 | RED;
  assert.deepEqual(figureBox([b]), { x0: 24, y0: 34, x1: CANVAS.width - 1, y1: CANVAS.height - 1 });
  assert.equal(figureBox([{ ...a, pixels: new Uint16Array(a.pixels.length) }]), null);
  assert.deepEqual([...greyRgba(Buffer.from([255, 0, 0, 255, 0, 0, 255, 128]))], [77, 77, 77, 255, 28, 28, 28, 128]);
});
