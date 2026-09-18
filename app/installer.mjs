// installer.mjs — pure functions behind the setup wizard: adapter discovery, client-folder
// detection, script install/verify, scan import, and a GitHub-releases update check. node:fs and
// node:path only; the one bit of I/O that isn't the local filesystem (checkForUpdates' HTTP call)
// takes an injectable fetchImpl so callers (and tests) never depend on a real fetch global.
import { existsSync, statSync, lstatSync, readdirSync, readFileSync, writeFileSync, copyFileSync, renameSync, unlinkSync, mkdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";

const VERSION_RE = /ADAPTER_VERSION\s*=\s*"([^"]+)"/;
const ADAPTER_ID_RE = /^[a-z0-9-]+$/;
export const RUNNING_MESSAGE = 'a Pack Rat script is running in the client — type -stopall in game, wait for "No scripts are currently running", then retry';

// Per-adapter shape of "the folder inside a candidate/picked root that actually holds the scripts",
// most-specific form first. Shared by candidateClientRoots (known install locations) and
// validateScriptsDir (whatever folder the player picked by hand) so a new folder-transport adapter
// only ever grows this one map instead of both functions separately. A paste-transport adapter (see
// docs/adapter-guide.md) has no entry here on purpose — it has no scripts folder to find.
const NESTED_SCRIPTS_SUFFIX = {
  tazuo: [["TazUO", "LegionScripts"], ["LegionScripts"]],
  // Razor Enhanced's own official install docs (razorenhanced.net/dokuwiki, "Install & Configure",
  // fetched 2026-09-17) say only "unpack archive in your own folder, run Razor.exe" — there is no
  // fixed install location, so there is no well-known root name for candidateClientRoots to guess
  // (see CANDIDATE_ROOT_NAME below: razor-enhanced has no entry there, on purpose — candidateClientRoots
  // returns [] for this adapter before it ever reaches this array, so nothing here feeds an
  // auto-detected candidate). These shapes are for validateScriptsDir only: a player who points the
  // folder picker at their own Razor Enhanced install (whatever they named it, wherever it lives)
  // still resolves to its Scripts subfolder. The ClassicUO/Data/Plugins/Razor/Scripts form covers a
  // player who picked the ClassicUO Launcher root instead of the Razor folder itself — a real, common
  // shape for players who also run the separate Razor Community Edition/CUO Launcher combo (see
  // adapters/razor-enhanced/README.md's Sources for why that combo is a DIFFERENT product from Razor
  // Enhanced and must never be offered as an auto-detected guess); recognizing it here when the player
  // picks it by hand is a harmless convenience, not a claim about where Razor Enhanced installs.
  "razor-enhanced": [["ClassicUO", "Data", "Plugins", "Razor", "Scripts"], ["Razor", "Scripts"], ["Scripts"]],
};
// The well-known root folder name candidateClientRoots looks for under Desktop/Downloads/Documents
// (and, on win32, LOCALAPPDATA and the drive root) for each folder-transport adapter. An adapter with
// no fixed install location (razor-enhanced — see NESTED_SCRIPTS_SUFFIX above) has no entry here on
// purpose: candidateClientRoots returns [] for it and the manual folder picker is the only path.
const CANDIDATE_ROOT_NAME = { tazuo: "TazUO" };

// ---- listAdapters ---------------------------------------------------------------------------------
// One entry per adaptersDir subdirectory that ships a capabilities.json (the same test
// app/contracts.test.mjs uses to find an adapter). name is the README's first Markdown heading text,
// falling back to the directory name; summary is a short human line built from capabilities.
export function listAdapters(adaptersDir) {
  let entries;
  try { entries = readdirSync(adaptersDir, { withFileTypes: true }); }
  catch { return []; }
  const out = [];
  for (const d of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!d.isDirectory()) continue;
    const dir = join(adaptersDir, d.name);
    const capPath = join(dir, "capabilities.json");
    if (!existsSync(capPath)) continue;
    let raw;
    try { raw = JSON.parse(readFileSync(capPath, "utf8")); }
    catch { continue; }
    const capabilities = raw.capabilities || {};
    // "folder" (the adapter writes scripts into a player-chosen client folder) or "paste" (no
    // filesystem access — the player pastes what the script prints into the Import tab instead).
    // See docs/adapter-guide.md. Anything other than the literal "paste" is treated as "folder" so an
    // adapter that omits the field entirely (there shouldn't be one, but nothing enforces it here)
    // still gets offered for installation rather than silently disappearing from the wizard.
    const transport = raw.transport === "paste" ? "paste" : "folder";
    let name = d.name;
    const readmePath = join(dir, "README.md");
    try {
      const m = /^#\s+(.+)$/m.exec(readFileSync(readmePath, "utf8"));
      if (m) name = m[1].trim();
    } catch { /* no README — fall back to the directory name */ }
    const scripts = scriptNamesIn(dir);
    out.push({ id: d.name, name, scripts, capabilities, transport, summary: summarize(capabilities) });
  }
  return out;
}

