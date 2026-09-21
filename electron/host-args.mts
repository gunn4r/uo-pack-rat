// host-args.mts — the runtime checks electron/main.mts runs on the two host-bridge arguments before
// they reach an OS call (shell.openPath, dialog.showOpenDialog). Both values arrive over
// process.parentPort from the server child, which is the lower-trust half of the split
// electron/README.md's "Why a utility process" describes — so a value it sends is `unknown` here in
// exactly the way an HTTP request body is `unknown` in app/vault-server.mts, and protocol.mts's
// "matching `type` is ALL that is checked" note is the reason these two need a check of their own.
//
// They live in their own module, rather than inside main.mts beside their one caller, because
// main.mts imports `electron` at the top level and so cannot be loaded by a plain `node:test` process
// at all. Pulling the two pure decisions out is what lets scripts/electron-guards.test.mts drive them
// with real forged values instead of asserting on main.mts's source text (phase-7 security review,
// Important 1 and Minor 1). Nothing else belongs here: this module stays dependency-free and
// side-effect-free so the test can import it directly.

// openPath's wire value is a DISCRIMINATOR, never a path: main.mts owns the two directories it maps
// to (dataDir, and logs inside it), so a compromised server child cannot name a third one and have
// the OS launch it. Returns the directory to open, or null for anything else — the caller logs the
// refusal and performs no OS call.
//
// The two legacy arms accept a value that is byte-identical to one of those two directories, because
// app/vault-server.mts's POST /api/host/open-path resolved the path itself before this change
// (`host.openPath(which === "data" ? CONFIG.dataDir : CONFIG.paths.logs)`) and both sides derive the
// same strings from the same PACKRAT_DATA: main.mts resolve()s it and joins "logs", app/config.mts
// does the identical pair. They are an exact-string equality against a value main.mts computed, not
// a path check — a path that merely resolves or normalises to one of them is still refused.
export function openPathTarget(which: unknown, dataDir: string, logsDir: string): string | null {
  if (which === "data" || which === dataDir) return dataDir;
  if (which === "logs" || which === logsDir) return logsDir;
  return null;
}

// A native folder chooser is app-modal and wears whatever title it is given, so the value that
// crosses two process hops to get here is coerced rather than trusted: a non-string becomes
// undefined (Electron then draws its own default title), and a string is stripped of the control
// characters that would let it fake extra lines of dialog text and capped well below anything a real
// title needs. Returns undefined rather than "" for an empty result so the property can be dropped
// from the options object entirely.
const MAX_DIALOG_TITLE = 120;
export function dialogTitle(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, MAX_DIALOG_TITLE);
  return clean.length > 0 ? clean : undefined;
}
