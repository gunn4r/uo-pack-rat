// installer.test.mts — app/installer.mts: adapter discovery, client-folder detection, script
// install/verify, scan import, and the GitHub-releases update check. All [fast] — tmp dirs only, no
// real network (checkForUpdates takes an injected fetchImpl in every test here).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, lstatSync, chmodSync, cpSync, symlinkSync, truncateSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import {
  listAdapters, candidateClientRoots, validateScriptsDir, installedVersion, installScripts,
  importScans, repoFromPackage, checkForUpdates, checkScriptsDataDir, RUNNING_MESSAGE,
} from "./installer.mts";
import { MAX_INBOX_BYTES } from "./watcher.mts";

const HERE = dirname(fileURLToPath(import.meta.url));
const REAL_ADAPTERS_DIR = join(HERE, "..", "adapters");
// Read, never hard-coded: an adapter version bump must not need an edit here.
const TAZUO_VERSION = (JSON.parse(readFileSync(join(REAL_ADAPTERS_DIR, "tazuo", "capabilities.json"), "utf8")) as { version: string }).version;
const tmp = (prefix: string): string => mkdtempSync(join(tmpdir(), prefix));

// Creating a symlink needs elevated privilege (or Developer Mode) on Windows, and a FIFO can't be
// created there at all — the Phase 7 path-handling tests below pin behaviour against exactly those
// two file types, so each one that can't build its own setup returns early instead of failing. The
// same shape as the existing importScans symlink test's `madeSymlink` flag, hoisted so every case
// that needs it says so the same way. CI runs ubuntu/macos/windows, so this is a real path.
function trySymlink(target: string, path: string): boolean {
  try { symlinkSync(target, path); return true; }
  catch { return false; }
}

function tryFifo(path: string): boolean {
  if (process.platform === "win32") return false;
  try { execFileSync("mkfifo", [path]); return true; }
  catch { return false; }
}

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
  const tazuo = adapters[0]!;
  assert.equal(tazuo.id, "tazuo");
  assert.deepEqual(tazuo.scripts.sort(), ["packrat-bridge.py", "packrat-refresh.py", "packrat-scanner.py"]);
  const tazuoCaps = tazuo.capabilities as { bank?: unknown };
  assert.ok(tazuoCaps && tazuoCaps.bank, JSON.stringify(tazuo.capabilities));
  assert.match(tazuo.summary, /grab/);
  assert.equal(typeof tazuo.name, "string");
  assert.ok(tazuo.name.length > 0);
  assert.equal(tazuo.transport, "folder");
  assert.equal(tazuo.platform, null, "tazuo has no platform restriction — capabilities.json carries no platform field");
});

// Phase 6 final review follow-up: capabilities.json's optional top-level `platform` field (see
// docs/adapter-guide.md's "Platform restriction") must surface on the object listAdapters returns —
// this is what app/ui/adapters.mts's platformCompatible reads instead of hard-coding an adapter id.
test("[fast] listAdapters surfaces razor-enhanced's platform:\"win32\" from its real capabilities.json", () => {
  const adapters = listAdapters(fakeMultiAdaptersDir());
  const razor = adapters.find((a) => a.id === "razor-enhanced");
  assert.ok(razor, JSON.stringify(adapters.map((a) => a.id)));
  assert.equal(razor.platform, "win32");
  const tazuo = adapters.find((a) => a.id === "tazuo");
  assert.equal(tazuo!.platform, null);
});

test("[fast] listAdapters reports transport:\"paste\" and no scripts for the classicuo-web adapter", () => {
  const adapters = listAdapters(fakeWebAdapterDir());
  assert.equal(adapters.length, 1);
  const web = adapters[0]!;
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
  const exists = (p: string) => p === desktop || p === documents;
  const out = candidateClientRoots({ adapter: "tazuo", home, platform: "darwin", env: {}, exists });
  assert.deepEqual(out, [desktop, documents]);
});

test("[fast] candidateClientRoots reports one hit per root even when both its nested and direct forms exist", () => {
  const home = "/h";
  const nested = join(home, "Desktop", "TazUO", "TazUO", "LegionScripts");
  const direct = join(home, "Desktop", "TazUO", "LegionScripts");
  const exists = (p: string) => p === nested || p === direct;   // both qualify for the same root
  const out = candidateClientRoots({ adapter: "tazuo", home, platform: "darwin", env: {}, exists });
  assert.deepEqual(out, [nested], "the nested (real-world) layout wins over the direct one for the same root, with no duplicate entry");
});

