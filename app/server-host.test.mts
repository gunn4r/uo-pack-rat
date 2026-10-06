// server-host.test.mts — HTTP tests of the event stream, the bridge, the host calls and the UI preferences.
//
// `GET /api/events` (`hello` listing the adapters, `inventory` and `rejected` events from the inbox watcher, none under `--demo`, a throwing log destination not crashing the server, the anti-framing headers on both streams); the bridge (`POST /api/bridge` checked against the bridge schema and bounded, queued into the configured adapter's own folder, `POST /api/bridge/stop`, `GET /api/bridge/status` reading the configured adapter's status and never letting it override `ok`/`online`/`age`); `POST /api/host/pick-folder` and `open-path` (501 with no host, an injected host answering, a title passed on only as a short string, a bounded call answering 504); and `GET|PUT /api/ui-prefs` (the column choice on another port, theme, appearance, sidebar, density, column widths and sheet properties, the House map's area labels and drawer width, and the Suit Builder's mode, Manual suit and buffs, each kept across a restart and refused when malformed).
import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, renameSync, rmSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { resolveConfig, ensureLayout } from "./config.mts";
import type { ServerHandle } from "./vault-server.mts";
import { startTestServer as startServer } from "./server-fixture.mts";
import { setRules } from "./vault-lib.mts";
import { buildUi } from "../scripts/build-ui.mts";
import { buildSchemaTypes } from "../scripts/build-schema-types.mts";
import { validate, type ValidatorSchema } from "./schema/validate.mts";
import { asJson, HERE, UOALIVE, sseReader, type InventoryResponse, type ErrorBody, type SseReaderHandle } from "./server-routes-fixture.mts";

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

const BRIDGE_SCHEMA = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "schema", "bridge.v1.schema.json"), "utf8")) as { command: ValidatorSchema; result: ValidatorSchema; status: ValidatorSchema };

// A dropped inbox file's fs.watch notification can be silently missed by the OS — reproduced live
// (not a timing-margin issue: an instrumented trace showed the watcher's fs.watch callback firing
// ZERO times for the whole life of the affected watcher, not late) in
// .superpowers/sdd/2026-09-17-phase-6-adapters/sse-flake-report.md. app/vault-server.mts's own
// POST /api/import and /api/import/paste routes already treat this as expected platform behavior and
// nudge scanOnce() themselves instead of trusting fs.watch alone (see their "Nudge the watcher"
// comments); POST /api/import/rescan exposes that same nudge for a drop the app didn't make itself —
// exactly the case here, and exactly what a real player would click if their drop never lit up. So a
// test waiting on a live SSE event from a dropped file does what a real player would do when fs.watch
// stays silent: rescan once, then keep waiting — a longer timeout would not help an event that never
// fires at all. Any OTHER readUntil failure (the stream ending, a wiring/crash bug) is not swallowed —
// only "timed out" retries through the rescan; scanOnce()/ingestFile are idempotent, so a rescan that
// races a live event that was merely slow (not dropped) is harmless either way.
async function readUntilOrRescan(sse: SseReaderHandle, matcher: (buf: string) => boolean, serverUrl: string, { timeoutMs = 3000, rescanTimeoutMs = 5000 }: { timeoutMs?: number; rescanTimeoutMs?: number } = {}): Promise<string> {
  try {
    return await sse.readUntil(matcher, { timeoutMs });
  } catch (e) {
    if (!/timed out/.test((e as Error).message)) throw e;
    await fetch(serverUrl + "/api/import/rescan", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    return sse.readUntil(matcher, { timeoutMs: rescanTimeoutMs });
  }
}

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
    const { id } = asJson(await good.json());
    const lines = readFileSync(join(dir, "bridge", "tazuo", "queue.jsonl"), "utf8").trim().split("\n");
    assert.equal(lines.length, 1, "only the valid call should have queued a line");
    const written = JSON.parse(lines[0]!);
    assert.equal(written.id, id);
    const v = validate(BRIDGE_SCHEMA.command, written);
    assert.equal(v.ok, true, JSON.stringify(v.errors));
  } finally {
    await s2.close();
  }
});

