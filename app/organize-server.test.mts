// organize-server.test.mts — the Organize routes (issue #11) against a real listening server on a temp data
// folder: GET/PUT /api/organize (organize.json), GET /api/organize/plan and POST /api/organize/trip with the
// results overlay (organize-state.json). Tags: [fast]. Run: node --test app/organize-server.test.mts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveConfig, ensureLayout } from "./config.mts";
import { startServer, type ServerHandle } from "./vault-server.mts";
import { candidateClientRoots } from "./installer.mts";
import { houseScan, type ThingSpec } from "./organize-fixture.mts";
import { emptyRuleQuery, emptyOrganizeConfig, type OrganizeConfig } from "./organize-config.mts";
import type { Plan } from "./organize.mts";

const FAKE_HOME = mkdtempSync(join(tmpdir(), "qm-home-"));
const A = 0x40000001, B = 0x40000002, PEARL = 0x40001001, RUBY = 0x40001002;
const CONFIG_DOC: OrganizeConfig = {
  ...emptyOrganizeConfig(),
  labels: { [String(A)]: { serial: A, name: "Reagents", origin: "manual" }, [String(B)]: { serial: B, name: "Gems", origin: "manual" } },
  rules: [
    { id: "reagents", name: "Reagents", match: { query: { ...emptyRuleQuery(), kind: ["reagent"] } }, targets: [A], origin: "manual" },
    { id: "gems", name: "Gems", match: { query: { ...emptyRuleQuery(), kind: ["gem"] } }, targets: [B], origin: "manual" },
  ],
};

async function serve(extra: ThingSpec[] = []): Promise<{ s: ServerHandle; dir: string }> {
  const dir = mkdtempSync(join(tmpdir(), "qm-organize-"));
  const config = ensureLayout(resolveConfig(["--port", "0", "--data", dir], {}));
  const scannedAt = new Date(Date.now() - 3600e3).toISOString();
  writeFileSync(join(dir, "scans", "house.json"), JSON.stringify(houseScan({ scannedAt,
    boxes: [{ serial: A, pos: { x: 100, y: 100, z: 0, facet: 1 } }, { serial: B, pos: { x: 104, y: 100, z: 0, facet: 1 } }],
    things: [{ serial: PEARL, name: "Black Pearl", in: B }, { serial: RUBY, name: "Ruby", in: A }, ...extra] })));
  const s = await startServer(config, {
    clientSearch: { home: FAKE_HOME, candidates: (a) => candidateClientRoots({ adapter: a.id, home: FAKE_HOME, platform: "linux", env: {}, adapterPlatform: a.platform }) },
    clientRunning: () => false,
  });
  return { s, dir };
}
const body = (method: string, value: unknown): RequestInit => ({ method, headers: { "content-type": "application/json" }, body: JSON.stringify(value) });
async function call<T = Record<string, unknown>>(s: ServerHandle, path: string, init?: RequestInit): Promise<{ status: number; body: T }> {
  const r = await fetch(s.url + path, init);
  return { status: r.status, body: (await r.json()) as T };
}

test("[fast] GET /api/organize starts empty; PUT saves a valid setup and GET reads it back", async () => {
  const { s, dir } = await serve();
  try {
    assert.deepEqual((await call(s, "/api/organize")).body, { ok: true, config: emptyOrganizeConfig(), problems: [] });
    const put = await call(s, "/api/organize", body("PUT", CONFIG_DOC));
    assert.equal(put.status, 200, JSON.stringify(put.body));
    assert.deepEqual(JSON.parse(readFileSync(join(dir, "organize.json"), "utf8")), CONFIG_DOC);
    assert.deepEqual((await call(s, "/api/organize")).body, { ok: true, config: CONFIG_DOC, problems: [] });
  } finally {
    await s.close();
  }
});

test("[fast] PUT /api/organize refuses a broken setup and a blacklisted label, and leaves the file alone", async () => {
  const { s, dir } = await serve();
  try {
    assert.equal((await call(s, "/api/organize", body("PUT", CONFIG_DOC))).status, 200);
    const withLoc = structuredClone(CONFIG_DOC);
    Object.assign(withLoc.rules[0]!.match.query, { loc: ["Chest"] });
    const bad = await call(s, "/api/organize", body("PUT", withLoc));
    assert.equal(bad.status, 400);
    assert.match(String(bad.body.error), /loc is not a rule filter/);
    assert.equal((await call(s, "/api/blacklist", body("POST", { serial: A, name: "Chest" }))).status, 200);
    const black = await call(s, "/api/organize", body("PUT", CONFIG_DOC));
    assert.equal(black.status, 400);
    assert.match(String(black.body.error), /blacklisted/);
    assert.deepEqual(JSON.parse(readFileSync(join(dir, "organize.json"), "utf8")), CONFIG_DOC);
  } finally {
    await s.close();
  }
});

