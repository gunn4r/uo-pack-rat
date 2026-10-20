// art.mts — art from the player's own client files: the UOP container (its table of entries, each found by the lookup3 hash of its name, and an entry stored, inflated, or inflated and BWT-decoded), one item's static art in artLegacyMUL.uop (issue #174), one gump in gumpartLegacyMUL.uop (the paperdoll, issue #57), and the colours of hues.mul. Pure, apart from the read callback the caller passes: nothing here throws on a file that does not add up or reads past a buffer; every decoder answers null instead. The table is read block by block and an entry only when it is asked for, never the whole payload.
//
// map: house
// owns: `readUopTable`, `readUopEntry`, `uopIndex`, `uopHash`, `bwtDecompress`, `gumpArtName`, `decodeGump`, `decodeStatic`, `readHues`, `hueOf`, `hueFor`, `huePixel`, `opaqueBox`, `toRgba`
import { inflateSync } from "node:zlib";

// Jenkins' lookup3 hashlittle2 with both seeds 0, as the UOP format names its entries: the 64-bit result is b << 32 | c.
const rot = (x: number, k: number): number => ((x << k) | (x >>> (32 - k))) >>> 0;
export function uopHash(name: string): bigint {
  const s = Buffer.from(name, "latin1");
  let a = (0xdeadbeef + s.length) >>> 0, b = a, c = a, i = 0, n = s.length;
  const w = (o: number): number => (s[o]! | (s[o + 1]! << 8) | (s[o + 2]! << 16) | (s[o + 3]! << 24)) >>> 0;
  for (; n > 12; n -= 12, i += 12) {
    a = (a + w(i)) >>> 0; b = (b + w(i + 4)) >>> 0; c = (c + w(i + 8)) >>> 0;
    a = (a - c) >>> 0; a = (a ^ rot(c, 4)) >>> 0; c = (c + b) >>> 0;
    b = (b - a) >>> 0; b = (b ^ rot(a, 6)) >>> 0; a = (a + c) >>> 0;
    c = (c - b) >>> 0; c = (c ^ rot(b, 8)) >>> 0; b = (b + a) >>> 0;
    a = (a - c) >>> 0; a = (a ^ rot(c, 16)) >>> 0; c = (c + b) >>> 0;
    b = (b - a) >>> 0; b = (b ^ rot(a, 19)) >>> 0; a = (a + c) >>> 0;
    c = (c - b) >>> 0; c = (c ^ rot(b, 4)) >>> 0; b = (b + a) >>> 0;
  }
  if (n > 0) {
    // The last 1 to 12 bytes, zero-padded.
    const t = Buffer.alloc(12);
    s.copy(t, 0, i);
    a = (a + t.readUInt32LE(0)) >>> 0; b = (b + t.readUInt32LE(4)) >>> 0; c = (c + t.readUInt32LE(8)) >>> 0;
    c = (c ^ b) >>> 0; c = (c - rot(b, 14)) >>> 0;
    a = (a ^ c) >>> 0; a = (a - rot(c, 11)) >>> 0;
    b = (b ^ a) >>> 0; b = (b - rot(a, 25)) >>> 0;
    c = (c ^ b) >>> 0; c = (c - rot(b, 16)) >>> 0;
    a = (a ^ c) >>> 0; a = (a - rot(c, 4)) >>> 0;
    b = (b ^ a) >>> 0; b = (b - rot(a, 14)) >>> 0;
    c = (c ^ b) >>> 0; c = (c - rot(b, 24)) >>> 0;
  }
  return (BigInt(b) << 32n) | BigInt(c);
}
// The entry name of an item graphic's art: item art follows the 0x4000 land tiles.
export const itemArtName = (graphic: number): string => `build/artlegacymul/${String(graphic + 0x4000).padStart(8, "0")}.tga`;

