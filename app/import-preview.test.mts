// import-preview.test.mts — app/ui/import-preview.mts, the Import drawer's preview card as data (design
// spec 4.9): the counts it shows for a real scan, the "already in Pack Rat" line and when it appears, the
// client-mismatch warning, the primary button's sentence and the size readout. The scan is parsed with
// app/paste-scan.mts, the same rule the drawer and POST /api/import/paste use. Lives in app/ for the same
// reason app/wizard-default-adapter.test.mts does (the module is DOM-free; app/ui/ is the browser build).
// Tags: [fast]. Run: node --test app/import-preview.test.mts
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parsePastedScan, PASTE_BEGIN, PASTE_END } from "./paste-scan.mts";
import { importActionLabel, listText, plural, scanPreview, sizeText, sendEach } from "./ui/import-preview.mts";

const HERE = dirname(fileURLToPath(import.meta.url));
const KESTREL = readFileSync(join(HERE, "fixtures", "demo-Kestrel.json"), "utf8");
function kestrel() {
  const r = parsePastedScan(`noise\n${PASTE_BEGIN}\n${KESTREL}\n${PASTE_END}\nmore noise`);
  assert.ok(r.ok, r.error);
  return r.doc;
}
const ADAPTERS = [{ id: "classicuo-web", transport: "paste" }, { id: "tazuo", transport: "folder" }];

test("[fast] a new character's scan: counts from the document, no replace line, the button counts everything", () => {
  const p = scanPreview(kestrel(), { characters: {}, containers: {} });
  assert.deepEqual({ character: p.character, worn: p.worn, stacks: p.stacks, containers: p.containers, total: p.total }, { character: "Kestrel", worn: 8, stacks: 112, containers: 1, total: 120 });
  assert.equal(p.replaces, null);
  assert.deepEqual(p.warnings, []);
  assert.equal(importActionLabel([p]), "Import 120 stacks for Kestrel");
});

test("[fast] a character already in Pack Rat: the replace line names the containers it has seen before", () => {
  const doc = kestrel();
  const root = doc.roots[0]!;
  const seen = scanPreview(doc, { characters: { Kestrel: {} }, containers: { [String(root.serial)]: {} } });
  assert.equal(seen.replaces, "Kestrel is already in Pack Rat. This scan replaces the older one for Metal Chest 0x700b0000 and the worn gear.");
  const unseen = scanPreview(doc, { characters: { Kestrel: {} }, containers: {} });
  assert.equal(unseen.replaces, "Kestrel is already in Pack Rat. This scan replaces their worn gear.");
  assert.equal(scanPreview(doc, null).replaces, null, "no inventory loaded yet: nothing to say");
});

test("[fast] a scan that names another client than the one picked is one warning, in short names", () => {
  const p = scanPreview(kestrel(), null, { adapter: "classicuo-web", adapters: ADAPTERS });
  assert.deepEqual(p.warnings, ["This scan says it came from TazUO, but ClassicUO web client is picked above."]);
  assert.deepEqual(scanPreview(kestrel(), null, { adapter: "tazuo", adapters: ADAPTERS }).warnings, []);
});

test("[fast] the primary button, plurals, lists and the size readout", () => {
  assert.equal(importActionLabel([]), "Import");
  assert.equal(importActionLabel([{ character: "Dorran", total: 1 }]), "Import 1 stack for Dorran");
  assert.equal(importActionLabel([{ character: "Dorran", total: 40 }, { character: "Kestrel", total: 1200 }]), "Import 2 scans · 1,240 stacks");
  assert.equal(plural(1, "piece"), "1 piece");
  assert.equal(plural(0, "warning"), "0 warnings");
  assert.equal(listText(["A"]), "A");
  assert.equal(listText(["A", "B", "C"]), "A, B and C");
  assert.equal(sizeText(900), "900 bytes");
  assert.equal(sizeText(44 * 1024 + 100), "44 KB");
  assert.equal(sizeText(3.2 * 1024 * 1024), "3.2 MB");
});

test("[fast] a broken paste reports the same error the server would", () => {
  const r = parsePastedScan(`${PASTE_BEGIN}\n${KESTREL.slice(0, 500)}`);
  assert.equal(r.ok, false);
  assert.match(r.error!, /looks truncated/);
  const cut = parsePastedScan(KESTREL.slice(0, 500));
  assert.equal(cut.ok, false);
  assert.match(cut.error!, /^invalid JSON: /);
  assert.doesNotMatch(cut.error!, /Kestrel/, "the error keeps the shape of the failure, never the pasted bytes");
});

test("[fast] sendEach: after a failure, what landed is known by identity, so the rest are still to send", async () => {
  // Ten scans of one character; the fifth is refused.
  const files = Array.from({ length: 10 }, (_, i) => ({ name: `Dorran-${i}.json`, character: "Dorran" }));
  const sent: string[] = [];
  const { landed, error } = await sendEach(files, async (f) => {
    sent.push(f.name);
    if (f.name === "Dorran-4.json") throw new Error("the inbox is full");
    return { character: f.character };
  });
  assert.deepEqual(sent, files.slice(0, 5).map((f) => f.name), "stops at the first refusal");
  assert.equal((error as Error).message, "the inbox is full");
  assert.deepEqual(landed.map((l) => l.item), files.slice(0, 4));
  const done = new Set(landed.map((l) => l.item));
  assert.deepEqual(files.filter((f) => !done.has(f)).map((f) => f.name), files.slice(4).map((f) => f.name), "the failed one and the six never sent stay");
  const all = await sendEach(files, async (f) => f.character);
  assert.equal(all.error, null);
  assert.equal(all.landed.length, 10);
});
