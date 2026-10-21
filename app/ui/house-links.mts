// ui/house-links.mts — which house holds each container (issue #10), the one index of it: Inventory's item rows and the Containers view offer "Show on map" by it without loading any house's model, and the House map's search says where its other matches are by it. GET /api/houses lists each house's container serials; every other ground container with a place of its own stands on the plain grid (house-map-model.mts houseIndex). Fetched again with every inventory load, and set again whenever the House map fetches the houses.
//
// map: house
// owns: `houseOfContainer`, `houseOfItem`, `showOnMap`, `mapHouses`
import { state } from "./store.mts";
import { api } from "./api.mts";
import { floorContainerOf, houseIndex, mapHash, PLAIN, type HouseRef } from "./house-map-model.mts";
import type { HousesApiResponse, HouseSummary } from "./api-types.mts";
import type { Item } from "../vault-lib.mts";

let index = new Map<number, HouseRef>();
// A failed fetch only leaves the plain grid's containers linked: the rest of the page never waits on it.
export async function loadHouseLinks(): Promise<void> { setHouses(await api<HousesApiResponse>("/api/houses").then((r) => r.houses, () => [])); }
// A new index announces itself ("houselinkschange"): it lands after the inventory's own change event, and a view filtered
// by house (the Containers list) redraws with it.
export function setHouses(houses: readonly HouseSummary[]): void {
  index = state.inv ? houseIndex(houses, state.inv.containers) : new Map();
  globalThis.document?.dispatchEvent(new Event("houselinkschange"));
}
export const houseLinks = (): ReadonlyMap<number, HouseRef> => index;
// The houses on the House map (the plain grid of other ground containers left out), each with the containers on the
// ground standing in it, in name order: the Location filter's house rows. `houseIds` is the same by container serial,
// what item-query.mts's applyItemQuery reads a house filter by.
export function mapHouses(): Array<HouseRef & { serials: number[] }> {
  const by = new Map<string, HouseRef & { serials: number[] }>();
  for (const [serial, h] of index) if (h.id !== PLAIN) { const e = by.get(h.id) ?? { ...h, serials: [] }; e.serials.push(serial); by.set(h.id, e); }
  return [...by.values()].sort((a, b) => a.name.localeCompare(b.name));
}
export const houseIds = (): Map<number, string> => new Map([...index].filter(([, h]) => h.id !== PLAIN).map(([s, h]) => [s, h.id]));
export const houseNameOf = (id: string): string => mapHouses().find((h) => h.id === id)?.name ?? id;
// The house a container on the floor stands in, and the house an item is in (through its container on the floor), with that container's serial; null when neither is on a map.
export const houseOfContainer = (serial: number): HouseRef | null => index.get(serial) ?? null;
export function houseOfItem(it: Pick<Item, "root" | "container" | "equippedBy">): (HouseRef & { serial: number }) | null {
  const f = it.equippedBy || !state.inv ? null : floorContainerOf(it, state.inv.containers), h = f == null ? null : index.get(f);
  return h && f != null ? { ...h, serial: f } : null;
}
// Opens the map on that house with the container's stack selected and zoomed to.
export const showOnMap = (house: string, serial: number): void => { location.hash = mapHash({ house, select: serial }); };
