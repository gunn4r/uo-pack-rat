// json-file.mts — the one way a store reads and writes a JSON data file: each reader's bad-file policy named (empty, aside, skip), the writer's folder, atomic write, indent and trailing newline, the 409 for a file a newer Pack Rat made, and a file's content stamp for saves that name what they read. Reading names what a bad file means to its reader (onBad); writing creates the folder and replaces the file atomically with the data folder's file mode; refuseNewer keeps a save off a file a newer Pack Rat made.
//
// - "empty": a missing, oversized, unreadable or unparsable file reads as `salvage(undefined)`, and a parsed one as `salvage(doc)`; a salvage that throws on the parsed document reads as an empty file too. Nothing on disk changes.
// - "aside": a bad file (oversized, unparsable, unreadable, or refused by `check`) is moved aside as <file>.corrupt and reported, so the next write cannot overwrite what was in it. A missing file reads as `{missing: true}`. With `ioErrors: "throw"`, a failed read (a missing file included) throws instead, since it says nothing about the file's contents.
// - "skip": any failure throws, for a reader that skips that file and says why (one scan or run in a folder).
//
// The read-modify-write rule: every read-modify-write of a data file has no await between the read and the write (one request runs at a time between awaits), so no other change can land in between and be lost. `update(fn)` (`updater`), which reads, calls the synchronous `fn` and writes, is the way to write one; anything awaited (a request body, the inventory) is awaited before it. The stamp-guarded saves (profiles, Organize's setup) and the single-step saves (item kinds, UI prefs, the house map, the TazUO panel prefs) already read and write in one synchronous step.
//
// map: server
// owns: `readJsonFile`, `writeJsonFile`, `updater`, `newerOnDisk`, `refuseNewer`, `fileStamp`
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { basename, dirname } from "node:path";
import { moveAside, readBounded, writeFileAtomic } from "../atomic-write.mts";
import { DATA_DIR_MODE, DATA_FILE_MODE } from "../config.mts";
import { newerNotice, type DocKind } from "../migrate.mts";
import type { HttpError } from "../read-body.mts";

// The read bound for a reader that names no maxBytes (profiles, settings, UI prefs): far above any file the app writes.
const MAX_UNCAPPED_BYTES = 256 * 1024 * 1024;

// Why a file was not taken: over maxBytes (lstat's size), JSON.parse refused it, the read failed, or check() refused the parsed document.
export type BadJson = { why: "too-big" } | { why: "syntax"; error: SyntaxError } | { why: "io"; error: Error } | { why: "check"; reason: string };
export type JsonRead = { doc: unknown } | { missing: true } | { bad: BadJson; aside: string } | { bad: BadJson; asideError: Error };

export function readJsonFile<T>(path: string, opts: { maxBytes?: number; onBad: "empty"; salvage: (doc: unknown) => T }): T;
export function readJsonFile(path: string, opts: { maxBytes?: number; onBad: "aside"; check?: (doc: unknown) => string | null; ioErrors?: "bad" | "throw" }): JsonRead;
export function readJsonFile(path: string, opts: { maxBytes?: number; onBad: "skip" }): unknown;
export function readJsonFile(path: string, opts: { maxBytes?: number; onBad: "empty" | "aside" | "skip"; salvage?: (doc: unknown) => unknown; check?: (doc: unknown) => string | null; ioErrors?: "bad" | "throw" }): unknown {
  let doc: unknown, bad: BadJson | null = null;
  try {
    const read = readBounded(path, opts.maxBytes ?? MAX_UNCAPPED_BYTES);
    if (read.tooBig) bad = { why: "too-big" };
    else doc = JSON.parse(read.text);
  } catch (e) {
    if (opts.onBad === "empty") return opts.salvage!(undefined);
    if (opts.onBad === "skip" || (opts.ioErrors === "throw" && !(e instanceof SyntaxError))) throw e;
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return { missing: true };
    bad = e instanceof SyntaxError ? { why: "syntax", error: e } : { why: "io", error: e as Error };
  }
  if (opts.onBad === "empty") { if (bad) return opts.salvage!(undefined); try { return opts.salvage!(doc); } catch { return opts.salvage!(undefined); } }
  if (bad && opts.onBad === "skip") throw new Error(`it is over ${opts.maxBytes ?? MAX_UNCAPPED_BYTES} bytes`);
  if (!bad && opts.onBad === "skip") return doc;
  if (!bad) { const reason = opts.check?.(doc); if (reason) bad = { why: "check", reason }; }
  if (!bad) return { doc };
  try { return { bad, aside: moveAside(path) }; } catch (e) { return { bad, asideError: e as Error }; }
}

// The document as JSON with `indent` (none by default) and, unless `newline` is false, a trailing newline.
export function writeJsonFile(path: string, doc: unknown, { indent, newline = true }: { indent?: number; newline?: boolean } = {}): void {
  mkdirSync(dirname(path), { recursive: true, mode: DATA_DIR_MODE });
  writeFileAtomic(path, JSON.stringify(doc, null, indent) + (newline ? "\n" : ""), DATA_FILE_MODE);
}

// A store's update(fn): reads, applies `fn` and writes what it returns, with no await between, so no other change can land in between and be lost. `fn` must be synchronous and is handed the state read-only, so it returns the next one; returning undefined writes nothing. Answers what the file holds after.
export function updater<T>(read: () => T, write: (next: T) => void): (fn: (current: Readonly<T>) => T | undefined) => T {
  return (fn) => {
    const current = read(), next = fn(current);
    if (next === undefined) return current;
    write(next);
    return next;
  };
}

// Why `path` may not be written, or null: the document on disk was made by a newer Pack Rat (app/migrate.mts), and a
// save from this build would lose what it cannot read. A file that is missing or does not parse says nothing.
export function newerOnDisk(path: string, kind: DocKind): string | null {
  let doc: unknown;
  try { doc = JSON.parse(readBounded(path, MAX_UNCAPPED_BYTES).text); } catch { return null; }
  return newerNotice(basename(path), kind, doc);
}
// newerOnDisk as a 409, which the server's request handler answers with its message.
export function refuseNewer(path: string, kind: DocKind): void {
  const why = newerOnDisk(path, kind);
  if (why) throw Object.assign(new Error(why), { statusCode: 409 }) as HttpError;
}
// A file's content stamp (issue #280): 16 hex digits of its SHA-256, or "none" for a missing file (never a stamp). A save
// that names the stamp it read is refused once the file has changed, so two writers cannot overwrite each other.
export const MISSING_STAMP = "none";
export function fileStamp(path: string): string {
  let bytes: Buffer;
  try { bytes = readFileSync(path); } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return MISSING_STAMP; throw e; }
  return createHash("sha256").update(bytes).digest("hex").slice(0, 16);
}
