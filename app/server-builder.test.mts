// server-builder.test.mts — HTTP tests of the Suit Builder: `POST /api/optimize`, the saved runs and `GET|PUT /api/profiles`.
//
// `POST /api/optimize`: one running job per client (a second `POST` supersedes the first) and none between callers with no client id, the events route's `?client=` check, the server-wide ceiling, a job that throws logging its stack under the ref the client sees, an exact build proven by HiGHS with the saved run's score, the by-character form building the client's pools, keeping the page's settings snapshot, treating null fields as absent and refusing a bad settings type, the time budget capping restarts, resist cap overrides and weapon exclusions, malformed pools, current, profile or opts refused, only known meta fields saved, a character with no scans a 404, and Manual's hand-offs (issue #12: `pinned` keeping the placed pieces, no run saved, and with no character only pieces nobody wears); the job lifecycle (`jobTimings`, a parked core: a build past the retention kept, one past its budget cancelled, closing mid-build logging no failure); `GET|PUT|DELETE /api/runs/<id>` (a label type-checked, a truncated run a 404 that can still be deleted) and `POST /api/runs` saving a manual run with its checks; `POST /api/evaluate` answering what `evaluateSuit` computes from the same fixtures (the saved profile, a given profile with Divine Fury, a run's settings bringing their buffs, No character) and its checks; `PUT /api/profiles` (413 by bytes, 400 naming the schema path) and a truncated `profiles.json` moved aside and reseeded.
import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveConfig, ensureLayout } from "./config.mts";
import type { ServerHandle } from "./vault-server.mts";
import { startTestServer as startServer } from "./server-fixture.mts";
import { buildPools, setRules, toOptItem, type Item, type Profile } from "./vault-lib.mts";
import { characterProfile, specFromProfile, templateSpecFrom, type ProfilesV3 } from "./build-spec.mts";
import { manualBase, manualPlan } from "./buffs.mts";
import { evaluateSuit, type SuitEvaluation } from "./evaluate.mts";
import { DEFAULT_OPTIONAL_SLOTS } from "./mip.mts";
import { buildUi } from "../scripts/build-ui.mts";
import { buildSchemaTypes } from "../scripts/build-schema-types.mts";
import { asJson, HERE, UOALIVE, foldFixtures, rawReq, JSON_HEADERS, logText, type InventoryResponse, type ProfilesResponse, firstTemplate, type RulesResponse, type ItemsPageResponse, type OptimizeJobResponse, type ErrorBody } from "./server-routes-fixture.mts";

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

interface RunResponse {
  ok?: boolean;
  run: { result: { score: number; [key: string]: unknown }; [key: string]: unknown };
}

// ---------------------------------------------------------------------------------------------
// Task 4: localhost security — token, Host/Origin, profiles size cap + schema, one job per
// X-Client-Id, stack-free 500s. A second, dedicated server with --token "t0ken", so the bare `srv`
// above (used by every test above this line) stays token-free and untouched. Flat test()s, not a
// describe() block: the test runner (scripts/test-runner.mts) only tallies nesting-0 tests, so a
// describe() would fold all of these into a single pass/fail and drop them from the per-test count.
let tsrv: ServerHandle, tdir: string, tsrvStarted: Promise<unknown> = Promise.resolve();
before(() => {
  tdir = mkdtempSync(join(tmpdir(), "qm-sec-"));
  return (tsrvStarted = startServer(ensureLayout(resolveConfig(["--demo", "--port", "0", "--data", tdir, "--token", "t0ken"], {}))).then((s) => { tsrv = s; }));
});
after(async () => { await tsrvStarted; await tsrv?.close(); });
const authHost = () => ({ host: `localhost:${tsrv.port}`, authorization: "Bearer t0ken" });

test("[fast] PUT /api/profiles: an oversized multi-byte body is 413 (bytes, not JS string length); an invalid shape is 400 naming /characters; an older page's v2 body is 400", async () => {
  // 600,000 "é" characters: 600,000 UTF-16 code units (well under the 1e6 string-length a byte-blind
  // cap would have measured) but 1,200,000 UTF-8 bytes (over the 1e6 byte cap) — this is exactly the
  // post-review fix: readBody() must count Buffer bytes, not the JS string's .length, or a body like
  // this one sails past a 1 MB limit while measuring under it.
  const oversized = JSON.stringify({ schemaVersion: 2, characters: {}, templates: {}, pad: "é".repeat(600000) });
  const big = await rawReq(`${tsrv.url}/api/profiles`, {
    method: "PUT", headers: { ...authHost(), "content-type": "application/json" }, body: oversized,
  });
  assert.equal(big.status, 413);
  assert.equal(asJson(big.json()).error, "profiles too large");
  const bad = await rawReq(`${tsrv.url}/api/profiles`, {
    method: "PUT", headers: { ...authHost(), "content-type": "application/json" }, body: JSON.stringify({ schemaVersion: 3, templates: {}, characters: 5 }),
  });
  assert.equal(bad.status, 400);
  assert.match(asJson<ErrorBody>(bad.json()).error, /\/characters/);
  // a page loaded before the update sends the old shape, without the buffs that moved in: refused, never migrated
  const old = await rawReq(`${tsrv.url}/api/profiles`, {
    method: "PUT", headers: { ...authHost(), "content-type": "application/json" }, body: JSON.stringify({ schemaVersion: 2, templates: {}, characters: { A: { floors: {} } } }),
  });
  assert.equal(old.status, 400);
  assert.equal(asJson<ErrorBody>(old.json()).error, "profiles are saved in a newer shape now; reload the page and make the change again");
});