// Reads `length` bytes at `position` of the file, or answers null when it cannot (short of the file's end included).
export type ReadAt = (position: number, length: number) => Uint8Array | null;
// A UOP file's table, its entries sorted by name hash; empty entries (offset 0) left out. `at` is where an entry's data starts (its offset plus its header).
export interface UopTable { hashes: BigUint64Array; at: Float64Array; stored: Int32Array; size: Int32Array; flag: Int16Array }
const UOP_MAGIC = 0x0050594d, HEADER = 28, BLOCK_HEAD = 12, ENTRY = 34, MAX_ENTRIES = 1 << 20, MAX_BLOCKS = 1 << 14;

// The header (magic "MYP\0", version up to 5, signature, the first table block, block size, file count), then the chain of table blocks: a count, the next block (0 ends it), `count` entries of offset, header length, stored and decompressed lengths, name hash, adler32 and flag. Null when the chain loops or runs past MAX_BLOCKS blocks (a real file has under a hundred), a block or an entry reaches past the file, or a number does not make sense.
export function readUopTable(read: ReadAt, fileSize: number): UopTable | null {
  const head = read(0, HEADER);
  if (!head || head.length < HEADER) return null;
  const hv = new DataView(head.buffer, head.byteOffset, head.byteLength);
  if (hv.getUint32(0, true) !== UOP_MAGIC || hv.getUint32(4, true) > 5) return null;
  const rows: Array<{ hash: bigint; at: number; stored: number; size: number; flag: number }> = [];
  const seen = new Set<number>();
  let next = Number(hv.getBigUint64(12, true));
  while (next !== 0) {
    if (seen.has(next) || seen.size >= MAX_BLOCKS || next < HEADER || next + BLOCK_HEAD > fileSize) return null;
    seen.add(next);
    const bh = read(next, BLOCK_HEAD);
    if (!bh || bh.length < BLOCK_HEAD) return null;
    const bv = new DataView(bh.buffer, bh.byteOffset, bh.byteLength);
    const count = bv.getUint32(0, true), after = Number(bv.getBigUint64(4, true));
    if (rows.length + count > MAX_ENTRIES || next + BLOCK_HEAD + count * ENTRY > fileSize) return null;
    const body = count ? read(next + BLOCK_HEAD, count * ENTRY) : new Uint8Array(0);
    if (!body || body.length < count * ENTRY) return null;
    const v = new DataView(body.buffer, body.byteOffset, body.byteLength);
    for (let k = 0; k < count; k++) {
      const o = k * ENTRY, offset = Number(v.getBigInt64(o, true));
      if (offset === 0) continue;
      const headerLength = v.getInt32(o + 8, true), stored = v.getInt32(o + 12, true), size = v.getInt32(o + 16, true);
      if (offset < 0 || headerLength < 0 || stored < 0 || size < 0 || offset + headerLength + stored > fileSize) return null;
      rows.push({ hash: v.getBigUint64(o + 20, true), at: offset + headerLength, stored, size, flag: v.getInt16(o + 32, true) });
    }
    next = after;
  }
  rows.sort((x, y) => (x.hash < y.hash ? -1 : x.hash > y.hash ? 1 : 0));
  const t: UopTable = { hashes: new BigUint64Array(rows.length), at: new Float64Array(rows.length), stored: new Int32Array(rows.length), size: new Int32Array(rows.length), flag: new Int16Array(rows.length) };
  rows.forEach((r, i) => { t.hashes[i] = r.hash; t.at[i] = r.at; t.stored[i] = r.stored; t.size[i] = r.size; t.flag[i] = r.flag; });
  return t;
}