test("[fast] POST /api/bridge/stop writes the bridge's stop flag, and POST /api/bridge still refuses a trip", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-bridge-stop-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--demo", "--port", "0", "--data", dir], {})));
  try {
    const stop = await fetch(s2.url + "/api/bridge/stop", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    assert.equal(stop.status, 200, JSON.stringify(await stop.json().catch(() => null)));
    assert.ok(existsSync(join(dir, "bridge", "stop")));
    // The page can never queue a trip: only app/bridge-trip.mts's queueTrip writes one.
    const trip = await fetch(s2.url + "/api/bridge", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "trip", serial: 1, name: "n", chain: [], pos: null, index: 1, stamp: "s", roots: {}, takes: [], puts: [{ serial: 1, name: "x", dest: [2] }] }) });
    assert.equal(trip.status, 400);
    assert.equal(existsSync(join(dir, "bridge", "tazuo", "queue.jsonl")), false);
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
    assert.equal(setClient.status, 200, JSON.stringify(asJson(await setClient.json())));

    const r = await fetch(s2.url + "/api/bridge", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "grab", serial: 0x40000010, name: "Ring", chain: [], pos: null }) });
    assert.equal(r.status, 200, JSON.stringify(await r.json().catch(() => null)));

    assert.ok(existsSync(join(dir, "bridge", "razor-enhanced", "queue.jsonl")), "the command landed in razor-enhanced's own queue");
    assert.equal(existsSync(join(dir, "bridge", "tazuo", "queue.jsonl")), false, "nothing was written to tazuo's queue for a razor-enhanced-configured client");
    const lines = readFileSync(join(dir, "bridge", "razor-enhanced", "queue.jsonl"), "utf8").trim().split("\n");
    assert.equal(lines.length, 1);
    assert.equal(JSON.parse(lines[0]!).action, "grab");
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
    assert.equal(setClient.status, 200, JSON.stringify(asJson(await setClient.json())));

    const st = asJson(await (await fetch(s2.url + "/api/bridge/status")).json());
    assert.equal(st.online, true, JSON.stringify(st));
    assert.equal(st.character, "RazorPlayer", "must read razor-enhanced's own status, not tazuo's stale one");
  } finally {
    await s2.close();
  }
});

// GET /api/events (Task 1, Phase 4): a non-demo server watches inbox/tazuo/ (app/watcher.mts) and
// streams accept/reject over one shared SSE connection; --demo starts no watcher at all.
test("[fast] GET /api/events: hello lists the tazuo adapter, and an accepted inbox file streams an inventory event", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-events-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--port", "0", "--data", dir], {})));
  try {
    const res = await fetch(s2.url + "/api/events");
    assert.equal(res.status, 200);
    const sse = sseReader(res);
    const hello = await sse.readUntil((buf) => buf.includes("event: hello"));
    const helloData = JSON.parse(hello.match(/event: hello\ndata: (.+)\n/)![1]!);
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
    const invData = JSON.parse(invBuf.match(/event: inventory\ndata: (.+)\n/)![1]!);
    assert.equal(invData.character, fixture.character);
    assert.equal(existsSync(join(inboxDir, "drop.json")), false, "the inbox file is gone once accepted");
    sse.cancel();

    const inv = asJson<InventoryResponse>(await (await fetch(s2.url + "/api/inventory")).json());
    assert.ok(inv.inventory.characters[fixture.character], JSON.stringify(Object.keys(inv.inventory.characters)));
  } finally {
    await s2.close();
  }
});

test("[fast] GET /api/events: an invalid inbox file streams a rejected event and lands under rejected/", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-events-rej-"));
  // Fast watcher timing (matches app/watcher.test.mts's own debounceMs:20/retryDelayMs:20 convention):
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
    const rejData = JSON.parse(rejBuf.match(/event: rejected\ndata: (.+)\n/)![1]!);
    assert.equal(rejData.file, "bad.json");
    assert.ok(existsSync(join(inboxDir, "rejected", "bad.json")));
    sse.cancel();
  } finally {
    await s2.close();
  }
});

