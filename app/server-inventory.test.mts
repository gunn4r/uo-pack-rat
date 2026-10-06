// server-inventory.test.mts — HTTP tests of the inventory routes, Forget and the blacklist.
//
// `GET /api/inventory` folding the demo fixtures (facets, worn gear and counts, every field the page's non-paged tabs read, no item list), a new scan picked up without a restart, `readScans()` skipping an invalid or unparsable scan file, missing items counted per root and listed by `GET /api/missing`, `GET /api/items` paging, sorting and searching, `GET /api/items/by-serial`; `POST /api/forget` (409 under `--demo`, a bad root, name bounds, only a schema-valid tombstone written, a boolean, unsafe integer or out-of-range serial refused) and its `changed` event (with a run deletion's) on open streams; `POST /api/forget-character` (refusals, one tombstone, the character dropped and given back on a newer scan, 409 under `--demo`); and `/api/blacklist` (issue #38: add, list, remove, bad bodies and entries dropped, Keep and Remove through the fold).
//
// Tags: [smoke] and [fast].
import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, cpSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveConfig, ensureLayout } from "./config.mts";
import type { ServerHandle } from "./vault-server.mts";
import { startTestServer as startServer } from "./server-fixture.mts";
import { setRules } from "./vault-lib.mts";
import { validateScan } from "./scan-schema.mts";
import { buildUi } from "../scripts/build-ui.mts";
import { buildSchemaTypes } from "../scripts/build-schema-types.mts";
import { asJson, HERE, UOALIVE, sseReader, JSON_HEADERS, logText, type InventorySummary, type InventoryResponse, type ItemsPageResponse, type ItemsBySerialResponse } from "./server-routes-fixture.mts";

// Order matters: build the schema types before buildUi() runs, not because tsconfig.browser.json's
// `include` enforces it (a missing literal entry there is silently dropped, not an error — verified)
// but because this call is the only actual guarantee app/schema/types.d.mts exists before anything
// imports from it. Also so a bare `node --test app/server.test.mts` works on a fresh clone (no
// pretest hook run). The optimizer core needs no build step of its own — startServer() below resolves
// it straight from source via config.mts's paths.core (PACKRAT_CORE overrides it).
buildSchemaTypes();
buildUi();   // this file's own route tests fetch /ui/app.mjs and /vault-lib.mjs from app/dist/
setRules(UOALIVE);
afterEach(() => setRules(UOALIVE));
// node:test does not wait for an async before() when a tag filter (--smoke) leaves a file no test to run, so after()
// waits for the start itself rather than closing a server that is not up yet.
let srv: ServerHandle, srvStarted: Promise<unknown> = Promise.resolve();
before(() => (srvStarted = startServer(ensureLayout(resolveConfig(["--demo", "--port", "0", "--data", mkdtempSync(join(tmpdir(), "qm-"))], {}))).then((s) => { srv = s; })));
after(async () => { await srvStarted; await srv?.close(); });
const get = (p: string): Promise<Response> => fetch(srv.url + p);

test("[smoke] /api/inventory has no scansDir and folds the demo fixtures", async () => {
  const j = asJson<InventoryResponse>(await (await get("/api/inventory")).json());
  assert.equal(j.ok, true); assert.equal("scansDir" in j, false); assert.ok(j.snapshotCount >= 2);
});

// --demo points paths.scans at the committed app/fixtures/ directory; Forget must refuse there
// instead of writing a tombstone into repo data. Uses the module-level `srv` (--demo).
test("[fast] POST /api/forget is refused under --demo, and app/fixtures/ stays clean", async () => {
  const before = readdirSync(join(HERE, "fixtures")).sort();
  const r = await fetch(srv.url + "/api/forget", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ root: 12345 }),
  });
  assert.equal(r.status, 409);
  assert.deepEqual(asJson(await r.json()), { ok: false, error: "demo data is read-only" });
  assert.deepEqual(readdirSync(join(HERE, "fixtures")).sort(), before, "no file was written under app/fixtures/");
});

