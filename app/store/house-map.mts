// house-map.mts — <data>/house-map.json (issues #164 and #10, app/house-names.mts): the player's house names and areas, read with a bad file moved aside and what a read left out logged once, and saved one entry at a time (GET /api/houses, GET|PUT /api/house-map).
//
// map: server
// owns: `createHouseMapStore`, `readHouseMap`, `saveHouseEntry`
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import { moveAside } from "../atomic-write.mts";
import { emptyHouseMap, salvageHouseMap, MAX_HOUSES, MAX_HOUSE_MAP_BYTES, type HouseEntry, type HouseMapDoc } from "../house-names.mts";
import { writeJsonFile } from "./json-file.mts";

// The file as the server reads it. A file that is too big, does not parse or is not version 1 is moved aside and reads
// as empty (the next PUT would otherwise overwrite it); an entry with a bad id, name or area is left out of the read and the
// file is left alone until the next save, which drops it. `problem` says what happened, for the log. A file made by a
// newer Pack Rat is read as far as this build understands it, and `readOnly` says why it must not be saved over.
export function readHouseMap(file: string): { doc: HouseMapDoc; problem: string | null; readOnly: string | null } {
  if (!existsSync(file)) return { doc: emptyHouseMap(), problem: null, readOnly: null };
  let why: string | null = null, got: ReturnType<typeof salvageHouseMap> = null;
  if (lstatSync(file).size > MAX_HOUSE_MAP_BYTES) why = `is over ${MAX_HOUSE_MAP_BYTES / 1e6} MB`;
  else {
    let parsed: unknown = null;
    try { parsed = JSON.parse(readFileSync(file, "utf8")); }
    catch (e) {
      if (!(e instanceof SyntaxError)) throw e;
      why = "did not parse";
    }
    if (!why) got = salvageHouseMap(parsed, basename(file));
    if (!why && !got) why = "is not a version 1 house map";
  }
  if (why || !got) return { doc: emptyHouseMap(), problem: `house-map.json ${why}; it was moved to ${basename(moveAside(file))} and the houses start unnamed`, readOnly: null };
  return { doc: got.doc, problem: got.dropped ? `house-map.json: ${got.dropped} ${got.dropped === 1 ? "entry" : "entries"} with a bad id, name or area left out` : null, readOnly: got.readOnly };
}

const textOf = (doc: HouseMapDoc): string => JSON.stringify(doc, null, 2) + "\n";
// Sets one house's entry (null removes it) in `doc`, the map as read, and writes the map; or says why not. Only a change
// that grows the map is refused: a new id past MAX_HOUSES names, or a file growing past the size a read accepts (it would
// be moved aside as corrupt on the next read). Clearing or shortening a name always goes through.
export function saveHouseEntry(file: string, doc: HouseMapDoc, id: string, entry: HouseEntry | null): string | null {
  const houses = { ...doc.houses };
  if (entry) houses[id] = entry; else delete houses[id];
  const next: HouseMapDoc = { ...doc, houses };
  if (entry) {
    if (!doc.houses[id] && Object.keys(doc.houses).length >= MAX_HOUSES) return `at most ${MAX_HOUSES} houses can be named; clear some names first`;
    const size = Buffer.byteLength(textOf(next));
    if (size > MAX_HOUSE_MAP_BYTES && size > Buffer.byteLength(textOf(doc))) return `that would make house-map.json larger than ${MAX_HOUSE_MAP_BYTES / 1e6} MB`;
  }
  writeJsonFile(file, next, { indent: 2 });
  return null;
}

// `log` gets each read's problem once while it stays the same, so a damaged file is not logged on every request.
export function createHouseMapStore(file: string, log: (line: string) => void) {
  let lastProblem: string | null = null;
  function read(): ReturnType<typeof readHouseMap> {
    const got = readHouseMap(file);
    if (got.problem && got.problem !== lastProblem) log(`${new Date().toISOString()} ${got.problem}\n`);
    lastProblem = got.problem;
    return got;
  }
  // One house's entry saved over the map as it is now, or why not: a file a newer Pack Rat made, or saveHouseEntry's refusal.
  function save(id: string, entry: HouseEntry | null): string | null {
    const { doc, readOnly } = read();
    return readOnly ?? saveHouseEntry(file, doc, id, entry);
  }
  return { file, read, save };
}
