// server-settings.test.mts — HTTP tests of the settings, the shard's rules and retention.
//
// `GET /api/rules` and `GET|PUT /api/settings`: switching the shard (and the tag penalty the inventory reports with it), a fresh server folding with its shard's rules, `autoUpdateCheck` kept across a restart, a user rules file named differently than its id (listed, loaded, surviving a restart, overriding a builtin), a shard whose rules fail validation refused with `settings.json` unchanged, a shard with no rules file starting on the default with `fallback: true`, the shard type-checked before `loadRules`; `client` checked (a non-string or traversal adapter id, a scripts folder that is not absolute, non-UNC and a real client folder) and a paste client kept with no folder; a corrupt `settings.json` kept aside, a persisted client this install does not ship ignored for the run, and a settings write after a startup fallback keeping `settings.json`'s own shard and client (issue #18); retention (issue #28): `retention` refused out of bounds and merged field by field, `POST /api/retention/cleanup`'s dry run counting and its real run removing an old scan and the unnamed runs past the limit with the same inventory and a `server.log` line, a named and a symlinked run never removed, the prune on a restart, and a 409 under `--demo`.
import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, cpSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveConfig, ensureLayout } from "./config.mts";
import type { ServerHandle } from "./vault-server.mts";
import { startTestServer as startServer } from "./server-fixture.mts";
import { getRules, setRules } from "./vault-lib.mts";
import { buildUi } from "../scripts/build-ui.mts";
import { buildSchemaTypes } from "../scripts/build-schema-types.mts";
import type { RulesV1 } from "./schema/types.d.mts";
import { asJson, HERE, UOALIVE, JSON_HEADERS, type InventorySummary, type InventoryResponse, type RulesResponse, type SettingsResponse, type SetupResponse, type ItemsBySerialResponse, type ErrorBody } from "./server-routes-fixture.mts";

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

// Shard rules + settings (Task 2): GET /api/rules reports the current shard and every rules file
// listRules() finds; PUT /api/settings switches the shard (validated against that same list) and the
// next GET /api/rules reflects it; an unknown shard is rejected before anything is written.
test("[fast] GET /api/rules reports the current shard and at least the two builtin rules files", async () => {
  const j = asJson<RulesResponse>(await (await get("/api/rules")).json());
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
    assert.equal(asJson<SettingsResponse>(await put.json()).settings.shard, "generic-osi");
    const rules = asJson<RulesResponse>(await (await fetch(s2.url + "/api/rules")).json());
    assert.equal(rules.shard, "generic-osi");
    assert.equal(rules.rules.id, "generic-osi");
    const bad = await fetch(s2.url + "/api/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ shard: "nope" }) });
    assert.equal(bad.status, 400);
    // rejecting "nope" must not have overwritten the shard switch that already succeeded
    assert.equal((asJson<RulesResponse>(await (await fetch(s2.url + "/api/rules")).json())).shard, "generic-osi");
  } finally {
    await s2.close();
  }
});

test("[fast] GET /api/settings reads back the persisted shard", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--demo", "--port", "0", "--data", dir], {})));
  try {
    const before = asJson<SettingsResponse>(await (await fetch(s2.url + "/api/settings")).json());
    assert.equal(before.settings.shard, "uoalive");
    await fetch(s2.url + "/api/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ shard: "generic-osi" }) });
    const after = asJson<SettingsResponse>(await (await fetch(s2.url + "/api/settings")).json());
    assert.equal(after.settings.shard, "generic-osi");
    assert.equal(JSON.parse(readFileSync(join(dir, "settings.json"), "utf8")).shard, "generic-osi", "the switch is persisted to settings.json");
  } finally {
    await s2.close();
  }
});

