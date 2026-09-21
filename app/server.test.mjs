// server.test.mjs — HTTP route tests against a real listening server (ephemeral port, tmp data dir).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, renameSync, rmSync, cpSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import http from "node:http";
import { createConnection } from "node:net";
import { resolveConfig, ensureLayout } from "./config.mts";
import { startServer } from "./vault-server.mjs";
import { buildPools, foldSnapshots, setRules } from "./vault-lib.mts";
import { upgradeScan, validateScan } from "./scan-schema.mts";
import { DEFAULT_OPTIONAL_SLOTS } from "./mip.mts";
import { buildUi } from "../scripts/build-ui.mjs";
import { buildSchemaTypes } from "../scripts/build-schema-types.mts";
import { validate } from "./schema/validate.mts";

const BRIDGE_SCHEMA = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "schema", "bridge.v1.schema.json"), "utf8"));

// Order matters: build the schema types before buildUi() runs, not because tsconfig.browser.json's
// `include` enforces it (a missing literal entry there is silently dropped, not an error — verified)
// but because this call is the only actual guarantee app/schema/types.d.mts exists before anything
// imports from it. Also so a bare `node --test app/server.test.mjs` works on a fresh clone (no
// pretest hook run). The optimizer core needs no build step of its own — startServer() below resolves
// it straight from source via config.mts's paths.core (PACKRAT_CORE overrides it).
buildSchemaTypes();
buildUi();   // this file's own route tests fetch /ui/app.mjs and /vault-lib.mjs from app/dist/
const HERE = dirname(fileURLToPath(import.meta.url));
// This file's own vault-lib.mts import is a separate module instance from the one the server
// dynamically re-imports per request (busted by mtime) — a direct call here to a rules-aware
// function (buildPools) needs its own setRules().
setRules(JSON.parse(readFileSync(join(HERE, "rules", "uoalive.json"), "utf8")));

let srv;
before(async () => { srv = await startServer(ensureLayout(resolveConfig(["--demo", "--port", "0", "--data", mkdtempSync(join(tmpdir(), "qm-"))], {}))); });
after(() => srv.close());
const get = (p) => fetch(srv.url + p);

// Since Task 5, GET /api/inventory never carries the full item map (the page pages GET /api/items
// instead), so a test that wants to run buildPools() itself — to check the server's by-character
// /api/optimize form against a client-equivalent call — has to fold the same scan files the server
// folds, the same way the server's own readScans()+getInventory() do (upgrade, validate, skip a bad
// file rather than throw), instead of reading the (now slimmer) HTTP response.
function foldFixtures(dir, shard = "uoalive") {
  const docs = [];
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
    try {
      const raw = JSON.parse(readFileSync(join(dir, f), "utf8"));
      const doc = upgradeScan(raw, { shard });
      const { ok } = validateScan(doc);
      if (ok) docs.push(doc);
    } catch { /* skip an unparsable fixture, same as the server does */ }
  }
  return foldSnapshots(docs);
}

// fetch() (both browser and Node's undici) refuses to let a caller set Host or Origin — both are on
// the Fetch spec's forbidden-header list — so the Host/Origin tests below go around it with node:http
// directly, which has no such restriction. rawReq(url, {method, headers, body}) → {status, headers, text, json()}.
function rawReq(url, { method = "GET", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, method, headers }, (res) => {
      let buf = "";
      res.setEncoding("utf8");
      res.on("data", (c) => { buf += c; });
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, text: buf, json: () => JSON.parse(buf) }));
    });
    req.on("error", reject);
    if (body != null) req.write(body);
    req.end();
  });
}

// /api/events (and the per-job optimize events route) never end on their own — a plain rawReq/fetch
// that waits for the response body to finish would hang forever. sseReader(response) hands back one
// reader + decoder + growing buffer a test can call readUntil(matcher) on repeatedly (a stream can
// only ever be locked by one reader — getReader() a second time throws — so the reader is created
// once and reused for every event the test waits on).
function sseReader(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  // A reader.read() that loses the Promise.race below (the timeout wins) is NOT cancelled — it stays
  // pending and will still resolve with whatever chunk arrives next. `pending` remembers that in-flight
  // call across readUntil invocations, so a caller that retries readUntil after a timeout (see
  // readUntilOrRescan below) reuses it instead of issuing a second, concurrent reader.read(): two
  // concurrent reads on one reader resolve strictly in call order, so a second call would only ever see
  // the chunk AFTER the one the first (abandoned) call is still waiting on — silently stealing the very
  // event a retry is waiting for. Found by exactly that symptom: a synthetic "fs.watch delivers nothing"
  // repro that proved the server-side broadcast happened (via the watcher's own log) while a naive retry
  // still timed out.
  let pending = null;
  async function readUntil(matcher, { timeoutMs = 3000 } = {}) {
    const deadline = Date.now() + timeoutMs;
    while (!matcher(buf)) {
      const remaining = Math.max(1, deadline - Date.now());
      if (remaining <= 1 && Date.now() >= deadline) throw new Error(`sseReader: timed out waiting for a match; got:\n${buf}`);
      if (!pending) pending = reader.read();
      const { value, done } = await Promise.race([
        pending,
        new Promise((_, reject) => setTimeout(() => reject(new Error("sseReader: timed out")), remaining)),
      ]);
      pending = null;   // consumed — safe to start a fresh read() next iteration (ours or a later retry's)
      if (done) throw new Error(`sseReader: stream ended before a match; got:\n${buf}`);
      buf += decoder.decode(value, { stream: true });
    }
    return buf;
  }
  return { readUntil, cancel: () => reader.cancel().catch(() => {}) };
}

// A dropped inbox file's fs.watch notification can be silently missed by the OS — reproduced live
// (not a timing-margin issue: an instrumented trace showed the watcher's fs.watch callback firing
// ZERO times for the whole life of the affected watcher, not late) in
// .superpowers/sdd/2026-09-17-phase-6-adapters/sse-flake-report.md. app/vault-server.mjs's own
// POST /api/import and /api/import/paste routes already treat this as expected platform behavior and
// nudge scanOnce() themselves instead of trusting fs.watch alone (see their "Nudge the watcher"
// comments); POST /api/import/rescan exposes that same nudge for a drop the app didn't make itself —
// exactly the case here, and exactly what a real player would click if their drop never lit up. So a
// test waiting on a live SSE event from a dropped file does what a real player would do when fs.watch
// stays silent: rescan once, then keep waiting — a longer timeout would not help an event that never
// fires at all. Any OTHER readUntil failure (the stream ending, a wiring/crash bug) is not swallowed —
// only "timed out" retries through the rescan; scanOnce()/ingestFile are idempotent, so a rescan that
// races a live event that was merely slow (not dropped) is harmless either way.
async function readUntilOrRescan(sse, matcher, serverUrl, { timeoutMs = 3000, rescanTimeoutMs = 5000 } = {}) {
  try {
    return await sse.readUntil(matcher, { timeoutMs });
  } catch (e) {
    if (!/timed out/.test(e.message)) throw e;
    await fetch(serverUrl + "/api/import/rescan", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    return sse.readUntil(matcher, { timeoutMs: rescanTimeoutMs });
  }
}

test("[smoke] / serves the page with a CSP and no inline script", async () => {
  const r = await get("/"); assert.equal(r.status, 200);
  assert.match(r.headers.get("content-security-policy") || "", /script-src 'self'/);
  assert.equal(r.headers.get("x-content-type-options"), "nosniff");
});
test("[smoke] / has no inline <script>", async () => {
  const r = await get("/");
  assert.doesNotMatch(await r.text(), /<script(?![^>]*\bsrc=)/, "no inline <script>");
});
test("[smoke] /api/inventory has no scansDir and folds the demo fixtures", async () => {
  const j = await (await get("/api/inventory")).json();
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
  assert.deepEqual(await r.json(), { ok: false, error: "demo data is read-only" });
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
// Post-review fix: POST /api/bridge only checked action/serial were truthy, so a page bug or any
// other local caller could queue a line violating BRIDGE_SCHEMA.command on several counts (unknown
// action, non-integer serial, missing name) at once. Validates the LINE THE ROUTE ACTUALLY WROTE
// (read back off disk), not a hand-written literal.
test("[fast] POST /api/bridge validates the assembled line against BRIDGE_SCHEMA.command", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--demo", "--port", "0", "--data", dir], {})));
  try {
    const badAction = await fetch(s2.url + "/api/bridge", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "delete-everything", serial: 1, name: "n", chain: [], pos: null }) });
    assert.equal(badAction.status, 400);
    const badSerial = await fetch(s2.url + "/api/bridge", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "grab", serial: "0x40000010", name: "n", chain: [], pos: null }) });
    assert.equal(badSerial.status, 400);
    const badChain = await fetch(s2.url + "/api/bridge", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "grab", serial: 1, name: "n", chain: ["x"], pos: null }) });
    assert.equal(badChain.status, 400);
    const good = await fetch(s2.url + "/api/bridge", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "grab", serial: 0x40000010, name: "Ring", chain: [1, 2], pos: null }) });
    assert.equal(good.status, 200);
    const { id } = await good.json();
    const lines = readFileSync(join(dir, "bridge", "tazuo", "queue.jsonl"), "utf8").trim().split("\n");
    assert.equal(lines.length, 1, "only the valid call should have queued a line");
    const written = JSON.parse(lines[0]);
    assert.equal(written.id, id);
    const v = validate(BRIDGE_SCHEMA.command, written);
    assert.equal(v.ok, true, JSON.stringify(v.errors));
  } finally {
    await s2.close();
  }
});

// ---- Per-adapter bridge routing (Phase 6 final review follow-up) ----------------------------------
// The bridge queue/status routes and the installer's running-bridge guard used to be hard-coded to
// <data>/bridge/tazuo/ regardless of which client was actually configured — a Razor Enhanced player
// whose capabilities.json declares all three bridge actions got real Highlight/Grab/Go-to buttons
// that queued commands into a folder adapters/razor-enhanced/packrat-bridge.py never reads (it reads
// its own <data>/bridge/razor-enhanced/, per its own header). These three tests cover exactly the
// three things asked for: a command lands in the CONFIGURED adapter's own queue and not another's,
// the status indicator reads the configured adapter's own status, and the install guard checks the
// adapter actually being installed.

test("[fast] POST /api/bridge queues into the configured adapter's own directory, not a fixed tazuo one, and never cross-contaminates", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-bridge-routing-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--demo", "--port", "0", "--data", dir], {})));
  try {
    const setClient = await fetch(s2.url + "/api/settings", { method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ client: { adapter: "razor-enhanced", scriptsDir: dir } }) });
    assert.equal(setClient.status, 200, JSON.stringify(await setClient.json()));

    const r = await fetch(s2.url + "/api/bridge", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "grab", serial: 0x40000010, name: "Ring", chain: [], pos: null }) });
    assert.equal(r.status, 200, JSON.stringify(await r.json().catch(() => null)));

    assert.ok(existsSync(join(dir, "bridge", "razor-enhanced", "queue.jsonl")), "the command landed in razor-enhanced's own queue");
    assert.equal(existsSync(join(dir, "bridge", "tazuo", "queue.jsonl")), false, "nothing was written to tazuo's queue for a razor-enhanced-configured client");
    const lines = readFileSync(join(dir, "bridge", "razor-enhanced", "queue.jsonl"), "utf8").trim().split("\n");
    assert.equal(lines.length, 1);
    assert.equal(JSON.parse(lines[0]).action, "grab");
  } finally {
    await s2.close();
  }
});

