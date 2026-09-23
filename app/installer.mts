// installer.mts — pure functions behind the setup wizard: adapter discovery, client-folder
// detection, script install/verify, scan import, and a GitHub-releases update check. node:fs and
// node:path only; the one bit of I/O that isn't the local filesystem (checkForUpdates' HTTP call)
// takes an injectable fetchImpl so callers (and tests) never depend on a real fetch global.
import {
  existsSync, statSync, lstatSync, readdirSync, readFileSync, copyFileSync, realpathSync,
  mkdirSync, openSync, readSync, closeSync, fstatSync, constants, type Dirent, type Stats,
} from "node:fs";
import { join, resolve, dirname, isAbsolute } from "node:path";
import { MAX_INBOX_BYTES } from "./watcher.mts";
import { atomicReplace, writeFileAtomic } from "./atomic-write.mts";
import { DATA_DIR_MODE } from "./config.mts";

const VERSION_RE = /ADAPTER_VERSION\s*=\s*"([^"]+)"/;
const ADAPTER_ID_RE = /^[a-z0-9-]+$/;
export const RUNNING_MESSAGE = 'a Pack Rat script is running in the client — type -stopall in game, wait for "No scripts are currently running", then retry';

// Per-adapter shape of "the folder inside a candidate/picked root that actually holds the scripts",
// most-specific form first. Shared by candidateClientRoots (known install locations) and
// validateScriptsDir (whatever folder the player picked by hand) so a new folder-transport adapter
// only ever grows this one map instead of both functions separately. A paste-transport adapter (see
// docs/adapter-guide.md) has no entry here on purpose — it has no scripts folder to find.
type ScriptsSuffix = string[][];

const NESTED_SCRIPTS_SUFFIX: Record<string, ScriptsSuffix> = {
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
const CANDIDATE_ROOT_NAME: Record<string, string> = { tazuo: "TazUO" };

// ---- safe writes and bounded reads ------------------------------------------------------------------
// Every destination this module writes (an adapter script, packrat-paths.json, an imported scan) goes
// through atomicReplace, and every file it reads back goes through readHead. Both folders on the other
// end are chosen by the player, and in this ecosystem a game-client folder is routinely an unpacked
// third-party archive — which is allowed to contain symlinks, FIFOs and directories under any name it
// likes. So neither side trusts a name to be what it looks like: the write refuses a destination that
// is anything other than absent or a regular file, and the read refuses anything that isn't a regular
// file once the fd is actually open.

// atomicReplace and writeFileAtomic live in app/atomic-write.mts (a randomly-named O_EXCL temp,
// renamed over a destination that must be absent or a regular file), shared with the server's own
// data-directory writes. Every caller here already runs inside a try/catch that turns a throw into
// its own reported result, rather than an uncaught throw surfacing as a stack-free 500.
function copyFileAtomic(src: string, dest: string): void {
  atomicReplace(dest, (tmp) => copyFileSync(src, tmp, constants.COPYFILE_EXCL));
}

// 64 KiB off the head of a file is the whole of what this module ever reads: an adapter script is
// ~13 KB with its ADAPTER_VERSION line in the first 60 lines, and packrat-paths.json is three lines.
// A bounded read is what keeps an ordinary huge file under one of those names from being a
// memory-exhaustion variant of the FIFO hang readHead's own flags close off.
const HEAD_READ_BYTES = 64 * 1024;

// O_NOFOLLOW refuses a symlink at the final component, O_NONBLOCK keeps a FIFO from parking this
// (single-threaded) process forever, and the fstat is what makes both TOCTOU-proof: it describes the
// fd actually opened, not a name that could have changed since. Neither flag exists on win32, where
// `?? 0` leaves the open plain — Windows has no FIFO-in-a-directory case, and CreateFile does not
// traverse a reparse point the way open(2) traverses a symlink. null means "not readable as a regular
// file", which every caller treats the same as absent.
function readHead(path: string, max: number = HEAD_READ_BYTES): string | null {
  const flags = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0);
  let fd: number;
  try { fd = openSync(path, flags); } catch { return null; }
  try {
    if (!fstatSync(fd).isFile()) return null;
    const buf = Buffer.allocUnsafe(max);
    const n = readSync(fd, buf, 0, max, 0);
    return buf.toString("utf8", 0, n);
  } catch { return null; }
  finally { closeSync(fd); }
}

