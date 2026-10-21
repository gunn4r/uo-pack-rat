// art-fixture.mts — synthetic client files for the art tests (no game data ships in the repo): a UOP container holding named entries (stored, deflated, or BWT-packed and deflated as a 7.x gump file packs them), one item's static art, one gump, and a hues.mul. Each is written as given, so a test can make one that does not add up.
//
// map: house
// owns: `syntheticUop`, `bwtPack`, `bwtList`, `mtfPack`, `syntheticArt`, `syntheticGump`, `syntheticHues`, `pngPixels`
import { deflateSync, inflateSync } from "node:zlib";
import { uopHash } from "./art.mts";

// A UOP v5 file with the entries in one table block (or `perBlock` per block, chained), each stored as is, deflated (`zlib`, flag 1), or BWT-packed and then deflated (`bwt`, flag 3, its decompressed length the packed length). The data follows the table.
export function syntheticUop(entries: Array<{ name: string; data: Uint8Array; zlib?: boolean; bwt?: boolean }>, perBlock = 100): Buffer {
  const blocks: Array<typeof entries> = [];
  for (let i = 0; i < entries.length; i += perBlock) blocks.push(entries.slice(i, i + perBlock));
  if (!blocks.length) blocks.push([]);
  const tableBytes = blocks.reduce((n, b) => n + 12 + b.length * 34, 0);
  const head = Buffer.alloc(28);
  head.writeUInt32LE(0x0050594d, 0);
  head.writeUInt32LE(5, 4);
  head.writeBigUInt64LE(28n, 12);
  head.writeUInt32LE(perBlock, 20);
  head.writeUInt32LE(entries.length, 24);
  const tables: Buffer[] = [], datas: Buffer[] = [];
  let tableAt = 28, dataAt = 28 + tableBytes;
  for (const [bi, b] of blocks.entries()) {
    const t = Buffer.alloc(12 + b.length * 34);
    t.writeUInt32LE(b.length, 0);
    t.writeBigUInt64LE(bi + 1 < blocks.length ? BigInt(tableAt + t.length) : 0n, 4);
    b.forEach((e, k) => {
      const inner = e.bwt ? bwtPack(e.data) : e.data, packed = e.zlib || e.bwt ? deflateSync(inner) : Buffer.from(inner), o = 12 + k * 34;
      t.writeBigInt64LE(BigInt(dataAt), o);
      t.writeInt32LE(0, o + 8);
      t.writeInt32LE(packed.length, o + 12);
      t.writeInt32LE(inner.length, o + 16);
      t.writeBigUInt64LE(uopHash(e.name), o + 20);
      t.writeInt16LE(e.bwt ? 3 : e.zlib ? 1 : 0, o + 32);
      datas.push(packed);
      dataAt += packed.length;
    });
    tables.push(t);
    tableAt += t.length;
  }
  return Buffer.concat([head, ...tables, ...datas]);
}

// The forward transform art.mts's bwtDecompress undoes, written from the decoder (no packer is published): `bwtList`'s counts and blocks, move-to-front coded by `mtfPack` behind a uint32 header (`header`), with one trailing byte (`tail`) the decoder never reads.
export function bwtPack(data: Uint8Array, header = 0, tail = 0): Buffer {
  return mtfPack(bwtList(data), header, tail);
}

// What bwtPack codes: the 256 int32 symbol counts, then each symbol's block, in order of count (highest first, the lowest symbol first on a tie), holding its place among the symbols ordered by first appearance and then, for each later occurrence, how many of the other symbols still to come appear before it again.
export function bwtList(data: Uint8Array): Buffer {
  const counts = new Array<number>(256).fill(0);
  for (const b of data) counts[b]!++;
  const order = counts.map((n, sym) => ({ n, sym })).filter((c) => c.n > 0).sort((a, b) => b.n - a.n || a.sym - b.sym).map((c) => c.sym);
  const firstAt = (sym: number): number => data.indexOf(sym);
  const byFirst = [...order].sort((a, b) => firstAt(a) - firstAt(b));
  const blocks = new Map<number, number[]>(order.map((sym) => [sym, [byFirst.indexOf(sym)]]));
  const nextAt = (sym: number, from: number): number => { const i = data.indexOf(sym, from); return i < 0 ? Infinity : i; };
  data.forEach((sym, t) => {
    const again = nextAt(sym, t + 1);
    if (again === Infinity) return;
    // The other symbols whose next occurrence comes before this one's.
    blocks.get(sym)!.push(order.filter((o) => o !== sym && nextAt(o, t + 1) < again).length);
  });
  const list = Buffer.alloc(1024);
  counts.forEach((n, i) => list.writeInt32LE(n, i * 4));
  return Buffer.concat([list, Buffer.from(order.flatMap((sym) => blocks.get(sym)!))]);
}

