// server-setup.test.mts — HTTP tests of the setup wizard's routes, the TazUO panel, the update check and the client search.
//
// `GET /api/setup` (the adapters with their available versions, transports and bridge capabilities, `firstRun`, `bridgeAdapter` for no client, a configured one and a fixture adapters folder without tazuo), the data-folder check (issue #39: a configured client writing elsewhere warned at startup and reported per request through fixed and malformed files, no warning for a match, no client or `--demo`, an auto-detected folder under the temp home), `GET /api/setup/scanner` (the bundled web scanner byte for byte with its version, refused for a folder adapter or an unknown id), `POST /api/setup/locate` (nested TazUO and Razor Enhanced folders, never echoing the path it probed), `POST /api/setup/install` (the scripts installed and `settings.client` saved, the nested folder resolved and persisted, a non-folder refused, a paste adapter refused, a traversal or unknown adapter refused, the 409 running-script guard checking the adapter being installed), the TazUO panel's autostart and prefs, `GET /api/update-check` through the injected fetch, and `PACKRAT_CLIENT_HOME` confining the client search.
import { test, before, after, afterEach, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync, cpSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { resolveConfig, ensureLayout } from "./config.mts";
import { defaultClientSearch, type ServerHandle } from "./vault-server.mts";
import { startTestServer as startServer, FAKE_HOME, updateRequests } from "./server-fixture.mts";
import { setRules } from "./vault-lib.mts";
import { buildUi } from "../scripts/build-ui.mts";
import { buildSchemaTypes } from "../scripts/build-schema-types.mts";
import { repoFromPackage, type InstallScriptsResult } from "./installer.mts";
import { asJson, HERE, UOALIVE, type SettingsResponse, type SetupResponse, type ErrorBody } from "./server-routes-fixture.mts";

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

interface LocateResponse {
  scriptsDir?: string;
  installed?: { version: string | null; files: Record<string, boolean> };
  error?: string;
}

// The version the repo's own tazuo adapter ships, read the same way installer.mts's installedVersion
// reads it — every assertion about a "repo-shipped" or "just installed" version compares against this
// rather than a literal, so bumping ADAPTER_VERSION in the .py is not also a test edit.
const TAZUO_VERSION = /ADAPTER_VERSION\s*=\s*"([^"]+)"/.exec(readFileSync(join(HERE, "..", "adapters", "tazuo", "packrat-scanner.py"), "utf8"))![1]!;

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

// ---- Setup wizard (Task 2, Phase 4): GET/POST /api/setup*, GET /api/update-check,
// POST /api/host/*, and PUT /api/settings' setupDone/client extension. app/installer.test.mts covers
// the pure installer.mts functions directly; these cover the routes wiring them up.

test("[fast] GET /api/setup lists the tazuo adapter, its available (repo-shipped) version, and firstRun:true on a fresh data dir", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-setup-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--port", "0", "--data", dir], {})));
  try {
    const j = asJson<SetupResponse>(await (await fetch(s2.url + "/api/setup")).json());
    assert.equal(j.ok, true);
    assert.equal(j.firstRun, true);
    // Present, not pinned: the test's own point (title, available/installed/dataDir below) is
    // "tazuo is listed, with the right version/candidates" — not the exact set of shipped adapters.
    assert.ok(j.adapters.map((a) => a.id).includes("tazuo"), JSON.stringify(j.adapters.map((a) => a.id)));
    assert.equal(j.available.tazuo, TAZUO_VERSION);
    assert.equal(j.installed, null);
    assert.equal(j.dataDir, dir);
    assert.ok(Array.isArray(j.candidates.tazuo), JSON.stringify(j.candidates));
    // Phase 6 final review, deferred minor: the wizard/Import tab need this to hide the Windows-only
    // razor-enhanced adapter on any other platform (app/ui/adapters.mts's availableAdapters) — it
    // must be this process's real process.platform, not a placeholder.
    assert.equal(j.platform, process.platform);
    // Settings › Updates shows the running version before any update check.
    assert.equal(j.version, (JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "package.json"), "utf8")) as { version: string }).version);
  } finally {
    await s2.close();
  }
});