test("[fast] GET /api/bridge/status reads the configured adapter's own status.json, not a fixed tazuo one", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-bridge-status-routing-"));
  // razor-enhanced's status, written directly (as its own packrat-bridge.py would) — deliberately
  // different from anything that would ever land in bridge/tazuo/.
  const razorBridgeDir = join(dir, "bridge", "razor-enhanced");
  mkdirSync(razorBridgeDir, { recursive: true });
  writeFileSync(join(razorBridgeDir, "status.json"), JSON.stringify({
    alive: new Date().toISOString(), character: "RazorPlayer", current: null, results: {}, counts: { done: 0, failed: 0 },
  }));
  // A DIFFERENT (older/dead) tazuo status, so a test that accidentally read the wrong file would be
  // caught by either the character name or the online flag being wrong, not just a missing-file 404.
  const tazuoBridgeDir = join(dir, "bridge", "tazuo");
  mkdirSync(tazuoBridgeDir, { recursive: true });
  writeFileSync(join(tazuoBridgeDir, "status.json"), JSON.stringify({
    alive: new Date(Date.now() - 3600_000).toISOString(), character: "WrongCharacter", current: null, results: {}, counts: { done: 0, failed: 0 },
  }));

  const s2 = await startServer(ensureLayout(resolveConfig(["--demo", "--port", "0", "--data", dir], {})));
  try {
    const setClient = await fetch(s2.url + "/api/settings", { method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ client: { adapter: "razor-enhanced", scriptsDir: dir } }) });
    assert.equal(setClient.status, 200, JSON.stringify(await setClient.json()));

    const st = await (await fetch(s2.url + "/api/bridge/status")).json();
    assert.equal(st.online, true, JSON.stringify(st));
    assert.equal(st.character, "RazorPlayer", "must read razor-enhanced's own status, not tazuo's stale one");
  } finally {
    await s2.close();
  }
});

test("[fast] POST /api/setup/install's running-bridge guard checks the adapter being INSTALLED, not the currently-configured client", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-bridge-install-guard-"));
  // tazuo's bridge looks alive — but we're about to install razor-enhanced, a different adapter, so
  // this must NOT block the install.
  const tazuoBridgeDir = join(dir, "bridge", "tazuo");
  mkdirSync(tazuoBridgeDir, { recursive: true });
  writeFileSync(join(tazuoBridgeDir, "status.json"), JSON.stringify({ alive: new Date().toISOString(), character: "Someone", current: null, results: {}, counts: { done: 0, failed: 0 } }));

  const s2 = await startServer(ensureLayout(resolveConfig(["--port", "0", "--data", dir], {})));
  try {
    const scriptsDir1 = mkdtempSync(join(tmpdir(), "qm-bridge-install-guard-dest1-"));
    const installOther = await fetch(s2.url + "/api/setup/install", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ adapter: "razor-enhanced", scriptsDir: scriptsDir1 }) });
    assert.equal(installOther.status, 200, `installing razor-enhanced must not be blocked by tazuo's own bridge running: ${JSON.stringify(await installOther.json().catch(() => null))}`);

    // Now make razor-enhanced's OWN bridge look alive, and installing razor-enhanced again must be refused.
    const razorBridgeDir = join(dir, "bridge", "razor-enhanced");
    mkdirSync(razorBridgeDir, { recursive: true });
    writeFileSync(join(razorBridgeDir, "status.json"), JSON.stringify({ alive: new Date().toISOString(), character: "Someone", current: null, results: {}, counts: { done: 0, failed: 0 } }));
    const scriptsDir2 = mkdtempSync(join(tmpdir(), "qm-bridge-install-guard-dest2-"));
    const installSelf = await fetch(s2.url + "/api/setup/install", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ adapter: "razor-enhanced", scriptsDir: scriptsDir2 }) });
    assert.equal(installSelf.status, 409, "installing razor-enhanced again must be refused once ITS OWN bridge looks alive");
  } finally {
    await s2.close();
  }
});

test("[fast] /ui/ rejects traversal and unlisted files", async () => {
  assert.equal((await get("/ui/../vault-server.mjs")).status, 404);
  assert.equal((await get("/ui/nope.mjs")).status, 404);
});
test("[fast] /ui/app.mjs is served with the right content-type", async () => {
  assert.equal((await get("/ui/app.mjs")).status, 200);
  assert.equal((await get("/ui/app.mjs")).headers.get("content-type"), "text/javascript; charset=utf-8");
});
// ui/shard.mjs (Important 3's fix: changeShard(), shared by the header picker and the wizard's shard
// step) is just another file under app/ui/ — the /ui/<name> allowlist route needs no per-file
// registration, but a new module is still worth a one-line proof it's actually reachable.
test("[fast] /ui/shard.mjs is served with the right content-type", async () => {
  assert.equal((await get("/ui/shard.mjs")).status, 200);
  assert.equal((await get("/ui/shard.mjs")).headers.get("content-type"), "text/javascript; charset=utf-8");
});
// scan-schema.mjs (served at /scan-schema.mjs) imports validate() from "./schema/validate.mjs" — the
// browser resolves that relative import against scan-schema.mjs's own served URL, so it 404s without
// this route. Caught live by the Task 2 browser check (a bootstrap import chain failure with no other
// visible symptom besides a stuck "loading…" status and one console error).
test("[fast] /schema/validate.mjs is servable (scan-schema.mjs's own relative import)", async () => {
  const r = await get("/schema/validate.mjs");
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("content-type"), "text/javascript; charset=utf-8");
  assert.match(await r.text(), /export function validate/);
});
test("[fast] writes require application/json", async () => {
  const r = await fetch(srv.url + "/api/profiles", { method: "PUT", body: "{}" });
  assert.equal(r.status, 415);
});

// readScans() (app/vault-server.mjs) upgrades and schema-validates every scan file on read; a file
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
    const j1 = await (await fetch(s2.url + "/api/inventory")).json();
    assert.equal(j1.ok, true);
    assert.equal(j1.snapshotCount, 1, "only the one valid scan should have folded");
    assert.ok(j1.inventory.characters.Kestrel, "the valid scan folded despite the two bad files alongside it");
    // a second request proves the bad files didn't leave the server in a broken state
    const j2 = await (await fetch(s2.url + "/api/inventory")).json();
    assert.equal(j2.ok, true);
    assert.equal(j2.snapshotCount, 1);
  } finally {
    await s2.close();
  }
});

// A build in progress keeps its SSE client's response "waiting for a response", which is exactly
// what server.close() waits out by default — without ending those streams first, close() would hang
// on the connection's keep-alive idle timeout (seconds) instead of resolving once the workers stop.
test("[fast] close() ends open SSE streams instead of waiting out their keep-alive", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--demo", "--port", "0", "--data", dir], {})));
  try {
    const inv = await (await fetch(s2.url + "/api/inventory")).json();
    const profiles = await (await fetch(s2.url + "/api/profiles")).json();
    const rules = await (await fetch(s2.url + "/api/rules")).json();
    const character = Object.keys(inv.inventory.characters)[0];
    const { pools, current } = buildPools(foldFixtures(join(HERE, "fixtures")), character, {});
    const templateName = Object.keys(profiles.profiles.templates)[0];
    const profile = { ...profiles.profiles.templates[templateName], caps: rules.rules.caps };
    const r = await fetch(s2.url + "/api/optimize", {
      method: "POST", headers: { "content-type": "application/json", "x-client-id": "close-test-client" },
      body: JSON.stringify({ pools, current, profile, opts: { exact: true, timeBudgetMs: 5000 } }),
    });
    const { id } = await r.json();
    // The events route requires ?client= to match the job's own clientId (the X-Client-Id header sent
    // above) since the null-clientId collision fix — omitting it now correctly 403s (see the two tests
    // in the "localhost security" section below that check that directly).
    const events = await fetch(s2.url + `/api/optimize/${id}/events?client=close-test-client`);
    assert.equal(events.status, 200);
    const first = await events.body.getReader().read();   // "hello" — proves the client attached while the job was running
    assert.match(new TextDecoder().decode(first.value), /event: hello/);
    const t0 = Date.now();
    await s2.close();
    assert.ok(Date.now() - t0 < 1000, `close() took ${Date.now() - t0}ms`);
  } finally {
    await s2.close();
  }
});

// GET /api/events (Task 1, Phase 4): a non-demo server watches inbox/tazuo/ (app/watcher.mjs) and
// streams accept/reject over one shared SSE connection; --demo starts no watcher at all.
test("[fast] GET /api/events: hello lists the tazuo adapter, and an accepted inbox file streams an inventory event", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-events-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--port", "0", "--data", dir], {})));
  try {
    const res = await fetch(s2.url + "/api/events");
    assert.equal(res.status, 200);
    const sse = sseReader(res);
    const hello = await sse.readUntil((buf) => buf.includes("event: hello"));
    const helloData = JSON.parse(hello.match(/event: hello\ndata: (.+)\n/)[1]);
    assert.equal(helloData.ok, true);
    // Present, not pinned: the real point here is "tazuo is watched, and an accepted file in its
    // inbox streams an event" (below) — not the exact set of every adapter shipped in this repo.
    assert.ok(helloData.watching.includes("tazuo"), JSON.stringify(helloData.watching));

    const fixture = JSON.parse(readFileSync(join(HERE, "..", "adapters", "tazuo", "fixture.scan.json"), "utf8"));
    const inboxDir = join(dir, "inbox", "tazuo");
    const tmpPath = join(inboxDir, "drop.json.tmp");
    writeFileSync(tmpPath, JSON.stringify(fixture));
    renameSync(tmpPath, join(inboxDir, "drop.json"));

    const invBuf = await readUntilOrRescan(sse, (buf) => buf.includes("event: inventory"), s2.url);
    const invData = JSON.parse(invBuf.match(/event: inventory\ndata: (.+)\n/)[1]);
    assert.equal(invData.character, fixture.character);
    assert.equal(existsSync(join(inboxDir, "drop.json")), false, "the inbox file is gone once accepted");
    sse.cancel();

    const inv = await (await fetch(s2.url + "/api/inventory")).json();
    assert.ok(inv.inventory.characters[fixture.character], JSON.stringify(Object.keys(inv.inventory.characters)));
  } finally {
    await s2.close();
  }
});

