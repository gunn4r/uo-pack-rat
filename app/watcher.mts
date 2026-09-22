// watcher.mts — inbox ingestion: adapters drop scan files into <data>/inbox/<adapter>/ (temp-then-
// rename, per adapter contract) instead of writing straight into <data>/scans/. This file turns an
// inbox file into a normalised, schema-valid v2 scan under <data>/scans/, and watches an inbox
// directory for new drops (plus a startup sweep for files that landed while the app was closed).
//
// acceptedName(doc, existingNames) — the scans/ filename for a v2 doc: <slug>-<stamp>.json, slug =
// character with anything outside [A-Za-z0-9_-] turned to "_", stamp = scannedAt with ":" removed
// and "-" removed from the date/time (kept only as the offset's sign, if any; "Z" stays "Z");
// collisions against existingNames get "-2", "-3", ... appended before ".json".
//
// ingestFile({path, scansDir, shard, log}) — read + JSON.parse the inbox file, upgradeScan it,
// validateScan it, write the result into scansDir under its acceptedName (temp-then-rename), then
// unlink the inbox file. Returns {ok:true, file, character, scannedAt, warning?, duplicate?} or
// {ok:false, reason}; never throws (a parse/upgrade/validate failure, or an I/O failure during the
// write step itself, is reported through the reason instead — so a caller retry/reject loop always
// sees a normal result). Idempotent: if scansDir already holds a file under this doc's accepted name
// (with or without a collision suffix) whose own character+scannedAt match, the doc is already
// ingested — the write is skipped, only the inbox cleanup is (re)attempted, and the result carries
// duplicate:true so a caller doesn't treat it as a fresh accept. This is what makes a file that gets
// stuck in the inbox (its unlink failed once — see below) safe to re-see later, including after a
// real process restart, since this check reads scansDir itself rather than relying on anything kept
// in memory. Otherwise the accept/reject contract is decided by the write into scansDir alone: once
// that rename succeeds the file IS ingested, so a failure to then remove the now-redundant inbox copy
// (the final unlink) is reported as ok:true with a `warning` string instead of ok:false — retrying a
// successful ingest as a whole would write a second accepted copy of the same doc under a
// collision-avoided name, which is exactly what the idempotency check above prevents on the next call.
//
// startWatcher({inboxDir, adapter, scansDir, getShard, log, onAccepted, onRejected, debounceMs,
// retries, retryDelayMs, watch}) — creates inboxDir, watches it (non-recursive) for *.json changes
// (debounced per filename), and runs scanOnce() once immediately so files dropped while the app was
// closed are picked up. getShard() is called fresh right before each ingestFile() call (not once at
// startup) so a shard switch via /api/settings takes effect on the very next file, not just after a
// restart. A file that keeps failing ingestFile after `retries` attempts (retryDelayMs apart — a
// half-written temp-then-rename can look invalid for a moment, and a transient write failure such as
// a full disk counts as a failed attempt the same way) is moved to inboxDir/rejected/<name> with a
// <name>.reason.txt beside it. A duplicate result (see ingestFile above) never calls onAccepted, since
// nothing new was ingested. Every file (from an event or from scanOnce) is processed through one
// promise chain, so two files' ingestion never interleaves; every await is guarded by a `closed` flag
// so a close() mid-retry cuts the chain short instead of running past it.
import {
  existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, renameSync, unlinkSync, lstatSync,
  watch as fsWatch, type WatchListener,
} from "node:fs";
import { join } from "node:path";
import { upgradeScan, validateScan, type UnvalidatedScan } from "./scan-schema.mts";
import type { ScanV2 } from "./schema/types.d.mts";

const SCANNED_AT_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?([+-]\d{2}:\d{2}|Z)$/;

// The ceiling on an inbox file, in bytes. POST /api/import/paste has always been capped (readBody's
// 50 MB default) but the folder-drop path — the primary one — was not, and reading a scan costs
// roughly 9x its size in RSS: the band between ~200 MB and V8's ~512 MB max string length lands in
// heap OOM, which is an uncatchable abort that repeats on every restart because the startup sweep
// re-reads the same file. A real TazUO scan of a full bank is well under 10 MB (Phase 7 security
// review, Area 2, Important 5).
export const MAX_INBOX_BYTES = 32 * 1024 * 1024;

const errMessage = (e: unknown): string => String((e as Error | undefined)?.message ?? e);

