// installer.test.mjs — app/installer.mjs: adapter discovery, client-folder detection, script
// install/verify, scan import, and the GitHub-releases update check. All [fast] — tmp dirs only, no
// real network (checkForUpdates takes an injected fetchImpl in every test here).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, cpSync, symlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import {
  listAdapters, candidateClientRoots, validateScriptsDir, installedVersion, installScripts,
  importScans, repoFromPackage, checkForUpdates, RUNNING_MESSAGE,
} from "./installer.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REAL_ADAPTERS_DIR = join(HERE, "..", "adapters");
const tmp = (prefix) => mkdtempSync(join(tmpdir(), prefix));

// A fake adaptersDir built by copying the real adapters/tazuo/ folder, so these tests exercise the
// actual shipped scripts/capabilities/README rather than a hand-built fixture that could drift from them.
function fakeAdaptersDir() {
  const dir = tmp("qm-installer-adapters-");
  cpSync(join(REAL_ADAPTERS_DIR, "tazuo"), join(dir, "tazuo"), { recursive: true });
  return dir;
}

// Same idea, but with the real tazuo/ AND razor-enhanced/ folders side by side — for the tests below
// that check one adapter's install never reaches into another's.
function fakeMultiAdaptersDir() {
  const dir = tmp("qm-installer-multi-adapters-");
  cpSync(join(REAL_ADAPTERS_DIR, "tazuo"), join(dir, "tazuo"), { recursive: true });
  cpSync(join(REAL_ADAPTERS_DIR, "razor-enhanced"), join(dir, "razor-enhanced"), { recursive: true });
  return dir;
}

// The real classicuo-web/ folder, alone — the one shipped paste-transport adapter, with no packrat-*.py
// scripts of its own.
function fakeWebAdapterDir() {
  const dir = tmp("qm-installer-web-adapter-");
  cpSync(join(REAL_ADAPTERS_DIR, "classicuo-web"), join(dir, "classicuo-web"), { recursive: true });
  return dir;
}

// ---- listAdapters -----------------------------------------------------------------------------------

test("[fast] listAdapters finds tazuo with its three scripts and a summary mentioning grab", () => {
  const adapters = listAdapters(fakeAdaptersDir());
  assert.equal(adapters.length, 1);
  const [tazuo] = adapters;
  assert.equal(tazuo.id, "tazuo");
  assert.deepEqual(tazuo.scripts.sort(), ["packrat-bridge.py", "packrat-refresh.py", "packrat-scanner.py"]);
  assert.ok(tazuo.capabilities && tazuo.capabilities.bank, JSON.stringify(tazuo.capabilities));
  assert.match(tazuo.summary, /grab/);
  assert.equal(typeof tazuo.name, "string");
  assert.ok(tazuo.name.length > 0);
  assert.equal(tazuo.transport, "folder");
  assert.equal(tazuo.platform, null, "tazuo has no platform restriction — capabilities.json carries no platform field");
});

// Phase 6 final review follow-up: capabilities.json's optional top-level `platform` field (see
// docs/adapter-guide.md's "Platform restriction") must surface on the object listAdapters returns —
// this is what app/ui/adapters.mjs's platformCompatible reads instead of hard-coding an adapter id.
test("[fast] listAdapters surfaces razor-enhanced's platform:\"win32\" from its real capabilities.json", () => {
  const adapters = listAdapters(fakeMultiAdaptersDir());
  const razor = adapters.find((a) => a.id === "razor-enhanced");
  assert.ok(razor, JSON.stringify(adapters.map((a) => a.id)));
  assert.equal(razor.platform, "win32");
  const tazuo = adapters.find((a) => a.id === "tazuo");
  assert.equal(tazuo.platform, null);
});

test("[fast] listAdapters reports transport:\"paste\" and no scripts for the classicuo-web adapter", () => {
  const adapters = listAdapters(fakeWebAdapterDir());
  assert.equal(adapters.length, 1);
  const [web] = adapters;
  assert.equal(web.id, "classicuo-web");
  assert.equal(web.transport, "paste");
  assert.deepEqual(web.scripts, [], "a paste-transport adapter ships no packrat-*.py scripts to install");
});

