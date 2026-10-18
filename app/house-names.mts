// house-names.mts — <data>/house-map.json (issues #164 and #10): what the player says about each house, by house id ({ version: 1, houses: { "<id>": { name, bounds?, areas? } } }). `name`, `bounds` and `areas` are checked; any other field on an entry or an area is kept, so notes can join the same entry later. `bounds` is the house's footprint when it was named or its areas drawn, so a redesigned or moved house (a new id) can be offered the old name and areas. `areas` are the player's own areas on the House map: each a name, a level, a colour from a fixed palette and up to MAX_RECTS rectangles of world tiles (inclusive). `forgotten` (issue #298) lists the houses the player removed from the House map before claims (issue #299) replaced that: it is kept as it is and read only so the houses claimed at the first start with claims leave them out (app/store/house-claims.mts). Written only by PUT /api/house-map/<id>, whole entry at a time, through app/store/house-map.mts; a file that does not parse is moved aside as house-map.json.corrupt (the way organize.json is) and reads as empty.
//
// map: house
// owns: `checkHouseEntry`, `salvageHouseMap`, `NAME_MAX`, `MAX_AREAS`, `AREA_COLORS`
import { migrate, newerNotice } from "./migrate.mts";
import type { AreaRect, HouseArea, HouseBounds, HouseEntry } from "./house-model-types.mts";
import { isPlainObject } from "./guards.mts";

// An entry's shape is the API's own (app/house-model-types.mts), which the page reads too.
export type { HouseBounds, AreaRect, HouseArea, HouseEntry } from "./house-model-types.mts";
export interface ForgottenHouse { id: string; capturedAt: string }
export interface HouseMapDoc { version: 1; houses: Record<string, HouseEntry>; forgotten?: ForgottenHouse[] | undefined }
export const NAME_MAX = 60;
// The area colours are token names (--color-area-1 … --color-area-8 in the themes), never a raw colour.
export const AREA_COLORS = ["area-1", "area-2", "area-3", "area-4", "area-5", "area-6", "area-7", "area-8"] as const;
export const MAX_AREAS = 32, MAX_RECTS = 16, MAX_LEVEL = 15;
// How far past the house's bounds a rectangle may reach (generous: the plot's front steps, a redesign carried over).
export const AREA_MARGIN = 8;
// The PUT body's cap: 32 areas of 16 rectangles with long names fit with room to spare.
export const MAX_ENTRY_BYTES = 64e3;
const AREA_ID = /^[A-Za-z0-9_-]{1,24}$/;
// Room for far more houses than a player keeps (the PUT body is capped at MAX_ENTRY_BYTES an entry).
export const MAX_HOUSE_MAP_BYTES = 1e6;
export const MAX_HOUSES = 500;

// house-capture.mts's houseIdOf: "<facet>-<x>-<y>", the facet "x" when it is not known.
const HOUSE_ID = /^(\d{1,3}|x)-\d{1,6}-\d{1,6}$/;
export const isHouseId = (id: string): boolean => HOUSE_ID.test(id);
export const emptyHouseMap = (): HouseMapDoc => ({ version: 1, houses: {} });

const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);
// C0/C1 controls, the line and paragraph separators and the bidi embeddings, overrides and isolates (a name could
// otherwise flip the text around it); a zero-width joiner stays, emoji need it.
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/;

// A name (the house's or an area's) trimmed, or why it is refused; "" when it is empty.
function checkName(v: string, what: string): { ok: true; name: string } | { ok: false; error: string } {
  const name = v.trim();
  if (name.length > NAME_MAX) return { ok: false, error: `${what} must be 1 to ${NAME_MAX} characters.` };
  if (CONTROL.test(name)) return { ok: false, error: `${what} cannot hold control characters (line breaks, tabs).` };
  return { ok: true, name };
}