// Object.hasOwn, not a bare index: both maps above are plain object literals, so every key on
// Object.prototype ("constructor", "__proto__", "toString", …) resolved to something truthy and
// defeated the `|| tazuo` fallback — validateScriptsDir(dir, "constructor") threw "suffixes.map is not
// a function" and candidateClientRoots threw ERR_INVALID_ARG_TYPE out of path.join, instead of the
// ordinary not-found result both are documented to return for an unknown adapter. Not reachable
// through any route (each checks the id against listAdapters first), but the documented contract has
// to be true for the next caller that trusts it.
function suffixesFor(adapter: unknown): ScriptsSuffix | null {
  if (typeof adapter !== "string" || !Object.hasOwn(NESTED_SCRIPTS_SUFFIX, adapter)) return null;
  return NESTED_SCRIPTS_SUFFIX[adapter]!;
}

// ---- listAdapters ---------------------------------------------------------------------------------
// One entry per adaptersDir subdirectory that ships a capabilities.json (the same test
// app/contracts.test.mts uses to find an adapter). name is the README's first Markdown heading text,
// falling back to the directory name; summary is a short human line built from capabilities.
export interface AdapterInfo {
  id: string;
  name: string;
  scripts: string[];
  capabilities: unknown;
  transport: "folder" | "paste";
  platform: string | null;
  summary: string;
}

export function listAdapters(adaptersDir: string): AdapterInfo[] {
  let entries: Dirent[];
  try { entries = readdirSync(adaptersDir, { withFileTypes: true }); }
  catch { return []; }
  const out: AdapterInfo[] = [];
  for (const d of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!d.isDirectory()) continue;
    const dir = join(adaptersDir, d.name);
    const capPath = join(dir, "capabilities.json");
    if (!existsSync(capPath)) continue;
    let raw: Record<string, unknown>;
    try { raw = JSON.parse(readFileSync(capPath, "utf8")) as Record<string, unknown>; }
    catch { continue; }
    const capabilities = raw.capabilities || {};
    // "folder" (the adapter writes scripts into a player-chosen client folder) or "paste" (no
    // filesystem access — the player pastes what the script prints into the Import tab instead).
    // See docs/adapter-guide.md. Anything other than the literal "paste" is treated as "folder" so an
    // adapter that omits the field entirely (there shouldn't be one, but nothing enforces it here)
    // still gets offered for installation rather than silently disappearing from the wizard.
    const transport = raw.transport === "paste" ? "paste" : "folder";
    // Optional: the one Node process.platform value ("win32"/"darwin"/"linux") this adapter's client
    // can run on at all, straight from the adapter's own capabilities.json — never hard-coded by
    // adapter id anywhere else (app/ui/adapters.mts's platformCompatible reads exactly this field).
    // Absent/non-string means "works on every platform" (tazuo, classicuo-web today); Razor Enhanced
    // is the one adapter that sets it ("win32" — it's a Windows-only client, per its own README).
    const platform = typeof raw.platform === "string" ? raw.platform : null;
    let name = d.name;
    const readmePath = join(dir, "README.md");
    try {
      const m = /^#\s+(.+)$/m.exec(readFileSync(readmePath, "utf8"));
      if (m) name = m[1]!.trim();
    } catch { /* no README — fall back to the directory name */ }
    const scripts = scriptNamesIn(dir);
    out.push({ id: d.name, name, scripts, capabilities, transport, platform, summary: summarize(capabilities) });
  }
  return out;
}

// withFileTypes + isFile(): only a regular file counts as a script. A symlink's dirent reports its own
// type (isFile() is false for it), so a symlinked name is skipped rather than resolved to its target —
// which is what used to make installedVersion a read oracle over any persisted scriptsDir. A directory
// or a FIFO under a packrat-*.py name is skipped for the same reason: one reached copyFileSync and
// failed EISDIR partway through an install, the other blocked readFileSync forever.
function scriptNamesIn(dir: string): string[] {
  let entries: Dirent[];
  try { entries = readdirSync(dir, { withFileTypes: true }); }
  catch { return []; }
  return entries
    .filter((d) => d.isFile() && d.name.startsWith("packrat-") && d.name.endsWith(".py"))
    .map((d) => d.name).sort();
}

