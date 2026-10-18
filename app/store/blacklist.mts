// blacklist.mts — <data>/scan-blacklist.json: the containers scans never open (GET/POST/DELETE /api/blacklist).
//
// map: server
// owns: `createBlacklistStore`
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { APP_DIR } from "../config.mts";
import type { BlacklistEntry } from "../vault-lib.mts";
import { validate, type ValidatorSchema } from "../schema/validate.mts";
import { readJsonFile, updater, writeJsonFile } from "./json-file.mts";

// One entry's schema (app/schema/blacklist.v1.schema.json).
const ENTRY = (JSON.parse(readFileSync(join(APP_DIR, "schema", "blacklist.v1.schema.json"), "utf8")) as { items: ValidatorSchema }).items;
const isEntry = (e: unknown): e is BlacklistEntry => validate(ENTRY, e).ok;

// <data>/scan-blacklist.json: the containers scans never open, a JSON list of {serial, name, addedAt,
// where?} that the game clients' packrat-blacklist.py writes too. Only valid entries are read (the schema,
// app/schema/blacklist.v1.schema.json, whose shared cases the scripts' reader runs too:
// app/fixtures/contract-cases/blacklist.json); anything else in the file (or a file too big or unparseable) is
// dropped, and the next write leaves it out.
export function createBlacklistStore(file: string) {
  function read(): BlacklistEntry[] {
    return readJsonFile(file, { maxBytes: 256 * 1024, onBad: "empty", salvage: (raw) => (Array.isArray(raw) ? raw : []).filter(isEntry)
      .slice(0, 1000).map(({ serial, name, addedAt, where }) => ({ serial, name, addedAt, ...(where ? { where } : {}) })) });
  }
  function write(entries: BlacklistEntry[]): void { writeJsonFile(file, entries, { indent: 1 }); }
  return { read, write, update: updater(read, write) };
}
