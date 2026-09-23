// import.mts — the import paths that aren't "an adapter dropped a file and the watcher noticed":
// a player pasting what the ClassicUO web client's sandboxed scanner printed (it cannot write files
// at all), and a manual rescan for a player whose folder watcher missed a drop. Both still end up
// going through app/watcher.mts the normal way — this module only gets a scan doc INTO an adapter's
// inbox; app/vault-server.mts nudges the watcher (scanOnce()) the same way POST /api/import already
// does, so acceptance, rejection and the /api/events broadcast are all one code path regardless of
// how the file got into the inbox.
//
// parsePastedScan(text) is pure — no fs, takes and returns values only (app/paste-scan.mts, shared
// with the page). writeScanToInbox does the one bit of IO: an atomic temp-then-rename write, named by
// app/watcher.mts's own acceptedName so a paste-written file and a watcher-ingested file are never
// named by two different rules.
import { mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { acceptedName } from "./watcher.mts";
import { writeFileAtomic } from "./atomic-write.mts";
import { DATA_DIR_MODE, DATA_FILE_MODE } from "./config.mts";
import type { ConfigPaths } from "./config.mts";
import type { ScanV2 } from "./schema/types.d.mts";

// The paste parser lives in app/paste-scan.mts (browser-safe, so the Import drawer previews with the
// same rule); re-exported here for the server route and app/import.test.mts.
export { PASTE_BEGIN, PASTE_END, parsePastedScan, type ParsePastedScanResult } from "./paste-scan.mts";

// writeScanToInbox({doc, adapter, paths}) — atomic temp-then-rename write of an already-upgraded,
// schema-valid doc into paths.inboxFor(adapter), under the name app/watcher.mts's own acceptedName
// would give it (collision-checked against whatever's already sitting in that inbox, same as
// ingestFile's own scansDir write). Returns {file, character}. IO only — the caller has already done
// all the parsing/validation via parsePastedScan.
// The write goes through app/atomic-write.mts's writeFileAtomic, the same helper importScans' own
// copies use, rather than the predictable "<dest>.tmp" this used to write: a published temp name is a path
// something else can pre-plant a symlink at, and writeFileSync follows one — the bytes land outside
// the inbox and the rename then moves the SYMLINK into the scan's final name. atomicReplace's temp is
// random and created O_EXCL, and it refuses a destination that is anything but absent or a regular
// file (Phase 7 security review, Area 3's finding, applied to the one write that had been missed).
export interface WriteScanToInboxParams {
  doc: ScanV2;
  adapter: string;
  paths: ConfigPaths;
}

export interface WriteScanToInboxResult {
  file: string;
  character: string;
}

export function writeScanToInbox({ doc, adapter, paths }: WriteScanToInboxParams): WriteScanToInboxResult {
  const inboxDir = paths.inboxFor(adapter);
  mkdirSync(inboxDir, { recursive: true, mode: DATA_DIR_MODE });
  let existing: Set<string>;
  try { existing = new Set(readdirSync(inboxDir).filter((f) => f.endsWith(".json"))); }
  catch { existing = new Set(); }
  const file = acceptedName(doc, existing);
  const dest = join(inboxDir, file);
  writeFileAtomic(dest, JSON.stringify(doc), DATA_FILE_MODE);
  return { file, character: doc.character };
}
