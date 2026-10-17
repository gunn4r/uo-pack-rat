// atomic-write.mts — the one way this app replaces a file: write a randomly-named temp beside it,
// then rename the temp over the destination. A crash, force-quit or power loss mid-write leaves
// either the old file or the new one, never a truncated one. Used for writes into a player-chosen
// folder (app/installer.mts: adapter scripts, packrat-paths.json, imported scans) and for every file
// the server keeps in its own data directory (settings, profiles, saved runs, accepted scans,
// tombstones, a pasted scan's inbox file). moveAside sets an unreadable data file aside as
// <file>.corrupt before the server starts that file afresh.
import { closeSync, constants, existsSync, fstatSync, lstatSync, openSync, readSync, renameSync, unlinkSync, writeFileSync, type Stats } from "node:fs";
import { randomBytes } from "node:crypto";

// The temp name is random, not a fixed "<dest>.new"/"<dest>.tmp". A fixed, published temp name is a
// path an attacker can pre-plant a symlink at, and copyFileSync/writeFileSync follow one — the write
// lands outside the folder, and the rename then moves the SYMLINK into the final name, so every later
// write goes through it too. O_EXCL on top (COPYFILE_EXCL for a copy, flag "wx" for a write) means
// the temp is only ever a file this call itself created, which also closes the TOCTOU window an
// lstat-then-open check on a predictable name would leave open.
function tempNameFor(dest: string): string { return `${dest}.${randomBytes(8).toString("hex")}.new`; }

function fileKind(st: Stats): string {
  if (st.isSymbolicLink()) return "a symlink";
  if (st.isDirectory()) return "a directory";
  if (st.isFIFO()) return "a FIFO";
  if (st.isSocket()) return "a socket";
  return "not a regular file";
}

// Windows refuses a rename onto a file another process has open at that moment (EPERM, EACCES or
// EBUSY): an antivirus or search indexer looking at it, or anything reading it. The hold lasts
// milliseconds, so the rename is tried again for about a second before the write fails; elsewhere a
// rename onto an open file just works, and the first error is final.
const RENAME_WAITS_MS = [10, 20, 40, 80, 160, 320, 400];
export function renameRetrying(from: string, to: string, rename: (from: string, to: string) => void = renameSync, platform: NodeJS.Platform = process.platform): void {
  for (const wait of platform === "win32" ? [...RENAME_WAITS_MS, -1] : [-1]) {
    try { rename(from, to); return; }
    catch (e) {
      if (wait < 0 || !["EPERM", "EACCES", "EBUSY"].includes((e as NodeJS.ErrnoException).code ?? "")) throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, wait);
    }
  }
}
// writeTemp is handed the temp path and must create it with O_EXCL (see tempNameFor). Throws on a
// refusal or a failed write; the temp is removed either way, so a failure leaves nothing behind.
export function atomicReplace(dest: string, writeTemp: (tmp: string) => void): void {
  // lstat, never stat: a symlink at dest is refused by its own type rather than resolved to whatever
  // it points at. An absent dest is the ordinary case, not an error.
  let st: Stats | null = null;
  try { st = lstatSync(dest); } catch { /* absent — nothing to refuse */ }
  if (st && !st.isFile()) throw new Error(`refusing to write ${dest}: it is ${fileKind(st)}`);
  const tmp = tempNameFor(dest);
  try {
    writeTemp(tmp);
    renameRetrying(tmp, dest);
  } catch (e) {
    try { unlinkSync(tmp); } catch { /* never created, or already gone */ }
    throw e;
  }
}

// mode applies to the new file (the temp is created with it, and the rename keeps it); a data-
// directory write passes config.mts's DATA_FILE_MODE, a write into a player's own folder passes none
// and gets the process default.
export function writeFileAtomic(dest: string, body: string, mode?: number): void {
  atomicReplace(dest, (tmp) => writeFileSync(tmp, body, { flag: "wx", ...(mode != null ? { mode } : {}) }));
}

// An unreadable data file is renamed to <file>.corrupt (never overwritten: an older .corrupt keeps
// its name and the new one gets a timestamp) so whatever was in it can still be recovered by hand.
// Returns the name it was kept as, or throws when the rename itself fails.
export function moveAside(file: string): string {
  let aside = `${file}.corrupt`;
  if (existsSync(aside)) aside = `${file}.corrupt-${Date.now()}`;
  renameSync(file, aside);
  return aside;
}

// The lstat refuses a name that is not a regular file before anything is opened — the only symlink
// check win32 gets: neither O_NOFOLLOW nor O_NONBLOCK exists there (`?? 0` leaves the open plain), and
// CreateFile DOES traverse a file symlink (a CI run on windows-latest read straight through one).
// Elsewhere O_NOFOLLOW refuses a symlink at the final component, O_NONBLOCK keeps a FIFO from parking
// this (single-threaded) process forever, and the fstat makes both TOCTOU-proof: it describes the fd
// actually opened, not a name that could have changed since the lstat. Windows has no
// FIFO-in-a-directory case. null means "not readable as a regular file", which every caller treats the
// same as absent. At most `max` bytes are read, and no buffer larger than the file is allocated.
export function readRegularFile(path: string, max: number): string | null {
  try { if (!lstatSync(path).isFile()) return null; } catch { return null; }
  const flags = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0);
  let fd: number;
  try { fd = openSync(path, flags); } catch { return null; }
  try {
    const st = fstatSync(fd);
    if (!st.isFile()) return null;
    const buf = Buffer.allocUnsafe(Math.min(max, st.size));
    const n = readSync(fd, buf, 0, buf.length, 0);
    return buf.toString("utf8", 0, n);
  } catch { return null; }
  finally { closeSync(fd); }
}