// Post-review fix: only truthiness was checked, so {root:"abc"} used to return 200 and write a
// tombstone whose roots[0].serial serialized to null — every later read then logged a schema
// violation forever while the user believed the container was forgotten.
test("[fast] POST /api/forget rejects a non-integer or non-positive root before writing anything", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--port", "0", "--data", dir], {})));
  try {
    for (const bad of ["abc", 0, -5, 12.5, null]) {
      const r = await fetch(s2.url + "/api/forget", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ root: bad }) });
      assert.equal(r.status, 400, `root ${JSON.stringify(bad)} should be rejected`);
    }
    assert.equal(existsSync(join(dir, "scans")) ? readdirSync(join(dir, "scans")).length : 0, 0, "no tombstone was written for any rejected root");
    const ok = await fetch(s2.url + "/api/forget", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ root: 12345 }) });
    assert.equal(ok.status, 200);
  } finally {
    await s2.close();
  }
});

// Forget and run deletion used to push nothing on /api/events, so every other open tab kept showing the
// forgotten container or the deleted run until a manual reload.
test("[fast] POST /api/forget and DELETE /api/runs/<id> stream a changed event to open tabs", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-changed-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--port", "0", "--data", dir], {})));
  const sse = sseReader(await fetch(s2.url + "/api/events"));
  try {
    await sse.readUntil((b) => b.includes("event: hello"));
    assert.equal((await fetch(s2.url + "/api/forget", { method: "POST", headers: { ...JSON_HEADERS, "x-client-id": "tab-a" }, body: JSON.stringify({ root: 12345 }) })).status, 200);
    await sse.readUntil((b) => b.includes('event: changed\ndata: {"what":"inventory","by":"tab-a"'));
    const id = "0b5c1a4e-0000-4000-8000-000000000002";
    writeFileSync(join(dir, "runs", `${id}.json`), "{}");
    assert.equal((await fetch(s2.url + `/api/runs/${id}`, { method: "DELETE" })).status, 200);
    await sse.readUntil((b) => b.includes('event: changed\ndata: {"what":"runs"'));
  } finally {
    await sse.cancel();
    await s2.close();
  }
});

// readScans() (app/vault-server.mts) upgrades and schema-validates every scan file on read; a file
// that fails either step must be logged (console.warn) and skipped, never crash the server or the
// rest of the fold. Uses a non-demo server (--demo redirects paths.scans to app/fixtures, which this
// test needs to control directly) with its own scans/ directory seeded with one valid v1 fixture
// copy alongside a syntactically-broken file and a schema-invalid one.
test("[fast] readScans() skips invalid scan files (bad JSON, schema-invalid) instead of crashing the server", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-"));
  const scansDir = join(dir, "scans");
  mkdirSync(scansDir, { recursive: true });
  writeFileSync(join(scansDir, "demo-Kestrel.json"), readFileSync(join(HERE, "fixtures", "demo-Kestrel.json"), "utf8"));
  writeFileSync(join(scansDir, "broken.json"), "{not json");
  writeFileSync(join(scansDir, "bad-schema.json"), JSON.stringify({ schemaVersion: 2, character: 5 }));
  const s2 = await startServer(ensureLayout(resolveConfig(["--port", "0", "--data", dir], {})));
  try {
    const j1 = asJson<InventoryResponse>(await (await fetch(s2.url + "/api/inventory")).json());
    assert.equal(j1.ok, true);
    assert.equal(j1.snapshotCount, 1, "only the one valid scan should have folded");
    assert.ok(j1.inventory.characters.Kestrel, "the valid scan folded despite the two bad files alongside it");
    // a second request proves the bad files didn't leave the server in a broken state
    const j2 = asJson<InventoryResponse>(await (await fetch(s2.url + "/api/inventory")).json());
    assert.equal(j2.ok, true);
    assert.equal(j2.snapshotCount, 1);
  } finally {
    await s2.close();
  }
});

