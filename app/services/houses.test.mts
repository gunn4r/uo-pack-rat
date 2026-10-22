// houses.test.mts — `app/services/houses.mts` on its own: why there is no tiledata.mul, facet or item art, and the facet and item art PNG caches.
//
// `app/services/houses.mts`: why there is no tiledata.mul or facet as the settings change, and the facet PNG cache answering a repeat and dropping the oldest past 32 MB; item art (issue #174) from a synthetic artLegacyMUL.uop and hues.mul: the reasons there is none (no client, a Settings folder that is gone, no art file, one that is not a UOP table, no art for the graphic), a PNG cut to the opaque box and kept for a repeat, a hue recolouring it under its own ETag, a hue drawn unhued without hues.mul, and a partial hue (the tiledata.mul flag or the 0x8000 bit) taking only the grey pixels under an ETag of its own. All `[fast]`.
//
// The reason is read from the settings on every call (no client, a set folder that is gone or not an absolute path).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DEFAULT_SHARD } from "../rules.mts";
import type { SettingsDoc } from "../store/settings.mts";
import { createHousesService } from "./houses.mts";
import { itemArtName } from "../art.mts";
import { pngPixels, syntheticArt, syntheticHues, syntheticUop } from "../art-fixture.mts";
import { rgb555 } from "../facet-fixture.mts";
import { syntheticTileData } from "../tiledata-fixture.mts";
import { FLAG } from "../tiledata.mts";

test("[fast] houses service: the reason there is no tiledata.mul or facet follows the settings", () => {
  let settings: SettingsDoc = { shard: DEFAULT_SHARD, client: null };
  const service = createHousesService({ settings: () => settings, uoFolderFinder: () => null });
  assert.deepEqual(service.tileData(), { td: null, folder: null, source: null, reason: "no-client" });
  assert.deepEqual(service.facetBitmap(1), { reason: "no-client" });
  settings = { ...settings, uoFolder: "relative/uo" };
  assert.equal(service.tileData().reason, "override-missing");
  const empty = mkdtempSync(join(tmpdir(), "pr-houses-"));
  settings = { ...settings, uoFolder: empty };
  assert.deepEqual(service.tileData(), { td: null, folder: empty, source: "settings", reason: "override-missing" });
  assert.deepEqual(service.facetBitmap(1), { reason: "missing" });
  settings = { ...settings, uoFolder: join(empty, "gone") };
  assert.deepEqual(service.facetBitmap(1), { reason: "override-missing" });
});

test("[fast] houses service: with no UO folder set, the client's manifest names how to find one (install.uoFolder): TazUO looks through its launcher profile, a client with no finder (Razor Enhanced) asks for the folder from Settings", () => {
  const scriptsDir = mkdtempSync(join(tmpdir(), "pr-houses-client-"));
  const finders: Record<string, string> = { tazuo: "tazuo-profile" };
  const settings = (adapter: string): SettingsDoc => ({ shard: DEFAULT_SHARD, client: { adapter, scriptsDir } });
  const reason = (adapter: string) => createHousesService({ settings: () => settings(adapter), uoFolderFinder: (id) => finders[id] ?? null }).tileData().reason;
  assert.equal(reason("tazuo"), "no-tazuo-profile", "a TazUO client: its launcher profile is looked through, and names none here");
  assert.equal(reason("razor-enhanced"), "no-finder", "a client whose manifest names no finder (Razor Enhanced): set up, but the folder has to come from Settings (issue #421)");
});

test("[fast] houses service: the facet PNG cache answers a repeat without making it again and drops the oldest past 32 MB", () => {
  const service = createHousesService({ settings: () => ({ shard: DEFAULT_SHARD }), uoFolderFinder: () => null });
  let made = 0;
  const png = (mb: number) => () => { made++; return Buffer.alloc(mb * 1024 * 1024); };
  const a = service.facetPng("a", png(20));
  assert.equal(service.facetPng("a", png(20)), a);
  assert.equal(made, 1);
  service.facetPng("b", png(10));
  service.facetPng("c", png(10));   // 40 MB: "a" goes
  assert.equal(made, 3);
  service.facetPng("b", png(10));
  assert.equal(made, 3, "b is still kept");
  assert.notEqual(service.facetPng("a", png(20)), a);
  assert.equal(made, 4);
});