test("[fast] a hand-edited organize.json is salvaged on read, and one that does not parse is moved aside", async () => {
  const { s, dir } = await serve();
  try {
    const edited = structuredClone(CONFIG_DOC);
    Object.assign(edited.rules[0]!.match.query, { loc: [] });
    writeFileSync(join(dir, "organize.json"), JSON.stringify(edited));
    const got = await call<{ config: OrganizeConfig; problems: string[] }>(s, "/api/organize");
    assert.deepEqual(got.body.config.rules.map((r) => r.id), ["gems"]);
    assert.match(got.body.problems.join("\n"), /rules\[0\]\.match\.query\.loc is not a rule filter.*rule dropped/);
    writeFileSync(join(dir, "organize.json"), "{oops");
    const broken = await call<{ config: OrganizeConfig; problems: string[] }>(s, "/api/organize");
    assert.deepEqual(broken.body.config, emptyOrganizeConfig());
    assert.match(broken.body.problems.join("\n"), /did not parse/);
    assert.equal(existsSync(join(dir, "organize.json.corrupt")), true);
    assert.equal(existsSync(join(dir, "organize.json")), false);
  } finally {
    await s.close();
  }
});

const queued = (dir: string): Record<string, unknown>[] => {
  const f = join(dir, "bridge", "tazuo", "queue.jsonl");
  return existsSync(f) ? readFileSync(f, "utf8").trim().split("\n").map((l) => JSON.parse(l) as Record<string, unknown>) : [];
};
const stateOf = (dir: string): { pending: { id: string }[]; moves: { serial: number; to: number | null }[] } => JSON.parse(readFileSync(join(dir, "organize-state.json"), "utf8"));

test("[fast] GET /api/organize/plan plans the moves; POST /api/organize/trip queues the current trip once", async () => {
  const { s, dir } = await serve();
  try {
    assert.equal((await call(s, "/api/organize", body("PUT", CONFIG_DOC))).status, 200);
    const plan = (await call<{ plan: Plan }>(s, "/api/organize/plan")).body.plan;
    assert.deepEqual(plan.moves.map((m) => [m.serial, m.to, m.trip]).sort((a, b) => a[0]! - b[0]!), [[PEARL, A, 1], [RUBY, B, 1]]);
    const stale = await call(s, "/api/organize/trip", body("POST", { index: 1, stamp: "00000000" }));
    assert.equal(stale.status, 409);
    assert.equal(stale.body.stamp, plan.stamp);
    assert.deepEqual(queued(dir), []);
    const ok = await call(s, "/api/organize/trip", body("POST", { index: 1, stamp: plan.stamp }));
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    const [line] = queued(dir);
    assert.deepEqual([line!.id, line!.action, line!.index, line!.stamp], [ok.body.id, "trip", 1, plan.stamp]);
    assert.deepEqual((line!.takes as { serial: number }[]).map((t) => t.serial).sort(), [PEARL, RUBY].sort());
    assert.deepEqual(stateOf(dir).pending.map((p) => p.id), [ok.body.id]);
    const again = await call(s, "/api/organize/trip", body("POST", { index: 1, stamp: plan.stamp }));
    assert.equal(again.status, 409);
    assert.match(String(again.body.error), /has not reported back/);
    assert.equal(queued(dir).length, 1);
  } finally {
    await s.close();
  }
});

test("[fast] a trip's reported steps go into the overlay, and the next plan no longer carries them", async () => {
  const { s, dir } = await serve();
  try {
    await call(s, "/api/organize", body("PUT", CONFIG_DOC));
    const plan = (await call<{ plan: Plan }>(s, "/api/organize/plan")).body.plan;
    const id = String((await call(s, "/api/organize/trip", body("POST", { index: 1, stamp: plan.stamp }))).body.id);
    const t = new Date().toISOString();
    writeFileSync(join(dir, "bridge", "tazuo", "status.json"), JSON.stringify({ alive: t, character: "Tester", current: null, counts: { done: 1, failed: 0 },
      results: { [id]: { ok: true, msg: "trip 1: 2 put away, 0 steps failed", t, partial: false, stopped: false, steps: [
        { op: "take", serial: RUBY, ok: true, msg: "took Ruby" }, { op: "take", serial: PEARL, ok: true, msg: "took Black Pearl" },
        { op: "put", serial: RUBY, ok: true, msg: "put Ruby away" }, { op: "put", serial: PEARL, ok: true, msg: "put Black Pearl away" }] } } }));
    const next = (await call<{ plan: Plan }>(s, "/api/organize/plan")).body.plan;
    assert.deepEqual(next.moves, []);
    assert.deepEqual(next.rules.map((r) => [r.ruleId, r.inPlace]), [["reagents", 1], ["gems", 1]]);
    assert.notEqual(next.stamp, plan.stamp);
    const st = stateOf(dir);
    assert.deepEqual(st.pending, []);
    assert.deepEqual(st.moves.map((m) => [m.serial, m.to]), [[PEARL, A], [RUBY, B]]);
    const gone = await call(s, "/api/organize/trip", body("POST", { index: 1, stamp: next.stamp }));
    assert.equal(gone.status, 404);
  } finally {
    await s.close();
  }
});

