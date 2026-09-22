#!/usr/bin/env node
// make-adapter-fixture.mts <real-scan.json> <out.json> — turns one real scan file (v1 or v2, from
// local/scans/, never committed) into an anonymised fixture safe to commit and fold in tests.
// Upgrades to v2 via upgradeScan, then: character -> "Fixture", position -> {x:1,y:1}, every
// container pos -> {x:1,y:1,z:0}, every serial remapped in order of first appearance to
// 0x40000000+n (consistent across roots/containers/items/equipped), "Crafted By ..." tooltip lines
// -> "Crafted By Nobody", "Engraved: ..." lines -> "Engraved: Fixture", scannedAt pinned to a fixed
// stamp, account dropped, and adapter.version/capabilities replaced from the capabilities.json of the
// adapter that produced the scan (its adapter.id; its own client name is kept) so the fixture
// represents what THAT adapter actually emits today, not whatever an older real scan happened to
// carry. Refuses to write anything that still contains the source character or account name
// anywhere (a container called "<name>'s Backpack", an item or tooltip line naming them), since only
// the fields above are rewritten. Prints item/container/root counts.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { upgradeScan, validateScan, type UnvalidatedScan } from "../app/scan-schema.mts";
import type { ScanV2, ScanV2AdapterCapabilities, ScanV2ContainersValue } from "../app/schema/types.d.mts";

const [, , inPath, outPath] = process.argv;
if (!inPath || !outPath) {
  console.error("usage: node scripts/make-adapter-fixture.mts <real-scan.json> <out.json>");
  process.exit(1);
}

