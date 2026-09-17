#!/usr/bin/env node
// make-adapter-fixture.mjs <real-scan.json> <out.json> — turns one real scan file (v1 or v2, from
// local/scans/, never committed) into an anonymised fixture safe to commit and fold in tests.
// Upgrades to v2 via upgradeScan, then: character -> "Fixture", position -> {x:1,y:1}, every
// container pos -> {x:1,y:1,z:0}, every serial remapped in order of first appearance to
// 0x40000000+n (consistent across roots/containers/items/equipped), "Crafted By ..." tooltip lines
// -> "Crafted By Nobody", "Engraved: ..." lines -> "Engraved: Fixture", scannedAt pinned to a fixed
// stamp, account dropped, and adapter replaced with the real adapter identity (id/version/capabilities
// from capabilities.json) so the fixture represents what THIS adapter actually emits today, not
// whatever an older real scan happened to carry. Prints item/container/root counts.
import { readFileSync, writeFileSync } from "node:fs";
import { upgradeScan } from "../app/scan-schema.mjs";

const [, , inPath, outPath] = process.argv;
if (!inPath || !outPath) {
  console.error("usage: node scripts/make-adapter-fixture.mjs <real-scan.json> <out.json>");
  process.exit(1);
}

const raw = JSON.parse(readFileSync(inPath, "utf8"));
const scan = upgradeScan(raw, {});

const serialMap = new Map();
let next = 0x40000000;
function remap(s) {
  if (s == null) return s;
  const n = Number(s);
  if (!serialMap.has(n)) serialMap.set(n, next++);
  return serialMap.get(n);
}

function scrubTooltip(lines) {
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

const containers = {};
for (const c of Object.values(scan.containers || {})) {
  const serial = remap(c.serial);
  const next_ = {
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

const CAPABILITIES = JSON.parse(readFileSync(new URL("../adapters/tazuo/capabilities.json", import.meta.url), "utf8"));

const { account, ...rest } = scan;
const fixture = {
  ...rest,
  character: "Fixture",
  scannedAt: "2026-01-01T12:00:00+00:00",
  position: scan.position ? { x: 1, y: 1 } : scan.position,
  adapter: { id: CAPABILITIES.adapter, version: CAPABILITIES.version, client: "TazUO", clientVersion: null, capabilities: CAPABILITIES.capabilities },
  roots, containers, items, equipped,
};

writeFileSync(outPath, JSON.stringify(fixture, null, 1) + "\n");

const nested = Object.values(containers).filter((c) => c.parent != null).length;
console.log(`fixture written: ${outPath}`);
console.log(`items: ${items.length}, equipped: ${equipped.length}, roots: ${roots.length}, containers: ${Object.keys(containers).length} (nested: ${nested})`);