// Post-review fix (Important 1): a log destination that throws on every write (a full disk, or a
// user deleting logs/ via the Settings tab's own "Open" button — spec §11's own examples) used to
// crash the whole process, since app/watcher.mts's ingestFile/enqueue treated `log()` as "never
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

    // Before the fix, the watcher's very first log() call (app/vault-server.mts's callback into
    // app/watcher.mts) threw, leaving the watcher's promise chain rejected with no handler — an
    // unhandled rejection that took the whole process down well before this event could ever fire,
    // and well before the retries/rejectFile below would ever run.
    const rejBuf = await readUntilOrRescan(sse, (buf) => buf.includes("event: rejected"), s2.url, { timeoutMs: 5000 });
    const rejData = JSON.parse(rejBuf.match(/event: rejected\ndata: (.+)\n/)![1]!);
    assert.equal(rejData.file, "bad.json");
    assert.ok(existsSync(join(inboxDir, "rejected", "bad.json")), "the bad file was still quarantined despite every log write failing");
    sse.cancel();

    // A successful fetch here is itself proof the process survived — it could not respond at all
    // (let alone with 200) if the unhandled rejection from before the fix had taken it down.
    const invRes = await fetch(s2.url + "/api/inventory");
    assert.equal(invRes.status, 200, "the server kept serving /api/inventory after a run of failed log writes");
    assert.equal(asJson(await invRes.json()).ok, true);
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
    const helloData = JSON.parse(hello.match(/event: hello\ndata: (.+)\n/)![1]!);
    assert.deepEqual(helloData.watching, []);
    sse.cancel();
  } finally {
    await s2.close();
  }
});

test("[fast] POST /api/host/pick-folder and open-path are 501 without a host; an injected host answers pick-folder and validates open-path's which", async () => {
  const noHost = await fetch(srv.url + "/api/host/pick-folder", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "Pick" }) });
  assert.equal(noHost.status, 501);
  const noHostOpen = await fetch(srv.url + "/api/host/open-path", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ which: "data" }) });
  assert.equal(noHostOpen.status, 501);
  // The page learns this up front (Settings shows Copy path instead of an Open that can only fail).
  assert.equal(asJson(await (await fetch(srv.url + "/api/setup")).json()).canOpenFolders, false);

  const dir = mkdtempSync(join(tmpdir(), "qm-host-"));
  const opened: string[] = [];
  const s2 = await startServer(
    ensureLayout(resolveConfig(["--demo", "--port", "0", "--data", dir], {})),
    { host: { pickFolder: async () => "/x", openPath: async (w: "data" | "logs") => { opened.push(w); } } },
  );
  try {
    assert.equal(asJson(await (await fetch(s2.url + "/api/setup")).json()).canOpenFolders, true);
    const picked = await fetch(s2.url + "/api/host/pick-folder", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "Pick" }) });
    assert.equal(picked.status, 200);
    assert.equal(asJson(await picked.json()).path, "/x");

    const openOk = await fetch(s2.url + "/api/host/open-path", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ which: "data" }) });
    assert.equal(openOk.status, 200);
    // The DISCRIMINATOR crosses the host bridge, not a path this process resolved — electron/main.mts
    // owns the two directories it maps to (phase-7 security review, area-4 Important 1).
    assert.deepEqual(opened, ["data"]);

    const openBad = await fetch(s2.url + "/api/host/open-path", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ which: "etc" }) });
    assert.equal(openBad.status, 400);
  } finally {
    await s2.close();
  }
});

