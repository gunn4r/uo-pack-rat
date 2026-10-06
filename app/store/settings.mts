// settings.mts — <data>/settings.json: the shard, the client, the setup and retention choices. What a run actually uses (the startup fallbacks laid over this file) is the server's business; this store only reads and writes the file.
import { existsSync } from "node:fs";
import { DEFAULT_SHARD } from "../rules.mts";
import { jsonErrorReason } from "../paste-scan.mts";
import { readJsonFile, writeJsonFile } from "./json-file.mts";

// settings.json is user-editable, on-disk data with no schema check at read time (PUT /api/settings
// validates each field it writes; a hand-edited file is trusted here the same way profiles.json
// is in the profiles store) — the cast documents that trust boundary, same pattern as rules.mts's loadFile.
export interface ClientSettings { adapter: string; scriptsDir: string; }
export interface SettingsDoc {
  schemaVersion?: number;
  shard: string;
  setupDone?: boolean;
  client?: ClientSettings | null;
  retention?: unknown;
  autoUpdateCheck?: boolean;
  uoFolder?: string | null;
  [key: string]: unknown;
}

// The shard picker: <data>/settings.json ({schemaVersion, shard}) names which app/rules/<shard>.json
// (or <data>/rules/<shard>.json override) is currently active. ensureLayout() already wrote a default
// settings.json if none existed, so this file exists by the time startServer runs.
// A settings.json that does not parse, or is not an object, used to throw out of startServer and
// stop the app from starting at all (exit 2) — for a file the app itself writes and a player may
// hand-edit. It now starts on defaults instead, with a logged warning, and the unreadable file is
// moved aside as settings.json.corrupt (never overwritten: an older .corrupt keeps its name and the
// new one gets a timestamp) so whatever was in it can still be recovered by hand. Defaults are then
// written back, the same file ensureLayout() writes on a fresh data directory.
// `warn` is the server's startup warning: the console and the log.
export function createSettingsStore({ file, warn }: { file: string; warn: (msg: string) => void }) {
  function load(): SettingsDoc {
    const defaults: SettingsDoc = { schemaVersion: 1, shard: DEFAULT_SHARD };
    if (!existsSync(file)) return defaults;
    const read = readJsonFile(file, { onBad: "aside", check: (doc) => !doc || typeof doc !== "object" || Array.isArray(doc) ? "not a JSON object" : null });
    if ("doc" in read) return read.doc as SettingsDoc;
    if ("missing" in read) return defaults;
    let aside: string;
    try {
      if ("asideError" in read) throw read.asideError;
      aside = read.aside;
      writeJsonFile(file, defaults, { indent: 2 });
    } catch (e) {
      warn(`settings.json could not be moved aside (${(e as Error).message}); running on defaults without touching it`);
      return defaults;
    }
    const why = read.bad.why === "check" ? read.bad.reason : read.bad.why === "too-big" ? "" : jsonErrorReason(read.bad.error);
    warn(`settings.json is unreadable (${why}); starting on defaults — the old file was kept as ${aside}`);
    return defaults;
  }
  // The whole document, as the server merged it.
  function write(doc: SettingsDoc): void { writeJsonFile(file, doc, { indent: 2 }); }
  return { load, write };
}
