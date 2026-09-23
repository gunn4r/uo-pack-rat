// ui/messages.mts — the plain sentences the page shows for an outcome the server reports as a count,
// a status code or a one-word field. Pure and DOM-free (no `document`, no imports but a type), for
// the same reason ui/adapters.mts is: a module that touches the DOM at module scope can't be loaded
// under plain `node:test`, and these strings are exactly the part worth pinning with a test (see
// app/ui-messages.test.mts). Every function here takes what `api.mts` throws or returns and gives
// back text — no element, no state, no fetch.
//
// They live in one place because the same outcome reaches the player through more than one panel:
// an install runs from both the wizard's last step and Settings' Reinstall row, and a folder import
// runs from both the wizard and the Import tab. Two hand-written copies of "N files could not be
// imported" is how the two drifted apart the last time (see ui/settings.mts's importPointer comment).
import type { ApiError, DataDirCheckInfo } from "./api-types.mts";

// ---------------------------------------------------------------- reading an api() rejection
export function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
const statusOf = (e: unknown): number | undefined => (e as ApiError)?.status;

// ---------------------------------------------------------------- POST /api/import
export interface ImportFailureLike {
  name: string;
  reason: string;
}
export interface ImportCountsLike {
  copied: number;
  skipped: number;
  failed?: number | undefined;
  failures?: ImportFailureLike[] | undefined;
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;

// The server counts a file it could not take (one over the inbox size limit, an unwritable
// destination — see app/installer.mts's importScans) rather than failing the whole import, so a
// partial import has to say so: a silent "copied 4 scan files" out of six is the failure mode this
// sentence exists to prevent. `failures` names the first few with a reason; importScans bounds that
// list itself, and only the first three are shown here so one bad folder can't fill the panel.
export function importOutcome(r: ImportCountsLike): string {
  const main = r.copied
    ? `copied ${plural(r.copied, "scan file")}${r.skipped ? ` (skipped ${r.skipped} already present)` : ""} — they'll show up in the inventory in a moment.`
    : `nothing new in that folder${r.skipped ? ` — ${r.skipped} file${r.skipped === 1 ? " was" : "s were"} already imported` : ""}.`;
  if (!r.failed) return main;
  const why = (r.failures || []).slice(0, 3).map((f) => `${f.name} (${f.reason})`).join(", ");
  return `${main} ${plural(r.failed, "file")} could not be imported${why ? `: ${why}` : ""}.`;
}

// ---------------------------------------------------------------- POST /api/setup/install
// What became of packrat-paths.json (app/installer.mts's PathsFileOutcome). "written" and
// "unchanged" are the ordinary cases and say nothing; the other two are decisions the installer made
// about a file the player may have written themselves, and a player who is never told cannot act on
// either one — a "kept" file is exactly why scans then stop arriving.
export function pathsFileNote(outcome: string | undefined): string | null {
  if (outcome === "kept") return "Kept your existing packrat-paths.json — it points at a different data folder, so Pack Rat left it alone.";
  if (outcome === "backed-up") return "Replaced packrat-paths.json — the old one is saved beside it as packrat-paths.json.bak.";
  return null;
}

// The folder the scripts actually went into: the server resolves what the page sent (a client root
// becomes its nested scripts folder — POST /api/setup/install runs validateScriptsDir), so what was
// picked and what was written to are not always the same string.
export function installedIntoNote(scriptsDir: string | undefined): string | null {
  return scriptsDir ? `Installed into ${scriptsDir}` : null;
}

// A persisted client folder that has since been renamed, moved or deleted. Both routes that act on
// one answer the same way about it: POST /api/setup/install with code "badDir", PUT /api/settings
// with a message naming the field. Either way the player needs the same thing — the wizard, pointed
// at wherever the client lives now.
export function clientFolderGone(e: unknown): boolean {
  return (e as ApiError)?.code === "badDir" || /settings\.client\.scriptsDir/.test(errorText(e));
}
export function clientErrorMessage(e: unknown): string {
  return clientFolderGone(e)
    ? "Pack Rat can't find that client folder any more — run setup again to point it at where the client lives now."
    : errorText(e);   // e.g. the 409 "-stopall" text, verbatim
}

// ---------------------------------------------------------------- GET /api/setup's dataDirCheck
// The client's scripts writing to one data folder while the app reads another shows up as an empty
// inventory and an offline bridge, and neither says why. The server logs this same sentence to the
// console at startup (app/vault-server.mts imports it), so the banner and the terminal never disagree.
export function dataDirNotice(check: DataDirCheckInfo | undefined): string | null {
  if (check?.status === "mismatch") {
    return `Your game scripts in ${check.scriptsDir} write to ${check.scriptsDataDir}, but Pack Rat is reading ${check.dataDir}, so new scans and the bridge won't show up here. Start Pack Rat on the scripts' folder (npm start -- --data ${check.scriptsDataDir}), or reinstall the scripts from Settings so they write to this one.`;
  }
  if (check?.status === "unreadable") {
    return `Pack Rat can't read packrat-paths.json in ${check.scriptsDir} (${check.error}), so it can't tell where your game scripts write. Reinstall the scripts from Settings to rewrite it.`;
  }
  return null;
}
// The header's bridge pill while the bridge is offline: a mismatch is the one cause the app can name.
export function bridgeOfflineText(check: DataDirCheckInfo | undefined): string {
  return check?.status === "mismatch" ? "bridge: offline — your game scripts write to another folder" : "bridge: offline";
}

// ---------------------------------------------------------------- POST /api/host/*
// 504: the desktop shell never answered the folder picker / open-folder call (app/vault-server.mts's
// withHostTimeout, electron/pending-calls.mts). The request is over — nothing is still pending
// behind the scenes — so the honest thing to say is "that didn't happen, try again".
export function hostErrorMessage(e: unknown, what: string): string {
  return statusOf(e) === 504 ? `${what} — the desktop app didn't answer. Try again.` : errorText(e);
}

// ---------------------------------------------------------------- POST /api/optimize
// 429: four builds are already running (vault-server.mts's MAX_RUNNING_JOBS). The page only ever
// starts one at a time, so this means other tabs — saying so is what stops it reading as a bug here.
export function optimizeErrorMessage(e: unknown): string {
  return statusOf(e) === 429
    ? "Too many builds are already running — another tab (or an earlier run) still has one going. Wait for it to finish and try again."
    : errorText(e);
}