// #218: the server imports vault-lib once, the module every other server module (organize, buffs, missing, the
// MCP tools) shares, and hands it the shard's rules at startup, with no page load or MCP call first.
test("[fast] a fresh server folds with its shard's rules before anything else has set them", async () => {
  setRules(null as unknown as RulesV1);
  const s2 = await startServer(ensureLayout(resolveConfig(["--demo", "--port", "0", "--data", mkdtempSync(join(tmpdir(), "qm-"))], {})));
  try {
    assert.equal(getRules().id, "uoalive");
    const inv = await fetch(s2.url + "/api/inventory");
    assert.equal(inv.status, 200);
    assert.ok(asJson<{ inventory: { itemCount: number } }>(await inv.json()).inventory.itemCount > 0);
  } finally {
    await s2.close();
  }
});

// A shard switch reaches the fold: the demo's Antique leggings weigh in at the new shard's tag unit.
test("[fast] PUT /api/settings switching the shard changes the tag penalty the inventory reports", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-"));
  mkdirSync(join(dir, "rules"), { recursive: true });
  writeFileSync(join(dir, "rules", "heavy.json"), JSON.stringify({ ...JSON.parse(validRulesFile("heavy", "Heavy tags")), tagUnits: { antique: 3 } }));
  const s2 = await startServer(ensureLayout(resolveConfig(["--demo", "--port", "0", "--data", dir], {})));
  const LEGGINGS = 1879834629;
  const penalty = async (): Promise<number | undefined> => asJson<ItemsBySerialResponse>(await (await fetch(`${s2.url}/api/items/by-serial?serials=${LEGGINGS}`)).json()).items[LEGGINGS]!.props.tagPenalty;
  try {
    assert.equal(await penalty(), 1.5);
    const put = await fetch(s2.url + "/api/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ shard: "heavy" }) });
    assert.equal(put.status, 200);
    assert.equal(await penalty(), 3);
  } finally {
    await s2.close();
  }
});

// Issue #67: the automatic update check is on unless the player turned it off, and only a boolean is kept.
test("[fast] PUT /api/settings keeps autoUpdateCheck (on by default) across a restart and refuses a non-boolean", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-autoupdate-"));
  const put = (url: string, body: unknown): Promise<Response> => fetch(url + "/api/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const s1 = await startServer(ensureLayout(resolveConfig(["--port", "0", "--data", dir], {})));
  try {
    assert.equal(asJson<SettingsResponse>(await (await fetch(s1.url + "/api/settings")).json()).settings.autoUpdateCheck, true, "on by default");
    assert.equal((await put(s1.url, { autoUpdateCheck: "no" })).status, 400);
    assert.equal(asJson<SettingsResponse>(await (await put(s1.url, { autoUpdateCheck: false })).json()).settings.autoUpdateCheck, false);
  } finally {
    await s1.close();
  }
  assert.equal(JSON.parse(readFileSync(join(dir, "settings.json"), "utf8")).autoUpdateCheck, false);
  const s2 = await startServer(ensureLayout(resolveConfig(["--port", "0", "--data", dir], {})));
  try {
    assert.equal(asJson<SettingsResponse>(await (await fetch(s2.url + "/api/settings")).json()).settings.autoUpdateCheck, false, "the choice survives a restart");
  } finally {
    await s2.close();
  }
});

const validRulesFile = (id: string, name: string): string => JSON.stringify({
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
    const listed = (asJson<RulesResponse>(await (await fetch(s2.url + "/api/rules")).json())).available;
    assert.ok(listed.some((r) => r.id === "myshard" && r.source === "user"), JSON.stringify(listed));
    const put = await fetch(s2.url + "/api/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ shard: "myshard" }) });
    assert.equal(put.status, 200, JSON.stringify(asJson<SettingsResponse>(await put.json())));
    const rules = asJson<RulesResponse>(await (await fetch(s2.url + "/api/rules")).json());
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
    const rules = asJson<RulesResponse>(await (await fetch(s3.url + "/api/rules")).json());
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
    assert.match(asJson<ErrorBody>(await put.json()).error, /badshard/);
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
    const rules = asJson<RulesResponse>(await (await fetch(s2.url + "/api/rules")).json());
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
    const rules = asJson<RulesResponse>(await (await fetch(s2.url + "/api/rules")).json());
    assert.equal(rules.rules.name, "UO Alive (mine)");
    assert.equal(rules.available.find((r) => r.id === "uoalive")!.source, "user");
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
    assert.match(asJson<ErrorBody>(await r.json()).error, /client/);
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
    assert.match(asJson<ErrorBody>(await r.json()).error, /adapter/);
    assert.equal((asJson<SettingsResponse>(await (await fetch(s2.url + "/api/settings")).json())).settings.client, undefined, "a rejected PUT must not save settings.client");
  } finally {
    await s2.close();
  }
});

