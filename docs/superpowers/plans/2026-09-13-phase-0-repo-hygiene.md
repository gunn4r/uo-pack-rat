# Pack Rat Phase 0 — Repo Hygiene Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the untouched Gear Vault copy (commit `9b640ed`) into a repo that runs from a configurable data directory, carries no personal data, has settled contracts, and works on Windows — the base every later phase builds on.

**Architecture:** One config module resolves every path once (`--data` flag → `VAULT_DATA` env → `~/.pack-rat`); the server, bench and tests take paths from it. Fixtures are synthetic (bench generator, fixed seed, fictional names). The TazUO scripts are renamed `packrat-*.py`, read a `packrat-paths.json` beside them, and write temp-then-rename. `npm test` runs a Node test runner that writes `test_logs/latest_summary.json`.

**Tech Stack:** Node ≥ 22.18 (ESM, `node:test` arrives in Phase 1), zero runtime dependencies, Python 3 (TazUO's embedded runtime) for adapters.

**Spec:** `docs/superpowers/specs/2026-09-12-desktop-app-public-release-design.md` — §0, §4.2, §8, §11 ("Upgrade and migration"), §12 Phase 0.

## Global Constraints

- The original private workspace is never modified. All work is in `~/r/pack-rat` (this repo). Never write into `~/Desktop/TazUO/…/LegionScripts/` from this plan — adapter scripts here are files in the repo only.
- Adapter script filenames are `packrat-scanner.py`, `packrat-refresh.py`, `packrat-bridge.py` (spec §0). No file named `vault-*.py` may remain in `adapters/`.
- Never write the literal phrase `while True` (or `while (true)`, `while(true)`) anywhere in a `.py` file — comments included. Loops are `while not API.StopRequested:` with a deadline. `import API` on its own line.
- No `-claude` suffix anywhere in the repo after this phase (`grep -rn -- '-claude' --exclude-dir=.git --exclude-dir=local .` returns only the research documents, which are scrubbed in Phase 5).
- No personal paths: grep the tree for the private workspace's name, the maintainer's home directory or name, or a stray `.nvm/` reference (`--exclude-dir=.git --exclude-dir=local --exclude-dir=docs .`) — must be empty at the end of the phase.
- Prose files are not hard-wrapped. Commit messages are imperative, end with `Claude-Session: https://claude.ai/code/session_012Jc4pEtTUy9dfd8sp6EbPb`, and never carry `Co-Authored-By`. Commits go on branch `phase-0-hygiene` (never `main`).
- Package name `pack-rat`, product name "Pack Rat", MIT license, `engines.node >= 22.18`.
- The test interface is `./scripts/test_runner.sh [--smoke|--fast]` writing `test_logs/latest_summary.json` in the format `{timestamp, mode, total, passed, failed, skipped, failures:[{file,line,test_name,error}]}`; `npm test` is the same runner.

## File structure after Phase 0

| Path | Responsibility |
|---|---|
| `package.json`, `LICENSE`, `.gitattributes`, `.gitignore` | project identity, MIT, exec bits for `.sh`, ignore rules |
| `app/config.mjs` (new) | resolve data dir, port, demo flag, all sub-paths; create the layout |
| `app/vault-server.mjs` | HTTP server; imports paths from `config.mjs`; prints URL, opens browser only with `--open` |
| `scripts/start.mjs` (new) | cross-platform launcher replacing `app/gear-vault.sh` (removed) |
| `scripts/test-runner.mjs` (new) | the runner (moved out of the bash heredoc); `scripts/test_runner.sh` becomes a 4-line wrapper |
| `app/bench/gen-inventory.mjs`, `run-bench.mjs` | read real scans from `config.paths.scans`, profiles from `config.paths.profiles` |
| `app/fixtures/demo-Kestrel.json`, `demo-Dorran.json` (regenerated) | synthetic fixtures; the two old fixtures named after real characters deleted |
| `app/fixtures/README.md` (new) | how the fixtures were generated (command + seed) |
| `app/vault-lib.mjs`, `app/runs-lib.mjs`, `app/gear-vault.html` | contracts settled (`allowOthersWorn`, `budgetMs`, `schemaVersion`) |
| `app/data/profiles.default.json` | `characters: {}`, four templates, neutral `_comment` |
| `adapters/tazuo/packrat-{scanner,refresh,bridge}.py`, `adapters/tazuo/packrat-paths.example.json`, `adapters/tazuo/README.md` | renamed, path-configurable, temp-then-rename |
| `CONTRIBUTING.md` (new, from `app/CLAUDE.md`, which is deleted) | dev loop, data model, gotchas — scrubbed |

---

### Task 1: Project scaffolding and the Node test runner

**Files:**
- Create: `package.json`, `LICENSE`, `.gitattributes`, `scripts/test-runner.mjs`
- Modify: `scripts/test_runner.sh` (whole file), `.gitignore`, `TESTING.md`
- Test: running `npm test -- --smoke` writes `test_logs/latest_summary.json`

**Interfaces:**
- Produces: `npm test [-- --smoke|--fast]`, `node scripts/test-runner.mjs [--smoke|--fast]`; summary JSON at `test_logs/latest_summary.json`.

- [ ] **Step 1: Create the branch**

```bash
cd ~/r/pack-rat && git switch -c phase-0-hygiene
```

- [ ] **Step 2: Write `package.json`**

```json
{
  "name": "pack-rat",
  "version": "0.1.0",
  "description": "Every item you own, every suit you could wear. Inventory and suit builder for Ultima Online players.",
  "productName": "Pack Rat",
  "license": "MIT",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22.18" },
  "scripts": {
    "start": "node scripts/start.mjs",
    "test": "node scripts/test-runner.mjs",
    "test:smoke": "node scripts/test-runner.mjs --smoke",
    "test:fast": "node scripts/test-runner.mjs --fast"
  }
}
```

- [ ] **Step 3: Write `LICENSE`** (MIT, copyright line `Copyright (c) 2026 the maintainer`), and `.gitattributes`:

```
* text=auto
*.sh text eol=lf
scripts/test_runner.sh eol=lf
```

- [ ] **Step 4: Write `scripts/test-runner.mjs`** — the body of the old bash heredoc, unchanged in logic, plus argument parsing:

```js
#!/usr/bin/env node
// test-runner.mjs — the project's standard test interface.
//   node scripts/test-runner.mjs [--smoke|--fast]      (full when no flag)
// Runs the test files and writes test_logs/latest_summary.json.
import { writeFileSync, mkdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const mode = process.argv.includes("--smoke") ? "smoke" : process.argv.includes("--fast") ? "fast" : "full";
let total = 0, passed = 0, failed = 0, skipped = 0; const failures = [];

const vault = await import(pathToFileURL(join(ROOT, "app", "gear-vault.test.mjs")).href);
const { results } = await vault.run();
for (const t of results) {
  const wanted = mode === "full" || t.tags.includes(mode) || (mode === "fast" && t.tags.includes("smoke"));
  if (!wanted) { skipped++; continue; }
  total++; if (t.ok) passed++; else { failed++; failures.push({ file: "app/gear-vault.test.mjs", line: 0, test_name: t.name, error: t.error }); }
}
if (mode === "full") {
  total++;
  const r = spawnSync(process.execPath, [join(ROOT, "scripts", "optimizer-core.test.mjs")], { encoding: "utf8" });
  if (r.status === 0) passed++; else { failed++; failures.push({ file: "scripts/optimizer-core.test.mjs", line: 0, test_name: "optimizer-core harness", error: (r.stderr || r.stdout).slice(-600) }); }
}
mkdirSync(join(ROOT, "test_logs"), { recursive: true });
const summary = { timestamp: new Date().toISOString(), mode, total, passed, failed, skipped, failures };
writeFileSync(join(ROOT, "test_logs", "latest_summary.json"), JSON.stringify(summary, null, 2) + "\n");
console.log(`${mode}: ${passed}/${total} passed, ${failed} failed, ${skipped} skipped`);
for (const f of failures) console.log(`  FAIL ${f.test_name}: ${f.error}`);
process.exit(failed ? 1 : 0);
```

- [ ] **Step 5: Replace `scripts/test_runner.sh`** with a wrapper (no nvm path):

```bash
#!/usr/bin/env bash
# test_runner.sh — standard interface; delegates to the Node runner. Usage: --smoke | --fast | (full)
cd "$(dirname "$0")/.."
exec node scripts/test-runner.mjs "$@"
```

- [ ] **Step 6: Run it and check the summary**

Run: `npm test -- --smoke && cat test_logs/latest_summary.json | head -8`
Expected: `smoke: N/N passed, 0 failed` and the JSON has `"mode": "smoke"`.

Run: `./scripts/test_runner.sh` (full). Expected: exit 0 (the 37 vault tests + optimizer harness).

- [ ] **Step 7: Update `TESTING.md`** — replace the last paragraph ("Node: the runner uses `node` from PATH, falling back to …") with: `Node ≥ 22.18 on PATH. `npm test` is the same runner as `./scripts/test_runner.sh`.` Remove the `--fast`/`--smoke` fixture sentence's mention of "the real Aug 26 2026 Rowan scan" (Task 4 replaces the fixtures; write "synthetic fixtures, see `app/fixtures/README.md`").

- [ ] **Step 8: Commit**

```bash
git add package.json LICENSE .gitattributes scripts/test-runner.mjs scripts/test_runner.sh TESTING.md
git commit -m "Add package.json, MIT license and a Node test runner

Claude-Session: https://claude.ai/code/session_012Jc4pEtTUy9dfd8sp6EbPb"
```

---

### Task 2: Config resolver, data directory, cross-platform launcher

**Files:**
- Create: `app/config.mjs`, `scripts/start.mjs`, `app/config.test.mjs` (new test file, plain assert + exported `run()` like `gear-vault.test.mjs`)
- Modify: `app/vault-server.mjs:28-46` (path constants), `:330` (browser open), header comment lines 1-12; `scripts/test-runner.mjs` (add the config tests)
- Delete: `app/gear-vault.sh`

**Interfaces:**
- Produces: `export function resolveConfig(argv = process.argv.slice(2), env = process.env, home = os.homedir()) → { dataDir, port, demo, open, paths: { scans, profiles, defaultProfiles, runs, bridge, bridgeQueue, bridgeStatus, logs } }` and `export function ensureLayout(config)` (mkdir -p every directory in `paths`). `dataDir` precedence: `--data <dir>` → `env.VAULT_DATA` → `join(home, ".pack-rat")`. `demo` = `--demo` present → `paths.scans` becomes `app/fixtures`. `port` = `--port N` → `env.VAULT_PORT` → 8765. `open` = `--open` present (default false).
- `paths.bridge` = `<dataDir>/bridge/tazuo` (per-adapter, spec §4.2); `bridgeQueue` = `<bridge>/queue.jsonl`, `bridgeStatus` = `<bridge>/status.json`.

- [ ] **Step 1: Write the failing test `app/config.test.mjs`**

```js
import assert from "node:assert/strict";
import { join } from "node:path";
import { resolveConfig } from "./config.mjs";

const tests = [];
const test = (name, tags, fn) => tests.push({ name, tags, fn });

test("config: defaults to ~/.pack-rat and port 8765", ["smoke"], () => {
  const c = resolveConfig([], {}, "/home/x");
  assert.equal(c.dataDir, join("/home/x", ".pack-rat"));
  assert.equal(c.port, 8765);
  assert.equal(c.demo, false);
  assert.equal(c.open, false);
  assert.equal(c.paths.scans, join(c.dataDir, "scans"));
  assert.equal(c.paths.profiles, join(c.dataDir, "profiles.json"));
  assert.equal(c.paths.runs, join(c.dataDir, "runs"));
  assert.equal(c.paths.bridgeQueue, join(c.dataDir, "bridge", "tazuo", "queue.jsonl"));
});
test("config: --data beats VAULT_DATA beats home; --port beats VAULT_PORT", ["smoke"], () => {
  assert.equal(resolveConfig([], { VAULT_DATA: "/env" }, "/h").dataDir, "/env");
  assert.equal(resolveConfig(["--data", "/flag"], { VAULT_DATA: "/env" }, "/h").dataDir, "/flag");
  assert.equal(resolveConfig(["--port", "9000"], { VAULT_PORT: "8000" }, "/h").port, 9000);
  assert.equal(resolveConfig([], { VAULT_PORT: "8000" }, "/h").port, 8000);
});
test("config: --demo points scans at app/fixtures, --open sets open", ["smoke"], () => {
  const c = resolveConfig(["--demo", "--open"], {}, "/h");
  assert.ok(c.demo && c.open);
  assert.ok(c.paths.scans.endsWith(join("app", "fixtures")));
  assert.equal(c.paths.profiles, join(c.dataDir, "profiles.json"));   // demo changes scans only
});

export async function run() {
  const results = [];
  for (const t of tests) { try { await t.fn(); results.push({ name: t.name, tags: t.tags, ok: true }); } catch (e) { results.push({ name: t.name, tags: t.tags, ok: false, error: String(e?.message || e) }); } }
  return { results };
}
```

- [ ] **Step 2: Wire the runner** — in `scripts/test-runner.mjs`, after the vault loop, load `app/config.test.mjs` the same way and fold its results in (file name `app/config.test.mjs` in failures). Run `npm test -- --smoke` → expected FAIL: `Cannot find module …/app/config.mjs`.

- [ ] **Step 3: Write `app/config.mjs`**

```js
// config.mjs — every path the server, bench and adapters agree on, resolved once.
//   data dir: --data <dir>  →  VAULT_DATA  →  ~/.pack-rat
//   port:     --port N      →  VAULT_PORT  →  8765
//   --demo   serve app/fixtures instead of <data>/scans     --open   open the browser after listening
import { homedir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const APP_DIR = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_PORT = 8765;

function flag(argv, name) { const i = argv.indexOf(name); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null; }

export function resolveConfig(argv = process.argv.slice(2), env = process.env, home = homedir()) {
  const dataDir = resolve(flag(argv, "--data") || env.VAULT_DATA || join(home, ".pack-rat"));
  const port = +(flag(argv, "--port") || env.VAULT_PORT || DEFAULT_PORT);
  const demo = argv.includes("--demo"), open = argv.includes("--open");
  const bridge = join(dataDir, "bridge", "tazuo");
  return {
    dataDir, port, demo, open,
    paths: {
      scans: demo ? join(APP_DIR, "fixtures") : join(dataDir, "scans"),
      profiles: join(dataDir, "profiles.json"),
      defaultProfiles: join(APP_DIR, "data", "profiles.default.json"),
      runs: join(dataDir, "runs"),
      bridge, bridgeQueue: join(bridge, "queue.jsonl"), bridgeStatus: join(bridge, "status.json"),
      logs: join(dataDir, "logs"),
    },
  };
}

export function ensureLayout(config) {
  for (const p of [config.dataDir, config.paths.runs, config.paths.bridge, config.paths.logs]) mkdirSync(p, { recursive: true });
  if (!config.demo) mkdirSync(config.paths.scans, { recursive: true });
  return config;
}
```

- [ ] **Step 4: Run** `npm test -- --smoke` → expected PASS for the three config tests.

- [ ] **Step 5: Make the server use it.** In `app/vault-server.mjs` replace lines 28-36 (`HERE`, `ROOT`, `ARGS`, `PORT`, `SCANS`, `PROFILES`, `BRIDGE`, `DEFAULT_PROFILES`, `RUNS`) with:

```js
import { resolveConfig, ensureLayout, APP_DIR } from "./config.mjs";
const CONFIG = ensureLayout(resolveConfig());
const HERE = APP_DIR;
const ROOT = dirname(HERE);
const PORT = CONFIG.port;
const SCANS = CONFIG.paths.scans, PROFILES = CONFIG.paths.profiles, DEFAULT_PROFILES = CONFIG.paths.defaultProfiles;
const RUNS = CONFIG.paths.runs, BRIDGE = CONFIG.paths.bridge;
```

Keep `ROOT` only if something else still needs it (the core loader at line 40 does: `join(ROOT, "scripts", "optimizer-core.ts")` — unchanged this phase). Delete the now-unused `ARGS`. Anywhere `join(BRIDGE, "queue.jsonl")` / `"status.json"` appear, use `CONFIG.paths.bridgeQueue` / `bridgeStatus`. Replace line 330 with:

```js
  console.log(`Pack Rat: ${addr}  (data: ${CONFIG.dataDir})`);
  if (CONFIG.open) {
    const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
    const args = process.platform === "win32" ? ["/c", "start", "", addr] : [addr];
    spawn(cmd, args, { stdio: "ignore", detached: true }).unref();
  }
```

Update the header comment (lines 1-12): usage becomes `node app/vault-server.mjs [--data <dir>] [--port N] [--demo] [--open]`, `exports/scans` → `<data>/scans`. Remove any `--no-open` mention.

- [ ] **Step 6: Write `scripts/start.mjs`** — replaces `app/gear-vault.sh`; single responsibility: run the server with the same flags, and restart cleanly if one is already on the port:

```js
#!/usr/bin/env node
// start.mjs — start the Pack Rat server (bare, no Electron). Flags pass through to the server.
//   npm start -- --open        npm start -- --demo --port 9000
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveConfig } from "../app/config.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const { port } = resolveConfig(args);

const free = await new Promise((ok) => { const s = createServer(); s.once("error", () => ok(false)); s.listen(port, "127.0.0.1", () => s.close(() => ok(true))); });
if (!free) { console.error(`port ${port} is in use — stop the other server or pass --port`); process.exit(2); }
const child = spawn(process.execPath, [join(ROOT, "app", "vault-server.mjs"), ...args], { stdio: "inherit" });
child.on("exit", (code) => process.exit(code ?? 0));
```

Delete `app/gear-vault.sh` (`git rm app/gear-vault.sh`).

- [ ] **Step 7: Verify by hand**

Run: `VAULT_DATA=$PWD/local node app/vault-server.mjs --port 8790 &` then `curl -s localhost:8790/api/inventory | head -c 200` → JSON with `"ok":true` and the maintainer's snapshots (from `local/scans`). Kill it. Run: `node scripts/start.mjs --demo --port 8791 &` → prints `Pack Rat: http://…:8791`, `curl` returns the fixtures' inventory. Kill it. Run the full suite → PASS.

- [ ] **Step 8: Commit**

```bash
git add app/config.mjs app/config.test.mjs app/vault-server.mjs scripts/start.mjs scripts/test-runner.mjs
git rm -q app/gear-vault.sh
git commit -m "Resolve every path through app/config.mjs and add a Node launcher

Claude-Session: https://claude.ai/code/session_012Jc4pEtTUy9dfd8sp6EbPb"
```

---

### Task 3: Bench harness reads the data directory

**Files:**
- Modify: `app/bench/gen-inventory.mjs:22-23`, `app/bench/run-bench.mjs:68-84`, `app/bench/mip-spike.mjs` (wherever it reads `exports/scans` or `app/data/profiles.json` — grep), `app/bench/README.md`

**Interfaces:**
- Consumes: `resolveConfig()` from Task 2.
- Produces: `export const SCANS_DIR = resolveConfig().paths.scans` (so `VAULT_DATA=./local node app/bench/run-bench.mjs …` learns from the real scans); profiles from `resolveConfig().paths.profiles`.

- [ ] **Step 1: Replace the constants** in `gen-inventory.mjs`:

```js
import { resolveConfig } from "../config.mjs";
export const ROOT = dirname(dirname(HERE));
export const SCANS_DIR = resolveConfig().paths.scans;
```

In `run-bench.mjs` line 84: `readFileSync(resolveConfig().paths.profiles, "utf8")` (import `resolveConfig` at the top). Same in `mip-spike.mjs` for any `exports/` or `app/data/profiles.json` read.

- [ ] **Step 2: Verify** — `VAULT_DATA=$PWD/local node app/bench/run-bench.mjs --help` (or the smallest cell the README documents) runs without a path error. `grep -rn "exports" app/bench/*.mjs` returns nothing.

- [ ] **Step 3: Update `app/bench/README.md`** — the invocation examples carry `VAULT_DATA=./local`, and the sentence about `exports/scans` says "the data directory's `scans/`".

- [ ] **Step 4: Commit** — `git add app/bench && git commit -m "Point the bench harness at the data directory\n\nClaude-Session: https://claude.ai/code/session_012Jc4pEtTUy9dfd8sp6EbPb"`

---

### Task 4: Synthetic fixtures under fictional names, tests re-derived

**Files:**
- Create: `app/fixtures/demo-Kestrel.json`, `app/fixtures/demo-Dorran.json`, `app/fixtures/README.md`, `app/bench/make-fixtures.mjs`
- Delete: the two old fixtures named after real characters that this task replaces (not to be confused with the newly created `demo-Kestrel.json`/`demo-Dorran.json` above)
- Modify: `app/gear-vault.test.mjs:130-160` and `:217-233` (the fixture-based tests), and any other leftover reference to a real character's name in tests

**Interfaces:**
- Consumes: `learnModel(snapshots, lib)`, `generateScan(model, { n, gearFraction, seed, serialBase, scannedAt, lib })`, `readRealSnapshots(dir)` from `app/bench/gen-inventory.mjs`.
- Produces: two version-1 scan files whose `character` is `Kestrel` (Elf archer-like: `stats {str: 70, dex: 100, int: 40}`) and `Dorran` (Human melee: `stats {str: 110, dex: 60, int: 20}`), `position {x: 1, y: 1}`, `scannedAt` `2026-01-01T12:00:00`, 120 and 40 items, serials from `0x70000000`, generated with seeds 11 and 12. Every `Crafted By` line is replaced by `Crafted By Nobody`.

- [ ] **Step 1: Write `app/bench/make-fixtures.mjs`**

```js
// make-fixtures.mjs — regenerate app/fixtures/demo-*.json from the empirical model. Needs real scans in
// the data directory (VAULT_DATA=./local). Output is deterministic for a given seed.
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { learnModel, generateScan, readRealSnapshots, SCANS_DIR } from "./gen-inventory.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const lib = await import(pathToFileURL(join(HERE, "..", "vault-lib.mjs")).href);
const model = learnModel(readRealSnapshots(SCANS_DIR), lib);
const SPECS = [
  { character: "Kestrel", n: 120, seed: 11, stats: { str: 70, dex: 100, int: 40 } },
  { character: "Dorran", n: 40, seed: 12, stats: { str: 110, dex: 60, int: 20 } },
];
for (const s of SPECS) {
  const scan = generateScan(model, { n: s.n, gearFraction: 0.5, seed: s.seed, serialBase: 0x70000000 + s.seed * 0x10000, scannedAt: "2026-01-01T12:00:00", lib });
  scan.character = s.character; scan.stats = s.stats; scan.position = { x: 1, y: 1 };
  const scrub = (it) => { if (it.tooltip) it.tooltip = it.tooltip.map((l) => l.replace(/^Crafted By .*/i, "Crafted By Nobody")); };
  for (const it of scan.equipped || []) scrub(it);
  for (const r of scan.roots || []) for (const it of r.items || []) scrub(it);
  writeFileSync(join(HERE, "..", "fixtures", `demo-${s.character}.json`), JSON.stringify(scan, null, 1) + "\n");
  console.log(`${s.character}: ${s.n} items`);
}
```

If `generateScan` places items under a different key than `roots[].items` (read the function: lines 147-end), adapt the scrub loop to the actual shape — the scrub must touch every item's tooltip.

- [ ] **Step 2: Generate** — `VAULT_DATA=$PWD/local node app/bench/make-fixtures.mjs`, then `git rm -q` the two old fixtures named after real characters (not the `demo-Kestrel.json`/`demo-Dorran.json` that command just created). Check: `grep -c "Crafted By" app/fixtures/*.json` shows only "Nobody"; `grep -n '"character"' app/fixtures/*.json` shows Kestrel and Dorran; both files have an `equipped` array with at least 6 items and at least one root (adjust `gearFraction` upward if equipped is empty — the tests below need worn gear).

- [ ] **Step 3: Re-derive the fixture tests.** Replace the names at `app/gear-vault.test.mjs:130-131` with `demo-Kestrel.json` (→ `kestrel`) and `demo-Dorran.json` (→ `dorran`). Rewrite the item-specific assertions to structural ones that hold for any generated fixture:

```js
test("fold: worn gear is located on its wearer, pack items in the pack", ["smoke"], () => {
  const inv = foldSnapshots([dorran, kestrel]);
  const worn = Object.values(inv.items).filter((i) => i.equippedBy === "Dorran");
  assert.ok(worn.length >= 6, `Dorran wears ${worn.length}`);
  for (const i of worn) assert.equal(i.location.text, "Worn by Dorran");
  const packed = Object.values(inv.items).filter((i) => !i.equippedBy && i.root && inv.characters.Dorran.roots?.includes?.(i.root));
  for (const i of packed) assert.match(i.location.text, /^Dorran's /);
});
test("pools: another character's worn gear is skipped unless allowOthersWorn", ["smoke"], () => {
  const inv = foldSnapshots([dorran, kestrel]);
  const dorranWorn = Object.values(inv.items).filter((i) => i.equippedBy === "Dorran" && i.gear);
  const { pools, skipped } = buildPools(inv, "Kestrel", { strength: 30 });
  for (const it of dorranWorn) assert.ok(skipped.worn.some((s) => s.serial === it.serial), `${it.name} skipped`);
  const all = buildPools(inv, "Kestrel", { allowOthersWorn: true });
  const inAll = new Set(Object.values(all.pools).flat().map((i) => i.serial));
  assert.ok(dorranWorn.some((it) => inAll.has(it.serial)), "at least one of Dorran's pieces enters Kestrel's pools");
});
```

Read the existing tests at 130-160 and 217-233 first: keep every assertion that is already structural (counts of roots, tombstones, `excludeGargoyle` on a hand-built item), and delete only the ones naming a specific real item ("Katana", "gorget", a real character's "katana skipped" line). The `excludeGargoyle` test at 232-233 builds its own item `g` — keep it, swap the character names. The optimizer/parallel tests that use "the demo inventory" keep working unchanged as long as they only read `foldSnapshots([...fixtures])`.

- [ ] **Step 4: Run** `npm test` → PASS (full). If the exact/brute-force tests now fail on the new fixture, the cause is pool size (they were tuned to 97 items): reduce Kestrel's `n` to 80 rather than loosening the tests.

- [ ] **Step 5: Write `app/fixtures/README.md`**

```
# Fixtures

`demo-Kestrel.json` and `demo-Dorran.json` are synthetic scan files (schema version 1) generated by `app/bench/make-fixtures.mjs` from the empirical item model in `app/bench/gen-inventory.mjs`, seeds 11 and 12. The characters, serials, positions and "Crafted By" names are fictional. Regenerate with `VAULT_DATA=<dir with real scans> node app/bench/make-fixtures.mjs`; the tests assert structural facts, so a regeneration does not need test changes unless the model changes shape.
```

- [ ] **Step 6: Commit** — `git add -A app/fixtures app/bench/make-fixtures.mjs app/gear-vault.test.mjs && git commit -m "Replace the real-data fixtures with generated ones under fictional names\n\nClaude-Session: https://claude.ai/code/session_012Jc4pEtTUy9dfd8sp6EbPb"`

---

### Task 5: Contracts settled

**Files:**
- Modify: `app/vault-lib.mjs:412,418`, `app/runs-lib.mjs`, `app/gear-vault.html:703-707,772,807,897-905`, `app/vault-server.mjs:241` (`/api/inventory`), `:297` (bridge queue), `app/gear-vault.test.mjs` (settingsDiff / runs tests)
- Test: new cases in `app/gear-vault.test.mjs`

**Decisions (apply exactly):**
1. The option is `allowOthersWorn` everywhere. Saved runs written before this change carry `allowOthers`; `runs-lib.mjs` gains `export function normalizeRun(run)` that renames `run.settings.allowOthers` → `allowOthersWorn` (deleting the old key) and is applied in the server wherever runs are read from disk. `vault-lib.mjs:412` becomes `const others = (s) => !!s.allowOthersWorn;`. The page (`:897`, `:905`) writes `allowOthersWorn`.
2. Budgets are milliseconds in every stored/transmitted object: `budgetMs`. The page keeps a local seconds input but stores `budgetMs: 1000 * budgetS` in the run settings (`:898`) and `settingsDiff` (`vault-lib.mjs:418`) compares `budgetMs`, printing seconds: `` `budget ${(a.budgetMs ?? 0) / 1000} s → ${b.budgetMs / 1000} s` ``. `normalizeRun` converts an old `budgetS` to `budgetMs`.
3. Profiles and runs carry `schemaVersion: 1`. `migrateProfiles` sets it if missing; `runs-lib.mjs`'s run constructor sets it; `normalizeRun` sets it on old runs.
4. `/api/inventory` no longer returns `scansDir`; it returns `{ ok, snapshotCount, demo: CONFIG.demo, inventory }`. The page, if it displayed `scansDir`, shows "demo data" when `demo` is true and nothing otherwise (grep `scansDir` in the html).
5. Every timestamp the server writes to bridge or run files is `new Date().toISOString()` (RFC 3339 UTC). The Python bridge writes `"alive"` and result `"t"` as `time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())` — done in Task 7, not here; here the server reads both a number (legacy) and a string: `const aliveMs = typeof s.alive === "number" ? s.alive * 1000 : Date.parse(s.alive)`.
6. The `location` field on `/api/bridge` commands: the page sends the item's `location` object for the bridge to walk (`chain`, `pos`). Rename nothing; document it in the server header comment as `POST /api/bridge {action, serial, name, chain: [root…parent], pos|null}` and make the server copy exactly those four fields plus `id`/`queuedAt` into the queue line (drop any other key the page sends).
7. Vocabulary: the UI word is "container" (the fold marks `kind: "container"`); "bag" survives only inside regexes and the Python scanner's `kind: "bag"` — change the scanner (Task 7) to emit `kind: "container"` and make `vault-lib.mjs` accept both (`c.kind === "container" || c.kind === "bag"`) so old scans still fold.

- [ ] **Step 1: Write the failing tests** (append to `app/gear-vault.test.mjs`, tags `["fast"]`):

```js
test("runs: normalizeRun upgrades allowOthers/budgetS and stamps schemaVersion", ["fast"], () => {
  const r = normalizeRun({ id: "x", settings: { allowOthers: true, budgetS: 30 }, result: {} });
  assert.equal(r.schemaVersion, 1);
  assert.equal(r.settings.allowOthersWorn, true);
  assert.equal("allowOthers" in r.settings, false);
  assert.equal(r.settings.budgetMs, 30000);
  assert.equal("budgetS" in r.settings, false);
  assert.deepEqual(normalizeRun(r), r);   // idempotent
});
test("settingsDiff: budgets compare in ms and print seconds", ["fast"], () => {
  const d = settingsDiff({ budgetMs: 30000, exact: true }, { budgetMs: 60000, exact: true });
  assert.ok(d.some((l) => l === "budget 30 s → 60 s"), d.join("|"));
});
test("profiles: migrateProfiles stamps schemaVersion 1", ["fast"], () => {
  assert.equal(migrateProfiles({ characters: {}, templates: {} }).schemaVersion, 1);
});
```

Import `normalizeRun` from `./runs-lib.mjs` at the top of the test file. Run `npm test -- --fast` → FAIL (`normalizeRun` is not exported).

- [ ] **Step 2: Implement** decisions 1-7 in the files listed. `normalizeRun`:

```js
export function normalizeRun(run) {
  const s = { ...(run.settings || {}) };
  if ("allowOthers" in s) { s.allowOthersWorn = !!s.allowOthers; delete s.allowOthers; }
  if ("budgetS" in s) { s.budgetMs = 1000 * s.budgetS; delete s.budgetS; }
  return { ...run, schemaVersion: run.schemaVersion ?? 1, settings: s };
}
```

Apply it in `vault-server.mjs` where `runs` are read (the `readRuns`-style helper that parses `<runs>/*.json`; grep `RUNS`). Wherever the page reads `r.settings.allowOthers` or `budgetS` from a saved run, switch to the new keys.

- [ ] **Step 3: Run** `npm test` → PASS. Start the server against `local/` (`VAULT_DATA=$PWD/local node app/vault-server.mjs --port 8790`), open the Suit Builder in a browser, load a saved run from the drawer, confirm the settings show and a repeat works (the maintainer's real runs are in `local/runs`? — if `local/` has no `runs/`, copy the original private workspace's `app/data/runs` into `local/runs` first; read-only copy, the originals untouched).

- [ ] **Step 4: Commit** — `git add app && git commit -m "Settle option names, budgets in ms, schemaVersion on profiles and runs\n\nClaude-Session: https://claude.ai/code/session_012Jc4pEtTUy9dfd8sp6EbPb"`

---

### Task 6: Personal data and private references out of the tree

**Files:**
- Modify: `app/data/profiles.default.json` (`_comment`, ensure `characters: {}`), `app/vault-lib.mjs:7` (comment naming `suit-optimizer-claude.py`), `app/vault-server.mjs` header (the `exports/scans` mention), any comment matching the grep below
- Create: `CONTRIBUTING.md` (from `app/CLAUDE.md`)
- Delete: `app/CLAUDE.md`

- [ ] **Step 1: Find every reference**

Run: grep the tree (`--exclude-dir=.git --exclude-dir=local --exclude-dir=docs --exclude-dir=node_modules .`), case-insensitive, for "claude", the private workspace's name, the maintainer's name, "uoalive-item-caps", "exports/" and a stray `.nvm`.

- [ ] **Step 2: Fix each hit.** Rules: a comment citing a private document (`uoalive-item-caps.md`, `app/CLAUDE.md`, a planning file) is reworded to state the fact itself (e.g. "caps = hard ceilings (UO Alive item property caps: resists 70, HCI/DCI 45, SSI 60, DI 100, LMC 40)"); `suit-optimizer-claude.py` in `vault-lib.mjs:7` becomes "the property table the TazUO adapter scripts use in-game"; `_comment` in `profiles.default.json` becomes `"Default profile templates shipped with Pack Rat. Copied to <data>/profiles.json on first run; edit in the app. weights = value of one point; caps = hard ceilings; floors = must-have minimums."`. Verify `characters` is `{}` (the four templates stay).

- [ ] **Step 3: `CONTRIBUTING.md`** — move `app/CLAUDE.md`'s content (dev loop, data model, gotchas, optimizer notes, the bench section) to `CONTRIBUTING.md` at the root with a two-line intro ("How to work on Pack Rat. Start the bare server with `npm start -- --open`; tests with `npm test`."). Scrub: remove the "NEXT SESSION" section, every character-specific note about the maintainer's roster (their real characters' build tuning), every path under the original private workspace or `~/Desktop/TazUO` (say "your TazUO folder"), the `-claude` names. `git rm app/CLAUDE.md`.

- [ ] **Step 4: Re-run the grep** from Step 1 → only `docs/` hits remain (research docs are scrubbed in Phase 5). Run `npm test -- --fast` → PASS.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "Scrub private references and move the dev notes to CONTRIBUTING.md\n\nClaude-Session: https://claude.ai/code/session_012Jc4pEtTUy9dfd8sp6EbPb"`

---

### Task 7: TazUO adapter scripts renamed, path-configurable, temp-then-rename

**Files:**
- Rename: `adapters/tazuo/vault-scanner.py` → `packrat-scanner.py`, `vault-refresh-claude.py` → `packrat-refresh.py`, `vault-bridge.py` → `packrat-bridge.py` (`git mv`)
- Create: `adapters/tazuo/packrat-paths.example.json`, `adapters/tazuo/README.md`, `adapters/tazuo/test_paths.py`
- Modify: all three scripts (path resolution, output writes, `kind`, timestamps, header comments)

**Interfaces:**
- Produces: each script resolves its data directory with the same function:

```python
def data_dir():
    """<script folder>/packrat-paths.json {"dataDir": "..."} → $VAULT_DATA → ~/.pack-rat"""
    here = os.path.dirname(os.path.abspath(__file__))
    cfg = os.path.join(here, "packrat-paths.json")
    if os.path.exists(cfg):
        with open(cfg, "r", encoding="utf-8") as f:
            d = json.load(f).get("dataDir")
        if d:
            return os.path.expanduser(d)
    return os.path.expanduser(os.environ.get("VAULT_DATA") or "~/.pack-rat")
```

Scanner and refresh write `<dataDir>/scans/<Character>-<YYYYmmdd-HHMMSS>[-quick].json`; bridge uses `<dataDir>/bridge/tazuo/queue.jsonl` and `status.json` (matches `config.mjs`). Writes go through:

```python
def write_json_atomic(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, indent=1)
    os.replace(tmp, path)
```

- [ ] **Step 1: `git mv` the three files.**

- [ ] **Step 2: Write the offline test `adapters/tazuo/test_paths.py`** (plain Python, no API needed — it imports the helper by exec'ing only the `data_dir`/`write_json_atomic` source lines? No: keep it simple — put both helpers in a fourth file `adapters/tazuo/packrat_common.py`? **No** — TazUO's loader treats every `.py` in `LegionScripts/` as a script and the spec defers the shared module until `__name__` is known. So each script inlines the two helpers verbatim, and the test checks the inlined copies are identical and behave):

```python
import json, os, re, sys, tempfile, unittest
HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPTS = ["packrat-scanner.py", "packrat-refresh.py", "packrat-bridge.py"]

def helper_source(text, name):
    m = re.search(r"^def %s\(.*?(?=^def |^[A-Z_]+ = |\Z)" % name, text, re.S | re.M)
    return m.group(0) if m else None

class Paths(unittest.TestCase):
    def test_helpers_identical_and_present(self):
        srcs = {s: open(os.path.join(HERE, s), encoding="utf-8").read() for s in SCRIPTS}
        for name in ("data_dir", "write_json_atomic"):
            bodies = {s: helper_source(t, name) for s, t in srcs.items()}
            for s, b in bodies.items(): self.assertIsNotNone(b, "%s lacks %s" % (s, name))
            self.assertEqual(len(set(bodies.values())), 1, "%s differs between scripts" % name)
    def test_no_while_true_and_import_api_alone(self):
        for s in SCRIPTS:
            t = open(os.path.join(HERE, s), encoding="utf-8").read()
            self.assertIsNone(re.search(r"while\s*\(?\s*(true|1)\b", t, re.I), s)
            self.assertRegex(t, r"(?m)^import API$")
    def test_data_dir_resolution(self):
        t = open(os.path.join(HERE, SCRIPTS[0]), encoding="utf-8").read()
        ns = {"os": os, "json": json}
        exec(helper_source(t, "data_dir") + "\n" + helper_source(t, "write_json_atomic"), ns)
        with tempfile.TemporaryDirectory() as d:
            ns["__file__"] = os.path.join(d, "x.py")
            os.environ["VAULT_DATA"] = "/env/dir"
            self.assertEqual(ns["data_dir"](), "/env/dir")
            with open(os.path.join(d, "packrat-paths.json"), "w") as f: json.dump({"dataDir": "/cfg/dir"}, f)
            self.assertEqual(ns["data_dir"](), "/cfg/dir")
            p = os.path.join(d, "a", "b.json"); ns["write_json_atomic"](p, {"k": 1})
            self.assertEqual(json.load(open(p)), {"k": 1}); self.assertFalse(os.path.exists(p + ".tmp"))

if __name__ == "__main__": unittest.main()
```

Note the helpers must reference `__file__` at call time (they do), and `exec` is given `__file__` via the namespace. Run: `python3 adapters/tazuo/test_paths.py` → FAIL (helpers missing).

- [ ] **Step 3: Edit the three scripts.** In each: replace the `OUT_DIR = os.path.expanduser(...)` / `BRIDGE_DIR = …` constants (pointed at `exports/scans` under the original private workspace) with the two helpers (identical text in all three) and `OUT_DIR = os.path.join(data_dir(), "scans")` / `BRIDGE_DIR = os.path.join(data_dir(), "bridge", "tazuo")`; replace the final `json.dump(... open(path, "w") ...)` with `write_json_atomic(path, snap)`; the bridge's status write becomes `write_json_atomic(STATUS, {...})` with `"alive": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())` and result `"t"` the same format; the scanner's and refresher's `"kind": "bag"` becomes `"kind": "container"`; header comments: drop every path into the original private workspace (say "the data directory (`packrat-paths.json` beside this script, else `VAULT_DATA`, else `~/.pack-rat`)") and the `-claude` names; make sure `import API` stays on its own line and no comment contains the forbidden loop phrase.

- [ ] **Step 4: Run** `python3 adapters/tazuo/test_paths.py` → PASS; `python3 -m py_compile adapters/tazuo/packrat-*.py` → no output. Add the Python test to `scripts/test-runner.mjs` as one unit in `fast` and `full` modes: `spawnSync("python3", [join(ROOT, "adapters", "tazuo", "test_paths.py")])`, counted as one test named `adapters/tazuo/test_paths.py`, skipped (with a console note) when `python3` is not on PATH.

- [ ] **Step 5: Write `adapters/tazuo/packrat-paths.example.json`** — `{ "dataDir": "~/.pack-rat" }` — and `adapters/tazuo/README.md`: what each script does (scanner = full inventory of worn + backpack + every opened container; refresh = worn set, stats, skills and backpack only, seconds; bridge = executes highlight/grab/goto queued by the app, one at a time, attended), install = copy the three `.py` files into `<TazUO>/TazUO/LegionScripts/` and, if the app's data directory is not the default, a `packrat-paths.json` beside them (the wizard does this in Phase 4); what to press; the AFK rule sentence: "These scripts read what your character can see and move one item when you click. They never fight, farm or loop unattended."; limits (bank contents only while the bank box is open; a container's contents reach the client only after it is opened). Fold `vault-lib.mjs`'s `kind` acceptance (Task 5 decision 7) if not done yet.

- [ ] **Step 6: Commit** — `git add -A adapters scripts/test-runner.mjs app/vault-lib.mjs && git commit -m "Rename the TazUO scripts to packrat-* and make their paths configurable\n\nClaude-Session: https://claude.ai/code/session_012Jc4pEtTUy9dfd8sp6EbPb"`

---

### Task 8: Phase gate — constraints check, first-run import note, README stub

**Files:**
- Create: `README.md` (stub: name, tagline, one paragraph, "pre-release, not yet usable — see docs/superpowers/specs"), `CHANGELOG.md` (`## Unreleased` with the Phase 0 bullets)
- Modify: `.gitignore` (ensure `test_logs/`, `local/`, `node_modules/`, `app/data/profiles.json`, `app/data/runs/`, `app/bench/results/`, `.DS_Store`, `dist/`)

- [ ] **Step 1: Run the global-constraint greps** from the header: personal paths, `-claude`, forbidden loop phrase, `vault-*.py` in `adapters/`. All empty (except `docs/`).

- [ ] **Step 2: Cut-over rehearsal (spec §0, first half):** with `VAULT_DATA=$PWD/local`, start the server and confirm in the browser that every one of the maintainer's characters appears with the same item counts as the old app shows (the original private workspace untouched: compare by opening the old app read-only on its own port). Record the counts in the commit message body.

- [ ] **Step 3: Full suite** `npm test` → PASS; `cat test_logs/latest_summary.json` shows `failed: 0`.

- [ ] **Step 4: Commit and merge** — `git add -A && git commit -m "Add README and CHANGELOG stubs; close Phase 0\n\nClaude-Session: …"`, then `git switch main && git merge --ff-only phase-0-hygiene`.

---

## Self-review

- **Spec coverage (§12 Phase 0):** paths/config resolver (T2), data directory (T2), user data out (T6, `.gitignore` T8), fixtures regenerated (T4), contracts settled (T5), Node launcher (T2), test runner in Node (T1), `package.json`/license/`.gitignore` (T1, T8), adapter scripts renamed (T7). §8 items deferred by the spec to later phases: page split, core precompiled, `node:test`, CSP — Phase 1. `.gitattributes` exec bits (T1). Node floor 22.18 (T1).
- **Placeholders:** none; every step has code or an exact command. T4 Step 1 carries a conditional ("if `generateScan` places items under a different key") — acceptable because the executor is told to read lines 147-end and what invariant to keep.
- **Type consistency:** `resolveConfig(argv, env, home)` and `paths.{scans,profiles,defaultProfiles,runs,bridge,bridgeQueue,bridgeStatus,logs}` are used identically in T2, T3, T5. `normalizeRun` is defined in T5 and imported in T5's test only. Python helper names `data_dir`, `write_json_atomic` match between T7's interface block, script edits and test.