test("[fast] GET /api/events: an invalid inbox file streams a rejected event and lands under rejected/", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-events-rej-"));
  // Fast watcher timing (matches app/watcher.test.mjs's own debounceMs:20/retryDelayMs:20 convention):
  // this waits out a full debounce + retries-1 backoff delays before the reject fires, so leaving the
  // production defaults (300ms/700ms) in only barely clears the SSE read's timeout on a loaded machine.
  const s2 = await startServer(ensureLayout(resolveConfig(["--port", "0", "--data", dir], {})),
    { watcherOptions: { debounceMs: 20, retries: 3, retryDelayMs: 20 } });
  try {
    const res = await fetch(s2.url + "/api/events");
    const sse = sseReader(res);
    await sse.readUntil((buf) => buf.includes("event: hello"));

    const inboxDir = join(dir, "inbox", "tazuo");
    const tmpPath = join(inboxDir, "bad.json.tmp");
    writeFileSync(tmpPath, "not json");
    renameSync(tmpPath, join(inboxDir, "bad.json"));

    const rejBuf = await readUntilOrRescan(sse, (buf) => buf.includes("event: rejected"), s2.url, { timeoutMs: 5000 });
    const rejData = JSON.parse(rejBuf.match(/event: rejected\ndata: (.+)\n/)[1]);
    assert.equal(rejData.file, "bad.json");
    assert.ok(existsSync(join(inboxDir, "rejected", "bad.json")));
    sse.cancel();
  } finally {
    await s2.close();
  }
});

// Post-review fix (Important 1): a log destination that throws on every write (a full disk, or a
// user deleting logs/ via the Settings tab's own "Open" button — spec §11's own examples) used to
// crash the whole process, since app/watcher.mjs's ingestFile/enqueue treated `log()` as "never
// throws". Replacing logs/ with a plain FILE of the same name is the cross-platform way to make
// every appendFileSync into it fail (ENOTDIR/EEXIST depending on the OS, rather than relying on a
// chmod that root or Windows can ignore).
test("[fast] a log destination that throws on every write does not crash the server: the bad file still lands in rejected/ and GET /api/inventory still serves", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-log-crash-"));
  // Fast watcher timing (see the sibling "invalid inbox file" test above for why): without this, the
  // rejected event only fires after debounceMs + (retries-1)×retryDelayMs of real wall-clock waiting
  // (300 + 2×700 = 1700ms with the production defaults) inside a fixed 5000ms SSE read — comfortable
  // in isolation, but tight enough that a loaded machine (a full-suite run, real CI) can trip it.
  const s2 = await startServer(ensureLayout(resolveConfig(["--port", "0", "--data", dir], {})),
    { watcherOptions: { debounceMs: 20, retries: 3, retryDelayMs: 20 } });
  try {
    const logsDir = join(dir, "logs");   // ensureLayout() already created this as a real directory
    rmSync(logsDir, { recursive: true, force: true });
    writeFileSync(logsDir, "not a directory\n");

    const res = await fetch(s2.url + "/api/events");
    const sse = sseReader(res);
    await sse.readUntil((buf) => buf.includes("event: hello"));

    const inboxDir = join(dir, "inbox", "tazuo");
    const tmpPath = join(inboxDir, "bad.json.tmp");
    writeFileSync(tmpPath, "not json");
    renameSync(tmpPath, join(inboxDir, "bad.json"));

    // Before the fix, the watcher's very first log() call (app/vault-server.mjs's callback into
    // app/watcher.mjs) threw, leaving the watcher's promise chain rejected with no handler — an
    // unhandled rejection that took the whole process down well before this event could ever fire,
    // and well before the retries/rejectFile below would ever run.
    const rejBuf = await readUntilOrRescan(sse, (buf) => buf.includes("event: rejected"), s2.url, { timeoutMs: 5000 });
    const rejData = JSON.parse(rejBuf.match(/event: rejected\ndata: (.+)\n/)[1]);
    assert.equal(rejData.file, "bad.json");
    assert.ok(existsSync(join(inboxDir, "rejected", "bad.json")), "the bad file was still quarantined despite every log write failing");
    sse.cancel();

    // A successful fetch here is itself proof the process survived — it could not respond at all
    // (let alone with 200) if the unhandled rejection from before the fix had taken it down.
    const invRes = await fetch(s2.url + "/api/inventory");
    assert.equal(invRes.status, 200, "the server kept serving /api/inventory after a run of failed log writes");
    assert.equal((await invRes.json()).ok, true);
  } finally {
    await s2.close();
  }
});

test("[fast] GET /api/events: --demo starts no watcher (hello.watching is empty)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-events-demo-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--demo", "--port", "0", "--data", dir], {})));
  try {
    const res = await fetch(s2.url + "/api/events");
    const sse = sseReader(res);
    const hello = await sse.readUntil((buf) => buf.includes("event: hello"));
    const helloData = JSON.parse(hello.match(/event: hello\ndata: (.+)\n/)[1]);
    assert.deepEqual(helloData.watching, []);
    sse.cancel();
  } finally {
    await s2.close();
  }
});

// Shard rules + settings (Task 2): GET /api/rules reports the current shard and every rules file
// listRules() finds; PUT /api/settings switches the shard (validated against that same list) and the
// next GET /api/rules reflects it; an unknown shard is rejected before anything is written.
test("[fast] GET /api/rules reports the current shard and at least the two builtin rules files", async () => {
  const j = await (await get("/api/rules")).json();
  assert.equal(j.ok, true);
  assert.equal(j.shard, "uoalive");
  assert.equal(j.rules.id, "uoalive");
  assert.ok(j.available.length >= 2, JSON.stringify(j.available));
  assert.ok(j.available.some((r) => r.id === "uoalive"));
  assert.ok(j.available.some((r) => r.id === "generic-osi"));
});
test("[fast] PUT /api/settings switches the shard; a following GET /api/rules reports it; an unknown shard is rejected", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--demo", "--port", "0", "--data", dir], {})));
  try {
    const put = await fetch(s2.url + "/api/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ shard: "generic-osi" }) });
    assert.equal(put.status, 200);
    assert.equal((await put.json()).settings.shard, "generic-osi");
    const rules = await (await fetch(s2.url + "/api/rules")).json();
    assert.equal(rules.shard, "generic-osi");
    assert.equal(rules.rules.id, "generic-osi");
    const bad = await fetch(s2.url + "/api/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ shard: "nope" }) });
    assert.equal(bad.status, 400);
    // rejecting "nope" must not have overwritten the shard switch that already succeeded
    assert.equal((await (await fetch(s2.url + "/api/rules")).json()).shard, "generic-osi");
  } finally {
    await s2.close();
  }
});
test("[fast] GET /api/settings reads back the persisted shard", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--demo", "--port", "0", "--data", dir], {})));
  try {
    const before = await (await fetch(s2.url + "/api/settings")).json();
    assert.equal(before.settings.shard, "uoalive");
    await fetch(s2.url + "/api/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ shard: "generic-osi" }) });
    const after = await (await fetch(s2.url + "/api/settings")).json();
    assert.equal(after.settings.shard, "generic-osi");
    assert.equal(JSON.parse(readFileSync(join(dir, "settings.json"), "utf8")).shard, "generic-osi", "the switch is persisted to settings.json");
  } finally {
    await s2.close();
  }
});

const validRulesFile = (id, name) => JSON.stringify({
  schemaVersion: 1, id, name, caps: { physResist: 70 }, raceCaps: {}, resistSkillBonus: { breakpoints: [] },
  tagUnits: {}, rarity: [], raceLock: { gargoyleOnly: false }, freeSkills: [],
});

// Post-review fix (finding 1): listRules() used to key a user file by its OWN id field while
// loadRules() resolved by FILENAME <id>.json — a user file named anything other than <id>.json was
// listed (and PUT /api/settings would accept it) but then could never be loaded again, including on
// the next startServer(), bricking the app. loadRules() now resolves through listRules()'s own
// {id → path} map, so listing and loading always agree regardless of filename.
test("[fast] a user rules file named differently than its id lists, loads via PUT /api/settings, and survives a fresh startServer", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--demo", "--port", "0", "--data", dir], {})));
  try {
    mkdirSync(join(dir, "rules"), { recursive: true });
    writeFileSync(join(dir, "rules", "my-shard-file.json"), validRulesFile("myshard", "My Shard"));
    const listed = (await (await fetch(s2.url + "/api/rules")).json()).available;
    assert.ok(listed.some((r) => r.id === "myshard" && r.source === "user"), JSON.stringify(listed));
    const put = await fetch(s2.url + "/api/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ shard: "myshard" }) });
    assert.equal(put.status, 200, JSON.stringify(await put.json()));
    const rules = await (await fetch(s2.url + "/api/rules")).json();
    assert.equal(rules.shard, "myshard");
    assert.equal(rules.rules.id, "myshard");
    assert.equal(rules.fallback, false);
  } finally {
    await s2.close();
  }
  // The whole point of the fix: a NEW startServer() on the same data dir must start (not throw) and
  // must still serve the shard settings.json names, even though its rules file's name doesn't match.
  const s3 = await startServer(ensureLayout(resolveConfig(["--demo", "--port", "0", "--data", dir], {})));
  try {
    const rules = await (await fetch(s3.url + "/api/rules")).json();
    assert.equal(rules.shard, "myshard");
    assert.equal(rules.rules.id, "myshard");
    assert.equal(rules.fallback, false);
  } finally {
    await s3.close();
  }
});

test("[fast] PUT /api/settings with a shard whose rules file fails validation is 400 and settings.json is unchanged", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--demo", "--port", "0", "--data", dir], {})));
  try {
    mkdirSync(join(dir, "rules"), { recursive: true });
    writeFileSync(join(dir, "rules", "broken.json"), JSON.stringify({ schemaVersion: 1, id: "badshard" }));   // missing every other required key
    const before = JSON.parse(readFileSync(join(dir, "settings.json"), "utf8"));
    const put = await fetch(s2.url + "/api/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ shard: "badshard" }) });
    assert.equal(put.status, 400);
    assert.match((await put.json()).error, /badshard/);
    assert.deepEqual(JSON.parse(readFileSync(join(dir, "settings.json"), "utf8")), before, "a failed PUT must never touch settings.json");
  } finally {
    await s2.close();
  }
});

// Post-review fix: settings.json naming a shard whose rules file has since vanished (deleted user
// override, typo, etc.) used to throw out of startServer() and refuse to start the app at all, with
// no in-app recovery. It must instead fall back to the default shard for this run — WITHOUT touching
// settings.json, so fixing the named shard's file and restarting picks the original choice back up —
// and report the fallback so the page can tell the user.
test("[fast] a data dir whose settings.json names a shard with no rules file starts anyway, serving the default shard with fallback: true", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-"));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "settings.json"), JSON.stringify({ schemaVersion: 1, shard: "gone" }, null, 2) + "\n");
  const s2 = await startServer(ensureLayout(resolveConfig(["--demo", "--port", "0", "--data", dir], {})));
  try {
    const rules = await (await fetch(s2.url + "/api/rules")).json();
    assert.equal(rules.shard, "uoalive");
    assert.equal(rules.rules.id, "uoalive");
    assert.equal(rules.fallback, true);
    assert.equal(JSON.parse(readFileSync(join(dir, "settings.json"), "utf8")).shard, "gone", "settings.json on disk must stay untouched by the fallback");
  } finally {
    await s2.close();
  }
});