// Missing since last scan (issue #99): /api/inventory counts what left each root between its last two scans,
// and GET /api/missing lists it for one root.
test("[fast] /api/inventory counts missing items per root and /api/missing lists them", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-"));
  const scansDir = join(dir, "scans");
  mkdirSync(scansDir, { recursive: true });
  const first = JSON.parse(readFileSync(join(HERE, "fixtures", "demo-Kestrel.json"), "utf8")) as { scannedAt: string; roots: Array<{ serial: number }>; items: Array<{ serial: number; name: string }> };
  const gone = first.items.find((it) => !first.items.some((o) => o !== it && o.serial === it.serial))!;
  // Recent stamps: retention prunes a scan older than its window that the fold no longer needs.
  const day = (n: number): string => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 19);   // v1 stamps are naive local time
  writeFileSync(join(scansDir, "a.json"), JSON.stringify({ ...first, scannedAt: day(2) }));
  writeFileSync(join(scansDir, "b.json"), JSON.stringify({ ...first, scannedAt: day(1), items: first.items.filter((it) => it !== gone) }));
  const s2 = await startServer(ensureLayout(resolveConfig(["--port", "0", "--data", dir], {})));
  try {
    const root = String(first.roots[0]!.serial);
    const inv = asJson<InventoryResponse>(await (await fetch(s2.url + "/api/inventory")).json());
    assert.deepEqual(inv.inventory.missingCounts, { [root]: 1 });
    const m = asJson<{ ok: boolean; items: Array<{ serial: number; name: string }> }>(await (await fetch(s2.url + "/api/missing?root=" + root)).json());
    assert.deepEqual(m.items.map((it) => [it.serial, it.name]), [[gone.serial, gone.name]]);
    const none = asJson<{ items: unknown[] }>(await (await fetch(s2.url + "/api/missing?root=12345")).json());
    assert.deepEqual(none.items, []);
    assert.equal((await fetch(s2.url + "/api/missing?root=abc")).status, 400);
    // A blacklisted root is never opened again: what its stale scans differ by is not reported.
    writeFileSync(join(dir, "scan-blacklist.json"), JSON.stringify([{ serial: +root, name: "Chest", addedAt: day(0) }]));
    assert.deepEqual(asJson<InventoryResponse>(await (await fetch(s2.url + "/api/inventory")).json()).inventory.missingCounts, {});
    assert.deepEqual(asJson<{ items: unknown[] }>(await (await fetch(s2.url + "/api/missing?root=" + root)).json()).items, []);
  } finally {
    await s2.close();
  }
});

test("[smoke] /api/inventory carries facets, worn gear and counts, and no item list", async () => {
  const j = asJson<InventoryResponse>(await (await get("/api/inventory")).json());
  assert.equal(j.ok, true);
  assert.equal(j.inventory.items, undefined);
  assert.ok(j.inventory.itemCount > 0);
  assert.ok(j.inventory.facets.kinds.length > 0, JSON.stringify(j.inventory.facets));
  assert.ok(Object.keys(j.inventory.worn).length > 0);
});