// V8's JSON parse error embeds a short excerpt of the bytes it was handed ("Unexpected token 'o',
// \"not json\" is not valid JSON"), and this string is written to rejected/<name>.reason.txt and
// pushed to the page over SSE — a file-content-into-a-displayed-string channel, which matters most
// for exactly the inbox entries we should not have read in the first place. Keep the shape of the
// failure, never the bytes (Phase 7 security review, Area 2, Note 1).
// Exported for app/import.mts: a pasted scan reaches the page the same way (POST /api/import/paste's
// own `error`), so the two answer a bad document with one rule rather than two.
export function jsonErrorReason(e: unknown): string {
  const msg = errMessage(e);
  if (/unexpected end of json input/i.test(msg)) return "invalid JSON: unexpected end of input (the file looks truncated)";
  const at = /position (\d+)/i.exec(msg);
  return at ? `invalid JSON: syntax error at position ${at[1]}` : "invalid JSON: syntax error";
}

function stampFor(scannedAt: unknown): string {
  const m = SCANNED_AT_RE.exec(String(scannedAt));
  if (!m) throw new TypeError(`acceptedName: not an RFC 3339 scannedAt: ${scannedAt}`);
  const [, y, mo, d, h, mi, s, off] = m as unknown as [string, string, string, string, string, string, string, string];
  return `${y}${mo}${d}T${h}${mi}${s}${off === "Z" ? "Z" : off.replace(":", "")}`;
}

// The doc shapes acceptedName/findExistingAccepted are called with: a full UnvalidatedScan/ScanV2 from
// ingestFile/writeScanToInbox, or (in tests only) a bare {character, scannedAt} fixture — so the
// parameter is the minimal read-only shape both satisfy, not the full scan type.
export interface NamedScan {
  character?: unknown;
  scannedAt: unknown;
}

export function acceptedName(doc: NamedScan, existingNames: Set<string> = new Set()): string {
  const slug = String(doc.character ?? "").replace(/[^A-Za-z0-9_-]/g, "_");
  const stamp = stampFor(doc.scannedAt);
  const base = `${slug}-${stamp}`;
  let name = `${base}.json`;
  for (let n = 2; existingNames.has(name); n++) name = `${base}-${n}.json`;
  return name;
}

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// A file already in scansDir under this doc's accepted base name (with or without a "-2"/"-3"...
// collision suffix) whose own character+scannedAt match doc's is the SAME scan already ingested —
// makes ingestFile idempotent against a stuck/duplicated inbox file. Reads scansDir directly (no
// in-memory state), so this holds across a process restart too. Returns the matching filename or null.
function findExistingAccepted(scansDir: string, doc: NamedScan): string | null {
  let names: string[];
  try { names = readdirSync(scansDir).filter((f) => f.endsWith(".json")); }
  catch { return null; }
  const base = acceptedName(doc, new Set()).slice(0, -".json".length);
  const re = new RegExp(`^${escapeRegExp(base)}(?:-\\d+)?\\.json$`);
  for (const name of names) {
    if (!re.test(name)) continue;
    let existingDoc: UnvalidatedScan;
    try { existingDoc = JSON.parse(readFileSync(join(scansDir, name), "utf8")) as UnvalidatedScan; }
    catch { continue; }   // unreadable/corrupt existing file — not a usable match
    if (existingDoc.character === doc.character && existingDoc.scannedAt === doc.scannedAt) return name;
  }
  return null;
}

export interface IngestFileParams {
  path: string;
  scansDir: string;
  shard?: string | null | undefined;
  log?: (msg: string) => void;
}

// The undefined-typed siblings on each branch let a caller (see app/watcher.test.mts) read any field
// off the union before narrowing on `ok` — e.g. as an assertion failure message — without each read
// site needing its own narrowing or cast; they carry no runtime meaning of their own.
export type IngestFileResult =
  | { ok: true; file: string; character: string; scannedAt: string; duplicate?: true; warning?: string; reason?: undefined }
  | { ok: false; reason: string; file?: undefined; character?: undefined; scannedAt?: undefined; duplicate?: undefined; warning?: undefined };