test("[fast] a user rules file named differently than its id overrides a builtin of that id", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-"));
  mkdirSync(join(dir, "rules"), { recursive: true });
  writeFileSync(join(dir, "rules", "mine.json"), validRulesFile("uoalive", "UO Alive (mine)"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--demo", "--port", "0", "--data", dir], {})));
  try {
    const rules = await (await fetch(s2.url + "/api/rules")).json();
    assert.equal(rules.rules.name, "UO Alive (mine)");
    assert.equal(rules.available.find((r) => r.id === "uoalive").source, "user");
  } finally {
    await s2.close();
  }
});

// ---------------------------------------------------------------------------------------------
// Task 4: localhost security — token, Host/Origin, profiles size cap + schema, one job per
// X-Client-Id, stack-free 500s. A second, dedicated server with --token "t0ken", so the bare `srv`
// above (used by every test above this line) stays token-free and untouched. Flat test()s, not a
// describe() block: the test runner (scripts/test-runner.mjs) only tallies nesting-0 tests, so a
// describe() would fold all of these into a single pass/fail and drop them from the per-test count.
let tsrv, tdir;
before(async () => {
  tdir = mkdtempSync(join(tmpdir(), "qm-sec-"));
  tsrv = await startServer(ensureLayout(resolveConfig(["--demo", "--port", "0", "--data", tdir, "--token", "t0ken"], {})));
});
after(() => tsrv.close());
const authHost = () => ({ host: `localhost:${tsrv.port}`, authorization: "Bearer t0ken" });

test("[fast] /api/inventory: no token is 401, the right bearer token is 200", async () => {
  const noAuth = await rawReq(`${tsrv.url}/api/inventory`, { headers: { host: `localhost:${tsrv.port}` } });
  assert.equal(noAuth.status, 401);
  assert.equal(noAuth.json().ok, false);
  const withAuth = await rawReq(`${tsrv.url}/api/inventory`, { headers: authHost() });
  assert.equal(withAuth.status, 200);
});

test("[fast] static / and /ui/app.mjs need no token", async () => {
  const root = await rawReq(`${tsrv.url}/`, { headers: { host: `localhost:${tsrv.port}` } });
  assert.equal(root.status, 200);
  const uiApp = await rawReq(`${tsrv.url}/ui/app.mjs`, { headers: { host: `localhost:${tsrv.port}` } });
  assert.equal(uiApp.status, 200);
});

test("[fast] a forged Host is 403", async () => {
  const r = await rawReq(`${tsrv.url}/api/inventory`, { headers: { host: "evil.example", authorization: "Bearer t0ken" } });
  assert.equal(r.status, 403);
});

test("[fast] a forged Origin is 403; the server's own origin is accepted", async () => {
  const bad = await rawReq(`${tsrv.url}/api/inventory`, { headers: { ...authHost(), origin: "http://evil.example" } });
  assert.equal(bad.status, 403);
  const good = await rawReq(`${tsrv.url}/api/inventory`, { headers: { ...authHost(), origin: `http://127.0.0.1:${tsrv.port}` } });
  assert.equal(good.status, 200);
});

// Test gap noted in review: only forged Origin values were covered, not the literal "null" string a
// browser sends for a sandboxed iframe or a file:// page — that's a real string, not an absent
// header, and must not slip past `origin != null`.
test("[fast] Origin: null (a sandboxed iframe / file:// origin) is 403", async () => {
  const r = await rawReq(`${tsrv.url}/api/inventory`, { headers: { ...authHost(), origin: "null" } });
  assert.equal(r.status, 403);
});

// Test gap noted in review: the Host tests above all go through node:http, which always sends SOME
// Host header. A raw HTTP/1.0 request (Host is optional in that version) proves the check refuses a
// genuinely absent Host, not just a forged one.
test("[fast] a raw HTTP/1.0 request with no Host header at all is 403", async () => {
  const raw = await new Promise((resolve, reject) => {
    const sock = createConnection({ port: tsrv.port, host: "127.0.0.1" }, () => {
      sock.write("GET /api/inventory HTTP/1.0\r\nAuthorization: Bearer t0ken\r\n\r\n");
    });
    let buf = "";
    sock.on("data", (c) => { buf += c.toString("utf8"); });
    sock.on("end", () => resolve(buf));
    sock.on("error", reject);
  });
  assert.match(raw, /^HTTP\/1\.[01] 403\b/);
});

test("[fast] PUT /api/profiles: an oversized multi-byte body is 413 (bytes, not JS string length); an invalid shape is 400 naming /characters", async () => {
  // 600,000 "é" characters: 600,000 UTF-16 code units (well under the 1e6 string-length a byte-blind
  // cap would have measured) but 1,200,000 UTF-8 bytes (over the 1e6 byte cap) — this is exactly the
  // post-review fix: readBody() must count Buffer bytes, not the JS string's .length, or a body like
  // this one sails past a 1 MB limit while measuring under it.
  const oversized = JSON.stringify({ schemaVersion: 2, characters: {}, templates: {}, pad: "é".repeat(600000) });
  const big = await rawReq(`${tsrv.url}/api/profiles`, {
    method: "PUT", headers: { ...authHost(), "content-type": "application/json" }, body: oversized,
  });
  assert.equal(big.status, 413);
  assert.equal(big.json().error, "profiles too large");
  const bad = await rawReq(`${tsrv.url}/api/profiles`, {
    method: "PUT", headers: { ...authHost(), "content-type": "application/json" }, body: JSON.stringify({ schemaVersion: 2, templates: {}, characters: 5 }),
  });
  assert.equal(bad.status, 400);
  assert.match(bad.json().error, /\/characters/);
});

test("[fast] two POST /api/optimize from the same X-Client-Id: the second supersedes the first, whose status becomes cancelled", async () => {
  const inv = (await rawReq(`${tsrv.url}/api/inventory`, { headers: authHost() })).json();
  const profiles = (await rawReq(`${tsrv.url}/api/profiles`, { headers: authHost() })).json();
  const rules = (await rawReq(`${tsrv.url}/api/rules`, { headers: authHost() })).json();
  const character = Object.keys(inv.inventory.characters)[0];
  const { pools, current } = buildPools(foldFixtures(join(HERE, "fixtures")), character, {});
  const templateName = Object.keys(profiles.profiles.templates)[0];
  const profile = { ...profiles.profiles.templates[templateName], caps: rules.rules.caps };
  const body = JSON.stringify({ pools, current, profile, opts: { exact: true, timeBudgetMs: 5000 } });
  const postHeaders = { ...authHost(), "content-type": "application/json", "x-client-id": "client-A" };
  const first = (await rawReq(`${tsrv.url}/api/optimize`, { method: "POST", headers: postHeaders, body })).json();
  const second = (await rawReq(`${tsrv.url}/api/optimize`, { method: "POST", headers: postHeaders, body })).json();
  assert.equal(second.superseded, first.id);
  const firstStatus = (await rawReq(`${tsrv.url}/api/optimize/${first.id}/status`, { headers: authHost() })).json();
  assert.equal(firstStatus.state, "cancelled");
  await rawReq(`${tsrv.url}/api/optimize/${second.id}/cancel`, { method: "POST", headers: authHost() });
});

// Post-review fix: a header-less caller's job gets an unguessable clientId (a fresh randomUUID()),
// so omitting X-Client-Id must never let that same caller (or anyone else) read its events without
// the id, and two header-less callers must never supersede each other (null !== null is no longer
// how either check is satisfied). These two use their own fresh, token-free server — the finding
// was about client-id semantics, independent of the bearer token.
test("[fast] a job started without X-Client-Id can't be read via its events route without ?client=", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--demo", "--port", "0", "--data", dir], {})));
  try {
    const inv = await (await fetch(s2.url + "/api/inventory")).json();
    const profiles = await (await fetch(s2.url + "/api/profiles")).json();
    const rules = await (await fetch(s2.url + "/api/rules")).json();
    const character = Object.keys(inv.inventory.characters)[0];
    const { pools, current } = buildPools(foldFixtures(join(HERE, "fixtures")), character, {});
    const templateName = Object.keys(profiles.profiles.templates)[0];
    const profile = { ...profiles.profiles.templates[templateName], caps: rules.rules.caps };
    const r = await fetch(s2.url + "/api/optimize", {
      method: "POST", headers: { "content-type": "application/json" },   // deliberately no X-Client-Id
      body: JSON.stringify({ pools, current, profile, opts: { exact: true, timeBudgetMs: 5000 } }),
    });
    const { id } = await r.json();
    const events = await fetch(s2.url + `/api/optimize/${id}/events`);   // deliberately no ?client= either
    assert.equal(events.status, 403);
    await fetch(s2.url + `/api/optimize/${id}/cancel`, { method: "POST" });
  } finally {
    await s2.close();
  }
});

test("[fast] two POST /api/optimize with no X-Client-Id never supersede each other", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--demo", "--port", "0", "--data", dir], {})));
  try {
    const inv = await (await fetch(s2.url + "/api/inventory")).json();
    const profiles = await (await fetch(s2.url + "/api/profiles")).json();
    const rules = await (await fetch(s2.url + "/api/rules")).json();
    const character = Object.keys(inv.inventory.characters)[0];
    const { pools, current } = buildPools(foldFixtures(join(HERE, "fixtures")), character, {});
    const templateName = Object.keys(profiles.profiles.templates)[0];
    const profile = { ...profiles.profiles.templates[templateName], caps: rules.rules.caps };
    const body = JSON.stringify({ pools, current, profile, opts: { exact: true, timeBudgetMs: 5000 } });
    const post = () => fetch(s2.url + "/api/optimize", { method: "POST", headers: { "content-type": "application/json" }, body }).then((x) => x.json());
    const first = await post();
    const second = await post();
    assert.equal(second.superseded, null);
    if (first.id) await fetch(s2.url + `/api/optimize/${first.id}/cancel`, { method: "POST" });
    if (second.id) await fetch(s2.url + `/api/optimize/${second.id}/cancel`, { method: "POST" });
  } finally {
    await s2.close();
  }
});