// Important 3: PUT /api/settings type-checked client.scriptsDir as a string and persisted it, after
// which GET /api/setup read whatever it named on every render — a UNC path dialled out over SMB on
// win32, a directory holding a FIFO hung the whole single-threaded process, and neither recovered on
// restart because the value was on disk.
test("[fast] PUT /api/settings validates client.scriptsDir (absolute, non-UNC, a real client folder) and leaves settings.json alone when it doesn't", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-settings-scriptsdir-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--port", "0", "--data", dir], {})));
  try {
    const clientRoot = mkdtempSync(join(tmpdir(), "qm-settings-scriptsdir-client-"));
    for (const bad of [join(clientRoot, "no-such-folder"), "relative/path", "\\\\host\\share", "//host/share", 5]) {
      const r = await fetch(s2.url + "/api/settings", {
        method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ client: { adapter: "tazuo", scriptsDir: bad } }),
      });
      assert.equal(r.status, 400, `scriptsDir ${JSON.stringify(bad)} should be refused`);
      assert.match(asJson<ErrorBody>(await r.json()).error, /client/);
    }
    assert.equal(JSON.parse(readFileSync(join(dir, "settings.json"), "utf8")).client, undefined, "no rejected value reached settings.json");

    // a real folder is accepted, resolved to the nested form, and can be cleared again
    const legionDir = join(clientRoot, "TazUO", "LegionScripts");
    mkdirSync(legionDir, { recursive: true });
    const good = await fetch(s2.url + "/api/settings", {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ client: { adapter: "tazuo", scriptsDir: clientRoot } }),
    });
    assert.equal(good.status, 200);
    assert.deepEqual(asJson<SettingsResponse>(await good.json()).settings.client, { adapter: "tazuo", scriptsDir: legionDir });
    const cleared = await fetch(s2.url + "/api/settings", {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ client: null }),
    });
    assert.equal(cleared.status, 200);
    assert.equal(asJson<SettingsResponse>(await cleared.json()).settings.client, null);
  } finally {
    await s2.close();
  }
});

test("[fast] PUT /api/settings keeps a paste client (no scripts folder), and client: null still forgets it", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-settings-paste-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--port", "0", "--data", dir], {})));
  const put = (client: unknown): Promise<Response> => fetch(s2.url + "/api/settings", {
    method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ client }),
  });
  try {
    const kept = await put({ adapter: "classicuo-web", scriptsDir: "" });
    assert.equal(kept.status, 200);
    assert.deepEqual(asJson<SettingsResponse>(await kept.json()).settings.client, { adapter: "classicuo-web", scriptsDir: "" });
    assert.deepEqual(JSON.parse(readFileSync(join(dir, "settings.json"), "utf8")).client, { adapter: "classicuo-web", scriptsDir: "" });
    const cleared = await put(null);
    assert.equal(cleared.status, 200);
    assert.equal(asJson<SettingsResponse>(await cleared.json()).settings.client, null);
  } finally {
    await s2.close();
  }
});

test("[fast] PUT /api/settings type-checks shard before it reaches loadRules", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-settings-shardtype-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--port", "0", "--data", dir], {})));
  try {
    for (const bad of [5, {}, [], null, "x".repeat(200)]) {
      const r = await fetch(s2.url + "/api/settings", {
        method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ shard: bad }),
      });
      assert.equal(r.status, 400, `shard ${JSON.stringify(bad)} should be refused`);
    }
  } finally {
    await s2.close();
  }
});

