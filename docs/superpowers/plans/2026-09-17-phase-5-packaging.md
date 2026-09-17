# Phase 5 — Packaging, CI and Public Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the working local app into something a stranger can download, install and trust — installers for the three desktop platforms built by CI, player-facing docs with no private data in them, and a public GitHub repository at `github.com/gunn4r/uo-pack-rat`.

**Architecture:** electron-builder packages the existing `electron/` shell plus `app/`, `adapters/` and the compiled core into per-platform installers, configured entirely through a `build` block in `package.json` (JSON, so the config is unit-testable with no YAML dependency). Two GitHub Actions workflows: one runs the existing test suite on macOS, Windows and Linux for every push; one builds and uploads installers to a draft Release on a version tag. A Playwright-driven Electron test joins the suite as the first real end-to-end check that the window renders and its tabs work. Everything the repository publishes gets scrubbed of the maintainer's paths, real character names and personal identity first, and a test keeps it that way.

**Tech Stack:** Node ≥ 22.18, Electron 44.4.1, electron-builder 26.15.3, playwright 1.63.0 (the library, driven from `node:test` — not the Playwright runner), GitHub Actions, `gh` CLI for the one-time repository creation.

**Spec:** `docs/superpowers/specs/2026-09-12-desktop-app-public-release-design.md` — §10 (packaging, signing, updates, CI), §11 (the finish-line list), §12 (phase table), §13 (decisions).

## Global Constraints

- **Unsigned builds.** No Apple Developer Program, no certificates, no notarization. CI sets `CSC_IDENTITY_AUTO_DISCOVERY=false`. The README documents each platform's unsigned-app warning and its workaround. Never add a signing step, a certificate secret, or a notarization call in this phase.
- **Repository:** `github.com/gunn4r/uo-pack-rat`, MIT, public at the end of this phase and not before. Nothing gets pushed to any remote until Task 7, which has an explicit human approval gate.
- **No screenshots this phase.** The README ships text-only; `RELEASING.md` carries the shot list as a pre-1.0 item.
- **Targets** (spec §10): macOS `dmg` + `zip`, x64 and arm64 as separate artifacts (never `universal`); Windows `nsis` + `portable`; Linux `AppImage`. `asar` on, with `app/**` and `adapters/**` unpacked.
- **Runtime dependencies stay at exactly one:** `highs` 1.15.3. Everything added in this phase is a `devDependency`, pinned to an exact version (no `^`, no `~`).
- **Node floor stays `>=22.18`** (`package.json` `engines`). CI uses Node 22.
- **Never commit** `local/`, `app/dist/`, `test_logs/`, `.superpowers/`, `dist/`, `node_modules/`.
- **Never commit on `main`.** Work happens on the branch `phase-5-packaging`; the merge is the user's decision.
- **Commit messages** are imperative mood, bodies never hard-wrapped, and end with the line `Claude-Session: https://claude.ai/code/session_012Jc4pEtTUy9dfd8sp6EbPb`. Never a `Co-Authored-By` line.
- **Prose is never hard-wrapped** — one paragraph is one line, in every Markdown file this phase writes or edits.
- **Python adapter rules** (unchanged): no literal `while True` anywhere in a `.py` file, comments included; `import API` alone on its own line; never `API.Msg`.
- **Every new test carries a tag** (`[smoke]`, `[fast]`, `[slow]`) per `TESTING.md`. Untagged tests only run in full mode.
- **Results come from `test_logs/latest_summary.json`**, never from parsing console output.
- **Never touch anything outside the repository** — not the original private workspace, not `~/Desktop/TazUO` (the user's live game scripts), not `~/.pack-rat` (the user's real data), not `~/.claude`.

---

## File Structure

**Created:**

- `.github/workflows/ci.yml` — the three-OS test matrix plus the Python compile check, on push and pull request.
- `.github/workflows/release.yml` — on a `v*` tag, builds installers on all three platforms and uploads them to a draft Release.
- `.github/ISSUE_TEMPLATE/bug_report.yml`, `.github/ISSUE_TEMPLATE/feature_request.yml`, `.github/ISSUE_TEMPLATE/config.yml`, `.github/PULL_REQUEST_TEMPLATE.md` — issue and PR intake.
- `build/README.md` — what belongs in the electron-builder resources folder, and the fact that a real application icon is still missing.
- `scripts/packaging.test.mjs` — unit tests over the `build` block in `package.json` and over the two workflow files.
- `scripts/ui-smoke.test.mjs` — the Playwright Electron end-to-end test.
- `scripts/scrub.test.mjs` — the permanent guard that no tracked file carries a private path, the maintainer's identity, a real character name, or the retired product name.
- `PRIVACY.md` — what the app stores, what it sends (almost nothing), what it never does.
- `SECURITY.md` — how to report a vulnerability, and the local-server threat model.
- `CODE_OF_CONDUCT.md` — short, project-specific conduct rules.
- `RELEASING.md` — the release checklist, including the pre-1.0 blockers (icon, screenshots).

**Modified:**

- `package.json` — `build` block, `repository`/`author`/`homepage`/`bugs` fields, `dist` and `predist` scripts, the `electron-builder` and `playwright` devDependencies.
- `app/config.mjs`, `app/mip-solve.mjs`, `electron/main.mjs`, `electron/server-entry.mjs`, `scripts/start.mjs`, `adapters/tazuo/packrat-*.py` and their tests — the legacy `VAULT_*` and `QM_*` environment-variable names become `PACKRAT_*`.
- `README.md` — rewritten for a player rather than a developer.
- `CONTRIBUTING.md`, `TESTING.md`, `CHANGELOG.md`, `docs/architecture.md`, `docs/adapter-guide.md` — the new env-var names, the new test files, the release process, the repository URL.
- `docs/research/*.md`, `docs/superpowers/plans/*.md`, `docs/superpowers/specs/*.md`, `docs/bridge-protocol.md`, `app/bench/REPORT.md`, `adapters/tazuo/README.md` — scrubbed.
- `.gitignore` — the electron-builder output folder if not already covered.

