# Pack Rat Phase 1 — Page Split, Precompiled Core, node:test — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the app a set of real modules — the optimizer core compiled once into `app/dist/`, the 900-line inline page script split into `app/ui/*.mjs`, the server startable in-process and serving the split with a CSP — and move every test onto `node:test` with tags in the names.

**Architecture:** `scripts/optimizer-core.ts` becomes a genuine ES module (one `export` list) that `scripts/build-core.mjs` strips to `app/dist/optimizer-core.mjs`; server, worker, bench and tests import that file and the four "append an export line, write a temp file, import by URL" loaders are deleted. `app/vault-server.mjs` exports `startServer(config)` and only auto-starts when run directly; it serves `index.html`, `/ui/*` from an allowlist, and a CSP. The page becomes `app/index.html` + `app/ui/styles.css` + nine modules sharing one mutable `state` in `ui/store.mjs` (no pub/sub — YAGNI); function bodies move verbatim. Tests use `node:test` with `[smoke]`/`[fast]`/`[slow]` prefixes; the runner drives `node:test`'s `run()` API to write the same `test_logs/latest_summary.json`.

**Tech Stack:** Node ≥ 22.18 (`node:module`.`stripTypeScriptTypes`, `node:test` `run()`), zero runtime dependencies, Playwright (via the MCP browser tools available to the implementer) for rendered verification only.

**Spec:** `docs/superpowers/specs/2026-09-12-desktop-app-public-release-design.md` — §4.1 (utility process later needs `startServer`; `VAULT_CORE`), §4.5 (CSP once inline script is externalised), §8 (page split, precompiled core, loaders deleted, tests on `node:test`, `vaulttest-*` cleanup), §12 Phase 1. Ledger carry-overs from Phase 0: HTTP route tests, "Gear Vault" in comments.

## Global Constraints

- Work only in `~/r/pack-rat` on branch `phase-1-page-split` (from `main`); never touch `the original private workspace` or `~/Desktop/TazUO`. Never commit `local/`, `app/dist/`, `test_logs/`.
- Function bodies move verbatim in the page split. Behaviour is unchanged; the only edits inside a moved function are import/export plumbing and the removal of dead code named in Task 4.
- Test names carry a tag prefix: `[smoke]`, `[fast]` or `[slow]`. Summary format stays `{timestamp, mode, total, passed, failed, skipped, failures:[{file,line,test_name,error}]}` at `test_logs/latest_summary.json`; `npm test [-- --smoke|--fast]` and `./scripts/test_runner.sh` are the same runner.
- The bare `node app/vault-server.mjs` developer path keeps working; `node scripts/start.mjs` builds the core first.
- CSP served on `/` and `/ui/*`: `default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; font-src 'self'; base-uri 'none'; form-action 'none'`.
- Every page load in verification must show **zero console errors** (Playwright `console` messages of type error) on all four tabs.
- Prose files not hard-wrapped; commit messages imperative, ending with `Claude-Session: https://claude.ai/code/session_012Jc4pEtTUy9dfd8sp6EbPb`, no Co-Authored-By.

## File structure after Phase 1

| Path | Responsibility |
|---|---|
| `scripts/optimizer-core.ts` | the core, now with one `export { … }` list |
| `scripts/build-core.mjs` (new) | `buildCore()` → strips types into `app/dist/optimizer-core.mjs`; CLI + importable |
| `app/config.mjs` | adds `paths.core` (`VAULT_CORE` env → `app/dist/optimizer-core.mjs`) |
| `app/vault-server.mjs` | `export async function startServer(config)`; static allowlist; CSP; auto-start only as main |
| `app/optimize-worker.mjs` | imports the core from `workerData.coreUrl` (now the dist URL) — unchanged interface |
| `app/index.html` (renamed from `gear-vault.html`) | HTML only + `<link rel=stylesheet href=/ui/styles.css>` + `<script type=module src=/ui/app.mjs>` |
| `app/ui/styles.css` (new) | the former `<style>` block |
| `app/ui/dom.mjs` | `$`, `el`, `toast`, formatting, labels, rarity, tooltip |
| `app/ui/store.mjs` | `state`, `bridge` state object, `invStamp` |
| `app/ui/sheet.mjs` | `sheetHtml`, `SHEET_STATS` |
| `app/ui/inventory.mjs`, `characters.mjs`, `containers.mjs`, `bridge.mjs`, `builder.mjs`, `runs.mjs` | one tab / concern each |
| `app/ui/app.mjs` | `load()`, router, bootstrap, global listeners |
| `app/gear-vault.test.mjs`, `app/config.test.mjs`, `scripts/optimizer-core.test.mjs`, `app/server.test.mjs` (new) | `node:test` files |
| `scripts/test-runner.mjs` | drives `node:test` `run()`, builds the core first, spawns the Python test |
| `TESTING.md`, `CONTRIBUTING.md`, `CHANGELOG.md` | updated |