test("[fast] candidateClientRoots adds LOCALAPPDATA and C:\\TazUO on win32", () => {
  const home = "C:\\Users\\example";
  const localAppData = "C:\\Users\\example\\AppData\\Local";
  const winLegion = join(`${localAppData}/TazUO`, "LegionScripts");
  const cRootLegion = join("C:\\TazUO", "LegionScripts");
  const exists = (p: string) => p === winLegion || p === cRootLegion;
  const out = candidateClientRoots({ adapter: "tazuo", home, platform: "win32", env: { LOCALAPPDATA: localAppData }, exists });
  assert.deepEqual(out, [winLegion, cRootLegion]);
});

test("[fast] candidateClientRoots returns [] for an unknown adapter or a missing home", () => {
  assert.deepEqual(candidateClientRoots({ adapter: "nope", home: "/h", exists: () => true }), []);
  assert.deepEqual(candidateClientRoots({ adapter: "tazuo", home: "", exists: () => true }), []);
});

// Razor Enhanced has no fixed install location (its own official docs say only "unpack in your own
// folder, run Razor.exe" — see app/installer.mts's NESTED_SCRIPTS_SUFFIX comment), so unlike tazuo it
// has no entry in CANDIDATE_ROOT_NAME and candidateClientRoots must propose nothing for it — on any
// platform, even win32, and even when a folder that would match one of its NESTED_SCRIPTS_SUFFIX
// shapes actually exists. The manual folder picker (validateScriptsDir, below) is the only path.
test("[fast] candidateClientRoots proposes nothing for razor-enhanced (no known install location), on any platform", () => {
  const home = "C:\\Users\\example";
  const scripts = join(home, "Desktop", "CUOLauncher", "Razor", "Scripts");
  const exists = (p: string) => p === scripts;
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
  const exists = (p: string) => p === legionScripts;
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

// Post-review fix (security, Phase 7): both NESTED_SCRIPTS_SUFFIX and CANDIDATE_ROOT_NAME are plain
// object literals, so a prototype-chain key used to resolve to something truthy and defeat the
// fallback — validateScriptsDir("/tmp", "constructor") threw "suffixes.map is not a function" and
// candidateClientRoots threw ERR_INVALID_ARG_TYPE out of path.join, instead of the documented
// not-found result. Neither is reachable through a route (every one checks the id against
// listAdapters first), but both functions are typed and documented to accept an UNKNOWN adapter and
// degrade gracefully, and that contract has to actually hold.
test("[fast] validateScriptsDir and candidateClientRoots degrade gracefully on a prototype-chain adapter id", () => {
  const dir = tmp("qm-vsd-proto-");
  for (const adapter of ["constructor", "__proto__", "toString", "valueOf", "hasOwnProperty"]) {
    // The picked folder itself exists, so the tazuo fallback shape accepts it — the point is that it
    // returns a result at all rather than throwing.
    assert.deepEqual(validateScriptsDir(dir, adapter), { ok: true, scriptsDir: dir }, adapter);
    assert.equal(validateScriptsDir(join(dir, "does-not-exist"), adapter).ok, false, adapter);
    assert.deepEqual(candidateClientRoots({ adapter, home: "/Users/example", platform: "darwin", env: {}, exists: () => true }), [], adapter);
  }
});

// Post-review fix (security, Phase 7): "\\host\share" is a perfectly good absolute path on win32, and
// the first thing done with an accepted scriptsDir is a readdirSync — an outbound SMB connection to a
// host the caller named, i.e. an NTLM authentication attempt against it, repeated on every later
// GET /api/setup because the value is persisted. The shape is refused before any filesystem call, on
// every platform (POSIX gains nothing from a leading "//" either), and so is a relative path.
test("[fast] validateScriptsDir rejects a UNC/device path and a relative path on their shape alone", () => {
  for (const dir of ["\\\\host\\share", "\\\\host\\share\\Scripts", "//host/share", "\\\\?\\C:\\Scripts"]) {
    const result = validateScriptsDir(dir, "tazuo");
    assert.equal(result.ok, false, dir);
    assert.match(result.error, /UNC or device path/, dir);
  }
  for (const dir of ["relative/path", "./Scripts", "Scripts"]) {
    const result = validateScriptsDir(dir, "tazuo");
    assert.equal(result.ok, false, dir);
    assert.match(result.error, /absolute path/, dir);
  }
});

// ---- installedVersion ---------------------------------------------------------------------------------

test("[fast] installedVersion reads the adapter version after an install and null before", () => {
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
  assert.equal(after.version, TAZUO_VERSION);
  assert.equal(after.files["packrat-scanner.py"], true);
  assert.equal(after.files["packrat-refresh.py"], true);
  assert.equal(after.files["packrat-bridge.py"], true);
});

// Post-review fix (security, Phase 7): scriptNamesIn now reads withFileTypes and keeps only regular
// files, so a name that merely LOOKS like a script is never opened. A symlink used to be followed
// (GET /api/setup would report an unrelated file's ADAPTER_VERSION capture — a read oracle over any
// persisted scriptsDir), and a FIFO used to block readFileSync forever, hanging the whole
// single-threaded server with no recovery short of hand-editing settings.json.
test("[fast] installedVersion skips a symlinked, FIFO or directory packrat-scanner.py rather than reading it", () => {
  const scriptsDir = tmp("qm-iv-notafile-");
  const outside = tmp("qm-iv-notafile-target-");
  const target = join(outside, "other.py");
  writeFileSync(target, 'ADAPTER_VERSION = "9.9.9"\n');

  if (trySymlink(target, join(scriptsDir, "packrat-scanner.py"))) {
    const linked = installedVersion(scriptsDir, "tazuo");
    assert.equal(linked.version, null, "a symlink is not a script — its target's version is never reported");
    assert.deepEqual(linked.files, {}, "and the name isn't reported as installed either");
  }

  const fifoDir = tmp("qm-iv-fifo-");
  if (tryFifo(join(fifoDir, "packrat-scanner.py"))) {
    const fifo = installedVersion(fifoDir, "tazuo");   // must RETURN — a regression here blocks forever
    assert.deepEqual(fifo, { version: null, files: {} });
  }

  const dirDir = tmp("qm-iv-dir-");
  mkdirSync(join(dirDir, "packrat-scanner.py"), { recursive: true });
  assert.deepEqual(installedVersion(dirDir, "tazuo"), { version: null, files: {} }, "a directory under a script's name is not a script");
});

// Post-review fix (security, Phase 7): the version read is bounded (64 KiB from the head of the file)
// rather than slurping whatever is under the name — an ordinary huge file in a persisted scriptsDir
// was a memory-exhaustion variant of the FIFO hang above. A real adapter script is ~13 KB with its
// ADAPTER_VERSION line near the top, so the cap never bites in practice.
test("[fast] installedVersion reads a bounded head of the script, not the whole file", () => {
  const near = tmp("qm-iv-bounded-near-");
  writeFileSync(join(near, "packrat-scanner.py"), `ADAPTER_VERSION = "1.2.3"\n${"#".repeat(300_000)}\n`);
  assert.equal(installedVersion(near, "tazuo").version, "1.2.3", "a version line in the head is still found");

  const far = tmp("qm-iv-bounded-far-");
  writeFileSync(join(far, "packrat-scanner.py"), `${"#".repeat(300_000)}\nADAPTER_VERSION = "1.2.3"\n`);
  const result = installedVersion(far, "tazuo");
  assert.equal(result.version, null, "nothing past the cap is read");
  assert.equal(result.files["packrat-scanner.py"], true, "the file is still reported as installed");
});

// ---- checkScriptsDataDir --------------------------------------------------------------------------------
// Every case builds its own temp home and scripts folder; nothing here looks at the real home folder.
// platform is passed explicitly so the win32-only candidate roots (LOCALAPPDATA, C:\TazUO) are never
// probed, and so the case-folding rule under test is the one named, not whatever machine runs it.

const TAZUO_ONLY = [{ id: "tazuo", platform: null }];
// A scripts folder holding one Pack Rat script and, when `paths` is a string, that packrat-paths.json.
function scriptsFolder(prefix: string, paths?: string): string {
  const dir = tmp(prefix);
  writeFileSync(join(dir, "packrat-scanner.py"), 'ADAPTER_VERSION = "1.0.0"\n');
  if (paths !== undefined) writeFileSync(join(dir, "packrat-paths.json"), paths);
  return dir;
}
const pathsJson = (dataDir: unknown): string => `${JSON.stringify({ dataDir }, null, 1)}\n`;

test("[fast] checkScriptsDataDir: a configured client whose packrat-paths.json names this data folder is a match", () => {
  const dataDir = tmp("qm-dd-data-");
  const scriptsDir = scriptsFolder("qm-dd-match-", pathsJson(dataDir));
  const r = checkScriptsDataDir({ dataDir, client: { adapter: "tazuo", scriptsDir }, adapters: TAZUO_ONLY, home: tmp("qm-dd-home-"), platform: "linux" });
  assert.equal(r.status, "match");
  assert.equal(r.status === "match" && r.scriptsDir, scriptsDir);
});

test("[fast] checkScriptsDataDir: a configured client whose scripts write elsewhere is a mismatch naming both folders", () => {
  const dataDir = tmp("qm-dd-data-"), other = tmp("qm-dd-other-");
  const scriptsDir = scriptsFolder("qm-dd-mismatch-", pathsJson(other));
  const r = checkScriptsDataDir({ dataDir, client: { adapter: "tazuo", scriptsDir }, adapters: TAZUO_ONLY, home: tmp("qm-dd-home-"), platform: "linux" });
  assert.deepEqual(r, { status: "mismatch", scriptsDir, scriptsDataDir: other, dataDir });
});

test("[fast] checkScriptsDataDir: no packrat-paths.json is compared against the scripts' own default, ~/.pack-rat", () => {
  const home = tmp("qm-dd-home-");
  const scriptsDir = scriptsFolder("qm-dd-nofile-");
  const client = { adapter: "tazuo", scriptsDir };
  mkdirSync(join(home, ".pack-rat"));
  assert.equal(checkScriptsDataDir({ dataDir: join(home, ".pack-rat"), client, adapters: TAZUO_ONLY, home, platform: "linux" }).status, "match", "the app on its own default and scripts on theirs agree");
  const devData = tmp("qm-dd-dev-");
  assert.deepEqual(checkScriptsDataDir({ dataDir: devData, client, adapters: TAZUO_ONLY, home, platform: "linux" }),
    { status: "mismatch", scriptsDir, scriptsDataDir: join(home, ".pack-rat"), dataDir: devData });
  // The scripts treat an empty or missing dataDir exactly like a missing file (`if d:` in data_dir()).
  for (const body of [pathsJson(""), "{}\n", pathsJson(null)]) {
    const dir = scriptsFolder("qm-dd-empty-", body);
    assert.equal(checkScriptsDataDir({ dataDir: join(home, ".pack-rat"), client: { adapter: "tazuo", scriptsDir: dir }, adapters: TAZUO_ONLY, home, platform: "linux" }).status, "match", body);
  }
});

test("[fast] checkScriptsDataDir: a malformed packrat-paths.json is reported, never thrown", () => {
  const dataDir = tmp("qm-dd-data-"), home = tmp("qm-dd-home-");
  for (const body of ["{not json", "[1, 2]\n", pathsJson(42), `{"dataDir": "${"x".repeat(70_000)}"}`]) {
    const scriptsDir = scriptsFolder("qm-dd-bad-", body);
    const r = checkScriptsDataDir({ dataDir, client: { adapter: "tazuo", scriptsDir }, adapters: TAZUO_ONLY, home, platform: "linux" });
    assert.equal(r.status, "unreadable", body.slice(0, 40));
    assert.ok(r.status === "unreadable" && r.scriptsDir === scriptsDir && r.error.length > 0, "names the folder and says why");
  }
});

test("[fast] checkScriptsDataDir: a symlinked packrat-paths.json is not followed", (t) => {
  const dataDir = tmp("qm-dd-data-");
  const target = join(tmp("qm-dd-target-"), "elsewhere.json");
  writeFileSync(target, pathsJson(dataDir));
  const scriptsDir = scriptsFolder("qm-dd-link-");
  if (!trySymlink(target, join(scriptsDir, "packrat-paths.json"))) { t.skip("symlinks need privilege here"); return; }
  const r = checkScriptsDataDir({ dataDir, client: { adapter: "tazuo", scriptsDir }, adapters: TAZUO_ONLY, home: tmp("qm-dd-home-"), platform: "linux" });
  assert.equal(r.status, "unreadable", "a symlink is refused like any other file that isn't a regular file, even one naming the right folder");
});

test("[fast] checkScriptsDataDir: the same folder written differently is still a match", (t) => {
  const home = tmp("qm-dd-home-");
  const dataDir = join(home, "packrat-data");
  mkdirSync(dataDir);
  const same = (written: string, platform: NodeJS.Platform = "linux", appDir = dataDir): string => {
    const scriptsDir = scriptsFolder("qm-dd-same-", pathsJson(written));
    return checkScriptsDataDir({ dataDir: appDir, client: { adapter: "tazuo", scriptsDir }, adapters: TAZUO_ONLY, home, platform }).status;
  };
  assert.equal(same(`${dataDir}/`), "match", "trailing slash");
  assert.equal(same("~/packrat-data"), "match", "~ for the home folder");
  assert.equal(same(join(dataDir, "..", "packrat-data")), "match", "a .. segment");
  // A folder that doesn't exist yet can't be canonicalised by the filesystem, so the platform's case rule
  // decides (an existing one is already folded by realpath on a case-insensitive disk).
  const notYet = join(home, "Not-Created-Yet");
  assert.equal(same(notYet.toUpperCase(), "darwin", notYet), "match", "case differs on a case-insensitive platform");
  assert.equal(same(notYet.toUpperCase(), "win32", notYet), "match", "and on Windows");
  assert.equal(same(notYet.toUpperCase(), "linux", notYet), "mismatch", "but not on a case-sensitive one");
  const link = join(home, "linked-data");
  if (!trySymlink(dataDir, link)) { t.skip("symlinks need privilege here"); return; }
  assert.equal(same(link), "match", "a symlink to the app's data folder");
  assert.equal(same(dataDir, "linux", link), "match", "the app started through a symlink to the scripts' folder");
});

test("[fast] checkScriptsDataDir: nothing configured and nothing detected says nothing", () => {
  const r = checkScriptsDataDir({ dataDir: tmp("qm-dd-data-"), client: null, adapters: TAZUO_ONLY, home: tmp("qm-dd-home-"), platform: "linux" });
  assert.deepEqual(r, { status: "none" });
});

test("[fast] checkScriptsDataDir: a folder with no Pack Rat scripts in it says nothing", () => {
  const scriptsDir = tmp("qm-dd-empty-client-");
  const r = checkScriptsDataDir({ dataDir: tmp("qm-dd-data-"), client: { adapter: "tazuo", scriptsDir }, adapters: TAZUO_ONLY, home: tmp("qm-dd-home-"), platform: "linux" });
  assert.deepEqual(r, { status: "none" }, "no script there writes anywhere, so there is nothing to compare");
});

test("[fast] checkScriptsDataDir: with no client configured, the auto-detected client folder is checked", () => {
  const home = tmp("qm-dd-home-"), dataDir = tmp("qm-dd-data-"), other = tmp("qm-dd-other-");
  const legion = join(home, "Desktop", "TazUO", "TazUO", "LegionScripts");
  mkdirSync(legion, { recursive: true });
  writeFileSync(join(legion, "packrat-bridge.py"), "#\n");
  writeFileSync(join(legion, "packrat-paths.json"), pathsJson(other));
  const r = checkScriptsDataDir({ dataDir, client: null, adapters: TAZUO_ONLY, home, platform: "linux" });
  assert.deepEqual(r, { status: "mismatch", scriptsDir: legion, scriptsDataDir: other, dataDir });
  // A second detected folder that does match wins: the player may be using either one.
  const docs = join(home, "Documents", "TazUO", "LegionScripts");
  mkdirSync(docs, { recursive: true });
  writeFileSync(join(docs, "packrat-bridge.py"), "#\n");
  writeFileSync(join(docs, "packrat-paths.json"), pathsJson(dataDir));
  assert.equal(checkScriptsDataDir({ dataDir, client: null, adapters: TAZUO_ONLY, home, platform: "linux" }).status, "match");
});

// ---- installScripts -----------------------------------------------------------------------------------

function statusPath(dir: string): string { return join(dir, "status.json"); }

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
  assert.equal(result.version, TAZUO_VERSION);
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

// Post-review fix (security, Phase 7): the temp file each script is copied through is randomly named
// and opened O_EXCL, so a symlink pre-planted at the old, published "<name>.new" is never the path
// written. This is a real precondition, not a contrived one: a game-client folder in this ecosystem
// is routinely an unpacked third-party archive, and an archive may contain symlinks. Before the fix
// the install truncated and rewrote the symlink's target — anywhere the player could write — returned
// ok:true with no warning, and then renamed the SYMLINK into the final name, so every later install,
// upgrade and Settings "Reinstall" wrote through it too.
test("[fast] installScripts never writes through a symlink pre-planted at a script's temp name", () => {
  const scriptsDir = tmp("qm-is-tmplink-dest-");
  const outside = tmp("qm-is-tmplink-outside-");
  const canary = join(outside, "canary.txt");
  writeFileSync(canary, "untouched");
  if (!trySymlink(canary, join(scriptsDir, "packrat-scanner.py.new"))) return;
  const result = installScripts({ adapter: "tazuo", adaptersDir: fakeAdaptersDir(), scriptsDir, dataDir: tmp("qm-is-data-"), bridgeStatusPath: join(scriptsDir, "no-status.json") });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(readFileSync(canary, "utf8"), "untouched", "the file the planted symlink pointed at was never written");
  assert.equal(lstatSync(join(scriptsDir, "packrat-scanner.py")).isFile(), true, "the installed script is a real file, not the planted symlink renamed into place");
});

// The final-name case: a rename over a symlink already replaced the link rather than writing through
// it (safe by accident), but the file is now refused outright instead — the folder isn't in the shape
// an install expects, and silently replacing a link the player put there is its own surprise. Pinned
// so the temp-name rewrite above can't quietly regress it either way.
test("[fast] installScripts refuses a destination that is a symlink rather than writing through it", () => {
  const scriptsDir = tmp("qm-is-destlink-dest-");
  const outside = tmp("qm-is-destlink-outside-");
  const canary = join(outside, "canary.txt");
  writeFileSync(canary, "untouched");
  if (!trySymlink(canary, join(scriptsDir, "packrat-scanner.py"))) return;
  const result = installScripts({ adapter: "tazuo", adaptersDir: fakeAdaptersDir(), scriptsDir, dataDir: tmp("qm-is-data-"), bridgeStatusPath: join(scriptsDir, "no-status.json") });
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal(result.code, "writeFailed");
  assert.match(result.error, /symlink/);
  assert.equal(readFileSync(canary, "utf8"), "untouched");
  assert.deepEqual(result.installed, ["packrat-bridge.py", "packrat-refresh.py"], "the scripts installed before the refusal are reported");
  assert.deepEqual(readdirSync(scriptsDir).filter((f) => f.endsWith(".new")), [], "no dangling temp file");
});

// packrat-paths.json used to be the one write here that wasn't a temp-then-rename at all — a bare
// writeFileSync, which follows a symlink at the destination. Same preconditions as the test above,
// and a second, independent vector: fixing only the script writes would have left this one open.
test("[fast] installScripts refuses a symlinked packrat-paths.json rather than writing through it", () => {
  const scriptsDir = tmp("qm-is-pathslink-dest-");
  const outside = tmp("qm-is-pathslink-outside-");
  const canary = join(outside, "canary.json");
  writeFileSync(canary, '{"untouched": true}');
  if (!trySymlink(canary, join(scriptsDir, "packrat-paths.json"))) return;
  const result = installScripts({ adapter: "tazuo", adaptersDir: fakeAdaptersDir(), scriptsDir, dataDir: "/some/data/dir", bridgeStatusPath: join(scriptsDir, "no-status.json") });
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal(result.code, "writeFailed");
  assert.deepEqual(JSON.parse(readFileSync(canary, "utf8")), { untouched: true });
});

test("[fast] installScripts leaves no temp file behind and reports pathsFile on a clean install", () => {
  const scriptsDir = tmp("qm-is-notemp-dest-");
  const result = installScripts({ adapter: "tazuo", adaptersDir: fakeAdaptersDir(), scriptsDir, dataDir: "/some/data/dir", bridgeStatusPath: join(scriptsDir, "no-status.json") });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.pathsFile, "written");
  const leftovers = readdirSync(scriptsDir).filter((f) => !f.endsWith(".py") && f !== "packrat-paths.json");
  assert.deepEqual(leftovers, [], "no packrat-paths.json.<random>.new or script temp survives");
});

// Post-review fix (correctness, Phase 7): adapters/razor-enhanced/README.md's install step 2 tells the
// player to hand-author packrat-paths.json with a dataDir reachable from the WINDOWS machine running
// the client — by construction not this machine's dataDir. Overwriting it unconditionally undid that
// documented cross-machine setup on the next install or Settings "Reinstall", with no message, and
// the symptom (scans simply stop arriving) points nowhere near the cause.
test("[fast] installScripts keeps a hand-authored packrat-paths.json naming a different dataDir", () => {
  const scriptsDir = tmp("qm-is-pathskeep-dest-");
  const authored = '{\n "dataDir": "Z:\\\\pack-rat"\n}\n';
  writeFileSync(join(scriptsDir, "packrat-paths.json"), authored);
  const result = installScripts({ adapter: "tazuo", adaptersDir: fakeAdaptersDir(), scriptsDir, dataDir: "/some/data/dir", bridgeStatusPath: join(scriptsDir, "no-status.json") });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.pathsFile, "kept", "the install reports that it kept the player's file, so the UI can say so");
  assert.equal(readFileSync(join(scriptsDir, "packrat-paths.json"), "utf8"), authored, "byte-identical — not even reformatted");
  assert.equal(existsSync(join(scriptsDir, "packrat-paths.json.bak")), false, "nothing was written, so there's nothing to back up");
  assert.deepEqual(result.installed.sort(), ["packrat-bridge.py", "packrat-refresh.py", "packrat-scanner.py"], "the scripts themselves still install");
});

