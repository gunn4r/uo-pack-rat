// server-import.test.mts — HTTP tests of POST /api/import/paste and POST /api/import/rescan. Tags: [fast]. Run: node --test app/server-import.test.mts
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveConfig, ensureLayout } from "./config.mts";
import { startTestServer as startServer } from "./server-fixture.mts";
import { setRules } from "./vault-lib.mts";
import { buildUi } from "../scripts/build-ui.mts";
import { buildSchemaTypes } from "../scripts/build-schema-types.mts";
import { MAX_INBOX_BYTES } from "./watcher.mts";
import { asJson, HERE, UOALIVE, JSON_HEADERS, type InventoryResponse, type ErrorBody } from "./server-routes-fixture.mts";

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

interface RescanResponse {
  ok: boolean;
  adapters: string[];
}

interface PasteResponse {
  ok: boolean;
  character?: string;
  written?: string;
  warning?: string;
  error?: string;
}

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
    const body = asJson<PasteResponse>(await r.json());
    assert.equal(body.ok, true);
    assert.equal(body.character, fixture.character);
    assert.ok(body.written, JSON.stringify(body));

    const deadline = Date.now() + 3000;
    let found = false;
    while (Date.now() < deadline && !found) {
      const inv = asJson<InventoryResponse>(await (await fetch(s2.url + "/api/inventory")).json());
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
    const body = asJson<PasteResponse>(await r.json());
    assert.equal(body.ok, true);
    assert.match(body.warning!, /razor-enhanced/);
    assert.match(body.warning!, /tazuo/);
    assert.ok(body.written, JSON.stringify(body));

    // "Still lands and folds": the watcher's own scanOnce() nudge (fired right after the write) can
    // move the file out of the inbox before this test ever gets to look — same race the "good paste"
    // test above sidesteps by polling /api/inventory instead of the inbox directory directly, so this
    // does the same rather than asserting on inbox-file timing.
    const deadline = Date.now() + 3000;
    let found = false;
    while (Date.now() < deadline && !found) {
      const inv = asJson<InventoryResponse>(await (await fetch(s2.url + "/api/inventory")).json());
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
    const body = asJson<PasteResponse>(await r.json());
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
    const body = asJson<PasteResponse>(await r.json());
    assert.equal(body.ok, false);
    assert.match(body.error!, /JSON/);

    const after = existsSync(inboxDir) ? readdirSync(inboxDir) : [];
    assert.deepEqual(after, before, "a rejected paste must not write into the inbox");
  } finally {
    await s2.close();
  }
});

// The paste cap used to be readBody's 50 MB default while the watcher refuses an inbox file over
// MAX_INBOX_BYTES (32 MB), so a paste in between was answered 200 and then rejected. It is refused up
// front now, and nothing is written.
test("[fast] POST /api/import/paste: a paste over the watcher's inbox limit is 413 and writes nothing", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-paste-big-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--port", "0", "--data", dir], {})));
  try {
    const r = await fetch(s2.url + "/api/import/paste", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "x".repeat(MAX_INBOX_BYTES), adapter: "tazuo" }) });
    assert.equal(r.status, 413);
    assert.match(asJson<ErrorBody>(await r.json()).error, /paste too large/);
    const inboxDir = join(dir, "inbox", "tazuo");
    assert.deepEqual(existsSync(inboxDir) ? readdirSync(inboxDir) : [], []);
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
    assert.match(asJson<ErrorBody>(await r.json()).error, /unknown adapter/);
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
    const j = asJson<RescanResponse>(await r.json());
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
    assert.deepEqual(asJson(await r.json()), { ok: true, adapters: [] });
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
    const swept = asJson<RescanResponse>(await r.json());
    assert.equal(swept.ok, true);
    // Present, not pinned — see the previous test's comment; this one's real point is the
    // ingested-file assertion below, not the exact set of every adapter shipped in this repo.
    assert.ok(swept.adapters.includes("tazuo"), JSON.stringify(swept.adapters));

    const deadline = Date.now() + 3000;
    let found = false;
    while (Date.now() < deadline && !found) {
      const inv = asJson<InventoryResponse>(await (await fetch(s2.url + "/api/inventory")).json());
      found = Boolean(inv.inventory.characters[fixture.character]);
      if (!found) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(found, "rescan folded the missed file into /api/inventory within 3s");
  } finally {
    await s2.close();
  }
});

// Minor 10: extractJsonText strips literal newlines before JSON.parse, but a \n ESCAPE survives that
// and parses into a real newline — which then went raw into a log line, letting a caller forge as many
// correctly-timestamped entries as it liked in the file the 500-handler's `ref` scheme relies on.
test("[fast] POST /api/import/paste cannot forge log lines through the document's own adapter.id", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-paste-logforge-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--port", "0", "--data", dir], {})));
  const log = join(dir, "logs", "server.log");
  try {
    const fixture = JSON.parse(readFileSync(join(HERE, "..", "adapters", "tazuo", "fixture.scan.json"), "utf8"));
    fixture.adapter.id = "tazuo\n2026-01-02T03:04:05.000Z watcher[tazuo] accepted a scan that never existed";
    const r = await fetch(s2.url + "/api/import/paste", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: JSON.stringify(fixture), adapter: "razor-enhanced" }),
    });
    // The scan schema now bounds adapter.id to an adapter-id shape (^[a-z0-9-]+$, at most 64), so a
    // newline-carrying id is refused before the route's own JSON.stringify'd log line is even reached
    // — that escaping stays as defence in depth, and the log must still carry no forged entry.
    assert.equal(r.status, 400, await r.clone().text());
    assert.match(asJson<ErrorBody>(await r.json()).error, /\/adapter\/id/);
    // The watcher logs its own lines here too, so this asserts the shape rather than a line count:
    // the forged text must never START a line, which is the only thing that makes it a log entry.
    const text = existsSync(log) ? readFileSync(log, "utf8") : "";
    assert.doesNotMatch(text, /^2026-01-02T03:04:05\.000Z/m, "the forged line never became a line");
  } finally {
    await s2.close();
  }
});

test("[fast] POST /api/import/rescan recreates a deleted inbox, and reports a sweep that could not run", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-rescan-gone-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--port", "0", "--data", dir], {})));
  try {
    rmSync(join(dir, "inbox"), { recursive: true });
    const r = await fetch(s2.url + "/api/import/rescan", { method: "POST", headers: JSON_HEADERS, body: "{}" });
    assert.equal(r.status, 200);
    assert.ok(asJson<RescanResponse>(await r.json()).adapters.includes("tazuo"));
    assert.ok(existsSync(join(dir, "inbox", "tazuo")), "the inbox is back");

    rmSync(join(dir, "inbox"), { recursive: true });
    writeFileSync(join(dir, "inbox"), "a file where the inbox folder should be");
    const bad = await fetch(s2.url + "/api/import/rescan", { method: "POST", headers: JSON_HEADERS, body: "{}" });
    assert.equal(bad.status, 503);
    const body = asJson<ErrorBody & { failed: string[] }>(await bad.json());
    assert.ok(body.failed.includes("tazuo"), JSON.stringify(body));
    assert.match(body.error, /tazuo/);
  } finally {
    await s2.close();
  }
});
