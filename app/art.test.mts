// art.test.mts — `app/art.mts` (issue #174), the item art decoder, on synthetic client files.
//
// `app/art.mts` (issue #174) on synthetic files from `app/art-fixture.mts`: the lookup3 hash against its published vectors and the item art entry names; a UOP table read across chained blocks with a stored and a deflated entry, empty entries left out, only the table read until an entry is asked for, and malformed tables (bad magic or version, a looping chain, a chain past the block cap, a block or an entry past the end) refused; an entry packed another way, too big, or inflating to the wrong length refused; static art decoded, a run past the width, a row start or run past the buffer, a missing row end and a zero or huge size refused; hues.mul groups, a hue out of range or 0 giving none; full and partial hues; the cut to the opaque box and art with no opaque pixel. The paperdoll's gumps (issue #57): a flag 3 entry inflated and BWT-decoded, and one that does not unpack refused; the BWT port of ClassicUO's BwtDecompress undoing `bwtPack` (empty, one symbol, every symbol on a tie, random data), ignoring the header and the last byte, matching what ClassicUO itself decodes from three corrupted packs, and refusing a short or cut input, a negative count or a length past the cap; gumps decoded (colour 0 transparent, 0x0001 opaque, the last row's pairs up to the end, a run past its row cut there) and malformed ones refused. All `[fast]`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { bwtDecompress, decodeGump, decodeStatic, gumpArtName, hueOf, itemArtName, readHues, readUopEntry, readUopTable, toRgba, uopHash, type ReadAt } from "./art.mts";
import { bwtList, bwtPack, mtfPack, syntheticArt, syntheticGump, syntheticHues, syntheticUop } from "./art-fixture.mts";
import { rgb555 } from "./facet-fixture.mts";

// A reader over a buffer that counts what it was asked for, and answers null past the end as a file read would come up short.
function reader(buf: Buffer): { read: ReadAt; asked: Array<[number, number]> } {
  const asked: Array<[number, number]> = [];
  return { asked, read: (at, n) => { asked.push([at, n]); return at + n <= buf.length ? buf.subarray(at, at + n) : null; } };
}
const table = (buf: Buffer) => readUopTable(reader(buf).read, buf.length);

test("[fast] art: the lookup3 hash matches its published vectors, and item art is named after its graphic past the land tiles", () => {
  assert.equal(uopHash(""), 0xdeadbeefdeadbeefn);
  assert.equal(uopHash("Four score and seven years ago"), 0xce7226e617770551n);
  assert.equal(itemArtName(0), "build/artlegacymul/00016384.tga");
  assert.equal(itemArtName(0x0e40), "build/artlegacymul/00020032.tga");
  assert.notEqual(uopHash(itemArtName(1)), uopHash(itemArtName(2)));
});

test("[fast] art: a UOP table across chained blocks finds a stored and a deflated entry, and reads only the table until one is asked for", () => {
  const a = Buffer.from("stored bytes"), b = Buffer.alloc(300, 7);
  const file = syntheticUop([{ name: "x/a", data: a }, { name: "x/b", data: b, zlib: true }, { name: "x/c", data: Buffer.from("c") }], 2);
  const r = reader(file), t = readUopTable(r.read, file.length)!;
  assert.equal(t.hashes.length, 3);
  const dataStart = 28 + (12 + 2 * 34) + (12 + 34);
  assert.ok(r.asked.every(([at]) => at < dataStart), "no entry's data was read for the table");
  assert.deepEqual(Buffer.from(readUopEntry(t, "x/a", r.read)!), a);
  assert.deepEqual(Buffer.from(readUopEntry(t, "x/b", r.read)!), b);
  assert.equal(readUopEntry(t, "x/none", r.read), null);
  assert.equal(readUopEntry(t, "x/b", r.read, 100), null, "an entry larger than asked for is not inflated");
});