test("[fast] two POST /api/optimize from the same X-Client-Id: the second supersedes the first, whose status becomes cancelled", async () => {
  const inv = asJson<InventoryResponse>((await rawReq(`${tsrv.url}/api/inventory`, { headers: authHost() })).json());
  const profiles = asJson<ProfilesResponse>((await rawReq(`${tsrv.url}/api/profiles`, { headers: authHost() })).json());
  const rules = asJson<RulesResponse>((await rawReq(`${tsrv.url}/api/rules`, { headers: authHost() })).json());
  const character = Object.keys(inv.inventory.characters)[0]!;
  const { pools, current } = buildPools(foldFixtures(join(HERE, "fixtures")), character, {});
  const profile = { ...firstTemplate(profiles), caps: rules.rules.caps };
  const body = JSON.stringify({ pools, current, profile, opts: { exact: true, timeBudgetMs: 5000 } });
  const postHeaders = { ...authHost(), "content-type": "application/json", "x-client-id": "client-A" };
  const first = asJson<OptimizeJobResponse>((await rawReq(`${tsrv.url}/api/optimize`, { method: "POST", headers: postHeaders, body })).json());
  const second = asJson<OptimizeJobResponse>((await rawReq(`${tsrv.url}/api/optimize`, { method: "POST", headers: postHeaders, body })).json());
  assert.equal(second.superseded, first.id);
  const firstStatus = asJson<OptimizeJobResponse>((await rawReq(`${tsrv.url}/api/optimize/${first.id}/status`, { headers: authHost() })).json());
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
    const inv = asJson<InventoryResponse>(await (await fetch(s2.url + "/api/inventory")).json());
    const profiles = asJson<ProfilesResponse>(await (await fetch(s2.url + "/api/profiles")).json());
    const rules = asJson<RulesResponse>(await (await fetch(s2.url + "/api/rules")).json());
    const character = Object.keys(inv.inventory.characters)[0]!;
    const { pools, current } = buildPools(foldFixtures(join(HERE, "fixtures")), character, {});
    const profile = { ...firstTemplate(profiles), caps: rules.rules.caps };
    const r = await fetch(s2.url + "/api/optimize", {
      method: "POST", headers: { "content-type": "application/json" },   // deliberately no X-Client-Id
      body: JSON.stringify({ pools, current, profile, opts: { exact: true, timeBudgetMs: 5000 } }),
    });
    const { id } = asJson(await r.json());
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
    const inv = asJson<InventoryResponse>(await (await fetch(s2.url + "/api/inventory")).json());
    const profiles = asJson<ProfilesResponse>(await (await fetch(s2.url + "/api/profiles")).json());
    const rules = asJson<RulesResponse>(await (await fetch(s2.url + "/api/rules")).json());
    const character = Object.keys(inv.inventory.characters)[0]!;
    const { pools, current } = buildPools(foldFixtures(join(HERE, "fixtures")), character, {});
    const profile = { ...firstTemplate(profiles), caps: rules.rules.caps };
    const body = JSON.stringify({ pools, current, profile, opts: { exact: true, timeBudgetMs: 5000 } });
    const post = () => fetch(s2.url + "/api/optimize", { method: "POST", headers: { "content-type": "application/json" }, body }).then((x) => asJson(x.json()));
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
// a PACKRAT_CORE pointing at a module that throws on import, so the `await import(coreUrl)` at the top
// of optimize-worker.mts (outside its own try/catch) reaches the server as a worker 'error' event.
// This used to provoke the throw with `{pools: {helmet: [null]}}` — optimizer-core.mts's optCollectKeys
// reads `list[j].props` with no null check on `list[j]` itself — but POST /api/optimize now refuses a
// malformed pools entry with a 400 before any worker starts (phase-7 security review, Important 5),
// which is where that body should die. A broken core is the honest remaining way in, and unlike the old
// trigger it does not depend on optimizer-core.mts internals staying unguarded.
test("[fast] a job that throws inside the optimizer logs its stack with a ref; the client only sees the sanitized ref", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-"));
  const brokenCore = join(mkdtempSync(join(tmpdir(), "qm-core-")), "optimizer-core.mts");
  writeFileSync(brokenCore, 'throw new TypeError("optimizer core is broken");\n');
  const s2 = await startServer(ensureLayout(resolveConfig(["--demo", "--port", "0", "--data", dir], { PACKRAT_CORE: brokenCore })));
  try {
    const r = await fetch(s2.url + "/api/optimize", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ pools: {}, current: {}, profile: { caps: { physResist: 70 } }, opts: {} }),
    });
    const { id } = asJson<OptimizeJobResponse>(await r.json());
    let status: OptimizeJobResponse | undefined;
    // A deadline, not a fixed count: the worker thread can take over a second to start on a slow CI runner (#112).
    for (const end = Date.now() + 10_000; Date.now() < end;) {
      status = asJson<OptimizeJobResponse>(await (await fetch(s2.url + `/api/optimize/${id}/status`)).json());
      if (status.state !== "running") break;
      await new Promise((res) => setTimeout(res, 20));
    }
    assert.equal(status!.state, "error");
    assert.match(status!.error!, /^internal error \(ref [0-9a-f]{8}\)$/);
    assert.doesNotMatch(status!.error!, /at file:|\.mjs:\d+:\d+/, "no stack trace text reaches the client");
    const ref = status!.error!.match(/ref ([0-9a-f]{8})/)![1]!;
    const log = readFileSync(join(dir, "logs", "server.log"), "utf8");
    assert.ok(log.includes(ref), "the ref appears in the log file");
    assert.match(log, /TypeError.*optimizer core is broken/s, "the real stack trace reached the log file");
  } finally {
    await s2.close();
  }
});

// Task 2 (Phase 3): the worker now runs an exact build through app/exact-solver.mts (HiGHS), not the
// retired multi-thread branch-and-bound. On the small demo fixture this proves well inside a normal
// test timeout — poll /status until done, then confirm the saved run carries the identical score.
test("[fast] POST /api/optimize exact: the job finishes with solver \"highs\", proven, and the saved run carries the same score", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--demo", "--port", "0", "--data", dir], {})));
  try {
    const inv = asJson<InventoryResponse>(await (await fetch(s2.url + "/api/inventory")).json());
    const profiles = asJson<ProfilesResponse>(await (await fetch(s2.url + "/api/profiles")).json());
    const rules = asJson<RulesResponse>(await (await fetch(s2.url + "/api/rules")).json());
    const character = Object.keys(inv.inventory.characters)[0]!;
    const { pools, current } = buildPools(foldFixtures(join(HERE, "fixtures")), character, {});
    const profile = { ...firstTemplate(profiles), caps: rules.rules.caps };
    const r = await fetch(s2.url + "/api/optimize", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ pools, current, profile, opts: { exact: true, timeBudgetMs: 20000, restarts: 50, seed: 2026 } }),
    });
    const { id } = asJson<OptimizeJobResponse>(await r.json());
    let status: OptimizeJobResponse | undefined;
    for (let i = 0; i < 300; i++) {
      status = asJson<OptimizeJobResponse>(await (await fetch(s2.url + `/api/optimize/${id}/status`)).json());
      if (status.state !== "running") break;
      await new Promise((res) => setTimeout(res, 100));
    }
    assert.equal(status!.state, "done", JSON.stringify(status));
    assert.equal(status!.result!.solver, "highs");
    assert.equal(status!.result!.proven, true);
    assert.ok(status!.runId);
    const run = asJson<RunResponse>(await (await fetch(s2.url + `/api/runs/${status!.runId}`)).json());
    assert.equal(run.run.result.score, status!.result!.score);
  } finally {
    await s2.close();
  }
});

test("[fast] POST /api/optimize answers the unreachable floors before the search, and the result and its saved run carry them, on both solver paths (issue #217)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--demo", "--port", "0", "--data", dir], {})));
  try {
    const inv = asJson<InventoryResponse>(await (await fetch(s2.url + "/api/inventory")).json());
    const profiles = asJson<ProfilesResponse>(await (await fetch(s2.url + "/api/profiles")).json());
    const rules = asJson<RulesResponse>(await (await fetch(s2.url + "/api/rules")).json());
    const character = Object.keys(inv.inventory.characters)[0]!;
    const { pools, current } = buildPools(foldFixtures(join(HERE, "fixtures")), character, {});
    const tpl = firstTemplate(profiles);
    const profile = { ...tpl, caps: rules.rules.caps, floors: { ...tpl.floors, luck: 100000 }, hardFloors: ["luck"] };
    for (const exact of [true, false]) {
      const r = await fetch(s2.url + "/api/optimize", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ pools, current, profile, opts: { exact, timeBudgetMs: 3000, restarts: 5, seed: 2026 } }) });
      const start = asJson<OptimizeJobResponse & { diagnostics: Array<{ code: string; property: string; values: Record<string, number> }> }>(await r.json());
      const luck = start.diagnostics.find((d) => d.property === "luck");
      assert.equal(luck?.code, "floor_unreachable", JSON.stringify(start.diagnostics));
      assert.equal(luck!.values.floor, 100000);
      let status: OptimizeJobResponse | undefined;
      for (let i = 0; i < 300; i++) {
        status = asJson<OptimizeJobResponse>(await (await fetch(s2.url + `/api/optimize/${start.id}/status`)).json());
        if (status.state !== "running") break;
        await new Promise((res) => setTimeout(res, 100));
      }
      assert.equal(status!.state, "done", JSON.stringify(status));
      const diags = (status!.result as unknown as { diagnostics: unknown[] }).diagnostics;
      assert.deepEqual(diags.find((d) => (d as { property: string }).property === "luck"), luck, `exact ${exact}: the result repeats the pre-build diagnostic`);
      const run = asJson<RunResponse>(await (await fetch(s2.url + `/api/runs/${status!.runId}`)).json());
      assert.deepEqual((run.run.result as unknown as { diagnostics: unknown[] }).diagnostics, diags, "the saved run keeps them");
    }
  } finally {
    await s2.close();
  }
});