// Minor 9: BRIDGE_SCHEMA.command constrains the TYPES of action/serial/chain but sets no maxLength on
// name and no item cap on chain — and this is the one route whose input reaches the game client.
test("[fast] POST /api/bridge bounds name, chain and the assembled line, queueing nothing when they blow the cap", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-bridge-bounds-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--demo", "--port", "0", "--data", dir], {})));
  const queue = join(dir, "bridge", "tazuo", "queue.jsonl");
  try {
    const bad: unknown[] = [
      { action: "grab", serial: 1, name: "n".repeat(1000), chain: [], pos: null },
      { action: "grab", serial: 1, name: 5, chain: [], pos: null },
      { action: "grab", serial: 1, name: "n", chain: Array.from({ length: 64 }, (_, i) => i), pos: null },
      { action: "grab", serial: 1, name: "n", chain: [], pos: { blob: "b".repeat(8000) } },
    ];
    for (const body of bad) {
      const r = await fetch(s2.url + "/api/bridge", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      assert.equal(r.status, 400, JSON.stringify(body).slice(0, 80));
    }
    // and the body itself is capped well below readBody's 50 MB default (a 500 KB name used to take
    // queue.jsonl to half a megabyte in one request)
    const enormous = await fetch(s2.url + "/api/bridge", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "grab", serial: 1, name: "n".repeat(1_000_000), chain: [], pos: null }),
    });
    assert.equal(enormous.status, 413);
    assert.equal(existsSync(queue), false, "nothing was appended to the queue");
  } finally {
    await s2.close();
  }
});

// area-4 minor 1: the title crossed two process hops into a native, app-modal folder dialog with no
// check of any kind and the 50 MB default body cap behind it.
test("[fast] POST /api/host/pick-folder passes on only a short string title, and the shell's default otherwise", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-pickfolder-title-"));
  const seen: Array<{ title?: unknown }> = [];
  const s2 = await startServer(
    ensureLayout(resolveConfig(["--demo", "--port", "0", "--data", dir], {})),
    { host: { pickFolder: async (opts) => { seen.push(opts); return "/x"; } } },
  );
  try {
    for (const title of [{ evil: 1 }, 5, "T".repeat(500), null]) {
      const r = await fetch(s2.url + "/api/host/pick-folder", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title }) });
      assert.equal(r.status, 200);
    }
    assert.deepEqual(seen, [{}, {}, {}, {}], "anything but a short string falls back to the shell's own title");
    const good = await fetch(s2.url + "/api/host/pick-folder", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "Pick your client folder" }) });
    assert.equal(good.status, 200);
    assert.deepEqual(seen[4], { title: "Pick your client folder" });
  } finally {
    await s2.close();
  }
});

