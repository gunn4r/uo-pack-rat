// ui/sextant.mts — the UO sextant reading of a world tile (issue #164), as the client computes it: TazUO's src/ClassicUO.Client/Game/Data/Sextant.cs (Format and ComputeMapDetails, at PlayTazUO/TazUO@ccf1e57, itself after ServUO's Scripts/Items/Tools/Sextant.cs). Every facet measures from Lord British's throne (1323, 1624) on a 5120 x 4096 world, inside the facet's default size (ClassicUO.Assets MapLoader.MapsDefaultSize); Felucca's and Trammel's lost lands (x 5120-6143, y 2304-4095) measure from their own centre (5936, 3112), and the rest of those two facets east of 5120 has no reading. Pure: no DOM.

// Each facet's size in tiles (0 Felucca, 1 Trammel, 2 Ilshenar, 3 Malas, 4 Tokuno, 5 Ter Mur).
export const FACET_SIZE: ReadonlyArray<readonly [number, number]> = [[7168, 4096], [7168, 4096], [2304, 1600], [2560, 2048], [1448, 1448], [1280, 4096]];
const WORLD_W = 5120, WORLD_H = 4096;

export interface Sextant { lat: number; latMin: number; south: boolean; long: number; longMin: number; east: boolean }

function centreOf(facet: number, x: number, y: number): readonly [number, number] | null {
  const size = FACET_SIZE[facet];
  if (!size || x < 0 || y < 0 || x >= size[0] || y >= size[1]) return null;
  if (facet > 1) return [1323, 1624];
  if (x < WORLD_W) return [1323, 1624];
  if (x < 6144 && y >= 2304) return [5936, 3112];
  return null;
}

// The reading, or null where the client shows none (an unknown facet, a tile outside the facet, Felucca's or Trammel's east outside the lost lands).
export function sextant(facet: number | null, x: number, y: number): Sextant | null {
  if (facet == null || !Number.isInteger(facet) || !Number.isInteger(x) || !Number.isInteger(y)) return null;
  const c = centreOf(facet, x, y);
  if (!c) return null;
  let long = ((x - c[0]) * 360) / WORLD_W, lat = ((y - c[1]) * 360) / WORLD_H;
  if (long > 180) long = -180 + (long % 180);
  if (lat > 180) lat = -180 + (lat % 180);
  const east = long >= 0, south = lat >= 0;
  long = Math.abs(long);
  lat = Math.abs(lat);
  return { lat: Math.trunc(lat), latMin: Math.trunc((lat % 1) * 60), south, long: Math.trunc(long), longMin: Math.trunc((long % 1) * 60), east };
}

const mm = (n: number): string => String(n).padStart(2, "0");
export const sextantText = (s: Sextant): string => `${s.lat}°${mm(s.latMin)}'${s.south ? "S" : "N"} ${s.long}°${mm(s.longMin)}'${s.east ? "E" : "W"}`;