const raw: unknown = JSON.parse(readFileSync(inPath, "utf8"));
// `inPath` is an arbitrary file a developer names on the command line — a raw capture off a client
// that (per this file's own header comment) may never have run against a live client before, so it's
// exactly the input most likely to be malformed. upgradeScan() only checks the version field
// (app/scan-schema.mts's own comment: it "returns UnvalidatedScan, not ScanV2 ... a caller earns a
// ScanV2 by running [validateScan] and casting only on the ok branch"), so earn it here the same way
// app/import.mts and app/watcher.mts do, rather than reading the upgraded doc as if it were already
// proven: a malformed real scan now fails right here with the schema error that names the problem,
// instead of surfacing later as a confusing failure in this script or in app/contracts.test.mts
// against the bad fixture it would otherwise have written.
let upgraded: UnvalidatedScan;
try {
  // shard: null — same reasoning as app/import.mts's parsePastedScan: this script takes no server
  // state to stamp a real shard with either. Passing no `shard` option at all (the default,
  // undefined) would set the key to a literal `undefined` on a v1 doc with no shard of its own,
  // which then fails validateScan's `["string", "null"]` type check below even though the doc is
  // otherwise perfectly valid (validate.mts's `key in obj` check treats an explicitly-undefined
  // property as present) — hit live against app/fixtures/demo-Kestrel.json, a real shipped fixture.
  upgraded = upgradeScan(raw, { shard: null });
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
const inputCheck = validateScan(upgraded);
if (!inputCheck.ok) {
  console.error(`${inPath} does not upgrade to a valid scan:`);
  for (const err of inputCheck.errors) console.error(`  ${err.path} ${err.msg}`);
  process.exit(1);
}
const scan = upgraded as ScanV2;

const serialMap = new Map<number, number>();
let next = 0x40000000;
function remap(s: number | string): number;
function remap(s: number | string | null | undefined): number | null | undefined;
function remap(s: number | string | null | undefined): number | null | undefined {
  if (s == null) return s;
  const n = Number(s);
  if (!serialMap.has(n)) serialMap.set(n, next++);
  return serialMap.get(n)!;   // just set above if it wasn't already there
}

function scrubTooltip(lines: string[] | undefined): string[] {
  return (lines || []).map((l) => {
    if (/^Crafted By /.test(l)) return "Crafted By Nobody";
    // Treasure-map decode credit line (UO Alive) — same shape/risk as "Crafted By".
    if (/^Completed By /.test(l)) return "Completed By Nobody";
    if (/^Engraved: /.test(l)) return "Engraved: Fixture";
    return l;
  });
}

// Order of first appearance: roots, then containers (object key order == file order), then items,
// then equipped — so a serial that shows up as a root gets the lowest remapped id, etc.
for (const r of scan.roots || []) remap(r.serial);
for (const c of Object.values(scan.containers || {})) {
  remap(c.serial);
  if (c.parent != null) remap(c.parent);
  remap(c.root);
}
for (const it of scan.items || []) { remap(it.serial); remap(it.container); }
for (const it of scan.equipped || []) remap(it.serial);

const roots = (scan.roots || []).map((r) => ({ ...r, serial: remap(r.serial) }));

const containers: Record<string, ScanV2ContainersValue> = {};
for (const c of Object.values(scan.containers || {})) {
  const serial = remap(c.serial);
  const next_: ScanV2ContainersValue = {
    ...c,
    serial,
    parent: c.parent == null ? null : remap(c.parent),
    root: remap(c.root),
  };
  if ("pos" in c && c.pos != null) next_.pos = { x: 1, y: 1, z: 0 };
  if (c.tooltip) next_.tooltip = scrubTooltip(c.tooltip);
  containers[String(serial)] = next_;
}

const items = (scan.items || []).map((it) => ({
  ...it, serial: remap(it.serial), container: remap(it.container), tooltip: scrubTooltip(it.tooltip),
}));
const equipped = (scan.equipped || []).map((it) => ({
  ...it, serial: remap(it.serial), tooltip: scrubTooltip(it.tooltip),
}));

// The scan's own adapter.id picks the capabilities file. validateScan has already held it to the
// schema's `^[a-z0-9-]+$`, so it can only name a folder directly under adapters/.
interface AdapterCapabilitiesFile { adapter: string; version: string; capabilities: ScanV2AdapterCapabilities }
const capabilitiesUrl = new URL(`../adapters/${scan.adapter.id}/capabilities.json`, import.meta.url);
if (!existsSync(capabilitiesUrl)) {
  console.error(`${inPath} was produced by adapter "${scan.adapter.id}", which has no adapters/${scan.adapter.id}/capabilities.json in this repository`);
  process.exit(1);
}
const CAPABILITIES = JSON.parse(readFileSync(capabilitiesUrl, "utf8")) as AdapterCapabilitiesFile;

const { account, ...rest } = scan;
const fixture = {
  ...rest,
  character: "Fixture",
  scannedAt: "2026-01-01T12:00:00+00:00",
  position: scan.position ? { x: 1, y: 1 } : scan.position,
  adapter: { id: CAPABILITIES.adapter, version: CAPABILITIES.version, client: scan.adapter.client, clientVersion: null, capabilities: CAPABILITIES.capabilities },
  roots, containers, items, equipped,
};

// The anonymising step above (remapping serials, scrubbing tooltip lines, replacing adapter/character/
// scannedAt/position) rebuilds the document by hand rather than mutating the already-validated `scan`
// in place, so it can just as easily produce something the schema rejects (a dropped required field, a
// serial remapped to the wrong type) as the raw input could. Validate what's actually about to be
// written, not just what came in: app/contracts.test.mts will reject an invalid fixture later anyway,
// and failing here — before anything is written, with the schema error that names the problem — is
// kinder than a confusing failure in that test run.
const outputCheck = validateScan(fixture);
if (!outputCheck.ok) {
  console.error(`${outPath} would not be a valid fixture:`);
  for (const err of outputCheck.errors) console.error(`  ${err.path} ${err.msg}`);
  process.exit(1);
}

// Only the fields above are rewritten; a name also turns up in container and item names ("<name>'s
// Backpack"), tooltip lines and anything an adapter adds, and this file is about to be committed to a
// public repository. So search what is about to be written for the source identity, in any case, and
// refuse with the path of every string that still carries it. "Fixture" is the placeholder itself:
// re-running the tool on an already-anonymised scan is not a leak.
const identities = [scan.character, account]
  .filter((v): v is string => typeof v === "string" && v.trim() !== "" && v.toLowerCase() !== "fixture")
  .map((v) => v.toLowerCase());
const leaks: string[] = [];
function findLeaks(value: unknown, path: string): void {
  if (typeof value === "string") {
    if (identities.some((id) => value.toLowerCase().includes(id))) leaks.push(path);
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => findLeaks(v, `${path}/${i}`));
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if (identities.some((id) => k.toLowerCase().includes(id))) leaks.push(`${path}/${k} (key)`);
      findLeaks(v, `${path}/${k}`);
    }
  }
}
findLeaks(fixture, "");
if (leaks.length) {
  console.error(`${outPath} would still contain the source character or account name, at:`);
  for (const path of leaks) console.error(`  ${path}`);
  console.error("Rename those in a copy of the scan and run this again; nothing was written.");
  process.exit(1);
}

writeFileSync(outPath, JSON.stringify(fixture, null, 1) + "\n");

const nested = Object.values(containers).filter((c) => c.parent != null).length;
console.log(`fixture written: ${outPath}`);
console.log(`items: ${items.length}, equipped: ${equipped.length}, roots: ${roots.length}, containers: ${Object.keys(containers).length} (nested: ${nested})`);
