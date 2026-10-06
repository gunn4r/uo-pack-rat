// houses.mts — the house map's client files and models (issues #10, #164): the UO folder, its tiledata.mul and facetNN.mul, the facet PNGs cut from them, and the house models built from the inventory, each kept while its inputs stay the same.
import { readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { badPathShape } from "../installer.mts";
import { uoFolderFromTazuo, loadTileData, type TileData } from "../tiledata.mts";
import { decodeFacet, type FacetBitmap } from "../facet-map.mts";
import { buildHouseModel, type HouseContainerInput, type HouseModel } from "../house-model.mts";
import type { HouseSource } from "../house-capture.mts";
import type { Inventory } from "../vault-lib.mts";
import type { SettingsDoc } from "../store/settings.mts";

// `settings` is the settings this run uses, read on every call: the UO folder and the client come from it.
export function createHousesService({ settings }: { settings: () => SettingsDoc }) {
  // Where the house map's tiledata.mul comes from (issue #10): the UO folder set in Settings wins; else, with TazUO the chosen client, the folder its launcher profile names. `reason` says why there is none, for the page to put in words: the folder set here lost its tiledata.mul (or, hand-edited into settings.json, is not an absolute non-UNC path: refused on its shape before any filesystem call, as PUT /api/settings does, and not passed over for the automatic one, since the player chose a folder), no client to look through, no TazUO profile naming one, or a file that is not a 7.x tiledata.mul.
  interface TileDataFrom { td: TileData | null; folder: string | null; source: "settings" | "tazuo-profile" | null; reason: null | "override-missing" | "no-client" | "no-tazuo-profile" | "unreadable" }
  type UoFolder = { folder: string; source: "settings" | "tazuo-profile" } | { folder: null; reason: "override-missing" | "no-client" | "no-tazuo-profile" };
  function uoFolder(): UoFolder {
    const o = settings().uoFolder;
    if (o != null && o !== "") return typeof o !== "string" || badPathShape(o) ? { folder: null, reason: "override-missing" } : { folder: o, source: "settings" };
    const c = settings().client;
    if (!c || c.adapter !== "tazuo") return { folder: null, reason: "no-client" };
    const uo = uoFolderFromTazuo(c.scriptsDir);
    return uo ? { folder: uo, source: "tazuo-profile" } : { folder: null, reason: "no-tazuo-profile" };
  }
  function houseTileData(): TileDataFrom {
    const at = uoFolder();
    if (at.folder === null) return { td: null, folder: null, source: null, reason: at.reason };
    const path = join(at.folder, "tiledata.mul"), td = loadTileData(path);
    return { td, folder: at.folder, source: at.source, reason: td ? null : at.source === "settings" && !existsSync(path) ? "override-missing" : "unreadable" };
  }
  // The facet overview (issue #164): the UO folder's facetNN.mul, checked once while the file stays the same and kept per facet as the file's own bytes and its row starts (all six together are about 30 MB), and the PNGs cut from them kept by facet file, region and size up to 32 MB in all, the oldest dropped first. Never written to disk. `reason` says why there is none, the folder never: a folder set in Settings that is gone reads as override-missing, as it does for tiledata.mul.
  const facetMemo = new Map<number, { key: string; bitmap: FacetBitmap | null }>();
  const facetPngs = new Map<string, Buffer>();
  let facetPngBytes = 0;
  const FACET_MAX_BYTES = 64 * 1024 * 1024, FACET_PNG_BYTES = 32 * 1024 * 1024;
  function facetBitmap(facet: number): { bitmap: FacetBitmap; key: string } | { reason: string } {
    const at = uoFolder();
    if (at.folder === null) return { reason: at.reason };
    if (at.source === "settings") { try { if (!statSync(at.folder).isDirectory()) return { reason: "override-missing" }; } catch { return { reason: "override-missing" }; } }
    const path = join(at.folder, `facet0${facet}.mul`);
    let key: string;
    try { const st = statSync(path); if (!st.isFile()) return { reason: "missing" }; if (st.size > FACET_MAX_BYTES) return { reason: "unreadable" }; key = `${path}:${st.mtimeMs}:${st.size}`; } catch { return { reason: "missing" }; }
    let memo = facetMemo.get(facet);
    if (memo?.key !== key) {
      let bitmap: FacetBitmap | null;
      try { bitmap = decodeFacet(readFileSync(path)); } catch { bitmap = null; }
      memo = { key, bitmap };
      facetMemo.set(facet, memo);
    }
    return memo.bitmap ? { bitmap: memo.bitmap, key } : { reason: "unreadable" };
  }
  function facetPng(key: string, make: () => Buffer): Buffer {
    let out = facetPngs.get(key);
    if (out) return out;
    out = make();
    for (const [k, v] of facetPngs) { if (facetPngBytes + out.length <= FACET_PNG_BYTES) break; facetPngs.delete(k); facetPngBytes -= v.length; }
    facetPngs.set(key, out);
    facetPngBytes += out.length;
    return out;
  }
  // Built house models, kept while the served inventory (a new object whenever the scans, the item kinds or the overlay change; the houses come from the same fold) and the tiledata (loadTileData answers the same object until the file changes) stay the same. The ground chests are the inventory's ground roots with a position, as Organize picks them.
  let houseMemo: { inv: Inventory | null; td: TileData | null; ground: HouseContainerInput[]; models: Map<string, HouseModel> } = { inv: null, td: null, ground: [], models: new Map() };
  function houseModel(inv: Inventory, house: HouseSource, td: TileData | null): HouseModel {
    if (houseMemo.inv !== inv || houseMemo.td !== td) {
      const ground = Object.values(inv.containers).flatMap((c) => (c.parent == null && c.kind === "ground" && c.pos && Number.isFinite(c.pos.x) && Number.isFinite(c.pos.y))
        ? [{ serial: c.serial, name: c.name ?? "", facet: c.pos.facet ?? null, x: c.pos.x!, y: c.pos.y!, z: c.pos.z ?? 0, opened: true }] : []);
      houseMemo = { inv, td, ground, models: new Map() };
    }
    let m = houseMemo.models.get(house.id);
    if (!m) {
      // The chests this house's captures saw that no scan has opened: on the map from the first scan, named from tiledata, as not opened yet. A chest the fold knows is drawn from the fold. The fold and Organize never see these; retention keeps the captures that contribute them.
      const seen = house.containers.flatMap(([serial, graphic, x, y, z]) => inv.containers[String(serial)] ? [] : [{ serial, name: td?.info(graphic)?.name || "container", facet: house.facet, x, y, z, opened: false }]);
      m = buildHouseModel(house, td, [...houseMemo.ground, ...seen]);
      houseMemo.models.set(house.id, m);
    }
    return m;
  }
  return { tileData: houseTileData, facetBitmap, facetPng, model: houseModel };
}
export type HousesService = ReturnType<typeof createHousesService>;
