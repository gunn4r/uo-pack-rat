// house-names.mts — <data>/house-map.json (issue #164): what the player says about each house, by house id ({ version: 1, houses: { "<id>": { name, bounds? } } }). Only `name` and `bounds` are checked; any other field on an entry is kept, so room names, zones and notes can join the same entry later. `bounds` is the house's footprint when it was named, so a redesigned or moved house (a new id) can be offered the old name. Written only by PUT /api/house-map/<id>, whole entry at a time; a file that does not parse is moved aside as house-map.json.corrupt (the way organize.json is) and reads as empty.
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import { moveAside, writeFileAtomic } from "./atomic-write.mts";
import { DATA_FILE_MODE } from "./config.mts";

export interface HouseBounds { x0: number; y0: number; x1: number; y1: number; facet: number | null }
export interface HouseEntry { name: string; bounds?: HouseBounds | undefined; [field: string]: unknown }
export interface HouseMapDoc { version: 1; houses: Record<string, HouseEntry> }
export const NAME_MAX = 60;
// Room for far more houses than a player keeps (the PUT body is capped at 8 kB an entry).
export const MAX_HOUSE_MAP_BYTES = 1e6;
export const MAX_HOUSES = 500;

// house-capture.mts's houseIdOf: "<facet>-<x>-<y>", the facet "x" when it is not known.
const HOUSE_ID = /^(\d{1,3}|x)-\d{1,6}-\d{1,6}$/;
export const isHouseId = (id: string): boolean => HOUSE_ID.test(id);
export const emptyHouseMap = (): HouseMapDoc => ({ version: 1, houses: {} });

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

// An entry as PUT carries it: the name trimmed, null when it is empty (the entry is removed), or why it is refused.
export function checkHouseEntry(v: unknown): { ok: true; entry: HouseEntry | null } | { ok: false; error: string } {
  if (!isObj(v)) return { ok: false, error: "the entry must be an object with a name" };
  if (typeof v.name !== "string") return { ok: false, error: "name must be a string" };
  const name = v.name.trim();
  if (!name) return { ok: true, entry: null };
  if (name.length > NAME_MAX) return { ok: false, error: `The name must be 1 to ${NAME_MAX} characters.` };
  if (CONTROL.test(name)) return { ok: false, error: "The name cannot hold control characters (line breaks, tabs)." };
  const b = v.bounds;
  if (b !== undefined && !(isObj(b) && isInt(b.x0) && isInt(b.y0) && isInt(b.x1) && isInt(b.y1) && (b.facet === null || isInt(b.facet)))) {
    return { ok: false, error: "bounds must be {x0, y0, x1, y1, facet}, whole numbers (facet may be null)" };
  }
  return { ok: true, entry: { ...v, name } as HouseEntry };
}

export function withHouseEntry(doc: HouseMapDoc, id: string, entry: HouseEntry | null): HouseMapDoc {
  const houses = { ...doc.houses };
  if (entry) houses[id] = entry; else delete houses[id];
  return { version: 1, houses };
}

// The file as the server reads it. A file that is too big, does not parse or is not version 1 is moved aside and reads
// as empty (the next PUT would otherwise overwrite it); an entry with a bad id or name is left out of the read and the
// file is left alone. `problem` says what happened, for the log.
export function readHouseMap(file: string): { doc: HouseMapDoc; problem: string | null } {
  if (!existsSync(file)) return { doc: emptyHouseMap(), problem: null };
  let why: string | null = null, raw: unknown = null;
  if (lstatSync(file).size > MAX_HOUSE_MAP_BYTES) why = `is over ${MAX_HOUSE_MAP_BYTES / 1e6} MB`;
  else {
    try { raw = JSON.parse(readFileSync(file, "utf8")); }
    catch (e) {
      if (!(e instanceof SyntaxError)) throw e;
      why = "did not parse";
    }
    if (!why && !(isObj(raw) && raw.version === 1 && isObj(raw.houses))) why = "is not a version 1 house map";
  }
  if (why) return { doc: emptyHouseMap(), problem: `house-map.json ${why}; it was moved to ${basename(moveAside(file))} and the houses start unnamed` };
  const houses: Record<string, HouseEntry> = {};
  let dropped = 0;
  for (const [id, v] of Object.entries((raw as { houses: Record<string, unknown> }).houses)) {
    const r = isHouseId(id) ? checkHouseEntry(v) : null;
    if (r?.ok && r.entry) houses[id] = r.entry; else dropped++;
  }
  return { doc: { version: 1, houses }, problem: dropped ? `house-map.json: ${dropped} ${dropped === 1 ? "entry" : "entries"} with a bad id or name left out` : null };
}

export function writeHouseMap(file: string, doc: HouseMapDoc): void {
  writeFileAtomic(file, JSON.stringify(doc, null, 2) + "\n", DATA_FILE_MODE);
}
