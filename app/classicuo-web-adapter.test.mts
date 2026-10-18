// classicuo-web-adapter.test.mts — stands in for app/contracts.test.mts for the ClassicUO web client adapter, which ships no fixture.scan.json yet.
//
// stands in for `app/contracts.test.mts` until `adapters/classicuo-web/` ships a real `fixture.scan.json` (see that adapter's README: nobody has run `packrat-scanner.ts` against a live client yet, so the real contract test skips this adapter folder entirely). Reads the `PASTE_BEGIN`/`PASTE_END` constants straight out of the committed `packrat-scanner.ts` source with a targeted regex, and checks they are byte-identical to `app/import.mts`'s own. The scanner's id, version and capabilities are generated from `capabilities.json` (`npm run gen:contracts`), and a real scan must report exactly those; a Gargish Chest on the ground is scanned like any chest. The real scanner is also RUN: imported (Node strips its types) with the four sandbox globals it reads (`player`, `client`, `log`, `sleep`) faked, and the document it prints between the paste markers is parsed back and validated against the v2 schema. Checked against that real output: items stay items whether a non-container's `contents` is `undefined` or an empty array (a build that gives every item `[]` used to turn the whole backpack into containers), an empty bag with a known container graphic is still a container, a ground chest whose contents read `[]` or throw is `opened: false` with nothing under it, and every root — opened or not — has a matching `containers` entry, a ground one with its `pos`; a trash container on the ground or in the backpack is left out with its contents while an ordinary barrel is not (issue #74). A ground root's `pos` carries `player.map` as its `facet` only when it is a whole number 0-5 (issue #11). Also spawns `node --experimental-strip-types` on the real `packrat-scanner.ts` file directly and asserts it fails only with a `ReferenceError` for a missing sandbox global, never a `SyntaxError` — the one check in this file that actually PARSES the script rather than reading it as text, closing a real gap a source-corruption bug shipped through undetected during this phase. Every container record carries its graphic and hue (issue #174). All `[fast]`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { validateScan } from "./scan-schema.mts";
import { PASTE_BEGIN, PASTE_END } from "./import.mts";
import type { ScanV2AdapterCapabilities } from "./schema/types.d.mts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ADAPTER_DIR = join(HERE, "..", "adapters", "classicuo-web");

// capabilities.json's own shape (app/installer.mts's AdapterInfo reads more of it; this file only
// ever reads .adapter/.version/.transport/.capabilities off it).
interface CapabilitiesFile {
  adapter: string;
  version: string;
  transport: string;
  capabilities: ScanV2AdapterCapabilities;
}
const capsFile = JSON.parse(readFileSync(join(ADAPTER_DIR, "capabilities.json"), "utf8")) as CapabilitiesFile;
const scannerSrc = readFileSync(join(ADAPTER_DIR, "packrat-scanner.ts"), "utf8");
const scannerPath = join(ADAPTER_DIR, "packrat-scanner.ts");

// Nothing else in this suite ever actually PARSES packrat-scanner.ts as code — every other test here
// reads it as text (regexes for CAPABILITIES/markers). That gap is real: a source-corruption bug
// (found live during this phase — a literal U+2028/U+2029 escape sequence written next to raw
// hex digits in a regex/string literal, silently became the ACTUAL line/paragraph-separator
// character partway through an editing pass, which is itself a syntax error inside a regex literal)
// shipped undetected until someone happened to run the file by hand. Running it under Node's own
// TypeScript type-stripping is the cheapest real parse check available (no external compiler
// dependency, the same way every caller runs `scripts/optimizer-core.mts` straight from source): the
// script always calls `main()` unconditionally at its own end and references sandbox-only ambient
// globals (`player`, `client`, `log`, `sleep`) that don't exist outside the real client, so it can
// never exit 0 here — the only question worth asking is WHETHER it failed to run (an ordinary,
// expected ReferenceError for a missing global) or failed to even PARSE (a SyntaxError, which this
// test exists to catch).
test("[fast] classicuo-web: packrat-scanner.ts is syntactically valid TypeScript (parses; fails only on a missing sandbox global, never a SyntaxError)", () => {
  const r = spawnSync(process.execPath, ["--experimental-strip-types", scannerPath], { encoding: "utf8" });
  assert.notEqual(r.status, 0, `expected packrat-scanner.ts to fail outside the real client sandbox (no player/client/log/sleep globals) — a clean exit here would itself be surprising:\n${r.stderr}`);
  assert.doesNotMatch(r.stderr || "", /SyntaxError/, `packrat-scanner.ts failed to PARSE, not just to run:\n${r.stderr}`);
  assert.match(r.stderr || "", /ReferenceError/, `expected a ReferenceError for a missing sandbox global, got:\n${r.stderr}`);
});