// area-4 minor 5: nothing below this process bounds a host call — callHost never expires a pending
// entry, and a result posted after the server child was respawned is dropped — so a dialog whose
// answer never comes back held the socket open for ever, since requestTimeout governs request RECEIPT
// and never touches a response that has not started. The real ceiling is a minute, too long to sit
// through here, so this pins the wiring rather than the clock: both host calls go through the bounded
// wrapper, which the unbounded original did not have at all.
test("[fast] both POST /api/host/* routes await a BOUNDED host call, and a timed-out one answers 504", () => {
  const src = readFileSync(join(HERE, "http", "routes", "host.mts"), "utf8");
  assert.match(src, /withHostTimeout\(host\.pickFolder\(/, "pick-folder goes through the timeout wrapper");
  assert.match(src, /withHostTimeout\(host\.openPath\(/, "so does open-path");
  assert.match(src, /e\.statusCode = 504;/, "and a timed-out host call answers 504");
});

// The two event-stream routes write their own headers rather than going through send(), so the
// "every response carries x-frame-options" rule used to stop at them. Both share SSE_HEADERS now.
test("[fast] the event streams carry the same anti-framing headers every other response does", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-sse-headers-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--demo", "--port", "0", "--data", dir], {})));
  try {
    const res = await fetch(s2.url + "/api/events");
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("x-frame-options"), "DENY");
    assert.match(res.headers.get("content-security-policy") || "", /frame-ancestors 'none'/);
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    await res.body?.cancel();
  } finally {
    await s2.close();
  }
  // The per-job stream needs a running job to open; it is pinned to the same constant at the source.
  const source = ["host.mts", "optimize.mts"].map((f) => readFileSync(join(HERE, "http", "routes", f), "utf8")).join("\n");
  assert.equal((source.match(/res\.writeHead\(200, SSE_HEADERS\)/g) || []).length, 2, "both stream routes use SSE_HEADERS");
  assert.doesNotMatch(source, /"content-type": "text\/event-stream", "cache-control": "no-store", connection: "keep-alive", "x-content-type-options": "nosniff" \}/, "no stream writes its own header set any more");
});

// The contract's own bounds (name maxLength 120, chain maxItems 8 — the adapters' MAX_NAME/MAX_CHAIN)
// used to be documentation only: the validator implemented neither keyword, so the route's looser
// 200/16 pre-checks were the only refusal. validate.mts implements both now, and the route runs it.
test("[fast] POST /api/bridge refuses a name or chain past the bridge schema's own bounds", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-bridge-schema-bounds-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--demo", "--port", "0", "--data", dir], {})));
  try {
    const post = (body: unknown) => fetch(s2.url + "/api/bridge", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const longName = await post({ action: "grab", serial: 1, name: "n".repeat(121), chain: [], pos: null });
    assert.equal(longName.status, 400);
    assert.match(asJson<ErrorBody>(await longName.json()).error, /\/name .*maxLength 120/);
    const longChain = await post({ action: "grab", serial: 1, name: "n", chain: Array.from({ length: 9 }, (_, i) => i + 1), pos: null });
    assert.equal(longChain.status, 400);
    assert.match(asJson<ErrorBody>(await longChain.json()).error, /\/chain .*maxItems 8/);
    assert.equal(existsSync(join(dir, "bridge", "tazuo", "queue.jsonl")), false, "nothing was queued");
  } finally {
    await s2.close();
  }
});

test("[fast] GET /api/bridge/status: a status file cannot override the server's own ok/online/age", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-bridge-override-"));
  mkdirSync(join(dir, "bridge", "tazuo"), { recursive: true });
  writeFileSync(join(dir, "bridge", "tazuo", "status.json"), JSON.stringify({ alive: "2020-01-01T00:00:00Z", ok: false, online: true, age: 0, character: "Old", current: null, results: {}, counts: { done: 0, failed: 0 } }));
  const s2 = await startServer(ensureLayout(resolveConfig(["--demo", "--port", "0", "--data", dir], {})));
  try {
    const st = asJson(await (await fetch(s2.url + "/api/bridge/status")).json());
    assert.equal(st.ok, true);
    assert.equal(st.online, false);
    assert.ok((st.age as number) > 1000, String(st.age));
    assert.equal(st.character, "Old", "the documented fields still come through");
  } finally {
    await s2.close();
  }
});

// The Inventory tab's column choice used to live in localStorage, which belongs to one origin; the
// desktop app serves the page from a new port on every launch, so the choice was gone at each start.
// It is kept in <data>/ui-prefs.json instead, and survives a server on another port.
test("[fast] GET/PUT /api/ui-prefs keeps the column choice across a restart on another port", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-uiprefs-"));
  const put = (url: string, body: unknown): Promise<Response> => fetch(url + "/api/ui-prefs", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const s1 = await startServer(ensureLayout(resolveConfig(["--port", "0", "--data", dir], {})));
  try {
    assert.deepEqual(asJson(await (await fetch(s1.url + "/api/ui-prefs")).json()), { ok: true, prefs: {} }, "nothing chosen yet");
    assert.equal((await put(s1.url, { cols: ["hci"] })).status, 200);
    const firstInode = statSync(join(dir, "ui-prefs.json")).ino;
    assert.equal((await put(s1.url, { cols: ["hci", "sk:magery", "strReq"] })).status, 200);
    assert.notEqual(statSync(join(dir, "ui-prefs.json")).ino, firstInode, "replaced through a renamed temp file, not rewritten in place");
    if (process.platform !== "win32") assert.equal(statSync(join(dir, "ui-prefs.json")).mode & 0o777, 0o600);
    for (const bad of [{ cols: "hci" }, { cols: [5] }, { cols: [""] }, { cols: ["x".repeat(65)] }, { cols: Array.from({ length: 201 }, (_, i) => `k${i}`) }]) {
      assert.equal((await put(s1.url, bad)).status, 400, `${JSON.stringify(bad).slice(0, 60)} should be refused`);
    }
  } finally {
    await s1.close();
  }
  const s2 = await startServer(ensureLayout(resolveConfig(["--port", "0", "--data", dir], {})));
  try {
    assert.notEqual(s2.url, s1.url);
    assert.deepEqual(asJson(await (await fetch(s2.url + "/api/ui-prefs")).json()), { ok: true, prefs: { cols: ["hci", "sk:magery", "strReq"] } });
  } finally {
    await s2.close();
  }
});

