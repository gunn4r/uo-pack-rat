// png.mts — a minimal PNG encoder on node built-ins (issue #164): 8-bit RGB (or RGBA, issue #174), no interlace, every row filter type 0, one IDAT deflated by node:zlib, chunk CRCs from the table below. Enough for the facet overview the house map shows and the item art; no dependency.
//
// map: house
// owns: `encodePng`, `encodePngRgba`, `crc32`
import { deflateSync } from "node:zlib";

const TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
export function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of buf) c = TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "latin1");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

// rgb: width * height * 3 bytes, rows top first.
export const encodePng = (width: number, height: number, rgb: Uint8Array): Buffer => encode(width, height, rgb, 3, 2, "RGB");
// rgba: width * height * 4 bytes, rows top first, not premultiplied.
export const encodePngRgba = (width: number, height: number, rgba: Uint8Array): Buffer => encode(width, height, rgba, 4, 6, "RGBA");

function encode(width: number, height: number, px: Uint8Array, channels: number, colourType: number, what: string): Buffer {
  const stride = width * channels;
  if (px.length !== stride * height) throw new Error(`a ${width} x ${height} ${what} image is ${stride * height} bytes, not ${px.length}`);
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) raw.set(px.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = colourType;   // 2 RGB, 6 RGBA
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