test("[fast] installScripts rewrites a packrat-paths.json naming this same dataDir, and backs up one that isn't in the documented shape", () => {
  const same = tmp("qm-is-pathssame-dest-");
  writeFileSync(join(same, "packrat-paths.json"), '{"dataDir": "/some/data/dir"}');
  const sameResult = installScripts({ adapter: "tazuo", adaptersDir: fakeAdaptersDir(), scriptsDir: same, dataDir: "/some/data/dir", bridgeStatusPath: join(same, "no-status.json") });
  assert.equal(sameResult.ok, true, JSON.stringify(sameResult));
  assert.equal(sameResult.pathsFile, "written", "same dataDir, different formatting — nothing of the player's is lost by rewriting it");
  assert.deepEqual(JSON.parse(readFileSync(join(same, "packrat-paths.json"), "utf8")), { dataDir: "/some/data/dir" });

  const junk = tmp("qm-is-pathsjunk-dest-");
  writeFileSync(join(junk, "packrat-paths.json"), "not json at all");
  const junkResult = installScripts({ adapter: "tazuo", adaptersDir: fakeAdaptersDir(), scriptsDir: junk, dataDir: "/some/data/dir", bridgeStatusPath: join(junk, "no-status.json") });
  assert.equal(junkResult.ok, true, JSON.stringify(junkResult));
  assert.equal(junkResult.pathsFile, "backed-up");
  assert.equal(readFileSync(join(junk, "packrat-paths.json.bak"), "utf8"), "not json at all", "the unreadable file is preserved beside the new one, never simply dropped");
  assert.deepEqual(JSON.parse(readFileSync(join(junk, "packrat-paths.json"), "utf8")), { dataDir: "/some/data/dir" });
});