function scriptNamesIn(dir) {
  try { return readdirSync(dir).filter((f) => f.startsWith("packrat-") && f.endsWith(".py")).sort(); }
  catch { return []; }
}

function summarize(capabilities) {
  const reads = [];
  if (capabilities.layers && capabilities.layers.length) reads.push("every layer");
  if (capabilities.bank) reads.push("bank");
  if (capabilities.ground) reads.push("ground");
  if (capabilities.nested) reads.push("nested bags");
  const bits = [];
  if (reads.length) bits.push(`reads ${reads.join(", ")}`);
  if (capabilities.bridge && capabilities.bridge.length) bits.push(`bridge: ${capabilities.bridge.join(", ")}`);
  return bits.join("; ");
}

// ---- candidateClientRoots --------------------------------------------------------------------------
// Where a folder-transport client's folder usually lands, per adapter (NESTED_SCRIPTS_SUFFIX /
// CANDIDATE_ROOT_NAME above). Each candidate root is checked in most-specific-first order — the
// client unzipped one or more levels deeper than the download folder (the common real-world layout —
// see validateScriptsDir's identical nested forms) down to the direct/shallowest shape — and only the
// scripts directories that actually exist are returned, deduped, in root order. An adapter with no
// entry in NESTED_SCRIPTS_SUFFIX (paste-transport, or simply unknown) proposes nothing: there is
// either no folder to find, or no known layout to look for yet.
export function candidateClientRoots({ adapter, home, platform = process.platform, env = process.env, exists = existsSync } = {}) {
  const suffixes = NESTED_SCRIPTS_SUFFIX[adapter];
  if (!suffixes || !home) return [];
  // Razor Enhanced only runs on Windows (adapters/razor-enhanced/README.md) — proposing a candidate on
  // darwin/linux would point at a folder that can never exist for this client.
  if (adapter === "razor-enhanced" && platform !== "win32") return [];
  const rootName = CANDIDATE_ROOT_NAME[adapter];
  // No well-known root name for this adapter (razor-enhanced today — see CANDIDATE_ROOT_NAME's
  // comment): nothing to guess at, so propose no candidates rather than joining onto `undefined`.
  if (!rootName) return [];
  const roots = [join(home, "Desktop", rootName), join(home, "Downloads", rootName), join(home, "Documents", rootName)];
  if (platform === "win32") {
    if (env.LOCALAPPDATA) roots.push(join(env.LOCALAPPDATA, rootName));
    roots.push(`C:\\${rootName}`);
  }
  const seen = new Set();
  const out = [];
  for (const root of roots) {
    let hit = null;
    for (const suffix of suffixes) {
      const p = join(root, ...suffix);
      if (exists(p)) { hit = p; break; }
    }
    if (hit && !seen.has(hit)) { seen.add(hit); out.push(hit); }
  }
  return out;
}

// ---- validateScriptsDir -----------------------------------------------------------------------------
// Accepts the folder the user picked as-is, or any of that adapter's real-world layouts a step or more
// down from it (NESTED_SCRIPTS_SUFFIX above). adapter with no entry there (a future folder-transport
// adapter this map hasn't caught up with yet) falls back to tazuo's own shape rather than accepting
// nothing — the closest guess is better than refusing every folder outright.
export function validateScriptsDir(dir, adapter) {
  if (!dir || typeof dir !== "string") return { ok: false, error: "a folder is required" };
  const suffixes = NESTED_SCRIPTS_SUFFIX[adapter] || NESTED_SCRIPTS_SUFFIX.tazuo;
  // Check the more-specific nested forms first: a picked folder that itself happens to exist (it
  // almost always does — it's a folder the user or a file dialog chose) must not shadow a real
  // scripts folder one or more levels below it.
  const candidates = [...suffixes.map((s) => join(dir, ...s)), dir];
  for (const c of candidates) {
    try { if (statSync(c).isDirectory()) return { ok: true, scriptsDir: c }; }
    catch { /* try the next form */ }
  }
  return { ok: false, error: `no scripts folder found under ${dir}${adapter ? ` for adapter "${adapter}"` : ""}` };
}

