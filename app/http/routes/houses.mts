// houses.mts — the house map: GET /api/houses[/<id>], GET /api/facet-map/<facet>.png, GET /api/item-art/<graphic>.png, GET /api/house-map, PUT /api/house-map/<id>, GET /api/house-claims and DELETE /api/house-claims/<id>.
//
// The routes, what each takes and answers:
// - `GET /api/houses` (the houses scans captured: app/house-capture.mts, each with its container serials, only those a claim covers (issue #299); tiledataFrom says where tiledata.mul came from, or why there is none)
// - `GET /api/houses/<id>` (one house's model: app/house-model.mts, tiledata.mul via app/tiledata.mts or the uoFolder setting)
// - `GET /api/facet-map/<facet>.png?x0&y0&x1&y1&w` (x-region: the region drawn, slid inside the facet; a facet overview from the same UO folder's facetNN.mul: app/facet-map.mts, app/png.mts; 404 {reason} when there is none)
// - `GET /api/item-art/<graphic>.png?hue=<n>` (issue #174: an item's art from the same UO folder's artLegacyMUL.uop and hues.mul, cut to its opaque box, as an RGBA PNG: app/art.mts, app/png.mts; graphic and hue 0 to 65535 or a 400; an ETag over the files' stamps, the graphic and the hue, a 304 on If-None-Match; 404 {reason}: no-client, no-tazuo-profile, override-missing, missing, unreadable or no-art, never the path)
// - `GET /api/house-map`
// - `PUT /api/house-map/<id>` {name, bounds?, areas?} (`<data>/house-map.json`, the player's house names and drawn areas: app/house-names.mts; an empty name with no areas removes the entry; 400 on a bad name, area or id, 409 when a change would grow it past 500 names or 1 MB)
// - `GET /api/house-claims`
// - `DELETE /api/house-claims/<id>` (issue #299: unclaims that house, removing the claim of its id and every claim its bounds overlap on its facet, so it leaves the House map; 400 on a malformed id)
//
// map: server
// owns: `routes`
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DATA_DIR_MODE } from "../../config.mts";
import { renderRegion, type Region } from "../../facet-map.mts";
import { tileBounds, type HouseSource } from "../../house-capture.mts";
import type { HouseApiResponse, HouseClaimsApiResponse, HouseMapApiResponse, HouseMapPutApiResponse, HousesApiResponse } from "../../house-model-types.mts";
import type { OkApiResponse } from "../../api/routes.mts";
import { plotBounds, plotSize } from "../../house-model.mts";
import { checkHouseEntry, isHouseId, readHouseMap, saveHouseEntry, MAX_ENTRY_BYTES } from "../../house-names.mts";
import { safeAppendLog } from "../../log.mts";
import { encodePng } from "../../png.mts";
import { readBody } from "../../read-body.mts";
import { claimsOver } from "../../store/house-claims.mts";
import { send } from "../respond.mts";
import type { Route } from "../router.mts";
import type { ServerContext } from "../context.mts";