---

## Task 1: Retire the legacy environment-variable names

The `VAULT_*` names are left over from the Gear Vault era and `QM_FORCE_NO_HIGHS` carries the retired product's initials. They are part of the public interface (documented in the README, `TESTING.md`, and the adapter scripts), so they get fixed before anyone downloads anything. There is no back-compatibility shim: nothing has shipped yet.

**Files:**
- Modify: `app/config.mjs`, `app/mip-solve.mjs`, `scripts/start.mjs`, `electron/main.mjs`, `electron/server-entry.mjs`, `adapters/tazuo/packrat-scanner.py`, `adapters/tazuo/packrat-refresh.py`, `adapters/tazuo/packrat-bridge.py`, `README.md`, `TESTING.md`, `CONTRIBUTING.md`, `docs/architecture.md`, `docs/adapter-guide.md`
- Test: `app/config.test.mjs`, `app/mip.test.mjs`, `adapters/tazuo/test_paths.py`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: the environment-variable names every later task documents and every workflow may set — `PACKRAT_DATA` (data directory), `PACKRAT_PORT`, `PACKRAT_TOKEN`, `PACKRAT_CORE`, `PACKRAT_NO_HIGHS` (the test hook that forces the HiGHS load to fail). `TEST_SKIP_SLOW` and `TEST_SKIP_ELECTRON` keep their names — they are test-harness switches, not product interface.

- [ ] **Step 1: Find every occurrence**

```bash
cd ~/r/pack-rat && git checkout -b phase-5-packaging
git grep -n -E 'VAULT_(DATA|DATA_DIR|PORT|TOKEN|CORE)|QM_FORCE_NO_HIGHS'
```

Expected: hits across `app/`, `electron/`, `scripts/`, `adapters/tazuo/`, and the Markdown docs. Read the list before changing anything — `VAULT_DATA_DIR` and `VAULT_DATA` are different variables and must not be collapsed into one.

- [ ] **Step 2: Update the tests first**

In `app/config.test.mjs`, replace every `VAULT_DATA`, `VAULT_PORT` and `VAULT_TOKEN` string with its `PACKRAT_` equivalent. In `app/mip.test.mjs`, the `[fast] loadHighs rejects under QM_FORCE_NO_HIGHS` test becomes:

```js
test("[fast] loadHighs rejects under PACKRAT_NO_HIGHS", async () => {
  // …existing setup…
  process.env.PACKRAT_NO_HIGHS = "1";
  await assert.rejects(() => loadHighs(), /HiGHS disabled by PACKRAT_NO_HIGHS/);
  delete process.env.PACKRAT_NO_HIGHS;
});
```

In `adapters/tazuo/test_paths.py`, replace `VAULT_DATA` with `PACKRAT_DATA` in every place it appears (the environment it sets and any message it asserts).

- [ ] **Step 3: Run the tests to watch them fail**

```bash
npm run test:fast
python3 -W error adapters/tazuo/test_paths.py
```

Expected: FAIL. `app/config.test.mjs` cases fail because `resolveConfig` still reads the old names; the HiGHS case fails on the error-message pattern; the Python test fails on the resolver.

- [ ] **Step 4: Rename in the source**

Apply the mapping — `VAULT_DATA`→`PACKRAT_DATA`, `VAULT_PORT`→`PACKRAT_PORT`, `VAULT_TOKEN`→`PACKRAT_TOKEN`, `VAULT_CORE`→`PACKRAT_CORE`, `QM_FORCE_NO_HIGHS`→`PACKRAT_NO_HIGHS` — in `app/config.mjs`, `app/mip-solve.mjs` (both the `process.env` read and the thrown message), `scripts/start.mjs`, `electron/main.mjs`, `electron/server-entry.mjs` and the three Python adapters. Keep comments truthful: `app/mip-solve.mjs`'s comment still explains that the variable is read on every call, never memoised.

- [ ] **Step 5: Run the full suite**

```bash
npm test
python3 -c "import json;d=json.load(open('test_logs/latest_summary.json'));print(d['mode'],d['passed'],'/',d['total'],'failed',d['failed'])"
```

Expected: full mode, 0 failed. If the Electron smoke test fails, the shell is passing a renamed variable to the forked server under its old name — fix the pair, do not rename only one side.

- [ ] **Step 6: Update the docs**

`README.md`'s data-directory paragraph, `TESTING.md` (the `PACKRAT_NO_HIGHS` mentions in the `app/mip.test.mjs` and `app/solver.test.mjs` descriptions), `CONTRIBUTING.md`, `docs/architecture.md` and `docs/adapter-guide.md`. Search again to prove none is left:

```bash
git grep -n -E 'VAULT_|QM_FORCE_NO_HIGHS'
```

Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -F - <<'EOF'
Rename the legacy VAULT_ and QM_ environment variables to PACKRAT_

These are public interface — documented in the README and read by the adapter scripts — so they lose the retired product names before anyone downloads a build. No compatibility shim: nothing has shipped yet.

