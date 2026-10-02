// facet-fixture.mts — builds a synthetic facetNN.mul for tests (no game data ships in the repo): the int16 width and height, then per row an int32 byte count and its runs, each a uint8 pixel count and a uint16 ARGB1555 colour. `rows` are written as given, so a test can make a row that does not add up.
export type Run = [count: number, colour: number];

export function syntheticFacet(width: number, height: number, rows: Run[][]): Buffer {
  const parts: Buffer[] = [];
  const head = Buffer.alloc(4);
  head.writeInt16LE(width, 0);
  head.writeInt16LE(height, 2);
  parts.push(head);
  for (const runs of rows) {
    const row = Buffer.alloc(4 + runs.length * 3);
    row.writeInt32LE(runs.length * 3, 0);
    runs.forEach(([n, c], i) => { row[4 + i * 3] = n; row.writeUInt16LE(c, 5 + i * 3); });
    parts.push(row);
  }
  return Buffer.concat(parts);
}

// ARGB1555 from 5-bit red, green and blue.
export const rgb555 = (r: number, g: number, b: number): number => (r << 10) | (g << 5) | b;