// Finding 7: the dirname(srcDir) check is purely lexical — path.resolve and path.dirname touch no
// filesystem and resolve no symlink, so an adaptersDir reached through a symlink installs exactly as a
// real directory does. That is the actual behaviour; this pins it so the code and the comment beside
// it (which used to claim a symlink defence this check does not give) cannot disagree again.
test("[fast] installScripts installs normally when adaptersDir is reached through a symlink", () => {
  const real = fakeAdaptersDir();
  const linkDir = tmp("qm-is-adapterslink-");
  const link = join(linkDir, "adapters");
  if (!trySymlink(real, link)) return;
  const scriptsDir = tmp("qm-is-adapterslink-dest-");
  const result = installScripts({ adapter: "tazuo", adaptersDir: link, scriptsDir, dataDir: tmp("qm-is-data-"), bridgeStatusPath: join(scriptsDir, "no-status.json") });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(result.installed.sort(), ["packrat-bridge.py", "packrat-refresh.py", "packrat-scanner.py"]);
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
  assert.deepEqual(result, { copied: 1, skipped: 1, failed: 0, failures: [] });   // b.json copied; a.json skipped (already present)
  assert.deepEqual(JSON.parse(readFileSync(join(inboxDir, "a.json"), "utf8")), { already: "here" }, "the pre-existing file was not overwritten");
  assert.deepEqual(JSON.parse(readFileSync(join(inboxDir, "b.json"), "utf8")), { b: 1 });
  assert.equal(existsSync(join(inboxDir, "nested.json")), false, "nested files are not copied (top level only)");
  assert.equal(existsSync(join(inboxDir, "notes.txt")), false);

  assert.deepEqual(readdirSync(dir).sort(), ["a.json", "b.json", "notes.txt", "subdir"], "nothing was removed from the source");
  assert.deepEqual(readdirSync(inboxDir).filter((f) => f.endsWith(".tmp")), [], "no leftover .tmp files");
});