// The entry of that name's data: read as stored (flag 0), inflated (flag 1), or inflated and then BWT-decoded (flag 3, every gump of a 7.x gumpartLegacyMUL.uop; `bwtDecompress`). An inflated entry must come out at its decompressed length. Null when there is no such entry, it does not read, it does not unpack, or it is packed any other way. `maxBytes` caps what is read, inflated or BWT-decoded.
export function readUopEntry(t: UopTable, name: string, read: ReadAt, maxBytes = 1 << 20): Uint8Array | null {
  const i = uopIndex(t, name);
  if (i < 0) return null;
  const flag = t.flag[i]!, stored = t.stored[i]!, size = t.size[i]!;
  if (stored > maxBytes || (flag !== 0 && flag !== 1 && flag !== 3) || (flag !== 0 && size > maxBytes)) return null;
  const data = read(t.at[i]!, stored);
  if (!data || data.length < stored) return null;
  if (flag === 0) return data;
  let out: Uint8Array;
  try { out = inflateSync(data, { maxOutputLength: maxBytes }); } catch { return null; }
  if (out.length !== size) return null;
  return flag === 1 ? out : bwtDecompress(out, maxBytes);
}

// Where the table lists the entry of that name, or -1: whether the file has it, without reading it.
export function uopIndex(t: UopTable, name: string): number {
  const h = uopHash(name);
  let lo = 0, hi = t.hashes.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1, x = t.hashes[mid]!;
    if (x < h) lo = mid + 1;
    else if (x > h) hi = mid - 1;
    else return mid;
  }
  return -1;
}

// The gump of that id in gumpartLegacyMUL.uop.
export const gumpArtName = (id: number): string => `build/gumpartlegacymul/${String(id).padStart(8, "0")}.tga`;

// The BWT stage of a flag 3 UOP entry, a line-by-line port of ClassicUO's BwtDecompress.Decompress (src/ClassicUO.Utility/BwtDecompress.cs at ee79d7e); keep it literal. Null where the C# would throw (fewer than 5 bytes, a read past the input) or answers an empty array (the counts do not sum to a length), and also for a negative count or a length past `maxBytes`, which no real file has.
//
// Stage 1 is a move-to-front decode of everything after a uint32 header. The C# sorts a 65,536-entry table built from the first byte, but that sort always gives 0..65535, so the 256 entries it ever touches start as the identity. It reads one byte ahead, so the last input byte is never decoded and the output's last slot stays 0.
export function bwtDecompress(buf: Uint8Array, maxBytes = 1 << 20): Uint8Array | null {
  if (buf.length < 5) return null;
  const table = new Uint8Array(256);
  for (let i = 0; i < 256; i++) table[i] = i;
  const list = new Uint8Array(buf.length - 4);
  for (let at = 4, i = 0; at + 1 < buf.length; at++) {
    const current = buf[at]!, value = table[current]!;
    table.copyWithin(1, 0, current);
    table[0] = value;
    list[i++] = value;
  }
  return bwtInverse(list, maxBytes);
}

// Stage 2, ClassicUO's InternalDecompress: 256 int32 symbol counts, whose sum is the output length, then each symbol's block, in order of count (highest first, the lowest symbol first on a tie): its place in the starting symbol table, then for each later occurrence how many places on it goes back in.
function bwtInverse(input: Uint8Array, maxBytes: number): Uint8Array | null {
  if (input.length < 1024) return null;
  const symbolTable = new Uint8Array(256);
  for (let i = 0; i < 256; i++) symbolTable[i] = i;
  const partialInput = new Int32Array(256 * 3), v = new DataView(input.buffer, input.byteOffset, input.byteLength);
  let sum = 0, nonZeroCount = 0;
  for (let i = 0; i < 256; i++) {
    const n = v.getInt32(i * 4, true);
    if (n < 0) return null;
    partialInput[i] = n;
    sum += n;
    if (n !== 0) nonZeroCount++;
  }
  if (sum > maxBytes) return null;
  const len = sum, output = new Uint8Array(len);
  const frequency = byCount(partialInput);
  const at = (i: number): number | null => (i + 1024 < input.length ? input[i + 1024]! : null);
  for (let i = 0, m = 0; i < nonZeroCount; ++i) {
    const freq = frequency[i]!, place = at(m);
    if (place === null) return null;
    symbolTable[place] = freq;
    partialInput[freq + 256] = m + 1;
    m += partialInput[freq]!;
    partialInput[freq + 512] = m;
  }
  let val = symbolTable[0]!;
  for (let count = 0; count < len; count++) {
    output[count] = val;
    if (partialInput[val + 256]! >= partialInput[val + 512]!) {
      if (nonZeroCount-- > 0) {
        symbolTable.copyWithin(0, 1, nonZeroCount + 1);
        val = symbolTable[0]!;
      }
    } else {
      const idx = at(partialInput[val + 256]!);
      if (idx === null) return null;
      partialInput[val + 256]!++;
      if (idx !== 0) {
        symbolTable.copyWithin(0, 1, idx + 1);
        symbolTable[idx] = val;
        val = symbolTable[0]!;
      }
    }
  }
  return output;
}

