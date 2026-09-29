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