test("[fast] /api/optimize by character builds the same pools as the client did", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--demo", "--port", "0", "--data", dir], {})));
  try {
    const invFull = asJson<InventoryResponse>(await (await fetch(s2.url + "/api/inventory")).json());
    const profiles = asJson<ProfilesResponse>(await (await fetch(s2.url + "/api/profiles")).json());
    const rules = asJson<RulesResponse>(await (await fetch(s2.url + "/api/rules")).json());
    const character = Object.keys(invFull.inventory.characters)[0]!;
    const profile = { ...firstTemplate(profiles), caps: rules.rules.caps };
    // The full item map used to come straight off /api/inventory; since Task 5 removed it from the
    // wire, fold the same demo fixtures the server folds (foldFixtures above) to get an equivalent
    // local inventory for this "does the server build what the client used to build" comparison.
    const localInv = foldFixtures(join(HERE, "fixtures"));
    const { pools, current } = buildPools(localInv, character, {});
    const localPoolSize = Object.values(pools).reduce((a, v) => a + (v || []).length, 0);

    // 1) the OLD body form — start it and wait for it to finish so it lands as a saved, reusable run.
    // opts.optionalSlots must match what the by-character form derives server-side (every
    // DEFAULT_OPTIONAL_SLOT, since settings:{} means lockedSlots:[]) or the two requests' runKeys
    // (and so their cache behavior) would legitimately differ.
    const oldOpts = { exact: false, optionalSlots: DEFAULT_OPTIONAL_SLOTS };
    const r1 = await fetch(s2.url + "/api/optimize", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ pools, current, profile, opts: oldOpts }),
    });
    const j1 = asJson<OptimizeJobResponse>(await r1.json());
    assert.equal(r1.status, 200, JSON.stringify(j1));
    assert.equal(j1.poolSize, localPoolSize);
    assert.deepEqual(j1.skipped, {}, "the old body form reports no skipped counts (it never called buildPools)");
    assert.deepEqual(j1.blocked, []);
    let status: OptimizeJobResponse = j1;
    for (let i = 0; i < 100 && status.state !== "done"; i++) {
      await new Promise((res) => setTimeout(res, 20));
      status = asJson<OptimizeJobResponse>(await (await fetch(s2.url + `/api/optimize/${j1.id}/status`)).json());
    }
    assert.equal(status.state, "done", JSON.stringify(status));

    // 2) the by-character form must build the identical pools/current server-side and hit the run
    // the old form just saved.
    const r2 = await fetch(s2.url + "/api/optimize", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ character, settings: {}, profile, opts: { exact: false } }),
    });
    const j2 = asJson(await r2.json());
    assert.equal(r2.status, 200, JSON.stringify(j2));
    assert.equal(j2.poolSize, localPoolSize);
    assert.deepEqual(j2.current, current);
    assert.equal(j2.cached, true, JSON.stringify(j2));
  } finally {
    await s2.close();
  }
});

test("[fast] /api/optimize by character with a bad settings type is 400", async () => {
  const inv = asJson<InventoryResponse>(await (await get("/api/inventory")).json());
  const profiles = asJson<ProfilesResponse>(await (await get("/api/profiles")).json());
  const rules = asJson<RulesResponse>(await (await get("/api/rules")).json());
  const character = Object.keys(inv.inventory.characters)[0]!;
  const profile = { ...firstTemplate(profiles), caps: rules.rules.caps };
  const r = await fetch(srv.url + "/api/optimize", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ character, settings: { excludeTags: "cursed" }, profile, opts: {} }),
  });
  assert.equal(r.status, 400);
  assert.match(asJson<ErrorBody>(await r.json()).error, /excludeTags/);
});

// The by-character form builds its pools from `settings`, but a saved run must still remember the page's
// whole settings snapshot (meta.settings: floors, weights, race, the search knobs): the Saved runs drawer
// labels, badges, compares and re-applies runs from it. The route used to replace meta.settings with the
// pool settings alone, so every run came back with no floors or weights.
test("[fast] /api/optimize by character: the saved run keeps the page's settings snapshot, with the pool settings it ran on", async () => {
  const inv = asJson<InventoryResponse>(await (await get("/api/inventory")).json());
  const profiles = asJson<ProfilesResponse>(await (await get("/api/profiles")).json());
  const rules = asJson<RulesResponse>(await (await get("/api/rules")).json());
  const character = Object.keys(inv.inventory.characters)[0]!;
  const profile = { ...firstTemplate(profiles), caps: rules.rules.caps, floors: { hci: 3 } };
  const snapshot = { floors: { hci: 3 }, weights: { dci: 2 }, race: "elf", restarts: 7, strLimit: 999 };
  const r = await fetch(srv.url + "/api/optimize", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ character, settings: { strLimit: 120 }, profile, opts: { exact: false, restarts: 7 }, meta: { character, settings: snapshot } }),
  });
  const j = asJson<OptimizeJobResponse>(await r.json());
  assert.equal(r.status, 200, JSON.stringify(j));
  let status: OptimizeJobResponse = j;
  for (let i = 0; i < 200 && status.state !== "done" && !j.cached; i++) {
    await new Promise((res) => setTimeout(res, 20));
    status = asJson<OptimizeJobResponse>(await (await fetch(srv.url + `/api/optimize/${j.id}/status`)).json());
  }
  const list = asJson<{ runs: Array<{ id: string; settings: Record<string, unknown> }> }>(await (await get(`/api/runs?character=${encodeURIComponent(character)}`)).json());
  const run = list.runs.find((x) => x.id === (j.cached ? (j as { run?: { id: string } }).run!.id : j.id));
  assert.ok(run, "the run was saved");
  assert.deepEqual(run.settings.floors, { hci: 3 });
  assert.deepEqual(run.settings.weights, { dci: 2 });
  assert.equal(run.settings.race, "elf");
  assert.equal(run.settings.strLimit, 120, "the pool settings the run actually used win over the snapshot's");
});

// Issue #218: settings and meta.settings are held to the one rule a manual run's settings are (app/run-settings.mts).
test("[fast] /api/optimize: settings and meta.settings are checked like a manual run's, and the page's snapshot passes", async () => {
  const inv = asJson<InventoryResponse>(await (await get("/api/inventory")).json());
  const profiles = asJson<ProfilesResponse>(await (await get("/api/profiles")).json());
  const rules = asJson<RulesResponse>(await (await get("/api/rules")).json());
  const character = Object.keys(inv.inventory.characters)[0]!;
  const profile = { ...firstTemplate(profiles), caps: rules.rules.caps };
  const post = (settings: unknown, metaSettings: unknown): Promise<Response> => fetch(srv.url + "/api/optimize", {
    method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ character, settings, profile, opts: { exact: false, restarts: 1 }, meta: { character, settings: metaSettings } }),
  });
  const pool = { allowOthersWorn: false, strLimit: 110, excludeTags: [], excludeRoots: [], allowGargoyle: false, medOnly: false, excludeWeapons: [], ubwsAnyWeapon: true, excludeSkills: [], lockedSlots: [] };
  // ui/runs.mts settingsSnapshot's shape, exact search off with junk left in its disabled fields
  const snapshot = { ...pool, floors: { hci: 3 }, softFloors: [], weights: { dci: 2 }, restarts: 1, exact: false, budgetMs: 99999000, altCount: 500, altTol: -3, race: "elf", resistCaps: {} };
  const ok = await post(pool, snapshot);
  const body = asJson<OptimizeJobResponse>(await ok.json());
  assert.equal(ok.status, 200, JSON.stringify(body));
  if (body.id) await fetch(srv.url + `/api/optimize/${body.id}/cancel`, { method: "POST" });
  const badPool = await post({ ...pool, excludeTags: [5] }, snapshot);
  assert.equal(badPool.status, 400);
  assert.equal(asJson<ErrorBody>(await badPool.json()).error, "settings.excludeTags must be a list of names");
  const badMeta = await post(pool, { ...snapshot, race: "orc" });
  assert.equal(badMeta.status, 400);
  assert.equal(asJson<ErrorBody>(await badMeta.json()).error, "meta.settings.race must be human, elf or gargoyle");
});