// Regression test for a live bug found in the browser gate after Task 5: page load() threw
// "Cannot convert undefined or null to object" — NOT in containers.mts (its `state.inv.containers`/
// `rootCounts` reads were fine all along), but in builder.mts's renderProfile(), which called the
// client-side vault-lib.mts helpers gearSkills()/builderKeys() against state.inv — and those do
// `Object.values(inv.items)`, which is exactly the field Task 5 stopped shipping. The throw happened
// before renderContainers() ran (buildBuilder() runs first in load()'s sequence), which is why the
// Containers tab looked broken — it was collateral, not its own bug. Fixed by adding `gearSkills` to
// GET /api/inventory's `facets` (item-query.mts's facetsOf, mirroring `propKeys`) so the page never
// needs the full item map for this. This test pins every field a client module reads directly off
// `state.inv`/`state.facets` without going through GET /api/items, so a future field removal fails
// here instead of surfacing only as a live "failed to load" banner.
test("[smoke] /api/inventory carries every field the page's non-paged tabs read directly", async () => {
  const j = asJson<InventoryResponse>(await (await get("/api/inventory")).json());
  const inv = j.inventory;
  assert.ok(inv.containers && Object.keys(inv.containers).length > 0, "containers.mts reads state.inv.containers");
  assert.ok(inv.rootCounts && Object.keys(inv.rootCounts).length > 0, "containers.mts reads state.inv.rootCounts");
  assert.ok(inv.characters && Object.keys(inv.characters).length > 0, "characters.mts/builder.mts read state.inv.characters");
  assert.ok(inv.worn && Object.keys(inv.worn).length > 0, "characters.mts/sheet.mts read state.inv.worn");
  assert.ok(Array.isArray(inv.facets.gearSkills) && inv.facets.gearSkills.length > 0, "builder.mts's renderProfile reads state.facets.gearSkills");
  assert.ok(Array.isArray(inv.propKeys) && inv.propKeys.length > 0, "builder.mts/inventory.mts read state.propKeys");
});

test("[fast] /api/items pages, sorts and searches", async () => {
  const inv = asJson<InventoryResponse>(await (await get("/api/inventory")).json());
  const total = inv.inventory.itemCount;
  const page = asJson<ItemsPageResponse>(await (await get("/api/items?limit=5")).json());
  assert.equal(page.ok, true);
  assert.equal(page.rows!.length, 5);
  assert.equal(page.total, total);
  const all = asJson<ItemsPageResponse>(await (await get("/api/items?limit=500")).json());
  assert.equal(all.rows!.length, total);
  const names = all.rows!.map((r) => r.name);
  assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })), "sort=name (default) is A-to-Z, numbers by value");
  const rev = asJson<ItemsPageResponse>(await (await get("/api/items?limit=500&sort=name&dir=-1")).json());
  assert.deepEqual(rev.rows!.map((r) => r.name), [...names].reverse(), "dir=-1 reverses the default sort");
  const search = asJson<ItemsPageResponse>(await (await get("/api/items?q=" + encodeURIComponent("Vicious Crescent Blade"))).json());
  assert.ok(search.rows!.length >= 1, JSON.stringify(search));
  assert.ok(search.rows!.some((r) => r.name === "Vicious Crescent Blade"));
  // A Scroll of Transcendence is named by its skill and points, and found by them (issue #181).
  const sot = asJson<ItemsPageResponse>(await (await get("/api/items?q=" + encodeURIComponent("transcendence chivalry"))).json());
  assert.ok(sot.rows!.length > 0 && sot.rows!.every((r) => r.name === "Scroll of Transcendence (Chivalry - 0.6 Pts)"), JSON.stringify(sot.rows!.map((r) => r.name)));
  assert.equal(sot.rows![0]!.lines[0], "Scroll Of Transcendence", "the in-game name stays the tooltip's first line");
  const clamp = asJson<ItemsPageResponse>(await (await get("/api/items?limit=9999")).json());
  assert.equal(clamp.limit, 500);
  // The House map's search (issue #10): fields=hits answers the same query with only what the map reads, many rows a page.
  const hits = asJson<{ ok: boolean; total: number; limit: number; rows: Array<Record<string, unknown>> }>(await (await get("/api/items?fields=hits&limit=9999&q=" + encodeURIComponent("Vicious Crescent Blade"))).json());
  assert.equal(hits.total, search.total);
  assert.equal(hits.limit, 9999, "a hits page may be far larger than 500");
  assert.deepEqual(hits.rows.map((r) => r.serial), search.rows!.map((r) => r.serial));
  for (const r of hits.rows) assert.deepEqual(Object.keys(r).sort(), ["amount", "container", "name", "root", "serial", ...("location" in r ? ["location"] : [])].sort(), JSON.stringify(r));
  const full = search.rows!.find((r) => r.serial === hits.rows[0]!.serial)!;
  assert.deepEqual(hits.rows[0], { serial: full.serial, name: full.name, amount: full.amount, root: full.root, container: full.container, ...(full.location ? { location: { text: full.location.text } } : {}) });
  const every = asJson<{ total: number; rows: unknown[] }>(await (await get("/api/items?fields=hits&group=1")).json());
  assert.equal(every.rows.length, total, "one request is normal: the default hits page holds the whole fixture, and group is ignored");
  const grouped = asJson<ItemsPageResponse>(await (await get("/api/items?group=1")).json());
  assert.equal(grouped.ok, true);
  assert.ok(Array.isArray(grouped.groups) && grouped.groups.length > 0);
  assert.ok(!("rows" in grouped));
  assert.equal(grouped.stacks, all.total, "grouped, the answer still counts the stacks behind the names");
  assert.equal(grouped.pieces, all.pieces);
  // The Inventory's list filters and the rarity minimum reach the query from the wire.
  const rings = asJson<ItemsPageResponse>(await (await get("/api/items?slot=ring&slot=bracelet&rarityMin=" + encodeURIComponent("Major Magic Item"))).json());
  assert.ok(rings.rows!.length > 0 && rings.rows!.every((r) => ["ring", "bracelet"].includes(r.slot as string)), JSON.stringify(rings.rows!.map((r) => r.slot)));
  // Issue #182: a yes/no property reaches the query from the wire, and the facets offer it.
  assert.ok(inv.inventory.facets.flagKeys.includes("spell channeling"), JSON.stringify(inv.inventory.facets.flagKeys));
  const channel = asJson<ItemsPageResponse>(await (await get("/api/items?limit=500&flag=" + encodeURIComponent("spell channeling"))).json());
  assert.ok(channel.rows!.length > 0 && channel.rows!.length < total, JSON.stringify(channel.total));
  assert.ok(channel.rows!.every((r) => r.flags.includes("spell channeling")));
  const both = asJson<ItemsPageResponse>(await (await get("/api/items?flag=" + encodeURIComponent("spell channeling") + "&flag=" + encodeURIComponent("mage armor"))).json());
  assert.equal(both.total, 0, "flags AND together: no fixture item has both");
  // Issue #188: a weapon skill reaches the query from the wire, and the facets count it.
  const fencing = inv.inventory.facets.weaponSkills.find((w) => w.name === "fencing");
  assert.ok(fencing && fencing.count > 0, JSON.stringify(inv.inventory.facets.weaponSkills));
  const fence = asJson<ItemsPageResponse>(await (await get("/api/items?limit=500&wskill=fencing")).json());
  assert.equal(fence.total, fencing.count);
  assert.ok(fence.rows!.every((r) => r.skillReq === "fencing"), JSON.stringify(fence.rows!.map((r) => r.skillReq)));
});