Claude-Session: https://claude.ai/code/session_012Jc4pEtTUy9dfd8sp6EbPb
EOF
```

---

## Task 2: electron-builder configuration and a packaged build

**Files:**
- Modify: `package.json`, `.gitignore`
- Create: `build/README.md`, `scripts/packaging.test.mjs`

**Interfaces:**
- Consumes: the `PACKRAT_*` names from Task 1 (the packaged app must not reference an old one).
- Produces: `npm run dist` (installers for the host platform, never published) and `npm run dist:dir` (an unpacked app directory, fast, for verification); the `build` block in `package.json` that Task 4's release workflow invokes; `package.json`'s `repository` field, which `app/installer.mjs`'s `repoFromPackage` already reads for the manual update check.

- [ ] **Step 1: Install the packager**

```bash
npm install --save-exact --save-dev electron-builder@26.15.3
```

Expected: `devDependencies` gains `"electron-builder": "26.15.3"` with no caret.

- [ ] **Step 2: Write the failing config test**

Create `scripts/packaging.test.mjs`:

```js
// packaging.test.mjs — the electron-builder config is product interface: which files reach a
// player's machine, under which target, with which identifiers. It lives in package.json (JSON,
// so it needs no YAML parser to check) and these tests are what keep it honest.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const build = pkg.build ?? {};

test("[fast] package metadata carries the public identity", () => {
  assert.equal(pkg.name, "pack-rat");
  assert.equal(pkg.productName, "Pack Rat");
  assert.equal(pkg.license, "MIT");
  assert.match(pkg.repository?.url ?? "", /github\.com\/gunn4r\/uo-pack-rat/);
  assert.equal(build.appId, "com.gunn4r.packrat");
});

test("[fast] every platform ships the targets the spec settled on", () => {
  assert.deepEqual(build.mac?.target?.map((t) => t.target).sort(), ["dmg", "zip"]);
  for (const t of build.mac.target) assert.deepEqual(t.arch, ["x64", "arm64"]);
  assert.deepEqual(build.win?.target?.map((t) => t.target).sort(), ["nsis", "portable"]);
  assert.deepEqual(build.linux?.target, ["AppImage"]);
});

test("[fast] the bundle carries the adapters and the built core, not the tests or the user's data", () => {
  const files = build.files ?? [];
  const has = (p) => files.includes(p);
  assert.ok(has("app/**"), "app/ must ship");
  assert.ok(has("adapters/**"), "adapters/ must ship — the installer copies the scripts out of it");
  assert.ok(has("electron/**"), "the shell itself must ship");
  for (const excluded of ["!**/*.test.mjs", "!local/**", "!test_logs/**", "!docs/**", "!app/bench/**"]) {
    assert.ok(files.includes(excluded), `${excluded} must be excluded`);
  }
});

test("[fast] worker-thread and adapter files are unpacked from the asar", () => {
  const unpacked = build.asarUnpack ?? [];
  assert.ok(unpacked.includes("app/**"), "worker threads under asar are undocumented — unpack app/");
  assert.ok(unpacked.includes("adapters/**"), "the installer copies .py files out to the game client");
  assert.ok(unpacked.includes("node_modules/highs/**"), "the solver's wasm is loaded from disk");
});

test("[fast] the release build never tries to sign", () => {
  assert.equal(build.mac?.identity, null, "identity null keeps an unsigned mac build from failing");
});
```

- [ ] **Step 3: Run it and watch it fail**

```bash
node --test scripts/packaging.test.mjs
```

Expected: FAIL — `package.json` has no `build` block and no `repository` field yet.

- [ ] **Step 4: Add the metadata and the build block to `package.json`**

Add next to the existing top-level fields:

```json
  "repository": { "type": "git", "url": "https://github.com/gunn4r/uo-pack-rat.git" },
  "homepage": "https://github.com/gunn4r/uo-pack-rat",
  "bugs": { "url": "https://github.com/gunn4r/uo-pack-rat/issues" },
  "author": "gunn4r",
```

Add these scripts to the existing `scripts` block:

```json
    "predist": "node scripts/build-core.mjs",
    "dist": "electron-builder --publish never",
    "dist:dir": "electron-builder --dir --publish never",
```

And the build block itself:

```json
  "build": {
    "appId": "com.gunn4r.packrat",
    "productName": "Pack Rat",
    "copyright": "Copyright © 2026 Pack Rat contributors",
    "directories": { "output": "dist", "buildResources": "build" },
    "files": [
      "app/**",
      "adapters/**",
      "electron/**",
      "scripts/optimizer-core.ts",
      "package.json",
      "!**/*.test.mjs",
      "!local/**",
      "!test_logs/**",
      "!docs/**",
      "!app/bench/**",
      "!**/__pycache__/**"
    ],
    "asar": true,
    "asarUnpack": ["app/**", "adapters/**", "node_modules/highs/**"],
    "mac": {
      "category": "public.app-category.utilities",
      "identity": null,
      "target": [
        { "target": "dmg", "arch": ["x64", "arm64"] },
        { "target": "zip", "arch": ["x64", "arm64"] }
      ]
    },
    "win": {
      "target": [
        { "target": "nsis", "arch": ["x64"] },
        { "target": "portable", "arch": ["x64"] }
      ]
    },
    "nsis": { "oneClick": false, "allowToChangeInstallationDirectory": true, "perMachine": false },
    "linux": { "category": "Utility", "target": ["AppImage"] },
    "artifactName": "${productName}-${version}-${os}-${arch}.${ext}"
  }
