// ui/houses-data.mts — the House map's data (issue #10): the houses the scans captured (GET /api/houses), the player's house names and areas (GET /api/house-map, one house's entry saved with PUT /api/house-map/<id>), and each house's model (GET /api/houses/<id>). The list and the names are fetched on every load, since a rename or a new UO folder can change them outside the page. A model is kept by its house id and capture stamp (capturedAt and captures) while the inventory and the tiledata it was built from stay the same, so showing the map again fetches only the models that changed.
import { api, type ApiOptions } from "./api.mts";
import type { HouseApiResponse, HouseMapApiResponse, HouseMapEntry, HouseMapPutApiResponse, HouseSummary, HousesApiResponse } from "./api-types.mts";

type Get = <T>(path: string, opts?: ApiOptions) => Promise<T>;
type Model = HouseApiResponse["house"];
export interface HousesLoad { list: HousesApiResponse; names: HouseMapApiResponse["houses"]; models: Model[] }

// A house captured again has a newer capturedAt or another capture.
const stampOf = (h: HouseSummary): string => `${h.capturedAt}|${h.captures}`;
// The tiledata the server built every model with: whether it read one, and from where.
const tiledataOf = (list: HousesApiResponse): string => JSON.stringify([list.tiledata, list.tiledataFrom]);

// `get` is the page's api() unless a test hands in its own.
export function housesData(get: Get = api) {
  let kept: { inv: object | null; tiledata: string; models: Map<string, { stamp: string; model: Model }> } = { inv: null, tiledata: "", models: new Map() };
  // The houses, their names and every house's model, for the inventory `inv` (the page's state.inv: a new object on every reload).
  async function load(inv: object): Promise<HousesLoad> {
    const [list, names] = await Promise.all([get<HousesApiResponse>("/api/houses"), get<HouseMapApiResponse>("/api/house-map")]);
    const tiledata = tiledataOf(list);
    const reuse = kept.inv === inv && kept.tiledata === tiledata ? kept.models : new Map<string, { stamp: string; model: Model }>();
    const models = await Promise.all(list.houses.map(async (h) => {
      const hit = reuse.get(h.id);
      if (hit?.stamp === stampOf(h)) { hit.model.name = h.name; return hit.model; }   // the name as the list has it now
      return (await get<HouseApiResponse>(`/api/houses/${encodeURIComponent(h.id)}`)).house;
    }));
    kept = { inv, tiledata, models: new Map(list.houses.map((h, i) => [h.id, { stamp: stampOf(h), model: models[i]! }])) };
    return { list, names: names.houses, models };
  }
  // Replace one house's whole entry; the server's answer (the entry as saved, or null once removed).
  const saveEntry = (id: string, entry: HouseMapEntry): Promise<HouseMapPutApiResponse> => get<HouseMapPutApiResponse>(`/api/house-map/${encodeURIComponent(id)}`, { method: "PUT", body: entry });
  return { load, saveEntry };
}
export const houses = housesData();
