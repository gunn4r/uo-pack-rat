// ui/world-map-model.mts — the world map lightbox's pure rules (issue #164). A view is a box of world tiles (house-map-model's Box) shown in a viewport of screen pixels with the same shape (house-map-model's fit makes it so). It zooms about a point between the whole facet fitted and MAX_PX_PER_TILE, pans by screen pixels, and always keeps the facet in view: a view wider than the facet holds all of it, a narrower one stays inside it. The region it asks the server for is the visible tiles, whole and inside the facet, at screen resolution. No DOM; ui/world-map.mts draws what it returns.
import { fit, whereOf, facetName, type Box, type Pt } from "./house-map-model.mts";
import type { HouseSummary } from "./api-types.mts";

export const MAX_PX_PER_TILE = 2, LABEL_PX_PER_TILE = 0.5, MAX_IMAGE_SIDE = 2048;
export interface Size { width: number; height: number }

export const pxPerTile = (v: Box, vp: Size): number => vp.width / v.w;
export const toScreen = (v: Box, vp: Size, [x, y]: Pt): Pt => [((x - v.x) * vp.width) / v.w, ((y - v.y) * vp.height) / v.h];
export const toWorld = (v: Box, vp: Size, [sx, sy]: Pt): Pt => [v.x + (sx * v.w) / vp.width, v.y + (sy * v.h) / vp.height];

export function clampView(v: Box, facet: Size): Box {
  const along = (a: number, span: number, max: number): number => (span >= max ? Math.min(Math.max(a, max - span), 0) : Math.min(Math.max(a, 0), max - span));
  return { x: along(v.x, v.w, facet.width), y: along(v.y, v.h, facet.height), w: v.w, h: v.h };
}
const fitted = (facet: Size, vp: Size): Box => fit({ x: 0, y: 0, w: facet.width, h: facet.height }, vp);
// The whole facet fitted to the viewport, moved toward the house as far as keeps the facet in view.
export function firstView(facet: Size, vp: Size, [cx, cy]: Pt): Box {
  const f = fitted(facet, vp);
  return clampView({ ...f, x: cx - f.w / 2, y: cy - f.h / 2 }, facet);
}
// f < 1 zooms in, keeping `at` (world tiles) where it is on screen.
export function zoomView(v: Box, f: number, [ax, ay]: Pt, facet: Size, vp: Size): Box {
  const maxW = fitted(facet, vp).w, minW = Math.min(vp.width / MAX_PX_PER_TILE, maxW);
  const k = Math.min(Math.max(f, minW / v.w), maxW / v.w);
  return clampView({ x: ax - (ax - v.x) * k, y: ay - (ay - v.y) * k, w: v.w * k, h: v.h * k }, facet);
}
// A drag of (dx, dy) screen pixels moves the map with the pointer.
export function panView(v: Box, dx: number, dy: number, facet: Size, vp: Size): Box {
  const k = v.w / vp.width;
  return clampView({ ...v, x: v.x - dx * k, y: v.y - dy * k }, facet);
}
// The visible tiles, whole and inside the facet, and the image size that shows them at screen resolution (at most MAX_IMAGE_SIDE on either side); null when none of the facet is in view.
export function overlayRequest(v: Box, vp: Size, facet: Size): { x0: number; y0: number; x1: number; y1: number; size: number } | null {
  const x0 = Math.max(0, Math.floor(v.x)), y0 = Math.max(0, Math.floor(v.y));
  const x1 = Math.min(facet.width, Math.ceil(v.x + v.w)), y1 = Math.min(facet.height, Math.ceil(v.y + v.h));
  if (x0 >= x1 || y0 >= y1) return null;
  const k = pxPerTile(v, vp);
  return { x0, y0, x1, y1, size: Math.min(MAX_IMAGE_SIDE, Math.ceil(Math.max(x1 - x0, y1 - y0) * k)) };
}

// A marker per captured house on the facet whose centre tile is in view (with a marker's margin), at the tile's middle in screen pixels; the house shown last, so it draws on top. Its label shows always for the house shown and, once the map is zoomed to LABEL_PX_PER_TILE, for the others whose label would not overlap one already placed (the house shown's first).
export interface WorldMarker { id: string; sx: number; sy: number; current: boolean; label: string; showLabel: boolean }
const MARGIN = 24, CHAR_PX = 7, LABEL_H = 18, LABEL_GAP = 10;
export function worldMarkers(houses: readonly HouseSummary[], currentId: string | null, facet: number, v: Box, vp: Size): WorldMarker[] {
  const out: WorldMarker[] = [];
  for (const h of houses) {
    if (h.facet !== facet) continue;
    const { centre: [x, y], centreText } = whereOf(h), [sx, sy] = toScreen(v, vp, [x + 0.5, y + 0.5]);
    if (sx < -MARGIN || sy < -MARGIN || sx > vp.width + MARGIN || sy > vp.height + MARGIN) continue;
    out.push({ id: h.id, sx, sy, current: h.id === currentId, label: h.name ?? `${facetName(h.facet)} house at ${centreText}`, showLabel: false });
  }
  out.sort((a, b) => Number(a.current) - Number(b.current));
  const placed: Box[] = [], near = pxPerTile(v, vp) >= LABEL_PX_PER_TILE;
  for (const m of [...out].reverse()) {
    if (!m.current && !near) continue;
    const b = { x: m.sx + LABEL_GAP, y: m.sy - LABEL_H / 2, w: m.label.length * CHAR_PX + 8, h: LABEL_H };
    if (!m.current && placed.some((p) => p.x < b.x + b.w && b.x < p.x + p.w && p.y < b.y + b.h && b.y < p.y + p.h)) continue;
    placed.push(b);
    m.showLabel = true;
  }
  return out;
}