```

Note `"private": true` stays — it stops an accidental `npm publish`; electron-builder does not care.

- [ ] **Step 5: Run the config test to verify it passes**

```bash
node --test scripts/packaging.test.mjs
```

Expected: PASS, 5 tests.

- [ ] **Step 6: Actually package the app and inspect what came out**

```bash
npm run dist:dir
ls dist
```

Expected: a `dist/mac-arm64/Pack Rat.app` (or the host platform's equivalent). Then prove the two files the app needs at runtime are really inside the bundle and reachable outside the asar:

```bash
find "dist/mac-arm64/Pack Rat.app" -path '*app.asar.unpacked/adapters/tazuo/packrat-scanner.py'
find "dist/mac-arm64/Pack Rat.app" -path '*app.asar.unpacked/app/dist/*' | head -3
```

Expected: both print a path. If `app/dist` is missing, `predist` did not run — check that `npm run dist:dir` triggered `predist` (npm runs `pre<script>` for any script, including this one).

- [ ] **Step 7: Launch the packaged app's own smoke mode**

```bash
"dist/mac-arm64/Pack Rat.app/Contents/MacOS/Pack Rat" --smoke --demo --data "$(mktemp -d)"; echo "exit: $?"
```

Expected: `SMOKE OK <port>` in the output and exit 0. This is the first proof that the packaged app — not just the dev tree — boots, forks its server and serves the page. On Windows or Linux, run the equivalent binary under `dist/`.

- [ ] **Step 8: Add the build resources folder and clean up**

Create `build/README.md`:

```markdown
# Build resources

electron-builder reads this folder (`directories.buildResources`) for packaging inputs.

**Missing: an application icon.** Drop `icon.png` here — one square PNG, 1024×1024, and electron-builder generates the `.icns` and `.ico` variants itself. Until then every build carries the default Electron icon, which is fine for a pre-release but is a blocker for 1.0 (see `RELEASING.md`).
```

Confirm `dist/` is ignored (`.gitignore` already lists it), then remove the build output so nothing large lingers:

```bash
rm -rf dist
git status --short
```

Expected: only `package.json`, `package-lock.json`, `build/README.md` and `scripts/packaging.test.mjs` show as changes.

- [ ] **Step 9: Run the full suite and commit**

```bash
npm test
python3 -c "import json;d=json.load(open('test_logs/latest_summary.json'));print(d['passed'],'/',d['total'],'failed',d['failed'])"
git add -A
git commit -F - <<'EOF'
Package the app with electron-builder

Targets per the spec: mac dmg and zip in both architectures, Windows nsis and portable, Linux AppImage. The config lives in package.json rather than a YAML file so the invariants that matter — which files ship, what stays unpacked from the asar, that no build tries to sign — are unit-testable with no new dependency. Verified by packaging the app and running the packaged binary's own --smoke mode.

Claude-Session: https://claude.ai/code/session_012Jc4pEtTUy9dfd8sp6EbPb
EOF
```

---

## Task 3: A Playwright end-to-end test of the real window

The existing `scripts/shell-smoke.test.mjs` proves the app boots and serves its page. Nothing yet proves the page *renders* — that the tabs switch, that the inventory table fills from the demo fixtures, that no script error fires on load. Playwright's Electron support drives the real window, so this is the first test that would catch a broken UI bundle.

**Files:**
- Create: `scripts/ui-smoke.test.mjs`
- Modify: `package.json`, `TESTING.md`, `electron/README.md`

**Interfaces:**
- Consumes: the Electron entry point `electron/main.mjs` and its `--demo`/`--data` flags, exactly as `scripts/shell-smoke.test.mjs` uses them.
- Produces: nothing other tasks import. Task 4's CI workflow runs it under `xvfb-run` on Linux.

- [ ] **Step 1: Install Playwright**

```bash
npm install --save-exact --save-dev playwright@1.63.0
```

Expected: `devDependencies` gains `"playwright": "1.63.0"`. Note: no `npx playwright install` — Electron automation drives the app's own binary and needs no downloaded browsers.

- [ ] **Step 2: Write the failing test**

Create `scripts/ui-smoke.test.mjs`:

```js
// ui-smoke.test.mjs — [slow]: drives the real Electron window with Playwright. The shell smoke test
// proves the app boots and serves; this one proves the page renders and its tabs work. Skipped when
// electron or playwright is absent (a plain clone), or under TEST_SKIP_ELECTRON.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const require_ = createRequire(import.meta.url);
function unavailable() {
  if (process.env.TEST_SKIP_ELECTRON) return "TEST_SKIP_ELECTRON is set";
  for (const dep of ["electron", "playwright"]) {
    try { require_.resolve(dep); } catch { return `${dep} is not installed`; }
  }
  return null;
}

test("[slow] the packaged UI renders, switches tabs and lists the demo inventory", async (t) => {
  const why = unavailable();
  if (why) return t.skip(why);

  const { _electron } = await import("playwright");
  const dataDir = mkdtempSync(join(tmpdir(), "packrat-ui-"));
  const app = await _electron.launch({ args: [".", "--demo", "--data", dataDir] });
  try {
    const page = await app.firstWindow();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));

    assert.equal(await page.title(), "Pack Rat");
    await page.waitForSelector("#status", { timeout: 30_000 });

    // The inventory tab is the default: the demo fixtures must produce rows, not the empty state.
    const rows = page.locator('[data-tab-panel="inventory"] tbody tr');
    await rows.first().waitFor({ timeout: 30_000 });
    assert.ok(await rows.count() > 0, "demo fixtures should fill the inventory table");

    // Switching tabs is the one interaction every session starts with.
    await page.click('[role="tab"][data-tab="characters"]');
    await page.waitForSelector('[data-tab-panel="characters"]:not([hidden])', { timeout: 10_000 });

    assert.deepEqual(errors, [], "no uncaught page errors during load and tab switch");
  } finally {
    await app.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});