export function routes(ctx: ServerContext): Route[] {
  const { config: CONFIG, getInventory, houseService, houseClaimsStore } = ctx;
  // <data>/house-map.json: the player's house names (issue #164, app/house-names.mts). A file that does not parse is
  // moved aside and the houses read unnamed; what a read set aside or left out goes to the log, once while it stays the same.
  const HOUSE_MAP = join(CONFIG.dataDir, "house-map.json");
  let namesProblem: string | null = null;
  function readNames(): ReturnType<typeof readHouseMap> {
    const got = readHouseMap(HOUSE_MAP);
    if (got.problem && got.problem !== namesProblem) safeAppendLog(CONFIG.paths.log, `${new Date().toISOString()} ${got.problem}\n`);
    namesProblem = got.problem;
    return got;
  }
  return [
    // The houses the scans captured (issue #10): GET /api/houses lists each with its size, chest count and container serials (what Inventory's "Show on map" looks an item's container up in), GET /api/houses/<id> serves one house's whole model. Both come from the fold's cache and the built models are memoised (houseModel); an id that names no house (or does not decode) is a 404. Only the houses the player claimed are served (issue #299): a house whose bounds overlap a claim on its facet.
    { method: "GET", path: /^\/api\/houses(?:\/|$)/, handle: async (_req, res, url) => {
      const { inv, houses: all } = await getInventory(), map = readNames().doc, claims = houseClaimsStore.read();
      const houses = all.filter((h) => claimsOver(claims, h.facet, tileBounds(h.tiles)).length);
      let one: HouseSource | undefined;
      if (url.pathname !== "/api/houses") {
        let id: string | null;
        try { id = decodeURIComponent(url.pathname.slice("/api/houses/".length)); } catch { id = null; }
        one = houses.find((h) => h.id === id);
        if (!one) return send(res, 404, { ok: false, error: "no such house" });
      }
      const from = houseService.tileData(), td = from.td, names = map.houses;
      const named = (id: string): { name?: string } => (names[id]?.name ? { name: names[id].name } : {});
      if (one) return send(res, 200, { ok: true, house: { ...houseService.model(inv, one, td), ...named(one.id) } } satisfies HouseApiResponse);
      return send(res, 200, { ok: true, tiledata: td !== null, tiledataFrom: { folder: from.folder, source: from.source, reason: from.reason }, houses: houses.map((h) => {
        const m = houseService.model(inv, h, td);
        return { id: h.id, ...named(h.id), facet: h.facet, capturedAt: h.capturedAt, captures: h.captures, ...plotSize(m), plot: plotBounds(m), levels: m.levels.length, containers: m.stacks.reduce((a, st) => a + st.serials.length, 0), serials: m.stacks.flatMap((st) => st.serials) };
      }) } satisfies HousesApiResponse);
    } },
    // The facet overview (issue #164): GET /api/facet-map/<facet>.png?x0&y0&x1&y1[&w], the facet 0 to 5, a region in tiles (x1, y1 exclusive) and a size of at most 2048 on either side (1024 by default), never larger than the region. A region reaching past the facet is slid inside it (and cut to the facet's size), and `x-region: x0,y0,x1,y1` says which one was drawn. A 404 says why there is no image (no UO folder, the file missing or not a facet bitmap) as a reason word, never with the path.
    { method: "GET", path: /^\/api\/facet-map\//, handle: (_req, res, url) => {
      const m = /^\/api\/facet-map\/([0-5])\.png$/.exec(url.pathname);
      if (!m) return send(res, 400, { ok: false, error: "the facet must be 0 to 5" });
      const q = url.searchParams, int = (k: string): number | null => (q.has(k) && /^\d{1,5}$/.test(q.get(k)!) ? Number(q.get(k)) : null);
      const w = q.has("w") ? int("w") : 1024;
      if (w == null || w < 1 || w > 2048) return send(res, 400, { ok: false, error: "w must be a size from 1 to 2048" });
      const [x0, y0, x1, y1] = (["x0", "y0", "x1", "y1"] as const).map(int);
      if (x0 == null || y0 == null || x1 == null || y1 == null || x0 >= x1 || y0 >= y1) return send(res, 400, { ok: false, error: "a region is x0, y0, x1 and y1, whole numbers with x0 < x1 and y0 < y1" });
      const got = houseService.facetBitmap(Number(m[1]));
      if ("reason" in got) return send(res, 404, { ok: false, reason: got.reason });
      const f = got.bitmap, slide = (a: number, b: number, max: number): [number, number] => { const span = Math.min(b - a, max), from = Math.min(a, max - span); return [from, from + span]; };
      const [rx0, rx1] = slide(x0, x1, f.width), [ry0, ry1] = slide(y0, y1, f.height), r: Region = { x0: rx0, y0: ry0, x1: rx1, y1: ry1 };
      const region = `${r.x0},${r.y0},${r.x1},${r.y1}`;
      const out = houseService.facetPng(`${got.key}|${region}|${w}`, () => { const img = renderRegion(f, r, w); return encodePng(img.width, img.height, img.rgb); });
      return send(res, 200, out, "image/png", { "x-region": region });
    } },
    // An item's art (issue #174): GET /api/item-art/<graphic>.png?hue=<n>, the graphic and the hue (0 by default, none) whole numbers from 0 to 65535, as a PNG cut to its opaque box, from the same UO folder's artLegacyMUL.uop and hues.mul. The ETag names the files' stamps, graphic and hue, so a repeat with If-None-Match is a 304. A 404 says why there is none as a reason word (as the facet map's, or no-art for a graphic the file has no art for), never with the path.
    { method: "GET", path: /^\/api\/item-art\//, handle: (req, res, url) => {
      const m = /^\/api\/item-art\/(\d{1,5})\.png$/.exec(url.pathname), hueText = url.searchParams.get("hue") ?? "0";
      const graphic = m ? Number(m[1]) : NaN, hue = /^\d{1,5}$/.test(hueText) ? Number(hueText) : NaN;
      if (!(graphic <= 0xffff) || !(hue <= 0xffff)) return send(res, 400, { ok: false, error: "the graphic and the hue must be whole numbers from 0 to 65535" });
      const got = houseService.itemArt(graphic, hue);
      if ("reason" in got) return send(res, 404, { ok: false, reason: got.reason });
      const headers = { "cache-control": "private, no-cache", etag: got.etag };
      return req.headers["if-none-match"] === got.etag ? send(res, 304, "", "image/png", headers) : send(res, 200, got.png, "image/png", headers);
    } },
    // The house names and areas (issues #164, #10): GET the whole map; PUT /api/house-map/<id> {name, bounds?, areas?, …}
    // replaces that house's entry (an empty name with no areas removes it). Any id of the house-id shape is taken, listed or not: a name kept for a house
    // that was redesigned or moved is what the page offers to carry over to its new id.
    // `readOnly`: why the map cannot be changed (a newer Pack Rat made it), when it cannot; every PUT is then a 409.
    { method: "GET", path: "/api/house-map", handle: (_req, res) => {
      const { doc, readOnly } = readNames();
      return send(res, 200, { ok: true, houses: doc.houses, ...(readOnly ? { readOnly } : {}) } satisfies HouseMapApiResponse);
    } },
    { method: "PUT", path: /^\/api\/house-map\//, handle: async (req, res, url) => {
      let id: string | null;
      try { id = decodeURIComponent(url.pathname.slice("/api/house-map/".length)); } catch { id = null; }
      if (id == null || !isHouseId(id)) return send(res, 400, { ok: false, error: "that is not a house id (<facet>-<x>-<y>)" });
      const checked = checkHouseEntry(await readBody(req, { limit: MAX_ENTRY_BYTES }));
      if (!checked.ok) return send(res, 400, { ok: false, error: checked.error });
      const { doc, readOnly } = readNames();
      if (readOnly) return send(res, 409, { ok: false, error: readOnly });
      mkdirSync(dirname(HOUSE_MAP), { recursive: true, mode: DATA_DIR_MODE });
      const refused = saveHouseEntry(HOUSE_MAP, doc, id, checked.entry);
      if (refused) return send(res, 409, { ok: false, error: refused });
      return send(res, 200, { ok: true, entry: checked.entry } satisfies HouseMapPutApiResponse);
    } },
    // The houses claimed (issue #299, <data>/house-claims.json, app/store/house-claims.mts): GET lists them; DELETE /api/house-claims/<id> unclaims the house of that id, every claim over it gone (the claim of its id, and any claim its bounds overlap on its facet, made before it was customized), so it leaves the House map. A malformed id is a 400.
    { method: "GET", path: "/api/house-claims", handle: (_req, res) => send(res, 200, { ok: true, claims: houseClaimsStore.read() } satisfies HouseClaimsApiResponse) },
    { method: "DELETE", path: /^\/api\/house-claims\/[^/]+$/, handle: async (_req, res, url) => {
      let id: string | null;
      try { id = decodeURIComponent(url.pathname.slice("/api/house-claims/".length)); } catch { id = null; }
      if (id == null || !isHouseId(id)) return send(res, 400, { ok: false, error: "that is not a house id (<facet>-<x>-<y>)" });
      const house = (await getInventory()).houses.find((h) => h.id === id), claims = houseClaimsStore.read();
      const over = new Set(house ? claimsOver(claims, house.facet, tileBounds(house.tiles)) : []);
      houseClaimsStore.write(claims.filter((c) => c.id !== id && !over.has(c)));
      return send(res, 200, { ok: true } satisfies OkApiResponse);
    } },
  ];
}
