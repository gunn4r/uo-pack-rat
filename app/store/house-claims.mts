// house-claims.mts — <data>/house-claims.json (issue #299): the houses the player claimed, which the TazUO panel writes too: only valid entries read, which claims a house's bounds fall under, and the claims made at the first start from the houses already named. A TazUO scan opens ground containers, and captures the house, only inside one, and the House map shows only those. A JSON list of {id, facet, bounds: {x0, y0, x1, y1}, claimedAt, by?} that TazUO's packrat-panel.py writes too (Claim this house), read there with the same checks (adapters/_shared/tazuo/claims.py): the entry schema app/schema/house-claims.v1.schema.json, whose accept and reject cases both run (app/fixtures/contract-cases/house-claims.json); `by` is the character that claimed it, left out of the claims the app makes itself.
//
// map: server
// owns: `createHouseClaimsStore`, `claimsOver`, `claimsFromHouseMap`, `MAX_CLAIMS`
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { APP_DIR } from "../config.mts";
import type { HouseMapDoc } from "../house-names.mts";
import type { HouseClaimsV1Item, HouseClaimsV1ItemBounds } from "../schema/types.d.mts";
import { validate, type ValidatorSchema } from "../schema/validate.mts";
import { readJsonFile, writeJsonFile } from "./json-file.mts";

export type ClaimBounds = HouseClaimsV1ItemBounds;
export type HouseClaim = HouseClaimsV1Item;
export const MAX_CLAIMS = 500;
const MAX_CLAIMS_BYTES = 256 * 1024;   // the size the game scripts read too

// One entry's schema (app/schema/house-claims.v1.schema.json), and the rule it can't say: bounds run low to high.
const CLAIM = (JSON.parse(readFileSync(join(APP_DIR, "schema", "house-claims.v1.schema.json"), "utf8")) as { items: ValidatorSchema }).items;
const isClaim = (v: unknown): v is HouseClaim => {
  if (!validate(CLAIM, v).ok) return false;
  const { x0, y0, x1, y1 } = (v as HouseClaim).bounds;
  return x0 <= x1 && y0 <= y1;
};

// Only valid entries are read, the first MAX_CLAIMS; anything else in the file (or a file too big or unparsable) is dropped, and the next write leaves it out.
export function createHouseClaimsStore(file: string) {
  function read(): HouseClaim[] {
    return readJsonFile(file, { maxBytes: MAX_CLAIMS_BYTES, onBad: "empty", salvage: (raw) => (Array.isArray(raw) ? raw : []).filter(isClaim).slice(0, MAX_CLAIMS)
      .map(({ id, facet, bounds: { x0, y0, x1, y1 }, claimedAt, by }) => ({ id, facet, bounds: { x0, y0, x1, y1 }, claimedAt, ...(by !== undefined ? { by } : {}) })) });
  }
  function write(claims: HouseClaim[]): void { writeJsonFile(file, claims, { indent: 1 }); }
  return { read, write, exists: (): boolean => existsSync(file) };
}

// The claims a house with bounds `box` on `facet` falls under: on the same facet (an unknown one matches only an unknown one), their bounds overlapping, so a house customized since it was claimed (a new id) still counts.
export const claimsOver = (claims: HouseClaim[], facet: number | null, box: ClaimBounds): HouseClaim[] =>
  claims.filter((c) => c.facet === facet && c.bounds.x0 <= box.x1 && box.x0 <= c.bounds.x1 && c.bounds.y0 <= box.y1 && box.y0 <= c.bounds.y1);

// The claims for the houses the player named or drew areas for in `map` (house-map.json), less the ones removed from the House map before claims (issue #298's `forgotten`): what the app writes when house-claims.json does not exist yet, so houses already in use stay claimed. A house's bounds are those saved with its entry, else the corner tile its id names, which lies inside the house.
export function claimsFromHouseMap(map: HouseMapDoc, claimedAt: string): HouseClaim[] {
  const forgotten = new Set((map.forgotten ?? []).map((f) => f.id));
  return Object.entries(map.houses).flatMap(([id, e]) => {
    if (forgotten.has(id) || (!e.name && !e.areas?.length)) return [];
    const [f, x, y] = id.split("-"), facet = f === "x" ? null : Number(f);
    const bounds = e.bounds && e.bounds.facet === facet ? { x0: e.bounds.x0, y0: e.bounds.y0, x1: e.bounds.x1, y1: e.bounds.y1 } : { x0: Number(x), y0: Number(y), x1: Number(x), y1: Number(y) };
    const claim = { id, facet, bounds, claimedAt };
    return isClaim(claim) ? [claim] : [];
  }).slice(0, MAX_CLAIMS);
}