// A settings.json that doesn't parse used to throw out of startServer — the app would not start at
// all (exit 2) over a file the player may have hand-edited. It now starts on defaults, keeps the
// unreadable file aside as settings.json.corrupt, and never overwrites an older one.
test("[fast] a corrupt settings.json is kept aside and the server starts on defaults", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-settings-corrupt-"));
  const config = ensureLayout(resolveConfig(["--demo", "--port", "0", "--data", dir], {}));
  writeFileSync(join(dir, "settings.json"), "{ this is not json");
  writeFileSync(join(dir, "settings.json.corrupt"), "an older corrupt file");
  const s2 = await startServer(config);
  try {
    const settings = asJson<SettingsResponse>(await (await fetch(s2.url + "/api/settings")).json());
    assert.equal(settings.settings.shard, "uoalive");
    assert.equal(readFileSync(join(dir, "settings.json.corrupt"), "utf8"), "an older corrupt file", "an older .corrupt is never overwritten");
    const aside = readdirSync(dir).filter((f) => /^settings\.json\.corrupt-\d+$/.test(f));
    assert.equal(aside.length, 1, JSON.stringify(readdirSync(dir)));
    assert.equal(readFileSync(join(dir, aside[0]!), "utf8"), "{ this is not json", "the unreadable file survives byte for byte");
    assert.equal(JSON.parse(readFileSync(join(dir, "settings.json"), "utf8")).shard, "uoalive", "defaults were written back");
  } finally {
    await s2.close();
  }
});

// bridgeAdapter() joins the persisted client's adapter id into the bridge queue/status paths, and
// PUT /api/settings refuses an unknown id — a hand-edited settings.json must not be a way round that.
test("[fast] a persisted client naming an adapter this install does not ship is ignored for the run, file untouched", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-settings-badadapter-"));
  const config = ensureLayout(resolveConfig(["--demo", "--port", "0", "--data", dir], {}));
  const onDisk = JSON.stringify({ schemaVersion: 1, shard: "uoalive", client: { adapter: "../../evil", scriptsDir: "/tmp" } }, null, 2) + "\n";
  writeFileSync(join(dir, "settings.json"), onDisk);
  const s2 = await startServer(config);
  try {
    const settings = asJson<SettingsResponse>(await (await fetch(s2.url + "/api/settings")).json());
    assert.equal(settings.settings.client ?? null, null);
    const setup = asJson<SetupResponse & { bridgeAdapter: string | null }>(await (await fetch(s2.url + "/api/setup")).json());
    assert.equal(setup.bridgeAdapter, "tazuo", "the bridge routes fall back to the default adapter, never the unvalidated id");
    assert.equal(readFileSync(join(dir, "settings.json"), "utf8"), onDisk, "settings.json on disk is left as it stands");
    assert.equal(existsSync(join(dir, "evil")), false);
  } finally {
    await s2.close();
  }
});

const readJson = (p: string): Record<string, unknown> => JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>;

test("[fast] a settings write after a startup shard fallback keeps the shard settings.json names", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-fallback-put-"));
  writeFileSync(join(dir, "settings.json"), JSON.stringify({ schemaVersion: 1, shard: "myshard" }, null, 2) + "\n");
  const s2 = await startServer(ensureLayout(resolveConfig(["--demo", "--port", "0", "--data", dir], {})));
  try {
    const r = await fetch(s2.url + "/api/settings", { method: "PUT", headers: JSON_HEADERS, body: JSON.stringify({ setupDone: true }) });
    assert.equal(r.status, 200);
    const onDisk = readJson(join(dir, "settings.json"));
    assert.equal(onDisk.shard, "myshard", "the in-memory fallback must never be written over the player's shard");
    assert.equal(onDisk.setupDone, true);
    const rules = asJson<RulesResponse>(await (await fetch(s2.url + "/api/rules")).json());
    assert.equal(rules.shard, "uoalive");
    assert.equal(rules.fallback, true, "still running on the fallback for this session");
  } finally {
    await s2.close();
  }
});