test("[fast] POST /api/organize/trip refuses a bad body, a trip that is not its site's next, and a client whose bridge cannot run trips", async () => {
  const garlic: ThingSpec[] = Array.from({ length: 21 }, (_, i) => ({ serial: 0x40002000 + i, name: "Garlic", in: B }));
  const { s, dir } = await serve(garlic);
  try {
    await call(s, "/api/organize", body("PUT", CONFIG_DOC));
    assert.equal((await call(s, "/api/organize/trip", body("POST", { index: 0, stamp: "x" }))).status, 400);
    const plan = (await call<{ plan: Plan }>(s, "/api/organize/plan")).body.plan;
    assert.deepEqual(plan.trips.map((t) => [t.index, t.site]), [[1, 0], [2, 0]]);
    const second = await call(s, "/api/organize/trip", body("POST", { index: 2, stamp: plan.stamp }));
    assert.equal(second.status, 409);
    assert.match(String(second.body.error), /run trip 1 first/);
    const web = await call(s, "/api/settings", body("PUT", { client: { adapter: "classicuo-web", scriptsDir: "" } }));
    assert.equal(web.status, 200, JSON.stringify(web.body));
    const noTrip = await call(s, "/api/organize/trip", body("POST", { index: 1, stamp: plan.stamp }));
    assert.equal(noTrip.status, 409);
    assert.match(String(noTrip.body.error), /cannot run Organize trips/);
    assert.deepEqual(queued(dir), []);
  } finally {
    await s.close();
  }
});

test("[fast] a trip whose bridge went quiet mid-run stops holding the queue once its heartbeat is stale", async () => {
  const { s, dir } = await serve();
  try {
    await call(s, "/api/organize", body("PUT", CONFIG_DOC));
    const plan = (await call<{ plan: Plan }>(s, "/api/organize/plan")).body.plan;
    const id = String((await call(s, "/api/organize/trip", body("POST", { index: 1, stamp: plan.stamp }))).body.id);
    const old = new Date(Date.now() - 600e3).toISOString();
    const st = JSON.parse(readFileSync(join(dir, "organize-state.json"), "utf8"));
    st.pending[0].queuedAt = old;
    writeFileSync(join(dir, "organize-state.json"), JSON.stringify(st));
    const status = (alive: string) => writeFileSync(join(dir, "bridge", "tazuo", "status.json"), JSON.stringify({ alive, character: "Tester", current: { id, action: "trip" }, results: {}, counts: {} }));
    status(new Date().toISOString());
    assert.match(String((await call(s, "/api/organize/trip", body("POST", { index: 1, stamp: plan.stamp }))).body.error), /has not reported back/);
    status(old);
    const retry = await call(s, "/api/organize/trip", body("POST", { index: 1, stamp: plan.stamp }));
    assert.equal(retry.status, 200, JSON.stringify(retry.body));
  } finally {
    await s.close();
  }
});

test("[fast] no trip runs off a salvaged organize.json, and a file that is not a version 1 setup is moved aside, not overwritten", async () => {
  const { s, dir } = await serve();
  try {
    const edited = structuredClone(CONFIG_DOC);
    Object.assign(edited.rules[0]!.match.query, { loc: [] });
    writeFileSync(join(dir, "organize.json"), JSON.stringify(edited));
    const plan = (await call<{ plan: Plan }>(s, "/api/organize/plan")).body.plan;
    const refused = await call(s, "/api/organize/trip", body("POST", { index: 1, stamp: plan.stamp }));
    assert.equal(refused.status, 409);
    assert.match(String(refused.body.error), /save the setup first/);
    assert.deepEqual(queued(dir), []);
    writeFileSync(join(dir, "organize.json"), JSON.stringify({ version: 2, future: true }));
    const got = await call<{ config: OrganizeConfig; problems: string[] }>(s, "/api/organize");
    assert.deepEqual(got.body.config, emptyOrganizeConfig());
    assert.match(got.body.problems.join("\n"), /not a version 1 Organize setup; it was moved to organize\.json\.corrupt/);
    assert.deepEqual(JSON.parse(readFileSync(join(dir, "organize.json.corrupt"), "utf8")), { version: 2, future: true });
  } finally {
    await s.close();
  }
});
