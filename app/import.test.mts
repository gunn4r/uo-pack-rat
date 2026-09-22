// import.test.mts — app/import.mts: parsePastedScan's marker-or-bare extraction, JSON/schema
// rejection, the v1→v2 upgrade it shares with app/watcher.mts's ingestFile, and writeScanToInbox's
// own write.
// Tags: [fast]. Run: node --test app/import.test.mts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, readdirSync, mkdtempSync, symlinkSync, lstatSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parsePastedScan, writeScanToInbox, PASTE_BEGIN, PASTE_END } from "./import.mts";
import { acceptedName } from "./watcher.mts";
import { upgradeScan, validateScan } from "./scan-schema.mts";
import type { ConfigPaths } from "./config.mts";
import type { ScanV2 } from "./schema/types.d.mts";

const HERE = dirname(fileURLToPath(import.meta.url));
const demoKestrel = JSON.parse(readFileSync(join(HERE, "fixtures", "demo-Kestrel.json"), "utf8")) as ScanV2;

test("[fast] parsePastedScan accepts a bare JSON document", () => {
  const r = parsePastedScan(JSON.stringify(demoKestrel));
  assert.equal(r.ok, true, r.error);
  assert.equal(r.doc!.character, demoKestrel.character);
  const v = validateScan(r.doc);
  assert.equal(v.ok, true, JSON.stringify(v.errors));
});

test("[fast] parsePastedScan finds the document inside a marked block with log noise around it", () => {
  const pasted = [
    "TazUO Legion console — packrat-scanner.py",
    "[12:00:01] scanning backpack…",
    PASTE_BEGIN,
    JSON.stringify(demoKestrel),
    PASTE_END,
    "[12:00:04] done.",
  ].join("\n");
  const r = parsePastedScan(pasted);
  assert.equal(r.ok, true, r.error);
  assert.equal(r.doc!.character, demoKestrel.character);
});

test("[fast] parsePastedScan rejects text with no JSON, naming what it looked for", () => {
  const r = parsePastedScan("nothing was copied, just some log lines from the client");
  assert.equal(r.ok, false);
  assert.match(r.error!, /no JSON found/);
  assert.match(r.error!, new RegExp(PASTE_BEGIN.replace(/[-]/g, "\\-")));
});

test("[fast] parsePastedScan rejects a document that is valid JSON but not a scan", () => {
  const r = parsePastedScan(JSON.stringify({ hello: "world" }));
  assert.equal(r.ok, false);
  assert.match(r.error!, /neither v1|v2/);
});

test("[fast] parsePastedScan rejects malformed JSON with a parse error, not a schema error", () => {
  const r = parsePastedScan("{not valid json");
  assert.equal(r.ok, false);
  assert.match(r.error!, /JSON/);
});

test("[fast] parsePastedScan rejects an empty paste", () => {
  const r = parsePastedScan("   ");
  assert.equal(r.ok, false);
  assert.match(r.error!, /no JSON found/);
});

test("[fast] parsePastedScan upgrades a v1 document the way the watcher does", () => {
  const r = parsePastedScan(JSON.stringify(demoKestrel));
  assert.equal(r.ok, true, r.error);
  const doc = r.doc!;
  // demoKestrel is a known-good v1 fixture, so upgradeScan's own output here is a real ScanV2 shape —
  // this test compares it field-by-field against parsePastedScan's, it doesn't re-validate it.
  const expected = upgradeScan(demoKestrel) as ScanV2;
  assert.equal(doc.schemaVersion, 2);
  assert.equal(doc.adapter.id, expected.adapter.id);
  assert.equal(doc.scannedAt, expected.scannedAt);
  assert.deepEqual(doc.roots.map((x) => x.opened), expected.roots.map((x) => x.opened));
  assert.ok(doc.roots.every((x) => x.opened === true));
});

test("[fast] parsePastedScan: a valid document inside markers still fails schema validation when it's malformed", () => {
  const r = parsePastedScan(`${PASTE_BEGIN}\n${JSON.stringify({ schemaVersion: 2 })}\n${PASTE_END}`);
  assert.equal(r.ok, false);
  assert.ok(r.error!.length > 0, r.error);
});

// Post-review fix: a BEGIN marker with no matching END is the exact shape of a truncated copy (the
// player's clipboard cut off before they reached the end of the console block) — it used to fall
// through to the generic bare-JSON path and fail with the unhelpful "that doesn't look like valid
// JSON", indistinguishable from a paste that was never marked at all.
test("[fast] parsePastedScan reports a specific truncated-paste error when BEGIN has no matching END", () => {
  const pasted = [PASTE_BEGIN, JSON.stringify(demoKestrel).slice(0, 50)].join("\n");   // cut off mid-document, no END
  const r = parsePastedScan(pasted);
  assert.equal(r.ok, false);
  assert.match(r.error!, /truncated/);
  assert.match(r.error!, new RegExp(PASTE_END.replace(/[-]/g, "\\-")));
});