test("[fast] art: an empty entry is left out; a bad magic or version, a looping chain, or a block or an entry past the end is no table", () => {
  const file = syntheticUop([{ name: "x/a", data: Buffer.from("a") }, { name: "x/b", data: Buffer.from("b") }]);
  const empty = Buffer.from(file);
  empty.writeBigInt64LE(0n, 28 + 12);   // the first entry's offset
  assert.equal(table(empty)!.hashes.length, 1);
  const bad = (edit: (b: Buffer) => void): Buffer => { const b = Buffer.from(file); edit(b); return b; };
  assert.equal(table(bad((b) => b.writeUInt32LE(0x12345678, 0))), null, "magic");
  assert.equal(table(bad((b) => b.writeUInt32LE(6, 4))), null, "version");
  assert.equal(table(bad((b) => b.writeBigUInt64LE(28n, 28 + 4))), null, "a block whose next block is itself");
  const chain = (n: number): Buffer => {   // n empty blocks chained 12 bytes apart
    const b = Buffer.alloc(28 + 12 * n);
    b.writeUInt32LE(0x0050594d, 0); b.writeBigUInt64LE(28n, 12);
    for (let k = 0; k + 1 < n; k++) b.writeBigUInt64LE(BigInt(28 + 12 * (k + 1)), 28 + 12 * k + 4);
    return b;
  };
  assert.equal(table(chain(20000)), null, "a chain of more blocks than any real file has");
  assert.equal(table(chain(100))!.hashes.length, 0, "a hundred empty blocks are fine");
  assert.equal(table(bad((b) => b.writeBigUInt64LE(BigInt(file.length), 12))), null, "the first block past the end");
  assert.equal(table(bad((b) => b.writeUInt32LE(1000, 28))), null, "more entries than the file holds");
  assert.equal(table(bad((b) => b.writeInt32LE(1000, 28 + 12 + 12))), null, "an entry's data past the end");
  assert.equal(table(bad((b) => b.writeInt32LE(-1, 28 + 12 + 8))), null, "a negative header length");
  assert.equal(table(file.subarray(0, 20)), null, "shorter than the header");
  assert.equal(readUopTable(() => null, file.length), null, "a read that fails");
});

test("[fast] art: an entry packed any other way, or deflated to another length than it says, is not read", () => {
  const file = syntheticUop([{ name: "x/a", data: Buffer.from("aaaa"), zlib: true }, { name: "x/b", data: Buffer.from("b") }]);
  const r = reader(file);
  const flag2 = Buffer.from(file);
  flag2.writeInt16LE(2, 28 + 12 + 32 + 34);
  assert.equal(readUopEntry(table(flag2)!, "x/b", reader(flag2).read), null);
  const long = Buffer.from(file);
  long.writeInt32LE(5, 28 + 12 + 16);
  assert.equal(readUopEntry(table(long)!, "x/a", reader(long).read), null);
  assert.deepEqual(Buffer.from(readUopEntry(table(file)!, "x/a", r.read)!), Buffer.from("aaaa"));
});

const R = rgb555(31, 0, 0), G = rgb555(0, 31, 0), GREY = rgb555(8, 8, 8);
test("[fast] art: static art decodes its runs, 0 transparent, and anything that does not add up is null", () => {
  const art = decodeStatic(syntheticArt(3, 2, [[[1, R, G]], [[0, GREY], [1, 0x8000]]]))!;
  assert.deepEqual([art.width, art.height], [3, 2]);
  assert.deepEqual([...art.pixels], [0, 0x8000 | R, 0x8000 | G, 0x8000 | GREY, 0, 0x8000], "the alpha bit alone is opaque black");
  assert.equal(decodeStatic(syntheticArt(3, 1, [[[2, R, G]]])), null, "a run past the width");
  assert.equal(decodeStatic(syntheticArt(0, 1, [[]])), null, "no width");
  assert.equal(decodeStatic(syntheticArt(2000, 1, [[]])), null, "too wide");
  const far = syntheticArt(3, 1, [[[0, R]]]);
  far.writeUInt16LE(1000, 8);
  assert.equal(decodeStatic(far), null, "a row start past the buffer");
  const cut = syntheticArt(3, 1, [[[0, R, G]]]);
  assert.equal(decodeStatic(cut.subarray(0, cut.length - 4)), null, "no row end");
  assert.equal(decodeStatic(cut.subarray(0, cut.length - 6)), null, "a run past the buffer");
  assert.equal(decodeStatic(Buffer.alloc(6)), null);
});