// The look (theme family, light/system/dark) and the pinned-collapsed sidebar are view choices like the
// columns, and live in the same file for the same reason: the desktop app's origin changes every launch.
// Each field is written only when valid, and a PUT of one field keeps the others.
test("[fast] PUT /api/ui-prefs keeps theme, appearance, sidebar, density, the column set version, the column widths, the sheet's properties, the dismissed update and the copied scanner, each checked, next to the columns", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-uiprefs-look-"));
  const put = (url: string, body: unknown): Promise<Response> => fetch(url + "/api/ui-prefs", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const s = await startServer(ensureLayout(resolveConfig(["--port", "0", "--data", dir], {})));
  try {
    assert.equal((await put(s.url, { cols: ["hci"] })).status, 200);
    assert.equal((await put(s.url, { appearance: "dark" })).status, 200);
    assert.equal((await put(s.url, { theme: "default", sidebar: "collapsed" })).status, 200);
    assert.equal((await put(s.url, { density: "regular" })).status, 200);
    assert.equal((await put(s.url, { cols: ["hci"], colsVersion: "2" })).status, 200);
    assert.equal((await put(s.url, { sheetProps: ["fc", "hitLifeLeech"] })).status, 200);
    assert.equal((await put(s.url, { colWidths: { location: 420, "sk:animal lore": 40 } })).status, 200);
    assert.equal((await put(s.url, { dismissedUpdate: "1.2.3" })).status, 200);
    assert.equal((await put(s.url, { copiedScanner: "1.2.0" })).status, 200);
    assert.deepEqual(asJson(await (await fetch(s.url + "/api/ui-prefs")).json()), { ok: true, prefs: { cols: ["hci"], sheetProps: ["fc", "hitLifeLeech"], colsVersion: "2", appearance: "dark", theme: "default", sidebar: "collapsed", density: "regular", colWidths: { location: 420, "sk:animal lore": 40 }, dismissedUpdate: "1.2.3", copiedScanner: "1.2.0" } });
    for (const bad of [{ appearance: "sepia" }, { appearance: 1 }, { theme: "neon" }, { theme: "" }, { sidebar: "wide" }, { sidebar: true }, { density: "comfy" }, { colsVersion: 2 }, { colsVersion: "9" },
      { sheetProps: "fc" }, { sheetProps: [5] }, { colWidths: [300] }, { colWidths: { location: 39 } }, { colWidths: { location: 300.5 } }, { colWidths: { location: "300" } },
      { dismissedUpdate: "" }, { dismissedUpdate: 3 }, { dismissedUpdate: "9".repeat(65) }, { copiedScanner: "" }, { copiedScanner: 1.2 },
      { colWidths: Object.fromEntries(Array.from({ length: 201 }, (_, i) => [`c${i}`, 100])) }]) {
      assert.equal((await put(s.url, bad)).status, 400, `${JSON.stringify(bad).slice(0, 80)} should be refused`);
    }
    // A hand-edited file with a bad value reads as "never chosen" for that field only.
    writeFileSync(join(dir, "ui-prefs.json"), JSON.stringify({ cols: ["dci"], sheetProps: [1], appearance: "sepia", theme: "default", sidebar: 3, colWidths: { location: 9000 } }));
    assert.deepEqual(asJson(await (await fetch(s.url + "/api/ui-prefs")).json()), { ok: true, prefs: { cols: ["dci"], theme: "default" } });
  } finally {
    await s.close();
  }
});