export function ingestFile({ path, scansDir, shard, log = () => {} }: IngestFileParams): IngestFileResult {
  // Stat before read: lstat (not stat) so a symlink is seen as a symlink rather than followed into
  // whatever it points at, and the size is checked against MAX_INBOX_BYTES while the file is still
  // just an inode. Neither check ever opens the file.
  let size: number;
  try {
    const st = lstatSync(path);
    if (!st.isFile()) return { ok: false, reason: "not a regular file (an inbox entry that is a symlink, directory or device is never read)" };
    size = st.size;
  } catch (e) {
    return { ok: false, reason: `could not read: ${errMessage(e)}` };
  }
  if (size > MAX_INBOX_BYTES) return { ok: false, reason: `too large: ${size} bytes, the limit is ${MAX_INBOX_BYTES}` };
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (e) {
    return { ok: false, reason: `could not read: ${errMessage(e)}` };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { ok: false, reason: jsonErrorReason(e) };
  }
  let doc: UnvalidatedScan;
  try {
    doc = upgradeScan(raw, { shard });
  } catch (e) {
    return { ok: false, reason: errMessage(e) };
  }
  const { ok, errors } = validateScan(doc);
  if (!ok) return { ok: false, reason: `${errors[0]!.path} ${errors[0]!.msg}` };
  const scan = doc as ScanV2;

  const existingAccepted = findExistingAccepted(scansDir, scan);
  if (existingAccepted) {
    let warning: string | undefined;
    try { unlinkSync(path); }
    catch (e) { warning = `duplicate of ${existingAccepted} but could not remove it from the inbox: ${errMessage(e)}`; }
    log(warning ?? `duplicate of ${existingAccepted}, removed from inbox`);
    return { ok: true, file: existingAccepted, character: scan.character, scannedAt: scan.scannedAt, duplicate: true, ...(warning ? { warning } : {}) };
  }

  let file: string, tmp: string | undefined;
  try {
    mkdirSync(scansDir, { recursive: true });
    let existing: Set<string>;
    try { existing = new Set(readdirSync(scansDir).filter((f) => f.endsWith(".json"))); }
    catch { existing = new Set(); }
    file = acceptedName(scan, existing);
    const dest = join(scansDir, file);
    tmp = `${dest}.tmp`;
    writeFileSync(tmp, JSON.stringify(scan));
    renameSync(tmp, dest);
  } catch (e) {
    // Any of the writes above can throw (disk full, permissions, scansDir yanked out from under us).
    // Report it as an ordinary ok:false so the caller's retry/reject contract still applies to it —
    // an uncaught throw here would otherwise escape processFile's retry loop entirely and orphan the
    // file with no further watch event to retrigger it.
    if (tmp) { try { unlinkSync(tmp); } catch { /* tmp was never written, or already gone */ } }
    return { ok: false, reason: `write failed: ${errMessage(e)}` };
  }

  // The doc is already safely in scansDir under `file` at this point — ingestion has succeeded.
  // Removing the now-redundant inbox copy is best-effort cleanup, not part of the accept/reject
  // contract: if this unlink is reported as a failure the caller would retry the whole ingestFile,
  // re-reading the same inbox file and writing a SECOND accepted copy under a collision-avoided name
  // — one drop becoming two scans. So a failed unlink is a warning alongside ok:true, never a reason
  // to retry or quarantine.
  let warning: string | undefined;
  try {
    unlinkSync(path);
  } catch (e) {
    warning = `accepted ${file} but could not remove it from the inbox: ${errMessage(e)}`;
  }
  log(warning ?? `accepted ${path} -> ${file}`);
  return { ok: true, file, character: scan.character, scannedAt: scan.scannedAt, ...(warning ? { warning } : {}) };
}

interface PendingDelay {
  timer: NodeJS.Timeout | null;
  resolve: () => void;
}

const delayFactory = (pending: Set<PendingDelay>) => (ms: number): Promise<void> => new Promise<void>((resolve) => {
  const entry: PendingDelay = { timer: null, resolve };
  entry.timer = setTimeout(() => { pending.delete(entry); resolve(); }, ms);
  pending.add(entry);
});

// The shape of the injectable `watch` option: node:fs's own `watch(filename, listener)` overload
// (WatchListener<string>'s event is "rename"|"change", filename is string|null under strict types —
// the code below already copes with a null filename), narrowed to just the call shape and the
// `.close()` this file actually uses, so watcher.test.mts's fake `watch` (which returns a plain
// {close} object, not a real FSWatcher) satisfies it too.
export type WatchFn = (dir: string, listener: WatchListener<string>) => { close: () => void };

export interface StartWatcherOnAcceptedInfo {
  file: string;
  character: string;
  scannedAt: string;
}

export interface StartWatcherOnRejectedInfo {
  file: string;
  reason: string;
}

export interface StartWatcherOptions {
  inboxDir: string;
  adapter: string;
  scansDir: string;
  getShard?: () => string | null | undefined;
  log?: (msg: string) => void;
  onAccepted?: (info: StartWatcherOnAcceptedInfo) => void;
  onRejected?: (info: StartWatcherOnRejectedInfo) => void;
  debounceMs?: number;
  retries?: number;
  retryDelayMs?: number;
  watch?: WatchFn;
}

export interface WatcherHandle {
  scanOnce: () => void;
  close: () => void;
}