test("[fast] art: hues.mul is whole groups; a hue is its low 14 bits, 1-based, and 0 or one past the file is none", () => {
  const h1 = new Uint16Array(32).map((_, k) => rgb555(k, 0, 31 - k)), h9 = new Uint16Array(32).fill(0x8000 | rgb555(0, 31, 0));
  const hues = readHues(syntheticHues([h1, ...Array.from({ length: 7 }, () => new Uint16Array(32)), h9]))!;
  assert.equal(hues.count, 16);
  assert.deepEqual([...hueOf(hues, 1)!.colours], [...h1]);
  assert.equal(hueOf(hues, 9)!.colours[0], rgb555(0, 31, 0), "the colour's top bit is dropped");
  assert.equal(hueOf(hues, 0x8001)!.partial, true);
  assert.equal(hueOf(hues, 1)!.partial, false);
  assert.equal(hueOf(hues, 0), null);
  assert.equal(hueOf(hues, 17), null);
  assert.equal(hueOf(hues, 0x4001)!.colours[1], h1[1], "only the low 14 bits name the hue");
  assert.equal(readHues(Buffer.alloc(708 * 2 + 1)), null);
  assert.equal(readHues(Buffer.alloc(0)), null);
});

test("[fast] art: RGBA is cut to the opaque box; a full hue recolours every pixel by its red channel, a partial one only the grey ones", () => {
  const art = decodeStatic(syntheticArt(4, 3, [[], [[1, R, GREY]], []]))!;
  const plain = toRgba(art)!;
  assert.deepEqual([plain.width, plain.height], [2, 1]);
  assert.deepEqual([...plain.rgba], [255, 0, 0, 255, 66, 66, 66, 255]);
  const hue = new Uint16Array(32).fill(rgb555(0, 0, 31));
  hue[8] = rgb555(0, 31, 0);
  assert.deepEqual([...toRgba(art, { colours: hue, partial: false })!.rgba], [0, 0, 255, 255, 0, 255, 0, 255], "red 31 and grey 8 each take their colour");
  assert.deepEqual([...toRgba(art, { colours: hue, partial: true })!.rgba], [255, 0, 0, 255, 0, 255, 0, 255], "only the grey pixel takes a partial hue");
  assert.equal(toRgba(decodeStatic(syntheticArt(2, 2, [[], []]))!), null, "no opaque pixel");
});

test("[fast] art: a flag 3 entry is inflated and then BWT-decoded, and one that does not unpack, or is packed past the cap, is not read", () => {
  const gump = syntheticGump(2, 1, [[[R, 2]]]);
  const file = syntheticUop([{ name: gumpArtName(13), data: gump, bwt: true }, { name: "x/raw", data: Buffer.from("not deflated") }]);
  assert.equal(gumpArtName(13), "build/gumpartlegacymul/00000013.tga");
  const r = reader(file), t = table(file)!;
  assert.deepEqual(Buffer.from(readUopEntry(t, gumpArtName(13), r.read)!), gump);
  assert.equal(t.flag[t.hashes.indexOf(uopHash(gumpArtName(13)))], 3);
  const raw = Buffer.from(file);
  raw.writeInt16LE(3, 28 + 12 + 32 + 34);
  assert.equal(readUopEntry(table(raw)!, "x/raw", reader(raw).read), null, "not deflated");
  assert.equal(readUopEntry(t, gumpArtName(13), r.read, 1030), null, "its BWT-packed length is past the cap");
});

test("[fast] art: the BWT port undoes bwtPack and ignores the header and the last byte, which ClassicUO never decodes", () => {
  const cases = [Buffer.alloc(0), Buffer.alloc(999, 7), Buffer.from(Array.from({ length: 2560 }, (_, i) => i % 256)), Buffer.from("abracadabra"),
    Buffer.from(Array.from({ length: 3000 }, (_, i) => (i * 7919) % 97 % 13))];
  for (const data of cases) assert.deepEqual(Buffer.from(bwtDecompress(bwtPack(data))!), data, `${data.length} bytes`);
  const p = bwtPack(Buffer.from("abracadabra"), 0xdeadbeef, 0xff);
  assert.deepEqual(Buffer.from(bwtDecompress(p)!), Buffer.from("abracadabra"));
  assert.deepEqual(Buffer.from(bwtDecompress(Buffer.concat([p.subarray(0, -1), Buffer.from([0x42])]))!), Buffer.from("abracadabra"), "the last byte is never read");
});

