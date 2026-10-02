// facet-map.mts — the client's facetNN.mul world-map overviews, read from the player's own UO folder (issue #164). One pixel is one world tile. Layout, little-endian: int16 width, int16 height, then per row an int32 byte count followed by byteCount / 3 runs, each a uint8 pixel count and a uint16 ARGB1555 colour; a row's runs add up to the width. Pure: decodeFacet never throws and never reads past the buffer, answers null for any file that does not add up, and keeps no pixel buffer: the file's own bytes and where each row's runs start, so a region is drawn by walking only its rows.

export const MAX_SIDE = 8192;
// rowStart[y]: the offset of row y's first run; the row's runs end where the next row's byte count starts (the last row's at the end of the file).
export interface FacetBitmap { width: number; height: number; buf: Uint8Array; rowStart: Int32Array }
// A region of the facet in tiles, x1 and y1 exclusive.
export interface Region { x0: number; y0: number; x1: number; y1: number }

export function decodeFacet(buf: Uint8Array): FacetBitmap | null {
  if (buf.length < 4) return null;
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const width = view.getInt16(0, true), height = view.getInt16(2, true);
  if (width <= 0 || height <= 0 || width > MAX_SIDE || height > MAX_SIDE) return null;
  // Every row is at least its byte count and enough runs of at most 255 tiles to cover the width.
  if (buf.length < 4 + height * (4 + Math.ceil(width / 255) * 3)) return null;
  const rowStart = new Int32Array(height);
  let at = 4;
  for (let y = 0; y < height; y++) {
    if (at + 4 > buf.length) return null;
    const bytes = view.getInt32(at, true);
    at += 4;
    if (bytes < 0 || bytes % 3 !== 0 || at + bytes > buf.length) return null;
    rowStart[y] = at;
    let x = 0;
    for (const end = at + bytes; at < end; at += 3) {
      x += buf[at]!;
      if (x > width) return null;
    }
    if (x !== width) return null;
  }
  return at === buf.length ? { width, height, buf, rowStart } : null;
}

// The region at most `maxSide` pixels wide and tall (never wider than the region, the page scales it up), the aspect ratio kept, each pixel the average of the tiles it covers, as 8-bit RGB. The region must lie inside the facet. Only the region's rows are read, each from its first run on, skipping the runs that end before x0.
export function renderRegion(f: FacetBitmap, r: Region, maxSide: number): { width: number; height: number; rgb: Buffer } {
  const sw = r.x1 - r.x0, sh = r.y1 - r.y0, cap = Math.max(1, Math.floor(maxSide));
  let width = Math.max(1, Math.min(sw, cap)), height = Math.max(1, Math.round((sh * width) / sw));
  if (height > cap) { height = cap; width = Math.max(1, Math.min(sw, Math.round((sw * cap) / sh))); }
  // Each region column's output column: the box each pixel averages across. Rows are banded the same way below.
  const colOf = new Int32Array(sw);
  for (let ox = 0; ox < width; ox++) colOf.fill(ox, Math.floor((ox * sw) / width), Math.floor(((ox + 1) * sw) / width));
  const rgb = Buffer.alloc(width * height * 3), sums = new Float64Array(width * 4);
  const view = new DataView(f.buf.buffer, f.buf.byteOffset, f.buf.byteLength);
  let oy = 0, bandEnd = Math.floor(sh / height);
  for (let y = r.y0; y < r.y1; y++) {
    const end = y + 1 < f.height ? f.rowStart[y + 1]! - 4 : f.buf.length;
    let x = 0;
    for (let at = f.rowStart[y]!; at < end && x < r.x1; at += 3) {
      const next = x + f.buf[at]!;
      if (next > r.x0) {
        const c = view.getUint16(at + 1, true), red = (c >> 10) & 31, green = (c >> 5) & 31, blue = c & 31;
        for (let t = Math.max(x, r.x0), stop = Math.min(next, r.x1); t < stop; t++) {
          const s = colOf[t - r.x0]! * 4;
          sums[s] = sums[s]! + red; sums[s + 1] = sums[s + 1]! + green; sums[s + 2] = sums[s + 2]! + blue; sums[s + 3] = sums[s + 3]! + 1;
        }
      }
      x = next;
    }
    if (y - r.y0 + 1 < bandEnd) continue;
    for (let ox = 0; ox < width; ox++) {
      const s = ox * 4, n = sums[s + 3]! * 31, o = (oy * width + ox) * 3;
      if (n === 0) continue;
      rgb[o] = Math.round((sums[s]! * 255) / n);
      rgb[o + 1] = Math.round((sums[s + 1]! * 255) / n);
      rgb[o + 2] = Math.round((sums[s + 2]! * 255) / n);
    }
    sums.fill(0);
    oy++;
    bandEnd = Math.floor(((oy + 1) * sh) / height);
  }
  return { width, height, rgb };
}