// ---- installedVersion --------------------------------------------------------------------------------
// Generic over any directory holding packrat-*.py files — used both for a real install target
// (scriptsDir) and, by GET /api/setup, for the repo's own adapters/<id>/ to report the shipped version.
// version comes from the scanner script (its name contains "scanner"; falls back to the first script
// alphabetically so a differently-named future adapter still reports something) when present, else null.
export function installedVersion(scriptsDir, adapter) {
  const names = scriptNamesIn(scriptsDir);
  const files = {};
  for (const n of names) files[n] = true;
  const scanner = names.find((n) => n.includes("scanner")) || names[0] || null;
  let version = null;
  if (scanner) {
    try {
      const m = VERSION_RE.exec(readFileSync(join(scriptsDir, scanner), "utf8"));
      if (m) version = m[1];
    } catch { /* unreadable — leave null */ }
  }
  void adapter;   // not needed today (script names are adapter-agnostic); kept for interface symmetry
  return { version, files };
}

// A future-dated alive is untrusted rather than indefinitely fresh: without a cap, a skewed clock (or
// a hand-edited/corrupt status.json) that reports "alive" ahead of this machine's clock would make
// (now - aliveMs) permanently negative and so permanently < 30 — the guard would refuse forever with
// no way to clear it. Anything more than 5 minutes ahead is treated as stale (not running) and logged;
// anything closer than that (plausible ordinary clock skew between two machines/processes) still counts
// as alive, so the guard doesn't get weaker for the normal case.
const FUTURE_SKEW_TOLERANCE_S = 300;

// Reads capabilities.json straight off disk rather than going through listAdapters (which the caller
// has usually already called, but installScripts must stand on its own — see its own comment above
// about defence in depth against a caller that skips the allowlist check). Missing/unreadable
// capabilities.json is treated as "folder" (installable) rather than refused: an adapter this
// permissive about its own metadata is a metadata problem, not evidence it has nothing to install.
function adapterTransport(srcDir) {
  try {
    const raw = JSON.parse(readFileSync(join(srcDir, "capabilities.json"), "utf8"));
    return raw.transport === "paste" ? "paste" : "folder";
  } catch { return "folder"; }
}

function bridgeAlive(bridgeStatusPath, now, log = () => {}) {
  let st;
  try { st = JSON.parse(readFileSync(bridgeStatusPath, "utf8")); }
  catch { return false; }
  if (st.stopped === true || st.alive == null) return false;
  const aliveMs = typeof st.alive === "number" ? st.alive * 1000 : Date.parse(st.alive);
  if (Number.isNaN(aliveMs)) return false;
  const ageS = (now - aliveMs) / 1000;
  if (ageS < -FUTURE_SKEW_TOLERANCE_S) {
    log(`bridge status.json's alive timestamp is ${Math.round(-ageS)}s in the future — treating as stale (clock skew?), not indefinitely running`);
    return false;
  }
  return ageS < 30;
}

// ---- installScripts ------------------------------------------------------------------------------
// The running-script guard comes first, before anything on disk is touched: a Legion script mid-run
// against the very files this is about to overwrite is exactly the "orphaned script thread" trap
// (see the project CLAUDE.md's Legion gotchas) — refuse instead of racing it. Each file is copied to
// <name>.new and renamed into place (never written in place), so a reader never sees a half-written
// script; packrat-paths.json is written last, once every script is in position.
//
// `adapter` is validated before it ever reaches a path.join: a caller is expected to have already
// checked it against listAdapters(adaptersDir)'s known ids (every /api/setup/* route does), but this
// function enforces it again itself — defence in depth against a caller that skips that check. First
// the id's shape (path separators and traversal segments like ".." can't match [a-z0-9-]+), then,
// once srcDir is built, that it actually resolves to a direct child of adaptersDir — catching a case
// the shape check alone wouldn't (e.g. adaptersDir itself containing a symlink).
export function installScripts({ adapter, adaptersDir, scriptsDir, dataDir, bridgeStatusPath, now = Date.now, log = () => {} } = {}) {
  if (typeof adapter !== "string" || !ADAPTER_ID_RE.test(adapter)) {
    return { ok: false, code: "badAdapter", error: `invalid adapter id: ${JSON.stringify(adapter)}` };
  }
  const resolvedAdaptersDir = resolve(adaptersDir);
  const srcDir = join(resolvedAdaptersDir, adapter);
  if (dirname(srcDir) !== resolvedAdaptersDir) {
    return { ok: false, code: "badAdapter", error: `adapter "${adapter}" does not resolve under ${adaptersDir}` };
  }
  // A paste-transport adapter (docs/adapter-guide.md) has no scripts folder to write to — its whole
  // point is that its sandbox can't write files at all. Reject it here, before the running-script
  // guard and the scriptsDir check, so the error names the real reason ("nothing to install") instead
  // of the misleading "badDir: no adapter scripts found" scriptNamesIn would otherwise produce below
  // (true today only because a paste-transport adapter happens to ship no packrat-*.py files).
  if (adapterTransport(srcDir) === "paste") {
    return { ok: false, code: "noInstall", error: `adapter "${adapter}" has nothing to install — it has no scripts folder; use the Import tab instead` };
  }
  if (bridgeStatusPath && bridgeAlive(bridgeStatusPath, now(), log)) {
    return { ok: false, code: "running", error: RUNNING_MESSAGE };
  }
  let destStat = null;
  try { destStat = statSync(scriptsDir); } catch { /* missing — badDir below */ }
  if (!destStat || !destStat.isDirectory()) {
    return { ok: false, code: "badDir", error: `not a directory: ${scriptsDir}` };
  }
  const names = scriptNamesIn(srcDir);
  if (!names.length) return { ok: false, code: "badDir", error: `no adapter scripts found for "${adapter}" in ${adaptersDir}` };

  // Each write is individually guarded: a failure partway through (disk full, permission revoked mid-
  // run) removes its own dangling .new and returns the codes/partial `installed` list the caller can
  // report honestly, instead of an uncaught throw that only surfaces as a generic stack-free 500.
  const installed = [];
  for (const name of names) {
    const dest = join(scriptsDir, name);
    const tmp = `${dest}.new`;
    try {
      copyFileSync(join(srcDir, name), tmp);
      renameSync(tmp, dest);
    } catch (e) {
      try { unlinkSync(tmp); } catch { /* never got written, or already gone */ }
      return { ok: false, code: "writeFailed", error: e.message, installed: [...installed] };
    }
    installed.push(name);
  }
  const { version } = installedVersion(scriptsDir, adapter);
  try {
    writeFileSync(join(scriptsDir, "packrat-paths.json"), `${JSON.stringify({ dataDir }, null, 1)}\n`);
  } catch (e) {
    return { ok: false, code: "writeFailed", error: e.message, installed: [...installed] };
  }
  return { ok: true, installed, version };
}