test("[fast] listAdapters ignores a subdirectory with no capabilities.json and returns [] for a missing adaptersDir", () => {
  const dir = tmp("qm-installer-adapters-empty-");
  mkdirSync(join(dir, "not-an-adapter"), { recursive: true });
  writeFileSync(join(dir, "not-an-adapter", "README.md"), "# Not An Adapter\n");
  assert.deepEqual(listAdapters(dir), []);
  assert.deepEqual(listAdapters(join(dir, "does-not-exist")), []);
});

// ---- candidateClientRoots -----------------------------------------------------------------------------

test("[fast] candidateClientRoots returns only qualifying dirs, in order, deduped (posix)", () => {
  const home = "/Users/example";
  const desktop = join(home, "Desktop", "TazUO", "LegionScripts");
  const documents = join(home, "Documents", "TazUO", "TazUO", "LegionScripts");
  const exists = (p) => p === desktop || p === documents;
  const out = candidateClientRoots({ adapter: "tazuo", home, platform: "darwin", env: {}, exists });
  assert.deepEqual(out, [desktop, documents]);
});

test("[fast] candidateClientRoots reports one hit per root even when both its nested and direct forms exist", () => {
  const home = "/h";
  const nested = join(home, "Desktop", "TazUO", "TazUO", "LegionScripts");
  const direct = join(home, "Desktop", "TazUO", "LegionScripts");
  const exists = (p) => p === nested || p === direct;   // both qualify for the same root
  const out = candidateClientRoots({ adapter: "tazuo", home, platform: "darwin", env: {}, exists });
  assert.deepEqual(out, [nested], "the nested (real-world) layout wins over the direct one for the same root, with no duplicate entry");
});

test("[fast] candidateClientRoots adds LOCALAPPDATA and C:\\TazUO on win32", () => {
  const home = "C:\\Users\\example";
  const localAppData = "C:\\Users\\example\\AppData\\Local";
  const winLegion = join(`${localAppData}/TazUO`, "LegionScripts");
  const cRootLegion = join("C:\\TazUO", "LegionScripts");
  const exists = (p) => p === winLegion || p === cRootLegion;
  const out = candidateClientRoots({ adapter: "tazuo", home, platform: "win32", env: { LOCALAPPDATA: localAppData }, exists });
  assert.deepEqual(out, [winLegion, cRootLegion]);
});

test("[fast] candidateClientRoots returns [] for an unknown adapter or a missing home", () => {
  assert.deepEqual(candidateClientRoots({ adapter: "nope", home: "/h", exists: () => true }), []);
  assert.deepEqual(candidateClientRoots({ adapter: "tazuo", home: "", exists: () => true }), []);
});

// Razor Enhanced has no fixed install location (its own official docs say only "unpack in your own
// folder, run Razor.exe" — see app/installer.mjs's NESTED_SCRIPTS_SUFFIX comment), so unlike tazuo it
// has no entry in CANDIDATE_ROOT_NAME and candidateClientRoots must propose nothing for it — on any
// platform, even win32, and even when a folder that would match one of its NESTED_SCRIPTS_SUFFIX
// shapes actually exists. The manual folder picker (validateScriptsDir, below) is the only path.
test("[fast] candidateClientRoots proposes nothing for razor-enhanced (no known install location), on any platform", () => {
  const home = "C:\\Users\\example";
  const scripts = join(home, "Desktop", "CUOLauncher", "Razor", "Scripts");
  const exists = (p) => p === scripts;
  const win = candidateClientRoots({ adapter: "razor-enhanced", home, platform: "win32", env: {}, exists });
  assert.deepEqual(win, [], "no well-known root name to guess at, even on win32");
  const mac = candidateClientRoots({ adapter: "razor-enhanced", home, platform: "darwin", env: {}, exists });
  assert.deepEqual(mac, [], "also Windows-only, so no candidate on a non-win32 platform either");
});