// ---- the scripts' data folder versus the app's (issue #39) ----------------------------------------
// A scripts folder holding one Pack Rat script and a packrat-paths.json naming `dataDir`.
function installedScripts(scriptsDir: string, dataDir: string): string {
  mkdirSync(scriptsDir, { recursive: true });
  writeFileSync(join(scriptsDir, "packrat-scanner.py"), `ADAPTER_VERSION = "${TAZUO_VERSION}"\n`);
  writeFileSync(join(scriptsDir, "packrat-paths.json"), `${JSON.stringify({ dataDir }, null, 1)}\n`);
  return scriptsDir;
}

function warnings(t: TestContext): () => string[] {
  const warn = t.mock.method(console, "warn", () => {});
  return () => warn.mock.calls.map((c) => String(c.arguments[0]));
}

test("[fast] a configured client whose scripts write to another data folder is warned about at startup and reported by GET /api/setup", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "qm-dd-server-")), other = mkdtempSync(join(tmpdir(), "qm-dd-other-"));
  const scriptsDir = installedScripts(mkdtempSync(join(tmpdir(), "qm-dd-scripts-")), other);
  const config = ensureLayout(resolveConfig(["--port", "0", "--data", dir], {}));
  writeFileSync(config.paths.settings, JSON.stringify({ schemaVersion: 1, shard: "uoalive", setupDone: true, client: { adapter: "tazuo", scriptsDir } }));
  const warned = warnings(t);
  const s2 = await startServer(config);
  try {
    const startup = warned().filter((w) => w.includes("--data"));
    assert.equal(startup.length, 1, JSON.stringify(warned()));
    assert.ok(startup[0]!.includes(other) && startup[0]!.includes(dir) && startup[0]!.includes(`npm start -- --data ${other}`), startup[0]);
    const j = asJson<SetupResponse>(await (await fetch(s2.url + "/api/setup")).json());
    assert.deepEqual(j.dataDirCheck, { status: "mismatch", scriptsDir, scriptsDataDir: other, dataDir: dir });
    // Recomputed per request: fixing the file (a reinstall does) clears it without a restart.
    installedScripts(scriptsDir, dir);
    const fixed = asJson<SetupResponse>(await (await fetch(s2.url + "/api/setup")).json());
    assert.deepEqual(fixed.dataDirCheck, { status: "match", scriptsDir });
    writeFileSync(join(scriptsDir, "packrat-paths.json"), "{not json");
    const broken = asJson<SetupResponse>(await (await fetch(s2.url + "/api/setup")).json());
    assert.equal(broken.dataDirCheck.status, "unreadable", "a malformed file is reported, not a 500");
  } finally {
    await s2.close();
  }
});

test("[fast] a matching client, no client at all, and --demo start without a data-folder warning", async (t) => {
  const warned = warnings(t);
  const dir = mkdtempSync(join(tmpdir(), "qm-dd-quiet-"));
  const scriptsDir = installedScripts(mkdtempSync(join(tmpdir(), "qm-dd-scripts-")), dir);
  const config = ensureLayout(resolveConfig(["--port", "0", "--data", dir], {}));
  writeFileSync(config.paths.settings, JSON.stringify({ schemaVersion: 1, shard: "uoalive", setupDone: true, client: { adapter: "tazuo", scriptsDir } }));
  for (const cfg of [config, ensureLayout(resolveConfig(["--port", "0", "--data", mkdtempSync(join(tmpdir(), "qm-dd-none-"))], {})), ensureLayout(resolveConfig(["--demo", "--port", "0", "--data", mkdtempSync(join(tmpdir(), "qm-dd-demo-"))], {}))]) {
    const s2 = await startServer(cfg);
    try {
      const j = asJson<SetupResponse>(await (await fetch(s2.url + "/api/setup")).json());
      assert.notEqual(j.dataDirCheck.status, "mismatch", cfg.dataDir);
    } finally {
      await s2.close();
    }
  }
  assert.deepEqual(warned().filter((w) => w.includes("--data")), []);
});

test("[fast] with no client configured, GET /api/setup checks the auto-detected client folder", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "qm-dd-detect-")), other = mkdtempSync(join(tmpdir(), "qm-dd-other-"));
  const root = join(FAKE_HOME, "Desktop", "TazUO");
  const legion = installedScripts(join(root, "TazUO", "LegionScripts"), other);
  const warned = warnings(t);
  const s2 = await startServer(ensureLayout(resolveConfig(["--port", "0", "--data", dir], {})));
  try {
    const j = asJson<SetupResponse>(await (await fetch(s2.url + "/api/setup")).json());
    assert.deepEqual(j.dataDirCheck, { status: "mismatch", scriptsDir: legion, scriptsDataDir: other, dataDir: dir });
    assert.equal(warned().filter((w) => w.includes(legion)).length, 1, "the startup warning names the detected folder");
  } finally {
    await s2.close();
    rmSync(root, { recursive: true, force: true });
  }
});