test("[fast] a settings write keeps a client whose adapter this install does not ship", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-client-put-"));
  const client = { adapter: "from-a-newer-version", scriptsDir: "/Users/example/Client/Scripts" };
  writeFileSync(join(dir, "settings.json"), JSON.stringify({ schemaVersion: 1, shard: "uoalive", client }, null, 2) + "\n");
  const s2 = await startServer(ensureLayout(resolveConfig(["--demo", "--port", "0", "--data", dir], {})));
  try {
    const got = asJson<SettingsResponse>(await (await fetch(s2.url + "/api/settings")).json());
    assert.equal(got.settings.client, null, "ignored for this run");
    const r = await fetch(s2.url + "/api/settings", { method: "PUT", headers: JSON_HEADERS, body: JSON.stringify({ setupDone: true }) });
    assert.equal(r.status, 200);
    assert.deepEqual(readJson(join(dir, "settings.json")).client, client, "settings.json keeps the client it named");
  } finally {
    await s2.close();
  }
});

// ---- retention (issue #28): old scans and saved runs pruned without changing the inventory ------------
// A data folder with an older scan of Dorran's (superseded by the demo one) and saved runs of one
// character: three plain ones, an older named one, and an older symlink to a file outside the folder.
const OLD_DORRAN = (() => { const d = JSON.parse(readFileSync(join(HERE, "fixtures", "demo-Dorran.json"), "utf8")); d.scannedAt = "2025-01-01T12:00:00"; return JSON.stringify(d); })();

function retentionData(settings: Record<string, unknown>): { dir: string; outside: string } {
  const dir = mkdtempSync(join(tmpdir(), "qm-retention-"));
  mkdirSync(join(dir, "scans"), { recursive: true });
  mkdirSync(join(dir, "runs"), { recursive: true });
  cpSync(join(HERE, "fixtures", "demo-Dorran.json"), join(dir, "scans", "demo-Dorran.json"));
  cpSync(join(HERE, "fixtures", "demo-Kestrel.json"), join(dir, "scans", "demo-Kestrel.json"));
  writeFileSync(join(dir, "scans", "old-Dorran.json"), OLD_DORRAN);
  const run = (id: string, createdAt: string, label = "") => JSON.stringify({ id, key: id, character: "Dorran", createdAt, label, settings: {}, result: null });
  for (const [i, day] of ["2026-09-20", "2026-09-21", "2026-09-22"].entries()) writeFileSync(join(dir, "runs", `r${i}.json`), run(`r${i}`, `${day}T10:00:00Z`));
  writeFileSync(join(dir, "runs", "named.json"), run("named", "2026-08-01T10:00:00Z", "Tank suit"));
  const outside = join(mkdtempSync(join(tmpdir(), "qm-retention-out-")), "linked.json");
  writeFileSync(outside, run("linked", "2026-09-01T10:00:00Z"));
  try { symlinkSync(outside, join(dir, "runs", "linked.json")); } catch { /* no symlinks here (Windows without the privilege): the rest still runs */ }
  writeFileSync(join(dir, "settings.json"), JSON.stringify({ schemaVersion: 1, shard: "uoalive", ...settings }));
  return { dir, outside };
}

const putJson = (url: string, method: string, body: unknown): Promise<Response> => fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

