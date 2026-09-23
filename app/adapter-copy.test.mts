// adapter-copy.test.mts — app/ui/adapter-copy.mts, what the page says about each game client (design spec
// 4.10, section 5): short names in running text, the wizard's client cards (badge + one plain sentence,
// "Windows only" and "Not available on this Mac" for a client this machine can't run), the Import drawer's
// client options, the branch-aware step names, a readable fallback for an adapter the table doesn't know,
// and defaultImportAdapterId (the drawer defaults to the paste client). Tags: [fast].
// Run: node --test app/adapter-copy.test.mts
import test from "node:test";
import assert from "node:assert/strict";
import { adapterCopy, clientCard, importOptionLabel, shortName, wizardSteps } from "./ui/adapter-copy.mts";
import { defaultImportAdapterId } from "./ui/adapters.mts";

const TAZUO = { id: "tazuo", name: "TazUO adapter scripts", transport: "folder", platform: null };
const WEB = { id: "classicuo-web", name: "ClassicUO web client adapter (paste transport)", transport: "paste", platform: null };
const RAZOR = { id: "razor-enhanced", name: "Razor Enhanced adapter", transport: "folder", platform: "win32" };
const ALL = [WEB, RAZOR, TAZUO];

test("[fast] running text uses the short names, never the README titles", () => {
  assert.deepEqual(ALL.map(shortName), ["ClassicUO web client", "Razor Enhanced", "TazUO"]);
});

test("[fast] client cards: a badge and one plain sentence; a client this machine can't run says so", () => {
  const t = clientCard(TAZUO, "darwin");
  assert.deepEqual({ name: t.name, badge: t.badge.text, available: t.available }, { name: "TazUO", badge: "In-game actions", available: true });
  assert.match(t.sentence, /^Scans every layer, the bank, ground containers and nested bags\. Highlight, Grab and Go to work from Pack Rat\.$/);
  const w = clientCard(WEB, "darwin");
  assert.equal(w.badge.text, "Paste scans");
  assert.match(w.sentence, /Nothing to install: you paste what its scanner prints into Import\./);
  const r = clientCard(RAZOR, "darwin");
  assert.deepEqual({ badge: r.badge.text, available: r.available }, { badge: "Windows only", available: false });
  assert.equal(r.sentence, "Not available on this Mac. Scans every layer, the bank, ground containers and nested bags, with in-game actions.");
  assert.match(clientCard(RAZOR, "linux").sentence, /^Not available on this computer\./);
  assert.equal(clientCard(RAZOR, "win32").available, true);
  for (const a of ALL) for (const p of ["darwin", "win32"]) assert.doesNotMatch(clientCard(a, p).sentence, /adapter|transport/i, "no machine words in the card");
});

test("[fast] the Import drawer's client options", () => {
  assert.deepEqual(ALL.map((a) => importOptionLabel(a, "darwin")), ["ClassicUO web client (paste)", "Razor Enhanced (Windows only)", "TazUO"]);
});

test("[fast] the wizard's steps are named, and the paste branch renames steps 3 and 4", () => {
  assert.deepEqual(wizardSteps(false), ["Shard", "Client", "Client folder", "Install scanner"]);
  assert.deepEqual(wizardSteps(true), ["Shard", "Client", "Nothing to install", "Paste your first scan"]);
});

test("[fast] per-adapter wizard copy exists for every shipped client, and an unknown adapter still reads plainly", () => {
  for (const a of [TAZUO, RAZOR]) for (const k of ["folderQuestion", "folderHelp", "folderPick", "installQuestion", "installHelp"] as const) assert.ok(adapterCopy(a)[k], `${a.id}.${k}`);
  assert.ok(adapterCopy(WEB).pasteHelp);
  const other = adapterCopy({ id: "orion", name: "Orion", transport: "folder", summary: "Scans worn gear." });
  assert.deepEqual({ short: other.short, blurb: other.blurb, q: other.folderQuestion }, { short: "Orion", blurb: "Scans worn gear.", q: "Where is Orion?" });
});

test("[fast] the Import drawer defaults to the paste client this machine can run, whatever the configured client", () => {
  assert.equal(defaultImportAdapterId(ALL, "darwin", "tazuo"), "classicuo-web");
  assert.equal(defaultImportAdapterId([RAZOR, TAZUO], "darwin", null), "tazuo", "no paste client: the first installable one this machine can run");
  assert.equal(defaultImportAdapterId([RAZOR, TAZUO], "darwin", "razor-enhanced"), "razor-enhanced", "no paste client: the configured one");
  assert.equal(defaultImportAdapterId([], "darwin"), null);
});