// Task 5, Phase 6: the wizard/Settings tell a folder-transport adapter (installable) apart from a
// paste-transport one (nothing to install, sent to the Import tab instead) by this field — never by a
// hard-coded adapter id. Uses the repo's own three shipped adapters, not a throwaway fixture dir.
test("[fast] GET /api/setup reports each real adapter's transport; POST /api/setup/install refuses the paste-transport classicuo-web adapter with 400", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-setup-transport-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--port", "0", "--data", dir], {})));
  try {
    const setup = asJson<SetupResponse>(await (await fetch(s2.url + "/api/setup")).json());
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
    const body = asJson<InstallScriptsResult>(await r.json());
    assert.match(body.error!, /nothing to install/);
    assert.deepEqual(readdirSync(scriptsDir), [], "nothing was written for a paste-transport adapter");
    assert.equal((asJson<SettingsResponse>(await (await fetch(s2.url + "/api/settings")).json())).settings.client, undefined, "a refused install must not save settings.client");
  } finally {
    await s2.close();
  }
});

test("[fast] GET /api/setup/scanner serves the bundled web scanner and its version, only for a known paste-transport adapter", async () => {
  const shipped = readFileSync(join(HERE, "..", "adapters", "classicuo-web", "packrat-scanner.ts"), "utf8");
  const r = await fetch(srv.url + "/api/setup/scanner?adapter=classicuo-web");
  assert.equal(r.status, 200);
  const body = asJson<{ version: string; script: string }>(await r.json());
  assert.equal(body.script, shipped, "the whole script, byte for byte");
  assert.equal(body.version, /ADAPTER_VERSION\s*=\s*"([^"]+)"/.exec(shipped)![1]);
  // No path input: a folder adapter, an unknown id, a traversal and no id at all are all refused.
  for (const q of ["?adapter=tazuo", "?adapter=nope", "?adapter=..%2Ftazuo", "?adapter=classicuo-web%2F..%2Ftazuo", ""]) {
    assert.equal((await fetch(srv.url + "/api/setup/scanner" + q)).status, 400, q);
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
    const body = asJson(await r.json());
    assert.equal(body.scriptsDir, scriptsDir);
  } finally {
    await s2.close();
  }
});

// Task 2, Phase 6: the page decides whether to offer the Highlight/Grab/Go-to bridge buttons from
// GET /api/setup's {settings.client, adapters} — settings.client names which installed adapter is
// active, and adapters carries that adapter's own capabilities.bridge list. This is the one route
// test both facts land in together, so it exercises the real contract the page reads rather than the
// pure listAdapters()/installer.mts unit already covered by app/installer.test.mts. --adapters points
// the whole server at a throwaway folder holding a copy of the real tazuo adapter (full bridge) next
// to a minimal fixture adapter that declares no bridge at all, standing in for a client like the
// ClassicUO web adapter that can't run one.
test("[fast] GET /api/setup: an adapter with no bridge reports capabilities.bridge:[]; tazuo still reports its four actions", async () => {
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
    const setup = asJson<SetupResponse>(await (await fetch(s2.url + "/api/setup")).json());
    assert.deepEqual(setup.adapters.map((a) => a.id).sort(), ["nobridge", "tazuo"]);
    assert.deepEqual(setup.adapters.find((a) => a.id === "nobridge")!.capabilities.bridge, []);
    assert.deepEqual(setup.adapters.find((a) => a.id === "tazuo")!.capabilities.bridge, ["highlight", "grab", "goto", "trip", "trip-bags"]);

    // settings.client names which of those is active — PUT it at the no-bridge adapter first.
    const putNoBridge = await fetch(s2.url + "/api/settings", {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ client: { adapter: "nobridge", scriptsDir } }),
    });
    assert.equal(putNoBridge.status, 200);
    let after = asJson<SetupResponse>(await (await fetch(s2.url + "/api/setup")).json());
    assert.equal(after.settings.client!.adapter, "nobridge");
    assert.deepEqual(after.adapters.find((a) => a.id === after.settings.client!.adapter)!.capabilities.bridge, []);

    // Switching to tazuo flips the same lookup back to the four actions — same shape, no restart.
    const putTazuo = await fetch(s2.url + "/api/settings", {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ client: { adapter: "tazuo", scriptsDir } }),
    });
    assert.equal(putTazuo.status, 200);
    after = asJson<SetupResponse>(await (await fetch(s2.url + "/api/setup")).json());
    assert.equal(after.settings.client!.adapter, "tazuo");
    assert.deepEqual(after.adapters.find((a) => a.id === after.settings.client!.adapter)!.capabilities.bridge, ["highlight", "grab", "goto", "trip", "trip-bags"]);
  } finally {
    await s2.close();
  }
});

