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
