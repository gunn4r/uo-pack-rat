// art-fixture.mts — synthetic client files for the item-art tests (no game data ships in the repo): a UOP container holding named entries, one item's static art, and a hues.mul. Each is written as given, so a test can make one that does not add up.
//
// map: house
// owns: `syntheticUop`, `syntheticArt`, `syntheticHues`
import { deflateSync } from "node:zlib";
import { uopHash } from "./art.mts";

// A UOP v5 file with the entries in one table block (or `perBlock` per block, chained), each stored as is or deflated (`zlib`). The data follows the table.
export function syntheticUop(entries: Array<{ name: string; data: Uint8Array; zlib?: boolean }>, perBlock = 100): Buffer {
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
      const packed = e.zlib ? deflateSync(e.data) : Buffer.from(e.data), o = 12 + k * 34;
      t.writeBigInt64LE(BigInt(dataAt), o);
      t.writeInt32LE(0, o + 8);
      t.writeInt32LE(packed.length, o + 12);
      t.writeInt32LE(e.data.length, o + 16);
      t.writeBigUInt64LE(uopHash(e.name), o + 20);
      t.writeInt16LE(e.zlib ? 1 : 0, o + 32);
      datas.push(packed);
      dataAt += packed.length;
    });
    tables.push(t);
    tableAt += t.length;
  }
  return Buffer.concat([head, ...tables, ...datas]);
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
