// organize-state.mts — <data>/organize-state.json: Organize's results overlay (app/organize-state.mts).
import { salvageOrganizeState, type OrganizeState } from "../organize-state.mts";
import { readJsonFile, writeJsonFile } from "./json-file.mts";

// Only this server writes it; a damaged one reads as empty, which at worst plans a finished move again (the bridge
// then finds the item gone and says so). `file` is also what the inventory's signature stats.
export function createOrganizeStateStore(file: string) {
  const read = (): OrganizeState => readJsonFile(file, { maxBytes: 4e6, onBad: "empty", salvage: salvageOrganizeState });
  const write = (state: OrganizeState): void => writeJsonFile(file, state, { indent: 1 });
  return { file, read, write };
}
