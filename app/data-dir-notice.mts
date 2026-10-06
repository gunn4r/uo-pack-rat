// data-dir-notice.mts — GET /api/setup's dataDirCheck and the sentence that explains it. Pure and browser-safe:
// the server logs this sentence to the console at startup (app/vault-server.mts) and the page shows it
// (app/ui/messages.mts re-exports it), so the banner and the terminal never disagree. Served to the page at
// /data-dir-notice.mjs.

// app/installer.mts's DataDirCheck, restated here because the page can't import that node:fs module: whether the
// client's installed scripts write to this data folder.
export type DataDirCheckInfo =
  | { status: "none" }
  | { status: "match"; scriptsDir: string }
  | { status: "mismatch"; scriptsDir: string; scriptsDataDir: string; dataDir: string }
  | { status: "unreadable"; scriptsDir: string; error: string };

// The client's scripts writing to one data folder while the app reads another shows up as an empty
// inventory and an offline bridge, and neither says why.
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
