// import.mts — the import paths that aren't "an adapter dropped a file and the watcher noticed":
// a player pasting what the ClassicUO web client's sandboxed scanner printed (it cannot write files
// at all), and a manual rescan for a player whose folder watcher missed a drop. Both still end up
// going through app/watcher.mts the normal way — this module only gets a scan doc INTO an adapter's
// inbox; app/vault-server.mjs nudges the watcher (scanOnce()) the same way POST /api/import already
// does, so acceptance, rejection and the /api/events broadcast are all one code path regardless of
// how the file got into the inbox.
//
// parsePastedScan(text) is pure — no fs, takes and returns values only, so it's cheaply unit
// testable and reusable by anything else that needs to make sense of a paste (Task 3's paste
// transport). writeScanToInbox does the one bit of IO: an atomic temp-then-rename write, named by
// app/watcher.mts's own acceptedName so a paste-written file and a watcher-ingested file are never
// named by two different rules.
import { mkdirSync, writeFileSync, renameSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { upgradeScan, validateScan, type UnvalidatedScan } from "./scan-schema.mts";
import { acceptedName } from "./watcher.mts";
import type { ConfigPaths } from "./config.mts";
import type { ScanV2 } from "./schema/types.d.mts";

// The web-client scanner wraps its printed JSON in these so a player can select-all the console/chat
// output (log noise and all) and paste the whole thing; a paste of the JSON alone must work too.
export const PASTE_BEGIN = "-----BEGIN PACK RAT SCAN-----";
export const PASTE_END = "-----END PACK RAT SCAN-----";

// Finds the JSON to parse: the text between a BEGIN/END marker pair if both are present (in order),
// else the whole pasted text trimmed. Never throws. Strips every \r/\n from what it returns: valid
// JSON never carries a meaningful raw newline (one is disallowed inside a string per the JSON spec,
// and outside a string it's only ever insignificant formatting whitespace), so removing them is
// always safe — and it's what makes a paste from adapters/classicuo-web/packrat-scanner.ts's compact,
// fixed-width-chunked print loop parse correctly. That scanner prints the COMPACT form of the
// document (no indentation, no whitespace at all) split into arbitrary same-size character chunks,
// one per console line — a chunk boundary can and does land in the middle of a string value, so the
// newline the player's copy/paste reintroduces at that boundary must be discarded, not preserved, to
// get back the original compact string. (The older pretty-printed, one-JSON-line-per-console-line
// form this replaced never had this problem — its line breaks always fell on syntactically safe
// formatting whitespace — but stripping \r/\n is harmless for that form too, so one rule covers both.)
//
// Returns `truncated: true` when a BEGIN marker was found but no matching END — the exact shape of a
// copy that got cut short — so the caller can give a specific error instead of the generic "that
// doesn't look like valid JSON" a truncated marker block would otherwise fail with (it's neither
// empty nor un-marked, it's just missing its closing half).
interface ExtractedJsonText {
  text: string;
  truncated: boolean;
}

function extractJsonText(text: unknown): ExtractedJsonText {
  const raw = String(text ?? "").replace(/[\r\n]+/g, "");
  const beginAt = raw.indexOf(PASTE_BEGIN);
  const endAt = beginAt === -1 ? -1 : raw.indexOf(PASTE_END, beginAt + PASTE_BEGIN.length);
  if (beginAt !== -1 && endAt !== -1) return { text: raw.slice(beginAt + PASTE_BEGIN.length, endAt).trim(), truncated: false };
  if (beginAt !== -1 && endAt === -1) return { text: "", truncated: true };
  return { text: raw.trim(), truncated: false };
}

// parsePastedScan(text) → {ok:true, doc} | {ok:false, error}. doc is a v2-shaped, schema-valid scan
// (upgradeScan + validateScan, the same normalisation ingestFile applies) ready for writeScanToInbox.
// Deliberately does not stamp a real shard (this function takes no server state, only text): passing
// shard: null makes upgradeScan leave shard null rather than the string/null schema check failing on
// an explicit `undefined` (its own no-option default) for a doc that doesn't already name one. The
// doc lands in the inbox shard-less and picks up whatever shard is active when the watcher's own
// ingestFile reads it back out — same as any other inbox file, no separate rule for a pasted one.
// The `error?: undefined`/`doc?: undefined` siblings let a caller (see app/import.test.mts) read
// either field off the union before narrowing on `ok` — e.g. as an assertion failure message — without
// each read site needing its own narrowing or cast; they carry no runtime meaning of their own.
export type ParsePastedScanResult =
  | { ok: true; doc: ScanV2; error?: undefined }
  | { ok: false; error: string; doc?: undefined };

export function parsePastedScan(text: unknown): ParsePastedScanResult {
  const { text: jsonText, truncated } = extractJsonText(text);
  if (truncated) {
    return { ok: false, error: `found ${PASTE_BEGIN} but no ${PASTE_END} — this paste looks truncated; copy the whole console block again, all the way to the END marker` };
  }
  if (!jsonText || !/[{[]/.test(jsonText)) {
    return { ok: false, error: `no JSON found in the pasted text — paste the whole block between ${PASTE_BEGIN} and ${PASTE_END}, or the scan JSON by itself` };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (e) {
    return { ok: false, error: `that doesn't look like valid JSON: ${(e as Error).message}` };
  }
  let doc: UnvalidatedScan;
  try {
    doc = upgradeScan(parsed, { shard: null });
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  const { ok, errors } = validateScan(doc);
  if (!ok) return { ok: false, error: `${errors[0]!.path} ${errors[0]!.msg}` };
  return { ok: true, doc: doc as ScanV2 };
}

// writeScanToInbox({doc, adapter, paths}) — atomic temp-then-rename write of an already-upgraded,
// schema-valid doc into paths.inboxFor(adapter), under the name app/watcher.mts's own acceptedName
// would give it (collision-checked against whatever's already sitting in that inbox, same as
// ingestFile's own scansDir write). Returns {file, character}. IO only — the caller has already done
// all the parsing/validation via parsePastedScan.
export interface WriteScanToInboxParams {
  doc: ScanV2;
  adapter: string;
  paths: ConfigPaths;
}

export interface WriteScanToInboxResult {
  file: string;
  character: string;
}

export function writeScanToInbox({ doc, adapter, paths }: WriteScanToInboxParams): WriteScanToInboxResult {
  const inboxDir = paths.inboxFor(adapter);
  mkdirSync(inboxDir, { recursive: true });
  let existing: Set<string>;
  try { existing = new Set(readdirSync(inboxDir).filter((f) => f.endsWith(".json"))); }
  catch { existing = new Set(); }
  const file = acceptedName(doc, existing);
  const dest = join(inboxDir, file);
  const tmp = `${dest}.tmp`;
  writeFileSync(tmp, JSON.stringify(doc));
  renameSync(tmp, dest);
  return { file, character: doc.character };
}
