// house-capture.mts — the houses the scans have captured (issue #10). A scan taken inside a house carries a
// `house` section: the house's own tiles (every level, read from anywhere inside) and the furniture the
// server had sent (within about 18 tiles of the player). The newest capture of a house gives its tiles;
// furniture is merged across captures, so a castle fills in from scans at different spots.
import type { ScanV2 } from "./schema/types.d.mts";

export type HouseTile = [graphic: number, x: number, y: number, z: number, impassable: number];
export type HouseItem = [serial: number, graphic: number, x: number, y: number, z: number];
export interface HouseSource { id: string; facet: number | null; capturedAt: string; tiles: HouseTile[]; items: HouseItem[]; captures: number }
export const HOUSE_ITEM_REACH = 18;

// A capture time as a sortable number; a malformed one sorts as the oldest.
export const captureTime = (capturedAt: string): number => { const t = Date.parse(capturedAt); return Number.isFinite(t) ? t : -Infinity; };

export function houseIdOf(facet: number | null | undefined, tiles: HouseTile[]): string {
  let x = Infinity, y = Infinity;
  for (const t of tiles) { if (t[1] < x) x = t[1]; if (t[2] < y) y = t[2]; }
  return `${facet ?? "x"}-${x}-${y}`;
}

export function latestHouses(scans: ScanV2[]): HouseSource[] {
  const groups = new Map<string, Array<NonNullable<ScanV2["house"]>>>();
  for (const s of scans) {
    const h = s.house;
    if (!h || !h.tiles.length) continue;
    const id = houseIdOf(h.facet, h.tiles as HouseTile[]);
    groups.set(id, [...(groups.get(id) ?? []), h]);
  }
  const out: HouseSource[] = [];
  for (const [id, caps] of groups) {
    caps.sort((a, b) => captureTime(a.capturedAt) - captureTime(b.capturedAt));
    const items = new Map<number, HouseItem>();
    for (const c of caps) {
      for (const [serial, it] of items) if (Math.max(Math.abs(it[2] - c.at.x), Math.abs(it[3] - c.at.y)) <= HOUSE_ITEM_REACH) items.delete(serial);
      for (const it of c.items as HouseItem[]) items.set(it[0], it);
    }
    const last = caps[caps.length - 1]!;
    out.push({ id, facet: last.facet ?? null, capturedAt: last.capturedAt, tiles: last.tiles as HouseTile[], items: [...items.values()].sort((a, b) => a[0] - b[0]), captures: caps.length });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}