```

Selectors are a guess at the real markup: before running, open `app/index.html` and `app/ui/*.mjs` and correct `[data-tab-panel="…"]`, the tab button attribute and the table selector to what the page actually renders. Do not change the page to fit the test.

- [ ] **Step 3: Run it and watch it fail or pass honestly**

```bash
node --test scripts/ui-smoke.test.mjs
```

Expected on the first run: FAIL on a selector that does not exist. Fix the selectors (Step 2's note), not the application, until it passes. If it passes on the very first run, confirm the test can fail: temporarily change the expected title to `"Not Pack Rat"`, re-run, see FAIL, change it back.

- [ ] **Step 4: Prove the skip path works**

```bash
TEST_SKIP_ELECTRON=1 node --test scripts/ui-smoke.test.mjs
```

Expected: the test reports as skipped, not failed — this is what a CI box or a contributor without Electron sees.

- [ ] **Step 5: Document it**

`TESTING.md`: add `scripts/ui-smoke.test.mjs` to the "What is under test" list beside `scripts/shell-smoke.test.mjs`, describing it as the Playwright-driven render check, `[slow]`, skipped under the same conditions. In `electron/README.md`, the "What's not exercised by the automated smoke test" section loses whatever this test now covers (page render, tab switching) and keeps the rest (the native folder dialog, Finder integration, a clean `Cmd+Q`).

- [ ] **Step 6: Run the full suite and commit**

```bash
npm test
python3 -c "import json;d=json.load(open('test_logs/latest_summary.json'));print(d['passed'],'/',d['total'],'failed',d['failed'],'skipped',d['skipped'])"
git add -A
git commit -F - <<'EOF'
Add a Playwright end-to-end test of the Electron window

The shell smoke test proves the app boots and serves its page; this drives the real window and proves the page renders, the demo inventory fills the table, tabs switch, and nothing throws on load. Skipped when electron or playwright is missing, or under TEST_SKIP_ELECTRON, like the shell smoke test.

Claude-Session: https://claude.ai/code/session_012Jc4pEtTUy9dfd8sp6EbPb
EOF
```

---

## Task 4: GitHub Actions — the test matrix and the release build

**Files:**
- Create: `.github/workflows/ci.yml`, `.github/workflows/release.yml`
- Modify: `scripts/packaging.test.mjs`, `TESTING.md`

**Interfaces:**
- Consumes: `npm test` and `npm run dist` from Tasks 1–3, and the `build` block from Task 2.
- Produces: the two workflow files Task 7 watches run for real on the first push.

- [ ] **Step 1: Write the failing workflow tests**

Append to `scripts/packaging.test.mjs`:

```js
const workflow = (name) => readFileSync(join(root, ".github/workflows", name), "utf8");

test("[fast] CI runs the suite on all three desktop platforms", () => {
  const ci = workflow("ci.yml");
  for (const os of ["macos-latest", "windows-latest", "ubuntu-latest"]) assert.match(ci, new RegExp(os));
  assert.match(ci, /node-version: *["']?22/, "Node 22 matches the engines floor");
  assert.match(ci, /xvfb-run/, "Linux needs a virtual display to launch Electron");
  assert.match(ci, /py_compile/, "the Python adapters get compiled in the same run");
  assert.doesNotMatch(ci, /TEST_SKIP_ELECTRON/, "CI must not skip the shell tests");
});

test("[fast] the release workflow builds unsigned, on a tag, into a draft release", () => {
  const rel = workflow("release.yml");
  assert.match(rel, /tags:\s*\n\s*- *['"]?v\*/, "triggered by a v* tag");
  assert.match(rel, /CSC_IDENTITY_AUTO_DISCOVERY: *["']?false/, "no signing this phase");
  assert.match(rel, /--publish always/);
  assert.doesNotMatch(rel, /APPLE_ID|CSC_LINK|notarize/i, "no signing or notarization secrets");
});
```

- [ ] **Step 2: Run them and watch them fail**

```bash
node --test scripts/packaging.test.mjs
```

Expected: FAIL — the workflow files do not exist (`ENOENT`).

- [ ] **Step 3: Write `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  push:
    branches: ["**"]
  pull_request:

jobs:
  test:
    name: Test on ${{ matrix.os }}
    runs-on: ${{ matrix.os }}
    strategy:
      fail-fast: false
      matrix:
        os: [macos-latest, windows-latest, ubuntu-latest]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: npm
      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"
      - run: npm ci
      - name: Compile the adapter scripts
        run: python -m py_compile adapters/tazuo/packrat-scanner.py adapters/tazuo/packrat-refresh.py adapters/tazuo/packrat-bridge.py
      - name: Test (Linux, virtual display for Electron)
        if: runner.os == 'Linux'
        run: xvfb-run -a npm test
      - name: Test
        if: runner.os != 'Linux'
        run: npm test
      - name: Upload the test summary
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: test-summary-${{ matrix.os }}
          path: test_logs/latest_summary.json
          if-no-files-found: warn
```

- [ ] **Step 4: Write `.github/workflows/release.yml`**

```yaml
name: Release

on:
  push:
    tags:
      - "v*"

permissions:
  contents: write

jobs:
  build:
    name: Build on ${{ matrix.os }}
    runs-on: ${{ matrix.os }}
    strategy:
      fail-fast: false
      matrix:
        os: [macos-latest, windows-latest, ubuntu-latest]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: npm
      - run: npm ci
      - name: Build and upload to the draft release
        run: npm run dist -- --publish always
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          CSC_IDENTITY_AUTO_DISCOVERY: "false"
```

Builds are unsigned by decision (spec §10): macOS downloads will show the "damaged" dialog and Windows will show SmartScreen. `README.md` documents both workarounds in Task 6.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
node --test scripts/packaging.test.mjs
```

Expected: PASS, 7 tests.

- [ ] **Step 6: Check the YAML actually parses**

```bash
python3 -c "import yaml,sys;[yaml.safe_load(open(f)) for f in ['.github/workflows/ci.yml','.github/workflows/release.yml']];print('both parse')"
```

