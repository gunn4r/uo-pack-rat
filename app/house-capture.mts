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

export type HouseCapture = NonNullable<ScanV2["house"]>;
export interface HouseGroup { id: string; captures: Array<{ scan: number; house: HouseCapture }>; items: Map<number, { item: HouseItem; scan: number }>; superseded: boolean }

// Every house the scans captured, by id: its captures oldest first (`scan` indexes `scans`; equal times keep the scans' order), its furniture merged across them with the capture each piece last came from, and whether it is superseded: a newer capture of another footprint on the same facet (an unknown facet matches only an unknown one) overlaps its newest one's bounding box, so it was redesigned or moved. A capture with no `items` (the ground could not be read) erases nothing and adds nothing. latestHouses and retention (app/retention.mts) both read houses through here.
export function houseGroups(scans: ScanV2[]): HouseGroup[] {
  const byId = new Map<string, HouseGroup>();
  scans.forEach((s, scan) => {
    const h = s.house;
    if (!h || !h.tiles.length) return;
    const id = houseIdOf(h.facet, h.tiles as HouseTile[]);
    const g: HouseGroup = byId.get(id) ?? { id, captures: [], items: new Map(), superseded: false };
    g.captures.push({ scan, house: h }); byId.set(id, g);
  });
  const groups = [...byId.values()];
  for (const g of groups) {
    g.captures.sort((a, b) => captureTime(a.house.capturedAt) - captureTime(b.house.capturedAt));
    for (const { scan, house: c } of g.captures) {
      if (!c.items) continue;
      for (const [serial, { item: it }] of g.items) if (Math.max(Math.abs(it[2] - c.at.x), Math.abs(it[3] - c.at.y)) <= HOUSE_ITEM_REACH) g.items.delete(serial);
      for (const it of c.items as HouseItem[]) g.items.set(it[0], { item: it, scan });
    }
  }
  const boxOf = (h: HouseCapture): { facet: number | null; t: number; x0: number; y0: number; x1: number; y1: number } => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const t of h.tiles) { if (t[1]! < x0) x0 = t[1]!; if (t[1]! > x1) x1 = t[1]!; if (t[2]! < y0) y0 = t[2]!; if (t[2]! > y1) y1 = t[2]!; }
    return { facet: h.facet ?? null, t: captureTime(h.capturedAt), x0, y0, x1, y1 };
  };
  const boxes = groups.map((g) => ({ g, all: g.captures.map((c) => boxOf(c.house)) }));
  for (const { g, all } of boxes) {
    const last = all[all.length - 1]!;
    g.superseded = boxes.some((o) => o.g !== g && o.all.some((b) => b.facet === last.facet && b.t > last.t && b.x0 <= last.x1 && last.x0 <= b.x1 && b.y0 <= last.y1 && last.y0 <= b.y1));
  }
  return groups;
}

// The houses to serve: each one not superseded, with its newest capture's tiles and its merged furniture.
export function latestHouses(scans: ScanV2[]): HouseSource[] {
  return houseGroups(scans).filter((g) => !g.superseded).map((g) => {
    const last = g.captures[g.captures.length - 1]!.house;
    return { id: g.id, facet: last.facet ?? null, capturedAt: last.capturedAt, tiles: last.tiles as HouseTile[], items: [...g.items.values()].map((v) => v.item).sort((a, b) => a[0] - b[0]), captures: g.captures.length };
  }).sort((a, b) => a.id.localeCompare(b.id));
}
