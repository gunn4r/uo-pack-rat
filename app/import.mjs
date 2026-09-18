// import.mjs — the import paths that aren't "an adapter dropped a file and the watcher noticed":
// a player pasting what the ClassicUO web client's sandboxed scanner printed (it cannot write files
// at all), and a manual rescan for a player whose folder watcher missed a drop. Both still end up
// going through app/watcher.mjs the normal way — this module only gets a scan doc INTO an adapter's
// inbox; app/vault-server.mjs nudges the watcher (scanOnce()) the same way POST /api/import already
// does, so acceptance, rejection and the /api/events broadcast are all one code path regardless of
// how the file got into the inbox.
//
// parsePastedScan(text) is pure — no fs, takes and returns values only, so it's cheaply unit
// testable and reusable by anything else that needs to make sense of a paste (Task 3's paste
// transport). writeScanToInbox does the one bit of IO: an atomic temp-then-rename write, named by
// app/watcher.mjs's own acceptedName so a paste-written file and a watcher-ingested file are never
// named by two different rules.
import { mkdirSync, writeFileSync, renameSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { upgradeScan, validateScan } from "./scan-schema.mjs";
import { acceptedName } from "./watcher.mjs";

// The web-client scanner wraps its printed JSON in these so a player can select-all the console/chat
// output (log noise and all) and paste the whole thing; a paste of the JSON alone must work too.
export const PASTE_BEGIN = "-----BEGIN PACK RAT SCAN-----";
export const PASTE_END = "-----END PACK RAT SCAN-----";

// Finds the JSON to parse: the text between a BEGIN/END marker pair if both are present (in order),
// else the whole pasted text trimmed. Never throws.
function extractJsonText(text) {
  const raw = String(text ?? "");
  const beginAt = raw.indexOf(PASTE_BEGIN);
  const endAt = beginAt === -1 ? -1 : raw.indexOf(PASTE_END, beginAt + PASTE_BEGIN.length);
  if (beginAt !== -1 && endAt !== -1) return raw.slice(beginAt + PASTE_BEGIN.length, endAt).trim();
  return raw.trim();
}

// parsePastedScan(text) → {ok:true, doc} | {ok:false, error}. doc is a v2-shaped, schema-valid scan
// (upgradeScan + validateScan, the same normalisation ingestFile applies) ready for writeScanToInbox.
// Deliberately does not stamp a real shard (this function takes no server state, only text): passing
// shard: null makes upgradeScan leave shard null rather than the string/null schema check failing on
// an explicit `undefined` (its own no-option default) for a doc that doesn't already name one. The
// doc lands in the inbox shard-less and picks up whatever shard is active when the watcher's own
// ingestFile reads it back out — same as any other inbox file, no separate rule for a pasted one.
export function parsePastedScan(text) {
  const jsonText = extractJsonText(text);
  if (!jsonText || !/[{[]/.test(jsonText)) {
    return { ok: false, error: `no JSON found in the pasted text — paste the whole block between ${PASTE_BEGIN} and ${PASTE_END}, or the scan JSON by itself` };
  }
  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch (e) {
    return { ok: false, error: `that doesn't look like valid JSON: ${e.message}` };
  }
  let doc;
  try {
    doc = upgradeScan(parsed, { shard: null });
  } catch (e) {
    return { ok: false, error: e.message };
  }
  const { ok, errors } = validateScan(doc);
  if (!ok) return { ok: false, error: `${errors[0].path} ${errors[0].msg}` };
  return { ok: true, doc };
}

// writeScanToInbox({doc, adapter, paths}) — atomic temp-then-rename write of an already-upgraded,
// schema-valid doc into paths.inboxFor(adapter), under the name app/watcher.mjs's own acceptedName
// would give it (collision-checked against whatever's already sitting in that inbox, same as
// ingestFile's own scansDir write). Returns {file, character}. IO only — the caller has already done
// all the parsing/validation via parsePastedScan.
export function writeScanToInbox({ doc, adapter, paths }) {
  const inboxDir = paths.inboxFor(adapter);
  mkdirSync(inboxDir, { recursive: true });
  let existing;
  try { existing = new Set(readdirSync(inboxDir).filter((f) => f.endsWith(".json"))); }
  catch { existing = new Set(); }
  const file = acceptedName(doc, existing);
  const dest = join(inboxDir, file);
  const tmp = `${dest}.tmp`;
  writeFileSync(tmp, JSON.stringify(doc));
  renameSync(tmp, dest);
  return { file, character: doc.character };
}