// Bug fix: a player who pressed Skip in the setup wizard (settings.client left unset on purpose — see
// app/ui/bridge.mts's currentAdapter() comment) or installed an adapter's scripts by hand had every
// Highlight/Grab/Go-to button vanish, even though POST /api/bridge / GET /api/bridge/status were
// already routing to bridgeAdapter()'s own default the whole time. GET /api/setup now reports that same
// routing target as `bridgeAdapter`, so the page can fall back to it instead of hiding the buttons.
test("[fast] GET /api/setup reports bridgeAdapter: \"tazuo\" (the real bridge routing default) when no client is configured", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-setup-bridgeadapter-default-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--port", "0", "--data", dir], {})));
  try {
    const setup = asJson<SetupResponse>(await (await fetch(s2.url + "/api/setup")).json());
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
    const setup = asJson<SetupResponse>(await (await fetch(s2.url + "/api/setup")).json());
    assert.equal(setup.settings.client!.adapter, "nobridge");
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
    const setup = asJson<SetupResponse>(await (await fetch(s2.url + "/api/setup")).json());
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
    const body = asJson<LocateResponse>(await r.json());
    assert.equal(body.scriptsDir, legionDir);
    assert.equal(body.installed!.version, null);

    const bad = await fetch(s2.url + "/api/setup/locate", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ adapter: "tazuo", dir: join(clientRoot, "does-not-exist") }),
    });
    assert.equal(bad.status, 400);
  } finally {
    await s2.close();
  }
});

test("[fast] the TazUO panel: an install adds it to TazUO's autostart list only while TazUO is closed, PUT saves showAtLogin, an old openAtLogin migrates, a bad hotkey is refused", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-panel-prefs-"));
  let running = true;
  const s2 = await startServer(ensureLayout(resolveConfig(["--port", "0", "--data", dir], {})), { clientRunning: () => running });
  try {
    const tazuo = join(mkdtempSync(join(tmpdir(), "qm-panel-client-")), "TazUO");
    const scriptsDir = join(tazuo, "LegionScripts");
    mkdirSync(scriptsDir, { recursive: true });
    mkdirSync(join(tazuo, "Data"));
    const lscript = join(tazuo, "Data", "lscript.json");
    const panelFile = join(dir, "tazuo-panel.json");
    const call = async (method: string, path: string, body?: unknown) => {
      const r = await fetch(s2.url + path, { method, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      return { status: r.status, body: await r.json() as Record<string, unknown> };
    };
    const install = await call("POST", "/api/setup/install", { adapter: "tazuo", scriptsDir, panel: { showAtLogin: false, hotkey: { mods: ["ALT"], key: "F3" } } });
    assert.equal(install.status, 200, JSON.stringify(install.body));
    assert.deepEqual(install.body.autostart, { status: "running" }, "TazUO is open: its list is left alone");
    assert.equal(existsSync(lscript), false);
    assert.deepEqual(JSON.parse(readFileSync(panelFile, "utf8")), { hotkey: { mods: ["ALT"], key: "F3" }, showAtLogin: false });

    running = false;
    const reinstall = await call("POST", "/api/setup/install", { adapter: "tazuo", scriptsDir });
    assert.deepEqual(reinstall.body.autostart, { status: "applied" });
    assert.deepEqual(JSON.parse(readFileSync(lscript, "utf8")).GlobalAutoStartScripts, ["packrat-panel.py"]);

    const bad = await call("PUT", "/api/tazuo-panel", { hotkey: { mods: [], key: "P" } });
    assert.equal(bad.status, 400);
    assert.match(String(bad.body.error), /needs Ctrl, Alt or Shift/);
    assert.deepEqual((await call("PUT", "/api/tazuo-panel", { showAtLogin: true })).body, { ok: true, prefs: { hotkey: { mods: ["ALT"], key: "F3" }, showAtLogin: true } });

    writeFileSync(panelFile, JSON.stringify({ openAtLogin: false, pendingOpenAtLogin: true }));   // written by an older version
    assert.deepEqual((await call("GET", "/api/tazuo-panel")).body, { ok: true, prefs: { hotkey: { mods: ["CTRL", "SHIFT"], key: "P" }, showAtLogin: false } });
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
    const installBody = asJson<InstallScriptsResult>(await install.json());
    assert.equal(install.status, 200, JSON.stringify(installBody));
    assert.deepEqual(installBody.installed!.sort(), ["packrat-blacklist.py", "packrat-bridge.py", "packrat-character-refresh.py", "packrat-house-map-refresh.py", "packrat-panel.py", "packrat-scanner.py"]);
    assert.equal(installBody.version, TAZUO_VERSION);
    assert.ok(existsSync(join(scriptsDir, "packrat-scanner.py")));
    assert.ok(existsSync(join(scriptsDir, "packrat-paths.json")));
    assert.equal(existsSync(join(scriptsDir, "packrat-scanner.py.new")), false);

    const settingsAfterInstall = asJson<SettingsResponse>(await (await fetch(s2.url + "/api/settings")).json());
    assert.deepEqual(settingsAfterInstall.settings.client, { adapter: "tazuo", scriptsDir });

    const setupAfterInstall = asJson<SetupResponse>(await (await fetch(s2.url + "/api/setup")).json());
    assert.equal(setupAfterInstall.firstRun, true, "an install alone must not clear firstRun");
    assert.equal(setupAfterInstall.installed!.version, TAZUO_VERSION);

    const done = await fetch(s2.url + "/api/settings", {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ setupDone: true }),
    });
    assert.equal(done.status, 200);
    assert.equal((asJson<SetupResponse>(await (await fetch(s2.url + "/api/setup")).json())).firstRun, false);
    // the earlier install's settings.client survives a later, unrelated settings PUT
    assert.deepEqual((asJson<SettingsResponse>(await (await fetch(s2.url + "/api/settings")).json())).settings.client, { adapter: "tazuo", scriptsDir });
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
    const body = asJson<ErrorBody>(await r.json());
    assert.match(body.error, /-stopall/);
    assert.deepEqual(readdirSync(scriptsDir), [], "nothing was written while refused");
  } finally {
    await s2.close();
  }
});