// ClassicUO's Frequency: the symbols with a count, highest count first, the lowest symbol first on a tie.
function byCount(counts: Int32Array): Uint8Array {
  const tmp = counts.slice(0, 256), out = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    let value = 0, index = 0;
    for (let j = 0; j < 256; j++) if (tmp[j]! > value) { index = j; value = tmp[j]!; }
    if (value === 0) break;
    out[i] = index;
    tmp[index] = 0;
  }
  return out;
}

// A gump, as a flag 0 or flag 3 entry unpacks: uint32 width and height, `height` int32 row starts (in 4-byte units from the start of that table), then each row's (uint16 colour, uint16 run) pairs; row y has the pairs up to the next row's start, the last row those up to the end. Colour 0 is transparent and any other is opaque, 0x0001 included (the low 15 bits are RGB555). A run that would spill past its row is cut at the row's end. `pixels` is laid out as StaticArt's, so `toRgba` draws it.
export function decodeGump(buf: Uint8Array): StaticArt | null {
  if (buf.length < 8) return null;
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const width = v.getUint32(0, true), height = v.getUint32(4, true), words = (buf.length - 8) >> 2;
  if (width === 0 || height === 0 || width > MAX_ART_SIDE || height > MAX_ART_SIDE || height > words) return null;
  const pixels = new Uint16Array(width * height), row = (y: number): number => v.getInt32(8 + y * 4, true);
  for (let y = 0; y < height; y++) {
    const start = row(y), end = y < height - 1 ? row(y + 1) : words;
    if (start < height || end < start || end > words) return null;
    for (let k = start, x = 0; k < end && x < width; k++) {
      const colour = v.getUint16(8 + k * 4, true), run = Math.min(v.getUint16(10 + k * 4, true), width - x);
      if (colour !== 0) pixels.fill(0x8000 | (colour & 0x7fff), y * width + x, y * width + x + run);
      x += run;
    }
  }
  return { width, height, pixels };
}

// Item art: an int32, uint16 width and height, `height` uint16 row starts (in 16-bit words from the end of that table), then per row runs of (x skip, run length, `run` ARGB1555 pixels) ending in (0, 0). A pixel of value 0 is transparent. `pixels` is width × height with 0 transparent and anything else opaque (bit 0x8000 set, the colour in the low 15 bits).
export interface StaticArt { width: number; height: number; pixels: Uint16Array }
export const MAX_ART_SIDE = 1024;
export function decodeStatic(buf: Uint8Array): StaticArt | null {
  if (buf.length < 8) return null;
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const width = v.getUint16(4, true), height = v.getUint16(6, true);
  if (width === 0 || height === 0 || width > MAX_ART_SIDE || height > MAX_ART_SIDE) return null;
  const data = 8 + height * 2;
  if (data > buf.length) return null;
  const pixels = new Uint16Array(width * height);
  for (let y = 0; y < height; y++) {
    let at = data + v.getUint16(8 + y * 2, true) * 2, x = 0;
    for (;;) {
      if (at + 4 > buf.length) return null;
      const skip = v.getUint16(at, true), run = v.getUint16(at + 2, true);
      at += 4;
      if (skip === 0 && run === 0) break;
      x += skip;
      if (x + run > width || at + run * 2 > buf.length) return null;
      for (let k = 0; k < run; k++, x++, at += 2) { const c = v.getUint16(at, true); if (c !== 0) pixels[y * width + x] = 0x8000 | (c & 0x7fff); }
    }
  }
  return { width, height, pixels };
}