test("[fast] PUT /api/settings validates retention with its bounds and keeps the fields it did not name", async () => {
  const { dir } = retentionData({});
  const s2 = await startServer(ensureLayout(resolveConfig(["--port", "0", "--data", dir], {})));
  try {
    const got = asJson<{ settings: { retention: unknown } }>(await (await fetch(s2.url + "/api/settings")).json());
    assert.deepEqual(got.settings.retention, { keepAll: false, scanDays: 30, runsPerCharacter: 50 }, "defaults when settings.json has none");
    for (const bad of [{ scanDays: 0 }, { scanDays: 3651 }, { runsPerCharacter: 1.5 }, { keepAll: 1 }, { other: 1 }, [], "30"]) {
      const r = await putJson(s2.url + "/api/settings", "PUT", { retention: bad });
      assert.equal(r.status, 400, `${JSON.stringify(bad)} should be refused`);
    }
    assert.equal((await putJson(s2.url + "/api/settings", "PUT", { retention: { scanDays: 7 } })).status, 200);
    assert.equal((await putJson(s2.url + "/api/settings", "PUT", { retention: { keepAll: true } })).status, 200);
    assert.deepEqual(JSON.parse(readFileSync(join(dir, "settings.json"), "utf8")).retention, { keepAll: true, scanDays: 7, runsPerCharacter: 50 });
  } finally {
    await s2.close();
  }
});

test("[fast] POST /api/retention/cleanup counts first, then removes old scans and unnamed runs without changing the inventory; startup prunes too", async () => {
  const { dir, outside } = retentionData({ retention: { keepAll: true } });   // nothing pruned at startup
  let s2 = await startServer(ensureLayout(resolveConfig(["--port", "0", "--data", dir], {})));
  const cleanup = async (dryRun: boolean) => asJson<{ ok: boolean; scans: number; runs: number; refused: boolean }>(await (await putJson(s2.url + "/api/retention/cleanup", "POST", { dryRun })).json());
  // Everything but the list of scans folded, which is what pruning shortens.
  const inventory = async () => { const { scans: _scans, ...rest } = asJson<InventoryResponse>(await (await fetch(s2.url + "/api/inventory")).json()).inventory as InventorySummary & { scans?: unknown }; return rest; };
  const linked = existsSync(join(dir, "runs", "linked.json"));
  try {
    assert.equal((await putJson(s2.url + "/api/retention/cleanup", "POST", { dryRun: "no" })).status, 400);
    assert.deepEqual(await cleanup(true), { ok: true, scans: 0, runs: 0, refused: false }, "Keep everything prunes nothing");
    assert.equal((await putJson(s2.url + "/api/settings", "PUT", { retention: { keepAll: false, runsPerCharacter: 2 } })).status, 200);
    const before = await inventory();
    assert.deepEqual(await cleanup(true), { ok: true, scans: 1, runs: linked ? 2 : 1, refused: false });
    assert.equal(readdirSync(join(dir, "scans")).length, 3, "a dry run removes nothing");
    assert.deepEqual(await cleanup(false), { ok: true, scans: 1, runs: 1, refused: false }, "the symlinked run is never removed");
    assert.deepEqual(readdirSync(join(dir, "scans")).sort(), ["demo-Dorran.json", "demo-Kestrel.json"]);
    assert.deepEqual(readdirSync(join(dir, "runs")).sort(), [...(linked ? ["linked.json"] : []), "named.json", "r1.json", "r2.json"], "a named run is kept and not counted");
    assert.ok(existsSync(outside), "nor what the symlink points at");
    assert.deepEqual(await inventory(), before, "the inventory is the same");
    assert.match(readFileSync(join(dir, "logs", "server.log"), "utf8"), /retention \(clean up now\) removed 1 scans \["old-Dorran\.json"\] and 1 runs \["r0\.json"\]/);

    // A restart prunes on its own.
    await s2.close();
    writeFileSync(join(dir, "scans", "old-Dorran.json"), OLD_DORRAN);
    s2 = await startServer(ensureLayout(resolveConfig(["--port", "0", "--data", dir], {})));
    for (let i = 0; i < 100 && existsSync(join(dir, "scans", "old-Dorran.json")); i++) await new Promise((r) => setTimeout(r, 20));
    assert.equal(existsSync(join(dir, "scans", "old-Dorran.json")), false, "startup removed the old scan");
  } finally {
    await s2.close();
  }
});

test("[fast] POST /api/retention/cleanup is refused under --demo, whose runs folder is still the player's", async () => {
  assert.equal((await putJson(srv.url + "/api/retention/cleanup", "POST", { dryRun: true })).status, 409);
});