Expected: `both parse`. If PyYAML is missing, install it into a temp venv or skip this step and rely on the first real CI run in Task 7 — note which you did in the commit body.

- [ ] **Step 7: Commit**

```bash
npm test
git add -A
git commit -F - <<'EOF'
Add CI and release workflows

CI runs the full suite on macOS, Windows and Linux for every push, with xvfb on Linux so the Electron tests run rather than skip, and compiles the Python adapters in the same job. The release workflow builds unsigned installers on all three platforms for a v* tag and uploads them to a draft release. Signing stays out per the spec's v1 decision.

Claude-Session: https://claude.ai/code/session_012Jc4pEtTUy9dfd8sp6EbPb
EOF
```

---

## Task 5: Scrub private data, and keep it scrubbed

Everything in the repository becomes world-readable in Task 7, including the historical planning documents. They currently carry the maintainer's home paths, personal name, the private workspace path and real in-game character names.

**The scrub policy** (apply exactly):

| Pattern | Becomes |
|---|---|
| The maintainer's given name and surname, and the maintainer's account handle, in prose | "the maintainer" (or "the author" where it reads better) — except `package.json`'s `author` field and repository URLs, which are deliberately public |
| A real home path (`/Users/<the maintainer's name>…`) | `/Users/example` in code and tests, `~/…` in prose |
| The private workspace's directory name | "the original private workspace" |
| The four real in-game character names | The fixture names already used by the test suite: `Dorran` and `Kestrel`, adding `Rowan` and `Sable` if more are needed. Keep a stable mapping across every file so the bench report still reads coherently |
| `Divine Fury`, `Consecrate` and other spell or game-term names | Leave alone — these are game vocabulary, not the user's characters |

**Files:**
- Create: `scripts/scrub.test.mjs`
- Modify: `docs/research/2026-09-12-electron-packaging.md`, `docs/research/2026-09-12-public-release-audit.md`, `docs/research/2026-09-12-uo-client-ecosystem.md`, `docs/superpowers/plans/2026-09-13-phase-0-repo-hygiene.md`, `docs/superpowers/plans/2026-09-14-phase-2-contracts.md`, `docs/superpowers/specs/2026-09-12-desktop-app-public-release-design.md`, `docs/bridge-protocol.md`, `adapters/tazuo/README.md`, `app/bench/REPORT.md`, `app/installer.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: `scripts/scrub.test.mjs`, a `[smoke]` test every later commit must keep green.

- [ ] **Step 1: Write the guard test first**

Create `scripts/scrub.test.mjs`:

```js
// scrub.test.mjs — this repository is public. Nothing tracked in it may carry the maintainer's
// identity or machine, the private workspace it grew out of, real in-game character names, or the
// retired product name. The allowances below are deliberate and each one says why.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const TEXT = /\.(mjs|js|ts|py|json|md|yml|yaml|html|css|sh|txt)$/;

// [pattern, why it is banned, paths allowed to contain it]
const BANNED = [
  [/* the maintainer's given name or surname, case-insensitive */ null, "the maintainer's name or machine", []],
  [/* the maintainer's account handle, case-insensitive */ null, "the maintainer's account — only the repository URL may carry it",
    ["package.json", "package-lock.json", "README.md", "CONTRIBUTING.md", "SECURITY.md", "RELEASING.md",
     ".github/ISSUE_TEMPLATE/config.yml", "scripts/packaging.test.mjs", "scripts/scrub.test.mjs"]],
  [/* the private workspace's directory name, case-insensitive */ null, "the private workspace path", ["scripts/scrub.test.mjs"]],
  [/\/Users\/(?!example)[a-z0-9._-]+/i, "a real home directory", ["scripts/scrub.test.mjs"]],
  [/* three of the four real character names, whole-word */ null, "a real character name", ["scripts/scrub.test.mjs"]],
  [/* the retired product name, case-insensitive */ null, "the retired product name", ["scripts/scrub.test.mjs"]],
];

const tracked = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" })
  .split("\n").filter((f) => f && TEXT.test(f));

test("[smoke] no tracked file carries private data or a retired name", () => {
  const found = [];
  for (const file of tracked) {
    const body = readFileSync(join(root, file), "utf8");
    for (const [pattern, why, allowed] of BANNED) {
      if (allowed.includes(file)) continue;
      const hit = body.match(pattern);
      if (hit) found.push(`${file}: ${why} — "${hit[0]}"`);
    }
  }
  assert.deepEqual(found, [], `private data in tracked files:\n${found.join("\n")}`);
});

test("[smoke] the guard actually sees tracked files", () => {
  assert.ok(tracked.length > 40, `expected the repo's files, got ${tracked.length}`);
});
```
(The real `scripts/scrub.test.mjs` — the one file allowed to hold the literal patterns — spells each of these out; see that file rather than this sketch.)

One of the four real character names is deliberately absent from the banned list — it collides with a Chivalry spell name ("Divine Fury") that appears in legitimate documentation. Handle that one name by hand in Step 3 and check it manually in Step 4.

- [ ] **Step 2: Run it and read the failures**

```bash
node --test scripts/scrub.test.mjs
```

Expected: FAIL, listing every file and the pattern it matched. That list is the work order for Step 3.

- [ ] **Step 3: Scrub, file by file**

Work through the failure list applying the policy table. Notes for the tricky ones:

- `app/bench/REPORT.md` — the three benchmark sections are named after real characters. Rename them consistently (`Dorran` for the melee template, `Kestrel` for the caster, `Rowan` for the archer) and keep every number and locked-weapon description exactly as measured. Do not re-run the benchmark.
- `docs/bridge-protocol.md` — the example payload's `"character"` field, set to the melee character's real name, becomes `"Dorran"`.
- `app/installer.test.mjs` — `const home = "/Users/<the maintainer's name>"` becomes `const home = "/Users/example"`.
- The spec and the phase plans are historical records: scrub the identifying words in place, keep the decisions and dates as written, and never rewrite what a phase actually did.
- Prose stays unwrapped; change words, not line structure.

- [ ] **Step 4: Check the one pattern the guard cannot judge**

```bash
git grep -n '\b<that character\'s real name>\b' | grep -v -i 'divine fury'
```

Expected: no output. Anything printed is a real character name that Step 3 missed.

- [ ] **Step 5: Run the guard and the full suite**

```bash
node --test scripts/scrub.test.mjs
npm test
python3 -c "import json;d=json.load(open('test_logs/latest_summary.json'));print(d['passed'],'/',d['total'],'failed',d['failed'])"
```

Expected: the guard passes; the full suite passes with 0 failures.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -F - <<'EOF'
Scrub private data from the repository and add a guard test

Every tracked file is about to become world-readable, including the historical plans and research notes. Home paths, the maintainer's name, the private workspace path and real in-game character names are gone; the character names now match the synthetic fixtures the tests already use. The new [smoke] guard fails the suite if any of them comes back.

Claude-Session: https://claude.ai/code/session_012Jc4pEtTUy9dfd8sp6EbPb
EOF
```

