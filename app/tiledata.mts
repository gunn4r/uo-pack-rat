// tiledata.mts — the client's tiledata.mul, read from the player's own UO folder (issue #10). The client files every item graphic with flags (wall, window, door, roof, surface, impassable, stairs…), a height and a name; the house map draws a house's tiles and furniture from them, exactly as the game decides what blocks movement. 7.x ("high seas") layout only: 512 land blocks of 32 x 30 bytes, then item blocks of 32 x 41 bytes, each block led by a 4-byte header. An item entry is flags (8 bytes), weight (1), layer (1), count (4), anim (2), hue (2), light (2), height (1), name (20, latin1, NUL-padded). scripts/gen-graphic-layers.mts reads the same layout for the wearable-graphic table.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export const LAND_BYTES = 512 * (4 + 32 * 30);
export const ITEM_BYTES = 41;
export const ITEM_BLOCK = 4 + 32 * ITEM_BYTES;
export const FLAG = {
  background: 0x1n, wall: 0x10n, impassable: 0x40n, surface: 0x200n, bridge: 0x400n, window: 0x1000n,
  wearable: 0x400000n, roof: 0x10000000n, door: 0x20000000n, stairBack: 0x40000000n, stairRight: 0x80000000n,
} as const;

export function itemOffset(graphic: number): number {
  return LAND_BYTES + Math.floor(graphic / 32) * ITEM_BLOCK + 4 + (graphic % 32) * ITEM_BYTES;
}

export function assertItemLayout(buf: Buffer): void {
  if (buf.length <= LAND_BYTES || (buf.length - LAND_BYTES) % ITEM_BLOCK !== 0) throw new Error(`not a 7.x tiledata.mul (${buf.length} bytes)`);
}

export interface TileInfo { flags: bigint; height: number; name: string }
export interface TileData { count: number; info(graphic: number): TileInfo | null }

export function readTileData(buf: Buffer): TileData {
  assertItemLayout(buf);
  const count = ((buf.length - LAND_BYTES) / ITEM_BLOCK) * 32;
  const seen = new Map<number, TileInfo>();
  return {
    count,
    info(graphic: number): TileInfo | null {
      if (!Number.isInteger(graphic) || graphic < 0 || graphic >= count) return null;
      let t = seen.get(graphic);
      if (!t) {
        const at = itemOffset(graphic);
        const raw = buf.subarray(at + 21, at + 41), end = raw.indexOf(0);
        t = { flags: buf.readBigUInt64LE(at), height: buf[at + 20]!, name: raw.subarray(0, end < 0 ? 20 : end).toString("latin1").trim() };
        seen.set(graphic, t);
      }
      return t;
    },
  };
}

export type TileClass = "door" | "stair" | "roof" | "window" | "wall" | "floor" | "block" | "other";

// How the house map draws a tile. `impassable` is the client's own flag on a house tile, the only thing known about it when no tiledata.mul was found.
export function classify(t: TileInfo | null, impassable: boolean): TileClass {
  if (!t) return impassable ? "wall" : "floor";
  const has = (bit: bigint): boolean => (t.flags & bit) !== 0n;
  if (has(FLAG.door)) return "door";
  if (has(FLAG.stairBack) || has(FLAG.stairRight) || /stair/i.test(t.name)) return "stair";
  if (has(FLAG.roof)) return "roof";
  if (has(FLAG.window)) return "window";
  if (has(FLAG.wall)) return "wall";
  if (has(FLAG.surface)) return "floor";
  if (has(FLAG.impassable)) return "block";
  return "other";
}

// The UO folder TazUO's launcher was pointed at, from <launcher root>/Profiles/Settings/*.json, the first (newest profile first) whose folder holds a tiledata.mul. `scriptsDir` is <launcher root>/TazUO/LegionScripts.
export function uoFolderFromTazuo(scriptsDir: string): string | null {
  const dir = join(scriptsDir, "..", "..", "Profiles", "Settings");
  let names: string[];
  try { names = readdirSync(dir).filter((f) => f.endsWith(".json")); } catch { return null; }
  const byAge = names.map((f) => { try { return { f, t: statSync(join(dir, f)).mtimeMs }; } catch { return { f, t: 0 }; } }).sort((a, b) => b.t - a.t);
  for (const { f } of byAge) {
    try {
      const doc = JSON.parse(readFileSync(join(dir, f), "utf8").replace(/^\ufeff/, "")) as { ultimaonlinedirectory?: unknown };
      const uo = doc.ultimaonlinedirectory;
      if (typeof uo === "string" && uo && existsSync(join(uo, "tiledata.mul"))) return uo;
    } catch { /* an unreadable profile is passed over */ }
  }
  return null;
}

let cached: { key: string; value: TileData | null } | null = null;
export function loadTileData(path: string): TileData | null {
  let key: string;
  try { const st = statSync(path); if (!st.isFile()) return null; key = `${path}:${st.mtimeMs}:${st.size}`; } catch { return null; }
  if (cached?.key === key) return cached.value;
  let value: TileData | null;
  try { value = readTileData(readFileSync(path)); } catch { value = null; }
  cached = { key, value };
  return value;
}