// Post-review fix: job failures (not just route-level 500s) now write a ref-keyed entry to the same
// log file, and the ref reaches the client in the sanitized job.error text. Deterministic trigger:
// a pools entry with a null item — {helmet: [null]} — makes optimizer-core.mts's optCollectKeys read
// `list[j].props` with no null check on list[j] itself (unlike the `|| {}` that guards the *result*
// of that read) — confirmed by a throwaway probe before writing this test. The route only rejects a
// falsy `profile`, not a malformed `pools`/`current`, so this reaches the worker uncaught. (An earlier
// version of this test used a profile with `caps` but no `weights`, which threw in optBuildSpace;
// Phase 2 Task 5 guarded that spot with `profile.weights || {}`, so this test needed a new trigger —
// verified RED against the old body once the guard landed, GREEN with this one.) Tied to this specific
// optimizer-core.mts behavior, out of this task's scope to change; if a future core update guards
// `list[j]` too, this test would need a different way to provoke a job failure.
test("[fast] a job that throws inside the optimizer logs its stack with a ref; the client only sees the sanitized ref", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--demo", "--port", "0", "--data", dir], {})));
  try {
    const r = await fetch(s2.url + "/api/optimize", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ pools: { helmet: [null] }, current: {}, profile: { caps: { physResist: 70 } }, opts: {} }),
    });
    const { id } = await r.json();
    let status;
    for (let i = 0; i < 50; i++) {
      status = await (await fetch(s2.url + `/api/optimize/${id}/status`)).json();
      if (status.state !== "running") break;
      await new Promise((res) => setTimeout(res, 20));
    }
    assert.equal(status.state, "error");
    assert.match(status.error, /^internal error \(ref [0-9a-f]{8}\)$/);
    assert.doesNotMatch(status.error, /at file:|\.mjs:\d+:\d+/, "no stack trace text reaches the client");
    const ref = status.error.match(/ref ([0-9a-f]{8})/)[1];
    const log = readFileSync(join(dir, "logs", "server.log"), "utf8");
    assert.ok(log.includes(ref), "the ref appears in the log file");
    assert.match(log, /TypeError.*optCollectKeys/s, "the real stack trace reached the log file");
  } finally {
    await s2.close();
  }
});

test("[fast] a route that throws returns a stack-free 500 with a ref that appears in the log", async () => {
  writeFileSync(join(tdir, "profiles.json"), "{not json");
  const r = await rawReq(`${tsrv.url}/api/profiles`, { headers: authHost() });
  assert.equal(r.status, 500);
  const body = r.json();
  assert.equal(body.error, "internal error");
  assert.ok(body.ref, "a ref is present");
  assert.doesNotMatch(r.text, /at file:|\.mjs:\d+:\d+/, "no stack trace text reaches the response body");
  const log = readFileSync(join(tdir, "logs", "server.log"), "utf8");
  assert.ok(log.includes(body.ref), "the ref appears in the log file");
});

// Task 2 (Phase 3): the worker now runs an exact build through app/exact-solver.mts (HiGHS), not the
// retired multi-thread branch-and-bound. On the small demo fixture this proves well inside a normal
// test timeout — poll /status until done, then confirm the saved run carries the identical score.
test("[fast] POST /api/optimize exact: the job finishes with solver \"highs\", proven, and the saved run carries the same score", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--demo", "--port", "0", "--data", dir], {})));
  try {
    const inv = await (await fetch(s2.url + "/api/inventory")).json();
    const profiles = await (await fetch(s2.url + "/api/profiles")).json();
    const rules = await (await fetch(s2.url + "/api/rules")).json();
    const character = Object.keys(inv.inventory.characters)[0];
    const { pools, current } = buildPools(foldFixtures(join(HERE, "fixtures")), character, {});
    const templateName = Object.keys(profiles.profiles.templates)[0];
    const profile = { ...profiles.profiles.templates[templateName], caps: rules.rules.caps };
    const r = await fetch(s2.url + "/api/optimize", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ pools, current, profile, opts: { exact: true, timeBudgetMs: 20000, restarts: 50, seed: 2026 } }),
    });
    const { id } = await r.json();
    let status;
    for (let i = 0; i < 300; i++) {
      status = await (await fetch(s2.url + `/api/optimize/${id}/status`)).json();
      if (status.state !== "running") break;
      await new Promise((res) => setTimeout(res, 100));
    }
    assert.equal(status.state, "done", JSON.stringify(status));
    assert.equal(status.result.solver, "highs");
    assert.equal(status.result.proven, true);
    assert.ok(status.runId);
    const run = await (await fetch(s2.url + `/api/runs/${status.runId}`)).json();
    assert.equal(run.run.result.score, status.result.score);
  } finally {
    await s2.close();
  }
});

// ---------------------------------------------------------------------------------------------
// Task 4: the inventory cache, item-query.mjs's static route, GET /api/items, and POST
// /api/optimize's by-character form. Uses the module-level `srv` (--demo) where a fresh server
// isn't needed for isolation.

test("[smoke] /item-query.mjs is served as text/javascript with nosniff", async () => {
  const r = await get("/item-query.mjs");
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("content-type"), "text/javascript; charset=utf-8");
  assert.equal(r.headers.get("x-content-type-options"), "nosniff");
  assert.match(await r.text(), /export function applyItemQuery/);
});

test("[smoke] /api/inventory carries facets, worn gear and counts, and no item list", async () => {
  const j = await (await get("/api/inventory")).json();
  assert.equal(j.ok, true);
  assert.equal(j.inventory.items, undefined);
  assert.ok(j.inventory.itemCount > 0);
  assert.ok(j.inventory.facets.kinds.length > 0, JSON.stringify(j.inventory.facets));
  assert.ok(Object.keys(j.inventory.worn).length > 0);
});

// Regression test for a live bug found in the browser gate after Task 5: page load() threw
// "Cannot convert undefined or null to object" — NOT in containers.mjs (its `state.inv.containers`/
// `rootCounts` reads were fine all along), but in builder.mjs's renderProfile(), which called the
// client-side vault-lib.mjs helpers gearSkills()/builderKeys() against state.inv — and those do
// `Object.values(inv.items)`, which is exactly the field Task 5 stopped shipping. The throw happened
// before renderContainers() ran (buildBuilder() runs first in load()'s sequence), which is why the
// Containers tab looked broken — it was collateral, not its own bug. Fixed by adding `gearSkills` to
// GET /api/inventory's `facets` (item-query.mjs's facetsOf, mirroring `propKeys`) so the page never
// needs the full item map for this. This test pins every field a client module reads directly off
// `state.inv`/`state.facets` without going through GET /api/items, so a future field removal fails
// here instead of surfacing only as a live "failed to load" banner.
test("[smoke] /api/inventory carries every field the page's non-paged tabs read directly", async () => {
  const j = await (await get("/api/inventory")).json();
  const inv = j.inventory;
  assert.ok(inv.containers && Object.keys(inv.containers).length > 0, "containers.mjs reads state.inv.containers");
  assert.ok(inv.rootCounts && Object.keys(inv.rootCounts).length > 0, "containers.mjs reads state.inv.rootCounts");
  assert.ok(inv.characters && Object.keys(inv.characters).length > 0, "characters.mjs/builder.mjs read state.inv.characters");
  assert.ok(inv.worn && Object.keys(inv.worn).length > 0, "characters.mjs/sheet.mjs read state.inv.worn");
  assert.ok(Array.isArray(inv.facets.gearSkills) && inv.facets.gearSkills.length > 0, "builder.mjs's renderProfile reads state.facets.gearSkills");
  assert.ok(Array.isArray(inv.propKeys) && inv.propKeys.length > 0, "builder.mjs/inventory.mjs read state.propKeys");
});

test("[fast] /api/items pages, sorts and searches", async () => {
  const inv = await (await get("/api/inventory")).json();
  const total = inv.inventory.itemCount;
  const page = await (await get("/api/items?limit=5")).json();
  assert.equal(page.ok, true);
  assert.equal(page.rows.length, 5);
  assert.equal(page.total, total);
  const all = await (await get("/api/items?limit=500")).json();
  assert.equal(all.rows.length, total);
  const names = all.rows.map((r) => r.name);
  assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b)), "sort=name (default) is A-to-Z");
  const rev = await (await get("/api/items?limit=500&sort=name&dir=-1")).json();
  assert.deepEqual(rev.rows.map((r) => r.name), [...names].reverse(), "dir=-1 reverses the default sort");
  const search = await (await get("/api/items?q=" + encodeURIComponent("Vicious Crescent Blade"))).json();
  assert.ok(search.rows.length >= 1, JSON.stringify(search));
  assert.ok(search.rows.some((r) => r.name === "Vicious Crescent Blade"));
  const clamp = await (await get("/api/items?limit=9999")).json();
  assert.equal(clamp.limit, 500);
  const grouped = await (await get("/api/items?group=1")).json();
  assert.equal(grouped.ok, true);
  assert.ok(Array.isArray(grouped.groups) && grouped.groups.length > 0);
  assert.ok(!("rows" in grouped));
});

test("[fast] GET /api/items/by-serial resolves full item records by serial", async () => {
  const page = await (await get("/api/items?limit=3")).json();
  const serials = page.rows.map((r) => r.serial);
  const unknown = 999999999;
  const res = await (await get(`/api/items/by-serial?serials=${[...serials, unknown].join(",")}`)).json();
  assert.equal(res.ok, true);
  for (const s of serials) {
    assert.ok(res.items[s], `serial ${s} should resolve`);
    assert.ok(res.items[s].location, `serial ${s} should carry a location`);
  }
  assert.equal(res.items[unknown], undefined, "an unknown serial is simply absent, not an error");
  const tooMany = await get(`/api/items/by-serial?serials=${Array.from({ length: 201 }, (_, i) => i + 1).join(",")}`);
  assert.equal(tooMany.status, 400);
  const empty = await get("/api/items/by-serial");
  assert.equal(empty.status, 400);
});

test("[fast] /api/optimize by character builds the same pools as the client did", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--demo", "--port", "0", "--data", dir], {})));
  try {
    const invFull = await (await fetch(s2.url + "/api/inventory")).json();
    const profiles = await (await fetch(s2.url + "/api/profiles")).json();
    const rules = await (await fetch(s2.url + "/api/rules")).json();
    const character = Object.keys(invFull.inventory.characters)[0];
    const templateName = Object.keys(profiles.profiles.templates)[0];
    const profile = { ...profiles.profiles.templates[templateName], caps: rules.rules.caps };
    // The full item map used to come straight off /api/inventory; since Task 5 removed it from the
    // wire, fold the same demo fixtures the server folds (foldFixtures above) to get an equivalent
    // local inventory for this "does the server build what the client used to build" comparison.
    const localInv = foldFixtures(join(HERE, "fixtures"));
    const { pools, current } = buildPools(localInv, character, {});
    const localPoolSize = Object.values(pools).reduce((a, v) => a + v.length, 0);

    // 1) the OLD body form — start it and wait for it to finish so it lands as a saved, reusable run.
    // opts.optionalSlots must match what the by-character form derives server-side (every
    // DEFAULT_OPTIONAL_SLOT, since settings:{} means lockedSlots:[]) or the two requests' runKeys
    // (and so their cache behavior) would legitimately differ.
    const oldOpts = { exact: false, optionalSlots: DEFAULT_OPTIONAL_SLOTS };
    const r1 = await fetch(s2.url + "/api/optimize", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ pools, current, profile, opts: oldOpts }),
    });
    const j1 = await r1.json();
    assert.equal(r1.status, 200, JSON.stringify(j1));
    assert.equal(j1.poolSize, localPoolSize);
    assert.deepEqual(j1.skipped, {}, "the old body form reports no skipped counts (it never called buildPools)");
    assert.deepEqual(j1.blocked, []);
    let status = j1;
    for (let i = 0; i < 100 && status.state !== "done"; i++) {
      await new Promise((res) => setTimeout(res, 20));
      status = await (await fetch(s2.url + `/api/optimize/${j1.id}/status`)).json();
    }
    assert.equal(status.state, "done", JSON.stringify(status));

    // 2) the by-character form must build the identical pools/current server-side and hit the run
    // the old form just saved.
    const r2 = await fetch(s2.url + "/api/optimize", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ character, settings: {}, profile, opts: { exact: false } }),
    });
    const j2 = await r2.json();
    assert.equal(r2.status, 200, JSON.stringify(j2));
    assert.equal(j2.poolSize, localPoolSize);
    assert.deepEqual(j2.current, current);
    assert.equal(j2.cached, true, JSON.stringify(j2));
  } finally {
    await s2.close();
  }
});

