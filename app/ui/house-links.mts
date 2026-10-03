// ui/house-links.mts — which house holds each container (issue #10), the one index of it: Inventory's item rows and the Containers view offer "Show on map" by it without loading any house's model, and the House map's search says where its other matches are by it. GET /api/houses lists each house's container serials; every other ground container with a place of its own stands on the plain grid (house-map-model.mts houseIndex). Fetched again with every inventory load, and set again whenever the House map fetches the houses.
import { state } from "./store.mts";
import { api } from "./api.mts";
import { floorContainerOf, houseIndex, mapHash, type HouseRef } from "./house-map-model.mts";
import type { HousesApiResponse, HouseSummary } from "./api-types.mts";
import type { Item } from "../vault-lib.mts";

let index = new Map<number, HouseRef>();
// A failed fetch only leaves the plain grid's containers linked: the rest of the page never waits on it.
export async function loadHouseLinks(): Promise<void> { setHouses(await api<HousesApiResponse>("/api/houses").then((r) => r.houses, () => [])); }
export function setHouses(houses: readonly HouseSummary[]): void { index = state.inv ? houseIndex(houses, state.inv.containers) : new Map(); }
export const houseLinks = (): ReadonlyMap<number, HouseRef> => index;
// The house a container on the floor stands in, and the house an item is in (through its container on the floor), with that container's serial; null when neither is on a map.
export const houseOfContainer = (serial: number): HouseRef | null => index.get(serial) ?? null;
export function houseOfItem(it: Pick<Item, "root" | "container" | "equippedBy">): (HouseRef & { serial: number }) | null {
  const f = it.equippedBy || !state.inv ? null : floorContainerOf(it, state.inv.containers), h = f == null ? null : index.get(f);
  return h && f != null ? { ...h, serial: f } : null;
}
// Opens the map on that house with the container's stack selected and zoomed to.
export const showOnMap = (house: string, serial: number): void => { location.hash = mapHash({ house, select: serial }); };
