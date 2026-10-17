// atomic-write.mts — the one way this app replaces a file: write a randomly-named temp beside it,
// then rename the temp over the destination. A crash, force-quit or power loss mid-write leaves
// either the old file or the new one, never a truncated one. Used for writes into a player-chosen
// folder (app/installer.mts: adapter scripts, packrat-paths.json, imported scans) and for every file
// the server keeps in its own data directory (settings, profiles, saved runs, accepted scans,
// tombstones, a pasted scan's inbox file). moveAside sets an unreadable data file aside as
// <file>.corrupt before the server starts that file afresh.
import { closeSync, constants, existsSync, fstatSync, lstatSync, openSync, readSync, renameSync, unlinkSync, writeFileSync, type Stats } from "node:fs";
import { randomBytes } from "node:crypto";
import { basename } from "node:path";

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

// The one bounded read of a file this app does not trust. Opened with O_NONBLOCK so a FIFO cannot park this
// (single-threaded) process in the open, then fstat on the descriptor actually opened: anything that is not a
// regular file is refused with code ENOTREG, a symlink to a regular file reads as the file. `follow: false` is
// for a folder the player chose, where a link is refused outright: the lstat is the only symlink check win32
// gets (CreateFile traverses a file symlink, and neither O_NOFOLLOW nor O_NONBLOCK exists there, so `?? 0`
// leaves the open plain), and elsewhere O_NOFOLLOW refuses it at the final component. At most `max` bytes come
// back; one more is read so `tooBig` can say the file goes on, and no buffer larger than the file is allocated.
// Failures keep the open/fstat/read error's own code and message (ENOENT for a missing file).
export function readBounded(path: string, max: number, { follow = true }: { follow?: boolean } = {}): { text: string; tooBig: boolean } {
  const notRegular = (): Error => Object.assign(new Error(`${basename(path)} is not a regular file`), { code: "ENOTREG" });
  if (!follow && !lstatSync(path).isFile()) throw notRegular();
  const fd = openSync(path, constants.O_RDONLY | (follow ? 0 : (constants.O_NOFOLLOW ?? 0)) | (constants.O_NONBLOCK ?? 0));
  try {
    const st = fstatSync(fd);
    if (!st.isFile()) throw notRegular();
    const buf = Buffer.allocUnsafe(Math.min(max + 1, st.size));
    let n = 0;
    for (let r = 1; r > 0 && n < buf.length; n += r) r = readSync(fd, buf, n, buf.length - n, n);
    return { text: buf.toString("utf8", 0, Math.min(n, max)), tooBig: n > max };
  } finally { closeSync(fd); }
}