---

## Task 6: The documents a stranger reads first

**Files:**
- Create: `PRIVACY.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, `RELEASING.md`, `.github/ISSUE_TEMPLATE/bug_report.yml`, `.github/ISSUE_TEMPLATE/feature_request.yml`, `.github/ISSUE_TEMPLATE/config.yml`, `.github/PULL_REQUEST_TEMPLATE.md`
- Modify: `README.md`, `CONTRIBUTING.md`, `CHANGELOG.md`

**Interfaces:**
- Consumes: the target names from Task 2 (`Pack Rat-<version>-mac-arm64.dmg` and friends) — the README's download instructions must name the files the release workflow actually produces.
- Produces: the documents Task 7 publishes.

- [ ] **Step 1: Rewrite `README.md` for a player**

Sections, in this order: what Pack Rat is, in two sentences, and a plain list of what it does (inventory across every character and container, who is wearing what, the suit builder, the in-game highlight/grab bridge); **Install** — download from Releases, naming the actual artifacts per platform; **The unsigned-build warnings**, one short subsection per platform, written as instructions a non-technical player can follow:

- macOS: the app is unsigned, so Gatekeeper calls it damaged. Right-click the app and choose Open, or run `xattr -dr com.apple.quarantine "/Applications/Pack Rat.app"`.
- Windows: SmartScreen shows "Windows protected your PC" — choose **More info**, then **Run anyway**.
- Linux: `chmod +x Pack-Rat-<version>-linux-x86_64.AppImage`, then run it.

Then: **First run** (the setup wizard, picking the game client folder, installing the adapter scripts, the first scan); **The game side** (what the three TazUO scripts do, that everything is attended, the shard's AFK rules in one line); **Your data** (the data directory per platform, and a pointer to `PRIVACY.md`); **Developing** (the existing content, trimmed, pointing at `CONTRIBUTING.md` and `TESTING.md`); **License**. Keep the "Status: pre-release" note honest about what is and is not usable yet.

- [ ] **Step 2: Write `PRIVACY.md`**

State plainly: Pack Rat stores everything in one folder on the player's own machine and sends nothing anywhere. No analytics, no telemetry, no crash reporting, no account. The only outbound network request the app can make is the manual "Check for updates" button, which asks the GitHub releases API for the latest version number and is only sent when the player presses it. The local server listens on localhost only, with a per-launch token, and refuses requests whose `Host` or `Origin` is not local. List what is stored (scans, profiles, saved runs, settings, logs, the bridge queue) and note that deleting the data directory removes all of it. Add that scan files contain character names, item names and serials from the player's own account, so a player sharing one should expect it to identify them.

- [ ] **Step 3: Write `SECURITY.md`**

How to report: GitHub's private vulnerability reporting on the repository, and that a public issue is the wrong channel for anything exploitable. What is in scope: the localhost HTTP server and its token, the script installer's path handling, the scan and bridge parsers, the Electron shell's window settings. What is out of scope: the game client itself, the shard's servers, and anything requiring an attacker who already has the player's filesystem. Note that builds are unsigned by design in this release and that downloads should come only from the project's Releases page.

- [ ] **Step 4: Write `CODE_OF_CONDUCT.md`**

Short and specific to this project: be civil, assume good faith, no harassment, keep discussion about the software, and how to report a problem (the maintainer's GitHub contact). Do not paste the Contributor Covenant text — write it in the project's own words, under 300 words.

- [ ] **Step 5: Write `RELEASING.md`**

The checklist, in order: the full suite passes on all three platforms in CI; the version in `package.json` is bumped (semver) and `CHANGELOG.md` has the release's section; `git tag vX.Y.Z` and push the tag; the Release workflow builds and uploads to a draft release; download each artifact and actually launch it on each platform, including the unsigned-warning path from a clean machine; check "Check for updates" against the new release; publish the draft; announce.

Then a **Before 1.0** section listing what is deliberately outstanding: a real application icon (`build/icon.png`, see `build/README.md`), README screenshots (the shot list: the inventory tab, a character sheet, a suit-builder result, the setup wizard, and the macOS Gatekeeper dialog a player will meet), code signing on macOS and Windows, and automatic updates via `electron-updater`.

- [ ] **Step 6: Write the GitHub intake templates**

`.github/ISSUE_TEMPLATE/bug_report.yml` — a form with: what happened, what you expected, steps, your OS and app version, your game client (TazUO version), and a checkbox confirming no personal data is pasted in. `feature_request.yml` — the problem being solved, not just the proposed solution. `config.yml` — `blank_issues_enabled: false` and a contact link to Discussions. `.github/PULL_REQUEST_TEMPLATE.md` — what changed and why, the tests that cover it, and a reminder that `npm test` must pass.

- [ ] **Step 7: Update `CONTRIBUTING.md` and `CHANGELOG.md`**

`CONTRIBUTING.md`: the clone URL, the release process pointing at `RELEASING.md`, the conduct expectations pointing at `CODE_OF_CONDUCT.md`, and a line that new tests need a tag per `TESTING.md`. `CHANGELOG.md`: an Unreleased entry covering this phase — packaging, CI, the Playwright test, the scrub, the environment-variable rename, and the new community documents.

- [ ] **Step 8: Verify the documents are consistent with reality**

```bash
npm test
node --test scripts/scrub.test.mjs
grep -o 'Pack Rat-[^ `)]*' README.md | sort -u
node -e "const b=require('./package.json').build;console.log(b.artifactName)"
```

Expected: the file names the README tells players to download match the `artifactName` pattern, with `${productName}` resolving to `Pack Rat`. Fix the README if they disagree; the packaging config is the source of truth.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -F - <<'EOF'
Write the player-facing README and the community documents

The README now speaks to someone who has never seen the repository: what the app does, how to install it, and how to get past each platform's unsigned-app warning. Adds a privacy statement (nothing leaves the machine except a manual update check), a security policy, a short code of conduct, a release checklist that carries the pre-1.0 blockers, and GitHub issue and pull-request templates.

Claude-Session: https://claude.ai/code/session_012Jc4pEtTUy9dfd8sp6EbPb
EOF
```

