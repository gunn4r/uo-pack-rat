// house-areas.mts — the player's areas on the House map (issue #10, house-map.json): which area a stack of containers sits in. Pure, page and server alike: the House map draws by it (app/ui/house-map-model.mts) and MCP's list_containers reports it.
export interface AreaTiles { x0: number; y0: number; x1: number; y1: number }
// Rectangles of world tiles, inclusive.
export const inRects = (rects: readonly AreaTiles[], x: number, y: number): boolean => rects.some((r) => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1);
// The area a stack belongs to: the first, in list order, on its level whose rectangles hold its tile; null for the rest.
export const areaOfStack = <A extends { level: number; rects: readonly AreaTiles[] }>(areas: readonly A[], s: { level: number; x: number; y: number }): A | null => areas.find((a) => a.level === s.level && inRects(a.rects, s.x, s.y)) ?? null;
