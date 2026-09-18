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