// The paste markers the scanner prints (PASTE_BEGIN/PASTE_END, also regexed straight out of the .ts
// source) must be byte-identical to the ones app/import.mts's extractJsonText actually looks for —
// docs/adapter-guide.md and both READMEs document this as a hard requirement ("must match
// app/import.mts's PASTE_BEGIN/PASTE_END byte-for-byte", the scanner's own header comment says), but
// nothing enforced it: a typo'd marker in either file would silently break every paste from this
// adapter (parsePastedScan falls back to treating the whole paste as bare JSON, which still usually
// fails, but with a confusing "not valid JSON" error instead of pointing at the real cause).
function extractScannerConst(src: string, name: string): string {
  const m = new RegExp(`const ${name}\\s*=\\s*"([^"]*)"`).exec(src);
  assert.ok(m, `packrat-scanner.ts: could not find \`const ${name} = "..."\``);
  return m[1]!;   // present whenever m matched — the regex's only capture group
}
test("[fast] classicuo-web: the scanner's paste markers match app/import.mts's PASTE_BEGIN/PASTE_END exactly", () => {
  assert.equal(extractScannerConst(scannerSrc, "PASTE_BEGIN"), PASTE_BEGIN);
  assert.equal(extractScannerConst(scannerSrc, "PASTE_END"), PASTE_END);
});

// The scanner's REAL output: packrat-scanner.ts is imported (Node strips its types) with the four
// sandbox globals it reads — `player`, `client`, `log`, `sleep` — faked, and the document it prints
// between the paste markers is parsed back. Each run imports a fresh copy (a unique query string),
// since the script calls main() when it loads.
interface FakeItem { serial: number; name: string; graphic: number; hue: number; amount: number; x?: number; y?: number; z?: number; readonly contents: FakeItem[] | undefined }
interface WebRoot { serial: number; kind: string; name: string; opened: boolean }
interface WebDoc {
  adapter: { id: string; version: string; capabilities: ScanV2AdapterCapabilities };
  roots: WebRoot[];
  containers: Record<string, { serial: number; kind: string; parent: number | null; root: number; pos?: unknown }>;
  items: { serial: number; container: number }[];
  equipped: { serial: number; layer: string }[];
}
const BAG_GRAPHIC = 0x0e75, RING_GRAPHIC = 0x1086;
// `leafContents` is what a non-container reports: undefined per the documented API, or [] on a build
// that gives every item an empty array.
function fakeItem(serial: number, name: string, graphic: number, kids: FakeItem[] | undefined | "throws", leafContents?: FakeItem[]): FakeItem {
  return {
    serial, name, graphic, hue: 0, amount: 1, x: 3, y: 4, z: 0,
    get contents() {
      if (kids === "throws") throw new Error("itemGetContents: Unexpected end of JSON input");
      return kids ?? leafContents;
    },
  };
}
let runs = 0;
const sysMsgs: string[] = [];
// `names` gives an item's tooltip name by serial; any other item's tooltip reads "item <serial>".
async function runScanner(world: { backpack: FakeItem; ground?: FakeItem[]; equipped?: Record<string, FakeItem>; names?: Record<number, string>; map?: unknown }): Promise<WebDoc> {
  const printed: string[] = [];
  const g = globalThis as Record<string, unknown>;
  sysMsgs.length = 0;
  g.player = { name: "Tester", equippedItems: world.equipped || {}, backpack: world.backpack, getAllSkills: () => [], map: world.map };
  g.client = {
    sysMsg: (s: string) => sysMsgs.push(s),
    queryItemOPL: (s: number) => { const name = world.names?.[s] ?? "item " + s; return { name, properties: [{ text: name }] }; },
    findAllOfType: (graphic: number) => (world.ground || []).filter((it) => it.graphic === graphic),
  };
  g.log = (s: string) => printed.push(s);
  g.sleep = () => {};
  try {
    await import(pathToFileURL(scannerPath).href + "?run=" + ++runs);
  } finally {
    for (const k of ["player", "client", "log", "sleep"]) delete g[k];
  }
  assert.equal(printed[0], PASTE_BEGIN);
  assert.equal(printed[printed.length - 1], PASTE_END);
  const doc = JSON.parse(printed.slice(1, -1).join(""));
  const v = validateScan(doc);
  assert.equal(v.ok, true, JSON.stringify(v.errors));
  return doc as WebDoc;
}
function homeWorld(leaf?: FakeItem[]) {
  const ring = fakeItem(0x40000004, "Ring", RING_GRAPHIC, undefined, leaf);
  const pouch = fakeItem(0x40000002, "A Pouch", BAG_GRAPHIC, [ring]);
  const dagger = fakeItem(0x40000003, "A Dagger", RING_GRAPHIC, undefined, leaf);
  const emptyBag = fakeItem(0x40000005, "An Empty Bag", BAG_GRAPHIC, [], leaf);
  const backpack = fakeItem(0x40000001, "Backpack", BAG_GRAPHIC, [dagger, pouch, emptyBag]);
  const chest = fakeItem(0x40000007, "A Wooden Chest", BAG_GRAPHIC, [fakeItem(0x40000008, "Bandage", RING_GRAPHIC, undefined, leaf)]);
  const unloaded = fakeItem(0x40000009, "A Chest Never Opened", BAG_GRAPHIC, []);
  const locked = fakeItem(0x4000000a, "A Locked Chest", BAG_GRAPHIC, "throws");
  const katana = fakeItem(0x40000006, "A Katana", RING_GRAPHIC, undefined, leaf);
  return { backpack, ground: [chest, unloaded, locked], equipped: { oneHanded: katana } };
}

