// blacklist.mts — <data>/scan-blacklist.json: the containers scans never open (GET/POST/DELETE /api/blacklist).
import type { BlacklistEntry } from "../vault-lib.mts";
import { isBoundedInt, isBoundedString, MAX_SERIAL } from "../guards.mts";
import { readJsonFile, writeJsonFile } from "./json-file.mts";

// <data>/scan-blacklist.json: the containers scans never open, a JSON list of {serial, name, addedAt,
// where?} that TazUO's packrat-blacklist.py writes too. Only valid entries are read; anything else in
// the file (or a file too big or unparseable) is dropped, and the next write leaves it out.
export function createBlacklistStore(file: string) {
  function read(): BlacklistEntry[] {
    return readJsonFile(file, { maxBytes: 256 * 1024, onBad: "empty", salvage: (raw) => (Array.isArray(raw) ? raw : []).filter((e): e is BlacklistEntry => !!e && typeof e === "object" && isBoundedInt(e.serial, 1, MAX_SERIAL)
      && isBoundedString(e.name, 64) && isBoundedString(e.addedAt, 40) && (e.where === undefined || isBoundedString(e.where, 64)))
      .slice(0, 1000).map(({ serial, name, addedAt, where }) => ({ serial, name, addedAt, ...(where ? { where } : {}) })) });
  }
  function write(entries: BlacklistEntry[]): void { writeJsonFile(file, entries, { indent: 1 }); }
  return { read, write };
}
