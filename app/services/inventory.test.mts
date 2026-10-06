// inventory.test.mts — `app/services/inventory.mts` on its own: when the fold and the overlay are cached and when they are made again.
//
// `app/services/inventory.mts` over a demo scan: a repeat read cached, the harvest hook run before every read, the scans folder, the shard or item-kinds.json folding again, and organize-state.json or a new hour re-applying the overlay without folding again. All `[fast]`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createScansStore } from "../store/scans.mts";
import { createItemKindsStore } from "../store/item-kinds.mts";
import { createOrganizeStateStore } from "../store/organize-state.mts";
import { emptyOrganizeState } from "../organize-state.mts";
import { createInventoryService } from "./inventory.mts";
import { setRules } from "../vault-lib.mts";
import { loadRules } from "../rules.mts";

setRules(loadRules("uoalive"));

const FIXTURES = fileURLToPath(new URL("../fixtures/", import.meta.url));

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "pr-inventory-")), scans = join(dir, "scans");
  mkdirSync(scans);
  copyFileSync(join(FIXTURES, "demo-Kestrel.json"), join(scans, "kestrel.json"));
  const scanStore = createScansStore({ dir: scans, shard: () => "uoalive" });
  let folds = 0, clock = Date.UTC(2026, 0, 1, 10, 0), shard = "uoalive";
  const harvested: number[] = [];
  const counted = { signature: scanStore.signature, all: () => { folds++; return scanStore.all(); } };
  const itemKindsStore = createItemKindsStore(join(dir, "item-kinds.json")), organizeStateStore = createOrganizeStateStore(join(dir, "organize-state.json"));
  const service = createInventoryService({ scanStore: counted, itemKindsStore, organizeStateStore, shard: () => shard, harvest: (now) => harvested.push(now), now: () => clock });
  return { dir, scans, service, organizeStateStore, folds: () => folds, harvested, setClock: (t: number) => { clock = t; }, setShard: (s: string) => { shard = s; } };
}

test("[fast] inventory: a second read is the cached value, and the harvest hook runs before every read", async () => {
  const t = setup();
  const a = await t.service.getInventory(), b = await t.service.getInventory();
  assert.equal(b, a);
  assert.equal(t.folds(), 1);
  assert.equal(a.snapshotCount, 1);
  assert.deepEqual(t.harvested, [Date.UTC(2026, 0, 1, 10, 0), Date.UTC(2026, 0, 1, 10, 0)]);
});

test("[fast] inventory: a changed scans folder, shard or item-kinds.json folds the scans again", async () => {
  const t = setup();
  const first = await t.service.getInventory();
  utimesSync(join(t.scans, "kestrel.json"), new Date(), new Date(Date.now() + 5000));
  const touched = await t.service.getInventory();
  assert.notEqual(touched.fold, first.fold);
  assert.equal(t.folds(), 2);
  t.setShard("other");
  const switched = await t.service.getInventory();
  assert.notEqual(switched.fold, touched.fold);
  assert.equal(t.folds(), 3);
  writeFileSync(join(t.dir, "item-kinds.json"), JSON.stringify({ version: 1, names: { "black pearl": "gem" }, graphics: {} }));
  const kinded = await t.service.getInventory();
  assert.notEqual(kinded.fold, switched.fold);
  assert.equal(t.folds(), 4);
});

test("[fast] inventory: a changed organize-state.json or a new hour re-applies the overlay without folding again", async () => {
  const t = setup();
  const first = await t.service.getInventory();
  t.organizeStateStore.write({ ...emptyOrganizeState(), seen: { "1": "2026-01-01T00:00:00.000Z" } });
  const overlaid = await t.service.getInventory();
  assert.notEqual(overlaid, first);
  assert.equal(overlaid.fold, first.fold, "the same fold");
  t.setClock(Date.UTC(2026, 0, 1, 10, 59));
  assert.equal(await t.service.getInventory(), overlaid, "the same hour");
  t.setClock(Date.UTC(2026, 0, 1, 11, 0));
  const later = await t.service.getInventory();
  assert.notEqual(later, overlaid);
  assert.equal(later.fold, first.fold);
  assert.equal(t.folds(), 1);
});
