// json-file.mts — the one way a store reads and writes a JSON data file. Reading names what a bad file means to its reader (onBad); writing creates the folder and replaces the file atomically with the data folder's file mode.
//
// - "empty": a missing, oversized, unreadable or unparsable file reads as `salvage(undefined)`, and a parsed one as `salvage(doc)`; a salvage that throws on the parsed document reads as an empty file too. Nothing on disk changes.
// - "aside": a bad file (oversized, unparsable, unreadable, or refused by `check`) is moved aside as <file>.corrupt and reported, so the next write cannot overwrite what was in it. A missing file reads as `{missing: true}`. With `ioErrors: "throw"`, a failed read (a missing file included) throws instead, since it says nothing about the file's contents.
// - "skip": any failure throws, for a reader that skips that file and says why (one scan or run in a folder).
import { lstatSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { moveAside, writeFileAtomic } from "../atomic-write.mts";
import { DATA_DIR_MODE, DATA_FILE_MODE } from "../config.mts";

// Why a file was not taken: over maxBytes (lstat's size), JSON.parse refused it, the read failed, or check() refused the parsed document.
export type BadJson = { why: "too-big" } | { why: "syntax"; error: SyntaxError } | { why: "io"; error: Error } | { why: "check"; reason: string };
export type JsonRead = { doc: unknown } | { missing: true } | { bad: BadJson; aside: string } | { bad: BadJson; asideError: Error };

export function readJsonFile<T>(path: string, opts: { maxBytes?: number; onBad: "empty"; salvage: (doc: unknown) => T }): T;
export function readJsonFile(path: string, opts: { maxBytes?: number; onBad: "aside"; check?: (doc: unknown) => string | null; ioErrors?: "bad" | "throw" }): JsonRead;
export function readJsonFile(path: string, opts: { maxBytes?: number; onBad: "skip" }): unknown;
export function readJsonFile(path: string, opts: { maxBytes?: number; onBad: "empty" | "aside" | "skip"; salvage?: (doc: unknown) => unknown; check?: (doc: unknown) => string | null; ioErrors?: "bad" | "throw" }): unknown {
  let doc: unknown, bad: BadJson | null = null;
  try {
    if (opts.maxBytes !== undefined && lstatSync(path).size > opts.maxBytes) bad = { why: "too-big" };
    else doc = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    if (opts.onBad === "empty") return opts.salvage!(undefined);
    if (opts.onBad === "skip" || (opts.ioErrors === "throw" && !(e instanceof SyntaxError))) throw e;
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return { missing: true };
    bad = e instanceof SyntaxError ? { why: "syntax", error: e } : { why: "io", error: e as Error };
  }
  if (opts.onBad === "empty") { if (bad) return opts.salvage!(undefined); try { return opts.salvage!(doc); } catch { return opts.salvage!(undefined); } }
  if (bad && opts.onBad === "skip") throw new Error(`it is over ${opts.maxBytes} bytes`);
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