// The scanner's ADAPTER_ID, ADAPTER_VERSION and CAPABILITIES are generated from capabilities.json (npm run gen:contracts);
// this checks what a real scan reports, not the source text.
test("[fast] classicuo-web: the real scan reports capabilities.json's id, version and capabilities", async () => {
  const { adapter } = await runScanner(homeWorld());
  assert.deepEqual([capsFile.adapter, capsFile.transport], ["classicuo-web", "paste"]);
  assert.deepEqual([adapter.id, adapter.version, adapter.capabilities], [capsFile.adapter, capsFile.version, capsFile.capabilities]);
});

test("[fast] classicuo-web: a Gargish Chest on the ground is scanned like any other chest (the shared container graphics)", async () => {
  const w = homeWorld();
  w.ground.push(fakeItem(0x4000000b, "A Gargish Chest", 0x4025, [fakeItem(0x4000000c, "Bandage", RING_GRAPHIC, undefined)]));
  const doc = await runScanner(w);
  assert.ok(doc.roots.some((r) => r.serial === 0x4000000b && r.opened), "the chest is a root");
  assert.ok(doc.items.some((i) => i.serial === 0x4000000c && i.container === 0x4000000b), "and its contents are read");
});

for (const [label, leaf] of [["undefined", undefined], ["an empty array", []]] as const) {
  test(`[fast] classicuo-web: the real scan records items as items when a non-container's contents is ${label}`, async () => {
    const doc = await runScanner(homeWorld(leaf as FakeItem[] | undefined));
    assert.deepEqual(doc.items.map((i) => i.serial).sort(), [0x40000003, 0x40000004, 0x40000008]);
    assert.deepEqual(Object.values(doc.containers).filter((c) => c.kind === "container").map((c) => c.serial).sort(), [0x40000002, 0x40000005]);
    assert.deepEqual(doc.equipped.map((e) => [e.serial, e.layer]), [[0x40000006, "OneHanded"]]);
  });
}

test("[fast] classicuo-web: the real scan records a ground chest reading [] or throwing as not opened, with nothing under it", async () => {
  const doc = await runScanner(homeWorld());
  const opened = Object.fromEntries(doc.roots.map((r) => [r.serial, r.opened]));
  assert.deepEqual(opened, { [0x40000001]: true, [0x40000007]: true, [0x40000009]: false, [0x4000000a]: false });
  for (const r of doc.roots.filter((x) => !x.opened)) {
    assert.equal(doc.items.filter((i) => i.container === r.serial).length, 0);
  }
});

test("[fast] classicuo-web: a nested bag reading [] is recorded as not opened, like a ground root", async () => {
  const doc = await runScanner(homeWorld());
  const opened = (s: number): unknown => (doc.containers[String(s)] as { opened?: boolean }).opened;
  assert.equal(opened(0x40000005), false, "the empty bag");
  assert.equal(opened(0x40000002), undefined, "the pouch holding a ring");
});