test("[fast] /api/optimize by character with a bad settings type is 400", async () => {
  const inv = await (await get("/api/inventory")).json();
  const profiles = await (await get("/api/profiles")).json();
  const rules = await (await get("/api/rules")).json();
  const character = Object.keys(inv.inventory.characters)[0];
  const templateName = Object.keys(profiles.profiles.templates)[0];
  const profile = { ...profiles.profiles.templates[templateName], caps: rules.rules.caps };
  const r = await fetch(srv.url + "/api/optimize", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ character, settings: { excludeTags: "cursed" }, profile, opts: {} }),
  });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /excludeTags/);
});

// Post-review fix: `null` in an optional settings field (strLimit/excludeTags/excludeRoots/
// excludeSkills/lockedSlots) passed the `!= null` validation gate untouched, but the destructuring
// defaults below it only fire on `undefined` — so `strLimit: null` reached buildPools as a literal
// null (silently wrong: strength null <= nothing, so every STR-gated item got excluded) and an array
// field's null threw once buildPools tried to .map/.includes it. A saved run's settings (re-posted
// from the runs drawer) can carry exactly this shape, so it had to be treated the same as "absent".
test("[fast] /api/optimize by character: null settings fields behave like absent fields (same poolSize as {}), not a type error", async () => {
  const inv = await (await get("/api/inventory")).json();
  const profiles = await (await get("/api/profiles")).json();
  const rules = await (await get("/api/rules")).json();
  const character = Object.keys(inv.inventory.characters)[0];
  const templateName = Object.keys(profiles.profiles.templates)[0];
  const profile = { ...profiles.profiles.templates[templateName], caps: rules.rules.caps };
  const post = async (settings) => {
    const r = await fetch(srv.url + "/api/optimize", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ character, settings, profile, opts: { exact: false } }),
    });
    return { status: r.status, body: await r.json() };
  };
  const baseline = await post({});
  assert.equal(baseline.status, 200, JSON.stringify(baseline.body));
  const withNulls = await post({ strLimit: null, excludeTags: null, excludeRoots: null, excludeSkills: null, lockedSlots: null });
  assert.equal(withNulls.status, 200, JSON.stringify(withNulls.body));
  assert.equal(withNulls.body.poolSize, baseline.body.poolSize);
  assert.deepEqual(withNulls.body.current, baseline.body.current);
  for (const j of [baseline.body, withNulls.body]) if (j.id) await fetch(srv.url + `/api/optimize/${j.id}/cancel`, { method: "POST" });
});

test("[fast] a new scan file changes /api/inventory without a restart", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--port", "0", "--data", dir], {})));
  try {
    const before = await (await fetch(s2.url + "/api/inventory")).json();
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
    const after = await (await fetch(s2.url + "/api/inventory")).json();
    assert.ok(after.inventory.itemCount > before.inventory.itemCount, `${before.inventory.itemCount} -> ${after.inventory.itemCount}`);
  } finally {
    await s2.close();
  }
});

// ---- Setup wizard (Task 2, Phase 4): GET/POST /api/setup*, POST /api/import, GET /api/update-check,
// POST /api/host/*, and PUT /api/settings' setupDone/client extension. app/installer.test.mjs covers
// the pure installer.mjs functions directly; these cover the routes wiring them up.

test("[fast] GET /api/setup lists the tazuo adapter, its available (repo-shipped) version, and firstRun:true on a fresh data dir", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-setup-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--port", "0", "--data", dir], {})));
  try {
    const j = await (await fetch(s2.url + "/api/setup")).json();
    assert.equal(j.ok, true);
    assert.equal(j.firstRun, true);
    // Present, not pinned: the test's own point (title, available/installed/dataDir below) is
    // "tazuo is listed, with the right version/candidates" — not the exact set of shipped adapters.
    assert.ok(j.adapters.map((a) => a.id).includes("tazuo"), JSON.stringify(j.adapters.map((a) => a.id)));
    assert.equal(j.available.tazuo, "2.0.0");
    assert.equal(j.installed, null);
    assert.equal(j.dataDir, dir);
    assert.ok(Array.isArray(j.candidates.tazuo), JSON.stringify(j.candidates));
    // Phase 6 final review, deferred minor: the wizard/Import tab need this to hide the Windows-only
    // razor-enhanced adapter on any other platform (app/ui/adapters.mjs's availableAdapters) — it
    // must be this process's real process.platform, not a placeholder.
    assert.equal(j.platform, process.platform);
  } finally {
    await s2.close();
  }
});

// Task 5, Phase 6: the wizard/Settings tell a folder-transport adapter (installable) apart from a
// paste-transport one (nothing to install, sent to the Import tab instead) by this field — never by a
// hard-coded adapter id. Uses the repo's own three shipped adapters, not a throwaway fixture dir.
test("[fast] GET /api/setup reports each real adapter's transport; POST /api/setup/install refuses the paste-transport classicuo-web adapter with 400", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-setup-transport-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--port", "0", "--data", dir], {})));
  try {
    const setup = await (await fetch(s2.url + "/api/setup")).json();
    const tazuo = setup.adapters.find((a) => a.id === "tazuo");
    const web = setup.adapters.find((a) => a.id === "classicuo-web");
    assert.ok(tazuo, JSON.stringify(setup.adapters.map((a) => a.id)));
    assert.ok(web, JSON.stringify(setup.adapters.map((a) => a.id)));
    assert.equal(tazuo.transport, "folder", JSON.stringify(tazuo));
    assert.equal(web.transport, "paste", JSON.stringify(web));

    // Phase 6 final review follow-up: capabilities.json's optional platform field, surfaced end to
    // end through the real server — razor-enhanced is win32-only, the other two carry no restriction,
    // and its candidates list is empty on this (non-Windows CI/dev) machine's real platform.
    const razor = setup.adapters.find((a) => a.id === "razor-enhanced");
    assert.ok(razor, JSON.stringify(setup.adapters.map((a) => a.id)));
    assert.equal(razor.platform, "win32", JSON.stringify(razor));
    assert.equal(tazuo.platform, null);
    assert.equal(web.platform, null);
    if (setup.platform !== "win32") {
      assert.deepEqual(setup.candidates["razor-enhanced"], [], "no candidate for a platform-restricted adapter on the wrong platform");
    }

    const scriptsDir = mkdtempSync(join(tmpdir(), "qm-setup-transport-dest-"));
    const r = await fetch(s2.url + "/api/setup/install", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ adapter: "classicuo-web", scriptsDir }),
    });
    assert.equal(r.status, 400);
    const body = await r.json();
    assert.match(body.error, /nothing to install/);
    assert.deepEqual(readdirSync(scriptsDir), [], "nothing was written for a paste-transport adapter");
    assert.equal((await (await fetch(s2.url + "/api/settings")).json()).settings.client, undefined, "a refused install must not save settings.client");
  } finally {
    await s2.close();
  }
});

test("[fast] POST /api/setup/locate resolves a nested .../ClassicUO/Data/Plugins/Razor/Scripts folder for the razor-enhanced adapter", async () => {
  const s2 = await startServer(ensureLayout(resolveConfig(["--port", "0", "--data", mkdtempSync(join(tmpdir(), "qm-setup-locate-razor-"))], {})));
  try {
    const clientRoot = mkdtempSync(join(tmpdir(), "qm-client-razor-"));
    const scriptsDir = join(clientRoot, "ClassicUO", "Data", "Plugins", "Razor", "Scripts");
    mkdirSync(scriptsDir, { recursive: true });
    const r = await fetch(s2.url + "/api/setup/locate", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ adapter: "razor-enhanced", dir: clientRoot }),
    });
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.scriptsDir, scriptsDir);
  } finally {
    await s2.close();
  }
});

// Task 2, Phase 6: the page decides whether to offer the Highlight/Grab/Go-to bridge buttons from
// GET /api/setup's {settings.client, adapters} — settings.client names which installed adapter is
// active, and adapters carries that adapter's own capabilities.bridge list. This is the one route
// test both facts land in together, so it exercises the real contract the page reads rather than the
// pure listAdapters()/installer.mjs unit already covered by app/installer.test.mjs. --adapters points
// the whole server at a throwaway folder holding a copy of the real tazuo adapter (full bridge) next
// to a minimal fixture adapter that declares no bridge at all, standing in for a client like the
// ClassicUO web adapter that can't run one.
test("[fast] GET /api/setup: an adapter with no bridge reports capabilities.bridge:[]; tazuo still reports the three actions", async () => {
  const adaptersDir = mkdtempSync(join(tmpdir(), "qm-adapters-"));
  cpSync(join(HERE, "..", "adapters", "tazuo"), join(adaptersDir, "tazuo"), { recursive: true });
  const noBridgeDir = join(adaptersDir, "nobridge");
  mkdirSync(noBridgeDir, { recursive: true });
  writeFileSync(join(noBridgeDir, "capabilities.json"), JSON.stringify({
    adapter: "nobridge", version: "1.0.0", transport: "folder",
    capabilities: { layers: [], arms: false, bank: false, ground: false, nested: false, tooltips: "label", bridge: [] },
  }));
  const dataDir = mkdtempSync(join(tmpdir(), "qm-setup-nobridge-"));
  const scriptsDir = mkdtempSync(join(tmpdir(), "qm-setup-nobridge-scripts-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--port", "0", "--data", dataDir, "--adapters", adaptersDir], {})));
  try {
    const setup = await (await fetch(s2.url + "/api/setup")).json();
    assert.deepEqual(setup.adapters.map((a) => a.id).sort(), ["nobridge", "tazuo"]);
    assert.deepEqual(setup.adapters.find((a) => a.id === "nobridge").capabilities.bridge, []);
    assert.deepEqual(setup.adapters.find((a) => a.id === "tazuo").capabilities.bridge, ["highlight", "grab", "goto"]);

    // settings.client names which of those is active — PUT it at the no-bridge adapter first.
    const putNoBridge = await fetch(s2.url + "/api/settings", {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ client: { adapter: "nobridge", scriptsDir } }),
    });
    assert.equal(putNoBridge.status, 200);
    let after = await (await fetch(s2.url + "/api/setup")).json();
    assert.equal(after.settings.client.adapter, "nobridge");
    assert.deepEqual(after.adapters.find((a) => a.id === after.settings.client.adapter).capabilities.bridge, []);

    // Switching to tazuo flips the same lookup back to the three actions — same shape, no restart.
    const putTazuo = await fetch(s2.url + "/api/settings", {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ client: { adapter: "tazuo", scriptsDir } }),
    });
    assert.equal(putTazuo.status, 200);
    after = await (await fetch(s2.url + "/api/setup")).json();
    assert.equal(after.settings.client.adapter, "tazuo");
    assert.deepEqual(after.adapters.find((a) => a.id === after.settings.client.adapter).capabilities.bridge, ["highlight", "grab", "goto"]);
  } finally {
    await s2.close();
  }
});