test("[fast] importScans on a missing source dir copies nothing", () => {
  const inboxDir = tmp("qm-import-inbox-missing-");
  assert.deepEqual(importScans({ dir: join(inboxDir, "does-not-exist"), inboxDir }), { copied: 0, skipped: 0, failed: 0, failures: [] });
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

// Post-review fix (security, Phase 7): the write side of importScans had the same blind spots the
// install side did. existsSync follows a symlink, so a DANGLING one already sitting in the inbox under
// a scan's name read as "absent" and the copy replaced it — and the copy itself went through a
// predictable "<dest>.tmp". The destination is inside Pack Rat's own data directory rather than a
// player-picked folder, so the precondition is narrower than the installer's, but it's the same bug.
test("[fast] importScans never writes through a symlink sitting in the inbox under a scan's name", () => {
  const dir = tmp("qm-import-destlink-src-");
  writeFileSync(join(dir, "a.json"), JSON.stringify({ a: 1 }));
  writeFileSync(join(dir, "b.json"), JSON.stringify({ b: 1 }));
  const outside = tmp("qm-import-destlink-outside-");
  const canary = join(outside, "canary.json");
  writeFileSync(canary, '{"untouched": true}');
  const inboxDir = tmp("qm-import-destlink-inbox-");
  // a.json → a live symlink, b.json → a DANGLING one (the case existsSync used to miss entirely).
  if (!trySymlink(canary, join(inboxDir, "a.json"))) return;
  if (!trySymlink(join(outside, "gone.json"), join(inboxDir, "b.json"))) return;
  const result = importScans({ dir, inboxDir });
  assert.deepEqual(result, { copied: 0, skipped: 2, failed: 0, failures: [] }, "both names are taken, whatever type is under them");
  assert.deepEqual(JSON.parse(readFileSync(canary, "utf8")), { untouched: true });
  assert.equal(existsSync(join(outside, "gone.json")), false, "the dangling link's target was not created by writing through it");
});

// The per-file copy is wrapped so one failure is counted rather than thrown: an EPERM partway through
// a folder import used to escape the loop as a generic 500, with the already-copied files left behind
// and nothing in the result to say which made it. chmod is only meaningful on POSIX.
test("[fast] importScans counts a failed copy and finishes the folder instead of throwing", () => {
  if (process.platform === "win32" || process.getuid?.() === 0) return;   // root ignores the mode bits
  const dir = tmp("qm-import-failed-src-");
  writeFileSync(join(dir, "a.json"), JSON.stringify({ a: 1 }));
  writeFileSync(join(dir, "b.json"), JSON.stringify({ b: 1 }));
  const inboxDir = tmp("qm-import-failed-inbox-");
  chmodSync(inboxDir, 0o555);   // readable, not writable
  try {
    const result = importScans({ dir, inboxDir });
    assert.equal(result.copied, 0);
    assert.equal(result.failed, 2);
    assert.deepEqual(result.failures.map((f) => f.name), ["a.json", "b.json"], "each failure names its own file");
    for (const f of result.failures) assert.ok(f.reason.length > 0, "a failure carries a reason, not just a count");
  } finally {
    chmodSync(inboxDir, 0o755);
  }
});

// The same ceiling app/watcher.mts's ingestFile enforces (MAX_INBOX_BYTES), applied on the way IN: an
// oversize file used to be copied into the inbox and only refused once it got there, where it sat
// being re-read and re-rejected by every startup sweep. truncateSync gives the inode the size without
// writing 32 MB of bytes.
test("[fast] importScans refuses a source file bigger than the inbox limit before it reaches the inbox", () => {
  const dir = tmp("qm-import-toobig-src-");
  writeFileSync(join(dir, "small.json"), JSON.stringify({ a: 1 }));
  const big = join(dir, "big.json");
  writeFileSync(big, "{}");
  truncateSync(big, MAX_INBOX_BYTES + 1);
  const inboxDir = tmp("qm-import-toobig-inbox-");

  const result = importScans({ dir, inboxDir });
  assert.equal(result.copied, 1, "the rest of the folder still gets its chance");
  assert.equal(result.skipped, 0);
  assert.equal(result.failed, 1);
  assert.deepEqual(result.failures.map((f) => f.name), ["big.json"]);
  assert.match(result.failures[0]!.reason, /too large/);
  assert.deepEqual(readdirSync(inboxDir).sort(), ["small.json"], "the oversize file never reached the inbox");
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
  const fetchImpl = async (url: string) => {
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

// Post-review fix (security, Phase 7): html_url used to be forwarded exactly as GitHub's response
// carried it, straight into an <a href> in the page. It's now only used when it really is an
// https://github.com/<this repo>/releases/… URL; anything else falls back to this repo's own releases
// page, which is always a safe place to send the player and keeps the result's shape unchanged.
test("[fast] checkForUpdates falls back to the repo's releases page for an html_url that isn't this repo's", async () => {
  const releases = "https://github.com/owner/name/releases";
  for (const html_url of [
    "https://example.com/owner/name/releases/tag/v1",   // another host
    "http://github.com/owner/name/releases/tag/v1",     // not https
    "https://github.com/someone/else/releases/tag/v1",  // another repository
    "https://github.com/owner/name/settings",           // this repo, but not a releases path
    "javascript:alert(1)",                              // not a URL at all
    "",
    null,
    undefined,
    42,
  ]) {
    const fetchImpl = async () => ({ status: 200, json: async () => ({ tag_name: "v0.9.0", html_url }) });
    const result = await checkForUpdates({ current: "0.1.0", repo: "owner/name", fetchImpl });
    assert.equal(result.url, releases, JSON.stringify(html_url));
    assert.equal(result.latest, "0.9.0", "everything else about the result is unchanged");
  }
  // A real release URL under this repo is used as-is, including a case-differing owner/name.
  for (const html_url of [`${releases}/tag/v0.9.0`, releases, "https://github.com/Owner/Name/releases/tag/v0.9.0"]) {
    const fetchImpl = async () => ({ status: 200, json: async () => ({ tag_name: "v0.9.0", html_url }) });
    const result = await checkForUpdates({ current: "0.1.0", repo: "owner/name", fetchImpl });
    assert.equal(result.url, html_url, "a genuine release URL for this repository is passed through");
  }
});

test("[fast] checkForUpdates: a non-200 response reports configured:true with an error, not a throw", async () => {
  const fetchImpl = async () => ({ status: 404, json: async () => ({}) });
  const result = await checkForUpdates({ current: "0.1.0", repo: "owner/name", fetchImpl });
  assert.equal(result.configured, true);
  assert.equal(typeof result.error, "string");
});
