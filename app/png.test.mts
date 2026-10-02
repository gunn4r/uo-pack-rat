// png.test.mts — app/png.mts (issue #164): the PNG signature, the IHDR fields, every chunk's CRC, and a tiny image's IDAT inflated back to its filtered rows. Tags: [fast]. Run: node --test app/png.test.mts
import { test } from "node:test";
import assert from "node:assert/strict";
import { inflateSync } from "node:zlib";
import { encodePng, crc32 } from "./png.mts";

function chunks(png: Buffer): Array<{ type: string; data: Buffer; crc: number }> {
  const out = [];
  for (let at = 8; at < png.length;) {
    const len = png.readUInt32BE(at), type = png.toString("latin1", at + 4, at + 8);
    out.push({ type, data: png.subarray(at + 8, at + 8 + len), crc: png.readUInt32BE(at + 8 + len) });
    at += 12 + len;
  }
  return out;
}

test("[fast] png: crc32 matches the standard check value", () => {
  assert.equal(crc32(Buffer.from("123456789")), 0xcbf43926);
});

test("[fast] png: signature, IHDR, IDAT and IEND, each chunk's CRC over its type and data", () => {
  const rgb = Buffer.from([255, 0, 0, 0, 255, 0, 0, 0, 255, 10, 20, 30, 40, 50, 60, 70, 80, 90]);
  const png = encodePng(3, 2, rgb);
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  const cs = chunks(png);
  assert.deepEqual(cs.map((c) => c.type), ["IHDR", "IDAT", "IEND"]);
  for (const c of cs) assert.equal(c.crc, crc32(Buffer.concat([Buffer.from(c.type, "latin1"), c.data])), c.type);
  const ihdr = cs[0]!.data;
  assert.equal(ihdr.length, 13);
  assert.equal(ihdr.readUInt32BE(0), 3, "width");
  assert.equal(ihdr.readUInt32BE(4), 2, "height");
  assert.deepEqual([...ihdr.subarray(8)], [8, 2, 0, 0, 0], "8-bit RGB, deflate, no filter method, no interlace");
  assert.deepEqual([...inflateSync(cs[1]!.data)], [0, ...rgb.subarray(0, 9), 0, ...rgb.subarray(9)], "each row led by filter type 0");
  assert.equal(cs[2]!.data.length, 0);
});

test("[fast] png: refuses pixel data of the wrong length", () => {
  assert.throws(() => encodePng(2, 2, Buffer.alloc(11)), /12 bytes/);
});