test("[fast] classicuo-web: every container record carries its graphic and hue (issue #174)", async () => {
  const w = homeWorld();
  w.ground[0]!.hue = 1153;
  const doc = await runScanner(w);
  const look = (s: number): unknown[] => { const c = doc.containers[String(s)] as { graphic?: number; hue?: number }; return [c.graphic, c.hue]; };
  assert.deepEqual(look(0x40000001), [BAG_GRAPHIC, 0], "the backpack");
  assert.deepEqual(look(0x40000002), [BAG_GRAPHIC, 0], "a nested bag");
  assert.deepEqual(look(0x40000007), [BAG_GRAPHIC, 1153], "a ground root");
});

test("[fast] classicuo-web: every root (opened or not) has a matching containers entry, a ground one with its pos", async () => {
  const doc = await runScanner(homeWorld());
  for (const root of doc.roots) {
    const entry = doc.containers[String(root.serial)];
    assert.ok(entry, `no containers entry for root ${root.serial} (${root.kind})`);
    assert.equal(entry.kind, root.kind);
    assert.equal(entry.parent, null);
    if (root.kind === "ground") assert.ok(entry.pos, "a ground root's containers entry should carry pos");
  }
});

test("[fast] classicuo-web: a bag nested past MAX_NEST is recorded as a container not opened, not as a plain item", async () => {
  let inner = fakeItem(0x40000300, "Deep Ring", RING_GRAPHIC, undefined);
  const bags: number[] = [];
  for (let i = 6; i >= 1; i--) { bags.unshift(0x40000200 + i); inner = fakeItem(0x40000200 + i, "A Bag", BAG_GRAPHIC, [inner]); }
  const doc = await runScanner({ backpack: fakeItem(0x40000001, "Backpack", BAG_GRAPHIC, [inner]) });
  const unopened = Object.values(doc.containers).filter((c) => (c as { opened?: boolean }).opened === false).map((c) => c.serial);
  assert.equal(unopened.length, 1, JSON.stringify(doc.containers));
  assert.ok(bags.includes(unopened[0]!));
  assert.deepEqual(doc.items.filter((i) => bags.includes(i.serial)), [], "no bag is recorded as a plain item");
});

test("[fast] classicuo-web: a trash container on the ground or in the backpack is left out with its contents; an ordinary barrel is not", async () => {
  const BARREL_GRAPHIC = 0x0e7f;
  const trashBarrel = fakeItem(0x40000400, "A Trash Barrel", BARREL_GRAPHIC, [fakeItem(0x40000401, "Old Ring", RING_GRAPHIC, undefined)]);
  const barrel = fakeItem(0x40000402, "Barrel", BARREL_GRAPHIC, [fakeItem(0x40000403, "Apple", RING_GRAPHIC, undefined)]);
  const trashChest = fakeItem(0x40000404, "Trash Chest", BAG_GRAPHIC, [fakeItem(0x40000405, "Tossed Ring", RING_GRAPHIC, undefined)]);
  const doc = await runScanner({
    backpack: fakeItem(0x40000001, "Backpack", BAG_GRAPHIC, [trashChest]), ground: [trashBarrel, barrel],
    names: { 0x40000400: "A Trash Barrel", 0x40000402: "Barrel", 0x40000404: "Trash Chest" },
  });
  assert.deepEqual(doc.roots.map((r) => r.serial), [0x40000001, 0x40000402]);
  assert.deepEqual(Object.keys(doc.containers).map(Number).sort(), [0x40000001, 0x40000402]);
  assert.deepEqual(doc.items.map((i) => i.serial), [0x40000403], "nothing in or of the trash is recorded");
  assert.ok(sysMsgs.includes("  skipped 2 trash containers"), JSON.stringify(sysMsgs));
});

// Organize (issue #11) groups chests by facet: a ground root's pos carries player.map, and nothing else passes for one.
test("[fast] classicuo-web: a ground root's pos carries player.map as its facet, and only a whole number 0-5", async () => {
  const cases: Array<[unknown, number | undefined]> = [[1, 1], [0, 0], [5, 5], [undefined, undefined], [null, undefined], [6, undefined], [-1, undefined], [1.5, undefined], ["1", undefined]];
  for (const [map, want] of cases) {
    const doc = await runScanner({ ...homeWorld(), map });
    const pos = doc.containers[String(0x40000007)]!.pos as { facet?: number };
    assert.equal(pos.facet, want, `player.map ${JSON.stringify(map)}`);
  }
});
