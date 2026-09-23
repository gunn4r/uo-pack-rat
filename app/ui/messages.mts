// ui/messages.mts — the plain sentences the page shows for an outcome the server reports as a count,
// a status code or a one-word field. Pure and DOM-free (no `document`, no imports but a type), for
// the same reason ui/adapters.mts is: a module that touches the DOM at module scope can't be loaded
// under plain `node:test`, and these strings are exactly the part worth pinning with a test (see
// app/ui-messages.test.mts). Every function here takes what `api.mts` throws or returns and gives
// back text — no element, no state, no fetch.
//
// They live in one place because the same outcome reaches the player through more than one panel:
// an install runs from both the wizard's last step and Settings' Reinstall row. Two hand-written copies of
// one sentence is how panels drift apart.
import type { ApiError, DataDirCheckInfo } from "./api-types.mts";

// ---------------------------------------------------------------- reading an api() rejection
export function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
const statusOf = (e: unknown): number | undefined => (e as ApiError)?.status;

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
// The folder names and the parse error come out of a file in the client folder, which may be an
// unpacked third-party archive, so control characters (a terminal escape sequence, a fake newline) are
// dropped before the sentence reaches a terminal.
const printable = (s: string): string => s.replace(/[\u0000-\u001f\u007f-\u009f]/g, "");
export function dataDirNotice(check: DataDirCheckInfo | undefined): string | null {
  if (check?.status === "mismatch") {
    const scripts = printable(check.scriptsDataDir);
    return `Your game scripts in ${printable(check.scriptsDir)} write to ${scripts}, but Pack Rat is reading ${printable(check.dataDir)}, so new scans and the bridge won't show up here. Start Pack Rat on the scripts' folder (npm start -- --data ${scripts}), or reinstall the scripts from Settings so they write to this one.`;
  }
  if (check?.status === "unreadable") {
    return `Pack Rat can't read packrat-paths.json in ${printable(check.scriptsDir)} (${printable(check.error)}), so it can't tell where your game scripts write. Reinstall the scripts from Settings to rewrite it.`;
  }
  return null;
}
// The sidebar's bridge label while the bridge is offline: a mismatch is the one cause the app can name.
export function bridgeOfflineText(check: DataDirCheckInfo | undefined): string {
  return check?.status === "mismatch" ? "Bridge offline — your game scripts write to another folder" : "Bridge offline";
}

// ---------------------------------------------------------------- the sidebar's bridge status control
// Four states (design spec 3.1): ready (green), busy (accent, with what it is doing), offline (grey) and no
// client set up (amber). `label` is the control's one line, which truncates; `title` and `detail` fill its
// popover. A bridge that answers is ready or busy whatever the settings say; one that doesn't is "no client
// set up" only when no client was ever chosen, else offline, with the data-folder mismatch named as its
// cause when that is what it is.
export type BridgeState = "ready" | "busy" | "offline" | "noclient";
export interface BridgeView { state: BridgeState; dot: "ok" | "busy" | "" | "warn"; label: string; title: string; detail: string }
export interface BridgeStatusLike { online: boolean; character?: string | null | undefined; current?: { action?: string | undefined; name?: string | null | undefined } | null | undefined }
export function bridgeView(st: BridgeStatusLike | null, opts: { clientSet: boolean; clientName: string | null; check?: DataDirCheckInfo | undefined }): BridgeView {
  const who = st?.character || "the game";
  if (st?.online && st.current) {
    const doing = `${st.current.action || ""} ${st.current.name || ""}`.trim();
    return { state: "busy", dot: "busy", label: `${who} · ${doing}`, title: "Bridge busy", detail: `packrat-bridge.py is running on ${who} and working through: ${doing}.` };
  }
  if (st?.online) return { state: "ready", dot: "ok", label: `Bridge ready · ${who}`, title: "Bridge ready", detail: `packrat-bridge.py is running on ${who}. Highlight, Grab and Go to reach the game.` };
  if (!opts.clientSet && opts.check?.status !== "mismatch") {
    return { state: "noclient", dot: "warn", label: "No client set up", title: "No client set up", detail: opts.clientName ? `Pack Rat hasn't been told which game client you play on, so in-game actions go to ${opts.clientName} by default. Run setup in Settings to choose.` : "Pack Rat hasn't been told which game client you play on. Run setup in Settings to install its scripts." };
  }
  const where = opts.clientName ? `in ${opts.clientName}` : "in game";
  return { state: "offline", dot: "", label: bridgeOfflineText(opts.check), title: "Bridge offline", detail: dataDirNotice(opts.check) || `Pack Rat can't reach packrat-bridge.py. Press Play on it ${where}; Pack Rat reconnects by itself.` };
}

// ---------------------------------------------------------------- dates
// One format everywhere (design spec 5): relative under a day ("just now", "5 min ago", "3 h ago"), then
// "Jan 1, 12:00", with the year only when it isn't this year's. An unreadable stamp reads as "".
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function relativeWhen(iso: string | null | undefined, now: Date = new Date()): string {
  const t = Date.parse(String(iso || ""));
  if (!Number.isFinite(t)) return "";
  const mins = (now.getTime() - t) / 60_000;
  if (mins >= 0 && mins < 1) return "just now";
  if (mins >= 0 && mins < 60) return `${Math.floor(mins)} min ago`;
  if (mins >= 0 && mins < 24 * 60) return `${Math.floor(mins / 60)} h ago`;
  const d = new Date(t);
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return `${MONTHS[d.getMonth()]} ${d.getDate()}${d.getFullYear() === now.getFullYear() ? "" : `, ${d.getFullYear()}`}, ${hm}`;
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