test("[fast] GET /api/items/by-serial resolves full item records by serial", async () => {
  const page = asJson<ItemsPageResponse>(await (await get("/api/items?limit=3")).json());
  const serials = page.rows!.map((r) => r.serial);
  const unknown = 999999999;
  const res = asJson<ItemsBySerialResponse>(await (await get(`/api/items/by-serial?serials=${[...serials, unknown].join(",")}`)).json());
  assert.equal(res.ok, true);
  for (const s of serials) {
    assert.ok(res.items[s], `serial ${s} should resolve`);
    assert.ok(res.items[s]!.location, `serial ${s} should carry a location`);
  }
  assert.equal(res.items[unknown], undefined, "an unknown serial is simply absent, not an error");
  const tooMany = await get(`/api/items/by-serial?serials=${Array.from({ length: 201 }, (_, i) => i + 1).join(",")}`);
  assert.equal(tooMany.status, 400);
  const empty = await get("/api/items/by-serial");
  assert.equal(empty.status, 400);
});

test("[fast] a new scan file changes /api/inventory without a restart", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--port", "0", "--data", dir], {})));
  try {
    const before = asJson<InventoryResponse>(await (await fetch(s2.url + "/api/inventory")).json());
    assert.equal(before.inventory.itemCount, 0);
    const scansDir = join(dir, "scans");
    mkdirSync(scansDir, { recursive: true });
    const snap = {
      schemaVersion: 2, character: "CacheProbe", scannedAt: new Date().toISOString(),
      adapter: { id: "app", version: "1", client: "test", clientVersion: null,
        capabilities: { layers: [], arms: false, bank: false, ground: false, nested: false, tooltips: "label", bridge: [] } },
      shard: "uoalive", stats: {}, equipped: [{ serial: 999000001, name: "Test Ring", nameSource: "label", layer: "Ring" }],
      roots: [], containers: {}, items: [],
    };
    writeFileSync(join(scansDir, "cache-probe.json"), JSON.stringify(snap));
    const after = asJson<InventoryResponse>(await (await fetch(s2.url + "/api/inventory")).json());
    assert.ok(after.inventory.itemCount > before.inventory.itemCount, `${before.inventory.itemCount} -> ${after.inventory.itemCount}`);
  } finally {
    await s2.close();
  }
});

