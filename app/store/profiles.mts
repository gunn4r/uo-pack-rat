// profiles.mts — <data>/profiles.json: the Suit Builder's characters and templates (GET/PUT /api/profiles).
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { migrateProfiles, type ProfilesFile } from "../vault-lib.mts";
import { writeFileAtomic } from "../atomic-write.mts";
import { DATA_DIR_MODE, DATA_FILE_MODE } from "../config.mts";
import { jsonErrorReason } from "../paste-scan.mts";
import { readJsonFile, writeJsonFile } from "./json-file.mts";

// Seeds profiles.json from the default on first run and migrates an old-shape file (archetypes → templates) in
// place, keeping the pre-migration file once as profiles.backup-<date>.json next to it.
// A profiles.json that does not parse (a write cut short before writes were atomic, or a bad hand
// edit) used to answer every GET /api/profiles with a 500 until someone fixed the file by hand. It
// is now moved aside the same way the settings store moves an unreadable settings.json, and the
// defaults are seeded in its place, with a log line naming where the old file went.
// `log` appends one line to the server log.
export function createProfilesStore({ file, defaults, log }: { file: string; defaults: string; log: (line: string) => void }) {
  async function read(): Promise<ProfilesFile> {
    const seed = (): void => {
      mkdirSync(dirname(file), { recursive: true, mode: DATA_DIR_MODE });
      writeFileAtomic(file, readFileSync(defaults, "utf8"), DATA_FILE_MODE);
    };
    if (!existsSync(file)) seed();
    // an I/O failure is not a damaged file — leave it alone
    const got = readJsonFile(file, { onBad: "aside", ioErrors: "throw", check: (doc) => !doc || typeof doc !== "object" || Array.isArray(doc) ? "not a JSON object" : null });
    let doc: unknown;
    if ("doc" in got) doc = got.doc;
    else if ("bad" in got) {
      if ("asideError" in got) throw got.asideError;
      seed();
      const why = got.bad.why === "check" ? got.bad.reason : got.bad.why === "too-big" ? "" : jsonErrorReason(got.bad.error);
      log(`${new Date().toISOString()} profiles.json is unreadable (${why}); reseeded from the defaults — the old file was kept as ${got.aside}\n`);
      doc = readJsonFile(file, { onBad: "skip" });
    }
    // profiles.json is trusted, unvalidated file content at this point (the same trust readRules'
    // loadFile and readScans' upgradeScan extend to their own on-disk inputs) — migrateProfiles' own
    // loose ProfilesFile shape (every field optional) is what actually tolerates a malformed file.
    const { profiles, changed } = migrateProfiles(doc as ProfilesFile);
    if (changed) {
      const backup = join(dirname(file), `profiles.backup-${new Date().toISOString().slice(0, 10)}.json`);
      if (!existsSync(backup)) copyFileSync(file, backup);
      writeJsonFile(file, profiles, { indent: 2 });
    }
    return profiles;
  }
  // PUT /api/profiles: the whole file, already checked against the schema.
  function write(doc: unknown): void { writeJsonFile(file, doc, { indent: 2 }); }
  return { read, write };
}
