// installer.mjs — pure functions behind the setup wizard: adapter discovery, client-folder
// detection, script install/verify, scan import, and a GitHub-releases update check. node:fs and
// node:path only; the one bit of I/O that isn't the local filesystem (checkForUpdates' HTTP call)
// takes an injectable fetchImpl so callers (and tests) never depend on a real fetch global.
import { existsSync, statSync, lstatSync, readdirSync, readFileSync, writeFileSync, copyFileSync, renameSync, unlinkSync, mkdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";

const VERSION_RE = /ADAPTER_VERSION\s*=\s*"([^"]+)"/;
const ADAPTER_ID_RE = /^[a-z0-9-]+$/;
export const RUNNING_MESSAGE = 'a Pack Rat script is running in the client — type -stopall in game, wait for "No scripts are currently running", then retry';

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
    let capabilities;
    try { capabilities = JSON.parse(readFileSync(capPath, "utf8")).capabilities || {}; }
    catch { continue; }
    let name = d.name;
    const readmePath = join(dir, "README.md");
    try {
      const m = /^#\s+(.+)$/m.exec(readFileSync(readmePath, "utf8"));
      if (m) name = m[1].trim();
    } catch { /* no README — fall back to the directory name */ }
    const scripts = scriptNamesIn(dir);
    out.push({ id: d.name, name, scripts, capabilities, summary: summarize(capabilities) });
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
// Where the TazUO client folder usually lands. Each candidate root is checked two ways — the client
// unzipped one level deeper than the download folder (root/TazUO/LegionScripts, the common real-world
// layout — see validateScriptsDir's <dir>/TazUO/LegionScripts form) or directly (root/LegionScripts) —
// and only the LegionScripts directories that actually exist are returned, deduped, in root order.
export function candidateClientRoots({ adapter, home, platform = process.platform, env = process.env, exists = existsSync } = {}) {
  if (adapter !== "tazuo" || !home) return [];
  const roots = [join(home, "Desktop", "TazUO"), join(home, "Downloads", "TazUO"), join(home, "Documents", "TazUO")];
  if (platform === "win32") {
    if (env.LOCALAPPDATA) roots.push(`${env.LOCALAPPDATA}/TazUO`);
    roots.push("C:\\TazUO");
  }
  const seen = new Set();
  const out = [];
  for (const root of roots) {
    const nested = join(root, "TazUO", "LegionScripts");
    const direct = join(root, "LegionScripts");
    const hit = exists(nested) ? nested : exists(direct) ? direct : null;
    if (hit && !seen.has(hit)) { seen.add(hit); out.push(hit); }
  }
  return out;
}

// ---- validateScriptsDir -----------------------------------------------------------------------------
// Accepts the folder the user picked as-is, or either of the two real-world layouts a step down from
// it. adapter is accepted for a future adapter whose client folder shape differs; today only tazuo ships.
export function validateScriptsDir(dir, adapter) {
  if (!dir || typeof dir !== "string") return { ok: false, error: "a folder is required" };
  // Check the more-specific nested forms first: a picked folder that itself happens to exist (it
  // almost always does — it's a folder the user or a file dialog chose) must not shadow a real
  // LegionScripts folder one or two levels below it.
  const candidates = [join(dir, "TazUO", "LegionScripts"), join(dir, "LegionScripts"), dir];
  for (const c of candidates) {
    try { if (statSync(c).isDirectory()) return { ok: true, scriptsDir: c }; }
    catch { /* try the next form */ }
  }
  return { ok: false, error: `no LegionScripts folder found under ${dir}${adapter ? ` for adapter "${adapter}"` : ""}` };
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