---

## Task 7: Publish

**This task has a human gate.** It makes the repository and its whole history world-readable, which cannot be undone by deleting it later. Do not run any step past Step 2 until the user has seen the review output and said to publish.

**Files:** none changed in the repository except a possible `README.md` badge.

**Interfaces:**
- Consumes: every earlier task.
- Produces: `github.com/gunn4r/uo-pack-rat` and a green CI run.

- [ ] **Step 1: Prove the working tree is clean and the suite is green**

```bash
git status --short
npm test
python3 -c "import json;d=json.load(open('test_logs/latest_summary.json'));print(d['mode'],d['passed'],'/',d['total'],'failed',d['failed'])"
```

Expected: no uncommitted changes, full mode, 0 failed.

- [ ] **Step 2: Audit what publishing would expose**

```bash
git log --all --name-only --format= | sort -u > /tmp/packrat-history-files.txt
grep -E '^(local/|test_logs/|node_modules/|dist/|app/dist/)' /tmp/packrat-history-files.txt || echo "no ignored path was ever committed"
git log --format='%an <%ae>' | sort -u
git log --format=%s | head -20
```

Report to the user: whether any ignored path was ever committed, the author identities in the history (an email address becomes public), and the fact that the earliest commit messages still carry the retired product name. Then stop and ask whether to publish.

- [ ] **Step 3: Create the repository (only after the user says go)**

```bash
gh repo view gunn4r/uo-pack-rat >/dev/null 2>&1 && echo "ALREADY EXISTS — stop and ask" || echo "name is free"
gh repo create gunn4r/uo-pack-rat --public --source . --remote origin --push \
  --description "Every item you own, every suit you could wear. Inventory and suit builder for Ultima Online players."
```

Expected: the repository is created and `main` is pushed.

- [ ] **Step 4: Set the repository's metadata**

```bash
gh repo edit gunn4r/uo-pack-rat --add-topic ultima-online --add-topic electron --add-topic uo --add-topic gaming-tools
gh repo edit gunn4r/uo-pack-rat --enable-issues --enable-discussions --enable-wiki=false
```

- [ ] **Step 5: Watch the first CI run**

```bash
gh run list --limit 3
gh run watch --exit-status
```

Expected: the CI workflow runs on all three platforms and passes. If a platform fails, fix it on a branch and push — a red first run on a public repository is the wrong first impression, and this is exactly the feedback CI exists to give. Windows path handling and the Linux Electron launch are the likely failures.

- [ ] **Step 6: Confirm the manual update check works against the real repository**

With the app running (`npm run desktop`), press Check for updates. With no release published yet it should report that the app is up to date, or that no release was found — and must not throw. `app/installer.mjs`'s `checkForUpdates` reads `package.json`'s `repository`, which Task 2 set.

- [ ] **Step 7: Commit any fixes and report**

Report to the user: the repository URL, the CI run result per platform, and what remains before a 1.0 release per `RELEASING.md`.

---

## Self-Review

**Spec coverage (§10, §11, §12 row 5):** targets, `asar` with `app/**` unpacked, unsigned decision, the manual update check, CI matrix, `--publish always` into a draft release, `CSC_IDENTITY_AUTO_DISCOVERY=false`, semver and `CHANGELOG.md` — Tasks 2, 4, 6, 7. Playwright Electron smoke — Task 3. README with the unsigned-build instructions, privacy statement, community files, docs scrub — Tasks 5 and 6. Screenshots are deliberately out of this phase by the user's decision, and carried in `RELEASING.md`'s Before 1.0 list.

**Deliberately out of scope:** signing and notarization, `electron-updater` automatic updates, the application icon, screenshots, and Phase 6's adapters. Each is named in `RELEASING.md` rather than left implicit.

**Known risk:** Task 3's selectors are written against markup the plan's author did not have open; the task says to correct them against `app/index.html` and to prove the test can fail, rather than to weaken the assertions. Task 7's Step 5 expects a first CI run to be the first real test of the workflows — the workflow tests in Task 4 are string checks, and cannot prove a job runs.
