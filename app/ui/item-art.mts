// ui/item-art.mts — an item's or a container's in-game art (issues #174, #503), drawn from the player's own client files through GET /api/item-art: an <img> in a square tile of the given size, scaled down to fit, or twice its size (pixelated) when that still fits (art under 16 px both ways in a 32 px tile), so a pouch still reads as a pouch. When the art does not load (no UO folder, no art for the graphic), `fallback` takes the tile's place, or nothing does: the tile goes, with no empty box left holding its space (issue #556). That URL is not asked again until the page reloads or the UO folder is saved in Settings, so a redraw shows the fallback at once and never a broken image.
//
// map: house
// owns: `artTile`, `artUrl`, `containerArt`, `artWaiting`
import { state } from "./store.mts";

export const artUrl = (graphic: number, hue = 0): string => `/api/item-art/${graphic}.png${hue ? `?hue=${hue}` : ""}`;
const missing = new Set<string>();
// Ask again for every art that failed: the UO folder was just set (Settings calls this after a save).
export const forgetMissingArt = (): void => { missing.clear(); };

// Built without dom.mts's el(): dom.mts's tooltip draws this art, and the two importing each other would be a cycle.
function tileOf(size: 24 | 32, more = ""): HTMLElement {
  const tile = document.createElement("span");
  tile.className = `art-tile art-${size}${more}`;
  tile.setAttribute("aria-hidden", "true");
  return tile;
}
// An empty tile holding the art's place while its graphic is still being looked up, so the art arriving does not shift what follows.
export const artWaiting = (size: 24 | 32): HTMLElement => tileOf(size, " art-none");
// `badge`: drawn in the tile's corner (the chest's color swatch on the House map), and kept as the fallback when there is no art.
export function artTile(graphic: number | null | undefined, opts: { size: 24 | 32; hue?: number; badge?: HTMLElement | null }): HTMLElement | null {
  const fallback = opts.badge ?? null;
  if (graphic == null) return fallback;
  const url = artUrl(graphic, opts.hue);
  if (missing.has(url)) return fallback;
  const img = document.createElement("img");
  img.className = "art-img";
  img.setAttribute("src", url);
  img.setAttribute("alt", "");
  img.setAttribute("draggable", "false");
  const tile = tileOf(opts.size);
  tile.append(img);
  if (fallback) tile.append(fallback);
  img.addEventListener("load", () => {
    if (2 * Math.max(img.naturalWidth, img.naturalHeight) <= opts.size) { img.classList.add("art-2x"); img.style.width = `${img.naturalWidth * 2}px`; }
  });
  img.addEventListener("error", () => {
    missing.add(url);
    if (fallback) tile.replaceWith(fallback); else tile.remove();
  });
  return tile;
}

// A scanned container's art by its serial, from the graphic and hue its scan recorded; `badge` alone (or nothing) for a container scanned before the adapters recorded them.
export function containerArt(serial: number | null | undefined, size: 24 | 32, badge: HTMLElement | null = null): HTMLElement | null {
  const c = serial == null ? undefined : state.inv?.containers[String(serial)];
  return artTile(c?.graphic, { size, hue: c?.hue ?? 0, badge });
}