// adapters/classicuo-web/packrat-scanner.ts's print loop prints the COMPACT (whitespace-free) form of
// the document split into same-size character chunks, one console line per chunk — a chunk boundary
// can land in the middle of a string value, so the newline the player's copy/paste reintroduces at
// each boundary must be discarded to reconstruct the original compact JSON, not preserved as if it
// were meaningful formatting. This simulates exactly that: chunk a compact document at a size small
// enough to guarantee at least one cut lands inside a string value (a character name), rejoin the
// chunks with "\n" the way a real console copy would, wrap in markers, and confirm it still parses.
test("[fast] parsePastedScan reconstructs a compact scan pasted as newline-joined fixed-size chunks, even split mid-string", () => {
  const compact = JSON.stringify(demoKestrel);
  const chunkSize = 17;   // small and not a divisor of any obviously-aligned field, to force mid-token cuts
  const chunks: string[] = [];
  for (let i = 0; i < compact.length; i += chunkSize) chunks.push(compact.slice(i, i + chunkSize));
  assert.ok(chunks.length > 5, "the fixture should be large enough to actually exercise multiple chunks");
  const pasted = [PASTE_BEGIN, ...chunks, PASTE_END].join("\n");
  const r = parsePastedScan(pasted);
  assert.equal(r.ok, true, r.error);
  assert.equal(r.doc!.character, demoKestrel.character);
});

// Re-review follow-up (surrogate-pair chunking): the print loop's chunk boundary can land in the
// middle of a UTF-16 surrogate pair (an astral character -- outside the Basic Multilingual Plane,
// encoded as a HIGH surrogate followed by a LOW surrogate -- e.g. an emoji in an engraved item name).
// Splitting one corrupts that one character on any environment along the copy/paste path that
// doesn't preserve a lone unpaired surrogate byte-for-byte, with no parse error to notice (JSON.parse
// happily accepts a lone surrogate inside a string). adapters/classicuo-web/packrat-scanner.ts's
// chunkEnd() backs the boundary off by one whenever it would end on a high surrogate. This loads and
// exercises the REAL, shipped chunkEnd() -- via node:module's stripTypeScriptTypes plus a data: URL
// import, not a reimplementation and not new Function/eval on extracted source (see
// app/classicuo-web-adapter.test.mts's own CAPABILITIES-extraction comment for why that distinction
// matters here) -- and proves the round trip through the real parsePastedScan survives even when the
// chunk size is chosen specifically to force the split.
test("[fast] parsePastedScan survives a real astral character split across a chunk boundary by the scanner's own chunkEnd()", async () => {
  const { stripTypeScriptTypes } = await import("node:module");
  const scannerPath = join(HERE, "..", "adapters", "classicuo-web", "packrat-scanner.ts");
  const scannerSrc = readFileSync(scannerPath, "utf8");
  const m = /function chunkEnd\(text: string, start: number, size: number\): number \{[\s\S]*?\n\}/.exec(scannerSrc);
  assert.ok(m, "packrat-scanner.ts: could not find chunkEnd() -- did it move or get renamed?");
  const stripped = stripTypeScriptTypes(`export ${m[0]}`, { mode: "strip" });
  const { chunkEnd } = await import(`data:text/javascript,${encodeURIComponent(stripped)}`);

  // An actual astral character, built from its two UTF-16 code units rather than written as a
  // literal escape sequence in this source file (U+1F600, GRINNING FACE: high surrogate 0xD83D, low
  // surrogate 0xDE00).
  const astral = String.fromCharCode(0xd83d, 0xde00);
  const doc = { ...demoKestrel, character: demoKestrel.character + astral };
  const compact = JSON.stringify(doc);
  const astralAt = compact.indexOf(astral);
  assert.ok(astralAt > 0, "the astral character should actually be present in the compact document");
  // A chunk size that ends the first chunk exactly one code unit into the pair -- the precise
  // boundary that would split it if chunkEnd() didn't back off.
  const chunkSize = astralAt + 1;

  const chunks: string[] = [];
  for (let i = 0; i < compact.length;) {
    const end = chunkEnd(compact, i, chunkSize);
    assert.ok(end > i, "chunkEnd() must always make forward progress");
    chunks.push(compact.slice(i, end));
    i = end;
  }
  assert.ok(chunks.length > 3, "the fixture should be large enough to actually exercise multiple chunks");
  // Direct proof no boundary split the pair: no chunk but the last ends on a high surrogate.
  for (const c of chunks.slice(0, -1)) {
    const lastUnit = c.charCodeAt(c.length - 1);
    assert.ok(!(lastUnit >= 0xd800 && lastUnit <= 0xdbff), `a chunk ended on a high surrogate: ${JSON.stringify(c)}`);
  }

  const pasted = [PASTE_BEGIN, ...chunks, PASTE_END].join("\n");
  const r = parsePastedScan(pasted);
  assert.equal(r.ok, true, r.error);
  assert.equal(r.doc!.character, demoKestrel.character + astral, "the astral character survived the real chunkEnd() split and the real parsePastedScan reconstruction intact");
});