// Issue #28: the heuristic-only path ran every requested restart whatever the time budget said.
test("[fast] /api/optimize heuristic-only: the time budget caps the random restarts", async () => {
  const inv = asJson<InventoryResponse>(await (await get("/api/inventory")).json());
  const profiles = asJson<ProfilesResponse>(await (await get("/api/profiles")).json());
  const rules = asJson<RulesResponse>(await (await get("/api/rules")).json());
  const character = Object.keys(inv.inventory.characters)[0]!;
  const profile = { ...firstTemplate(profiles), caps: rules.rules.caps };
  const j = asJson<OptimizeJobResponse>(await (await fetch(srv.url + "/api/optimize", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ character, settings: {}, profile, opts: { exact: false, restarts: 10000, timeBudgetMs: 0 } }),
  })).json());
  let status: OptimizeJobResponse = j;
  for (let i = 0; i < 500 && status.state !== "done"; i++) {
    await new Promise((res) => setTimeout(res, 20));
    status = asJson<OptimizeJobResponse>(await (await fetch(srv.url + `/api/optimize/${j.id}/status`)).json());
  }
  assert.equal(status.state, "done", JSON.stringify(status));
  // Every restart is a local search of at least one evaluation, so running them all would pass 10000.
  assert.ok((status.result as { evaluations: number }).evaluations < 10000, "a zero budget runs no random restarts, however many were asked for");
});

// Resist cap overrides (issue #44) persist with a profile or template and with each saved run, and the server
// holds them to one rule everywhere: the five resist keys only, whole numbers from 0 to 150.
test("[fast] resist cap overrides: profiles and saved runs keep them, and a bad one is refused with 400", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--demo", "--port", "0", "--data", dir], {})));
  const put = (body: unknown): Promise<Response> => fetch(s2.url + "/api/profiles", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  try {
    const got = asJson<ProfilesResponse>(await (await fetch(s2.url + "/api/profiles")).json()), profiles = got.profiles, tpl = firstTemplate(got);
    const character = Object.keys(asJson<InventoryResponse>(await (await fetch(s2.url + "/api/inventory")).json()).inventory.characters)[0]!;
    const withCaps = (resistCaps: unknown) => ({ ...specFromProfile(tpl), intent: { ...specFromProfile(tpl).intent, resistCaps } });
    const good = { ...profiles, characters: { ...profiles.characters, [character]: { template: "builtin:melee", race: "human", spec: withCaps({ fireResist: 95 }) } },
      templates: { ...profiles.templates, reaper: { spec: templateSpecFrom({ ...tpl, resistCaps: { fireResist: 95, coldResist: 60 } }) } } };
    assert.equal((await put(good)).status, 200);
    const back = asJson<ProfilesResponse>(await (await fetch(s2.url + "/api/profiles")).json()).profiles;
    assert.deepEqual(back.characters[character]!.spec.intent.resistCaps, { fireResist: 95 });
    assert.deepEqual(back.templates.reaper!.spec.intent.resistCaps, { fireResist: 95, coldResist: 60 });
    for (const [where, caps, path] of [["characters", { fireResist: 95.5 }, /\/characters\/.+\/spec\/intent\/resistCaps\/fireResist/], ["characters", { fireResist: 151 }, /resistCaps\/fireResist/],
      ["templates", { luck: 5 }, /\/templates\/reaper\/spec\/intent\/resistCaps/], ["templates", "95", /\/templates\/reaper\/spec\/intent\/resistCaps/]] as const) {
      const bad = where === "characters" ? { ...good, characters: { [character]: { spec: withCaps(caps) } } } : { ...good, templates: { reaper: { spec: withCaps(caps) } } };
      const r = await put(bad);
      assert.equal(r.status, 400, `${where} ${JSON.stringify(caps)}`);
      assert.match(asJson<ErrorBody>(await r.json()).error, path);
    }

    // A build's settings snapshot carries the caps into its saved run; a bad one is refused before anything runs.
    const rules = asJson<RulesResponse>(await (await fetch(s2.url + "/api/rules")).json());
    const profile = { ...tpl, caps: { ...rules.rules.caps, fireResist: 95 } };
    const post = (settings: Record<string, unknown>, snapshot: Record<string, unknown>): Promise<Response> => fetch(s2.url + "/api/optimize", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ character, settings, profile, opts: { exact: false, restarts: 3 }, meta: { character, settings: snapshot } }) });
    for (const [settings, snapshot, msg] of [[{}, { resistCaps: { fireResist: -1 } }, /meta\.settings\.resistCaps\.fireResist must be a whole number from 0 to 150/],
      [{}, { resistCaps: [95] }, /meta\.settings\.resistCaps must be an object/], [{ resistCaps: { hci: 5 } }, {}, /settings\.resistCaps\.hci is not a resist/],
      // and the buffs it was planned with (issue #12): known, one form at most, numbers in range
      [{}, { buffs: { on: ["wraithForm", "lichForm"], skills: {} } }, /meta\.settings\.buffs must list known buffs/], [{}, { buffs: { on: ["nope"], skills: {} } }, /meta\.settings\.buffs/],
      [{}, { buffs: { on: ["divineFury"], skills: { Chivalry: 999 } } }, /meta\.settings\.buffs/], [{}, { buffs: "divineFury" }, /meta\.settings\.buffs/]] as const) {
      const r = await post(settings, snapshot);
      assert.equal(r.status, 400, JSON.stringify(snapshot));
      assert.match(asJson<ErrorBody>(await r.json()).error, msg);
    }
    const r = await post({}, { race: "human", resistCaps: { fireResist: 95 }, buffs: { on: ["divineFury"], skills: { Chivalry: 105 } } });
    const j = asJson<OptimizeJobResponse>(await r.json());
    assert.equal(r.status, 200, JSON.stringify(j));
    let status: OptimizeJobResponse = j;
    for (let i = 0; i < 200 && status.state !== "done" && !j.cached; i++) {
      await new Promise((res) => setTimeout(res, 20));
      status = asJson<OptimizeJobResponse>(await (await fetch(s2.url + `/api/optimize/${j.id}/status`)).json());
    }
    const run = asJson<{ run: { settings: Record<string, unknown> } }>(await (await fetch(s2.url + `/api/runs/${j.id}`)).json()).run;
    assert.deepEqual(run.settings.resistCaps, { fireResist: 95 }, "reopening the run shows the caps it was built with");
    assert.deepEqual(run.settings.buffs, { on: ["divineFury"], skills: { Chivalry: 105 } }, "and the buffs");
  } finally {
    await s2.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

// Weapon exclusions (issue #45): a bad list is refused, a build leaves the excluded skills' weapons out, and a run
// saved with the old single weapon choice reopens with the exclusions it means.
test("[fast] weapon exclusions: a bad list is 400, excluded weapons stay out of the build, an old run reopens converted", async () => {
  const character = Object.keys(asJson<InventoryResponse>(await (await get("/api/inventory")).json()).inventory.characters)[0]!;
  const profiles = asJson<ProfilesResponse>(await (await get("/api/profiles")).json());
  const rules = asJson<RulesResponse>(await (await get("/api/rules")).json());
  const profile = { ...firstTemplate(profiles), caps: rules.rules.caps };
  const post = (settings: Record<string, unknown>): Promise<Response> => fetch(srv.url + "/api/optimize", {
    method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ character, settings, profile, opts: { exact: false, restarts: 3 }, meta: { character, settings } }) });
  const bad = await post({ excludeWeapons: ["bows"] });
  assert.equal(bad.status, 400);
  assert.match(asJson<ErrorBody>(await bad.json()).error, /settings\.excludeWeapons\[0\] is not a weapon skill/);
  const badUbws = await post({ ubwsAnyWeapon: "yes" });
  assert.equal(badUbws.status, 400);
  assert.match(asJson<ErrorBody>(await badUbws.json()).error, /settings\.ubwsAnyWeapon must be a boolean/);

  const inv = foldFixtures(join(HERE, "fixtures"));
  const skillOf = (serial: number): string => String(inv.items[serial]?.skillReq || "").toLowerCase();
  const excluded = [...new Set(Object.values(inv.items).map((it) => skillOf(it.serial)).filter(Boolean))].slice(0, 2);
  const j = asJson<OptimizeJobResponse>(await (await post({ excludeWeapons: excluded })).json());
  assert.ok((j.skipped as Record<string, number>).weapon! > 0, JSON.stringify(j.skipped));
  let status: OptimizeJobResponse = j;
  for (let i = 0; i < 200 && status.state !== "done" && !j.cached; i++) {
    await new Promise((res) => setTimeout(res, 20));
    status = asJson<OptimizeJobResponse>(await (await fetch(srv.url + `/api/optimize/${j.id}/status`)).json());
  }
  const best = (status.result as { best: Record<string, { serial: number } | null> }).best;
  for (const slot of ["oneHanded", "twoHanded"]) if (best[slot]) assert.ok(!excluded.includes(skillOf(best[slot]!.serial)), `${slot} holds an excluded skill`);

  const dir = mkdtempSync(join(tmpdir(), "qm-weapons-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--demo", "--port", "0", "--data", dir], {})));
  try {
    const id = "0b5c1a4e-0000-4000-8000-000000000045";
    writeFileSync(join(dir, "runs", `${id}.json`), JSON.stringify({ id, character, settings: { weaponSkill: "archery" }, result: { method: "heuristic", best: {} } }));
    const run = asJson<{ run: { settings: Record<string, unknown> } }>(await (await fetch(s2.url + `/api/runs/${id}`)).json()).run;
    assert.deepEqual(run.settings, { excludeWeapons: ["swordsmanship", "fencing", "mace fighting", "throwing"] });
  } finally {
    await s2.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

// Post-review fix: `null` in an optional settings field (strLimit/excludeTags/excludeRoots/
// excludeSkills/lockedSlots) passed the `!= null` validation gate untouched, but the destructuring
// defaults below it only fire on `undefined` — so `strLimit: null` reached buildPools as a literal
// null (silently wrong: strength null <= nothing, so every STR-gated item got excluded) and an array
// field's null threw once buildPools tried to .map/.includes it. A saved run's settings (re-posted
// from the runs drawer) can carry exactly this shape, so it had to be treated the same as "absent".
test("[fast] /api/optimize by character: null settings fields behave like absent fields (same poolSize as {}), not a type error", async () => {
  const inv = asJson<InventoryResponse>(await (await get("/api/inventory")).json());
  const profiles = asJson<ProfilesResponse>(await (await get("/api/profiles")).json());
  const rules = asJson<RulesResponse>(await (await get("/api/rules")).json());
  const character = Object.keys(inv.inventory.characters)[0]!;
  const profile = { ...firstTemplate(profiles), caps: rules.rules.caps };
  const post = async (settings: Record<string, unknown>): Promise<{ status: number; body: OptimizeJobResponse }> => {
    const r = await fetch(srv.url + "/api/optimize", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ character, settings, profile, opts: { exact: false } }),
    });
    return { status: r.status, body: asJson<OptimizeJobResponse>(await r.json()) };
  };
  const baseline = await post({});
  assert.equal(baseline.status, 200, JSON.stringify(baseline.body));
  const withNulls = await post({ strLimit: null, excludeTags: null, excludeRoots: null, excludeSkills: null, lockedSlots: null });
  assert.equal(withNulls.status, 200, JSON.stringify(withNulls.body));
  assert.equal(withNulls.body.poolSize, baseline.body.poolSize);
  assert.deepEqual(withNulls.body.current, baseline.body.current);
  for (const j of [baseline.body, withNulls.body]) if (j.id) await fetch(srv.url + `/api/optimize/${j.id}/cancel`, { method: "POST" });
});

