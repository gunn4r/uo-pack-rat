// cliloc.mts — the client's Cliloc.enu (the game's own strings by number), as ClassicUO's ClilocLoader.ReadCliloc reads it: BWT-packed when its byte 3 is 0x8E (app/art.mts bwtDecompress), then a 6-byte header and entries of int32 number, a flag byte, int16 length and that many bytes of UTF-8. Pure: the caller reads the file.
//
// map: house
// owns: `readCliloc`
import { bwtDecompress } from "./art.mts";

// The strings of the numbers in `wanted`, or null for a file that does not unpack or whose entries run past its end. `maxBytes` caps the unpacked size (7.0.117's is about 5 MB).
export function readCliloc(buf: Uint8Array, wanted: ReadonlySet<number>, maxBytes = 32 << 20): Map<number, string> | null {
  const data = buf.length > 3 && buf[3] === 0x8e ? bwtDecompress(buf, maxBytes) : buf;
  if (!data || data.length < 6) return null;
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength), out = new Map<number, string>(), utf8 = new TextDecoder();
  for (let at = 6; at < data.length;) {
    if (at + 7 > data.length) return null;
    const id = v.getInt32(at, true), length = v.getInt16(at + 5, true);
    if (length < 0 || at + 7 + length > data.length) return null;
    if (wanted.has(id)) out.set(id, utf8.decode(data.subarray(at + 7, at + 7 + length)));
    at += 7 + length;
  }
  return out;
}
