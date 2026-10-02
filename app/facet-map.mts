// facet-map.mts — the client's facetNN.mul world-map overviews, read from the player's own UO folder (issue #164). One pixel is one world tile. Layout, little-endian: int16 width, int16 height, then per row an int32 byte count followed by byteCount / 3 runs, each a uint8 pixel count and a uint16 ARGB1555 colour; a row's runs add up to the width. Pure: decodeFacet never throws and never reads past the buffer, and answers null for any file that does not add up.

export interface FacetBitmap { width: number; height: number; pixels: Uint16Array }
// A region of the facet in tiles, x1 and y1 exclusive.
export interface Region { x0: number; y0: number; x1: number; y1: number }

export function decodeFacet(buf: Uint8Array): FacetBitmap | null {
  if (buf.length < 4) return null;
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const width = view.getInt16(0, true), height = view.getInt16(2, true);
  if (width <= 0 || height <= 0) return null;
  const pixels = new Uint16Array(width * height);
  let at = 4;
  for (let y = 0; y < height; y++) {
    if (at + 4 > buf.length) return null;
    const bytes = view.getInt32(at, true);
    at += 4;
    if (bytes < 0 || bytes % 3 !== 0 || at + bytes > buf.length) return null;
    let x = 0;
    for (const end = at + bytes; at < end; at += 3) {
      const n = buf[at]!, colour = view.getUint16(at + 1, true);
      if (x + n > width) return null;
      pixels.fill(colour, y * width + x, y * width + x + n);
      x += n;
    }
    if (x !== width) return null;
  }
  return at === buf.length ? { width, height, pixels } : null;
}

// The region at most `maxWidth` pixels wide (never wider than the region, the page scales it up), the aspect ratio kept, each pixel the average of the tiles it covers, as 8-bit RGB. The region must lie inside the facet.
export function renderRegion(f: FacetBitmap, r: Region, maxWidth: number): { width: number; height: number; rgb: Buffer } {
  const sw = r.x1 - r.x0, sh = r.y1 - r.y0;
  const width = Math.max(1, Math.min(sw, Math.floor(maxWidth))), height = Math.max(1, Math.round((sh * width) / sw));
  const rgb = Buffer.alloc(width * height * 3);
  for (let oy = 0; oy < height; oy++) {
    const ya = r.y0 + Math.floor((oy * sh) / height), yb = Math.max(ya + 1, r.y0 + Math.floor(((oy + 1) * sh) / height));
    for (let ox = 0; ox < width; ox++) {
      const xa = r.x0 + Math.floor((ox * sw) / width), xb = Math.max(xa + 1, r.x0 + Math.floor(((ox + 1) * sw) / width));
      let red = 0, green = 0, blue = 0;
      for (let y = ya; y < yb; y++) for (let x = xa; x < xb; x++) {
        const c = f.pixels[y * f.width + x]!;
        red += (c >> 10) & 31; green += (c >> 5) & 31; blue += c & 31;
      }
      const n = (yb - ya) * (xb - xa), o = (oy * width + ox) * 3;
      rgb[o] = Math.round((red * 255) / (31 * n));
      rgb[o + 1] = Math.round((green * 255) / (31 * n));
      rgb[o + 2] = Math.round((blue * 255) / (31 * n));
    }
  }
  return { width, height, rgb };
}
