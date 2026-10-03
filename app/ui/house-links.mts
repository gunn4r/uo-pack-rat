// ui/house-links.mts — "Show on map" (issue #10): which house holds each container, so Inventory's item rows and the Containers view can offer the map without loading any house's model. GET /api/houses lists each house's container serials; every other ground container with a place of its own stands on the plain grid (house-map-model.mts houseIndex). Fetched again with every inventory load.
import { state } from "./store.mts";
import { api } from "./api.mts";
import { floorContainerOf, houseIndex, mapHash, type HouseRef } from "./house-map-model.mts";
import type { HousesApiResponse } from "./api-types.mts";
import type { Item } from "../vault-lib.mts";

let index = new Map<number, HouseRef>();
// A failed fetch only leaves the plain grid's containers linked: the rest of the page never waits on it.
export async function loadHouseLinks(): Promise<void> {
  const houses = await api<HousesApiResponse>("/api/houses").then((r) => r.houses, () => []);
  index = state.inv ? houseIndex(houses, state.inv.containers) : new Map();
}
// The house a container on the floor stands in, and the house an item is in (through its container on the floor), with that container's serial; null when neither is on a map.
export const houseOfContainer = (serial: number): HouseRef | null => index.get(serial) ?? null;
export function houseOfItem(it: Pick<Item, "root" | "container" | "equippedBy">): (HouseRef & { serial: number }) | null {
  const f = it.equippedBy || !state.inv ? null : floorContainerOf(it, state.inv.containers), h = f == null ? null : index.get(f);
  return h && f != null ? { ...h, serial: f } : null;
}
// Opens the map on that house with the container's stack selected and zoomed to.
export const showOnMap = (house: string, serial: number): void => { location.hash = mapHash({ house, select: serial }); };