test("[fast] PUT /api/ui-prefs keeps the House map's area labels shown or hidden (issue #10) across a restart, and refuses anything else", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-uiprefs-labels-"));
  const put = (url: string, body: unknown): Promise<Response> => fetch(url + "/api/ui-prefs", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const s1 = await startServer(ensureLayout(resolveConfig(["--port", "0", "--data", dir], {})));
  try {
    assert.equal((await put(s1.url, { areaLabels: "hide" })).status, 200);
    for (const bad of [{ areaLabels: "off" }, { areaLabels: false }, { areaLabels: "" }]) assert.equal((await put(s1.url, bad)).status, 400, JSON.stringify(bad));
  } finally { await s1.close(); }
  const s2 = await startServer(ensureLayout(resolveConfig(["--port", "0", "--data", dir], {})));
  try {
    assert.deepEqual(asJson(await (await fetch(s2.url + "/api/ui-prefs")).json()), { ok: true, prefs: { areaLabels: "hide" } });
    assert.equal((await put(s2.url, { areaLabels: "show" })).status, 200);
    assert.deepEqual(asJson(await (await fetch(s2.url + "/api/ui-prefs")).json()), { ok: true, prefs: { areaLabels: "show" } });
  } finally { await s2.close(); }
});

test("[fast] PUT /api/ui-prefs keeps the House map contents drawer's width (issue #10) across a restart: a whole number of px from 320 to 4000, nothing else", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-uiprefs-drawer-"));
  const put = (url: string, body: unknown): Promise<Response> => fetch(url + "/api/ui-prefs", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const s1 = await startServer(ensureLayout(resolveConfig(["--port", "0", "--data", dir], {})));
  try {
    assert.equal((await put(s1.url, { mapDrawerWidth: 512 })).status, 200);
    for (const bad of [{ mapDrawerWidth: 319 }, { mapDrawerWidth: 4001 }, { mapDrawerWidth: 400.5 }, { mapDrawerWidth: "400" }, { mapDrawerWidth: null }]) assert.equal((await put(s1.url, bad)).status, 400, JSON.stringify(bad));
  } finally { await s1.close(); }
  const s2 = await startServer(ensureLayout(resolveConfig(["--port", "0", "--data", dir], {})));
  try {
    assert.deepEqual(asJson(await (await fetch(s2.url + "/api/ui-prefs")).json()), { ok: true, prefs: { mapDrawerWidth: 512 } });
  } finally { await s2.close(); }
  // a hand-edited width out of range reads as never chosen
  writeFileSync(join(dir, "ui-prefs.json"), JSON.stringify({ mapDrawerWidth: 9000 }));
  const s3 = await startServer(ensureLayout(resolveConfig(["--port", "0", "--data", dir], {})));
  try {
    assert.deepEqual(asJson(await (await fetch(s3.url + "/api/ui-prefs")).json()), { ok: true, prefs: {} });
  } finally { await s3.close(); }
});