// Important 5, first half: pools/current/profile/opts were unvalidated. {pools:{helmet:[null]}} started
// a real worker thread that died with a TypeError, and an unbounded opts.restarts/timeBudgetMs went
// straight into the search.
test("[fast] POST /api/optimize rejects a malformed pools/current/profile and an out-of-range opts instead of starting a job", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-optimize-validate-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--demo", "--port", "0", "--data", dir], {})));
  const profile = { caps: { physResist: 70 }, weights: {} };
  const post = (body: unknown): Promise<Response> => fetch(s2.url + "/api/optimize", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  try {
    const bad: unknown[] = [
      { pools: { helmet: [null] }, current: {}, profile, opts: {} },
      { pools: { helmet: [{ serial: 1, name: "x", slot: "helmet" }] }, current: {}, profile, opts: {} },   // no props
      { pools: { helmet: "not-an-array" }, current: {}, profile, opts: {} },
      { pools: [], current: {}, profile, opts: {} },
      { pools: {}, current: { helmet: 5 }, profile, opts: {} },
      { pools: {}, current: {}, profile: "not-an-object", opts: {} },
      { pools: {}, current: {}, profile, opts: { restarts: 1e12 } },
      { pools: {}, current: {}, profile, opts: { timeBudgetMs: Number.MAX_SAFE_INTEGER } },
      { pools: {}, current: {}, profile, opts: { timeBudgetMs: "10s" } },
      { pools: {}, current: {}, profile, opts: { exact: "yes" } },
      { pools: {}, current: {}, profile, opts: { spawnShell: true } },   // unknown option
      { pools: {}, current: {}, profile, opts: [] },
      { pools: {}, current: {}, profile, opts: {}, meta: [] },
      { pools: {}, current: {}, profile, opts: {}, character: 5 },
    ];
    for (const body of bad) {
      const r = await post(body);
      assert.equal(r.status, 400, JSON.stringify(body).slice(0, 120));
    }
    assert.equal(existsSync(join(dir, "runs")) ? readdirSync(join(dir, "runs")).length : 0, 0, "no job ever started, so no run was saved");
  } finally {
    await s2.close();
  }
});

// Important 5, second half: saveRun wrote `settings: meta.settings` verbatim, so a padded meta became a
// padded file in <data>/runs/ — which readRuns() re-parses on every POST /api/optimize and GET /api/runs.
test("[fast] POST /api/optimize persists only the known meta fields, so caller padding never reaches <data>/runs/", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-optimize-meta-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--demo", "--port", "0", "--data", dir], {})));
  try {
    const inv = foldFixtures(join(HERE, "fixtures"));
    const character = Object.keys(inv.characters)[0]!;
    const { pools, current } = buildPools(inv, character, {});
    const profile = { caps: { physResist: 70 }, weights: { physResist: 1 } };
    const huge = await fetch(s2.url + "/api/optimize", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ pools, current, profile, opts: {}, meta: { character, settings: { pad: "p".repeat(200_000) } } }),
    });
    assert.equal(huge.status, 400, "an oversized meta is refused outright");

    const ok = await fetch(s2.url + "/api/optimize", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ pools, current, profile, opts: {}, meta: { character, secret: "s".repeat(500), settings: { allowOthersWorn: true } } }),
    });
    assert.equal(ok.status, 200, await ok.clone().text());
    const { id } = asJson<OptimizeJobResponse>(await ok.json());
    const runFile = join(dir, "runs", `${id}.json`);
    for (let i = 0; i < 200 && !existsSync(runFile); i++) await new Promise((r) => setTimeout(r, 20));
    const saved = readFileSync(runFile, "utf8");
    assert.doesNotMatch(saved, /secret|sssss/, "an unknown meta field is not persisted");
    assert.match(saved, new RegExp(`"character":"${character}"`), "the known ones still are");
  } finally {
    await s2.close();
  }
});

// Important 5, third half: the supersede rule is per-X-Client-Id and is skipped entirely when the
// header is absent, so a header-less (or header-rotating) caller could start unbounded worker threads.
test("[fast] POST /api/optimize caps concurrent jobs server-wide, even for callers with no X-Client-Id", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-optimize-cap-"));
  // A PACKRAT_CORE whose optimizeSuit parks its worker thread for ever (Atomics.wait on a shared
  // buffer nothing ever notifies — no CPU, no timing assumption): every job started here stays
  // "running" until close() terminates it, which is exactly the state the cap counts. A real search
  // would make this test a race against how fast HiGHS happens to finish.
  const hangingCore = join(mkdtempSync(join(tmpdir(), "qm-core-hang-")), "optimizer-core.mts");
  writeFileSync(hangingCore, "export function optimizeSuit() {\n  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);\n  return {};\n}\n");
  const s2 = await startServer(ensureLayout(resolveConfig(["--demo", "--port", "0", "--data", dir], { PACKRAT_CORE: hangingCore })));
  try {
    const profile = { caps: { physResist: 70 }, weights: { physResist: 1 } };
    const body = JSON.stringify({ pools: {}, current: {}, profile, opts: {} });
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const r = await fetch(s2.url + "/api/optimize", { method: "POST", headers: { "content-type": "application/json" }, body });
      statuses.push(r.status);
      await r.arrayBuffer();
    }
    assert.equal(statuses[0], 200, "the first one still runs");
    assert.ok(statuses.includes(429), `a request past the cap must be refused, got ${statuses.join(",")}`);
    assert.equal(statuses[statuses.length - 1], 429, "and it stays refused while those jobs are alive");
  } finally {
    await s2.close();
  }
});