// Important 4: name was never type- or length-checked and the assembled document was never validated,
// so {name: {}} returned 200 and wrote a file every later fold re-read and re-rejected forever, while
// the user's Forget silently did nothing.
test("[fast] POST /api/forget validates name, bounds it, and only ever writes a document that passes validateScan", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-forget-name-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--port", "0", "--data", dir], {})));
  const scans = join(dir, "scans");
  try {
    for (const bad of [{}, [], 5, true]) {
      const r = await fetch(s2.url + "/api/forget", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ root: 1, name: bad }),
      });
      assert.equal(r.status, 400, `name ${JSON.stringify(bad)} should be refused`);
    }
    assert.equal(existsSync(scans) ? readdirSync(scans).length : 0, 0, "no tombstone was written for any rejected name");

    // a body far past what four small scalar fields need is refused outright (this route used to
    // inherit readBody's 50 MB default, which is what let a 200 KB name become a 200 KB scan file)
    const huge = await fetch(s2.url + "/api/forget", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ root: 1, name: "x".repeat(20_000) }),
    });
    assert.equal(huge.status, 413);
    assert.equal(readdirSync(scans).length, 0, "and nothing was written for it either");

    const long = await fetch(s2.url + "/api/forget", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ root: 1, name: "x".repeat(1000) }),
    });
    assert.equal(long.status, 200);
    const files = readdirSync(scans);
    assert.equal(files.length, 1);
    const doc = JSON.parse(readFileSync(join(scans, files[0]!), "utf8"));
    assert.equal(doc.roots[0].name.length, 64, "the label is capped");
    assert.equal(validateScan(doc).ok, true, "every file this route writes passes the scan contract");

    // one file per forgotten root, not one per click: the name used to carry a millisecond timestamp,
    // so a loop of calls grew <data>/scans/ without bound and slowed every later fold
    for (let i = 0; i < 5; i++) {
      await fetch(s2.url + "/api/forget", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ root: 1, name: "chest" }) });
    }
    assert.deepEqual(readdirSync(scans), files, "re-forgetting a root replaces its tombstone instead of adding one");
  } finally {
    await s2.close();
  }
});

test("[fast] POST /api/forget refuses a boolean, an unsafe integer and a serial past the scan contract's range", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-forget-root-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--port", "0", "--data", dir], {})));
  try {
    for (const bad of [true, 2 ** 60, "1e300", "0x10", 2 ** 32, " 7"]) {
      const r = await fetch(s2.url + "/api/forget", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ root: bad }) });
      assert.equal(r.status, 400, `root ${JSON.stringify(bad)} should be rejected`);
    }
    assert.equal(readdirSync(join(dir, "scans")).length, 0, "no tombstone was written");
    assert.doesNotMatch(logText(dir), /POST \/api\/forget|refusing/, "and nothing reached the 500 path");
    assert.equal((await fetch(s2.url + "/api/forget", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ root: "4660" }) })).status, 200, "a decimal string still works");
  } finally {
    await s2.close();
  }
});