export function startWatcher(
  {
    inboxDir, adapter, scansDir, getShard = () => undefined,
    log = () => {}, onAccepted = () => {}, onRejected = () => {},
    debounceMs = 300, retries = 3, retryDelayMs = 700, watch = fsWatch,
  }: StartWatcherOptions = {} as StartWatcherOptions,   // every real call site supplies inboxDir/adapter/scansDir (see app/watcher.test.mts, app/vault-server.mts); this cast is compiler-only, matching config.mts's rawPort pattern
): WatcherHandle {
  mkdirSync(inboxDir, { recursive: true });
  let closed = false;
  const debounceTimers = new Map<string, NodeJS.Timeout>();   // filename -> setTimeout id, reset on a second event
  const pendingDelays = new Set<PendingDelay>();    // in-flight retry waits, resolved early by close()
  const delay = delayFactory(pendingDelays);
  let chain: Promise<void> = Promise.resolve();

  // log/onAccepted/onRejected belong to the caller, and a throw from any of them used to cost the
  // page its `rejected` SSE event — the file was quarantined correctly but vanished from the inbox
  // with nothing said about it. Each is called through one of these, so the watcher's own contract
  // never depends on a subscriber holding up its end (Phase 7 security review, Area 2, Minor 3).
  const safeLog = (msg: string): void => { try { log(msg); } catch { /* a caller's logger must never break ingestion */ } };
  const notifyAccepted = (info: StartWatcherOnAcceptedInfo): void => { try { onAccepted(info); } catch { /* likewise for a subscriber */ } };
  const notifyRejected = (info: StartWatcherOnRejectedInfo): void => { try { onRejected(info); } catch { /* likewise for a subscriber */ } };

  function rejectFile(name: string, reason: string): void {
    const rejectedDir = join(inboxDir, "rejected");
    const src = join(inboxDir, name);
    try {
      if (!existsSync(src)) { safeLog(`rejected ${name} (already gone): ${reason}`); notifyRejected({ file: name, reason }); return; }
      mkdirSync(rejectedDir, { recursive: true });
      const dest = join(rejectedDir, name);
      renameSync(src, dest);
      writeFileSync(`${dest}.reason.txt`, `${reason}\n`);
    } catch (e) {
      reason = `${reason} (also failed to move to rejected/: ${errMessage(e)})`;
    }
    safeLog(`rejected ${name}: ${reason}`);
    notifyRejected({ file: name, reason });
  }

  async function processFile(name: string): Promise<void> {
    for (let attempt = 1; attempt <= retries; attempt++) {
      if (closed) return;
      const path = join(inboxDir, name);
      if (!existsSync(path)) return;   // renamed/removed out from under us — ignored, not rejected

      const result = ingestFile({ path, scansDir, shard: getShard(), log: safeLog });
      if (result.ok) {
        // A duplicate (ingestFile found this doc already in scansDir — a stuck inbox file re-seen by
        // scanOnce, possibly after a restart) means nothing NEW was ingested, so onAccepted must not
        // fire again for it.
        if (!result.duplicate) notifyAccepted({ file: result.file, character: result.character, scannedAt: result.scannedAt });
        return;
      }
      if (attempt === retries) { rejectFile(name, result.reason); return; }
      await delay(retryDelayMs);
    }
  }

  function enqueue(name: string): void {
    chain = chain.then(() => (closed ? undefined : processFile(name)))
      // This catch is the last line of defense for `chain` — if it throws, `chain` stays rejected
      // with no handler, which is an unhandled-rejection crash for the whole process. `log` is
      // supposed to be best-effort (the caller's job — app/vault-server.mts wraps its own appendFileSync
      // in a try/catch for exactly this), but defend against a caller that doesn't hold up its end too
      // (post-review fix, Important 1).
      .catch((e: unknown) => { safeLog(`watcher error on ${name}: ${errMessage(e)}`); });
  }

  function scanOnce(): void {
    if (closed) return;
    let names: string[];
    try { names = readdirSync(inboxDir).filter((f) => f.endsWith(".json")); }
    catch (e) { safeLog(`watcher scanOnce error: ${errMessage(e)}`); return; }
    for (const name of names) enqueue(name);
  }

  function onWatchEvent(_eventType: string, filename: string | null): void {
    try {
      if (closed || !filename) return;
      const name = String(filename).replaceAll("\\", "/");
      if (name.includes("/rejected/") || name.startsWith("rejected/")) return;
      if (!name.endsWith(".json")) return;
      const existingTimer = debounceTimers.get(name);
      if (existingTimer) clearTimeout(existingTimer);
      const t = setTimeout(() => { debounceTimers.delete(name); enqueue(name); }, debounceMs);
      debounceTimers.set(name, t);
    } catch (e) {
      safeLog(`watcher event error: ${errMessage(e)}`);
    }
  }

  const watcher = watch(inboxDir, onWatchEvent);
  safeLog(`watching ${inboxDir} (adapter ${adapter})`);
  scanOnce();   // pick up files that landed while the app was closed

  return {
    scanOnce,
    close() {
      closed = true;
      for (const t of debounceTimers.values()) clearTimeout(t);
      debounceTimers.clear();
      for (const entry of pendingDelays) { clearTimeout(entry.timer!); entry.resolve(); }
      pendingDelays.clear();
      try { watcher.close(); } catch { /* already closed */ }
    },
  };
}