test("[fast] art: on corrupted packs the BWT port decodes what ClassicUO's own BwtDecompress does", () => {
  // Outputs recorded from ClassicUO's BwtDecompress.cs (ee79d7e), built and run on these synthetic inputs.
  const p = bwtPack(Buffer.from("abracadabra"));
  for (const [at, v, cuo] of [[1031, 2, "6272026364627272727272"], [1034, 1, "7262647262036363636363"], [1037, 0, "6162646103616361626262"]] as const) {
    const m = Buffer.from(p);
    m[at] = v;
    assert.equal(Buffer.from(bwtDecompress(m)!).toString("hex"), cuo, `byte ${at} set to ${v}`);
  }
});

test("[fast] art: the BWT port refuses a short or cut input, a negative count, and a length past the cap", () => {
  const p = bwtPack(Buffer.from("abracadabra"));
  assert.equal(bwtDecompress(p.subarray(0, 4)), null, "no first byte");
  assert.equal(bwtDecompress(p.subarray(0, 1000)), null, "the counts cut short");
  assert.equal(bwtDecompress(p.subarray(0, p.length - 3)), null, "the blocks cut short");
  // The list "abracadabra" packs to, with symbol 0 counted -1 and "a" 6: the counts still sum to 11.
  const list = bwtList(Buffer.from("abracadabra"));
  list.writeInt32LE(-1, 0);
  list.writeInt32LE(6, 0x61 * 4);
  assert.equal(bwtDecompress(mtfPack(list)), null, "a negative count");
  assert.equal(bwtDecompress(bwtPack(Buffer.alloc(2000, 1)), 1999), null, "past maxBytes");
  assert.equal(bwtDecompress(bwtPack(Buffer.alloc(2000, 1)), 2000)!.length, 2000);
});

test("[fast] gump: rows of (colour, run) pairs, colour 0 transparent and 0x0001 opaque, the last row up to the end, and a run past its row cut there", () => {
  const g = decodeGump(syntheticGump(3, 3, [[[0, 1], [R, 2]], [[1, 1], [0, 1], [G, 5]], [[GREY, 3]]]))!;
  assert.deepEqual([g.width, g.height], [3, 3]);
  assert.deepEqual([...g.pixels], [0, 0x8000 | R, 0x8000 | R, 0x8001, 0, 0x8000 | G, 0x8000 | GREY, 0x8000 | GREY, 0x8000 | GREY]);
  assert.deepEqual([...decodeGump(syntheticGump(2, 1, [[[0x8000 | R, 2]]]))!.pixels], [0x8000 | R, 0x8000 | R], "the top bit of a colour is dropped");
  assert.equal(toRgba(g)!.width, 3, "drawn like item art");
});

test("[fast] gump: a size of 0 or past the cap, row starts out of order or past the end, or a buffer too short is null", () => {
  assert.equal(decodeGump(syntheticGump(0, 1, [[]])), null, "no width");
  assert.equal(decodeGump(syntheticGump(2000, 1, [[[R, 1]]])), null, "too wide");
  assert.equal(decodeGump(syntheticGump(2, 5, [[[R, 1]]])), null, "more rows than the buffer has row starts");
  const two = syntheticGump(2, 2, [[[R, 2]], [[G, 2]]]);
  const swap = Buffer.from(two); swap.writeInt32LE(4, 8); swap.writeInt32LE(2, 12);
  assert.equal(decodeGump(swap), null, "rows out of order");
  const far = Buffer.from(two); far.writeInt32LE(99, 12);
  assert.equal(decodeGump(far), null, "a row start past the end");
  const inside = Buffer.from(two); inside.writeInt32LE(1, 8);
  assert.equal(decodeGump(inside), null, "a row start inside the row table");
  assert.equal(decodeGump(Buffer.alloc(7)), null);
});
