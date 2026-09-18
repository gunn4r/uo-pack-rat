// import.test.mjs — app/import.mjs: parsePastedScan's marker-or-bare extraction, JSON/schema
// rejection, and the v1→v2 upgrade it shares with app/watcher.mjs's ingestFile.
// Tags: [fast]. Run: node --test app/import.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parsePastedScan, PASTE_BEGIN, PASTE_END } from "./import.mjs";
import { upgradeScan, validateScan } from "./scan-schema.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const demoKestrel = JSON.parse(readFileSync(join(HERE, "fixtures", "demo-Kestrel.json"), "utf8"));

test("[fast] parsePastedScan accepts a bare JSON document", () => {
  const r = parsePastedScan(JSON.stringify(demoKestrel));
  assert.equal(r.ok, true, r.error);
  assert.equal(r.doc.character, demoKestrel.character);
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
  assert.equal(r.doc.character, demoKestrel.character);
});

test("[fast] parsePastedScan rejects text with no JSON, naming what it looked for", () => {
  const r = parsePastedScan("nothing was copied, just some log lines from the client");
  assert.equal(r.ok, false);
  assert.match(r.error, /no JSON found/);
  assert.match(r.error, new RegExp(PASTE_BEGIN.replace(/[-]/g, "\\-")));
});

test("[fast] parsePastedScan rejects a document that is valid JSON but not a scan", () => {
  const r = parsePastedScan(JSON.stringify({ hello: "world" }));
  assert.equal(r.ok, false);
  assert.match(r.error, /neither v1|v2/);
});

test("[fast] parsePastedScan rejects malformed JSON with a parse error, not a schema error", () => {
  const r = parsePastedScan("{not valid json");
  assert.equal(r.ok, false);
  assert.match(r.error, /JSON/);
});

test("[fast] parsePastedScan rejects an empty paste", () => {
  const r = parsePastedScan("   ");
  assert.equal(r.ok, false);
  assert.match(r.error, /no JSON found/);
});

test("[fast] parsePastedScan upgrades a v1 document the way the watcher does", () => {
  const r = parsePastedScan(JSON.stringify(demoKestrel));
  assert.equal(r.ok, true, r.error);
  const expected = upgradeScan(demoKestrel);
  assert.equal(r.doc.schemaVersion, 2);
  assert.equal(r.doc.adapter.id, expected.adapter.id);
  assert.equal(r.doc.scannedAt, expected.scannedAt);
  assert.deepEqual(r.doc.roots.map((x) => x.opened), expected.roots.map((x) => x.opened));
  assert.ok(r.doc.roots.every((x) => x.opened === true));
});

test("[fast] parsePastedScan: a valid document inside markers still fails schema validation when it's malformed", () => {
  const r = parsePastedScan(`${PASTE_BEGIN}\n${JSON.stringify({ schemaVersion: 2 })}\n${PASTE_END}`);
  assert.equal(r.ok, false);
  assert.ok(r.error.length > 0, r.error);
});

// Post-review fix: a BEGIN marker with no matching END is the exact shape of a truncated copy (the
// player's clipboard cut off before they reached the end of the console block) — it used to fall
// through to the generic bare-JSON path and fail with the unhelpful "that doesn't look like valid
// JSON", indistinguishable from a paste that was never marked at all.
test("[fast] parsePastedScan reports a specific truncated-paste error when BEGIN has no matching END", () => {
  const pasted = [PASTE_BEGIN, JSON.stringify(demoKestrel).slice(0, 50)].join("\n");   // cut off mid-document, no END
  const r = parsePastedScan(pasted);
  assert.equal(r.ok, false);
  assert.match(r.error, /truncated/);
  assert.match(r.error, new RegExp(PASTE_END.replace(/[-]/g, "\\-")));
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
  const chunks = [];
  for (let i = 0; i < compact.length; i += chunkSize) chunks.push(compact.slice(i, i + chunkSize));
  assert.ok(chunks.length > 5, "the fixture should be large enough to actually exercise multiple chunks");
  const pasted = [PASTE_BEGIN, ...chunks, PASTE_END].join("\n");
  const r = parsePastedScan(pasted);
  assert.equal(r.ok, true, r.error);
  assert.equal(r.doc.character, demoKestrel.character);
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
// app/classicuo-web-adapter.test.mjs's own CAPABILITIES-extraction comment for why that distinction
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

  const chunks = [];
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
  assert.equal(r.doc.character, demoKestrel.character + astral, "the astral character survived the real chunkEnd() split and the real parsePastedScan reconstruction intact");
});