// `list` move-to-front coded behind the uint32 header, with the trailing byte.
export function mtfPack(list: Uint8Array, header = 0, tail = 0): Buffer {
  const table = Array.from({ length: 256 }, (_, i) => i);
  const coded = [...list].map((b) => { const i = table.indexOf(b); table.splice(i, 1); table.unshift(b); return i; });
  const out = Buffer.alloc(4 + coded.length + 1);
  out.writeUInt32LE(header, 0);
  out.set(coded, 4);
  out[out.length - 1] = tail;
  return out;
}

// A gump from rows of (colour, run) pairs: the uint32 width and height, the row starts (in 4-byte units from the start of that table), then the pairs.
export function syntheticGump(width: number, height: number, rows: Array<Array<[colour: number, run: number]>>): Buffer {
  const out = Buffer.alloc(8 + height * 4 + rows.reduce((n, r) => n + r.length * 4, 0));
  out.writeUInt32LE(width, 0);
  out.writeUInt32LE(height, 4);
  let unit = height;
  rows.forEach((pairs, y) => {
    if (y < height) out.writeInt32LE(unit, 8 + y * 4);
    for (const [colour, run] of pairs) { out.writeUInt16LE(colour, 8 + unit * 4); out.writeUInt16LE(run, 10 + unit * 4); unit++; }
  });
  return out;
}

// Item art from rows of runs, each [x skip, colours...]: the int32, width and height, the row starts, then each row's runs and its (0, 0) end.
export function syntheticArt(width: number, height: number, rows: Array<Array<[skip: number, ...colours: number[]]>>): Buffer {
  const bodies = rows.map((runs) => {
    const words: number[] = [];
    for (const [skip, ...cs] of runs) words.push(skip, cs.length, ...cs);
    words.push(0, 0);
    return words;
  });
  const out = Buffer.alloc(8 + height * 2 + bodies.reduce((n, w) => n + w.length * 2, 0));
  out.writeUInt16LE(width, 4);
  out.writeUInt16LE(height, 6);
  let word = 0, at = 8 + height * 2;
  bodies.forEach((w, y) => {
    if (y < height) out.writeUInt16LE(word, 8 + y * 2);
    for (const x of w) { out.writeUInt16LE(x, at); at += 2; }
    word += w.length;
  });
  return out;
}

// A hues.mul of whole groups holding these hues (1-based, in order), each 32 colours; the rest are zero.
export function syntheticHues(hues: Uint16Array[], groups = Math.max(1, Math.ceil(hues.length / 8))): Buffer {
  const out = Buffer.alloc(groups * 708);
  hues.forEach((cs, i) => { const at = Math.floor(i / 8) * 708 + 4 + (i % 8) * 88; cs.forEach((c, k) => out.writeUInt16LE(c, at + k * 2)); });
  return out;
}

// The RGBA pixels of a PNG app/png.mts wrote (one IDAT run, filter type 0 on every row), for the tests that check what was drawn.
export function pngPixels(b: Buffer): number[] {
  const w = b.readUInt32BE(16), parts: Buffer[] = [];
  for (let o = 8; o < b.length;) { const n = b.readUInt32BE(o); if (b.toString("latin1", o + 4, o + 8) === "IDAT") parts.push(b.subarray(o + 8, o + 8 + n)); o += 12 + n; }
  const raw = inflateSync(Buffer.concat(parts)), out: number[] = [];
  for (let o = 0; o < raw.length; o += 1 + w * 4) out.push(...raw.subarray(o + 1, o + 1 + w * 4));
  return out;
}