// Minor 13: String(label) throws on an object with a null prototype or a throwing toString — a 500
// plus a stack for what is a one-line type check.
test("[fast] PUT /api/runs/<id> type-checks label instead of String()-ing whatever arrives", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-run-label-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--demo", "--port", "0", "--data", dir], {})));
  try {
    mkdirSync(join(dir, "runs"), { recursive: true });
    writeFileSync(join(dir, "runs", "r1.json"), JSON.stringify({ id: "r1", character: "Kestrel", createdAt: new Date().toISOString(), result: { score: 1 } }));
    for (const bad of [{}, [], 5, true, null]) {
      const r = await fetch(s2.url + "/api/runs/r1", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ label: bad }) });
      assert.equal(r.status, 400, `label ${JSON.stringify(bad)} should be refused`);
    }
    const ok = await fetch(s2.url + "/api/runs/r1", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ label: "L".repeat(500) }) });
    assert.equal(ok.status, 200);
    assert.equal(JSON.parse(readFileSync(join(dir, "runs", "r1.json"), "utf8")).label.length, 120);
  } finally {
    await s2.close();
  }
});

// An optimizer core whose search parks its worker thread for `ms` (for ever when omitted), with no
// CPU spent and no dependence on how fast a real search happens to be.
function parkedCore(ms?: number): string {
  const core = join(mkdtempSync(join(tmpdir(), "qm-core-park-")), "optimizer-core.mts");
  writeFileSync(core, `export function optimizeSuit() {\n  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0${ms == null ? "" : `, ${ms}`});\n  return {};\n}\n`);
  return core;
}

const TINY_OPTIMIZE = { pools: {}, current: {}, profile: { caps: { physResist: 70 }, weights: { physResist: 1 } } };

async function pollJob(url: string, id: string, until: (s: OptimizeJobResponse & { status: number }) => boolean, timeoutMs = 5000): Promise<OptimizeJobResponse & { status: number }> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const r = await fetch(`${url}/api/optimize/${id}/status`);
    const s = { ...asJson<OptimizeJobResponse>(await r.json()), status: r.status };
    if (until(s) || Date.now() > deadline) return s;
    await new Promise((res) => setTimeout(res, 20));
  }
}

// profiles.json v3 (app/build-spec.mts): a v2 data folder is migrated on the first read, Automatic's buffs moving in from
// ui-prefs.json; GET carries the shard's built-in templates beside the file; PUT holds every spec to buildSpecError.
test("[fast] GET/PUT /api/profiles v3: a v2 folder migrates on the first read, built-in templates ride along, and a bad spec is 400 naming where", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-profiles-v3-")), gold = join(HERE, "fixtures", "profiles-v2");
  for (const n of ["profiles.json", "ui-prefs.json"]) writeFileSync(join(dir, n), readFileSync(join(gold, n)));
  const s2 = await startServer(ensureLayout(resolveConfig(["--demo", "--port", "0", "--data", dir], {})));
  const put = (body: unknown): Promise<Response> => fetch(s2.url + "/api/profiles", { method: "PUT", headers: JSON_HEADERS, body: JSON.stringify(body) });
  try {
    const got = asJson<ProfilesResponse>(await (await fetch(s2.url + "/api/profiles")).json());
    // the demo scans have none of the golden characters: Corwin, who had only buffs, gets no profile (its buffs stay in the ui-prefs backup)
    const { Corwin: _corwin, ...rest } = (JSON.parse(readFileSync(join(gold, "expected.profiles.json"), "utf8")) as ProfilesV3).characters;
    assert.deepEqual(got.profiles, { ...JSON.parse(readFileSync(join(gold, "expected.profiles.json"), "utf8")), characters: rest });
    assert.match(logText(dir), /characters\.Corwin: not scanned/);
    assert.deepEqual(Object.keys(got.builtinTemplates), ["melee", "caster", "archer", "tank"]);
    assert.deepEqual(Object.keys(got.profiles.templates), ["melee", "my caster"], "never copied into the file");
    assert.equal(asJson<{ prefs: Record<string, unknown> }>(await (await fetch(s2.url + "/api/ui-prefs")).json()).prefs.autoBuffs, undefined);
    const aldric = got.profiles.characters.Aldric!;
    const withBuffs = (buffs: unknown) => ({ ...got.profiles, characters: { ...got.profiles.characters, Aldric: { ...aldric, spec: { ...aldric.spec, buffs } } } });
    assert.equal((await put(withBuffs({ on: ["bless"], skills: { Chivalry: 100 } }))).status, 200);
    assert.deepEqual(asJson<ProfilesResponse>(await (await fetch(s2.url + "/api/profiles")).json()).profiles.characters.Aldric!.spec.buffs, { on: ["bless"], skills: { Chivalry: 100 } });
    for (const [body, msg] of [[withBuffs({ on: ["bless", "bless"], skills: {} }), /^characters\.Aldric\.spec\.buffs must list known buffs/],
      [withBuffs(undefined), /^characters\.Aldric\.spec\.buffs must list known buffs/],
      [{ ...got.profiles, templates: { t: { spec: { ...aldric.spec, pool: { ...aldric.spec.pool, strLimit: "mine" } } } } }, /^templates\.t\.spec\.pool\.strLimit must be "character"/],
      [{ ...got.profiles, characters: { A: { spec: { ...aldric.spec, extra: 1 } } } }, /\/characters\/A\/spec/]] as const) {
      const r = await put(body);
      assert.equal(r.status, 400, JSON.stringify(body).slice(0, 200));
      assert.match(asJson<ErrorBody>(await r.json()).error, msg);
    }
  } finally {
    await s2.close();
  }
});

test("[fast] a truncated profiles.json is moved aside and reseeded from the defaults, not a 500 on every read", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-badprofiles-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--demo", "--port", "0", "--data", dir], {})));
  try {
    writeFileSync(join(dir, "profiles.json"), '{"schemaVersion": 2, "templ');
    const r = await fetch(s2.url + "/api/profiles");
    assert.equal(r.status, 200);
    const defaults = JSON.parse(readFileSync(join(HERE, "data", "profiles.default.json"), "utf8")) as ProfilesV3;
    assert.deepEqual(asJson<ProfilesResponse>(await r.json()).profiles, defaults);
    assert.equal(readFileSync(join(dir, "profiles.json.corrupt"), "utf8"), '{"schemaVersion": 2, "templ', "the damaged file is kept for the player");
    assert.match(logText(dir), /profiles\.json is unreadable/);
    assert.equal((await fetch(s2.url + "/api/profiles")).status, 200, "and the next read is ordinary");
  } finally {
    await s2.close();
  }
});

test("[fast] a truncated saved run answers a clear 404, not a 500, and can still be deleted", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-badrun-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--demo", "--port", "0", "--data", dir], {})));
  try {
    const id = "0b5c1a4e-0000-4000-8000-000000000001";
    writeFileSync(join(dir, "runs", `${id}.json`), '{"id":"0b5c');
    const got = await fetch(s2.url + `/api/runs/${id}`);
    assert.equal(got.status, 404);
    assert.match(asJson<ErrorBody>(await got.json()).error, /damaged/);
    const put = await fetch(s2.url + `/api/runs/${id}`, { method: "PUT", headers: JSON_HEADERS, body: JSON.stringify({ label: "x" }) });
    assert.equal(put.status, 404);
    assert.equal((await fetch(s2.url + `/api/runs/${id}`, { method: "DELETE" })).status, 200);
    assert.equal(existsSync(join(dir, "runs", `${id}.json`)), false);
  } finally {
    await s2.close();
  }
});