// Bug fix: a player who pressed Skip in the setup wizard (settings.client left unset on purpose — see
// app/ui/bridge.mjs's currentAdapter() comment) or installed an adapter's scripts by hand had every
// Highlight/Grab/Go-to button vanish, even though POST /api/bridge / GET /api/bridge/status were
// already routing to bridgeAdapter()'s own default the whole time. GET /api/setup now reports that same
// routing target as `bridgeAdapter`, so the page can fall back to it instead of hiding the buttons.
test("[fast] GET /api/setup reports bridgeAdapter: \"tazuo\" (the real bridge routing default) when no client is configured", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-setup-bridgeadapter-default-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--port", "0", "--data", dir], {})));
  try {
    const setup = await (await fetch(s2.url + "/api/setup")).json();
    assert.equal(setup.settings.client, undefined);
    assert.equal(setup.bridgeAdapter, "tazuo");
  } finally {
    await s2.close();
  }
});

test("[fast] GET /api/setup reports bridgeAdapter matching a configured client's own adapter, not the default", async () => {
  const adaptersDir = mkdtempSync(join(tmpdir(), "qm-adapters-bridgeadapter-"));
  cpSync(join(HERE, "..", "adapters", "tazuo"), join(adaptersDir, "tazuo"), { recursive: true });
  const noBridgeDir = join(adaptersDir, "nobridge");
  mkdirSync(noBridgeDir, { recursive: true });
  writeFileSync(join(noBridgeDir, "capabilities.json"), JSON.stringify({
    adapter: "nobridge", version: "1.0.0", transport: "folder",
    capabilities: { layers: [], arms: false, bank: false, ground: false, nested: false, tooltips: "label", bridge: [] },
  }));
  const dataDir = mkdtempSync(join(tmpdir(), "qm-setup-bridgeadapter-configured-"));
  const scriptsDir = mkdtempSync(join(tmpdir(), "qm-setup-bridgeadapter-configured-scripts-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--port", "0", "--data", dataDir, "--adapters", adaptersDir], {})));
  try {
    const put = await fetch(s2.url + "/api/settings", {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ client: { adapter: "nobridge", scriptsDir } }),
    });
    assert.equal(put.status, 200);
    const setup = await (await fetch(s2.url + "/api/setup")).json();
    assert.equal(setup.settings.client.adapter, "nobridge");
    assert.equal(setup.bridgeAdapter, "nobridge", "a configured client wins over the tazuo default");
  } finally {
    await s2.close();
  }
});

test("[fast] GET /api/setup reports bridgeAdapter: null when no client is configured and the default (\"tazuo\") isn't among the discovered adapters", async () => {
  const adaptersDir = mkdtempSync(join(tmpdir(), "qm-adapters-bridgeadapter-null-"));
  const noBridgeDir = join(adaptersDir, "nobridge");
  mkdirSync(noBridgeDir, { recursive: true });
  writeFileSync(join(noBridgeDir, "capabilities.json"), JSON.stringify({
    adapter: "nobridge", version: "1.0.0", transport: "folder",
    capabilities: { layers: [], arms: false, bank: false, ground: false, nested: false, tooltips: "label", bridge: [] },
  }));
  const dataDir = mkdtempSync(join(tmpdir(), "qm-setup-bridgeadapter-null-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--port", "0", "--data", dataDir, "--adapters", adaptersDir], {})));
  try {
    const setup = await (await fetch(s2.url + "/api/setup")).json();
    assert.deepEqual(setup.adapters.map((a) => a.id), ["nobridge"]);
    assert.equal(setup.settings.client, undefined);
    assert.equal(setup.bridgeAdapter, null, "nothing named \"tazuo\" exists in this throwaway adapters dir, so there is no id left to fall back to");
  } finally {
    await s2.close();
  }
});

test("[fast] POST /api/setup/locate resolves a nested X/TazUO/LegionScripts folder to that path", async () => {
  const s2 = await startServer(ensureLayout(resolveConfig(["--port", "0", "--data", mkdtempSync(join(tmpdir(), "qm-setup-locate-"))], {})));
  try {
    const clientRoot = mkdtempSync(join(tmpdir(), "qm-client-"));
    const legionDir = join(clientRoot, "TazUO", "LegionScripts");
    mkdirSync(legionDir, { recursive: true });
    const r = await fetch(s2.url + "/api/setup/locate", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ adapter: "tazuo", dir: clientRoot }),
    });
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.scriptsDir, legionDir);
    assert.equal(body.installed.version, null);

    const bad = await fetch(s2.url + "/api/setup/locate", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ adapter: "tazuo", dir: join(clientRoot, "does-not-exist") }),
    });
    assert.equal(bad.status, 400);
  } finally {
    await s2.close();
  }
});

test("[fast] POST /api/setup/install installs the scripts, saves settings.client, and PUT /api/settings {setupDone:true} is what clears firstRun", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-setup-install-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--port", "0", "--data", dir], {})));
  try {
    const scriptsDir = mkdtempSync(join(tmpdir(), "qm-client-install-"));
    const install = await fetch(s2.url + "/api/setup/install", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ adapter: "tazuo", scriptsDir }),
    });
    const installBody = await install.json();
    assert.equal(install.status, 200, JSON.stringify(installBody));
    assert.deepEqual(installBody.installed.sort(), ["packrat-bridge.py", "packrat-refresh.py", "packrat-scanner.py"]);
    assert.equal(installBody.version, "2.0.0");
    assert.ok(existsSync(join(scriptsDir, "packrat-scanner.py")));
    assert.ok(existsSync(join(scriptsDir, "packrat-paths.json")));
    assert.equal(existsSync(join(scriptsDir, "packrat-scanner.py.new")), false);

    const settingsAfterInstall = await (await fetch(s2.url + "/api/settings")).json();
    assert.deepEqual(settingsAfterInstall.settings.client, { adapter: "tazuo", scriptsDir });

    const setupAfterInstall = await (await fetch(s2.url + "/api/setup")).json();
    assert.equal(setupAfterInstall.firstRun, true, "an install alone must not clear firstRun");
    assert.equal(setupAfterInstall.installed.version, "2.0.0");

    const done = await fetch(s2.url + "/api/settings", {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ setupDone: true }),
    });
    assert.equal(done.status, 200);
    assert.equal((await (await fetch(s2.url + "/api/setup")).json()).firstRun, false);
    // the earlier install's settings.client survives a later, unrelated settings PUT
    assert.deepEqual((await (await fetch(s2.url + "/api/settings")).json()).settings.client, { adapter: "tazuo", scriptsDir });
  } finally {
    await s2.close();
  }
});

test("[fast] POST /api/setup/install refuses 409 with the -stopall message while bridge/tazuo/status.json is alive", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-setup-running-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--port", "0", "--data", dir], {})));
  try {
    mkdirSync(join(dir, "bridge", "tazuo"), { recursive: true });
    writeFileSync(join(dir, "bridge", "tazuo", "status.json"), JSON.stringify({ alive: new Date().toISOString() }));
    const scriptsDir = mkdtempSync(join(tmpdir(), "qm-client-running-"));
    const r = await fetch(s2.url + "/api/setup/install", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ adapter: "tazuo", scriptsDir }),
    });
    assert.equal(r.status, 409);
    const body = await r.json();
    assert.match(body.error, /-stopall/);
    assert.deepEqual(readdirSync(scriptsDir), [], "nothing was written while refused");
  } finally {
    await s2.close();
  }
});

test("[fast] POST /api/import copies two fixtures (not the stray .txt) into the tazuo inbox, and the watcher folds them into /api/inventory", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-import-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--port", "0", "--data", dir], {})));
  try {
    const fixture = JSON.parse(readFileSync(join(HERE, "..", "adapters", "tazuo", "fixture.scan.json"), "utf8"));
    const srcDir = mkdtempSync(join(tmpdir(), "qm-import-src-"));
    writeFileSync(join(srcDir, "one.json"), JSON.stringify(fixture));
    writeFileSync(join(srcDir, "two.json"), JSON.stringify(fixture));
    writeFileSync(join(srcDir, "notes.txt"), "not a scan");

    const r = await fetch(s2.url + "/api/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ dir: srcDir }) });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { ok: true, copied: 2, skipped: 0 });

    const badDir = await fetch(s2.url + "/api/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ dir: join(srcDir, "does-not-exist") }) });
    assert.equal(badDir.status, 400);

    const deadline = Date.now() + 3000;
    let found = false;
    while (Date.now() < deadline && !found) {
      const inv = await (await fetch(s2.url + "/api/inventory")).json();
      found = Boolean(inv.inventory.characters[fixture.character]);
      if (!found) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(found, "the imported scan(s) folded into /api/inventory within 3s");
  } finally {
    await s2.close();
  }
});

test("[fast] POST /api/import takes an explicit adapter (same result as the default) and rejects an unknown one, writing nothing", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-import-adapter-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--port", "0", "--data", dir], {})));
  try {
    const fixture = JSON.parse(readFileSync(join(HERE, "..", "adapters", "tazuo", "fixture.scan.json"), "utf8"));
    const srcDir = mkdtempSync(join(tmpdir(), "qm-import-adapter-src-"));
    writeFileSync(join(srcDir, "one.json"), JSON.stringify(fixture));

    const r = await fetch(s2.url + "/api/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ dir: srcDir, adapter: "tazuo" }) });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { ok: true, copied: 1, skipped: 0 });

    const bad = await fetch(s2.url + "/api/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ dir: srcDir, adapter: "not-a-real-adapter" }) });
    assert.equal(bad.status, 400);
    assert.match((await bad.json()).error, /unknown adapter/);
    assert.equal(existsSync(join(dir, "inbox", "not-a-real-adapter")), false, "a rejected adapter id must never create its own inbox directory");
  } finally {
    await s2.close();
  }
});

// ---- Task 1, Phase 6: POST /api/import/paste, POST /api/import/rescan -----------------------------
test("[fast] POST /api/import/paste: a good paste (marker block, with noise around it) lands a file the watcher then ingests", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-paste-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--port", "0", "--data", dir], {})));
  try {
    const fixture = JSON.parse(readFileSync(join(HERE, "..", "adapters", "tazuo", "fixture.scan.json"), "utf8"));
    const text = [
      "console output from the web client scanner",
      "-----BEGIN PACK RAT SCAN-----",
      JSON.stringify(fixture),
      "-----END PACK RAT SCAN-----",
      "done",
    ].join("\n");

    const r = await fetch(s2.url + "/api/import/paste", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text, adapter: "tazuo" }) });
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.ok, true);
    assert.equal(body.character, fixture.character);
    assert.ok(body.written, JSON.stringify(body));

    const deadline = Date.now() + 3000;
    let found = false;
    while (Date.now() < deadline && !found) {
      const inv = await (await fetch(s2.url + "/api/inventory")).json();
      found = Boolean(inv.inventory.characters[fixture.character]);
      if (!found) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(found, "the pasted scan folded into /api/inventory within 3s");
  } finally {
    await s2.close();
  }
});