// Phase 6 final review follow-up: the platform gate is now data-driven (an `adapterPlatform` param,
// fed from the adapter's own capabilities.json via listAdapters — see docs/adapter-guide.md's
// "Platform restriction"), not a hard-coded `adapter === "razor-enhanced"` check. razor-enhanced
// itself can't prove this in isolation (it has no CANDIDATE_ROOT_NAME entry at all, so it always
// returns [] regardless of platform — the test above already covers that path). This exercises the
// adapterPlatform parameter directly, using tazuo (which DOES have a real candidate path) as the
// vehicle, to prove the gate itself works for any adapter a future capabilities.json restricts.
test("[fast] candidateClientRoots gates on the adapterPlatform param, not a hard-coded adapter id", () => {
  const home = "/Users/example";
  const legionScripts = join(home, "Desktop", "TazUO", "LegionScripts");
  const exists = (p) => p === legionScripts;
  // tazuo has a real candidate here — but a caller-supplied adapterPlatform mismatching the current
  // platform must still suppress it, exactly the way it would for a real platform-restricted adapter.
  const blocked = candidateClientRoots({ adapter: "tazuo", home, platform: "darwin", env: {}, exists, adapterPlatform: "win32" });
  assert.deepEqual(blocked, [], "adapterPlatform mismatching the current platform suppresses the candidate, even for an adapter that would otherwise have one");
  // A matching adapterPlatform doesn't suppress anything.
  const allowed = candidateClientRoots({ adapter: "tazuo", home, platform: "darwin", env: {}, exists, adapterPlatform: "darwin" });
  assert.deepEqual(allowed, [legionScripts]);
  // Omitting adapterPlatform entirely (the default) behaves exactly as before — no gating at all.
  const unrestricted = candidateClientRoots({ adapter: "tazuo", home, platform: "darwin", env: {}, exists });
  assert.deepEqual(unrestricted, [legionScripts]);
});

// ---- validateScriptsDir -------------------------------------------------------------------------------

test("[fast] validateScriptsDir accepts the dir itself, <dir>/LegionScripts, and <dir>/TazUO/LegionScripts", () => {
  const direct = tmp("qm-vsd-direct-");
  assert.deepEqual(validateScriptsDir(direct, "tazuo"), { ok: true, scriptsDir: direct });

  const oneDown = tmp("qm-vsd-onedown-");
  mkdirSync(join(oneDown, "LegionScripts"), { recursive: true });
  assert.deepEqual(validateScriptsDir(oneDown, "tazuo"), { ok: true, scriptsDir: join(oneDown, "LegionScripts") });

  const twoDown = tmp("qm-vsd-twodown-");
  mkdirSync(join(twoDown, "TazUO", "LegionScripts"), { recursive: true });
  assert.deepEqual(validateScriptsDir(twoDown, "tazuo"), { ok: true, scriptsDir: join(twoDown, "TazUO", "LegionScripts") });
});

test("[fast] validateScriptsDir rejects a file and a missing dir", () => {
  const dir = tmp("qm-vsd-bad-");
  const file = join(dir, "not-a-dir.txt");
  writeFileSync(file, "x");
  assert.equal(validateScriptsDir(file, "tazuo").ok, false);
  assert.equal(validateScriptsDir(join(dir, "does-not-exist"), "tazuo").ok, false);
  assert.equal(validateScriptsDir(null, "tazuo").ok, false);
});

// ---- installedVersion ---------------------------------------------------------------------------------

test("[fast] installedVersion reads 2.0.0 after an install and null before", () => {
  const scriptsDir = tmp("qm-iv-");
  const before = installedVersion(scriptsDir, "tazuo");
  assert.equal(before.version, null);
  assert.deepEqual(before.files, {});

  const result = installScripts({
    adapter: "tazuo", adaptersDir: fakeAdaptersDir(), scriptsDir, dataDir: tmp("qm-iv-data-"),
    bridgeStatusPath: join(scriptsDir, "no-such-status.json"),
  });
  assert.equal(result.ok, true);

  const after = installedVersion(scriptsDir, "tazuo");
  assert.equal(after.version, "2.0.0");
  assert.equal(after.files["packrat-scanner.py"], true);
  assert.equal(after.files["packrat-refresh.py"], true);
  assert.equal(after.files["packrat-bridge.py"], true);
});

// ---- installScripts -----------------------------------------------------------------------------------

function statusPath(dir) { return join(dir, "status.json"); }