test("[fast] PUT /api/ui-prefs keeps the Suit Builder's mode, its Manual suit and buffs and No character's buff numbers (issue #12) across a restart, refuses Automatic's buffs (the profiles hold them now), and refuses anything else, an unknown slot or __proto__ included; the kilt slot is a slot (issue #202)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-uiprefs-manual-"));
  const put = (url: string, body: unknown): Promise<Response> => fetch(url + "/api/ui-prefs", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const s1 = await startServer(ensureLayout(resolveConfig(["--port", "0", "--data", dir], {})));
  try {
    assert.equal((await put(s1.url, { builderMode: "manual", manualFor: "none", manualSuit: { ring: 1879769144, twoHanded: 0xFFFFFFFF, feet: 7, outerLegs: 8 } })).status, 200);
    for (const bad of [{ builderMode: "auto" }, { manualFor: "Dorran" }, { manualSuit: [1] }, { manualSuit: { ring: 0 } }, { manualSuit: { ring: 1.5 } }, { manualSuit: { ring: "5" } }, { manualSuit: { ring: 0x100000000 } }, { manualSuit: { backpack: 5 } }, { manualSuit: null }]) {
      assert.equal((await put(s1.url, bad)).status, 400, JSON.stringify(bad));
    }
    // a "__proto__" key, as JSON.parse makes it (an own property), is no slot
    const proto = await fetch(s1.url + "/api/ui-prefs", { method: "PUT", headers: { "content-type": "application/json" }, body: '{"manualSuit":{"__proto__":5,"ring":7}}' });
    assert.equal(proto.status, 400);
  } finally { await s1.close(); }
  const s2 = await startServer(ensureLayout(resolveConfig(["--port", "0", "--data", dir], {})));
  try {
    assert.deepEqual(asJson(await (await fetch(s2.url + "/api/ui-prefs")).json()), { ok: true, prefs: { builderMode: "manual", manualFor: "none", manualSuit: { ring: 1879769144, twoHanded: 0xFFFFFFFF, feet: 7, outerLegs: 8 } } });
    assert.equal((await put(s2.url, { manualSuit: {} })).status, 200, "an empty suit is a suit");
    assert.deepEqual(asJson<{ prefs: Record<string, unknown> }>(await (await fetch(s2.url + "/api/ui-prefs")).json()).prefs.manualSuit, {});
    // its buffs (app/buffs.mts): catalog ids each once, No character's edited numbers within their bounds, and the count switch
    const edits = { Chivalry: 105.5, Karma: -200, "Mastery level": 2 };
    assert.equal((await put(s2.url, { manualBuffs: ["divineFury", "whiteTiger"], manualBuffSkills: edits, buffsCount: "off" })).status, 200);
    for (const bad of [{ manualBuffs: ["nope"] }, { manualBuffs: ["bless", "bless"] }, { manualBuffs: "bless" }, { manualBuffSkills: { Chivalry: 151 } }, { manualBuffSkills: { Hiding: 100 } },
      { manualBuffSkills: { "Mastery level": 2.5 } }, { manualBuffSkills: { Dorran: { Chivalry: 105 } } }, { manualBuffSkills: [] }, { buffsCount: "yes" }]) {
      assert.equal((await put(s2.url, bad)).status, 400, JSON.stringify(bad));
    }
    // Automatic's buffs and a character's numbers are the character's profile now (PUT /api/profiles): an older page's are refused
    for (const bad of [{ autoBuffs: { Dorran: ["bless"] } }, { buffSkills: { Dorran: { Chivalry: 105 } } }]) {
      const r = await put(s2.url, bad);
      assert.equal(r.status, 400, JSON.stringify(bad));
      assert.match(asJson<{ error: string }>(await r.json()).error, /is kept with the profiles now; reload the page$/);
    }
    const prefs = asJson<{ prefs: Record<string, unknown> }>(await (await fetch(s2.url + "/api/ui-prefs")).json()).prefs;
    assert.deepEqual([prefs.manualBuffs, prefs.manualBuffSkills, prefs.buffsCount], [["divineFury", "whiteTiger"], edits, "off"]);
    assert.equal((await put(s2.url, { manualBuffs: ["wraithForm", "lichForm"] })).status, 400, "one form at most");
    // a hand-edited file with two forms is healed on reading: the later replaces the earlier, as turning it on would; a
    // file still holding Automatic's buffs (its profiles not migrated yet) never hands them out
    writeFileSync(join(dir, "ui-prefs.json"), JSON.stringify({ manualBuffs: ["wraithForm", "lichForm"], autoBuffs: { Dorran: ["bless"] }, buffSkills: { Dorran: { Chivalry: 90 } } }));
    const healed = asJson<{ prefs: Record<string, unknown> }>(await (await fetch(s2.url + "/api/ui-prefs")).json()).prefs;
    assert.deepEqual(healed, { manualBuffs: ["lichForm"] });
  } finally { await s2.close(); }
});
