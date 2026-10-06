// organize.mts — <data>/organize.json: Organize's setup (issue #11, app/organize-config.mts; GET/PUT /api/organize).
import { existsSync } from "node:fs";
import { basename } from "node:path";
import { emptyOrganizeConfig, salvageOrganizeConfig, MAX_SETUP_BYTES, type OrganizeConfig } from "../organize-config.mts";
import { jsonErrorReason } from "../paste-scan.mts";
import { migrate, newerNotice } from "../migrate.mts";
import { readJsonFile, refuseNewer, writeJsonFile } from "./json-file.mts";

// Read through the salvage, so a hand edit that breaks one rule drops that rule, not the whole setup, and
// `problems` says what went; a file that does not parse is moved aside (the way the settings store treats
// settings.json) and Organize starts empty. A file made by a newer Pack Rat is read the same way, as far as this build
// understands it, with `readOnly` saying so, and is never written over. Written only by PUT /api/organize, whole.
export function createOrganizeStore(file: string) {
  function read(): { config: OrganizeConfig; problems: string[]; readOnly?: string } {
    if (!existsSync(file)) return { config: emptyOrganizeConfig(), problems: [] };
    // A file that is too big, does not parse or is not a version 1 (or newer) setup is moved aside rather than read as
    // empty: the next PUT would otherwise overwrite it. A read that fails is thrown.
    const got = readJsonFile(file, { maxBytes: MAX_SETUP_BYTES, onBad: "aside", ioErrors: "throw",
      check: (raw) => { const m = migrate("organize", raw); return !raw || typeof raw !== "object" || (m.fromVersion !== 1 && !m.newer) ? "is not a version 1 Organize setup" : null; } });
    if ("doc" in got) {
      const m = migrate("organize", got.doc), readOnly = newerNotice(basename(file), "organize", got.doc);
      return readOnly ? { ...salvageOrganizeConfig({ ...(m.doc as object), version: 1 }), readOnly } : salvageOrganizeConfig(m.doc);
    }
    if (!("bad" in got)) return { config: emptyOrganizeConfig(), problems: [] };   // never: a missing file throws
    if ("asideError" in got) throw got.asideError;
    const why = got.bad.why === "too-big" ? `is over ${MAX_SETUP_BYTES / 1e6} MB` : got.bad.why === "check" ? got.bad.reason : `did not parse (${jsonErrorReason(got.bad.error)})`;
    return { config: emptyOrganizeConfig(), problems: [`organize.json ${why}; it was moved to ${basename(got.aside)} and Organize starts empty`] };
  }
  function write(config: OrganizeConfig): void {
    refuseNewer(file, "organize");
    writeJsonFile(file, config, { indent: 2 });
  }
  return { read, write };
}