// ---- importScans ----------------------------------------------------------------------------------
// Copies top-level *.json files from a user-picked folder into an adapter's inbox for app/watcher.mjs
// to normalise; never touches (moves or deletes) the source. A name already present in inboxDir is
// left alone and counted as skipped, matching the Global Constraint that import never overwrites.
export function importScans({ dir, inboxDir }) {
  mkdirSync(inboxDir, { recursive: true });
  let names;
  try { names = readdirSync(dir); } catch { return { copied: 0, skipped: 0 }; }
  let copied = 0, skipped = 0;
  for (const name of names.sort()) {
    if (!name.endsWith(".json")) continue;
    const src = join(dir, name);
    // lstatSync (not statSync) so a *.json symlink is rejected by its own type rather than resolved
    // to whatever it points at — the source folder is user-picked, and a symlinked name copies its
    // target's bytes under statSync, wherever that target is.
    try { if (!lstatSync(src).isFile()) continue; } catch { continue; }
    const dest = join(inboxDir, name);
    if (existsSync(dest)) { skipped++; continue; }
    const tmp = `${dest}.tmp`;
    copyFileSync(src, tmp);
    renameSync(tmp, dest);
    copied++;
  }
  return { copied, skipped };
}

// ---- repoFromPackage / checkForUpdates -------------------------------------------------------------
// GitHub-only, on purpose (Global Constraint): "repository": "github:o/n" | "https://github.com/o/n.git"
// | "git+https://github.com/o/n.git" | {url: "..."} all resolve; anything not pointing at github.com,
// or no repository field at all, is null — GET /api/update-check then reports {configured: false}
// without ever constructing a URL or calling fetch.
export function repoFromPackage(pkg) {
  const repository = pkg && pkg.repository;
  const raw = typeof repository === "string" ? repository : repository && typeof repository.url === "string" ? repository.url : null;
  if (!raw) return null;
  let m = /^github:([^/]+)\/([^/#]+)/.exec(raw);
  if (!m) m = /github\.com[:/]+([^/]+)\/([^/.]+?)(?:\.git)?(?:[/#].*)?$/.exec(raw);
  return m ? `${m[1]}/${m[2]}` : null;
}

function compareSemver(a, b) {
  const pa = String(a || "0").split(".").map((n) => Number.parseInt(n, 10) || 0);
  const pb = String(b || "0").split(".").map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
}

export async function checkForUpdates({ current, repo, fetchImpl = fetch } = {}) {
  if (!repo) return { configured: false };
  let res;
  try {
    res = await fetchImpl(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: { accept: "application/vnd.github+json", "user-agent": "pack-rat" },
    });
  } catch (e) {
    return { configured: true, error: e.message };
  }
  if (!res || res.status !== 200) return { configured: true, error: `GitHub releases/latest returned ${res ? res.status : "no response"}` };
  let body;
  try { body = await res.json(); }
  catch (e) { return { configured: true, error: `invalid release response: ${e.message}` }; }
  const latest = String(body.tag_name || "").replace(/^v/, "");
  return { configured: true, current, latest, url: body.html_url, upToDate: compareSemver(current, latest) >= 0 };
}