test("[fast] houses service: item art comes from the UO folder's art file, cut and kept, a hue under its own ETag, and each reason there is none", () => {
  let settings: SettingsDoc = { shard: DEFAULT_SHARD, client: null };
  const service = createHousesService({ settings: () => settings, uoFolderFinder: () => null });
  assert.deepEqual(service.itemArt(0x0e40, 0), { reason: "no-client" });
  const uo = mkdtempSync(join(tmpdir(), "pr-art-"));
  try {
    settings = { ...settings, uoFolder: join(uo, "gone") };
    assert.deepEqual(service.itemArt(0x0e40, 0), { reason: "override-missing" });
    settings = { ...settings, uoFolder: uo };
    assert.deepEqual(service.itemArt(0x0e40, 0), { reason: "missing" });
    writeFileSync(join(uo, "artLegacyMUL.uop"), Buffer.from("not a uop file at all, just words"));
    assert.deepEqual(service.itemArt(0x0e40, 0), { reason: "unreadable" });
    writeFileSync(join(uo, "artLegacyMUL.uop"), syntheticUop([{ name: itemArtName(0x0e40), data: syntheticArt(4, 3, [[], [[1, rgb555(31, 0, 0), rgb555(8, 8, 8)]], []]) }]));
    assert.deepEqual(service.itemArt(0x0e41, 0), { reason: "no-art" });
    const plain = service.itemArt(0x0e40, 0);
    assert.ok("png" in plain);
    assert.deepEqual([plain.png.readUInt32BE(16), plain.png.readUInt32BE(20), plain.png[25]], [2, 1, 6], "cut to 2 x 1, RGBA");
    const again = service.itemArt(0x0e40, 0);
    assert.ok("png" in again && again.png === plain.png && again.etag === plain.etag, "kept for a repeat");
    const noHues = service.itemArt(0x0e40, 1153);
    assert.ok("png" in noHues && noHues.png.equals(plain.png), "without hues.mul the art is drawn unhued");
    writeFileSync(join(uo, "hues.mul"), syntheticHues([new Uint16Array(32).fill(rgb555(0, 0, 31))]));
    const hued = service.itemArt(0x0e40, 1);
    assert.ok("png" in hued && !hued.png.equals(plain.png) && hued.etag !== plain.etag);
    assert.ok(!plain.etag.includes(uo), "the ETag never names the folder");
  } finally { rmSync(uo, { recursive: true, force: true }); }
});

test("[fast] houses service: item art takes a hue partially when tiledata.mul flags the graphic (or the hue carries 0x8000): only grey pixels change, under a new ETag", () => {
  const settings: SettingsDoc = { shard: DEFAULT_SHARD, client: null };
  const uo = mkdtempSync(join(tmpdir(), "pr-art-partial-"));
  const service = createHousesService({ settings: () => ({ ...settings, uoFolder: uo }), uoFolderFinder: () => null });
  try {
    // A red pixel and a grey one on two graphics; a hue that is all blue.
    const art = syntheticArt(2, 1, [[[0, rgb555(31, 0, 0), rgb555(8, 8, 8)]]]);
    writeFileSync(join(uo, "artLegacyMUL.uop"), syntheticUop([{ name: itemArtName(0x0e40), data: art }, { name: itemArtName(0x0e41), data: art }]));
    writeFileSync(join(uo, "hues.mul"), syntheticHues([new Uint16Array(32).fill(rgb555(0, 0, 31))]));
    const red = [255, 0, 0, 255], blue = [0, 0, 255, 255];
    const pixels = (graphic: number, hue: number): number[] => { const r = service.itemArt(graphic, hue); assert.ok("png" in r); return pngPixels(r.png); };
    assert.deepEqual(pixels(0x0e40, 1), [...blue, ...blue], "no tiledata.mul: every pixel takes the hue");
    const fullTag = service.itemArt(0x0e40, 1);
    writeFileSync(join(uo, "tiledata.mul"), syntheticTileData([{ graphic: 0x0e40, flags: FLAG.partialHue | FLAG.wearable }]));
    assert.deepEqual(pixels(0x0e40, 1), [...red, ...blue], "the partial-hue flag: only the grey pixel takes the hue");
    const partTag = service.itemArt(0x0e40, 1);
    assert.ok("etag" in fullTag && "etag" in partTag && fullTag.etag !== partTag.etag, "the partial drawing has its own ETag");
    assert.deepEqual(pixels(0x0e41, 1), [...blue, ...blue], "a graphic without the flag is dyed whole");
    assert.deepEqual(pixels(0x0e41, 0x8001), [...red, ...blue], "the hue's own 0x8000 bit is partial too");
  } finally { rmSync(uo, { recursive: true, force: true }); }
});