test("[fast] installScripts refuses with code: \"running\" when status.json is alive within 30s and not stopped", () => {
  const bridgeDir = tmp("qm-is-running-");
  const sp = statusPath(bridgeDir);
  writeFileSync(sp, JSON.stringify({ alive: new Date(Date.now() - 10_000).toISOString() }));
  const scriptsDir = tmp("qm-is-running-dest-");
  const result = installScripts({ adapter: "tazuo", adaptersDir: fakeAdaptersDir(), scriptsDir, dataDir: tmp("qm-is-data-"), bridgeStatusPath: sp });
  assert.deepEqual(result, { ok: false, code: "running", error: RUNNING_MESSAGE });
  assert.deepEqual(readdirSync(scriptsDir), [], "nothing was written while refused");
});

test("[fast] installScripts proceeds when status.json says stopped: true", () => {
  const bridgeDir = tmp("qm-is-stopped-");
  const sp = statusPath(bridgeDir);
  writeFileSync(sp, JSON.stringify({ alive: new Date(Date.now() - 5_000).toISOString(), stopped: true }));
  const scriptsDir = tmp("qm-is-stopped-dest-");
  const result = installScripts({ adapter: "tazuo", adaptersDir: fakeAdaptersDir(), scriptsDir, dataDir: tmp("qm-is-data-"), bridgeStatusPath: sp });
  assert.equal(result.ok, true, JSON.stringify(result));
});

test("[fast] installScripts proceeds when alive is 5 minutes old", () => {
  const bridgeDir = tmp("qm-is-stale-");
  const sp = statusPath(bridgeDir);
  writeFileSync(sp, JSON.stringify({ alive: new Date(Date.now() - 5 * 60_000).toISOString() }));
  const scriptsDir = tmp("qm-is-stale-dest-");
  const result = installScripts({ adapter: "tazuo", adaptersDir: fakeAdaptersDir(), scriptsDir, dataDir: tmp("qm-is-data-"), bridgeStatusPath: sp });
  assert.equal(result.ok, true, JSON.stringify(result));
});

test("[fast] installScripts proceeds when status.json is missing", () => {
  const scriptsDir = tmp("qm-is-missing-dest-");
  const result = installScripts({
    adapter: "tazuo", adaptersDir: fakeAdaptersDir(), scriptsDir, dataDir: tmp("qm-is-data-"),
    bridgeStatusPath: join(tmp("qm-is-missing-bridge-"), "status.json"),
  });
  assert.equal(result.ok, true, JSON.stringify(result));
});

test("[fast] installScripts installs byte-identical copies, leaves no .new files, and writes packrat-paths.json", () => {
  const adaptersDir = fakeAdaptersDir();
  const scriptsDir = tmp("qm-is-copy-dest-");
  const dataDir = "/some/data/dir";
  const result = installScripts({ adapter: "tazuo", adaptersDir, scriptsDir, dataDir, bridgeStatusPath: join(scriptsDir, "no-status.json") });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.version, "2.0.0");
  assert.deepEqual(result.installed.sort(), ["packrat-bridge.py", "packrat-refresh.py", "packrat-scanner.py"]);

  for (const name of result.installed) {
    const srcBuf = readFileSync(join(adaptersDir, "tazuo", name));
    const destBuf = readFileSync(join(scriptsDir, name));
    assert.ok(srcBuf.equals(destBuf), `${name} is byte-identical`);
  }
  const leftoverNew = readdirSync(scriptsDir).filter((f) => f.endsWith(".new"));
  assert.deepEqual(leftoverNew, []);
  assert.deepEqual(JSON.parse(readFileSync(join(scriptsDir, "packrat-paths.json"), "utf8")), { dataDir });
});