test("[fast] GET /api/update-check asks for package.json's repository through the injected fetch, never GitHub itself", async () => {
  const pkg = JSON.parse(readFileSync(join(HERE, "..", "package.json"), "utf8"));
  const asked = updateRequests.length;
  const j = asJson(await (await get("/api/update-check")).json());
  assert.equal(j.ok, true);
  assert.equal(j.configured, true, JSON.stringify(pkg.repository));
  assert.deepEqual(updateRequests.slice(asked), [`https://api.github.com/repos/${repoFromPackage(pkg)}/releases/latest`]);
  assert.equal(j.latest, "99.0.0");
  assert.equal(j.upToDate, false);
});

// Post-review fix (security, Important finding 1): adapter must be checked against the real,
// known adapter ids before it can reach a filesystem path — a traversal id like "../../../../tmp/evil"
// must never let /api/setup/locate or /api/setup/install (or PUT /api/settings' client.adapter) act on
// an arbitrary directory. installer.test.mts covers installScripts' own defence-in-depth rejection
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
    assert.match(asJson<ErrorBody>(await locate.json()).error, /adapter/);

    const scriptsDir = mkdtempSync(join(tmpdir(), "qm-badadapter-dest-"));
    const install = await fetch(s2.url + "/api/setup/install", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ adapter: evilAdapter, scriptsDir }),
    });
    assert.equal(install.status, 400);
    assert.match(asJson<ErrorBody>(await install.json()).error, /adapter/);
    assert.deepEqual(readdirSync(scriptsDir), [], "nothing was written for a rejected adapter id");
    assert.equal((asJson<SettingsResponse>(await (await fetch(s2.url + "/api/settings")).json())).settings.client, undefined, "a rejected install must not save settings.client");

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