// hues.mul: groups of 708 bytes, a uint32 header and 8 hues of 32 uint16 colours, a uint16 table start and end and a 20-byte name. Null for a file that is not whole groups.
export interface Hues { buf: Uint8Array; count: number }
const GROUP = 708, HUE = 88;
export function readHues(buf: Uint8Array): Hues | null {
  return buf.length === 0 || buf.length % GROUP !== 0 ? null : { buf, count: (buf.length / GROUP) * 8 };
}
// A hue's 32 colours (15-bit) and whether it is partial (bit 0x8000: only grey pixels take it); null for hue 0 or a number at or past the file's count (ClassicUO's `color < HuesCount`). The hue number is its low 14 bits, 1-based.
export function hueOf(hues: Hues, hue: number): { colours: Uint16Array; partial: boolean } | null {
  const h = hue & 0x3fff;
  if (h === 0 || h >= hues.count) return null;
  const at = Math.floor((h - 1) / 8) * GROUP + 4 + ((h - 1) % 8) * HUE, v = new DataView(hues.buf.buffer, hues.buf.byteOffset, hues.buf.byteLength);
  const colours = new Uint16Array(32);
  for (let k = 0; k < 32; k++) colours[k] = v.getUint16(at + k * 2, true) & 0x7fff;
  return { colours, partial: (hue & 0x8000) !== 0 };
}

// A hue as the paperdoll applies it (issue #57): hueOf's colours, with the partial switch the caller passes instead of the hue's own 0x8000 bit. The body's skin is always partial; a worn item, hair, beard or face is partial only when its tiledata has the partial-hue flag.
export function hueFor(hues: Hues, hue: number, partial: boolean): { colours: Uint16Array; partial: boolean } | null {
  const h = hueOf(hues, hue);
  return h && { colours: h.colours, partial };
}

// An opaque pixel with the hue applied: its 5-bit red channel picks one of the hue's 32 colours, and a partial hue takes only grey pixels (r = g = b). The result keeps the 0x8000 opaque bit.
export function huePixel(p: number, hue: { colours: Uint16Array; partial: boolean } | null): number {
  const r = (p >> 10) & 31;
  return hue && (!hue.partial || (r === ((p >> 5) & 31) && r === (p & 31))) ? 0x8000 | hue.colours[r]! : p;
}

// The smallest box (inclusive corners) holding every opaque pixel, or null when there is none.
export interface Box { x0: number; y0: number; x1: number; y1: number }
export function opaqueBox(art: StaticArt): Box | null {
  let x0 = art.width, y0 = art.height, x1 = -1, y1 = -1;
  for (let y = 0; y < art.height; y++) for (let x = 0; x < art.width; x++) {
    if (art.pixels[y * art.width + x] === 0) continue;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return x1 < 0 ? null : { x0, y0, x1, y1 };
}

// The art as 8-bit RGBA cut to `box` (its opaque box unless given), the hue applied (huePixel). Null when there is no box.
export function toRgba(art: StaticArt, hue: { colours: Uint16Array; partial: boolean } | null = null, box: Box | null = opaqueBox(art)): { width: number; height: number; rgba: Buffer } | null {
  if (!box) return null;
  const width = box.x1 - box.x0 + 1, height = box.y1 - box.y0 + 1, rgba = Buffer.alloc(width * height * 4), to8 = (c: number): number => (c << 3) | (c >> 2);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const sx = x + box.x0, sy = y + box.y0;
    if (sx < 0 || sy < 0 || sx >= art.width || sy >= art.height) continue;
    let p = art.pixels[sy * art.width + sx]!;
    if (p === 0) continue;
    p = huePixel(p, hue);
    const o = (y * width + x) * 4;
    rgba[o] = to8((p >> 10) & 31); rgba[o + 1] = to8((p >> 5) & 31); rgba[o + 2] = to8(p & 31); rgba[o + 3] = 255;
  }
  return { width, height, rgba };
}
