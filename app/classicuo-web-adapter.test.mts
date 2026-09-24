// classicuo-web-adapter.test.mts — the classicuo-web adapter ships no fixture.scan.json yet (see
// adapters/classicuo-web/README.md: nobody has run packrat-scanner.ts against a live client), so
// app/contracts.test.mts skips it entirely. This file stands in for that until a real fixture
// exists: it runs the real packrat-scanner.ts against faked sandbox globals and checks the document
// it prints validates against the same v2 schema every other adapter's output does, records roots,
// containers and items the way the fold needs, and that adapters/classicuo-web/capabilities.json
// matches the CAPABILITIES constant the scanner itself carries (the same drift the real contract
// test guards against once a fixture lands).
// Tags: [fast]. Run: node --test app/classicuo-web-adapter.test.mts
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
// ever reads .adapter/.transport/.capabilities off it).
interface CapabilitiesFile {
  adapter: string;
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

// Post-review fix (Phase 6 final review, Important 3): this used to be a third hand-typed copy of
// the scanner's CAPABILITIES object, asserted only against itself — a change to the real
// packrat-scanner.ts (add a layer, flip `arms`, add a bridge action) could never fail this test no
// matter how far it drifted, while the comment above claimed the opposite. This now pulls the
// literal `const CAPABILITIES = { ... };` block straight out of the .ts source and parses it
// field-by-field with targeted regexes (not `new Function`/`eval` on source text — a security review
// flagged an earlier draft of this fix for exactly that, and a hand-rolled parser over a handful of
// known field shapes (a quoted-string array, a boolean, a quoted string) is no harder and doesn't
// execute anything), so a real edit to the scanner is what this test is actually checking against.
// The comparison against capabilities.json (below) is unchanged; it's the source of the "expected"
// value that changed, not what it's compared to.
function extractScannerCapabilities(src: string): ScanV2AdapterCapabilities {
  const block = /const CAPABILITIES\s*=\s*(\{[\s\S]*?\n\};)/.exec(src);
  assert.ok(block, "packrat-scanner.ts: could not find `const CAPABILITIES = { ... };` — did it move or get renamed?");
  const body = block[1]!;   // present whenever block matched — the regex's only capture group
  const stringArray = (field: string): string[] => {
    const m = new RegExp(`${field}:\\s*\\[([\\s\\S]*?)\\]`).exec(body);
    assert.ok(m, `packrat-scanner.ts CAPABILITIES: no "${field}: [...]" field found`);
    return [...m[1]!.matchAll(/"([^"]*)"/g)].map((x) => x[1]!);   // present whenever the outer match succeeded
  };
  const bool = (field: string): boolean => {
    const m = new RegExp(`${field}:\\s*(true|false)`).exec(body);
    assert.ok(m, `packrat-scanner.ts CAPABILITIES: no "${field}: true|false" field found`);
    return m[1] === "true";
  };
  const str = (field: string): string => {
    const m = new RegExp(`${field}:\\s*"([^"]*)"`).exec(body);
    assert.ok(m, `packrat-scanner.ts CAPABILITIES: no "${field}: "..."" field found`);
    return m[1]!;   // present whenever m matched — the regex's only capture group
  };
  return {
    layers: stringArray("layers"), arms: bool("arms"), bank: bool("bank"), ground: bool("ground"),
    nested: bool("nested"), tooltips: str("tooltips") as ScanV2AdapterCapabilities["tooltips"], bridge: stringArray("bridge"),
  };
}
const SCANNER_CAPABILITIES = extractScannerCapabilities(scannerSrc);

test("[fast] classicuo-web: capabilities.json matches the scanner's own CAPABILITIES constant, read from the real .ts source", () => {
  assert.equal(capsFile.adapter, "classicuo-web");
  assert.equal(capsFile.transport, "paste");
  assert.deepEqual(capsFile.capabilities, SCANNER_CAPABILITIES);
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
async function runScanner(world: { backpack: FakeItem; ground?: FakeItem[]; equipped?: Record<string, FakeItem> }): Promise<WebDoc> {
  const printed: string[] = [];
  const g = globalThis as Record<string, unknown>;
  g.player = { name: "Tester", equippedItems: world.equipped || {}, backpack: world.backpack, getAllSkills: () => [] };
  g.client = {
    sysMsg() {},
    queryItemOPL: (s: number) => ({ name: "item " + s, properties: [{ text: "item " + s }] }),
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
