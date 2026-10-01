// tiledata-fixture.mts — builds a synthetic 7.x tiledata.mul for tests (no game data ships in the repo). The buffer holds the land block and as many item blocks as the highest graphic asked for needs.
import { LAND_BYTES, ITEM_BLOCK, itemOffset } from "./tiledata.mts";

export interface FixtureTile { graphic: number; flags: bigint; height?: number; name?: string; layer?: number }

export function syntheticTileData(entries: FixtureTile[]): Buffer {
  const top = Math.max(31, ...entries.map((e) => e.graphic));
  const buf = Buffer.alloc(LAND_BYTES + Math.ceil((top + 1) / 32) * ITEM_BLOCK);
  for (const e of entries) {
    const at = itemOffset(e.graphic);
    buf.writeBigUInt64LE(e.flags, at);
    buf[at + 9] = e.layer ?? 0;
    buf[at + 20] = e.height ?? 0;
    buf.write((e.name ?? "").slice(0, 20), at + 21, "latin1");
  }
  return buf;
}