test("[fast] a build that outlives the finished-job retention is not cancelled, and its result is kept for that long after it finishes", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-job-retention-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--demo", "--port", "0", "--data", dir], { PACKRAT_CORE: parkedCore(600) })),
    { jobTimings: { retentionMs: 300 } });
  try {
    const r = await fetch(s2.url + "/api/optimize", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ ...TINY_OPTIMIZE, opts: {} }) });
    const { id } = asJson<OptimizeJobResponse>(await r.json());
    const done = await pollJob(s2.url, id!, (s) => s.state !== "running");
    assert.equal(done.status, 200);
    assert.equal(done.state, "done", "a 600 ms build must not be cancelled by a 300 ms retention");
    await new Promise((res) => setTimeout(res, 100));
    assert.equal((await fetch(s2.url + `/api/optimize/${id}/status`)).status, 200, "still there shortly after it finished");
    const gone = await pollJob(s2.url, id!, (s) => s.status === 404, 3000);
    assert.equal(gone.status, 404, "dropped once the retention after finishing has passed");
  } finally {
    await s2.close();
  }
});

test("[fast] a build still running well past its own time budget is cancelled", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-job-ceiling-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--demo", "--port", "0", "--data", dir], { PACKRAT_CORE: parkedCore() })),
    { jobTimings: { runGraceMs: 100 } });
  try {
    const r = await fetch(s2.url + "/api/optimize", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ ...TINY_OPTIMIZE, opts: { timeBudgetMs: 100 } }) });
    const { id } = asJson<OptimizeJobResponse>(await r.json());
    const s = await pollJob(s2.url, id!, (x) => x.state !== "running", 3000);
    assert.equal(s.state, "cancelled");
  } finally {
    await s2.close();
  }
});

test("[fast] closing the server during a build logs no phantom job failure", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-close-job-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--demo", "--port", "0", "--data", dir], { PACKRAT_CORE: parkedCore() })));
  const r = await fetch(s2.url + "/api/optimize", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ ...TINY_OPTIMIZE, opts: {} }) });
  assert.equal(r.status, 200);
  await r.arrayBuffer();
  await new Promise((res) => setTimeout(res, 300));   // let the worker start and park
  await s2.close();
  await new Promise((res) => setTimeout(res, 300));   // the terminated worker's exit arrives after close()
  assert.doesNotMatch(logText(dir), /job /, "a quit mid-build is not an internal error");
});

test("[fast] POST /api/optimize for a character with no scans is a 404 and saves nothing", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-optimize-nobody-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--demo", "--port", "0", "--data", dir], {})));
  try {
    const r = await fetch(s2.url + "/api/optimize", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ character: "Nobody", profile: TINY_OPTIMIZE.profile }) });
    assert.equal(r.status, 404);
    assert.match(asJson<ErrorBody>(await r.json()).error, /Nobody/);
    assert.deepEqual(readdirSync(join(dir, "runs")), []);
  } finally {
    await s2.close();
  }
});

// ---------------------------------------------------------------------------------------------
// Issue #12, Manual's hand-offs: POST /api/optimize with `pinned` (Fill the rest automatically) and POST /api/runs (Save
// as run). Uses the module-level --demo `srv`.
async function demoGear(): Promise<{ character: string; worn: Item[]; loose: Item[] }> {
  const inv = asJson<InventoryResponse>(await (await get("/api/inventory")).json());
  const rows = asJson<ItemsPageResponse>(await (await get("/api/items?limit=2000")).json()).rows!.filter((it) => it.gear && it.slot);
  const character = Object.keys(inv.inventory.worn).find((c) => rows.some((it) => it.equippedBy === c))!;
  return { character, worn: rows.filter((it) => it.equippedBy === character), loose: rows.filter((it) => !it.equippedBy) };
}

const fillBody = (character: string | null, pinned: Record<string, number>, profile: Record<string, unknown> = { weights: { luck: 1, hci: 3, physResist: 2 }, caps: { physResist: 70 } }) =>
  ({ method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ character, settings: { lockedSlots: ["helmet"] }, profile, opts: { exact: true, timeBudgetMs: 20000 }, pinned }) });

test("[fast] /api/optimize with pinned: every placed piece stays, the rest is searched, and no run is saved (issue #12)", async () => {
  const { character, worn, loose } = await demoGear();
  const pin = loose.find((it) => it.slot !== "twoHanded" && it.slot !== "oneHanded") ?? worn[0]!;   // a piece nobody wears
  const pinned = { [pin.slot!]: pin.serial, feet: 1 };   // a slot the search has none for is accepted and left to the profile
  const before = asJson<{ runs: unknown[] }>(await (await get(`/api/runs?character=${encodeURIComponent(character)}`)).json()).runs.length;
  const r = await fetch(srv.url + "/api/optimize", fillBody(character, { [pin.slot!]: pin.serial }));
  const j = asJson<OptimizeJobResponse>(await r.json());
  assert.equal(r.status, 200, JSON.stringify(j));
  assert.deepEqual(Object.keys(j.current!), [pin.slot], "the placed pieces are the only current pieces");
  const done = await pollJob(srv.url, j.id!, (s) => s.state === "done", 20000);
  assert.equal(done.state, "done", JSON.stringify(done));
  const best = done.result!.best as Record<string, { serial: number } | null>;
  assert.equal(best[pin.slot!]!.serial, pin.serial);
  assert.equal(asJson<{ runs: unknown[] }>(await (await get(`/api/runs?character=${encodeURIComponent(character)}`)).json()).runs.length, before, "a fill is not saved");
  // a serial that is not that slot's piece in the scans is refused, and so is a slot that is not a gear slot
  const bad = await fetch(srv.url + "/api/optimize", fillBody(character, { ...pinned, [pin.slot!]: pin.serial + 999999 }));
  assert.equal(bad.status, 400);
  assert.equal((await fetch(srv.url + "/api/optimize", fillBody(character, { saddle: pin.serial }))).status, 400);
  // a piece that is not gear, and a two-handed weapon beside a one-hander, as /api/runs refuses them
  const all = asJson<ItemsPageResponse>(await (await get("/api/items?limit=2000")).json()).rows!;
  const notGear = all.find((it) => !it.gear);
  if (notGear) assert.equal((await fetch(srv.url + "/api/optimize", fillBody(character, { ring: notGear.serial }))).status, 400);
  const twoH = [...loose, ...worn].find((it) => it.slot === "twoHanded" && it.twoHanded), oneH = [...loose, ...worn].find((it) => it.slot === "oneHanded");
  if (twoH && oneH) assert.equal((await fetch(srv.url + "/api/optimize", fillBody(character, { twoHanded: twoH.serial, oneHanded: oneH.serial }))).status, 400);
});

test("[fast] /api/optimize with pinned and no character: the pool is the pieces nobody wears, plus a pinned worn one (issue #12)", async () => {
  const { worn } = await demoGear();
  const pin = worn.find((it) => it.slot !== "oneHanded" && it.slot !== "twoHanded")!;   // worn by someone: Manual allows it
  const r = await fetch(srv.url + "/api/optimize", fillBody(null, { [pin.slot!]: pin.serial }));
  const j = asJson<OptimizeJobResponse>(await r.json());
  assert.equal(r.status, 200, JSON.stringify(j));
  const done = await pollJob(srv.url, j.id!, (s) => s.state === "done", 20000);
  const rows = asJson<ItemsPageResponse>(await (await get("/api/items?limit=2000")).json()).rows!;
  const wearer = new Map(rows.map((it) => [it.serial, it.equippedBy]));
  for (const [slot, it] of Object.entries(done.result!.best as Record<string, { serial: number } | null>)) {
    if (!it) continue;
    if (slot === pin.slot) assert.equal(it.serial, pin.serial);
    else assert.ok(!wearer.get(it.serial), `${slot}: ${it.serial} is worn by ${wearer.get(it.serial)}`);
  }
});

