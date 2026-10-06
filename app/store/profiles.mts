// profiles.mts — <data>/profiles.json: the Suit Builder's characters and templates (GET/PUT /api/profiles).
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { buildSpecError, migrateProfilesV3, type ProfilesV3, type TemplateEntry, type TemplateMap } from "../build-spec.mts";
import { writeFileAtomic } from "../atomic-write.mts";
import { DATA_DIR_MODE, DATA_FILE_MODE } from "../config.mts";
import { jsonErrorReason } from "../paste-scan.mts";
import { readJsonFile, writeJsonFile } from "./json-file.mts";
import type { UiPrefsFile } from "./ui-prefs.mts";

// A copy of `file` kept before a migration rewrites it, as <name>.backup-<date>.json beside it (-2, -3… when that day
// already has one, so each migration's input is kept).
function backup(file: string, day: string): void {
  const stem = join(dirname(file), basename(file, ".json"));
  let to = `${stem}.backup-${day}.json`;
  for (let n = 2; existsSync(to); n++) to = `${stem}.backup-${day}-${n}.json`;
  copyFileSync(file, to);
}

// Seeds profiles.json from the default on first run and migrates an older file to schemaVersion 3 in place
// (app/build-spec.mts migrateProfilesV3): Automatic's buffs and their numbers move in from ui-prefs.json, which loses
// those two keys. Before the first write, both files are kept as <name>.backup-<date>.json next to them.
// A profiles.json that does not parse (a write cut short before writes were atomic, or a bad hand
// edit) used to answer every GET /api/profiles with a 500 until someone fixed the file by hand. It
// is now moved aside the same way the settings store moves an unreadable settings.json, and the
// defaults are seeded in its place, with a log line naming where the old file went.
// `log` appends one line to the server log. `templatesDir` holds the built-in templates, one <shard>.json per shard, and
// `shard` names the one in use.
export function createProfilesStore({ file, defaults, templatesDir, shard, log, uiPrefs }: {
  file: string; defaults: string; templatesDir: string; shard: () => string; log: (line: string) => void; uiPrefs: { file: string; read(): UiPrefsFile; write(prefs: UiPrefsFile): void };
}) {
  async function read(): Promise<ProfilesV3> {
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
    // loadFile and readScans' upgradeScan extend to their own on-disk inputs) — the migration's own
    // loose input shape (every field optional) is what actually tolerates a malformed file.
    const { profiles, prefs, changed, prefsChanged } = migrateProfilesV3(doc as ProfilesV3, uiPrefs.read());
    const day = new Date().toISOString().slice(0, 10);
    if (changed) {
      backup(file, day);
      if (existsSync(uiPrefs.file)) backup(uiPrefs.file, day);
      writeJsonFile(file, profiles, { indent: 2 });
      if (prefsChanged) uiPrefs.write(prefs);
    } else if (prefsChanged) {
      // The two keys left in ui-prefs.json beside a v3 file (a migration cut short between its two writes, or an older
      // build run since): the profiles already hold what they mean, so they go, kept once more first. A failure here
      // is logged rather than failing the read, so it can't turn every read into another backup.
      try {
        backup(uiPrefs.file, day);
        uiPrefs.write(prefs);
      } catch (e) { log(`${new Date().toISOString()} ui-prefs.json still holds autoBuffs or buffSkills, and they could not be removed (${(e as Error).message})\n`); }
    }
    return profiles;
  }
  // PUT /api/profiles: the whole file, already checked against the schema and app/build-spec.mts's buildSpecError.
  function write(doc: ProfilesV3): void { writeJsonFile(file, doc, { indent: 2 }); }
  // The shard's built-in templates (<templatesDir>/<shard>.json), read on every call so a release's changes show at once.
  // None for a shard that ships none; a template its spec check refuses is left out, with a log line.
  function builtins(): TemplateMap {
    const path = join(templatesDir, `${shard()}.json`);
    if (!existsSync(path)) return {};
    const doc = readJsonFile(path, { onBad: "skip" }) as { templates?: Record<string, TemplateEntry> };
    const out: TemplateMap = {};
    for (const [id, t] of Object.entries(doc.templates || {})) {
      const bad = buildSpecError(t?.spec, `${basename(path)} templates.${id}.spec`, { template: true });
      if (bad) log(`${new Date().toISOString()} a built-in template was left out: ${bad}\n`);
      else out[id] = t;
    }
    return out;
  }
  return { read, write, builtins };
}