// ---- the parse error never carries the pasted bytes ----------------------------------------------
// V8's own JSON parse message quotes an excerpt of what it was handed, and POST /api/import/paste
// returns this string to the page verbatim. app/watcher.mts already refused to do that for an inbox
// file (jsonErrorReason); the paste path is the same channel and now shares the same rule.
test("[fast] a parse failure reports the shape of the error, never the pasted text", () => {
  const secret = "correct-horse-battery-staple";
  const r = parsePastedScan(`{"token": ${secret}}`);
  assert.equal(r.ok, false);
  assert.doesNotMatch(r.error!, new RegExp(secret), `the paste's own bytes must not come back in ${JSON.stringify(r.error)}`);
  assert.match(r.error!, /invalid JSON/);
});

test("[fast] a document cut short reports the shape of the failure, not an excerpt of it", () => {
  const r = parsePastedScan(JSON.stringify(demoKestrel).slice(0, 200));   // no markers, just cut short
  assert.equal(r.ok, false);
  assert.match(r.error!, /invalid JSON/);
  assert.doesNotMatch(r.error!, new RegExp(demoKestrel.character), "not even the character name is echoed back");
});

// ---- writeScanToInbox ----------------------------------------------------------------------------
// The write used to go through a predictable "<dest>.tmp", which is a path something else can plant a
// symlink at; writeFileSync follows one, so the bytes land wherever it points and the rename moves
// the LINK into the scan's final name. It goes through app/installer.mts's atomicReplace now (random
// O_EXCL temp, a destination that must be absent or a regular file) — the same helper importScans'
// own copies use.
function pathsFor(inboxDir: string): ConfigPaths {
  // Only inboxFor is reached by writeScanToInbox; the cast names that rather than building a whole
  // resolved config for a function that reads one key (app/config.test.mts covers the real thing).
  return { inboxFor: () => inboxDir } as unknown as ConfigPaths;
}
// The fixture is a v1 document; writeScanToInbox takes what parsePastedScan hands it, which is the
// upgraded one (acceptedName needs the RFC 3339 scannedAt that upgrade produces).
const pastedKestrel = (): ScanV2 => {
  const r = parsePastedScan(JSON.stringify(demoKestrel));
  assert.equal(r.ok, true, r.error);
  return r.doc!;
};

test("[fast] writeScanToInbox lands the doc under its accepted name and leaves no temp file behind", () => {
  const inboxDir = mkdtempSync(join(tmpdir(), "qm-paste-write-"));
  const { file, character } = writeScanToInbox({ doc: pastedKestrel(), adapter: "tazuo", paths: pathsFor(inboxDir) });
  assert.equal(character, demoKestrel.character);
  assert.deepEqual(readdirSync(inboxDir), [file], "the accepted name, and nothing else");
  assert.equal((JSON.parse(readFileSync(join(inboxDir, file), "utf8")) as ScanV2).character, demoKestrel.character);
});

test("[fast] writeScanToInbox does not write through a symlink planted at the old predictable temp name", () => {
  const inboxDir = mkdtempSync(join(tmpdir(), "qm-paste-link-"));
  const outside = mkdtempSync(join(tmpdir(), "qm-paste-outside-"));
  const canary = join(outside, "canary.json");
  writeFileSync(canary, '{"untouched": true}');
  const doc = pastedKestrel();
  const expected = acceptedName(doc, new Set());
  // "<dest>.tmp" was the name this function used to write every pasted scan through. The link is not
  // itself a *.json name, so it doesn't collide with the doc's accepted name — under the old write it
  // was simply followed, putting the scan's bytes in the canary and then renaming the LINK into place.
  try { symlinkSync(canary, join(inboxDir, `${expected}.tmp`)); }
  catch { return; }   // symlink creation needs elevated privilege on Windows — same early return as installer.test.mts

  const { file } = writeScanToInbox({ doc, adapter: "tazuo", paths: pathsFor(inboxDir) });
  assert.equal(file, expected);
  assert.deepEqual(JSON.parse(readFileSync(canary, "utf8")), { untouched: true }, "the link's target was never written through");
  assert.equal(lstatSync(join(inboxDir, file)).isFile(), true, "the scan landed as a real file, not as the moved link");
  assert.equal((JSON.parse(readFileSync(join(inboxDir, file), "utf8")) as ScanV2).character, demoKestrel.character);
});
