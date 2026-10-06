// houses.test.mts — `app/services/houses.mts` on its own: why there is no tiledata.mul or facet, and the facet PNG cache.
//
// `app/services/houses.mts`: why there is no tiledata.mul or facet as the settings change, and the facet PNG cache answering a repeat and dropping the oldest past 32 MB. All `[fast]`.
//
// The reason is read from the settings on every call (no client, a set folder that is gone or not an absolute path).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DEFAULT_SHARD } from "../rules.mts";
import type { SettingsDoc } from "../store/settings.mts";
import { createHousesService } from "./houses.mts";

test("[fast] houses service: the reason there is no tiledata.mul or facet follows the settings", () => {
  let settings: SettingsDoc = { shard: DEFAULT_SHARD, client: null };
  const service = createHousesService({ settings: () => settings });
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

test("[fast] houses service: the facet PNG cache answers a repeat without making it again and drops the oldest past 32 MB", () => {
  const service = createHousesService({ settings: () => ({ shard: DEFAULT_SHARD }) });
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