// A deleted, renamed or transferred character used to keep its card and worn set in the inventory
// forever: the fold only drops what a newer scan of the same root or character replaces.
test("[fast] POST /api/forget-character drops the character, its worn set, backpack and bank, and a rescan brings it back", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-forgetchar-"));
  mkdirSync(join(dir, "scans"), { recursive: true });
  cpSync(join(HERE, "fixtures", "demo-Dorran.json"), join(dir, "scans", "demo-Dorran.json"));
  cpSync(join(HERE, "fixtures", "demo-Kestrel.json"), join(dir, "scans", "demo-Kestrel.json"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--port", "0", "--data", dir], {})));
  const forget = (body: unknown): Promise<Response> => fetch(s2.url + "/api/forget-character", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const inventory = async (): Promise<InventorySummary> => asJson<InventoryResponse>(await (await fetch(s2.url + "/api/inventory")).json()).inventory;
  try {
    const before = await inventory();
    assert.ok(before.characters.Dorran && (before.worn.Dorran as unknown[]).length > 0);
    for (const bad of [{}, { character: "" }, { character: 5 }, { character: "x".repeat(65) }, { character: "_vault" }]) {
      assert.equal((await forget(bad)).status, 400, `${JSON.stringify(bad)} should be refused`);
    }
    // No tombstone for a name the inventory has never had: one file per arbitrary name would pile up.
    assert.equal((await forget({ character: "Nobody" })).status, 404);
    assert.deepEqual(readdirSync(join(dir, "scans")).filter((f) => f.startsWith("_forget-char-")), [], "nothing was written for a refused name");
    assert.equal((await forget({ character: "Dorran" })).status, 200);
    const after = await inventory();
    assert.equal(after.characters.Dorran, undefined, "the character card is gone");
    assert.equal(after.worn.Dorran, undefined, "and its worn set");
    const dorranRoots = Object.values(after.containers).filter((c) => (c as { scannedBy?: string; kind?: string }).scannedBy === "Dorran" && ["backpack", "bank"].includes((c as { kind: string }).kind));
    assert.deepEqual(dorranRoots, [], "and its backpack and bank");
    assert.ok(after.characters.Kestrel, "another character is untouched");
    const tombs = readdirSync(join(dir, "scans")).filter((f) => f.startsWith("_forget-char-"));
    assert.equal(tombs.length, 1);
    assert.equal(validateScan(JSON.parse(readFileSync(join(dir, "scans", tombs[0]!), "utf8"))).ok, true, "the tombstone passes the scan contract");

    // A newer scan of the character brings it back.
    const rescan = JSON.parse(readFileSync(join(HERE, "fixtures", "demo-Dorran.json"), "utf8"));
    // A v1 scan's stamp is naive local time: an hour from now, in this machine's clock.
    const later = new Date(Date.now() + 3600_000), p2 = (n: number): string => String(n).padStart(2, "0");
    rescan.scannedAt = `${later.getFullYear()}-${p2(later.getMonth() + 1)}-${p2(later.getDate())}T${p2(later.getHours())}:${p2(later.getMinutes())}:${p2(later.getSeconds())}`;
    writeFileSync(join(dir, "scans", "demo-Dorran-later.json"), JSON.stringify(rescan));
    assert.ok((await inventory()).characters.Dorran, "rescanned, the character is back");
  } finally {
    await s2.close();
  }
});

test("[fast] POST /api/forget-character is refused under --demo", async () => {
  const r = await fetch(srv.url + "/api/forget-character", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ character: "Dorran" }) });
  assert.equal(r.status, 409);
});