// capabilities is whatever a capabilities.json's own "capabilities" field held (raw.capabilities ||
// {} above) — never schema-validated, so every read here is a cast describing the existing (unchecked)
// trust in that file's shape, not a claim it's actually been verified.
function summarize(capabilities: unknown): string {
  const caps = capabilities as { layers?: unknown[]; bank?: unknown; ground?: unknown; nested?: unknown; bridge?: unknown[] };
  const reads: string[] = [];
  if (caps.layers && caps.layers.length) reads.push("every layer");
  if (caps.bank) reads.push("bank");
  if (caps.ground) reads.push("ground");
  if (caps.nested) reads.push("nested bags");
  const bits: string[] = [];
  if (reads.length) bits.push(`reads ${reads.join(", ")}`);
  if (caps.bridge && caps.bridge.length) bits.push(`bridge: ${caps.bridge.join(", ")}`);
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
// adapterPlatform is the calling adapter's own capabilities.json `platform` field (listAdapters'
// output carries it as `a.platform`) — never a hard-coded adapter id here. A platform-restricted
// adapter (Razor Enhanced, "win32", today) proposes no candidate on any other platform: a folder
// that can never exist for this client on this machine. null/omitted means no restriction.
export interface CandidateClientRootsOptions {
  adapter: string;
  home: string;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  exists?: (path: string) => boolean;
  adapterPlatform?: string | null;
}

export function candidateClientRoots(
  {
    adapter, home, platform = process.platform, env = process.env, exists = existsSync, adapterPlatform = null,
  }: CandidateClientRootsOptions = {} as CandidateClientRootsOptions,   // every real call site supplies adapter/home (see app/installer.test.mts, app/vault-server.mts); this cast is compiler-only, matching config.mts's rawPort pattern
): string[] {
  const suffixes = suffixesFor(adapter);
  if (!suffixes || !home) return [];
  if (adapterPlatform && platform !== adapterPlatform) return [];
  const rootName = Object.hasOwn(CANDIDATE_ROOT_NAME, adapter) ? CANDIDATE_ROOT_NAME[adapter] : undefined;
  // No well-known root name for this adapter (razor-enhanced today — see CANDIDATE_ROOT_NAME's
  // comment): nothing to guess at, so propose no candidates rather than joining onto `undefined`.
  if (!rootName) return [];
  const roots = [join(home, "Desktop", rootName), join(home, "Downloads", rootName), join(home, "Documents", rootName)];
  if (platform === "win32") {
    if (env.LOCALAPPDATA) roots.push(join(env.LOCALAPPDATA, rootName));
    roots.push(`C:\\${rootName}`);
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const root of roots) {
    let hit: string | null = null;
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
// The `error?: undefined`/`scriptsDir?: undefined` siblings let a caller (see app/installer.test.mts)
// read either field off the union before narrowing on `ok`, without each read site needing its own
// narrowing or cast; they carry no runtime meaning of their own.
export type ValidateScriptsDirResult =
  | { ok: true; scriptsDir: string; error?: undefined }
  | { ok: false; error: string; scriptsDir?: undefined };

// A path is refused on its own shape, before any filesystem call, when it isn't absolute or starts
// with two separators. On win32 "\\host\share" is a perfectly good absolute path whose first use — the
// statSync below, and then a readdirSync on every later GET /api/setup, because the wizard persists
// what this accepts — is an outbound SMB connection to a host the caller named, i.e. an NTLM
// authentication attempt against it, repeated on every render and every launch. The "\\?\" device form
// is the same shape. POSIX has nothing to gain from a leading "//" either, so one rule covers both
// platforms and neither has to guess at the other's syntax.
function badPathShape(dir: string): string | null {
  if (/^[\\/]{2}/.test(dir)) return "a UNC or device path is not a scripts folder";
  if (!isAbsolute(dir)) return "a scripts folder must be an absolute path";
  return null;
}

// dir/adapter cross an HTTP boundary as-is (POST /api/setup/locate's request body — see
// app/vault-server.mts), so neither is trusted to already be a string; dir's own shape is checked
// below before use, exactly as the pre-TypeScript code did, and adapter is only ever used as an object
// index (a JS index coerces any value to a string key regardless of what TS is told it is here), so
// the cast at that read site describes the existing behaviour rather than changing it.
export function validateScriptsDir(dir: unknown, adapter: unknown): ValidateScriptsDirResult {
  if (!dir || typeof dir !== "string") return { ok: false, error: "a folder is required" };
  const shapeError = badPathShape(dir);
  if (shapeError) return { ok: false, error: `${shapeError}: ${dir}` };
  const suffixes = suffixesFor(adapter) || NESTED_SCRIPTS_SUFFIX.tazuo!;
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
export interface InstalledVersionResult {
  version: string | null;
  files: Record<string, boolean>;
}

export function installedVersion(scriptsDir: string, adapter: unknown): InstalledVersionResult {
  const names = scriptNamesIn(scriptsDir);
  const files: Record<string, boolean> = {};
  for (const n of names) files[n] = true;
  const scanner = names.find((n) => n.includes("scanner")) || names[0] || null;
  let version: string | null = null;
  if (scanner) {
    // readHead, not readFileSync: bounded, never follows a symlink, and never blocks on a FIFO — see
    // its own comment. Unreadable (or not a regular file after all) leaves version null.
    const head = readHead(join(scriptsDir, scanner));
    const m = head === null ? null : VERSION_RE.exec(head);
    if (m) version = m[1]!;
  }
  void adapter;   // not needed today (script names are adapter-agnostic); kept for interface symmetry
  return { version, files };
}

// ---- checkScriptsDataDir -----------------------------------------------------------------------------
// Does the game client's installed scripts' data folder match the app's own? When it doesn't, scans and
// bridge files land somewhere the app never looks: an empty inventory and an "offline" bridge with no
// hint why (a developer's `npm start` on ~/.pack-rat against scripts pointed at a dev folder is the usual
// way). The folders checked are the configured client's, else every auto-detected candidate — the same
// ones the wizard offers — and only those actually holding a Pack Rat script, since a client folder with
// none writes nothing anywhere. Among several detected folders, any one that matches is taken as the one
// in use: the app cannot tell which client the player runs, and a false alarm is worse than a quiet one.
// Reports; never changes anything.
export type DataDirCheck =
  | { status: "none" }
  | { status: "match"; scriptsDir: string }
  | { status: "mismatch"; scriptsDir: string; scriptsDataDir: string; dataDir: string }
  | { status: "unreadable"; scriptsDir: string; error: string };

export interface CheckScriptsDataDirOptions {
  dataDir: string;
  client: { adapter: string; scriptsDir: string } | null | undefined;
  adapters: { id: string; platform: string | null }[];
  home: string;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
}

// The adapters' data_dir() (adapters/*/packrat-*.py): packrat-paths.json's dataDir when the file exists
// and names one, else $PACKRAT_DATA, else ~/.pack-rat, each through os.path.expanduser. $PACKRAT_DATA is
// the GAME CLIENT's environment, which this process cannot see and which nothing documented sets, so
// "no file" is compared against ~/.pack-rat. A relative dataDir resolves against the client's working
// directory, equally unknowable, so it gives no verdict (null) rather than a guess. The read is
// readHead's: a symlink or anything else that isn't a regular file is refused (the scripts would follow
// it; this does not), and a file past the 64 KiB cap reads as truncated JSON, so as malformed.
function scriptsDataDirIn(scriptsDir: string, home: string): { dataDir: string } | { error: string } | null {
  const file = join(scriptsDir, "packrat-paths.json");
  const fallback = { dataDir: join(home, ".pack-rat") };
  try { lstatSync(file); }
  catch (e) { return (e as NodeJS.ErrnoException).code === "ENOENT" ? fallback : { error: (e as Error).message }; }
  const text = readHead(file);
  if (text === null) return { error: "it is not a regular file" };
  let doc: unknown;
  try { doc = JSON.parse(text); }
  catch (e) { return { error: `it is not valid JSON (${(e as Error).message})` }; }
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return { error: "it is not a JSON object" };
  const d = (doc as { dataDir?: unknown }).dataDir;
  if (!d) return fallback;   // "", null, absent: the scripts' `if d:` falls through to the default
  if (typeof d !== "string") return { error: "its dataDir is not a folder path" };
  const expanded = d === "~" ? home : /^~[\\/]/.test(d) ? join(home, d.slice(2)) : d;
  return isAbsolute(expanded) ? { dataDir: resolve(expanded) } : null;
}

// One folder written two ways (a trailing slash, a `..`, a symlink, /var vs /private/var on macOS) is
// one folder: compare real paths where they exist, and case-fold on the two platforms whose default
// filesystems ignore case.
function samePath(a: string, b: string, platform: NodeJS.Platform): boolean {
  const canon = (p: string): string => {
    let out: string;
    try { out = realpathSync.native(p); } catch { out = resolve(p); }
    return platform === "win32" || platform === "darwin" ? out.toLowerCase() : out;
  };
  return canon(a) === canon(b);
}

export function checkScriptsDataDir({
  dataDir, client, adapters, home, platform = process.platform, env = process.env,
}: CheckScriptsDataDirOptions): DataDirCheck {
  const folders = client
    ? [client.scriptsDir]
    : adapters.flatMap((a) => candidateClientRoots({ adapter: a.id, home, platform, env, adapterPlatform: a.platform }));
  let verdict: DataDirCheck = { status: "none" };
  for (const scriptsDir of folders) {
    if (!scriptNamesIn(scriptsDir).length) continue;
    const found = scriptsDataDirIn(scriptsDir, home);
    if (!found) continue;
    if ("error" in found) {
      if (verdict.status === "none") verdict = { status: "unreadable", scriptsDir, error: found.error };
      continue;
    }
    if (samePath(found.dataDir, dataDir, platform)) return { status: "match", scriptsDir };
    if (verdict.status === "none") verdict = { status: "mismatch", scriptsDir, scriptsDataDir: found.dataDir, dataDir };
  }
  return verdict;
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
function adapterTransport(srcDir: string): "folder" | "paste" {
  try {
    const raw = JSON.parse(readFileSync(join(srcDir, "capabilities.json"), "utf8")) as Record<string, unknown>;
    return raw.transport === "paste" ? "paste" : "folder";
  } catch { return "folder"; }
}

function bridgeAlive(bridgeStatusPath: string, now: number, log: (msg: string) => void = () => {}): boolean {
  let st: Record<string, unknown>;
  try { st = JSON.parse(readFileSync(bridgeStatusPath, "utf8")) as Record<string, unknown>; }
  catch { return false; }
  if (st.stopped === true || st.alive == null) return false;
  // st.alive is whatever status.json's own "alive" field held (a Legion-script-written file — see
  // adapters/tazuo's bridge script) — Date.parse ToStrings a non-string argument regardless of what
  // TS is told its type is here, so this cast describes the existing (unvalidated) trust, not a change.
  const aliveMs = typeof st.alive === "number" ? st.alive * 1000 : Date.parse(st.alive as string);
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
// (see the project CLAUDE.md's Legion gotchas) — refuse instead of racing it. Each file goes through
// atomicReplace (see its own comment above: a randomly-named O_EXCL temp, a destination that must be
// absent or a regular file, then a rename), so a reader never sees a half-written script and no write
// here can be redirected out of the chosen folder by something already sitting in it.
// packrat-paths.json is handled last, once every script is in position — and is the one destination
// that may legitimately already hold the player's own content, so it is not overwritten blind.
//
// `adapter` is validated before it ever reaches a path.join: a caller is expected to have already
// checked it against listAdapters(adaptersDir)'s known ids (every /api/setup/* route does), but this
// function enforces it again itself — defence in depth against a caller that skips that check. First
// the id's shape (path separators and traversal segments like ".." can't match [a-z0-9-]+), then,
// once srcDir is built, a purely LEXICAL check that it is a direct child of adaptersDir. That second
// check catches nothing the regex hasn't already — path.resolve and path.dirname touch no filesystem,
// so neither resolves a symlink, and an adaptersDir reached through one installs exactly as a real
// directory does (pinned in app/installer.test.mts). It is kept as a cheap guard against a future
// loosening of the regex, not as a filesystem-level defence; an earlier version of this comment
// claimed it caught "adaptersDir itself containing a symlink", which it never did. Making that claim
// true would take realpathSync on both sides, and a failure mode when adaptersDir doesn't exist.
export interface InstallScriptsOptions {
  adapter: unknown;
  adaptersDir: string;
  // `unknown`, like validateScriptsDir(dir: unknown): the one real caller (POST /api/setup/install)
  // passes this straight off the request body, and nothing validates it before this function runs.
  scriptsDir: unknown;
  dataDir: string;
  bridgeStatusPath?: string | undefined;
  now?: () => number;
  log?: (msg: string) => void;
}

// What became of packrat-paths.json: "written" (created, or replaced with content that loses nothing —
// see the install's own comment at that write), "unchanged" (already byte-identical), "kept" (the
// player's own, naming a different dataDir — left exactly as it stands), or "backed-up" (not in the
// documented shape at all, so it was copied to packrat-paths.json.bak before being replaced).
export type PathsFileOutcome = "written" | "unchanged" | "kept" | "backed-up";

// The undefined-typed siblings on each branch let a caller (see app/installer.test.mts) read any field
// off the union before narrowing on `ok`, without each read site needing its own narrowing or cast;
// they carry no runtime meaning of their own.
export type InstallScriptsResult =
  | { ok: true; installed: string[]; version: string | null; pathsFile: PathsFileOutcome; code?: undefined; error?: undefined }
  | { ok: false; code: "badAdapter" | "noInstall" | "running" | "badDir" | "writeFailed"; error: string; installed?: string[]; version?: undefined; pathsFile?: undefined };

export function installScripts(
  {
    adapter, adaptersDir, scriptsDir, dataDir, bridgeStatusPath, now = Date.now, log = () => {},
  }: InstallScriptsOptions = {} as InstallScriptsOptions,   // every real call site supplies every required key (see app/installer.test.mts, app/vault-server.mts); this cast is compiler-only, matching config.mts's rawPort pattern
): InstallScriptsResult {
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
  let destStat: Stats | null = null;
  // The cast is compiler-only: statSync() throws ERR_INVALID_ARG_TYPE on anything that is not a path,
  // and that throw lands in this same catch, so a non-string scriptsDir comes out as badDir below.
  try { destStat = statSync(scriptsDir as string); } catch { /* missing, or not a path at all — badDir below */ }
  if (!destStat || !destStat.isDirectory()) {
    return { ok: false, code: "badDir", error: `not a directory: ${scriptsDir}` };
  }
  // statSync() just succeeded on it, and nothing a JSON request body can carry is a Buffer or a URL,
  // so from here scriptsDir is a string naming a real directory.
  const destDir = scriptsDir as string;
  const names = scriptNamesIn(srcDir);
  if (!names.length) return { ok: false, code: "badDir", error: `no adapter scripts found for "${adapter}" in ${adaptersDir}` };

  // Each write is individually guarded: a failure partway through (disk full, permission revoked mid-
  // run) removes its own dangling .new and returns the codes/partial `installed` list the caller can
  // report honestly, instead of an uncaught throw that only surfaces as a generic stack-free 500.
  const installed: string[] = [];
  for (const name of names) {
    try { copyFileAtomic(join(srcDir, name), join(destDir, name)); }
    catch (e) { return { ok: false, code: "writeFailed", error: (e as Error).message, installed: [...installed] }; }
    installed.push(name);
  }
  const { version } = installedVersion(destDir, adapter);
  let pathsFile: PathsFileOutcome;
  try { pathsFile = writePathsFile(destDir, dataDir); }
  catch (e) { return { ok: false, code: "writeFailed", error: (e as Error).message, installed: [...installed] }; }
  return { ok: true, installed, version, pathsFile };
}

// packrat-paths.json is the one destination here that may already hold something the PLAYER wrote:
// adapters/razor-enhanced/README.md's install step 2 tells them to hand-author it with a dataDir
// reachable from the Windows machine running the client, which by construction is not this machine's
// CONFIG.dataDir. Rewriting it unconditionally undid that documented cross-machine setup on the next
// install or Settings "Reinstall", with no message, and the symptom (scans simply stop arriving)
// points nowhere near the cause. So a file already naming a DIFFERENT dataDir is left exactly as it
// stands and reported, since the app cannot tell a deliberate cross-machine path from a stale one and
// the player's own edit is the better guess. A file naming this same dataDir is rewritten (identical
// content, nothing to lose), and a file in no recognisable shape at all — unparsable, or with no
// string dataDir, which is nothing following the README produces — is replaced but copied to
// packrat-paths.json.bak first, so a hand-edit is never simply dropped. A symlink here isn't handled
// as a case at all: readHead refuses to follow one, so it falls to atomicReplace, which refuses it.
function writePathsFile(destDir: string, dataDir: string): PathsFileOutcome {
  const dest = join(destDir, "packrat-paths.json");
  const desired = `${JSON.stringify({ dataDir }, null, 1)}\n`;
  const existing = readHead(dest);
  if (existing !== null) {
    let existingDataDir: unknown;
    // The file's own contents, never validated against anything — this typeof is the whole check.
    try { existingDataDir = (JSON.parse(existing) as { dataDir?: unknown }).dataDir; }
    catch { existingDataDir = undefined; }
    if (typeof existingDataDir === "string" && existingDataDir !== dataDir) return "kept";
    if (existing === desired) return "unchanged";
    if (typeof existingDataDir !== "string") {
      writeFileAtomic(`${dest}.bak`, existing);
      writeFileAtomic(dest, desired);
      return "backed-up";
    }
  }
  writeFileAtomic(dest, desired);
  return "written";
}

// ---- importScans ----------------------------------------------------------------------------------
// Copies top-level *.json files from a user-picked folder into an adapter's inbox for app/watcher.mts
// to normalise; never touches (moves or deletes) the source. A name already present in inboxDir is
// left alone and counted as skipped, matching the Global Constraint that import never overwrites.
export interface ImportScansParams {
  dir: string;
  inboxDir: string;
}

// One entry per file this import could not take, in the order they were met — `failed` counts them
// all, this list names the first few so the page can say WHY rather than only how many. Bounded
// because a folder can hold any number of unreadable files and this crosses an HTTP response.
export interface ImportFailure {
  name: string;
  reason: string;
}
const MAX_REPORTED_FAILURES = 10;

export interface ImportScansResult {
  copied: number;
  skipped: number;
  failed: number;
  failures: ImportFailure[];
}

export function importScans({ dir, inboxDir }: ImportScansParams): ImportScansResult {
  mkdirSync(inboxDir, { recursive: true, mode: DATA_DIR_MODE });
  let names: string[];
  try { names = readdirSync(dir); } catch { return { copied: 0, skipped: 0, failed: 0, failures: [] }; }
  let copied = 0, skipped = 0, failed = 0;
  const failures: ImportFailure[] = [];
  const fail = (name: string, reason: string): void => {
    failed++;
    if (failures.length < MAX_REPORTED_FAILURES) failures.push({ name, reason });
  };
  for (const name of names.sort()) {
    if (!name.endsWith(".json")) continue;
    const src = join(dir, name);
    // lstatSync (not statSync) so a *.json symlink is rejected by its own type rather than resolved
    // to whatever it points at — the source folder is user-picked, and a symlinked name copies its
    // target's bytes under statSync, wherever that target is.
    let srcStat: Stats;
    try { srcStat = lstatSync(src); } catch { continue; }
    if (!srcStat.isFile()) continue;
    // The same ceiling app/watcher.mts puts on an inbox file, applied while the file is still just an
    // inode on the source side. Copying it first and letting ingestFile refuse it afterwards left a
    // file the watcher rejects on every startup sweep sitting in the inbox — and, for an import big
    // enough to matter, spent the disk on it twice over. Reported as failed rather than skipped:
    // skipped means "already imported", and this one never will be.
    if (srcStat.size > MAX_INBOX_BYTES) { fail(name, `too large: ${srcStat.size} bytes, the limit is ${MAX_INBOX_BYTES}`); continue; }
    const dest = join(inboxDir, name);
    // lstatSync here too, not existsSync: existsSync FOLLOWS a symlink, so a dangling one already
    // sitting in the inbox under a scan's name read as "absent" and the copy below replaced it.
    // Anything at all under this name means the name is taken — import never overwrites (the Global
    // Constraint), whatever type the thing under it happens to be.
    let taken = true;
    try { lstatSync(dest); } catch { taken = false; }
    if (taken) { skipped++; continue; }
    // Counted, not thrown: an EPERM partway through a folder used to escape the loop as a generic 500
    // with the already-copied files silently left behind and nothing in the result to say which. The
    // rest of the folder still gets its chance.
    try { copyFileAtomic(src, dest); copied++; }
    catch (e) { fail(name, (e as Error)?.message || "could not copy"); }
  }
  return { copied, skipped, failed, failures };
}

// ---- repoFromPackage / checkForUpdates -------------------------------------------------------------
// GitHub-only, on purpose (Global Constraint): "repository": "github:o/n" | "https://github.com/o/n.git"
// | "git+https://github.com/o/n.git" | {url: "..."} all resolve; anything not pointing at github.com,
// or no repository field at all, is null — GET /api/update-check then reports {configured: false}
// without ever constructing a URL or calling fetch.
// pkg is package.json content, handed in already-parsed — this function's own ad hoc typeof checks
// below are the only validation it has ever had; the casts here describe that existing trust level to
// the compiler, they don't add or remove a check.
export function repoFromPackage(pkg: unknown): string | null {
  const doc = pkg as { repository?: unknown } | null | undefined;
  const repository = doc && (doc.repository as { url?: unknown } | string | null | undefined);
  const raw = typeof repository === "string" ? repository : repository && typeof repository.url === "string" ? repository.url : null;
  if (!raw) return null;
  let m = /^github:([^/]+)\/([^/#]+)/.exec(raw);
  if (!m) m = /github\.com[:/]+([^/]+)\/([^/.]+?)(?:\.git)?(?:[/#].*)?$/.exec(raw);
  return m ? `${m[1]}/${m[2]}` : null;
}

function compareSemver(a: string, b: string): number {
  const pa = String(a || "0").split(".").map((n) => Number.parseInt(n, 10) || 0);
  const pb = String(b || "0").split(".").map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
}

// fetchImpl's declared shape is only the bit of Response this function actually reads (status, json())
// — narrower than the real global fetch's Promise<Response>, so both the real fetch (the default) and
// a test's plain {status, json} fake satisfy it.
type FetchLike = (url: string, init?: { headers?: Record<string, string> }) => Promise<{ status: number; json: () => Promise<unknown> }>;

export interface CheckForUpdatesParams {
  current: string;
  repo: string | null;
  fetchImpl?: FetchLike;
}

// The undefined-typed siblings on each branch let a caller (see app/installer.test.mts) read any field
// off the union before narrowing on `configured`, without each read site needing its own narrowing or
// cast; they carry no runtime meaning of their own.
export type CheckForUpdatesResult =
  | { configured: false; error?: undefined; current?: undefined; latest?: undefined; url?: undefined; upToDate?: undefined }
  | { configured: true; error: string; current?: undefined; latest?: undefined; url?: undefined; upToDate?: undefined }
  | { configured: true; current: string; latest: string; url: unknown; upToDate: boolean; error?: undefined };

export async function checkForUpdates(
  { current, repo, fetchImpl = fetch }: CheckForUpdatesParams = {} as CheckForUpdatesParams,   // every real call site supplies current/repo (see app/installer.test.mts, app/vault-server.mts); this cast is compiler-only, matching config.mts's rawPort pattern
): Promise<CheckForUpdatesResult> {
  if (!repo) return { configured: false };
  let res: { status: number; json: () => Promise<unknown> };
  try {
    res = await fetchImpl(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: { accept: "application/vnd.github+json", "user-agent": "pack-rat" },
    });
  } catch (e) {
    return { configured: true, error: (e as Error).message };
  }
  if (!res || res.status !== 200) return { configured: true, error: `GitHub releases/latest returned ${res ? res.status : "no response"}` };
  let body: unknown;
  try { body = await res.json(); }
  catch (e) { return { configured: true, error: `invalid release response: ${(e as Error).message}` }; }
  // body is the parsed JSON of a GitHub releases/latest response — never schema-checked before this
  // (same unvalidated trust as elsewhere in this file); tag_name is coerced through String(), and
  // html_url now goes through releaseUrl rather than being forwarded as-is. `url` stays typed
  // `unknown` so the result's shape is unchanged for every caller, but at run time it is always a
  // string this module vouched for.
  const release = body as { tag_name?: unknown; html_url?: unknown };
  const latest = String(release.tag_name || "").replace(/^v/, "");
  return { configured: true, current, latest, url: releaseUrl(release.html_url, repo), upToDate: compareSemver(current, latest) >= 0 };
}

// html_url used to reach the page as an <a href> exactly as the release response carried it — a value
// from off this machine, never checked to be a string, an https URL, or even a URL at all. It is only
// used now when it really is an https://github.com/<this repo>/releases… address; anything else falls
// back to that repository's own releases page, which is always a correct place to send the player and
// needs no response to construct. GitHub treats owner/name case-insensitively, so the comparison does
// too.
function releaseUrl(raw: unknown, repo: string): string {
  const fallback = `https://github.com/${repo}/releases`;
  if (typeof raw !== "string") return fallback;
  let parsed: URL;
  try { parsed = new URL(raw); } catch { return fallback; }
  if (parsed.protocol !== "https:" || parsed.host !== "github.com") return fallback;
  const prefix = `/${repo.toLowerCase()}/releases`;
  const path = parsed.pathname.toLowerCase();
  if (path !== prefix && !path.startsWith(`${prefix}/`)) return fallback;
  return raw;
}