// The areas as PUT carries them, their names trimmed, or why they are refused. A rectangle must lie within the house's bounds and AREA_MARGIN tiles around them, so areas need bounds.
function checkAreas(v: unknown, b: HouseBounds | undefined): { ok: true; areas: HouseArea[] } | { ok: false; error: string } {
  if (!Array.isArray(v)) return { ok: false, error: "areas must be a list" };
  if (v.length > MAX_AREAS) return { ok: false, error: `A house can have at most ${MAX_AREAS} areas.` };
  if (v.length && !b) return { ok: false, error: "areas need the house's bounds" };
  const ids = new Set<string>(), out: HouseArea[] = [];
  for (const a of v) {
    if (!isPlainObject(a)) return { ok: false, error: "each area must be an object" };
    if (typeof a.id !== "string" || !AREA_ID.test(a.id)) return { ok: false, error: "an area's id must be 1 to 24 letters, digits, - or _" };
    if (ids.has(a.id)) return { ok: false, error: `two areas share the id ${a.id}` };
    ids.add(a.id);
    if (typeof a.name !== "string") return { ok: false, error: "an area's name must be a string" };
    const n = checkName(a.name, "An area's name");
    if (!n.ok) return n;
    if (!n.name) return { ok: false, error: `An area's name must be 1 to ${NAME_MAX} characters.` };
    if (!isInt(a.level) || a.level < 0 || a.level > MAX_LEVEL) return { ok: false, error: `an area's level must be a whole number from 0 to ${MAX_LEVEL}` };
    if (typeof a.color !== "string" || !(AREA_COLORS as readonly string[]).includes(a.color)) return { ok: false, error: `an area's color must be one of ${AREA_COLORS.join(", ")}` };
    if (!Array.isArray(a.rects) || !a.rects.length || a.rects.length > MAX_RECTS) return { ok: false, error: `An area must have 1 to ${MAX_RECTS} rectangles.` };
    for (const r of a.rects) {
      if (!(isPlainObject(r) && isInt(r.x0) && isInt(r.y0) && isInt(r.x1) && isInt(r.y1) && r.x0 <= r.x1 && r.y0 <= r.y1)) return { ok: false, error: "a rectangle must be {x0, y0, x1, y1}, whole numbers with x0 <= x1 and y0 <= y1" };
      if (r.x0 < b!.x0 - AREA_MARGIN || r.y0 < b!.y0 - AREA_MARGIN || r.x1 > b!.x1 + AREA_MARGIN || r.y1 > b!.y1 + AREA_MARGIN) return { ok: false, error: "a rectangle must lie on the house" };
    }
    out.push({ ...a, name: n.name, rects: (a.rects as AreaRect[]).map((r) => ({ ...r })) } as HouseArea);
  }
  return { ok: true, areas: out };
}

// An entry as PUT carries it: the name trimmed and the areas checked; null when it has neither a name nor an area (the entry is removed), or why it is refused.
export function checkHouseEntry(v: unknown): { ok: true; entry: HouseEntry | null } | { ok: false; error: string } {
  if (!isPlainObject(v)) return { ok: false, error: "the entry must be an object with a name" };
  if (typeof v.name !== "string") return { ok: false, error: "name must be a string" };
  const n = checkName(v.name, "The name");
  if (!n.ok) return n;
  const b = v.bounds;
  if (b !== undefined && !(isPlainObject(b) && isInt(b.x0) && isInt(b.y0) && isInt(b.x1) && isInt(b.y1) && (b.facet === null || isInt(b.facet)))) {
    return { ok: false, error: "bounds must be {x0, y0, x1, y1, facet}, whole numbers (facet may be null)" };
  }
  let areas: HouseArea[] | undefined;
  if (v.areas !== undefined) {
    const a = checkAreas(v.areas, b as HouseBounds | undefined);
    if (!a.ok) return a;
    areas = a.areas;
  }
  if (!n.name && !areas?.length) return { ok: true, entry: null };
  const entry = { ...v, name: n.name } as HouseEntry;
  if (areas?.length) entry.areas = areas; else delete entry.areas;
  return { ok: true, entry };
}


const isStamp = (v: unknown): v is string => typeof v === "string" && v.length <= 40 && Number.isFinite(Date.parse(v));
const isForgottenEntry = (v: unknown): v is ForgottenHouse => isPlainObject(v) && typeof v.id === "string" && isHouseId(v.id) && isStamp(v.capturedAt);

// The house map in `parsed` (house-map.json's JSON), migrated: null when it is not a version 1 (or newer) map, else the
// map with every entry that has a bad id, name or area left out (`dropped` counts them) and, for a file a newer Pack Rat
// made, `readOnly` saying why it must not be saved over (`fileName` names it there). app/store/house-map.mts reads the file.
export function salvageHouseMap(parsed: unknown, fileName: string): { doc: HouseMapDoc; dropped: number; readOnly: string | null } | null {
  const m = migrate("house-map", parsed), raw = m.doc;
  if (!(isPlainObject(raw) && (m.fromVersion === 1 || m.newer) && isPlainObject(raw.houses))) return null;
  const houses: Record<string, HouseEntry> = {};
  let dropped = 0;
  for (const [id, v] of Object.entries(raw.houses)) {
    const r = isHouseId(id) ? checkHouseEntry(v) : null;
    if (r?.ok && r.entry) houses[id] = r.entry; else dropped++;
  }
  const forgotten = Array.isArray(raw.forgotten) ? raw.forgotten.filter(isForgottenEntry) : [];
  return { doc: { version: 1, houses, ...(forgotten.length ? { forgotten } : {}) }, dropped, readOnly: newerNotice(fileName, "house-map", raw) };
}