// Issue #38: <data>/scan-blacklist.json, written by these routes and by the TazUO packrat-blacklist.py.
// Keep and Remove come from the fold's existing rules: a listed root is missing from newer scans (kept),
// a listed bag is recorded unopened (its contents kept), and Remove is Forget.
test("[fast] /api/blacklist adds, lists and removes a container, and Keep and Remove fall out of the fold", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-blacklist-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--port", "0", "--data", dir], {})));
  const file = join(dir, "scan-blacklist.json");
  const add = (body: unknown): Promise<Response> => fetch(s2.url + "/api/blacklist", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(body) });
  const list = async (): Promise<Array<Record<string, unknown>>> => asJson<{ containers: Array<Record<string, unknown>> }>(await (await fetch(s2.url + "/api/blacklist")).json()).containers;
  const items = async (): Promise<string[]> => Object.keys(asJson<{ items: Record<string, unknown> }>(await (await fetch(s2.url + "/api/items/by-serial?serials=4661,4672")).json()).items).sort();
  const scan = (name: string, at: number, roots: number[], containers: Record<string, unknown>, its: Array<[number, number]>): void => writeFileSync(join(dir, "scans", name), JSON.stringify({
    schemaVersion: 2, character: "Dorran", scannedAt: new Date(at).toISOString(), stats: {}, equipped: [],
    adapter: { id: "tazuo", version: "2.5.0", client: "TazUO", clientVersion: null, capabilities: { layers: [], arms: true, bank: true, ground: true, nested: true, tooltips: "opl", bridge: [] } },
    roots: roots.map((serial) => ({ serial, kind: "ground", name: "Chest", opened: true })), containers,
    items: its.map(([serial, container]) => ({ serial, container, name: "Ring", nameSource: "opl", tooltip: ["Ring"] })) }));
  const chest = (serial: number) => ({ serial, kind: "ground", name: "Chest", parent: null, root: serial });
  const bag = { serial: 4671, kind: "container", name: "Bag", parent: 4670, root: 4670 };
  mkdirSync(join(dir, "scans"), { recursive: true });
  // Before the blacklisting: a trash barrel (4660) with a ring, and a chest (4670) holding a bag with a ring.
  scan("before.json", Date.now() - 3600_000, [4660, 4670], { 4660: chest(4660), 4670: chest(4670), 4671: bag }, [[4661, 4660], [4672, 4671]]);
  try {
    for (const bad of [{ serial: 0, name: "x" }, { serial: "4660", name: "x" }, { serial: 1, name: 5 }]) {
      assert.equal((await add(bad)).status, 400, `${JSON.stringify(bad)} should be refused`);
    }
    assert.equal(existsSync(file), false, "nothing was written for a refused body");
    assert.equal((await add({ serial: 4660, name: "Trash Barrel".repeat(10), where: "1, 2" })).status, 200);
    assert.equal((await add({ serial: 4671, name: "Bag" })).status, 200);
    assert.equal((await add({ serial: 4660, name: "again" })).status, 200, "adding a listed container again changes nothing");
    const [entry] = await list();
    assert.equal((await list()).length, 2);
    assert.deepEqual([entry!.serial, (entry!.name as string).length, entry!.where], [4660, 64, "1, 2"]);
    // What a scanner honouring the list writes next: no 4660 root, the bag unopened. Keep keeps both rings.
    scan("after.json", Date.now() + 3600_000, [4670], { 4670: chest(4670), 4671: { ...bag, opened: false } }, []);
    assert.deepEqual(await items(), ["4661", "4672"]);
    assert.equal((await fetch(s2.url + "/api/forget", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ root: 4660 }) })).status, 200);
    assert.deepEqual(await items(), ["4672"], "Remove forgets the root");
    assert.equal((await fetch(s2.url + "/api/blacklist/4660", { method: "DELETE" })).status, 200);
    assert.deepEqual((await list()).map((e) => e.serial), [4671]);
    // A file that does not parse reads as empty; a bad entry is dropped and the good ones kept.
    for (const [doc, want] of [["{not json", []], [JSON.stringify([{ serial: -1, name: "x", addedAt: "y" }, { serial: 7, name: "ok", addedAt: "2026-09-24T10:00:00Z" }]), [7]]] as const) {
      writeFileSync(file, doc);
      assert.deepEqual((await list()).map((e) => e.serial), want);
    }
  } finally {
    await s2.close();
  }
});
