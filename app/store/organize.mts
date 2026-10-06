// organize.mts — <data>/organize.json: Organize's setup (issue #11, app/organize-config.mts; GET/PUT /api/organize).
import { existsSync } from "node:fs";
import { basename } from "node:path";
import { emptyOrganizeConfig, salvageOrganizeConfig, MAX_SETUP_BYTES, type OrganizeConfig } from "../organize-config.mts";
import { jsonErrorReason } from "../paste-scan.mts";
import { readJsonFile, writeJsonFile } from "./json-file.mts";

// Read through the salvage, so a hand edit that breaks one rule drops that rule, not the whole setup, and
// `problems` says what went; a file that does not parse is moved aside (the way the settings store treats
// settings.json) and Organize starts empty. Written only by PUT /api/organize, whole.
export function createOrganizeStore(file: string) {
  function read(): { config: OrganizeConfig; problems: string[] } {
    if (!existsSync(file)) return { config: emptyOrganizeConfig(), problems: [] };
    // A file that is too big, does not parse or is not a version 1 setup is moved aside rather than read as empty:
    // the next PUT would otherwise overwrite it. A read that fails is thrown.
    const got = readJsonFile(file, { maxBytes: MAX_SETUP_BYTES, onBad: "aside", ioErrors: "throw",
      check: (raw) => !raw || typeof raw !== "object" || (raw as { version?: unknown }).version !== 1 ? "is not a version 1 Organize setup" : null });
    if ("doc" in got) return salvageOrganizeConfig(got.doc);
    if (!("bad" in got)) return { config: emptyOrganizeConfig(), problems: [] };   // never: a missing file throws
    if ("asideError" in got) throw got.asideError;
    const why = got.bad.why === "too-big" ? `is over ${MAX_SETUP_BYTES / 1e6} MB` : got.bad.why === "check" ? got.bad.reason : `did not parse (${jsonErrorReason(got.bad.error)})`;
    return { config: emptyOrganizeConfig(), problems: [`organize.json ${why}; it was moved to ${basename(got.aside)} and Organize starts empty`] };
  }
  function write(config: OrganizeConfig): void { writeJsonFile(file, config, { indent: 2 }); }
  return { read, write };
}