// Post-review minor: the route now compares the picked `adapter` (which inbox the file lands in)
// against the pasted document's own `adapter.id` and returns a `warning` on a mismatch — harmless to
// the fold (the file still lands and still folds correctly), but the player should be told, since the
// picker that would have caught this is hidden whenever only one client is configured.
test("[fast] POST /api/import/paste: filing a scan under a different adapter than it declares returns a warning, but still lands and folds", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-paste-mismatch-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--port", "0", "--data", dir], {})));
  try {
    const fixture = JSON.parse(readFileSync(join(HERE, "..", "adapters", "tazuo", "fixture.scan.json"), "utf8"));   // adapter.id: "tazuo"
    const r = await fetch(s2.url + "/api/import/paste", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: JSON.stringify(fixture), adapter: "razor-enhanced" }),   // deliberately the wrong adapter
    });
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.ok, true);
    assert.match(body.warning, /razor-enhanced/);
    assert.match(body.warning, /tazuo/);
    assert.ok(body.written, JSON.stringify(body));

    // "Still lands and folds": the watcher's own scanOnce() nudge (fired right after the write) can
    // move the file out of the inbox before this test ever gets to look — same race the "good paste"
    // test above sidesteps by polling /api/inventory instead of the inbox directory directly, so this
    // does the same rather than asserting on inbox-file timing.
    const deadline = Date.now() + 3000;
    let found = false;
    while (Date.now() < deadline && !found) {
      const inv = await (await fetch(s2.url + "/api/inventory")).json();
      found = Boolean(inv.inventory.characters[fixture.character]);
      if (!found) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(found, "the mismatched-adapter paste still folded into /api/inventory within 3s");
  } finally {
    await s2.close();
  }
});

test("[fast] POST /api/import/paste: a matching adapter carries no warning field", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-paste-match-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--port", "0", "--data", dir], {})));
  try {
    const fixture = JSON.parse(readFileSync(join(HERE, "..", "adapters", "tazuo", "fixture.scan.json"), "utf8"));
    const r = await fetch(s2.url + "/api/import/paste", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: JSON.stringify(fixture), adapter: "tazuo" }),
    });
    const body = await r.json();
    assert.equal(body.ok, true);
    assert.equal(body.warning, undefined);
  } finally {
    await s2.close();
  }
});

test("[fast] POST /api/import/paste: a bad paste is 400 with the parse error and writes nothing to the inbox", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-paste-bad-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--port", "0", "--data", dir], {})));
  try {
    const inboxDir = join(dir, "inbox", "tazuo");
    const before = existsSync(inboxDir) ? readdirSync(inboxDir) : [];

    const r = await fetch(s2.url + "/api/import/paste", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "not json at all", adapter: "tazuo" }) });
    assert.equal(r.status, 400);
    const body = await r.json();
    assert.equal(body.ok, false);
    assert.match(body.error, /JSON/);

    const after = existsSync(inboxDir) ? readdirSync(inboxDir) : [];
    assert.deepEqual(after, before, "a rejected paste must not write into the inbox");
  } finally {
    await s2.close();
  }
});

test("[fast] POST /api/import/paste: an unknown adapter id is rejected with 400", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-paste-adapter-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--port", "0", "--data", dir], {})));
  try {
    const fixture = JSON.parse(readFileSync(join(HERE, "..", "adapters", "tazuo", "fixture.scan.json"), "utf8"));
    const r = await fetch(s2.url + "/api/import/paste", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: JSON.stringify(fixture), adapter: "not-a-real-adapter" }) });
    assert.equal(r.status, 400);
    assert.match((await r.json()).error, /unknown adapter/);
    assert.equal(existsSync(join(dir, "inbox", "not-a-real-adapter")), false);
  } finally {
    await s2.close();
  }
});

test("[fast] POST /api/import/rescan reports the adapters it swept (tazuo when live, empty under --demo)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-rescan-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--port", "0", "--data", dir], {})));
  try {
    const r = await fetch(s2.url + "/api/import/rescan", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.equal(j.ok, true);
    // Present, not pinned: the point is "tazuo gets swept live" vs. "nothing gets swept under
    // --demo" (below) — not the exact set of every adapter shipped in this repo.
    assert.ok(j.adapters.includes("tazuo"), JSON.stringify(j.adapters));
  } finally {
    await s2.close();
  }

  const demoDir = mkdtempSync(join(tmpdir(), "qm-rescan-demo-"));
  const s3 = await startServer(ensureLayout(resolveConfig(["--demo", "--port", "0", "--data", demoDir], {})));
  try {
    const r = await fetch(s3.url + "/api/import/rescan", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { ok: true, adapters: [] });
  } finally {
    await s3.close();
  }
});

test("[fast] POST /api/import/rescan actually re-sweeps a file the folder watcher missed", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-rescan-sweep-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--port", "0", "--data", dir], {})));
  try {
    const fixture = JSON.parse(readFileSync(join(HERE, "..", "adapters", "tazuo", "fixture.scan.json"), "utf8"));
    // Drop the file with a single write (no rename event) while the server is briefly paused from
    // handling requests — the startup sweep already ran before this file existed, so nothing has
    // ingested it yet; POST /api/import/rescan is what a player reaches for when a drop like this
    // never showed up.
    const inboxDir = join(dir, "inbox", "tazuo");
    mkdirSync(inboxDir, { recursive: true });
    writeFileSync(join(inboxDir, "missed.json"), JSON.stringify(fixture));

    const r = await fetch(s2.url + "/api/import/rescan", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    assert.equal(r.status, 200);
    const swept = await r.json();
    assert.equal(swept.ok, true);
    // Present, not pinned — see the previous test's comment; this one's real point is the
    // ingested-file assertion below, not the exact set of every adapter shipped in this repo.
    assert.ok(swept.adapters.includes("tazuo"), JSON.stringify(swept.adapters));

    const deadline = Date.now() + 3000;
    let found = false;
    while (Date.now() < deadline && !found) {
      const inv = await (await fetch(s2.url + "/api/inventory")).json();
      found = Boolean(inv.inventory.characters[fixture.character]);
      if (!found) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(found, "rescan folded the missed file into /api/inventory within 3s");
  } finally {
    await s2.close();
  }
});

test("[fast] GET /api/update-check reflects package.json (no repository field today => configured:false, no network call)", async () => {
  const pkg = JSON.parse(readFileSync(join(HERE, "..", "package.json"), "utf8"));
  const j = await (await get("/api/update-check")).json();
  assert.equal(j.ok, true);
  assert.equal(j.configured, pkg.repository ? true : false, JSON.stringify(pkg.repository));
});

test("[fast] POST /api/host/pick-folder and open-path are 501 without a host; an injected host answers pick-folder and validates open-path's which", async () => {
  const noHost = await fetch(srv.url + "/api/host/pick-folder", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "Pick" }) });
  assert.equal(noHost.status, 501);
  const noHostOpen = await fetch(srv.url + "/api/host/open-path", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ which: "data" }) });
  assert.equal(noHostOpen.status, 501);

  const dir = mkdtempSync(join(tmpdir(), "qm-host-"));
  const opened = [];
  const s2 = await startServer(
    ensureLayout(resolveConfig(["--demo", "--port", "0", "--data", dir], {})),
    { host: { pickFolder: async () => "/x", openPath: async (p) => { opened.push(p); } } },
  );
  try {
    const picked = await fetch(s2.url + "/api/host/pick-folder", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "Pick" }) });
    assert.equal(picked.status, 200);
    assert.equal((await picked.json()).path, "/x");

    const openOk = await fetch(s2.url + "/api/host/open-path", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ which: "data" }) });
    assert.equal(openOk.status, 200);
    assert.deepEqual(opened, [dir]);

    const openBad = await fetch(s2.url + "/api/host/open-path", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ which: "etc" }) });
    assert.equal(openBad.status, 400);
  } finally {
    await s2.close();
  }
});

test("[fast] PUT /api/settings {client: {adapter: 5}} is 400 naming client", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-settings-client-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--demo", "--port", "0", "--data", dir], {})));
  try {
    const r = await fetch(s2.url + "/api/settings", {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ client: { adapter: 5, scriptsDir: "/x" } }),
    });
    assert.equal(r.status, 400);
    assert.match((await r.json()).error, /client/);
  } finally {
    await s2.close();
  }
});

// Post-review fix (security, Important finding 1): adapter must be checked against the real,
// known adapter ids before it can reach a filesystem path — a traversal id like "../../../../tmp/evil"
// must never let /api/setup/locate or /api/setup/install (or PUT /api/settings' client.adapter) act on
// an arbitrary directory. installer.test.mjs covers installScripts' own defence-in-depth rejection
// directly; these cover the route-level allowlist check in front of it.
test("[fast] POST /api/setup/locate and POST /api/setup/install reject a traversal/unknown adapter id with 400, writing nothing", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-setup-badadapter-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--port", "0", "--data", dir], {})));
  try {
    const evilAdapter = "../../../../tmp/evil";
    const probeDir = mkdtempSync(join(tmpdir(), "qm-badadapter-probe-"));

    const locate = await fetch(s2.url + "/api/setup/locate", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ adapter: evilAdapter, dir: probeDir }),
    });
    assert.equal(locate.status, 400);
    assert.match((await locate.json()).error, /adapter/);

    const scriptsDir = mkdtempSync(join(tmpdir(), "qm-badadapter-dest-"));
    const install = await fetch(s2.url + "/api/setup/install", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ adapter: evilAdapter, scriptsDir }),
    });
    assert.equal(install.status, 400);
    assert.match((await install.json()).error, /adapter/);
    assert.deepEqual(readdirSync(scriptsDir), [], "nothing was written for a rejected adapter id");
    assert.equal((await (await fetch(s2.url + "/api/settings")).json()).settings.client, undefined, "a rejected install must not save settings.client");

    // an unknown-but-shape-valid adapter id (no traversal characters, just not a real adapter) is
    // rejected the same way
    const unknown = await fetch(s2.url + "/api/setup/install", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ adapter: "nope", scriptsDir }),
    });
    assert.equal(unknown.status, 400);
  } finally {
    await s2.close();
  }
});

test("[fast] PUT /api/settings {client: {adapter: \"../evil\", scriptsDir}} is 400 (client.adapter must be a real adapter id)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-settings-badadapter-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--demo", "--port", "0", "--data", dir], {})));
  try {
    const r = await fetch(s2.url + "/api/settings", {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ client: { adapter: "../evil", scriptsDir: "/x" } }),
    });
    assert.equal(r.status, 400);
    assert.match((await r.json()).error, /adapter/);
    assert.equal((await (await fetch(s2.url + "/api/settings")).json()).settings.client, undefined, "a rejected PUT must not save settings.client");
  } finally {
    await s2.close();
  }
});