---

### Task 1: Core as a real module, built once into `app/dist/`

**Files:**
- Modify: `scripts/optimizer-core.ts` (append export list), `app/config.mjs`, `app/vault-server.mjs:44-52,130`, `app/optimize-worker.mjs` (no change if `coreUrl` stays), `app/gear-vault.test.mjs:464-471`, `scripts/optimizer-core.test.mjs:22-29`, `app/bench/run-bench.mjs:89-94,129`, `app/bench/mip-spike.mjs:17-19`, `package.json`, `scripts/start.mjs`, `scripts/test-runner.mjs`
- Create: `scripts/build-core.mjs`, `scripts/build-core.test.mjs`

**Interfaces:**
- Produces: `scripts/build-core.mjs` exports `buildCore({ src = <repo>/scripts/optimizer-core.ts, out = <repo>/app/dist/optimizer-core.mjs } = {}) → out` (writes only when the source is newer than the output or the output is missing; returns the path); as CLI (`node scripts/build-core.mjs`) it prints the path. `resolveConfig().paths.core` = `env.VAULT_CORE` (absolute path) → `join(APP_DIR, "dist", "optimizer-core.mjs")`. The core module exports exactly: `scoreSet, optimizeSuit, optIsValidAssignment, optMulberry32, optDefaultSlots, optDefaultOptionalSlots, optAssignmentTotals, optGradientProfile, optCollectKeys, optBuildSpace, optDominancePrune, optVec, optScoreVector, optIsTwoHandedWeapon` (the union of what `scripts/optimizer-core.test.mjs`'s `EXPORTS` string and `app/bench/run-bench.mjs:72` request — read both and include every name they list).

- [ ] **Step 1: Failing test `scripts/build-core.test.mjs`** (node:test from the start — Task 2 converts the others):

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, statSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { buildCore } from "./build-core.mjs";

test("[smoke] buildCore strips types and exposes the optimizer's exports", async () => {
  const out = buildCore();
  const core = await import(pathToFileURL(out).href + "?t=" + Date.now());
  for (const k of ["scoreSet", "optimizeSuit", "optDefaultSlots", "optBuildSpace", "optDominancePrune"]) assert.equal(typeof core[k], "function", k);
  assert.ok(!/: number\b|interface /.test(readFileSync(out, "utf8")), "no TypeScript left");
});
test("[fast] buildCore rebuilds only when the source is newer", () => {
  const dir = mkdtempSync(join(tmpdir(), "core-"));
  const src = join(dir, "c.ts"), out = join(dir, "c.mjs");
  writeFileSync(src, "function f(x: number): number { return x; }\nexport { f };\n");
  buildCore({ src, out }); const first = statSync(out).mtimeMs;
  buildCore({ src, out }); assert.equal(statSync(out).mtimeMs, first, "untouched when up to date");
  utimesSync(src, new Date(), new Date(Date.now() + 5000));
  buildCore({ src, out }); assert.notEqual(statSync(out).mtimeMs, first, "rebuilt when source is newer");
});
```

Run: `node --test scripts/build-core.test.mjs` → FAIL (module missing).

- [ ] **Step 2: `scripts/build-core.mjs`**

```js
#!/usr/bin/env node
// build-core.mjs — compile scripts/optimizer-core.ts (a real ES module) into app/dist/optimizer-core.mjs
// by stripping types with node:module. Idempotent: rewrites only when the source is newer.
import { stripTypeScriptTypes } from "node:module";
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
export const CORE_SRC = join(ROOT, "scripts", "optimizer-core.ts");
export const CORE_OUT = join(ROOT, "app", "dist", "optimizer-core.mjs");

export function buildCore({ src = CORE_SRC, out = CORE_OUT } = {}) {
  if (existsSync(out) && statSync(out).mtimeMs >= statSync(src).mtimeMs) return out;
  const js = stripTypeScriptTypes(readFileSync(src, "utf8"), { mode: "strip" });
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `// generated from ${src.slice(ROOT.length + 1)} by scripts/build-core.mjs — do not edit\n` + js);
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) console.log(buildCore());
```

Append to `scripts/optimizer-core.ts` (after the last function): `export { scoreSet, optimizeSuit, optIsValidAssignment, optMulberry32, optDefaultSlots, optDefaultOptionalSlots, optAssignmentTotals, optGradientProfile, optCollectKeys, optBuildSpace, optDominancePrune, optVec, optScoreVector, optIsTwoHandedWeapon };` (plus any other name the two loader lists request). Note: `stripTypeScriptTypes` with `mode: "strip"` rejects TS-only syntax that needs transformation (enums, namespaces, parameter properties); if it throws, report which construct and fix the source (the core is expected to be plain functions + interfaces).

Run the test → PASS.

- [ ] **Step 3: Wire it in.** `app/config.mjs`: add `core: env.VAULT_CORE ? resolve(env.VAULT_CORE) : join(APP_DIR, "dist", "optimizer-core.mjs")` to `paths`, and a config test case (`[smoke]`): default ends with `app/dist/optimizer-core.mjs`, `VAULT_CORE=/x/core.mjs` wins. `app/vault-server.mjs`: delete `compileCore()` and the `mkdtempSync/copyFileSync/tmpdir` imports it alone used; `const CORE_URL = pathToFileURL(CONFIG.paths.core).href;` guarded by `if (!existsSync(CONFIG.paths.core)) { console.error(\`optimizer core not built — run: npm run build:core (looked in ${CONFIG.paths.core})\`); process.exit(2); }`. Worker call unchanged (`coreUrl: CORE_URL`). `app/gear-vault.test.mjs` `run()`: replace lines 465-471 with `const core = await import(pathToFileURL(resolveConfig().paths.core).href);` (import `resolveConfig` from `./config.mjs`). `scripts/optimizer-core.test.mjs`: replace lines 26-29 with an import of `buildCore` and `const core = await import(pathToFileURL(buildCore()).href);`. `app/bench/run-bench.mjs` and `mip-spike.mjs`: same (`buildCore()` then import; the bench's extra exports are now in the module). `package.json`: `"build:core": "node scripts/build-core.mjs"`, `"pretest": "node scripts/build-core.mjs"`, `"prestart": "node scripts/build-core.mjs"`. `scripts/start.mjs` and `scripts/test-runner.mjs`: call `buildCore()` first (so `./scripts/test_runner.sh` and a bare `node scripts/start.mjs` work without npm). Confirm `.gitignore` covers `app/dist/` (the existing `dist/` line does — verify with `git check-ignore app/dist/optimizer-core.mjs`).

- [ ] **Step 4: Verify** — `grep -rn "mkdtempSync\|export { optimizeSuit" app scripts --include=*.mjs` shows no loader left (only `build-core.test.mjs`'s temp dir); `npm test` (full) → PASS; `VAULT_DATA=$PWD/local node app/vault-server.mjs --port 8790` serves `/api/inventory`, and a POST to `/api/optimize` with a tiny body still returns a job id (or exercise the builder in the browser in Task 5). Kill the server.

- [ ] **Step 5: Commit** — `git add -A scripts app package.json && git commit -m "Compile the optimizer core once into app/dist and delete the temp-file loaders\n\nClaude-Session: https://claude.ai/code/session_012Jc4pEtTUy9dfd8sp6EbPb"`

---

### Task 2: Tests on `node:test`, runner on the `run()` API

**Files:**
- Modify: `app/gear-vault.test.mjs` (harness lines 12-16, every `test(name, tags, fn)` call, the `run()` export), `app/config.test.mjs` (same), `scripts/optimizer-core.test.mjs` (its own runner at 34-46, the exit at 287), `scripts/test-runner.mjs` (rewrite), `TESTING.md`
- Test: the runner itself is verified by running it in all three modes

**Interfaces:**
- Produces: every test is `test("[smoke] name", fn)` / `test("[fast] name", fn)` / `test("[slow] name", { skip: process.env.TEST_SKIP_SLOW ? "TEST_SKIP_SLOW" : false }, fn)` from `node:test`. Runner modes: `--smoke` → `testNamePatterns: [/^\[smoke\]/]`; `--fast` → `[/^\[(smoke|fast)\]/]`; full → no pattern. Files: `app/gear-vault.test.mjs`, `app/config.test.mjs`, `scripts/build-core.test.mjs`, `scripts/optimizer-core.test.mjs`, `app/server.test.mjs` (Task 3 adds it; the runner globs `app/*.test.mjs` and `scripts/*.test.mjs`). Python `adapters/tazuo/test_paths.py` stays a spawned unit (fast+full).

- [ ] **Step 1: Convert the two vault test files.** Mechanical rewrite: `import { test } from "node:test";` replaces the local `test`/`results` harness; `test("parseTooltip …", ["smoke"], () => …)` → `test("[smoke] parseTooltip …", () => …)`. The `run()` export in `gear-vault.test.mjs` (the optimizer smoke run at 464-~560) becomes ordinary `test(...)` calls inside a top-level `await`ed setup: load the core once at module top (`const core = await import(...)`, top-level await is fine in ESM test files), then `test("[fast] exact search matches brute force …")` etc. — one `test` per former assertion group, names taken from the existing comments. The budgeted/parallel cases (the ones with `timeBudgetMs` ≥ 1000 or 150 random suits) get `[slow]` and the skip option. `config.test.mjs` likewise (all `[smoke]`).

- [ ] **Step 2: Convert `scripts/optimizer-core.test.mjs`.** Its local `test(name, fn)` + `passed/failures` + `process.exit(1)` become `node:test` `test("[slow] …")` for the budgeted searches and `[fast]` for the cheap checks; delete the tiny runner and the final summary/exit block; keep the seeded data as is.

- [ ] **Step 3: Rewrite `scripts/test-runner.mjs`** on the API:

```js
#!/usr/bin/env node
// test-runner.mjs — standard test interface: node scripts/test-runner.mjs [--smoke|--fast]  (full when no flag)
// Drives node:test's run() over app/*.test.mjs + scripts/*.test.mjs, spawns the Python adapter test, and writes
// test_logs/latest_summary.json. Tags are name prefixes: [smoke] [fast] [slow].
import { run } from "node:test";
import { writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { buildCore } from "./build-core.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const mode = process.argv.includes("--smoke") ? "smoke" : process.argv.includes("--fast") ? "fast" : "full";
const patterns = mode === "smoke" ? [/^\[smoke\]/] : mode === "fast" ? [/^\[(smoke|fast)\]/] : undefined;
buildCore();

const files = ["app", "scripts"].flatMap((d) => readdirSync(join(ROOT, d)).filter((f) => f.endsWith(".test.mjs")).map((f) => join(ROOT, d, f)));
let total = 0, passed = 0, failed = 0, skipped = 0; const failures = [];
const stream = run({ files, testNamePatterns: patterns, concurrency: 1 });
stream.on("test:pass", (t) => { if (t.nesting > 0) return; total++; if (t.skip) skipped++; else passed++; });
stream.on("test:fail", (t) => { if (t.nesting > 0) return; total++; failed++; failures.push({ file: relative(ROOT, t.file || ""), line: t.line || 0, test_name: t.name, error: String(t.details?.error?.message || t.details?.error || "failed").slice(0, 600) }); });
stream.on("test:stderr", (m) => process.stderr.write(m.message));
await new Promise((ok) => stream.once("end", ok));
// tests filtered out by the name pattern are neither run nor counted; report them as skipped for the summary's shape
if (mode !== "full") {
  const py = mode !== "smoke";
  if (py) runPython();
} else runPython();

function runPython() {
  const cmds = ["python3", "python"];
  const py = cmds.find((c) => { const r = spawnSync(c, ["--version"], { encoding: "utf8" }); return !r.error && /^Python 3/.test((r.stdout || "") + (r.stderr || "")); });
  total++;
  if (!py) { skipped++; console.log("  SKIP adapters/tazuo/test_paths.py (no python3/python on PATH)"); return; }
  const r = spawnSync(py, ["-W", "error", join(ROOT, "adapters", "tazuo", "test_paths.py")], { encoding: "utf8" });
  if (r.status === 0) passed++; else { failed++; failures.push({ file: "adapters/tazuo/test_paths.py", line: 0, test_name: "adapter path tests", error: (r.stderr || r.stdout).slice(-600) }); }
}
mkdirSync(join(ROOT, "test_logs"), { recursive: true });
const summary = { timestamp: new Date().toISOString(), mode, total, passed, failed, skipped, failures };
writeFileSync(join(ROOT, "test_logs", "latest_summary.json"), JSON.stringify(summary, null, 2) + "\n");
console.log(`${mode}: ${passed}/${total} passed, ${failed} failed, ${skipped} skipped`);
for (const f of failures) console.log(`  FAIL ${f.file} ${f.test_name}: ${f.error}`);
process.exit(failed ? 1 : 0);
```

The `test:pass`/`test:fail` event payloads carry `name`, `file`, `line`, `nesting`, `skip`, `details.error` in Node 22/24 — verify the field names against `node --test-reporter` output on this Node if a count looks wrong. Keep the Python unit in fast+full as before (adjust the block above so it is called for fast and full, not smoke).

- [ ] **Step 4: Verify** — `npm test -- --smoke`, `-- --fast`, `npm test`: each prints a sane line and the JSON has the right `mode`; full counts ≈ former 49 + the split-out optimizer cases; `TEST_SKIP_SLOW=1 npm test` shows the slow cases as skipped; `node --test app scripts` (plain TAP for humans) also works. Introduce a deliberate failing assertion in a scratch copy to confirm `failures[]` carries file/line/name/error, then remove it.

- [ ] **Step 5: `TESTING.md`** — rewrite the tag section: tags are name prefixes; `[slow]` and `TEST_SKIP_SLOW`; the file list; `node --test` for ad-hoc runs; remove every mention of `run()`/`results`.

- [ ] **Step 6: Commit** — `git add -A app scripts TESTING.md && git commit -m "Move every test onto node:test with tagged names and a run()-driven runner\n\nClaude-Session: https://claude.ai/code/session_012Jc4pEtTUy9dfd8sp6EbPb"`

---

### Task 3: Server exports `startServer`, serves `/ui/*` from an allowlist with a CSP, route tests

**Files:**
- Modify: `app/vault-server.mjs` (the `http.createServer(...)`/`listen` tail, `send()`, static routes at 243-244, header comment)
- Create: `app/server.test.mjs`

**Interfaces:**
- Produces: `export async function startServer(config = ensureLayout(resolveConfig())) → { server, port, url, close() }` — binds `127.0.0.1:config.port` (port `0` allowed → OS-assigned, read back from `server.address().port`); prints the URL and opens the browser only when `config.open`. Auto-start block at the end: `if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await startServer();`. Static routes: `GET /` → `app/index.html` (until Task 4 lands, keep serving `gear-vault.html` under `/` — Task 4 flips the filename); `GET /vault-lib.mjs` (unchanged); `GET /ui/<name>` where `<name>` matches `/^[a-z0-9-]+\.(mjs|css)$/` → `app/ui/<name>` with `text/javascript` or `text/css`; anything else under `/ui/` → 404. `send()` adds `content-security-policy` (the Global Constraints string) on `text/html` responses and `x-content-type-options: nosniff` on everything.

- [ ] **Step 1: Failing tests `app/server.test.mjs`**

```js
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveConfig, ensureLayout } from "./config.mjs";
import { startServer } from "./vault-server.mjs";

let srv;
before(async () => { srv = await startServer(ensureLayout(resolveConfig(["--demo", "--port", "0", "--data", mkdtempSync(join(tmpdir(), "qm-"))], {}))); });
after(() => srv.close());
const get = (p) => fetch(srv.url + p);

test("[smoke] / serves the page with a CSP and no inline script", async () => {
  const r = await get("/"); assert.equal(r.status, 200);
  assert.match(r.headers.get("content-security-policy") || "", /script-src 'self'/);
  assert.equal(r.headers.get("x-content-type-options"), "nosniff");
  assert.doesNotMatch(await r.text(), /<script(?![^>]*\bsrc=)/, "no inline <script>");   // passes once Task 4 lands; until then expect one inline script — see Step 3
});
test("[smoke] /api/inventory has no scansDir and folds the demo fixtures", async () => {
  const j = await (await get("/api/inventory")).json();
  assert.equal(j.ok, true); assert.equal("scansDir" in j, false); assert.ok(j.snapshotCount >= 2);
});
test("[fast] /ui/ serves only allowlisted files", async () => {
  assert.equal((await get("/ui/app.mjs")).status, 200);                    // exists after Task 4; until then test with vault-lib.mjs
  assert.equal((await get("/ui/../vault-server.mjs")).status, 404);
  assert.equal((await get("/ui/nope.mjs")).status, 404);
  assert.equal((await get("/ui/app.mjs")).headers.get("content-type"), "text/javascript; charset=utf-8");
});
test("[fast] writes require application/json", async () => {
  const r = await fetch(srv.url + "/api/profiles", { method: "PUT", body: "{}" });
  assert.equal(r.status, 415);
});
```

The last test adds one small guard from spec §4.5 that is natural here: `PUT`/`POST` on `/api/*` without `content-type: application/json` → 415. Implement it in the JSON body reader. Run: `node --test app/server.test.mjs` → FAIL (`startServer` not exported).

- [ ] **Step 2: Refactor the server tail.** Wrap the existing `http.createServer(async (req, res) => { … })` + `listen` in `startServer(config)`; the module-level `CONFIG` becomes the function's parameter (keep module-level constants that depend on it — `SCANS`, `PROFILES`, … — as `let`s assigned inside `startServer`, or simplest: move the whole route handler inside the function so it closes over `config`). Add the static allowlist and headers per the interface. Return `{ server, port, url, close: () => new Promise((ok) => server.close(ok)) }`. Add the main-module guard.

- [ ] **Step 3: Run the tests** — everything passes except the two assertions that depend on Task 4 (`no inline <script>`, `/ui/app.mjs`): mark those two with `{ todo: "until the page split lands" }` in this task and remove the `todo` in Task 4. `npm test` → PASS; `node app/vault-server.mjs --demo --port 8791` still starts and prints the URL; `node scripts/start.mjs --demo --port 8791` too. Kill both.

- [ ] **Step 4: Commit** — `git add app && git commit -m "Export startServer, serve ui/ from an allowlist with a CSP, add route tests\n\nClaude-Session: https://claude.ai/code/session_012Jc4pEtTUy9dfd8sp6EbPb"`

---

### Task 4: Page split, part A — `index.html`, styles, dom/store/bridge/sheet/characters/containers/inventory, `app.mjs`

**Files:**
- Rename: `app/gear-vault.html` → `app/index.html` (`git mv`), then strip it to markup
- Create: `app/ui/styles.css`, `app/ui/dom.mjs`, `app/ui/store.mjs`, `app/ui/bridge.mjs`, `app/ui/sheet.mjs`, `app/ui/characters.mjs`, `app/ui/containers.mjs`, `app/ui/inventory.mjs`, `app/ui/builder.mjs` (in this task: the ENTIRE remaining builder + runs + optimize-job code, moved verbatim as one module; Task 5 splits it), `app/ui/app.mjs`
- Modify: `app/vault-server.mjs` (`/` → `index.html`), `app/server.test.mjs` (drop the two `todo`s)

**Interfaces (exact export lists — sourced from a fact-gathering note kept outside this repository, which had each function's line):**
- `ui/dom.mjs` exports `$`, `el`, `toast`, `fmtWhen`, `ago`, `isStale`, `fmtN`, `fmtSecs`, `fmtRunTime`, `label`, `full`, `colVal`, `slotLabel`, `EXTRA_COLS`, `RARITY_RANK`, `RARITY_COLOR`, `rarRank`, `rarCell`, `installTooltip()` (wraps the former module-level `tip`/`HOT_PROPS` + the three `document` mouse listeners; `tipLine`, `tipHtml`, `placeTip` stay private). `toastTimer` stays private.
- `ui/store.mjs` exports `state` (the object from line 374, verbatim), `bridge` (the object from 1169), `invStamp`.
- `ui/bridge.mjs` exports `chainOf`, `rootPos`, `sendBridge`, `actButtons`, `grabAllRow`, `grabAllState`, `pollBridge`, `BRIDGE_OFFLINE`; imports `state`, `bridge` from store, `el`, `toast` from dom.
- `ui/sheet.mjs` exports `sheetHtml`, `SHEET_STATS`.
- `ui/characters.mjs` exports `renderCharacters`, `dollHtml`, `DOLL_LAYOUT`. **Drop** `pillFor` and `CAP_KEYS` (dead code, map §5 item 6).
- `ui/containers.mjs` exports `renderContainers`; its Forget handler calls `load` imported from `./app.mjs` (a module cycle: allowed — both are function declarations called only after bootstrap).
- `ui/inventory.mjs` exports `buildFilters`, `renderInventory`, `renderPropFilters`, `renderColChips`, `filtered`.
- `ui/builder.mjs` (this task) exports everything the other modules or the router need: `buildBuilder`, `selectCharacter`, `renderResult`, `loadRuns`, `cancelJob`; the rest stays private for now.
- `ui/app.mjs`: `export async function load()`; the router (`TABS`, `parseRoute`, `routeFor`, `showTab`, `applyRoute`), the tab-nav click wiring, `hashchange`, `pagehide` (uses `state.builder.job`), `installTooltip()`, `setInterval(pollBridge, 2500)` + immediate call, and the final `load().catch(...)`. Every `import` from `/vault-lib.mjs` becomes `import { … } from "../vault-lib.mjs"` in the module that uses each name (split the 24-name import by consumer; unused names are dropped).

- [ ] **Step 1: Branch state check** — `npm test` green at HEAD; start `node scripts/start.mjs --demo --port 8791`, open it with the Playwright browser tools, record a baseline: for each of the four tabs, the count of table rows / cards rendered and the console error count (expected 0). Save the numbers in the report.

- [ ] **Step 2: Move the CSS** — cut lines 9-228's `<style>` body into `app/ui/styles.css`; replace with `<link rel="stylesheet" href="/ui/styles.css">`.

- [ ] **Step 3: Create the modules** in dependency order (dom → store → sheet → bridge → characters → containers → inventory → builder → app), cutting each function from the script verbatim and adding `export`/`import` lines only. Rule: a moved function's body is unchanged (diff it mentally against the map's line ranges); references to other page functions become imports; references to `state`/`bridge` become imports from store. `index.html` ends with `<script type="module" src="/ui/app.mjs"></script>` and no other script.

- [ ] **Step 4: Server + tests** — `/` serves `index.html`; remove the two `todo`s in `app/server.test.mjs`. `npm test` → PASS.

- [ ] **Step 5: Rendered verification (the gate for this task)** — restart the demo server, open the page with Playwright: (a) zero console errors on load and after clicking each of the four tabs; (b) the Inventory table renders the same row count as the Step 1 baseline, sorting by clicking a column header works, the text filter narrows rows; (c) Characters shows two cards (Kestrel, Dorran) with paperdolls; (d) Containers lists the fixture roots; (e) Builder: pick Kestrel, press Run with exact search OFF (heuristic) — the result panel renders a suit and the "other suits" list; press Save; open the runs drawer and see the run; (f) hover an item → tooltip appears; (g) the bridge pill shows offline (no adapter running) and Grab/Highlight buttons toast the offline message. Take one screenshot per tab into the report folder. Then also verify against real data: `VAULT_DATA=$PWD/local node scripts/start.mjs --port 8790`, open, check zero console errors on all tabs and that the Builder loads a saved run from the drawer (real runs exist in `local/runs`). Kill both servers.

- [ ] **Step 6: Commit** — `git add -A app && git commit -m "Split the page into index.html, styles.css and ui/ modules\n\nClaude-Session: https://claude.ai/code/session_012Jc4pEtTUy9dfd8sp6EbPb"`

---

### Task 5: Page split, part B — `builder.mjs` → `builder.mjs` + `runs.mjs`

**Files:**
- Modify: `app/ui/builder.mjs`; Create: `app/ui/runs.mjs`

**Interfaces:**
- `ui/runs.mjs` exports `settingsSnapshot`, `applySettings`, `profileFromSettings`, `loadRuns`, `openRunsDrawer`, `closeRunsDrawer`, `updateCompareBtn`, `renderRuns`, `renameRun`, `openRun`, `compareSelected`; imports `renderResult`, `readControls`, `poolControls`, `renderProfile` from `./builder.mjs` (cycle allowed, function declarations only), `state` from store, dom helpers, `settingsDiff`/`buildPools`/`totalsOf`/`resistSkillBonus`/`effectiveProfile`/`slotLabel` from the lib as each needs.
- `ui/builder.mjs` keeps `buildBuilder`, `selectCharacter`, `poolControls`, `readControls`, the template functions, `numGrid`, `renderProfile`, `optimizerProfile`, the optimize job (`runBuild`, `endJob`, `finishJob`, `cancelJob`, `runPanel`, `runStats`, `PHASES`), `renderResult`, `altPanel`, `saveProfile`; imports `loadRuns`, `settingsSnapshot`, `openRunsDrawer`, `compareSelected` from `./runs.mjs`. Exports what runs.mjs, app.mjs and bridge need (`renderResult`, `readControls`, `poolControls`, `renderProfile`, `selectCharacter`, `buildBuilder`, `cancelJob`).

- [ ] **Step 1: Move the eleven runs functions verbatim** into `ui/runs.mjs`; fix imports both ways. `numGrid`'s by-reference mutation (map §5 item 4) stays as is — behaviour unchanged is the rule; add a one-line comment above it saying it mutates its argument.

- [ ] **Step 2: `npm test` → PASS; rendered verification** — same Playwright pass as Task 4 Step 5 (e) and the real-data drawer check: run a heuristic build, save, open the drawer, open a run, compare two runs (select two, press Compare), rename one. Zero console errors. Kill the servers.

- [ ] **Step 3: Commit** — `git add -A app/ui && git commit -m "Split the saved-runs drawer out of the builder module\n\nClaude-Session: https://claude.ai/code/session_012Jc4pEtTUy9dfd8sp6EbPb"`

---

### Task 6: Phase gate — naming, docs, changelog

**Files:**
- Modify: comments still saying "Gear Vault" in `app/vault-server.mjs:1`, `app/vault-lib.mjs:1`, `scripts/optimizer-core.ts:63`, any `app/ui/*.mjs` header; `CONTRIBUTING.md` (dev loop: `npm start`, `npm run build:core`, the `ui/` module map with one line per module, how to add a test with a tag); `CHANGELOG.md` (`## Unreleased` bullets for Tasks 1-5); `README.md` Developing line if it changed

- [ ] **Step 1:** `grep -rn "Gear Vault" --exclude-dir=.git --exclude-dir=local --exclude-dir=docs --exclude-dir=.superpowers . ` → only the intentional component name in `index.html`'s inventory tab heading if the team keeps it (spec §2 allows "Gear Vault" as the inventory component's name); everything else says Pack Rat.
- [ ] **Step 2:** `grep -rn "gear-vault.html\|compileCore\|coreUrl" --exclude-dir=.git --exclude-dir=local --exclude-dir=docs . ` → `coreUrl` only in the worker interface; no `gear-vault.html`.
- [ ] **Step 3:** `npm test` full and `TEST_SKIP_SLOW=1 npm test -- --fast` both green; `git status` shows no `app/dist` or `test_logs` staged.
- [ ] **Step 4: Commit** — `git add -A && git commit -m "Update the docs for the module layout and close Phase 1\n\nClaude-Session: https://claude.ai/code/session_012Jc4pEtTUy9dfd8sp6EbPb"` (no merge; the whole-branch review decides).

---

## Self-review

- **Spec coverage:** page split (T4-5), inline script externalised + CSP (T3-4), core precompiled + loaders deleted + `VAULT_CORE` (T1), tests on `node:test` with tags/slow (T2), `vaulttest-*` temp dirs gone (T1), `startServer` for the future shell (T3), Phase 0 carry-overs: route tests (T3), "Gear Vault" comments (T6). The content-type guard (T3) is a one-line §4.5 item pulled forward because the route tests make it free; the token/Origin checks stay in Phase 2.
- **Placeholders:** the two `todo` assertions in T3 are explicit and removed in T4; T4's module export lists are exact; function bodies are "verbatim" by rule, not by pasted code (they exist in the file the executor edits).
- **Type consistency:** `buildCore({src,out})` (T1) is what T2's runner and T1's bench edits call; `startServer(config)` → `{server,port,url,close}` (T3) is what `server.test.mjs` uses; `resolveConfig().paths.core` (T1) is what the server and the test loader use; `load` exported from `ui/app.mjs` (T4) is what `containers.mjs` imports.