test("[fast] POST /api/runs saves Manual's suit as a manual run: its shape, its key and the checks (issue #12)", async () => {
  const { character, worn, loose } = await demoGear();
  const piece = loose.find((it) => it.slot === "ring") ?? loose[0]!;
  const suit = { ...Object.fromEntries(worn.filter((it) => it.slot !== piece.slot).map((it) => [it.slot!, it.serial])), [piece.slot!]: piece.serial };
  const settings = { floors: { hci: 3 }, weights: { luck: 1 }, race: "human", buffs: { on: ["divineFury"], skills: { Chivalry: 100 } } };
  const post = (body: unknown) => fetch(srv.url + "/api/runs", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(body) });
  const r = await post({ character, suit, settings, inventoryStamp: "s1" });
  const j = asJson<{ ok: boolean; run: { id: string; method: string; changes: number; settings: Record<string, unknown> } }>(await r.json());
  assert.equal(r.status, 200, JSON.stringify(j));
  assert.equal(j.run.method, "manual");
  assert.equal(j.run.changes, 1);
  assert.deepEqual(j.run.settings.floors, { hci: 3 });
  const full = asJson<{ run: { key: string; inventoryStamp: string; result: { method: string; score?: number; best: Record<string, { serial: number } | null>; perSlotChanges: Array<{ slot: string; toSerial: number }> } } }>(await (await get(`/api/runs/${j.run.id}`)).json()).run;
  assert.match(full.key, /^manual:[0-9a-f]{40}$/);
  assert.equal(full.inventoryStamp, "s1");
  assert.equal(full.result.score, undefined, "no score: nothing searched for it");
  assert.equal(full.result.best[piece.slot!]!.serial, piece.serial);
  assert.ok(Object.hasOwn(full.result.best, "feet") && Object.hasOwn(full.result.best, "earrings"), "every gear slot");
  assert.deepEqual(full.result.perSlotChanges.map((c) => [c.slot, c.toSerial]), [[piece.slot, piece.serial]]);
  // the checks
  assert.equal((await post({ character: "Nobody", suit, settings })).status, 404);
  assert.equal((await post({ character, suit: {}, settings })).status, 400);
  assert.equal((await post({ character, suit: { [piece.slot!]: piece.serial + 999999 }, settings })).status, 400);
  assert.equal((await post({ character, suit, settings: { buffs: { on: ["noSuchBuff"], skills: {} } } })).status, 400);
  assert.equal((await post({ character, suit, settings: { resistCaps: { fireResist: 900 } } })).status, 400);
  // the whole snapshot is checked: an absurd floor, a weight that is not a number, a __proto__ key, an unknown field
  for (const bad of ['{"floors":{"physResist":1e308}}', '{"weights":{"a":null}}', '{"floors":{"__proto__":5}}', '{"race":"orc"}', '{"lockedSlots":"ring"}', '{"strLimit":-1}', '{"restarts":0.5}', '{"restarts":20000}', '{"altCount":101}', '{"altTol":-1}', '{"budgetMs":1e12}', '{"whatever":1}']) {
    const r = await fetch(srv.url + "/api/runs", { method: "POST", headers: JSON_HEADERS, body: `{"character":${JSON.stringify(character)},"suit":${JSON.stringify(suit)},"settings":${bad}}` });
    assert.equal(r.status, 400, bad);
  }
  const range = asJson<ErrorBody>(await (await post({ character, suit, settings: { restarts: 20000 } })).json()).error;
  assert.equal(range, "settings.restarts must be a whole number from 1 to 10000", "the error names the range");
  // every knob at the edge of the range the page allows is taken
  assert.equal((await post({ character, suit, settings: { strLimit: 1000, restarts: 10000, budgetMs: 3600000, altCount: 100, altTol: 12.5, exact: false } })).status, 200);
  const twoH = loose.find((it) => it.slot === "twoHanded" && it.twoHanded) ?? worn.find((it) => it.slot === "twoHanded" && it.twoHanded);
  const oneH = [...loose, ...worn].find((it) => it.slot === "oneHanded");
  if (twoH && oneH) assert.equal((await post({ character, suit: { twoHanded: twoH.serial, oneHanded: oneH.serial }, settings })).status, 400);
});

test("[fast] POST /api/evaluate answers evaluateSuit's evaluation of a hand-picked suit, planned as Manual plans it, and checks its body (issue #216)", async () => {
  const { character, worn, loose } = await demoGear();
  const piece = loose.find((it) => it.slot === "ring") ?? loose[0]!;
  const suit = { ...Object.fromEntries(worn.filter((it) => it.slot !== piece.slot).map((it) => [it.slot!, it.serial])), [piece.slot!]: piece.serial };
  const post = (body: unknown) => fetch(srv.url + "/api/evaluate", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(body) });
  const answer = async (body: unknown): Promise<SuitEvaluation> => {
    const r = await post(body), j = asJson<{ evaluation: SuitEvaluation }>(await r.json());
    assert.equal(r.status, 200, JSON.stringify(j));
    return j.evaluation;
  };
  // the same evaluation, computed here from the same fixtures and the saved profile
  const inv = foldFixtures(join(HERE, "fixtures")), c = inv.characters[character]!;
  const { profiles, builtinTemplates } = asJson<ProfilesResponse>(await (await get("/api/profiles")).json());
  const saved = characterProfile(profiles, character, builtinTemplates);
  const pieces = Object.fromEntries(Object.entries(suit).map(([slot, serial]) => [slot, inv.items[serial]!]));
  const wornNow = Object.values(inv.items).filter((it) => it.equippedBy === character);
  const local = (p: Profile, on: string[], skills: Record<string, number> = {}): SuitEvaluation => JSON.parse(JSON.stringify(evaluateSuit({ profile: manualBase(p, c), character: c,
    suit: Object.fromEntries(Object.entries(pieces).map(([slot, it]) => [slot, toOptItem(it)])), buffs: manualPlan(c, wornNow, pieces, p.race || "human", on, skills) }))) as SuitEvaluation;
  assert.deepEqual(await answer({ character, suit }), local(saved, []), "the saved profile, no buffs");
  const profile = { floors: { dci: 20, physResist: 60 }, weights: { hci: 1 }, race: "elf" as const };
  const df = await answer({ character, suit, profile, buffs: { on: ["divineFury"], skills: { Chivalry: 100, Karma: 0 } } });
  assert.deepEqual(df, local(profile, ["divineFury"], { Chivalry: 100, Karma: 0 }));
  assert.equal(df.effectiveTotals.dci, (df.gearTotals.dci || 0) - 20, "Divine Fury's DCI −20 in the effective totals, not the gear's");
  assert.deepEqual(await answer({ character, suit, profile: { ...profile, buffs: { on: ["divineFury"], skills: { Chivalry: 100, Karma: 0 } } } }), df, "a run's settings bring their buffs");
  const none = await answer({ character: null, suit: { [piece.slot!]: piece.serial } });
  assert.equal(none.planned.resistBonus, 0, "No character: raw item totals");
  // the checks
  assert.equal((await post({ character: "Nobody", suit })).status, 404);
  assert.equal((await post({ suit })).status, 400, "a character, or null");
  assert.equal((await post({ character, suit: { ring: "x" } })).status, 400);
  assert.equal((await post({ character, suit: { [piece.slot!]: piece.serial + 999999 } })).status, 400);
  assert.equal((await post({ character, suit, profile: { race: "orc" } })).status, 400);
  assert.equal((await post({ character, suit, profile: { whatever: 1 } })).status, 400);
  assert.equal(asJson<ErrorBody>(await (await post({ character, suit, buffs: { on: ["noSuchBuff"], skills: {} } })).json()).error, "body.buffs must list known buffs, each once and one form at most, with their numbers in range");
  const twoH = [...loose, ...worn].find((it) => it.slot === "twoHanded" && it.twoHanded), oneH = [...loose, ...worn].find((it) => it.slot === "oneHanded");
  if (twoH && oneH) assert.equal((await post({ character, suit: { twoHanded: twoH.serial, oneHanded: oneH.serial } })).status, 400);
});
