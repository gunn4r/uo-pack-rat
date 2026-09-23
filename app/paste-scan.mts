// paste-scan.mts — making sense of a pasted scan: find the JSON in what the player pasted, parse it,
// and run it through the same upgrade + schema validation an inbox file gets. Pure and browser-safe
// (no node: imports), so the server's POST /api/import/paste (app/import.mts) and the Import drawer's
// instant preview (app/ui/import.mts) apply one rule: the drawer can never call a paste clean that
// the server then refuses, or the other way round. Served to the page at /paste-scan.mjs.
import { upgradeScan, validateScan, type UnvalidatedScan } from "./scan-schema.mts";
import type { ScanV2 } from "./schema/types.d.mts";

// The web-client scanner wraps its printed JSON in these so a player can select-all the console/chat
// output (log noise and all) and paste the whole thing; a paste of the JSON alone must work too.
export const PASTE_BEGIN = "-----BEGIN PACK RAT SCAN-----";
export const PASTE_END = "-----END PACK RAT SCAN-----";

const errMessage = (e: unknown): string => String((e as Error | undefined)?.message ?? e);

// V8's JSON parse error embeds a short excerpt of the bytes it was handed ("Unexpected token 'o',
// \"not json\" is not valid JSON"), and this string is written to rejected/<name>.reason.txt and
// pushed to the page over SSE — a file-content-into-a-displayed-string channel, which matters most
// for exactly the inbox entries we should not have read in the first place. Keep the shape of the
// failure, never the bytes (Phase 7 security review, Area 2, Note 1). app/watcher.mts re-exports it:
// an inbox file and a pasted scan answer a bad document with one rule rather than two.
export function jsonErrorReason(e: unknown): string {
  const msg = errMessage(e);
  if (/unexpected end of json input/i.test(msg)) return "invalid JSON: unexpected end of input (the file looks truncated)";
  const at = /position (\d+)/i.exec(msg);
  return at ? `invalid JSON: syntax error at position ${at[1]}` : "invalid JSON: syntax error";
}

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
// copy that got cut short — so the caller can give a specific error instead of the generic parse
// failure a truncated marker block would otherwise produce (it's neither empty nor un-marked, it's
// just missing its closing half).
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
    // jsonErrorReason, not the raw error: V8's parse message embeds an excerpt of the bytes it was
    // handed, and this string goes straight back to the page as POST /api/import/paste's `error`.
    return { ok: false, error: `${jsonErrorReason(e)} — copy the whole block again, markers included` };
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