// Important 3 / area-3 finding 4: install took the raw body value and only installScripts'
// statSync().isDirectory() stood between it and the copy loop, while locate validated — so the two
// halves of the wizard disagreed about what a scripts folder is. Now install resolves the SAME nested
// form locate returns, and persists that.
test("[fast] POST /api/setup/install resolves the nested scripts folder like locate does, and persists the resolved path", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-install-nested-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--port", "0", "--data", dir], {})));
  try {
    const clientRoot = mkdtempSync(join(tmpdir(), "qm-install-nested-client-"));
    const legionDir = join(clientRoot, "TazUO", "LegionScripts");
    mkdirSync(legionDir, { recursive: true });
    const r = await fetch(s2.url + "/api/setup/install", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ adapter: "tazuo", scriptsDir: clientRoot }),
    });
    assert.equal(r.status, 200, await r.clone().text());
    assert.ok(existsSync(join(legionDir, "packrat-scanner.py")), "installed into the nested scripts folder");
    assert.equal(existsSync(join(clientRoot, "packrat-scanner.py")), false, "and not into the picked root");
    assert.deepEqual((asJson<SettingsResponse>(await (await fetch(s2.url + "/api/settings")).json())).settings.client,
      { adapter: "tazuo", scriptsDir: legionDir }, "the RESOLVED folder is what gets persisted");
  } finally {
    await s2.close();
  }
});

test("[fast] POST /api/setup/install refuses a scriptsDir that is not a folder, writing nothing and saving no client", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-install-baddir-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--port", "0", "--data", dir], {})));
  try {
    const clientRoot = mkdtempSync(join(tmpdir(), "qm-install-baddir-client-"));
    const missing = join(clientRoot, "no-such-folder");
    for (const bad of [missing, "relative/path", "\\\\host\\share", "//host/share", 5, null]) {
      const r = await fetch(s2.url + "/api/setup/install", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ adapter: "tazuo", scriptsDir: bad }),
      });
      assert.equal(r.status, 400, `scriptsDir ${JSON.stringify(bad)} should be refused`);
      assert.equal(asJson<ErrorBody & { code?: string }>(await r.json()).code, "badDir");
    }
    assert.equal(existsSync(missing), false, "a refused install creates nothing");
    assert.equal((asJson<SettingsResponse>(await (await fetch(s2.url + "/api/settings")).json())).settings.client, undefined);
  } finally {
    await s2.close();
  }
});

// Important 3: a message naming the path it probed turned this route into a clean yes/no oracle for
// any absolute path on the machine — "existing directory" vs "file or absent", for free.
test("[fast] POST /api/setup/locate never echoes the path it probed", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-locate-oracle-"));
  const s2 = await startServer(ensureLayout(resolveConfig(["--port", "0", "--data", dir], {})));
  try {
    const probe = join(mkdtempSync(join(tmpdir(), "qm-locate-oracle-probe-")), "definitely-not-here");
    const r = await fetch(s2.url + "/api/setup/locate", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ adapter: "tazuo", dir: probe }),
    });
    assert.equal(r.status, 400);
    const { error } = asJson<ErrorBody>(await r.json());
    assert.doesNotMatch(error, /definitely-not-here/, "the probed path must not come back in the error");
    assert.doesNotMatch(error, /\//, "nor any path at all");
  } finally {
    await s2.close();
  }
});

// PACKRAT_CLIENT_HOME (what the Electron UI tests set) confines the client search to one folder: a client
// planted there is found, the machine's own home is never the search's home, and nothing is proposed from
// an environment folder or a fixed root.
test("[fast] PACKRAT_CLIENT_HOME confines the client search to that folder", () => {
  const home = mkdtempSync(join(tmpdir(), "qm-clienthome-"));
  const tazuo = { id: "tazuo", name: "TazUO", scripts: [], capabilities: {}, transport: "folder" as const, platform: null, summary: "" };
  try {
    const empty = defaultClientSearch({ PACKRAT_CLIENT_HOME: home, LOCALAPPDATA: join(home, "..") });
    assert.equal(empty.home, home);
    assert.deepEqual(empty.candidates(tazuo), [], "an empty home proposes nothing");
    const planted = join(home, "Desktop", "TazUO", "TazUO", "LegionScripts");
    mkdirSync(planted, { recursive: true });
    assert.deepEqual(defaultClientSearch({ PACKRAT_CLIENT_HOME: home }).candidates(tazuo), [planted]);
    assert.deepEqual(defaultClientSearch({ PACKRAT_CLIENT_HOME: home }).candidates({ ...tazuo, platform: process.platform === "win32" ? "linux" : "win32" }), [], "an adapter for another OS offers nothing");
    assert.notEqual(defaultClientSearch({}).home, home, "without it the search is the real home");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