test("[fast] installScripts reports badDir for a scriptsDir that does not exist", () => {
  const dir = tmp("qm-is-baddir-");
  const result = installScripts({
    adapter: "tazuo", adaptersDir: fakeAdaptersDir(), scriptsDir: join(dir, "does-not-exist"), dataDir: dir,
    bridgeStatusPath: join(dir, "no-status.json"),
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "badDir");
});

// Post-review fix (security): adapter is never trusted to be one of the real ids before installScripts
// joins it onto adaptersDir — a traversal id must be rejected by installScripts itself (defence in
// depth; the /api/setup/* routes also check against listAdapters()'s real ids before ever calling this).
test("[fast] installScripts rejects a path-traversal or otherwise invalid adapter id before touching the filesystem", () => {
  const adaptersDir = fakeAdaptersDir();
  for (const adapter of ["../../../../tmp/evil", "tazuo/../../etc", "TAZUO", "", null, undefined, 5]) {
    const scriptsDir = tmp("qm-is-badadapter-dest-");
    const result = installScripts({ adapter, adaptersDir, scriptsDir, dataDir: tmp("qm-is-data-"), bridgeStatusPath: join(scriptsDir, "no-status.json") });
    assert.equal(result.ok, false, `adapter ${JSON.stringify(adapter)} should have been rejected`);
    assert.equal(result.code, "badAdapter", `adapter ${JSON.stringify(adapter)}: ${JSON.stringify(result)}`);
    assert.deepEqual(readdirSync(scriptsDir), [], "nothing was written for a rejected adapter id");
  }
});

// Post-review fix: on a mid-install failure (disk full, permission revoked, or — as simulated here — a
// name collision with an existing directory), installScripts must clean up its own dangling .new file
// and report exactly which scripts made it in before the failure, rather than leaving a half-installed
// folder and an uncaught throw.
test("[fast] installScripts cleans up its .new file and reports the partial install on a mid-install failure", () => {
  const adaptersDir = fakeAdaptersDir();
  const scriptsDir = tmp("qm-is-midfail-dest-");
  // scriptNamesIn sorts alphabetically: bridge, refresh, scanner. Pre-occupy the second name with a
  // directory so its renameSync (file -> existing directory) throws EISDIR partway through the loop.
  mkdirSync(join(scriptsDir, "packrat-refresh.py"), { recursive: true });
  const result = installScripts({ adapter: "tazuo", adaptersDir, scriptsDir, dataDir: tmp("qm-is-data-"), bridgeStatusPath: join(scriptsDir, "no-status.json") });
  assert.equal(result.ok, false);
  assert.equal(result.code, "writeFailed");
  assert.equal(typeof result.error, "string");
  assert.deepEqual(result.installed, ["packrat-bridge.py"], "the one script installed before the failure is reported");
  assert.ok(existsSync(join(scriptsDir, "packrat-bridge.py")), "the already-succeeded install is left in place");
  const leftoverNew = readdirSync(scriptsDir).filter((f) => f.endsWith(".new"));
  assert.deepEqual(leftoverNew, [], "no dangling .new file from the failed write");
  assert.equal(existsSync(join(scriptsDir, "packrat-scanner.py")), false, "the loop stopped at the failure, not past it");
});

// Post-review fix: an alive timestamp that is AHEAD of this machine's clock must not block install
// forever — only ordinary clock skew (a few seconds/minutes) should still count as "running".
test("[fast] installScripts treats an alive timestamp more than 5 minutes in the future as stale, not indefinitely running", () => {
  const bridgeDir = tmp("qm-is-future-");
  const sp = join(bridgeDir, "status.json");
  writeFileSync(sp, JSON.stringify({ alive: new Date(Date.now() + 10 * 60_000).toISOString() }));   // 10 min ahead
  const scriptsDir = tmp("qm-is-future-dest-");
  const result = installScripts({ adapter: "tazuo", adaptersDir: fakeAdaptersDir(), scriptsDir, dataDir: tmp("qm-is-data-"), bridgeStatusPath: sp });
  assert.equal(result.ok, true, JSON.stringify(result));
});
test("[fast] installScripts still refuses when alive is only slightly ahead (ordinary clock skew, within tolerance)", () => {
  const bridgeDir = tmp("qm-is-slight-future-");
  const sp = join(bridgeDir, "status.json");
  writeFileSync(sp, JSON.stringify({ alive: new Date(Date.now() + 5_000).toISOString() }));   // 5s ahead
  const scriptsDir = tmp("qm-is-slight-future-dest-");
  const result = installScripts({ adapter: "tazuo", adaptersDir: fakeAdaptersDir(), scriptsDir, dataDir: tmp("qm-is-data-"), bridgeStatusPath: sp });
  assert.deepEqual(result, { ok: false, code: "running", error: RUNNING_MESSAGE });
});

// installScripts is parameterised by adapter+adaptersDir already, but nothing previously proved two
// real, differently-shaped adapters living in the same adaptersDir stay isolated from each other —
// this is that proof, with the two adapters that actually ship side by side today.
test("[fast] installScripts for one adapter never copies another adapter's scripts into scriptsDir", () => {
  const adaptersDir = fakeMultiAdaptersDir();
  const scriptsDir = tmp("qm-is-isolation-dest-");
  const result = installScripts({ adapter: "razor-enhanced", adaptersDir, scriptsDir, dataDir: tmp("qm-is-data-"), bridgeStatusPath: join(scriptsDir, "no-status.json") });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(result.installed.sort(), ["packrat-bridge.py", "packrat-scanner.py"]);
  assert.equal(existsSync(join(scriptsDir, "packrat-refresh.py")), false, "tazuo's refresh script (razor-enhanced ships none) was not copied");
  for (const name of result.installed) {
    const srcBuf = readFileSync(join(adaptersDir, "razor-enhanced", name));
    const destBuf = readFileSync(join(scriptsDir, name));
    assert.ok(srcBuf.equals(destBuf), `${name} came from razor-enhanced's own folder, not tazuo's`);
  }
});

// A paste-transport adapter has no scripts folder to write to at all (see docs/adapter-guide.md) — it
// must never be offered for installation, and installScripts itself must refuse it before touching
// the filesystem, the same defence-in-depth discipline the badAdapter tests above apply to a
// traversal/unknown id.
test("[fast] installScripts refuses a paste-transport adapter with code noInstall before touching the filesystem", () => {
  const adaptersDir = fakeWebAdapterDir();
  const scriptsDir = tmp("qm-is-paste-dest-");
  const result = installScripts({ adapter: "classicuo-web", adaptersDir, scriptsDir, dataDir: tmp("qm-is-data-"), bridgeStatusPath: join(scriptsDir, "no-status.json") });
  assert.equal(result.ok, false);
  assert.equal(result.code, "noInstall", JSON.stringify(result));
  assert.match(result.error, /nothing to install/);
  assert.deepEqual(readdirSync(scriptsDir), [], "nothing was written for a paste-transport adapter");
});

// ---- importScans ---------------------------------------------------------------------------------------

test("[fast] importScans copies only *.json, skips duplicates, and never removes the source", () => {
  const dir = tmp("qm-import-src-");
  writeFileSync(join(dir, "a.json"), JSON.stringify({ a: 1 }));
  writeFileSync(join(dir, "b.json"), JSON.stringify({ b: 1 }));
  writeFileSync(join(dir, "notes.txt"), "not a scan");
  mkdirSync(join(dir, "subdir"), { recursive: true });
  writeFileSync(join(dir, "subdir", "nested.json"), JSON.stringify({ nested: true }));

  const inboxDir = tmp("qm-import-inbox-");
  writeFileSync(join(inboxDir, "a.json"), JSON.stringify({ already: "here" }));   // pre-existing duplicate

  const result = importScans({ dir, inboxDir });
  assert.deepEqual(result, { copied: 1, skipped: 1 });   // b.json copied; a.json skipped (already present)
  assert.deepEqual(JSON.parse(readFileSync(join(inboxDir, "a.json"), "utf8")), { already: "here" }, "the pre-existing file was not overwritten");
  assert.deepEqual(JSON.parse(readFileSync(join(inboxDir, "b.json"), "utf8")), { b: 1 });
  assert.equal(existsSync(join(inboxDir, "nested.json")), false, "nested files are not copied (top level only)");
  assert.equal(existsSync(join(inboxDir, "notes.txt")), false);

  assert.deepEqual(readdirSync(dir).sort(), ["a.json", "b.json", "notes.txt", "subdir"], "nothing was removed from the source");
  assert.deepEqual(readdirSync(inboxDir).filter((f) => f.endsWith(".tmp")), [], "no leftover .tmp files");
});

test("[fast] importScans on a missing source dir copies nothing", () => {
  const inboxDir = tmp("qm-import-inbox-missing-");
  assert.deepEqual(importScans({ dir: join(inboxDir, "does-not-exist"), inboxDir }), { copied: 0, skipped: 0 });
});

// Post-review fix: a *.json symlink in the source folder must not have its TARGET's bytes copied —
// lstatSync (not statSync) is what tells a symlink apart from a regular file without following it.
test("[fast] importScans does not follow a *.json symlink (only the real file is copied)", () => {
  const dir = tmp("qm-import-symlink-src-");
  const target = tmp("qm-import-symlink-target-");
  writeFileSync(join(target, "secret.json"), JSON.stringify({ should: "never be copied by name link.json" }));
  writeFileSync(join(dir, "real.json"), JSON.stringify({ ok: true }));
  const linkPath = join(dir, "link.json");
  let madeSymlink = true;
  try { symlinkSync(join(target, "secret.json"), linkPath); }
  catch { madeSymlink = false; }   // symlink creation can require elevated privilege on some platforms
  const inboxDir = tmp("qm-import-symlink-inbox-");
  const result = importScans({ dir, inboxDir });
  assert.equal(existsSync(join(inboxDir, "real.json")), true);
  if (madeSymlink) {
    assert.equal(result.copied, 1, "only the real file was copied, the symlink was skipped");
    assert.equal(existsSync(join(inboxDir, "link.json")), false, "the symlink itself was never copied under");
  }
});

// ---- repoFromPackage -------------------------------------------------------------------------------------

test("[fast] repoFromPackage resolves github: shorthand, an https .git URL, and {url}, and rejects non-GitHub", () => {
  assert.equal(repoFromPackage({ repository: "github:someowner/somename" }), "someowner/somename");
  assert.equal(repoFromPackage({ repository: "https://github.com/someowner/somename.git" }), "someowner/somename");
  assert.equal(repoFromPackage({ repository: { url: "git+https://github.com/someowner/somename.git" } }), "someowner/somename");
  assert.equal(repoFromPackage({ repository: "https://gitlab.com/someowner/somename.git" }), null);
  assert.equal(repoFromPackage({}), null);
  assert.equal(repoFromPackage(null), null);
});

// ---- checkForUpdates --------------------------------------------------------------------------------------

test("[fast] checkForUpdates: configured false with no repo (no fetchImpl call needed)", async () => {
  let called = false;
  const fetchImpl = async () => { called = true; throw new Error("must not be called"); };
  const result = await checkForUpdates({ current: "0.1.0", repo: null, fetchImpl });
  assert.deepEqual(result, { configured: false });
  assert.equal(called, false);
});

test("[fast] checkForUpdates: upToDate true when current >= latest, and carries the release html_url", async () => {
  const fetchImpl = async (url) => {
    assert.match(url, /^https:\/\/api\.github\.com\/repos\/owner\/name\/releases\/latest$/);
    return { status: 200, json: async () => ({ tag_name: "v0.1.0", html_url: "https://github.com/owner/name/releases/tag/v0.1.0" }) };
  };
  const result = await checkForUpdates({ current: "0.1.0", repo: "owner/name", fetchImpl });
  assert.deepEqual(result, { configured: true, current: "0.1.0", latest: "0.1.0", url: "https://github.com/owner/name/releases/tag/v0.1.0", upToDate: true });
});

test("[fast] checkForUpdates: upToDate false when a newer release exists", async () => {
  const fetchImpl = async () => ({ status: 200, json: async () => ({ tag_name: "v0.9.0", html_url: "https://github.com/owner/name/releases/tag/v0.9.0" }) });
  const result = await checkForUpdates({ current: "0.1.0", repo: "owner/name", fetchImpl });
  assert.equal(result.upToDate, false);
  assert.equal(result.latest, "0.9.0");
});

test("[fast] checkForUpdates: a non-200 response reports configured:true with an error, not a throw", async () => {
  const fetchImpl = async () => ({ status: 404, json: async () => ({}) });
  const result = await checkForUpdates({ current: "0.1.0", repo: "owner/name", fetchImpl });
  assert.equal(result.configured, true);
  assert.equal(typeof result.error, "string");
});
