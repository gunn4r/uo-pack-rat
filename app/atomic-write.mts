// atomic-write.mts — the one way this app replaces a file: write a randomly-named temp beside it,
// then rename the temp over the destination. A crash, force-quit or power loss mid-write leaves
// either the old file or the new one, never a truncated one. Used for writes into a player-chosen
// folder (app/installer.mts: adapter scripts, packrat-paths.json, imported scans) and for every file
// the server keeps in its own data directory (settings, profiles, saved runs, accepted scans,
// tombstones, a pasted scan's inbox file).
import { lstatSync, renameSync, unlinkSync, writeFileSync, type Stats } from "node:fs";
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
    renameSync(tmp, dest);
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
